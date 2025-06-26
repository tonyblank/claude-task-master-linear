/**
 * Tests for Linear sync command modules
 */

import { jest } from '@jest/globals';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock the main command functions
const mockLinearSyncLabels = jest.fn();
const mockLinearSyncAll = jest.fn();

// Mock modules
jest.unstable_mockModule('../../../scripts/linear-sync-labels.js', () => ({
	linearSyncLabels: mockLinearSyncLabels
}));

jest.unstable_mockModule('../../../scripts/linear-sync-all.js', () => ({
	linearSyncAll: mockLinearSyncAll
}));

describe('Linear sync command modules', () => {
	let originalArgv;
	let originalExit;

	beforeEach(() => {
		jest.clearAllMocks();
		originalArgv = process.argv.slice();
		originalExit = process.exit;
		process.exit = jest.fn();

		// Reset mock implementations
		mockLinearSyncLabels.mockResolvedValue(undefined);
		mockLinearSyncAll.mockResolvedValue(undefined);
	});

	afterEach(() => {
		process.argv = originalArgv;
		process.exit = originalExit;
	});

	describe('linear-sync-labels command module', () => {
		it('should export command configuration correctly', async () => {
			const commandModule = await import(
				'../../../scripts/commands/linear-sync-labels.js'
			);
			const defaultExport = commandModule.default;

			expect(defaultExport).toHaveProperty('command', 'linear-sync-labels');
			expect(defaultExport).toHaveProperty('description');
			expect(defaultExport).toHaveProperty('options');
			expect(defaultExport).toHaveProperty('action');
			expect(Array.isArray(defaultExport.options)).toBe(true);
			expect(typeof defaultExport.action).toBe('function');
		});

		it('should have all expected options', async () => {
			const commandModule = await import(
				'../../../scripts/commands/linear-sync-labels.js'
			);
			const options = commandModule.default.options;

			const optionFlags = options.map((opt) => opt.flags);
			expect(optionFlags).toContain('-n, --dry-run');
			expect(optionFlags).toContain('-r, --resolve-conflicts');
			expect(optionFlags).toContain('--project-root <path>');
			expect(optionFlags).toContain('--team-id <id>');
			expect(optionFlags).toContain('-f, --force');
			expect(optionFlags).toContain('-v, --verbose');
		});

		it('should execute command function with correct arguments', async () => {
			const { linearSyncLabelsCommand } = await import(
				'../../../scripts/commands/linear-sync-labels.js'
			);

			const options = {
				dryRun: true,
				resolveConflicts: false,
				projectRoot: '/custom/path',
				teamId: 'team-123',
				force: true,
				verbose: false
			};

			// Store original argv to check restoration
			const originalArgv = process.argv.slice();

			await linearSyncLabelsCommand(options);

			expect(mockLinearSyncLabels).toHaveBeenCalled();
			// Check that argv was restored to original
			expect(process.argv).toEqual(originalArgv);
		});

		it('should handle command execution errors', async () => {
			const { linearSyncLabelsCommand } = await import(
				'../../../scripts/commands/linear-sync-labels.js'
			);

			mockLinearSyncLabels.mockRejectedValue(new Error('Test error'));

			await linearSyncLabelsCommand({});

			expect(process.exit).toHaveBeenCalledWith(1);
		});
	});

	describe('linear-sync-all command module', () => {
		it('should export command configuration correctly', async () => {
			const commandModule = await import(
				'../../../scripts/commands/linear-sync-all.js'
			);
			const defaultExport = commandModule.default;

			expect(defaultExport).toHaveProperty('command', 'linear-sync-all');
			expect(defaultExport).toHaveProperty('description');
			expect(defaultExport).toHaveProperty('options');
			expect(defaultExport).toHaveProperty('action');
			expect(Array.isArray(defaultExport.options)).toBe(true);
			expect(typeof defaultExport.action).toBe('function');
		});

		it('should have all expected options', async () => {
			const commandModule = await import(
				'../../../scripts/commands/linear-sync-all.js'
			);
			const options = commandModule.default.options;

			const optionFlags = options.map((opt) => opt.flags);
			expect(optionFlags).toContain('-n, --dry-run');
			expect(optionFlags).toContain('-r, --resolve-conflicts');
			expect(optionFlags).toContain('--project-root <path>');
			expect(optionFlags).toContain('--team-id <id>');
			expect(optionFlags).toContain('--labels-only');
			expect(optionFlags).toContain('-f, --force');
			expect(optionFlags).toContain('-v, --verbose');
		});

		it('should execute command function with all options', async () => {
			const { linearSyncAllCommand } = await import(
				'../../../scripts/commands/linear-sync-all.js'
			);

			const options = {
				dryRun: true,
				resolveConflicts: true,
				projectRoot: '/app',
				teamId: 'team-456',
				force: false,
				verbose: true,
				labelsOnly: true
			};

			// Store original argv to check restoration
			const originalArgv = process.argv.slice();

			await linearSyncAllCommand(options);

			expect(mockLinearSyncAll).toHaveBeenCalled();
			// Check that argv was restored to original
			expect(process.argv).toEqual(originalArgv);
		});

		it('should handle minimal options correctly', async () => {
			const { linearSyncAllCommand } = await import(
				'../../../scripts/commands/linear-sync-all.js'
			);

			const options = {};

			// Store original argv to check restoration
			const originalArgv = process.argv.slice();

			await linearSyncAllCommand(options);

			expect(mockLinearSyncAll).toHaveBeenCalled();
			// Check that argv was restored to original
			expect(process.argv).toEqual(originalArgv);
		});

		it('should handle command execution errors', async () => {
			const { linearSyncAllCommand } = await import(
				'../../../scripts/commands/linear-sync-all.js'
			);

			mockLinearSyncAll.mockRejectedValue(new Error('Sync failed'));

			await linearSyncAllCommand({});

			expect(process.exit).toHaveBeenCalledWith(1);
		});
	});

	describe('argument restoration', () => {
		it('should restore original process.argv after execution', async () => {
			const { linearSyncLabelsCommand } = await import(
				'../../../scripts/commands/linear-sync-labels.js'
			);

			const originalArgs = process.argv.slice();

			await linearSyncLabelsCommand({ dryRun: true });

			expect(process.argv).toEqual(originalArgs);
		});

		it('should restore original process.argv even after errors', async () => {
			const { linearSyncAllCommand } = await import(
				'../../../scripts/commands/linear-sync-all.js'
			);

			const originalArgs = process.argv.slice();
			mockLinearSyncAll.mockRejectedValue(new Error('Test error'));

			await linearSyncAllCommand({});

			expect(process.argv).toEqual(originalArgs);
		});
	});
});
