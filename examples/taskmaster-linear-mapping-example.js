/**
 * @fileoverview Example demonstrating TaskMaster-to-Linear status mapping functionality
 *
 * This example shows how to use the new direct mapping system to resolve TaskMaster
 * task statuses to Linear workflow state UUIDs, generate complete mappings, and
 * validate existing mappings.
 */

import { LinearIntegrationHandler } from '../scripts/modules/integrations/linear-integration-handler.js';

// Example configuration
const config = {
	apiKey: process.env.LINEAR_API_KEY || 'your-linear-api-key',
	teamId: process.env.LINEAR_TEAM_ID || 'your-team-id',
	createIssues: false // Don't create issues in examples
};

async function demonstrateTaskMasterMapping() {
	console.log('🔗 TaskMaster-to-Linear Status Mapping Example');
	console.log('===============================================\n');

	const handler = new LinearIntegrationHandler(config);

	try {
		// Initialize the handler
		await handler._performInitialization();
		console.log('✅ Linear integration initialized successfully\n');

		// Example 1: Resolve individual TaskMaster statuses
		console.log('🎯 Example 1: Resolve Individual TaskMaster Statuses');
		console.log('---------------------------------------------------');

		const taskMasterStatuses = [
			'pending',
			'in-progress',
			'review',
			'done',
			'cancelled',
			'deferred'
		];

		for (const status of taskMasterStatuses) {
			const resolution = await handler.resolveTaskMasterStatusToLinearUUID(
				config.teamId,
				status
			);

			if (resolution.success) {
				console.log(
					`✅ ${status.padEnd(12)} → ${resolution.stateName} (${resolution.uuid}) [${resolution.matchType}]`
				);
			} else {
				console.log(`❌ ${status.padEnd(12)} → Failed: ${resolution.error}`);
			}
		}

		// Example 2: Generate complete UUID mappings
		console.log('\n📋 Example 2: Generate Complete UUID Mappings');
		console.log('----------------------------------------------');

		const mappingResult = await handler.generateTaskMasterUUIDMappings(
			config.teamId,
			{
				includeDetails: true
			}
		);

		if (mappingResult.success) {
			console.log(
				`✅ Generated complete mappings (${mappingResult.successfulMappings}/${mappingResult.totalStatuses})\n`
			);

			console.log('UUID Mappings for Configuration:');
			console.log(JSON.stringify(mappingResult.mappings, null, 2));

			if (mappingResult.details) {
				console.log('\nDetailed Mapping Information:');
				Object.entries(mappingResult.details).forEach(([status, detail]) => {
					console.log(
						`  ${status}: ${detail.stateName} (${detail.stateType}) - ${detail.matchType} match`
					);
				});
			}
		} else {
			console.log(
				`⚠️  Partial mapping generated (${mappingResult.successfulMappings}/${mappingResult.totalStatuses})`
			);

			if (mappingResult.errors) {
				console.log('\nMapping Errors:');
				mappingResult.errors.forEach((error) => {
					console.log(`  ❌ ${error.taskMasterStatus}: ${error.error}`);
				});
			}

			if (Object.keys(mappingResult.mappings).length > 0) {
				console.log('\nSuccessful Mappings:');
				console.log(JSON.stringify(mappingResult.mappings, null, 2));
			}
		}

		// Example 3: Validate existing mappings
		console.log('\n🔍 Example 3: Validate Existing Mappings');
		console.log('---------------------------------------');

		// Use the generated mappings for validation
		if (Object.keys(mappingResult.mappings).length > 0) {
			const validationResult = await handler.validateTaskMasterStatusMappings(
				config.teamId,
				mappingResult.mappings
			);

			console.log(`Validation Results:`);
			console.log(`  ✅ Valid:   ${validationResult.validCount}`);
			console.log(`  ❌ Invalid: ${validationResult.invalidCount}`);
			console.log(`  ❓ Missing: ${validationResult.missingCount}`);

			if (validationResult.success) {
				console.log('  🎉 All mappings are valid!');
			} else {
				if (validationResult.invalidCount > 0) {
					console.log('\n  Invalid Mappings:');
					Object.entries(validationResult.invalidMappings).forEach(
						([status, error]) => {
							console.log(`    ${status}: ${error}`);
						}
					);
				}

				if (validationResult.missingCount > 0) {
					console.log(
						`\n  Missing Mappings: ${validationResult.missingMappings.join(', ')}`
					);
				}
			}
		}

		// Example 4: Test with invalid mappings
		console.log('\n🚫 Example 4: Test Invalid Mapping Validation');
		console.log('---------------------------------------------');

		const invalidMappings = {
			pending: 'invalid-uuid-123',
			'in-progress': 'another-fake-uuid',
			done: 'non-existent-uuid'
		};

		const invalidValidation = await handler.validateTaskMasterStatusMappings(
			config.teamId,
			invalidMappings
		);

		console.log(`Invalid Mapping Test Results:`);
		console.log(`  ✅ Valid:   ${invalidValidation.validCount}`);
		console.log(`  ❌ Invalid: ${invalidValidation.invalidCount}`);
		console.log(`  ❓ Missing: ${invalidValidation.missingCount}`);

		// Example 5: Check unmapped statuses
		console.log('\n📊 Example 5: Check Unmapped Statuses');
		console.log('------------------------------------');

		const partialMappings = {
			pending: mappingResult.mappings.pending,
			done: mappingResult.mappings.done
		};

		const unmappedStatuses = await handler.getUnmappedTaskMasterStatuses(
			config.teamId,
			partialMappings
		);

		console.log(`Unmapped TaskMaster statuses: ${unmappedStatuses.join(', ')}`);

		// Example 6: Show default mapping constants
		console.log('\n⚙️  Example 6: Default Mapping Configuration');
		console.log('-------------------------------------------');

		console.log('TaskMaster Status Defaults:');
		Object.entries(LinearIntegrationHandler.TASKMASTER_STATUS_DEFAULTS).forEach(
			([status, linearStates]) => {
				console.log(`  ${status.padEnd(12)} → ${linearStates.join(', ')}`);
			}
		);

		console.log('\nAll TaskMaster Statuses:');
		console.log(`  ${LinearIntegrationHandler.TASKMASTER_STATUSES.join(', ')}`);

		console.log('\n✨ TaskMaster mapping example completed successfully!');
	} catch (error) {
		console.error('❌ Error during TaskMaster mapping example:', error.message);

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
	demonstrateTaskMasterMapping().catch(console.error);
}

export { demonstrateTaskMasterMapping };
