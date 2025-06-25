/**
 * @fileoverview Linear Project Selection Module
 *
 * This module provides functionality to fetch available projects from Linear API
 * for a specific team and present them as selectable options to the user.
 *
 * Architecture Note:
 * Linear Projects map to TaskMaster's .taskmaster/tasks structure where:
 * - Project = Top-level container (maps to .taskmaster/tasks directory)
 * - Top-level tasks = Linear issues under the project
 * - Subtasks = Linear sub-issues (linked to parent issues)
 */

import { LinearClient } from '@linear/sdk';
import { log } from './utils.js';
import { promptConfigs, messages } from './prompts.js';
import inquirer from 'inquirer';

/**
 * Project selection error types
 */
export const PROJECT_SELECTION_ERRORS = {
	AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
	NETWORK_ERROR: 'NETWORK_ERROR',
	RATE_LIMIT: 'RATE_LIMIT',
	NO_PROJECTS_FOUND: 'NO_PROJECTS_FOUND',
	INVALID_SELECTION: 'INVALID_SELECTION',
	TEAM_ACCESS_ERROR: 'TEAM_ACCESS_ERROR',
	API_ERROR: 'API_ERROR'
};

/**
 * Project status filter options
 */
export const PROJECT_STATUS_FILTER = {
	ACTIVE: 'active',
	ALL: 'all',
	BACKLOG: 'backlog',
	PLANNED: 'planned',
	STARTED: 'started',
	COMPLETED: 'completed'
};

/**
 * Linear project fetching and selection functionality
 */
export class LinearProjectSelector {
	/**
	 * @param {Object} config - Configuration object
	 * @param {string} config.apiKey - Linear API key
	 * @param {number} config.maxRetries - Maximum retry attempts (default: 3)
	 * @param {number} config.retryDelay - Base retry delay in ms (default: 1000)
	 * @param {string} config.statusFilter - Project status filter (default: 'active')
	 */
	constructor(config = {}) {
		this.config = {
			maxRetries: 3,
			retryDelay: 1000,
			pageSize: 100, // Maximum projects to fetch per page
			statusFilter: PROJECT_STATUS_FILTER.ACTIVE,
			...config
		};

		if (!this.config.apiKey) {
			throw new Error('Linear API key is required');
		}

		this.linear = new LinearClient({
			apiKey: this.config.apiKey
		});
	}

	/**
	 * Fetch all available projects for a specific team from Linear API
	 *
	 * @param {string} teamId - Linear team ID (UUID format)
	 * @returns {Promise<Array>} Array of project objects
	 * @throws {Error} When API request fails or no projects are found
	 */
	async fetchTeamProjects(teamId) {
		if (!teamId || typeof teamId !== 'string') {
			throw new Error('Team ID is required and must be a string');
		}

		// Validate team ID format (UUID)
		const uuidRegex =
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
		if (!uuidRegex.test(teamId)) {
			throw new Error('Team ID must be a valid UUID format');
		}

		try {
			log('debug', `Fetching projects for team ${teamId} from Linear API...`);

			// Use retry logic for robust project fetching
			const projects = await this._retryOperation(async () => {
				// Get the team first to access its projects
				const team = await this.linear.team(teamId);

				if (!team) {
					const error = new Error(`Team not found or access denied: ${teamId}`);
					error.code = PROJECT_SELECTION_ERRORS.TEAM_ACCESS_ERROR;
					throw error;
				}

				// Fetch projects for this team
				const projectsConnection = await team.projects({
					first: this.config.pageSize,
					filter: this._buildProjectFilter()
				});

				return projectsConnection.nodes;
			}, 'fetch team projects');

			if (!projects || projects.length === 0) {
				const message =
					this.config.statusFilter === PROJECT_STATUS_FILTER.ALL
						? 'No projects found in this team'
						: `No ${this.config.statusFilter} projects found in this team`;
				const error = new Error(message);
				error.code = PROJECT_SELECTION_ERRORS.NO_PROJECTS_FOUND;
				throw error;
			}

			log('info', `Successfully fetched ${projects.length} projects for team`);

			// Transform projects for better display and selection
			return projects.map((project) => ({
				id: project.id,
				name: project.name,
				key: project.key || '',
				description: project.description || 'No description available',
				state: project.state?.name || 'Unknown',
				progress: project.progress || 0,
				memberCount: project.memberCount || 0,
				issueCount: project.issueCount || 0,
				url: project.url || '',
				displayName: project.key
					? `${project.name} (${project.key})`
					: project.name,
				searchText:
					`${project.name} ${project.key || ''} ${project.description || ''}`.toLowerCase(),
				statusIndicator: this._getStatusIndicator(project.state?.name),
				summary: `${project.state?.name || 'Unknown'} • ${project.issueCount || 0} issues • ${Math.round(project.progress || 0)}% complete`
			}));
		} catch (error) {
			throw this._enhanceError(error, 'fetch team projects');
		}
	}

	/**
	 * Present projects to user for selection using interactive checkbox interface
	 *
	 * @param {Array} projects - Array of project objects
	 * @param {Object} options - Selection options
	 * @param {boolean} options.allowMultiple - Enable multiple selection (default: true)
	 * @param {boolean} options.allowSearch - Enable search functionality (default: true)
	 * @param {string} options.message - Custom selection message
	 * @param {boolean} options.showDetails - Show detailed project information (default: true)
	 * @returns {Promise<Array>} Array of selected project objects
	 */
	async selectProjects(projects, options = {}) {
		const {
			allowMultiple = true,
			allowSearch = true,
			message = 'Select Linear project(s)',
			showDetails = true
		} = options;

		if (!projects || projects.length === 0) {
			const error = new Error('No projects available for selection');
			error.code = PROJECT_SELECTION_ERRORS.NO_PROJECTS_FOUND;
			throw error;
		}

		try {
			// Display header with project information and TaskMaster mapping explanation
			messages.header('Available Linear Projects');
			console.log(`Found ${projects.length} project(s):\n`);

			// Show TaskMaster mapping information
			messages.info('📋 Project Mapping:');
			console.log(
				'   • Linear Project → TaskMaster .taskmaster/tasks directory'
			);
			console.log('   • Top-level tasks → Linear issues under the project');
			console.log('   • Subtasks → Linear sub-issues\n');

			// Show project overview if details are enabled
			if (showDetails) {
				projects.forEach((project, index) => {
					console.log(
						`${index + 1}. ${project.statusIndicator} ${project.displayName}`
					);
					console.log(`   Description: ${project.description}`);
					console.log(`   Status: ${project.summary}`);
					if (project.url) {
						console.log(`   URL: ${project.url}`);
					}
					console.log('');
				});
			}

			// Create choices for inquirer
			const choices = projects.map((project) => ({
				name: `${project.statusIndicator} ${project.displayName} - ${project.summary}`,
				value: project,
				short: project.displayName
			}));

			// Add convenience options for multiple selection
			if (allowMultiple && projects.length > 1) {
				choices.unshift(
					new inquirer.Separator('── Quick Actions ──'),
					{
						name: '✅ Select All Projects',
						value: '__SELECT_ALL__',
						short: 'All Projects'
					},
					{
						name: '❌ Clear All Selections',
						value: '__CLEAR_ALL__',
						short: 'Clear All'
					},
					new inquirer.Separator('── Projects ──')
				);
			}

			// Configure prompt based on selection type and search needs
			let promptConfig;
			if (allowMultiple) {
				promptConfig = promptConfigs.checkbox(
					'selectedProjects',
					message,
					choices,
					{
						required: true,
						pageSize: Math.min(15, choices.length + 5) // Account for separators
					}
				);
			} else {
				// Single selection mode
				const listChoices = choices.filter(
					(choice) =>
						typeof choice === 'object' &&
						choice.value &&
						!choice.value.toString().startsWith('__')
				);
				promptConfig = promptConfigs.list(
					'selectedProjects',
					message,
					listChoices
				);
			}

			let selectedProjects = await inquirer.prompt([promptConfig]);
			selectedProjects = allowMultiple
				? selectedProjects.selectedProjects
				: [selectedProjects.selectedProjects];

			// Handle special actions for multiple selection
			if (allowMultiple && selectedProjects.includes('__SELECT_ALL__')) {
				selectedProjects = projects;
				messages.success(`Selected all ${projects.length} projects`);
			} else if (allowMultiple && selectedProjects.includes('__CLEAR_ALL__')) {
				selectedProjects = [];
				messages.info('Cleared all selections');
			} else {
				// Filter out special actions and validate
				selectedProjects = selectedProjects.filter(
					(project) =>
						project &&
						typeof project === 'object' &&
						!project.toString().startsWith('__')
				);
			}

			// Validate selection
			if (!selectedProjects || selectedProjects.length === 0) {
				const error = new Error('At least one project must be selected');
				error.code = PROJECT_SELECTION_ERRORS.INVALID_SELECTION;
				throw error;
			}

			// Display selection summary
			const projectNames = selectedProjects
				.map((p) => p.displayName)
				.join(', ');
			const selectionSummary =
				selectedProjects.length === 1
					? `Selected project: ${projectNames}`
					: `Selected ${selectedProjects.length} projects: ${projectNames}`;

			messages.success(selectionSummary);
			log(
				'info',
				`User selected ${selectedProjects.length} project(s): ${projectNames}`
			);

			return selectedProjects;
		} catch (error) {
			if (error.code) {
				// Already enhanced error
				throw error;
			}

			const enhancedError = new Error(
				`Project selection failed: ${error.message}`
			);
			enhancedError.code = PROJECT_SELECTION_ERRORS.INVALID_SELECTION;
			enhancedError.originalError = error;
			throw enhancedError;
		}
	}

	/**
	 * Fetch projects and present selection interface in one step
	 *
	 * @param {string} teamId - Linear team ID
	 * @param {Object} options - Combined options for fetching and selection
	 * @returns {Promise<Array>} Array of selected project objects
	 */
	async fetchAndSelectProjects(teamId, options = {}) {
		try {
			messages.info(`Fetching projects for selected team...`);

			const projects = await this.fetchTeamProjects(teamId);

			if (projects.length === 1 && !options.forceSelection) {
				// Auto-select if only one project available
				messages.info(`Only one project available: ${projects[0].displayName}`);
				const confirm = await inquirer.prompt([
					promptConfigs.confirm(
						'useProject',
						`Use project "${projects[0].displayName}"`
					)
				]);

				if (confirm.useProject) {
					messages.success(`Using project: ${projects[0].displayName}`);
					return [projects[0]];
				} else if (!options.allowEmpty) {
					const error = new Error(
						'User declined to use the only available project'
					);
					error.code = PROJECT_SELECTION_ERRORS.INVALID_SELECTION;
					throw error;
				}
				return [];
			}

			return await this.selectProjects(projects, options);
		} catch (error) {
			messages.error(`Failed to fetch and select projects: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Validate project selection results
	 *
	 * @param {Array} projects - Selected project objects
	 * @returns {boolean} True if valid
	 * @throws {Error} If validation fails
	 */
	validateProjectSelection(projects) {
		if (!Array.isArray(projects)) {
			throw new Error('Project selection must be an array');
		}

		if (projects.length === 0) {
			throw new Error('At least one project must be selected');
		}

		const requiredFields = ['id', 'name'];
		for (const [index, project] of projects.entries()) {
			if (!project || typeof project !== 'object') {
				throw new Error(`Project ${index + 1}: must be an object`);
			}

			for (const field of requiredFields) {
				if (!project[field]) {
					throw new Error(
						`Project ${index + 1}: missing required field '${field}'`
					);
				}
			}

			// Validate project ID format (Linear project IDs are UUIDs)
			const uuidRegex =
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
			if (!uuidRegex.test(project.id)) {
				throw new Error(
					`Project ${index + 1}: project ID must be a valid UUID`
				);
			}
		}

		return true;
	}

	/**
	 * Build project filter based on configuration
	 *
	 * @returns {Object} Filter object for Linear API
	 * @private
	 */
	_buildProjectFilter() {
		const filter = {};

		// Apply status filter
		if (this.config.statusFilter !== PROJECT_STATUS_FILTER.ALL) {
			switch (this.config.statusFilter) {
				case PROJECT_STATUS_FILTER.ACTIVE:
					// Active projects (backlog, planned, started)
					filter.state = {
						name: { in: ['backlog', 'planned', 'started'] }
					};
					break;
				case PROJECT_STATUS_FILTER.COMPLETED:
					filter.state = { name: { eq: 'completed' } };
					break;
				default:
					filter.state = { name: { eq: this.config.statusFilter } };
			}
		}

		return filter;
	}

	/**
	 * Get status indicator emoji for project state
	 *
	 * @param {string} state - Project state name
	 * @returns {string} Status indicator emoji
	 * @private
	 */
	_getStatusIndicator(state) {
		const indicators = {
			backlog: '📋',
			planned: '📅',
			started: '🚀',
			paused: '⏸️',
			completed: '✅',
			cancelled: '❌'
		};
		return indicators[state?.toLowerCase()] || '📄';
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

		// Team access errors are not retryable
		if (error.code === PROJECT_SELECTION_ERRORS.TEAM_ACCESS_ERROR) {
			return true;
		}

		// No projects found is not retryable
		if (error.code === PROJECT_SELECTION_ERRORS.NO_PROJECTS_FOUND) {
			return true;
		}

		// Invalid team ID format
		if (error.message?.includes('Team ID must be a valid UUID')) {
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
			Object.values(PROJECT_SELECTION_ERRORS).includes(error.code)
		) {
			return error;
		}

		const enhancedError = new Error(`Failed to ${operation}: ${error.message}`);
		enhancedError.originalError = error;

		// Classify error types
		if (error.message?.includes('Authentication') || error.status === 401) {
			enhancedError.code = PROJECT_SELECTION_ERRORS.AUTHENTICATION_ERROR;
		} else if (error.message?.includes('rate limit') || error.status === 429) {
			enhancedError.code = PROJECT_SELECTION_ERRORS.RATE_LIMIT;
		} else if (
			error.message?.includes('Network') ||
			error.code === 'ECONNRESET' ||
			error.code === 'ENOTFOUND'
		) {
			enhancedError.code = PROJECT_SELECTION_ERRORS.NETWORK_ERROR;
		} else if (
			error.message?.includes('Team not found') ||
			error.message?.includes('access denied')
		) {
			enhancedError.code = PROJECT_SELECTION_ERRORS.TEAM_ACCESS_ERROR;
		} else if (error.code === PROJECT_SELECTION_ERRORS.NO_PROJECTS_FOUND) {
			enhancedError.code = PROJECT_SELECTION_ERRORS.NO_PROJECTS_FOUND;
		} else {
			enhancedError.code = PROJECT_SELECTION_ERRORS.API_ERROR;
		}

		return enhancedError;
	}
}

/**
 * Convenience function to create and use project selector
 *
 * @param {string} apiKey - Linear API key
 * @param {string} teamId - Linear team ID
 * @param {Object} options - Selection options
 * @returns {Promise<Array>} Selected projects
 */
export async function selectLinearProjects(apiKey, teamId, options = {}) {
	const selector = new LinearProjectSelector({ apiKey, ...options });
	return await selector.fetchAndSelectProjects(teamId, options);
}

/**
 * Convenience function to just fetch projects without selection
 *
 * @param {string} apiKey - Linear API key
 * @param {string} teamId - Linear team ID
 * @param {Object} options - Fetch options
 * @returns {Promise<Array>} Array of projects
 */
export async function fetchLinearProjects(apiKey, teamId, options = {}) {
	const selector = new LinearProjectSelector({ apiKey, ...options });
	return await selector.fetchTeamProjects(teamId);
}
