/**
 * Tests for the Linear API validation module
 */

import { jest } from '@jest/globals';

// Mock LinearClient first before any imports
const mockLinearClient = {
	viewer: null
};

const MockLinearClient = jest.fn().mockImplementation(() => mockLinearClient);

jest.unstable_mockModule('@linear/sdk', () => ({
	LinearClient: MockLinearClient
}));

// Mock prompts module
jest.unstable_mockModule('../../scripts/modules/prompts.js', () => ({
	prompts: {
		password: jest.fn(),
		confirm: jest.fn()
	},
	validators: {
		required: jest.fn().mockReturnValue(true),
		combine: jest.fn().mockImplementation((...validators) => (input) => {
			for (const validator of validators) {
				const result = validator(input);
				if (result !== true) return result;
			}
			return true;
		})
	},
	messages: {
		header: jest.fn(),
		info: jest.fn(),
		success: jest.fn(),
		error: jest.fn()
	}
}));

// Import modules after mocking
const {
	linearValidators,
	LinearErrorTypes,
	classifyLinearError,
	getLinearErrorMessage,
	testLinearApiKey,
	promptAndValidateLinearApiKey
} = await import('../../scripts/modules/linear-api-validation.js');

// Mock console.log to avoid output during tests
const originalConsoleLog = console.log;

describe('Linear API Validation Module', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockLinearClient.viewer = null;
		console.log = jest.fn();
	});

	afterEach(() => {
		console.log = originalConsoleLog;
	});

	describe('linearValidators', () => {
		describe('apiKeyFormat', () => {
			it('should return true for valid lin_api_ format', () => {
				const validKey = 'lin_api_3thmgjor322griohzovh343LU7zvrdvdgT54T45G';
				expect(linearValidators.apiKeyFormat(validKey)).toBe(true);
			});

			it('should return true for valid lin_oauth_ format', () => {
				const validKey =
					'lin_oauth_8d4b9bd539dcd265935e2d01547e407971add2abb1fba737e202e62f10d8fb42';
				expect(linearValidators.apiKeyFormat(validKey)).toBe(true);
			});

			it('should return error for empty or null key', () => {
				expect(linearValidators.apiKeyFormat('')).toBe(
					'API key is required and must be a string.'
				);
				expect(linearValidators.apiKeyFormat(null)).toBe(
					'API key is required and must be a string.'
				);
				expect(linearValidators.apiKeyFormat(undefined)).toBe(
					'API key is required and must be a string.'
				);
			});

			it('should return error for non-string input', () => {
				expect(linearValidators.apiKeyFormat(123)).toBe(
					'API key is required and must be a string.'
				);
				expect(linearValidators.apiKeyFormat({})).toBe(
					'API key is required and must be a string.'
				);
			});

			it('should accept keys with any prefix', () => {
				expect(linearValidators.apiKeyFormat('sk-1234567890abcdefghijk')).toBe(
					true
				);
				expect(linearValidators.apiKeyFormat('api_key_123abcdefghijk')).toBe(
					true
				);
				expect(linearValidators.apiKeyFormat('custom_1234567890')).toBe(true);
			});

			it('should return error for too short key', () => {
				expect(linearValidators.apiKeyFormat('short')).toBe(
					'API key appears to be too short.'
				);
				expect(linearValidators.apiKeyFormat('1234567890')).toBe(true); // 10 chars is OK
			});

			it('should accept keys with any characters', () => {
				expect(linearValidators.apiKeyFormat('key_with@special#chars')).toBe(
					true
				);
				expect(linearValidators.apiKeyFormat('key with spaces')).toBe(true);
				expect(linearValidators.apiKeyFormat('key-with-dashes')).toBe(true);
			});
		});
	});

	describe('classifyLinearError', () => {
		it('should classify authentication errors', () => {
			expect(classifyLinearError({ status: 401 })).toBe(
				LinearErrorTypes.AUTHENTICATION
			);
			expect(classifyLinearError({ status: 403 })).toBe(
				LinearErrorTypes.AUTHENTICATION
			);
			expect(classifyLinearError({ message: 'Unauthorized access' })).toBe(
				LinearErrorTypes.AUTHENTICATION
			);
			expect(classifyLinearError({ message: 'Invalid token provided' })).toBe(
				LinearErrorTypes.AUTHENTICATION
			);
		});

		it('should classify rate limit errors', () => {
			expect(classifyLinearError({ status: 429 })).toBe(
				LinearErrorTypes.RATE_LIMIT
			);
			expect(classifyLinearError({ message: 'Rate limit exceeded' })).toBe(
				LinearErrorTypes.RATE_LIMIT
			);
			expect(classifyLinearError({ message: 'Too many requests' })).toBe(
				LinearErrorTypes.RATE_LIMIT
			);
		});

		it('should classify network errors', () => {
			expect(classifyLinearError({ message: 'Network error occurred' })).toBe(
				LinearErrorTypes.NETWORK
			);
			expect(classifyLinearError({ message: 'ENOTFOUND api.linear.app' })).toBe(
				LinearErrorTypes.NETWORK
			);
			expect(classifyLinearError({ message: 'ECONNRESET' })).toBe(
				LinearErrorTypes.NETWORK
			);
			expect(classifyLinearError({ message: 'Request timeout' })).toBe(
				LinearErrorTypes.NETWORK
			);
		});

		it('should classify server errors', () => {
			expect(classifyLinearError({ status: 500 })).toBe(
				LinearErrorTypes.SERVER_ERROR
			);
			expect(classifyLinearError({ status: 502 })).toBe(
				LinearErrorTypes.SERVER_ERROR
			);
			expect(classifyLinearError({ message: 'Internal server error' })).toBe(
				LinearErrorTypes.SERVER_ERROR
			);
		});

		it('should classify invalid request errors', () => {
			expect(classifyLinearError({ status: 400 })).toBe(
				LinearErrorTypes.INVALID_REQUEST
			);
			expect(classifyLinearError({ status: 404 })).toBe(
				LinearErrorTypes.INVALID_REQUEST
			);
		});

		it('should classify unknown errors', () => {
			expect(classifyLinearError({})).toBe(LinearErrorTypes.UNKNOWN);
			expect(classifyLinearError(null)).toBe(LinearErrorTypes.UNKNOWN);
			expect(classifyLinearError({ message: 'Some random error' })).toBe(
				LinearErrorTypes.UNKNOWN
			);
		});
	});

	describe('getLinearErrorMessage', () => {
		it('should return appropriate message for authentication errors', () => {
			const message = getLinearErrorMessage(LinearErrorTypes.AUTHENTICATION);
			expect(message.title).toBe('Authentication Failed');
			expect(message.message).toContain('API key is invalid');
			expect(message.suggestions).toContain(
				'Verify your API key is copied correctly'
			);
		});

		it('should return appropriate message for network errors', () => {
			const message = getLinearErrorMessage(LinearErrorTypes.NETWORK);
			expect(message.title).toBe('Network Error');
			expect(message.message).toContain('Unable to connect');
			expect(message.suggestions).toContain('Check your internet connection');
		});

		it('should return appropriate message for rate limit errors', () => {
			const message = getLinearErrorMessage(LinearErrorTypes.RATE_LIMIT);
			expect(message.title).toBe('Rate Limit Exceeded');
			expect(message.message).toContain('Too many requests');
			expect(message.suggestions).toContain('Wait 60 seconds before retrying');
		});

		it('should include original error message for unknown errors', () => {
			const originalError = { message: 'Custom error message' };
			const message = getLinearErrorMessage(
				LinearErrorTypes.UNKNOWN,
				originalError
			);
			expect(message.message).toBe('Custom error message');
		});
	});

	describe('testLinearApiKey', () => {
		beforeEach(() => {
			MockLinearClient.mockClear();
		});

		it('should return success for valid API key', async () => {
			// Mock successful viewer response
			mockLinearClient.viewer = Promise.resolve({
				id: 'user-123',
				name: 'Test User',
				email: 'test@example.com',
				admin: false
			});

			const result = await testLinearApiKey('lin_api_validkey123456789');

			expect(result.success).toBe(true);
			expect(result.user).toEqual({
				id: 'user-123',
				name: 'Test User',
				email: 'test@example.com',
				admin: false
			});
			expect(MockLinearClient).toHaveBeenCalledWith({
				apiKey: 'lin_api_validkey123456789',
				timeout: 10000
			});
		});

		it('should reject invalid API key format', async () => {
			// Test with a key that's too short
			await expect(testLinearApiKey('short')).rejects.toThrow(
				'API key appears to be too short'
			);
		});

		it('should handle authentication errors', async () => {
			// Mock authentication error by making viewer a rejected promise
			const authError = new Error('Unauthorized');
			authError.status = 401;

			MockLinearClient.mockImplementation(() => ({
				get viewer() {
					return Promise.reject(authError);
				}
			}));

			const result = await testLinearApiKey('lin_api_invalidkey123456789');

			expect(result.success).toBe(false);
			expect(result.error.type).toBe(LinearErrorTypes.AUTHENTICATION);
		});

		it('should handle custom timeout', async () => {
			mockLinearClient.viewer = Promise.resolve({
				id: 'user-123',
				name: 'Test User',
				email: 'test@example.com'
			});

			await testLinearApiKey('lin_api_validkey123456789', { timeout: 5000 });

			expect(MockLinearClient).toHaveBeenCalledWith({
				apiKey: 'lin_api_validkey123456789',
				timeout: 5000
			});
		});
	});
});
