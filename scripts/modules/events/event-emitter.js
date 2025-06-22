/**
 * @fileoverview Enhanced Event Emitter with advanced features
 *
 * This module provides a sophisticated event emitter with features like
 * priorities, filtering, guaranteed delivery, and performance optimization.
 */

import { log } from '../utils.js';
import { validateEventPayload } from './types.js';

/**
 * Enhanced event emitter with advanced subscription and delivery features
 */
export class EventEmitter {
	/**
	 * @param {Object} config - Configuration options
	 */
	constructor(config = {}) {
		this.config = {
			maxListeners: 50,
			enableDeliveryGuarantees: true,
			enablePriorities: true,
			enableFiltering: true,
			deliveryTimeout: 30000,
			retryAttempts: 3,
			retryDelay: 1000,
			...config
		};

		// Event listeners registry
		// Map<eventType, Array<ListenerWrapper>>
		this.listeners = new Map();

		// Event delivery tracking
		this.deliveryTracking = new Map();

		// Statistics
		this.stats = {
			eventsEmitted: 0,
			listenersExecuted: 0,
			deliveryFailures: 0,
			retries: 0
		};

		// Active deliveries for guaranteed delivery
		this.activeDeliveries = new Set();

		// Compiled pattern cache for performance
		this.compiledPatterns = new Map();
	}

	/**
	 * Add an event listener with advanced options
	 *
	 * @param {string} eventType - Event type to listen for
	 * @param {Function} listener - Listener function
	 * @param {Object} options - Listener options
	 * @returns {string} Listener ID for removal
	 */
	on(eventType, listener, options = {}) {
		if (typeof listener !== 'function') {
			throw new Error('Listener must be a function');
		}

		if (!this.listeners.has(eventType)) {
			this.listeners.set(eventType, []);
		}

		const listeners = this.listeners.get(eventType);

		// Check max listeners limit
		if (listeners.length >= this.config.maxListeners) {
			log(
				'warn',
				`Maximum listeners (${this.config.maxListeners}) reached for event type: ${eventType}`
			);
		}

		const listenerId = `${eventType}_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

		const listenerWrapper = {
			id: listenerId,
			listener,
			eventType,
			options: {
				priority: 0, // Higher numbers = higher priority
				filter: null, // Optional filter function
				once: false, // Remove after first execution
				guaranteed: false, // Guaranteed delivery
				timeout: this.config.deliveryTimeout,
				retries: this.config.retryAttempts,
				metadata: {},
				...options
			},
			stats: {
				invocations: 0,
				failures: 0,
				totalExecutionTime: 0
			}
		};

		listeners.push(listenerWrapper);

		// Sort by priority if priorities are enabled
		if (this.config.enablePriorities) {
			listeners.sort((a, b) => b.options.priority - a.options.priority);
		}

		log('debug', `Listener registered for ${eventType} with ID: ${listenerId}`);
		return listenerId;
	}

	/**
	 * Add a one-time event listener
	 *
	 * @param {string} eventType - Event type to listen for
	 * @param {Function} listener - Listener function
	 * @param {Object} options - Listener options
	 * @returns {string} Listener ID
	 */
	once(eventType, listener, options = {}) {
		return this.on(eventType, listener, { ...options, once: true });
	}

	/**
	 * Add a priority listener (executed first)
	 *
	 * @param {string} eventType - Event type to listen for
	 * @param {Function} listener - Listener function
	 * @param {number} priority - Priority level (higher = first)
	 * @param {Object} options - Additional options
	 * @returns {string} Listener ID
	 */
	onPriority(eventType, listener, priority = 10, options = {}) {
		return this.on(eventType, listener, { ...options, priority });
	}

	/**
	 * Add a filtered listener
	 *
	 * @param {string} eventType - Event type to listen for
	 * @param {Function} listener - Listener function
	 * @param {Function} filter - Filter function
	 * @param {Object} options - Additional options
	 * @returns {string} Listener ID
	 */
	onFiltered(eventType, listener, filter, options = {}) {
		return this.on(eventType, listener, { ...options, filter });
	}

	/**
	 * Add a guaranteed delivery listener
	 *
	 * @param {string} eventType - Event type to listen for
	 * @param {Function} listener - Listener function
	 * @param {Object} options - Additional options
	 * @returns {string} Listener ID
	 */
	onGuaranteed(eventType, listener, options = {}) {
		return this.on(eventType, listener, { ...options, guaranteed: true });
	}

	/**
	 * Remove an event listener
	 *
	 * @param {string} listenerId - Listener ID to remove
	 * @returns {boolean} True if listener was removed
	 */
	off(listenerId) {
		for (const [eventType, listeners] of this.listeners.entries()) {
			const index = listeners.findIndex((wrapper) => wrapper.id === listenerId);
			if (index !== -1) {
				listeners.splice(index, 1);

				// Clean up empty event types
				if (listeners.length === 0) {
					this.listeners.delete(eventType);
				}

				log('debug', `Listener ${listenerId} removed from ${eventType}`);
				return true;
			}
		}

		return false;
	}

	/**
	 * Remove all listeners for an event type
	 *
	 * @param {string} eventType - Event type to clear
	 * @returns {number} Number of listeners removed
	 */
	removeAllListeners(eventType) {
		if (!this.listeners.has(eventType)) {
			return 0;
		}

		const count = this.listeners.get(eventType).length;
		this.listeners.delete(eventType);

		log('debug', `Removed ${count} listeners for ${eventType}`);
		return count;
	}

	/**
	 * Emit an event to all registered listeners
	 *
	 * @param {string} eventType - Event type to emit
	 * @param {any} data - Event data
	 * @param {Object} options - Emission options
	 * @returns {Promise<Object>} Emission results
	 */
	async emit(eventType, data, options = {}) {
		const emissionId = `emit_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

		const emissionOptions = {
			guaranteed: false,
			timeout: this.config.deliveryTimeout,
			parallel: true, // Execute listeners in parallel vs sequential
			validatePayload: true,
			...options
		};

		this.stats.eventsEmitted++;

		// Validate payload if requested
		if (emissionOptions.validatePayload) {
			const payload = { data, timestamp: new Date().toISOString() };
			if (!validateEventPayload(eventType, payload)) {
				throw new Error(`Invalid event payload for ${eventType}`);
			}
		}

		const listeners = this._getListeners(eventType);

		if (listeners.length === 0) {
			log('debug', `No listeners found for event type: ${eventType}`);
			return {
				emissionId,
				eventType,
				listenersExecuted: 0,
				results: [],
				failures: [],
				success: true
			};
		}

		log('debug', `Emitting ${eventType} to ${listeners.length} listeners`);

		// Filter listeners based on their filter functions
		const filteredListeners = this.config.enableFiltering
			? listeners.filter((wrapper) =>
					this._shouldExecuteListener(wrapper, data)
				)
			: listeners;

		// Execute listeners
		const results = emissionOptions.parallel
			? await this._executeListenersParallel(
					filteredListeners,
					eventType,
					data,
					emissionOptions
				)
			: await this._executeListenersSequential(
					filteredListeners,
					eventType,
					data,
					emissionOptions
				);

		// Handle guaranteed delivery tracking
		if (emissionOptions.guaranteed) {
			this._trackGuaranteedDelivery(emissionId, eventType, data, results);
		}

		// Remove one-time listeners
		this._removeOnceListeners(filteredListeners);

		return {
			emissionId,
			eventType,
			listenersExecuted: filteredListeners.length,
			results: results.successes,
			failures: results.failures,
			success: results.failures.length === 0
		};
	}

	/**
	 * Emit an event with guaranteed delivery
	 *
	 * @param {string} eventType - Event type to emit
	 * @param {any} data - Event data
	 * @param {Object} options - Emission options
	 * @returns {Promise<Object>} Emission results
	 */
	async emitGuaranteed(eventType, data, options = {}) {
		return this.emit(eventType, data, { ...options, guaranteed: true });
	}

	/**
	 * Get listeners for an event type (including wildcard matches)
	 *
	 * @param {string} eventType - Event type
	 * @returns {Array} Array of listener wrappers
	 * @private
	 */
	_getListeners(eventType) {
		const listeners = [];

		// Direct listeners
		if (this.listeners.has(eventType)) {
			listeners.push(...this.listeners.get(eventType));
		}

		// Wildcard listeners
		if (this.listeners.has('*')) {
			listeners.push(...this.listeners.get('*'));
		}

		// Pattern matching
		for (const [pattern, patternListeners] of this.listeners.entries()) {
			if (pattern.includes('*') && pattern !== '*') {
				let regex = this.compiledPatterns.get(pattern);
				if (!regex) {
					regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
					this.compiledPatterns.set(pattern, regex);
				}
				if (regex.test(eventType)) {
					listeners.push(...patternListeners);
				}
			}
		}

		return listeners;
	}

	/**
	 * Check if a listener should be executed based on its filter
	 *
	 * @param {Object} listenerWrapper - Listener wrapper
	 * @param {any} data - Event data
	 * @returns {boolean} True if should execute
	 * @private
	 */
	_shouldExecuteListener(listenerWrapper, data) {
		if (!listenerWrapper.options.filter) {
			return true;
		}

		try {
			return listenerWrapper.options.filter(data);
		} catch (error) {
			log(
				'warn',
				`Filter function failed for listener ${listenerWrapper.id}:`,
				error.message
			);
			return false;
		}
	}

	/**
	 * Execute listeners in parallel
	 *
	 * @param {Array} listeners - Listener wrappers
	 * @param {string} eventType - Event type
	 * @param {any} data - Event data
	 * @param {Object} options - Execution options
	 * @returns {Promise<Object>} Execution results
	 * @private
	 */
	async _executeListenersParallel(listeners, eventType, data, options) {
		const promises = listeners.map((wrapper) =>
			this._executeListener(wrapper, eventType, data, options)
		);

		const results = await Promise.allSettled(promises);

		const successes = [];
		const failures = [];

		results.forEach((result, index) => {
			const wrapper = listeners[index];

			if (result.status === 'fulfilled') {
				successes.push({
					listenerId: wrapper.id,
					result: result.value,
					executionTime: wrapper.stats.lastExecutionTime
				});
				this.stats.listenersExecuted++;
			} else {
				failures.push({
					listenerId: wrapper.id,
					error: result.reason,
					executionTime: wrapper.stats.lastExecutionTime
				});
				wrapper.stats.failures++;
				this.stats.deliveryFailures++;
			}
		});

		return { successes, failures };
	}

	/**
	 * Execute listeners sequentially
	 *
	 * @param {Array} listeners - Listener wrappers
	 * @param {string} eventType - Event type
	 * @param {any} data - Event data
	 * @param {Object} options - Execution options
	 * @returns {Promise<Object>} Execution results
	 * @private
	 */
	async _executeListenersSequential(listeners, eventType, data, options) {
		const successes = [];
		const failures = [];

		for (const wrapper of listeners) {
			try {
				const result = await this._executeListener(
					wrapper,
					eventType,
					data,
					options
				);

				successes.push({
					listenerId: wrapper.id,
					result,
					executionTime: wrapper.stats.lastExecutionTime
				});
				this.stats.listenersExecuted++;
			} catch (error) {
				failures.push({
					listenerId: wrapper.id,
					error,
					executionTime: wrapper.stats.lastExecutionTime
				});
				wrapper.stats.failures++;
				this.stats.deliveryFailures++;
			}
		}

		return { successes, failures };
	}

	/**
	 * Execute a single listener with retry logic
	 *
	 * @param {Object} wrapper - Listener wrapper
	 * @param {string} eventType - Event type
	 * @param {any} data - Event data
	 * @param {Object} options - Execution options
	 * @returns {Promise<any>} Listener result
	 * @private
	 */
	async _executeListener(wrapper, eventType, data, options) {
		const startTime = Date.now();
		let lastError;

		const maxRetries = wrapper.options.retries;
		const timeout = wrapper.options.timeout;

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				// Execute with timeout
				let timeoutId;
				const result = await Promise.race([
					wrapper.listener(data, { eventType, listenerId: wrapper.id }),
					new Promise((_, reject) => {
						timeoutId = setTimeout(
							() => reject(new Error(`Listener timeout after ${timeout}ms`)),
							timeout
						);
					})
				]);

				if (timeoutId) {
					clearTimeout(timeoutId);
				}

				// Success
				const executionTime = Date.now() - startTime;
				wrapper.stats.invocations++;
				wrapper.stats.totalExecutionTime += executionTime;
				wrapper.stats.lastExecutionTime = executionTime;

				if (attempt > 0) {
					log(
						'debug',
						`Listener ${wrapper.id} succeeded after ${attempt} retries`
					);
				}

				return result;
			} catch (error) {
				lastError = error;

				if (attempt < maxRetries) {
					this.stats.retries++;
					log(
						'warn',
						`Listener ${wrapper.id} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying:`,
						error.message
					);

					// Wait before retry
					if (this.config.retryDelay > 0) {
						await new Promise((resolve) =>
							setTimeout(resolve, this.config.retryDelay)
						);
					}
				}
			}
		}

		// All retries exhausted
		const executionTime = Date.now() - startTime;
		wrapper.stats.lastExecutionTime = executionTime;
		throw lastError;
	}

	/**
	 * Track guaranteed delivery for important events
	 *
	 * @param {string} emissionId - Emission ID
	 * @param {string} eventType - Event type
	 * @param {any} data - Event data
	 * @param {Object} results - Execution results
	 * @private
	 */
	_trackGuaranteedDelivery(emissionId, eventType, data, results) {
		if (!this.config.enableDeliveryGuarantees) {
			return;
		}

		if (results.failures.length > 0) {
			// Store failed deliveries for retry
			this.deliveryTracking.set(emissionId, {
				eventType,
				data,
				failures: results.failures,
				timestamp: Date.now(),
				retries: 0
			});

			this.activeDeliveries.add(emissionId);

			log(
				'warn',
				`Guaranteed delivery tracking ${results.failures.length} failures for emission ${emissionId}`
			);
		}
	}

	/**
	 * Remove one-time listeners after execution
	 *
	 * @param {Array} listeners - Executed listeners
	 * @private
	 */
	_removeOnceListeners(listeners) {
		for (const wrapper of listeners) {
			if (wrapper.options.once) {
				this.off(wrapper.id);
			}
		}
	}

	/**
	 * Get statistics about the event emitter
	 *
	 * @returns {Object} Statistics object
	 */
	getStats() {
		return {
			...this.stats,
			totalListeners: Array.from(this.listeners.values()).reduce(
				(total, listeners) => total + listeners.length,
				0
			),
			eventTypes: this.listeners.size,
			activeDeliveries: this.activeDeliveries.size,
			pendingRetries: this.deliveryTracking.size
		};
	}

	/**
	 * Get detailed listener information
	 *
	 * @returns {Object} Listener details
	 */
	getListenerDetails() {
		const details = {};

		for (const [eventType, listeners] of this.listeners.entries()) {
			details[eventType] = listeners.map((wrapper) => ({
				id: wrapper.id,
				priority: wrapper.options.priority,
				hasFilter: !!wrapper.options.filter,
				once: wrapper.options.once,
				guaranteed: wrapper.options.guaranteed,
				stats: wrapper.stats
			}));
		}

		return details;
	}

	/**
	 * Retry failed guaranteed deliveries
	 *
	 * @returns {Promise<number>} Number of retries attempted
	 */
	async retryFailedDeliveries() {
		if (!this.config.enableDeliveryGuarantees) {
			return 0;
		}

		let retryCount = 0;
		const toRetry = [];

		// Collect deliveries that need retry
		for (const [emissionId, delivery] of this.deliveryTracking.entries()) {
			if (delivery.retries < this.config.retryAttempts) {
				toRetry.push({ emissionId, delivery });
			} else {
				// Exhausted retries, remove from tracking
				this.deliveryTracking.delete(emissionId);
				this.activeDeliveries.delete(emissionId);
				log(
					'error',
					`Guaranteed delivery failed permanently for emission ${emissionId}`
				);
			}
		}

		// Retry deliveries
		for (const { emissionId, delivery } of toRetry) {
			try {
				delivery.retries++;
				log(
					'debug',
					`Retrying guaranteed delivery for emission ${emissionId} (attempt ${delivery.retries})`
				);

				// Retry without guaranteed delivery to avoid recursion
				const result = await this.emit(delivery.eventType, delivery.data, {
					guaranteed: false
				});

				if (result.success) {
					this.deliveryTracking.delete(emissionId);
					this.activeDeliveries.delete(emissionId);
					log(
						'info',
						`Guaranteed delivery succeeded on retry for emission ${emissionId}`
					);
				}

				retryCount++;
			} catch (error) {
				log(
					'error',
					`Retry failed for guaranteed delivery ${emissionId}:`,
					error.message
				);
			}
		}

		return retryCount;
	}

	/**
	 * Clear all listeners and reset state
	 */
	clear() {
		this.listeners.clear();
		this.deliveryTracking.clear();
		this.activeDeliveries.clear();
		this.compiledPatterns.clear();

		this.stats = {
			eventsEmitted: 0,
			listenersExecuted: 0,
			deliveryFailures: 0,
			retries: 0
		};

		log('debug', 'Event emitter cleared');
	}
}
