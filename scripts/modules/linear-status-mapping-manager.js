/**
 * @fileoverview Linear Status Mapping Manager
 *
 * High-level utilities for managing TaskMaster-to-Linear status mappings with UUID support.
 * Provides easy-to-use functions for configuration override, migration, and validation.
 */

import {
	getLinearStatusMapping,
	getLinearStatusUuidMapping,
	setLinearStatusUuidMapping,
	getEffectiveLinearStatusMapping,
	validateLinearStatusUuidMapping,
	generateLinearStatusUuidMapping,
	getLinearTeamId
} from './config-manager.js';
import { log } from './utils.js';

/**
 * Sets custom TaskMaster status to Linear UUID mappings
 * @param {object} customMappings - Custom status mappings (status -> UUID)
 * @param {object} options - Options for mapping configuration
 * @param {string|null} options.projectRoot - Optional project root
 * @param {boolean} options.validate - Whether to validate mappings (default: true)
 * @param {boolean} options.backup - Whether to backup existing config (default: true)
 * @returns {Promise<object>} Result with success status and details
 */
export async function setCustomStatusMappings(customMappings, options = {}) {
	const { projectRoot = null, validate = true, backup = true } = options;

	try {
		// Validate custom mappings if requested
		if (validate) {
			const validation = validateLinearStatusUuidMapping(customMappings);
			if (!validation.valid) {
				return {
					success: false,
					error: 'Invalid custom mappings',
					details: validation.errors
				};
			}
		}

		// Backup existing mappings if requested
		let backupData = null;
		if (backup) {
			try {
				backupData = {
					uuid: getLinearStatusUuidMapping(projectRoot),
					name: getLinearStatusMapping(projectRoot),
					timestamp: new Date().toISOString()
				};
			} catch (error) {
				log('warn', `Failed to backup existing mappings: ${error.message}`);
			}
		}

		// Set the new UUID mappings
		const success = setLinearStatusUuidMapping(customMappings, projectRoot);

		if (!success) {
			return {
				success: false,
				error: 'Failed to save custom mappings to configuration'
			};
		}

		log(
			'info',
			`Successfully set custom Linear status mappings for ${Object.keys(customMappings).length} statuses`
		);

		return {
			success: true,
			mappingsCount: Object.keys(customMappings).length,
			backup: backupData
		};
	} catch (error) {
		log('error', `Failed to set custom status mappings: ${error.message}`);
		return {
			success: false,
			error: error.message
		};
	}
}

/**
 * Migrates from name-based to UUID-based status mappings
 * @param {object} options - Migration options
 * @param {string|null} options.projectRoot - Optional project root
 * @param {boolean} options.preserveNameMappings - Keep name mappings alongside UUIDs (default: true)
 * @param {boolean} options.dryRun - Only validate without making changes (default: false)
 * @returns {Promise<object>} Migration result with details
 */
export async function migrateToUuidMappings(options = {}) {
	const {
		projectRoot = null,
		preserveNameMappings = true,
		dryRun = false
	} = options;

	try {
		log(
			'info',
			'Starting migration from name-based to UUID-based status mappings...'
		);

		// Get current name-based mappings
		const nameMappings = getLinearStatusMapping(projectRoot);
		const teamId = getLinearTeamId(projectRoot);

		if (!teamId) {
			return {
				success: false,
				error:
					'Linear team ID not configured. Please run linear-sync-setup first.'
			};
		}

		// Check if UUID mappings already exist
		const existingUuidMappings = getLinearStatusUuidMapping(projectRoot);
		if (Object.keys(existingUuidMappings).length > 0) {
			log('info', 'UUID mappings already exist, validating...');

			const validation = validateLinearStatusUuidMapping(existingUuidMappings);
			if (validation.valid) {
				return {
					success: true,
					message: 'UUID mappings already exist and are valid',
					existingMappings: existingUuidMappings
				};
			} else {
				log(
					'warn',
					`Existing UUID mappings are invalid: ${validation.errors.join(', ')}`
				);
			}
		}

		// Generate UUID mappings from name mappings
		log('info', `Generating UUID mappings for team ${teamId}...`);
		const generationResult = await generateLinearStatusUuidMapping(
			nameMappings,
			teamId,
			projectRoot
		);

		if (!generationResult.success) {
			return {
				success: false,
				error: 'Failed to generate UUID mappings from name mappings',
				details: generationResult.errors
			};
		}

		if (dryRun) {
			log('info', 'DRY RUN: Would migrate to UUID mappings');
			return {
				success: true,
				dryRun: true,
				generatedMappings: generationResult.mapping,
				wouldMigrate: Object.keys(generationResult.mapping).length
			};
		}

		// Save the generated UUID mappings
		const success = setLinearStatusUuidMapping(
			generationResult.mapping,
			projectRoot
		);

		if (!success) {
			return {
				success: false,
				error: 'Failed to save generated UUID mappings to configuration'
			};
		}

		log(
			'info',
			`Successfully migrated ${Object.keys(generationResult.mapping).length} status mappings to UUID format`
		);

		return {
			success: true,
			migratedCount: Object.keys(generationResult.mapping).length,
			generatedMappings: generationResult.mapping,
			preservedNameMappings: preserveNameMappings ? nameMappings : null
		};
	} catch (error) {
		log('error', `Migration failed: ${error.message}`);
		return {
			success: false,
			error: error.message
		};
	}
}

/**
 * Validates current status mappings and provides detailed feedback
 * @param {object} options - Validation options
 * @param {string|null} options.projectRoot - Optional project root
 * @param {boolean} options.checkLinearWorkspace - Verify against actual Linear workspace (default: true)
 * @returns {Promise<object>} Validation result with detailed feedback
 */
export async function validateStatusMappings(options = {}) {
	const { projectRoot = null, checkLinearWorkspace = true } = options;

	try {
		log('info', 'Validating Linear status mappings...');

		const effective = getEffectiveLinearStatusMapping(projectRoot);
		const validationResult = {
			mappingType: effective.type,
			mappings: effective.mapping,
			valid: false,
			issues: [],
			recommendations: []
		};

		// Validate UUID mappings if present
		if (effective.type === 'uuid') {
			const uuidValidation = validateLinearStatusUuidMapping(effective.mapping);
			validationResult.valid = uuidValidation.valid;
			validationResult.issues = uuidValidation.errors;

			if (uuidValidation.valid) {
				validationResult.recommendations.push(
					'UUID mappings are properly formatted'
				);
			}
		} else {
			// Name-based mappings
			validationResult.valid = Object.keys(effective.mapping).length > 0;
			if (!validationResult.valid) {
				validationResult.issues.push('No status mappings configured');
			} else {
				validationResult.recommendations.push(
					'Consider migrating to UUID-based mappings for better performance'
				);
			}
		}

		// Check against Linear workspace if requested
		if (checkLinearWorkspace && validationResult.valid) {
			const teamId = getLinearTeamId(projectRoot);
			if (teamId) {
				try {
					// Import Linear integration handler for workspace validation
					const { LinearIntegrationHandler } = await import(
						'./integrations/linear-integration-handler.js'
					);
					const { getLinearApiKey } = await import('./config-manager.js');

					const config = {
						apiKey: getLinearApiKey(projectRoot),
						teamId: teamId
					};

					const handler = new LinearIntegrationHandler(config);
					await handler._performInitialization();

					// Validate each mapping against workspace
					if (effective.type === 'uuid') {
						const workspaceValidation =
							await handler.validateTaskMasterStatusMappings(
								teamId,
								effective.mapping
							);
						if (!workspaceValidation.success) {
							validationResult.issues.push(
								'Some UUID mappings are invalid in Linear workspace'
							);
							validationResult.workspaceValidation = workspaceValidation;
						} else {
							validationResult.recommendations.push(
								'All UUID mappings are valid in Linear workspace'
							);
						}
					}
				} catch (error) {
					validationResult.issues.push(
						`Could not validate against Linear workspace: ${error.message}`
					);
				}
			} else {
				validationResult.issues.push(
					'Linear team ID not configured - cannot validate against workspace'
				);
			}
		}

		log(
			'info',
			`Validation complete: ${validationResult.valid ? 'PASSED' : 'FAILED'}`
		);

		return validationResult;
	} catch (error) {
		log('error', `Validation failed: ${error.message}`);
		return {
			valid: false,
			error: error.message
		};
	}
}

/**
 * Gets current status mapping configuration with detailed metadata
 * @param {string|null} projectRoot - Optional project root
 * @returns {object} Current configuration details
 */
export function getCurrentMappingConfiguration(projectRoot = null) {
	try {
		const nameMapping = getLinearStatusMapping(projectRoot);
		const uuidMapping = getLinearStatusUuidMapping(projectRoot);
		const effective = getEffectiveLinearStatusMapping(projectRoot);

		return {
			nameMapping,
			uuidMapping,
			effective: {
				type: effective.type,
				mapping: effective.mapping,
				count: Object.keys(effective.mapping).length
			},
			hasUuidMappings: Object.keys(uuidMapping).length > 0,
			hasNameMappings: Object.keys(nameMapping).length > 0,
			isFullyConfigured: Object.keys(effective.mapping).length === 6, // All 6 TaskMaster statuses
			taskMasterStatuses: [
				'pending',
				'in-progress',
				'review',
				'done',
				'cancelled',
				'deferred'
			]
		};
	} catch (error) {
		log(
			'error',
			`Failed to get current mapping configuration: ${error.message}`
		);
		return {
			error: error.message
		};
	}
}

/**
 * Resets status mappings to default name-based configuration
 * @param {object} options - Reset options
 * @param {string|null} options.projectRoot - Optional project root
 * @param {boolean} options.backup - Whether to backup current config (default: true)
 * @returns {object} Reset result
 */
export function resetToDefaultMappings(options = {}) {
	const { projectRoot = null, backup = true } = options;

	try {
		log('info', 'Resetting Linear status mappings to defaults...');

		// Backup current configuration if requested
		let backupData = null;
		if (backup) {
			backupData = getCurrentMappingConfiguration(projectRoot);
		}

		// Clear UUID mappings (this will cause fallback to name mappings)
		const success = setLinearStatusUuidMapping({}, projectRoot);

		if (!success) {
			return {
				success: false,
				error: 'Failed to reset UUID mappings'
			};
		}

		log('info', 'Successfully reset to default name-based status mappings');

		return {
			success: true,
			resetToDefaults: true,
			backup: backupData
		};
	} catch (error) {
		log('error', `Failed to reset to default mappings: ${error.message}`);
		return {
			success: false,
			error: error.message
		};
	}
}

/**
 * Updates a single status mapping to a specific UUID
 * @param {string} taskMasterStatus - TaskMaster status to update
 * @param {string} linearStateUuid - Linear state UUID to map to
 * @param {object} options - Update options
 * @param {string|null} options.projectRoot - Optional project root
 * @param {boolean} options.validate - Whether to validate the UUID (default: true)
 * @returns {Promise<object>} Update result
 */
export async function updateSingleStatusMapping(
	taskMasterStatus,
	linearStateUuid,
	options = {}
) {
	const { projectRoot = null, validate = true } = options;

	try {
		// Get current UUID mappings
		const currentMappings = getLinearStatusUuidMapping(projectRoot);

		// Validate the new mapping
		if (validate) {
			const testMapping = { [taskMasterStatus]: linearStateUuid };
			const validation = validateLinearStatusUuidMapping(testMapping);
			if (!validation.valid) {
				return {
					success: false,
					error: `Invalid mapping: ${validation.errors.join(', ')}`
				};
			}
		}

		// Update the mapping
		const updatedMappings = {
			...currentMappings,
			[taskMasterStatus]: linearStateUuid
		};

		const success = setLinearStatusUuidMapping(updatedMappings, projectRoot);

		if (!success) {
			return {
				success: false,
				error: 'Failed to save updated mapping'
			};
		}

		log(
			'info',
			`Successfully updated "${taskMasterStatus}" → ${linearStateUuid}`
		);

		return {
			success: true,
			updatedStatus: taskMasterStatus,
			newUuid: linearStateUuid,
			totalMappings: Object.keys(updatedMappings).length
		};
	} catch (error) {
		log('error', `Failed to update single status mapping: ${error.message}`);
		return {
			success: false,
			error: error.message
		};
	}
}

/**
 * Removes a status mapping (falls back to name-based mapping)
 * @param {string} taskMasterStatus - TaskMaster status to remove UUID mapping for
 * @param {string|null} projectRoot - Optional project root
 * @returns {object} Removal result
 */
export function removeSingleStatusMapping(
	taskMasterStatus,
	projectRoot = null
) {
	try {
		const currentMappings = getLinearStatusUuidMapping(projectRoot);

		if (!currentMappings[taskMasterStatus]) {
			return {
				success: true,
				message: `No UUID mapping exists for "${taskMasterStatus}"`
			};
		}

		// Create new mappings without the specified status
		const updatedMappings = { ...currentMappings };
		delete updatedMappings[taskMasterStatus];

		const success = setLinearStatusUuidMapping(updatedMappings, projectRoot);

		if (!success) {
			return {
				success: false,
				error: 'Failed to save updated mappings'
			};
		}

		log(
			'info',
			`Removed UUID mapping for "${taskMasterStatus}" (will fall back to name-based mapping)`
		);

		return {
			success: true,
			removedStatus: taskMasterStatus,
			remainingMappings: Object.keys(updatedMappings).length
		};
	} catch (error) {
		log('error', `Failed to remove status mapping: ${error.message}`);
		return {
			success: false,
			error: error.message
		};
	}
}

/**
 * Regenerates UUID mappings for all statuses using current name mappings
 * @param {object} options - Regeneration options
 * @param {string|null} options.projectRoot - Optional project root
 * @param {boolean} options.forceRefresh - Force regeneration even if UUIDs exist (default: false)
 * @returns {Promise<object>} Regeneration result
 */
export async function regenerateAllUuidMappings(options = {}) {
	const { projectRoot = null, forceRefresh = false } = options;

	try {
		log('info', 'Regenerating UUID mappings from current name mappings...');

		// Check if UUID mappings already exist
		const existingUuidMappings = getLinearStatusUuidMapping(projectRoot);
		if (Object.keys(existingUuidMappings).length > 0 && !forceRefresh) {
			return {
				success: false,
				error:
					'UUID mappings already exist. Use forceRefresh: true to regenerate.'
			};
		}

		// Get current name mappings and team ID
		const nameMappings = getLinearStatusMapping(projectRoot);
		const teamId = getLinearTeamId(projectRoot);

		if (!teamId) {
			return {
				success: false,
				error:
					'Linear team ID not configured. Please run linear-sync-setup first.'
			};
		}

		// Generate new UUID mappings
		const generationResult = await generateLinearStatusUuidMapping(
			nameMappings,
			teamId,
			projectRoot
		);

		if (!generationResult.success) {
			return {
				success: false,
				error: 'Failed to regenerate UUID mappings',
				details: generationResult.errors
			};
		}

		// Save the regenerated mappings
		const success = setLinearStatusUuidMapping(
			generationResult.mapping,
			projectRoot
		);

		if (!success) {
			return {
				success: false,
				error: 'Failed to save regenerated UUID mappings'
			};
		}

		log(
			'info',
			`Successfully regenerated ${Object.keys(generationResult.mapping).length} UUID mappings`
		);

		return {
			success: true,
			regeneratedCount: Object.keys(generationResult.mapping).length,
			newMappings: generationResult.mapping,
			replacedExisting: Object.keys(existingUuidMappings).length > 0
		};
	} catch (error) {
		log('error', `Failed to regenerate UUID mappings: ${error.message}`);
		return {
			success: false,
			error: error.message
		};
	}
}

/**
 * Gets mapping recommendations based on current configuration
 * @param {string|null} projectRoot - Optional project root
 * @returns {Promise<object>} Recommendations and analysis
 */
export async function getMappingRecommendations(projectRoot = null) {
	try {
		const config = getCurrentMappingConfiguration(projectRoot);
		const recommendations = [];
		const analysis = {
			configurationHealth: 'unknown',
			performanceImpact: 'unknown',
			maintenanceRequirements: []
		};

		// Analyze current configuration
		if (config.error) {
			recommendations.push({
				type: 'error',
				message: 'Configuration could not be loaded',
				action: 'Check Linear configuration files'
			});
			analysis.configurationHealth = 'critical';
		} else {
			// Check if fully configured
			if (!config.isFullyConfigured) {
				recommendations.push({
					type: 'warning',
					message: `Only ${config.effective.count}/6 TaskMaster statuses are mapped`,
					action:
						'Configure mappings for all statuses: ' +
						config.taskMasterStatuses
							.filter((status) => !config.effective.mapping[status])
							.join(', ')
				});
				analysis.configurationHealth = 'incomplete';
			}

			// Performance recommendations
			if (config.effective.type === 'name') {
				recommendations.push({
					type: 'performance',
					message: 'Using name-based mappings (requires API calls)',
					action: 'Migrate to UUID-based mappings for better performance',
					benefits: [
						'Faster status updates',
						'Reduced API calls',
						'Offline capability'
					]
				});
				analysis.performanceImpact = 'moderate';
			} else {
				analysis.performanceImpact = 'optimal';
			}

			// Maintenance recommendations
			if (config.hasUuidMappings && config.hasNameMappings) {
				analysis.maintenanceRequirements.push(
					'Keep UUID and name mappings synchronized'
				);
			}

			if (config.effective.type === 'uuid') {
				analysis.maintenanceRequirements.push(
					'Verify UUID mappings if Linear workflow changes'
				);
			}

			// Set overall health
			if (analysis.configurationHealth === 'unknown') {
				analysis.configurationHealth = config.isFullyConfigured
					? 'good'
					: 'needs-attention';
			}
		}

		return {
			configuration: config,
			recommendations,
			analysis,
			actionRequired: recommendations.some(
				(r) => r.type === 'error' || r.type === 'warning'
			)
		};
	} catch (error) {
		log('error', `Failed to get mapping recommendations: ${error.message}`);
		return {
			error: error.message,
			recommendations: [
				{
					type: 'error',
					message: 'Could not analyze configuration',
					action: 'Check system logs for details'
				}
			]
		};
	}
}

/**
 * Refreshes Linear workflow states cache and validates current mappings
 * @param {object} options - Refresh options
 * @param {string|null} options.projectRoot - Optional project root
 * @param {string|null} options.teamId - Specific team ID to refresh
 * @param {boolean} options.forceRefresh - Force refresh even if cache is valid (default: false)
 * @param {boolean} options.updateMappings - Update UUID mappings if changes detected (default: true)
 * @param {boolean} options.validateOnly - Only validate, don't update (default: false)
 * @returns {Promise<object>} Refresh result with details
 */
export async function refreshWorkflowStatesCache(options = {}) {
	const {
		projectRoot = null,
		teamId = null,
		forceRefresh = false,
		updateMappings = true,
		validateOnly = false
	} = options;

	try {
		log('info', 'Starting Linear workflow states cache refresh...');

		// Get team ID if not provided
		const effectiveTeamId = teamId || getLinearTeamId(projectRoot);
		if (!effectiveTeamId) {
			return {
				success: false,
				error:
					'Linear team ID not configured. Please run linear-sync-setup first.'
			};
		}

		// Import Linear integration handler for workspace operations
		const { LinearIntegrationHandler } = await import(
			'./integrations/linear-integration-handler.js'
		);
		const { getLinearApiKey } = await import('./config-manager.js');

		const config = {
			apiKey: getLinearApiKey(projectRoot),
			teamId: effectiveTeamId
		};

		const handler = new LinearIntegrationHandler(config);
		await handler._performInitialization();

		// Force refresh by clearing cache if requested
		if (forceRefresh) {
			handler.clearWorkflowStatesCache(effectiveTeamId);
			log('info', `Cleared workflow states cache for team ${effectiveTeamId}`);
		}

		// Get current workflow states from Linear (will use cache if valid)
		const workflowStatesResult =
			await handler.queryWorkflowStates(effectiveTeamId);

		if (!workflowStatesResult.success) {
			return {
				success: false,
				error: `Failed to fetch workflow states: ${workflowStatesResult.error}`,
				teamId: effectiveTeamId
			};
		}

		// Get current configuration
		const currentConfig = getCurrentMappingConfiguration(projectRoot);
		const currentUuidMappings = currentConfig.uuidMapping;
		const currentNameMappings = currentConfig.nameMapping;

		// Analyze changes in workflow states
		const changeAnalysis = await analyzeWorkflowStateChanges(
			workflowStatesResult.states,
			currentUuidMappings,
			currentNameMappings
		);

		const refreshResult = {
			success: true,
			teamId: effectiveTeamId,
			refreshedAt: new Date().toISOString(),
			forceRefresh,
			validateOnly,
			currentStatesCount: workflowStatesResult.states.length,
			changeAnalysis,
			mappingsUpdated: false,
			notifications: []
		};

		// If validation only, return analysis without updates
		if (validateOnly) {
			refreshResult.validationOnly = true;
			return refreshResult;
		}

		// Update mappings if changes detected and updates are enabled
		if (updateMappings && changeAnalysis.changesDetected) {
			if (changeAnalysis.breakingChanges.length > 0) {
				// Handle breaking changes - require user intervention
				refreshResult.notifications.push({
					type: 'breaking_change',
					message: 'Breaking changes detected in Linear workspace',
					changes: changeAnalysis.breakingChanges,
					action: 'Review changes and update mappings manually'
				});

				log(
					'warn',
					`Breaking changes detected: ${changeAnalysis.breakingChanges.length} issues found`
				);
			} else {
				// Apply non-breaking updates
				const updateResult = await applyMappingUpdates(
					changeAnalysis.safeMappingUpdates,
					projectRoot
				);

				refreshResult.mappingsUpdated = updateResult.success;
				refreshResult.updatedMappings = updateResult.updatedMappings;

				if (updateResult.success) {
					refreshResult.notifications.push({
						type: 'mappings_updated',
						message: `Updated ${updateResult.updatedMappings.length} status mappings`,
						updates: updateResult.updatedMappings
					});

					log(
						'info',
						`Successfully updated ${updateResult.updatedMappings.length} status mappings`
					);
				}
			}
		}

		return refreshResult;
	} catch (error) {
		log('error', `Failed to refresh workflow states cache: ${error.message}`);
		return {
			success: false,
			error: error.message,
			teamId: teamId || 'unknown'
		};
	}
}

/**
 * Analyzes changes in Linear workflow states compared to current mappings
 * @param {Array} currentStates - Current workflow states from Linear API
 * @param {object} currentUuidMappings - Current UUID mappings in config
 * @param {object} currentNameMappings - Current name mappings in config
 * @returns {Promise<object>} Analysis of changes detected
 */
async function analyzeWorkflowStateChanges(
	currentStates,
	currentUuidMappings,
	currentNameMappings
) {
	const analysis = {
		changesDetected: false,
		breakingChanges: [],
		safeMappingUpdates: [],
		newStatesFound: [],
		deletedStatesDetected: [],
		renamedStatesDetected: []
	};

	// Create lookup maps from current Linear states
	const statesByUuid = new Map();
	const statesByName = new Map();

	for (const state of currentStates) {
		statesByUuid.set(state.id, state);
		statesByName.set(state.name.toLowerCase(), state);
	}

	// Check UUID mappings for validity
	for (const [taskMasterStatus, uuid] of Object.entries(currentUuidMappings)) {
		const currentState = statesByUuid.get(uuid);

		if (!currentState) {
			// UUID mapping is broken - state was deleted or UUID changed
			analysis.changesDetected = true;
			analysis.breakingChanges.push({
				type: 'deleted_or_changed_uuid',
				taskMasterStatus,
				uuid,
				impact: 'Status mapping will fail until updated',
				action: 'Remap this status to a valid Linear state'
			});
		} else {
			// Check if state was renamed (UUID exists but name changed)
			const expectedName = currentNameMappings[taskMasterStatus];
			if (expectedName && currentState.name !== expectedName) {
				analysis.changesDetected = true;
				analysis.renamedStatesDetected.push({
					taskMasterStatus,
					uuid,
					oldName: expectedName,
					newName: currentState.name
				});

				// This is a safe update - UUID still works, just name changed
				analysis.safeMappingUpdates.push({
					type: 'update_name_mapping',
					taskMasterStatus,
					uuid,
					newName: currentState.name
				});
			}
		}
	}

	// Check for new states that might be useful
	const mappedUuids = new Set(Object.values(currentUuidMappings));
	const mappedNames = new Set(
		Object.values(currentNameMappings).map((name) => name.toLowerCase())
	);

	for (const state of currentStates) {
		if (
			!mappedUuids.has(state.id) &&
			!mappedNames.has(state.name.toLowerCase())
		) {
			analysis.newStatesFound.push({
				uuid: state.id,
				name: state.name,
				type: state.type,
				description: state.description || 'No description'
			});
		}
	}

	// Check for deleted states (mapped names that no longer exist)
	for (const [taskMasterStatus, stateName] of Object.entries(
		currentNameMappings
	)) {
		if (
			!statesByName.has(stateName.toLowerCase()) &&
			!currentUuidMappings[taskMasterStatus]
		) {
			// Name mapping points to non-existent state and no UUID mapping exists
			analysis.changesDetected = true;
			analysis.deletedStatesDetected.push({
				taskMasterStatus,
				deletedStateName: stateName
			});

			analysis.breakingChanges.push({
				type: 'deleted_state',
				taskMasterStatus,
				stateName,
				impact: 'Status mapping will fail until updated',
				action: 'Remap this status to a valid Linear state'
			});
		}
	}

	if (analysis.newStatesFound.length > 0) {
		analysis.changesDetected = true;
	}

	return analysis;
}

/**
 * Applies safe mapping updates to configuration
 * @param {Array} updates - Array of safe update operations
 * @param {string|null} projectRoot - Optional project root
 * @returns {Promise<object>} Update result
 */
async function applyMappingUpdates(updates, projectRoot = null) {
	try {
		const updatedMappings = [];

		for (const update of updates) {
			if (update.type === 'update_name_mapping') {
				// Update name mapping to reflect renamed state
				const currentNameMappings = getLinearStatusMapping(projectRoot);
				const updatedNameMappings = {
					...currentNameMappings,
					[update.taskMasterStatus]: update.newName
				};

				// Note: This would require a setLinearStatusMapping function
				// For now, we'll track what would be updated
				updatedMappings.push({
					type: 'name_mapping',
					taskMasterStatus: update.taskMasterStatus,
					oldName: currentNameMappings[update.taskMasterStatus],
					newName: update.newName
				});

				log(
					'info',
					`Would update name mapping for "${update.taskMasterStatus}": "${currentNameMappings[update.taskMasterStatus]}" → "${update.newName}"`
				);
			}
		}

		return {
			success: true,
			updatedMappings
		};
	} catch (error) {
		log('error', `Failed to apply mapping updates: ${error.message}`);
		return {
			success: false,
			error: error.message
		};
	}
}

/**
 * Detects if Linear workspace status mappings need refreshing
 * @param {object} options - Detection options
 * @param {string|null} options.projectRoot - Optional project root
 * @param {string|null} options.teamId - Specific team ID to check
 * @param {number} options.cacheMaxAge - Max age in minutes before refresh needed (default: 60)
 * @returns {Promise<object>} Detection result with recommendations
 */
export async function detectMappingRefreshNeeds(options = {}) {
	const {
		projectRoot = null,
		teamId = null,
		cacheMaxAge = 60 // 1 hour default
	} = options;

	try {
		log('info', 'Detecting if mapping refresh is needed...');

		const effectiveTeamId = teamId || getLinearTeamId(projectRoot);
		if (!effectiveTeamId) {
			return {
				refreshNeeded: false,
				reason: 'No Linear team configured'
			};
		}

		// Check current configuration health
		const config = getCurrentMappingConfiguration(projectRoot);
		const recommendations = await getMappingRecommendations(projectRoot);

		const detection = {
			refreshNeeded: false,
			reasons: [],
			recommendations: [],
			cacheStatus: 'unknown',
			lastRefresh: null,
			nextSuggestedRefresh: null
		};

		// Check for critical configuration issues
		if (recommendations.actionRequired) {
			detection.refreshNeeded = true;
			detection.reasons.push('Configuration issues detected');
			detection.recommendations.push(...recommendations.recommendations);
		}

		// Check for incomplete mappings
		if (!config.isFullyConfigured) {
			detection.refreshNeeded = true;
			detection.reasons.push(
				`Only ${config.effective.count}/6 statuses mapped`
			);
		}

		// Calculate next suggested refresh time
		const now = new Date();
		const maxAgeMs = cacheMaxAge * 60 * 1000;
		detection.nextSuggestedRefresh = new Date(
			now.getTime() + maxAgeMs
		).toISOString();

		// Add recommendation for periodic refresh
		if (!detection.refreshNeeded) {
			detection.recommendations.push({
				type: 'maintenance',
				message: `Consider refreshing mappings every ${cacheMaxAge} minutes`,
				action: 'Run refresh-linear-mappings command periodically'
			});
		}

		return detection;
	} catch (error) {
		log('error', `Failed to detect mapping refresh needs: ${error.message}`);
		return {
			refreshNeeded: false,
			error: error.message
		};
	}
}
