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

			// Save the Linear issue ID back to the task atomically
			const linearIssueInfo = {
				id: issue.id,
				identifier: issue.identifier,
				url: issue.url,
				...(issue.branchName && { branchName: issue.branchName })
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

			return {
				action: 'created',
				linearIssue: {
					id: issue.id,
					identifier: issue.identifier,
					url: issue.url,
					title: issue.title
				},
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

			const issue = await issuePayload.issue;

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
			const labels = await this._performLinearRequest(
				() =>
					this.linear.labels({
						filter: { name: { eq: labelName } }
					}),
				`find label "${labelName}"`
			);

			if (labels.nodes && labels.nodes.length > 0) {
				return labels.nodes[0];
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

			return await labelPayload.label;
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
	 * Atomically update task with Linear issue information
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

			// 1. Read current data with tag resolution
			const data = readJSON(tasksPath, actualProjectRoot, currentTag);
			if (!data || !data.tasks) {
				throw new Error('No valid tasks found in tasks.json');
			}

			// 2. Find the task to update
			const taskIndex = data.tasks.findIndex(
				(task) => task.id === taskId || task.id === parseInt(taskId)
			);

			if (taskIndex === -1) {
				throw new Error(`Task ${taskId} not found in tasks.json`);
			}

			// 3. Update task with Linear information
			const updatedTask = {
				...data.tasks[taskIndex],
				integrations: {
					...data.tasks[taskIndex].integrations,
					linear: {
						issueId: linearIssue.id,
						identifier: linearIssue.identifier,
						url: linearIssue.url,
						...(linearIssue.branchName && {
							branchName: linearIssue.branchName
						}),
						syncedAt: new Date().toISOString(),
						status: 'synced'
					}
				}
			};

			// 4. Update the tasks array
			data.tasks[taskIndex] = updatedTask;

			// 5. Write atomically using the utility function
			writeJSON(tasksPath, data, actualProjectRoot, currentTag);

			log(
				'info',
				`Task #${taskId} updated with Linear issue ${linearIssue.identifier}`
			);

			return updatedTask;
		} catch (error) {
			log(
				'error',
				`Failed to update task #${taskId} with Linear issue:`,
				error.message
			);
			throw error;
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
