import path from 'node:path';

import { expect, test, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
    getPath: () => process.cwd(),
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

import {
  __openclawRuntimeAdapterTestUtils,
  OpenClawRuntimeAdapter,
  pickPersistedAssistantSegment,
} from './openclawRuntimeAdapter';

test('mergeStreamingText appends delta chunks without stripping repeated boundary characters', () => {
  expect(__openclawRuntimeAdapterTestUtils.mergeStreamingText('saved report.p', 'ptx', 'delta')).toEqual({
    text: 'saved report.pptx',
    mode: 'delta',
  });
});

test('mergeStreamingText keeps snapshot upgrade when incoming contains previous text', () => {
  expect(__openclawRuntimeAdapterTestUtils.mergeStreamingText('hello', 'hello world', 'unknown')).toEqual({
    text: 'hello world',
    mode: 'snapshot',
  });
});

test('mergeStreamingText preserves previous snapshot when incoming is shorter', () => {
  expect(__openclawRuntimeAdapterTestUtils.mergeStreamingText('hello world', 'hello', 'snapshot')).toEqual({
    text: 'hello world',
    mode: 'snapshot',
  });
});

test('computeContextPercent uses positive finite input and caps at 100', () => {
  expect(__openclawRuntimeAdapterTestUtils.computeContextPercent(100, 400)).toBe(25);
  expect(__openclawRuntimeAdapterTestUtils.computeContextPercent(600, 400)).toBe(100);
  expect(__openclawRuntimeAdapterTestUtils.computeContextPercent(0, 400)).toBeUndefined();
  expect(__openclawRuntimeAdapterTestUtils.computeContextPercent(100, 0)).toBeUndefined();
});

test('pickPersistedAssistantSegment: stream authority keeps previous when same length or longer', () => {
  expect(pickPersistedAssistantSegment('aa', 'a', true)).toEqual({
    content: 'aa',
    reason: 'stream_authority_same_or_longer',
  });
  expect(pickPersistedAssistantSegment('same', 'same', true)).toEqual({
    content: 'same',
    reason: 'stream_authority_same_or_longer',
  });
});

test('pickPersistedAssistantSegment: stream shorter prefers chat.final payload', () => {
  expect(pickPersistedAssistantSegment('a', 'final-longer', true)).toEqual({
    content: 'final-longer',
    reason: 'stream_shorter_prefer_chat_final',
  });
});

test('pickPersistedAssistantSegment: chat-only path prefers chat.final extraction', () => {
  expect(pickPersistedAssistantSegment('fromDelta', 'fromFinal', false)).toEqual({
    content: 'fromFinal',
    reason: 'chat_path_prefer_final',
  });
});

test('pickPersistedAssistantSegment: empty branches', () => {
  expect(pickPersistedAssistantSegment('', '', false)).toEqual({
    content: '',
    reason: 'both_empty',
  });
  expect(pickPersistedAssistantSegment('', 'fin', false)).toEqual({
    content: 'fin',
    reason: 'final_only',
  });
  expect(pickPersistedAssistantSegment('prev', '', false)).toEqual({
    content: 'prev',
    reason: 'previous_only',
  });
});

// ==================== Reconcile tests ====================

function createReconcileStore(messages: Array<Record<string, unknown>>) {
  const session = {
    id: 'session-1',
    title: 'Test Session',
    claudeSessionId: null,
    status: 'completed',
    pinned: false,
    cwd: '',
    systemPrompt: '',
    modelOverride: '',
    executionMode: 'local',
    activeSkillIds: [],
    messages: [...messages],
    createdAt: 1,
    updatedAt: 1,
  };
  let nextId = session.messages.length + 1;
  let replaceCallCount = 0;
  let lastReplaceArgs: { sessionId: string; authoritative: unknown[] } | null = null;

  return {
    session,
    getReplaceCallCount: () => replaceCallCount,
    getLastReplaceArgs: () => lastReplaceArgs,
    store: {
      getSession: (sessionId: string) => (sessionId === session.id ? session : null),
      addMessage: (sessionId: string, message: Record<string, unknown>) => {
        expect(sessionId).toBe(session.id);
        const created = {
          id: `msg-${nextId++}`,
          timestamp: nextId,
          metadata: {},
          ...message,
        };
        session.messages.push(created);
        return created;
      },
      updateSession: (sessionId: string, patch: Record<string, unknown>) => {
        expect(sessionId).toBe(session.id);
        Object.assign(session, patch);
      },
      updateMessage: (sessionId: string, messageId: string, patch: Record<string, unknown>) => {
        expect(sessionId).toBe(session.id);
        const message = session.messages.find((m) => m.id === messageId);
        if (!message) return false;
        Object.assign(message, patch);
        return true;
      },
      replaceConversationMessages: (sessionId: string, authoritative: Array<{ role: string; text: string; metadata?: Record<string, unknown>; timestamp?: number }>) => {
        replaceCallCount++;
        lastReplaceArgs = { sessionId, authoritative };
        // Simulate: remove old user/assistant, insert new ones
        session.messages = session.messages.filter(
          (m) => m.type !== 'user' && m.type !== 'assistant',
        );
        for (const entry of authoritative) {
          session.messages.push({
            id: `msg-${nextId++}`,
            type: entry.role,
            content: entry.text,
            metadata: { isStreaming: false, isFinal: true, ...(entry.metadata ?? {}) },
            timestamp: entry.timestamp ?? nextId,
          });
        }
      },
      deleteMessage: () => true,
    },
  };
}

test('reconcileWithHistory: already in sync — skips replace', async () => {
  const { session, store, getReplaceCallCount } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'Hello', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'Hi there', timestamp: 2, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getReplaceCallCount()).toBe(0);
  expect(session.messages.length).toBe(2);
});

test('reconcileWithHistory: missing assistant message — triggers replace', async () => {
  const { session, store, getReplaceCallCount, getLastReplaceArgs } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'Hello', timestamp: 1, metadata: {} },
    // assistant message missing locally
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getReplaceCallCount()).toBe(1);
  const args = getLastReplaceArgs()!;
  expect(args.sessionId).toBe(session.id);
  expect(args.authoritative).toEqual([
    { role: 'user', text: 'Hello', timestamp: 1 },
    { role: 'assistant', text: 'Hi there' },
  ]);
});

test('reconcileWithHistory: preserves assistant usage and model metadata', async () => {
  const { session, store, getReplaceCallCount, getLastReplaceArgs } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'Hello', timestamp: 1, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'Hello' },
        {
          role: 'assistant',
          content: 'Hi there',
          model: 'qwen3.6-plus',
          usage: {
            inputTokens: 100,
            outputTokens: 20,
            cacheReadTokens: 80,
          },
        },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'agent:main:feishu:account:direct:user');

  expect(getReplaceCallCount()).toBe(1);
  expect(getLastReplaceArgs()?.authoritative).toEqual([
    { role: 'user', text: 'Hello', timestamp: 1 },
    {
      role: 'assistant',
      text: 'Hi there',
      metadata: {
        isStreaming: false,
        isFinal: true,
        model: 'qwen3.6-plus',
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 80,
        },
      },
    },
  ]);
  expect(session.messages.find((message) => message.type === 'assistant')?.metadata).toMatchObject({
    model: 'qwen3.6-plus',
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 80,
    },
  });
});

test('reconcileWithHistory: enriches assistant context percent from sessions.list', async () => {
  const { session, store, getReplaceCallCount, getLastReplaceArgs } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'Hello', timestamp: 1, metadata: {} },
  ]);
  const sessionKey = 'agent:main:feishu:account:direct:user';

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            { key: sessionKey, contextTokens: 400 },
          ],
        };
      }
      return {
        messages: [
          { role: 'user', content: 'Hello' },
          {
            role: 'assistant',
            content: 'Hi there',
            model: 'qwen3.6-plus',
            usage: {
              inputTokens: 100,
              outputTokens: 20,
            },
          },
        ],
      };
    },
  };

  await adapter.reconcileWithHistory(session.id, sessionKey);

  expect(getReplaceCallCount()).toBe(1);
  expect(getLastReplaceArgs()?.authoritative).toEqual([
    { role: 'user', text: 'Hello', timestamp: 1 },
    {
      role: 'assistant',
      text: 'Hi there',
      metadata: {
        isStreaming: false,
        isFinal: true,
        contextPercent: 25,
        model: 'qwen3.6-plus',
        usage: {
          inputTokens: 100,
          outputTokens: 20,
        },
      },
    },
  ]);
});

test('reconcileWithHistory: carries gateway timestamps into replacement entries', async () => {
  const { session, store, getReplaceCallCount, getLastReplaceArgs } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'Hello', timestamp: 1, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'Hello', timestamp: 1_000 },
        { role: 'assistant', content: 'Hi there', timestamp: 2_000 },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'agent:main:feishu:account:direct:user');

  expect(getReplaceCallCount()).toBe(1);
  expect(getLastReplaceArgs()?.authoritative).toEqual([
    { role: 'user', text: 'Hello', timestamp: 1_000 },
    { role: 'assistant', text: 'Hi there', timestamp: 2_000 },
  ]);
});

test('reconcileWithHistory: filters heartbeat prompt and ack entries', async () => {
  const { session, store, getReplaceCallCount, getLastReplaceArgs } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'Hello', timestamp: 1, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'Hello' },
        {
          role: 'user',
          content: `Read HEARTBEAT.md if it exists.
When reading HEARTBEAT.md, use workspace file /tmp/HEARTBEAT.md.
Do not infer or repeat old tasks from prior chats.
If nothing needs attention, reply HEARTBEAT_OK.`,
        },
        { role: 'assistant', content: 'HEARTBEAT_OK' },
        { role: 'assistant', content: 'Real answer' },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getReplaceCallCount()).toBe(1);
  expect(getLastReplaceArgs()?.authoritative).toEqual([
    { role: 'user', text: 'Hello', timestamp: 1 },
    { role: 'assistant', text: 'Real answer' },
  ]);
});

test('reconcileWithHistory: duplicate messages locally — triggers replace', async () => {
  const { session, store, getReplaceCallCount, getLastReplaceArgs } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'Hello', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'Hi there', timestamp: 2, metadata: {} },
    { id: 'msg-3', type: 'assistant', content: 'Hi there', timestamp: 3, metadata: {} }, // duplicate
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  // Gateway is authoritative — replaces to fix duplicates
  expect(getReplaceCallCount()).toBe(1);
  const args = getLastReplaceArgs()!;
  expect(args.authoritative.length).toBe(2);
});

test('reconcileWithHistory: content mismatch — triggers replace', async () => {
  const { session, store, getReplaceCallCount, getLastReplaceArgs } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'Hello', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'Streaming partial...', timestamp: 2, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Full complete response from the model.' },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getReplaceCallCount()).toBe(1);
  const args = getLastReplaceArgs()!;
  expect((args.authoritative[1] as Record<string, unknown>).text).toBe('Full complete response from the model.');
});

test('lifecycle fallback repairs managed session assistant text from history', async () => {
  const brokenTable = [
    'OpenClaw 优缺点总结',
    '',
    '| 维度 | 优点 ✅ | 缺点 ❌ |',
    '|---------|',
    '| 架构设计 | 单 Gateway | 单点风险 |',
  ].join('\n');
  const finalTable = [
    'OpenClaw 优缺点总结',
    '',
    '| 维度 | 优点 ✅ | 缺点 ❌ |',
    '|------|---------|---------|',
    '| 架构设计 | 单 Gateway | 单点风险 |',
  ].join('\n');
  const { session, store, getReplaceCallCount } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: '以表格总结 OpenClaw', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: brokenTable, timestamp: 2, metadata: { isStreaming: true } },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: '以表格总结 OpenClaw' },
        { role: 'assistant', content: finalTable },
      ],
    }),
  };

  const turn = {
    sessionId: session.id,
    sessionKey: `agent:main:lobsterai:${session.id}`,
    runId: 'run-1',
    turnToken: 1,
    startedAtMs: 1,
    knownRunIds: new Set(['run-1']),
    assistantMessageId: 'msg-2',
    committedAssistantText: '',
    currentAssistantSegmentText: brokenTable,
    currentText: brokenTable,
    agentAssistantTextLength: brokenTable.length,
    currentContentText: brokenTable,
    currentContentBlocks: [brokenTable],
    sawNonTextContentBlocks: false,
    textStreamMode: 'snapshot',
    toolUseMessageIdByToolCallId: new Map(),
    toolResultMessageIdByToolCallId: new Map(),
    toolResultTextByToolCallId: new Map(),
    stopRequested: false,
    pendingUserSync: false,
    bufferedChatPayloads: [],
    bufferedAgentPayloads: [],
  };

  adapter.activeTurns.set(session.id, turn);
  adapter.latestTurnTokenBySession.set(session.id, turn.turnToken);

  await adapter.completeChannelTurnFallback(session.id, turn);

  expect(getReplaceCallCount()).toBe(0);
  expect(session.messages.find((message) => message.id === 'msg-2')?.content).toBe(finalTable);
  expect(session.status).toBe('completed');
});

test('syncFinalAssistantWithHistory creates assistant message when final payload had no text', async () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: '请总结杭州和上海老乡鸡流量供需', timestamp: 1, metadata: {} },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const emittedMessages: Array<Record<string, unknown>> = [];
  const sessionKey = `agent:main:lobsterai:${session.id}`;
  const turn = {
    sessionId: session.id,
    sessionKey,
    runId: 'run-empty-final',
    turnToken: 1,
    startedAtMs: 1,
    knownRunIds: new Set(['run-empty-final']),
    assistantMessageId: null,
    committedAssistantText: '',
    currentAssistantSegmentText: '',
    currentText: '',
    agentAssistantTextLength: 0,
    hasSeenAgentAssistantStream: false,
    currentContentText: '',
    currentContentBlocks: [],
    sawNonTextContentBlocks: false,
    textStreamMode: 'unknown',
    toolUseMessageIdByToolCallId: new Map(),
    toolResultMessageIdByToolCallId: new Map(),
    toolResultTextByToolCallId: new Map(),
    stopRequested: false,
    pendingUserSync: false,
    bufferedChatPayloads: [],
    bufferedAgentPayloads: [],
  };

  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: '请总结杭州和上海老乡鸡流量供需' },
        {
          role: 'assistant',
          content: '杭州和上海老乡鸡流量供需分析已完成。',
          model: 'qwen3.6-plus',
          usage: {
            input: 180,
            output: 32,
            cacheRead: 90,
          },
        },
      ],
    }),
  };
  adapter.latestTurnTokenBySession.set(session.id, turn.turnToken);
  adapter.on('message', (_sessionId, message) => {
    emittedMessages.push(message);
  });

  await adapter.syncFinalAssistantWithHistory(session.id, turn);

  const assistantMessages = session.messages.filter((message) => message.type === 'assistant');
  expect(assistantMessages).toHaveLength(1);
  expect(assistantMessages[0]).toMatchObject({
    content: '杭州和上海老乡鸡流量供需分析已完成。',
    metadata: {
      isStreaming: false,
      isFinal: true,
      model: 'qwen3.6-plus',
      usage: {
        inputTokens: 180,
        outputTokens: 32,
        cacheReadTokens: 90,
      },
    },
  });
  expect(turn.assistantMessageId).toBe(assistantMessages[0].id);
  expect(turn.currentText).toBe('杭州和上海老乡鸡流量供需分析已完成。');
  expect(emittedMessages).toHaveLength(1);
  expect(emittedMessages[0].id).toBe(assistantMessages[0].id);
});

test('syncFinalAssistantWithHistory updates metadata when content is already current', async () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: '你是哪个模型', timestamp: 1, metadata: {} },
    {
      id: 'msg-2',
      type: 'assistant',
      content: '当前使用 qwen3.6-plus。',
      timestamp: 2,
      metadata: { isStreaming: true, isFinal: false },
    },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const emittedUpdates: Array<{ messageId: string; content: string; metadata?: Record<string, unknown> }> = [];
  const sessionKey = `agent:main:lobsterai:${session.id}`;
  const turn = {
    sessionId: session.id,
    sessionKey,
    runId: 'run-final-metadata',
    turnToken: 1,
    startedAtMs: 1,
    knownRunIds: new Set(['run-final-metadata']),
    assistantMessageId: 'msg-2',
    committedAssistantText: '',
    currentAssistantSegmentText: '当前使用 qwen3.6-plus。',
    currentText: '当前使用 qwen3.6-plus。',
    agentAssistantTextLength: '当前使用 qwen3.6-plus。'.length,
    hasSeenAgentAssistantStream: true,
    currentContentText: '当前使用 qwen3.6-plus。',
    currentContentBlocks: ['当前使用 qwen3.6-plus。'],
    sawNonTextContentBlocks: false,
    textStreamMode: 'snapshot',
    toolUseMessageIdByToolCallId: new Map(),
    toolResultMessageIdByToolCallId: new Map(),
    toolResultTextByToolCallId: new Map(),
    stopRequested: false,
    pendingUserSync: false,
    bufferedChatPayloads: [],
    bufferedAgentPayloads: [],
  };

  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: '你是哪个模型' },
        {
          role: 'assistant',
          content: '当前使用 qwen3.6-plus。',
          model: 'qwen3.6-plus',
          usage: {
            inputTokens: 80,
            outputTokens: 12,
          },
        },
      ],
    }),
  };
  adapter.latestTurnTokenBySession.set(session.id, turn.turnToken);
  adapter.on('messageUpdate', (_sessionId, messageId, content, metadata) => {
    emittedUpdates.push({ messageId, content, metadata: metadata as Record<string, unknown> | undefined });
  });

  await adapter.syncFinalAssistantWithHistory(session.id, turn);

  const assistant = session.messages.find((message) => message.id === 'msg-2');
  expect(assistant?.metadata).toMatchObject({
    isStreaming: false,
    isFinal: true,
    model: 'qwen3.6-plus',
    usage: {
      inputTokens: 80,
      outputTokens: 12,
    },
  });
  expect(emittedUpdates).toEqual([{
    messageId: 'msg-2',
    content: '当前使用 qwen3.6-plus。',
    metadata: {
      isStreaming: false,
      isFinal: true,
      model: 'qwen3.6-plus',
      usage: {
        inputTokens: 80,
        outputTokens: 12,
      },
    },
  }]);
});

test('disconnectGatewayClient rejects pending gateway readiness immediately', async () => {
  const adapter = new OpenClawRuntimeAdapter({} as never, {} as never);
  let rejectReady: ((error: Error) => void) | null = null;
  const readiness = new Promise<void>((_resolve, reject) => {
    rejectReady = reject;
  });
  adapter.gatewayReadyPromise = readiness;
  adapter.gatewayReadyReject = rejectReady;

  adapter.disconnectGatewayClient();

  await expect(readiness).rejects.toThrow('OpenClaw gateway client stopped before handshake completed.');
  expect(adapter.gatewayReadyPromise).toBeNull();
  expect(adapter.gatewayReadyReject).toBeNull();
});

test('chat.final persists usage and model metadata from final payload', async () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: '你是哪个模型', timestamp: 1, metadata: {} },
    {
      id: 'msg-2',
      type: 'assistant',
      content: '当前使用 qwen3.6-plus。',
      timestamp: 2,
      metadata: { isStreaming: true, isFinal: false },
    },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const emittedUpdates: Array<{ messageId: string; content: string; metadata?: Record<string, unknown> }> = [];
  const sessionKey = `agent:main:lobsterai:${session.id}`;
  const turn = {
    sessionId: session.id,
    sessionKey,
    runId: 'run-chat-final-metadata',
    turnToken: 1,
    startedAtMs: 1,
    knownRunIds: new Set(['run-chat-final-metadata']),
    assistantMessageId: 'msg-2',
    committedAssistantText: '',
    currentAssistantSegmentText: '当前使用 qwen3.6-plus。',
    currentText: '当前使用 qwen3.6-plus。',
    agentAssistantTextLength: '当前使用 qwen3.6-plus。'.length,
    hasSeenAgentAssistantStream: true,
    currentContentText: '当前使用 qwen3.6-plus。',
    currentContentBlocks: ['当前使用 qwen3.6-plus。'],
    sawNonTextContentBlocks: false,
    textStreamMode: 'snapshot',
    toolUseMessageIdByToolCallId: new Map(),
    toolResultMessageIdByToolCallId: new Map(),
    toolResultTextByToolCallId: new Map(),
    stopRequested: false,
    pendingUserSync: false,
    bufferedChatPayloads: [],
    bufferedAgentPayloads: [],
  };

  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({ messages: [] }),
  };
  adapter.rememberSessionKey(session.id, sessionKey);
  adapter.activeTurns.set(session.id, turn);
  adapter.sessionIdByRunId.set(turn.runId, session.id);
  adapter.latestTurnTokenBySession.set(session.id, turn.turnToken);
  adapter.on('messageUpdate', (_sessionId, messageId, content, metadata) => {
    emittedUpdates.push({ messageId, content, metadata: metadata as Record<string, unknown> | undefined });
  });

  adapter.handleGatewayEvent({
    event: 'chat',
    payload: {
      runId: turn.runId,
      sessionKey,
      state: 'final',
      message: {
        role: 'assistant',
        content: '当前使用 qwen3.6-plus。',
        model: 'qwen3.6-plus',
        usage: {
          input: 120,
          output: 18,
          cacheRead: 64,
        },
      },
    },
  });
  await Promise.resolve();

  const assistant = session.messages.find((message) => message.id === 'msg-2');
  expect(assistant?.metadata).toMatchObject({
    isStreaming: false,
    isFinal: true,
    model: 'qwen3.6-plus',
    usage: {
      inputTokens: 120,
      outputTokens: 18,
      cacheReadTokens: 64,
    },
  });
  expect(emittedUpdates).toEqual([{
    messageId: 'msg-2',
    content: '当前使用 qwen3.6-plus。',
    metadata: {
      isStreaming: false,
      isFinal: true,
      model: 'qwen3.6-plus',
      usage: {
        inputTokens: 120,
        outputTokens: 18,
        cacheReadTokens: 64,
      },
    },
  }]);
  expect(session.status).toBe('completed');
  expect(adapter.activeTurns.has(session.id)).toBe(true);

  adapter.handleGatewayEvent({
    event: 'agent',
    payload: {
      runId: turn.runId,
      sessionKey,
      stream: 'lifecycle',
      data: { phase: 'end' },
    },
  });

  expect(adapter.activeTurns.has(session.id)).toBe(false);
});

test('chat.final waits for lifecycle end before emitting complete', async () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'run a tool', timestamp: 1, metadata: {} },
    {
      id: 'msg-2',
      type: 'assistant',
      content: 'tool result summary',
      timestamp: 2,
      metadata: { isStreaming: true, isFinal: false },
    },
  ]);
  session.status = 'running';
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const sessionKey = `agent:main:lobsterai:${session.id}`;
  const completeEvents: Array<{ sessionId: string; runId: string | null }> = [];
  const turn = {
    sessionId: session.id,
    sessionKey,
    runId: 'run-chat-final-waits',
    turnToken: 1,
    startedAtMs: 1,
    knownRunIds: new Set(['run-chat-final-waits']),
    assistantMessageId: 'msg-2',
    committedAssistantText: '',
    currentAssistantSegmentText: 'tool result summary',
    currentText: 'tool result summary',
    agentAssistantTextLength: 'tool result summary'.length,
    hasSeenAgentAssistantStream: true,
    currentContentText: 'tool result summary',
    currentContentBlocks: ['tool result summary'],
    sawNonTextContentBlocks: false,
    textStreamMode: 'snapshot',
    toolUseMessageIdByToolCallId: new Map(),
    toolResultMessageIdByToolCallId: new Map([['tool-1', 'tool-result-1']]),
    toolResultTextByToolCallId: new Map([['tool-1', 'ok']]),
    stopRequested: false,
    pendingUserSync: false,
    bufferedChatPayloads: [],
    bufferedAgentPayloads: [],
  };

  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({ messages: [] }),
  };
  adapter.rememberSessionKey(session.id, sessionKey);
  adapter.activeTurns.set(session.id, turn);
  adapter.sessionIdByRunId.set(turn.runId, session.id);
  adapter.latestTurnTokenBySession.set(session.id, turn.turnToken);
  adapter.on('complete', (completedSessionId, runId) => {
    completeEvents.push({ sessionId: completedSessionId, runId });
  });

  adapter.handleGatewayEvent({
    event: 'chat',
    payload: {
      runId: turn.runId,
      sessionKey,
      state: 'final',
      message: {
        role: 'assistant',
        content: 'tool result summary',
      },
    },
  });
  await Promise.resolve();

  expect(session.status).toBe('running');
  expect(adapter.activeTurns.has(session.id)).toBe(true);
  expect(completeEvents).toEqual([]);

  adapter.handleGatewayEvent({
    event: 'agent',
    payload: {
      runId: turn.runId,
      sessionKey,
      stream: 'tool',
      data: {
        phase: 'result',
        toolCallId: 'tool-2',
        name: 'bash',
        result: 'late tool result',
      },
    },
  });
  expect(adapter.activeTurns.has(session.id)).toBe(true);
  expect(completeEvents).toEqual([]);

  adapter.handleGatewayEvent({
    event: 'agent',
    payload: {
      runId: turn.runId,
      sessionKey,
      stream: 'lifecycle',
      data: { phase: 'end' },
    },
  });

  expect(completeEvents).toEqual([{
    sessionId: session.id,
    runId: turn.runId,
  }]);
  expect(session.status).toBe('completed');
  expect(adapter.activeTurns.has(session.id)).toBe(false);
});

test('late lifecycle fallback event does not reopen a completed managed session', () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: '你是哪个模型', timestamp: 1, metadata: {} },
    {
      id: 'msg-2',
      type: 'assistant',
      content: '当前会话使用的是 qwen-portal/qwen3.6-plus 模型。',
      timestamp: 2,
      metadata: { isStreaming: false, isFinal: true },
    },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const sessionKey = `agent:main:lobsterai:${session.id}`;

  adapter.rememberSessionKey(session.id, sessionKey);
  adapter.handleGatewayEvent({
    event: 'agent',
    seq: 1,
    payload: {
      runId: 'late-run',
      sessionKey,
      stream: 'lifecycle',
      data: { phase: 'fallback' },
    },
  });

  expect(session.status).toBe('completed');
  expect(adapter.activeTurns.has(session.id)).toBe(false);
  expect(adapter.sessionIdByRunId.has('late-run')).toBe(false);
});

test('late event for a closed run does not recreate a managed session turn', () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'hello', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'done', timestamp: 2, metadata: { isStreaming: false, isFinal: true } },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const sessionKey = `agent:main:lobsterai:${session.id}`;

  adapter.rememberSessionKey(session.id, sessionKey);
  adapter.ensureActiveTurn(session.id, sessionKey, 'closed-run');
  session.status = 'completed';
  adapter.cleanupSessionTurn(session.id);

  adapter.handleGatewayEvent({
    event: 'agent',
    seq: 2,
    payload: {
      runId: 'closed-run',
      sessionKey,
      stream: 'lifecycle',
      data: { phase: 'start' },
    },
  });

  expect(session.status).toBe('completed');
  expect(adapter.activeTurns.has(session.id)).toBe(false);
  expect(adapter.sessionIdByRunId.has('closed-run')).toBe(false);
});

test('delete approval requested during stop cooldown is suppressed', () => {
  const { session, store } = createReconcileStore([]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const sessionKey = `agent:main:lobsterai:${session.id}`;
  const permissionRequests: unknown[] = [];

  adapter.rememberSessionKey(session.id, sessionKey);
  adapter.on('permissionRequest', (_sessionId, request) => {
    permissionRequests.push(request);
  });

  adapter.stopSession(session.id);
  adapter.handleGatewayEvent({
    event: 'exec.approval.requested',
    payload: {
      id: 'approval-delete',
      request: {
        sessionKey,
        command: 'rm -rf /tmp/qingshu-old-output',
      },
    },
  });

  expect(permissionRequests).toEqual([]);
});

test('non-delete approval requested during stop cooldown is not auto-approved', () => {
  const { session, store } = createReconcileStore([]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const sessionKey = `agent:main:lobsterai:${session.id}`;
  const permissionRequests: unknown[] = [];

  adapter.rememberSessionKey(session.id, sessionKey);
  adapter.on('permissionRequest', (_sessionId, request) => {
    permissionRequests.push(request);
  });

  adapter.respondToPermission = vi.fn();
  adapter.stopSession(session.id);
  adapter.handleGatewayEvent({
    event: 'exec.approval.requested',
    payload: {
      id: 'approval-non-delete',
      request: {
        sessionKey,
        command: 'curl https://example.com',
      },
    },
  });

  expect(permissionRequests).toEqual([]);
  expect(adapter.respondToPermission).not.toHaveBeenCalled();
  expect(adapter.pendingApprovals.has('approval-non-delete')).toBe(false);
});

test('non-delete approval for a manually stopped desktop session is suppressed after cooldown', () => {
  vi.useFakeTimers();
  try {
    const { session, store } = createReconcileStore([]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:lobsterai:${session.id}`;
    const permissionRequests: unknown[] = [];

    adapter.rememberSessionKey(session.id, sessionKey);
    adapter.on('permissionRequest', (_sessionId, request) => {
      permissionRequests.push(request);
    });

    adapter.respondToPermission = vi.fn();
    adapter.stopSession(session.id);
    vi.advanceTimersByTime(10_001);
    adapter.handleGatewayEvent({
      event: 'exec.approval.requested',
      payload: {
        id: 'approval-late-non-delete',
        request: {
          sessionKey,
          command: 'curl https://example.com',
        },
      },
    });

    expect(permissionRequests).toEqual([]);
    expect(adapter.respondToPermission).not.toHaveBeenCalled();
    expect(adapter.pendingApprovals.has('approval-late-non-delete')).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

test('delete approval requested outside stop cooldown still opens permission flow', () => {
  const { session, store } = createReconcileStore([]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const sessionKey = `agent:main:lobsterai:${session.id}`;
  const permissionRequests: Array<{ requestId: string }> = [];

  adapter.rememberSessionKey(session.id, sessionKey);
  adapter.on('permissionRequest', (_sessionId, request) => {
    permissionRequests.push(request);
  });

  adapter.handleGatewayEvent({
    event: 'exec.approval.requested',
    payload: {
      id: 'approval-delete',
      request: {
        sessionKey,
        command: 'rm -rf /tmp/qingshu-old-output',
      },
    },
  });

  expect(permissionRequests.map((request) => request.requestId)).toEqual(['approval-delete']);
});

test('stale lifecycle error fallback does not fail a newer turn', async () => {
  vi.useFakeTimers();
  try {
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: 'old turn', timestamp: 1, metadata: {} },
    ]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:lobsterai:${session.id}`;

    const oldTurn = {
      sessionId: session.id,
      sessionKey,
      runId: 'old-run',
      turnToken: 1,
      startedAtMs: 1,
      knownRunIds: new Set(['old-run']),
      assistantMessageId: null,
      committedAssistantText: '',
      currentAssistantSegmentText: '',
      currentText: '',
      agentAssistantTextLength: 0,
      hasSeenAgentAssistantStream: false,
      currentContentText: '',
      currentContentBlocks: [],
      sawNonTextContentBlocks: false,
      textStreamMode: 'unknown',
      toolUseMessageIdByToolCallId: new Map(),
      toolResultMessageIdByToolCallId: new Map(),
      toolResultTextByToolCallId: new Map(),
      stopRequested: false,
      pendingUserSync: false,
      bufferedChatPayloads: [],
      bufferedAgentPayloads: [],
    };
    adapter.activeTurns.set(session.id, oldTurn);
    adapter.latestTurnTokenBySession.set(session.id, oldTurn.turnToken);

    adapter.handleAgentLifecycleEvent(session.id, { phase: 'error', error: 'old run failed' });

    const newTurn = {
      ...oldTurn,
      runId: 'new-run',
      turnToken: 2,
      knownRunIds: new Set(['new-run']),
    };
    adapter.activeTurns.set(session.id, newTurn);
    adapter.latestTurnTokenBySession.set(session.id, newTurn.turnToken);
    session.status = 'running';

    await vi.advanceTimersByTimeAsync(2100);

    expect(session.status).toBe('running');
    expect(adapter.activeTurns.get(session.id)?.runId).toBe('new-run');
    expect(session.messages.some((message) => message.type === 'system')).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

test('lifecycle error fallback aborts the gateway run and rejects the active turn', async () => {
  vi.useFakeTimers();
  try {
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: '生成一份分析报告', timestamp: 1, metadata: {} },
    ]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:lobsterai:${session.id}`;
    const gatewayRequests: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const emittedErrors: string[] = [];
    const emittedMessages: Array<Record<string, unknown>> = [];
    const turn = {
      sessionId: session.id,
      sessionKey,
      runId: 'run-retrying',
      turnToken: 1,
      startedAtMs: 1,
      knownRunIds: new Set(['run-retrying']),
      assistantMessageId: null,
      committedAssistantText: '',
      currentAssistantSegmentText: '',
      currentText: '',
      agentAssistantTextLength: 0,
      hasSeenAgentAssistantStream: false,
      currentContentText: '',
      currentContentBlocks: [],
      sawNonTextContentBlocks: false,
      textStreamMode: 'unknown',
      toolUseMessageIdByToolCallId: new Map(),
      toolResultMessageIdByToolCallId: new Map(),
      toolResultTextByToolCallId: new Map(),
      stopRequested: false,
      pendingUserSync: false,
      bufferedChatPayloads: [],
      bufferedAgentPayloads: [],
    };

    adapter.gatewayClient = {
      start: () => {},
      stop: () => {},
      request: async (method: string, params?: Record<string, unknown>) => {
        gatewayRequests.push({ method, params });
        return { messages: [] };
      },
    };
    adapter.activeTurns.set(session.id, turn);
    adapter.latestTurnTokenBySession.set(session.id, turn.turnToken);
    adapter.pendingTurns.set(session.id, {
      resolve: () => {},
      reject: (error: Error) => {
        emittedErrors.push(error.message);
      },
    });
    adapter.on('message', (_sessionId, message) => {
      emittedMessages.push(message);
    });
    adapter.on('error', (_sessionId, error) => {
      emittedErrors.push(error);
    });

    adapter.handleAgentLifecycleEvent(session.id, {
      phase: 'error',
      runId: 'run-retrying',
      error: '模型服务重试失败',
    });
    await vi.advanceTimersByTimeAsync(2100);

    expect(gatewayRequests).toContainEqual({
      method: 'chat.abort',
      params: {
        sessionKey,
        runId: 'run-retrying',
      },
    });
    expect(session.status).toBe('error');
    expect(session.messages.some((message) => (
      message.type === 'system'
      && message.content === '模型服务重试失败'
      && (message.metadata as Record<string, unknown>)?.error === '模型服务重试失败'
    ))).toBe(true);
    expect(emittedMessages.some((message) => message.content === '模型服务重试失败')).toBe(true);
    expect(emittedErrors).toContain('模型服务重试失败');
    expect(adapter.activeTurns.has(session.id)).toBe(false);
    expect(adapter.pendingTurns.has(session.id)).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

test('terminated run tool event does not recreate a managed session turn', () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: '生成一份分析报告', timestamp: 1, metadata: {} },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const sessionKey = `agent:main:lobsterai:${session.id}`;

  adapter.rememberSessionKey(session.id, sessionKey);
  adapter.handleGatewayEvent({
    event: 'agent',
    seq: 1,
    payload: {
      runId: 'terminated-run',
      sessionKey,
      stream: 'lifecycle',
      data: { phase: 'error', error: '模型服务重试失败' },
    },
  });
  adapter.handleGatewayEvent({
    event: 'agent',
    seq: 2,
    payload: {
      runId: 'terminated-run',
      sessionKey,
      stream: 'tool',
      data: {
        toolCallId: 'tool-late',
        toolName: 'bash',
        phase: 'start',
        input: { command: 'echo late' },
      },
    },
  });

  expect(session.status).toBe('completed');
  expect(session.messages).toHaveLength(1);
  expect(adapter.activeTurns.has(session.id)).toBe(false);
  expect(adapter.sessionIdByRunId.has('terminated-run')).toBe(false);
});

test('chat error event persists system error and rejects the active turn', async () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: '分析一下图片内容', timestamp: 1, metadata: {} },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const sessionKey = `agent:main:lobsterai:${session.id}`;
  const emittedErrors: string[] = [];
  const emittedMessages: Array<Record<string, unknown>> = [];
  const turn = {
    sessionId: session.id,
    sessionKey,
    runId: 'run-chat-error',
    turnToken: 1,
    startedAtMs: 1,
    knownRunIds: new Set(['run-chat-error']),
    assistantMessageId: null,
    committedAssistantText: '',
    currentAssistantSegmentText: '',
    currentText: '',
    agentAssistantTextLength: 0,
    hasSeenAgentAssistantStream: false,
    currentContentText: '',
    currentContentBlocks: [],
    sawNonTextContentBlocks: false,
    textStreamMode: 'unknown',
    toolUseMessageIdByToolCallId: new Map(),
    toolResultMessageIdByToolCallId: new Map(),
    toolResultTextByToolCallId: new Map(),
    stopRequested: false,
    pendingUserSync: false,
    bufferedChatPayloads: [],
    bufferedAgentPayloads: [],
  };

  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({ messages: [] }),
  };
  adapter.rememberSessionKey(session.id, sessionKey);
  adapter.activeTurns.set(session.id, turn);
  adapter.sessionIdByRunId.set(turn.runId, session.id);
  adapter.latestTurnTokenBySession.set(session.id, turn.turnToken);
  adapter.pendingTurns.set(session.id, {
    resolve: () => {},
    reject: (error: Error) => {
      emittedErrors.push(error.message);
    },
  });
  adapter.on('message', (_sessionId, message) => {
    emittedMessages.push(message);
  });
  adapter.on('error', (_sessionId, error) => {
    emittedErrors.push(error);
  });

  adapter.handleGatewayEvent({
    event: 'chat',
    payload: {
      runId: turn.runId,
      sessionKey,
      state: 'error',
      errorMessage: '400 Bad Request: image input unsupported',
    },
  });

  const expectedError = [
    '400 Bad Request: image input unsupported',
    '',
    '[Hint: If the model attempted to read an image file, this may be because the model does not support image input. Consider using a vision-capable model or avoid sending image files.]',
  ].join('\n');

  expect(session.status).toBe('error');
  expect(session.messages.some((message) => (
    message.type === 'system'
    && message.content === expectedError
    && (message.metadata as Record<string, unknown>)?.error === expectedError
  ))).toBe(true);
  expect(emittedMessages.some((message) => message.content === expectedError)).toBe(true);
  expect(emittedErrors).toContain(expectedError);
  expect(adapter.activeTurns.has(session.id)).toBe(false);
  expect(adapter.pendingTurns.has(session.id)).toBe(false);
});

test('late chat error for a closed run is ignored', () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'hello', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'done', timestamp: 2, metadata: { isStreaming: false, isFinal: true } },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const sessionKey = `agent:main:lobsterai:${session.id}`;
  const emittedErrors: string[] = [];

  adapter.rememberSessionKey(session.id, sessionKey);
  adapter.ensureActiveTurn(session.id, sessionKey, 'closed-run');
  session.status = 'completed';
  adapter.cleanupSessionTurn(session.id);
  adapter.on('error', (_sessionId, error) => {
    emittedErrors.push(error);
  });

  adapter.handleGatewayEvent({
    event: 'chat',
    payload: {
      runId: 'closed-run',
      sessionKey,
      state: 'error',
      errorMessage: 'late gateway error',
    },
  });

  expect(session.status).toBe('completed');
  expect(session.messages).toHaveLength(2);
  expect(emittedErrors).toEqual([]);
  expect(adapter.activeTurns.has(session.id)).toBe(false);
});

test('late aborted and error events after manual stop do not add messages or reopen turn', () => {
  const { session, store } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: '停止这个长任务', timestamp: 1, metadata: {} },
  ]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const sessionKey = `agent:main:lobsterai:${session.id}`;
  const emittedMessages: Array<Record<string, unknown>> = [];
  const emittedErrors: string[] = [];
  const turn = {
    sessionId: session.id,
    sessionKey,
    runId: 'run-stopped',
    turnToken: 1,
    startedAtMs: 1,
    knownRunIds: new Set(['run-stopped']),
    assistantMessageId: null,
    committedAssistantText: '',
    currentAssistantSegmentText: '',
    currentText: '',
    agentAssistantTextLength: 0,
    hasSeenAgentAssistantStream: false,
    currentContentText: '',
    currentContentBlocks: [],
    sawNonTextContentBlocks: false,
    textStreamMode: 'unknown',
    toolUseMessageIdByToolCallId: new Map(),
    toolResultMessageIdByToolCallId: new Map(),
    toolResultTextByToolCallId: new Map(),
    stopRequested: false,
    pendingUserSync: false,
    bufferedChatPayloads: [],
    bufferedAgentPayloads: [],
  };

  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({ messages: [] }),
  };
  adapter.rememberSessionKey(session.id, sessionKey);
  adapter.activeTurns.set(session.id, turn);
  adapter.sessionIdByRunId.set(turn.runId, session.id);
  adapter.latestTurnTokenBySession.set(session.id, turn.turnToken);
  adapter.on('message', (_sessionId, message) => {
    emittedMessages.push(message);
  });
  adapter.on('error', (_sessionId, error) => {
    emittedErrors.push(error);
  });

  adapter.stopSession(session.id);
  adapter.handleGatewayEvent({
    event: 'chat',
    payload: {
      runId: turn.runId,
      sessionKey,
      state: 'aborted',
    },
  });
  adapter.handleGatewayEvent({
    event: 'chat',
    payload: {
      runId: turn.runId,
      sessionKey,
      state: 'error',
      errorMessage: 'late gateway error',
    },
  });

  expect(session.status).toBe('idle');
  expect(session.messages).toHaveLength(1);
  expect(emittedMessages).toEqual([]);
  expect(emittedErrors).toEqual([]);
  expect(adapter.activeTurns.has(session.id)).toBe(false);
  expect(adapter.sessionIdByRunId.has(turn.runId)).toBe(false);
});

test('cleanupSessionTurn clears timeout watchdog before it can emit a timeout hint', async () => {
  vi.useFakeTimers();
  try {
    const { session, store } = createReconcileStore([
      { id: 'msg-1', type: 'user', content: '生成一份长报告', timestamp: 1, metadata: {} },
    ]);
    const adapter = new OpenClawRuntimeAdapter(store, {});
    const sessionKey = `agent:main:lobsterai:${session.id}`;
    const emittedMessages: Array<Record<string, unknown>> = [];
    const turn = {
      sessionId: session.id,
      sessionKey,
      runId: 'run-timeout-cleanup',
      turnToken: 1,
      startedAtMs: Date.now(),
      knownRunIds: new Set(['run-timeout-cleanup']),
      assistantMessageId: null,
      committedAssistantText: '',
      currentAssistantSegmentText: '',
      currentText: '',
      agentAssistantTextLength: 0,
      hasSeenAgentAssistantStream: false,
      currentContentText: '',
      currentContentBlocks: [],
      sawNonTextContentBlocks: false,
      textStreamMode: 'unknown',
      toolUseMessageIdByToolCallId: new Map(),
      toolResultMessageIdByToolCallId: new Map(),
      toolResultTextByToolCallId: new Map(),
      stopRequested: false,
      pendingUserSync: false,
      bufferedChatPayloads: [],
      bufferedAgentPayloads: [],
    };

    adapter.agentTimeoutSeconds = 1;
    adapter.activeTurns.set(session.id, turn);
    adapter.latestTurnTokenBySession.set(session.id, turn.turnToken);
    adapter.on('message', (_sessionId, message) => {
      emittedMessages.push(message);
    });

    adapter.startTurnTimeoutWatchdog(session.id);
    expect(turn.timeoutTimer).toBeDefined();

    adapter.cleanupSessionTurn(session.id);
    expect(turn.timeoutTimer).toBeUndefined();

    await vi.advanceTimersByTimeAsync(31_000);

    expect(session.messages).toHaveLength(1);
    expect(emittedMessages).toEqual([]);
    expect(adapter.activeTurns.has(session.id)).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

test('reconcileWithHistory: preserves tool messages', async () => {
  const { session, store, getReplaceCallCount } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'Run a command', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'tool_use', content: 'Using bash', timestamp: 2, metadata: {} },
    { id: 'msg-3', type: 'tool_result', content: 'OK', timestamp: 3, metadata: {} },
    { id: 'msg-4', type: 'assistant', content: 'Done!', timestamp: 4, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'Run a command' },
        { role: 'assistant', content: 'Done!' },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getReplaceCallCount()).toBe(0);
});

test('reconcileWithHistory: gateway returns tail subset — preserves older local messages', async () => {
  const { session, store, getReplaceCallCount } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'Hello', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'Hi there', timestamp: 2, metadata: {} },
    { id: 'msg-3', type: 'user', content: 'How are you?', timestamp: 3, metadata: {} },
    { id: 'msg-4', type: 'assistant', content: 'I am fine', timestamp: 4, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'How are you?' },
        { role: 'assistant', content: 'I am fine' },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getReplaceCallCount()).toBe(0);
  expect(session.messages.length).toBe(4);
});

test('reconcileWithHistory: channel window without overlap must not shorten local history', async () => {
  const { session, store, getReplaceCallCount } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'Question 1', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'Answer 1', timestamp: 2, metadata: {} },
    { id: 'msg-3', type: 'user', content: 'Question 2', timestamp: 3, metadata: {} },
    { id: 'msg-4', type: 'assistant', content: 'Answer 2', timestamp: 4, metadata: {} },
    { id: 'msg-5', type: 'user', content: 'Question 3', timestamp: 5, metadata: {} },
    { id: 'msg-6', type: 'assistant', content: 'Answer 3', timestamp: 6, metadata: {} },
  ]);
  const sessionKey = 'agent:main:feishu:account:direct:user';

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.setChannelSessionSync({
    isChannelSessionKey: (key: string) => key === sessionKey,
  } as never);
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'Windowed question with no overlap' },
        { role: 'assistant', content: 'Windowed answer with no overlap' },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, sessionKey);

  expect(getReplaceCallCount()).toBe(0);
  expect(session.messages.map((message) => message.content)).toEqual([
    'Question 1',
    'Answer 1',
    'Question 2',
    'Answer 2',
    'Question 3',
    'Answer 3',
  ]);
});

test('reconcileWithHistory: tail window starting with assistant does not rewrite when already synced', async () => {
  const { session, store, getReplaceCallCount } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'First question', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'First answer', timestamp: 2, metadata: {} },
    { id: 'msg-3', type: 'user', content: 'Second question', timestamp: 3, metadata: {} },
    { id: 'msg-4', type: 'assistant', content: 'Second answer', timestamp: 4, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'assistant', content: 'First answer' },
        { role: 'user', content: 'Second question' },
        { role: 'assistant', content: 'Second answer' },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getReplaceCallCount()).toBe(0);
  expect(session.messages.length).toBe(4);
});

test('reconcileWithHistory: tail window starting with assistant updates anchored tail without duplication', async () => {
  const { session, store, getReplaceCallCount, getLastReplaceArgs } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'First question', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'First answer', timestamp: 2, metadata: {} },
    { id: 'msg-3', type: 'user', content: 'Second question', timestamp: 3, metadata: {} },
    { id: 'msg-4', type: 'assistant', content: 'Streaming partial...', timestamp: 4, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'assistant', content: 'First answer' },
        { role: 'user', content: 'Second question' },
        { role: 'assistant', content: 'Full complete answer from gateway.' },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');
  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getReplaceCallCount()).toBe(1);
  expect(getLastReplaceArgs()!.authoritative).toEqual([
    { role: 'user', text: 'First question', timestamp: 1 },
    { role: 'assistant', text: 'First answer', timestamp: 2 },
    { role: 'user', text: 'Second question', timestamp: 3 },
    { role: 'assistant', text: 'Full complete answer from gateway.' },
  ]);
});

test('reconcileWithHistory: tail window repairs stale leading assistant before anchor', async () => {
  const { session, store, getReplaceCallCount, getLastReplaceArgs } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'First question', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'Stale previous answer', timestamp: 2, metadata: {} },
    { id: 'msg-3', type: 'user', content: 'Second question', timestamp: 3, metadata: {} },
    { id: 'msg-4', type: 'assistant', content: 'Streaming partial...', timestamp: 4, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'assistant', content: 'Correct previous answer' },
        { role: 'user', content: 'Second question' },
        { role: 'assistant', content: 'Full complete answer from gateway.' },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getReplaceCallCount()).toBe(1);
  expect(getLastReplaceArgs()!.authoritative).toEqual([
    { role: 'user', text: 'First question', timestamp: 1 },
    { role: 'assistant', text: 'Correct previous answer' },
    { role: 'user', text: 'Second question', timestamp: 3 },
    { role: 'assistant', text: 'Full complete answer from gateway.' },
  ]);
});

test('reconcileWithHistory: empty history — sets cursor to 0', async () => {
  const { session, store, getReplaceCallCount } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'Hello', timestamp: 1, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({ messages: [] }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getReplaceCallCount()).toBe(0);
  expect(adapter.channelSyncCursor.get(session.id)).toBe(0);
});

test('reconcileWithHistory: multi-turn conversation — correct order', async () => {
  const { session, store, getReplaceCallCount, getLastReplaceArgs } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'First', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'Reply 1', timestamp: 2, metadata: {} },
    // Missing second turn
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'First' },
        { role: 'assistant', content: 'Reply 1' },
        { role: 'user', content: 'Second' },
        { role: 'assistant', content: 'Reply 2' },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getReplaceCallCount()).toBe(1);
  const args = getLastReplaceArgs()!;
  expect(args.authoritative.length).toBe(4);
  expect((args.authoritative[2] as Record<string, unknown>).text).toBe('Second');
  expect((args.authoritative[3] as Record<string, unknown>).text).toBe('Reply 2');
});

test('reconcileWithHistory: gateway error — does not crash', async () => {
  const { session, store, getReplaceCallCount } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'Hello', timestamp: 1, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => { throw new Error('Network timeout'); },
  };

  // Should not throw
  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getReplaceCallCount()).toBe(0);
});

test('reconcileWithHistory: tail content mismatch — replaces only tail, preserves prefix', async () => {
  const { session, store, getReplaceCallCount, getLastReplaceArgs } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'First question', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'First answer', timestamp: 2, metadata: {} },
    { id: 'msg-3', type: 'user', content: 'Second question', timestamp: 3, metadata: {} },
    { id: 'msg-4', type: 'assistant', content: 'Streaming partial...', timestamp: 4, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'Second question' },
        { role: 'assistant', content: 'Full complete answer from gateway.' },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getReplaceCallCount()).toBe(1);
  const args = getLastReplaceArgs()!;
  // Prefix [First question, First answer] preserved + auth [Second question, Full complete answer]
  expect(args.authoritative.length).toBe(4);
  expect((args.authoritative[0] as Record<string, unknown>).text).toBe('First question');
  expect((args.authoritative[1] as Record<string, unknown>).text).toBe('First answer');
  expect((args.authoritative[2] as Record<string, unknown>).text).toBe('Second question');
  expect((args.authoritative[3] as Record<string, unknown>).text).toBe('Full complete answer from gateway.');
});

test('reconcileWithHistory: preserves local timestamps for retained prefix', async () => {
  const { session, store, getReplaceCallCount, getLastReplaceArgs } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'First question', timestamp: 1_000, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'First answer', timestamp: 2_000, metadata: {} },
    { id: 'msg-3', type: 'user', content: 'Second question', timestamp: 3_000, metadata: {} },
    { id: 'msg-4', type: 'assistant', content: 'Streaming partial...', timestamp: 4_000, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'Second question', timestamp: 30_000 },
        { role: 'assistant', content: 'Full complete answer from gateway.', timestamp: 40_000 },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getReplaceCallCount()).toBe(1);
  expect(getLastReplaceArgs()?.authoritative).toEqual([
    { role: 'user', text: 'First question', timestamp: 1_000 },
    { role: 'assistant', text: 'First answer', timestamp: 2_000 },
    { role: 'user', text: 'Second question', timestamp: 30_000 },
    { role: 'assistant', text: 'Full complete answer from gateway.', timestamp: 40_000 },
  ]);
});

test('reconcileWithHistory: long conversation — preserves prefix, replaces tail', async () => {
  // Simulate a long conversation: 10 local turns, gateway returns last 3 turns
  const localMessages = [];
  for (let i = 1; i <= 10; i++) {
    localMessages.push(
      { id: `msg-u${i}`, type: 'user', content: `Question ${i}`, timestamp: i * 2 - 1, metadata: {} },
      { id: `msg-a${i}`, type: 'assistant', content: `Answer ${i}`, timestamp: i * 2, metadata: {} },
    );
  }

  const { session, store, getReplaceCallCount, getLastReplaceArgs } = createReconcileStore(localMessages);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'Question 8' },
        { role: 'assistant', content: 'Answer 8' },
        { role: 'user', content: 'Question 9' },
        { role: 'assistant', content: 'Answer 9' },
        { role: 'user', content: 'Question 10' },
        { role: 'assistant', content: 'Answer 10 updated' }, // updated content
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getReplaceCallCount()).toBe(1);
  const args = getLastReplaceArgs()!;
  // 7 preserved turns (14 entries) + 3 auth turns (6 entries) = 20 total
  expect(args.authoritative.length).toBe(20);
  // First preserved entry
  expect((args.authoritative[0] as Record<string, unknown>).text).toBe('Question 1');
  // Last preserved entry
  expect((args.authoritative[13] as Record<string, unknown>).text).toBe('Answer 7');
  // Last entry from gateway
  expect((args.authoritative[19] as Record<string, unknown>).text).toBe('Answer 10 updated');
});

test('reconcileWithHistory: no overlap — full replace for dashboard consistency', async () => {
  const { session, store, getReplaceCallCount, getLastReplaceArgs } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'Old message 1', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'Old reply 1', timestamp: 2, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'Completely new message' },
        { role: 'assistant', content: 'Completely new reply' },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  // No overlap: full replace to match dashboard
  expect(getReplaceCallCount()).toBe(1);
  const args = getLastReplaceArgs()!;
  expect(args.authoritative.length).toBe(2);
  expect((args.authoritative[0] as Record<string, unknown>).text).toBe('Completely new message');
});

test('reconcileWithHistory: identical user messages — aligns to latest match', async () => {
  const { session, store, getReplaceCallCount } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'Hello', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'Hi (first)', timestamp: 2, metadata: {} },
    { id: 'msg-3', type: 'user', content: 'Hello', timestamp: 3, metadata: {} },
    { id: 'msg-4', type: 'assistant', content: 'Hi (second)', timestamp: 4, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi (second)' },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  // Tail matches (user anchor aligns to latest "Hello") — no replace needed
  expect(getReplaceCallCount()).toBe(0);
  expect(session.messages.length).toBe(4);
});

test('reconcileWithHistory: new messages arrived — preserves old and adds new', async () => {
  const { session, store, getReplaceCallCount, getLastReplaceArgs } = createReconcileStore([
    { id: 'msg-1', type: 'user', content: 'Question 1', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'Answer 1', timestamp: 2, metadata: {} },
    { id: 'msg-3', type: 'user', content: 'Question 2', timestamp: 3, metadata: {} },
    { id: 'msg-4', type: 'assistant', content: 'Answer 2', timestamp: 4, metadata: {} },
  ]);

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({
      messages: [
        { role: 'user', content: 'Question 2' },
        { role: 'assistant', content: 'Answer 2' },
        { role: 'user', content: 'Question 3' },
        { role: 'assistant', content: 'Answer 3' },
      ],
    }),
  };

  await adapter.reconcileWithHistory(session.id, 'managed:session-1');

  expect(getReplaceCallCount()).toBe(1);
  const args = getLastReplaceArgs()!;
  // Preserved [Q1, A1] + auth [Q2, A2, Q3, A3] = 6
  expect(args.authoritative.length).toBe(6);
  expect((args.authoritative[0] as Record<string, unknown>).text).toBe('Question 1');
  expect((args.authoritative[1] as Record<string, unknown>).text).toBe('Answer 1');
  expect((args.authoritative[5] as Record<string, unknown>).text).toBe('Answer 3');
});

// ==================== History tests ====================

function createHistoryStore(messages: Array<Record<string, unknown>>) {
  const session = {
    id: 'session-1',
    title: 'Channel Session',
    claudeSessionId: null,
    status: 'completed',
    pinned: false,
    cwd: '',
    systemPrompt: '',
    executionMode: 'local',
    activeSkillIds: [],
    messages: [...messages],
    createdAt: 1,
    updatedAt: 1,
  };
  let nextId = session.messages.length + 1;

  return {
    session,
    store: {
      getSession: (sessionId: string) => (sessionId === session.id ? session : null),
      addMessage: (sessionId: string, message: Record<string, unknown>) => {
        expect(sessionId).toBe(session.id);
        const created = {
          id: `msg-${nextId++}`,
          timestamp: nextId,
          metadata: {},
          ...message,
        };
        session.messages.push(created);
        return created;
      },
      updateMessage: (sessionId: string, messageId: string, patch: Record<string, unknown>) => {
        expect(sessionId).toBe(session.id);
        const message = session.messages.find((item) => item.id === messageId);
        if (!message) return false;
        Object.assign(message, patch);
        return true;
      },
      replaceConversationMessages: (sessionId: string, authoritative: Array<{ role: string; text: string; timestamp?: number }>) => {
        expect(sessionId).toBe(session.id);
        session.messages = session.messages.filter(
          (message) => message.type !== 'user' && message.type !== 'assistant',
        );
        for (const entry of authoritative) {
          session.messages.push({
            id: `msg-${nextId++}`,
            type: entry.role,
            content: entry.text,
            metadata: { isStreaming: false, isFinal: true },
            timestamp: entry.timestamp ?? nextId,
          });
        }
      },
      updateSession: (sessionId: string, patch: Record<string, unknown>) => {
        expect(sessionId).toBe(session.id);
        Object.assign(session, patch);
      },
    },
  };
}

const getSystemMessages = (session: { messages: Array<{ type: string }> }) =>
  session.messages.filter((message) => message.type === 'system');

test('syncFullChannelHistory seeds gateway history cursor so old reminders are not replayed', async () => {
  const { session, store } = createHistoryStore([
    { id: 'msg-1', type: 'user', content: 'old user', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'old assistant', timestamp: 2, metadata: { isStreaming: false, isFinal: true } },
  ]);
  const historyMessages = [
    { role: 'user', content: 'old user' },
    { role: 'assistant', content: 'old assistant' },
    { role: 'system', content: 'Reminder: old reminder' },
  ];

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({ messages: historyMessages }),
  };

  await adapter.syncFullChannelHistory(session.id, 'dingtalk-connector:acct:user');

  expect(adapter.gatewayHistoryCountBySession.get(session.id)).toBe(historyMessages.length);

  adapter.syncSystemMessagesFromHistory(session.id, historyMessages, {
    previousCountKnown: adapter.gatewayHistoryCountBySession.has(session.id),
    previousCount: adapter.gatewayHistoryCountBySession.get(session.id) ?? 0,
  });

  expect(getSystemMessages(session).length).toBe(0);
});

test('prefetchChannelUserMessages also consumes existing reminder history backlog', async () => {
  const { session, store } = createHistoryStore([
    { id: 'msg-1', type: 'user', content: 'old user', timestamp: 1, metadata: {} },
    { id: 'msg-2', type: 'assistant', content: 'old assistant', timestamp: 2, metadata: { isStreaming: false, isFinal: true } },
  ]);
  const historyMessages = [
    { role: 'user', content: 'old user' },
    { role: 'assistant', content: 'old assistant' },
    { role: 'system', content: 'Reminder: old reminder' },
    { role: 'user', content: 'new user turn' },
  ];

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({ messages: historyMessages }),
  };

  await adapter.prefetchChannelUserMessages(session.id, 'dingtalk-connector:acct:user');

  expect(adapter.gatewayHistoryCountBySession.get(session.id)).toBe(historyMessages.length);
  expect(session.messages.filter((message: Record<string, unknown>) => message.type === 'user').length).toBe(2);

  adapter.syncSystemMessagesFromHistory(session.id, historyMessages, {
    previousCountKnown: adapter.gatewayHistoryCountBySession.has(session.id),
    previousCount: adapter.gatewayHistoryCountBySession.get(session.id) ?? 0,
  });

  expect(getSystemMessages(session).length).toBe(0);
});

test('prefetchChannelUserMessages preserves repeated identical user messages', async () => {
  const { session, store } = createHistoryStore([
    { id: 'msg-1', type: 'user', content: '你好', timestamp: 1, metadata: {} },
  ]);
  const historyMessages = [
    { role: 'user', content: '你好' },
    { role: 'user', content: '你好' },
  ];

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({ messages: historyMessages }),
  };

  await adapter.prefetchChannelUserMessages(session.id, 'dingtalk-connector:acct:user');

  expect(session.messages.filter((message: Record<string, unknown>) => (
    message.type === 'user' && message.content === '你好'
  ))).toHaveLength(2);
});

test('prefetchChannelUserMessages uses latest user only for recreated channel sessions', async () => {
  const { session, store, getReplaceCallCount } = createReconcileStore([]);
  const historyMessages = [
    { role: 'user', content: 'old user' },
    { role: 'assistant', content: 'old assistant' },
    { role: 'user', content: 'new user turn' },
  ];

  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async () => ({ messages: historyMessages }),
  };
  adapter.reCreatedChannelSessionIds.add(session.id);

  await adapter.prefetchChannelUserMessages(
    session.id,
    'agent:main:feishu:3e462f80:direct:ou_ca9972aed8fa926570225cf3714aa63a',
  );

  expect(getReplaceCallCount()).toBe(0);
  expect(session.messages.filter((message) => message.type === 'user').map((message) => message.content)).toEqual([
    'new user turn',
  ]);
  expect(session.messages.some((message) => message.content === 'old user')).toBe(false);
  expect(adapter.channelSyncCursor.get(session.id)).toBe(3);
  expect(adapter.gatewayHistoryCountBySession.get(session.id)).toBe(historyMessages.length);
});

test('onSessionDeleted deletes gateway transcripts for all session keys', async () => {
  const request = vi.fn(async () => ({}));
  const subagentRunStore = {
    listSubagentRuns: () => [],
    deleteSubagentRunsByParent: vi.fn(),
  };
  const adapter = new OpenClawRuntimeAdapter({} as never, {}, {}, subagentRunStore as never);
  const channelSessionKey = 'agent:main:feishu:3e462f80:direct:ou_ca9972aed8fa926570225cf3714aa63a';
  const managedSessionKey = 'agent:main:lobsterai:session-1';
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request,
  };
  adapter.channelSessionSync = {
    isChannelSessionKey: (key: string) => key === channelSessionKey,
    onSessionDeleted: vi.fn(),
  } as never;
  adapter.sessionIdBySessionKey.set(channelSessionKey, 'session-1');
  adapter.sessionIdBySessionKey.set(managedSessionKey, 'session-1');

  adapter.onSessionDeleted('session-1');

  await vi.waitFor(() => {
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledWith(
      'sessions.delete',
      { key: channelSessionKey, deleteTranscript: true },
      { timeoutMs: 5_000 },
    );
    expect(request).toHaveBeenCalledWith(
      'sessions.delete',
      { key: managedSessionKey, deleteTranscript: true },
      { timeoutMs: 5_000 },
    );
  });
  expect(adapter.deletedChannelKeys.has(channelSessionKey)).toBe(true);
  expect(adapter.deletedChannelKeys.has(managedSessionKey)).toBe(false);
});

test('syncSystemMessagesFromHistory skips pure heartbeat ack system messages', () => {
  const { session, store } = createHistoryStore([]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const historyMessages = [
    { role: 'system', content: 'HEARTBEAT_OK' },
    { role: 'system', content: 'Reminder fired' },
  ];

  adapter.syncSystemMessagesFromHistory(session.id, historyMessages, {
    previousCountKnown: false,
    previousCount: 0,
  });

  expect(getSystemMessages(session).map((message) => message.content)).toEqual(['Reminder fired']);
});

test('syncSystemMessagesFromHistory skips silent NO_REPLY system messages', () => {
  const { session, store } = createHistoryStore([]);
  const adapter = new OpenClawRuntimeAdapter(store, {});
  const historyMessages = [
    { role: 'system', content: 'NO_REPLY' },
    { role: 'system', content: 'Reminder fired' },
  ];

  adapter.syncSystemMessagesFromHistory(session.id, historyMessages, {
    previousCountKnown: false,
    previousCount: 0,
  });

  expect(getSystemMessages(session).map((message) => message.content)).toEqual(['Reminder fired']);
});

test('collectChannelHistoryEntries skips heartbeat prompt and ack messages', () => {
  const { store } = createHistoryStore([]);
  const adapter = new OpenClawRuntimeAdapter(store, {});

  const entries = adapter.collectChannelHistoryEntries([
    { role: 'user', content: 'regular user' },
    {
      role: 'user',
      content: `Read HEARTBEAT.md if it exists.
When reading HEARTBEAT.md, use workspace file /tmp/HEARTBEAT.md.
Do not infer or repeat old tasks from prior chats.
If nothing needs attention, reply HEARTBEAT_OK.`,
    },
    { role: 'assistant', content: 'HEARTBEAT_OK' },
    { role: 'assistant', content: 'regular assistant' },
  ]);

  expect(entries).toEqual([
    { role: 'user', text: 'regular user' },
    { role: 'assistant', text: 'regular assistant' },
  ]);
});

test('collectChannelHistoryEntries skips silent NO_REPLY assistant messages', () => {
  const { store } = createHistoryStore([]);
  const adapter = new OpenClawRuntimeAdapter(store, {});

  const entries = adapter.collectChannelHistoryEntries([
    { role: 'user', content: 'regular user' },
    { role: 'assistant', content: 'NO_REPLY' },
    { role: 'assistant', content: 'regular assistant' },
  ]);

  expect(entries).toEqual([
    { role: 'user', text: 'regular user' },
    { role: 'assistant', text: 'regular assistant' },
  ]);
});

test('collectChannelHistoryEntries keeps assistant usage and model metadata', () => {
  const { store } = createHistoryStore([]);
  const adapter = new OpenClawRuntimeAdapter(store, {});

  const entries = adapter.collectChannelHistoryEntries([
    { role: 'user', content: 'regular user' },
    {
      role: 'assistant',
      content: 'regular assistant',
      model: 'deepseek-chat',
      usage: {
        input: 12,
        output: 5,
        cacheRead: 3,
      },
    },
  ]);

  expect(entries).toEqual([
    { role: 'user', text: 'regular user' },
    {
      role: 'assistant',
      text: 'regular assistant',
      metadata: {
        isStreaming: false,
        isFinal: true,
        model: 'deepseek-chat',
        usage: {
          inputTokens: 12,
          outputTokens: 5,
          cacheReadTokens: 3,
        },
      },
    },
  ]);
});

test('getSessionKeysForSession prefers channel keys before managed fallback', () => {
  const { store } = createHistoryStore([]);
  const adapter = new OpenClawRuntimeAdapter(store, {});

  adapter.rememberSessionKey('session-1', 'agent:main:openai-user:dingtalk-connector:__default__:2459325231940374');
  adapter.rememberSessionKey('session-1', 'agent:main:lobsterai:session-1');

  expect(adapter.getSessionKeysForSession('session-1')).toEqual([
    'agent:main:openai-user:dingtalk-connector:__default__:2459325231940374',
    'agent:main:lobsterai:session-1',
  ]);
});

test('patchSession uses the persisted IM channel session key for model updates', async () => {
  const channelSessionKey = 'agent:agent-1:openclaw-weixin:bot-1:direct:user-1';
  const { session, store } = createHistoryStore([]);
  session.agentId = 'agent-1';
  session.modelOverride = 'qwen-portal/qwen3.6-plus';

  const patchRequests: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const adapter = new OpenClawRuntimeAdapter(store, {
    startGateway: async () => ({ phase: 'running' }),
    getGatewayConnectionInfo: () => ({}),
  } as never);
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async (method: string, params?: Record<string, unknown>) => {
      patchRequests.push({ method, params });
      return {};
    },
  };
  adapter.ensureGatewayClientReady = async () => {};
  adapter.setChannelSessionSync({
    getOpenClawSessionKeyForCoworkSession: (sessionId: string) => ({
      isChannelSession: sessionId === session.id,
      sessionKey: channelSessionKey,
    }),
  } as never);

  await adapter.patchSession(session.id, { model: 'deepseek/deepseek-v4' });

  expect(patchRequests).toEqual([
    {
      method: 'sessions.patch',
      params: {
        key: channelSessionKey,
        model: 'deepseek/deepseek-v4',
      },
    },
  ]);
});

test('patchSession normalizes model refs before sending model updates', async () => {
  const channelSessionKey = 'agent:agent-1:openclaw-weixin:bot-1:direct:user-1';
  const { session, store } = createHistoryStore([]);
  session.agentId = 'agent-1';

  const patchRequests: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const adapter = new OpenClawRuntimeAdapter(store, {
    startGateway: async () => ({ phase: 'running' }),
    getGatewayConnectionInfo: () => ({}),
  } as never, {
    normalizeModelRef: (modelRef) => modelRef === 'legacy-qwen'
      ? 'qwen-portal/qwen3.6-plus'
      : modelRef,
  });
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async (method: string, params?: Record<string, unknown>) => {
      patchRequests.push({ method, params });
      return {};
    },
  };
  adapter.ensureGatewayClientReady = async () => {};
  adapter.setChannelSessionSync({
    getOpenClawSessionKeyForCoworkSession: (sessionId: string) => ({
      isChannelSession: sessionId === session.id,
      sessionKey: channelSessionKey,
    }),
  } as never);

  await adapter.patchSession(session.id, { model: 'legacy-qwen' });

  expect(patchRequests).toEqual([
    {
      method: 'sessions.patch',
      params: {
        key: channelSessionKey,
        model: 'qwen-portal/qwen3.6-plus',
      },
    },
  ]);
});

test('patchSession forwards non-model policy fields without model normalization queue', async () => {
  const channelSessionKey = 'agent:agent-1:openclaw-feishu:tenant-1:chat:user-1';
  const { session, store } = createHistoryStore([]);
  session.agentId = 'agent-1';

  const patchRequests: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const adapter = new OpenClawRuntimeAdapter(store, {
    startGateway: async () => ({ phase: 'running' }),
    getGatewayConnectionInfo: () => ({}),
  } as never, {
    normalizeModelRef: () => {
      throw new Error('non-model patch should not normalize model refs');
    },
  });
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async (method: string, params?: Record<string, unknown>) => {
      patchRequests.push({ method, params });
      return {};
    },
  };
  adapter.ensureGatewayClientReady = async () => {};
  adapter.setChannelSessionSync({
    getOpenClawSessionKeyForCoworkSession: (sessionId: string) => ({
      isChannelSession: sessionId === session.id,
      sessionKey: channelSessionKey,
    }),
  } as never);

  await adapter.patchSession(session.id, {
    thinkingLevel: 'high',
    reasoningLevel: 'medium',
    elevatedLevel: null,
    responseUsage: 'tokens',
    sendPolicy: 'allow',
  });

  expect(patchRequests).toEqual([
    {
      method: 'sessions.patch',
      params: {
        key: channelSessionKey,
        thinkingLevel: 'high',
        reasoningLevel: 'medium',
        elevatedLevel: null,
        responseUsage: 'tokens',
        sendPolicy: 'allow',
      },
    },
  ]);
});

test('startSession patches sessionOverride model before every turn', async () => {
  const { session, store } = createHistoryStore([]);
  session.status = 'idle';
  session.agentId = 'agent-1';
  session.modelOverride = 'qwen-portal/qwen3.6-plus';
  store.getAgent = () => ({
    id: 'agent-1',
    name: 'Agent 1',
    model: 'deepseek/deepseek-v4',
  });

  const requests: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async (method: string, params?: Record<string, unknown>) => {
      requests.push({ method, params });
      if (method === 'chat.history') {
        return { messages: [] };
      }
      if (method === 'chat.send') {
        setTimeout(() => {
          adapter.handleGatewayEvent({
            event: 'chat',
            payload: {
              runId: params?.idempotencyKey,
              sessionKey: params?.sessionKey,
              state: 'final',
              message: { role: 'assistant', content: 'pong' },
            },
          });
        }, 0);
        return { runId: params?.idempotencyKey };
      }
      return {};
    },
  };
  adapter.ensureGatewayClientReady = async () => {};
  adapter.startChannelPolling = () => {};
  adapter.lastPatchedModelBySession.set(session.id, session.modelOverride);

  await adapter.startSession(session.id, 'ping', { skipInitialUserMessage: true, agentId: 'agent-1' });

  expect(requests.filter((request) => request.method === 'sessions.patch')).toEqual([
    {
      method: 'sessions.patch',
      params: {
        key: 'agent:agent-1:lobsterai:session-1',
        model: 'qwen-portal/qwen3.6-plus',
      },
    },
  ]);
});

test('startSession sends the session cwd to OpenClaw chat.send', async () => {
  const { session, store } = createHistoryStore([]);
  session.cwd = '/tmp/qingshu-workspace';
  session.status = 'idle';
  session.agentId = 'main';
  store.getAgent = () => null;

  const requests: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async (method: string, params?: Record<string, unknown>) => {
      requests.push({ method, params });
      if (method === 'chat.history') {
        return { messages: [] };
      }
      if (method === 'chat.send') {
        setTimeout(() => {
          adapter.handleGatewayEvent({
            event: 'chat',
            payload: {
              runId: params?.idempotencyKey,
              sessionKey: params?.sessionKey,
              state: 'final',
              message: { role: 'assistant', content: 'pong' },
            },
          });
        }, 0);
        return { runId: params?.idempotencyKey };
      }
      return {};
    },
  };
  adapter.ensureGatewayClientReady = async () => {};
  adapter.startChannelPolling = () => {};

  await adapter.startSession(session.id, 'ping', { skipInitialUserMessage: true });

  const chatSend = requests.find((request) => request.method === 'chat.send');
  expect(chatSend?.params).toMatchObject({
    sessionKey: 'agent:main:lobsterai:session-1',
    message: expect.stringContaining('ping'),
    deliver: false,
    cwd: path.resolve('/tmp/qingshu-workspace'),
  });
});

test('continueSession with edited user message reuses local message and completes after lifecycle end', async () => {
  const { session, store } = createHistoryStore([
    { id: 'msg-1', type: 'user', content: 'edited question', timestamp: 1, metadata: {} },
  ]);
  session.status = 'idle';
  session.agentId = 'main';
  store.getAgent = () => null;

  const completeEvents: Array<{ sessionId: string; runId: string | null }> = [];
  const requests: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async (method: string, params?: Record<string, unknown>) => {
      requests.push({ method, params });
      if (method === 'chat.history') {
        return { messages: [] };
      }
      if (method === 'chat.send') {
        setTimeout(() => {
          adapter.handleGatewayEvent({
            event: 'chat',
            payload: {
              runId: params?.idempotencyKey,
              sessionKey: params?.sessionKey,
              state: 'final',
              message: { role: 'assistant', content: 'edited answer' },
            },
          });
          adapter.handleGatewayEvent({
            event: 'agent',
            payload: {
              runId: params?.idempotencyKey,
              sessionKey: params?.sessionKey,
              stream: 'lifecycle',
              phase: 'end',
            },
          });
        }, 0);
        return { runId: params?.idempotencyKey };
      }
      return {};
    },
  };
  adapter.ensureGatewayClientReady = async () => {};
  adapter.startChannelPolling = () => {};
  adapter.on('complete', (sessionId, runId) => {
    completeEvents.push({ sessionId, runId });
  });

  await adapter.continueSession(session.id, 'edited question', { skipInitialUserMessage: true });

  expect(session.messages.filter((message) => message.type === 'user')).toHaveLength(1);
  expect(session.messages.map((message) => message.content)).toContain('edited answer');
  expect(session.status).toBe('completed');
  expect(completeEvents).toHaveLength(1);
  expect(requests.find((request) => request.method === 'chat.send')?.params?.message).toContain('edited question');
});

test('startSession keeps image payload in chat.send but strips it from message metadata', async () => {
  const { session, store } = createReconcileStore([]);
  session.status = 'idle';
  session.agentId = 'main';
  store.getAgent = () => null;
  const requests: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const adapter = new OpenClawRuntimeAdapter(store, {});
  adapter.gatewayClient = {
    start: () => {},
    stop: () => {},
    request: async (method: string, params?: Record<string, unknown>) => {
      requests.push({ method, params });
      if (method === 'chat.history') {
        return { messages: [] };
      }
      if (method === 'chat.send') {
        setTimeout(() => {
          adapter.handleGatewayEvent({
            event: 'chat',
            payload: {
              runId: params?.idempotencyKey,
              sessionKey: params?.sessionKey,
              state: 'final',
              message: { role: 'assistant', content: 'pong' },
            },
          });
        }, 0);
        return { runId: params?.idempotencyKey };
      }
      return {};
    },
  };
  adapter.ensureGatewayClientReady = async () => {};
  adapter.startChannelPolling = () => {};

  await adapter.startSession(session.id, 'describe image', {
    agentId: 'main',
    imageAttachments: [
      {
        name: 'large.png',
        mimeType: 'image/png',
        base64Data: 'YWJjZA==',
      },
    ],
  });

  const userMessage = session.messages.find((message) => message.type === 'user');
  expect(userMessage?.metadata?.imageAttachments).toEqual([
    {
      name: 'large.png',
      mimeType: 'image/png',
      sizeBytes: 4,
      base64Length: 8,
      source: 'runtime',
    },
  ]);
  expect(JSON.stringify(userMessage?.metadata)).not.toContain('YWJjZA==');

  const chatSend = requests.find((request) => request.method === 'chat.send');
  expect(chatSend?.params?.attachments).toEqual([
    {
      type: 'image',
      mimeType: 'image/png',
      content: 'YWJjZA==',
    },
  ]);
});
