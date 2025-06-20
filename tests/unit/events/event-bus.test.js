/**
 * @fileoverview Tests for EventBus
 */

import { EventBus } from '../../../scripts/modules/events/event-bus.js';

describe('EventBus', () => {
	let eventBus;

	beforeEach(() => {
		eventBus = new EventBus({
			messageRetention: 5,
			maxSubscribers: 10
		});
	});

	afterEach(() => {
		eventBus.clear();
	});

	describe('topic management', () => {
		test('should create topics automatically on publish', async () => {
			await eventBus.publish('test.topic', { data: 'test' });

			const info = eventBus.getDetailedInfo();
			expect(info.topics['test.topic']).toBeDefined();
			expect(info.topics['test.topic'].channel).toBe('default');
		});

		test('should validate topic names', async () => {
			await expect(eventBus.publish('', { data: 'test' })).rejects.toThrow(
				'Invalid topic format'
			);

			await expect(
				eventBus.publish('invalid topic!', { data: 'test' })
			).rejects.toThrow('Invalid topic format');
		});

		test('should allow valid topic names', async () => {
			const validTopics = [
				'simple',
				'dotted.topic',
				'dashed-topic',
				'under_scored',
				'with:colons',
				'wildcard.*',
				'mixed.topic-name_with:colons'
			];

			for (const topic of validTopics) {
				await expect(
					eventBus.publish(topic, { data: 'test' })
				).resolves.not.toThrow();
			}
		});
	});

	describe('channel management', () => {
		test('should create channels', () => {
			eventBus.createChannel('test-channel');

			const info = eventBus.getDetailedInfo();
			expect(info.channels['test-channel']).toBeDefined();
		});

		test('should delete channels and their topics', async () => {
			eventBus.createChannel('test-channel');
			await eventBus.publish(
				'test.topic',
				{ data: 'test' },
				{
					channel: 'test-channel'
				}
			);

			expect(eventBus.deleteChannel('test-channel')).toBe(true);

			const info = eventBus.getDetailedInfo();
			expect(info.channels['test-channel']).toBeUndefined();
			expect(info.topics['test.topic']).toBeUndefined();
		});

		test('should handle deleting non-existent channels', () => {
			expect(eventBus.deleteChannel('non-existent')).toBe(false);
		});
	});

	describe('publishing', () => {
		test('should publish messages successfully', async () => {
			const result = await eventBus.publish('test.topic', {
				value: 42,
				text: 'hello'
			});

			expect(result.success).toBe(true);
			expect(result.messageId).toBeDefined();
			expect(result.topic).toBe('test.topic');
			expect(result.channel).toBe('default');
		});

		test('should publish to specific channels', async () => {
			eventBus.createChannel('custom');

			const result = await eventBus.publish(
				'test.topic',
				{ data: 'test' },
				{
					channel: 'custom'
				}
			);

			expect(result.channel).toBe('custom');
		});

		test('should include metadata in messages', async () => {
			await eventBus.publish(
				'test.topic',
				{ data: 'test' },
				{
					priority: 5,
					metadata: { source: 'unit-test' }
				}
			);

			const history = eventBus.getMessageHistory('test.topic');
			expect(history).toHaveLength(1);
			expect(history[0].metadata.priority).toBe(5);
			expect(history[0].metadata.source).toBe('unit-test');
			expect(history[0].metadata.publishedAt).toBeDefined();
		});

		test('should handle guaranteed delivery', async () => {
			const subscriber = jest
				.fn()
				.mockRejectedValue(new Error('Subscriber failed'));
			eventBus.subscribe('test.topic', subscriber);

			const result = await eventBus.publish(
				'test.topic',
				{ data: 'test' },
				{
					guaranteed: true
				}
			);

			expect(result.success).toBe(false);
			expect(result.failures).toHaveLength(1);
		});
	});

	describe('subscribing', () => {
		test('should subscribe to topics', () => {
			const subscriber = jest.fn();
			const subscriptionId = eventBus.subscribe('test.topic', subscriber);

			expect(typeof subscriptionId).toBe('string');
			expect(subscriptionId).toMatch(/^sub_\d+_[a-z0-9]+$/);
		});

		test('should validate subscriber functions', () => {
			expect(() => {
				eventBus.subscribe('test.topic', 'not-a-function');
			}).toThrow('Subscriber must be a function');
		});

		test('should receive published messages', async () => {
			const subscriber = jest.fn();
			eventBus.subscribe('test.topic', subscriber);

			await eventBus.publish('test.topic', { value: 42 });

			expect(subscriber).toHaveBeenCalledWith(
				{ value: 42 },
				expect.objectContaining({
					messageId: expect.any(String),
					topic: 'test.topic',
					channel: 'default'
				})
			);
		});

		test('should handle multiple subscribers', async () => {
			const subscriber1 = jest.fn();
			const subscriber2 = jest.fn();

			eventBus.subscribe('test.topic', subscriber1);
			eventBus.subscribe('test.topic', subscriber2);

			await eventBus.publish('test.topic', { data: 'test' });

			expect(subscriber1).toHaveBeenCalled();
			expect(subscriber2).toHaveBeenCalled();
		});

		test('should filter messages with subscriber filters', async () => {
			const subscriber1 = jest.fn();
			const subscriber2 = jest.fn();

			eventBus.subscribe('test.topic', subscriber1, {
				filter: (data, metadata) => data.value > 5
			});
			eventBus.subscribe('test.topic', subscriber2); // No filter

			await eventBus.publish('test.topic', { value: 3 });

			expect(subscriber1).not.toHaveBeenCalled();
			expect(subscriber2).toHaveBeenCalled();
		});

		test('should handle one-time subscriptions', async () => {
			const subscriber = jest.fn();
			eventBus.subscribe('test.topic', subscriber, { once: true });

			await eventBus.publish('test.topic', { data: 'test1' });
			await eventBus.publish('test.topic', { data: 'test2' });

			expect(subscriber).toHaveBeenCalledTimes(1);
		});

		test('should subscribe to specific channels', async () => {
			eventBus.createChannel('specific');

			const subscriber = jest.fn();
			eventBus.subscribe('test.topic', subscriber, {
				channel: 'specific'
			});

			// Should receive message on specific channel
			await eventBus.publish(
				'test.topic',
				{ data: 'test' },
				{
					channel: 'specific'
				}
			);
			expect(subscriber).toHaveBeenCalledTimes(1);

			// Should not receive message on default channel
			await eventBus.publish('test.topic', { data: 'test' });
			expect(subscriber).toHaveBeenCalledTimes(1);
		});

		test('should replay message history for new subscribers', async () => {
			// Publish some messages first
			await eventBus.publish('test.topic', { data: 'msg1' });
			await eventBus.publish('test.topic', { data: 'msg2' });
			await eventBus.publish('test.topic', { data: 'msg3' });

			// Subscribe with replay
			const subscriber = jest.fn();
			eventBus.subscribe('test.topic', subscriber, {
				replay: true,
				replayCount: 2
			});

			// Should receive replayed messages
			await new Promise((resolve) => setTimeout(resolve, 50)); // Wait for async replay

			expect(subscriber).toHaveBeenCalledTimes(2);
		});

		test('should handle subscriber priorities', async () => {
			const executionOrder = [];

			const subscriber1 = jest.fn().mockImplementation(() => {
				executionOrder.push('low');
			});

			const subscriber2 = jest.fn().mockImplementation(() => {
				executionOrder.push('high');
			});

			eventBus.subscribe('test.topic', subscriber1, { priority: 1 });
			eventBus.subscribe('test.topic', subscriber2, { priority: 5 });

			await eventBus.publish('test.topic', { data: 'test' });

			expect(executionOrder).toEqual(['high', 'low']);
		});
	});

	describe('unsubscribing', () => {
		test('should unsubscribe successfully', () => {
			const subscriber = jest.fn();
			const subscriptionId = eventBus.subscribe('test.topic', subscriber);

			expect(eventBus.unsubscribe(subscriptionId)).toBe(true);
			expect(eventBus.unsubscribe(subscriptionId)).toBe(false); // Already removed
		});

		test('should not receive messages after unsubscribing', async () => {
			const subscriber = jest.fn();
			const subscriptionId = eventBus.subscribe('test.topic', subscriber);

			eventBus.unsubscribe(subscriptionId);
			await eventBus.publish('test.topic', { data: 'test' });

			expect(subscriber).not.toHaveBeenCalled();
		});
	});

	describe('message history', () => {
		test('should store message history', async () => {
			await eventBus.publish('test.topic', { data: 'msg1' });
			await eventBus.publish('test.topic', { data: 'msg2' });

			const history = eventBus.getMessageHistory('test.topic');
			expect(history).toHaveLength(2);
			expect(history[0].data).toEqual({ data: 'msg1' });
			expect(history[1].data).toEqual({ data: 'msg2' });
		});

		test('should limit message history size', async () => {
			// Publish more messages than retention limit
			for (let i = 1; i <= 10; i++) {
				await eventBus.publish('test.topic', { data: `msg${i}` });
			}

			const history = eventBus.getMessageHistory('test.topic');
			expect(history).toHaveLength(5); // Retention limit from config

			// Should keep the most recent messages
			expect(history[0].data).toEqual({ data: 'msg6' });
			expect(history[4].data).toEqual({ data: 'msg10' });
		});

		test('should filter history by time range', async () => {
			const baseTime = Date.now();

			await eventBus.publish('test.topic', { data: 'old' });

			// Wait a bit for time difference
			await new Promise((resolve) => setTimeout(resolve, 10));
			const midTime = new Date().toISOString();

			await eventBus.publish('test.topic', { data: 'new' });

			const recentHistory = eventBus.getMessageHistory('test.topic', {
				since: midTime
			});

			expect(recentHistory).toHaveLength(1);
			expect(recentHistory[0].data).toEqual({ data: 'new' });
		});

		test('should handle pagination', async () => {
			for (let i = 1; i <= 5; i++) {
				await eventBus.publish('test.topic', { data: `msg${i}` });
			}

			const page1 = eventBus.getMessageHistory('test.topic', {
				limit: 2,
				offset: 0
			});
			expect(page1).toHaveLength(2);

			const page2 = eventBus.getMessageHistory('test.topic', {
				limit: 2,
				offset: 2
			});
			expect(page2).toHaveLength(2);
			expect(page2[0].data).not.toEqual(page1[0].data);
		});
	});

	describe('routing rules', () => {
		test('should add and execute routing rules', async () => {
			const ruleExecuted = jest.fn();

			eventBus.addRoutingRule(
				'test-rule',
				(message) => message.data.shouldRoute === true,
				async (message) => {
					ruleExecuted(message.data);
				}
			);

			await eventBus.publish('test.topic', { shouldRoute: true, data: 'test' });
			await eventBus.publish('test.topic', {
				shouldRoute: false,
				data: 'test'
			});

			expect(ruleExecuted).toHaveBeenCalledTimes(1);
			expect(ruleExecuted).toHaveBeenCalledWith({
				shouldRoute: true,
				data: 'test'
			});
		});

		test('should remove routing rules', async () => {
			const ruleExecuted = jest.fn();

			eventBus.addRoutingRule(
				'test-rule',
				() => true,
				async () => ruleExecuted()
			);

			expect(eventBus.removeRoutingRule('test-rule')).toBe(true);
			expect(eventBus.removeRoutingRule('test-rule')).toBe(false);

			await eventBus.publish('test.topic', { data: 'test' });
			expect(ruleExecuted).not.toHaveBeenCalled();
		});

		test('should handle routing rule errors gracefully', async () => {
			const originalError = console.log;
			console.log = jest.fn();

			eventBus.addRoutingRule(
				'failing-rule',
				() => true,
				async () => {
					throw new Error('Rule failed');
				}
			);

			await eventBus.publish('test.topic', { data: 'test' });

			expect(console.log).toHaveBeenCalledWith(
				expect.stringContaining('[ERROR]'),
				expect.stringContaining('Routing rule failing-rule failed')
			);

			console.log = originalError;
		});

		test('should validate routing rule functions', () => {
			expect(() => {
				eventBus.addRoutingRule('invalid', 'not-function', () => {});
			}).toThrow('Condition and action must be functions');

			expect(() => {
				eventBus.addRoutingRule('invalid', () => {}, 'not-function');
			}).toThrow('Condition and action must be functions');
		});
	});

	describe('statistics', () => {
		test('should track basic statistics', async () => {
			const subscriber = jest.fn();
			eventBus.subscribe('test.topic', subscriber);

			await eventBus.publish('test.topic', { data: 'test' });

			const stats = eventBus.getStats();
			expect(stats.messagesPublished).toBe(1);
			expect(stats.messagesDelivered).toBe(1);
			expect(stats.activeSubscriptions).toBe(1);
			expect(stats.topics).toBe(1);
			expect(stats.channels).toBe(1);
		});

		test('should provide detailed information', async () => {
			const subscriber = jest.fn();
			eventBus.subscribe('test.topic', subscriber);
			await eventBus.publish('test.topic', { data: 'test' });

			const info = eventBus.getDetailedInfo();
			expect(info.topics['test.topic'].subscriberCount).toBe(1);
			expect(info.topics['test.topic'].messageCount).toBe(1);
			expect(info.subscriptions).toHaveLength(1);
		});
	});

	describe('wildcard and pattern matching', () => {
		test('should handle wildcard subscriptions', async () => {
			const subscriber = jest.fn();
			eventBus.subscribe('*', subscriber);

			await eventBus.publish('any.topic', { data: 'test' });
			await eventBus.publish('another.topic', { data: 'test' });

			expect(subscriber).toHaveBeenCalledTimes(2);
		});

		test('should handle pattern subscriptions', async () => {
			const subscriber = jest.fn();
			eventBus.subscribe('test.*', subscriber);

			await eventBus.publish('test.specific', { data: 'test' });
			await eventBus.publish('test.another', { data: 'test' });
			await eventBus.publish('other.topic', { data: 'test' });

			expect(subscriber).toHaveBeenCalledTimes(2);
		});
	});

	describe('error handling', () => {
		test('should handle subscriber errors gracefully', async () => {
			const failingSubscriber = jest
				.fn()
				.mockRejectedValue(new Error('Subscriber error'));
			const workingSubscriber = jest.fn().mockResolvedValue('success');

			eventBus.subscribe('test.topic', failingSubscriber);
			eventBus.subscribe('test.topic', workingSubscriber);

			const result = await eventBus.publish('test.topic', { data: 'test' });

			expect(result.success).toBe(false);
			expect(result.failures).toHaveLength(1);
			expect(workingSubscriber).toHaveBeenCalled();
		});

		test('should track subscriber error statistics', async () => {
			const failingSubscriber = jest.fn().mockRejectedValue(new Error('Error'));
			const subscriptionId = eventBus.subscribe(
				'test.topic',
				failingSubscriber
			);

			await eventBus.publish('test.topic', { data: 'test' });

			const info = eventBus.getDetailedInfo();
			const subscription = info.subscriptions.find(
				(sub) => sub.id === subscriptionId
			);
			expect(subscription.stats.errors).toBe(1);
		});
	});

	describe('configuration', () => {
		test('should disable message history when configured', () => {
			const busWithoutHistory = new EventBus({ enableMessageHistory: false });

			busWithoutHistory.publish('test.topic', { data: 'test' });

			const history = busWithoutHistory.getMessageHistory('test.topic');
			expect(history).toHaveLength(0);

			busWithoutHistory.clear();
		});

		test('should disable routing when configured', async () => {
			const busWithoutRouting = new EventBus({ enableMessageRouting: false });

			expect(() => {
				busWithoutRouting.addRoutingRule(
					'test',
					() => true,
					() => {}
				);
			}).toThrow('Message routing is disabled');

			busWithoutRouting.clear();
		});
	});

	describe('clear functionality', () => {
		test('should clear all state', async () => {
			const subscriber = jest.fn();
			eventBus.subscribe('test.topic', subscriber);
			await eventBus.publish('test.topic', { data: 'test' });

			eventBus.clear();

			const stats = eventBus.getStats();
			expect(stats.topics).toBe(1); // Default channel recreated
			expect(stats.activeSubscriptions).toBe(0);

			const info = eventBus.getDetailedInfo();
			expect(Object.keys(info.topics)).toHaveLength(0);
		});
	});
});
