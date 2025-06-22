/**
 * Circuit Breaker Pattern Tests
 */

import { jest } from '@jest/globals';

// Mock utils module
jest.mock('../../../../../scripts/modules/utils.js', () => ({
	log: jest.fn()
}));

jest.mock('../../../../../scripts/modules/config-manager.js', () => ({
	getLogLevel: jest.fn(() => 'info'),
	getGlobalConfig: jest.fn(() => ({}))
}));

import {
	CircuitBreaker,
	CircuitBreakerRegistry,
	CircuitBreakerError,
	CIRCUIT_STATE
} from '../../../../../scripts/modules/events/circuit-breaker.js';

describe('CircuitBreaker', () => {
	let circuitBreaker;
	const mockFunction = jest.fn();

	beforeEach(() => {
		jest.clearAllMocks();
		circuitBreaker = new CircuitBreaker({
			failureThreshold: 3,
			successThreshold: 2,
			timeout: 1000,
			monitoringPeriod: 5000,
			slowCallThreshold: 500,
			minimumThroughput: 2
		});
		mockFunction.mockClear();
	});

	describe('constructor', () => {
		test('should initialize with default configuration', () => {
			const cb = new CircuitBreaker();
			expect(cb.state).toBe(CIRCUIT_STATE.CLOSED);
			expect(cb.failureCount).toBe(0);
			expect(cb.stats.totalCalls).toBe(0);
		});

		test('should initialize with custom configuration', () => {
			const config = { failureThreshold: 10, timeout: 5000 };
			const cb = new CircuitBreaker(config);
			expect(cb.config.failureThreshold).toBe(10);
			expect(cb.config.timeout).toBe(5000);
		});
	});

	describe('execute method', () => {
		test('should execute function successfully when circuit is closed', async () => {
			mockFunction.mockResolvedValue('success');

			const result = await circuitBreaker.execute(mockFunction, ['arg1']);

			expect(result).toBe('success');
			expect(mockFunction).toHaveBeenCalledWith('arg1');
			expect(circuitBreaker.stats.successfulCalls).toBe(1);
			expect(circuitBreaker.stats.totalCalls).toBe(1);
		});

		test('should handle function failures and track them', async () => {
			const error = new Error('Test error');
			mockFunction.mockRejectedValue(error);

			await expect(circuitBreaker.execute(mockFunction)).rejects.toThrow(
				'Test error'
			);

			expect(circuitBreaker.stats.failedCalls).toBe(1);
			expect(circuitBreaker.stats.totalCalls).toBe(1);
			expect(circuitBreaker.failureCount).toBe(1);
		});

		test('should open circuit after failure threshold is reached', async () => {
			const error = new Error('Test error');
			mockFunction.mockRejectedValue(error);

			// Cause enough failures to reach threshold
			for (let i = 0; i < 3; i++) {
				try {
					await circuitBreaker.execute(mockFunction);
				} catch (e) {
					// Expected to fail
				}
			}

			expect(circuitBreaker.state).toBe(CIRCUIT_STATE.OPEN);
		});

		test('should reject calls when circuit is open', async () => {
			// Force circuit to open state
			circuitBreaker.forceState(CIRCUIT_STATE.OPEN);

			await expect(circuitBreaker.execute(mockFunction)).rejects.toThrow(
				CircuitBreakerError
			);

			expect(circuitBreaker.stats.rejectedCalls).toBe(1);
			expect(mockFunction).not.toHaveBeenCalled();
		});

		test('should transition to half-open after timeout', async () => {
			// Set a very short timeout for testing
			circuitBreaker.config.timeout = 10;
			circuitBreaker.forceState(CIRCUIT_STATE.OPEN);

			// Wait for timeout to pass
			await new Promise((resolve) => setTimeout(resolve, 20));

			mockFunction.mockResolvedValue('success');
			await circuitBreaker.execute(mockFunction);

			expect(circuitBreaker.state).toBe(CIRCUIT_STATE.HALF_OPEN);
		});

		test('should close circuit after successful calls in half-open state', async () => {
			circuitBreaker.state = CIRCUIT_STATE.HALF_OPEN;
			mockFunction.mockResolvedValue('success');

			// Execute enough successful calls to close circuit
			await circuitBreaker.execute(mockFunction);
			await circuitBreaker.execute(mockFunction);

			expect(circuitBreaker.state).toBe(CIRCUIT_STATE.CLOSED);
		});

		test('should reopen circuit on failure in half-open state', async () => {
			circuitBreaker.state = CIRCUIT_STATE.HALF_OPEN;
			const error = new Error('Test error');
			mockFunction.mockRejectedValue(error);

			await expect(circuitBreaker.execute(mockFunction)).rejects.toThrow();

			expect(circuitBreaker.state).toBe(CIRCUIT_STATE.OPEN);
		});

		test('should handle timeout errors', async () => {
			mockFunction.mockImplementation(
				() => new Promise((resolve) => setTimeout(resolve, 1000))
			);

			await expect(
				circuitBreaker.execute(mockFunction, [], { timeout: 100 })
			).rejects.toThrow('timeout');

			expect(circuitBreaker.stats.failedCalls).toBe(1);
		});

		test('should track slow calls', async () => {
			mockFunction.mockImplementation(
				() => new Promise((resolve) => setTimeout(() => resolve('slow'), 600))
			);

			const result = await circuitBreaker.execute(mockFunction, [], {
				timeout: 1000
			});

			expect(result).toBe('slow');
			expect(circuitBreaker.stats.slowCalls).toBe(1);
		});
	});

	describe('getStatus method', () => {
		test('should return current circuit status', () => {
			const status = circuitBreaker.getStatus();

			expect(status).toHaveProperty('state');
			expect(status).toHaveProperty('stats');
			expect(status).toHaveProperty('metrics');
			expect(status.state).toBe(CIRCUIT_STATE.CLOSED);
		});

		test('should calculate failure rate correctly', async () => {
			mockFunction.mockResolvedValueOnce('success');
			await circuitBreaker.execute(mockFunction);

			mockFunction.mockRejectedValueOnce(new Error('fail'));
			try {
				await circuitBreaker.execute(mockFunction);
			} catch (e) {}

			const status = circuitBreaker.getStatus();
			expect(status.metrics.failureRate).toBe(50); // 1 failure out of 2 calls
		});
	});

	describe('reset method', () => {
		test('should reset circuit to initial state', async () => {
			// Cause some failures and state changes
			const error = new Error('Test error');
			mockFunction.mockRejectedValue(error);

			try {
				await circuitBreaker.execute(mockFunction);
			} catch (e) {}

			circuitBreaker.reset();

			expect(circuitBreaker.state).toBe(CIRCUIT_STATE.CLOSED);
			expect(circuitBreaker.failureCount).toBe(0);
			expect(circuitBreaker.calls).toHaveLength(0);
		});
	});

	describe('event handling', () => {
		test('should emit state change events', () => {
			const handler = jest.fn();
			circuitBreaker.on('state:changed', handler);

			circuitBreaker.forceState(CIRCUIT_STATE.OPEN);

			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					from: CIRCUIT_STATE.CLOSED,
					to: CIRCUIT_STATE.OPEN
				})
			);
		});

		test('should emit call success events', async () => {
			const handler = jest.fn();
			circuitBreaker.on('call:success', handler);

			mockFunction.mockResolvedValue('success');
			await circuitBreaker.execute(mockFunction);

			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					responseTime: expect.any(Number),
					state: CIRCUIT_STATE.CLOSED
				})
			);
		});

		test('should emit call failure events', async () => {
			const handler = jest.fn();
			circuitBreaker.on('call:failure', handler);

			const error = new Error('Test error');
			mockFunction.mockRejectedValue(error);

			try {
				await circuitBreaker.execute(mockFunction);
			} catch (e) {}

			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					error: 'Test error',
					responseTime: expect.any(Number),
					state: CIRCUIT_STATE.CLOSED
				})
			);
		});
	});
});

describe('CircuitBreakerRegistry', () => {
	let registry;

	beforeEach(() => {
		registry = new CircuitBreakerRegistry();
	});

	describe('getBreaker method', () => {
		test('should create new circuit breaker if not exists', () => {
			const breaker = registry.getBreaker('test-breaker');

			expect(breaker).toBeInstanceOf(CircuitBreaker);
			expect(registry.breakers.has('test-breaker')).toBe(true);
		});

		test('should return existing circuit breaker', () => {
			const breaker1 = registry.getBreaker('test-breaker');
			const breaker2 = registry.getBreaker('test-breaker');

			expect(breaker1).toBe(breaker2);
		});

		test('should apply custom configuration', () => {
			const config = { failureThreshold: 10 };
			const breaker = registry.getBreaker('test-breaker', config);

			expect(breaker.config.failureThreshold).toBe(10);
		});
	});

	describe('removeBreaker method', () => {
		test('should remove circuit breaker', () => {
			registry.getBreaker('test-breaker');
			const removed = registry.removeBreaker('test-breaker');

			expect(removed).toBe(true);
			expect(registry.breakers.has('test-breaker')).toBe(false);
		});

		test('should return false for non-existent breaker', () => {
			const removed = registry.removeBreaker('non-existent');

			expect(removed).toBe(false);
		});
	});

	describe('getAllStatuses method', () => {
		test('should return statuses for all breakers', () => {
			registry.getBreaker('breaker1');
			registry.getBreaker('breaker2');

			const statuses = registry.getAllStatuses();

			expect(Object.keys(statuses)).toHaveLength(2);
			expect(statuses).toHaveProperty('breaker1');
			expect(statuses).toHaveProperty('breaker2');
		});
	});

	describe('resetAll method', () => {
		test('should reset all circuit breakers', () => {
			const breaker1 = registry.getBreaker('breaker1');
			const breaker2 = registry.getBreaker('breaker2');

			// Mock reset methods
			breaker1.reset = jest.fn();
			breaker2.reset = jest.fn();

			registry.resetAll();

			expect(breaker1.reset).toHaveBeenCalled();
			expect(breaker2.reset).toHaveBeenCalled();
		});
	});

	describe('getHealthyBreakers method', () => {
		test('should return names of healthy breakers', () => {
			const breaker1 = registry.getBreaker('breaker1');
			const breaker2 = registry.getBreaker('breaker2');

			// Mock status methods
			breaker1.getStatus = jest.fn(() => ({ metrics: { isHealthy: true } }));
			breaker2.getStatus = jest.fn(() => ({ metrics: { isHealthy: false } }));

			const healthy = registry.getHealthyBreakers();

			expect(healthy).toEqual(['breaker1']);
		});
	});

	describe('getUnhealthyBreakers method', () => {
		test('should return names of unhealthy breakers', () => {
			const breaker1 = registry.getBreaker('breaker1');
			const breaker2 = registry.getBreaker('breaker2');

			// Mock status methods
			breaker1.getStatus = jest.fn(() => ({ metrics: { isHealthy: true } }));
			breaker2.getStatus = jest.fn(() => ({ metrics: { isHealthy: false } }));

			const unhealthy = registry.getUnhealthyBreakers();

			expect(unhealthy).toEqual(['breaker2']);
		});
	});
});

describe('CircuitBreakerError', () => {
	test('should create error with message and code', () => {
		const error = new CircuitBreakerError('Test message', 'TEST_CODE');

		expect(error.message).toBe('Test message');
		expect(error.code).toBe('TEST_CODE');
		expect(error.name).toBe('CircuitBreakerError');
		expect(error).toBeInstanceOf(Error);
	});
});
