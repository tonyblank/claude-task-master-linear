/**
 * @fileoverview MCP Tool for refreshing Linear workspace state mappings
 *
 * This tool provides functionality to refresh and validate Linear workflow state mappings,
 * detect changes in the Linear workspace, and update cached mappings as needed.
 * Implements the state mapping refresh mechanism for Task 6.8.
 */

import {
	refreshWorkflowStatesCache,
	detectMappingRefreshNeeds,
	getCurrentMappingConfiguration
} from '../../../scripts/modules/linear-status-mapping-manager.js';
import { normalizeProjectRoot } from './utils.js';

/**
 * MCP Tool definition for refreshing Linear workspace state mappings
 */
export const refreshLinearMappingsTool = {
	name: 'refresh_linear_mappings',
	description:
		'Refresh Linear workspace state mappings and detect changes in workflow states',
	inputSchema: {
		type: 'object',
		properties: {
			projectRoot: {
				type: 'string',
				description:
					'Absolute path to the project root directory (optional, defaults to /app for MCP)'
			},
			teamId: {
				type: 'string',
				description:
					'Specific Linear team ID to refresh (optional, uses configured team)'
			},
			operation: {
				type: 'string',
				enum: ['detect', 'refresh', 'validate'],
				description:
					'Operation to perform: detect needs, refresh mappings, or validate only',
				default: 'detect'
			},
			forceRefresh: {
				type: 'boolean',
				description: 'Force refresh even if cache is valid (default: false)',
				default: false
			},
			updateMappings: {
				type: 'boolean',
				description:
					'Update mappings if safe changes are detected (default: true)',
				default: true
			},
			cacheMaxAge: {
				type: 'number',
				description: 'Maximum cache age in minutes for detection (default: 60)',
				default: 60
			}
		},
		required: []
	}
};

/**
 * Register the refresh Linear mappings tool with the MCP server
 * @param {object} server - FastMCP server instance
 */
export function registerRefreshLinearMappingsTool(server) {
	server.addTool(refreshLinearMappingsTool, handleRefreshLinearMappings);
}

/**
 * Handler function for the refresh Linear mappings tool
 * @param {object} args - Tool arguments
 * @returns {Promise<object>} Tool result
 */
export async function handleRefreshLinearMappings(args) {
	const {
		projectRoot: inputProjectRoot,
		teamId,
		operation = 'detect',
		forceRefresh = false,
		updateMappings = true,
		cacheMaxAge = 60
	} = args;

	try {
		// Normalize project root for MCP environment (defaults to /app)
		const projectRoot = normalizeProjectRoot(inputProjectRoot) || '/app';

		switch (operation) {
			case 'detect':
				return await handleDetectOperation(projectRoot, teamId, cacheMaxAge);

			case 'refresh':
				return await handleRefreshOperation(
					projectRoot,
					teamId,
					forceRefresh,
					updateMappings
				);

			case 'validate':
				return await handleValidateOperation(projectRoot, teamId);

			default:
				return {
					success: false,
					error: `Unknown operation: ${operation}. Must be 'detect', 'refresh', or 'validate'.`
				};
		}
	} catch (error) {
		return {
			success: false,
			error: `Refresh Linear mappings failed: ${error.message}`,
			details: {
				operation,
				projectRoot: inputProjectRoot,
				teamId
			}
		};
	}
}

/**
 * Handle detection operation - check if refresh is needed
 * @param {string} projectRoot - Project root path
 * @param {string|null} teamId - Optional team ID
 * @param {number} cacheMaxAge - Cache max age in minutes
 * @returns {Promise<object>} Detection result
 */
async function handleDetectOperation(projectRoot, teamId, cacheMaxAge) {
	const detection = await detectMappingRefreshNeeds({
		projectRoot,
		teamId,
		cacheMaxAge
	});

	if (detection.error) {
		return {
			success: false,
			error: detection.error,
			operation: 'detect'
		};
	}

	return {
		success: true,
		operation: 'detect',
		refreshNeeded: detection.refreshNeeded,
		reasons: detection.reasons,
		recommendations: detection.recommendations,
		cacheStatus: detection.cacheStatus,
		nextSuggestedRefresh: detection.nextSuggestedRefresh,
		summary: detection.refreshNeeded
			? `Refresh needed: ${detection.reasons.join(', ')}`
			: 'No immediate refresh needed',
		details: {
			projectRoot,
			teamId: teamId || 'from config',
			cacheMaxAge
		}
	};
}

/**
 * Handle refresh operation - perform actual refresh
 * @param {string} projectRoot - Project root path
 * @param {string|null} teamId - Optional team ID
 * @param {boolean} forceRefresh - Force refresh flag
 * @param {boolean} updateMappings - Update mappings flag
 * @returns {Promise<object>} Refresh result
 */
async function handleRefreshOperation(
	projectRoot,
	teamId,
	forceRefresh,
	updateMappings
) {
	const refreshResult = await refreshWorkflowStatesCache({
		projectRoot,
		teamId,
		forceRefresh,
		updateMappings,
		validateOnly: false
	});

	if (!refreshResult.success) {
		return {
			success: false,
			error: refreshResult.error,
			operation: 'refresh',
			teamId: refreshResult.teamId
		};
	}

	// Prepare summary based on what happened
	let summary = `Refresh completed for team ${refreshResult.teamId}`;
	if (refreshResult.changeAnalysis.changesDetected) {
		const changes = refreshResult.changeAnalysis;
		summary += ` - ${changes.breakingChanges.length} breaking changes, ${changes.safeMappingUpdates.length} safe updates`;
	} else {
		summary += ' - No changes detected';
	}

	return {
		success: true,
		operation: 'refresh',
		teamId: refreshResult.teamId,
		refreshedAt: refreshResult.refreshedAt,
		changesDetected: refreshResult.changeAnalysis.changesDetected,
		mappingsUpdated: refreshResult.mappingsUpdated,
		notifications: refreshResult.notifications,
		summary,
		details: {
			forceRefresh,
			updateMappings,
			currentStatesCount: refreshResult.currentStatesCount,
			changeAnalysis: refreshResult.changeAnalysis,
			updatedMappings: refreshResult.updatedMappings || []
		}
	};
}

/**
 * Handle validate operation - validate without updating
 * @param {string} projectRoot - Project root path
 * @param {string|null} teamId - Optional team ID
 * @returns {Promise<object>} Validation result
 */
async function handleValidateOperation(projectRoot, teamId) {
	const validationResult = await refreshWorkflowStatesCache({
		projectRoot,
		teamId,
		forceRefresh: false,
		updateMappings: false,
		validateOnly: true
	});

	if (!validationResult.success) {
		return {
			success: false,
			error: validationResult.error,
			operation: 'validate',
			teamId: validationResult.teamId
		};
	}

	// Get current configuration for additional context
	const currentConfig = getCurrentMappingConfiguration(projectRoot);

	const issues = validationResult.changeAnalysis.breakingChanges.length;
	const warnings =
		validationResult.changeAnalysis.safeMappingUpdates.length +
		validationResult.changeAnalysis.newStatesFound.length;

	const summary =
		issues > 0
			? `Validation found ${issues} critical issues and ${warnings} warnings`
			: warnings > 0
				? `Validation passed with ${warnings} minor warnings`
				: 'Validation passed - all mappings are current';

	return {
		success: true,
		operation: 'validate',
		teamId: validationResult.teamId,
		validatedAt: validationResult.refreshedAt,
		configurationHealth: currentConfig.isFullyConfigured
			? 'complete'
			: 'incomplete',
		mappingType: currentConfig.effective.type,
		summary,
		issues: {
			critical: validationResult.changeAnalysis.breakingChanges,
			warnings: [
				...validationResult.changeAnalysis.safeMappingUpdates,
				...validationResult.changeAnalysis.newStatesFound.map((state) => ({
					type: 'new_state_available',
					message: `New Linear state "${state.name}" (${state.type}) is available`,
					uuid: state.uuid,
					action: 'Consider mapping this state to a TaskMaster status'
				}))
			]
		},
		details: {
			currentStatesCount: validationResult.currentStatesCount,
			configuredMappings: currentConfig.effective.count,
			changeAnalysis: validationResult.changeAnalysis
		}
	};
}
