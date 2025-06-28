/**
 * @fileoverview Tests for setup-success module
 */

import { jest } from '@jest/globals';

// Mock dependencies
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
			bold: createChalkFunction('bold')
		}
	};
});

jest.unstable_mockModule('boxen', () => ({
	default: jest.fn((content, options) => `[BOX] ${content}`)
}));

jest.unstable_mockModule('inquirer', () => ({
	default: {
		prompt: jest.fn()
	}
}));

jest.unstable_mockModule('@linear/sdk', () => ({
	LinearClient: jest.fn()
}));

jest.unstable_mockModule('../../../scripts/modules/utils.js', () => ({
	log: jest.fn()
}));

jest.unstable_mockModule(
	'../../../scripts/modules/linear-config-manager.js',
	() => ({
		getLinearConfigPath: jest.fn().mockReturnValue('/test/linear-config.json')
	})
);

// Mock fs module for configuration file tests
jest.unstable_mockModule('fs', () => ({
	default: {
		existsSync: jest.fn(),
		readFileSync: jest.fn()
	},
	existsSync: jest.fn(),
	readFileSync: jest.fn()
}));

// Import mocked modules
const mockChalk = await import('chalk');
const mockBoxen = await import('boxen');
const mockInquirer = await import('inquirer');
const mockLinearSDK = await import('@linear/sdk');
const mockUtils = await import('../../../scripts/modules/utils.js');
const mockConfigManager = await import(
	'../../../scripts/modules/linear-config-manager.js'
);
const mockFs = await import('fs');

// Import the module under test
const { displaySetupSuccess, testConfiguration } = await import(
	'../../../scripts/modules/setup-success.js'
);

describe('Setup Success Module', () => {
	let consoleLogSpy;
	let consoleErrorSpy;

	const mockWizardData = {
		apiKey: 'lin_api_test123',
		team: { id: 'team1', name: 'Team Alpha' },
		project: { id: 'project1', name: 'Project Alpha' },
		labelConfiguration: {
			categories: { bug: true, feature: true },
			automation: { autoApply: true }
		},
		userInfo: {
			name: 'Test User',
			email: 'test@example.com'
		}
	};

	beforeEach(() => {
		jest.clearAllMocks();

		consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
		consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

		// Default mock for inquirer
		mockInquirer.default.prompt.mockResolvedValue({ testConfig: false });

		// Default mock for fs (both default and named exports)
		mockFs.default.existsSync.mockReturnValue(true);
		mockFs.default.readFileSync.mockReturnValue(
			JSON.stringify({
				version: '1.0.0',
				labelPreferences: {},
				syncSettings: {}
			})
		);
		mockFs.existsSync.mockReturnValue(true);
		mockFs.readFileSync.mockReturnValue(
			JSON.stringify({
				version: '1.0.0',
				labelPreferences: {},
				syncSettings: {}
			})
		);
	});

	afterEach(() => {
		consoleLogSpy.mockRestore();
		consoleErrorSpy.mockRestore();
	});

	describe('displaySetupSuccess', () => {
		it('should display success message with configuration summary', async () => {
			const result = await displaySetupSuccess(mockWizardData);

			expect(result.success).toBe(true);
			expect(result.shouldTest).toBe(false);
			expect(result.summary).toBeDefined();

			// Verify summary contains expected data
			expect(result.summary.user.name).toBe('Test User');
			expect(result.summary.team.name).toBe('Team Alpha');
			expect(result.summary.project.name).toBe('Project Alpha');
			expect(result.summary.labels.count).toBe(3); // 2 categories + 1 automation

			// Verify console output was called
			expect(consoleLogSpy).toHaveBeenCalled();
			expect(mockBoxen.default).toHaveBeenCalled();
		});

		it('should handle dry run mode correctly', async () => {
			const result = await displaySetupSuccess(mockWizardData, {
				dryRun: true
			});

			expect(result.success).toBe(true);
			expect(result.summary.dryRun).toBe(true);
			expect(result.summary.files.env).toContain('would be created/updated');
			expect(result.summary.files.config).toContain('would be created');
		});

		it('should ask about configuration testing when not skipped', async () => {
			mockInquirer.default.prompt.mockResolvedValue({ testConfig: true });

			const result = await displaySetupSuccess(mockWizardData, {
				skipTest: false
			});

			expect(result.shouldTest).toBe(true);
			expect(mockInquirer.default.prompt).toHaveBeenCalledWith([
				{
					type: 'confirm',
					name: 'testConfig',
					message: 'Would you like to test your Linear configuration now?',
					default: true
				}
			]);
		});

		it('should skip testing prompt when skipTest is true', async () => {
			const result = await displaySetupSuccess(mockWizardData, {
				skipTest: true
			});

			expect(result.shouldTest).toBe(false);
			expect(mockInquirer.default.prompt).not.toHaveBeenCalled();
		});

		it('should skip testing prompt in dry run mode', async () => {
			const result = await displaySetupSuccess(mockWizardData, {
				dryRun: true
			});

			expect(result.shouldTest).toBe(false);
			expect(mockInquirer.default.prompt).not.toHaveBeenCalled();
		});

		it('should handle missing user info gracefully', async () => {
			const wizardDataWithoutUser = {
				...mockWizardData,
				userInfo: null
			};

			const result = await displaySetupSuccess(wizardDataWithoutUser);

			expect(result.success).toBe(true);
			expect(result.summary.user.name).toBe('Unknown');
			expect(result.summary.user.email).toBe('Unknown');
		});

		it('should handle team without name', async () => {
			const wizardDataWithIdOnlyTeam = {
				...mockWizardData,
				team: { id: 'team1' }
			};

			const result = await displaySetupSuccess(wizardDataWithIdOnlyTeam);

			expect(result.success).toBe(true);
			expect(result.summary.team.name).toBe('team1');
		});

		it('should handle string project correctly', async () => {
			const wizardDataWithStringProject = {
				...mockWizardData,
				project: 'project1'
			};

			const result = await displaySetupSuccess(wizardDataWithStringProject);

			expect(result.success).toBe(true);
			expect(result.summary.project.name).toBe('project1');
		});

		it('should handle object project correctly', async () => {
			const wizardDataWithObjectProject = {
				...mockWizardData,
				project: { id: 'project1', name: 'Project Alpha' }
			};

			const result = await displaySetupSuccess(wizardDataWithObjectProject);

			expect(result.success).toBe(true);
			expect(result.summary.project.name).toBe('Project Alpha');
		});

		it('should count labels correctly', async () => {
			const wizardDataWithLabels = {
				...mockWizardData,
				labelConfiguration: {
					categories: { bug: true, feature: true, enhancement: true },
					automation: { autoApply: true, syncOnChange: true }
				}
			};

			const result = await displaySetupSuccess(wizardDataWithLabels);

			expect(result.success).toBe(true);
			expect(result.summary.labels.count).toBe(5); // 3 categories + 2 automation
		});

		it('should handle missing label configuration', async () => {
			const wizardDataWithoutLabels = {
				...mockWizardData,
				labelConfiguration: null
			};

			const result = await displaySetupSuccess(wizardDataWithoutLabels);

			expect(result.success).toBe(true);
			expect(result.summary.labels.count).toBe(0);
			expect(result.summary.labels.configured).toBe(false);
		});
	});

	describe('testConfiguration', () => {
		let mockLinearClient;
		let mockViewer;
		let mockTeam;
		let mockProjects;

		beforeEach(() => {
			// Mock Linear SDK client
			mockViewer = { name: 'Test User' };
			mockTeam = { id: 'team1', name: 'Team Alpha' };
			mockProjects = { nodes: [{ id: 'proj1', name: 'Project 1' }] };

			mockLinearClient = {
				viewer: Promise.resolve(mockViewer),
				team: jest.fn().mockResolvedValue(mockTeam),
				project: jest
					.fn()
					.mockResolvedValue({ id: 'proj1', name: 'Project 1' }),
				projects: jest.fn().mockResolvedValue(mockProjects)
			};

			mockLinearSDK.LinearClient.mockReturnValue(mockLinearClient);

			// Mock file system for configuration file test
			mockFs.default.existsSync.mockReturnValue(true);
			mockFs.default.readFileSync.mockReturnValue(
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
		});

		it('should run all tests successfully', async () => {
			const result = await testConfiguration(mockWizardData);

			expect(result.success).toBe(true);
			expect(result.errors).toHaveLength(0);
			expect(result.tests).toHaveLength(5); // API, Team Access, Project Access, Config File, State Mappings

			// Verify most tests passed (state mappings might be warning)
			const passedTests = result.tests.filter(
				(test) => test.status === 'passed'
			);
			expect(passedTests).toHaveLength(4); // State mappings test shows as warning, not passed
		});

		it('should handle API connectivity failure', async () => {
			mockLinearClient.viewer = Promise.reject(
				new Error('API connection failed')
			);

			const result = await testConfiguration(mockWizardData);

			expect(result.success).toBe(false);
			expect(result.errors).toContain('API connectivity test failed');

			const apiTest = result.tests.find(
				(test) => test.name === 'API Connectivity'
			);
			expect(apiTest.status).toBe('failed');
		});

		it('should handle team access issues as warnings', async () => {
			mockLinearClient.team.mockResolvedValue(null);

			const result = await testConfiguration(mockWizardData);

			expect(result.success).toBe(true); // Should still succeed with warnings
			expect(result.warnings).toContain(
				'Team "Team Alpha" not found or no access'
			);

			const teamTest = result.tests.find(
				(test) => test.name === 'Team Access: Team Alpha'
			);
			expect(teamTest.status).toBe('warning');
		});

		it('should handle team access errors as warnings', async () => {
			mockLinearClient.team.mockRejectedValue(new Error('Access denied'));

			const result = await testConfiguration(mockWizardData);

			expect(result.success).toBe(true); // Should still succeed with warnings
			expect(result.warnings).toContain(
				'Cannot access team "Team Alpha": Access denied'
			);
		});

		it('should test project access when teams and projects exist', async () => {
			const result = await testConfiguration(mockWizardData);

			expect(mockLinearClient.project).toHaveBeenCalledWith('project1');

			const projectTest = result.tests.find(
				(test) => test.name === 'Project Access: Project Alpha'
			);
			expect(projectTest.status).toBe('passed');
		});

		it('should handle no projects found as warning', async () => {
			mockLinearClient.project.mockResolvedValue(null);

			const result = await testConfiguration(mockWizardData);

			expect(result.warnings).toContain(
				'Selected project not found or no access'
			);

			const projectTest = result.tests.find(
				(test) => test.name === 'Project Access: Project Alpha'
			);
			expect(projectTest.status).toBe('warning');
		});

		it('should handle project access errors as warnings', async () => {
			mockLinearClient.project.mockRejectedValue(
				new Error('Project access failed')
			);

			const result = await testConfiguration(mockWizardData);

			expect(result.warnings).toContain(
				'Project access test failed: Project access failed'
			);

			const projectTest = result.tests.find(
				(test) => test.name === 'Project Access: Project Alpha'
			);
			expect(projectTest.status).toBe('warning');
		});

		it('should validate configuration file successfully', async () => {
			const result = await testConfiguration(mockWizardData);

			const configTest = result.tests.find(
				(test) => test.name === 'Configuration File'
			);
			expect(configTest.status).toBe('passed');
			expect(mockFs.default.existsSync).toHaveBeenCalled();
			expect(mockFs.default.readFileSync).toHaveBeenCalled();
		});

		it('should handle missing configuration file', async () => {
			mockFs.default.existsSync.mockReturnValue(false);

			const result = await testConfiguration(mockWizardData);

			expect(result.errors).toContain('Configuration file not found');

			const configTest = result.tests.find(
				(test) => test.name === 'Configuration File'
			);
			expect(configTest.status).toBe('failed');
		});

		it('should handle invalid configuration file content', async () => {
			mockFs.default.readFileSync.mockReturnValue(
				JSON.stringify({
					version: '1.0.0'
					// missing required fields
				})
			);

			const result = await testConfiguration(mockWizardData);

			expect(result.warnings).toContain(
				'Configuration file is missing required fields'
			);

			const configTest = result.tests.find(
				(test) => test.name === 'Configuration File'
			);
			expect(configTest.status).toBe('warning');
		});

		it('should handle configuration file parsing errors', async () => {
			mockFs.default.readFileSync.mockReturnValue('invalid json');

			const result = await testConfiguration(mockWizardData);

			expect(
				result.warnings.some((warning) =>
					warning.includes('Configuration file validation failed')
				)
			).toBe(true);

			const configTest = result.tests.find(
				(test) => test.name === 'Configuration File'
			);
			expect(configTest.status).toBe('warning');
		});

		it('should display test results to console', async () => {
			const result = await testConfiguration(mockWizardData);

			expect(consoleLogSpy).toHaveBeenCalledWith(
				expect.stringContaining('🧪 Configuration Test Results:')
			);

			// Should display results for each test
			expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('✅'));
		});

		it('should handle unexpected errors gracefully', async () => {
			mockLinearSDK.LinearClient.mockImplementation(() => {
				throw new Error('SDK initialization failed');
			});

			const result = await testConfiguration(mockWizardData);

			expect(result.success).toBe(false);
			expect(result.errors).toContain(
				'Configuration testing failed: SDK initialization failed'
			);
			expect(mockUtils.log).toHaveBeenCalledWith(
				'error',
				expect.stringContaining('SDK initialization failed')
			);
		});

		it('should use custom project root', async () => {
			const customRoot = '/custom/project';

			await testConfiguration(mockWizardData, { projectRoot: customRoot });

			expect(mockConfigManager.getLinearConfigPath).toHaveBeenCalledWith(
				customRoot
			);
		});

		it('should skip project access test when no team or project', async () => {
			const wizardDataNoProjects = {
				...mockWizardData,
				team: null,
				project: null
			};

			const result = await testConfiguration(wizardDataNoProjects);

			expect(mockLinearClient.projects).not.toHaveBeenCalled();

			// Should only have API connectivity and config file tests
			const projectTest = result.tests.find(
				(test) => test.name === 'Project Access'
			);
			expect(projectTest).toBeUndefined();
		});
	});
});
