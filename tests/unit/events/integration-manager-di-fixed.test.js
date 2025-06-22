/**
 * @fileoverview Integration Manager Tests with Fixed Jest Compatibility
 *
 * Tests using the new dependency injection architecture with custom test helpers
 * that work consistently regardless of Jest availability.
 */

import { IntegrationManager } from '../../../scripts/modules/events/integration-manager-di.js';
import { MockServiceRegistry } from '../../mocks/service-registry.js';
import {
	expectMock,
	expectCalled,
	expectCalledWith,
	clearCalls,
	any,
	objectContaining
} from '../../utils/test-helpers.js';

describe('IntegrationManager with Dependency Injection - Fixed Tests', () => {
	let integrationManager;
	let mockDependencies;

	beforeEach(() => {
		// Create mock dependencies
		mockDependencies = MockServiceRegistry.createCompleteDependencySet();

		// Create integration manager with mocked dependencies
		integrationManager = new IntegrationManager(mockDependencies, {
			enableErrorBoundaries: false,
			enableCircuitBreakers: false,
			enableHealthMonitoring: false,
			enableAutoRecovery: false
		});
	});

	afterEach(async () => {
		if (integrationManager && integrationManager.initialized) {
			await integrationManager.shutdown();
		}
	});

	test('should create integration manager with injected dependencies', () => {
		expect(integrationManager).toBeDefined();
		expect(integrationManager.logger).toBe(mockDependencies.logger);
		expect(integrationManager.initialized).toBe(false);
	});

	test('should initialize successfully', async () => {
		await integrationManager.initialize();

		expect(integrationManager.initialized).toBe(true);

		// Use our custom helper to check mock calls
		expect(
			expectCalledWith(
				mockDependencies.logger.info,
				'IntegrationManager initialized successfully'
			)
		).toBe(true);
	});

	test('should log warning when initializing twice', async () => {
		await integrationManager.initialize();

		// Clear previous calls using our helper
		clearCalls(mockDependencies.logger.warn);

		await integrationManager.initialize();

		expect(
			expectCalledWith(
				mockDependencies.logger.warn,
				'IntegrationManager is already initialized'
			)
		).toBe(true);
	});

	test('should shutdown successfully', async () => {
		await integrationManager.initialize();
		await integrationManager.shutdown();

		expect(integrationManager.initialized).toBe(false);
		expect(
			expectCalledWith(
				mockDependencies.logger.info,
				'IntegrationManager shutdown completed'
			)
		).toBe(true);
	});

	test('should work with minimal dependencies', () => {
		const minimalDeps = {
			logger: MockServiceRegistry.createLogger()
		};

		const minimalManager = new IntegrationManager(minimalDeps, {
			enableErrorBoundaries: false,
			enableCircuitBreakers: false,
			enableHealthMonitoring: false,
			enableAutoRecovery: false
		});

		expect(minimalManager).toBeDefined();
		expect(minimalManager.logger).toBe(minimalDeps.logger);
	});

	test('should use default logger when none provided', () => {
		const managerWithoutLogger = new IntegrationManager(
			{},
			{
				enableErrorBoundaries: false,
				enableCircuitBreakers: false,
				enableHealthMonitoring: false,
				enableAutoRecovery: false
			}
		);

		expect(managerWithoutLogger.logger).toBeDefined();
		expect(typeof managerWithoutLogger.logger.log).toBe('function');
		expect(typeof managerWithoutLogger.logger.error).toBe('function');
	});

	test('should get stats correctly', () => {
		const stats = integrationManager.getStats();

		expect(stats).toMatchObject({
			eventsEmitted: 0,
			eventsProcessed: 0,
			eventsFailed: 0,
			handlersExecuted: 0,
			handlersFailed: 0,
			isolatedEvents: 0,
			recoveredEvents: 0,
			registeredIntegrations: 0,
			registeredHandlers: 0,
			middlewareCount: 0,
			queuedEvents: 0,
			initialized: false,
			isShuttingDown: false
		});
	});

	test('should handle integration status requests', () => {
		const status = integrationManager.getIntegrationStatus();

		expect(status).toEqual({});
	});

	test('should get system health', () => {
		const health = integrationManager.getSystemHealth();

		expect(health).toHaveProperty('integrationManager');
		expect(health.integrationManager).toHaveProperty('stats');
		expect(health.integrationManager).toHaveProperty('initialized', false);
		expect(health.integrationManager).toHaveProperty('shuttingDown', false);
	});

	test('should initialize with health monitoring enabled', async () => {
		const managerWithHealth = new IntegrationManager(mockDependencies, {
			enableHealthMonitoring: true,
			enableErrorBoundaries: false,
			enableCircuitBreakers: false,
			enableAutoRecovery: false
		});

		await managerWithHealth.initialize();

		// Check that health monitor methods were called
		expect(expectCalled(mockDependencies.healthMonitor.registerCheck)).toBe(
			true
		);
		expect(expectCalled(mockDependencies.healthMonitor.start)).toBe(true);

		// Check that registerCheck was called with correct arguments
		const registerCheckCalls = mockDependencies.healthMonitor.registerCheck.mock
			? mockDependencies.healthMonitor.registerCheck.mock.calls
			: mockDependencies.healthMonitor.registerCheck.calls;

		expect(registerCheckCalls.length).toBeGreaterThan(0);
		const firstCall = registerCheckCalls[0];
		expect(firstCall[0]).toBe('integration_manager');
		expect(typeof firstCall[1]).toBe('function');
		expect(firstCall[2]).toMatchObject({
			type: 'integration',
			critical: true
		});

		await managerWithHealth.shutdown();
	});

	test('should initialize with recovery manager enabled', async () => {
		const managerWithRecovery = new IntegrationManager(mockDependencies, {
			enableAutoRecovery: true,
			enableErrorBoundaries: false,
			enableCircuitBreakers: false,
			enableHealthMonitoring: false
		});

		await managerWithRecovery.initialize();

		// Check that recovery manager methods were called
		expect(
			expectCalled(mockDependencies.recoveryManager.registerStrategy)
		).toBe(true);
		expect(expectCalled(mockDependencies.recoveryManager.start)).toBe(true);

		// Check that registerStrategy was called with correct arguments
		const registerStrategyCalls = mockDependencies.recoveryManager
			.registerStrategy.mock
			? mockDependencies.recoveryManager.registerStrategy.mock.calls
			: mockDependencies.recoveryManager.registerStrategy.calls;

		expect(registerStrategyCalls.length).toBeGreaterThan(0);
		const firstCall = registerStrategyCalls[0];
		expect(firstCall[0]).toBe('integration_manager_reset');
		expect(typeof firstCall[1]).toBe('function'); // Second argument should be a function

		await managerWithRecovery.shutdown();
	});

	test('should handle missing optional dependencies gracefully', async () => {
		const partialDeps = {
			logger: MockServiceRegistry.createLogger()
			// Missing health monitor, recovery manager, etc.
		};

		const partialManager = new IntegrationManager(partialDeps, {
			enableHealthMonitoring: true,
			enableAutoRecovery: true
		});

		// Should initialize without throwing
		await expect(partialManager.initialize()).resolves.not.toThrow();
		expect(partialManager.initialized).toBe(true);

		await partialManager.shutdown();
	});

	test('should validate mock interfaces', () => {
		// Verify that our mocks implement the expected interfaces
		expect(typeof mockDependencies.logger.log).toBe('function');
		expect(typeof mockDependencies.logger.error).toBe('function');
		expect(typeof mockDependencies.logger.warn).toBe('function');
		expect(typeof mockDependencies.logger.info).toBe('function');
		expect(typeof mockDependencies.logger.debug).toBe('function');

		expect(typeof mockDependencies.healthMonitor.registerCheck).toBe(
			'function'
		);
		expect(typeof mockDependencies.healthMonitor.start).toBe('function');
		expect(typeof mockDependencies.healthMonitor.getSystemHealth).toBe(
			'function'
		);

		expect(typeof mockDependencies.recoveryManager.executeWithRecovery).toBe(
			'function'
		);
		expect(typeof mockDependencies.recoveryManager.registerStrategy).toBe(
			'function'
		);

		expect(typeof mockDependencies.errorBoundaryRegistry.getBoundary).toBe(
			'function'
		);
		expect(typeof mockDependencies.errorBoundaryRegistry.register).toBe(
			'function'
		);

		expect(typeof mockDependencies.circuitBreakerRegistry.getBreaker).toBe(
			'function'
		);
		expect(typeof mockDependencies.circuitBreakerRegistry.getAllStatuses).toBe(
			'function'
		);
	});

	test('should handle events with mock dependencies', async () => {
		// Enable dependencies for event handling
		const fullManager = new IntegrationManager(mockDependencies, {
			enableErrorBoundaries: true,
			enableCircuitBreakers: true,
			enableHealthMonitoring: false,
			enableAutoRecovery: false
		});

		await fullManager.initialize();

		// The event system should work even if no handlers are registered
		await expect(
			fullManager.emit('test:event', { data: 'test' }, { source: 'test' })
		).resolves.not.toThrow();

		// Check that error boundary was called
		expect(
			expectCalled(mockDependencies.errorBoundaryRegistry.getBoundary)
		).toBe(true);

		await fullManager.shutdown();
	});

	test('should track statistics correctly', async () => {
		await integrationManager.initialize();

		const initialStats = integrationManager.getStats();
		expect(initialStats.eventsEmitted).toBe(0);
		expect(initialStats.eventsProcessed).toBe(0);

		// Emit a test event (will be processed but no handlers registered)
		await integrationManager.emit(
			'test:event',
			{ data: 'test' },
			{ source: 'test' }
		);

		const finalStats = integrationManager.getStats();
		expect(finalStats.eventsEmitted).toBe(1);
		// eventsProcessed might be 0 or 1 depending on whether handlers were found
		expect(finalStats.eventsEmitted).toBeGreaterThan(
			initialStats.eventsEmitted
		);
	});
});
