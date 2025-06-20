/**
 * @fileoverview Tests for EventEmitter
 */

import { EventEmitter } from '../../../scripts/modules/events/event-emitter.js';

describe('EventEmitter', () => {
	let emitter;

	beforeEach(() => {
		emitter = new EventEmitter({
			maxListeners: 10,
			deliveryTimeout: 1000,
			retryAttempts: 2,
			retryDelay: 10 // Short delay for testing
		});
	});

	afterEach(() => {
		emitter.clear();
	});

	describe('listener registration', () => {
		test('should register listeners successfully', () => {
			const listener = () => {};
			const listenerId = emitter.on('test:event', listener);

			expect(typeof listenerId).toBe('string');
			expect(listenerId).toMatch(/^test:event_\d+_[a-z0-9]+$/);
		});

		test('should register listeners with options', () => {
			const listener = () => {};
			const listenerId = emitter.on('test:event', listener, {
				priority: 5,
				once: true,
				guaranteed: true
			});

			expect(listenerId).toBeDefined();

			const details = emitter.getListenerDetails();
			expect(details['test:event'][0].priority).toBe(5);
			expect(details['test:event'][0].once).toBe(true);
			expect(details['test:event'][0].guaranteed).toBe(true);
		});

		test('should sort listeners by priority', () => {
			const listener1 = () => {};
			const listener2 = () => {};
			const listener3 = () => {};

			emitter.on('test:event', listener1, { priority: 1 });
			emitter.on('test:event', listener2, { priority: 5 });
			emitter.on('test:event', listener3, { priority: 3 });

			const details = emitter.getListenerDetails();
			const priorities = details['test:event'].map((l) => l.priority);
			expect(priorities).toEqual([5, 3, 1]);
		});

		test('should register one-time listeners', () => {
			const listener = () => {};
			const listenerId = emitter.once('test:event', listener);

			const details = emitter.getListenerDetails();
			expect(details['test:event'][0].once).toBe(true);
		});

		test('should register priority listeners', () => {
			const listener = () => {};
			const listenerId = emitter.onPriority('test:event', listener, 10);

			const details = emitter.getListenerDetails();
			expect(details['test:event'][0].priority).toBe(10);
		});

		test('should register filtered listeners', () => {
			const listener = () => {};
			const filter = (data) => data.value > 5;
			const listenerId = emitter.onFiltered('test:event', listener, filter);

			const details = emitter.getListenerDetails();
			expect(details['test:event'][0].hasFilter).toBe(true);
		});

		test('should register guaranteed listeners', () => {
			const listener = () => {};
			const listenerId = emitter.onGuaranteed('test:event', listener);

			const details = emitter.getListenerDetails();
			expect(details['test:event'][0].guaranteed).toBe(true);
		});

		test('should reject non-function listeners', () => {
			expect(() => {
				emitter.on('test:event', 'not-a-function');
			}).toThrow('Listener must be a function');
		});
	});

	describe('listener removal', () => {
		test('should remove listeners by ID', () => {
			const listener = () => {};
			const listenerId = emitter.on('test:event', listener);

			expect(emitter.off(listenerId)).toBe(true);
			expect(emitter.off(listenerId)).toBe(false); // Already removed
		});

		test('should remove all listeners for event type', () => {
			emitter.on('test:event', () => {});
			emitter.on('test:event', () => {});
			emitter.on('other:event', () => {});

			const removed = emitter.removeAllListeners('test:event');
			expect(removed).toBe(2);

			const details = emitter.getListenerDetails();
			expect(details['test:event']).toBeUndefined();
			expect(details['other:event']).toBeDefined();
		});
	});

	describe('event emission', () => {
		test('should emit events to listeners', async () => {
			const listener = jest.fn().mockResolvedValue('result');
			emitter.on('test:event', listener);

			const result = await emitter.emit('test:event', { data: 'test' });

			expect(listener).toHaveBeenCalledWith(
				{ data: 'test' },
				expect.any(Object)
			);
			expect(result.success).toBe(true);
			expect(result.listenersExecuted).toBe(1);
			expect(result.results).toHaveLength(1);
		});

		test('should handle multiple listeners', async () => {
			const listener1 = jest.fn().mockResolvedValue('result1');
			const listener2 = jest.fn().mockResolvedValue('result2');

			emitter.on('test:event', listener1);
			emitter.on('test:event', listener2);

			const result = await emitter.emit('test:event', { data: 'test' });

			expect(result.listenersExecuted).toBe(2);
			expect(result.results).toHaveLength(2);
		});

		test('should execute listeners by priority order', async () => {
			const executionOrder = [];

			const listener1 = jest.fn().mockImplementation(() => {
				executionOrder.push('low');
				return Promise.resolve();
			});

			const listener2 = jest.fn().mockImplementation(() => {
				executionOrder.push('high');
				return Promise.resolve();
			});

			emitter.on('test:event', listener1, { priority: 1 });
			emitter.on('test:event', listener2, { priority: 5 });

			await emitter.emit('test:event', { data: 'test' }, { parallel: false });

			expect(executionOrder).toEqual(['high', 'low']);
		});

		test('should filter events with listener filters', async () => {
			const listener1 = jest.fn().mockResolvedValue('result1');
			const listener2 = jest.fn().mockResolvedValue('result2');

			emitter.on('test:event', listener1, {
				filter: (data) => data.value > 5
			});
			emitter.on('test:event', listener2); // No filter

			await emitter.emit('test:event', { value: 3 });

			expect(listener1).not.toHaveBeenCalled();
			expect(listener2).toHaveBeenCalled();
		});

		test('should remove one-time listeners after execution', async () => {
			const listener = jest.fn().mockResolvedValue('result');
			emitter.once('test:event', listener);

			await emitter.emit('test:event', { data: 'test' });
			await emitter.emit('test:event', { data: 'test2' });

			expect(listener).toHaveBeenCalledTimes(1);
		});

		test('should handle listener errors', async () => {
			const errorListener = jest
				.fn()
				.mockRejectedValue(new Error('Listener error'));
			const successListener = jest.fn().mockResolvedValue('success');

			emitter.on('test:event', errorListener);
			emitter.on('test:event', successListener);

			const result = await emitter.emit('test:event', { data: 'test' });

			expect(result.success).toBe(false);
			expect(result.failures).toHaveLength(1);
			expect(result.results).toHaveLength(1);
		});

		test('should retry failed listeners', async () => {
			let attempts = 0;
			const retryListener = jest.fn().mockImplementation(() => {
				attempts++;
				if (attempts < 3) {
					return Promise.reject(new Error('Temporary failure'));
				}
				return Promise.resolve('success');
			});

			emitter.on('test:event', retryListener, { retries: 3 });

			const result = await emitter.emit('test:event', { data: 'test' });

			expect(attempts).toBe(3);
			expect(result.success).toBe(true);
		});

		test('should handle timeouts', async () => {
			const slowListener = jest
				.fn()
				.mockImplementation(
					() => new Promise((resolve) => setTimeout(resolve, 2000))
				);

			emitter.on('test:event', slowListener, { timeout: 100 });

			const result = await emitter.emit('test:event', { data: 'test' });

			expect(result.success).toBe(false);
			expect(result.failures[0].error.message).toContain('timeout');
		});

		test('should handle wildcard listeners', async () => {
			const wildcardListener = jest.fn().mockResolvedValue('wildcard');
			emitter.on('*', wildcardListener);

			await emitter.emit('any:event', { data: 'test' });

			expect(wildcardListener).toHaveBeenCalled();
		});

		test('should handle pattern listeners', async () => {
			const patternListener = jest.fn().mockResolvedValue('pattern');
			emitter.on('test:*', patternListener);

			await emitter.emit('test:specific', { data: 'test' });
			await emitter.emit('other:event', { data: 'test' });

			expect(patternListener).toHaveBeenCalledTimes(1);
		});

		test('should validate event payloads when enabled', async () => {
			await expect(
				emitter.emit('test:event', { data: 'test' }, { validatePayload: true })
			).rejects.toThrow('Invalid event payload');
		});

		test('should not validate payloads when disabled', async () => {
			const listener = jest.fn().mockResolvedValue('result');
			emitter.on('test:event', listener);

			const result = await emitter.emit(
				'test:event',
				{ data: 'test' },
				{
					validatePayload: false
				}
			);

			expect(result.success).toBe(true);
		});
	});

	describe('guaranteed delivery', () => {
		test('should track failed guaranteed deliveries', async () => {
			const failingListener = jest
				.fn()
				.mockRejectedValue(new Error('Guaranteed failure'));
			emitter.onGuaranteed('test:event', failingListener);

			await emitter.emit('test:event', { data: 'test' }, { guaranteed: true });

			const stats = emitter.getStats();
			expect(stats.pendingRetries).toBeGreaterThan(0);
		});

		test('should retry failed guaranteed deliveries', async () => {
			let attempts = 0;
			const retryListener = jest.fn().mockImplementation(() => {
				attempts++;
				if (attempts === 1) {
					return Promise.reject(new Error('First attempt fails'));
				}
				return Promise.resolve('success');
			});

			emitter.onGuaranteed('test:event', retryListener);

			// First emission should fail and be tracked
			await emitter.emit('test:event', { data: 'test' }, { guaranteed: true });

			// Retry should succeed
			const retried = await emitter.retryFailedDeliveries();

			expect(retried).toBeGreaterThan(0);
			expect(attempts).toBeGreaterThan(1);
		});
	});

	describe('statistics', () => {
		test('should track basic statistics', async () => {
			const listener = jest.fn().mockResolvedValue('result');
			emitter.on('test:event', listener);

			await emitter.emit('test:event', { data: 'test' });

			const stats = emitter.getStats();
			expect(stats.eventsEmitted).toBe(1);
			expect(stats.listenersExecuted).toBe(1);
			expect(stats.totalListeners).toBe(1);
		});

		test('should track listener execution statistics', async () => {
			const listener = jest.fn().mockResolvedValue('result');
			emitter.on('test:event', listener);

			await emitter.emit('test:event', { data: 'test' });

			const details = emitter.getListenerDetails();
			const listenerStats = details['test:event'][0].stats;

			expect(listenerStats.invocations).toBe(1);
			expect(listenerStats.failures).toBe(0);
			expect(listenerStats.totalExecutionTime).toBeGreaterThan(0);
		});
	});

	describe('configuration', () => {
		test('should respect max listeners limit', () => {
			const emitter = new EventEmitter({ maxListeners: 2 });
			const originalWarn = console.log;
			console.log = jest.fn();

			emitter.on('test:event', () => {});
			emitter.on('test:event', () => {});
			emitter.on('test:event', () => {}); // Should trigger warning

			expect(console.log).toHaveBeenCalledWith(
				expect.stringContaining('[WARN]'),
				expect.stringContaining('Maximum listeners')
			);

			console.log = originalWarn;
		});

		test('should disable priorities when configured', () => {
			const emitter = new EventEmitter({ enablePriorities: false });

			emitter.on('test:event', () => {}, { priority: 5 });
			emitter.on('test:event', () => {}, { priority: 1 });

			const details = emitter.getListenerDetails();
			// Should maintain registration order, not priority order
			expect(details['test:event'][0].priority).toBe(5);
			expect(details['test:event'][1].priority).toBe(1);
		});
	});

	describe('clear functionality', () => {
		test('should clear all listeners and state', () => {
			emitter.on('test:event', () => {});
			emitter.on('other:event', () => {});

			emitter.clear();

			const stats = emitter.getStats();
			expect(stats.totalListeners).toBe(0);
			expect(stats.eventTypes).toBe(0);
		});
	});
});
