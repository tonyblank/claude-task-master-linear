# Event Payload Standardization

This document describes the standardized event payload system implemented in TaskMaster v1.0.0, providing consistent, validated, and versioned event structures across all integrations.

## Overview

The event payload standardization system provides:

- **Schema-based validation** using Zod for type safety
- **Serialization/deserialization** with multiple format support
- **Backward compatibility** with legacy payload formats
- **Versioning strategy** for schema evolution
- **Comprehensive documentation** of all event types

## Schema Version

Current schema version: **1.0.0**

## Base Event Structure

All events follow a standardized base structure:

```typescript
interface BaseEventPayload {
  version: string;           // Schema version (e.g., "1.0.0")
  eventId: string;          // Unique event identifier
  timestamp: string;        // ISO timestamp when event occurred
  context: OperationContext; // Operation context information
  metadata?: Record<string, any>; // Additional metadata (optional)
}
```

### Operation Context

The context object provides information about the operation that triggered the event:

```typescript
interface OperationContext {
  projectRoot: string;      // Project root directory path
  session: object;          // Session information object
  source: 'cli' | 'mcp' | 'api' | 'webhook'; // Source of the operation
  requestId?: string;       // Request identifier for tracing
  user?: string;           // User identifier
  commandName?: string;    // Command that triggered the event
  outputType?: string;     // Output type for the operation
}
```

## Event Types and Schemas

### Task Events

#### Task Created (`task:created`)

Emitted when a new task is created.

```typescript
interface TaskCreatedPayload extends BaseEventPayload {
  taskId: string | number;    // ID of the created task
  task: Task;                 // The created task object
  tag: string;               // Tag context where task was created
  parentTaskId?: string | number; // Parent task ID if this is a subtask
}
```

#### Task Updated (`task:updated`)

Emitted when a task is modified.

```typescript
interface TaskUpdatedPayload extends BaseEventPayload {
  taskId: string | number;    // ID of the updated task
  task: Task;                 // The updated task object
  changes: Record<string, any>; // Fields that were changed
  oldValues: Record<string, any>; // Previous values of changed fields
  tag: string;               // Tag context
  changeType: 'field_update' | 'metadata_update' | 'bulk_update'; // Type of change
}
```

#### Task Status Changed (`task:status:changed`)

Emitted when a task's status changes.

```typescript
interface TaskStatusChangedPayload extends BaseEventPayload {
  taskId: string | number;    // ID of the task
  task: Task;                 // The task object
  oldStatus: TaskStatus;      // Previous status
  newStatus: TaskStatus;      // New status
  tag: string;               // Tag context
  reason?: string;           // Reason for status change
  triggeredBy?: string;      // What triggered the status change
}
```

#### Task Removed (`task:removed`)

Emitted when a task is deleted.

```typescript
interface TaskRemovedPayload extends BaseEventPayload {
  taskId: string | number;    // ID of the removed task
  task: Task;                 // The removed task object (snapshot before removal)
  tag: string;               // Tag context
  cascadeRemoved: (string | number)[]; // IDs of subtasks that were also removed
  removalType: 'user_initiated' | 'cascade_delete' | 'cleanup'; // Type of removal
}
```

### Subtask Events

#### Subtask Created (`subtask:created`)

```typescript
interface SubtaskCreatedPayload extends BaseEventPayload {
  parentTaskId: string | number; // ID of the parent task
  subtaskId: string | number;    // ID of the created subtask
  subtask: Subtask;              // The created subtask object
  parentTask: Task;              // The parent task object
  tag: string;                   // Tag context
}
```

#### Subtask Updated (`subtask:updated`)

```typescript
interface SubtaskUpdatedPayload extends BaseEventPayload {
  parentTaskId: string | number; // ID of the parent task
  subtaskId: string | number;    // ID of the updated subtask
  subtask: Subtask;              // The updated subtask object
  parentTask: Task;              // The parent task object
  changes: Record<string, any>;  // Fields that were changed
  oldValues: Record<string, any>; // Previous values
  tag: string;                   // Tag context
}
```

#### Subtask Status Changed (`subtask:status:changed`)

```typescript
interface SubtaskStatusChangedPayload extends BaseEventPayload {
  parentTaskId: string | number; // ID of the parent task
  subtaskId: string | number;    // ID of the subtask
  subtask: Subtask;              // The subtask object
  parentTask: Task;              // The parent task object
  oldStatus: TaskStatus;         // Previous status
  newStatus: TaskStatus;         // New status
  tag: string;                   // Tag context
}
```

#### Subtask Removed (`subtask:removed`)

```typescript
interface SubtaskRemovedPayload extends BaseEventPayload {
  parentTaskId: string | number; // ID of the parent task
  subtaskId: string | number;    // ID of the removed subtask
  subtask: Subtask;              // The removed subtask object
  parentTask: Task;              // The parent task object
  tag: string;                   // Tag context
}
```

### Dependency Events

#### Dependency Added (`dependency:added`)

```typescript
interface DependencyAddedPayload extends BaseEventPayload {
  taskId: string | number;        // ID of the task that now depends on another
  dependsOnTaskId: string | number; // ID of the task being depended on
  task: Task;                     // The dependent task object
  dependsOnTask: Task;           // The task being depended on
  tag: string;                   // Tag context
}
```

#### Dependency Removed (`dependency:removed`)

```typescript
interface DependencyRemovedPayload extends BaseEventPayload {
  taskId: string | number;        // ID of the task that no longer depends on another
  dependsOnTaskId: string | number; // ID of the task no longer being depended on
  task: Task;                     // The formerly dependent task object
  dependsOnTask: Task;           // The task no longer being depended on
  tag: string;                   // Tag context
}
```

#### Dependencies Satisfied (`dependencies:satisfied`)

```typescript
interface DependenciesSatisfiedPayload extends BaseEventPayload {
  taskId: string | number;        // ID of the task whose dependencies are now satisfied
  task: Task;                     // The task object
  satisfiedDependencies: (string | number)[]; // IDs of dependencies that were satisfied
  tag: string;                   // Tag context
}
```

### Bulk Operation Events

#### Tasks Bulk Created (`tasks:bulk:created`)

```typescript
interface TasksBulkCreatedPayload extends BaseEventPayload {
  tasks: Task[];                 // Array of created tasks
  tag: string;                   // Tag context
  batchId: string;               // Unique identifier for this bulk operation
  totalCount: number;            // Total number of tasks in the bulk operation
  successCount: number;          // Number of successfully created tasks
  failureCount: number;          // Number of tasks that failed to create
  failures: BulkFailure[];       // Details of any failures
}
```

#### Tasks Bulk Updated (`tasks:bulk:updated`)

```typescript
interface TasksBulkUpdatedPayload extends BaseEventPayload {
  tasks: Task[];                 // Array of updated tasks
  changes: Record<string, any>;  // Common changes applied to all tasks
  tag: string;                   // Tag context
  batchId: string;               // Unique identifier for this bulk operation
  totalCount: number;            // Total number of tasks in the bulk operation
  successCount: number;          // Number of successfully updated tasks
  failureCount: number;          // Number of tasks that failed to update
}
```

#### Tasks Bulk Status Changed (`tasks:bulk:status:changed`)

```typescript
interface TasksBulkStatusChangedPayload extends BaseEventPayload {
  tasks: Task[];                 // Array of tasks with status changes
  oldStatus: TaskStatus;         // Previous status for all tasks
  newStatus: TaskStatus;         // New status for all tasks
  tag: string;                   // Tag context
  batchId: string;               // Unique identifier for this bulk operation
  totalCount: number;            // Total number of tasks in the bulk operation
  successCount: number;          // Number of successfully updated tasks
}
```

### Tag Events

#### Tag Created (`tag:created`)

```typescript
interface TagCreatedPayload extends BaseEventPayload {
  tagName: string;               // Name of the created tag
  description?: string;          // Tag description
  copiedFromTag?: string;        // Tag that was copied from, if any
  taskCount: number;             // Number of tasks in the new tag
}
```

#### Tag Switched (`tag:switched`)

```typescript
interface TagSwitchedPayload extends BaseEventPayload {
  fromTag: string;               // Previous active tag
  toTag: string;                 // New active tag
  fromTaskCount: number;         // Number of tasks in the previous tag
  toTaskCount: number;           // Number of tasks in the new tag
}
```

#### Tag Deleted (`tag:deleted`)

```typescript
interface TagDeletedPayload extends BaseEventPayload {
  tagName: string;               // Name of the deleted tag
  taskCount: number;             // Number of tasks that were in the deleted tag
  backupCreated: boolean;        // Whether a backup was created before deletion
}
```

### Integration Events

#### Integration Success (`integration:success`)

```typescript
interface IntegrationSuccessPayload extends BaseEventPayload {
  integrationName: string;       // Name of the integration
  operation: string;             // Operation that succeeded
  originalEvent: string;         // Original event type that triggered this integration
  result?: any;                  // Result data from the integration
  executionTime: number;         // Execution time in milliseconds
  retryCount: number;            // Number of retries before success
}
```

#### Integration Error (`integration:error`)

```typescript
interface IntegrationErrorPayload extends BaseEventPayload {
  integrationName: string;       // Name of the integration
  operation: string;             // Operation that failed
  originalEvent: string;         // Original event type that triggered this integration
  error: {                       // Error details
    message: string;             // Error message
    code?: string;               // Error code
    type?: string;               // Error type
    stack?: string;              // Stack trace (only in debug mode)
  };
  retryCount: number;            // Number of retries attempted
  willRetry: boolean;            // Whether this error will be retried
  executionTime: number;         // Execution time before failure in milliseconds
}
```

## Data Types

### Task

```typescript
interface Task {
  id: string | number;           // Task identifier
  title: string;                 // Task title
  description: string;           // Task description
  details?: string;              // Detailed implementation notes
  status: TaskStatus;            // Current task status
  priority: TaskPriority;        // Task priority
  dependencies: (string | number)[]; // Array of task IDs this task depends on
  subtasks: Subtask[];           // Array of subtasks
  testStrategy?: string;         // Testing strategy for the task
  linearIssueId?: string;        // Linear issue ID for integration
  externalIds?: Record<string, string>; // External system IDs
}
```

### Subtask

```typescript
interface Subtask {
  id: string | number;           // Subtask identifier
  title: string;                 // Subtask title
  description: string;           // Subtask description
  details?: string;              // Detailed implementation notes
  status: TaskStatus;            // Current subtask status
  dependencies: (string | number)[]; // Array of dependency IDs
  linearIssueId?: string;        // Linear issue ID for integration
  externalIds?: Record<string, string>; // External system IDs
}
```

### TaskStatus

```typescript
type TaskStatus = 'pending' | 'in-progress' | 'review' | 'done' | 'cancelled' | 'deferred';
```

### TaskPriority

```typescript
type TaskPriority = 'high' | 'medium' | 'low';
```

## Serialization and Validation

### Using the Serializer

```javascript
import { EventPayloadSerializer, SERIALIZATION_FORMATS } from './events/payload-serializer.js';

// Create serializer instance
const serializer = new EventPayloadSerializer({
  format: SERIALIZATION_FORMATS.JSON,
  validate: true,
  prettyPrint: true
});

// Serialize an event payload
const result = await serializer.serialize('task:created', payload);
if (result.success) {
  console.log('Serialized data:', result.data);
  console.log('Metadata:', result.metadata);
}

// Deserialize event payload
const deserializeResult = await serializer.deserialize(serializedData);
if (deserializeResult.success) {
  console.log('Deserialized payload:', deserializeResult.payload);
}
```

### Validation

```javascript
import { validateEventPayload } from './events/payload-serializer.js';

// Validate a payload against its schema
const validation = validateEventPayload('task:created', payload);
if (!validation.valid) {
  console.error('Validation errors:', validation.errors);
}
```

### Creating Standard Payloads

```javascript
import { createStandardEventPayload } from './events/payload-serializer.js';

// Create a standardized payload
const context = {
  projectRoot: '/path/to/project',
  session: { user: 'john_doe' },
  source: 'cli',
  requestId: 'req_123'
};

const payload = createStandardEventPayload('task:created', {
  taskId: '5',
  task: taskObject,
  tag: 'master'
}, context);
```

## Backward Compatibility

### Migration System

The system automatically migrates legacy payloads to the current schema version:

```javascript
import { migrateEventPayload, needsMigration } from './events/backward-compatibility.js';

// Check if migration is needed
if (needsMigration(oldPayload)) {
  const migration = migrateEventPayload(oldPayload);
  if (migration.success) {
    console.log('Migrated payload:', migration.payload);
  }
}
```

### Legacy Format Support

Legacy formats are automatically detected and migrated:

- **Pre-schema (v0.1.0)**: Original wrapped format `{ type: 'event:type', payload: {...} }`
- **Beta schema (v0.9.0)**: Partial schema support without version field
- **Current (v1.0.0)**: Full standardized schema with validation

### Creating Legacy-Compatible Payloads

For integrations that require legacy formats:

```javascript
import { createLegacyCompatiblePayload } from './events/backward-compatibility.js';

// Convert modern payload to legacy format
const legacyPayload = createLegacyCompatiblePayload(modernPayload, 'pre-schema');
```

## Versioning Strategy

### Schema Evolution

The versioning strategy follows semantic versioning:

- **Major version** (X.0.0): Breaking changes that require migration
- **Minor version** (X.Y.0): New optional fields or event types
- **Patch version** (X.Y.Z): Bug fixes and clarifications

### Migration Path

1. **Detect** payload version using `detectPayloadVersion()`
2. **Migrate** using appropriate migration strategy
3. **Validate** migrated payload against current schema
4. **Process** with modern event handlers

### Compatibility Matrix

| Legacy Version | Current Support | Migration Available | Notes |
|---------------|----------------|-------------------|-------|
| pre-schema (0.1.0) | ✅ Full | ✅ Automatic | Original TaskMaster format |
| beta-schema (0.9.0) | ✅ Full | ✅ Automatic | Beta testing format |
| 1.0.0 | ✅ Native | ➖ N/A | Current version |

## Integration Guide

### For Integration Developers

1. **Use schema validation** to ensure payload correctness
2. **Handle both legacy and modern formats** during transition period
3. **Emit standardized payloads** for new events
4. **Test with multiple payload versions** to ensure compatibility

### Example Integration Handler

```javascript
import { 
  validateEventPayload, 
  migrateEventPayload, 
  needsMigration 
} from './events/index.js';

export class MyIntegrationHandler {
  async handleTaskCreated(payload) {
    // Migrate if needed
    if (needsMigration(payload)) {
      const migration = migrateEventPayload(payload);
      if (!migration.success) {
        throw new Error(`Migration failed: ${migration.error}`);
      }
      payload = migration.payload;
    }

    // Validate payload
    const validation = validateEventPayload('task:created', payload);
    if (!validation.valid) {
      throw new Error(`Invalid payload: ${validation.errors.join(', ')}`);
    }

    // Process with confidence that payload is valid and standardized
    await this.createExternalIssue(payload.task);
  }
}
```

### Best Practices

1. **Always validate** payloads in integration handlers
2. **Use the serializer** for consistent data handling
3. **Handle migration gracefully** without breaking existing functionality
4. **Log migration events** for monitoring and debugging
5. **Test with legacy payloads** to ensure backward compatibility

## Debugging and Monitoring

### Validation Errors

When validation fails, detailed error messages are provided:

```javascript
{
  valid: false,
  errors: [
    "taskId: Expected string or number, received undefined",
    "context.source: Invalid enum value. Expected 'cli' | 'mcp' | 'api' | 'webhook', received 'unknown'"
  ]
}
```

### Migration Logging

Migration events are automatically logged:

```
DEBUG: Migrated payload from pre-schema to 1.0.0
INFO: Successfully processed 15 legacy payloads during startup
WARN: Validation failed for migrated payload: missing required field 'eventId'
```

### Serialization Statistics

Track serialization performance:

```javascript
const stats = serializer.getStats();
console.log(`Serialized: ${stats.serialized}, Errors: ${stats.validationErrors}`);
```

## Future Considerations

### Planned Enhancements

- **Compression support** for large payloads
- **Binary serialization** for high-performance scenarios  
- **Schema registry** for distributed systems
- **Payload encryption** for sensitive data
- **Real-time schema validation** in development mode

### Migration to v2.0.0

Future major version changes will follow the same migration pattern:

1. Introduce new schemas alongside v1.0.0
2. Provide automatic migration utilities
3. Support both versions during transition period
4. Deprecate v1.0.0 with sufficient notice

This standardization system ensures that TaskMaster's event system remains robust, extensible, and backward-compatible as the project evolves.