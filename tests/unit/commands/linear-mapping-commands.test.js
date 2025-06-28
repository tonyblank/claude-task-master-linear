/**
 * @fileoverview Tests for Linear state mapping CLI commands
 *
 * Tests the three new CLI commands:
 * - linear-refresh-mappings
 * - linear-validate-mappings
 * - linear-debug-mappings
 */

import { jest } from '@jest/globals';

// Mock all dependencies before importing the modules under test
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
			magenta: createChalkFunction('magenta'),
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

// Mock the status mapping manager module
const mockStatusMappingManager = {
	regenerateAllUuidMappings: jest.fn(),
	getCurrentMappingConfiguration: jest.fn(),
	validateStatusMappings: jest.fn(),
	getMappingRecommendations: jest.fn(),
	detectMappingRefreshNeeds: jest.fn()
};

jest.unstable_mockModule(
	'../../../scripts/modules/linear-status-mapping-manager.js',
	() => mockStatusMappingManager
);

// Mock config manager module
const mockConfigManager = {
	getLinearConfig: jest.fn(),
	getLinearApiKey: jest.fn(),
	getLinearTeamId: jest.fn()
};

jest.unstable_mockModule(
	'../../../scripts/modules/config-manager.js',
	() => mockConfigManager
);

// Mock utils module
const mockUtils = {
	log: jest.fn(),
	findProjectRoot: jest.fn(() => '/test/project')
};

jest.unstable_mockModule('../../../scripts/modules/utils.js', () => mockUtils);

// Mock console methods
const mockConsole = {
	log: jest.fn(),
	error: jest.fn()
};

beforeEach(() => {
	global.console = mockConsole;
	jest.clearAllMocks();
});

// Now import the modules under test
const { refreshLinearMappings } = await import(
	'../../../scripts/commands/linear-refresh-mappings.js'
);
const { validateLinearMappings } = await import(
	'../../../scripts/commands/linear-validate-mappings.js'
);
const { debugLinearMappings } = await import(
	'../../../scripts/commands/linear-debug-mappings.js'
);

describe('Linear Mapping Commands', () => {
	describe('linear-refresh-mappings', () => {
		describe('refreshLinearMappings', () => {
			it('should successfully refresh UUID mappings', async () => {
				// Setup mocks
				const mockConfig = {
					effective: { type: 'name', count: 6 },
					hasUuidMappings: false,
					hasNameMappings: true,
					nameMapping: {
						pending: 'Todo',
						'in-progress': 'In Progress',
						review: 'In Review',
						done: 'Done',
						cancelled: 'Canceled',
						deferred: 'Backlog'
					}
				};

				mockStatusMappingManager.getCurrentMappingConfiguration.mockReturnValue(
					mockConfig
				);

				const mockRegenerate = {
					success: true,
					regeneratedCount: 6,
					newMappings: {
						pending: 'uuid-1',
						'in-progress': 'uuid-2',
						review: 'uuid-3',
						done: 'uuid-4',
						cancelled: 'uuid-5',
						deferred: 'uuid-6'
					},
					replacedExisting: false
				};

				mockStatusMappingManager.regenerateAllUuidMappings.mockResolvedValue(
					mockRegenerate
				);

				const mockValidation = {
					valid: true,
					recommendations: ['All mappings are valid']
				};

				mockStatusMappingManager.validateStatusMappings.mockResolvedValue(
					mockValidation
				);

				// Execute function
				const result = await refreshLinearMappings({
					projectRoot: '/test/project',
					validate: false,
					force: false,
					dryRun: false
				});

				// Verify results
				expect(result.success).toBe(true);
				expect(result.regeneratedCount).toBe(6);
				expect(
					mockStatusMappingManager.regenerateAllUuidMappings
				).toHaveBeenCalledWith({
					projectRoot: '/test/project',
					forceRefresh: false
				});
			});

			it('should handle dry run mode', async () => {
				mockStatusMappingManager.getCurrentMappingConfiguration.mockReturnValue(
					{
						effective: { type: 'name', count: 6 },
						hasUuidMappings: false,
						hasNameMappings: true,
						nameMapping: { pending: 'Todo' }
					}
				);

				const result = await refreshLinearMappings({
					dryRun: true,
					projectRoot: '/test/project'
				});

				expect(result.success).toBe(true);
				expect(result.dryRun).toBe(true);
				expect(
					mockStatusMappingManager.regenerateAllUuidMappings
				).not.toHaveBeenCalled();
			});

			it('should handle missing name mappings', async () => {
				mockStatusMappingManager.getCurrentMappingConfiguration.mockReturnValue(
					{
						effective: { type: 'name', count: 0 },
						hasUuidMappings: false,
						hasNameMappings: false,
						nameMapping: {}
					}
				);

				// Mock process.exit to prevent actual exit
				const mockExit = jest
					.spyOn(process, 'exit')
					.mockImplementation(() => {});

				await refreshLinearMappings({
					projectRoot: '/test/project'
				});

				expect(mockExit).toHaveBeenCalledWith(1);
				expect(mockUtils.log).toHaveBeenCalledWith(
					'error',
					'No name-based mappings found to refresh from'
				);

				mockExit.mockRestore();
			});

			it('should handle existing UUID mappings without force flag', async () => {
				mockStatusMappingManager.getCurrentMappingConfiguration.mockReturnValue(
					{
						effective: { type: 'uuid', count: 6 },
						hasUuidMappings: true,
						hasNameMappings: true
					}
				);

				const result = await refreshLinearMappings({
					force: false,
					projectRoot: '/test/project'
				});

				expect(result.success).toBe(false);
				expect(result.reason).toContain('UUID mappings exist');
			});

			it('should handle regeneration errors', async () => {
				mockStatusMappingManager.getCurrentMappingConfiguration.mockReturnValue(
					{
						effective: { type: 'name', count: 6 },
						hasUuidMappings: false,
						hasNameMappings: true,
						nameMapping: { pending: 'Todo' }
					}
				);

				mockStatusMappingManager.regenerateAllUuidMappings.mockResolvedValue({
					success: false,
					error: 'Linear API error',
					details: ['Team not found']
				});

				// Mock process.exit to prevent actual exit
				const mockExit = jest
					.spyOn(process, 'exit')
					.mockImplementation(() => {});

				await refreshLinearMappings({
					projectRoot: '/test/project'
				});

				expect(mockExit).toHaveBeenCalledWith(1);
				expect(mockUtils.log).toHaveBeenCalledWith(
					'error',
					'Failed to regenerate mappings: Linear API error'
				);

				mockExit.mockRestore();
			});
		});
	});

	describe('linear-validate-mappings', () => {
		describe('validateLinearMappings', () => {
			it('should successfully validate mappings', async () => {
				mockStatusMappingManager.getCurrentMappingConfiguration.mockReturnValue(
					{
						isFullyConfigured: true,
						effective: {
							type: 'uuid',
							count: 6,
							mapping: {
								pending: '12345678-1234-1234-1234-123456789abc',
								'in-progress': '12345678-1234-1234-1234-123456789abd',
								review: '12345678-1234-1234-1234-123456789abe',
								done: '12345678-1234-1234-1234-123456789abf',
								cancelled: '12345678-1234-1234-1234-123456789ac0',
								deferred: '12345678-1234-1234-1234-123456789ac1'
							}
						},
						taskMasterStatuses: [
							'pending',
							'in-progress',
							'review',
							'done',
							'cancelled',
							'deferred'
						]
					}
				);

				mockStatusMappingManager.validateStatusMappings.mockResolvedValue({
					valid: true,
					issues: [],
					recommendations: ['All mappings are valid']
				});

				const result = await validateLinearMappings({
					workspace: true,
					projectRoot: '/test/project'
				});

				expect(result.success).toBe(true);
				expect(result.structureValid).toBe(true);
				expect(result.workspaceValid).toBe(true);
			});

			it('should handle configuration errors', async () => {
				mockStatusMappingManager.getCurrentMappingConfiguration.mockReturnValue(
					{
						error: 'Configuration file not found'
					}
				);

				// Mock process.exit to prevent actual exit
				const mockExit = jest
					.spyOn(process, 'exit')
					.mockImplementation(() => {});

				await validateLinearMappings({
					projectRoot: '/test/project'
				});

				expect(mockExit).toHaveBeenCalledWith(1);
				expect(mockUtils.log).toHaveBeenCalledWith(
					'error',
					'Configuration error: Configuration file not found'
				);

				mockExit.mockRestore();
			});

			it('should detect missing status mappings', async () => {
				mockStatusMappingManager.getCurrentMappingConfiguration.mockReturnValue(
					{
						isFullyConfigured: false,
						effective: {
							type: 'uuid',
							count: 4,
							mapping: {
								pending: 'uuid-1',
								'in-progress': 'uuid-2',
								done: 'uuid-3',
								cancelled: 'uuid-4'
							}
						},
						taskMasterStatuses: [
							'pending',
							'in-progress',
							'review',
							'done',
							'cancelled',
							'deferred'
						]
					}
				);

				mockStatusMappingManager.validateStatusMappings.mockResolvedValue({
					valid: true,
					issues: []
				});

				const result = await validateLinearMappings({
					workspace: false,
					projectRoot: '/test/project'
				});

				expect(result.success).toBe(false); // Structure invalid due to missing mappings
				expect(result.structureValid).toBe(false);
				expect(result.issues).toContain(
					'Missing mappings for: review, deferred'
				);
			});

			it('should validate UUID format', async () => {
				mockStatusMappingManager.getCurrentMappingConfiguration.mockReturnValue(
					{
						isFullyConfigured: true,
						effective: {
							type: 'uuid',
							count: 6,
							mapping: {
								pending: 'invalid-uuid',
								'in-progress': 'another-invalid-uuid',
								review: 'uuid-3',
								done: 'uuid-4',
								cancelled: 'uuid-5',
								deferred: 'uuid-6'
							}
						},
						taskMasterStatuses: [
							'pending',
							'in-progress',
							'review',
							'done',
							'cancelled',
							'deferred'
						]
					}
				);

				const result = await validateLinearMappings({
					workspace: false,
					projectRoot: '/test/project'
				});

				expect(result.success).toBe(false);
				expect(result.structureValid).toBe(false);
				expect(result.issues).toEqual(
					expect.arrayContaining([
						expect.stringContaining('Invalid UUID format for "pending"'),
						expect.stringContaining('Invalid UUID format for "in-progress"')
					])
				);
			});

			it('should skip workspace validation when requested', async () => {
				mockStatusMappingManager.getCurrentMappingConfiguration.mockReturnValue(
					{
						isFullyConfigured: true,
						effective: {
							type: 'uuid',
							count: 6,
							mapping: {
								pending: '12345678-1234-1234-1234-123456789abc',
								'in-progress': '12345678-1234-1234-1234-123456789abd',
								review: '12345678-1234-1234-1234-123456789abe',
								done: '12345678-1234-1234-1234-123456789abf',
								cancelled: '12345678-1234-1234-1234-123456789ac0',
								deferred: '12345678-1234-1234-1234-123456789ac1'
							}
						},
						taskMasterStatuses: [
							'pending',
							'in-progress',
							'review',
							'done',
							'cancelled',
							'deferred'
						]
					}
				);

				const result = await validateLinearMappings({
					workspace: false,
					projectRoot: '/test/project'
				});

				expect(result.workspaceChecked).toBe(false);
				expect(
					mockStatusMappingManager.validateStatusMappings
				).not.toHaveBeenCalled();
			});

			it('should handle workspace validation errors', async () => {
				mockStatusMappingManager.getCurrentMappingConfiguration.mockReturnValue(
					{
						isFullyConfigured: true,
						effective: {
							type: 'uuid',
							count: 6,
							mapping: {
								pending: '12345678-1234-1234-1234-123456789abc',
								'in-progress': '12345678-1234-1234-1234-123456789abd',
								review: '12345678-1234-1234-1234-123456789abe',
								done: '12345678-1234-1234-1234-123456789abf',
								cancelled: '12345678-1234-1234-1234-123456789ac0',
								deferred: '12345678-1234-1234-1234-123456789ac1'
							}
						},
						taskMasterStatuses: [
							'pending',
							'in-progress',
							'review',
							'done',
							'cancelled',
							'deferred'
						]
					}
				);

				mockStatusMappingManager.validateStatusMappings.mockRejectedValue(
					new Error('Linear API connection failed')
				);

				const result = await validateLinearMappings({
					workspace: true,
					quiet: false,
					projectRoot: '/test/project'
				});

				expect(result.workspaceValid).toBe(false);
				expect(mockUtils.log).toHaveBeenCalledWith(
					'error',
					'Workspace validation failed: Linear API connection failed'
				);
			});
		});
	});

	describe('linear-debug-mappings', () => {
		describe('debugLinearMappings', () => {
			it('should collect and display debug information', async () => {
				// Setup comprehensive mock data
				mockStatusMappingManager.getCurrentMappingConfiguration.mockReturnValue(
					{
						effective: {
							type: 'uuid',
							count: 6,
							mapping: { pending: 'uuid-1' }
						},
						hasUuidMappings: true,
						hasNameMappings: true,
						isFullyConfigured: true,
						uuidMapping: { pending: 'uuid-1' },
						nameMapping: { pending: 'Todo' },
						taskMasterStatuses: [
							'pending',
							'in-progress',
							'review',
							'done',
							'cancelled',
							'deferred'
						]
					}
				);

				mockConfigManager.getLinearConfig.mockReturnValue({
					team: { id: 'team-123' }
				});
				mockConfigManager.getLinearApiKey.mockReturnValue('linear-api-key');
				mockConfigManager.getLinearTeamId.mockReturnValue('team-123');

				mockStatusMappingManager.getMappingRecommendations.mockResolvedValue({
					recommendations: [
						{
							type: 'performance',
							message: 'Using optimal UUID mappings',
							action: 'No action needed'
						}
					],
					analysis: {
						configurationHealth: 'good',
						performanceImpact: 'optimal',
						maintenanceRequirements: []
					}
				});

				const result = await debugLinearMappings({
					verbose: true,
					projectRoot: '/test/project'
				});

				expect(result.success).toBe(true);
				expect(result.debugInfo).toHaveProperty('configuration');
				expect(result.debugInfo).toHaveProperty('linearConfig');
				expect(result.debugInfo).toHaveProperty('recommendations');
				expect(result.debugInfo.linearConfig.hasConfig).toBe(true);
				expect(result.debugInfo.linearConfig.hasApiKey).toBe(true);
				expect(result.debugInfo.linearConfig.hasTeamId).toBe(true);
			});

			it('should output JSON format when requested', async () => {
				mockStatusMappingManager.getCurrentMappingConfiguration.mockReturnValue(
					{
						effective: { type: 'uuid', count: 6 },
						hasUuidMappings: true,
						hasNameMappings: true,
						isFullyConfigured: true
					}
				);

				mockConfigManager.getLinearConfig.mockReturnValue({});
				mockConfigManager.getLinearApiKey.mockReturnValue(null);
				mockConfigManager.getLinearTeamId.mockReturnValue(null);

				mockStatusMappingManager.getMappingRecommendations.mockResolvedValue({
					recommendations: []
				});

				// Mock JSON.stringify to verify it gets called
				const originalStringify = JSON.stringify;
				JSON.stringify = jest.fn(originalStringify);

				const result = await debugLinearMappings({
					json: true,
					projectRoot: '/test/project'
				});

				expect(result.success).toBe(true);
				expect(JSON.stringify).toHaveBeenCalled();

				// Restore original JSON.stringify
				JSON.stringify = originalStringify;
			});

			it('should handle configuration errors gracefully', async () => {
				mockStatusMappingManager.getCurrentMappingConfiguration.mockImplementation(
					() => {
						throw new Error('Configuration access failed');
					}
				);

				const result = await debugLinearMappings({
					json: false,
					projectRoot: '/test/project'
				});

				expect(result.success).toBe(true);
				expect(result.debugInfo.configuration).toEqual({
					error: 'Configuration access failed'
				});
			});

			it('should check refresh needs when requested', async () => {
				mockStatusMappingManager.getCurrentMappingConfiguration.mockReturnValue(
					{
						effective: { type: 'name', count: 4 },
						hasUuidMappings: false,
						hasNameMappings: true,
						isFullyConfigured: false
					}
				);

				mockStatusMappingManager.getMappingRecommendations.mockResolvedValue({
					recommendations: []
				});

				mockStatusMappingManager.detectMappingRefreshNeeds.mockResolvedValue({
					refreshNeeded: true,
					reasons: ['Configuration incomplete'],
					nextSuggestedRefresh: '2024-01-01T12:00:00.000Z'
				});

				const result = await debugLinearMappings({
					checkNeeds: true,
					projectRoot: '/test/project'
				});

				expect(result.success).toBe(true);
				expect(result.debugInfo.refreshNeeds.refreshNeeded).toBe(true);
				expect(
					mockStatusMappingManager.detectMappingRefreshNeeds
				).toHaveBeenCalledWith({
					projectRoot: '/test/project',
					cacheMaxAge: 60
				});
			});

			it('should handle errors in debug command gracefully', async () => {
				// Setup a configuration that works but other operations fail
				mockStatusMappingManager.getCurrentMappingConfiguration.mockReturnValue(
					{
						effective: { type: 'uuid', count: 6 },
						hasUuidMappings: true,
						hasNameMappings: true,
						isFullyConfigured: true
					}
				);

				mockConfigManager.getLinearConfig.mockReturnValue({});
				mockConfigManager.getLinearApiKey.mockReturnValue(null);
				mockConfigManager.getLinearTeamId.mockReturnValue(null);

				// Make recommendations throw an error - this should not crash the debug command
				mockStatusMappingManager.getMappingRecommendations.mockRejectedValue(
					new Error('Recommendations failed')
				);

				const result = await debugLinearMappings({
					json: false,
					projectRoot: '/test/project'
				});

				// Debug command should still succeed even if some parts fail
				expect(result.success).toBe(true);
				expect(result.debugInfo).toHaveProperty('configuration');
				expect(result.debugInfo).toHaveProperty('linearConfig');
			});
		});
	});
});
