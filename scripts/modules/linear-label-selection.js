/**
 * @fileoverview Linear Label Selection Module
 *
 * This module provides interactive interfaces for users to:
 * - Configure label category preferences
 * - Review and confirm label creation
 * - Select specific labels to track
 * - Configure label automation rules
 */

import {
	LinearLabelManager,
	LABEL_MANAGEMENT_ERRORS
} from './linear-label-management.js';
import { log } from './utils.js';
import { promptConfigs, messages } from './prompts.js';
import inquirer from 'inquirer';

/**
 * Linear label selection and configuration functionality
 */
export class LinearLabelSelector {
	/**
	 * @param {Object} config - Configuration object
	 * @param {string} config.apiKey - Linear API key
	 * @param {string} config.projectRoot - TaskMaster project root directory
	 * @param {string} config.teamId - Linear team ID
	 * @param {string[]} config.projectIds - Array of Linear project IDs
	 */
	constructor(config = {}) {
		this.config = {
			...config
		};

		if (!this.config.apiKey) {
			throw new Error('Linear API key is required');
		}

		if (!this.config.projectRoot) {
			throw new Error('Project root directory is required');
		}

		if (!this.config.teamId) {
			throw new Error('Linear team ID is required');
		}

		if (!this.config.projectIds || !Array.isArray(this.config.projectIds)) {
			throw new Error('Project IDs array is required');
		}

		this.labelManager = new LinearLabelManager({
			apiKey: this.config.apiKey,
			projectRoot: this.config.projectRoot
		});
	}

	/**
	 * Run the complete label configuration workflow
	 *
	 * @param {Object} options - Configuration options
	 * @returns {Promise<Object>} Configuration result
	 */
	async configureLabelPreferences(options = {}) {
		try {
			messages.header('Label Preference Configuration');
			console.log(
				'Configure which labels TaskMaster will use and manage in Linear.\\n'
			);

			// Step 1: Load and analyze current configuration
			const labelSetsConfig = this.labelManager.loadLabelSetsConfig();
			const { allUniqueLabels } =
				await this.labelManager.fetchOrganizationLabels();
			const analysis = this.labelManager.analyzeLabelDelta(
				labelSetsConfig,
				allUniqueLabels,
				this.config.teamId
			);

			// Stop spinner after data fetching but before interactive prompts
			if (options.spinner) {
				options.spinner.stop();
			}

			// Step 2: Display current status
			this._displayCurrentStatus(analysis);

			// Step 3: Configure label categories
			const updatedConfig =
				await this._configureLabelCategories(labelSetsConfig);

			// Step 4: Re-analyze with updated configuration
			const updatedAnalysis = this.labelManager.analyzeLabelDelta(
				updatedConfig,
				allUniqueLabels,
				this.config.teamId
			);

			// Step 5: Review and create missing labels
			const creationResults =
				await this._reviewAndCreateLabels(updatedAnalysis);

			// Step 6: Configure automation settings
			const finalConfig =
				await this._configureAutomationSettings(updatedConfig);

			// Step 7: Save configuration
			this.labelManager.saveLabelSetsConfig(finalConfig);

			// Step 8: Display summary
			this._displayConfigurationSummary(finalConfig, creationResults);

			return {
				config: finalConfig,
				analysis: updatedAnalysis,
				creationResults,
				success: true
			};
		} catch (error) {
			messages.error(`Label configuration failed: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Display current label configuration status
	 *
	 * @param {Object} analysis - Label analysis result
	 * @private
	 */
	_displayCurrentStatus(analysis) {
		messages.info('📊 Current Configuration Status:');
		console.log(
			`   • Enabled Categories: ${analysis.enabledCategories.length}`
		);
		console.log(`   • Required Labels: ${analysis.summary.totalRequired}`);
		console.log(`   • Missing Labels: ${analysis.summary.totalMissing}`);
		console.log(`   • Conflicts: ${analysis.summary.totalConflicts}\\n`);

		if (analysis.enabledCategories.length > 0) {
			console.log('📋 Enabled Categories:');
			analysis.enabledCategories.forEach((category) => {
				const autoApplyText = category.autoApply ? ' (auto-apply)' : '';
				console.log(
					`   • ${category.name}: ${category.labelCount} labels${autoApplyText}`
				);
			});
			console.log('');
		}

		if (analysis.summary.totalMissing > 0) {
			messages.warning(
				`${analysis.summary.totalMissing} label(s) need to be created in Linear`
			);
		}

		if (analysis.summary.totalConflicts > 0) {
			messages.warning(
				`${analysis.summary.totalConflicts} configuration conflict(s) detected`
			);
		}
	}

	/**
	 * Interactive configuration of label categories
	 *
	 * @param {Object} labelSetsConfig - Current label sets configuration
	 * @returns {Promise<Object>} Updated configuration
	 * @private
	 */
	async _configureLabelCategories(labelSetsConfig) {
		messages.header('Label Category Configuration');
		console.log(
			'Choose which types of labels you want TaskMaster to manage:\\n'
		);

		// Display category information
		const categoryChoices = Object.entries(labelSetsConfig.categories).map(
			([key, category]) => {
				const labelCount = Object.keys(category.labels).length;
				const autoApplyText = category.autoApply ? ' [Auto-Apply]' : '';

				return {
					name: `${category.description || key} (${labelCount} labels)${autoApplyText}`,
					value: key,
					checked: category.enabled,
					short: category.description || key
				};
			}
		);

		// Add explanation for each category
		console.log('📝 Category Descriptions:');
		Object.entries(labelSetsConfig.categories).forEach(([key, category]) => {
			console.log(`   • ${category.description || key}:`);

			if (key === 'core') {
				console.log(
					'     Essential labels like "taskmaster" for tracking managed issues'
				);
			} else if (key === 'types') {
				console.log(
					'     Issue classification: Bug, Feature, Improvement, etc.'
				);
			} else if (key === 'languages') {
				console.log('     Programming language detection and filtering');
			}
		});
		console.log('');

		const categorySelection = await inquirer.prompt([
			promptConfigs.checkbox(
				'enabledCategories',
				'Select label categories to enable',
				categoryChoices,
				{
					required: true,
					pageSize: Math.min(10, categoryChoices.length + 2)
				}
			)
		]);

		// Update configuration with selected categories
		const updatedConfig = { ...labelSetsConfig };
		Object.keys(updatedConfig.categories).forEach((key) => {
			updatedConfig.categories[key].enabled =
				categorySelection.enabledCategories.includes(key);
		});

		// Configure language detection if languages category is enabled
		if (categorySelection.enabledCategories.includes('languages')) {
			const languageConfig = await this._configureLanguageDetection(
				updatedConfig.categories.languages
			);
			updatedConfig.categories.languages = {
				...updatedConfig.categories.languages,
				...languageConfig
			};
		}

		messages.success(
			`Configured ${categorySelection.enabledCategories.length} label categories`
		);

		return updatedConfig;
	}

	/**
	 * Configure language detection settings
	 *
	 * @param {Object} languageCategory - Language category configuration
	 * @returns {Promise<Object>} Updated language category config
	 * @private
	 */
	async _configureLanguageDetection(languageCategory) {
		messages.info('⚙️ Language Detection Configuration');
		console.log(
			'TaskMaster can automatically detect programming languages from task content.\\n'
		);

		const languageSettings = await inquirer.prompt([
			promptConfigs.confirm(
				'autoDetect',
				'Enable automatic language detection from file paths',
				languageCategory.autoDetect
			),
			promptConfigs.confirm(
				'autoApply',
				'Automatically apply language labels to detected tasks',
				languageCategory.autoApply
			)
		]);

		return {
			autoDetect: languageSettings.autoDetect,
			autoApply: languageSettings.autoApply
		};
	}

	/**
	 * Review missing labels and provide manual creation instructions
	 *
	 * @param {Object} analysis - Updated label analysis
	 * @returns {Promise<Object>} Label creation results
	 * @private
	 */
	async _reviewAndCreateLabels(analysis) {
		if (analysis.summary.totalMissing === 0) {
			messages.success('✅ All required labels already exist in Linear');
			return { created: [], skipped: [], errors: [] };
		}

		messages.header('Label Creation Instructions');
		console.log(
			`${analysis.summary.totalMissing} label(s) need to be created in Linear:\n`
		);

		// Display API limitation notice
		console.log('⚠️  Linear API Limitation:');
		console.log(
			"   Linear's GraphQL API does not support creating labels programmatically."
		);
		console.log('   Labels must be created manually through the Linear UI.\n');

		// Group missing labels by category
		const labelsByCategory = {};
		analysis.missingLabels.forEach((label) => {
			if (!labelsByCategory[label.categoryKey]) {
				labelsByCategory[label.categoryKey] = [];
			}
			labelsByCategory[label.categoryKey].push(label);
		});

		// Display labels to be created with instructions
		console.log('📋 Labels to create manually:');
		Object.entries(labelsByCategory).forEach(([categoryKey, labels]) => {
			const categoryName =
				analysis.enabledCategories.find((c) => c.key === categoryKey)?.name ||
				categoryKey;
			console.log(`\n📂 ${categoryName}:`);

			labels.forEach((label) => {
				console.log(`   • ${label.config.name}`);
				console.log(`     Color: ${label.config.color}`);
				console.log(`     Description: ${label.config.description}`);
			});
		});

		console.log('\n🛠️  Manual Creation Steps:');
		console.log('1. Go to your Linear team settings');
		console.log('2. Navigate to the Labels section');
		console.log(
			'3. Create each label with the exact name, color, and description shown above'
		);
		console.log('4. Run the sync command to detect and store the label IDs');

		console.log('\n💡 Next Steps:');
		console.log('   • Create the labels shown above in Linear manually');
		console.log(
			'   • Run `linear-sync-labels` command to detect and sync the labels'
		);
		console.log('   • Continue with your TaskMaster configuration\n');

		const results = {
			created: [],
			skipped: analysis.missingLabels,
			errors: [],
			requiresManualCreation: true
		};

		return results;
	}

	/**
	 * Configure label automation settings
	 *
	 * @param {Object} labelSetsConfig - Current label sets configuration
	 * @returns {Promise<Object>} Updated configuration with automation settings
	 * @private
	 */
	async _configureAutomationSettings(labelSetsConfig) {
		messages.header('Label Automation Configuration');
		console.log(
			'Configure how TaskMaster automatically applies labels to issues:\\n'
		);

		// Core label automation (taskmaster label)
		if (labelSetsConfig.categories.core?.enabled) {
			console.log('🏷️ Core Label Automation:');
			console.log(
				'   • The "taskmaster" label identifies issues managed by TaskMaster'
			);
			console.log(
				'   • Recommended: Enable automatic application to all managed issues\\n'
			);

			const coreAutomation = await inquirer.prompt([
				promptConfigs.confirm(
					'autoApplyTaskmaster',
					'Automatically apply "taskmaster" label to all managed issues',
					labelSetsConfig.categories.core.autoApply !== false
				)
			]);

			labelSetsConfig.categories.core.autoApply =
				coreAutomation.autoApplyTaskmaster;
		}

		// Type label automation
		if (labelSetsConfig.categories.types?.enabled) {
			console.log('📋 Type Label Guidelines:');
			console.log(
				'   • Type labels (Bug, Feature, etc.) are typically set manually'
			);
			console.log('   • TaskMaster can suggest types based on task content\\n');

			const typeAutomation = await inquirer.prompt([
				promptConfigs.confirm(
					'suggestTypes',
					'Enable type label suggestions based on task content',
					labelSetsConfig.categories.types.autoSuggest !== false
				)
			]);

			labelSetsConfig.categories.types.autoSuggest =
				typeAutomation.suggestTypes;
			labelSetsConfig.categories.types.autoApply = false; // Types should be manual
		}

		// Language label automation
		if (
			labelSetsConfig.categories.languages?.enabled &&
			labelSetsConfig.categories.languages.autoDetect
		) {
			console.log('💻 Language Label Automation:');
			console.log(
				'   • Language labels are detected from file paths in task content'
			);
			console.log(
				'   • Can be applied automatically or suggested for manual review\\n'
			);

			const langAutomation = await inquirer.prompt([
				promptConfigs.list(
					'languageMode',
					'How should language labels be applied',
					[
						{
							name: '🤖 Automatic - Apply detected language labels automatically',
							value: 'automatic'
						},
						{
							name: '💡 Suggest - Show suggestions for manual review',
							value: 'suggest'
						},
						{
							name: '📝 Manual - No automatic detection or suggestions',
							value: 'manual'
						}
					]
				)
			]);

			labelSetsConfig.categories.languages.autoApply =
				langAutomation.languageMode === 'automatic';
			labelSetsConfig.categories.languages.autoSuggest =
				langAutomation.languageMode === 'suggest';
		}

		// Sync settings
		console.log('🔄 Synchronization Settings:');
		const syncSettings = await inquirer.prompt([
			promptConfigs.confirm(
				'syncOnStatusChange',
				'Update Linear labels when task status changes',
				labelSetsConfig.settings?.syncOnStatusChange !== false
			),
			promptConfigs.confirm(
				'createMissing',
				'Automatically create missing labels during sync',
				labelSetsConfig.settings?.createMissing !== false
			)
		]);

		// Update settings
		labelSetsConfig.settings = {
			...labelSetsConfig.settings,
			syncOnStatusChange: syncSettings.syncOnStatusChange,
			createMissing: syncSettings.createMissing
		};

		messages.success('Label automation configured successfully');

		return labelSetsConfig;
	}

	/**
	 * Display final configuration summary
	 *
	 * @param {Object} finalConfig - Final label configuration
	 * @param {Object} creationResults - Label creation results
	 * @private
	 */
	_displayConfigurationSummary(finalConfig, creationResults) {
		messages.header('Configuration Summary');

		// Categories summary
		const enabledCategories = Object.entries(finalConfig.categories).filter(
			([_, category]) => category.enabled
		);

		console.log('📊 Label Categories:');
		enabledCategories.forEach(([key, category]) => {
			const labelCount = Object.keys(category.labels).length;
			const autoText = category.autoApply ? ' (auto-apply)' : '';
			console.log(
				`   ✅ ${category.description || key}: ${labelCount} labels${autoText}`
			);
		});

		// Creation summary
		if (creationResults.created.length > 0) {
			console.log(`\\n🆕 Created Labels: ${creationResults.created.length}`);
			creationResults.created.forEach((result) => {
				console.log(`   • ${result.label.name} (${result.category})`);
			});
		}

		if (creationResults.errors.length > 0) {
			console.log(`\\n❌ Failed to Create: ${creationResults.errors.length}`);
			creationResults.errors.forEach((error) => {
				console.log(`   • ${error.config.name}: ${error.error}`);
			});
		}

		// Configuration file location
		console.log(`\\n📁 Configuration saved to:`);
		console.log(`   ${this.labelManager.labelSetsPath}`);

		console.log(`\\n💡 Next Steps:`);
		console.log(
			`   • Run the setup wizard again to detect changes: npm run setup`
		);
		console.log(
			`   • Use audit command to sync label changes: npm run audit:labels`
		);
		console.log(
			`   • Edit label-sets.json to customize core, type, and language labels`
		);

		messages.success('✅ Label configuration completed successfully!');
	}

	/**
	 * Quick label validation for existing projects
	 *
	 * @returns {Promise<Object>} Validation results
	 */
	async validateLabelConfiguration() {
		try {
			const labelSetsConfig = this.labelManager.loadLabelSetsConfig();
			const { allUniqueLabels } =
				await this.labelManager.fetchOrganizationLabels();
			const analysis = this.labelManager.analyzeLabelDelta(
				labelSetsConfig,
				allUniqueLabels,
				this.config.teamId
			);

			return {
				valid:
					analysis.summary.totalMissing === 0 &&
					analysis.summary.totalConflicts === 0,
				analysis,
				recommendations: analysis.recommendations
			};
		} catch (error) {
			return {
				valid: false,
				error: error.message,
				recommendations: [
					{
						type: 'fix_config',
						message: `Fix configuration error: ${error.message}`,
						priority: 'high'
					}
				]
			};
		}
	}
}

/**
 * Convenience function to create and use label selector
 *
 * @param {string} apiKey - Linear API key
 * @param {string} projectRoot - TaskMaster project root directory
 * @param {string} teamId - Linear team ID
 * @param {string[]} projectIds - Array of Linear project IDs
 * @returns {LinearLabelSelector} Label selector instance
 */
export function createLabelSelector(apiKey, projectRoot, teamId, projectIds) {
	return new LinearLabelSelector({ apiKey, projectRoot, teamId, projectIds });
}

/**
 * Convenience function to run label configuration workflow
 *
 * @param {string} apiKey - Linear API key
 * @param {string} projectRoot - TaskMaster project root directory
 * @param {string} teamId - Linear team ID
 * @param {string[]} projectIds - Array of Linear project IDs
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Configuration result
 */
export async function configureLabelPreferences(
	apiKey,
	projectRoot,
	teamId,
	projectIds,
	options = {}
) {
	const selector = createLabelSelector(apiKey, projectRoot, teamId, projectIds);
	return await selector.configureLabelPreferences(options);
}
