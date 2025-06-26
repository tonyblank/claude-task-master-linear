/**
 * @fileoverview Linear Project Creation Module
 *
 * This module provides functionality to create new projects in Linear using the Linear API.
 * Supports the simplified 1:1:1 architecture where each TaskMaster repo maps to one Linear project.
 */

import { LinearClient } from '@linear/sdk';
import { log } from './utils.js';
import { messages } from './prompts.js';
import inquirer from 'inquirer';

/**
 * Project creation error types
 */
export const PROJECT_CREATION_ERRORS = {
	AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
	NETWORK_ERROR: 'NETWORK_ERROR',
	RATE_LIMIT: 'RATE_LIMIT',
	TEAM_ACCESS_ERROR: 'TEAM_ACCESS_ERROR',
	VALIDATION_ERROR: 'VALIDATION_ERROR',
	API_ERROR: 'API_ERROR'
};

/**
 * Linear project creation functionality
 */
export class LinearProjectCreator {
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
	 * Create a new project in Linear
	 *
	 * @param {Object} projectData - Project data
	 * @param {string} projectData.name - Project name
	 * @param {string} projectData.teamId - Team ID where project will be created
	 * @param {string} [projectData.description] - Project description
	 * @param {string} [projectData.key] - Project key (auto-generated if not provided)
	 * @param {string} [projectData.color] - Project color
	 * @param {string} [projectData.state] - Project state (backlog, planned, started, etc.)
	 * @returns {Promise<Object>} Created project object
	 * @throws {Error} When project creation fails
	 */
	async createProject(projectData) {
		const {
			name,
			teamId,
			description = '',
			key,
			color,
			state = 'planned'
		} = projectData;

		if (!name || typeof name !== 'string') {
			throw new Error('Project name is required and must be a string');
		}

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
			log('debug', `Creating project "${name}" in team ${teamId}...`);

			// Prepare the project input
			const projectInput = {
				name: name.trim(),
				teamId,
				...(description && { description: description.trim() }),
				...(key && { key: key.trim().toUpperCase() }),
				...(color && { color }),
				...(state && { state })
			};

			// Use retry logic for robust project creation
			const result = await this._retryOperation(async () => {
				// Use the Linear SDK's project creation mutation
				const mutation = await this.linear.projectCreate({
					input: projectInput
				});

				return mutation;
			}, 'create project');

			if (!result.success) {
				const error = new Error(
					`Project creation failed: ${result.lastSyncId || 'Unknown error'}`
				);
				error.code = PROJECT_CREATION_ERRORS.API_ERROR;
				error.details = result;
				throw error;
			}

			const project = result.project;
			if (!project) {
				const error = new Error(
					'Project creation succeeded but no project data returned'
				);
				error.code = PROJECT_CREATION_ERRORS.API_ERROR;
				throw error;
			}

			log(
				'info',
				`Successfully created project: ${project.name} (${project.id})`
			);

			// Transform project data to match our existing project structure
			return {
				id: project.id,
				name: project.name,
				key: project.key || '',
				description: project.description || '',
				state: project.state?.name || state,
				teamId: project.team?.id || teamId,
				url: project.url || '',
				displayName: project.key
					? `${project.name} (${project.key})`
					: project.name,
				summary: `${project.state?.name || state} • 0 issues • 0% complete`,
				statusIndicator: this._getStatusIndicator(project.state?.name || state),
				searchText:
					`${project.name} ${project.key || ''} ${project.description || ''}`.toLowerCase()
			};
		} catch (error) {
			throw this._enhanceError(error, 'create project');
		}
	}

	/**
	 * Prompt user for project name with git repo name as default
	 *
	 * @param {string} [defaultName] - Default project name (usually git repo name)
	 * @returns {Promise<string>} User-selected project name
	 */
	async promptForProjectName(defaultName = '') {
		const questions = [
			{
				type: 'input',
				name: 'projectName',
				message: 'Enter project name:',
				default: defaultName,
				validate: (input) => {
					if (!input || !input.trim()) {
						return 'Project name is required';
					}
					if (input.trim().length < 2) {
						return 'Project name must be at least 2 characters long';
					}
					if (input.trim().length > 100) {
						return 'Project name must be less than 100 characters';
					}
					return true;
				}
			}
		];

		const answers = await inquirer.prompt(questions);
		return answers.projectName.trim();
	}

	/**
	 * Prompt user for optional project details
	 *
	 * @param {string} projectName - The project name
	 * @returns {Promise<Object>} Additional project details
	 */
	async promptForProjectDetails(projectName) {
		const questions = [
			{
				type: 'input',
				name: 'description',
				message: 'Enter project description (optional):',
				default: `TaskMaster integration for ${projectName}`
			},
			{
				type: 'list',
				name: 'state',
				message: 'Select initial project state:',
				choices: [
					{
						name: '📋 Backlog - Project ideas and future work',
						value: 'backlog'
					},
					{ name: '📅 Planned - Ready to start work', value: 'planned' },
					{ name: '🚀 Started - Active development', value: 'started' }
				],
				default: 'planned'
			}
		];

		return await inquirer.prompt(questions);
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
		if (error.code === PROJECT_CREATION_ERRORS.TEAM_ACCESS_ERROR) {
			return true;
		}

		// Validation errors are not retryable
		if (error.code === PROJECT_CREATION_ERRORS.VALIDATION_ERROR) {
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
			Object.values(PROJECT_CREATION_ERRORS).includes(error.code)
		) {
			return error;
		}

		const enhancedError = new Error(`Failed to ${operation}: ${error.message}`);
		enhancedError.originalError = error;

		// Classify error types
		if (error.message?.includes('Authentication') || error.status === 401) {
			enhancedError.code = PROJECT_CREATION_ERRORS.AUTHENTICATION_ERROR;
		} else if (error.message?.includes('rate limit') || error.status === 429) {
			enhancedError.code = PROJECT_CREATION_ERRORS.RATE_LIMIT;
		} else if (
			error.message?.includes('Network') ||
			error.code === 'ECONNRESET' ||
			error.code === 'ENOTFOUND'
		) {
			enhancedError.code = PROJECT_CREATION_ERRORS.NETWORK_ERROR;
		} else if (
			error.message?.includes('Team') ||
			error.message?.includes('access denied')
		) {
			enhancedError.code = PROJECT_CREATION_ERRORS.TEAM_ACCESS_ERROR;
		} else if (
			error.message?.includes('validation') ||
			error.message?.includes('required')
		) {
			enhancedError.code = PROJECT_CREATION_ERRORS.VALIDATION_ERROR;
		} else {
			enhancedError.code = PROJECT_CREATION_ERRORS.API_ERROR;
		}

		return enhancedError;
	}
}

/**
 * Convenience function to create a new Linear project
 *
 * @param {string} apiKey - Linear API key
 * @param {Object} projectData - Project data
 * @returns {Promise<Object>} Created project object
 */
export async function createLinearProject(apiKey, projectData) {
	const creator = new LinearProjectCreator({ apiKey });
	return await creator.createProject(projectData);
}

/**
 * Interactive project creation with git repo name as default
 *
 * @param {string} apiKey - Linear API key
 * @param {string} teamId - Team ID where project will be created
 * @param {string} [defaultName] - Default project name (usually git repo name)
 * @returns {Promise<Object>} Created project object
 */
export async function createLinearProjectInteractive(
	apiKey,
	teamId,
	defaultName = ''
) {
	const creator = new LinearProjectCreator({ apiKey });

	// Display creation header
	messages.header('Create New Linear Project');
	console.log(
		'🚀 Creating a new Linear project for your TaskMaster repository.\n'
	);

	if (defaultName) {
		console.log(`📁 Detected git repository: ${defaultName}`);
		console.log(
			'💡 You can customize the project name or use the git repository name as default.\n'
		);
	}

	// Get project name from user
	const projectName = await creator.promptForProjectName(defaultName);

	// Get additional project details
	const details = await creator.promptForProjectDetails(projectName);

	// Create the project
	messages.info('Creating project...');
	const project = await creator.createProject({
		name: projectName,
		teamId,
		description: details.description,
		state: details.state
	});

	messages.success(`✅ Project created successfully: ${project.displayName}`);
	return project;
}
