#!/usr/bin/env node

/**
 * @fileoverview Linear Label Sync Command
 *
 * Comprehensive label synchronization between TaskMaster and Linear.
 * Supports creating missing labels, syncing existing labels with Linear IDs,
 * and resolving conflicts where TaskMaster is the source of truth.
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import {
	LinearLabelManager,
	syncLinearLabels
} from './modules/linear-label-management.js';
import { LinearTeamSelector } from './modules/linear-team-selection.js';
import { log } from './modules/utils.js';
import { messages } from './modules/prompts.js';
import inquirer from 'inquirer';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Parse command line arguments
 */
function parseArgs() {
	const args = process.argv.slice(2);
	const options = {
		dryRun: false,
		resolveConflicts: false,
		projectRoot: '/app', // Default for Docker environment
		help: false,
		verbose: false,
		teamId: null,
		force: false
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		switch (arg) {
			case '--dry-run':
			case '-n':
				options.dryRun = true;
				break;
			case '--resolve-conflicts':
			case '-r':
				options.resolveConflicts = true;
				break;
			case '--project-root':
				options.projectRoot = args[++i];
				break;
			case '--team-id':
				options.teamId = args[++i];
				break;
			case '--force':
			case '-f':
				options.force = true;
				break;
			case '--verbose':
			case '-v':
				options.verbose = true;
				break;
			case '--help':
			case '-h':
				options.help = true;
				break;
			default:
				if (arg.startsWith('-')) {
					console.error(`Unknown option: ${arg}`);
					process.exit(1);
				}
				break;
		}
	}

	return options;
}

/**
 * Display help information
 */
function showHelp() {
	console.log(`
${chalk.bold('LINEAR LABEL SYNC')}

Synchronize TaskMaster labels with Linear, maintaining TaskMaster as the source of truth.

${chalk.bold('USAGE:')}
  linear-sync-labels [options]

${chalk.bold('OPTIONS:')}
  -n, --dry-run              Preview changes without applying them
  -r, --resolve-conflicts    Update Linear labels to match TaskMaster configuration
  --project-root <path>      TaskMaster project root (default: /app)
  --team-id <id>             Specific Linear team ID to sync with
  -f, --force                Skip confirmation prompts
  -v, --verbose              Enable verbose logging
  -h, --help                 Show this help message

${chalk.bold('EXAMPLES:')}
  # Preview what would be synced
  linear-sync-labels --dry-run

  # Sync all labels (create missing, store Linear IDs)
  linear-sync-labels

  # Sync and resolve conflicts (update Linear to match TaskMaster)
  linear-sync-labels --resolve-conflicts

  # Sync with specific team
  linear-sync-labels --team-id team-id-here

${chalk.bold('WORKFLOW:')}
  1. Fetches labels from all teams in your Linear organization
  2. Analyzes TaskMaster label configuration for sync state
  3. Creates missing labels in Linear (with TaskMaster colors/descriptions)
  4. Stores Linear IDs in TaskMaster config for sync tracking
  5. Optionally resolves conflicts by updating Linear labels

${chalk.bold('SYNC STATES:')}
  • Missing: Label exists in TaskMaster but not in Linear (will be created)
  • Needs Sync: Label exists in both but Linear ID not stored (will be synced)
  • Synced: Label exists in both with Linear ID stored (up to date)
  • Conflict: Colors/descriptions differ between TaskMaster and Linear
`);
}

/**
 * Load environment configuration
 */
function loadEnvironment() {
	try {
		// Try to load .env file
		const envPath = join(process.cwd(), '.env');
		const envContent = readFileSync(envPath, 'utf8');

		// Simple .env parser
		envContent.split('\n').forEach((line) => {
			const trimmed = line.trim();
			if (trimmed && !trimmed.startsWith('#')) {
				const [key, ...valueParts] = trimmed.split('=');
				if (key && valueParts.length > 0) {
					process.env[key.trim()] = valueParts.join('=').trim();
				}
			}
		});
	} catch (error) {
		// .env file doesn't exist or can't be read - continue with system env
		log('debug', 'No .env file found, using system environment variables');
	}
}

/**
 * Get and validate Linear API key
 */
async function getLinearApiKey(options) {
	let apiKey = process.env.LINEAR_API_KEY;

	if (!apiKey || !apiKey.startsWith('lin_api_')) {
		if (options.force) {
			console.error(
				chalk.red('❌ No valid Linear API key found in environment')
			);
			console.error(
				'Set LINEAR_API_KEY in your .env file or environment variables'
			);
			process.exit(1);
		}

		console.log(chalk.yellow('⚠️  No Linear API key found in environment'));
		console.log('To get your Linear API key:');
		console.log('1. Go to Linear Settings → API');
		console.log('2. Create a new Personal API key');
		console.log('3. Copy the key (starts with "lin_api_")');
		console.log();

		const { providedKey } = await inquirer.prompt([
			{
				type: 'password',
				name: 'providedKey',
				message: 'Enter your Linear API key:',
				validate: (input) => {
					if (!input || !input.startsWith('lin_api_')) {
						return 'API key must start with "lin_api_"';
					}
					return true;
				}
			}
		]);

		apiKey = providedKey;
	}

	return apiKey;
}

/**
 * Get team ID for label creation
 */
async function getTeamId(apiKey, options) {
	if (options.teamId) {
		return options.teamId;
	}

	// Fetch teams and let user select
	const teamSelector = new LinearTeamSelector({ apiKey });

	try {
		const teams = await teamSelector.fetchTeams();

		if (teams.length === 0) {
			throw new Error(
				'No teams found. You need access to at least one Linear team.'
			);
		}

		if (teams.length === 1) {
			const team = teams[0];
			if (options.force) {
				log('info', `Auto-selecting only available team: ${team.displayName}`);
				return team.id;
			}

			console.log(chalk.blue(`Only one team available: ${team.displayName}`));
			const { useTeam } = await inquirer.prompt([
				{
					type: 'confirm',
					name: 'useTeam',
					message: `Use team "${team.displayName}" for label creation?`,
					default: true
				}
			]);

			if (!useTeam) {
				console.log(chalk.yellow('Label sync cancelled'));
				process.exit(0);
			}

			return team.id;
		}

		// Multiple teams - let user select
		const selectedTeam = await teamSelector.selectTeam(teams, {
			message: 'Select team for label creation'
		});

		return selectedTeam.id;
	} catch (error) {
		console.error(chalk.red(`❌ Failed to fetch teams: ${error.message}`));
		process.exit(1);
	}
}

/**
 * Display sync analysis results
 */
function displayAnalysis(analysis, options) {
	console.log(chalk.bold('\n📊 SYNC ANALYSIS'));
	console.log('─'.repeat(50));

	// Summary
	console.log(chalk.bold('Summary:'));
	console.log(`  Total labels required: ${analysis.summary.totalRequired}`);
	console.log(
		`  Missing (will create): ${chalk.red(analysis.summary.totalMissing)}`
	);
	console.log(
		`  Need sync (store IDs): ${chalk.yellow(analysis.summary.totalNeedsSync)}`
	);
	console.log(
		`  Already synced: ${chalk.green(analysis.existingLabels.length)}`
	);
	console.log(
		`  Conflicts detected: ${chalk.magenta(analysis.summary.totalConflicts)}`
	);

	// Enabled categories
	if (analysis.enabledCategories.length > 0) {
		console.log(chalk.bold('\nEnabled Categories:'));
		analysis.enabledCategories.forEach((cat) => {
			console.log(`  • ${cat.name} (${cat.labelCount} labels)`);
		});
	}

	// Missing labels
	if (analysis.missingLabels.length > 0) {
		console.log(chalk.bold(chalk.red('\nLabels to Create in Linear:')));
		analysis.missingLabels.forEach((label) => {
			console.log(`  • ${label.config.name} (${label.config.color})`);
		});
	}

	// Labels needing sync
	if (analysis.needsSync.length > 0) {
		console.log(chalk.bold(chalk.yellow('\nLabels Needing Linear ID Sync:')));
		analysis.needsSync.forEach((label) => {
			console.log(`  • ${label.config.name} (exists in Linear, missing ID)`);
		});
	}

	// Conflicts
	if (analysis.conflicts.length > 0) {
		console.log(chalk.bold(chalk.magenta('\nConflicts Detected:')));
		analysis.conflicts.forEach((conflict) => {
			console.log(`  • ${conflict.labelName} (${conflict.type})`);
			console.log(`    TaskMaster: ${conflict.configured}`);
			console.log(`    Linear: ${conflict.existing}`);
			if (options.resolveConflicts) {
				console.log(
					`    ${chalk.green('→ Will update Linear to match TaskMaster')}`
				);
			} else {
				console.log(`    ${chalk.gray('→ Use --resolve-conflicts to fix')}`);
			}
		});
	}

	// Recommendations
	if (analysis.recommendations.length > 0) {
		console.log(chalk.bold('\n💡 Recommendations:'));
		analysis.recommendations.forEach((rec) => {
			const priority =
				rec.priority === 'high'
					? chalk.red('HIGH')
					: rec.priority === 'medium'
						? chalk.yellow('MED')
						: chalk.gray('LOW');
			console.log(`  ${priority}: ${rec.message}`);
			if (rec.command) {
				console.log(`         Command: ${chalk.cyan(rec.command)}`);
			}
		});
	}
}

/**
 * Display sync results
 */
function displayResults(results) {
	console.log(chalk.bold('\n✅ SYNC RESULTS'));
	console.log('─'.repeat(50));

	const { summary } = results;

	if (summary.synced > 0) {
		console.log(
			chalk.green(`✓ Synced ${summary.synced} existing labels with Linear IDs`)
		);
	}

	if (summary.created > 0) {
		console.log(
			chalk.green(`✓ Created ${summary.created} new labels in Linear`)
		);
	}

	if (summary.conflictsResolved > 0) {
		console.log(
			chalk.green(`✓ Resolved ${summary.conflictsResolved} conflicts`)
		);
	}

	if (summary.failed > 0) {
		console.log(chalk.red(`✗ ${summary.failed} operations failed`));
	}

	// Detailed results
	if (results.results.sync?.synced.length > 0) {
		console.log(chalk.bold('\nSynced Labels:'));
		results.results.sync.synced.forEach((label) => {
			console.log(`  • ${label.name} → ${label.linearId}`);
		});
	}

	if (results.results.creation?.created.length > 0) {
		console.log(chalk.bold('\nCreated Labels:'));
		results.results.creation.created.forEach((label) => {
			console.log(`  • ${label.name} (${label.color}) → ${label.linearId}`);
		});
	}

	if (
		results.results.sync?.failed.length > 0 ||
		results.results.creation?.failed.length > 0
	) {
		console.log(chalk.bold(chalk.red('\nFailed Operations:')));

		if (results.results.sync?.failed) {
			results.results.sync.failed.forEach((failure) => {
				console.log(`  ✗ Sync ${failure.name}: ${failure.error}`);
			});
		}

		if (results.results.creation?.failed) {
			results.results.creation.failed.forEach((failure) => {
				console.log(`  ✗ Create ${failure.name}: ${failure.error}`);
			});
		}
	}
}

/**
 * Confirm sync operation
 */
async function confirmSync(analysis, options) {
	if (options.force || options.dryRun) {
		return true;
	}

	const totalOperations =
		analysis.summary.totalMissing + analysis.summary.totalNeedsSync;
	if (totalOperations === 0 && analysis.summary.totalConflicts === 0) {
		console.log(chalk.green('\n✅ All labels are already synced!'));
		return false;
	}

	console.log(chalk.bold('\n🔄 SYNC OPERATION'));
	console.log('─'.repeat(50));

	const operations = [];
	if (analysis.summary.totalMissing > 0) {
		operations.push(
			`Create ${analysis.summary.totalMissing} missing labels in Linear`
		);
	}
	if (analysis.summary.totalNeedsSync > 0) {
		operations.push(
			`Store Linear IDs for ${analysis.summary.totalNeedsSync} existing labels`
		);
	}
	if (options.resolveConflicts && analysis.summary.totalConflicts > 0) {
		operations.push(
			`Resolve ${analysis.summary.totalConflicts} conflicts (update Linear)`
		);
	}

	console.log('This will:');
	operations.forEach((op) => console.log(`  • ${op}`));
	console.log();

	const { confirmed } = await inquirer.prompt([
		{
			type: 'confirm',
			name: 'confirmed',
			message: 'Proceed with label sync?',
			default: false
		}
	]);

	return confirmed;
}

/**
 * Main execution function
 */
async function main() {
	const options = parseArgs();

	if (options.help) {
		showHelp();
		process.exit(0);
	}

	// Configure logging
	if (options.verbose) {
		process.env.LOG_LEVEL = 'debug';
	}

	console.log(chalk.bold('🔄 LINEAR LABEL SYNC'));
	console.log('─'.repeat(50));

	try {
		// Load environment
		loadEnvironment();

		// Get API key
		const apiKey = await getLinearApiKey(options);

		// Get team ID
		const teamId = await getTeamId(apiKey, options);

		console.log(chalk.blue('\n🔍 Analyzing label configuration...'));

		// Perform sync operation
		const syncResult = await syncLinearLabels(
			apiKey,
			options.projectRoot,
			teamId,
			{
				resolveConflicts: options.resolveConflicts,
				dryRun: true // Always start with analysis
			}
		);

		// Display analysis
		displayAnalysis(syncResult.analysis, options);

		if (options.dryRun) {
			console.log(chalk.bold(chalk.blue('\n👁️  DRY RUN COMPLETE')));
			console.log(
				'No changes were made. Run without --dry-run to apply changes.'
			);
			process.exit(0);
		}

		// Confirm sync
		const shouldProceed = await confirmSync(syncResult.analysis, options);
		if (!shouldProceed) {
			console.log(chalk.yellow('Sync cancelled'));
			process.exit(0);
		}

		// Perform actual sync
		console.log(chalk.blue('\n🔄 Executing sync operations...'));

		const finalResult = await syncLinearLabels(
			apiKey,
			options.projectRoot,
			teamId,
			{
				resolveConflicts: options.resolveConflicts,
				dryRun: false
			}
		);

		// Display results
		displayResults(finalResult);

		if (finalResult.success) {
			console.log(
				chalk.bold(chalk.green('\n🎉 Label sync completed successfully!'))
			);
		} else {
			console.log(
				chalk.bold(chalk.red('\n❌ Label sync completed with errors'))
			);
			process.exit(1);
		}
	} catch (error) {
		console.error(chalk.red(`\n❌ Sync failed: ${error.message}`));
		if (options.verbose) {
			console.error(error.stack);
		}
		process.exit(1);
	}
}

// Execute if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(console.error);
}

export { main as linearSyncLabels };
