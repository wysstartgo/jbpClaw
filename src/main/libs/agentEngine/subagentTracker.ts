import crypto from 'node:crypto';

import type { SubagentMessageStore } from '../../subagentMessageStore';
import type { SubagentRunStore } from '../../subagentRunStore';
import {
  extractGatewayMessageText,
  shouldSuppressHeartbeatText,
} from '../openclawHistory';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
};

const resolveToolInput = (block: Record<string, unknown>): Record<string, unknown> => {
  if (isRecord(block.input)) return block.input;
  if (isRecord(block.args)) return block.args;
  if (isRecord(block.arguments)) return block.arguments;
  if (typeof block.arguments === 'string') {
    try {
      const parsed = JSON.parse(block.arguments);
      if (isRecord(parsed)) return parsed;
    } catch { /* ignore parse errors */ }
  }
  if (typeof block.input === 'string') {
    try {
      const parsed = JSON.parse(block.input);
      if (isRecord(parsed)) return parsed;
    } catch { /* ignore parse errors */ }
  }
  return {};
};

export interface SubagentCoworkMessage {
  id: string;
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system';
  content: string;
  timestamp: number;
  metadata?: {
    toolName?: string;
    toolInput?: Record<string, unknown>;
    toolResult?: string;
    toolUseId?: string | null;
    isError?: boolean;
    [key: string]: unknown;
  };
}

export type GatewayClientLike = {
  request: <T = Record<string, unknown>>(
    method: string,
    params?: unknown,
    opts?: { expectFinal?: boolean; timeoutMs?: number | null },
  ) => Promise<T>;
};

interface GatewaySessionDeleteTask {
  sessionKey: string;
  attempt: number;
}

const GATEWAY_SESSION_DELETE_CONCURRENCY = 2;
const GATEWAY_SESSION_DELETE_MAX_ATTEMPTS = 3;
const GATEWAY_SESSION_DELETE_BASE_DELAY_MS = 5_000;
const GATEWAY_SESSION_DELETE_MAX_DELAY_MS = 20_000;

/**
 * Encapsulates all subagent (child session) tracking logic:
 * state maps, lifecycle detection, history fetching, and persistence.
 *
 * All in-memory maps are keyed by toolCallId (unique per spawn invocation)
 * to avoid collisions when multiple subagents share the same agentId.
 */
export class SubagentTracker {
  private readonly subagentSessionKeys = new Map<string, string>();
  private readonly subagentMessages = new Map<string, SubagentCoworkMessage[]>();
  private readonly subagentToolCallIdToAgentId = new Map<string, string>();
  private readonly subagentStatus = new Map<string, 'running' | 'done' | 'error'>();
  private readonly agentIdToToolCallIds = new Map<string, Set<string>>();
  private readonly deletedSubagentRunIds = new Set<string>();
  private readonly gatewaySessionDeleteQueue = new Map<string, GatewaySessionDeleteTask>();
  private readonly gatewaySessionDeleteInFlight = new Set<string>();
  private readonly gatewaySessionDeleteRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Pending spawn info stored at tool start, used for DB insertion when result arrives */
  private readonly pendingSpawnInfo = new Map<string, {
    agentId: string;
    task: string | null;
    label: string | null;
    parentSessionId: string;
    createdAt: number;
  }>();

  constructor(
    private readonly store: SubagentRunStore,
    private readonly messageStore: SubagentMessageStore | null,
    private readonly getGatewayClient: () => GatewayClientLike | null,
  ) {}

  onToolStart(toolCallId: string, args: Record<string, unknown>, sessionId: string): void {
    this.deletedSubagentRunIds.delete(toolCallId);
    const agentId = typeof args.agentId === 'string' && args.agentId
      ? args.agentId
      : typeof args.taskName === 'string' && args.taskName
        ? args.taskName
        : typeof args.label === 'string' && args.label
          ? args.label
          : toolCallId;
    const task = typeof args.task === 'string' ? args.task : '';
    const label = typeof args.label === 'string' ? args.label : undefined;
    if (!agentId) return;

    if (!this.subagentMessages.has(toolCallId)) {
      this.subagentMessages.set(toolCallId, []);
    }
    this.subagentToolCallIdToAgentId.set(toolCallId, agentId);
    let toolCallIds = this.agentIdToToolCallIds.get(agentId);
    if (!toolCallIds) {
      toolCallIds = new Set();
      this.agentIdToToolCallIds.set(agentId, toolCallIds);
    }
    toolCallIds.add(toolCallId);
    this.pendingSpawnInfo.set(toolCallId, {
      agentId,
      task: task || null,
      label: label ?? null,
      parentSessionId: sessionId,
      createdAt: Date.now(),
    });
  }

  onSpawnResult(toolCallId: string, resultText: string): void {
    if (!resultText || !this.subagentToolCallIdToAgentId.has(toolCallId)) return;
    if (this.deletedSubagentRunIds.has(toolCallId)) return;
    try {
      const parsed = JSON.parse(resultText);
      this.commitSpawnResult(toolCallId, parsed);
    } catch { /* result may not be JSON */ }
  }

  onBackfillResult(toolCallId: string, text: string): void {
    if (!this.subagentToolCallIdToAgentId.has(toolCallId)) return;
    if (this.deletedSubagentRunIds.has(toolCallId)) return;
    try {
      const parsed = JSON.parse(text);
      this.commitSpawnResult(toolCallId, parsed);
    } catch { /* not JSON */ }
  }

  onResumeOrReadResult(args: Record<string, unknown>): void {
    const agentId = typeof args.agentId === 'string' ? args.agentId : '';
    if (!agentId) return;
    const toolCallIds = this.agentIdToToolCallIds.get(agentId);
    if (!toolCallIds) return;
    for (const runId of toolCallIds) {
      if (this.subagentStatus.get(runId) === 'running') {
        this.subagentStatus.set(runId, 'done');
        this.store.updateSubagentRunStatus(runId, 'done', Date.now());
        this.tryPersistCachedMessages(runId);
      }
    }
  }

  tryMarkDoneFromAnnounceRunId(runId: string): boolean {
    const match = runId.match(/^announce:.*:subagent:([0-9a-f-]+)/i);
    if (!match) return false;
    const subagentUuid = match[1];
    for (const [toolCallId, sessionKey] of this.subagentSessionKeys) {
      if (!sessionKey.includes(subagentUuid)) continue;
      if (this.subagentStatus.get(toolCallId) !== 'done') {
        this.subagentStatus.set(toolCallId, 'done');
        this.store.updateSubagentRunStatus(toolCallId, 'done', Date.now());
        this.tryPersistCachedMessages(toolCallId);
        console.log(`[SubagentTracker] marked subagent run ${toolCallId} as done from lifecycle announce`);
      }
      return true;
    }
    console.debug(`[SubagentTracker] lifecycle announce ${runId} did not match a tracked subagent run`);
    return true;
  }

  onSessionDeleted(parentSessionId?: string): void {
    if (parentSessionId) {
      for (const run of this.store.listSubagentRuns(parentSessionId)) {
        this.deletedSubagentRunIds.add(run.id);
      }
    }
    if (parentSessionId && this.messageStore) {
      this.messageStore.deleteByParentSession(parentSessionId);
    }
    if (parentSessionId) {
      this.store.deleteSubagentRunsByParent(parentSessionId);
    }
    this.subagentSessionKeys.clear();
    this.subagentMessages.clear();
    this.subagentStatus.clear();
    this.subagentToolCallIdToAgentId.clear();
    this.agentIdToToolCallIds.clear();
    this.pendingSpawnInfo.clear();
  }

  async deleteSubagentRun(parentSessionId: string, runId: string): Promise<boolean> {
    const run = this.store.getSubagentRun(runId);
    if (!run || run.parentSessionId !== parentSessionId) {
      return false;
    }

    this.deletedSubagentRunIds.add(runId);
    const sessionKey = this.subagentSessionKeys.get(runId) || run.sessionKey;
    this.clearSubagentMemory(runId);

    if (this.messageStore) {
      this.messageStore.deleteByRunIds([runId]);
    }
    this.store.deleteSubagentRun(runId);

    if (sessionKey) {
      this.enqueueGatewaySessionDelete(sessionKey);
    }

    return true;
  }

  listSubagentRuns(parentSessionId: string): Array<{
    id: string;
    agentId: string | null;
    task: string | null;
    label: string | null;
    sessionKey: string | null;
    status: 'running' | 'done' | 'error';
    createdAt: number;
    endedAt: number | null;
  }> {
    const runs = this.store.listSubagentRuns(parentSessionId);
    return runs.map((run) => {
      const memoryStatus = this.subagentStatus.get(run.id);
      const memorySessionKey = this.subagentSessionKeys.get(run.id);
      if (run.status === 'running' && !memoryStatus) {
        this.store.updateSubagentRunStatus(run.id, 'error', Date.now());
        return { ...run, status: 'error' as const, sessionKey: memorySessionKey ?? run.sessionKey };
      }
      return {
        ...run,
        status: memoryStatus ?? run.status,
        sessionKey: memorySessionKey ?? run.sessionKey,
      };
    });
  }

  async getSubTaskHistory(
    parentSessionId: string,
    agentId: string,
    sessionKey?: string,
  ): Promise<SubagentCoworkMessage[]> {
    const runId = this.resolveRunId(parentSessionId, agentId, sessionKey);
    if (!runId) return [];

    const status = this.subagentStatus.get(runId) ?? this.store.getRunStatus(runId);
    const local = this.subagentMessages.get(runId);
    if ((status === 'done' || status === 'error') && local && local.length > 0) {
      return local;
    }

    const persisted = this.loadPersistedMessages(runId);
    if (persisted) return persisted;

    const key = sessionKey || this.subagentSessionKeys.get(runId)
      || this.store.listSubagentRuns(parentSessionId).find((run) => (
        run.id === runId
        || run.agentId === agentId
        || Boolean(run.sessionKey && (run.sessionKey.includes(runId) || run.sessionKey.includes(agentId)))
      ))?.sessionKey
      || await this.discoverSubagentSessionKey(runId);
    if (!key) return [];
    this.subagentSessionKeys.set(runId, key);
    this.store.updateSubagentRunSessionKey(runId, key);
    return this.fetchSubagentHistory(key, runId);
  }

  private resolveRunId(parentSessionId: string, agentId: string, sessionKey?: string): string | null {
    const runs = this.store.listSubagentRuns(parentSessionId);
    const run = runs.find((item) => {
      if (sessionKey && item.sessionKey !== sessionKey) return false;
      if (agentId && item.id !== agentId && item.agentId !== agentId) return false;
      return true;
    });
    return run?.id ?? null;
  }

  private commitSpawnResult(toolCallId: string, parsed: unknown): void {
    if (!isRecord(parsed)) return;
    if (this.deletedSubagentRunIds.has(toolCallId)) return;
    const childSessionKey = typeof parsed.childSessionKey === 'string' ? parsed.childSessionKey
      : typeof parsed.sessionKey === 'string' ? parsed.sessionKey
        : typeof parsed.key === 'string' ? parsed.key
          : null;
    if (childSessionKey) {
      this.subagentSessionKeys.set(toolCallId, childSessionKey);
      this.store.updateSubagentRunSessionKey(toolCallId, childSessionKey);
    }

    const errorText = typeof parsed.error === 'string' ? parsed.error.trim() : '';
    const status = parsed.status === 'error' || errorText ? 'error' : 'running';

    if (this.subagentStatus.has(toolCallId)) {
      if (status === 'error' && this.subagentStatus.get(toolCallId) !== 'error') {
        this.subagentStatus.set(toolCallId, 'error');
        this.store.updateSubagentRunStatus(toolCallId, 'error', Date.now());
        console.log(`[SubagentTracker] marked subagent spawn ${toolCallId} as failed from result`);
      }
      return;
    }

    const info = this.pendingSpawnInfo.get(toolCallId);
    if (!info) return;
    this.subagentStatus.set(toolCallId, status);
    this.store.insertSubagentRun({
      id: toolCallId,
      parentSessionId: info.parentSessionId,
      sessionKey: childSessionKey,
      agentId: info.agentId,
      task: info.task,
      label: info.label,
      status,
      createdAt: info.createdAt,
    });
    if (status === 'error') {
      this.store.updateSubagentRunStatus(toolCallId, 'error', Date.now());
    }
    this.pendingSpawnInfo.delete(toolCallId);
    console.log(`[SubagentTracker] committed subagent spawn ${toolCallId} with ${status} status`);
  }

  private clearSubagentMemory(runId: string): void {
    const agentId = this.subagentToolCallIdToAgentId.get(runId);
    this.subagentSessionKeys.delete(runId);
    this.subagentMessages.delete(runId);
    this.subagentStatus.delete(runId);
    this.subagentToolCallIdToAgentId.delete(runId);
    this.pendingSpawnInfo.delete(runId);

    if (agentId) {
      const toolCallIds = this.agentIdToToolCallIds.get(agentId);
      toolCallIds?.delete(runId);
      if (toolCallIds?.size === 0) {
        this.agentIdToToolCallIds.delete(agentId);
      }
    }
  }

  private enqueueGatewaySessionDelete(sessionKey: string): void {
    if (
      this.gatewaySessionDeleteQueue.has(sessionKey)
      || this.gatewaySessionDeleteInFlight.has(sessionKey)
      || this.gatewaySessionDeleteRetryTimers.has(sessionKey)
    ) {
      return;
    }

    this.gatewaySessionDeleteQueue.set(sessionKey, { sessionKey, attempt: 1 });
    this.processGatewaySessionDeleteQueue();
  }

  private processGatewaySessionDeleteQueue(): void {
    while (
      this.gatewaySessionDeleteInFlight.size < GATEWAY_SESSION_DELETE_CONCURRENCY
      && this.gatewaySessionDeleteQueue.size > 0
    ) {
      const task = this.gatewaySessionDeleteQueue.values().next().value as GatewaySessionDeleteTask | undefined;
      if (!task) return;
      this.gatewaySessionDeleteQueue.delete(task.sessionKey);
      this.gatewaySessionDeleteInFlight.add(task.sessionKey);
      void this.runGatewaySessionDeleteTask(task);
    }
  }

  private async runGatewaySessionDeleteTask(task: GatewaySessionDeleteTask): Promise<void> {
    try {
      const deleted = await this.deleteGatewaySession(task.sessionKey);
      if (!deleted) {
        this.scheduleGatewaySessionDeleteRetry(task);
      }
    } finally {
      this.gatewaySessionDeleteInFlight.delete(task.sessionKey);
      this.processGatewaySessionDeleteQueue();
    }
  }

  private scheduleGatewaySessionDeleteRetry(task: GatewaySessionDeleteTask): void {
    if (task.attempt >= GATEWAY_SESSION_DELETE_MAX_ATTEMPTS) {
      console.warn('[SubagentTracker] gateway subagent session cleanup reached the retry limit');
      return;
    }

    const delayMs = Math.min(
      GATEWAY_SESSION_DELETE_BASE_DELAY_MS * (2 ** (task.attempt - 1)),
      GATEWAY_SESSION_DELETE_MAX_DELAY_MS,
    );
    const timer = setTimeout(() => {
      this.gatewaySessionDeleteRetryTimers.delete(task.sessionKey);
      this.gatewaySessionDeleteQueue.set(task.sessionKey, {
        sessionKey: task.sessionKey,
        attempt: task.attempt + 1,
      });
      this.processGatewaySessionDeleteQueue();
    }, delayMs);
    this.gatewaySessionDeleteRetryTimers.set(task.sessionKey, timer);
    console.warn('[SubagentTracker] gateway subagent session cleanup failed, retrying later');
  }

  private async deleteGatewaySession(sessionKey: string): Promise<boolean> {
    const client = this.getGatewayClient();
    if (!client) return false;

    try {
      await client.request('sessions.delete', {
        key: sessionKey,
        deleteTranscript: true,
      }, { timeoutMs: 5_000 });
      return true;
    } catch (error) {
      console.warn('[SubagentTracker] Failed to delete gateway subagent session:', error);
      return false;
    }
  }

  private async discoverSubagentSessionKey(runId: string): Promise<string | null> {
    const client = this.getGatewayClient();
    if (!client) return null;
    const agentId = this.subagentToolCallIdToAgentId.get(runId) || runId;
    try {
      const result = await client.request<{ sessions?: unknown[] }>('sessions.list', {
        activeMinutes: 120,
      }, { timeoutMs: 10_000 });
      const sessions = Array.isArray(result?.sessions) ? result.sessions : [];
      for (const session of sessions) {
        if (!isRecord(session)) continue;
        const key = typeof session.key === 'string' ? session.key : '';
        if (
          key.includes(runId)
          || key.includes(`:${agentId}:`)
          || key.includes(`:${agentId}`)
          || key.includes(`subagent:${agentId}`)
        ) {
          return key;
        }
      }
    } catch (error) {
      console.warn(`[SubagentTracker] failed to discover a session key for subagent run ${runId}:`, error);
    }
    return null;
  }

  private async fetchSubagentHistory(sessionKey: string, runId: string): Promise<SubagentCoworkMessage[]> {
    const client = this.getGatewayClient();
    if (!client) return [];
    try {
      const history = await client.request<{ messages?: unknown[] }>('chat.history', {
        sessionKey,
        limit: 200,
      }, { timeoutMs: 15_000 });
      const messages: SubagentCoworkMessage[] = [];
      let timestamp = Date.now() - (history.messages?.length ?? 0) * 1000;
      for (const raw of history.messages ?? []) {
        if (!isRecord(raw)) continue;
        const role = typeof raw.role === 'string' ? raw.role.trim().toLowerCase() : '';
        const text = extractGatewayMessageText(raw).trim();
        if (text && shouldSuppressHeartbeatText(role as 'user' | 'assistant' | 'system', text)) continue;

        if (role === 'user' && Array.isArray(raw.content)) {
          let hasToolResult = false;
          for (const block of raw.content) {
            if (!isRecord(block)) continue;
            const blockType = typeof block.type === 'string' ? block.type : '';
            if (blockType !== 'tool_result') continue;
            hasToolResult = true;
            const resultText = typeof block.content === 'string'
              ? block.content
              : extractGatewayMessageText(block).trim();
            if (!resultText) continue;
            messages.push({
              id: crypto.randomUUID(),
              type: 'tool_result',
              content: resultText,
              timestamp: timestamp++,
              metadata: {
                toolResult: resultText,
                toolUseId: typeof block.tool_use_id === 'string' ? block.tool_use_id : null,
                isError: block.is_error === true,
              },
            });
          }
          if (text && !shouldSuppressHeartbeatText('user', text)) {
            messages.push({
              id: crypto.randomUUID(),
              type: 'user',
              content: text,
              timestamp: timestamp++,
            });
          }
          if (hasToolResult || text) continue;
        }

        if (role === 'user' && text) {
          messages.push({
            id: crypto.randomUUID(),
            type: 'user',
            content: text,
            timestamp: timestamp++,
          });
          continue;
        }

        if (role === 'assistant' && Array.isArray(raw.content)) {
          for (const block of raw.content) {
            if (!isRecord(block)) continue;
            const blockType = typeof block.type === 'string' ? block.type : '';
            if (blockType === 'tool_use' || blockType === 'tool_call' || blockType === 'toolCall') {
              const toolUseId = typeof block.id === 'string' ? block.id : crypto.randomUUID();
              const toolName = typeof block.name === 'string' ? block.name : 'Tool';
              messages.push({
                id: crypto.randomUUID(),
                type: 'tool_use',
                content: `Using tool: ${toolName}`,
                timestamp: timestamp++,
                metadata: {
                  toolName,
                  toolInput: resolveToolInput(block),
                  toolUseId,
                },
              });
            }
          }
        }

        if (role === 'assistant' && text) {
          messages.push({
            id: crypto.randomUUID(),
            type: 'assistant',
            content: text,
            timestamp: timestamp++,
          });
          continue;
        }

        if ((role === 'tool_result' || role === 'toolresult' || role === 'tool' || role === 'function') && text) {
          const toolName = typeof raw.toolName === 'string' ? raw.toolName
            : typeof raw.tool_name === 'string' ? raw.tool_name
              : typeof raw.name === 'string' ? raw.name : undefined;
          const toolUseId = typeof raw.tool_use_id === 'string' ? raw.tool_use_id
            : typeof raw.toolCallId === 'string' ? raw.toolCallId
              : typeof raw.tool_call_id === 'string' ? raw.tool_call_id : null;
          messages.push({
            id: crypto.randomUUID(),
            type: 'tool_result',
            content: text,
            timestamp: timestamp++,
            metadata: {
              toolName,
              toolResult: text,
              toolUseId,
              isError: Boolean(raw.isError),
            },
          });
          continue;
        }

        if (!role && Array.isArray(raw.content)) {
          for (const block of raw.content) {
            if (!isRecord(block)) continue;
            const blockType = typeof block.type === 'string' ? block.type : '';
            if (blockType === 'tool_use' || blockType === 'tool_call' || blockType === 'toolCall') {
              const toolUseId = typeof block.id === 'string' ? block.id : crypto.randomUUID();
              const toolName = typeof block.name === 'string' ? block.name : 'Tool';
              messages.push({
                id: crypto.randomUUID(),
                type: 'tool_use',
                content: `Using tool: ${toolName}`,
                timestamp: timestamp++,
                metadata: {
                  toolName,
                  toolInput: resolveToolInput(block),
                  toolUseId,
                },
              });
            } else if (blockType === 'text' && typeof block.text === 'string' && block.text.trim()) {
              messages.push({
                id: crypto.randomUUID(),
                type: 'assistant',
                content: block.text.trim(),
                timestamp: timestamp++,
              });
            }
          }
        }
      }

      this.subagentMessages.set(runId, messages);
      const status = this.subagentStatus.get(runId) ?? this.store.getRunStatus(runId);
      if ((status === 'done' || status === 'error') && messages.length > 0) {
        this.persistMessages(runId, messages);
      }
      console.log(`[SubagentTracker] fetched ${messages.length} messages for subagent run ${runId}`);
      return messages;
    } catch (error) {
      console.warn(`[SubagentTracker] failed to fetch history for subagent run ${runId}:`, error);
      return [];
    }
  }

  private loadPersistedMessages(runId: string): SubagentCoworkMessage[] | null {
    if (!this.messageStore?.hasMessages(runId)) return null;
    const messages = this.messageStore.getMessages(runId).map((row) => ({
      id: row.id,
      type: row.type as SubagentCoworkMessage['type'],
      content: row.content,
      timestamp: row.createdAt,
      metadata: row.metadata ? JSON.parse(row.metadata) as SubagentCoworkMessage['metadata'] : undefined,
    }));
    this.subagentMessages.set(runId, messages);
    return messages;
  }

  private persistMessages(runId: string, messages: SubagentCoworkMessage[]): void {
    if (!this.messageStore || this.store.isMessagesPersisted(runId)) return;
    this.messageStore.insertMessages(runId, messages.map((message, index) => ({
      id: message.id,
      type: message.type,
      content: message.content,
      metadata: message.metadata ?? null,
      timestamp: message.timestamp,
      sequence: index,
    })));
    this.store.markMessagesPersisted(runId);
  }

  private tryPersistCachedMessages(runId: string): void {
    const messages = this.subagentMessages.get(runId);
    if (!messages || messages.length === 0) return;
    this.persistMessages(runId, messages);
  }
}
