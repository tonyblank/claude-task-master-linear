/**
 * Comprehensive Configuration Manipulation Tests
 * Tests covering advanced configuration scenarios, edge cases, and manipulation operations
 */

import { jest } from '@jest/globals';

// Mock dependencies first
const mockGetConfig = jest.fn();
const mockWriteConfig = jest.fn();
const mockValidateConfig = jest.fn();
const mockNormalizeConfig = jest.fn();
const mockLog = jest.fn();

jest.unstable_mockModule('../../scripts/modules/config-manager.js', () => ({
	getConfig: mockGetConfig,
	writeConfig: mockWriteConfig,
	validateProvider: jest.fn((provider) =>
		[
			'anthropic',
			'openai',
			'google',
			'perplexity',
			'ollama',
			'openrouter'
		].includes(provider)
	)
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
	log: mockLog,
	resolveEnvVariable: jest.fn((varName) => {
		const mockEnvVars = {
			LINEAR_API_KEY: 'lin_api_test1234567890abcdef1234567890abcdef',
			ANTHROPIC_API_KEY: 'sk-ant-test123',
			OPENAI_API_KEY: 'sk-test123'
		};
		return mockEnvVars[varName] || null;
	})
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

describe('Configuration Manipulation Tests', () => {
	const complexConfig = {
		models: {
			main: {
				provider: 'anthropic',
				modelId: 'claude-3-5-sonnet',
				maxTokens: 64000,
				temperature: 0.2,
				customSettings: {
					enableStreaming: true,
					retryAttempts: 3,
					timeout: 30000
				}
			},
			research: {
				provider: 'perplexity',
				modelId: 'sonar-pro',
				maxTokens: 8700,
				temperature: 0.1,
				customSettings: {
					enableStreaming: false,
					retryAttempts: 2,
					timeout: 45000
				}
			},
			fallback: {
				provider: 'openai',
				modelId: 'gpt-4o',
				maxTokens: 32000,
				temperature: 0.3
			}
		},
		global: {
			logLevel: 'info',
			debug: false,
			defaultSubtasks: 5,
			defaultPriority: 'medium',
			projectName: 'Test Project',
			customSettings: {
				batchSize: 10,
				maxRetries: 3,
				features: ['ai-generation', 'validation', 'auto-sync'],
				experimental: {
					newFeature: true,
					betaMode: false
				}
			}
		},
		integrations: {
			linear: {
				enabled: true,
				apiKey: '${LINEAR_API_KEY}',
				team: {
					id: '123e4567-e89b-12d3-a456-426614174000',
					name: 'Test Team',
					settings: {
						autoAssign: true,
						defaultLabels: ['taskmaster', 'automated']
					}
				},
				project: {
					id: '123e4567-e89b-12d3-a456-426614174001',
					name: 'Test Project'
				},
				sync: {
					autoSync: true,
					syncOnStatusChange: true,
					syncSubtasks: true,
					batchSize: 15,
					retryAttempts: 4,
					customMappings: {
						priority: {
							urgent: 'High Priority',
							normal: 'Medium Priority',
							low: 'Low Priority'
						}
					}
				}
			},
			github: {
				enabled: false,
				token: '${GITHUB_TOKEN}',
				repo: {
					owner: 'test-org',
					name: 'test-repo'
				}
			}
		}
	};

	beforeEach(() => {
		jest.clearAllMocks();
		mockGetConfig.mockReturnValue(JSON.parse(JSON.stringify(complexConfig)));
		mockWriteConfig.mockResolvedValue(true);
		mockValidateConfig.mockReturnValue({
			valid: true,
			errors: [],
			warnings: []
		});
		mockNormalizeConfig.mockImplementation((config) => config);
	});

	describe('Deep Path Manipulation', () => {
		test('should handle deeply nested paths correctly', () => {
			const result = getConfigValue(
				'models.main.customSettings.enableStreaming'
			);
			expect(result).toBe(true);
		});

		test('should handle array access in paths', () => {
			const result = getConfigValue('global.customSettings.features.0');
			expect(result).toBe('ai-generation');
		});

		test('should handle very deep nested paths', () => {
			const result = getConfigValue(
				'global.customSettings.experimental.newFeature'
			);
			expect(result).toBe(true);
		});

		test('should set deeply nested values correctly', () => {
			const result = setConfigValue(
				'integrations.linear.sync.customMappings.priority.critical',
				'Critical Priority'
			);

			expect(result.success).toBe(true);
			expect(mockWriteConfig).toHaveBeenCalled();
			const writtenConfig = mockWriteConfig.mock.calls[0][0];
			expect(
				writtenConfig.integrations.linear.sync.customMappings.priority.critical
			).toBe('Critical Priority');
		});

		test('should create missing intermediate objects', () => {
			const result = setConfigValue(
				'integrations.slack.channels.general',
				'#general'
			);

			expect(result.success).toBe(true);
			const writtenConfig = mockWriteConfig.mock.calls[0][0];
			expect(writtenConfig.integrations.slack.channels.general).toBe(
				'#general'
			);
		});
	});

	describe('Complex Data Type Handling', () => {
		test('should handle array modifications', () => {
			const newFeatures = [
				'ai-generation',
				'validation',
				'auto-sync',
				'notifications'
			];
			const result = setConfigValue(
				'global.customSettings.features',
				newFeatures
			);

			expect(result.success).toBe(true);
			const writtenConfig = mockWriteConfig.mock.calls[0][0];
			expect(writtenConfig.global.customSettings.features).toEqual(newFeatures);
		});

		test('should handle object replacement', () => {
			const newMappings = {
				priority: {
					p0: 'Critical',
					p1: 'High',
					p2: 'Medium',
					p3: 'Low'
				},
				status: {
					todo: 'To Do',
					progress: 'In Progress',
					review: 'Code Review',
					done: 'Completed'
				}
			};

			const result = setConfigValue(
				'integrations.linear.sync.customMappings',
				newMappings
			);

			expect(result.success).toBe(true);
			const writtenConfig = mockWriteConfig.mock.calls[0][0];
			expect(writtenConfig.integrations.linear.sync.customMappings).toEqual(
				newMappings
			);
		});

		test('should handle null and undefined values', () => {
			const result1 = setConfigValue('integrations.github.token', null);
			const result2 = setConfigValue(
				'integrations.github.repo.branch',
				undefined
			);

			expect(result1.success).toBe(true);
			expect(result2.success).toBe(true);

			const writtenConfig1 = mockWriteConfig.mock.calls[0][0];
			const writtenConfig2 = mockWriteConfig.mock.calls[1][0];
			expect(writtenConfig1.integrations.github.token).toBeNull();
			expect(writtenConfig2.integrations.github.repo.branch).toBeUndefined();
		});
	});

	describe('Bulk Operations', () => {
		test('should handle complex bulk updates', () => {
			const updates = {
				'models.main.temperature': 0.5,
				'models.research.maxTokens': 10000,
				'global.logLevel': 'debug',
				'integrations.linear.sync.batchSize': 20,
				'integrations.github.enabled': true,
				'integrations.github.repo.branch': 'main'
			};

			const result = setConfigValues(updates);

			expect(result.success).toBe(true);
			expect(result.updatedPaths).toEqual(Object.keys(updates));

			const writtenConfig = mockWriteConfig.mock.calls[0][0];
			expect(writtenConfig.models.main.temperature).toBe(0.5);
			expect(writtenConfig.models.research.maxTokens).toBe(10000);
			expect(writtenConfig.global.logLevel).toBe('debug');
			expect(writtenConfig.integrations.linear.sync.batchSize).toBe(20);
			expect(writtenConfig.integrations.github.enabled).toBe(true);
			expect(writtenConfig.integrations.github.repo.branch).toBe('main');
		});

		test('should handle bulk retrieval with complex paths', () => {
			const paths = [
				'models.main.customSettings.enableStreaming',
				'global.customSettings.experimental.newFeature',
				'integrations.linear.team.settings.autoAssign',
				'integrations.github.enabled'
			];

			const result = getConfigValues(paths);

			expect(result).toEqual({
				'models.main.customSettings.enableStreaming': true,
				'global.customSettings.experimental.newFeature': true,
				'integrations.linear.team.settings.autoAssign': true,
				'integrations.github.enabled': false
			});
		});

		test('should handle bulk retrieval with custom keys and defaults', () => {
			const pathSpecs = [
				{
					path: 'models.main.customSettings.enableStreaming',
					key: 'mainStreaming'
				},
				{
					path: 'models.nonexistent.setting',
					key: 'missing',
					defaultValue: 'fallback'
				},
				{ path: 'global.customSettings.features', key: 'features' },
				{
					path: 'integrations.slack.enabled',
					key: 'slackEnabled',
					defaultValue: false
				}
			];

			const result = getConfigValues(pathSpecs);

			expect(result).toEqual({
				mainStreaming: true,
				missing: 'fallback',
				features: ['ai-generation', 'validation', 'auto-sync'],
				slackEnabled: false
			});
		});
	});

	describe('Configuration Merging', () => {
		test('should merge complex configurations deeply', () => {
			const baseConfig = {
				models: {
					main: { provider: 'anthropic', maxTokens: 64000 }
				},
				global: {
					logLevel: 'info',
					customSettings: { feature1: true }
				}
			};

			const overlay = {
				models: {
					main: { temperature: 0.3 },
					research: { provider: 'perplexity' }
				},
				global: {
					debug: true,
					customSettings: { feature2: false, feature3: 'new' }
				},
				integrations: {
					linear: { enabled: true }
				}
			};

			const result = mergeConfig(baseConfig, overlay);

			expect(result.success).toBe(true);
			expect(result.config.models.main.provider).toBe('anthropic');
			expect(result.config.models.main.maxTokens).toBe(64000);
			expect(result.config.models.main.temperature).toBe(0.3);
			expect(result.config.models.research.provider).toBe('perplexity');
			expect(result.config.global.logLevel).toBe('info');
			expect(result.config.global.debug).toBe(true);
			expect(result.config.global.customSettings.feature1).toBe(true);
			expect(result.config.global.customSettings.feature2).toBe(false);
			expect(result.config.global.customSettings.feature3).toBe('new');
			expect(result.config.integrations.linear.enabled).toBe(true);
		});

		test('should handle merging with arrays correctly', () => {
			const baseConfig = {
				global: {
					features: ['feature1', 'feature2'],
					settings: { enabled: true }
				}
			};

			const overlay = {
				global: {
					features: ['feature3', 'feature4'],
					newSetting: 'value'
				}
			};

			const result = mergeConfig(baseConfig, overlay);

			expect(result.success).toBe(true);
			expect(result.config.global.features).toEqual(['feature3', 'feature4']); // Arrays are replaced, not merged
			expect(result.config.global.settings.enabled).toBe(true);
			expect(result.config.global.newSetting).toBe('value');
		});
	});

	describe('Path Existence and Validation', () => {
		test('should correctly identify existing complex paths', () => {
			expect(hasConfigPath('models.main.customSettings.enableStreaming')).toBe(
				true
			);
			expect(
				hasConfigPath('global.customSettings.experimental.newFeature')
			).toBe(true);
			expect(
				hasConfigPath('integrations.linear.team.settings.autoAssign')
			).toBe(true);
		});

		test('should correctly identify non-existent paths', () => {
			expect(hasConfigPath('models.main.nonexistent')).toBe(false);
			expect(hasConfigPath('integrations.slack.enabled')).toBe(false);
			expect(
				hasConfigPath('global.customSettings.experimental.missingFeature')
			).toBe(false);
		});

		test('should handle edge cases in path checking', () => {
			expect(hasConfigPath('')).toBe(false);
			expect(hasConfigPath('models')).toBe(true);
			expect(hasConfigPath('nonexistent')).toBe(false);
		});
	});

	describe('Configuration Deletion', () => {
		test('should delete deeply nested values correctly', () => {
			const result = deleteConfigValue(
				'global.customSettings.experimental.newFeature'
			);

			expect(result.success).toBe(true);
			const writtenConfig = mockWriteConfig.mock.calls[0][0];
			expect(
				writtenConfig.global.customSettings.experimental.newFeature
			).toBeUndefined();
			expect(writtenConfig.global.customSettings.experimental.betaMode).toBe(
				false
			); // Other values preserved
		});

		test('should handle deletion of array elements', () => {
			const result = deleteConfigValue('global.customSettings.features.1');

			expect(result.success).toBe(true);
			const writtenConfig = mockWriteConfig.mock.calls[0][0];
			expect(writtenConfig.global.customSettings.features[1]).toBeUndefined();
		});

		test('should handle deletion of entire objects', () => {
			const result = deleteConfigValue('integrations.github');

			expect(result.success).toBe(true);
			const writtenConfig = mockWriteConfig.mock.calls[0][0];
			expect(writtenConfig.integrations.github).toBeUndefined();
			expect(writtenConfig.integrations.linear).toBeDefined(); // Other integrations preserved
		});
	});

	describe('Type-Safe Configuration Access', () => {
		test('should handle complex type conversions', () => {
			// Mock config with string values that need conversion
			const configWithStrings = {
				...complexConfig,
				models: {
					...complexConfig.models,
					main: {
						...complexConfig.models.main,
						maxTokens: '64000',
						temperature: '0.2',
						customSettings: {
							...complexConfig.models.main.customSettings,
							enableStreaming: 'true',
							retryAttempts: '3'
						}
					}
				}
			};
			mockGetConfig.mockReturnValue(configWithStrings);

			expect(getTypedConfigValue('models.main.maxTokens', 0, 'number')).toBe(
				64000
			);
			expect(
				getTypedConfigValue('models.main.temperature', 0.0, 'number')
			).toBe(0.2);
			expect(
				getTypedConfigValue(
					'models.main.customSettings.enableStreaming',
					false,
					'boolean'
				)
			).toBe(true);
			expect(
				getTypedConfigValue(
					'models.main.customSettings.retryAttempts',
					0,
					'number'
				)
			).toBe(3);
		});

		test('should handle invalid type conversions gracefully', () => {
			const configWithInvalidValues = {
				...complexConfig,
				models: {
					...complexConfig.models,
					main: {
						...complexConfig.models.main,
						maxTokens: 'invalid-number',
						customSettings: {
							...complexConfig.models.main.customSettings,
							enableStreaming: 'maybe'
						}
					}
				}
			};
			mockGetConfig.mockReturnValue(configWithInvalidValues);

			expect(getTypedConfigValue('models.main.maxTokens', 1000, 'number')).toBe(
				1000
			);
			expect(
				getTypedConfigValue(
					'models.main.customSettings.enableStreaming',
					false,
					'boolean'
				)
			).toBe(false);
		});

		test('should handle object type validation', () => {
			const result = getTypedConfigValue(
				'integrations.linear.team.settings',
				{},
				'object'
			);
			expect(result).toEqual({
				autoAssign: true,
				defaultLabels: ['taskmaster', 'automated']
			});
		});
	});

	describe('Convenience Functions for Complex Scenarios', () => {
		test('should handle complex model configurations', () => {
			const complexModelConfig = {
				provider: 'anthropic',
				modelId: 'claude-3-5-sonnet',
				maxTokens: 64000,
				temperature: 0.2,
				customSettings: {
					enableStreaming: true,
					systemPrompt: 'You are a helpful assistant',
					tools: ['web_search', 'code_interpreter'],
					safety: {
						filterLevel: 'moderate',
						enableContentFiltering: true
					}
				}
			};

			const result = setModelConfig('main', complexModelConfig);

			expect(result.success).toBe(true);
			const writtenConfig = mockWriteConfig.mock.calls[0][0];
			expect(writtenConfig.models.main).toEqual(complexModelConfig);
		});

		test('should handle complex Linear configurations', () => {
			const complexLinearConfig = {
				enabled: true,
				apiKey: '${LINEAR_API_KEY}',
				team: {
					id: '123e4567-e89b-12d3-a456-426614174000',
					name: 'Engineering Team',
					settings: {
						autoAssign: true,
						defaultAssignee: 'team-lead@example.com',
						defaultLabels: ['taskmaster', 'automated', 'ai-generated'],
						customFields: {
							priority: 'p2',
							effort: 'medium'
						}
					}
				},
				project: {
					id: '123e4567-e89b-12d3-a456-426614174001',
					name: 'Task Management Project',
					settings: {
						defaultState: 'Todo',
						allowSubtasks: true
					}
				},
				sync: {
					autoSync: true,
					syncOnStatusChange: true,
					syncSubtasks: true,
					syncDependencies: true,
					batchSize: 25,
					retryAttempts: 5,
					retryDelay: 2000,
					webhooks: {
						enabled: true,
						url: 'https://api.example.com/webhooks/linear',
						secret: '${LINEAR_WEBHOOK_SECRET}'
					},
					customMappings: {
						priority: {
							urgent: 'High Priority',
							high: 'High Priority',
							medium: 'Medium Priority',
							low: 'Low Priority'
						},
						status: {
							pending: 'Todo',
							'in-progress': 'In Progress',
							review: 'In Review',
							done: 'Done',
							cancelled: 'Cancelled',
							deferred: 'Backlog'
						}
					}
				}
			};

			const result = setLinearConfig(complexLinearConfig);

			expect(result.success).toBe(true);
			const writtenConfig = mockWriteConfig.mock.calls[0][0];
			expect(writtenConfig.integrations.linear).toEqual(complexLinearConfig);
		});

		test('should handle complex global configurations', () => {
			const complexGlobalConfig = {
				logLevel: 'debug',
				debug: true,
				defaultSubtasks: 8,
				defaultPriority: 'high',
				projectName: 'Complex AI Project',
				customSettings: {
					batchSize: 20,
					maxRetries: 5,
					timeout: 60000,
					features: [
						'ai-generation',
						'validation',
						'auto-sync',
						'webhooks',
						'analytics'
					],
					experimental: {
						newAiModel: true,
						betaFeatures: ['voice-input', 'image-analysis'],
						performance: {
							enableCaching: true,
							cacheSize: '100MB',
							enablePrefetch: false
						}
					},
					integrations: {
						enableAll: false,
						whitelist: ['linear', 'github', 'slack'],
						settings: {
							retryStrategy: 'exponential',
							maxConcurrent: 3
						}
					}
				}
			};

			const result = setGlobalConfig(complexGlobalConfig);

			expect(result.success).toBe(true);
			const writtenConfig = mockWriteConfig.mock.calls[0][0];
			expect(writtenConfig.global).toEqual(complexGlobalConfig);
		});
	});

	describe('Error Handling and Edge Cases', () => {
		test('should handle validation errors in complex configurations', () => {
			mockValidateConfig.mockReturnValue({
				valid: false,
				errors: [
					{
						field: 'models.main.provider',
						message: 'Invalid provider',
						code: 'INVALID_PROVIDER'
					},
					{
						field: 'integrations.linear.team.id',
						message: 'Invalid team ID format',
						code: 'INVALID_UUID'
					}
				],
				warnings: []
			});

			const result = setConfigValue('models.main.provider', 'invalid-provider');

			expect(result.success).toBe(false);
			expect(result.error).toContain('Configuration validation failed');
			expect(mockWriteConfig).not.toHaveBeenCalled();
		});

		test('should handle write errors gracefully', () => {
			mockWriteConfig.mockImplementation(() => {
				throw new Error('Disk full');
			});

			const result = setConfigValue('models.main.temperature', 0.5);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Error setting config value');
		});

		test('should handle missing config gracefully', () => {
			mockGetConfig.mockReturnValue(null);

			const result = getConfigValue('models.main.provider', 'default');
			expect(result).toBe('default');

			const deleteResult = deleteConfigValue('models.main.provider');
			expect(deleteResult.success).toBe(false);
			expect(deleteResult.error).toBe('Configuration not found');
		});

		test('should handle extremely long paths', () => {
			const longPath = 'a.'.repeat(50) + 'value';
			const result = setConfigValue(longPath, 'test');

			expect(result.success).toBe(true);
			// The deep nesting should be created successfully
		});

		test('should handle special characters in paths', () => {
			// Note: Our implementation uses dot notation, so periods in keys would be problematic
			// But we can test other special characters
			const result = setConfigValue(
				'integrations.custom-service.api-key',
				'test-key'
			);

			expect(result.success).toBe(true);
			const writtenConfig = mockWriteConfig.mock.calls[0][0];
			expect(writtenConfig.integrations['custom-service']['api-key']).toBe(
				'test-key'
			);
		});
	});
});
