/**
 * Tests for the Linear label management module
 */

import { jest } from '@jest/globals';
import { readFileSync, writeFileSync, existsSync } from 'fs';

// Mock dependencies first
const mockLinearClient = {
	project: jest.fn(),
	teamLabelCreate: jest.fn(),
	teams: jest.fn()
};

const MockLinearClient = jest.fn().mockImplementation(() => mockLinearClient);

jest.unstable_mockModule('@linear/sdk', () => ({
	LinearClient: MockLinearClient
}));

// Mock utils
const mockLog = jest.fn();
jest.unstable_mockModule('../../scripts/modules/utils.js', () => ({
	log: mockLog
}));

// Mock prompts
const mockMessages = {
	header: jest.fn(),
	info: jest.fn(),
	success: jest.fn(),
	error: jest.fn()
};

jest.unstable_mockModule('../../scripts/modules/prompts.js', () => ({
	promptConfigs: {},
	messages: mockMessages
}));

// Mock language detection
jest.unstable_mockModule('../../scripts/modules/language-detection.js', () => ({
	detectLanguagesFromTask: jest.fn(),
	languageToLabelKey: jest.fn(),
	getLanguageInfo: jest.fn()
}));

// Mock fs operations
const mockReadFileSync = jest.fn();
const mockWriteFileSync = jest.fn();
const mockExistsSync = jest.fn();

jest.unstable_mockModule('fs', () => ({
	readFileSync: mockReadFileSync,
	writeFileSync: mockWriteFileSync,
	existsSync: mockExistsSync
}));

// Now import the module under test
const {
	LinearLabelManager,
	createLabelManager,
	analyzeLabelConfiguration,
	LABEL_MANAGEMENT_ERRORS
} = await import('../../scripts/modules/linear-label-management.js');

describe('LinearLabelManager', () => {
	const mockConfig = {
		apiKey: 'lin_api_test123',
		projectRoot: '/test/project'
	};

	const validProjectId = '12345678-1234-1234-1234-123456789abc';
	const validTeamId = '87654321-4321-4321-4321-210987654321';

	beforeEach(() => {
		jest.clearAllMocks();
		MockLinearClient.mockClear();
		mockLinearClient.project.mockClear();
		mockLinearClient.teamLabelCreate.mockClear();
		mockLinearClient.teams.mockClear();
		Object.values(mockMessages).forEach((mock) => mock.mockClear());

		// Clear fs mocks
		mockReadFileSync.mockClear();
		mockWriteFileSync.mockClear();
		mockExistsSync.mockClear();

		// Mock console methods
		jest.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		console.log.mockRestore();
	});

	describe('constructor', () => {
		it('should initialize with valid configuration', () => {
			const manager = new LinearLabelManager(mockConfig);

			expect(manager.config.apiKey).toBe('lin_api_test123');
			expect(manager.config.projectRoot).toBe('/test/project');
			expect(manager.config.maxRetries).toBe(3);
			expect(manager.config.retryDelay).toBe(1000);
		});

		it('should throw error if no API key provided', () => {
			expect(() => new LinearLabelManager({ projectRoot: '/test' })).toThrow(
				'Linear API key is required'
			);
		});

		it('should throw error if no project root provided', () => {
			expect(() => new LinearLabelManager({ apiKey: 'test' })).toThrow(
				'Project root directory is required'
			);
		});

		it('should accept custom configuration', () => {
			const customConfig = {
				...mockConfig,
				maxRetries: 5,
				retryDelay: 2000,
				pageSize: 50
			};

			const manager = new LinearLabelManager(customConfig);

			expect(manager.config.maxRetries).toBe(5);
			expect(manager.config.retryDelay).toBe(2000);
			expect(manager.config.pageSize).toBe(50);
		});
	});

	describe('loadLabelSetsConfig', () => {
		it('should load valid configuration file', () => {
			const mockConfigData = {
				version: '1.0.0',
				enabled: true,
				labels: {
					categories: {
						core: {
							enabled: true,
							labels: {}
						}
					}
				}
			};

			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue(JSON.stringify(mockConfigData));

			const manager = new LinearLabelManager(mockConfig);
			const config = manager.loadLabelSetsConfig();

			// Should return just the labels portion
			expect(config).toEqual(mockConfigData.labels);
			expect(mockReadFileSync).toHaveBeenCalledWith(
				'/test/project/.taskmaster/linear-config.json',
				'utf8'
			);
		});

		it('should throw error if config file does not exist', () => {
			mockExistsSync.mockReturnValue(false);

			const manager = new LinearLabelManager(mockConfig);

			expect(() => manager.loadLabelSetsConfig()).toThrow(
				'Linear configuration not found at: /test/project/.taskmaster/linear-config.json'
			);
		});

		it('should throw error if config file is invalid JSON', () => {
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue('invalid json');

			const manager = new LinearLabelManager(mockConfig);

			expect(() => manager.loadLabelSetsConfig()).toThrow();
		});

		it('should throw error if config has invalid structure', () => {
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue(JSON.stringify({ invalid: true }));

			const manager = new LinearLabelManager(mockConfig);

			expect(() => manager.loadLabelSetsConfig()).toThrow(
				'Invalid Linear configuration: missing labels.categories'
			);
		});
	});

	describe('saveLabelSetsConfig', () => {
		it('should save configuration with updated metadata', () => {
			const configToSave = {
				categories: {
					core: {
						enabled: true,
						labels: {}
					}
				},
				metadata: {}
			};

			// Mock the initial read of the full config
			const existingFullConfig = {
				version: '1.0.0',
				enabled: true,
				labels: {
					categories: {
						old: {
							enabled: false,
							labels: {}
						}
					}
				},
				metadata: {
					createdAt: '2023-01-01T00:00:00.000Z'
				}
			};

			mockReadFileSync.mockReturnValue(JSON.stringify(existingFullConfig));

			const manager = new LinearLabelManager(mockConfig);
			manager.saveLabelSetsConfig(configToSave);

			expect(mockWriteFileSync).toHaveBeenCalledWith(
				'/test/project/.taskmaster/linear-config.json',
				expect.stringContaining('"lastUpdated"'),
				'utf8'
			);

			// Check that metadata was updated
			const savedData = JSON.parse(mockWriteFileSync.mock.calls[0][1]);
			expect(savedData.metadata.lastUpdated).toBeDefined();
			expect(savedData.metadata.version).toBe('1.0.0');
			expect(savedData.labels.categories).toEqual(configToSave.categories);
		});

		it('should handle save errors', () => {
			// Mock the initial read of the full config
			const existingFullConfig = {
				version: '1.0.0',
				enabled: true,
				labels: { categories: {} },
				metadata: {}
			};

			mockReadFileSync.mockReturnValue(JSON.stringify(existingFullConfig));
			mockWriteFileSync.mockImplementation(() => {
				throw new Error('Write failed');
			});

			const manager = new LinearLabelManager(mockConfig);

			expect(() => manager.saveLabelSetsConfig({ categories: {} })).toThrow(
				'Failed to save Linear config'
			);
		});
	});

	describe('fetchProjectLabels', () => {
		let manager;

		beforeEach(() => {
			manager = new LinearLabelManager(mockConfig);
		});

		it('should validate project ID parameter', async () => {
			await expect(manager.fetchProjectLabels(null)).rejects.toThrow(
				'Project ID is required and must be a string'
			);

			await expect(manager.fetchProjectLabels('')).rejects.toThrow(
				'Project ID is required and must be a string'
			);

			await expect(manager.fetchProjectLabels(123)).rejects.toThrow(
				'Project ID is required and must be a string'
			);
		});

		it('should validate project ID format', async () => {
			await expect(manager.fetchProjectLabels('invalid-uuid')).rejects.toThrow(
				'Project ID must be a valid UUID format'
			);
		});

		it('should fetch labels successfully', async () => {
			const mockTeam = {
				labels: jest.fn().mockResolvedValue({
					nodes: [
						{
							id: 'label-1',
							name: 'Bug',
							description: 'Something is broken',
							color: '#d73a49',
							createdAt: '2023-01-01T00:00:00Z',
							updatedAt: '2023-01-01T00:00:00Z'
						},
						{
							id: 'label-2',
							name: 'Feature',
							description: 'New functionality',
							color: '#28a745'
						}
					]
				})
			};

			const mockProject = {
				team: mockTeam
			};

			mockLinearClient.project.mockResolvedValue(mockProject);

			const result = await manager.fetchProjectLabels(validProjectId);

			expect(result).toHaveLength(2);
			expect(result[0]).toMatchObject({
				id: 'label-1',
				name: 'Bug',
				description: 'Something is broken',
				color: '#d73a49',
				createdAt: '2023-01-01T00:00:00Z',
				updatedAt: '2023-01-01T00:00:00Z',
				isArchived: false
			});

			expect(result[1]).toMatchObject({
				id: 'label-2',
				name: 'Feature',
				description: 'New functionality',
				color: '#28a745',
				isArchived: false
			});
		});

		it('should handle missing optional fields', async () => {
			const mockTeam = {
				labels: jest.fn().mockResolvedValue({
					nodes: [
						{
							id: 'label-1',
							name: 'Basic Label'
						}
					]
				})
			};

			const mockProject = {
				team: mockTeam
			};

			mockLinearClient.project.mockResolvedValue(mockProject);

			const result = await manager.fetchProjectLabels(validProjectId);

			expect(result[0]).toMatchObject({
				id: 'label-1',
				name: 'Basic Label',
				description: '',
				color: '#6366f1',
				isArchived: false
			});
		});

		it('should throw error when project not found', async () => {
			mockLinearClient.project.mockResolvedValue(null);

			await expect(manager.fetchProjectLabels(validProjectId)).rejects.toThrow(
				'Project not found or access denied'
			);
		});

		it('should retry on network errors', async () => {
			const mockTeam = {
				labels: jest.fn().mockResolvedValue({ nodes: [] })
			};

			mockLinearClient.project
				.mockRejectedValueOnce(new Error('Network error'))
				.mockResolvedValue({
					team: mockTeam
				});

			const result = await manager.fetchProjectLabels(validProjectId);

			expect(result).toEqual([]);
			expect(mockLinearClient.project).toHaveBeenCalledTimes(2);
		});

		it('should not retry authentication errors', async () => {
			const authError = new Error('Authentication failed');
			authError.status = 401;
			mockLinearClient.project.mockRejectedValue(authError);

			await expect(manager.fetchProjectLabels(validProjectId)).rejects.toThrow(
				'Authentication failed'
			);
			expect(mockLinearClient.project).toHaveBeenCalledTimes(1);
		});
	});

	describe('fetchMultipleProjectLabels', () => {
		let manager;

		beforeEach(() => {
			manager = new LinearLabelManager(mockConfig);
		});

		it('should fetch labels from multiple projects', async () => {
			const projectIds = [
				validProjectId,
				'22222222-2222-2222-2222-222222222222'
			];

			const mockTeam1 = {
				labels: jest.fn().mockResolvedValue({
					nodes: [{ id: 'label-1', name: 'Bug', color: '#d73a49' }]
				})
			};

			const mockTeam2 = {
				labels: jest.fn().mockResolvedValue({
					nodes: [{ id: 'label-2', name: 'Feature', color: '#28a745' }]
				})
			};

			const mockProject1 = {
				team: mockTeam1
			};

			const mockProject2 = {
				team: mockTeam2
			};

			mockLinearClient.project
				.mockResolvedValueOnce(mockProject1)
				.mockResolvedValueOnce(mockProject2);

			const result = await manager.fetchMultipleProjectLabels(projectIds);

			expect(result).toHaveProperty(validProjectId);
			expect(result).toHaveProperty('22222222-2222-2222-2222-222222222222');
			expect(result[validProjectId]).toHaveLength(1);
			expect(result['22222222-2222-2222-2222-222222222222']).toHaveLength(1);
		});

		it('should handle partial failures', async () => {
			const projectIds = [
				validProjectId,
				'22222222-2222-2222-2222-222222222222'
			];

			const mockTeam1 = {
				labels: jest.fn().mockResolvedValue({
					nodes: [{ id: 'label-1', name: 'Bug', color: '#d73a49' }]
				})
			};

			const mockProject1 = {
				team: mockTeam1
			};

			mockLinearClient.project
				.mockResolvedValueOnce(mockProject1)
				.mockRejectedValueOnce(new Error('Project 2 failed'));

			const result = await manager.fetchMultipleProjectLabels(projectIds);

			expect(result[validProjectId]).toHaveLength(1);
			expect(result['22222222-2222-2222-2222-222222222222']).toEqual([]);
		});

		it('should require non-empty project IDs array', async () => {
			await expect(manager.fetchMultipleProjectLabels([])).rejects.toThrow(
				'Project IDs array is required and cannot be empty'
			);

			await expect(manager.fetchMultipleProjectLabels(null)).rejects.toThrow(
				'Project IDs array is required and cannot be empty'
			);
		});
	});

	describe('createLabel', () => {
		let manager;

		beforeEach(() => {
			manager = new LinearLabelManager(mockConfig);
		});

		it('should throw API limitation error with helpful instructions', async () => {
			const labelConfig = {
				name: 'Test Label',
				description: 'Test description',
				color: '#6366f1'
			};

			await expect(
				manager.createLabel(validTeamId, labelConfig)
			).rejects.toThrow(
				'Linear API does not support creating labels programmatically'
			);
		});

		it('should include manual creation instructions in error', async () => {
			const labelConfig = {
				name: 'Test Label',
				description: 'Test description',
				color: '#6366f1'
			};

			try {
				await manager.createLabel(validTeamId, labelConfig);
				fail('Expected error to be thrown');
			} catch (error) {
				expect(error.message).toContain('Go to your Linear team settings');
				expect(error.message).toContain('Navigate to Labels section');
				expect(error.message).toContain('Name: "Test Label"');
				expect(error.message).toContain('Description: "Test description"');
				expect(error.message).toContain('Color: "#6366f1"');
				expect(error.isApiLimitation).toBe(true);
				expect(error.labelConfig).toEqual(labelConfig);
			}
		});

		it('should validate required parameters before showing API limitation', async () => {
			await expect(manager.createLabel(null, {})).rejects.toThrow(
				'Team ID is required and must be a string'
			);

			await expect(manager.createLabel(validTeamId, null)).rejects.toThrow(
				'Label configuration is required'
			);

			await expect(manager.createLabel(validTeamId, {})).rejects.toThrow(
				'Label name is required and must be a string'
			);
		});

		it('should validate color format before showing API limitation', async () => {
			const labelConfig = {
				name: 'Test Label',
				color: 'invalid-color'
			};

			await expect(
				manager.createLabel(validTeamId, labelConfig)
			).rejects.toThrow('Label color must be a valid hex color');
		});

		it('should use default values in error instructions', async () => {
			const labelConfig = {
				name: 'Test Label'
			};

			try {
				await manager.createLabel(validTeamId, labelConfig);
				fail('Expected error to be thrown');
			} catch (error) {
				expect(error.message).toContain('Description: ""');
				expect(error.message).toContain('Color: "#6366f1"');
			}
		});
	});

	describe('analyzeLabelDelta', () => {
		let manager;

		beforeEach(() => {
			manager = new LinearLabelManager(mockConfig);
		});

		it('should analyze missing and existing labels', () => {
			const labelSetsConfig = {
				categories: {
					core: {
						enabled: true,
						labels: {
							taskmaster: {
								name: 'taskmaster',
								description: 'TaskMaster managed',
								color: '#6366f1',
								linearId: null
							}
						}
					},
					types: {
						enabled: true,
						labels: {
							bug: {
								name: 'Bug',
								description: 'Something broken',
								color: '#d73a49',
								linearId: null
							}
						}
					}
				}
			};

			const organizationLabels = [
				{
					id: 'existing-1',
					name: 'Bug',
					color: '#d73a49',
					description: 'Something broken',
					createdAt: '2023-01-01T00:00:00Z',
					teams: [{ id: validTeamId, name: 'Test Team' }]
				}
			];

			const analysis = manager.analyzeLabelDelta(
				labelSetsConfig,
				organizationLabels,
				validTeamId
			);

			expect(analysis.teamId).toBe(validTeamId);
			expect(analysis.enabledCategories).toHaveLength(2);
			expect(analysis.missingLabels).toHaveLength(1);
			expect(analysis.needsSync).toHaveLength(1);
			expect(analysis.summary.totalRequired).toBe(2);
			expect(analysis.summary.totalMissing).toBe(1);
			expect(analysis.summary.totalNeedsSync).toBe(1);

			// Check missing label
			expect(analysis.missingLabels[0]).toMatchObject({
				categoryKey: 'core',
				labelKey: 'taskmaster',
				action: 'create'
			});

			// Check sync needed label
			expect(analysis.needsSync[0]).toMatchObject({
				categoryKey: 'types',
				labelKey: 'bug',
				action: 'sync_required'
			});
		});

		it('should detect color conflicts', () => {
			const labelSetsConfig = {
				categories: {
					types: {
						enabled: true,
						labels: {
							bug: {
								name: 'Bug',
								description: 'Something broken',
								color: '#ff0000',
								linearId: 'existing-1'
							}
						}
					}
				}
			};

			const organizationLabels = [
				{
					id: 'existing-1',
					name: 'Bug',
					color: '#d73a49', // Different color
					description: 'Something broken', // Same description
					createdAt: '2023-01-01T00:00:00Z',
					teams: [{ id: validTeamId, name: 'Test Team' }]
				}
			];

			const analysis = manager.analyzeLabelDelta(
				labelSetsConfig,
				organizationLabels,
				validTeamId
			);

			expect(analysis.conflicts).toHaveLength(1);
			expect(analysis.conflicts[0]).toMatchObject({
				type: 'color',
				labelName: 'Bug',
				configured: '#ff0000',
				existing: '#d73a49',
				action: 'update_linear'
			});
		});

		it('should skip disabled categories', () => {
			const labelSetsConfig = {
				categories: {
					core: {
						enabled: false,
						labels: {
							taskmaster: {
								name: 'taskmaster',
								color: '#6366f1',
								linearId: null
							}
						}
					}
				}
			};

			const organizationLabels = [];

			const analysis = manager.analyzeLabelDelta(
				labelSetsConfig,
				organizationLabels,
				validTeamId
			);

			expect(analysis.enabledCategories).toHaveLength(0);
			expect(analysis.missingLabels).toHaveLength(0);
			expect(analysis.summary.totalRequired).toBe(0);
		});

		it('should generate appropriate recommendations', () => {
			const labelSetsConfig = {
				categories: {
					core: {
						enabled: true,
						labels: {
							taskmaster: {
								name: 'taskmaster',
								color: '#6366f1',
								linearId: null
							}
						}
					}
				}
			};

			const organizationLabels = [];

			const analysis = manager.analyzeLabelDelta(
				labelSetsConfig,
				organizationLabels,
				validTeamId
			);

			expect(analysis.recommendations).toHaveLength(1);
			expect(analysis.recommendations[0]).toMatchObject({
				type: 'create_labels',
				priority: 'high',
				command: 'linear-sync-labels'
			});
		});
	});

	describe('convenience functions', () => {
		it('should create label manager instance', () => {
			const manager = createLabelManager('test-api-key', '/test/root');

			expect(manager).toBeInstanceOf(LinearLabelManager);
			expect(manager.config.apiKey).toBe('test-api-key');
			expect(manager.config.projectRoot).toBe('/test/root');
		});

		it('should analyze label configuration', async () => {
			// Mock file system
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue(
				JSON.stringify({
					version: '1.0.0',
					enabled: true,
					labels: {
						categories: {
							core: {
								enabled: true,
								labels: {}
							}
						}
					}
				})
			);

			// Mock Linear API for organization labels
			mockLinearClient.teams.mockResolvedValue({
				nodes: [
					{
						id: validTeamId,
						name: 'Test Team',
						labels: jest.fn().mockResolvedValue({ nodes: [] })
					}
				]
			});

			const result = await analyzeLabelConfiguration(
				'test-api-key',
				'/test/root',
				validTeamId
			);

			expect(result).toHaveProperty('teamId');
			expect(result).toHaveProperty('summary');
			expect(result.teamId).toBe(validTeamId);
		});
	});

	describe('error handling', () => {
		let manager;

		beforeEach(() => {
			manager = new LinearLabelManager(mockConfig);
		});

		it('should classify authentication errors', () => {
			const authError = new Error('Authentication failed');
			authError.status = 401;

			const enhanced = manager._enhanceError(authError, 'test operation');
			expect(enhanced.code).toBe(LABEL_MANAGEMENT_ERRORS.AUTHENTICATION_ERROR);
		});

		it('should classify rate limit errors', () => {
			const rateLimitError = new Error('Rate limit exceeded');
			rateLimitError.status = 429;

			const enhanced = manager._enhanceError(rateLimitError, 'test operation');
			expect(enhanced.code).toBe(LABEL_MANAGEMENT_ERRORS.RATE_LIMIT);
		});

		it('should classify network errors', () => {
			const networkError = new Error('Network error');
			networkError.code = 'ECONNRESET';

			const enhanced = manager._enhanceError(networkError, 'test operation');
			expect(enhanced.code).toBe(LABEL_MANAGEMENT_ERRORS.NETWORK_ERROR);
		});

		it('should preserve existing error codes', () => {
			const existingError = new Error('Project access denied');
			existingError.code = LABEL_MANAGEMENT_ERRORS.PROJECT_ACCESS_ERROR;

			const enhanced = manager._enhanceError(existingError, 'test operation');
			expect(enhanced).toBe(existingError);
		});

		it('should identify non-retryable errors correctly', () => {
			const authError = new Error('Authentication failed');
			authError.status = 401;
			expect(manager._isNonRetryableError(authError)).toBe(true);

			const apiKeyError = new Error('Invalid API key');
			expect(manager._isNonRetryableError(apiKeyError)).toBe(true);

			const configError = new Error('Config error');
			configError.code = LABEL_MANAGEMENT_ERRORS.CONFIG_FILE_ERROR;
			expect(manager._isNonRetryableError(configError)).toBe(true);

			const uuidError = new Error('Team ID must be a valid UUID format');
			expect(manager._isNonRetryableError(uuidError)).toBe(true);

			const networkError = new Error('Network error');
			expect(manager._isNonRetryableError(networkError)).toBe(false);
		});
	});
});
