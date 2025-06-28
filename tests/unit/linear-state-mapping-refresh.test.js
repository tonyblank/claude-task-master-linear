/**
 * @fileoverview Tests for Linear state mapping refresh mechanism
 * Tests the state mapping refresh functionality implemented in Task 6.8
 */

import { jest } from '@jest/globals';

// Mock the Linear SDK
const mockLinear = {
	workflowStates: jest.fn(),
	viewer: Promise.resolve({ name: 'Test User', email: 'test@example.com' })
};

// Mock LinearIntegrationHandler directly
const mockLinearIntegrationHandler = {
	_performInitialization: jest.fn(),
	clearWorkflowStatesCache: jest.fn(),
	queryWorkflowStates: jest.fn()
};

jest.mock(
	'../../scripts/modules/integrations/linear-integration-handler.js',
	() => ({
		LinearIntegrationHandler: jest.fn(() => mockLinearIntegrationHandler)
	})
);

// Mock the utils
jest.mock('../../scripts/modules/utils.js', () => ({
	log: jest.fn(),
	readJSON: jest.fn(),
	writeJSON: jest.fn(),
	getCurrentTag: jest.fn(() => 'master'),
	findProjectRoot: jest.fn(() => '/test/project')
}));

// Mock config manager functions
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
	getLinearStatusUuidMapping: jest.fn(() => ({})),
	setLinearStatusUuidMapping: jest.fn(),
	validateLinearStatusUuidMapping: jest.fn(),
	generateLinearStatusUuidMapping: jest.fn(),
	getLinearTeamId: jest.fn(() => 'team-123'),
	getLinearApiKey: jest.fn(() => 'lin_api_test_key')
};

jest.mock('../../scripts/modules/config-manager.js', () => mockConfigManager);

// Import the functions we're testing
import {
	refreshWorkflowStatesCache,
	detectMappingRefreshNeeds,
	getCurrentMappingConfiguration
} from '../../scripts/modules/linear-status-mapping-manager.js';

import { LinearIntegrationHandler } from '../../scripts/modules/integrations/linear-integration-handler.js';

import {
	refreshLinearMappingsTool,
	handleRefreshLinearMappings
} from '../../mcp-server/src/tools/refresh-linear-mappings.js';

// Use the mock functions directly
const {
	getLinearStatusMapping,
	getLinearStatusUuidMapping,
	setLinearStatusUuidMapping,
	getLinearTeamId,
	getLinearApiKey
} = mockConfigManager;

describe('Linear State Mapping Refresh - Task 6.8', () => {
	const mockTeamId = 'team-123';
	const mockProjectRoot = '/app';

	// Mock Linear workflow states response
	const mockWorkflowStatesResponse = {
		success: true,
		states: [
			{
				id: 'state-pending-uuid-1234',
				name: 'Todo',
				type: 'unstarted',
				color: '#e2e2e2',
				description: 'New tasks to be started'
			},
			{
				id: 'state-inprogress-uuid-5678',
				name: 'In Progress',
				type: 'started',
				color: '#5e6ad2',
				description: 'Work currently being done'
			},
			{
				id: 'state-review-uuid-9abc',
				name: 'In Review',
				type: 'started',
				color: '#f2c94c',
				description: 'Tasks under review'
			},
			{
				id: 'state-done-uuid-def0',
				name: 'Done',
				type: 'completed',
				color: '#0f973d',
				description: 'Completed tasks'
			},
			{
				id: 'state-cancelled-uuid-1357',
				name: 'Cancelled',
				type: 'canceled',
				color: '#95a2b3',
				description: 'Cancelled tasks'
			},
			{
				id: 'state-deferred-uuid-2468',
				name: 'Backlog',
				type: 'unstarted',
				color: '#a855f7',
				description: 'Deferred tasks in backlog'
			}
		]
	};

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

	beforeEach(() => {
		jest.clearAllMocks();

		// Setup default mock returns
		getLinearTeamId.mockReturnValue(mockTeamId);
		getLinearApiKey.mockReturnValue('lin_api_test_key');
		getLinearStatusMapping.mockReturnValue(mockNameMappings);
		getLinearStatusUuidMapping.mockReturnValue({});

		// Reset mock functions
		mockLinearIntegrationHandler._performInitialization.mockResolvedValue();
		mockLinearIntegrationHandler.clearWorkflowStatesCache.mockResolvedValue();
		mockLinearIntegrationHandler.queryWorkflowStates.mockResolvedValue(
			mockWorkflowStatesResponse
		);
	});

	describe('1. Refresh Mechanism Core Functionality', () => {
		test('should detect when no refresh is needed', async () => {
			// Set up mock responses
			mockLinearIntegrationHandler.queryWorkflowStates.mockResolvedValue(
				mockWorkflowStatesResponse
			);
			getLinearStatusUuidMapping.mockReturnValue(mockUuidMappings);

			const result = await refreshWorkflowStatesCache({
				projectRoot: mockProjectRoot,
				teamId: mockTeamId,
				forceRefresh: false,
				updateMappings: true,
				validateOnly: false
			});

			expect(result.success).toBe(true);
			expect(result.teamId).toBe(mockTeamId);
			expect(result.changeAnalysis.changesDetected).toBe(false);
			expect(
				mockLinearIntegrationHandler.queryWorkflowStates
			).toHaveBeenCalledWith(mockTeamId);
		});

		test('should force refresh by clearing cache when requested', async () => {
			// Using shared mockLinearIntegrationHandler

			// Mock already defined at module level

			await refreshWorkflowStatesCache({
				projectRoot: mockProjectRoot,
				teamId: mockTeamId,
				forceRefresh: true,
				updateMappings: false,
				validateOnly: false
			});

			expect(
				mockLinearIntegrationHandler.clearWorkflowStatesCache
			).toHaveBeenCalledWith(mockTeamId);
		});

		test('should handle missing team ID configuration', async () => {
			getLinearTeamId.mockReturnValue(null);

			const result = await refreshWorkflowStatesCache({
				projectRoot: mockProjectRoot
			});

			expect(result.success).toBe(false);
			expect(result.error).toContain('Linear team ID not configured');
		});

		test('should handle Linear API errors gracefully', async () => {
			// Configure mock to return error
			mockLinearIntegrationHandler.queryWorkflowStates.mockResolvedValue({
				success: false,
				error: 'API rate limit exceeded'
			});

			const result = await refreshWorkflowStatesCache({
				projectRoot: mockProjectRoot,
				teamId: mockTeamId
			});

			expect(result.success).toBe(false);
			expect(result.error).toContain('Failed to fetch workflow states');
		});
	});

	describe('2. Change Detection and Analysis', () => {
		test('should detect renamed states as safe updates', async () => {
			const renamedStatesResponse = {
				success: true,
				states: mockWorkflowStatesResponse.states.map((state) =>
					state.id === 'state-pending-uuid-1234'
						? { ...state, name: 'To Do' } // Renamed from 'Todo'
						: state
				)
			};

			// Configure mock to return renamed states
			mockLinearIntegrationHandler.queryWorkflowStates.mockResolvedValue(
				renamedStatesResponse
			);
			getLinearStatusUuidMapping.mockReturnValue(mockUuidMappings);

			const result = await refreshWorkflowStatesCache({
				projectRoot: mockProjectRoot,
				teamId: mockTeamId
			});

			expect(result.success).toBe(true);
			expect(result.changeAnalysis.changesDetected).toBe(true);
			expect(result.changeAnalysis.renamedStatesDetected).toHaveLength(1);
			expect(result.changeAnalysis.renamedStatesDetected[0]).toMatchObject({
				taskMasterStatus: 'pending',
				uuid: 'state-pending-uuid-1234',
				oldName: 'Todo',
				newName: 'To Do'
			});
		});

		test('should detect deleted states as breaking changes', async () => {
			const partialStatesResponse = {
				success: true,
				states: mockWorkflowStatesResponse.states.filter(
					(state) => state.id !== 'state-pending-uuid-1234'
				)
			};

			// Configure mock to return partial states (deleted state)
			mockLinearIntegrationHandler.queryWorkflowStates.mockResolvedValue(
				partialStatesResponse
			);
			getLinearStatusUuidMapping.mockReturnValue(mockUuidMappings);

			const result = await refreshWorkflowStatesCache({
				projectRoot: mockProjectRoot,
				teamId: mockTeamId
			});

			expect(result.success).toBe(true);
			expect(result.changeAnalysis.changesDetected).toBe(true);
			expect(result.changeAnalysis.breakingChanges).toHaveLength(1);
			expect(result.changeAnalysis.breakingChanges[0]).toMatchObject({
				type: 'deleted_or_changed_uuid',
				taskMasterStatus: 'pending',
				uuid: 'state-pending-uuid-1234'
			});
		});

		test('should detect new states that could be mapped', async () => {
			const extendedStatesResponse = {
				success: true,
				states: [
					...mockWorkflowStatesResponse.states,
					{
						id: 'state-new-uuid-9999',
						name: 'On Hold',
						type: 'unstarted',
						color: '#ff9500',
						description: 'Tasks temporarily on hold'
					}
				]
			};

			// Configure mock to return extended states (new state)
			mockLinearIntegrationHandler.queryWorkflowStates.mockResolvedValue(
				extendedStatesResponse
			);
			getLinearStatusUuidMapping.mockReturnValue(mockUuidMappings);

			const result = await refreshWorkflowStatesCache({
				projectRoot: mockProjectRoot,
				teamId: mockTeamId
			});

			expect(result.success).toBe(true);
			expect(result.changeAnalysis.changesDetected).toBe(true);
			expect(result.changeAnalysis.newStatesFound).toHaveLength(1);
			expect(result.changeAnalysis.newStatesFound[0]).toMatchObject({
				uuid: 'state-new-uuid-9999',
				name: 'On Hold',
				type: 'unstarted'
			});
		});
	});

	describe('3. Validation-Only Mode', () => {
		test('should validate without making changes when validateOnly is true', async () => {
			// Using shared mockLinearIntegrationHandler

			// Mock already defined at module level

			getLinearStatusUuidMapping.mockReturnValue(mockUuidMappings);

			const result = await refreshWorkflowStatesCache({
				projectRoot: mockProjectRoot,
				teamId: mockTeamId,
				validateOnly: true
			});

			expect(result.success).toBe(true);
			expect(result.validationOnly).toBe(true);
			expect(result.mappingsUpdated).toBe(false);
		});
	});

	describe('4. Refresh Need Detection', () => {
		test('should detect when refresh is needed due to incomplete configuration', async () => {
			// Mock incomplete configuration
			// Mock already defined at module level

			const result = await detectMappingRefreshNeeds({
				projectRoot: mockProjectRoot,
				teamId: mockTeamId
			});

			expect(result.refreshNeeded).toBe(true);
			expect(result.reasons).toContain('Only 3/6 statuses mapped');
		});

		test('should suggest periodic refresh when no immediate issues', async () => {
			// Mock already defined at module level

			const result = await detectMappingRefreshNeeds({
				projectRoot: mockProjectRoot,
				teamId: mockTeamId,
				cacheMaxAge: 30
			});

			expect(result.refreshNeeded).toBe(false);
			expect(result.recommendations[0]).toMatchObject({
				type: 'maintenance',
				message: expect.stringContaining('every 30 minutes')
			});
		});
	});

	describe('5. MCP Tool Integration', () => {
		test('should have correct tool definition structure', () => {
			expect(refreshLinearMappingsTool).toHaveProperty(
				'name',
				'refresh_linear_mappings'
			);
			expect(refreshLinearMappingsTool).toHaveProperty('description');
			expect(refreshLinearMappingsTool).toHaveProperty('inputSchema');
			expect(refreshLinearMappingsTool.inputSchema).toHaveProperty(
				'type',
				'object'
			);
			expect(refreshLinearMappingsTool.inputSchema).toHaveProperty(
				'properties'
			);
		});

		test('should handle detect operation through MCP tool', async () => {
			// Mock already defined at module level

			const result = await handleRefreshLinearMappings({
				projectRoot: mockProjectRoot,
				operation: 'detect',
				cacheMaxAge: 60
			});

			expect(result.success).toBe(true);
			expect(result.operation).toBe('detect');
			expect(result.refreshNeeded).toBe(true);
		});

		test('should handle refresh operation through MCP tool', async () => {
			// Mock already defined at module level

			const result = await handleRefreshLinearMappings({
				projectRoot: mockProjectRoot,
				operation: 'refresh',
				forceRefresh: true
			});

			expect(result.success).toBe(true);
			expect(result.operation).toBe('refresh');
			expect(result.summary).toContain('No changes detected');
		});

		test('should handle validate operation through MCP tool', async () => {
			// Mock already defined at module level

			const result = await handleRefreshLinearMappings({
				projectRoot: mockProjectRoot,
				operation: 'validate'
			});

			expect(result.success).toBe(true);
			expect(result.operation).toBe('validate');
			expect(result.summary).toContain('Validation passed');
		});

		test('should handle unknown operation gracefully', async () => {
			const result = await handleRefreshLinearMappings({
				operation: 'unknown'
			});

			expect(result.success).toBe(false);
			expect(result.error).toContain('Unknown operation: unknown');
		});

		test('should handle errors during tool execution', async () => {
			// Mock detectMappingRefreshNeeds to throw error by modifying the module mock
			jest.doMock(
				'../../scripts/modules/linear-status-mapping-manager.js',
				() => ({
					...jest.requireActual(
						'../../scripts/modules/linear-status-mapping-manager.js'
					),
					detectMappingRefreshNeeds: jest.fn(() => {
						throw new Error('Mock error');
					})
				})
			);

			const result = await handleRefreshLinearMappings({
				operation: 'detect'
			});

			expect(result.success).toBe(false);
			expect(result.error).toContain('Mock error');
		});
	});

	describe('6. Breaking Change Notifications', () => {
		test('should generate breaking change notifications for deleted states', async () => {
			// Configure mock to return empty states (all deleted)
			mockLinearIntegrationHandler.queryWorkflowStates.mockResolvedValue({
				success: true,
				states: [] // All states deleted
			});
			getLinearStatusUuidMapping.mockReturnValue(mockUuidMappings);

			const result = await refreshWorkflowStatesCache({
				projectRoot: mockProjectRoot,
				teamId: mockTeamId
			});

			expect(result.success).toBe(true);
			expect(result.notifications).toHaveLength(1);
			expect(result.notifications[0]).toMatchObject({
				type: 'breaking_change',
				message: 'Breaking changes detected in Linear workspace',
				action: 'Review changes and update mappings manually'
			});
		});

		test('should generate update notifications for safe changes', async () => {
			const renamedStatesResponse = {
				success: true,
				states: mockWorkflowStatesResponse.states.map((state) =>
					state.id === 'state-pending-uuid-1234'
						? { ...state, name: 'To Do' }
						: state
				)
			};

			// Configure mock to return renamed states
			mockLinearIntegrationHandler.queryWorkflowStates.mockResolvedValue(
				renamedStatesResponse
			);
			getLinearStatusUuidMapping.mockReturnValue(mockUuidMappings);

			const result = await refreshWorkflowStatesCache({
				projectRoot: mockProjectRoot,
				teamId: mockTeamId,
				updateMappings: true
			});

			expect(result.success).toBe(true);
			expect(result.mappingsUpdated).toBe(true);
			expect(result.notifications).toHaveLength(1);
			expect(result.notifications[0]).toMatchObject({
				type: 'mappings_updated',
				message: expect.stringContaining('Updated 1 status mappings')
			});
		});
	});

	describe('7. Error Handling and Edge Cases', () => {
		test('should handle LinearIntegrationHandler initialization failure', async () => {
			// Configure mock to throw initialization error
			mockLinearIntegrationHandler._performInitialization.mockRejectedValue(
				new Error('Failed to initialize handler')
			);

			const result = await refreshWorkflowStatesCache({
				projectRoot: mockProjectRoot,
				teamId: mockTeamId
			});

			expect(result.success).toBe(false);
			expect(result.error).toContain('Failed to initialize handler');
		});

		test('should handle missing Linear API key', async () => {
			getLinearApiKey.mockReturnValue(null);

			// Using shared mockLinearIntegrationHandler

			// Mock already defined at module level

			const result = await refreshWorkflowStatesCache({
				projectRoot: mockProjectRoot,
				teamId: mockTeamId
			});

			expect(result.success).toBe(false);
		});

		test('should handle partial workflow states response', async () => {
			const partialResponse = {
				success: true,
				states: [mockWorkflowStatesResponse.states[0]] // Only one state
			};

			// Configure mock to return partial response
			mockLinearIntegrationHandler.queryWorkflowStates.mockResolvedValue(
				partialResponse
			);
			getLinearStatusUuidMapping.mockReturnValue(mockUuidMappings);

			const result = await refreshWorkflowStatesCache({
				projectRoot: mockProjectRoot,
				teamId: mockTeamId
			});

			expect(result.success).toBe(true);
			expect(result.currentStatesCount).toBe(1);
			expect(result.changeAnalysis.breakingChanges.length).toBeGreaterThan(0);
		});
	});
});
