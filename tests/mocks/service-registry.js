/**
 * Mock Service Registry
 *
 * Centralized registry for creating consistent mocks that implement
 * the required interfaces for testing.
 */

import {
	createInterfaceProxy,
	validateInterface,
	ILogger,
	IConfigManager,
	IHealthMonitor,
	ICircuitBreaker,
	IRecoveryManager,
	IErrorBoundary,
	IEventEmitter,
	ITimer,
	IFileSystem,
	IHttpClient
} from '../../scripts/modules/core/interfaces.js';

// Helper to create jest mock functions with fallback
const createMockFn = (implementation = null) => {
	if (typeof jest !== 'undefined' && jest.fn) {
		return jest.fn(implementation);
	}

	// Full Jest-compatible fallback implementation
	const mockFn = function (...args) {
		const call = args;
		mockFn.mock.calls.push(call);
		mockFn.mock.instances.push(this);
		mockFn.mock.invocationCallOrder.push(mockFn.mock.calls.length);

		let result;
		let resultType = 'return';

		try {
			if (mockFn.implementation) {
				result = mockFn.implementation.apply(this, args);
			} else {
				result = mockFn.defaultReturnValue;
			}

			// Handle promises
			if (result && typeof result.then === 'function') {
				result = result.then(
					(value) => {
						mockFn.mock.results.push({ type: 'return', value });
						return value;
					},
					(error) => {
						mockFn.mock.results.push({ type: 'throw', value: error });
						throw error;
					}
				);
			} else {
				mockFn.mock.results.push({ type: resultType, value: result });
			}
		} catch (error) {
			resultType = 'throw';
			result = error;
			mockFn.mock.results.push({ type: resultType, value: error });
			throw error;
		}

		return result;
	};

	// Initialize mock object with full Jest mock structure
	mockFn.mock = {
		calls: [],
		instances: [],
		invocationCallOrder: [],
		results: []
	};

	mockFn.defaultReturnValue = undefined;
	mockFn.implementation = implementation;

	// Jest mock function methods
	mockFn.mockImplementation = (fn) => {
		mockFn.implementation = fn;
		return mockFn;
	};

	mockFn.mockImplementationOnce = (fn) => {
		if (!mockFn.onceImplementations) {
			mockFn.onceImplementations = [];
		}
		mockFn.onceImplementations.push(fn);
		return mockFn;
	};

	mockFn.mockReturnValue = (value) => {
		mockFn.defaultReturnValue = value;
		return mockFn;
	};

	mockFn.mockReturnValueOnce = (value) => {
		if (!mockFn.onceReturnValues) {
			mockFn.onceReturnValues = [];
		}
		mockFn.onceReturnValues.push(value);
		return mockFn;
	};

	mockFn.mockResolvedValue = (value) => {
		return mockFn.mockReturnValue(Promise.resolve(value));
	};

	mockFn.mockResolvedValueOnce = (value) => {
		return mockFn.mockReturnValueOnce(Promise.resolve(value));
	};

	mockFn.mockRejectedValue = (error) => {
		return mockFn.mockReturnValue(Promise.reject(error));
	};

	mockFn.mockRejectedValueOnce = (error) => {
		return mockFn.mockReturnValueOnce(Promise.reject(error));
	};

	mockFn.mockClear = () => {
		mockFn.mock.calls = [];
		mockFn.mock.instances = [];
		mockFn.mock.invocationCallOrder = [];
		mockFn.mock.results = [];
		return mockFn;
	};

	mockFn.mockReset = () => {
		mockFn.mockClear();
		mockFn.implementation = null;
		mockFn.defaultReturnValue = undefined;
		mockFn.onceImplementations = [];
		mockFn.onceReturnValues = [];
		return mockFn;
	};

	mockFn.mockRestore = () => {
		// For compatibility, though not applicable to our use case
		return mockFn;
	};

	// Jest expectation helpers
	mockFn.toHaveBeenCalled = () => mockFn.mock.calls.length > 0;
	mockFn.toHaveBeenCalledTimes = (times) => mockFn.mock.calls.length === times;
	mockFn.toHaveBeenCalledWith = (...args) => {
		return mockFn.mock.calls.some(
			(call) =>
				call.length === args.length &&
				call.every((arg, index) => {
					if (
						args[index] &&
						typeof args[index].asymmetricMatch === 'function'
					) {
						return args[index].asymmetricMatch(arg);
					}
					return Object.is(arg, args[index]);
				})
		);
	};
	mockFn.toHaveBeenLastCalledWith = (...args) => {
		const lastCall = mockFn.mock.calls[mockFn.mock.calls.length - 1];
		if (!lastCall) return false;
		return (
			lastCall.length === args.length &&
			lastCall.every((arg, index) => {
				if (args[index] && typeof args[index].asymmetricMatch === 'function') {
					return args[index].asymmetricMatch(arg);
				}
				return Object.is(arg, args[index]);
			})
		);
	};

	// Mark as Jest mock function for compatibility
	mockFn._isMockFunction = true;

	return mockFn;
};

/**
 * Mock Service Registry Class
 * Provides factory methods for creating consistent mocks
 */
export class MockServiceRegistry {
	constructor() {
		this.instances = new Map();
		this.defaultBehaviors = new Map();
	}

	/**
	 * Create a Jest-compatible mock function
	 * @param {Function} implementation - Optional implementation
	 * @returns {Function} Mock function
	 */
	static createMockFn(implementation) {
		return createMockFn(implementation);
	}

	/**
	 * Create a mock logger
	 * @param {Object} overrides - Override specific methods
	 * @returns {Object} Mock logger implementation
	 */
	static createLogger(overrides = {}) {
		const mockLogger = {
			log: createMockFn(),
			error: createMockFn(),
			warn: createMockFn(),
			info: createMockFn(),
			debug: createMockFn(),
			...overrides
		};

		return createInterfaceProxy(mockLogger, ILogger, 'MockLogger');
	}

	/**
	 * Create a mock config manager
	 * @param {Object} overrides - Override specific methods
	 * @param {Object} defaultConfig - Default configuration values
	 * @returns {Object} Mock config manager implementation
	 */
	static createConfigManager(overrides = {}, defaultConfig = {}) {
		const configs = new Map(Object.entries(defaultConfig));

		const mockConfigManager = {
			getLogLevel: createMockFn(() => 'info'),
			getGlobalConfig: createMockFn(() => ({})),
			getConfig: createMockFn((key) => configs.get(key)),
			setConfig: createMockFn((key, value) => configs.set(key, value)),
			hasConfig: createMockFn((key) => configs.has(key)),
			...overrides
		};

		return createInterfaceProxy(
			mockConfigManager,
			IConfigManager,
			'MockConfigManager'
		);
	}

	/**
	 * Create a mock health monitor
	 * @param {Object} overrides - Override specific methods
	 * @returns {Object} Mock health monitor implementation
	 */
	static createHealthMonitor(overrides = {}) {
		const checks = new Map();
		let isStarted = false;
		let systemHealth = { status: 'healthy', checks: {} };

		const mockHealthMonitor = {
			registerCheck: createMockFn((name, checkFn, options) => {
				checks.set(name, { checkFn, options });
			}),
			start: createMockFn(() => {
				isStarted = true;
			}),
			stop: createMockFn(() => {
				isStarted = false;
			}),
			getSystemHealth: createMockFn(() => systemHealth),
			isHealthy: createMockFn(() => systemHealth.status === 'healthy'),
			reset: createMockFn(() => {
				checks.clear();
				isStarted = false;
				systemHealth = { status: 'healthy', checks: {} };
			}),
			// Test utilities
			_setSystemHealth: (health) => {
				systemHealth = health;
			},
			_getChecks: () => checks,
			_isStarted: () => isStarted,
			...overrides
		};

		return createInterfaceProxy(
			mockHealthMonitor,
			IHealthMonitor,
			'MockHealthMonitor'
		);
	}

	/**
	 * Create a mock circuit breaker registry
	 * @param {Object} overrides - Override specific methods
	 * @returns {Object} Mock circuit breaker implementation
	 */
	static createCircuitBreaker(overrides = {}) {
		const breakers = new Map();

		const createBreaker = (name) => ({
			getStatus: createMockFn(() => ({
				state: 'closed',
				failures: 0,
				successes: 0
			})),
			reset: createMockFn(),
			execute: createMockFn(async (fn) => await fn()),
			recordSuccess: createMockFn(),
			recordFailure: createMockFn()
		});

		const mockCircuitBreaker = {
			getBreaker: createMockFn((name) => {
				if (!breakers.has(name)) {
					breakers.set(name, createBreaker(name));
				}
				return breakers.get(name);
			}),
			createBreaker: createMockFn((name, options) => {
				const breaker = createBreaker(name);
				breakers.set(name, breaker);
				return breaker;
			}),
			getAllStatuses: createMockFn(() => {
				const statuses = {};
				for (const [name, breaker] of breakers.entries()) {
					statuses[name] = breaker.getStatus();
				}
				return statuses;
			}),
			resetAll: createMockFn(() => {
				for (const breaker of breakers.values()) {
					breaker.reset();
				}
			}),
			reset: createMockFn((name) => {
				if (breakers.has(name)) {
					breakers.get(name).reset();
				}
			}),
			// Test utilities
			_getBreakers: () => breakers,
			_clearAll: () => breakers.clear(),
			...overrides
		};

		return createInterfaceProxy(
			mockCircuitBreaker,
			ICircuitBreaker,
			'MockCircuitBreaker'
		);
	}

	/**
	 * Create a mock recovery manager
	 * @param {Object} overrides - Override specific methods
	 * @returns {Object} Mock recovery manager implementation
	 */
	static createRecoveryManager(overrides = {}) {
		const strategies = new Map();
		const history = [];
		let isStarted = false;

		const mockRecoveryManager = {
			executeWithRecovery: createMockFn(async (fn, retries = 3) => {
				try {
					return await fn();
				} catch (error) {
					if (retries > 0) {
						return await mockRecoveryManager.executeWithRecovery(
							fn,
							retries - 1
						);
					}
					throw error;
				}
			}),
			addRecoveryStrategy: createMockFn((name, strategy) => {
				strategies.set(name, strategy);
			}),
			setDefaultStrategy: createMockFn((strategy) => {
				strategies.set('default', strategy);
			}),
			getRecoveryHistory: createMockFn(() => [...history]),
			reset: createMockFn(() => {
				strategies.clear();
				history.length = 0;
				isStarted = false;
			}),
			start: createMockFn(() => {
				isStarted = true;
			}),
			registerStrategy: createMockFn((name, strategy) => {
				strategies.set(name, strategy);
			}),
			// Test utilities
			_getStrategies: () => strategies,
			_addToHistory: (entry) => history.push(entry),
			_isStarted: () => isStarted,
			...overrides
		};

		return createInterfaceProxy(
			mockRecoveryManager,
			IRecoveryManager,
			'MockRecoveryManager'
		);
	}

	/**
	 * Create a mock error boundary registry
	 * @param {Object} overrides - Override specific methods
	 * @returns {Object} Mock error boundary implementation
	 */
	static createErrorBoundary(overrides = {}) {
		const boundaries = new Map();
		const errors = [];

		const createBoundary = (name, config) => ({
			execute: createMockFn(async (fn, args, options) => {
				try {
					return await fn(...args);
				} catch (error) {
					errors.push({ name, error, timestamp: Date.now() });
					if (options && options.fallback) {
						return await options.fallback();
					}
					throw error;
				}
			}),
			handleError: createMockFn((error, context) => {
				errors.push({ name, error, context, timestamp: Date.now() });
			}),
			reset: createMockFn(() => {
				// Reset boundary state
			}),
			on: createMockFn(),
			off: createMockFn(),
			getStatus: createMockFn(() => ({
				name,
				errors: errors.filter((e) => e.name === name).length,
				isolated: false
			}))
		});

		const mockErrorBoundary = {
			register: createMockFn((name, config) => {
				const boundary = createBoundary(name, config);
				boundaries.set(name, boundary);
				return boundary;
			}),
			getBoundary: createMockFn((name, config) => {
				if (!boundaries.has(name)) {
					boundaries.set(name, createBoundary(name, config));
				}
				return boundaries.get(name);
			}),
			handleError: createMockFn((error, context) => {
				errors.push({ error, context, timestamp: Date.now() });
			}),
			getErrorHistory: createMockFn(() => [...errors]),
			reset: createMockFn(() => {
				boundaries.clear();
				errors.length = 0;
			}),
			clearErrors: createMockFn(() => {
				errors.length = 0;
			}),
			getAllStatuses: createMockFn(() => {
				const statuses = {};
				for (const [name, boundary] of boundaries.entries()) {
					statuses[name] = boundary.getStatus();
				}
				return statuses;
			}),
			// Test utilities
			_getBoundaries: () => boundaries,
			_getErrors: () => errors,
			...overrides
		};

		return createInterfaceProxy(
			mockErrorBoundary,
			IErrorBoundary,
			'MockErrorBoundary'
		);
	}

	/**
	 * Create a mock event emitter
	 * @param {Object} overrides - Override specific methods
	 * @returns {Object} Mock event emitter implementation
	 */
	static createEventEmitter(overrides = {}) {
		const listeners = new Map();

		const mockEventEmitter = {
			emit: createMockFn((event, ...args) => {
				if (listeners.has(event)) {
					for (const listener of listeners.get(event)) {
						listener(...args);
					}
				}
				return true;
			}),
			on: createMockFn((event, listener) => {
				if (!listeners.has(event)) {
					listeners.set(event, []);
				}
				listeners.get(event).push(listener);
			}),
			off: createMockFn((event, listener) => {
				if (listeners.has(event)) {
					const eventListeners = listeners.get(event);
					const index = eventListeners.indexOf(listener);
					if (index > -1) {
						eventListeners.splice(index, 1);
					}
				}
			}),
			once: createMockFn((event, listener) => {
				const onceListener = (...args) => {
					listener(...args);
					mockEventEmitter.off(event, onceListener);
				};
				mockEventEmitter.on(event, onceListener);
			}),
			removeAllListeners: createMockFn((event) => {
				if (event) {
					listeners.delete(event);
				} else {
					listeners.clear();
				}
			}),
			listenerCount: createMockFn((event) => {
				return listeners.has(event) ? listeners.get(event).length : 0;
			}),
			// Test utilities
			_getListeners: () => listeners,
			...overrides
		};

		return createInterfaceProxy(
			mockEventEmitter,
			IEventEmitter,
			'MockEventEmitter'
		);
	}

	/**
	 * Create a mock timer
	 * @param {Object} overrides - Override specific methods
	 * @returns {Object} Mock timer implementation
	 */
	static createTimer(overrides = {}) {
		const timers = new Map();
		let currentTime = Date.now();

		const mockTimer = {
			setTimeout: createMockFn((fn, delay) => {
				const id = Math.random();
				timers.set(id, { fn, delay, type: 'timeout' });
				return id;
			}),
			setInterval: createMockFn((fn, interval) => {
				const id = Math.random();
				timers.set(id, { fn, interval, type: 'interval' });
				return id;
			}),
			clearTimeout: createMockFn((id) => {
				timers.delete(id);
			}),
			clearInterval: createMockFn((id) => {
				timers.delete(id);
			}),
			now: createMockFn(() => currentTime),
			// Test utilities
			_getTimers: () => timers,
			_setCurrentTime: (time) => {
				currentTime = time;
			},
			_advanceTime: (ms) => {
				currentTime += ms;
			},
			_triggerTimer: (id) => {
				if (timers.has(id)) {
					const timer = timers.get(id);
					timer.fn();
					if (timer.type === 'timeout') {
						timers.delete(id);
					}
				}
			},
			_triggerAllTimers: () => {
				for (const [id, timer] of timers.entries()) {
					timer.fn();
					if (timer.type === 'timeout') {
						timers.delete(id);
					}
				}
			},
			...overrides
		};

		return createInterfaceProxy(mockTimer, ITimer, 'MockTimer');
	}

	/**
	 * Create a mock file system
	 * @param {Object} overrides - Override specific methods
	 * @param {Object} files - Initial file structure
	 * @returns {Object} Mock file system implementation
	 */
	static createFileSystem(overrides = {}, files = {}) {
		const fileSystem = new Map(Object.entries(files));

		const mockFileSystem = {
			readFile: createMockFn(async (filePath, encoding = 'utf8') => {
				if (fileSystem.has(filePath)) {
					return fileSystem.get(filePath);
				}
				throw new Error(
					`ENOENT: no such file or directory, open '${filePath}'`
				);
			}),
			writeFile: createMockFn(async (filePath, data, encoding = 'utf8') => {
				fileSystem.set(filePath, data);
			}),
			existsSync: createMockFn((filePath) => {
				return fileSystem.has(filePath);
			}),
			mkdir: createMockFn(async (dirPath, options = { recursive: true }) => {
				// Simulate directory creation
				fileSystem.set(dirPath, null);
			}),
			readdir: createMockFn(async (dirPath) => {
				const files = [];
				for (const path of fileSystem.keys()) {
					if (path.startsWith(dirPath + '/')) {
						const relativePath = path.substring(dirPath.length + 1);
						if (!relativePath.includes('/')) {
							files.push(relativePath);
						}
					}
				}
				return files;
			}),
			stat: createMockFn(async (filePath) => {
				if (!fileSystem.has(filePath)) {
					throw new Error(
						`ENOENT: no such file or directory, stat '${filePath}'`
					);
				}
				return {
					isFile: () => fileSystem.get(filePath) !== null,
					isDirectory: () => fileSystem.get(filePath) === null,
					size: fileSystem.get(filePath)?.length || 0,
					mtime: new Date()
				};
			}),
			// Test utilities
			_getFiles: () => fileSystem,
			_setFile: (path, content) => fileSystem.set(path, content),
			_clear: () => fileSystem.clear(),
			...overrides
		};

		return createInterfaceProxy(mockFileSystem, IFileSystem, 'MockFileSystem');
	}

	/**
	 * Create a mock HTTP client
	 * @param {Object} overrides - Override specific methods
	 * @param {Object} responses - Predefined responses
	 * @returns {Object} Mock HTTP client implementation
	 */
	static createHttpClient(overrides = {}, responses = {}) {
		const createResponse = (data, status = 200) => ({
			ok: status >= 200 && status < 300,
			status,
			statusText: status === 200 ? 'OK' : 'Error',
			json: createMockFn(async () => data),
			text: createMockFn(async () => JSON.stringify(data)),
			headers: new Map()
		});

		const mockHttpClient = {
			get: createMockFn(async (url, options = {}) => {
				if (responses[url]) {
					return createResponse(responses[url]);
				}
				return createResponse({ message: 'Not found' }, 404);
			}),
			post: createMockFn(async (url, data, options = {}) => {
				if (responses[url]) {
					return createResponse(responses[url]);
				}
				return createResponse({ message: 'Created', data }, 201);
			}),
			put: createMockFn(async (url, data, options = {}) => {
				if (responses[url]) {
					return createResponse(responses[url]);
				}
				return createResponse({ message: 'Updated', data });
			}),
			delete: createMockFn(async (url, options = {}) => {
				if (responses[url]) {
					return createResponse(responses[url]);
				}
				return createResponse({ message: 'Deleted' });
			}),
			request: createMockFn(async (url, options = {}) => {
				const method = options.method || 'GET';
				switch (method.toUpperCase()) {
					case 'GET':
						return mockHttpClient.get(url, options);
					case 'POST':
						return mockHttpClient.post(url, options.body, options);
					case 'PUT':
						return mockHttpClient.put(url, options.body, options);
					case 'DELETE':
						return mockHttpClient.delete(url, options);
					default:
						return createResponse({ message: 'Method not allowed' }, 405);
				}
			}),
			// Test utilities
			_setResponse: (url, response) => {
				responses[url] = response;
			},
			_getResponses: () => responses,
			_clearResponses: () =>
				Object.keys(responses).forEach((key) => delete responses[key]),
			...overrides
		};

		return createInterfaceProxy(mockHttpClient, IHttpClient, 'MockHttpClient');
	}

	/**
	 * Create a complete dependency set with all mocks
	 * @param {Object} overrides - Override specific services
	 * @returns {Object} Complete dependency set
	 */
	static createCompleteDependencySet(overrides = {}) {
		return {
			logger: MockServiceRegistry.createLogger(overrides.logger),
			configManager: MockServiceRegistry.createConfigManager(
				overrides.configManager
			),
			healthMonitor: MockServiceRegistry.createHealthMonitor(
				overrides.healthMonitor
			),
			circuitBreakerRegistry: MockServiceRegistry.createCircuitBreaker(
				overrides.circuitBreakerRegistry
			),
			recoveryManager: MockServiceRegistry.createRecoveryManager(
				overrides.recoveryManager
			),
			errorBoundaryRegistry: MockServiceRegistry.createErrorBoundary(
				overrides.errorBoundaryRegistry
			),
			eventEmitter: MockServiceRegistry.createEventEmitter(
				overrides.eventEmitter
			),
			timer: MockServiceRegistry.createTimer(overrides.timer),
			fileSystem: MockServiceRegistry.createFileSystem(overrides.fileSystem),
			httpClient: MockServiceRegistry.createHttpClient(overrides.httpClient),
			...overrides
		};
	}

	/**
	 * Helper to check if a function is a mock
	 * @param {*} fn - Function to check
	 * @returns {boolean} True if function is a mock
	 */
	static isMockFunction(fn) {
		if (typeof jest !== 'undefined' && jest.isMockFunction) {
			return jest.isMockFunction(fn);
		}
		// Fallback check for our custom mock functions
		return (
			fn &&
			(fn._isMockFunction === true ||
				(fn.mock && typeof fn.mockClear === 'function'))
		);
	}

	/**
	 * Reset all mock functions in a dependency set
	 * @param {Object} dependencies - Dependency set to reset
	 */
	static resetMocks(dependencies) {
		for (const [name, service] of Object.entries(dependencies)) {
			if (service && typeof service === 'object') {
				// Reset jest mocks
				for (const method of Object.values(service)) {
					if (MockServiceRegistry.isMockFunction(method)) {
						method.mockReset();
					}
				}

				// Call reset method if available
				if (typeof service.reset === 'function') {
					service.reset();
				}
			}
		}
	}

	/**
	 * Clear all mock call history in a dependency set
	 * @param {Object} dependencies - Dependency set to clear
	 */
	static clearMocks(dependencies) {
		for (const [name, service] of Object.entries(dependencies)) {
			if (service && typeof service === 'object') {
				for (const method of Object.values(service)) {
					if (MockServiceRegistry.isMockFunction(method)) {
						method.mockClear();
					}
				}
			}
		}
	}
}
