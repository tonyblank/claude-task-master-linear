/**
 * @fileoverview Async Event Queue with advanced processing capabilities
 *
 * This module provides sophisticated event queuing with features like
 * prioritization, batching, rate limiting, and guaranteed delivery.
 */

import { log } from '../utils.js';

/**
 * Priority levels for queue items
 */
export const PRIORITY = {
	CRITICAL: 0,
	HIGH: 1,
	NORMAL: 2,
	LOW: 3,
	BACKGROUND: 4
};

/**
 * Queue processing states
 */
export const QUEUE_STATE = {
	IDLE: 'idle',
	PROCESSING: 'processing',
	PAUSED: 'paused',
	DRAINING: 'draining',
	ERROR: 'error'
};

/**
 * Advanced async event queue with prioritization and batching
 */
export class EventQueue {
	/**
	 * @param {Object} config - Configuration options
	 */
	constructor(config = {}) {
		this.config = {
			maxSize: 10000,
			maxConcurrency: 5,
			processingInterval: 100, // ms between processing cycles
			batchSize: 10,
			enableBatching: true,
			enablePrioritization: true,
			enableRateLimiting: false,
			rateLimit: 100, // events per second
			retryAttempts: 3,
			retryDelay: 1000,
			enableDeadLetterQueue: true,
			deadLetterMaxSize: 1000,
			enableMetrics: true,
			processingTimeout: 30000,
			...config
		};

		// Main queue - priority queues for different priority levels
		this.queues = new Map();
		for (const priority of Object.values(PRIORITY)) {
			this.queues.set(priority, []);
		}

		// Dead letter queue for failed items
		this.deadLetterQueue = [];

		// Processing state
		this.state = QUEUE_STATE.IDLE;
		this.processingTimer = null;
		this.activeTasks = new Set();

		// Rate limiting
		this.rateLimitTokens = this.config.rateLimit;
		this.lastTokenRefill = Date.now();

		// Metrics and statistics
		this.stats = {
			itemsQueued: 0,
			itemsProcessed: 0,
			itemsFailed: 0,
			itemsRetried: 0,
			batchesProcessed: 0,
			averageProcessingTime: 0,
			totalProcessingTime: 0,
			queueSize: 0,
			deadLetterSize: 0
		};

		// Event handlers for queue events
		this.eventHandlers = {
			'item:queued': [],
			'item:processing': [],
			'item:completed': [],
			'item:failed': [],
			'item:retry': [],
			'batch:processing': [],
			'batch:completed': [],
			'queue:empty': [],
			'queue:full': [],
			'queue:error': []
		};

		// Bind methods
		this.push = this.push.bind(this);
		this._processItems = this._processItems.bind(this);
	}

	/**
	 * Add an item to the queue
	 *
	 * @param {any} data - Item data
	 * @param {Object} options - Queue options
	 * @returns {Promise<string>} Item ID
	 */
	async push(data, options = {}) {
		const itemOptions = {
			priority: PRIORITY.NORMAL,
			processor: null, // Custom processor function
			retries: 0,
			maxRetries: this.config.retryAttempts,
			timeout: this.config.processingTimeout,
			metadata: {},
			guaranteed: false,
			batchable: true,
			...options
		};

		// Check queue size limit
		if (this._getTotalQueueSize() >= this.config.maxSize) {
			this._emitEvent('queue:full', { size: this._getTotalQueueSize() });
			throw new Error('Queue is full');
		}

		const item = {
			id: `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
			data,
			options: itemOptions,
			queuedAt: Date.now(),
			attempts: 0,
			lastAttemptAt: null,
			errors: []
		};

		// Add to appropriate priority queue
		const priorityQueue = this.queues.get(itemOptions.priority);
		priorityQueue.push(item);

		// Update stats
		this.stats.itemsQueued++;
		this.stats.queueSize = this._getTotalQueueSize();

		this._emitEvent('item:queued', { item });

		log(
			'debug',
			`Item ${item.id} queued with priority ${itemOptions.priority}`
		);

		// Start processing if not already running
		if (this.state === QUEUE_STATE.IDLE) {
			this.startProcessing();
		}

		return item.id;
	}

	/**
	 * Add multiple items to the queue
	 *
	 * @param {Array} items - Array of { data, options } objects
	 * @returns {Promise<Array>} Array of item IDs
	 */
	async pushBatch(items) {
		const itemIds = [];

		for (const item of items) {
			const itemId = await this.push(item.data, item.options);
			itemIds.push(itemId);
		}

		return itemIds;
	}

	/**
	 * Start queue processing
	 *
	 * @returns {void}
	 */
	startProcessing() {
		if (
			this.state === QUEUE_STATE.PROCESSING ||
			this.state === QUEUE_STATE.DRAINING
		) {
			return;
		}

		this.state = QUEUE_STATE.PROCESSING;
		this._scheduleProcessing();

		log('debug', 'Queue processing started');
	}

	/**
	 * Pause queue processing
	 *
	 * @returns {void}
	 */
	pauseProcessing() {
		if (this.processingTimer) {
			clearTimeout(this.processingTimer);
			this.processingTimer = null;
		}

		this.state = QUEUE_STATE.PAUSED;
		log('debug', 'Queue processing paused');
	}

	/**
	 * Resume queue processing
	 *
	 * @returns {void}
	 */
	resumeProcessing() {
		if (this.state === QUEUE_STATE.PAUSED) {
			this.startProcessing();
			log('debug', 'Queue processing resumed');
		}
	}

	/**
	 * Stop processing and drain the queue
	 *
	 * @returns {Promise<void>}
	 */
	async drain() {
		this.state = QUEUE_STATE.DRAINING;

		// Process remaining items
		while (this._getTotalQueueSize() > 0 && this.activeTasks.size > 0) {
			await this._processItems();
			await new Promise((resolve) =>
				setTimeout(resolve, this.config.processingInterval)
			);
		}

		// Wait for active tasks to complete
		while (this.activeTasks.size > 0) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		this.state = QUEUE_STATE.IDLE;
		log('debug', 'Queue drained');
	}

	/**
	 * Get the next item(s) to process
	 *
	 * @param {number} count - Number of items to get
	 * @returns {Array} Items to process
	 */
	getNextItems(count = 1) {
		const items = [];

		// Process by priority order
		for (const priority of Object.values(PRIORITY)) {
			const queue = this.queues.get(priority);

			while (queue.length > 0 && items.length < count) {
				const item = queue.shift();

				// Check if item should be processed (rate limiting, etc.)
				if (this._shouldProcessItem(item)) {
					items.push(item);
				} else {
					// Put item back at the front
					queue.unshift(item);
					break;
				}
			}

			if (items.length >= count) {
				break;
			}
		}

		return items;
	}

	/**
	 * Process an individual item
	 *
	 * @param {Object} item - Queue item
	 * @returns {Promise<any>} Processing result
	 */
	async processItem(item) {
		const taskId = `task_${item.id}_${Date.now()}`;
		this.activeTasks.add(taskId);

		try {
			item.attempts++;
			item.lastAttemptAt = Date.now();

			this._emitEvent('item:processing', { item });

			const startTime = Date.now();
			let result;

			// Use custom processor if provided, otherwise use default
			if (
				item.options.processor &&
				typeof item.options.processor === 'function'
			) {
				result = await this._executeWithTimeout(
					() => item.options.processor(item.data, item),
					item.options.timeout
				);
			} else {
				// Default processing - just return the data
				result = item.data;
			}

			const processingTime = Date.now() - startTime;

			// Update stats
			this.stats.itemsProcessed++;
			this.stats.totalProcessingTime += processingTime;
			this.stats.averageProcessingTime =
				this.stats.totalProcessingTime / this.stats.itemsProcessed;

			this._emitEvent('item:completed', { item, result, processingTime });

			log(
				'debug',
				`Item ${item.id} processed successfully in ${processingTime}ms`
			);
			return result;
		} catch (error) {
			return this._handleProcessingError(item, error);
		} finally {
			this.activeTasks.delete(taskId);
			this.stats.queueSize = this._getTotalQueueSize();
		}
	}

	/**
	 * Process a batch of items
	 *
	 * @param {Array} items - Items to process
	 * @returns {Promise<Array>} Processing results
	 */
	async processBatch(items) {
		if (!this.config.enableBatching || items.length === 0) {
			return [];
		}

		// Filter batchable items
		const batchableItems = items.filter((item) => item.options.batchable);
		const nonBatchableItems = items.filter((item) => !item.options.batchable);

		const results = [];

		// Process batchable items together
		if (batchableItems.length > 0) {
			this._emitEvent('batch:processing', { items: batchableItems });

			const batchStartTime = Date.now();

			try {
				// Group by processor function if available
				const processorGroups = new Map();

				for (const item of batchableItems) {
					const processorKey = item.options.processor
						? item.options.processor.toString()
						: 'default';

					if (!processorGroups.has(processorKey)) {
						processorGroups.set(processorKey, []);
					}
					processorGroups.get(processorKey).push(item);
				}

				// Process each group
				for (const [processorKey, groupItems] of processorGroups.entries()) {
					const groupResults = await Promise.allSettled(
						groupItems.map((item) => this.processItem(item))
					);
					results.push(...groupResults);
				}

				const batchProcessingTime = Date.now() - batchStartTime;
				this.stats.batchesProcessed++;

				this._emitEvent('batch:completed', {
					items: batchableItems,
					results,
					processingTime: batchProcessingTime
				});
			} catch (error) {
				log('error', 'Batch processing failed:', error.message);
				this._emitEvent('queue:error', { error, items: batchableItems });
			}
		}

		// Process non-batchable items individually
		for (const item of nonBatchableItems) {
			try {
				const result = await this.processItem(item);
				results.push({ status: 'fulfilled', value: result });
			} catch (error) {
				results.push({ status: 'rejected', reason: error });
			}
		}

		return results;
	}

	/**
	 * Add event listener for queue events
	 *
	 * @param {string} eventType - Event type
	 * @param {Function} handler - Event handler
	 * @returns {void}
	 */
	on(eventType, handler) {
		if (!this.eventHandlers[eventType]) {
			this.eventHandlers[eventType] = [];
		}
		this.eventHandlers[eventType].push(handler);
	}

	/**
	 * Remove event listener
	 *
	 * @param {string} eventType - Event type
	 * @param {Function} handler - Event handler
	 * @returns {void}
	 */
	off(eventType, handler) {
		if (!this.eventHandlers[eventType]) {
			return;
		}

		const index = this.eventHandlers[eventType].indexOf(handler);
		if (index !== -1) {
			this.eventHandlers[eventType].splice(index, 1);
		}
	}

	/**
	 * Get queue statistics
	 *
	 * @returns {Object} Statistics object
	 */
	getStats() {
		return {
			...this.stats,
			state: this.state,
			activeTasks: this.activeTasks.size,
			queueSizeByPriority: this._getQueueSizeByPriority(),
			deadLetterSize: this.deadLetterQueue.length
		};
	}

	/**
	 * Get items from dead letter queue
	 *
	 * @param {Object} options - Query options
	 * @returns {Array} Dead letter items
	 */
	getDeadLetterItems(options = {}) {
		const queryOptions = {
			limit: 50,
			offset: 0,
			...options
		};

		const start = queryOptions.offset;
		const end = start + queryOptions.limit;

		return this.deadLetterQueue.slice(start, end);
	}

	/**
	 * Retry items from dead letter queue
	 *
	 * @param {Array} itemIds - Item IDs to retry (optional)
	 * @returns {Promise<number>} Number of items retried
	 */
	async retryDeadLetterItems(itemIds = null) {
		let itemsToRetry;

		if (itemIds) {
			itemsToRetry = this.deadLetterQueue.filter((item) =>
				itemIds.includes(item.id)
			);
		} else {
			itemsToRetry = [...this.deadLetterQueue];
		}

		let retriedCount = 0;

		for (const item of itemsToRetry) {
			try {
				// Reset retry counters
				item.attempts = 0;
				item.errors = [];

				// Re-queue the item
				await this.push(item.data, item.options);

				// Remove from dead letter queue
				const dlqIndex = this.deadLetterQueue.indexOf(item);
				if (dlqIndex !== -1) {
					this.deadLetterQueue.splice(dlqIndex, 1);
				}

				retriedCount++;
			} catch (error) {
				log(
					'error',
					`Failed to retry dead letter item ${item.id}:`,
					error.message
				);
			}
		}

		log('debug', `Retried ${retriedCount} items from dead letter queue`);
		return retriedCount;
	}

	/**
	 * Clear the queue
	 *
	 * @param {boolean} includeDLQ - Also clear dead letter queue
	 * @returns {void}
	 */
	clear(includeDLQ = false) {
		// Clear all priority queues
		for (const queue of this.queues.values()) {
			queue.length = 0;
		}

		if (includeDLQ) {
			this.deadLetterQueue.length = 0;
		}

		// Reset stats
		this.stats.queueSize = 0;
		this.stats.deadLetterSize = this.deadLetterQueue.length;

		log('debug', 'Queue cleared');
	}

	/**
	 * Schedule next processing cycle
	 *
	 * @private
	 */
	_scheduleProcessing() {
		if (this.state !== QUEUE_STATE.PROCESSING) {
			return;
		}

		this.processingTimer = setTimeout(() => {
			this._processItems().catch((error) => {
				log('error', 'Processing cycle failed:', error.message);
				this._emitEvent('queue:error', { error });
			});
		}, this.config.processingInterval);
	}

	/**
	 * Main processing loop
	 *
	 * @private
	 */
	async _processItems() {
		if (
			this.state !== QUEUE_STATE.PROCESSING &&
			this.state !== QUEUE_STATE.DRAINING
		) {
			return;
		}

		const totalQueueSize = this._getTotalQueueSize();

		if (totalQueueSize === 0) {
			this._emitEvent('queue:empty', {});

			if (this.state === QUEUE_STATE.PROCESSING) {
				this.state = QUEUE_STATE.IDLE;
			}
			return;
		}

		// Apply rate limiting
		if (this.config.enableRateLimiting) {
			this._refillRateLimitTokens();

			if (this.rateLimitTokens <= 0) {
				this._scheduleProcessing();
				return;
			}
		}

		// Calculate how many items to process this cycle
		const availableSlots = this.config.maxConcurrency - this.activeTasks.size;
		const itemsToProcess = Math.min(
			availableSlots,
			this.config.batchSize,
			totalQueueSize,
			this.config.enableRateLimiting ? this.rateLimitTokens : Infinity
		);

		if (itemsToProcess <= 0) {
			this._scheduleProcessing();
			return;
		}

		// Get items to process
		const items = this.getNextItems(itemsToProcess);

		if (items.length === 0) {
			this._scheduleProcessing();
			return;
		}

		// Update rate limit tokens
		if (this.config.enableRateLimiting) {
			this.rateLimitTokens -= items.length;
		}

		// Process items (batch or individual)
		if (this.config.enableBatching && items.length > 1) {
			// Process as batch if multiple items and batching is enabled
			this.processBatch(items).catch((error) => {
				log('error', 'Batch processing failed:', error.message);
			});
		} else {
			// Process items individually
			for (const item of items) {
				this.processItem(item).catch((error) => {
					log('error', `Item processing failed:`, error.message);
				});
			}
		}

		// Schedule next processing cycle
		this._scheduleProcessing();
	}

	/**
	 * Handle processing error with retry logic
	 *
	 * @param {Object} item - Queue item
	 * @param {Error} error - Processing error
	 * @private
	 */
	async _handleProcessingError(item, error) {
		item.errors.push({
			error: error.message,
			timestamp: Date.now(),
			attempt: item.attempts
		});

		this.stats.itemsFailed++;

		// Check if item should be retried
		if (item.attempts < item.options.maxRetries) {
			this.stats.itemsRetried++;

			this._emitEvent('item:retry', { item, error, attempt: item.attempts });

			// Add delay before retry
			if (this.config.retryDelay > 0) {
				await new Promise((resolve) =>
					setTimeout(resolve, this.config.retryDelay)
				);
			}

			// Re-queue for retry
			const priorityQueue = this.queues.get(item.options.priority);
			priorityQueue.unshift(item); // Add to front for priority

			log(
				'debug',
				`Item ${item.id} queued for retry (attempt ${item.attempts}/${item.options.maxRetries})`
			);
		} else {
			// Move to dead letter queue
			if (this.config.enableDeadLetterQueue) {
				this._moveToDeadLetterQueue(item);
			}

			this._emitEvent('item:failed', { item, error, finalAttempt: true });

			log(
				'error',
				`Item ${item.id} failed permanently after ${item.attempts} attempts:`,
				error.message
			);
		}

		throw error;
	}

	/**
	 * Move item to dead letter queue
	 *
	 * @param {Object} item - Queue item
	 * @private
	 */
	_moveToDeadLetterQueue(item) {
		// Add timestamp when moved to DLQ
		item.deadLetterAt = Date.now();

		this.deadLetterQueue.push(item);

		// Trim DLQ if it exceeds size limit
		if (this.deadLetterQueue.length > this.config.deadLetterMaxSize) {
			this.deadLetterQueue.shift();
		}

		this.stats.deadLetterSize = this.deadLetterQueue.length;
	}

	/**
	 * Check if item should be processed now
	 *
	 * @param {Object} item - Queue item
	 * @returns {boolean} True if should process
	 * @private
	 */
	_shouldProcessItem(item) {
		// Override this method in subclasses to implement custom filtering
		// Default implementation processes all items
		return true;
	}

	/**
	 * Execute function with timeout
	 *
	 * @param {Function} fn - Function to execute
	 * @param {number} timeout - Timeout in milliseconds
	 * @returns {Promise<any>} Function result
	 * @private
	 */
	async _executeWithTimeout(fn, timeout) {
		return Promise.race([
			fn(),
			new Promise((_, reject) =>
				setTimeout(
					() => reject(new Error(`Operation timeout after ${timeout}ms`)),
					timeout
				)
			)
		]);
	}

	/**
	 * Refill rate limit tokens
	 *
	 * @private
	 */
	_refillRateLimitTokens() {
		const now = Date.now();
		const timePassed = now - this.lastTokenRefill;
		const tokensToAdd = Math.floor((timePassed / 1000) * this.config.rateLimit);

		if (tokensToAdd > 0) {
			this.rateLimitTokens = Math.min(
				this.config.rateLimit,
				this.rateLimitTokens + tokensToAdd
			);
			this.lastTokenRefill = now;
		}
	}

	/**
	 * Get total queue size across all priorities
	 *
	 * @returns {number} Total queue size
	 * @private
	 */
	_getTotalQueueSize() {
		let total = 0;
		for (const queue of this.queues.values()) {
			total += queue.length;
		}
		return total;
	}

	/**
	 * Get queue size by priority
	 *
	 * @returns {Object} Queue sizes by priority
	 * @private
	 */
	_getQueueSizeByPriority() {
		const sizes = {};
		for (const [priority, queue] of this.queues.entries()) {
			sizes[priority] = queue.length;
		}
		return sizes;
	}

	/**
	 * Emit queue event
	 *
	 * @param {string} eventType - Event type
	 * @param {any} data - Event data
	 * @private
	 */
	_emitEvent(eventType, data) {
		const handlers = this.eventHandlers[eventType] || [];

		for (const handler of handlers) {
			try {
				handler(data);
			} catch (error) {
				log(
					'error',
					`Queue event handler failed for ${eventType}:`,
					error.message
				);
			}
		}
	}
}
