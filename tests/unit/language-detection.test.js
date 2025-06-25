/**
 * Tests for the language detection module
 */

import { jest } from '@jest/globals';

// Import the module under test
const {
	LANGUAGE_MAPPINGS,
	FILENAME_PATTERNS,
	LANGUAGE_FAMILIES,
	detectLanguageFromPath,
	detectLanguagesFromPaths,
	extractFilePathsFromContent,
	detectLanguagesFromTask,
	getLanguageSuggestions,
	isValidLanguage,
	getLanguageInfo,
	languageToLabelKey,
	getAllLanguages
} = await import('../../scripts/modules/language-detection.js');

describe('Language Detection Module', () => {
	describe('LANGUAGE_MAPPINGS', () => {
		it('should contain common file extensions', () => {
			const extensions = Object.keys(LANGUAGE_MAPPINGS);
			expect(extensions).toContain('.js');
			expect(extensions).toContain('.ts');
			expect(extensions).toContain('.py');
			expect(extensions).toContain('.java');
			expect(extensions).toContain('.cpp');
		});

		it('should have consistent structure for all mappings', () => {
			Object.entries(LANGUAGE_MAPPINGS).forEach(([ext, lang]) => {
				expect(lang).toHaveProperty('name');
				expect(lang).toHaveProperty('color');
				expect(typeof lang.name).toBe('string');
				expect(typeof lang.color).toBe('string');
				expect(lang.color).toMatch(/^#[0-9a-f]{6}$/i);
			});
		});
	});

	describe('FILENAME_PATTERNS', () => {
		it('should contain special filenames', () => {
			const filenames = Object.keys(FILENAME_PATTERNS);
			expect(filenames).toContain('dockerfile');
			expect(filenames).toContain('makefile');
			expect(filenames).toContain('package.json');
		});

		it('should have consistent structure', () => {
			Object.entries(FILENAME_PATTERNS).forEach(([filename, lang]) => {
				expect(lang).toHaveProperty('name');
				expect(lang).toHaveProperty('color');
				expect(typeof lang.name).toBe('string');
				expect(typeof lang.color).toBe('string');
			});
		});
	});

	describe('detectLanguageFromPath', () => {
		it('should detect languages from file extensions', () => {
			expect(detectLanguageFromPath('app.js')).toEqual({
				name: 'JavaScript',
				color: '#f1e05a'
			});

			expect(detectLanguageFromPath('main.py')).toEqual({
				name: 'Python',
				color: '#3572a5'
			});

			expect(detectLanguageFromPath('Component.tsx')).toEqual({
				name: 'TypeScript',
				color: '#2b7489'
			});
		});

		it('should detect languages from full paths', () => {
			expect(detectLanguageFromPath('/src/components/App.js')).toEqual({
				name: 'JavaScript',
				color: '#f1e05a'
			});

			expect(detectLanguageFromPath('src\\utils\\helper.py')).toEqual({
				name: 'Python',
				color: '#3572a5'
			});
		});

		it('should handle special filename patterns', () => {
			expect(detectLanguageFromPath('Dockerfile')).toEqual({
				name: 'Dockerfile',
				color: '#384d54'
			});

			expect(detectLanguageFromPath('Makefile')).toEqual({
				name: 'Makefile',
				color: '#427819'
			});

			expect(detectLanguageFromPath('package.json')).toEqual({
				name: 'JSON',
				color: '#292929'
			});
		});

		it('should be case insensitive', () => {
			expect(detectLanguageFromPath('APP.JS')).toEqual({
				name: 'JavaScript',
				color: '#f1e05a'
			});

			expect(detectLanguageFromPath('DOCKERFILE')).toEqual({
				name: 'Dockerfile',
				color: '#384d54'
			});
		});

		it('should return null for unknown extensions', () => {
			expect(detectLanguageFromPath('file.unknown')).toBeNull();
			expect(detectLanguageFromPath('no-extension')).toBeNull();
		});

		it('should handle invalid inputs', () => {
			expect(detectLanguageFromPath(null)).toBeNull();
			expect(detectLanguageFromPath(undefined)).toBeNull();
			expect(detectLanguageFromPath('')).toBeNull();
			expect(detectLanguageFromPath(123)).toBeNull();
		});

		it('should prioritize filename patterns over extensions', () => {
			// dockerfile.txt should be detected as Dockerfile, not by .txt extension
			expect(detectLanguageFromPath('dockerfile')).toEqual({
				name: 'Dockerfile',
				color: '#384d54'
			});
		});
	});

	describe('detectLanguagesFromPaths', () => {
		it('should detect multiple languages from file paths', () => {
			const paths = [
				'src/app.js',
				'api/main.py',
				'components/Header.tsx',
				'styles/main.css'
			];

			const languages = detectLanguagesFromPaths(paths);

			expect(languages).toHaveLength(4);
			expect(languages.map((l) => l.name)).toContain('JavaScript');
			expect(languages.map((l) => l.name)).toContain('Python');
			expect(languages.map((l) => l.name)).toContain('TypeScript');
			expect(languages.map((l) => l.name)).toContain('CSS');
		});

		it('should deduplicate languages', () => {
			const paths = ['src/app.js', 'src/utils.js', 'tests/app.test.js'];

			const languages = detectLanguagesFromPaths(paths);

			expect(languages).toHaveLength(1);
			expect(languages[0].name).toBe('JavaScript');
		});

		it('should handle empty or invalid inputs', () => {
			expect(detectLanguagesFromPaths([])).toEqual([]);
			expect(detectLanguagesFromPaths(null)).toEqual([]);
			expect(detectLanguagesFromPaths(undefined)).toEqual([]);
			expect(detectLanguagesFromPaths('not-an-array')).toEqual([]);
		});

		it('should ignore paths with unknown extensions', () => {
			const paths = ['src/app.js', 'file.unknown', 'no-extension'];

			const languages = detectLanguagesFromPaths(paths);

			expect(languages).toHaveLength(1);
			expect(languages[0].name).toBe('JavaScript');
		});
	});

	describe('extractFilePathsFromContent', () => {
		it('should extract file paths with extensions', () => {
			const content = 'Update src/app.js and fix tests/app.test.js';
			const paths = extractFilePathsFromContent(content);

			expect(paths).toContain('src/app.js');
			expect(paths).toContain('tests/app.test.js');
		});

		it('should extract relative paths', () => {
			const content = 'Check ./src/utils.py and ../config.json';
			const paths = extractFilePathsFromContent(content);

			expect(paths).toContain('./src/utils.py');
			expect(paths).toContain('../config.json');
		});

		it('should extract absolute paths', () => {
			const content = 'Update /home/user/project/main.py';
			const paths = extractFilePathsFromContent(content);

			expect(paths).toContain('/home/user/project/main.py');
		});

		it('should extract Windows paths', () => {
			const content = 'Fix C:\\\\Projects\\\\app\\\\src\\\\main.cs';
			const paths = extractFilePathsFromContent(content);

			expect(paths.some((p) => p.includes('main.cs'))).toBe(true);
		});

		it('should extract special filenames', () => {
			const content = 'Update Dockerfile and package.json files';
			const paths = extractFilePathsFromContent(content);

			expect(paths).toContain('Dockerfile');
			expect(paths).toContain('package.json');
		});

		it('should handle empty or invalid content', () => {
			expect(extractFilePathsFromContent('')).toEqual([]);
			expect(extractFilePathsFromContent(null)).toEqual([]);
			expect(extractFilePathsFromContent(undefined)).toEqual([]);
			expect(extractFilePathsFromContent(123)).toEqual([]);
		});

		it('should deduplicate paths', () => {
			const content = 'Update app.js and then test app.js again';
			const paths = extractFilePathsFromContent(content);

			expect(paths.filter((p) => p === 'app.js')).toHaveLength(1);
		});
	});

	describe('detectLanguagesFromTask', () => {
		it('should detect languages from task content', () => {
			const task = {
				title: 'Fix bug in app.js',
				description: 'Update the main.py script',
				details: 'Also check styles.css and config.json'
			};

			const languages = detectLanguagesFromTask(task);

			expect(languages.map((l) => l.name)).toContain('JavaScript');
			expect(languages.map((l) => l.name)).toContain('Python');
			expect(languages.map((l) => l.name)).toContain('CSS');
			expect(languages.map((l) => l.name)).toContain('JSON');
		});

		it('should detect languages from subtasks', () => {
			const task = {
				title: 'Main task',
				description: 'Main description',
				subtasks: [
					{
						title: 'Update app.js',
						description: 'Fix JavaScript code'
					},
					{
						title: 'Test python script',
						details: 'Run tests for main.py'
					}
				]
			};

			const languages = detectLanguagesFromTask(task);

			expect(languages.map((l) => l.name)).toContain('JavaScript');
			expect(languages.map((l) => l.name)).toContain('Python');
		});

		it('should handle empty or invalid tasks', () => {
			expect(detectLanguagesFromTask(null)).toEqual([]);
			expect(detectLanguagesFromTask(undefined)).toEqual([]);
			expect(detectLanguagesFromTask({})).toEqual([]);
			expect(detectLanguagesFromTask('not-an-object')).toEqual([]);
		});

		it('should handle tasks with missing content fields', () => {
			const task = {
				title: 'Task with minimal content'
			};

			const languages = detectLanguagesFromTask(task);
			expect(languages).toEqual([]);
		});
	});

	describe('getLanguageSuggestions', () => {
		it('should return suggestions for web projects', () => {
			const suggestions = getLanguageSuggestions('web');

			expect(suggestions).toContain('JavaScript');
			expect(suggestions).toContain('TypeScript');
			expect(suggestions).toContain('HTML');
			expect(suggestions).toContain('CSS');
		});

		it('should return suggestions for mobile projects', () => {
			const suggestions = getLanguageSuggestions('mobile');

			expect(suggestions).toContain('Swift');
			expect(suggestions).toContain('Kotlin');
			expect(suggestions).toContain('Java');
		});

		it('should return suggestions for backend projects', () => {
			const suggestions = getLanguageSuggestions('backend');

			expect(suggestions).toContain('JavaScript');
			expect(suggestions).toContain('Python');
			expect(suggestions).toContain('Java');
			expect(suggestions).toContain('Go');
		});

		it('should return empty array for unknown project types', () => {
			expect(getLanguageSuggestions('unknown')).toEqual([]);
			expect(getLanguageSuggestions(null)).toEqual([]);
			expect(getLanguageSuggestions(undefined)).toEqual([]);
		});

		it('should be case insensitive', () => {
			const lowerSuggestions = getLanguageSuggestions('web');
			const upperSuggestions = getLanguageSuggestions('WEB');

			expect(lowerSuggestions).toEqual(upperSuggestions);
		});
	});

	describe('isValidLanguage', () => {
		it('should validate known languages', () => {
			expect(isValidLanguage('JavaScript')).toBe(true);
			expect(isValidLanguage('Python')).toBe(true);
			expect(isValidLanguage('TypeScript')).toBe(true);
			expect(isValidLanguage('Dockerfile')).toBe(true);
		});

		it('should be case insensitive', () => {
			expect(isValidLanguage('javascript')).toBe(true);
			expect(isValidLanguage('PYTHON')).toBe(true);
			expect(isValidLanguage('TypeScript')).toBe(true);
		});

		it('should reject unknown languages', () => {
			expect(isValidLanguage('UnknownLanguage')).toBe(false);
			expect(isValidLanguage('NotALanguage')).toBe(false);
		});

		it('should handle invalid inputs', () => {
			expect(isValidLanguage(null)).toBe(false);
			expect(isValidLanguage(undefined)).toBe(false);
			expect(isValidLanguage('')).toBe(false);
			expect(isValidLanguage(123)).toBe(false);
		});
	});

	describe('getLanguageInfo', () => {
		it('should return language info for valid languages', () => {
			const jsInfo = getLanguageInfo('JavaScript');
			expect(jsInfo).toEqual({
				name: 'JavaScript',
				color: '#f1e05a'
			});

			const pyInfo = getLanguageInfo('Python');
			expect(pyInfo).toEqual({
				name: 'Python',
				color: '#3572a5'
			});
		});

		it('should be case insensitive', () => {
			const jsInfo1 = getLanguageInfo('JavaScript');
			const jsInfo2 = getLanguageInfo('javascript');
			const jsInfo3 = getLanguageInfo('JAVASCRIPT');

			expect(jsInfo1).toEqual(jsInfo2);
			expect(jsInfo2).toEqual(jsInfo3);
		});

		it('should return null for unknown languages', () => {
			expect(getLanguageInfo('UnknownLanguage')).toBeNull();
			expect(getLanguageInfo('NotReal')).toBeNull();
		});

		it('should handle invalid inputs', () => {
			expect(getLanguageInfo(null)).toBeNull();
			expect(getLanguageInfo(undefined)).toBeNull();
			expect(getLanguageInfo('')).toBeNull();
			expect(getLanguageInfo(123)).toBeNull();
		});
	});

	describe('languageToLabelKey', () => {
		it('should convert language names to label keys', () => {
			expect(languageToLabelKey('JavaScript')).toBe('javascript');
			expect(languageToLabelKey('TypeScript')).toBe('typescript');
			expect(languageToLabelKey('C++')).toBe('cpp');
			expect(languageToLabelKey('C#')).toBe('c');
		});

		it('should handle special characters', () => {
			expect(languageToLabelKey('Objective-C')).toBe('objectivec');
			expect(languageToLabelKey('.NET')).toBe('net');
		});

		it('should handle invalid inputs', () => {
			expect(languageToLabelKey(null)).toBe('');
			expect(languageToLabelKey(undefined)).toBe('');
			expect(languageToLabelKey('')).toBe('');
			expect(languageToLabelKey(123)).toBe('');
		});
	});

	describe('getAllLanguages', () => {
		it('should return all available languages', () => {
			const allLanguages = getAllLanguages();

			expect(Array.isArray(allLanguages)).toBe(true);
			expect(allLanguages.length).toBeGreaterThan(0);

			// Should include common languages
			const languageNames = allLanguages.map((l) => l.name);
			expect(languageNames).toContain('JavaScript');
			expect(languageNames).toContain('Python');
			expect(languageNames).toContain('TypeScript');
		});

		it('should not have duplicate languages', () => {
			const allLanguages = getAllLanguages();
			const languageNames = allLanguages.map((l) => l.name);
			const uniqueNames = [...new Set(languageNames)];

			expect(languageNames.length).toBe(uniqueNames.length);
		});

		it('should have consistent structure for all languages', () => {
			const allLanguages = getAllLanguages();

			allLanguages.forEach((language) => {
				expect(language).toHaveProperty('name');
				expect(language).toHaveProperty('color');
				expect(typeof language.name).toBe('string');
				expect(typeof language.color).toBe('string');
				expect(language.color).toMatch(/^#[0-9a-f]{6}$/i);
			});
		});
	});

	describe('LANGUAGE_FAMILIES', () => {
		it('should group related languages correctly', () => {
			expect(LANGUAGE_FAMILIES.javascript).toContain('JavaScript');
			expect(LANGUAGE_FAMILIES.javascript).toContain('TypeScript');

			expect(LANGUAGE_FAMILIES.web).toContain('HTML');
			expect(LANGUAGE_FAMILIES.web).toContain('CSS');

			expect(LANGUAGE_FAMILIES.systems).toContain('C');
			expect(LANGUAGE_FAMILIES.systems).toContain('C++');
			expect(LANGUAGE_FAMILIES.systems).toContain('Rust');
		});

		it('should have arrays as values', () => {
			Object.values(LANGUAGE_FAMILIES).forEach((family) => {
				expect(Array.isArray(family)).toBe(true);
				expect(family.length).toBeGreaterThan(0);
			});
		});
	});
});
