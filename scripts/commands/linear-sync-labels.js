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
	try {
		// Execute the main sync function with proper options object
		await linearSyncLabels(options);
	} catch (error) {
		console.error(`Label sync command failed: ${error.message}`);
		throw error;
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
