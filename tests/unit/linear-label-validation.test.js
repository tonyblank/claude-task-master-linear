/**
 * Tests for the Linear label validation module
 */

import { jest } from '@jest/globals';

// Import the module under test
const {
	validateLabelSetsConfig,
	validateCategories,
	validateCategory,
	validateLabel,
	validateColor,
	validateSettings,
	checkDuplicateLabels,
	validateLabelConsistency,
	VALIDATION_ERRORS
} = await import('../../scripts/modules/linear-label-validation.js');

describe('Linear Label Validation Module', () => {
	describe('validateColor', () => {
		it('should validate correct hex colors', () => {
			expect(validateColor('#ffffff')).toEqual({ valid: true });
			expect(validateColor('#000000')).toEqual({ valid: true });
			expect(validateColor('#6366f1')).toEqual({ valid: true });
			expect(validateColor('#ABCDEF')).toEqual({ valid: true });
			expect(validateColor('#123456')).toEqual({ valid: true });
		});

		it('should reject invalid color formats', () => {
			expect(validateColor('ffffff')).toEqual({
				valid: false,
				message: 'Color must be a valid hex color (e.g., #6366f1)'
			});

			expect(validateColor('#fff')).toEqual({
				valid: false,
				message: 'Color must be a valid hex color (e.g., #6366f1)'
			});

			expect(validateColor('#gggggg')).toEqual({
				valid: false,
				message: 'Color must be a valid hex color (e.g., #6366f1)'
			});

			expect(validateColor('red')).toEqual({
				valid: false,
				message: 'Color must be a valid hex color (e.g., #6366f1)'
			});
		});

		it('should handle invalid inputs', () => {
			expect(validateColor(null)).toEqual({
				valid: false,
				message: 'Color must be a string'
			});

			expect(validateColor(undefined)).toEqual({
				valid: false,
				message: 'Color must be a string'
			});

			expect(validateColor(123)).toEqual({
				valid: false,
				message: 'Color must be a string'
			});

			expect(validateColor('')).toEqual({
				valid: false,
				message: 'Color must be a string'
			});
		});
	});

	describe('validateLabel', () => {
		it('should validate correct label configuration', () => {
			const validLabel = {
				name: 'Bug',
				description: 'Something is broken',
				color: '#d73a49'
			};

			const result = validateLabel('types', 'bug', validLabel);

			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		it('should detect missing required fields', () => {
			const incompleteLabel = {
				name: 'Bug'
				// missing description and color
			};

			const result = validateLabel('types', 'bug', incompleteLabel);

			expect(result.valid).toBe(false);
			expect(result.errors).toHaveLength(2);
			expect(result.errors[0].type).toBe(
				VALIDATION_ERRORS.MISSING_REQUIRED_FIELD
			);
			expect(result.errors[0].message).toContain('description');
			expect(result.errors[1].message).toContain('color');
		});

		it('should validate field types', () => {
			const invalidLabel = {
				name: 123, // should be string
				description: 'Valid description',
				color: '#d73a49'
			};

			const result = validateLabel('types', 'bug', invalidLabel);

			expect(result.valid).toBe(false);
			expect(
				result.errors.some((e) => e.message.includes('name must be a string'))
			).toBe(true);
		});

		it('should validate color format', () => {
			const invalidColorLabel = {
				name: 'Bug',
				description: 'Something is broken',
				color: 'invalid-color'
			};

			const result = validateLabel('types', 'bug', invalidColorLabel);

			expect(result.valid).toBe(false);
			expect(
				result.errors.some((e) => e.type === VALIDATION_ERRORS.INVALID_COLOR)
			).toBe(true);
		});

		it('should handle invalid label objects', () => {
			const result1 = validateLabel('types', 'bug', null);
			expect(result1.valid).toBe(false);
			expect(result1.errors[0].type).toBe(VALIDATION_ERRORS.INVALID_LABEL);

			const result2 = validateLabel('types', 'bug', 'not-an-object');
			expect(result2.valid).toBe(false);
			expect(result2.errors[0].type).toBe(VALIDATION_ERRORS.INVALID_LABEL);
		});

		it('should generate warnings for optional field type mismatches', () => {
			const labelWithWarnings = {
				name: 'Bug',
				description: 123, // should be string but not critical
				color: '#d73a49'
			};

			const result = validateLabel('types', 'bug', labelWithWarnings);

			expect(result.warnings).toHaveLength(1);
			expect(result.warnings[0].message).toContain(
				'description should be a string'
			);
		});
	});

	describe('validateCategory', () => {
		it('should validate correct category configuration', () => {
			const validCategory = {
				enabled: true,
				description: 'Issue types',
				autoApply: false,
				labels: {
					bug: {
						name: 'Bug',
						description: 'Something broken',
						color: '#d73a49'
					}
				}
			};

			const result = validateCategory('types', validCategory);

			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
			expect(result.labelCount).toBe(1);
		});

		it('should detect missing required fields', () => {
			const incompleteCategory = {
				// missing enabled, description, labels
			};

			const result = validateCategory('types', incompleteCategory);

			expect(result.valid).toBe(false);
			expect(result.errors).toHaveLength(3);
			expect(result.errors.some((e) => e.message.includes('enabled'))).toBe(
				true
			);
			expect(result.errors.some((e) => e.message.includes('description'))).toBe(
				true
			);
			expect(result.errors.some((e) => e.message.includes('labels'))).toBe(
				true
			);
		});

		it('should validate field types', () => {
			const invalidCategory = {
				enabled: 'true', // should be boolean
				description: 'Valid description',
				labels: {}
			};

			const result = validateCategory('types', invalidCategory);

			expect(result.valid).toBe(false);
			expect(
				result.errors.some((e) =>
					e.message.includes('enabled field must be boolean')
				)
			).toBe(true);
		});

		it('should validate labels object', () => {
			const categoryWithInvalidLabels = {
				enabled: true,
				description: 'Valid description',
				labels: 'not-an-object'
			};

			const result = validateCategory('types', categoryWithInvalidLabels);

			expect(result.valid).toBe(false);
			expect(
				result.errors.some((e) =>
					e.message.includes('labels must be an object')
				)
			).toBe(true);
		});

		it('should validate individual labels within category', () => {
			const categoryWithInvalidLabel = {
				enabled: true,
				description: 'Valid description',
				labels: {
					bug: {
						name: 'Bug'
						// missing required fields
					}
				}
			};

			const result = validateCategory('types', categoryWithInvalidLabel);

			expect(result.valid).toBe(false);
			expect(result.labelCount).toBe(1);
			// Should have errors from label validation
			expect(result.errors.length).toBeGreaterThan(0);
		});

		it('should handle invalid category objects', () => {
			const result1 = validateCategory('types', null);
			expect(result1.valid).toBe(false);
			expect(result1.errors[0].type).toBe(VALIDATION_ERRORS.INVALID_CATEGORY);

			const result2 = validateCategory('types', 'not-an-object');
			expect(result2.valid).toBe(false);
			expect(result2.errors[0].type).toBe(VALIDATION_ERRORS.INVALID_CATEGORY);
		});

		it('should generate warnings for optional field type mismatches', () => {
			const categoryWithWarnings = {
				enabled: true,
				description: 'Valid description',
				autoApply: 'false', // should be boolean
				labels: {}
			};

			const result = validateCategory('types', categoryWithWarnings);

			expect(result.warnings).toHaveLength(1);
			expect(result.warnings[0].message).toContain(
				'autoApply should be boolean'
			);
		});
	});

	describe('validateCategories', () => {
		it('should validate all categories', () => {
			const validCategories = {
				core: {
					enabled: true,
					description: 'Core labels',
					labels: {
						taskmaster: {
							name: 'taskmaster',
							description: 'TaskMaster managed',
							color: '#6366f1'
						}
					}
				},
				types: {
					enabled: true,
					description: 'Issue types',
					labels: {
						bug: {
							name: 'Bug',
							description: 'Something broken',
							color: '#d73a49'
						}
					}
				}
			};

			const result = validateCategories(validCategories);

			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
			expect(result.summary.totalCategories).toBe(2);
			expect(result.summary.enabledCategories).toBe(2);
			expect(result.summary.totalLabels).toBe(2);
		});

		it('should count enabled categories correctly', () => {
			const mixedCategories = {
				core: {
					enabled: true,
					description: 'Core labels',
					labels: {}
				},
				types: {
					enabled: false,
					description: 'Issue types',
					labels: {}
				}
			};

			const result = validateCategories(mixedCategories);

			expect(result.summary.totalCategories).toBe(2);
			expect(result.summary.enabledCategories).toBe(1);
		});

		it('should aggregate errors from all categories', () => {
			const invalidCategories = {
				core: {
					// missing required fields
				},
				types: {
					enabled: 'not-boolean',
					description: 'Types',
					labels: {}
				}
			};

			const result = validateCategories(invalidCategories);

			expect(result.valid).toBe(false);
			expect(result.errors.length).toBeGreaterThan(3); // Multiple errors from both categories
		});

		it('should handle invalid categories object', () => {
			const result1 = validateCategories(null);
			expect(result1.valid).toBe(false);
			expect(result1.errors[0].type).toBe(
				VALIDATION_ERRORS.INVALID_CONFIG_STRUCTURE
			);

			const result2 = validateCategories('not-an-object');
			expect(result2.valid).toBe(false);
			expect(result2.errors[0].type).toBe(
				VALIDATION_ERRORS.INVALID_CONFIG_STRUCTURE
			);
		});
	});

	describe('validateSettings', () => {
		it('should validate correct settings', () => {
			const validSettings = {
				syncMode: 'one-way',
				createMissing: true,
				updateExisting: false,
				deleteUnused: false,
				batchSize: 10,
				retryAttempts: 3,
				retryDelay: 1000
			};

			const result = validateSettings(validSettings);

			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		it('should validate boolean settings', () => {
			const invalidBooleanSettings = {
				createMissing: 'true', // should be boolean
				updateExisting: 1, // should be boolean
				deleteUnused: false // valid
			};

			const result = validateSettings(invalidBooleanSettings);

			expect(result.warnings).toHaveLength(2);
			expect(
				result.warnings.some((w) => w.message.includes('createMissing'))
			).toBe(true);
			expect(
				result.warnings.some((w) => w.message.includes('updateExisting'))
			).toBe(true);
		});

		it('should validate numeric settings with ranges', () => {
			const invalidNumericSettings = {
				batchSize: 100, // too high (max 50)
				retryAttempts: 0, // too low (min 1)
				retryDelay: 50000 // too high (max 10000)
			};

			const result = validateSettings(invalidNumericSettings);

			expect(result.valid).toBe(false);
			expect(result.errors).toHaveLength(3);
			expect(
				result.errors.every(
					(e) => e.type === VALIDATION_ERRORS.INVALID_CONFIG_STRUCTURE
				)
			).toBe(true);
		});

		it('should validate numeric field types', () => {
			const invalidTypeSettings = {
				batchSize: 'ten', // should be number
				retryAttempts: 3.5, // should be integer
				retryDelay: '1000' // should be number
			};

			const result = validateSettings(invalidTypeSettings);

			expect(result.valid).toBe(false);
			expect(result.errors).toHaveLength(3);
		});

		it('should validate sync mode values', () => {
			const invalidSyncMode = {
				syncMode: 'three-way' // should be 'one-way' or 'two-way'
			};

			const result = validateSettings(invalidSyncMode);

			expect(result.warnings).toHaveLength(1);
			expect(result.warnings[0].message).toContain('syncMode');
		});

		it('should handle invalid settings object', () => {
			const result1 = validateSettings(null);
			expect(result1.valid).toBe(false);
			expect(result1.errors[0].type).toBe(
				VALIDATION_ERRORS.INVALID_CONFIG_STRUCTURE
			);

			const result2 = validateSettings('not-an-object');
			expect(result2.valid).toBe(false);
			expect(result2.errors[0].type).toBe(
				VALIDATION_ERRORS.INVALID_CONFIG_STRUCTURE
			);
		});
	});

	describe('checkDuplicateLabels', () => {
		it('should detect duplicate label names', () => {
			const categoriesWithDuplicates = {
				core: {
					labels: {
						taskmaster: {
							name: 'Bug', // Same name as types.bug
							color: '#6366f1'
						}
					}
				},
				types: {
					labels: {
						bug: {
							name: 'Bug',
							color: '#d73a49'
						}
					}
				}
			};

			const result = checkDuplicateLabels(categoriesWithDuplicates);

			expect(result.duplicates).toHaveLength(1);
			expect(result.errors).toHaveLength(1);
			expect(result.duplicates[0]).toMatchObject({
				name: 'Bug',
				normalizedName: 'bug',
				categories: ['core', 'types']
			});
			expect(result.errors[0].type).toBe(VALIDATION_ERRORS.DUPLICATE_LABEL);
		});

		it('should handle case-insensitive duplicates', () => {
			const categoriesWithCaseDuplicates = {
				core: {
					labels: {
						taskmaster: {
							name: 'BUG',
							color: '#6366f1'
						}
					}
				},
				types: {
					labels: {
						bug: {
							name: 'bug',
							color: '#d73a49'
						}
					}
				}
			};

			const result = checkDuplicateLabels(categoriesWithCaseDuplicates);

			expect(result.duplicates).toHaveLength(1);
			expect(result.duplicates[0].normalizedName).toBe('bug');
		});

		it('should return no duplicates for unique labels', () => {
			const categoriesWithUniqueLabels = {
				core: {
					labels: {
						taskmaster: {
							name: 'taskmaster',
							color: '#6366f1'
						}
					}
				},
				types: {
					labels: {
						bug: {
							name: 'Bug',
							color: '#d73a49'
						}
					}
				}
			};

			const result = checkDuplicateLabels(categoriesWithUniqueLabels);

			expect(result.duplicates).toHaveLength(0);
			expect(result.errors).toHaveLength(0);
		});

		it('should handle empty or invalid categories', () => {
			expect(checkDuplicateLabels(null).duplicates).toHaveLength(0);
			expect(checkDuplicateLabels({}).duplicates).toHaveLength(0);
			expect(checkDuplicateLabels({ core: {} }).duplicates).toHaveLength(0);
		});
	});

	describe('validateLabelSetsConfig', () => {
		it('should validate complete configuration', () => {
			const validConfig = {
				version: '1.0.0',
				categories: {
					core: {
						enabled: true,
						description: 'Core labels',
						labels: {
							taskmaster: {
								name: 'taskmaster',
								description: 'TaskMaster managed',
								color: '#6366f1'
							}
						}
					}
				},
				settings: {
					syncMode: 'one-way',
					createMissing: true,
					batchSize: 10
				},
				metadata: {}
			};

			const result = validateLabelSetsConfig(validConfig);

			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
			expect(result.summary.totalCategories).toBe(1);
			expect(result.summary.enabledCategories).toBe(1);
		});

		it('should detect missing required top-level fields', () => {
			const incompleteConfig = {
				// missing version, categories, settings
			};

			const result = validateLabelSetsConfig(incompleteConfig);

			expect(result.valid).toBe(false);
			expect(result.errors).toHaveLength(3);
			expect(
				result.errors.every(
					(e) => e.type === VALIDATION_ERRORS.MISSING_REQUIRED_FIELD
				)
			).toBe(true);
		});

		it('should aggregate all validation errors', () => {
			const invalidConfig = {
				version: '1.0.0',
				categories: {
					core: {
						// missing required fields
					}
				},
				settings: {
					batchSize: 1000 // invalid range
				}
			};

			const result = validateLabelSetsConfig(invalidConfig);

			expect(result.valid).toBe(false);
			expect(result.errors.length).toBeGreaterThan(3); // Errors from multiple validation phases
		});

		it('should handle invalid config objects', () => {
			const result1 = validateLabelSetsConfig(null);
			expect(result1.valid).toBe(false);
			expect(result1.errors[0].type).toBe(
				VALIDATION_ERRORS.INVALID_CONFIG_STRUCTURE
			);

			const result2 = validateLabelSetsConfig('not-an-object');
			expect(result2.valid).toBe(false);
			expect(result2.errors[0].type).toBe(
				VALIDATION_ERRORS.INVALID_CONFIG_STRUCTURE
			);
		});

		it('should catch validation exceptions', () => {
			// Test with a config that might cause validation to throw
			const problematicConfig = {
				version: '1.0.0',
				categories: {
					core: {
						enabled: true,
						description: 'Core',
						labels: {
							test: {
								name: 'test',
								description: 'test',
								color: '#ffffff'
							}
						}
					}
				},
				settings: {}
			};

			// This should not throw, even if internal validation has issues
			const result = validateLabelSetsConfig(problematicConfig);
			expect(typeof result).toBe('object');
			expect(typeof result.valid).toBe('boolean');
		});
	});

	describe('validateLabelConsistency', () => {
		it('should validate consistent labels across projects', () => {
			const projectLabels = {
				'project-1': [
					{ name: 'Bug', color: '#d73a49', description: 'Bug label' },
					{ name: 'taskmaster', color: '#6366f1', description: 'TaskMaster' }
				],
				'project-2': [
					{ name: 'Bug', color: '#d73a49', description: 'Bug label' },
					{ name: 'taskmaster', color: '#6366f1', description: 'TaskMaster' }
				]
			};

			const labelSetsConfig = {
				categories: {
					core: {
						enabled: true,
						labels: {
							taskmaster: {
								name: 'taskmaster',
								color: '#6366f1',
								description: 'TaskMaster'
							}
						}
					},
					types: {
						enabled: true,
						labels: {
							bug: {
								name: 'Bug',
								color: '#d73a49',
								description: 'Bug label'
							}
						}
					}
				}
			};

			const result = validateLabelConsistency(projectLabels, labelSetsConfig);

			expect(result.consistent).toBe(true);
			expect(result.issues).toHaveLength(0);
			expect(result.summary.totalProjects).toBe(2);
		});

		it('should detect missing required labels', () => {
			const projectLabels = {
				'project-1': [
					{ name: 'Bug', color: '#d73a49' }
					// missing taskmaster label
				]
			};

			const labelSetsConfig = {
				categories: {
					core: {
						enabled: true,
						labels: {
							taskmaster: {
								name: 'taskmaster',
								color: '#6366f1'
							}
						}
					},
					types: {
						enabled: true,
						labels: {
							bug: {
								name: 'Bug',
								color: '#d73a49'
							}
						}
					}
				}
			};

			const result = validateLabelConsistency(projectLabels, labelSetsConfig);

			expect(result.consistent).toBe(false);
			expect(result.issues).toHaveLength(1);
			expect(result.issues[0]).toMatchObject({
				type: 'missing_label',
				projectId: 'project-1',
				labelName: 'taskmaster',
				severity: 'high'
			});
			expect(result.summary.missingLabels).toBe(1);
		});

		it('should detect color mismatches', () => {
			const projectLabels = {
				'project-1': [
					{ name: 'Bug', color: '#ff0000' } // Different color
				]
			};

			const labelSetsConfig = {
				categories: {
					types: {
						enabled: true,
						labels: {
							bug: {
								name: 'Bug',
								color: '#d73a49' // Expected color
							}
						}
					}
				}
			};

			const result = validateLabelConsistency(projectLabels, labelSetsConfig);

			expect(result.consistent).toBe(false);
			expect(result.issues).toHaveLength(1);
			expect(result.issues[0]).toMatchObject({
				type: 'color_mismatch',
				projectId: 'project-1',
				labelName: 'Bug',
				expectedColor: '#d73a49',
				actualColor: '#ff0000',
				severity: 'low'
			});
		});

		it('should generate appropriate recommendations', () => {
			const projectLabels = {
				'project-1': [] // No labels
			};

			const labelSetsConfig = {
				categories: {
					core: {
						enabled: true,
						labels: {
							taskmaster: {
								name: 'taskmaster',
								color: '#6366f1'
							}
						}
					}
				}
			};

			const result = validateLabelConsistency(projectLabels, labelSetsConfig);

			expect(result.recommendations).toHaveLength(1);
			expect(result.recommendations[0]).toMatchObject({
				type: 'create_missing',
				priority: 'high'
			});
		});

		it('should handle projects with no labels', () => {
			const projectLabels = {
				'project-1': [],
				'project-2': []
			};

			const labelSetsConfig = {
				categories: {}
			};

			const result = validateLabelConsistency(projectLabels, labelSetsConfig);

			expect(result.consistent).toBe(true);
			expect(result.issues).toHaveLength(0);
			expect(result.summary.totalProjects).toBe(2);
		});
	});
});
