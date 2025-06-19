/**
 * Configuration Validation Utilities
 *
 * This module provides comprehensive validation for TaskMaster configuration,
 * including schema validation, business rule validation, and clear error reporting.
 */

export {
	validateConfig,
	validateLinearConnection,
	validateEnvironmentSetup,
	createConfigSchema,
	ValidationResult,
	ValidationError,
	ConfigurationError
} from './validators.js';

export {
	sanitizeConfigInput,
	normalizeConfig,
	cleanConfigObject
} from './sanitizers.js';

export {
	formatValidationErrors,
	formatValidationWarnings,
	createDetailedErrorMessage
} from './formatters.js';

export {
	LINEAR_CONFIG_SCHEMA,
	GLOBAL_CONFIG_SCHEMA,
	MODELS_CONFIG_SCHEMA,
	FULL_CONFIG_SCHEMA
} from './schemas.js';
