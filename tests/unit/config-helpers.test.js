import { jest } from '@jest/globals';

// Mock dependencies first
const mockGetConfig = jest.fn();
const mockWriteConfig = jest.fn();
const mockValidateConfig = jest.fn();
const mockNormalizeConfig = jest.fn();
const mockLog = jest.fn();

jest.unstable_mockModule('../../scripts/modules/config-manager.js', () => ({
	getConfig: mockGetConfig,
	writeConfig: mockWriteConfig
}));

jest.unstable_mockModule(
	'../../scripts/modules/validation/validators.js',
	() => ({
		validateConfig: mockValidateConfig
	})
);

jest.unstable_mockModule(
	'../../scripts/modules/validation/sanitizers.js',
	() => ({
		normalizeConfig: mockNormalizeConfig
	})
);

jest.unstable_mockModule('../../scripts/modules/utils.js', () => ({
	log: mockLog
}));

// Import after mocking
const {
	getConfigValue,
	getConfigValues,
	setConfigValue,
	setConfigValues,
	mergeConfig,
	hasConfigPath,
	deleteConfigValue,
	getTypedConfigValue,
	getModelConfig,
	setModelConfig,
	getLinearConfig,
	setLinearConfig,
	getGlobalConfig,
	setGlobalConfig
} = await import('../../scripts/modules/config-helpers.js');

describe('Config Helpers', () => {
	const mockConfig = {
		models: {
			main: {
				provider: 'anthropic',
				modelId: 'claude-3-5-sonnet',
				maxTokens: 64000,
				temperature: 0.2
			},
			research: {
				provider: 'perplexity',
				modelId: 'sonar-pro',
				maxTokens: 8700,
				temperature: 0.1
			}
		},
		global: {
			logLevel: 'info',
			debug: false,
			defaultSubtasks: 5,
			projectName: 'Test Project'
		},
		integrations: {
			linear: {
				enabled: true,
				apiKey: '${LINEAR_API_KEY}',
				team: {
					id: '123e4567-e89b-12d3-a456-426614174000',
					name: 'Test Team'
				}
			}
		}
	};

	beforeEach(() => {
		jest.clearAllMocks();
		mockGetConfig.mockReturnValue(JSON.parse(JSON.stringify(mockConfig))); // Deep clone to avoid mutations
		mockWriteConfig.mockResolvedValue(true);
		mockValidateConfig.mockReturnValue({
			valid: true,
			errors: [],
			warnings: []
		});
		mockNormalizeConfig.mockImplementation((config) => config);
	});

	describe('getConfigValue', () => {
		test('should get nested value using dot notation', () => {
			const result = getConfigValue('models.main.provider');
			expect(result).toBe('anthropic');
		});

		test('should return default value for non-existent path', () => {
			const result = getConfigValue('models.nonexistent.provider', 'default');
			expect(result).toBe('default');
		});

		test('should return default value when config is null', () => {
			mockGetConfig.mockReturnValue(null);
			const result = getConfigValue('models.main.provider', 'default');
			expect(result).toBe('default');
		});

		test('should handle deep nested paths', () => {
			const result = getConfigValue('integrations.linear.team.id');
			expect(result).toBe('123e4567-e89b-12d3-a456-426614174000');
		});

		test('should validate config when requested', () => {
			getConfigValue('models.main.provider', null, { validate: true });
			expect(mockValidateConfig).toHaveBeenCalledWith(mockConfig, {
				projectRoot: null
			});
		});

		test('should handle validation errors gracefully', () => {
			mockValidateConfig.mockReturnValue({
				valid: false,
				errors: [{ message: 'Test error' }],
				warnings: []
			});

			const result = getConfigValue('models.main.provider', 'default', {
				validate: true
			});
			expect(result).toBe('anthropic'); // Should still return value
			expect(mockLog).toHaveBeenCalledWith(
				'warn',
				expect.stringContaining('Configuration validation failed')
			);
		});

		test('should handle errors gracefully', () => {
			mockGetConfig.mockImplementation(() => {
				throw new Error('Config error');
			});

			const result = getConfigValue('models.main.provider', 'default');
			expect(result).toBe('default');
			expect(mockLog).toHaveBeenCalledWith(
				'error',
				expect.stringContaining('Error retrieving config value')
			);
		});
	});

	describe('getConfigValues', () => {
		test('should get multiple values using string paths', () => {
			const paths = [
				'models.main.provider',
				'models.research.provider',
				'global.logLevel'
			];
			const result = getConfigValues(paths);

			expect(result).toEqual({
				'models.main.provider': 'anthropic',
				'models.research.provider': 'perplexity',
				'global.logLevel': 'info'
			});
		});

		test('should get multiple values using object specifications', () => {
			const paths = [
				{ path: 'models.main.provider', key: 'mainProvider' },
				{
					path: 'models.research.provider',
					key: 'researchProvider',
					defaultValue: 'unknown'
				},
				{ path: 'nonexistent.path', key: 'missing', defaultValue: 'fallback' }
			];
			const result = getConfigValues(paths);

			expect(result).toEqual({
				mainProvider: 'anthropic',
				researchProvider: 'perplexity',
				missing: 'fallback'
			});
		});
	});

	describe('setConfigValue', () => {
		test('should set a nested value using dot notation', () => {
			const result = setConfigValue('models.main.provider', 'openai');

			expect(result.success).toBe(true);
			expect(mockWriteConfig).toHaveBeenCalled();

			// Check that the config was modified correctly
			const writtenConfig = mockWriteConfig.mock.calls[0][0];
			expect(writtenConfig.models.main.provider).toBe('openai');
		});

		test('should create nested structure for non-existent paths', () => {
			const result = setConfigValue('models.fallback.provider', 'anthropic');

			expect(result.success).toBe(true);
			const writtenConfig = mockWriteConfig.mock.calls[0][0];
			expect(writtenConfig.models.fallback.provider).toBe('anthropic');
		});

		test('should validate config after setting when requested', () => {
			setConfigValue('models.main.provider', 'openai', { validate: true });
			expect(mockValidateConfig).toHaveBeenCalled();
		});

		test('should fail when validation fails', () => {
			mockValidateConfig.mockReturnValue({
				valid: false,
				errors: [{ message: 'Invalid provider' }],
				warnings: []
			});

			const result = setConfigValue('models.main.provider', 'invalid', {
				validate: true
			});
			expect(result.success).toBe(false);
			expect(result.error).toContain('Configuration validation failed');
			expect(mockWriteConfig).not.toHaveBeenCalled();
		});

		test('should normalize config when requested', () => {
			setConfigValue('models.main.provider', 'openai', { normalize: true });
			expect(mockNormalizeConfig).toHaveBeenCalled();
		});

		test('should handle merge option correctly', () => {
			const result = setConfigValue('models.main.provider', 'openai', {
				merge: false
			});

			expect(result.success).toBe(true);
			// Should have created a config with only the set value
			const writtenConfig = mockWriteConfig.mock.calls[0][0];
			expect(writtenConfig.models.main.provider).toBe('openai');
		});

		test('should handle errors gracefully', () => {
			mockWriteConfig.mockImplementation(() => {
				throw new Error('Write error');
			});

			const result = setConfigValue('models.main.provider', 'openai');
			expect(result.success).toBe(false);
			expect(result.error).toContain('Error setting config value');
		});
	});

	describe('setConfigValues', () => {
		test('should set multiple values in bulk', () => {
			const updates = {
				'models.main.provider': 'openai',
				'models.research.provider': 'anthropic',
				'global.debug': true
			};

			const result = setConfigValues(updates);
			expect(result.success).toBe(true);
			expect(result.updatedPaths).toEqual(Object.keys(updates));

			const writtenConfig = mockWriteConfig.mock.calls[0][0];
			expect(writtenConfig.models.main.provider).toBe('openai');
			expect(writtenConfig.models.research.provider).toBe('anthropic');
			expect(writtenConfig.global.debug).toBe(true);
		});

		test('should validate after bulk updates', () => {
			const updates = { 'models.main.provider': 'openai' };
			setConfigValues(updates, { validate: true });
			expect(mockValidateConfig).toHaveBeenCalled();
		});

		test('should handle validation failures in bulk updates', () => {
			mockValidateConfig.mockReturnValue({
				valid: false,
				errors: [{ message: 'Bulk validation error' }],
				warnings: []
			});

			const updates = { 'models.main.provider': 'invalid' };
			const result = setConfigValues(updates, { validate: true });

			expect(result.success).toBe(false);
			expect(result.error).toContain(
				'Configuration validation failed after bulk update'
			);
		});
	});

	describe('mergeConfig', () => {
		test('should merge configurations deeply', () => {
			const target = {
				models: {
					main: { provider: 'anthropic' }
				},
				global: { debug: false }
			};

			const source = {
				models: {
					main: { maxTokens: 32000 },
					research: { provider: 'perplexity' }
				},
				global: { logLevel: 'debug' }
			};

			const result = mergeConfig(target, source);
			expect(result.success).toBe(true);

			const mergedConfig = result.config;
			expect(mergedConfig.models.main.provider).toBe('anthropic'); // Preserved
			expect(mergedConfig.models.main.maxTokens).toBe(32000); // Added
			expect(mergedConfig.models.research.provider).toBe('perplexity'); // Added
			expect(mergedConfig.global.debug).toBe(false); // Preserved
			expect(mergedConfig.global.logLevel).toBe('debug'); // Added
		});

		test('should validate merged configuration', () => {
			const target = { models: { main: { provider: 'anthropic' } } };
			const source = { models: { research: { provider: 'perplexity' } } };

			mergeConfig(target, source, { validate: true });
			expect(mockValidateConfig).toHaveBeenCalled();
		});

		test('should normalize merged configuration', () => {
			const target = { models: { main: { provider: 'anthropic' } } };
			const source = { models: { research: { provider: 'perplexity' } } };

			mergeConfig(target, source, { normalize: true });
			expect(mockNormalizeConfig).toHaveBeenCalled();
		});
	});

	describe('hasConfigPath', () => {
		test('should return true for existing paths', () => {
			expect(hasConfigPath('models.main.provider')).toBe(true);
			expect(hasConfigPath('integrations.linear.team.id')).toBe(true);
		});

		test('should return false for non-existent paths', () => {
			expect(hasConfigPath('models.nonexistent.provider')).toBe(false);
			expect(hasConfigPath('invalid.path')).toBe(false);
		});

		test('should return false when config is null', () => {
			mockGetConfig.mockReturnValue(null);
			expect(hasConfigPath('models.main.provider')).toBe(false);
		});

		test('should handle errors gracefully', () => {
			mockGetConfig.mockImplementation(() => {
				throw new Error('Config error');
			});

			expect(hasConfigPath('models.main.provider')).toBe(false);
		});
	});

	describe('deleteConfigValue', () => {
		test('should delete a configuration value', () => {
			const result = deleteConfigValue('models.main.temperature');
			expect(result.success).toBe(true);

			const writtenConfig = mockWriteConfig.mock.calls[0][0];
			expect(writtenConfig.models.main.temperature).toBeUndefined();
			expect(writtenConfig.models.main.provider).toBe('anthropic'); // Other values preserved
		});

		test('should validate after deletion', () => {
			deleteConfigValue('models.main.temperature', { validate: true });
			expect(mockValidateConfig).toHaveBeenCalled();
		});

		test('should handle validation failures', () => {
			mockValidateConfig.mockReturnValue({
				valid: false,
				errors: [{ message: 'Validation error after deletion' }],
				warnings: []
			});

			const result = deleteConfigValue('models.main.provider', {
				validate: true
			});
			expect(result.success).toBe(false);
			expect(result.error).toContain(
				'Configuration validation failed after deleting'
			);
		});

		test('should handle missing config', () => {
			mockGetConfig.mockReturnValue(null);
			const result = deleteConfigValue('models.main.provider');
			expect(result.success).toBe(false);
			expect(result.error).toBe('Configuration not found');
		});
	});

	describe('getTypedConfigValue', () => {
		test('should return value with correct type when types match', () => {
			const result = getTypedConfigValue(
				'models.main.provider',
				'default',
				'string'
			);
			expect(result).toBe('anthropic');
			expect(typeof result).toBe('string');
		});

		test('should convert string to number', () => {
			// Mock a string value that should be a number
			const configWithStringNumber = { ...mockConfig };
			configWithStringNumber.models.main.maxTokens = '64000';
			mockGetConfig.mockReturnValue(configWithStringNumber);

			const result = getTypedConfigValue('models.main.maxTokens', 0, 'number');
			expect(result).toBe(64000);
			expect(typeof result).toBe('number');
		});

		test('should convert string to boolean', () => {
			const configWithStringBoolean = { ...mockConfig };
			configWithStringBoolean.global.debug = 'true';
			mockGetConfig.mockReturnValue(configWithStringBoolean);

			const result = getTypedConfigValue('global.debug', false, 'boolean');
			expect(result).toBe(true);
			expect(typeof result).toBe('boolean');
		});

		test('should return default value for invalid conversions', () => {
			const configWithInvalidNumber = { ...mockConfig };
			configWithInvalidNumber.models.main.maxTokens = 'invalid';
			mockGetConfig.mockReturnValue(configWithInvalidNumber);

			const result = getTypedConfigValue(
				'models.main.maxTokens',
				1000,
				'number'
			);
			expect(result).toBe(1000);
		});

		test('should handle conversion errors gracefully', () => {
			const result = getTypedConfigValue(
				'models.main.provider',
				'default',
				'unknown'
			);
			expect(result).toBe('anthropic'); // Returns value as-is for unknown types
		});
	});

	describe('Convenience Functions', () => {
		describe('getModelConfig/setModelConfig', () => {
			test('should get model configuration for specific role', () => {
				const result = getModelConfig('main');
				expect(result).toEqual(mockConfig.models.main);
			});

			test('should set model configuration for specific role', () => {
				const newConfig = { provider: 'openai', modelId: 'gpt-4' };
				const result = setModelConfig('research', newConfig);

				expect(result.success).toBe(true);
				const writtenConfig = mockWriteConfig.mock.calls[0][0];
				expect(writtenConfig.models.research).toEqual(newConfig);
			});
		});

		describe('getLinearConfig/setLinearConfig', () => {
			test('should get Linear configuration', () => {
				const result = getLinearConfig();
				expect(result).toEqual(mockConfig.integrations.linear);
			});

			test('should set Linear configuration', () => {
				const newConfig = { enabled: false, apiKey: 'new-key' };
				const result = setLinearConfig(newConfig);

				expect(result.success).toBe(true);
				const writtenConfig = mockWriteConfig.mock.calls[0][0];
				expect(writtenConfig.integrations.linear).toEqual(newConfig);
			});
		});

		describe('getGlobalConfig/setGlobalConfig', () => {
			test('should get global configuration', () => {
				const result = getGlobalConfig();
				expect(result).toEqual(mockConfig.global);
			});

			test('should set global configuration', () => {
				const newConfig = { logLevel: 'debug', debug: true };
				const result = setGlobalConfig(newConfig);

				expect(result.success).toBe(true);
				const writtenConfig = mockWriteConfig.mock.calls[0][0];
				expect(writtenConfig.global).toEqual(newConfig);
			});
		});
	});

	describe('Edge Cases and Error Handling', () => {
		test('should handle null/undefined values in paths', () => {
			const configWithNulls = {
				models: {
					main: null
				}
			};
			mockGetConfig.mockReturnValue(configWithNulls);

			const result = getConfigValue('models.main.provider', 'default');
			expect(result).toBe('default');
		});

		test('should handle empty paths', () => {
			const result = getConfigValue('', 'default');
			expect(result).toBe('default');
		});

		test('should handle paths with array indices', () => {
			const configWithArray = {
				items: ['item1', 'item2']
			};
			mockGetConfig.mockReturnValue(configWithArray);

			// Arrays can be accessed by string indices (JavaScript behavior)
			const result = getConfigValue('items.0', 'default');
			expect(result).toBe('item1');

			// Non-existent indices return default
			const result2 = getConfigValue('items.5', 'default');
			expect(result2).toBe('default');
		});

		test('should preserve non-object values when setting nested paths', () => {
			const configWithPrimitive = {
				models: 'not-an-object'
			};
			mockGetConfig.mockReturnValue(configWithPrimitive);

			const result = setConfigValue('models.main.provider', 'anthropic');
			expect(result.success).toBe(true);

			const writtenConfig = mockWriteConfig.mock.calls[0][0];
			expect(writtenConfig.models.main.provider).toBe('anthropic');
		});
	});
});
