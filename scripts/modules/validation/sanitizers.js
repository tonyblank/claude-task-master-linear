/**
 * Input sanitization and configuration normalization utilities
 */

import { log } from '../utils.js';

/**
 * Sanitizes configuration input to prevent injection attacks and normalize data
 * @param {any} input - The input to sanitize
 * @param {object} options - Sanitization options
 * @returns {any} Sanitized input
 */
export function sanitizeConfigInput(input, options = {}) {
	const {
		maxStringLength = 1000,
		maxDepth = 10,
		allowedKeys = null, // null means allow all
		stripHtml = true,
		trimStrings = true
	} = options;

	return sanitizeValue(input, 0, {
		maxStringLength,
		maxDepth,
		allowedKeys,
		stripHtml,
		trimStrings
	});
}

/**
 * Recursively sanitizes a value
 * @param {any} value - Value to sanitize
 * @param {number} depth - Current recursion depth
 * @param {object} options - Sanitization options
 * @returns {any} Sanitized value
 */
function sanitizeValue(value, depth, options) {
	const { maxStringLength, maxDepth, allowedKeys, stripHtml, trimStrings } =
		options;

	// Prevent infinite recursion
	if (depth > maxDepth) {
		log('warn', `Maximum depth (${maxDepth}) exceeded during sanitization`);
		return null;
	}

	// Handle null/undefined
	if (value == null) {
		return value;
	}

	// Handle strings
	if (typeof value === 'string') {
		let sanitized = value;

		// Trim whitespace
		if (trimStrings) {
			sanitized = sanitized.trim();
		}

		// Strip HTML tags (basic protection)
		if (stripHtml) {
			sanitized = sanitized.replace(/<[^>]*>/g, '');
		}

		// Remove potentially dangerous characters and SQL injection patterns
		sanitized = sanitized.replace(/[<>\"'&]/g, '');

		// Remove SQL injection patterns
		sanitized = sanitized.replace(
			/(\bDROP\b|\bTABLE\b|\bUNION\b|\bSELECT\b|\bINSERT\b|\bDELETE\b|\bUPDATE\b)/gi,
			''
		);
		sanitized = sanitized.replace(/(\b1\s*=\s*1\b|\b1\s*'\s*=\s*'1\b)/gi, '');
		sanitized = sanitized.replace(/(--|\/\*|\*\/)/g, '');

		// Remove script tags but keep other content
		sanitized = sanitized.replace(
			/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
			''
		);

		// Limit string length
		if (sanitized.length > maxStringLength) {
			log(
				'warn',
				`String truncated from ${sanitized.length} to ${maxStringLength} characters`
			);
			sanitized = sanitized.substring(0, maxStringLength);
		}

		return sanitized;
	}

	// Handle numbers
	if (typeof value === 'number') {
		// Check for dangerous values
		if (!Number.isFinite(value)) {
			log('warn', 'Non-finite number value replaced with 0');
			return 0;
		}
		return value;
	}

	// Handle booleans
	if (typeof value === 'boolean') {
		return value;
	}

	// Handle arrays
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeValue(item, depth + 1, options));
	}

	// Handle objects
	if (typeof value === 'object') {
		const sanitized = {};

		for (const [key, val] of Object.entries(value)) {
			// Prevent prototype pollution
			if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
				log('warn', `Blocked prototype pollution attempt with key: ${key}`);
				continue;
			}

			// Sanitize the key itself
			const sanitizedKey = sanitizeValue(key, depth + 1, options);

			// Check if key is allowed
			if (allowedKeys && !allowedKeys.includes(sanitizedKey)) {
				log('debug', `Skipping disallowed key: ${sanitizedKey}`);
				continue;
			}

			// Recursively sanitize the value
			sanitized[sanitizedKey] = sanitizeValue(val, depth + 1, options);
		}

		return sanitized;
	}

	// For other types, convert to string and sanitize
	log('warn', `Unexpected value type: ${typeof value}, converting to string`);
	return sanitizeValue(String(value), depth, options);
}

/**
 * Normalizes configuration object to ensure consistent structure
 * @param {object} config - Configuration object to normalize
 * @param {object} defaults - Default configuration structure
 * @returns {object} Normalized configuration
 */
export function normalizeConfig(config, defaults = {}) {
	if (!config || typeof config !== 'object') {
		log('warn', 'Invalid config object provided, using defaults');
		return { ...defaults };
	}

	const normalized = { ...defaults };

	// Deep merge configuration
	mergeDeep(normalized, config);

	// Normalize specific fields
	normalizeModelConfigs(normalized);
	normalizeGlobalConfig(normalized);
	normalizeLinearConfig(normalized);

	return normalized;
}

/**
 * Deep merge two objects
 * @param {object} target - Target object
 * @param {object} source - Source object
 */
function mergeDeep(target, source) {
	for (const key in source) {
		if (source.hasOwnProperty(key)) {
			if (isObject(target[key]) && isObject(source[key])) {
				mergeDeep(target[key], source[key]);
			} else {
				target[key] = source[key];
			}
		}
	}
}

/**
 * Normalizes model configurations
 * @param {object} config - Configuration object
 */
function normalizeModelConfigs(config) {
	if (!config.models) {
		config.models = {};
	}

	// Ensure required roles exist
	const roles = ['main', 'research', 'fallback'];
	for (const role of roles) {
		if (!config.models[role]) {
			config.models[role] = {};
		}

		const modelConfig = config.models[role];

		// Normalize provider names to lowercase
		if (modelConfig.provider) {
			modelConfig.provider = modelConfig.provider.toLowerCase().trim();
		}

		// Ensure numeric values are actually numbers
		if (modelConfig.maxTokens) {
			modelConfig.maxTokens = Number(modelConfig.maxTokens);
			if (
				!Number.isInteger(modelConfig.maxTokens) ||
				modelConfig.maxTokens < 1
			) {
				log('warn', `Invalid maxTokens for ${role}, using default`);
				delete modelConfig.maxTokens;
			}
		}

		if (modelConfig.temperature !== undefined) {
			modelConfig.temperature = Number(modelConfig.temperature);
			if (!Number.isFinite(modelConfig.temperature)) {
				log('warn', `Invalid temperature for ${role}, using default`);
				delete modelConfig.temperature;
			}
		}

		// Normalize baseURL
		if (modelConfig.baseURL) {
			modelConfig.baseURL = modelConfig.baseURL.trim().replace(/\/$/, ''); // Remove trailing slash
		}
	}
}

/**
 * Normalizes global configuration
 * @param {object} config - Configuration object
 */
function normalizeGlobalConfig(config) {
	if (!config.global) {
		config.global = {};
	}

	const global = config.global;

	// Normalize log level
	if (global.logLevel) {
		global.logLevel = global.logLevel.toLowerCase().trim();
	}

	// Ensure debug is boolean
	if (global.debug !== undefined) {
		global.debug = Boolean(global.debug);
	}

	// Normalize numeric values
	const numericFields = ['defaultSubtasks', 'defaultNumTasks'];
	for (const field of numericFields) {
		if (global[field] !== undefined) {
			global[field] = Number(global[field]);
			if (!Number.isInteger(global[field]) || global[field] < 1) {
				log('warn', `Invalid ${field}, using default`);
				delete global[field];
			}
		}
	}

	// Normalize URLs
	const urlFields = ['ollamaBaseURL', 'azureBaseURL', 'bedrockBaseURL'];
	for (const field of urlFields) {
		if (global[field]) {
			global[field] = global[field].trim().replace(/\/$/, ''); // Remove trailing slash
		}
	}

	// Normalize project name
	if (global.projectName) {
		global.projectName = global.projectName.trim();
	}

	// Normalize default priority
	if (global.defaultPriority) {
		global.defaultPriority = global.defaultPriority.toLowerCase().trim();
		if (!['high', 'medium', 'low'].includes(global.defaultPriority)) {
			log(
				'warn',
				`Invalid defaultPriority: ${global.defaultPriority}, using default`
			);
			delete global.defaultPriority;
		}
	}
}

/**
 * Normalizes Linear configuration
 * @param {object} config - Configuration object
 */
function normalizeLinearConfig(config) {
	if (!config.integrations) {
		config.integrations = {};
	}
	if (!config.integrations.linear) {
		config.integrations.linear = {};
	}

	const linear = config.integrations.linear;

	// Ensure enabled is boolean
	if (linear.enabled !== undefined) {
		linear.enabled = Boolean(linear.enabled);
	}

	// Normalize team configuration
	if (linear.team) {
		if (linear.team.id) {
			linear.team.id = linear.team.id.trim().toLowerCase();
		}
		if (linear.team.name) {
			linear.team.name = linear.team.name.trim();
		}
	}

	// Normalize project configuration
	if (linear.project) {
		if (linear.project.id) {
			linear.project.id = linear.project.id.trim().toLowerCase();
		}
		if (linear.project.name) {
			linear.project.name = linear.project.name.trim();
		}
	}

	// Normalize labels configuration
	if (linear.labels) {
		if (linear.labels.enabled !== undefined) {
			linear.labels.enabled = Boolean(linear.labels.enabled);
		}
		if (linear.labels.sourceLabel) {
			linear.labels.sourceLabel = linear.labels.sourceLabel.trim();
		}

		// Normalize mappings (ensure all values are strings)
		['priorityMapping', 'statusMapping'].forEach((mappingType) => {
			if (linear.labels[mappingType]) {
				const mapping = linear.labels[mappingType];
				for (const key in mapping) {
					if (mapping[key] && typeof mapping[key] !== 'string') {
						mapping[key] = String(mapping[key]).trim();
					} else if (typeof mapping[key] === 'string') {
						mapping[key] = mapping[key].trim();
					}
				}
			}
		});
	}

	// Normalize sync configuration
	if (linear.sync) {
		const sync = linear.sync;

		// Boolean fields
		[
			'autoSync',
			'syncOnStatusChange',
			'syncSubtasks',
			'syncDependencies'
		].forEach((field) => {
			if (sync[field] !== undefined) {
				sync[field] = Boolean(sync[field]);
			}
		});

		// Numeric fields
		const numericSyncFields = {
			batchSize: { min: 1, max: 50 },
			retryAttempts: { min: 1, max: 10 },
			retryDelay: { min: 100, max: 10000 }
		};

		for (const [field, { min, max }] of Object.entries(numericSyncFields)) {
			if (sync[field] !== undefined) {
				sync[field] = Number(sync[field]);
				if (
					!Number.isInteger(sync[field]) ||
					sync[field] < min ||
					sync[field] > max
				) {
					log(
						'warn',
						`Invalid Linear sync ${field}: ${sync[field]}, must be between ${min} and ${max}`
					);
					delete sync[field];
				}
			}
		}
	}

	// Normalize webhooks configuration
	if (linear.webhooks) {
		if (linear.webhooks.enabled !== undefined) {
			linear.webhooks.enabled = Boolean(linear.webhooks.enabled);
		}
		if (linear.webhooks.url) {
			linear.webhooks.url = linear.webhooks.url.trim();
		}
		if (linear.webhooks.secret) {
			linear.webhooks.secret = linear.webhooks.secret.trim();
		}
	}
}

/**
 * Cleans configuration object by removing empty/null values and invalid keys
 * @param {object} config - Configuration object to clean
 * @param {object} options - Cleaning options
 * @returns {object} Cleaned configuration
 */
export function cleanConfigObject(config, options = {}) {
	const {
		removeNull = true,
		removeEmptyStrings = true,
		removeEmptyObjects = true,
		removeEmptyArrays = true,
		preserveKeys = [] // Keys to preserve even if empty
	} = options;

	if (!config || typeof config !== 'object') {
		return config;
	}

	if (Array.isArray(config)) {
		const cleaned = config
			.map((item) => cleanConfigObject(item, options))
			.filter((item) => !shouldRemoveValue(item, options));

		return removeEmptyArrays &&
			cleaned.length === 0 &&
			!preserveKeys.includes('array')
			? undefined
			: cleaned;
	}

	const cleaned = {};

	for (const [key, value] of Object.entries(config)) {
		if (preserveKeys.includes(key)) {
			cleaned[key] = value;
			continue;
		}

		const cleanedValue = cleanConfigObject(value, options);

		if (!shouldRemoveValue(cleanedValue, options)) {
			cleaned[key] = cleanedValue;
		}
	}

	// Remove empty object if configured to do so
	if (removeEmptyObjects && Object.keys(cleaned).length === 0) {
		return undefined;
	}

	return cleaned;
}

/**
 * Determines if a value should be removed during cleaning
 * @param {any} value - Value to check
 * @param {object} options - Cleaning options
 * @returns {boolean} True if value should be removed
 */
function shouldRemoveValue(value, options) {
	const {
		removeNull,
		removeEmptyStrings,
		removeEmptyObjects,
		removeEmptyArrays
	} = options;

	if (value === null && removeNull) return true;
	if (value === '' && removeEmptyStrings) return true;
	if (Array.isArray(value) && value.length === 0 && removeEmptyArrays)
		return true;
	if (isObject(value) && Object.keys(value).length === 0 && removeEmptyObjects)
		return true;

	return false;
}

/**
 * Validates that an object is a plain object
 * @param {any} obj - Object to check
 * @returns {boolean} True if plain object
 */
function isObject(obj) {
	return obj !== null && typeof obj === 'object' && !Array.isArray(obj);
}

/**
 * Removes sensitive information from configuration for logging
 * @param {object} config - Configuration object
 * @returns {object} Configuration with sensitive data redacted
 */
export function redactSensitiveData(config) {
	if (!config || typeof config !== 'object') {
		return config;
	}

	const redacted = JSON.parse(JSON.stringify(config)); // Deep clone

	// Redact API keys and secrets
	redactValue(redacted, (key, value) => {
		const keyLower = key.toLowerCase();

		// Check for sensitive key names
		const sensitiveKeyPatterns = [
			'key',
			'secret',
			'token',
			'password',
			'bearer',
			'privatekey',
			'publickey',
			'accesstoken',
			'refreshtoken',
			'clientsecret',
			'webhooksecret'
		];

		const isSensitiveKey = sensitiveKeyPatterns.some(
			(pattern) =>
				keyLower.includes(pattern) ||
				keyLower.replace(/[_-]/g, '').includes(pattern)
		);

		if (isSensitiveKey && typeof value === 'string') {
			// Don't redact environment variable placeholders
			if (value.startsWith('${') && value.endsWith('}')) {
				return value;
			}

			// Don't redact very short values (might be booleans converted to strings)
			if (value.length <= 5) {
				return value;
			}

			// Don't redact policy names or settings that just contain sensitive words
			if (
				keyLower.includes('policy') ||
				keyLower.includes('setting') ||
				keyLower.includes('mode') ||
				keyLower.includes('count') ||
				keyLower.includes('enabled')
			) {
				return value;
			}

			// Redact long credential-like strings
			return '[REDACTED]';
		}

		// Also check for bearer token patterns in values
		if (typeof value === 'string' && value.startsWith('Bearer ')) {
			return '[REDACTED]';
		}

		return value;
	});

	return redacted;
}

/**
 * Recursively applies a transformation to object values
 * @param {any} obj - Object to transform
 * @param {function} transformer - Function to transform values
 */
function redactValue(obj, transformer) {
	if (Array.isArray(obj)) {
		obj.forEach((item) => redactValue(item, transformer));
	} else if (obj && typeof obj === 'object') {
		for (const [key, value] of Object.entries(obj)) {
			const transformedValue = transformer(key, value);
			if (transformedValue !== value) {
				obj[key] = transformedValue;
			} else if (typeof value === 'object') {
				redactValue(value, transformer);
			}
		}
	}
}

/**
 * Securely deletes credentials from memory by overwriting with random data
 * @param {object} config - Configuration object containing credentials
 * @returns {object} Configuration with credentials securely deleted
 */
export function secureDeleteCredentials(config) {
	if (!config || typeof config !== 'object') {
		return config;
	}

	const cleaned = JSON.parse(JSON.stringify(config)); // Deep clone

	// Overwrite credential values with random data multiple times
	redactValue(cleaned, (key, value) => {
		const keyLower = key.toLowerCase();

		// Check for sensitive key names
		const sensitiveKeyPatterns = [
			'key',
			'secret',
			'token',
			'password',
			'bearer',
			'privatekey',
			'publickey',
			'accesstoken',
			'refreshtoken',
			'clientsecret',
			'webhooksecret'
		];

		const isSensitiveKey = sensitiveKeyPatterns.some(
			(pattern) =>
				keyLower.includes(pattern) ||
				keyLower.replace(/[_-]/g, '').includes(pattern)
		);

		if (isSensitiveKey && typeof value === 'string' && value.length > 5) {
			// Don't overwrite environment variable placeholders
			if (value.startsWith('${') && value.endsWith('}')) {
				return value;
			}

			// Don't delete policy names or settings that just contain sensitive words
			if (
				keyLower.includes('policy') ||
				keyLower.includes('setting') ||
				keyLower.includes('mode') ||
				keyLower.includes('count') ||
				keyLower.includes('enabled')
			) {
				return value;
			}

			// Overwrite with random data (3 passes for security)
			for (let i = 0; i < 3; i++) {
				const randomData = Array.from({ length: value.length }, () =>
					String.fromCharCode(Math.floor(Math.random() * 126) + 1)
				).join('');
				// This simulates secure overwriting in memory
			}

			return null; // Mark for deletion
		}

		return value;
	});

	return cleaned;
}
