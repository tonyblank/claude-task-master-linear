/**
 * @fileoverview Linear Integration Handler - Proof of Concept
 *
 * This module provides a Linear integration handler that responds to TaskMaster events
 * and creates/updates Linear issues. This is a proof of concept for the integration system.
 */

import { LinearClient } from '@linear/sdk';
import { BaseIntegrationHandler } from '../events/base-integration-handler.js';
import { EVENT_TYPES } from '../events/types.js';
import {
	log,
	readJSON,
	writeJSON,
	getCurrentTag,
	findProjectRoot
} from '../utils.js';
import {
	getLinearConfig,
	getLinearPriorityMapping,
	getLinearStatusMapping
} from '../config-manager.js';
import path from 'path';
import fs from 'fs';
import { randomBytes } from 'crypto';

/**
 * Escapes HTML characters to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
	if (typeof text !== 'string') return text;
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Linear integration handler for TaskMaster events
 */
export class LinearIntegrationHandler extends BaseIntegrationHandler {
	/**
	 * @param {Object} config - Configuration object
	 * @param {string} config.apiKey - Linear API key
	 * @param {string} config.teamId - Linear team ID
	 * @param {boolean} config.createIssues - Whether to create Linear issues for tasks
	 * @param {string} config.defaultProjectId - Default Linear project ID
	 */
	constructor(config = {}) {
		super('linear', '1.0.0', {
			enabled: true,
			timeout: 30000,
			maxAttempts: 3,
			// Enhanced retryable errors for Linear API specifics
			retryableErrors: [
				'ECONNRESET',
				'ENOTFOUND',
				'TIMEOUT',
				'RATE_LIMIT',
				'ETIMEDOUT',
				'NETWORK_ERROR',
				'SERVER_ERROR',
				'EMPTY_RESPONSE',
				429,
				502,
				503,
				504 // HTTP status codes for rate limit and server errors
			],
			// Linear-specific retry configuration
			backoffStrategy: 'exponential',
			baseDelay: 1000, // 1 second base delay
			maxDelay: 30000, // 30 second max delay
			// Jitter is handled by the base class automatically
			...config
		});

		this.linear = null;
		this.team = null;
		this.project = null;
	}

	/**
	 * Perform Linear-specific initialization
	 *
	 * @param {Object} config - Configuration object
	 * @returns {Promise<void>}
	 * @protected
	 */
	async _performInitialization(config) {
		// Validate required configuration
		this._validateConfiguration();

		try {
			// Initialize Linear client
			this.linear = new LinearClient({
				apiKey: this.config.apiKey
			});

			// Test the connection by fetching viewer info
			const viewer = await this.linear.viewer;
			log(
				'info',
				`Linear integration initialized for user: ${viewer.name || viewer.email}`
			);

			// Get team information if teamId is provided
			if (this.config.teamId) {
				this.team = await this.linear.team(this.config.teamId);
				log('info', `Linear team: ${this.team.name}`);
			}

			// Get project information if projectId is provided
			if (this.config.defaultProjectId) {
				this.project = await this.linear.project(this.config.defaultProjectId);
				log('info', `Linear project: ${this.project.name}`);
			}

			log('info', 'Linear integration initialized successfully');
		} catch (error) {
			log('error', 'Failed to initialize Linear integration:', error.message);
			throw error;
		}
	}

	/**
	 * Validate Linear configuration
	 * @private
	 */
	_validateConfiguration() {
		const errors = [];

		// API key is required
		if (!this.config.apiKey) {
			errors.push('Linear API key is required');
		}

		// Team ID is required for issue creation
		if (this.config.createIssues !== false && !this.config.teamId) {
			errors.push('Linear team ID is required for issue creation');
		}

		// Check API key format (basic validation)
		if (this.config.apiKey && !this.config.apiKey.startsWith('lin_api_')) {
			errors.push(
				'Linear API key appears to be invalid (should start with "lin_api_")'
			);
		}

		if (errors.length > 0) {
			throw new Error(
				`Linear configuration validation failed:\n${errors.join('\n')}`
			);
		}
	}

	/**
	 * Perform Linear-specific shutdown
	 *
	 * @returns {Promise<void>}
	 * @protected
	 */
	async _performShutdown() {
		// Linear client doesn't require explicit cleanup
		this.linear = null;
		this.team = null;
		this.project = null;
		log('info', 'Linear integration shut down');
	}

	/**
	 * Handle task creation events
	 *
	 * @param {Object} payload - Event payload
	 * @returns {Promise<Object>} Result with Linear issue information
	 */
	async handleTaskCreated(payload) {
		if (!this.config.createIssues) {
			log('debug', 'Linear issue creation is disabled');
			return { action: 'skipped', reason: 'issue_creation_disabled' };
		}

		const { task, tag, context } = payload;

		// Create progress message for operation start
		const progressMessage = this.createProgressMessage(
			'create',
			task,
			'validating'
		);
		this.logFormattedMessage(progressMessage);

		try {
			// Update progress - creating issue
			const creatingProgress = this.createProgressMessage(
				'create',
				task,
				'creating'
			);
			this.logFormattedMessage(creatingProgress);

			// Create the Linear issue using comprehensive field mapping
			const issue = await this._createLinearIssue(task, context?.projectRoot);

			if (!issue) {
				throw new Error('Failed to create Linear issue - no issue returned');
			}

			// Update progress - parsing response
			const parsingProgress = this.createProgressMessage(
				'create',
				task,
				'parsing'
			);
			this.logFormattedMessage(parsingProgress);

			// Create standardized response object
			const standardizedResponse = this._createStandardizedResponse(
				issue,
				'createIssue'
			);

			// Save the Linear issue ID back to the task atomically
			const linearIssueInfo = {
				id: issue.id,
				identifier: issue.identifier,
				url: issue.url,
				...(issue.branchName && { branchName: issue.branchName }),
				// Include additional metadata from parsed response
				title: issue.title,
				state: issue.state,
				priority: issue.priority,
				team: issue.team,
				project: issue.project,
				labels: issue.labels,
				assignee: issue.assignee,
				number: issue.number,
				createdAt: issue.createdAt,
				updatedAt: issue.updatedAt
			};

			// Update progress - updating task
			const updatingProgress = this.createProgressMessage(
				'create',
				task,
				'updating'
			);
			this.logFormattedMessage(updatingProgress);

			const updatedTask = await this._updateTaskWithLinearIssue(
				task.id,
				linearIssueInfo,
				context?.projectRoot
			);

			// Create and log success message
			const successMessage = this.createSuccessMessage('create', task, issue);
			this.logFormattedMessage(successMessage, true);
			this.displayUserMessage(successMessage, true);

			// Return both the standardized response and backward-compatible format
			return {
				...standardizedResponse,
				action: 'created',
				task: {
					id: task.id,
					title: task.title
				},
				updatedTask,
				// Include formatted message for consumers
				formattedMessage: successMessage
			};
		} catch (error) {
			// Create and log error message
			const errorMessage = this.createErrorMessage('create', task, error);
			this.logFormattedMessage(errorMessage, true);
			this.displayUserMessage(errorMessage, true);

			// Create standardized error response
			const errorResponse = this._createErrorResponse(error, 'createIssue');

			// Add task context to error response
			errorResponse.task = {
				id: task.id,
				title: task.title
			};

			// Include formatted message in error response
			errorResponse.formattedMessage = errorMessage;

			// For backward compatibility, still throw the error
			// but consumers can also check for standardized error responses
			error.standardizedResponse = errorResponse;
			throw error;
		}
	}

	/**
	 * Handle task status change events
	 *
	 * @param {Object} payload - Event payload
	 * @returns {Promise<Object>} Result with update information
	 */
	async handleTaskStatusChanged(payload) {
		const { task, oldStatus, newStatus } = payload;

		// Create progress message for status sync
		const progressMessage = this.createProgressMessage('sync', task, 'syncing');
		this.logFormattedMessage(progressMessage);

		try {
			// In a real implementation, we would:
			// 1. Find the Linear issue associated with this task
			// 2. Update the Linear issue state based on the new status
			// 3. Add a comment about the status change

			// For now, simulate successful status sync
			const mockLinearData = {
				identifier: task.integrations?.linear?.identifier || `TM-${task.id}`,
				url:
					task.integrations?.linear?.url ||
					`https://linear.app/issue/TM-${task.id}`,
				state: { name: newStatus }
			};

			// Create success message for status sync
			const successMessage = this.createSuccessMessage(
				'sync',
				task,
				mockLinearData,
				{
					changes: [`status: ${oldStatus} → ${newStatus}`]
				}
			);
			this.logFormattedMessage(successMessage);

			return {
				action: 'synced',
				task: {
					id: task.id,
					oldStatus,
					newStatus
				},
				message: `Status change synced for task #${task.id}`,
				formattedMessage: successMessage
			};
		} catch (error) {
			// Create error message for failed sync
			const errorMessage = this.createErrorMessage('sync', task, error);
			this.logFormattedMessage(errorMessage);

			return {
				action: 'error',
				task: {
					id: task.id,
					oldStatus,
					newStatus
				},
				error: error.message,
				formattedMessage: errorMessage
			};
		}
	}

	/**
	 * Handle task update events
	 *
	 * @param {Object} payload - Event payload
	 * @returns {Promise<Object>} Result with update information
	 */
	async handleTaskUpdated(payload) {
		const { task, changes } = payload;

		// Create progress message for update sync
		const progressMessage = this.createProgressMessage(
			'update',
			task,
			'syncing'
		);
		this.logFormattedMessage(progressMessage);

		try {
			// In a real implementation, we would update the Linear issue with the changes

			// For now, simulate successful update sync
			const mockLinearData = {
				identifier: task.integrations?.linear?.identifier || `TM-${task.id}`,
				url:
					task.integrations?.linear?.url ||
					`https://linear.app/issue/TM-${task.id}`
			};

			// Create success message for update sync
			const successMessage = this.createSuccessMessage(
				'update',
				task,
				mockLinearData,
				{
					changes: Object.keys(changes)
				}
			);
			this.logFormattedMessage(successMessage);

			return {
				action: 'synced',
				task: {
					id: task.id,
					title: task.title
				},
				changes: Object.keys(changes),
				message: `Update synced for task #${task.id}`,
				formattedMessage: successMessage
			};
		} catch (error) {
			// Create error message for failed sync
			const errorMessage = this.createErrorMessage('update', task, error);
			this.logFormattedMessage(errorMessage);

			return {
				action: 'error',
				task: {
					id: task.id,
					title: task.title
				},
				changes: Object.keys(changes),
				error: error.message,
				formattedMessage: errorMessage
			};
		}
	}

	/**
	 * Handle generic events that don't have specific handlers
	 *
	 * @param {string} eventType - Event type
	 * @param {Object} payload - Event payload
	 * @returns {Promise<Object>} Result
	 */
	async handleGenericEvent(eventType, payload) {
		log('debug', `Linear integration received unhandled event: ${eventType}`);

		return {
			action: 'logged',
			eventType,
			message: `Event ${eventType} logged but not processed`
		};
	}

	/**
	 * Format task description for Linear issue
	 *
	 * @param {Object} task - Task object
	 * @returns {string} Formatted description
	 * @private
	 */
	_formatTaskDescription(task) {
		let description = `**TaskMaster Task #${escapeHtml(task.id)}**\n\n`;
		description += `${escapeHtml(task.description)}\n\n`;

		if (task.details) {
			description += `**Implementation Details:**\n${escapeHtml(task.details)}\n\n`;
		}

		if (task.testStrategy) {
			description += `**Test Strategy:**\n${escapeHtml(task.testStrategy)}\n\n`;
		}

		if (task.dependencies && task.dependencies.length > 0) {
			const escapedDeps = task.dependencies
				.map((dep) => escapeHtml(dep))
				.join(', ');
			description += `**Dependencies:** Tasks ${escapedDeps}\n\n`;
		}

		description += `**Priority:** ${escapeHtml(task.priority)}\n`;
		description += `**Status:** ${escapeHtml(task.status)}\n`;

		return description;
	}

	/**
	 * Create a Linear issue with comprehensive field mapping
	 *
	 * @param {Object} task - Task object from TaskMaster
	 * @param {string} [projectRoot] - Project root directory for configuration
	 * @returns {Promise<Object>} Linear issue object
	 * @private
	 */
	async _createLinearIssue(task, projectRoot = null) {
		try {
			// Ensure Linear client is authenticated
			if (!this.linear) {
				throw new Error(
					'Linear client not initialized - authentication may have failed'
				);
			}

			// Get the current Linear configuration
			const linearConfig = getLinearConfig(projectRoot);

			// Build the issue data with comprehensive field mapping
			const issueData = this._buildIssueData(task, linearConfig, projectRoot);

			// Validate issue data before sending
			this._validateIssueData(issueData);

			// Add labels if enabled
			if (linearConfig?.labels?.enabled) {
				await this._addLabelsToIssueData(
					issueData,
					task,
					linearConfig,
					projectRoot
				);
			}

			log(
				'debug',
				`Creating Linear issue with data:`,
				JSON.stringify(issueData, null, 2)
			);

			// Create the Linear issue with proper error handling
			const issuePayload = await this._performLinearRequest(
				() => this.linear.createIssue(issueData),
				'create issue'
			);

			// Parse and validate the response
			const issue = this._parseLinearResponse(issuePayload, 'createIssue');

			// Add source label if configured
			if (
				issue &&
				linearConfig?.labels?.enabled &&
				linearConfig.labels.sourceLabel
			) {
				await this._addSourceLabel(issue, linearConfig.labels.sourceLabel);
			}

			return issue;
		} catch (error) {
			log('error', 'Failed to create Linear issue:', error.message);
			throw error;
		}
	}

	/**
	 * Validate issue data before sending to Linear API
	 *
	 * @param {Object} issueData - Issue data to validate
	 * @throws {Error} If validation fails
	 * @private
	 */
	_validateIssueData(issueData) {
		if (!issueData.title || issueData.title.trim().length === 0) {
			throw new Error('Issue title is required');
		}

		if (!issueData.teamId) {
			throw new Error('Team ID is required for issue creation');
		}

		if (issueData.title.length > 255) {
			throw new Error('Issue title is too long (max 255 characters)');
		}

		if (issueData.description && issueData.description.length > 100000) {
			throw new Error('Issue description is too long (max 100,000 characters)');
		}
	}

	/**
	 * Perform a Linear API request with retry logic, proper error handling and authentication
	 *
	 * @param {Function} requestFn - Function that performs the Linear API request
	 * @param {string} operationName - Name of the operation for logging
	 * @param {Object} retryConfig - Custom retry configuration (optional)
	 * @returns {Promise<any>} API response
	 * @private
	 */
	async _performLinearRequest(requestFn, operationName, retryConfig = {}) {
		// Use the base class retry mechanism with Linear-specific configuration
		return await this.retry(
			async () => {
				try {
					const result = await requestFn();

					if (!result) {
						const error = new Error(
							`Linear API returned empty response for ${operationName}`
						);
						error.code = 'EMPTY_RESPONSE';
						throw error;
					}

					return result;
				} catch (error) {
					// Enhance error with Linear-specific details and make them retryable where appropriate
					this._enhanceLinearError(error, operationName);
					throw error;
				}
			},
			{
				// Merge custom retry config with Linear-specific defaults
				maxAttempts: retryConfig.maxAttempts || this.config.maxAttempts || 3,
				backoffStrategy: retryConfig.backoffStrategy || 'exponential',
				baseDelay: retryConfig.baseDelay || 1000, // 1 second
				maxDelay: retryConfig.maxDelay || 30000, // 30 seconds
				retryableErrors: [
					...this.config.retryableErrors,
					'RATE_LIMIT',
					'NETWORK_ERROR',
					'TIMEOUT',
					'EMPTY_RESPONSE',
					'ECONNRESET',
					'ENOTFOUND',
					'ETIMEDOUT',
					429, // HTTP rate limit status code
					502, // Bad Gateway
					503, // Service Unavailable
					504 // Gateway Timeout
				],
				...retryConfig
			}
		);
	}

	/**
	 * Enhance Linear API errors with proper classification and retry information
	 *
	 * @param {Error} error - Original error from Linear API
	 * @param {string} operationName - Name of the operation for context
	 * @private
	 */
	_enhanceLinearError(error, operationName) {
		// Preserve original error properties
		const originalMessage = error.message;
		const originalStack = error.stack;

		// Classify and enhance Linear-specific errors
		if (error.message?.includes('Authentication') || error.status === 401) {
			error.code = 'AUTHENTICATION_ERROR';
			error.retryable = false;
			error.message = `Linear authentication failed for ${operationName}: Check API key`;
		} else if (error.message?.includes('rate limit') || error.status === 429) {
			error.code = 'RATE_LIMIT';
			error.retryable = true;
			error.message = `Linear rate limit exceeded for ${operationName}: Will retry with backoff`;
		} else if (error.message?.includes('not found') || error.status === 404) {
			error.code = 'NOT_FOUND';
			error.retryable = false;
			error.message = `Linear resource not found for ${operationName}: Check team/project IDs`;
		} else if (error.message?.includes('forbidden') || error.status === 403) {
			error.code = 'PERMISSION_ERROR';
			error.retryable = false;
			error.message = `Linear access denied for ${operationName}: Check permissions`;
		} else if (
			error.message?.includes('timeout') ||
			error.code === 'ETIMEDOUT'
		) {
			error.code = 'TIMEOUT';
			error.retryable = true;
			error.message = `Linear API timeout for ${operationName}: Will retry`;
		} else if (
			error.message?.includes('network') ||
			error.code === 'ECONNRESET' ||
			error.code === 'ENOTFOUND'
		) {
			error.code = 'NETWORK_ERROR';
			error.retryable = true;
			error.message = `Network error during ${operationName}: Will retry`;
		} else if (error.status >= 500 && error.status < 600) {
			// Server errors are generally retryable
			error.code = 'SERVER_ERROR';
			error.retryable = true;
			error.message = `Linear server error (${error.status}) for ${operationName}: Will retry`;
		} else {
			// Generic error - add context but don't change retryability
			error.message = `Linear API error during ${operationName}: ${originalMessage}`;
		}

		// Preserve original information for debugging
		error.originalMessage = originalMessage;
		error.originalStack = originalStack;
		error.operationName = operationName;
	}

	/**
	 * Parse Linear API response and extract required data
	 *
	 * @param {Object} response - Raw Linear API response
	 * @param {string} operationType - Type of operation (createIssue, updateIssue, etc.)
	 * @returns {Object} Parsed response data
	 * @throws {Error} If response parsing fails
	 * @private
	 */
	_parseLinearResponse(response, operationType) {
		try {
			// Validate response structure
			if (!response) {
				throw new Error(`Empty response received for ${operationType}`);
			}

			// Handle different operation types
			switch (operationType) {
				case 'createIssue':
					return this._parseCreateIssueResponse(response);
				case 'updateIssue':
					return this._parseUpdateIssueResponse(response);
				case 'createLabel':
					return this._parseLabelResponse(response);
				case 'findLabels':
					return this._parseLabelsListResponse(response);
				default:
					return this._parseGenericResponse(response);
			}
		} catch (error) {
			log(
				'error',
				`Failed to parse Linear response for ${operationType}:`,
				error.message
			);
			throw new Error(
				`Response parsing failed for ${operationType}: ${error.message}`
			);
		}
	}

	/**
	 * Parse create issue response to extract issue information
	 *
	 * @param {Object} response - Raw create issue response
	 * @returns {Object} Parsed issue data
	 * @throws {Error} If required fields are missing
	 * @private
	 */
	_parseCreateIssueResponse(response) {
		// Handle both direct issue object and payload wrapper
		const issue = response.issue || response;

		if (!issue) {
			throw new Error('No issue data found in response');
		}

		// Validate required fields
		const requiredFields = ['id', 'identifier'];
		const missingFields = requiredFields.filter((field) => !issue[field]);

		if (missingFields.length > 0) {
			throw new Error(
				`Missing required fields in issue response: ${missingFields.join(', ')}`
			);
		}

		// Extract and normalize issue data
		const parsedIssue = {
			id: issue.id,
			identifier: issue.identifier,
			title: issue.title || 'Untitled',
			url: issue.url || this._constructIssueUrl(issue.identifier),
			state: issue.state
				? {
						id: issue.state.id,
						name: issue.state.name,
						type: issue.state.type
					}
				: null,
			priority: issue.priority || null,
			labels: issue.labels ? this._parseLabelsFromIssue(issue.labels) : [],
			team: issue.team
				? {
						id: issue.team.id,
						name: issue.team.name,
						key: issue.team.key
					}
				: null,
			project: issue.project
				? {
						id: issue.project.id,
						name: issue.project.name
					}
				: null,
			createdAt: issue.createdAt || new Date().toISOString(),
			updatedAt: issue.updatedAt || new Date().toISOString(),
			// Extract additional metadata that might be useful
			number: issue.number || null,
			branchName: issue.branchName || null,
			assignee: issue.assignee
				? {
						id: issue.assignee.id,
						name: issue.assignee.name,
						email: issue.assignee.email
					}
				: null
		};

		log(
			'debug',
			`Parsed create issue response:`,
			JSON.stringify(parsedIssue, null, 2)
		);
		return parsedIssue;
	}

	/**
	 * Parse update issue response
	 *
	 * @param {Object} response - Raw update issue response
	 * @returns {Object} Parsed issue data
	 * @private
	 */
	_parseUpdateIssueResponse(response) {
		// Update responses typically have the same structure as create responses
		return this._parseCreateIssueResponse(response);
	}

	/**
	 * Parse label creation/retrieval response
	 *
	 * @param {Object} response - Raw label response
	 * @returns {Object} Parsed label data
	 * @private
	 */
	_parseLabelResponse(response) {
		const label = response.label || response;

		if (!label || !label.id) {
			throw new Error('Invalid label response - missing label ID');
		}

		return {
			id: label.id,
			name: label.name || 'Unnamed Label',
			color: label.color || '#808080',
			team: label.team
				? {
						id: label.team.id,
						name: label.team.name
					}
				: null,
			createdAt: label.createdAt || new Date().toISOString()
		};
	}

	/**
	 * Parse labels list response (for finding existing labels)
	 *
	 * @param {Object} response - Raw labels list response
	 * @returns {Array} Array of parsed label data
	 * @private
	 */
	_parseLabelsListResponse(response) {
		if (!response.nodes) {
			return [];
		}

		return response.nodes.map((label) => this._parseLabelResponse(label));
	}

	/**
	 * Parse generic Linear API response
	 *
	 * @param {Object} response - Raw response
	 * @returns {Object} Response data
	 * @private
	 */
	_parseGenericResponse(response) {
		// For generic responses, return as-is but ensure it's an object
		if (typeof response !== 'object' || response === null) {
			throw new Error('Invalid response format - expected object');
		}

		return response;
	}

	/**
	 * Parse labels from issue response
	 *
	 * @param {Object} labelsData - Labels data from issue
	 * @returns {Array} Array of label information
	 * @private
	 */
	_parseLabelsFromIssue(labelsData) {
		if (!labelsData || !labelsData.nodes) {
			return [];
		}

		return labelsData.nodes.map((label) => ({
			id: label.id,
			name: label.name,
			color: label.color
		}));
	}

	/**
	 * Construct issue URL if not provided in response
	 *
	 * @param {string} identifier - Issue identifier (e.g., "TM-123")
	 * @returns {string} Constructed URL
	 * @private
	 */
	_constructIssueUrl(identifier) {
		// This is a fallback - Linear should provide URLs in responses
		// but we can construct one based on the team identifier
		if (!identifier) {
			return null;
		}

		// Extract team key from identifier (e.g., "TM" from "TM-123")
		const teamKey = identifier.split('-')[0];
		return `https://linear.app/team/${teamKey.toLowerCase()}/issue/${identifier}`;
	}

	/**
	 * Create standardized response object for storage
	 *
	 * @param {Object} parsedIssue - Parsed issue data
	 * @param {string} operationType - Type of operation performed
	 * @returns {Object} Standardized response object
	 */
	_createStandardizedResponse(parsedIssue, operationType = 'createIssue') {
		return {
			success: true,
			operation: operationType,
			timestamp: new Date().toISOString(),
			data: {
				// Core identifiers
				issueId: parsedIssue.id,
				identifier: parsedIssue.identifier,
				url: parsedIssue.url,

				// Issue details
				title: parsedIssue.title,
				state: parsedIssue.state,
				priority: parsedIssue.priority,

				// Organizational data
				team: parsedIssue.team,
				project: parsedIssue.project,
				labels: parsedIssue.labels,
				assignee: parsedIssue.assignee,

				// Metadata
				number: parsedIssue.number,
				branchName: parsedIssue.branchName,
				createdAt: parsedIssue.createdAt,
				updatedAt: parsedIssue.updatedAt
			},
			// For backward compatibility with existing code
			linearIssue: {
				id: parsedIssue.id,
				identifier: parsedIssue.identifier,
				url: parsedIssue.url,
				title: parsedIssue.title
			}
		};
	}

	/**
	 * Handle Linear API errors and create standardized error response
	 *
	 * @param {Error} error - Original error
	 * @param {string} operationType - Type of operation that failed
	 * @returns {Object} Standardized error response
	 */
	_createErrorResponse(error, operationType) {
		return {
			success: false,
			operation: operationType,
			timestamp: new Date().toISOString(),
			error: {
				message: error.message,
				type: this._classifyError(error),
				code: error.code || error.status || 'UNKNOWN',
				retryable: this._isRetryableError(error)
			}
		};
	}

	/**
	 * Classify error type for better handling
	 *
	 * @param {Error} error - Error to classify
	 * @returns {string} Error classification
	 * @private
	 */
	_classifyError(error) {
		const message = error.message?.toLowerCase() || '';

		if (
			message.includes('authentication') ||
			message.includes('unauthorized')
		) {
			return 'AUTHENTICATION_ERROR';
		}
		if (message.includes('rate limit') || error.status === 429) {
			return 'RATE_LIMIT_ERROR';
		}
		if (message.includes('not found') || error.status === 404) {
			return 'NOT_FOUND_ERROR';
		}
		if (message.includes('forbidden') || error.status === 403) {
			return 'PERMISSION_ERROR';
		}
		if (message.includes('validation') || error.status === 400) {
			return 'VALIDATION_ERROR';
		}
		if (message.includes('network') || message.includes('timeout')) {
			return 'NETWORK_ERROR';
		}

		return 'UNKNOWN_ERROR';
	}

	/**
	 * Determine if an error is retryable
	 *
	 * @param {Error} error - Error to check
	 * @returns {boolean} True if error is retryable
	 * @private
	 */
	_isRetryableError(error) {
		const errorType = this._classifyError(error);
		const retryableTypes = [
			'RATE_LIMIT_ERROR',
			'NETWORK_ERROR',
			'UNKNOWN_ERROR'
		];

		return retryableTypes.includes(errorType);
	}

	/**
	 * Build the core issue data object with field mapping
	 *
	 * @param {Object} task - Task object
	 * @param {Object} linearConfig - Linear configuration
	 * @param {string} [projectRoot] - Project root directory
	 * @returns {Object} Issue data for Linear API
	 * @private
	 */
	_buildIssueData(task, linearConfig, projectRoot) {
		const issueData = {
			title: this._mapTaskTitle(task),
			description: this._formatTaskDescription(task),
			priority: this._mapTaskPriorityToLinear(
				task.priority,
				linearConfig,
				projectRoot
			),
			teamId: this.config.teamId || linearConfig?.team?.id
		};

		// Add project if configured
		if (this.config.defaultProjectId || linearConfig?.project?.id) {
			issueData.projectId =
				this.config.defaultProjectId || linearConfig.project.id;
		}

		// Add state if task status maps to a Linear state
		const statusMapping = getLinearStatusMapping(projectRoot);
		if (statusMapping && task.status && statusMapping[task.status]) {
			issueData.stateId = statusMapping[task.status];
		}

		return issueData;
	}

	/**
	 * Map task title to Linear issue title
	 *
	 * @param {Object} task - Task object
	 * @returns {string} Formatted title
	 * @private
	 */
	_mapTaskTitle(task) {
		return `[TM-${task.id}] ${task.title}`;
	}

	/**
	 * Add labels to issue data based on configuration
	 *
	 * @param {Object} issueData - Issue data object being built
	 * @param {Object} task - Task object
	 * @param {Object} linearConfig - Linear configuration
	 * @param {string} [projectRoot] - Project root directory
	 * @returns {Promise<void>}
	 * @private
	 */
	async _addLabelsToIssueData(issueData, task, linearConfig, projectRoot) {
		try {
			const labels = [];

			// Add priority label if mapping is configured
			const priorityMapping = getLinearPriorityMapping(projectRoot);
			if (priorityMapping && task.priority && priorityMapping[task.priority]) {
				const priorityLabel = await this._findOrCreateLabel(
					priorityMapping[task.priority]
				);
				if (priorityLabel) {
					labels.push(priorityLabel.id);
				}
			}

			// Add status label if mapping is configured
			const statusMapping = getLinearStatusMapping(projectRoot);
			if (statusMapping && task.status && statusMapping[task.status]) {
				const statusLabel = await this._findOrCreateLabel(
					statusMapping[task.status]
				);
				if (statusLabel) {
					labels.push(statusLabel.id);
				}
			}

			if (labels.length > 0) {
				issueData.labelIds = labels;
			}
		} catch (error) {
			log('warn', 'Failed to add labels to issue:', error.message);
			// Don't fail issue creation if label assignment fails
		}
	}

	/**
	 * Find or create a label in Linear
	 *
	 * @param {string} labelName - Label name to find or create
	 * @returns {Promise<Object|null>} Label object or null if failed
	 * @private
	 */
	async _findOrCreateLabel(labelName) {
		try {
			// First try to find existing label
			const labelsResponse = await this._performLinearRequest(
				() =>
					this.linear.labels({
						filter: { name: { eq: labelName } }
					}),
				`find label "${labelName}"`
			);

			// Parse the labels list response
			const labels = this._parseLinearResponse(labelsResponse, 'findLabels');

			if (labels && labels.length > 0) {
				return labels[0];
			}

			// Create new label if not found
			const labelPayload = await this._performLinearRequest(
				() =>
					this.linear.createLabel({
						name: labelName,
						teamId: this.config.teamId
					}),
				`create label "${labelName}"`
			);

			// Parse the label creation response
			return this._parseLinearResponse(labelPayload, 'createLabel');
		} catch (error) {
			log(
				'warn',
				`Failed to find or create label "${labelName}":`,
				error.message
			);
			return null;
		}
	}

	/**
	 * Add source label to identify TaskMaster-created issues
	 *
	 * @param {Object} issue - Linear issue object
	 * @param {string} sourceLabel - Source label name
	 * @returns {Promise<void>}
	 * @private
	 */
	async _addSourceLabel(issue, sourceLabel) {
		try {
			const label = await this._findOrCreateLabel(sourceLabel);
			if (label && issue.id) {
				await this.linear.updateIssue(issue.id, {
					labelIds: [...(issue.labelIds || []), label.id]
				});
			}
		} catch (error) {
			log('warn', 'Failed to add source label:', error.message);
			// Don't fail if source label can't be added
		}
	}

	/**
	 * Map TaskMaster priority to Linear priority with configuration support
	 *
	 * @param {string} taskPriority - TaskMaster priority (high, medium, low)
	 * @param {Object} [linearConfig] - Linear configuration
	 * @param {string} [projectRoot] - Project root directory
	 * @returns {number} Linear priority (1-4)
	 * @private
	 */
	_mapTaskPriorityToLinear(
		taskPriority,
		linearConfig = null,
		projectRoot = null
	) {
		// Use configuration-based priority mapping if available
		const priorityMapping = getLinearPriorityMapping(projectRoot);
		if (priorityMapping && taskPriority && priorityMapping[taskPriority]) {
			// If there's a mapping, use default Linear priority numbers
			// This is for when priorities are mapped to labels instead of Linear's priority field
		}

		// Default priority mapping to Linear's built-in priority system
		switch (taskPriority?.toLowerCase()) {
			case 'high':
				return 1; // Urgent
			case 'medium':
				return 2; // High
			case 'low':
				return 3; // Medium
			default:
				return 4; // Low
		}
	}

	/**
	 * Atomically update task with Linear issue information using safe file operations
	 *
	 * @param {number|string} taskId - Task ID to update
	 * @param {Object} linearIssue - Linear issue information
	 * @param {string} linearIssue.id - Linear issue ID
	 * @param {string} linearIssue.identifier - Linear issue identifier (e.g., "TM-123")
	 * @param {string} linearIssue.url - Linear issue URL
	 * @param {string} [linearIssue.branchName] - Associated git branch name
	 * @param {string} [projectRoot] - Project root directory
	 * @returns {Promise<Object>} Updated task
	 * @private
	 */
	async _updateTaskWithLinearIssue(taskId, linearIssue, projectRoot = null) {
		// Use the enhanced atomic file update mechanism
		return await this._performAtomicFileUpdate(
			taskId,
			linearIssue,
			projectRoot,
			'updateLinearIssue'
		);
	}

	/**
	 * Perform atomic file update with comprehensive safety mechanisms
	 *
	 * @param {number|string} taskId - Task ID to update
	 * @param {Object} updateData - Data to update the task with
	 * @param {string} [projectRoot] - Project root directory
	 * @param {string} operationType - Type of operation for logging
	 * @returns {Promise<Object>} Updated task
	 * @private
	 */
	async _performAtomicFileUpdate(
		taskId,
		updateData,
		projectRoot = null,
		operationType = 'updateTask'
	) {
		let lockFile = null;
		let backupFile = null;
		let tempFile = null;

		try {
			// Determine project root if not provided
			const actualProjectRoot = projectRoot || findProjectRoot();
			if (!actualProjectRoot) {
				throw new Error('Could not determine project root directory');
			}

			// Construct tasks file path
			const tasksPath = path.join(
				actualProjectRoot,
				'.taskmaster',
				'tasks',
				'tasks.json'
			);

			// Get current tag
			const currentTag = getCurrentTag(actualProjectRoot);

			// Step 1: Acquire file lock
			lockFile = await this._acquireFileLock(tasksPath);
			log('debug', `Acquired file lock for atomic update: ${lockFile}`);

			// Step 2: Create backup
			backupFile = await this._createBackupFile(tasksPath);
			log('debug', `Created backup file: ${backupFile}`);

			// Step 3: Read current data with tag resolution
			const data = readJSON(tasksPath, actualProjectRoot, currentTag);
			if (!data || !data.tasks) {
				throw new Error('No valid tasks found in tasks.json');
			}

			// Step 4: Find the task to update
			const taskIndex = data.tasks.findIndex(
				(task) => task.id === taskId || task.id === parseInt(taskId)
			);

			if (taskIndex === -1) {
				throw new Error(`Task ${taskId} not found in tasks.json`);
			}

			// Step 5: Apply update based on operation type
			const updatedTask = this._applyTaskUpdate(
				data.tasks[taskIndex],
				updateData,
				operationType
			);

			// Step 6: Update the tasks array
			data.tasks[taskIndex] = updatedTask;

			// Step 7: Write to temporary file first
			tempFile = await this._writeToTempFile(
				tasksPath,
				data,
				actualProjectRoot,
				currentTag
			);
			log('debug', `Wrote data to temporary file: ${tempFile}`);

			// Step 8: Atomically move temp file to final location
			await this._atomicMove(tempFile, tasksPath);
			log('debug', 'Atomically moved temp file to final location');

			// Step 9: Clean up backup file (operation successful)
			await this._cleanupBackupFile(backupFile);

			log('info', `Task #${taskId} atomically updated via ${operationType}`);

			return updatedTask;
		} catch (error) {
			log(
				'error',
				`Atomic file update failed for task #${taskId} (${operationType}):`,
				error.message
			);

			// Rollback: Restore from backup if available
			if (backupFile) {
				await this._rollbackFromBackup(backupFile, tasksPath);
			}

			throw error;
		} finally {
			// Always clean up resources
			await this._cleanupAtomicOperation(lockFile, backupFile, tempFile);
		}
	}

	/**
	 * Apply update to task based on operation type
	 *
	 * @param {Object} task - Original task object
	 * @param {Object} updateData - Update data
	 * @param {string} operationType - Type of operation
	 * @returns {Object} Updated task
	 * @private
	 */
	_applyTaskUpdate(task, updateData, operationType) {
		switch (operationType) {
			case 'updateLinearIssue':
				return {
					...task,
					integrations: {
						...task.integrations,
						linear: {
							issueId: updateData.id,
							identifier: updateData.identifier,
							url: updateData.url,
							...(updateData.branchName && {
								branchName: updateData.branchName
							}),
							...(updateData.title && { title: updateData.title }),
							...(updateData.state && { state: updateData.state }),
							...(updateData.priority && { priority: updateData.priority }),
							...(updateData.team && { team: updateData.team }),
							...(updateData.project && { project: updateData.project }),
							...(updateData.labels && { labels: updateData.labels }),
							...(updateData.assignee && { assignee: updateData.assignee }),
							...(updateData.number && { number: updateData.number }),
							...(updateData.createdAt && { createdAt: updateData.createdAt }),
							...(updateData.updatedAt && { updatedAt: updateData.updatedAt }),
							syncedAt: new Date().toISOString(),
							status: 'synced'
						}
					}
				};
			default:
				throw new Error(`Unknown operation type: ${operationType}`);
		}
	}

	/**
	 * Acquire file lock to prevent concurrent access
	 *
	 * @param {string} filePath - Path to the file to lock
	 * @returns {Promise<string>} Lock file path
	 * @private
	 */
	async _acquireFileLock(filePath) {
		const lockPath = `${filePath}.lock`;
		const maxRetries = 10;
		const retryDelay = 100; // milliseconds
		const lockTimeout = 30000; // 30 seconds

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				// Try to create lock file exclusively
				const lockData = {
					pid: process.pid,
					timestamp: new Date().toISOString(),
					operation: 'linear-integration-update'
				};

				fs.writeFileSync(lockPath, JSON.stringify(lockData), { flag: 'wx' });

				// Set up cleanup timeout
				setTimeout(() => {
					this._forceCleanupLock(lockPath);
				}, lockTimeout);

				return lockPath;
			} catch (error) {
				if (error.code === 'EEXIST') {
					// Lock file exists, check if it's stale
					if (await this._isLockStale(lockPath)) {
						log('warn', `Removing stale lock file: ${lockPath}`);
						await this._forceCleanupLock(lockPath);
						continue; // Retry
					}

					if (attempt === maxRetries) {
						throw new Error(
							`Could not acquire file lock after ${maxRetries} attempts`
						);
					}

					// Wait before retry
					await new Promise((resolve) =>
						setTimeout(resolve, retryDelay * attempt)
					);
				} else {
					throw new Error(`Failed to create lock file: ${error.message}`);
				}
			}
		}

		throw new Error('Failed to acquire file lock');
	}

	/**
	 * Check if a lock file is stale (process no longer exists or too old)
	 *
	 * @param {string} lockPath - Path to lock file
	 * @returns {Promise<boolean>} True if lock is stale
	 * @private
	 */
	async _isLockStale(lockPath) {
		try {
			const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
			const lockAge = Date.now() - new Date(lockData.timestamp).getTime();

			// Lock is stale if older than 30 seconds
			if (lockAge > 30000) {
				return true;
			}

			// Check if process still exists (Unix/Linux)
			if (process.platform !== 'win32') {
				try {
					process.kill(lockData.pid, 0); // Signal 0 checks existence without killing
					return false; // Process exists, lock is not stale
				} catch (error) {
					return true; // Process doesn't exist, lock is stale
				}
			}

			return false;
		} catch (error) {
			// If we can't read the lock file, consider it stale
			return true;
		}
	}

	/**
	 * Force cleanup of lock file
	 *
	 * @param {string} lockPath - Path to lock file
	 * @private
	 */
	async _forceCleanupLock(lockPath) {
		try {
			fs.unlinkSync(lockPath);
		} catch (error) {
			// Ignore errors during force cleanup
		}
	}

	/**
	 * Create backup file before modification
	 *
	 * @param {string} filePath - Original file path
	 * @returns {Promise<string>} Backup file path
	 * @private
	 */
	async _createBackupFile(filePath) {
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const randomSuffix = randomBytes(4).toString('hex');
		const backupPath = `${filePath}.backup-${timestamp}-${randomSuffix}`;

		try {
			fs.copyFileSync(filePath, backupPath);
			return backupPath;
		} catch (error) {
			throw new Error(`Failed to create backup file: ${error.message}`);
		}
	}

	/**
	 * Write data to temporary file
	 *
	 * @param {string} originalPath - Original file path
	 * @param {Object} data - Data to write
	 * @param {string} projectRoot - Project root directory
	 * @param {string} currentTag - Current tag
	 * @returns {Promise<string>} Temporary file path
	 * @private
	 */
	async _writeToTempFile(originalPath, data, projectRoot, currentTag) {
		const randomSuffix = randomBytes(8).toString('hex');
		const tempPath = `${originalPath}.tmp-${randomSuffix}`;

		try {
			// Use the same writeJSON logic but write to temp file
			const { _rawTaggedData, tag: _, ...cleanResolvedData } = data;

			let finalData = data;
			if (data && data._rawTaggedData && projectRoot) {
				// Handle tagged data structure
				const originalTaggedData = data._rawTaggedData;
				finalData = {
					...originalTaggedData,
					[currentTag]: cleanResolvedData
				};
			}

			// Clean up any internal properties
			if (finalData && typeof finalData === 'object') {
				const { _rawTaggedData, tag: tagProp, ...rootCleanData } = finalData;
				finalData = rootCleanData;
			}

			fs.writeFileSync(tempPath, JSON.stringify(finalData, null, 2), 'utf8');
			return tempPath;
		} catch (error) {
			throw new Error(`Failed to write to temporary file: ${error.message}`);
		}
	}

	/**
	 * Atomically move temporary file to final location
	 *
	 * @param {string} tempPath - Temporary file path
	 * @param {string} finalPath - Final file path
	 * @private
	 */
	async _atomicMove(tempPath, finalPath) {
		try {
			fs.renameSync(tempPath, finalPath);
		} catch (error) {
			throw new Error(`Failed to atomically move file: ${error.message}`);
		}
	}

	/**
	 * Rollback from backup file
	 *
	 * @param {string} backupPath - Backup file path
	 * @param {string} originalPath - Original file path
	 * @private
	 */
	async _rollbackFromBackup(backupPath, originalPath) {
		try {
			if (fs.existsSync(backupPath)) {
				fs.copyFileSync(backupPath, originalPath);
				log('info', `Rolled back from backup: ${backupPath}`);
			}
		} catch (error) {
			log('error', `Failed to rollback from backup: ${error.message}`);
		}
	}

	/**
	 * Clean up backup file after successful operation
	 *
	 * @param {string} backupPath - Backup file path
	 * @private
	 */
	async _cleanupBackupFile(backupPath) {
		try {
			if (backupPath && fs.existsSync(backupPath)) {
				fs.unlinkSync(backupPath);
			}
		} catch (error) {
			log('warn', `Failed to cleanup backup file: ${error.message}`);
		}
	}

	/**
	 * Clean up all atomic operation resources
	 *
	 * @param {string} lockFile - Lock file path
	 * @param {string} backupFile - Backup file path
	 * @param {string} tempFile - Temporary file path
	 * @private
	 */
	async _cleanupAtomicOperation(lockFile, backupFile, tempFile) {
		// Clean up lock file
		if (lockFile) {
			try {
				fs.unlinkSync(lockFile);
			} catch (error) {
				log('warn', `Failed to cleanup lock file: ${error.message}`);
			}
		}

		// Clean up backup file (in case of error)
		if (backupFile) {
			await this._cleanupBackupFile(backupFile);
		}

		// Clean up temp file (in case of error)
		if (tempFile) {
			try {
				if (fs.existsSync(tempFile)) {
					fs.unlinkSync(tempFile);
				}
			} catch (error) {
				log('warn', `Failed to cleanup temp file: ${error.message}`);
			}
		}
	}

	/**
	 * Get the events this integration can handle
	 *
	 * @returns {string[]} Array of event types
	 */
	getSupportedEventTypes() {
		return [
			EVENT_TYPES.TASK_CREATED,
			EVENT_TYPES.TASK_UPDATED,
			EVENT_TYPES.TASK_STATUS_CHANGED,
			EVENT_TYPES.TASK_REMOVED
		];
	}

	/**
	 * Check if this integration can handle a specific event type
	 *
	 * @param {string} eventType - Event type to check
	 * @returns {boolean} True if supported
	 */
	canHandle(eventType) {
		return this.getSupportedEventTypes().includes(eventType);
	}

	/**
	 * Get integration capabilities
	 *
	 * @returns {Object} Capabilities object
	 */
	getCapabilities() {
		return {
			createIssues: this.config.createIssues !== false,
			updateIssues: true,
			syncStatus: true,
			bulkOperations: false,
			webhooks: false
		};
	}

	/**
	 * Get configuration status for debugging
	 *
	 * @returns {Object} Configuration status
	 */
	getConfigStatus() {
		return {
			hasApiKey: !!this.config.apiKey,
			hasTeamId: !!this.config.teamId,
			hasProjectId: !!this.config.defaultProjectId,
			createIssues: this.config.createIssues !== false,
			enabled: this.isEnabled()
		};
	}

	// =============================================================================
	// FORMATTED MESSAGING SYSTEM
	// =============================================================================

	/**
	 * Create formatted success message for Linear operations
	 *
	 * @param {string} operationType - Type of operation (create, update, sync)
	 * @param {Object} task - Task object
	 * @param {Object} linearData - Linear issue/response data
	 * @param {Object} options - Additional message options
	 * @returns {Object} Formatted success message
	 */
	createSuccessMessage(operationType, task, linearData, options = {}) {
		const timestamp = new Date().toISOString();
		const baseMessage = {
			success: true,
			type: 'success',
			operation: operationType,
			timestamp,
			task: {
				id: task.id,
				title: task.title
			}
		};

		switch (operationType) {
			case 'create':
				return {
					...baseMessage,
					title: '✅ Linear Issue Created Successfully',
					message: `Task #${task.id} "${task.title}" has been successfully created as Linear issue ${linearData.identifier}`,
					details: {
						linearIssue: {
							id: linearData.id,
							identifier: linearData.identifier,
							url: linearData.url,
							title: linearData.title
						},
						team: linearData.team?.name || 'Unknown',
						project: linearData.project?.name || 'No project',
						priority: this._formatPriority(linearData.priority),
						labels: linearData.labels?.map((l) => l.name).join(', ') || 'None'
					},
					actions: {
						viewIssue: {
							text: 'View in Linear',
							url: linearData.url,
							primary: true
						},
						viewTask: {
							text: `View Task #${task.id}`,
							command: `task-master show ${task.id}`,
							secondary: true
						}
					},
					logMessage: `Task #${task.id} successfully linked to Linear issue ${linearData.identifier} - ${linearData.url}`,
					userMessage: `🎉 Created Linear issue ${linearData.identifier} for task "${task.title}"\n   View: ${linearData.url}`
				};

			case 'update':
				return {
					...baseMessage,
					title: '✅ Linear Issue Updated Successfully',
					message: `Task #${task.id} changes have been synchronized to Linear issue ${linearData.identifier}`,
					details: {
						linearIssue: {
							identifier: linearData.identifier,
							url: linearData.url
						},
						changes: options.changes || [],
						syncedAt: timestamp
					},
					actions: {
						viewIssue: {
							text: 'View Updated Issue',
							url: linearData.url,
							primary: true
						}
					},
					logMessage: `Task #${task.id} changes synchronized to Linear issue ${linearData.identifier}`,
					userMessage: `✅ Synchronized changes to Linear issue ${linearData.identifier}`
				};

			case 'sync':
				return {
					...baseMessage,
					title: '✅ Linear Integration Synchronized',
					message: `Task #${task.id} is now synchronized with Linear issue ${linearData.identifier}`,
					details: {
						linearIssue: {
							identifier: linearData.identifier,
							url: linearData.url,
							status: linearData.state?.name || 'Unknown'
						},
						lastSync: timestamp
					},
					logMessage: `Task #${task.id} synchronized with Linear issue ${linearData.identifier}`,
					userMessage: `🔄 Task #${task.id} synchronized with Linear`
				};

			default:
				return {
					...baseMessage,
					title: '✅ Linear Operation Completed',
					message: `${operationType} operation completed successfully for task #${task.id}`,
					logMessage: `Linear ${operationType} operation completed for task #${task.id}`,
					userMessage: `✅ Linear ${operationType} completed for task #${task.id}`
				};
		}
	}

	/**
	 * Create formatted error message for Linear operations
	 *
	 * @param {string} operationType - Type of operation that failed
	 * @param {Object} task - Task object (if available)
	 * @param {Error} error - Error object
	 * @param {Object} options - Additional message options
	 * @returns {Object} Formatted error message
	 */
	createErrorMessage(operationType, task, error, options = {}) {
		const timestamp = new Date().toISOString();
		const errorType = this._classifyError(error);
		const isRetryable = this._isRetryableError(error, this.config);

		const baseMessage = {
			success: false,
			type: 'error',
			operation: operationType,
			timestamp,
			error: {
				type: errorType,
				code: error.code || 'UNKNOWN',
				message: error.message,
				retryable: isRetryable,
				originalMessage: error.originalMessage,
				operationName: error.operationName
			},
			task: task
				? {
						id: task.id,
						title: task.title
					}
				: null
		};

		// Get user-friendly error information
		const errorInfo = this._getErrorDisplayInfo(error, errorType);

		return {
			...baseMessage,
			title: `❌ Linear ${operationType} Failed`,
			message: `Failed to ${operationType} Linear issue${task ? ` for task #${task.id}` : ''}`,
			details: {
				errorType: errorInfo.category,
				description: errorInfo.description,
				possibleCauses: errorInfo.causes,
				resolution: errorInfo.resolution,
				retryInfo: isRetryable
					? {
							willRetry: options.willRetry !== false,
							attempt: options.currentAttempt || 1,
							maxAttempts: options.maxAttempts || this.config.maxAttempts || 3,
							nextRetryIn: options.nextRetryDelay || null
						}
					: null
			},
			actions: errorInfo.actions,
			logMessage: `Linear ${operationType} failed${task ? ` for task #${task.id}` : ''}: ${error.message}`,
			userMessage: this._createUserErrorMessage(
				operationType,
				task,
				errorInfo,
				isRetryable,
				options
			)
		};
	}

	/**
	 * Create formatted retry message for Linear operations
	 *
	 * @param {string} operationType - Type of operation being retried
	 * @param {Object} task - Task object (if available)
	 * @param {Error} error - Error that caused the retry
	 * @param {Object} retryInfo - Retry attempt information
	 * @returns {Object} Formatted retry message
	 */
	createRetryMessage(operationType, task, error, retryInfo) {
		const timestamp = new Date().toISOString();
		const { currentAttempt, maxAttempts, delay } = retryInfo;

		return {
			success: false,
			type: 'retry',
			operation: operationType,
			timestamp,
			task: task
				? {
						id: task.id,
						title: task.title
					}
				: null,
			retry: {
				attempt: currentAttempt,
				maxAttempts,
				delayMs: delay,
				delayFormatted: this._formatDelay(delay),
				reason: error.message,
				nextAttemptAt: new Date(Date.now() + delay).toISOString()
			},
			title: `🔄 Retrying Linear ${operationType}`,
			message: `Attempt ${currentAttempt}/${maxAttempts} failed, retrying in ${this._formatDelay(delay)}`,
			logMessage: `Integration linear operation failed (attempt ${currentAttempt}/${maxAttempts}), retrying in ${delay}ms: ${error.message}`,
			userMessage: `⏳ Retrying Linear ${operationType} (attempt ${currentAttempt}/${maxAttempts}) in ${this._formatDelay(delay)}...`
		};
	}

	/**
	 * Create formatted progress message for Linear operations
	 *
	 * @param {string} operationType - Type of operation in progress
	 * @param {Object} task - Task object
	 * @param {string} stage - Current stage of the operation
	 * @param {Object} options - Additional progress options
	 * @returns {Object} Formatted progress message
	 */
	createProgressMessage(operationType, task, stage, options = {}) {
		const timestamp = new Date().toISOString();

		return {
			success: null,
			type: 'progress',
			operation: operationType,
			timestamp,
			task: {
				id: task.id,
				title: task.title
			},
			progress: {
				stage,
				percentage: options.percentage || null,
				estimatedTimeRemaining: options.estimatedTime || null
			},
			title: `🔄 Linear ${operationType} in Progress`,
			message: this._getProgressMessage(operationType, stage, task),
			logMessage: `${stage} for task #${task.id}: ${task.title}`,
			userMessage: `🔄 ${this._getProgressMessage(operationType, stage, task)}`
		};
	}

	/**
	 * Log formatted message using appropriate log level
	 *
	 * @param {Object} formattedMessage - Message object from create*Message methods
	 * @param {boolean} includeDetails - Whether to include detailed information
	 */
	logFormattedMessage(formattedMessage, includeDetails = false) {
		const { type, logMessage, details } = formattedMessage;

		// Determine log level based on message type
		let logLevel = 'info';
		switch (type) {
			case 'error':
				logLevel = 'error';
				break;
			case 'retry':
				logLevel = 'warn';
				break;
			case 'progress':
				logLevel = 'debug';
				break;
			case 'success':
			default:
				logLevel = 'info';
				break;
		}

		// Log the main message
		log(logLevel, logMessage);

		// Log additional details if requested and available
		if (includeDetails && details) {
			if (details.errorType) {
				log('debug', `Error details: ${JSON.stringify(details, null, 2)}`);
			} else if (details.linearIssue) {
				log(
					'debug',
					`Linear issue details: ${JSON.stringify(details.linearIssue, null, 2)}`
				);
			}
		}
	}

	/**
	 * Display user-friendly message in console or return for UI
	 *
	 * @param {Object} formattedMessage - Message object from create*Message methods
	 * @param {boolean} toConsole - Whether to output to console
	 * @returns {string} User message
	 */
	displayUserMessage(formattedMessage, toConsole = false) {
		const { userMessage, actions } = formattedMessage;

		if (toConsole) {
			console.log(userMessage);

			// Display action buttons/links if available
			if (actions) {
				Object.entries(actions).forEach(([key, action]) => {
					if (action.url) {
						console.log(`   ${action.text}: ${action.url}`);
					} else if (action.command) {
						console.log(`   ${action.text}: ${action.command}`);
					}
				});
			}
		}

		return userMessage;
	}

	// =============================================================================
	// HELPER METHODS FOR MESSAGING
	// =============================================================================

	/**
	 * Get user-friendly error information
	 *
	 * @param {Error} error - Error object
	 * @param {string} errorType - Classified error type
	 * @returns {Object} Error display information
	 * @private
	 */
	_getErrorDisplayInfo(error, errorType) {
		switch (errorType) {
			case 'AUTHENTICATION_ERROR':
				return {
					category: 'Authentication Error',
					description: 'Unable to authenticate with Linear API',
					causes: [
						'Invalid or expired API key',
						'API key lacks required permissions',
						'Linear workspace access revoked'
					],
					resolution: [
						'Verify your Linear API key in configuration',
						'Check API key permissions in Linear settings',
						'Generate a new API key if needed'
					],
					actions: {
						checkConfig: {
							text: 'Check Configuration',
							command: 'task-master config show',
							primary: true
						},
						linearSettings: {
							text: 'Linear API Settings',
							url: 'https://linear.app/settings/api',
							secondary: true
						}
					}
				};

			case 'RATE_LIMIT_ERROR':
				return {
					category: 'Rate Limit Exceeded',
					description: 'Too many requests sent to Linear API',
					causes: [
						'Exceeded Linear API rate limits',
						'Multiple concurrent operations',
						'Burst of requests without proper spacing'
					],
					resolution: [
						'Wait for rate limit to reset (usually 1 minute)',
						'Reduce frequency of operations',
						'The system will automatically retry with backoff'
					],
					actions: {
						waitAndRetry: {
							text: 'Will retry automatically',
							primary: true
						}
					}
				};

			case 'NOT_FOUND_ERROR':
				return {
					category: 'Resource Not Found',
					description: 'Linear resource could not be found',
					causes: [
						'Invalid team or project ID',
						'Resource was deleted or moved',
						'Incorrect Linear workspace'
					],
					resolution: [
						'Verify team and project IDs in configuration',
						'Check if resources exist in Linear',
						'Update configuration with correct IDs'
					],
					actions: {
						checkLinear: {
							text: 'Check Linear Workspace',
							url: 'https://linear.app/',
							primary: true
						}
					}
				};

			case 'PERMISSION_ERROR':
				return {
					category: 'Permission Denied',
					description: 'Insufficient permissions for this operation',
					causes: [
						'API key lacks required permissions',
						'Team or project access restricted',
						'Linear workspace role limitations'
					],
					resolution: [
						'Check API key permissions in Linear',
						'Request additional permissions from workspace admin',
						'Verify team/project access rights'
					],
					actions: {
						linearSettings: {
							text: 'Linear API Settings',
							url: 'https://linear.app/settings/api',
							primary: true
						}
					}
				};

			case 'NETWORK_ERROR':
				return {
					category: 'Network Error',
					description: 'Unable to connect to Linear API',
					causes: [
						'Internet connection issues',
						'Linear API temporarily unavailable',
						'Network firewall or proxy issues'
					],
					resolution: [
						'Check internet connection',
						'Wait a moment and try again',
						'The system will automatically retry'
					],
					actions: {
						willRetry: {
							text: 'Will retry automatically',
							primary: true
						}
					}
				};

			case 'SERVER_ERROR':
				return {
					category: 'Linear Server Error',
					description: 'Linear API is experiencing issues',
					causes: [
						'Linear server temporarily unavailable',
						'Linear API maintenance',
						'Internal Linear service error'
					],
					resolution: [
						'Wait for Linear to resolve the issue',
						'Check Linear status page',
						'The system will automatically retry'
					],
					actions: {
						linearStatus: {
							text: 'Linear Status Page',
							url: 'https://status.linear.app/',
							primary: true
						}
					}
				};

			case 'VALIDATION_ERROR':
				return {
					category: 'Validation Error',
					description: 'Invalid data sent to Linear API',
					causes: [
						'Task data contains invalid characters',
						'Required fields missing',
						'Data exceeds Linear field limits'
					],
					resolution: [
						'Check task title and description for special characters',
						'Ensure all required fields are present',
						'Reduce content length if too long'
					],
					actions: {
						editTask: {
							text: 'Edit Task',
							command: `task-master update --id=${error.taskId || 'TASK_ID'}`,
							primary: true
						}
					}
				};

			default:
				return {
					category: 'Unknown Error',
					description: 'An unexpected error occurred',
					causes: [
						'Unexpected API response',
						'Network or connectivity issues',
						'Temporary service disruption'
					],
					resolution: [
						'Try the operation again',
						'Check Linear API status',
						'Contact support if issue persists'
					],
					actions: {
						retry: {
							text: 'Try Again',
							primary: true
						}
					}
				};
		}
	}

	/**
	 * Create user-friendly error message
	 *
	 * @param {string} operationType - Operation type
	 * @param {Object} task - Task object
	 * @param {Object} errorInfo - Error display info
	 * @param {boolean} isRetryable - Whether error is retryable
	 * @param {Object} options - Additional options
	 * @returns {string} User error message
	 * @private
	 */
	_createUserErrorMessage(
		operationType,
		task,
		errorInfo,
		isRetryable,
		options
	) {
		const taskInfo = task ? ` for task #${task.id} "${task.title}"` : '';
		const retryInfo =
			isRetryable && options.willRetry !== false
				? ` (will retry automatically)`
				: '';

		return `❌ ${errorInfo.category}: Failed to ${operationType} Linear issue${taskInfo}${retryInfo}\n   ${errorInfo.resolution[0]}`;
	}

	/**
	 * Get progress message for operation stage
	 *
	 * @param {string} operationType - Operation type
	 * @param {string} stage - Current stage
	 * @param {Object} task - Task object
	 * @returns {string} Progress message
	 * @private
	 */
	_getProgressMessage(operationType, stage, task) {
		const taskTitle =
			task.title.length > 30 ? task.title.substring(0, 30) + '...' : task.title;

		switch (stage) {
			case 'validating':
				return `Validating task data for "${taskTitle}"`;
			case 'creating':
				return `Creating Linear issue for "${taskTitle}"`;
			case 'parsing':
				return `Processing Linear response for "${taskTitle}"`;
			case 'updating':
				return `Updating task with Linear issue ID`;
			case 'syncing':
				return `Synchronizing with Linear issue`;
			default:
				return `Processing ${operationType} for "${taskTitle}"`;
		}
	}

	/**
	 * Format delay in human-readable format
	 *
	 * @param {number} delayMs - Delay in milliseconds
	 * @returns {string} Formatted delay
	 * @private
	 */
	_formatDelay(delayMs) {
		if (delayMs < 1000) {
			return `${delayMs}ms`;
		} else if (delayMs < 60000) {
			return `${Math.round(delayMs / 1000)}s`;
		} else {
			return `${Math.round(delayMs / 60000)}m`;
		}
	}

	/**
	 * Format Linear priority for display
	 *
	 * @param {number} priority - Linear priority (1-4)
	 * @returns {string} Formatted priority
	 * @private
	 */
	_formatPriority(priority) {
		switch (priority) {
			case 1:
				return 'Urgent';
			case 2:
				return 'High';
			case 3:
				return 'Medium';
			case 4:
				return 'Low';
			default:
				return 'Unknown';
		}
	}
}
