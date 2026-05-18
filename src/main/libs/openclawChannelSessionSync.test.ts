import { describe, expect, test, vi } from 'vitest';

import {
  buildChannelDisplayName,
  buildManagedSessionKey,
  DEFAULT_MANAGED_AGENT_ID,
  extractAccountIdFromKey,
  isManagedSessionKey,
  OpenClawChannelSessionSync,
  parseChannelSessionKey,
  parseManagedSessionKey,
  resolveAgentBinding,
} from './openclawChannelSessionSync';

describe('openclawChannelSessionSync', () => {
  test('builds and parses canonical managed local session keys', () => {
    expect(buildManagedSessionKey('abc-123')).toBe(`agent:${DEFAULT_MANAGED_AGENT_ID}:lobsterai:abc-123`);
    expect(parseManagedSessionKey('agent:main:lobsterai:abc-123')).toEqual({
      agentId: 'main',
      sessionId: 'abc-123',
    });
  });

  test('keeps managed agent ids with colons readable', () => {
    const key = buildManagedSessionKey('session-1', 'qingshu-managed:qingshu-presales-analysis');

    expect(parseManagedSessionKey(key)).toEqual({
      agentId: 'qingshu-managed:qingshu-presales-analysis',
      sessionId: 'session-1',
    });
    expect(isManagedSessionKey(key)).toBe(true);
    expect(parseChannelSessionKey(key)).toBeNull();
  });

  test('ignores managed local session keys when resolving channel sessions', () => {
    const sync = createSync();
    const key = 'agent:main:lobsterai:abc-123';

    expect(sync.isChannelSessionKey(key)).toBe(false);
    expect(sync.resolveOrCreateSession(key)).toBeNull();
    expect(sync.resolveOrCreateMainAgentSession(key)).toBeNull();
  });

  test('keeps account scope in multi-instance channel session keys', () => {
    const parsed = parseChannelSessionKey('agent:main:dingtalk:abcd1234:direct:ou_123456');

    expect(parsed).toEqual({
      platform: 'dingtalk',
      conversationId: 'abcd1234:direct:ou_123456',
    });
  });

  test('extracts account id from json session context keys', () => {
    const accountId = extractAccountIdFromKey(
      'agent:main:openai-user:{"channel":"feishu","accountid":"feishu001","peerid":"oc_abc"}',
    );

    expect(accountId).toBe('feishu001');
  });

  test('keeps account scope in json session context conversation ids', () => {
    const parsed = parseChannelSessionKey(
      'agent:main:openai-user:{"channel":"feishu","accountid":"feishu001","peerid":"oc_abc"}',
    );

    expect(parsed).toEqual({
      platform: 'feishu',
      conversationId: 'feishu001:oc_abc',
    });
  });

  test('prefers per-instance agent bindings for multi-instance platforms', () => {
    const agentId = resolveAgentBinding(
      {
        dingtalk: 'main',
        'dingtalk:abcd1234-full-instance-id': 'sales-agent',
      },
      'dingtalk',
      'abcd1234',
    );

    expect(agentId).toBe('sales-agent');
  });

  test('prefers per-instance agent bindings for Telegram sessions', () => {
    const agentId = resolveAgentBinding(
      {
        telegram: 'main',
        'telegram:bot-123456': 'telegram-agent',
      },
      'telegram',
      'bot-123456',
    );

    expect(agentId).toBe('telegram-agent');
  });

  test('prefers per-instance agent bindings for NIM sessions', () => {
    const agentId = resolveAgentBinding(
      {
        nim: 'main',
        'nim:app-key:user-1': 'nim-agent',
      },
      'nim',
      'app-key',
    );

    expect(agentId).toBe('nim-agent');
  });

  test('falls back to platform binding when instance binding is missing', () => {
    const agentId = resolveAgentBinding(
      {
        feishu: 'support-agent',
      },
      'feishu',
      'missing123',
    );

    expect(agentId).toBe('support-agent');
  });

  test('treats stale agent ids as non-current after platform binding changes', () => {
    const sync = new OpenClawChannelSessionSync({
      coworkStore: {
        getSession: () => null,
        createSession: () => {
          throw new Error('createSession should not be called');
        },
      },
      imStore: {
        getIMSettings: () => ({
          skillsEnabled: true,
          platformAgentBindings: {
            weixin: 'agent-2',
          },
        }),
        getSessionMapping: () => null,
        updateSessionLastActive: () => {},
        deleteSessionMapping: () => {},
        createSessionMapping: () => {},
      },
      getDefaultCwd: () => '/tmp',
    } as never);

    expect(sync.isCurrentBindingKey('agent:main:openclaw-weixin:bot-1:direct:user-1')).toBe(false);
    expect(sync.isCurrentBindingKey('agent:agent-2:openclaw-weixin:bot-1:direct:user-1')).toBe(true);
  });

  test('stores the real OpenClaw session key when creating a mapping', () => {
    const createSessionMapping = vi.fn();
    const sync = new OpenClawChannelSessionSync({
      coworkStore: {
        getSession: () => null,
        createSession: () => makeCoworkSession('cowork-1'),
      },
      imStore: {
        getIMSettings: () => ({ skillsEnabled: true }),
        getSessionMapping: () => null,
        updateSessionLastActive: () => {},
        deleteSessionMapping: () => {},
        createSessionMapping,
      },
      getDefaultCwd: () => '/tmp',
    } as never);

    const sessionKey = 'agent:main:feishu:dm:ou_123';

    expect(sync.resolveOrCreateSession(sessionKey)).toBe('cowork-1');
    expect(createSessionMapping).toHaveBeenCalledWith(
      'dm:ou_123',
      'feishu',
      'cowork-1',
      'main',
      sessionKey,
    );
  });

  test('backfills the real OpenClaw session key for existing mappings', () => {
    const updateSessionOpenClawSessionKey = vi.fn();
    const sync = new OpenClawChannelSessionSync({
      coworkStore: {
        getSession: () => makeCoworkSession('cowork-1'),
        createSession: () => {
          throw new Error('createSession should not be called');
        },
      },
      imStore: {
        getIMSettings: () => ({ skillsEnabled: true }),
        getSessionMapping: () => ({
          imConversationId: 'dm:ou_123',
          platform: 'feishu',
          coworkSessionId: 'cowork-1',
          agentId: 'main',
          createdAt: 1,
          lastActiveAt: 1,
        }),
        updateSessionOpenClawSessionKey,
        updateSessionLastActive: () => {},
        deleteSessionMapping: () => {},
        createSessionMapping: () => {},
      },
      getDefaultCwd: () => '/tmp',
    } as never);

    const sessionKey = 'agent:main:feishu:dm:ou_123';

    expect(sync.resolveOrCreateSession(sessionKey)).toBe('cowork-1');
    expect(updateSessionOpenClawSessionKey).toHaveBeenCalledWith('dm:ou_123', 'feishu', sessionKey);
  });

  test('channel sync corrects existing mapping cwd from the current bound agent', () => {
    const updateSession = vi.fn();
    const sync = new OpenClawChannelSessionSync({
      coworkStore: {
        getSession: () => ({
          id: 'cowork-1',
          title: '[Feishu] ou_123',
          claudeSessionId: null,
          status: 'idle',
          pinned: false,
          cwd: '/tmp/old',
          systemPrompt: '',
          modelOverride: '',
          executionMode: 'local',
          activeSkillIds: [],
          agentId: 'writer',
          messages: [],
          createdAt: 1,
          updatedAt: 1,
        }),
        createSession: () => {
          throw new Error('createSession should not be called');
        },
        updateSession,
      },
      imStore: {
        getIMSettings: () => ({
          skillsEnabled: true,
          platformAgentBindings: {
            feishu: 'writer',
          },
        }),
        getSessionMapping: () => ({
          imConversationId: 'dm:ou_123',
          platform: 'feishu',
          coworkSessionId: 'cowork-1',
          agentId: 'writer',
          openClawSessionKey: 'agent:writer:feishu:dm:ou_123',
          createdAt: 1,
          lastActiveAt: 1,
        }),
        updateSessionLastActive: () => {},
        deleteSessionMapping: () => {},
        createSessionMapping: () => {},
      },
      getDefaultCwd: (agentId?: string) => `/repo/${agentId || 'main'}`,
    } as never);

    const sessionKey = 'agent:writer:feishu:dm:ou_123';

    expect(sync.resolveOrCreateSession(sessionKey)).toBe('cowork-1');
    expect(updateSession).toHaveBeenCalledWith(
      'cowork-1',
      { cwd: '/repo/writer' },
      { touchUpdatedAt: false },
    );
  });

  test('buildChannelDisplayName strips email domain and removes direct prefix', () => {
    expect(buildChannelDisplayName('direct:alice@corp.example.com')).toBe('alice');
  });

  test('buildChannelDisplayName keeps group prefix', () => {
    expect(buildChannelDisplayName('group:3911967@popo.netease.com')).toBe('group:3911967');
  });

  test('buildChannelDisplayName handles account:direct:peer format', () => {
    expect(buildChannelDisplayName('bot1:direct:zhangsan@corp.netease.com')).toBe('zhangsan');
  });

  test('buildChannelDisplayName handles account:group:peer format', () => {
    expect(buildChannelDisplayName('bot1:group:12345@popo.netease.com')).toBe('group:12345');
  });

  test('buildChannelDisplayName handles channel peerKind', () => {
    expect(buildChannelDisplayName('channel:room-abc')).toBe('ch:room-abc');
  });

  test('buildChannelDisplayName passes through plain ids', () => {
    expect(buildChannelDisplayName('123456789')).toBe('123456789');
  });

  test('buildChannelDisplayName passes through non-email conversationId without peerKind', () => {
    expect(buildChannelDisplayName('dm:ou_123')).toBe('dm:ou_123');
  });

  test('buildChannelDisplayName truncates long results to 20 chars', () => {
    const result = buildChannelDisplayName('direct:a_very_long_username_that_exceeds_limit@example.com');
    expect(result.length).toBeLessThanOrEqual(20);
    expect(result).toBe('a_very_long_username');
  });

  test('buildChannelDisplayName truncates long fallback ids to 20 chars', () => {
    const result = buildChannelDisplayName('abcdefghijklmnopqrstuvwxyz1234567890');
    expect(result.length).toBeLessThanOrEqual(20);
    expect(result).toBe('qrstuvwxyz1234567890');
  });
});

function createSync(): OpenClawChannelSessionSync {
  return new OpenClawChannelSessionSync({
    coworkStore: {
      getSession: () => null,
      createSession: () => {
        throw new Error('createSession should not be called');
      },
    },
    imStore: {
      getSessionMapping: () => null,
      updateSessionLastActive: () => {},
      deleteSessionMapping: () => {},
      createSessionMapping: () => {},
    },
    getDefaultCwd: () => '/tmp',
  } as never);
}

function makeCoworkSession(id: string) {
  return {
    id,
    title: '[Feishu] ou_123',
    claudeSessionId: null,
    status: 'idle',
    pinned: false,
    cwd: '/tmp',
    systemPrompt: '',
    modelOverride: '',
    executionMode: 'local',
    activeSkillIds: [],
    agentId: 'main',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
  };
}
