/**
 * @fileoverview Enhanced Integration Manager with advanced event emission system
 *
 * This module extends the IntegrationManager with the new event emission components:
 * EventEmitter, EventBus, and EventQueue for more sophisticated event handling.
 */

import { log } from '../utils.js';
import {
	EVENT_TYPES,
	DEFAULT_CONFIG,
	validateEventPayload,
	createEventPayload
} from './types.js';
import { BaseIntegrationHandler } from './base-integration-handler.js';
import { EventEmitter } from './event-emitter.js';
import { EventBus } from './event-bus.js';
import { EventQueue, PRIORITY } from './event-queue.js';

/**
 * Enhanced integration manager with advanced event processing capabilities
 */
export class EnhancedIntegrationManager {
	/**
	 * @param {Object} config - Configuration object
	 */
	constructor(config = {}) {
		this.config = {
			...DEFAULT_CONFIG.eventProcessing,
			// Enhanced features configuration
			enableEventBus: true,
			enableEventQueue: true,
			enableAdvancedEmitter: true,
			eventBusConfig: {},
			eventQueueConfig: {},
			eventEmitterConfig: {},
			// Legacy compatibility
			legacyMode: false,
			...config
		};

		// Initialize enhanced event components
		this.eventEmitter = new EventEmitter({
			...DEFAULT_CONFIG.eventProcessing,
			...this.config.eventEmitterConfig
		});

		this.eventBus = this.config.enableEventBus
			? new EventBus({
					deliveryGuarantees: true,
					...this.config.eventBusConfig
				})
			: null;

		this.eventQueue = this.config.enableEventQueue
			? new EventQueue({
					enableBatching: this.config.enableBatching,
					maxConcurrency: this.config.maxConcurrentHandlers,
					processingTimeout: this.config.handlerTimeout,
					...this.config.eventQueueConfig
				})
			: null;

		// Registered integrations
		this.integrations = new Map();

		// Middleware functions
		this.middleware = [];

		// State tracking
		this.initialized = false;
		this.isShuttingDown = false;

		// Enhanced statistics
		this.stats = {
			eventsEmitted: 0,
			eventsProcessed: 0,
			eventsFailed: 0,
			handlersExecuted: 0,
			handlersFailed: 0,
			busMessagesPublished: 0,
			queueItemsProcessed: 0
		};

		// Event processing modes
		this.processingModes = {
			DIRECT: 'direct', // Direct handler execution
			QUEUED: 'queued', // Queue-based processing
			BUS: 'bus', // Event bus pub/sub
			HYBRID: 'hybrid' // Combination of modes
		};

		this.defaultProcessingMode = this.processingModes.HYBRID;

		// Setup event queue processing if enabled
		if (this.eventQueue) {
			this._setupQueueProcessing();
		}

		// Setup event bus routing if enabled
		if (this.eventBus) {
			this._setupEventBusRouting();
		}

		// Bind methods
		this.emit = this.emit.bind(this);
		this.register = this.register.bind(this);
	}

	/**
	 * Initialize the enhanced integration manager
	 *
	 * @param {Object} config - Optional configuration updates
	 * @returns {Promise<void>}
	 */
	async initialize(config = {}) {
		if (this.initialized) {
			log('warn', 'EnhancedIntegrationManager is already initialized');
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
					}
				}
			);

			await Promise.allSettled(initPromises);

			// Start event queue processing
			if (this.eventQueue) {
				this.eventQueue.startProcessing();
			}

			this.initialized = true;
			log('info', 'EnhancedIntegrationManager initialized successfully');
		} catch (error) {
			log(
				'error',
				'Failed to initialize EnhancedIntegrationManager:',
				error.message
			);
			throw error;
		}
	}

	/**
	 * Shutdown the enhanced integration manager
	 *
	 * @returns {Promise<void>}
	 */
	async shutdown() {
		if (!this.initialized || this.isShuttingDown) {
			return;
		}

		this.isShuttingDown = true;

		try {
			// Drain event queue
			if (this.eventQueue) {
				await this.eventQueue.drain();
			}

			// Clear event bus
			if (this.eventBus) {
				this.eventBus.clear();
			}

			// Clear event emitter
			this.eventEmitter.clear();

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
			log('info', 'EnhancedIntegrationManager shutdown completed');
		} catch (error) {
			log(
				'error',
				'Error during EnhancedIntegrationManager shutdown:',
				error.message
			);
		} finally {
			this.isShuttingDown = false;
		}
	}

	/**
	 * Register an integration handler
	 *
	 * @param {BaseIntegrationHandler} integration - Integration handler instance
	 * @param {Object} options - Registration options
	 * @returns {void}
	 */
	register(integration, options = {}) {
		if (!(integration instanceof BaseIntegrationHandler)) {
			throw new Error('Integration must extend BaseIntegrationHandler');
		}

		const registrationOptions = {
			processingMode: this.defaultProcessingMode,
			priority: PRIORITY.NORMAL,
			enableEventBus: this.config.enableEventBus,
			busChannel: 'default',
			busTopics: [], // Specific topics to subscribe to
			queueOptions: {},
			...options
		};

		const name = integration.getName();

		if (this.integrations.has(name)) {
			log('warn', `Integration ${name} is already registered, replacing`);
		}

		this.integrations.set(name, integration);

		// Register based on processing mode
		this._registerIntegrationByMode(integration, registrationOptions);

		log(
			'info',
			`Integration ${name} registered with mode: ${registrationOptions.processingMode}`
		);
	}

	/**
	 * Emit an event using the enhanced emission system
	 *
	 * @param {string} eventType - Event type
	 * @param {Object} data - Event data
	 * @param {Object} context - Operation context
	 * @param {Object} options - Emission options
	 * @returns {Promise<Object>} Emission results
	 */
	async emit(eventType, data, context, options = {}) {
		if (!this.initialized) {
			log(
				'warn',
				'EnhancedIntegrationManager not initialized, event will be ignored:',
				eventType
			);
			return { success: false, reason: 'not_initialized' };
		}

		if (this.isShuttingDown) {
			log(
				'warn',
				'EnhancedIntegrationManager is shutting down, rejecting event:',
				eventType
			);
			return { success: false, reason: 'shutting_down' };
		}

		const emissionOptions = {
			processingMode: this.defaultProcessingMode,
			priority: PRIORITY.NORMAL,
			guaranteed: false,
			busChannel: 'default',
			busOptions: {},
			queueOptions: {},
			directOptions: {},
			...options
		};

		try {
			// Create standardized event payload
			const eventPayload = createEventPayload(eventType, data, context);

			// Validate payload
			if (!validateEventPayload(eventType, eventPayload.payload)) {
				throw new Error(`Invalid event payload for ${eventType}`);
			}

			this.stats.eventsEmitted++;
			log(
				'debug',
				`Emitting event: ${eventType} with mode: ${emissionOptions.processingMode}`
			);

			// Process through middleware
			let processedPayload = eventPayload.payload;
			for (const middleware of this.middleware) {
				try {
					const result = await middleware(eventType, processedPayload);
					if (result === null || result === false) {
						log('debug', `Event ${eventType} filtered by middleware`);
						return { success: true, reason: 'filtered' };
					}
					if (result) {
						processedPayload = result;
					}
				} catch (error) {
					log(
						'error',
						`Middleware error for event ${eventType}:`,
						error.message
					);
				}
			}

			// Route to appropriate processing mode
			const result = await this._routeEventByMode(
				eventType,
				processedPayload,
				emissionOptions
			);

			this.stats.eventsProcessed++;
			return { success: true, ...result };
		} catch (error) {
			this.stats.eventsFailed++;
			log('error', `Failed to emit event ${eventType}:`, error.message);
			throw error;
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
	 * Get enhanced statistics
	 *
	 * @returns {Object} Statistics object
	 */
	getStats() {
		const baseStats = {
			...this.stats,
			registeredIntegrations: this.integrations.size,
			middlewareCount: this.middleware.length,
			initialized: this.initialized,
			isShuttingDown: this.isShuttingDown
		};

		// Add component stats
		if (this.eventEmitter) {
			baseStats.emitterStats = this.eventEmitter.getStats();
		}

		if (this.eventBus) {
			baseStats.busStats = this.eventBus.getStats();
		}

		if (this.eventQueue) {
			baseStats.queueStats = this.eventQueue.getStats();
		}

		return baseStats;
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
	 * Subscribe to events via the event bus
	 *
	 * @param {string} topic - Topic to subscribe to
	 * @param {Function} handler - Event handler
	 * @param {Object} options - Subscription options
	 * @returns {string} Subscription ID
	 */
	subscribe(topic, handler, options = {}) {
		if (!this.eventBus) {
			throw new Error('Event bus is not enabled');
		}

		return this.eventBus.subscribe(topic, handler, options);
	}

	/**
	 * Unsubscribe from events
	 *
	 * @param {string} subscriptionId - Subscription ID
	 * @returns {boolean} True if unsubscribed
	 */
	unsubscribe(subscriptionId) {
		if (!this.eventBus) {
			return false;
		}

		return this.eventBus.unsubscribe(subscriptionId);
	}

	/**
	 * Publish message to event bus
	 *
	 * @param {string} topic - Topic to publish to
	 * @param {any} message - Message data
	 * @param {Object} options - Publishing options
	 * @returns {Promise<Object>} Publishing results
	 */
	async publish(topic, message, options = {}) {
		if (!this.eventBus) {
			throw new Error('Event bus is not enabled');
		}

		this.stats.busMessagesPublished++;
		return this.eventBus.publish(topic, message, options);
	}

	/**
	 * Add item to event queue
	 *
	 * @param {any} data - Item data
	 * @param {Object} options - Queue options
	 * @returns {Promise<string>} Item ID
	 */
	async queue(data, options = {}) {
		if (!this.eventQueue) {
			throw new Error('Event queue is not enabled');
		}

		return this.eventQueue.push(data, options);
	}

	/**
	 * Register integration based on processing mode
	 *
	 * @param {BaseIntegrationHandler} integration - Integration instance
	 * @param {Object} options - Registration options
	 * @private
	 */
	_registerIntegrationByMode(integration, options) {
		const { processingMode } = options;

		switch (processingMode) {
			case this.processingModes.DIRECT:
				this._registerDirectIntegration(integration, options);
				break;

			case this.processingModes.QUEUED:
				this._registerQueuedIntegration(integration, options);
				break;

			case this.processingModes.BUS:
				this._registerBusIntegration(integration, options);
				break;

			case this.processingModes.HYBRID:
				// Register in multiple modes for flexibility
				this._registerDirectIntegration(integration, options);
				if (this.eventBus && options.enableEventBus) {
					this._registerBusIntegration(integration, options);
				}
				break;

			default:
				log('warn', `Unknown processing mode: ${processingMode}, using direct`);
				this._registerDirectIntegration(integration, options);
		}
	}

	/**
	 * Register integration for direct event handling
	 *
	 * @param {BaseIntegrationHandler} integration - Integration instance
	 * @param {Object} options - Registration options
	 * @private
	 */
	_registerDirectIntegration(integration, options) {
		// Register for all event types the integration can handle
		for (const eventType of Object.values(EVENT_TYPES)) {
			const handlerMethodName = this._getHandlerMethodName(eventType);

			if (
				typeof integration[handlerMethodName] === 'function' ||
				typeof integration.handleGenericEvent === 'function'
			) {
				this.eventEmitter.on(
					eventType,
					async (data, context) => {
						return integration.handleEvent(eventType, data);
					},
					{
						priority: options.priority,
						guaranteed: options.guaranteed || false
					}
				);
			}
		}

		// Also register for wildcard events if integration supports it
		if (typeof integration.handleGenericEvent === 'function') {
			this.eventEmitter.on(
				'*',
				async (data, context) => {
					return integration.handleEvent(context.eventType, data);
				},
				{
					priority: options.priority,
					guaranteed: options.guaranteed || false
				}
			);
		}
	}

	/**
	 * Register integration for queued event handling
	 *
	 * @param {BaseIntegrationHandler} integration - Integration instance
	 * @param {Object} options - Registration options
	 * @private
	 */
	_registerQueuedIntegration(integration, options) {
		if (!this.eventQueue) {
			log(
				'warn',
				'Event queue not enabled, falling back to direct registration'
			);
			this._registerDirectIntegration(integration, options);
			return;
		}

		// Custom processor for this integration
		const processor = async (eventData) => {
			const { eventType, payload } = eventData;
			return integration.handleEvent(eventType, payload);
		};

		// Store processor reference for queue-based processing
		integration._queueProcessor = processor;
		integration._queueOptions = {
			priority: options.priority,
			...options.queueOptions
		};
	}

	/**
	 * Register integration for event bus handling
	 *
	 * @param {BaseIntegrationHandler} integration - Integration instance
	 * @param {Object} options - Registration options
	 * @private
	 */
	_registerBusIntegration(integration, options) {
		if (!this.eventBus) {
			log('warn', 'Event bus not enabled, falling back to direct registration');
			this._registerDirectIntegration(integration, options);
			return;
		}

		const { busChannel, busTopics } = options;

		// Subscribe to specific topics or all events
		const topicsToSubscribe = busTopics.length > 0 ? busTopics : ['*'];

		for (const topic of topicsToSubscribe) {
			this.eventBus.subscribe(
				topic,
				async (messageData, context) => {
					const { eventType, payload } = messageData;
					return integration.handleEvent(
						eventType || context.topic,
						payload || messageData
					);
				},
				{
					channel: busChannel,
					priority: options.priority,
					guaranteed: options.guaranteed || false,
					...options.busOptions
				}
			);
		}
	}

	/**
	 * Route event to appropriate processing mode
	 *
	 * @param {string} eventType - Event type
	 * @param {Object} payload - Event payload
	 * @param {Object} options - Emission options
	 * @returns {Promise<Object>} Processing results
	 * @private
	 */
	async _routeEventByMode(eventType, payload, options) {
		const { processingMode } = options;

		switch (processingMode) {
			case this.processingModes.DIRECT:
				return this._emitDirect(eventType, payload, options.directOptions);

			case this.processingModes.QUEUED:
				return this._emitQueued(eventType, payload, options);

			case this.processingModes.BUS:
				return this._emitToBus(eventType, payload, options);

			case this.processingModes.HYBRID:
				// Emit to both direct and bus systems
				const results = await Promise.allSettled([
					this._emitDirect(eventType, payload, options.directOptions),
					this.eventBus
						? this._emitToBus(eventType, payload, options)
						: Promise.resolve(null)
				]);

				return {
					direct:
						results[0].status === 'fulfilled'
							? results[0].value
							: results[0].reason,
					bus:
						results[1].status === 'fulfilled'
							? results[1].value
							: results[1].reason
				};

			default:
				return this._emitDirect(eventType, payload, options.directOptions);
		}
	}

	/**
	 * Emit event directly to handlers
	 *
	 * @param {string} eventType - Event type
	 * @param {Object} payload - Event payload
	 * @param {Object} options - Direct emission options
	 * @returns {Promise<Object>} Emission results
	 * @private
	 */
	async _emitDirect(eventType, payload, options = {}) {
		return this.eventEmitter.emit(eventType, payload, options);
	}

	/**
	 * Emit event to queue for processing
	 *
	 * @param {string} eventType - Event type
	 * @param {Object} payload - Event payload
	 * @param {Object} options - Queue emission options
	 * @returns {Promise<Object>} Queue results
	 * @private
	 */
	async _emitQueued(eventType, payload, options) {
		if (!this.eventQueue) {
			throw new Error('Event queue is not enabled');
		}

		const queueData = { eventType, payload };

		const itemId = await this.eventQueue.push(queueData, {
			priority: options.priority,
			processor: async (data) => {
				// Find integrations with queue processors for this event
				const results = [];

				for (const integration of this.integrations.values()) {
					if (integration._queueProcessor) {
						try {
							const result = await integration._queueProcessor(data);
							results.push({ integration: integration.getName(), result });
						} catch (error) {
							results.push({
								integration: integration.getName(),
								error: error.message
							});
						}
					}
				}

				return results;
			},
			...options.queueOptions
		});

		return { queueItemId: itemId, mode: 'queued' };
	}

	/**
	 * Emit event to bus
	 *
	 * @param {string} eventType - Event type
	 * @param {Object} payload - Event payload
	 * @param {Object} options - Bus emission options
	 * @returns {Promise<Object>} Bus results
	 * @private
	 */
	async _emitToBus(eventType, payload, options) {
		if (!this.eventBus) {
			throw new Error('Event bus is not enabled');
		}

		return this.eventBus.publish(
			eventType,
			{ eventType, payload },
			{
				channel: options.busChannel,
				guaranteed: options.guaranteed,
				...options.busOptions
			}
		);
	}

	/**
	 * Setup event queue processing handlers
	 *
	 * @private
	 */
	_setupQueueProcessing() {
		this.eventQueue.on('item:completed', (data) => {
			this.stats.queueItemsProcessed++;
			this.stats.handlersExecuted++;
		});

		this.eventQueue.on('item:failed', (data) => {
			this.stats.handlersFailed++;
		});

		this.eventQueue.on('queue:error', (data) => {
			log('error', 'Event queue error:', data.error.message);
		});
	}

	/**
	 * Setup event bus routing handlers
	 *
	 * @private
	 */
	_setupEventBusRouting() {
		// Add routing rule to forward bus messages to integrations
		this.eventBus.addRoutingRule(
			'integration-forward',
			(message) => {
				// Forward all messages that look like integration events
				return message.data && message.data.eventType;
			},
			async (message) => {
				// Additional processing if needed
				log('debug', `Event bus routing: ${message.data.eventType}`);
			}
		);
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
}
