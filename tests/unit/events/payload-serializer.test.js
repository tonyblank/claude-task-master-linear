/**
 * @fileoverview Tests for Event Payload Serializer
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
	EventPayloadSerializer,
	SERIALIZATION_FORMATS,
	COMPRESSION_ALGORITHMS,
	getGlobalSerializer,
	serializeEventPayload,
	deserializeEventPayload,
	validateEventPayload,
	createStandardEventPayload
} from '../../../scripts/modules/events/payload-serializer.js';
import { SCHEMA_VERSION } from '../../../scripts/modules/events/payload-schemas.js';

describe('Event Payload Serializer', () => {
	let serializer;

	beforeEach(() => {
		serializer = new EventPayloadSerializer({
			validate: true,
			includeMetadata: true,
			preserveTypes: true
		});
	});

	afterEach(() => {
		serializer.resetStats();
	});

	describe('EventPayloadSerializer Class', () => {
		describe('Construction', () => {
			it('should create serializer with default options', () => {
				const defaultSerializer = new EventPayloadSerializer();
				expect(defaultSerializer.options.format).toBe(
					SERIALIZATION_FORMATS.JSON
				);
				expect(defaultSerializer.options.validate).toBe(true);
				expect(defaultSerializer.options.compression).toBe(
					COMPRESSION_ALGORITHMS.NONE
				);
			});

			it('should create serializer with custom options', () => {
				const customSerializer = new EventPayloadSerializer({
					format: SERIALIZATION_FORMATS.JSON_COMPACT,
					validate: false,
					prettyPrint: true
				});

				expect(customSerializer.options.format).toBe(
					SERIALIZATION_FORMATS.JSON_COMPACT
				);
				expect(customSerializer.options.validate).toBe(false);
				expect(customSerializer.options.prettyPrint).toBe(true);
			});
		});

		describe('Serialization', () => {
			const createValidPayload = () => ({
				version: SCHEMA_VERSION,
				eventId: 'evt_123456789_abc123def',
				timestamp: '2025-06-21T16:54:12.621Z',
				context: {
					projectRoot: '/app',
					session: { user: 'test_user' },
					source: 'cli',
					requestId: 'req_123'
				},
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

			it('should serialize valid payload successfully', async () => {
				const payload = createValidPayload();
				const result = await serializer.serialize('task:created', payload);

				expect(result.success).toBe(true);
				expect(result.data).toBeDefined();
				expect(result.metadata.eventType).toBe('task:created');
				expect(result.metadata.format).toBe(SERIALIZATION_FORMATS.JSON);
				expect(result.metadata.schemaVersion).toBe(SCHEMA_VERSION);
				expect(result.metadata.size).toBeGreaterThan(0);
				expect(result.metadata.executionTime).toBeGreaterThanOrEqual(0);
			});

			it('should add serialization metadata when includeMetadata is true', async () => {
				const payload = createValidPayload();
				const result = await serializer.serialize('task:created', payload);

				expect(result.success).toBe(true);
				const parsedData = JSON.parse(result.data);
				expect(parsedData._serialization).toBeDefined();
				expect(parsedData._serialization.eventType).toBe('task:created');
				expect(parsedData._serialization.schemaVersion).toBe(SCHEMA_VERSION);
			});

			it('should serialize without metadata when includeMetadata is false', async () => {
				const noMetadataSerializer = new EventPayloadSerializer({
					includeMetadata: false
				});

				const payload = createValidPayload();
				const result = await noMetadataSerializer.serialize(
					'task:created',
					payload
				);

				expect(result.success).toBe(true);
				const parsedData = JSON.parse(result.data);
				expect(parsedData._serialization).toBeUndefined();
			});

			it('should serialize with pretty print when enabled', async () => {
				const prettySerializer = new EventPayloadSerializer({
					prettyPrint: true
				});

				const payload = createValidPayload();
				const result = await prettySerializer.serialize(
					'task:created',
					payload
				);

				expect(result.success).toBe(true);
				expect(result.data).toContain('\n');
				expect(result.data).toContain('  '); // Indentation
			});

			it('should serialize in compact JSON format', async () => {
				const compactSerializer = new EventPayloadSerializer({
					format: SERIALIZATION_FORMATS.JSON_COMPACT
				});

				const payload = createValidPayload();
				const result = await compactSerializer.serialize(
					'task:created',
					payload
				);

				expect(result.success).toBe(true);
				expect(result.data).toBeDefined();
				expect(result.metadata.format).toBe(SERIALIZATION_FORMATS.JSON_COMPACT);
			});

			it('should serialize in binary format', async () => {
				const binarySerializer = new EventPayloadSerializer({
					format: SERIALIZATION_FORMATS.BINARY
				});

				const payload = createValidPayload();
				const result = await binarySerializer.serialize(
					'task:created',
					payload
				);

				expect(result.success).toBe(true);
				expect(Buffer.isBuffer(result.data)).toBe(true);
				expect(result.metadata.format).toBe(SERIALIZATION_FORMATS.BINARY);
			});

			it('should fail validation with invalid payload', async () => {
				const invalidPayload = {
					version: SCHEMA_VERSION,
					eventId: 'evt_123',
					timestamp: 'invalid-timestamp', // Invalid timestamp
					context: {
						projectRoot: '/app',
						session: {},
						source: 'invalid-source' // Invalid source
					},
					taskId: '1',
					// Missing task field
					tag: 'master'
				};

				const result = await serializer.serialize(
					'task:created',
					invalidPayload
				);
				expect(result.success).toBe(false);
				expect(result.error).toBeDefined();
			});

			it('should serialize without validation when disabled', async () => {
				const noValidationSerializer = new EventPayloadSerializer({
					validate: false
				});

				const invalidPayload = {
					invalidField: 'this should not be here'
				};

				const result = await noValidationSerializer.serialize(
					'task:created',
					invalidPayload
				);
				expect(result.success).toBe(true);
			});

			it('should handle unsupported serialization format', async () => {
				const payload = createValidPayload();
				const result = await serializer.serialize('task:created', payload, {
					format: 'unsupported-format'
				});

				expect(result.success).toBe(false);
				expect(result.error).toContain('Unsupported serialization format');
			});

			it('should preserve special data types', async () => {
				const preserveTypesSerializer = new EventPayloadSerializer({
					preserveTypes: true
				});

				const payload = {
					...createValidPayload(),
					specialDate: new Date('2025-06-21T16:54:12.621Z'),
					specialRegex: /test-pattern/gi
				};

				const result = await preserveTypesSerializer.serialize(
					'task:created',
					payload
				);
				expect(result.success).toBe(true);

				const parsedData = JSON.parse(result.data);
				expect(parsedData.specialDate._type).toBe('Date');
				expect(parsedData.specialRegex._type).toBe('RegExp');
			});
		});

		describe('Deserialization', () => {
			const createSerializedData = async () => {
				const payload = {
					version: SCHEMA_VERSION,
					eventId: 'evt_123456789_abc123def',
					timestamp: '2025-06-21T16:54:12.621Z',
					context: {
						projectRoot: '/app',
						session: { user: 'test_user' },
						source: 'cli'
					},
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
				};

				const serializeResult = await serializer.serialize(
					'task:created',
					payload
				);
				return serializeResult.data;
			};

			it('should deserialize valid data successfully', async () => {
				const serializedData = await createSerializedData();
				const result = await serializer.deserialize(serializedData);

				expect(result.success).toBe(true);
				expect(result.payload).toBeDefined();
				expect(result.payload.taskId).toBe('1');
				expect(result.payload.task.title).toBe('Test Task');
				expect(result.metadata).toBeDefined();
			});

			it('should extract metadata from serialized data', async () => {
				const serializedData = await createSerializedData();
				const result = await serializer.deserialize(serializedData);

				expect(result.success).toBe(true);
				expect(result.metadata.eventType).toBe('task:created');
				expect(result.metadata.format).toBe(SERIALIZATION_FORMATS.JSON);
				expect(result.metadata.schemaVersion).toBe(SCHEMA_VERSION);
			});

			it('should restore special data types', async () => {
				const preserveTypesSerializer = new EventPayloadSerializer({
					preserveTypes: true,
					includeMetadata: true
				});

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
					task: {
						id: '1',
						title: 'Test Task',
						description: 'Test Description',
						status: 'pending',
						priority: 'medium',
						dependencies: [],
						subtasks: []
					},
					tag: 'master',
					specialDate: new Date('2025-06-21T16:54:12.621Z'),
					specialRegex: /test-pattern/gi
				};

				const serializeResult = await preserveTypesSerializer.serialize(
					'task:created',
					payload
				);
				const deserializeResult = await preserveTypesSerializer.deserialize(
					serializeResult.data
				);

				expect(deserializeResult.success).toBe(true);
				expect(deserializeResult.payload.specialDate).toBeInstanceOf(Date);
				expect(deserializeResult.payload.specialRegex).toBeInstanceOf(RegExp);
			});

			it('should deserialize binary format', async () => {
				const binarySerializer = new EventPayloadSerializer({
					format: SERIALIZATION_FORMATS.BINARY
				});

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
				};

				const serializeResult = await binarySerializer.serialize(
					'task:created',
					payload
				);
				const deserializeResult = await binarySerializer.deserialize(
					serializeResult.data
				);

				expect(deserializeResult.success).toBe(true);
				expect(deserializeResult.payload.taskId).toBe('1');
			});

			it('should handle invalid JSON data', async () => {
				const invalidData = 'invalid-json-data{';
				const result = await serializer.deserialize(invalidData);

				expect(result.success).toBe(false);
				expect(result.error).toBeDefined();
			});

			it('should validate deserialized payload when validation is enabled', async () => {
				const serializedData = await createSerializedData();
				const result = await serializer.deserialize(serializedData, {
					validate: true
				});

				expect(result.success).toBe(true);
				// Should not have validation errors for valid data
			});
		});

		describe('Validation', () => {
			it('should validate valid payload', () => {
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
				};

				const result = serializer.validatePayload('task:created', payload);
				expect(result.valid).toBe(true);
			});

			it('should return validation errors for invalid payload', () => {
				const invalidPayload = {
					version: SCHEMA_VERSION,
					eventId: 'evt_123',
					timestamp: 'invalid-timestamp',
					context: {
						projectRoot: '/app',
						session: {},
						source: 'invalid-source'
					}
					// Missing required fields
				};

				const result = serializer.validatePayload(
					'task:created',
					invalidPayload
				);
				expect(result.valid).toBe(false);
				expect(result.errors).toBeDefined();
				expect(result.errors.length).toBeGreaterThan(0);
			});

			it('should handle unknown event types gracefully', () => {
				const payload = { some: 'data' };
				const result = serializer.validatePayload('unknown:event', payload);

				expect(result.valid).toBe(true);
				expect(result.warnings).toBeDefined();
				expect(result.warnings[0]).toContain('No schema defined');
			});
		});

		describe('Standard Payload Creation', () => {
			it('should create standardized payload', () => {
				const context = {
					projectRoot: '/app',
					session: { user: 'test_user' },
					source: 'cli',
					requestId: 'req_123'
				};

				const data = {
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
				};

				const payload = serializer.createStandardPayload(
					'task:created',
					data,
					context
				);

				expect(payload.version).toBe(SCHEMA_VERSION);
				expect(payload.eventId).toMatch(/^evt_\d+_[a-z0-9]+$/);
				expect(payload.timestamp).toBeDefined();
				expect(new Date(payload.timestamp)).toBeInstanceOf(Date);
				expect(payload.context).toEqual(context);
				expect(payload.taskId).toBe('1');
				expect(payload.task.title).toBe('Test Task');
				expect(payload.tag).toBe('master');
			});
		});

		describe('Statistics', () => {
			it('should track serialization statistics', async () => {
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
				};

				await serializer.serialize('task:created', payload);
				await serializer.serialize('task:created', payload);

				const stats = serializer.getStats();
				expect(stats.serialized).toBe(2);
				expect(stats.validationErrors).toBe(0);
			});

			it('should track validation errors', async () => {
				const invalidPayload = { invalid: 'data' };

				await serializer.serialize('task:created', invalidPayload);
				await serializer.serialize('task:created', invalidPayload);

				const stats = serializer.getStats();
				expect(stats.validationErrors).toBe(2);
			});

			it('should reset statistics', async () => {
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
				};

				await serializer.serialize('task:created', payload);

				let stats = serializer.getStats();
				expect(stats.serialized).toBe(1);

				serializer.resetStats();

				stats = serializer.getStats();
				expect(stats.serialized).toBe(0);
				expect(stats.deserialized).toBe(0);
				expect(stats.validationErrors).toBe(0);
			});
		});
	});

	describe('Global Serializer Functions', () => {
		it('should get global serializer instance', () => {
			const globalSerializer = getGlobalSerializer();
			expect(globalSerializer).toBeInstanceOf(EventPayloadSerializer);

			// Should return same instance on subsequent calls
			const sameInstance = getGlobalSerializer();
			expect(sameInstance).toBe(globalSerializer);
		});

		it('should serialize using global function', async () => {
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
			};

			const result = await serializeEventPayload('task:created', payload);
			expect(result.success).toBe(true);
		});

		it('should deserialize using global function', async () => {
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
			};

			const serializeResult = await serializeEventPayload(
				'task:created',
				payload
			);
			const deserializeResult = await deserializeEventPayload(
				serializeResult.data
			);

			expect(deserializeResult.success).toBe(true);
			expect(deserializeResult.payload.taskId).toBe('1');
		});

		it('should validate using global function', () => {
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
			};

			const result = validateEventPayload('task:created', payload);
			expect(result.valid).toBe(true);
		});

		it('should create standard payload using global function', () => {
			const context = {
				projectRoot: '/app',
				session: {},
				source: 'cli'
			};

			const data = {
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
			};

			const payload = createStandardEventPayload('task:created', data, context);

			expect(payload.version).toBe(SCHEMA_VERSION);
			expect(payload.eventId).toBeDefined();
			expect(payload.timestamp).toBeDefined();
			expect(payload.context).toEqual(context);
			expect(payload.taskId).toBe('1');
		});
	});

	describe('Data Size Calculation', () => {
		it('should calculate correct data sizes', async () => {
			const smallPayload = {
				version: SCHEMA_VERSION,
				eventId: 'evt_123',
				timestamp: '2025-06-21T16:54:12.621Z',
				context: {
					projectRoot: '/app',
					session: {},
					source: 'cli'
				},
				taskId: '1',
				task: {
					id: '1',
					title: 'Small Task',
					description: 'Small Description',
					status: 'pending',
					priority: 'medium',
					dependencies: [],
					subtasks: []
				},
				tag: 'master'
			};

			const largePayload = {
				...smallPayload,
				task: {
					...smallPayload.task,
					title: 'A'.repeat(1000),
					description: 'B'.repeat(1000),
					details: 'C'.repeat(1000)
				}
			};

			const smallResult = await serializer.serialize(
				'task:created',
				smallPayload
			);
			const largeResult = await serializer.serialize(
				'task:created',
				largePayload
			);

			expect(smallResult.metadata.size).toBeLessThan(largeResult.metadata.size);
		});
	});

	describe('Error Handling', () => {
		it('should handle serialization errors gracefully', async () => {
			// Create a payload that will cause JSON.stringify to fail
			const circularPayload = {
				version: SCHEMA_VERSION,
				eventId: 'evt_123',
				timestamp: '2025-06-21T16:54:12.621Z',
				context: {
					projectRoot: '/app',
					session: {},
					source: 'cli'
				},
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
			};

			// Create circular reference
			circularPayload.circular = circularPayload;

			const result = await serializer.serialize(
				'task:created',
				circularPayload
			);
			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
		});

		it('should handle validation exceptions', () => {
			// Test with data that causes validation to throw
			const result = serializer.validatePayload('task:created', null);
			expect(result.valid).toBe(false);
			expect(result.errors).toBeDefined();
		});
	});
});
