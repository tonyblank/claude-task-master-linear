/**
 * Debug script to test addTaskDirect function and see what's causing success: false
 */

import { addTaskDirect } from './mcp-server/src/core/direct-functions/add-task.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock logger that captures all log messages
const debugLogger = {
	debug: (msg) => console.log('DEBUG:', msg),
	info: (msg) => console.log('INFO:', msg),
	warn: (msg) => console.log('WARN:', msg),
	error: (msg) => console.log('ERROR:', msg),
	success: (msg) => console.log('SUCCESS:', msg)
};

// Mock session
const mockSession = {
	user: 'debug-user',
	env: {}
};

// Test different parameter combinations to isolate the issue
async function testAddTaskDirect() {
	console.log('=== DEBUGGING addTaskDirect ===\n');

	const testProjectRoot = __dirname;
	const testTasksPath = path.join(
		testProjectRoot,
		'.taskmaster',
		'tasks',
		'tasks.json'
	);

	console.log('Test project root:', testProjectRoot);
	console.log('Test tasks path:', testTasksPath);
	console.log('');

	// Test Case 1: Missing tasksJsonPath (should fail with specific error)
	console.log('TEST 1: Missing tasksJsonPath');
	try {
		const result1 = await addTaskDirect(
			{
				prompt: 'Test task',
				projectRoot: testProjectRoot
				// No tasksJsonPath
			},
			debugLogger,
			{ session: mockSession }
		);

		console.log('Result 1:', JSON.stringify(result1, null, 2));
	} catch (error) {
		console.log('Exception 1:', error.message);
	}
	console.log('');

	// Test Case 2: Missing prompt and title/description (should fail with specific error)
	console.log('TEST 2: Missing prompt and title/description');
	try {
		const result2 = await addTaskDirect(
			{
				tasksJsonPath: testTasksPath,
				projectRoot: testProjectRoot
				// No prompt, title, or description
			},
			debugLogger,
			{ session: mockSession }
		);

		console.log('Result 2:', JSON.stringify(result2, null, 2));
	} catch (error) {
		console.log('Exception 2:', error.message);
	}
	console.log('');

	// Test Case 3: Valid parameters with AI prompt (should work)
	console.log('TEST 3: Valid parameters with AI prompt');
	try {
		const result3 = await addTaskDirect(
			{
				tasksJsonPath: testTasksPath,
				prompt: 'Create a debug test task',
				dependencies: [],
				priority: 'medium',
				research: false,
				projectRoot: testProjectRoot
			},
			debugLogger,
			{ session: mockSession }
		);

		console.log('Result 3:', JSON.stringify(result3, null, 2));
	} catch (error) {
		console.log('Exception 3:', error.message);
		console.log('Stack trace:', error.stack);
	}
	console.log('');

	// Test Case 4: Valid parameters with manual task creation (should work)
	console.log('TEST 4: Valid parameters for manual task creation');
	try {
		const result4 = await addTaskDirect(
			{
				tasksJsonPath: testTasksPath,
				title: 'Debug Manual Task',
				description: 'A manually created debug task',
				details: 'Debug implementation details',
				testStrategy: 'Debug testing strategy',
				dependencies: [],
				priority: 'low',
				projectRoot: testProjectRoot
			},
			debugLogger,
			{ session: mockSession }
		);

		console.log('Result 4:', JSON.stringify(result4, null, 2));
	} catch (error) {
		console.log('Exception 4:', error.message);
		console.log('Stack trace:', error.stack);
	}
	console.log('');

	// Test Case 5: Examine what parameters are being passed to addTask
	console.log('TEST 5: Parameter analysis');
	console.log(
		'The issue appears to be that projectRoot is being passed as the tag parameter.'
	);
	console.log('In the manual task creation path:');
	console.log('- Line 129 passes projectRoot as the 9th parameter');
	console.log('- The 9th parameter in addTask function is tag');
	console.log('- So projectRoot gets interpreted as tag name');
	console.log('- Should pass null or getCurrentTag() instead of projectRoot');
	console.log('');
}

// Check if tasks.json exists and is readable
import fs from 'fs';

console.log('=== ENVIRONMENT CHECK ===');
const testTasksPath = path.join(
	__dirname,
	'.taskmaster',
	'tasks',
	'tasks.json'
);
console.log('Tasks path:', testTasksPath);
console.log('Tasks file exists:', fs.existsSync(testTasksPath));

if (fs.existsSync(testTasksPath)) {
	try {
		const content = fs.readFileSync(testTasksPath, 'utf8');
		console.log(
			'Tasks file content preview:',
			content.substring(0, 200) + (content.length > 200 ? '...' : '')
		);
	} catch (error) {
		console.log('Error reading tasks file:', error.message);
	}
}

console.log('');

// Run the debug tests
testAddTaskDirect().catch(console.error);
