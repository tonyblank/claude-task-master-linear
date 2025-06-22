/**
 * @fileoverview Simple Tests for IntegrationManager with Dependency Injection
 *
 * Simplified test setup to verify the dependency injection architecture works.
 */

import { IntegrationManager } from '../../../scripts/modules/events/integration-manager-di.js';
import { MockServiceRegistry } from '../../mocks/service-registry.js';
import {
	expectCalled,
	expectCalledWith,
	clearCalls
} from '../../utils/test-helpers.js';

describe('IntegrationManager with Dependency Injection - Simple Tests', () => {
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
		expect(
			expectCalledWith(
				mockDependencies.logger.info,
				'IntegrationManager initialized successfully'
			)
		).toBe(true);
	});

	test('should log warning when initializing twice', async () => {
		await integrationManager.initialize();

		// Clear previous calls
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

		const registerCheckCalls = mockDependencies.healthMonitor.registerCheck.mock
			? mockDependencies.healthMonitor.registerCheck.mock.calls
			: mockDependencies.healthMonitor.registerCheck.calls || [];
		expect(registerCheckCalls.length).toBeGreaterThan(0);
		expect(registerCheckCalls[0][0]).toBe('integration_manager');
		expect(typeof registerCheckCalls[0][1]).toBe('function');
		expect(registerCheckCalls[0][2]).toMatchObject({
			type: 'integration',
			critical: true
		});
		expect(expectCalled(mockDependencies.healthMonitor.start)).toBe(true);

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

		const strategyRegisterCalls = mockDependencies.recoveryManager
			.registerStrategy.mock
			? mockDependencies.recoveryManager.registerStrategy.mock.calls
			: mockDependencies.recoveryManager.registerStrategy.calls || [];
		expect(strategyRegisterCalls.length).toBeGreaterThan(0);
		expect(strategyRegisterCalls[0][0]).toBe('integration_manager_reset');
		expect(typeof strategyRegisterCalls[0][1]).toBe('function');
		expect(expectCalled(mockDependencies.recoveryManager.start)).toBe(true);

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
});
