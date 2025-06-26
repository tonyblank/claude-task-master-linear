/**
 * @fileoverview Health Monitoring System
 *
 * This module provides comprehensive health monitoring for integrations,
 * including performance tracking, failure detection, and automated alerting.
 */

import { log } from '../utils.js';
import { circuitBreakerRegistry } from './circuit-breaker.js';

/**
 * Health status levels
 */
export const HEALTH_STATUS = {
	HEALTHY: 'healthy',
	DEGRADED: 'degraded',
	UNHEALTHY: 'unhealthy',
	CRITICAL: 'critical',
	UNKNOWN: 'unknown'
};

/**
 * Health check types
 */
export const HEALTH_CHECK_TYPE = {
	INTEGRATION: 'integration',
	CIRCUIT_BREAKER: 'circuit_breaker',
	RESOURCE: 'resource',
	PERFORMANCE: 'performance',
	CUSTOM: 'custom'
};

/**
 * Alert management constants
 */
const MAX_ALERTS = 100;
const ALERTS_TO_KEEP = 50;

/**
 * Comprehensive health monitoring for the integration system
 */
export class HealthMonitor {
	/**
	 * @param {Object} config - Configuration options
	 */
	constructor(config = {}) {
		this.config = {
			checkInterval: 30000, // Health check interval (ms)
			alertThreshold: 3, // Consecutive failures before alert
			performanceWindow: 300000, // Performance measurement window (ms)
			maxResponseTime: 5000, // Max acceptable response time (ms)
			errorRateThreshold: 0.1, // Error rate threshold (10%)
			memoryThreshold: 0.8, // Memory usage threshold (80%)
			cpuThreshold: 0.8, // CPU usage threshold (80%)
			retentionPeriod: 86400000, // Data retention period (24 hours)
			enableAlerting: true,
			enableMetrics: true,
			...config
		};

		// Health check registry
		this.healthChecks = new Map();

		// Health history and metrics
		this.healthHistory = [];
		this.metrics = new Map();
		this.alerts = [];

		// Monitoring state
		this.isRunning = false;
		this.checkTimer = null;
		this.lastCheckTime = 0;

		// Event handlers for health events
		this.eventHandlers = {
			'health:changed': [],
			'health:alert': [],
			'health:recovered': [],
			'metric:updated': []
		};

		// Overall system health cache
		this.systemHealth = {
			status: HEALTH_STATUS.UNKNOWN,
			lastUpdated: 0,
			issues: [],
			summary: {}
		};

		// Bind methods
		this._runHealthChecks = this._runHealthChecks.bind(this);
		this._performHealthCheck = this._performHealthCheck.bind(this);
	}

	/**
	 * Start health monitoring
	 */
	start() {
		if (this.isRunning) {
			log('warn', 'Health monitor is already running');
			return;
		}

		this.isRunning = true;
		log('info', 'Health monitor started');

		// Run initial health check
		this._runHealthChecks();

		// Schedule periodic checks
		this.checkTimer = setInterval(
			this._runHealthChecks,
			this.config.checkInterval
		);
	}

	/**
	 * Stop health monitoring
	 */
	stop() {
		if (!this.isRunning) {
			return;
		}

		this.isRunning = false;

		if (this.checkTimer) {
			clearInterval(this.checkTimer);
			this.checkTimer = null;
		}

		log('info', 'Health monitor stopped');
	}

	/**
	 * Register a health check
	 *
	 * @param {string} name - Check name
	 * @param {Function} checkFn - Health check function
	 * @param {Object} options - Check options
	 */
	registerCheck(name, checkFn, options = {}) {
		if (typeof checkFn !== 'function') {
			throw new Error('Health check function must be a function');
		}

		const checkConfig = {
			type: HEALTH_CHECK_TYPE.CUSTOM,
			timeout: 5000,
			critical: false,
			description: '',
			tags: [],
			...options
		};

		this.healthChecks.set(name, {
			name,
			checkFn,
			config: checkConfig,
			lastCheck: 0,
			lastResult: null,
			consecutiveFailures: 0,
			totalChecks: 0,
			totalFailures: 0
		});

		log('debug', `Registered health check: ${name}`);
	}

	/**
	 * Unregister a health check
	 *
	 * @param {string} name - Check name
	 * @returns {boolean} True if removed
	 */
	unregisterCheck(name) {
		const removed = this.healthChecks.delete(name);
		if (removed) {
			log('debug', `Unregistered health check: ${name}`);
		}
		return removed;
	}

	/**
	 * Get current system health
	 *
	 * @returns {Object} System health status
	 */
	getSystemHealth() {
		// Return cached result if recent
		const cacheAge = Date.now() - this.systemHealth.lastUpdated;
		if (cacheAge < 5000) {
			// 5 second cache
			return { ...this.systemHealth };
		}

		const issues = [];
		const healthyChecks = [];
		const degradedChecks = [];
		const unhealthyChecks = [];

		let overallStatus = HEALTH_STATUS.HEALTHY;

		// Evaluate all health checks
		for (const [name, check] of this.healthChecks.entries()) {
			if (!check.lastResult) {
				continue;
			}

			const result = check.lastResult;

			if (result.status === HEALTH_STATUS.HEALTHY) {
				healthyChecks.push(name);
			} else if (result.status === HEALTH_STATUS.DEGRADED) {
				degradedChecks.push(name);
				if (overallStatus === HEALTH_STATUS.HEALTHY) {
					overallStatus = HEALTH_STATUS.DEGRADED;
				}
			} else if (result.status === HEALTH_STATUS.UNHEALTHY) {
				unhealthyChecks.push(name);
				if (overallStatus !== HEALTH_STATUS.CRITICAL) {
					overallStatus = HEALTH_STATUS.UNHEALTHY;
				}
				issues.push({
					check: name,
					issue: result.message || 'Health check failed',
					severity: 'high',
					timestamp: result.timestamp
				});
			} else if (result.status === HEALTH_STATUS.CRITICAL) {
				unhealthyChecks.push(name);
				overallStatus = HEALTH_STATUS.CRITICAL;
				issues.push({
					check: name,
					issue: result.message || 'Critical health check failed',
					severity: 'critical',
					timestamp: result.timestamp
				});
			}
		}

		// Check circuit breaker health
		let circuitBreakerStatuses = {};
		let unhealthyBreakers = [];
		try {
			circuitBreakerStatuses = circuitBreakerRegistry.getAllStatuses();
			if (
				circuitBreakerStatuses &&
				typeof circuitBreakerStatuses === 'object'
			) {
				unhealthyBreakers = Object.entries(circuitBreakerStatuses)
					.filter(
						([name, status]) =>
							status && status.metrics && !status.metrics.isHealthy
					)
					.map(([name]) => name);

				if (unhealthyBreakers.length > 0) {
					issues.push({
						check: 'circuit_breakers',
						issue: `Circuit breakers unhealthy: ${unhealthyBreakers.join(', ')}`,
						severity: 'medium',
						timestamp: Date.now()
					});

					if (overallStatus === HEALTH_STATUS.HEALTHY) {
						overallStatus = HEALTH_STATUS.DEGRADED;
					}
				}
			}
		} catch (error) {
			// Handle circuit breaker registry errors gracefully
			log('warn', 'Failed to check circuit breaker health:', error);
			circuitBreakerStatuses = {}; // Ensure variable is always initialized
			unhealthyBreakers = [];
		}

		// Update cached result
		this.systemHealth = {
			status: overallStatus,
			lastUpdated: Date.now(),
			issues: issues.slice(0, 10), // Limit to 10 most recent issues
			summary: {
				totalChecks: this.healthChecks.size,
				healthyChecks: healthyChecks.length,
				degradedChecks: degradedChecks.length,
				unhealthyChecks: unhealthyChecks.length,
				circuitBreakers: {
					total: Object.keys(circuitBreakerStatuses).length,
					healthy: Object.values(circuitBreakerStatuses).filter(
						(s) => s && s.metrics && s.metrics.isHealthy
					).length,
					unhealthy: unhealthyBreakers.length
				}
			}
		};

		return { ...this.systemHealth };
	}

	/**
	 * Get health check details
	 *
	 * @param {string} name - Check name (optional)
	 * @returns {Object|Map} Health check details
	 */
	getHealthDetails(name = null) {
		if (name) {
			const check = this.healthChecks.get(name);
			if (!check) {
				return null;
			}

			return {
				...check,
				successRate:
					check.totalChecks > 0
						? ((check.totalChecks - check.totalFailures) / check.totalChecks) *
							100
						: 0
			};
		}

		const details = {};
		for (const [checkName, check] of this.healthChecks.entries()) {
			details[checkName] = {
				...check,
				successRate:
					check.totalChecks > 0
						? ((check.totalChecks - check.totalFailures) / check.totalChecks) *
							100
						: 0
			};
		}

		return details;
	}

	/**
	 * Get performance metrics
	 *
	 * @param {string} name - Metric name (optional)
	 * @returns {Object|Map} Performance metrics
	 */
	getMetrics(name = null) {
		if (name) {
			return this.metrics.get(name) || null;
		}

		const allMetrics = {};
		for (const [metricName, metric] of this.metrics.entries()) {
			allMetrics[metricName] = metric;
		}

		return allMetrics;
	}

	/**
	 * Record a metric value
	 *
	 * @param {string} name - Metric name
	 * @param {number} value - Metric value
	 * @param {Object} tags - Metric tags
	 */
	recordMetric(name, value, tags = {}) {
		if (!this.config.enableMetrics) {
			return;
		}

		const now = Date.now();

		if (!this.metrics.has(name)) {
			this.metrics.set(name, {
				name,
				values: [],
				tags,
				count: 0,
				sum: 0,
				min: value,
				max: value,
				avg: value,
				lastUpdated: now
			});
		}

		const metric = this.metrics.get(name);

		// Add new value
		metric.values.push({ value, timestamp: now, tags });
		metric.count++;
		metric.sum += value;
		metric.min = Math.min(metric.min, value);
		metric.max = Math.max(metric.max, value);
		metric.avg = metric.sum / metric.count;
		metric.lastUpdated = now;

		// Clean up old values
		const cutoff = now - this.config.performanceWindow;
		metric.values = metric.values.filter((v) => v.timestamp > cutoff);

		// Recalculate stats for recent values only
		if (metric.values.length > 0) {
			const recentValues = metric.values.map((v) => v.value);
			metric.recentMin = Math.min(...recentValues);
			metric.recentMax = Math.max(...recentValues);
			metric.recentAvg =
				recentValues.reduce((a, b) => a + b, 0) / recentValues.length;
			metric.recentCount = recentValues.length;
		}

		this._emitEvent('metric:updated', { name, value, tags, metric });
	}

	/**
	 * Force a health check run
	 *
	 * @param {string} checkName - Specific check to run (optional)
	 * @returns {Promise<Object>} Check results
	 */
	async forceCheck(checkName = null) {
		if (checkName) {
			const check = this.healthChecks.get(checkName);
			if (!check) {
				throw new Error(`Health check not found: ${checkName}`);
			}

			const result = await this._performHealthCheck(check);
			return { [checkName]: result };
		}

		// Run all checks
		const results = {};
		for (const [name, check] of this.healthChecks.entries()) {
			try {
				results[name] = await this._performHealthCheck(check);
			} catch (error) {
				results[name] = {
					status: HEALTH_STATUS.CRITICAL,
					message: `Health check execution failed: ${error.message}`,
					timestamp: Date.now(),
					error: error.message
				};
			}
		}

		return results;
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
	 * Run all health checks
	 *
	 * @private
	 */
	async _runHealthChecks() {
		this.lastCheckTime = Date.now();

		const checkPromises = [];
		for (const [name, check] of this.healthChecks.entries()) {
			checkPromises.push(
				this._performHealthCheck(check).catch((error) => ({
					status: HEALTH_STATUS.CRITICAL,
					message: `Health check execution failed: ${error.message}`,
					timestamp: Date.now(),
					error: error.message
				}))
			);
		}

		try {
			await Promise.allSettled(checkPromises);
		} catch (error) {
			log('error', 'Health check execution failed:', error.message);
		}

		// Clean up old data
		this._cleanupOldData();
	}

	/**
	 * Perform a single health check
	 *
	 * @param {Object} check - Health check definition
	 * @returns {Promise<Object>} Check result
	 * @private
	 */
	async _performHealthCheck(check) {
		const startTime = Date.now();

		try {
			// Execute health check with timeout
			const result = await Promise.race([
				check.checkFn(),
				new Promise((_, reject) =>
					setTimeout(
						() => reject(new Error('Health check timeout')),
						check.config.timeout
					)
				)
			]);

			const responseTime = Date.now() - startTime;

			// Normalize result
			const normalizedResult = this._normalizeResult(result, responseTime);

			// Update check statistics
			check.lastCheck = Date.now();
			check.lastResult = normalizedResult;
			check.totalChecks++;

			if (normalizedResult.status !== HEALTH_STATUS.HEALTHY) {
				check.consecutiveFailures++;
				check.totalFailures++;

				// Check if alert threshold reached
				if (check.consecutiveFailures >= this.config.alertThreshold) {
					this._handleAlert(check, normalizedResult);
				}
			} else {
				// Reset failure count on success
				if (check.consecutiveFailures > 0) {
					this._handleRecovery(check, normalizedResult);
				}
				check.consecutiveFailures = 0;
			}

			// Record performance metric
			this.recordMetric(
				`health_check.${check.name}.response_time`,
				responseTime,
				{
					status: normalizedResult.status,
					type: check.config.type
				}
			);

			return normalizedResult;
		} catch (error) {
			const responseTime = Date.now() - startTime;

			const errorResult = {
				status: HEALTH_STATUS.CRITICAL,
				message: error.message,
				timestamp: Date.now(),
				responseTime,
				error: error.message
			};

			// Update check statistics
			check.lastCheck = Date.now();
			check.lastResult = errorResult;
			check.totalChecks++;
			check.totalFailures++;
			check.consecutiveFailures++;

			// Handle alert
			if (check.consecutiveFailures >= this.config.alertThreshold) {
				this._handleAlert(check, errorResult);
			}

			return errorResult;
		}
	}

	/**
	 * Normalize health check result
	 *
	 * @param {any} result - Raw result
	 * @param {number} responseTime - Response time
	 * @returns {Object} Normalized result
	 * @private
	 */
	_normalizeResult(result, responseTime) {
		// If result is already normalized
		if (result && typeof result === 'object' && result.status) {
			return {
				timestamp: Date.now(),
				responseTime,
				...result
			};
		}

		// If result is boolean
		if (typeof result === 'boolean') {
			return {
				status: result ? HEALTH_STATUS.HEALTHY : HEALTH_STATUS.UNHEALTHY,
				message: result ? 'Health check passed' : 'Health check failed',
				timestamp: Date.now(),
				responseTime
			};
		}

		// If result is string
		if (typeof result === 'string') {
			return {
				status: HEALTH_STATUS.HEALTHY,
				message: result,
				timestamp: Date.now(),
				responseTime
			};
		}

		// Default to healthy
		return {
			status: HEALTH_STATUS.HEALTHY,
			message: 'Health check completed',
			timestamp: Date.now(),
			responseTime,
			data: result
		};
	}

	/**
	 * Handle health alert
	 *
	 * @param {Object} check - Health check
	 * @param {Object} result - Check result
	 * @private
	 */
	_handleAlert(check, result) {
		if (!this.config.enableAlerting) {
			return;
		}

		const alert = {
			id: `alert_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
			check: check.name,
			status: result.status,
			message: result.message,
			consecutiveFailures: check.consecutiveFailures,
			timestamp: Date.now(),
			severity: check.config.critical ? 'critical' : 'high'
		};

		this.alerts.push(alert);

		// Keep only recent alerts
		if (this.alerts.length > MAX_ALERTS) {
			this.alerts = this.alerts.slice(-ALERTS_TO_KEEP);
		}

		log(
			'error',
			`Health alert: ${check.name} - ${result.message} (${check.consecutiveFailures} consecutive failures)`
		);

		this._emitEvent('health:alert', alert);
	}

	/**
	 * Handle health recovery
	 *
	 * @param {Object} check - Health check
	 * @param {Object} result - Check result
	 * @private
	 */
	_handleRecovery(check, result) {
		const recovery = {
			check: check.name,
			previousFailures: check.consecutiveFailures,
			timestamp: Date.now(),
			message: result.message
		};

		log(
			'info',
			`Health recovered: ${check.name} - ${result.message} (after ${check.consecutiveFailures} failures)`
		);

		this._emitEvent('health:recovered', recovery);
	}

	/**
	 * Clean up old data
	 *
	 * @private
	 */
	_cleanupOldData() {
		const cutoff = Date.now() - this.config.retentionPeriod;

		// Clean up health history
		this.healthHistory = this.healthHistory.filter(
			(entry) => entry.timestamp > cutoff
		);

		// Clean up metric values
		for (const metric of this.metrics.values()) {
			metric.values = metric.values.filter((v) => v.timestamp > cutoff);
		}

		// Clean up old alerts
		this.alerts = this.alerts.filter((alert) => alert.timestamp > cutoff);
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
					`Health monitor event handler failed for ${eventType}:`,
					error.message
				);
			}
		}
	}
}

/**
 * Built-in health checks for common scenarios
 */
export const builtInHealthChecks = {
	/**
	 * Memory usage health check
	 *
	 * @param {number} threshold - Memory threshold (0-1)
	 * @returns {Object} Health check result
	 */
	memoryUsage:
		(threshold = 0.8) =>
		() => {
			if (typeof process === 'undefined' || !process.memoryUsage) {
				return {
					status: HEALTH_STATUS.UNKNOWN,
					message: 'Memory usage not available'
				};
			}

			const usage = process.memoryUsage();
			const usedPercent = usage.heapUsed / usage.heapTotal;

			if (usedPercent > threshold) {
				return {
					status: HEALTH_STATUS.UNHEALTHY,
					message: `High memory usage: ${Math.round(usedPercent * 100)}%`,
					data: { usedPercent, ...usage }
				};
			} else if (usedPercent > threshold * 0.8) {
				return {
					status: HEALTH_STATUS.DEGRADED,
					message: `Elevated memory usage: ${Math.round(usedPercent * 100)}%`,
					data: { usedPercent, ...usage }
				};
			}

			return {
				status: HEALTH_STATUS.HEALTHY,
				message: `Memory usage normal: ${Math.round(usedPercent * 100)}%`,
				data: { usedPercent, ...usage }
			};
		},

	/**
	 * Circuit breaker health check
	 *
	 * @param {string} breakerName - Circuit breaker name
	 * @returns {Object} Health check result
	 */
	circuitBreaker: (breakerName) => () => {
		const breaker = circuitBreakerRegistry.getBreaker(breakerName);
		const status = breaker.getStatus();

		if (status.state === 'open') {
			return {
				status: HEALTH_STATUS.UNHEALTHY,
				message: `Circuit breaker ${breakerName} is OPEN`,
				data: status
			};
		} else if (status.state === 'half_open') {
			return {
				status: HEALTH_STATUS.DEGRADED,
				message: `Circuit breaker ${breakerName} is HALF_OPEN (testing)`,
				data: status
			};
		}

		return {
			status: HEALTH_STATUS.HEALTHY,
			message: `Circuit breaker ${breakerName} is CLOSED`,
			data: status
		};
	}
};

// Global health monitor instance
export const healthMonitor = new HealthMonitor();
