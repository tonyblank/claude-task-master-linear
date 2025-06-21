/**
 * Dependency Injection Container
 *
 * Manages dependencies and their lifecycles to enable clean testing
 * and loose coupling between modules.
 */

export class DependencyContainer {
	constructor() {
		this.dependencies = new Map();
		this.singletons = new Map();
		this.scopes = new Map();
	}

	/**
	 * Register a dependency factory function
	 * @param {string} name - Dependency name
	 * @param {Function} factory - Factory function that creates the dependency
	 * @param {Object} options - Configuration options
	 * @param {boolean} options.singleton - Whether to create a singleton instance
	 * @param {string[]} options.dependencies - Dependencies this factory requires
	 */
	register(name, factory, options = {}) {
		this.dependencies.set(name, {
			factory,
			singleton: options.singleton || false,
			dependencies: options.dependencies || []
		});
	}

	/**
	 * Get a dependency instance
	 * @param {string} name - Dependency name
	 * @param {Object} scope - Scope for dependency resolution
	 * @returns {any} Dependency instance
	 */
	get(name, scope = null) {
		const registration = this.dependencies.get(name);

		if (!registration) {
			throw new Error(`Dependency '${name}' not registered`);
		}

		// Check for singleton
		if (registration.singleton && this.singletons.has(name)) {
			return this.singletons.get(name);
		}

		// Check scope
		if (scope && this.scopes.has(scope) && this.scopes.get(scope).has(name)) {
			return this.scopes.get(scope).get(name);
		}

		// Resolve dependencies
		const resolvedDeps = {};
		for (const depName of registration.dependencies) {
			resolvedDeps[depName] = this.get(depName, scope);
		}

		// Create instance
		const instance = registration.factory(resolvedDeps, this);

		// Store if singleton
		if (registration.singleton) {
			this.singletons.set(name, instance);
		}

		// Store in scope if provided
		if (scope) {
			if (!this.scopes.has(scope)) {
				this.scopes.set(scope, new Map());
			}
			this.scopes.get(scope).set(name, instance);
		}

		return instance;
	}

	/**
	 * Create a new dependency scope
	 * @param {string} scopeName - Name of the scope
	 * @returns {string} Scope identifier
	 */
	createScope(scopeName = null) {
		const scopeId = scopeName || `scope_${Date.now()}_${Math.random()}`;
		this.scopes.set(scopeId, new Map());
		return scopeId;
	}

	/**
	 * Clear a dependency scope
	 * @param {string} scopeId - Scope identifier
	 */
	clearScope(scopeId) {
		this.scopes.delete(scopeId);
	}

	/**
	 * Clear all singletons (useful for testing)
	 */
	clearSingletons() {
		this.singletons.clear();
	}

	/**
	 * Clear all dependencies
	 */
	clear() {
		this.dependencies.clear();
		this.singletons.clear();
		this.scopes.clear();
	}

	/**
	 * Check if a dependency is registered
	 * @param {string} name - Dependency name
	 * @returns {boolean}
	 */
	has(name) {
		return this.dependencies.has(name);
	}

	/**
	 * Get all registered dependency names
	 * @returns {string[]}
	 */
	getRegisteredNames() {
		return Array.from(this.dependencies.keys());
	}
}

// Global container instance
export const globalContainer = new DependencyContainer();

/**
 * Decorator for dependency injection
 * @param {Object} dependencies - Dependencies to inject
 * @returns {Function} Class decorator
 */
export function injectable(dependencies = {}) {
	return function (target) {
		const originalConstructor = target;

		function newConstructor(...args) {
			// If first argument is a dependency container or dependencies object, use it
			const [firstArg, ...restArgs] = args;
			let resolvedDeps = {};

			if (firstArg && typeof firstArg === 'object') {
				// Check if it's a dependency container
				if (firstArg instanceof DependencyContainer) {
					Object.keys(dependencies).forEach((key) => {
						resolvedDeps[key] = firstArg.get(dependencies[key]);
					});
				} else {
					// Assume it's a dependencies object
					resolvedDeps = { ...firstArg };
				}
			} else {
				// Use global container
				Object.keys(dependencies).forEach((key) => {
					resolvedDeps[key] = globalContainer.get(dependencies[key]);
				});
			}

			return new originalConstructor(resolvedDeps, ...restArgs);
		}

		newConstructor.prototype = originalConstructor.prototype;
		return newConstructor;
	};
}
