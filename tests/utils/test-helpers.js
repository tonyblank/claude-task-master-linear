/**
 * Test Helper Utilities
 *
 * Provides utility functions to make tests work consistently
 * regardless of whether Jest is available or fallback mocks are used.
 */

import { MockServiceRegistry } from '../mocks/service-registry.js';

/**
 * Check if a mock function was called with specific arguments
 * @param {Function} mockFn - Mock function to check
 * @param {...any} args - Expected arguments
 * @returns {boolean} True if called with those arguments
 */
export function expectCalledWith(mockFn, ...args) {
	if (!mockFn || (!mockFn.mock && !mockFn._isMockFunction)) {
		throw new Error('Expected a mock function');
	}

	const calls = mockFn.mock ? mockFn.mock.calls : mockFn.calls || [];

	return calls.some((call) => {
		if (call.length !== args.length) return false;

		return call.every((arg, index) => {
			const expected = args[index];

			// Handle Jest.any() and similar matchers
			if (expected && typeof expected.asymmetricMatch === 'function') {
				return expected.asymmetricMatch(arg);
			}

			// Handle Jest.objectContaining() and similar matchers
			if (
				expected &&
				typeof expected.sample === 'object' &&
				expected.$$typeof
			) {
				// This is a Jest matcher, use its matching logic
				try {
					return expected.asymmetricMatch
						? expected.asymmetricMatch(arg)
						: JSON.stringify(arg).includes(JSON.stringify(expected.sample));
				} catch {
					return false;
				}
			}

			// Simple equality check
			return (
				Object.is(arg, expected) ||
				JSON.stringify(arg) === JSON.stringify(expected)
			);
		});
	});
}

/**
 * Check if a mock function was called
 * @param {Function} mockFn - Mock function to check
 * @returns {boolean} True if called at least once
 */
export function expectCalled(mockFn) {
	if (!mockFn || (!mockFn.mock && !mockFn._isMockFunction)) {
		throw new Error('Expected a mock function');
	}

	const calls = mockFn.mock ? mockFn.mock.calls : mockFn.calls || [];
	return calls.length > 0;
}

/**
 * Check if a mock function was called a specific number of times
 * @param {Function} mockFn - Mock function to check
 * @param {number} times - Expected number of calls
 * @returns {boolean} True if called exactly that many times
 */
export function expectCalledTimes(mockFn, times) {
	if (!mockFn || (!mockFn.mock && !mockFn._isMockFunction)) {
		throw new Error('Expected a mock function');
	}

	const calls = mockFn.mock ? mockFn.mock.calls : mockFn.calls || [];
	return calls.length === times;
}

/**
 * Get the calls made to a mock function
 * @param {Function} mockFn - Mock function
 * @returns {Array} Array of call arguments
 */
export function getCalls(mockFn) {
	if (!mockFn || (!mockFn.mock && !mockFn._isMockFunction)) {
		return [];
	}

	return mockFn.mock ? mockFn.mock.calls : mockFn.calls || [];
}

/**
 * Clear calls on a mock function
 * @param {Function} mockFn - Mock function to clear
 */
export function clearCalls(mockFn) {
	if (!mockFn) return;

	if (typeof mockFn.mockClear === 'function') {
		mockFn.mockClear();
	} else if (mockFn.calls) {
		mockFn.calls = [];
	}
}

/**
 * Custom Jest-compatible matchers for our test system
 */
export const customMatchers = {
	/**
	 * Expect function to have been called with specific arguments
	 */
	toHaveBeenCalledWith(received, ...args) {
		const pass = expectCalledWith(received, ...args);

		if (pass) {
			return {
				message: () =>
					`Expected mock function NOT to have been called with ${JSON.stringify(args)}`,
				pass: true
			};
		} else {
			const calls = getCalls(received);
			return {
				message: () =>
					`Expected mock function to have been called with ${JSON.stringify(args)}, but was called with: ${JSON.stringify(calls)}`,
				pass: false
			};
		}
	},

	/**
	 * Expect function to have been called
	 */
	toHaveBeenCalled(received) {
		const pass = expectCalled(received);

		if (pass) {
			return {
				message: () => 'Expected mock function NOT to have been called',
				pass: true
			};
		} else {
			return {
				message: () => 'Expected mock function to have been called',
				pass: false
			};
		}
	},

	/**
	 * Expect function to have been called specific number of times
	 */
	toHaveBeenCalledTimes(received, times) {
		const pass = expectCalledTimes(received, times);
		const actualTimes = getCalls(received).length;

		if (pass) {
			return {
				message: () =>
					`Expected mock function NOT to have been called ${times} times`,
				pass: true
			};
		} else {
			return {
				message: () =>
					`Expected mock function to have been called ${times} times, but was called ${actualTimes} times`,
				pass: false
			};
		}
	}
};

/**
 * Enhanced expect function that works with our mock system
 * @param {any} actual - Value to test
 * @returns {Object} Expectation object with matchers
 */
export function expectMock(actual) {
	return {
		toHaveBeenCalledWith: (...args) => {
			const result = customMatchers.toHaveBeenCalledWith(actual, ...args);
			if (!result.pass) {
				throw new Error(result.message());
			}
			return result;
		},

		toHaveBeenCalled: () => {
			const result = customMatchers.toHaveBeenCalled(actual);
			if (!result.pass) {
				throw new Error(result.message());
			}
			return result;
		},

		toHaveBeenCalledTimes: (times) => {
			const result = customMatchers.toHaveBeenCalledTimes(actual, times);
			if (!result.pass) {
				throw new Error(result.message());
			}
			return result;
		}
	};
}

/**
 * Setup test helpers - call this to extend Jest with custom matchers
 */
export function setupTestHelpers() {
	// Extend Jest if available
	if (typeof expect !== 'undefined' && expect.extend) {
		expect.extend(customMatchers);
	}
}

/**
 * Create expect.any() equivalent for our tests
 * @param {Function} constructor - Constructor function to match
 * @returns {Object} Asymmetric matcher
 */
export function any(constructor) {
	return {
		asymmetricMatch: (actual) =>
			actual instanceof constructor ||
			typeof actual === constructor.name.toLowerCase(),
		toString: () => `any(${constructor.name})`
	};
}

/**
 * Create expect.objectContaining() equivalent for our tests
 * @param {Object} object - Object properties to match
 * @returns {Object} Asymmetric matcher
 */
export function objectContaining(object) {
	return {
		asymmetricMatch: (actual) => {
			if (!actual || typeof actual !== 'object') return false;

			return Object.keys(object).every((key) => {
				if (!(key in actual)) return false;

				const expectedValue = object[key];
				const actualValue = actual[key];

				if (
					expectedValue &&
					typeof expectedValue.asymmetricMatch === 'function'
				) {
					return expectedValue.asymmetricMatch(actualValue);
				}

				return Object.is(actualValue, expectedValue);
			});
		},
		toString: () => `objectContaining(${JSON.stringify(object)})`
	};
}
