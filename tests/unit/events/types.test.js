/**
 * @fileoverview Tests for event system types and utilities
 */

import {
	EVENT_TYPES,
	DEFAULT_CONFIG,
	validateEventPayload,
	createEventPayload
} from '../../../scripts/modules/events/types.js';

describe('EVENT_TYPES', () => {
	test('should define all required event types', () => {
		const expectedTypes = [
			'TASK_CREATED',
			'TASK_UPDATED',
			'TASK_STATUS_CHANGED',
			'TASK_REMOVED',
			'SUBTASK_CREATED',
			'SUBTASK_UPDATED',
			'SUBTASK_STATUS_CHANGED',
			'SUBTASK_REMOVED',
			'DEPENDENCY_ADDED',
			'DEPENDENCY_REMOVED',
			'DEPENDENCIES_SATISFIED',
			'TASKS_BULK_CREATED',
			'TASKS_BULK_UPDATED',
			'TASKS_BULK_STATUS_CHANGED',
			'TAG_CREATED',
			'TAG_SWITCHED',
			'TAG_DELETED',
			'INTEGRATION_SUCCESS',
			'INTEGRATION_ERROR'
		];

		expectedTypes.forEach((type) => {
			expect(EVENT_TYPES).toHaveProperty(type);
			expect(typeof EVENT_TYPES[type]).toBe('string');
		});
	});

	test('should have consistent naming pattern', () => {
		Object.values(EVENT_TYPES).forEach((eventType) => {
			expect(eventType).toMatch(/^[a-z]+:[a-z:]+$/);
		});
	});

	test('should have unique values', () => {
		const values = Object.values(EVENT_TYPES);
		const uniqueValues = [...new Set(values)];
		expect(values.length).toBe(uniqueValues.length);
	});
});

describe('DEFAULT_CONFIG', () => {
	test('should provide eventProcessing defaults', () => {
		expect(DEFAULT_CONFIG.eventProcessing).toBeDefined();
		expect(DEFAULT_CONFIG.eventProcessing.maxConcurrentHandlers).toBe(5);
		expect(DEFAULT_CONFIG.eventProcessing.handlerTimeout).toBe(30000);
		expect(DEFAULT_CONFIG.eventProcessing.retryAttempts).toBe(3);
		expect(DEFAULT_CONFIG.eventProcessing.retryBackoff).toBe('exponential');
		expect(DEFAULT_CONFIG.eventProcessing.enableBatching).toBe(true);
		expect(DEFAULT_CONFIG.eventProcessing.batchSize).toBe(10);
		expect(DEFAULT_CONFIG.eventProcessing.batchTimeout).toBe(5000);
	});

	test('should provide retry defaults', () => {
		expect(DEFAULT_CONFIG.retry).toBeDefined();
		expect(DEFAULT_CONFIG.retry.maxAttempts).toBe(3);
		expect(DEFAULT_CONFIG.retry.backoffStrategy).toBe('exponential');
		expect(DEFAULT_CONFIG.retry.baseDelay).toBe(1000);
		expect(DEFAULT_CONFIG.retry.maxDelay).toBe(30000);
		expect(Array.isArray(DEFAULT_CONFIG.retry.retryableErrors)).toBe(true);
	});

	test('should have reasonable default values', () => {
		// Timeouts should be positive
		expect(DEFAULT_CONFIG.eventProcessing.handlerTimeout).toBeGreaterThan(0);
		expect(DEFAULT_CONFIG.retry.baseDelay).toBeGreaterThan(0);
		expect(DEFAULT_CONFIG.retry.maxDelay).toBeGreaterThan(
			DEFAULT_CONFIG.retry.baseDelay
		);

		// Counts should be positive
		expect(
			DEFAULT_CONFIG.eventProcessing.maxConcurrentHandlers
		).toBeGreaterThan(0);
		expect(DEFAULT_CONFIG.retry.maxAttempts).toBeGreaterThan(0);

		// Batch settings should be reasonable
		expect(DEFAULT_CONFIG.eventProcessing.batchSize).toBeGreaterThan(0);
		expect(DEFAULT_CONFIG.eventProcessing.batchTimeout).toBeGreaterThan(0);
	});
});

describe('validateEventPayload', () => {
	const validContext = {
		projectRoot: '/test/project',
		session: { user: 'testuser' },
		source: 'test',
		requestId: 'test-123'
	};

	const validPayload = {
		taskId: 'task-123',
		task: { id: 'task-123', title: 'Test Task' },
		context: validContext,
		timestamp: new Date().toISOString()
	};

	test('should validate correct payload', () => {
		expect(validateEventPayload('task:created', validPayload)).toBe(true);
	});

	test('should reject missing event type', () => {
		expect(validateEventPayload('', validPayload)).toBe(false);
		expect(validateEventPayload(null, validPayload)).toBe(false);
		expect(validateEventPayload(undefined, validPayload)).toBe(false);
	});

	test('should reject invalid event type', () => {
		expect(validateEventPayload(123, validPayload)).toBe(false);
		expect(validateEventPayload({}, validPayload)).toBe(false);
	});

	test('should reject missing payload', () => {
		expect(validateEventPayload('task:created', null)).toBe(false);
		expect(validateEventPayload('task:created', undefined)).toBe(false);
	});

	test('should reject invalid payload type', () => {
		expect(validateEventPayload('task:created', 'string')).toBe(false);
		expect(validateEventPayload('task:created', 123)).toBe(false);
	});

	test('should reject payload missing context', () => {
		const payloadWithoutContext = { ...validPayload };
		delete payloadWithoutContext.context;

		expect(validateEventPayload('task:created', payloadWithoutContext)).toBe(
			false
		);
	});

	test('should reject payload missing timestamp', () => {
		const payloadWithoutTimestamp = { ...validPayload };
		delete payloadWithoutTimestamp.timestamp;

		expect(validateEventPayload('task:created', payloadWithoutTimestamp)).toBe(
			false
		);
	});

	test('should reject invalid timestamp format', () => {
		const payloadWithInvalidTimestamp = {
			...validPayload,
			timestamp: 'invalid-date'
		};

		expect(
			validateEventPayload('task:created', payloadWithInvalidTimestamp)
		).toBe(false);
	});

	test('should accept valid timestamp formats', () => {
		const validTimestamps = [
			new Date().toISOString(),
			'2023-12-25T10:30:00.000Z',
			'2023-12-25T10:30:00Z'
		];

		validTimestamps.forEach((timestamp) => {
			const payload = { ...validPayload, timestamp };
			expect(validateEventPayload('task:created', payload)).toBe(true);
		});
	});
});

describe('createEventPayload', () => {
	const mockContext = {
		projectRoot: '/test/project',
		session: { user: 'testuser' },
		source: 'test',
		requestId: 'test-123'
	};

	const eventData = {
		taskId: 'task-123',
		task: { id: 'task-123', title: 'Test Task' },
		tag: 'master'
	};

	test('should create valid event payload', () => {
		const payload = createEventPayload('task:created', eventData, mockContext);

		expect(payload.type).toBe('task:created');
		expect(payload.payload).toBeDefined();
		expect(payload.payload.taskId).toBe('task-123');
		expect(payload.payload.context).toBe(mockContext);
		expect(payload.payload.timestamp).toBeDefined();
	});

	test('should include all provided data', () => {
		const payload = createEventPayload('task:updated', eventData, mockContext);

		expect(payload.payload.taskId).toBe(eventData.taskId);
		expect(payload.payload.task).toBe(eventData.task);
		expect(payload.payload.tag).toBe(eventData.tag);
	});

	test('should add timestamp automatically', () => {
		const beforeTime = Date.now();
		const payload = createEventPayload('task:created', eventData, mockContext);
		const afterTime = Date.now();

		const payloadTime = new Date(payload.payload.timestamp).getTime();
		expect(payloadTime).toBeGreaterThanOrEqual(beforeTime);
		expect(payloadTime).toBeLessThanOrEqual(afterTime);
	});

	test('should not overwrite existing timestamp', () => {
		const customTimestamp = '2023-01-01T00:00:00.000Z';
		const dataWithTimestamp = { ...eventData, timestamp: customTimestamp };

		const payload = createEventPayload(
			'task:created',
			dataWithTimestamp,
			mockContext
		);

		// Should have the auto-generated timestamp, not the one in data
		expect(payload.payload.timestamp).not.toBe(customTimestamp);
		expect(new Date(payload.payload.timestamp).getTime()).toBeGreaterThan(
			new Date(customTimestamp).getTime()
		);
	});

	test('should handle empty data', () => {
		const payload = createEventPayload('system:startup', {}, mockContext);

		expect(payload.type).toBe('system:startup');
		expect(payload.payload.context).toBe(mockContext);
		expect(payload.payload.timestamp).toBeDefined();
	});

	test('should handle null data', () => {
		const payload = createEventPayload('system:shutdown', null, mockContext);

		expect(payload.type).toBe('system:shutdown');
		expect(payload.payload.context).toBe(mockContext);
		expect(payload.payload.timestamp).toBeDefined();
	});

	test('should merge data with context and timestamp', () => {
		const complexData = {
			taskId: 'task-123',
			changes: { status: 'done' },
			metadata: { source: 'ai' }
		};

		const payload = createEventPayload(
			'task:updated',
			complexData,
			mockContext
		);

		expect(payload.payload.taskId).toBe('task-123');
		expect(payload.payload.changes).toBe(complexData.changes);
		expect(payload.payload.metadata).toBe(complexData.metadata);
		expect(payload.payload.context).toBe(mockContext);
		expect(payload.payload.timestamp).toBeDefined();
	});

	test('should preserve data object references', () => {
		const taskObject = { id: 'task-123', title: 'Test Task' };
		const data = { task: taskObject };

		const payload = createEventPayload('task:created', data, mockContext);

		expect(payload.payload.task).toBe(taskObject); // Same reference
	});

	test('should create ISO 8601 timestamps', () => {
		const payload = createEventPayload('task:created', eventData, mockContext);

		// Should be valid ISO 8601 format
		expect(payload.payload.timestamp).toMatch(
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
		);

		// Should be parseable
		expect(() => new Date(payload.payload.timestamp)).not.toThrow();
	});
});

describe('Type definitions consistency', () => {
	test('EVENT_TYPES should match expected patterns', () => {
		// Task events should start with 'task:'
		const taskEvents = [
			EVENT_TYPES.TASK_CREATED,
			EVENT_TYPES.TASK_UPDATED,
			EVENT_TYPES.TASK_STATUS_CHANGED,
			EVENT_TYPES.TASK_REMOVED
		];

		taskEvents.forEach((eventType) => {
			expect(eventType).toMatch(/^task:/);
		});

		// Subtask events should start with 'subtask:'
		const subtaskEvents = [
			EVENT_TYPES.SUBTASK_CREATED,
			EVENT_TYPES.SUBTASK_UPDATED,
			EVENT_TYPES.SUBTASK_STATUS_CHANGED,
			EVENT_TYPES.SUBTASK_REMOVED
		];

		subtaskEvents.forEach((eventType) => {
			expect(eventType).toMatch(/^subtask:/);
		});

		// Dependency events should start with 'dependency:' or 'dependencies:'
		const dependencyEvents = [
			EVENT_TYPES.DEPENDENCY_ADDED,
			EVENT_TYPES.DEPENDENCY_REMOVED,
			EVENT_TYPES.DEPENDENCIES_SATISFIED
		];

		dependencyEvents.forEach((eventType) => {
			expect(eventType).toMatch(/^dependenc(y|ies):/);
		});
	});

	test('should have consistent default configuration structure', () => {
		// All timeout values should be numbers
		expect(typeof DEFAULT_CONFIG.eventProcessing.handlerTimeout).toBe('number');
		expect(typeof DEFAULT_CONFIG.eventProcessing.batchTimeout).toBe('number');
		expect(typeof DEFAULT_CONFIG.retry.baseDelay).toBe('number');
		expect(typeof DEFAULT_CONFIG.retry.maxDelay).toBe('number');

		// All count values should be numbers
		expect(typeof DEFAULT_CONFIG.eventProcessing.maxConcurrentHandlers).toBe(
			'number'
		);
		expect(typeof DEFAULT_CONFIG.eventProcessing.retryAttempts).toBe('number');
		expect(typeof DEFAULT_CONFIG.eventProcessing.batchSize).toBe('number');
		expect(typeof DEFAULT_CONFIG.retry.maxAttempts).toBe('number');

		// Boolean values should be boolean
		expect(typeof DEFAULT_CONFIG.eventProcessing.enableBatching).toBe(
			'boolean'
		);

		// String values should be string
		expect(typeof DEFAULT_CONFIG.eventProcessing.retryBackoff).toBe('string');
		expect(typeof DEFAULT_CONFIG.retry.backoffStrategy).toBe('string');

		// Array values should be arrays
		expect(Array.isArray(DEFAULT_CONFIG.retry.retryableErrors)).toBe(true);
	});
});
