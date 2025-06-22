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
			retryableErrors: ['ECONNRESET', 'ENOTFOUND', 'TIMEOUT', 'RATE_LIMIT'],
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

		log('info', `Creating Linear issue for task #${task.id}: ${task.title}`);

		try {
			// Create the Linear issue using comprehensive field mapping
			const issue = await this._createLinearIssue(task, context?.projectRoot);

			if (!issue) {
				throw new Error('Failed to create Linear issue - no issue returned');
			}

			log('info', `Linear issue created: ${issue.identifier} - ${issue.url}`);

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

			const updatedTask = await this._updateTaskWithLinearIssue(
				task.id,
				linearIssueInfo,
				context?.projectRoot
			);

			log(
				'info',
				`Task #${task.id} successfully linked to Linear issue ${issue.identifier}`
			);

			// Return both the standardized response and backward-compatible format
			return {
				...standardizedResponse,
				action: 'created',
				task: {
					id: task.id,
					title: task.title
				},
				updatedTask
			};
		} catch (error) {
			log(
				'error',
				`Failed to create Linear issue for task #${task.id}:`,
				error.message
			);

			// Create standardized error response
			const errorResponse = this._createErrorResponse(error, 'createIssue');

			// Add task context to error response
			errorResponse.task = {
				id: task.id,
				title: task.title
			};

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

		log(
			'info',
			`Task #${task.id} status changed from ${oldStatus} to ${newStatus}`
		);

		// In a real implementation, we would:
		// 1. Find the Linear issue associated with this task
		// 2. Update the Linear issue state based on the new status
		// 3. Add a comment about the status change

		// For this POC, we'll just log the event
		return {
			action: 'logged',
			task: {
				id: task.id,
				oldStatus,
				newStatus
			},
			message: `Status change logged for task #${task.id}`
		};
	}

	/**
	 * Handle task update events
	 *
	 * @param {Object} payload - Event payload
	 * @returns {Promise<Object>} Result with update information
	 */
	async handleTaskUpdated(payload) {
		const { task, changes } = payload;

		log('info', `Task #${task.id} updated:`, Object.keys(changes).join(', '));

		// In a real implementation, we would update the Linear issue with the changes
		// For this POC, we'll just log the event
		return {
			action: 'logged',
			task: {
				id: task.id,
				title: task.title
			},
			changes: Object.keys(changes),
			message: `Update logged for task #${task.id}`
		};
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
	 * Perform a Linear API request with proper error handling and authentication
	 *
	 * @param {Function} requestFn - Function that performs the Linear API request
	 * @param {string} operationName - Name of the operation for logging
	 * @returns {Promise<any>} API response
	 * @private
	 */
	async _performLinearRequest(requestFn, operationName) {
		try {
			const result = await requestFn();

			if (!result) {
				throw new Error(
					`Linear API returned empty response for ${operationName}`
				);
			}

			return result;
		} catch (error) {
			// Handle specific Linear API errors
			if (error.message?.includes('Authentication')) {
				throw new Error(
					`Linear authentication failed for ${operationName}: Check API key`
				);
			}

			if (error.message?.includes('rate limit') || error.status === 429) {
				throw new Error(
					`Linear rate limit exceeded for ${operationName}: Please retry later`
				);
			}

			if (error.message?.includes('not found') || error.status === 404) {
				throw new Error(
					`Linear resource not found for ${operationName}: Check team/project IDs`
				);
			}

			if (error.message?.includes('forbidden') || error.status === 403) {
				throw new Error(
					`Linear access denied for ${operationName}: Check permissions`
				);
			}

			// Re-throw with context
			throw new Error(
				`Linear API error during ${operationName}: ${error.message}`
			);
		}
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
}
