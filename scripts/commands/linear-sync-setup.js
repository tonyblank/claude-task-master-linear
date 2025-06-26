#!/usr/bin/env node

/**
 * @fileoverview Linear Integration Setup Wizard
 *
 * Interactive command-line wizard that guides users through Linear integration setup.
 * Orchestrates the complete flow: API validation → team selection → project selection
 * → label configuration → config writing → success confirmation.
 *
 * INTEGRATION COMMAND NAMING PATTERN:
 * ====================================
 * All integration-specific commands follow the pattern: {integration}-{command-name}
 *
 * Examples:
 * - linear-sync-setup    (Linear integration setup)
 * - linear-sync-status   (Linear sync status)
 * - github-sync-setup    (Future GitHub integration setup)
 * - jira-sync-setup      (Future Jira integration setup)
 *
 * This pattern ensures:
 * 1. Clear separation of integration-specific functionality
 * 2. Consistent naming across all integrations
 * 3. Easy discovery of integration commands via CLI help
 * 4. Scalable architecture as we add more integrations
 */

import chalk from 'chalk';
import ora from 'ora';
import { validateLinearApiKey } from '../modules/linear-api-validation.js';
import { selectLinearTeam } from '../modules/linear-team-selection.js';
import { selectLinearProject } from '../modules/linear-project-selection.js';
import {
	createLinearConfiguration,
	getConfiguredLabels
} from '../modules/linear-wizard-config.js';
import { LinearLabelManager } from '../modules/linear-label-management.js';
import { writeLinearEnvironment } from '../modules/linear-env-writer.js';
import {
	displaySetupSuccess,
	testConfiguration
} from '../modules/setup-success.js';
import { log, findProjectRoot } from '../modules/utils.js';

/**
 * Main setup wizard orchestrator
 *
 * @param {Object} options - Command line options
 * @param {boolean} options.skipTest - Skip configuration testing
 * @param {boolean} options.dryRun - Show what would be done without making changes
 * @param {string} options.projectRoot - Project root directory
 */
export async function runSetupWizard(options = {}) {
	const {
		skipTest = false,
		dryRun = false,
		projectRoot = findProjectRoot()
	} = options;

	let spinner;
	const wizardData = {
		apiKey: null,
		team: null,
		project: null,
		labelConfiguration: {},
		userInfo: null
	};

	try {
		// Set environment variable to suppress config warnings during interactive setup
		process.env.TASKMASTER_INTERACTIVE_SETUP = 'true';

		// Welcome message
		console.log(chalk.cyan.bold('\n🚀 Linear Integration Setup Wizard\n'));
		console.log(
			chalk.gray(
				'This wizard will guide you through setting up Linear integration for TaskMaster.\n'
			)
		);

		// Quick help
		console.log(chalk.yellow('Quick Setup Guide:'));
		console.log(
			chalk.gray(
				'1. Have your Linear API key ready (from Linear Settings → API)'
			)
		);
		console.log(
			chalk.gray('2. Know which team(s) and project(s) you want to sync')
		);
		console.log(
			chalk.gray('3. The wizard will create .env and linear-config.json files')
		);
		console.log(
			chalk.gray('4. Use --dry-run to preview changes without applying them\n')
		);

		// Step 1: API Key Validation
		log('info', 'Step 1: Linear API Key Validation');
		const apiResult = await validateLinearApiKey();

		if (!apiResult.success) {
			log('error', 'Setup cancelled: Invalid API key');
			process.exit(1);
		}

		wizardData.apiKey = apiResult.apiKey;
		wizardData.userInfo = apiResult.user;

		log('success', `✅ API key validated - Welcome ${apiResult.user.name}!`);

		// Step 2: Team Selection
		log('info', '\nStep 2: Team Selection');
		spinner = ora('Fetching available teams...').start();

		const teamResult = await selectLinearTeam(wizardData.apiKey, { spinner });
		// Spinner is stopped inside selectLinearTeam

		if (!teamResult || !teamResult.id) {
			log('error', 'Setup cancelled: No team selected');
			process.exit(1);
		}

		wizardData.team = teamResult;

		log('success', `✅ Selected team: ${teamResult.displayName}`);

		// Step 3: Project Selection
		log('info', '\nStep 3: Project Selection');
		spinner = ora('Fetching projects for selected team...').start();

		const projectResult = await selectLinearProject(
			wizardData.apiKey,
			teamResult.id,
			{ spinner }
		);
		// Spinner is stopped inside selectLinearProject

		if (!projectResult || !projectResult.id) {
			log('error', 'Setup cancelled: No project selected');
			process.exit(1);
		}

		wizardData.project = projectResult;

		log('success', `✅ Selected project: ${projectResult.displayName}`);

		// Step 4: Create Linear Configuration
		log('info', '\nStep 4: Creating Linear Configuration');

		const configResult = await createLinearConfiguration(wizardData, {
			projectRoot
		});
		if (!configResult.success) {
			log('error', 'Setup cancelled: Failed to create Linear configuration');
			process.exit(1);
		}

		// Step 5: Label Sync
		log('info', '\nStep 5: Syncing Labels with Linear');
		spinner = ora('Fetching existing labels from Linear...').start();

		try {
			const labelManager = new LinearLabelManager({
				apiKey: wizardData.apiKey,
				projectRoot
			});

			const syncResult = await labelManager.syncLabelsWithLinear(
				wizardData.team.id
			);
			spinner.stop();

			if (syncResult.summary.missing > 0) {
				log(
					'warn',
					`⚠️  ${syncResult.summary.missing} labels need to be created manually in Linear`
				);
				console.log(chalk.yellow('\nMissing labels:'));
				syncResult.missing.forEach((label) => {
					console.log(
						chalk.yellow(
							`  • ${label.config.name} (${label.config.description})`
						)
					);
				});
				console.log(
					chalk.cyan('\nPlease create these labels in Linear, then run:')
				);
				console.log(chalk.cyan('  ./bin/task-master.js linear-sync-labels'));
			}

			if (syncResult.summary.successful > 0) {
				log(
					'success',
					`✅ Synced ${syncResult.summary.successful} labels with Linear`
				);
			}
		} catch (error) {
			spinner.stop();
			log('warn', `⚠️  Label sync failed: ${error.message}`);
			log(
				'info',
				'You can run label sync later with: ./bin/task-master.js linear-sync-labels'
			);
		}

		// Step 6: Write Environment Configuration
		log('info', '\nStep 6: Saving Environment Configuration');

		// Validate critical data before env write
		if (!wizardData.apiKey || !wizardData.team?.id || !wizardData.project?.id) {
			log('error', '❌ Missing required data for environment configuration');
			console.log('FATAL: Missing wizard data - cannot proceed');
			process.exit(1);
		}

		if (dryRun) {
			log('info', 'DRY RUN: Would update environment file...');
			console.log(chalk.yellow('Files that would be updated:'));
			console.log(chalk.gray('  • .env (API keys and team/project IDs)'));
		} else {
			spinner = ora('Writing configuration files...').start();

			let writeResult;
			try {
				writeResult = await writeLinearEnvironment(wizardData, {
					projectRoot,
					createBackup: true,
					dryRun: false
				});
			} catch (error) {
				spinner.stop();
				log('error', '❌ FATAL: Exception during env write:');
				console.error(error);
				process.exit(1);
			}

			spinner.stop();

			if (!writeResult.success) {
				log('error', 'Setup failed: Could not write configuration files');
				console.log(chalk.red('Errors:'));
				writeResult.errors.forEach((error) =>
					console.log(chalk.red(`  • ${error}`))
				);
				process.exit(1);
			}

			log('success', '✅ Environment configuration saved successfully');

			if (writeResult.warnings && writeResult.warnings.length > 0) {
				console.log(chalk.yellow('\nWarnings:'));
				writeResult.warnings.forEach((warning) =>
					console.log(chalk.yellow(`  • ${warning}`))
				);
			}
		}

		// Step 6: Success Confirmation and Next Steps
		log('info', '\nSetup Complete!');

		const successResult = await displaySetupSuccess(wizardData, {
			dryRun,
			skipTest,
			projectRoot
		});

		// Optional configuration testing
		if (!skipTest && !dryRun && successResult.shouldTest) {
			log('info', '\nTesting Configuration...');
			spinner = ora('Verifying Linear API connectivity...').start();

			const testResult = await testConfiguration(wizardData, { projectRoot });
			spinner.stop();

			if (testResult.success) {
				log(
					'success',
					'✅ Configuration test passed - Linear integration is ready!'
				);
			} else {
				log('warn', '⚠️  Configuration test had issues:');
				testResult.errors.forEach((error) =>
					console.log(chalk.yellow(`  • ${error}`))
				);
				console.log(
					chalk.cyan(
						'\n💡 You can still use the integration, but some features may not work as expected.'
					)
				);
			}
		}

		console.log(chalk.green.bold('\n🎉 Linear integration setup complete!\n'));

		// Clean up environment variable
		delete process.env.TASKMASTER_INTERACTIVE_SETUP;

		return {
			success: true,
			wizardData,
			dryRun
		};
	} catch (error) {
		if (spinner) spinner.stop();

		log('error', `Setup failed: ${error.message}`);

		if (process.env.DEBUG === '1') {
			console.error(error);
		}

		console.log(
			chalk.cyan(
				'\n💡 You can run this setup again anytime with: task-master linear-sync-setup\n'
			)
		);

		// Clean up environment variable
		delete process.env.TASKMASTER_INTERACTIVE_SETUP;

		return {
			success: false,
			error: error.message
		};
	}
}

/**
 * Command line interface for linear-sync-setup
 *
 * Following the integration command pattern: {integration}-{command-name}
 */
export async function linearSyncSetupCommand(options) {
	try {
		const result = await runSetupWizard(options);

		if (!result.success) {
			process.exit(1);
		}

		process.exit(0);
	} catch (error) {
		log('error', `Setup command failed: ${error.message}`);
		process.exit(1);
	}
}

// Export for CLI registration
// Following integration command naming pattern: {integration}-{command-name}
export default {
	command: 'linear-sync-setup',
	description: 'Set up Linear integration with interactive wizard',
	options: [
		{
			flags: '--skip-test',
			description: 'Skip configuration testing after setup'
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
	action: linearSyncSetupCommand
};
