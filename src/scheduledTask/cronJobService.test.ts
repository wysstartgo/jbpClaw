import { describe, expect, test, vi } from 'vitest';

import { DeliveryChannel, DeliveryMode, GatewayStatus, PayloadKind, ScheduleKind, SessionTarget, TaskStatus, WakeMode } from './constants';
import {
  CronJobService,
  isInternalScheduledTaskJob,
  mapGatewayJob,
  mapGatewayRun,
  mapGatewayTaskState,
} from './cronJobService';

function makeGatewayJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    name: 'Morning brief',
    description: 'Send a summary',
    enabled: true,
    schedule: { kind: ScheduleKind.Cron, expr: '0 9 * * *', tz: 'Asia/Shanghai' },
    sessionTarget: SessionTarget.Isolated,
    wakeMode: WakeMode.Now,
    payload: { kind: PayloadKind.AgentTurn, message: 'Summarize updates' },
    delivery: { mode: DeliveryMode.None },
    agentId: null,
    sessionKey: null,
    state: {},
    createdAtMs: 1_700_000_000_000,
    updatedAtMs: 1_700_000_100_000,
    ...overrides,
  };
}

describe('isInternalScheduledTaskJob', () => {
  test('detects memory-core managed descriptions', () => {
    expect(
      isInternalScheduledTaskJob(
        makeGatewayJob({
          description: '[managed-by=memory-core.short-term-promotion] Promote recalls',
        }),
      ),
    ).toBe(true);
  });

  test('detects memory-core payload sentinels', () => {
    expect(
      isInternalScheduledTaskJob(
        makeGatewayJob({
          description: '',
          payload: {
            kind: PayloadKind.AgentTurn,
            message: '__openclaw_memory_core_short_term_promotion_dream__',
          },
        }),
      ),
    ).toBe(true);
  });

  test('does not hide regular user tasks', () => {
    expect(isInternalScheduledTaskJob(makeGatewayJob())).toBe(false);
  });
});

describe('CronJobService internal task filtering', () => {
  test('hides memory-core tasks from the task list', async () => {
    const userJob = makeGatewayJob({ id: 'user-job', name: 'User task' });
    const internalJob = makeGatewayJob({
      id: 'dream-job',
      name: 'Memory Dreaming Promotion',
      description: '[managed-by=memory-core.short-term-promotion] Promote recalls',
      payload: {
        kind: PayloadKind.AgentTurn,
        message: '__openclaw_memory_core_short_term_promotion_dream__',
      },
    });
    const service = new CronJobService({
      getGatewayClient: () => ({
        request: async <T>() => ({ jobs: [internalJob, userJob] }) as T,
      }),
      ensureGatewayReady: vi.fn(async () => {}),
    });

    const jobs = await service.listJobs();

    expect(jobs.map(job => job.id)).toEqual(['user-job']);
  });

  test('hides memory-core runs from the global run history', async () => {
    const userJob1 = makeGatewayJob({ id: 'user-job-1', name: 'User task 1' });
    const userJob2 = makeGatewayJob({ id: 'user-job-2', name: 'User task 2' });
    const internalJob = makeGatewayJob({
      id: 'dream-job',
      name: 'Memory Dreaming Promotion',
      description: '[managed-by=memory-core.short-term-promotion] Promote recalls',
    });
    const entries = [
      { ts: 4, jobId: 'dream-job', status: GatewayStatus.Ok, runAtMs: 4 },
      { ts: 3, jobId: 'user-job-1', status: GatewayStatus.Ok, runAtMs: 3 },
      { ts: 2, jobId: 'dream-job', status: GatewayStatus.Ok, runAtMs: 2 },
      { ts: 1, jobId: 'user-job-2', status: GatewayStatus.Ok, runAtMs: 1 },
    ];
    const service = new CronJobService({
      getGatewayClient: () => ({
        request: async <T>(method: string, params?: unknown) => {
          if (method === 'cron.list') {
            return { jobs: [internalJob, userJob1, userJob2] } as T;
          }
          if (method === 'cron.runs') {
            const runParams = params as { offset?: number; limit?: number } | undefined;
            const start = runParams?.offset ?? 0;
            const end = start + (runParams?.limit ?? entries.length);
            return { entries: entries.slice(start, end) } as T;
          }
          return {} as T;
        },
      }),
      ensureGatewayReady: vi.fn(async () => {}),
    });

    const runs = await service.listAllRuns(2, 0);

    expect(runs.map(run => run.taskId)).toEqual(['user-job-1', 'user-job-2']);
    expect(runs.map(run => run.taskName)).toEqual(['User task 1', 'User task 2']);
  });
});

describe('mapGatewayRun', () => {
  const baseEntry = {
    ts: 1700000000000,
    jobId: 'job-1',
    status: GatewayStatus.Ok,
    sessionId: 'sess-1',
    runAtMs: 1699999990000,
    durationMs: 10000,
    summary: 'All good',
  };

  test('maps ok status to success', () => {
    const run = mapGatewayRun(baseEntry);
    expect(run.status).toBe(TaskStatus.Success);
    expect(run.error).toBeNull();
  });

  test('maps error status to error', () => {
    const run = mapGatewayRun({
      ...baseEntry,
      status: GatewayStatus.Error,
      error: 'something broke',
    });
    expect(run.status).toBe(TaskStatus.Error);
    expect(run.error).toBe('something broke');
  });

  test('maps running action to running', () => {
    const run = mapGatewayRun({ ...baseEntry, action: 'started' });
    expect(run.status).toBe(TaskStatus.Running);
  });

  test('suppresses delivery-only error to success', () => {
    const run = mapGatewayRun({
      ...baseEntry,
      status: GatewayStatus.Error,
      error: '⚠️ ✉️ Message failed',
      deliveryStatus: 'not-delivered',
      deliveryError: '⚠️ ✉️ Message failed',
      summary: 'Agent produced a valid summary',
    });
    expect(run.status).toBe(TaskStatus.Success);
    expect(run.error).toBeNull();
  });

  test('does not suppress error when error differs from deliveryError', () => {
    const run = mapGatewayRun({
      ...baseEntry,
      status: GatewayStatus.Error,
      error: 'agent crashed',
      deliveryStatus: 'not-delivered',
      deliveryError: '⚠️ ✉️ Message failed',
    });
    expect(run.status).toBe(TaskStatus.Error);
    expect(run.error).toBe('agent crashed');
  });

  test('does not suppress error when no deliveryError is present', () => {
    const run = mapGatewayRun({
      ...baseEntry,
      status: GatewayStatus.Error,
      error: 'timeout',
    });
    expect(run.status).toBe(TaskStatus.Error);
    expect(run.error).toBe('timeout');
  });
});

describe('mapGatewayTaskState', () => {
  test('maps ok status to success', () => {
    const state = mapGatewayTaskState(
      { lastRunStatus: GatewayStatus.Ok, lastRunAtMs: 1700000000000 },
    );
    expect(state.lastStatus).toBe(TaskStatus.Success);
    expect(state.lastError).toBeNull();
  });

  test('maps error status to error', () => {
    const state = mapGatewayTaskState(
      { lastRunStatus: GatewayStatus.Error, lastError: 'fail' },
    );
    expect(state.lastStatus).toBe(TaskStatus.Error);
    expect(state.lastError).toBe('fail');
  });

  test('maps running state', () => {
    const state = mapGatewayTaskState(
      { runningAtMs: Date.now(), lastRunStatus: GatewayStatus.Ok },
    );
    expect(state.lastStatus).toBe(TaskStatus.Running);
  });

  test('suppresses delivery-only error when delivery mode is none', () => {
    const state = mapGatewayTaskState(
      {
        lastRunStatus: GatewayStatus.Error,
        lastError: '⚠️ ✉️ Message failed',
        lastDeliveryStatus: 'not-delivered',
        lastDeliveryError: '⚠️ ✉️ Message failed',
      },
      DeliveryMode.None,
    );
    expect(state.lastStatus).toBe(TaskStatus.Success);
    expect(state.lastError).toBeNull();
  });

  test('does not suppress delivery error when delivery mode is announce', () => {
    const state = mapGatewayTaskState(
      {
        lastRunStatus: GatewayStatus.Error,
        lastError: '⚠️ ✉️ Message failed',
        lastDeliveryStatus: 'not-delivered',
        lastDeliveryError: '⚠️ ✉️ Message failed',
      },
      DeliveryMode.Announce,
    );
    expect(state.lastStatus).toBe(TaskStatus.Error);
    expect(state.lastError).toBe('⚠️ ✉️ Message failed');
  });

  test('does not suppress non-delivery errors even for mode none', () => {
    const state = mapGatewayTaskState(
      {
        lastRunStatus: GatewayStatus.Error,
        lastError: 'agent timeout',
      },
      DeliveryMode.None,
    );
    expect(state.lastStatus).toBe(TaskStatus.Error);
    expect(state.lastError).toBe('agent timeout');
  });
});

describe('mapGatewayJob', () => {
  test('keeps native cron fields without legacy wrappers', () => {
    const job = mapGatewayJob({
      id: 'job-1',
      name: 'Morning brief',
      description: 'Send a summary',
      enabled: true,
      schedule: { kind: ScheduleKind.Cron, expr: '0 9 * * *', tz: 'Asia/Shanghai' },
      sessionTarget: SessionTarget.Isolated,
      wakeMode: WakeMode.Now,
      payload: {
        kind: PayloadKind.AgentTurn,
        message: 'Summarize updates',
        timeoutSeconds: 45,
      },
      delivery: {
        mode: DeliveryMode.Announce,
        channel: DeliveryChannel.Last,
        to: 'chat-1',
      },
      agentId: 'agent-42',
      sessionKey: 'session-1',
      state: {
        nextRunAtMs: 100,
        lastRunAtMs: 90,
        lastRunStatus: GatewayStatus.Skipped,
      },
      createdAtMs: 1_700_000_000_000,
      updatedAtMs: 1_700_000_100_000,
    });

    expect(job.schedule.kind).toBe(ScheduleKind.Cron);
    expect((job.schedule as { expr: string }).expr).toBe('0 9 * * *');
    expect((job.schedule as { tz: string }).tz).toBe('Asia/Shanghai');
    expect(job.payload.kind).toBe(PayloadKind.AgentTurn);
    expect((job.payload as { timeoutSeconds: number }).timeoutSeconds).toBe(45);
    expect(job.delivery).toEqual({
      mode: DeliveryMode.Announce,
      channel: DeliveryChannel.Last,
      to: 'chat-1',
    });
    expect(job.agentId).toBe('agent-42');
    expect(job.sessionKey).toBe('session-1');
    expect(job.state.lastStatus).toBe(TaskStatus.Skipped);
  });

  test('preserves agent turn model from gateway payload', () => {
    const task = mapGatewayJob({
      id: 'job-1',
      name: 'Model specific task',
      description: '',
      enabled: true,
      schedule: { kind: ScheduleKind.Cron, expr: '0 9 * * *' },
      sessionTarget: SessionTarget.Isolated,
      wakeMode: WakeMode.NextHeartbeat,
      payload: {
        kind: PayloadKind.AgentTurn,
        message: 'Run with selected model',
        model: 'lobsterai-server/qwen3.6-plus-YoudaoInner',
      },
      delivery: { mode: DeliveryMode.None },
      agentId: 'main',
      sessionKey: null,
      state: {},
      createdAtMs: 1700000000000,
      updatedAtMs: 1700000000000,
    });

    expect(task.payload).toMatchObject({
      kind: PayloadKind.AgentTurn,
      model: 'qingshu-server/qwen3.6-plus-YoudaoInner',
    });
  });
});

describe('CronJobService polling', () => {
  test('does not start the gateway just to poll task state', async () => {
    const ensureGatewayReady = vi.fn(async () => {});
    const service = new CronJobService({
      getGatewayClient: () => null,
      ensureGatewayReady,
    });

    service.startPolling();
    await Promise.resolve();
    service.stopPolling();

    expect(ensureGatewayReady).not.toHaveBeenCalled();
  });
});

describe('CronJobService run history filters', () => {
  test('passes date filters and applies status filters to job run history results', async () => {
    const request = vi.fn(async () => ({ entries: [] }));
    const service = new CronJobService({
      getGatewayClient: () => ({ request }),
      ensureGatewayReady: vi.fn(async () => {}),
    });

    await service.listRuns('job-1', 25, 50, {
      startDate: '2026-05-01',
      endDate: '2026-05-11',
      status: TaskStatus.Success,
    });

    expect(request).toHaveBeenCalledWith('cron.runs', {
      scope: 'job',
      id: 'job-1',
      limit: 75,
      offset: 0,
      sortDir: 'desc',
      startMs: new Date('2026-05-01T00:00:00').getTime(),
      endMs: new Date('2026-05-11T23:59:59').getTime(),
    });
  });

  test('passes date filters and applies status filters to all run history results', async () => {
    const request = vi.fn(async () => ({ entries: [] }));
    const service = new CronJobService({
      getGatewayClient: () => ({ request }),
      ensureGatewayReady: vi.fn(async () => {}),
    });

    await service.listAllRuns(10, 20, {
      startDate: '2026-05-03',
      endDate: '2026-05-04',
      status: TaskStatus.Error,
    });

    expect(request).toHaveBeenNthCalledWith(2, 'cron.runs', {
      scope: 'all',
      limit: 30,
      offset: 0,
      sortDir: 'desc',
      startMs: new Date('2026-05-03T00:00:00').getTime(),
      endMs: new Date('2026-05-04T23:59:59').getTime(),
    });
  });

  test('treats delivery-only errors as success when filtering global runs', async () => {
    const job = makeGatewayJob({ id: 'job-1', name: 'User task' });
    const entries = [
      { ts: 3, jobId: 'job-1', status: GatewayStatus.Ok, runAtMs: 3 },
      {
        ts: 2,
        jobId: 'job-1',
        status: GatewayStatus.Error,
        runAtMs: 2,
        error: 'delivery failed',
        deliveryError: 'delivery failed',
      },
      { ts: 1, jobId: 'job-1', status: GatewayStatus.Error, runAtMs: 1, error: 'agent failed' },
    ];
    const service = new CronJobService({
      getGatewayClient: () => ({
        request: async <T>(method: string) => {
          if (method === 'cron.list') return { jobs: [job] } as T;
          if (method === 'cron.runs') return { entries } as T;
          return {} as T;
        },
      }),
      ensureGatewayReady: vi.fn(async () => {}),
    });

    const runs = await service.listAllRuns(10, 0, { status: TaskStatus.Success });

    expect(runs.map(run => run.id)).toEqual(['job-1-3', 'job-1-2']);
  });
});

describe('CronJobService gateway delivery', () => {
  const makeGatewayJob = (overrides: Partial<Parameters<typeof mapGatewayJob>[0]> = {}) => ({
    id: 'job-1',
    name: 'Notify IM',
    description: '',
    enabled: true,
    schedule: { kind: ScheduleKind.Cron, expr: '0 9 * * *' },
    sessionTarget: SessionTarget.Isolated,
    wakeMode: WakeMode.NextHeartbeat,
    payload: {
      kind: PayloadKind.AgentTurn,
      message: 'Send a summary',
    },
    delivery: {
      mode: DeliveryMode.Announce,
      channel: 'dingtalk',
      to: 'conversation-1',
      accountId: 'dingtalk',
    },
    agentId: 'main',
    sessionKey: null,
    state: {},
    createdAtMs: 1700000000000,
    updatedAtMs: 1700000000000,
    ...overrides,
  } as Parameters<typeof mapGatewayJob>[0]);

  test('passes multi-instance accountId when adding an announce task', async () => {
    const request = vi.fn(async () => makeGatewayJob());
    const service = new CronJobService({
      getGatewayClient: () => ({ request }),
      ensureGatewayReady: vi.fn(async () => {}),
    });

    await service.addJob({
      name: 'Notify IM',
      description: '',
      enabled: true,
      schedule: { kind: ScheduleKind.Cron, expr: '0 9 * * *' },
      sessionTarget: SessionTarget.Isolated,
      wakeMode: WakeMode.NextHeartbeat,
      payload: { kind: PayloadKind.AgentTurn, message: 'Send a summary' },
      delivery: {
        mode: DeliveryMode.Announce,
        channel: 'dingtalk-connector',
        to: 'conversation-1',
        accountId: 'dingtalk',
      },
    });

    expect(request).toHaveBeenCalledWith('cron.add', expect.objectContaining({
      delivery: {
        mode: DeliveryMode.Announce,
        channel: 'dingtalk-connector',
        to: 'conversation-1',
        accountId: 'dingtalk',
      },
    }));
  });

  test('passes multi-instance accountId when updating an announce task', async () => {
    const request = vi.fn(async () => makeGatewayJob());
    const service = new CronJobService({
      getGatewayClient: () => ({ request }),
      ensureGatewayReady: vi.fn(async () => {}),
    });

    await service.updateJob('job-1', {
      delivery: {
        mode: DeliveryMode.Announce,
        channel: 'feishu',
        to: 'conversation-2',
        accountId: 'feishu-a',
      },
    });

    expect(request).toHaveBeenCalledWith('cron.update', {
      id: 'job-1',
      patch: {
        delivery: {
          mode: DeliveryMode.Announce,
          channel: 'feishu',
          to: 'conversation-2',
          accountId: 'feishu-a',
        },
      },
    });
  });
});
