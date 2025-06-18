#!/usr/bin/env node

import { execSync } from 'child_process';
import chalk from 'chalk';

const command = process.argv[2] || 'help';

function runCommand(cmd, options = {}) {
	try {
		return execSync(cmd, {
			stdio: options.silent ? 'pipe' : 'inherit',
			encoding: 'utf8'
		});
	} catch (error) {
		console.error(chalk.red(`Error running command: ${cmd}`));
		console.error(chalk.red(error.message));
		process.exit(1);
	}
}

function showConfig() {
	console.log(chalk.blue('\n📝 Claude Code MCP Configuration:'));
	console.log(chalk.cyan('   Server Name: taskmaster'));
	console.log(chalk.cyan('   Transport: sse'));
	console.log(chalk.cyan('   URL: http://localhost:3350'));
}

switch (command) {
	case 'start':
		console.log(chalk.blue('🐳 Starting TaskMaster MCP Server in Docker...'));
		runCommand('docker compose -f docker-compose.mcp.yml up -d');
		console.log(chalk.green('✅ MCP Server started on http://localhost:3350'));
		showConfig();
		break;

	case 'stop':
		console.log(chalk.yellow('🛑 Stopping TaskMaster MCP Server...'));
		runCommand('docker compose -f docker-compose.mcp.yml down');
		console.log(chalk.green('✅ MCP Server stopped'));
		break;

	case 'restart':
		console.log(chalk.blue('🔄 Restarting TaskMaster MCP Server...'));
		runCommand('docker compose -f docker-compose.mcp.yml down');
		runCommand('docker compose -f docker-compose.mcp.yml up -d');
		console.log(
			chalk.green('✅ MCP Server restarted on http://localhost:3350')
		);
		showConfig();
		break;

	case 'logs':
		console.log(chalk.blue('📋 TaskMaster MCP Server logs:'));
		runCommand('docker compose -f docker-compose.mcp.yml logs -f');
		break;

	case 'build':
		console.log(chalk.blue('🔨 Building TaskMaster MCP Server image...'));
		runCommand('docker compose -f docker-compose.mcp.yml build');
		console.log(chalk.green('✅ Build complete'));
		break;

	case 'status':
		console.log(chalk.blue('📊 TaskMaster MCP Server status:'));
		runCommand('docker compose -f docker-compose.mcp.yml ps');
		break;

	case 'help':
	default:
		console.log(chalk.bold('TaskMaster MCP Server Docker Management\n'));
		console.log(chalk.cyan('Usage:'), 'node scripts/docker-mcp.js [command]\n');
		console.log(chalk.yellow('Commands:'));
		console.log('  start    - Start the MCP server');
		console.log('  stop     - Stop the MCP server');
		console.log('  restart  - Restart the MCP server');
		console.log('  logs     - View server logs');
		console.log('  build    - Build the Docker image');
		console.log('  status   - Show server status');
		console.log('  help     - Show this help message');
		showConfig();
		break;
}
