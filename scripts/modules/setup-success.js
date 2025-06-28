/**
 * @fileoverview Setup Success Confirmation and Help
 *
 * Displays setup completion message with summary of selections,
 * provides clear next steps, troubleshooting tips, and configuration testing.
 */

import chalk from 'chalk';
import boxen from 'boxen';
import inquirer from 'inquirer';
import { LinearClient } from '@linear/sdk';
import { log } from './utils.js';
import { validateExistingStateMappings } from './linear-state-mapping-selection.js';
import { getLinearConfigPath } from './linear-config-manager.js';
import fs from 'fs';

/**
 * Display formatted setup success message with configuration summary
 *
 * @param {Object} wizardData - Complete wizard data from setup process
 * @param {Object} options - Display options
 * @returns {Promise<Object>} Result with user choices
 */
export async function displaySetupSuccess(wizardData, options = {}) {
	const {
		dryRun = false,
		skipTest = false,
		projectRoot = process.cwd()
	} = options;

	// Create configuration summary
	const summary = createConfigurationSummary(wizardData, {
		dryRun,
		projectRoot
	});

	// Display success message
	displaySuccessMessage(summary, { dryRun });

	// Display next steps and help
	displayNextSteps({ dryRun });

	// Display troubleshooting and support info
	displayHelpAndSupport();

	// Ask about configuration testing (unless skipped or dry run)
	let shouldTest = false;
	if (!skipTest && !dryRun) {
		const testChoice = await inquirer.prompt([
			{
				type: 'confirm',
				name: 'testConfig',
				message: 'Would you like to test your Linear configuration now?',
				default: true
			}
		]);
		shouldTest = testChoice.testConfig;
	}

	return {
		success: true,
		shouldTest,
		summary
	};
}

/**
 * Create a comprehensive configuration summary
 *
 * @param {Object} wizardData - Wizard data
 * @param {Object} options - Options
 * @returns {Object} Configuration summary
 */
function createConfigurationSummary(wizardData, options = {}) {
	const { dryRun, projectRoot } = options;

	const teamName = wizardData.team
		? wizardData.team.name || wizardData.team.id
		: 'Unknown';
	const projectName = wizardData.project
		? typeof wizardData.project === 'string'
			? wizardData.project
			: wizardData.project.name || wizardData.project.id
		: 'Unknown';

	// Count configured labels
	let labelCount = 0;
	if (wizardData.labelConfiguration) {
		if (wizardData.labelConfiguration.categories) {
			labelCount += Object.keys(
				wizardData.labelConfiguration.categories
			).length;
		}
		if (wizardData.labelConfiguration.automation) {
			labelCount += Object.keys(
				wizardData.labelConfiguration.automation
			).length;
		}
	}

	return {
		user: {
			name: wizardData.userInfo?.name || 'Unknown',
			email: wizardData.userInfo?.email || 'Unknown'
		},
		team: {
			name: teamName,
			id: wizardData.team?.id || 'Unknown'
		},
		project: {
			name: projectName,
			id: wizardData.project?.id || 'Unknown'
		},
		labels: {
			count: labelCount,
			configured: !!wizardData.labelConfiguration
		},
		files: {
			env: dryRun
				? `${projectRoot}/.env (would be created/updated)`
				: `${projectRoot}/.env`,
			config: dryRun
				? `${projectRoot}/.taskmaster/linear-config.json (would be created)`
				: `${projectRoot}/.taskmaster/linear-config.json`,
			backup: dryRun ? `${projectRoot}/.env.backup.* (would be created)` : null
		},
		dryRun
	};
}

/**
 * Display the main success message with configuration details
 *
 * @param {Object} summary - Configuration summary
 * @param {Object} options - Display options
 */
function displaySuccessMessage(summary, options = {}) {
	const { dryRun } = options;

	const title = dryRun
		? '🧪 Linear Integration Setup Preview'
		: '✅ Linear Integration Setup Complete!';
	const titleColor = dryRun ? 'yellow' : 'green';

	console.log('\n' + chalk[titleColor].bold(title) + '\n');

	// Configuration summary box
	const summaryContent = [
		chalk.bold('📋 Configuration Summary:'),
		`   ${chalk.cyan('•')} User: ${summary.user.name} (${summary.user.email})`,
		`   ${chalk.cyan('•')} Team: ${summary.team.name}`,
		`   ${chalk.cyan('•')} Project: ${summary.project.name}`,
		`   ${chalk.cyan('•')} Labels: ${summary.labels.count} categories configured`,
		'',
		chalk.bold('📁 Files:'),
		`   ${chalk.cyan('•')} ${summary.files.env}`,
		`   ${chalk.cyan('•')} ${summary.files.config}`
	];

	if (summary.files.backup) {
		summaryContent.push(
			`   ${chalk.cyan('•')} Backup: ${summary.files.backup}`
		);
	}

	const summaryBox = boxen(summaryContent.join('\n'), {
		padding: 1,
		margin: { top: 0, bottom: 1, left: 0, right: 0 },
		borderStyle: 'round',
		borderColor: dryRun ? 'yellow' : 'green'
	});

	console.log(summaryBox);
}

/**
 * Display next steps and getting started guide
 *
 * @param {Object} options - Display options
 */
function displayNextSteps(options = {}) {
	const { dryRun } = options;

	if (dryRun) {
		console.log(chalk.yellow.bold('🧪 Dry Run Complete\n'));
		console.log(
			chalk.gray(
				'No files were actually created. Run without --dry-run to complete setup.\n'
			)
		);
		return;
	}

	const nextStepsContent = [
		chalk.bold('🚀 Next Steps:'),
		`   ${chalk.green('1.')} Run ${chalk.cyan('task-master help')} to see available commands`,
		`   ${chalk.green('2.')} Use ${chalk.cyan('task-master list')} to view your tasks`,
		`   ${chalk.green('3.')} Try ${chalk.cyan('task-master sync')} to test Linear integration`,
		`   ${chalk.green('4.')} Run ${chalk.cyan('task-master get-task <id>')} to view specific tasks`,
		'',
		chalk.bold('🔧 Configuration:'),
		`   ${chalk.cyan('•')} Edit ${chalk.yellow('linear-config.json')} to adjust preferences`,
		`   ${chalk.cyan('•')} Keep ${chalk.yellow('.env')} file secure (contains API keys)`,
		`   ${chalk.cyan('•')} Run setup again anytime with ${chalk.cyan('task-master sync-setup')}`
	];

	const nextStepsBox = boxen(nextStepsContent.join('\n'), {
		padding: 1,
		margin: { top: 0, bottom: 1, left: 0, right: 0 },
		borderStyle: 'round',
		borderColor: 'cyan'
	});

	console.log(nextStepsBox);
}

/**
 * Display troubleshooting tips and support information
 */
function displayHelpAndSupport() {
	const helpContent = [
		chalk.bold('🆘 Need Help?'),
		'',
		chalk.bold('📚 Documentation:'),
		`   ${chalk.cyan('•')} TaskMaster Guide: ${chalk.blue('https://github.com/eyaltoledano/claude-task-master#readme')}`,
		`   ${chalk.cyan('•')} Linear API Docs: ${chalk.blue('https://developers.linear.app/docs')}`,
		`   ${chalk.cyan('•')} MCP Integration: ${chalk.blue('https://docs.anthropic.com/en/docs/build-with-claude/computer-use')}`,
		'',
		chalk.bold('🔧 Common Issues:'),
		`   ${chalk.cyan('•')} API Key Issues: Check Linear Settings > API Keys`,
		`   ${chalk.cyan('•')} Permission Errors: Ensure API key has team access`,
		`   ${chalk.cyan('•')} Sync Problems: Verify team and project selections`,
		'',
		chalk.bold('💬 Support:'),
		`   ${chalk.cyan('•')} GitHub Issues: ${chalk.blue('https://github.com/eyaltoledano/claude-task-master/issues')}`,
		`   ${chalk.cyan('•')} Linear Community: ${chalk.blue('https://linear.app/docs/community')}`,
		`   ${chalk.cyan('•')} Debug Mode: Set ${chalk.yellow('DEBUG=1')} environment variable`
	];

	const helpBox = boxen(helpContent.join('\n'), {
		padding: 1,
		margin: { top: 0, bottom: 1, left: 0, right: 0 },
		borderStyle: 'round',
		borderColor: 'blue'
	});

	console.log(helpBox);
}

/**
 * Test the Linear configuration after setup
 *
 * @param {Object} wizardData - Wizard data with API key and selections
 * @param {Object} options - Test options
 * @returns {Promise<Object>} Test result
 */
export async function testConfiguration(wizardData, options = {}) {
	const { projectRoot = process.cwd() } = options;

	const testResult = {
		success: true,
		errors: [],
		warnings: [],
		tests: []
	};

	try {
		const client = new LinearClient({ apiKey: wizardData.apiKey });

		// Test 1: API connectivity
		try {
			const viewer = await client.viewer;
			testResult.tests.push({
				name: 'API Connectivity',
				status: 'passed',
				message: `Connected as ${viewer.name}`
			});
		} catch (error) {
			testResult.success = false;
			testResult.errors.push('API connectivity test failed');
			testResult.tests.push({
				name: 'API Connectivity',
				status: 'failed',
				message: error.message
			});
		}

		// Test 2: Team access
		if (wizardData.team) {
			try {
				const teamData = await client.team(wizardData.team.id);
				if (teamData) {
					testResult.tests.push({
						name: `Team Access: ${wizardData.team.name}`,
						status: 'passed',
						message: `Can access team "${wizardData.team.name}"`
					});
				} else {
					testResult.warnings.push(
						`Team "${wizardData.team.name}" not found or no access`
					);
					testResult.tests.push({
						name: `Team Access: ${wizardData.team.name}`,
						status: 'warning',
						message: 'Team not found or no access'
					});
				}
			} catch (error) {
				testResult.warnings.push(
					`Cannot access team "${wizardData.team.name}": ${error.message}`
				);
				testResult.tests.push({
					name: `Team Access: ${wizardData.team.name}`,
					status: 'warning',
					message: error.message
				});
			}
		}

		// Test 3: Project access
		if (wizardData.team && wizardData.project) {
			try {
				// Test specific project access instead of listing all projects
				const project = await client.project(wizardData.project.id);

				if (project && project.id) {
					testResult.tests.push({
						name: `Project Access: ${wizardData.project.name}`,
						status: 'passed',
						message: `Can access project "${project.name || project.id}"`
					});
				} else {
					testResult.warnings.push('Selected project not found or no access');
					testResult.tests.push({
						name: `Project Access: ${wizardData.project.name}`,
						status: 'warning',
						message: 'Project not found'
					});
				}
			} catch (error) {
				testResult.warnings.push(
					`Project access test failed: ${error.message}`
				);
				testResult.tests.push({
					name: `Project Access: ${wizardData.project.name}`,
					status: 'warning',
					message: error.message
				});
			}
		}

		// Test 4: Configuration file validation
		try {
			const configPath = getLinearConfigPath(projectRoot);

			if (fs.existsSync(configPath)) {
				const configContent = fs.readFileSync(configPath, 'utf8');
				const config = JSON.parse(configContent);

				if (config.version && config.labels && config.labels.categories) {
					testResult.tests.push({
						name: 'Configuration File',
						status: 'passed',
						message: 'Configuration file is valid'
					});
				} else {
					testResult.warnings.push(
						'Configuration file is missing required fields'
					);
					testResult.tests.push({
						name: 'Configuration File',
						status: 'warning',
						message: 'Missing required fields'
					});
				}
			} else {
				testResult.errors.push('Configuration file not found');
				testResult.tests.push({
					name: 'Configuration File',
					status: 'failed',
					message: 'File not found'
				});
			}
		} catch (error) {
			testResult.warnings.push(
				`Configuration file validation failed: ${error.message}`
			);
			testResult.tests.push({
				name: 'Configuration File',
				status: 'warning',
				message: error.message
			});
		}

		// Test 5: State mapping validation
		if (wizardData.stateMappings && wizardData.team) {
			try {
				const validationResult = await validateExistingStateMappings(
					wizardData.apiKey,
					wizardData.team.id,
					wizardData.stateMappings
				);

				if (validationResult.success && validationResult.validation.isValid) {
					testResult.tests.push({
						name: 'State Mappings',
						status: 'passed',
						message: `All mappings valid (${validationResult.validation.coverage.toFixed(1)}% coverage)`
					});
				} else if (validationResult.success) {
					const validation = validationResult.validation;
					if (validation.errors.length > 0) {
						testResult.warnings.push('State mapping validation errors found');
						testResult.tests.push({
							name: 'State Mappings',
							status: 'warning',
							message: `${validation.errors.length} errors, ${validation.warnings.length} warnings`
						});
					} else {
						testResult.tests.push({
							name: 'State Mappings',
							status: 'passed',
							message: `Valid with ${validation.warnings.length} warnings (${validation.coverage.toFixed(1)}% coverage)`
						});
					}
				} else {
					testResult.warnings.push('Could not validate state mappings');
					testResult.tests.push({
						name: 'State Mappings',
						status: 'warning',
						message: validationResult.error || 'Validation failed'
					});
				}
			} catch (error) {
				testResult.warnings.push(
					`State mapping validation failed: ${error.message}`
				);
				testResult.tests.push({
					name: 'State Mappings',
					status: 'warning',
					message: 'Could not validate mappings'
				});
			}
		} else if (wizardData.team) {
			testResult.tests.push({
				name: 'State Mappings',
				status: 'warning',
				message: 'No state mappings configured'
			});
		}

		// Display test results
		console.log(chalk.bold('\n🧪 Configuration Test Results:\n'));

		testResult.tests.forEach((test) => {
			let icon, color;
			switch (test.status) {
				case 'passed':
					icon = '✅';
					color = 'green';
					break;
				case 'warning':
					icon = '⚠️';
					color = 'yellow';
					break;
				case 'failed':
					icon = '❌';
					color = 'red';
					break;
				default:
					icon = '🔍';
					color = 'gray';
			}

			console.log(`   ${icon} ${chalk[color](test.name)}: ${test.message}`);
		});

		console.log(''); // Empty line
	} catch (error) {
		testResult.success = false;
		testResult.errors.push(`Configuration testing failed: ${error.message}`);

		log('error', `Configuration test error: ${error.message}`);
	}

	return testResult;
}
