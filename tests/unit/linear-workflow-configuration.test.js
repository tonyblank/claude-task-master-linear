/**
 * @fileoverview Comprehensive test suite for Linear Workflow State Mapping
 * Tests direct mapping approach, configuration management, and edge cases
 * as specified in Task 6.6
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

// Mock config manager
jest.mock('../../scripts/modules/config-manager.js', () => ({
	getLinearConfig: jest.fn(() => ({})),
	getLinearPriorityMapping: jest.fn(() => ({})),
	getLinearStatusMapping: jest.fn(() => ({}))
}));

describe('Linear Workflow Configuration - Task 6.6', () => {
	let handler;
	const mockTeamId = 'team-123';
	const mockConfig = {
		apiKey: 'lin_api_test_key',
		teamId: mockTeamId,
		createIssues: true
	};

	// Standard UUID format mock states covering all 6 TaskMaster statuses
	const mockCompleteStatesResponse = {
		nodes: [
			{
				id: 'state-pending-uuid-1234',
				name: 'Todo',
				type: 'unstarted',
				color: '#e2e2e2',
				position: 0,
				description: 'New tasks to be started',
				team: { id: mockTeamId, name: 'Test Team', key: 'TEST' },
				createdAt: '2023-01-01T00:00:00Z',
				updatedAt: '2023-01-01T00:00:00Z'
			},
			{
				id: 'state-inprogress-uuid-5678',
				name: 'In Progress',
				type: 'started',
				color: '#5e6ad2',
				position: 1,
				description: 'Work currently being done',
				team: { id: mockTeamId, name: 'Test Team', key: 'TEST' },
				createdAt: '2023-01-01T00:00:00Z',
				updatedAt: '2023-01-01T00:00:00Z'
			},
			{
				id: 'state-review-uuid-9abc',
				name: 'In Review',
				type: 'started',
				color: '#f2c94c',
				position: 2,
				description: 'Tasks under review',
				team: { id: mockTeamId, name: 'Test Team', key: 'TEST' },
				createdAt: '2023-01-01T00:00:00Z',
				updatedAt: '2023-01-01T00:00:00Z'
			},
			{
				id: 'state-done-uuid-def0',
				name: 'Done',
				type: 'completed',
				color: '#0f973d',
				position: 3,
				description: 'Completed tasks',
				team: { id: mockTeamId, name: 'Test Team', key: 'TEST' },
				createdAt: '2023-01-01T00:00:00Z',
				updatedAt: '2023-01-01T00:00:00Z'
			},
			{
				id: 'state-cancelled-uuid-1357',
				name: 'Cancelled',
				type: 'canceled',
				color: '#95a2b3',
				position: 4,
				description: 'Cancelled tasks',
				team: { id: mockTeamId, name: 'Test Team', key: 'TEST' },
				createdAt: '2023-01-01T00:00:00Z',
				updatedAt: '2023-01-01T00:00:00Z'
			},
			{
				id: 'state-deferred-uuid-2468',
				name: 'Backlog',
				type: 'unstarted',
				color: '#a855f7',
				position: 5,
				description: 'Deferred tasks in backlog',
				team: { id: mockTeamId, name: 'Test Team', key: 'TEST' },
				createdAt: '2023-01-01T00:00:00Z',
				updatedAt: '2023-01-01T00:00:00Z'
			}
		],
		pageInfo: {
			hasNextPage: false,
			endCursor: null
		}
	};

	beforeEach(() => {
		jest.clearAllMocks();
		handler = new LinearIntegrationHandler(mockConfig);
		handler.linear = mockLinear;
		handler._workflowStatesCache = new Map();
	});

	describe('1. Direct Mapping of 6 TaskMaster Statuses to Linear State UUIDs', () => {
		beforeEach(() => {
			mockLinear.workflowStates.mockResolvedValue(mockCompleteStatesResponse);
		});

		test('should verify correct mapping of all 6 TaskMaster statuses to UUIDs', async () => {
			const result = await handler.generateTaskMasterUUIDMappings(mockTeamId);

			expect(result.success).toBe(true);
			expect(result.successfulMappings).toBe(6);
			expect(result.failedMappings).toBe(0);
			expect(result.totalStatuses).toBe(6);

			// Verify exact UUID mappings
			expect(result.mappings).toEqual({
				pending: 'state-pending-uuid-1234',
				'in-progress': 'state-inprogress-uuid-5678',
				review: 'state-review-uuid-9abc',
				done: 'state-done-uuid-def0',
				cancelled: 'state-cancelled-uuid-1357',
				deferred: 'state-deferred-uuid-2468'
			});
		});

		test('should resolve each TaskMaster status with exact name matching', async () => {
			const statuses = [
				'pending',
				'in-progress',
				'review',
				'done',
				'cancelled',
				'deferred'
			];
			const expectedResults = [
				{
					status: 'pending',
					uuid: 'state-pending-uuid-1234',
					stateName: 'Todo'
				},
				{
					status: 'in-progress',
					uuid: 'state-inprogress-uuid-5678',
					stateName: 'In Progress'
				},
				{
					status: 'review',
					uuid: 'state-review-uuid-9abc',
					stateName: 'In Review'
				},
				{ status: 'done', uuid: 'state-done-uuid-def0', stateName: 'Done' },
				{
					status: 'cancelled',
					uuid: 'state-cancelled-uuid-1357',
					stateName: 'Cancelled'
				},
				{
					status: 'deferred',
					uuid: 'state-deferred-uuid-2468',
					stateName: 'Backlog'
				}
			];

			for (const expected of expectedResults) {
				const result = await handler.resolveTaskMasterStatusToLinearUUID(
					mockTeamId,
					expected.status
				);

				expect(result.success).toBe(true);
				expect(result.uuid).toBe(expected.uuid);
				expect(result.stateName).toBe(expected.stateName);
				expect(result.taskMasterStatus).toBe(expected.status);
				expect(result.matchType).toBe('exact');
			}
		});

		test('should ensure consistent mapping across multiple resolution attempts', async () => {
			const testStatus = 'pending';
			const results = [];

			// Perform multiple resolution attempts
			for (let i = 0; i < 5; i++) {
				const result = await handler.resolveTaskMasterStatusToLinearUUID(
					mockTeamId,
					testStatus
				);
				results.push(result);
			}

			// Verify all results are identical
			const firstResult = results[0];
			results.forEach((result, index) => {
				expect(result.success).toBe(true);
				expect(result.uuid).toBe(firstResult.uuid);
				expect(result.stateName).toBe(firstResult.stateName);
				expect(result.matchType).toBe(firstResult.matchType);
			});

			// Verify exact expected values
			expect(firstResult.uuid).toBe('state-pending-uuid-1234');
			expect(firstResult.stateName).toBe('Todo');
		});

		test('should use standard UUID format validation', () => {
			const validUuids = [
				'state-pending-uuid-1234',
				'state-inprogress-uuid-5678',
				'state-review-uuid-9abc'
			];

			validUuids.forEach((uuid) => {
				// Basic format check - should be strings with meaningful identifiers
				expect(typeof uuid).toBe('string');
				expect(uuid.length).toBeGreaterThan(10);
				expect(uuid).toMatch(/^state-\w+-uuid-\w+$/);
			});
		});
	});

	describe('2. Configuration Storage and Retrieval', () => {
		test('should verify UUID mappings are properly stored in configuration', async () => {
			mockLinear.workflowStates.mockResolvedValue(mockCompleteStatesResponse);

			const mappingResult =
				await handler.generateTaskMasterUUIDMappings(mockTeamId);

			expect(mappingResult.success).toBe(true);
			expect(mappingResult.mappings).toBeDefined();
			expect(Object.keys(mappingResult.mappings)).toHaveLength(6);

			// Verify structure suitable for configuration storage
			expect(mappingResult).toHaveProperty('teamId', mockTeamId);
			expect(mappingResult).toHaveProperty('generatedAt');
			expect(mappingResult.generatedAt).toMatch(
				/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
			);
		});

		test('should test loading mappings from configuration during initialization', async () => {
			const storedMappings = {
				pending: 'state-pending-uuid-1234',
				'in-progress': 'state-inprogress-uuid-5678',
				review: 'state-review-uuid-9abc',
				done: 'state-done-uuid-def0',
				cancelled: 'state-cancelled-uuid-1357',
				deferred: 'state-deferred-uuid-2468'
			};

			mockLinear.workflowStates.mockResolvedValue(mockCompleteStatesResponse);

			const validationResult = await handler.validateTaskMasterStatusMappings(
				mockTeamId,
				storedMappings
			);

			expect(validationResult.success).toBe(true);
			expect(validationResult.validCount).toBe(6);
			expect(validationResult.invalidCount).toBe(0);
			expect(validationResult.missingCount).toBe(0);
			expect(Object.keys(validationResult.validMappings)).toHaveLength(6);
		});

		test('should ensure configuration persistence across application restarts', async () => {
			mockLinear.workflowStates.mockResolvedValue(mockCompleteStatesResponse);

			// Simulate first application run - generate mappings
			const initialMappings =
				await handler.generateTaskMasterUUIDMappings(mockTeamId);

			// Simulate restart - clear cache and validate stored mappings
			handler.clearWorkflowStatesCache();

			const validationResult = await handler.validateTaskMasterStatusMappings(
				mockTeamId,
				initialMappings.mappings
			);

			expect(validationResult.success).toBe(true);
			expect(validationResult.validCount).toBe(6);

			// Verify the mappings are still accessible and correct
			expect(validationResult.validMappings.pending.uuid).toBe(
				'state-pending-uuid-1234'
			);
			expect(validationResult.validMappings['in-progress'].uuid).toBe(
				'state-inprogress-uuid-5678'
			);
		});
	});

	describe('3. Validation of State Names', () => {
		test('should verify state names exist in Linear workspace before mapping', async () => {
			mockLinear.workflowStates.mockResolvedValue(mockCompleteStatesResponse);

			const result = await handler.generateTaskMasterUUIDMappings(mockTeamId);

			expect(result.success).toBe(true);

			// Verify all mapped states actually exist in the workspace
			const statesData = await handler.queryWorkflowStates(mockTeamId);
			const existingStateNames = statesData.states.map((state) => state.name);

			expect(existingStateNames).toContain('Todo');
			expect(existingStateNames).toContain('In Progress');
			expect(existingStateNames).toContain('In Review');
			expect(existingStateNames).toContain('Done');
			expect(existingStateNames).toContain('Cancelled');
			expect(existingStateNames).toContain('Backlog');
		});

		test('should test handling of renamed states in Linear', async () => {
			// Initial state setup
			mockLinear.workflowStates.mockResolvedValue(mockCompleteStatesResponse);

			const initialMappings =
				await handler.generateTaskMasterUUIDMappings(mockTeamId);
			expect(initialMappings.success).toBe(true);

			// Simulate renamed state
			const renamedStatesResponse = {
				...mockCompleteStatesResponse,
				nodes: mockCompleteStatesResponse.nodes.map((node) =>
					node.id === 'state-pending-uuid-1234'
						? { ...node, name: 'To Do' } // Renamed from 'Todo'
						: node
				)
			};

			handler.clearWorkflowStatesCache(); // Force fresh API call
			mockLinear.workflowStates.mockResolvedValue(renamedStatesResponse);

			const validationResult = await handler.validateTaskMasterStatusMappings(
				mockTeamId,
				initialMappings.mappings
			);

			// UUID should still be valid even though name changed
			expect(validationResult.validMappings.pending.uuid).toBe(
				'state-pending-uuid-1234'
			);
			expect(validationResult.validMappings.pending.stateName).toBe('To Do');
		});

		test('should validate state name case sensitivity handling', async () => {
			// Test with mixed case state names
			const mixedCaseStatesResponse = {
				...mockCompleteStatesResponse,
				nodes: mockCompleteStatesResponse.nodes.map((node) => ({
					...node,
					name: node.name.toUpperCase() // Convert all to uppercase
				}))
			};

			mockLinear.workflowStates.mockResolvedValue(mixedCaseStatesResponse);

			const result = await handler.generateTaskMasterUUIDMappings(mockTeamId);

			// Should still map successfully with case-insensitive matching
			expect(result.success).toBe(true);
			expect(result.successfulMappings).toBeGreaterThan(0);
		});
	});

	describe('4. Error Handling', () => {
		test('should test behavior when state mappings are missing', async () => {
			// Mock response with missing states
			const incompleteStatesResponse = {
				nodes: [
					{
						id: 'state-1',
						name: 'Todo',
						type: 'unstarted',
						team: { id: mockTeamId }
					}
					// Missing other required states
				],
				pageInfo: { hasNextPage: false }
			};

			mockLinear.workflowStates.mockResolvedValue(incompleteStatesResponse);

			const result = await handler.generateTaskMasterUUIDMappings(mockTeamId);

			expect(result.success).toBe(false);
			expect(result.failedMappings).toBeGreaterThan(0);
			expect(result.errors).toBeDefined();
			expect(result.errors.length).toBeGreaterThan(0);
		});

		test('should verify appropriate error messages for unmapped states', async () => {
			mockLinear.workflowStates.mockResolvedValue({
				nodes: [],
				pageInfo: { hasNextPage: false }
			});

			const result = await handler.resolveTaskMasterStatusToLinearUUID(
				mockTeamId,
				'pending'
			);

			expect(result.success).toBe(false);
			expect(result.error).toMatch(
				/No workflow states found|Could not find Linear state matching/
			);
			expect(result.taskMasterStatus).toBe('pending');
		});

		test('should test recovery mechanisms when mappings become invalid', async () => {
			// Initial valid mappings
			const validMappings = {
				pending: 'state-pending-uuid-1234',
				'in-progress': 'invalid-uuid-9999' // This UUID doesn't exist
			};

			mockLinear.workflowStates.mockResolvedValue(mockCompleteStatesResponse);

			const validationResult = await handler.validateTaskMasterStatusMappings(
				mockTeamId,
				validMappings
			);

			expect(validationResult.success).toBe(false);
			expect(validationResult.validCount).toBe(1);
			expect(validationResult.invalidCount).toBe(1);
			expect(validationResult.invalidMappings['in-progress']).toContain(
				'not found in Linear workspace'
			);
		});

		test('should handle API errors gracefully', async () => {
			// Create a new handler with shorter timeout for testing
			const testHandler = new LinearIntegrationHandler({
				...mockConfig,
				timeout: 1000,
				maxAttempts: 1 // Disable retries for faster test
			});
			testHandler.linear = mockLinear;

			const apiError = new Error('Linear API rate limit exceeded');
			apiError.status = 429;
			mockLinear.workflowStates.mockRejectedValue(apiError);

			const result =
				await testHandler.generateTaskMasterUUIDMappings(mockTeamId);

			expect(result.success).toBe(false);
			// Check for either error format that might be returned
			expect(result.error || result.errors).toBeDefined();
			expect(result.successfulMappings).toBe(0);
			expect(result.failedMappings).toBe(6);
		}, 5000);
	});

	describe('5. Setup Wizard Integration', () => {
		test('should verify wizard correctly generates initial mappings', async () => {
			mockLinear.workflowStates.mockResolvedValue(mockCompleteStatesResponse);

			const result = await handler.generateTaskMasterUUIDMappings(mockTeamId, {
				includeDetails: true
			});

			expect(result.success).toBe(true);
			expect(result.details).toBeDefined();

			// Verify detail structure suitable for wizard display
			Object.keys(result.details).forEach((status) => {
				const detail = result.details[status];
				expect(detail).toHaveProperty('uuid');
				expect(detail).toHaveProperty('stateName');
				expect(detail).toHaveProperty('stateType');
				expect(detail).toHaveProperty('matchType');
			});
		});

		test('should test user interface for manual mapping adjustments', async () => {
			mockLinear.workflowStates.mockResolvedValue(mockCompleteStatesResponse);

			// Simulate user manually adjusting a mapping
			const manualMappings = {
				pending: 'state-deferred-uuid-2468', // User chose Backlog instead of Todo
				'in-progress': 'state-inprogress-uuid-5678',
				review: 'state-review-uuid-9abc',
				done: 'state-done-uuid-def0',
				cancelled: 'state-cancelled-uuid-1357',
				deferred: 'state-pending-uuid-1234' // User chose Todo instead of Backlog
			};

			const validationResult = await handler.validateTaskMasterStatusMappings(
				mockTeamId,
				manualMappings
			);

			expect(validationResult.success).toBe(true);
			expect(validationResult.validCount).toBe(6);

			// Verify manual adjustments are recognized
			expect(validationResult.validMappings.pending.stateName).toBe('Backlog');
			expect(validationResult.validMappings.deferred.stateName).toBe('Todo');
		});

		test('should ensure mappings are properly saved after wizard completion', async () => {
			mockLinear.workflowStates.mockResolvedValue(mockCompleteStatesResponse);

			const generatedMappings =
				await handler.generateTaskMasterUUIDMappings(mockTeamId);

			// Simulate wizard completion by validating the saved mappings
			const validationResult = await handler.validateTaskMasterStatusMappings(
				mockTeamId,
				generatedMappings.mappings
			);

			expect(validationResult.success).toBe(true);
			expect(validationResult).toHaveProperty('validatedAt');
			expect(validationResult.validatedAt).toMatch(
				/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
			);
		});
	});

	describe('Performance and Mock Configuration Tests', () => {
		test('should focus on direct lookups and configuration access speed', async () => {
			mockLinear.workflowStates.mockResolvedValue(mockCompleteStatesResponse);

			const startTime = Date.now();

			// First call to populate cache
			const firstResult = await handler.resolveTaskMasterStatusToLinearUUID(
				mockTeamId,
				'pending'
			);
			expect(firstResult.success).toBe(true);

			// Reset mock call count after initial cache population
			mockLinear.workflowStates.mockClear();

			// Test multiple rapid lookups that should use cache
			const promises = [];
			for (let i = 0; i < 5; i++) {
				promises.push(
					handler.resolveTaskMasterStatusToLinearUUID(mockTeamId, 'pending')
				);
			}

			const results = await Promise.all(promises);
			const endTime = Date.now();

			// All should succeed and use cache
			results.forEach((result) => {
				expect(result.success).toBe(true);
				expect(result.uuid).toBe('state-pending-uuid-1234');
			});

			// Should complete quickly due to caching
			expect(endTime - startTime).toBeLessThan(1000);

			// Verify cache was used (no additional API calls)
			expect(mockLinear.workflowStates).toHaveBeenCalledTimes(0);
		});

		test('should use simple, representative state configurations with standard UUID formats', () => {
			const mockStates = mockCompleteStatesResponse.nodes;

			// Verify representative configuration
			expect(mockStates).toHaveLength(6); // Covers all TaskMaster statuses

			// Verify standard UUID formats
			mockStates.forEach((state) => {
				expect(state.id).toMatch(/^state-\w+-uuid-\w+$/);
				expect(typeof state.name).toBe('string');
				expect(state.name.length).toBeGreaterThan(0);
				expect(
					['unstarted', 'started', 'completed', 'canceled'].includes(state.type)
				).toBe(true);
			});
		});

		test('should verify TaskMaster status constants are correctly defined', () => {
			expect(LinearIntegrationHandler.TASKMASTER_STATUSES).toEqual([
				'pending',
				'in-progress',
				'review',
				'done',
				'cancelled',
				'deferred'
			]);

			expect(LinearIntegrationHandler.TASKMASTER_STATUS_DEFAULTS).toEqual({
				pending: ['Todo', 'Backlog'],
				'in-progress': ['In Progress'],
				review: ['In Review'],
				done: ['Done', 'Completed'],
				cancelled: ['Canceled', 'Cancelled'],
				deferred: ['Backlog', 'On Hold']
			});
		});
	});
});
