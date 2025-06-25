/**
 * Tests for the Linear team selection module
 */

import { jest } from '@jest/globals';

// Mock the Linear SDK first, before any imports
const mockLinearClient = {
	teams: jest.fn()
};

const MockLinearClient = jest.fn().mockImplementation(() => mockLinearClient);

jest.unstable_mockModule('@linear/sdk', () => ({
	LinearClient: MockLinearClient
}));

// Mock inquirer
const mockInquirer = {
	prompt: jest.fn()
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
		})
	},
	messages: mockMessages
}));

// Now import the module under test
const {
	LinearTeamSelector,
	selectLinearTeam,
	fetchLinearTeams,
	TEAM_SELECTION_ERRORS
} = await import('../../scripts/modules/linear-team-selection.js');

describe('LinearTeamSelector', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockLog.mockClear();
		MockLinearClient.mockClear();
		mockLinearClient.teams.mockClear();
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
			const selector = new LinearTeamSelector({ apiKey: 'lin_api_test123' });
			expect(selector.config.apiKey).toBe('lin_api_test123');
			expect(selector.config.maxRetries).toBe(3);
			expect(selector.config.retryDelay).toBe(1000);
		});

		it('should throw error if no API key provided', () => {
			expect(() => new LinearTeamSelector()).toThrow(
				'Linear API key is required'
			);
		});

		it('should accept custom configuration', () => {
			const selector = new LinearTeamSelector({
				apiKey: 'lin_api_test123',
				maxRetries: 5,
				retryDelay: 2000
			});
			expect(selector.config.maxRetries).toBe(5);
			expect(selector.config.retryDelay).toBe(2000);
		});
	});

	describe('fetchTeams', () => {
		let selector;

		beforeEach(() => {
			selector = new LinearTeamSelector({ apiKey: 'lin_api_test123' });
		});

		it('should fetch teams successfully', async () => {
			const mockTeams = [
				{
					id: '12345678-1234-1234-1234-123456789abc',
					name: 'Engineering',
					key: 'ENG',
					description: 'Engineering team',
					memberCount: 10,
					projectCount: 5
				},
				{
					id: '87654321-4321-4321-4321-cba987654321',
					name: 'Design',
					key: 'DES',
					description: 'Design team',
					memberCount: 3,
					projectCount: 2
				}
			];

			mockLinearClient.teams.mockResolvedValue({
				nodes: mockTeams
			});

			const result = await selector.fetchTeams();

			expect(result).toHaveLength(2);
			expect(result[0]).toMatchObject({
				id: '12345678-1234-1234-1234-123456789abc',
				name: 'Engineering',
				key: 'ENG',
				description: 'Engineering team',
				displayName: 'Engineering (ENG)',
				memberCount: 10,
				projectCount: 5
			});
			expect(result[0].searchText).toBe('engineering eng engineering team');
		});

		it('should handle teams without descriptions', async () => {
			const mockTeams = [
				{
					id: '12345678-1234-1234-1234-123456789abc',
					name: 'Engineering',
					key: 'ENG'
				}
			];

			mockLinearClient.teams.mockResolvedValue({
				nodes: mockTeams
			});

			const result = await selector.fetchTeams();

			expect(result[0].description).toBe('No description available');
			expect(result[0].memberCount).toBe(0);
		});

		it('should throw error when no teams found', async () => {
			mockLinearClient.teams.mockResolvedValue({
				nodes: []
			});

			await expect(selector.fetchTeams()).rejects.toThrow(
				'No teams found or user has no team access'
			);
		});

		it('should retry on network errors', async () => {
			mockLinearClient.teams
				.mockRejectedValueOnce(new Error('Network error'))
				.mockResolvedValue({
					nodes: [
						{
							id: '12345678-1234-1234-1234-123456789abc',
							name: 'Engineering',
							key: 'ENG'
						}
					]
				});

			const result = await selector.fetchTeams();
			expect(result).toHaveLength(1);
			expect(mockLinearClient.teams).toHaveBeenCalledTimes(2);
		});

		it('should not retry authentication errors', async () => {
			const authError = new Error('Authentication failed');
			authError.status = 401;
			mockLinearClient.teams.mockRejectedValue(authError);

			await expect(selector.fetchTeams()).rejects.toThrow(
				'Authentication failed'
			);
			expect(mockLinearClient.teams).toHaveBeenCalledTimes(1);
		});

		it('should enhance errors with appropriate codes', async () => {
			const authError = new Error('Authentication failed');
			authError.status = 401;
			mockLinearClient.teams.mockRejectedValue(authError);

			try {
				await selector.fetchTeams();
			} catch (error) {
				expect(error.code).toBe(TEAM_SELECTION_ERRORS.AUTHENTICATION_ERROR);
			}
		});
	});

	describe('selectTeam', () => {
		let selector;
		const mockTeams = [
			{
				id: '12345678-1234-1234-1234-123456789abc',
				name: 'Engineering',
				key: 'ENG',
				description: 'Engineering team',
				displayName: 'Engineering (ENG)',
				searchText: 'engineering eng engineering team'
			},
			{
				id: '87654321-4321-4321-4321-cba987654321',
				name: 'Design',
				key: 'DES',
				description: 'Design team',
				displayName: 'Design (DES)',
				searchText: 'design des design team'
			}
		];

		beforeEach(() => {
			selector = new LinearTeamSelector({ apiKey: 'lin_api_test123' });
		});

		it('should present teams for selection', async () => {
			mockInquirer.prompt.mockResolvedValue({
				selectedTeam: mockTeams[0]
			});

			const result = await selector.selectTeam(mockTeams);

			expect(result).toEqual(mockTeams[0]);
			expect(mockInquirer.prompt).toHaveBeenCalledWith([
				expect.objectContaining({
					type: 'list',
					name: 'selectedTeam',
					choices: expect.arrayContaining([
						expect.objectContaining({
							value: mockTeams[0],
							short: 'Engineering (ENG)'
						})
					])
				})
			]);
		});

		it('should throw error when no teams provided', async () => {
			await expect(selector.selectTeam([])).rejects.toThrow(
				'No teams available for selection'
			);
		});

		it('should throw error when no team selected', async () => {
			mockInquirer.prompt.mockResolvedValue({
				selectedTeam: null
			});

			await expect(selector.selectTeam(mockTeams)).rejects.toThrow(
				'No team selected'
			);
		});

		it('should handle custom selection message', async () => {
			mockInquirer.prompt.mockResolvedValue({
				selectedTeam: mockTeams[0]
			});

			await selector.selectTeam(mockTeams, { message: 'Choose your team' });

			expect(mockInquirer.prompt).toHaveBeenCalledWith([
				expect.objectContaining({
					message: 'Choose your team:'
				})
			]);
		});

		it('should use autocomplete for many teams', async () => {
			const manyTeams = Array.from({ length: 10 }, (_, i) => ({
				id: `${i}2345678-1234-1234-1234-123456789abc`,
				name: `Team ${i}`,
				key: `T${i}`,
				description: `Team ${i} description`,
				displayName: `Team ${i} (T${i})`,
				searchText: `team ${i} t${i} team ${i} description`
			}));

			mockInquirer.prompt.mockResolvedValue({
				selectedTeam: manyTeams[0]
			});

			await selector.selectTeam(manyTeams);

			expect(mockInquirer.prompt).toHaveBeenCalledWith([
				expect.objectContaining({
					type: 'autocomplete'
				})
			]);
		});
	});

	describe('fetchAndSelectTeam', () => {
		let selector;

		beforeEach(() => {
			selector = new LinearTeamSelector({ apiKey: 'lin_api_test123' });
		});

		it('should fetch and select team in one step', async () => {
			const mockTeams = [
				{
					id: '12345678-1234-1234-1234-123456789abc',
					name: 'Engineering',
					key: 'ENG',
					description: 'Engineering team',
					memberCount: 10,
					projectCount: 5
				},
				{
					id: '87654321-4321-4321-4321-cba987654321',
					name: 'Design',
					key: 'DES',
					description: 'Design team',
					memberCount: 3,
					projectCount: 2
				}
			];

			mockLinearClient.teams.mockResolvedValue({
				nodes: mockTeams
			});

			// Create the expected transformed team object
			const transformedTeam = {
				id: '12345678-1234-1234-1234-123456789abc',
				name: 'Engineering',
				key: 'ENG',
				description: 'Engineering team',
				memberCount: 10,
				projectCount: 5,
				displayName: 'Engineering (ENG)',
				searchText: 'engineering eng engineering team'
			};

			mockInquirer.prompt.mockResolvedValue({
				selectedTeam: transformedTeam
			});

			const result = await selector.fetchAndSelectTeam();

			expect(result.name).toBe('Engineering');
			expect(mockLinearClient.teams).toHaveBeenCalled();
		});

		it('should auto-select single team with confirmation', async () => {
			const mockTeams = [
				{
					id: '12345678-1234-1234-1234-123456789abc',
					name: 'Engineering',
					key: 'ENG',
					description: 'Engineering team',
					memberCount: 10,
					projectCount: 5
				}
			];

			mockLinearClient.teams.mockResolvedValue({
				nodes: mockTeams
			});

			mockInquirer.prompt.mockResolvedValue({
				useTeam: true
			});

			const result = await selector.fetchAndSelectTeam();

			expect(result.name).toBe('Engineering');
			expect(mockInquirer.prompt).toHaveBeenCalledWith([
				expect.objectContaining({
					type: 'confirm',
					name: 'useTeam'
				})
			]);
		});

		it('should throw error if user declines single team', async () => {
			const mockTeams = [
				{
					id: '12345678-1234-1234-1234-123456789abc',
					name: 'Engineering',
					key: 'ENG',
					description: 'Engineering team'
				}
			];

			mockLinearClient.teams.mockResolvedValue({
				nodes: mockTeams
			});

			mockInquirer.prompt.mockResolvedValue({
				useTeam: false
			});

			await expect(selector.fetchAndSelectTeam()).rejects.toThrow(
				'User declined to use the only available team'
			);
		});
	});

	describe('validateTeamSelection', () => {
		let selector;

		beforeEach(() => {
			selector = new LinearTeamSelector({ apiKey: 'lin_api_test123' });
		});

		it('should validate correct team object', () => {
			const validTeam = {
				id: '12345678-1234-1234-1234-123456789abc',
				name: 'Engineering',
				key: 'ENG'
			};

			expect(selector.validateTeamSelection(validTeam)).toBe(true);
		});

		it('should throw error for invalid team object', () => {
			expect(() => selector.validateTeamSelection(null)).toThrow(
				'Invalid team selection: team must be an object'
			);
		});

		it('should throw error for missing required fields', () => {
			const invalidTeam = {
				name: 'Engineering'
				// missing id and key
			};

			expect(() => selector.validateTeamSelection(invalidTeam)).toThrow(
				"Invalid team selection: missing required field 'id'"
			);
		});

		it('should throw error for invalid UUID format', () => {
			const invalidTeam = {
				id: 'invalid-uuid',
				name: 'Engineering',
				key: 'ENG'
			};

			expect(() => selector.validateTeamSelection(invalidTeam)).toThrow(
				'Invalid team selection: team ID must be a valid UUID'
			);
		});
	});

	describe('convenience functions', () => {
		beforeEach(() => {
			mockLinearClient.teams.mockResolvedValue({
				nodes: [
					{
						id: '12345678-1234-1234-1234-123456789abc',
						name: 'Engineering',
						key: 'ENG',
						description: 'Engineering team'
					}
				]
			});
		});

		describe('selectLinearTeam', () => {
			it('should create selector and return selected team', async () => {
				// Mock multiple teams to avoid auto-select logic
				mockLinearClient.teams.mockResolvedValue({
					nodes: [
						{
							id: '12345678-1234-1234-1234-123456789abc',
							name: 'Engineering',
							key: 'ENG',
							description: 'Engineering team'
						},
						{
							id: '87654321-4321-4321-4321-cba987654321',
							name: 'Design',
							key: 'DES',
							description: 'Design team'
						}
					]
				});

				// Create the expected transformed team object
				const transformedTeam = {
					id: '12345678-1234-1234-1234-123456789abc',
					name: 'Engineering',
					key: 'ENG',
					description: 'Engineering team',
					memberCount: 0,
					projectCount: 0,
					displayName: 'Engineering (ENG)',
					searchText: 'engineering eng engineering team'
				};

				mockInquirer.prompt.mockResolvedValue({
					selectedTeam: transformedTeam
				});

				const result = await selectLinearTeam('lin_api_test123');
				expect(result.name).toBe('Engineering');
			});
		});

		describe('fetchLinearTeams', () => {
			it('should create selector and return teams', async () => {
				const result = await fetchLinearTeams('lin_api_test123');
				expect(result).toHaveLength(1);
				expect(result[0].name).toBe('Engineering');
			});
		});
	});

	describe('error handling', () => {
		let selector;

		beforeEach(() => {
			selector = new LinearTeamSelector({ apiKey: 'lin_api_test123' });
		});

		it('should classify authentication errors', () => {
			const authError = new Error('Authentication failed');
			authError.status = 401;

			const enhanced = selector._enhanceError(authError, 'test operation');
			expect(enhanced.code).toBe(TEAM_SELECTION_ERRORS.AUTHENTICATION_ERROR);
		});

		it('should classify rate limit errors', () => {
			const rateLimitError = new Error('Rate limit exceeded');
			rateLimitError.status = 429;

			const enhanced = selector._enhanceError(rateLimitError, 'test operation');
			expect(enhanced.code).toBe(TEAM_SELECTION_ERRORS.RATE_LIMIT);
		});

		it('should classify network errors', () => {
			const networkError = new Error('Network error');
			networkError.code = 'ECONNRESET';

			const enhanced = selector._enhanceError(networkError, 'test operation');
			expect(enhanced.code).toBe(TEAM_SELECTION_ERRORS.NETWORK_ERROR);
		});

		it('should preserve existing error codes', () => {
			const existingError = new Error('No teams found');
			existingError.code = TEAM_SELECTION_ERRORS.NO_TEAMS_FOUND;

			const enhanced = selector._enhanceError(existingError, 'test operation');
			expect(enhanced).toBe(existingError);
		});

		it('should identify non-retryable errors correctly', () => {
			const authError = new Error('Authentication failed');
			authError.status = 401;
			expect(selector._isNonRetryableError(authError)).toBe(true);

			const apiKeyError = new Error('Invalid API key');
			expect(selector._isNonRetryableError(apiKeyError)).toBe(true);

			const noTeamsError = new Error('No teams');
			noTeamsError.code = TEAM_SELECTION_ERRORS.NO_TEAMS_FOUND;
			expect(selector._isNonRetryableError(noTeamsError)).toBe(true);

			const networkError = new Error('Network error');
			expect(selector._isNonRetryableError(networkError)).toBe(false);
		});
	});
});
