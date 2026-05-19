import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, test } from 'vitest';

import { IMStore } from './imStore';

const tempDirs: string[] = [];
const dbs: Database.Database[] = [];

const createDb = (): Database.Database => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qingshu-im-store-'));
  tempDirs.push(dir);
  const db = new Database(path.join(dir, 'test.sqlite'));
  dbs.push(db);
  return db;
};

afterEach(() => {
  for (const db of dbs.splice(0)) {
    db.close();
  }
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const createStore = (): { store: IMStore; getSaveCount: () => number } => {
  const db = createDb();
  let saveCount = 0;
  const store = new IMStore(db, () => {
    saveCount += 1;
  });
  return {
    store,
    getSaveCount: () => saveCount,
  };
};

describe('IMStore multi-instance agent bindings', () => {
  test('persists conversation reply routes by platform and conversation ID', () => {
    const { store } = createStore();

    expect(store.getConversationReplyRoute('dingtalk', '__default__:conv-1')).toBe(null);

    store.setConversationReplyRoute('dingtalk', '__default__:conv-1', {
      channel: 'dingtalk-connector',
      to: 'group:cid-42',
      accountId: '__default__',
    });

    expect(store.getConversationReplyRoute('dingtalk', '__default__:conv-1')).toEqual({
      channel: 'dingtalk-connector',
      to: 'group:cid-42',
      accountId: '__default__',
    });
    expect(store.getConversationReplyRoute('telegram', '__default__:conv-1')).toBe(null);
  });

  test('persists OpenClaw session keys in IM session mappings', () => {
    const { store } = createStore();

    store.createSessionMapping(
      'bot-1:direct:user-1',
      'weixin',
      'cowork-1',
      'main',
      'agent:main:openclaw-weixin:bot-1:direct:user-1',
    );

    expect(store.getSessionMapping('bot-1:direct:user-1', 'weixin')).toMatchObject({
      imConversationId: 'bot-1:direct:user-1',
      platform: 'weixin',
      coworkSessionId: 'cowork-1',
      agentId: 'main',
      openClawSessionKey: 'agent:main:openclaw-weixin:bot-1:direct:user-1',
    });
    expect(store.getSessionMappingByCoworkSessionId('cowork-1')?.openClawSessionKey)
      .toBe('agent:main:openclaw-weixin:bot-1:direct:user-1');

    store.updateSessionOpenClawSessionKey(
      'bot-1:direct:user-1',
      'weixin',
      'agent:main:openclaw-weixin:bot-1:direct:user-2',
    );

    expect(store.getSessionMapping('bot-1:direct:user-1', 'weixin')?.openClawSessionKey)
      .toBe('agent:main:openclaw-weixin:bot-1:direct:user-2');

    store.updateSessionMappingTarget(
      'bot-1:direct:user-1',
      'weixin',
      'cowork-2',
      'agent-2',
      'agent:agent-2:openclaw-weixin:bot-1:direct:user-1',
    );

    expect(store.getSessionMapping('bot-1:direct:user-1', 'weixin')).toMatchObject({
      coworkSessionId: 'cowork-2',
      agentId: 'agent-2',
      openClawSessionKey: 'agent:agent-2:openclaw-weixin:bot-1:direct:user-1',
    });
  });

  test.each([
    ['dingtalk', 'deleteDingTalkInstance'],
    ['feishu', 'deleteFeishuInstance'],
    ['discord', 'deleteDiscordInstance'],
    ['qq', 'deleteQQInstance'],
    ['telegram', 'deleteTelegramInstance'],
    ['wecom', 'deleteWecomInstance'],
  ] as const)('removes only the deleted %s instance binding', (platform, deleteMethod) => {
    const { store } = createStore();

    store.setIMSettings({
      platformAgentBindings: {
        [`${platform}:deleted`]: 'agent-deleted',
        [`${platform}:kept`]: 'agent-kept',
        feishu: 'legacy-feishu-agent',
        telegram: 'telegram-agent',
      },
    });

    store[deleteMethod]('deleted');

    expect(store.getIMSettings().platformAgentBindings).toEqual({
      [`${platform}:kept`]: 'agent-kept',
      feishu: 'legacy-feishu-agent',
      telegram: 'telegram-agent',
    });
  });

  test.each([
    ['telegram', 'deleteTelegramInstance'],
    ['discord', 'deleteDiscordInstance'],
  ] as const)('removes %s session mappings for deleted instance account scope', (platform, deleteMethod) => {
    const { store } = createStore();
    const deletedInstanceId = 'abcd1234-deleted-instance';
    const keptInstanceId = 'efgh5678-kept-instance';

    store.createSessionMapping(
      'abcd1234:direct:user-1',
      platform,
      'cowork-deleted',
      'agent-deleted',
      `agent:agent-deleted:${platform}:abcd1234:direct:user-1`,
    );
    store.createSessionMapping(
      'efgh5678:direct:user-2',
      platform,
      'cowork-kept',
      'agent-kept',
      `agent:agent-kept:${platform}:efgh5678:direct:user-2`,
    );
    store.createSessionMapping(
      'group:shared-room',
      platform,
      'cowork-group',
      'agent-group',
      `agent:agent-group:${platform}:group:shared-room`,
    );

    store[deleteMethod](deletedInstanceId);

    expect(store.getSessionMapping('abcd1234:direct:user-1', platform)).toBe(null);
    expect(store.getSessionMapping('efgh5678:direct:user-2', platform)?.coworkSessionId)
      .toBe('cowork-kept');
    expect(store.getSessionMapping('group:shared-room', platform)?.coworkSessionId)
      .toBe('cowork-group');
    expect(store.getSessionMappingByCoworkSessionId('cowork-deleted')).toBe(null);
    expect(store.getSessionMappingByCoworkSessionId('cowork-kept')?.imConversationId)
      .toBe(`${keptInstanceId.slice(0, 8)}:direct:user-2`);
  });

  test('keeps settings stable when deleting an unbound instance', () => {
    const { store } = createStore();
    const platformAgentBindings = {
      'feishu:kept': 'agent-kept',
      telegram: 'telegram-agent',
    };
    store.setIMSettings({ platformAgentBindings });

    store.deleteFeishuInstance('missing');

    expect(store.getIMSettings().platformAgentBindings).toEqual(platformAgentBindings);
  });

  test('replacing a multi-instance config removes stale instances and bindings', () => {
    const { store } = createStore();

    store.setFeishuInstanceConfig('removed', {
      instanceName: 'Removed Bot',
      appId: 'removed-app',
      appSecret: 'removed-secret',
      enabled: true,
    });
    store.setFeishuInstanceConfig('kept', {
      instanceName: 'Kept Bot',
      appId: 'old-kept-app',
      appSecret: 'old-kept-secret',
      enabled: true,
    });
    store.setIMSettings({
      platformAgentBindings: {
        'feishu:removed': 'agent-removed',
        'feishu:kept': 'agent-kept',
        weixin: 'weixin-agent',
      },
    });

    store.setFeishuMultiInstanceConfig({
      instances: [
        {
          ...store.getFeishuInstanceConfig('kept')!,
          appId: 'new-kept-app',
        },
      ],
    });

    expect(store.getFeishuInstanceConfig('removed')).toBe(null);
    expect(store.getFeishuInstanceConfig('kept')).toMatchObject({
      appId: 'new-kept-app',
      instanceName: 'Kept Bot',
    });
    expect(store.getIMSettings().platformAgentBindings).toEqual({
      'feishu:kept': 'agent-kept',
      weixin: 'weixin-agent',
    });
  });

  test('setConfig does not restore stale bindings from full config payloads', () => {
    const { store } = createStore();

    store.setFeishuInstanceConfig('removed', {
      instanceName: 'Removed Bot',
      appId: 'removed-app',
      appSecret: 'removed-secret',
      enabled: true,
    });
    store.setFeishuInstanceConfig('kept', {
      instanceName: 'Kept Bot',
      appId: 'kept-app',
      appSecret: 'kept-secret',
      enabled: true,
    });

    store.setConfig({
      feishu: {
        instances: [
          store.getFeishuInstanceConfig('kept')!,
        ],
      },
      settings: {
        skillsEnabled: true,
        platformAgentBindings: {
          'feishu:removed': 'agent-removed',
          'feishu:kept': 'agent-kept',
        },
      },
    });

    expect(store.getFeishuInstanceConfig('removed')).toBe(null);
    expect(store.getIMSettings().platformAgentBindings).toEqual({
      'feishu:kept': 'agent-kept',
    });
  });

  test('migrates legacy NIM single config to one instance and preserves public projection', () => {
    const { store } = createStore();

    store.setIMSettings({
      platformAgentBindings: {
        nim: 'agent-nim',
        popo: 'agent-popo',
      },
    });
    store.setNimConfig({
      enabled: true,
      appKey: 'nim-app-key',
      account: 'nim-bot',
      token: 'nim-token',
    });

    const instances = store.getNimInstances();
    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({
      instanceName: 'NIM Bot 1',
      enabled: true,
      appKey: 'nim-app-key',
      account: 'nim-bot',
      token: 'nim-token',
    });
    expect(store.getConfig().nim.instances).toHaveLength(1);
    expect(store.getConfig().nim.instances?.[0].instanceId).toBe(instances[0].instanceId);
    expect(store.getConfig().nim).toMatchObject({
      enabled: true,
      appKey: 'nim-app-key',
      account: 'nim-bot',
      token: 'nim-token',
    });
    expect(store.getIMSettings().platformAgentBindings).toEqual({
      nim: 'agent-nim',
      popo: 'agent-popo',
    });
  });

  test('setNimConfig updates the primary NIM instance after migration', () => {
    const { store } = createStore();

    store.setNimConfig({
      enabled: true,
      appKey: 'nim-app-key',
      account: 'nim-bot',
      token: 'old-token',
    });
    const instanceId = store.getNimInstances()[0].instanceId;

    store.setNimConfig({
      token: 'new-token',
    });

    expect(store.getNimInstanceConfig(instanceId)).toMatchObject({
      token: 'new-token',
    });
    expect(store.getConfig().nim.token).toBe('new-token');
  });

  test('setNimConfig ignores renderer instance projection while updating the primary instance', () => {
    const { store } = createStore();

    store.setNimConfig({
      enabled: true,
      appKey: 'nim-app-key',
      account: 'nim-bot',
      token: 'old-token',
    });
    const instanceId = store.getNimInstances()[0].instanceId;

    store.setNimConfig({
      token: 'new-token',
      instances: [
        {
          instanceId: 'injected',
          instanceName: 'Injected NIM',
          enabled: true,
          appKey: 'bad-app',
          account: 'bad-account',
          token: 'bad-token',
        },
      ],
    });

    expect(store.getNimInstances()).toHaveLength(1);
    expect(store.getNimInstanceConfig('injected')).toBe(null);
    expect(store.getNimInstanceConfig(instanceId)).toMatchObject({
      token: 'new-token',
      appKey: 'nim-app-key',
      account: 'nim-bot',
    });
  });

  test('replacing NIM multi-instance config removes stale bindings', () => {
    const { store } = createStore();

    store.setNimInstanceConfig('removed', {
      instanceName: 'Removed NIM',
      appKey: 'removed-app',
      account: 'removed-bot',
      token: 'removed-token',
      enabled: true,
    });
    store.setNimInstanceConfig('kept', {
      instanceName: 'Kept NIM',
      appKey: 'kept-app',
      account: 'kept-bot',
      token: 'kept-token',
      enabled: true,
    });
    store.setIMSettings({
      platformAgentBindings: {
        'nim:removed': 'agent-removed',
        'nim:kept': 'agent-kept',
        popo: 'agent-popo',
      },
    });

    store.setNimMultiInstanceConfig({
      instances: [
        {
          ...store.getNimInstanceConfig('kept')!,
          token: 'new-kept-token',
        },
      ],
    });

    expect(store.getNimInstanceConfig('removed')).toBe(null);
    expect(store.getNimInstanceConfig('kept')).toMatchObject({
      token: 'new-kept-token',
    });
    expect(store.getIMSettings().platformAgentBindings).toEqual({
      'nim:kept': 'agent-kept',
      popo: 'agent-popo',
    });
  });

  test('migrates legacy POPO single config to one instance and preserves public projection', () => {
    const { store } = createStore();

    store.setIMSettings({
      platformAgentBindings: {
        popo: 'agent-popo',
        nim: 'agent-nim',
      },
    });
    store.setPopoConfig({
      enabled: true,
      appKey: 'popo-app-key',
      appSecret: 'popo-secret',
      aesKey: 'popo-aes',
    });

    const instances = store.getPopoInstances();
    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({
      instanceName: 'POPO Bot 1',
      enabled: true,
      appKey: 'popo-app-key',
      appSecret: 'popo-secret',
      aesKey: 'popo-aes',
    });
    expect(store.getConfig().popo.instances).toHaveLength(1);
    expect(store.getConfig().popo.instances?.[0].instanceId).toBe(instances[0].instanceId);
    expect(store.getConfig().popo).toMatchObject({
      enabled: true,
      appKey: 'popo-app-key',
      appSecret: 'popo-secret',
      aesKey: 'popo-aes',
    });
    expect(store.getIMSettings().platformAgentBindings).toEqual({
      popo: 'agent-popo',
      nim: 'agent-nim',
    });
  });

  test('setPopoConfig updates the primary POPO instance after migration', () => {
    const { store } = createStore();

    store.setPopoConfig({
      enabled: true,
      appKey: 'popo-app-key',
      appSecret: 'old-secret',
      aesKey: 'popo-aes',
    });
    const instanceId = store.getPopoInstances()[0].instanceId;

    store.setPopoConfig({
      appSecret: 'new-secret',
    });

    expect(store.getPopoInstanceConfig(instanceId)).toMatchObject({
      appSecret: 'new-secret',
    });
    expect(store.getConfig().popo.appSecret).toBe('new-secret');
  });

  test('setPopoConfig ignores renderer instance projection while updating the primary instance', () => {
    const { store } = createStore();

    store.setPopoConfig({
      enabled: true,
      appKey: 'popo-app-key',
      appSecret: 'old-secret',
      aesKey: 'popo-aes',
    });
    const instanceId = store.getPopoInstances()[0].instanceId;

    store.setPopoConfig({
      appSecret: 'new-secret',
      instances: [
        {
          instanceId: 'injected',
          instanceName: 'Injected POPO',
          enabled: true,
          connectionMode: 'websocket',
          appKey: 'bad-app',
          appSecret: 'bad-secret',
          token: '',
          aesKey: 'bad-aes',
          webhookBaseUrl: '',
          webhookPath: '/popo/callback',
          webhookPort: 3100,
          dmPolicy: 'open',
          allowFrom: [],
          groupPolicy: 'open',
          groupAllowFrom: [],
          textChunkLimit: 3000,
          richTextChunkLimit: 5000,
          debug: false,
        },
      ],
    });

    expect(store.getPopoInstances()).toHaveLength(1);
    expect(store.getPopoInstanceConfig('injected')).toBe(null);
    expect(store.getPopoInstanceConfig(instanceId)).toMatchObject({
      appSecret: 'new-secret',
      appKey: 'popo-app-key',
      aesKey: 'popo-aes',
    });
  });

  test('replacing POPO multi-instance config removes stale bindings', () => {
    const { store } = createStore();

    store.setPopoInstanceConfig('removed', {
      instanceName: 'Removed POPO',
      appKey: 'removed-app',
      appSecret: 'removed-secret',
      aesKey: 'removed-aes',
      enabled: true,
    });
    store.setPopoInstanceConfig('kept', {
      instanceName: 'Kept POPO',
      appKey: 'kept-app',
      appSecret: 'kept-secret',
      aesKey: 'kept-aes',
      enabled: true,
    });
    store.setIMSettings({
      platformAgentBindings: {
        'popo:removed': 'agent-removed',
        'popo:kept': 'agent-kept',
        nim: 'agent-nim',
      },
    });

    store.setPopoMultiInstanceConfig({
      instances: [
        {
          ...store.getPopoInstanceConfig('kept')!,
          appSecret: 'new-kept-secret',
        },
      ],
    });

    expect(store.getPopoInstanceConfig('removed')).toBe(null);
    expect(store.getPopoInstanceConfig('kept')).toMatchObject({
      appSecret: 'new-kept-secret',
    });
    expect(store.getIMSettings().platformAgentBindings).toEqual({
      'popo:kept': 'agent-kept',
      nim: 'agent-nim',
    });
  });
});
