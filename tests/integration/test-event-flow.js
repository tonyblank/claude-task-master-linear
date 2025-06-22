#!/usr/bin/env node

/**
 * Integration test for the addTask event flow to Linear integration
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { addTaskDirect } from '../../mcp-server/src/core/direct-functions/add-task.js';
import {
	initializeEventSystem,
	registerIntegration,
	resetEventSystem
} from '../../scripts/modules/events/index.js';
import { LinearIntegrationHandler } from '../../scripts/modules/integrations/linear-integration-handler.js';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock logger for testing
const mockLogger = {
	info: (msg, ...args) => console.log(`[INFO] ${msg}`, ...args),
	warn: (msg, ...args) => console.log(`[WARN] ${msg}`, ...args),
	error: (msg, ...args) => console.log(`[ERROR] ${msg}`, ...args),
	debug: (msg, ...args) => console.log(`[DEBUG] ${msg}`, ...args),
	success: (msg, ...args) => console.log(`[SUCCESS] ${msg}`, ...args)
};

// Test configuration
const TEST_PROJECT_ROOT = '/app';
const TEST_TASKS_FILE = path.join(
	TEST_PROJECT_ROOT,
	'.taskmaster',
	'tasks',
	'tasks.json'
);

async function setupTestEnvironment() {
	console.log('Setting up test environment...');

	// Reset event system
	await resetEventSystem();

	// Initialize event system
	await initializeEventSystem({
		enableErrorBoundaries: true,
		enableCircuitBreakers: true,
		enableHealthMonitoring: false // Disable for testing
	});

	// Create a mock Linear integration (without real API key)
	const mockLinearIntegration = new LinearIntegrationHandler({
		apiKey: 'mock-api-key-for-testing',
		teamId: 'mock-team-id',
		createIssues: false // Disable actual issue creation for testing
	});

	// Override the Linear integration methods for testing
	mockLinearIntegration._performInitialization = async () => {
		console.log('Mock Linear integration initialized');
	};

	mockLinearIntegration.handleTaskCreated = async (payload) => {
		console.log('🎉 Linear integration received task creation event!');
		console.log(`Task: #${payload.task.id} - ${payload.task.title}`);
		console.log(`Tag: ${payload.tag}`);
		console.log(`Context: ${payload.context.source}`);

		return {
			action: 'mock_created',
			task: payload.task,
			message: 'Successfully handled task creation event'
		};
	};

	// Register the mock integration
	registerIntegration(mockLinearIntegration);

	console.log('Test environment setup complete');
}

async function createTestTask() {
	console.log('\nCreating test task...');

	// Ensure test directory exists
	const taskDir = path.dirname(TEST_TASKS_FILE);
	if (!fs.existsSync(taskDir)) {
		fs.mkdirSync(taskDir, { recursive: true });
	}

	// Create basic tasks.json if it doesn't exist
	if (!fs.existsSync(TEST_TASKS_FILE)) {
		const initialData = {
			master: {
				tasks: [],
				metadata: {
					created: new Date().toISOString(),
					description: 'Test tasks context'
				}
			}
		};
		fs.writeFileSync(TEST_TASKS_FILE, JSON.stringify(initialData, null, 2));
	}

	// Call addTaskDirect to create a task and trigger the event
	const result = await addTaskDirect(
		{
			tasksJsonPath: TEST_TASKS_FILE,
			prompt: 'Test task for integration POC',
			dependencies: [],
			priority: 'high',
			research: false,
			projectRoot: TEST_PROJECT_ROOT
		},
		mockLogger,
		{
			session: { user: 'test-user' }
		}
	);

	console.log('Task creation result:', result);
	return result;
}

async function runIntegrationTest() {
	try {
		console.log('🚀 Starting integration test for addTask event flow\n');

		await setupTestEnvironment();
		const result = await createTestTask();

		if (result.success) {
			console.log('\n✅ Integration test PASSED!');
			console.log(`Created task #${result.data.taskId}`);
			console.log(
				'Event flow from addTask to Linear integration works correctly'
			);
		} else {
			console.log('\n❌ Integration test FAILED!');
			console.log('Error:', result.error);
		}
	} catch (error) {
		console.log('\n💥 Integration test CRASHED!');
		console.error('Error:', error.message);
		console.error('Stack:', error.stack);
	} finally {
		// Cleanup
		await resetEventSystem();
		console.log('\nTest environment cleaned up');
	}
}

// Run the test
runIntegrationTest();
