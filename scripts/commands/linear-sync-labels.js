#!/usr/bin/env node

/**
 * @fileoverview Linear Label Sync Command Module
 *
 * Command module for comprehensive label synchronization between TaskMaster and Linear.
 * Supports creating missing labels, syncing existing labels with Linear IDs,
 * and resolving conflicts where TaskMaster is the source of truth.
 *
 * INTEGRATION COMMAND NAMING PATTERN:
 * ====================================
 * Following the pattern: {integration}-{command-name}
 * Example: linear-sync-labels
 */

import { linearSyncLabels } from '../linear-sync-labels.js';

/**
 * Command line interface for linear-sync-labels
 *
 * Following the integration command pattern: {integration}-{command-name}
 */
export async function linearSyncLabelsCommand(options) {
	// Set up process.argv to match what the main function expects
	const originalArgv = process.argv.slice();

	try {
		const syncArgs = ['node', 'linear-sync-labels'];

		// Map command options to CLI arguments
		if (options.dryRun) syncArgs.push('--dry-run');
		if (options.resolveConflicts) syncArgs.push('--resolve-conflicts');
		if (options.projectRoot)
			syncArgs.push('--project-root', options.projectRoot);
		if (options.teamId) syncArgs.push('--team-id', options.teamId);
		if (options.force) syncArgs.push('--force');
		if (options.verbose) syncArgs.push('--verbose');

		process.argv = syncArgs;

		// Execute the main sync function
		await linearSyncLabels();
	} catch (error) {
		console.error(`Label sync command failed: ${error.message}`);
		process.exit(1);
	} finally {
		// Always restore original argv
		process.argv = originalArgv;
	}
}

// Export for CLI registration
// Following integration command naming pattern: {integration}-{command-name}
export default {
	command: 'linear-sync-labels',
	description:
		'Synchronize TaskMaster labels with Linear (create missing, store IDs, resolve conflicts)',
	options: [
		{
			flags: '-n, --dry-run',
			description: 'Preview changes without applying them'
		},
		{
			flags: '-r, --resolve-conflicts',
			description: 'Update Linear labels to match TaskMaster configuration'
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
			flags: '-f, --force',
			description: 'Skip confirmation prompts'
		},
		{
			flags: '-v, --verbose',
			description: 'Enable verbose logging'
		}
	],
	action: linearSyncLabelsCommand
};
