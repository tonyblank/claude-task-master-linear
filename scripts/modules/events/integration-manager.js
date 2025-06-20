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
			handlersFailed: 0
		};

		// Event queue for batching
		this.eventQueue = [];
		this.batchTimer = null;

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
			// Initialize all registered integrations
			const initPromises = Array.from(this.integrations.values()).map(
				async (integration) => {
					try {
						await integration.initialize(this.config);
						log('info', `Integration ${integration.getName()} initialized`);
					} catch (error) {
						log(
							'error',
							`Failed to initialize integration ${integration.getName()}:`,
							error.message
						);
						// Don't fail entire initialization for one integration
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
	 * @returns {void}
	 */
	register(integration) {
		if (!(integration instanceof BaseIntegrationHandler)) {
			throw new Error('Integration must extend BaseIntegrationHandler');
		}

		const name = integration.getName();

		if (this.integrations.has(name)) {
			log('warn', `Integration ${name} is already registered, replacing`);
		}

		this.integrations.set(name, integration);

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

			// Handle batching for bulk operations
			if (this.config.enableBatching && this._shouldBatch(eventType)) {
				this._addToBatch(eventPayload);
			} else {
				// Process immediately
				await this._processEvent(eventPayload);
			}
		} catch (error) {
			this.stats.eventsFailed++;
			log('error', `Failed to emit event ${eventType}:`, error.message);
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
}
