/**
 * @fileoverview Integration Manager - Core event-driven integration system
 *
 * This module provides the main IntegrationManager class that coordinates
 * event emission, handler registration, and integration lifecycle management.
 */

import { log } from '../utils.js';
import {
	EVENT_TYPES,
	DEFAULT_CONFIG,
	validateEventPayload,
	createEventPayload
} from './types.js';
import { BaseIntegrationHandler } from './base-integration-handler.js';
import { errorBoundaryRegistry } from './error-boundary.js';
import { circuitBreakerRegistry } from './circuit-breaker.js';
import { healthMonitor } from './health-monitor.js';
import { recoveryManager } from './recovery-manager.js';

/**
 * Main integration manager that handles event emission and handler coordination
 */
export class IntegrationManager {
	/**
	 * @param {Object} config - Configuration object
	 */
	constructor(config = {}) {
		this.config = {
			...DEFAULT_CONFIG.eventProcessing,
			enableErrorBoundaries: true,
			enableCircuitBreakers: true,
			enableHealthMonitoring: true,
			enableAutoRecovery: true,
			isolationLevel: 'integration',
			...config
		};

		// Event handlers registry
		// Map<eventType, Array<handler>>
		this.handlers = new Map();

		// Registered integrations
		// Map<integrationName, BaseIntegrationHandler>
		this.integrations = new Map();

		// Middleware functions
		this.middleware = [];

		// State tracking
		this.initialized = false;
		this.isShuttingDown = false;
		this.stats = {
			eventsEmitted: 0,
			eventsProcessed: 0,
			eventsFailed: 0,
			handlersExecuted: 0,
			handlersFailed: 0,
			isolatedEvents: 0,
			recoveredEvents: 0
		};

		// Event queue for batching
		this.eventQueue = [];
		this.batchTimer = null;

		// Error boundaries for integrations
		this.errorBoundaries = new Map();

		// Bind methods to preserve context
		this.emit = this.emit.bind(this);
		this.on = this.on.bind(this);
		this.use = this.use.bind(this);
	}

	/**
	 * Initialize the integration manager
	 *
	 * @param {Object} config - Optional configuration updates
	 * @returns {Promise<void>}
	 */
	async initialize(config = {}) {
		if (this.initialized) {
			log('warn', 'IntegrationManager is already initialized');
			return;
		}

		this.config = { ...this.config, ...config };

		try {
			// Initialize error boundaries and monitoring systems
			if (this.config.enableHealthMonitoring) {
				this._initializeHealthMonitoring();
			}

			if (this.config.enableAutoRecovery) {
				this._initializeRecoveryManager();
			}

			// Initialize all registered integrations with error boundaries
			const initPromises = Array.from(this.integrations.values()).map(
				async (integration) => {
					try {
						// Create error boundary for this integration
						if (this.config.enableErrorBoundaries) {
							await this._setupIntegrationErrorBoundary(integration);
						}

						await integration.initialize(this.config);
						log('info', `Integration ${integration.getName()} initialized`);
					} catch (error) {
						log(
							'error',
							`Failed to initialize integration ${integration.getName()}:`,
							error.message
						);
						// Handle initialization failure through error boundary
						if (this.config.enableErrorBoundaries) {
							const boundary = this.errorBoundaries.get(integration.getName());
							if (boundary) {
								boundary.handleError(error, { phase: 'initialization' });
							}
						}
					}
				}
			);

			await Promise.allSettled(initPromises);

			this.initialized = true;
			log('info', 'IntegrationManager initialized successfully');
		} catch (error) {
			log('error', 'Failed to initialize IntegrationManager:', error.message);
			throw error;
		}
	}

	/**
	 * Shutdown the integration manager
	 *
	 * @returns {Promise<void>}
	 */
	async shutdown() {
		if (!this.initialized || this.isShuttingDown) {
			return;
		}

		this.isShuttingDown = true;

		try {
			// Clear any pending batch timer
			if (this.batchTimer) {
				clearTimeout(this.batchTimer);
				this.batchTimer = null;
			}

			// Process any remaining queued events
			if (this.eventQueue.length > 0) {
				await this._processBatch();
			}

			// Shutdown all integrations
			const shutdownPromises = Array.from(this.integrations.values()).map(
				async (integration) => {
					try {
						await integration.shutdown();
						log('info', `Integration ${integration.getName()} shutdown`);
					} catch (error) {
						log(
							'error',
							`Error shutting down integration ${integration.getName()}:`,
							error.message
						);
					}
				}
			);

			await Promise.allSettled(shutdownPromises);

			this.initialized = false;
			log('info', 'IntegrationManager shutdown completed');
		} catch (error) {
			log('error', 'Error during IntegrationManager shutdown:', error.message);
		} finally {
			this.isShuttingDown = false;
		}
	}

	/**
	 * Register an integration handler
	 *
	 * @param {BaseIntegrationHandler} integration - Integration handler instance
	 * @param {Object} options - Registration options
	 * @param {boolean} [options.validateConfig=true] - Whether to validate configuration
	 * @param {boolean} [options.checkDependencies=true] - Whether to check dependencies
	 * @returns {void}
	 */
	register(integration, options = {}) {
		const opts = {
			validateConfig: true,
			checkDependencies: true,
			...options
		};

		if (!(integration instanceof BaseIntegrationHandler)) {
			throw new Error('Integration must extend BaseIntegrationHandler');
		}

		const name = integration.getName();

		// Validate configuration if requested
		if (opts.validateConfig) {
			const validation = this._validateIntegrationConfig(integration);
			if (!validation.valid) {
				throw new Error(
					`Integration ${name} configuration is invalid: ${validation.errors.join(', ')}`
				);
			}
		}

		if (this.integrations.has(name)) {
			log('warn', `Integration ${name} is already registered, replacing`);
		}

		this.integrations.set(name, integration);

		// Check dependencies if requested
		if (opts.checkDependencies) {
			const depCheck = this.checkDependencies(name);
			if (!depCheck.satisfied) {
				log(
					'warn',
					`Integration ${name} has dependency issues: ${depCheck.errors.join(', ')}`
				);
			}
		}

		// Auto-register the integration for all events it can handle
		this._autoRegisterIntegration(integration);

		log('info', `Integration ${name} registered successfully`);
	}

	/**
	 * Unregister an integration
	 *
	 * @param {string} integrationName - Name of the integration to unregister
	 * @returns {Promise<void>}
	 */
	async unregister(integrationName) {
		const integration = this.integrations.get(integrationName);

		if (!integration) {
			log('warn', `Integration ${integrationName} is not registered`);
			return;
		}

		try {
			// Shutdown the integration
			await integration.shutdown();

			// Remove from integrations map
			this.integrations.delete(integrationName);

			// Remove from all handler registrations
			for (const [eventType, handlers] of this.handlers.entries()) {
				const filteredHandlers = handlers.filter(
					(handler) =>
						!(
							handler.integration &&
							handler.integration.getName() === integrationName
						)
				);

				if (filteredHandlers.length === 0) {
					this.handlers.delete(eventType);
				} else {
					this.handlers.set(eventType, filteredHandlers);
				}
			}

			log('info', `Integration ${integrationName} unregistered successfully`);
		} catch (error) {
			log(
				'error',
				`Error unregistering integration ${integrationName}:`,
				error.message
			);
			throw error;
		}
	}

	/**
	 * Check if an integration is enabled and registered
	 *
	 * @param {string} integrationName - Name of the integration
	 * @returns {boolean} True if enabled
	 */
	isEnabled(integrationName) {
		const integration = this.integrations.get(integrationName);
		return integration ? integration.isEnabled() : false;
	}

	/**
	 * Enable an integration
	 *
	 * @param {string} integrationName - Name of the integration to enable
	 * @returns {Promise<void>}
	 */
	async enable(integrationName) {
		const integration = this.integrations.get(integrationName);

		if (!integration) {
			throw new Error(`Integration ${integrationName} is not registered`);
		}

		if (integration.isEnabled()) {
			log('info', `Integration ${integrationName} is already enabled`);
			return;
		}

		try {
			// Update integration configuration to enable it
			integration.config.enabled = true;

			// Re-initialize if needed
			if (!integration.initialized) {
				await integration.initialize(this.config);
			}

			log('info', `Integration ${integrationName} enabled successfully`);
		} catch (error) {
			log(
				'error',
				`Failed to enable integration ${integrationName}:`,
				error.message
			);
			throw error;
		}
	}

	/**
	 * Disable an integration
	 *
	 * @param {string} integrationName - Name of the integration to disable
	 * @returns {Promise<void>}
	 */
	async disable(integrationName) {
		const integration = this.integrations.get(integrationName);

		if (!integration) {
			throw new Error(`Integration ${integrationName} is not registered`);
		}

		if (!integration.isEnabled()) {
			log('info', `Integration ${integrationName} is already disabled`);
			return;
		}

		try {
			// Update integration configuration to disable it
			integration.config.enabled = false;

			log('info', `Integration ${integrationName} disabled successfully`);
		} catch (error) {
			log(
				'error',
				`Failed to disable integration ${integrationName}:`,
				error.message
			);
			throw error;
		}
	}

	/**
	 * Add event handler for specific event type
	 *
	 * @param {string} eventType - Event type to listen for (supports wildcards)
	 * @param {Function} handler - Handler function
	 * @param {Object} options - Handler options
	 * @returns {void}
	 */
	on(eventType, handler, options = {}) {
		if (typeof handler !== 'function') {
			throw new Error('Handler must be a function');
		}

		if (!this.handlers.has(eventType)) {
			this.handlers.set(eventType, []);
		}

		const handlerWrapper = {
			handler,
			options,
			integration: options.integration || null
		};

		this.handlers.get(eventType).push(handlerWrapper);
		log('debug', `Handler registered for event type: ${eventType}`);
	}

	/**
	 * Remove event handler
	 *
	 * @param {string} eventType - Event type
	 * @param {Function} handler - Handler function to remove
	 * @returns {void}
	 */
	off(eventType, handler) {
		if (!this.handlers.has(eventType)) {
			return;
		}

		const handlers = this.handlers.get(eventType);
		const filteredHandlers = handlers.filter((h) => h.handler !== handler);

		if (filteredHandlers.length === 0) {
			this.handlers.delete(eventType);
		} else {
			this.handlers.set(eventType, filteredHandlers);
		}
	}

	/**
	 * Add middleware function
	 *
	 * @param {Function} middleware - Middleware function
	 * @returns {void}
	 */
	use(middleware) {
		if (typeof middleware !== 'function') {
			throw new Error('Middleware must be a function');
		}

		this.middleware.push(middleware);
		log('debug', 'Middleware registered');
	}

	/**
	 * Emit an event
	 *
	 * @param {string} eventType - Event type
	 * @param {Object} data - Event data
	 * @param {Object} context - Operation context
	 * @returns {Promise<void>}
	 */
	async emit(eventType, data, context) {
		if (!this.initialized) {
			log(
				'warn',
				'IntegrationManager not initialized, event will be ignored:',
				eventType
			);
			return;
		}

		if (this.isShuttingDown) {
			log(
				'warn',
				'IntegrationManager is shutting down, rejecting event:',
				eventType
			);
			return;
		}

		try {
			// Create standardized event payload
			const eventPayload = createEventPayload(eventType, data, context);

			// Validate payload
			if (!validateEventPayload(eventType, eventPayload.payload)) {
				throw new Error(`Invalid event payload for ${eventType}`);
			}

			this.stats.eventsEmitted++;

			log('debug', `Emitting event: ${eventType}`);

			// Use error boundary for event processing if enabled
			if (this.config.enableErrorBoundaries) {
				const boundary = this._getEventErrorBoundary(eventType);

				await boundary.execute(
					async () => {
						// Handle batching for bulk operations
						if (this.config.enableBatching && this._shouldBatch(eventType)) {
							this._addToBatch(eventPayload);
						} else {
							// Process immediately
							await this._processEvent(eventPayload);
						}
					},
					[],
					{
						context: { eventType, eventId: eventPayload.id },
						fallback: this._createEventFallback(eventType, eventPayload),
						timeout: this.config.eventTimeout || 30000
					}
				);
			} else {
				// Handle batching for bulk operations
				if (this.config.enableBatching && this._shouldBatch(eventType)) {
					this._addToBatch(eventPayload);
				} else {
					// Process immediately
					await this._processEvent(eventPayload);
				}
			}
		} catch (error) {
			this.stats.eventsFailed++;
			log('error', `Failed to emit event ${eventType}:`, error.message);

			// Handle error through error boundary if available
			if (this.config.enableErrorBoundaries) {
				const boundary = this._getEventErrorBoundary(eventType);
				boundary.handleError(error, { eventType, phase: 'emission' });
			}

			throw error;
		}
	}

	/**
	 * Get integration manager statistics
	 *
	 * @returns {Object} Statistics object
	 */
	getStats() {
		return {
			...this.stats,
			registeredIntegrations: this.integrations.size,
			registeredHandlers: Array.from(this.handlers.values()).reduce(
				(total, handlers) => total + handlers.length,
				0
			),
			middlewareCount: this.middleware.length,
			queuedEvents: this.eventQueue.length,
			initialized: this.initialized,
			isShuttingDown: this.isShuttingDown
		};
	}

	/**
	 * Get status of all integrations
	 *
	 * @returns {Object} Integration status map
	 */
	getIntegrationStatus() {
		const status = {};

		for (const [name, integration] of this.integrations.entries()) {
			status[name] = integration.getStatus();
		}

		return status;
	}

	/**
	 * List all registered integrations with metadata
	 *
	 * @returns {Array} Array of integration metadata
	 */
	listIntegrations() {
		const integrations = [];

		for (const [name, integration] of this.integrations.entries()) {
			integrations.push({
				name: integration.getName(),
				version: integration.getVersion(),
				enabled: integration.isEnabled(),
				initialized: integration.initialized,
				status: integration.getStatus(),
				config: integration.getConfig()
			});
		}

		return integrations.sort((a, b) => a.name.localeCompare(b.name));
	}

	/**
	 * Discover integrations by their capabilities
	 *
	 * @param {Object} criteria - Discovery criteria
	 * @param {string[]} [criteria.eventTypes] - Event types the integration should handle
	 * @param {string} [criteria.version] - Minimum version required
	 * @param {boolean} [criteria.enabled] - Filter by enabled status
	 * @returns {Array} Array of matching integrations
	 */
	discoverIntegrations(criteria = {}) {
		const integrations = this.listIntegrations();

		return integrations.filter((integration) => {
			// Filter by enabled status
			if (
				criteria.enabled !== undefined &&
				integration.enabled !== criteria.enabled
			) {
				return false;
			}

			// Filter by version (basic semver comparison)
			if (
				criteria.version &&
				!this._versionSatisfies(integration.version, criteria.version)
			) {
				return false;
			}

			// Filter by event handling capabilities
			if (criteria.eventTypes && Array.isArray(criteria.eventTypes)) {
				const integrationInstance = this.integrations.get(integration.name);
				const canHandleEvents = criteria.eventTypes.every((eventType) =>
					this._canHandleEvent(integrationInstance, eventType)
				);
				if (!canHandleEvents) {
					return false;
				}
			}

			return true;
		});
	}

	/**
	 * Get integrations that can handle a specific event type
	 *
	 * @param {string} eventType - Event type to check
	 * @returns {Array} Array of integration names
	 */
	getIntegrationsForEvent(eventType) {
		const capableIntegrations = [];

		for (const [name, integration] of this.integrations.entries()) {
			if (
				this._canHandleEvent(integration, eventType) &&
				integration.isEnabled()
			) {
				capableIntegrations.push(name);
			}
		}

		return capableIntegrations;
	}

	/**
	 * Check integration dependencies
	 *
	 * @param {string} integrationName - Name of the integration
	 * @returns {Object} Dependency check result
	 */
	checkDependencies(integrationName) {
		const integration = this.integrations.get(integrationName);

		if (!integration) {
			return {
				satisfied: false,
				missing: [],
				errors: [`Integration ${integrationName} not found`]
			};
		}

		const dependencies = integration.config.dependencies || [];
		const missing = [];
		const errors = [];

		for (const dep of dependencies) {
			const depIntegration = this.integrations.get(dep.name);

			if (!depIntegration) {
				missing.push(dep.name);
				errors.push(`Required dependency ${dep.name} is not registered`);
				continue;
			}

			if (
				dep.version &&
				!this._versionSatisfies(depIntegration.getVersion(), dep.version)
			) {
				errors.push(
					`Dependency ${dep.name} version ${depIntegration.getVersion()} does not satisfy requirement ${dep.version}`
				);
				continue;
			}

			if (!depIntegration.isEnabled()) {
				errors.push(`Dependency ${dep.name} is not enabled`);
			}
		}

		return {
			satisfied: missing.length === 0 && errors.length === 0,
			missing,
			errors
		};
	}

	/**
	 * Auto-register integration for events it can handle
	 *
	 * @param {BaseIntegrationHandler} integration - Integration instance
	 * @private
	 */
	_autoRegisterIntegration(integration) {
		// Register for all event types the integration has handlers for
		for (const eventType of Object.values(EVENT_TYPES)) {
			const handlerMethodName = this._getHandlerMethodName(eventType);

			if (
				typeof integration[handlerMethodName] === 'function' ||
				typeof integration.handleGenericEvent === 'function'
			) {
				this.on(eventType, integration.handleEvent, { integration });
			}
		}

		// Also register for wildcard events if integration supports it
		if (typeof integration.handleGenericEvent === 'function') {
			this.on('*', integration.handleEvent, { integration });
		}
	}

	/**
	 * Convert event type to handler method name
	 *
	 * @param {string} eventType - Event type
	 * @returns {string} Method name
	 * @private
	 */
	_getHandlerMethodName(eventType) {
		return (
			'handle' +
			eventType
				.split(':')
				.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
				.join('')
		);
	}

	/**
	 * Process a single event through middleware and handlers
	 *
	 * @param {Object} eventPayload - Event payload
	 * @returns {Promise<void>}
	 * @private
	 */
	async _processEvent(eventPayload) {
		let payload = eventPayload.payload;

		try {
			// Run middleware pipeline
			for (const middleware of this.middleware) {
				try {
					const result = await middleware(eventPayload.type, payload);
					if (result === null || result === false) {
						log('debug', `Event ${eventPayload.type} filtered by middleware`);
						return; // Event was filtered out
					}
					if (result) {
						payload = result;
					}
				} catch (error) {
					log(
						'error',
						`Middleware error for event ${eventPayload.type}:`,
						error.message
					);
					// Continue with other middleware
				}
			}

			// Find handlers for this event type
			const handlers = this._findHandlers(eventPayload.type);

			if (handlers.length === 0) {
				log('debug', `No handlers found for event type: ${eventPayload.type}`);
				return;
			}

			// Execute handlers with concurrency control
			await this._executeHandlers(eventPayload.type, payload, handlers);

			this.stats.eventsProcessed++;
		} catch (error) {
			this.stats.eventsFailed++;
			log(
				'error',
				`Error processing event ${eventPayload.type}:`,
				error.message
			);
			throw error;
		}
	}

	/**
	 * Find handlers for a given event type (including wildcards)
	 *
	 * @param {string} eventType - Event type
	 * @returns {Array} Array of handler wrappers
	 * @private
	 */
	_findHandlers(eventType) {
		const handlers = [];

		// Direct handlers
		if (this.handlers.has(eventType)) {
			handlers.push(...this.handlers.get(eventType));
		}

		// Wildcard handlers
		if (this.handlers.has('*')) {
			handlers.push(...this.handlers.get('*'));
		}

		// Pattern matching (e.g., 'task:*' matches 'task:created')
		for (const [pattern, patternHandlers] of this.handlers.entries()) {
			if (pattern.includes('*') && pattern !== '*') {
				const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
				if (regex.test(eventType)) {
					handlers.push(...patternHandlers);
				}
			}
		}

		return handlers;
	}

	/**
	 * Execute handlers with concurrency control and error isolation
	 *
	 * @param {string} eventType - Event type
	 * @param {Object} payload - Event payload
	 * @param {Array} handlers - Handler wrappers
	 * @returns {Promise<void>}
	 * @private
	 */
	async _executeHandlers(eventType, payload, handlers) {
		// Group handlers by concurrency requirements
		const concurrentHandlers = [];
		const sequentialHandlers = [];

		for (const handlerWrapper of handlers) {
			if (handlerWrapper.options.sequential) {
				sequentialHandlers.push(handlerWrapper);
			} else {
				concurrentHandlers.push(handlerWrapper);
			}
		}

		// Execute concurrent handlers in batches
		if (concurrentHandlers.length > 0) {
			const batches = [];
			for (
				let i = 0;
				i < concurrentHandlers.length;
				i += this.config.maxConcurrentHandlers
			) {
				batches.push(
					concurrentHandlers.slice(i, i + this.config.maxConcurrentHandlers)
				);
			}

			for (const batch of batches) {
				const promises = batch.map((handlerWrapper) =>
					this._executeHandler(eventType, payload, handlerWrapper)
				);

				const results = await Promise.allSettled(promises);

				// Log any handler failures
				results.forEach((result, index) => {
					if (result.status === 'rejected') {
						this.stats.handlersFailed++;
						const handler = batch[index];
						const integrationName = handler.integration
							? handler.integration.getName()
							: 'unknown';
						log(
							'error',
							`Handler failed for ${eventType} (${integrationName}):`,
							result.reason.message
						);
					} else {
						this.stats.handlersExecuted++;
					}
				});
			}
		}

		// Execute sequential handlers one by one
		for (const handlerWrapper of sequentialHandlers) {
			try {
				await this._executeHandler(eventType, payload, handlerWrapper);
				this.stats.handlersExecuted++;
			} catch (error) {
				this.stats.handlersFailed++;
				const integrationName = handlerWrapper.integration
					? handlerWrapper.integration.getName()
					: 'unknown';
				log(
					'error',
					`Sequential handler failed for ${eventType} (${integrationName}):`,
					error.message
				);
			}
		}
	}

	/**
	 * Execute a single handler with timeout
	 *
	 * @param {string} eventType - Event type
	 * @param {Object} payload - Event payload
	 * @param {Object} handlerWrapper - Handler wrapper
	 * @returns {Promise<any>} Handler result
	 * @private
	 */
	async _executeHandler(eventType, payload, handlerWrapper) {
		const timeout =
			handlerWrapper.options.timeout || this.config.handlerTimeout;

		return Promise.race([
			handlerWrapper.handler(eventType, payload),
			new Promise((_, reject) =>
				setTimeout(
					() => reject(new Error(`Handler timeout after ${timeout}ms`)),
					timeout
				)
			)
		]);
	}

	/**
	 * Check if event should be batched
	 *
	 * @param {string} eventType - Event type
	 * @returns {boolean} True if should be batched
	 * @private
	 */
	_shouldBatch(eventType) {
		const batchableEvents = [
			EVENT_TYPES.TASKS_BULK_CREATED,
			EVENT_TYPES.TASKS_BULK_UPDATED,
			EVENT_TYPES.TASKS_BULK_STATUS_CHANGED
		];

		return batchableEvents.includes(eventType);
	}

	/**
	 * Add event to batch queue
	 *
	 * @param {Object} eventPayload - Event payload
	 * @private
	 */
	_addToBatch(eventPayload) {
		this.eventQueue.push(eventPayload);

		// Set timer for batch processing if not already set
		if (!this.batchTimer) {
			this.batchTimer = setTimeout(() => {
				this._processBatch().catch((error) => {
					log('error', 'Error processing event batch:', error.message);
				});
			}, this.config.batchTimeout);
		}

		// Process immediately if batch is full
		if (this.eventQueue.length >= this.config.batchSize) {
			if (this.batchTimer) {
				clearTimeout(this.batchTimer);
				this.batchTimer = null;
			}
			this._processBatch().catch((error) => {
				log('error', 'Error processing full event batch:', error.message);
			});
		}
	}

	/**
	 * Process batched events
	 *
	 * @returns {Promise<void>}
	 * @private
	 */
	async _processBatch() {
		if (this.eventQueue.length === 0) {
			return;
		}

		const events = this.eventQueue.splice(0);
		this.batchTimer = null;

		log('debug', `Processing batch of ${events.length} events`);

		// Process events in parallel
		const promises = events.map((eventPayload) =>
			this._processEvent(eventPayload)
		);
		await Promise.allSettled(promises);
	}

	/**
	 * Initialize health monitoring system
	 *
	 * @private
	 */
	_initializeHealthMonitoring() {
		// Register health checks for integration manager
		healthMonitor.registerCheck(
			'integration_manager',
			() => {
				const stats = this.getStats();
				const errorRate =
					stats.eventsProcessed > 0
						? stats.eventsFailed / stats.eventsProcessed
						: 0;

				if (errorRate > 0.5) {
					return {
						status: 'unhealthy',
						message: `High error rate: ${Math.round(errorRate * 100)}%`,
						data: stats
					};
				} else if (errorRate > 0.2) {
					return {
						status: 'degraded',
						message: `Elevated error rate: ${Math.round(errorRate * 100)}%`,
						data: stats
					};
				}

				return {
					status: 'healthy',
					message: `Error rate: ${Math.round(errorRate * 100)}%`,
					data: stats
				};
			},
			{
				type: 'integration',
				critical: true,
				description: 'Integration Manager health check'
			}
		);

		// Start health monitoring
		healthMonitor.start();
		log('debug', 'Health monitoring initialized');
	}

	/**
	 * Initialize recovery manager
	 *
	 * @private
	 */
	_initializeRecoveryManager() {
		// Register recovery strategies for integration manager
		recoveryManager.registerStrategy('integration_manager_reset', async () => {
			// Reset integration manager state
			this.stats.eventsFailed = 0;
			this.stats.handlersFailed = 0;

			// Reset all error boundaries
			for (const boundary of this.errorBoundaries.values()) {
				boundary.reset();
			}

			return { action: 'integration_manager_reset', timestamp: Date.now() };
		});

		// Start recovery manager
		recoveryManager.start();
		log('debug', 'Recovery manager initialized');
	}

	/**
	 * Setup error boundary for an integration
	 *
	 * @param {BaseIntegrationHandler} integration - Integration instance
	 * @private
	 */
	async _setupIntegrationErrorBoundary(integration) {
		const integrationName = integration.getName();

		// Create error boundary with integration-specific config
		const boundary = errorBoundaryRegistry.getBoundary(integrationName, {
			maxConcurrentErrors: this.config.maxConcurrentErrors || 10,
			errorWindowMs: this.config.errorWindowMs || 60000,
			maxRetries: this.config.maxRetries || 3,
			retryDelay: this.config.retryDelay || 1000,
			timeoutMs: this.config.handlerTimeout || 30000,
			enableCircuitBreaker: this.config.enableCircuitBreakers,
			enableFallback: this.config.enableFallback || true,
			isolationLevel: this.config.isolationLevel
		});

		// Set up event listeners for boundary events
		boundary.on('error:caught', (data) => {
			log(
				'warn',
				`Error boundary caught error in ${integrationName}:`,
				data.error.message
			);
			this.stats.handlersFailed++;
		});

		boundary.on('isolation:started', (data) => {
			log(
				'error',
				`Integration ${integrationName} isolated due to: ${data.reason}`
			);
			this.stats.isolatedEvents++;
		});

		boundary.on('isolation:ended', (data) => {
			log(
				'info',
				`Integration ${integrationName} recovered from isolation: ${data.reason}`
			);
			this.stats.recoveredEvents++;
		});

		this.errorBoundaries.set(integrationName, boundary);

		// Register circuit breaker health check
		if (this.config.enableCircuitBreakers) {
			healthMonitor.registerCheck(
				`circuit_breaker_${integrationName}`,
				() => {
					const breaker = circuitBreakerRegistry.getBreaker(integrationName);
					const status = breaker.getStatus();

					if (status.state === 'open') {
						return {
							status: 'unhealthy',
							message: `Circuit breaker OPEN for ${integrationName}`,
							data: status
						};
					} else if (status.state === 'half_open') {
						return {
							status: 'degraded',
							message: `Circuit breaker HALF_OPEN for ${integrationName}`,
							data: status
						};
					}

					return {
						status: 'healthy',
						message: `Circuit breaker CLOSED for ${integrationName}`,
						data: status
					};
				},
				{
					type: 'circuit_breaker',
					critical: false,
					description: `Circuit breaker for ${integrationName}`
				}
			);
		}

		log(
			'debug',
			`Error boundary setup completed for integration: ${integrationName}`
		);
	}

	/**
	 * Get error boundary for event processing
	 *
	 * @param {string} eventType - Event type
	 * @returns {ErrorBoundary} Error boundary instance
	 * @private
	 */
	_getEventErrorBoundary(eventType) {
		// Use a general event processing boundary
		const boundaryName = `event_processing_${eventType.split(':')[0]}`;

		return errorBoundaryRegistry.getBoundary(boundaryName, {
			maxConcurrentErrors: this.config.maxConcurrentErrors || 10,
			errorWindowMs: this.config.errorWindowMs || 60000,
			maxRetries: this.config.maxRetries || 2,
			retryDelay: this.config.retryDelay || 1000,
			timeoutMs: this.config.eventTimeout || 30000,
			enableFallback: true,
			isolationLevel: 'operation'
		});
	}

	/**
	 * Create fallback function for event processing
	 *
	 * @param {string} eventType - Event type
	 * @param {Object} eventPayload - Event payload
	 * @returns {Function} Fallback function
	 * @private
	 */
	_createEventFallback(eventType, eventPayload) {
		return async () => {
			this.stats.isolatedEvents++;
			log(
				'warn',
				`Event ${eventType} handled by fallback due to error boundary isolation`
			);

			// Queue for later retry if enabled
			if (this.config.enableEventRetry) {
				await this._queueForRetry(eventPayload);
			}

			return { fallback: true, eventType, timestamp: Date.now() };
		};
	}

	/**
	 * Queue event for later retry
	 *
	 * @param {Object} eventPayload - Event payload
	 * @private
	 */
	async _queueForRetry(eventPayload) {
		// Simple retry queue implementation
		// In a production system, this might use a persistent queue
		setTimeout(async () => {
			try {
				log('debug', `Retrying event: ${eventPayload.eventType}`);
				await this._processEvent(eventPayload);
			} catch (error) {
				log(
					'error',
					`Event retry failed for ${eventPayload.eventType}:`,
					error.message
				);
			}
		}, this.config.retryDelay || 5000);
	}

	/**
	 * Get system health status including error boundaries
	 *
	 * @returns {Object} System health status
	 */
	getSystemHealth() {
		const systemHealth = healthMonitor.getSystemHealth();
		const boundaryStatuses = errorBoundaryRegistry.getAllStatuses();
		const circuitBreakerStatuses = circuitBreakerRegistry.getAllStatuses();

		return {
			...systemHealth,
			integrationManager: {
				stats: this.getStats(),
				initialized: this.initialized,
				shuttingDown: this.isShuttingDown
			},
			errorBoundaries: boundaryStatuses,
			circuitBreakers: circuitBreakerStatuses
		};
	}

	/**
	 * Check if an integration can handle a specific event type
	 *
	 * @param {BaseIntegrationHandler} integration - Integration instance
	 * @param {string} eventType - Event type to check
	 * @returns {boolean} True if can handle
	 * @private
	 */
	_canHandleEvent(integration, eventType) {
		const handlerMethodName = this._getHandlerMethodName(eventType);

		// Check if integration has specific handler method
		if (typeof integration[handlerMethodName] === 'function') {
			return true;
		}

		// Check if integration has generic event handler
		if (typeof integration.handleGenericEvent === 'function') {
			return true;
		}

		return false;
	}

	/**
	 * Simple version comparison (basic semver support)
	 *
	 * @param {string} version - Current version
	 * @param {string} requirement - Required version (supports >=, >, =, <, <=)
	 * @returns {boolean} True if version satisfies requirement
	 * @private
	 */
	_versionSatisfies(version, requirement) {
		// Basic version comparison implementation
		// For production use, consider using a proper semver library

		const parseVersion = (v) => {
			return v.split('.').map(Number);
		};

		const compareVersions = (v1, v2) => {
			const parts1 = parseVersion(v1);
			const parts2 = parseVersion(v2);

			for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
				const part1 = parts1[i] || 0;
				const part2 = parts2[i] || 0;

				if (part1 > part2) return 1;
				if (part1 < part2) return -1;
			}
			return 0;
		};

		// Extract operator and version from requirement
		const operatorMatch = requirement.match(/^(>=|>|<=|<|=)?(.+)$/);
		const operator = operatorMatch ? operatorMatch[1] || '=' : '=';
		const reqVersion = operatorMatch ? operatorMatch[2] : requirement;

		const comparison = compareVersions(version, reqVersion);

		switch (operator) {
			case '>=':
				return comparison >= 0;
			case '>':
				return comparison > 0;
			case '<=':
				return comparison <= 0;
			case '<':
				return comparison < 0;
			case '=':
			default:
				return comparison === 0;
		}
	}

	/**
	 * Validate integration configuration
	 *
	 * @param {BaseIntegrationHandler} integration - Integration instance
	 * @returns {Object} Validation result
	 * @private
	 */
	_validateIntegrationConfig(integration) {
		const errors = [];

		// Validate basic integration properties
		if (!integration.getName() || typeof integration.getName() !== 'string') {
			errors.push('Integration name must be a non-empty string');
		}

		if (
			!integration.getVersion() ||
			typeof integration.getVersion() !== 'string'
		) {
			errors.push('Integration version must be a non-empty string');
		}

		// Use the integration's own validation if available
		if (typeof integration.validateConfig === 'function') {
			const configValidation = integration.validateConfig(
				integration.getConfig()
			);
			if (!configValidation.valid) {
				errors.push(...configValidation.errors);
			}
		}

		// Validate configuration structure
		const config = integration.getConfig();
		if (config.enabled !== undefined && typeof config.enabled !== 'boolean') {
			errors.push('enabled must be a boolean');
		}

		if (
			config.timeout !== undefined &&
			(typeof config.timeout !== 'number' || config.timeout <= 0)
		) {
			errors.push('timeout must be a positive number');
		}

		// Validate dependencies structure
		if (config.dependencies !== undefined) {
			if (!Array.isArray(config.dependencies)) {
				errors.push('dependencies must be an array');
			} else {
				config.dependencies.forEach((dep, index) => {
					if (!dep.name || typeof dep.name !== 'string') {
						errors.push(`dependency[${index}].name must be a non-empty string`);
					}
					if (dep.version !== undefined && typeof dep.version !== 'string') {
						errors.push(`dependency[${index}].version must be a string`);
					}
				});
			}
		}

		return {
			valid: errors.length === 0,
			errors
		};
	}
}
