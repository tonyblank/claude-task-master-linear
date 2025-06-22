/**
 * @fileoverview Event system type definitions and interfaces
 *
 * This module defines the event types, payload structures, and configuration
 * interfaces for the TaskMaster event-driven architecture.
 */

import {
	validateEventPayload as validateWithSchema,
	createStandardEventPayload
} from './payload-serializer.js';

/**
 * @typedef {Object} OperationContext
 * @property {string} projectRoot - The project root directory
 * @property {Object} session - Session information
 * @property {string} [user] - User identifier
 * @property {'cli'|'mcp'|'api'|'webhook'} source - Source of the operation
 * @property {string} [requestId] - Request identifier for tracing
 */

/**
 * @typedef {'pending'|'in-progress'|'review'|'done'|'cancelled'|'deferred'} TaskStatus
 */

/**
 * @typedef {'high'|'medium'|'low'} TaskPriority
 */

/**
 * @typedef {Object} Task
 * @property {string} id - Task identifier
 * @property {string} title - Task title
 * @property {string} description - Task description
 * @property {string} details - Detailed implementation notes
 * @property {TaskStatus} status - Current task status
 * @property {TaskPriority} priority - Task priority
 * @property {string[]} dependencies - Array of task IDs this task depends on
 * @property {Subtask[]} subtasks - Array of subtasks
 * @property {string} [testStrategy] - Testing strategy for the task
 * @property {string} [linearIssueId] - Linear issue ID for integration
 * @property {Object<string, string>} [externalIds] - External system IDs
 */

/**
 * @typedef {Object} Subtask
 * @property {string} id - Subtask identifier
 * @property {string} title - Subtask title
 * @property {string} description - Subtask description
 * @property {string} details - Detailed implementation notes
 * @property {TaskStatus} status - Current subtask status
 * @property {string[]} dependencies - Array of dependency IDs
 * @property {string} [linearIssueId] - Linear issue ID for integration
 * @property {Object<string, string>} [externalIds] - External system IDs
 */

/**
 * @typedef {Object} EventPayload
 * @property {string} type - Event type
 * @property {Object} payload - Event data
 */

/**
 * @typedef {Object} TaskCreatedEventPayload
 * @property {string} taskId - ID of the created task
 * @property {Task} task - The created task object
 * @property {string} tag - Tag context
 * @property {OperationContext} context - Operation context
 * @property {string} timestamp - ISO timestamp of event
 */

/**
 * @typedef {Object} TaskUpdatedEventPayload
 * @property {string} taskId - ID of the updated task
 * @property {Task} task - The updated task object
 * @property {Partial<Task>} changes - Fields that were changed
 * @property {Partial<Task>} oldValues - Previous values of changed fields
 * @property {string} tag - Tag context
 * @property {OperationContext} context - Operation context
 * @property {string} timestamp - ISO timestamp of event
 */

/**
 * @typedef {Object} TaskStatusChangedEventPayload
 * @property {string} taskId - ID of the task
 * @property {Task} task - The task object
 * @property {TaskStatus} oldStatus - Previous status
 * @property {TaskStatus} newStatus - New status
 * @property {string} tag - Tag context
 * @property {OperationContext} context - Operation context
 * @property {string} timestamp - ISO timestamp of event
 */

/**
 * @typedef {Object} RetryConfig
 * @property {number} maxAttempts - Maximum retry attempts
 * @property {'exponential'|'linear'|'fixed'} backoffStrategy - Backoff strategy
 * @property {number} baseDelay - Base delay in milliseconds
 * @property {number} maxDelay - Maximum delay in milliseconds
 * @property {string[]} retryableErrors - Error types that should be retried
 */

/**
 * @typedef {Object} EventProcessingConfig
 * @property {number} maxConcurrentHandlers - Maximum concurrent handlers
 * @property {number} handlerTimeout - Handler timeout in milliseconds
 * @property {number} retryAttempts - Number of retry attempts
 * @property {'exponential'|'linear'} retryBackoff - Retry backoff strategy
 * @property {boolean} enableBatching - Enable event batching
 * @property {number} batchSize - Batch size for bulk operations
 * @property {number} batchTimeout - Batch timeout in milliseconds
 */

/**
 * @typedef {Object} IntegrationConfig
 * @property {string} name - Integration name
 * @property {string} version - Integration version
 * @property {boolean} enabled - Whether integration is enabled
 * @property {Object} settings - Integration-specific settings
 * @property {RetryConfig} [retry] - Retry configuration
 * @property {number} [timeout] - Operation timeout in milliseconds
 */

/**
 * Event type constants
 */
export const EVENT_TYPES = {
	// Task lifecycle events
	TASK_CREATED: 'task:created',
	TASK_UPDATED: 'task:updated',
	TASK_STATUS_CHANGED: 'task:status:changed',
	TASK_REMOVED: 'task:removed',

	// Subtask events
	SUBTASK_CREATED: 'subtask:created',
	SUBTASK_UPDATED: 'subtask:updated',
	SUBTASK_STATUS_CHANGED: 'subtask:status:changed',
	SUBTASK_REMOVED: 'subtask:removed',

	// Dependency events
	DEPENDENCY_ADDED: 'dependency:added',
	DEPENDENCY_REMOVED: 'dependency:removed',
	DEPENDENCIES_SATISFIED: 'dependencies:satisfied',

	// Bulk operations
	TASKS_BULK_CREATED: 'tasks:bulk:created',
	TASKS_BULK_UPDATED: 'tasks:bulk:updated',
	TASKS_BULK_STATUS_CHANGED: 'tasks:bulk:status:changed',

	// Tag events
	TAG_CREATED: 'tag:created',
	TAG_SWITCHED: 'tag:switched',
	TAG_DELETED: 'tag:deleted',

	// Integration events
	INTEGRATION_SUCCESS: 'integration:success',
	INTEGRATION_ERROR: 'integration:error'
};

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = {
	eventProcessing: {
		maxConcurrentHandlers: 5,
		handlerTimeout: 30000, // 30 seconds
		retryAttempts: 3,
		retryBackoff: 'exponential',
		enableBatching: true,
		batchSize: 10,
		batchTimeout: 5000 // 5 seconds
	},
	retry: {
		maxAttempts: 3,
		backoffStrategy: 'exponential',
		baseDelay: 1000, // 1 second
		maxDelay: 30000, // 30 seconds
		retryableErrors: ['ECONNRESET', 'ENOTFOUND', 'TIMEOUT', 'RATE_LIMIT']
	}
};

/**
 * Validates an event payload structure using the new schema system
 * @param {string} eventType - The event type
 * @param {Object} payload - The event payload
 * @returns {boolean} True if valid
 */
export function validateEventPayload(eventType, payload) {
	if (!eventType || typeof eventType !== 'string') {
		return false;
	}

	if (!payload || typeof payload !== 'object') {
		return false;
	}

	// Basic validation - all events should have context and timestamp
	if (!payload.context || !payload.timestamp) {
		return false;
	}

	// Validate timestamp format
	if (Number.isNaN(Date.parse(payload.timestamp))) {
		return false;
	}

	// Use the new schema validation system if available
	try {
		// Check if this looks like a new standardized payload
		if (payload && payload.version && payload.eventId) {
			const result = validateWithSchema(eventType, payload);
			return result.valid;
		} else {
			// For legacy payloads, use basic validation
			return true;
		}
	} catch (error) {
		// Fallback to basic validation if schema system is not available
		console.error('validateEventPayload schema validation error:', error);
		return true;
	}
}

/**
 * Creates a standardized event payload using the new schema system
 * @param {string} eventType - The event type
 * @param {Object} data - The event data
 * @param {OperationContext} context - The operation context
 * @returns {EventPayload} Standardized event payload
 */
export function createEventPayload(eventType, data, context) {
	try {
		// Try to use the new standardized payload creator
		return {
			type: eventType,
			payload: createStandardEventPayload(eventType, data, context)
		};
	} catch (error) {
		// Log the error so we know what's happening
		console.error(
			'Failed to create standard payload, falling back to legacy:',
			error
		);
		// Fallback to the original format for backward compatibility
		return {
			type: eventType,
			payload: {
				...data,
				context,
				timestamp: new Date().toISOString()
			}
		};
	}
}
