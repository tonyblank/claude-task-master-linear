#!/usr/bin/env node

/**
 * @fileoverview Linear State Mapping Validation Command
 *
 * CLI utility for validating Linear workflow state mappings against the current
 * Linear workspace. Checks if configured state names and UUIDs exist and provides
 * detailed feedback on mapping health.
 *
 * INTEGRATION COMMAND NAMING PATTERN:
 * ====================================
 * This command follows the pattern: linear-{command-name}
 * - linear-validate-mappings: Check if configured state mappings are valid
 */

import chalk from 'chalk';
import ora from 'ora';
import {
	validateStatusMappings,
	getCurrentMappingConfiguration,
	getMappingRecommendations
} from '../modules/linear-status-mapping-manager.js';
import { log, findProjectRoot } from '../modules/utils.js';

/**
 * Validates Linear state mappings against the current workspace
 *
 * @param {Object} options - Command line options
 * @param {boolean} options.workspace - Check against Linear workspace (default: true)
 * @param {boolean} options.detailed - Show detailed analysis and recommendations
 * @param {boolean} options.quiet - Only show errors and warnings
 * @param {string} options.projectRoot - Project root directory
 */
export async function validateLinearMappings(options = {}) {
	const {
		workspace = true,
		detailed = false,
		quiet = false,
		projectRoot = findProjectRoot()
	} = options;

	let spinner;

	try {
		if (!quiet) {
			console.log(chalk.cyan.bold('\n🔍 Linear State Mapping Validation\n'));
			console.log(
				chalk.gray(
					'This command validates your Linear state mappings and checks for issues.\n'
				)
			);
		}

		// Step 1: Check current configuration
		if (!quiet) log('info', 'Step 1: Analyzing Current Configuration');

		const currentConfig = getCurrentMappingConfiguration(projectRoot);

		if (currentConfig.error) {
			log('error', `Configuration error: ${currentConfig.error}`);
			process.exit(1);
		}

		// Basic configuration check
		const configValid = currentConfig.isFullyConfigured;

		if (!quiet) {
			console.log(chalk.blue('Configuration status:'));
			console.log(`  • Mapping type: ${currentConfig.effective.type}`);
			console.log(`  • Mapped statuses: ${currentConfig.effective.count}/6`);
			console.log(`  • Configuration complete: ${configValid ? 'Yes' : 'No'}`);

			if (!configValid) {
				const missingStatuses = currentConfig.taskMasterStatuses.filter(
					(status) => !currentConfig.effective.mapping[status]
				);
				console.log(
					chalk.yellow(`  • Missing mappings: ${missingStatuses.join(', ')}`)
				);
			}
		}

		// Step 2: Validate mapping format and structure
		if (!quiet) log('info', '\nStep 2: Format and Structure Validation');

		const structureValidation = {
			valid: true,
			issues: [],
			recommendations: []
		};

		// Check for required statuses
		const requiredStatuses = [
			'pending',
			'in-progress',
			'review',
			'done',
			'cancelled',
			'deferred'
		];
		const missingStatuses = requiredStatuses.filter(
			(status) => !currentConfig.effective.mapping[status]
		);

		if (missingStatuses.length > 0) {
			structureValidation.valid = false;
			structureValidation.issues.push(
				`Missing mappings for: ${missingStatuses.join(', ')}`
			);
		}

		// Check UUID format if using UUID mappings
		if (currentConfig.effective.type === 'uuid') {
			const uuidRegex =
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

			for (const [status, uuid] of Object.entries(
				currentConfig.effective.mapping
			)) {
				if (!uuidRegex.test(uuid)) {
					structureValidation.valid = false;
					structureValidation.issues.push(
						`Invalid UUID format for "${status}": ${uuid}`
					);
				}
			}
		}

		if (!quiet) {
			if (structureValidation.valid) {
				log('success', '✅ Structure validation passed');
			} else {
				log('warn', '⚠️  Structure validation found issues');
				structureValidation.issues.forEach((issue) =>
					console.log(chalk.yellow(`  • ${issue}`))
				);
			}
		}

		// Step 3: Linear workspace validation (optional)
		let workspaceValidation = { valid: true, skipped: !workspace };

		if (workspace) {
			if (!quiet) log('info', '\nStep 3: Linear Workspace Validation');

			spinner = ora('Checking mappings against Linear workspace...').start();

			try {
				workspaceValidation = await validateStatusMappings({
					projectRoot,
					checkLinearWorkspace: true
				});

				if (spinner) spinner.stop();

				if (!quiet) {
					if (workspaceValidation.valid) {
						log('success', '✅ Workspace validation passed');
					} else {
						log('warn', '⚠️  Workspace validation found issues');
						if (workspaceValidation.issues) {
							workspaceValidation.issues.forEach((issue) =>
								console.log(chalk.yellow(`  • ${issue}`))
							);
						}
					}
				}

				// Show workspace validation details if available
				if (workspaceValidation.workspaceValidation && !quiet) {
					const wsVal = workspaceValidation.workspaceValidation;
					if (!wsVal.success && wsVal.issues) {
						console.log(chalk.red('\nWorkspace-specific issues:'));
						wsVal.issues.forEach((issue) =>
							console.log(chalk.red(`  • ${issue}`))
						);
					}
				}
			} catch (error) {
				if (spinner) spinner.stop();

				workspaceValidation = {
					valid: false,
					error: error.message
				};

				if (!quiet) {
					log('error', `Workspace validation failed: ${error.message}`);
				}
			}
		} else {
			if (!quiet) {
				log('info', '\nStep 3: Linear Workspace Validation (SKIPPED)');
				console.log(
					chalk.gray('  Use --workspace to enable workspace validation')
				);
			}
		}

		// Step 4: Get detailed recommendations (if requested)
		let recommendations = { recommendations: [] };

		if (detailed) {
			if (!quiet)
				log('info', '\nStep 4: Detailed Analysis and Recommendations');

			try {
				recommendations = await getMappingRecommendations(projectRoot);

				if (
					recommendations.recommendations &&
					recommendations.recommendations.length > 0
				) {
					if (!quiet) {
						console.log(chalk.blue('\nRecommendations:'));
						recommendations.recommendations.forEach((rec) => {
							const icon =
								rec.type === 'error'
									? '❌'
									: rec.type === 'warning'
										? '⚠️'
										: rec.type === 'performance'
											? '🚀'
											: '💡';
							console.log(chalk.blue(`  ${icon} ${rec.message}`));
							if (rec.action) {
								console.log(chalk.gray(`     Action: ${rec.action}`));
							}
							if (rec.benefits && rec.benefits.length > 0) {
								console.log(
									chalk.gray(`     Benefits: ${rec.benefits.join(', ')}`)
								);
							}
						});
					}
				}

				if (recommendations.analysis && !quiet) {
					console.log(chalk.blue('\nConfiguration analysis:'));
					console.log(
						`  • Health: ${recommendations.analysis.configurationHealth}`
					);
					console.log(
						`  • Performance: ${recommendations.analysis.performanceImpact}`
					);
					if (recommendations.analysis.maintenanceRequirements.length > 0) {
						console.log(
							`  • Maintenance: ${recommendations.analysis.maintenanceRequirements.join(', ')}`
						);
					}
				}
			} catch (error) {
				if (!quiet) {
					log('warn', `Could not generate recommendations: ${error.message}`);
				}
			}
		}

		// Final result summary
		const overallValid = structureValidation.valid && workspaceValidation.valid;

		if (!quiet) {
			console.log(chalk.blue('\n--- Validation Summary ---'));
			console.log(
				`Structure validation: ${structureValidation.valid ? '✅ PASSED' : '❌ FAILED'}`
			);
			console.log(
				`Workspace validation: ${
					workspaceValidation.skipped
						? '⏭️  SKIPPED'
						: workspaceValidation.valid
							? '✅ PASSED'
							: '❌ FAILED'
				}`
			);
			console.log(
				`Overall result: ${overallValid ? '✅ VALID' : '❌ INVALID'}`
			);

			if (overallValid) {
				console.log(chalk.green.bold('\n🎉 All Linear mappings are valid!\n'));
			} else {
				console.log(
					chalk.red.bold(
						'\n❌ Linear mappings have issues that need attention\n'
					)
				);
				console.log(
					chalk.cyan('💡 Use linear-refresh-mappings to regenerate mappings')
				);
				console.log(
					chalk.cyan(
						'💡 Use linear-sync-setup --reconfigure-states to reconfigure\n'
					)
				);
			}
		}

		return {
			success: overallValid,
			structureValid: structureValidation.valid,
			workspaceValid: workspaceValidation.valid,
			workspaceChecked: workspace,
			issues: [
				...structureValidation.issues,
				...(workspaceValidation.issues || [])
			],
			recommendations: recommendations.recommendations || [],
			configuration: currentConfig
		};
	} catch (error) {
		if (spinner) spinner.stop();

		log('error', `Validation failed: ${error.message}`);

		if (process.env.DEBUG === '1') {
			console.error(error);
		}

		if (!quiet) {
			console.log(
				chalk.cyan(
					'\n💡 Try running linear-refresh-mappings to fix mapping issues\n'
				)
			);
		}

		return {
			success: false,
			error: error.message
		};
	}
}

/**
 * Command line interface for linear-validate-mappings
 */
export async function linearValidateMappingsCommand(options) {
	try {
		const result = await validateLinearMappings(options);

		// Exit with error code if validation failed
		if (!result.success) {
			process.exit(1);
		}

		process.exit(0);
	} catch (error) {
		log('error', `Validation command failed: ${error.message}`);
		process.exit(1);
	}
}

// Export for CLI registration
export default {
	command: 'linear-validate-mappings',
	description: 'Validate Linear state mappings against workspace configuration',
	options: [
		{
			flags: '--no-workspace',
			description: 'Skip validation against Linear workspace'
		},
		{
			flags: '--detailed',
			description: 'Show detailed analysis and recommendations'
		},
		{
			flags: '--quiet',
			description: 'Only show errors and warnings'
		},
		{
			flags: '--project-root <path>',
			description: 'Project root directory (defaults to current directory)'
		}
	],
	action: linearValidateMappingsCommand
};
