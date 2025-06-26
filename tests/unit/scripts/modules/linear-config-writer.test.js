/**
 * Tests for the Linear Configuration Writer module
 */

import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';

// Mock fs before importing dependencies
jest.unstable_mockModule('fs', () => ({
	default: {
		existsSync: jest.fn(),
		readFileSync: jest.fn(),
		writeFileSync: jest.fn(),
		mkdirSync: jest.fn(),
		copyFileSync: jest.fn(),
		chmodSync: jest.fn(),
		accessSync: jest.fn(),
		unlinkSync: jest.fn(),
		constants: {
			W_OK: 2
		}
	}
}));

// Mock the env-file-manager module
jest.unstable_mockModule(
	'../../../../scripts/modules/env-file-manager.js',
	() => ({
		parseEnvFile: jest.fn(),
		appendLinearSection: jest.fn(),
		writeEnvFile: jest.fn(),
		createEnvBackup: jest.fn(),
		validateEnvIntegrity: jest.fn(),
		checkEnvWritePermissions: jest.fn(),
		restoreEnvFromBackup: jest.fn(),
		formatLinearEnvVars: jest.fn(),
		ENV_MANAGER_ERRORS: {
			FILE_NOT_FOUND: 'ENV_FILE_NOT_FOUND',
			PARSE_ERROR: 'ENV_PARSE_ERROR',
			WRITE_ERROR: 'ENV_WRITE_ERROR',
			BACKUP_ERROR: 'ENV_BACKUP_ERROR',
			VALIDATION_ERROR: 'ENV_VALIDATION_ERROR',
			PERMISSION_ERROR: 'ENV_PERMISSION_ERROR'
		}
	})
);

// Mock the linear-config-manager module
jest.unstable_mockModule(
	'../../../../scripts/modules/linear-config-manager.js',
	() => ({
		readLinearConfig: jest.fn(),
		writeLinearConfig: jest.fn(),
		formatLinearConfig: jest.fn(),
		getLinearConfigPath: jest.fn(),
		validateLinearConfig: jest.fn(),
		CONFIG_MANAGER_ERRORS: {
			FILE_NOT_FOUND: 'CONFIG_FILE_NOT_FOUND',
			PARSE_ERROR: 'CONFIG_PARSE_ERROR',
			WRITE_ERROR: 'CONFIG_WRITE_ERROR',
			VALIDATION_ERROR: 'CONFIG_VALIDATION_ERROR',
			SCHEMA_ERROR: 'CONFIG_SCHEMA_ERROR'
		}
	})
);

const mockFs = await import('fs');
const mockEnvManager = await import(
	'../../../../scripts/modules/env-file-manager.js'
);
const mockConfigManager = await import(
	'../../../../scripts/modules/linear-config-manager.js'
);

// Import the module under test
const {
	writeLinearConfiguration,
	getConfigurationSummary,
	rollbackConfiguration,
	CONFIG_WRITER_ERRORS
} = await import('../../../../scripts/modules/linear-config-writer.js');

describe('Linear Configuration Writer', () => {
	beforeEach(() => {
		jest.clearAllMocks();

		// Setup default mock returns
		mockEnvManager.parseEnvFile.mockReturnValue({
			lines: ['ANTHROPIC_API_KEY=test_key'],
			variables: new Map([['ANTHROPIC_API_KEY', 'test_key']]),
			hasLinearSection: false
		});

		mockEnvManager.formatLinearEnvVars.mockReturnValue({
			LINEAR_API_KEY: 'lin_api_test',
			LINEAR_TEAM_IDS: 'team1,team2'
		});

		mockEnvManager.appendLinearSection.mockReturnValue({
			lines: [
				'ANTHROPIC_API_KEY=test_key',
				'',
				'# Linear Integration Settings',
				'LINEAR_API_KEY=lin_api_test'
			],
			variables: new Map([
				['ANTHROPIC_API_KEY', 'test_key'],
				['LINEAR_API_KEY', 'lin_api_test'],
				['LINEAR_TEAM_IDS', 'team1,team2']
			]),
			hasLinearSection: true
		});

		mockEnvManager.validateEnvIntegrity.mockReturnValue({
			valid: true,
			errors: [],
			warnings: [],
			preserved: ['ANTHROPIC_API_KEY'],
			added: ['LINEAR_API_KEY', 'LINEAR_TEAM_IDS']
		});

		mockEnvManager.checkEnvWritePermissions.mockReturnValue(true);
		mockEnvManager.createEnvBackup.mockReturnValue(
			'/backup/env-backup-123.env'
		);
		mockEnvManager.writeEnvFile.mockResolvedValue();

		mockConfigManager.getLinearConfigPath.mockReturnValue(
			'/test/linear-config.json'
		);
		mockConfigManager.formatLinearConfig.mockReturnValue({
			version: '1.0.0',
			labelPreferences: { categories: {}, automation: {} },
			syncSettings: { mode: 'one-way' }
		});

		mockConfigManager.validateLinearConfig.mockReturnValue({
			valid: true,
			errors: [],
			warnings: []
		});
		mockConfigManager.writeLinearConfig.mockResolvedValue();
		mockConfigManager.readLinearConfig.mockReturnValue({
			version: '1.0.0',
			labelPreferences: { categories: {}, automation: {} },
			syncSettings: { mode: 'one-way' }
		});

		mockFs.default.accessSync.mockReturnValue(undefined);
	});

	describe('writeLinearConfiguration', () => {
		const mockWizardData = {
			apiKey: 'lin_api_1234567890abcdef1234567890abcdef12345678',
			teams: [{ id: 'team1' }, { id: 'team2' }],
			projects: ['proj1', 'proj2'],
			labelConfiguration: {
				categories: {},
				automation: { autoApplyTaskmaster: true }
			}
		};

		it('should successfully write configuration', async () => {
			// Reset mocks and set up call sequence
			jest.clearAllMocks();

			// Setup all required mocks again
			mockEnvManager.formatLinearEnvVars.mockReturnValue({
				LINEAR_API_KEY: 'lin_api_1234567890abcdef1234567890abcdef12345678',
				LINEAR_TEAM_IDS: 'team1,team2'
			});

			mockEnvManager.appendLinearSection.mockReturnValue({
				lines: [
					'ANTHROPIC_API_KEY=test_key',
					'',
					'# Linear Integration Settings',
					'LINEAR_API_KEY=lin_api_1234567890abcdef1234567890abcdef12345678'
				],
				variables: new Map([
					['ANTHROPIC_API_KEY', 'test_key'],
					[
						'LINEAR_API_KEY',
						'lin_api_1234567890abcdef1234567890abcdef12345678'
					],
					['LINEAR_TEAM_IDS', 'team1,team2']
				]),
				hasLinearSection: true
			});

			mockEnvManager.validateEnvIntegrity.mockReturnValue({
				valid: true,
				errors: [],
				warnings: [],
				preserved: ['ANTHROPIC_API_KEY'],
				added: ['LINEAR_API_KEY', 'LINEAR_TEAM_IDS']
			});

			mockEnvManager.checkEnvWritePermissions.mockReturnValue(true);
			mockEnvManager.createEnvBackup.mockReturnValue(
				'/backup/env-backup-123.env'
			);
			mockEnvManager.writeEnvFile.mockResolvedValue();

			mockConfigManager.getLinearConfigPath.mockReturnValue(
				'/test/linear-config.json'
			);
			mockConfigManager.formatLinearConfig.mockReturnValue({
				version: '1.0.0',
				labelPreferences: { categories: {}, automation: {} },
				syncSettings: { mode: 'one-way' }
			});

			mockConfigManager.validateLinearConfig.mockReturnValue({
				valid: true,
				errors: [],
				warnings: []
			});
			mockConfigManager.writeLinearConfig.mockResolvedValue();
			mockConfigManager.readLinearConfig.mockReturnValue({
				version: '1.0.0',
				labelPreferences: { categories: {}, automation: {} },
				syncSettings: { mode: 'one-way' }
			});

			mockFs.default.accessSync.mockReturnValue(undefined);

			// Mock parseEnvFile calls: initial call and verification call
			mockEnvManager.parseEnvFile
				.mockReturnValueOnce({
					lines: ['ANTHROPIC_API_KEY=test_key'],
					variables: new Map([['ANTHROPIC_API_KEY', 'test_key']]),
					hasLinearSection: false
				})
				.mockReturnValueOnce({
					lines: [
						'ANTHROPIC_API_KEY=test_key',
						'',
						'# Linear Integration Settings',
						'LINEAR_API_KEY=lin_api_1234567890abcdef1234567890abcdef12345678'
					],
					variables: new Map([
						['ANTHROPIC_API_KEY', 'test_key'],
						[
							'LINEAR_API_KEY',
							'lin_api_1234567890abcdef1234567890abcdef12345678'
						],
						['LINEAR_TEAM_IDS', 'team1,team2']
					]),
					hasLinearSection: true
				});

			const result = await writeLinearConfiguration(mockWizardData, {
				projectRoot: '/test'
			});

			expect(result.success).toBe(true);
			expect(result.files.env.path).toBe('/test/.env');
			expect(result.files.config.path).toBe('/test/linear-config.json');
			expect(result.files.env.action).toBe('updated');
			expect(result.files.config.action).toBe('created');

			expect(mockEnvManager.writeEnvFile).toHaveBeenCalled();
			expect(mockConfigManager.writeLinearConfig).toHaveBeenCalled();
		});

		it('should handle new .env file creation', async () => {
			// Reset mocks and set up call sequence for empty env file
			jest.clearAllMocks();

			// Setup all required mocks again
			mockEnvManager.formatLinearEnvVars.mockReturnValue({
				LINEAR_API_KEY: 'lin_api_1234567890abcdef1234567890abcdef12345678',
				LINEAR_TEAM_IDS: 'team1,team2'
			});

			mockEnvManager.appendLinearSection.mockReturnValue({
				lines: [
					'# Linear Integration Settings',
					'LINEAR_API_KEY=lin_api_1234567890abcdef1234567890abcdef12345678'
				],
				variables: new Map([
					[
						'LINEAR_API_KEY',
						'lin_api_1234567890abcdef1234567890abcdef12345678'
					],
					['LINEAR_TEAM_IDS', 'team1,team2']
				]),
				hasLinearSection: true
			});

			mockEnvManager.validateEnvIntegrity.mockReturnValue({
				valid: true,
				errors: [],
				warnings: [],
				preserved: [],
				added: ['LINEAR_API_KEY', 'LINEAR_TEAM_IDS']
			});

			mockEnvManager.checkEnvWritePermissions.mockReturnValue(true);
			mockEnvManager.createEnvBackup.mockReturnValue(null); // No backup for empty file
			mockEnvManager.writeEnvFile.mockResolvedValue();

			mockConfigManager.getLinearConfigPath.mockReturnValue(
				'/test/linear-config.json'
			);
			mockConfigManager.formatLinearConfig.mockReturnValue({
				version: '1.0.0',
				labelPreferences: { categories: {}, automation: {} },
				syncSettings: { mode: 'one-way' }
			});

			mockConfigManager.validateLinearConfig.mockReturnValue({
				valid: true,
				errors: [],
				warnings: []
			});
			mockConfigManager.writeLinearConfig.mockResolvedValue();
			mockConfigManager.readLinearConfig.mockReturnValue({
				version: '1.0.0',
				labelPreferences: { categories: {}, automation: {} },
				syncSettings: { mode: 'one-way' }
			});

			mockFs.default.accessSync.mockReturnValue(undefined);

			// Mock parseEnvFile calls: initial call (empty) and verification call (with Linear vars)
			mockEnvManager.parseEnvFile
				.mockReturnValueOnce({
					lines: [],
					variables: new Map(),
					hasLinearSection: false
				})
				.mockReturnValueOnce({
					lines: [
						'# Linear Integration Settings',
						'LINEAR_API_KEY=lin_api_1234567890abcdef1234567890abcdef12345678'
					],
					variables: new Map([
						[
							'LINEAR_API_KEY',
							'lin_api_1234567890abcdef1234567890abcdef12345678'
						],
						['LINEAR_TEAM_IDS', 'team1,team2']
					]),
					hasLinearSection: true
				});

			const result = await writeLinearConfiguration(mockWizardData, {
				projectRoot: '/test'
			});

			expect(result.success).toBe(true);
			expect(result.files.env.action).toBe('created');
		});

		it('should create backup by default', async () => {
			const result = await writeLinearConfiguration(mockWizardData, {
				projectRoot: '/test'
			});

			expect(mockEnvManager.createEnvBackup).toHaveBeenCalledWith('/test/.env');
			expect(result.files.env.backup).toBe('/backup/env-backup-123.env');
		});

		it('should skip backup when disabled', async () => {
			await writeLinearConfiguration(mockWizardData, {
				projectRoot: '/test',
				createBackup: false
			});

			expect(mockEnvManager.createEnvBackup).not.toHaveBeenCalled();
		});

		it('should perform dry run without writing files', async () => {
			const result = await writeLinearConfiguration(mockWizardData, {
				projectRoot: '/test',
				dryRun: true
			});

			expect(result.success).toBe(true);
			expect(result.files.env.action).toBe('update');
			expect(result.files.config.action).toBe('create');

			expect(mockEnvManager.writeEnvFile).not.toHaveBeenCalled();
			expect(mockConfigManager.writeLinearConfig).not.toHaveBeenCalled();
		});

		it('should perform validation only', async () => {
			const result = await writeLinearConfiguration(mockWizardData, {
				projectRoot: '/test',
				validateOnly: true
			});

			expect(result.success).toBe(true);
			expect(mockEnvManager.writeEnvFile).not.toHaveBeenCalled();
			expect(mockConfigManager.writeLinearConfig).not.toHaveBeenCalled();
		});

		it('should fail on invalid wizard data', async () => {
			const result = await writeLinearConfiguration(null, {
				projectRoot: '/test'
			});

			expect(result.success).toBe(false);
			expect(result.errors).toContain('Invalid wizard data: must be an object');
		});

		it('should fail on invalid API key', async () => {
			const invalidWizardData = {
				...mockWizardData,
				apiKey: 'invalid_key_format'
			};

			const result = await writeLinearConfiguration(invalidWizardData, {
				projectRoot: '/test'
			});

			expect(result.success).toBe(false);
			expect(
				result.errors.some((e) => e.includes('Invalid Linear API key format'))
			).toBe(true);
		});

		it('should fail on permission errors', async () => {
			mockEnvManager.checkEnvWritePermissions.mockReturnValue(false);

			const result = await writeLinearConfiguration(mockWizardData, {
				projectRoot: '/test'
			});

			expect(result.success).toBe(false);
			expect(
				result.errors.some((e) => e.includes('Cannot write to .env file'))
			).toBe(true);
		});

		it('should fail on env integrity validation errors', async () => {
			mockEnvManager.validateEnvIntegrity.mockReturnValue({
				valid: false,
				errors: ['Lost existing variable: IMPORTANT_VAR'],
				warnings: []
			});

			const result = await writeLinearConfiguration(mockWizardData, {
				projectRoot: '/test'
			});

			expect(result.success).toBe(false);
			expect(
				result.errors.some((e) => e.includes('env integrity check failed'))
			).toBe(true);
		});

		it('should fail on config validation errors', async () => {
			mockConfigManager.validateLinearConfig.mockReturnValue({
				valid: false,
				errors: ['Missing required field: version'],
				warnings: []
			});

			const result = await writeLinearConfiguration(mockWizardData, {
				projectRoot: '/test'
			});

			expect(result.success).toBe(false);
			expect(
				result.errors.some((e) => e.includes('Linear config validation failed'))
			).toBe(true);
		});

		it('should handle write errors with rollback', async () => {
			mockEnvManager.writeEnvFile.mockRejectedValue(new Error('Write failed'));

			const result = await writeLinearConfiguration(mockWizardData, {
				projectRoot: '/test'
			});

			expect(result.success).toBe(false);
			expect(result.errors.some((e) => e.includes('Write failed'))).toBe(true);
			expect(mockEnvManager.restoreEnvFromBackup).toHaveBeenCalledWith(
				'/backup/env-backup-123.env',
				'/test/.env'
			);
		});

		it('should handle verification failure with rollback', async () => {
			// Mock initial successful processing
			mockEnvManager.parseEnvFile.mockReturnValueOnce({
				lines: ['ANTHROPIC_API_KEY=test_key'],
				variables: new Map([['ANTHROPIC_API_KEY', 'test_key']]),
				hasLinearSection: false
			});

			// Mock successful env file write
			mockEnvManager.writeEnvFile.mockResolvedValue();
			mockConfigManager.writeLinearConfig.mockResolvedValue();

			// Mock verification parse that shows missing expected variable
			mockEnvManager.parseEnvFile.mockReturnValueOnce({
				lines: ['ANTHROPIC_API_KEY=test_key'],
				variables: new Map([['ANTHROPIC_API_KEY', 'test_key']]), // Missing LINEAR_API_KEY
				hasLinearSection: false
			});

			const result = await writeLinearConfiguration(mockWizardData, {
				projectRoot: '/test'
			});

			expect(result.success).toBe(false);
			expect(
				result.errors.some((e) => e.includes('Post-write verification failed'))
			).toBe(true);
			expect(mockEnvManager.restoreEnvFromBackup).toHaveBeenCalled();
		});

		it('should handle rollback failure', async () => {
			mockEnvManager.writeEnvFile.mockRejectedValue(new Error('Write failed'));
			mockEnvManager.restoreEnvFromBackup.mockRejectedValue(
				new Error('Rollback failed')
			);

			const result = await writeLinearConfiguration(mockWizardData, {
				projectRoot: '/test'
			});

			expect(result.success).toBe(false);
			expect(
				result.errors.some((e) => e.includes('CONFIG_ROLLBACK_ERROR'))
			).toBe(true);
		});

		it('should include warnings in result', async () => {
			// Reset mocks and set up successful scenario with warnings
			jest.clearAllMocks();

			mockEnvManager.formatLinearEnvVars.mockReturnValue({
				LINEAR_API_KEY: 'lin_api_1234567890abcdef1234567890abcdef12345678',
				LINEAR_TEAM_IDS: 'team1,team2'
			});

			mockEnvManager.appendLinearSection.mockReturnValue({
				lines: [
					'ANTHROPIC_API_KEY=test_key',
					'LINEAR_API_KEY=lin_api_1234567890abcdef1234567890abcdef12345678'
				],
				variables: new Map([
					['ANTHROPIC_API_KEY', 'test_key'],
					[
						'LINEAR_API_KEY',
						'lin_api_1234567890abcdef1234567890abcdef12345678'
					],
					['LINEAR_TEAM_IDS', 'team1,team2']
				]),
				hasLinearSection: true
			});

			mockEnvManager.validateEnvIntegrity.mockReturnValue({
				valid: true,
				errors: [],
				warnings: [],
				preserved: ['ANTHROPIC_API_KEY'],
				added: ['LINEAR_API_KEY', 'LINEAR_TEAM_IDS']
			});

			mockEnvManager.checkEnvWritePermissions.mockReturnValue(true);
			mockEnvManager.createEnvBackup.mockReturnValue(
				'/backup/env-backup-123.env'
			);
			mockEnvManager.writeEnvFile.mockResolvedValue();

			mockConfigManager.getLinearConfigPath.mockReturnValue(
				'/test/linear-config.json'
			);
			mockConfigManager.formatLinearConfig.mockReturnValue({
				version: '1.0.0',
				labelPreferences: { categories: {}, automation: {} },
				syncSettings: { mode: 'one-way' }
			});

			// Set validation with warnings
			mockConfigManager.validateLinearConfig.mockReturnValue({
				valid: true,
				errors: [],
				warnings: ['Possible secret field detected']
			});
			mockConfigManager.writeLinearConfig.mockResolvedValue();
			mockConfigManager.readLinearConfig.mockReturnValue({
				version: '1.0.0',
				labelPreferences: { categories: {}, automation: {} },
				syncSettings: { mode: 'one-way' }
			});

			mockFs.default.accessSync.mockReturnValue(undefined);

			// Mock parseEnvFile calls: initial call and verification call
			mockEnvManager.parseEnvFile
				.mockReturnValueOnce({
					lines: ['ANTHROPIC_API_KEY=test_key'],
					variables: new Map([['ANTHROPIC_API_KEY', 'test_key']]),
					hasLinearSection: false
				})
				.mockReturnValueOnce({
					lines: [
						'ANTHROPIC_API_KEY=test_key',
						'LINEAR_API_KEY=lin_api_1234567890abcdef1234567890abcdef12345678'
					],
					variables: new Map([
						['ANTHROPIC_API_KEY', 'test_key'],
						[
							'LINEAR_API_KEY',
							'lin_api_1234567890abcdef1234567890abcdef12345678'
						],
						['LINEAR_TEAM_IDS', 'team1,team2']
					]),
					hasLinearSection: true
				});

			const result = await writeLinearConfiguration(mockWizardData, {
				projectRoot: '/test'
			});

			expect(result.success).toBe(true);
			expect(result.warnings).toContain('Possible secret field detected');
		});
	});

	describe('getConfigurationSummary', () => {
		it('should generate user-friendly summary', () => {
			const writeResult = {
				success: true,
				files: {
					env: {
						path: '/test/.env',
						action: 'updated',
						backup: '/backup/env-backup-123.env'
					},
					config: {
						path: '/test/linear-config.json',
						action: 'created'
					}
				},
				validation: {
					env: {
						added: ['LINEAR_API_KEY', 'LINEAR_TEAM_IDS'],
						preserved: ['ANTHROPIC_API_KEY']
					}
				},
				warnings: ['Warning message'],
				errors: []
			};

			const summary = getConfigurationSummary(writeResult);

			expect(summary.success).toBe(true);
			expect(summary.filesModified).toHaveLength(2);
			expect(summary.filesModified[0]).toEqual({
				file: '.env',
				action: 'updated',
				path: '/test/.env'
			});
			expect(summary.backupsCreated).toHaveLength(1);
			expect(summary.environmentVariables.added).toContain('LINEAR_API_KEY');
			expect(summary.environmentVariables.preserved).toContain(
				'ANTHROPIC_API_KEY'
			);
			expect(summary.warnings).toContain('Warning message');
		});

		it('should handle empty results', () => {
			const writeResult = {
				success: false,
				files: { env: {}, config: {} },
				validation: {},
				warnings: [],
				errors: ['Error message']
			};

			const summary = getConfigurationSummary(writeResult);

			expect(summary.success).toBe(false);
			expect(summary.filesModified).toHaveLength(0);
			expect(summary.backupsCreated).toHaveLength(0);
			expect(summary.errors).toContain('Error message');
		});
	});

	describe('rollbackConfiguration', () => {
		it('should rollback successfully', async () => {
			const writeResult = {
				files: {
					env: {
						path: '/test/.env',
						backup: '/backup/env-backup-123.env'
					},
					config: {
						path: '/test/linear-config.json',
						action: 'created'
					}
				}
			};

			mockFs.default.existsSync.mockReturnValue(true);
			mockEnvManager.restoreEnvFromBackup.mockResolvedValue();
			mockFs.default.unlinkSync.mockReturnValue(undefined);

			const result = await rollbackConfiguration(writeResult);

			expect(result.success).toBe(true);
			expect(result.actions).toContain('Restored .env file from backup');
			expect(result.actions).toContain('Removed linear-config.json file');

			expect(mockEnvManager.restoreEnvFromBackup).toHaveBeenCalledWith(
				'/backup/env-backup-123.env',
				'/test/.env'
			);
			expect(mockFs.default.unlinkSync).toHaveBeenCalledWith(
				'/test/linear-config.json'
			);
		});

		it('should handle partial rollback', async () => {
			const writeResult = {
				files: {
					env: {
						path: '/test/.env',
						backup: '/backup/env-backup-123.env'
					},
					config: {
						path: '/test/linear-config.json',
						action: 'updated' // not created, so don't remove
					}
				}
			};

			const result = await rollbackConfiguration(writeResult);

			expect(result.success).toBe(true);
			expect(result.actions).toContain('Restored .env file from backup');
			expect(result.actions).not.toContain('Removed linear-config.json file');
			expect(mockFs.default.unlinkSync).not.toHaveBeenCalled();
		});

		it('should handle rollback errors', async () => {
			const writeResult = {
				files: {
					env: {
						path: '/test/.env',
						backup: '/backup/env-backup-123.env'
					}
				}
			};

			mockEnvManager.restoreEnvFromBackup.mockRejectedValue(
				new Error('Restore failed')
			);

			const result = await rollbackConfiguration(writeResult);

			expect(result.success).toBe(false);
			expect(result.errors).toContain('Rollback failed: Restore failed');
		});

		it('should handle missing backup', async () => {
			const writeResult = {
				files: {
					env: {
						path: '/test/.env'
						// No backup path, so no backup to restore
					},
					config: {
						path: '/test/linear-config.json',
						action: 'created'
					}
				}
			};

			// Reset mocks first
			jest.clearAllMocks();
			mockFs.default.existsSync.mockReturnValue(true);
			mockFs.default.unlinkSync.mockReturnValue(undefined);

			const result = await rollbackConfiguration(writeResult);

			expect(result.success).toBe(true);
			expect(result.actions).not.toContain('Restored .env file from backup');
			expect(result.actions).toContain('Removed linear-config.json file');
		});
	});

	describe('API key validation', () => {
		it('should accept valid Linear API key', async () => {
			const validWizardData = {
				apiKey: 'lin_api_1234567890abcdef1234567890abcdef12345678'
			};

			const result = await writeLinearConfiguration(validWizardData, {
				projectRoot: '/test'
			});

			// Should not fail on API key validation
			expect(
				result.errors.some((e) => e.includes('Invalid Linear API key format'))
			).toBe(false);
		});

		it('should reject invalid API key formats', async () => {
			const invalidKeys = [
				'invalid_key',
				'lin_api_short',
				'wrong_prefix_1234567890abcdef1234567890abcdef12345678',
				'lin_api_',
				''
			];

			for (const apiKey of invalidKeys) {
				const invalidWizardData = {
					apiKey,
					teams: [{ id: 'team1' }],
					projects: ['proj1'],
					labelConfiguration: {
						categories: {},
						automation: { autoApplyTaskmaster: true }
					}
				};

				const result = await writeLinearConfiguration(invalidWizardData, {
					projectRoot: '/test'
				});

				expect(result.success).toBe(false);

				// For empty string, the error might be different due to different validation path
				if (apiKey === '') {
					expect(result.errors.length).toBeGreaterThan(0);
				} else {
					expect(
						result.errors.some((e) =>
							e.includes('Invalid Linear API key format')
						)
					).toBe(true);
				}
			}
		});
	});
});
