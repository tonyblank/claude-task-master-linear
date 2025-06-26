/**
 * @fileoverview Unit tests for Linear Workflow States functionality
 * Tests the queryWorkflowStates, findWorkflowStateByName, and related methods
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

describe('LinearIntegrationHandler - Workflow States', () => {
	let handler;
	const mockTeamId = 'team-123';
	const mockConfig = {
		apiKey: 'lin_api_test',
		teamId: mockTeamId,
		createIssues: true
	};

	beforeEach(() => {
		jest.clearAllMocks();
		handler = new LinearIntegrationHandler(mockConfig);
		handler.linear = mockLinear;
	});

	describe('queryWorkflowStates', () => {
		const mockStatesResponse = {
			nodes: [
				{
					id: 'state-1',
					name: 'Todo',
					type: 'unstarted',
					color: '#e2e2e2',
					position: 0,
					description: 'New tasks',
					team: { id: mockTeamId, name: 'Test Team', key: 'TEST' },
					createdAt: '2023-01-01T00:00:00Z',
					updatedAt: '2023-01-01T00:00:00Z'
				},
				{
					id: 'state-2',
					name: 'In Progress',
					type: 'started',
					color: '#5e6ad2',
					position: 1,
					description: 'Work in progress',
					team: { id: mockTeamId, name: 'Test Team', key: 'TEST' },
					createdAt: '2023-01-01T00:00:00Z',
					updatedAt: '2023-01-01T00:00:00Z'
				},
				{
					id: 'state-3',
					name: 'Done',
					type: 'completed',
					color: '#0f973d',
					position: 2,
					description: 'Completed tasks',
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

		test('should successfully query workflow states', async () => {
			mockLinear.workflowStates.mockResolvedValue(mockStatesResponse);

			const result = await handler.queryWorkflowStates(mockTeamId);

			expect(mockLinear.workflowStates).toHaveBeenCalledWith({
				first: 100,
				filter: {
					team: { id: { eq: mockTeamId } },
					archivedAt: { null: true }
				}
			});

			expect(result).toMatchObject({
				states: expect.arrayContaining([
					expect.objectContaining({
						id: 'state-1',
						name: 'Todo',
						type: 'unstarted',
						color: '#e2e2e2',
						position: 0
					}),
					expect.objectContaining({
						id: 'state-2',
						name: 'In Progress',
						type: 'started',
						color: '#5e6ad2',
						position: 1
					}),
					expect.objectContaining({
						id: 'state-3',
						name: 'Done',
						type: 'completed',
						color: '#0f973d',
						position: 2
					})
				]),
				statesByType: {
					unstarted: expect.arrayContaining([
						expect.objectContaining({ name: 'Todo' })
					]),
					started: expect.arrayContaining([
						expect.objectContaining({ name: 'In Progress' })
					]),
					completed: expect.arrayContaining([
						expect.objectContaining({ name: 'Done' })
					])
				},
				stateNameMap: expect.objectContaining({
					Todo: 'state-1',
					todo: 'state-1',
					'In Progress': 'state-2',
					'in progress': 'state-2',
					inprogress: 'state-2',
					Done: 'state-3',
					done: 'state-3'
				}),
				metadata: expect.objectContaining({
					totalCount: 3,
					teamId: mockTeamId,
					types: ['unstarted', 'started', 'completed']
				})
			});
		});

		test('should handle pagination correctly', async () => {
			const page1Response = {
				nodes: [mockStatesResponse.nodes[0]],
				pageInfo: {
					hasNextPage: true,
					endCursor: 'cursor-1'
				}
			};

			const page2Response = {
				nodes: [mockStatesResponse.nodes[1], mockStatesResponse.nodes[2]],
				pageInfo: {
					hasNextPage: false,
					endCursor: null
				}
			};

			mockLinear.workflowStates
				.mockResolvedValueOnce(page1Response)
				.mockResolvedValueOnce(page2Response);

			const result = await handler.queryWorkflowStates(mockTeamId, {
				pageSize: 1
			});

			expect(mockLinear.workflowStates).toHaveBeenCalledTimes(2);
			expect(mockLinear.workflowStates).toHaveBeenNthCalledWith(1, {
				first: 1,
				filter: {
					team: { id: { eq: mockTeamId } },
					archivedAt: { null: true }
				}
			});
			expect(mockLinear.workflowStates).toHaveBeenNthCalledWith(2, {
				first: 1,
				after: 'cursor-1',
				filter: {
					team: { id: { eq: mockTeamId } },
					archivedAt: { null: true }
				}
			});

			expect(result.states).toHaveLength(3);
			expect(result.metadata.pageCount).toBe(2);
		});

		test('should include archived states when requested', async () => {
			mockLinear.workflowStates.mockResolvedValue(mockStatesResponse);

			await handler.queryWorkflowStates(mockTeamId, { includeArchived: true });

			expect(mockLinear.workflowStates).toHaveBeenCalledWith({
				first: 100,
				filter: {
					team: { id: { eq: mockTeamId } }
				}
			});
		});

		test('should use cache when available', async () => {
			mockLinear.workflowStates.mockResolvedValue(mockStatesResponse);

			// First call should hit the API
			const result1 = await handler.queryWorkflowStates(mockTeamId);
			expect(mockLinear.workflowStates).toHaveBeenCalledTimes(1);

			// Second call should use cache
			const result2 = await handler.queryWorkflowStates(mockTeamId);
			expect(mockLinear.workflowStates).toHaveBeenCalledTimes(1);

			expect(result1).toEqual(result2);
		});

		test('should skip cache when useCache is false', async () => {
			mockLinear.workflowStates.mockResolvedValue(mockStatesResponse);

			// First call
			await handler.queryWorkflowStates(mockTeamId);
			expect(mockLinear.workflowStates).toHaveBeenCalledTimes(1);

			// Second call with useCache: false should hit API again
			await handler.queryWorkflowStates(mockTeamId, { useCache: false });
			expect(mockLinear.workflowStates).toHaveBeenCalledTimes(2);
		});

		test('should handle API errors correctly', async () => {
			const apiError = new Error('API rate limit exceeded');
			apiError.status = 429;
			mockLinear.workflowStates.mockRejectedValue(apiError);

			await expect(handler.queryWorkflowStates(mockTeamId)).rejects.toThrow();
		});

		test('should validate team ID parameter', async () => {
			await expect(handler.queryWorkflowStates(null)).rejects.toThrow(
				'Team ID is required and must be a string'
			);
			await expect(handler.queryWorkflowStates('')).rejects.toThrow(
				'Team ID is required and must be a string'
			);
			await expect(handler.queryWorkflowStates(123)).rejects.toThrow(
				'Team ID is required and must be a string'
			);
		});

		test('should handle invalid response structure', async () => {
			mockLinear.workflowStates.mockResolvedValue({ invalid: 'response' });

			await expect(handler.queryWorkflowStates(mockTeamId)).rejects.toThrow(
				'Invalid workflow states response structure'
			);
		});

		test('should handle missing required fields in states', async () => {
			const invalidStatesResponse = {
				nodes: [
					{ id: 'state-1', name: 'Valid State' },
					{ id: '', name: 'Invalid State 1' }, // Missing ID
					{ id: 'state-3', name: '' }, // Missing name
					{ name: 'Invalid State 2' } // Missing ID
				],
				pageInfo: { hasNextPage: false }
			};

			mockLinear.workflowStates.mockResolvedValue(invalidStatesResponse);

			const result = await handler.queryWorkflowStates(mockTeamId);

			// Should only include the valid state
			expect(result.states).toHaveLength(1);
			expect(result.states[0]).toMatchObject({
				id: 'state-1',
				name: 'Valid State'
			});
		});
	});

	describe('findWorkflowStateByName', () => {
		beforeEach(() => {
			// Set up cached states for testing
			const mockStatesData = {
				states: [
					{ id: 'state-1', name: 'Todo', type: 'unstarted' },
					{ id: 'state-2', name: 'In Progress', type: 'started' },
					{ id: 'state-3', name: 'In Review', type: 'started' },
					{ id: 'state-4', name: 'Done', type: 'completed' },
					{ id: 'state-5', name: 'Cancelled', type: 'canceled' }
				],
				stateNameMap: {
					Todo: 'state-1',
					todo: 'state-1',
					'In Progress': 'state-2',
					'in progress': 'state-2',
					inprogress: 'state-2',
					'In Review': 'state-3',
					'in review': 'state-3',
					inreview: 'state-3',
					Done: 'state-4',
					done: 'state-4',
					Cancelled: 'state-5',
					cancelled: 'state-5'
				}
			};

			handler._workflowStatesCache = new Map();
			handler._workflowStatesCache.set(mockTeamId, {
				data: mockStatesData,
				cachedAt: Date.now()
			});
		});

		test('should find state by exact name', async () => {
			const result = await handler.findWorkflowStateByName(mockTeamId, 'Todo');

			expect(result).toMatchObject({
				id: 'state-1',
				name: 'Todo',
				type: 'unstarted'
			});
		});

		test('should find state by case-insensitive name', async () => {
			const result = await handler.findWorkflowStateByName(mockTeamId, 'TODO');

			expect(result).toMatchObject({
				id: 'state-1',
				name: 'Todo',
				type: 'unstarted'
			});
		});

		test('should find state by normalized name', async () => {
			const result = await handler.findWorkflowStateByName(
				mockTeamId,
				'in-progress'
			);

			expect(result).toMatchObject({
				id: 'state-2',
				name: 'In Progress',
				type: 'started'
			});
		});

		test('should find state using fuzzy matching', async () => {
			const result = await handler.findWorkflowStateByName(
				mockTeamId,
				'progress'
			);

			expect(result).toMatchObject({
				id: 'state-2',
				name: 'In Progress',
				type: 'started'
			});
		});

		test('should find state using common abbreviations', async () => {
			const result = await handler.findWorkflowStateByName(
				mockTeamId,
				'review'
			);

			expect(result).toMatchObject({
				id: 'state-3',
				name: 'In Review',
				type: 'started'
			});
		});

		test('should return null for non-existent state', async () => {
			const result = await handler.findWorkflowStateByName(
				mockTeamId,
				'NonExistent'
			);

			expect(result).toBeNull();
		});

		test('should return null when fuzzy matching is disabled and no exact match', async () => {
			const result = await handler.findWorkflowStateByName(
				mockTeamId,
				'progress',
				{ fuzzyMatch: false }
			);

			expect(result).toBeNull();
		});

		test('should handle API errors gracefully', async () => {
			// Clear cache to force API call
			handler.clearWorkflowStatesCache();

			const apiError = new Error('Network error');
			mockLinear.workflowStates.mockRejectedValue(apiError);

			const result = await handler.findWorkflowStateByName(mockTeamId, 'Todo');

			expect(result).toBeNull();
		});
	});

	describe('_findFuzzyWorkflowStateMatch', () => {
		const mockStates = [
			{ id: 'state-1', name: 'Todo' },
			{ id: 'state-2', name: 'In Progress' },
			{ id: 'state-3', name: 'Code Review' },
			{ id: 'state-4', name: 'Done' },
			{ id: 'state-5', name: 'Cancelled' }
		];

		test('should find exact substring matches', () => {
			const result = handler._findFuzzyWorkflowStateMatch(
				mockStates,
				'Progress'
			);

			expect(result).toMatchObject({
				id: 'state-2',
				name: 'In Progress'
			});
		});

		test('should find word-based matches', () => {
			const result = handler._findFuzzyWorkflowStateMatch(mockStates, 'Code');

			expect(result).toMatchObject({
				id: 'state-3',
				name: 'Code Review'
			});
		});

		test('should find common abbreviation matches', () => {
			const result = handler._findFuzzyWorkflowStateMatch(mockStates, 'todo');

			expect(result).toMatchObject({
				id: 'state-1',
				name: 'Todo'
			});
		});

		test('should return null for low similarity scores', () => {
			const result = handler._findFuzzyWorkflowStateMatch(mockStates, 'xyz');

			expect(result).toBeNull();
		});

		test('should handle empty or invalid inputs', () => {
			expect(handler._findFuzzyWorkflowStateMatch(null, 'test')).toBeNull();
			expect(handler._findFuzzyWorkflowStateMatch([], 'test')).toBeNull();
			expect(handler._findFuzzyWorkflowStateMatch(mockStates, '')).toBeNull();
			expect(handler._findFuzzyWorkflowStateMatch(mockStates, null)).toBeNull();
		});
	});

	describe('Cache Management', () => {
		test('should cache workflow states data', async () => {
			const mockStatesResponse = {
				nodes: [{ id: 'state-1', name: 'Todo' }],
				pageInfo: { hasNextPage: false }
			};

			mockLinear.workflowStates.mockResolvedValue(mockStatesResponse);

			// First call should cache the data
			await handler.queryWorkflowStates(mockTeamId);

			expect(handler._workflowStatesCache.has(mockTeamId)).toBe(true);
			const cached = handler._workflowStatesCache.get(mockTeamId);
			expect(cached.data.states).toHaveLength(1);
			expect(typeof cached.cachedAt).toBe('number');
		});

		test('should expire cache after TTL', async () => {
			// Set up expired cache
			const expiredData = {
				data: { states: [], stateNameMap: {}, metadata: {} },
				cachedAt: Date.now() - 6 * 60 * 1000 // 6 minutes ago
			};
			handler._workflowStatesCache = new Map();
			handler._workflowStatesCache.set(mockTeamId, expiredData);

			const mockStatesResponse = {
				nodes: [{ id: 'state-1', name: 'Todo' }],
				pageInfo: { hasNextPage: false }
			};
			mockLinear.workflowStates.mockResolvedValue(mockStatesResponse);

			// Should fetch fresh data
			await handler.queryWorkflowStates(mockTeamId);

			expect(mockLinear.workflowStates).toHaveBeenCalledTimes(1);
		});

		test('should clear specific team cache', () => {
			handler._workflowStatesCache = new Map();
			handler._workflowStatesCache.set('team-1', {
				data: {},
				cachedAt: Date.now()
			});
			handler._workflowStatesCache.set('team-2', {
				data: {},
				cachedAt: Date.now()
			});

			handler.clearWorkflowStatesCache('team-1');

			expect(handler._workflowStatesCache.has('team-1')).toBe(false);
			expect(handler._workflowStatesCache.has('team-2')).toBe(true);
		});

		test('should clear all cache', () => {
			handler._workflowStatesCache = new Map();
			handler._workflowStatesCache.set('team-1', {
				data: {},
				cachedAt: Date.now()
			});
			handler._workflowStatesCache.set('team-2', {
				data: {},
				cachedAt: Date.now()
			});

			handler.clearWorkflowStatesCache();

			expect(handler._workflowStatesCache.size).toBe(0);
		});

		test('should limit cache size', async () => {
			const mockStatesResponse = {
				nodes: [{ id: 'state-1', name: 'Todo' }],
				pageInfo: { hasNextPage: false }
			};
			mockLinear.workflowStates.mockResolvedValue(mockStatesResponse);

			// Fill cache to limit
			handler._workflowStatesCache = new Map();
			for (let i = 0; i < 50; i++) {
				handler._workflowStatesCache.set(`team-${i}`, {
					data: { states: [], stateNameMap: {}, metadata: {} },
					cachedAt: Date.now()
				});
			}

			// Adding one more should remove the oldest
			await handler.queryWorkflowStates('team-new');

			expect(handler._workflowStatesCache.size).toBe(50);
			expect(handler._workflowStatesCache.has('team-0')).toBe(false);
			expect(handler._workflowStatesCache.has('team-new')).toBe(true);
		});
	});

	describe('Integration Capabilities', () => {
		test('should report queryWorkflowStates capability', () => {
			const capabilities = handler.getCapabilities();

			expect(capabilities.queryWorkflowStates).toBe(true);
		});
	});

	describe('TaskMaster Status Mapping', () => {
		beforeEach(() => {
			// Set up cached states for TaskMaster mapping tests
			const mockStatesData = {
				states: [
					{ id: 'state-1', name: 'Todo', type: 'unstarted' },
					{ id: 'state-2', name: 'In Progress', type: 'started' },
					{ id: 'state-3', name: 'In Review', type: 'started' },
					{ id: 'state-4', name: 'Done', type: 'completed' },
					{ id: 'state-5', name: 'Cancelled', type: 'canceled' },
					{ id: 'state-6', name: 'Backlog', type: 'unstarted' }
				],
				stateNameMap: {
					Todo: 'state-1',
					todo: 'state-1',
					'In Progress': 'state-2',
					'in progress': 'state-2',
					'In Review': 'state-3',
					'in review': 'state-3',
					Done: 'state-4',
					done: 'state-4',
					Cancelled: 'state-5',
					cancelled: 'state-5',
					Backlog: 'state-6',
					backlog: 'state-6'
				}
			};

			handler._workflowStatesCache = new Map();
			handler._workflowStatesCache.set(mockTeamId, {
				data: mockStatesData,
				cachedAt: Date.now()
			});
		});

		describe('resolveTaskMasterStatusToLinearUUID', () => {
			test('should resolve pending status to Todo state', async () => {
				const result = await handler.resolveTaskMasterStatusToLinearUUID(
					mockTeamId,
					'pending'
				);

				expect(result.success).toBe(true);
				expect(result.uuid).toBe('state-1');
				expect(result.stateName).toBe('Todo');
				expect(result.taskMasterStatus).toBe('pending');
				expect(result.matchType).toBe('exact');
			});

			test('should resolve in-progress status to In Progress state', async () => {
				const result = await handler.resolveTaskMasterStatusToLinearUUID(
					mockTeamId,
					'in-progress'
				);

				expect(result.success).toBe(true);
				expect(result.uuid).toBe('state-2');
				expect(result.stateName).toBe('In Progress');
				expect(result.taskMasterStatus).toBe('in-progress');
				expect(result.matchType).toBe('exact');
			});

			test('should resolve review status to In Review state', async () => {
				const result = await handler.resolveTaskMasterStatusToLinearUUID(
					mockTeamId,
					'review'
				);

				expect(result.success).toBe(true);
				expect(result.uuid).toBe('state-3');
				expect(result.stateName).toBe('In Review');
				expect(result.taskMasterStatus).toBe('review');
				expect(result.matchType).toBe('exact');
			});

			test('should resolve done status to Done state', async () => {
				const result = await handler.resolveTaskMasterStatusToLinearUUID(
					mockTeamId,
					'done'
				);

				expect(result.success).toBe(true);
				expect(result.uuid).toBe('state-4');
				expect(result.stateName).toBe('Done');
				expect(result.taskMasterStatus).toBe('done');
				expect(result.matchType).toBe('exact');
			});

			test('should resolve cancelled status to Cancelled state', async () => {
				const result = await handler.resolveTaskMasterStatusToLinearUUID(
					mockTeamId,
					'cancelled'
				);

				expect(result.success).toBe(true);
				expect(result.uuid).toBe('state-5');
				expect(result.stateName).toBe('Cancelled');
				expect(result.taskMasterStatus).toBe('cancelled');
				expect(result.matchType).toBe('exact');
			});

			test('should resolve deferred status to Backlog state', async () => {
				const result = await handler.resolveTaskMasterStatusToLinearUUID(
					mockTeamId,
					'deferred'
				);

				expect(result.success).toBe(true);
				expect(result.uuid).toBe('state-6');
				expect(result.stateName).toBe('Backlog');
				expect(result.taskMasterStatus).toBe('deferred');
				expect(result.matchType).toBe('exact');
			});

			test('should handle case variations in TaskMaster status', async () => {
				const result = await handler.resolveTaskMasterStatusToLinearUUID(
					mockTeamId,
					'IN-PROGRESS'
				);

				expect(result.success).toBe(true);
				expect(result.uuid).toBe('state-2');
				expect(result.stateName).toBe('In Progress');
			});

			test('should return error for invalid TaskMaster status', async () => {
				const result = await handler.resolveTaskMasterStatusToLinearUUID(
					mockTeamId,
					'invalid-status'
				);

				expect(result.success).toBe(false);
				expect(result.error).toContain('Invalid TaskMaster status');
				expect(result.taskMasterStatus).toBe('invalid-status');
			});

			test('should return error for missing TaskMaster status', async () => {
				const result = await handler.resolveTaskMasterStatusToLinearUUID(
					mockTeamId,
					null
				);

				expect(result.success).toBe(false);
				expect(result.error).toContain('TaskMaster status is required');
			});

			test('should return error when Linear state not found', async () => {
				// Set up states without Todo
				const statesWithoutTodo = {
					states: [
						{ id: 'state-2', name: 'In Progress', type: 'started' },
						{ id: 'state-4', name: 'Done', type: 'completed' }
					]
				};

				handler._workflowStatesCache.set(mockTeamId, {
					data: statesWithoutTodo,
					cachedAt: Date.now()
				});

				const result = await handler.resolveTaskMasterStatusToLinearUUID(
					mockTeamId,
					'pending'
				);

				expect(result.success).toBe(false);
				expect(result.error).toContain('Could not find Linear state matching');
				expect(result.taskMasterStatus).toBe('pending');
				expect(result.possibleStateNames).toEqual(['Todo', 'Backlog']);
			});

			test('should use case-insensitive matching when exact match fails', async () => {
				// Set up states with different case
				const statesWithCaseVariation = {
					states: [
						{ id: 'state-1', name: 'todo', type: 'unstarted' }, // lowercase
						{ id: 'state-2', name: 'IN PROGRESS', type: 'started' } // uppercase
					]
				};

				handler._workflowStatesCache.set(mockTeamId, {
					data: statesWithCaseVariation,
					cachedAt: Date.now()
				});

				const result = await handler.resolveTaskMasterStatusToLinearUUID(
					mockTeamId,
					'pending'
				);

				expect(result.success).toBe(true);
				expect(result.uuid).toBe('state-1');
				expect(result.stateName).toBe('todo');
				expect(result.matchType).toBe('case-insensitive');
			});

			test('should use fuzzy matching as fallback', async () => {
				// Set up states with similar but not exact names
				const statesWithSimilarNames = {
					states: [
						{ id: 'state-1', name: 'To Do', type: 'unstarted' }, // Similar to "Todo"
						{ id: 'state-2', name: 'Work In Progress', type: 'started' } // Similar to "In Progress"
					]
				};

				handler._workflowStatesCache.set(mockTeamId, {
					data: statesWithSimilarNames,
					cachedAt: Date.now()
				});

				const result = await handler.resolveTaskMasterStatusToLinearUUID(
					mockTeamId,
					'pending'
				);

				expect(result.success).toBe(true);
				expect(result.uuid).toBe('state-1');
				expect(result.stateName).toBe('To Do');
				expect(result.matchType).toBe('fuzzy');
			});

			test('should skip fuzzy matching when disabled', async () => {
				// Set up states with similar but not exact names
				const statesWithSimilarNames = {
					states: [{ id: 'state-1', name: 'To Do', type: 'unstarted' }]
				};

				handler._workflowStatesCache.set(mockTeamId, {
					data: statesWithSimilarNames,
					cachedAt: Date.now()
				});

				const result = await handler.resolveTaskMasterStatusToLinearUUID(
					mockTeamId,
					'pending',
					{ allowFuzzyFallback: false }
				);

				expect(result.success).toBe(false);
				expect(result.error).toContain('Could not find Linear state matching');
			});
		});

		describe('generateTaskMasterUUIDMappings', () => {
			test('should generate complete UUID mappings for all TaskMaster statuses', async () => {
				const result = await handler.generateTaskMasterUUIDMappings(mockTeamId);

				expect(result.success).toBe(true);
				expect(result.mappings).toEqual({
					pending: 'state-1',
					'in-progress': 'state-2',
					review: 'state-3',
					done: 'state-4',
					cancelled: 'state-5',
					deferred: 'state-6'
				});
				expect(result.teamId).toBe(mockTeamId);
				expect(result.totalStatuses).toBe(6);
				expect(result.successfulMappings).toBe(6);
				expect(result.failedMappings).toBe(0);
			});

			test('should include details when requested', async () => {
				const result = await handler.generateTaskMasterUUIDMappings(
					mockTeamId,
					{
						includeDetails: true
					}
				);

				expect(result.success).toBe(true);
				expect(result.details).toBeDefined();
				expect(result.details.pending).toEqual({
					uuid: 'state-1',
					stateName: 'Todo',
					stateType: 'unstarted',
					matchType: 'exact'
				});
			});

			test('should handle partial mapping failures', async () => {
				// Set up states missing some required states
				const incompleteStates = {
					states: [
						{ id: 'state-2', name: 'In Progress', type: 'started' },
						{ id: 'state-4', name: 'Done', type: 'completed' }
					]
				};

				handler._workflowStatesCache.set(mockTeamId, {
					data: incompleteStates,
					cachedAt: Date.now()
				});

				const result = await handler.generateTaskMasterUUIDMappings(mockTeamId);

				expect(result.success).toBe(false);
				expect(result.successfulMappings).toBe(2);
				expect(result.failedMappings).toBe(4);
				expect(result.mappings).toEqual({
					'in-progress': 'state-2',
					done: 'state-4'
				});
				expect(result.errors).toHaveLength(4);
			});

			test('should handle API errors gracefully', async () => {
				// Create a handler with no cache
				const errorHandler = new LinearIntegrationHandler(mockConfig);
				errorHandler.linear = mockLinear;

				// Mock the resolveTaskMasterStatusToLinearUUID method to throw an error
				// This will trigger the catch block in generateTaskMasterUUIDMappings
				errorHandler.resolveTaskMasterStatusToLinearUUID = jest
					.fn()
					.mockRejectedValue(new Error('API Error'));

				const result =
					await errorHandler.generateTaskMasterUUIDMappings(mockTeamId);

				expect(result.success).toBe(false);
				expect(result.error).toContain('Mapping generation failed');
				expect(result.successfulMappings).toBe(0);
				expect(result.failedMappings).toBe(6);
			});
		});

		describe('validateTaskMasterStatusMappings', () => {
			test('should validate correct UUID mappings', async () => {
				const existingMappings = {
					pending: 'state-1',
					'in-progress': 'state-2',
					review: 'state-3',
					done: 'state-4',
					cancelled: 'state-5',
					deferred: 'state-6'
				};

				const result = await handler.validateTaskMasterStatusMappings(
					mockTeamId,
					existingMappings
				);

				expect(result.success).toBe(true);
				expect(result.validCount).toBe(6);
				expect(result.invalidCount).toBe(0);
				expect(result.missingCount).toBe(0);
				expect(Object.keys(result.validMappings)).toHaveLength(6);
			});

			test('should identify invalid UUIDs', async () => {
				const existingMappings = {
					pending: 'invalid-uuid',
					'in-progress': 'state-2'
				};

				const result = await handler.validateTaskMasterStatusMappings(
					mockTeamId,
					existingMappings
				);

				expect(result.success).toBe(false);
				expect(result.validCount).toBe(1);
				expect(result.invalidCount).toBe(1);
				expect(result.missingCount).toBe(4);
				expect(result.invalidMappings.pending).toContain(
					'not found in Linear workspace'
				);
			});

			test('should identify missing mappings', async () => {
				const incompleteMapping = {
					pending: 'state-1'
				};

				const result = await handler.validateTaskMasterStatusMappings(
					mockTeamId,
					incompleteMapping
				);

				expect(result.success).toBe(false);
				expect(result.validCount).toBe(1);
				expect(result.missingCount).toBe(5);
				expect(result.missingMappings).toEqual([
					'in-progress',
					'review',
					'done',
					'cancelled',
					'deferred'
				]);
			});

			test('should handle missing mappings object', async () => {
				const result = await handler.validateTaskMasterStatusMappings(
					mockTeamId,
					null
				);

				expect(result.success).toBe(false);
				expect(result.error).toContain('Existing mappings object is required');
			});
		});

		describe('getUnmappedTaskMasterStatuses', () => {
			test('should return empty array for complete mappings', async () => {
				const completeMappings = {
					pending: 'state-1',
					'in-progress': 'state-2',
					review: 'state-3',
					done: 'state-4',
					cancelled: 'state-5',
					deferred: 'state-6'
				};

				const unmapped = await handler.getUnmappedTaskMasterStatuses(
					mockTeamId,
					completeMappings
				);

				expect(unmapped).toEqual([]);
			});

			test('should return missing statuses', async () => {
				const incompleteMappings = {
					pending: 'state-1',
					done: 'state-4'
				};

				const unmapped = await handler.getUnmappedTaskMasterStatuses(
					mockTeamId,
					incompleteMappings
				);

				expect(unmapped).toEqual([
					'in-progress',
					'review',
					'cancelled',
					'deferred'
				]);
			});

			test('should return all statuses for empty mappings', async () => {
				const unmapped = await handler.getUnmappedTaskMasterStatuses(
					mockTeamId,
					{}
				);

				expect(unmapped).toEqual([
					'pending',
					'in-progress',
					'review',
					'done',
					'cancelled',
					'deferred'
				]);
			});
		});

		describe('TaskMaster Status Constants', () => {
			test('should have correct default mappings', () => {
				expect(LinearIntegrationHandler.TASKMASTER_STATUS_DEFAULTS).toEqual({
					pending: ['Todo', 'Backlog'],
					'in-progress': ['In Progress'],
					review: ['In Review'],
					done: ['Done', 'Completed'],
					cancelled: ['Canceled', 'Cancelled'],
					deferred: ['Backlog', 'On Hold']
				});
			});

			test('should have correct list of TaskMaster statuses', () => {
				expect(LinearIntegrationHandler.TASKMASTER_STATUSES).toEqual([
					'pending',
					'in-progress',
					'review',
					'done',
					'cancelled',
					'deferred'
				]);
			});
		});
	});
});
