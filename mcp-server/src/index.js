import { FastMCP } from 'fastmcp';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import fs from 'fs';
import logger from './logger.js';
import { registerTaskMasterTools } from './tools/index.js';
import {
	initializeEventSystem,
	registerIntegration
} from '../../scripts/modules/events/index.js';
import { LinearIntegrationHandler } from '../../scripts/modules/integrations/linear-integration-handler.js';

// Load environment variables
dotenv.config();

// Constants
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Main MCP server class that integrates with Task Master
 */
class TaskMasterMCPServer {
	constructor() {
		// Get version from package.json using synchronous fs
		const packagePath = path.join(__dirname, '../../package.json');
		const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

		this.options = {
			name: 'Task Master MCP Server',
			version: packageJson.version
		};

		this.server = new FastMCP(this.options);
		this.initialized = false;

		this.server.addResource({});

		this.server.addResourceTemplate({});

		// Bind methods
		this.init = this.init.bind(this);
		this.start = this.start.bind(this);
		this.stop = this.stop.bind(this);

		// Setup logging
		this.logger = logger;
	}

	/**
	 * Initialize the MCP server with necessary tools and routes
	 */
	async init() {
		if (this.initialized) return;

		try {
			// Initialize the event system for integrations
			this.logger.info('Initializing TaskMaster event system...');
			await initializeEventSystem({
				enableErrorBoundaries: true,
				enableCircuitBreakers: true,
				enableHealthMonitoring: true,
				enableAutoRecovery: true
			});
			this.logger.info('Event system initialized successfully');

			// Register Linear integration if API key is available
			const linearApiKey = process.env.LINEAR_API_KEY;
			if (linearApiKey) {
				this.logger.info('Registering Linear integration...');
				const linearIntegration = new LinearIntegrationHandler({
					apiKey: linearApiKey,
					teamId: process.env.LINEAR_TEAM_ID,
					defaultProjectId: process.env.LINEAR_PROJECT_ID,
					createIssues: process.env.LINEAR_CREATE_ISSUES !== 'false'
				});

				registerIntegration(linearIntegration);
				this.logger.info('Linear integration registered successfully');
			} else {
				this.logger.info(
					'Linear API key not found - Linear integration disabled'
				);
			}

			// Pass the manager instance to the tool registration function
			registerTaskMasterTools(this.server, this.asyncManager);

			this.initialized = true;
		} catch (error) {
			this.logger.error('Failed to initialize MCP server:', error.message);
			throw error;
		}

		return this;
	}

	/**
	 * Start the MCP server
	 */
	async start() {
		if (!this.initialized) {
			await this.init();
		}

		// Determine transport type and configuration based on environment
		const transportType = process.env.MCP_TRANSPORT || 'stdio';
		const validTransports = ['stdio', 'tcp'];
		if (!validTransports.includes(transportType)) {
			this.logger.error(
				`Invalid transport type: ${transportType}. Valid options: ${validTransports.join(', ')}`
			);
			throw new Error(`Invalid MCP_TRANSPORT: ${transportType}`);
		}
		const port = process.env.MCP_PORT || 3000;

		let serverConfig = {
			timeout: 120000 // 2 minutes timeout (in milliseconds)
		};

		if (transportType === 'tcp') {
			const parsedPort = parseInt(port);
			if (Number.isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
				throw new Error(`Invalid port number: ${port}`);
			}

			serverConfig = {
				...serverConfig,
				transportType: 'httpStream',
				httpStream: {
					port: parsedPort
				}
			};
			this.logger.info(
				`Starting MCP server with HTTP Stream transport on port ${port}`
			);
		} else {
			serverConfig = {
				...serverConfig,
				transportType: 'stdio'
			};
			this.logger.info('Starting MCP server with stdio transport');
		}

		// Start the FastMCP server
		await this.server.start(serverConfig);

		return this;
	}

	/**
	 * Stop the MCP server
	 */
	async stop() {
		if (this.server) {
			await this.server.stop();
		}
	}
}

export default TaskMasterMCPServer;
