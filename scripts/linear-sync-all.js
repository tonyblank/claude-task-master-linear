#!/usr/bin/env node

/**
 * @fileoverview Linear Sync All Command
 *
 * Orchestrates comprehensive synchronization between TaskMaster and Linear.
 * Currently handles label sync, with extensibility for future team/project sync.
 */

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { linearSyncLabels } from './linear-sync-labels.js';
import { log } from './modules/utils.js';
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
		force: false,
		labelsOnly: false
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
				if (i + 1 >= args.length) {
					throw new Error('--project-root requires a value');
				}
				options.projectRoot = args[++i];
				break;
			case '--team-id':
				if (i + 1 >= args.length) {
					throw new Error('--team-id requires a value');
				}
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
			case '--labels-only':
				options.labelsOnly = true;
				break;
			case '--help':
			case '-h':
				options.help = true;
				break;
			default:
				if (arg.startsWith('-')) {
					throw new Error(`Unknown option: ${arg}`);
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
${chalk.bold('LINEAR SYNC ALL')}

Comprehensive synchronization between TaskMaster and Linear across all components.

${chalk.bold('USAGE:')}
  linear-sync-all [options]

${chalk.bold('OPTIONS:')}
  -n, --dry-run              Preview all changes without applying them
  -r, --resolve-conflicts    Resolve conflicts across all components
  --project-root <path>      TaskMaster project root (default: /app)
  --team-id <id>             Specific Linear team ID to sync with
  --labels-only              Sync only labels (same as linear-sync-labels)
  -f, --force                Skip confirmation prompts
  -v, --verbose              Enable verbose logging
  -h, --help                 Show this help message

${chalk.bold('COMPONENTS SYNCED:')}
  ✓ Labels                   Sync TaskMaster labels with Linear (create/update/track)
  ○ Teams                    Team synchronization (future enhancement)  
  ○ Projects                 Project synchronization (future enhancement)

${chalk.bold('EXAMPLES:')}
  # Preview what would be synced across all components
  linear-sync-all --dry-run

  # Sync all components
  linear-sync-all

  # Sync all with conflict resolution
  linear-sync-all --resolve-conflicts

  # Sync only labels (equivalent to linear-sync-labels)
  linear-sync-all --labels-only

${chalk.bold('WORKFLOW:')}
  1. 🏷️  LABELS: Comprehensive label sync (create missing, store IDs, resolve conflicts)
  2. 👥 TEAMS: Team metadata sync (planned)
  3. 📁 PROJECTS: Project sync and validation (planned)
  4. 📊 SUMMARY: Overall sync status and recommendations

${chalk.bold('NOTES:')}
  • Labels are currently the primary sync component
  • Teams and projects are read-only for now
  • Use individual commands for granular control:
    - linear-sync-labels: Labels only
    - linear-sync-all: Complete sync orchestration
`);
}

/**
 * Display sync header with component status
 */
function displaySyncHeader() {
	console.log(chalk.bold('🔄 LINEAR COMPREHENSIVE SYNC'));
	console.log('─'.repeat(60));

	console.log('Sync Components:');
	console.log(`  🏷️  Labels:   ${chalk.green('✓ Active')}`);
	console.log(`  👥 Teams:    ${chalk.gray('○ Planned (read-only)')}`);
	console.log(`  📁 Projects: ${chalk.gray('○ Planned (read-only)')}`);
	console.log();
}

/**
 * Execute label sync component
 */
async function syncLabels(options) {
	console.log(chalk.bold.blue('\n🏷️  SYNCING LABELS'));
	console.log('─'.repeat(40));

	try {
		// Execute label sync with provided options directly
		await linearSyncLabels(options);

		return { success: true, component: 'labels' };
	} catch (error) {
		console.error(chalk.red(`❌ Label sync failed: ${error.message}`));
		if (options.verbose) {
			console.error(error.stack);
		}
		return { success: false, component: 'labels', error: error.message };
	}
}

/**
 * Execute team sync component (placeholder)
 */
async function syncTeams(options) {
	if (options.labelsOnly) {
		return { success: true, component: 'teams', skipped: true };
	}

	console.log(chalk.bold.blue('\n👥 SYNCING TEAMS'));
	console.log('─'.repeat(40));

	console.log(chalk.gray('Team sync is planned for future release.'));
	console.log(chalk.gray('Teams are currently read-only.'));

	// TODO: Implement team sync
	return {
		success: false,
		component: 'teams',
		notImplemented: true,
		error: 'Team sync not yet implemented'
	};
}

/**
 * Execute project sync component (placeholder)
 */
async function syncProjects(options) {
	if (options.labelsOnly) {
		return { success: true, component: 'projects', skipped: true };
	}

	console.log(chalk.bold.blue('\n📁 SYNCING PROJECTS'));
	console.log('─'.repeat(40));

	console.log(chalk.gray('Project sync is planned for future release.'));
	console.log(chalk.gray('Projects are currently read-only.'));

	// TODO: Implement project sync
	return {
		success: false,
		component: 'projects',
		notImplemented: true,
		error: 'Project sync not yet implemented'
	};
}

/**
 * Display comprehensive sync results
 */
function displaySyncSummary(results) {
	console.log(chalk.bold('\n📊 COMPREHENSIVE SYNC SUMMARY'));
	console.log('═'.repeat(60));

	let allSuccess = true;
	let activeComponents = 0;
	let skippedComponents = 0;

	results.forEach((result) => {
		const { success, component, skipped, error } = result;

		if (skipped) {
			console.log(
				`  ${getComponentIcon(component)} ${component.toUpperCase()}: ${chalk.gray('○ Skipped')}`
			);
			skippedComponents++;
		} else if (success) {
			console.log(
				`  ${getComponentIcon(component)} ${component.toUpperCase()}: ${chalk.green('✓ Success')}`
			);
			activeComponents++;
		} else {
			console.log(
				`  ${getComponentIcon(component)} ${component.toUpperCase()}: ${chalk.red('✗ Failed')}`
			);
			if (error) {
				console.log(`    ${chalk.gray('Error:')} ${error}`);
			}
			allSuccess = false;
			activeComponents++;
		}
	});

	console.log();
	console.log(`Active components: ${activeComponents}`);
	console.log(`Skipped components: ${skippedComponents}`);

	if (allSuccess) {
		console.log(
			chalk.bold.green('\n🎉 All active components synced successfully!')
		);
	} else {
		console.log(chalk.bold.red('\n❌ Some components failed to sync'));
	}

	return allSuccess;
}

/**
 * Get emoji icon for component
 */
function getComponentIcon(component) {
	const icons = {
		labels: '🏷️ ',
		teams: '👥',
		projects: '📁'
	};
	return icons[component] || '○';
}

/**
 * Main execution function
 */
async function main(providedOptions = null) {
	const options = providedOptions || parseArgs();

	if (options.help) {
		showHelp();
		return;
	}

	// Configure logging
	if (options.verbose) {
		process.env.LOG_LEVEL = 'debug';
	}

	displaySyncHeader();

	const results = [];

	try {
		// If labels-only flag is set, just run label sync
		if (options.labelsOnly) {
			console.log(
				chalk.blue(
					'Running labels-only sync (equivalent to linear-sync-labels)'
				)
			);
			const labelResult = await syncLabels(options);
			results.push(labelResult);
		} else {
			// Execute all sync components in sequence
			console.log(
				chalk.blue('Executing comprehensive sync across all components...')
			);

			// 1. Sync Labels (primary component)
			const labelResult = await syncLabels(options);
			results.push(labelResult);

			// Only continue with other components if labels succeeded (or if forced)
			if (labelResult.success || options.force) {
				// 2. Sync Teams (placeholder for now)
				const teamResult = await syncTeams(options);
				results.push(teamResult);

				// 3. Sync Projects (placeholder for now)
				const projectResult = await syncProjects(options);
				results.push(projectResult);
			} else {
				console.log(
					chalk.yellow(
						'\n⚠️  Skipping remaining components due to label sync failure'
					)
				);
				console.log(
					chalk.gray(
						'Use --force to continue with other components despite failures'
					)
				);
			}
		}

		// Display comprehensive summary
		const allSuccess = displaySyncSummary(results);

		if (!allSuccess) {
			throw new Error('Some components failed to sync');
		}
	} catch (error) {
		console.error(
			chalk.red(`\n❌ Comprehensive sync failed: ${error.message}`)
		);
		if (options.verbose) {
			console.error(error.stack);
		}
		throw error;
	}
}

// Execute if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(console.error);
}

export { main as linearSyncAll };
