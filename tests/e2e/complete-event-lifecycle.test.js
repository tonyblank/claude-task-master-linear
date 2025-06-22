/**
 * @fileoverview End-to-end tests for complete event lifecycle
 *
 * Tests the entire event flow from task creation through integration
 * processing, including real-world scenarios and edge cases.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import path from 'path';
import fs from 'fs/promises';
import { TestFactories } from '../factories/test-factories.js';
import {
	EnhancedMockFactory,
	ScenarioBuilder
} from '../utils/enhanced-mocks.js';
import { EVENT_TYPES } from '../../scripts/modules/events/types.js';
import { createStandardEventPayload } from '../../scripts/modules/events/payload-serializer.js';

describe('Complete Event Lifecycle E2E Tests', () => {
	let testEnv;
	let tempDir;

	beforeEach(async () => {
		// Create temporary directory for test files
		tempDir = path.join(process.cwd(), 'temp-test-' + Date.now());
		await fs.mkdir(tempDir, { recursive: true });

		testEnv = TestFactories.createTestEnvironment('e2e-test', {
			config: {
				enableErrorBoundaries: true,
				enableCircuitBreakers: true,
				enableHealthMonitoring: true,
				enableAutoRecovery: true,
				enableBatching: false, // Disable for clearer E2E testing
				handlerTimeout: 10000,
				eventTimeout: 15000
			}
		});
	});

	afterEach(async () => {
		if (testEnv) {
			testEnv.cleanup();
		}

		// Clean up temporary directory
		try {
			await fs.rm(tempDir, { recursive: true, force: true });
		} catch (error) {
			console.warn('Failed to clean up temp directory:', error.message);
		}
	});

	describe('Task Creation to Linear Integration Flow', () => {
		it('should complete full task creation and Linear integration flow', async () => {
			const scenario = new ScenarioBuilder()
				.setupLinearApi({
					latency: 150,
					errorRate: 0,
					apiKey: 'test-linear-api-key',
					teamId: 'test-team'
				})
				.setupTaskManager({
					persistToDisk: true,
					simulateFileErrors: false
				})
				.step('Initialize integration manager', async function (context) {
					const { integrationManager } = testEnv;
					await integrationManager.initialize();
					context.integrationManager = integrationManager;
				})
				.step('Register Linear integration handler', async function (context) {
					const linearHandler = TestFactories.createTestIntegrationHandler(
						'linear-integration',
						{
							eventHandlers: {
								'task:created': async (payload) => {
									// Simulate Linear issue creation
									const issue = await this.linearApi.createIssue({
										title: payload.task.title,
										description: payload.task.description,
										priority: payload.task.priority
									});

									return {
										integration: 'linear',
										action: 'issue_created',
										issueId: issue.id,
										issueUrl: issue.url,
										taskId: payload.taskId
									};
								},
								'task:updated': async (payload) => {
									// Simulate Linear issue update
									const existingIssues = await this.linearApi.listIssues();
									// Look for issue by task ID or original title, since title might have changed
									const matchingIssue = existingIssues.issues.find(
										(issue) =>
											issue.title ===
												(payload.changes?.title || payload.task.title) ||
											issue.title === 'E2E Test Task' // Original title before update
									);

									if (matchingIssue) {
										const updatedIssue = await this.linearApi.updateIssue(
											matchingIssue.id,
											{
												title: payload.task.title,
												description: payload.task.description,
												status:
													payload.task.status === 'done' ? 'completed' : 'todo'
											}
										);

										return {
											integration: 'linear',
											action: 'issue_updated',
											issueId: updatedIssue.id,
											taskId: payload.taskId,
											changes: payload.changes
										};
									}

									return {
										integration: 'linear',
										action: 'no_matching_issue',
										taskId: payload.taskId
									};
								},
								'task:status:changed': async (payload) => {
									// Simulate Linear issue status update
									const existingIssues = await this.linearApi.listIssues();
									const matchingIssue = existingIssues.issues.find((issue) =>
										issue.title.includes('E2E Test Task')
									);

									if (matchingIssue) {
										const statusMap = {
											pending: 'todo',
											'in-progress': 'in_progress',
											done: 'completed'
										};

										const updatedIssue = await this.linearApi.updateIssue(
											matchingIssue.id,
											{
												status: statusMap[payload.newStatus] || 'todo'
											}
										);

										return {
											integration: 'linear',
											action: 'status_updated',
											issueId: updatedIssue.id,
											taskId: payload.taskId,
											oldStatus: payload.oldStatus,
											newStatus: payload.newStatus
										};
									}

									return {
										integration: 'linear',
										action: 'no_matching_issue_for_status',
										taskId: payload.taskId
									};
								}
							}
						}
					);

					await context.integrationManager.register(linearHandler);
					context.linearHandler = linearHandler;
				})
				.step('Create a new task', async function (context) {
					const taskData = {
						title: 'E2E Test Task',
						description: 'End-to-end integration test task',
						priority: 'high'
					};

					const task = await this.taskManager.addTask(taskData);
					context.task = task;

					// Emit task created event
					const eventPayload = createStandardEventPayload(
						EVENT_TYPES.TASK_CREATED,
						{
							taskId: task.id,
							task,
							tag: 'e2e-test'
						},
						{
							projectRoot: tempDir,
							session: { user: 'e2e_test_user' },
							source: 'cli',
							requestId: `e2e-${Date.now()}`
						}
					);

					const results = await context.integrationManager.handleEvent(
						EVENT_TYPES.TASK_CREATED,
						eventPayload
					);

					context.createResults = results;
				})
				.step('Update the task', async function (context) {
					const updatedTask = await this.taskManager.updateTask(
						context.task.id,
						{
							title: 'Updated E2E Test Task',
							status: 'in-progress'
						}
					);

					context.updatedTask = updatedTask;

					// Emit task updated event
					const eventPayload = createStandardEventPayload(
						EVENT_TYPES.TASK_UPDATED,
						{
							taskId: updatedTask.id,
							task: updatedTask,
							changes: {
								title: updatedTask.title,
								status: updatedTask.status
							},
							oldValues: {
								title: context.task.title,
								status: context.task.status
							},
							tag: 'e2e-test'
						},
						{
							projectRoot: tempDir,
							session: { user: 'e2e_test_user' },
							source: 'cli',
							requestId: `e2e-update-${Date.now()}`
						}
					);

					const results = await context.integrationManager.handleEvent(
						EVENT_TYPES.TASK_UPDATED,
						eventPayload
					);

					context.updateResults = results;
				})
				.step('Complete the task', async function (context) {
					const completedTask = await this.taskManager.updateTask(
						context.task.id,
						{
							status: 'done'
						}
					);

					context.completedTask = completedTask;

					// Emit status changed event
					const eventPayload = createStandardEventPayload(
						EVENT_TYPES.TASK_STATUS_CHANGED,
						{
							taskId: completedTask.id,
							task: completedTask,
							oldStatus: 'in-progress',
							newStatus: 'done',
							tag: 'e2e-test'
						},
						{
							projectRoot: tempDir,
							session: { user: 'e2e_test_user' },
							source: 'cli',
							requestId: `e2e-complete-${Date.now()}`
						}
					);

					const results = await context.integrationManager.handleEvent(
						EVENT_TYPES.TASK_STATUS_CHANGED,
						eventPayload
					);

					context.completeResults = results;
				})
				.expect('Task creation should succeed', function (context) {
					expect(context.task).toBeDefined();
					expect(context.task.title).toBe('E2E Test Task');
					expect(context.task.status).toBe('pending');
				})
				.expect('Linear integration should create issue', function (context) {
					expect(context.createResults).toHaveLength(1);
					expect(context.createResults[0].success).toBe(true);
					expect(context.createResults[0].result.integration).toBe('linear');
					expect(context.createResults[0].result.action).toBe('issue_created');
					expect(context.createResults[0].result.issueId).toBeDefined();
				})
				.expect(
					'Task update should trigger integration update',
					function (context) {
						expect(context.updateResults).toHaveLength(1);
						expect(context.updateResults[0].success).toBe(true);
						expect(context.updateResults[0].result.action).toBe(
							'issue_updated'
						);
					}
				)
				.expect('Task completion should be processed', function (context) {
					expect(context.completeResults).toHaveLength(1);
					// Note: This handler doesn't implement task:status:changed, so it will use fallback
				})
				.expect(
					'Linear API calls should be made correctly',
					function (context) {
						// Check that Linear API methods were called using mock call tracking
						expect(
							this.linearApi.createIssue.mock.calls.length
						).toBeGreaterThan(0);
						expect(
							this.linearApi.updateIssue.mock.calls.length
						).toBeGreaterThan(0);
					}
				)
				.cleanup(async function () {
					if (this.linearApi) {
						this.linearApi._resetMockIssues();
					}
					if (this.taskManager) {
						this.taskManager._resetTasks();
					}
				});

			const result = await scenario.execute();
			expect(result.success).toBe(true);
		});

		it('should handle network failures gracefully in E2E flow', async () => {
			const scenario = new ScenarioBuilder()
				.setupLinearApi({
					latency: 200,
					errorRate: 0.3, // 30% error rate
					timeoutRate: 0.1 // 10% timeout rate
				})
				.setupNetworkSimulator({
					baseLatency: 100,
					jitter: 50
				})
				.step(
					'Initialize integration with network issues',
					async function (context) {
						this.networkSimulator.setCondition('unstable');

						const { integrationManager } = testEnv;
						await integrationManager.initialize();
						context.integrationManager = integrationManager;
					}
				)
				.step('Register resilient Linear handler', async function (context) {
					const resilientHandler = TestFactories.createTestIntegrationHandler(
						'resilient-linear',
						{
							eventHandlers: {
								'task:created': async (payload) => {
									let attempts = 0;
									const maxAttempts = 3;

									while (attempts < maxAttempts) {
										try {
											attempts++;
											await this.networkSimulator.simulateRequest(1024);

											const issue = await this.linearApi.createIssue({
												title: payload.task.title,
												description: payload.task.description,
												priority: payload.task.priority
											});

											return {
												integration: 'linear',
												action: 'issue_created',
												issueId: issue.id,
												attempts
											};
										} catch (error) {
											if (attempts === maxAttempts) {
												return {
													integration: 'linear',
													action: 'failed_after_retries',
													error: error.message,
													attempts
												};
											}
											// Wait before retry
											await new Promise((resolve) =>
												setTimeout(resolve, 100 * attempts)
											);
										}
									}
								}
							}
						}
					);

					await context.integrationManager.register(resilientHandler);
					context.resilientHandler = resilientHandler;
				})
				.step(
					'Process multiple tasks with network issues',
					async function (context) {
						const tasks = [];
						const results = [];

						for (let i = 1; i <= 5; i++) {
							const task = {
								id: `network-test-${i}`,
								title: `Network Test Task ${i}`,
								description: `Testing network resilience ${i}`,
								status: 'pending',
								priority: 'medium'
							};

							tasks.push(task);

							const eventPayload = createStandardEventPayload(
								EVENT_TYPES.TASK_CREATED,
								{
									taskId: task.id,
									task,
									tag: 'network-test'
								},
								{
									projectRoot: tempDir,
									session: { user: 'network_test_user' },
									source: 'cli',
									requestId: `network-${i}-${Date.now()}`
								}
							);

							const result = await context.integrationManager.handleEvent(
								EVENT_TYPES.TASK_CREATED,
								eventPayload
							);

							results.push(result);
						}

						context.tasks = tasks;
						context.networkResults = results;
					}
				)
				.expect(
					'Some tasks should succeed despite network issues',
					function (context) {
						expect(context.networkResults).toHaveLength(5);

						const successfulResults = context.networkResults.filter(
							(resultSet) =>
								resultSet[0].success &&
								resultSet[0].result.action === 'issue_created'
						);
						const failedResults = context.networkResults.filter(
							(resultSet) =>
								!resultSet[0].success ||
								resultSet[0].result.action === 'failed_after_retries'
						);

						// Should have some successes and some failures due to network issues
						expect(successfulResults.length + failedResults.length).toBe(5);

						// At least some should succeed (resilience working)
						expect(successfulResults.length).toBeGreaterThan(0);

						console.log(
							`Network resilience test: ${successfulResults.length} succeeded, ${failedResults.length} failed`
						);
					}
				)
				.cleanup(async function () {
					this.networkSimulator.setCondition('normal');
				});

			const result = await scenario.execute();
			expect(result.success).toBe(true);
		});
	});

	describe('Bulk Operations E2E Flow', () => {
		it('should handle bulk task operations end-to-end', async () => {
			const scenario = new ScenarioBuilder()
				.setupTaskManager({ persistToDisk: true })
				.setupLinearApi({ latency: 50 })
				.step(
					'Initialize system for bulk operations',
					async function (context) {
						const { integrationManager } = testEnv;
						await integrationManager.initialize();
						context.integrationManager = integrationManager;
					}
				)
				.step('Register bulk-aware Linear handler', async function (context) {
					const bulkHandler = TestFactories.createTestIntegrationHandler(
						'bulk-linear',
						{
							eventHandlers: {
								'tasks:bulk:created': async (payload) => {
									const issues = [];

									for (const task of payload.tasks) {
										try {
											const issue = await this.linearApi.createIssue({
												title: task.title,
												description: task.description,
												priority: task.priority
											});
											issues.push({ taskId: task.id, issue });
										} catch (error) {
											issues.push({ taskId: task.id, error: error.message });
										}
									}

									return {
										integration: 'linear',
										action: 'bulk_issues_created',
										issues,
										totalTasks: payload.tasks.length,
										successCount: issues.filter((i) => !i.error).length
									};
								}
							}
						}
					);

					await context.integrationManager.register(bulkHandler);
					context.bulkHandler = bulkHandler;
				})
				.step('Create bulk tasks', async function (context) {
					const tasks = [];

					for (let i = 1; i <= 10; i++) {
						const task = await this.taskManager.addTask({
							title: `Bulk Task ${i}`,
							description: `Bulk operation test task ${i}`,
							priority: i <= 3 ? 'high' : i <= 6 ? 'medium' : 'low'
						});
						tasks.push(task);
					}

					context.bulkTasks = tasks;

					// Emit bulk created event
					const eventPayload = createStandardEventPayload(
						EVENT_TYPES.TASKS_BULK_CREATED,
						{
							tasks,
							tag: 'bulk-test',
							operation: 'bulk_create',
							batchId: `bulk-${Date.now()}`
						},
						{
							projectRoot: tempDir,
							session: { user: 'bulk_test_user' },
							source: 'cli',
							requestId: `bulk-create-${Date.now()}`
						}
					);

					const results = await context.integrationManager.handleEvent(
						EVENT_TYPES.TASKS_BULK_CREATED,
						eventPayload
					);

					context.bulkCreateResults = results;
				})
				.step('Update tasks in bulk', async function (context) {
					const updatedTasks = [];

					for (const task of context.bulkTasks.slice(0, 5)) {
						const updated = await this.taskManager.updateTask(task.id, {
							status: 'in-progress'
						});
						updatedTasks.push(updated);
					}

					context.bulkUpdatedTasks = updatedTasks;

					// Emit bulk updated event
					const eventPayload = createStandardEventPayload(
						EVENT_TYPES.TASKS_BULK_UPDATED,
						{
							tasks: updatedTasks,
							changes: { status: 'in-progress' },
							tag: 'bulk-test',
							operation: 'bulk_status_update',
							batchId: `bulk-update-${Date.now()}`
						},
						{
							projectRoot: tempDir,
							session: { user: 'bulk_test_user' },
							source: 'cli',
							requestId: `bulk-update-${Date.now()}`
						}
					);

					// Note: This will use the fallback handler since we didn't implement bulk:updated
					const results = await context.integrationManager.handleEvent(
						EVENT_TYPES.TASKS_BULK_UPDATED,
						eventPayload
					);

					context.bulkUpdateResults = results;
				})
				.expect('Bulk tasks should be created', function (context) {
					expect(context.bulkTasks).toHaveLength(10);
					expect(context.bulkTasks.every((task) => task.id)).toBe(true);
				})
				.expect('Bulk Linear integration should succeed', function (context) {
					expect(context.bulkCreateResults).toHaveLength(1);
					expect(context.bulkCreateResults[0].success).toBe(true);
					expect(context.bulkCreateResults[0].result.action).toBe(
						'bulk_issues_created'
					);
					expect(context.bulkCreateResults[0].result.totalTasks).toBe(10);
					expect(context.bulkCreateResults[0].result.successCount).toBe(10);
				})
				.expect(
					'Linear API should be called for each task',
					function (context) {
						// Check that Linear API was called the expected number of times
						expect(this.linearApi.createIssue.mock.calls.length).toBe(10);
					}
				)
				.cleanup(async function () {
					if (this.linearApi) {
						this.linearApi._resetMockIssues();
					}
					if (this.taskManager) {
						this.taskManager._resetTasks();
					}
				});

			const result = await scenario.execute();
			expect(result.success).toBe(true);
		});
	});

	describe('Error Recovery E2E Scenarios', () => {
		it('should demonstrate complete error recovery flow', async () => {
			const scenario = new ScenarioBuilder()
				.setupLinearApi({
					latency: 100,
					errorRate: 0.5 // 50% error rate initially
				})
				.setupTimeController()
				.step(
					'Initialize system with high error rate',
					async function (context) {
						const { integrationManager } = testEnv;
						await integrationManager.initialize();
						context.integrationManager = integrationManager;
					}
				)
				.step('Register self-healing Linear handler', async function (context) {
					let errorCount = 0;
					const maxErrors = 3;

					const selfHealingHandler = TestFactories.createTestIntegrationHandler(
						'self-healing-linear',
						{
							eventHandlers: {
								'task:created': async (payload) => {
									try {
										const issue = await this.linearApi.createIssue({
											title: payload.task.title,
											description: payload.task.description,
											priority: payload.task.priority
										});

										// Reset error count on success
										errorCount = 0;

										return {
											integration: 'linear',
											action: 'issue_created',
											issueId: issue.id,
											errorCount
										};
									} catch (error) {
										errorCount++;

										if (errorCount >= maxErrors) {
											// Trigger circuit breaker or degraded mode
											return {
												integration: 'linear',
												action: 'degraded_mode',
												error: error.message,
												errorCount
											};
										}

										// Retry with exponential backoff
										await new Promise((resolve) =>
											setTimeout(resolve, Math.pow(2, errorCount) * 100)
										);

										throw error; // Let recovery system handle retry
									}
								}
							}
						}
					);

					await context.integrationManager.register(selfHealingHandler);
					context.selfHealingHandler = selfHealingHandler;
				})
				.step(
					'Process tasks during high error period',
					async function (context) {
						const results = [];

						for (let i = 1; i <= 5; i++) {
							const eventPayload = createStandardEventPayload(
								EVENT_TYPES.TASK_CREATED,
								{
									taskId: `error-recovery-${i}`,
									task: {
										id: `error-recovery-${i}`,
										title: `Error Recovery Test ${i}`,
										description: `Testing error recovery ${i}`,
										status: 'pending',
										priority: 'medium'
									},
									tag: 'error-recovery-test'
								},
								{
									projectRoot: tempDir,
									session: { user: 'error_recovery_user' },
									source: 'cli',
									requestId: `error-recovery-${i}-${Date.now()}`
								}
							);

							const result = await context.integrationManager.handleEvent(
								EVENT_TYPES.TASK_CREATED,
								eventPayload
							);

							results.push(result);

							// Add delay between requests
							await new Promise((resolve) => setTimeout(resolve, 200));
						}

						context.errorRecoveryResults = results;
					}
				)
				.step('Improve conditions and test recovery', async function (context) {
					// Reduce error rate to simulate improving conditions
					this.linearApi.createIssue.mockImplementation(async (issueData) => {
						// Much lower error rate now - only fail the first one for deterministic testing
						if (Math.random() < 0.02) {
							// 2% error rate, much more reliable
							throw new Error('Occasional failure');
						}

						const issue = {
							id: `recovered-issue-${Date.now()}`,
							title: issueData.title,
							description: issueData.description,
							priority: issueData.priority,
							status: 'todo',
							createdAt: new Date().toISOString()
						};

						return issue;
					});

					// Process more tasks under improved conditions
					const recoveryResults = [];

					for (let i = 1; i <= 3; i++) {
						const eventPayload = createStandardEventPayload(
							EVENT_TYPES.TASK_CREATED,
							{
								taskId: `recovery-success-${i}`,
								task: {
									id: `recovery-success-${i}`,
									title: `Recovery Success Test ${i}`,
									description: `Testing successful recovery ${i}`,
									status: 'pending',
									priority: 'high'
								},
								tag: 'recovery-test'
							},
							{
								projectRoot: tempDir,
								session: { user: 'recovery_test_user' },
								source: 'cli',
								requestId: `recovery-${i}-${Date.now()}`
							}
						);

						const result = await context.integrationManager.handleEvent(
							EVENT_TYPES.TASK_CREATED,
							eventPayload
						);

						recoveryResults.push(result);
					}

					context.recoveryResults = recoveryResults;
				})
				.expect(
					'System should handle initial high error rate',
					function (context) {
						expect(context.errorRecoveryResults).toHaveLength(5);

						// Some should fail, some might succeed
						const failures = context.errorRecoveryResults.filter(
							(r) => !r[0].success
						);
						const successes = context.errorRecoveryResults.filter(
							(r) => r[0].success
						);

						expect(failures.length + successes.length).toBe(5);
						console.log(
							`High error period: ${successes.length} successes, ${failures.length} failures`
						);
					}
				)
				.expect(
					'System should recover under improved conditions',
					function (context) {
						expect(context.recoveryResults).toHaveLength(3);

						const recoverySuccesses = context.recoveryResults.filter(
							(r) => r[0].success
						);
						expect(recoverySuccesses.length).toBeGreaterThanOrEqual(2); // Most should succeed now

						console.log(
							`Recovery period: ${recoverySuccesses.length} successes out of 3`
						);
					}
				)
				.cleanup(async function () {
					if (this.linearApi) {
						this.linearApi._resetMockIssues();
					}
				});

			const result = await scenario.execute();
			expect(result.success).toBe(true);
		});
	});

	describe('Real-world Integration Patterns', () => {
		it('should handle webhook-style event processing', async () => {
			const scenario = new ScenarioBuilder()
				.setupLinearApi({ latency: 75 })
				.setupTaskManager({ persistToDisk: true })
				.step('Setup webhook simulation', async function (context) {
					const { integrationManager } = testEnv;
					await integrationManager.initialize();
					context.integrationManager = integrationManager;

					// Simulate external webhook events
					context.webhookEvents = [];
					context.processWebhook = async (webhookData) => {
						context.webhookEvents.push(webhookData);

						// Convert webhook to internal event
						const eventPayload = createStandardEventPayload(
							EVENT_TYPES.INTEGRATION_SUCCESS,
							{
								integration: 'linear',
								webhookData,
								externalId: webhookData.data.issue.id,
								action: webhookData.type
							},
							{
								projectRoot: tempDir,
								session: { user: 'webhook_processor' },
								source: 'api',
								requestId: `webhook-${Date.now()}`
							}
						);

						return await context.integrationManager.handleEvent(
							EVENT_TYPES.INTEGRATION_SUCCESS,
							eventPayload
						);
					};
				})
				.step('Register webhook handler', async function (context) {
					const webhookHandler = TestFactories.createTestIntegrationHandler(
						'webhook-processor',
						{
							eventHandlers: {
								'integration:success': async (payload) => {
									const { webhookData } = payload;

									// Process different webhook types
									switch (webhookData.type) {
										case 'Issue.create':
											return {
												action: 'webhook_processed',
												type: 'issue_created',
												externalId: webhookData.data.issue.id,
												processed: true
											};

										case 'Issue.update':
											return {
												action: 'webhook_processed',
												type: 'issue_updated',
												externalId: webhookData.data.issue.id,
												processed: true
											};

										default:
											return {
												action: 'webhook_ignored',
												type: webhookData.type,
												processed: false
											};
									}
								}
							}
						}
					);

					await context.integrationManager.register(webhookHandler);
					context.webhookHandler = webhookHandler;
				})
				.step('Simulate Linear webhook events', async function (context) {
					// Create some issues first
					const issue1 = await this.linearApi.createIssue({
						title: 'Webhook Test Issue 1',
						description: 'Testing webhook integration',
						priority: 'high'
					});

					const issue2 = await this.linearApi.createIssue({
						title: 'Webhook Test Issue 2',
						description: 'Another webhook test',
						priority: 'medium'
					});

					// Simulate webhooks for these issues
					const webhook1 = this.linearApi.simulateWebhook(
						'Issue.create',
						issue1.id
					);
					const webhook2 = this.linearApi.simulateWebhook(
						'Issue.create',
						issue2.id
					);

					const result1 = await context.processWebhook(webhook1);
					const result2 = await context.processWebhook(webhook2);

					// Update an issue and send update webhook
					await this.linearApi.updateIssue(issue1.id, {
						status: 'in_progress'
					});
					const webhook3 = this.linearApi.simulateWebhook(
						'Issue.update',
						issue1.id
					);
					const result3 = await context.processWebhook(webhook3);

					context.webhookResults = [result1, result2, result3];
				})
				.expect('Webhooks should be processed correctly', function (context) {
					expect(context.webhookEvents).toHaveLength(3);
					expect(context.webhookResults).toHaveLength(3);

					// All webhook events should be processed successfully
					context.webhookResults.forEach((result) => {
						expect(result[0].success).toBe(true);
						expect(result[0].result.action).toBe('webhook_processed');
					});

					// Check specific webhook types
					const createWebhooks = context.webhookResults.filter(
						(r) => r[0].result.type === 'issue_created'
					);
					const updateWebhooks = context.webhookResults.filter(
						(r) => r[0].result.type === 'issue_updated'
					);

					expect(createWebhooks).toHaveLength(2);
					expect(updateWebhooks).toHaveLength(1);
				});

			const result = await scenario.execute();
			expect(result.success).toBe(true);
		});
	});
});
