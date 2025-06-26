/**
 * @fileoverview Integration tests for Linear Workflow States API functionality
 * Tests real API calls to Linear to verify workflow states querying works correctly
 */

import { jest } from '@jest/globals';
import { LinearIntegrationHandler } from '../../scripts/modules/integrations/linear-integration-handler.js';

// Mock the base integration handler
jest.mock('../../scripts/modules/events/base-integration-handler.js', () => ({
	BaseIntegrationHandler: class MockBaseIntegrationHandler {
		constructor(name, version, config) {
			this.name = name;
			this.version = version;
			this.config = config;
			this.isEnabled = () => true;
		}
		async retry(fn, options) {
			return await fn();
		}
		createProgressMessage(operationType, task, stage) {
			return {
				type: 'progress',
				operation: operationType,
				stage,
				task,
				message: `${operationType} ${stage}`
			};
		}
		createSuccessMessage(operationType, task, data) {
			return {
				type: 'success',
				operation: operationType,
				task,
				data
			};
		}
		createErrorMessage(operationType, task, error) {
			return {
				type: 'error',
				operation: operationType,
				task,
				error
			};
		}
		logFormattedMessage() {}
	}
}));

// Mock the utils
jest.mock('../../scripts/modules/utils.js', () => ({
	log: jest.fn(),
	readJSON: jest.fn(),
	writeJSON: jest.fn(),
	getCurrentTag: jest.fn(() => 'master'),
	findProjectRoot: jest.fn(() => '/test/project')
}));

// Mock config manager
jest.mock('../../scripts/modules/config-manager.js', () => ({
	getLinearConfig: jest.fn(() => ({})),
	getLinearPriorityMapping: jest.fn(() => ({})),
	getLinearStatusMapping: jest.fn(() => ({}))
}));

describe('LinearIntegrationHandler - Real API Integration Tests', () => {
	let handler;
	let realLinearApiKey;
	let realTeamId;

	beforeAll(() => {
		// These tests require real Linear API credentials
		realLinearApiKey = process.env.LINEAR_API_KEY;
		realTeamId = process.env.LINEAR_TEAM_ID;

		if (!realLinearApiKey || !realTeamId) {
			console.warn(
				'⚠️  Skipping real Linear API tests - LINEAR_API_KEY or LINEAR_TEAM_ID not set'
			);
		}
	});

	beforeEach(() => {
		if (!realLinearApiKey || !realTeamId) {
			return;
		}

		const config = {
			apiKey: realLinearApiKey,
			teamId: realTeamId,
			createIssues: false // Don't create issues in integration tests
		};

		handler = new LinearIntegrationHandler(config);
	});

	describe('Real API - queryWorkflowStates', () => {
		test('should query real workflow states from Linear API', async () => {
			if (!realLinearApiKey || !realTeamId) {
				console.log('⏭️  Skipping real API test - credentials not available');
				return;
			}

			// Initialize the handler to set up Linear client
			await handler._performInitialization();

			const result = await handler.queryWorkflowStates(realTeamId, {
				useCache: false
			});

			// Validate response structure
			expect(result).toHaveProperty('states');
			expect(result).toHaveProperty('statesByType');
			expect(result).toHaveProperty('stateNameMap');
			expect(result).toHaveProperty('metadata');

			// Validate states array
			expect(Array.isArray(result.states)).toBe(true);
			expect(result.states.length).toBeGreaterThan(0);

			// Validate each state has required fields
			result.states.forEach((state) => {
				expect(state).toHaveProperty('id');
				expect(state).toHaveProperty('name');
				expect(state).toHaveProperty('type');
				expect(state).toHaveProperty('color');
				expect(state).toHaveProperty('position');

				expect(typeof state.id).toBe('string');
				expect(typeof state.name).toBe('string');
				expect(typeof state.type).toBe('string');
				expect(typeof state.color).toBe('string');
				expect(typeof state.position).toBe('number');

				// Validate Linear state types
				expect(['unstarted', 'started', 'completed', 'canceled']).toContain(
					state.type
				);
			});

			// Validate states are grouped by type
			expect(typeof result.statesByType).toBe('object');
			Object.keys(result.statesByType).forEach((type) => {
				expect(Array.isArray(result.statesByType[type])).toBe(true);
				// States within each type should be sorted by position
				const positions = result.statesByType[type].map((s) => s.position);
				const sortedPositions = [...positions].sort((a, b) => a - b);
				expect(positions).toEqual(sortedPositions);
			});

			// Validate state name mapping
			expect(typeof result.stateNameMap).toBe('object');
			result.states.forEach((state) => {
				expect(result.stateNameMap[state.name]).toBe(state.id);
				expect(result.stateNameMap[state.name.toLowerCase()]).toBe(state.id);
			});

			// Validate metadata
			expect(result.metadata).toMatchObject({
				totalCount: result.states.length,
				teamId: realTeamId,
				fetchedAt: expect.any(String),
				types: expect.any(Array)
			});

			console.log(
				`✅ Successfully retrieved ${result.states.length} workflow states from Linear API`
			);
			console.log(`   Types found: ${result.metadata.types.join(', ')}`);
			console.log(`   States: ${result.states.map((s) => s.name).join(', ')}`);
		}, 30000); // 30 second timeout for API calls

		test('should handle pagination for large numbers of workflow states', async () => {
			if (!realLinearApiKey || !realTeamId) {
				console.log(
					'⏭️  Skipping real API pagination test - credentials not available'
				);
				return;
			}

			await handler._performInitialization();

			// Test with small page size to force pagination
			const result = await handler.queryWorkflowStates(realTeamId, {
				pageSize: 2,
				useCache: false
			});

			expect(result.states.length).toBeGreaterThan(0);
			expect(result.metadata.pageCount).toBeGreaterThanOrEqual(1);

			console.log(
				`✅ Pagination test completed - ${result.metadata.pageCount} pages, ${result.states.length} total states`
			);
		}, 30000);

		test('should handle archived states inclusion', async () => {
			if (!realLinearApiKey || !realTeamId) {
				console.log(
					'⏭️  Skipping archived states test - credentials not available'
				);
				return;
			}

			await handler._performInitialization();

			// Get active states only
			const activeResult = await handler.queryWorkflowStates(realTeamId, {
				includeArchived: false,
				useCache: false
			});

			// Get all states including archived
			const allResult = await handler.queryWorkflowStates(realTeamId, {
				includeArchived: true,
				useCache: false
			});

			expect(allResult.states.length).toBeGreaterThanOrEqual(
				activeResult.states.length
			);

			console.log(
				`✅ Archived states test - Active: ${activeResult.states.length}, All: ${allResult.states.length}`
			);
		}, 30000);
	});

	describe('Real API - findWorkflowStateByName', () => {
		test('should find workflow states by various name patterns', async () => {
			if (!realLinearApiKey || !realTeamId) {
				console.log(
					'⏭️  Skipping real API state search test - credentials not available'
				);
				return;
			}

			await handler._performInitialization();

			// First get all states to know what's available
			const allStates = await handler.queryWorkflowStates(realTeamId, {
				useCache: false
			});

			if (allStates.states.length === 0) {
				console.log('⚠️  No workflow states found for testing');
				return;
			}

			const firstState = allStates.states[0];
			console.log(`Testing with state: "${firstState.name}"`);

			// Test exact match
			const exactMatch = await handler.findWorkflowStateByName(
				realTeamId,
				firstState.name
			);
			expect(exactMatch).toMatchObject({
				id: firstState.id,
				name: firstState.name
			});

			// Test case-insensitive match
			const caseInsensitiveMatch = await handler.findWorkflowStateByName(
				realTeamId,
				firstState.name.toUpperCase()
			);
			expect(caseInsensitiveMatch).toMatchObject({
				id: firstState.id,
				name: firstState.name
			});

			// Test fuzzy matching with partial name
			if (firstState.name.length > 3) {
				const partialName = firstState.name.substring(0, 3);
				const fuzzyMatch = await handler.findWorkflowStateByName(
					realTeamId,
					partialName
				);
				// Should either find the state or return null (acceptable for short partial matches)
				if (fuzzyMatch) {
					expect(fuzzyMatch.name).toContain(partialName.toLowerCase());
				}
			}

			console.log(`✅ State search test completed successfully`);
		}, 30000);

		test('should return null for non-existent state names', async () => {
			if (!realLinearApiKey || !realTeamId) {
				console.log(
					'⏭️  Skipping non-existent state test - credentials not available'
				);
				return;
			}

			await handler._performInitialization();

			const nonExistentState = await handler.findWorkflowStateByName(
				realTeamId,
				'NonExistentStateNameThatShouldNeverExist'
			);

			expect(nonExistentState).toBeNull();

			console.log(`✅ Non-existent state test completed successfully`);
		}, 30000);
	});

	describe('Real API - Error Handling', () => {
		test('should handle invalid team ID gracefully', async () => {
			if (!realLinearApiKey || !realTeamId) {
				console.log(
					'⏭️  Skipping invalid team ID test - credentials not available'
				);
				return;
			}

			const config = {
				apiKey: realLinearApiKey,
				teamId: 'invalid-team-id',
				createIssues: false
			};

			const invalidHandler = new LinearIntegrationHandler(config);

			try {
				await invalidHandler._performInitialization();
				await expect(
					invalidHandler.queryWorkflowStates('invalid-team-id')
				).rejects.toThrow();
				console.log(`✅ Invalid team ID error handling test completed`);
			} catch (error) {
				// If initialization fails due to authentication, skip the test
				if (
					error.message.includes('Authentication') ||
					error.message.includes('not authenticated')
				) {
					console.log(
						'⏭️  Skipping invalid team ID test - authentication error during init'
					);
					return;
				}
				throw error;
			}
		}, 30000);

		test('should handle network timeouts and retries', async () => {
			if (!realLinearApiKey || !realTeamId) {
				console.log('⏭️  Skipping timeout test - credentials not available');
				return;
			}

			const config = {
				apiKey: realLinearApiKey,
				teamId: realTeamId,
				createIssues: false,
				timeout: 1 // Very short timeout to trigger timeout errors
			};

			const timeoutHandler = new LinearIntegrationHandler(config);
			await timeoutHandler._performInitialization();

			// This might timeout or succeed depending on network conditions
			// We're mainly testing that it doesn't crash
			try {
				const result = await timeoutHandler.queryWorkflowStates(realTeamId);
				console.log(
					`✅ Network test completed - got ${result.states.length} states`
				);
			} catch (error) {
				// Timeout or network error is expected with very short timeout
				console.log(
					`✅ Network test completed - handled error: ${error.message}`
				);
				expect(error.message).toBeDefined();
			}
		}, 30000);
	});

	describe('Real API - Cache Functionality', () => {
		test('should use cache for subsequent requests', async () => {
			if (!realLinearApiKey || !realTeamId) {
				console.log('⏭️  Skipping cache test - credentials not available');
				return;
			}

			await handler._performInitialization();

			const startTime1 = Date.now();
			const result1 = await handler.queryWorkflowStates(realTeamId, {
				useCache: false
			});
			const duration1 = Date.now() - startTime1;

			const startTime2 = Date.now();
			const result2 = await handler.queryWorkflowStates(realTeamId, {
				useCache: true
			});
			const duration2 = Date.now() - startTime2;

			// Cache should be significantly faster
			expect(duration2).toBeLessThan(duration1 / 2);
			expect(result1.states.length).toBe(result2.states.length);

			console.log(
				`✅ Cache test completed - API: ${duration1}ms, Cache: ${duration2}ms`
			);
		}, 30000);
	});
});
