# Integration Hooks Implementation Guide

This document explains how to add event hooks to TaskMaster commands to enable integration with external systems like Linear, Slack, GitHub, etc.

## Overview

The TaskMaster integration system is event-driven and allows external integrations to respond to task lifecycle events automatically. This guide demonstrates how to add integration hooks to any TaskMaster command using the `addTask` command as a reference implementation.

## Architecture

### Core Components

1. **Integration Manager** (`scripts/modules/events/integration-manager.js`)
   - Central coordinator for all integrations
   - Handles event emission, routing, and error management
   - Provides circuit breakers, health monitoring, and recovery

2. **Base Integration Handler** (`scripts/modules/events/base-integration-handler.js`)
   - Abstract base class for all integrations
   - Provides common functionality like retry logic and lifecycle management

3. **Event Types** (`scripts/modules/events/types.js`)
   - Defines all available event types and payload structures
   - Includes validation functions for event payloads

4. **Global Event System** (`scripts/modules/events/index.js`)
   - Provides convenience functions for event emission and management
   - Manages the global integration manager instance

## Implementation Steps

### Step 1: Import Event System Components

Add the necessary imports to your command file:

```javascript
import { emitEvent, EVENT_TYPES, createOperationContext } from '../events/index.js';
```

### Step 2: Identify Event Emission Points

Determine where in your command you want to emit events. Common patterns:

- **Before operation**: For validation or preprocessing integrations
- **After successful operation**: For notifications and external system updates
- **On failure**: For error tracking and alerting

### Step 3: Emit Events with Proper Context

Here's the pattern used in `addTask` as a reference:

```javascript
// After successful task creation
try {
    const operationContext = createOperationContext(
        projectRoot,           // Project root directory
        session,              // Session object with user info
        isMCP ? 'mcp' : 'cli', // Source of the operation
        {
            commandName: commandName || 'your-command-name',
            outputType: outputType || (isMCP ? 'mcp' : 'cli')
        }
    );

    await emitEvent(EVENT_TYPES.TASK_CREATED, {
        taskId: newTaskId.toString(),
        task: newTask,
        tag: currentTag
    }, operationContext);

    report('DEBUG: Event emitted successfully.', 'debug');
} catch (eventError) {
    // Don't fail the command if event emission fails
    report(`DEBUG: Failed to emit event: ${eventError.message}`, 'warn');
}
```

### Step 4: Handle Different Command Types

#### For Task Modification Commands

```javascript
// Task update example
await emitEvent(EVENT_TYPES.TASK_UPDATED, {
    taskId: taskId.toString(),
    task: updatedTask,
    changes: changedFields,
    oldValues: previousValues,
    tag: currentTag
}, operationContext);
```

#### For Status Change Commands

```javascript
// Status change example  
await emitEvent(EVENT_TYPES.TASK_STATUS_CHANGED, {
    taskId: taskId.toString(),
    task: updatedTask,
    oldStatus: previousStatus,
    newStatus: newStatus,
    tag: currentTag
}, operationContext);
```

#### For Bulk Operations

```javascript
// Bulk operation example
await emitEvent(EVENT_TYPES.TASKS_BULK_UPDATED, {
    taskIds: affectedTaskIds,
    tasks: updatedTasks,
    operation: 'bulk_status_change',
    changes: { status: newStatus },
    tag: currentTag
}, operationContext);
```

## Available Event Types

### Task Lifecycle Events
- `TASK_CREATED` - New task created
- `TASK_UPDATED` - Task modified (title, description, details, etc.)
- `TASK_STATUS_CHANGED` - Task status changed
- `TASK_REMOVED` - Task deleted

### Subtask Events
- `SUBTASK_CREATED` - New subtask added
- `SUBTASK_UPDATED` - Subtask modified
- `SUBTASK_STATUS_CHANGED` - Subtask status changed
- `SUBTASK_REMOVED` - Subtask deleted

### Dependency Events
- `DEPENDENCY_ADDED` - New dependency added
- `DEPENDENCY_REMOVED` - Dependency removed
- `DEPENDENCIES_SATISFIED` - All dependencies completed

### Bulk Operations
- `TASKS_BULK_CREATED` - Multiple tasks created
- `TASKS_BULK_UPDATED` - Multiple tasks updated
- `TASKS_BULK_STATUS_CHANGED` - Multiple task statuses changed

### Tag Events
- `TAG_CREATED` - New tag created
- `TAG_SWITCHED` - Active tag changed
- `TAG_DELETED` - Tag deleted

## Error Handling Best Practices

### 1. Never Fail the Command

Event emission should never cause the main command to fail:

```javascript
try {
    await emitEvent(eventType, data, context);
} catch (eventError) {
    // Log the error but continue command execution
    report(`Failed to emit ${eventType} event: ${eventError.message}`, 'warn');
}
```

### 2. Provide Meaningful Context

Include enough context for integrations to make decisions:

```javascript
const operationContext = createOperationContext(
    projectRoot,
    session,
    source,
    {
        commandName: 'specific-command',
        outputType: 'mcp',
        originalRequest: requestData, // Optional: original request data
        user: session?.user || 'anonymous'
    }
);
```

### 3. Use Appropriate Log Levels

- `debug` for successful emissions
- `warn` for emission failures
- `error` for critical integration issues (rare)

## Integration System Initialization

### MCP Server Integration

The integration system is initialized in the MCP server startup (`mcp-server/src/index.js`):

```javascript
// Initialize event system
await initializeEventSystem({
    enableErrorBoundaries: true,
    enableCircuitBreakers: true,
    enableHealthMonitoring: true,
    enableAutoRecovery: true
});

// Register integrations based on environment
if (process.env.LINEAR_API_KEY) {
    const linearIntegration = new LinearIntegrationHandler({
        apiKey: process.env.LINEAR_API_KEY,
        teamId: process.env.LINEAR_TEAM_ID,
        defaultProjectId: process.env.LINEAR_PROJECT_ID,
        createIssues: process.env.LINEAR_CREATE_ISSUES !== 'false'
    });
    registerIntegration(linearIntegration);
}
```

### CLI Integration

For CLI commands, the integration system can be initialized on-demand:

```javascript
import { getEventManager } from '../events/index.js';

// Check if integrations are configured
const eventManager = getEventManager();
if (eventManager.initialized) {
    // Emit events normally
    await emitEvent(eventType, data, context);
}
```

## Creating New Integrations

### 1. Extend BaseIntegrationHandler

```javascript
import { BaseIntegrationHandler } from '../events/base-integration-handler.js';

export class MyIntegrationHandler extends BaseIntegrationHandler {
    constructor(config = {}) {
        super('my-integration', '1.0.0', config);
    }

    async _performInitialization(config) {
        // Initialize your integration (API clients, etc.)
    }

    async _performShutdown() {
        // Clean up resources
    }

    async handleTaskCreated(payload) {
        // Handle task creation events
        const { task, tag, context } = payload;
        // Your integration logic here
    }

    async handleTaskStatusChanged(payload) {
        // Handle status change events
        const { task, oldStatus, newStatus } = payload;
        // Your integration logic here
    }
}
```

### 2. Register the Integration

```javascript
import { registerIntegration } from '../events/index.js';
import { MyIntegrationHandler } from './my-integration-handler.js';

const integration = new MyIntegrationHandler({
    // Configuration options
});

registerIntegration(integration);
```

## Command Integration Checklist

When adding integration hooks to a command:

- [ ] Import event system components
- [ ] Identify appropriate event emission points
- [ ] Use proper event types for the operation
- [ ] Create meaningful operation context
- [ ] Include all relevant data in event payload
- [ ] Wrap emission in try-catch block
- [ ] Use appropriate log levels
- [ ] Test with integration disabled (should work normally)
- [ ] Test with integration enabled (should emit events)
- [ ] Document any new event types needed

## Example: Adding Hooks to setTaskStatus Command

```javascript
// In set-task-status.js
import { emitEvent, EVENT_TYPES, createOperationContext } from '../events/index.js';

// After successfully updating task status
try {
    const operationContext = createOperationContext(
        projectRoot,
        session,
        isMCP ? 'mcp' : 'cli',
        {
            commandName: 'set-task-status',
            outputType: outputType || (isMCP ? 'mcp' : 'cli')
        }
    );

    await emitEvent(EVENT_TYPES.TASK_STATUS_CHANGED, {
        taskId: taskId.toString(),
        task: updatedTask,
        oldStatus: previousStatus,
        newStatus: newStatus,
        tag: currentTag
    }, operationContext);

    log.debug('Status change event emitted successfully');
} catch (eventError) {
    log.warn(`Failed to emit status change event: ${eventError.message}`);
}
```

## Linear Integration Example

The Linear integration handler demonstrates a complete integration:

- **Initialization**: Connects to Linear API, validates credentials
- **Task Creation**: Creates Linear issues from TaskMaster tasks
- **Status Sync**: Updates Linear issue states when task status changes
- **Error Handling**: Graceful handling of API failures
- **Configuration**: Environment-based configuration

See `scripts/modules/integrations/linear-integration-handler.js` for the complete implementation.

## Debugging Integration Issues

### 1. Check Integration Status

```javascript
import { getEventSystemStats, getIntegrationStatus } from '../events/index.js';

const stats = getEventSystemStats();
const status = getIntegrationStatus();

console.log('Event system stats:', stats);
console.log('Integration status:', status);
```

### 2. Enable Debug Logging

Set the log level to debug to see all event emissions:

```bash
export TASKMASTER_LOG_LEVEL=debug
```

### 3. Test Integration Handler Directly

```javascript
const handler = new LinearIntegrationHandler(config);
await handler.initialize();

const testPayload = {
    taskId: '1',
    task: { id: 1, title: 'Test Task' },
    tag: 'master',
    context: { source: 'test' }
};

const result = await handler.handleTaskCreated(testPayload);
console.log('Handler result:', result);
```

## Performance Considerations

1. **Async Event Emission**: Events are emitted asynchronously and don't block command execution
2. **Circuit Breakers**: Failed integrations are automatically disabled temporarily
3. **Batching**: Bulk operations can be batched to reduce API calls
4. **Error Boundaries**: Integration failures don't affect core functionality
5. **Health Monitoring**: System health is continuously monitored

## Future Enhancements

Planned improvements to the integration system:

- **Webhook Support**: Incoming webhooks from external systems
- **Bidirectional Sync**: Two-way synchronization with external systems
- **Custom Event Types**: User-defined event types for specialized workflows
- **Integration Marketplace**: Plugin system for community integrations
- **Real-time Notifications**: WebSocket-based real-time event streaming