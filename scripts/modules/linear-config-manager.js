/**
 * @fileoverview Linear Configuration Manager
 *
 * Handles linear-config.json file operations for storing non-secret
 * Linear integration preferences and settings.
 */

import fs from 'fs';
import path from 'path';

/**
 * Linear configuration management errors
 */
export const CONFIG_MANAGER_ERRORS = {
	FILE_NOT_FOUND: 'CONFIG_FILE_NOT_FOUND',
	PARSE_ERROR: 'CONFIG_PARSE_ERROR',
	WRITE_ERROR: 'CONFIG_WRITE_ERROR',
	VALIDATION_ERROR: 'CONFIG_VALIDATION_ERROR',
	SCHEMA_ERROR: 'CONFIG_SCHEMA_ERROR'
};

/**
 * Default Linear configuration structure
 */
export const DEFAULT_LINEAR_CONFIG = {
	version: '1.0.0',
	labelPreferences: {
		categories: {},
		automation: {
			autoApplyTaskmaster: true,
			autoApplyLanguages: true,
			syncOnStatusChange: true
		}
	},
	syncSettings: {
		mode: 'one-way',
		createMissing: true,
		updateExisting: false,
		deleteUnused: false,
		batchSize: 10,
		retryAttempts: 3,
		retryDelay: 1000
	},
	mappings: {
		complexity: 'story-points',
		priority: 'priority',
		status: 'status'
	},
	automation: {
		enabled: true,
		rules: []
	},
	ui: {
		defaultView: 'kanban',
		groupBy: 'status',
		sortBy: 'priority'
	}
};

/**
 * Read existing linear-config.json file
 *
 * @param {string} configPath - Path to linear-config.json
 * @returns {Object} Configuration object or default config
 */
export function readLinearConfig(configPath) {
	try {
		if (!fs.existsSync(configPath)) {
			return { ...DEFAULT_LINEAR_CONFIG };
		}

		const content = fs.readFileSync(configPath, 'utf8');
		const config = JSON.parse(content);

		// Merge with defaults to ensure all fields are present
		return mergeWithDefaults(config);
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new Error(
				`${CONFIG_MANAGER_ERRORS.PARSE_ERROR}: Invalid JSON in config file: ${error.message}`
			);
		}
		throw new Error(
			`${CONFIG_MANAGER_ERRORS.FILE_NOT_FOUND}: Failed to read config file: ${error.message}`
		);
	}
}

/**
 * Write linear-config.json file
 *
 * @param {Object} config - Configuration object
 * @param {string} configPath - Path to linear-config.json
 * @returns {Promise<void>}
 */
export async function writeLinearConfig(config, configPath) {
	try {
		// Validate configuration structure
		const validationResult = validateLinearConfig(config);
		if (!validationResult.valid) {
			throw new Error(
				`${CONFIG_MANAGER_ERRORS.VALIDATION_ERROR}: ${validationResult.errors.join(', ')}`
			);
		}

		// Ensure directory exists
		const dir = path.dirname(configPath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}

		// Write formatted JSON
		const content = JSON.stringify(config, null, 2);
		fs.writeFileSync(configPath, content, 'utf8');

		// Verify write by reading back
		const verification = fs.readFileSync(configPath, 'utf8');
		const verifiedConfig = JSON.parse(verification);

		if (JSON.stringify(verifiedConfig) !== JSON.stringify(config)) {
			throw new Error('Configuration verification failed after write');
		}
	} catch (error) {
		if (error.message.includes(CONFIG_MANAGER_ERRORS.VALIDATION_ERROR)) {
			throw error;
		}
		throw new Error(
			`${CONFIG_MANAGER_ERRORS.WRITE_ERROR}: Failed to write config file: ${error.message}`
		);
	}
}

/**
 * Merge configuration with defaults to ensure completeness
 *
 * @param {Object} config - User configuration
 * @returns {Object} Merged configuration
 */
export function mergeWithDefaults(config) {
	const merged = JSON.parse(JSON.stringify(DEFAULT_LINEAR_CONFIG));

	// Deep merge user config into defaults
	return deepMerge(merged, config);
}

/**
 * Deep merge two objects
 *
 * @param {Object} target - Target object
 * @param {Object} source - Source object
 * @returns {Object} Merged object
 */
function deepMerge(target, source) {
	for (const key in source) {
		if (
			source[key] &&
			typeof source[key] === 'object' &&
			!Array.isArray(source[key])
		) {
			if (!target[key]) target[key] = {};
			deepMerge(target[key], source[key]);
		} else {
			target[key] = source[key];
		}
	}
	return target;
}

/**
 * Validate linear configuration structure
 *
 * @param {Object} config - Configuration to validate
 * @returns {Object} Validation result
 */
export function validateLinearConfig(config) {
	const result = {
		valid: true,
		errors: [],
		warnings: []
	};

	// Check required top-level fields
	const requiredFields = ['version', 'labelPreferences', 'syncSettings'];
	for (const field of requiredFields) {
		if (!config[field]) {
			result.valid = false;
			result.errors.push(`Missing required field: ${field}`);
		}
	}

	// Validate version
	if (config.version && typeof config.version !== 'string') {
		result.valid = false;
		result.errors.push('Version must be a string');
	}

	// Validate labelPreferences
	if (config.labelPreferences) {
		const labelValidation = validateLabelPreferences(config.labelPreferences);
		if (!labelValidation.valid) {
			result.valid = false;
			result.errors.push(...labelValidation.errors);
		}
		result.warnings.push(...labelValidation.warnings);
	}

	// Validate syncSettings
	if (config.syncSettings) {
		const syncValidation = validateSyncSettings(config.syncSettings);
		if (!syncValidation.valid) {
			result.valid = false;
			result.errors.push(...syncValidation.errors);
		}
		result.warnings.push(...syncValidation.warnings);
	}

	// Check for secrets in config (should not be present)
	const secretFields = [
		'api_key',
		'apikey',
		'team_id',
		'project_id',
		'workspace_id'
	];
	const configStr = JSON.stringify(config).toLowerCase();
	for (const field of secretFields) {
		if (configStr.includes(field.toLowerCase())) {
			result.warnings.push(
				`Possible secret field detected: ${field}. Secrets should be in .env file.`
			);
		}
	}

	return result;
}

/**
 * Validate label preferences section
 *
 * @param {Object} labelPreferences - Label preferences to validate
 * @returns {Object} Validation result
 */
function validateLabelPreferences(labelPreferences) {
	const result = {
		valid: true,
		errors: [],
		warnings: []
	};

	// Check categories structure
	if (
		labelPreferences.categories &&
		typeof labelPreferences.categories !== 'object'
	) {
		result.valid = false;
		result.errors.push('labelPreferences.categories must be an object');
	}

	// Check automation settings
	if (labelPreferences.automation) {
		const automation = labelPreferences.automation;
		const booleanFields = [
			'autoApplyTaskmaster',
			'autoApplyLanguages',
			'syncOnStatusChange'
		];

		for (const field of booleanFields) {
			if (
				automation[field] !== undefined &&
				typeof automation[field] !== 'boolean'
			) {
				result.warnings.push(
					`labelPreferences.automation.${field} should be boolean`
				);
			}
		}
	}

	return result;
}

/**
 * Validate sync settings section
 *
 * @param {Object} syncSettings - Sync settings to validate
 * @returns {Object} Validation result
 */
function validateSyncSettings(syncSettings) {
	const result = {
		valid: true,
		errors: [],
		warnings: []
	};

	// Validate mode
	if (
		syncSettings.mode &&
		!['one-way', 'two-way'].includes(syncSettings.mode)
	) {
		result.warnings.push('syncSettings.mode should be "one-way" or "two-way"');
	}

	// Validate boolean fields
	const booleanFields = ['createMissing', 'updateExisting', 'deleteUnused'];
	for (const field of booleanFields) {
		if (
			syncSettings[field] !== undefined &&
			typeof syncSettings[field] !== 'boolean'
		) {
			result.warnings.push(`syncSettings.${field} should be boolean`);
		}
	}

	// Validate numeric fields
	const numericFields = {
		batchSize: { min: 1, max: 50 },
		retryAttempts: { min: 1, max: 10 },
		retryDelay: { min: 100, max: 10000 }
	};

	for (const [field, constraints] of Object.entries(numericFields)) {
		if (syncSettings[field] !== undefined) {
			if (
				typeof syncSettings[field] !== 'number' ||
				!Number.isInteger(syncSettings[field])
			) {
				result.valid = false;
				result.errors.push(`syncSettings.${field} must be an integer`);
			} else if (
				syncSettings[field] < constraints.min ||
				syncSettings[field] > constraints.max
			) {
				result.valid = false;
				result.errors.push(
					`syncSettings.${field} must be between ${constraints.min} and ${constraints.max}`
				);
			}
		}
	}

	return result;
}

/**
 * Format Linear configuration from wizard selections
 *
 * @param {Object} selections - Wizard selections
 * @returns {Object} Formatted Linear configuration
 */
export function formatLinearConfig(selections) {
	const config = { ...DEFAULT_LINEAR_CONFIG };

	// Update label preferences from selections
	if (selections.labelConfiguration) {
		config.labelPreferences = {
			...config.labelPreferences,
			categories: selections.labelConfiguration.categories || {},
			automation: {
				...config.labelPreferences.automation,
				...selections.labelConfiguration.automation
			}
		};
	}

	// Update sync settings from selections
	if (selections.syncSettings) {
		config.syncSettings = {
			...config.syncSettings,
			...selections.syncSettings
		};
	}

	// Update automation settings
	if (selections.automation) {
		config.automation = {
			...config.automation,
			...selections.automation
		};
	}

	// Update UI preferences
	if (selections.uiPreferences) {
		config.ui = {
			...config.ui,
			...selections.uiPreferences
		};
	}

	// Add metadata
	config.metadata = {
		createdAt: new Date().toISOString(),
		createdBy: 'taskmaster-linear-wizard',
		version: config.version
	};

	return config;
}

/**
 * Get configuration file path
 *
 * @param {string} projectRoot - Project root directory
 * @returns {string} Path to linear-config.json
 */
export function getLinearConfigPath(projectRoot) {
	return path.join(projectRoot, 'linear-config.json');
}

/**
 * Check if linear-config.json exists
 *
 * @param {string} projectRoot - Project root directory
 * @returns {boolean} True if config file exists
 */
export function linearConfigExists(projectRoot) {
	const configPath = getLinearConfigPath(projectRoot);
	return fs.existsSync(configPath);
}

/**
 * Update specific section of linear configuration
 *
 * @param {string} projectRoot - Project root directory
 * @param {string} section - Configuration section to update
 * @param {Object} data - New data for the section
 * @returns {Promise<void>}
 */
export async function updateLinearConfigSection(projectRoot, section, data) {
	const configPath = getLinearConfigPath(projectRoot);
	const config = readLinearConfig(configPath);

	if (!config[section]) {
		throw new Error(`Unknown configuration section: ${section}`);
	}

	config[section] = { ...config[section], ...data };

	// Update metadata
	config.metadata = {
		...config.metadata,
		updatedAt: new Date().toISOString(),
		updatedBy: 'taskmaster-linear-wizard'
	};

	await writeLinearConfig(config, configPath);
}
