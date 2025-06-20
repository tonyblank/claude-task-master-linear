import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';

// Mock dependencies
jest.mock('fs');
jest.mock('path', () => ({
	join: jest.fn((dir, file) => `${dir}/${file}`),
	dirname: jest.fn((filePath) => filePath.split('/').slice(0, -1).join('/')),
	resolve: jest.fn((...paths) => paths.join('/'))
}));

jest.mock('chalk', () => ({
	red: jest.fn((text) => text),
	blue: jest.fn((text) => text),
	green: jest.fn((text) => text),
	yellow: jest.fn((text) => text),
	white: jest.fn((text) => text)
}));

// Mock console methods
const mockConsole = {
	log: jest.fn(),
	warn: jest.fn(),
	error: jest.fn()
};

// Mock the createLogWrapper utility
jest.mock('../../mcp-server/src/tools/utils.js', () => ({
	createLogWrapper: jest.fn(() => mockConsole)
}));

jest.mock('../../scripts/modules/utils.js', () => ({
	findProjectRoot: jest.fn(() => '/test/project')
}));

jest.mock('../../src/constants/paths.js', () => ({
	LEGACY_CONFIG_FILE: '.taskmasterconfig',
	TASKMASTER_CONFIG_FILE: 'config.json'
}));

// Import after mocks
import { migrateProject } from '../../scripts/modules/task-manager/migrate.js';

describe.skip('Migration Functionality', () => {
	let fsExistsSyncSpy;
	let fsReadFileSyncSpy;
	let fsWriteFileSyncSpy;
	let fsMkdirSyncSpy;
	let fsReaddirSyncSpy;
	let fsCopyFileSyncSpy;
	let fsUnlinkSyncSpy;

	beforeEach(() => {
		jest.clearAllMocks();
		fsExistsSyncSpy = jest.spyOn(fs, 'existsSync');
		fsReadFileSyncSpy = jest.spyOn(fs, 'readFileSync');
		fsWriteFileSyncSpy = jest.spyOn(fs, 'writeFileSync');
		fsMkdirSyncSpy = jest.spyOn(fs, 'mkdirSync');
		fsReaddirSyncSpy = jest.spyOn(fs, 'readdirSync');
		fsCopyFileSyncSpy = jest.spyOn(fs, 'copyFileSync');
		fsUnlinkSyncSpy = jest.spyOn(fs, 'unlinkSync');

		// Default mock implementations
		fsExistsSyncSpy.mockImplementation((filePath) => {
			if (filePath.includes('node_modules') || filePath.includes('jest')) {
				return false;
			}
			return false; // Default to not existing
		});
		fsReaddirSyncSpy.mockReturnValue([]);
		fsMkdirSyncSpy.mockImplementation(() => {});
		fsCopyFileSyncSpy.mockImplementation(() => {});
		fsWriteFileSyncSpy.mockImplementation(() => {});
		fsUnlinkSyncSpy.mockImplementation(() => {});
	});

	describe('Migration Detection', () => {
		test('should detect when .taskmaster directory already exists', async () => {
			// Mock .taskmaster directory already exists
			fsExistsSyncSpy.mockImplementation((filePath) => {
				if (filePath === '/test/project/.taskmaster') return true;
				return false;
			});

			await migrateProject();

			expect(mockConsole.warn).toHaveBeenCalledWith(
				expect.stringContaining('.taskmaster directory already exists')
			);
		});

		test('should proceed with migration when force option is used', async () => {
			// Mock .taskmaster directory exists but force is used
			fsExistsSyncSpy.mockImplementation((filePath) => {
				if (filePath === '/test/project/.taskmaster') return true;
				if (filePath === '/test/project/.taskmasterconfig') return true;
				return false;
			});

			fsReadFileSyncSpy.mockReturnValue(
				'{"models":{"main":{"provider":"anthropic"}}}'
			);

			await migrateProject({ force: true });

			expect(mockConsole.log).toHaveBeenCalledWith(
				expect.stringContaining('Starting migration')
			);
		});

		test('should detect no files to migrate', async () => {
			// Mock no legacy files exist
			fsExistsSyncSpy.mockReturnValue(false);

			await migrateProject();

			expect(mockConsole.log).toHaveBeenCalledWith(
				expect.stringContaining('No files to migrate')
			);
		});
	});

	describe('Legacy File Detection', () => {
		test('should detect legacy config file for migration', async () => {
			const legacyConfig = {
				models: {
					main: { provider: 'openai', modelId: 'gpt-4' }
				},
				global: {
					logLevel: 'debug',
					projectName: 'Legacy Project'
				}
			};

			fsExistsSyncSpy.mockImplementation((filePath) => {
				if (filePath === '/test/project/.taskmasterconfig') return true;
				if (filePath === '/test/project/.taskmaster') return false;
				return false;
			});

			fsReadFileSyncSpy.mockImplementation((filePath) => {
				if (filePath === '/test/project/.taskmasterconfig') {
					return JSON.stringify(legacyConfig);
				}
				return '[]';
			});

			await migrateProject();

			expect(mockConsole.log).toHaveBeenCalledWith(
				expect.stringContaining('Starting migration')
			);
		});

		test('should detect legacy tasks directory', async () => {
			fsExistsSyncSpy.mockImplementation((filePath) => {
				if (filePath === '/test/project/tasks') return true;
				if (filePath === '/test/project/.taskmaster') return false;
				return false;
			});

			fsReaddirSyncSpy.mockImplementation((dirPath) => {
				if (dirPath === '/test/project/tasks') {
					return ['tasks.json', 'task-1.txt', 'task-2.txt'];
				}
				return [];
			});

			await migrateProject();

			expect(mockConsole.log).toHaveBeenCalledWith(
				expect.stringContaining('Starting migration')
			);
		});

		test('should detect legacy scripts directory with PRD files', async () => {
			fsExistsSyncSpy.mockImplementation((filePath) => {
				if (filePath === '/test/project/scripts') return true;
				if (filePath === '/test/project/.taskmaster') return false;
				return false;
			});

			fsReaddirSyncSpy.mockImplementation((dirPath) => {
				if (dirPath === '/test/project/scripts') {
					return ['prd.txt', 'example_prd.txt', 'task-complexity-report.json'];
				}
				return [];
			});

			await migrateProject();

			expect(mockConsole.log).toHaveBeenCalledWith(
				expect.stringContaining('Starting migration')
			);
		});
	});

	describe('Migration Operations', () => {
		test('should create .taskmaster directory structure', async () => {
			fsExistsSyncSpy.mockImplementation((filePath) => {
				if (filePath === '/test/project/.taskmasterconfig') return true;
				if (filePath === '/test/project/.taskmaster') return false;
				return false;
			});

			fsReadFileSyncSpy.mockReturnValue(
				'{"models":{"main":{"provider":"anthropic"}}}'
			);

			await migrateProject();

			expect(fsMkdirSyncSpy).toHaveBeenCalledWith('/test/project/.taskmaster', {
				recursive: true
			});
			expect(fsMkdirSyncSpy).toHaveBeenCalledWith(
				'/test/project/.taskmaster/tasks',
				{ recursive: true }
			);
			expect(fsMkdirSyncSpy).toHaveBeenCalledWith(
				'/test/project/.taskmaster/docs',
				{ recursive: true }
			);
			expect(fsMkdirSyncSpy).toHaveBeenCalledWith(
				'/test/project/.taskmaster/reports',
				{ recursive: true }
			);
			expect(fsMkdirSyncSpy).toHaveBeenCalledWith(
				'/test/project/.taskmaster/templates',
				{ recursive: true }
			);
		});

		test('should migrate config file from legacy location', async () => {
			const legacyConfig = {
				models: {
					main: { provider: 'openai', modelId: 'gpt-4' }
				}
			};

			fsExistsSyncSpy.mockImplementation((filePath) => {
				if (filePath === '/test/project/.taskmasterconfig') return true;
				if (filePath === '/test/project/.taskmaster') return false;
				return false;
			});

			fsReadFileSyncSpy.mockReturnValue(JSON.stringify(legacyConfig));

			await migrateProject();

			expect(fsWriteFileSyncSpy).toHaveBeenCalledWith(
				'/test/project/.taskmaster/config.json',
				expect.stringContaining('"provider":"openai"')
			);
		});

		test('should migrate tasks directory', async () => {
			fsExistsSyncSpy.mockImplementation((filePath) => {
				if (filePath === '/test/project/tasks') return true;
				if (filePath === '/test/project/tasks/tasks.json') return true;
				if (filePath === '/test/project/tasks/task-1.txt') return true;
				if (filePath === '/test/project/.taskmaster') return false;
				return false;
			});

			fsReaddirSyncSpy.mockImplementation((dirPath) => {
				if (dirPath === '/test/project/tasks') {
					return ['tasks.json', 'task-1.txt', 'task-2.txt'];
				}
				return [];
			});

			await migrateProject();

			expect(fsCopyFileSyncSpy).toHaveBeenCalledWith(
				'/test/project/tasks/tasks.json',
				'/test/project/.taskmaster/tasks/tasks.json'
			);
			expect(fsCopyFileSyncSpy).toHaveBeenCalledWith(
				'/test/project/tasks/task-1.txt',
				'/test/project/.taskmaster/tasks/task-1.txt'
			);
		});

		test('should migrate PRD files to docs directory', async () => {
			fsExistsSyncSpy.mockImplementation((filePath) => {
				if (filePath === '/test/project/scripts') return true;
				if (filePath === '/test/project/scripts/prd.txt') return true;
				if (filePath === '/test/project/.taskmaster') return false;
				return false;
			});

			fsReaddirSyncSpy.mockImplementation((dirPath) => {
				if (dirPath === '/test/project/scripts') {
					return ['prd.txt', 'requirements.txt'];
				}
				return [];
			});

			await migrateProject();

			expect(fsCopyFileSyncSpy).toHaveBeenCalledWith(
				'/test/project/scripts/prd.txt',
				'/test/project/.taskmaster/docs/prd.txt'
			);
			expect(fsCopyFileSyncSpy).toHaveBeenCalledWith(
				'/test/project/scripts/requirements.txt',
				'/test/project/.taskmaster/docs/requirements.txt'
			);
		});

		test('should migrate example files to templates directory', async () => {
			fsExistsSyncSpy.mockImplementation((filePath) => {
				if (filePath === '/test/project/scripts') return true;
				if (filePath === '/test/project/scripts/example_prd.txt') return true;
				if (filePath === '/test/project/.taskmaster') return false;
				return false;
			});

			fsReaddirSyncSpy.mockImplementation((dirPath) => {
				if (dirPath === '/test/project/scripts') {
					return ['example_prd.txt', 'template.txt'];
				}
				return [];
			});

			await migrateProject();

			expect(fsCopyFileSyncSpy).toHaveBeenCalledWith(
				'/test/project/scripts/example_prd.txt',
				'/test/project/.taskmaster/templates/example_prd.txt'
			);
		});

		test('should migrate reports to reports directory', async () => {
			fsExistsSyncSpy.mockImplementation((filePath) => {
				if (filePath === '/test/project/scripts') return true;
				if (filePath === '/test/project/scripts/task-complexity-report.json')
					return true;
				if (filePath === '/test/project/.taskmaster') return false;
				return false;
			});

			fsReaddirSyncSpy.mockImplementation((dirPath) => {
				if (dirPath === '/test/project/scripts') {
					return ['task-complexity-report.json'];
				}
				return [];
			});

			await migrateProject();

			expect(fsCopyFileSyncSpy).toHaveBeenCalledWith(
				'/test/project/scripts/task-complexity-report.json',
				'/test/project/.taskmaster/reports/task-complexity-report.json'
			);
		});
	});

	describe('Migration Options', () => {
		test('should create backups when backup option is enabled', async () => {
			fsExistsSyncSpy.mockImplementation((filePath) => {
				if (filePath === '/test/project/.taskmasterconfig') return true;
				if (filePath === '/test/project/.taskmaster') return false;
				return false;
			});

			fsReadFileSyncSpy.mockReturnValue(
				'{"models":{"main":{"provider":"anthropic"}}}'
			);

			await migrateProject({ backup: true });

			expect(fsCopyFileSyncSpy).toHaveBeenCalledWith(
				'/test/project/.taskmasterconfig',
				expect.stringContaining('.taskmasterconfig.backup')
			);
		});

		test('should cleanup old files when cleanup option is enabled', async () => {
			fsExistsSyncSpy.mockImplementation((filePath) => {
				if (filePath === '/test/project/.taskmasterconfig') return true;
				if (filePath === '/test/project/.taskmaster') return false;
				return false;
			});

			fsReadFileSyncSpy.mockReturnValue(
				'{"models":{"main":{"provider":"anthropic"}}}'
			);

			await migrateProject({ cleanup: true });

			expect(fsUnlinkSyncSpy).toHaveBeenCalledWith(
				'/test/project/.taskmasterconfig'
			);
		});

		test('should not cleanup when cleanup option is disabled', async () => {
			fsExistsSyncSpy.mockImplementation((filePath) => {
				if (filePath === '/test/project/.taskmasterconfig') return true;
				if (filePath === '/test/project/.taskmaster') return false;
				return false;
			});

			fsReadFileSyncSpy.mockReturnValue(
				'{"models":{"main":{"provider":"anthropic"}}}'
			);

			await migrateProject({ cleanup: false });

			expect(fsUnlinkSyncSpy).not.toHaveBeenCalled();
		});
	});

	describe('Error Handling', () => {
		test('should handle file system errors gracefully', async () => {
			fsExistsSyncSpy.mockImplementation((filePath) => {
				if (filePath === '/test/project/.taskmasterconfig') return true;
				if (filePath === '/test/project/.taskmaster') return false;
				return false;
			});

			fsReadFileSyncSpy.mockImplementation(() => {
				throw new Error('Permission denied');
			});

			await expect(migrateProject()).resolves.not.toThrow();
			expect(mockConsole.error).toHaveBeenCalled();
		});

		test('should handle invalid JSON in config file', async () => {
			fsExistsSyncSpy.mockImplementation((filePath) => {
				if (filePath === '/test/project/.taskmasterconfig') return true;
				if (filePath === '/test/project/.taskmaster') return false;
				return false;
			});

			fsReadFileSyncSpy.mockReturnValue('{ invalid json }');

			await expect(migrateProject()).resolves.not.toThrow();
			expect(mockConsole.error).toHaveBeenCalled();
		});

		test('should handle missing directories gracefully', async () => {
			fsExistsSyncSpy.mockImplementation((filePath) => {
				if (filePath === '/test/project/tasks') return true;
				if (filePath === '/test/project/.taskmaster') return false;
				return false;
			});

			fsReaddirSyncSpy.mockImplementation(() => {
				throw new Error('Directory not found');
			});

			await expect(migrateProject()).resolves.not.toThrow();
			expect(mockConsole.error).toHaveBeenCalled();
		});
	});

	describe('Complex Migration Scenarios', () => {
		test('should handle complete legacy project migration', async () => {
			// Setup a complete legacy project
			fsExistsSyncSpy.mockImplementation((filePath) => {
				const legacyFiles = [
					'/test/project/.taskmasterconfig',
					'/test/project/tasks',
					'/test/project/tasks/tasks.json',
					'/test/project/tasks/task-1.txt',
					'/test/project/scripts',
					'/test/project/scripts/prd.txt',
					'/test/project/scripts/example_prd.txt',
					'/test/project/scripts/task-complexity-report.json'
				];
				return legacyFiles.includes(filePath);
			});

			fsReaddirSyncSpy.mockImplementation((dirPath) => {
				if (dirPath === '/test/project/tasks') {
					return ['tasks.json', 'task-1.txt', 'task-2.txt'];
				}
				if (dirPath === '/test/project/scripts') {
					return ['prd.txt', 'example_prd.txt', 'task-complexity-report.json'];
				}
				return [];
			});

			fsReadFileSyncSpy.mockReturnValue(
				'{"models":{"main":{"provider":"anthropic"}}}'
			);

			await migrateProject();

			// Verify directory creation
			expect(fsMkdirSyncSpy).toHaveBeenCalledWith('/test/project/.taskmaster', {
				recursive: true
			});
			expect(fsMkdirSyncSpy).toHaveBeenCalledWith(
				'/test/project/.taskmaster/tasks',
				{ recursive: true }
			);
			expect(fsMkdirSyncSpy).toHaveBeenCalledWith(
				'/test/project/.taskmaster/docs',
				{ recursive: true }
			);
			expect(fsMkdirSyncSpy).toHaveBeenCalledWith(
				'/test/project/.taskmaster/reports',
				{ recursive: true }
			);
			expect(fsMkdirSyncSpy).toHaveBeenCalledWith(
				'/test/project/.taskmaster/templates',
				{ recursive: true }
			);

			// Verify file migrations
			expect(fsWriteFileSyncSpy).toHaveBeenCalledWith(
				'/test/project/.taskmaster/config.json',
				expect.any(String)
			);
			expect(fsCopyFileSyncSpy).toHaveBeenCalledWith(
				'/test/project/tasks/tasks.json',
				'/test/project/.taskmaster/tasks/tasks.json'
			);
			expect(fsCopyFileSyncSpy).toHaveBeenCalledWith(
				'/test/project/scripts/prd.txt',
				'/test/project/.taskmaster/docs/prd.txt'
			);
		});
	});
});
