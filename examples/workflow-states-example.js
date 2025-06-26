/**
 * @fileoverview Example demonstrating Linear Workflow States functionality
 *
 * This example shows how to use the new queryWorkflowStates and findWorkflowStateByName
 * methods to dynamically discover and work with Linear team workflow states.
 */

import { LinearIntegrationHandler } from '../scripts/modules/integrations/linear-integration-handler.js';

// Example configuration
const config = {
	apiKey: process.env.LINEAR_API_KEY || 'your-linear-api-key',
	teamId: process.env.LINEAR_TEAM_ID || 'your-team-id',
	createIssues: false // Don't create issues in examples
};

async function demonstrateWorkflowStates() {
	console.log('🔍 Linear Workflow States Example');
	console.log('=====================================\n');

	const handler = new LinearIntegrationHandler(config);

	try {
		// Initialize the handler
		await handler._performInitialization();
		console.log('✅ Linear integration initialized successfully\n');

		// Example 1: Query all workflow states for a team
		console.log('📋 Example 1: Query All Workflow States');
		console.log('----------------------------------------');

		const workflowStates = await handler.queryWorkflowStates(config.teamId);

		console.log(`Found ${workflowStates.states.length} workflow states:\n`);

		workflowStates.states.forEach((state, index) => {
			console.log(`${index + 1}. ${state.name}`);
			console.log(`   ID: ${state.id}`);
			console.log(`   Type: ${state.type}`);
			console.log(`   Color: ${state.color}`);
			console.log(`   Position: ${state.position}\n`);
		});

		// Example 2: Show states grouped by type
		console.log('📊 Example 2: States Grouped by Type');
		console.log('------------------------------------');

		Object.entries(workflowStates.statesByType).forEach(([type, states]) => {
			console.log(`${type.toUpperCase()}:`);
			states.forEach((state) => {
				console.log(`  • ${state.name} (${state.id})`);
			});
			console.log('');
		});

		// Example 3: Find specific states by name
		console.log('🔍 Example 3: Find States by Name');
		console.log('----------------------------------');

		const searchTerms = ['todo', 'progress', 'done', 'review'];

		for (const term of searchTerms) {
			const foundState = await handler.findWorkflowStateByName(
				config.teamId,
				term
			);
			if (foundState) {
				console.log(
					`✅ "${term}" → Found: ${foundState.name} (${foundState.id})`
				);
			} else {
				console.log(`❌ "${term}" → Not found`);
			}
		}

		// Example 4: Cache performance demonstration
		console.log('\n⚡ Example 4: Cache Performance');
		console.log('-------------------------------');

		// Clear cache first
		handler.clearWorkflowStatesCache(config.teamId);

		// Time the first API call
		const start1 = Date.now();
		await handler.queryWorkflowStates(config.teamId, { useCache: false });
		const apiTime = Date.now() - start1;

		// Time the cached call
		const start2 = Date.now();
		await handler.queryWorkflowStates(config.teamId, { useCache: true });
		const cacheTime = Date.now() - start2;

		console.log(`API call time: ${apiTime}ms`);
		console.log(`Cache call time: ${cacheTime}ms`);
		console.log(`Cache speedup: ${Math.round(apiTime / cacheTime)}x faster\n`);

		// Example 5: Fuzzy matching demonstration
		console.log('🎯 Example 5: Fuzzy Matching');
		console.log('-----------------------------');

		const fuzzyTerms = ['prog', 'complet', 'rev', 'back'];

		for (const term of fuzzyTerms) {
			const foundState = await handler.findWorkflowStateByName(
				config.teamId,
				term,
				{
					fuzzyMatch: true
				}
			);
			if (foundState) {
				console.log(`🎯 "${term}" → Fuzzy match: ${foundState.name}`);
			} else {
				console.log(`❌ "${term}" → No fuzzy match found`);
			}
		}

		console.log('\n✨ Workflow states example completed successfully!');
	} catch (error) {
		console.error('❌ Error during workflow states example:', error.message);

		if (error.message.includes('Authentication')) {
			console.log(
				'\n💡 Tip: Make sure you have set your LINEAR_API_KEY and LINEAR_TEAM_ID environment variables'
			);
			console.log('   Example: export LINEAR_API_KEY="lin_api_your_key_here"');
			console.log('   Example: export LINEAR_TEAM_ID="your-team-uuid-here"');
		}
	}
}

// Run the example if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	demonstrateWorkflowStates().catch(console.error);
}

export { demonstrateWorkflowStates };
