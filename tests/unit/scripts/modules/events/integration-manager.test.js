/**
 * Integration Manager Tests
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

jest.mock('../../../../../scripts/modules/events/types.js', () => ({
	EVENT_TYPES: {
		TASK_CREATED: 'task:created',
		TASK_UPDATED: 'task:updated',
		TASK_STATUS_CHANGED: 'task:status-changed',
		TASKS_BULK_CREATED: 'tasks:bulk-created'
	},
	DEFAULT_CONFIG: {
		eventProcessing: {
			maxConcurrentHandlers: 5,
			handlerTimeout: 30000,
			batchTimeout: 1000,
			batchSize: 10,
			enableBatching: true
		}
	},
	validateEventPayload: jest.fn(() => true),
	createEventPayload: jest.fn((type, data, context) => ({
		id: 'test-event-id',
		type,
		payload: data,
		context,
		timestamp: Date.now()
	}))
}));

// Create a concrete test implementation that extends BaseIntegrationHandler
class TestIntegrationHandler {
	constructor(name) {
		this.name = name;
		this.enabled = true;
	}

	getName() {
		return this.name;
	}
	isEnabled() {
		return this.enabled;
	}
	async initialize() {
		return Promise.resolve();
	}
	async shutdown() {
		return Promise.resolve();
	}
	getStatus() {
		return { status: 'active' };
	}
	handleEvent() {
		return Promise.resolve();
	}
}

jest.mock(
	'../../../../../scripts/modules/events/base-integration-handler.js',
	() => ({
		BaseIntegrationHandler: TestIntegrationHandler
	})
);

jest.mock('../../../../../scripts/modules/events/error-boundary.js', () => ({
	errorBoundaryRegistry: {
		getBoundary: jest.fn(() => ({
			execute: jest.fn((fn) => fn()),
			handleError: jest.fn(),
			on: jest.fn(),
			reset: jest.fn()
		})),
		getAllStatuses: jest.fn(() => ({}))
	}
}));

jest.mock('../../../../../scripts/modules/events/circuit-breaker.js', () => ({
	circuitBreakerRegistry: {
		getBreaker: jest.fn(() => ({
			getStatus: jest.fn(() => ({ state: 'closed' }))
		})),
		getAllStatuses: jest.fn(() => ({}))
	}
}));

jest.mock('../../../../../scripts/modules/events/health-monitor.js', () => ({
	healthMonitor: {
		registerCheck: jest.fn(),
		start: jest.fn(),
		getSystemHealth: jest.fn(() => ({ status: 'healthy' }))
	}
}));

jest.mock('../../../../../scripts/modules/events/recovery-manager.js', () => ({
	recoveryManager: {
		registerStrategy: jest.fn(),
		start: jest.fn()
	}
}));

import { IntegrationManager } from '../../../../../scripts/modules/events/integration-manager.js';
const { BaseIntegrationHandler } = await import(
	'../../../../../scripts/modules/events/base-integration-handler.js'
);

describe.skip('IntegrationManager (Legacy - replaced by DI version)', () => {
	let integrationManager;
	let mockIntegration;

	beforeEach(() => {
		jest.clearAllMocks();
		integrationManager = new IntegrationManager({
			enableErrorBoundaries: true,
			enableCircuitBreakers: true,
			enableHealthMonitoring: true,
			enableAutoRecovery: true,
			maxConcurrentHandlers: 3,
			handlerTimeout: 5000
		});

		mockIntegration = new TestIntegrationHandler('test-integration');
	});

	afterEach(async () => {
		if (integrationManager.initialized) {
			await integrationManager.shutdown();
		}
	});

	describe('constructor', () => {
		test('should initialize with default configuration', () => {
			const manager = new IntegrationManager();
			expect(manager.config.enableErrorBoundaries).toBe(true);
			expect(manager.initialized).toBe(false);
			expect(manager.handlers.size).toBe(0);
			expect(manager.integrations.size).toBe(0);
		});

		test('should initialize with custom configuration', () => {
			const config = {
				enableErrorBoundaries: false,
				maxConcurrentHandlers: 10
			};
			const manager = new IntegrationManager(config);
			expect(manager.config.enableErrorBoundaries).toBe(false);
			expect(manager.config.maxConcurrentHandlers).toBe(10);
		});

		test('should initialize error boundaries map', () => {
			expect(integrationManager.errorBoundaries).toBeInstanceOf(Map);
		});
	});

	describe('initialize method', () => {
		test('should initialize integration manager', async () => {
			await integrationManager.initialize();

			expect(integrationManager.initialized).toBe(true);
		});

		test('should not initialize if already initialized', async () => {
			await integrationManager.initialize();
			const firstInitTime = integrationManager.initialized;

			await integrationManager.initialize();

			expect(integrationManager.initialized).toBe(firstInitTime);
		});

		test('should initialize health monitoring when enabled', async () => {
			await integrationManager.initialize();

			// Import the mocked health monitor
			const { healthMonitor: healthMonitorMock } = await import(
				'../../../../../scripts/modules/events/health-monitor.js'
			);

			expect(healthMonitorMock.registerCheck).toHaveBeenCalled();
			expect(healthMonitorMock.start).toHaveBeenCalled();
		});

		test('should initialize recovery manager when enabled', async () => {
			const {
				recoveryManager
			} = require('../../../../../scripts/modules/events/recovery-manager.js');

			await integrationManager.initialize();

			expect(recoveryManager.registerStrategy).toHaveBeenCalled();
			expect(recoveryManager.start).toHaveBeenCalled();
		});

		test('should initialize registered integrations', async () => {
			mockIntegration.initialize = jest.fn().mockResolvedValue();
			integrationManager.register(mockIntegration);

			await integrationManager.initialize();

			expect(mockIntegration.initialize).toHaveBeenCalled();
		});

		test('should handle integration initialization failures', async () => {
			const {
				errorBoundaryRegistry
			} = require('../../../../../scripts/modules/events/error-boundary.js');
			const mockBoundary = { handleError: jest.fn() };
			errorBoundaryRegistry.getBoundary.mockReturnValue(mockBoundary);

			mockIntegration.initialize = jest
				.fn()
				.mockRejectedValue(new Error('Init failed'));
			integrationManager.register(mockIntegration);

			await integrationManager.initialize();

			expect(mockBoundary.handleError).toHaveBeenCalled();
		});
	});

	describe('shutdown method', () => {
		test('should shutdown integration manager', async () => {
			await integrationManager.initialize();
			await integrationManager.shutdown();

			expect(integrationManager.initialized).toBe(false);
		});

		test('should not shutdown if not initialized', async () => {
			const isShuttingDown = integrationManager.isShuttingDown;
			await integrationManager.shutdown();

			expect(integrationManager.isShuttingDown).toBe(isShuttingDown);
		});

		test('should process remaining queued events', async () => {
			await integrationManager.initialize();

			// Add some events to queue
			integrationManager.eventQueue.push({ type: 'test', payload: {} });

			const processBatchSpy = jest.spyOn(integrationManager, '_processBatch');

			await integrationManager.shutdown();

			expect(processBatchSpy).toHaveBeenCalled();
		});

		test('should shutdown all integrations', async () => {
			mockIntegration.shutdown = jest.fn().mockResolvedValue();
			integrationManager.register(mockIntegration);
			await integrationManager.initialize();

			await integrationManager.shutdown();

			expect(mockIntegration.shutdown).toHaveBeenCalled();
		});
	});

	describe('register method', () => {
		test('should register integration handler', () => {
			integrationManager.register(mockIntegration);

			expect(integrationManager.integrations.has('test-integration')).toBe(
				true
			);
			expect(integrationManager.integrations.get('test-integration')).toBe(
				mockIntegration
			);
		});

		test('should throw error for invalid integration', () => {
			expect(() => {
				integrationManager.register('not-an-integration');
			}).toThrow('Integration must extend BaseIntegrationHandler');
		});

		test('should replace existing integration with warning', () => {
			integrationManager.register(mockIntegration);
			const newIntegration = new TestIntegrationHandler('test-integration');

			integrationManager.register(newIntegration);

			expect(integrationManager.integrations.get('test-integration')).toBe(
				newIntegration
			);
		});

		test('should auto-register integration for events', () => {
			const onSpy = jest.spyOn(integrationManager, 'on');

			integrationManager.register(mockIntegration);

			expect(onSpy).toHaveBeenCalled();
		});
	});

	describe('unregister method', () => {
		test('should unregister integration', async () => {
			mockIntegration.shutdown = jest.fn().mockResolvedValue();
			integrationManager.register(mockIntegration);

			await integrationManager.unregister('test-integration');

			expect(integrationManager.integrations.has('test-integration')).toBe(
				false
			);
			expect(mockIntegration.shutdown).toHaveBeenCalled();
		});

		test('should handle non-existent integration', async () => {
			await expect(
				integrationManager.unregister('non-existent')
			).resolves.not.toThrow();
		});

		test('should remove handlers for unregistered integration', async () => {
			integrationManager.register(mockIntegration);
			integrationManager.on('test:event', () => {}, {
				integration: mockIntegration
			});

			await integrationManager.unregister('test-integration');

			expect(integrationManager.handlers.has('test:event')).toBe(false);
		});
	});

	describe('isEnabled method', () => {
		test('should return true for enabled integration', () => {
			integrationManager.register(mockIntegration);

			expect(integrationManager.isEnabled('test-integration')).toBe(true);
		});

		test('should return false for non-existent integration', () => {
			expect(integrationManager.isEnabled('non-existent')).toBe(false);
		});

		test('should return false for disabled integration', () => {
			mockIntegration.enabled = false;
			integrationManager.register(mockIntegration);

			expect(integrationManager.isEnabled('test-integration')).toBe(false);
		});
	});

	describe('on method', () => {
		test('should register event handler', () => {
			const handler = jest.fn();

			integrationManager.on('test:event', handler);

			expect(integrationManager.handlers.has('test:event')).toBe(true);
			expect(integrationManager.handlers.get('test:event')).toHaveLength(1);
		});

		test('should throw error for non-function handler', () => {
			expect(() => {
				integrationManager.on('test:event', 'not-a-function');
			}).toThrow('Handler must be a function');
		});

		test('should add handler with options', () => {
			const handler = jest.fn();
			const options = { integration: mockIntegration, sequential: true };

			integrationManager.on('test:event', handler, options);

			const handlerWrapper = integrationManager.handlers.get('test:event')[0];
			expect(handlerWrapper.options).toEqual(options);
			expect(handlerWrapper.integration).toBe(mockIntegration);
		});
	});

	describe('off method', () => {
		test('should remove event handler', () => {
			const handler = jest.fn();
			integrationManager.on('test:event', handler);

			integrationManager.off('test:event', handler);

			expect(integrationManager.handlers.has('test:event')).toBe(false);
		});

		test('should handle non-existent event type', () => {
			expect(() => {
				integrationManager.off('non-existent', jest.fn());
			}).not.toThrow();
		});
	});

	describe('use method', () => {
		test('should register middleware', () => {
			const middleware = jest.fn();

			integrationManager.use(middleware);

			expect(integrationManager.middleware).toContain(middleware);
		});

		test('should throw error for non-function middleware', () => {
			expect(() => {
				integrationManager.use('not-a-function');
			}).toThrow('Middleware must be a function');
		});
	});

	describe('emit method', () => {
		beforeEach(async () => {
			await integrationManager.initialize();
		});

		test('should emit event successfully', async () => {
			const handler = jest.fn().mockResolvedValue();
			integrationManager.on('test:event', handler);

			await integrationManager.emit('test:event', { data: 'test' });

			expect(handler).toHaveBeenCalled();
			expect(integrationManager.stats.eventsEmitted).toBe(1);
			expect(integrationManager.stats.eventsProcessed).toBe(1);
		});

		test('should not emit when not initialized', async () => {
			await integrationManager.shutdown();

			const handler = jest.fn();
			integrationManager.on('test:event', handler);

			await integrationManager.emit('test:event', { data: 'test' });

			expect(handler).not.toHaveBeenCalled();
		});

		test('should not emit when shutting down', async () => {
			integrationManager.isShuttingDown = true;

			const handler = jest.fn();
			integrationManager.on('test:event', handler);

			await integrationManager.emit('test:event', { data: 'test' });

			expect(handler).not.toHaveBeenCalled();
		});

		test('should validate event payload', async () => {
			const {
				validateEventPayload
			} = require('../../../../../scripts/modules/events/types.js');
			validateEventPayload.mockReturnValue(false);

			await expect(
				integrationManager.emit('test:event', { invalid: 'data' })
			).rejects.toThrow('Invalid event payload');
		});

		test('should use error boundary when enabled', async () => {
			const {
				errorBoundaryRegistry
			} = require('../../../../../scripts/modules/events/error-boundary.js');
			const mockBoundary = {
				execute: jest.fn((fn) => fn()),
				handleError: jest.fn()
			};
			errorBoundaryRegistry.getBoundary.mockReturnValue(mockBoundary);

			const handler = jest.fn().mockResolvedValue();
			integrationManager.on('test:event', handler);

			await integrationManager.emit('test:event', { data: 'test' });

			expect(mockBoundary.execute).toHaveBeenCalled();
		});

		test('should handle batching for bulk events', async () => {
			const addToBatchSpy = jest.spyOn(integrationManager, '_addToBatch');
			const shouldBatchSpy = jest
				.spyOn(integrationManager, '_shouldBatch')
				.mockReturnValue(true);

			await integrationManager.emit('tasks:bulk-created', { tasks: [] });

			expect(shouldBatchSpy).toHaveBeenCalled();
			expect(addToBatchSpy).toHaveBeenCalled();
		});

		test('should handle event emission errors', async () => {
			const handler = jest.fn().mockRejectedValue(new Error('Handler failed'));
			integrationManager.on('test:event', handler);

			await integrationManager.emit('test:event', { data: 'test' });

			expect(integrationManager.stats.eventsFailed).toBe(0); // Handler failure doesn't fail emission
		});

		test('should create fallback for error boundary', async () => {
			const createFallbackSpy = jest.spyOn(
				integrationManager,
				'_createEventFallback'
			);

			await integrationManager.emit('test:event', { data: 'test' });

			expect(createFallbackSpy).toHaveBeenCalled();
		});
	});

	describe('getStats method', () => {
		test('should return integration manager statistics', () => {
			integrationManager.stats.eventsEmitted = 10;
			integrationManager.stats.eventsProcessed = 8;
			integrationManager.register(mockIntegration);
			integrationManager.on('test:event', jest.fn());

			const stats = integrationManager.getStats();

			expect(stats.eventsEmitted).toBe(10);
			expect(stats.eventsProcessed).toBe(8);
			expect(stats.registeredIntegrations).toBe(1);
			expect(stats.registeredHandlers).toBe(1);
			expect(stats.initialized).toBe(false);
		});
	});

	describe('getIntegrationStatus method', () => {
		test('should return status of all integrations', () => {
			integrationManager.register(mockIntegration);

			const status = integrationManager.getIntegrationStatus();

			expect(status).toHaveProperty('test-integration');
			expect(status['test-integration']).toEqual({ status: 'active' });
		});
	});

	describe('getSystemHealth method', () => {
		test('should return comprehensive system health', () => {
			const {
				healthMonitor,
				errorBoundaryRegistry,
				circuitBreakerRegistry
			} = require('../../../../../scripts/modules/events/health-monitor.js');

			const health = integrationManager.getSystemHealth();

			expect(health).toHaveProperty('integrationManager');
			expect(health).toHaveProperty('errorBoundaries');
			expect(health).toHaveProperty('circuitBreakers');
			expect(health.integrationManager.stats).toBeDefined();
		});
	});

	describe('_processEvent method', () => {
		test('should process event through middleware pipeline', async () => {
			const middleware1 = jest.fn((type, payload) => ({
				...payload,
				processed: true
			}));
			const middleware2 = jest.fn((type, payload) => payload);
			const handler = jest.fn().mockResolvedValue();

			integrationManager.use(middleware1);
			integrationManager.use(middleware2);
			integrationManager.on('test:event', handler);

			await integrationManager._processEvent({
				type: 'test:event',
				payload: { data: 'test' }
			});

			expect(middleware1).toHaveBeenCalled();
			expect(middleware2).toHaveBeenCalled();
			expect(handler).toHaveBeenCalledWith('test:event', {
				data: 'test',
				processed: true
			});
		});

		test('should filter events when middleware returns null', async () => {
			const middleware = jest.fn(() => null);
			const handler = jest.fn();

			integrationManager.use(middleware);
			integrationManager.on('test:event', handler);

			await integrationManager._processEvent({
				type: 'test:event',
				payload: { data: 'test' }
			});

			expect(handler).not.toHaveBeenCalled();
		});

		test('should continue processing on middleware errors', async () => {
			const failingMiddleware = jest.fn(() => {
				throw new Error('Middleware failed');
			});
			const workingMiddleware = jest.fn((type, payload) => payload);
			const handler = jest.fn().mockResolvedValue();

			integrationManager.use(failingMiddleware);
			integrationManager.use(workingMiddleware);
			integrationManager.on('test:event', handler);

			await integrationManager._processEvent({
				type: 'test:event',
				payload: { data: 'test' }
			});

			expect(workingMiddleware).toHaveBeenCalled();
			expect(handler).toHaveBeenCalled();
		});
	});

	describe('_executeHandlers method', () => {
		test('should execute concurrent handlers in batches', async () => {
			const handler1 = jest.fn().mockResolvedValue();
			const handler2 = jest.fn().mockResolvedValue();
			const handler3 = jest.fn().mockResolvedValue();

			integrationManager.on('test:event', handler1);
			integrationManager.on('test:event', handler2);
			integrationManager.on('test:event', handler3);

			const handlers = integrationManager._findHandlers('test:event');
			await integrationManager._executeHandlers(
				'test:event',
				{ data: 'test' },
				handlers
			);

			expect(handler1).toHaveBeenCalled();
			expect(handler2).toHaveBeenCalled();
			expect(handler3).toHaveBeenCalled();
		});

		test('should execute sequential handlers one by one', async () => {
			const handler1 = jest.fn().mockResolvedValue();
			const handler2 = jest.fn().mockResolvedValue();

			integrationManager.on('test:event', handler1, { sequential: true });
			integrationManager.on('test:event', handler2, { sequential: true });

			const handlers = integrationManager._findHandlers('test:event');
			await integrationManager._executeHandlers(
				'test:event',
				{ data: 'test' },
				handlers
			);

			expect(handler1).toHaveBeenCalled();
			expect(handler2).toHaveBeenCalled();
		});

		test('should handle handler failures gracefully', async () => {
			const failingHandler = jest
				.fn()
				.mockRejectedValue(new Error('Handler failed'));
			const workingHandler = jest.fn().mockResolvedValue();

			integrationManager.on('test:event', failingHandler);
			integrationManager.on('test:event', workingHandler);

			const handlers = integrationManager._findHandlers('test:event');
			await integrationManager._executeHandlers(
				'test:event',
				{ data: 'test' },
				handlers
			);

			expect(integrationManager.stats.handlersFailed).toBe(1);
			expect(integrationManager.stats.handlersExecuted).toBe(1);
		});
	});

	describe('_findHandlers method', () => {
		test('should find direct event handlers', () => {
			const handler = jest.fn();
			integrationManager.on('test:event', handler);

			const handlers = integrationManager._findHandlers('test:event');

			expect(handlers).toHaveLength(1);
			expect(handlers[0].handler).toBe(handler);
		});

		test('should find wildcard handlers', () => {
			const handler = jest.fn();
			integrationManager.on('*', handler);

			const handlers = integrationManager._findHandlers('any:event');

			expect(handlers).toHaveLength(1);
		});

		test('should find pattern matching handlers', () => {
			const handler = jest.fn();
			integrationManager.on('task:*', handler);

			const handlers = integrationManager._findHandlers('task:created');

			expect(handlers).toHaveLength(1);
		});
	});

	describe('_shouldBatch method', () => {
		test('should return true for batchable events', () => {
			expect(integrationManager._shouldBatch('tasks:bulk-created')).toBe(true);
		});

		test('should return false for non-batchable events', () => {
			expect(integrationManager._shouldBatch('task:created')).toBe(false);
		});
	});

	describe('_addToBatch method', () => {
		test('should add event to batch queue', () => {
			const eventPayload = { type: 'test:event', payload: {} };

			integrationManager._addToBatch(eventPayload);

			expect(integrationManager.eventQueue).toContain(eventPayload);
		});

		test('should set batch timer', () => {
			const eventPayload = { type: 'test:event', payload: {} };

			integrationManager._addToBatch(eventPayload);

			expect(integrationManager.batchTimer).not.toBeNull();
		});

		test('should process batch when full', () => {
			const processBatchSpy = jest
				.spyOn(integrationManager, '_processBatch')
				.mockResolvedValue();
			integrationManager.config.batchSize = 2;

			integrationManager._addToBatch({ type: 'test1', payload: {} });
			integrationManager._addToBatch({ type: 'test2', payload: {} });

			expect(processBatchSpy).toHaveBeenCalled();
		});
	});

	describe('error boundary integration', () => {
		test('should setup error boundary for integration', async () => {
			const {
				errorBoundaryRegistry
			} = require('../../../../../scripts/modules/events/error-boundary.js');
			const mockBoundary = { on: jest.fn() };
			errorBoundaryRegistry.getBoundary.mockReturnValue(mockBoundary);

			await integrationManager._setupIntegrationErrorBoundary(mockIntegration);

			expect(errorBoundaryRegistry.getBoundary).toHaveBeenCalledWith(
				'test-integration',
				expect.any(Object)
			);
			expect(mockBoundary.on).toHaveBeenCalledWith(
				'error:caught',
				expect.any(Function)
			);
		});

		test('should get event error boundary', () => {
			const boundary =
				integrationManager._getEventErrorBoundary('task:created');

			expect(boundary).toBeDefined();
		});

		test('should create event fallback function', () => {
			const fallback = integrationManager._createEventFallback('test:event', {
				id: 'test'
			});

			expect(typeof fallback).toBe('function');
		});
	});
});
