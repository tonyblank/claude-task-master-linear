/**
 * @fileoverview Language Detection Module
 *
 * Lightweight language detection based on file extensions and patterns.
 * Follows GitHub Linguist conventions for maximum compatibility and
 * developer familiarity.
 */

/**
 * File extension to language mapping based on GitHub Linguist
 * Colors match GitHub's language colors for consistency
 */
export const LANGUAGE_MAPPINGS = {
	// JavaScript ecosystem
	'.js': { name: 'JavaScript', color: '#f1e05a' },
	'.mjs': { name: 'JavaScript', color: '#f1e05a' },
	'.jsx': { name: 'JavaScript', color: '#f1e05a' },
	'.ts': { name: 'TypeScript', color: '#2b7489' },
	'.tsx': { name: 'TypeScript', color: '#2b7489' },
	'.vue': { name: 'Vue', color: '#4fc08d' },
	'.svelte': { name: 'Svelte', color: '#ff3e00' },

	// Python
	'.py': { name: 'Python', color: '#3572a5' },
	'.pyw': { name: 'Python', color: '#3572a5' },
	'.pyi': { name: 'Python', color: '#3572a5' },

	// Java ecosystem
	'.java': { name: 'Java', color: '#b07219' },
	'.kt': { name: 'Kotlin', color: '#f18e33' },
	'.kts': { name: 'Kotlin', color: '#f18e33' },
	'.scala': { name: 'Scala', color: '#c22d40' },
	'.groovy': { name: 'Groovy', color: '#e69f56' },

	// C family
	'.c': { name: 'C', color: '#555555' },
	'.h': { name: 'C', color: '#555555' },
	'.cpp': { name: 'C++', color: '#f34b7d' },
	'.cc': { name: 'C++', color: '#f34b7d' },
	'.cxx': { name: 'C++', color: '#f34b7d' },
	'.hpp': { name: 'C++', color: '#f34b7d' },
	'.cs': { name: 'C#', color: '#239120' },

	// Web languages
	'.html': { name: 'HTML', color: '#e34c26' },
	'.htm': { name: 'HTML', color: '#e34c26' },
	'.css': { name: 'CSS', color: '#1572b6' },
	'.scss': { name: 'SCSS', color: '#c6538c' },
	'.sass': { name: 'Sass', color: '#a53b70' },
	'.less': { name: 'Less', color: '#1d365d' },

	// Mobile
	'.swift': { name: 'Swift', color: '#ffac45' },
	'.m': { name: 'Objective-C', color: '#438eff' },
	'.mm': { name: 'Objective-C++', color: '#6866fb' },
	'.dart': { name: 'Dart', color: '#00b4ab' },

	// Systems languages
	'.rs': { name: 'Rust', color: '#dea584' },
	'.go': { name: 'Go', color: '#00add8' },
	'.zig': { name: 'Zig', color: '#ec915c' },

	// Scripting
	'.php': { name: 'PHP', color: '#4f5d95' },
	'.rb': { name: 'Ruby', color: '#701516' },
	'.pl': { name: 'Perl', color: '#0298c3' },
	'.lua': { name: 'Lua', color: '#000080' },

	// Shell
	'.sh': { name: 'Shell', color: '#89e051' },
	'.bash': { name: 'Shell', color: '#89e051' },
	'.zsh': { name: 'Shell', color: '#89e051' },
	'.fish': { name: 'Shell', color: '#89e051' },
	'.ps1': { name: 'PowerShell', color: '#012456' },

	// Database
	'.sql': { name: 'SQL', color: '#336791' },

	// Data/Config
	'.json': { name: 'JSON', color: '#292929' },
	'.yaml': { name: 'YAML', color: '#cb171e' },
	'.yml': { name: 'YAML', color: '#cb171e' },
	'.toml': { name: 'TOML', color: '#9c4221' },
	'.xml': { name: 'XML', color: '#0060ac' },

	// Documentation
	'.md': { name: 'Markdown', color: '#083fa1' },
	'.rst': { name: 'reStructuredText', color: '#141414' },
	'.tex': { name: 'TeX', color: '#3d6117' },

	// Build/Config files
	'.dockerfile': { name: 'Dockerfile', color: '#384d54' },
	'.makefile': { name: 'Makefile', color: '#427819' },
	'.cmake': { name: 'CMake', color: '#da3434' },

	// Other popular languages
	'.r': { name: 'R', color: '#198ce7' },
	'.matlab': { name: 'MATLAB', color: '#e16737' },
	'.jl': { name: 'Julia', color: '#a270ba' },
	'.ex': { name: 'Elixir', color: '#6e4a7e' },
	'.exs': { name: 'Elixir', color: '#6e4a7e' },
	'.erl': { name: 'Erlang', color: '#b83998' },
	'.hrl': { name: 'Erlang', color: '#b83998' }
};

/**
 * Special filename patterns that override extension-based detection
 */
export const FILENAME_PATTERNS = {
	dockerfile: { name: 'Dockerfile', color: '#384d54' },
	makefile: { name: 'Makefile', color: '#427819' },
	rakefile: { name: 'Ruby', color: '#701516' },
	gemfile: { name: 'Ruby', color: '#701516' },
	podfile: { name: 'Ruby', color: '#701516' },
	'package.json': { name: 'JSON', color: '#292929' },
	'composer.json': { name: 'JSON', color: '#292929' },
	'tsconfig.json': { name: 'JSON', color: '#292929' },
	'.gitignore': { name: 'Ignore List', color: '#f14c28' },
	'.eslintrc': { name: 'JSON', color: '#292929' },
	'.babelrc': { name: 'JSON', color: '#292929' }
};

/**
 * Language families for grouping related languages
 */
export const LANGUAGE_FAMILIES = {
	javascript: ['JavaScript', 'TypeScript', 'Vue', 'Svelte'],
	web: ['HTML', 'CSS', 'SCSS', 'Sass', 'Less'],
	systems: ['C', 'C++', 'Rust', 'Go', 'Zig'],
	mobile: ['Swift', 'Objective-C', 'Objective-C++', 'Dart', 'Kotlin', 'Java'],
	scripting: ['Python', 'Ruby', 'PHP', 'Perl', 'Lua', 'Shell', 'PowerShell'],
	functional: ['Elixir', 'Erlang', 'Haskell', 'F#'],
	data: ['R', 'MATLAB', 'Julia', 'SQL']
};

/**
 * Detect programming language from file path
 *
 * @param {string} filePath - File path or filename
 * @returns {Object|null} Language object with name and color, or null if not detected
 */
export function detectLanguageFromPath(filePath) {
	if (!filePath || typeof filePath !== 'string') {
		return null;
	}

	const normalizedPath = filePath.toLowerCase().trim();
	const filename = normalizedPath.split('/').pop() || normalizedPath;

	// Check special filename patterns first
	for (const [pattern, language] of Object.entries(FILENAME_PATTERNS)) {
		if (filename === pattern || filename.endsWith(pattern)) {
			return { ...language };
		}
	}

	// Check file extension
	const lastDotIndex = filename.lastIndexOf('.');
	if (lastDotIndex === -1) {
		return null; // No extension
	}

	const extension = filename.substring(lastDotIndex);
	const language = LANGUAGE_MAPPINGS[extension];

	return language ? { ...language } : null;
}

/**
 * Detect languages from multiple file paths
 *
 * @param {string[]} filePaths - Array of file paths
 * @returns {Object[]} Array of unique language objects
 */
export function detectLanguagesFromPaths(filePaths) {
	if (!Array.isArray(filePaths)) {
		return [];
	}

	const languageMap = new Map();

	for (const filePath of filePaths) {
		const language = detectLanguageFromPath(filePath);
		if (language) {
			languageMap.set(language.name, language);
		}
	}

	return Array.from(languageMap.values());
}

/**
 * Extract file paths from task content (description, details, etc.)
 *
 * @param {string} content - Task content to analyze
 * @returns {string[]} Array of file paths found in content
 */
export function extractFilePathsFromContent(content) {
	if (!content || typeof content !== 'string') {
		return [];
	}

	// Regex patterns to match file paths
	const patterns = [
		// Standard file paths with extensions
		/(?:^|\s)([^\s]+\.[a-zA-Z0-9]+)(?:\s|$)/g,
		// Relative paths starting with ./
		/(?:^|\s)(\.[\/\\][^\s]+)(?:\s|$)/g,
		// Absolute paths starting with /
		/(?:^|\s)(\/[^\s]+)(?:\s|$)/g,
		// Windows paths
		/(?:^|\s)([A-Za-z]:[\/\\][^\s]+)(?:\s|$)/g,
		// Common filename patterns without paths
		/(?:^|\s)((?:dockerfile|makefile|rakefile|gemfile|podfile)(?:\.[a-zA-Z0-9]+)?)(?:\s|$)/gi
	];

	const filePaths = new Set();

	for (const pattern of patterns) {
		let match = pattern.exec(content);
		while (match !== null) {
			const path = match[1].trim();
			if (path && path.length > 1) {
				filePaths.add(path);
			}
			match = pattern.exec(content);
		}
	}

	return Array.from(filePaths);
}

/**
 * Detect languages from task content by analyzing file references
 *
 * @param {Object} task - Task object with description, details, etc.
 * @returns {Object[]} Array of detected language objects
 */
export function detectLanguagesFromTask(task) {
	if (!task || typeof task !== 'object') {
		return [];
	}

	const content = [
		task.description || '',
		task.details || '',
		task.title || '',
		...(task.subtasks || []).map(
			(subtask) =>
				`${subtask.title} ${subtask.description || ''} ${subtask.details || ''}`
		)
	].join(' ');

	const filePaths = extractFilePathsFromContent(content);
	return detectLanguagesFromPaths(filePaths);
}

/**
 * Get language suggestions based on common project types
 *
 * @param {string} projectType - Type of project (web, mobile, backend, etc.)
 * @returns {string[]} Array of suggested language names
 */
export function getLanguageSuggestions(projectType) {
	const suggestions = {
		web: ['JavaScript', 'TypeScript', 'HTML', 'CSS', 'SCSS'],
		mobile: ['Swift', 'Kotlin', 'Java', 'Dart', 'Objective-C'],
		backend: ['JavaScript', 'TypeScript', 'Python', 'Java', 'Go', 'Rust'],
		frontend: ['JavaScript', 'TypeScript', 'Vue', 'React', 'HTML', 'CSS'],
		api: ['JavaScript', 'TypeScript', 'Python', 'Go', 'Java', 'C#'],
		data: ['Python', 'R', 'SQL', 'Julia', 'MATLAB'],
		devops: ['Shell', 'Python', 'Go', 'YAML', 'Dockerfile'],
		desktop: ['C++', 'C#', 'Java', 'Python', 'Rust', 'Swift'],
		game: ['C++', 'C#', 'JavaScript', 'Lua', 'Python'],
		embedded: ['C', 'C++', 'Rust', 'Assembly']
	};

	return suggestions[projectType?.toLowerCase()] || [];
}

/**
 * Validate language name against known languages
 *
 * @param {string} languageName - Language name to validate
 * @returns {boolean} True if language is recognized
 */
export function isValidLanguage(languageName) {
	if (!languageName || typeof languageName !== 'string') {
		return false;
	}

	const normalizedName = languageName.toLowerCase();
	const allLanguages = new Set();

	// Add all languages from mappings
	Object.values(LANGUAGE_MAPPINGS).forEach((lang) => {
		allLanguages.add(lang.name.toLowerCase());
	});

	// Add languages from filename patterns
	Object.values(FILENAME_PATTERNS).forEach((lang) => {
		allLanguages.add(lang.name.toLowerCase());
	});

	return allLanguages.has(normalizedName);
}

/**
 * Get language info by name
 *
 * @param {string} languageName - Language name
 * @returns {Object|null} Language object with name and color, or null if not found
 */
export function getLanguageInfo(languageName) {
	if (!languageName || typeof languageName !== 'string') {
		return null;
	}

	const normalizedName = languageName.toLowerCase();

	// Search in extension mappings
	for (const language of Object.values(LANGUAGE_MAPPINGS)) {
		if (language.name.toLowerCase() === normalizedName) {
			return { ...language };
		}
	}

	// Search in filename patterns
	for (const language of Object.values(FILENAME_PATTERNS)) {
		if (language.name.toLowerCase() === normalizedName) {
			return { ...language };
		}
	}

	return null;
}

/**
 * Convert language name to label-friendly format
 *
 * @param {string} languageName - Language name
 * @returns {string} Label-friendly name (lowercase, no special chars)
 */
export function languageToLabelKey(languageName) {
	if (!languageName || typeof languageName !== 'string') {
		return '';
	}

	return languageName
		.toLowerCase()
		.replace(/c\+\+/g, 'cpp') // Handle C++ -> cpp
		.replace(/\+/g, 'plus') // Handle other + cases
		.replace(/[^a-z0-9]/g, '');
}

/**
 * Get all available languages as array
 *
 * @returns {Object[]} Array of all language objects
 */
export function getAllLanguages() {
	const languages = new Map();

	// Add from extension mappings
	Object.values(LANGUAGE_MAPPINGS).forEach((lang) => {
		languages.set(lang.name, lang);
	});

	// Add from filename patterns (avoid duplicates)
	Object.values(FILENAME_PATTERNS).forEach((lang) => {
		if (!languages.has(lang.name)) {
			languages.set(lang.name, lang);
		}
	});

	return Array.from(languages.values());
}
