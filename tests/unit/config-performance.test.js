/**
 * Performance Tests for Configuration System
 * Tests configuration system performance with large datasets and stress scenarios
 */

import { jest } from '@jest/globals';

// Mock dependencies first
const mockGetConfig = jest.fn();
const mockWriteConfig = jest.fn();
const mockValidateConfig = jest.fn();
const mockNormalizeConfig = jest.fn();
const mockLog = jest.fn();

jest.unstable_mockModule('../../scripts/modules/config-manager.js', () => ({
	getConfig: mockGetConfig,
	writeConfig: mockWriteConfig
}));

jest.unstable_mockModule(
	'../../scripts/modules/validation/validators.js',
	() => ({
		validateConfig: mockValidateConfig
	})
);

jest.unstable_mockModule(
	'../../scripts/modules/validation/sanitizers.js',
	() => ({
		normalizeConfig: mockNormalizeConfig
	})
);

jest.unstable_mockModule('../../scripts/modules/utils.js', () => ({
	log: mockLog
}));

// Import after mocking
const {
	getConfigValue,
	getConfigValues,
	setConfigValue,
	setConfigValues,
	mergeConfig,
	hasConfigPath,
	deleteConfigValue
} = await import('../../scripts/modules/config-helpers.js');

describe.skip('Configuration Performance Tests', () => {
	// Helper function to generate large configuration objects
	const generateLargeConfig = (depth = 5, breadth = 10) => {
		const generateLevel = (currentDepth, maxDepth, keyPrefix = '') => {
			if (currentDepth >= maxDepth) {
				return Math.random() > 0.5
					? `value_${keyPrefix}_${Math.floor(Math.random() * 1000)}`
					: Math.floor(Math.random() * 1000);
			}

			const obj = {};
			for (let i = 0; i < breadth; i++) {
				const key = `${keyPrefix}key_${i}`;
				obj[key] = generateLevel(currentDepth + 1, maxDepth, key);
			}
			return obj;
		};

		return {
			models: generateLevel(0, depth - 1, 'models'),
			global: generateLevel(0, depth - 1, 'global'),
			integrations: generateLevel(0, depth - 1, 'integrations'),
			custom: generateLevel(0, depth - 1, 'custom')
		};
	};

	// Helper function to generate many path updates
	const generateBulkUpdates = (count = 100) => {
		const updates = {};
		for (let i = 0; i < count; i++) {
			const section = ['models', 'global', 'integrations', 'custom'][i % 4];
			const path = `${section}.level1_${i % 10}.level2_${i % 5}.level3_${i % 3}.value`;
			updates[path] = `updated_value_${i}`;
		}
		return updates;
	};

	beforeEach(() => {
		jest.clearAllMocks();
		mockWriteConfig.mockResolvedValue(true);
		mockValidateConfig.mockReturnValue({
			valid: true,
			errors: [],
			warnings: []
		});
		mockNormalizeConfig.mockImplementation((config) => config);
	});

	describe('Large Configuration Handling', () => {
		test('should handle reading from very large configurations efficiently', () => {
			const largeConfig = generateLargeConfig(6, 15); // Deep and broad config
			mockGetConfig.mockReturnValue(largeConfig);

			const startTime = performance.now();

			// Perform multiple deep reads
			const results = [];
			for (let i = 0; i < 100; i++) {
				const section = ['models', 'global', 'integrations', 'custom'][i % 4];
				const path = `${section}.key_${i % 15}.key_${i % 10}.key_${i % 5}`;
				results.push(getConfigValue(path, 'default'));
			}

			const endTime = performance.now();
			const duration = endTime - startTime;

			// Should complete within reasonable time (less than 100ms for 100 deep reads)
			expect(duration).toBeLessThan(100);
			expect(results).toHaveLength(100);
			// Some reads should succeed (find actual values), others should return defaults
			expect(results.some((r) => r !== 'default')).toBe(true);
		});

		test('should handle writing to large configurations efficiently', () => {
			const largeConfig = generateLargeConfig(5, 12);
			mockGetConfig.mockReturnValue(largeConfig);

			const startTime = performance.now();

			// Perform multiple deep writes
			const results = [];
			for (let i = 0; i < 50; i++) {
				const section = ['models', 'global', 'integrations'][i % 3];
				const path = `${section}.newLevel_${i}.subLevel_${i % 10}.value`;
				results.push(setConfigValue(path, `performance_test_value_${i}`));
			}

			const endTime = performance.now();
			const duration = endTime - startTime;

			// Should complete within reasonable time (less than 200ms for 50 deep writes)
			expect(duration).toBeLessThan(200);
			expect(results).toHaveLength(50);
			expect(results.every((r) => r.success)).toBe(true);
			expect(mockWriteConfig).toHaveBeenCalledTimes(50);
		});

		test('should handle bulk operations on large datasets efficiently', () => {
			const largeConfig = generateLargeConfig(4, 20);
			mockGetConfig.mockReturnValue(largeConfig);

			const bulkUpdates = generateBulkUpdates(200); // 200 path updates

			const startTime = performance.now();
			const result = setConfigValues(bulkUpdates);
			const endTime = performance.now();
			const duration = endTime - startTime;

			// Bulk operation should be more efficient than individual operations
			expect(duration).toBeLessThan(300); // Should complete within 300ms
			expect(result.success).toBe(true);
			expect(result.updatedPaths).toHaveLength(200);
			expect(mockWriteConfig).toHaveBeenCalledTimes(1); // Only one write operation
		});

		test('should handle complex path traversal efficiently', () => {
			const largeConfig = generateLargeConfig(8, 8); // Very deep config
			mockGetConfig.mockReturnValue(largeConfig);

			const startTime = performance.now();

			// Test very deep path traversal
			const deepPaths = [];
			for (let i = 0; i < 50; i++) {
				let path = 'models';
				for (let j = 0; j < 6; j++) {
					path += `.key_${(i + j) % 8}`;
				}
				deepPaths.push(path);
			}

			const results = getConfigValues(deepPaths);

			const endTime = performance.now();
			const duration = endTime - startTime;

			expect(duration).toBeLessThan(150);
			expect(Object.keys(results)).toHaveLength(50);
		});
	});

	describe('Memory Efficiency', () => {
		test('should not cause memory leaks with repeated operations', () => {
			const config = generateLargeConfig(4, 10);
			mockGetConfig.mockReturnValue(config);

			// Get initial memory usage (approximate)
			const initialMemory = process.memoryUsage().heapUsed;

			// Perform many operations
			for (let i = 0; i < 1000; i++) {
				const path = `models.level_${i % 10}.sublevel_${i % 5}.value`;
				getConfigValue(path, 'default');

				if (i % 100 === 0) {
					// Trigger garbage collection hint
					if (global.gc) {
						global.gc();
					}
				}
			}

			const finalMemory = process.memoryUsage().heapUsed;
			const memoryIncrease = finalMemory - initialMemory;

			// Memory increase should be reasonable (less than 50MB for 1000 operations)
			expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
		});

		test('should handle deep cloning efficiently for large objects', () => {
			const largeConfig = generateLargeConfig(5, 15);
			mockGetConfig.mockReturnValue(largeConfig);

			const startTime = performance.now();

			// Multiple operations that trigger deep cloning
			const results = [];
			for (let i = 0; i < 20; i++) {
				results.push(setConfigValue(`test.path.${i}`, `value_${i}`));
			}

			const endTime = performance.now();
			const duration = endTime - startTime;

			// Deep cloning should complete efficiently
			expect(duration).toBeLessThan(300);
			expect(results.every((r) => r.success)).toBe(true);
		});
	});

	describe('Concurrent Access Performance', () => {
		test('should handle concurrent read operations efficiently', async () => {
			const largeConfig = generateLargeConfig(4, 12);
			mockGetConfig.mockReturnValue(largeConfig);

			const startTime = performance.now();

			// Simulate concurrent reads
			const readPromises = [];
			for (let i = 0; i < 50; i++) {
				const path = `models.key_${i % 12}.subkey_${i % 8}.value`;
				readPromises.push(Promise.resolve(getConfigValue(path, 'default')));
			}

			const results = await Promise.all(readPromises);

			const endTime = performance.now();
			const duration = endTime - startTime;

			expect(duration).toBeLessThan(100);
			expect(results).toHaveLength(50);
		});

		test('should handle concurrent write operations without corruption', async () => {
			const baseConfig = generateLargeConfig(3, 8);
			mockGetConfig.mockReturnValue(baseConfig);

			const startTime = performance.now();

			// Simulate concurrent writes to different paths
			const writePromises = [];
			for (let i = 0; i < 25; i++) {
				const path = `concurrent.section_${i % 5}.item_${i}`;
				writePromises.push(
					Promise.resolve(setConfigValue(path, `concurrent_value_${i}`))
				);
			}

			const results = await Promise.all(writePromises);

			const endTime = performance.now();
			const duration = endTime - startTime;

			expect(duration).toBeLessThan(250);
			expect(results.every((r) => r.success)).toBe(true);
			expect(mockWriteConfig).toHaveBeenCalledTimes(25);
		});
	});

	describe('Stress Testing', () => {
		test('should survive stress test with rapid operations', () => {
			const config = generateLargeConfig(3, 10);
			mockGetConfig.mockReturnValue(config);

			const operations = [];
			const startTime = performance.now();

			// Mix of different operations
			for (let i = 0; i < 500; i++) {
				const operation = i % 4;
				const path = `stress.test.${i % 20}.value_${i % 10}`;

				switch (operation) {
					case 0:
						operations.push(getConfigValue(path, 'default'));
						break;
					case 1:
						operations.push(setConfigValue(path, `stress_value_${i}`));
						break;
					case 2:
						operations.push(hasConfigPath(path));
						break;
					case 3:
						operations.push(deleteConfigValue(path));
						break;
				}
			}

			const endTime = performance.now();
			const duration = endTime - startTime;

			// Should complete within reasonable time even under stress
			expect(duration).toBeLessThan(1000); // 1 second for 500 mixed operations
			expect(operations).toHaveLength(500);
		});

		test('should handle extremely deep nesting without stack overflow', () => {
			// Create config with very deep nesting
			let deepConfig = {};
			let current = deepConfig;
			for (let i = 0; i < 50; i++) {
				// Reduced depth to avoid potential issues
				current[`level_${i}`] = {};
				current = current[`level_${i}`];
			}
			current.finalValue = 'deep_value';

			mockGetConfig.mockReturnValue(deepConfig);

			// Build very deep path
			let deepPath = '';
			for (let i = 0; i < 50; i++) {
				deepPath += (i > 0 ? '.' : '') + `level_${i}`;
			}
			deepPath += '.finalValue';

			const startTime = performance.now();

			// Should not cause stack overflow
			expect(() => {
				const result = getConfigValue(deepPath, 'default');
				expect(result).toBe('deep_value');
			}).not.toThrow();

			const endTime = performance.now();
			const duration = endTime - startTime;

			expect(duration).toBeLessThan(50); // Should be fast even for very deep paths
		});

		test('should handle many simultaneous path checks efficiently', () => {
			const largeConfig = generateLargeConfig(4, 15);
			mockGetConfig.mockReturnValue(largeConfig);

			const startTime = performance.now();

			// Check existence of many paths
			const checks = [];
			for (let i = 0; i < 200; i++) {
				const section = ['models', 'global', 'integrations', 'custom'][i % 4];
				const path = `${section}.key_${i % 15}.key_${i % 10}.key_${i % 5}`;
				checks.push(hasConfigPath(path));
			}

			const endTime = performance.now();
			const duration = endTime - startTime;

			expect(duration).toBeLessThan(100);
			expect(checks).toHaveLength(200);
			expect(checks.some((check) => check === true)).toBe(true); // Some paths should exist
			expect(checks.some((check) => check === false)).toBe(true); // Some should not exist
		});
	});

	describe('Complex Merge Performance', () => {
		test('should handle merging very large configurations efficiently', () => {
			const baseConfig = generateLargeConfig(4, 12);
			const overlayConfig = generateLargeConfig(4, 8);

			mockGetConfig.mockReturnValue(baseConfig);

			const startTime = performance.now();
			const result = mergeConfig(baseConfig, overlayConfig);
			const endTime = performance.now();
			const duration = endTime - startTime;

			expect(duration).toBeLessThan(200);
			expect(result.success).toBe(true);
			expect(result.config).toBeDefined();
		});

		test('should handle merging configurations with many conflicts efficiently', () => {
			// Create configs with many overlapping paths
			const baseConfig = {};
			const overlayConfig = {};

			for (let i = 0; i < 100; i++) {
				const path = `section.subsection_${i % 10}.item_${i}`;
				const pathParts = path.split('.');

				let baseCurrent = baseConfig;
				let overlayCurrent = overlayConfig;

				for (let j = 0; j < pathParts.length - 1; j++) {
					const part = pathParts[j];
					baseCurrent[part] = baseCurrent[part] || {};
					overlayCurrent[part] = overlayCurrent[part] || {};
					baseCurrent = baseCurrent[part];
					overlayCurrent = overlayCurrent[part];
				}

				const finalKey = pathParts[pathParts.length - 1];
				baseCurrent[finalKey] = `base_value_${i}`;
				overlayCurrent[finalKey] = `overlay_value_${i}`;
			}

			mockGetConfig.mockReturnValue(baseConfig);

			const startTime = performance.now();
			const result = mergeConfig(baseConfig, overlayConfig);
			const endTime = performance.now();
			const duration = endTime - startTime;

			expect(duration).toBeLessThan(150);
			expect(result.success).toBe(true);
			// Overlay values should win in conflicts
			expect(JSON.stringify(result.config)).toContain('overlay_value');
		});
	});

	describe('Validation Performance', () => {
		test('should handle validation of large configurations efficiently', () => {
			const largeConfig = generateLargeConfig(4, 10);
			mockGetConfig.mockReturnValue(largeConfig);

			// Mock validation to simulate real validation work
			mockValidateConfig.mockImplementation((config) => {
				// Simulate validation processing time
				const start = performance.now();
				while (performance.now() - start < 10) {
					// Simulate validation work
				}
				return { valid: true, errors: [], warnings: [] };
			});

			const startTime = performance.now();
			const result = setConfigValue('test.path.value', 'test', {
				validate: true
			});
			const endTime = performance.now();
			const duration = endTime - startTime;

			expect(result.success).toBe(true);
			expect(mockValidateConfig).toHaveBeenCalled();
			// Should complete even with validation overhead
			expect(duration).toBeLessThan(100);
		});
	});

	describe('Performance Regression Detection', () => {
		test('should maintain consistent performance across operations', () => {
			const config = generateLargeConfig(3, 10);
			mockGetConfig.mockReturnValue(config);

			const measurements = [];

			// Measure performance of identical operations
			for (let run = 0; run < 10; run++) {
				const startTime = performance.now();

				for (let i = 0; i < 20; i++) {
					getConfigValue(
						`models.key_${i % 10}.subkey_${i % 5}.value`,
						'default'
					);
				}

				const endTime = performance.now();
				measurements.push(endTime - startTime);
			}

			// Calculate performance consistency
			const avgTime =
				measurements.reduce((a, b) => a + b, 0) / measurements.length;
			const maxDeviation = Math.max(
				...measurements.map((t) => Math.abs(t - avgTime))
			);

			// Performance should be consistent (max deviation < 50% of average)
			expect(maxDeviation).toBeLessThan(avgTime * 0.5);
			expect(avgTime).toBeLessThan(50); // Average should be under 50ms
		});
	});
});
