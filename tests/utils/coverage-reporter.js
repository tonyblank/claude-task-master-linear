/**
 * @fileoverview Test coverage reporting and analysis utilities
 *
 * Provides comprehensive test coverage analysis, gap identification,
 * and reporting for the event system test suite.
 */

import fs from 'fs/promises';
import path from 'path';
import glob from 'glob';

/**
 * Test Coverage Analyzer
 */
export class CoverageAnalyzer {
	constructor(options = {}) {
		this.projectRoot = options.projectRoot || process.cwd();
		this.sourceDir = options.sourceDir || 'scripts/modules/events';
		this.testDir = options.testDir || 'tests';
		this.outputDir = options.outputDir || 'coverage-reports';
		this.coverage = {
			files: new Map(),
			functions: new Map(),
			eventTypes: new Map(),
			integrationScenarios: new Map()
		};
	}

	/**
	 * Analyze test coverage across the event system
	 * @returns {Object} Coverage analysis results
	 */
	async analyzeCoverage() {
		const analysis = {
			files: await this.analyzeFilesCoverage(),
			functions: await this.analyzeFunctionsCoverage(),
			eventTypes: await this.analyzeEventTypesCoverage(),
			integrationScenarios: await this.analyzeIntegrationScenarios(),
			gaps: [],
			recommendations: []
		};

		analysis.gaps = this.identifyGaps(analysis);
		analysis.recommendations = this.generateRecommendations(analysis);

		return analysis;
	}

	/**
	 * Analyze which source files have corresponding tests
	 */
	async analyzeFilesCoverage() {
		const sourceFiles = await this.getSourceFiles();
		const testFiles = await this.getTestFiles();

		const coverage = {
			total: sourceFiles.length,
			covered: 0,
			uncovered: [],
			testFiles: testFiles.length,
			details: []
		};

		for (const sourceFile of sourceFiles) {
			const fileName = path.basename(sourceFile, path.extname(sourceFile));
			const relativeSourcePath = path.relative(this.projectRoot, sourceFile);

			// Look for corresponding test files
			const testMatches = testFiles.filter((testFile) => {
				const testFileName = path.basename(testFile);
				return (
					testFileName.includes(fileName) ||
					testFileName.includes(fileName.replace('-', ''))
				);
			});

			const hasCoverage = testMatches.length > 0;
			if (hasCoverage) {
				coverage.covered++;
			} else {
				coverage.uncovered.push(relativeSourcePath);
			}

			coverage.details.push({
				file: relativeSourcePath,
				covered: hasCoverage,
				testFiles: testMatches.map((f) => path.relative(this.projectRoot, f))
			});
		}

		coverage.percentage = (coverage.covered / coverage.total) * 100;
		return coverage;
	}

	/**
	 * Analyze function and method coverage
	 */
	async analyzeFunctionsCoverage() {
		const sourceFiles = await this.getSourceFiles();
		const testFiles = await this.getTestFiles();

		const coverage = {
			functions: new Map(),
			classes: new Map(),
			exports: new Map()
		};

		// Extract functions/methods from source files
		for (const sourceFile of sourceFiles) {
			const content = await fs.readFile(sourceFile, 'utf-8');
			const functions = this.extractFunctions(content);
			const classes = this.extractClasses(content);
			const exports = this.extractExports(content);

			const relativeFile = path.relative(this.projectRoot, sourceFile);
			coverage.functions.set(relativeFile, functions);
			coverage.classes.set(relativeFile, classes);
			coverage.exports.set(relativeFile, exports);
		}

		// Analyze test coverage for each function
		const testContent = await this.getAllTestContent(testFiles);
		const coveredFunctions = new Set();
		const coveredClasses = new Set();
		const coveredExports = new Set();

		// Simple pattern matching for function calls in tests
		for (const [file, functions] of coverage.functions) {
			for (const func of functions) {
				if (testContent.includes(func) || testContent.includes(`${func}(`)) {
					coveredFunctions.add(`${file}:${func}`);
				}
			}
		}

		for (const [file, classes] of coverage.classes) {
			for (const cls of classes) {
				if (testContent.includes(cls) || testContent.includes(`new ${cls}`)) {
					coveredClasses.add(`${file}:${cls}`);
				}
			}
		}

		for (const [file, exports] of coverage.exports) {
			for (const exp of exports) {
				if (testContent.includes(exp)) {
					coveredExports.add(`${file}:${exp}`);
				}
			}
		}

		return {
			functions: coverage.functions,
			classes: coverage.classes,
			exports: coverage.exports,
			covered: {
				functions: coveredFunctions,
				classes: coveredClasses,
				exports: coveredExports
			}
		};
	}

	/**
	 * Analyze event type coverage
	 */
	async analyzeEventTypesCoverage() {
		const eventTypesFile = path.join(
			this.projectRoot,
			this.sourceDir,
			'types.js'
		);
		let eventTypes = [];

		try {
			const content = await fs.readFile(eventTypesFile, 'utf-8');
			eventTypes = this.extractEventTypes(content);
		} catch (error) {
			console.warn('Could not read event types file:', error.message);
		}

		const testFiles = await this.getTestFiles();
		const testContent = await this.getAllTestContent(testFiles);

		const coverage = {
			total: eventTypes.length,
			covered: 0,
			uncovered: [],
			details: []
		};

		for (const eventType of eventTypes) {
			const isCovered =
				testContent.includes(eventType) ||
				testContent.includes(eventType.replace(':', ':'));

			if (isCovered) {
				coverage.covered++;
			} else {
				coverage.uncovered.push(eventType);
			}

			coverage.details.push({
				eventType,
				covered: isCovered
			});
		}

		coverage.percentage =
			eventTypes.length > 0 ? (coverage.covered / coverage.total) * 100 : 0;
		return coverage;
	}

	/**
	 * Analyze integration scenario coverage
	 */
	async analyzeIntegrationScenarios() {
		const scenarios = {
			'error-handling': {
				required: [
					'timeout',
					'network-failure',
					'invalid-payload',
					'handler-exception'
				],
				found: new Set()
			},
			performance: {
				required: ['high-load', 'concurrent-events', 'memory-usage', 'latency'],
				found: new Set()
			},
			'integration-flows': {
				required: [
					'task-to-linear',
					'bulk-operations',
					'webhook-processing',
					'state-sync'
				],
				found: new Set()
			},
			'failure-modes': {
				required: [
					'circuit-breaker',
					'recovery',
					'isolation',
					'cascading-failure'
				],
				found: new Set()
			}
		};

		const testFiles = await this.getTestFiles();

		for (const testFile of testFiles) {
			const content = await fs.readFile(testFile, 'utf-8');
			const fileName = path.basename(testFile).toLowerCase();

			// Check for scenario patterns in test content and filenames
			for (const [category, scenario] of Object.entries(scenarios)) {
				for (const requirement of scenario.required) {
					const patterns = [
						requirement,
						requirement.replace('-', ' '),
						requirement.replace('-', '_'),
						requirement.toLowerCase()
					];

					if (
						patterns.some(
							(pattern) =>
								content.toLowerCase().includes(pattern) ||
								fileName.includes(pattern.replace(' ', '-'))
						)
					) {
						scenario.found.add(requirement);
					}
				}
			}
		}

		// Calculate coverage for each scenario category
		const coverage = {};
		for (const [category, scenario] of Object.entries(scenarios)) {
			const covered = scenario.found.size;
			const total = scenario.required.length;
			const missing = scenario.required.filter(
				(req) => !scenario.found.has(req)
			);

			coverage[category] = {
				total,
				covered,
				percentage: (covered / total) * 100,
				missing,
				found: Array.from(scenario.found)
			};
		}

		return coverage;
	}

	/**
	 * Identify coverage gaps
	 */
	identifyGaps(analysis) {
		const gaps = [];

		// File coverage gaps
		if (analysis.files.uncovered.length > 0) {
			gaps.push({
				type: 'file-coverage',
				severity: 'high',
				description: `${analysis.files.uncovered.length} source files lack test coverage`,
				files: analysis.files.uncovered
			});
		}

		// Event type gaps
		if (analysis.eventTypes.uncovered.length > 0) {
			gaps.push({
				type: 'event-coverage',
				severity: 'medium',
				description: `${analysis.eventTypes.uncovered.length} event types are not tested`,
				eventTypes: analysis.eventTypes.uncovered
			});
		}

		// Integration scenario gaps
		for (const [category, coverage] of Object.entries(
			analysis.integrationScenarios
		)) {
			if (coverage.missing.length > 0) {
				gaps.push({
					type: 'scenario-coverage',
					category,
					severity: coverage.percentage < 50 ? 'high' : 'medium',
					description: `Missing ${coverage.missing.length} integration scenarios in ${category}`,
					missing: coverage.missing
				});
			}
		}

		return gaps;
	}

	/**
	 * Generate recommendations based on coverage analysis
	 */
	generateRecommendations(analysis) {
		const recommendations = [];

		// File coverage recommendations
		if (analysis.files.percentage < 90) {
			recommendations.push({
				priority: 'high',
				category: 'file-coverage',
				title: 'Improve File Coverage',
				description: `Test coverage is at ${analysis.files.percentage.toFixed(1)}%. Add tests for uncovered files.`,
				actions: analysis.files.uncovered.map(
					(file) => `Create tests for ${file}`
				)
			});
		}

		// Event type recommendations
		if (analysis.eventTypes.percentage < 80) {
			recommendations.push({
				priority: 'medium',
				category: 'event-coverage',
				title: 'Complete Event Type Testing',
				description: `${analysis.eventTypes.uncovered.length} event types need test coverage.`,
				actions: analysis.eventTypes.uncovered.map(
					(type) => `Add tests for ${type} event`
				)
			});
		}

		// Performance testing recommendations
		const performanceCoverage = analysis.integrationScenarios.performance;
		if (performanceCoverage.percentage < 75) {
			recommendations.push({
				priority: 'high',
				category: 'performance',
				title: 'Enhance Performance Testing',
				description:
					'Performance test coverage is insufficient for production readiness.',
				actions: performanceCoverage.missing.map(
					(scenario) => `Add ${scenario} performance tests`
				)
			});
		}

		// Error handling recommendations
		const errorCoverage = analysis.integrationScenarios['error-handling'];
		if (errorCoverage.percentage < 90) {
			recommendations.push({
				priority: 'critical',
				category: 'error-handling',
				title: 'Critical Error Handling Gaps',
				description:
					'Error handling test coverage is critical for system reliability.',
				actions: errorCoverage.missing.map(
					(scenario) => `Implement ${scenario} error tests`
				)
			});
		}

		return recommendations;
	}

	/**
	 * Generate detailed coverage report
	 */
	async generateReport() {
		const analysis = await this.analyzeCoverage();
		const report = {
			timestamp: new Date().toISOString(),
			summary: {
				overallCoverage: this.calculateOverallCoverage(analysis),
				filesCoverage: analysis.files.percentage,
				eventTypesCoverage: analysis.eventTypes.percentage,
				scenariosCoverage: this.calculateScenariosCoverage(
					analysis.integrationScenarios
				)
			},
			details: analysis,
			gaps: analysis.gaps,
			recommendations: analysis.recommendations
		};

		// Generate HTML report
		const htmlReport = this.generateHtmlReport(report);

		// Ensure output directory exists
		const outputPath = path.join(this.projectRoot, this.outputDir);
		await fs.mkdir(outputPath, { recursive: true });

		// Write reports
		const jsonPath = path.join(outputPath, 'coverage-report.json');
		const htmlPath = path.join(outputPath, 'coverage-report.html');

		await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));
		await fs.writeFile(htmlPath, htmlReport);

		return {
			report,
			jsonPath,
			htmlPath
		};
	}

	// Helper methods
	async getSourceFiles() {
		const pattern = path
			.join(this.projectRoot, this.sourceDir, '**/*.js')
			.replace(/\\/g, '/');
		return await new Promise((resolve, reject) => {
			new Glob(pattern, (err, files) => {
				if (err) reject(err);
				else resolve(files);
			});
		});
	}

	async getTestFiles() {
		const pattern = path
			.join(this.projectRoot, this.testDir, '**/*.test.js')
			.replace(/\\/g, '/');
		return await new Promise((resolve, reject) => {
			new Glob(pattern, (err, files) => {
				if (err) reject(err);
				else resolve(files);
			});
		});
	}

	async getAllTestContent(testFiles) {
		const contents = await Promise.all(
			testFiles.map((file) => fs.readFile(file, 'utf-8'))
		);
		return contents.join('\n');
	}

	extractFunctions(content) {
		const functionPattern =
			/(?:export\s+)?(?:async\s+)?function\s+(\w+)|(\w+)\s*=\s*(?:async\s+)?function/g;
		const arrowFunctionPattern =
			/(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/g;

		const functions = new Set();
		let match;

		while ((match = functionPattern.exec(content)) !== null) {
			functions.add(match[1] || match[2]);
		}

		while ((match = arrowFunctionPattern.exec(content)) !== null) {
			functions.add(match[1]);
		}

		return Array.from(functions);
	}

	extractClasses(content) {
		const classPattern = /class\s+(\w+)/g;
		const classes = new Set();
		let match;

		while ((match = classPattern.exec(content)) !== null) {
			classes.add(match[1]);
		}

		return Array.from(classes);
	}

	extractExports(content) {
		const exportPattern =
			/export\s+(?:const|let|var|function|class)\s+(\w+)|export\s*{\s*([^}]+)\s*}/g;
		const exports = new Set();
		let match;

		while ((match = exportPattern.exec(content)) !== null) {
			if (match[1]) {
				exports.add(match[1]);
			} else if (match[2]) {
				// Handle destructured exports
				const items = match[2]
					.split(',')
					.map((item) => item.trim().split(' as ')[0].trim());
				items.forEach((item) => exports.add(item));
			}
		}

		return Array.from(exports);
	}

	extractEventTypes(content) {
		const eventTypesPattern = /export\s+const\s+EVENT_TYPES\s*=\s*{([^}]+)}/s;
		const match = eventTypesPattern.exec(content);

		if (!match) return [];

		const eventTypesContent = match[1];
		const typePattern = /(\w+):\s*['"]([^'"]+)['"]/g;
		const eventTypes = [];
		let typeMatch;

		while ((typeMatch = typePattern.exec(eventTypesContent)) !== null) {
			eventTypes.push(typeMatch[2]);
		}

		return eventTypes;
	}

	calculateOverallCoverage(analysis) {
		const weights = {
			files: 0.3,
			eventTypes: 0.2,
			scenarios: 0.5
		};

		const filesCoverage = analysis.files.percentage;
		const eventTypesCoverage = analysis.eventTypes.percentage;
		const scenariosCoverage = this.calculateScenariosCoverage(
			analysis.integrationScenarios
		);

		return (
			filesCoverage * weights.files +
			eventTypesCoverage * weights.eventTypes +
			scenariosCoverage * weights.scenarios
		);
	}

	calculateScenariosCoverage(scenarios) {
		const percentages = Object.values(scenarios).map((s) => s.percentage);
		return percentages.reduce((sum, p) => sum + p, 0) / percentages.length;
	}

	generateHtmlReport(report) {
		return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Event System Test Coverage Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .summary { background: #f5f5f5; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .metric { display: inline-block; margin: 10px 20px 10px 0; }
        .percentage { font-size: 24px; font-weight: bold; }
        .good { color: #4CAF50; }
        .warning { color: #FF9800; }
        .critical { color: #F44336; }
        .section { margin-bottom: 30px; }
        .gap { background: #ffebee; padding: 10px; margin: 10px 0; border-radius: 4px; }
        .recommendation { background: #e3f2fd; padding: 10px; margin: 10px 0; border-radius: 4px; }
        table { width: 100%; border-collapse: collapse; margin: 10px 0; }
        th, td { text-align: left; padding: 8px; border-bottom: 1px solid #ddd; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <h1>Event System Test Coverage Report</h1>
    <p>Generated: ${report.timestamp}</p>
    
    <div class="summary">
        <h2>Coverage Summary</h2>
        <div class="metric">
            <div>Overall Coverage</div>
            <div class="percentage ${this.getCoverageClass(report.summary.overallCoverage)}">${report.summary.overallCoverage.toFixed(1)}%</div>
        </div>
        <div class="metric">
            <div>Files Coverage</div>
            <div class="percentage ${this.getCoverageClass(report.summary.filesCoverage)}">${report.summary.filesCoverage.toFixed(1)}%</div>
        </div>
        <div class="metric">
            <div>Event Types Coverage</div>
            <div class="percentage ${this.getCoverageClass(report.summary.eventTypesCoverage)}">${report.summary.eventTypesCoverage.toFixed(1)}%</div>
        </div>
        <div class="metric">
            <div>Scenarios Coverage</div>
            <div class="percentage ${this.getCoverageClass(report.summary.scenariosCoverage)}">${report.summary.scenariosCoverage.toFixed(1)}%</div>
        </div>
    </div>

    <div class="section">
        <h2>Coverage Gaps</h2>
        ${report.gaps
					.map(
						(gap) => `
            <div class="gap">
                <h3>${gap.type} (${gap.severity})</h3>
                <p>${gap.description}</p>
                ${gap.files ? `<p>Files: ${gap.files.join(', ')}</p>` : ''}
                ${gap.eventTypes ? `<p>Event Types: ${gap.eventTypes.join(', ')}</p>` : ''}
                ${gap.missing ? `<p>Missing: ${gap.missing.join(', ')}</p>` : ''}
            </div>
        `
					)
					.join('')}
    </div>

    <div class="section">
        <h2>Recommendations</h2>
        ${report.recommendations
					.map(
						(rec) => `
            <div class="recommendation">
                <h3>${rec.title} (${rec.priority})</h3>
                <p>${rec.description}</p>
                <ul>
                    ${rec.actions.map((action) => `<li>${action}</li>`).join('')}
                </ul>
            </div>
        `
					)
					.join('')}
    </div>

    <div class="section">
        <h2>Detailed Coverage</h2>
        
        <h3>File Coverage</h3>
        <table>
            <tr><th>File</th><th>Covered</th><th>Test Files</th></tr>
            ${report.details.files.details
							.map(
								(detail) => `
                <tr>
                    <td>${detail.file}</td>
                    <td class="${detail.covered ? 'good' : 'critical'}">${detail.covered ? 'Yes' : 'No'}</td>
                    <td>${detail.testFiles.join(', ') || 'None'}</td>
                </tr>
            `
							)
							.join('')}
        </table>

        <h3>Event Type Coverage</h3>
        <table>
            <tr><th>Event Type</th><th>Covered</th></tr>
            ${report.details.eventTypes.details
							.map(
								(detail) => `
                <tr>
                    <td>${detail.eventType}</td>
                    <td class="${detail.covered ? 'good' : 'warning'}">${detail.covered ? 'Yes' : 'No'}</td>
                </tr>
            `
							)
							.join('')}
        </table>

        <h3>Integration Scenarios</h3>
        <table>
            <tr><th>Category</th><th>Coverage</th><th>Missing</th></tr>
            ${Object.entries(report.details.integrationScenarios)
							.map(
								([category, coverage]) => `
                <tr>
                    <td>${category}</td>
                    <td class="${this.getCoverageClass(coverage.percentage)}">${coverage.percentage.toFixed(1)}%</td>
                    <td>${coverage.missing.join(', ') || 'None'}</td>
                </tr>
            `
							)
							.join('')}
        </table>
    </div>
</body>
</html>`;
	}

	getCoverageClass(percentage) {
		if (percentage >= 90) return 'good';
		if (percentage >= 70) return 'warning';
		return 'critical';
	}
}

/**
 * Test Quality Metrics
 */
export class TestQualityMetrics {
	/**
	 * Analyze test quality metrics
	 * @param {string} testDir - Test directory path
	 * @returns {Object} Quality metrics
	 */
	static async analyzeTestQuality(testDir) {
		const testFiles = await this.getTestFiles(testDir);
		const metrics = {
			testCount: 0,
			assertionCount: 0,
			mockUsage: 0,
			asyncTestCount: 0,
			testComplexity: [],
			duplicateTests: [],
			flakeRisk: []
		};

		for (const testFile of testFiles) {
			const content = await fs.readFile(testFile, 'utf-8');
			const fileMetrics = this.analyzeTestFile(content, testFile);

			metrics.testCount += fileMetrics.testCount;
			metrics.assertionCount += fileMetrics.assertionCount;
			metrics.mockUsage += fileMetrics.mockUsage;
			metrics.asyncTestCount += fileMetrics.asyncTestCount;
			metrics.testComplexity.push(...fileMetrics.testComplexity);
			metrics.duplicateTests.push(...fileMetrics.duplicateTests);
			metrics.flakeRisk.push(...fileMetrics.flakeRisk);
		}

		return {
			...metrics,
			averageAssertionsPerTest:
				metrics.testCount > 0 ? metrics.assertionCount / metrics.testCount : 0,
			asyncTestPercentage:
				metrics.testCount > 0
					? (metrics.asyncTestCount / metrics.testCount) * 100
					: 0,
			qualityScore: this.calculateQualityScore(metrics)
		};
	}

	static analyzeTestFile(content, filePath) {
		const testPattern = /(?:it|test)\s*\(\s*['"`]([^'"`]+)['"`]/g;
		const assertPattern = /expect\s*\(/g;
		const mockPattern = /\.mock|mock\w+|jest\.fn\(\)|MockServiceRegistry/g;
		const asyncPattern = /async\s+\(/g;

		const tests = [];
		let match;

		while ((match = testPattern.exec(content)) !== null) {
			tests.push(match[1]);
		}

		const assertions = (content.match(assertPattern) || []).length;
		const mocks = (content.match(mockPattern) || []).length;
		const asyncTests = (content.match(asyncPattern) || []).length;

		// Analyze test complexity (lines per test)
		const testComplexity = tests.map((testName) => {
			const lines = content.split('\n').length;
			return {
				test: testName,
				file: filePath,
				complexity: Math.floor(lines / tests.length) // Rough estimate
			};
		});

		// Find potential duplicate tests
		const testNames = tests.map((name) => name.toLowerCase().trim());
		const duplicates = testNames
			.filter((name, index) => testNames.indexOf(name) !== index)
			.map((name) => ({ test: name, file: filePath }));

		// Identify flake risk factors
		const flakeRisk = [];
		if (content.includes('setTimeout') || content.includes('setInterval')) {
			flakeRisk.push({
				file: filePath,
				risk: 'timing-dependent',
				description: 'Uses setTimeout/setInterval'
			});
		}
		if (content.includes('Math.random()')) {
			flakeRisk.push({
				file: filePath,
				risk: 'random-values',
				description: 'Uses random values'
			});
		}
		if (content.includes('Date.now()') && !content.includes('mock')) {
			flakeRisk.push({
				file: filePath,
				risk: 'time-dependent',
				description: 'Uses current time'
			});
		}

		return {
			testCount: tests.length,
			assertionCount: assertions,
			mockUsage: mocks,
			asyncTestCount: asyncTests,
			testComplexity,
			duplicateTests: duplicates,
			flakeRisk
		};
	}

	static calculateQualityScore(metrics) {
		let score = 100;

		// Penalize low assertion ratio
		const assertionRatio = metrics.averageAssertionsPerTest;
		if (assertionRatio < 2) score -= 20;
		else if (assertionRatio < 1) score -= 40;

		// Penalize duplicate tests
		if (metrics.duplicateTests.length > 0) {
			score -= metrics.duplicateTests.length * 5;
		}

		// Penalize high complexity tests
		const highComplexityTests = metrics.testComplexity.filter(
			(t) => t.complexity > 50
		).length;
		score -= highComplexityTests * 3;

		// Penalize flake risks
		score -= metrics.flakeRisk.length * 10;

		return Math.max(0, score);
	}

	static async getTestFiles(testDir) {
		const pattern = path.join(testDir, '**/*.test.js').replace(/\\/g, '/');
		return new Promise((resolve, reject) => {
			glob(pattern, (err, files) => {
				if (err) reject(err);
				else resolve(files);
			});
		});
	}
}
