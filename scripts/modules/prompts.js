/**
 * prompts.js
 * Centralized prompt utility functions for consistent interactive CLI experiences
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import boxen from 'boxen';

/**
 * Common validation functions
 */
export const validators = {
	/**
	 * Validates that input is not empty
	 */
	required: (input) => {
		if (!input || input.trim().length === 0) {
			return 'This field is required.';
		}
		return true;
	},

	/**
	 * Validates minimum length
	 */
	minLength: (min) => (input) => {
		if (!input || input.length < min) {
			return `Must be at least ${min} characters long.`;
		}
		return true;
	},

	/**
	 * Validates maximum length
	 */
	maxLength: (max) => (input) => {
		if (input && input.length > max) {
			return `Must be no more than ${max} characters long.`;
		}
		return true;
	},

	/**
	 * Validates alphanumeric with hyphens and underscores (for names/IDs)
	 */
	alphanumericWithHyphens: (input) => {
		if (!/^[a-zA-Z0-9_-]+$/.test(input)) {
			return 'Only letters, numbers, hyphens, and underscores are allowed.';
		}
		return true;
	},

	/**
	 * Validates email format
	 */
	email: (input) => {
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(input)) {
			return 'Please enter a valid email address.';
		}
		return true;
	},

	/**
	 * Validates URL format
	 */
	url: (input) => {
		try {
			new URL(input);
			return true;
		} catch {
			return 'Please enter a valid URL.';
		}
	},

	/**
	 * Validates that input is a number
	 */
	number: (input) => {
		if (isNaN(Number(input))) {
			return 'Please enter a valid number.';
		}
		return true;
	},

	/**
	 * Validates that input is a positive integer
	 */
	positiveInteger: (input) => {
		const num = Number(input);
		if (isNaN(num) || num <= 0 || !Number.isInteger(num)) {
			return 'Please enter a positive integer.';
		}
		return true;
	},

	/**
	 * Combines multiple validators
	 */
	combine:
		(...validators) =>
		(input) => {
			for (const validator of validators) {
				const result = validator(input);
				if (result !== true) {
					return result;
				}
			}
			return true;
		}
};

/**
 * Common prompt configurations with consistent styling
 */
export const promptConfigs = {
	/**
	 * Standard text input with validation
	 */
	textInput: (name, message, options = {}) => ({
		type: 'input',
		name,
		message: chalk.cyan(`${message}:`),
		validate: options.validate || validators.required,
		default: options.default,
		when: options.when
	}),

	/**
	 * Password input (hidden)
	 */
	password: (name, message, options = {}) => ({
		type: 'password',
		name,
		message: chalk.cyan(`${message}:`),
		validate: options.validate || validators.required,
		when: options.when
	}),

	/**
	 * Confirmation prompt
	 */
	confirm: (name, message, options = {}) => ({
		type: 'confirm',
		name,
		message: chalk.yellow(`${message}?`),
		default: options.default !== undefined ? options.default : false,
		when: options.when
	}),

	/**
	 * List selection prompt
	 */
	list: (name, message, choices, options = {}) => ({
		type: 'list',
		name,
		message: chalk.cyan(`${message}:`),
		choices: choices.map((choice) => {
			if (typeof choice === 'string') {
				return { name: choice, value: choice };
			}
			return choice;
		}),
		default: options.default,
		when: options.when
	}),

	/**
	 * Multi-select checkbox prompt
	 */
	checkbox: (name, message, choices, options = {}) => ({
		type: 'checkbox',
		name,
		message: chalk.cyan(`${message}:`),
		choices: choices.map((choice) => {
			if (typeof choice === 'string') {
				return { name: choice, value: choice };
			}
			return choice;
		}),
		validate:
			options.validate ||
			((input) => {
				if (options.required && input.length === 0) {
					return 'Please select at least one option.';
				}
				return true;
			}),
		when: options.when
	}),

	/**
	 * Editor prompt for multi-line input
	 */
	editor: (name, message, options = {}) => ({
		type: 'editor',
		name,
		message: chalk.cyan(`${message}:`),
		validate: options.validate,
		when: options.when
	})
};

/**
 * High-level prompt functions for common use cases
 */
export const prompts = {
	/**
	 * Ask for confirmation with consistent styling
	 */
	confirm: async (message, defaultValue = false) => {
		const { confirmed } = await inquirer.prompt([
			promptConfigs.confirm('confirmed', message, { default: defaultValue })
		]);
		return confirmed;
	},

	/**
	 * Ask for text input with validation
	 */
	text: async (message, options = {}) => {
		const { value } = await inquirer.prompt([
			promptConfigs.textInput('value', message, options)
		]);
		return value;
	},

	/**
	 * Ask for password input
	 */
	password: async (message, options = {}) => {
		const { value } = await inquirer.prompt([
			promptConfigs.password('value', message, options)
		]);
		return value;
	},

	/**
	 * Ask user to select from a list
	 */
	select: async (message, choices, defaultValue) => {
		const { value } = await inquirer.prompt([
			promptConfigs.list('value', message, choices, { default: defaultValue })
		]);
		return value;
	},

	/**
	 * Ask user to select multiple items
	 */
	multiSelect: async (message, choices, options = {}) => {
		const { values } = await inquirer.prompt([
			promptConfigs.checkbox('values', message, choices, options)
		]);
		return values;
	},

	/**
	 * Ask for multi-line input using editor
	 */
	editor: async (message, options = {}) => {
		const { value } = await inquirer.prompt([
			promptConfigs.editor('value', message, options)
		]);
		return value;
	},

	/**
	 * Present a series of prompts and return all answers
	 */
	series: async (promptConfigs) => {
		return await inquirer.prompt(promptConfigs);
	}
};

/**
 * Display styled messages and notifications
 */
export const messages = {
	/**
	 * Display a success message
	 */
	success: (message) => {
		console.log(chalk.green(`✓ ${message}`));
	},

	/**
	 * Display an error message
	 */
	error: (message) => {
		console.log(chalk.red(`✗ ${message}`));
	},

	/**
	 * Display a warning message
	 */
	warning: (message) => {
		console.log(chalk.yellow(`⚠ ${message}`));
	},

	/**
	 * Display an info message
	 */
	info: (message) => {
		console.log(chalk.blue(`ℹ ${message}`));
	},

	/**
	 * Display a boxed message with custom styling
	 */
	box: (message, options = {}) => {
		const {
			borderColor = 'cyan',
			borderStyle = 'round',
			padding = 1,
			margin = 1,
			title
		} = options;

		console.log(
			boxen(message, {
				borderColor,
				borderStyle,
				padding,
				margin,
				title
			})
		);
	},

	/**
	 * Display a header with separator
	 */
	header: (title) => {
		console.log();
		console.log(chalk.bold.cyan(title));
		console.log(chalk.cyan('─'.repeat(title.length)));
		console.log();
	},

	/**
	 * Display a separator line
	 */
	separator: () => {
		console.log(chalk.gray('─'.repeat(50)));
	}
};

/**
 * Specialized prompt functions for common TaskMaster use cases
 */
export const taskMasterPrompts = {
	/**
	 * Prompt for task ID with validation
	 */
	taskId: async (message = 'Enter task ID') => {
		return await prompts.text(message, {
			validate: validators.combine(
				validators.required,
				validators.alphanumericWithHyphens
			)
		});
	},

	/**
	 * Prompt for task title
	 */
	taskTitle: async (message = 'Enter task title') => {
		return await prompts.text(message, {
			validate: validators.combine(
				validators.required,
				validators.maxLength(100)
			)
		});
	},

	/**
	 * Prompt for task description
	 */
	taskDescription: async (message = 'Enter task description') => {
		return await prompts.text(message, {
			validate: validators.maxLength(500)
		});
	},

	/**
	 * Prompt for model selection
	 */
	modelSelection: async (message, models, allowCancel = false) => {
		const choices = [...models];
		if (allowCancel) {
			choices.push({ name: chalk.gray('Cancel'), value: '__CANCEL__' });
		}

		return await prompts.select(message, choices);
	},

	/**
	 * Prompt for API key with validation
	 */
	apiKey: async (provider) => {
		return await prompts.password(`Enter ${provider} API key`, {
			validate: validators.required
		});
	},

	/**
	 * Prompt for project configuration
	 */
	projectConfig: async () => {
		return await prompts.series([
			promptConfigs.textInput('projectName', 'Project name', {
				validate: validators.combine(
					validators.required,
					validators.alphanumericWithHyphens
				)
			}),
			promptConfigs.textInput('description', 'Project description', {
				validate: validators.maxLength(200)
			})
		]);
	}
};

export default {
	validators,
	promptConfigs,
	prompts,
	messages,
	taskMasterPrompts
};
