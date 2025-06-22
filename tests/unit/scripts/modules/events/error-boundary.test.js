/**
 * Error Boundary and Isolation System Tests
 */

import { jest } from '@jest/globals';

// Mock dependencies
jest.mock('../../../../../scripts/modules/utils.js', () => ({
	log: jest.fn()
}));

jest.mock('../../../../../scripts/modules/config-manager.js', () => ({
	getLogLevel: jest.fn(() => 'info'),
	getGlobalConfig: jest.fn(() => ({}))
}));

jest.mock('../../../../../scripts/modules/events/circuit-breaker.js', () => ({
	circuitBreakerRegistry: {
		getBreaker: jest.fn(() => ({
			execute: jest.fn(),
			getStatus: jest.fn(() => ({ state: 'closed' })),
			reset: jest.fn()
		}))
	}
}));

jest.mock('../../../../../scripts/modules/events/health-monitor.js', () => ({
	healthMonitor: {
		recordMetric: jest.fn()
	}
}));

import {
	ErrorBoundary,
	ErrorBoundaryRegistry,
	IsolationError,
	ERROR_SEVERITY,
	ERROR_CATEGORY,
	RECOVERY_STRATEGY
} from '../../../../../scripts/modules/events/error-boundary.js';

describe('ErrorBoundary', () => {
	let errorBoundary;
	const mockFunction = jest.fn();

	beforeEach(() => {
		jest.clearAllMocks();
		errorBoundary = new ErrorBoundary({
			name: 'test-boundary',
			maxConcurrentErrors: 5,
			errorWindowMs: 10000,
			maxRetries: 2,
			retryDelay: 100,
			timeoutMs: 1000
		});
		mockFunction.mockClear();
		// Reset boundary state to ensure clean tests
		errorBoundary.reset();
	});

	describe('constructor', () => {
		test('should initialize with default configuration', () => {
			const boundary = new ErrorBoundary();
			expect(boundary.config.name).toBe('default');
			expect(boundary.isIsolated).toBe(false);
			expect(boundary.stats.totalExecutions).toBe(0);
		});

		test('should initialize with custom configuration', () => {
			const config = { name: 'custom', maxRetries: 5 };
			const boundary = new ErrorBoundary(config);
			expect(boundary.config.name).toBe('custom');
			expect(boundary.config.maxRetries).toBe(5);
		});
	});

	describe('execute method', () => {
		test('should execute function successfully', async () => {
			mockFunction.mockResolvedValue('success');

			const result = await errorBoundary.execute(mockFunction, ['arg1']);

			expect(result).toBe('success');
			expect(mockFunction).toHaveBeenCalledWith('arg1');
			expect(errorBoundary.stats.successfulExecutions).toBe(1);
			expect(errorBoundary.stats.totalExecutions).toBe(1);
		});

		test('should block execution when isolated', async () => {
			errorBoundary.isolate('test isolation');

			await expect(errorBoundary.execute(mockFunction)).rejects.toThrow(
				IsolationError
			);

			expect(mockFunction).not.toHaveBeenCalled();
			expect(errorBoundary.stats.isolatedExecutions).toBe(1);
		});

		test('should execute fallback when isolated', async () => {
			errorBoundary.isolate('test isolation');
			const fallback = jest.fn().mockResolvedValue('fallback-result');

			const result = await errorBoundary.execute(mockFunction, [], {
				fallback
			});

			expect(result).toBe('fallback-result');
			expect(mockFunction).not.toHaveBeenCalled();
			expect(fallback).toHaveBeenCalled();
			expect(errorBoundary.stats.fallbackExecutions).toBe(1);
		});

		test('should retry on retryable errors', async () => {
			const error = new Error('network timeout');
			mockFunction.mockRejectedValueOnce(error);
			mockFunction.mockResolvedValueOnce('success');

			const result = await errorBoundary.execute(mockFunction);

			expect(result).toBe('success');
			expect(mockFunction).toHaveBeenCalledTimes(2);
			expect(errorBoundary.stats.retriedExecutions).toBe(1);
		});

		test('should respect timeout limits', async () => {
			mockFunction.mockImplementation(
				() => new Promise((resolve) => setTimeout(resolve, 2000))
			);

			await expect(
				errorBoundary.execute(mockFunction, [], { timeout: 500 })
			).rejects.toThrow('timeout');
		});

		test('should classify and handle different error types', async () => {
			// Ensure clean state
			errorBoundary.reset();

			const networkError = new Error('ECONNREFUSED');
			mockFunction.mockClear();
			mockFunction.mockRejectedValue(networkError);

			try {
				// Execute with no retries to test classification only
				await errorBoundary.execute(mockFunction, [], { retries: 0 });
			} catch (e) {
				// Expected to fail
			}

			expect(errorBoundary.errors).toHaveLength(1);
			expect(errorBoundary.errors[0].classification.category).toBe(
				ERROR_CATEGORY.NETWORK
			);
		});

		test('should execute fallback after retries exhausted', async () => {
			// Ensure clean state
			errorBoundary.reset();

			// Use a retryable error type (network error)
			const error = new Error('ECONNREFUSED');
			mockFunction.mockClear(); // Clear any previous calls
			mockFunction.mockRejectedValue(error);
			const fallback = jest.fn().mockResolvedValue('fallback-result');

			const result = await errorBoundary.execute(mockFunction, [], {
				retries: 1,
				fallback
			});

			expect(result).toBe('fallback-result');
			expect(mockFunction).toHaveBeenCalledTimes(2); // Initial + 1 retry
			expect(fallback).toHaveBeenCalled();
		});
	});

	describe('handleError method', () => {
		test('should classify and record errors', () => {
			const error = new Error('Test error');
			const result = errorBoundary.handleError(error, { context: 'test' });

			expect(result).toHaveProperty('classification');
			expect(result).toHaveProperty('recoveryStrategy');
			expect(errorBoundary.errors).toHaveLength(1);
		});

		test('should determine appropriate recovery strategies', () => {
			// Test critical error leading to isolation
			const criticalError = new Error('Out of memory');
			const result1 = errorBoundary.handleError(criticalError);

			// Test retryable network error
			const networkError = new Error('ECONNREFUSED');
			const result2 = errorBoundary.handleError(networkError);

			expect(result1.recoveryStrategy).toBe(RECOVERY_STRATEGY.ISOLATE);
			expect(result2.recoveryStrategy).toBe(RECOVERY_STRATEGY.RETRY);
		});
	});

	describe('isolate method', () => {
		test('should isolate boundary with reason', () => {
			const handler = jest.fn();
			errorBoundary.on('isolation:started', handler);

			errorBoundary.isolate('test reason', 5000);

			expect(errorBoundary.isIsolated).toBe(true);
			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					reason: 'test reason',
					duration: 5000
				})
			);
		});

		test('should auto-recover after duration', async () => {
			const handler = jest.fn();
			errorBoundary.on('isolation:ended', handler);

			errorBoundary.isolate('test reason', 50); // Short duration for test

			expect(errorBoundary.isIsolated).toBe(true);

			// Wait for auto-recovery
			await new Promise((resolve) => setTimeout(resolve, 60));

			expect(errorBoundary.isIsolated).toBe(false);
			expect(handler).toHaveBeenCalled();
		});
	});

	describe('recover method', () => {
		test('should recover from isolation', () => {
			const handler = jest.fn();
			errorBoundary.on('isolation:ended', handler);

			errorBoundary.isolate('test');
			errorBoundary.recover('manual recovery');

			expect(errorBoundary.isIsolated).toBe(false);
			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					reason: 'manual recovery'
				})
			);
		});

		test('should do nothing if not isolated', () => {
			const handler = jest.fn();
			errorBoundary.on('isolation:ended', handler);

			errorBoundary.recover('manual recovery');

			expect(handler).not.toHaveBeenCalled();
		});
	});

	describe('getStatus method', () => {
		test('should return current boundary status', () => {
			const status = errorBoundary.getStatus();

			expect(status).toHaveProperty('name');
			expect(status).toHaveProperty('isIsolated');
			expect(status).toHaveProperty('stats');
			expect(status).toHaveProperty('recentErrors');
			expect(status).toHaveProperty('errorRate');
			expect(status).toHaveProperty('healthStatus');
		});

		test('should calculate error rate correctly', () => {
			// Simulate some executions
			errorBoundary.stats.successfulExecutions = 7;
			errorBoundary.stats.failedExecutions = 3;

			const status = errorBoundary.getStatus();
			expect(status.errorRate).toBe(0.3); // 3 failures out of 10 total
		});

		test('should determine health status correctly', () => {
			// Test healthy state
			errorBoundary.stats.successfulExecutions = 9;
			errorBoundary.stats.failedExecutions = 1;

			let status = errorBoundary.getStatus();
			expect(status.healthStatus).toBe('healthy');

			// Test unhealthy state
			errorBoundary.stats.successfulExecutions = 3;
			errorBoundary.stats.failedExecutions = 7;

			status = errorBoundary.getStatus();
			expect(status.healthStatus).toBe('unhealthy');
		});
	});

	describe('reset method', () => {
		test('should reset boundary state', () => {
			// Add some errors and change state
			errorBoundary.errors.push({ timestamp: Date.now() });
			errorBoundary.stats.totalExecutions = 10;
			errorBoundary.isolate('test');

			errorBoundary.reset();

			expect(errorBoundary.errors).toHaveLength(0);
			expect(errorBoundary.stats.totalExecutions).toBe(0);
			expect(errorBoundary.isIsolated).toBe(false);
		});
	});

	describe('error classification', () => {
		test('should classify network errors correctly', () => {
			const networkError = new Error('ECONNREFUSED');
			const classification = errorBoundary._classifyError(networkError);

			expect(classification.category).toBe(ERROR_CATEGORY.NETWORK);
			expect(classification.severity).toBe(ERROR_SEVERITY.HIGH);
			expect(classification.retryable).toBe(true);
		});

		test('should classify timeout errors correctly', () => {
			const timeoutError = new Error('Operation timeout');
			const classification = errorBoundary._classifyError(timeoutError);

			expect(classification.category).toBe(ERROR_CATEGORY.TIMEOUT);
			expect(classification.severity).toBe(ERROR_SEVERITY.MEDIUM);
			expect(classification.retryable).toBe(true);
		});

		test('should classify authentication errors correctly', () => {
			const authError = new Error('Unauthorized');
			authError.status = 401;
			const classification = errorBoundary._classifyError(authError);

			expect(classification.category).toBe(ERROR_CATEGORY.AUTHENTICATION);
			expect(classification.severity).toBe(ERROR_SEVERITY.HIGH);
			expect(classification.retryable).toBe(false);
		});

		test('should classify resource errors correctly', () => {
			const resourceError = new Error('Out of memory');
			const classification = errorBoundary._classifyError(resourceError);

			expect(classification.category).toBe(ERROR_CATEGORY.RESOURCE);
			expect(classification.severity).toBe(ERROR_SEVERITY.CRITICAL);
			expect(classification.retryable).toBe(false);
		});
	});

	describe('event handling', () => {
		test('should emit error caught events', async () => {
			const handler = jest.fn();
			errorBoundary.on('error:caught', handler);

			const error = new Error('Test error');
			mockFunction.mockRejectedValue(error);

			try {
				await errorBoundary.execute(mockFunction);
			} catch (e) {}

			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					error,
					classification: expect.any(Object),
					recoveryStrategy: expect.any(String)
				})
			);
		});
	});
});

describe('ErrorBoundaryRegistry', () => {
	let registry;

	beforeEach(() => {
		registry = new ErrorBoundaryRegistry();
	});

	describe('getBoundary method', () => {
		test('should create new boundary if not exists', () => {
			const boundary = registry.getBoundary('test-boundary');

			expect(boundary).toBeInstanceOf(ErrorBoundary);
			expect(registry.boundaries.has('test-boundary')).toBe(true);
		});

		test('should return existing boundary', () => {
			const boundary1 = registry.getBoundary('test-boundary');
			const boundary2 = registry.getBoundary('test-boundary');

			expect(boundary1).toBe(boundary2);
		});

		test('should apply custom configuration', () => {
			const config = { maxRetries: 10 };
			const boundary = registry.getBoundary('test-boundary', config);

			expect(boundary.config.maxRetries).toBe(10);
		});
	});

	describe('removeBoundary method', () => {
		test('should remove boundary', () => {
			registry.getBoundary('test-boundary');
			const removed = registry.removeBoundary('test-boundary');

			expect(removed).toBe(true);
			expect(registry.boundaries.has('test-boundary')).toBe(false);
		});
	});

	describe('getAllStatuses method', () => {
		test('should return statuses for all boundaries', () => {
			registry.getBoundary('boundary1');
			registry.getBoundary('boundary2');

			const statuses = registry.getAllStatuses();

			expect(Object.keys(statuses)).toHaveLength(2);
			expect(statuses).toHaveProperty('boundary1');
			expect(statuses).toHaveProperty('boundary2');
		});
	});

	describe('resetAll method', () => {
		test('should reset all boundaries', () => {
			const boundary1 = registry.getBoundary('boundary1');
			const boundary2 = registry.getBoundary('boundary2');

			// Mock reset methods
			boundary1.reset = jest.fn();
			boundary2.reset = jest.fn();

			registry.resetAll();

			expect(boundary1.reset).toHaveBeenCalled();
			expect(boundary2.reset).toHaveBeenCalled();
		});
	});

	describe('getHealthyBoundaries method', () => {
		test('should return names of healthy boundaries', () => {
			const boundary1 = registry.getBoundary('boundary1');
			const boundary2 = registry.getBoundary('boundary2');

			// Mock getStatus methods
			boundary1.getStatus = jest.fn(() => ({ healthStatus: 'healthy' }));
			boundary2.getStatus = jest.fn(() => ({ healthStatus: 'unhealthy' }));

			const healthy = registry.getHealthyBoundaries();

			expect(healthy).toEqual(['boundary1']);
		});
	});

	describe('getIsolatedBoundaries method', () => {
		test('should return names of isolated boundaries', () => {
			const boundary1 = registry.getBoundary('boundary1');
			const boundary2 = registry.getBoundary('boundary2');

			// Mock getStatus methods
			boundary1.getStatus = jest.fn(() => ({ isIsolated: false }));
			boundary2.getStatus = jest.fn(() => ({ isIsolated: true }));

			const isolated = registry.getIsolatedBoundaries();

			expect(isolated).toEqual(['boundary2']);
		});
	});
});

describe('IsolationError', () => {
	test('should create error with message and code', () => {
		const error = new IsolationError('Test message', 'TEST_CODE');

		expect(error.message).toBe('Test message');
		expect(error.code).toBe('TEST_CODE');
		expect(error.name).toBe('IsolationError');
		expect(error).toBeInstanceOf(Error);
	});
});
