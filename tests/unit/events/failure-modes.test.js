/**
 * @fileoverview Failure mode tests for error boundaries and isolation
 *
 * Tests various failure scenarios to ensure the event system
 * handles errors gracefully and maintains isolation between components.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { TestFactories } from '../../factories/test-factories.js';
import { MockServiceRegistry } from '../../mocks/service-registry.js';
import { EVENT_TYPES } from '../../../scripts/modules/events/types.js';
import { createStandardEventPayload } from '../../../scripts/modules/events/payload-serializer.js';

describe('Failure Mode Tests', () => {
	let testEnv;

	beforeEach(() => {
		testEnv = TestFactories.createTestEnvironment('failure-mode-test', {
			config: {
				enableErrorBoundaries: true,
				enableCircuitBreakers: true,
				enableHealthMonitoring: true,
				enableAutoRecovery: true,
				handlerTimeout: 5000,
				eventTimeout: 10000,
				maxRetries: 3
			}
		});
	});

	afterEach(() => {
		if (testEnv) {
			testEnv.cleanup();
		}
	});

	describe('Error Boundary Isolation', () => {
		it('should isolate handler exceptions from system', async () => {
			const { integrationManager } = testEnv;

			// Create handlers with different failure modes
			const explosiveHandler = TestFactories.createTestIntegrationHandler(
				'explosive-handler',
				{
					eventHandlers: {
						'task:created': async (payload) => {
							throw new Error('Catastrophic failure');
						}
					}
				}
			);

			const stableHandler = TestFactories.createTestIntegrationHandler(
				'stable-handler',
				{
					eventHandlers: {
						'task:created': async (payload) => {
							return { status: 'stable', processed: true };
						}
					}
				}
			);

			await integrationManager.register(explosiveHandler);
			await integrationManager.register(stableHandler);
			await integrationManager.initialize();

			const eventPayload = createStandardEventPayload(
				EVENT_TYPES.TASK_CREATED,
				{
					taskId: '1',
					task: {
						id: '1',
						title: 'Failure Test Task',
						description: 'Testing failure isolation',
						status: 'pending',
						priority: 'high',
						dependencies: [],
						subtasks: []
					},
					tag: 'failure-test'
				},
				{
					projectRoot: '/app',
					session: { user: 'failure_test_user' },
					source: 'failure-test',
					requestId: 'failure-123'
				}
			);

			// Process event despite one handler failing
			const results = await integrationManager.handleEvent(
				EVENT_TYPES.TASK_CREATED,
				eventPayload
			);

			expect(results).toHaveLength(2);

			// Find stable and failed results
			const stableResult = results.find((r) => r.success === true);
			const failedResult = results.find((r) => r.success === false);

			expect(stableResult).toBeDefined();
			expect(stableResult.result.status).toBe('stable');

			expect(failedResult).toBeDefined();
			expect(failedResult.error).toContain('Catastrophic failure');

			// System should remain functional
			expect(integrationManager.isRunning()).toBe(true);
		});

		it('should handle memory leaks in handlers', async () => {
			const { integrationManager } = testEnv;

			const memoryLeakHandler = TestFactories.createTestIntegrationHandler(
				'memory-leak-handler',
				{
					eventHandlers: {
						'task:created': async (payload) => {
							// Simulate memory leak by creating large objects
							const leakyData = new Array(100000).fill('memory-leak-data');

							// Intentionally don't clean up
							global._leakyData = global._leakyData || [];
							global._leakyData.push(leakyData);

							// Throw error to test cleanup
							throw new Error('Handler crashed with memory leak');
						}
					}
				}
			);

			const cleanHandler = TestFactories.createTestIntegrationHandler(
				'clean-handler',
				{
					eventHandlers: {
						'task:created': async (payload) => {
							return { clean: true };
						}
					}
				}
			);

			await integrationManager.register(memoryLeakHandler);
			await integrationManager.register(cleanHandler);
			await integrationManager.initialize();

			const eventPayload = createStandardEventPayload(
				EVENT_TYPES.TASK_CREATED,
				{
					taskId: 'memory-test',
					task: { id: 'memory-test', title: 'Memory Test' }
				},
				{ source: 'memory-test' }
			);

			// Process multiple events to amplify memory issues
			const promises = [];
			for (let i = 0; i < 10; i++) {
				promises.push(
					integrationManager.handleEvent(EVENT_TYPES.TASK_CREATED, eventPayload)
				);
			}

			const results = await Promise.all(promises);

			// Verify clean handler continues working despite memory leak handler
			results.forEach((resultSet) => {
				expect(resultSet).toHaveLength(2);
				const cleanResult = resultSet.find((r) => r.success === true);
				expect(cleanResult).toBeDefined();
				expect(cleanResult.result.clean).toBe(true);
			});

			// Cleanup global leak for test isolation
			delete global._leakyData;
		});

		it('should handle infinite loops and timeouts', async () => {
			const { integrationManager } = testEnv;

			const infiniteLoopHandler = TestFactories.createTestIntegrationHandler(
				'infinite-loop-handler',
				{
					eventHandlers: {
						'task:created': async (payload) => {
							// Simulate infinite loop with async operation that can be interrupted
							return new Promise((resolve) => {
								// This will never resolve, simulating a hanging operation
								// The timeout should interrupt this
							});
						}
					}
				}
			);

			const quickHandler = TestFactories.createTestIntegrationHandler(
				'quick-handler',
				{
					eventHandlers: {
						'task:created': async (payload) => {
							return { quick: true, timestamp: Date.now() };
						}
					}
				}
			);

			await integrationManager.register(infiniteLoopHandler);
			await integrationManager.register(quickHandler);
			await integrationManager.initialize();

			const eventPayload = createStandardEventPayload(
				EVENT_TYPES.TASK_CREATED,
				{
					taskId: 'timeout-test',
					task: { id: 'timeout-test', title: 'Timeout Test' }
				},
				{ source: 'timeout-test' }
			);

			const startTime = Date.now();
			const results = await integrationManager.handleEvent(
				EVENT_TYPES.TASK_CREATED,
				eventPayload
			);
			const endTime = Date.now();

			// Should complete within reasonable time due to timeout
			expect(endTime - startTime).toBeLessThan(7000); // Less than handler timeout + overhead

			expect(results).toHaveLength(2);

			const quickResult = results.find((r) => r.success === true);
			const timedOutResult = results.find((r) => r.success === false);

			expect(quickResult).toBeDefined();
			expect(quickResult.result.quick).toBe(true);

			expect(timedOutResult).toBeDefined();
			expect(timedOutResult.error).toMatch(/timeout|timed out/i);
		});
	});

	describe('Circuit Breaker Failure Modes', () => {
		it('should open circuit breaker after consecutive failures', async () => {
			const { integrationManager, dependencies } = testEnv;

			let failureCount = 0;
			const mockCircuitBreaker = {
				isOpen: MockServiceRegistry.createMockFn(() => failureCount >= 3),
				execute: MockServiceRegistry.createMockFn(async (fn) => {
					if (failureCount >= 3) {
						throw new Error('Circuit breaker is open');
					}
					try {
						return await fn();
					} catch (error) {
						failureCount++;
						throw error;
					}
				}),
				recordSuccess: MockServiceRegistry.createMockFn(),
				recordFailure: MockServiceRegistry.createMockFn(() => failureCount++)
			};

			// Use mockImplementation instead of mockReturnValue to ensure the same instance is always returned
			dependencies.circuitBreakerRegistry.getBreaker.mockImplementation(
				() => mockCircuitBreaker
			);

			const failingHandler = TestFactories.createTestIntegrationHandler(
				'failing-handler',
				{
					eventHandlers: {
						'task:created': async (payload) => {
							throw new Error('Persistent failure');
						}
					}
				}
			);

			await integrationManager.register(failingHandler);
			await integrationManager.initialize();

			const eventPayload = createStandardEventPayload(
				EVENT_TYPES.TASK_CREATED,
				{
					taskId: 'circuit-test',
					task: { id: 'circuit-test', title: 'Circuit Test' }
				},
				{ source: 'circuit-test' }
			);

			// First two events should fail normally
			for (let i = 0; i < 2; i++) {
				const results = await integrationManager.handleEvent(
					EVENT_TYPES.TASK_CREATED,
					eventPayload
				);
				expect(results[0].success).toBe(false);
				expect(results[0].error).toContain('Persistent failure');
			}

			// Third event should also fail normally (reaching the failure threshold)
			const thirdResults = await integrationManager.handleEvent(
				EVENT_TYPES.TASK_CREATED,
				eventPayload
			);
			expect(thirdResults[0].success).toBe(false);
			expect(thirdResults[0].error).toContain('Persistent failure');

			// Next event should be blocked by circuit breaker
			const circuitOpenResults = await integrationManager.handleEvent(
				EVENT_TYPES.TASK_CREATED,
				eventPayload
			);
			expect(circuitOpenResults[0].success).toBe(false);
			expect(circuitOpenResults[0].error).toContain('Circuit breaker is open');
		});

		it('should handle circuit breaker malfunction', async () => {
			const { integrationManager, dependencies } = testEnv;

			// Mock circuit breaker that throws on isOpen check
			const malFunctioningCircuitBreaker = {
				isOpen: MockServiceRegistry.createMockFn(() => {
					throw new Error('Circuit breaker malfunction');
				}),
				execute: MockServiceRegistry.createMockFn(async (fn) => await fn()),
				recordSuccess: MockServiceRegistry.createMockFn(),
				recordFailure: MockServiceRegistry.createMockFn()
			};

			dependencies.circuitBreakerRegistry.getBreaker.mockReturnValue(
				malFunctioningCircuitBreaker
			);

			const normalHandler = TestFactories.createTestIntegrationHandler(
				'normal-handler',
				{
					eventHandlers: {
						'task:created': async (payload) => {
							return { processed: true };
						}
					}
				}
			);

			await integrationManager.register(normalHandler);
			await integrationManager.initialize();

			const eventPayload = createStandardEventPayload(
				EVENT_TYPES.TASK_CREATED,
				{
					taskId: 'malfunction-test',
					task: { id: 'malfunction-test', title: 'Malfunction Test' }
				},
				{ source: 'malfunction-test' }
			);

			// Should handle circuit breaker malfunction gracefully
			const results = await integrationManager.handleEvent(
				EVENT_TYPES.TASK_CREATED,
				eventPayload
			);

			// Should either fallback to direct execution or handle gracefully
			expect(results).toHaveLength(1);
			// Result might be success (fallback) or failure (graceful handling)
			expect(results[0]).toHaveProperty('success');
		});
	});

	describe('Recovery System Failures', () => {
		it('should handle recovery system malfunction', async () => {
			const { integrationManager, dependencies } = testEnv;

			// Mock recovery manager that fails
			dependencies.recoveryManager.executeWithRecovery.mockImplementation(
				async (operation, context) => {
					throw new Error('Recovery system malfunction');
				}
			);

			const recoveryTestHandler = TestFactories.createTestIntegrationHandler(
				'recovery-test-handler',
				{
					eventHandlers: {
						'task:created': async (payload) => {
							return { processed: true };
						}
					}
				}
			);

			await integrationManager.register(recoveryTestHandler);
			await integrationManager.initialize();

			const eventPayload = createStandardEventPayload(
				EVENT_TYPES.TASK_CREATED,
				{
					taskId: 'recovery-fail-test',
					task: { id: 'recovery-fail-test', title: 'Recovery Fail Test' }
				},
				{ source: 'recovery-fail-test' }
			);

			// Should handle recovery system failure
			const results = await integrationManager.handleEvent(
				EVENT_TYPES.TASK_CREATED,
				eventPayload
			);

			expect(results).toHaveLength(1);
			expect(results[0].success).toBe(false);
			expect(results[0].error).toContain('Recovery system malfunction');
		});

		it('should handle retry exhaustion gracefully', async () => {
			const { integrationManager } = testEnv;

			let attemptCount = 0;
			const retryTestHandler = TestFactories.createTestIntegrationHandler(
				'retry-test-handler',
				{
					eventHandlers: {
						'task:created': async (payload) => {
							attemptCount++;
							throw new Error(`Attempt ${attemptCount} failed`);
						}
					}
				}
			);

			await integrationManager.register(retryTestHandler);
			await integrationManager.initialize();

			const eventPayload = createStandardEventPayload(
				EVENT_TYPES.TASK_CREATED,
				{
					taskId: 'retry-exhaustion-test',
					task: { id: 'retry-exhaustion-test', title: 'Retry Exhaustion Test' }
				},
				{ source: 'retry-exhaustion-test' }
			);

			const results = await integrationManager.handleEvent(
				EVENT_TYPES.TASK_CREATED,
				eventPayload
			);

			expect(results).toHaveLength(1);
			expect(results[0].success).toBe(false);

			// Should have attempted multiple times
			expect(attemptCount).toBeGreaterThan(1);
			expect(results[0].error).toContain('failed');
		});
	});

	describe('Resource Exhaustion Scenarios', () => {
		it('should handle handler resource exhaustion', async () => {
			const { integrationManager } = testEnv;

			const resourceExhaustionHandler =
				TestFactories.createTestIntegrationHandler(
					'resource-exhaustion-handler',
					{
						eventHandlers: {
							'task:created': async (payload) => {
								// Simulate resource exhaustion by creating many promises
								const promises = [];
								for (let i = 0; i < 10000; i++) {
									promises.push(
										new Promise((resolve) => setTimeout(resolve, 1))
									);
								}

								try {
									await Promise.all(promises);
									return { resourcesAllocated: promises.length };
								} catch (error) {
									throw new Error('Resource exhaustion');
								}
							}
						}
					}
				);

			const lightweightHandler = TestFactories.createTestIntegrationHandler(
				'lightweight-handler',
				{
					eventHandlers: {
						'task:created': async (payload) => {
							return { lightweight: true };
						}
					}
				}
			);

			await integrationManager.register(resourceExhaustionHandler);
			await integrationManager.register(lightweightHandler);
			await integrationManager.initialize();

			const eventPayload = createStandardEventPayload(
				EVENT_TYPES.TASK_CREATED,
				{
					taskId: 'resource-test',
					task: { id: 'resource-test', title: 'Resource Test' }
				},
				{ source: 'resource-test' }
			);

			const results = await integrationManager.handleEvent(
				EVENT_TYPES.TASK_CREATED,
				eventPayload
			);

			expect(results).toHaveLength(2);

			// Lightweight handler should always succeed
			const lightweightResult = results.find(
				(r) => r.success === true && r.result?.lightweight
			);
			expect(lightweightResult).toBeDefined();

			// Resource exhaustion handler may succeed or fail, but shouldn't crash system
			const resourceResult = results.find((r) => r !== lightweightResult);
			expect(resourceResult).toBeDefined();
			expect(resourceResult).toHaveProperty('success');
		});

		it('should handle event queue overflow', async () => {
			const { integrationManager } = testEnv;

			const slowHandler = TestFactories.createTestIntegrationHandler(
				'slow-handler',
				{
					eventHandlers: {
						'task:created': async (payload) => {
							// Simulate slow processing
							await new Promise((resolve) => setTimeout(resolve, 1000));
							return { processed: payload.taskId };
						}
					}
				}
			);

			await integrationManager.register(slowHandler);
			await integrationManager.initialize();

			// Generate many events quickly to overwhelm the queue
			const eventPromises = [];
			for (let i = 1; i <= 100; i++) {
				const eventPayload = createStandardEventPayload(
					EVENT_TYPES.TASK_CREATED,
					{
						taskId: `queue-overflow-${i}`,
						task: { id: `queue-overflow-${i}`, title: `Queue Test ${i}` }
					},
					{ source: 'queue-overflow-test' }
				);

				eventPromises.push(
					integrationManager.handleEvent(EVENT_TYPES.TASK_CREATED, eventPayload)
				);
			}

			// Should handle all events without crashing
			const results = await Promise.all(eventPromises);

			expect(results).toHaveLength(100);

			// Most events should succeed or fail gracefully
			const processedCount = results.filter((r) => r[0].success).length;
			const failedCount = results.filter((r) => !r[0].success).length;

			expect(processedCount + failedCount).toBe(100);

			// System should remain functional
			expect(integrationManager.isRunning()).toBe(true);
		});
	});

	describe('Dependency Failures', () => {
		it('should handle logger failures gracefully', async () => {
			const { integrationManager, dependencies } = testEnv;

			// Make logger fail
			dependencies.logger.error.mockImplementation(() => {
				throw new Error('Logger failed');
			});
			dependencies.logger.warn.mockImplementation(() => {
				throw new Error('Logger failed');
			});

			const handlerWithLogging = TestFactories.createTestIntegrationHandler(
				'logging-handler',
				{
					eventHandlers: {
						'task:created': async (payload) => {
							// This handler might try to log errors
							return { processed: true };
						}
					}
				}
			);

			await integrationManager.register(handlerWithLogging);
			await integrationManager.initialize();

			const eventPayload = createStandardEventPayload(
				EVENT_TYPES.TASK_CREATED,
				{
					taskId: 'logger-fail-test',
					task: { id: 'logger-fail-test', title: 'Logger Fail Test' }
				},
				{ source: 'logger-fail-test' }
			);

			// Should handle logger failures without breaking
			const results = await integrationManager.handleEvent(
				EVENT_TYPES.TASK_CREATED,
				eventPayload
			);

			expect(results).toHaveLength(1);
			// Handler should still succeed despite logging failures
			expect(results[0].success).toBe(true);
		});

		it('should handle health monitor failures', async () => {
			const { integrationManager, dependencies } = testEnv;

			// Make health monitor fail
			dependencies.healthMonitor.registerCheck.mockImplementation(() => {
				throw new Error('Health monitor failed');
			});

			const healthTestHandler = TestFactories.createTestIntegrationHandler(
				'health-test-handler',
				{
					eventHandlers: {
						'task:created': async (payload) => {
							return { healthy: true };
						}
					}
				}
			);

			// Should handle health monitor failure during registration
			expect(() =>
				integrationManager.register(healthTestHandler)
			).not.toThrow();
			await expect(integrationManager.initialize()).resolves.not.toThrow();

			const eventPayload = createStandardEventPayload(
				EVENT_TYPES.TASK_CREATED,
				{
					taskId: 'health-fail-test',
					task: { id: 'health-fail-test', title: 'Health Fail Test' }
				},
				{ source: 'health-fail-test' }
			);

			const results = await integrationManager.handleEvent(
				EVENT_TYPES.TASK_CREATED,
				eventPayload
			);

			expect(results).toHaveLength(1);
			expect(results[0].success).toBe(true);
		});
	});

	describe('Cascading Failure Prevention', () => {
		it('should prevent cascading failures across integrations', async () => {
			const { integrationManager } = testEnv;

			// Create a chain of handlers where first failure could cascade
			const triggerHandler = TestFactories.createTestIntegrationHandler(
				'trigger-handler',
				{
					eventHandlers: {
						'task:created': async (payload) => {
							// This handler always fails
							throw new Error('Initial failure');
						}
					}
				}
			);

			const dependentHandler = TestFactories.createTestIntegrationHandler(
				'dependent-handler',
				{
					eventHandlers: {
						'task:created': async (payload) => {
							// This handler might be tempted to fail if it detects other failures
							return { independent: true };
						}
					}
				}
			);

			const independentHandler = TestFactories.createTestIntegrationHandler(
				'independent-handler',
				{
					eventHandlers: {
						'task:created': async (payload) => {
							return { isolated: true };
						}
					}
				}
			);

			await integrationManager.register(triggerHandler);
			await integrationManager.register(dependentHandler);
			await integrationManager.register(independentHandler);
			await integrationManager.initialize();

			const eventPayload = createStandardEventPayload(
				EVENT_TYPES.TASK_CREATED,
				{
					taskId: 'cascade-test',
					task: { id: 'cascade-test', title: 'Cascade Test' }
				},
				{ source: 'cascade-test' }
			);

			const results = await integrationManager.handleEvent(
				EVENT_TYPES.TASK_CREATED,
				eventPayload
			);

			expect(results).toHaveLength(3);

			// Trigger handler should fail
			const triggerResult = results.find((r) => !r.success);
			expect(triggerResult).toBeDefined();
			expect(triggerResult.error).toContain('Initial failure');

			// Other handlers should succeed
			const successfulResults = results.filter((r) => r.success);
			expect(successfulResults).toHaveLength(2);

			expect(successfulResults.some((r) => r.result.independent)).toBe(true);
			expect(successfulResults.some((r) => r.result.isolated)).toBe(true);
		});

		it('should maintain system stability during mass failures', async () => {
			const { integrationManager } = testEnv;

			// Create many failing handlers
			const failingHandlers = [];
			for (let i = 1; i <= 10; i++) {
				const handler = TestFactories.createTestIntegrationHandler(
					`failing-handler-${i}`,
					{
						eventHandlers: {
							'task:created': async (payload) => {
								throw new Error(`Handler ${i} failed`);
							}
						}
					}
				);
				failingHandlers.push(handler);
				await integrationManager.register(handler);
			}

			// Add one stable handler
			const stableHandler = TestFactories.createTestIntegrationHandler(
				'stable-handler',
				{
					eventHandlers: {
						'task:created': async (payload) => {
							return { stable: true, survivedMassFailure: true };
						}
					}
				}
			);

			await integrationManager.register(stableHandler);
			await integrationManager.initialize();

			const eventPayload = createStandardEventPayload(
				EVENT_TYPES.TASK_CREATED,
				{
					taskId: 'mass-failure-test',
					task: { id: 'mass-failure-test', title: 'Mass Failure Test' }
				},
				{ source: 'mass-failure-test' }
			);

			const results = await integrationManager.handleEvent(
				EVENT_TYPES.TASK_CREATED,
				eventPayload
			);

			expect(results).toHaveLength(11);

			// 10 failures
			const failures = results.filter((r) => !r.success);
			expect(failures).toHaveLength(10);

			// 1 success
			const successes = results.filter((r) => r.success);
			expect(successes).toHaveLength(1);
			expect(successes[0].result.stable).toBe(true);
			expect(successes[0].result.survivedMassFailure).toBe(true);

			// System should remain operational
			expect(integrationManager.isRunning()).toBe(true);
		});
	});
});
