/**
 * Core Interfaces for Dependency Injection
 *
 * Defines contracts that implementations must follow to ensure
 * proper testing and loose coupling.
 */

/**
 * Logger Interface
 * Contract for logging functionality
 */
export const ILogger = {
	log: Function,
	error: Function,
	warn: Function,
	info: Function,
	debug: Function
};

/**
 * Config Manager Interface
 * Contract for configuration management
 */
export const IConfigManager = {
	getLogLevel: Function,
	getGlobalConfig: Function,
	getConfig: Function,
	setConfig: Function,
	hasConfig: Function
};

/**
 * Health Monitor Interface
 * Contract for health monitoring functionality
 */
export const IHealthMonitor = {
	registerCheck: Function,
	start: Function,
	stop: Function,
	getSystemHealth: Function,
	isHealthy: Function,
	reset: Function
};

/**
 * Circuit Breaker Interface
 * Contract for circuit breaker functionality
 */
export const ICircuitBreaker = {
	getBreaker: Function,
	createBreaker: Function,
	getAllStatuses: Function,
	resetAll: Function,
	reset: Function
};

/**
 * Recovery Manager Interface
 * Contract for recovery management
 */
export const IRecoveryManager = {
	executeWithRecovery: Function,
	addRecoveryStrategy: Function,
	setDefaultStrategy: Function,
	getRecoveryHistory: Function,
	reset: Function
};

/**
 * Error Boundary Interface
 * Contract for error boundary functionality
 */
export const IErrorBoundary = {
	register: Function,
	handleError: Function,
	getErrorHistory: Function,
	reset: Function,
	clearErrors: Function
};

/**
 * Event Emitter Interface
 * Contract for event handling
 */
export const IEventEmitter = {
	emit: Function,
	on: Function,
	off: Function,
	once: Function,
	removeAllListeners: Function,
	listenerCount: Function
};

/**
 * Timer Interface
 * Contract for timer functionality
 */
export const ITimer = {
	setTimeout: Function,
	setInterval: Function,
	clearTimeout: Function,
	clearInterval: Function,
	now: Function
};

/**
 * File System Interface
 * Contract for file system operations
 */
export const IFileSystem = {
	readFile: Function,
	writeFile: Function,
	existsSync: Function,
	mkdir: Function,
	readdir: Function,
	stat: Function
};

/**
 * HTTP Client Interface
 * Contract for HTTP operations
 */
export const IHttpClient = {
	get: Function,
	post: Function,
	put: Function,
	delete: Function,
	request: Function
};

/**
 * Interface validation utility
 * Validates that an object implements the required interface
 */
export function validateInterface(obj, interfaceDefinition, name = 'object') {
	const missing = [];

	for (const [key, expectedType] of Object.entries(interfaceDefinition)) {
		if (!(key in obj)) {
			missing.push(key);
		} else if (typeof obj[key] !== expectedType.name.toLowerCase()) {
			missing.push(
				`${key} (expected ${expectedType.name.toLowerCase()}, got ${typeof obj[key]})`
			);
		}
	}

	if (missing.length > 0) {
		throw new Error(
			`${name} does not implement required interface. Missing: ${missing.join(', ')}`
		);
	}

	return true;
}

/**
 * Create a proxy that validates interface compliance
 */
export function createInterfaceProxy(
	obj,
	interfaceDefinition,
	name = 'object'
) {
	validateInterface(obj, interfaceDefinition, name);

	return new Proxy(obj, {
		get(target, prop) {
			const value = target[prop];

			// For function properties that are in the interface, wrap them with error handling
			if (prop in interfaceDefinition && typeof value === 'function') {
				const wrappedFunction = function (...args) {
					try {
						return value.apply(target, args);
					} catch (error) {
						throw new Error(
							`Interface method ${prop} failed in ${name}: ${error.message}`
						);
					}
				};

				// Preserve mock function properties if they exist
				if (value && (value._isMockFunction || value.mock)) {
					wrappedFunction._isMockFunction = value._isMockFunction;
					wrappedFunction.mock = value.mock;
					wrappedFunction.mockClear = value.mockClear;
					wrappedFunction.mockReset = value.mockReset;
					wrappedFunction.mockImplementation = value.mockImplementation;
					wrappedFunction.mockReturnValue = value.mockReturnValue;
					wrappedFunction.mockResolvedValue = value.mockResolvedValue;
					wrappedFunction.mockRejectedValue = value.mockRejectedValue;
					wrappedFunction.calls = value.calls; // For our fallback mocks
				}

				return wrappedFunction;
			}

			return value;
		}
	});
}
