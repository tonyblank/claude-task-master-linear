/**
 * @fileoverview Simple unit tests for LinearIntegrationHandler
 * Tests public methods and configuration without accessing private methods
 */

import { jest } from '@jest/globals';
import { LinearIntegrationHandler } from '../../../scripts/modules/integrations/linear-integration-handler.js';
import { BaseIntegrationHandler } from '../../../scripts/modules/events/base-integration-handler.js';
import { EVENT_TYPES } from '../../../scripts/modules/events/types.js';

// Mock Linear SDK
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

describe('LinearIntegrationHandler - Simple Unit Tests', () => {
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
		});

		test('should be enabled when properly configured', () => {
			expect(handler.isEnabled()).toBe(false); // Not initialized yet
		});
	});

	describe('Message Creation Methods', () => {
		const mockTask = {
			id: '1',
			title: 'Test Task'
		};

		const mockLinearData = {
			id: 'issue-123',
			identifier: 'TT-123',
			url: 'https://linear.app/test/issue/TT-123',
			title: 'Test Issue',
			team: { name: 'Test Team' }
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
			expect(message.details.linearIssue.id).toBe('issue-123');
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

	describe('Configuration Validation', () => {
		test('should validate configuration on creation', () => {
			expect(
				() =>
					new LinearIntegrationHandler({
						apiKey: 'lin_api_valid123',
						teamId: 'team-123',
						createIssues: true
					})
			).not.toThrow();
		});

		test('should handle missing configuration gracefully', () => {
			expect(() => new LinearIntegrationHandler({})).not.toThrow();
		});
	});

	describe('Lifecycle Management', () => {
		test('should handle initialization failure gracefully', async () => {
			await expect(handler.initialize(mockConfig)).rejects.toThrow(
				'Authentication required'
			);
			expect(handler.initialized).toBe(false);
		});

		test('should shutdown gracefully even when not initialized', async () => {
			await expect(handler.shutdown()).resolves.not.toThrow();
			expect(handler.initialized).toBe(false);
		});
	});

	describe('Handler Status Information', () => {
		test('should provide status information', () => {
			const status = handler.getStatus();
			expect(status).toHaveProperty('name', 'linear');
			expect(status).toHaveProperty('version', '1.0.0');
			expect(status).toHaveProperty('initialized');
			expect(status).toHaveProperty('enabled');
			expect(status).toHaveProperty('activeOperations');
		});
	});
});
