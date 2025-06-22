/**
 * @fileoverview Tests for Event Payload Schemas
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
	EVENT_PAYLOAD_SCHEMAS,
	getEventPayloadSchema,
	hasEventPayloadSchema,
	getSupportedEventTypes,
	getSchemaVersionInfo,
	SCHEMA_VERSION,
	TaskCreatedPayloadSchema,
	TaskUpdatedPayloadSchema,
	TaskStatusChangedPayloadSchema,
	SubtaskCreatedPayloadSchema,
	DependencyAddedPayloadSchema,
	TasksBulkCreatedPayloadSchema,
	IntegrationSuccessPayloadSchema,
	IntegrationErrorPayloadSchema
} from '../../../scripts/modules/events/payload-schemas.js';

describe('Event Payload Schemas', () => {
	describe('Schema Registry', () => {
		it('should have schemas for all event types', () => {
			const expectedEventTypes = [
				'task:created',
				'task:updated',
				'task:status:changed',
				'task:removed',
				'subtask:created',
				'subtask:updated',
				'subtask:status:changed',
				'subtask:removed',
				'dependency:added',
				'dependency:removed',
				'dependencies:satisfied',
				'tasks:bulk:created',
				'tasks:bulk:updated',
				'tasks:bulk:status:changed',
				'tag:created',
				'tag:switched',
				'tag:deleted',
				'integration:success',
				'integration:error'
			];

			expectedEventTypes.forEach((eventType) => {
				expect(EVENT_PAYLOAD_SCHEMAS[eventType]).toBeDefined();
			});
		});

		it('should return schema for valid event type', () => {
			const schema = getEventPayloadSchema('task:created');
			expect(schema).toBeDefined();
			expect(schema).toBe(TaskCreatedPayloadSchema);
		});

		it('should return null for invalid event type', () => {
			const schema = getEventPayloadSchema('invalid:event');
			expect(schema).toBeNull();
		});

		it('should check if event type has schema', () => {
			expect(hasEventPayloadSchema('task:created')).toBe(true);
			expect(hasEventPayloadSchema('invalid:event')).toBe(false);
		});

		it('should return all supported event types', () => {
			const eventTypes = getSupportedEventTypes();
			expect(Array.isArray(eventTypes)).toBe(true);
			expect(eventTypes.length).toBeGreaterThan(0);
			expect(eventTypes).toContain('task:created');
			expect(eventTypes).toContain('integration:success');
		});

		it('should return schema version info', () => {
			const versionInfo = getSchemaVersionInfo();
			expect(versionInfo.version).toBe(SCHEMA_VERSION);
			expect(versionInfo.supportedEventTypes).toEqual(getSupportedEventTypes());
			expect(versionInfo.totalSchemas).toBeGreaterThan(0);
			expect(versionInfo.createdAt).toBeDefined();
		});
	});

	describe('Base Event Payload Structure', () => {
		const createBasePayload = () => ({
			version: SCHEMA_VERSION,
			eventId: 'evt_123456789_abc123def',
			timestamp: '2025-06-21T16:54:12.621Z',
			context: {
				projectRoot: '/app',
				session: { user: 'test_user' },
				source: 'cli',
				requestId: 'req_123'
			}
		});

		it('should validate base payload structure', () => {
			const basePayload = createBasePayload();

			// All schemas should accept valid base structure
			const schema = getEventPayloadSchema('task:created');
			const result = schema.safeParse({
				...basePayload,
				taskId: '1',
				task: {
					id: '1',
					title: 'Test Task',
					description: 'Test Description',
					status: 'pending',
					priority: 'medium',
					dependencies: [],
					subtasks: []
				},
				tag: 'master'
			});

			expect(result.success).toBe(true);
		});

		it('should require all base fields', () => {
			const schema = getEventPayloadSchema('task:created');

			// Missing version
			let result = schema.safeParse({
				eventId: 'evt_123',
				timestamp: '2025-06-21T16:54:12.621Z',
				context: { projectRoot: '/app', session: {}, source: 'cli' },
				taskId: '1',
				task: {
					id: '1',
					title: 'Test',
					description: 'Test',
					status: 'pending',
					priority: 'medium',
					dependencies: [],
					subtasks: []
				},
				tag: 'master'
			});
			expect(result.success).toBe(false);

			// Missing timestamp
			result = schema.safeParse({
				version: SCHEMA_VERSION,
				eventId: 'evt_123',
				context: { projectRoot: '/app', session: {}, source: 'cli' },
				taskId: '1',
				task: {
					id: '1',
					title: 'Test',
					description: 'Test',
					status: 'pending',
					priority: 'medium',
					dependencies: [],
					subtasks: []
				},
				tag: 'master'
			});
			expect(result.success).toBe(false);

			// Missing context
			result = schema.safeParse({
				version: SCHEMA_VERSION,
				eventId: 'evt_123',
				timestamp: '2025-06-21T16:54:12.621Z',
				taskId: '1',
				task: {
					id: '1',
					title: 'Test',
					description: 'Test',
					status: 'pending',
					priority: 'medium',
					dependencies: [],
					subtasks: []
				},
				tag: 'master'
			});
			expect(result.success).toBe(false);
		});

		it('should validate context structure', () => {
			const schema = getEventPayloadSchema('task:created');

			// Invalid source
			let result = schema.safeParse({
				version: SCHEMA_VERSION,
				eventId: 'evt_123',
				timestamp: '2025-06-21T16:54:12.621Z',
				context: { projectRoot: '/app', session: {}, source: 'invalid' },
				taskId: '1',
				task: {
					id: '1',
					title: 'Test',
					description: 'Test',
					status: 'pending',
					priority: 'medium',
					dependencies: [],
					subtasks: []
				},
				tag: 'master'
			});
			expect(result.success).toBe(false);

			// Valid sources
			const validSources = ['cli', 'mcp', 'api', 'webhook'];
			validSources.forEach((source) => {
				result = schema.safeParse({
					version: SCHEMA_VERSION,
					eventId: 'evt_123',
					timestamp: '2025-06-21T16:54:12.621Z',
					context: { projectRoot: '/app', session: {}, source },
					taskId: '1',
					task: {
						id: '1',
						title: 'Test',
						description: 'Test',
						status: 'pending',
						priority: 'medium',
						dependencies: [],
						subtasks: []
					},
					tag: 'master'
				});
				expect(result.success).toBe(true);
			});
		});
	});

	describe('Task Event Schemas', () => {
		const createValidTask = () => ({
			id: '1',
			title: 'Test Task',
			description: 'Test Description',
			details: 'Detailed implementation notes',
			status: 'pending',
			priority: 'high',
			dependencies: ['2', '3'],
			subtasks: [],
			testStrategy: 'Unit tests required',
			linearIssueId: 'LIN-123'
		});

		const createValidContext = () => ({
			projectRoot: '/app',
			session: { user: 'test_user' },
			source: 'cli',
			requestId: 'req_123'
		});

		describe('Task Created Schema', () => {
			it('should validate valid task created payload', () => {
				const payload = {
					version: SCHEMA_VERSION,
					eventId: 'evt_123',
					timestamp: '2025-06-21T16:54:12.621Z',
					context: createValidContext(),
					taskId: '1',
					task: createValidTask(),
					tag: 'master'
				};

				const result = TaskCreatedPayloadSchema.safeParse(payload);
				expect(result.success).toBe(true);
			});

			it('should validate with optional parentTaskId', () => {
				const payload = {
					version: SCHEMA_VERSION,
					eventId: 'evt_123',
					timestamp: '2025-06-21T16:54:12.621Z',
					context: createValidContext(),
					taskId: '1',
					task: createValidTask(),
					tag: 'master',
					parentTaskId: '5'
				};

				const result = TaskCreatedPayloadSchema.safeParse(payload);
				expect(result.success).toBe(true);
			});

			it('should require taskId, task, and tag', () => {
				const basePayload = {
					version: SCHEMA_VERSION,
					eventId: 'evt_123',
					timestamp: '2025-06-21T16:54:12.621Z',
					context: createValidContext()
				};

				// Missing taskId
				let result = TaskCreatedPayloadSchema.safeParse({
					...basePayload,
					task: createValidTask(),
					tag: 'master'
				});
				expect(result.success).toBe(false);

				// Missing task
				result = TaskCreatedPayloadSchema.safeParse({
					...basePayload,
					taskId: '1',
					tag: 'master'
				});
				expect(result.success).toBe(false);

				// Missing tag
				result = TaskCreatedPayloadSchema.safeParse({
					...basePayload,
					taskId: '1',
					task: createValidTask()
				});
				expect(result.success).toBe(false);
			});
		});

		describe('Task Updated Schema', () => {
			it('should validate valid task updated payload', () => {
				const payload = {
					version: SCHEMA_VERSION,
					eventId: 'evt_123',
					timestamp: '2025-06-21T16:54:12.621Z',
					context: createValidContext(),
					taskId: '1',
					task: createValidTask(),
					changes: { title: 'Updated Title' },
					oldValues: { title: 'Old Title' },
					tag: 'master',
					changeType: 'field_update'
				};

				const result = TaskUpdatedPayloadSchema.safeParse(payload);
				expect(result.success).toBe(true);
			});

			it('should validate changeType enum', () => {
				const basePayload = {
					version: SCHEMA_VERSION,
					eventId: 'evt_123',
					timestamp: '2025-06-21T16:54:12.621Z',
					context: createValidContext(),
					taskId: '1',
					task: createValidTask(),
					changes: {},
					oldValues: {},
					tag: 'master'
				};

				const validChangeTypes = [
					'field_update',
					'metadata_update',
					'bulk_update'
				];
				validChangeTypes.forEach((changeType) => {
					const result = TaskUpdatedPayloadSchema.safeParse({
						...basePayload,
						changeType
					});
					expect(result.success).toBe(true);
				});

				// Invalid changeType
				const result = TaskUpdatedPayloadSchema.safeParse({
					...basePayload,
					changeType: 'invalid_type'
				});
				expect(result.success).toBe(false);
			});
		});

		describe('Task Status Changed Schema', () => {
			it('should validate valid task status changed payload', () => {
				const payload = {
					version: SCHEMA_VERSION,
					eventId: 'evt_123',
					timestamp: '2025-06-21T16:54:12.621Z',
					context: createValidContext(),
					taskId: '1',
					task: createValidTask(),
					oldStatus: 'pending',
					newStatus: 'in-progress',
					tag: 'master',
					reason: 'User started working on task',
					triggeredBy: 'set-status command'
				};

				const result = TaskStatusChangedPayloadSchema.safeParse(payload);
				expect(result.success).toBe(true);
			});

			it('should validate status enum values', () => {
				const basePayload = {
					version: SCHEMA_VERSION,
					eventId: 'evt_123',
					timestamp: '2025-06-21T16:54:12.621Z',
					context: createValidContext(),
					taskId: '1',
					task: createValidTask(),
					tag: 'master'
				};

				const validStatuses = [
					'pending',
					'in-progress',
					'review',
					'done',
					'cancelled',
					'deferred'
				];

				validStatuses.forEach((status) => {
					const result = TaskStatusChangedPayloadSchema.safeParse({
						...basePayload,
						oldStatus: status,
						newStatus: status
					});
					expect(result.success).toBe(true);
				});

				// Invalid status
				const result = TaskStatusChangedPayloadSchema.safeParse({
					...basePayload,
					oldStatus: 'invalid_status',
					newStatus: 'pending'
				});
				expect(result.success).toBe(false);
			});
		});
	});

	describe('Subtask Event Schemas', () => {
		const createValidSubtask = () => ({
			id: '1',
			title: 'Test Subtask',
			description: 'Test Description',
			status: 'pending',
			dependencies: []
		});

		const createValidTask = () => ({
			id: '5',
			title: 'Parent Task',
			description: 'Parent Description',
			status: 'in-progress',
			priority: 'medium',
			dependencies: [],
			subtasks: [createValidSubtask()]
		});

		it('should validate subtask created payload', () => {
			const payload = {
				version: SCHEMA_VERSION,
				eventId: 'evt_123',
				timestamp: '2025-06-21T16:54:12.621Z',
				context: {
					projectRoot: '/app',
					session: {},
					source: 'cli'
				},
				parentTaskId: '5',
				subtaskId: '1',
				subtask: createValidSubtask(),
				parentTask: createValidTask(),
				tag: 'master'
			};

			const result = SubtaskCreatedPayloadSchema.safeParse(payload);
			expect(result.success).toBe(true);
		});
	});

	describe('Dependency Event Schemas', () => {
		it('should validate dependency added payload', () => {
			const task1 = {
				id: '1',
				title: 'Task 1',
				description: 'Description 1',
				status: 'pending',
				priority: 'medium',
				dependencies: ['2'],
				subtasks: []
			};

			const task2 = {
				id: '2',
				title: 'Task 2',
				description: 'Description 2',
				status: 'done',
				priority: 'high',
				dependencies: [],
				subtasks: []
			};

			const payload = {
				version: SCHEMA_VERSION,
				eventId: 'evt_123',
				timestamp: '2025-06-21T16:54:12.621Z',
				context: {
					projectRoot: '/app',
					session: {},
					source: 'cli'
				},
				taskId: '1',
				dependsOnTaskId: '2',
				task: task1,
				dependsOnTask: task2,
				tag: 'master'
			};

			const result = DependencyAddedPayloadSchema.safeParse(payload);
			expect(result.success).toBe(true);
		});
	});

	describe('Bulk Operation Schemas', () => {
		it('should validate tasks bulk created payload', () => {
			const tasks = [
				{
					id: '1',
					title: 'Task 1',
					description: 'Description 1',
					status: 'pending',
					priority: 'medium',
					dependencies: [],
					subtasks: []
				},
				{
					id: '2',
					title: 'Task 2',
					description: 'Description 2',
					status: 'pending',
					priority: 'high',
					dependencies: [],
					subtasks: []
				}
			];

			const payload = {
				version: SCHEMA_VERSION,
				eventId: 'evt_123',
				timestamp: '2025-06-21T16:54:12.621Z',
				context: {
					projectRoot: '/app',
					session: {},
					source: 'api'
				},
				tasks,
				tag: 'master',
				batchId: 'batch_123',
				totalCount: 2,
				successCount: 2,
				failureCount: 0,
				failures: []
			};

			const result = TasksBulkCreatedPayloadSchema.safeParse(payload);
			expect(result.success).toBe(true);
		});

		it('should validate bulk payload with failures', () => {
			const payload = {
				version: SCHEMA_VERSION,
				eventId: 'evt_123',
				timestamp: '2025-06-21T16:54:12.621Z',
				context: {
					projectRoot: '/app',
					session: {},
					source: 'api'
				},
				tasks: [],
				tag: 'master',
				batchId: 'batch_123',
				totalCount: 3,
				successCount: 1,
				failureCount: 2,
				failures: [
					{
						taskData: { title: 'Invalid Task' },
						error: 'Missing required field: description',
						index: 1
					},
					{
						taskData: { title: 'Another Invalid Task' },
						error: 'Invalid status value',
						index: 2
					}
				]
			};

			const result = TasksBulkCreatedPayloadSchema.safeParse(payload);
			expect(result.success).toBe(true);
		});
	});

	describe('Integration Event Schemas', () => {
		it('should validate integration success payload', () => {
			const payload = {
				version: SCHEMA_VERSION,
				eventId: 'evt_123',
				timestamp: '2025-06-21T16:54:12.621Z',
				context: {
					projectRoot: '/app',
					session: {},
					source: 'mcp'
				},
				integrationName: 'linear',
				operation: 'createIssue',
				originalEvent: 'task:created',
				result: {
					issueId: 'LIN-123',
					url: 'https://linear.app/issue/LIN-123'
				},
				executionTime: 1250,
				retryCount: 0
			};

			const result = IntegrationSuccessPayloadSchema.safeParse(payload);
			expect(result.success).toBe(true);
		});

		it('should validate integration error payload', () => {
			const payload = {
				version: SCHEMA_VERSION,
				eventId: 'evt_123',
				timestamp: '2025-06-21T16:54:12.621Z',
				context: {
					projectRoot: '/app',
					session: {},
					source: 'mcp'
				},
				integrationName: 'linear',
				operation: 'createIssue',
				originalEvent: 'task:created',
				error: {
					message: 'API key is invalid',
					code: 'INVALID_API_KEY',
					type: 'AuthenticationError'
				},
				retryCount: 2,
				willRetry: false,
				executionTime: 500
			};

			const result = IntegrationErrorPayloadSchema.safeParse(payload);
			expect(result.success).toBe(true);
		});
	});

	describe('Data Type Validation', () => {
		it('should accept both string and number IDs', () => {
			const schema = getEventPayloadSchema('task:created');

			// String ID
			let result = schema.safeParse({
				version: SCHEMA_VERSION,
				eventId: 'evt_123',
				timestamp: '2025-06-21T16:54:12.621Z',
				context: { projectRoot: '/app', session: {}, source: 'cli' },
				taskId: 'string-id',
				task: {
					id: 'string-id',
					title: 'Test',
					description: 'Test',
					status: 'pending',
					priority: 'medium',
					dependencies: [],
					subtasks: []
				},
				tag: 'master'
			});
			expect(result.success).toBe(true);

			// Number ID
			result = schema.safeParse({
				version: SCHEMA_VERSION,
				eventId: 'evt_123',
				timestamp: '2025-06-21T16:54:12.621Z',
				context: { projectRoot: '/app', session: {}, source: 'cli' },
				taskId: 123,
				task: {
					id: 123,
					title: 'Test',
					description: 'Test',
					status: 'pending',
					priority: 'medium',
					dependencies: [],
					subtasks: []
				},
				tag: 'master'
			});
			expect(result.success).toBe(true);
		});

		it('should validate priority enum', () => {
			const schema = getEventPayloadSchema('task:created');
			const basePayload = {
				version: SCHEMA_VERSION,
				eventId: 'evt_123',
				timestamp: '2025-06-21T16:54:12.621Z',
				context: { projectRoot: '/app', session: {}, source: 'cli' },
				taskId: '1',
				tag: 'master'
			};

			const validPriorities = ['high', 'medium', 'low'];
			validPriorities.forEach((priority) => {
				const result = schema.safeParse({
					...basePayload,
					task: {
						id: '1',
						title: 'Test',
						description: 'Test',
						status: 'pending',
						priority,
						dependencies: [],
						subtasks: []
					}
				});
				expect(result.success).toBe(true);
			});

			// Invalid priority
			const result = schema.safeParse({
				...basePayload,
				task: {
					id: '1',
					title: 'Test',
					description: 'Test',
					status: 'pending',
					priority: 'invalid',
					dependencies: [],
					subtasks: []
				}
			});
			expect(result.success).toBe(false);
		});

		it('should validate timestamp format', () => {
			const schema = getEventPayloadSchema('task:created');
			const basePayload = {
				version: SCHEMA_VERSION,
				eventId: 'evt_123',
				context: { projectRoot: '/app', session: {}, source: 'cli' },
				taskId: '1',
				task: {
					id: '1',
					title: 'Test',
					description: 'Test',
					status: 'pending',
					priority: 'medium',
					dependencies: [],
					subtasks: []
				},
				tag: 'master'
			};

			// Valid ISO timestamp
			let result = schema.safeParse({
				...basePayload,
				timestamp: '2025-06-21T16:54:12.621Z'
			});
			expect(result.success).toBe(true);

			// Invalid timestamp
			result = schema.safeParse({
				...basePayload,
				timestamp: 'invalid-date'
			});
			expect(result.success).toBe(false);
		});
	});
});
