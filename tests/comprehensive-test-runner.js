#!/usr/bin/env node

/**
 * @fileoverview Comprehensive test runner for the event system
 *
 * Orchestrates all test suites, generates coverage reports,
 * and provides detailed analysis of test results.
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import {
	CoverageAnalyzer,
	TestQualityMetrics
} from './utils/coverage-reporter.js';

class ComprehensiveTestRunner {
	constructor(options = {}) {
		this.projectRoot = options.projectRoot || process.cwd();
		this.testSuites = {
			unit: 'tests/unit/**/*.test.js',
			integration: 'tests/integration/**/*.test.js',
			performance: 'tests/performance/**/*.test.js',
			e2e: 'tests/e2e/**/*.test.js'
		};
		this.results = {};
		this.startTime = Date.now();
	}

	/**
	 * Run all test suites comprehensively
	 */
	async runAll() {
		console.log('🚀 Starting Comprehensive Test Suite for Event System\n');

		try {
			// Pre-test analysis
			await this.preTestAnalysis();

			// Run test suites
			await this.runTestSuites();

			// Post-test analysis
			await this.postTestAnalysis();

			// Generate reports
			await this.generateReports();

			// Display summary
			this.displaySummary();

			return this.results;
		} catch (error) {
			console.error('❌ Test runner failed:', error.message);
			process.exit(1);
		}
	}

	/**
	 * Run specific test suite
	 */
	async runSuite(suiteName) {
		if (!this.testSuites[suiteName]) {
			throw new Error(`Unknown test suite: ${suiteName}`);
		}

		console.log(`🧪 Running ${suiteName} tests...`);

		const result = await this.executeTests(
			this.testSuites[suiteName],
			suiteName
		);
		this.results[suiteName] = result;

		return result;
	}

	/**
	 * Pre-test analysis and setup
	 */
	async preTestAnalysis() {
		console.log('📊 Performing pre-test analysis...');

		// Check test environment
		await this.checkTestEnvironment();

		// Analyze existing test structure
		const coverageAnalyzer = new CoverageAnalyzer({
			projectRoot: this.projectRoot
		});

		const initialCoverage = await coverageAnalyzer.analyzeCoverage();
		this.results.initialCoverage = initialCoverage;

		console.log(`   ✓ Found ${initialCoverage.files.total} source files`);
		console.log(`   ✓ Found ${initialCoverage.files.testFiles} test files`);
		console.log(
			`   ✓ Initial coverage: ${initialCoverage.files.percentage.toFixed(1)}%`
		);

		// Analyze test quality
		const qualityMetrics = await TestQualityMetrics.analyzeTestQuality(
			path.join(this.projectRoot, 'tests')
		);
		this.results.testQuality = qualityMetrics;

		console.log(`   ✓ Quality score: ${qualityMetrics.qualityScore}/100`);
		console.log(`   ✓ Total tests: ${qualityMetrics.testCount}`);
		console.log('');
	}

	/**
	 * Run all test suites sequentially
	 */
	async runTestSuites() {
		const suiteOrder = ['unit', 'integration', 'performance', 'e2e'];

		for (const suiteName of suiteOrder) {
			try {
				await this.runSuite(suiteName);
			} catch (error) {
				console.error(`❌ ${suiteName} tests failed:`, error.message);
				this.results[suiteName] = {
					success: false,
					error: error.message,
					duration: 0,
					tests: 0,
					passed: 0,
					failed: 1
				};
			}
		}
	}

	/**
	 * Execute tests for a specific pattern
	 */
	async executeTests(pattern, suiteName) {
		const startTime = Date.now();

		return new Promise((resolve, reject) => {
			// Use Jest if available, otherwise use Node.js test runner
			const testCommand = this.getTestCommand();
			const args = this.getTestArgs(pattern, suiteName);

			console.log(`   Running: ${testCommand} ${args.join(' ')}`);

			const child = spawn(testCommand, args, {
				stdio: ['inherit', 'pipe', 'pipe'],
				cwd: this.projectRoot
			});

			let stdout = '';
			let stderr = '';

			child.stdout.on('data', (data) => {
				stdout += data.toString();
				process.stdout.write(data);
			});

			child.stderr.on('data', (data) => {
				stderr += data.toString();
				process.stderr.write(data);
			});

			child.on('close', (code) => {
				const duration = Date.now() - startTime;
				const result = this.parseTestOutput(stdout, stderr, code, duration);

				if (code === 0) {
					console.log(`   ✅ ${suiteName} tests completed (${duration}ms)\n`);
					resolve(result);
				} else {
					console.log(`   ❌ ${suiteName} tests failed (${duration}ms)\n`);
					resolve(result); // Don't reject, capture failure details
				}
			});

			child.on('error', (error) => {
				reject(new Error(`Failed to start test process: ${error.message}`));
			});
		});
	}

	/**
	 * Parse test output and extract metrics
	 */
	parseTestOutput(stdout, stderr, exitCode, duration) {
		const result = {
			success: exitCode === 0,
			duration,
			stdout,
			stderr,
			tests: 0,
			passed: 0,
			failed: 0,
			skipped: 0
		};

		// Parse Jest output
		const jestSummaryMatch = stdout.match(
			/Tests:\s+(\d+)\s+failed,\s+(\d+)\s+passed,\s+(\d+)\s+total/
		);
		if (jestSummaryMatch) {
			result.failed = parseInt(jestSummaryMatch[1]);
			result.passed = parseInt(jestSummaryMatch[2]);
			result.tests = parseInt(jestSummaryMatch[3]);
		} else {
			// Try alternative patterns
			const passedMatch = stdout.match(/(\d+)\s+passing/);
			const failedMatch = stdout.match(/(\d+)\s+failing/);

			if (passedMatch) result.passed = parseInt(passedMatch[1]);
			if (failedMatch) result.failed = parseInt(failedMatch[1]);
			result.tests = result.passed + result.failed;
		}

		// Extract additional metrics
		const timeMatch = stdout.match(/Time:\s+([\d.]+)\s*s/);
		if (timeMatch && !result.duration) {
			result.duration = parseFloat(timeMatch[1]) * 1000;
		}

		return result;
	}

	/**
	 * Post-test analysis
	 */
	async postTestAnalysis() {
		console.log('📈 Performing post-test analysis...');

		// Calculate overall statistics
		const totalTests = Object.values(this.results)
			.filter((r) => typeof r === 'object' && 'tests' in r)
			.reduce((sum, r) => sum + r.tests, 0);

		const totalPassed = Object.values(this.results)
			.filter((r) => typeof r === 'object' && 'passed' in r)
			.reduce((sum, r) => sum + r.passed, 0);

		const totalFailed = Object.values(this.results)
			.filter((r) => typeof r === 'object' && 'failed' in r)
			.reduce((sum, r) => sum + r.failed, 0);

		const totalDuration = Object.values(this.results)
			.filter((r) => typeof r === 'object' && 'duration' in r)
			.reduce((sum, r) => sum + r.duration, 0);

		this.results.overall = {
			tests: totalTests,
			passed: totalPassed,
			failed: totalFailed,
			duration: totalDuration,
			successRate: totalTests > 0 ? (totalPassed / totalTests) * 100 : 0
		};

		console.log(`   ✓ Total tests: ${totalTests}`);
		console.log(
			`   ✓ Success rate: ${this.results.overall.successRate.toFixed(1)}%`
		);
		console.log(`   ✓ Total duration: ${(totalDuration / 1000).toFixed(2)}s`);
		console.log('');
	}

	/**
	 * Generate comprehensive reports
	 */
	async generateReports() {
		console.log('📋 Generating comprehensive reports...');

		// Generate coverage report
		const coverageAnalyzer = new CoverageAnalyzer({
			projectRoot: this.projectRoot
		});

		const coverageResult = await coverageAnalyzer.generateReport();
		this.results.coverage = coverageResult;

		console.log(`   ✓ Coverage report: ${coverageResult.htmlPath}`);

		// Generate test results report
		const testReportPath = await this.generateTestResultsReport();
		console.log(`   ✓ Test results: ${testReportPath}`);

		// Generate recommendations report
		const recommendationsPath = await this.generateRecommendationsReport();
		console.log(`   ✓ Recommendations: ${recommendationsPath}`);
		console.log('');
	}

	/**
	 * Generate test results report
	 */
	async generateTestResultsReport() {
		const reportPath = path.join(
			this.projectRoot,
			'coverage-reports',
			'test-results.json'
		);

		const report = {
			timestamp: new Date().toISOString(),
			duration: Date.now() - this.startTime,
			results: this.results,
			environment: {
				node: process.version,
				platform: process.platform,
				cwd: process.cwd()
			}
		};

		await fs.mkdir(path.dirname(reportPath), { recursive: true });
		await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

		return reportPath;
	}

	/**
	 * Generate recommendations report
	 */
	async generateRecommendationsReport() {
		const reportPath = path.join(
			this.projectRoot,
			'coverage-reports',
			'recommendations.md'
		);

		const recommendations = this.generateRecommendations();
		const markdown = this.formatRecommendationsAsMarkdown(recommendations);

		await fs.mkdir(path.dirname(reportPath), { recursive: true });
		await fs.writeFile(reportPath, markdown);

		return reportPath;
	}

	/**
	 * Generate actionable recommendations
	 */
	generateRecommendations() {
		const recommendations = [];

		// Test failure recommendations
		Object.entries(this.results).forEach(([suite, result]) => {
			if (result.failed > 0) {
				recommendations.push({
					priority: 'high',
					category: 'test-failures',
					title: `Fix ${result.failed} failing tests in ${suite} suite`,
					description: `The ${suite} test suite has ${result.failed} failing tests that need attention.`,
					action: `Review and fix failing tests in ${suite} test suite`
				});
			}
		});

		// Performance recommendations
		if (this.results.performance?.duration > 30000) {
			recommendations.push({
				priority: 'medium',
				category: 'performance',
				title: 'Optimize performance test execution time',
				description: `Performance tests took ${(this.results.performance.duration / 1000).toFixed(1)}s, which may be too slow for CI/CD.`,
				action: 'Review and optimize slow performance tests'
			});
		}

		// Quality recommendations
		if (this.results.testQuality?.qualityScore < 80) {
			recommendations.push({
				priority: 'medium',
				category: 'quality',
				title: 'Improve test quality score',
				description: `Test quality score is ${this.results.testQuality.qualityScore}/100. Consider improving test structure and reducing flake risks.`,
				action: 'Address test quality issues identified in the analysis'
			});
		}

		// Coverage recommendations
		if (this.results.coverage?.report.summary.overallCoverage < 90) {
			recommendations.push({
				priority: 'high',
				category: 'coverage',
				title: 'Increase test coverage',
				description: `Overall test coverage is ${this.results.coverage.report.summary.overallCoverage.toFixed(1)}%. Aim for 90%+ coverage.`,
				action: 'Add tests for uncovered code paths and scenarios'
			});
		}

		return recommendations;
	}

	/**
	 * Format recommendations as markdown
	 */
	formatRecommendationsAsMarkdown(recommendations) {
		const markdown = `# Test Suite Recommendations

Generated: ${new Date().toISOString()}

## Summary

${
	recommendations.length > 0
		? 'The following recommendations will help improve the test suite quality and coverage:'
		: '🎉 No major recommendations at this time. The test suite is in good shape!'
}

${recommendations
	.map(
		(rec, index) => `
## ${index + 1}. ${rec.title}

**Priority:** ${rec.priority.toUpperCase()}  
**Category:** ${rec.category}

${rec.description}

**Action:** ${rec.action}
`
	)
	.join('')}

## Test Results Summary

${Object.entries(this.results)
	.filter(([key, value]) => typeof value === 'object' && 'tests' in value)
	.map(
		([suite, result]) => `
### ${suite.charAt(0).toUpperCase() + suite.slice(1)} Tests

- **Tests:** ${result.tests}
- **Passed:** ${result.passed}
- **Failed:** ${result.failed}
- **Duration:** ${(result.duration / 1000).toFixed(2)}s
- **Success Rate:** ${result.tests > 0 ? ((result.passed / result.tests) * 100).toFixed(1) : 0}%
`
	)
	.join('')}

## Next Steps

1. Address high-priority recommendations first
2. Review failing tests and fix underlying issues
3. Add tests for uncovered scenarios
4. Optimize slow-running tests
5. Monitor test quality metrics over time

---
*Generated by Comprehensive Test Runner*
`;

		return markdown;
	}

	/**
	 * Display final summary
	 */
	displaySummary() {
		const totalDuration = Date.now() - this.startTime;

		console.log('📊 COMPREHENSIVE TEST SUMMARY');
		console.log('='.repeat(50));

		Object.entries(this.results).forEach(([key, result]) => {
			if (typeof result === 'object' && 'tests' in result) {
				const status = result.success ? '✅' : '❌';
				const successRate =
					result.tests > 0
						? ((result.passed / result.tests) * 100).toFixed(1)
						: '0';

				console.log(
					`${status} ${key.padEnd(12)} | ${result.tests.toString().padStart(3)} tests | ${successRate.padStart(5)}% pass | ${(result.duration / 1000).toFixed(1).padStart(6)}s`
				);
			}
		});

		console.log('-'.repeat(50));

		if (this.results.overall) {
			const overallStatus = this.results.overall.successRate >= 95 ? '✅' : '⚠️';
			console.log(
				`${overallStatus} OVERALL     | ${this.results.overall.tests.toString().padStart(3)} tests | ${this.results.overall.successRate.toFixed(1).padStart(5)}% pass | ${(this.results.overall.duration / 1000).toFixed(1).padStart(6)}s`
			);
		}

		console.log('='.repeat(50));
		console.log(
			`🕐 Total execution time: ${(totalDuration / 1000).toFixed(2)}s`
		);

		if (this.results.coverage) {
			console.log(
				`📊 Coverage reports: ${path.dirname(this.results.coverage.htmlPath)}`
			);
		}

		// Final status
		const allPassed = Object.values(this.results)
			.filter((r) => typeof r === 'object' && 'success' in r)
			.every((r) => r.success);

		if (allPassed) {
			console.log(
				'\n🎉 ALL TESTS PASSED! Event system is ready for production.'
			);
		} else {
			console.log(
				'\n⚠️  Some tests failed. Please review the results and fix issues before deployment.'
			);
		}
	}

	/**
	 * Check test environment setup
	 */
	async checkTestEnvironment() {
		// Check if Jest is available
		try {
			await fs.access(
				path.join(this.projectRoot, 'node_modules', '.bin', 'jest')
			);
			this.testRunner = 'jest';
		} catch {
			this.testRunner = 'node';
		}

		// Ensure test directories exist
		for (const [suiteName, pattern] of Object.entries(this.testSuites)) {
			const testDir = path.join(this.projectRoot, path.dirname(pattern));
			try {
				await fs.access(testDir);
			} catch {
				console.warn(`⚠️  Test directory not found: ${testDir}`);
			}
		}
	}

	/**
	 * Get appropriate test command
	 */
	getTestCommand() {
		if (this.testRunner === 'jest') {
			return process.platform === 'win32' ? 'npx.cmd' : 'npx';
		}
		return 'node';
	}

	/**
	 * Get test command arguments
	 */
	getTestArgs(pattern, suiteName) {
		if (this.testRunner === 'jest') {
			return [
				'jest',
				'--testPathPattern=' + pattern,
				'--verbose',
				'--coverage',
				'--coverageDirectory=coverage-reports/jest-coverage',
				`--coverageReporters=html,lcov,text-summary`
			];
		} else {
			// Fallback to basic Node.js execution
			return ['--test', pattern];
		}
	}
}

// CLI Interface
if (import.meta.url === `file://${process.argv[1]}`) {
	const runner = new ComprehensiveTestRunner();

	const command = process.argv[2];
	const suite = process.argv[3];

	if (command === 'suite' && suite) {
		runner.runSuite(suite).catch(console.error);
	} else {
		runner.runAll().catch(console.error);
	}
}

export { ComprehensiveTestRunner };
