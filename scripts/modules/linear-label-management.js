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

		this.linearConfigPath = join(
			this.config.projectRoot,
			'.taskmaster',
			'linear-config.json'
		);
	}

	/**
	 * Get the label sets configuration path
	 * @returns {string} Path to the linear config file
	 */
	get labelSetsPath() {
		return this.linearConfigPath;
	}

	/**
	 * Load label sets configuration from file
	 *
	 * @returns {Object} Label sets configuration
	 * @throws {Error} When config file cannot be loaded
	 */
	loadLabelSetsConfig() {
		try {
			if (!existsSync(this.linearConfigPath)) {
				throw new Error(
					`Linear configuration not found at: ${this.linearConfigPath}`
				);
			}

			const configContent = readFileSync(this.linearConfigPath, 'utf8');
			const config = JSON.parse(configContent);

			// Validate basic config structure
			if (
				!config.labels ||
				!config.labels.categories ||
				typeof config.labels.categories !== 'object'
			) {
				throw new Error(
					'Invalid Linear configuration: missing labels.categories'
				);
			}

			log('debug', 'Loaded Linear configuration successfully');

			// Return just the labels portion for backward compatibility
			return {
				categories: config.labels.categories,
				settings: config.sync,
				metadata: config.metadata
			};
		} catch (error) {
			const enhancedError = new Error(
				`Failed to load Linear config: ${error.message}`
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
			// Read the full Linear config
			const fullConfig = JSON.parse(
				readFileSync(this.linearConfigPath, 'utf8')
			);

			// Update labels section with new data
			fullConfig.labels.categories = config.categories;
			if (config.settings) {
				fullConfig.sync = { ...fullConfig.sync, ...config.settings };
			}

			// Update metadata
			fullConfig.metadata = {
				...fullConfig.metadata,
				lastUpdated: new Date().toISOString(),
				version: fullConfig.metadata?.version || '1.0.0'
			};
			if (config.metadata) {
				fullConfig.metadata = { ...fullConfig.metadata, ...config.metadata };
			}

			const configContent = JSON.stringify(fullConfig, null, 2);
			writeFileSync(this.linearConfigPath, configContent, 'utf8');

			log('info', 'Saved Linear configuration successfully');
		} catch (error) {
			const enhancedError = new Error(
				`Failed to save Linear config: ${error.message}`
			);
			enhancedError.code = LABEL_MANAGEMENT_ERRORS.CONFIG_FILE_ERROR;
			enhancedError.originalError = error;
			throw enhancedError;
		}
	}

	/**
	 * Fetch all labels from a Linear project via its team
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
				// Get the project first to verify access and get team info
				const project = await this.linear.project(projectId);

				if (!project) {
					const error = new Error(
						`Project not found or access denied: ${projectId}`
					);
					error.code = LABEL_MANAGEMENT_ERRORS.PROJECT_ACCESS_ERROR;
					throw error;
				}

				// Get the team that owns this project to access its labels
				const team = await project.team;
				if (!team) {
					const error = new Error(
						`Cannot access team for project: ${projectId}`
					);
					error.code = LABEL_MANAGEMENT_ERRORS.PROJECT_ACCESS_ERROR;
					throw error;
				}

				// NOTE: In Linear, labels are owned by teams, not individual projects.
				// This design ensures label consistency across all projects within a team
				// and prevents label fragmentation. All labels we create or manage are
				// attached at the team level and available to all team projects.
				const labelsConnection = await team.labels({
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
	 * Fetch comprehensive labels from all teams in the organization
	 * This provides a complete picture of all available labels for conflict detection and sync
	 *
	 * @returns {Promise<Object>} Object with teamLabels (by team ID) and allUniqueLabels (deduplicated)
	 * @throws {Error} When API request fails
	 */
	async fetchOrganizationLabels() {
		try {
			log('debug', 'Fetching comprehensive labels from all teams...');

			// Use retry logic for robust fetching
			const result = await this._retryOperation(async () => {
				// Fetch all teams user has access to
				const teamsConnection = await this.linear.teams({
					first: this.config.pageSize,
					includeArchived: false
				});

				const teamLabels = {}; // Map of teamId -> labels array
				const allUniqueLabels = new Map(); // Deduplicated labels by name (case-insensitive)

				// Fetch labels from each team
				for (const team of teamsConnection.nodes) {
					try {
						log('debug', `Fetching labels for team: ${team.name} (${team.id})`);

						const labelsConnection = await team.labels({
							first: this.config.pageSize
						});

						const transformedLabels = labelsConnection.nodes.map((label) => ({
							id: label.id,
							name: label.name,
							description: label.description || '',
							color: label.color || '#6366f1',
							createdAt: label.createdAt,
							updatedAt: label.updatedAt,
							isArchived: label.isArchived || false,
							teamId: team.id,
							teamName: team.name
						}));

						teamLabels[team.id] = transformedLabels;

						// Add to unique labels map (dedupe by name, keep most recent)
						transformedLabels.forEach((label) => {
							const key = label.name.toLowerCase();
							const existing = allUniqueLabels.get(key);

							if (!existing || label.createdAt > existing.createdAt) {
								// Keep track of which teams have this label
								const teamsWithLabel = existing ? existing.teams : [];
								if (!teamsWithLabel.find((t) => t.id === team.id)) {
									teamsWithLabel.push({ id: team.id, name: team.name });
								}

								allUniqueLabels.set(key, {
									...label,
									teams:
										teamsWithLabel.length > 0
											? teamsWithLabel
											: [{ id: team.id, name: team.name }]
								});
							} else {
								// Label exists but is older - just add team to the list
								const current = allUniqueLabels.get(key);
								if (!current.teams.find((t) => t.id === team.id)) {
									current.teams.push({ id: team.id, name: team.name });
								}
							}
						});
					} catch (error) {
						log(
							'warn',
							`Failed to fetch labels for team ${team.name}: ${error.message}`
						);
						teamLabels[team.id] = []; // Set empty array for failed teams
					}
				}

				return {
					teamLabels,
					allUniqueLabels: Array.from(allUniqueLabels.values()),
					teamsCount: teamsConnection.nodes.length
				};
			}, 'fetch organization labels');

			log(
				'info',
				`Successfully fetched labels from ${result.teamsCount} teams, found ${result.allUniqueLabels.length} unique labels`
			);

			return result;
		} catch (error) {
			throw this._enhanceError(error, 'fetch organization labels');
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
	 * NOTE: Linear's GraphQL API does not currently support creating labels via API.
	 * Labels must be created manually through the Linear UI. This method will
	 * throw an informative error to guide users to the correct approach.
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

		// Linear's GraphQL API does not support creating labels programmatically
		// This is a limitation of the Linear API itself, not our implementation
		const error = new Error(
			`Linear API does not support creating labels programmatically. ` +
				`Please create the label "${name}" manually in Linear:\n\n` +
				`1. Go to your Linear team settings\n` +
				`2. Navigate to Labels section\n` +
				`3. Create a new label with:\n` +
				`   - Name: "${name}"\n` +
				`   - Description: "${description}"\n` +
				`   - Color: "${color}"\n\n` +
				`After creating the label manually, run the sync command to detect and store its ID.`
		);
		error.code = LABEL_MANAGEMENT_ERRORS.LABEL_CREATE_ERROR;
		error.isApiLimitation = true;
		error.labelConfig = labelConfig;

		throw error;
	}

	/**
	 * Analyze label configuration against comprehensive organization labels
	 *
	 * @param {Object} labelSetsConfig - Label sets configuration
	 * @param {Array} organizationLabels - Array of all unique labels from organization
	 * @param {string} teamId - Linear team ID for label creation
	 * @returns {Object} Enhanced analysis result with sync state and recommendations
	 */
	analyzeLabelDelta(labelSetsConfig, organizationLabels, teamId) {
		const analysis = {
			teamId,
			enabledCategories: [],
			missingLabels: [],
			existingLabels: [],
			needsSync: [],
			conflicts: [],
			recommendations: [],
			summary: {
				totalRequired: 0,
				totalMissing: 0,
				totalNeedsSync: 0,
				totalConflicts: 0
			}
		};

		// Create lookup map for existing labels (by name, case-insensitive)
		const existingLabelsMap = new Map();
		organizationLabels.forEach((label) => {
			existingLabelsMap.set(label.name.toLowerCase(), label);
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

					const existingLabel = existingLabelsMap.get(
						labelConfig.name.toLowerCase()
					);

					// Check sync state (linearId presence)
					const hasLinearId = Boolean(labelConfig.linearId);
					const needsSync = !hasLinearId && existingLabel;

					if (!existingLabel) {
						// Label doesn't exist in Linear - needs to be created
						analysis.missingLabels.push({
							categoryKey,
							labelKey,
							config: labelConfig,
							action: 'create',
							syncState: hasLinearId ? 'synced' : 'unsynced'
						});
						analysis.summary.totalMissing++;
					} else {
						// Label exists in Linear
						const labelAnalysis = {
							categoryKey,
							labelKey,
							config: labelConfig,
							existing: existingLabel,
							action: 'exists',
							syncState: hasLinearId ? 'synced' : 'unsynced'
						};

						if (needsSync) {
							// Label exists but not synced (missing linearId)
							labelAnalysis.action = 'sync_required';
							analysis.needsSync.push(labelAnalysis);
							analysis.summary.totalNeedsSync++;
						} else {
							analysis.existingLabels.push(labelAnalysis);
						}

						// Check for conflicts (TaskMaster as source of truth)
						if (
							existingLabel.color.toLowerCase() !==
							labelConfig.color.toLowerCase()
						) {
							analysis.conflicts.push({
								type: 'color',
								labelName: labelConfig.name,
								configured: labelConfig.color,
								existing: existingLabel.color,
								existingLinearId: existingLabel.id,
								teams: existingLabel.teams || [],
								recommendation:
									'Update Linear label color to match TaskMaster configuration',
								action: 'update_linear'
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
								existingLinearId: existingLabel.id,
								teams: existingLabel.teams || [],
								recommendation:
									'Update Linear label description to match TaskMaster configuration',
								action: 'update_linear'
							});
							analysis.summary.totalConflicts++;
						}
					}
				});
			}
		);

		// Generate enhanced recommendations
		if (analysis.summary.totalMissing > 0) {
			analysis.recommendations.push({
				type: 'create_labels',
				message: `Create ${analysis.summary.totalMissing} missing label(s) in Linear and store their IDs`,
				priority: 'high',
				command: 'linear-sync-labels'
			});
		}

		if (analysis.summary.totalNeedsSync > 0) {
			analysis.recommendations.push({
				type: 'sync_labels',
				message: `Sync ${analysis.summary.totalNeedsSync} existing label(s) by storing their Linear IDs`,
				priority: 'high',
				command: 'linear-sync-labels'
			});
		}

		if (analysis.summary.totalConflicts > 0) {
			analysis.recommendations.push({
				type: 'resolve_conflicts',
				message: `Update ${analysis.summary.totalConflicts} Linear label(s) to match TaskMaster configuration`,
				priority: 'medium',
				command: 'linear-sync-labels --resolve-conflicts'
			});
		}

		if (analysis.enabledCategories.length === 0) {
			analysis.recommendations.push({
				type: 'enable_categories',
				message:
					'No label categories are enabled. Consider enabling "core" and "types" categories',
				priority: 'low',
				command: 'Edit .taskmaster/config/label-sets.json'
			});
		}

		log(
			'debug',
			`Enhanced label analysis complete: ${analysis.summary.totalMissing} missing, ${analysis.summary.totalNeedsSync} need sync, ${analysis.summary.totalConflicts} conflicts`
		);

		return analysis;
	}

	/**
	 * Sync existing Linear labels by storing their IDs in the config
	 *
	 * @param {Array} labelsToSync - Array of labels that need sync (from analyzeLabelDelta needsSync)
	 * @param {Array} organizationLabels - All organization labels for lookup
	 * @returns {Promise<Object>} Sync results with success/failure counts
	 */
	async syncExistingLabels(labelsToSync, organizationLabels) {
		const results = {
			synced: [],
			failed: [],
			summary: {
				totalProcessed: labelsToSync.length,
				successful: 0,
				failed: 0
			}
		};

		// Create lookup map for organization labels
		const labelsMap = new Map();
		organizationLabels.forEach((label) => {
			labelsMap.set(label.name.toLowerCase(), label);
		});

		// Load current config
		const config = this.loadLabelSetsConfig();

		for (const labelToSync of labelsToSync) {
			try {
				const { categoryKey, labelKey, config: labelConfig } = labelToSync;
				const existingLabel = labelsMap.get(labelConfig.name.toLowerCase());

				if (existingLabel) {
					// Store Linear ID in config
					config.categories[categoryKey].labels[labelKey].linearId =
						existingLabel.id;

					results.synced.push({
						category: categoryKey,
						label: labelKey,
						name: labelConfig.name,
						linearId: existingLabel.id,
						teams: existingLabel.teams || []
					});
					results.summary.successful++;

					log(
						'info',
						`Synced label "${labelConfig.name}" with Linear ID: ${existingLabel.id}`
					);
				} else {
					throw new Error(
						`Label "${labelConfig.name}" not found in organization labels`
					);
				}
			} catch (error) {
				results.failed.push({
					category: labelToSync.categoryKey,
					label: labelToSync.labelKey,
					name: labelToSync.config.name,
					error: error.message
				});
				results.summary.failed++;
				log(
					'error',
					`Failed to sync label "${labelToSync.config.name}": ${error.message}`
				);
			}
		}

		// Save updated config if any labels were synced
		if (results.summary.successful > 0) {
			this.saveLabelSetsConfig(config);
			log(
				'info',
				`Config updated with ${results.summary.successful} synced label IDs`
			);
		}

		return results;
	}

	/**
	 * Create missing labels in Linear and store their IDs
	 *
	 * @param {Array} labelsToCreate - Array of labels that need creation (from analyzeLabelDelta missingLabels)
	 * @param {string} teamId - Linear team ID for label creation
	 * @returns {Promise<Object>} Creation results with success/failure counts
	 */
	async createMissingLabels(labelsToCreate, teamId) {
		const results = {
			created: [],
			failed: [],
			summary: {
				totalProcessed: labelsToCreate.length,
				successful: 0,
				failed: 0
			}
		};

		// Load current config
		const config = this.loadLabelSetsConfig();

		for (const labelToCreate of labelsToCreate) {
			try {
				const { categoryKey, labelKey, config: labelConfig } = labelToCreate;

				// Create label in Linear
				const createdLabel = await this.createLabel(teamId, {
					name: labelConfig.name,
					description: labelConfig.description || '',
					color: labelConfig.color
				});

				// Store Linear ID in config
				config.categories[categoryKey].labels[labelKey].linearId =
					createdLabel.id;

				results.created.push({
					category: categoryKey,
					label: labelKey,
					name: labelConfig.name,
					linearId: createdLabel.id,
					color: labelConfig.color
				});
				results.summary.successful++;

				log(
					'info',
					`Created and synced label "${labelConfig.name}" with Linear ID: ${createdLabel.id}`
				);
			} catch (error) {
				results.failed.push({
					category: labelToCreate.categoryKey,
					label: labelToCreate.labelKey,
					name: labelToCreate.config.name,
					error: error.message
				});
				results.summary.failed++;
				log(
					'error',
					`Failed to create label "${labelToCreate.config.name}": ${error.message}`
				);
			}
		}

		// Save updated config if any labels were created
		if (results.summary.successful > 0) {
			this.saveLabelSetsConfig(config);
			log(
				'info',
				`Config updated with ${results.summary.successful} new label IDs`
			);
		}

		return results;
	}

	/**
	 * Update Linear labels to match TaskMaster configuration (TaskMaster as source of truth)
	 *
	 * @param {Array} conflicts - Array of conflicts from analyzeLabelDelta
	 * @returns {Promise<Object>} Update results with success/failure counts
	 */
	async resolveConflicts(conflicts) {
		const results = {
			updated: [],
			failed: [],
			summary: {
				totalProcessed: conflicts.length,
				successful: 0,
				failed: 0
			}
		};

		for (const conflict of conflicts) {
			try {
				// Note: Linear SDK doesn't provide direct label update methods
				// This would typically require GraphQL mutations or additional API calls
				// For now, log the conflict and recommend manual resolution

				log(
					'warn',
					`Color conflict detected for "${conflict.labelName}": TaskMaster(${conflict.configured}) vs Linear(${conflict.existing})`
				);
				log('info', `Recommendation: ${conflict.recommendation}`);
				log(
					'debug',
					`Linear ID: ${conflict.existingLinearId}, Teams: ${conflict.teams.map((t) => t.name).join(', ')}`
				);

				// TODO: Implement actual Linear label updates when SDK supports it
				// For now, mark as requiring manual resolution
				results.failed.push({
					labelName: conflict.labelName,
					type: conflict.type,
					linearId: conflict.existingLinearId,
					error:
						'Manual resolution required - Linear SDK does not support label updates yet'
				});
				results.summary.failed++;
			} catch (error) {
				results.failed.push({
					labelName: conflict.labelName,
					type: conflict.type,
					error: error.message
				});
				results.summary.failed++;
				log(
					'error',
					`Failed to resolve conflict for "${conflict.labelName}": ${error.message}`
				);
			}
		}

		return results;
	}

	/**
	 * Auto-migrate existing config to include linearId fields
	 *
	 * @param {boolean} userApproval - Whether user has approved the migration
	 * @returns {Promise<Object>} Migration results
	 */
	async migrateConfigToLinearIds(userApproval = false) {
		try {
			const config = this.loadLabelSetsConfig();
			let needsMigration = false;
			let migrationCount = 0;

			// Check if any labels are missing linearId fields
			Object.entries(config.categories).forEach(([categoryKey, category]) => {
				if (category.labels) {
					Object.entries(category.labels).forEach(([labelKey, labelConfig]) => {
						if (
							!Object.prototype.hasOwnProperty.call(labelConfig, 'linearId')
						) {
							needsMigration = true;
							migrationCount++;
						}
					});
				}
			});

			if (!needsMigration) {
				return {
					migrated: false,
					message: 'Config already has linearId fields - no migration needed'
				};
			}

			if (!userApproval) {
				return {
					migrated: false,
					needsApproval: true,
					message: `Config needs migration: ${migrationCount} labels missing linearId fields`,
					migrationCount
				};
			}

			// Perform migration - add linearId: null to all labels
			Object.entries(config.categories).forEach(([categoryKey, category]) => {
				if (category.labels) {
					Object.entries(category.labels).forEach(([labelKey, labelConfig]) => {
						if (
							!Object.prototype.hasOwnProperty.call(labelConfig, 'linearId')
						) {
							labelConfig.linearId = null;
						}
					});
				}
			});

			// Update metadata
			config.metadata = {
				...config.metadata,
				migratedAt: new Date().toISOString(),
				migration: '1.0.0-linearId-support'
			};

			this.saveLabelSetsConfig(config);

			log(
				'info',
				`Successfully migrated ${migrationCount} labels to include linearId fields`
			);

			return {
				migrated: true,
				migrationCount,
				message: `Successfully added linearId fields to ${migrationCount} labels`
			};
		} catch (error) {
			const enhancedError = new Error(
				`Config migration failed: ${error.message}`
			);
			enhancedError.code = LABEL_MANAGEMENT_ERRORS.CONFIG_FILE_ERROR;
			enhancedError.originalError = error;
			throw enhancedError;
		}
	}

	/**
	 * Comprehensive label sync operation
	 *
	 * @param {string} teamId - Linear team ID for label creation
	 * @param {Object} options - Sync options
	 * @param {boolean} options.resolveConflicts - Whether to resolve conflicts
	 * @param {boolean} options.dryRun - Preview changes without applying
	 * @returns {Promise<Object>} Complete sync results
	 */
	async syncLabels(teamId, options = {}) {
		const { resolveConflicts = false, dryRun = false } = options;

		try {
			log('info', 'Starting comprehensive label sync...');

			// 1. Check for config migration
			const migrationResult = await this.migrateConfigToLinearIds(false);
			if (migrationResult.needsApproval) {
				return {
					success: false,
					requiresMigration: true,
					migration: migrationResult
				};
			}

			// 2. Fetch comprehensive organization labels
			const { allUniqueLabels } = await this.fetchOrganizationLabels();

			// 3. Load and analyze current config
			const labelSetsConfig = this.loadLabelSetsConfig();
			const analysis = this.analyzeLabelDelta(
				labelSetsConfig,
				allUniqueLabels,
				teamId
			);

			if (dryRun) {
				return {
					success: true,
					dryRun: true,
					analysis,
					organizationLabels: allUniqueLabels
				};
			}

			// 4. Execute sync operations
			const results = {
				sync: null,
				creation: null,
				conflicts: null,
				analysis
			};

			// Sync existing labels (store Linear IDs)
			if (analysis.needsSync.length > 0) {
				log('info', `Syncing ${analysis.needsSync.length} existing labels...`);
				results.sync = await this.syncExistingLabels(
					analysis.needsSync,
					allUniqueLabels
				);
			}

			// Create missing labels
			if (analysis.missingLabels.length > 0) {
				log(
					'info',
					`Creating ${analysis.missingLabels.length} missing labels...`
				);
				results.creation = await this.createMissingLabels(
					analysis.missingLabels,
					teamId
				);
			}

			// Resolve conflicts if requested
			if (resolveConflicts && analysis.conflicts.length > 0) {
				log('info', `Resolving ${analysis.conflicts.length} conflicts...`);
				results.conflicts = await this.resolveConflicts(analysis.conflicts);
			}

			log('info', 'Label sync completed successfully');

			return {
				success: true,
				results,
				summary: {
					synced: results.sync?.summary.successful || 0,
					created: results.creation?.summary.successful || 0,
					conflictsResolved: results.conflicts?.summary.successful || 0,
					failed:
						(results.sync?.summary.failed || 0) +
						(results.creation?.summary.failed || 0) +
						(results.conflicts?.summary.failed || 0)
				}
			};
		} catch (error) {
			log('error', `Label sync failed: ${error.message}`);
			throw this._enhanceError(error, 'sync labels');
		}
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
					const delay = this.config.retryDelay * 2 ** (attempt - 1);
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
 * Convenience function to analyze labels comprehensively across organization
 *
 * @param {string} apiKey - Linear API key
 * @param {string} projectRoot - TaskMaster project root directory
 * @param {string} teamId - Linear team ID for label creation
 * @returns {Promise<Object>} Enhanced label analysis result
 */
export async function analyzeLabelConfiguration(apiKey, projectRoot, teamId) {
	const manager = createLabelManager(apiKey, projectRoot);
	const labelSetsConfig = manager.loadLabelSetsConfig();
	const { allUniqueLabels } = await manager.fetchOrganizationLabels();
	return manager.analyzeLabelDelta(labelSetsConfig, allUniqueLabels, teamId);
}

/**
 * Convenience function for comprehensive label sync
 *
 * @param {string} apiKey - Linear API key
 * @param {string} projectRoot - TaskMaster project root directory
 * @param {string} teamId - Linear team ID for label creation
 * @param {Object} options - Sync options
 * @returns {Promise<Object>} Complete sync results
 */
export async function syncLinearLabels(
	apiKey,
	projectRoot,
	teamId,
	options = {}
) {
	const manager = createLabelManager(apiKey, projectRoot);
	return manager.syncLabels(teamId, options);
}
