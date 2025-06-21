/**
 * @fileoverview Recovery Manager System
 *
 * This module provides automated recovery mechanisms for failed integrations,
 * including self-healing capabilities, fallback strategies, and recovery orchestration.
 */

import { log } from '../utils.js';
import { circuitBreakerRegistry } from './circuit-breaker.js';
import { healthMonitor } from './health-monitor.js';
import { errorBoundaryRegistry } from './error-boundary.js';

/**
 * Recovery strategies
 */
export const RECOVERY_STRATEGY = {
	IMMEDIATE_RETRY: 'immediate_retry',
	DELAYED_RETRY: 'delayed_retry',
	EXPONENTIAL_BACKOFF: 'exponential_backoff',
	CIRCUIT_RESET: 'circuit_reset',
	BOUNDARY_RESET: 'boundary_reset',
	FALLBACK: 'fallback',
	ISOLATION: 'isolation',
	ESCALATION: 'escalation',
	MANUAL: 'manual'
};

/**
 * Recovery status
 */
export const RECOVERY_STATUS = {
	PENDING: 'pending',
	IN_PROGRESS: 'in_progress',
	SUCCESS: 'success',
	FAILURE: 'failure',
	CANCELLED: 'cancelled'
};

/**
 * Automated recovery manager for integration failures
 */
export class RecoveryManager {
	/**
	 * @param {Object} config - Configuration options
	 */
	constructor(config = {}) {
		this.config = {
			enableAutoRecovery: true,
			maxRecoveryAttempts: 3,
			recoveryInterval: 60000, // 1 minute between recovery attempts
			healthCheckInterval: 30000, // 30 seconds between health checks
			escalationThreshold: 5, // Failures before escalation
			backoffMultiplier: 2,
			maxBackoffDelay: 300000, // 5 minutes max backoff
			enableSelfHealing: true,
			enableFallbackRecovery: true,
			retentionPeriod: 86400000, // 24 hours
			...config
		};

		// Recovery state
		this.recoveryJobs = new Map();
		this.recoveryHistory = [];
		this.isRunning = false;
		this.recoveryTimer = null;
		this.healthCheckTimer = null;

		// Recovery strategies registry
		this.strategies = new Map();
		this._registerBuiltInStrategies();

		// Statistics
		this.stats = {
			totalRecoveries: 0,
			successfulRecoveries: 0,
			failedRecoveries: 0,
			averageRecoveryTime: 0,
			totalRecoveryTime: 0,
			lastRecovery: null,
			strategiesUsed: new Map()
		};

		// Event handlers
		this.eventHandlers = {
			'recovery:started': [],
			'recovery:completed': [],
			'recovery:failed': [],
			'recovery:escalated': [],
			'health:degraded': [],
			'health:recovered': []
		};

		// Bind methods
		this._runRecoveryLoop = this._runRecoveryLoop.bind(this);
		this._runHealthChecks = this._runHealthChecks.bind(this);
	}

	/**
	 * Start the recovery manager
	 */
	start() {
		if (this.isRunning) {
			log('warn', 'Recovery manager is already running');
			return;
		}

		this.isRunning = true;
		log('info', 'Recovery manager started');

		// Start recovery and health check loops
		if (this.config.enableAutoRecovery) {
			this.recoveryTimer = setInterval(
				this._runRecoveryLoop,
				this.config.recoveryInterval
			);
		}

		this.healthCheckTimer = setInterval(
			this._runHealthChecks,
			this.config.healthCheckInterval
		);

		// Run initial checks
		this._runHealthChecks();
	}

	/**
	 * Stop the recovery manager
	 */
	stop() {
		if (!this.isRunning) {
			return;
		}

		this.isRunning = false;

		if (this.recoveryTimer) {
			clearInterval(this.recoveryTimer);
			this.recoveryTimer = null;
		}

		if (this.healthCheckTimer) {
			clearInterval(this.healthCheckTimer);
			this.healthCheckTimer = null;
		}

		log('info', 'Recovery manager stopped');
	}

	/**
	 * Register a custom recovery strategy
	 *
	 * @param {string} name - Strategy name
	 * @param {Function} strategyFn - Strategy function
	 * @param {Object} options - Strategy options
	 */
	registerStrategy(name, strategyFn, options = {}) {
		if (typeof strategyFn !== 'function') {
			throw new Error('Recovery strategy must be a function');
		}

		this.strategies.set(name, {
			name,
			fn: strategyFn,
			options: {
				timeout: 30000,
				retries: 1,
				...options
			}
		});

		log('debug', `Registered recovery strategy: ${name}`);
	}

	/**
	 * Trigger manual recovery for a specific integration
	 *
	 * @param {string} integrationName - Integration name
	 * @param {string} strategy - Recovery strategy
	 * @param {Object} options - Recovery options
	 * @returns {Promise<Object>} Recovery result
	 */
	async triggerRecovery(
		integrationName,
		strategy = RECOVERY_STRATEGY.IMMEDIATE_RETRY,
		options = {}
	) {
		const jobId = `recovery_${integrationName}_${Date.now()}`;

		const job = {
			id: jobId,
			integrationName,
			strategy,
			status: RECOVERY_STATUS.PENDING,
			attempts: 0,
			maxAttempts: options.maxAttempts || this.config.maxRecoveryAttempts,
			startTime: Date.now(),
			lastAttempt: 0,
			options,
			history: []
		};

		this.recoveryJobs.set(jobId, job);

		try {
			const result = await this._executeRecovery(job);
			return result;
		} catch (error) {
			log(
				'error',
				`Manual recovery failed for ${integrationName}:`,
				error.message
			);
			throw error;
		}
	}

	/**
	 * Get recovery status for an integration
	 *
	 * @param {string} integrationName - Integration name
	 * @returns {Object|null} Recovery status
	 */
	getRecoveryStatus(integrationName) {
		// Find the most recent recovery job for this integration
		let latestJob = null;

		for (const job of this.recoveryJobs.values()) {
			if (job.integrationName === integrationName) {
				if (!latestJob || job.startTime > latestJob.startTime) {
					latestJob = job;
				}
			}
		}

		if (!latestJob) {
			return null;
		}

		return {
			jobId: latestJob.id,
			status: latestJob.status,
			strategy: latestJob.strategy,
			attempts: latestJob.attempts,
			maxAttempts: latestJob.maxAttempts,
			startTime: latestJob.startTime,
			duration:
				latestJob.status === RECOVERY_STATUS.IN_PROGRESS
					? Date.now() - latestJob.startTime
					: latestJob.endTime - latestJob.startTime,
			lastError: latestJob.lastError
		};
	}

	/**
	 * Get overall recovery statistics
	 *
	 * @returns {Object} Recovery statistics
	 */
	getStats() {
		const activeJobs = Array.from(this.recoveryJobs.values()).filter(
			(job) => job.status === RECOVERY_STATUS.IN_PROGRESS
		).length;

		const recentRecoveries = this.recoveryHistory.filter(
			(r) => Date.now() - r.timestamp < 3600000
		).length; // Last hour

		return {
			...this.stats,
			activeRecoveries: activeJobs,
			recentRecoveries,
			strategiesUsed: Object.fromEntries(this.stats.strategiesUsed),
			isRunning: this.isRunning
		};
	}

	/**
	 * Cancel a recovery job
	 *
	 * @param {string} jobId - Job ID
	 * @returns {boolean} True if cancelled
	 */
	cancelRecovery(jobId) {
		const job = this.recoveryJobs.get(jobId);

		if (!job || job.status !== RECOVERY_STATUS.IN_PROGRESS) {
			return false;
		}

		job.status = RECOVERY_STATUS.CANCELLED;
		job.endTime = Date.now();

		log('info', `Recovery job cancelled: ${jobId}`);
		return true;
	}

	/**
	 * Get recovery history
	 *
	 * @param {number} limit - Number of records to return
	 * @returns {Array} Recovery history
	 */
	getRecoveryHistory(limit = 50) {
		return this.recoveryHistory
			.sort((a, b) => b.timestamp - a.timestamp)
			.slice(0, limit);
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
	 * Execute a recovery job
	 *
	 * @param {Object} job - Recovery job
	 * @returns {Promise<Object>} Recovery result
	 * @private
	 */
	async _executeRecovery(job) {
		job.status = RECOVERY_STATUS.IN_PROGRESS;
		job.attempts++;
		job.lastAttempt = Date.now();

		this._emitEvent('recovery:started', {
			jobId: job.id,
			integrationName: job.integrationName,
			strategy: job.strategy,
			attempt: job.attempts
		});

		const startTime = Date.now();

		try {
			const strategy = this.strategies.get(job.strategy);
			if (!strategy) {
				throw new Error(`Unknown recovery strategy: ${job.strategy}`);
			}

			// Execute the recovery strategy
			const result = await strategy.fn(job.integrationName, job.options);

			const duration = Date.now() - startTime;

			// Mark job as successful
			job.status = RECOVERY_STATUS.SUCCESS;
			job.endTime = Date.now();
			job.result = result;

			// Update statistics
			this.stats.totalRecoveries++;
			this.stats.successfulRecoveries++;
			this.stats.totalRecoveryTime += duration;
			this.stats.averageRecoveryTime =
				this.stats.totalRecoveryTime / this.stats.totalRecoveries;
			this.stats.lastRecovery = Date.now();

			const strategyCount = this.stats.strategiesUsed.get(job.strategy) || 0;
			this.stats.strategiesUsed.set(job.strategy, strategyCount + 1);

			// Add to history
			this._recordRecovery(job, 'success', duration);

			this._emitEvent('recovery:completed', {
				jobId: job.id,
				integrationName: job.integrationName,
				strategy: job.strategy,
				duration,
				result
			});

			log(
				'info',
				`Recovery successful for ${job.integrationName} using ${job.strategy} (${duration}ms)`
			);

			return {
				success: true,
				duration,
				strategy: job.strategy,
				result
			};
		} catch (error) {
			const duration = Date.now() - startTime;

			job.lastError = error.message;
			job.history.push({
				attempt: job.attempts,
				timestamp: Date.now(),
				error: error.message,
				duration
			});

			// Check if we should retry
			if (job.attempts < job.maxAttempts) {
				log(
					'warn',
					`Recovery attempt ${job.attempts} failed for ${job.integrationName}: ${error.message}. Retrying...`
				);

				// Calculate backoff delay
				const backoffDelay = Math.min(
					this.config.recoveryInterval *
						Math.pow(this.config.backoffMultiplier, job.attempts - 1),
					this.config.maxBackoffDelay
				);

				// Schedule retry
				setTimeout(() => {
					if (job.status === RECOVERY_STATUS.IN_PROGRESS) {
						this._executeRecovery(job);
					}
				}, backoffDelay);

				return {
					success: false,
					retrying: true,
					attempt: job.attempts,
					nextAttemptIn: backoffDelay,
					error: error.message
				};
			} else {
				// All attempts exhausted
				job.status = RECOVERY_STATUS.FAILURE;
				job.endTime = Date.now();

				this.stats.totalRecoveries++;
				this.stats.failedRecoveries++;

				this._recordRecovery(job, 'failure', duration);

				this._emitEvent('recovery:failed', {
					jobId: job.id,
					integrationName: job.integrationName,
					strategy: job.strategy,
					attempts: job.attempts,
					error: error.message
				});

				// Check if we should escalate
				if (job.attempts >= this.config.escalationThreshold) {
					this._escalateRecovery(job);
				}

				log(
					'error',
					`Recovery failed for ${job.integrationName} after ${job.attempts} attempts: ${error.message}`
				);

				throw error;
			}
		}
	}

	/**
	 * Run the recovery loop to check for unhealthy integrations
	 *
	 * @private
	 */
	async _runRecoveryLoop() {
		if (!this.config.enableAutoRecovery) {
			return;
		}

		try {
			// Check circuit breakers
			const circuitBreakerStatuses = circuitBreakerRegistry.getAllStatuses();
			for (const [name, status] of Object.entries(circuitBreakerStatuses)) {
				if (status.state === 'open' && !this._hasActiveRecovery(name)) {
					log('debug', `Triggering recovery for open circuit breaker: ${name}`);
					await this.triggerRecovery(name, RECOVERY_STRATEGY.CIRCUIT_RESET);
				}
			}

			// Check error boundaries
			const boundaryStatuses = errorBoundaryRegistry.getAllStatuses();
			for (const [name, status] of Object.entries(boundaryStatuses)) {
				if (status.isIsolated && !this._hasActiveRecovery(name)) {
					log('debug', `Triggering recovery for isolated boundary: ${name}`);
					await this.triggerRecovery(name, RECOVERY_STRATEGY.BOUNDARY_RESET);
				}
			}

			// Clean up completed jobs
			this._cleanupCompletedJobs();
		} catch (error) {
			log('error', 'Recovery loop failed:', error.message);
		}
	}

	/**
	 * Run health checks and trigger recovery if needed
	 *
	 * @private
	 */
	async _runHealthChecks() {
		try {
			const systemHealth = healthMonitor.getSystemHealth();

			if (
				systemHealth.status === 'unhealthy' ||
				systemHealth.status === 'critical'
			) {
				this._emitEvent('health:degraded', {
					status: systemHealth.status,
					issues: systemHealth.issues,
					timestamp: Date.now()
				});

				// Trigger recovery for unhealthy integrations
				if (this.config.enableSelfHealing) {
					for (const issue of systemHealth.issues) {
						if (
							issue.severity === 'critical' &&
							!this._hasActiveRecovery(issue.check)
						) {
							log(
								'warn',
								`Triggering self-healing for critical issue: ${issue.check}`
							);
							await this.triggerRecovery(
								issue.check,
								RECOVERY_STRATEGY.ESCALATION
							);
						}
					}
				}
			}
		} catch (error) {
			log('error', 'Health check failed:', error.message);
		}
	}

	/**
	 * Register built-in recovery strategies
	 *
	 * @private
	 */
	_registerBuiltInStrategies() {
		// Immediate retry strategy
		this.registerStrategy(
			RECOVERY_STRATEGY.IMMEDIATE_RETRY,
			async (integrationName, options) => {
				const boundary = errorBoundaryRegistry.getBoundary(integrationName);
				boundary.reset();
				return { action: 'boundary_reset', timestamp: Date.now() };
			}
		);

		// Circuit breaker reset strategy
		this.registerStrategy(
			RECOVERY_STRATEGY.CIRCUIT_RESET,
			async (integrationName, options) => {
				const breaker = circuitBreakerRegistry.getBreaker(integrationName);
				breaker.reset();
				return { action: 'circuit_breaker_reset', timestamp: Date.now() };
			}
		);

		// Error boundary reset strategy
		this.registerStrategy(
			RECOVERY_STRATEGY.BOUNDARY_RESET,
			async (integrationName, options) => {
				const boundary = errorBoundaryRegistry.getBoundary(integrationName);
				boundary.recover('auto_recovery');
				return { action: 'boundary_recovered', timestamp: Date.now() };
			}
		);

		// Fallback strategy
		this.registerStrategy(
			RECOVERY_STRATEGY.FALLBACK,
			async (integrationName, options) => {
				// Implementation depends on specific integration
				// This is a placeholder that should be overridden
				return { action: 'fallback_activated', timestamp: Date.now() };
			}
		);

		// Escalation strategy
		this.registerStrategy(
			RECOVERY_STRATEGY.ESCALATION,
			async (integrationName, options) => {
				// Log critical alert and reset all related components
				log(
					'error',
					`ESCALATION: Critical failure in ${integrationName} - resetting all components`
				);

				const boundary = errorBoundaryRegistry.getBoundary(integrationName);
				const breaker = circuitBreakerRegistry.getBreaker(integrationName);

				boundary.reset();
				breaker.reset();

				return {
					action: 'escalation_reset',
					timestamp: Date.now(),
					components: ['boundary', 'circuit_breaker']
				};
			}
		);
	}

	/**
	 * Check if there's an active recovery for an integration
	 *
	 * @param {string} integrationName - Integration name
	 * @returns {boolean} True if active recovery exists
	 * @private
	 */
	_hasActiveRecovery(integrationName) {
		for (const job of this.recoveryJobs.values()) {
			if (
				job.integrationName === integrationName &&
				job.status === RECOVERY_STATUS.IN_PROGRESS
			) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Escalate a failed recovery
	 *
	 * @param {Object} job - Recovery job
	 * @private
	 */
	_escalateRecovery(job) {
		const escalation = {
			integrationName: job.integrationName,
			jobId: job.id,
			attempts: job.attempts,
			errors: job.history.map((h) => h.error),
			timestamp: Date.now()
		};

		this._emitEvent('recovery:escalated', escalation);

		log(
			'error',
			`ESCALATION: Recovery failed for ${job.integrationName} after ${job.attempts} attempts`
		);
	}

	/**
	 * Record recovery in history
	 *
	 * @param {Object} job - Recovery job
	 * @param {string} outcome - Recovery outcome
	 * @param {number} duration - Recovery duration
	 * @private
	 */
	_recordRecovery(job, outcome, duration) {
		const record = {
			timestamp: Date.now(),
			integrationName: job.integrationName,
			strategy: job.strategy,
			outcome,
			duration,
			attempts: job.attempts,
			error: job.lastError
		};

		this.recoveryHistory.push(record);

		// Clean up old history
		const cutoff = Date.now() - this.config.retentionPeriod;
		this.recoveryHistory = this.recoveryHistory.filter(
			(r) => r.timestamp > cutoff
		);
	}

	/**
	 * Clean up completed recovery jobs
	 *
	 * @private
	 */
	_cleanupCompletedJobs() {
		const cutoff = Date.now() - 3600000; // 1 hour

		for (const [jobId, job] of this.recoveryJobs.entries()) {
			if (
				job.status !== RECOVERY_STATUS.IN_PROGRESS &&
				job.endTime &&
				job.endTime < cutoff
			) {
				this.recoveryJobs.delete(jobId);
			}
		}
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
					`Recovery manager event handler failed for ${eventType}:`,
					error.message
				);
			}
		}
	}
}

// Global recovery manager instance
export const recoveryManager = new RecoveryManager();
