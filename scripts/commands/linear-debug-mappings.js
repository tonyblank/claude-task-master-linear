#!/usr/bin/env node

/**
 * @fileoverview Linear State Mapping Debug Command
 *
 * CLI utility for debugging Linear workflow state mappings. Displays current
 * mappings, their status, configuration details, and provides troubleshooting
 * information for developers and advanced users.
 *
 * INTEGRATION COMMAND NAMING PATTERN:
 * ====================================
 * This command follows the pattern: linear-{command-name}
 * - linear-debug-mappings: Display current mappings and debug information
 */

import chalk from 'chalk';
import ora from 'ora';
import {
	getCurrentMappingConfiguration,
	getMappingRecommendations,
	detectMappingRefreshNeeds
} from '../modules/linear-status-mapping-manager.js';
import {
	getLinearConfig,
	getLinearApiKey,
	getLinearTeamId
} from '../modules/config-manager.js';
import { log, findProjectRoot } from '../modules/utils.js';

/**
 * Displays debug information about Linear state mappings
 *
 * @param {Object} options - Command line options
 * @param {boolean} options.verbose - Show detailed debug information
 * @param {boolean} options.config - Show raw configuration data
 * @param {boolean} options.json - Output in JSON format
 * @param {boolean} options.checkNeeds - Check if refresh is needed
 * @param {string} options.projectRoot - Project root directory
 */
export async function debugLinearMappings(options = {}) {
	const {
		verbose = false,
		config = false,
		json = false,
		checkNeeds = false,
		projectRoot = findProjectRoot()
	} = options;

	let spinner;

	try {
		// Collect all debug information
		const debugInfo = {
			timestamp: new Date().toISOString(),
			projectRoot,
			configuration: null,
			linearConfig: null,
			recommendations: null,
			refreshNeeds: null,
			systemInfo: {
				nodeVersion: process.version,
				platform: process.platform
			}
		};

		if (!json) {
			console.log(
				chalk.cyan.bold('\n🔧 Linear State Mapping Debug Information\n')
			);
			console.log(chalk.gray(`Generated at: ${debugInfo.timestamp}`));
			console.log(chalk.gray(`Project root: ${debugInfo.projectRoot}\n`));
		}

		// Step 1: Get current mapping configuration
		if (!json && verbose) log('info', 'Step 1: Loading Mapping Configuration');

		try {
			debugInfo.configuration = getCurrentMappingConfiguration(projectRoot);

			if (!json) {
				console.log(chalk.blue('=== CURRENT MAPPING CONFIGURATION ==='));

				if (debugInfo.configuration.error) {
					console.log(
						chalk.red(
							`❌ Configuration Error: ${debugInfo.configuration.error}`
						)
					);
				} else {
					console.log(
						`Mapping Type: ${chalk.yellow(debugInfo.configuration.effective.type)}`
					);
					console.log(
						`Mapped Statuses: ${chalk.yellow(debugInfo.configuration.effective.count)}/6`
					);
					console.log(
						`Configuration Complete: ${debugInfo.configuration.isFullyConfigured ? '✅ Yes' : '❌ No'}`
					);
					console.log(
						`Has UUID Mappings: ${debugInfo.configuration.hasUuidMappings ? '✅ Yes' : '❌ No'}`
					);
					console.log(
						`Has Name Mappings: ${debugInfo.configuration.hasNameMappings ? '✅ Yes' : '❌ No'}`
					);

					console.log(chalk.blue('\n--- Effective Mappings (In Use) ---'));
					if (
						Object.keys(debugInfo.configuration.effective.mapping).length > 0
					) {
						Object.entries(debugInfo.configuration.effective.mapping).forEach(
							([status, value]) => {
								const shortValue =
									value.length > 50 ? value.substring(0, 47) + '...' : value;
								console.log(`  ${status}: ${chalk.green(shortValue)}`);
							}
						);
					} else {
						console.log(chalk.red('  No mappings configured'));
					}

					if (verbose) {
						console.log(chalk.blue('\n--- Name-Based Mappings ---'));
						if (Object.keys(debugInfo.configuration.nameMapping).length > 0) {
							Object.entries(debugInfo.configuration.nameMapping).forEach(
								([status, name]) => {
									console.log(`  ${status}: ${chalk.cyan(name)}`);
								}
							);
						} else {
							console.log(chalk.gray('  None configured'));
						}

						console.log(chalk.blue('\n--- UUID-Based Mappings ---'));
						if (Object.keys(debugInfo.configuration.uuidMapping).length > 0) {
							Object.entries(debugInfo.configuration.uuidMapping).forEach(
								([status, uuid]) => {
									console.log(`  ${status}: ${chalk.magenta(uuid)}`);
								}
							);
						} else {
							console.log(chalk.gray('  None configured'));
						}
					}

					// Show missing statuses
					const missingStatuses =
						debugInfo.configuration.taskMasterStatuses.filter(
							(status) => !debugInfo.configuration.effective.mapping[status]
						);
					if (missingStatuses.length > 0) {
						console.log(chalk.red('\n--- Missing Mappings ---'));
						missingStatuses.forEach((status) => {
							console.log(chalk.red(`  ❌ ${status}`));
						});
					}
				}
			}
		} catch (error) {
			debugInfo.configuration = { error: error.message };
			if (!json) {
				console.log(
					chalk.red(`❌ Failed to load configuration: ${error.message}`)
				);
			}
		}

		// Step 2: Get Linear integration configuration
		if (!json && verbose)
			log('info', '\nStep 2: Loading Linear Integration Configuration');

		try {
			const linearConfig = getLinearConfig(projectRoot);
			const apiKey = getLinearApiKey(projectRoot);
			const teamId = getLinearTeamId(projectRoot);

			debugInfo.linearConfig = {
				hasConfig: !!linearConfig,
				hasApiKey: !!apiKey,
				hasTeamId: !!teamId,
				teamId: teamId || null,
				configPath: linearConfig ? 'Found' : 'Not found',
				apiKeySource: apiKey ? 'Environment' : 'Not configured'
			};

			if (!json) {
				console.log(chalk.blue('\n=== LINEAR INTEGRATION CONFIGURATION ==='));
				console.log(
					`Config File: ${debugInfo.linearConfig.hasConfig ? '✅ Found' : '❌ Not found'}`
				);
				console.log(
					`API Key: ${debugInfo.linearConfig.hasApiKey ? '✅ Configured' : '❌ Not configured'}`
				);
				console.log(
					`Team ID: ${debugInfo.linearConfig.hasTeamId ? '✅ Configured' : '❌ Not configured'}`
				);

				if (debugInfo.linearConfig.teamId) {
					console.log(
						`Team ID: ${chalk.yellow(debugInfo.linearConfig.teamId)}`
					);
				}

				if (verbose && config && linearConfig) {
					console.log(chalk.blue('\n--- Raw Linear Configuration ---'));
					console.log(JSON.stringify(linearConfig, null, 2));
				}
			}
		} catch (error) {
			debugInfo.linearConfig = { error: error.message };
			if (!json) {
				console.log(
					chalk.red(`❌ Failed to load Linear configuration: ${error.message}`)
				);
			}
		}

		// Step 3: Get recommendations
		if (!json && verbose) log('info', '\nStep 3: Generating Recommendations');

		try {
			debugInfo.recommendations = await getMappingRecommendations(projectRoot);

			if (!json && debugInfo.recommendations.recommendations) {
				console.log(chalk.blue('\n=== RECOMMENDATIONS ==='));

				if (debugInfo.recommendations.recommendations.length > 0) {
					debugInfo.recommendations.recommendations.forEach((rec) => {
						const icon =
							rec.type === 'error'
								? '❌'
								: rec.type === 'warning'
									? '⚠️'
									: rec.type === 'performance'
										? '🚀'
										: '💡';
						console.log(
							`${icon} ${chalk.yellow(rec.type.toUpperCase())}: ${rec.message}`
						);
						if (rec.action) {
							console.log(`   Action: ${chalk.cyan(rec.action)}`);
						}
						if (rec.benefits && rec.benefits.length > 0) {
							console.log(
								`   Benefits: ${chalk.green(rec.benefits.join(', '))}`
							);
						}
					});
				} else {
					console.log('✅ No issues found - configuration looks good!');
				}

				if (verbose && debugInfo.recommendations.analysis) {
					console.log(chalk.blue('\n--- Analysis Summary ---'));
					console.log(
						`Configuration Health: ${chalk.yellow(debugInfo.recommendations.analysis.configurationHealth)}`
					);
					console.log(
						`Performance Impact: ${chalk.yellow(debugInfo.recommendations.analysis.performanceImpact)}`
					);
					if (
						debugInfo.recommendations.analysis.maintenanceRequirements.length >
						0
					) {
						console.log(`Maintenance Requirements:`);
						debugInfo.recommendations.analysis.maintenanceRequirements.forEach(
							(req) => {
								console.log(`  • ${req}`);
							}
						);
					}
				}
			}
		} catch (error) {
			debugInfo.recommendations = { error: error.message };
			if (!json) {
				console.log(
					chalk.red(`❌ Failed to generate recommendations: ${error.message}`)
				);
			}
		}

		// Step 4: Check refresh needs (optional)
		if (checkNeeds) {
			if (!json && verbose) log('info', '\nStep 4: Checking Refresh Needs');

			try {
				debugInfo.refreshNeeds = await detectMappingRefreshNeeds({
					projectRoot,
					cacheMaxAge: 60 // 1 hour
				});

				if (!json) {
					console.log(chalk.blue('\n=== REFRESH NEEDS ANALYSIS ==='));
					console.log(
						`Refresh Needed: ${debugInfo.refreshNeeds.refreshNeeded ? '⚠️  Yes' : '✅ No'}`
					);

					if (
						debugInfo.refreshNeeds.reasons &&
						debugInfo.refreshNeeds.reasons.length > 0
					) {
						console.log('Reasons:');
						debugInfo.refreshNeeds.reasons.forEach((reason) => {
							console.log(`  • ${reason}`);
						});
					}

					if (debugInfo.refreshNeeds.nextSuggestedRefresh) {
						console.log(
							`Next Suggested Refresh: ${chalk.gray(debugInfo.refreshNeeds.nextSuggestedRefresh)}`
						);
					}
				}
			} catch (error) {
				debugInfo.refreshNeeds = { error: error.message };
				if (!json) {
					console.log(
						chalk.red(`❌ Failed to check refresh needs: ${error.message}`)
					);
				}
			}
		}

		// Output results
		if (json) {
			console.log(JSON.stringify(debugInfo, null, 2));
		} else {
			console.log(chalk.blue('\n=== TROUBLESHOOTING COMMANDS ==='));
			console.log(
				'🔄 Refresh mappings:     task-master linear-refresh-mappings'
			);
			console.log(
				'✅ Validate mappings:    task-master linear-validate-mappings'
			);
			console.log(
				'⚙️  Reconfigure setup:   task-master linear-sync-setup --reconfigure-states'
			);
			console.log('📋 Full setup:          task-master linear-sync-setup');

			if (verbose) {
				console.log(chalk.blue('\n=== DEBUG FLAGS ==='));
				console.log(
					'Add DEBUG=1 to any command for detailed error information'
				);
				console.log('Example: DEBUG=1 task-master linear-validate-mappings');
			}

			console.log(
				chalk.green.bold('\n🔧 Debug information collection complete!\n')
			);
		}

		return {
			success: true,
			debugInfo
		};
	} catch (error) {
		if (spinner) spinner.stop();

		if (json) {
			console.log(
				JSON.stringify(
					{
						success: false,
						error: error.message,
						timestamp: new Date().toISOString()
					},
					null,
					2
				)
			);
		} else {
			log('error', `Debug command failed: ${error.message}`);

			if (process.env.DEBUG === '1') {
				console.error(error);
			}

			console.log(
				chalk.cyan('\n💡 Try using --json flag for machine-readable output\n')
			);
		}

		return {
			success: false,
			error: error.message
		};
	}
}

/**
 * Command line interface for linear-debug-mappings
 */
export async function linearDebugMappingsCommand(options) {
	try {
		const result = await debugLinearMappings(options);

		if (!result.success) {
			process.exit(1);
		}

		process.exit(0);
	} catch (error) {
		log('error', `Debug command failed: ${error.message}`);
		process.exit(1);
	}
}

// Export for CLI registration
export default {
	command: 'linear-debug-mappings',
	description:
		'Display debug information about Linear state mappings and configuration',
	options: [
		{
			flags: '--verbose',
			description: 'Show detailed debug information'
		},
		{
			flags: '--config',
			description: 'Include raw configuration data in output'
		},
		{
			flags: '--json',
			description: 'Output debug information in JSON format'
		},
		{
			flags: '--check-needs',
			description: 'Check if mapping refresh is needed'
		},
		{
			flags: '--project-root <path>',
			description: 'Project root directory (defaults to current directory)'
		}
	],
	action: linearDebugMappingsCommand
};
