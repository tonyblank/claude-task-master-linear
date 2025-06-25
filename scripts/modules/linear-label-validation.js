/**
 * @fileoverview Linear Label Validation Module
 *
 * This module provides validation functions for Linear label configurations
 * and consistency checks across projects.
 */

import { LABEL_MANAGEMENT_ERRORS } from './linear-label-management.js';

/**
 * Validation error types
 */
export const VALIDATION_ERRORS = {
	INVALID_CONFIG_STRUCTURE: 'INVALID_CONFIG_STRUCTURE',
	INVALID_CATEGORY: 'INVALID_CATEGORY',
	INVALID_LABEL: 'INVALID_LABEL',
	INVALID_COLOR: 'INVALID_COLOR',
	DUPLICATE_LABEL: 'DUPLICATE_LABEL',
	MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD'
};

/**
 * Validate label sets configuration structure
 *
 * @param {Object} config - Label sets configuration to validate
 * @returns {Object} Validation result with errors and warnings
 */
export function validateLabelSetsConfig(config) {
	const result = {
		valid: true,
		errors: [],
		warnings: [],
		summary: {
			totalCategories: 0,
			enabledCategories: 0,
			totalLabels: 0,
			duplicateLabels: 0
		}
	};

	try {
		// Check basic structure
		if (!config || typeof config !== 'object') {
			result.errors.push({
				type: VALIDATION_ERRORS.INVALID_CONFIG_STRUCTURE,
				message: 'Configuration must be an object',
				field: 'root'
			});
			result.valid = false;
			return result;
		}

		// Check required top-level fields
		const requiredFields = ['version', 'categories', 'settings'];
		for (const field of requiredFields) {
			if (!config[field]) {
				result.errors.push({
					type: VALIDATION_ERRORS.MISSING_REQUIRED_FIELD,
					message: `Missing required field: ${field}`,
					field
				});
				result.valid = false;
			}
		}

		// Validate categories
		if (config.categories && typeof config.categories === 'object') {
			const categoryValidation = validateCategories(config.categories);
			result.errors.push(...categoryValidation.errors);
			result.warnings.push(...categoryValidation.warnings);
			result.summary = { ...result.summary, ...categoryValidation.summary };

			if (!categoryValidation.valid) {
				result.valid = false;
			}
		}

		// Validate settings
		if (config.settings) {
			const settingsValidation = validateSettings(config.settings);
			result.errors.push(...settingsValidation.errors);
			result.warnings.push(...settingsValidation.warnings);

			if (!settingsValidation.valid) {
				result.valid = false;
			}
		}

		// Check for duplicate label names across categories
		const duplicateCheck = checkDuplicateLabels(config.categories);
		result.errors.push(...duplicateCheck.errors);
		result.warnings.push(...duplicateCheck.warnings);
		result.summary.duplicateLabels = duplicateCheck.duplicates.length;

		if (duplicateCheck.errors.length > 0) {
			result.valid = false;
		}
	} catch (error) {
		result.errors.push({
			type: VALIDATION_ERRORS.INVALID_CONFIG_STRUCTURE,
			message: `Configuration validation failed: ${error.message}`,
			field: 'root'
		});
		result.valid = false;
	}

	return result;
}

/**
 * Validate categories section of configuration
 *
 * @param {Object} categories - Categories object to validate
 * @returns {Object} Validation result
 */
export function validateCategories(categories) {
	const result = {
		valid: true,
		errors: [],
		warnings: [],
		summary: {
			totalCategories: 0,
			enabledCategories: 0,
			totalLabels: 0
		}
	};

	if (!categories || typeof categories !== 'object') {
		result.errors.push({
			type: VALIDATION_ERRORS.INVALID_CONFIG_STRUCTURE,
			message: 'Categories must be an object',
			field: 'categories'
		});
		result.valid = false;
		return result;
	}

	// Validate each category
	for (const [categoryKey, category] of Object.entries(categories)) {
		result.summary.totalCategories++;

		if (category.enabled) {
			result.summary.enabledCategories++;
		}

		const categoryValidation = validateCategory(categoryKey, category);
		result.errors.push(...categoryValidation.errors);
		result.warnings.push(...categoryValidation.warnings);
		result.summary.totalLabels += categoryValidation.labelCount;

		if (!categoryValidation.valid) {
			result.valid = false;
		}
	}

	return result;
}

/**
 * Validate individual category configuration
 *
 * @param {string} categoryKey - Category key
 * @param {Object} category - Category configuration
 * @returns {Object} Validation result
 */
export function validateCategory(categoryKey, category) {
	const result = {
		valid: true,
		errors: [],
		warnings: [],
		labelCount: 0
	};

	if (!category || typeof category !== 'object') {
		result.errors.push({
			type: VALIDATION_ERRORS.INVALID_CATEGORY,
			message: `Category '${categoryKey}' must be an object`,
			field: `categories.${categoryKey}`
		});
		result.valid = false;
		return result;
	}

	// Check required category fields
	const requiredFields = ['enabled', 'description', 'labels'];
	for (const field of requiredFields) {
		if (category[field] === undefined) {
			result.errors.push({
				type: VALIDATION_ERRORS.MISSING_REQUIRED_FIELD,
				message: `Category '${categoryKey}' missing required field: ${field}`,
				field: `categories.${categoryKey}.${field}`
			});
			result.valid = false;
		}
	}

	// Validate enabled field (only if it exists)
	if (category.enabled !== undefined && typeof category.enabled !== 'boolean') {
		result.errors.push({
			type: VALIDATION_ERRORS.INVALID_CATEGORY,
			message: `Category '${categoryKey}' enabled field must be boolean`,
			field: `categories.${categoryKey}.enabled`
		});
		result.valid = false;
	}

	// Validate labels object
	if (category.labels && typeof category.labels === 'object') {
		for (const [labelKey, label] of Object.entries(category.labels)) {
			result.labelCount++;

			const labelValidation = validateLabel(categoryKey, labelKey, label);
			result.errors.push(...labelValidation.errors);
			result.warnings.push(...labelValidation.warnings);

			if (!labelValidation.valid) {
				result.valid = false;
			}
		}
	} else if (category.labels !== undefined) {
		result.errors.push({
			type: VALIDATION_ERRORS.INVALID_CATEGORY,
			message: `Category '${categoryKey}' labels must be an object`,
			field: `categories.${categoryKey}.labels`
		});
		result.valid = false;
	}

	// Validate optional fields
	if (
		category.autoApply !== undefined &&
		typeof category.autoApply !== 'boolean'
	) {
		result.warnings.push({
			type: VALIDATION_ERRORS.INVALID_CATEGORY,
			message: `Category '${categoryKey}' autoApply should be boolean`,
			field: `categories.${categoryKey}.autoApply`
		});
	}

	return result;
}

/**
 * Validate individual label configuration
 *
 * @param {string} categoryKey - Category key
 * @param {string} labelKey - Label key
 * @param {Object} label - Label configuration
 * @returns {Object} Validation result
 */
export function validateLabel(categoryKey, labelKey, label) {
	const result = {
		valid: true,
		errors: [],
		warnings: []
	};

	if (!label || typeof label !== 'object') {
		result.errors.push({
			type: VALIDATION_ERRORS.INVALID_LABEL,
			message: `Label '${labelKey}' in category '${categoryKey}' must be an object`,
			field: `categories.${categoryKey}.labels.${labelKey}`
		});
		result.valid = false;
		return result;
	}

	// Check required label fields
	const requiredFields = ['name', 'description', 'color'];
	for (const field of requiredFields) {
		if (!label[field]) {
			result.errors.push({
				type: VALIDATION_ERRORS.MISSING_REQUIRED_FIELD,
				message: `Label '${labelKey}' missing required field: ${field}`,
				field: `categories.${categoryKey}.labels.${labelKey}.${field}`
			});
			result.valid = false;
		}
	}

	// Validate name
	if (label.name && typeof label.name !== 'string') {
		result.errors.push({
			type: VALIDATION_ERRORS.INVALID_LABEL,
			message: `Label '${labelKey}' name must be a string`,
			field: `categories.${categoryKey}.labels.${labelKey}.name`
		});
		result.valid = false;
	}

	// Validate color format
	if (label.color) {
		const colorValidation = validateColor(label.color);
		if (!colorValidation.valid) {
			result.errors.push({
				type: VALIDATION_ERRORS.INVALID_COLOR,
				message: `Label '${labelKey}' has invalid color: ${colorValidation.message}`,
				field: `categories.${categoryKey}.labels.${labelKey}.color`
			});
			result.valid = false;
		}
	}

	// Validate description
	if (label.description && typeof label.description !== 'string') {
		result.warnings.push({
			type: VALIDATION_ERRORS.INVALID_LABEL,
			message: `Label '${labelKey}' description should be a string`,
			field: `categories.${categoryKey}.labels.${labelKey}.description`
		});
	}

	return result;
}

/**
 * Validate hex color format
 *
 * @param {string} color - Color value to validate
 * @returns {Object} Validation result
 */
export function validateColor(color) {
	if (!color || typeof color !== 'string') {
		return {
			valid: false,
			message: 'Color must be a string'
		};
	}

	// Check hex color format
	const hexColorRegex = /^#[0-9a-f]{6}$/i;
	if (!hexColorRegex.test(color)) {
		return {
			valid: false,
			message: 'Color must be a valid hex color (e.g., #6366f1)'
		};
	}

	return { valid: true };
}

/**
 * Validate settings configuration
 *
 * @param {Object} settings - Settings object to validate
 * @returns {Object} Validation result
 */
export function validateSettings(settings) {
	const result = {
		valid: true,
		errors: [],
		warnings: []
	};

	if (!settings || typeof settings !== 'object') {
		result.errors.push({
			type: VALIDATION_ERRORS.INVALID_CONFIG_STRUCTURE,
			message: 'Settings must be an object',
			field: 'settings'
		});
		result.valid = false;
		return result;
	}

	// Validate boolean settings
	const booleanSettings = [
		'createMissing',
		'updateExisting',
		'deleteUnused',
		'syncOnStatusChange'
	];
	for (const setting of booleanSettings) {
		if (
			settings[setting] !== undefined &&
			typeof settings[setting] !== 'boolean'
		) {
			result.warnings.push({
				type: VALIDATION_ERRORS.INVALID_CONFIG_STRUCTURE,
				message: `Setting '${setting}' should be boolean`,
				field: `settings.${setting}`
			});
		}
	}

	// Validate numeric settings
	const numericSettings = {
		batchSize: { min: 1, max: 50 },
		retryAttempts: { min: 1, max: 10 },
		retryDelay: { min: 100, max: 10000 }
	};

	for (const [setting, constraints] of Object.entries(numericSettings)) {
		if (settings[setting] !== undefined) {
			if (
				typeof settings[setting] !== 'number' ||
				!Number.isInteger(settings[setting])
			) {
				result.errors.push({
					type: VALIDATION_ERRORS.INVALID_CONFIG_STRUCTURE,
					message: `Setting '${setting}' must be an integer`,
					field: `settings.${setting}`
				});
				result.valid = false;
			} else if (
				settings[setting] < constraints.min ||
				settings[setting] > constraints.max
			) {
				result.errors.push({
					type: VALIDATION_ERRORS.INVALID_CONFIG_STRUCTURE,
					message: `Setting '${setting}' must be between ${constraints.min} and ${constraints.max}`,
					field: `settings.${setting}`
				});
				result.valid = false;
			}
		}
	}

	// Validate sync mode
	if (
		settings.syncMode &&
		!['one-way', 'two-way'].includes(settings.syncMode)
	) {
		result.warnings.push({
			type: VALIDATION_ERRORS.INVALID_CONFIG_STRUCTURE,
			message: "Setting 'syncMode' should be 'one-way' or 'two-way'",
			field: 'settings.syncMode'
		});
	}

	return result;
}

/**
 * Check for duplicate label names across categories
 *
 * @param {Object} categories - Categories object
 * @returns {Object} Duplicate check result
 */
export function checkDuplicateLabels(categories) {
	const result = {
		errors: [],
		warnings: [],
		duplicates: []
	};

	const labelNames = new Map(); // name -> {categories, instances}

	// Collect all label names
	for (const [categoryKey, category] of Object.entries(categories || {})) {
		if (category.labels && typeof category.labels === 'object') {
			for (const [labelKey, label] of Object.entries(category.labels)) {
				if (label.name) {
					const normalizedName = label.name.toLowerCase();

					if (!labelNames.has(normalizedName)) {
						labelNames.set(normalizedName, {
							originalName: label.name,
							categories: [],
							instances: []
						});
					}

					const entry = labelNames.get(normalizedName);
					entry.categories.push(categoryKey);
					entry.instances.push({
						category: categoryKey,
						labelKey,
						config: label
					});
				}
			}
		}
	}

	// Find duplicates
	for (const [normalizedName, entry] of labelNames.entries()) {
		if (entry.instances.length > 1) {
			result.duplicates.push({
				name: entry.originalName,
				normalizedName,
				instances: entry.instances,
				categories: entry.categories
			});

			result.errors.push({
				type: VALIDATION_ERRORS.DUPLICATE_LABEL,
				message: `Duplicate label name '${entry.originalName}' found in categories: ${entry.categories.join(', ')}`,
				field: `labels.${normalizedName}`
			});
		}
	}

	return result;
}

/**
 * Validate label consistency across Linear projects
 *
 * @param {Object} projectLabels - Object mapping project ID to labels array
 * @param {Object} labelSetsConfig - Label sets configuration
 * @returns {Object} Consistency validation result
 */
export function validateLabelConsistency(projectLabels, labelSetsConfig) {
	const result = {
		consistent: true,
		issues: [],
		recommendations: [],
		summary: {
			totalProjects: Object.keys(projectLabels).length,
			inconsistentLabels: 0,
			missingLabels: 0,
			extraLabels: 0
		}
	};

	// Get required labels from configuration
	const requiredLabels = new Map();
	Object.entries(labelSetsConfig.categories || {}).forEach(
		([categoryKey, category]) => {
			if (category.enabled && category.labels) {
				Object.entries(category.labels).forEach(([labelKey, labelConfig]) => {
					requiredLabels.set(labelConfig.name.toLowerCase(), {
						category: categoryKey,
						config: labelConfig
					});
				});
			}
		}
	);

	// Check each project
	for (const [projectId, labels] of Object.entries(projectLabels)) {
		const projectLabelNames = new Set(labels.map((l) => l.name.toLowerCase()));

		// Check for missing required labels
		for (const [requiredName, requiredInfo] of requiredLabels.entries()) {
			if (!projectLabelNames.has(requiredName)) {
				result.issues.push({
					type: 'missing_label',
					projectId,
					labelName: requiredInfo.config.name,
					category: requiredInfo.category,
					severity: requiredInfo.category === 'core' ? 'high' : 'medium'
				});
				result.summary.missingLabels++;
			}
		}

		// Check for color consistency
		labels.forEach((projectLabel) => {
			const requiredLabel = requiredLabels.get(projectLabel.name.toLowerCase());
			if (
				requiredLabel &&
				projectLabel.color.toLowerCase() !==
					requiredLabel.config.color.toLowerCase()
			) {
				result.issues.push({
					type: 'color_mismatch',
					projectId,
					labelName: projectLabel.name,
					expectedColor: requiredLabel.config.color,
					actualColor: projectLabel.color,
					severity: 'low'
				});
				result.summary.inconsistentLabels++;
			}
		});
	}

	// Generate recommendations
	if (result.summary.missingLabels > 0) {
		result.recommendations.push({
			type: 'create_missing',
			message: `Create ${result.summary.missingLabels} missing label(s) across projects`,
			priority: 'high'
		});
		result.consistent = false;
	}

	if (result.summary.inconsistentLabels > 0) {
		result.recommendations.push({
			type: 'fix_colors',
			message: `Fix ${result.summary.inconsistentLabels} color inconsistenc(ies)`,
			priority: 'medium'
		});
		result.consistent = false;
	}

	return result;
}
