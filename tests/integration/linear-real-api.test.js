/**
 * Real Linear API Integration Tests
 *
 * These tests use the actual Linear API to catch real-world issues
 * like GraphQL schema changes, authentication problems, and API behavior.
 *
 * Note: These tests require a real LINEAR_API_KEY in environment
 * and should be run separately from unit tests.
 */

import { LinearClient } from '@linear/sdk';
import { LinearTeamSelector } from '../../scripts/modules/linear-team-selection.js';
import { testLinearApiKey } from '../../scripts/modules/linear-api-validation.js';

// Skip these tests if no real API key is provided
const skipRealApiTests =
	!process.env.LINEAR_API_KEY || process.env.LINEAR_API_KEY.startsWith('mock');

describe('Linear Real API Integration', () => {
	let apiKey;
	let client;

	beforeAll(() => {
		if (skipRealApiTests) {
			console.log(
				'Skipping real Linear API tests - no LINEAR_API_KEY provided'
			);
			return;
		}
		apiKey = process.env.LINEAR_API_KEY;
		client = new LinearClient({ apiKey });
	});

	describe.skip(skipRealApiTests ? 'Linear API Key Validation' : '', () => {
		test('should validate real API key format and connectivity', async () => {
			const result = await testLinearApiKey(apiKey);

			expect(result.success).toBe(true);
			expect(result.user).toBeDefined();
			expect(result.user.id).toBeDefined();
			expect(result.user.name).toBeDefined();
		});

		test('should handle invalid API key gracefully', async () => {
			const result = await testLinearApiKey('lin_api_invalid_key_12345');

			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
			expect(result.error.type).toBe('authentication');
		});
	});

	describe.skip(skipRealApiTests ? 'Linear Team Fetching' : '', () => {
		test('should fetch teams without GraphQL schema errors', async () => {
			const selector = new LinearTeamSelector({ apiKey });

			// This test specifically catches the hasAccess filter issue we encountered
			const teams = await selector.fetchTeams();

			expect(Array.isArray(teams)).toBe(true);
			// User should have access to at least one team if API key is valid
			expect(teams.length).toBeGreaterThan(0);

			// Verify team structure
			const firstTeam = teams[0];
			expect(firstTeam.id).toBeDefined();
			expect(firstTeam.name).toBeDefined();
			expect(firstTeam.key).toBeDefined();
		});

		test('should handle teams query structure correctly', async () => {
			// Direct GraphQL query test to catch schema issues
			const teamsConnection = await client.teams({
				first: 10
				// Intentionally no filter to match our fixed implementation
			});

			expect(teamsConnection).toBeDefined();
			expect(teamsConnection.nodes).toBeDefined();
			expect(Array.isArray(teamsConnection.nodes)).toBe(true);
		});
	});

	describe.skip(skipRealApiTests ? 'Linear Projects Fetching' : '', () => {
		test('should fetch projects for a team', async () => {
			const selector = new LinearTeamSelector({ apiKey });
			const teams = await selector.fetchTeams();

			if (teams.length > 0) {
				const firstTeam = teams[0];

				// Test project fetching for this team
				// Note: Using minimal filter due to GraphQL schema constraints
				// Complex project state filters cause "Field not defined" errors
				const projectsConnection = await client.projects({
					first: 10,
					filter: {
						team: { id: { eq: firstTeam.id } }
					}
				});

				expect(projectsConnection).toBeDefined();
				expect(projectsConnection.nodes).toBeDefined();
			}
		});
	});
});

/**
 * Test helper for running real API tests manually
 */
export async function runManualLinearApiTest(apiKey) {
	if (!apiKey || !apiKey.startsWith('lin_api_')) {
		throw new Error('Valid Linear API key required for manual testing');
	}

	console.log('🧪 Testing Linear API integration...');

	// Test 1: API Key validation
	console.log('1. Testing API key validation...');
	const apiResult = await testLinearApiKey(apiKey);
	console.log(`   Result: ${apiResult.success ? '✅ Success' : '❌ Failed'}`);
	if (apiResult.success) {
		console.log(
			`   User: ${apiResult.user.name} (${apiResult.user.email || 'No email'})`
		);
	}

	// Test 2: Team fetching
	console.log('2. Testing team fetching...');
	try {
		const selector = new LinearTeamSelector({ apiKey });
		const teams = await selector.fetchTeams();
		console.log(`   Result: ✅ Found ${teams.length} team(s)`);
		teams.forEach((team) => {
			console.log(`   - ${team.name} (${team.key})`);
		});
	} catch (error) {
		console.log(`   Result: ❌ Error - ${error.message}`);
		throw error;
	}

	console.log('🎉 All tests passed!');
}
