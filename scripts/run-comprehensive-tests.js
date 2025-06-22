#!/usr/bin/env node

/**
 * @fileoverview Script to run comprehensive test suite
 *
 * Simple wrapper script to execute the comprehensive test runner
 * with appropriate options and environment setup.
 */

import { ComprehensiveTestRunner } from '../tests/comprehensive-test-runner.js';

async function main() {
	console.log('🧪 TaskMaster Event System - Comprehensive Test Suite');
	console.log('====================================================\n');

	const runner = new ComprehensiveTestRunner({
		projectRoot: process.cwd()
	});

	try {
		const results = await runner.runAll();

		// Exit with appropriate code
		const allPassed = Object.values(results)
			.filter((r) => typeof r === 'object' && 'success' in r)
			.every((r) => r.success);

		process.exit(allPassed ? 0 : 1);
	} catch (error) {
		console.error('\n❌ Test execution failed:', error.message);
		process.exit(1);
	}
}

main();
