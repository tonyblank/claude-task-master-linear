/**
 * Tests for the Linear Configuration Manager module
 */

import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';

// Mock fs before importing the module
jest.unstable_mockModule('fs', () => ({
	default: {
		existsSync: jest.fn(),
		readFileSync: jest.fn(),
		writeFileSync: jest.fn(),
		mkdirSync: jest.fn(),
		unlinkSync: jest.fn()
	}
}));

const mockFs = await import('fs');

// Import the module under test
const {
	readLinearConfig,
	writeLinearConfig,
	formatLinearConfig,
	getLinearConfigPath,
	validateLinearConfig,
	linearConfigExists,
	updateLinearConfigSection,
	mergeWithDefaults,
	DEFAULT_LINEAR_CONFIG,
	CONFIG_MANAGER_ERRORS
} = await import('../../../../scripts/modules/linear-config-manager.js');

describe('Linear Configuration Manager', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('readLinearConfig', () => {
		it('should read existing config file', () => {
			const configContent = JSON.stringify({
				version: '1.0.0',
				labelPreferences: {
					categories: {
						core: { enabled: true }
					}
				},
				syncSettings: {
					mode: 'one-way'
				}
			});

			mockFs.default.existsSync.mockReturnValue(true);
			mockFs.default.readFileSync.mockReturnValue(configContent);

			const result = readLinearConfig('/test/linear-config.json');

			expect(result.version).toBe('1.0.0');
			expect(result.labelPreferences.categories.core.enabled).toBe(true);
			expect(result.syncSettings.mode).toBe('one-way');
		});

		it('should return default config for non-existent file', () => {
			mockFs.default.existsSync.mockReturnValue(false);

			const result = readLinearConfig('/test/linear-config.json');

			expect(result).toEqual(DEFAULT_LINEAR_CONFIG);
		});

		it('should merge partial config with defaults', () => {
			const partialConfig = JSON.stringify({
				version: '1.0.0',
				labelPreferences: {
					automation: {
						autoApplyTaskmaster: false
					}
				}
			});

			mockFs.default.existsSync.mockReturnValue(true);
			mockFs.default.readFileSync.mockReturnValue(partialConfig);

			const result = readLinearConfig('/test/linear-config.json');

			expect(result.version).toBe('1.0.0');
			expect(result.labelPreferences.automation.autoApplyTaskmaster).toBe(
				false
			);
			expect(result.labelPreferences.automation.autoApplyLanguages).toBe(true); // from defaults
			expect(result.syncSettings).toBeDefined(); // merged from defaults
		});

		it('should throw error for invalid JSON', () => {
			mockFs.default.existsSync.mockReturnValue(true);
			mockFs.default.readFileSync.mockReturnValue('invalid json{');

			expect(() => readLinearConfig('/test/linear-config.json')).toThrow(
				CONFIG_MANAGER_ERRORS.PARSE_ERROR
			);
		});

		it('should throw error on file read failure', () => {
			mockFs.default.existsSync.mockReturnValue(true);
			mockFs.default.readFileSync.mockImplementation(() => {
				throw new Error('Permission denied');
			});

			expect(() => readLinearConfig('/test/linear-config.json')).toThrow(
				CONFIG_MANAGER_ERRORS.FILE_NOT_FOUND
			);
		});
	});

	describe('writeLinearConfig', () => {
		it('should write valid config file', async () => {
			const config = {
				version: '1.0.0',
				labelPreferences: {
					categories: {},
					automation: { autoApplyTaskmaster: true }
				},
				syncSettings: {
					mode: 'one-way',
					batchSize: 10
				}
			};

			mockFs.default.existsSync.mockReturnValue(true);
			mockFs.default.readFileSync.mockReturnValue(JSON.stringify(config));

			await writeLinearConfig(config, '/test/linear-config.json');

			expect(mockFs.default.writeFileSync).toHaveBeenCalledWith(
				'/test/linear-config.json',
				JSON.stringify(config, null, 2),
				'utf8'
			);
		});

		it('should create directory if it does not exist', async () => {
			const config = { ...DEFAULT_LINEAR_CONFIG };

			mockFs.default.existsSync.mockReturnValueOnce(false); // directory doesn't exist
			mockFs.default.existsSync.mockReturnValueOnce(true); // file exists after write
			mockFs.default.readFileSync.mockReturnValue(JSON.stringify(config));

			await writeLinearConfig(config, '/new/path/linear-config.json');

			expect(mockFs.default.mkdirSync).toHaveBeenCalledWith('/new/path', {
				recursive: true
			});
		});

		it('should throw error for invalid config', async () => {
			const invalidConfig = {
				// missing required fields
				version: '1.0.0'
			};

			await expect(
				writeLinearConfig(invalidConfig, '/test/linear-config.json')
			).rejects.toThrow(CONFIG_MANAGER_ERRORS.VALIDATION_ERROR);
		});

		it('should throw error on write failure', async () => {
			const config = { ...DEFAULT_LINEAR_CONFIG };

			mockFs.default.writeFileSync.mockImplementation(() => {
				throw new Error('Disk full');
			});

			await expect(
				writeLinearConfig(config, '/test/linear-config.json')
			).rejects.toThrow(CONFIG_MANAGER_ERRORS.WRITE_ERROR);
		});

		it('should throw error on verification failure', async () => {
			const config = { ...DEFAULT_LINEAR_CONFIG };

			mockFs.default.readFileSync.mockReturnValue('{"different": "content"}');

			await expect(
				writeLinearConfig(config, '/test/linear-config.json')
			).rejects.toThrow(CONFIG_MANAGER_ERRORS.WRITE_ERROR);
		});
	});

	describe('validateLinearConfig', () => {
		it('should validate correct configuration', () => {
			const validConfig = {
				version: '1.0.0',
				labelPreferences: {
					categories: {},
					automation: {
						autoApplyTaskmaster: true,
						autoApplyLanguages: false
					}
				},
				syncSettings: {
					mode: 'one-way',
					batchSize: 10,
					retryAttempts: 3
				}
			};

			const result = validateLinearConfig(validConfig);

			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		it('should detect missing required fields', () => {
			const invalidConfig = {
				version: '1.0.0'
				// missing labelPreferences and syncSettings
			};

			const result = validateLinearConfig(invalidConfig);

			expect(result.valid).toBe(false);
			expect(result.errors).toContain(
				'Missing required field: labelPreferences'
			);
			expect(result.errors).toContain('Missing required field: syncSettings');
		});

		it('should validate version field type', () => {
			const invalidConfig = {
				version: 123, // should be string
				labelPreferences: { categories: {}, automation: {} },
				syncSettings: { mode: 'one-way' }
			};

			const result = validateLinearConfig(invalidConfig);

			expect(result.valid).toBe(false);
			expect(result.errors).toContain('Version must be a string');
		});

		it('should validate sync settings numeric ranges', () => {
			const invalidConfig = {
				version: '1.0.0',
				labelPreferences: { categories: {}, automation: {} },
				syncSettings: {
					mode: 'one-way',
					batchSize: 100, // too high (max 50)
					retryAttempts: 0, // too low (min 1)
					retryDelay: 50000 // too high (max 10000)
				}
			};

			const result = validateLinearConfig(invalidConfig);

			expect(result.valid).toBe(false);
			expect(result.errors.some((e) => e.includes('batchSize'))).toBe(true);
			expect(result.errors.some((e) => e.includes('retryAttempts'))).toBe(true);
			expect(result.errors.some((e) => e.includes('retryDelay'))).toBe(true);
		});

		it('should warn about boolean field type mismatches', () => {
			const configWithWarnings = {
				version: '1.0.0',
				labelPreferences: {
					categories: {},
					automation: {
						autoApplyTaskmaster: 'true' // should be boolean
					}
				},
				syncSettings: {
					mode: 'one-way',
					createMissing: 'false' // should be boolean
				}
			};

			const result = validateLinearConfig(configWithWarnings);

			expect(
				result.warnings.some((w) => w.includes('autoApplyTaskmaster'))
			).toBe(true);
			expect(result.warnings.some((w) => w.includes('createMissing'))).toBe(
				true
			);
		});

		it('should warn about possible secrets in config', () => {
			const configWithSecrets = {
				version: '1.0.0',
				labelPreferences: { categories: {}, automation: {} },
				syncSettings: { mode: 'one-way' },
				apiKey: 'secret_key', // should not be in config
				team_id: 'team123' // should not be in config
			};

			const result = validateLinearConfig(configWithSecrets);

			expect(result.warnings.some((w) => w.includes('apikey'))).toBe(true);
			expect(result.warnings.some((w) => w.includes('team_id'))).toBe(true);
		});

		it('should validate sync mode values', () => {
			const invalidConfig = {
				version: '1.0.0',
				labelPreferences: { categories: {}, automation: {} },
				syncSettings: {
					mode: 'three-way' // invalid mode
				}
			};

			const result = validateLinearConfig(invalidConfig);

			expect(result.warnings.some((w) => w.includes('syncSettings.mode'))).toBe(
				true
			);
		});
	});

	describe('formatLinearConfig', () => {
		it('should format wizard selections into config', () => {
			const selections = {
				labelConfiguration: {
					categories: {
						core: { enabled: true },
						types: { enabled: false }
					},
					automation: {
						autoApplyTaskmaster: true,
						autoApplyLanguages: false
					}
				},
				syncSettings: {
					mode: 'one-way',
					batchSize: 20
				},
				automation: {
					enabled: true,
					rules: ['rule1']
				},
				uiPreferences: {
					defaultView: 'list',
					groupBy: 'assignee'
				}
			};

			const result = formatLinearConfig(selections);

			expect(result.labelPreferences.categories.core.enabled).toBe(true);
			expect(result.labelPreferences.categories.types.enabled).toBe(false);
			expect(result.labelPreferences.automation.autoApplyTaskmaster).toBe(true);
			expect(result.syncSettings.mode).toBe('one-way');
			expect(result.syncSettings.batchSize).toBe(20);
			expect(result.automation.enabled).toBe(true);
			expect(result.automation.rules).toContain('rule1');
			expect(result.ui.defaultView).toBe('list');
			expect(result.ui.groupBy).toBe('assignee');
			expect(result.metadata.createdAt).toBeDefined();
			expect(result.metadata.createdBy).toBe('taskmaster-linear-wizard');
		});

		it('should use defaults when selections are empty', () => {
			const selections = {};

			const result = formatLinearConfig(selections);

			expect(result).toEqual(expect.objectContaining(DEFAULT_LINEAR_CONFIG));
			expect(result.metadata).toBeDefined();
		});

		it('should partially merge wizard selections', () => {
			const selections = {
				labelConfiguration: {
					automation: {
						autoApplyTaskmaster: false
					}
				}
			};

			const result = formatLinearConfig(selections);

			expect(result.labelPreferences.automation.autoApplyTaskmaster).toBe(
				false
			);
			expect(result.labelPreferences.automation.autoApplyLanguages).toBe(true); // from defaults
			expect(result.syncSettings).toEqual(DEFAULT_LINEAR_CONFIG.syncSettings);
		});
	});

	describe('mergeWithDefaults', () => {
		it('should deep merge configuration with defaults', () => {
			const userConfig = {
				version: '2.0.0',
				labelPreferences: {
					automation: {
						autoApplyTaskmaster: false
					}
				},
				newField: 'custom'
			};

			const result = mergeWithDefaults(userConfig);

			expect(result.version).toBe('2.0.0'); // user value
			expect(result.labelPreferences.automation.autoApplyTaskmaster).toBe(
				false
			); // user value
			expect(result.labelPreferences.automation.autoApplyLanguages).toBe(true); // default value
			expect(result.syncSettings).toEqual(DEFAULT_LINEAR_CONFIG.syncSettings); // default object
			expect(result.newField).toBe('custom'); // user addition
		});

		it('should handle arrays properly', () => {
			const userConfig = {
				automation: {
					rules: ['custom-rule']
				}
			};

			const result = mergeWithDefaults(userConfig);

			expect(result.automation.rules).toEqual(['custom-rule']); // user array replaces default
			expect(result.automation.enabled).toBe(true); // default value preserved
		});
	});

	describe('getLinearConfigPath', () => {
		it('should return correct config path', () => {
			const result = getLinearConfigPath('/test/project');

			expect(result).toBe('/test/project/.taskmaster/linear-config.json');
		});
	});

	describe('linearConfigExists', () => {
		it('should return true if config file exists', () => {
			mockFs.default.existsSync.mockReturnValue(true);

			const result = linearConfigExists('/test/project');

			expect(result).toBe(true);
			expect(mockFs.default.existsSync).toHaveBeenCalledWith(
				'/test/project/.taskmaster/linear-config.json'
			);
		});

		it('should return false if config file does not exist', () => {
			mockFs.default.existsSync.mockReturnValue(false);

			const result = linearConfigExists('/test/project');

			expect(result).toBe(false);
		});
	});

	describe('updateLinearConfigSection', () => {
		it('should update specific config section', async () => {
			const existingConfig = {
				version: '1.0.0',
				labelPreferences: {
					categories: { core: { enabled: true } },
					automation: { autoApplyTaskmaster: true }
				},
				syncSettings: { mode: 'one-way' }
			};

			const updateData = {
				automation: { autoApplyTaskmaster: false }
			};

			mockFs.default.existsSync.mockReturnValue(true);

			// Mock the writeFileSync to capture what's being written
			let writtenConfig;
			mockFs.default.writeFileSync.mockImplementation((path, content) => {
				writtenConfig = JSON.parse(content);
			});

			// Mock read calls: initial read and verification read returns the same as written
			mockFs.default.readFileSync
				.mockReturnValueOnce(JSON.stringify(existingConfig))
				.mockImplementation(() => JSON.stringify(writtenConfig));

			await updateLinearConfigSection(
				'/test/project',
				'labelPreferences',
				updateData
			);

			expect(mockFs.default.writeFileSync).toHaveBeenCalledWith(
				'/test/project/.taskmaster/linear-config.json',
				expect.stringContaining('"autoApplyTaskmaster": false'),
				'utf8'
			);
		});

		it('should throw error for unknown section', async () => {
			mockFs.default.existsSync.mockReturnValue(true);
			mockFs.default.readFileSync.mockReturnValue(
				JSON.stringify(DEFAULT_LINEAR_CONFIG)
			);

			await expect(
				updateLinearConfigSection('/test/project', 'unknownSection', {})
			).rejects.toThrow('Unknown configuration section: unknownSection');
		});
	});

	describe('DEFAULT_LINEAR_CONFIG', () => {
		it('should have all required fields', () => {
			expect(DEFAULT_LINEAR_CONFIG.version).toBeDefined();
			expect(DEFAULT_LINEAR_CONFIG.labelPreferences).toBeDefined();
			expect(DEFAULT_LINEAR_CONFIG.syncSettings).toBeDefined();
			expect(DEFAULT_LINEAR_CONFIG.mappings).toBeDefined();
			expect(DEFAULT_LINEAR_CONFIG.automation).toBeDefined();
			expect(DEFAULT_LINEAR_CONFIG.ui).toBeDefined();
		});

		it('should have valid default values', () => {
			const validation = validateLinearConfig(DEFAULT_LINEAR_CONFIG);

			expect(validation.valid).toBe(true);
			expect(validation.errors).toHaveLength(0);
		});
	});
});
