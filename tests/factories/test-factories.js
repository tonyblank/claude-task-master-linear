/**
 * Test Factory Functions
 *
 * Provides standardized factory functions for creating test instances
 * with consistent configuration and mock dependencies.
 */

import { IntegrationManager } from '../../scripts/modules/events/integration-manager-di.js';
import { MockServiceRegistry } from '../mocks/service-registry.js';
import { DependencyContainer } from '../../scripts/modules/core/dependency-container.js';
import { BaseIntegrationHandler } from '../../scripts/modules/events/base-integration-handler.js';

/**
 * Test Factory Class
 * Centralizes creation of test instances with proper dependency injection
 */
export class TestFactories {
	/**
	 * Create a test integration manager with injected dependencies
	 * @param {Object} dependencyOverrides - Override specific dependencies
	 * @param {Object} configOverrides - Override configuration
	 * @returns {IntegrationManager} Test integration manager instance
	 */
	static createTestIntegrationManager(
		dependencyOverrides = {},
		configOverrides = {}
	) {
		const defaultDependencies =
			MockServiceRegistry.createCompleteDependencySet();
		const dependencies = { ...defaultDependencies, ...dependencyOverrides };

		const defaultConfig = {
			enableErrorBoundaries: true,
			enableCircuitBreakers: true,
			enableHealthMonitoring: true,
			enableAutoRecovery: true,
			enableBatching: false, // Disable for testing by default
			maxConcurrentHandlers: 5,
			handlerTimeout: 5000,
			eventTimeout: 10000,
			batchSize: 10,
			batchTimeout: 1000
		};

		const config = { ...defaultConfig, ...configOverrides };

		return new IntegrationManager(dependencies, config);
	}

	/**
	 * Create a minimal integration manager with only required dependencies
	 * @param {Object} requiredDeps - Only required dependencies
	 * @param {Object} configOverrides - Configuration overrides
	 * @returns {IntegrationManager} Minimal integration manager instance
	 */
	static createMinimalIntegrationManager(
		requiredDeps = {},
		configOverrides = {}
	) {
		const minimalDependencies = {
			logger: MockServiceRegistry.createLogger(),
			...requiredDeps
		};

		const config = {
			enableErrorBoundaries: false,
			enableCircuitBreakers: false,
			enableHealthMonitoring: false,
			enableAutoRecovery: false,
			...configOverrides
		};

		return new IntegrationManager(minimalDependencies, config);
	}

	/**
	 * Create an integration manager with pre-configured error scenarios
	 * @param {string} errorScenario - Type of error scenario to simulate
	 * @param {Object} overrides - Additional overrides
	 * @returns {IntegrationManager} Integration manager configured for error testing
	 */
	static createErrorTestIntegrationManager(
		errorScenario = 'general',
		overrides = {}
	) {
		const dependencies = MockServiceRegistry.createCompleteDependencySet();

		// Configure error scenarios
		switch (errorScenario) {
			case 'logger_failure':
				dependencies.logger.error.mockImplementation(() => {
					throw new Error('Logger failure');
				});
				break;

			case 'health_monitor_failure':
				dependencies.healthMonitor.registerCheck.mockImplementation(() => {
					throw new Error('Health monitor registration failed');
				});
				break;

			case 'circuit_breaker_failure':
				dependencies.circuitBreakerRegistry.getBreaker.mockImplementation(
					() => {
						throw new Error('Circuit breaker failure');
					}
				);
				break;

			case 'recovery_failure':
				dependencies.recoveryManager.executeWithRecovery.mockImplementation(
					async () => {
						throw new Error('Recovery failed');
					}
				);
				break;

			case 'error_boundary_failure':
				dependencies.errorBoundaryRegistry.getBoundary.mockImplementation(
					() => {
						throw new Error('Error boundary creation failed');
					}
				);
				break;
		}

		Object.assign(dependencies, overrides.dependencies || {});

		const config = {
			enableErrorBoundaries: true,
			enableCircuitBreakers: true,
			enableHealthMonitoring: true,
			enableAutoRecovery: true,
			...(overrides.config || {})
		};

		return new IntegrationManager(dependencies, config);
	}

	/**
	 * Create a test dependency container with registered test services
	 * @param {Object} overrides - Override specific factory registrations
	 * @returns {DependencyContainer} Configured test container
	 */
	static createTestDependencyContainer(overrides = {}) {
		const container = new DependencyContainer();

		// Register mock factories
		container.register('logger', () => MockServiceRegistry.createLogger(), {
			singleton: true
		});
		container.register(
			'configManager',
			() => MockServiceRegistry.createConfigManager(),
			{ singleton: true }
		);
		container.register(
			'healthMonitor',
			() => MockServiceRegistry.createHealthMonitor(),
			{ singleton: true }
		);
		container.register(
			'circuitBreakerRegistry',
			() => MockServiceRegistry.createCircuitBreaker(),
			{ singleton: true }
		);
		container.register(
			'recoveryManager',
			() => MockServiceRegistry.createRecoveryManager(),
			{ singleton: true }
		);
		container.register(
			'errorBoundaryRegistry',
			() => MockServiceRegistry.createErrorBoundary(),
			{ singleton: true }
		);
		container.register('eventEmitter', () =>
			MockServiceRegistry.createEventEmitter()
		);
		container.register('timer', () => MockServiceRegistry.createTimer(), {
			singleton: true
		});
		container.register(
			'fileSystem',
			() => MockServiceRegistry.createFileSystem(),
			{ singleton: true }
		);
		container.register('httpClient', () =>
			MockServiceRegistry.createHttpClient()
		);

		// Apply overrides
		for (const [name, factory] of Object.entries(overrides)) {
			container.register(name, factory, { singleton: true });
		}

		return container;
	}

	/**
	 * Create a scoped test environment
	 * @param {string} testSuiteName - Name of the test suite
	 * @param {Object} options - Configuration options
	 * @returns {Object} Test environment with cleanup utilities
	 */
	static createTestEnvironment(testSuiteName, options = {}) {
		const container = TestFactories.createTestDependencyContainer(
			options.containerOverrides
		);
		const scope = container.createScope(testSuiteName);

		const dependencies = {
			logger: container.get('logger', scope),
			configManager: container.get('configManager', scope),
			healthMonitor: container.get('healthMonitor', scope),
			circuitBreakerRegistry: container.get('circuitBreakerRegistry', scope),
			recoveryManager: container.get('recoveryManager', scope),
			errorBoundaryRegistry: container.get('errorBoundaryRegistry', scope),
			eventEmitter: container.get('eventEmitter', scope),
			timer: container.get('timer', scope),
			fileSystem: container.get('fileSystem', scope),
			httpClient: container.get('httpClient', scope)
		};

		const integrationManager = new IntegrationManager(
			dependencies,
			options.config || {}
		);

		return {
			container,
			scope,
			dependencies,
			integrationManager,

			// Cleanup utilities
			cleanup: () => {
				container.clearScope(scope);
				MockServiceRegistry.resetMocks(dependencies);
			},

			// Reset utilities
			reset: () => {
				MockServiceRegistry.clearMocks(dependencies);
			},

			// Helper to create additional instances
			createManager: (configOverrides = {}) => {
				return new IntegrationManager(dependencies, {
					...options.config,
					...configOverrides
				});
			}
		};
	}

	/**
	 * Create a test integration handler
	 * @param {string} name - Handler name
	 * @param {Object} options - Handler configuration
	 * @returns {Object} Mock integration handler that extends BaseIntegrationHandler
	 */
	static createTestIntegrationHandler(name = 'test-integration', options = {}) {
		class TestIntegrationHandler extends BaseIntegrationHandler {
			constructor(handlerName = name, config = {}) {
				super(handlerName, '1.0.0', { enabled: true, ...config });
			}

			async _performInitialization(config) {
				// Mock initialization
			}

			async _performShutdown() {
				// Mock shutdown
			}

			async _routeEvent(eventType, payload) {
				// Add event-specific handlers if specified
				if (options.eventHandlers && options.eventHandlers[eventType]) {
					return await options.eventHandlers[eventType](payload);
				}

				// Convert to handler method name
				const methodName = this._getHandlerMethodName(eventType);
				if (typeof this[methodName] === 'function') {
					return await this[methodName](payload);
				}

				// Default response
				return { handled: true, eventType, payload };
			}
		}

		const handler = new TestIntegrationHandler(name, options.config || {});

		// Add event-specific handlers as methods if specified
		if (options.eventHandlers) {
			for (const [eventType, handlerFn] of Object.entries(
				options.eventHandlers
			)) {
				const methodName =
					'handle' +
					eventType
						.split(':')
						.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
						.join('');
				handler[methodName] = MockServiceRegistry.createMockFn(handlerFn);
			}
		}

		// Add any additional methods from options
		if (options.methods) {
			Object.assign(handler, options.methods);
		}

		// Initialize the handler
		handler.initialize().catch(() => {}); // Ignore errors in test setup

		return handler;
	}

	/**
	 * Create test event payloads
	 * @param {string} eventType - Event type
	 * @param {Object} data - Event data
	 * @param {Object} context - Event context
	 * @returns {Object} Standardized event payload
	 */
	static createTestEventPayload(eventType, data = {}, context = {}) {
		return {
			id: `test-event-${Date.now()}-${Math.random()}`,
			type: eventType,
			timestamp: Date.now(),
			payload: data,
			context: {
				source: 'test',
				version: '1.0.0',
				...context
			}
		};
	}

	/**
	 * Create a batch of test events
	 * @param {Array} eventSpecs - Array of event specifications
	 * @returns {Array} Array of event payloads
	 */
	static createTestEventBatch(eventSpecs) {
		return eventSpecs.map((spec) =>
			TestFactories.createTestEventPayload(
				spec.type,
				spec.data || {},
				spec.context || {}
			)
		);
	}

	/**
	 * Create performance test configuration
	 * @param {Object} options - Performance test options
	 * @returns {Object} Performance test configuration
	 */
	static createPerformanceTestConfig(options = {}) {
		return {
			eventCount: options.eventCount || 1000,
			concurrentHandlers: options.concurrentHandlers || 10,
			batchSize: options.batchSize || 50,
			handlerLatency: options.handlerLatency || 10, // ms
			errorRate: options.errorRate || 0.05, // 5%
			...options
		};
	}

	/**
	 * Create stress test environment
	 * @param {Object} options - Stress test options
	 * @returns {Object} Stress test environment
	 */
	static createStressTestEnvironment(options = {}) {
		const perfConfig = TestFactories.createPerformanceTestConfig(options);

		const dependencies = MockServiceRegistry.createCompleteDependencySet();

		// Configure for high load
		const config = {
			enableErrorBoundaries: true,
			enableCircuitBreakers: true,
			enableHealthMonitoring: false, // Disable for performance
			enableAutoRecovery: true,
			enableBatching: true,
			maxConcurrentHandlers: perfConfig.concurrentHandlers,
			batchSize: perfConfig.batchSize,
			batchTimeout: 100,
			handlerTimeout: 30000,
			eventTimeout: 60000
		};

		const integrationManager = new IntegrationManager(dependencies, config);

		// Create handlers with simulated latency and errors
		const handlers = [];
		for (let i = 0; i < perfConfig.concurrentHandlers; i++) {
			const handler = TestFactories.createTestIntegrationHandler(
				`stress-handler-${i}`,
				{
					eventHandlers: {
						'task:created': MockServiceRegistry.createMockFn(
							async (payload) => {
								// Simulate processing latency
								await new Promise((resolve) =>
									setTimeout(resolve, perfConfig.handlerLatency)
								);

								// Simulate random errors
								if (Math.random() < perfConfig.errorRate) {
									throw new Error(`Simulated error in handler ${i}`);
								}

								return { handled: true, handler: i, payload };
							}
						)
					}
				}
			);
			handlers.push(handler);
		}

		return {
			integrationManager,
			handlers,
			dependencies,
			config: perfConfig,

			// Utility to register all handlers
			registerHandlers: () => {
				handlers.forEach((handler) => integrationManager.register(handler));
			},

			// Utility to generate events
			generateEvents: (count = perfConfig.eventCount) => {
				const events = [];
				for (let i = 0; i < count; i++) {
					events.push({
						taskId: `stress-task-${i}`,
						task: {
							id: `stress-task-${i}`,
							title: `Stress Test Task ${i}`,
							description: 'Stress test task description',
							details: 'Stress test task details',
							status: 'pending',
							priority: 'medium',
							dependencies: [],
							subtasks: []
						},
						tag: 'stress-test'
					});
				}
				return events;
			}
		};
	}
}

/**
 * Test Environment Setup Utilities
 */
export class TestEnvironment {
	/**
	 * Setup test environment with proper isolation
	 * @param {Object} options - Setup options
	 */
	static setup(options = {}) {
		// Setup global test utilities if needed
		if (typeof global !== 'undefined') {
			global.testFactories = TestFactories;
			global.mockServiceRegistry = MockServiceRegistry;
		}
	}

	/**
	 * Teardown test environment
	 */
	static teardown() {
		// Clean up globals if they exist
		if (typeof global !== 'undefined') {
			global.testFactories = undefined;
			global.mockServiceRegistry = undefined;
		}
	}

	/**
	 * Create isolated test suite
	 * @param {string} suiteName - Suite name
	 * @param {Function} testSuite - Test suite function
	 * @param {Object} options - Suite options
	 */
	static isolatedSuite(suiteName, testSuite, options = {}) {
		describe(suiteName, () => {
			let testEnv;

			beforeAll(() => {
				TestEnvironment.setup(options);
				if (options.timeout) {
					// Note: jest.setTimeout is deprecated in newer Jest versions
					// The timeout is now handled by the test runner configuration
				}
			});

			beforeEach(() => {
				testEnv = TestFactories.createTestEnvironment(suiteName, options);
				if (options.clearMocks !== false) {
					// Mock clearing is handled by MockServiceRegistry
				}
			});

			afterEach(() => {
				if (testEnv) {
					testEnv.cleanup();
				}
			});

			afterAll(() => {
				TestEnvironment.teardown();
				// Mock restoration is handled by MockServiceRegistry
			});

			// Run the test suite with the environment
			testSuite(() => testEnv);
		});
	}
}
