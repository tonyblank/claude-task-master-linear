/**
 * @fileoverview Tests for Linear State Mapping Selection Module
 * Tests the new state mapping functionality integrated into the setup wizard
 */

import { jest } from '@jest/globals';

// Mock dependencies
jest.unstable_mockModule('@linear/sdk', () => ({
	LinearClient: jest.fn()
}));

jest.unstable_mockModule('chalk', () => {
	const createChalkFunction = (color) => {
		const fn = jest.fn((str) => str);
		fn.bold = jest.fn((str) => str);
		return fn;
	};

	return {
		default: {
			cyan: createChalkFunction('cyan'),
			gray: createChalkFunction('gray'),
			green: createChalkFunction('green'),
			red: createChalkFunction('red'),
			yellow: createChalkFunction('yellow'),
			blue: createChalkFunction('blue'),
			magenta: createChalkFunction('magenta'),
			white: createChalkFunction('white'),
			bold: createChalkFunction('bold'),
			hex: jest.fn(() => jest.fn((str) => str))
		}
	};
});

jest.unstable_mockModule('inquirer', () => ({
	default: {
		prompt: jest.fn()
	}
}));

jest.unstable_mockModule('../../scripts/modules/utils.js', () => ({
	log: jest.fn()
}));

jest.unstable_mockModule('../../scripts/modules/prompts.js', () => ({
	promptConfigs: {},
	messages: {}
}));

// Import mocked modules
const { LinearClient } = await import('@linear/sdk');
const chalk = await import('chalk');
const inquirer = await import('inquirer');
const utils = await import('../../scripts/modules/utils.js');

// Import the module under test
const {
	LinearStateMappingSelector,
	selectLinearStateMappings,
	validateExistingStateMappings,
	TASKMASTER_STATUSES,
	STATE_MAPPING_ERRORS
} = await import('../../scripts/modules/linear-state-mapping-selection.js');

describe('LinearStateMappingSelector', () => {
	let mockLinearClient;
	let mockTeam;
	let mockStatesConnection;
	let consoleLogSpy;

	beforeEach(() => {
		jest.clearAllMocks();

		// Setup mock Linear client
		mockStatesConnection = {
			nodes: [
				{
					id: 'state-1',
					name: 'Todo',
					type: 'unstarted',
					color: '#ff0000',
					description: 'Tasks to be started',
					position: 1
				},
				{
					id: 'state-2',
					name: 'In Progress',
					type: 'started',
					color: '#00ff00',
					description: 'Tasks being worked on',
					position: 2
				},
				{
					id: 'state-3',
					name: 'Done',
					type: 'completed',
					color: '#0000ff',
					description: 'Completed tasks',
					position: 3
				},
				{
					id: 'state-4',
					name: 'Cancelled',
					type: 'canceled',
					color: '#333333',
					description: 'Cancelled tasks',
					position: 4
				}
			]
		};

		mockTeam = {
			id: 'team-123',
			name: 'Test Team',
			states: jest.fn().mockResolvedValue(mockStatesConnection)
		};

		mockLinearClient = {
			team: jest.fn().mockResolvedValue(mockTeam)
		};

		LinearClient.mockImplementation(() => mockLinearClient);

		// Mock console.log
		consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		consoleLogSpy.mockRestore();
	});

	describe('constructor', () => {
		it('should create instance with valid config', () => {
			const selector = new LinearStateMappingSelector({
				apiKey: 'test-api-key',
				teamId: 'team-123'
			});

			expect(selector.config.apiKey).toBe('test-api-key');
			expect(selector.config.teamId).toBe('team-123');
			expect(selector.config.maxRetries).toBe(3);
			expect(LinearClient).toHaveBeenCalledWith({ apiKey: 'test-api-key' });
		});

		it('should throw error if API key is missing', () => {
			expect(() => {
				new LinearStateMappingSelector({ teamId: 'team-123' });
			}).toThrow('Linear API key is required');
		});

		it('should throw error if team ID is missing', () => {
			expect(() => {
				new LinearStateMappingSelector({ apiKey: 'test-api-key' });
			}).toThrow('Linear team ID is required');
		});

		it('should use custom retry configuration', () => {
			const selector = new LinearStateMappingSelector({
				apiKey: 'test-api-key',
				teamId: 'team-123',
				maxRetries: 5,
				retryDelay: 2000
			});

			expect(selector.config.maxRetries).toBe(5);
			expect(selector.config.retryDelay).toBe(2000);
		});
	});

	describe('fetchWorkflowStates', () => {
		it('should fetch and format workflow states successfully', async () => {
			const selector = new LinearStateMappingSelector({
				apiKey: 'test-api-key',
				teamId: 'team-123'
			});

			const states = await selector.fetchWorkflowStates();

			expect(mockLinearClient.team).toHaveBeenCalledWith('team-123');
			expect(mockTeam.states).toHaveBeenCalledWith({
				first: 100,
				includeArchived: false
			});

			expect(states).toHaveLength(4);
			expect(states[0]).toEqual({
				id: 'state-1',
				name: 'Todo',
				type: 'unstarted',
				color: '#ff0000',
				description: 'Tasks to be started',
				position: 1
			});

			// Verify states are sorted by position
			expect(states.map((s) => s.position)).toEqual([1, 2, 3, 4]);
		});

		it('should handle team not found error', async () => {
			mockLinearClient.team.mockResolvedValue(null);

			const selector = new LinearStateMappingSelector({
				apiKey: 'test-api-key',
				teamId: 'team-123'
			});

			await expect(selector.fetchWorkflowStates()).rejects.toThrow(
				'Team team-123 not found'
			);
		});

		it('should handle no states found', async () => {
			mockStatesConnection.nodes = [];

			const selector = new LinearStateMappingSelector({
				apiKey: 'test-api-key',
				teamId: 'team-123'
			});

			await expect(selector.fetchWorkflowStates()).rejects.toThrow(
				'No workflow states found for this team'
			);
		});

		it('should retry on transient errors', async () => {
			const selector = new LinearStateMappingSelector({
				apiKey: 'test-api-key',
				teamId: 'team-123',
				maxRetries: 2,
				retryDelay: 10
			});

			// First call fails, second succeeds
			mockLinearClient.team
				.mockRejectedValueOnce(new Error('Network timeout'))
				.mockResolvedValueOnce(mockTeam);

			const states = await selector.fetchWorkflowStates();

			expect(mockLinearClient.team).toHaveBeenCalledTimes(2);
			expect(states).toHaveLength(4);
		});

		it('should not retry on authentication errors', async () => {
			const selector = new LinearStateMappingSelector({
				apiKey: 'test-api-key',
				teamId: 'team-123',
				maxRetries: 3
			});

			const authError = new Error('authentication failed');
			mockLinearClient.team.mockRejectedValue(authError);

			await expect(selector.fetchWorkflowStates()).rejects.toThrow(
				'Authentication failed: authentication failed'
			);
			expect(mockLinearClient.team).toHaveBeenCalledTimes(1);
		});
	});

	describe('selectStateMappings', () => {
		it('should interactively select state mappings', async () => {
			const selector = new LinearStateMappingSelector({
				apiKey: 'test-api-key',
				teamId: 'team-123'
			});

			const mockStates = [
				{
					id: 'state-1',
					name: 'Todo',
					type: 'unstarted',
					color: '#ff0000',
					description: 'To do'
				},
				{
					id: 'state-2',
					name: 'In Progress',
					type: 'started',
					color: '#00ff00',
					description: 'Working'
				},
				{
					id: 'state-3',
					name: 'Done',
					type: 'completed',
					color: '#0000ff',
					description: 'Completed'
				}
			];

			// Mock user selections for each TaskMaster status
			inquirer.default.prompt
				.mockResolvedValueOnce({ selectedState: mockStates[0] }) // pending
				.mockResolvedValueOnce({ selectedState: mockStates[1] }) // in-progress
				.mockResolvedValueOnce({ selectedState: mockStates[1] }) // review
				.mockResolvedValueOnce({ selectedState: mockStates[2] }) // done
				.mockResolvedValueOnce({ selectedState: null }) // cancelled (skip)
				.mockResolvedValueOnce({ selectedState: mockStates[0] }); // deferred

			const mappings = await selector.selectStateMappings(mockStates);

			expect(mappings.name).toEqual({
				pending: 'Todo',
				'in-progress': 'In Progress',
				review: 'In Progress',
				done: 'Done',
				deferred: 'Todo'
			});

			expect(mappings.uuid).toEqual({
				pending: 'state-1',
				'in-progress': 'state-2',
				review: 'state-2',
				done: 'state-3',
				deferred: 'state-1'
			});

			expect(inquirer.default.prompt).toHaveBeenCalledTimes(6);
		});

		it('should display suggested states with star indicators', async () => {
			const selector = new LinearStateMappingSelector({
				apiKey: 'test-api-key',
				teamId: 'team-123'
			});

			const mockStates = [
				{
					id: 'state-1',
					name: 'Todo',
					type: 'unstarted',
					color: '#ff0000',
					description: 'To do'
				}
			];

			inquirer.default.prompt.mockResolvedValue({ selectedState: null });

			await selector.selectStateMappings(mockStates);

			// Verify that inquirer was called the correct number of times (once for each TaskMaster status)
			expect(inquirer.default.prompt).toHaveBeenCalledTimes(6); // 6 TaskMaster statuses
		});
	});

	describe('validateMappings', () => {
		it('should validate UUID mappings successfully', () => {
			const selector = new LinearStateMappingSelector({
				apiKey: 'test-api-key',
				teamId: 'team-123'
			});

			const mappings = {
				uuid: {
					pending: 'state-1',
					'in-progress': 'state-2',
					done: 'state-3'
				},
				name: {
					pending: 'Todo',
					'in-progress': 'In Progress',
					done: 'Done'
				}
			};

			const workflowStates = [
				{ id: 'state-1', name: 'Todo' },
				{ id: 'state-2', name: 'In Progress' },
				{ id: 'state-3', name: 'Done' }
			];

			const validation = selector.validateMappings(mappings, workflowStates);

			expect(validation.isValid).toBe(true);
			expect(validation.errors).toHaveLength(0);
			expect(validation.coverage).toBe(50); // 3 out of 6 statuses mapped
		});

		it('should detect invalid UUID mappings', () => {
			const selector = new LinearStateMappingSelector({
				apiKey: 'test-api-key',
				teamId: 'team-123'
			});

			const mappings = {
				uuid: {
					pending: 'invalid-uuid',
					done: 'state-3'
				}
			};

			const workflowStates = [{ id: 'state-3', name: 'Done' }];

			const validation = selector.validateMappings(mappings, workflowStates);

			expect(validation.isValid).toBe(false);
			expect(validation.errors).toContain(
				'Invalid UUID mapping for pending: invalid-uuid not found'
			);
		});

		it('should warn about missing name mappings when UUID exists', () => {
			const selector = new LinearStateMappingSelector({
				apiKey: 'test-api-key',
				teamId: 'team-123'
			});

			const mappings = {
				uuid: {
					pending: 'state-1'
				},
				name: {
					pending: 'Non-existent State'
				}
			};

			const workflowStates = [{ id: 'state-1', name: 'Todo' }];

			const validation = selector.validateMappings(mappings, workflowStates);

			expect(validation.warnings).toContain(
				'Name mapping for pending: "Non-existent State" not found (UUID mapping available)'
			);
		});

		it('should detect no mappings configured', () => {
			const selector = new LinearStateMappingSelector({
				apiKey: 'test-api-key',
				teamId: 'team-123'
			});

			const mappings = { uuid: {}, name: {} };
			const workflowStates = [];

			const validation = selector.validateMappings(mappings, workflowStates);

			expect(validation.isValid).toBe(false);
			expect(validation.errors).toContain('No state mappings configured');
		});
	});

	describe('error handling', () => {
		it('should classify authentication errors correctly', () => {
			const selector = new LinearStateMappingSelector({
				apiKey: 'test-api-key',
				teamId: 'team-123'
			});

			const authError = new Error('authentication failed');
			const classified = selector._handleError(authError);

			expect(classified.type).toBe(STATE_MAPPING_ERRORS.AUTHENTICATION_ERROR);
			expect(classified.message).toContain('Authentication failed');
		});

		it('should classify rate limit errors correctly', () => {
			const selector = new LinearStateMappingSelector({
				apiKey: 'test-api-key',
				teamId: 'team-123'
			});

			const rateLimitError = new Error('rate limit exceeded');
			const classified = selector._handleError(rateLimitError);

			expect(classified.type).toBe(STATE_MAPPING_ERRORS.RATE_LIMIT);
			expect(classified.message).toContain('Rate limit exceeded');
		});

		it('should classify network errors correctly', () => {
			const selector = new LinearStateMappingSelector({
				apiKey: 'test-api-key',
				teamId: 'team-123'
			});

			const networkError = new Error('network timeout');
			const classified = selector._handleError(networkError);

			expect(classified.type).toBe(STATE_MAPPING_ERRORS.NETWORK_ERROR);
			expect(classified.message).toContain('Network error');
		});
	});
});

describe('selectLinearStateMappings', () => {
	let mockSpinner;

	beforeEach(() => {
		jest.clearAllMocks();

		mockSpinner = {
			stop: jest.fn()
		};

		// Mock successful workflow state fetching
		const mockStatesConnection = {
			nodes: [
				{
					id: 'state-1',
					name: 'Todo',
					type: 'unstarted',
					color: '#ff0000',
					description: 'To do',
					position: 1
				}
			]
		};

		const mockTeam = {
			states: jest.fn().mockResolvedValue(mockStatesConnection)
		};

		const mockLinearClient = {
			team: jest.fn().mockResolvedValue(mockTeam)
		};

		LinearClient.mockImplementation(() => mockLinearClient);

		// Mock user interaction
		inquirer.default.prompt.mockResolvedValue({ selectedState: null });
	});

	it('should stop spinner and return successful result', async () => {
		const result = await selectLinearStateMappings('test-api-key', 'team-123', {
			spinner: mockSpinner
		});

		expect(mockSpinner.stop).toHaveBeenCalled();
		expect(result.success).toBe(true);
		expect(result.mappings).toBeDefined();
		expect(result.workflowStates).toBeDefined();
		expect(result.validation).toBeDefined();
	});

	it('should handle no workflow states found', async () => {
		const mockStatesConnection = { nodes: [] };
		const mockTeam = {
			states: jest.fn().mockResolvedValue(mockStatesConnection)
		};
		const mockLinearClient = {
			team: jest.fn().mockResolvedValue(mockTeam)
		};
		LinearClient.mockImplementation(() => mockLinearClient);

		const result = await selectLinearStateMappings('test-api-key', 'team-123', {
			spinner: mockSpinner
		});

		expect(mockSpinner.stop).toHaveBeenCalled();
		expect(result.success).toBe(false);
		expect(result.error).toContain('No workflow states found');
	});

	it('should provide retry option on validation errors', async () => {
		// Mock a scenario where validation fails initially
		inquirer.default.prompt
			.mockResolvedValueOnce({
				selectedState: { id: 'invalid', name: 'Invalid' }
			}) // pending
			.mockResolvedValueOnce({ selectedState: null }) // in-progress
			.mockResolvedValueOnce({ selectedState: null }) // review
			.mockResolvedValueOnce({ selectedState: null }) // done
			.mockResolvedValueOnce({ selectedState: null }) // cancelled
			.mockResolvedValueOnce({ selectedState: null }) // deferred
			.mockResolvedValueOnce({ retry: false }); // retry prompt

		const result = await selectLinearStateMappings('test-api-key', 'team-123');

		expect(result.success).toBe(true); // Should still succeed even with incomplete mappings
	});

	it('should skip validation when requested', async () => {
		const result = await selectLinearStateMappings('test-api-key', 'team-123', {
			skipValidation: true
		});

		expect(result.success).toBe(true);
		expect(result.validation.isValid).toBe(true); // Default validation result
	});
});

describe('validateExistingStateMappings', () => {
	beforeEach(() => {
		jest.clearAllMocks();

		// Mock successful workflow state fetching
		const mockStatesConnection = {
			nodes: [
				{
					id: 'state-1',
					name: 'Todo',
					type: 'unstarted',
					color: '#ff0000',
					description: 'To do',
					position: 1
				},
				{
					id: 'state-2',
					name: 'Done',
					type: 'completed',
					color: '#00ff00',
					description: 'Completed',
					position: 2
				}
			]
		};

		const mockTeam = {
			states: jest.fn().mockResolvedValue(mockStatesConnection)
		};

		const mockLinearClient = {
			team: jest.fn().mockResolvedValue(mockTeam)
		};

		LinearClient.mockImplementation(() => mockLinearClient);
	});

	it('should validate existing mappings successfully', async () => {
		const existingMappings = {
			uuid: {
				pending: 'state-1',
				done: 'state-2'
			},
			name: {
				pending: 'Todo',
				done: 'Done'
			}
		};

		const result = await validateExistingStateMappings(
			'test-api-key',
			'team-123',
			existingMappings
		);

		expect(result.success).toBe(true);
		expect(result.validation).toBeDefined();
		expect(result.workflowStates).toBeDefined();
	});

	it('should handle validation errors', async () => {
		const mockLinearClient = {
			team: jest.fn().mockRejectedValue(new Error('API Error'))
		};
		LinearClient.mockImplementation(() => mockLinearClient);

		const result = await validateExistingStateMappings(
			'test-api-key',
			'team-123',
			{}
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain('API Error');
	});
});

describe('TASKMASTER_STATUSES', () => {
	it('should define all required TaskMaster statuses', () => {
		const expectedStatuses = [
			'pending',
			'in-progress',
			'review',
			'done',
			'cancelled',
			'deferred'
		];

		expectedStatuses.forEach((status) => {
			expect(TASKMASTER_STATUSES[status]).toBeDefined();
			expect(TASKMASTER_STATUSES[status].name).toBe(status);
			expect(TASKMASTER_STATUSES[status].displayName).toBeDefined();
			expect(TASKMASTER_STATUSES[status].description).toBeDefined();
			expect(TASKMASTER_STATUSES[status].suggestedLinearTypes).toBeDefined();
			expect(
				Array.isArray(TASKMASTER_STATUSES[status].suggestedLinearTypes)
			).toBe(true);
		});
	});

	it('should have appropriate Linear type suggestions', () => {
		expect(TASKMASTER_STATUSES.pending.suggestedLinearTypes).toContain(
			'unstarted'
		);
		expect(TASKMASTER_STATUSES['in-progress'].suggestedLinearTypes).toContain(
			'started'
		);
		expect(TASKMASTER_STATUSES.done.suggestedLinearTypes).toContain(
			'completed'
		);
		expect(TASKMASTER_STATUSES.cancelled.suggestedLinearTypes).toContain(
			'canceled'
		);
	});
});
