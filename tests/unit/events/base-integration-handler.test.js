/**
 * @fileoverview Tests for BaseIntegrationHandler
 */

import { BaseIntegrationHandler } from '../../../scripts/modules/events/base-integration-handler.js';
import { EVENT_TYPES } from '../../../scripts/modules/events/types.js';

// Test implementation of BaseIntegrationHandler
class TestHandler extends BaseIntegrationHandler {
  constructor(name = 'test-handler', config = {}) {
    super(name, '1.0.0', config);
    this.initializationCalls = 0;
    this.shutdownCalls = 0;
    this.handledEvents = [];
    this.shouldFailInit = false;
    this.shouldFailHandler = false;
  }

  async _performInitialization(config) {
    this.initializationCalls++;
    if (this.shouldFailInit) {
      throw new Error('Initialization failed');
    }
  }

  async _performShutdown() {
    this.shutdownCalls++;
  }

  async handleTaskCreated(payload) {
    if (this.shouldFailHandler) {
      throw new Error('Handler failed');
    }
    this.handledEvents.push({ type: 'task:created', payload });
    return { success: true };
  }

  async handleGenericEvent(eventType, payload) {
    this.handledEvents.push({ type: eventType, payload, generic: true });
    return { success: true, generic: true };
  }
}

describe('BaseIntegrationHandler', () => {
  let handler;

  beforeEach(() => {
    handler = new TestHandler();
  });

  afterEach(async () => {
    if (handler.initialized) {
      await handler.shutdown();
    }
  });

  describe('constructor', () => {
    test('should create handler with required properties', () => {
      expect(handler.name).toBe('test-handler');
      expect(handler.version).toBe('1.0.0');
      expect(handler.initialized).toBe(false);
      expect(handler.isShuttingDown).toBe(false);
    });

    test('should prevent direct instantiation of abstract class', () => {
      expect(() => new BaseIntegrationHandler('test', '1.0.0'))
        .toThrow('BaseIntegrationHandler is abstract and cannot be instantiated directly');
    });

    test('should merge configuration with defaults', () => {
      const customHandler = new TestHandler('custom', {
        timeout: 60000,
        enabled: false,
        custom: 'value'
      });

      const config = customHandler.getConfig();
      expect(config.timeout).toBe(60000);
      expect(config.enabled).toBe(false);
      expect(config.custom).toBe('value');
      expect(config.maxAttempts).toBe(3); // From defaults
    });
  });

  describe('initialization', () => {
    test('should initialize successfully', async () => {
      expect(handler.initialized).toBe(false);
      
      await handler.initialize();
      
      expect(handler.initialized).toBe(true);
      expect(handler.initializationCalls).toBe(1);
    });

    test('should not initialize twice', async () => {
      await handler.initialize();
      
      // Store original console.log
      const originalLog = console.log;
      const logCalls = [];
      console.log = (...args) => logCalls.push(args);
      
      await handler.initialize();
      
      // Restore console.log
      console.log = originalLog;
      
      // Check that warning was logged
      const warnFound = logCalls.some(call => 
        call.some(arg => typeof arg === 'string' && arg.includes('[WARN]') && arg.includes('is already initialized'))
      );
      expect(warnFound).toBe(true);
      expect(handler.initializationCalls).toBe(1);
    });

    test('should handle initialization failure', async () => {
      handler.shouldFailInit = true;
      
      await expect(handler.initialize()).rejects.toThrow('Integration initialization failed');
      expect(handler.initialized).toBe(false);
    });

    test('should update configuration during initialization', async () => {
      await handler.initialize({ newSetting: 'value' });
      
      const config = handler.getConfig();
      expect(config.newSetting).toBe('value');
    });
  });

  describe('shutdown', () => {
    test('should shutdown successfully', async () => {
      await handler.initialize();
      expect(handler.initialized).toBe(true);
      
      await handler.shutdown();
      
      expect(handler.initialized).toBe(false);
      expect(handler.shutdownCalls).toBe(1);
    });

    test('should not shutdown if not initialized', async () => {
      await handler.shutdown();
      
      expect(handler.shutdownCalls).toBe(0);
    });

    test('should not shutdown twice', async () => {
      await handler.initialize();
      await handler.shutdown();
      
      await handler.shutdown();
      
      expect(handler.shutdownCalls).toBe(1);
    });

    test('should wait for active operations to complete', async () => {
      await handler.initialize();
      
      // Simulate active operation
      handler.activeOperations.add('test-op');
      
      const shutdownPromise = handler.shutdown();
      
      // Operation should complete before shutdown
      setTimeout(() => {
        handler.activeOperations.delete('test-op');
      }, 10);
      
      await shutdownPromise;
      
      expect(handler.initialized).toBe(false);
    });

    test('should timeout waiting for active operations', async () => {
      const quickTimeoutHandler = new TestHandler('quick-timeout', { timeout: 50 });
      await quickTimeoutHandler.initialize();
      
      // Add operation that won't complete
      quickTimeoutHandler.activeOperations.add('hanging-op');
      
      // Store original console.log
      const originalLog = console.log;
      const logCalls = [];
      console.log = (...args) => logCalls.push(args);
      
      await quickTimeoutHandler.shutdown();
      
      // Restore console.log
      console.log = originalLog;
      
      // Check that warning was logged
      const warnFound = logCalls.some(call => 
        call.some(arg => typeof arg === 'string' && arg.includes('[WARN]') && arg.includes('shutdown with 1 active operations'))
      );
      expect(warnFound).toBe(true);
    });
  });

  describe('event handling', () => {
    beforeEach(async () => {
      await handler.initialize();
    });

    test('should handle specific event types', async () => {
      const payload = { taskId: 'task-123', task: { id: 'task-123' } };
      
      const result = await handler.handleEvent(EVENT_TYPES.TASK_CREATED, payload);
      
      expect(result.success).toBe(true);
      expect(handler.handledEvents).toHaveLength(1);
      expect(handler.handledEvents[0].type).toBe('task:created');
    });

    test('should route to generic handler for unknown events', async () => {
      const payload = { customData: 'test' };
      
      const result = await handler.handleEvent('custom:event', payload);
      
      expect(result.success).toBe(true);
      expect(result.generic).toBe(true);
      expect(handler.handledEvents[0].type).toBe('custom:event');
    });

    test('should not handle events when disabled', async () => {
      // Create a fresh handler for this test
      const disabledHandler = new TestHandler('disabled-handler');
      await disabledHandler.initialize();
      disabledHandler.config.enabled = false;
      
      const result = await disabledHandler.handleEvent(EVENT_TYPES.TASK_CREATED, {});
      
      // Clean up
      await disabledHandler.shutdown();
      
      // The main behavior test - disabled handler should return null
      expect(result).toBeNull();
      // And should not have handled any events
      expect(disabledHandler.handledEvents).toHaveLength(0);
    });

    test('should reject events when shutting down', async () => {
      handler.isShuttingDown = true;
      
      await expect(
        handler.handleEvent(EVENT_TYPES.TASK_CREATED, {})
      ).rejects.toThrow('Integration is shutting down');
    });

    test('should track active operations', async () => {
      expect(handler.activeOperations.size).toBe(0);
      
      const handlerPromise = handler.handleEvent(EVENT_TYPES.TASK_CREATED, {
        taskId: 'task-123',
        task: { id: 'task-123' }
      });
      
      // During execution, there should be an active operation
      // (This is a bit tricky to test due to async nature, but we can check after completion)
      
      await handlerPromise;
      
      // After completion, no active operations
      expect(handler.activeOperations.size).toBe(0);
    });

    test('should handle handler errors', async () => {
      handler.shouldFailHandler = true;
      
      await expect(
        handler.handleEvent(EVENT_TYPES.TASK_CREATED, {})
      ).rejects.toThrow('Handler failed');
    });

    test('should convert event types to method names correctly', async () => {
      // Test the private method indirectly through event handling
      const testCases = [
        { eventType: 'task:created', expectedMethod: 'handleTaskCreated' },
        { eventType: 'subtask:status:changed', expectedMethod: 'handleSubtaskStatusChanged' },
        { eventType: 'dependency:added', expectedMethod: 'handleDependencyAdded' }
      ];

      for (const testCase of testCases) {
        const methodName = handler._getHandlerMethodName(testCase.eventType);
        expect(methodName).toBe(testCase.expectedMethod);
      }
    });
  });

  describe('retry logic', () => {
    beforeEach(async () => {
      await handler.initialize();
    });

    test('should retry failed operations', async () => {
      let attempts = 0;
      const operation = async () => {
        attempts++;
        if (attempts < 3) {
          const error = new Error('Temporary failure');
          error.code = 'ECONNRESET'; // Retryable error
          throw error;
        }
        return 'success';
      };

      const result = await handler.retry(operation, {
        maxAttempts: 3,
        retryableErrors: ['ECONNRESET'],
        baseDelay: 1 // Very short delay for testing
      });

      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    test('should not retry non-retryable errors', async () => {
      let attempts = 0;
      const operation = async () => {
        attempts++;
        const error = new Error('Non-retryable error');
        error.code = 'INVALID_AUTH';
        throw error;
      };

      await expect(
        handler.retry(operation, {
          maxAttempts: 3,
          retryableErrors: ['ECONNRESET'],
          baseDelay: 1
        })
      ).rejects.toThrow('Non-retryable error');

      expect(attempts).toBe(1);
    });

    test('should respect maximum attempts', async () => {
      let attempts = 0;
      const operation = async () => {
        attempts++;
        const error = new Error('Always fails');
        error.code = 'ECONNRESET';
        throw error;
      };

      await expect(
        handler.retry(operation, {
          maxAttempts: 2,
          retryableErrors: ['ECONNRESET'],
          baseDelay: 1
        })
      ).rejects.toThrow('Always fails');

      expect(attempts).toBe(2);
    });

    test('should calculate delays correctly for different backoff strategies', () => {
      const exponentialDelays = [1, 2, 3].map(attempt => 
        handler._calculateDelay(attempt, {
          backoffStrategy: 'exponential',
          baseDelay: 1000,
          maxDelay: 30000
        })
      );

      // Exponential should increase (roughly 1000, 2000, 4000 with jitter)
      expect(exponentialDelays[1]).toBeGreaterThan(exponentialDelays[0]);
      expect(exponentialDelays[2]).toBeGreaterThan(exponentialDelays[1]);

      const linearDelays = [1, 2, 3].map(attempt => 
        handler._calculateDelay(attempt, {
          backoffStrategy: 'linear',
          baseDelay: 1000,
          maxDelay: 30000
        })
      );

      // Linear should increase by baseDelay each time (with jitter)
      expect(linearDelays[1]).toBeGreaterThan(linearDelays[0]);
      expect(linearDelays[2]).toBeGreaterThan(linearDelays[1]);

      const fixedDelays = [1, 2, 3].map(attempt => 
        handler._calculateDelay(attempt, {
          backoffStrategy: 'fixed',
          baseDelay: 1000,
          maxDelay: 30000
        })
      );

      // Fixed should be approximately the same (within jitter range)
      fixedDelays.forEach(delay => {
        expect(delay).toBeGreaterThan(900); // baseDelay - 10% jitter
        expect(delay).toBeLessThan(1200); // baseDelay + 10% jitter + buffer
      });
    });

    test('should respect maximum delay', () => {
      const delay = handler._calculateDelay(10, {
        backoffStrategy: 'exponential',
        baseDelay: 1000,
        maxDelay: 5000
      });

      expect(delay).toBeLessThanOrEqual(5000);
    });
  });

  describe('configuration validation', () => {
    test('should validate valid configuration', () => {
      const validConfig = {
        timeout: 30000,
        enabled: true,
        maxAttempts: 3
      };

      const result = handler.validateConfig(validConfig);
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('should reject invalid timeout', () => {
      const invalidConfig = {
        timeout: -1000
      };

      const result = handler.validateConfig(invalidConfig);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Timeout must be a positive number');
    });

    test('should reject invalid enabled value', () => {
      const invalidConfig = {
        enabled: 'not-boolean'
      };

      const result = handler.validateConfig(invalidConfig);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Enabled must be a boolean');
    });
  });

  describe('status reporting', () => {
    test('should provide accurate status information', async () => {
      const status = handler.getStatus();
      
      expect(status).toEqual({
        name: 'test-handler',
        version: '1.0.0',
        initialized: false,
        enabled: false, // Not enabled because not initialized
        isShuttingDown: false,
        activeOperations: 0,
        config: handler.getConfig()
      });

      await handler.initialize();
      const initializedStatus = handler.getStatus();
      
      expect(initializedStatus.initialized).toBe(true);
      expect(initializedStatus.enabled).toBe(true);
    });
  });

  describe('error checking', () => {
    test('should identify retryable errors correctly', () => {
      const retryableConfig = {
        retryableErrors: ['ECONNRESET', 'TIMEOUT', 'RATE_LIMIT']
      };

      // Test error code matching
      const connResetError = new Error('Connection reset');
      connResetError.code = 'ECONNRESET';
      expect(handler._isRetryableError(connResetError, retryableConfig)).toBe(true);

      // Test message matching
      const timeoutError = new Error('Request TIMEOUT occurred');
      expect(handler._isRetryableError(timeoutError, retryableConfig)).toBe(true);

      // Test name matching
      const rateLimitError = new Error('Too many requests');
      rateLimitError.name = 'RATE_LIMIT';
      expect(handler._isRetryableError(rateLimitError, retryableConfig)).toBe(true);

      // Test non-retryable error
      const authError = new Error('Authentication failed');
      authError.code = 'AUTH_FAILED';
      expect(handler._isRetryableError(authError, retryableConfig)).toBe(false);
    });

    test('should handle missing retryable errors configuration', () => {
      const emptyConfig = {};
      const error = new Error('Some error');
      
      expect(handler._isRetryableError(error, emptyConfig)).toBe(false);
    });
  });
});