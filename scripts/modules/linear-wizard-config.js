/**
 * @fileoverview Linear Configuration Setup for Wizard
 *
 * Handles creating and configuring Linear integration config during setup
 */

import fs from 'fs';
import path from 'path';
import { log } from './utils.js';

/**
 * Create Linear configuration from template
 *
 * @param {Object} wizardData - Wizard data with team/project info
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Configuration result
 */
export async function createLinearConfiguration(wizardData, options = {}) {
	const { projectRoot = process.cwd() } = options;

	try {
		// Paths
		const templatePath = path.join(
			projectRoot,
			'.taskmaster/templates/linear-config.json'
		);
		const configPath = path.join(projectRoot, '.taskmaster/linear-config.json');

		// Ensure template exists
		if (!fs.existsSync(templatePath)) {
			throw new Error('Linear configuration template not found');
		}

		// Read and parse template
		const templateContent = fs.readFileSync(templatePath, 'utf8');
		const config = JSON.parse(templateContent);

		// Update with wizard data
		config.enabled = true;
		config.team.id = wizardData.team.id;
		config.team.name = wizardData.team.name;
		config.project.id = wizardData.project.id;
		config.project.name = wizardData.project.name;

		// Update state mappings if provided
		if (wizardData.stateMappings) {
			// Update name-based mappings (keeping existing for backward compatibility)
			if (wizardData.stateMappings.name) {
				config.mappings.status = {
					...config.mappings.status,
					...wizardData.stateMappings.name
				};
			}

			// Add UUID-based mappings (preferred for reliability)
			if (wizardData.stateMappings.uuid) {
				config.mappings.statusUuid = wizardData.stateMappings.uuid;
			}

			// Store workflow states metadata for future reference
			if (wizardData.workflowStates) {
				config.metadata.workflowStates = {
					lastFetched: new Date().toISOString(),
					count: wizardData.workflowStates.length,
					states: wizardData.workflowStates.map((state) => ({
						id: state.id,
						name: state.name,
						type: state.type,
						color: state.color
					}))
				};
			}
		}

		// Update metadata
		config.metadata.createdAt = new Date().toISOString();
		config.metadata.lastUpdated = new Date().toISOString();

		// Write config file
		fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

		log('success', 'Linear configuration created from template');

		return {
			success: true,
			configPath,
			config
		};
	} catch (error) {
		log('error', `Failed to create Linear configuration: ${error.message}`);
		return {
			success: false,
			error: error.message
		};
	}
}

/**
 * Get configured labels from Linear config
 *
 * @param {string} configPath - Path to Linear config file
 * @returns {Array} Array of label configurations
 */
export function getConfiguredLabels(configPath) {
	try {
		const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
		const labels = [];

		// Extract all enabled labels
		Object.entries(config.labels.categories).forEach(
			([categoryKey, category]) => {
				if (category.enabled) {
					Object.entries(category.labels).forEach(([labelKey, labelConfig]) => {
						labels.push({
							categoryKey,
							labelKey,
							config: labelConfig
						});
					});
				}
			}
		);

		return labels;
	} catch (error) {
		log('error', `Failed to read configured labels: ${error.message}`);
		return [];
	}
}

/**
 * Update Linear config with label IDs
 *
 * @param {string} configPath - Path to Linear config file
 * @param {Array} syncResults - Results from label sync
 * @returns {boolean} Success status
 */
export function updateConfigWithLabelIds(configPath, syncResults) {
	try {
		const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

		// Update linearId fields with synced results
		syncResults.forEach((result) => {
			if (result.linearId && config.labels.categories[result.category]) {
				const category = config.labels.categories[result.category];
				if (category.labels[result.label]) {
					category.labels[result.label].linearId = result.linearId;
				}
			}
		});

		// Update metadata
		config.metadata.lastUpdated = new Date().toISOString();
		config.metadata.lastSync = new Date().toISOString();

		// Write updated config
		fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

		return true;
	} catch (error) {
		log('error', `Failed to update config with label IDs: ${error.message}`);
		return false;
	}
}
