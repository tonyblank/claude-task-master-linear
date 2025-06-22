/**
 * @fileoverview Backward Compatibility Utilities
 *
 * This module provides utilities for maintaining backward compatibility
 * with older event payload formats while transitioning to the new
 * standardized schema system.
 */

import { SCHEMA_VERSION, getEventPayloadSchema } from './payload-schemas.js';
import { log } from '../utils.js';

/**
 * Legacy schema versions and their transformations
 */
export const LEGACY_VERSIONS = {
	'0.1.0': 'pre-schema', // Original format before standardization
	'0.9.0': 'beta-schema' // Beta version with partial schema support
};

/**
 * Migration strategies for different version upgrades
 */
const MIGRATION_STRATEGIES = {
	'pre-schema-to-1.0.0': migratePreSchemaTo100,
	'beta-schema-to-1.0.0': migrateBetaSchemaTo100
};

/**
 * Migrate an event payload to the current schema version
 *
 * @param {Object} payload - Event payload to migrate
 * @param {string} fromVersion - Source version (optional, will be detected)
 * @returns {Object} Migration result
 */
export function migrateEventPayload(payload, fromVersion = null) {
	// Handle null or undefined payload at the top level
	if (
		!payload ||
		(typeof payload !== 'object' && typeof payload !== 'string')
	) {
		return {
			success: false,
			payload,
			migrated: false,
			error: 'Invalid payload: payload must be an object',
			fromVersion: 'unknown',
			toVersion: SCHEMA_VERSION
		};
	}

	const detectedVersion = fromVersion || detectPayloadVersion(payload);
	const migrationStrategy = getMigrationStrategy(
		detectedVersion,
		SCHEMA_VERSION
	);

	if (!migrationStrategy) {
		return {
			success: true,
			payload,
			migrated: false,
			message: `No migration needed from ${detectedVersion} to ${SCHEMA_VERSION}`
		};
	}

	try {
		const migratedPayload = migrationStrategy(payload);

		log(
			'debug',
			`Migrated payload from ${detectedVersion} to ${SCHEMA_VERSION}`
		);

		return {
			success: true,
			payload: migratedPayload,
			migrated: true,
			fromVersion: detectedVersion,
			toVersion: SCHEMA_VERSION,
			message: `Successfully migrated from ${detectedVersion} to ${SCHEMA_VERSION}`
		};
	} catch (error) {
		log(
			'error',
			`Migration failed from ${detectedVersion} to ${SCHEMA_VERSION}:`,
			error.message
		);

		return {
			success: false,
			payload,
			migrated: false,
			error: error.message,
			fromVersion: detectedVersion,
			toVersion: SCHEMA_VERSION
		};
	}
}

/**
 * Detect the version of an event payload
 *
 * @param {Object} payload - Event payload
 * @returns {string} Detected version
 */
export function detectPayloadVersion(payload) {
	// Handle null or undefined payload
	if (!payload || typeof payload !== 'object') {
		return LEGACY_VERSIONS['0.1.0'];
	}

	// Check for explicit version field
	if (payload.version) {
		return payload.version;
	}

	// Check for schema version in serialization metadata
	if (payload._serialization?.schemaVersion) {
		return payload._serialization.schemaVersion;
	}

	// Check for legacy format indicators
	if (payload.type && payload.payload) {
		// This is the wrapped format from pre-schema days
		return LEGACY_VERSIONS['0.1.0'];
	}

	// Check for beta schema indicators
	if (payload.eventId && !payload.version) {
		return LEGACY_VERSIONS['0.9.0'];
	}

	// Default to current version if structure looks modern
	if (payload.timestamp && payload.context) {
		return SCHEMA_VERSION;
	}

	// Unknown format, assume pre-schema
	return LEGACY_VERSIONS['0.1.0'];
}

/**
 * Get migration strategy for version transition
 *
 * @param {string} fromVersion - Source version
 * @param {string} toVersion - Target version
 * @returns {Function|null} Migration function or null
 */
function getMigrationStrategy(fromVersion, toVersion) {
	const strategyKey = `${fromVersion}-to-${toVersion}`;

	if (MIGRATION_STRATEGIES[strategyKey]) {
		return MIGRATION_STRATEGIES[strategyKey];
	}

	// Try to find a path through intermediate versions
	for (const [key, strategy] of Object.entries(MIGRATION_STRATEGIES)) {
		if (key.startsWith(fromVersion + '-to-')) {
			return strategy;
		}
	}

	return null;
}

/**
 * Migrate from pre-schema format to 1.0.0
 *
 * @param {Object} payload - Legacy payload
 * @returns {Object} Migrated payload
 */
function migratePreSchemaTo100(payload) {
	// Handle null or invalid payload
	if (!payload || typeof payload !== 'object') {
		throw new Error('Invalid payload for migration');
	}

	// Handle wrapped format: { type: 'event:type', payload: {...} }
	if (payload.type && payload.payload) {
		const eventType = payload.type;
		const eventData = payload.payload;

		// Validate that eventData is an object
		if (!eventData || typeof eventData !== 'object') {
			throw new Error('Invalid event data in wrapped payload');
		}

		return {
			version: SCHEMA_VERSION,
			eventId: generateEventId(),
			timestamp: eventData.timestamp || new Date().toISOString(),
			context: eventData.context || createLegacyContext(),
			...extractEventSpecificData(eventType, eventData)
		};
	}

	// Handle direct format (already unwrapped)
	return {
		version: SCHEMA_VERSION,
		eventId: generateEventId(),
		timestamp: payload.timestamp || new Date().toISOString(),
		context: payload.context || createLegacyContext(),
		...payload
	};
}

/**
 * Migrate from beta schema format to 1.0.0
 *
 * @param {Object} payload - Beta payload
 * @returns {Object} Migrated payload
 */
function migrateBetaSchemaTo100(payload) {
	return {
		...payload,
		version: SCHEMA_VERSION,
		// Add any missing required fields for 1.0.0
		eventId: payload.eventId || generateEventId(),
		metadata: payload.metadata || {}
	};
}

/**
 * Extract event-specific data from legacy payload
 *
 * @param {string} eventType - Event type
 * @param {Object} eventData - Event data
 * @returns {Object} Extracted data
 */
function extractEventSpecificData(eventType, eventData) {
	const extracted = { ...eventData };

	// Remove standard fields that are now top-level
	extracted.timestamp = undefined;
	extracted.context = undefined;

	// Apply event-type specific transformations
	switch (eventType) {
		case 'task:created':
			return {
				taskId: extracted.taskId || extracted.id,
				task: extracted.task,
				tag: extracted.tag || 'master'
			};

		case 'task:updated':
			return {
				taskId: extracted.taskId || extracted.id,
				task: extracted.task,
				changes: extracted.changes || {},
				oldValues: extracted.oldValues || {},
				tag: extracted.tag || 'master'
			};

		case 'task:status:changed':
			return {
				taskId: extracted.taskId || extracted.id,
				task: extracted.task,
				oldStatus: extracted.oldStatus,
				newStatus: extracted.newStatus,
				tag: extracted.tag || 'master'
			};

		default:
			return extracted;
	}
}

/**
 * Create a legacy-compatible context for old payloads
 *
 * @returns {Object} Legacy context
 */
function createLegacyContext() {
	return {
		projectRoot: process.cwd(),
		session: {},
		source: 'legacy',
		requestId: `legacy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
	};
}

/**
 * Generate a unique event ID
 *
 * @returns {string} Event ID
 */
function generateEventId() {
	return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Check if a payload needs migration
 *
 * @param {Object} payload - Event payload
 * @returns {boolean} True if migration is needed
 */
export function needsMigration(payload) {
	const version = detectPayloadVersion(payload);
	return version !== SCHEMA_VERSION;
}

/**
 * Validate that a migrated payload conforms to current schema
 *
 * @param {string} eventType - Event type
 * @param {Object} payload - Migrated payload
 * @returns {Object} Validation result
 */
export function validateMigratedPayload(eventType, payload) {
	try {
		const schema = getEventPayloadSchema(eventType);

		if (!schema) {
			return {
				valid: true,
				warnings: [`No schema available for event type: ${eventType}`]
			};
		}

		const result = schema.safeParse(payload);

		if (result.success) {
			return { valid: true };
		} else {
			return {
				valid: false,
				errors: result.error.errors.map(
					(err) => `${err.path.join('.')}: ${err.message}`
				)
			};
		}
	} catch (error) {
		return {
			valid: false,
			errors: [`Validation error: ${error.message}`]
		};
	}
}

/**
 * Create a compatibility wrapper for old integrations
 *
 * @param {Object} payload - Modern payload
 * @param {string} targetVersion - Target legacy version
 * @returns {Object} Legacy-compatible payload
 */
export function createLegacyCompatiblePayload(
	payload,
	targetVersion = LEGACY_VERSIONS['0.1.0']
) {
	switch (targetVersion) {
		case LEGACY_VERSIONS['0.1.0']: {
			// Convert back to wrapped format for pre-schema integrations
			const { version, eventId, timestamp, context, ...eventData } = payload;

			return {
				type: extractEventTypeFromPayload(payload),
				payload: {
					...eventData,
					timestamp,
					context
				}
			};
		}

		case LEGACY_VERSIONS['0.9.0']: {
			// Remove version field for beta compatibility
			const { version: v, ...betaPayload } = payload;
			return betaPayload;
		}

		default:
			return payload;
	}
}

/**
 * Extract event type from a standardized payload
 *
 * @param {Object} payload - Standardized payload
 * @returns {string} Event type
 */
function extractEventTypeFromPayload(payload) {
	// Try to determine event type from payload structure
	if (payload.taskId && payload.task) {
		if (payload.oldStatus && payload.newStatus) {
			return 'task:status:changed';
		} else if (payload.changes) {
			return 'task:updated';
		} else {
			return 'task:created';
		}
	}

	if (payload.subtaskId && payload.parentTaskId) {
		if (payload.oldStatus && payload.newStatus) {
			return 'subtask:status:changed';
		} else if (payload.changes) {
			return 'subtask:updated';
		} else {
			return 'subtask:created';
		}
	}

	// Fallback to generic event type
	return 'unknown:event';
}

/**
 * Get all supported legacy versions
 *
 * @returns {Object} Legacy versions map
 */
export function getSupportedLegacyVersions() {
	return { ...LEGACY_VERSIONS };
}

/**
 * Get compatibility information for the current schema
 *
 * @returns {Object} Compatibility information
 */
export function getCompatibilityInfo() {
	return {
		currentVersion: SCHEMA_VERSION,
		supportedLegacyVersions: Object.values(LEGACY_VERSIONS),
		migrationStrategies: Object.keys(MIGRATION_STRATEGIES),
		backwardCompatible: true,
		forwardCompatible: false
	};
}
