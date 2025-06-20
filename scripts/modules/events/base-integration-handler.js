/**
 * @fileoverview Base integration handler abstract class
 *
 * This module provides the base class that all integration handlers must extend.
 * It includes common functionality like retry logic, error handling, and lifecycle management.
 */

import { log } from '../utils.js';
import { DEFAULT_CONFIG } from './types.js';

/**
 * Abstract base class for all integration handlers
 *
 * Integration handlers are responsible for processing events and performing
 * actions in external systems (like Linear, Slack, etc.)
 *
 * @abstract
 */
export class BaseIntegrationHandler {
	/**
	 * @param {string} name - The integration name
	 * @param {string} version - The integration version
	 * @param {Object} config - Integration configuration
	 */
	constructor(name, version, config = {}) {
		if (this.constructor === BaseIntegrationHandler) {
			throw new Error(
				'BaseIntegrationHandler is abstract and cannot be instantiated directly'
			);
		}

		this.name = name;
		this.version = version;
		this.config = {
			...DEFAULT_CONFIG.retry,
			timeout: 30000,
			enabled: true,
			...config
		};

		this.initialized = false;
		this.isShuttingDown = false;
		this.activeOperations = new Set();

		// Bind methods to preserve context
		this.handleEvent = this.handleEvent.bind(this);
		this.retry = this.retry.bind(this);
	}

	/**
	 * Get the integration name
	 * @returns {string} Integration name
	 */
	getName() {
		return this.name;
	}

	/**
	 * Get the integration version
	 * @returns {string} Integration version
	 */
	getVersion() {
		return this.version;
	}

	/**
	 * Get the integration configuration
	 * @returns {Object} Configuration object
	 */
	getConfig() {
		return { ...this.config };
	}

	/**
	 * Check if the integration is enabled
	 * @returns {boolean} True if enabled
	 */
	isEnabled() {
		return this.config.enabled && this.initialized;
	}

	/**
	 * Initialize the integration handler
	 *
	 * This method should be overridden by subclasses to perform
	 * any necessary setup (e.g., establishing connections, validating config)
	 *
	 * @abstract
	 * @param {Object} config - Configuration object
	 * @returns {Promise<void>}
	 */
	async initialize(config = {}) {
		if (this.initialized) {
			log('warn', `Integration ${this.name} is already initialized`);
			return;
		}

		this.config = { ...this.config, ...config };

		try {
			await this._performInitialization(config);
			this.initialized = true;
			log(
				'info',
				`Integration ${this.name} v${this.version} initialized successfully`
			);
		} catch (error) {
			log(
				'error',
				`Failed to initialize integration ${this.name}:`,
				error.message
			);
			throw new Error(`Integration initialization failed: ${error.message}`);
		}
	}

	/**
	 * Shutdown the integration handler
	 *
	 * This method should be overridden by subclasses to perform
	 * any necessary cleanup (e.g., closing connections, saving state)
	 *
	 * @abstract
	 * @returns {Promise<void>}
	 */
	async shutdown() {
		if (!this.initialized || this.isShuttingDown) {
			return;
		}

		this.isShuttingDown = true;

		try {
			// Wait for active operations to complete (with timeout)
			const shutdownTimeout = this.config.timeout || 30000;
			const startTime = Date.now();

			while (
				this.activeOperations.size > 0 &&
				Date.now() - startTime < shutdownTimeout
			) {
				await new Promise((resolve) => setTimeout(resolve, 100));
			}

			if (this.activeOperations.size > 0) {
				log(
					'warn',
					`Integration ${this.name} shutdown with ${this.activeOperations.size} active operations`
				);
			}

			await this._performShutdown();
			this.initialized = false;
			log('info', `Integration ${this.name} shutdown completed`);
		} catch (error) {
			log(
				'error',
				`Error during integration ${this.name} shutdown:`,
				error.message
			);
		} finally {
			this.isShuttingDown = false;
		}
	}

	/**
	 * Handle an event
	 *
	 * This is the main entry point for event processing. It routes events
	 * to the appropriate handler methods and manages error handling.
	 *
	 * @param {string} eventType - The event type
	 * @param {Object} payload - The event payload
	 * @returns {Promise<any>} Handler result
	 */
	async handleEvent(eventType, payload) {
		if (!this.isEnabled()) {
			log(
				'debug',
				`Integration ${this.name} is disabled, skipping event ${eventType}`
			);
			return null;
		}

		if (this.isShuttingDown) {
			log(
				'warn',
				`Integration ${this.name} is shutting down, rejecting event ${eventType}`
			);
			throw new Error('Integration is shutting down');
		}

		const operationId = `${eventType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		this.activeOperations.add(operationId);

		try {
			log('debug', `Integration ${this.name} handling event ${eventType}`);

			const result = await this.retry(async () => {
				return await this._routeEvent(eventType, payload);
			}, this.config);

			log(
				'debug',
				`Integration ${this.name} successfully handled event ${eventType}`
			);
			return result;
		} catch (error) {
			log(
				'error',
				`Integration ${this.name} failed to handle event ${eventType}:`,
				error.message
			);
			throw error;
		} finally {
			this.activeOperations.delete(operationId);
		}
	}

	/**
	 * Retry an operation with configurable backoff
	 *
	 * @param {Function} operation - The operation to retry
	 * @param {Object} retryConfig - Retry configuration
	 * @returns {Promise<any>} Operation result
	 */
	async retry(operation, retryConfig = {}) {
		const config = { ...DEFAULT_CONFIG.retry, ...retryConfig };
		let lastError;

		for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
			try {
				return await operation();
			} catch (error) {
				lastError = error;

				// Check if error is retryable
				if (!this._isRetryableError(error, config)) {
					throw error;
				}

				// Don't retry on last attempt
				if (attempt === config.maxAttempts) {
					break;
				}

				const delay = this._calculateDelay(attempt, config);
				log(
					'warn',
					`Integration ${this.name} operation failed (attempt ${attempt}/${config.maxAttempts}), retrying in ${delay}ms:`,
					error.message
				);

				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}

		throw lastError;
	}

	/**
	 * Perform integration-specific initialization
	 *
	 * Subclasses should override this method to implement their
	 * specific initialization logic.
	 *
	 * @abstract
	 * @param {Object} config - Configuration object
	 * @returns {Promise<void>}
	 * @protected
	 */
	async _performInitialization(config) {
		// Default implementation does nothing
		// Subclasses should override this method
	}

	/**
	 * Perform integration-specific shutdown
	 *
	 * Subclasses should override this method to implement their
	 * specific cleanup logic.
	 *
	 * @abstract
	 * @returns {Promise<void>}
	 * @protected
	 */
	async _performShutdown() {
		// Default implementation does nothing
		// Subclasses should override this method
	}

	/**
	 * Route events to specific handler methods
	 *
	 * Subclasses should override this method to implement their
	 * event routing logic.
	 *
	 * @abstract
	 * @param {string} eventType - The event type
	 * @param {Object} payload - The event payload
	 * @returns {Promise<any>} Handler result
	 * @protected
	 */
	async _routeEvent(eventType, payload) {
		// Default implementation looks for handler methods
		const handlerMethodName = this._getHandlerMethodName(eventType);

		if (typeof this[handlerMethodName] === 'function') {
			return await this[handlerMethodName](payload);
		}

		// If no specific handler, check for a generic handler
		if (typeof this.handleGenericEvent === 'function') {
			return await this.handleGenericEvent(eventType, payload);
		}

		log(
			'debug',
			`Integration ${this.name} has no handler for event type ${eventType}`
		);
		return null;
	}

	/**
	 * Convert event type to handler method name
	 *
	 * @param {string} eventType - Event type (e.g., 'task:created')
	 * @returns {string} Method name (e.g., 'handleTaskCreated')
	 * @private
	 */
	_getHandlerMethodName(eventType) {
		// Convert 'task:created' to 'handleTaskCreated'
		return (
			'handle' +
			eventType
				.split(':')
				.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
				.join('')
		);
	}

	/**
	 * Check if an error is retryable
	 *
	 * @param {Error} error - The error to check
	 * @param {Object} config - Retry configuration
	 * @returns {boolean} True if retryable
	 * @private
	 */
	_isRetryableError(error, config) {
		if (!config.retryableErrors || !Array.isArray(config.retryableErrors)) {
			return false;
		}

		// Check error code or message against retryable errors
		return config.retryableErrors.some((retryableError) => {
			return (
				error.code === retryableError ||
				error.message.includes(retryableError) ||
				error.name === retryableError
			);
		});
	}

	/**
	 * Calculate retry delay based on backoff strategy
	 *
	 * @param {number} attempt - Current attempt number (1-based)
	 * @param {Object} config - Retry configuration
	 * @returns {number} Delay in milliseconds
	 * @private
	 */
	_calculateDelay(attempt, config) {
		let delay;

		switch (config.backoffStrategy) {
			case 'exponential':
				delay = config.baseDelay * Math.pow(2, attempt - 1);
				break;
			case 'linear':
				delay = config.baseDelay * attempt;
				break;
			case 'fixed':
			default:
				delay = config.baseDelay;
				break;
		}

		// Apply jitter to prevent thundering herd
		delay = delay + Math.random() * 0.1 * delay;

		// Ensure delay doesn't exceed maximum
		return Math.min(delay, config.maxDelay);
	}

	/**
	 * Get handler status information
	 *
	 * @returns {Object} Status information
	 */
	getStatus() {
		return {
			name: this.name,
			version: this.version,
			initialized: this.initialized,
			enabled: this.isEnabled(),
			isShuttingDown: this.isShuttingDown,
			activeOperations: this.activeOperations.size,
			config: this.getConfig()
		};
	}

	/**
	 * Validate handler configuration
	 *
	 * Subclasses can override this method to implement their
	 * specific configuration validation.
	 *
	 * @param {Object} config - Configuration to validate
	 * @returns {Object} Validation result { valid: boolean, errors: string[] }
	 */
	validateConfig(config) {
		const errors = [];

		if (
			config.timeout &&
			(typeof config.timeout !== 'number' || config.timeout <= 0)
		) {
			errors.push('Timeout must be a positive number');
		}

		if (config.enabled !== undefined && typeof config.enabled !== 'boolean') {
			errors.push('Enabled must be a boolean');
		}

		return {
			valid: errors.length === 0,
			errors
		};
	}
}
