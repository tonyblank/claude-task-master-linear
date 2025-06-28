import { jest } from '@jest/globals';
import { LinearIntegrationHandler } from '../../scripts/modules/integrations/linear-integration-handler.js';

// Mock dependencies
jest.mock('../../scripts/modules/utils.js', () => ({
	log: jest.fn()
}));

describe('Linear Workflow Edge Cases', () => {
	let handler;
	let mockLinearClient;

	beforeEach(() => {
		// Create mock Linear client
		mockLinearClient = {
			workflowStates: jest.fn()
		};

		// Create handler instance
		handler = new LinearIntegrationHandler();
		handler.linear = mockLinearClient;
		handler._workflowStatesCache = new Map();
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	describe('handleWorkflowEdgeCases', () => {
		const mockTeamId = 'team-123';
		const mockTaskMasterStatus = 'pending';

		test('should handle missing workflow states', async () => {
			// Mock empty workflow states
			mockLinearClient.workflowStates.mockResolvedValue({
				nodes: [],
				pageInfo: { hasNextPage: false }
			});

			const result = await handler.handleWorkflowEdgeCases(
				mockTeamId,
				mockTaskMasterStatus
			);

			expect(result.success).toBe(false);
			expect(result.edgeCaseHandling.configValidation.isValid).toBe(false);
			expect(result.edgeCaseHandling.configValidation.issues).toContain(
				'No workflow states found for team'
			);
		});

		test('should handle archived states in default mappings', async () => {
			// Mock workflow states with archived "Todo" state
			const mockStates = [
				{
					id: 'state-1',
					name: 'Todo',
					type: 'unstarted',
					color: '#95a2b3',
					position: 0,
					archivedAt: '2023-01-01T00:00:00.000Z',
					team: { id: mockTeamId, name: 'Test Team', key: 'TEST' }
				},
				{
					id: 'state-2',
					name: 'In Progress',
					type: 'started',
					color: '#f2c94c',
					position: 1,
					team: { id: mockTeamId, name: 'Test Team', key: 'TEST' }
				},
				{
					id: 'state-3',
					name: 'Done',
					type: 'completed',
					color: '#27ae60',
					position: 2,
					team: { id: mockTeamId, name: 'Test Team', key: 'TEST' }
				}
			];

			mockLinearClient.workflowStates.mockResolvedValue({
				nodes: mockStates,
				pageInfo: { hasNextPage: false }
			});

			const result = await handler.handleWorkflowEdgeCases(
				mockTeamId,
				mockTaskMasterStatus,
				{ includeArchived: true } // Include archived states for testing
			);

			expect(
				result.edgeCaseHandling.archivedStateHandling.hasArchivedStates
			).toBe(true);
			expect(
				result.edgeCaseHandling.archivedStateHandling.archivedDefaultMappings
			).toHaveLength(1);
			expect(
				result.edgeCaseHandling.archivedStateHandling.archivedDefaultMappings[0]
					.name
			).toBe('Todo');
			expect(
				result.edgeCaseHandling.archivedStateHandling.shouldExcludeArchived
			).toBe(true);
			expect(
				result.edgeCaseHandling.archivedStateHandling.recommendation
			).toContain("Default mapping for 'pending' points to archived state(s)");
		});

		test('should provide user guidance when all mappings fail', async () => {
			// Mock workflow states with no matching states
			const mockStates = [
				{
					id: 'state-1',
					name: 'Custom State 1',
					type: 'unstarted',
					color: '#95a2b3',
					position: 0,
					team: { id: mockTeamId, name: 'Test Team', key: 'TEST' }
				},
				{
					id: 'state-2',
					name: 'Custom State 2',
					type: 'started',
					color: '#f2c94c',
					position: 1,
					team: { id: mockTeamId, name: 'Test Team', key: 'TEST' }
				}
			];

			mockLinearClient.workflowStates.mockResolvedValue({
				nodes: mockStates,
				pageInfo: { hasNextPage: false }
			});

			const result = await handler.handleWorkflowEdgeCases(
				mockTeamId,
				mockTaskMasterStatus,
				{ fallbackToDefault: false } // Disable fallbacks to test guidance
			);

			expect(result.success).toBe(false);
			expect(result.edgeCaseHandling.userGuidance).toBeDefined();
			expect(result.edgeCaseHandling.userGuidance.summary).toContain(
				"Unable to map TaskMaster status 'pending'"
			);
			expect(result.edgeCaseHandling.userGuidance.steps).toContain(
				"1. Review your Linear team's workflow states in the Linear app"
			);
			expect(result.edgeCaseHandling.userGuidance.availableStates).toHaveLength(
				2
			);
			expect(result.edgeCaseHandling.userGuidance.recommendedActions).toContain(
				'Consider creating Linear workflow states named: Todo or Backlog for automatic mapping'
			);
		});

		test('should handle duplicate state names', async () => {
			// Mock workflow states with duplicate names
			const mockStates = [
				{
					id: 'state-1',
					name: 'Todo',
					type: 'unstarted',
					color: '#95a2b3',
					position: 0,
					team: { id: mockTeamId, name: 'Test Team', key: 'TEST' }
				},
				{
					id: 'state-2',
					name: 'Todo',
					type: 'started',
					color: '#f2c94c',
					position: 1,
					team: { id: mockTeamId, name: 'Test Team', key: 'TEST' }
				}
			];

			mockLinearClient.workflowStates.mockResolvedValue({
				nodes: mockStates,
				pageInfo: { hasNextPage: false }
			});

			const result = await handler.handleWorkflowEdgeCases(
				mockTeamId,
				mockTaskMasterStatus
			);

			expect(result.edgeCaseHandling.configValidation.warnings).toContain(
				'Duplicate state names detected: Todo'
			);
			expect(
				result.edgeCaseHandling.configValidation.recommendations
			).toContain(
				'Consider renaming duplicate states to avoid mapping conflicts'
			);
		});

		test('should handle missing state types', async () => {
			// Mock workflow states missing 'completed' type
			const mockStates = [
				{
					id: 'state-1',
					name: 'Todo',
					type: 'unstarted',
					color: '#95a2b3',
					position: 0,
					team: { id: mockTeamId, name: 'Test Team', key: 'TEST' }
				},
				{
					id: 'state-2',
					name: 'In Progress',
					type: 'started',
					color: '#f2c94c',
					position: 1,
					team: { id: mockTeamId, name: 'Test Team', key: 'TEST' }
				}
				// No 'completed' type state
			];

			mockLinearClient.workflowStates.mockResolvedValue({
				nodes: mockStates,
				pageInfo: { hasNextPage: false }
			});

			const result = await handler.handleWorkflowEdgeCases(
				mockTeamId,
				mockTaskMasterStatus
			);

			expect(result.edgeCaseHandling.configValidation.warnings).toContain(
				'Missing state types: completed'
			);
			expect(
				result.edgeCaseHandling.configValidation.recommendations
			).toContain(
				'Add workflow states for missing types to improve task status mapping'
			);
		});
	});

	describe('_applyAdvancedFallbacks', () => {
		const mockTeamId = 'team-123';

		test('should use semantic matching fallback', async () => {
			const mockStates = [
				{
					id: 'state-1',
					name: 'Backlog Items',
					type: 'unstarted',
					color: '#95a2b3',
					position: 0
				}
			];

			const mockStatesData = {
				states: mockStates,
				statesByType: { unstarted: mockStates }
			};

			const result = await handler._applyAdvancedFallbacks(
				mockTeamId,
				'pending',
				mockStatesData,
				{ isValid: true, warnings: [], recommendations: [] }
			);

			expect(result.success).toBe(true);
			expect(result.matchType).toBe('semantic-fallback');
			expect(result.fallbackUsed).toBe('semantic-matching');
			expect(result.uuid).toBe('state-1');
			expect(result.stateName).toBe('Backlog Items');
		});

		test('should use type-based matching fallback', async () => {
			const mockStates = [
				{
					id: 'state-1',
					name: 'Some Custom State',
					type: 'unstarted',
					color: '#95a2b3',
					position: 0
				}
			];

			const mockStatesData = {
				states: mockStates,
				statesByType: { unstarted: mockStates }
			};

			const result = await handler._applyAdvancedFallbacks(
				mockTeamId,
				'pending',
				mockStatesData,
				{ isValid: true, warnings: [], recommendations: [] }
			);

			expect(result.success).toBe(true);
			expect(result.matchType).toBe('type-based-fallback');
			expect(result.fallbackUsed).toBe('type-matching');
			expect(result.uuid).toBe('state-1');
			expect(result.warning).toContain('Using type-based fallback');
		});

		test('should use last resort fallback', async () => {
			const mockStates = [
				{
					id: 'state-1',
					name: 'Random State',
					type: 'custom',
					color: '#95a2b3',
					position: 0
				}
			];

			const mockStatesData = {
				states: mockStates,
				statesByType: { custom: mockStates }
			};

			const result = await handler._applyAdvancedFallbacks(
				mockTeamId,
				'pending',
				mockStatesData,
				{ isValid: true, warnings: [], recommendations: [] }
			);

			expect(result.success).toBe(true);
			expect(result.matchType).toBe('last-resort-fallback');
			expect(result.fallbackUsed).toBe('first-available-state');
			expect(result.uuid).toBe('state-1');
			expect(result.warning).toContain('Using last resort fallback');
		});

		test('should fail when all fallbacks are exhausted', async () => {
			const mockStatesData = {
				states: [], // No available states
				statesByType: {}
			};

			const result = await handler._applyAdvancedFallbacks(
				mockTeamId,
				'pending',
				mockStatesData,
				{ isValid: true, warnings: [], recommendations: [] }
			);

			expect(result.success).toBe(false);
			expect(result.error).toBe('All fallback mechanisms exhausted');
			expect(result.fallbacksAttempted).toEqual([
				'semantic-matching',
				'type-matching',
				'first-available-state'
			]);
		});
	});

	describe('_findSemanticStateMatch', () => {
		test('should find semantic match for pending status', () => {
			const mockStates = [
				{
					id: 'state-1',
					name: 'Backlog Items',
					type: 'unstarted'
				},
				{
					id: 'state-2',
					name: 'Work in Progress',
					type: 'started'
				}
			];

			const result = handler._findSemanticStateMatch(mockStates, 'pending');

			expect(result).toBeDefined();
			expect(result.id).toBe('state-1');
			expect(result.name).toBe('Backlog Items');
		});

		test('should find semantic match for in-progress status', () => {
			const mockStates = [
				{
					id: 'state-1',
					name: 'New Tasks',
					type: 'unstarted'
				},
				{
					id: 'state-2',
					name: 'Currently Working',
					type: 'started'
				}
			];

			const result = handler._findSemanticStateMatch(mockStates, 'in-progress');

			expect(result).toBeDefined();
			expect(result.id).toBe('state-2');
			expect(result.name).toBe('Currently Working');
		});

		test('should skip archived states', () => {
			const mockStates = [
				{
					id: 'state-1',
					name: 'Todo Items',
					type: 'unstarted',
					archivedAt: '2023-01-01T00:00:00.000Z'
				},
				{
					id: 'state-2',
					name: 'Backlog',
					type: 'unstarted'
				}
			];

			const result = handler._findSemanticStateMatch(mockStates, 'pending');

			expect(result).toBeDefined();
			expect(result.id).toBe('state-2');
			expect(result.name).toBe('Backlog');
		});

		test('should return null when no semantic match found', () => {
			const mockStates = [
				{
					id: 'state-1',
					name: 'Custom State A',
					type: 'unstarted'
				},
				{
					id: 'state-2',
					name: 'Custom State B',
					type: 'started'
				}
			];

			const result = handler._findSemanticStateMatch(mockStates, 'pending');

			expect(result).toBeNull();
		});
	});

	describe('_findTypeBasedMatch', () => {
		test('should find type-based match for pending status', () => {
			const mockStatesByType = {
				unstarted: [
					{
						id: 'state-1',
						name: 'Custom Todo',
						type: 'unstarted'
					}
				],
				started: [
					{
						id: 'state-2',
						name: 'Custom Progress',
						type: 'started'
					}
				]
			};

			const result = handler._findTypeBasedMatch(mockStatesByType, 'pending');

			expect(result).toBeDefined();
			expect(result.id).toBe('state-1');
			expect(result.type).toBe('unstarted');
		});

		test('should find type-based match for done status', () => {
			const mockStatesByType = {
				completed: [
					{
						id: 'state-1',
						name: 'Finished',
						type: 'completed'
					}
				]
			};

			const result = handler._findTypeBasedMatch(mockStatesByType, 'done');

			expect(result).toBeDefined();
			expect(result.id).toBe('state-1');
			expect(result.type).toBe('completed');
		});

		test('should skip archived states in type matching', () => {
			const mockStatesByType = {
				unstarted: [
					{
						id: 'state-1',
						name: 'Archived Todo',
						type: 'unstarted',
						archivedAt: '2023-01-01T00:00:00.000Z'
					},
					{
						id: 'state-2',
						name: 'Active Todo',
						type: 'unstarted'
					}
				]
			};

			const result = handler._findTypeBasedMatch(mockStatesByType, 'pending');

			expect(result).toBeDefined();
			expect(result.id).toBe('state-2');
			expect(result.name).toBe('Active Todo');
		});

		test('should return null when no type match found', () => {
			const mockStatesByType = {
				started: [
					{
						id: 'state-1',
						name: 'Some Started State',
						type: 'started'
					}
				]
			};

			const result = handler._findTypeBasedMatch(mockStatesByType, 'pending');

			expect(result).toBeNull();
		});
	});

	describe('_handleArchivedStates', () => {
		test('should detect archived states in default mappings', () => {
			const mockStatesData = {
				states: [
					{
						id: 'state-1',
						name: 'Todo',
						type: 'unstarted',
						archivedAt: '2023-01-01T00:00:00.000Z'
					},
					{
						id: 'state-2',
						name: 'In Progress',
						type: 'started'
					}
				]
			};

			const result = handler._handleArchivedStates(mockStatesData, 'pending');

			expect(result.hasArchivedStates).toBe(true);
			expect(result.archivedStateCount).toBe(1);
			expect(result.activeStateCount).toBe(1);
			expect(result.archivedDefaultMappings).toHaveLength(1);
			expect(result.archivedDefaultMappings[0].name).toBe('Todo');
			expect(result.shouldExcludeArchived).toBe(true);
			expect(result.recommendation).toContain(
				"Default mapping for 'pending' points to archived state(s)"
			);
		});

		test('should handle no archived states', () => {
			const mockStatesData = {
				states: [
					{
						id: 'state-1',
						name: 'Todo',
						type: 'unstarted'
					},
					{
						id: 'state-2',
						name: 'In Progress',
						type: 'started'
					}
				]
			};

			const result = handler._handleArchivedStates(mockStatesData, 'pending');

			expect(result.hasArchivedStates).toBe(false);
			expect(result.archivedStateCount).toBe(0);
			expect(result.activeStateCount).toBe(2);
			expect(result.archivedDefaultMappings).toHaveLength(0);
			expect(result.shouldExcludeArchived).toBe(false);
			expect(result.recommendation).toBeNull();
		});
	});

	describe('_validateWorkflowConfiguration', () => {
		test('should validate complete workflow configuration', async () => {
			const mockStatesData = {
				states: [
					{
						id: 'state-1',
						name: 'Todo',
						type: 'unstarted'
					},
					{
						id: 'state-2',
						name: 'In Progress',
						type: 'started'
					},
					{
						id: 'state-3',
						name: 'In Review',
						type: 'started'
					},
					{
						id: 'state-4',
						name: 'Done',
						type: 'completed'
					},
					{
						id: 'state-5',
						name: 'Canceled',
						type: 'canceled'
					},
					{
						id: 'state-6',
						name: 'Backlog',
						type: 'unstarted'
					}
				]
			};

			const result = await handler._validateWorkflowConfiguration(
				mockStatesData,
				'team-123'
			);

			expect(result.isValid).toBe(true);
			expect(result.issues).toHaveLength(0);
			// Should have minimal warnings since all TaskMaster statuses have default mappings
			expect(result.warnings.length).toBeLessThanOrEqual(1);
		});

		test('should detect missing required state types', async () => {
			const mockStatesData = {
				states: [
					{
						id: 'state-1',
						name: 'Todo',
						type: 'unstarted'
					}
					// Missing 'started' and 'completed' types
				]
			};

			const result = await handler._validateWorkflowConfiguration(
				mockStatesData,
				'team-123'
			);

			expect(result.warnings).toContain(
				'Missing state types: started, completed'
			);
			expect(result.recommendations).toContain(
				'Add workflow states for missing types to improve task status mapping'
			);
		});

		test('should detect unmapped TaskMaster statuses', async () => {
			const mockStatesData = {
				states: [
					{
						id: 'state-1',
						name: 'Custom State',
						type: 'unstarted'
					}
					// No default mappings available
				]
			};

			const result = await handler._validateWorkflowConfiguration(
				mockStatesData,
				'team-123'
			);

			expect(
				result.warnings.some((w) =>
					w.includes('TaskMaster statuses without default mappings')
				)
			).toBe(true);
			expect(result.recommendations).toContain(
				'Configure custom state mappings for unmapped TaskMaster statuses'
			);
		});
	});

	describe('_generateUserGuidance', () => {
		test('should generate comprehensive user guidance', () => {
			const mockStatesData = {
				states: [
					{
						id: 'state-1',
						name: 'Custom State 1',
						type: 'unstarted'
					},
					{
						id: 'state-2',
						name: 'Custom State 2',
						type: 'started'
					}
				]
			};

			const mockConfigValidation = {
				warnings: ['Missing state types: completed'],
				recommendations: ['Add workflow states for missing types']
			};

			const result = handler._generateUserGuidance(
				'team-123',
				'pending',
				mockStatesData,
				mockConfigValidation
			);

			expect(result.summary).toContain(
				"Unable to map TaskMaster status 'pending'"
			);
			expect(result.steps).toContain(
				"1. Review your Linear team's workflow states in the Linear app"
			);
			expect(result.availableStates).toHaveLength(2);
			expect(result.recommendedActions).toContain(
				'Address configuration warnings: Missing state types: completed'
			);
			expect(result.recommendedActions).toContain(
				'Consider creating Linear workflow states named: Todo or Backlog for automatic mapping'
			);
		});
	});
});
