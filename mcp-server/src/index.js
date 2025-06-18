import { FastMCP } from 'fastmcp';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import fs from 'fs';
import logger from './logger.js';
import { registerTaskMasterTools } from './tools/index.js';

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

		// Pass the manager instance to the tool registration function
		registerTaskMasterTools(this.server, this.asyncManager);

		this.initialized = true;

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
		const port = process.env.MCP_PORT || 3000;

		let serverConfig = {
			timeout: 120000 // 2 minutes timeout (in milliseconds)
		};

		if (transportType === 'tcp') {
			serverConfig = {
				...serverConfig,
				transportType: 'httpStream',
				httpStream: {
					port: parseInt(port)
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
