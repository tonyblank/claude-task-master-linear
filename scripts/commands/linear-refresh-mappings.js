#!/usr/bin/env node

/**
 * @fileoverview Linear State Mapping Refresh Command
 *
 * CLI utility for manually refreshing Linear workflow state mappings with TaskMaster.
 * Regenerates UUID mappings from current configuration state names and validates
 * against the current Linear workspace.
 *
 * INTEGRATION COMMAND NAMING PATTERN:
 * ====================================
 * This command follows the pattern: linear-{command-name}
 * - linear-refresh-mappings: Regenerate UUID mappings from current configuration
 */

import chalk from 'chalk';
import ora from 'ora';
import {
	regenerateAllUuidMappings,
	getCurrentMappingConfiguration,
	validateStatusMappings
} from '../modules/linear-status-mapping-manager.js';
import { log, findProjectRoot } from '../modules/utils.js';

/**
 * Refreshes Linear state mappings by regenerating UUIDs from current names
 *
 * @param {Object} options - Command line options
 * @param {boolean} options.force - Force refresh even if UUID mappings exist
 * @param {boolean} options.validate - Validate mappings after refresh (default: true)
 * @param {boolean} options.dryRun - Show what would be done without making changes
 * @param {string} options.projectRoot - Project root directory
 */
export async function refreshLinearMappings(options = {}) {
	const {
		force = false,
		validate = true,
		dryRun = false,
		projectRoot = findProjectRoot()
	} = options;

	let spinner;

	try {
		console.log(chalk.cyan.bold('\n🔄 Linear State Mapping Refresh\n'));
		console.log(
			chalk.gray(
				'This command regenerates UUID mappings from your current state name configuration.\n'
			)
		);

		// Step 1: Check current configuration
		log('info', 'Step 1: Analyzing Current Configuration');
		const currentConfig = getCurrentMappingConfiguration(projectRoot);

		if (currentConfig.error) {
			log('error', `Configuration error: ${currentConfig.error}`);
			process.exit(1);
		}

		console.log(chalk.blue('Current mapping status:'));
		console.log(`  • Mapping type: ${currentConfig.effective.type}`);
		console.log(`  • Mapped statuses: ${currentConfig.effective.count}/6`);
		console.log(
			`  • Has UUID mappings: ${currentConfig.hasUuidMappings ? 'Yes' : 'No'}`
		);
		console.log(
			`  • Has name mappings: ${currentConfig.hasNameMappings ? 'Yes' : 'No'}`
		);

		if (!currentConfig.hasNameMappings) {
			log('error', 'No name-based mappings found to refresh from');
			console.log(
				chalk.red('❌ Cannot refresh without existing name mappings')
			);
			console.log(
				chalk.cyan('💡 Run linear-sync-setup to configure initial mappings')
			);
			process.exit(1);
		}

		// Check if UUIDs already exist and force is not specified
		if (currentConfig.hasUuidMappings && !force) {
			log('warn', 'UUID mappings already exist');
			console.log(chalk.yellow('⚠️  UUID mappings are already configured'));
			console.log(chalk.gray('Use --force to regenerate existing mappings'));
			console.log(
				chalk.cyan('💡 Use linear-validate-mappings to check current mappings')
			);
			return {
				success: false,
				reason: 'UUID mappings exist, use --force to regenerate'
			};
		}

		// Step 2: Regenerate UUID mappings
		log('info', '\nStep 2: Regenerating UUID Mappings');

		if (dryRun) {
			console.log(chalk.yellow('DRY RUN: Would regenerate UUID mappings...'));
			console.log(chalk.gray('Source name mappings:'));
			Object.entries(currentConfig.nameMapping).forEach(([status, name]) => {
				console.log(chalk.gray(`  • ${status} → "${name}"`));
			});
			return {
				success: true,
				dryRun: true,
				message: 'Dry run completed - no changes made'
			};
		}

		spinner = ora(
			'Fetching Linear workflow states and regenerating mappings...'
		).start();

		const regenerateResult = await regenerateAllUuidMappings({
			projectRoot,
			forceRefresh: force
		});

		spinner.stop();

		if (!regenerateResult.success) {
			log('error', `Failed to regenerate mappings: ${regenerateResult.error}`);
			if (regenerateResult.details) {
				console.log(chalk.red('Details:'));
				regenerateResult.details.forEach((detail) =>
					console.log(chalk.red(`  • ${detail}`))
				);
			}
			process.exit(1);
		}

		log(
			'success',
			`✅ Successfully regenerated ${regenerateResult.regeneratedCount} UUID mappings`
		);

		// Display the new mappings
		console.log(chalk.green('\nNew UUID mappings:'));
		Object.entries(regenerateResult.newMappings).forEach(([status, uuid]) => {
			console.log(chalk.green(`  • ${status} → ${uuid}`));
		});

		if (regenerateResult.replacedExisting) {
			console.log(chalk.yellow('\n⚠️  Replaced existing UUID mappings'));
		}

		// Step 3: Validate new mappings (optional)
		if (validate) {
			log('info', '\nStep 3: Validating New Mappings');
			spinner = ora('Validating mappings against Linear workspace...').start();

			const validationResult = await validateStatusMappings({
				projectRoot,
				checkLinearWorkspace: true
			});

			spinner.stop();

			if (validationResult.valid) {
				log('success', '✅ All mappings validated successfully');
				if (
					validationResult.recommendations &&
					validationResult.recommendations.length > 0
				) {
					console.log(chalk.blue('\nRecommendations:'));
					validationResult.recommendations.forEach((rec) =>
						console.log(chalk.blue(`  • ${rec}`))
					);
				}
			} else {
				log('warn', '⚠️  Validation found issues');
				if (validationResult.issues && validationResult.issues.length > 0) {
					console.log(chalk.yellow('Issues found:'));
					validationResult.issues.forEach((issue) =>
						console.log(chalk.yellow(`  • ${issue}`))
					);
				}
			}
		}

		console.log(chalk.green.bold('\n🎉 Linear mapping refresh complete!\n'));

		return {
			success: true,
			regeneratedCount: regenerateResult.regeneratedCount,
			newMappings: regenerateResult.newMappings,
			validated: validate ? validationResult.valid : null
		};
	} catch (error) {
		if (spinner) spinner.stop();

		log('error', `Refresh failed: ${error.message}`);

		if (process.env.DEBUG === '1') {
			console.error(error);
		}

		console.log(
			chalk.cyan(
				'\n💡 You can run validation with: task-master linear-validate-mappings\n'
			)
		);

		return {
			success: false,
			error: error.message
		};
	}
}

/**
 * Command line interface for linear-refresh-mappings
 */
export async function linearRefreshMappingsCommand(options) {
	try {
		const result = await refreshLinearMappings(options);

		if (!result.success) {
			process.exit(1);
		}

		process.exit(0);
	} catch (error) {
		log('error', `Refresh command failed: ${error.message}`);
		process.exit(1);
	}
}

// Export for CLI registration
export default {
	command: 'linear-refresh-mappings',
	description:
		'Regenerate Linear UUID mappings from current state name configuration',
	options: [
		{
			flags: '--force',
			description: 'Force refresh even if UUID mappings already exist'
		},
		{
			flags: '--no-validate',
			description: 'Skip validation after refresh'
		},
		{
			flags: '--dry-run',
			description: 'Show what would be done without making changes'
		},
		{
			flags: '--project-root <path>',
			description: 'Project root directory (defaults to current directory)'
		}
	],
	action: linearRefreshMappingsCommand
};
