import { jest } from '@jest/globals';
import {
	getLinearConfig,
	getLinearApiKey,
	getLinearTeamId,
	getLinearProjectId,
	isLinearEnabled,
	isLinearAutoSyncEnabled,
	getLinearStatusMapping,
	getLinearPriorityMapping,
	validateLinearApiKey,
	validateLinearTeamId,
	validateLinearProjectId,
	validateLinearConfig
} from '../../scripts/modules/config-manager.js';

// Mock the dependencies
jest.mock('../../scripts/modules/utils.js', () => ({
	log: jest.fn(),
	findProjectRoot: jest.fn(() => '/test/project'),
	resolveEnvVariable: jest.fn((varName) => {
		if (varName === 'LINEAR_API_KEY') {
			return 'lin_api_test1234567890abcdef1234567890abcdef';
		}
		return null;
	})
}));

jest.mock('../../src/utils/path-utils.js', () => ({
	findConfigPath: jest.fn(() => null)
}));

jest.mock('../../src/constants/paths.js', () => ({
	LEGACY_CONFIG_FILE: 'config.json'
}));

describe('Linear Configuration', () => {
	describe('getLinearConfig', () => {
		test('should return default Linear configuration', () => {
			const config = getLinearConfig();

			expect(config).toMatchObject({
				enabled: false,
				apiKey: '${LINEAR_API_KEY}',
				team: { id: null, name: null },
				project: { id: null, name: null },
				labels: {
					enabled: true,
					sourceLabel: 'taskmaster',
					priorityMapping: expect.any(Object),
					statusMapping: expect.any(Object)
				},
				sync: {
					autoSync: true,
					syncOnStatusChange: true,
					syncSubtasks: true,
					syncDependencies: true,
					batchSize: 10,
					retryAttempts: 3,
					retryDelay: 1000
				},
				webhooks: {
					enabled: false,
					url: null,
					secret: null
				}
			});
		});
	});

	describe('getLinearApiKey', () => {
		test.skip('should return placeholder when no environment variable is set', () => {
			const apiKey = getLinearApiKey();
			// Since we're getting defaults and no config file exists, it should return the placeholder
			expect(apiKey).toBe('${LINEAR_API_KEY}');
		});
	});

	describe('feature flags', () => {
		test('isLinearEnabled should return false by default', () => {
			expect(isLinearEnabled()).toBe(false);
		});

		test('isLinearAutoSyncEnabled should return true by default', () => {
			expect(isLinearAutoSyncEnabled()).toBe(true);
		});
	});

	describe('mappings', () => {
		test('should return default status mapping', () => {
			const mapping = getLinearStatusMapping();
			expect(mapping).toMatchObject({
				pending: 'Todo',
				'in-progress': 'In Progress',
				review: 'In Review',
				done: 'Done',
				cancelled: 'Cancelled',
				deferred: 'Backlog'
			});
		});

		test('should return default priority mapping', () => {
			const mapping = getLinearPriorityMapping();
			expect(mapping).toMatchObject({
				high: 'High Priority',
				medium: 'Medium Priority',
				low: 'Low Priority'
			});
		});
	});

	describe('validation functions', () => {
		describe('validateLinearApiKey', () => {
			test('should validate correct Linear API key format', () => {
				expect(
					validateLinearApiKey('lin_api_test1234567890abcdef1234567890abcdef')
				).toBe(true);
			});

			test('should reject invalid API key formats', () => {
				expect(validateLinearApiKey('invalid-key')).toBe(false);
				expect(validateLinearApiKey('api_key_123')).toBe(false);
				expect(validateLinearApiKey('')).toBe(false);
				expect(validateLinearApiKey(null)).toBe(false);
				expect(validateLinearApiKey(undefined)).toBe(false);
			});
		});

		describe('validateLinearTeamId', () => {
			test('should validate correct UUID format', () => {
				expect(
					validateLinearTeamId('123e4567-e89b-12d3-a456-426614174000')
				).toBe(true);
			});

			test('should reject invalid UUID formats', () => {
				expect(validateLinearTeamId('invalid-uuid')).toBe(false);
				expect(validateLinearTeamId('123-456-789')).toBe(false);
				expect(validateLinearTeamId('')).toBe(false);
				expect(validateLinearTeamId(null)).toBe(false);
			});
		});

		describe('validateLinearProjectId', () => {
			test('should validate correct UUID format', () => {
				expect(
					validateLinearProjectId('123e4567-e89b-12d3-a456-426614174000')
				).toBe(true);
			});

			test('should reject invalid UUID formats', () => {
				expect(validateLinearProjectId('invalid-uuid')).toBe(false);
				expect(validateLinearProjectId('')).toBe(false);
				expect(validateLinearProjectId(null)).toBe(false);
			});
		});

		describe('validateLinearConfig', () => {
			test('should validate correct Linear configuration', () => {
				const validConfig = {
					enabled: true,
					apiKey: '${LINEAR_API_KEY}',
					team: {
						id: '123e4567-e89b-12d3-a456-426614174000',
						name: 'Test Team'
					},
					project: {
						id: '123e4567-e89b-12d3-a456-426614174001',
						name: 'Test Project'
					},
					sync: {
						batchSize: 5,
						retryAttempts: 2,
						retryDelay: 500
					}
				};

				const result = validateLinearConfig(validConfig);
				expect(result.valid).toBe(true);
				expect(result.errors).toHaveLength(0);
			});

			test('should reject invalid configuration', () => {
				const invalidConfig = {
					enabled: true,
					apiKey: 'invalid-key',
					team: { id: 'invalid-uuid', name: 'Test Team' },
					project: { id: 'invalid-uuid', name: 'Test Project' },
					sync: {
						batchSize: 100, // Too large
						retryAttempts: 20, // Too large
						retryDelay: 10000 // Too large
					}
				};

				const result = validateLinearConfig(invalidConfig);
				expect(result.valid).toBe(false);
				expect(result.errors.length).toBeGreaterThan(0);
			});

			test('should handle null/undefined config', () => {
				const result = validateLinearConfig(null);
				expect(result.valid).toBe(false);
				expect(result.errors).toContain(
					'Linear configuration must be an object'
				);
			});
		});
	});
});
