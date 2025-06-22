/**
 * @fileoverview Circuit Breaker Tests with Dependency Injection
 *
 * Migrated tests using the new dependency injection architecture
 * for better testability and reliability.
 */

import {
	CircuitBreaker,
	CircuitBreakerRegistry,
	CircuitBreakerError,
	CIRCUIT_STATE
} from '../../../scripts/modules/events/circuit-breaker-di.js';
import { MockServiceRegistry } from '../../mocks/service-registry.js';
import {
	expectCalled,
	expectCalledWith,
	clearCalls
} from '../../utils/test-helpers.js';

describe('CircuitBreaker with Dependency Injection', () => {
	let circuitBreaker;
	let mockDependencies;
	let mockFunction;

	beforeEach(() => {
		// Create mock dependencies
		mockDependencies = {
			logger: MockServiceRegistry.createLogger(),
			timer: MockServiceRegistry.createTimer()
		};

		// Create test function
		mockFunction = MockServiceRegistry.createMockFn();

		// Configure timer mock to return incrementing timestamps
		let currentTime = 1000000;
		mockDependencies.timer.now.mockImplementation(() => currentTime++);

		// Create circuit breaker with dependency injection
		circuitBreaker = new CircuitBreaker(
			{
				failureThreshold: 3,
				successThreshold: 2,
				timeout: 1000,
				monitoringPeriod: 5000,
				slowCallThreshold: 500,
				minimumThroughput: 2
			},
			mockDependencies
		);

		clearCalls(mockFunction);
	});

	describe('constructor', () => {
		test('should initialize with default configuration', () => {
			const cb = new CircuitBreaker({}, mockDependencies);
			expect(cb.state).toBe(CIRCUIT_STATE.CLOSED);
			expect(cb.failureCount).toBe(0);
			expect(cb.stats.totalCalls).toBe(0);
		});

		test('should initialize with custom configuration', () => {
			const config = { failureThreshold: 10, timeout: 5000 };
			const cb = new CircuitBreaker(config, mockDependencies);
			expect(cb.config.failureThreshold).toBe(10);
			expect(cb.config.timeout).toBe(5000);
		});

		test('should initialize with injected dependencies', () => {
			expect(circuitBreaker.logger).toBe(mockDependencies.logger);
			expect(circuitBreaker.timer).toBe(mockDependencies.timer);
		});

		test('should use default logger when none provided', () => {
			const cb = new CircuitBreaker({}, {});

			expect(cb.logger).toBeDefined();
			expect(typeof cb.logger.log).toBe('function');
			expect(typeof cb.logger.error).toBe('function');
		});

		test('should use default timer when none provided', () => {
			const cb = new CircuitBreaker({}, {});

			expect(cb.timer).toBeDefined();
			expect(typeof cb.timer.setTimeout).toBe('function');
			expect(typeof cb.timer.now).toBe('function');
		});
	});

	describe('execute method', () => {
		test('should execute function successfully when circuit is closed', async () => {
			mockFunction.mockImplementation(() => Promise.resolve('success'));

			const result = await circuitBreaker.execute(mockFunction, ['arg1']);

			expect(result).toBe('success');
			expect(expectCalledWith(mockFunction, 'arg1')).toBe(true);
			expect(circuitBreaker.stats.successfulCalls).toBe(1);
			expect(circuitBreaker.stats.totalCalls).toBe(1);
		});

		test('should handle function failures and track them', async () => {
			const error = new Error('Test error');
			mockFunction.mockImplementation(() => Promise.reject(error));

			let thrownError;
			try {
				await circuitBreaker.execute(mockFunction);
			} catch (e) {
				thrownError = e;
			}

			expect(thrownError).toBeDefined();
			expect(thrownError.message).toBe('Test error');
			expect(circuitBreaker.stats.failedCalls).toBe(1);
			expect(circuitBreaker.stats.totalCalls).toBe(1);
			expect(circuitBreaker.failureCount).toBe(1);
		});

		test('should open circuit after failure threshold is reached', async () => {
			const error = new Error('Test error');
			mockFunction.mockImplementation(() => Promise.reject(error));

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

			let thrownError;
			try {
				await circuitBreaker.execute(mockFunction);
			} catch (e) {
				thrownError = e;
			}

			expect(thrownError).toBeInstanceOf(CircuitBreakerError);
			expect(circuitBreaker.stats.rejectedCalls).toBe(1);
			expect(expectCalled(mockFunction)).toBe(false);
		});

		test('should transition to half-open after timeout', async () => {
			// Set a very short timeout for testing
			circuitBreaker.config.timeout = 10;
			circuitBreaker.forceState(CIRCUIT_STATE.OPEN);

			// Mock timer to simulate timeout passing
			let timeOffset = 0;
			mockDependencies.timer.now.mockImplementation(() => 1000000 + timeOffset);
			timeOffset = 20; // Simulate 20ms passing

			mockFunction.mockImplementation(() => Promise.resolve('success'));
			await circuitBreaker.execute(mockFunction);

			expect(circuitBreaker.state).toBe(CIRCUIT_STATE.HALF_OPEN);
		});

		test('should close circuit after successful calls in half-open state', async () => {
			circuitBreaker.state = CIRCUIT_STATE.HALF_OPEN;
			mockFunction.mockImplementation(() => Promise.resolve('success'));

			// Execute enough successful calls to close circuit
			await circuitBreaker.execute(mockFunction);
			await circuitBreaker.execute(mockFunction);

			expect(circuitBreaker.state).toBe(CIRCUIT_STATE.CLOSED);
		});

		test('should reopen circuit on failure in half-open state', async () => {
			circuitBreaker.state = CIRCUIT_STATE.HALF_OPEN;
			const error = new Error('Test error');
			mockFunction.mockImplementation(() => Promise.reject(error));

			try {
				await circuitBreaker.execute(mockFunction);
			} catch (e) {
				// Expected to throw
			}

			expect(circuitBreaker.state).toBe(CIRCUIT_STATE.OPEN);
		});

		test('should handle timeout errors', async () => {
			mockFunction.mockImplementation(
				() =>
					new Promise((resolve) =>
						mockDependencies.timer.setTimeout(resolve, 1000)
					)
			);

			// Mock setTimeout to immediately call the timeout callback
			mockDependencies.timer.setTimeout.mockImplementation(
				(callback, delay) => {
					if (delay === 100) {
						// This is our timeout callback
						callback();
					}
					return 'timer-id';
				}
			);

			let thrownError;
			try {
				await circuitBreaker.execute(mockFunction, [], { timeout: 100 });
			} catch (e) {
				thrownError = e;
			}

			expect(thrownError).toBeDefined();
			expect(thrownError.message).toContain('timeout');
			expect(circuitBreaker.stats.failedCalls).toBe(1);
		});

		test('should track slow calls', async () => {
			// Configure timer to simulate slow response
			let timeOffset = 0;
			mockDependencies.timer.now.mockImplementation(() => 1000000 + timeOffset);

			mockFunction.mockImplementation(() => {
				timeOffset += 600; // Simulate 600ms execution time
				return Promise.resolve('slow');
			});

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
			// First call succeeds
			mockFunction.mockReturnValueOnce(Promise.resolve('success'));
			await circuitBreaker.execute(mockFunction);

			// Second call fails
			mockFunction.mockImplementation(() => Promise.reject(new Error('fail')));
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
			mockFunction.mockImplementation(() => Promise.reject(error));

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
			const handler = MockServiceRegistry.createMockFn();
			circuitBreaker.on('state:changed', handler);

			circuitBreaker.forceState(CIRCUIT_STATE.OPEN);

			// First verify the handler was called
			expect(expectCalled(handler)).toBe(true);

			// Check the call arguments manually
			const calls = handler.mock ? handler.mock.calls : handler.calls || [];
			expect(calls.length).toBe(1);
			expect(calls[0][0]).toMatchObject({
				from: CIRCUIT_STATE.CLOSED,
				to: CIRCUIT_STATE.OPEN
			});
			expect(typeof calls[0][0].timestamp).toBe('number');
		});

		test('should emit call success events', async () => {
			const handler = MockServiceRegistry.createMockFn();
			circuitBreaker.on('call:success', handler);

			mockFunction.mockImplementation(() => Promise.resolve('success'));
			await circuitBreaker.execute(mockFunction);

			// First verify the handler was called
			expect(expectCalled(handler)).toBe(true);

			// Check the call arguments manually
			const calls = handler.mock ? handler.mock.calls : handler.calls || [];
			expect(calls.length).toBe(1);
			expect(calls[0][0]).toMatchObject({
				state: CIRCUIT_STATE.CLOSED
			});
			expect(typeof calls[0][0].responseTime).toBe('number');
		});

		test('should emit call failure events', async () => {
			const handler = MockServiceRegistry.createMockFn();
			circuitBreaker.on('call:failure', handler);

			const error = new Error('Test error');
			mockFunction.mockImplementation(() => Promise.reject(error));

			try {
				await circuitBreaker.execute(mockFunction);
			} catch (e) {}

			// First verify the handler was called
			expect(expectCalled(handler)).toBe(true);

			// Check the call arguments manually
			const calls = handler.mock ? handler.mock.calls : handler.calls || [];
			expect(calls.length).toBe(1);
			expect(calls[0][0]).toMatchObject({
				error: 'Test error',
				state: CIRCUIT_STATE.CLOSED,
				isTimeout: false
			});
			expect(typeof calls[0][0].responseTime).toBe('number');
		});
	});
});

describe('CircuitBreakerRegistry with Dependency Injection', () => {
	let registry;
	let mockDependencies;

	beforeEach(() => {
		// Create mock dependencies
		mockDependencies = {
			logger: MockServiceRegistry.createLogger(),
			timer: MockServiceRegistry.createTimer()
		};

		// Configure timer mock
		mockDependencies.timer.now.mockReturnValue(1000000);

		registry = new CircuitBreakerRegistry(mockDependencies);
	});

	describe('constructor', () => {
		test('should initialize with injected dependencies', () => {
			expect(registry.logger).toBe(mockDependencies.logger);
			expect(registry.timer).toBe(mockDependencies.timer);
		});

		test('should use default logger when none provided', () => {
			const reg = new CircuitBreakerRegistry({});

			expect(reg.logger).toBeDefined();
			expect(typeof reg.logger.log).toBe('function');
		});

		test('should use default timer when none provided', () => {
			const reg = new CircuitBreakerRegistry({});

			expect(reg.timer).toBeDefined();
			expect(typeof reg.timer.now).toBe('function');
		});
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

		test('should pass dependencies to circuit breakers', () => {
			const breaker = registry.getBreaker('test-breaker');

			expect(breaker.logger).toBe(mockDependencies.logger);
			expect(breaker.timer).toBe(mockDependencies.timer);
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
			breaker1.reset = MockServiceRegistry.createMockFn();
			breaker2.reset = MockServiceRegistry.createMockFn();

			registry.resetAll();

			expect(expectCalled(breaker1.reset)).toBe(true);
			expect(expectCalled(breaker2.reset)).toBe(true);
		});
	});

	describe('getHealthyBreakers method', () => {
		test('should return names of healthy breakers', () => {
			const breaker1 = registry.getBreaker('breaker1');
			const breaker2 = registry.getBreaker('breaker2');

			// Mock status methods
			breaker1.getStatus = MockServiceRegistry.createMockFn(() => ({
				metrics: { isHealthy: true }
			}));
			breaker2.getStatus = MockServiceRegistry.createMockFn(() => ({
				metrics: { isHealthy: false }
			}));

			const healthy = registry.getHealthyBreakers();

			expect(healthy).toEqual(['breaker1']);
		});
	});

	describe('getUnhealthyBreakers method', () => {
		test('should return names of unhealthy breakers', () => {
			const breaker1 = registry.getBreaker('breaker1');
			const breaker2 = registry.getBreaker('breaker2');

			// Mock status methods
			breaker1.getStatus = MockServiceRegistry.createMockFn(() => ({
				metrics: { isHealthy: true }
			}));
			breaker2.getStatus = MockServiceRegistry.createMockFn(() => ({
				metrics: { isHealthy: false }
			}));

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
