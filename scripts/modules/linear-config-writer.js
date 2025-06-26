/**
 * @fileoverview Linear Configuration Writer
 *
 * Main orchestrator for writing Linear integration configuration.
 * Handles both .env file updates and linear-config.json creation
 * while preserving existing settings and ensuring data integrity.
 */

import fs from 'fs';
import path from 'path';
import {
	parseEnvFile,
	appendLinearSection,
	writeEnvFile,
	createEnvBackup,
	validateEnvIntegrity,
	checkEnvWritePermissions,
	restoreEnvFromBackup,
	formatLinearEnvVars,
	ENV_MANAGER_ERRORS
} from './env-file-manager.js';
import {
	readLinearConfig,
	writeLinearConfig,
	formatLinearConfig,
	getLinearConfigPath,
	validateLinearConfig,
	CONFIG_MANAGER_ERRORS
} from './linear-config-manager.js';

/**
 * Configuration writer errors
 */
export const CONFIG_WRITER_ERRORS = {
	PERMISSION_ERROR: 'CONFIG_PERMISSION_ERROR',
	VALIDATION_ERROR: 'CONFIG_VALIDATION_ERROR',
	WRITE_ERROR: 'CONFIG_WRITE_ERROR',
	ROLLBACK_ERROR: 'CONFIG_ROLLBACK_ERROR',
	INTEGRITY_ERROR: 'CONFIG_INTEGRITY_ERROR'
};

/**
 * Write Linear configuration from wizard selections
 *
 * @param {Object} wizardData - Complete wizard selections
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Result of configuration write operation
 */
export async function writeLinearConfiguration(wizardData, options = {}) {
	const {
		projectRoot = process.cwd(),
		dryRun = false,
		createBackup = true,
		validateOnly = false
	} = options;

	const result = {
		success: false,
		files: {
			env: { path: null, action: null, backup: null },
			config: { path: null, action: null }
		},
		validation: {
			env: null,
			config: null
		},
		errors: [],
		warnings: []
	};

	let envBackupPath = null;

	try {
		// Step 1: Validate inputs and permissions
		const validationResult = await validateWriteOperations(
			wizardData,
			projectRoot
		);
		if (!validationResult.valid) {
			result.errors.push(...validationResult.errors);
			return result;
		}
		result.warnings.push(...validationResult.warnings);

		// Step 2: Prepare file paths
		const envPath = path.join(projectRoot, '.env');
		const configPath = getLinearConfigPath(projectRoot);

		result.files.env.path = envPath;
		result.files.config.path = configPath;

		// Step 3: Parse existing .env file
		const originalEnvData = parseEnvFile(envPath);
		const linearEnvVars = formatLinearEnvVars(wizardData);

		// Step 4: Prepare new .env content
		const updatedEnvData = appendLinearSection(originalEnvData, linearEnvVars);

		// Step 5: Validate .env integrity
		const envIntegrityCheck = validateEnvIntegrity(
			originalEnvData.variables,
			updatedEnvData.variables
		);
		result.validation.env = envIntegrityCheck;

		if (!envIntegrityCheck.valid) {
			result.errors.push(
				`${CONFIG_WRITER_ERRORS.INTEGRITY_ERROR}: .env integrity check failed`
			);
			result.errors.push(...envIntegrityCheck.errors);
			return result;
		}

		// Step 6: Prepare Linear config
		const linearConfig = formatLinearConfig(wizardData);
		const configValidation = validateLinearConfig(linearConfig);
		result.validation.config = configValidation;

		if (!configValidation.valid) {
			result.errors.push(
				`${CONFIG_WRITER_ERRORS.VALIDATION_ERROR}: Linear config validation failed`
			);
			result.errors.push(...configValidation.errors);
			return result;
		}
		result.warnings.push(...configValidation.warnings);

		// If validation only, return here
		if (validateOnly) {
			result.success = true;
			return result;
		}

		// If dry run, show what would be done
		if (dryRun) {
			result.files.env.action =
				originalEnvData.lines.length > 0 ? 'update' : 'create';
			result.files.config.action = 'create';
			result.success = true;
			return result;
		}

		// Step 7: Create backup if requested and needed
		if (createBackup && originalEnvData.lines.length > 0) {
			envBackupPath = createEnvBackup(envPath);
			result.files.env.backup = envBackupPath;
		}

		// Step 8: Write .env file
		await writeEnvFile(updatedEnvData, envPath);
		result.files.env.action =
			originalEnvData.lines.length > 0 ? 'updated' : 'created';

		// Step 9: Write linear-config.json
		await writeLinearConfig(linearConfig, configPath);
		result.files.config.action = 'created';

		// Step 10: Final verification
		const verification = await verifyWrittenFiles(
			envPath,
			configPath,
			wizardData
		);
		if (!verification.valid) {
			result.errors.push(
				`${CONFIG_WRITER_ERRORS.INTEGRITY_ERROR}: Post-write verification failed`
			);
			result.errors.push(...verification.errors);

			// Attempt rollback
			if (envBackupPath) {
				try {
					await restoreEnvFromBackup(envBackupPath, envPath);
					result.warnings.push(
						'Restored .env file from backup due to verification failure'
					);
				} catch (rollbackError) {
					result.errors.push(
						`${CONFIG_WRITER_ERRORS.ROLLBACK_ERROR}: Failed to restore backup: ${rollbackError.message}`
					);
				}
			}
			return result;
		}

		result.success = true;
		return result;
	} catch (error) {
		result.errors.push(`${CONFIG_WRITER_ERRORS.WRITE_ERROR}: ${error.message}`);

		// Attempt rollback on error
		if (envBackupPath) {
			try {
				await restoreEnvFromBackup(envBackupPath, result.files.env.path);
				result.warnings.push(
					'Restored .env file from backup due to write error'
				);
			} catch (rollbackError) {
				result.errors.push(
					`${CONFIG_WRITER_ERRORS.ROLLBACK_ERROR}: Failed to restore backup: ${rollbackError.message}`
				);
			}
		}

		return result;
	}
}

/**
 * Validate write operations before proceeding
 *
 * @param {Object} wizardData - Wizard selections
 * @param {string} projectRoot - Project root directory
 * @returns {Promise<Object>} Validation result
 */
async function validateWriteOperations(wizardData, projectRoot) {
	const result = {
		valid: true,
		errors: [],
		warnings: []
	};

	// Validate wizard data structure
	if (!wizardData || typeof wizardData !== 'object') {
		result.valid = false;
		result.errors.push('Invalid wizard data: must be an object');
		return result;
	}

	// Check for required wizard data
	if (!wizardData.apiKey && !wizardData.teams && !wizardData.projects) {
		result.warnings.push('No Linear configuration data provided');
	}

	// Validate API key format if provided
	if (wizardData.apiKey && !isValidLinearApiKey(wizardData.apiKey)) {
		result.valid = false;
		result.errors.push('Invalid Linear API key format');
	}

	// Check file permissions
	const envPath = path.join(projectRoot, '.env');
	if (!checkEnvWritePermissions(envPath)) {
		result.valid = false;
		result.errors.push(
			`${CONFIG_WRITER_ERRORS.PERMISSION_ERROR}: Cannot write to .env file`
		);
	}

	// Check project root exists and is writable
	try {
		fs.accessSync(projectRoot, fs.constants.W_OK);
	} catch (error) {
		result.valid = false;
		result.errors.push(
			`${CONFIG_WRITER_ERRORS.PERMISSION_ERROR}: Project root not writable: ${projectRoot}`
		);
	}

	return result;
}

/**
 * Verify written files contain expected content
 *
 * @param {string} envPath - Path to .env file
 * @param {string} configPath - Path to config file
 * @param {Object} wizardData - Original wizard data
 * @returns {Promise<Object>} Verification result
 */
async function verifyWrittenFiles(envPath, configPath, wizardData) {
	const result = {
		valid: true,
		errors: [],
		warnings: []
	};

	try {
		// Verify .env file
		const envData = parseEnvFile(envPath);
		const expectedLinearVars = formatLinearEnvVars(wizardData);

		for (const [key, expectedValue] of Object.entries(expectedLinearVars)) {
			if (!envData.variables.has(key)) {
				result.valid = false;
				result.errors.push(`Missing expected environment variable: ${key}`);
			} else if (envData.variables.get(key) !== expectedValue) {
				result.valid = false;
				result.errors.push(`Environment variable value mismatch: ${key}`);
			}
		}

		// Verify config file
		const config = readLinearConfig(configPath);
		const configValidation = validateLinearConfig(config);

		if (!configValidation.valid) {
			result.valid = false;
			result.errors.push('Written config file failed validation');
			result.errors.push(...configValidation.errors);
		}
	} catch (error) {
		result.valid = false;
		result.errors.push(`Verification failed: ${error.message}`);
	}

	return result;
}

/**
 * Validate Linear API key format
 *
 * @param {string} apiKey - API key to validate
 * @returns {boolean} True if valid format
 */
function isValidLinearApiKey(apiKey) {
	if (!apiKey || typeof apiKey !== 'string') {
		return false;
	}

	// Linear API keys are typically 40+ character strings
	// that start with "lin_api_" prefix
	const linearKeyPattern = /^lin_api_[a-zA-Z0-9]{32,}$/;
	return linearKeyPattern.test(apiKey);
}

/**
 * Get configuration summary for user display
 *
 * @param {Object} result - Write operation result
 * @returns {Object} User-friendly summary
 */
export function getConfigurationSummary(result) {
	const summary = {
		success: result.success,
		filesModified: [],
		backupsCreated: [],
		environmentVariables: {
			added: [],
			preserved: []
		},
		warnings: result.warnings,
		errors: result.errors
	};

	// Files modified
	if (result.files.env.action) {
		summary.filesModified.push({
			file: '.env',
			action: result.files.env.action,
			path: result.files.env.path
		});
	}

	if (result.files.config.action) {
		summary.filesModified.push({
			file: 'linear-config.json',
			action: result.files.config.action,
			path: result.files.config.path
		});
	}

	// Backups created
	if (result.files.env.backup) {
		summary.backupsCreated.push({
			original: result.files.env.path,
			backup: result.files.env.backup
		});
	}

	// Environment variables summary
	if (result.validation.env) {
		summary.environmentVariables.added = result.validation.env.added || [];
		summary.environmentVariables.preserved =
			result.validation.env.preserved || [];
	}

	return summary;
}

/**
 * Rollback configuration changes
 *
 * @param {Object} result - Write operation result with backup info
 * @returns {Promise<Object>} Rollback result
 */
export async function rollbackConfiguration(result) {
	const rollbackResult = {
		success: false,
		actions: [],
		errors: []
	};

	try {
		// Restore .env from backup if available
		if (result.files.env.backup && result.files.env.path) {
			await restoreEnvFromBackup(
				result.files.env.backup,
				result.files.env.path
			);
			rollbackResult.actions.push('Restored .env file from backup');
		}

		// Remove linear-config.json if it was created
		if (result.files.config.path && result.files.config.action === 'created') {
			if (fs.existsSync(result.files.config.path)) {
				fs.unlinkSync(result.files.config.path);
				rollbackResult.actions.push('Removed linear-config.json file');
			}
		}

		rollbackResult.success = true;
	} catch (error) {
		rollbackResult.errors.push(`Rollback failed: ${error.message}`);
	}

	return rollbackResult;
}
