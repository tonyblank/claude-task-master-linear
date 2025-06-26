/**
 * @fileoverview Linear Label Audit Module
 *
 * This module provides audit and reconciliation functionality for Linear labels.
 * It allows users to sync configuration changes, fix inconsistencies, and
 * maintain label consistency across projects.
 */

import {
	LinearLabelManager,
	LABEL_MANAGEMENT_ERRORS
} from './linear-label-management.js';
import {
	validateLabelSetsConfig,
	validateLabelConsistency
} from './linear-label-validation.js';
import { log } from './utils.js';
import { messages } from './prompts.js';

/**
 * Audit result types
 */
export const AUDIT_RESULT_TYPES = {
	SUCCESS: 'SUCCESS',
	WARNING: 'WARNING',
	ERROR: 'ERROR',
	INFO: 'INFO'
};

/**
 * Linear label audit and reconciliation functionality
 */
export class LinearLabelAuditor {
	/**
	 * @param {Object} config - Configuration object
	 * @param {string} config.apiKey - Linear API key
	 * @param {string} config.projectRoot - TaskMaster project root directory
	 * @param {string} config.teamId - Linear team ID
	 * @param {string[]} config.projectIds - Array of Linear project IDs
	 */
	constructor(config = {}) {
		this.config = {
			dryRun: false,
			verbose: false,
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
	 * Run comprehensive label audit
	 *
	 * @param {Object} options - Audit options
	 * @param {boolean} options.dryRun - Only report issues, don't fix them
	 * @param {boolean} options.autoFix - Automatically fix issues where possible
	 * @returns {Promise<Object>} Audit result
	 */
	async runLabelAudit(options = {}) {
		const auditOptions = { ...this.config, ...options };

		const auditResult = {
			timestamp: new Date().toISOString(),
			options: auditOptions,
			phases: {
				configValidation: null,
				projectLabelFetch: null,
				consistencyCheck: null,
				reconciliation: null
			},
			summary: {
				totalIssues: 0,
				fixedIssues: 0,
				remainingIssues: 0,
				success: false
			},
			recommendations: []
		};

		try {
			messages.header('Linear Label Audit');
			console.log(
				`Auditing ${this.config.projectIds.length} project(s) for label consistency...\\n`
			);

			// Phase 1: Validate configuration
			auditResult.phases.configValidation = await this._validateConfiguration();
			this._displayPhaseResult(
				'Configuration Validation',
				auditResult.phases.configValidation
			);

			// Phase 2: Fetch project labels
			auditResult.phases.projectLabelFetch = await this._fetchProjectLabels();
			this._displayPhaseResult(
				'Project Label Fetch',
				auditResult.phases.projectLabelFetch
			);

			// Phase 3: Consistency check
			auditResult.phases.consistencyCheck = await this._checkConsistency(
				auditResult.phases.configValidation.config,
				auditResult.phases.projectLabelFetch.projectLabels
			);
			this._displayPhaseResult(
				'Consistency Check',
				auditResult.phases.consistencyCheck
			);

			// Phase 4: Reconciliation (if not dry run and auto-fix enabled)
			if (!auditOptions.dryRun && auditOptions.autoFix) {
				auditResult.phases.reconciliation = await this._reconcileLabels(
					auditResult.phases.consistencyCheck.issues
				);
				this._displayPhaseResult(
					'Label Reconciliation',
					auditResult.phases.reconciliation
				);
			}

			// Calculate summary
			auditResult.summary = this._calculateAuditSummary(auditResult.phases);
			this._displayAuditSummary(auditResult);

			return auditResult;
		} catch (error) {
			messages.error(`Audit failed: ${error.message}`);
			auditResult.summary.success = false;
			auditResult.error = error.message;
			throw error;
		}
	}

	/**
	 * Validate label configuration
	 *
	 * @returns {Promise<Object>} Validation phase result
	 * @private
	 */
	async _validateConfiguration() {
		const phaseResult = {
			type: 'config_validation',
			success: false,
			config: null,
			issues: [],
			duration: 0
		};

		const startTime = Date.now();

		try {
			// Load configuration
			phaseResult.config = this.labelManager.loadLabelSetsConfig();

			// Validate structure
			const validation = validateLabelSetsConfig(phaseResult.config);

			// Convert validation results to audit format
			validation.errors.forEach((error) => {
				phaseResult.issues.push({
					type: AUDIT_RESULT_TYPES.ERROR,
					category: 'configuration',
					message: error.message,
					field: error.field,
					fixable: false
				});
			});

			validation.warnings.forEach((warning) => {
				phaseResult.issues.push({
					type: AUDIT_RESULT_TYPES.WARNING,
					category: 'configuration',
					message: warning.message,
					field: warning.field,
					fixable: false
				});
			});

			phaseResult.success = validation.valid;
			phaseResult.summary = validation.summary;
		} catch (error) {
			phaseResult.issues.push({
				type: AUDIT_RESULT_TYPES.ERROR,
				category: 'configuration',
				message: `Failed to load configuration: ${error.message}`,
				fixable: false
			});
		}

		phaseResult.duration = Date.now() - startTime;
		return phaseResult;
	}

	/**
	 * Fetch labels from all projects
	 *
	 * @returns {Promise<Object>} Fetch phase result
	 * @private
	 */
	async _fetchProjectLabels() {
		const phaseResult = {
			type: 'project_fetch',
			success: false,
			projectLabels: {},
			issues: [],
			duration: 0
		};

		const startTime = Date.now();

		try {
			phaseResult.projectLabels =
				await this.labelManager.fetchMultipleProjectLabels(
					this.config.projectIds
				);

			// Check for fetch errors
			let successfulFetches = 0;
			for (const [projectId, labels] of Object.entries(
				phaseResult.projectLabels
			)) {
				if (Array.isArray(labels) && labels.length >= 0) {
					successfulFetches++;
				} else {
					phaseResult.issues.push({
						type: AUDIT_RESULT_TYPES.ERROR,
						category: 'project_access',
						message: `Failed to fetch labels from project ${projectId}`,
						projectId,
						fixable: false
					});
				}
			}

			phaseResult.success = successfulFetches === this.config.projectIds.length;
			phaseResult.summary = {
				totalProjects: this.config.projectIds.length,
				successfulFetches,
				failedFetches: this.config.projectIds.length - successfulFetches
			};
		} catch (error) {
			phaseResult.issues.push({
				type: AUDIT_RESULT_TYPES.ERROR,
				category: 'project_access',
				message: `Failed to fetch project labels: ${error.message}`,
				fixable: false
			});
		}

		phaseResult.duration = Date.now() - startTime;
		return phaseResult;
	}

	/**
	 * Check label consistency across projects
	 *
	 * @param {Object} config - Label sets configuration
	 * @param {Object} projectLabels - Project labels data
	 * @returns {Promise<Object>} Consistency check phase result
	 * @private
	 */
	async _checkConsistency(config, projectLabels) {
		const phaseResult = {
			type: 'consistency_check',
			success: false,
			issues: [],
			duration: 0
		};

		const startTime = Date.now();

		try {
			// Run consistency validation
			const consistencyResult = validateLabelConsistency(projectLabels, config);

			// Convert consistency issues to audit format
			consistencyResult.issues.forEach((issue) => {
				let auditIssue = {
					category: 'consistency',
					projectId: issue.projectId,
					labelName: issue.labelName
				};

				switch (issue.type) {
					case 'missing_label':
						auditIssue = {
							...auditIssue,
							type: AUDIT_RESULT_TYPES.ERROR,
							message: `Missing required label '${issue.labelName}' in project ${issue.projectId}`,
							fixable: true,
							fix: {
								action: 'create_label',
								teamId: this.config.teamId,
								labelConfig:
									config.categories[issue.category]?.labels?.[
										issue.labelName.toLowerCase()
									]
							}
						};
						break;

					case 'color_mismatch':
						auditIssue = {
							...auditIssue,
							type: AUDIT_RESULT_TYPES.WARNING,
							message: `Label '${issue.labelName}' has different color in project ${issue.projectId}`,
							expectedColor: issue.expectedColor,
							actualColor: issue.actualColor,
							fixable: false // Label updates require manual intervention
						};
						break;

					default:
						auditIssue = {
							...auditIssue,
							type: AUDIT_RESULT_TYPES.INFO,
							message: `Consistency issue: ${issue.type}`,
							fixable: false
						};
				}

				phaseResult.issues.push(auditIssue);
			});

			phaseResult.success = consistencyResult.consistent;
			phaseResult.summary = consistencyResult.summary;
			phaseResult.recommendations = consistencyResult.recommendations;
		} catch (error) {
			phaseResult.issues.push({
				type: AUDIT_RESULT_TYPES.ERROR,
				category: 'consistency',
				message: `Consistency check failed: ${error.message}`,
				fixable: false
			});
		}

		phaseResult.duration = Date.now() - startTime;
		return phaseResult;
	}

	/**
	 * Reconcile label issues by creating missing labels
	 *
	 * @param {Array} issues - Issues to fix
	 * @returns {Promise<Object>} Reconciliation phase result
	 * @private
	 */
	async _reconcileLabels(issues) {
		const phaseResult = {
			type: 'reconciliation',
			success: false,
			fixed: [],
			failed: [],
			skipped: [],
			duration: 0
		};

		const startTime = Date.now();

		const fixableIssues = issues.filter((issue) => issue.fixable);

		if (fixableIssues.length === 0) {
			phaseResult.success = true;
			phaseResult.duration = Date.now() - startTime;
			return phaseResult;
		}

		try {
			for (const issue of fixableIssues) {
				if (issue.fix?.action === 'create_label') {
					try {
						const createdLabel = await this.labelManager.createLabel(
							issue.fix.teamId,
							issue.fix.labelConfig
						);

						phaseResult.fixed.push({
							issue,
							result: createdLabel,
							action: 'created'
						});

						log(
							'info',
							`Fixed: Created label '${createdLabel.name}' (${createdLabel.id})`
						);
					} catch (error) {
						phaseResult.failed.push({
							issue,
							error: error.message,
							action: 'create_failed'
						});

						log(
							'error',
							`Failed to create label '${issue.labelName}': ${error.message}`
						);
					}
				} else {
					phaseResult.skipped.push({
						issue,
						reason: 'unsupported_fix_action'
					});
				}
			}

			phaseResult.success = phaseResult.failed.length === 0;
		} catch (error) {
			phaseResult.failed.push({
				error: `Reconciliation failed: ${error.message}`,
				action: 'reconciliation_error'
			});
		}

		phaseResult.duration = Date.now() - startTime;
		return phaseResult;
	}

	/**
	 * Display phase result
	 *
	 * @param {string} phaseName - Name of the phase
	 * @param {Object} phaseResult - Phase result object
	 * @private
	 */
	_displayPhaseResult(phaseName, phaseResult) {
		const statusIcon = phaseResult.success ? '✅' : '❌';
		const duration = `(${phaseResult.duration}ms)`;

		console.log(`${statusIcon} ${phaseName} ${duration}`);

		if (phaseResult.issues && phaseResult.issues.length > 0) {
			const errorCount = phaseResult.issues.filter(
				(i) => i.type === AUDIT_RESULT_TYPES.ERROR
			).length;
			const warningCount = phaseResult.issues.filter(
				(i) => i.type === AUDIT_RESULT_TYPES.WARNING
			).length;

			if (errorCount > 0) {
				console.log(`   ❌ ${errorCount} error(s)`);
			}
			if (warningCount > 0) {
				console.log(`   ⚠️ ${warningCount} warning(s)`);
			}

			if (this.config.verbose) {
				phaseResult.issues.forEach((issue) => {
					const icon =
						issue.type === AUDIT_RESULT_TYPES.ERROR
							? '❌'
							: issue.type === AUDIT_RESULT_TYPES.WARNING
								? '⚠️'
								: 'ℹ️';
					console.log(`     ${icon} ${issue.message}`);
				});
			}
		}

		if (phaseResult.summary) {
			console.log(`   📊 ${JSON.stringify(phaseResult.summary, null, 0)}`);
		}

		console.log('');
	}

	/**
	 * Calculate overall audit summary
	 *
	 * @param {Object} phases - All phase results
	 * @returns {Object} Audit summary
	 * @private
	 */
	_calculateAuditSummary(phases) {
		const summary = {
			totalIssues: 0,
			fixedIssues: 0,
			remainingIssues: 0,
			success: true
		};

		// Count issues from all phases
		Object.values(phases).forEach((phase) => {
			if (phase && phase.issues) {
				summary.totalIssues += phase.issues.length;
			}
			if (phase && !phase.success) {
				summary.success = false;
			}
		});

		// Count fixed issues from reconciliation
		if (phases.reconciliation) {
			summary.fixedIssues = phases.reconciliation.fixed?.length || 0;
		}

		summary.remainingIssues = summary.totalIssues - summary.fixedIssues;

		return summary;
	}

	/**
	 * Display final audit summary
	 *
	 * @param {Object} auditResult - Complete audit result
	 * @private
	 */
	_displayAuditSummary(auditResult) {
		messages.header('Audit Summary');

		const { summary } = auditResult;
		const statusIcon = summary.success ? '✅' : '❌';
		const statusText = summary.success ? 'PASSED' : 'FAILED';

		console.log(`${statusIcon} Overall Status: ${statusText}\\n`);

		console.log(`📊 Issue Summary:`);
		console.log(`   • Total Issues Found: ${summary.totalIssues}`);
		console.log(`   • Issues Fixed: ${summary.fixedIssues}`);
		console.log(`   • Remaining Issues: ${summary.remainingIssues}\\n`);

		// Display recommendations
		const allRecommendations = [];
		Object.values(auditResult.phases).forEach((phase) => {
			if (phase?.recommendations) {
				allRecommendations.push(...phase.recommendations);
			}
		});

		if (allRecommendations.length > 0) {
			console.log(`💡 Recommendations:`);
			allRecommendations.forEach((rec, index) => {
				console.log(
					`   ${index + 1}. ${rec.message} (${rec.priority} priority)`
				);
			});
			console.log('');
		}

		// Next steps
		console.log(`🚀 Next Steps:`);
		if (summary.remainingIssues > 0) {
			console.log(
				`   • Run with --auto-fix to automatically resolve fixable issues`
			);
			console.log(`   • Manually review and fix configuration conflicts`);
			console.log(`   • Re-run audit after making changes`);
		} else {
			console.log(`   • All labels are consistent across projects`);
			console.log(`   • Run periodic audits to maintain consistency`);
		}

		const finalMessage = summary.success
			? '✅ Label audit completed successfully!'
			: '❌ Label audit found issues that need attention.';

		messages.info(finalMessage);
	}
}

/**
 * Convenience function to create and run label audit
 *
 * @param {string} apiKey - Linear API key
 * @param {string} projectRoot - TaskMaster project root directory
 * @param {string} teamId - Linear team ID
 * @param {string[]} projectIds - Array of Linear project IDs
 * @param {Object} options - Audit options
 * @returns {Promise<Object>} Audit result
 */
export async function auditLinearLabels(
	apiKey,
	projectRoot,
	teamId,
	projectIds,
	options = {}
) {
	const auditor = new LinearLabelAuditor({
		apiKey,
		projectRoot,
		teamId,
		projectIds
	});
	return await auditor.runLabelAudit(options);
}

/**
 * Generate audit report in JSON format
 *
 * @param {Object} auditResult - Audit result object
 * @param {string} outputPath - Path to save report
 * @returns {Promise<void>}
 */
export async function generateAuditReport(auditResult, outputPath) {
	const fs = await import('fs/promises');

	const report = {
		metadata: {
			timestamp: auditResult.timestamp,
			version: '1.0.0',
			type: 'linear_label_audit'
		},
		summary: auditResult.summary,
		phases: auditResult.phases,
		recommendations: []
	};

	// Collect all recommendations
	Object.values(auditResult.phases).forEach((phase) => {
		if (phase?.recommendations) {
			report.recommendations.push(...phase.recommendations);
		}
	});

	await fs.writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
	log('info', `Audit report saved to: ${outputPath}`);
}
