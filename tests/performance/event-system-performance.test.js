/**
 * @fileoverview Performance tests for event system
 *
 * Tests system performance under high load conditions,
 * measuring throughput, latency, and resource usage.
 */

import {
	describe,
	it,
	expect,
	beforeEach,
	afterEach,
	jest
} from '@jest/globals';
import { TestFactories } from '../factories/test-factories.js';
import { MockServiceRegistry } from '../mocks/service-registry.js';
import { EVENT_TYPES } from '../../scripts/modules/events/types.js';
import { createStandardEventPayload } from '../../scripts/modules/events/payload-serializer.js';

describe('Event System Performance Tests', () => {
	let testEnv;

	beforeEach(() => {
		testEnv = TestFactories.createTestEnvironment('performance-test', {
			config: {
				enableErrorBoundaries: true,
				enableCircuitBreakers: true,
				enableHealthMonitoring: false, // Disable for performance testing
				enableAutoRecovery: true,
				enableBatching: true,
				maxConcurrentHandlers: 10,
				batchSize: 50,
				batchTimeout: 100,
				handlerTimeout: 30000,
				eventTimeout: 60000
			}
		});
	});

	afterEach(() => {
		if (testEnv) {
			testEnv.cleanup();
		}
	});

	describe('High Volume Event Processing', () => {
		it('should handle 1000 events efficiently', async () => {
			const { integrationManager } = testEnv;
			const eventCount = 1000;
			const processedEvents = [];

			// Create a fast handler
			const fastHandler = TestFactories.createTestIntegrationHandler(
				'fast-handler',
				{
					eventHandlers: {
						'task:created': async (payload) => {
							processedEvents.push(payload.taskId);
							return { taskId: payload.taskId, timestamp: Date.now() };
						}
					}
				}
			);

			await integrationManager.register(fastHandler);
			await integrationManager.initialize();

			// Generate events
			const events = [];
			for (let i = 1; i <= eventCount; i++) {
				events.push(
					createStandardEventPayload(
						EVENT_TYPES.TASK_CREATED,
						{
							taskId: `task-${i}`,
							task: {
								id: `task-${i}`,
								title: `Performance Task ${i}`,
								description: `Performance test task ${i}`,
								status: 'pending',
								priority: 'medium',
								dependencies: [],
								subtasks: []
							},
							tag: 'performance'
						},
						{
							projectRoot: '/app',
							session: { user: 'perf_user' },
							source: 'cli',
							requestId: `perf-${i}`
						}
					)
				);
			}

			// Measure processing time
			const startTime = Date.now();

			// Process events in batches to avoid overwhelming the system
			const batchSize = 100;
			const promises = [];

			for (let i = 0; i < events.length; i += batchSize) {
				const batch = events.slice(i, i + batchSize);
				const batchPromises = batch.map((event) =>
					integrationManager.handleEvent(EVENT_TYPES.TASK_CREATED, event, {
						projectRoot: '/test/project',
						session: { user: 'testuser' },
						source: 'cli',
						requestId: 'test-req'
					})
				);
				promises.push(...batchPromises);
			}

			const results = await Promise.all(promises);
			const endTime = Date.now();

			const processingTime = endTime - startTime;
			const eventsPerSecond = (eventCount / processingTime) * 1000;

			// Performance assertions
			expect(results).toHaveLength(eventCount);
			expect(processedEvents).toHaveLength(eventCount);
			expect(processingTime).toBeLessThan(30000); // Should complete within 30 seconds
			expect(eventsPerSecond).toBeGreaterThan(50); // Should process at least 50 events/second

			console.log(`Performance Metrics:
				- Events processed: ${eventCount}
				- Processing time: ${processingTime}ms
				- Events per second: ${eventsPerSecond.toFixed(2)}
				- Average latency: ${(processingTime / eventCount).toFixed(2)}ms per event`);

			// Verify all events were processed successfully
			const successfulResults = results.filter((result) => result[0].success);
			expect(successfulResults).toHaveLength(eventCount);
		});

		it('should maintain performance with multiple handlers', async () => {
			const { integrationManager } = testEnv;
			const handlerCount = 5;
			const eventsPerHandler = 200;
			const totalEvents = handlerCount * eventsPerHandler;

			const handlers = [];
			const processedCounts = {};

			// Create multiple handlers
			for (let h = 1; h <= handlerCount; h++) {
				processedCounts[`handler-${h}`] = 0;

				const handler = TestFactories.createTestIntegrationHandler(
					`perf-handler-${h}`,
					{
						eventHandlers: {
							'task:created': async (payload) => {
								processedCounts[`handler-${h}`]++;
								// Simulate minimal processing
								await new Promise((resolve) => setTimeout(resolve, 1));
								return { handler: h, taskId: payload.taskId };
							}
						}
					}
				);

				handlers.push(handler);
				await integrationManager.register(handler);
			}

			await integrationManager.initialize();

			// Generate events
			const events = [];
			for (let i = 1; i <= totalEvents; i++) {
				events.push(
					createStandardEventPayload(
						EVENT_TYPES.TASK_CREATED,
						{
							taskId: `multi-task-${i}`,
							task: {
								id: `multi-task-${i}`,
								title: `Multi Handler Task ${i}`,
								description: 'Multi handler task description',
								details: 'Multi handler task details',
								status: 'pending',
								priority: 'medium',
								dependencies: [],
								subtasks: []
							}
						},
						{ source: 'cli' }
					)
				);
			}

			const startTime = Date.now();

			// Process all events concurrently
			const promises = events.map((event) =>
				integrationManager.handleEvent(EVENT_TYPES.TASK_CREATED, event, {
					projectRoot: '/test/project',
					session: { user: 'testuser' },
					source: 'cli',
					requestId: 'test-req'
				})
			);

			const results = await Promise.all(promises);
			const endTime = Date.now();

			const processingTime = endTime - startTime;
			const totalProcessedEvents = Object.values(processedCounts).reduce(
				(sum, count) => sum + count,
				0
			);

			// Each event should be processed by each handler
			expect(totalProcessedEvents).toBe(totalEvents * handlerCount);
			expect(processingTime).toBeLessThan(60000); // Should complete within 60 seconds

			// Verify each handler processed all events
			Object.values(processedCounts).forEach((count) => {
				expect(count).toBe(totalEvents);
			});

			console.log(`Multi-Handler Performance:
				- Total events: ${totalEvents}
				- Handlers: ${handlerCount}
				- Total processing operations: ${totalProcessedEvents}
				- Processing time: ${processingTime}ms
				- Operations per second: ${((totalProcessedEvents / processingTime) * 1000).toFixed(2)}`);
		});
	});

	describe('Stress Testing', () => {
		it('should handle high concurrency without failures', async () => {
			const stressEnv = TestFactories.createStressTestEnvironment({
				eventCount: 500,
				concurrentHandlers: 8,
				handlerLatency: 10,
				errorRate: 0.02 // 2% error rate
			});

			const { integrationManager, handlers, config } = stressEnv;

			// Register all stress handlers
			stressEnv.registerHandlers();
			await integrationManager.initialize();

			// Generate stress events
			const events = stressEnv.generateEvents();

			const startTime = Date.now();

			// Process events with high concurrency
			const mockContext = {
				projectRoot: '/test/project',
				session: { user: 'testuser' },
				source: 'cli',
				requestId: 'stress-test-req'
			};
			const promises = events.map((event) =>
				integrationManager.handleEvent('task:created', event, mockContext)
			);

			const results = await Promise.all(promises);
			const endTime = Date.now();

			const processingTime = endTime - startTime;
			const totalOperations = results.length * handlers.length;
			const successfulOperations = results
				.flatMap((r) => r)
				.filter((r) => r.success).length;
			const failedOperations = totalOperations - successfulOperations;
			const actualErrorRate = failedOperations / totalOperations;

			// Stress test assertions
			expect(results).toHaveLength(config.eventCount);
			expect(actualErrorRate).toBeLessThanOrEqual(config.errorRate * 2); // Allow some variance
			expect(processingTime).toBeLessThan(120000); // Should complete within 2 minutes

			console.log(`Stress Test Results:
				- Events: ${config.eventCount}
				- Handlers: ${config.concurrentHandlers}
				- Total operations: ${totalOperations}
				- Successful: ${successfulOperations}
				- Failed: ${failedOperations}
				- Error rate: ${(actualErrorRate * 100).toFixed(2)}%
				- Processing time: ${processingTime}ms
				- Throughput: ${((totalOperations / processingTime) * 1000).toFixed(2)} ops/sec`);
		});

		it('should maintain memory efficiency during extended runs', async () => {
			const { integrationManager } = testEnv;

			// Create memory-efficient handlers
			const handleTaskCreated = jest.fn(async (payload) => {
				// Process and immediately release
				const result = { processed: true, timestamp: Date.now() };
				return result;
			});

			const memoryHandler = TestFactories.createTestIntegrationHandler(
				'memory-handler',
				{
					eventHandlers: {
						'task:created': handleTaskCreated
					}
				}
			);

			// Assign the mock function for tracking
			memoryHandler.handleTaskCreated = handleTaskCreated;

			await integrationManager.register(memoryHandler);
			await integrationManager.initialize();

			const batchCount = 10;
			const eventsPerBatch = 100;
			const memorySnapshots = [];

			// Take initial memory snapshot if available
			if (process.memoryUsage) {
				memorySnapshots.push(process.memoryUsage());
			}

			// Process multiple batches sequentially
			for (let batch = 1; batch <= batchCount; batch++) {
				const events = [];
				for (let i = 1; i <= eventsPerBatch; i++) {
					events.push({
						taskId: `memory-task-${batch}-${i}`,
						task: {
							id: `memory-task-${batch}-${i}`,
							title: `Memory Task ${batch}-${i}`,
							description: 'Memory test task description',
							details: 'Memory test task details',
							status: 'pending',
							priority: 'medium',
							dependencies: [],
							subtasks: []
						},
						tag: 'memory-test'
					});
				}

				// Process batch
				const mockContext = {
					projectRoot: '/test/project',
					session: { user: 'testuser' },
					source: 'cli',
					requestId: `memory-test-batch-${batch}`
				};
				const promises = events.map((event) =>
					integrationManager.handleEvent(
						EVENT_TYPES.TASK_CREATED,
						event,
						mockContext
					)
				);

				await Promise.all(promises);

				// Take memory snapshot
				if (process.memoryUsage) {
					memorySnapshots.push(process.memoryUsage());
				}

				// Small delay between batches
				await new Promise((resolve) => setTimeout(resolve, 100));
			}

			// Verify memory didn't grow excessively
			if (memorySnapshots.length > 1) {
				const initialMemory = memorySnapshots[0].heapUsed;
				const finalMemory =
					memorySnapshots[memorySnapshots.length - 1].heapUsed;
				const memoryGrowth = finalMemory - initialMemory;
				const growthMB = memoryGrowth / (1024 * 1024);

				console.log(`Memory Usage:
					- Initial heap: ${(initialMemory / (1024 * 1024)).toFixed(2)} MB
					- Final heap: ${(finalMemory / (1024 * 1024)).toFixed(2)} MB
					- Growth: ${growthMB.toFixed(2)} MB`);

				// Memory growth should be reasonable (less than 50MB for this test)
				expect(growthMB).toBeLessThan(50);
			}

			// Verify all batches were processed
			expect(memoryHandler.handleTaskCreated).toHaveBeenCalledTimes(
				batchCount * eventsPerBatch
			);
		});
	});

	describe('Latency and Throughput Benchmarks', () => {
		it('should meet minimum throughput requirements', async () => {
			const { integrationManager } = testEnv;

			// Create optimized handler
			const optimizedHandler = TestFactories.createTestIntegrationHandler(
				'optimized-handler',
				{
					eventHandlers: {
						'task:created': async (payload) => {
							// Minimal processing for throughput testing
							return { id: payload.taskId, processed: Date.now() };
						}
					}
				}
			);

			await integrationManager.register(optimizedHandler);
			await integrationManager.initialize();

			const testDuration = 10000; // 10 seconds
			const events = [];
			let eventId = 1;

			const startTime = Date.now();
			const promises = [];

			// Generate and process events continuously
			const generateEvents = () => {
				while (Date.now() - startTime < testDuration) {
					const event = createStandardEventPayload(
						EVENT_TYPES.TASK_CREATED,
						{
							taskId: `throughput-${eventId++}`,
							task: {
								id: `throughput-${eventId}`,
								title: `Throughput Task ${eventId}`,
								description: 'Throughput test task description',
								details: 'Throughput test task details',
								status: 'pending',
								priority: 'medium',
								dependencies: [],
								subtasks: []
							}
						},
						{ source: 'cli' }
					);

					events.push(event);
					promises.push(
						integrationManager.handleEvent(EVENT_TYPES.TASK_CREATED, event, {
							projectRoot: '/test/project',
							session: { user: 'testuser' },
							source: 'cli',
							requestId: 'test-req'
						})
					);

					// Small delay to prevent overwhelming
					if (eventId % 50 === 0) {
						break; // Process in batches
					}
				}
			};

			// Process events in batches
			while (Date.now() - startTime < testDuration) {
				generateEvents();
				await Promise.all(promises.splice(0, promises.length));
			}

			const endTime = Date.now();
			const actualDuration = endTime - startTime;
			const throughput = (events.length / actualDuration) * 1000;

			// Minimum throughput requirements
			expect(throughput).toBeGreaterThan(100); // At least 100 events/second
			expect(events.length).toBeGreaterThan(500); // Should process significant volume

			console.log(`Throughput Benchmark:
				- Events processed: ${events.length}
				- Duration: ${actualDuration}ms
				- Throughput: ${throughput.toFixed(2)} events/second`);
		});

		it('should maintain low latency under moderate load', async () => {
			const { integrationManager } = testEnv;

			const latencies = [];
			const latencyHandler = TestFactories.createTestIntegrationHandler(
				'latency-handler',
				{
					eventHandlers: {
						'task:created': async (payload) => {
							const startTime = payload.processingStartTime;
							const endTime = Date.now();
							const latency = endTime - startTime;
							latencies.push(latency);

							return { latency, processed: true };
						}
					}
				}
			);

			await integrationManager.register(latencyHandler);
			await integrationManager.initialize();

			const eventCount = 200;
			const events = [];

			// Generate events with timestamps
			for (let i = 1; i <= eventCount; i++) {
				const event = {
					taskId: `latency-${i}`,
					task: {
						id: `latency-${i}`,
						title: `Latency Task ${i}`,
						description: 'Latency test task description',
						details: 'Latency test task details',
						status: 'pending',
						priority: 'medium',
						dependencies: [],
						subtasks: []
					},
					tag: 'latency-test',
					processingStartTime: Date.now()
				};
				events.push(event);
			}

			// Process events with controlled timing
			const promises = [];
			for (const event of events) {
				event.processingStartTime = Date.now();
				promises.push(
					integrationManager.handleEvent(EVENT_TYPES.TASK_CREATED, event, {
						projectRoot: '/test/project',
						session: { user: 'testuser' },
						source: 'cli',
						requestId: 'test-req'
					})
				);

				// Small delay between events to simulate realistic load
				await new Promise((resolve) => setTimeout(resolve, 10));
			}

			await Promise.all(promises);

			// Calculate latency statistics
			const avgLatency =
				latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
			const maxLatency = Math.max(...latencies);
			const minLatency = Math.min(...latencies);

			// Sort for percentile calculations
			latencies.sort((a, b) => a - b);
			const p95Latency = latencies[Math.floor(latencies.length * 0.95)];
			const p99Latency = latencies[Math.floor(latencies.length * 0.99)];

			console.log(`Latency Statistics:
				- Average: ${avgLatency.toFixed(2)}ms
				- Min: ${minLatency}ms
				- Max: ${maxLatency}ms
				- 95th percentile: ${p95Latency}ms
				- 99th percentile: ${p99Latency}ms`);

			// Latency requirements
			expect(avgLatency).toBeLessThan(100); // Average latency under 100ms
			expect(p95Latency).toBeLessThan(250); // 95% of requests under 250ms
			expect(p99Latency).toBeLessThan(500); // 99% of requests under 500ms
		});
	});
});
