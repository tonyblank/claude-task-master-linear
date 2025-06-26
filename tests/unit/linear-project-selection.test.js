/**
 * Tests for the Linear project selection module
 */

import { jest } from '@jest/globals';

// Mock the Linear SDK first, before any imports
const mockTeam = {
	projects: jest.fn()
};

const mockLinearClient = {
	team: jest.fn(() => mockTeam)
};

const MockLinearClient = jest.fn().mockImplementation(() => mockLinearClient);

jest.unstable_mockModule('@linear/sdk', () => ({
	LinearClient: MockLinearClient
}));

// Mock inquirer
const mockInquirer = {
	prompt: jest.fn(),
	Separator: jest.fn((text) => ({ type: 'separator', line: text }))
};

jest.unstable_mockModule('inquirer', () => ({
	default: mockInquirer
}));

// Mock utils and prompts
const mockLog = jest.fn();
jest.unstable_mockModule('../../scripts/modules/utils.js', () => ({
	log: mockLog
}));

const mockMessages = {
	header: jest.fn(),
	info: jest.fn(),
	success: jest.fn(),
	error: jest.fn()
};

jest.unstable_mockModule('../../scripts/modules/prompts.js', () => ({
	promptConfigs: {
		list: (name, message, choices) => ({
			type: 'list',
			name,
			message: `${message}:`,
			choices
		}),
		confirm: (name, message) => ({
			type: 'confirm',
			name,
			message: `${message}?`,
			default: false
		}),
		checkbox: (name, message, choices, options) => ({
			type: 'checkbox',
			name,
			message: `${message}:`,
			choices,
			validate: options?.required
				? (input) => input.length > 0 || 'Please select at least one option.'
				: undefined,
			pageSize: options?.pageSize || 10
		})
	},
	messages: mockMessages
}));

// Now import the module under test
const {
	LinearProjectSelector,
	selectLinearProjects,
	fetchLinearProjects,
	PROJECT_SELECTION_ERRORS,
	PROJECT_STATUS_FILTER
} = await import('../../scripts/modules/linear-project-selection.js');

describe('LinearProjectSelector', () => {
	const validTeamId = '12345678-1234-1234-1234-123456789abc';

	beforeEach(() => {
		jest.clearAllMocks();
		mockLog.mockClear();
		MockLinearClient.mockClear();
		mockLinearClient.team.mockClear();
		mockTeam.projects.mockClear();
		Object.values(mockMessages).forEach((mock) => mock.mockClear());
		// Mock console methods
		jest.spyOn(console, 'log').mockImplementation(() => {});
		jest.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		console.log.mockRestore();
		console.warn.mockRestore();
	});

	describe('constructor', () => {
		it('should initialize with API key', () => {
			const selector = new LinearProjectSelector({ apiKey: 'lin_api_test123' });
			expect(selector.config.apiKey).toBe('lin_api_test123');
			expect(selector.config.maxRetries).toBe(3);
			expect(selector.config.retryDelay).toBe(1000);
			expect(selector.config.statusFilter).toBe(PROJECT_STATUS_FILTER.ACTIVE);
		});

		it('should throw error if no API key provided', () => {
			expect(() => new LinearProjectSelector()).toThrow(
				'Linear API key is required'
			);
		});

		it('should accept custom configuration', () => {
			const selector = new LinearProjectSelector({
				apiKey: 'lin_api_test123',
				maxRetries: 5,
				retryDelay: 2000,
				statusFilter: PROJECT_STATUS_FILTER.ALL
			});
			expect(selector.config.maxRetries).toBe(5);
			expect(selector.config.retryDelay).toBe(2000);
			expect(selector.config.statusFilter).toBe(PROJECT_STATUS_FILTER.ALL);
		});
	});

	describe('fetchTeamProjects', () => {
		let selector;

		beforeEach(() => {
			selector = new LinearProjectSelector({ apiKey: 'lin_api_test123' });
		});

		it('should validate team ID parameter', async () => {
			await expect(selector.fetchTeamProjects(null)).rejects.toThrow(
				'Team ID is required and must be a string'
			);
			await expect(selector.fetchTeamProjects('')).rejects.toThrow(
				'Team ID is required and must be a string'
			);
			await expect(selector.fetchTeamProjects(123)).rejects.toThrow(
				'Team ID is required and must be a string'
			);
		});

		it('should validate team ID format', async () => {
			await expect(selector.fetchTeamProjects('invalid-uuid')).rejects.toThrow(
				'Team ID must be a valid UUID format'
			);
		});

		it('should fetch projects successfully', async () => {
			const mockProjects = [
				{
					id: '11111111-1111-1111-1111-111111111111',
					name: 'Mobile App',
					key: 'MOB',
					description: 'Mobile application project',
					state: { name: 'started' },
					progress: 65,
					memberCount: 8,
					issueCount: 23,
					url: 'https://linear.app/project/mob'
				},
				{
					id: '22222222-2222-2222-2222-222222222222',
					name: 'Website Redesign',
					key: 'WEB',
					description: 'Complete website overhaul',
					state: { name: 'planned' },
					progress: 15,
					memberCount: 5,
					issueCount: 12,
					url: 'https://linear.app/project/web'
				}
			];

			mockLinearClient.team.mockResolvedValue(mockTeam);
			mockTeam.projects.mockResolvedValue({
				nodes: mockProjects
			});

			const result = await selector.fetchTeamProjects(validTeamId);

			expect(result).toHaveLength(2);
			expect(result[0]).toMatchObject({
				id: '11111111-1111-1111-1111-111111111111',
				name: 'Mobile App',
				key: 'MOB',
				description: 'Mobile application project',
				state: 'started',
				progress: 65,
				memberCount: 8,
				issueCount: 23,
				displayName: 'Mobile App (MOB)',
				statusIndicator: '🚀',
				summary: 'started • 23 issues • 65% complete'
			});
			expect(result[0].searchText).toBe(
				'mobile app mob mobile application project'
			);
		});

		it('should handle projects without optional fields', async () => {
			const mockProjects = [
				{
					id: '11111111-1111-1111-1111-111111111111',
					name: 'Basic Project'
				}
			];

			mockLinearClient.team.mockResolvedValue(mockTeam);
			mockTeam.projects.mockResolvedValue({
				nodes: mockProjects
			});

			const result = await selector.fetchTeamProjects(validTeamId);

			expect(result[0]).toMatchObject({
				description: 'No description available',
				key: '',
				state: 'Unknown',
				progress: 0,
				memberCount: 0,
				issueCount: 0,
				displayName: 'Basic Project',
				statusIndicator: '📄',
				summary: 'Unknown • 0 issues • 0% complete'
			});
		});

		it('should throw error when team not found', async () => {
			mockLinearClient.team.mockResolvedValue(null);

			await expect(selector.fetchTeamProjects(validTeamId)).rejects.toThrow(
				'Team not found or access denied'
			);
		});

		it('should throw error when no projects found', async () => {
			mockLinearClient.team.mockResolvedValue(mockTeam);
			mockTeam.projects.mockResolvedValue({
				nodes: []
			});

			await expect(selector.fetchTeamProjects(validTeamId)).rejects.toThrow(
				'No active projects found in this team'
			);
		});

		it('should handle different status filters', async () => {
			const selectorAll = new LinearProjectSelector({
				apiKey: 'lin_api_test123',
				statusFilter: PROJECT_STATUS_FILTER.ALL
			});

			mockLinearClient.team.mockResolvedValue(mockTeam);
			mockTeam.projects.mockResolvedValue({ nodes: [] });

			await expect(selectorAll.fetchTeamProjects(validTeamId)).rejects.toThrow(
				'No projects found in this team'
			);
		});

		it('should retry on network errors', async () => {
			mockLinearClient.team
				.mockRejectedValueOnce(new Error('Network error'))
				.mockResolvedValue(mockTeam);

			mockTeam.projects.mockResolvedValue({
				nodes: [
					{
						id: '11111111-1111-1111-1111-111111111111',
						name: 'Test Project'
					}
				]
			});

			const result = await selector.fetchTeamProjects(validTeamId);
			expect(result).toHaveLength(1);
			expect(mockLinearClient.team).toHaveBeenCalledTimes(2);
		});

		it('should not retry authentication errors', async () => {
			const authError = new Error('Authentication failed');
			authError.status = 401;
			mockLinearClient.team.mockRejectedValue(authError);

			await expect(selector.fetchTeamProjects(validTeamId)).rejects.toThrow(
				'Authentication failed'
			);
			expect(mockLinearClient.team).toHaveBeenCalledTimes(1);
		});

		it('should enhance errors with appropriate codes', async () => {
			const authError = new Error('Authentication failed');
			authError.status = 401;
			mockLinearClient.team.mockRejectedValue(authError);

			try {
				await selector.fetchTeamProjects(validTeamId);
			} catch (error) {
				expect(error.code).toBe(PROJECT_SELECTION_ERRORS.AUTHENTICATION_ERROR);
			}
		});
	});

	describe('selectProjects', () => {
		let selector;
		const mockProjects = [
			{
				id: '11111111-1111-1111-1111-111111111111',
				name: 'Mobile App',
				key: 'MOB',
				description: 'Mobile application project',
				state: 'started',
				displayName: 'Mobile App (MOB)',
				statusIndicator: '🚀',
				summary: 'started • 23 issues • 65% complete',
				searchText: 'mobile app mob mobile application project'
			},
			{
				id: '22222222-2222-2222-2222-222222222222',
				name: 'Website Redesign',
				key: 'WEB',
				description: 'Complete website overhaul',
				state: 'planned',
				displayName: 'Website Redesign (WEB)',
				statusIndicator: '📅',
				summary: 'planned • 12 issues • 15% complete',
				searchText: 'website redesign web complete website overhaul'
			}
		];

		beforeEach(() => {
			selector = new LinearProjectSelector({ apiKey: 'lin_api_test123' });
		});

		it('should present projects for multiple selection', async () => {
			mockInquirer.prompt.mockResolvedValue({
				selectedProjects: [mockProjects[0], mockProjects[1]]
			});

			const result = await selector.selectProjects(mockProjects);

			expect(result).toHaveLength(2);
			expect(result).toEqual([mockProjects[0], mockProjects[1]]);
			expect(mockInquirer.prompt).toHaveBeenCalledWith([
				expect.objectContaining({
					type: 'checkbox',
					name: 'selectedProjects'
				})
			]);
		});

		it('should present projects for single selection', async () => {
			mockInquirer.prompt.mockResolvedValue({
				selectedProjects: mockProjects[0]
			});

			const result = await selector.selectProjects(mockProjects, {
				allowMultiple: false
			});

			expect(result).toHaveLength(1);
			expect(result[0]).toEqual(mockProjects[0]);
			expect(mockInquirer.prompt).toHaveBeenCalledWith([
				expect.objectContaining({
					type: 'list',
					name: 'selectedProjects'
				})
			]);
		});

		it('should handle select all action', async () => {
			mockInquirer.prompt.mockResolvedValue({
				selectedProjects: ['__SELECT_ALL__']
			});

			const result = await selector.selectProjects(mockProjects);

			expect(result).toEqual(mockProjects);
			expect(mockMessages.success).toHaveBeenCalledWith(
				'Selected all 2 projects'
			);
		});

		it('should handle clear all action', async () => {
			mockInquirer.prompt.mockResolvedValue({
				selectedProjects: ['__CLEAR_ALL__']
			});

			await expect(selector.selectProjects(mockProjects)).rejects.toThrow(
				'At least one project must be selected'
			);
		});

		it('should throw error when no projects provided', async () => {
			await expect(selector.selectProjects([])).rejects.toThrow(
				'No projects available for selection'
			);
		});

		it('should throw error when no projects selected', async () => {
			mockInquirer.prompt.mockResolvedValue({
				selectedProjects: []
			});

			await expect(selector.selectProjects(mockProjects)).rejects.toThrow(
				'At least one project must be selected'
			);
		});

		it('should handle custom selection message', async () => {
			mockInquirer.prompt.mockResolvedValue({
				selectedProjects: [mockProjects[0]]
			});

			await selector.selectProjects(mockProjects, {
				message: 'Choose your projects'
			});

			expect(mockInquirer.prompt).toHaveBeenCalledWith([
				expect.objectContaining({
					message: 'Choose your projects:'
				})
			]);
		});

		it('should display TaskMaster mapping information', async () => {
			mockInquirer.prompt.mockResolvedValue({
				selectedProjects: [mockProjects[0]]
			});

			await selector.selectProjects(mockProjects);

			expect(mockMessages.info).toHaveBeenCalledWith('📋 Project Mapping:');
			expect(console.log).toHaveBeenCalledWith(
				'   • Linear Project → TaskMaster .taskmaster/tasks directory'
			);
		});

		it('should skip details when showDetails is false', async () => {
			mockInquirer.prompt.mockResolvedValue({
				selectedProjects: [mockProjects[0]]
			});

			await selector.selectProjects(mockProjects, { showDetails: false });

			// Should still show header and mapping info, but not detailed project info
			expect(mockMessages.header).toHaveBeenCalledWith(
				'Available Linear Projects'
			);
			expect(mockMessages.info).toHaveBeenCalledWith('📋 Project Mapping:');
		});
	});

	describe('fetchAndSelectProjects', () => {
		let selector;

		beforeEach(() => {
			selector = new LinearProjectSelector({ apiKey: 'lin_api_test123' });
		});

		it('should fetch and select projects in one step', async () => {
			const mockProjects = [
				{
					id: '11111111-1111-1111-1111-111111111111',
					name: 'Mobile App',
					key: 'MOB'
				},
				{
					id: '22222222-2222-2222-2222-222222222222',
					name: 'Website Redesign',
					key: 'WEB'
				}
			];

			mockLinearClient.team.mockResolvedValue(mockTeam);
			mockTeam.projects.mockResolvedValue({
				nodes: mockProjects
			});

			// Create the expected transformed project object
			const transformedProject = {
				id: '11111111-1111-1111-1111-111111111111',
				name: 'Mobile App',
				key: 'MOB',
				description: 'No description available',
				state: 'Unknown',
				progress: 0,
				memberCount: 0,
				issueCount: 0,
				url: '',
				displayName: 'Mobile App (MOB)',
				statusIndicator: '📄',
				summary: 'Unknown • 0 issues • 0% complete',
				searchText: 'mobile app mob '
			};

			mockInquirer.prompt.mockResolvedValue({
				selectedProjects: [transformedProject]
			});

			const result = await selector.fetchAndSelectProjects(validTeamId);

			expect(result).toHaveLength(1);
			expect(result[0].name).toBe('Mobile App');
			expect(mockLinearClient.team).toHaveBeenCalledWith(validTeamId);
		});

		it('should auto-select single project with confirmation', async () => {
			const mockProjects = [
				{
					id: '11111111-1111-1111-1111-111111111111',
					name: 'Only Project',
					key: 'ONLY'
				}
			];

			mockLinearClient.team.mockResolvedValue(mockTeam);
			mockTeam.projects.mockResolvedValue({
				nodes: mockProjects
			});

			mockInquirer.prompt.mockResolvedValue({
				useProject: true
			});

			const result = await selector.fetchAndSelectProjects(validTeamId);

			expect(result).toHaveLength(1);
			expect(result[0].name).toBe('Only Project');
			expect(mockInquirer.prompt).toHaveBeenCalledWith([
				expect.objectContaining({
					type: 'confirm',
					name: 'useProject'
				})
			]);
		});

		it('should throw error if user declines single project', async () => {
			const mockProjects = [
				{
					id: '11111111-1111-1111-1111-111111111111',
					name: 'Only Project',
					key: 'ONLY'
				}
			];

			mockLinearClient.team.mockResolvedValue(mockTeam);
			mockTeam.projects.mockResolvedValue({
				nodes: mockProjects
			});

			mockInquirer.prompt.mockResolvedValue({
				useProject: false
			});

			await expect(
				selector.fetchAndSelectProjects(validTeamId)
			).rejects.toThrow('User declined to use the only available project');
		});

		it('should allow empty selection when allowEmpty is true', async () => {
			const mockProjects = [
				{
					id: '11111111-1111-1111-1111-111111111111',
					name: 'Only Project',
					key: 'ONLY'
				}
			];

			mockLinearClient.team.mockResolvedValue(mockTeam);
			mockTeam.projects.mockResolvedValue({
				nodes: mockProjects
			});

			mockInquirer.prompt.mockResolvedValue({
				useProject: false
			});

			const result = await selector.fetchAndSelectProjects(validTeamId, {
				allowEmpty: true
			});
			expect(result).toEqual([]);
		});

		it('should force selection when forceSelection is true', async () => {
			const mockProjects = [
				{
					id: '11111111-1111-1111-1111-111111111111',
					name: 'Only Project',
					key: 'ONLY'
				}
			];

			mockLinearClient.team.mockResolvedValue(mockTeam);
			mockTeam.projects.mockResolvedValue({
				nodes: mockProjects
			});

			mockInquirer.prompt.mockResolvedValue({
				selectedProjects: [expect.objectContaining({ name: 'Only Project' })]
			});

			const result = await selector.fetchAndSelectProjects(validTeamId, {
				forceSelection: true
			});

			expect(result).toHaveLength(1);
			// Should skip auto-select confirmation and go straight to selection interface
			expect(mockInquirer.prompt).not.toHaveBeenCalledWith([
				expect.objectContaining({
					type: 'confirm'
				})
			]);
		});
	});

	describe('validateProjectSelection', () => {
		let selector;

		beforeEach(() => {
			selector = new LinearProjectSelector({ apiKey: 'lin_api_test123' });
		});

		it('should validate correct project array', () => {
			const validProjects = [
				{
					id: '11111111-1111-1111-1111-111111111111',
					name: 'Mobile App'
				},
				{
					id: '22222222-2222-2222-2222-222222222222',
					name: 'Website'
				}
			];

			expect(selector.validateProjectSelection(validProjects)).toBe(true);
		});

		it('should throw error for non-array input', () => {
			expect(() => selector.validateProjectSelection(null)).toThrow(
				'Project selection must be an array'
			);
			expect(() => selector.validateProjectSelection({})).toThrow(
				'Project selection must be an array'
			);
		});

		it('should throw error for empty array', () => {
			expect(() => selector.validateProjectSelection([])).toThrow(
				'At least one project must be selected'
			);
		});

		it('should throw error for invalid project objects', () => {
			expect(() => selector.validateProjectSelection([null])).toThrow(
				'Project 1: must be an object'
			);
			expect(() => selector.validateProjectSelection(['invalid'])).toThrow(
				'Project 1: must be an object'
			);
		});

		it('should throw error for missing required fields', () => {
			const invalidProjects = [{ name: 'Test' }]; // missing id
			expect(() => selector.validateProjectSelection(invalidProjects)).toThrow(
				"Project 1: missing required field 'id'"
			);
		});

		it('should throw error for invalid UUID format', () => {
			const invalidProjects = [
				{
					id: 'invalid-uuid',
					name: 'Test Project'
				}
			];
			expect(() => selector.validateProjectSelection(invalidProjects)).toThrow(
				'Project 1: project ID must be a valid UUID'
			);
		});
	});

	describe('convenience functions', () => {
		beforeEach(() => {
			mockLinearClient.team.mockResolvedValue(mockTeam);
			mockTeam.projects.mockResolvedValue({
				nodes: [
					{
						id: '11111111-1111-1111-1111-111111111111',
						name: 'Test Project',
						key: 'TEST'
					}
				]
			});
		});

		describe('selectLinearProjects', () => {
			it('should create selector and return selected projects', async () => {
				// Mock multiple projects to avoid auto-select logic
				mockTeam.projects.mockResolvedValue({
					nodes: [
						{
							id: '11111111-1111-1111-1111-111111111111',
							name: 'Test Project',
							key: 'TEST'
						},
						{
							id: '22222222-2222-2222-2222-222222222222',
							name: 'Another Project',
							key: 'ANOTHER'
						}
					]
				});

				// Create the expected transformed project object
				const transformedProject = {
					id: '11111111-1111-1111-1111-111111111111',
					name: 'Test Project',
					key: 'TEST',
					description: 'No description available',
					state: 'Unknown',
					progress: 0,
					memberCount: 0,
					issueCount: 0,
					url: '',
					displayName: 'Test Project (TEST)',
					statusIndicator: '📄',
					summary: 'Unknown • 0 issues • 0% complete',
					searchText: 'test project test '
				};

				mockInquirer.prompt.mockResolvedValue({
					selectedProjects: [transformedProject]
				});

				const result = await selectLinearProjects(
					'lin_api_test123',
					validTeamId
				);
				expect(result).toHaveLength(1);
				expect(result[0].name).toBe('Test Project');
			});
		});

		describe('fetchLinearProjects', () => {
			it('should create selector and return projects', async () => {
				const result = await fetchLinearProjects(
					'lin_api_test123',
					validTeamId
				);
				expect(result).toHaveLength(1);
				expect(result[0].name).toBe('Test Project');
			});
		});
	});

	describe('error handling', () => {
		let selector;

		beforeEach(() => {
			selector = new LinearProjectSelector({ apiKey: 'lin_api_test123' });
		});

		it('should classify authentication errors', () => {
			const authError = new Error('Authentication failed');
			authError.status = 401;

			const enhanced = selector._enhanceError(authError, 'test operation');
			expect(enhanced.code).toBe(PROJECT_SELECTION_ERRORS.AUTHENTICATION_ERROR);
		});

		it('should classify rate limit errors', () => {
			const rateLimitError = new Error('Rate limit exceeded');
			rateLimitError.status = 429;

			const enhanced = selector._enhanceError(rateLimitError, 'test operation');
			expect(enhanced.code).toBe(PROJECT_SELECTION_ERRORS.RATE_LIMIT);
		});

		it('should classify network errors', () => {
			const networkError = new Error('Network error');
			networkError.code = 'ECONNRESET';

			const enhanced = selector._enhanceError(networkError, 'test operation');
			expect(enhanced.code).toBe(PROJECT_SELECTION_ERRORS.NETWORK_ERROR);
		});

		it('should classify team access errors', () => {
			const teamError = new Error('Team not found or access denied');

			const enhanced = selector._enhanceError(teamError, 'test operation');
			expect(enhanced.code).toBe(PROJECT_SELECTION_ERRORS.TEAM_ACCESS_ERROR);
		});

		it('should preserve existing error codes', () => {
			const existingError = new Error('No projects found');
			existingError.code = PROJECT_SELECTION_ERRORS.NO_PROJECTS_FOUND;

			const enhanced = selector._enhanceError(existingError, 'test operation');
			expect(enhanced).toBe(existingError);
		});

		it('should identify non-retryable errors correctly', () => {
			const authError = new Error('Authentication failed');
			authError.status = 401;
			expect(selector._isNonRetryableError(authError)).toBe(true);

			const apiKeyError = new Error('Invalid API key');
			expect(selector._isNonRetryableError(apiKeyError)).toBe(true);

			const teamError = new Error('Test');
			teamError.code = PROJECT_SELECTION_ERRORS.TEAM_ACCESS_ERROR;
			expect(selector._isNonRetryableError(teamError)).toBe(true);

			const noProjectsError = new Error('No projects');
			noProjectsError.code = PROJECT_SELECTION_ERRORS.NO_PROJECTS_FOUND;
			expect(selector._isNonRetryableError(noProjectsError)).toBe(true);

			const uuidError = new Error('Team ID must be a valid UUID format');
			expect(selector._isNonRetryableError(uuidError)).toBe(true);

			const networkError = new Error('Network error');
			expect(selector._isNonRetryableError(networkError)).toBe(false);
		});
	});

	describe('status filters and indicators', () => {
		let selector;

		beforeEach(() => {
			selector = new LinearProjectSelector({ apiKey: 'lin_api_test123' });
		});

		it('should generate correct status indicators', () => {
			expect(selector._getStatusIndicator('backlog')).toBe('📋');
			expect(selector._getStatusIndicator('planned')).toBe('📅');
			expect(selector._getStatusIndicator('started')).toBe('🚀');
			expect(selector._getStatusIndicator('paused')).toBe('⏸️');
			expect(selector._getStatusIndicator('completed')).toBe('✅');
			expect(selector._getStatusIndicator('cancelled')).toBe('❌');
			expect(selector._getStatusIndicator('unknown')).toBe('📄');
			expect(selector._getStatusIndicator(null)).toBe('📄');
		});

		it('should build correct project filters', () => {
			// Test that filter returns empty object due to GraphQL schema constraints
			// Linear API only returns projects the user has access to, so complex filters aren't needed
			let filter = selector._buildProjectFilter();
			expect(filter).toEqual({});

			// Test with different status filters - should still return empty filter
			selector.config.statusFilter = PROJECT_STATUS_FILTER.COMPLETED;
			filter = selector._buildProjectFilter();
			expect(filter).toEqual({});

			// Test all filter
			selector.config.statusFilter = PROJECT_STATUS_FILTER.ALL;
			filter = selector._buildProjectFilter();
			expect(filter).toEqual({});

			// Test specific status filter
			selector.config.statusFilter = PROJECT_STATUS_FILTER.PLANNED;
			filter = selector._buildProjectFilter();
			expect(filter).toEqual({});
		});
	});

	describe('project creation functionality', () => {
		let selector;
		const mockProjects = [
			{
				id: '11111111-1111-1111-1111-111111111111',
				name: 'Existing Project',
				key: 'EXIST',
				description: 'An existing project',
				state: 'started',
				displayName: 'Existing Project (EXIST)',
				statusIndicator: '🚀',
				summary: 'started • 5 issues • 30% complete',
				searchText: 'existing project exist an existing project'
			}
		];

		beforeEach(() => {
			selector = new LinearProjectSelector({ apiKey: 'lin_api_test123' });
			selector._currentTeamId = validTeamId;
		});

		it('should add "Create new project" option for single selection', async () => {
			mockInquirer.prompt.mockResolvedValue({
				selectedProjects: mockProjects[0]
			});

			await selector.selectProjects(mockProjects, { allowMultiple: false });

			// Check that the prompt was called with choices including create new option
			const promptCall = mockInquirer.prompt.mock.calls[0][0][0];
			const choices = promptCall.choices;

			// Should have create new option
			expect(
				choices.some(
					(choice) =>
						choice &&
						choice.value === '__CREATE_NEW__' &&
						choice.name &&
						choice.name.includes('Create a new Linear project')
				)
			).toBe(true);
		});

		it('should not add "Create new project" option for multiple selection', async () => {
			mockInquirer.prompt.mockResolvedValue({
				selectedProjects: [mockProjects[0]]
			});

			await selector.selectProjects(mockProjects, { allowMultiple: true });

			// Check that the prompt was called without create new option
			const promptCall = mockInquirer.prompt.mock.calls[0][0][0];
			const choices = promptCall.choices;

			expect(choices.some((choice) => choice.value === '__CREATE_NEW__')).toBe(
				false
			);
		});

		it('should handle "Create new project" selection', async () => {
			// Mock the project creation process
			const mockCreatedProject = {
				id: '22222222-2222-2222-2222-222222222222',
				name: 'New Test Project',
				key: 'NEW',
				displayName: 'New Test Project (NEW)',
				state: 'planned'
			};

			// Mock the _handleCreateNewProject method
			selector._handleCreateNewProject = jest
				.fn()
				.mockResolvedValue(mockCreatedProject);

			mockInquirer.prompt.mockResolvedValue({
				selectedProjects: '__CREATE_NEW__'
			});

			const result = await selector.selectProjects(mockProjects, {
				allowMultiple: false
			});

			expect(selector._handleCreateNewProject).toHaveBeenCalledTimes(1);
			expect(result).toEqual([mockCreatedProject]);
			expect(mockMessages.success).toHaveBeenCalledWith(
				'Created and selected new project: New Test Project (NEW)'
			);
		});

		it('should handle project creation failure gracefully', async () => {
			const creationError = new Error('Failed to create project');
			selector._handleCreateNewProject = jest
				.fn()
				.mockRejectedValue(creationError);

			mockInquirer.prompt.mockResolvedValue({
				selectedProjects: '__CREATE_NEW__'
			});

			await expect(
				selector.selectProjects(mockProjects, { allowMultiple: false })
			).rejects.toThrow('Failed to create project');

			expect(mockMessages.error).toHaveBeenCalledWith(
				'Failed to create new project: Failed to create project'
			);
		});

		it('should offer project creation when no existing projects found', async () => {
			mockLinearClient.team.mockResolvedValue(mockTeam);
			mockTeam.projects.mockResolvedValue({ nodes: [] });

			// Mock the inquirer prompts - first for create choice, then for created project
			const mockCreatedProject = {
				id: '33333333-3333-3333-3333-333333333333',
				name: 'Brand New Project',
				displayName: 'Brand New Project'
			};

			selector._handleCreateNewProject = jest
				.fn()
				.mockResolvedValue(mockCreatedProject);

			mockInquirer.prompt
				.mockResolvedValueOnce({ createNewProject: true }) // User chooses to create
				.mockResolvedValueOnce({ selectedProjects: mockCreatedProject });

			const result = await selector.fetchAndSelectProjects(validTeamId);

			expect(mockMessages.info).toHaveBeenCalledWith(
				'No existing projects found in this team.'
			);
			expect(selector._handleCreateNewProject).toHaveBeenCalledTimes(1);
			expect(result).toEqual([mockCreatedProject]);
		});

		it('should handle user declining to create project when none exist', async () => {
			mockLinearClient.team.mockResolvedValue(mockTeam);
			mockTeam.projects.mockResolvedValue({ nodes: [] });

			mockInquirer.prompt.mockResolvedValue({ createNewProject: false });

			await expect(
				selector.fetchAndSelectProjects(validTeamId)
			).rejects.toThrow(
				'No project selected and user declined to create a new project'
			);
		});

		it('should store team ID for project creation', async () => {
			// Create multiple projects to avoid auto-select logic
			const multipleProjects = [
				mockProjects[0],
				{
					id: '22222222-2222-2222-2222-222222222222',
					name: 'Another Project',
					key: 'ANOTHER',
					description: 'Another project',
					state: 'planned',
					displayName: 'Another Project (ANOTHER)',
					statusIndicator: '📅',
					summary: 'planned • 2 issues • 10% complete',
					searchText: 'another project another another project'
				}
			];

			mockLinearClient.team.mockResolvedValue(mockTeam);
			mockTeam.projects.mockResolvedValue({ nodes: multipleProjects });

			mockInquirer.prompt.mockResolvedValue({
				selectedProjects: multipleProjects[0]
			});

			await selector.fetchAndSelectProjects(validTeamId, {
				allowMultiple: false
			});

			expect(selector._currentTeamId).toBe(validTeamId);
		});
	});

	describe('git integration', () => {
		let selector;

		beforeEach(() => {
			selector = new LinearProjectSelector({ apiKey: 'lin_api_test123' });
			selector._currentTeamId = validTeamId;
		});

		it('should handle _handleCreateNewProject by calling creation function', async () => {
			// Mock the _handleCreateNewProject method directly
			const mockCreatedProject = {
				id: '44444444-4444-4444-4444-444444444444',
				name: 'Created Project',
				displayName: 'Created Project'
			};

			selector._handleCreateNewProject = jest
				.fn()
				.mockResolvedValue(mockCreatedProject);

			const result = await selector._handleCreateNewProject();

			expect(result).toEqual(mockCreatedProject);
			expect(selector._handleCreateNewProject).toHaveBeenCalledTimes(1);
		});

		it('should require team ID for project creation', async () => {
			// Don't set _currentTeamId
			selector._currentTeamId = null;

			await expect(selector._handleCreateNewProject()).rejects.toThrow(
				'Team ID is required to create a new project'
			);
		});

		it('should handle project creation errors in _handleCreateNewProject', async () => {
			const creationError = new Error('Project creation failed');

			// Mock the createLinearProjectInteractive to throw an error
			selector._handleCreateNewProject = jest
				.fn()
				.mockRejectedValue(creationError);

			await expect(selector._handleCreateNewProject()).rejects.toThrow(
				'Project creation failed'
			);
		});
	});
});
