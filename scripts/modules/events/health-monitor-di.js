/**
 * @fileoverview Health Monitoring System with Dependency Injection
 *
 * Refactored version that uses dependency injection for better testability
 * and loose coupling between modules.
 */

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
 * Comprehensive health monitoring for the integration system
 * Uses dependency injection for better testability
 */
export class HealthMonitor {
	/**
	 * @param {Object} config - Configuration options
	 * @param {Object} dependencies - Injected dependencies
	 * @param {Object} dependencies.logger - Logger implementation
	 * @param {Object} dependencies.configManager - Config manager implementation
	 * @param {Object} dependencies.circuitBreakerRegistry - Circuit breaker registry
	 * @param {Object} dependencies.timer - Timer implementation
	 */
	constructor(config = {}, dependencies = {}) {
		// Inject dependencies with fallbacks
		this.logger = dependencies.logger || this._createDefaultLogger();
		this.configManager = dependencies.configManager;
		this.circuitBreakerRegistry = dependencies.circuitBreakerRegistry;
		this.timer = dependencies.timer || this._createDefaultTimer();

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
			enableBuiltInChecks: true,
			...config
		};

		// Health checks registry
		// Map<checkName, { checkFn, config, lastResult, totalChecks, totalFailures, consecutiveFailures }>
		this.healthChecks = new Map();

		// Metrics storage
		// Map<metricName, { count, sum, avg, min, max, values, tags }>
		this.metrics = new Map();

		// System health cache
		this.systemHealth = null;
		this.cacheValidityPeriod = 10000; // 10 seconds

		// Monitoring state
		this.isRunning = false;
		this.checkTimer = null;
		this.lastCleanup = Date.now();

		// Event listeners
		this.listeners = new Map();
	}

	/**
	 * Register a health check
	 *
	 * @param {string} name - Unique name for the health check
	 * @param {Function} checkFn - Function that returns health status
	 * @param {Object} config - Check configuration
	 * @returns {void}
	 */
	registerCheck(name, checkFn, config = {}) {
		if (typeof checkFn !== 'function') {
			throw new Error('Health check function must be a function');
		}

		const checkConfig = {
			type: HEALTH_CHECK_TYPE.CUSTOM,
			critical: false,
			timeout: 5000,
			description: '',
			tags: [],
			...config
		};

		this.healthChecks.set(name, {
			checkFn,
			config: checkConfig,
			lastResult: null,
			totalChecks: 0,
			totalFailures: 0,
			consecutiveFailures: 0,
			lastCheck: null,
			responseTime: 0
		});

		this.logger.debug(`Health check registered: ${name}`);
		this._invalidateCache();
	}

	/**
	 * Unregister a health check
	 *
	 * @param {string} name - Name of the health check to remove
	 * @returns {boolean} True if check was removed
	 */
	unregisterCheck(name) {
		const removed = this.healthChecks.delete(name);
		if (removed) {
			this.logger.debug(`Health check unregistered: ${name}`);
			this._invalidateCache();
		}
		return removed;
	}

	/**
	 * Start health monitoring
	 *
	 * @returns {void}
	 */
	start() {
		if (this.isRunning) {
			this.logger.warn('Health monitoring is already running');
			return;
		}

		this.isRunning = true;
		this.checkTimer = this.timer.setInterval(
			() => this._runHealthChecks(),
			this.config.checkInterval
		);

		this.logger.info('Health monitoring started');
		this._emit('monitoring:started');
	}

	/**
	 * Stop health monitoring
	 *
	 * @returns {void}
	 */
	stop() {
		if (!this.isRunning) {
			return;
		}

		this.isRunning = false;
		if (this.checkTimer) {
			this.timer.clearInterval(this.checkTimer);
			this.checkTimer = null;
		}

		this.logger.info('Health monitoring stopped');
		this._emit('monitoring:stopped');
	}

	/**
	 * Get overall system health
	 *
	 * @param {boolean} forceRefresh - Force cache refresh
	 * @returns {Object} System health status
	 */
	getSystemHealth(forceRefresh = false) {
		const now = Date.now();

		// Return cached result if still valid
		if (
			!forceRefresh &&
			this.systemHealth &&
			now - this.systemHealth.lastUpdated < this.cacheValidityPeriod
		) {
			return this.systemHealth;
		}

		const checks = {};
		const issues = [];
		let overallStatus = HEALTH_STATUS.HEALTHY;

		// Analyze individual health checks
		for (const [name, check] of this.healthChecks.entries()) {
			const result = check.lastResult || { status: HEALTH_STATUS.UNKNOWN };
			checks[name] = {
				...result,
				type: check.config.type,
				critical: check.config.critical,
				description: check.config.description,
				responseTime: check.responseTime,
				successRate: this._calculateSuccessRate(check)
			};

			// Determine impact on overall status
			if (result.status === HEALTH_STATUS.CRITICAL) {
				overallStatus = HEALTH_STATUS.CRITICAL;
			} else if (
				result.status === HEALTH_STATUS.UNHEALTHY &&
				overallStatus !== HEALTH_STATUS.CRITICAL
			) {
				if (check.config.critical) {
					overallStatus = HEALTH_STATUS.CRITICAL;
				} else {
					overallStatus = HEALTH_STATUS.UNHEALTHY;
				}
			} else if (
				result.status === HEALTH_STATUS.DEGRADED &&
				overallStatus === HEALTH_STATUS.HEALTHY
			) {
				overallStatus = HEALTH_STATUS.DEGRADED;
			}

			// Collect issues
			if (result.status !== HEALTH_STATUS.HEALTHY) {
				issues.push({
					check: name,
					status: result.status,
					message: result.message || 'Health check failed',
					critical: check.config.critical,
					timestamp: result.timestamp || now
				});
			}
		}

		// Include circuit breaker health if available
		const circuitBreakerHealth = this._getCircuitBreakerHealth();

		// Calculate summary statistics
		const summary = {
			totalChecks: this.healthChecks.size,
			healthyChecks: Object.values(checks).filter(
				(c) => c.status === HEALTH_STATUS.HEALTHY
			).length,
			unhealthyChecks: Object.values(checks).filter(
				(c) => c.status !== HEALTH_STATUS.HEALTHY
			).length,
			criticalIssues: issues.filter((i) => i.critical).length,
			lastUpdated: now,
			uptime: this._getUptime(),
			...circuitBreakerHealth
		};

		this.systemHealth = {
			status: overallStatus,
			checks,
			issues,
			summary,
			lastUpdated: now
		};

		return this.systemHealth;
	}

	/**
	 * Get detailed health information for a specific check or all checks
	 *
	 * @param {string} [checkName] - Optional check name
	 * @returns {Object|null} Health details
	 */
	getHealthDetails(checkName) {
		if (checkName) {
			const check = this.healthChecks.get(checkName);
			if (!check) {
				return null;
			}

			return {
				name: checkName,
				config: check.config,
				lastResult: check.lastResult,
				totalChecks: check.totalChecks,
				totalFailures: check.totalFailures,
				consecutiveFailures: check.consecutiveFailures,
				successRate: this._calculateSuccessRate(check),
				averageResponseTime: check.responseTime,
				lastCheck: check.lastCheck
			};
		}

		// Return details for all checks
		const details = {};
		for (const [name, check] of this.healthChecks.entries()) {
			details[name] = {
				name,
				config: check.config,
				lastResult: check.lastResult,
				totalChecks: check.totalChecks,
				totalFailures: check.totalFailures,
				consecutiveFailures: check.consecutiveFailures,
				successRate: this._calculateSuccessRate(check),
				averageResponseTime: check.responseTime,
				lastCheck: check.lastCheck
			};
		}

		return details;
	}

	/**
	 * Record a performance metric
	 *
	 * @param {string} name - Metric name
	 * @param {number} value - Metric value
	 * @param {Object} tags - Optional tags
	 * @returns {void}
	 */
	recordMetric(name, value, tags = {}) {
		if (!this.config.enableMetrics) {
			return;
		}

		const now = Date.now();

		if (!this.metrics.has(name)) {
			this.metrics.set(name, {
				count: 0,
				sum: 0,
				avg: 0,
				min: value,
				max: value,
				values: [],
				tags
			});
		}

		const metric = this.metrics.get(name);

		// Add new value
		metric.values.push({ value, timestamp: now });
		metric.count++;
		metric.sum += value;
		metric.avg = metric.sum / metric.count;
		metric.min = Math.min(metric.min, value);
		metric.max = Math.max(metric.max, value);

		// Clean up old values
		this._cleanupOldMetricValues(metric);

		if (this._isDebugEnabled()) {
			this.logger.debug(`Metric recorded: ${name}=${value}`, tags);
		}
	}

	/**
	 * Get metrics for a specific metric or all metrics
	 *
	 * @param {string} [metricName] - Optional metric name
	 * @returns {Object|null} Metrics data
	 */
	getMetrics(metricName) {
		if (metricName) {
			return this.metrics.get(metricName) || null;
		}

		const allMetrics = {};
		for (const [name, metric] of this.metrics.entries()) {
			allMetrics[name] = { ...metric };
		}

		return allMetrics;
	}

	/**
	 * Check if monitoring is healthy
	 *
	 * @returns {boolean} True if system is healthy
	 */
	isHealthy() {
		const health = this.getSystemHealth();
		return health.status === HEALTH_STATUS.HEALTHY;
	}

	/**
	 * Reset all health checks and metrics
	 *
	 * @returns {void}
	 */
	reset() {
		this.healthChecks.clear();
		this.metrics.clear();
		this.systemHealth = null;
		this.logger.info('Health monitoring reset');
	}

	/**
	 * Add event listener
	 *
	 * @param {string} event - Event name
	 * @param {Function} listener - Event listener
	 * @returns {void}
	 */
	on(event, listener) {
		if (!this.listeners.has(event)) {
			this.listeners.set(event, []);
		}
		this.listeners.get(event).push(listener);
	}

	/**
	 * Remove event listener
	 *
	 * @param {string} event - Event name
	 * @param {Function} listener - Event listener
	 * @returns {void}
	 */
	off(event, listener) {
		if (!this.listeners.has(event)) {
			return;
		}

		const listeners = this.listeners.get(event);
		const index = listeners.indexOf(listener);
		if (index > -1) {
			listeners.splice(index, 1);
		}
	}

	// Private methods

	/**
	 * Run all registered health checks
	 *
	 * @returns {Promise<void>}
	 * @private
	 */
	async _runHealthChecks() {
		const now = Date.now();
		const promises = [];

		for (const [name, check] of this.healthChecks.entries()) {
			promises.push(this._runSingleCheck(name, check));
		}

		try {
			await Promise.allSettled(promises);
			this._invalidateCache();
			this._cleanupOldData();
		} catch (error) {
			this.logger.error('Error running health checks:', error.message);
		}
	}

	/**
	 * Run a single health check
	 *
	 * @param {string} name - Check name
	 * @param {Object} check - Check configuration
	 * @returns {Promise<void>}
	 * @private
	 */
	async _runSingleCheck(name, check) {
		const startTime = Date.now();

		try {
			check.totalChecks++;
			check.lastCheck = startTime;

			// Run the check with timeout
			const result = await Promise.race([
				check.checkFn(),
				new Promise((_, reject) =>
					this.timer.setTimeout(
						() => reject(new Error('Health check timeout')),
						check.config.timeout
					)
				)
			]);

			const endTime = Date.now();
			check.responseTime = endTime - startTime;

			// Validate result format
			const validatedResult = this._validateCheckResult(result);
			validatedResult.timestamp = endTime;
			validatedResult.responseTime = check.responseTime;

			check.lastResult = validatedResult;

			if (validatedResult.status === HEALTH_STATUS.HEALTHY) {
				check.consecutiveFailures = 0;
			} else {
				check.totalFailures++;
				check.consecutiveFailures++;
			}

			// Record response time metric
			this.recordMetric(
				`health_check_response_time_${name}`,
				check.responseTime
			);
		} catch (error) {
			const endTime = Date.now();
			check.responseTime = endTime - startTime;
			check.totalFailures++;
			check.consecutiveFailures++;

			check.lastResult = {
				status: HEALTH_STATUS.UNHEALTHY,
				message: error.message,
				timestamp: endTime,
				responseTime: check.responseTime
			};

			this.logger.error(`Health check failed: ${name}`, error.message);
		}
	}

	/**
	 * Validate health check result format
	 *
	 * @param {any} result - Check result
	 * @returns {Object} Validated result
	 * @private
	 */
	_validateCheckResult(result) {
		if (!result || typeof result !== 'object') {
			return {
				status: HEALTH_STATUS.UNKNOWN,
				message: 'Invalid health check result format'
			};
		}

		if (!Object.values(HEALTH_STATUS).includes(result.status)) {
			return {
				status: HEALTH_STATUS.UNKNOWN,
				message: 'Invalid health status',
				originalResult: result
			};
		}

		return {
			status: result.status,
			message: result.message || '',
			data: result.data || null
		};
	}

	/**
	 * Calculate success rate for a health check
	 *
	 * @param {Object} check - Check object
	 * @returns {number} Success rate percentage
	 * @private
	 */
	_calculateSuccessRate(check) {
		if (check.totalChecks === 0) {
			return 0;
		}
		return Math.round(
			((check.totalChecks - check.totalFailures) / check.totalChecks) * 100
		);
	}

	/**
	 * Get circuit breaker health information
	 *
	 * @returns {Object} Circuit breaker health summary
	 * @private
	 */
	_getCircuitBreakerHealth() {
		if (!this.circuitBreakerRegistry) {
			return { circuitBreakers: null };
		}

		try {
			const statuses = this.circuitBreakerRegistry.getAllStatuses();
			const total = Object.keys(statuses).length;
			const unhealthy = Object.values(statuses).filter(
				(status) => !status.metrics || !status.metrics.isHealthy
			).length;

			return {
				circuitBreakers: {
					total,
					healthy: total - unhealthy,
					unhealthy
				}
			};
		} catch (error) {
			this.logger.error('Error getting circuit breaker health:', error.message);
			return { circuitBreakers: null };
		}
	}

	/**
	 * Get system uptime
	 *
	 * @returns {number} Uptime in milliseconds
	 * @private
	 */
	_getUptime() {
		return process.uptime ? process.uptime() * 1000 : Date.now();
	}

	/**
	 * Clean up old metric values
	 *
	 * @param {Object} metric - Metric object
	 * @private
	 */
	_cleanupOldMetricValues(metric) {
		const cutoff = Date.now() - this.config.performanceWindow;
		metric.values = metric.values.filter((v) => v.timestamp > cutoff);

		// Recalculate statistics based on remaining values
		if (metric.values.length > 0) {
			metric.count = metric.values.length;
			metric.sum = metric.values.reduce((sum, v) => sum + v.value, 0);
			metric.avg = metric.sum / metric.count;
			metric.min = Math.min(...metric.values.map((v) => v.value));
			metric.max = Math.max(...metric.values.map((v) => v.value));
		}
	}

	/**
	 * Clean up old data periodically
	 *
	 * @private
	 */
	_cleanupOldData() {
		const now = Date.now();

		// Only cleanup every 5 minutes
		if (now - this.lastCleanup < 300000) {
			return;
		}

		this.lastCleanup = now;

		// Clean up old metric values
		for (const metric of this.metrics.values()) {
			this._cleanupOldMetricValues(metric);
		}
	}

	/**
	 * Invalidate system health cache
	 *
	 * @private
	 */
	_invalidateCache() {
		this.systemHealth = null;
	}

	/**
	 * Check if debug logging is enabled
	 *
	 * @returns {boolean} True if debug enabled
	 * @private
	 */
	_isDebugEnabled() {
		if (this.configManager && this.configManager.getLogLevel) {
			const level = this.configManager.getLogLevel();
			return level === 'debug' || level === 'verbose';
		}
		return false;
	}

	/**
	 * Emit an event to listeners
	 *
	 * @param {string} event - Event name
	 * @param {any} data - Event data
	 * @private
	 */
	_emit(event, data) {
		if (!this.listeners.has(event)) {
			return;
		}

		for (const listener of this.listeners.get(event)) {
			try {
				listener(data);
			} catch (error) {
				this.logger.error(`Event listener error for ${event}:`, error.message);
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
			setInterval: (fn, interval) => setInterval(fn, interval),
			clearTimeout: (id) => clearTimeout(id),
			clearInterval: (id) => clearInterval(id),
			now: () => Date.now()
		};
	}
}
