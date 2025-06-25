/**
 * Tests for the Environment File Manager module
 */

import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';

// Mock fs before importing the module
jest.unstable_mockModule('fs', () => ({
	default: {
		existsSync: jest.fn(),
		readFileSync: jest.fn(),
		writeFileSync: jest.fn(),
		mkdirSync: jest.fn(),
		copyFileSync: jest.fn(),
		chmodSync: jest.fn(),
		accessSync: jest.fn(),
		constants: {
			W_OK: 2
		}
	}
}));

const mockFs = await import('fs');

// Import the module under test
const {
	parseEnvFile,
	appendLinearSection,
	writeEnvFile,
	createEnvBackup,
	validateEnvIntegrity,
	checkEnvWritePermissions,
	restoreEnvFromBackup,
	formatLinearEnvVars,
	ENV_MANAGER_ERRORS
} = await import('../../../../scripts/modules/env-file-manager.js');

describe('Environment File Manager', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('parseEnvFile', () => {
		it('should parse existing .env file correctly', () => {
			const envContent = `# Comment
ANTHROPIC_API_KEY=test_key
EXISTING_VAR=value1

# Another comment
LINEAR_API_KEY=existing_linear_key`;

			mockFs.default.existsSync.mockReturnValue(true);
			mockFs.default.readFileSync.mockReturnValue(envContent);

			const result = parseEnvFile('/test/.env');

			expect(result.lines).toHaveLength(6);
			expect(result.variables.get('ANTHROPIC_API_KEY')).toBe('test_key');
			expect(result.variables.get('EXISTING_VAR')).toBe('value1');
			expect(result.variables.get('LINEAR_API_KEY')).toBe(
				'existing_linear_key'
			);
			expect(result.hasLinearSection).toBe(true);
			expect(result.originalContent).toBe(envContent);
		});

		it('should handle non-existent .env file', () => {
			mockFs.default.existsSync.mockReturnValue(false);

			const result = parseEnvFile('/test/.env');

			expect(result.lines).toHaveLength(0);
			expect(result.variables.size).toBe(0);
			expect(result.hasLinearSection).toBe(false);
		});

		it('should handle .env file without Linear section', () => {
			const envContent = `ANTHROPIC_API_KEY=test_key
OTHER_VAR=value`;

			mockFs.default.existsSync.mockReturnValue(true);
			mockFs.default.readFileSync.mockReturnValue(envContent);

			const result = parseEnvFile('/test/.env');

			expect(result.hasLinearSection).toBe(false);
			expect(result.variables.get('ANTHROPIC_API_KEY')).toBe('test_key');
			expect(result.variables.get('OTHER_VAR')).toBe('value');
		});

		it('should handle variables with equals signs in values', () => {
			const envContent = `URL=https://example.com/path?param=value
COMPLEX_VAR=value=with=equals`;

			mockFs.default.existsSync.mockReturnValue(true);
			mockFs.default.readFileSync.mockReturnValue(envContent);

			const result = parseEnvFile('/test/.env');

			expect(result.variables.get('URL')).toBe(
				'https://example.com/path?param=value'
			);
			expect(result.variables.get('COMPLEX_VAR')).toBe('value=with=equals');
		});

		it('should throw error on file read failure', () => {
			mockFs.default.existsSync.mockReturnValue(true);
			mockFs.default.readFileSync.mockImplementation(() => {
				throw new Error('Permission denied');
			});

			expect(() => parseEnvFile('/test/.env')).toThrow(
				ENV_MANAGER_ERRORS.PARSE_ERROR
			);
		});
	});

	describe('appendLinearSection', () => {
		it('should append Linear section to new .env data', () => {
			const envData = {
				lines: ['ANTHROPIC_API_KEY=test_key', 'OTHER_VAR=value'],
				variables: new Map([
					['ANTHROPIC_API_KEY', 'test_key'],
					['OTHER_VAR', 'value']
				]),
				hasLinearSection: false
			};

			const linearVars = {
				LINEAR_API_KEY: 'new_linear_key',
				LINEAR_TEAM_IDS: 'team1,team2',
				LINEAR_PROJECT_IDS: 'proj1,proj2'
			};

			const result = appendLinearSection(envData, linearVars);

			expect(result.hasLinearSection).toBe(true);
			expect(result.lines).toContain('# Linear Integration Settings');
			expect(result.lines).toContain('LINEAR_API_KEY=new_linear_key');
			expect(result.lines).toContain('LINEAR_TEAM_IDS=team1,team2');
			expect(result.lines).toContain('LINEAR_PROJECT_IDS=proj1,proj2');
			expect(result.variables.get('LINEAR_API_KEY')).toBe('new_linear_key');
		});

		it('should replace existing Linear section', () => {
			const envData = {
				lines: [
					'ANTHROPIC_API_KEY=test_key',
					'',
					'# Linear Integration Settings',
					'LINEAR_API_KEY=old_key',
					'LINEAR_TEAM_IDS=old_team'
				],
				variables: new Map([
					['ANTHROPIC_API_KEY', 'test_key'],
					['LINEAR_API_KEY', 'old_key'],
					['LINEAR_TEAM_IDS', 'old_team']
				]),
				hasLinearSection: true
			};

			const linearVars = {
				LINEAR_API_KEY: 'new_linear_key',
				LINEAR_TEAM_IDS: 'team1,team2'
			};

			const result = appendLinearSection(envData, linearVars);

			expect(result.hasLinearSection).toBe(true);
			expect(result.variables.get('LINEAR_API_KEY')).toBe('new_linear_key');
			expect(result.variables.get('LINEAR_TEAM_IDS')).toBe('team1,team2');

			// Should preserve non-Linear variables
			expect(result.variables.get('ANTHROPIC_API_KEY')).toBe('test_key');
		});

		it('should handle empty env data', () => {
			const envData = {
				lines: [],
				variables: new Map(),
				hasLinearSection: false
			};

			const linearVars = {
				LINEAR_API_KEY: 'linear_key'
			};

			const result = appendLinearSection(envData, linearVars);

			expect(result.lines).toContain('# Linear Integration Settings');
			expect(result.lines).toContain('LINEAR_API_KEY=linear_key');
		});
	});

	describe('writeEnvFile', () => {
		it('should write .env file with correct permissions', async () => {
			const envData = {
				lines: ['ANTHROPIC_API_KEY=test_key', 'LINEAR_API_KEY=linear_key']
			};

			mockFs.default.existsSync.mockReturnValue(true);
			mockFs.default.readFileSync.mockReturnValue(
				'ANTHROPIC_API_KEY=test_key\nLINEAR_API_KEY=linear_key'
			);

			await writeEnvFile(envData, '/test/.env');

			expect(mockFs.default.writeFileSync).toHaveBeenCalledWith(
				'/test/.env',
				'ANTHROPIC_API_KEY=test_key\nLINEAR_API_KEY=linear_key',
				{ mode: 0o600 }
			);
		});

		it('should create directory if it does not exist', async () => {
			const envData = { lines: ['TEST=value'] };

			mockFs.default.existsSync.mockReturnValueOnce(false); // directory doesn't exist
			mockFs.default.existsSync.mockReturnValueOnce(true); // file exists after write
			mockFs.default.readFileSync.mockReturnValue('TEST=value');

			await writeEnvFile(envData, '/new/path/.env');

			expect(mockFs.default.mkdirSync).toHaveBeenCalledWith('/new/path', {
				recursive: true
			});
		});

		it('should throw error on write failure', async () => {
			const envData = { lines: ['TEST=value'] };

			mockFs.default.writeFileSync.mockImplementation(() => {
				throw new Error('Disk full');
			});

			await expect(writeEnvFile(envData, '/test/.env')).rejects.toThrow(
				ENV_MANAGER_ERRORS.WRITE_ERROR
			);
		});

		it('should throw error on verification failure', async () => {
			const envData = { lines: ['TEST=value'] };

			mockFs.default.readFileSync.mockReturnValueOnce('DIFFERENT_CONTENT'); // verification fails

			await expect(writeEnvFile(envData, '/test/.env')).rejects.toThrow(
				ENV_MANAGER_ERRORS.WRITE_ERROR
			);
		});
	});

	describe('createEnvBackup', () => {
		it('should create timestamped backup', () => {
			const mockDate = new Date('2023-01-01T10:30:00.000Z');
			jest.spyOn(global, 'Date').mockImplementation(() => mockDate);

			mockFs.default.existsSync.mockReturnValueOnce(true); // file exists
			mockFs.default.existsSync.mockReturnValueOnce(false); // backup dir doesn't exist

			const backupPath = createEnvBackup('/test/.env');

			expect(mockFs.default.mkdirSync).toHaveBeenCalledWith(
				'/test/.taskmaster/backups',
				{ recursive: true }
			);
			expect(mockFs.default.copyFileSync).toHaveBeenCalledWith(
				'/test/.env',
				expect.stringContaining('env-backup-2023-01-01T10-30-00-000Z.env')
			);
			expect(backupPath).toContain('env-backup-2023-01-01T10-30-00-000Z.env');

			global.Date.mockRestore();
		});

		it('should return null for non-existent file', () => {
			mockFs.default.existsSync.mockReturnValue(false);

			const result = createEnvBackup('/test/.env');

			expect(result).toBeNull();
			expect(mockFs.default.copyFileSync).not.toHaveBeenCalled();
		});

		it('should throw error on backup failure', () => {
			mockFs.default.existsSync.mockReturnValue(true);
			mockFs.default.copyFileSync.mockImplementation(() => {
				throw new Error('Permission denied');
			});

			expect(() => createEnvBackup('/test/.env')).toThrow(
				ENV_MANAGER_ERRORS.BACKUP_ERROR
			);
		});
	});

	describe('validateEnvIntegrity', () => {
		it('should validate preserved variables', () => {
			const originalVars = new Map([
				['ANTHROPIC_API_KEY', 'key1'],
				['OTHER_VAR', 'value1'],
				['LINEAR_API_KEY', 'old_linear']
			]);

			const newVars = new Map([
				['ANTHROPIC_API_KEY', 'key1'],
				['OTHER_VAR', 'value1'],
				['LINEAR_API_KEY', 'new_linear'],
				['LINEAR_TEAM_IDS', 'team1,team2']
			]);

			const result = validateEnvIntegrity(originalVars, newVars);

			expect(result.valid).toBe(true);
			expect(result.preserved).toContain('ANTHROPIC_API_KEY');
			expect(result.preserved).toContain('OTHER_VAR');
			expect(result.added).toContain('LINEAR_TEAM_IDS');
			expect(result.errors).toHaveLength(0);
		});

		it('should detect lost variables', () => {
			const originalVars = new Map([
				['ANTHROPIC_API_KEY', 'key1'],
				['IMPORTANT_VAR', 'value1']
			]);

			const newVars = new Map([
				['ANTHROPIC_API_KEY', 'key1']
				// IMPORTANT_VAR is missing
			]);

			const result = validateEnvIntegrity(originalVars, newVars);

			expect(result.valid).toBe(false);
			expect(result.errors).toContain('Lost existing variable: IMPORTANT_VAR');
		});

		it('should detect modified variables', () => {
			const originalVars = new Map([
				['ANTHROPIC_API_KEY', 'key1'],
				['OTHER_VAR', 'original_value']
			]);

			const newVars = new Map([
				['ANTHROPIC_API_KEY', 'key1'],
				['OTHER_VAR', 'modified_value']
			]);

			const result = validateEnvIntegrity(originalVars, newVars);

			expect(result.valid).toBe(true);
			expect(result.warnings).toContain(
				'Modified existing variable: OTHER_VAR'
			);
			expect(result.modified).toContain('OTHER_VAR');
		});

		it('should ignore Linear variables in validation', () => {
			const originalVars = new Map([
				['ANTHROPIC_API_KEY', 'key1'],
				['LINEAR_API_KEY', 'old_linear']
			]);

			const newVars = new Map([
				['ANTHROPIC_API_KEY', 'key1'],
				['LINEAR_API_KEY', 'new_linear'],
				['LINEAR_TEAM_IDS', 'team1']
			]);

			const result = validateEnvIntegrity(originalVars, newVars);

			expect(result.valid).toBe(true);
			expect(result.preserved).toContain('ANTHROPIC_API_KEY');
			expect(result.preserved).not.toContain('LINEAR_API_KEY');
		});
	});

	describe('checkEnvWritePermissions', () => {
		it('should return true for writable directory and file', () => {
			mockFs.default.accessSync.mockReturnValue(undefined); // No throw = access OK
			mockFs.default.existsSync.mockReturnValue(true);

			const result = checkEnvWritePermissions('/test/.env');

			expect(result).toBe(true);
		});

		it('should return true for writable directory with non-existent file', () => {
			mockFs.default.accessSync.mockReturnValueOnce(undefined); // Directory OK
			mockFs.default.existsSync.mockReturnValue(false); // File doesn't exist

			const result = checkEnvWritePermissions('/test/.env');

			expect(result).toBe(true);
		});

		it('should return false for non-writable directory', () => {
			mockFs.default.accessSync.mockImplementation(() => {
				throw new Error('Permission denied');
			});

			const result = checkEnvWritePermissions('/test/.env');

			expect(result).toBe(false);
		});
	});

	describe('restoreEnvFromBackup', () => {
		it('should restore file from backup with correct permissions', async () => {
			mockFs.default.existsSync.mockReturnValue(true);
			mockFs.default.copyFileSync.mockReturnValue(undefined);
			mockFs.default.chmodSync.mockReturnValue(undefined);

			await restoreEnvFromBackup('/backup/.env', '/test/.env');

			expect(mockFs.default.copyFileSync).toHaveBeenCalledWith(
				'/backup/.env',
				'/test/.env'
			);
			expect(mockFs.default.chmodSync).toHaveBeenCalledWith(
				'/test/.env',
				0o600
			);
		});

		it('should throw error if backup file does not exist', async () => {
			mockFs.default.existsSync.mockReturnValue(false);

			await expect(
				restoreEnvFromBackup('/backup/.env', '/test/.env')
			).rejects.toThrow(ENV_MANAGER_ERRORS.WRITE_ERROR);
		});

		it('should throw error on restore failure', async () => {
			mockFs.default.existsSync.mockReturnValue(true);
			mockFs.default.copyFileSync.mockImplementation(() => {
				throw new Error('Copy failed');
			});

			await expect(
				restoreEnvFromBackup('/backup/.env', '/test/.env')
			).rejects.toThrow(ENV_MANAGER_ERRORS.WRITE_ERROR);
		});
	});

	describe('formatLinearEnvVars', () => {
		it('should format wizard selections into environment variables', () => {
			const selections = {
				apiKey: 'lin_api_test_key',
				teams: [
					{ id: 'team1', name: 'Team 1' },
					{ id: 'team2', name: 'Team 2' }
				],
				projects: ['proj1', 'proj2', 'proj3'],
				workspaceId: 'workspace123'
			};

			const result = formatLinearEnvVars(selections);

			expect(result.LINEAR_API_KEY).toBe('lin_api_test_key');
			expect(result.LINEAR_TEAM_IDS).toBe('team1,team2');
			expect(result.LINEAR_PROJECT_IDS).toBe('proj1,proj2,proj3');
			expect(result.LINEAR_WORKSPACE_ID).toBe('workspace123');
		});

		it('should handle mixed team formats', () => {
			const selections = {
				teams: ['team1', { id: 'team2', name: 'Team 2' }, 'team3']
			};

			const result = formatLinearEnvVars(selections);

			expect(result.LINEAR_TEAM_IDS).toBe('team1,team2,team3');
		});

		it('should handle empty selections', () => {
			const selections = {};

			const result = formatLinearEnvVars(selections);

			expect(Object.keys(result)).toHaveLength(0);
		});

		it('should handle single team and project', () => {
			const selections = {
				teams: [{ id: 'single-team' }],
				projects: ['single-project']
			};

			const result = formatLinearEnvVars(selections);

			expect(result.LINEAR_TEAM_IDS).toBe('single-team');
			expect(result.LINEAR_PROJECT_IDS).toBe('single-project');
		});
	});
});
