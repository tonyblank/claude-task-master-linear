/**
 * @fileoverview Linear Team Selection Module
 *
 * This module provides functionality to fetch available teams from Linear API
 * and present them as a selectable list to the user through interactive prompts.
 */

import { LinearClient } from '@linear/sdk';
import { log } from './utils.js';
import { promptConfigs, messages } from './prompts.js';
import inquirer from 'inquirer';

/**
 * Team selection error types
 */
export const TEAM_SELECTION_ERRORS = {
	AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
	NETWORK_ERROR: 'NETWORK_ERROR',
	RATE_LIMIT: 'RATE_LIMIT',
	NO_TEAMS_FOUND: 'NO_TEAMS_FOUND',
	INVALID_SELECTION: 'INVALID_SELECTION',
	API_ERROR: 'API_ERROR'
};

/**
 * Linear team fetching and selection functionality
 */
export class LinearTeamSelector {
	/**
	 * @param {Object} config - Configuration object
	 * @param {string} config.apiKey - Linear API key
	 * @param {number} config.maxRetries - Maximum retry attempts (default: 3)
	 * @param {number} config.retryDelay - Base retry delay in ms (default: 1000)
	 */
	constructor(config = {}) {
		this.config = {
			maxRetries: 3,
			retryDelay: 1000,
			pageSize: 100, // Maximum teams to fetch per page
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
	 * Fetch all available teams from Linear API
	 *
	 * @returns {Promise<Array>} Array of team objects
	 * @throws {Error} When API request fails or no teams are found
	 */
	async fetchTeams() {
		try {
			log('debug', 'Fetching teams from Linear API...');

			// Use retry logic for robust team fetching
			const teams = await this._retryOperation(async () => {
				const teamsConnection = await this.linear.teams({
					first: this.config.pageSize,
					includeArchived: false
					// Note: No filter needed - Linear API only returns teams user has access to
				});

				// Get teams with member and project counts
				const teamsWithCounts = await Promise.all(
					teamsConnection.nodes.map(async (team) => {
						try {
							// Get member count
							const members = await team.members({ first: 1 });
							const memberCount = members.totalCount || 0;

							// Get project count
							const projects = await team.projects({ first: 1 });
							const projectCount = projects.totalCount || 0;

							return {
								...team,
								memberCount,
								projectCount
							};
						} catch (error) {
							log(
								'warn',
								`Failed to get counts for team ${team.name}: ${error.message}`
							);
							return {
								...team,
								memberCount: 0,
								projectCount: 0
							};
						}
					})
				);

				return teamsWithCounts;
			}, 'fetch teams');

			if (!teams || teams.length === 0) {
				const error = new Error('No teams found or user has no team access');
				error.code = TEAM_SELECTION_ERRORS.NO_TEAMS_FOUND;
				throw error;
			}

			log('info', `Successfully fetched ${teams.length} teams`);

			// Transform teams for better display and selection
			return teams.map((team) => ({
				id: team.id,
				name: team.name,
				key: team.key,
				description: team.description || 'No description available',
				memberCount: team.memberCount || 0,
				projectCount: team.projectCount || 0,
				displayName: `${team.name} (${team.key})`,
				searchText:
					`${team.name} ${team.key} ${team.description || ''}`.toLowerCase()
			}));
		} catch (error) {
			throw this._enhanceError(error, 'fetch teams');
		}
	}

	/**
	 * Present teams to user for selection using interactive interface
	 *
	 * @param {Array} teams - Array of team objects
	 * @param {Object} options - Selection options
	 * @param {boolean} options.allowSearch - Enable search functionality (default: true)
	 * @param {string} options.message - Custom selection message
	 * @returns {Promise<Object>} Selected team object
	 */
	async selectTeam(teams, options = {}) {
		const { allowSearch = true, message = 'Select a Linear team' } = options;

		if (!teams || teams.length === 0) {
			const error = new Error('No teams available for selection');
			error.code = TEAM_SELECTION_ERRORS.NO_TEAMS_FOUND;
			throw error;
		}

		try {
			// Display header with team information
			messages.header('Available Linear Teams');
			console.log(`Found ${teams.length} team(s):\n`);

			// Show team overview
			teams.forEach((team, index) => {
				console.log(`${index + 1}. ${team.displayName}`);
				console.log(`   Description: ${team.description}`);
				console.log(
					`   Members: ${team.memberCount}, Projects: ${team.projectCount}\n`
				);
			});

			// Create choices for inquirer
			const choices = teams.map((team) => ({
				name: `${team.displayName} - ${team.description}`,
				value: team,
				short: team.displayName
			}));

			// Add search functionality if enabled and there are multiple teams
			const promptType =
				allowSearch && teams.length > 5 ? 'autocomplete' : 'list';

			let promptConfig;
			if (promptType === 'autocomplete') {
				// Use autocomplete for better search experience with many teams
				promptConfig = {
					type: 'autocomplete',
					name: 'selectedTeam',
					message: `${message}:`,
					source: async (answersSoFar, input) => {
						if (!input) return choices;

						const searchTerm = input.toLowerCase();
						return choices.filter((choice) =>
							choice.value.searchText.includes(searchTerm)
						);
					},
					pageSize: 10
				};
			} else {
				// Use regular list selection
				promptConfig = promptConfigs.list('selectedTeam', message, choices);
			}

			const { selectedTeam } = await inquirer.prompt([promptConfig]);

			if (!selectedTeam) {
				const error = new Error('No team selected');
				error.code = TEAM_SELECTION_ERRORS.INVALID_SELECTION;
				throw error;
			}

			messages.success(`Selected team: ${selectedTeam.displayName}`);
			log(
				'info',
				`User selected team: ${selectedTeam.name} (${selectedTeam.id})`
			);

			return selectedTeam;
		} catch (error) {
			if (error.code) {
				// Already enhanced error
				throw error;
			}

			// Check if this is a prompt cancellation error in non-interactive environment
			if (
				error.message.includes('User force closed') ||
				error.message.includes('cancelled') ||
				error.name === 'ExitPromptError'
			) {
				// Detect container/non-interactive environment
				const isNonInteractive =
					!process.stdin.isTTY ||
					process.env.CI === 'true' ||
					process.env.DOCKER_CONTAINER === 'true' ||
					process.env.NODE_ENV === 'production';

				let helpMessage = `Team selection failed: ${error.message}`;

				if (isNonInteractive) {
					helpMessage +=
						'\n\n🐳 CONTAINER/NON-INTERACTIVE ENVIRONMENT DETECTED:';
					helpMessage +=
						'\nInteractive prompts may not work in this environment.';
					helpMessage += '\n\nTo run the wizard successfully:';
					helpMessage +=
						'\n1. Run this wizard in an interactive terminal session';
					helpMessage +=
						'\n2. If using Docker, ensure TTY mode: docker run -it';
					helpMessage +=
						'\n3. If using container orchestration, access the container directly:';
					helpMessage += '\n   docker exec -it <container-name> /bin/bash';
					helpMessage +=
						'\n   then run: ./bin/task-master.js linear-sync-setup';
				}

				const enhancedError = new Error(helpMessage);
				enhancedError.code = TEAM_SELECTION_ERRORS.INVALID_SELECTION;
				enhancedError.originalError = error;
				enhancedError.isEnvironmentIssue = isNonInteractive;
				throw enhancedError;
			}

			const enhancedError = new Error(
				`Team selection failed: ${error.message}`
			);
			enhancedError.code = TEAM_SELECTION_ERRORS.INVALID_SELECTION;
			enhancedError.originalError = error;
			throw enhancedError;
		}
	}

	/**
	 * Present team selection interface for multiple teams
	 *
	 * @param {Array} teams - Array of team objects to select from
	 * @param {Object} options - Selection options
	 * @param {string} options.message - Custom selection message
	 * @param {boolean} options.allowSearch - Enable search functionality (default: false)
	 * @returns {Promise<Array>} Array of selected team objects
	 * @throws {Error} If no teams provided or selection fails
	 */
	async selectTeams(teams, options = {}) {
		const {
			message = 'Select teams to include in the integration',
			allowSearch = false
		} = options;

		if (!teams || !Array.isArray(teams) || teams.length === 0) {
			throw new Error('No teams available for selection');
		}

		try {
			console.log('\nAvailable Teams:');
			teams.forEach((team, index) => {
				console.log(`${index + 1}. ${team.displayName}`);
				console.log(`   Description: ${team.description}`);
				console.log(
					`   Members: ${team.memberCount}, Projects: ${team.projectCount}\n`
				);
			});

			// Create choices for inquirer
			const choices = teams.map((team) => ({
				name: `${team.displayName} - ${team.description}`,
				value: team,
				short: team.displayName
			}));

			// Use checkbox for multiple selection
			const promptConfig = {
				type: 'checkbox',
				name: 'selectedTeams',
				message: `${message} (use space to select, enter to confirm):`,
				choices: choices,
				pageSize: 10,
				validate: (answer) => {
					if (answer.length === 0) {
						return 'You must select at least one team.';
					}
					return true;
				}
			};

			const { selectedTeams } = await inquirer.prompt([promptConfig]);

			if (!selectedTeams || selectedTeams.length === 0) {
				const error = new Error('No teams selected');
				error.code = TEAM_SELECTION_ERRORS.INVALID_SELECTION;
				throw error;
			}

			messages.success(
				`Selected ${selectedTeams.length} team(s): ${selectedTeams.map((t) => t.displayName).join(', ')}`
			);
			log(
				'info',
				`User selected teams: ${selectedTeams.map((t) => `${t.name} (${t.id})`).join(', ')}`
			);

			return selectedTeams;
		} catch (error) {
			if (error.code) {
				// Already enhanced error
				throw error;
			}

			const enhancedError = new Error(
				`Team selection failed: ${error.message}`
			);
			enhancedError.code = TEAM_SELECTION_ERRORS.INVALID_SELECTION;
			enhancedError.originalError = error;
			throw enhancedError;
		}
	}

	/**
	 * Fetch teams and present selection interface in one step
	 *
	 * @param {Object} options - Combined options for fetching and selection
	 * @returns {Promise<Object>} Selected team object
	 */
	async fetchAndSelectTeam(options = {}) {
		try {
			messages.info('Fetching available teams from Linear...');

			const teams = await this.fetchTeams();

			// Stop spinner after data fetching but before interactive prompts
			if (options.spinner) {
				options.spinner.stop();
			}

			if (teams.length === 1) {
				// Auto-select if only one team available
				messages.info(`Only one team available: ${teams[0].displayName}`);
				const confirm = await inquirer.prompt([
					promptConfigs.confirm('useTeam', `Use team "${teams[0].displayName}"`)
				]);

				if (confirm.useTeam) {
					messages.success(`Using team: ${teams[0].displayName}`);
					return teams[0];
				} else {
					const error = new Error(
						'User declined to use the only available team'
					);
					error.code = TEAM_SELECTION_ERRORS.INVALID_SELECTION;
					throw error;
				}
			}

			return await this.selectTeam(teams, options);
		} catch (error) {
			messages.error(`Failed to fetch and select team: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Fetch teams and present multiple selection interface in one step
	 *
	 * @param {Object} options - Combined options for fetching and selection
	 * @returns {Promise<Object>} Result object with success and selectedTeams
	 */
	async fetchAndSelectTeams(options = {}) {
		try {
			const teams = await this.fetchTeams();

			if (teams.length === 0) {
				return {
					success: false,
					error: 'No teams available',
					selectedTeams: []
				};
			}

			if (teams.length === 1) {
				// Auto-select if only one team available
				messages.info(`Only one team available: ${teams[0].displayName}`);
				const confirm = await inquirer.prompt([
					promptConfigs.confirm('useTeam', `Use team "${teams[0].displayName}"`)
				]);

				if (confirm.useTeam) {
					messages.success(`Using team: ${teams[0].displayName}`);
					return {
						success: true,
						selectedTeams: [teams[0]]
					};
				} else {
					return {
						success: false,
						error: 'User declined to use the only available team',
						selectedTeams: []
					};
				}
			}

			const selectedTeams = await this.selectTeams(teams, options);
			return {
				success: true,
				selectedTeams: selectedTeams
			};
		} catch (error) {
			messages.error(`Failed to fetch and select teams: ${error.message}`);
			return {
				success: false,
				error: error.message,
				selectedTeams: []
			};
		}
	}

	/**
	 * Validate team selection result
	 *
	 * @param {Object} team - Selected team object
	 * @returns {boolean} True if valid
	 * @throws {Error} If validation fails
	 */
	validateTeamSelection(team) {
		if (!team || typeof team !== 'object') {
			throw new Error('Invalid team selection: team must be an object');
		}

		const requiredFields = ['id', 'name', 'key'];
		for (const field of requiredFields) {
			if (!team[field]) {
				throw new Error(
					`Invalid team selection: missing required field '${field}'`
				);
			}
		}

		// Validate team ID format (Linear team IDs are UUIDs)
		const uuidRegex =
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
		if (!uuidRegex.test(team.id)) {
			throw new Error('Invalid team selection: team ID must be a valid UUID');
		}

		return true;
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

		// No teams found is not retryable
		if (error.code === TEAM_SELECTION_ERRORS.NO_TEAMS_FOUND) {
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
			Object.values(TEAM_SELECTION_ERRORS).includes(error.code)
		) {
			return error;
		}

		const enhancedError = new Error(`Failed to ${operation}: ${error.message}`);
		enhancedError.originalError = error;

		// Classify error types
		if (error.message?.includes('Authentication') || error.status === 401) {
			enhancedError.code = TEAM_SELECTION_ERRORS.AUTHENTICATION_ERROR;
		} else if (error.message?.includes('rate limit') || error.status === 429) {
			enhancedError.code = TEAM_SELECTION_ERRORS.RATE_LIMIT;
		} else if (
			error.message?.includes('Network') ||
			error.code === 'ECONNRESET' ||
			error.code === 'ENOTFOUND'
		) {
			enhancedError.code = TEAM_SELECTION_ERRORS.NETWORK_ERROR;
		} else if (error.code === TEAM_SELECTION_ERRORS.NO_TEAMS_FOUND) {
			enhancedError.code = TEAM_SELECTION_ERRORS.NO_TEAMS_FOUND;
		} else {
			enhancedError.code = TEAM_SELECTION_ERRORS.API_ERROR;
		}

		return enhancedError;
	}
}

/**
 * Convenience function to create and use team selector
 *
 * @param {string} apiKey - Linear API key
 * @param {Object} options - Selection options
 * @returns {Promise<Object>} Selected team
 */
export async function selectLinearTeam(apiKey, options = {}) {
	const selector = new LinearTeamSelector({ apiKey, ...options });
	return await selector.fetchAndSelectTeam(options);
}

/**
 * Convenience function to just fetch teams without selection
 *
 * @param {string} apiKey - Linear API key
 * @param {Object} options - Fetch options
 * @returns {Promise<Array>} Array of teams
 */
export async function fetchLinearTeams(apiKey, options = {}) {
	const selector = new LinearTeamSelector({ apiKey, ...options });
	return await selector.fetchTeams();
}

/**
 * Convenience function to create and use team selector for multiple teams
 *
 * @param {string} apiKey - Linear API key
 * @param {Object} options - Selection options
 * @returns {Promise<Object>} Result object with success and selectedTeams
 */
export async function selectLinearTeams(apiKey, options = {}) {
	const selector = new LinearTeamSelector({ apiKey, ...options });
	return await selector.fetchAndSelectTeams(options);
}
