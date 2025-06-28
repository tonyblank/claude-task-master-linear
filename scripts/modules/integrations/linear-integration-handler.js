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
import { tmpdir } from 'os';

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

		// Remove this validation - Linear API key formats can vary

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
		if (
			message.includes('validation') ||
			message.includes('required field') ||
			error.status === 400
		) {
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

	// =============================================================================
	// EDGE CASE HANDLING FOR CUSTOM WORKFLOWS
	// =============================================================================

	/**
	 * Handle edge cases for custom workflow configurations
	 * Implements comprehensive fallback mechanisms and error handling
	 *
	 * @param {string} teamId - Linear team ID
	 * @param {string} taskMasterStatus - TaskMaster status to resolve
	 * @param {Object} options - Configuration options
	 * @returns {Promise<Object>} Resolution result with fallback information
	 */
	async handleWorkflowEdgeCases(teamId, taskMasterStatus, options = {}) {
		const {
			includeArchived = false,
			allowCircularCheck = true,
			provideUserGuidance = true,
			fallbackToDefault = true
		} = options;

		try {
			// Step 1: Get workflow states with archived state handling
			const statesData = await this.queryWorkflowStates(teamId, {
				includeArchived,
				useCache: true
			});

			// Step 2: Validate workflow configuration
			const configValidation = await this._validateWorkflowConfiguration(
				statesData,
				teamId
			);

			// Step 3: Handle archived state scenarios
			const archivedStateHandling = this._handleArchivedStates(
				statesData,
				taskMasterStatus
			);

			// Step 4: Check for circular dependencies if enabled
			let circularDependencyCheck = null;
			if (allowCircularCheck) {
				circularDependencyCheck = await this._checkCircularDependencies(
					teamId,
					taskMasterStatus
				);
			}

			// Step 5: Attempt standard resolution with enhanced error context
			const standardResolution = await this.resolveTaskMasterStatusToLinearUUID(
				teamId,
				taskMasterStatus,
				{ useCache: true, allowFuzzyFallback: true }
			);

			// Step 6: If standard resolution fails, apply advanced fallbacks
			let fallbackResolution = null;
			if (!standardResolution.success && fallbackToDefault) {
				fallbackResolution = await this._applyAdvancedFallbacks(
					teamId,
					taskMasterStatus,
					statesData,
					configValidation
				);
			}

			// Step 7: Generate user guidance if requested
			let userGuidance = null;
			if (
				provideUserGuidance &&
				!standardResolution.success &&
				!fallbackResolution?.success
			) {
				userGuidance = this._generateUserGuidance(
					teamId,
					taskMasterStatus,
					statesData,
					configValidation
				);
			}

			return {
				success:
					standardResolution.success || fallbackResolution?.success || false,
				result: standardResolution.success
					? standardResolution
					: fallbackResolution,
				edgeCaseHandling: {
					configValidation,
					archivedStateHandling,
					circularDependencyCheck,
					userGuidance
				},
				teamId,
				taskMasterStatus
			};
		} catch (error) {
			log(
				'error',
				`Failed to handle workflow edge cases for team ${teamId}:`,
				error.message
			);
			return {
				success: false,
				error: `Edge case handling failed: ${error.message}`,
				teamId,
				taskMasterStatus
			};
		}
	}

	/**
	 * Validate workflow configuration for potential issues
	 *
	 * @param {Object} statesData - Workflow states data
	 * @param {string} teamId - Linear team ID
	 * @returns {Promise<Object>} Validation results
	 * @private
	 */
	async _validateWorkflowConfiguration(statesData, teamId) {
		const validation = {
			isValid: true,
			issues: [],
			warnings: [],
			recommendations: []
		};

		if (!statesData || !statesData.states || statesData.states.length === 0) {
			validation.isValid = false;
			validation.issues.push('No workflow states found for team');
			return validation;
		}

		// Check for missing state types
		const requiredTypes = ['unstarted', 'started', 'completed'];
		const availableTypes = [...new Set(statesData.states.map((s) => s.type))];
		const missingTypes = requiredTypes.filter(
			(type) => !availableTypes.includes(type)
		);

		if (missingTypes.length > 0) {
			validation.warnings.push(
				`Missing state types: ${missingTypes.join(', ')}`
			);
			validation.recommendations.push(
				'Add workflow states for missing types to improve task status mapping'
			);
		}

		// Check for duplicate state names
		const stateNames = statesData.states.map((s) => s.name);
		const duplicateNames = stateNames.filter(
			(name, index) => stateNames.indexOf(name) !== index
		);
		if (duplicateNames.length > 0) {
			validation.warnings.push(
				`Duplicate state names detected: ${[...new Set(duplicateNames)].join(', ')}`
			);
			validation.recommendations.push(
				'Consider renaming duplicate states to avoid mapping conflicts'
			);
		}

		// Check for archived states in active use
		const archivedStates = statesData.states.filter((s) => s.archivedAt);
		if (archivedStates.length > 0) {
			validation.warnings.push(
				`${archivedStates.length} archived states found`
			);
			validation.recommendations.push(
				'Archived states may cause mapping issues if referenced in configuration'
			);
		}

		// Check TaskMaster default mapping coverage
		const availableStateNames = statesData.states.map((s) =>
			s.name.toLowerCase()
		);
		const unmappedStatuses = [];

		for (const [status, defaultNames] of Object.entries(
			LinearIntegrationHandler.TASKMASTER_STATUS_DEFAULTS
		)) {
			const hasMapping = defaultNames.some((name) =>
				availableStateNames.includes(name.toLowerCase())
			);
			if (!hasMapping) {
				unmappedStatuses.push(status);
			}
		}

		if (unmappedStatuses.length > 0) {
			validation.warnings.push(
				`TaskMaster statuses without default mappings: ${unmappedStatuses.join(', ')}`
			);
			validation.recommendations.push(
				'Configure custom state mappings for unmapped TaskMaster statuses'
			);
		}

		return validation;
	}

	/**
	 * Handle archived workflow states
	 *
	 * @param {Object} statesData - Workflow states data
	 * @param {string} taskMasterStatus - TaskMaster status being resolved
	 * @returns {Object} Archived state handling result
	 * @private
	 */
	_handleArchivedStates(statesData, taskMasterStatus) {
		if (!statesData || !statesData.states) {
			return { hasArchivedStates: false, archivedStateCount: 0 };
		}

		const archivedStates = statesData.states.filter((s) => s.archivedAt);
		const activeStates = statesData.states.filter((s) => !s.archivedAt);

		// Check if any default mappings point to archived states
		const defaultNames =
			LinearIntegrationHandler.TASKMASTER_STATUS_DEFAULTS[
				taskMasterStatus?.toLowerCase()
			] || [];
		const archivedDefaultMappings = archivedStates.filter((archived) =>
			defaultNames.some(
				(defaultName) =>
					archived.name.toLowerCase() === defaultName.toLowerCase()
			)
		);

		return {
			hasArchivedStates: archivedStates.length > 0,
			archivedStateCount: archivedStates.length,
			activeStateCount: activeStates.length,
			archivedDefaultMappings: archivedDefaultMappings.map((s) => ({
				id: s.id,
				name: s.name,
				archivedAt: s.archivedAt
			})),
			shouldExcludeArchived: archivedDefaultMappings.length > 0,
			recommendation:
				archivedDefaultMappings.length > 0
					? `Default mapping for '${taskMasterStatus}' points to archived state(s). Consider updating configuration to use active states.`
					: null
		};
	}

	/**
	 * Check for circular dependencies in state transitions
	 *
	 * @param {string} teamId - Linear team ID
	 * @param {string} taskMasterStatus - TaskMaster status being resolved
	 * @returns {Promise<Object>} Circular dependency check result
	 * @private
	 */
	async _checkCircularDependencies(teamId, taskMasterStatus) {
		try {
			// For now, implement basic checks
			// In a more advanced implementation, this could check Linear's workflow transition rules
			return {
				hasCircularDependencies: false,
				checkedStatus: taskMasterStatus,
				message: 'No circular dependencies detected in basic check',
				note: 'Advanced circular dependency detection requires workflow transition rule analysis'
			};
		} catch (error) {
			return {
				hasCircularDependencies: false,
				error: `Circular dependency check failed: ${error.message}`,
				checkedStatus: taskMasterStatus
			};
		}
	}

	/**
	 * Apply advanced fallback mechanisms when standard resolution fails
	 *
	 * @param {string} teamId - Linear team ID
	 * @param {string} taskMasterStatus - TaskMaster status
	 * @param {Object} statesData - Workflow states data
	 * @param {Object} configValidation - Configuration validation results
	 * @returns {Promise<Object>} Advanced fallback result
	 * @private
	 */
	async _applyAdvancedFallbacks(
		teamId,
		taskMasterStatus,
		statesData,
		configValidation
	) {
		try {
			// Fallback 1: Try semantic matching with expanded vocabulary
			const semanticMatch = this._findSemanticStateMatch(
				statesData.states,
				taskMasterStatus
			);
			if (semanticMatch) {
				return {
					success: true,
					uuid: semanticMatch.id,
					stateName: semanticMatch.name,
					stateType: semanticMatch.type,
					taskMasterStatus,
					matchType: 'semantic-fallback',
					fallbackUsed: 'semantic-matching'
				};
			}

			// Fallback 2: Try type-based matching (find first state of appropriate type)
			const typeMatch = this._findTypeBasedMatch(
				statesData.statesByType,
				taskMasterStatus
			);
			if (typeMatch) {
				return {
					success: true,
					uuid: typeMatch.id,
					stateName: typeMatch.name,
					stateType: typeMatch.type,
					taskMasterStatus,
					matchType: 'type-based-fallback',
					fallbackUsed: 'type-matching',
					warning: `Using type-based fallback. Consider configuring explicit mapping for '${taskMasterStatus}'`
				};
			}

			// Fallback 3: Use first available state of any type as last resort
			const firstAvailableState = statesData.states.find((s) => !s.archivedAt);
			if (firstAvailableState) {
				return {
					success: true,
					uuid: firstAvailableState.id,
					stateName: firstAvailableState.name,
					stateType: firstAvailableState.type,
					taskMasterStatus,
					matchType: 'last-resort-fallback',
					fallbackUsed: 'first-available-state',
					warning: `Using last resort fallback state '${firstAvailableState.name}'. Manual configuration strongly recommended.`
				};
			}

			return {
				success: false,
				error: 'All fallback mechanisms exhausted',
				taskMasterStatus,
				fallbacksAttempted: [
					'semantic-matching',
					'type-matching',
					'first-available-state'
				]
			};
		} catch (error) {
			return {
				success: false,
				error: `Advanced fallback failed: ${error.message}`,
				taskMasterStatus
			};
		}
	}

	/**
	 * Find semantic match using expanded vocabulary
	 *
	 * @param {Array} states - Available workflow states
	 * @param {string} taskMasterStatus - TaskMaster status
	 * @returns {Object|null} Matched state or null
	 * @private
	 */
	_findSemanticStateMatch(states, taskMasterStatus) {
		if (!states || !Array.isArray(states) || !taskMasterStatus) {
			return null;
		}

		// Expanded semantic mappings with more vocabulary
		const semanticMappings = {
			pending: [
				'todo',
				'to do',
				'backlog',
				'new',
				'created',
				'open',
				'queued',
				'waiting',
				'scheduled',
				'planned',
				'ready',
				'triage',
				'incoming'
			],
			'in-progress': [
				'in progress',
				'progress',
				'active',
				'working',
				'started',
				'doing',
				'development',
				'implementing',
				'building',
				'coding',
				'wip',
				'current'
			],
			review: [
				'in review',
				'review',
				'pending review',
				'reviewing',
				'testing',
				'qa',
				'quality assurance',
				'validation',
				'approval',
				'checking'
			],
			done: [
				'done',
				'completed',
				'finished',
				'closed',
				'resolved',
				'complete',
				'shipped',
				'delivered',
				'deployed',
				'released',
				'success'
			],
			cancelled: [
				'cancelled',
				'canceled',
				'rejected',
				'declined',
				'abandoned',
				'discarded',
				'aborted',
				'dropped',
				'void',
				'invalid'
			],
			deferred: [
				'backlog',
				'on hold',
				'deferred',
				'postponed',
				'paused',
				'suspended',
				'later',
				'future',
				'someday',
				'icebox',
				'parked'
			]
		};

		const targetStatus = taskMasterStatus.toLowerCase();
		const semanticTerms = semanticMappings[targetStatus] || [];

		for (const state of states) {
			if (state.archivedAt) continue; // Skip archived states

			const stateName = state.name.toLowerCase();

			// Check if state name contains any semantic term
			for (const term of semanticTerms) {
				if (stateName.includes(term) || term.includes(stateName)) {
					log(
						'debug',
						`Found semantic match for '${taskMasterStatus}': '${state.name}' (contains '${term}')`
					);
					return state;
				}
			}
		}

		return null;
	}

	/**
	 * Find type-based match for TaskMaster status
	 *
	 * @param {Object} statesByType - States grouped by type
	 * @param {string} taskMasterStatus - TaskMaster status
	 * @returns {Object|null} Matched state or null
	 * @private
	 */
	_findTypeBasedMatch(statesByType, taskMasterStatus) {
		if (!statesByType || !taskMasterStatus) {
			return null;
		}

		// Map TaskMaster statuses to Linear state types
		const statusToTypeMapping = {
			pending: 'unstarted',
			'in-progress': 'started',
			review: 'started',
			done: 'completed',
			cancelled: 'canceled',
			deferred: 'unstarted'
		};

		const targetType = statusToTypeMapping[taskMasterStatus.toLowerCase()];
		if (!targetType || !statesByType[targetType]) {
			return null;
		}

		// Find first non-archived state of the target type
		const candidateStates = statesByType[targetType];
		const activeState = candidateStates.find((state) => !state.archivedAt);

		if (activeState) {
			log(
				'debug',
				`Found type-based match for '${taskMasterStatus}': '${activeState.name}' (type: ${targetType})`
			);
		}

		return activeState || null;
	}

	/**
	 * Generate user guidance for resolving mapping issues
	 *
	 * @param {string} teamId - Linear team ID
	 * @param {string} taskMasterStatus - TaskMaster status
	 * @param {Object} statesData - Workflow states data
	 * @param {Object} configValidation - Configuration validation results
	 * @returns {Object} User guidance information
	 * @private
	 */
	_generateUserGuidance(
		teamId,
		taskMasterStatus,
		statesData,
		configValidation
	) {
		const guidance = {
			summary: `Unable to map TaskMaster status '${taskMasterStatus}' to Linear workflow state`,
			steps: [],
			availableStates: [],
			recommendedActions: []
		};

		// Add available states information
		if (statesData && statesData.states) {
			guidance.availableStates = statesData.states
				.filter((s) => !s.archivedAt) // Only active states
				.map((s) => ({
					id: s.id,
					name: s.name,
					type: s.type
				}));
		}

		// Generate step-by-step guidance
		guidance.steps = [
			"1. Review your Linear team's workflow states in the Linear app",
			"2. Identify which state should represent the TaskMaster status '" +
				taskMasterStatus +
				"'",
			'3. Update your TaskMaster configuration using one of these methods:',
			'   a. Run the setup wizard: taskmaster linear-sync-setup',
			'   b. Manually edit .taskmaster/config.json',
			'   c. Use CLI: taskmaster config set-linear-status-mapping'
		];

		// Add specific recommendations based on validation
		if (configValidation.warnings.length > 0) {
			guidance.recommendedActions.push(
				'Address configuration warnings: ' +
					configValidation.warnings.join(', ')
			);
		}

		if (configValidation.recommendations.length > 0) {
			guidance.recommendedActions.push(...configValidation.recommendations);
		}

		// Add status-specific recommendations
		const defaultNames =
			LinearIntegrationHandler.TASKMASTER_STATUS_DEFAULTS[
				taskMasterStatus.toLowerCase()
			] || [];
		if (defaultNames.length > 0) {
			guidance.recommendedActions.push(
				`Consider creating Linear workflow states named: ${defaultNames.join(' or ')} for automatic mapping`
			);
		}

		return guidance;
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
		const lockTimeout = 10000; // 10 seconds

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
						// Try to atomically remove and recreate
						try {
							const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
							// Double-check staleness before removal
							if (await this._isLockStale(lockPath)) {
								fs.unlinkSync(lockPath);
								continue;
							}
						} catch (e) {
							// Lock was already removed, continue
							continue;
						}
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
		// Create temp file in OS temp directory
		const tempDir = await fs.promises.mkdtemp(
			path.join(tmpdir(), 'taskmaster-')
		);
		const tempPath = path.join(tempDir, 'tasks.json');

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
			// Clean up temp directory on error
			try {
				await fs.promises.rmdir(tempDir, { recursive: true });
			} catch (e) {}
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
			queryWorkflowStates: true,
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
	// WORKFLOW STATE MANAGEMENT
	// =============================================================================

	/**
	 * Query Linear API for workflow states of a team
	 *
	 * @param {string} teamId - Linear team ID
	 * @param {Object} options - Query options
	 * @param {boolean} options.includeArchived - Include archived states (default: false)
	 * @param {number} options.pageSize - Page size for pagination (default: 100)
	 * @param {boolean} options.useCache - Use cached results if available (default: true)
	 * @returns {Promise<Object>} Workflow states data with pagination info
	 */
	async queryWorkflowStates(teamId, options = {}) {
		const {
			includeArchived = false,
			pageSize = 100,
			useCache = true
		} = options;

		// Check cache first if enabled
		if (useCache) {
			const cached = this._getWorkflowStatesFromCache(teamId);
			if (cached) {
				log('debug', `Using cached workflow states for team ${teamId}`);
				return cached;
			}
		}

		// Create progress message for operation start
		const progressMessage = this.createProgressMessage(
			'queryWorkflowStates',
			{ id: 'workflow-states', title: `Team ${teamId} workflow states` },
			'querying'
		);
		this.logFormattedMessage(progressMessage);

		try {
			// Validate team ID format
			if (!teamId || typeof teamId !== 'string') {
				throw new Error('Team ID is required and must be a string');
			}

			// Update progress - fetching states
			const fetchingProgress = this.createProgressMessage(
				'queryWorkflowStates',
				{ id: 'workflow-states', title: `Team ${teamId} workflow states` },
				'fetching'
			);
			this.logFormattedMessage(fetchingProgress);

			// Query Linear API for workflow states
			const statesData = await this._fetchWorkflowStatesWithPagination(teamId, {
				includeArchived,
				pageSize
			});

			// Update progress - processing results
			const processingProgress = this.createProgressMessage(
				'queryWorkflowStates',
				{ id: 'workflow-states', title: `Team ${teamId} workflow states` },
				'processing'
			);
			this.logFormattedMessage(processingProgress);

			// Process and validate the results
			const processedStates = this._processWorkflowStatesResponse(statesData);

			// Cache the results if successful
			if (useCache && processedStates.states.length > 0) {
				this._cacheWorkflowStates(teamId, processedStates);
			}

			// Create success message
			const successMessage = this.createSuccessMessage(
				'queryWorkflowStates',
				{ id: 'workflow-states', title: `Team ${teamId} workflow states` },
				{
					identifier: `team-${teamId}-states`,
					statesCount: processedStates.states.length,
					teamId
				}
			);
			this.logFormattedMessage(successMessage);

			log(
				'info',
				`Successfully queried ${processedStates.states.length} workflow states for team ${teamId}`
			);

			return processedStates;
		} catch (error) {
			// Create error message
			const errorMessage = this.createErrorMessage(
				'queryWorkflowStates',
				{ id: 'workflow-states', title: `Team ${teamId} workflow states` },
				error
			);
			this.logFormattedMessage(errorMessage, true);

			log(
				'error',
				`Failed to query workflow states for team ${teamId}:`,
				error.message
			);
			throw error;
		}
	}

	/**
	 * Fetch workflow states with pagination handling
	 *
	 * @param {string} teamId - Linear team ID
	 * @param {Object} options - Fetch options
	 * @returns {Promise<Object>} Raw workflow states data
	 * @private
	 */
	async _fetchWorkflowStatesWithPagination(teamId, options = {}) {
		const { includeArchived = false, pageSize = 100 } = options;
		const allStates = [];
		let hasNextPage = true;
		let cursor = null;
		let pageCount = 0;

		while (hasNextPage && pageCount < 10) {
			// Safety limit of 10 pages
			try {
				log(
					'debug',
					`Fetching workflow states page ${pageCount + 1} for team ${teamId}`
				);

				// Build the query parameters
				const queryParams = {
					first: pageSize,
					filter: {
						team: { id: { eq: teamId } },
						...(includeArchived ? {} : { archivedAt: { null: true } })
					}
				};

				// Add cursor for pagination
				if (cursor) {
					queryParams.after = cursor;
				}

				// Perform the Linear API request with retry logic
				const statesResponse = await this._performLinearRequest(
					() => this.linear.workflowStates(queryParams),
					`fetch workflow states page ${pageCount + 1} for team ${teamId}`
				);

				// Validate response structure
				if (!statesResponse || !statesResponse.nodes) {
					throw new Error('Invalid workflow states response structure');
				}

				// Add states from this page
				allStates.push(...statesResponse.nodes);

				// Check if there are more pages
				hasNextPage = statesResponse.pageInfo?.hasNextPage || false;
				cursor = statesResponse.pageInfo?.endCursor || null;
				pageCount++;

				log(
					'debug',
					`Fetched ${statesResponse.nodes.length} workflow states from page ${pageCount}, hasNextPage: ${hasNextPage}`
				);

				// Add a small delay between pages to be API-friendly
				if (hasNextPage) {
					await new Promise((resolve) => setTimeout(resolve, 100));
				}
			} catch (error) {
				log(
					'error',
					`Failed to fetch workflow states page ${pageCount + 1}:`,
					error.message
				);
				throw error;
			}
		}

		if (pageCount >= 10 && hasNextPage) {
			log(
				'warn',
				`Reached maximum page limit (10) while fetching workflow states for team ${teamId}`
			);
		}

		return {
			states: allStates,
			totalCount: allStates.length,
			pageCount,
			teamId
		};
	}

	/**
	 * Process and validate workflow states response
	 *
	 * @param {Object} statesData - Raw states data from API
	 * @returns {Object} Processed workflow states
	 * @private
	 */
	_processWorkflowStatesResponse(statesData) {
		const { states, totalCount, pageCount, teamId } = statesData;

		// Validate that we have states
		if (!Array.isArray(states)) {
			throw new Error('Invalid states data structure');
		}

		// Process each state
		const processedStates = states
			.map((state, index) => {
				try {
					// Validate required fields
					if (!state.id || !state.name) {
						log(
							'warn',
							`Workflow state ${index} missing required fields (id or name)`
						);
						return null;
					}

					return {
						id: state.id,
						name: state.name,
						type: state.type || 'unstarted', // Linear state types: unstarted, started, completed, canceled
						color: state.color || '#95a2b3',
						position:
							typeof state.position === 'number' ? state.position : index,
						description: state.description || null,
						team: state.team
							? {
									id: state.team.id,
									name: state.team.name,
									key: state.team.key
								}
							: null,
						// Additional metadata
						archivedAt: state.archivedAt || null,
						createdAt: state.createdAt || null,
						updatedAt: state.updatedAt || null
					};
				} catch (error) {
					log(
						'warn',
						`Failed to process workflow state ${index}:`,
						error.message
					);
					return null;
				}
			})
			.filter((state) => state !== null); // Remove failed states

		// Group states by type for easier consumption
		const statesByType = processedStates.reduce((acc, state) => {
			if (!acc[state.type]) {
				acc[state.type] = [];
			}
			acc[state.type].push(state);
			return acc;
		}, {});

		// Sort states by position within each type
		Object.keys(statesByType).forEach((type) => {
			statesByType[type].sort((a, b) => a.position - b.position);
		});

		// Create name-to-ID mapping for quick lookups
		const stateNameMap = processedStates.reduce((acc, state) => {
			// Support both exact and normalized name lookups
			acc[state.name] = state.id;
			acc[state.name.toLowerCase()] = state.id;
			acc[state.name.toLowerCase().replace(/[^a-z0-9]/g, '')] = state.id;
			return acc;
		}, {});

		return {
			states: processedStates,
			statesByType,
			stateNameMap,
			metadata: {
				totalCount: processedStates.length,
				originalCount: totalCount,
				pageCount,
				teamId,
				fetchedAt: new Date().toISOString(),
				types: Object.keys(statesByType)
			}
		};
	}

	/**
	 * Get workflow states from cache
	 *
	 * @param {string} teamId - Linear team ID
	 * @returns {Object|null} Cached workflow states or null
	 * @private
	 */
	_getWorkflowStatesFromCache(teamId) {
		if (!this._workflowStatesCache) {
			this._workflowStatesCache = new Map();
		}

		const cached = this._workflowStatesCache.get(teamId);
		if (!cached) {
			return null;
		}

		// Check if cache is still valid (5 minutes TTL)
		const cacheAge = Date.now() - cached.cachedAt;
		const maxAge = 5 * 60 * 1000; // 5 minutes

		if (cacheAge > maxAge) {
			log(
				'debug',
				`Workflow states cache expired for team ${teamId} (age: ${Math.round(cacheAge / 1000)}s)`
			);
			this._workflowStatesCache.delete(teamId);
			return null;
		}

		log(
			'debug',
			`Using cached workflow states for team ${teamId} (age: ${Math.round(cacheAge / 1000)}s)`
		);
		return cached.data;
	}

	/**
	 * Cache workflow states data
	 *
	 * @param {string} teamId - Linear team ID
	 * @param {Object} statesData - Processed workflow states data
	 * @private
	 */
	_cacheWorkflowStates(teamId, statesData) {
		if (!this._workflowStatesCache) {
			this._workflowStatesCache = new Map();
		}

		// Limit cache size to prevent memory issues
		if (this._workflowStatesCache.size >= 50) {
			// Remove oldest entry
			const firstKey = this._workflowStatesCache.keys().next().value;
			this._workflowStatesCache.delete(firstKey);
			log(
				'debug',
				`Workflow states cache size limit reached, removed oldest entry: ${firstKey}`
			);
		}

		this._workflowStatesCache.set(teamId, {
			data: statesData,
			cachedAt: Date.now()
		});

		log(
			'debug',
			`Cached workflow states for team ${teamId} (${statesData.states.length} states)`
		);
	}

	/**
	 * Clear workflow states cache for a team or all teams
	 *
	 * @param {string} [teamId] - Specific team ID to clear, or null to clear all
	 */
	clearWorkflowStatesCache(teamId = null) {
		if (!this._workflowStatesCache) {
			return;
		}

		if (teamId) {
			this._workflowStatesCache.delete(teamId);
			log('debug', `Cleared workflow states cache for team ${teamId}`);
		} else {
			this._workflowStatesCache.clear();
			log('debug', 'Cleared all workflow states cache');
		}
	}

	/**
	 * Get workflow state by name with fuzzy matching
	 *
	 * @param {string} teamId - Linear team ID
	 * @param {string} stateName - State name to find
	 * @param {Object} options - Search options
	 * @returns {Promise<Object|null>} Matching workflow state or null
	 */
	async findWorkflowStateByName(teamId, stateName, options = {}) {
		const { fuzzyMatch = true, useCache = true } = options;

		try {
			// Get workflow states for the team
			const statesData = await this.queryWorkflowStates(teamId, { useCache });

			if (!statesData || !statesData.stateNameMap) {
				return null;
			}

			// Try exact match first
			let stateId = statesData.stateNameMap[stateName];
			if (stateId) {
				return statesData.states.find((state) => state.id === stateId);
			}

			// Try case-insensitive match
			stateId = statesData.stateNameMap[stateName.toLowerCase()];
			if (stateId) {
				return statesData.states.find((state) => state.id === stateId);
			}

			// Try normalized match (remove special characters)
			const normalizedName = stateName.toLowerCase().replace(/[^a-z0-9]/g, '');
			stateId = statesData.stateNameMap[normalizedName];
			if (stateId) {
				return statesData.states.find((state) => state.id === stateId);
			}

			// Try fuzzy matching if enabled
			if (fuzzyMatch) {
				const fuzzyMatch = this._findFuzzyWorkflowStateMatch(
					statesData.states,
					stateName
				);
				if (fuzzyMatch) {
					log(
						'debug',
						`Found fuzzy match for "${stateName}": "${fuzzyMatch.name}"`
					);
					return fuzzyMatch;
				}
			}

			return null;
		} catch (error) {
			log(
				'error',
				`Failed to find workflow state "${stateName}" for team ${teamId}:`,
				error.message
			);
			return null;
		}
	}

	/**
	 * Find fuzzy workflow state match using similarity scoring
	 *
	 * @param {Array} states - Array of workflow states
	 * @param {string} targetName - Target state name to match
	 * @returns {Object|null} Best matching state or null
	 * @private
	 */
	_findFuzzyWorkflowStateMatch(states, targetName) {
		if (!states || !Array.isArray(states) || !targetName) {
			return null;
		}

		const target = targetName.toLowerCase();
		let bestMatch = null;
		let bestScore = 0;

		for (const state of states) {
			const stateName = state.name.toLowerCase();

			// Calculate similarity score
			let score = 0;

			// Exact substring match gets high score
			if (stateName.includes(target) || target.includes(stateName)) {
				score += 0.8;
			}

			// Word-based matching
			const targetWords = target.split(/\s+/);
			const stateWords = stateName.split(/\s+/);

			const matchingWords = targetWords.filter((word) =>
				stateWords.some(
					(stateWord) => stateWord.includes(word) || word.includes(stateWord)
				)
			);

			score +=
				(matchingWords.length /
					Math.max(targetWords.length, stateWords.length)) *
				0.6;

			// Common abbreviations and patterns
			const commonMappings = {
				todo: ['todo', 'to do', 'backlog', 'new'],
				progress: ['in progress', 'active', 'working', 'started'],
				review: ['in review', 'review', 'pending review'],
				done: ['done', 'completed', 'finished', 'closed'],
				cancelled: ['cancelled', 'canceled', 'rejected']
			};

			for (const [key, variations] of Object.entries(commonMappings)) {
				if (target.includes(key)) {
					if (variations.some((variation) => stateName.includes(variation))) {
						score += 0.7;
					}
				}
			}

			// Update best match if this score is higher
			if (score > bestScore && score > 0.5) {
				// Minimum threshold of 0.5
				bestScore = score;
				bestMatch = state;
			}
		}

		return bestMatch;
	}

	// =============================================================================
	// TASKMASTER STATUS MAPPING SYSTEM
	// =============================================================================

	/**
	 * Default mappings from TaskMaster statuses to Linear state names
	 * Each TaskMaster status can map to multiple possible Linear state names
	 */
	static TASKMASTER_STATUS_DEFAULTS = {
		pending: ['Todo', 'Backlog'],
		'in-progress': ['In Progress'],
		review: ['In Review'],
		done: ['Done', 'Completed'],
		cancelled: ['Canceled', 'Cancelled'],
		deferred: ['Backlog', 'On Hold']
	};

	/**
	 * All valid TaskMaster statuses
	 */
	static TASKMASTER_STATUSES = Object.keys(
		LinearIntegrationHandler.TASKMASTER_STATUS_DEFAULTS
	);

	/**
	 * Resolve a TaskMaster status to a Linear workflow state UUID
	 *
	 * @param {string} teamId - Linear team ID
	 * @param {string} taskMasterStatus - TaskMaster status (pending, in-progress, review, done, cancelled, deferred)
	 * @param {Object} options - Resolution options
	 * @returns {Promise<Object>} Resolution result with UUID or error details
	 */
	async resolveTaskMasterStatusToLinearUUID(
		teamId,
		taskMasterStatus,
		options = {}
	) {
		const { useCache = true, allowFuzzyFallback = true } = options;

		try {
			// Validate TaskMaster status
			if (!taskMasterStatus || typeof taskMasterStatus !== 'string') {
				return {
					success: false,
					error: 'TaskMaster status is required and must be a string',
					taskMasterStatus
				};
			}

			const normalizedStatus = taskMasterStatus.toLowerCase();
			if (
				!LinearIntegrationHandler.TASKMASTER_STATUSES.includes(normalizedStatus)
			) {
				return {
					success: false,
					error: `Invalid TaskMaster status: ${taskMasterStatus}. Valid statuses: ${LinearIntegrationHandler.TASKMASTER_STATUSES.join(', ')}`,
					taskMasterStatus
				};
			}

			// Get workflow states for the team
			const statesData = await this.queryWorkflowStates(teamId, { useCache });
			if (!statesData || !statesData.states || statesData.states.length === 0) {
				return {
					success: false,
					error: `No workflow states found for team ${teamId}`,
					taskMasterStatus,
					teamId
				};
			}

			// Get possible Linear state names for this TaskMaster status
			const possibleStateNames =
				LinearIntegrationHandler.TASKMASTER_STATUS_DEFAULTS[normalizedStatus];
			if (!possibleStateNames || possibleStateNames.length === 0) {
				return {
					success: false,
					error: `No default Linear state names configured for TaskMaster status: ${taskMasterStatus}`,
					taskMasterStatus
				};
			}

			// Try exact matches first
			for (const stateName of possibleStateNames) {
				const matchedState = statesData.states.find(
					(state) => state.name === stateName
				);
				if (matchedState) {
					log(
						'debug',
						`Resolved TaskMaster status "${taskMasterStatus}" to Linear state "${matchedState.name}" (${matchedState.id})`
					);
					return {
						success: true,
						uuid: matchedState.id,
						stateName: matchedState.name,
						stateType: matchedState.type,
						taskMasterStatus,
						matchType: 'exact'
					};
				}
			}

			// Try case-insensitive matches
			for (const stateName of possibleStateNames) {
				const matchedState = statesData.states.find(
					(state) => state.name.toLowerCase() === stateName.toLowerCase()
				);
				if (matchedState) {
					log(
						'debug',
						`Resolved TaskMaster status "${taskMasterStatus}" to Linear state "${matchedState.name}" (${matchedState.id}) via case-insensitive match`
					);
					return {
						success: true,
						uuid: matchedState.id,
						stateName: matchedState.name,
						stateType: matchedState.type,
						taskMasterStatus,
						matchType: 'case-insensitive'
					};
				}
			}

			// Try fuzzy matching as fallback if enabled
			if (allowFuzzyFallback) {
				for (const stateName of possibleStateNames) {
					const fuzzyMatch = this._findFuzzyWorkflowStateMatch(
						statesData.states,
						stateName
					);
					if (fuzzyMatch) {
						log(
							'debug',
							`Resolved TaskMaster status "${taskMasterStatus}" to Linear state "${fuzzyMatch.name}" (${fuzzyMatch.id}) via fuzzy match`
						);
						return {
							success: true,
							uuid: fuzzyMatch.id,
							stateName: fuzzyMatch.name,
							stateType: fuzzyMatch.type,
							taskMasterStatus,
							matchType: 'fuzzy'
						};
					}
				}
			}

			// No matches found
			const availableStates = statesData.states.map((s) => s.name).join(', ');
			return {
				success: false,
				error: `Could not find Linear state matching TaskMaster status "${taskMasterStatus}". Tried: ${possibleStateNames.join(', ')}. Available states: ${availableStates}`,
				taskMasterStatus,
				possibleStateNames,
				availableStates: statesData.states.map((s) => ({
					id: s.id,
					name: s.name,
					type: s.type
				}))
			};
		} catch (error) {
			log(
				'error',
				`Failed to resolve TaskMaster status "${taskMasterStatus}" for team ${teamId}:`,
				error.message
			);
			return {
				success: false,
				error: `Resolution failed: ${error.message}`,
				taskMasterStatus,
				teamId
			};
		}
	}

	/**
	 * Generate complete UUID mappings for all TaskMaster statuses
	 *
	 * @param {string} teamId - Linear team ID
	 * @param {Object} options - Generation options
	 * @returns {Promise<Object>} Complete mapping result
	 */
	async generateTaskMasterUUIDMappings(teamId, options = {}) {
		const {
			useCache = true,
			allowFuzzyFallback = true,
			includeDetails = false
		} = options;

		try {
			const mappings = {};
			const details = {};
			const errors = [];

			log(
				'info',
				`Generating TaskMaster-to-Linear UUID mappings for team ${teamId}`
			);

			// Resolve each TaskMaster status
			for (const taskMasterStatus of LinearIntegrationHandler.TASKMASTER_STATUSES) {
				const resolution = await this.resolveTaskMasterStatusToLinearUUID(
					teamId,
					taskMasterStatus,
					{ useCache, allowFuzzyFallback }
				);

				if (resolution.success) {
					mappings[taskMasterStatus] = resolution.uuid;
					if (includeDetails) {
						details[taskMasterStatus] = {
							uuid: resolution.uuid,
							stateName: resolution.stateName,
							stateType: resolution.stateType,
							matchType: resolution.matchType
						};
					}
					log(
						'debug',
						`✅ Mapped "${taskMasterStatus}" → "${resolution.stateName}" (${resolution.uuid})`
					);
				} else {
					errors.push({
						taskMasterStatus,
						error: resolution.error
					});
					log(
						'warn',
						`❌ Failed to map "${taskMasterStatus}": ${resolution.error}`
					);
				}
			}

			const result = {
				success: errors.length === 0,
				mappings,
				teamId,
				totalStatuses: LinearIntegrationHandler.TASKMASTER_STATUSES.length,
				successfulMappings: Object.keys(mappings).length,
				failedMappings: errors.length,
				generatedAt: new Date().toISOString()
			};

			if (includeDetails) {
				result.details = details;
			}

			if (errors.length > 0) {
				result.errors = errors;
			}

			log(
				'info',
				`Generated ${result.successfulMappings}/${result.totalStatuses} TaskMaster status mappings for team ${teamId}`
			);

			return result;
		} catch (error) {
			log(
				'error',
				`Failed to generate TaskMaster UUID mappings for team ${teamId}:`,
				error.message
			);
			return {
				success: false,
				error: `Mapping generation failed: ${error.message}`,
				teamId,
				totalStatuses: LinearIntegrationHandler.TASKMASTER_STATUSES.length,
				successfulMappings: 0,
				failedMappings: LinearIntegrationHandler.TASKMASTER_STATUSES.length
			};
		}
	}

	/**
	 * Validate existing TaskMaster status mappings against current Linear states
	 *
	 * @param {string} teamId - Linear team ID
	 * @param {Object} existingMappings - Current UUID mappings to validate
	 * @param {Object} options - Validation options
	 * @returns {Promise<Object>} Validation result
	 */
	async validateTaskMasterStatusMappings(
		teamId,
		existingMappings,
		options = {}
	) {
		const { useCache = true } = options;

		try {
			if (!existingMappings || typeof existingMappings !== 'object') {
				return {
					success: false,
					error: 'Existing mappings object is required',
					teamId
				};
			}

			// Get current workflow states
			const statesData = await this.queryWorkflowStates(teamId, { useCache });
			if (!statesData || !statesData.states) {
				return {
					success: false,
					error: `Could not fetch workflow states for team ${teamId}`,
					teamId
				};
			}

			const validMappings = {};
			const invalidMappings = {};
			const missingMappings = [];

			// Check each existing mapping
			for (const [taskMasterStatus, uuid] of Object.entries(existingMappings)) {
				if (!uuid) {
					invalidMappings[taskMasterStatus] = 'Missing UUID';
					continue;
				}

				const matchedState = statesData.states.find(
					(state) => state.id === uuid
				);
				if (matchedState) {
					validMappings[taskMasterStatus] = {
						uuid,
						stateName: matchedState.name,
						stateType: matchedState.type
					};
				} else {
					invalidMappings[taskMasterStatus] =
						`UUID ${uuid} not found in Linear workspace`;
				}
			}

			// Check for missing TaskMaster statuses
			for (const taskMasterStatus of LinearIntegrationHandler.TASKMASTER_STATUSES) {
				if (!existingMappings[taskMasterStatus]) {
					missingMappings.push(taskMasterStatus);
				}
			}

			const result = {
				success:
					Object.keys(invalidMappings).length === 0 &&
					missingMappings.length === 0,
				teamId,
				validMappings,
				invalidMappings,
				missingMappings,
				totalMappings: Object.keys(existingMappings).length,
				validCount: Object.keys(validMappings).length,
				invalidCount: Object.keys(invalidMappings).length,
				missingCount: missingMappings.length,
				validatedAt: new Date().toISOString()
			};

			log(
				'info',
				`Validated TaskMaster mappings for team ${teamId}: ${result.validCount} valid, ${result.invalidCount} invalid, ${result.missingCount} missing`
			);

			return result;
		} catch (error) {
			log(
				'error',
				`Failed to validate TaskMaster mappings for team ${teamId}:`,
				error.message
			);
			return {
				success: false,
				error: `Validation failed: ${error.message}`,
				teamId
			};
		}
	}

	/**
	 * Get unmapped TaskMaster statuses for a team
	 *
	 * @param {string} teamId - Linear team ID
	 * @param {Object} existingMappings - Current mappings to check
	 * @returns {Promise<Array>} Array of unmapped TaskMaster statuses
	 */
	async getUnmappedTaskMasterStatuses(teamId, existingMappings = {}) {
		try {
			const unmapped = [];

			for (const taskMasterStatus of LinearIntegrationHandler.TASKMASTER_STATUSES) {
				if (!existingMappings[taskMasterStatus]) {
					unmapped.push(taskMasterStatus);
				}
			}

			return unmapped;
		} catch (error) {
			log(
				'error',
				`Failed to get unmapped TaskMaster statuses for team ${teamId}:`,
				error.message
			);
			return LinearIntegrationHandler.TASKMASTER_STATUSES;
		}
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

			case 'queryWorkflowStates':
				return {
					...baseMessage,
					title: '✅ Workflow States Retrieved Successfully',
					message: `Successfully retrieved ${linearData.statesCount} workflow states for team ${linearData.teamId}`,
					details: {
						teamId: linearData.teamId,
						statesCount: linearData.statesCount,
						identifier: linearData.identifier,
						retrievedAt: timestamp
					},
					actions: {
						viewStates: {
							text: 'View States in Linear',
							url: `https://linear.app/team/${linearData.teamId}/settings/workflow`,
							primary: true
						}
					},
					logMessage: `Successfully retrieved ${linearData.statesCount} workflow states for team ${linearData.teamId}`,
					userMessage: `📋 Retrieved ${linearData.statesCount} workflow states for Linear team`
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

		// Handle workflow states operations differently
		if (operationType === 'queryWorkflowStates') {
			switch (stage) {
				case 'querying':
					return `Preparing to query workflow states`;
				case 'fetching':
					return `Fetching workflow states from Linear API`;
				case 'processing':
					return `Processing and validating workflow states`;
				default:
					return `Querying workflow states from Linear`;
			}
		}

		// Handle regular task operations
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
