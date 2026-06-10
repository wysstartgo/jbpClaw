import EventEmitter from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from 'vitest';

import { IMCoworkHandler } from './imCoworkHandler';

class FakeRuntime extends EventEmitter {
  public readonly startCalls: Array<{ sessionId: string; prompt: string }> = [];
  public readonly stoppedSessionIds: string[] = [];
  public firstStartShouldFail = false;
  public autoCompleteStartSession = true;

  async startSession(sessionId: string, prompt: string): Promise<void> {
    this.startCalls.push({ sessionId, prompt });

    if (this.firstStartShouldFail) {
      this.firstStartShouldFail = false;
      throw new Error('API Error 400: payload too large');
    }

    if (!this.autoCompleteStartSession) return;

    this.emit('message', sessionId, {
      id: 'assistant-1',
      type: 'assistant',
      content: '第二次会话重试成功',
      timestamp: Date.now(),
      metadata: {},
    });
    this.emit('complete', sessionId, null);
  }

  async continueSession(): Promise<void> {}

  stopSession(sessionId: string): void {
    this.stoppedSessionIds.push(sessionId);
  }

  stopAllSessions(): void {}

  respondToPermission(): void {}

  isSessionActive(): boolean {
    return false;
  }

  getSessionConfirmationMode(): 'text' {
    return 'text';
  }
}

class FakeCoworkStore {
  private readonly sessions = new Map<string, {
    id: string;
    title: string;
    cwd: string;
    systemPrompt: string;
    executionMode: string;
    claudeSessionId: string | null;
    status: string;
    messages: Array<Record<string, unknown>>;
    agentId: string;
  }>();
  private readonly agents = new Map<string, { workingDirectory?: string }>();
  private sessionCounter = 0;
  private messageCounter = 0;

  getConfig() {
    return {
      workingDirectory: process.cwd(),
      systemPrompt: '',
      executionMode: 'auto',
      agentEngine: 'openclaw',
    };
  }

  createSession(
    title: string,
    cwd: string,
    systemPrompt: string,
    executionMode: string,
    _messages: Array<Record<string, unknown>> = [],
    agentId: string = 'main',
  ) {
    const id = `session-${++this.sessionCounter}`;
    const session = {
      id,
      title,
      cwd,
      systemPrompt,
      executionMode,
      claudeSessionId: 'claude-seeded',
      status: 'idle',
      messages: [],
      agentId,
    };
    this.sessions.set(id, session);
    return session;
  }

  getSession(sessionId: string) {
    return this.sessions.get(sessionId) ?? null;
  }

  getAgent(agentId: string) {
    return this.agents.get(agentId) ?? null;
  }

  setAgent(agentId: string, agent: { workingDirectory?: string }): void {
    this.agents.set(agentId, agent);
  }

  updateSession(sessionId: string, updates: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    Object.assign(session, updates);
  }

  addMessage(sessionId: string, message: Record<string, unknown>) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    const created = {
      id: `message-${++this.messageCounter}`,
      timestamp: Date.now(),
      ...message,
    };
    session.messages.push(created);
    return created;
  }
}

class FakeIMStore {
  private mappings: Array<{
    imConversationId: string;
    platform: string;
    coworkSessionId: string;
    agentId: string;
    openClawSessionKey?: string;
    createdAt: number;
    lastActiveAt: number;
  }> = [];

  constructor(private readonly platformAgentBindings: Record<string, string> = {}) {}

  getIMSettings() {
    return {
      skillsEnabled: false,
      platformAgentBindings: this.platformAgentBindings,
    };
  }

  listSessionMappings() {
    return [...this.mappings];
  }

  getSessionMapping(imConversationId: string, platform: string) {
    return this.mappings.find((entry) => (
      entry.imConversationId === imConversationId && entry.platform === platform
    )) ?? null;
  }

  getSessionMappingByCoworkSessionId(coworkSessionId: string) {
    return this.mappings.find((entry) => entry.coworkSessionId === coworkSessionId) ?? null;
  }

  createSessionMapping(
    imConversationId: string,
    platform: string,
    coworkSessionId: string,
    agentId: string = 'main',
    openClawSessionKey: string = '',
  ) {
    const mapping = {
      imConversationId,
      platform,
      coworkSessionId,
      agentId,
      ...(openClawSessionKey ? { openClawSessionKey } : {}),
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    this.mappings.push(mapping);
    return mapping;
  }

  updateSessionLastActive(imConversationId: string, platform: string): void {
    const mapping = this.getSessionMapping(imConversationId, platform);
    if (mapping) {
      mapping.lastActiveAt = Date.now();
    }
  }

  deleteSessionMapping(imConversationId: string, platform: string): void {
    this.mappings = this.mappings.filter((entry) => (
      entry.imConversationId !== imConversationId || entry.platform !== platform
    ));
  }
}

function createMessage(overrides: Record<string, unknown> = {}) {
  return {
    platform: 'nim',
    messageId: 'im-msg-1',
    conversationId: 'conv-1',
    senderId: 'user-1',
    senderName: 'Tester',
    content: '2分钟后提醒我喝水',
    chatType: 'direct',
    timestamp: Date.parse('2026-03-15T16:28:00+08:00'),
    ...overrides,
  };
}

test('payload too large 400 from IM cowork retries with a fresh session', async () => {
  const runtime = new FakeRuntime();
  runtime.firstStartShouldFail = true;
  const coworkStore = new FakeCoworkStore();
  const imStore = new FakeIMStore();

  const handler = new IMCoworkHandler({
    coworkRuntime: runtime,
    coworkStore: coworkStore as never,
    imStore: imStore as never,
  });

  const reply = await handler.processMessage({
    platform: 'nim',
    messageId: 'im-msg-1',
    conversationId: 'conv-1',
    senderId: 'user-1',
    senderName: 'Tester',
    content: '请继续处理这个超长上下文请求',
    chatType: 'direct',
    timestamp: Date.now(),
  });

  expect(reply).toBe('第二次会话重试成功');
  expect(runtime.startCalls.map((item) => item.sessionId)).toEqual(['session-1', 'session-2']);
  expect(runtime.stoppedSessionIds).toEqual(['session-1']);
  expect(imStore.getSessionMapping('conv-1', 'nim')?.coworkSessionId).toBe('session-2');

  handler.destroy();
});

test('native IM cowork mapping stores the platform-bound agent id', async () => {
  const runtime = new FakeRuntime();
  const coworkStore = new FakeCoworkStore();
  const imStore = new FakeIMStore({ nim: 'qingshu-nim-agent' });

  const handler = new IMCoworkHandler({
    coworkRuntime: runtime,
    coworkStore: coworkStore as never,
    imStore: imStore as never,
  });

  await handler.processMessage({
    platform: 'nim',
    messageId: 'im-msg-agent',
    conversationId: 'conv-agent',
    senderId: 'user-1',
    senderName: 'Tester',
    content: '请处理这条消息',
    chatType: 'direct',
    timestamp: Date.now(),
  });

  const mapping = imStore.getSessionMapping('conv-agent', 'nim');
  expect(mapping?.agentId).toBe('qingshu-nim-agent');
  expect(coworkStore.getSession(mapping!.coworkSessionId)?.agentId).toBe('qingshu-nim-agent');

  handler.destroy();
});

test('native IM cowork session uses the bound agent working directory when available', async () => {
  const agentWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'qingshu-im-agent-workspace-'));
  const runtime = new FakeRuntime();
  const coworkStore = new FakeCoworkStore();
  coworkStore.setAgent('qingshu-nim-agent', { workingDirectory: agentWorkspace });
  const imStore = new FakeIMStore({ nim: 'qingshu-nim-agent' });

  const handler = new IMCoworkHandler({
    coworkRuntime: runtime,
    coworkStore: coworkStore as never,
    imStore: imStore as never,
  });

  try {
    await handler.processMessage({
      platform: 'nim',
      messageId: 'im-msg-agent-workspace',
      conversationId: 'conv-agent-workspace',
      senderId: 'user-1',
      senderName: 'Tester',
      content: '请在绑定 agent 的工作目录里处理',
      chatType: 'direct',
      timestamp: Date.now(),
    });

    const mapping = imStore.getSessionMapping('conv-agent-workspace', 'nim');
    expect(coworkStore.getSession(mapping!.coworkSessionId)?.cwd).toBe(agentWorkspace);
  } finally {
    handler.destroy();
    fs.rmSync(agentWorkspace, { recursive: true, force: true });
  }
});

test('uses only current-turn store messages when completing an IM reply', async () => {
  const runtime = new FakeRuntime();
  runtime.autoCompleteStartSession = false;
  const coworkStore = new FakeCoworkStore();
  const imStore = new FakeIMStore();

  const handler = new IMCoworkHandler({
    coworkRuntime: runtime,
    coworkStore,
    imStore,
  });

  const pending = handler.processMessage(createMessage({ content: '查测试环境日志' }));
  await new Promise((resolve) => setImmediate(resolve));

  const sessionId = 'session-1';
  coworkStore.addMessage(sessionId, {
    id: 'old-user',
    type: 'user',
    content: '上一轮问题',
    metadata: {},
  });
  coworkStore.addMessage(sessionId, {
    id: 'old-assistant',
    type: 'assistant',
    content: '上一轮答案，不应该出现在本次 IM 回复里。',
    metadata: {},
  });
  coworkStore.addMessage(sessionId, {
    id: 'current-user',
    type: 'user',
    content: '查测试环境日志',
    metadata: {},
  });
  coworkStore.addMessage(sessionId, {
    id: 'current-assistant',
    type: 'assistant',
    content: '当前轮最终答案。',
    metadata: {},
  });

  runtime.emit('message', sessionId, {
    id: 'current-user',
    type: 'user',
    content: '查测试环境日志',
    timestamp: Date.now(),
    metadata: {},
  });
  runtime.emit('message', sessionId, {
    id: 'current-assistant',
    type: 'assistant',
    content: '当前轮流式快照',
    timestamp: Date.now(),
    metadata: {},
  });
  runtime.emit('complete', sessionId, null);

  const reply = await pending;
  expect(reply).toBe('当前轮最终答案。');
  expect(reply).not.toContain('上一轮答案');

  handler.destroy();
});

test('falls back to current user boundary when reconciled store message ids changed', async () => {
  const runtime = new FakeRuntime();
  runtime.autoCompleteStartSession = false;
  const coworkStore = new FakeCoworkStore();
  const imStore = new FakeIMStore();

  const handler = new IMCoworkHandler({
    coworkRuntime: runtime,
    coworkStore,
    imStore,
  });

  const pending = handler.processMessage(createMessage({ content: '继续查错误' }));
  await new Promise((resolve) => setImmediate(resolve));

  const sessionId = 'session-1';
  coworkStore.addMessage(sessionId, {
    id: 'history-user',
    type: 'user',
    content: '历史问题',
    metadata: {},
  });
  coworkStore.addMessage(sessionId, {
    id: 'history-assistant',
    type: 'assistant',
    content: '历史答案，不应该被发送。',
    metadata: {},
  });
  coworkStore.addMessage(sessionId, {
    id: 'store-current-user',
    type: 'user',
    content: '继续查错误',
    metadata: {},
  });
  coworkStore.addMessage(sessionId, {
    id: 'runtime-tool-use',
    type: 'tool_use',
    content: 'Using tool: exec',
    metadata: { toolName: 'exec', toolUseId: 'tool-1' },
  });
  coworkStore.addMessage(sessionId, {
    id: 'store-current-assistant',
    type: 'assistant',
    content: '按 boundary 找到的当前轮最终答案。',
    metadata: {},
  });

  runtime.emit('message', sessionId, {
    id: 'runtime-current-user',
    type: 'user',
    content: '继续查错误',
    timestamp: Date.now(),
    metadata: {},
  });
  runtime.emit('message', sessionId, {
    id: 'runtime-tool-use',
    type: 'tool_use',
    content: 'Using tool: exec',
    timestamp: Date.now(),
    metadata: { toolName: 'exec', toolUseId: 'tool-1' },
  });
  runtime.emit('message', sessionId, {
    id: 'runtime-current-assistant',
    type: 'assistant',
    content: '当前轮流式快照',
    timestamp: Date.now(),
    metadata: {},
  });
  runtime.emit('complete', sessionId, null);

  const reply = await pending;
  expect(reply).toBe('按 boundary 找到的当前轮最终答案。');
  expect(reply).not.toContain('历史答案');

  handler.destroy();
});

test('strips thinking blocks from normal IM replies', async () => {
  const runtime = new FakeRuntime();
  runtime.autoCompleteStartSession = false;
  const coworkStore = new FakeCoworkStore();
  const imStore = new FakeIMStore();

  const handler = new IMCoworkHandler({
    coworkRuntime: runtime,
    coworkStore,
    imStore,
  });

  const pending = handler.processMessage(createMessage({ content: '给我结论' }));
  await new Promise((resolve) => setImmediate(resolve));

  const sessionId = 'session-1';
  coworkStore.addMessage(sessionId, {
    id: 'current-user',
    type: 'user',
    content: '给我结论',
    metadata: {},
  });
  coworkStore.addMessage(sessionId, {
    id: 'thinking-message',
    type: 'assistant',
    content: '这段结构化 thinking 不应该发送',
    metadata: { isThinking: true },
  });
  coworkStore.addMessage(sessionId, {
    id: 'current-assistant',
    type: 'assistant',
    content: '<think>内部推理</think>最终答案',
    metadata: {},
  });

  runtime.emit('message', sessionId, {
    id: 'current-user',
    type: 'user',
    content: '给我结论',
    timestamp: Date.now(),
    metadata: {},
  });
  runtime.emit('message', sessionId, {
    id: 'thinking-message',
    type: 'assistant',
    content: '这段结构化 thinking 不应该发送',
    timestamp: Date.now(),
    metadata: { isThinking: true },
  });
  runtime.emit('message', sessionId, {
    id: 'current-assistant',
    type: 'assistant',
    content: '<think>内部推理</think>最终答案',
    timestamp: Date.now(),
    metadata: {},
  });
  runtime.emit('complete', sessionId, null);

  const reply = await pending;
  expect(reply).toBe('最终答案');

  handler.destroy();
});

test('does not relay thinking content for raw async reminder replies', async () => {
  const runtime = new FakeRuntime();
  const coworkStore = new FakeCoworkStore();
  const imStore = new FakeIMStore();
  const relayedReplies: Array<{ platform: string; conversationId: string; text: string }> = [];

  const session = coworkStore.createSession('IM-dingtalk', process.cwd(), '', 'auto');
  imStore.createSessionMapping('default:user-42', 'dingtalk', session.id as string);

  const handler = new IMCoworkHandler({
    coworkRuntime: runtime,
    coworkStore,
    imStore,
    sendAsyncReply: async (platform: string, conversationId: string, text: string) => {
      relayedReplies.push({ platform, conversationId, text });
      return true;
    },
  });

  runtime.emit('message', session.id, {
    id: 'system-1',
    type: 'system',
    content: '⏰ 提醒：开会',
    timestamp: Date.now(),
    metadata: {},
  });
  runtime.emit('message', session.id, {
    id: 'thinking-1',
    type: 'assistant',
    content: '内部推理',
    timestamp: Date.now(),
    metadata: { isThinking: true },
  });
  runtime.emit('message', session.id, {
    id: 'assistant-1',
    type: 'assistant',
    content: '<thinking>先判断提醒语气</thinking>时间到了，记得开会。',
    timestamp: Date.now(),
    metadata: {},
  });
  runtime.emit('complete', session.id, null);

  await new Promise((resolve) => setImmediate(resolve));

  expect(relayedReplies).toEqual([
    {
      platform: 'dingtalk',
      conversationId: 'default:user-42',
      text: '时间到了，记得开会。',
    },
  ]);

  handler.destroy();
});
