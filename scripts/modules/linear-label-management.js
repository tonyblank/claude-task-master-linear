/**
 * @fileoverview Linear Label Management Module
 *
 * This module provides functionality to manage Linear labels including:
 * - Fetching existing labels from Linear projects
 * - Creating missing labels based on configuration
 * - Synchronizing label configurations between TaskMaster and Linear
 * - Validating label consistency across projects
 */

import { LinearClient } from '@linear/sdk';
import { log } from './utils.js';
import { promptConfigs, messages } from './prompts.js';
import inquirer from 'inquirer';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import {
	detectLanguagesFromTask,
	languageToLabelKey,
	getLanguageInfo
} from './language-detection.js';

/**
 * Label management error types
 */
export const LABEL_MANAGEMENT_ERRORS = {
	AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
	NETWORK_ERROR: 'NETWORK_ERROR',
	RATE_LIMIT: 'RATE_LIMIT',
	INVALID_CONFIG: 'INVALID_CONFIG',
	LABEL_CREATE_ERROR: 'LABEL_CREATE_ERROR',
	LABEL_FETCH_ERROR: 'LABEL_FETCH_ERROR',
	PROJECT_ACCESS_ERROR: 'PROJECT_ACCESS_ERROR',
	CONFIG_FILE_ERROR: 'CONFIG_FILE_ERROR',
	API_ERROR: 'API_ERROR'
};

/**
 * Linear label management functionality
 */
export class LinearLabelManager {
	/**
	 * @param {Object} config - Configuration object
	 * @param {string} config.apiKey - Linear API key
	 * @param {string} config.projectRoot - TaskMaster project root directory
	 * @param {number} config.maxRetries - Maximum retry attempts (default: 3)
	 * @param {number} config.retryDelay - Base retry delay in ms (default: 1000)
	 */
	constructor(config = {}) {
		this.config = {
			maxRetries: 3,
			retryDelay: 1000,
			pageSize: 100, // Maximum labels to fetch per page
			...config
		};

		if (!this.config.apiKey) {
			throw new Error('Linear API key is required');
		}

		if (!this.config.projectRoot) {
			throw new Error('Project root directory is required');
		}

		this.linear = new LinearClient({
			apiKey: this.config.apiKey
		});

		this.labelSetsPath = join(
			this.config.projectRoot,
			'.taskmaster',
			'config',
			'label-sets.json'
		);
	}

	/**
	 * Load label sets configuration from file
	 *
	 * @returns {Object} Label sets configuration
	 * @throws {Error} When config file cannot be loaded
	 */
	loadLabelSetsConfig() {
		try {
			if (!existsSync(this.labelSetsPath)) {
				throw new Error(
					`Label sets configuration not found at: ${this.labelSetsPath}`
				);
			}

			const configContent = readFileSync(this.labelSetsPath, 'utf8');
			const config = JSON.parse(configContent);

			// Validate basic config structure
			if (!config.categories || typeof config.categories !== 'object') {
				throw new Error('Invalid label sets configuration: missing categories');
			}

			log('debug', 'Loaded label sets configuration successfully');
			return config;
		} catch (error) {
			const enhancedError = new Error(
				`Failed to load label sets config: ${error.message}`
			);
			enhancedError.code = LABEL_MANAGEMENT_ERRORS.CONFIG_FILE_ERROR;
			enhancedError.originalError = error;
			throw enhancedError;
		}
	}

	/**
	 * Save label sets configuration to file
	 *
	 * @param {Object} config - Label sets configuration to save
	 * @throws {Error} When config file cannot be saved
	 */
	saveLabelSetsConfig(config) {
		try {
			// Update metadata
			config.metadata = {
				...config.metadata,
				lastUpdated: new Date().toISOString(),
				version: config.version || '1.0.0'
			};

			const configContent = JSON.stringify(config, null, 2);
			writeFileSync(this.labelSetsPath, configContent, 'utf8');

			log('info', 'Saved label sets configuration successfully');
		} catch (error) {
			const enhancedError = new Error(
				`Failed to save label sets config: ${error.message}`
			);
			enhancedError.code = LABEL_MANAGEMENT_ERRORS.CONFIG_FILE_ERROR;
			enhancedError.originalError = error;
			throw enhancedError;
		}
	}

	/**
	 * Fetch all labels from a Linear project
	 *
	 * @param {string} projectId - Linear project ID (UUID format)
	 * @returns {Promise<Array>} Array of label objects from Linear
	 * @throws {Error} When API request fails
	 */
	async fetchProjectLabels(projectId) {
		if (!projectId || typeof projectId !== 'string') {
			throw new Error('Project ID is required and must be a string');
		}

		// Validate project ID format (UUID)
		const uuidRegex =
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
		if (!uuidRegex.test(projectId)) {
			throw new Error('Project ID must be a valid UUID format');
		}

		try {
			log(
				'debug',
				`Fetching labels for project ${projectId} from Linear API...`
			);

			// Use retry logic for robust label fetching
			const labels = await this._retryOperation(async () => {
				// Get the project first to access its labels
				const project = await this.linear.project(projectId);

				if (!project) {
					const error = new Error(
						`Project not found or access denied: ${projectId}`
					);
					error.code = LABEL_MANAGEMENT_ERRORS.PROJECT_ACCESS_ERROR;
					throw error;
				}

				// Fetch labels for this project
				const labelsConnection = await project.labels({
					first: this.config.pageSize
				});

				return labelsConnection.nodes;
			}, 'fetch project labels');

			log('info', `Successfully fetched ${labels.length} labels for project`);

			// Transform labels for easier processing
			return labels.map((label) => ({
				id: label.id,
				name: label.name,
				description: label.description || '',
				color: label.color || '#6366f1',
				createdAt: label.createdAt,
				updatedAt: label.updatedAt,
				isArchived: label.isArchived || false
			}));
		} catch (error) {
			throw this._enhanceError(error, 'fetch project labels');
		}
	}

	/**
	 * Fetch labels from multiple Linear projects
	 *
	 * @param {string[]} projectIds - Array of Linear project IDs
	 * @returns {Promise<Object>} Object mapping project ID to labels array
	 */
	async fetchMultipleProjectLabels(projectIds) {
		if (!Array.isArray(projectIds) || projectIds.length === 0) {
			throw new Error('Project IDs array is required and cannot be empty');
		}

		const results = {};
		const errors = [];

		for (const projectId of projectIds) {
			try {
				results[projectId] = await this.fetchProjectLabels(projectId);
			} catch (error) {
				log(
					'warn',
					`Failed to fetch labels for project ${projectId}: ${error.message}`
				);
				errors.push({ projectId, error });
				results[projectId] = [];
			}
		}

		if (errors.length > 0) {
			log(
				'warn',
				`Encountered ${errors.length} errors while fetching labels from ${projectIds.length} projects`
			);
		}

		return results;
	}

	/**
	 * Create a new label in Linear
	 *
	 * @param {string} teamId - Linear team ID
	 * @param {Object} labelConfig - Label configuration
	 * @param {string} labelConfig.name - Label name
	 * @param {string} labelConfig.description - Label description
	 * @param {string} labelConfig.color - Label color (hex format)
	 * @returns {Promise<Object>} Created label object
	 */
	async createLabel(teamId, labelConfig) {
		if (!teamId || typeof teamId !== 'string') {
			throw new Error('Team ID is required and must be a string');
		}

		if (!labelConfig || typeof labelConfig !== 'object') {
			throw new Error('Label configuration is required');
		}

		const { name, description = '', color = '#6366f1' } = labelConfig;

		if (!name || typeof name !== 'string') {
			throw new Error('Label name is required and must be a string');
		}

		// Validate color format (hex)
		const hexColorRegex = /^#[0-9a-f]{6}$/i;
		if (!hexColorRegex.test(color)) {
			throw new Error('Label color must be a valid hex color (e.g., #6366f1)');
		}

		try {
			log('debug', `Creating label "${name}" in team ${teamId}...`);

			const createdLabel = await this._retryOperation(async () => {
				const labelCreatePayload = await this.linear.labelCreate({
					teamId,
					name,
					description,
					color
				});

				if (!labelCreatePayload.success) {
					const error = new Error(
						`Failed to create label: ${labelCreatePayload.error || 'Unknown error'}`
					);
					error.code = LABEL_MANAGEMENT_ERRORS.LABEL_CREATE_ERROR;
					throw error;
				}

				return labelCreatePayload.label;
			}, 'create label');

			log(
				'info',
				`Successfully created label "${name}" with ID: ${createdLabel.id}`
			);

			return {
				id: createdLabel.id,
				name: createdLabel.name,
				description: createdLabel.description || '',
				color: createdLabel.color || color,
				createdAt: createdLabel.createdAt,
				isArchived: false
			};
		} catch (error) {
			throw this._enhanceError(error, 'create label');
		}
	}

	/**
	 * Analyze label configuration against existing project labels
	 *
	 * @param {Object} labelSetsConfig - Label sets configuration
	 * @param {Object} projectLabels - Object mapping project ID to labels array
	 * @param {string} teamId - Linear team ID for label creation
	 * @returns {Object} Analysis result with missing labels and recommendations
	 */
	analyzeLabelDelta(labelSetsConfig, projectLabels, teamId) {
		const analysis = {
			teamId,
			enabledCategories: [],
			missingLabels: [],
			existingLabels: [],
			conflicts: [],
			recommendations: [],
			summary: {
				totalRequired: 0,
				totalMissing: 0,
				totalConflicts: 0
			}
		};

		// Get all existing labels across projects (flatten and dedupe by name)
		const allExistingLabels = new Map();
		Object.values(projectLabels).forEach((labels) => {
			labels.forEach((label) => {
				const existingLabel = allExistingLabels.get(label.name.toLowerCase());
				if (!existingLabel || label.createdAt > existingLabel.createdAt) {
					allExistingLabels.set(label.name.toLowerCase(), label);
				}
			});
		});

		// Analyze each enabled category
		Object.entries(labelSetsConfig.categories).forEach(
			([categoryKey, category]) => {
				if (!category.enabled) {
					return;
				}

				analysis.enabledCategories.push({
					key: categoryKey,
					name: category.description || categoryKey,
					autoApply: category.autoApply || false,
					labelCount: Object.keys(category.labels).length
				});

				// Check each label in the category
				Object.entries(category.labels).forEach(([labelKey, labelConfig]) => {
					analysis.summary.totalRequired++;

					const existingLabel = allExistingLabels.get(
						labelConfig.name.toLowerCase()
					);

					if (!existingLabel) {
						// Label doesn't exist - needs to be created
						analysis.missingLabels.push({
							categoryKey,
							labelKey,
							config: labelConfig,
							action: 'create'
						});
						analysis.summary.totalMissing++;
					} else {
						// Label exists - check for conflicts
						analysis.existingLabels.push({
							categoryKey,
							labelKey,
							config: labelConfig,
							existing: existingLabel,
							action: 'exists'
						});

						// Check for color conflicts
						if (
							existingLabel.color.toLowerCase() !==
							labelConfig.color.toLowerCase()
						) {
							analysis.conflicts.push({
								type: 'color',
								labelName: labelConfig.name,
								configured: labelConfig.color,
								existing: existingLabel.color,
								recommendation: 'Use existing color or update configuration'
							});
							analysis.summary.totalConflicts++;
						}

						// Check for description conflicts
						if (
							labelConfig.description &&
							existingLabel.description !== labelConfig.description
						) {
							analysis.conflicts.push({
								type: 'description',
								labelName: labelConfig.name,
								configured: labelConfig.description,
								existing: existingLabel.description,
								recommendation:
									'Consider updating label description manually in Linear'
							});
							analysis.summary.totalConflicts++;
						}
					}
				});
			}
		);

		// Generate recommendations
		if (analysis.summary.totalMissing > 0) {
			analysis.recommendations.push({
				type: 'create_labels',
				message: `Create ${analysis.summary.totalMissing} missing label(s) to complete configuration`,
				priority: 'high'
			});
		}

		if (analysis.summary.totalConflicts > 0) {
			analysis.recommendations.push({
				type: 'resolve_conflicts',
				message: `Resolve ${analysis.summary.totalConflicts} configuration conflict(s) for consistency`,
				priority: 'medium'
			});
		}

		if (analysis.enabledCategories.length === 0) {
			analysis.recommendations.push({
				type: 'enable_categories',
				message:
					'No label categories are enabled. Consider enabling "core" and "types" categories',
				priority: 'low'
			});
		}

		log(
			'debug',
			`Label analysis complete: ${analysis.summary.totalMissing} missing, ${analysis.summary.totalConflicts} conflicts`
		);

		return analysis;
	}

	/**
	 * Detect and suggest language labels based on task content
	 *
	 * @param {Object[]} tasks - Array of task objects
	 * @param {Object} labelSetsConfig - Current label sets configuration
	 * @returns {Object} Language detection results and suggestions
	 */
	detectLanguageLabels(tasks, labelSetsConfig) {
		const languageCategory = labelSetsConfig.categories.languages;
		if (
			!languageCategory ||
			!languageCategory.enabled ||
			!languageCategory.autoDetect
		) {
			return {
				enabled: false,
				detected: [],
				suggestions: []
			};
		}

		const detectedLanguages = new Map();
		const taskLanguages = [];

		// Analyze each task for language references
		tasks.forEach((task) => {
			const languages = detectLanguagesFromTask(task);
			languages.forEach((lang) => {
				const key = languageToLabelKey(lang.name);
				if (!detectedLanguages.has(key)) {
					detectedLanguages.set(key, {
						key,
						name: lang.name,
						color: lang.color,
						taskIds: [],
						confidence: 0
					});
				}

				const langInfo = detectedLanguages.get(key);
				langInfo.taskIds.push(task.id);
				langInfo.confidence++;
			});

			if (languages.length > 0) {
				taskLanguages.push({
					taskId: task.id,
					title: task.title,
					languages: languages.map((l) => l.name)
				});
			}
		});

		// Generate suggestions for missing language labels
		const existingLanguageLabels = new Set(
			Object.keys(languageCategory.labels)
		);
		const suggestions = [];

		detectedLanguages.forEach((langInfo, key) => {
			if (!existingLanguageLabels.has(key)) {
				suggestions.push({
					action: 'add',
					categoryKey: 'languages',
					labelKey: key,
					config: {
						name: langInfo.name,
						description: `${langInfo.name} related tasks`,
						color: langInfo.color
					},
					confidence: langInfo.confidence,
					affectedTasks: langInfo.taskIds.length
				});
			}
		});

		return {
			enabled: true,
			detected: Array.from(detectedLanguages.values()),
			suggestions,
			taskLanguages,
			summary: {
				totalLanguagesDetected: detectedLanguages.size,
				totalTasksWithLanguages: taskLanguages.length,
				suggestedAdditions: suggestions.length
			}
		};
	}

	/**
	 * Retry operation with exponential backoff
	 *
	 * @param {Function} operation - Operation to retry
	 * @param {string} operationName - Name for logging
	 * @returns {Promise<any>} Operation result
	 * @private
	 */
	async _retryOperation(operation, operationName) {
		let lastError;

		for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
			try {
				return await operation();
			} catch (error) {
				lastError = error;

				// Don't retry for certain error types
				if (this._isNonRetryableError(error)) {
					break;
				}

				if (attempt < this.config.maxRetries) {
					const delay = this.config.retryDelay * Math.pow(2, attempt - 1);
					log(
						'warn',
						`${operationName} attempt ${attempt} failed, retrying in ${delay}ms: ${error.message}`
					);
					await new Promise((resolve) => setTimeout(resolve, delay));
				}
			}
		}

		throw lastError;
	}

	/**
	 * Check if error should not be retried
	 *
	 * @param {Error} error - Error to check
	 * @returns {boolean} True if non-retryable
	 * @private
	 */
	_isNonRetryableError(error) {
		// Authentication errors should not be retried
		if (error.message?.includes('Authentication') || error.status === 401) {
			return true;
		}

		// Invalid API key format
		if (error.message?.includes('API key')) {
			return true;
		}

		// Project access errors are not retryable
		if (error.code === LABEL_MANAGEMENT_ERRORS.PROJECT_ACCESS_ERROR) {
			return true;
		}

		// Configuration errors are not retryable
		if (error.code === LABEL_MANAGEMENT_ERRORS.CONFIG_FILE_ERROR) {
			return true;
		}

		// Invalid input errors are not retryable
		if (
			error.message?.includes('must be a valid UUID') ||
			error.message?.includes('is required and must be')
		) {
			return true;
		}

		return false;
	}

	/**
	 * Enhance error with additional context and error codes
	 *
	 * @param {Error} error - Original error
	 * @param {string} operation - Operation that failed
	 * @returns {Error} Enhanced error
	 * @private
	 */
	_enhanceError(error, operation) {
		// Preserve existing enhanced errors
		if (
			error.code &&
			Object.values(LABEL_MANAGEMENT_ERRORS).includes(error.code)
		) {
			return error;
		}

		const enhancedError = new Error(`Failed to ${operation}: ${error.message}`);
		enhancedError.originalError = error;

		// Classify error types
		if (error.message?.includes('Authentication') || error.status === 401) {
			enhancedError.code = LABEL_MANAGEMENT_ERRORS.AUTHENTICATION_ERROR;
		} else if (error.message?.includes('rate limit') || error.status === 429) {
			enhancedError.code = LABEL_MANAGEMENT_ERRORS.RATE_LIMIT;
		} else if (
			error.message?.includes('Network') ||
			error.code === 'ECONNRESET' ||
			error.code === 'ENOTFOUND'
		) {
			enhancedError.code = LABEL_MANAGEMENT_ERRORS.NETWORK_ERROR;
		} else if (
			error.message?.includes('Project not found') ||
			error.message?.includes('access denied')
		) {
			enhancedError.code = LABEL_MANAGEMENT_ERRORS.PROJECT_ACCESS_ERROR;
		} else if (error.code === LABEL_MANAGEMENT_ERRORS.LABEL_CREATE_ERROR) {
			enhancedError.code = LABEL_MANAGEMENT_ERRORS.LABEL_CREATE_ERROR;
		} else if (operation.includes('config')) {
			enhancedError.code = LABEL_MANAGEMENT_ERRORS.CONFIG_FILE_ERROR;
		} else {
			enhancedError.code = LABEL_MANAGEMENT_ERRORS.API_ERROR;
		}

		return enhancedError;
	}
}

/**
 * Convenience function to create and use label manager
 *
 * @param {string} apiKey - Linear API key
 * @param {string} projectRoot - TaskMaster project root directory
 * @param {Object} options - Additional options
 * @returns {LinearLabelManager} Label manager instance
 */
export function createLabelManager(apiKey, projectRoot, options = {}) {
	return new LinearLabelManager({ apiKey, projectRoot, ...options });
}

/**
 * Convenience function to analyze labels for projects
 *
 * @param {string} apiKey - Linear API key
 * @param {string} projectRoot - TaskMaster project root directory
 * @param {string[]} projectIds - Array of Linear project IDs
 * @param {string} teamId - Linear team ID
 * @returns {Promise<Object>} Label analysis result
 */
export async function analyzeLabelConfiguration(
	apiKey,
	projectRoot,
	projectIds,
	teamId
) {
	const manager = createLabelManager(apiKey, projectRoot);
	const labelSetsConfig = manager.loadLabelSetsConfig();
	const projectLabels = await manager.fetchMultipleProjectLabels(projectIds);
	return manager.analyzeLabelDelta(labelSetsConfig, projectLabels, teamId);
}
