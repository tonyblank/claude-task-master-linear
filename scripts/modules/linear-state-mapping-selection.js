/**
 * @fileoverview Linear State Mapping Selection Module
 *
 * This module provides functionality to fetch available Linear workflow states
 * and present them for interactive mapping to TaskMaster statuses during setup.
 * Follows the same pattern as team and project selection modules.
 */

import { LinearClient } from '@linear/sdk';
import { log } from './utils.js';
import { promptConfigs, messages } from './prompts.js';
import inquirer from 'inquirer';
import chalk from 'chalk';

/**
 * State mapping selection error types
 */
export const STATE_MAPPING_ERRORS = {
	AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
	NETWORK_ERROR: 'NETWORK_ERROR',
	RATE_LIMIT: 'RATE_LIMIT',
	NO_STATES_FOUND: 'NO_STATES_FOUND',
	INVALID_SELECTION: 'INVALID_SELECTION',
	API_ERROR: 'API_ERROR',
	INCOMPLETE_MAPPING: 'INCOMPLETE_MAPPING'
};

/**
 * TaskMaster status definitions with descriptions
 */
export const TASKMASTER_STATUSES = {
	pending: {
		name: 'pending',
		displayName: 'Pending',
		description: 'Tasks that are ready to be started',
		suggestedLinearTypes: ['unstarted', 'backlog']
	},
	'in-progress': {
		name: 'in-progress',
		displayName: 'In Progress',
		description: 'Tasks currently being worked on',
		suggestedLinearTypes: ['started']
	},
	review: {
		name: 'review',
		displayName: 'Review',
		description: 'Tasks completed and awaiting review',
		suggestedLinearTypes: ['started', 'completed']
	},
	done: {
		name: 'done',
		displayName: 'Done',
		description: 'Completed tasks',
		suggestedLinearTypes: ['completed']
	},
	cancelled: {
		name: 'cancelled',
		displayName: 'Cancelled',
		description: 'Tasks that were cancelled or abandoned',
		suggestedLinearTypes: ['canceled']
	},
	deferred: {
		name: 'deferred',
		displayName: 'Deferred',
		description: 'Tasks postponed for later',
		suggestedLinearTypes: ['unstarted', 'backlog']
	}
};

/**
 * Linear state mapping selector class
 */
export class LinearStateMappingSelector {
	/**
	 * @param {Object} config - Configuration object
	 * @param {string} config.apiKey - Linear API key
	 * @param {string} config.teamId - Linear team ID
	 * @param {number} config.maxRetries - Maximum retry attempts (default: 3)
	 * @param {number} config.retryDelay - Base retry delay in ms (default: 1000)
	 */
	constructor(config = {}) {
		this.config = {
			maxRetries: 3,
			retryDelay: 1000,
			...config
		};

		if (!this.config.apiKey) {
			throw new Error('Linear API key is required');
		}

		if (!this.config.teamId) {
			throw new Error('Linear team ID is required');
		}

		this.linear = new LinearClient({
			apiKey: this.config.apiKey
		});
	}

	/**
	 * Fetch all available workflow states for the team
	 *
	 * @returns {Promise<Array>} Array of workflow state objects
	 * @throws {Error} When API request fails or no states are found
	 */
	async fetchWorkflowStates() {
		try {
			log('debug', 'Fetching workflow states from Linear API...');

			// Use retry logic for robust state fetching
			const states = await this._retryOperation(async () => {
				// Get the team to access its workflow states
				const team = await this.linear.team(this.config.teamId);

				if (!team) {
					throw new Error(`Team ${this.config.teamId} not found`);
				}

				// Fetch all workflow states for the team
				const statesConnection = await team.states({
					first: 100, // Linear workflow states are typically limited per team
					includeArchived: false
				});

				return statesConnection.nodes.map((state) => ({
					id: state.id,
					name: state.name,
					type: state.type,
					color: state.color,
					description: state.description || '',
					position: state.position || 0
				}));
			});

			if (!states || states.length === 0) {
				throw new Error('No workflow states found for this team');
			}

			// Sort by position for consistent display
			states.sort((a, b) => a.position - b.position);

			log('debug', `Fetched ${states.length} workflow states`);
			return states;
		} catch (error) {
			throw this._handleError(error);
		}
	}

	/**
	 * Interactive state mapping selection
	 *
	 * @param {Array} workflowStates - Available Linear workflow states
	 * @returns {Promise<Object>} Selected state mappings
	 */
	async selectStateMappings(workflowStates) {
		console.log(chalk.cyan('\n📊 State Mapping Configuration\n'));
		console.log(
			chalk.gray('Map your Linear workflow states to TaskMaster statuses:')
		);
		console.log(
			chalk.gray(
				'This creates a bridge between how TaskMaster tracks progress and Linear.\n'
			)
		);

		const mappings = {
			name: {},
			uuid: {}
		};

		// Display available Linear states
		console.log(chalk.yellow('Available Linear workflow states:'));
		workflowStates.forEach((state, index) => {
			const typeColor = this._getTypeColor(state.type);
			console.log(
				chalk.gray(
					`  ${index + 1}. ${chalk.hex(state.color)(state.name)} ${typeColor(`(${state.type})`)} - ${state.description}`
				)
			);
		});
		console.log('');

		// Map each TaskMaster status
		for (const [statusKey, statusInfo] of Object.entries(TASKMASTER_STATUSES)) {
			const selectedState = await this._selectStateForStatus(
				statusKey,
				statusInfo,
				workflowStates
			);

			if (selectedState) {
				mappings.name[statusKey] = selectedState.name;
				mappings.uuid[statusKey] = selectedState.id;

				console.log(
					chalk.green(
						`✅ ${statusInfo.displayName} → ${chalk.hex(selectedState.color)(selectedState.name)}`
					)
				);
			} else {
				console.log(
					chalk.yellow(
						`⚠️  ${statusInfo.displayName} → No mapping (will use default behavior)`
					)
				);
			}
		}

		return mappings;
	}

	/**
	 * Select a Linear state for a specific TaskMaster status
	 *
	 * @private
	 * @param {string} statusKey - TaskMaster status key
	 * @param {Object} statusInfo - TaskMaster status information
	 * @param {Array} workflowStates - Available Linear workflow states
	 * @returns {Promise<Object|null>} Selected state or null
	 */
	async _selectStateForStatus(statusKey, statusInfo, workflowStates) {
		// Get suggested states based on Linear type
		const suggestedStates = workflowStates.filter((state) =>
			statusInfo.suggestedLinearTypes.includes(state.type)
		);

		// Create choices with suggestions highlighted
		const choices = [
			...workflowStates.map((state) => {
				const isSuggested = suggestedStates.includes(state);
				const typeColor = this._getTypeColor(state.type);
				const prefix = isSuggested ? '⭐ ' : '   ';

				return {
					name: `${prefix}${chalk.hex(state.color)(state.name)} ${typeColor(`(${state.type})`)} - ${state.description}`,
					value: state,
					short: state.name
				};
			}),
			{
				name: chalk.gray('Skip this mapping (use default behavior)'),
				value: null,
				short: 'Skip'
			}
		];

		console.log(
			chalk.cyan(`\nMapping for: ${chalk.bold(statusInfo.displayName)}`)
		);
		console.log(chalk.gray(`${statusInfo.description}`));
		if (suggestedStates.length > 0) {
			console.log(
				chalk.yellow(
					`⭐ Suggested based on Linear state type (${statusInfo.suggestedLinearTypes.join(', ')})`
				)
			);
		}

		const answer = await inquirer.prompt([
			{
				type: 'list',
				name: 'selectedState',
				message: `Select Linear state for "${statusInfo.displayName}":`,
				choices,
				pageSize: Math.min(workflowStates.length + 1, 10)
			}
		]);

		return answer.selectedState;
	}

	/**
	 * Get color for Linear state type
	 *
	 * @private
	 * @param {string} type - Linear state type
	 * @returns {Function} Chalk color function
	 */
	_getTypeColor(type) {
		const typeColors = {
			unstarted: chalk.gray,
			started: chalk.blue,
			completed: chalk.green,
			canceled: chalk.red,
			backlog: chalk.magenta
		};
		return typeColors[type] || chalk.white;
	}

	/**
	 * Validate state mappings
	 *
	 * @param {Object} mappings - State mappings to validate
	 * @param {Array} workflowStates - Available workflow states
	 * @returns {Object} Validation result
	 */
	validateMappings(mappings, workflowStates) {
		const validation = {
			isValid: true,
			errors: [],
			warnings: [],
			coverage: 0
		};

		const stateIds = new Set(workflowStates.map((s) => s.id));
		const stateNames = new Set(workflowStates.map((s) => s.name));

		let mappedCount = 0;
		const totalStatuses = Object.keys(TASKMASTER_STATUSES).length;

		// Validate UUID mappings
		if (mappings.uuid) {
			for (const [status, uuid] of Object.entries(mappings.uuid)) {
				mappedCount++;
				if (!stateIds.has(uuid)) {
					validation.isValid = false;
					validation.errors.push(
						`Invalid UUID mapping for ${status}: ${uuid} not found`
					);
				}
			}
		}

		// Validate name mappings
		if (mappings.name) {
			for (const [status, name] of Object.entries(mappings.name)) {
				if (!mappings.uuid || !mappings.uuid[status]) {
					mappedCount++;
				}
				if (!stateNames.has(name)) {
					validation.warnings.push(
						`Name mapping for ${status}: "${name}" not found (UUID mapping available)`
					);
				}
			}
		}

		validation.coverage = (mappedCount / totalStatuses) * 100;

		if (mappedCount === 0) {
			validation.isValid = false;
			validation.errors.push('No state mappings configured');
		} else if (mappedCount < totalStatuses) {
			validation.warnings.push(
				`Only ${mappedCount}/${totalStatuses} statuses mapped (${validation.coverage.toFixed(1)}% coverage)`
			);
		}

		return validation;
	}

	/**
	 * Retry operation with exponential backoff
	 *
	 * @private
	 * @param {Function} operation - Async operation to retry
	 * @returns {Promise<any>} Operation result
	 */
	async _retryOperation(operation) {
		let lastError;

		for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
			try {
				return await operation();
			} catch (error) {
				lastError = error;

				if (attempt === this.config.maxRetries) {
					break;
				}

				// Don't retry authentication errors
				if (
					error.message?.includes('authentication') ||
					error.message?.includes('unauthorized')
				) {
					break;
				}

				const delay = this.config.retryDelay * Math.pow(2, attempt - 1);
				log(
					'warn',
					`Attempt ${attempt} failed, retrying in ${delay}ms: ${error.message}`
				);
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}

		throw lastError;
	}

	/**
	 * Handle and classify errors
	 *
	 * @private
	 * @param {Error} error - Original error
	 * @returns {Error} Classified error
	 */
	_handleError(error) {
		const message = error.message || 'Unknown error';

		if (
			message.includes('authentication') ||
			message.includes('unauthorized')
		) {
			const classifiedError = new Error(`Authentication failed: ${message}`);
			classifiedError.type = STATE_MAPPING_ERRORS.AUTHENTICATION_ERROR;
			return classifiedError;
		}

		if (
			message.includes('rate limit') ||
			message.includes('too many requests')
		) {
			const classifiedError = new Error(`Rate limit exceeded: ${message}`);
			classifiedError.type = STATE_MAPPING_ERRORS.RATE_LIMIT;
			return classifiedError;
		}

		if (
			message.includes('network') ||
			message.includes('timeout') ||
			error.code === 'ENOTFOUND'
		) {
			const classifiedError = new Error(`Network error: ${message}`);
			classifiedError.type = STATE_MAPPING_ERRORS.NETWORK_ERROR;
			return classifiedError;
		}

		// Default classification
		const classifiedError = new Error(message);
		classifiedError.type = STATE_MAPPING_ERRORS.API_ERROR;
		return classifiedError;
	}
}

/**
 * Main function to select Linear state mappings
 * Follows the same pattern as selectLinearTeam and selectLinearProject
 *
 * @param {string} apiKey - Linear API key
 * @param {string} teamId - Linear team ID
 * @param {Object} options - Additional options
 * @param {Object} options.spinner - Ora spinner instance (will be stopped)
 * @param {boolean} options.skipValidation - Skip validation step
 * @returns {Promise<Object>} State mappings result
 */
export async function selectLinearStateMappings(apiKey, teamId, options = {}) {
	const { spinner, skipValidation = false } = options;

	try {
		// Stop spinner if provided
		if (spinner) {
			spinner.stop();
		}

		// Create selector
		const selector = new LinearStateMappingSelector({
			apiKey,
			teamId
		});

		// Fetch available workflow states
		const workflowStates = await selector.fetchWorkflowStates();

		if (workflowStates.length === 0) {
			throw new Error('No workflow states found for the selected team');
		}

		// Interactive selection
		const mappings = await selector.selectStateMappings(workflowStates);

		// Validate mappings unless skipped
		let validation = { isValid: true, errors: [], warnings: [], coverage: 100 };
		if (!skipValidation) {
			validation = selector.validateMappings(mappings, workflowStates);
		}

		// Display validation results
		if (validation.warnings.length > 0) {
			console.log(chalk.yellow('\nWarnings:'));
			validation.warnings.forEach((warning) =>
				console.log(chalk.yellow(`  ⚠️  ${warning}`))
			);
		}

		if (!validation.isValid) {
			console.log(chalk.red('\nValidation Errors:'));
			validation.errors.forEach((error) =>
				console.log(chalk.red(`  ❌ ${error}`))
			);

			const retry = await inquirer.prompt([
				{
					type: 'confirm',
					name: 'retry',
					message: 'Would you like to reconfigure the state mappings?',
					default: true
				}
			]);

			if (retry.retry) {
				return await selectLinearStateMappings(apiKey, teamId, options);
			}
		}

		console.log(
			chalk.green(
				`\n✅ State mapping configuration complete (${validation.coverage.toFixed(1)}% coverage)`
			)
		);

		return {
			success: true,
			mappings,
			workflowStates,
			validation,
			coverage: validation.coverage
		};
	} catch (error) {
		if (spinner) {
			spinner.stop();
		}

		log('error', `State mapping selection failed: ${error.message}`);

		// Provide user-friendly error messages
		const userMessage =
			error.type === STATE_MAPPING_ERRORS.AUTHENTICATION_ERROR
				? 'Please check your Linear API key and permissions'
				: error.type === STATE_MAPPING_ERRORS.NETWORK_ERROR
					? 'Please check your internet connection and try again'
					: error.type === STATE_MAPPING_ERRORS.RATE_LIMIT
						? 'Please wait a moment and try again'
						: 'Please check your team selection and try again';

		console.log(chalk.red(`\n❌ ${error.message}`));
		console.log(chalk.gray(`💡 ${userMessage}`));

		return {
			success: false,
			error: error.message,
			type: error.type,
			userMessage
		};
	}
}

/**
 * Validate existing state mappings configuration
 *
 * @param {string} apiKey - Linear API key
 * @param {string} teamId - Linear team ID
 * @param {Object} existingMappings - Existing mappings to validate
 * @returns {Promise<Object>} Validation result
 */
export async function validateExistingStateMappings(
	apiKey,
	teamId,
	existingMappings
) {
	try {
		const selector = new LinearStateMappingSelector({
			apiKey,
			teamId
		});

		const workflowStates = await selector.fetchWorkflowStates();
		const validation = selector.validateMappings(
			existingMappings,
			workflowStates
		);

		return {
			success: true,
			validation,
			workflowStates
		};
	} catch (error) {
		return {
			success: false,
			error: error.message,
			type: error.type
		};
	}
}
