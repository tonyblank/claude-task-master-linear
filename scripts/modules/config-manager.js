import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { fileURLToPath } from 'url';
import {
	log,
	findProjectRoot,
	resolveEnvVariable,
	readJSON,
	writeJSON
} from './utils.js';
import { LEGACY_CONFIG_FILE } from '../../src/constants/paths.js';
import { findConfigPath } from '../../src/utils/path-utils.js';

// Calculate __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load supported models from JSON file using the calculated __dirname
let MODEL_MAP;
try {
	const supportedModelsRaw = fs.readFileSync(
		path.join(__dirname, 'supported-models.json'),
		'utf-8'
	);
	MODEL_MAP = JSON.parse(supportedModelsRaw);
} catch (error) {
	console.error(
		chalk.red(
			'FATAL ERROR: Could not load supported-models.json. Please ensure the file exists and is valid JSON.'
		),
		error
	);
	MODEL_MAP = {}; // Default to empty map on error to avoid crashing, though functionality will be limited
	process.exit(1); // Exit if models can't be loaded
}

// Define valid providers dynamically from the loaded MODEL_MAP
const VALID_PROVIDERS = Object.keys(MODEL_MAP || {});

// Default configuration values (used if config file is missing or incomplete)
const DEFAULTS = {
	models: {
		main: {
			provider: 'anthropic',
			modelId: 'claude-3-7-sonnet-20250219',
			maxTokens: 64000,
			temperature: 0.2
		},
		research: {
			provider: 'perplexity',
			modelId: 'sonar-pro',
			maxTokens: 8700,
			temperature: 0.1
		},
		fallback: {
			// No default fallback provider/model initially
			provider: 'anthropic',
			modelId: 'claude-3-5-sonnet',
			maxTokens: 64000, // Default parameters if fallback IS configured
			temperature: 0.2
		}
	},
	global: {
		logLevel: 'info',
		debug: false,
		defaultSubtasks: 5,
		defaultPriority: 'medium',
		projectName: 'Task Master',
		ollamaBaseURL: 'http://localhost:11434/api',
		bedrockBaseURL: 'https://bedrock.us-east-1.amazonaws.com'
	},
	integrations: {
		linear: {
			enabled: false,
			apiKey: '${LINEAR_API_KEY}',
			team: {
				id: null,
				name: null
			},
			project: {
				id: null,
				name: null
			},
			labels: {
				enabled: true,
				sourceLabel: 'taskmaster',
				priorityMapping: {
					high: 'High Priority',
					medium: 'Medium Priority',
					low: 'Low Priority'
				},
				statusMapping: {
					pending: 'Todo',
					'in-progress': 'In Progress',
					review: 'In Review',
					done: 'Done',
					cancelled: 'Cancelled',
					deferred: 'Backlog'
				},
				statusUuidMapping: {
					// UUID-based mappings for direct Linear API calls
					// These take precedence over statusMapping when available
					// Format: { 'pending': 'uuid-string', ... }
				}
			},
			sync: {
				autoSync: true,
				syncOnStatusChange: true,
				syncSubtasks: true,
				syncDependencies: true,
				batchSize: 10,
				retryAttempts: 3,
				retryDelay: 1000
			},
			webhooks: {
				enabled: false,
				url: null,
				secret: null
			}
		}
	}
};

// --- Internal Config Loading ---
let loadedConfig = null;
let loadedConfigRoot = null; // Track which root loaded the config

// Custom Error for configuration issues
class ConfigurationError extends Error {
	constructor(message) {
		super(message);
		this.name = 'ConfigurationError';
	}
}

function _loadAndValidateConfig(explicitRoot = null) {
	const defaults = DEFAULTS; // Use the defined defaults
	let rootToUse = explicitRoot;
	let configSource = explicitRoot
		? `explicit root (${explicitRoot})`
		: 'defaults (no root provided yet)';

	// ---> If no explicit root, TRY to find it <---
	if (!rootToUse) {
		rootToUse = findProjectRoot();
		if (rootToUse) {
			configSource = `found root (${rootToUse})`;
		} else {
			// No root found, return defaults immediately
			return defaults;
		}
	}
	// ---> End find project root logic <---

	// --- Find configuration file using centralized path utility ---
	const configPath = findConfigPath(null, { projectRoot: rootToUse });
	let config = { ...defaults }; // Start with a deep copy of defaults
	let configExists = false;

	if (configPath) {
		configExists = true;
		const isLegacy = configPath.endsWith(LEGACY_CONFIG_FILE);

		try {
			const rawData = fs.readFileSync(configPath, 'utf-8');
			const parsedConfig = JSON.parse(rawData);

			// Deep merge parsed config onto defaults
			config = {
				models: {
					main: { ...defaults.models.main, ...parsedConfig?.models?.main },
					research: {
						...defaults.models.research,
						...parsedConfig?.models?.research
					},
					fallback:
						parsedConfig?.models?.fallback?.provider &&
						parsedConfig?.models?.fallback?.modelId
							? { ...defaults.models.fallback, ...parsedConfig.models.fallback }
							: { ...defaults.models.fallback }
				},
				global: { ...defaults.global, ...parsedConfig?.global },
				integrations: {
					linear: {
						...defaults.integrations.linear,
						...parsedConfig?.integrations?.linear,
						team: {
							...defaults.integrations.linear.team,
							...parsedConfig?.integrations?.linear?.team
						},
						project: {
							...defaults.integrations.linear.project,
							...parsedConfig?.integrations?.linear?.project
						},
						labels: {
							...defaults.integrations.linear.labels,
							...parsedConfig?.integrations?.linear?.labels,
							priorityMapping: {
								...defaults.integrations.linear.labels.priorityMapping,
								...parsedConfig?.integrations?.linear?.labels?.priorityMapping
							},
							statusMapping: {
								...defaults.integrations.linear.labels.statusMapping,
								...parsedConfig?.integrations?.linear?.labels?.statusMapping
							}
						},
						sync: {
							...defaults.integrations.linear.sync,
							...parsedConfig?.integrations?.linear?.sync
						},
						webhooks: {
							...defaults.integrations.linear.webhooks,
							...parsedConfig?.integrations?.linear?.webhooks
						}
					}
				}
			};
			configSource = `file (${configPath})`; // Update source info

			// Issue deprecation warning if using legacy config file
			if (isLegacy) {
				console.warn(
					chalk.yellow(
						`⚠️  DEPRECATION WARNING: Found configuration in legacy location '${configPath}'. Please migrate to .taskmaster/config.json. Run 'task-master migrate' to automatically migrate your project.`
					)
				);
			}

			// --- Enhanced Validation and Deprecation Warnings ---
			// Basic provider validation (kept for backward compatibility)
			if (!validateProvider(config.models.main.provider)) {
				console.warn(
					chalk.yellow(
						`Warning: Invalid main provider "${config.models.main.provider}" in ${configPath}. Falling back to default.`
					)
				);
				config.models.main = { ...defaults.models.main };
			}
			if (!validateProvider(config.models.research.provider)) {
				console.warn(
					chalk.yellow(
						`Warning: Invalid research provider "${config.models.research.provider}" in ${configPath}. Falling back to default.`
					)
				);
				config.models.research = { ...defaults.models.research };
			}
			if (
				config.models.fallback?.provider &&
				!validateProvider(config.models.fallback.provider)
			) {
				console.warn(
					chalk.yellow(
						`Warning: Invalid fallback provider "${config.models.fallback.provider}" in ${configPath}. Fallback model configuration will be ignored.`
					)
				);
				config.models.fallback.provider = undefined;
				config.models.fallback.modelId = undefined;
			}

			// --- Deprecation and Best Practice Warnings ---
			// Skip warnings during interactive setup to avoid UI interference
			if (!process.env.TASKMASTER_INTERACTIVE_SETUP) {
				_showDeprecationWarnings(config, configPath, isLegacy);
				_showConfigurationWarnings(config, rootToUse);
			}
		} catch (error) {
			// Use console.error for actual errors during parsing
			console.error(
				chalk.red(
					`Error reading or parsing ${configPath}: ${error.message}. Using default configuration.`
				)
			);
			config = { ...defaults }; // Reset to defaults on parse error
			configSource = `defaults (parse error at ${configPath})`;
		}
	} else {
		// Config file doesn't exist at the determined rootToUse.
		if (explicitRoot) {
			// Only warn if an explicit root was *expected*.
			console.warn(
				chalk.yellow(
					`Warning: Configuration file not found at provided project root (${explicitRoot}). Using default configuration. Run 'task-master models --setup' to configure.`
				)
			);
		} else {
			console.warn(
				chalk.yellow(
					`Warning: Configuration file not found at derived root (${rootToUse}). Using defaults.`
				)
			);
		}
		// Keep config as defaults
		config = { ...defaults };
		configSource = `defaults (no config file found at ${rootToUse})`;
	}

	return config;
}

/**
 * Gets the current configuration, loading it if necessary.
 * Handles MCP initialization context gracefully.
 * @param {string|null} explicitRoot - Optional explicit path to the project root.
 * @param {boolean} forceReload - Force reloading the config file.
 * @returns {object} The loaded configuration object.
 */
function getConfig(explicitRoot = null, forceReload = false) {
	// Determine if a reload is necessary
	const needsLoad =
		!loadedConfig ||
		forceReload ||
		(explicitRoot && explicitRoot !== loadedConfigRoot);

	if (needsLoad) {
		const newConfig = _loadAndValidateConfig(explicitRoot); // _load handles null explicitRoot

		// Only update the global cache if loading was forced or if an explicit root
		// was provided (meaning we attempted to load a specific project's config).
		// We avoid caching the initial default load triggered without an explicitRoot.
		if (forceReload || explicitRoot) {
			loadedConfig = newConfig;
			loadedConfigRoot = explicitRoot; // Store the root used for this loaded config
		}
		return newConfig; // Return the newly loaded/default config
	}

	// If no load was needed, return the cached config
	return loadedConfig;
}

/**
 * Validates if a provider name is in the list of supported providers.
 * @param {string} providerName The name of the provider.
 * @returns {boolean} True if the provider is valid, false otherwise.
 */
function validateProvider(providerName) {
	return VALID_PROVIDERS.includes(providerName);
}

/**
 * Optional: Validates if a modelId is known for a given provider based on MODEL_MAP.
 * This is a non-strict validation; an unknown model might still be valid.
 * @param {string} providerName The name of the provider.
 * @param {string} modelId The model ID.
 * @returns {boolean} True if the modelId is in the map for the provider, false otherwise.
 */
function validateProviderModelCombination(providerName, modelId) {
	// If provider isn't even in our map, we can't validate the model
	if (!MODEL_MAP[providerName]) {
		return true; // Allow unknown providers or those without specific model lists
	}
	// If the provider is known, check if the model is in its list OR if the list is empty (meaning accept any)
	return (
		MODEL_MAP[providerName].length === 0 ||
		// Use .some() to check the 'id' property of objects in the array
		MODEL_MAP[providerName].some((modelObj) => modelObj.id === modelId)
	);
}

// --- Role-Specific Getters ---

function getModelConfigForRole(role, explicitRoot = null) {
	const config = getConfig(explicitRoot);
	const roleConfig = config?.models?.[role];
	if (!roleConfig) {
		log(
			'warn',
			`No model configuration found for role: ${role}. Returning default.`
		);
		return DEFAULTS.models[role] || {};
	}
	return roleConfig;
}

function getMainProvider(explicitRoot = null) {
	return getModelConfigForRole('main', explicitRoot).provider;
}

function getMainModelId(explicitRoot = null) {
	return getModelConfigForRole('main', explicitRoot).modelId;
}

function getMainMaxTokens(explicitRoot = null) {
	// Directly return value from config (which includes defaults)
	return getModelConfigForRole('main', explicitRoot).maxTokens;
}

function getMainTemperature(explicitRoot = null) {
	// Directly return value from config
	return getModelConfigForRole('main', explicitRoot).temperature;
}

function getResearchProvider(explicitRoot = null) {
	return getModelConfigForRole('research', explicitRoot).provider;
}

function getResearchModelId(explicitRoot = null) {
	return getModelConfigForRole('research', explicitRoot).modelId;
}

function getResearchMaxTokens(explicitRoot = null) {
	// Directly return value from config
	return getModelConfigForRole('research', explicitRoot).maxTokens;
}

function getResearchTemperature(explicitRoot = null) {
	// Directly return value from config
	return getModelConfigForRole('research', explicitRoot).temperature;
}

function getFallbackProvider(explicitRoot = null) {
	// Directly return value from config (will be undefined if not set)
	return getModelConfigForRole('fallback', explicitRoot).provider;
}

function getFallbackModelId(explicitRoot = null) {
	// Directly return value from config
	return getModelConfigForRole('fallback', explicitRoot).modelId;
}

function getFallbackMaxTokens(explicitRoot = null) {
	// Directly return value from config
	return getModelConfigForRole('fallback', explicitRoot).maxTokens;
}

function getFallbackTemperature(explicitRoot = null) {
	// Directly return value from config
	return getModelConfigForRole('fallback', explicitRoot).temperature;
}

// --- Global Settings Getters ---

function getGlobalConfig(explicitRoot = null) {
	const config = getConfig(explicitRoot);
	// Ensure global defaults are applied if global section is missing
	return { ...DEFAULTS.global, ...(config?.global || {}) };
}

function getLogLevel(explicitRoot = null) {
	// Directly return value from config
	return getGlobalConfig(explicitRoot).logLevel.toLowerCase();
}

function getDebugFlag(explicitRoot = null) {
	// Directly return value from config, ensure boolean
	return getGlobalConfig(explicitRoot).debug === true;
}

function getDefaultSubtasks(explicitRoot = null) {
	// Directly return value from config, ensure integer
	const val = getGlobalConfig(explicitRoot).defaultSubtasks;
	const parsedVal = parseInt(val, 10);
	return Number.isNaN(parsedVal) ? DEFAULTS.global.defaultSubtasks : parsedVal;
}

function getDefaultNumTasks(explicitRoot = null) {
	const val = getGlobalConfig(explicitRoot).defaultNumTasks;
	const parsedVal = parseInt(val, 10);
	return Number.isNaN(parsedVal) ? DEFAULTS.global.defaultNumTasks : parsedVal;
}

function getDefaultPriority(explicitRoot = null) {
	// Directly return value from config
	return getGlobalConfig(explicitRoot).defaultPriority;
}

function getProjectName(explicitRoot = null) {
	// Directly return value from config
	return getGlobalConfig(explicitRoot).projectName;
}

function getOllamaBaseURL(explicitRoot = null) {
	// Directly return value from config
	return getGlobalConfig(explicitRoot).ollamaBaseURL;
}

function getAzureBaseURL(explicitRoot = null) {
	// Directly return value from config
	return getGlobalConfig(explicitRoot).azureBaseURL;
}

function getBedrockBaseURL(explicitRoot = null) {
	// Directly return value from config
	return getGlobalConfig(explicitRoot).bedrockBaseURL;
}

/**
 * Gets the Google Cloud project ID for Vertex AI from configuration
 * @param {string|null} explicitRoot - Optional explicit path to the project root.
 * @returns {string|null} The project ID or null if not configured
 */
function getVertexProjectId(explicitRoot = null) {
	// Return value from config
	return getGlobalConfig(explicitRoot).vertexProjectId;
}

/**
 * Gets the Google Cloud location for Vertex AI from configuration
 * @param {string|null} explicitRoot - Optional explicit path to the project root.
 * @returns {string} The location or default value of "us-central1"
 */
function getVertexLocation(explicitRoot = null) {
	// Return value from config or default
	return getGlobalConfig(explicitRoot).vertexLocation || 'us-central1';
}

/**
 * Gets model parameters (maxTokens, temperature) for a specific role,
 * considering model-specific overrides from supported-models.json.
 * @param {string} role - The role ('main', 'research', 'fallback').
 * @param {string|null} explicitRoot - Optional explicit path to the project root.
 * @returns {{maxTokens: number, temperature: number}}
 */
function getParametersForRole(role, explicitRoot = null) {
	const roleConfig = getModelConfigForRole(role, explicitRoot);
	const roleMaxTokens = roleConfig.maxTokens;
	const roleTemperature = roleConfig.temperature;
	const modelId = roleConfig.modelId;
	const providerName = roleConfig.provider;

	let effectiveMaxTokens = roleMaxTokens; // Start with the role's default

	try {
		// Find the model definition in MODEL_MAP
		const providerModels = MODEL_MAP[providerName];
		if (providerModels && Array.isArray(providerModels)) {
			const modelDefinition = providerModels.find((m) => m.id === modelId);

			// Check if a model-specific max_tokens is defined and valid
			if (
				modelDefinition &&
				typeof modelDefinition.max_tokens === 'number' &&
				modelDefinition.max_tokens > 0
			) {
				const modelSpecificMaxTokens = modelDefinition.max_tokens;
				// Use the minimum of the role default and the model specific limit
				effectiveMaxTokens = Math.min(roleMaxTokens, modelSpecificMaxTokens);
				log(
					'debug',
					`Applying model-specific max_tokens (${modelSpecificMaxTokens}) for ${modelId}. Effective limit: ${effectiveMaxTokens}`
				);
			} else {
				log(
					'debug',
					`No valid model-specific max_tokens override found for ${modelId}. Using role default: ${roleMaxTokens}`
				);
			}
		} else {
			log(
				'debug',
				`No model definitions found for provider ${providerName} in MODEL_MAP. Using role default maxTokens: ${roleMaxTokens}`
			);
		}
	} catch (lookupError) {
		log(
			'warn',
			`Error looking up model-specific max_tokens for ${modelId}: ${lookupError.message}. Using role default: ${roleMaxTokens}`
		);
		// Fallback to role default on error
		effectiveMaxTokens = roleMaxTokens;
	}

	return {
		maxTokens: effectiveMaxTokens,
		temperature: roleTemperature
	};
}

/**
 * Checks if the API key for a given provider is set in the environment.
 * Checks process.env first, then session.env if session is provided, then .env file if projectRoot provided.
 * @param {string} providerName - The name of the provider (e.g., 'openai', 'anthropic').
 * @param {object|null} [session=null] - The MCP session object (optional).
 * @param {string|null} [projectRoot=null] - The project root directory (optional, for .env file check).
 * @returns {boolean} True if the API key is set, false otherwise.
 */
function isApiKeySet(providerName, session = null, projectRoot = null) {
	// Define the expected environment variable name for each provider
	if (providerName?.toLowerCase() === 'ollama') {
		return true; // Indicate key status is effectively "OK"
	}

	const keyMap = {
		openai: 'OPENAI_API_KEY',
		anthropic: 'ANTHROPIC_API_KEY',
		google: 'GOOGLE_API_KEY',
		perplexity: 'PERPLEXITY_API_KEY',
		mistral: 'MISTRAL_API_KEY',
		azure: 'AZURE_OPENAI_API_KEY',
		openrouter: 'OPENROUTER_API_KEY',
		xai: 'XAI_API_KEY',
		vertex: 'GOOGLE_API_KEY' // Vertex uses the same key as Google
		// Add other providers as needed
	};

	const providerKey = providerName?.toLowerCase();
	if (!providerKey || !keyMap[providerKey]) {
		log('warn', `Unknown provider name: ${providerName} in isApiKeySet check.`);
		return false;
	}

	const envVarName = keyMap[providerKey];
	const apiKeyValue = resolveEnvVariable(envVarName, session, projectRoot);

	// Check if the key exists, is not empty, and is not a placeholder
	return (
		apiKeyValue &&
		apiKeyValue.trim() !== '' &&
		!/YOUR_.*_API_KEY_HERE/.test(apiKeyValue) && // General placeholder check
		!apiKeyValue.includes('KEY_HERE')
	); // Another common placeholder pattern
}

/**
 * Checks the API key status within .cursor/mcp.json for a given provider.
 * Reads the mcp.json file, finds the taskmaster-ai server config, and checks the relevant env var.
 * @param {string} providerName The name of the provider.
 * @param {string|null} projectRoot - Optional explicit path to the project root.
 * @returns {boolean} True if the key exists and is not a placeholder, false otherwise.
 */
function getMcpApiKeyStatus(providerName, projectRoot = null) {
	const rootDir = projectRoot || findProjectRoot(); // Use existing root finding
	if (!rootDir) {
		console.warn(
			chalk.yellow('Warning: Could not find project root to check mcp.json.')
		);
		return false; // Cannot check without root
	}
	const mcpConfigPath = path.join(rootDir, '.cursor', 'mcp.json');

	if (!fs.existsSync(mcpConfigPath)) {
		// console.warn(chalk.yellow('Warning: .cursor/mcp.json not found.'));
		return false; // File doesn't exist
	}

	try {
		const mcpConfigRaw = fs.readFileSync(mcpConfigPath, 'utf-8');
		const mcpConfig = JSON.parse(mcpConfigRaw);

		const mcpEnv = mcpConfig?.mcpServers?.['taskmaster-ai']?.env;
		if (!mcpEnv) {
			// console.warn(chalk.yellow('Warning: Could not find taskmaster-ai env in mcp.json.'));
			return false; // Structure missing
		}

		let apiKeyToCheck = null;
		let placeholderValue = null;

		switch (providerName) {
			case 'anthropic':
				apiKeyToCheck = mcpEnv.ANTHROPIC_API_KEY;
				placeholderValue = 'YOUR_ANTHROPIC_API_KEY_HERE';
				break;
			case 'openai':
				apiKeyToCheck = mcpEnv.OPENAI_API_KEY;
				placeholderValue = 'YOUR_OPENAI_API_KEY_HERE'; // Assuming placeholder matches OPENAI
				break;
			case 'openrouter':
				apiKeyToCheck = mcpEnv.OPENROUTER_API_KEY;
				placeholderValue = 'YOUR_OPENROUTER_API_KEY_HERE';
				break;
			case 'google':
				apiKeyToCheck = mcpEnv.GOOGLE_API_KEY;
				placeholderValue = 'YOUR_GOOGLE_API_KEY_HERE';
				break;
			case 'perplexity':
				apiKeyToCheck = mcpEnv.PERPLEXITY_API_KEY;
				placeholderValue = 'YOUR_PERPLEXITY_API_KEY_HERE';
				break;
			case 'xai':
				apiKeyToCheck = mcpEnv.XAI_API_KEY;
				placeholderValue = 'YOUR_XAI_API_KEY_HERE';
				break;
			case 'ollama':
				return true; // No key needed
			case 'mistral':
				apiKeyToCheck = mcpEnv.MISTRAL_API_KEY;
				placeholderValue = 'YOUR_MISTRAL_API_KEY_HERE';
				break;
			case 'azure':
				apiKeyToCheck = mcpEnv.AZURE_OPENAI_API_KEY;
				placeholderValue = 'YOUR_AZURE_OPENAI_API_KEY_HERE';
				break;
			case 'vertex':
				apiKeyToCheck = mcpEnv.GOOGLE_API_KEY; // Vertex uses Google API key
				placeholderValue = 'YOUR_GOOGLE_API_KEY_HERE';
				break;
			default:
				return false; // Unknown provider
		}

		return !!apiKeyToCheck && !/KEY_HERE$/.test(apiKeyToCheck);
	} catch (error) {
		console.error(
			chalk.red(`Error reading or parsing .cursor/mcp.json: ${error.message}`)
		);
		return false;
	}
}

/**
 * Gets a list of available models based on the MODEL_MAP.
 * @returns {Array<{id: string, name: string, provider: string, swe_score: number|null, cost_per_1m_tokens: {input: number|null, output: number|null}|null, allowed_roles: string[]}>}
 */
function getAvailableModels() {
	const available = [];
	for (const [provider, models] of Object.entries(MODEL_MAP)) {
		if (models.length > 0) {
			models.forEach((modelObj) => {
				// Basic name generation - can be improved
				const modelId = modelObj.id;
				const sweScore = modelObj.swe_score;
				const cost = modelObj.cost_per_1m_tokens;
				const allowedRoles = modelObj.allowed_roles || ['main', 'fallback'];
				const nameParts = modelId
					.split('-')
					.map((p) => p.charAt(0).toUpperCase() + p.slice(1));
				// Handle specific known names better if needed
				let name = nameParts.join(' ');
				if (modelId === 'claude-3.5-sonnet-20240620')
					name = 'Claude 3.5 Sonnet';
				if (modelId === 'claude-3-7-sonnet-20250219')
					name = 'Claude 3.7 Sonnet';
				if (modelId === 'gpt-4o') name = 'GPT-4o';
				if (modelId === 'gpt-4-turbo') name = 'GPT-4 Turbo';
				if (modelId === 'sonar-pro') name = 'Perplexity Sonar Pro';
				if (modelId === 'sonar-mini') name = 'Perplexity Sonar Mini';

				available.push({
					id: modelId,
					name: name,
					provider: provider,
					swe_score: sweScore,
					cost_per_1m_tokens: cost,
					allowed_roles: allowedRoles
				});
			});
		} else {
			// For providers with empty lists (like ollama), maybe add a placeholder or skip
			available.push({
				id: `[${provider}-any]`,
				name: `Any (${provider})`,
				provider: provider
			});
		}
	}
	return available;
}

/**
 * Writes the configuration object to the file.
 * @param {Object} config The configuration object to write.
 * @param {string|null} explicitRoot - Optional explicit path to the project root.
 * @returns {boolean} True if successful, false otherwise.
 */
function writeConfig(config, explicitRoot = null) {
	// ---> Determine root path reliably <---
	let rootPath = explicitRoot;
	if (explicitRoot === null || explicitRoot === undefined) {
		// Logic matching _loadAndValidateConfig
		const foundRoot = findProjectRoot(); // *** Explicitly call findProjectRoot ***
		if (!foundRoot) {
			console.error(
				chalk.red(
					'Error: Could not determine project root. Configuration not saved.'
				)
			);
			return false;
		}
		rootPath = foundRoot;
	}
	// ---> End determine root path logic <---

	// Use new config location: .taskmaster/config.json
	const taskmasterDir = path.join(rootPath, '.taskmaster');
	const configPath = path.join(taskmasterDir, 'config.json');

	try {
		// Ensure .taskmaster directory exists
		if (!fs.existsSync(taskmasterDir)) {
			fs.mkdirSync(taskmasterDir, { recursive: true });
		}

		fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
		loadedConfig = config; // Update the cache after successful write
		return true;
	} catch (error) {
		console.error(
			chalk.red(
				`Error writing configuration to ${configPath}: ${error.message}`
			)
		);
		return false;
	}
}

/**
 * Checks if a configuration file exists at the project root (new or legacy location)
 * @param {string|null} explicitRoot - Optional explicit path to the project root
 * @returns {boolean} True if the file exists, false otherwise
 */
function isConfigFilePresent(explicitRoot = null) {
	return findConfigPath(null, { projectRoot: explicitRoot }) !== null;
}

/**
 * Gets the user ID from the configuration.
 * @param {string|null} explicitRoot - Optional explicit path to the project root.
 * @returns {string|null} The user ID or null if not found.
 */
function getUserId(explicitRoot = null) {
	const config = getConfig(explicitRoot);
	if (!config.global) {
		config.global = {}; // Ensure global object exists
	}
	if (!config.global.userId) {
		config.global.userId = '1234567890';
		// Attempt to write the updated config.
		// It's important that writeConfig correctly resolves the path
		// using explicitRoot, similar to how getConfig does.
		const success = writeConfig(config, explicitRoot);
		if (!success) {
			// Log an error or handle the failure to write,
			// though for now, we'll proceed with the in-memory default.
			log(
				'warning',
				'Failed to write updated configuration with new userId. Please let the developers know.'
			);
		}
	}
	return config.global.userId;
}

/**
 * Gets a list of all provider names defined in the MODEL_MAP.
 * @returns {string[]} An array of provider names.
 */
function getAllProviders() {
	return Object.keys(MODEL_MAP || {});
}

function getBaseUrlForRole(role, explicitRoot = null) {
	const roleConfig = getModelConfigForRole(role, explicitRoot);
	return roleConfig && typeof roleConfig.baseURL === 'string'
		? roleConfig.baseURL
		: undefined;
}

// --- Linear Integration Configuration Getters ---

/**
 * Gets the Linear integration configuration from linear-config.json
 * @param {string|null} explicitRoot - Optional explicit path to the project root
 * @returns {object} The Linear configuration object
 */
function getLinearConfig(explicitRoot = null) {
	const projectRoot = explicitRoot || findProjectRoot();
	const linearConfigPath = path.join(
		projectRoot,
		'.taskmaster',
		'linear-config.json'
	);

	try {
		if (fs.existsSync(linearConfigPath)) {
			return readJSON(linearConfigPath);
		}
	} catch (error) {
		log('warn', `Failed to read Linear config: ${error.message}`);
	}

	return { team: { id: null }, project: { id: null }, mappings: {} };
}

/**
 * Gets the Linear API key, resolving environment variables
 * @param {string|null} explicitRoot - Optional explicit path to the project root
 * @returns {string|null} The resolved Linear API key
 */
function getLinearApiKey(explicitRoot = null) {
	// Read API key directly from environment variables
	return (
		process.env.LINEAR_API_KEY || process.env.TASKMASTER_LINEAR_API_KEY || null
	);
}

/**
 * Gets the Linear team configuration with environment variable resolution
 * @param {string|null} explicitRoot - Optional explicit path to the project root
 * @returns {object} The team configuration object
 */
function getLinearTeam(explicitRoot = null) {
	const linearConfig = getLinearConfig(explicitRoot);
	const team = linearConfig.team || { id: null, name: null };

	// Resolve environment variable for team ID if placeholder format is used
	if (
		typeof team.id === 'string' &&
		team.id.startsWith('${') &&
		team.id.endsWith('}')
	) {
		const envVarName = team.id.slice(2, -1); // Remove ${ and }
		team.id = process.env[envVarName] || null;
	}

	return team;
}

/**
 * Gets the Linear team ID
 * @param {string|null} explicitRoot - Optional explicit path to the project root
 * @returns {string|null} The Linear team ID
 */
function getLinearTeamId(explicitRoot = null) {
	return getLinearTeam(explicitRoot).id;
}

/**
 * Gets the Linear project configuration with environment variable resolution
 * @param {string|null} explicitRoot - Optional explicit path to the project root
 * @returns {object} The project configuration object
 */
function getLinearProject(explicitRoot = null) {
	const linearConfig = getLinearConfig(explicitRoot);
	const project = linearConfig.project || { id: null, name: null };

	// Resolve environment variable for project ID if placeholder format is used
	if (
		typeof project.id === 'string' &&
		project.id.startsWith('${') &&
		project.id.endsWith('}')
	) {
		const envVarName = project.id.slice(2, -1); // Remove ${ and }
		project.id = process.env[envVarName] || null;
	}

	return project;
}

/**
 * Gets the Linear project ID
 * @param {string|null} explicitRoot - Optional explicit path to the project root
 * @returns {string|null} The Linear project ID
 */
function getLinearProjectId(explicitRoot = null) {
	return getLinearProject(explicitRoot).id;
}

/**
 * Checks if Linear integration is enabled
 * @param {string|null} explicitRoot - Optional explicit path to the project root
 * @returns {boolean} True if Linear integration is enabled
 */
function isLinearEnabled(explicitRoot = null) {
	const linearConfig = getLinearConfig(explicitRoot);
	return linearConfig.enabled === true;
}

/**
 * Checks if Linear auto-sync is enabled
 * @param {string|null} explicitRoot - Optional explicit path to the project root
 * @returns {boolean} True if auto-sync is enabled
 */
function isLinearAutoSyncEnabled(explicitRoot = null) {
	const linearConfig = getLinearConfig(explicitRoot);
	return linearConfig.sync?.autoSync === true;
}

/**
 * Checks if Linear subtask sync is enabled
 * @param {string|null} explicitRoot - Optional explicit path to the project root
 * @returns {boolean} True if subtask sync is enabled
 */
function isLinearSubtaskSyncEnabled(explicitRoot = null) {
	const linearConfig = getLinearConfig(explicitRoot);
	return linearConfig.sync?.syncSubtasks === true;
}

/**
 * Gets the Linear status mapping configuration
 * @param {string|null} explicitRoot - Optional explicit path to the project root
 * @returns {object} The status mapping object
 */
function getLinearStatusMapping(explicitRoot = null) {
	const linearConfig = getLinearConfig(explicitRoot);
	return (
		linearConfig.labels?.statusMapping ||
		DEFAULTS.integrations.linear.labels.statusMapping
	);
}

/**
 * Gets the Linear priority mapping configuration
 * @param {string|null} explicitRoot - Optional explicit path to the project root
 * @returns {object} The priority mapping object
 */
function getLinearPriorityMapping(explicitRoot = null) {
	const linearConfig = getLinearConfig(explicitRoot);
	return (
		linearConfig.labels?.priorityMapping ||
		DEFAULTS.integrations.linear.labels.priorityMapping
	);
}

/**
 * Gets the Linear sync settings
 * @param {string|null} explicitRoot - Optional explicit path to the project root
 * @returns {object} The sync settings object
 */
function getLinearSyncSettings(explicitRoot = null) {
	const linearConfig = getLinearConfig(explicitRoot);
	return linearConfig.sync || DEFAULTS.integrations.linear.sync;
}

/**
 * Gets the Linear status UUID mapping configuration
 * @param {string|null} explicitRoot - Optional explicit path to the project root
 * @returns {object} The status UUID mapping object
 */
function getLinearStatusUuidMapping(explicitRoot = null) {
	const linearConfig = getLinearConfig(explicitRoot);
	return linearConfig.mappings?.statusUuid || {};
}

/**
 * Sets the Linear status UUID mapping configuration
 * @param {object} uuidMapping - The UUID mapping object to set
 * @param {string|null} explicitRoot - Optional explicit path to the project root
 * @returns {boolean} True if successful
 */
function setLinearStatusUuidMapping(uuidMapping, explicitRoot = null) {
	try {
		const projectRoot = explicitRoot || findProjectRoot();
		const configPath = path.join(
			projectRoot,
			'.taskmaster',
			'linear-config.json'
		);

		// Read existing Linear config
		const config = fs.existsSync(configPath) ? readJSON(configPath) : {};

		// Ensure the structure exists
		if (!config.mappings) config.mappings = {};

		// Set the UUID mapping
		config.mappings.statusUuid = uuidMapping;

		// Write the updated config
		writeJSON(configPath, config, 2);

		// Clear cached config to force reload
		loadedConfig = null;
		loadedConfigRoot = null;

		return true;
	} catch (error) {
		log('error', `Failed to set Linear status UUID mapping: ${error.message}`);
		return false;
	}
}

/**
 * Gets the effective Linear status mapping (UUID preferred, falls back to name-based)
 * @param {string|null} explicitRoot - Optional explicit path to the project root
 * @returns {object} Object with {type: 'uuid'|'name', mapping: object}
 */
function getEffectiveLinearStatusMapping(explicitRoot = null) {
	const uuidMapping = getLinearStatusUuidMapping(explicitRoot);
	const nameMapping = getLinearStatusMapping(explicitRoot);

	// Check if UUID mapping has any actual UUIDs (not empty object)
	const hasUuidMappings = uuidMapping && Object.keys(uuidMapping).length > 0;

	if (hasUuidMappings) {
		return {
			type: 'uuid',
			mapping: uuidMapping
		};
	}

	return {
		type: 'name',
		mapping: nameMapping
	};
}

/**
 * Validates Linear status UUID mapping format
 * @param {object} uuidMapping - The UUID mapping object to validate
 * @returns {object} Validation result with {valid: boolean, errors: string[]}
 */
function validateLinearStatusUuidMapping(uuidMapping) {
	const errors = [];

	if (!uuidMapping || typeof uuidMapping !== 'object') {
		return { valid: false, errors: ['UUID mapping must be an object'] };
	}

	const validStatuses = [
		'pending',
		'in-progress',
		'review',
		'done',
		'cancelled',
		'deferred'
	];

	// Validate each status mapping
	for (const [status, uuid] of Object.entries(uuidMapping)) {
		// Check if status is valid
		if (!validStatuses.includes(status)) {
			errors.push(
				`Invalid TaskMaster status: "${status}". Valid statuses: ${validStatuses.join(', ')}`
			);
		}

		// Check if UUID is valid format
		if (!validateUuid(uuid)) {
			errors.push(`Invalid UUID format for status "${status}": "${uuid}"`);
		}
	}

	return {
		valid: errors.length === 0,
		errors
	};
}

/**
 * Generates UUID mapping from name mapping using Linear API resolution
 * @param {object} nameMapping - The name-based mapping to convert
 * @param {string} teamId - Linear team ID for API calls
 * @param {string|null} explicitRoot - Optional explicit path to the project root
 * @returns {Promise<object>} Result with {success: boolean, mapping?: object, errors?: string[]}
 */
async function generateLinearStatusUuidMapping(
	nameMapping,
	teamId,
	explicitRoot = null
) {
	try {
		// Import the Linear integration handler for UUID resolution
		const { LinearIntegrationHandler } = await import(
			'./integrations/linear-integration-handler.js'
		);

		const config = {
			apiKey: getLinearApiKey(explicitRoot),
			teamId: teamId
		};

		const handler = new LinearIntegrationHandler(config);
		await handler._performInitialization();

		const uuidMapping = {};
		const errors = [];

		// Generate UUID mappings for each status
		for (const [status, stateName] of Object.entries(nameMapping)) {
			try {
				const result = await handler.resolveTaskMasterStatusToLinearUUID(
					teamId,
					status
				);

				if (result.success) {
					uuidMapping[status] = result.uuid;
				} else {
					errors.push(
						`Failed to resolve "${status}" (${stateName}): ${result.error}`
					);
				}
			} catch (error) {
				errors.push(`Error resolving "${status}": ${error.message}`);
			}
		}

		return {
			success: errors.length === 0,
			mapping: uuidMapping,
			errors: errors.length > 0 ? errors : undefined
		};
	} catch (error) {
		return {
			success: false,
			errors: [`Failed to generate UUID mapping: ${error.message}`]
		};
	}
}

// --- Linear Configuration Validation ---

/**
 * Validates a Linear API key format
 * @param {string} apiKey - The API key to validate
 * @returns {boolean} True if the API key format is valid
 */
function validateLinearApiKey(apiKey) {
	if (!apiKey || typeof apiKey !== 'string') {
		return false;
	}

	// Linear API keys start with "lin_api_" and are typically ~48 characters
	return apiKey.startsWith('lin_api_') && apiKey.length >= 40;
}

/**
 * Validates a UUID format (for team and project IDs)
 * @param {string} uuid - The UUID to validate
 * @returns {boolean} True if the UUID format is valid
 */
function validateUuid(uuid) {
	if (!uuid || typeof uuid !== 'string') {
		return false;
	}

	const uuidRegex =
		/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
	return uuidRegex.test(uuid);
}

/**
 * Validates Linear team ID format
 * @param {string} teamId - The team ID to validate
 * @returns {boolean} True if the team ID format is valid
 */
function validateLinearTeamId(teamId) {
	return validateUuid(teamId);
}

/**
 * Validates Linear project ID format
 * @param {string} projectId - The project ID to validate
 * @returns {boolean} True if the project ID format is valid
 */
function validateLinearProjectId(projectId) {
	return validateUuid(projectId);
}

/**
 * Validates the entire Linear configuration
 * @param {object} linearConfig - The Linear configuration to validate
 * @returns {{valid: boolean, errors: string[]}} Validation result
 */
function validateLinearConfig(linearConfig) {
	const errors = [];

	if (!linearConfig || typeof linearConfig !== 'object') {
		errors.push('Linear configuration must be an object');
		return { valid: false, errors };
	}

	// Validate API key if provided
	if (linearConfig.apiKey && !validateLinearApiKey(linearConfig.apiKey)) {
		// Only validate format if it's not an environment variable placeholder
		if (!linearConfig.apiKey.startsWith('${')) {
			errors.push('Linear API key format is invalid');
		}
	}

	// Validate team ID if provided
	if (linearConfig.team?.id && !validateLinearTeamId(linearConfig.team.id)) {
		errors.push('Linear team ID format is invalid');
	}

	// Validate project ID if provided
	if (
		linearConfig.project?.id &&
		!validateLinearProjectId(linearConfig.project.id)
	) {
		errors.push('Linear project ID format is invalid');
	}

	// Validate sync settings
	if (linearConfig.sync) {
		const { batchSize, retryAttempts, retryDelay } = linearConfig.sync;

		if (
			batchSize !== undefined &&
			(typeof batchSize !== 'number' || batchSize < 1 || batchSize > 50)
		) {
			errors.push('Linear sync batchSize must be a number between 1 and 50');
		}

		if (
			retryAttempts !== undefined &&
			(typeof retryAttempts !== 'number' ||
				retryAttempts < 1 ||
				retryAttempts > 10)
		) {
			errors.push(
				'Linear sync retryAttempts must be a number between 1 and 10'
			);
		}

		if (
			retryDelay !== undefined &&
			(typeof retryDelay !== 'number' || retryDelay < 100 || retryDelay > 5000)
		) {
			errors.push(
				'Linear sync retryDelay must be a number between 100 and 5000 milliseconds'
			);
		}
	}

	return { valid: errors.length === 0, errors };
}

// --- Deprecation and Warning Helper Functions ---

/**
 * Shows deprecation warnings for configuration
 * @param {object} config - Configuration object
 * @param {string} configPath - Path to configuration file
 * @param {boolean} isLegacy - Whether using legacy config location
 */
function _showDeprecationWarnings(config, configPath, isLegacy) {
	// Legacy configuration file warning (already handled above, but adding context)
	if (isLegacy) {
		// Additional context for legacy users
		console.warn(
			chalk.yellow(
				'💡 Tip: Run "task-master migrate" to automatically move to the new .taskmaster/ structure'
			)
		);
	}

	// Deprecated model IDs
	const deprecatedModels = {
		'claude-3-sonnet-20240229': 'claude-3-5-sonnet or claude-3-7-sonnet',
		'claude-3-opus-20240229': 'claude-3-5-sonnet or claude-3-7-sonnet',
		'gpt-3.5-turbo': 'gpt-4 or gpt-4-turbo',
		'text-davinci-003': 'gpt-4 or gpt-4-turbo'
	};

	['main', 'research', 'fallback'].forEach((role) => {
		const modelId = config.models?.[role]?.modelId;
		if (modelId && deprecatedModels[modelId]) {
			console.warn(
				chalk.yellow(
					`⚠️  DEPRECATION: Model "${modelId}" for ${role} role is deprecated. Consider upgrading to: ${deprecatedModels[modelId]}`
				)
			);
		}
	});

	// Deprecated configuration fields
	if (config.global?.defaultNumTasks) {
		console.warn(
			chalk.yellow(
				'⚠️  DEPRECATION: "defaultNumTasks" is deprecated. Use "defaultSubtasks" instead'
			)
		);
	}

	// Check for old Linear configuration format
	if (config.linear && !config.integrations?.linear) {
		console.warn(
			chalk.yellow(
				'⚠️  DEPRECATION: Linear configuration should be moved to "integrations.linear" section'
			)
		);
	}
}

/**
 * Shows configuration warnings and suggestions
 * @param {object} config - Configuration object
 * @param {string} projectRoot - Project root directory
 */
function _showConfigurationWarnings(config, projectRoot) {
	// Performance warnings
	if (config.models?.main?.maxTokens > 100000) {
		console.warn(
			chalk.yellow(
				`⚠️  Performance: Large maxTokens (${config.models.main.maxTokens}) may impact response speed and cost`
			)
		);
	}

	// Security warnings
	['models', 'integrations'].forEach((section) => {
		if (config[section]) {
			_checkForHardcodedSecrets(config[section], section);
		}
	});

	// Linear configuration warnings
	if (config.integrations?.linear?.enabled) {
		const linear = config.integrations.linear;

		// Missing team/project warnings
		if (!linear.team?.id) {
			console.warn(
				chalk.yellow(
					'⚠️  Linear: Team ID not configured. Some Linear features may not work correctly'
				)
			);
		}

		if (!linear.project?.id) {
			console.warn(
				chalk.yellow(
					'⚠️  Linear: Project ID not configured. Task synchronization may be limited'
				)
			);
		}

		// Performance warnings for Linear
		if (linear.sync?.batchSize > 25) {
			console.warn(
				chalk.yellow(
					`⚠️  Linear: Large batch size (${linear.sync.batchSize}) may hit API rate limits. Consider 10-25`
				)
			);
		}

		if (linear.sync?.retryDelay < 500) {
			console.warn(
				chalk.yellow(
					`⚠️  Linear: Low retry delay (${linear.sync.retryDelay}ms) may trigger rate limiting`
				)
			);
		}
	}

	// Same provider for main and fallback warning
	if (config.models?.main?.provider && config.models?.fallback?.provider) {
		if (
			config.models.main.provider === config.models.fallback.provider &&
			config.models.main.modelId === config.models.fallback.modelId
		) {
			console.warn(
				chalk.yellow(
					'⚠️  Configuration: Fallback model is identical to main model. Consider using a different model for better resilience'
				)
			);
		}
	}

	// Environment variable suggestions
	if (config.integrations?.linear?.enabled) {
		const hasLinearKey =
			process.env.LINEAR_API_KEY || process.env.TASKMASTER_LINEAR_API_KEY;
		if (!hasLinearKey) {
			console.warn(
				chalk.yellow(
					'💡 Tip: Set LINEAR_API_KEY environment variable for Linear integration'
				)
			);
		}
	}
}

/**
 * Checks for hardcoded secrets in configuration
 * @param {object} obj - Object to check
 * @param {string} section - Section name for context
 * @param {string} path - Current path in object
 */
function _checkForHardcodedSecrets(obj, section, path = '') {
	for (const [key, value] of Object.entries(obj)) {
		const currentPath = path ? `${path}.${key}` : key;

		if (typeof value === 'string') {
			// Check for potential hardcoded API keys
			if (
				key.toLowerCase().includes('key') ||
				key.toLowerCase().includes('secret')
			) {
				if (
					!value.startsWith('${') &&
					value.length > 20 &&
					!/^YOUR_.*_HERE$/.test(value)
				) {
					console.warn(
						chalk.red(
							`🚨 SECURITY WARNING: Potential hardcoded API key detected in ${section}.${currentPath}. Use environment variable placeholders instead!`
						)
					);
				}
			}

			// Check for old placeholder patterns
			if (value.includes('YOUR_') && value.includes('_HERE')) {
				console.warn(
					chalk.yellow(
						`💡 Tip: Replace placeholder "${value}" in ${section}.${currentPath} with actual environment variable`
					)
				);
			}
		} else if (typeof value === 'object' && value !== null) {
			_checkForHardcodedSecrets(value, section, currentPath);
		}
	}
}

/**
 * Validates complete configuration using comprehensive validation utilities
 * @param {object} config - Configuration to validate
 * @param {object} options - Validation options
 * @returns {object} Validation result with errors, warnings, and suggestions
 */
async function validateCompleteConfig(config, options = {}) {
	const { projectRoot = null, strict = false, showWarnings = true } = options;

	try {
		// Import validation utilities dynamically to avoid circular dependencies
		const validationModule = await import('./validation/index.js');
		const { validateConfig, formatValidationErrors } = validationModule;

		const validationResult = validateConfig(config, {
			projectRoot,
			strict,
			checkEnvironment: true
		});

		// Format and display warnings if requested
		if (showWarnings && validationResult.hasAnyIssues()) {
			const formatted = formatValidationErrors(validationResult, {
				includeWarnings: true,
				includeSuggestions: true,
				colorize: true
			});
			console.log(formatted);
		}

		return validationResult;
	} catch (error) {
		// Fallback to basic validation if comprehensive validation fails
		log(
			'debug',
			`Comprehensive validation failed: ${error.message}, using basic validation`
		);
		return { valid: true, errors: [], warnings: [], suggestions: [] };
	}
}

export {
	// Core config access
	getConfig,
	writeConfig,
	ConfigurationError,
	isConfigFilePresent,
	// Validation
	validateProvider,
	validateProviderModelCombination,
	VALID_PROVIDERS,
	MODEL_MAP,
	getAvailableModels,
	// Role-specific getters (No env var overrides)
	getMainProvider,
	getMainModelId,
	getMainMaxTokens,
	getMainTemperature,
	getResearchProvider,
	getResearchModelId,
	getResearchMaxTokens,
	getResearchTemperature,
	getFallbackProvider,
	getFallbackModelId,
	getFallbackMaxTokens,
	getFallbackTemperature,
	getBaseUrlForRole,
	// Global setting getters (No env var overrides)
	getLogLevel,
	getDebugFlag,
	getDefaultNumTasks,
	getDefaultSubtasks,
	getDefaultPriority,
	getProjectName,
	getOllamaBaseURL,
	getAzureBaseURL,
	getBedrockBaseURL,
	getParametersForRole,
	getUserId,
	// API Key Checkers (still relevant)
	isApiKeySet,
	getMcpApiKeyStatus,
	// ADD: Function to get all provider names
	getAllProviders,
	getVertexProjectId,
	getVertexLocation,
	// Linear Integration Configuration
	getLinearConfig,
	getLinearApiKey,
	getLinearTeam,
	getLinearTeamId,
	getLinearProject,
	getLinearProjectId,
	isLinearEnabled,
	isLinearAutoSyncEnabled,
	isLinearSubtaskSyncEnabled,
	getLinearStatusMapping,
	getLinearPriorityMapping,
	getLinearSyncSettings,
	getLinearStatusUuidMapping,
	setLinearStatusUuidMapping,
	getEffectiveLinearStatusMapping,
	// Linear Configuration Validation
	validateLinearStatusUuidMapping,
	generateLinearStatusUuidMapping,
	validateLinearApiKey,
	validateLinearTeamId,
	validateLinearProjectId,
	validateLinearConfig,
	// Enhanced Configuration Validation
	validateCompleteConfig
};
