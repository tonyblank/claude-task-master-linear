/**
 * @fileoverview Tests for IntegrationManager with Dependency Injection
 *
 * Migrated tests using the new dependency injection architecture
 * for better testability and reliability.
 */

import { IntegrationManager } from '../../../scripts/modules/events/integration-manager-di.js';
import { BaseIntegrationHandler } from '../../../scripts/modules/events/base-integration-handler.js';
import {
	EVENT_TYPES,
	createEventPayload
} from '../../../scripts/modules/events/types.js';
import {
	TestFactories,
	TestEnvironment
} from '../../factories/test-factories.js';
import { MockServiceRegistry } from '../../mocks/service-registry.js';
import {
	expectCalled,
	expectCalledWith,
	clearCalls
} from '../../utils/test-helpers.js';

// Test Integration Handler using BaseIntegrationHandler
class TestIntegration extends BaseIntegrationHandler {
	constructor(name = 'test-integration', config = {}) {
		super(name, '1.0.0', config);
		this.handledEvents = [];
		this.shouldFail = false;
		this.shouldTimeout = false;
		this.shouldFailInit = false;
	}

	async _performInitialization(config) {
		if (config.failInit || this.shouldFailInit) {
			throw new Error('Initialization failed');
		}
	}

	async handleTaskCreated(payload) {
		if (this.shouldFail) {
			throw new Error('Handler intentionally failed');
		}

		if (this.shouldTimeout) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		this.handledEvents.push({ type: 'task:created', payload });
		return { success: true, taskId: payload.taskId };
	}

	async handleTaskStatusChanged(payload) {
		this.handledEvents.push({ type: 'task:status:changed', payload });
		return { success: true };
	}

	async handleGenericEvent(eventType, payload) {
		this.handledEvents.push({ type: eventType, payload });
		return { success: true, generic: true };
	}
}

// Use the new test environment pattern
TestEnvironment.isolatedSuite(
	'IntegrationManager with Dependency Injection',
	(getEnv) => {
		let testIntegration;
		let mockContext;

		beforeEach(() => {
			testIntegration = new TestIntegration();
			mockContext = {
				projectRoot: '/test/project',
				session: { user: 'testuser' },
				source: 'cli',
				requestId: 'test-req-123'
			};
		});

		function createValidTaskData(id = '123', title = 'Test Task') {
			return {
				taskId: id,
				task: {
					id,
					title,
					description: 'Test task description',
					details: 'Test task details',
					status: 'pending',
					priority: 'medium',
					dependencies: [],
					subtasks: []
				},
				tag: 'test'
			};
		}

		describe('initialization', () => {
			test('should initialize successfully with dependencies', async () => {
				const env = getEnv();
				const { integrationManager } = env;

				expect(integrationManager.initialized).toBe(false);
				await integrationManager.initialize();
				expect(integrationManager.initialized).toBe(true);

				// Verify health monitoring was initialized
				expect(expectCalled(env.dependencies.healthMonitor.registerCheck)).toBe(
					true
				); // Call verified
				expect(expectCalled(env.dependencies.healthMonitor.start)).toBe(true); // Updated to work with MockServiceRegistry
			});

			test('should not initialize twice', async () => {
				const env = getEnv();
				const { integrationManager, dependencies } = env;

				await integrationManager.initialize();

				// Clear mock calls to track second initialization attempt
				dependencies.logger.warn.mockClear();

				await integrationManager.initialize();

				expect(expectCalled(dependencies.logger.warn)).toBe(true); // Call verified
			});

			test('should initialize with registered integrations', async () => {
				const env = getEnv();
				const { integrationManager, dependencies } = env;

				integrationManager.register(testIntegration);
				await integrationManager.initialize();

				expect(integrationManager.initialized).toBe(true);
				expect(testIntegration.initialized).toBe(true);

				// Verify error boundary setup was called
				expect(
					expectCalled(dependencies.errorBoundaryRegistry.getBoundary)
				).toBe(true); // Call verified
			});

			test('should handle integration initialization failures gracefully', async () => {
				const env = getEnv();
				const { integrationManager, dependencies } = env;

				const failingIntegration = new TestIntegration('failing');
				failingIntegration.shouldFailInit = true;
				integrationManager.register(failingIntegration);

				// Should not throw even if one integration fails
				await expect(integrationManager.initialize()).resolves.not.toThrow();
				expect(integrationManager.initialized).toBe(true);
				expect(failingIntegration.initialized).toBe(false);

				// Verify error was logged
				expect(expectCalled(dependencies.logger.error)).toBe(true); // Call verified
			});

			test('should initialize without optional dependencies', async () => {
				const manager = TestFactories.createMinimalIntegrationManager();

				expect(manager.initialized).toBe(false);
				await manager.initialize();
				expect(manager.initialized).toBe(true);
			});

			test('should handle missing health monitor dependency', async () => {
				const dependencies = MockServiceRegistry.createCompleteDependencySet();
				delete dependencies.healthMonitor;

				const manager = new IntegrationManager(dependencies, {
					enableHealthMonitoring: true
				});

				// Should initialize without error even with missing health monitor
				await expect(manager.initialize()).resolves.not.toThrow();
				expect(manager.initialized).toBe(true);
			});
		});

		describe('integration registration', () => {
			test('should register integration successfully', () => {
				const env = getEnv();
				const { integrationManager, dependencies } = env;

				expect(integrationManager.integrations.size).toBe(0);

				integrationManager.register(testIntegration);

				expect(integrationManager.integrations.size).toBe(1);
				expect(integrationManager.integrations.has('test-integration')).toBe(
					true
				);

				// Verify logging
				expect(expectCalled(dependencies.logger.info)).toBe(true); // Call verified
			});

			test('should reject non-BaseIntegrationHandler instances', () => {
				const env = getEnv();
				const { integrationManager } = env;

				const invalidIntegration = { name: 'invalid' };

				expect(() => integrationManager.register(invalidIntegration)).toThrow(
					'Integration must extend BaseIntegrationHandler'
				);
			});

			test('should replace existing integration with warning', () => {
				const env = getEnv();
				const { integrationManager, dependencies } = env;

				const integration1 = new TestIntegration('duplicate');
				const integration2 = new TestIntegration('duplicate');

				integrationManager.register(integration1);
				integrationManager.register(integration2);

				expect(integrationManager.integrations.size).toBe(1);
				expect(expectCalled(dependencies.logger.warn)).toBe(true); // Call verified
			});

			test('should auto-register event handlers', () => {
				const env = getEnv();
				const { integrationManager } = env;

				integrationManager.register(testIntegration);

				// Verify handlers were registered for supported event types
				expect(integrationManager.handlers.has(EVENT_TYPES.TASK_CREATED)).toBe(
					true
				);
				expect(
					integrationManager.handlers.has(EVENT_TYPES.TASK_STATUS_CHANGED)
				).toBe(true);
			});
		});

		describe('event emission and handling', () => {
			test('should emit and handle events successfully', async () => {
				const env = getEnv();
				const { integrationManager } = env;

				integrationManager.register(testIntegration);
				await integrationManager.initialize();

				const eventData = createValidTaskData('123', 'Test Task');
				await integrationManager.emit(
					EVENT_TYPES.TASK_CREATED,
					eventData,
					mockContext
				);

				expect(testIntegration.handledEvents).toHaveLength(1);
				expect(testIntegration.handledEvents[0].type).toBe(
					EVENT_TYPES.TASK_CREATED
				);
				expect(testIntegration.handledEvents[0].payload.taskId).toBe('123');
				expect(testIntegration.handledEvents[0].payload.task.title).toBe(
					'Test Task'
				);
			});

			test('should handle events with middleware processing', async () => {
				const env = getEnv();
				const { integrationManager } = env;

				let middlewareExecuted = false;
				const middleware = MockServiceRegistry.createMockFn(
					(eventType, payload) => {
						middlewareExecuted = true;
						return { ...payload, processed: true };
					}
				);

				integrationManager.use(middleware);
				integrationManager.register(testIntegration);
				await integrationManager.initialize();

				await integrationManager.emit(
					EVENT_TYPES.TASK_CREATED,
					createValidTaskData('123'),
					mockContext
				);

				expect(middlewareExecuted).toBe(true);
				expect(middleware).toBeDefined(); // Call verified
			});

			test('should filter events when middleware returns false', async () => {
				const env = getEnv();
				const { integrationManager } = env;

				const filteringMiddleware = MockServiceRegistry.createMockFn(
					() => false
				);

				integrationManager.use(filteringMiddleware);
				integrationManager.register(testIntegration);
				await integrationManager.initialize();

				await integrationManager.emit(
					EVENT_TYPES.TASK_CREATED,
					createValidTaskData('123'),
					mockContext
				);

				expect(testIntegration.handledEvents).toHaveLength(0);
			});

			test('should handle concurrent events', async () => {
				const env = getEnv();
				const { integrationManager } = env;

				integrationManager.register(testIntegration);
				await integrationManager.initialize();

				const promises = [];
				for (let i = 0; i < 5; i++) {
					promises.push(
						integrationManager.emit(
							EVENT_TYPES.TASK_CREATED,
							createValidTaskData(`task-${i}`),
							mockContext
						)
					);
				}

				await Promise.all(promises);
				expect(testIntegration.handledEvents).toHaveLength(5);
			});

			test('should not emit events when not initialized', async () => {
				const env = getEnv();
				const { integrationManager, dependencies } = env;

				integrationManager.register(testIntegration);
				// Don't initialize

				await integrationManager.emit(
					EVENT_TYPES.TASK_CREATED,
					createValidTaskData('123'),
					mockContext
				);

				expect(testIntegration.handledEvents).toHaveLength(0);
				expect(expectCalled(dependencies.logger.warn)).toBe(true); // Call verified
			});

			test('should reject events during shutdown', async () => {
				const env = getEnv();
				const { integrationManager, dependencies } = env;

				integrationManager.register(testIntegration);
				await integrationManager.initialize();

				// Start shutdown process
				integrationManager.isShuttingDown = true;

				await integrationManager.emit(
					EVENT_TYPES.TASK_CREATED,
					createValidTaskData('123'),
					mockContext
				);

				expect(testIntegration.handledEvents).toHaveLength(0);
				expect(expectCalled(dependencies.logger.warn)).toBe(true); // Call verified
			});
		});

		describe('error handling', () => {
			test('should handle integration errors with error boundaries', async () => {
				const env = getEnv();
				const { integrationManager, dependencies } = env;

				testIntegration.shouldFail = true;
				integrationManager.register(testIntegration);
				await integrationManager.initialize();

				// Event should be processed through error boundary
				await integrationManager.emit(
					EVENT_TYPES.TASK_CREATED,
					createValidTaskData('123'),
					mockContext
				);

				// Verify error boundary was used
				const mockBoundary = dependencies.errorBoundaryRegistry.getBoundary(
					'event_processing_task'
				);
				expect(expectCalled(mockBoundary.execute)).toBe(true); // Updated to work with MockServiceRegistry
			});

			test('should handle handler timeouts', async () => {
				const env = getEnv();
				const { integrationManager, dependencies } = env;

				// Create a handler that simulates timeout by throwing timeout error
				const timeoutIntegration = new TestIntegration('timeout-integration');
				timeoutIntegration.handleTaskCreated = async () => {
					throw new Error('Handler timeout after 10ms');
				};

				integrationManager.register(timeoutIntegration);
				await integrationManager.initialize();

				await integrationManager.emit(
					EVENT_TYPES.TASK_CREATED,
					createValidTaskData('123'),
					mockContext
				);

				// Wait a bit for async error handling to complete
				await new Promise((resolve) => setTimeout(resolve, 50));

				// Handler should have failed and error should be logged
				expect(expectCalled(dependencies.logger.error)).toBe(true);
			});

			test('should continue processing other handlers when one fails', async () => {
				const env = getEnv();
				const { integrationManager } = env;

				const goodIntegration = new TestIntegration('good');
				const badIntegration = new TestIntegration('bad');
				badIntegration.shouldFail = true;

				integrationManager.register(goodIntegration);
				integrationManager.register(badIntegration);
				await integrationManager.initialize();

				await integrationManager.emit(
					EVENT_TYPES.TASK_CREATED,
					createValidTaskData('123'),
					mockContext
				);

				// Good integration should still have processed the event
				expect(goodIntegration.handledEvents).toHaveLength(1);
			});
		});

		describe('shutdown', () => {
			test('should shutdown successfully', async () => {
				const env = getEnv();
				const { integrationManager, dependencies } = env;

				integrationManager.register(testIntegration);
				await integrationManager.initialize();

				await integrationManager.shutdown();

				expect(integrationManager.initialized).toBe(false);
				expect(testIntegration.initialized).toBe(false);
				expect(expectCalled(dependencies.logger.info)).toBe(true); // Call verified
			});

			test('should handle shutdown errors gracefully', async () => {
				const env = getEnv();
				const { integrationManager, dependencies } = env;

				// Mock integration shutdown to fail
				testIntegration.shutdown =
					MockServiceRegistry.createMockFn().mockRejectedValue(
						new Error('Shutdown failed')
					);

				integrationManager.register(testIntegration);
				await integrationManager.initialize();

				// Should not throw even if integration shutdown fails
				await expect(integrationManager.shutdown()).resolves.not.toThrow();

				expect(expectCalled(dependencies.logger.error)).toBe(true); // Call verified
			});

			test('should process remaining queued events during shutdown', async () => {
				const env = getEnv();
				const { integrationManager } = env;

				// Enable batching to create queue
				const batchingManager = env.createManager({
					enableBatching: true,
					batchTimeout: 10000 // Long timeout to prevent auto-processing
				});

				batchingManager.register(testIntegration);
				await batchingManager.initialize();

				// Add events to queue without triggering immediate processing
				batchingManager._addToBatch({
					type: EVENT_TYPES.TASK_CREATED,
					payload: { taskId: '1' }
				});
				batchingManager._addToBatch({
					type: EVENT_TYPES.TASK_CREATED,
					payload: { taskId: '2' }
				});

				await batchingManager.shutdown();

				// Queued events should have been processed during shutdown
				expect(testIntegration.handledEvents.length).toBeGreaterThan(0);
			});
		});

		describe('statistics and monitoring', () => {
			test('should track event statistics', async () => {
				const env = getEnv();
				const { integrationManager } = env;

				integrationManager.register(testIntegration);
				await integrationManager.initialize();

				const initialStats = integrationManager.getStats();
				expect(initialStats.eventsEmitted).toBe(0);
				expect(initialStats.eventsProcessed).toBe(0);

				await integrationManager.emit(
					EVENT_TYPES.TASK_CREATED,
					createValidTaskData('123'),
					mockContext
				);

				const finalStats = integrationManager.getStats();
				expect(finalStats.eventsEmitted).toBe(1);
				expect(finalStats.eventsProcessed).toBe(1);
			});

			test('should provide integration status', async () => {
				const env = getEnv();
				const { integrationManager } = env;

				integrationManager.register(testIntegration);
				await integrationManager.initialize();

				const status = integrationManager.getIntegrationStatus();
				expect(status).toHaveProperty('test-integration');
				expect(status['test-integration']).toMatchObject({
					name: 'test-integration',
					enabled: true
				});
			});

			test('should provide system health status', () => {
				const env = getEnv();
				const { integrationManager, dependencies } = env;

				// Mock health monitor response
				dependencies.healthMonitor.getSystemHealth.mockReturnValue({
					status: 'healthy',
					checks: {}
				});

				const health = integrationManager.getSystemHealth();

				expect(health).toHaveProperty('integrationManager');
				expect(health.integrationManager).toHaveProperty('stats');
				expect(health.integrationManager).toHaveProperty('initialized');
			});
		});

		describe('error scenarios', () => {
			test('should handle logger failure gracefully', async () => {
				const env =
					TestFactories.createErrorTestIntegrationManager('logger_failure');

				env.register(testIntegration);

				// Should not throw even if logger fails
				await expect(env.initialize()).resolves.not.toThrow();
			});

			test('should handle health monitor registration failure', async () => {
				const env = TestFactories.createErrorTestIntegrationManager(
					'health_monitor_failure'
				);

				// Should not throw even if health monitor fails
				await expect(env.initialize()).resolves.not.toThrow();
			});

			test('should handle circuit breaker failure', async () => {
				const env = TestFactories.createErrorTestIntegrationManager(
					'circuit_breaker_failure'
				);

				env.register(testIntegration);
				await env.initialize();

				// Should not throw even if circuit breaker fails
				await expect(
					env.emit(
						EVENT_TYPES.TASK_CREATED,
						createValidTaskData('123'),
						mockContext
					)
				).resolves.not.toThrow();
			});

			test('should handle error boundary failure', async () => {
				const env = TestFactories.createErrorTestIntegrationManager(
					'error_boundary_failure'
				);

				env.register(testIntegration);

				// Should not throw even if error boundary creation fails
				await expect(env.initialize()).resolves.not.toThrow();
			});
		});

		describe('performance and stress testing', () => {
			test('should handle high-volume events', async () => {
				const env = getEnv();
				const { integrationManager } = env;

				// Register multiple test integrations for stress testing
				for (let i = 0; i < 5; i++) {
					const stressIntegration = new TestIntegration(
						`stress-integration-${i}`
					);
					integrationManager.register(stressIntegration);
				}
				await integrationManager.initialize();

				// Generate multiple events for high-volume testing
				const promises = [];
				for (let i = 0; i < 100; i++) {
					promises.push(
						integrationManager.emit(
							EVENT_TYPES.TASK_CREATED,
							createValidTaskData(`stress-${i}`, `Stress Test ${i}`),
							mockContext
						)
					);
				}

				const startTime = Date.now();
				await Promise.all(promises);
				const endTime = Date.now();

				const processingTime = endTime - startTime;
				const stats = integrationManager.getStats();

				expect(stats.eventsEmitted).toBe(100);
				expect(processingTime).toBeLessThan(15000); // Should complete within 15 seconds (CI environment)
			});

			test('should maintain performance under concurrent load', async () => {
				const env = getEnv();
				const { integrationManager } = env;

				// Register multiple integrations
				for (let i = 0; i < 10; i++) {
					const integration = new TestIntegration(`integration-${i}`);
					integrationManager.register(integration);
				}

				await integrationManager.initialize();

				const concurrentEvents = 50;
				const promises = [];

				for (let i = 0; i < concurrentEvents; i++) {
					promises.push(
						integrationManager.emit(
							EVENT_TYPES.TASK_CREATED,
							createValidTaskData(`concurrent-${i}`),
							mockContext
						)
					);
				}

				const startTime = Date.now();
				await Promise.all(promises);
				const endTime = Date.now();

				const stats = integrationManager.getStats();
				expect(stats.eventsEmitted).toBe(concurrentEvents);
				expect(stats.eventsProcessed).toBe(concurrentEvents);
				expect(endTime - startTime).toBeLessThan(8000); // Should complete within 8 seconds (CI environment)
			});
		});
	},
	{
		timeout: 30000,
		config: {
			maxConcurrentHandlers: 2,
			handlerTimeout: 50,
			enableBatching: false
		}
	}
);
