/**
 * @fileoverview Environment File Manager
 *
 * Handles .env file operations for Linear integration while preserving
 * existing environment variables and maintaining file integrity.
 */

import fs from 'fs';
import path from 'path';

/**
 * Environment file management errors
 */
export const ENV_MANAGER_ERRORS = {
	FILE_NOT_FOUND: 'ENV_FILE_NOT_FOUND',
	PARSE_ERROR: 'ENV_PARSE_ERROR',
	WRITE_ERROR: 'ENV_WRITE_ERROR',
	BACKUP_ERROR: 'ENV_BACKUP_ERROR',
	VALIDATION_ERROR: 'ENV_VALIDATION_ERROR',
	PERMISSION_ERROR: 'ENV_PERMISSION_ERROR'
};

/**
 * Parse .env file into key-value pairs while preserving comments and formatting
 *
 * @param {string} filePath - Path to .env file
 * @returns {Object} Parsed environment data with lines and variables
 */
export function parseEnvFile(filePath) {
	try {
		if (!fs.existsSync(filePath)) {
			return {
				lines: [],
				variables: new Map(),
				hasLinearSection: false
			};
		}

		const content = fs.readFileSync(filePath, 'utf8');
		const lines = content.split('\n');
		const variables = new Map();
		let hasLinearSection = false;

		for (const line of lines) {
			const trimmed = line.trim();

			// Check for Linear section marker
			// Check for Linear section marker comment specifically
			if (trimmed === '# Linear Integration Settings') {
				hasLinearSection = true;
			} else if (trimmed.startsWith('LINEAR_') && trimmed.includes('=')) {
				hasLinearSection = true;
			}

			// Parse variable assignments
			if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
				const [key, ...valueParts] = trimmed.split('=');
				const value = valueParts.join('=').trim();
				variables.set(key.trim(), value);
			}
		}

		return {
			lines,
			variables,
			hasLinearSection,
			originalContent: content
		};
	} catch (error) {
		throw new Error(
			`${ENV_MANAGER_ERRORS.PARSE_ERROR}: Failed to parse .env file: ${error.message}`
		);
	}
}

/**
 * Append Linear integration section to environment data
 *
 * @param {Object} envData - Parsed environment data
 * @param {Object} linearVars - Linear environment variables
 * @returns {Object} Updated environment data
 */
export function appendLinearSection(envData, linearVars) {
	const updatedLines = [...envData.lines];
	const updatedVariables = new Map(envData.variables);

	// Remove existing Linear section if present
	if (envData.hasLinearSection) {
		const filteredLines = [];
		let inLinearSection = false;

		for (const line of updatedLines) {
			const trimmed = line.trim();

			if (trimmed.includes('Linear Integration')) {
				inLinearSection = true;
				continue;
			}

			if (
				inLinearSection &&
				trimmed.startsWith('#') &&
				!trimmed.includes('LINEAR_')
			) {
				inLinearSection = false;
			}

			if (inLinearSection && trimmed.startsWith('LINEAR_')) {
				// Remove existing Linear variables
				const [key] = trimmed.split('=');
				updatedVariables.delete(key.trim());
				continue;
			}

			if (!inLinearSection) {
				filteredLines.push(line);
			}
		}

		updatedLines.length = 0;
		updatedLines.push(...filteredLines);
	}

	// Remove trailing empty lines
	while (
		updatedLines.length > 0 &&
		updatedLines[updatedLines.length - 1].trim() === ''
	) {
		updatedLines.pop();
	}

	// Add Linear section
	if (updatedLines.length > 0) {
		updatedLines.push(''); // Empty line separator
	}
	updatedLines.push('# Linear Integration Settings');

	// Add Linear variables
	for (const [key, value] of Object.entries(linearVars)) {
		updatedLines.push(`${key}=${value}`);
		updatedVariables.set(key, value);
	}

	return {
		lines: updatedLines,
		variables: updatedVariables,
		hasLinearSection: true
	};
}

/**
 * Write environment data to .env file
 *
 * @param {Object} envData - Environment data to write
 * @param {string} filePath - Path to .env file
 * @returns {Promise<void>}
 */
export async function writeEnvFile(envData, filePath) {
	try {
		const content = envData.lines.join('\n');

		// Ensure directory exists
		const dir = path.dirname(filePath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}

		// Write file
		fs.writeFileSync(filePath, content, { mode: 0o600 });

		// Verify write by reading back
		const verification = fs.readFileSync(filePath, 'utf8');
		if (verification !== content) {
			throw new Error('File verification failed after write');
		}
	} catch (error) {
		throw new Error(
			`${ENV_MANAGER_ERRORS.WRITE_ERROR}: Failed to write .env file: ${error.message}`
		);
	}
}

/**
 * Create backup of existing .env file
 *
 * @param {string} filePath - Path to .env file
 * @returns {string|null} Path to backup file or null if no backup needed
 */
export function createEnvBackup(filePath) {
	try {
		if (!fs.existsSync(filePath)) {
			return null; // No backup needed for non-existent file
		}

		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const backupDir = path.join(
			path.dirname(filePath),
			'.taskmaster',
			'backups'
		);

		// Ensure backup directory exists
		if (!fs.existsSync(backupDir)) {
			fs.mkdirSync(backupDir, { recursive: true });
		}

		const backupPath = path.join(backupDir, `env-backup-${timestamp}.env`);
		fs.copyFileSync(filePath, backupPath);

		return backupPath;
	} catch (error) {
		throw new Error(
			`${ENV_MANAGER_ERRORS.BACKUP_ERROR}: Failed to create backup: ${error.message}`
		);
	}
}

/**
 * Validate environment integrity by comparing original and new variables
 *
 * @param {Map} originalVars - Original environment variables
 * @param {Map} newVars - New environment variables
 * @returns {Object} Validation result
 */
export function validateEnvIntegrity(originalVars, newVars) {
	const result = {
		valid: true,
		errors: [],
		warnings: [],
		preserved: [],
		added: [],
		modified: []
	};

	// Check that all original non-Linear variables are preserved
	for (const [key, value] of originalVars) {
		if (!key.startsWith('LINEAR_')) {
			if (!newVars.has(key)) {
				result.valid = false;
				result.errors.push(`Lost existing variable: ${key}`);
			} else if (newVars.get(key) !== value) {
				result.warnings.push(`Modified existing variable: ${key}`);
				result.modified.push(key);
			} else {
				result.preserved.push(key);
			}
		}
	}

	// Identify newly added variables
	for (const [key] of newVars) {
		if (!originalVars.has(key)) {
			result.added.push(key);
		}
	}

	return result;
}

/**
 * Check if .env file has write permissions
 *
 * @param {string} filePath - Path to .env file
 * @returns {boolean} True if writable
 */
export function checkEnvWritePermissions(filePath) {
	try {
		const dir = path.dirname(filePath);

		// Check directory write permissions
		fs.accessSync(dir, fs.constants.W_OK);

		// Check file write permissions if it exists
		if (fs.existsSync(filePath)) {
			fs.accessSync(filePath, fs.constants.W_OK);
		}

		return true;
	} catch (error) {
		return false;
	}
}

/**
 * Restore .env file from backup
 *
 * @param {string} backupPath - Path to backup file
 * @param {string} targetPath - Path to restore to
 * @returns {Promise<void>}
 */
export async function restoreEnvFromBackup(backupPath, targetPath) {
	try {
		if (!fs.existsSync(backupPath)) {
			throw new Error('Backup file not found');
		}

		fs.copyFileSync(backupPath, targetPath);

		// Set secure permissions
		fs.chmodSync(targetPath, 0o600);
	} catch (error) {
		throw new Error(
			`${ENV_MANAGER_ERRORS.WRITE_ERROR}: Failed to restore from backup: ${error.message}`
		);
	}
}

/**
 * Format Linear environment variables from wizard selections
 *
 * @param {Object} selections - Wizard selections
 * @returns {Object} Formatted Linear environment variables
 */
export function formatLinearEnvVars(selections) {
	const linearVars = {};

	// API Key (preserve existing if present)
	if (selections.apiKey) {
		linearVars.LINEAR_API_KEY = selections.apiKey;
	}

	// Team ID (single team)
	if (selections.team) {
		const teamId =
			typeof selections.team === 'string'
				? selections.team
				: selections.team.id;
		if (teamId) {
			linearVars.LINEAR_TEAM_ID = teamId;
		}
	}

	// Project ID (single project)
	if (selections.project) {
		const projectId =
			typeof selections.project === 'string'
				? selections.project
				: selections.project.id;
		if (projectId) {
			linearVars.LINEAR_PROJECT_ID = projectId;
		}
	}

	// Workspace ID
	if (selections.workspaceId) {
		linearVars.LINEAR_WORKSPACE_ID = selections.workspaceId;
	}

	return linearVars;
}
