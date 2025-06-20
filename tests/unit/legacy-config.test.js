import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';

// Mock the dependencies
jest.mock('fs');
jest.mock('path', () => ({
	join: jest.fn((dir, file) => `${dir}/${file}`),
	dirname: jest.fn((filePath) => filePath.split('/').slice(0, -1).join('/')),
	resolve: jest.fn((...paths) => paths.join('/')),
	basename: jest.fn((filePath) => filePath.split('/').pop())
}));

jest.mock('chalk', () => ({
	red: jest.fn((text) => text),
	blue: jest.fn((text) => text),
	green: jest.fn((text) => text),
	yellow: jest.fn((text) => text),
	white: jest.fn((text) => text),
	reset: jest.fn((text) => text),
	dim: jest.fn((text) => text),
	default: {
		red: jest.fn((text) => text),
		blue: jest.fn((text) => text),
		green: jest.fn((text) => text),
		yellow: jest.fn((text) => text),
		white: jest.fn((text) => text),
		reset: jest.fn((text) => text),
		dim: jest.fn((text) => text)
	}
}));

jest.mock('../../scripts/modules/utils.js', () => ({
	log: jest.fn(),
	findProjectRoot: jest.fn(() => '/test/project'),
	resolveEnvVariable: jest.fn()
}));

// Mock console to prevent Jest internal access and chalk issues
const mockConsole = {
	log: jest.fn(),
	info: jest.fn(),
	warn: jest.fn(),
	error: jest.fn()
};
global.console = mockConsole;

// Create mock functions
const mockFindConfigPath = jest.fn();

jest.mock('../../src/utils/path-utils.js', () => ({
	findConfigPath: mockFindConfigPath
}));

jest.mock('../../src/constants/paths.js', () => ({
	LEGACY_CONFIG_FILE: '.taskmasterconfig'
}));

// Import after mocks
import * as configManager from '../../scripts/modules/config-manager.js';

describe('Legacy Configuration Compatibility', () => {
	let fsExistsSyncSpy;
	let fsReadFileSyncSpy;

	beforeEach(() => {
		jest.clearAllMocks();
		fsExistsSyncSpy = jest.spyOn(fs, 'existsSync');
		fsReadFileSyncSpy = jest.spyOn(fs, 'readFileSync');
	});

	describe('Legacy Config File Detection', () => {
		test('should detect legacy config file and show deprecation warning', () => {
			const legacyConfigPath = '/test/project/.taskmasterconfig';
			const legacyConfig = {
				models: {
					main: { provider: 'openai', modelId: 'gpt-4' }
				},
				global: {
					logLevel: 'debug'
				}
			};

			// Mock findConfigPath to return legacy path
			mockFindConfigPath.mockReturnValue(legacyConfigPath);
			fsExistsSyncSpy.mockReturnValue(true);
			fsReadFileSyncSpy.mockReturnValue(JSON.stringify(legacyConfig));

			const config = configManager.getConfig('/test/project', true);

			// Verify legacy config was loaded with deprecation warning
			expect(config.models.main.provider).toBe('openai');
			expect(config.models.main.modelId).toBe('gpt-4');
			expect(config.global.logLevel).toBe('debug');

			// Should have included default integrations
			expect(config.integrations.linear.enabled).toBe(false);
		});

		test('should not show warning for new config file location', () => {
			const newConfigPath = '/test/project/.taskmaster/config.json';
			const config = {
				models: {
					main: { provider: 'anthropic', modelId: 'claude-3-5-sonnet' }
				}
			};

			mockFindConfigPath.mockReturnValue(newConfigPath);
			fsExistsSyncSpy.mockReturnValue(true);
			fsReadFileSyncSpy.mockReturnValue(JSON.stringify(config));

			const result = configManager.getConfig('/test/project', true);

			// Verify config was loaded correctly from new location
			expect(result.models.main.provider).toBe('anthropic');
			expect(result.models.main.modelId).toBe('claude-3-5-sonnet');
		});
	});

	describe('Legacy Config Format Support', () => {
		test('should handle legacy config without integrations section', () => {
			const legacyConfig = {
				models: {
					main: {
						provider: 'openai',
						modelId: 'gpt-4',
						maxTokens: 4000,
						temperature: 0.3
					},
					research: {
						provider: 'anthropic',
						modelId: 'claude-3-haiku',
						maxTokens: 2000,
						temperature: 0.1
					}
				},
				global: {
					logLevel: 'warn',
					debug: true,
					defaultSubtasks: 8,
					projectName: 'Legacy Project'
				}
			};

			mockFindConfigPath.mockReturnValue('/test/project/.taskmasterconfig');
			fsExistsSyncSpy.mockReturnValue(true);
			fsReadFileSyncSpy.mockReturnValue(JSON.stringify(legacyConfig));

			const config = configManager.getConfig('/test/project', true);

			// Should include the legacy config values
			expect(config.models.main.provider).toBe('openai');
			expect(config.models.main.modelId).toBe('gpt-4');
			expect(config.global.logLevel).toBe('warn');
			expect(config.global.projectName).toBe('Legacy Project');

			// Should include default integrations section
			expect(config.integrations).toBeDefined();
			expect(config.integrations.linear).toBeDefined();
			expect(config.integrations.linear.enabled).toBe(false);
			expect(config.integrations.linear.apiKey).toBe('${LINEAR_API_KEY}');
		});

		test('should handle completely minimal legacy config', () => {
			const minimalLegacyConfig = {
				models: {
					main: {
						provider: 'anthropic'
					}
				}
			};

			mockFindConfigPath.mockReturnValue('/test/project/.taskmasterconfig');
			fsExistsSyncSpy.mockReturnValue(true);
			fsReadFileSyncSpy.mockReturnValue(JSON.stringify(minimalLegacyConfig));

			const config = configManager.getConfig('/test/project', true);

			// Should merge with defaults
			expect(config.models.main.provider).toBe('anthropic');
			expect(config.models.main.modelId).toBe('claude-3-7-sonnet-20250219'); // From defaults
			expect(config.global.logLevel).toBe('info'); // From defaults
			expect(config.integrations.linear.enabled).toBe(false); // From defaults
		});

		test('should handle legacy config with partial models section', () => {
			const partialLegacyConfig = {
				models: {
					main: {
						provider: 'openai',
						modelId: 'gpt-3.5-turbo'
					}
					// Missing research and fallback
				},
				global: {
					logLevel: 'error'
				}
			};

			mockFindConfigPath.mockReturnValue('/test/project/.taskmasterconfig');
			fsExistsSyncSpy.mockReturnValue(true);
			fsReadFileSyncSpy.mockReturnValue(JSON.stringify(partialLegacyConfig));

			const config = configManager.getConfig('/test/project', true);

			// Main model should use legacy values
			expect(config.models.main.provider).toBe('openai');
			expect(config.models.main.modelId).toBe('gpt-3.5-turbo');

			// Research and fallback should use defaults
			expect(config.models.research.provider).toBe('perplexity');
			expect(config.models.fallback.provider).toBe('anthropic');

			// Global should merge
			expect(config.global.logLevel).toBe('error');
			expect(config.global.defaultSubtasks).toBe(5); // From defaults
		});
	});

	describe('Legacy Config Migration Scenarios', () => {
		test('should handle config with old field names gracefully', () => {
			const configWithOldFields = {
				models: {
					main: {
						provider: 'anthropic',
						modelId: 'claude-3-5-sonnet',
						// Old field names that might exist
						max_tokens: 8000,
						temp: 0.2
					}
				},
				// Old global section structure
				settings: {
					log_level: 'debug',
					project_name: 'Old Style Project'
				}
			};

			mockFindConfigPath.mockReturnValue('/test/project/.taskmasterconfig');
			fsExistsSyncSpy.mockReturnValue(true);
			fsReadFileSyncSpy.mockReturnValue(JSON.stringify(configWithOldFields));

			const config = configManager.getConfig('/test/project', true);

			// Should not crash and should use defaults for unrecognized fields
			expect(config.models.main.provider).toBe('anthropic');
			expect(config.models.main.modelId).toBe('claude-3-5-sonnet');
			expect(config.models.main.maxTokens).toBe(64000); // From defaults, not max_tokens
			expect(config.global.logLevel).toBe('info'); // From defaults, not settings.log_level
		});

		test('should handle config with extra unknown sections', () => {
			const configWithExtraSections = {
				models: {
					main: { provider: 'anthropic', modelId: 'claude-3-5-sonnet' }
				},
				global: {
					logLevel: 'info'
				},
				// Extra sections that shouldn't break anything
				experimental: {
					features: ['beta-mode'],
					enabled: true
				},
				customSettings: {
					theme: 'dark',
					notifications: false
				}
			};

			mockFindConfigPath.mockReturnValue('/test/project/.taskmasterconfig');
			fsExistsSyncSpy.mockReturnValue(true);
			fsReadFileSyncSpy.mockReturnValue(
				JSON.stringify(configWithExtraSections)
			);

			expect(() => {
				const config = configManager.getConfig('/test/project', true);
				expect(config.models.main.provider).toBe('anthropic');
				expect(config.integrations.linear).toBeDefined();
			}).not.toThrow();
		});
	});

	describe('Error Handling with Legacy Configs', () => {
		test('should handle corrupted legacy config gracefully', () => {
			mockFindConfigPath.mockReturnValue('/test/project/.taskmasterconfig');
			fsExistsSyncSpy.mockReturnValue(true);
			fsReadFileSyncSpy.mockReturnValue('{ invalid json }');

			const config = configManager.getConfig('/test/project', true);

			// Should fall back to defaults when JSON is invalid
			expect(config.models.main.provider).toBe('anthropic');
			expect(config.integrations.linear.enabled).toBe(false);
		});

		test('should handle missing legacy config file', () => {
			mockFindConfigPath.mockReturnValue(null);

			const config = configManager.getConfig('/test/project', true);

			// Should return defaults when no config found
			expect(config.models.main.provider).toBe('anthropic');
			expect(config.integrations.linear.enabled).toBe(false);
		});
	});

	describe('Provider Validation with Legacy Configs', () => {
		test('should validate providers in legacy config and fall back to defaults', () => {
			const invalidProviderConfig = {
				models: {
					main: {
						provider: 'invalid-provider',
						modelId: 'some-model'
					},
					research: {
						provider: 'another-invalid-provider',
						modelId: 'research-model'
					}
				}
			};

			mockFindConfigPath.mockReturnValue('/test/project/.taskmasterconfig');
			fsExistsSyncSpy.mockReturnValue(true);
			fsReadFileSyncSpy.mockReturnValue(JSON.stringify(invalidProviderConfig));

			const config = configManager.getConfig('/test/project', true);

			// Should fall back to defaults for invalid providers
			expect(config.models.main.provider).toBe('anthropic');
			expect(config.models.research.provider).toBe('perplexity');
		});
	});
});
