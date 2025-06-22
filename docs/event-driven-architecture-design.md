# TaskMaster Event-Driven Architecture Design

## Overview

This document defines a comprehensive event-driven architecture for TaskMaster that enables seamless integration with external systems like Linear while maintaining the existing functionality and performance characteristics.

## Event Types Specification

### Core Task Events

#### 1. Task Lifecycle Events

```typescript
interface TaskCreatedEvent {
  type: 'task:created';
  payload: {
    taskId: string;
    task: Task;
    tag: string;
    context: OperationContext;
    timestamp: string;
  };
}

interface TaskUpdatedEvent {
  type: 'task:updated';
  payload: {
    taskId: string;
    task: Task;
    changes: Partial<Task>;
    oldValues: Partial<Task>;
    tag: string;
    context: OperationContext;
    timestamp: string;
  };
}

interface TaskStatusChangedEvent {
  type: 'task:status:changed';
  payload: {
    taskId: string;
    task: Task;
    oldStatus: TaskStatus;
    newStatus: TaskStatus;
    tag: string;
    context: OperationContext;
    timestamp: string;
  };
}

interface TaskRemovedEvent {
  type: 'task:removed';
  payload: {
    taskId: string;
    task: Task;
    tag: string;
    context: OperationContext;
    timestamp: string;
  };
}
```

#### 2. Subtask Events

```typescript
interface SubtaskCreatedEvent {
  type: 'subtask:created';
  payload: {
    parentTaskId: string;
    subtaskId: string;
    subtask: Subtask;
    tag: string;
    context: OperationContext;
    timestamp: string;
  };
}

interface SubtaskUpdatedEvent {
  type: 'subtask:updated';
  payload: {
    parentTaskId: string;
    subtaskId: string;
    subtask: Subtask;
    changes: Partial<Subtask>;
    oldValues: Partial<Subtask>;
    tag: string;
    context: OperationContext;
    timestamp: string;
  };
}

interface SubtaskStatusChangedEvent {
  type: 'subtask:status:changed';
  payload: {
    parentTaskId: string;
    subtaskId: string;
    subtask: Subtask;
    oldStatus: TaskStatus;
    newStatus: TaskStatus;
    tag: string;
    context: OperationContext;
    timestamp: string;
  };
}

interface SubtaskRemovedEvent {
  type: 'subtask:removed';
  payload: {
    parentTaskId: string;
    subtaskId: string;
    subtask: Subtask;
    tag: string;
    context: OperationContext;
    timestamp: string;
  };
}
```

#### 3. Dependency Events

```typescript
interface DependencyAddedEvent {
  type: 'dependency:added';
  payload: {
    taskId: string;
    dependencyId: string;
    tag: string;
    context: OperationContext;
    timestamp: string;
  };
}

interface DependencyRemovedEvent {
  type: 'dependency:removed';
  payload: {
    taskId: string;
    dependencyId: string;
    tag: string;
    context: OperationContext;
    timestamp: string;
  };
}

interface DependenciesSatisfiedEvent {
  type: 'dependencies:satisfied';
  payload: {
    taskId: string;
    task: Task;
    satisfiedDependencies: string[];
    tag: string;
    context: OperationContext;
    timestamp: string;
  };
}
```

#### 4. Bulk Operations Events

```typescript
interface TasksBulkCreatedEvent {
  type: 'tasks:bulk:created';
  payload: {
    taskIds: string[];
    tasks: Task[];
    source: 'prd' | 'ai-generated' | 'import' | 'expansion';
    tag: string;
    context: OperationContext;
    timestamp: string;
  };
}

interface TasksBulkUpdatedEvent {
  type: 'tasks:bulk:updated';
  payload: {
    updates: Array<{
      taskId: string;
      changes: Partial<Task>;
      oldValues: Partial<Task>;
    }>;
    source: 'ai-update' | 'batch-operation' | 'migration';
    tag: string;
    context: OperationContext;
    timestamp: string;
  };
}

interface TasksBulkStatusChangedEvent {
  type: 'tasks:bulk:status:changed';
  payload: {
    changes: Array<{
      taskId: string;
      oldStatus: TaskStatus;
      newStatus: TaskStatus;
    }>;
    tag: string;
    context: OperationContext;
    timestamp: string;
  };
}
```

#### 5. Tag and Project Events

```typescript
interface TagCreatedEvent {
  type: 'tag:created';
  payload: {
    tagName: string;
    sourceTag?: string;
    copiedTasks?: boolean;
    context: OperationContext;
    timestamp: string;
  };
}

interface TagSwitchedEvent {
  type: 'tag:switched';
  payload: {
    fromTag: string;
    toTag: string;
    context: OperationContext;
    timestamp: string;
  };
}

interface TagDeletedEvent {
  type: 'tag:deleted';
  payload: {
    tagName: string;
    taskCount: number;
    context: OperationContext;
    timestamp: string;
  };
}
```

#### 6. Error and System Events

```typescript
interface IntegrationErrorEvent {
  type: 'integration:error';
  payload: {
    integration: string;
    operation: string;
    error: Error;
    originalEvent: EventPayload;
    context: OperationContext;
    timestamp: string;
  };
}

interface IntegrationSuccessEvent {
  type: 'integration:success';
  payload: {
    integration: string;
    operation: string;
    originalEvent: EventPayload;
    result: any;
    context: OperationContext;
    timestamp: string;
  };
}
```

### Support Types

```typescript
interface OperationContext {
  projectRoot: string;
  session: Session;
  user?: string;
  source: 'cli' | 'mcp' | 'api' | 'webhook';
  requestId?: string;
}

interface Task {
  id: string;
  title: string;
  description: string;
  details: string;
  status: TaskStatus;
  priority: TaskPriority;
  dependencies: string[];
  subtasks: Subtask[];
  testStrategy?: string;
  linearIssueId?: string; // For Linear integration
  externalIds?: Record<string, string>; // For other integrations
}

interface Subtask {
  id: string;
  title: string;
  description: string;
  details: string;
  status: TaskStatus;
  dependencies: string[];
  linearIssueId?: string;
  externalIds?: Record<string, string>;
}

type TaskStatus = 'pending' | 'in-progress' | 'review' | 'done' | 'cancelled' | 'deferred';
type TaskPriority = 'high' | 'medium' | 'low';
```

## Event Flow Architecture

### 1. Event Emission Points

```
Task Operation Flow:
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   CLI Command   │    │   MCP Tool      │    │  Direct Call    │
│                 │    │                 │    │                 │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          │              ┌───────▼───────┐              │
          │              │  MCP Handler  │              │
          │              └───────┬───────┘              │
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  Core Task Manager      │
                    │  (add-task.js, etc.)    │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   Event Emission        │
                    │   Point (AFTER local    │
                    │   operation succeeds)   │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   Event Emitter         │
                    │   (Async Processing)    │
                    └────────────┬────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
    ┌─────────▼──────┐  ┌────────▼────────┐  ┌─────▼──────┐
    │ Linear Handler │  │ Webhook Handler │  │ File Handler│
    └────────────────┘  └─────────────────┘  └────────────┘
```

### 2. Event Processing Pipeline

```
Event Processing Pipeline:
┌─────────────────┐
│ Event Emission  │
└─────────┬───────┘
          │
┌─────────▼───────┐
│ Middleware      │
│ Processing      │
│ (Transform,     │
│  Filter, Log)   │
└─────────┬───────┘
          │
┌─────────▼───────┐
│ Handler         │
│ Resolution      │
│ (Find matching  │
│  handlers)      │
└─────────┬───────┘
          │
┌─────────▼───────┐
│ Parallel        │
│ Execution       │
│ (All handlers   │
│  run async)     │
└─────────┬───────┘
          │
┌─────────▼───────┐
│ Error           │
│ Aggregation     │
│ (Log failures,  │
│  continue)      │
└─────────────────┘
```

### 3. Linear Integration Flow

```
Linear Integration Event Flow:
┌─────────────────┐    ┌─────────────────┐
│ TaskMaster      │    │ Linear          │
│ Operation       │    │ API             │
└─────────┬───────┘    └─────────────────┘
          │                     ▲
          │                     │
┌─────────▼───────┐    ┌────────┴────────┐
│ Local State     │    │ Linear Issue    │
│ Update          │    │ Creation/Update │
└─────────┬───────┘    └─────────────────┘
          │                     ▲
          │                     │
┌─────────▼───────┐    ┌────────┴────────┐
│ Event Emission  │    │ Linear Handler  │
│ (task:created)  │───▶│ Processing      │
└─────────────────┘    └─────────────────┘
```

## Component Interaction Design

### 1. Event System Core Components

```
Event System Architecture:
┌─────────────────────────────────────────────────────────────┐
│                     Event System Core                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐│
│  │ Event Emitter   │  │ Event Router    │  │ Handler      ││
│  │                 │  │                 │  │ Registry     ││
│  │ - emit()        │  │ - route()       │  │              ││
│  │ - addMiddleware │  │ - filter()      │  │ - register() ││
│  │ - configure()   │  │ - transform()   │  │ - resolve()  ││
│  └─────────────────┘  └─────────────────┘  └──────────────┘│
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                    Integration Layer                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐│
│  │ Linear Handler  │  │ Webhook Handler │  │ File Handler ││
│  │                 │  │                 │  │              ││
│  │ - handleTask*   │  │ - sendWebhook() │  │ - logEvent() ││
│  │ - syncToLinear()│  │ - notifySlack() │  │ - writeFile()││
│  │ - mapStatuses() │  │ - callAPI()     │  │ - backup()   ││
│  └─────────────────┘  └─────────────────┘  └──────────────┘│
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2. Configuration System

```
Configuration Flow:
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ Environment     │    │ Config File     │    │ Runtime Config  │
│ Variables       │    │ (.env, config   │    │ (Session-based) │
│                 │    │  .json)         │    │                 │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │ Config Manager          │
                    │                         │
                    │ - getEventConfig()      │
                    │ - getLinearConfig()     │
                    │ - isIntegrationEnabled()│
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │ Event System Init       │
                    │                         │
                    │ - loadHandlers()        │
                    │ - configureMiddleware() │
                    │ - validateConfig()      │
                    └─────────────────────────┘
```

## Async Processing and Performance Considerations

### 1. Event Processing Strategy

**Non-Blocking Event Emission**:
- Events are emitted after local operations complete successfully
- Event processing happens asynchronously and doesn't block command completion
- Failed event handlers don't affect core TaskMaster operations

**Concurrency Control**:
```typescript
interface EventProcessingConfig {
  maxConcurrentHandlers: number; // Default: 5
  handlerTimeout: number; // Default: 30 seconds
  retryAttempts: number; // Default: 3
  retryBackoff: 'exponential' | 'linear'; // Default: exponential
  enableBatching: boolean; // Default: true for bulk operations
  batchSize: number; // Default: 10
  batchTimeout: number; // Default: 5 seconds
}
```

### 2. Error Handling and Resilience

**Error Isolation**:
- Each handler runs in isolation
- Handler failures are logged but don't affect other handlers
- Circuit breaker pattern for repeatedly failing integrations

**Retry Logic**:
```typescript
interface RetryConfig {
  maxAttempts: number;
  backoffStrategy: 'exponential' | 'linear' | 'fixed';
  baseDelay: number; // milliseconds
  maxDelay: number; // milliseconds
  retryableErrors: string[]; // Error types that should be retried
}
```

### 3. Performance Optimization

**Event Batching**:
- Bulk operations emit batch events instead of individual events
- Configurable batching windows for high-frequency operations
- Intelligent batching based on event types and handlers

**Handler Optimization**:
- Lazy loading of integration handlers
- Connection pooling for external API calls
- Caching strategies for frequently accessed data

## Event Consumption Patterns

### 1. Handler Registration Patterns

**Static Registration** (at startup):
```typescript
eventEmitter.on('task:created', linearHandler.handleTaskCreated);
eventEmitter.on('task:status:changed', linearHandler.handleStatusChanged);
eventEmitter.on('task:updated', linearHandler.handleTaskUpdated);
```

**Dynamic Registration** (per operation):
```typescript
if (config.linear.enabled) {
  eventEmitter.addHandler('task:*', new LinearHandler(config.linear));
}
if (config.webhooks.enabled) {
  eventEmitter.addHandler('*', new WebhookHandler(config.webhooks));
}
```

### 2. Event Filtering and Transformation

**Middleware Pipeline**:
```typescript
// Authentication middleware
eventEmitter.use(async (eventType, payload) => {
  if (eventType.startsWith('task:')) {
    payload.authenticated = await validateUser(payload.context.user);
  }
  return payload;
});

// Enrichment middleware
eventEmitter.use(async (eventType, payload) => {
  if (eventType === 'task:created') {
    payload.enriched = await gatherTaskContext(payload.task);
  }
  return payload;
});

// Filtering middleware
eventEmitter.use(async (eventType, payload) => {
  if (config.filter.excludeInternalTasks && payload.task?.title?.startsWith('_')) {
    return null; // Skip this event
  }
  return payload;
});
```

### 3. Handler Implementation Patterns

**Base Handler Pattern**:
```typescript
abstract class BaseIntegrationHandler {
  abstract name: string;
  abstract version: string;
  
  async initialize(config: any): Promise<void> {
    // Setup connections, validate config
  }
  
  async shutdown(): Promise<void> {
    // Cleanup connections, save state
  }
  
  async handleEvent(eventType: string, payload: any): Promise<void> {
    // Route to specific handler methods
  }
  
  protected async retry<T>(
    operation: () => Promise<T>,
    config: RetryConfig
  ): Promise<T> {
    // Generic retry logic
  }
}
```

**Linear Handler Implementation**:
```typescript
class LinearHandler extends BaseIntegrationHandler {
  name = 'linear';
  version = '1.0.0';
  
  async handleTaskCreated(payload: TaskCreatedEvent['payload']): Promise<void> {
    try {
      const issue = await this.createLinearIssue(payload.task);
      await this.updateTaskWithLinearId(payload.taskId, issue.id, payload.context);
      
      await eventEmitter.emit('integration:success', {
        integration: this.name,
        operation: 'task:created',
        originalEvent: payload,
        result: { linearIssueId: issue.id },
        context: payload.context,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      await eventEmitter.emit('integration:error', {
        integration: this.name,
        operation: 'task:created',
        error,
        originalEvent: payload,
        context: payload.context,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }
}
```

## Scalability Considerations

### 1. Event Volume Management

**High-Volume Scenarios**:
- Large PRD imports (50+ tasks)
- Bulk status updates
- Automated task generation
- Continuous integration workflows

**Optimization Strategies**:
- Event aggregation for bulk operations
- Intelligent debouncing for rapid updates
- Prioritized event queues
- Background processing for non-critical events

### 2. Integration Performance

**Connection Management**:
- Persistent connections to external APIs
- Connection pooling for high-throughput scenarios
- Rate limiting compliance for external services
- Caching strategies for frequently accessed data

**Resource Management**:
- Memory-efficient event storage
- Configurable event retention policies
- Garbage collection for processed events
- Resource cleanup for failed operations

## Implementation Phases

### Phase 1: Core Event Infrastructure
1. Event emitter with middleware support
2. Basic handler registration system
3. Error handling and logging
4. Configuration management
5. Unit tests for core functionality

### Phase 2: Linear Integration
1. Linear handler implementation
2. Bidirectional sync capabilities
3. Configuration for Linear-specific settings
4. Integration tests with Linear API
5. Error recovery mechanisms

### Phase 3: Advanced Features
1. Event batching and optimization
2. Webhook support for external notifications
3. Event replay and debugging tools
4. Performance monitoring and metrics
5. Documentation and migration guides

### Phase 4: Extended Integrations
1. Plugin architecture for custom integrations
2. Webhook receiver for external events
3. Advanced filtering and transformation
4. Event-based analytics and reporting
5. Production monitoring and alerting

## Testing Strategy

### 1. Unit Testing
- Event emitter functionality
- Handler registration and execution
- Middleware processing
- Error handling and recovery
- Configuration validation

### 2. Integration Testing
- End-to-end event flows
- Linear API integration
- Webhook delivery and processing
- Performance under load
- Failure scenarios and recovery

### 3. Performance Testing
- High-volume event processing
- Concurrent handler execution
- Memory usage and garbage collection
- Network latency and timeouts
- Resource utilization monitoring

## Monitoring and Observability

### 1. Event Metrics
- Event emission rates by type
- Handler execution times
- Success/failure rates per integration
- Queue depths and processing delays
- Resource utilization metrics

### 2. Error Tracking
- Handler failure categorization
- Integration-specific error patterns
- Retry attempt tracking
- Circuit breaker activations
- Performance degradation alerts

### 3. Debugging Tools
- Event flow visualization
- Handler execution tracing
- Configuration validation tools
- Integration health checks
- Performance profiling utilities

This architecture provides a robust foundation for integrating TaskMaster with Linear while maintaining performance, reliability, and extensibility for future integrations.