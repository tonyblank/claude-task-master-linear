/**
 * Circuit Breaker Pattern Tests - New Test Infrastructure
 */

import { MockServiceRegistry } from '../../../../mocks/service-registry.js';
import {
	expectCalled,
	expectCalledWith,
	clearCalls
} from '../../../../utils/test-helpers.js';
import {
	CircuitBreaker,
	CircuitBreakerRegistry,
	CircuitBreakerError,
	CIRCUIT_STATE
} from '../../../../../scripts/modules/events/circuit-breaker.js';

describe('CircuitBreaker', () => {
	let circuitBreaker;
	let mockFunction;

	beforeEach(() => {
		mockFunction = MockServiceRegistry.createMockFn();
		circuitBreaker = new CircuitBreaker({
			failureThreshold: 3,
			successThreshold: 2,
			timeout: 1000,
			monitoringPeriod: 5000,
			slowCallThreshold: 500,
			minimumThroughput: 2
		});
		clearCalls(mockFunction);
	});

	describe('constructor', () => {
		test('should initialize with default configuration', () => {
			const cb = new CircuitBreaker();
			expect(cb.state).toBe(CIRCUIT_STATE.CLOSED);
			expect(cb.failureCount).toBe(0);
			expect(cb.getStatus().stats.totalCalls).toBe(0);
		});

		test('should initialize with custom configuration', () => {
			const config = { failureThreshold: 10, timeout: 5000 };
			const cb = new CircuitBreaker(config);
			expect(cb.config.failureThreshold).toBe(10);
			expect(cb.config.timeout).toBe(5000);
		});
	});

	describe('execute method', () => {
		test('should execute function successfully in closed state', async () => {
			mockFunction.mockResolvedValue('success');

			const result = await circuitBreaker.execute(mockFunction);

			expect(result).toBe('success');
			expect(circuitBreaker.state).toBe(CIRCUIT_STATE.CLOSED);
			expect(expectCalled(mockFunction)).toBe(true);
		});

		test('should handle function failure in closed state', async () => {
			const error = new Error('Function failed');
			mockFunction.mockRejectedValue(error);

			await expect(circuitBreaker.execute(mockFunction)).rejects.toThrow(
				'Function failed'
			);

			expect(circuitBreaker.failureCount).toBe(1);
			expect(circuitBreaker.state).toBe(CIRCUIT_STATE.CLOSED);
		});

		test('should open circuit after reaching failure threshold', async () => {
			const error = new Error('Function failed');
			mockFunction.mockRejectedValue(error);

			// Trigger enough failures to open circuit
			for (let i = 0; i < 5; i++) {
				try {
					await circuitBreaker.execute(mockFunction);
				} catch (e) {
					// Expected failures
				}
			}

			expect(circuitBreaker.state).toBe(CIRCUIT_STATE.OPEN);
		});

		test('should reject calls immediately when circuit is open', async () => {
			// Force circuit to open state
			circuitBreaker.forceState(CIRCUIT_STATE.OPEN);

			await expect(circuitBreaker.execute(mockFunction)).rejects.toThrow(
				CircuitBreakerError
			);
			expect(expectCalled(mockFunction)).toBe(false);
		});

		test('should transition to half-open after timeout', async () => {
			// Force circuit to open state with old failure time
			circuitBreaker.forceState(CIRCUIT_STATE.OPEN);
			circuitBreaker.nextAttempt = Date.now() - 1000; // Allow immediate retry

			mockFunction.mockResolvedValue('success');

			const result = await circuitBreaker.execute(mockFunction);

			expect(result).toBe('success');
			expect(circuitBreaker.state).toBe(CIRCUIT_STATE.HALF_OPEN);
		});

		test('should close circuit after successful calls in half-open state', async () => {
			circuitBreaker.forceState(CIRCUIT_STATE.HALF_OPEN);
			mockFunction.mockResolvedValue('success');

			// Execute enough successful calls to close circuit
			for (let i = 0; i < 2; i++) {
				await circuitBreaker.execute(mockFunction);
			}

			expect(circuitBreaker.state).toBe(CIRCUIT_STATE.CLOSED);
			expect(circuitBreaker.failureCount).toBe(0);
		});

		test('should reopen circuit if failure occurs in half-open state', async () => {
			circuitBreaker.forceState(CIRCUIT_STATE.HALF_OPEN);
			const error = new Error('Function failed');
			mockFunction.mockRejectedValue(error);

			await expect(circuitBreaker.execute(mockFunction)).rejects.toThrow(
				'Function failed'
			);

			expect(circuitBreaker.state).toBe(CIRCUIT_STATE.OPEN);
		});
	});

	describe('timeout handling', () => {
		test('should handle slow calls as failures', async () => {
			mockFunction.mockImplementation(
				() => new Promise((resolve) => setTimeout(() => resolve('slow'), 600))
			);

			await expect(circuitBreaker.execute(mockFunction)).rejects.toThrow(
				'timeout'
			);
			expect(circuitBreaker.failureCount).toBe(1);
		});

		test('should complete fast calls successfully', async () => {
			mockFunction.mockImplementation(
				() => new Promise((resolve) => setTimeout(() => resolve('fast'), 100))
			);

			const result = await circuitBreaker.execute(mockFunction);
			expect(result).toBe('fast');
		});
	});

	describe('statistics', () => {
		test('should track call statistics', async () => {
			mockFunction.mockResolvedValue('success');

			await circuitBreaker.execute(mockFunction);
			await circuitBreaker.execute(mockFunction);

			const status = circuitBreaker.getStatus();
			expect(status.stats.totalCalls).toBe(2);
			expect(status.stats.successfulCalls).toBe(2);
			expect(status.stats.failedCalls).toBe(0);
		});

		test('should track failure statistics', async () => {
			const error = new Error('Function failed');
			mockFunction.mockRejectedValue(error);

			try {
				await circuitBreaker.execute(mockFunction);
			} catch (e) {
				// Expected failure
			}

			const status = circuitBreaker.getStatus();
			expect(status.stats.totalCalls).toBe(1);
			expect(status.stats.successfulCalls).toBe(0);
			expect(status.stats.failedCalls).toBe(1);
		});

		test('should calculate success rate', async () => {
			mockFunction.mockResolvedValueOnce('success').mockImplementation(() => {
				// For the second call, throw an error
				if (mockFunction.mock.calls.length === 2) {
					throw new Error('fail');
				}
				return Promise.resolve('success');
			});

			await circuitBreaker.execute(mockFunction);
			try {
				await circuitBreaker.execute(mockFunction);
			} catch (e) {
				// Expected failure
			}
			await circuitBreaker.execute(mockFunction);

			const status = circuitBreaker.getStatus();
			const successRate =
				status.stats.successfulCalls / status.stats.totalCalls;
			expect(successRate).toBeCloseTo(0.67, 2); // 2/3 = 0.67
		});
	});

	describe('reset method', () => {
		test('should reset circuit to closed state', () => {
			circuitBreaker.state = CIRCUIT_STATE.OPEN;
			circuitBreaker.failureCount = 5;

			circuitBreaker.reset();

			expect(circuitBreaker.state).toBe(CIRCUIT_STATE.CLOSED);
			expect(circuitBreaker.failureCount).toBe(0);
		});
	});

	describe('event handling', () => {
		test('should emit state change events', async () => {
			const stateChangeHandler = MockServiceRegistry.createMockFn();
			circuitBreaker.on('state:changed', stateChangeHandler);

			const error = new Error('Function failed');
			mockFunction.mockRejectedValue(error);

			// Trigger enough failures to open circuit
			for (let i = 0; i < 5; i++) {
				try {
					await circuitBreaker.execute(mockFunction);
				} catch (e) {
					// Expected failures
				}
			}

			expect(expectCalled(stateChangeHandler)).toBe(true);
			const calls = stateChangeHandler.mock
				? stateChangeHandler.mock.calls
				: stateChangeHandler.calls || [];
			expect(calls[0][0]).toMatchObject({
				from: CIRCUIT_STATE.CLOSED,
				to: CIRCUIT_STATE.OPEN
			});
		});

		test('should emit failure events', async () => {
			const failureHandler = MockServiceRegistry.createMockFn();
			circuitBreaker.on('call:failure', failureHandler);

			const error = new Error('Function failed');
			mockFunction.mockRejectedValue(error);

			try {
				await circuitBreaker.execute(mockFunction);
			} catch (e) {
				// Expected failure
			}

			expect(expectCalled(failureHandler)).toBe(true);
		});
	});
});

describe('CircuitBreakerRegistry', () => {
	let registry;

	beforeEach(() => {
		registry = new CircuitBreakerRegistry();
	});

	describe('register method', () => {
		test('should register a new circuit breaker', () => {
			const breaker = registry.getBreaker('test-service', {
				failureThreshold: 5
			});

			expect(breaker).toBeInstanceOf(CircuitBreaker);
			expect(breaker.config.failureThreshold).toBe(5);
			expect(registry.breakers.has('test-service')).toBe(true);
		});

		test('should return existing breaker if already registered', () => {
			const breaker1 = registry.getBreaker('test-service');
			const breaker2 = registry.getBreaker('test-service');

			expect(breaker1).toBe(breaker2);
		});
	});

	describe('getBreaker method', () => {
		test('should return existing breaker', () => {
			const breaker = registry.getBreaker('test-service');
			const retrieved = registry.getBreaker('test-service');

			expect(retrieved).toBe(breaker);
		});

		test('should create and return breaker for non-existent name', () => {
			const retrieved = registry.getBreaker('non-existent');
			expect(retrieved).toBeDefined();
			expect(retrieved.state).toBe('closed');
		});
	});

	describe('getAllStatuses method', () => {
		test('should return status of all breakers', () => {
			registry.getBreaker('service1');
			registry.getBreaker('service2');

			const statuses = registry.getAllStatuses();

			expect(Object.keys(statuses)).toHaveLength(2);
			expect(statuses.service1).toHaveProperty('state');
			expect(statuses.service2).toHaveProperty('state');
		});
	});

	describe('removeBreaker method', () => {
		test('should remove breaker from registry', () => {
			registry.getBreaker('test-service');
			const removed = registry.removeBreaker('test-service');

			expect(removed).toBe(true);
			expect(registry.breakers.has('test-service')).toBe(false);
		});

		test('should return false for non-existent breaker', () => {
			const removed = registry.removeBreaker('non-existent');
			expect(removed).toBe(false);
		});
	});

	describe('clear method', () => {
		test('should clear all breakers', () => {
			registry.getBreaker('service1');
			registry.getBreaker('service2');

			registry.breakers.clear();

			expect(registry.breakers.size).toBe(0);
		});
	});
});

describe('CircuitBreakerError', () => {
	test('should create error with correct message and state', () => {
		const error = new CircuitBreakerError(
			'Circuit is open',
			CIRCUIT_STATE.OPEN
		);

		expect(error.message).toBe('Circuit is open');
		expect(error.code).toBe(CIRCUIT_STATE.OPEN);
		expect(error.name).toBe('CircuitBreakerError');
	});
});
