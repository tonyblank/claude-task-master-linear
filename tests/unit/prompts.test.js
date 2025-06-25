/**
 * Tests for the prompts utility module
 */

import { jest } from '@jest/globals';
import {
	validators,
	promptConfigs,
	messages
} from '../../scripts/modules/prompts.js';

// Mock inquirer
const mockInquirer = {
	prompt: jest.fn()
};

jest.unstable_mockModule('inquirer', () => mockInquirer);

// Mock chalk to avoid color codes in tests
jest.unstable_mockModule('chalk', () => ({
	default: {
		cyan: (text) => text,
		green: (text) => text,
		red: (text) => text,
		yellow: (text) => text,
		blue: (text) => text,
		gray: (text) => text,
		bold: {
			cyan: (text) => text
		}
	}
}));

// Mock boxen
jest.unstable_mockModule('boxen', () => ({
	default: (text, options) => text
}));

describe('Prompts Utility Module', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		// Mock console methods
		jest.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		console.log.mockRestore();
	});

	describe('validators', () => {
		describe('required', () => {
			it('should return true for non-empty input', () => {
				expect(validators.required('test')).toBe(true);
			});

			it('should return error message for empty input', () => {
				expect(validators.required('')).toBe('This field is required.');
				expect(validators.required('   ')).toBe('This field is required.');
				expect(validators.required(null)).toBe('This field is required.');
				expect(validators.required(undefined)).toBe('This field is required.');
			});
		});

		describe('minLength', () => {
			it('should return true for input meeting minimum length', () => {
				const validator = validators.minLength(3);
				expect(validator('test')).toBe(true);
				expect(validator('abc')).toBe(true);
			});

			it('should return error message for input below minimum length', () => {
				const validator = validators.minLength(3);
				expect(validator('ab')).toBe('Must be at least 3 characters long.');
				expect(validator('')).toBe('Must be at least 3 characters long.');
			});
		});

		describe('maxLength', () => {
			it('should return true for input within maximum length', () => {
				const validator = validators.maxLength(5);
				expect(validator('test')).toBe(true);
				expect(validator('12345')).toBe(true);
			});

			it('should return error message for input exceeding maximum length', () => {
				const validator = validators.maxLength(5);
				expect(validator('123456')).toBe(
					'Must be no more than 5 characters long.'
				);
			});
		});

		describe('alphanumericWithHyphens', () => {
			it('should return true for valid alphanumeric input with hyphens and underscores', () => {
				expect(validators.alphanumericWithHyphens('test-123')).toBe(true);
				expect(validators.alphanumericWithHyphens('test_123')).toBe(true);
				expect(validators.alphanumericWithHyphens('TestABC123')).toBe(true);
			});

			it('should return error message for invalid characters', () => {
				expect(validators.alphanumericWithHyphens('test@123')).toBe(
					'Only letters, numbers, hyphens, and underscores are allowed.'
				);
				expect(validators.alphanumericWithHyphens('test 123')).toBe(
					'Only letters, numbers, hyphens, and underscores are allowed.'
				);
				expect(validators.alphanumericWithHyphens('test.123')).toBe(
					'Only letters, numbers, hyphens, and underscores are allowed.'
				);
			});
		});

		describe('email', () => {
			it('should return true for valid email addresses', () => {
				expect(validators.email('test@example.com')).toBe(true);
				expect(validators.email('user.name@domain.co.uk')).toBe(true);
			});

			it('should return error message for invalid email addresses', () => {
				expect(validators.email('invalid-email')).toBe(
					'Please enter a valid email address.'
				);
				expect(validators.email('test@')).toBe(
					'Please enter a valid email address.'
				);
				expect(validators.email('@example.com')).toBe(
					'Please enter a valid email address.'
				);
			});
		});

		describe('url', () => {
			it('should return true for valid URLs', () => {
				expect(validators.url('https://example.com')).toBe(true);
				expect(validators.url('http://localhost:3000')).toBe(true);
				expect(validators.url('ftp://files.example.com')).toBe(true);
			});

			it('should return error message for invalid URLs', () => {
				expect(validators.url('not-a-url')).toBe('Please enter a valid URL.');
				expect(validators.url('invalid-protocol')).toBe(
					'Please enter a valid URL.'
				);
			});
		});

		describe('number', () => {
			it('should return true for valid numbers', () => {
				expect(validators.number('123')).toBe(true);
				expect(validators.number('123.45')).toBe(true);
				expect(validators.number('-123')).toBe(true);
			});

			it('should return error message for non-numbers', () => {
				expect(validators.number('abc')).toBe('Please enter a valid number.');
				expect(validators.number('12a')).toBe('Please enter a valid number.');
			});
		});

		describe('positiveInteger', () => {
			it('should return true for positive integers', () => {
				expect(validators.positiveInteger('1')).toBe(true);
				expect(validators.positiveInteger('123')).toBe(true);
			});

			it('should return error message for non-positive integers', () => {
				expect(validators.positiveInteger('0')).toBe(
					'Please enter a positive integer.'
				);
				expect(validators.positiveInteger('-1')).toBe(
					'Please enter a positive integer.'
				);
				expect(validators.positiveInteger('1.5')).toBe(
					'Please enter a positive integer.'
				);
				expect(validators.positiveInteger('abc')).toBe(
					'Please enter a positive integer.'
				);
			});
		});

		describe('combine', () => {
			it('should return true when all validators pass', () => {
				const combinedValidator = validators.combine(
					validators.required,
					validators.minLength(3)
				);
				expect(combinedValidator('test')).toBe(true);
			});

			it('should return first error message when any validator fails', () => {
				const combinedValidator = validators.combine(
					validators.required,
					validators.minLength(3)
				);
				expect(combinedValidator('')).toBe('This field is required.');
				expect(combinedValidator('ab')).toBe(
					'Must be at least 3 characters long.'
				);
			});
		});
	});

	describe('promptConfigs', () => {
		describe('textInput', () => {
			it('should create a text input prompt configuration', () => {
				const config = promptConfigs.textInput('testName', 'Test Message');

				expect(config.type).toBe('input');
				expect(config.name).toBe('testName');
				expect(config.message).toBe('Test Message:');
				expect(config.validate).toBe(validators.required);
			});

			it('should accept custom options', () => {
				const customValidator = () => true;
				const config = promptConfigs.textInput('testName', 'Test Message', {
					validate: customValidator,
					default: 'default-value'
				});

				expect(config.validate).toBe(customValidator);
				expect(config.default).toBe('default-value');
			});
		});

		describe('confirm', () => {
			it('should create a confirmation prompt configuration', () => {
				const config = promptConfigs.confirm('testName', 'Test Message');

				expect(config.type).toBe('confirm');
				expect(config.name).toBe('testName');
				expect(config.message).toBe('Test Message?');
				expect(config.default).toBe(false);
			});
		});

		describe('list', () => {
			it('should create a list prompt configuration', () => {
				const choices = ['Option 1', 'Option 2'];
				const config = promptConfigs.list('testName', 'Test Message', choices);

				expect(config.type).toBe('list');
				expect(config.name).toBe('testName');
				expect(config.message).toBe('Test Message:');
				expect(config.choices).toEqual([
					{ name: 'Option 1', value: 'Option 1' },
					{ name: 'Option 2', value: 'Option 2' }
				]);
			});

			it('should handle choice objects', () => {
				const choices = [
					{ name: 'Display Name', value: 'actual-value' },
					'Simple Option'
				];
				const config = promptConfigs.list('testName', 'Test Message', choices);

				expect(config.choices).toEqual([
					{ name: 'Display Name', value: 'actual-value' },
					{ name: 'Simple Option', value: 'Simple Option' }
				]);
			});
		});

		describe('checkbox', () => {
			it('should create a checkbox prompt configuration', () => {
				const choices = ['Option 1', 'Option 2'];
				const config = promptConfigs.checkbox(
					'testName',
					'Test Message',
					choices
				);

				expect(config.type).toBe('checkbox');
				expect(config.name).toBe('testName');
				expect(config.message).toBe('Test Message:');
				expect(config.choices).toEqual([
					{ name: 'Option 1', value: 'Option 1' },
					{ name: 'Option 2', value: 'Option 2' }
				]);
			});

			it('should validate required selections', () => {
				const config = promptConfigs.checkbox(
					'testName',
					'Test Message',
					['Option 1'],
					{
						required: true
					}
				);

				expect(config.validate([])).toBe('Please select at least one option.');
				expect(config.validate(['Option 1'])).toBe(true);
			});
		});
	});

	describe('messages', () => {
		it('should display success messages', () => {
			messages.success('Test success');
			expect(console.log).toHaveBeenCalledWith('✓ Test success');
		});

		it('should display error messages', () => {
			messages.error('Test error');
			expect(console.log).toHaveBeenCalledWith('✗ Test error');
		});

		it('should display warning messages', () => {
			messages.warning('Test warning');
			expect(console.log).toHaveBeenCalledWith('⚠ Test warning');
		});

		it('should display info messages', () => {
			messages.info('Test info');
			expect(console.log).toHaveBeenCalledWith('ℹ Test info');
		});

		it('should display headers', () => {
			messages.header('Test Header');
			expect(console.log).toHaveBeenCalledWith('Test Header');
			expect(console.log).toHaveBeenCalledWith('───────────');
		});
	});
});
