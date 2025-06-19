/**
 * Configuration Getter/Setter Helper Functions
 *
 * Provides type-safe, path-based access to configuration values with validation,
 * default value support, and bulk update capabilities. Integrates with existing
 * validation utilities and configuration management.
 */

import { getConfig, writeConfig } from './config-manager.js';
import { validateConfig } from './validation/validators.js';
import { normalizeConfig } from './validation/sanitizers.js';
import { log } from './utils.js';

/**
 * Gets a configuration value using a dot-notation path
 * @param {string} path - Dot-notation path (e.g., 'models.main.provider')
 * @param {any} defaultValue - Default value if path doesn't exist
 * @param {object} options - Options for retrieval
 * @param {string} options.projectRoot - Explicit project root
 * @param {boolean} options.validate - Whether to validate the entire config before retrieval
 * @returns {any} The configuration value or default
 */
export function getConfigValue(path, defaultValue = null, options = {}) {
	const { projectRoot = null, validate = false } = options;

	try {
		const config = getConfig(projectRoot);

		if (!config) {
			log(
				'debug',
				`Configuration not found, returning default for path: ${path}`
			);
			return defaultValue;
		}

		// Validate config if requested
		if (validate) {
			const validationResult = validateConfig(config, { projectRoot });
			if (!validationResult.valid) {
				log(
					'warn',
					`Configuration validation failed for path ${path}: ${validationResult.errors.map((e) => e.message).join(', ')}`
				);
			}
		}

		// Navigate the path
		const value = getNestedValue(config, path);
		return value !== undefined ? value : defaultValue;
	} catch (error) {
		log(
			'error',
			`Error retrieving config value for path ${path}: ${error.message}`
		);
		return defaultValue;
	}
}

/**
 * Gets multiple configuration values using dot-notation paths
 * @param {Array<string|object>} paths - Array of paths or objects with path and default
 * @param {object} options - Options for retrieval
 * @returns {object} Object with path keys and their values
 */
export function getConfigValues(paths, options = {}) {
	const result = {};

	for (const pathSpec of paths) {
		if (typeof pathSpec === 'string') {
			result[pathSpec] = getConfigValue(pathSpec, null, options);
		} else if (typeof pathSpec === 'object' && pathSpec.path) {
			const { path, defaultValue = null, key = path } = pathSpec;
			result[key] = getConfigValue(path, defaultValue, options);
		}
	}

	return result;
}

/**
 * Sets a configuration value using a dot-notation path
 * @param {string} path - Dot-notation path (e.g., 'models.main.provider')
 * @param {any} value - Value to set
 * @param {object} options - Options for setting
 * @param {string} options.projectRoot - Explicit project root
 * @param {boolean} options.validate - Whether to validate after setting
 * @param {boolean} options.normalize - Whether to normalize the config
 * @param {boolean} options.merge - Whether to merge with existing config (default: true)
 * @returns {object} Result object with success status and validation info
 */
export function setConfigValue(path, value, options = {}) {
	const {
		projectRoot = null,
		validate = true,
		normalize = true,
		merge = true
	} = options;

	try {
		// Get current config or create empty one
		let config = merge ? getConfig(projectRoot) || {} : {};

		// Set the value at the specified path
		config = setNestedValue(config, path, value);

		// Normalize if requested
		if (normalize) {
			config = normalizeConfig(config);
		}

		// Validate if requested
		let validationResult = null;
		if (validate) {
			validationResult = validateConfig(config, {
				projectRoot,
				checkEnvironment: false // Skip env checks for setter
			});

			if (!validationResult.valid) {
				const errorMessage = `Configuration validation failed after setting ${path}: ${validationResult.errors.map((e) => e.message).join(', ')}`;
				log('error', errorMessage);
				return {
					success: false,
					error: errorMessage,
					validationResult
				};
			}
		}

		// Write the config
		writeConfig(config, projectRoot);

		log('debug', `Successfully set config value at path: ${path}`);
		return {
			success: true,
			value: getNestedValue(config, path),
			validationResult
		};
	} catch (error) {
		const errorMessage = `Error setting config value for path ${path}: ${error.message}`;
		log('error', errorMessage);
		return {
			success: false,
			error: errorMessage
		};
	}
}

/**
 * Sets multiple configuration values using dot-notation paths
 * @param {object} updates - Object with path keys and their values
 * @param {object} options - Options for setting
 * @returns {object} Result object with success status and validation info
 */
export function setConfigValues(updates, options = {}) {
	const { projectRoot = null, validate = true, normalize = true } = options;

	try {
		// Get current config
		let config = getConfig(projectRoot) || {};

		// Apply all updates
		for (const [path, value] of Object.entries(updates)) {
			config = setNestedValue(config, path, value);
		}

		// Normalize if requested
		if (normalize) {
			config = normalizeConfig(config);
		}

		// Validate if requested
		let validationResult = null;
		if (validate) {
			validationResult = validateConfig(config, {
				projectRoot,
				checkEnvironment: false
			});

			if (!validationResult.valid) {
				const errorMessage = `Configuration validation failed after bulk update: ${validationResult.errors.map((e) => e.message).join(', ')}`;
				log('error', errorMessage);
				return {
					success: false,
					error: errorMessage,
					validationResult
				};
			}
		}

		// Write the config
		writeConfig(config, projectRoot);

		log(
			'debug',
			`Successfully applied bulk config updates for ${Object.keys(updates).length} paths`
		);
		return {
			success: true,
			updatedPaths: Object.keys(updates),
			validationResult
		};
	} catch (error) {
		const errorMessage = `Error applying bulk config updates: ${error.message}`;
		log('error', errorMessage);
		return {
			success: false,
			error: errorMessage
		};
	}
}

/**
 * Merges configuration objects deeply
 * @param {object} target - Target configuration object
 * @param {object} source - Source configuration object to merge
 * @param {object} options - Merge options
 * @param {string} options.projectRoot - Explicit project root
 * @param {boolean} options.validate - Whether to validate after merging
 * @param {boolean} options.normalize - Whether to normalize after merging
 * @returns {object} Result object with success status and validation info
 */
export function mergeConfig(target, source, options = {}) {
	const { projectRoot = null, validate = true, normalize = true } = options;

	try {
		// Deep merge the configurations
		const merged = deepMerge(target, source);

		// Normalize if requested
		const finalConfig = normalize ? normalizeConfig(merged) : merged;

		// Validate if requested
		let validationResult = null;
		if (validate) {
			validationResult = validateConfig(finalConfig, {
				projectRoot,
				checkEnvironment: false
			});

			if (!validationResult.valid) {
				const errorMessage = `Configuration validation failed after merge: ${validationResult.errors.map((e) => e.message).join(', ')}`;
				log('error', errorMessage);
				return {
					success: false,
					error: errorMessage,
					validationResult
				};
			}
		}

		// Write the merged config
		writeConfig(finalConfig, projectRoot);

		log('debug', 'Successfully merged configuration');
		return {
			success: true,
			config: finalConfig,
			validationResult
		};
	} catch (error) {
		const errorMessage = `Error merging configuration: ${error.message}`;
		log('error', errorMessage);
		return {
			success: false,
			error: errorMessage
		};
	}
}

/**
 * Checks if a configuration path exists
 * @param {string} path - Dot-notation path
 * @param {string} projectRoot - Explicit project root
 * @returns {boolean} True if path exists
 */
export function hasConfigPath(path, projectRoot = null) {
	try {
		const config = getConfig(projectRoot);
		if (!config) return false;

		return getNestedValue(config, path) !== undefined;
	} catch (error) {
		log('debug', `Error checking config path ${path}: ${error.message}`);
		return false;
	}
}

/**
 * Deletes a configuration value at the specified path
 * @param {string} path - Dot-notation path
 * @param {object} options - Options for deletion
 * @param {string} options.projectRoot - Explicit project root
 * @param {boolean} options.validate - Whether to validate after deletion
 * @returns {object} Result object with success status
 */
export function deleteConfigValue(path, options = {}) {
	const { projectRoot = null, validate = true } = options;

	try {
		const config = getConfig(projectRoot);
		if (!config) {
			return { success: false, error: 'Configuration not found' };
		}

		// Delete the value at the path
		const updated = deleteNestedValue(config, path);

		// Validate if requested
		let validationResult = null;
		if (validate) {
			validationResult = validateConfig(updated, {
				projectRoot,
				checkEnvironment: false
			});

			if (!validationResult.valid) {
				const errorMessage = `Configuration validation failed after deleting ${path}: ${validationResult.errors.map((e) => e.message).join(', ')}`;
				log('error', errorMessage);
				return {
					success: false,
					error: errorMessage,
					validationResult
				};
			}
		}

		// Write the updated config
		writeConfig(updated, projectRoot);

		log('debug', `Successfully deleted config value at path: ${path}`);
		return {
			success: true,
			validationResult
		};
	} catch (error) {
		const errorMessage = `Error deleting config value for path ${path}: ${error.message}`;
		log('error', errorMessage);
		return {
			success: false,
			error: errorMessage
		};
	}
}

/**
 * Gets a configuration value with type checking
 * @template T
 * @param {string} path - Dot-notation path
 * @param {T} defaultValue - Default value (determines expected type)
 * @param {string} expectedType - Expected JavaScript type ('string', 'number', 'boolean', 'object')
 * @param {object} options - Options for retrieval
 * @returns {T} The configuration value cast to the expected type
 */
export function getTypedConfigValue(
	path,
	defaultValue,
	expectedType,
	options = {}
) {
	const value = getConfigValue(path, defaultValue, options);

	// If we got the default value, return it as-is
	if (value === defaultValue) {
		return value;
	}

	// Type checking and conversion
	const actualType = typeof value;

	if (actualType === expectedType) {
		return value;
	}

	// Attempt type conversion for common cases
	try {
		switch (expectedType) {
			case 'string':
				return String(value);
			case 'number':
				const num = Number(value);
				return isNaN(num) ? defaultValue : num;
			case 'boolean':
				if (typeof value === 'string') {
					return value.toLowerCase() === 'true';
				}
				return Boolean(value);
			case 'object':
				if (value === null || Array.isArray(value)) {
					return value;
				}
				return typeof value === 'object' ? value : defaultValue;
			default:
				log(
					'warn',
					`Unknown expected type ${expectedType} for path ${path}, returning value as-is`
				);
				return value;
		}
	} catch (error) {
		log(
			'warn',
			`Type conversion failed for path ${path}, returning default value`
		);
		return defaultValue;
	}
}

// Utility functions for nested object operations

/**
 * Gets a nested value from an object using a dot-notation path
 * @param {object} obj - Object to search
 * @param {string} path - Dot-notation path
 * @returns {any} The value or undefined if not found
 */
function getNestedValue(obj, path) {
	if (!obj || typeof obj !== 'object') return undefined;

	const keys = path.split('.');
	let current = obj;

	for (const key of keys) {
		if (
			current === null ||
			current === undefined ||
			typeof current !== 'object'
		) {
			return undefined;
		}
		current = current[key];
	}

	return current;
}

/**
 * Sets a nested value in an object using a dot-notation path
 * @param {object} obj - Object to modify (will be cloned)
 * @param {string} path - Dot-notation path
 * @param {any} value - Value to set
 * @returns {object} New object with the value set
 */
function setNestedValue(obj, path, value) {
	const result = JSON.parse(JSON.stringify(obj)); // Deep clone
	const keys = path.split('.');
	let current = result;

	// Navigate to the parent of the target key
	for (let i = 0; i < keys.length - 1; i++) {
		const key = keys[i];
		if (
			current[key] === null ||
			current[key] === undefined ||
			typeof current[key] !== 'object' ||
			Array.isArray(current[key])
		) {
			current[key] = {};
		}
		current = current[key];
	}

	// Set the final value
	current[keys[keys.length - 1]] = value;
	return result;
}

/**
 * Deletes a nested value from an object using a dot-notation path
 * @param {object} obj - Object to modify (will be cloned)
 * @param {string} path - Dot-notation path
 * @returns {object} New object with the value deleted
 */
function deleteNestedValue(obj, path) {
	const result = JSON.parse(JSON.stringify(obj)); // Deep clone
	const keys = path.split('.');
	let current = result;

	// Navigate to the parent of the target key
	for (let i = 0; i < keys.length - 1; i++) {
		const key = keys[i];
		if (
			current[key] === null ||
			current[key] === undefined ||
			typeof current[key] !== 'object'
		) {
			return result; // Path doesn't exist, return unchanged
		}
		current = current[key];
	}

	// Delete the final key
	delete current[keys[keys.length - 1]];
	return result;
}

/**
 * Deep merges two objects
 * @param {object} target - Target object
 * @param {object} source - Source object
 * @returns {object} Merged object
 */
function deepMerge(target, source) {
	const result = { ...target };

	for (const key in source) {
		if (source.hasOwnProperty(key)) {
			if (isObject(result[key]) && isObject(source[key])) {
				result[key] = deepMerge(result[key], source[key]);
			} else {
				result[key] = source[key];
			}
		}
	}

	return result;
}

/**
 * Checks if a value is a plain object
 * @param {any} obj - Value to check
 * @returns {boolean} True if plain object
 */
function isObject(obj) {
	return obj !== null && typeof obj === 'object' && !Array.isArray(obj);
}

// Type-safe convenience functions for common configuration paths

/**
 * Gets model configuration for a specific role
 * @param {string} role - Model role ('main', 'research', 'fallback')
 * @param {object} options - Options for retrieval
 * @returns {object} Model configuration object
 */
export function getModelConfig(role, options = {}) {
	return getConfigValue(`models.${role}`, {}, options);
}

/**
 * Sets model configuration for a specific role
 * @param {string} role - Model role ('main', 'research', 'fallback')
 * @param {object} config - Model configuration object
 * @param {object} options - Options for setting
 * @returns {object} Result object with success status
 */
export function setModelConfig(role, config, options = {}) {
	return setConfigValue(`models.${role}`, config, options);
}

/**
 * Gets Linear integration configuration
 * @param {object} options - Options for retrieval
 * @returns {object} Linear configuration object
 */
export function getLinearConfig(options = {}) {
	return getConfigValue('integrations.linear', {}, options);
}

/**
 * Sets Linear integration configuration
 * @param {object} config - Linear configuration object
 * @param {object} options - Options for setting
 * @returns {object} Result object with success status
 */
export function setLinearConfig(config, options = {}) {
	return setConfigValue('integrations.linear', config, options);
}

/**
 * Gets global configuration
 * @param {object} options - Options for retrieval
 * @returns {object} Global configuration object
 */
export function getGlobalConfig(options = {}) {
	return getConfigValue('global', {}, options);
}

/**
 * Sets global configuration
 * @param {object} config - Global configuration object
 * @param {object} options - Options for setting
 * @returns {object} Result object with success status
 */
export function setGlobalConfig(config, options = {}) {
	return setConfigValue('global', config, options);
}
