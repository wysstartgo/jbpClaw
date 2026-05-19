import { TaskStatus } from '../../scheduledTask/constants';
import type {
  RunFilter,
  ScheduledTask,
  ScheduledTaskChannelOption,
  ScheduledTaskConversationOption,
  ScheduledTaskInput,
  ScheduledTaskRunEvent,
  ScheduledTaskStatusEvent,
  TaskState,
} from '../../scheduledTask/types';
import { store } from '../store';
import {
  addOrUpdateRun,
  addTask,
  appendAllRuns,
  appendRuns,
  removeTask,
  setAllRuns,
  setError,
  setLoading,
  setRuns,
  setTasks,
  updateTask,
  updateTaskState,
} from '../store/slices/scheduledTaskSlice';
import { i18nService } from './i18n';

function showToast(message: string): void {
  window.dispatchEvent(new CustomEvent('app:showToast', { detail: message }));
}

function hasTaskDataAnomaly(task: ScheduledTask): boolean {
  if (task.schedule.kind === 'every') {
    const everyMs = task.schedule.everyMs;
    if (!Number.isFinite(everyMs) || everyMs <= 0) return true;
  }
  if (task.schedule.kind === 'at') {
    const date = new Date(task.schedule.at);
    if (!Number.isFinite(date.getTime())) return true;
  }
  const values = [
    task.state.nextRunAtMs,
    task.state.lastRunAtMs,
    task.state.lastDurationMs,
    task.state.runningAtMs,
  ];
  return values.some((value) => value !== null && !Number.isFinite(value));
}

function checkTasksForAnomalies(tasks: ScheduledTask[]): void {
  const anomalous = tasks.filter(hasTaskDataAnomaly);
  if (anomalous.length === 0) return;
  const message = i18nService.t('scheduledTasksDataAnomalyWarning').replace('{name}', anomalous[0].name);
  showToast(message);
}

export class ScheduledTaskService {
  private cleanupFns: (() => void)[] = [];
  private initialized = false;
  private runningManualTaskIds = new Set<string>();

  private scheduleTaskRefresh(taskId: string, delaysMs: number[] = [1200, 5000]): void {
    const api = window.electron?.scheduledTasks;
    if (!api) return;

    delaysMs.forEach((delay) => {
      window.setTimeout(async () => {
        try {
          const result = await api.get(taskId);
          if (result.success && result.task) {
            store.dispatch(updateTask(result.task));
          }
        } catch {
          // Best-effort refresh only. Keep the optimistic state until the next push/poll.
        }
      }, delay);
    });
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    this.setupListeners();
    await this.loadTasks();
  }

  destroy(): void {
    this.cleanupFns.forEach((fn) => fn());
    this.cleanupFns = [];
    this.initialized = false;
  }

  private setupListeners(): void {
    const api = window.electron?.scheduledTasks;
    if (!api) return;

    const cleanupStatus = api.onStatusUpdate(
      (event: ScheduledTaskStatusEvent) => {
        store.dispatch(
          updateTaskState({
            taskId: event.taskId,
            taskState: event.state,
          })
        );
      }
    );
    this.cleanupFns.push(cleanupStatus);

    const cleanupRun = api.onRunUpdate(
      (event: ScheduledTaskRunEvent) => {
        store.dispatch(addOrUpdateRun(event.run));
        this.scheduleTaskRefresh(event.run.taskId, [500, 1500]);
      }
    );
    this.cleanupFns.push(cleanupRun);

    // Listen for full refresh events (e.g., after first poll or migration)
    const cleanupRefresh = api.onRefresh(() => {
      this.loadTasks();
    });
    this.cleanupFns.push(cleanupRefresh);
  }

  async loadTasks(): Promise<void> {
    const api = window.electron?.scheduledTasks;
    if (!api) return;

    store.dispatch(setLoading(true));
    try {
      const result = await api.list();
      if (result.success && result.tasks) {
        checkTasksForAnomalies(result.tasks);
        store.dispatch(setTasks(result.tasks));
      }
    } catch (err: unknown) {
      store.dispatch(setError(err instanceof Error ? err.message : String(err)));
    } finally {
      store.dispatch(setLoading(false));
    }
  }

  async createTask(input: ScheduledTaskInput): Promise<string | null> {
    const api = window.electron?.scheduledTasks;
    if (!api) return null;

    try {
      const result = await api.create(input);
      if (result.success && result.task) {
        if (hasTaskDataAnomaly(result.task)) {
          const message = i18nService.t('scheduledTasksDataAnomalyWarning').replace('{name}', result.task.name);
          showToast(message);
        }
        store.dispatch(addTask(result.task));
        return result.task.id;
      } else {
        throw new Error(result.error || 'Failed to create task');
      }
    } catch (err: unknown) {
      store.dispatch(setError(err instanceof Error ? err.message : String(err)));
      throw err;
    }
  }

  async updateTaskById(
    id: string,
    input: Partial<ScheduledTaskInput>
  ): Promise<void> {
    const api = window.electron?.scheduledTasks;
    if (!api) return;

    try {
      const result = await api.update(id, input);
      if (result.success && result.task) {
        store.dispatch(updateTask(result.task));
      } else if (!result.success) {
        const errorMsg = result.error || 'Failed to update task';
        store.dispatch(setError(errorMsg));
        throw new Error(errorMsg);
      }
    } catch (err: unknown) {
      store.dispatch(setError(err instanceof Error ? err.message : String(err)));
      throw err;
    }
  }

  async deleteTask(id: string): Promise<void> {
    const api = window.electron?.scheduledTasks;
    if (!api) return;

    try {
      const result = await api.delete(id);
      if (result.success) {
        store.dispatch(removeTask(id));
      }
    } catch (err: unknown) {
      store.dispatch(setError(err instanceof Error ? err.message : String(err)));
      throw err;
    }
  }

  async toggleTask(id: string, enabled: boolean): Promise<string | null> {
    const api = window.electron?.scheduledTasks;
    if (!api) return null;

    try {
      const result = await api.toggle(id, enabled);
      if (result.success && result.task) {
        store.dispatch(updateTask(result.task));
      }
      return result.warning ?? null;
    } catch (err: unknown) {
      store.dispatch(setError(err instanceof Error ? err.message : String(err)));
      throw err;
    }
  }

  async runManually(id: string): Promise<void> {
    const api = window.electron?.scheduledTasks;
    if (!api) return;

    if (this.runningManualTaskIds.has(id)) {
      return;
    }

    const task = store.getState().scheduledTask.tasks.find((item) => item.id === id);
    if (task?.state.runningAtMs) {
      return;
    }

    this.runningManualTaskIds.add(id);
    const previousState: TaskState | null = task
      ? { ...task.state }
      : null;
    let manualStartedAtMs: number | null = null;

    if (task) {
      const now = Date.now();
      manualStartedAtMs = now;
      store.dispatch(setError(null));
      store.dispatch(updateTaskState({
        taskId: id,
        taskState: {
          ...task.state,
          runningAtMs: now,
          lastStatus: TaskStatus.Running,
          lastError: null,
        },
      }));
      store.dispatch(addOrUpdateRun({
        id: `pending-manual-${id}`,
        taskId: id,
        taskName: task.name,
        sessionId: null,
        sessionKey: task.sessionKey ?? null,
        status: TaskStatus.Running,
        startedAt: new Date(now).toISOString(),
        finishedAt: null,
        durationMs: null,
        error: null,
      }));
    }

    try {
      const result = await api.runManually(id);
      if (!result.success) {
        throw new Error(result.error || 'Failed to run task');
      }
      this.scheduleTaskRefresh(id);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (previousState) {
        store.dispatch(updateTaskState({
          taskId: id,
          taskState: previousState,
        }));
      }
      if (task && manualStartedAtMs !== null) {
        const finishedAtMs = Date.now();
        store.dispatch(addOrUpdateRun({
          id: `pending-manual-${id}`,
          taskId: id,
          taskName: task.name,
          sessionId: null,
          sessionKey: task.sessionKey ?? null,
          status: TaskStatus.Error,
          startedAt: new Date(manualStartedAtMs).toISOString(),
          finishedAt: new Date(finishedAtMs).toISOString(),
          durationMs: Math.max(0, finishedAtMs - manualStartedAtMs),
          error: errorMessage,
        }));
      }
      store.dispatch(setError(errorMessage));
      showToast(`${i18nService.t('scheduledTasksRunFailed')}：${errorMessage}`);
      throw err;
    } finally {
      this.runningManualTaskIds.delete(id);
    }
  }

  async stopTask(id: string): Promise<void> {
    const api = window.electron?.scheduledTasks;
    if (!api) return;

    try {
      await api.stop(id);
    } catch (err: unknown) {
      store.dispatch(setError(err instanceof Error ? err.message : String(err)));
      throw err;
    }
  }

  async loadRuns(taskId: string, limit = 20, offset?: number, filter?: RunFilter): Promise<void> {
    const api = window.electron?.scheduledTasks;
    if (!api) return;

    try {
      const result = await api.listRuns(taskId, limit, offset, filter);
      if (result.success && result.runs) {
        const hasMore = result.runs.length >= limit;
        if (offset && offset > 0) {
          store.dispatch(appendRuns({ taskId, runs: result.runs, hasMore }));
        } else {
          store.dispatch(setRuns({ taskId, runs: result.runs, hasMore }));
        }
      }
    } catch (err: unknown) {
      store.dispatch(setError(err instanceof Error ? err.message : String(err)));
    }
  }

  async loadAllRuns(limit?: number, offset?: number, filter?: RunFilter): Promise<void> {
    const api = window.electron?.scheduledTasks;
    if (!api) return;

    try {
      const result = await api.listAllRuns(limit, offset, filter);
      if (result.success && result.runs) {
        const hasMore = result.runs.length >= (limit ?? 20);
        if (offset && offset > 0) {
          store.dispatch(appendAllRuns({ runs: result.runs, hasMore }));
        } else {
          store.dispatch(setAllRuns({ runs: result.runs, hasMore }));
        }
      }
    } catch (err: unknown) {
      store.dispatch(setError(err instanceof Error ? err.message : String(err)));
    }
  }

  async listChannels(): Promise<ScheduledTaskChannelOption[]> {
    const api = window.electron?.scheduledTasks;
    if (!api?.listChannels) return [];

    try {
      const result = await api.listChannels();
      return result.success && result.channels ? result.channels : [];
    } catch (err: unknown) {
      store.dispatch(setError(err instanceof Error ? err.message : String(err)));
      return [];
    }
  }

  async listChannelConversations(
    channel: string,
    accountId?: string,
    filterAccountId?: string,
  ): Promise<ScheduledTaskConversationOption[]> {
    const api = window.electron?.scheduledTasks;
    if (!api?.listChannelConversations) return [];

    try {
      const result = await api.listChannelConversations(channel, accountId, filterAccountId);
      return result.success && result.conversations ? result.conversations : [];
    } catch {
      return [];
    }
  }
}

export const scheduledTaskService = new ScheduledTaskService();
