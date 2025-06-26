#!/usr/bin/env node

/**
 * @fileoverview Linear Sync All Command Module
 *
 * Command module for comprehensive synchronization between TaskMaster and Linear.
 * Orchestrates complete sync across all components: labels, teams, projects.
 *
 * INTEGRATION COMMAND NAMING PATTERN:
 * ====================================
 * Following the pattern: {integration}-{command-name}
 * Example: linear-sync-all
 */

import { linearSyncAll } from '../linear-sync-all.js';

/**
 * Command line interface for linear-sync-all
 *
 * Following the integration command pattern: {integration}-{command-name}
 */
export async function linearSyncAllCommand(options) {
	// Set up process.argv to match what the main function expects
	const originalArgv = process.argv.slice();

	try {
		const syncArgs = ['node', 'linear-sync-all'];

		// Map command options to CLI arguments
		if (options.dryRun) syncArgs.push('--dry-run');
		if (options.resolveConflicts) syncArgs.push('--resolve-conflicts');
		if (options.projectRoot)
			syncArgs.push('--project-root', options.projectRoot);
		if (options.teamId) syncArgs.push('--team-id', options.teamId);
		if (options.force) syncArgs.push('--force');
		if (options.verbose) syncArgs.push('--verbose');
		if (options.labelsOnly) syncArgs.push('--labels-only');

		process.argv = syncArgs;

		// Execute the main sync function
		await linearSyncAll();
	} catch (error) {
		console.error(`Comprehensive sync command failed: ${error.message}`);
		process.exit(1);
	} finally {
		// Always restore original argv
		process.argv = originalArgv;
	}
}

// Export for CLI registration
// Following integration command naming pattern: {integration}-{command-name}
export default {
	command: 'linear-sync-all',
	description:
		'Comprehensive synchronization between TaskMaster and Linear across all components',
	options: [
		{
			flags: '-n, --dry-run',
			description: 'Preview all changes without applying them'
		},
		{
			flags: '-r, --resolve-conflicts',
			description: 'Resolve conflicts across all components'
		},
		{
			flags: '--project-root <path>',
			description: 'TaskMaster project root (default: /app)'
		},
		{
			flags: '--team-id <id>',
			description: 'Specific Linear team ID to sync with'
		},
		{
			flags: '--labels-only',
			description: 'Sync only labels (equivalent to linear-sync-labels)'
		},
		{
			flags: '-f, --force',
			description: 'Skip confirmation prompts'
		},
		{
			flags: '-v, --verbose',
			description: 'Enable verbose logging'
		}
	],
	action: linearSyncAllCommand
};
