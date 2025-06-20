/**
 * Error message formatting and user-friendly output utilities
 */

import chalk from 'chalk';

/**
 * Format a section of issues (errors, warnings, or suggestions)
 * @param {Array} issues - Array of issues to format
 * @param {string} sectionTitle - Title for the section
 * @param {string} issueType - Type of issue (error, warning, suggestion)
 * @param {boolean} colorize - Whether to apply colors
 * @param {boolean} detailed - Whether to include detailed info
 * @param {number} maxItems - Maximum items to show for errors
 * @returns {Array} Array of formatted lines
 */
function formatIssueSection(
	issues,
	sectionTitle,
	issueType,
	colorize,
	detailed,
	maxItems = null
) {
	if (!issues?.length) return [];

	const output = [];
	const colorMap = {
		error: chalk.red.bold,
		warning: chalk.yellow.bold,
		suggestion: chalk.blue.bold
	};

	const titleColor = colorize ? colorMap[issueType] : (text) => text;
	output.push(titleColor(sectionTitle));

	const itemsToShow = maxItems ? issues.slice(0, maxItems) : issues;

	itemsToShow.forEach((issue, index) => {
		const formatted = formatSingleIssue(issue, issueType, colorize, detailed);
		output.push(`  ${index + 1}. ${formatted}`);
	});

	if (maxItems && issues.length > maxItems) {
		const remaining = issues.length - maxItems;
		output.push(`  ... and ${remaining} more ${issueType}(s)`);
	}

	output.push(''); // Empty line
	return output;
}

/**
 * Formats validation errors into user-friendly messages
 * @param {ValidationResult} result - Validation result to format
 * @param {object} options - Formatting options
 * @returns {string} Formatted error message
 */
export function formatValidationErrors(result, options = {}) {
	const {
		includeWarnings = true,
		includeSuggestions = false,
		colorize = true,
		detailed = false,
		maxErrors = 10
	} = options;

	if (
		!result ||
		(!result.errors?.length &&
			!result.warnings?.length &&
			!result.suggestions?.length)
	) {
		return colorize
			? chalk.green('✓ Configuration validation passed')
			: '✓ Configuration validation passed';
	}

	const output = [];

	// Add header
	if (result.errors?.length > 0) {
		const header = `❌ Configuration validation failed with ${result.errors.length} error(s)`;
		output.push(colorize ? chalk.red(header) : header);
	} else {
		const header = '⚠️ Configuration validation passed with warnings';
		output.push(colorize ? chalk.yellow(header) : header);
	}

	output.push(''); // Empty line

	// Format sections using helper function
	if (result.errors?.length > 0) {
		output.push(
			...formatIssueSection(
				result.errors,
				'ERRORS:',
				'error',
				colorize,
				detailed,
				maxErrors
			)
		);
	}

	if (includeWarnings && result.warnings?.length > 0) {
		output.push(
			...formatIssueSection(
				result.warnings,
				'WARNINGS:',
				'warning',
				colorize,
				detailed
			)
		);
	}

	if (includeSuggestions && result.suggestions?.length > 0) {
		output.push(
			...formatIssueSection(
				result.suggestions,
				'SUGGESTIONS:',
				'suggestion',
				colorize,
				detailed
			)
		);
	}

	// Add footer with guidance
	if (result.errors?.length > 0) {
		output.push(
			colorize
				? chalk.red('Please fix the above errors before proceeding.')
				: 'Please fix the above errors before proceeding.'
		);
		output.push('');
		output.push('For help with configuration, run: task-master models --setup');
		output.push('Or visit: https://docs.taskmaster.ai/configuration');
	}

	return output.join('\n');
}

/**
 * Formats validation warnings in a user-friendly way
 * @param {ValidationResult} result - Validation result
 * @param {object} options - Formatting options
 * @returns {string} Formatted warning message
 */
export function formatValidationWarnings(result, options = {}) {
	const { colorize = true, detailed = false } = options;

	if (!result?.warnings?.length) {
		return '';
	}

	const output = [];
	const header = `⚠️ Found ${result.warnings.length} configuration warning(s)`;
	output.push(colorize ? chalk.yellow(header) : header);
	output.push('');

	result.warnings.forEach((warning, index) => {
		const formatted = formatSingleIssue(warning, 'warning', colorize, detailed);
		output.push(`  ${index + 1}. ${formatted}`);
	});

	return output.join('\n');
}

/**
 * Creates detailed error message with context and suggestions
 * @param {object} error - Error object
 * @param {object} context - Additional context
 * @returns {string} Detailed error message
 */
export function createDetailedErrorMessage(error, context = {}) {
	const { field, message, code } = error;
	const { configPath, section, suggestion } = context;

	const parts = [];

	// Main error message
	parts.push(`Error: ${message}`);

	// Field context
	if (field) {
		parts.push(`Field: ${field}`);
	}

	// Configuration location
	if (configPath) {
		parts.push(`Location: ${configPath}`);
	}

	// Section context
	if (section) {
		parts.push(`Section: ${section}`);
	}

	// Error code
	if (code) {
		parts.push(`Code: ${code}`);
	}

	// Suggestion for fixing
	if (suggestion) {
		parts.push(`Suggestion: ${suggestion}`);
	} else {
		// Provide default suggestions based on error code
		const defaultSuggestion = getDefaultSuggestion(code, field);
		if (defaultSuggestion) {
			parts.push(`Suggestion: ${defaultSuggestion}`);
		}
	}

	return parts.join('\n');
}

/**
 * Formats a single validation issue
 * @param {object} issue - Issue object
 * @param {string} type - Issue type (error, warning, suggestion)
 * @param {boolean} colorize - Whether to apply colors
 * @param {boolean} detailed - Whether to include detailed information
 * @returns {string} Formatted issue
 */
function formatSingleIssue(issue, type, colorize, detailed) {
	const { field, message, code } = issue;

	let formatted = message;

	// Add field information
	if (field) {
		const fieldInfo = `[${field}]`;
		formatted = colorize
			? `${chalk.cyan(fieldInfo)} ${formatted}`
			: `${fieldInfo} ${formatted}`;
	}

	// Add code information in detailed mode
	if (detailed && code) {
		const codeInfo = `(${code})`;
		formatted = colorize
			? `${formatted} ${chalk.gray(codeInfo)}`
			: `${formatted} ${codeInfo}`;
	}

	// Add helpful tips based on error code
	const tip = getErrorTip(code, field);
	if (tip) {
		formatted += colorize
			? `\n    ${chalk.dim('💡 ' + tip)}`
			: `\n    💡 ${tip}`;
	}

	return formatted;
}

/**
 * Gets helpful tip based on error code and field
 * @param {string} code - Error code
 * @param {string} field - Field name
 * @returns {string|null} Helpful tip or null
 */
function getErrorTip(code, field) {
	const tips = {
		MISSING_API_KEY:
			'Set the API key in your .env file or environment variables',
		INVALID_API_KEY_FORMAT:
			'Check the API key format - it may be incomplete or corrupted',
		INVALID_PROVIDER:
			'Use one of the supported providers: anthropic, openai, google, perplexity, etc.',
		MISSING_TEAM_ID:
			'Get your Linear team ID from your Linear workspace settings',
		MISSING_PROJECT_ID:
			'Find your Linear project ID in the project settings page',
		INVALID_UUID:
			'UUIDs should be in format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
		INVALID_URL:
			'URLs must include protocol (http:// or https://) and valid domain',
		HARDCODED_SECRET:
			'Use environment variable placeholders like ${API_KEY_NAME}',
		LARGE_BATCH_SIZE: 'Smaller batch sizes prevent API rate limiting',
		HIGH_RETRY_ATTEMPTS: 'Too many retries can cause performance issues',
		LOW_RETRY_DELAY: 'Increase delay to avoid hitting API rate limits',
		INVALID_TEMPERATURE:
			'Temperature controls randomness: 0 = deterministic, 1 = balanced, 2 = creative',
		MAX_TOKENS_RANGE: 'Typical range is 1000-64000 for most models'
	};

	if (tips[code]) {
		return tips[code];
	}

	// Field-specific tips
	if (field?.includes('apiKey')) {
		return 'Store API keys in environment variables, not in config files';
	}
	if (field?.includes('url') || field?.includes('URL')) {
		return 'Ensure the URL is accessible and uses HTTPS for security';
	}
	if (field?.includes('linear')) {
		return 'Linear configuration requires a valid API key and workspace setup';
	}

	return null;
}

/**
 * Gets default suggestion based on error code and field
 * @param {string} code - Error code
 * @param {string} field - Field name
 * @returns {string|null} Default suggestion or null
 */
function getDefaultSuggestion(code, field) {
	const suggestions = {
		MISSING_API_KEY: 'Add the required API key to your .env file',
		INVALID_PROVIDER:
			'Check the list of supported providers in the documentation',
		MISSING_TEAM_ID: 'Configure Linear team ID in your settings',
		MISSING_PROJECT_ID: 'Configure Linear project ID in your settings',
		HARDCODED_SECRET: 'Replace with environment variable placeholder',
		INVALID_URL: 'Verify the URL format and accessibility',
		SCHEMA_VALIDATION: 'Check the configuration schema documentation',
		INVALID_TEMPERATURE: 'Set temperature between 0.0 and 2.0',
		MAX_TOKENS_RANGE: 'Use a value between 1000 and 64000'
	};

	return suggestions[code] || null;
}

/**
 * Formats configuration summary for display
 * @param {object} config - Configuration object
 * @param {object} options - Formatting options
 * @returns {string} Formatted configuration summary
 */
export function formatConfigSummary(config, options = {}) {
	const { colorize = true, showSensitive = false } = options;

	if (!config) {
		return colorize
			? chalk.red('No configuration found')
			: 'No configuration found';
	}

	const output = [];

	// Header
	output.push(
		colorize
			? chalk.bold('📋 Configuration Summary')
			: '📋 Configuration Summary'
	);
	output.push(''.padEnd(50, '='));
	output.push('');

	// Models section
	if (config.models) {
		output.push(colorize ? chalk.blue.bold('🤖 AI Models:') : '🤖 AI Models:');
		['main', 'research', 'fallback'].forEach((role) => {
			const model = config.models[role];
			if (model?.provider && model?.modelId) {
				const status = colorize ? chalk.green('✓') : '✓';
				output.push(`  ${status} ${role}: ${model.provider}/${model.modelId}`);
			} else {
				const status = colorize ? chalk.yellow('⚠') : '⚠';
				output.push(`  ${status} ${role}: Not configured`);
			}
		});
		output.push('');
	}

	// Linear integration section
	if (config.integrations?.linear) {
		const linear = config.integrations.linear;
		output.push(
			colorize
				? chalk.purple.bold('🔗 Linear Integration:')
				: '🔗 Linear Integration:'
		);

		const enabled = linear.enabled;
		const enabledStatus = enabled
			? colorize
				? chalk.green('✓ Enabled')
				: '✓ Enabled'
			: colorize
				? chalk.gray('✗ Disabled')
				: '✗ Disabled';
		output.push(`  Status: ${enabledStatus}`);

		if (enabled) {
			const hasApiKey = linear.apiKey && !linear.apiKey.includes('KEY_HERE');
			const keyStatus = hasApiKey
				? colorize
					? chalk.green('✓ Configured')
					: '✓ Configured'
				: colorize
					? chalk.red('✗ Missing')
					: '✗ Missing';
			output.push(`  API Key: ${keyStatus}`);

			const hasTeam = linear.team?.id;
			const teamStatus = hasTeam
				? colorize
					? chalk.green('✓ Configured')
					: '✓ Configured'
				: colorize
					? chalk.yellow('⚠ Missing')
					: '⚠ Missing';
			output.push(`  Team: ${teamStatus}`);

			const hasProject = linear.project?.id;
			const projectStatus = hasProject
				? colorize
					? chalk.green('✓ Configured')
					: '✓ Configured'
				: colorize
					? chalk.yellow('⚠ Missing')
					: '⚠ Missing';
			output.push(`  Project: ${projectStatus}`);
		}
		output.push('');
	}

	// Global settings section
	if (config.global) {
		const global = config.global;
		output.push(
			colorize ? chalk.cyan.bold('⚙️ Global Settings:') : '⚙️ Global Settings:'
		);
		output.push(`  Log Level: ${global.logLevel || 'info'}`);
		output.push(`  Debug Mode: ${global.debug ? 'enabled' : 'disabled'}`);
		output.push(`  Project: ${global.projectName || 'Task Master'}`);
		output.push(`  Default Priority: ${global.defaultPriority || 'medium'}`);
		output.push('');
	}

	return output.join('\n');
}

/**
 * Formats validation result as JSON for programmatic use
 * @param {ValidationResult} result - Validation result
 * @returns {string} JSON formatted result
 */
export function formatAsJson(result) {
	return JSON.stringify(
		{
			valid: result.valid,
			errors: result.errors,
			warnings: result.warnings,
			suggestions: result.suggestions,
			summary: {
				errorCount: result.errors?.length || 0,
				warningCount: result.warnings?.length || 0,
				suggestionCount: result.suggestions?.length || 0
			}
		},
		null,
		2
	);
}

/**
 * Formats validation result for CI/CD systems
 * @param {ValidationResult} result - Validation result
 * @returns {string} CI-friendly format
 */
export function formatForCI(result) {
	const output = [];

	// Add machine-readable status
	output.push(`VALIDATION_STATUS=${result.valid ? 'PASS' : 'FAIL'}`);
	output.push(`ERROR_COUNT=${result.errors?.length || 0}`);
	output.push(`WARNING_COUNT=${result.warnings?.length || 0}`);
	output.push('');

	// Add human-readable summary
	if (result.valid) {
		output.push('✅ Configuration validation PASSED');
	} else {
		output.push('❌ Configuration validation FAILED');
		if (result.errors?.length > 0) {
			output.push('');
			output.push('Errors:');
			result.errors.forEach((error, index) => {
				output.push(
					`  ${index + 1}. [${error.field || 'config'}] ${error.message}`
				);
			});
		}
	}

	if (result.warnings?.length > 0) {
		output.push('');
		output.push('Warnings:');
		result.warnings.forEach((warning, index) => {
			output.push(
				`  ${index + 1}. [${warning.field || 'config'}] ${warning.message}`
			);
		});
	}

	return output.join('\n');
}
