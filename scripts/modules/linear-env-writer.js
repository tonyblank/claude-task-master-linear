/**
 * @fileoverview Linear Environment Writer
 *
 * Simplified writer that only updates .env file with Linear environment variables
 */

import path from 'path';
import {
	parseEnvFile,
	appendLinearSection,
	writeEnvFile,
	createEnvBackup,
	validateEnvIntegrity,
	formatLinearEnvVars,
	ENV_MANAGER_ERRORS
} from './env-file-manager.js';

/**
 * Write only Linear environment variables to .env file
 *
 * @param {Object} wizardData - Wizard data with team/project info
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Result of env write operation
 */
export async function writeLinearEnvironment(wizardData, options = {}) {
	const {
		projectRoot = process.cwd(),
		dryRun = false,
		createBackup = true
	} = options;

	const result = {
		success: false,
		files: {
			env: { path: null, action: null, backup: null }
		},
		validation: {
			env: null
		},
		errors: [],
		warnings: []
	};

	let envBackupPath = null;

	try {
		// Step 1: Prepare file paths
		const envPath = path.join(projectRoot, '.env');
		result.files.env.path = envPath;

		// Step 2: Parse existing .env file
		const originalEnvData = parseEnvFile(envPath);
		const linearEnvVars = formatLinearEnvVars(wizardData);

		// Step 3: Prepare new .env content
		const updatedEnvData = appendLinearSection(originalEnvData, linearEnvVars);

		// Step 4: Validate .env integrity
		const envIntegrityCheck = validateEnvIntegrity(
			originalEnvData.variables,
			updatedEnvData.variables
		);
		result.validation.env = envIntegrityCheck;

		if (!envIntegrityCheck.valid) {
			result.errors.push('ENV_INTEGRITY_ERROR: .env integrity check failed');
			result.errors.push(...envIntegrityCheck.errors);
			return result;
		}

		// If dry run, return here
		if (dryRun) {
			result.files.env.action =
				originalEnvData.lines.length > 0 ? 'update' : 'create';
			result.success = true;
			return result;
		}

		// Step 5: Create backup if requested and needed
		if (createBackup && originalEnvData.lines.length > 0) {
			envBackupPath = createEnvBackup(envPath);
			result.files.env.backup = envBackupPath;
		}

		// Step 6: Write .env file
		await writeEnvFile(updatedEnvData, envPath);
		result.files.env.action =
			originalEnvData.lines.length > 0 ? 'updated' : 'created';

		result.success = true;
		return result;
	} catch (error) {
		result.errors.push(`ENV_WRITE_ERROR: ${error.message}`);
		return result;
	}
}
