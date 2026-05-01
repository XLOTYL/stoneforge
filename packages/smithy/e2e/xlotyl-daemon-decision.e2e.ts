import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { createStorageAsync, initializeSchema } from '@stoneforge/storage';
import { createInboxService, createQuarryAPI } from '@stoneforge/quarry';
import {
  createEntity,
  createTask,
  createTimestamp,
  EntityTypeValue,
  Priority,
  TaskStatus,
  type EntityId,
  type Task,
} from '@stoneforge/core';
import {
  createAgentRegistry,
  createDispatchDaemon,
  createDispatchService,
  createTaskAssignmentService,
} from '../src/services/index.js';
import type { SessionManager, SessionRecord, StartSessionOptions } from '../src/runtime/session-manager.js';
import type { CreateWorktreeOptions, CreateWorktreeResult, WorktreeManager } from '../src/git/worktree-manager.js';
import type { StewardScheduler } from '../src/services/steward-scheduler.js';

function requireXlotylDecisionModule(): string {
  const modulePath = process.env.XLOTYL_DECISION_MODULE;
  if (!modulePath) {
    throw new Error('XLOTYL_DECISION_MODULE must point to a built XLOTYL dist/stoneforge/daemon-decision.js');
  }
  return modulePath;
}

function createMockSessionManager(): SessionManager {
  const sessions = new Map<EntityId, SessionRecord>();
  return {
    startSession: vi.fn(async (agentId: EntityId, options?: StartSessionOptions) => {
      const session: SessionRecord = {
        id: `session-${agentId}`,
        agentId,
        agentRole: 'worker',
        workerMode: 'ephemeral',
        status: 'running',
        workingDirectory: options?.workingDirectory,
        worktree: options?.worktree,
        createdAt: createTimestamp(),
        startedAt: createTimestamp(),
        lastActivityAt: createTimestamp(),
      };
      sessions.set(agentId, session);
      return { session, events: new EventEmitter() };
    }),
    getActiveSession: vi.fn((agentId: EntityId) => sessions.get(agentId) ?? null),
    stopSession: vi.fn(async () => {}),
    suspendSession: vi.fn(async () => {}),
    resumeSession: vi.fn(async () => ({ session: {} as SessionRecord, events: new EventEmitter() })),
    getSession: vi.fn(() => undefined),
    listSessions: vi.fn(() => []),
    messageSession: vi.fn(async () => ({ success: true })),
    getSessionHistory: vi.fn(() => []),
    pruneInactiveSessions: vi.fn(() => 0),
    reconcileOnStartup: vi.fn(async () => ({ reconciled: 0, errors: [] })),
    on: vi.fn(() => {}),
    off: vi.fn(() => {}),
    emit: vi.fn(() => {}),
  } as unknown as SessionManager;
}

function createMockWorktreeManager(root: string): WorktreeManager {
  return {
    createWorktree: vi.fn(async (options: CreateWorktreeOptions): Promise<CreateWorktreeResult> => ({
      path: join(root, '.stoneforge', '.worktrees', options.agentName, options.taskId),
      relativePath: join('.stoneforge', '.worktrees', options.agentName, options.taskId),
      branch: options.customBranch ?? `agent/${options.agentName}/${options.taskId}-task`,
      head: 'abc123',
      isMain: false,
      state: 'active',
    })),
    createReadOnlyWorktree: vi.fn(async (): Promise<CreateWorktreeResult> => ({
      path: join(root, '.stoneforge', '.worktrees', 'readonly'),
      relativePath: join('.stoneforge', '.worktrees', 'readonly'),
      branch: 'master',
      head: 'abc123',
      isMain: false,
      state: 'active',
    })),
    getWorktree: vi.fn(async () => undefined),
    listWorktrees: vi.fn(async () => []),
    removeWorktree: vi.fn(async () => {}),
    cleanupOrphanedWorktrees: vi.fn(async () => ({ removed: [], errors: [] })),
    worktreeExists: vi.fn(async () => true),
    getWorkspaceRoot: vi.fn(() => root),
    getDefaultBranch: vi.fn(async () => 'master'),
    ensureWorktreeRemote: vi.fn(async () => true),
  } as unknown as WorktreeManager;
}

function createMockStewardScheduler(): StewardScheduler {
  return {
    start: vi.fn(() => {}),
    stop: vi.fn(() => {}),
    isRunning: vi.fn(() => false),
    scheduleAgent: vi.fn(async () => {}),
    unscheduleAgent: vi.fn(async () => {}),
    getScheduledJobs: vi.fn(() => []),
    getEventSubscriptions: vi.fn(() => []),
    triggerEvent: vi.fn(async () => []),
    getExecutionHistory: vi.fn(async () => []),
    getStats: vi.fn(() => ({
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      scheduledJobs: 0,
      eventSubscriptions: 0,
    })),
    on: vi.fn(() => {}),
    off: vi.fn(() => {}),
    emit: vi.fn(() => {}),
  } as unknown as StewardScheduler;
}

describe('XLOTYL daemon decision e2e', () => {
  it('loads built XLOTYL in process and dispatches through Stoneforge execution', async () => {
    const xlotylDecisionModule = requireXlotylDecisionModule();
    const root = await mkdtemp(join(tmpdir(), 'stoneforge-xlotyl-daemon-'));
    try {
      const storage = await createStorageAsync({ path: join(root, 'stoneforge.db'), create: true });
      initializeSchema(storage);
      const api = createQuarryAPI(storage);
      const inboxService = createInboxService(storage);
      const agentRegistry = createAgentRegistry(api);
      const taskAssignment = createTaskAssignmentService(api);
      const dispatchService = createDispatchService(api, taskAssignment, agentRegistry);
      const sessionManager = createMockSessionManager();
      const worktreeManager = createMockWorktreeManager(root);
      const stewardScheduler = createMockStewardScheduler();

      const system = await api.create(await createEntity({
        name: 'xlotyl-e2e-system',
        entityType: EntityTypeValue.SYSTEM,
        createdBy: 'system:xlotyl-e2e' as EntityId,
      }) as unknown as Record<string, unknown> & { createdBy: EntityId });
      const systemEntity = system.id as unknown as EntityId;

      const worker = await agentRegistry.registerWorker({
        name: 'xlotyl-e2e-worker',
        workerMode: 'ephemeral',
        createdBy: systemEntity,
        maxConcurrentTasks: 1,
      });

      const low = await api.create(await createTask({
        title: 'Low priority task',
        createdBy: systemEntity,
        status: TaskStatus.OPEN,
        priority: Priority.LOW,
      }) as unknown as Record<string, unknown> & { createdBy: EntityId }) as Task;
      const high = await api.create(await createTask({
        title: 'High priority XLOTYL task',
        createdBy: systemEntity,
        status: TaskStatus.OPEN,
        priority: Priority.CRITICAL,
      }) as unknown as Record<string, unknown> & { createdBy: EntityId }) as Task;
      await api.update(low.id, {
        metadata: {
          xlotyl: {
            schema_version: 1,
            run_id: 'run-xlotyl-daemon-e2e',
            packet_id: 'low',
            workflow_id: 'wf-xlotyl-daemon-e2e',
            execution_mode: 'stoneforge',
          },
        },
      });
      await api.update(high.id, {
        metadata: {
          xlotyl: {
            schema_version: 1,
            run_id: 'run-xlotyl-daemon-e2e',
            packet_id: 'high',
            workflow_id: 'wf-xlotyl-daemon-e2e',
            execution_mode: 'stoneforge',
          },
        },
      });

      const daemon = createDispatchDaemon(
        api,
        agentRegistry,
        sessionManager,
        dispatchService,
        worktreeManager,
        taskAssignment,
        stewardScheduler,
        inboxService,
        {
          projectRoot: root,
          decisionProvider: 'xlotyl',
          xlotylDecisionModule,
          ensureTargetBranchExists: async () => {},
        },
      );

      const result = await daemon.pollWorkerAvailability();

      expect(result.processed).toBe(1);
      expect(result.errors).toBe(0);
      expect((await api.get<Task>(high.id))?.assignee as unknown as string).toBe(worker.id as unknown as string);
      expect((await api.get<Task>(low.id))?.assignee).toBeUndefined();
      const decisionLog = await readFile(
        join(root, '.stoneforge', 'xlotyl', 'runs', 'run-xlotyl-daemon-e2e', 'decision-log.jsonl'),
        'utf8',
      );
      expect(decisionLog).toContain('"decision_provider":"xlotyl"');
      expect(decisionLog).toContain('"packet_id":"high"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);
});
