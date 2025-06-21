/**
 * @fileoverview Example Test - Demonstrates New Test Infrastructure Patterns
 *
 * This file shows how easy it is to write reliable tests using the new
 * dependency injection architecture.
 */

import { MockServiceRegistry } from '../mocks/service-registry.js';
import { TestFactories } from '../factories/test-factories.js';
import { IntegrationManager } from '../../scripts/modules/events/integration-manager-di.js';

describe('Example: New Test Infrastructure Patterns', () => {
	test('Example 1: Simple component testing with mocks', () => {
		// Create mocks with one line
		const logger = MockServiceRegistry.createLogger();
		const configManager = MockServiceRegistry.createConfigManager();

		// Inject dependencies cleanly
		const manager = new IntegrationManager(
			{ logger, configManager },
			{
				enableErrorBoundaries: false,
				enableCircuitBreakers: false,
				enableHealthMonitoring: false
			}
		);

		// Test behavior
		expect(manager.initialized).toBe(false);
		expect(manager.logger).toBe(logger);

		// Verify clean interfaces
		expect(typeof manager.logger.log).toBe('function');
		expect(typeof manager.logger.error).toBe('function');
	});

	test('Example 2: Using test factories for complex scenarios', () => {
		// Get a fully configured test environment in one line
		const manager = TestFactories.createTestIntegrationManager();

		expect(manager.initialized).toBe(false);
		expect(manager.config.enableErrorBoundaries).toBe(true);
		expect(manager.config.enableHealthMonitoring).toBe(true);
	});

	test('Example 3: Error scenario testing made simple', () => {
		// Create pre-configured error scenario
		const errorManager =
			TestFactories.createErrorTestIntegrationManager('logger_failure');

		// The logger is already configured to fail
		expect(errorManager.logger.error).toBeDefined();

		// Test that the logger throws the expected error
		expect(() => {
			errorManager.logger.error('test message');
		}).toThrow('Logger failure'); // Correctly expect the error to be thrown
	});

	test('Example 4: Performance testing setup', () => {
		// Create performance test environment
		const perfConfig = TestFactories.createPerformanceTestConfig({
			eventCount: 100,
			concurrentHandlers: 5,
			handlerLatency: 10
		});

		expect(perfConfig.eventCount).toBe(100);
		expect(perfConfig.concurrentHandlers).toBe(5);
		expect(perfConfig.handlerLatency).toBe(10);
		expect(perfConfig.errorRate).toBe(0.05); // Default 5%
	});

	test('Example 5: Creating test events', () => {
		// Generate test events easily
		const eventPayload = TestFactories.createTestEventPayload(
			'task:created',
			{ taskId: '123', title: 'Test Task' },
			{ source: 'example-test' }
		);

		expect(eventPayload.type).toBe('task:created');
		expect(eventPayload.payload.taskId).toBe('123');
		expect(eventPayload.context.source).toBe('example-test');
		expect(eventPayload.id).toBeDefined();
		expect(eventPayload.timestamp).toBeDefined();
	});

	test('Example 6: Batch event creation', () => {
		// Create multiple events at once
		const eventBatch = TestFactories.createTestEventBatch([
			{ type: 'task:created', data: { taskId: '1' } },
			{ type: 'task:updated', data: { taskId: '2' } },
			{ type: 'task:completed', data: { taskId: '3' } }
		]);

		expect(eventBatch).toHaveLength(3);
		expect(eventBatch[0].type).toBe('task:created');
		expect(eventBatch[1].type).toBe('task:updated');
		expect(eventBatch[2].type).toBe('task:completed');
	});

	test('Example 7: Complete dependency set validation', () => {
		// Verify all services implement required interfaces
		const deps = MockServiceRegistry.createCompleteDependencySet();

		// Logger interface
		expect(typeof deps.logger.log).toBe('function');
		expect(typeof deps.logger.error).toBe('function');
		expect(typeof deps.logger.warn).toBe('function');

		// Health monitor interface
		expect(typeof deps.healthMonitor.registerCheck).toBe('function');
		expect(typeof deps.healthMonitor.start).toBe('function');
		expect(typeof deps.healthMonitor.getSystemHealth).toBe('function');

		// Circuit breaker interface
		expect(typeof deps.circuitBreakerRegistry.getBreaker).toBe('function');
		expect(typeof deps.circuitBreakerRegistry.getAllStatuses).toBe('function');

		// And so on... all interfaces are guaranteed to be implemented
	});
});

describe('Example: Benefits Demonstration', () => {
	test('Demonstrates: No more complex module mocking', () => {
		// OLD WAY (commented out to show the difference):
		// jest.mock('../../../scripts/modules/events/health-monitor.js', () => ({
		//     healthMonitor: {
		//         registerCheck: jest.fn(),
		//         start: jest.fn(),
		//         getSystemHealth: jest.fn(() => ({ status: 'healthy' }))
		//     }
		// }));

		// NEW WAY: Clean, simple, reliable
		const healthMonitor = MockServiceRegistry.createHealthMonitor();
		const manager = new IntegrationManager({ healthMonitor });

		expect(manager.healthMonitor).toBe(healthMonitor);
	});

	test('Demonstrates: Easy error scenario testing', () => {
		// OLD WAY: Complex mock setup for each error scenario
		// NEW WAY: Pre-configured error scenarios

		const scenarios = [
			'logger_failure',
			'health_monitor_failure',
			'circuit_breaker_failure',
			'recovery_failure',
			'error_boundary_failure'
		];

		scenarios.forEach((scenario) => {
			const errorManager =
				TestFactories.createErrorTestIntegrationManager(scenario);
			expect(errorManager).toBeDefined();
			// Each scenario is pre-configured to test specific failure modes
		});
	});

	test('Demonstrates: Test isolation and cleanup', () => {
		// Each test gets a completely isolated environment
		const env1 = TestFactories.createTestEnvironment('test-1');
		const env2 = TestFactories.createTestEnvironment('test-2');

		// Environments are completely separate
		expect(env1.scope).not.toBe(env2.scope);
		expect(env1.dependencies.logger).not.toBe(env2.dependencies.logger);

		// Easy cleanup
		env1.cleanup();
		env2.cleanup();

		// No shared state pollution between tests
	});

	test('Demonstrates: Performance and stress testing capabilities', () => {
		// Built-in performance testing infrastructure
		const stressEnv = TestFactories.createStressTestEnvironment({
			eventCount: 50,
			concurrentHandlers: 3,
			handlerLatency: 5,
			errorRate: 0.1
		});

		expect(stressEnv.integrationManager).toBeDefined();
		expect(stressEnv.handlers).toHaveLength(3);
		expect(stressEnv.config.eventCount).toBe(50);

		// Can generate load test events
		const events = stressEnv.generateEvents(10);
		expect(events).toHaveLength(10);
		expect(events[0].context.stress).toBe(true);
	});
});

/*
 * Key Benefits Demonstrated:
 *
 * 1. ✅ No ES Module Mocking Issues
 *    - No more jest.mock() at module level
 *    - No import/export conflicts
 *    - Clean dependency injection
 *
 * 2. ✅ Reliable Test Isolation
 *    - Each test gets fresh dependencies
 *    - No shared state between tests
 *    - Predictable test behavior
 *
 * 3. ✅ Easy Test Creation
 *    - One-line mock creation
 *    - Pre-configured scenarios
 *    - Consistent patterns
 *
 * 4. ✅ Better Error Testing
 *    - Pre-built error scenarios
 *    - Easy failure mode testing
 *    - Reliable error simulation
 *
 * 5. ✅ Performance Testing Support
 *    - Built-in stress testing
 *    - Load generation utilities
 *    - Performance measurement tools
 *
 * 6. ✅ Clear Interface Contracts
 *    - All mocks implement expected interfaces
 *    - Runtime validation available
 *    - Better error messages
 */
