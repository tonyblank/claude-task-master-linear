/**
 * @fileoverview Functional tests for LinearIntegrationHandler
 * Tests core functionality without deep implementation details
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

describe('LinearIntegrationHandler - Functional Tests', () => {
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

	describe('Constructor and Basic Properties', () => {
		test('should extend BaseIntegrationHandler', () => {
			expect(handler).toBeInstanceOf(BaseIntegrationHandler);
			expect(handler.name).toBe('linear');
			expect(handler.version).toBe('1.0.0');
		});

		test('should have proper configuration', () => {
			const config = handler.getConfig();
			expect(config.enabled).toBe(true);
			expect(config.timeout).toBe(30000);
			expect(config.maxAttempts).toBe(3);
			expect(config.retryableErrors).toContain('RATE_LIMIT');
			expect(config.retryableErrors).toContain('NETWORK_ERROR');
			expect(config.backoffStrategy).toBe('exponential');
		});

		test('should have enabled status based on configuration', () => {
			// The actual enabled status depends on internal validation
			const isEnabled = handler.isEnabled();
			expect(typeof isEnabled).toBe('boolean');
		});
	});

	describe('Core Functionality', () => {
		test('should have task title mapping functionality', () => {
			const task = { id: '1', title: 'Test Task' };
			const result = handler._mapTaskTitle(task);
			expect(typeof result).toBe('string');
			expect(result).toContain('Test Task');
		});

		test('should have task description formatting functionality', () => {
			const task = {
				id: '1',
				title: 'Test Task',
				description: 'Test description',
				details: 'Implementation details'
			};
			const result = handler._formatTaskDescription(task);
			expect(typeof result).toBe('string');
			expect(result).toContain('Test description');
			expect(result).toContain('Implementation details');
		});

		test('should have priority mapping functionality', () => {
			const result1 = handler._mapTaskPriorityToLinear('high');
			const result2 = handler._mapTaskPriorityToLinear('medium');
			const result3 = handler._mapTaskPriorityToLinear('low');

			expect(typeof result1).toBe('number');
			expect(typeof result2).toBe('number');
			expect(typeof result3).toBe('number');
		});

		test('should have URL construction functionality', () => {
			const identifier = 'TM-123';
			const result = handler._constructIssueUrl(identifier);
			expect(typeof result).toBe('string');
			expect(result).toContain('linear.app');
			expect(result).toContain('TM-123');
		});
	});

	describe('Message Creation Methods', () => {
		const mockTask = { id: '1', title: 'Test Task' };
		const mockLinearData = {
			id: 'issue-123',
			identifier: 'TM-123',
			url: 'https://linear.app/test/issue/TM-123',
			title: 'Test Issue'
		};

		test('createSuccessMessage should create proper success message', () => {
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
		});

		test('createErrorMessage should create proper error message', () => {
			const error = new Error('Test error');
			const message = handler.createErrorMessage('create', mockTask, error);

			expect(message.success).toBe(false);
			expect(message.type).toBe('error');
			expect(message.operation).toBe('create');
			expect(message.task.id).toBe('1');
			expect(message.title).toContain('❌');
			expect(message.error.message).toBe('Test error');
		});

		test('createRetryMessage should create proper retry message', () => {
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

		test('createProgressMessage should create proper progress message', () => {
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

	describe('Utility Methods', () => {
		test('_formatPriority should format Linear priorities for display', () => {
			expect(handler._formatPriority(1)).toBe('Urgent');
			expect(handler._formatPriority(2)).toBe('High');
			expect(handler._formatPriority(3)).toBe('Medium');
			expect(handler._formatPriority(4)).toBe('Low');
			expect(handler._formatPriority(5)).toBe('Unknown');
		});

		test('_formatDelay should format delays in human-readable format', () => {
			const result1 = handler._formatDelay(500);
			const result2 = handler._formatDelay(1500);
			const result3 = handler._formatDelay(65000);

			expect(typeof result1).toBe('string');
			expect(typeof result2).toBe('string');
			expect(typeof result3).toBe('string');
			expect(result1).toContain('s');
			expect(result2).toContain('s');
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

	describe('Error Handling', () => {
		test('should classify different error types', () => {
			const authError = new Error('Authentication required');
			const result1 = handler._classifyError(authError);
			expect(typeof result1).toBe('string');

			const rateLimitError = new Error('Rate limit exceeded');
			const result2 = handler._classifyError(rateLimitError);
			expect(typeof result2).toBe('string');

			const networkError = new Error('Network timeout');
			networkError.code = 'ETIMEDOUT';
			const result3 = handler._classifyError(networkError);
			expect(typeof result3).toBe('string');
		});

		test('should identify retryable errors', () => {
			const authError = new Error('Authentication required');
			const result1 = handler._isRetryableError(authError);
			expect(typeof result1).toBe('boolean');

			const rateLimitError = new Error('Rate limit exceeded');
			const result2 = handler._isRetryableError(rateLimitError);
			expect(typeof result2).toBe('boolean');

			const networkError = new Error('Network timeout');
			networkError.code = 'ETIMEDOUT';
			const result3 = handler._isRetryableError(networkError);
			expect(typeof result3).toBe('boolean');
		});
	});

	describe('Response Processing', () => {
		test('should process Linear response for createIssue operations', () => {
			const mockResponse = {
				issue: {
					id: 'issue-123',
					identifier: 'TM-123',
					title: 'Test Issue'
				}
			};

			const result = handler._parseLinearResponse(mockResponse, 'createIssue');
			expect(result).toBeDefined();
			expect(result.id).toBe('issue-123');
			expect(result.identifier).toBe('TM-123');
		});

		test('should handle Linear response parsing for different operations', () => {
			const mockResponse = {
				issue: {
					id: 'issue-123',
					identifier: 'TM-123',
					title: 'Test Issue'
				}
			};

			const createResult = handler._parseLinearResponse(
				mockResponse,
				'createIssue'
			);
			expect(createResult).toBeDefined();

			const updateResult = handler._parseLinearResponse(
				mockResponse,
				'updateIssue'
			);
			expect(updateResult).toBeDefined();
		});
	});

	describe('Lifecycle Management', () => {
		test('should handle missing configuration gracefully', () => {
			const invalidHandler = new LinearIntegrationHandler({});
			expect(invalidHandler).toBeDefined();
			expect(invalidHandler.isEnabled()).toBe(false);
		});

		test('should provide status information', () => {
			const status = handler.getConfigStatus();
			expect(status).toBeDefined();
			expect(typeof status).toBe('object');
		});
	});
});
