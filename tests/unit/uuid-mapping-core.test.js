/**
 * @fileoverview Core UUID mapping functionality tests
 * Tests basic validation and structure functions for UUID mappings
 */

import { jest } from '@jest/globals';

describe('UUID Mapping Core Functionality', () => {
	// Test UUID validation function directly
	describe('UUID validation', () => {
		const validUuids = [
			'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
			'A1B2C3D4-E5F6-7890-ABCD-EF1234567890', // uppercase
			'12345678-1234-1234-1234-123456789abc',
			'ffffffff-ffff-ffff-ffff-ffffffffffff'
		];

		const invalidUuids = [
			'not-a-uuid',
			'12345678-1234-1234-1234-123456789xyz', // invalid characters
			'12345678123412341234123456789abc', // no hyphens
			'12345678-1234-1234-1234-123456789ab', // too short
			'12345678-1234-1234-1234-123456789abcd', // too long
			'',
			null,
			undefined,
			123
		];

		// Simple UUID validation function for testing
		function validateUuid(uuid) {
			if (!uuid || typeof uuid !== 'string') {
				return false;
			}
			// More lenient UUID regex that matches standard UUID v4 format
			const uuidRegex =
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
			return uuidRegex.test(uuid);
		}

		test.each(validUuids)('should validate UUID "%s" as valid', (uuid) => {
			expect(validateUuid(uuid)).toBe(true);
		});

		test.each(invalidUuids)('should validate UUID "%s" as invalid', (uuid) => {
			expect(validateUuid(uuid)).toBe(false);
		});
	});

	// Test TaskMaster status validation
	describe('TaskMaster status validation', () => {
		const validStatuses = [
			'pending',
			'in-progress',
			'review',
			'done',
			'cancelled',
			'deferred'
		];
		const invalidStatuses = [
			'invalid',
			'unknown',
			'pending-review',
			'complete',
			''
		];

		function validateTaskMasterStatus(status) {
			const validStatuses = [
				'pending',
				'in-progress',
				'review',
				'done',
				'cancelled',
				'deferred'
			];
			return validStatuses.includes(status);
		}

		test.each(validStatuses)(
			'should validate status "%s" as valid',
			(status) => {
				expect(validateTaskMasterStatus(status)).toBe(true);
			}
		);

		test.each(invalidStatuses)(
			'should validate status "%s" as invalid',
			(status) => {
				expect(validateTaskMasterStatus(status)).toBe(false);
			}
		);
	});

	// Test UUID mapping structure validation
	describe('UUID mapping structure validation', () => {
		function validateUuidMapping(mapping) {
			const errors = [];

			if (!mapping || typeof mapping !== 'object') {
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
			const uuidRegex =
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

			for (const [status, uuid] of Object.entries(mapping)) {
				if (!validStatuses.includes(status)) {
					errors.push(`Invalid TaskMaster status: "${status}"`);
				}
				if (!uuid || typeof uuid !== 'string' || !uuidRegex.test(uuid)) {
					errors.push(`Invalid UUID format for status "${status}": "${uuid}"`);
				}
			}

			return { valid: errors.length === 0, errors };
		}

		it('should validate correct UUID mapping', () => {
			const validMapping = {
				pending: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
				'in-progress': 'b2c3d4e5-f6a1-8901-bcde-f23456789012',
				done: 'c3d4e5f6-a1b2-9012-cdef-345678901234'
			};

			const result = validateUuidMapping(validMapping);
			expect(result.valid).toBe(true);
			expect(result.errors).toEqual([]);
		});

		it('should reject invalid UUID formats', () => {
			const invalidMapping = {
				pending: 'not-a-uuid',
				'in-progress': '12345678-1234-1234-1234-123456789xyz',
				done: 'too-short'
			};

			const result = validateUuidMapping(invalidMapping);
			expect(result.valid).toBe(false);
			expect(result.errors.length).toBeGreaterThan(0);
		});

		it('should reject invalid TaskMaster statuses', () => {
			const invalidMapping = {
				'invalid-status': 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
				'another-invalid': 'b2c3d4e5-f6a1-8901-bcde-f23456789012'
			};

			const result = validateUuidMapping(invalidMapping);
			expect(result.valid).toBe(false);
			expect(
				result.errors.some((e) => e.includes('Invalid TaskMaster status'))
			).toBe(true);
		});

		it('should handle empty mapping as valid', () => {
			const result = validateUuidMapping({});
			expect(result.valid).toBe(true);
			expect(result.errors).toEqual([]);
		});

		it('should handle null/undefined input', () => {
			expect(validateUuidMapping(null).valid).toBe(false);
			expect(validateUuidMapping(undefined).valid).toBe(false);
		});
	});

	// Test effective mapping logic
	describe('Effective mapping logic', () => {
		function getEffectiveMapping(uuidMapping, nameMapping) {
			const hasUuidMappings =
				uuidMapping && Object.keys(uuidMapping).length > 0;

			if (hasUuidMappings) {
				return { type: 'uuid', mapping: uuidMapping };
			}

			return { type: 'name', mapping: nameMapping || {} };
		}

		it('should prefer UUID mappings when available', () => {
			const uuidMapping = { pending: 'uuid-pending' };
			const nameMapping = { pending: 'Todo', done: 'Done' };

			const result = getEffectiveMapping(uuidMapping, nameMapping);
			expect(result.type).toBe('uuid');
			expect(result.mapping).toEqual(uuidMapping);
		});

		it('should fall back to name mappings when no UUID mappings', () => {
			const uuidMapping = {};
			const nameMapping = { pending: 'Todo', done: 'Done' };

			const result = getEffectiveMapping(uuidMapping, nameMapping);
			expect(result.type).toBe('name');
			expect(result.mapping).toEqual(nameMapping);
		});

		it('should handle missing mappings gracefully', () => {
			const result = getEffectiveMapping(null, null);
			expect(result.type).toBe('name');
			expect(result.mapping).toEqual({});
		});
	});

	// Test configuration completeness checking
	describe('Configuration completeness', () => {
		const allTaskMasterStatuses = [
			'pending',
			'in-progress',
			'review',
			'done',
			'cancelled',
			'deferred'
		];

		function isFullyConfigured(mapping) {
			return Object.keys(mapping).length === allTaskMasterStatuses.length;
		}

		function getMissingStatuses(mapping) {
			return allTaskMasterStatuses.filter((status) => !mapping[status]);
		}

		it('should identify complete configuration', () => {
			const completeMapping = {
				pending: 'uuid-pending',
				'in-progress': 'uuid-in-progress',
				review: 'uuid-review',
				done: 'uuid-done',
				cancelled: 'uuid-cancelled',
				deferred: 'uuid-deferred'
			};

			expect(isFullyConfigured(completeMapping)).toBe(true);
			expect(getMissingStatuses(completeMapping)).toEqual([]);
		});

		it('should identify incomplete configuration', () => {
			const incompleteMapping = {
				pending: 'uuid-pending',
				done: 'uuid-done'
			};

			expect(isFullyConfigured(incompleteMapping)).toBe(false);
			expect(getMissingStatuses(incompleteMapping)).toEqual([
				'in-progress',
				'review',
				'cancelled',
				'deferred'
			]);
		});

		it('should handle empty configuration', () => {
			expect(isFullyConfigured({})).toBe(false);
			expect(getMissingStatuses({})).toEqual(allTaskMasterStatuses);
		});
	});
});
