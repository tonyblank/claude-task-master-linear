#!/usr/bin/env node

/**
 * Linear API Test Script
 * This script verifies basic Linear SDK connectivity and GraphQL queries
 */

import { LinearClient } from '@linear/sdk';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testLinearConnection() {
	console.log('🔧 Testing Linear SDK Integration...\n');

	// Check if API key is available
	const apiKey = process.env.LINEAR_API_KEY;
	if (!apiKey) {
		console.log('⚠️  No LINEAR_API_KEY found in environment variables');
		console.log('   This is expected for the initial setup test');
		console.log(
			'   To test with a real API key, add LINEAR_API_KEY to your .env file\n'
		);

		// Test SDK instantiation without making real API calls
		try {
			const client = new LinearClient({ apiKey: 'test-key' });
			console.log('✅ LinearClient instantiated successfully');
			console.log('   Package installation verified');
			return true;
		} catch (error) {
			console.error('❌ Failed to instantiate LinearClient:', error.message);
			return false;
		}
	}

	// Test with real API key
	try {
		const client = new LinearClient({ apiKey });
		console.log('✅ LinearClient instantiated with API key');

		// Test basic GraphQL query - fetch current user
		console.log('📡 Testing viewer query...');
		const viewer = await client.viewer;

		console.log('✅ Successfully fetched current user:');
		console.log(`   ID: ${viewer.id}`);
		console.log(`   Name: ${viewer.name}`);
		console.log(`   Email: ${viewer.email || 'Not provided'}\n`);

		// Test additional basic query - fetch teams
		console.log('📡 Testing teams query...');
		const teams = await client.teams();
		console.log(`✅ Successfully fetched ${teams.nodes.length} teams\n`);

		console.log('🎉 Linear SDK integration test completed successfully!');
		return true;
	} catch (error) {
		console.error('❌ Linear API test failed:', error.message);
		if (error.message.includes('Unauthorized')) {
			console.log('   Check if your LINEAR_API_KEY is valid');
		}
		return false;
	}
}

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
	testLinearConnection()
		.then((success) => {
			process.exit(success ? 0 : 1);
		})
		.catch((error) => {
			console.error('Unexpected error:', error);
			process.exit(1);
		});
}

export { testLinearConnection };
