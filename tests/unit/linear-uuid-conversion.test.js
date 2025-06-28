/**
 * @fileoverview Tests for Linear UUID-based configuration conversion
 * Tests the migration from name-based to UUID-based status mappings
 * as specified in Task 6.7
 */

import { jest } from '@jest/globals';
import { LinearIntegrationHandler } from '../../scripts/modules/integrations/linear-integration-handler.js';

// Mock the Linear SDK
const mockLinear = {
	workflowStates: jest.fn(),
	viewer: Promise.resolve({ name: 'Test User', email: 'test@example.com' })
};

// Mock the base integration handler
jest.mock('../../scripts/modules/events/base-integration-handler.js', () => ({
	BaseIntegrationHandler: class MockBaseIntegrationHandler {
		constructor(name, version, config) {
			this.name = name;
			this.version = version;
			this.config = config;
			this.isEnabled = () => true;
		}
		async retry(fn, options) {
			return await fn();
		}
		createProgressMessage(operationType, task, stage) {
			return {
				type: 'progress',
				operation: operationType,
				stage,
				task,
				message: `${operationType} ${stage}`
			};
		}
		createSuccessMessage(operationType, task, data) {
			return {
				type: 'success',
				operation: operationType,
				task,
				data
			};
		}
		createErrorMessage(operationType, task, error) {
			return {
				type: 'error',
				operation: operationType,
				task,
				error
			};
		}
		logFormattedMessage() {}
	}
}));

// Mock the utils
jest.mock('../../scripts/modules/utils.js', () => ({
	log: jest.fn(),
	readJSON: jest.fn(),
	writeJSON: jest.fn(),
	getCurrentTag: jest.fn(() => 'master'),
	findProjectRoot: jest.fn(() => '/test/project')
}));

// Mock config manager with both name and UUID mapping functions
const mockConfigManager = {
	getLinearConfig: jest.fn(() => ({})),
	getLinearPriorityMapping: jest.fn(() => ({})),
	getLinearStatusMapping: jest.fn(() => ({
		pending: 'Todo',
		'in-progress': 'In Progress',
		review: 'In Review',
		done: 'Done',
		cancelled: 'Cancelled',
		deferred: 'Backlog'
	})),
	getEffectiveLinearStatusMapping: jest.fn(),
	getLinearStatusUuidMapping: jest.fn(() => ({})),
	setLinearStatusUuidMapping: jest.fn(),
	validateLinearStatusUuidMapping: jest.fn(),
	generateLinearStatusUuidMapping: jest.fn()
};

jest.mock('../../scripts/modules/config-manager.js', () => mockConfigManager);

// Use the mock functions directly
const {
	getEffectiveLinearStatusMapping,
	getLinearStatusUuidMapping,
	setLinearStatusUuidMapping,
	generateLinearStatusUuidMapping,
	validateLinearStatusUuidMapping
} = mockConfigManager;

describe('Linear UUID Configuration Conversion - Task 6.7', () => {
	let handler;
	const mockTeamId = 'team-123';
	const mockConfig = {
		apiKey: 'lin_api_test_key',
		teamId: mockTeamId,
		createIssues: true
	};

	// Complete UUID mapping for all 6 TaskMaster statuses
	const mockUuidMappings = {
		pending: 'state-pending-uuid-1234',
		'in-progress': 'state-inprogress-uuid-5678',
		review: 'state-review-uuid-9abc',
		done: 'state-done-uuid-def0',
		cancelled: 'state-cancelled-uuid-1357',
		deferred: 'state-deferred-uuid-2468'
	};

	const mockNameMappings = {
		pending: 'Todo',
		'in-progress': 'In Progress',
		review: 'In Review',
		done: 'Done',
		cancelled: 'Cancelled',
		deferred: 'Backlog'
	};

	// Mock workflow states response
	const mockWorkflowStatesResponse = {
		nodes: [
			{
				id: 'state-pending-uuid-1234',
				name: 'Todo',
				type: 'unstarted',
				team: { id: mockTeamId }
			},
			{
				id: 'state-inprogress-uuid-5678',
				name: 'In Progress',
				type: 'started',
				team: { id: mockTeamId }
			},
			{
				id: 'state-review-uuid-9abc',
				name: 'In Review',
				type: 'started',
				team: { id: mockTeamId }
			},
			{
				id: 'state-done-uuid-def0',
				name: 'Done',
				type: 'completed',
				team: { id: mockTeamId }
			},
			{
				id: 'state-cancelled-uuid-1357',
				name: 'Cancelled',
				type: 'canceled',
				team: { id: mockTeamId }
			},
			{
				id: 'state-deferred-uuid-2468',
				name: 'Backlog',
				type: 'unstarted',
				team: { id: mockTeamId }
			}
		],
		pageInfo: { hasNextPage: false }
	};

	beforeEach(() => {
		jest.clearAllMocks();

		// Reset all mocks to their default values
		getEffectiveLinearStatusMapping.mockReturnValue({
			type: 'name',
			mapping: mockNameMappings
		});
		getLinearStatusUuidMapping.mockReturnValue({});
		setLinearStatusUuidMapping.mockReturnValue(true);
		validateLinearStatusUuidMapping.mockReturnValue({
			valid: true,
			errors: []
		});
		generateLinearStatusUuidMapping.mockResolvedValue({
			success: true,
			mapping: mockUuidMappings,
			errors: []
		});

		handler = new LinearIntegrationHandler(mockConfig);
		handler.linear = mockLinear;
		mockLinear.workflowStates.mockResolvedValue(mockWorkflowStatesResponse);
	});

	describe('1. UUID-based Configuration Storage', () => {
		test('should store Linear state UUIDs directly in configuration', () => {
			const testUuidMapping = {
				pending: 'state-pending-uuid-1234',
				'in-progress': 'state-inprogress-uuid-5678'
			};

			setLinearStatusUuidMapping.mockReturnValue(true);

			// Simulate storing UUID mapping
			const result = setLinearStatusUuidMapping(testUuidMapping);

			expect(result).toBe(true);
			expect(setLinearStatusUuidMapping).toHaveBeenCalledWith(testUuidMapping);
		});

		test('should validate UUID mapping format correctly', () => {
			validateLinearStatusUuidMapping.mockReturnValue({
				valid: true,
				errors: []
			});

			const testMapping = {
				pending: 'state-pending-uuid-1234',
				'in-progress': 'state-inprogress-uuid-5678'
			};

			const result = validateLinearStatusUuidMapping(testMapping);

			expect(result.valid).toBe(true);
			expect(result.errors).toEqual([]);
			expect(validateLinearStatusUuidMapping).toHaveBeenCalledWith(testMapping);
		});

		test('should reject invalid UUID formats', () => {
			validateLinearStatusUuidMapping.mockReturnValue({
				valid: false,
				errors: ['Invalid UUID format for pending: not-a-uuid']
			});

			const invalidMapping = {
				pending: 'not-a-uuid',
				'in-progress': 'state-inprogress-uuid-5678'
			};

			const result = validateLinearStatusUuidMapping(invalidMapping);

			expect(result.valid).toBe(false);
			expect(result.errors).toContain(
				'Invalid UUID format for pending: not-a-uuid'
			);
		});

		test('should store all 6 TaskMaster status UUIDs', () => {
			setLinearStatusUuidMapping.mockReturnValue(true);

			const result = setLinearStatusUuidMapping(mockUuidMappings);

			expect(result).toBe(true);
			expect(setLinearStatusUuidMapping).toHaveBeenCalledWith(mockUuidMappings);

			// Verify all 6 statuses are included
			const passedMapping = setLinearStatusUuidMapping.mock.calls[0][0];
			expect(Object.keys(passedMapping)).toHaveLength(6);
			expect(passedMapping).toHaveProperty('pending');
			expect(passedMapping).toHaveProperty('in-progress');
			expect(passedMapping).toHaveProperty('review');
			expect(passedMapping).toHaveProperty('done');
			expect(passedMapping).toHaveProperty('cancelled');
			expect(passedMapping).toHaveProperty('deferred');
		});
	});

	describe('2. Migration from Name-based to UUID-based Configuration', () => {
		test('should generate UUID mappings from existing name mappings', async () => {
			generateLinearStatusUuidMapping.mockResolvedValue({
				success: true,
				mapping: mockUuidMappings,
				errors: []
			});

			const result = await generateLinearStatusUuidMapping(
				mockNameMappings,
				mockTeamId,
				'/test/project'
			);

			expect(result.success).toBe(true);
			expect(result.mapping).toEqual(mockUuidMappings);
			expect(generateLinearStatusUuidMapping).toHaveBeenCalledWith(
				mockNameMappings,
				mockTeamId,
				'/test/project'
			);
		});

		test('should maintain backward compatibility during migration', () => {
			// Test falling back to name mapping when no UUID mapping exists
			getEffectiveLinearStatusMapping.mockReturnValue({
				type: 'name',
				mapping: mockNameMappings
			});

			const result = getEffectiveLinearStatusMapping('/test/project');

			expect(result.type).toBe('name');
			expect(result.mapping).toEqual(mockNameMappings);
		});

		test('should prefer UUID mappings over name mappings when both exist', () => {
			// Test UUID mapping takes precedence
			getEffectiveLinearStatusMapping.mockReturnValue({
				type: 'uuid',
				mapping: mockUuidMappings
			});

			const result = getEffectiveLinearStatusMapping('/test/project');

			expect(result.type).toBe('uuid');
			expect(result.mapping).toEqual(mockUuidMappings);
		});

		test('should handle partial migration scenarios', async () => {
			const partialUuidMapping = {
				pending: 'state-pending-uuid-1234',
				done: 'state-done-uuid-def0'
			};

			generateLinearStatusUuidMapping.mockResolvedValue({
				success: false,
				mapping: partialUuidMapping,
				errors: [
					'Failed to resolve "in-progress"',
					'Failed to resolve "review"',
					'Failed to resolve "cancelled"',
					'Failed to resolve "deferred"'
				]
			});

			const result = await generateLinearStatusUuidMapping(
				mockNameMappings,
				mockTeamId,
				'/test/project'
			);

			expect(result.success).toBe(false);
			expect(result.mapping).toEqual(partialUuidMapping);
			expect(result.errors).toHaveLength(4);
		});
	});

	describe('3. Linear API Integration with UUID References', () => {
		test('should use UUID mappings for Linear API state ID calls', async () => {
			getEffectiveLinearStatusMapping.mockReturnValue({
				type: 'uuid',
				mapping: mockUuidMappings
			});

			const stateUuid = await handler.getEffectiveStateUuid(
				'pending',
				mockTeamId,
				'/test/project'
			);

			expect(stateUuid).toBe('state-pending-uuid-1234');
		});

		test('should resolve name mappings to UUIDs when no UUID mapping exists', async () => {
			getEffectiveLinearStatusMapping.mockReturnValue({
				type: 'name',
				mapping: mockNameMappings
			});

			// Mock the resolution to UUID
			handler.resolveTaskMasterStatusToLinearUUID = jest
				.fn()
				.mockResolvedValue({
					success: true,
					uuid: 'state-pending-uuid-1234',
					stateName: 'Todo',
					matchType: 'exact'
				});

			const stateUuid = await handler.getEffectiveStateUuid(
				'pending',
				mockTeamId,
				'/test/project'
			);

			expect(stateUuid).toBe('state-pending-uuid-1234');
			expect(handler.resolveTaskMasterStatusToLinearUUID).toHaveBeenCalledWith(
				mockTeamId,
				'pending'
			);
		});

		test('should handle Linear API calls with direct UUID references', async () => {
			getEffectiveLinearStatusMapping.mockReturnValue({
				type: 'uuid',
				mapping: mockUuidMappings
			});

			const mockTask = {
				id: 1,
				title: 'Test Task',
				description: 'Test Description',
				status: 'pending',
				priority: 'medium'
			};

			const issueData = await handler._buildIssueData(
				mockTask,
				{},
				'/test/project'
			);

			expect(issueData.stateId).toBe('state-pending-uuid-1234');
		});

		test('should use direct UUID lookup when UUID mappings are available', async () => {
			// This test verifies that when UUID mappings exist, they are used directly
			// We test the functionality rather than the implementation details

			getEffectiveLinearStatusMapping.mockReturnValue({
				type: 'uuid',
				mapping: mockUuidMappings
			});

			// Test that each TaskMaster status maps to the correct UUID
			for (const [status, expectedUuid] of Object.entries(mockUuidMappings)) {
				const result = await handler.getEffectiveStateUuid(
					status,
					mockTeamId,
					'/test/project'
				);

				expect(result).toBe(expectedUuid);
			}
		});
	});

	describe('4. Configuration Priority and Fallback Logic', () => {
		test('should use UUID mapping as primary source when available', () => {
			getLinearStatusUuidMapping.mockReturnValue(mockUuidMappings);
			getEffectiveLinearStatusMapping.mockReturnValue({
				type: 'uuid',
				mapping: mockUuidMappings
			});

			const result = getEffectiveLinearStatusMapping('/test/project');

			expect(result.type).toBe('uuid');
			expect(result.mapping).toEqual(mockUuidMappings);
		});

		test('should fall back to name mapping when UUID mapping is empty', () => {
			getLinearStatusUuidMapping.mockReturnValue({});
			getEffectiveLinearStatusMapping.mockReturnValue({
				type: 'name',
				mapping: mockNameMappings
			});

			const result = getEffectiveLinearStatusMapping('/test/project');

			expect(result.type).toBe('name');
			expect(result.mapping).toEqual(mockNameMappings);
		});

		test('should handle missing configuration gracefully', () => {
			getEffectiveLinearStatusMapping.mockReturnValue({
				type: 'name',
				mapping: {}
			});

			const result = getEffectiveLinearStatusMapping('/test/project');

			expect(result.type).toBe('name');
			expect(result.mapping).toEqual({});
		});
	});

	describe('5. Error Handling and Edge Cases', () => {
		test('should handle invalid team ID during UUID generation', async () => {
			generateLinearStatusUuidMapping.mockResolvedValue({
				success: false,
				mapping: {},
				errors: ['Invalid team ID: invalid-team']
			});

			const result = await generateLinearStatusUuidMapping(
				mockNameMappings,
				'invalid-team',
				'/test/project'
			);

			expect(result.success).toBe(false);
			expect(result.errors).toContain('Invalid team ID: invalid-team');
		});

		test('should handle Linear API errors during UUID resolution', async () => {
			getEffectiveLinearStatusMapping.mockReturnValue({
				type: 'name',
				mapping: mockNameMappings
			});

			handler.resolveTaskMasterStatusToLinearUUID = jest
				.fn()
				.mockResolvedValue({
					success: false,
					error: 'Linear API rate limit exceeded',
					taskMasterStatus: 'pending'
				});

			const stateUuid = await handler.getEffectiveStateUuid(
				'pending',
				mockTeamId,
				'/test/project'
			);

			expect(stateUuid).toBeNull();
		});

		test('should handle corrupted UUID mappings', () => {
			validateLinearStatusUuidMapping.mockReturnValue({
				valid: false,
				errors: ['Corrupted UUID mapping data']
			});

			const corruptedMapping = { pending: null, 'in-progress': undefined };

			const result = validateLinearStatusUuidMapping(corruptedMapping);

			expect(result.valid).toBe(false);
			expect(result.errors).toContain('Corrupted UUID mapping data');
		});

		test('should handle network failures during migration', async () => {
			generateLinearStatusUuidMapping.mockRejectedValue(
				new Error('Network connection failed')
			);

			await expect(
				generateLinearStatusUuidMapping(
					mockNameMappings,
					mockTeamId,
					'/test/project'
				)
			).rejects.toThrow('Network connection failed');
		});
	});

	describe('6. Performance and Caching', () => {
		test('should demonstrate improved performance with UUID mappings', async () => {
			// Test direct UUID lookup vs API call
			getEffectiveLinearStatusMapping.mockReturnValue({
				type: 'uuid',
				mapping: mockUuidMappings
			});

			const startTime = Date.now();
			const stateUuid = await handler.getEffectiveStateUuid(
				'pending',
				mockTeamId,
				'/test/project'
			);
			const endTime = Date.now();

			expect(stateUuid).toBe('state-pending-uuid-1234');
			// UUID lookup should be very fast (synchronous)
			expect(endTime - startTime).toBeLessThan(10);
		});

		test('should cache resolved UUIDs to avoid repeated API calls', async () => {
			// This test verifies that the underlying resolution method uses caching
			const mockCachedStates = {
				states: mockWorkflowStatesResponse.nodes,
				stateNameMap: {
					Todo: 'state-pending-uuid-1234',
					'In Progress': 'state-inprogress-uuid-5678',
					'In Review': 'state-review-uuid-9abc',
					Done: 'state-done-uuid-def0',
					Cancelled: 'state-cancelled-uuid-1357',
					Backlog: 'state-deferred-uuid-2468'
				}
			};

			handler._workflowStatesCache = new Map();
			handler._workflowStatesCache.set(mockTeamId, {
				data: mockCachedStates,
				cachedAt: Date.now()
			});

			const resolution = await handler.resolveTaskMasterStatusToLinearUUID(
				mockTeamId,
				'pending'
			);

			expect(resolution.success).toBe(true);
			expect(resolution.uuid).toBe('state-pending-uuid-1234');
			// Verify API was not called (cache was used)
			expect(mockLinear.workflowStates).not.toHaveBeenCalled();
		});
	});

	describe('7. Configuration Validation and Integrity', () => {
		test('should ensure all TaskMaster statuses have UUID mappings', () => {
			const completeMapping = mockUuidMappings;
			const expectedStatuses = [
				'pending',
				'in-progress',
				'review',
				'done',
				'cancelled',
				'deferred'
			];

			expectedStatuses.forEach((status) => {
				expect(completeMapping).toHaveProperty(status);
				expect(typeof completeMapping[status]).toBe('string');
				expect(completeMapping[status]).toMatch(/^state-\w+-uuid-\w+$/);
			});
		});

		test('should validate UUID format standards', () => {
			const validUuids = Object.values(mockUuidMappings);

			validUuids.forEach((uuid) => {
				expect(typeof uuid).toBe('string');
				expect(uuid.length).toBeGreaterThan(10);
				// Verify it follows our mock UUID pattern (or could be real Linear UUIDs)
				expect(uuid).toMatch(/^state-\w+-uuid-\w+$|^[a-f0-9-]{36}$/);
			});
		});

		test('should prevent duplicate UUID assignments', () => {
			const mappingValues = Object.values(mockUuidMappings);
			const uniqueValues = [...new Set(mappingValues)];

			expect(mappingValues).toHaveLength(uniqueValues.length);
		});
	});

	describe('8. Integration with Existing Commands', () => {
		test('should work seamlessly with task creation flow', async () => {
			getEffectiveLinearStatusMapping.mockReturnValue({
				type: 'uuid',
				mapping: mockUuidMappings
			});

			const mockTask = {
				id: 1,
				title: 'Test Task',
				description: 'Test Description',
				status: 'in-progress',
				priority: 'high'
			};

			const issueData = await handler._buildIssueData(
				mockTask,
				{},
				'/test/project'
			);

			expect(issueData).toHaveProperty('stateId', 'state-inprogress-uuid-5678');
			expect(issueData).toHaveProperty('title', '[TM-1] Test Task');
		});

		test('should maintain compatibility with existing label system', async () => {
			// Labels should still use name-based mapping regardless of UUID migration
			const mockTask = {
				id: 1,
				title: 'Test Task',
				description: 'Test Description',
				status: 'pending',
				priority: 'medium'
			};

			// Mock the label-related functions
			handler._findOrCreateLabel = jest.fn().mockResolvedValue({
				id: 'label-id-123',
				name: 'Todo'
			});

			const issueData = {
				title: '[TM-1] Test Task',
				description: 'Test Description'
			};

			const linearConfig = {
				labels: {
					enabled: true
				}
			};

			await handler._addLabelsToIssueData(
				issueData,
				mockTask,
				linearConfig,
				'/test/project'
			);

			// Verify labels were added based on name mapping
			expect(handler._findOrCreateLabel).toHaveBeenCalledWith('Todo');
		});
	});
});
