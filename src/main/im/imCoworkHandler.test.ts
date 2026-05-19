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

  async startSession(sessionId: string, prompt: string): Promise<void> {
    this.startCalls.push({ sessionId, prompt });

    if (this.firstStartShouldFail) {
      this.firstStartShouldFail = false;
      throw new Error('API Error 400: payload too large');
    }

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

  addMessage(): void {}
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
