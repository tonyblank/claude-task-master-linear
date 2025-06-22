/**
 * @fileoverview Tests for Backward Compatibility
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
	migrateEventPayload,
	detectPayloadVersion,
	needsMigration,
	validateMigratedPayload,
	createLegacyCompatiblePayload,
	getSupportedLegacyVersions,
	getCompatibilityInfo,
	LEGACY_VERSIONS
} from '../../../scripts/modules/events/backward-compatibility.js';
import { SCHEMA_VERSION } from '../../../scripts/modules/events/payload-schemas.js';

describe('Backward Compatibility', () => {
	describe('Version Detection', () => {
		it('should detect current schema version', () => {
			const modernPayload = {
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

			const version = detectPayloadVersion(modernPayload);
			expect(version).toBe(SCHEMA_VERSION);
		});

		it('should detect pre-schema version from wrapped format', () => {
			const preSchemaPayload = {
				type: 'task:created',
				payload: {
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
					timestamp: '2025-06-21T16:54:12.621Z',
					context: {
						projectRoot: '/app',
						session: {},
						source: 'cli'
					}
				}
			};

			const version = detectPayloadVersion(preSchemaPayload);
			expect(version).toBe(LEGACY_VERSIONS['0.1.0']);
		});

		it('should detect beta schema version', () => {
			const betaPayload = {
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
				// Note: No version field indicates beta schema
			};

			const version = detectPayloadVersion(betaPayload);
			expect(version).toBe(LEGACY_VERSIONS['0.9.0']);
		});

		it('should detect version from serialization metadata', () => {
			const payloadWithMetadata = {
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
				_serialization: {
					schemaVersion: '0.9.0',
					eventType: 'task:created'
				}
			};

			const version = detectPayloadVersion(payloadWithMetadata);
			expect(version).toBe('0.9.0');
		});

		it('should default to pre-schema for unknown format', () => {
			const unknownPayload = {
				someUnknownField: 'value',
				anotherField: 123
			};

			const version = detectPayloadVersion(unknownPayload);
			expect(version).toBe(LEGACY_VERSIONS['0.1.0']);
		});

		it('should detect current version for modern-looking structure', () => {
			const modernLookingPayload = {
				timestamp: '2025-06-21T16:54:12.621Z',
				context: {
					projectRoot: '/app',
					session: {},
					source: 'cli'
				},
				taskId: '1'
			};

			const version = detectPayloadVersion(modernLookingPayload);
			expect(version).toBe(SCHEMA_VERSION);
		});
	});

	describe('Migration Necessity Check', () => {
		it('should return false for current version payloads', () => {
			const modernPayload = {
				version: SCHEMA_VERSION,
				eventId: 'evt_123',
				timestamp: '2025-06-21T16:54:12.621Z',
				context: {
					projectRoot: '/app',
					session: {},
					source: 'cli'
				}
			};

			expect(needsMigration(modernPayload)).toBe(false);
		});

		it('should return true for legacy payloads', () => {
			const legacyPayload = {
				type: 'task:created',
				payload: {
					taskId: '1',
					task: {},
					timestamp: '2025-06-21T16:54:12.621Z',
					context: {}
				}
			};

			expect(needsMigration(legacyPayload)).toBe(true);
		});

		it('should return true for beta payloads', () => {
			const betaPayload = {
				eventId: 'evt_123',
				timestamp: '2025-06-21T16:54:12.621Z',
				context: {}
				// Missing version field
			};

			expect(needsMigration(betaPayload)).toBe(true);
		});
	});

	describe('Payload Migration', () => {
		describe('Pre-schema to 1.0.0 Migration', () => {
			it('should migrate wrapped format successfully', () => {
				const preSchemaPayload = {
					type: 'task:created',
					payload: {
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
						timestamp: '2025-06-21T16:54:12.621Z',
						context: {
							projectRoot: '/app',
							session: { user: 'test_user' },
							source: 'cli'
						}
					}
				};

				const result = migrateEventPayload(preSchemaPayload);

				expect(result.success).toBe(true);
				expect(result.migrated).toBe(true);
				expect(result.payload.version).toBe(SCHEMA_VERSION);
				expect(result.payload.eventId).toBeDefined();
				expect(result.payload.timestamp).toBe('2025-06-21T16:54:12.621Z');
				expect(result.payload.context).toEqual(
					preSchemaPayload.payload.context
				);
				expect(result.payload.taskId).toBe('1');
				expect(result.payload.task).toEqual(preSchemaPayload.payload.task);
				expect(result.payload.tag).toBe('master');
			});

			it('should migrate direct format successfully', () => {
				const directFormatPayload = {
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
					timestamp: '2025-06-21T16:54:12.621Z',
					context: {
						projectRoot: '/app',
						session: {},
						source: 'cli'
					}
				};

				const result = migrateEventPayload(
					directFormatPayload,
					LEGACY_VERSIONS['0.1.0']
				);

				expect(result.success).toBe(true);
				expect(result.migrated).toBe(true);
				expect(result.payload.version).toBe(SCHEMA_VERSION);
				expect(result.payload.eventId).toBeDefined();
				expect(result.payload.taskId).toBe('1');
			});

			it('should handle different event types correctly', () => {
				const taskUpdatedPayload = {
					type: 'task:updated',
					payload: {
						taskId: '1',
						task: {
							id: '1',
							title: 'Updated Task',
							description: 'Updated Description',
							status: 'in-progress',
							priority: 'high',
							dependencies: [],
							subtasks: []
						},
						changes: { status: 'in-progress' },
						oldValues: { status: 'pending' },
						tag: 'develop',
						timestamp: '2025-06-21T16:54:12.621Z',
						context: {
							projectRoot: '/app',
							session: {},
							source: 'mcp'
						}
					}
				};

				const result = migrateEventPayload(taskUpdatedPayload);

				expect(result.success).toBe(true);
				expect(result.payload.taskId).toBe('1');
				expect(result.payload.task.title).toBe('Updated Task');
				expect(result.payload.changes).toEqual({ status: 'in-progress' });
				expect(result.payload.oldValues).toEqual({ status: 'pending' });
				expect(result.payload.tag).toBe('develop');
			});

			it('should handle status changed events', () => {
				const statusChangedPayload = {
					type: 'task:status:changed',
					payload: {
						taskId: '1',
						task: {
							id: '1',
							title: 'Task',
							description: 'Description',
							status: 'done',
							priority: 'medium',
							dependencies: [],
							subtasks: []
						},
						oldStatus: 'in-progress',
						newStatus: 'done',
						tag: 'master',
						timestamp: '2025-06-21T16:54:12.621Z',
						context: {
							projectRoot: '/app',
							session: {},
							source: 'api'
						}
					}
				};

				const result = migrateEventPayload(statusChangedPayload);

				expect(result.success).toBe(true);
				expect(result.payload.oldStatus).toBe('in-progress');
				expect(result.payload.newStatus).toBe('done');
			});

			it('should create legacy context when missing', () => {
				const payloadWithoutContext = {
					type: 'task:created',
					payload: {
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
						timestamp: '2025-06-21T16:54:12.621Z'
						// No context field
					}
				};

				const result = migrateEventPayload(payloadWithoutContext);

				expect(result.success).toBe(true);
				expect(result.payload.context).toBeDefined();
				expect(result.payload.context.source).toBe('legacy');
				expect(result.payload.context.projectRoot).toBeDefined();
				expect(result.payload.context.requestId).toContain('legacy_');
			});
		});

		describe('Beta schema to 1.0.0 Migration', () => {
			it('should migrate beta payload successfully', () => {
				const betaPayload = {
					eventId: 'evt_beta_123',
					timestamp: '2025-06-21T16:54:12.621Z',
					context: {
						projectRoot: '/app',
						session: { user: 'beta_user' },
						source: 'cli'
					},
					taskId: '1',
					task: {
						id: '1',
						title: 'Beta Task',
						description: 'Beta Description',
						status: 'pending',
						priority: 'medium',
						dependencies: [],
						subtasks: []
					},
					tag: 'beta',
					metadata: { betaFeature: true }
				};

				const result = migrateEventPayload(
					betaPayload,
					LEGACY_VERSIONS['0.9.0']
				);

				expect(result.success).toBe(true);
				expect(result.migrated).toBe(true);
				expect(result.payload.version).toBe(SCHEMA_VERSION);
				expect(result.payload.eventId).toBe('evt_beta_123');
				expect(result.payload.metadata).toEqual({ betaFeature: true });
			});

			it('should add missing eventId for beta payloads', () => {
				const betaPayloadWithoutEventId = {
					timestamp: '2025-06-21T16:54:12.621Z',
					context: {
						projectRoot: '/app',
						session: {},
						source: 'cli'
					},
					taskId: '1',
					task: {
						id: '1',
						title: 'Beta Task',
						description: 'Beta Description',
						status: 'pending',
						priority: 'medium',
						dependencies: [],
						subtasks: []
					},
					tag: 'beta'
				};

				const result = migrateEventPayload(
					betaPayloadWithoutEventId,
					LEGACY_VERSIONS['0.9.0']
				);

				expect(result.success).toBe(true);
				expect(result.payload.eventId).toBeDefined();
				expect(result.payload.eventId).toMatch(/^evt_\d+_[a-z0-9]+$/);
			});
		});

		it('should not migrate current version payloads', () => {
			const currentPayload = {
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
					title: 'Current Task',
					description: 'Current Description',
					status: 'pending',
					priority: 'medium',
					dependencies: [],
					subtasks: []
				},
				tag: 'master'
			};

			const result = migrateEventPayload(currentPayload);

			expect(result.success).toBe(true);
			expect(result.migrated).toBe(false);
			expect(result.message).toContain('No migration needed');
		});

		it('should handle migration errors gracefully', () => {
			// Create a payload that will cause migration to fail
			const problematicPayload = null; // This will cause the migration to fail

			const result = migrateEventPayload(problematicPayload);

			expect(result.success).toBe(false);
			expect(result.migrated).toBe(false);
			expect(result.error).toBeDefined();
		});
	});

	describe('Migrated Payload Validation', () => {
		it('should validate successfully migrated payload', () => {
			const migratedPayload = {
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
					title: 'Migrated Task',
					description: 'Migrated Description',
					status: 'pending',
					priority: 'medium',
					dependencies: [],
					subtasks: []
				},
				tag: 'master'
			};

			const result = validateMigratedPayload('task:created', migratedPayload);
			expect(result.valid).toBe(true);
		});

		it('should detect validation errors in migrated payload', () => {
			const invalidMigratedPayload = {
				version: SCHEMA_VERSION,
				eventId: 'evt_123',
				timestamp: 'invalid-timestamp',
				context: {
					projectRoot: '/app',
					session: {},
					source: 'invalid-source'
				},
				taskId: '1'
				// Missing required fields
			};

			const result = validateMigratedPayload(
				'task:created',
				invalidMigratedPayload
			);
			expect(result.valid).toBe(false);
			expect(result.errors).toBeDefined();
			expect(result.errors.length).toBeGreaterThan(0);
		});

		it('should handle unknown event types gracefully', () => {
			const payload = { some: 'data' };
			const result = validateMigratedPayload('unknown:event', payload);

			expect(result.valid).toBe(true);
			expect(result.warnings).toBeDefined();
		});
	});

	describe('Legacy Compatible Payload Creation', () => {
		const modernPayload = {
			version: SCHEMA_VERSION,
			eventId: 'evt_modern_123',
			timestamp: '2025-06-21T16:54:12.621Z',
			context: {
				projectRoot: '/app',
				session: { user: 'modern_user' },
				source: 'cli'
			},
			taskId: '1',
			task: {
				id: '1',
				title: 'Modern Task',
				description: 'Modern Description',
				status: 'pending',
				priority: 'medium',
				dependencies: [],
				subtasks: []
			},
			tag: 'master',
			metadata: { modernFeature: true }
		};

		it('should create pre-schema compatible payload', () => {
			const legacyPayload = createLegacyCompatiblePayload(
				modernPayload,
				LEGACY_VERSIONS['0.1.0']
			);

			expect(legacyPayload.type).toBe('task:created');
			expect(legacyPayload.payload).toBeDefined();
			expect(legacyPayload.payload.taskId).toBe('1');
			expect(legacyPayload.payload.task).toEqual(modernPayload.task);
			expect(legacyPayload.payload.tag).toBe('master');
			expect(legacyPayload.payload.timestamp).toBe(modernPayload.timestamp);
			expect(legacyPayload.payload.context).toEqual(modernPayload.context);

			// Should not have modern fields in wrapped format
			expect(legacyPayload.payload.version).toBeUndefined();
			expect(legacyPayload.payload.eventId).toBeUndefined();
		});

		it('should create beta schema compatible payload', () => {
			const betaPayload = createLegacyCompatiblePayload(
				modernPayload,
				LEGACY_VERSIONS['0.9.0']
			);

			expect(betaPayload.version).toBeUndefined(); // Beta didn't have version field
			expect(betaPayload.eventId).toBe('evt_modern_123');
			expect(betaPayload.timestamp).toBe(modernPayload.timestamp);
			expect(betaPayload.taskId).toBe('1');
			expect(betaPayload.metadata).toEqual({ modernFeature: true });
		});

		it('should return original payload for unknown target version', () => {
			const result = createLegacyCompatiblePayload(
				modernPayload,
				'unknown-version'
			);
			expect(result).toEqual(modernPayload);
		});

		it('should handle different event types in legacy format', () => {
			const statusChangedPayload = {
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
					title: 'Task',
					description: 'Description',
					status: 'done',
					priority: 'medium',
					dependencies: [],
					subtasks: []
				},
				oldStatus: 'in-progress',
				newStatus: 'done',
				tag: 'master'
			};

			const legacyPayload = createLegacyCompatiblePayload(
				statusChangedPayload,
				LEGACY_VERSIONS['0.1.0']
			);

			expect(legacyPayload.type).toBe('task:status:changed');
			expect(legacyPayload.payload.oldStatus).toBe('in-progress');
			expect(legacyPayload.payload.newStatus).toBe('done');
		});

		it('should detect subtask events correctly', () => {
			const subtaskPayload = {
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
				subtask: {
					id: '1',
					title: 'Subtask',
					description: 'Subtask Description',
					status: 'pending',
					dependencies: []
				},
				parentTask: {
					id: '5',
					title: 'Parent Task',
					description: 'Parent Description',
					status: 'in-progress',
					priority: 'medium',
					dependencies: [],
					subtasks: []
				},
				tag: 'master'
			};

			const legacyPayload = createLegacyCompatiblePayload(
				subtaskPayload,
				LEGACY_VERSIONS['0.1.0']
			);

			expect(legacyPayload.type).toBe('subtask:created');
		});
	});

	describe('Legacy Version Support', () => {
		it('should return supported legacy versions', () => {
			const versions = getSupportedLegacyVersions();

			expect(versions).toEqual(LEGACY_VERSIONS);
			expect(versions['0.1.0']).toBe('pre-schema');
			expect(versions['0.9.0']).toBe('beta-schema');
		});

		it('should return compatibility information', () => {
			const info = getCompatibilityInfo();

			expect(info.currentVersion).toBe(SCHEMA_VERSION);
			expect(info.supportedLegacyVersions).toContain('pre-schema');
			expect(info.supportedLegacyVersions).toContain('beta-schema');
			expect(info.migrationStrategies).toBeDefined();
			expect(info.backwardCompatible).toBe(true);
			expect(info.forwardCompatible).toBe(false);
		});
	});

	describe('Event Type Extraction', () => {
		it('should extract task created event type', () => {
			const payload = {
				taskId: '1',
				task: { title: 'Test' }
			};

			const legacyPayload = createLegacyCompatiblePayload(
				payload,
				LEGACY_VERSIONS['0.1.0']
			);
			expect(legacyPayload.type).toBe('task:created');
		});

		it('should extract task updated event type', () => {
			const payload = {
				taskId: '1',
				task: { title: 'Test' },
				changes: { title: 'Updated' }
			};

			const legacyPayload = createLegacyCompatiblePayload(
				payload,
				LEGACY_VERSIONS['0.1.0']
			);
			expect(legacyPayload.type).toBe('task:updated');
		});

		it('should extract task status changed event type', () => {
			const payload = {
				taskId: '1',
				task: { title: 'Test' },
				oldStatus: 'pending',
				newStatus: 'done'
			};

			const legacyPayload = createLegacyCompatiblePayload(
				payload,
				LEGACY_VERSIONS['0.1.0']
			);
			expect(legacyPayload.type).toBe('task:status:changed');
		});

		it('should default to unknown event for unrecognized payloads', () => {
			const payload = {
				unknownField: 'value'
			};

			const legacyPayload = createLegacyCompatiblePayload(
				payload,
				LEGACY_VERSIONS['0.1.0']
			);
			expect(legacyPayload.type).toBe('unknown:event');
		});
	});

	describe('Edge Cases', () => {
		it('should handle empty payloads', () => {
			const result = migrateEventPayload({});

			expect(result.success).toBe(true);
			expect(result.payload.version).toBe(SCHEMA_VERSION);
			expect(result.payload.eventId).toBeDefined();
		});

		it('should handle null payload', () => {
			const result = migrateEventPayload(null);

			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
		});

		it('should handle malformed timestamps in legacy payloads', () => {
			const legacyPayload = {
				type: 'task:created',
				payload: {
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
					tag: 'master',
					timestamp: 'invalid-timestamp',
					context: {
						projectRoot: '/app',
						session: {},
						source: 'cli'
					}
				}
			};

			const result = migrateEventPayload(legacyPayload);

			expect(result.success).toBe(true);
			// Should still generate a valid timestamp
			expect(result.payload.timestamp).toBeDefined();
			expect(new Date(result.payload.timestamp)).toBeInstanceOf(Date);
		});
	});
});
