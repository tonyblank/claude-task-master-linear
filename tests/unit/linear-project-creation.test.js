/**
 * Tests for the Linear project creation module
 */

import { jest } from '@jest/globals';

// Mock the Linear SDK first, before any imports
const mockProjectCreate = jest.fn();
const mockLinearClient = {
	projectCreate: mockProjectCreate
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
	messages: mockMessages
}));

// Now import the module under test
const {
	LinearProjectCreator,
	createLinearProject,
	createLinearProjectInteractive,
	PROJECT_CREATION_ERRORS
} = await import('../../scripts/modules/linear-project-creation.js');

describe('LinearProjectCreator', () => {
	const validTeamId = '12345678-1234-1234-1234-123456789abc';

	beforeEach(() => {
		jest.clearAllMocks();
		mockLog.mockClear();
		MockLinearClient.mockClear();
		mockProjectCreate.mockClear();
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
			const creator = new LinearProjectCreator({ apiKey: 'lin_api_test123' });
			expect(creator.config.apiKey).toBe('lin_api_test123');
			expect(creator.config.maxRetries).toBe(3);
			expect(creator.config.retryDelay).toBe(1000);
		});

		it('should throw error if no API key provided', () => {
			expect(() => new LinearProjectCreator()).toThrow(
				'Linear API key is required'
			);
		});

		it('should accept custom configuration', () => {
			const creator = new LinearProjectCreator({
				apiKey: 'lin_api_test123',
				maxRetries: 5,
				retryDelay: 2000
			});
			expect(creator.config.maxRetries).toBe(5);
			expect(creator.config.retryDelay).toBe(2000);
		});
	});

	describe('createProject', () => {
		let creator;

		beforeEach(() => {
			creator = new LinearProjectCreator({ apiKey: 'lin_api_test123' });
		});

		it('should validate project data', async () => {
			await expect(creator.createProject({})).rejects.toThrow(
				'Project name is required and must be a string'
			);

			await expect(creator.createProject({ name: 'Test' })).rejects.toThrow(
				'Team ID is required and must be a string'
			);

			await expect(
				creator.createProject({
					name: 'Test',
					teamId: 'invalid-uuid'
				})
			).rejects.toThrow('Team ID must be a valid UUID format');
		});

		it('should create project successfully', async () => {
			const mockProject = {
				id: '11111111-1111-1111-1111-111111111111',
				name: 'Test Project',
				key: 'TEST',
				description: 'Test description',
				state: { name: 'planned' },
				team: { id: validTeamId },
				url: 'https://linear.app/project/test'
			};

			mockProjectCreate.mockResolvedValue({
				success: true,
				project: mockProject
			});

			const result = await creator.createProject({
				name: 'Test Project',
				teamId: validTeamId,
				description: 'Test description'
			});

			expect(mockProjectCreate).toHaveBeenCalledWith({
				input: {
					name: 'Test Project',
					teamId: validTeamId,
					description: 'Test description',
					state: 'planned'
				}
			});

			expect(result).toMatchObject({
				id: '11111111-1111-1111-1111-111111111111',
				name: 'Test Project',
				key: 'TEST',
				description: 'Test description',
				state: 'planned',
				teamId: validTeamId,
				displayName: 'Test Project (TEST)',
				statusIndicator: '📅'
			});
		});

		it('should handle project creation failure', async () => {
			mockProjectCreate.mockResolvedValue({
				success: false,
				lastSyncId: 'error-sync-id'
			});

			await expect(
				creator.createProject({
					name: 'Test Project',
					teamId: validTeamId
				})
			).rejects.toThrow('Project creation failed: error-sync-id');
		});

		it('should handle missing project data in response', async () => {
			mockProjectCreate.mockResolvedValue({
				success: true,
				project: null
			});

			await expect(
				creator.createProject({
					name: 'Test Project',
					teamId: validTeamId
				})
			).rejects.toThrow(
				'Project creation succeeded but no project data returned'
			);
		});

		it('should trim input data', async () => {
			const mockProject = {
				id: '11111111-1111-1111-1111-111111111111',
				name: 'Test Project',
				key: 'TEST',
				description: 'Test description',
				state: { name: 'planned' },
				team: { id: validTeamId }
			};

			mockProjectCreate.mockResolvedValue({
				success: true,
				project: mockProject
			});

			await creator.createProject({
				name: '  Test Project  ',
				teamId: validTeamId,
				description: '  Test description  ',
				key: '  test  '
			});

			expect(mockProjectCreate).toHaveBeenCalledWith({
				input: {
					name: 'Test Project',
					teamId: validTeamId,
					description: 'Test description',
					key: 'TEST',
					state: 'planned'
				}
			});
		});

		it('should retry on network errors', async () => {
			mockProjectCreate
				.mockRejectedValueOnce(new Error('Network error'))
				.mockResolvedValue({
					success: true,
					project: {
						id: '11111111-1111-1111-1111-111111111111',
						name: 'Test Project',
						state: { name: 'planned' },
						team: { id: validTeamId }
					}
				});

			const result = await creator.createProject({
				name: 'Test Project',
				teamId: validTeamId
			});

			expect(result).toBeDefined();
			expect(mockProjectCreate).toHaveBeenCalledTimes(2);
		});

		it('should not retry authentication errors', async () => {
			const authError = new Error('Authentication failed');
			authError.status = 401;
			mockProjectCreate.mockRejectedValue(authError);

			await expect(
				creator.createProject({
					name: 'Test Project',
					teamId: validTeamId
				})
			).rejects.toThrow('Authentication failed');

			expect(mockProjectCreate).toHaveBeenCalledTimes(1);
		});
	});

	describe('promptForProjectName', () => {
		let creator;

		beforeEach(() => {
			creator = new LinearProjectCreator({ apiKey: 'lin_api_test123' });
		});

		it('should prompt for project name with default', async () => {
			mockInquirer.prompt.mockResolvedValue({
				projectName: 'My Project'
			});

			const result = await creator.promptForProjectName('default-name');

			expect(mockInquirer.prompt).toHaveBeenCalledWith([
				expect.objectContaining({
					type: 'input',
					name: 'projectName',
					message: 'Enter project name:',
					default: 'default-name'
				})
			]);

			expect(result).toBe('My Project');
		});

		it('should validate project name input', async () => {
			const promptCall = mockInquirer.prompt.mock.calls[0];
			// Simulate calling the validate function directly
			const validateFn = expect.any(Function);

			mockInquirer.prompt.mockResolvedValue({
				projectName: 'Valid Project'
			});

			await creator.promptForProjectName();

			// Check that validation is set up correctly
			expect(mockInquirer.prompt).toHaveBeenCalledWith([
				expect.objectContaining({
					validate: validateFn
				})
			]);
		});
	});

	describe('promptForProjectDetails', () => {
		let creator;

		beforeEach(() => {
			creator = new LinearProjectCreator({ apiKey: 'lin_api_test123' });
		});

		it('should prompt for project details', async () => {
			mockInquirer.prompt.mockResolvedValue({
				description: 'Project description',
				state: 'started'
			});

			const result = await creator.promptForProjectDetails('Test Project');

			expect(mockInquirer.prompt).toHaveBeenCalledWith([
				expect.objectContaining({
					type: 'input',
					name: 'description',
					default: 'TaskMaster integration for Test Project'
				}),
				expect.objectContaining({
					type: 'list',
					name: 'state',
					choices: expect.arrayContaining([
						expect.objectContaining({ value: 'backlog' }),
						expect.objectContaining({ value: 'planned' }),
						expect.objectContaining({ value: 'started' })
					])
				})
			]);

			expect(result).toEqual({
				description: 'Project description',
				state: 'started'
			});
		});
	});

	describe('error handling', () => {
		let creator;

		beforeEach(() => {
			creator = new LinearProjectCreator({ apiKey: 'lin_api_test123' });
		});

		it('should classify authentication errors', () => {
			const authError = new Error('Authentication failed');
			authError.status = 401;

			const enhanced = creator._enhanceError(authError, 'test operation');
			expect(enhanced.code).toBe(PROJECT_CREATION_ERRORS.AUTHENTICATION_ERROR);
		});

		it('should classify rate limit errors', () => {
			const rateLimitError = new Error('Rate limit exceeded');
			rateLimitError.status = 429;

			const enhanced = creator._enhanceError(rateLimitError, 'test operation');
			expect(enhanced.code).toBe(PROJECT_CREATION_ERRORS.RATE_LIMIT);
		});

		it('should classify network errors', () => {
			const networkError = new Error('Network error');
			networkError.code = 'ECONNRESET';

			const enhanced = creator._enhanceError(networkError, 'test operation');
			expect(enhanced.code).toBe(PROJECT_CREATION_ERRORS.NETWORK_ERROR);
		});

		it('should classify validation errors', () => {
			const validationError = new Error('validation failed');

			const enhanced = creator._enhanceError(validationError, 'test operation');
			expect(enhanced.code).toBe(PROJECT_CREATION_ERRORS.VALIDATION_ERROR);
		});

		it('should preserve existing error codes', () => {
			const existingError = new Error('Team access denied');
			existingError.code = PROJECT_CREATION_ERRORS.TEAM_ACCESS_ERROR;

			const enhanced = creator._enhanceError(existingError, 'test operation');
			expect(enhanced).toBe(existingError);
		});

		it('should identify non-retryable errors correctly', () => {
			const authError = new Error('Authentication failed');
			authError.status = 401;
			expect(creator._isNonRetryableError(authError)).toBe(true);

			const validationError = new Error('validation failed');
			validationError.code = PROJECT_CREATION_ERRORS.VALIDATION_ERROR;
			expect(creator._isNonRetryableError(validationError)).toBe(true);

			const networkError = new Error('Network error');
			expect(creator._isNonRetryableError(networkError)).toBe(false);
		});
	});

	describe('status indicators', () => {
		let creator;

		beforeEach(() => {
			creator = new LinearProjectCreator({ apiKey: 'lin_api_test123' });
		});

		it('should generate correct status indicators', () => {
			expect(creator._getStatusIndicator('backlog')).toBe('📋');
			expect(creator._getStatusIndicator('planned')).toBe('📅');
			expect(creator._getStatusIndicator('started')).toBe('🚀');
			expect(creator._getStatusIndicator('paused')).toBe('⏸️');
			expect(creator._getStatusIndicator('completed')).toBe('✅');
			expect(creator._getStatusIndicator('cancelled')).toBe('❌');
			expect(creator._getStatusIndicator('unknown')).toBe('📄');
			expect(creator._getStatusIndicator(null)).toBe('📄');
		});
	});
});

describe('convenience functions', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('createLinearProject', () => {
		it('should create project using LinearProjectCreator', async () => {
			const mockProject = {
				id: '11111111-1111-1111-1111-111111111111',
				name: 'Test Project'
			};

			mockProjectCreate.mockResolvedValue({
				success: true,
				project: mockProject
			});

			const result = await createLinearProject('lin_api_test123', {
				name: 'Test Project',
				teamId: '12345678-1234-1234-1234-123456789abc'
			});

			expect(result).toBeDefined();
			expect(MockLinearClient).toHaveBeenCalledWith({
				apiKey: 'lin_api_test123'
			});
		});
	});

	describe('createLinearProjectInteractive', () => {
		it('should create project interactively', async () => {
			const mockProject = {
				id: '11111111-1111-1111-1111-111111111111',
				name: 'Interactive Project',
				displayName: 'Interactive Project'
			};

			mockProjectCreate.mockResolvedValue({
				success: true,
				project: mockProject
			});

			mockInquirer.prompt
				.mockResolvedValueOnce({ projectName: 'Interactive Project' })
				.mockResolvedValueOnce({
					description: 'Interactive description',
					state: 'planned'
				});

			const result = await createLinearProjectInteractive(
				'lin_api_test123',
				'12345678-1234-1234-1234-123456789abc',
				'default-repo-name'
			);

			expect(mockMessages.header).toHaveBeenCalledWith(
				'Create New Linear Project'
			);
			expect(mockMessages.success).toHaveBeenCalledWith(
				'✅ Project created successfully: Interactive Project'
			);
			expect(result).toBeDefined();
		});

		it('should use default name when provided', async () => {
			const mockProject = {
				id: '11111111-1111-1111-1111-111111111111',
				name: 'Repo Project',
				displayName: 'Repo Project'
			};

			mockProjectCreate.mockResolvedValue({
				success: true,
				project: mockProject
			});

			mockInquirer.prompt
				.mockResolvedValueOnce({ projectName: 'Repo Project' })
				.mockResolvedValueOnce({
					description: 'Repo description',
					state: 'planned'
				});

			await createLinearProjectInteractive(
				'lin_api_test123',
				'12345678-1234-1234-1234-123456789abc',
				'my-repo-name'
			);

			// Check that the prompt was called with the default name
			expect(mockInquirer.prompt).toHaveBeenCalledWith([
				expect.objectContaining({
					default: 'my-repo-name'
				})
			]);
		});
	});
});
