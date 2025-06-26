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
	try {
		// Execute the main sync function with provided options directly
		await linearSyncAll(options);
	} catch (error) {
		console.error(`Comprehensive sync command failed: ${error.message}`);
		process.exit(1);
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
