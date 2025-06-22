/**
 * @fileoverview Event Payload Schema Definitions
 *
 * This module defines standardized schemas for all event payload types in the
 * TaskMaster event system. It provides validation, serialization, and versioning
 * support to ensure consistency across integrations.
 */

import { z } from 'zod';

/**
 * Schema version for payload compatibility tracking
 */
export const SCHEMA_VERSION = '1.0.0';

/**
 * Base schema components that are reused across event types
 */

// Operation context schema
const OperationContextSchema = z.object({
	projectRoot: z.string().describe('Project root directory path'),
	session: z.object({}).passthrough().describe('Session information object'),
	source: z
		.enum(['cli', 'mcp', 'api', 'webhook'])
		.describe('Source of the operation'),
	requestId: z.string().optional().describe('Request identifier for tracing'),
	user: z.string().optional().describe('User identifier'),
	commandName: z
		.string()
		.optional()
		.describe('Command that triggered the event'),
	outputType: z.string().optional().describe('Output type for the operation')
});

// Task status enum
const TaskStatusSchema = z
	.enum(['pending', 'in-progress', 'review', 'done', 'cancelled', 'deferred'])
	.describe('Task status values');

// Task priority enum
const TaskPrioritySchema = z
	.enum(['high', 'medium', 'low'])
	.describe('Task priority levels');

// Base task schema (without subtasks to avoid circular reference)
const BaseTaskSchema = z.object({
	id: z.union([z.string(), z.number()]).describe('Task identifier'),
	title: z.string().describe('Task title'),
	description: z.string().describe('Task description'),
	details: z
		.string()
		.optional()
		.default('')
		.describe('Detailed implementation notes'),
	status: TaskStatusSchema.describe('Current task status'),
	priority: TaskPrioritySchema.describe('Task priority'),
	dependencies: z
		.array(z.union([z.string(), z.number()]))
		.default([])
		.describe('Array of task IDs this task depends on'),
	testStrategy: z.string().optional().describe('Testing strategy for the task'),
	linearIssueId: z
		.string()
		.optional()
		.describe('Linear issue ID for integration'),
	externalIds: z
		.record(z.string(), z.string())
		.optional()
		.describe('External system IDs')
});

// Subtask schema
const SubtaskSchema = z.object({
	id: z.union([z.string(), z.number()]).describe('Subtask identifier'),
	title: z.string().describe('Subtask title'),
	description: z.string().describe('Subtask description'),
	details: z
		.string()
		.optional()
		.default('')
		.describe('Detailed implementation notes'),
	status: TaskStatusSchema.describe('Current subtask status'),
	dependencies: z
		.array(z.union([z.string(), z.number()]))
		.default([])
		.describe('Array of dependency IDs'),
	linearIssueId: z
		.string()
		.optional()
		.describe('Linear issue ID for integration'),
	externalIds: z
		.record(z.string(), z.string())
		.optional()
		.describe('External system IDs')
});

// Complete task schema with subtasks
const TaskSchema = BaseTaskSchema.extend({
	subtasks: z.array(SubtaskSchema).default([]).describe('Array of subtasks')
});

// Base event payload schema that all events must follow
const BaseEventPayloadSchema = z.object({
	version: z.string().describe('Schema version for compatibility'),
	eventId: z.string().describe('Unique event identifier'),
	timestamp: z
		.string()
		.datetime()
		.describe('ISO timestamp when event occurred'),
	context: OperationContextSchema.describe('Operation context information'),
	metadata: z
		.record(z.string(), z.any())
		.optional()
		.describe('Additional metadata')
});

/**
 * Task Event Payload Schemas
 */

// Task Created Event
export const TaskCreatedPayloadSchema = BaseEventPayloadSchema.extend({
	taskId: z.union([z.string(), z.number()]).describe('ID of the created task'),
	task: TaskSchema.describe('The created task object'),
	tag: z.string().describe('Tag context where task was created'),
	parentTaskId: z
		.union([z.string(), z.number()])
		.optional()
		.describe('Parent task ID if this is a subtask')
});

// Task Updated Event
export const TaskUpdatedPayloadSchema = BaseEventPayloadSchema.extend({
	taskId: z.union([z.string(), z.number()]).describe('ID of the updated task'),
	task: TaskSchema.describe('The updated task object'),
	changes: z.record(z.string(), z.any()).describe('Fields that were changed'),
	oldValues: z
		.record(z.string(), z.any())
		.describe('Previous values of changed fields'),
	tag: z.string().describe('Tag context'),
	changeType: z
		.enum(['field_update', 'metadata_update', 'bulk_update'])
		.default('field_update')
		.describe('Type of change made')
});

// Task Status Changed Event
export const TaskStatusChangedPayloadSchema = BaseEventPayloadSchema.extend({
	taskId: z.union([z.string(), z.number()]).describe('ID of the task'),
	task: TaskSchema.describe('The task object'),
	oldStatus: TaskStatusSchema.describe('Previous status'),
	newStatus: TaskStatusSchema.describe('New status'),
	tag: z.string().describe('Tag context'),
	reason: z.string().optional().describe('Reason for status change'),
	triggeredBy: z
		.string()
		.optional()
		.describe('What triggered the status change')
});

// Task Removed Event
export const TaskRemovedPayloadSchema = BaseEventPayloadSchema.extend({
	taskId: z.union([z.string(), z.number()]).describe('ID of the removed task'),
	task: TaskSchema.describe(
		'The removed task object (snapshot before removal)'
	),
	tag: z.string().describe('Tag context'),
	cascadeRemoved: z
		.array(z.union([z.string(), z.number()]))
		.default([])
		.describe('IDs of subtasks that were also removed'),
	removalType: z
		.enum(['user_initiated', 'cascade_delete', 'cleanup'])
		.default('user_initiated')
		.describe('Type of removal')
});

/**
 * Subtask Event Payload Schemas
 */

// Subtask Created Event
export const SubtaskCreatedPayloadSchema = BaseEventPayloadSchema.extend({
	parentTaskId: z
		.union([z.string(), z.number()])
		.describe('ID of the parent task'),
	subtaskId: z
		.union([z.string(), z.number()])
		.describe('ID of the created subtask'),
	subtask: SubtaskSchema.describe('The created subtask object'),
	parentTask: TaskSchema.describe('The parent task object'),
	tag: z.string().describe('Tag context')
});

// Subtask Updated Event
export const SubtaskUpdatedPayloadSchema = BaseEventPayloadSchema.extend({
	parentTaskId: z
		.union([z.string(), z.number()])
		.describe('ID of the parent task'),
	subtaskId: z
		.union([z.string(), z.number()])
		.describe('ID of the updated subtask'),
	subtask: SubtaskSchema.describe('The updated subtask object'),
	parentTask: TaskSchema.describe('The parent task object'),
	changes: z.record(z.string(), z.any()).describe('Fields that were changed'),
	oldValues: z
		.record(z.string(), z.any())
		.describe('Previous values of changed fields'),
	tag: z.string().describe('Tag context')
});

// Subtask Status Changed Event
export const SubtaskStatusChangedPayloadSchema = BaseEventPayloadSchema.extend({
	parentTaskId: z
		.union([z.string(), z.number()])
		.describe('ID of the parent task'),
	subtaskId: z.union([z.string(), z.number()]).describe('ID of the subtask'),
	subtask: SubtaskSchema.describe('The subtask object'),
	parentTask: TaskSchema.describe('The parent task object'),
	oldStatus: TaskStatusSchema.describe('Previous status'),
	newStatus: TaskStatusSchema.describe('New status'),
	tag: z.string().describe('Tag context')
});

// Subtask Removed Event
export const SubtaskRemovedPayloadSchema = BaseEventPayloadSchema.extend({
	parentTaskId: z
		.union([z.string(), z.number()])
		.describe('ID of the parent task'),
	subtaskId: z
		.union([z.string(), z.number()])
		.describe('ID of the removed subtask'),
	subtask: SubtaskSchema.describe('The removed subtask object'),
	parentTask: TaskSchema.describe('The parent task object'),
	tag: z.string().describe('Tag context')
});

/**
 * Dependency Event Payload Schemas
 */

// Dependency Added Event
export const DependencyAddedPayloadSchema = BaseEventPayloadSchema.extend({
	taskId: z
		.union([z.string(), z.number()])
		.describe('ID of the task that now depends on another'),
	dependsOnTaskId: z
		.union([z.string(), z.number()])
		.describe('ID of the task being depended on'),
	task: TaskSchema.describe('The dependent task object'),
	dependsOnTask: TaskSchema.describe('The task being depended on'),
	tag: z.string().describe('Tag context')
});

// Dependency Removed Event
export const DependencyRemovedPayloadSchema = BaseEventPayloadSchema.extend({
	taskId: z
		.union([z.string(), z.number()])
		.describe('ID of the task that no longer depends on another'),
	dependsOnTaskId: z
		.union([z.string(), z.number()])
		.describe('ID of the task no longer being depended on'),
	task: TaskSchema.describe('The formerly dependent task object'),
	dependsOnTask: TaskSchema.describe('The task no longer being depended on'),
	tag: z.string().describe('Tag context')
});

// Dependencies Satisfied Event
export const DependenciesSatisfiedPayloadSchema = BaseEventPayloadSchema.extend(
	{
		taskId: z
			.union([z.string(), z.number()])
			.describe('ID of the task whose dependencies are now satisfied'),
		task: TaskSchema.describe('The task object'),
		satisfiedDependencies: z
			.array(z.union([z.string(), z.number()]))
			.describe('IDs of dependencies that were satisfied'),
		tag: z.string().describe('Tag context')
	}
);

/**
 * Bulk Operation Event Payload Schemas
 */

// Tasks Bulk Created Event
export const TasksBulkCreatedPayloadSchema = BaseEventPayloadSchema.extend({
	tasks: z.array(TaskSchema).describe('Array of created tasks'),
	tag: z.string().describe('Tag context'),
	batchId: z.string().describe('Unique identifier for this bulk operation'),
	totalCount: z
		.number()
		.describe('Total number of tasks in the bulk operation'),
	successCount: z.number().describe('Number of successfully created tasks'),
	failureCount: z
		.number()
		.default(0)
		.describe('Number of tasks that failed to create'),
	failures: z
		.array(
			z.object({
				taskData: z.any().describe('Task data that failed to create'),
				error: z.string().describe('Error message'),
				index: z.number().describe('Index in the original batch')
			})
		)
		.default([])
		.describe('Details of any failures')
});

// Tasks Bulk Updated Event
export const TasksBulkUpdatedPayloadSchema = BaseEventPayloadSchema.extend({
	tasks: z.array(TaskSchema).describe('Array of updated tasks'),
	changes: z
		.record(z.string(), z.any())
		.describe('Common changes applied to all tasks'),
	tag: z.string().describe('Tag context'),
	batchId: z.string().describe('Unique identifier for this bulk operation'),
	totalCount: z
		.number()
		.describe('Total number of tasks in the bulk operation'),
	successCount: z.number().describe('Number of successfully updated tasks'),
	failureCount: z
		.number()
		.default(0)
		.describe('Number of tasks that failed to update')
});

// Tasks Bulk Status Changed Event
export const TasksBulkStatusChangedPayloadSchema =
	BaseEventPayloadSchema.extend({
		tasks: z.array(TaskSchema).describe('Array of tasks with status changes'),
		oldStatus: TaskStatusSchema.describe('Previous status for all tasks'),
		newStatus: TaskStatusSchema.describe('New status for all tasks'),
		tag: z.string().describe('Tag context'),
		batchId: z.string().describe('Unique identifier for this bulk operation'),
		totalCount: z
			.number()
			.describe('Total number of tasks in the bulk operation'),
		successCount: z.number().describe('Number of successfully updated tasks')
	});

/**
 * Tag Event Payload Schemas
 */

// Tag Created Event
export const TagCreatedPayloadSchema = BaseEventPayloadSchema.extend({
	tagName: z.string().describe('Name of the created tag'),
	description: z.string().optional().describe('Tag description'),
	copiedFromTag: z
		.string()
		.optional()
		.describe('Tag that was copied from, if any'),
	taskCount: z.number().default(0).describe('Number of tasks in the new tag')
});

// Tag Switched Event
export const TagSwitchedPayloadSchema = BaseEventPayloadSchema.extend({
	fromTag: z.string().describe('Previous active tag'),
	toTag: z.string().describe('New active tag'),
	fromTaskCount: z.number().describe('Number of tasks in the previous tag'),
	toTaskCount: z.number().describe('Number of tasks in the new tag')
});

// Tag Deleted Event
export const TagDeletedPayloadSchema = BaseEventPayloadSchema.extend({
	tagName: z.string().describe('Name of the deleted tag'),
	taskCount: z
		.number()
		.describe('Number of tasks that were in the deleted tag'),
	backupCreated: z
		.boolean()
		.default(false)
		.describe('Whether a backup was created before deletion')
});

/**
 * Integration Event Payload Schemas
 */

// Integration Success Event
export const IntegrationSuccessPayloadSchema = BaseEventPayloadSchema.extend({
	integrationName: z.string().describe('Name of the integration'),
	operation: z.string().describe('Operation that succeeded'),
	originalEvent: z
		.string()
		.describe('Original event type that triggered this integration'),
	result: z.any().optional().describe('Result data from the integration'),
	executionTime: z.number().describe('Execution time in milliseconds'),
	retryCount: z.number().default(0).describe('Number of retries before success')
});

// Integration Error Event
export const IntegrationErrorPayloadSchema = BaseEventPayloadSchema.extend({
	integrationName: z.string().describe('Name of the integration'),
	operation: z.string().describe('Operation that failed'),
	originalEvent: z
		.string()
		.describe('Original event type that triggered this integration'),
	error: z
		.object({
			message: z.string().describe('Error message'),
			code: z.string().optional().describe('Error code'),
			type: z.string().optional().describe('Error type'),
			stack: z.string().optional().describe('Stack trace (only in debug mode)')
		})
		.describe('Error details'),
	retryCount: z.number().default(0).describe('Number of retries attempted'),
	willRetry: z.boolean().describe('Whether this error will be retried'),
	executionTime: z
		.number()
		.describe('Execution time before failure in milliseconds')
});

/**
 * Schema registry mapping event types to their schemas
 */
export const EVENT_PAYLOAD_SCHEMAS = {
	'task:created': TaskCreatedPayloadSchema,
	'task:updated': TaskUpdatedPayloadSchema,
	'task:status:changed': TaskStatusChangedPayloadSchema,
	'task:removed': TaskRemovedPayloadSchema,

	'subtask:created': SubtaskCreatedPayloadSchema,
	'subtask:updated': SubtaskUpdatedPayloadSchema,
	'subtask:status:changed': SubtaskStatusChangedPayloadSchema,
	'subtask:removed': SubtaskRemovedPayloadSchema,

	'dependency:added': DependencyAddedPayloadSchema,
	'dependency:removed': DependencyRemovedPayloadSchema,
	'dependencies:satisfied': DependenciesSatisfiedPayloadSchema,

	'tasks:bulk:created': TasksBulkCreatedPayloadSchema,
	'tasks:bulk:updated': TasksBulkUpdatedPayloadSchema,
	'tasks:bulk:status:changed': TasksBulkStatusChangedPayloadSchema,

	'tag:created': TagCreatedPayloadSchema,
	'tag:switched': TagSwitchedPayloadSchema,
	'tag:deleted': TagDeletedPayloadSchema,

	'integration:success': IntegrationSuccessPayloadSchema,
	'integration:error': IntegrationErrorPayloadSchema
};

/**
 * Get schema for a specific event type
 *
 * @param {string} eventType - Event type to get schema for
 * @returns {z.ZodSchema|null} Zod schema or null if not found
 */
export function getEventPayloadSchema(eventType) {
	return EVENT_PAYLOAD_SCHEMAS[eventType] || null;
}

/**
 * Validate if an event type has a defined schema
 *
 * @param {string} eventType - Event type to check
 * @returns {boolean} True if schema exists
 */
export function hasEventPayloadSchema(eventType) {
	return eventType in EVENT_PAYLOAD_SCHEMAS;
}

/**
 * Get all supported event types
 *
 * @returns {string[]} Array of supported event types
 */
export function getSupportedEventTypes() {
	return Object.keys(EVENT_PAYLOAD_SCHEMAS);
}

/**
 * Get schema version information
 *
 * @returns {Object} Version information
 */
export function getSchemaVersionInfo() {
	return {
		version: SCHEMA_VERSION,
		supportedEventTypes: getSupportedEventTypes(),
		totalSchemas: Object.keys(EVENT_PAYLOAD_SCHEMAS).length,
		createdAt: '2025-06-21T16:54:12.621Z'
	};
}
