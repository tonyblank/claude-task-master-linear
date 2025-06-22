/**
 * @fileoverview Event Bus - Centralized pub/sub system
 *
 * This module provides a centralized event bus for publish/subscribe patterns
 * with advanced features like topics, channels, and message routing.
 */

import { log } from '../utils.js';
import { EventEmitter } from './event-emitter.js';
import { validateEventPayload, createEventPayload } from './types.js';

/**
 * Centralized event bus for publish/subscribe messaging
 */
export class EventBus {
	/**
	 * @param {Object} config - Configuration options
	 */
	constructor(config = {}) {
		this.config = {
			enableTopics: true,
			enableChannels: true,
			enableMessageRouting: true,
			enableSubscriptionFilters: true,
			defaultChannel: 'default',
			maxSubscribers: 1000,
			messageRetention: 1000, // Keep last N messages per topic
			enableMessageHistory: true,
			deliveryGuarantees: true,
			...config
		};

		// Core event emitter
		this.emitter = new EventEmitter({
			enableDeliveryGuarantees: this.config.deliveryGuarantees,
			maxListeners: this.config.maxSubscribers
		});

		// Topic-based organization
		this.topics = new Map(); // topic -> { subscribers, messageHistory, metadata }

		// Channel-based organization
		this.channels = new Map(); // channel -> { topics, subscribers, metadata }

		// Subscription registry
		this.subscriptions = new Map(); // subscriptionId -> { topic, channel, subscriber, options }

		// Message routing rules
		this.routingRules = new Map(); // rule -> { condition, action }

		// Statistics
		this.stats = {
			messagesPublished: 0,
			messagesDelivered: 0,
			activeSubscriptions: 0,
			topicsCreated: 0,
			channelsCreated: 0,
			routingRulesApplied: 0
		};

		// Initialize default channel
		this._createChannel(this.config.defaultChannel);
	}

	/**
	 * Publish a message to a topic
	 *
	 * @param {string} topic - Topic to publish to
	 * @param {any} message - Message data
	 * @param {Object} options - Publishing options
	 * @returns {Promise<Object>} Publishing results
	 */
	async publish(topic, message, options = {}) {
		const publishOptions = {
			channel: this.config.defaultChannel,
			priority: 0,
			ttl: null, // Time to live in milliseconds
			guaranteed: false,
			metadata: {},
			routing: true, // Apply routing rules
			...options
		};

		// Validate topic format
		if (!this._isValidTopic(topic)) {
			throw new Error(`Invalid topic format: ${topic}`);
		}

		// Create topic if it doesn't exist
		if (!this.topics.has(topic)) {
			this._createTopic(topic, publishOptions.channel);
		}

		// Create message object
		const messageObj = {
			id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
			topic,
			channel: publishOptions.channel,
			data: message,
			metadata: {
				...publishOptions.metadata,
				publishedAt: new Date().toISOString(),
				priority: publishOptions.priority,
				ttl: publishOptions.ttl,
				publisher: publishOptions.publisher || 'anonymous'
			}
		};

		this.stats.messagesPublished++;

		// Store message in history
		if (this.config.enableMessageHistory) {
			this._storeMessage(topic, messageObj);
		}

		// Apply routing rules
		if (publishOptions.routing && this.config.enableMessageRouting) {
			await this._applyRoutingRules(messageObj);
		}

		// Publish to event emitter
		const fullEventType = this._getFullEventType(topic, publishOptions.channel);

		const result = await this.emitter.emit(fullEventType, messageObj, {
			guaranteed: publishOptions.guaranteed,
			validatePayload: false // We handle validation here
		});

		log(
			'debug',
			`Message published to topic ${topic} on channel ${publishOptions.channel}`
		);

		return {
			messageId: messageObj.id,
			topic,
			channel: publishOptions.channel,
			subscribersNotified: result.listenersExecuted,
			success: result.success,
			failures: result.failures
		};
	}

	/**
	 * Subscribe to a topic
	 *
	 * @param {string} topic - Topic to subscribe to
	 * @param {Function} subscriber - Subscriber function
	 * @param {Object} options - Subscription options
	 * @returns {string} Subscription ID
	 */
	subscribe(topic, subscriber, options = {}) {
		const subscriptionOptions = {
			channel: this.config.defaultChannel,
			priority: 0,
			filter: null, // Message filter function
			once: false, // One-time subscription
			replay: false, // Replay message history
			replayCount: 10, // Number of historical messages to replay
			guaranteed: false,
			metadata: {},
			...options
		};

		// Validate inputs
		if (!this._isValidTopic(topic)) {
			throw new Error(`Invalid topic format: ${topic}`);
		}

		if (typeof subscriber !== 'function') {
			throw new Error('Subscriber must be a function');
		}

		// Create topic if it doesn't exist
		if (!this.topics.has(topic)) {
			this._createTopic(topic, subscriptionOptions.channel);
		}

		// Create subscription
		const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

		const subscription = {
			id: subscriptionId,
			topic,
			channel: subscriptionOptions.channel,
			subscriber,
			options: subscriptionOptions,
			stats: {
				messagesReceived: 0,
				lastMessageAt: null,
				errors: 0
			}
		};

		// Store subscription
		this.subscriptions.set(subscriptionId, subscription);

		// Register with event emitter
		const fullEventType = this._getFullEventType(
			topic,
			subscriptionOptions.channel
		);

		const wrappedSubscriber = async (messageObj, context) => {
			return this._executeSubscriber(subscription, messageObj, context);
		};

		const emitterOptions = {
			priority: subscriptionOptions.priority,
			filter: subscriptionOptions.filter
				? (messageObj) =>
						subscriptionOptions.filter(messageObj.data, messageObj.metadata)
				: null,
			once: subscriptionOptions.once,
			guaranteed: subscriptionOptions.guaranteed
		};

		// Only pass retries if it's explicitly set
		if (subscriptionOptions.retries !== undefined) {
			emitterOptions.retries = subscriptionOptions.retries;
		}

		const listenerId = this.emitter.on(
			fullEventType,
			wrappedSubscriber,
			emitterOptions
		);

		subscription.listenerId = listenerId;

		// Update topic subscriber count
		const topicInfo = this.topics.get(topic);
		topicInfo.subscriberCount++;

		this.stats.activeSubscriptions++;

		log(
			'debug',
			`Subscription ${subscriptionId} created for topic ${topic} on channel ${subscriptionOptions.channel}`
		);

		// Replay message history if requested
		if (subscriptionOptions.replay && this.config.enableMessageHistory) {
			this._replayMessages(subscription);
		}

		return subscriptionId;
	}

	/**
	 * Unsubscribe from a topic
	 *
	 * @param {string} subscriptionId - Subscription ID to remove
	 * @returns {boolean} True if subscription was removed
	 */
	unsubscribe(subscriptionId) {
		const subscription = this.subscriptions.get(subscriptionId);

		if (!subscription) {
			return false;
		}

		// Remove from event emitter
		this.emitter.off(subscription.listenerId);

		// Update topic subscriber count
		const topicInfo = this.topics.get(subscription.topic);
		if (topicInfo) {
			topicInfo.subscriberCount--;
		}

		// Remove subscription
		this.subscriptions.delete(subscriptionId);
		this.stats.activeSubscriptions--;

		log('debug', `Subscription ${subscriptionId} removed`);
		return true;
	}

	/**
	 * Create a new channel
	 *
	 * @param {string} channelName - Channel name
	 * @param {Object} options - Channel options
	 * @returns {void}
	 */
	createChannel(channelName, options = {}) {
		if (this.channels.has(channelName)) {
			log('warn', `Channel ${channelName} already exists`);
			return;
		}

		this._createChannel(channelName, options);
	}

	/**
	 * Delete a channel and all its topics
	 *
	 * @param {string} channelName - Channel name
	 * @returns {boolean} True if channel was deleted
	 */
	deleteChannel(channelName) {
		if (!this.channels.has(channelName)) {
			return false;
		}

		const channel = this.channels.get(channelName);

		// Remove all topics in this channel
		for (const topic of channel.topics) {
			this._deleteTopic(topic);
		}

		// Remove channel
		this.channels.delete(channelName);

		log('debug', `Channel ${channelName} deleted`);
		return true;
	}

	/**
	 * Add a message routing rule
	 *
	 * @param {string} ruleName - Rule name
	 * @param {Function} condition - Condition function
	 * @param {Function} action - Action function
	 * @returns {void}
	 */
	addRoutingRule(ruleName, condition, action) {
		if (!this.config.enableMessageRouting) {
			throw new Error('Message routing is disabled');
		}

		if (typeof condition !== 'function' || typeof action !== 'function') {
			throw new Error('Condition and action must be functions');
		}

		this.routingRules.set(ruleName, { condition, action });
		log('debug', `Routing rule ${ruleName} added`);
	}

	/**
	 * Remove a routing rule
	 *
	 * @param {string} ruleName - Rule name
	 * @returns {boolean} True if rule was removed
	 */
	removeRoutingRule(ruleName) {
		const removed = this.routingRules.delete(ruleName);
		if (removed) {
			log('debug', `Routing rule ${ruleName} removed`);
		}
		return removed;
	}

	/**
	 * Get message history for a topic
	 *
	 * @param {string} topic - Topic name
	 * @param {Object} options - Query options
	 * @returns {Array} Message history
	 */
	getMessageHistory(topic, options = {}) {
		if (!this.config.enableMessageHistory) {
			return [];
		}

		const topicInfo = this.topics.get(topic);
		if (!topicInfo || !topicInfo.messageHistory) {
			return [];
		}

		const queryOptions = {
			limit: 50,
			offset: 0,
			since: null, // ISO timestamp
			until: null, // ISO timestamp
			...options
		};

		let messages = [...topicInfo.messageHistory];

		// Filter by time range
		if (queryOptions.since) {
			const sinceTime = new Date(queryOptions.since).getTime();
			messages = messages.filter(
				(msg) => new Date(msg.metadata.publishedAt).getTime() >= sinceTime
			);
		}

		if (queryOptions.until) {
			const untilTime = new Date(queryOptions.until).getTime();
			messages = messages.filter(
				(msg) => new Date(msg.metadata.publishedAt).getTime() <= untilTime
			);
		}

		// Apply pagination
		const start = queryOptions.offset;
		const end = start + queryOptions.limit;

		return messages.slice(start, end);
	}

	/**
	 * Get statistics about the event bus
	 *
	 * @returns {Object} Statistics object
	 */
	getStats() {
		return {
			...this.stats,
			topics: this.topics.size,
			channels: this.channels.size,
			routingRules: this.routingRules.size,
			emitterStats: this.emitter.getStats()
		};
	}

	/**
	 * Get detailed information about topics and channels
	 *
	 * @returns {Object} Detailed information
	 */
	getDetailedInfo() {
		const topicsInfo = {};
		for (const [topic, info] of this.topics.entries()) {
			topicsInfo[topic] = {
				channel: info.channel,
				subscriberCount: info.subscriberCount,
				messageCount: info.messageHistory ? info.messageHistory.length : 0,
				createdAt: info.createdAt
			};
		}

		const channelsInfo = {};
		for (const [channel, info] of this.channels.entries()) {
			channelsInfo[channel] = {
				topics: Array.from(info.topics),
				subscriberCount: info.subscriberCount,
				createdAt: info.createdAt
			};
		}

		return {
			topics: topicsInfo,
			channels: channelsInfo,
			routingRules: Array.from(this.routingRules.keys()),
			subscriptions: Array.from(this.subscriptions.values()).map((sub) => ({
				id: sub.id,
				topic: sub.topic,
				channel: sub.channel,
				stats: sub.stats
			}))
		};
	}

	/**
	 * Create a topic
	 *
	 * @param {string} topic - Topic name
	 * @param {string} channel - Channel name
	 * @private
	 */
	_createTopic(topic, channel) {
		if (this.topics.has(topic)) {
			return;
		}

		const topicInfo = {
			channel,
			subscriberCount: 0,
			messageHistory: this.config.enableMessageHistory ? [] : null,
			createdAt: new Date().toISOString()
		};

		this.topics.set(topic, topicInfo);

		// Add to channel
		const channelInfo = this.channels.get(channel);
		if (channelInfo) {
			channelInfo.topics.add(topic);
		}

		this.stats.topicsCreated++;
		log('debug', `Topic ${topic} created on channel ${channel}`);
	}

	/**
	 * Delete a topic
	 *
	 * @param {string} topic - Topic name
	 * @private
	 */
	_deleteTopic(topic) {
		const topicInfo = this.topics.get(topic);
		if (!topicInfo) {
			return;
		}

		// Remove from channel
		const channelInfo = this.channels.get(topicInfo.channel);
		if (channelInfo) {
			channelInfo.topics.delete(topic);
		}

		// Remove all subscriptions for this topic
		for (const [subId, subscription] of this.subscriptions.entries()) {
			if (subscription.topic === topic) {
				this.unsubscribe(subId);
			}
		}

		this.topics.delete(topic);
		log('debug', `Topic ${topic} deleted`);
	}

	/**
	 * Create a channel
	 *
	 * @param {string} channelName - Channel name
	 * @param {Object} options - Channel options
	 * @private
	 */
	_createChannel(channelName, options = {}) {
		const channelInfo = {
			topics: new Set(),
			subscriberCount: 0,
			createdAt: new Date().toISOString(),
			metadata: options.metadata || {}
		};

		this.channels.set(channelName, channelInfo);
		this.stats.channelsCreated++;

		log('debug', `Channel ${channelName} created`);
	}

	/**
	 * Get full event type including channel
	 *
	 * @param {string} topic - Topic name
	 * @param {string} channel - Channel name
	 * @returns {string} Full event type
	 * @private
	 */
	_getFullEventType(topic, channel) {
		return this.config.enableChannels ? `${channel}:${topic}` : topic;
	}

	/**
	 * Validate topic format
	 *
	 * @param {string} topic - Topic name
	 * @returns {boolean} True if valid
	 * @private
	 */
	_isValidTopic(topic) {
		if (typeof topic !== 'string' || topic.length === 0) {
			return false;
		}

		// Allow alphanumeric, dots, dashes, underscores, colons, and wildcards
		return /^[a-zA-Z0-9._\-:*]+$/.test(topic);
	}

	/**
	 * Store message in topic history
	 *
	 * @param {string} topic - Topic name
	 * @param {Object} messageObj - Message object
	 * @private
	 */
	_storeMessage(topic, messageObj) {
		const topicInfo = this.topics.get(topic);
		if (!topicInfo || !topicInfo.messageHistory) {
			return;
		}

		topicInfo.messageHistory.push(messageObj);

		// Trim history if it exceeds retention limit
		if (topicInfo.messageHistory.length > this.config.messageRetention) {
			topicInfo.messageHistory.shift();
		}
	}

	/**
	 * Apply routing rules to a message
	 *
	 * @param {Object} messageObj - Message object
	 * @private
	 */
	async _applyRoutingRules(messageObj) {
		for (const [ruleName, rule] of this.routingRules.entries()) {
			try {
				if (await rule.condition(messageObj)) {
					await rule.action(messageObj);
					this.stats.routingRulesApplied++;
					log(
						'debug',
						`Routing rule ${ruleName} applied to message ${messageObj.id}`
					);
				}
			} catch (error) {
				log('error', `Routing rule ${ruleName} failed:`, error.message);
			}
		}
	}

	/**
	 * Execute a subscriber with error handling
	 *
	 * @param {Object} subscription - Subscription object
	 * @param {Object} messageObj - Message object
	 * @param {Object} context - Execution context
	 * @private
	 */
	async _executeSubscriber(subscription, messageObj, context) {
		try {
			subscription.stats.messagesReceived++;
			subscription.stats.lastMessageAt = new Date().toISOString();

			const result = await subscription.subscriber(messageObj.data, {
				...context,
				messageId: messageObj.id,
				topic: messageObj.topic,
				channel: messageObj.channel,
				metadata: messageObj.metadata,
				subscriptionId: subscription.id
			});

			this.stats.messagesDelivered++;
			return result;
		} catch (error) {
			subscription.stats.errors++;
			log('error', `Subscriber ${subscription.id} failed:`, error.message);
			throw error;
		}
	}

	/**
	 * Replay message history to a new subscriber
	 *
	 * @param {Object} subscription - Subscription object
	 * @private
	 */
	async _replayMessages(subscription) {
		const topicInfo = this.topics.get(subscription.topic);
		if (!topicInfo || !topicInfo.messageHistory) {
			return;
		}

		const messagesToReplay = topicInfo.messageHistory
			.slice(-subscription.options.replayCount)
			.filter((msg) => msg.channel === subscription.channel);

		log(
			'debug',
			`Replaying ${messagesToReplay.length} messages to subscription ${subscription.id}`
		);

		for (const messageObj of messagesToReplay) {
			try {
				await this._executeSubscriber(subscription, messageObj, {
					eventType: this._getFullEventType(
						subscription.topic,
						subscription.channel
					),
					replay: true
				});
			} catch (error) {
				log(
					'warn',
					`Failed to replay message ${messageObj.id} to subscription ${subscription.id}:`,
					error.message
				);
			}
		}
	}

	/**
	 * Clear all topics, channels, and subscriptions
	 */
	clear() {
		// Clear all subscriptions
		for (const subscriptionId of this.subscriptions.keys()) {
			this.unsubscribe(subscriptionId);
		}

		// Clear topics and channels
		this.topics.clear();
		this.channels.clear();
		this.routingRules.clear();

		// Clear emitter
		this.emitter.clear();

		// Reset stats
		this.stats = {
			messagesPublished: 0,
			messagesDelivered: 0,
			activeSubscriptions: 0,
			topicsCreated: 0,
			channelsCreated: 0,
			routingRulesApplied: 0
		};

		// Recreate default channel
		this._createChannel(this.config.defaultChannel);

		log('debug', 'Event bus cleared');
	}
}
