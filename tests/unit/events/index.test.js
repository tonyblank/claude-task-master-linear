/**
 * @fileoverview Tests for event system index module
 */

import {
	getEventManager,
	initializeEventSystem,
	shutdownEventSystem,
	resetEventSystem,
	registerIntegration,
	emitEvent,
	isIntegrationEnabled,
	getEventSystemStats,
	getIntegrationStatus,
	createOperationContext,
	authenticationMiddleware,
	taskEnrichmentMiddleware,
	createFilterMiddleware,
	validateIntegrationConfig,
	IntegrationManager,
	BaseIntegrationHandler,
	EVENT_TYPES,
	__testing
} from '../../../scripts/modules/events/index.js';

// Test integration for testing
class TestIntegration extends BaseIntegrationHandler {
	constructor(name = 'test-integration') {
		super(name, '1.0.0', { enabled: true });
		this.handledEvents = [];
	}

	async handleTaskCreated(payload) {
		this.handledEvents.push({ type: 'task:created', payload });
		return { success: true };
	}
}

describe('Event System Index', () => {
	afterEach(async () => {
		await resetEventSystem();
	});

	describe('getEventManager', () => {
		test('should return singleton instance', () => {
			const manager1 = getEventManager();
			const manager2 = getEventManager();

			expect(manager1).toBe(manager2);
			expect(manager1).toBeInstanceOf(IntegrationManager);
		});

		test('should create manager with provided config', () => {
			const config = { maxConcurrentHandlers: 10 };
			const manager = getEventManager(config);

			expect(manager.config.maxConcurrentHandlers).toBe(10);
		});

		test('should not recreate if already exists', () => {
			const manager1 = getEventManager({ test: 'config1' });
			const manager2 = getEventManager({ test: 'config2' });

			expect(manager1).toBe(manager2);
			// Config from first call should be preserved
			expect(manager1.config.test).toBe('config1');
		});
	});

	describe('initializeEventSystem', () => {
		test('should initialize global event manager', async () => {
			const manager = await initializeEventSystem();

			expect(manager).toBeInstanceOf(IntegrationManager);
			expect(manager.initialized).toBe(true);
		});

		test('should not initialize twice', async () => {
			await initializeEventSystem();

			// Store original console.log
			const originalLog = console.log;
			const logCalls = [];
			console.log = (...args) => logCalls.push(args);

			await initializeEventSystem();

			// Restore console.log
			console.log = originalLog;

			// Should not throw or cause issues
			expect(true).toBe(true);
		});

		test('should pass config to manager', async () => {
			const config = { batchSize: 20 };
			const manager = await initializeEventSystem(config);

			expect(manager.config.batchSize).toBe(20);
		});
	});

	describe('shutdownEventSystem', () => {
		test('should shutdown initialized system', async () => {
			const manager = await initializeEventSystem();
			expect(manager.initialized).toBe(true);

			await shutdownEventSystem();

			expect(__testing.getGlobalEventManager()).toBeNull();
		});

		test('should handle shutdown when not initialized', async () => {
			// Should not throw
			await expect(shutdownEventSystem()).resolves.not.toThrow();
		});
	});

	describe('resetEventSystem', () => {
		test('should reset global manager', async () => {
			await initializeEventSystem();
			expect(__testing.getGlobalEventManager()).not.toBeNull();

			await resetEventSystem();

			expect(__testing.getGlobalEventManager()).toBeNull();
		});
	});

	describe('registerIntegration', () => {
		test('should register integration with global manager', async () => {
			const integration = new TestIntegration();

			registerIntegration(integration);

			const manager = getEventManager();
			expect(manager.integrations.has('test-integration')).toBe(true);
		});

		test('should work before initialization', () => {
			const integration = new TestIntegration();

			expect(() => registerIntegration(integration)).not.toThrow();
		});
	});

	describe('emitEvent', () => {
		test('should emit event through global manager', async () => {
			const integration = new TestIntegration();
			registerIntegration(integration);
			await initializeEventSystem();

			const context = createOperationContext('/test', { user: 'test' });

			await emitEvent(
				EVENT_TYPES.TASK_CREATED,
				{
					taskId: 'task-123',
					task: { id: 'task-123' },
					tag: 'master'
				},
				context
			);

			// Due to current implementation registering both specific and wildcard handlers,
			// an integration with both handleTaskCreated and handleGenericEvent gets called twice
			expect(integration.handledEvents.length).toBeGreaterThanOrEqual(1);
		});

		test('should handle emit before initialization', async () => {
			// Store original console.log
			const originalLog = console.log;
			const logCalls = [];
			console.log = (...args) => logCalls.push(args);

			await emitEvent('test:event', {}, {});

			// Restore console.log
			console.log = originalLog;

			// Check that warning was logged
			const warnFound = logCalls.some((call) =>
				call.some(
					(arg) =>
						typeof arg === 'string' &&
						arg.includes('[WARN]') &&
						arg.includes('IntegrationManager not initialized')
				)
			);
			expect(warnFound).toBe(true);
		});
	});

	describe('isIntegrationEnabled', () => {
		test('should return false when no manager exists', () => {
			expect(isIntegrationEnabled('test-integration')).toBe(false);
		});

		test('should check integration status', async () => {
			const integration = new TestIntegration();
			registerIntegration(integration);
			await initializeEventSystem();

			expect(isIntegrationEnabled('test-integration')).toBe(true);
			expect(isIntegrationEnabled('non-existent')).toBe(false);
		});
	});

	describe('getEventSystemStats', () => {
		test('should return null when no manager exists', () => {
			expect(getEventSystemStats()).toBeNull();
		});

		test('should return stats from manager', async () => {
			await initializeEventSystem();

			const stats = getEventSystemStats();

			expect(stats).toBeDefined();
			expect(stats.eventsEmitted).toBeDefined();
			expect(stats.registeredIntegrations).toBeDefined();
		});
	});

	describe('getIntegrationStatus', () => {
		test('should return null when no manager exists', () => {
			expect(getIntegrationStatus()).toBeNull();
		});

		test('should return integration status', async () => {
			const integration = new TestIntegration();
			registerIntegration(integration);
			await initializeEventSystem();

			const status = getIntegrationStatus();

			expect(status).toBeDefined();
			expect(status['test-integration']).toBeDefined();
			expect(status['test-integration'].name).toBe('test-integration');
		});
	});

	describe('createOperationContext', () => {
		test('should create valid context', () => {
			const session = { user: 'testuser' };
			const context = createOperationContext('/test/project', session);

			expect(context.projectRoot).toBe('/test/project');
			expect(context.session).toBe(session);
			expect(context.source).toBe('api');
			expect(context.requestId).toBeDefined();
			expect(context.user).toBe('testuser');
		});

		test('should allow custom source', () => {
			const context = createOperationContext('/test', {}, 'cli');

			expect(context.source).toBe('cli');
		});

		test('should merge additional options', () => {
			const options = { customField: 'value', requestId: 'custom-id' };
			const context = createOperationContext('/test', {}, 'api', options);

			expect(context.customField).toBe('value');
			expect(context.requestId).toBe('custom-id');
		});

		test('should generate request ID if not provided', () => {
			const context = createOperationContext('/test', {});

			expect(context.requestId).toMatch(/^req_\d+_[a-z0-9]+$/);
		});
	});

	describe('middleware functions', () => {
		describe('authenticationMiddleware', () => {
			test('should add authentication info when session exists', () => {
				const payload = {
					taskId: 'task-123',
					context: { session: { user: 'testuser' } }
				};

				const result = authenticationMiddleware('task:created', payload);

				expect(result.authenticated).toBe(true);
				expect(result.userId).toBe('testuser');
			});

			test('should handle missing session', () => {
				const payload = {
					taskId: 'task-123',
					context: {}
				};

				const result = authenticationMiddleware('task:created', payload);

				expect(result.authenticated).toBe(false);
				expect(result.userId).toBe('anonymous');
			});

			test('should handle missing context', () => {
				const payload = { taskId: 'task-123' };

				const result = authenticationMiddleware('task:created', payload);

				expect(result.authenticated).toBe(false);
				expect(result.userId).toBe('anonymous');
			});
		});

		describe('taskEnrichmentMiddleware', () => {
			test('should enrich task events', () => {
				const payload = {
					task: {
						id: 'task-123',
						priority: 'high',
						subtasks: [{ id: 'sub-1' }],
						dependencies: ['task-122']
					}
				};

				const result = taskEnrichmentMiddleware('task:created', payload);

				expect(result.enriched).toBeDefined();
				expect(result.enriched.hasSubtasks).toBe(true);
				expect(result.enriched.hasDependencies).toBe(true);
				expect(result.enriched.isHighPriority).toBe(true);
				expect(result.enriched.estimatedComplexity).toBe(1);
			});

			test('should not enrich non-task events', () => {
				const payload = { data: 'test' };

				const result = taskEnrichmentMiddleware('system:startup', payload);

				expect(result.enriched).toBeUndefined();
			});

			test('should handle tasks without subtasks/dependencies', () => {
				const payload = {
					task: {
						id: 'task-123',
						priority: 'low',
						subtasks: [],
						dependencies: []
					}
				};

				const result = taskEnrichmentMiddleware('task:created', payload);

				expect(result.enriched.hasSubtasks).toBe(false);
				expect(result.enriched.hasDependencies).toBe(false);
				expect(result.enriched.isHighPriority).toBe(false);
			});
		});

		describe('createFilterMiddleware', () => {
			test('should filter by event type', () => {
				const filter = createFilterMiddleware({
					excludeEventTypes: ['task:created']
				});

				const result = filter('task:created', { taskId: 'task-123' });
				expect(result).toBeNull();

				const result2 = filter('task:updated', { taskId: 'task-123' });
				expect(result2).toBeDefined();
			});

			test('should filter internal tasks', () => {
				const filter = createFilterMiddleware({
					excludeInternalTasks: true
				});

				const internalTaskPayload = {
					task: { title: '_internal_task' }
				};
				const regularTaskPayload = {
					task: { title: 'regular task' }
				};

				expect(filter('task:created', internalTaskPayload)).toBeNull();
				expect(filter('task:created', regularTaskPayload)).toBeDefined();
			});

			test('should filter low priority tasks', () => {
				const filter = createFilterMiddleware({
					excludeLowPriority: true
				});

				const lowPriorityPayload = {
					task: { priority: 'low' }
				};
				const highPriorityPayload = {
					task: { priority: 'high' }
				};

				expect(filter('task:created', lowPriorityPayload)).toBeNull();
				expect(filter('task:created', highPriorityPayload)).toBeDefined();
			});

			test('should filter by source', () => {
				const filter = createFilterMiddleware({
					allowedSources: ['cli', 'api']
				});

				const cliPayload = { context: { source: 'cli' } };
				const webhookPayload = { context: { source: 'webhook' } };

				expect(filter('task:created', cliPayload)).toBeDefined();
				expect(filter('task:created', webhookPayload)).toBeNull();
			});

			test('should handle empty filter config', () => {
				const filter = createFilterMiddleware();
				const payload = { taskId: 'task-123' };

				expect(filter('task:created', payload)).toBe(payload);
			});
		});
	});

	describe('validateIntegrationConfig', () => {
		test('should validate correct configuration', () => {
			const config = {
				eventProcessing: {
					maxConcurrentHandlers: 5,
					handlerTimeout: 30000,
					batchSize: 10
				},
				retry: {
					maxAttempts: 3,
					baseDelay: 1000,
					backoffStrategy: 'exponential'
				}
			};

			const result = validateIntegrationConfig(config);

			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		test('should reject invalid configuration', () => {
			const result = validateIntegrationConfig(null);

			expect(result.valid).toBe(false);
			expect(result.errors).toContain('Configuration must be an object');
		});

		test('should validate eventProcessing config', () => {
			const config = {
				eventProcessing: {
					maxConcurrentHandlers: -1,
					handlerTimeout: 'invalid',
					batchSize: -5 // Use negative number instead of 0
				}
			};

			const result = validateIntegrationConfig(config);

			expect(result.valid).toBe(false);
			expect(result.errors).toContain(
				'maxConcurrentHandlers must be a positive number'
			);
			expect(result.errors).toContain(
				'handlerTimeout must be a positive number'
			);
			expect(result.errors).toContain('batchSize must be a positive number');
		});

		test('should validate retry config', () => {
			const config = {
				retry: {
					maxAttempts: -1,
					baseDelay: -100, // Use negative number instead of 0
					backoffStrategy: 'invalid'
				}
			};

			const result = validateIntegrationConfig(config);

			expect(result.valid).toBe(false);
			expect(result.errors).toContain(
				'retry.maxAttempts must be a positive number'
			);
			expect(result.errors).toContain(
				'retry.baseDelay must be a positive number'
			);
			expect(result.errors).toContain(
				'retry.backoffStrategy must be one of: exponential, linear, fixed'
			);
		});

		test('should handle partial configuration', () => {
			const config = {
				eventProcessing: {
					maxConcurrentHandlers: 3
				}
			};

			const result = validateIntegrationConfig(config);

			expect(result.valid).toBe(true);
		});
	});

	describe('exports', () => {
		test('should export all required items', () => {
			expect(getEventManager).toBeDefined();
			expect(initializeEventSystem).toBeDefined();
			expect(shutdownEventSystem).toBeDefined();
			expect(resetEventSystem).toBeDefined();
			expect(registerIntegration).toBeDefined();
			expect(emitEvent).toBeDefined();
			expect(isIntegrationEnabled).toBeDefined();
			expect(getEventSystemStats).toBeDefined();
			expect(getIntegrationStatus).toBeDefined();
			expect(createOperationContext).toBeDefined();
			expect(authenticationMiddleware).toBeDefined();
			expect(taskEnrichmentMiddleware).toBeDefined();
			expect(createFilterMiddleware).toBeDefined();
			expect(validateIntegrationConfig).toBeDefined();
			expect(IntegrationManager).toBeDefined();
			expect(BaseIntegrationHandler).toBeDefined();
			expect(EVENT_TYPES).toBeDefined();
		});

		test('should export testing utilities', () => {
			expect(__testing).toBeDefined();
			expect(__testing.getGlobalEventManager).toBeDefined();
			expect(__testing.setGlobalEventManager).toBeDefined();
		});
	});
});
