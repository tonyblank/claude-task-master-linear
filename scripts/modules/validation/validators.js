/**
 * Core validation functions for TaskMaster configuration
 */

import { z } from 'zod';
import { log } from '../utils.js';
import { resolveEnvVariable } from '../utils.js';
import {
	validateLinearApiKey as _validateLinearApiKey,
	validateLinearTeamId as _validateLinearTeamId,
	validateLinearProjectId as _validateLinearProjectId,
	validateProvider as _validateProvider
} from '../config-manager.js';
import {
	LINEAR_CONFIG_SCHEMA,
	GLOBAL_CONFIG_SCHEMA,
	MODELS_CONFIG_SCHEMA,
	FULL_CONFIG_SCHEMA
} from './schemas.js';
import { formatValidationErrors } from './formatters.js';

/**
 * Custom error class for validation errors
 */
export class ValidationError extends Error {
	constructor(message, field = null, code = null) {
		super(message);
		this.name = 'ValidationError';
		this.field = field;
		this.code = code;
	}
}

/**
 * Custom error class for configuration errors
 */
export class ConfigurationError extends Error {
	constructor(message, errors = []) {
		super(message);
		this.name = 'ConfigurationError';
		this.errors = errors;
	}
}

/**
 * Structured validation result class
 */
export class ValidationResult {
	constructor() {
		this.valid = true;
		this.errors = [];
		this.warnings = [];
		this.suggestions = [];
	}

	addError(field, message, code = null) {
		this.valid = false;
		this.errors.push({ field, message, code, level: 'error' });
		return this;
	}

	addWarning(field, message, code = null) {
		this.warnings.push({ field, message, code, level: 'warning' });
		return this;
	}

	addSuggestion(field, message, code = null) {
		this.suggestions.push({ field, message, code, level: 'suggestion' });
		return this;
	}

	/**
	 * Merges another ValidationResult into this one
	 */
	merge(other) {
		if (!other.valid) {
			this.valid = false;
		}
		this.errors.push(...other.errors);
		this.warnings.push(...other.warnings);
		this.suggestions.push(...other.suggestions);
		return this;
	}

	/**
	 * Gets all issues (errors, warnings, suggestions) as a flat array
	 */
	getAllIssues() {
		return [...this.errors, ...this.warnings, ...this.suggestions];
	}

	/**
	 * Checks if there are any issues at all
	 */
	hasAnyIssues() {
		return (
			this.errors.length > 0 ||
			this.warnings.length > 0 ||
			this.suggestions.length > 0
		);
	}
}

/**
 * Validates the complete configuration object
 * @param {object} config - The configuration object to validate
 * @param {object} options - Validation options
 * @param {string} options.projectRoot - Project root for environment variable resolution
 * @param {boolean} options.strict - Whether to use strict validation
 * @param {boolean} options.checkEnvironment - Whether to validate environment variables
 * @param {boolean} options.checkSecurity - Whether to validate security constraints
 * @returns {ValidationResult} Validation result
 */
export function validateConfig(config, options = {}) {
	const {
		projectRoot = null,
		strict = false,
		checkEnvironment = true,
		checkSecurity = true
	} = options;

	const result = new ValidationResult();

	// Basic structure validation
	if (!config || typeof config !== 'object') {
		result.addError(
			null,
			'Configuration must be a valid object',
			'CONFIG_INVALID_TYPE'
		);
		return result;
	}

	try {
		// Schema validation using Zod
		const schemaResult = validateWithSchema(config, strict);
		result.merge(schemaResult);

		// Business rule validation
		const businessResult = validateBusinessRules(config, {
			projectRoot,
			strict
		});
		result.merge(businessResult);

		// Environment validation
		if (checkEnvironment) {
			const envResult = validateEnvironmentSetup(config, projectRoot);
			result.merge(envResult);
		}

		// Configuration consistency validation
		const consistencyResult = validateConfigConsistency(config);
		result.merge(consistencyResult);

		// Performance and security validation
		if (checkSecurity) {
			const securityResult = validateSecurityConstraints(config);
			result.merge(securityResult);
		}
	} catch (error) {
		result.addError(
			null,
			`Validation error: ${error.message}`,
			'VALIDATION_EXCEPTION'
		);
		log('error', `Configuration validation failed: ${error.message}`);
	}

	return result;
}

/**
 * Validates configuration using Zod schemas
 * @param {object} config - Configuration to validate
 * @param {boolean} strict - Whether to use strict validation
 * @returns {ValidationResult} Validation result
 */
function validateWithSchema(config, strict = false) {
	const result = new ValidationResult();

	try {
		// Choose schema based on strict mode
		const schema = strict ? FULL_CONFIG_SCHEMA.strict() : FULL_CONFIG_SCHEMA;

		// Validate with Zod
		const validation = schema.safeParse(config);

		if (!validation.success) {
			validation.error.errors.forEach((error) => {
				const field = error.path.join('.');
				result.addError(field, error.message, 'SCHEMA_VALIDATION');
			});
		}
	} catch (error) {
		result.addError(
			null,
			`Schema validation failed: ${error.message}`,
			'SCHEMA_ERROR'
		);
	}

	return result;
}

/**
 * Validates business rules and logic constraints
 * @param {object} config - Configuration to validate
 * @param {object} options - Validation options
 * @returns {ValidationResult} Validation result
 */
function validateBusinessRules(config, options = {}) {
	const { projectRoot, strict } = options;
	const result = new ValidationResult();

	// Validate provider configurations
	if (config.models) {
		['main', 'research', 'fallback'].forEach((role) => {
			const roleConfig = config.models[role];
			if (roleConfig?.provider && !_validateProvider(roleConfig.provider)) {
				result.addError(
					`models.${role}.provider`,
					`Invalid provider "${roleConfig.provider}"`,
					'INVALID_PROVIDER'
				);
			}

			// Validate model parameters
			if (roleConfig?.maxTokens) {
				if (roleConfig.maxTokens < 1 || roleConfig.maxTokens > 200000) {
					result.addWarning(
						`models.${role}.maxTokens`,
						`Max tokens value ${roleConfig.maxTokens} may be outside typical range (1-200000)`,
						'MAX_TOKENS_RANGE'
					);
				}
			}

			if (roleConfig?.temperature) {
				if (roleConfig.temperature < 0 || roleConfig.temperature > 2) {
					result.addError(
						`models.${role}.temperature`,
						`Temperature must be between 0 and 2, got ${roleConfig.temperature}`,
						'INVALID_TEMPERATURE'
					);
				}
			}
		});
	}

	// Validate Linear configuration business rules
	if (config.integrations?.linear) {
		const linearResult = validateLinearBusinessRules(
			config.integrations.linear,
			projectRoot
		);
		result.merge(linearResult);
	}

	// Validate global configuration business rules
	if (config.global) {
		const globalResult = validateGlobalBusinessRules(config.global);
		result.merge(globalResult);
	}

	return result;
}

/**
 * Validates Linear-specific business rules
 * @param {object} linearConfig - Linear configuration
 * @param {string} projectRoot - Project root directory
 * @returns {ValidationResult} Validation result
 */
function validateLinearBusinessRules(linearConfig, projectRoot) {
	const result = new ValidationResult();

	// If Linear is enabled, validate required fields
	if (linearConfig.enabled) {
		// Validate API key
		const apiKey = resolveApiKey(linearConfig.apiKey, projectRoot);
		if (!apiKey) {
			result.addError(
				'integrations.linear.apiKey',
				'Linear API key is required when Linear integration is enabled',
				'MISSING_API_KEY'
			);
		} else if (!_validateLinearApiKey(apiKey)) {
			result.addError(
				'integrations.linear.apiKey',
				'Linear API key format is invalid. Must start with "lin_api_" and be at least 40 characters',
				'INVALID_API_KEY_FORMAT'
			);
		}

		// Validate team configuration
		if (!linearConfig.team?.id) {
			result.addWarning(
				'integrations.linear.team.id',
				'Linear team ID is not configured. Some features may not work correctly',
				'MISSING_TEAM_ID'
			);
		} else if (!_validateLinearTeamId(linearConfig.team.id)) {
			result.addError(
				'integrations.linear.team.id',
				'Linear team ID must be a valid UUID format',
				'INVALID_TEAM_ID'
			);
		}

		// Validate project configuration
		if (!linearConfig.project?.id) {
			result.addWarning(
				'integrations.linear.project.id',
				'Linear project ID is not configured. Task synchronization may be limited',
				'MISSING_PROJECT_ID'
			);
		} else if (!_validateLinearProjectId(linearConfig.project.id)) {
			result.addError(
				'integrations.linear.project.id',
				'Linear project ID must be a valid UUID format',
				'INVALID_PROJECT_ID'
			);
		}

		// Validate sync settings
		if (linearConfig.sync) {
			const { batchSize, retryAttempts, retryDelay } = linearConfig.sync;

			if (batchSize && batchSize > 25) {
				result.addWarning(
					'integrations.linear.sync.batchSize',
					`Large batch size (${batchSize}) may hit Linear API rate limits. Consider using 10-25`,
					'LARGE_BATCH_SIZE'
				);
			}

			if (retryAttempts && retryAttempts > 5) {
				result.addSuggestion(
					'integrations.linear.sync.retryAttempts',
					`High retry attempts (${retryAttempts}) may cause delays. Consider 3-5 for better performance`,
					'HIGH_RETRY_ATTEMPTS'
				);
			}

			if (retryDelay && retryDelay < 500) {
				result.addWarning(
					'integrations.linear.sync.retryDelay',
					`Low retry delay (${retryDelay}ms) may trigger rate limiting. Consider 500-2000ms`,
					'LOW_RETRY_DELAY'
				);
			}
		}

		// Validate status mappings
		if (linearConfig.labels?.statusMapping) {
			const requiredStatuses = ['pending', 'in-progress', 'done'];
			for (const status of requiredStatuses) {
				if (!linearConfig.labels.statusMapping[status]) {
					result.addWarning(
						`integrations.linear.labels.statusMapping.${status}`,
						`Missing status mapping for "${status}". This may cause sync issues`,
						'MISSING_STATUS_MAPPING'
					);
				}
			}
		}
	}

	return result;
}

/**
 * Validates global configuration business rules
 * @param {object} globalConfig - Global configuration
 * @returns {ValidationResult} Validation result
 */
function validateGlobalBusinessRules(globalConfig) {
	const result = new ValidationResult();

	// Validate log level
	const validLogLevels = ['debug', 'info', 'warn', 'error'];
	if (
		globalConfig.logLevel &&
		!validLogLevels.includes(globalConfig.logLevel.toLowerCase())
	) {
		result.addError(
			'global.logLevel',
			`Invalid log level "${globalConfig.logLevel}". Must be one of: ${validLogLevels.join(', ')}`,
			'INVALID_LOG_LEVEL'
		);
	}

	// Validate default subtasks
	if (globalConfig.defaultSubtasks) {
		if (globalConfig.defaultSubtasks > 20) {
			result.addWarning(
				'global.defaultSubtasks',
				`High default subtasks count (${globalConfig.defaultSubtasks}) may impact performance`,
				'HIGH_SUBTASK_COUNT'
			);
		}
	}

	// Validate URLs
	const urlFields = ['ollamaBaseURL', 'azureBaseURL', 'bedrockBaseURL'];
	for (const field of urlFields) {
		if (globalConfig[field] && !isValidUrl(globalConfig[field])) {
			result.addError(
				`global.${field}`,
				`Invalid URL format for ${field}: ${globalConfig[field]}`,
				'INVALID_URL'
			);
		}
	}

	return result;
}

/**
 * Validates environment setup and variable availability
 * @param {object} config - Configuration object
 * @param {string} projectRoot - Project root directory
 * @returns {ValidationResult} Validation result
 */
export function validateEnvironmentSetup(config, projectRoot) {
	const result = new ValidationResult();

	try {
		// Check for required environment variables based on configuration
		if (config.models) {
			const providers = new Set();
			['main', 'research', 'fallback'].forEach((role) => {
				const provider = config.models[role]?.provider;
				if (provider) providers.add(provider);
			});

			// Validate API keys for configured providers
			for (const provider of providers) {
				if (provider !== 'ollama') {
					// Ollama doesn't need API key
					const hasKey = checkProviderApiKey(provider, projectRoot);
					if (!hasKey) {
						result.addError(
							`environment.${provider}_api_key`,
							`Missing API key for provider "${provider}". Set the appropriate environment variable`,
							'MISSING_PROVIDER_API_KEY'
						);
					}
				}
			}
		}

		// Check Linear API key if Linear is enabled
		if (config.integrations?.linear?.enabled) {
			const linearApiKey = resolveApiKey(
				config.integrations.linear.apiKey,
				projectRoot
			);
			if (!linearApiKey) {
				result.addError(
					'environment.linear_api_key',
					'LINEAR_API_KEY environment variable is required when Linear integration is enabled',
					'MISSING_LINEAR_API_KEY'
				);
			}
		}

		// Check Azure-specific environment variables
		if (config.models && hasAzureProvider(config.models)) {
			const azureEndpoint = resolveEnvVariable(
				'AZURE_OPENAI_ENDPOINT',
				null,
				projectRoot
			);
			if (!azureEndpoint) {
				result.addWarning(
					'environment.azure_endpoint',
					'AZURE_OPENAI_ENDPOINT environment variable is recommended when using Azure provider',
					'MISSING_AZURE_ENDPOINT'
				);
			}
		}

		// Check Vertex AI configuration
		if (config.models && hasVertexProvider(config.models)) {
			const vertexProject = resolveEnvVariable(
				'VERTEX_PROJECT_ID',
				null,
				projectRoot
			);
			if (!vertexProject) {
				result.addError(
					'environment.vertex_project',
					'VERTEX_PROJECT_ID environment variable is required when using Vertex AI provider',
					'MISSING_VERTEX_PROJECT'
				);
			}
		}
	} catch (error) {
		result.addError(
			'environment.validation',
			`Environment validation failed: ${error.message}`,
			'ENVIRONMENT_VALIDATION_ERROR'
		);
	}

	return result;
}

/**
 * Validates configuration consistency and cross-field relationships
 * @param {object} config - Configuration object
 * @returns {ValidationResult} Validation result
 */
function validateConfigConsistency(config) {
	const result = new ValidationResult();

	// Validate that fallback provider is different from main provider
	if (config.models?.main?.provider && config.models?.fallback?.provider) {
		if (
			config.models.main.provider === config.models.fallback.provider &&
			config.models.main.modelId === config.models.fallback.modelId
		) {
			result.addWarning(
				'models.fallback',
				'Fallback model is the same as main model. Consider using a different model for fallback',
				'IDENTICAL_FALLBACK_MODEL'
			);
		}
	}

	// Validate Linear configuration consistency
	if (config.integrations?.linear) {
		const linear = config.integrations.linear;

		// Check if webhooks are enabled but URL or secret is missing
		if (linear.webhooks?.enabled) {
			if (!linear.webhooks?.url) {
				result.addError(
					'integrations.linear.webhooks.url',
					'Webhook URL is required when webhooks are enabled',
					'MISSING_WEBHOOK_URL'
				);
			}
			if (!linear.webhooks?.secret) {
				result.addError(
					'integrations.linear.webhooks.secret',
					'Webhook secret is required when webhooks are enabled',
					'MISSING_WEBHOOK_SECRET'
				);
			}
		}

		// Check if sync is enabled but Linear integration is disabled
		if (!linear.enabled && linear.sync?.autoSync) {
			result.addWarning(
				'integrations.linear.sync.autoSync',
				'Auto-sync is enabled but Linear integration is disabled',
				'SYNC_WITHOUT_INTEGRATION'
			);
		}
	}

	return result;
}

/**
 * Validates security constraints and best practices
 * @param {object} config - Configuration object
 * @returns {ValidationResult} Validation result
 */
function validateSecurityConstraints(config) {
	const result = new ValidationResult();

	// Check for hardcoded API keys (security issue)
	const checkForHardcodedKeys = (obj, path = '') => {
		for (const [key, value] of Object.entries(obj)) {
			const currentPath = path ? `${path}.${key}` : key;

			if (typeof value === 'string') {
				// Check for potential API keys that aren't environment variable placeholders
				if (
					key.toLowerCase().includes('key') ||
					key.toLowerCase().includes('secret')
				) {
					if (
						!value.startsWith('${') &&
						value.length > 10 &&
						!/^YOUR_.*_HERE$/.test(value)
					) {
						result.addError(
							currentPath,
							'Hardcoded API keys or secrets detected. Use environment variable placeholders instead',
							'HARDCODED_SECRET'
						);
					}
				}
			} else if (typeof value === 'object' && value !== null) {
				checkForHardcodedKeys(value, currentPath);
			}
		}
	};

	checkForHardcodedKeys(config);

	// Check for insecure URL schemes
	const urlFields = [
		'global.ollamaBaseURL',
		'global.azureBaseURL',
		'global.bedrockBaseURL',
		'integrations.linear.webhooks.url'
	];

	for (const fieldPath of urlFields) {
		const value = getNestedValue(config, fieldPath);
		if (value && typeof value === 'string' && value.startsWith('http://')) {
			result.addWarning(
				fieldPath,
				'Consider using HTTPS instead of HTTP for better security',
				'INSECURE_URL_SCHEME'
			);
		}
	}

	return result;
}

/**
 * Validates Linear API connectivity
 * @param {object} linearConfig - Linear configuration
 * @param {string} projectRoot - Project root directory
 * @returns {Promise<ValidationResult>} Validation result
 */
export async function validateLinearConnection(linearConfig, projectRoot) {
	const result = new ValidationResult();

	if (!linearConfig?.enabled) {
		result.addSuggestion(
			'integrations.linear.enabled',
			'Linear integration is disabled. Enable it to use Linear features',
			'LINEAR_DISABLED'
		);
		return result;
	}

	try {
		const apiKey = resolveApiKey(linearConfig.apiKey, projectRoot);
		if (!apiKey) {
			result.addError(
				'integrations.linear.apiKey',
				'Linear API key is required for connection validation',
				'MISSING_API_KEY'
			);
			return result;
		}

		// Note: Actual API validation would require the Linear SDK
		// For now, we validate the format and suggest testing
		if (_validateLinearApiKey(apiKey)) {
			result.addSuggestion(
				'integrations.linear.connection',
				'Linear API key format is valid. Test connection with Linear CLI or dashboard',
				'API_KEY_FORMAT_VALID'
			);
		} else {
			result.addError(
				'integrations.linear.apiKey',
				'Linear API key format is invalid',
				'INVALID_API_KEY_FORMAT'
			);
		}
	} catch (error) {
		result.addError(
			'integrations.linear.connection',
			`Linear connection validation failed: ${error.message}`,
			'CONNECTION_VALIDATION_ERROR'
		);
	}

	return result;
}

/**
 * Creates a validation schema for configuration
 * @param {object} options - Schema options
 * @returns {object} Zod schema
 */
export function createConfigSchema(options = {}) {
	const { strict = false, includeLinear = true } = options;

	if (strict) {
		return FULL_CONFIG_SCHEMA.strict();
	}

	return FULL_CONFIG_SCHEMA;
}

// Helper functions

function resolveApiKey(apiKeyValue, projectRoot) {
	if (
		typeof apiKeyValue === 'string' &&
		apiKeyValue.startsWith('${') &&
		apiKeyValue.endsWith('}')
	) {
		const envVarName = apiKeyValue.slice(2, -1);
		const resolved = resolveEnvVariable(envVarName, null, projectRoot);
		return resolved && resolved.trim() !== '' ? resolved : null;
	}
	return apiKeyValue;
}

function checkProviderApiKey(provider, projectRoot) {
	const keyMap = {
		openai: 'OPENAI_API_KEY',
		anthropic: 'ANTHROPIC_API_KEY',
		google: 'GOOGLE_API_KEY',
		perplexity: 'PERPLEXITY_API_KEY',
		mistral: 'MISTRAL_API_KEY',
		azure: 'AZURE_OPENAI_API_KEY',
		openrouter: 'OPENROUTER_API_KEY',
		xai: 'XAI_API_KEY',
		vertex: 'GOOGLE_API_KEY'
	};

	const envVarName = keyMap[provider.toLowerCase()];
	if (!envVarName) return false;

	const apiKey = resolveEnvVariable(envVarName, null, projectRoot);
	return apiKey && apiKey.trim() !== '' && !apiKey.includes('KEY_HERE');
}

function hasAzureProvider(models) {
	return Object.values(models).some((model) => model?.provider === 'azure');
}

function hasVertexProvider(models) {
	return Object.values(models).some((model) => model?.provider === 'vertex');
}

function isValidUrl(url) {
	try {
		new URL(url);
		return true;
	} catch {
		return false;
	}
}

function getNestedValue(obj, path) {
	return path.split('.').reduce((current, key) => current?.[key], obj);
}
