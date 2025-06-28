/**
 * @fileoverview Simple integration tests for Linear state mapping refresh mechanism
 * Tests the state mapping refresh functionality implemented in Task 6.8
 */

import { jest } from '@jest/globals';

describe('Linear State Mapping Refresh - Task 6.8 - Integration Tests', () => {
	test('should export required functions from linear-status-mapping-manager', async () => {
		const module = await import(
			'../../scripts/modules/linear-status-mapping-manager.js'
		);

		expect(module.refreshWorkflowStatesCache).toBeDefined();
		expect(typeof module.refreshWorkflowStatesCache).toBe('function');

		expect(module.detectMappingRefreshNeeds).toBeDefined();
		expect(typeof module.detectMappingRefreshNeeds).toBe('function');

		expect(module.getCurrentMappingConfiguration).toBeDefined();
		expect(typeof module.getCurrentMappingConfiguration).toBe('function');
	});

	test('should export MCP tool correctly', async () => {
		const module = await import(
			'../../mcp-server/src/tools/refresh-linear-mappings.js'
		);

		expect(module.refreshLinearMappingsTool).toBeDefined();
		expect(module.refreshLinearMappingsTool.name).toBe(
			'refresh_linear_mappings'
		);
		expect(module.refreshLinearMappingsTool.description).toBeDefined();
		expect(module.refreshLinearMappingsTool.inputSchema).toBeDefined();

		expect(module.handleRefreshLinearMappings).toBeDefined();
		expect(typeof module.handleRefreshLinearMappings).toBe('function');

		expect(module.registerRefreshLinearMappingsTool).toBeDefined();
		expect(typeof module.registerRefreshLinearMappingsTool).toBe('function');
	});

	test('should handle missing configuration gracefully', async () => {
		const { refreshWorkflowStatesCache } = await import(
			'../../scripts/modules/linear-status-mapping-manager.js'
		);

		// Test with missing team ID
		const result = await refreshWorkflowStatesCache({
			projectRoot: '/app',
			teamId: null
		});

		expect(result.success).toBe(false);
		expect(result.error).toContain('Linear team ID not configured');
	});

	test('should handle MCP tool unknown operation', async () => {
		const { handleRefreshLinearMappings } = await import(
			'../../mcp-server/src/tools/refresh-linear-mappings.js'
		);

		const result = await handleRefreshLinearMappings({
			operation: 'unknown'
		});

		expect(result.success).toBe(false);
		expect(result.error).toContain('Unknown operation: unknown');
	});

	test('should validate input schema structure', async () => {
		const { refreshLinearMappingsTool } = await import(
			'../../mcp-server/src/tools/refresh-linear-mappings.js'
		);

		const schema = refreshLinearMappingsTool.inputSchema;
		expect(schema.type).toBe('object');
		expect(schema.properties).toBeDefined();
		expect(schema.properties.operation).toBeDefined();
		expect(schema.properties.operation.enum).toEqual([
			'detect',
			'refresh',
			'validate'
		]);
		expect(schema.properties.projectRoot).toBeDefined();
		expect(schema.properties.teamId).toBeDefined();
		expect(schema.properties.forceRefresh).toBeDefined();
		expect(schema.properties.updateMappings).toBeDefined();
		expect(schema.properties.cacheMaxAge).toBeDefined();
	});

	test('should be registered in MCP tools index', async () => {
		const content = await import('fs').then((fs) =>
			fs.promises.readFile(
				'/Users/blank/projects/claude-task-master-linear/mcp-server/src/tools/index.js',
				'utf8'
			)
		);

		expect(content).toContain('registerRefreshLinearMappingsTool');
		expect(content).toContain('refresh-linear-mappings.js');
		expect(content).toContain('// Group 9: Linear Integration');
	});
});
