/**
 * @fileoverview Enhanced mocking utilities for integration testing
 *
 * Provides advanced mocking capabilities for testing complex integration
 * scenarios, including network simulation, timing control, and state management.
 */

import { MockServiceRegistry } from '../mocks/service-registry.js';

/**
 * Enhanced Mock Factory for Integration Testing
 */
class EnhancedMockFactory {
	/**
	 * Create a mock Linear API client with realistic behavior
	 * @param {Object} options - Configuration options
	 * @returns {Object} Mock Linear API client
	 */
	static createLinearApiMock(options = {}) {
		const {
			latency = 100,
			errorRate = 0,
			timeoutRate = 0,
			apiKey = 'mock-api-key',
			teamId = 'mock-team-id'
		} = options;

		const mockIssues = new Map();
		let issueCounter = 1;

		return {
			// Authentication
			validateApiKey: MockServiceRegistry.createMockFn(async () => {
				await EnhancedMockFactory._simulateNetworkDelay(latency);

				if (EnhancedMockFactory._shouldSimulateError(errorRate)) {
					throw new Error('Invalid API key');
				}

				return { valid: true, teamId };
			}),

			// Issue creation
			createIssue: MockServiceRegistry.createMockFn(async (issueData) => {
				await EnhancedMockFactory._simulateNetworkDelay(latency);

				if (EnhancedMockFactory._shouldSimulateTimeout(timeoutRate)) {
					throw new Error('Request timeout');
				}

				if (EnhancedMockFactory._shouldSimulateError(errorRate)) {
					throw new Error('Failed to create issue');
				}

				const issue = {
					id: `issue-${issueCounter++}`,
					title: issueData.title,
					description: issueData.description,
					priority: issueData.priority || 'medium',
					status: 'todo',
					teamId,
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					url: `https://linear.app/team/issue/${issueCounter - 1}`
				};

				mockIssues.set(issue.id, issue);
				return issue;
			}),

			// Issue retrieval
			getIssue: MockServiceRegistry.createMockFn(async (issueId) => {
				await EnhancedMockFactory._simulateNetworkDelay(latency);

				if (EnhancedMockFactory._shouldSimulateError(errorRate)) {
					throw new Error('Failed to fetch issue');
				}

				const issue = mockIssues.get(issueId);
				if (!issue) {
					throw new Error('Issue not found');
				}

				return issue;
			}),

			// Issue update
			updateIssue: MockServiceRegistry.createMockFn(
				async (issueId, updates) => {
					await EnhancedMockFactory._simulateNetworkDelay(latency);

					if (EnhancedMockFactory._shouldSimulateError(errorRate)) {
						throw new Error('Failed to update issue');
					}

					const issue = mockIssues.get(issueId);
					if (!issue) {
						throw new Error('Issue not found');
					}

					const updatedIssue = {
						...issue,
						...updates,
						updatedAt: new Date().toISOString()
					};

					mockIssues.set(issueId, updatedIssue);
					return updatedIssue;
				}
			),

			// Issue listing
			listIssues: MockServiceRegistry.createMockFn(async (filters = {}) => {
				await EnhancedMockFactory._simulateNetworkDelay(latency);

				if (EnhancedMockFactory._shouldSimulateError(errorRate)) {
					throw new Error('Failed to list issues');
				}

				let issues = Array.from(mockIssues.values());

				// Apply filters
				if (filters.status) {
					issues = issues.filter((issue) => issue.status === filters.status);
				}
				if (filters.priority) {
					issues = issues.filter(
						(issue) => issue.priority === filters.priority
					);
				}

				return {
					issues,
					total: issues.length,
					hasNextPage: false
				};
			}),

			// Webhook simulation
			simulateWebhook: (eventType, issueId) => {
				const issue = mockIssues.get(issueId);
				if (!issue) return null;

				return {
					type: eventType,
					data: {
						issue,
						team: { id: teamId }
					},
					timestamp: new Date().toISOString()
				};
			},

			// Test utilities
			_getMockIssues: () => mockIssues,
			_resetMockIssues: () => mockIssues.clear(),
			_setIssueCounter: (value) => {
				issueCounter = value;
			}
		};
	}

	/**
	 * Create a mock task management system
	 * @param {Object} options - Configuration options
	 * @returns {Object} Mock task management system
	 */
	static createTaskManagerMock(options = {}) {
		const {
			persistToDisk = false,
			simulateFileErrors = false,
			latency = 10
		} = options;

		const tasks = new Map();
		let taskCounter = 1;

		return {
			// Task operations
			addTask: MockServiceRegistry.createMockFn(async (taskData) => {
				await EnhancedMockFactory._simulateNetworkDelay(latency);

				if (simulateFileErrors && Math.random() < 0.1) {
					throw new Error('File system error');
				}

				const task = {
					id: `${taskCounter++}`,
					title: taskData.title,
					description: taskData.description,
					status: 'pending',
					priority: taskData.priority || 'medium',
					dependencies: taskData.dependencies || [],
					subtasks: [],
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString()
				};

				tasks.set(task.id, task);

				if (persistToDisk) {
					await EnhancedMockFactory._simulateDiskWrite();
				}

				return task;
			}),

			updateTask: MockServiceRegistry.createMockFn(async (taskId, updates) => {
				await EnhancedMockFactory._simulateNetworkDelay(latency);

				if (simulateFileErrors && Math.random() < 0.1) {
					throw new Error('File system error');
				}

				const task = tasks.get(taskId);
				if (!task) {
					throw new Error('Task not found');
				}

				const updatedTask = {
					...task,
					...updates,
					updatedAt: new Date().toISOString()
				};

				tasks.set(taskId, updatedTask);

				if (persistToDisk) {
					await EnhancedMockFactory._simulateDiskWrite();
				}

				return updatedTask;
			}),

			getTask: MockServiceRegistry.createMockFn(async (taskId) => {
				await EnhancedMockFactory._simulateNetworkDelay(latency);

				const task = tasks.get(taskId);
				if (!task) {
					throw new Error('Task not found');
				}

				return task;
			}),

			listTasks: MockServiceRegistry.createMockFn(async (filters = {}) => {
				await EnhancedMockFactory._simulateNetworkDelay(latency);

				let taskList = Array.from(tasks.values());

				if (filters.status) {
					taskList = taskList.filter((task) => task.status === filters.status);
				}

				return taskList;
			}),

			// Event emission simulation
			emitTaskEvent: MockServiceRegistry.createMockFn((eventType, taskData) => {
				return {
					type: eventType,
					payload: taskData,
					timestamp: Date.now()
				};
			}),

			// Test utilities
			_getTasks: () => tasks,
			_resetTasks: () => tasks.clear(),
			_setTaskCounter: (value) => {
				taskCounter = value;
			}
		};
	}

	/**
	 * Create a time-controlled environment for testing
	 * @param {Object} options - Configuration options
	 * @returns {Object} Time controller
	 */
	static createTimeController(options = {}) {
		const { startTime = Date.now() } = options;
		let currentTime = startTime;
		const timers = new Map();
		let timerCounter = 1;

		return {
			// Time manipulation
			getCurrentTime: () => currentTime,
			setTime: (time) => {
				currentTime = time;
			},
			advanceTime: (milliseconds) => {
				currentTime += milliseconds;
			},

			// Timer mocking
			setTimeout: MockServiceRegistry.createMockFn((callback, delay) => {
				const timerId = timerCounter++;
				const executeTime = currentTime + delay;

				timers.set(timerId, {
					callback,
					executeTime,
					type: 'timeout'
				});

				return timerId;
			}),

			setInterval: MockServiceRegistry.createMockFn((callback, interval) => {
				const timerId = timerCounter++;
				const executeTime = currentTime + interval;

				timers.set(timerId, {
					callback,
					executeTime,
					interval,
					type: 'interval'
				});

				return timerId;
			}),

			clearTimeout: MockServiceRegistry.createMockFn((timerId) => {
				timers.delete(timerId);
			}),

			clearInterval: MockServiceRegistry.createMockFn((timerId) => {
				timers.delete(timerId);
			}),

			// Execute expired timers
			tick: (milliseconds = 0) => {
				const endTime = currentTime + milliseconds;
				const executedCallbacks = [];

				while (currentTime <= endTime) {
					const expiredTimers = Array.from(timers.entries())
						.filter(([id, timer]) => timer.executeTime <= currentTime)
						.sort(([, a], [, b]) => a.executeTime - b.executeTime);

					if (expiredTimers.length === 0) {
						currentTime = endTime;
						break;
					}

					const [timerId, timer] = expiredTimers[0];
					currentTime = timer.executeTime;

					try {
						timer.callback();
						executedCallbacks.push(timerId);
					} catch (error) {
						console.warn(`Timer ${timerId} callback failed:`, error);
					}

					if (timer.type === 'timeout') {
						timers.delete(timerId);
					} else if (timer.type === 'interval') {
						timer.executeTime = currentTime + timer.interval;
					}
				}

				return executedCallbacks;
			},

			// Fast-forward until all timers are executed
			runAllTimers: () => {
				let executedCount = 0;
				const maxIterations = 1000; // Prevent infinite loops

				for (let i = 0; i < maxIterations && timers.size > 0; i++) {
					const nextTimer = Array.from(timers.values()).sort(
						(a, b) => a.executeTime - b.executeTime
					)[0];

					if (!nextTimer) break;

					const executed = EnhancedMockFactory.tick(
						nextTimer.executeTime - currentTime
					);
					executedCount += executed.length;
				}

				return executedCount;
			},

			// Test utilities
			_getTimers: () => timers,
			_resetTimers: () => timers.clear()
		};
	}

	/**
	 * Create a network condition simulator
	 * @param {Object} options - Network simulation options
	 * @returns {Object} Network simulator
	 */
	static createNetworkSimulator(options = {}) {
		const {
			baseLatency = 100,
			jitter = 20,
			packetLoss = 0,
			bandwidth = Infinity
		} = options;

		let networkCondition = 'normal';
		let customLatency = baseLatency;

		return {
			// Network condition control
			setCondition: (condition) => {
				networkCondition = condition;
				switch (condition) {
					case 'slow':
						customLatency = baseLatency * 5;
						break;
					case 'unstable':
						customLatency = baseLatency * 2;
						break;
					case 'offline':
						customLatency = Infinity;
						break;
					default:
						customLatency = baseLatency;
				}
			},

			getCondition: () => networkCondition,

			// Simulate network request
			simulateRequest: async (size = 1024) => {
				if (networkCondition === 'offline') {
					throw new Error('Network unavailable');
				}

				// Simulate packet loss
				if (Math.random() < packetLoss) {
					throw new Error('Packet loss');
				}

				// Calculate latency with jitter
				const actualLatency =
					customLatency + (Math.random() - 0.5) * jitter * 2;

				// Calculate bandwidth delay
				const bandwidthDelay =
					bandwidth !== Infinity ? (size / bandwidth) * 1000 : 0;

				const totalDelay = Math.max(0, actualLatency + bandwidthDelay);

				await new Promise((resolve) => setTimeout(resolve, totalDelay));

				return {
					latency: actualLatency,
					bandwidthDelay,
					totalDelay,
					size
				};
			},

			// Batch request simulation
			simulateBatch: async (requests) => {
				const results = [];

				for (const request of requests) {
					try {
						const result = await EnhancedMockFactory.simulateRequest(
							request.size
						);
						results.push({ success: true, result, request });
					} catch (error) {
						results.push({ success: false, error: error.message, request });
					}
				}

				return results;
			}
		};
	}

	/**
	 * Create a state machine for testing complex workflows
	 * @param {Object} states - State definitions
	 * @param {string} initialState - Initial state
	 * @returns {Object} State machine
	 */
	static createStateMachine(states, initialState) {
		let currentState = initialState;
		const history = [initialState];
		const listeners = new Map();

		return {
			// State management
			getCurrentState: () => currentState,
			getHistory: () => [...history],

			// Transitions
			transition: (event, data = {}) => {
				const stateDefinition = states[currentState];
				if (!stateDefinition || !stateDefinition.transitions) {
					throw new Error(`No transitions defined for state: ${currentState}`);
				}

				const nextState = stateDefinition.transitions[event];
				if (!nextState) {
					throw new Error(
						`No transition for event '${event}' from state '${currentState}'`
					);
				}

				const previousState = currentState;
				currentState = nextState;
				history.push(nextState);

				// Execute state actions
				if (stateDefinition.onExit) {
					stateDefinition.onExit(previousState, nextState, data);
				}

				const nextStateDefinition = states[nextState];
				if (nextStateDefinition?.onEnter) {
					nextStateDefinition.onEnter(previousState, nextState, data);
				}

				// Notify listeners
				const stateListeners = listeners.get(nextState) || [];
				stateListeners.forEach((listener) =>
					listener(previousState, nextState, data)
				);

				return nextState;
			},

			// Event listeners
			onStateEnter: (state, callback) => {
				if (!listeners.has(state)) {
					listeners.set(state, []);
				}
				listeners.get(state).push(callback);
			},

			// Utilities
			canTransition: (event) => {
				const stateDefinition = states[currentState];
				return stateDefinition?.transitions?.[event] !== undefined;
			},

			reset: () => {
				currentState = initialState;
				history.length = 0;
				history.push(initialState);
			}
		};
	}

	// Private utility methods
	static async _simulateNetworkDelay(latency) {
		if (latency > 0) {
			const jitter = latency * 0.1; // 10% jitter
			const actualDelay = latency + (Math.random() - 0.5) * jitter * 2;
			await new Promise((resolve) =>
				setTimeout(resolve, Math.max(0, actualDelay))
			);
		}
	}

	static async _simulateDiskWrite() {
		// Simulate disk I/O delay
		await new Promise((resolve) => setTimeout(resolve, Math.random() * 10 + 5));
	}

	static _shouldSimulateError(errorRate) {
		return Math.random() < errorRate;
	}

	static _shouldSimulateTimeout(timeoutRate) {
		return Math.random() < timeoutRate;
	}
}

/**
 * Integration Test Scenario Builder
 */
class ScenarioBuilder {
	constructor() {
		this.steps = [];
		this.expectations = [];
		this.setup = [];
		this.teardown = [];
	}

	// Setup methods
	setupLinearApi(options = {}) {
		this.setup.push(() => {
			this.linearApi = EnhancedMockFactory.createLinearApiMock(options);
			return this.linearApi;
		});
		return this;
	}

	setupTaskManager(options = {}) {
		this.setup.push(() => {
			this.taskManager = EnhancedMockFactory.createTaskManagerMock(options);
			return this.taskManager;
		});
		return this;
	}

	setupTimeController(options = {}) {
		this.setup.push(() => {
			this.timeController = EnhancedMockFactory.createTimeController(options);
			return this.timeController;
		});
		return this;
	}

	setupNetworkSimulator(options = {}) {
		this.setup.push(() => {
			this.networkSimulator =
				EnhancedMockFactory.createNetworkSimulator(options);
			return this.networkSimulator;
		});
		return this;
	}

	// Scenario steps
	step(description, action) {
		this.steps.push({ description, action });
		return this;
	}

	expect(description, assertion) {
		this.expectations.push({ description, assertion });
		return this;
	}

	// Teardown
	cleanup(action) {
		this.teardown.push(action);
		return this;
	}

	// Execute scenario
	async execute() {
		const context = {};

		try {
			// Setup
			for (const setupFn of this.setup) {
				await setupFn.call(this);
			}

			// Execute steps
			for (const step of this.steps) {
				try {
					await step.action.call(this, context);
				} catch (error) {
					throw new Error(
						`Step "${step.description}" failed: ${error.message}`
					);
				}
			}

			// Run expectations
			for (const expectation of this.expectations) {
				try {
					await expectation.assertion.call(this, context);
				} catch (error) {
					throw new Error(
						`Expectation "${expectation.description}" failed: ${error.message}`
					);
				}
			}

			return { success: true, context };
		} finally {
			// Teardown
			for (const teardownFn of this.teardown) {
				try {
					await teardownFn.call(this);
				} catch (error) {
					console.warn('Teardown failed:', error);
				}
			}
		}
	}
}

/**
 * Chaos Testing Utilities
 */
class ChaosTestUtils {
	/**
	 * Introduce random failures into a system
	 * @param {Object} target - Target object to introduce chaos into
	 * @param {Object} options - Chaos configuration
	 * @returns {Object} Chaos controller
	 */
	static introduceChaos(target, options = {}) {
		const {
			errorRate = 0.1,
			latencyMultiplier = 2,
			memoryLeakRate = 0.01,
			methods = Object.getOwnPropertyNames(target).filter(
				(name) => typeof target[name] === 'function'
			)
		} = options;

		const originalMethods = {};
		const chaosController = {
			isActive: true,
			statistics: {
				callCount: 0,
				errorCount: 0,
				latencyIntroduced: 0
			}
		};

		// Wrap methods with chaos
		methods.forEach((methodName) => {
			originalMethods[methodName] = target[methodName];

			target[methodName] = async function (...args) {
				chaosController.statistics.callCount++;

				if (!chaosController.isActive) {
					return originalMethods[methodName].apply(this, args);
				}

				// Introduce random latency
				if (Math.random() < 0.3) {
					const latency = Math.random() * 100 * latencyMultiplier;
					await new Promise((resolve) => setTimeout(resolve, latency));
					chaosController.statistics.latencyIntroduced += latency;
				}

				// Introduce random errors
				if (Math.random() < errorRate) {
					chaosController.statistics.errorCount++;
					throw new Error(`Chaos error in ${methodName}`);
				}

				// Introduce memory leaks
				if (Math.random() < memoryLeakRate) {
					// Create a small memory leak
					global._chaosLeak = global._chaosLeak || [];
					global._chaosLeak.push(new Array(1000).fill('leak'));
				}

				return originalMethods[methodName].apply(this, args);
			};
		});

		// Chaos controller methods
		chaosController.disable = () => {
			chaosController.isActive = false;
		};

		chaosController.enable = () => {
			chaosController.isActive = true;
		};

		chaosController.restore = () => {
			methods.forEach((methodName) => {
				target[methodName] = originalMethods[methodName];
			});

			// Cleanup memory leaks
			delete global._chaosLeak;
		};

		chaosController.getStatistics = () => ({
			...chaosController.statistics,
			errorRate:
				chaosController.statistics.errorCount /
				chaosController.statistics.callCount
		});

		return chaosController;
	}
}

// Export utilities
export { EnhancedMockFactory, ScenarioBuilder, ChaosTestUtils };
