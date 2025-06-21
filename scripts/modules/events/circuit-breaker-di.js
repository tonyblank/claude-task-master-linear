/**
 * @fileoverview Circuit Breaker Pattern Implementation with Dependency Injection
 *
 * Refactored version that uses dependency injection for better testability
 * and loose coupling between modules.
 */

/**
 * Circuit breaker states
 */
export const CIRCUIT_STATE = {
	CLOSED: 'closed', // Normal operation, calls allowed
	OPEN: 'open', // Circuit is open, calls blocked
	HALF_OPEN: 'half_open' // Testing if service has recovered
};

/**
 * Circuit breaker implementation for integration fault tolerance
 * Uses dependency injection for better testability
 */
export class CircuitBreaker {
	/**
	 * @param {Object} config - Configuration options
	 * @param {Object} dependencies - Injected dependencies
	 * @param {Object} dependencies.logger - Logger implementation
	 * @param {Object} dependencies.timer - Timer implementation
	 */
	constructor(config = {}, dependencies = {}) {
		// Inject dependencies with fallbacks
		this.logger = dependencies.logger || this._createDefaultLogger();
		this.timer = dependencies.timer || this._createDefaultTimer();

		this.config = {
			failureThreshold: 5, // Number of failures before opening
			successThreshold: 3, // Number of successes needed to close from half-open
			timeout: 60000, // Time to wait before trying half-open (ms)
			monitoringPeriod: 60000, // Rolling window for failure counting (ms)
			slowCallThreshold: 10000, // Calls slower than this are considered failures (ms)
			slowCallRateThreshold: 0.5, // Percentage of slow calls that trigger opening
			minimumThroughput: 10, // Minimum calls before evaluating failure rate
			...config
		};

		this.state = CIRCUIT_STATE.CLOSED;
		this.failureCount = 0;
		this.successCount = 0;
		this.nextAttempt = 0;
		this.lastFailureTime = 0;

		// Rolling window for tracking calls
		this.calls = [];
		this.slowCalls = 0;

		// Statistics
		this.stats = {
			totalCalls: 0,
			successfulCalls: 0,
			failedCalls: 0,
			rejectedCalls: 0,
			slowCalls: 0,
			stateChanges: 0,
			lastStateChange: null,
			averageResponseTime: 0,
			totalResponseTime: 0
		};

		// Event handlers
		this.eventHandlers = {
			'state:changed': [],
			'call:success': [],
			'call:failure': [],
			'call:rejected': [],
			'call:timeout': []
		};

		// Bind methods
		this.execute = this.execute.bind(this);
		this._recordCall = this._recordCall.bind(this);
	}

	/**
	 * Execute a function with circuit breaker protection
	 *
	 * @param {Function} fn - Function to execute
	 * @param {Array} args - Arguments to pass to function
	 * @param {Object} options - Execution options
	 * @returns {Promise<any>} Function result
	 */
	async execute(fn, args = [], options = {}) {
		const callOptions = {
			timeout: this.config.slowCallThreshold,
			...options
		};

		this.stats.totalCalls++;

		// Check if circuit is open
		if (this.state === CIRCUIT_STATE.OPEN) {
			if (this.timer.now() < this.nextAttempt) {
				this.stats.rejectedCalls++;
				this._emitEvent('call:rejected', {
					reason: 'circuit_open',
					state: this.state,
					nextAttempt: this.nextAttempt
				});
				throw new CircuitBreakerError(
					'Circuit breaker is OPEN',
					'CIRCUIT_OPEN'
				);
			} else {
				// Transition to half-open to test the service
				this._changeState(CIRCUIT_STATE.HALF_OPEN);
			}
		}

		const startTime = this.timer.now();

		try {
			// Execute the function with timeout
			const result = await this._executeWithTimeout(
				fn,
				args,
				callOptions.timeout
			);
			const responseTime = this.timer.now() - startTime;

			// Record successful call
			this._recordCall(true, responseTime);
			this.stats.successfulCalls++;
			this.stats.totalResponseTime += responseTime;
			this.stats.averageResponseTime =
				this.stats.totalResponseTime / this.stats.successfulCalls;

			this._emitEvent('call:success', {
				responseTime,
				state: this.state
			});

			// Handle state transitions for successful calls
			this._handleSuccess();

			return result;
		} catch (error) {
			const responseTime = this.timer.now() - startTime;

			// Determine if this was a timeout or regular failure
			const isTimeout = error.message && error.message.includes('timeout');

			this._recordCall(false, responseTime, isTimeout);
			this.stats.failedCalls++;

			this._emitEvent(isTimeout ? 'call:timeout' : 'call:failure', {
				error: error.message,
				responseTime,
				state: this.state,
				isTimeout
			});

			// Handle state transitions for failed calls
			this._handleFailure();

			throw error;
		}
	}

	/**
	 * Get current circuit breaker status
	 *
	 * @returns {Object} Status information
	 */
	getStatus() {
		this._cleanupOldCalls();

		const now = this.timer.now();
		const recentCalls = this.calls.filter(
			(call) => now - call.timestamp <= this.config.monitoringPeriod
		);

		const failureRate =
			recentCalls.length > 0
				? recentCalls.filter((call) => !call.success).length /
					recentCalls.length
				: 0;

		const slowCallRate =
			recentCalls.length > 0
				? recentCalls.filter((call) => call.slow).length / recentCalls.length
				: 0;

		return {
			state: this.state,
			failureCount: this.failureCount,
			successCount: this.successCount,
			nextAttemptIn: Math.max(0, this.nextAttempt - now),
			stats: { ...this.stats },
			metrics: {
				recentCalls: recentCalls.length,
				failureRate: Math.round(failureRate * 100),
				slowCallRate: Math.round(slowCallRate * 100),
				isHealthy: this._isHealthy(),
				timeInCurrentState: now - (this.stats.lastStateChange || now)
			}
		};
	}

	/**
	 * Force the circuit breaker to a specific state
	 *
	 * @param {string} state - State to force
	 * @param {string} reason - Reason for forcing state
	 */
	forceState(state, reason = 'manual') {
		if (!Object.values(CIRCUIT_STATE).includes(state)) {
			throw new Error(`Invalid circuit breaker state: ${state}`);
		}

		this.logger.warn(
			`Circuit breaker force state change to ${state}: ${reason}`
		);
		this._changeState(state);
	}

	/**
	 * Reset circuit breaker to initial state
	 */
	reset() {
		this.state = CIRCUIT_STATE.CLOSED;
		this.failureCount = 0;
		this.successCount = 0;
		this.nextAttempt = 0;
		this.lastFailureTime = 0;
		this.calls = [];
		this.slowCalls = 0;

		// Reset stats but keep historical data
		this.stats.stateChanges++;
		this.stats.lastStateChange = this.timer.now();

		this.logger.info('Circuit breaker reset to CLOSED state');
		this._emitEvent('state:changed', {
			from: this.state,
			to: CIRCUIT_STATE.CLOSED,
			reason: 'reset'
		});
	}

	/**
	 * Add event listener
	 *
	 * @param {string} eventType - Event type
	 * @param {Function} handler - Event handler
	 */
	on(eventType, handler) {
		if (!this.eventHandlers[eventType]) {
			this.eventHandlers[eventType] = [];
		}
		this.eventHandlers[eventType].push(handler);
	}

	/**
	 * Remove event listener
	 *
	 * @param {string} eventType - Event type
	 * @param {Function} handler - Event handler
	 */
	off(eventType, handler) {
		if (!this.eventHandlers[eventType]) {
			return;
		}

		const index = this.eventHandlers[eventType].indexOf(handler);
		if (index !== -1) {
			this.eventHandlers[eventType].splice(index, 1);
		}
	}

	/**
	 * Execute function with timeout
	 *
	 * @param {Function} fn - Function to execute
	 * @param {Array} args - Function arguments
	 * @param {number} timeout - Timeout in milliseconds
	 * @returns {Promise<any>} Function result
	 * @private
	 */
	async _executeWithTimeout(fn, args, timeout) {
		return Promise.race([
			fn(...args),
			new Promise((_, reject) =>
				this.timer.setTimeout(
					() => reject(new Error(`Operation timeout after ${timeout}ms`)),
					timeout
				)
			)
		]);
	}

	/**
	 * Record a call result
	 *
	 * @param {boolean} success - Whether call was successful
	 * @param {number} responseTime - Response time in milliseconds
	 * @param {boolean} isTimeout - Whether call timed out
	 * @private
	 */
	_recordCall(success, responseTime, isTimeout = false) {
		const now = this.timer.now();
		const slow = responseTime > this.config.slowCallThreshold;

		this.calls.push({
			timestamp: now,
			success,
			responseTime,
			slow,
			isTimeout
		});

		if (slow) {
			this.slowCalls++;
			this.stats.slowCalls++;
		}

		// Clean up old calls periodically
		if (this.calls.length % 100 === 0) {
			this._cleanupOldCalls();
		}
	}

	/**
	 * Handle successful call
	 *
	 * @private
	 */
	_handleSuccess() {
		this.failureCount = 0;

		if (this.state === CIRCUIT_STATE.HALF_OPEN) {
			this.successCount++;
			if (this.successCount >= this.config.successThreshold) {
				this._changeState(CIRCUIT_STATE.CLOSED);
				this.successCount = 0;
			}
		}
	}

	/**
	 * Handle failed call
	 *
	 * @private
	 */
	_handleFailure() {
		this.lastFailureTime = this.timer.now();
		this.successCount = 0;

		if (this.state === CIRCUIT_STATE.HALF_OPEN) {
			// Immediately open on failure in half-open state
			this._changeState(CIRCUIT_STATE.OPEN);
			return;
		}

		if (this.state === CIRCUIT_STATE.CLOSED) {
			this.failureCount++;

			// Check if we should open the circuit
			if (this._shouldOpenCircuit()) {
				this._changeState(CIRCUIT_STATE.OPEN);
			}
		}
	}

	/**
	 * Determine if circuit should be opened
	 *
	 * @returns {boolean} True if circuit should be opened
	 * @private
	 */
	_shouldOpenCircuit() {
		this._cleanupOldCalls();

		const now = this.timer.now();
		const recentCalls = this.calls.filter(
			(call) => now - call.timestamp <= this.config.monitoringPeriod
		);

		// Need minimum throughput to make decision
		if (recentCalls.length < this.config.minimumThroughput) {
			return false;
		}

		// Check failure threshold
		if (this.failureCount >= this.config.failureThreshold) {
			return true;
		}

		// Check failure rate
		const failures = recentCalls.filter((call) => !call.success).length;
		const failureRate = failures / recentCalls.length;

		if (failureRate >= 0.5 && failures >= this.config.failureThreshold) {
			return true;
		}

		// Check slow call rate
		const slowCalls = recentCalls.filter((call) => call.slow).length;
		const slowCallRate = slowCalls / recentCalls.length;

		if (slowCallRate >= this.config.slowCallRateThreshold) {
			return true;
		}

		return false;
	}

	/**
	 * Change circuit breaker state
	 *
	 * @param {string} newState - New state
	 * @private
	 */
	_changeState(newState) {
		const oldState = this.state;
		this.state = newState;
		this.stats.stateChanges++;
		this.stats.lastStateChange = this.timer.now();

		if (newState === CIRCUIT_STATE.OPEN) {
			this.nextAttempt = this.timer.now() + this.config.timeout;
			this.successCount = 0;
		} else if (newState === CIRCUIT_STATE.CLOSED) {
			this.failureCount = 0;
			this.successCount = 0;
		}

		this.logger.info(
			`Circuit breaker state changed: ${oldState} -> ${newState}`
		);

		this._emitEvent('state:changed', {
			from: oldState,
			to: newState,
			timestamp: this.timer.now()
		});
	}

	/**
	 * Check if circuit is healthy
	 *
	 * @returns {boolean} True if healthy
	 * @private
	 */
	_isHealthy() {
		if (this.state === CIRCUIT_STATE.OPEN) {
			return false;
		}

		this._cleanupOldCalls();

		const now = this.timer.now();
		const recentCalls = this.calls.filter(
			(call) => now - call.timestamp <= this.config.monitoringPeriod
		);

		if (recentCalls.length === 0) {
			return true; // No recent calls, assume healthy
		}

		const failures = recentCalls.filter((call) => !call.success).length;
		const failureRate = failures / recentCalls.length;

		return failureRate < 0.5 && failures < this.config.failureThreshold;
	}

	/**
	 * Clean up old call records
	 *
	 * @private
	 */
	_cleanupOldCalls() {
		const cutoff = this.timer.now() - this.config.monitoringPeriod;
		this.calls = this.calls.filter((call) => call.timestamp > cutoff);
	}

	/**
	 * Emit event to listeners
	 *
	 * @param {string} eventType - Event type
	 * @param {any} data - Event data
	 * @private
	 */
	_emitEvent(eventType, data) {
		const handlers = this.eventHandlers[eventType] || [];

		for (const handler of handlers) {
			try {
				handler(data);
			} catch (error) {
				this.logger.error(
					`Circuit breaker event handler failed for ${eventType}:`,
					error.message
				);
			}
		}
	}

	/**
	 * Create default logger implementation
	 * @returns {Object} Logger implementation
	 * @private
	 */
	_createDefaultLogger() {
		return {
			log: (...args) => console.log(...args),
			error: (...args) => console.error(...args),
			warn: (...args) => console.warn(...args),
			info: (...args) => console.info(...args),
			debug: (...args) => console.debug(...args)
		};
	}

	/**
	 * Create default timer implementation
	 * @returns {Object} Timer implementation
	 * @private
	 */
	_createDefaultTimer() {
		return {
			setTimeout: (fn, delay) => setTimeout(fn, delay),
			clearTimeout: (id) => clearTimeout(id),
			now: () => Date.now()
		};
	}
}

/**
 * Circuit breaker specific error
 */
export class CircuitBreakerError extends Error {
	constructor(message, code) {
		super(message);
		this.name = 'CircuitBreakerError';
		this.code = code;
	}
}

/**
 * Circuit breaker registry for managing multiple breakers
 * Uses dependency injection for better testability
 */
export class CircuitBreakerRegistry {
	/**
	 * @param {Object} dependencies - Injected dependencies
	 * @param {Object} dependencies.logger - Logger implementation
	 * @param {Object} dependencies.timer - Timer implementation
	 */
	constructor(dependencies = {}) {
		// Inject dependencies with fallbacks
		this.logger = dependencies.logger || this._createDefaultLogger();
		this.timer = dependencies.timer || this._createDefaultTimer();

		this.breakers = new Map();
		this.defaultConfig = {
			failureThreshold: 5,
			successThreshold: 3,
			timeout: 60000,
			monitoringPeriod: 60000
		};
	}

	/**
	 * Get or create a circuit breaker
	 *
	 * @param {string} name - Breaker name
	 * @param {Object} config - Configuration
	 * @returns {CircuitBreaker} Circuit breaker instance
	 */
	getBreaker(name, config = {}) {
		if (!this.breakers.has(name)) {
			const breakerConfig = { ...this.defaultConfig, ...config };
			const dependencies = {
				logger: this.logger,
				timer: this.timer
			};
			this.breakers.set(name, new CircuitBreaker(breakerConfig, dependencies));
			this.logger.debug(`Created circuit breaker: ${name}`);
		}

		return this.breakers.get(name);
	}

	/**
	 * Remove a circuit breaker
	 *
	 * @param {string} name - Breaker name
	 * @returns {boolean} True if removed
	 */
	removeBreaker(name) {
		return this.breakers.delete(name);
	}

	/**
	 * Get all breaker statuses
	 *
	 * @returns {Object} Status map
	 */
	getAllStatuses() {
		const statuses = {};

		for (const [name, breaker] of this.breakers.entries()) {
			statuses[name] = breaker.getStatus();
		}

		return statuses;
	}

	/**
	 * Reset all circuit breakers
	 */
	resetAll() {
		for (const breaker of this.breakers.values()) {
			breaker.reset();
		}

		this.logger.info('All circuit breakers reset');
	}

	/**
	 * Get healthy breakers
	 *
	 * @returns {Array} Names of healthy breakers
	 */
	getHealthyBreakers() {
		const healthy = [];

		for (const [name, breaker] of this.breakers.entries()) {
			const status = breaker.getStatus();
			if (status.metrics.isHealthy) {
				healthy.push(name);
			}
		}

		return healthy;
	}

	/**
	 * Get unhealthy breakers
	 *
	 * @returns {Array} Names of unhealthy breakers
	 */
	getUnhealthyBreakers() {
		const unhealthy = [];

		for (const [name, breaker] of this.breakers.entries()) {
			const status = breaker.getStatus();
			if (!status.metrics.isHealthy) {
				unhealthy.push(name);
			}
		}

		return unhealthy;
	}

	/**
	 * Create default logger implementation
	 * @returns {Object} Logger implementation
	 * @private
	 */
	_createDefaultLogger() {
		return {
			log: (...args) => console.log(...args),
			error: (...args) => console.error(...args),
			warn: (...args) => console.warn(...args),
			info: (...args) => console.info(...args),
			debug: (...args) => console.debug(...args)
		};
	}

	/**
	 * Create default timer implementation
	 * @returns {Object} Timer implementation
	 * @private
	 */
	_createDefaultTimer() {
		return {
			setTimeout: (fn, delay) => setTimeout(fn, delay),
			clearTimeout: (id) => clearTimeout(id),
			now: () => Date.now()
		};
	}
}
