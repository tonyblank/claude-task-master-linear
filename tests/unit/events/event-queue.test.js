/**
 * @fileoverview Tests for EventQueue
 */

import {
	EventQueue,
	PRIORITY,
	QUEUE_STATE
} from '../../../scripts/modules/events/event-queue.js';

describe('EventQueue', () => {
	let queue;

	beforeEach(() => {
		queue = new EventQueue({
			maxSize: 100,
			maxConcurrency: 2,
			processingInterval: 10,
			batchSize: 3,
			retryAttempts: 2,
			retryDelay: 10,
			processingTimeout: 1000
		});
	});

	afterEach(() => {
		queue.pauseProcessing();
		queue.clear();
	});

	describe('item queuing', () => {
		test('should queue items successfully', async () => {
			const itemId = await queue.push({ data: 'test' });

			expect(typeof itemId).toBe('string');
			expect(itemId).toMatch(/^item_\d+_[a-z0-9]+$/);

			const stats = queue.getStats();
			expect(stats.itemsQueued).toBe(1);
			expect(stats.queueSize).toBe(1);
		});

		test('should queue items with different priorities', async () => {
			await queue.push({ data: 'low' }, { priority: PRIORITY.LOW });
			await queue.push({ data: 'high' }, { priority: PRIORITY.HIGH });
			await queue.push({ data: 'critical' }, { priority: PRIORITY.CRITICAL });

			const items = queue.getNextItems(3);
			expect(items[0].data.data).toBe('critical');
			expect(items[1].data.data).toBe('high');
			expect(items[2].data.data).toBe('low');
		});

		test('should queue batch items', async () => {
			const items = [
				{ data: { value: 1 }, options: { priority: PRIORITY.HIGH } },
				{ data: { value: 2 }, options: { priority: PRIORITY.NORMAL } },
				{ data: { value: 3 }, options: { priority: PRIORITY.LOW } }
			];

			const itemIds = await queue.pushBatch(items);
			expect(itemIds).toHaveLength(3);

			const stats = queue.getStats();
			expect(stats.itemsQueued).toBe(3);
		});

		test('should reject items when queue is full', async () => {
			const smallQueue = new EventQueue({ maxSize: 2 });

			await smallQueue.push({ data: 'item1' });
			await smallQueue.push({ data: 'item2' });

			await expect(smallQueue.push({ data: 'item3' })).rejects.toThrow(
				'Queue is full'
			);

			smallQueue.clear();
		});

		test('should handle custom item options', async () => {
			const itemId = await queue.push(
				{ data: 'test' },
				{
					priority: PRIORITY.HIGH,
					maxRetries: 5,
					timeout: 2000,
					metadata: { source: 'test' },
					guaranteed: true,
					batchable: false
				}
			);

			const items = queue.getNextItems(1);
			expect(items[0].options.priority).toBe(PRIORITY.HIGH);
			expect(items[0].options.maxRetries).toBe(5);
			expect(items[0].options.timeout).toBe(2000);
			expect(items[0].options.metadata.source).toBe('test');
			expect(items[0].options.guaranteed).toBe(true);
			expect(items[0].options.batchable).toBe(false);
		});
	});

	describe('processing control', () => {
		test('should start processing automatically when items are added', async () => {
			const processor = jest.fn().mockResolvedValue('result');
			await queue.push({ data: 'test' }, { processor });

			// Processing should start automatically
			expect(queue.getStats().state).toBe(QUEUE_STATE.PROCESSING);

			// Wait for processing
			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(processor).toHaveBeenCalled();
		});

		test('should pause and resume processing', async () => {
			await queue.push({ data: 'test' });

			queue.pauseProcessing();
			expect(queue.getStats().state).toBe(QUEUE_STATE.PAUSED);

			queue.resumeProcessing();
			expect(queue.getStats().state).toBe(QUEUE_STATE.PROCESSING);
		});

		test('should drain the queue', async () => {
			const processor = jest.fn().mockResolvedValue('result');

			await queue.push({ data: 'test1' }, { processor });
			await queue.push({ data: 'test2' }, { processor });
			await queue.push({ data: 'test3' }, { processor });

			await queue.drain();

			expect(queue.getStats().queueSize).toBe(0);
			expect(queue.getStats().state).toBe(QUEUE_STATE.IDLE);
			expect(processor).toHaveBeenCalledTimes(3);
		});
	});

	describe('item processing', () => {
		test('should process items with custom processors', async () => {
			const processor = jest.fn().mockResolvedValue('custom result');
			await queue.push({ data: 'test' }, { processor });

			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(processor).toHaveBeenCalledWith(
				{ data: 'test' },
				expect.any(Object)
			);
		});

		test('should process items without custom processors', async () => {
			await queue.push({ data: 'test' });

			// Should complete without error (default processing just returns data)
			await new Promise((resolve) => setTimeout(resolve, 50));

			const stats = queue.getStats();
			expect(stats.itemsProcessed).toBe(1);
		});

		test('should respect processing timeout', async () => {
			const slowProcessor = jest
				.fn()
				.mockImplementation(
					() => new Promise((resolve) => setTimeout(resolve, 2000))
				);

			await queue.push(
				{ data: 'test' },
				{
					processor: slowProcessor,
					timeout: 100
				}
			);

			await new Promise((resolve) => setTimeout(resolve, 200));

			const stats = queue.getStats();
			expect(stats.itemsFailed).toBe(1);
		});

		test('should retry failed items', async () => {
			let attempts = 0;
			const retryProcessor = jest.fn().mockImplementation(() => {
				attempts++;
				if (attempts < 3) {
					return Promise.reject(new Error('Temporary failure'));
				}
				return Promise.resolve('success');
			});

			await queue.push(
				{ data: 'test' },
				{
					processor: retryProcessor,
					maxRetries: 3
				}
			);

			await new Promise((resolve) => setTimeout(resolve, 200));

			expect(attempts).toBe(3);
			const stats = queue.getStats();
			expect(stats.itemsProcessed).toBe(1);
			expect(stats.itemsRetried).toBeGreaterThan(0);
		});

		test('should move items to dead letter queue after retry exhaustion', async () => {
			const failingProcessor = jest
				.fn()
				.mockRejectedValue(new Error('Always fails'));

			await queue.push(
				{ data: 'test' },
				{
					processor: failingProcessor,
					maxRetries: 1
				}
			);

			await new Promise((resolve) => setTimeout(resolve, 100));

			const dlqItems = queue.getDeadLetterItems();
			expect(dlqItems).toHaveLength(1);
			expect(dlqItems[0].data.data).toBe('test');

			const stats = queue.getStats();
			expect(stats.deadLetterSize).toBe(1);
		});

		test('should process items in batches when enabled', async () => {
			const batchProcessor = jest.fn().mockResolvedValue('batch result');

			// Add multiple batchable items
			await queue.push({ data: 'item1' }, { processor: batchProcessor });
			await queue.push({ data: 'item2' }, { processor: batchProcessor });
			await queue.push({ data: 'item3' }, { processor: batchProcessor });

			await new Promise((resolve) => setTimeout(resolve, 100));

			const stats = queue.getStats();
			expect(stats.batchesProcessed).toBeGreaterThan(0);
		});

		test('should process non-batchable items individually', async () => {
			const processor = jest.fn().mockResolvedValue('result');

			await queue.push({ data: 'item1' }, { processor, batchable: false });
			await queue.push({ data: 'item2' }, { processor, batchable: false });

			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(processor).toHaveBeenCalledTimes(2);
		});
	});

	describe('event handling', () => {
		test('should emit events during processing', async () => {
			const events = {
				'item:queued': jest.fn(),
				'item:processing': jest.fn(),
				'item:completed': jest.fn(),
				'queue:empty': jest.fn()
			};

			Object.entries(events).forEach(([event, handler]) => {
				queue.on(event, handler);
			});

			const processor = jest.fn().mockResolvedValue('result');
			await queue.push({ data: 'test' }, { processor });

			await queue.drain();

			expect(events['item:queued']).toHaveBeenCalled();
			expect(events['item:processing']).toHaveBeenCalled();
			expect(events['item:completed']).toHaveBeenCalled();
			expect(events['queue:empty']).toHaveBeenCalled();
		});

		test('should emit failure events', async () => {
			const failureHandler = jest.fn();
			queue.on('item:failed', failureHandler);

			const failingProcessor = jest
				.fn()
				.mockRejectedValue(new Error('Test failure'));
			await queue.push(
				{ data: 'test' },
				{
					processor: failingProcessor,
					maxRetries: 0
				}
			);

			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(failureHandler).toHaveBeenCalled();
		});

		test('should remove event listeners', () => {
			const handler = jest.fn();
			queue.on('item:queued', handler);
			queue.off('item:queued', handler);

			queue.push({ data: 'test' });

			expect(handler).not.toHaveBeenCalled();
		});
	});

	describe('dead letter queue', () => {
		test('should retrieve dead letter items', async () => {
			const failingProcessor = jest
				.fn()
				.mockRejectedValue(new Error('Failure'));

			await queue.push(
				{ data: 'test1' },
				{ processor: failingProcessor, maxRetries: 0 }
			);
			await queue.push(
				{ data: 'test2' },
				{ processor: failingProcessor, maxRetries: 0 }
			);

			await new Promise((resolve) => setTimeout(resolve, 100));

			const dlqItems = queue.getDeadLetterItems();
			expect(dlqItems).toHaveLength(2);
		});

		test('should retry items from dead letter queue', async () => {
			const failingProcessor = jest
				.fn()
				.mockRejectedValueOnce(new Error('First failure'))
				.mockResolvedValue('success');

			await queue.push(
				{ data: 'test' },
				{ processor: failingProcessor, maxRetries: 0 }
			);
			await new Promise((resolve) => setTimeout(resolve, 50));

			// Should be in DLQ
			expect(queue.getDeadLetterItems()).toHaveLength(1);

			// Retry DLQ items
			const retriedCount = await queue.retryDeadLetterItems();
			expect(retriedCount).toBe(1);

			await new Promise((resolve) => setTimeout(resolve, 50));

			// Should be processed successfully
			expect(queue.getDeadLetterItems()).toHaveLength(0);
		});

		test('should retry specific items from dead letter queue', async () => {
			const failingProcessor = jest
				.fn()
				.mockRejectedValue(new Error('Failure'));

			const itemId1 = await queue.push(
				{ data: 'test1' },
				{ processor: failingProcessor, maxRetries: 0 }
			);
			const itemId2 = await queue.push(
				{ data: 'test2' },
				{ processor: failingProcessor, maxRetries: 0 }
			);

			await new Promise((resolve) => setTimeout(resolve, 100));

			const dlqItems = queue.getDeadLetterItems();
			const specificItemId = dlqItems[0].id;

			const retriedCount = await queue.retryDeadLetterItems([specificItemId]);
			expect(retriedCount).toBe(1);
		});

		test('should limit dead letter queue size', async () => {
			const smallDLQQueue = new EventQueue({
				deadLetterMaxSize: 2,
				processingInterval: 10
			});

			const failingProcessor = jest
				.fn()
				.mockRejectedValue(new Error('Failure'));

			// Add more items than DLQ limit
			for (let i = 0; i < 5; i++) {
				await smallDLQQueue.push(
					{ data: `test${i}` },
					{
						processor: failingProcessor,
						maxRetries: 0
					}
				);
			}

			await new Promise((resolve) => setTimeout(resolve, 100));

			const dlqItems = smallDLQQueue.getDeadLetterItems();
			expect(dlqItems.length).toBeLessThanOrEqual(2);

			smallDLQQueue.clear();
		});
	});

	describe('statistics and monitoring', () => {
		test('should track comprehensive statistics', async () => {
			const processor = jest.fn().mockResolvedValue('result');

			await queue.push({ data: 'test1' }, { processor });
			await queue.push({ data: 'test2' }, { processor });

			await new Promise((resolve) => setTimeout(resolve, 100));

			const stats = queue.getStats();
			expect(stats.itemsQueued).toBe(2);
			expect(stats.itemsProcessed).toBe(2);
			expect(stats.averageProcessingTime).toBeGreaterThan(0);
		});

		test('should track queue size by priority', async () => {
			await queue.push({ data: 'high' }, { priority: PRIORITY.HIGH });
			await queue.push({ data: 'normal' }, { priority: PRIORITY.NORMAL });
			await queue.push({ data: 'low' }, { priority: PRIORITY.LOW });

			const stats = queue.getStats();
			expect(stats.queueSizeByPriority[PRIORITY.HIGH]).toBe(1);
			expect(stats.queueSizeByPriority[PRIORITY.NORMAL]).toBe(1);
			expect(stats.queueSizeByPriority[PRIORITY.LOW]).toBe(1);
		});
	});

	describe('rate limiting', () => {
		test('should respect rate limits when enabled', async () => {
			const rateLimitedQueue = new EventQueue({
				enableRateLimiting: true,
				rateLimit: 2, // 2 items per second
				processingInterval: 100
			});

			const processor = jest.fn().mockResolvedValue('result');

			// Add more items than rate limit
			for (let i = 0; i < 5; i++) {
				await rateLimitedQueue.push({ data: `test${i}` }, { processor });
			}

			// Should process items at the rate limit
			await new Promise((resolve) => setTimeout(resolve, 500));

			const stats = rateLimitedQueue.getStats();
			expect(stats.itemsProcessed).toBeLessThan(5); // Should be rate limited

			rateLimitedQueue.clear();
		});
	});

	describe('configuration', () => {
		test('should disable batching when configured', async () => {
			const noBatchQueue = new EventQueue({ enableBatching: false });
			const processor = jest.fn().mockResolvedValue('result');

			await noBatchQueue.push({ data: 'test1' }, { processor });
			await noBatchQueue.push({ data: 'test2' }, { processor });

			await new Promise((resolve) => setTimeout(resolve, 100));

			const stats = noBatchQueue.getStats();
			expect(stats.batchesProcessed).toBe(0);

			noBatchQueue.clear();
		});

		test('should disable dead letter queue when configured', async () => {
			const noDLQQueue = new EventQueue({ enableDeadLetterQueue: false });
			const failingProcessor = jest
				.fn()
				.mockRejectedValue(new Error('Failure'));

			await noDLQQueue.push(
				{ data: 'test' },
				{ processor: failingProcessor, maxRetries: 0 }
			);
			await new Promise((resolve) => setTimeout(resolve, 50));

			const dlqItems = noDLQQueue.getDeadLetterItems();
			expect(dlqItems).toHaveLength(0);

			noDLQQueue.clear();
		});
	});

	describe('concurrency control', () => {
		test('should respect maximum concurrency', async () => {
			const slowProcessor = jest
				.fn()
				.mockImplementation(
					() => new Promise((resolve) => setTimeout(resolve, 100))
				);

			// Add more items than max concurrency
			for (let i = 0; i < 5; i++) {
				await queue.push({ data: `test${i}` }, { processor: slowProcessor });
			}

			// Check that active tasks don't exceed max concurrency
			await new Promise((resolve) => setTimeout(resolve, 50));

			const stats = queue.getStats();
			expect(stats.activeTasks).toBeLessThanOrEqual(2); // maxConcurrency from config
		});
	});

	describe('clear functionality', () => {
		test('should clear queue state', async () => {
			await queue.push({ data: 'test1' });
			await queue.push({ data: 'test2' });

			queue.clear();

			const stats = queue.getStats();
			expect(stats.queueSize).toBe(0);
		});

		test('should optionally clear dead letter queue', async () => {
			const failingProcessor = jest
				.fn()
				.mockRejectedValue(new Error('Failure'));
			await queue.push(
				{ data: 'test' },
				{ processor: failingProcessor, maxRetries: 0 }
			);

			await new Promise((resolve) => setTimeout(resolve, 50));

			queue.clear(true); // Include DLQ

			expect(queue.getDeadLetterItems()).toHaveLength(0);
		});
	});
});
