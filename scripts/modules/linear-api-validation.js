/**
 * linear-api-validation.js
 * Linear API key validation and testing utilities
 */

import { LinearClient } from '@linear/sdk';
import { prompts, validators, messages } from './prompts.js';
import { log } from './utils.js';

/**
 * Validates Linear API key format
 * Supports both personal API keys (lin_api_) and OAuth keys (lin_oauth_)
 */
const apiKeyFormat = (apiKey) => {
	if (!apiKey || typeof apiKey !== 'string') {
		return 'API key is required and must be a string.';
	}

	// Basic length check - most API keys are at least 10 characters
	if (apiKey.length < 10) {
		return 'API key appears to be too short.';
	}

	return true;
};

/**
 * Linear API key format validation
 */
export const linearValidators = {
	/**
	 * Validates Linear API key format
	 * Supports both personal API keys (lin_api_) and OAuth keys (lin_oauth_)
	 */
	apiKeyFormat,

	/**
	 * Combines API key format validation with required field validation
	 */
	apiKey: validators.combine(validators.required, apiKeyFormat)
};

/**
 * Error classification for Linear API responses
 */
export const LinearErrorTypes = {
	AUTHENTICATION: 'authentication',
	NETWORK: 'network',
	RATE_LIMIT: 'rate_limit',
	INVALID_REQUEST: 'invalid_request',
	SERVER_ERROR: 'server_error',
	UNKNOWN: 'unknown'
};

/**
 * Classifies Linear API errors for user-friendly messaging
 */
export function classifyLinearError(error) {
	if (!error) return LinearErrorTypes.UNKNOWN;

	const message = error.message?.toLowerCase() || '';
	const status = error.status || error.statusCode;

	// Authentication errors
	if (
		status === 401 ||
		status === 403 ||
		message.includes('unauthorized') ||
		message.includes('invalid token') ||
		message.includes('authentication required') ||
		message.includes('not authenticated') ||
		message.includes('authentication failed')
	) {
		return LinearErrorTypes.AUTHENTICATION;
	}

	// Rate limiting
	if (
		status === 429 ||
		message.includes('rate limit') ||
		message.includes('too many requests')
	) {
		return LinearErrorTypes.RATE_LIMIT;
	}

	// Network errors
	if (
		message.includes('network') ||
		message.includes('enotfound') ||
		message.includes('econnreset') ||
		message.includes('timeout') ||
		status === 0
	) {
		return LinearErrorTypes.NETWORK;
	}

	// Server errors
	if (
		status >= 500 ||
		message.includes('server error') ||
		message.includes('internal error')
	) {
		return LinearErrorTypes.SERVER_ERROR;
	}

	// Invalid request
	if (status >= 400 && status < 500) {
		return LinearErrorTypes.INVALID_REQUEST;
	}

	return LinearErrorTypes.UNKNOWN;
}

/**
 * Gets user-friendly error messages for different error types
 */
export function getLinearErrorMessage(errorType, originalError = null) {
	const messages = {
		[LinearErrorTypes.AUTHENTICATION]: {
			title: 'Authentication Failed',
			message:
				'The provided API key is invalid or has expired. Please check your API key and try again.',
			suggestions: [
				'Verify your API key is copied correctly',
				'Check if the API key has expired',
				'Ensure the API key has proper permissions',
				'Generate a new API key if needed'
			]
		},
		[LinearErrorTypes.NETWORK]: {
			title: 'Network Error',
			message:
				'Unable to connect to Linear. Please check your internet connection and try again.',
			suggestions: [
				'Check your internet connection',
				'Verify Linear.app is accessible',
				'Try again in a few moments',
				'Check for firewall or proxy issues'
			]
		},
		[LinearErrorTypes.RATE_LIMIT]: {
			title: 'Rate Limit Exceeded',
			message:
				'Too many requests to Linear API. Please wait a moment before trying again.',
			suggestions: [
				'Wait 60 seconds before retrying',
				'Reduce the frequency of API calls',
				'Consider upgrading your Linear plan for higher limits'
			]
		},
		[LinearErrorTypes.INVALID_REQUEST]: {
			title: 'Invalid Request',
			message:
				'The request to Linear API was invalid. This might be a configuration issue.',
			suggestions: [
				'Check the API key format',
				'Verify the Linear workspace is accessible',
				'Contact support if the issue persists'
			]
		},
		[LinearErrorTypes.SERVER_ERROR]: {
			title: 'Linear Server Error',
			message: 'Linear is experiencing server issues. Please try again later.',
			suggestions: [
				'Try again in a few minutes',
				'Check Linear status page',
				'Contact Linear support if the issue persists'
			]
		},
		[LinearErrorTypes.UNKNOWN]: {
			title: 'Unknown Error',
			message:
				originalError?.message ||
				'An unexpected error occurred while connecting to Linear.',
			suggestions: [
				'Try again with a fresh API key',
				'Check Linear documentation',
				'Contact support with error details'
			]
		}
	};

	return messages[errorType] || messages[LinearErrorTypes.UNKNOWN];
}

/**
 * Tests a Linear API key by making a simple API call
 */
export async function testLinearApiKey(apiKey, options = {}) {
	const { timeout = 10000, retries = 2 } = options;

	if (!apiKey) {
		throw new Error('API key is required for testing');
	}

	// Validate format first
	const formatValidation = linearValidators.apiKeyFormat(apiKey);
	if (formatValidation !== true) {
		throw new Error(`Invalid API key format: ${formatValidation}`);
	}

	let lastError;
	for (let attempt = 1; attempt <= retries + 1; attempt++) {
		try {
			// Create client with timeout
			const client = new LinearClient({
				apiKey,
				timeout: timeout
			});

			// Test with a simple viewer query (gets current user info)
			const viewer = await client.viewer;

			// Verify we got valid user data
			if (!viewer || !viewer.id) {
				throw new Error('Invalid response from Linear API');
			}

			// Return success with user info
			return {
				success: true,
				user: {
					id: viewer.id,
					name: viewer.name,
					email: viewer.email,
					admin: viewer.admin || false
				},
				attempt
			};
		} catch (error) {
			lastError = error;

			// Don't retry on authentication errors
			const errorType = classifyLinearError(error);
			if (errorType === LinearErrorTypes.AUTHENTICATION) {
				break;
			}

			// Wait before retry (exponential backoff)
			if (attempt <= retries) {
				const delay = Math.min(1000 * 2 ** (attempt - 1), 5000);
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}
	}

	// If we get here, all attempts failed
	const errorType = classifyLinearError(lastError);
	const errorInfo = getLinearErrorMessage(errorType, lastError);

	return {
		success: false,
		error: {
			type: errorType,
			message: lastError?.message || 'Unknown error',
			userMessage: errorInfo.message,
			suggestions: errorInfo.suggestions
		}
	};
}

/**
 * Interactive Linear API key validation flow
 */
export async function promptAndValidateLinearApiKey(options = {}) {
	const {
		maxRetries = 3,
		allowSkip = false,
		initialMessage = 'Enter your Linear API key',
		checkEnvironment = true
	} = options;

	// First, check if we already have a valid API key in the environment
	if (checkEnvironment) {
		const envApiKey = process.env.LINEAR_API_KEY;
		if (envApiKey) {
			log(
				'info',
				'Found existing Linear API key in environment, validating...'
			);

			try {
				const testResult = await testLinearApiKey(envApiKey, {
					timeout: 15000,
					retries: 1
				});

				if (testResult.success) {
					messages.success('✅ Using existing API key from environment');
					messages.info(
						`Connected as: ${testResult.user.name} (${testResult.user.email || 'No email'})`
					);

					return {
						success: true,
						apiKey: envApiKey,
						user: testResult.user,
						attempts: 0,
						fromEnvironment: true
					};
				} else {
					log(
						'warn',
						'Existing API key in environment is invalid, prompting for new one...'
					);
				}
			} catch (error) {
				log('warn', `Error testing environment API key: ${error.message}`);
			}
		}
	}

	let attempts = 0;
	let lastError = null;

	while (attempts < maxRetries) {
		attempts++;

		try {
			// Show header on first attempt
			if (attempts === 1) {
				messages.header('Linear API Key Setup');
				console.log('To get your Linear API key:');
				console.log('1. Go to Linear Settings → API');
				console.log('2. Create a new Personal API key');
				console.log('3. Copy the key (starts with "lin_api_")');
				console.log();
			}

			// Show error from previous attempt
			if (lastError && attempts > 1) {
				messages.error(
					`Attempt ${attempts - 1} failed: ${lastError.userMessage}`
				);

				if (lastError.suggestions && lastError.suggestions.length > 0) {
					console.log('\nSuggestions:');
					for (const suggestion of lastError.suggestions) {
						console.log(`  • ${suggestion}`);
					}
				}
				console.log();
			}

			// Prompt for API key
			const apiKey = await prompts.password(
				attempts === 1
					? initialMessage
					: `Attempt ${attempts}: ${initialMessage}`,
				{ validate: linearValidators.apiKey }
			);

			// Test the API key
			messages.info('Testing API key...');
			const testResult = await testLinearApiKey(apiKey, {
				timeout: 15000,
				retries: 1
			});

			if (testResult.success) {
				messages.success(`API key validated successfully!`);
				messages.info(
					`Connected as: ${testResult.user.name} (${testResult.user.email || 'No email'})`
				);

				return {
					success: true,
					apiKey,
					user: testResult.user,
					attempts
				};
			} else {
				lastError = testResult.error;
			}
		} catch (error) {
			// Handle unexpected errors (e.g., user cancellation, validation errors)
			lastError = {
				userMessage: error.message || 'An unexpected error occurred',
				suggestions: ['Please try again with a valid API key']
			};
		}
	}

	// All attempts exhausted
	messages.error(`Failed to validate API key after ${maxRetries} attempts.`);

	if (lastError) {
		console.log(`\nLast error: ${lastError.userMessage}`);
		if (lastError.suggestions) {
			console.log('\nSuggestions:');
			for (const suggestion of lastError.suggestions) {
				console.log(`  • ${suggestion}`);
			}
		}
	}

	// Offer to skip if allowed
	if (allowSkip) {
		console.log();
		const shouldSkip = await prompts.confirm(
			'Would you like to skip Linear setup for now?',
			false
		);
		if (shouldSkip) {
			return { success: false, skipped: true, attempts };
		}
	}

	return {
		success: false,
		skipped: false,
		attempts,
		error: lastError
	};
}

// Alias for the main validation function
export const validateLinearApiKey = promptAndValidateLinearApiKey;

export default {
	linearValidators,
	LinearErrorTypes,
	classifyLinearError,
	getLinearErrorMessage,
	testLinearApiKey,
	promptAndValidateLinearApiKey,
	validateLinearApiKey
};
