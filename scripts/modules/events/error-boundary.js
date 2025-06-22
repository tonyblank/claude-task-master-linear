/**
 * @fileoverview Error Boundary and Isolation System
 *
 * This module provides comprehensive error isolation and boundary mechanisms
 * to ensure failures in one integration don't affect others or the core application.
 */

import { log } from '../utils.js';
import { circuitBreakerRegistry } from './circuit-breaker.js';
import { healthMonitor } from './health-monitor.js';

/**
 * Error severity levels
 */
export const ERROR_SEVERITY = {
	LOW: 'low',
	MEDIUM: 'medium',
	HIGH: 'high',
	CRITICAL: 'critical'
};

/**
 * Error categories for classification
 */
export const ERROR_CATEGORY = {
	NETWORK: 'network',
	TIMEOUT: 'timeout',
	VALIDATION: 'validation',
	AUTHENTICATION: 'authentication',
	AUTHORIZATION: 'authorization',
	RATE_LIMIT: 'rate_limit',
	RESOURCE: 'resource',
	LOGIC: 'logic',
	EXTERNAL: 'external',
	UNKNOWN: 'unknown'
};

/**
 * Recovery strategies
 */
export const RECOVERY_STRATEGY = {
	RETRY: 'retry',
	FALLBACK: 'fallback',
	CIRCUIT_BREAK: 'circuit_break',
	ISOLATE: 'isolate',
	IGNORE: 'ignore',
	ESCALATE: 'escalate'
};

/**
 * Error boundary for integration isolation
 */
export class ErrorBoundary {
	/**
	 * @param {Object} config - Configuration options
	 */
	constructor(config = {}) {
		this.config = {
			name: 'default',
			maxConcurrentErrors: 10,
			errorWindowMs: 60000, // 1 minute error window
			maxRetries: 3,
			retryDelay: 1000,
			timeoutMs: 30000,
			enableCircuitBreaker: true,
			enableFallback: true,
			enableRecovery: true,
			isolationLevel: 'integration', // 'integration', 'operation', 'strict'
			...config
		};

		// Error tracking
		this.errors = [];
		this.errorCounts = new Map();
		this.lastError = null;

		// Recovery state
		this.recoveryAttempts = 0;
		this.isIsolated = false;
		this.isolationStartTime = 0;

		// Statistics
		this.stats = {
			totalExecutions: 0,
			successfulExecutions: 0,
			failedExecutions: 0,
			retriedExecutions: 0,
			fallbackExecutions: 0,
			isolatedExecutions: 0,
			averageExecutionTime: 0,
			totalExecutionTime: 0,
			lastSuccess: null,
			lastFailure: null
		};

		// Event handlers
		this.eventHandlers = {
			'error:caught': [],
			'error:classified': [],
			'recovery:started': [],
			'recovery:completed': [],
			'recovery:failed': [],
			'isolation:started': [],
			'isolation:ended': [],
			'fallback:executed': []
		};

		// Circuit breaker integration
		this.circuitBreaker = this.config.enableCircuitBreaker
			? circuitBreakerRegistry.getBreaker(this.config.name)
			: null;

		// Bind methods
		this.execute = this.execute.bind(this);
		this.handleError = this.handleError.bind(this);
	}

	/**
	 * Execute a function within the error boundary
	 *
	 * @param {Function} fn - Function to execute
	 * @param {Array} args - Function arguments
	 * @param {Object} options - Execution options
	 * @returns {Promise<any>} Function result
	 */
	async execute(fn, args = [], options = {}) {
		const executionOptions = {
			timeout: this.config.timeoutMs,
			retries: this.config.maxRetries,
			fallback: null,
			context: {},
			isolationKey: this.config.name,
			...options
		};

		const startTime = Date.now();
		this.stats.totalExecutions++;

		// Check if currently isolated
		if (this.isIsolated) {
			this.stats.isolatedExecutions++;

			if (executionOptions.fallback) {
				return await this._executeFallback(
					executionOptions.fallback,
					args,
					executionOptions
				);
			}

			throw new IsolationError(
				`Execution blocked due to isolation: ${this.config.name}`,
				'ISOLATION_ACTIVE'
			);
		}

		let lastError = null;
		let retryCount = 0;

		// Retry loop
		while (retryCount <= executionOptions.retries) {
			try {
				// Use circuit breaker if enabled
				if (this.circuitBreaker) {
					const result = await this.circuitBreaker.execute(fn, args, {
						timeout: executionOptions.timeout
					});

					const executionTime = Date.now() - startTime;
					this._recordSuccess(executionTime);
					return result;
				} else {
					// Direct execution with timeout
					const result = await this._executeWithTimeout(
						fn,
						args,
						executionOptions.timeout
					);

					const executionTime = Date.now() - startTime;
					this._recordSuccess(executionTime);
					return result;
				}
			} catch (error) {
				lastError = error;
				retryCount++;

				// Classify and handle the error
				const classification = this._classifyError(error);
				const recoveryStrategy = this._determineRecoveryStrategy(
					error,
					classification,
					retryCount
				);

				this._emitEvent('error:caught', {
					error,
					classification,
					recoveryStrategy,
					attempt: retryCount,
					context: executionOptions.context
				});

				// Handle the error based on strategy
				const shouldContinue = await this._handleErrorWithStrategy(
					error,
					classification,
					recoveryStrategy,
					retryCount,
					executionOptions
				);

				if (!shouldContinue || retryCount > executionOptions.retries) {
					break;
				}

				// Delay before retry
				if (retryCount <= executionOptions.retries) {
					await this._delayRetry(retryCount);
					this.stats.retriedExecutions++;
				}
			}
		}

		// All retries exhausted
		const executionTime = Date.now() - startTime;
		this._recordFailure(lastError, executionTime);

		// Try fallback if available
		if (executionOptions.fallback) {
			try {
				return await this._executeFallback(
					executionOptions.fallback,
					args,
					executionOptions
				);
			} catch (fallbackError) {
				log(
					'error',
					`Fallback execution failed for ${this.config.name}:`,
					fallbackError.message
				);
				// Continue to throw original error
			}
		}

		throw lastError;
	}

	/**
	 * Handle error manually (for use outside of execute())
	 *
	 * @param {Error} error - Error to handle
	 * @param {Object} context - Error context
	 * @returns {Object} Error handling result
	 */
	handleError(error, context = {}) {
		const classification = this._classifyError(error);
		const recoveryStrategy = this._determineRecoveryStrategy(
			error,
			classification
		);

		this._recordError(error, classification);

		this._emitEvent('error:classified', {
			error,
			classification,
			recoveryStrategy,
			context
		});

		return {
			classification,
			recoveryStrategy,
			shouldRetry: recoveryStrategy === RECOVERY_STRATEGY.RETRY,
			shouldIsolate: recoveryStrategy === RECOVERY_STRATEGY.ISOLATE,
			shouldCircuitBreak: recoveryStrategy === RECOVERY_STRATEGY.CIRCUIT_BREAK
		};
	}

	/**
	 * Force isolation of this boundary
	 *
	 * @param {string} reason - Reason for isolation
	 * @param {number} duration - Isolation duration (ms)
	 */
	isolate(reason = 'manual', duration = 300000) {
		this.isIsolated = true;
		this.isolationStartTime = Date.now();

		log('warn', `Error boundary isolated: ${this.config.name} - ${reason}`);

		this._emitEvent('isolation:started', {
			reason,
			duration,
			timestamp: this.isolationStartTime
		});

		// Auto-recover after duration
		setTimeout(() => {
			this.recover('timeout');
		}, duration);
	}

	/**
	 * Recover from isolation
	 *
	 * @param {string} reason - Reason for recovery
	 */
	recover(reason = 'manual') {
		if (!this.isIsolated) {
			return;
		}

		this.isIsolated = false;
		const isolationDuration = Date.now() - this.isolationStartTime;

		log(
			'info',
			`Error boundary recovered: ${this.config.name} - ${reason} (isolated for ${isolationDuration}ms)`
		);

		this._emitEvent('isolation:ended', {
			reason,
			duration: isolationDuration,
			timestamp: Date.now()
		});
	}

	/**
	 * Get boundary status and statistics
	 *
	 * @returns {Object} Status information
	 */
	getStatus() {
		const now = Date.now();
		const recentErrors = this._getRecentErrors();

		return {
			name: this.config.name,
			isIsolated: this.isIsolated,
			isolationDuration: this.isIsolated ? now - this.isolationStartTime : 0,
			stats: { ...this.stats },
			recentErrors: recentErrors.length,
			errorRate: this._calculateErrorRate(),
			healthStatus: this._getHealthStatus(),
			circuitBreakerStatus: this.circuitBreaker
				? this.circuitBreaker.getStatus()
				: null
		};
	}

	/**
	 * Reset boundary state
	 */
	reset() {
		this.errors = [];
		this.errorCounts.clear();
		this.lastError = null;
		this.recoveryAttempts = 0;
		this.isIsolated = false;
		this.isolationStartTime = 0;

		// Reset stats but keep historical data
		this.stats.totalExecutions = 0;
		this.stats.successfulExecutions = 0;
		this.stats.failedExecutions = 0;
		this.stats.retriedExecutions = 0;
		this.stats.fallbackExecutions = 0;
		this.stats.isolatedExecutions = 0;

		if (this.circuitBreaker) {
			this.circuitBreaker.reset();
		}

		log('info', `Error boundary reset: ${this.config.name}`);
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
				setTimeout(
					() => reject(new Error(`Operation timeout after ${timeout}ms`)),
					timeout
				)
			)
		]);
	}

	/**
	 * Execute fallback function
	 *
	 * @param {Function} fallbackFn - Fallback function
	 * @param {Array} args - Function arguments
	 * @param {Object} options - Execution options
	 * @returns {Promise<any>} Fallback result
	 * @private
	 */
	async _executeFallback(fallbackFn, args, options) {
		this.stats.fallbackExecutions++;

		this._emitEvent('fallback:executed', {
			args,
			options,
			timestamp: Date.now()
		});

		return await this._executeWithTimeout(fallbackFn, args, options.timeout);
	}

	/**
	 * Classify error by type and characteristics
	 *
	 * @param {Error} error - Error to classify
	 * @returns {Object} Error classification
	 * @private
	 */
	_classifyError(error) {
		const message = error.message?.toLowerCase() || '';
		const stack = error.stack?.toLowerCase() || '';

		let category = ERROR_CATEGORY.UNKNOWN;
		let severity = ERROR_SEVERITY.MEDIUM;
		let retryable = false;

		// Network errors
		if (
			message.includes('network') ||
			message.includes('connection') ||
			message.includes('econnrefused') ||
			message.includes('enotfound')
		) {
			category = ERROR_CATEGORY.NETWORK;
			severity = ERROR_SEVERITY.HIGH;
			retryable = true;
		}
		// Timeout errors
		else if (message.includes('timeout') || message.includes('etimedout')) {
			category = ERROR_CATEGORY.TIMEOUT;
			severity = ERROR_SEVERITY.MEDIUM;
			retryable = true;
		}
		// Authentication errors
		else if (
			message.includes('auth') ||
			message.includes('unauthorized') ||
			error.status === 401
		) {
			category = ERROR_CATEGORY.AUTHENTICATION;
			severity = ERROR_SEVERITY.HIGH;
			retryable = false;
		}
		// Authorization errors
		else if (message.includes('forbidden') || error.status === 403) {
			category = ERROR_CATEGORY.AUTHORIZATION;
			severity = ERROR_SEVERITY.HIGH;
			retryable = false;
		}
		// Rate limiting
		else if (message.includes('rate limit') || error.status === 429) {
			category = ERROR_CATEGORY.RATE_LIMIT;
			severity = ERROR_SEVERITY.MEDIUM;
			retryable = true;
		}
		// Validation errors
		else if (
			message.includes('validation') ||
			message.includes('invalid') ||
			error.status === 400
		) {
			category = ERROR_CATEGORY.VALIDATION;
			severity = ERROR_SEVERITY.LOW;
			retryable = false;
		}
		// Resource errors
		else if (
			message.includes('memory') ||
			message.includes('resource') ||
			error.status === 507
		) {
			category = ERROR_CATEGORY.RESOURCE;
			severity = ERROR_SEVERITY.CRITICAL;
			retryable = false;
		}
		// External service errors
		else if (error.status >= 500 && error.status < 600) {
			category = ERROR_CATEGORY.EXTERNAL;
			severity = ERROR_SEVERITY.HIGH;
			retryable = true;
		}

		return {
			category,
			severity,
			retryable,
			message: error.message,
			status: error.status,
			code: error.code,
			timestamp: Date.now()
		};
	}

	/**
	 * Determine recovery strategy for an error
	 *
	 * @param {Error} error - Error to handle
	 * @param {Object} classification - Error classification
	 * @param {number} retryCount - Current retry count
	 * @returns {string} Recovery strategy
	 * @private
	 */
	_determineRecoveryStrategy(error, classification, retryCount = 0) {
		// Critical errors should isolate immediately
		if (classification.severity === ERROR_SEVERITY.CRITICAL) {
			return RECOVERY_STRATEGY.ISOLATE;
		}

		// Non-retryable errors
		if (!classification.retryable) {
			if (classification.severity === ERROR_SEVERITY.HIGH) {
				return RECOVERY_STRATEGY.CIRCUIT_BREAK;
			}
			return RECOVERY_STRATEGY.IGNORE;
		}

		// Check retry limits
		if (retryCount >= this.config.maxRetries) {
			if (classification.severity === ERROR_SEVERITY.HIGH) {
				return RECOVERY_STRATEGY.CIRCUIT_BREAK;
			}
			return RECOVERY_STRATEGY.FALLBACK;
		}

		// Rate limiting should delay and retry
		if (classification.category === ERROR_CATEGORY.RATE_LIMIT) {
			return RECOVERY_STRATEGY.RETRY;
		}

		// Network and timeout errors should retry
		if (
			classification.category === ERROR_CATEGORY.NETWORK ||
			classification.category === ERROR_CATEGORY.TIMEOUT
		) {
			return RECOVERY_STRATEGY.RETRY;
		}

		// Default to retry for retryable errors
		return classification.retryable
			? RECOVERY_STRATEGY.RETRY
			: RECOVERY_STRATEGY.IGNORE;
	}

	/**
	 * Handle error based on recovery strategy
	 *
	 * @param {Error} error - Error to handle
	 * @param {Object} classification - Error classification
	 * @param {string} strategy - Recovery strategy
	 * @param {number} retryCount - Current retry count
	 * @param {Object} options - Execution options
	 * @returns {Promise<boolean>} True if should continue retrying
	 * @private
	 */
	async _handleErrorWithStrategy(
		error,
		classification,
		strategy,
		retryCount,
		options
	) {
		this._recordError(error, classification);

		switch (strategy) {
			case RECOVERY_STRATEGY.RETRY:
				return retryCount <= this.config.maxRetries;

			case RECOVERY_STRATEGY.CIRCUIT_BREAK:
				// Circuit breaker will handle this automatically
				return false;

			case RECOVERY_STRATEGY.ISOLATE:
				this.isolate(`Error: ${error.message}`, 300000); // 5 minutes
				return false;

			case RECOVERY_STRATEGY.FALLBACK:
				return false; // Will try fallback after retry loop

			case RECOVERY_STRATEGY.IGNORE:
				return false;

			case RECOVERY_STRATEGY.ESCALATE:
				// Report to health monitor
				healthMonitor.recordMetric(
					`error_boundary.${this.config.name}.escalated_errors`,
					1,
					{
						category: classification.category,
						severity: classification.severity
					}
				);
				return false;

			default:
				return false;
		}
	}

	/**
	 * Calculate delay for retry
	 *
	 * @param {number} retryCount - Current retry count
	 * @returns {Promise<void>} Delay promise
	 * @private
	 */
	async _delayRetry(retryCount) {
		// Exponential backoff with jitter
		const baseDelay = this.config.retryDelay;
		const exponentialDelay = baseDelay * Math.pow(2, retryCount - 1);
		const jitter = Math.random() * 0.1 * exponentialDelay;
		const delay = exponentialDelay + jitter;

		await new Promise((resolve) => setTimeout(resolve, delay));
	}

	/**
	 * Record successful execution
	 *
	 * @param {number} executionTime - Execution time in milliseconds
	 * @private
	 */
	_recordSuccess(executionTime) {
		this.stats.successfulExecutions++;
		this.stats.totalExecutionTime += executionTime;
		this.stats.averageExecutionTime =
			this.stats.totalExecutionTime /
			(this.stats.successfulExecutions + this.stats.failedExecutions);
		this.stats.lastSuccess = Date.now();

		// Record metric
		healthMonitor.recordMetric(
			`error_boundary.${this.config.name}.execution_time`,
			executionTime,
			{
				result: 'success'
			}
		);
	}

	/**
	 * Record failed execution
	 *
	 * @param {Error} error - Error that occurred
	 * @param {number} executionTime - Execution time in milliseconds
	 * @private
	 */
	_recordFailure(error, executionTime) {
		this.stats.failedExecutions++;
		this.stats.lastFailure = Date.now();
		this.lastError = error;

		// Record metric
		healthMonitor.recordMetric(
			`error_boundary.${this.config.name}.execution_time`,
			executionTime,
			{
				result: 'failure',
				error: error.message
			}
		);
	}

	/**
	 * Record error for tracking
	 *
	 * @param {Error} error - Error to record
	 * @param {Object} classification - Error classification
	 * @private
	 */
	_recordError(error, classification) {
		const errorRecord = {
			error: error.message,
			classification,
			timestamp: Date.now(),
			stack: error.stack
		};

		this.errors.push(errorRecord);

		// Increment error count for this type
		const errorKey = `${classification.category}:${classification.severity}`;
		this.errorCounts.set(errorKey, (this.errorCounts.get(errorKey) || 0) + 1);

		// Clean up old errors
		const cutoff = Date.now() - this.config.errorWindowMs;
		this.errors = this.errors.filter((e) => e.timestamp > cutoff);
	}

	/**
	 * Get recent errors within the configured window
	 *
	 * @returns {Array} Recent errors
	 * @private
	 */
	_getRecentErrors() {
		const cutoff = Date.now() - this.config.errorWindowMs;
		return this.errors.filter((e) => e.timestamp > cutoff);
	}

	/**
	 * Calculate current error rate
	 *
	 * @returns {number} Error rate (0-1)
	 * @private
	 */
	_calculateErrorRate() {
		const totalExecutions =
			this.stats.successfulExecutions + this.stats.failedExecutions;

		if (totalExecutions === 0) {
			return 0;
		}

		return this.stats.failedExecutions / totalExecutions;
	}

	/**
	 * Get current health status
	 *
	 * @returns {string} Health status
	 * @private
	 */
	_getHealthStatus() {
		if (this.isIsolated) {
			return 'isolated';
		}

		const errorRate = this._calculateErrorRate();
		const recentErrors = this._getRecentErrors().length;

		if (errorRate > 0.5 || recentErrors > this.config.maxConcurrentErrors) {
			return 'unhealthy';
		} else if (
			errorRate > 0.2 ||
			recentErrors > this.config.maxConcurrentErrors / 2
		) {
			return 'degraded';
		}

		return 'healthy';
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
				log(
					'error',
					`Error boundary event handler failed for ${eventType}:`,
					error.message
				);
			}
		}
	}
}

/**
 * Error boundary specific error
 */
export class IsolationError extends Error {
	constructor(message, code) {
		super(message);
		this.name = 'IsolationError';
		this.code = code;
	}
}

/**
 * Error boundary registry for managing multiple boundaries
 */
export class ErrorBoundaryRegistry {
	constructor() {
		this.boundaries = new Map();
		this.defaultConfig = {
			maxConcurrentErrors: 10,
			errorWindowMs: 60000,
			maxRetries: 3,
			retryDelay: 1000,
			timeoutMs: 30000
		};
	}

	/**
	 * Get or create an error boundary
	 *
	 * @param {string} name - Boundary name
	 * @param {Object} config - Configuration
	 * @returns {ErrorBoundary} Error boundary instance
	 */
	getBoundary(name, config = {}) {
		if (!this.boundaries.has(name)) {
			const boundaryConfig = { ...this.defaultConfig, name, ...config };
			this.boundaries.set(name, new ErrorBoundary(boundaryConfig));
			log('debug', `Created error boundary: ${name}`);
		}

		return this.boundaries.get(name);
	}

	/**
	 * Remove an error boundary
	 *
	 * @param {string} name - Boundary name
	 * @returns {boolean} True if removed
	 */
	removeBoundary(name) {
		return this.boundaries.delete(name);
	}

	/**
	 * Get all boundary statuses
	 *
	 * @returns {Object} Status map
	 */
	getAllStatuses() {
		const statuses = {};

		for (const [name, boundary] of this.boundaries.entries()) {
			statuses[name] = boundary.getStatus();
		}

		return statuses;
	}

	/**
	 * Reset all error boundaries
	 */
	resetAll() {
		for (const boundary of this.boundaries.values()) {
			boundary.reset();
		}

		log('info', 'All error boundaries reset');
	}

	/**
	 * Get healthy boundaries
	 *
	 * @returns {Array} Names of healthy boundaries
	 */
	getHealthyBoundaries() {
		const healthy = [];

		for (const [name, boundary] of this.boundaries.entries()) {
			const status = boundary.getStatus();
			if (status.healthStatus === 'healthy') {
				healthy.push(name);
			}
		}

		return healthy;
	}

	/**
	 * Get isolated boundaries
	 *
	 * @returns {Array} Names of isolated boundaries
	 */
	getIsolatedBoundaries() {
		const isolated = [];

		for (const [name, boundary] of this.boundaries.entries()) {
			const status = boundary.getStatus();
			if (status.isIsolated) {
				isolated.push(name);
			}
		}

		return isolated;
	}
}

// Global registry instance
export const errorBoundaryRegistry = new ErrorBoundaryRegistry();
