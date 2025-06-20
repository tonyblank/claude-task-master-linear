/**
 * Zod validation schemas for TaskMaster configuration
 */

import { z } from 'zod';

// Common validation patterns
const UUID_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LINEAR_API_KEY_REGEX = /^lin_api_[a-zA-Z0-9]{32,}$/;
const ENV_VAR_PLACEHOLDER_REGEX = /^\$\{[A-Z_][A-Z0-9_]*\}$/;

// Custom validators
const envVarOrString = z
	.string()
	.refine((val) => ENV_VAR_PLACEHOLDER_REGEX.test(val) || val.length > 0, {
		message:
			'Must be a valid environment variable placeholder or non-empty string'
	});

const urlSchema = z
	.string()
	.url()
	.or(z.string().regex(/^https?:\/\/.+/));

const uuidSchema = z
	.string()
	.uuid()
	.or(z.string().regex(UUID_REGEX, 'Must be a valid UUID format'));

const linearApiKeySchema = z.string().refine(
	(val) => {
		if (ENV_VAR_PLACEHOLDER_REGEX.test(val)) return true;
		return LINEAR_API_KEY_REGEX.test(val);
	},
	{
		message:
			'Must be a valid Linear API key format (lin_api_...) or environment variable placeholder'
	}
);

// Provider validation
const validProviders = [
	'anthropic',
	'openai',
	'google',
	'perplexity',
	'mistral',
	'azure',
	'openrouter',
	'xai',
	'vertex',
	'ollama',
	'bedrock'
];

const providerSchema = z.enum(validProviders, {
	errorMap: () => ({ message: `Must be one of: ${validProviders.join(', ')}` })
});

// Model configuration schema
const modelConfigSchema = z.object({
	provider: providerSchema,
	modelId: z.string().min(1, 'Model ID cannot be empty'),
	maxTokens: z.number().int().min(1).max(200000).default(64000),
	temperature: z.number().min(0).max(2).default(0.2),
	baseURL: z.string().url().optional()
});

// Models configuration schema
export const MODELS_CONFIG_SCHEMA = z.object({
	main: modelConfigSchema,
	research: modelConfigSchema,
	fallback: modelConfigSchema.optional()
});

// Global configuration schema
export const GLOBAL_CONFIG_SCHEMA = z.object({
	logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
	debug: z.boolean().default(false),
	defaultSubtasks: z.number().int().min(1).max(50).default(5),
	defaultPriority: z.enum(['high', 'medium', 'low']).default('medium'),
	defaultTag: z.string().default('master'),
	projectName: z.string().default('Task Master'),
	ollamaBaseURL: urlSchema.default('http://localhost:11434/api'),
	azureBaseURL: urlSchema.optional(),
	bedrockBaseURL: urlSchema.optional(),
	vertexProjectId: z.string().optional(),
	vertexLocation: z.string().default('us-central1'),
	userId: z.string().optional()
});

// Linear integration configuration schema
export const LINEAR_CONFIG_SCHEMA = z.object({
	enabled: z.boolean().default(false),
	apiKey: linearApiKeySchema.default('${LINEAR_API_KEY}'),
	team: z
		.object({
			id: uuidSchema.nullable().default(null),
			name: z.string().nullable().default(null)
		})
		.default({}),
	project: z
		.object({
			id: uuidSchema.nullable().default(null),
			name: z.string().nullable().default(null)
		})
		.default({}),
	labels: z
		.object({
			enabled: z.boolean().default(true),
			sourceLabel: z.string().default('taskmaster'),
			priorityMapping: z.record(z.string(), z.string()).default({
				high: 'High Priority',
				medium: 'Medium Priority',
				low: 'Low Priority'
			}),
			statusMapping: z.record(z.string(), z.string()).default({
				pending: 'Todo',
				'in-progress': 'In Progress',
				review: 'In Review',
				done: 'Done',
				cancelled: 'Cancelled',
				deferred: 'Backlog'
			})
		})
		.default({}),
	sync: z
		.object({
			autoSync: z.boolean().default(true),
			syncOnStatusChange: z.boolean().default(true),
			syncSubtasks: z.boolean().default(true),
			syncDependencies: z.boolean().default(true),
			batchSize: z.number().int().min(1).max(50).default(10),
			retryAttempts: z.number().int().min(1).max(10).default(3),
			retryDelay: z.number().int().min(100).max(10000).default(1000)
		})
		.default({}),
	webhooks: z
		.object({
			enabled: z.boolean().default(false),
			url: urlSchema.nullable().default(null),
			secret: z.string().nullable().default(null)
		})
		.default({})
});

// Integrations configuration schema
const INTEGRATIONS_CONFIG_SCHEMA = z.object({
	linear: LINEAR_CONFIG_SCHEMA.default({})
});

// Full configuration schema
export const FULL_CONFIG_SCHEMA = z.object({
	models: MODELS_CONFIG_SCHEMA,
	global: GLOBAL_CONFIG_SCHEMA.default({}),
	integrations: INTEGRATIONS_CONFIG_SCHEMA.default({})
});

// Export individual schemas for specific use cases
export const MINIMAL_CONFIG_SCHEMA = z.object({
	models: z.object({
		main: z.object({
			provider: providerSchema,
			modelId: z.string().min(1)
		})
	})
});

// Strict schemas (no defaults, all fields required)
export const STRICT_LINEAR_CONFIG_SCHEMA = LINEAR_CONFIG_SCHEMA.required({
	enabled: true,
	apiKey: true,
	team: true,
	project: true
});

export const STRICT_MODELS_CONFIG_SCHEMA = MODELS_CONFIG_SCHEMA.required({
	main: true,
	research: true
});

// Schema for configuration updates (partial updates allowed)
export const CONFIG_UPDATE_SCHEMA = FULL_CONFIG_SCHEMA.partial().refine(
	(data) => Object.keys(data).length > 0,
	{ message: 'At least one configuration field must be provided for update' }
);

// Schema for configuration validation options
export const VALIDATION_OPTIONS_SCHEMA = z.object({
	projectRoot: z.string().optional(),
	strict: z.boolean().default(false),
	checkEnvironment: z.boolean().default(true),
	validateConnections: z.boolean().default(false)
});

// Schema for environment variables validation
export const ENV_VARS_SCHEMA = z.object({
	// AI Provider API Keys
	ANTHROPIC_API_KEY: z.string().min(1).optional(),
	OPENAI_API_KEY: z.string().min(1).optional(),
	GOOGLE_API_KEY: z.string().min(1).optional(),
	PERPLEXITY_API_KEY: z.string().min(1).optional(),
	MISTRAL_API_KEY: z.string().min(1).optional(),
	AZURE_OPENAI_API_KEY: z.string().min(1).optional(),
	OPENROUTER_API_KEY: z.string().min(1).optional(),
	XAI_API_KEY: z.string().min(1).optional(),

	// Integration API Keys
	LINEAR_API_KEY: linearApiKeySchema.optional(),
	GITHUB_API_KEY: z.string().min(1).optional(),

	// Service Configuration
	AZURE_OPENAI_ENDPOINT: urlSchema.optional(),
	OLLAMA_BASE_URL: urlSchema.optional(),
	VERTEX_PROJECT_ID: z.string().min(1).optional(),
	VERTEX_LOCATION: z.string().default('us-central1').optional(),
	GOOGLE_APPLICATION_CREDENTIALS: z.string().min(1).optional()
});

// Helper function to create custom schemas
export function createCustomSchema(options = {}) {
	const {
		includeLinear = true,
		includeDefaults = true,
		strict = false,
		requireMainModel = true
	} = options;

	let schema = z.object({
		models: requireMainModel
			? MODELS_CONFIG_SCHEMA.required({ main: true })
			: MODELS_CONFIG_SCHEMA,
		global: includeDefaults
			? GLOBAL_CONFIG_SCHEMA
			: GLOBAL_CONFIG_SCHEMA.partial()
	});

	if (includeLinear) {
		schema = schema.extend({
			integrations: z.object({
				linear: includeDefaults
					? LINEAR_CONFIG_SCHEMA
					: LINEAR_CONFIG_SCHEMA.partial()
			})
		});
	}

	return strict ? schema.strict() : schema;
}

// Schema for specific validation contexts
export const MCP_CONFIG_SCHEMA = z.object({
	models: MODELS_CONFIG_SCHEMA.required({ main: true }),
	global: GLOBAL_CONFIG_SCHEMA.pick({
		logLevel: true,
		debug: true,
		projectName: true
	}),
	integrations: z
		.object({
			linear: LINEAR_CONFIG_SCHEMA.partial()
		})
		.optional()
});

export const CLI_CONFIG_SCHEMA = FULL_CONFIG_SCHEMA;

export const PRODUCTION_CONFIG_SCHEMA = FULL_CONFIG_SCHEMA.strict().refine(
	(config) => {
		// Additional production validations
		if (config.integrations?.linear?.enabled) {
			return (
				config.integrations.linear.team?.id &&
				config.integrations.linear.project?.id
			);
		}
		return true;
	},
	{
		message:
			'Production configuration requires complete Linear setup when enabled'
	}
);
