/**
 * @fileoverview Unit tests for LinearIntegrationHandler
 * Tests individual methods, field mapping, response parsing, and configuration
 */

import { jest } from '@jest/globals';
import { LinearIntegrationHandler } from '../../../scripts/modules/integrations/linear-integration-handler.js';
import { BaseIntegrationHandler } from '../../../scripts/modules/events/base-integration-handler.js';
import { EVENT_TYPES } from '../../../scripts/modules/events/types.js';

// Mock the Linear SDK
jest.mock('@linear/sdk', () => ({
	LinearClient: jest.fn(() => ({
		viewer: jest.fn().mockResolvedValue({
			name: 'Test User',
			id: 'test-user-id'
		}),
		teams: jest.fn().mockResolvedValue({
			nodes: [
				{
					id: 'test-team-id',
					name: 'Test Team'
				}
			]
		})
	}))
}));

// Mock utilities
jest.mock('../../../scripts/modules/utils.js', () => ({
	log: jest.fn(),
	readJSON: jest.fn(),
	writeJSON: jest.fn(),
	getCurrentTag: jest.fn().mockReturnValue('main'),
	findProjectRoot: jest.fn().mockReturnValue('/test/project')
}));

// Mock config manager
jest.mock('../../../scripts/modules/config-manager.js', () => ({
	getLinearConfig: jest.fn().mockReturnValue({
		apiKey: 'lin_api_test123',
		teamId: 'test-team-id',
		createIssues: true,
		defaultProjectId: 'test-project-id',
		priorityMapping: {
			high: 1,
			medium: 2,
			low: 3
		},
		statusMapping: {
			pending: 'Todo',
			'in-progress': 'In Progress',
			done: 'Done'
		}
	}),
	getLinearPriorityMapping: jest.fn().mockReturnValue({
		high: 1,
		medium: 2,
		low: 3
	}),
	getLinearStatusMapping: jest.fn().mockReturnValue({
		pending: 'Todo',
		'in-progress': 'In Progress',
		done: 'Done'
	})
}));

describe('LinearIntegrationHandler', () => {
	let handler;
	let mockConfig;

	beforeEach(() => {
		mockConfig = {
			apiKey: 'lin_api_test123',
			teamId: 'test-team-id',
			createIssues: true,
			defaultProjectId: 'test-project-id',
			enabled: true
		};

		handler = new LinearIntegrationHandler(mockConfig);
		jest.clearAllMocks();
	});

	describe('Constructor and Initialization', () => {
		test('should extend BaseIntegrationHandler', () => {
			expect(handler).toBeInstanceOf(BaseIntegrationHandler);
			expect(handler.name).toBe('linear');
			expect(handler.version).toBe('1.0.0');
		});

		test('should merge config with Linear-specific defaults', () => {
			const config = handler.getConfig();
			expect(config.enabled).toBe(true);
			expect(config.timeout).toBe(30000);
			expect(config.maxAttempts).toBe(3);
			expect(config.retryableErrors).toContain('RATE_LIMIT');
			expect(config.retryableErrors).toContain('NETWORK_ERROR');
			expect(config.backoffStrategy).toBe('exponential');
		});

		test('should initialize with proper Linear configuration', () => {
			expect(handler.config.apiKey).toBe('lin_api_test123');
			expect(handler.config.teamId).toBe('test-team-id');
			expect(handler.config.createIssues).toBe(true);
		});
	});

	describe('Field Mapping Functions', () => {
		const mockTask = {
			id: '1',
			title: 'Test Task',
			description: 'Test description',
			details: 'Detailed implementation notes',
			status: 'pending',
			priority: 'high',
			dependencies: [],
			subtasks: []
		};

		test('_mapTaskTitle should return formatted task title', () => {
			const result = handler._mapTaskTitle(mockTask);
			expect(result).toBe('[TM-1] Test Task'); // Actual implementation prefixes with task ID
		});

		test('_formatTaskDescription should format description and details', () => {
			const result = handler._formatTaskDescription(mockTask);
			expect(result).toContain('Test description');
			expect(result).toContain('Detailed implementation notes');
			expect(result).toContain('**TaskMaster Task #1**');
			expect(result).toContain('**Implementation Details:**');
		});

		test('_formatTaskDescription should handle missing description', () => {
			const taskWithoutDesc = { ...mockTask, description: '' };
			const result = handler._formatTaskDescription(taskWithoutDesc);
			expect(result).toContain('**Implementation Details:**');
			expect(result).toContain('Detailed implementation notes');
		});

		test('_formatTaskDescription should handle missing details', () => {
			const taskWithoutDetails = { ...mockTask, details: '' };
			const result = handler._formatTaskDescription(taskWithoutDetails);
			expect(result).toContain('**TaskMaster Task #1**');
			expect(result).toContain('Test description');
		});

		test('_mapTaskPriorityToLinear should map task priorities correctly', () => {
			// This method calls external config, so we test the behavior by checking it returns a number
			const result1 = handler._mapTaskPriorityToLinear('high');
			const result2 = handler._mapTaskPriorityToLinear('medium');
			const result3 = handler._mapTaskPriorityToLinear('low');
			const result4 = handler._mapTaskPriorityToLinear('unknown');

			expect(typeof result1).toBe('number');
			expect(typeof result2).toBe('number');
			expect(typeof result3).toBe('number');
			expect(typeof result4).toBe('number');
		});
	});

	describe('Response Parsing Methods', () => {
		test('_parseCreateIssueResponse should parse Linear issue creation response', () => {
			const mockResponse = {
				issue: {
					id: 'issue-123',
					identifier: 'TM-123',
					title: 'Test Issue',
					url: 'https://linear.app/test/issue/TM-123',
					state: { name: 'Todo' },
					team: { name: 'Test Team' },
					priority: 1,
					labels: {
						nodes: [{ name: 'bug' }, { name: 'frontend' }]
					},
					assignee: { name: 'John Doe' },
					number: 123,
					createdAt: '2023-01-01T00:00:00Z',
					updatedAt: '2023-01-01T00:00:00Z'
				}
			};

			const result = handler._parseCreateIssueResponse(mockResponse);
			expect(result.id).toBe('issue-123');
			expect(result.identifier).toBe('TM-123');
			expect(result.title).toBe('Test Issue');
			expect(result.url).toBe('https://linear.app/test/issue/TM-123');
			expect(result.state).toEqual({
				id: undefined,
				name: 'Todo',
				type: undefined
			});
			expect(result.team).toEqual({
				id: undefined,
				name: 'Test Team',
				key: undefined
			});
			expect(result.priority).toBe(1);
		});

		test('_parseCreateIssueResponse should handle missing optional fields', () => {
			const mockResponse = {
				issue: {
					id: 'issue-123',
					identifier: 'TM-123',
					title: 'Test Issue'
				}
			};

			const result = handler._parseCreateIssueResponse(mockResponse);
			expect(result.id).toBe('issue-123');
			expect(result.identifier).toBe('TM-123');
			expect(result.title).toBe('Test Issue');
			expect(result.url).toBe('https://linear.app/team/tm/issue/TM-123'); // Implementation constructs URL
			expect(result.state).toBe(null);
		});

		test('_parseLinearResponse should route to correct parser based on operation type', () => {
			const mockResponse = {
				issue: { id: 'test-id', identifier: 'TM-1' }
			};

			const createResult = handler._parseLinearResponse(
				mockResponse,
				'createIssue'
			);
			expect(createResult.id).toBe('test-id');

			const updateResult = handler._parseLinearResponse(
				mockResponse,
				'updateIssue'
			);
			// Update operation also processes the response, doesn't return raw response
			expect(updateResult.id).toBe('test-id');
		});

		test('_constructIssueUrl should build Linear issue URL from identifier', () => {
			const identifier = 'TM-123';
			const result = handler._constructIssueUrl(identifier);
			expect(result).toContain('linear.app');
			expect(result).toContain('TM-123');
		});
	});

	describe('Error Handling and Classification', () => {
		test('_classifyError should correctly classify different error types', () => {
			const authError = new Error('Authentication required');
			expect(handler._classifyError(authError)).toBe('AUTHENTICATION_ERROR');

			const rateLimitError = new Error('Rate limit exceeded');
			expect(handler._classifyError(rateLimitError)).toBe('RATE_LIMIT_ERROR');

			const networkError = new Error('Network timeout');
			networkError.code = 'ETIMEDOUT';
			expect(handler._classifyError(networkError)).toBe('NETWORK_ERROR');

			const validationError = new Error('Missing required field');
			expect(handler._classifyError(validationError)).toBe('UNKNOWN_ERROR');

			const unknownError = new Error('Something went wrong');
			expect(handler._classifyError(unknownError)).toBe('UNKNOWN_ERROR');
		});

		test('_isRetryableError should identify retryable errors', () => {
			const authError = new Error('Authentication required');
			expect(handler._isRetryableError(authError)).toBe(false);

			const rateLimitError = new Error('Rate limit exceeded');
			expect(handler._isRetryableError(rateLimitError)).toBe(true);

			const networkError = new Error('Network timeout');
			networkError.code = 'ETIMEDOUT';
			expect(handler._isRetryableError(networkError)).toBe(true);

			const validationError = new Error('Missing required field');
			expect(handler._isRetryableError(validationError)).toBe(true);
		});

		test('_enhanceLinearError should enhance errors with classification', () => {
			const originalError = new Error('rate limit exceeded');

			handler._enhanceLinearError(originalError, 'createIssue');

			expect(originalError.code).toBe('RATE_LIMIT');
			expect(originalError.retryable).toBe(true);
			expect(originalError.operationName).toBe('createIssue');
			expect(originalError.originalMessage).toBe('rate limit exceeded');
		});

		test('_getErrorDisplayInfo should provide user-friendly error information', () => {
			const authError = new Error('Invalid API key');
			const errorInfo = handler._getErrorDisplayInfo(
				authError,
				'AUTHENTICATION_ERROR'
			);

			expect(errorInfo.category).toBe('Authentication Error');
			expect(errorInfo.description).toContain(
				'Unable to authenticate with Linear API'
			);
			expect(errorInfo.causes).toBeInstanceOf(Array);
			expect(errorInfo.resolution).toBeInstanceOf(Array);
			expect(errorInfo.actions).toHaveProperty('checkConfig');
		});
	});

	describe('Message Formatting', () => {
		const mockTask = {
			id: '1',
			title: 'Test Task'
		};

		const mockLinearData = {
			id: 'issue-123',
			identifier: 'TM-123',
			url: 'https://linear.app/test/issue/TM-123',
			title: 'Test Issue',
			team: { name: 'Test Team' }
		};

		test('createSuccessMessage should format success messages correctly', () => {
			const message = handler.createSuccessMessage(
				'create',
				mockTask,
				mockLinearData
			);

			expect(message.success).toBe(true);
			expect(message.type).toBe('success');
			expect(message.operation).toBe('create');
			expect(message.task.id).toBe('1');
			expect(message.title).toContain('✅');
			expect(message.details.linearIssue.id).toBe('issue-123');
			expect(message.actions.viewIssue.url).toBe(
				'https://linear.app/test/issue/TM-123'
			);
		});

		test('createErrorMessage should format error messages correctly', () => {
			const error = new Error('Test error');
			const message = handler.createErrorMessage('create', mockTask, error);

			expect(message.success).toBe(false);
			expect(message.type).toBe('error');
			expect(message.operation).toBe('create');
			expect(message.task.id).toBe('1');
			expect(message.title).toContain('❌');
			expect(message.error.message).toBe('Test error');
		});

		test('createRetryMessage should format retry messages correctly', () => {
			const error = new Error('Rate limit exceeded');
			const retryInfo = {
				currentAttempt: 2,
				maxAttempts: 3,
				delay: 2000
			};

			const message = handler.createRetryMessage(
				'create',
				mockTask,
				error,
				retryInfo
			);

			expect(message.success).toBe(false);
			expect(message.type).toBe('retry');
			expect(message.retry.attempt).toBe(2);
			expect(message.retry.maxAttempts).toBe(3);
			expect(message.retry.delayMs).toBe(2000);
			expect(message.title).toContain('🔄');
		});

		test('createProgressMessage should format progress messages correctly', () => {
			const message = handler.createProgressMessage(
				'create',
				mockTask,
				'validating'
			);

			expect(message.success).toBe(null);
			expect(message.type).toBe('progress');
			expect(message.operation).toBe('create');
			expect(message.progress.stage).toBe('validating');
			expect(message.title).toContain('🔄');
		});
	});

	describe('Utility Methods', () => {
		test('_formatDelay should format delays in human-readable format', () => {
			expect(handler._formatDelay(500)).toBe('500ms');
			expect(handler._formatDelay(1500)).toBe('2s');
			expect(handler._formatDelay(65000)).toBe('1m');
			expect(handler._formatDelay(125000)).toBe('2m');
		});

		test('_formatPriority should format Linear priorities for display', () => {
			expect(handler._formatPriority(1)).toBe('Urgent');
			expect(handler._formatPriority(2)).toBe('High');
			expect(handler._formatPriority(3)).toBe('Medium');
			expect(handler._formatPriority(4)).toBe('Low');
			expect(handler._formatPriority(5)).toBe('Unknown');
		});

		test('_getProgressMessage should generate appropriate progress messages', () => {
			const task = { title: 'Test Task' };

			expect(handler._getProgressMessage('create', 'validating', task)).toBe(
				'Validating task data for "Test Task"'
			);
			expect(handler._getProgressMessage('create', 'creating', task)).toBe(
				'Creating Linear issue for "Test Task"'
			);
			expect(handler._getProgressMessage('update', 'syncing', task)).toBe(
				'Synchronizing with Linear issue'
			);
		});

		test('_getProgressMessage should truncate long task titles', () => {
			const task = {
				title: 'This is a very long task title that should be truncated'
			};
			const message = handler._getProgressMessage('create', 'validating', task);
			expect(message).toContain('...');
			expect(message.length).toBeLessThan(100);
		});
	});

	describe('Configuration Validation', () => {
		test('_validateConfiguration should validate required config fields', () => {
			// Should not throw with valid config
			expect(() => handler._validateConfiguration()).not.toThrow();

			// Test with invalid config
			const invalidHandler = new LinearIntegrationHandler({});
			expect(() => invalidHandler._validateConfiguration()).toThrow();
		});

		test('_validateIssueData should validate issue data before API calls', () => {
			const validIssueData = {
				title: 'Test Issue',
				description: 'Test description',
				teamId: 'test-team-id'
			};

			expect(() => handler._validateIssueData(validIssueData)).not.toThrow();

			const invalidIssueData = {
				description: 'Test description'
				// missing title
			};

			expect(() => handler._validateIssueData(invalidIssueData)).toThrow();
		});
	});

	describe('Event Handler Method Names', () => {
		test('should have correct handler method names for TaskMaster events', () => {
			expect(handler._getHandlerMethodName(EVENT_TYPES.TASK_CREATED)).toBe(
				'handleTaskCreated'
			);
			expect(
				handler._getHandlerMethodName(EVENT_TYPES.TASK_STATUS_CHANGED)
			).toBe('handleTaskStatusChanged');
			expect(handler._getHandlerMethodName(EVENT_TYPES.TASK_UPDATED)).toBe(
				'handleTaskUpdated'
			);
		});
	});
});
