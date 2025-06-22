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
			// Prepare issue data
			const issueData = {
				title: `[TM-${task.id}] ${task.title}`,
				description: this._formatTaskDescription(task),
				priority: this._mapTaskPriorityToLinear(task.priority),
				teamId: this.config.teamId,
				...(this.config.defaultProjectId && {
					projectId: this.config.defaultProjectId
				})
			};

			// Create the Linear issue
			const issuePayload = await this.linear.createIssue(issueData);
			const issue = await issuePayload.issue;

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
	 * Map TaskMaster priority to Linear priority
	 *
	 * @param {string} taskPriority - TaskMaster priority (high, medium, low)
	 * @returns {number} Linear priority (1-4)
	 * @private
	 */
	_mapTaskPriorityToLinear(taskPriority) {
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
