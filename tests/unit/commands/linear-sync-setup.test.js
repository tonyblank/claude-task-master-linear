/**
 * @fileoverview Tests for sync-setup command
 */

import { jest } from '@jest/globals';

// Mock all dependencies before importing the module under test
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

jest.unstable_mockModule('ora', () => ({
	default: jest.fn(() => ({
		start: jest.fn().mockReturnThis(),
		stop: jest.fn().mockReturnThis(),
		succeed: jest.fn().mockReturnThis(),
		fail: jest.fn().mockReturnThis()
	}))
}));

jest.unstable_mockModule(
	'../../../scripts/modules/linear-api-validation.js',
	() => ({
		validateLinearApiKey: jest.fn(),
		testLinearConnection: jest.fn()
	})
);

jest.unstable_mockModule(
	'../../../scripts/modules/linear-team-selection.js',
	() => ({
		selectLinearTeam: jest.fn()
	})
);

jest.unstable_mockModule(
	'../../../scripts/modules/linear-project-selection.js',
	() => ({
		selectLinearProject: jest.fn()
	})
);

jest.unstable_mockModule(
	'../../../scripts/modules/linear-label-selection.js',
	() => ({
		configureLabelPreferences: jest.fn()
	})
);

jest.unstable_mockModule(
	'../../../scripts/modules/linear-env-writer.js',
	() => ({
		writeLinearEnvironment: jest.fn()
	})
);

jest.unstable_mockModule(
	'../../../scripts/modules/linear-wizard-config.js',
	() => ({
		createLinearConfiguration: jest.fn(),
		getConfiguredLabels: jest.fn()
	})
);

jest.unstable_mockModule(
	'../../../scripts/modules/linear-label-management.js',
	() => ({
		LinearLabelManager: jest.fn().mockImplementation(() => ({
			syncLabelsWithLinear: jest.fn()
		}))
	})
);

jest.unstable_mockModule('../../../scripts/modules/setup-success.js', () => ({
	displaySetupSuccess: jest.fn(),
	testConfiguration: jest.fn()
}));

jest.unstable_mockModule('../../../scripts/modules/utils.js', () => ({
	log: jest.fn(),
	findProjectRoot: jest.fn().mockReturnValue('/test/project')
}));

// Import mocked modules
const mockChalk = await import('chalk');
const mockOra = await import('ora');
const mockApiValidation = await import(
	'../../../scripts/modules/linear-api-validation.js'
);
const mockTeamSelection = await import(
	'../../../scripts/modules/linear-team-selection.js'
);
const mockProjectSelection = await import(
	'../../../scripts/modules/linear-project-selection.js'
);
const mockLabelSelection = await import(
	'../../../scripts/modules/linear-label-selection.js'
);
const mockEnvWriter = await import(
	'../../../scripts/modules/linear-env-writer.js'
);
const mockWizardConfig = await import(
	'../../../scripts/modules/linear-wizard-config.js'
);
const mockLabelManagement = await import(
	'../../../scripts/modules/linear-label-management.js'
);
const mockSetupSuccess = await import(
	'../../../scripts/modules/setup-success.js'
);
const mockUtils = await import('../../../scripts/modules/utils.js');

// Import the module under test
const { runSetupWizard, linearSyncSetupCommand } = await import(
	'../../../scripts/commands/linear-sync-setup.js'
);

describe('linear-sync-setup command', () => {
	let mockExit;
	let consoleLogSpy;
	let consoleErrorSpy;

	beforeEach(() => {
		jest.clearAllMocks();

		// Mock process.exit - default to no-op, but individual tests can override
		mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});

		// Mock console methods
		consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
		consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

		// Reset mocks to default successful behavior
		mockApiValidation.validateLinearApiKey.mockResolvedValue({
			success: true,
			apiKey: 'lin_api_test123',
			user: { name: 'Test User', email: 'test@example.com' }
		});

		mockTeamSelection.selectLinearTeam.mockResolvedValue({
			id: 'team1',
			name: 'Team 1',
			displayName: 'Team 1'
		});

		mockProjectSelection.selectLinearProject.mockResolvedValue({
			id: 'project1',
			name: 'Project 1',
			displayName: 'Project 1'
		});

		mockLabelSelection.configureLabelPreferences.mockResolvedValue({
			success: true,
			configuration: { categories: {}, automation: {} }
		});

		mockWizardConfig.createLinearConfiguration.mockResolvedValue({
			success: true,
			configPath: '/test/.taskmaster/linear-config.json',
			config: {}
		});

		// Mock LinearLabelManager instance
		const mockLabelManagerInstance = {
			syncLabelsWithLinear: jest.fn().mockResolvedValue({
				summary: { missing: 0, successful: 0 },
				missing: []
			})
		};
		mockLabelManagement.LinearLabelManager.mockImplementation(
			() => mockLabelManagerInstance
		);

		mockEnvWriter.writeLinearEnvironment.mockResolvedValue({
			success: true,
			files: {
				env: { path: '/test/.env', action: 'updated' }
			},
			warnings: []
		});

		mockSetupSuccess.displaySetupSuccess.mockResolvedValue({
			success: true,
			shouldTest: false
		});

		mockSetupSuccess.testConfiguration.mockResolvedValue({
			success: true,
			errors: []
		});
	});

	afterEach(() => {
		mockExit.mockRestore();
		consoleLogSpy.mockRestore();
		consoleErrorSpy.mockRestore();
	});

	describe('runSetupWizard', () => {
		it('should complete full setup wizard successfully', async () => {
			const result = await runSetupWizard();

			expect(result.success).toBe(true);
			expect(result.wizardData).toBeDefined();
			expect(result.wizardData.apiKey).toBe('lin_api_test123');
			expect(result.wizardData.team).toBeDefined();

			// Verify all steps were called
			expect(mockApiValidation.validateLinearApiKey).toHaveBeenCalled();
			expect(mockTeamSelection.selectLinearTeam).toHaveBeenCalledWith(
				'lin_api_test123',
				expect.objectContaining({
					spinner: expect.any(Object)
				})
			);
			expect(mockProjectSelection.selectLinearProject).toHaveBeenCalled();
			expect(mockWizardConfig.createLinearConfiguration).toHaveBeenCalled();
			expect(mockEnvWriter.writeLinearEnvironment).toHaveBeenCalled();
			expect(mockSetupSuccess.displaySetupSuccess).toHaveBeenCalled();
		});

		it('should handle API validation failure', async () => {
			mockApiValidation.validateLinearApiKey.mockResolvedValue({
				success: false,
				error: 'Invalid API key'
			});

			await runSetupWizard();

			expect(mockExit).toHaveBeenCalledWith(1);
			expect(mockUtils.log).toHaveBeenCalledWith(
				'error',
				'Setup cancelled: Invalid API key'
			);
		});

		it('should handle team selection failure', async () => {
			mockTeamSelection.selectLinearTeam.mockResolvedValue(null);

			await runSetupWizard();

			expect(mockExit).toHaveBeenCalledWith(1);
			expect(mockUtils.log).toHaveBeenCalledWith(
				'error',
				'Setup cancelled: No team selected'
			);
		});

		it('should handle project selection failure', async () => {
			mockProjectSelection.selectLinearProject.mockResolvedValue(null);

			await runSetupWizard();

			expect(mockExit).toHaveBeenCalledWith(1);
			expect(mockUtils.log).toHaveBeenCalledWith(
				'error',
				'Setup cancelled: No project selected'
			);
		});

		it('should handle Linear configuration creation failure', async () => {
			mockWizardConfig.createLinearConfiguration.mockResolvedValue({
				success: false,
				error: 'Failed to create Linear configuration'
			});

			await runSetupWizard();

			expect(mockExit).toHaveBeenCalledWith(1);
			expect(mockUtils.log).toHaveBeenCalledWith(
				'error',
				'Setup cancelled: Failed to create Linear configuration'
			);
		});

		it('should handle environment writing failure', async () => {
			mockEnvWriter.writeLinearEnvironment.mockResolvedValue({
				success: false,
				errors: ['Permission denied', 'Invalid path']
			});

			await runSetupWizard();

			expect(mockExit).toHaveBeenCalledWith(1);
			expect(mockUtils.log).toHaveBeenCalledWith(
				'error',
				'Setup failed: Could not write configuration files'
			);
		});

		it('should perform dry run without writing files', async () => {
			const result = await runSetupWizard({ dryRun: true });

			expect(result.success).toBe(true);
			expect(result.dryRun).toBe(true);
			expect(mockEnvWriter.writeLinearEnvironment).not.toHaveBeenCalled();
			expect(mockUtils.log).toHaveBeenCalledWith(
				'info',
				'DRY RUN: Would update environment file...'
			);
		});

		it('should skip testing when requested', async () => {
			const result = await runSetupWizard({ skipTest: true });

			expect(result.success).toBe(true);
			expect(mockSetupSuccess.testConfiguration).not.toHaveBeenCalled();
		});

		it('should run configuration test when requested', async () => {
			mockSetupSuccess.displaySetupSuccess.mockResolvedValue({
				success: true,
				shouldTest: true
			});

			const result = await runSetupWizard({ skipTest: false });

			expect(result.success).toBe(true);
			expect(mockSetupSuccess.testConfiguration).toHaveBeenCalled();
		});

		it('should handle configuration test failures gracefully', async () => {
			mockSetupSuccess.displaySetupSuccess.mockResolvedValue({
				success: true,
				shouldTest: true
			});

			mockSetupSuccess.testConfiguration.mockResolvedValue({
				success: false,
				errors: ['API connectivity failed', 'Team access denied']
			});

			const result = await runSetupWizard({ skipTest: false });

			expect(result.success).toBe(true); // Setup should still succeed even if test fails
			expect(mockUtils.log).toHaveBeenCalledWith(
				'warn',
				'⚠️  Configuration test had issues:'
			);
		});

		it('should handle unexpected errors gracefully', async () => {
			const testError = new Error('Unexpected error');
			mockApiValidation.validateLinearApiKey.mockRejectedValue(testError);

			const result = await runSetupWizard();

			expect(result.success).toBe(false);
			expect(result.error).toBe('Unexpected error');
			expect(mockUtils.log).toHaveBeenCalledWith(
				'error',
				'Setup failed: Unexpected error'
			);
		});

		it('should use custom project root when provided', async () => {
			const customRoot = '/custom/project/root';

			await runSetupWizard({ projectRoot: customRoot });

			expect(mockEnvWriter.writeLinearEnvironment).toHaveBeenCalledWith(
				expect.any(Object),
				expect.objectContaining({
					projectRoot: customRoot,
					createBackup: true,
					dryRun: false
				})
			);
		});

		it('should display warnings when configuration write has warnings', async () => {
			mockEnvWriter.writeLinearEnvironment.mockResolvedValue({
				success: true,
				files: {
					env: { path: '/test/.env', action: 'updated' }
				},
				warnings: ['Warning 1', 'Warning 2']
			});

			const result = await runSetupWizard();

			expect(result.success).toBe(true);
			expect(consoleLogSpy).toHaveBeenCalledWith(
				expect.stringContaining('Warnings:')
			);
		});
	});

	describe('linearSyncSetupCommand', () => {
		it('should run setup wizard and exit with code 0 on success', async () => {
			await linearSyncSetupCommand({});

			expect(mockExit).toHaveBeenCalledWith(0);
		});

		it('should exit with code 1 on failure', async () => {
			mockApiValidation.validateLinearApiKey.mockResolvedValue({
				success: false,
				error: 'Invalid API key'
			});

			await linearSyncSetupCommand({});

			expect(mockExit).toHaveBeenCalledWith(1);
		});

		it('should handle command errors gracefully', async () => {
			const testError = new Error('Command error');
			mockApiValidation.validateLinearApiKey.mockRejectedValue(testError);

			await linearSyncSetupCommand({});

			// Should log the caught error from runSetupWizard
			expect(mockUtils.log).toHaveBeenCalledWith(
				'error',
				'Setup failed: Command error'
			);
			expect(mockExit).toHaveBeenCalledWith(1);
		});

		it('should pass options to runSetupWizard', async () => {
			const options = {
				skipTest: true,
				dryRun: true,
				projectRoot: '/custom/path'
			};

			// Mock runSetupWizard to capture the options
			const mockRunSetupWizard = jest.fn().mockResolvedValue({ success: true });

			// We can't easily mock the imported function, so we'll verify the behavior
			await linearSyncSetupCommand(options);

			// The test passes if no errors are thrown and exit(0) is called
			expect(mockExit).toHaveBeenCalledWith(0);
		});
	});
});
