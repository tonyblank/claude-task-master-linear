import { jest } from '@jest/globals';

// Import functions to test
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

describe('Linear Configuration', () => {
	describe('getLinearConfig', () => {
		test('should return Linear configuration', () => {
			const config = getLinearConfig();

			// Should return the actual configuration from linear-config.json
			expect(config).toMatchObject({
				enabled: true,
				team: {
					id: expect.any(String), // Environment variable placeholder
					name: expect.any(String)
				},
				project: {
					id: expect.any(String), // Environment variable placeholder
					name: expect.any(String)
				},
				mappings: expect.any(Object)
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
		test('isLinearEnabled should return configured value', () => {
			// Since we have a working linear-config.json, this will return true
			expect(isLinearEnabled()).toBe(true);
		});

		test('isLinearAutoSyncEnabled should return configured value', () => {
			// From our linear-config.json, sync.autoSync is not set, so defaults to false
			expect(isLinearAutoSyncEnabled()).toBe(false);
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
