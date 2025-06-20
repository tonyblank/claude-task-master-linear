/**
 * @fileoverview Event system exports and initialization
 * 
 * This module provides the main exports for the event-driven integration system
 * and includes utilities for creating and managing the global event system instance.
 */

import { IntegrationManager } from './integration-manager.js';
import { BaseIntegrationHandler } from './base-integration-handler.js';
import { 
  EVENT_TYPES, 
  DEFAULT_CONFIG, 
  validateEventPayload, 
  createEventPayload 
} from './types.js';
import { log } from '../utils.js';

// Global event system instance
let globalEventManager = null;

/**
 * Get or create the global event manager instance
 * 
 * @param {Object} config - Configuration for the event manager
 * @returns {IntegrationManager} The global event manager instance
 */
export function getEventManager(config = {}) {
  if (!globalEventManager) {
    globalEventManager = new IntegrationManager(config);
    log('debug', 'Global event manager created');
  }
  
  return globalEventManager;
}

/**
 * Initialize the global event system
 * 
 * @param {Object} config - Configuration object
 * @returns {Promise<IntegrationManager>} Initialized event manager
 */
export async function initializeEventSystem(config = {}) {
  const eventManager = getEventManager(config);
  
  if (!eventManager.initialized) {
    await eventManager.initialize(config);
    log('info', 'Global event system initialized');
  }
  
  return eventManager;
}

/**
 * Shutdown the global event system
 * 
 * @returns {Promise<void>}
 */
export async function shutdownEventSystem() {
  if (globalEventManager && globalEventManager.initialized) {
    await globalEventManager.shutdown();
    globalEventManager = null;
    log('info', 'Global event system shutdown');
  }
}

/**
 * Reset the global event system (useful for testing)
 * 
 * @returns {Promise<void>}
 */
export async function resetEventSystem() {
  await shutdownEventSystem();
  globalEventManager = null;
}

/**
 * Register an integration with the global event system
 * 
 * @param {BaseIntegrationHandler} integration - Integration to register
 * @returns {void}
 */
export function registerIntegration(integration) {
  const eventManager = getEventManager();
  eventManager.register(integration);
}

/**
 * Emit an event through the global event system
 * 
 * @param {string} eventType - Event type
 * @param {Object} data - Event data
 * @param {Object} context - Operation context
 * @returns {Promise<void>}
 */
export async function emitEvent(eventType, data, context) {
  const eventManager = getEventManager();
  await eventManager.emit(eventType, data, context);
}

/**
 * Check if an integration is enabled
 * 
 * @param {string} integrationName - Name of the integration
 * @returns {boolean} True if enabled
 */
export function isIntegrationEnabled(integrationName) {
  if (!globalEventManager) {
    return false;
  }
  
  return globalEventManager.isEnabled(integrationName);
}

/**
 * Get event system statistics
 * 
 * @returns {Object|null} Statistics object or null if not initialized
 */
export function getEventSystemStats() {
  if (!globalEventManager) {
    return null;
  }
  
  return globalEventManager.getStats();
}

/**
 * Get status of all integrations
 * 
 * @returns {Object|null} Integration status map or null if not initialized
 */
export function getIntegrationStatus() {
  if (!globalEventManager) {
    return null;
  }
  
  return globalEventManager.getIntegrationStatus();
}

/**
 * Create a standardized operation context
 * 
 * @param {string} projectRoot - Project root directory
 * @param {Object} session - Session object
 * @param {string} source - Source of the operation
 * @param {Object} options - Additional options
 * @returns {Object} Operation context
 */
export function createOperationContext(projectRoot, session, source = 'api', options = {}) {
  return {
    projectRoot,
    session,
    source,
    requestId: options.requestId || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    user: options.user || session?.user,
    ...options
  };
}

/**
 * Middleware for adding authentication context to events
 * 
 * @param {string} eventType - Event type
 * @param {Object} payload - Event payload
 * @returns {Object} Modified payload
 */
export function authenticationMiddleware(eventType, payload) {
  // Add authentication information if available
  if (payload.context && payload.context.session) {
    payload.authenticated = true;
    payload.userId = payload.context.session.user || 'anonymous';
  } else {
    payload.authenticated = false;
    payload.userId = 'anonymous';
  }
  
  return payload;
}

/**
 * Middleware for enriching task events with additional context
 * 
 * @param {string} eventType - Event type
 * @param {Object} payload - Event payload
 * @returns {Object} Modified payload
 */
export function taskEnrichmentMiddleware(eventType, payload) {
  // Add enrichment for task-related events
  if (eventType.startsWith('task:') && payload.task) {
    payload.enriched = {
      hasSubtasks: Array.isArray(payload.task.subtasks) && payload.task.subtasks.length > 0,
      hasDependencies: Array.isArray(payload.task.dependencies) && payload.task.dependencies.length > 0,
      isHighPriority: payload.task.priority === 'high',
      estimatedComplexity: payload.task.subtasks?.length || 1
    };
  }
  
  return payload;
}

/**
 * Middleware for filtering events based on configuration
 * 
 * @param {Object} filterConfig - Filter configuration
 * @returns {Function} Middleware function
 */
export function createFilterMiddleware(filterConfig = {}) {
  return function filterMiddleware(eventType, payload) {
    // Filter by event type
    if (filterConfig.excludeEventTypes && filterConfig.excludeEventTypes.includes(eventType)) {
      return null; // Filter out this event
    }
    
    // Filter by task properties
    if (eventType.startsWith('task:') && payload.task) {
      if (filterConfig.excludeInternalTasks && payload.task.title?.startsWith('_')) {
        return null;
      }
      
      if (filterConfig.excludeLowPriority && payload.task.priority === 'low') {
        return null;
      }
    }
    
    // Filter by source
    if (filterConfig.allowedSources && !filterConfig.allowedSources.includes(payload.context?.source)) {
      return null;
    }
    
    return payload;
  };
}

/**
 * Validate integration configuration
 * 
 * @param {Object} config - Configuration to validate
 * @returns {Object} Validation result
 */
export function validateIntegrationConfig(config) {
  const errors = [];
  
  if (!config || typeof config !== 'object') {
    errors.push('Configuration must be an object');
    return { valid: false, errors };
  }
  
  // Validate event processing config
  if (config.eventProcessing) {
    const ep = config.eventProcessing;
    
    if (ep.maxConcurrentHandlers && (typeof ep.maxConcurrentHandlers !== 'number' || ep.maxConcurrentHandlers <= 0)) {
      errors.push('maxConcurrentHandlers must be a positive number');
    }
    
    if (ep.handlerTimeout && (typeof ep.handlerTimeout !== 'number' || ep.handlerTimeout <= 0)) {
      errors.push('handlerTimeout must be a positive number');
    }
    
    if (ep.batchSize && (typeof ep.batchSize !== 'number' || ep.batchSize <= 0)) {
      errors.push('batchSize must be a positive number');
    }
  }
  
  // Validate retry config
  if (config.retry) {
    const retry = config.retry;
    
    if (retry.maxAttempts && (typeof retry.maxAttempts !== 'number' || retry.maxAttempts <= 0)) {
      errors.push('retry.maxAttempts must be a positive number');
    }
    
    if (retry.baseDelay && (typeof retry.baseDelay !== 'number' || retry.baseDelay <= 0)) {
      errors.push('retry.baseDelay must be a positive number');
    }
    
    if (retry.backoffStrategy && !['exponential', 'linear', 'fixed'].includes(retry.backoffStrategy)) {
      errors.push('retry.backoffStrategy must be one of: exponential, linear, fixed');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

// Export main classes and utilities
export {
  IntegrationManager,
  BaseIntegrationHandler,
  EVENT_TYPES,
  DEFAULT_CONFIG,
  validateEventPayload,
  createEventPayload
};

// Export for testing
export const __testing = {
  getGlobalEventManager: () => globalEventManager,
  setGlobalEventManager: (manager) => { globalEventManager = manager; }
};