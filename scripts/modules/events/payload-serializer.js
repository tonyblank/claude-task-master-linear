/**
 * @fileoverview Event Payload Serialization and Deserialization
 *
 * This module provides utilities for serializing and deserializing event payloads
 * with support for multiple formats, compression, and backward compatibility.
 */

import {
	getEventPayloadSchema,
	hasEventPayloadSchema,
	SCHEMA_VERSION,
	getSchemaVersionInfo
} from './payload-schemas.js';
import { log } from '../utils.js';

/**
 * Supported serialization formats
 */
export const SERIALIZATION_FORMATS = {
	JSON: 'json',
	JSON_COMPACT: 'json-compact',
	BINARY: 'binary'
};

/**
 * Compression algorithms
 */
export const COMPRESSION_ALGORITHMS = {
	NONE: 'none',
	GZIP: 'gzip',
	DEFLATE: 'deflate'
};

/**
 * Default serialization options
 */
const DEFAULT_SERIALIZATION_OPTIONS = {
	format: SERIALIZATION_FORMATS.JSON,
	compression: COMPRESSION_ALGORITHMS.NONE,
	validate: true,
	includeMetadata: true,
	preserveTypes: true,
	prettyPrint: false
};

/**
 * Event payload serializer class
 */
export class EventPayloadSerializer {
	/**
	 * @param {Object} options - Serializer configuration
	 */
	constructor(options = {}) {
		this.options = {
			...DEFAULT_SERIALIZATION_OPTIONS,
			...options
		};

		this.stats = {
			serialized: 0,
			deserialized: 0,
			validationErrors: 0,
			compressionSavings: 0
		};
	}

	/**
	 * Serialize an event payload
	 *
	 * @param {string} eventType - Event type
	 * @param {Object} payload - Event payload to serialize
	 * @param {Object} options - Serialization options
	 * @returns {Promise<Object>} Serialization result
	 */
	async serialize(eventType, payload, options = {}) {
		const serializeOptions = { ...this.options, ...options };
		const startTime = Date.now();

		try {
			// Validate payload if requested
			if (serializeOptions.validate) {
				const validationResult = this.validatePayload(eventType, payload);
				if (!validationResult.valid) {
					throw new Error(
						`Payload validation failed: ${validationResult.errors.join(', ')}`
					);
				}
			}

			// Prepare payload for serialization
			let processedPayload = await this._preparePayload(
				payload,
				serializeOptions
			);

			// Add serialization metadata
			if (serializeOptions.includeMetadata) {
				processedPayload = this._addSerializationMetadata(
					processedPayload,
					eventType,
					serializeOptions
				);
			}

			// Serialize based on format
			let serializedData;
			switch (serializeOptions.format) {
				case SERIALIZATION_FORMATS.JSON:
					serializedData = this._serializeJSON(
						processedPayload,
						serializeOptions
					);
					break;
				case SERIALIZATION_FORMATS.JSON_COMPACT:
					serializedData = this._serializeJSONCompact(processedPayload);
					break;
				case SERIALIZATION_FORMATS.BINARY:
					serializedData = await this._serializeBinary(processedPayload);
					break;
				default:
					throw new Error(
						`Unsupported serialization format: ${serializeOptions.format}`
					);
			}

			// Apply compression if requested
			if (serializeOptions.compression !== COMPRESSION_ALGORITHMS.NONE) {
				serializedData = await this._compressData(
					serializedData,
					serializeOptions.compression
				);
			}

			const executionTime = Date.now() - startTime;
			this.stats.serialized++;

			return {
				success: true,
				data: serializedData,
				metadata: {
					eventType,
					format: serializeOptions.format,
					compression: serializeOptions.compression,
					size: this._getDataSize(serializedData),
					executionTime,
					schemaVersion: SCHEMA_VERSION
				}
			};
		} catch (error) {
			log(
				'error',
				`Serialization failed for event ${eventType}:`,
				error.message
			);
			return {
				success: false,
				error: error.message,
				metadata: {
					eventType,
					executionTime: Date.now() - startTime
				}
			};
		}
	}

	/**
	 * Deserialize an event payload
	 *
	 * @param {any} data - Serialized data
	 * @param {Object} options - Deserialization options
	 * @returns {Promise<Object>} Deserialization result
	 */
	async deserialize(data, options = {}) {
		const deserializeOptions = { ...this.options, ...options };
		const startTime = Date.now();

		try {
			let processedData = data;

			// Extract metadata if present
			const metadata = this._extractMetadata(data);

			// Decompress if needed
			if (
				metadata?.compression &&
				metadata.compression !== COMPRESSION_ALGORITHMS.NONE
			) {
				processedData = await this._decompressData(
					processedData,
					metadata.compression
				);
			}

			// Deserialize based on format
			let payload;
			const format = metadata?.format || deserializeOptions.format;

			switch (format) {
				case SERIALIZATION_FORMATS.JSON:
				case SERIALIZATION_FORMATS.JSON_COMPACT:
					payload = this._deserializeJSON(processedData);
					break;
				case SERIALIZATION_FORMATS.BINARY:
					payload = await this._deserializeBinary(processedData);
					break;
				default:
					throw new Error(`Unsupported deserialization format: ${format}`);
			}

			// Restore types if needed
			if (deserializeOptions.preserveTypes) {
				payload = this._restoreTypes(payload);
			}

			// Validate if requested and schema is available
			if (deserializeOptions.validate && metadata?.eventType) {
				const validationResult = this.validatePayload(
					metadata.eventType,
					payload
				);
				if (!validationResult.valid) {
					log(
						'warn',
						`Deserialized payload validation failed: ${validationResult.errors.join(', ')}`
					);
				}
			}

			const executionTime = Date.now() - startTime;
			this.stats.deserialized++;

			return {
				success: true,
				payload,
				metadata: {
					...metadata,
					executionTime,
					size: this._getDataSize(data)
				}
			};
		} catch (error) {
			log('error', 'Deserialization failed:', error.message);
			return {
				success: false,
				error: error.message,
				metadata: {
					executionTime: Date.now() - startTime
				}
			};
		}
	}

	/**
	 * Validate an event payload against its schema
	 *
	 * @param {string} eventType - Event type
	 * @param {Object} payload - Payload to validate
	 * @returns {Object} Validation result
	 */
	validatePayload(eventType, payload) {
		if (!hasEventPayloadSchema(eventType)) {
			return {
				valid: true,
				warnings: [`No schema defined for event type: ${eventType}`]
			};
		}

		try {
			const schema = getEventPayloadSchema(eventType);
			const result = schema.safeParse(payload);

			if (result.success) {
				return { valid: true };
			} else {
				this.stats.validationErrors++;
				return {
					valid: false,
					errors: result.error.errors.map(
						(err) => `${err.path.join('.')}: ${err.message}`
					)
				};
			}
		} catch (error) {
			this.stats.validationErrors++;
			return {
				valid: false,
				errors: [`Validation error: ${error.message}`]
			};
		}
	}

	/**
	 * Create a standardized event payload with proper structure
	 *
	 * @param {string} eventType - Event type
	 * @param {Object} data - Event data
	 * @param {Object} context - Operation context
	 * @returns {Object} Standardized payload
	 */
	createStandardPayload(eventType, data, context) {
		const eventId = `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		const timestamp = new Date().toISOString();

		// Spread data first, then override with standard fields to ensure they are not overwritten
		return {
			...data,
			version: SCHEMA_VERSION,
			eventId,
			timestamp,
			context
		};
	}

	/**
	 * Get serializer statistics
	 *
	 * @returns {Object} Statistics
	 */
	getStats() {
		return { ...this.stats };
	}

	/**
	 * Reset statistics
	 */
	resetStats() {
		this.stats = {
			serialized: 0,
			deserialized: 0,
			validationErrors: 0,
			compressionSavings: 0
		};
	}

	// Private methods

	/**
	 * Prepare payload for serialization
	 *
	 * @param {Object} payload - Original payload
	 * @param {Object} options - Serialization options
	 * @returns {Promise<Object>} Prepared payload
	 * @private
	 */
	async _preparePayload(payload, options) {
		let prepared = { ...payload };

		// Handle special data types
		if (options.preserveTypes) {
			prepared = this._preserveTypes(prepared);
		}

		// Remove undefined values
		prepared = this._removeUndefined(prepared);

		return prepared;
	}

	/**
	 * Add serialization metadata to payload
	 *
	 * @param {Object} payload - Payload
	 * @param {string} eventType - Event type
	 * @param {Object} options - Options
	 * @returns {Object} Payload with metadata
	 * @private
	 */
	_addSerializationMetadata(payload, eventType, options) {
		return {
			...payload,
			_serialization: {
				eventType,
				format: options.format,
				compression: options.compression,
				schemaVersion: SCHEMA_VERSION,
				serializedAt: new Date().toISOString()
			}
		};
	}

	/**
	 * Serialize to JSON format
	 *
	 * @param {Object} payload - Payload to serialize
	 * @param {Object} options - Options
	 * @returns {string} JSON string
	 * @private
	 */
	_serializeJSON(payload, options) {
		if (options.prettyPrint) {
			return JSON.stringify(payload, null, 2);
		}
		return JSON.stringify(payload);
	}

	/**
	 * Serialize to compact JSON format
	 *
	 * @param {Object} payload - Payload to serialize
	 * @returns {string} Compact JSON string
	 * @private
	 */
	_serializeJSONCompact(payload) {
		// Remove whitespace and compress common patterns
		return JSON.stringify(payload)
			.replace(/","/g, '","')
			.replace(/": "/g, '":"')
			.replace(/", "/g, '","');
	}

	/**
	 * Serialize to binary format
	 *
	 * @param {Object} payload - Payload to serialize
	 * @returns {Promise<Buffer>} Binary data
	 * @private
	 */
	async _serializeBinary(payload) {
		// For now, use JSON as the binary format base
		const jsonString = JSON.stringify(payload);
		return Buffer.from(jsonString, 'utf8');
	}

	/**
	 * Deserialize from JSON format
	 *
	 * @param {string} data - JSON string
	 * @returns {Object} Parsed object
	 * @private
	 */
	_deserializeJSON(data) {
		if (typeof data === 'string') {
			return JSON.parse(data);
		}
		return data; // Already parsed
	}

	/**
	 * Deserialize from binary format
	 *
	 * @param {Buffer} data - Binary data
	 * @returns {Promise<Object>} Parsed object
	 * @private
	 */
	async _deserializeBinary(data) {
		const jsonString = data.toString('utf8');
		return JSON.parse(jsonString);
	}

	/**
	 * Preserve special data types for serialization
	 *
	 * @param {any} obj - Object to process
	 * @returns {any} Processed object
	 * @private
	 */
	_preserveTypes(obj) {
		if (obj === null || typeof obj !== 'object') {
			return obj;
		}

		if (obj instanceof Date) {
			return { _type: 'Date', _value: obj.toISOString() };
		}

		if (obj instanceof RegExp) {
			return {
				_type: 'RegExp',
				_value: { source: obj.source, flags: obj.flags }
			};
		}

		if (Array.isArray(obj)) {
			return obj.map((item) => this._preserveTypes(item));
		}

		const result = {};
		for (const [key, value] of Object.entries(obj)) {
			result[key] = this._preserveTypes(value);
		}
		return result;
	}

	/**
	 * Restore special data types after deserialization
	 *
	 * @param {any} obj - Object to process
	 * @returns {any} Restored object
	 * @private
	 */
	_restoreTypes(obj) {
		if (obj === null || typeof obj !== 'object') {
			return obj;
		}

		if (obj._type === 'Date') {
			return new Date(obj._value);
		}

		if (obj._type === 'RegExp') {
			return new RegExp(obj._value.source, obj._value.flags);
		}

		if (Array.isArray(obj)) {
			return obj.map((item) => this._restoreTypes(item));
		}

		const result = {};
		for (const [key, value] of Object.entries(obj)) {
			result[key] = this._restoreTypes(value);
		}
		return result;
	}

	/**
	 * Remove undefined values from object
	 *
	 * @param {Object} obj - Object to clean
	 * @returns {Object} Cleaned object
	 * @private
	 */
	_removeUndefined(obj) {
		if (obj === null || typeof obj !== 'object') {
			return obj;
		}

		if (Array.isArray(obj)) {
			return obj.map((item) => this._removeUndefined(item));
		}

		const result = {};
		for (const [key, value] of Object.entries(obj)) {
			if (value !== undefined) {
				result[key] = this._removeUndefined(value);
			}
		}
		return result;
	}

	/**
	 * Extract metadata from serialized data
	 *
	 * @param {any} data - Serialized data
	 * @returns {Object|null} Metadata or null
	 * @private
	 */
	_extractMetadata(data) {
		try {
			if (typeof data === 'string') {
				const parsed = JSON.parse(data);
				return parsed._serialization || null;
			}

			if (data && data._serialization) {
				return data._serialization;
			}

			return null;
		} catch (error) {
			return null;
		}
	}

	/**
	 * Get data size in bytes
	 *
	 * @param {any} data - Data to measure
	 * @returns {number} Size in bytes
	 * @private
	 */
	_getDataSize(data) {
		if (typeof data === 'string') {
			return Buffer.byteLength(data, 'utf8');
		}

		if (Buffer.isBuffer(data)) {
			return data.length;
		}

		return Buffer.byteLength(JSON.stringify(data), 'utf8');
	}

	/**
	 * Compress data (placeholder implementation)
	 *
	 * @param {any} data - Data to compress
	 * @param {string} algorithm - Compression algorithm
	 * @returns {Promise<any>} Compressed data
	 * @private
	 */
	async _compressData(data, algorithm) {
		// For now, return data as-is
		// In a real implementation, you would use zlib or similar
		log(
			'debug',
			`Compression with ${algorithm} not implemented, returning original data`
		);
		return data;
	}

	/**
	 * Decompress data (placeholder implementation)
	 *
	 * @param {any} data - Data to decompress
	 * @param {string} algorithm - Compression algorithm
	 * @returns {Promise<any>} Decompressed data
	 * @private
	 */
	async _decompressData(data, algorithm) {
		// For now, return data as-is
		// In a real implementation, you would use zlib or similar
		log(
			'debug',
			`Decompression with ${algorithm} not implemented, returning original data`
		);
		return data;
	}
}

/**
 * Global serializer instance
 */
let globalSerializer = null;

/**
 * Get or create global serializer instance
 *
 * @param {Object} options - Serializer options
 * @returns {EventPayloadSerializer} Global serializer
 */
export function getGlobalSerializer(options = {}) {
	if (!globalSerializer) {
		globalSerializer = new EventPayloadSerializer(options);
	}
	return globalSerializer;
}

/**
 * Convenience function to serialize event payload
 *
 * @param {string} eventType - Event type
 * @param {Object} payload - Payload to serialize
 * @param {Object} options - Serialization options
 * @returns {Promise<Object>} Serialization result
 */
export async function serializeEventPayload(eventType, payload, options = {}) {
	const serializer = getGlobalSerializer();
	return serializer.serialize(eventType, payload, options);
}

/**
 * Convenience function to deserialize event payload
 *
 * @param {any} data - Serialized data
 * @param {Object} options - Deserialization options
 * @returns {Promise<Object>} Deserialization result
 */
export async function deserializeEventPayload(data, options = {}) {
	const serializer = getGlobalSerializer();
	return serializer.deserialize(data, options);
}

/**
 * Convenience function to validate event payload
 *
 * @param {string} eventType - Event type
 * @param {Object} payload - Payload to validate
 * @returns {Object} Validation result
 */
export function validateEventPayload(eventType, payload) {
	const serializer = getGlobalSerializer();
	return serializer.validatePayload(eventType, payload);
}

/**
 * Convenience function to create standard payload
 *
 * @param {string} eventType - Event type
 * @param {Object} data - Event data
 * @param {Object} context - Operation context
 * @returns {Object} Standard payload
 */
export function createStandardEventPayload(eventType, data, context) {
	const serializer = getGlobalSerializer();
	return serializer.createStandardPayload(eventType, data, context);
}
