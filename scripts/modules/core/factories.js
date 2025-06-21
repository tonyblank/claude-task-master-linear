/**
 * Factory Functions for Production Dependencies
 *
 * Creates concrete implementations of interfaces for production use.
 * These factories are used by the dependency container to create instances.
 */

import { log } from '../utils.js';
import { getLogLevel, getGlobalConfig } from '../config-manager.js';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

/**
 * Create logger instance
 * @param {Object} deps - Dependencies
 * @returns {Object} Logger implementation
 */
export function createLogger(deps = {}) {
	return {
		log: (...args) => log(...args),
		error: (...args) => log('ERROR:', ...args),
		warn: (...args) => log('WARN:', ...args),
		info: (...args) => log('INFO:', ...args),
		debug: (...args) => {
			const level = getLogLevel();
			if (level === 'debug' || level === 'verbose') {
				log('DEBUG:', ...args);
			}
		}
	};
}

/**
 * Create config manager instance
 * @param {Object} deps - Dependencies
 * @returns {Object} Config manager implementation
 */
export function createConfigManager(deps = {}) {
	const configs = new Map();

	return {
		getLogLevel: () => getLogLevel(),
		getGlobalConfig: () => getGlobalConfig(),
		getConfig: (key) => configs.get(key),
		setConfig: (key, value) => configs.set(key, value),
		hasConfig: (key) => configs.has(key)
	};
}

/**
 * Create event emitter instance
 * @param {Object} deps - Dependencies
 * @returns {Object} Event emitter implementation
 */
export function createEventEmitter(deps = {}) {
	const emitter = new EventEmitter();

	return {
		emit: (...args) => emitter.emit(...args),
		on: (...args) => emitter.on(...args),
		off: (...args) => emitter.off(...args),
		once: (...args) => emitter.once(...args),
		removeAllListeners: (...args) => emitter.removeAllListeners(...args),
		listenerCount: (...args) => emitter.listenerCount(...args)
	};
}

/**
 * Create timer instance
 * @param {Object} deps - Dependencies
 * @returns {Object} Timer implementation
 */
export function createTimer(deps = {}) {
	return {
		setTimeout: (fn, delay) => setTimeout(fn, delay),
		setInterval: (fn, interval) => setInterval(fn, interval),
		clearTimeout: (id) => clearTimeout(id),
		clearInterval: (id) => clearInterval(id),
		now: () => Date.now()
	};
}

/**
 * Create file system instance
 * @param {Object} deps - Dependencies
 * @returns {Object} File system implementation
 */
export function createFileSystem(deps = {}) {
	return {
		readFile: (filePath, encoding = 'utf8') => {
			return new Promise((resolve, reject) => {
				fs.readFile(filePath, encoding, (err, data) => {
					if (err) reject(err);
					else resolve(data);
				});
			});
		},
		writeFile: (filePath, data, encoding = 'utf8') => {
			return new Promise((resolve, reject) => {
				fs.writeFile(filePath, data, encoding, (err) => {
					if (err) reject(err);
					else resolve();
				});
			});
		},
		existsSync: (filePath) => fs.existsSync(filePath),
		mkdir: (dirPath, options = { recursive: true }) => {
			return new Promise((resolve, reject) => {
				fs.mkdir(dirPath, options, (err) => {
					if (err) reject(err);
					else resolve();
				});
			});
		},
		readdir: (dirPath) => {
			return new Promise((resolve, reject) => {
				fs.readdir(dirPath, (err, files) => {
					if (err) reject(err);
					else resolve(files);
				});
			});
		},
		stat: (filePath) => {
			return new Promise((resolve, reject) => {
				fs.stat(filePath, (err, stats) => {
					if (err) reject(err);
					else resolve(stats);
				});
			});
		}
	};
}

/**
 * Create HTTP client instance
 * @param {Object} deps - Dependencies
 * @returns {Object} HTTP client implementation
 */
export function createHttpClient(deps = {}) {
	return {
		get: async (url, options = {}) => {
			const response = await fetch(url, { method: 'GET', ...options });
			return response;
		},
		post: async (url, data, options = {}) => {
			const response = await fetch(url, {
				method: 'POST',
				body: JSON.stringify(data),
				headers: { 'Content-Type': 'application/json', ...options.headers },
				...options
			});
			return response;
		},
		put: async (url, data, options = {}) => {
			const response = await fetch(url, {
				method: 'PUT',
				body: JSON.stringify(data),
				headers: { 'Content-Type': 'application/json', ...options.headers },
				...options
			});
			return response;
		},
		delete: async (url, options = {}) => {
			const response = await fetch(url, { method: 'DELETE', ...options });
			return response;
		},
		request: async (url, options = {}) => {
			const response = await fetch(url, options);
			return response;
		}
	};
}

/**
 * Register all production factories with a container
 * @param {DependencyContainer} container - Container to register with
 */
export function registerProductionFactories(container) {
	// Core utilities
	container.register('logger', createLogger, { singleton: true });
	container.register('configManager', createConfigManager, { singleton: true });
	container.register('eventEmitter', createEventEmitter);
	container.register('timer', createTimer, { singleton: true });
	container.register('fileSystem', createFileSystem, { singleton: true });
	container.register('httpClient', createHttpClient);
}
