import { expect, test } from 'vitest';

import {
  DEFAULT_IM_CONFIG,
  type DingTalkInstanceConfig,
  type EmailInstanceConfig,
  type FeishuInstanceConfig,
  type IMGatewayConfig,
  type NimInstanceConfig,
  type PopoInstanceConfig,
} from '../../types/im';
import {
  buildAgentBindingKeyBindings,
  collectAgentBoundBindingKeys,
  getAgentImBindingEnabledInstances,
  hasAgentImBindingInstanceConfigs,
  isAgentImBindingPlatformConfigured,
  isMultiInstanceAgentBindingPlatform,
  normalizeAgentImBindingKey,
  normalizeAgentImBindingPlatform,
} from './agentImBindingConfig';

const createConfig = (patch: Partial<IMGatewayConfig>): IMGatewayConfig => ({
  ...DEFAULT_IM_CONFIG,
  ...patch,
});

test('normalizeAgentImBindingPlatform 兼容 xiaomifeng 旧别名', () => {
  expect(normalizeAgentImBindingPlatform('xiaomifeng')).toBe('netease-bee');
  expect(normalizeAgentImBindingPlatform('weixin')).toBe('weixin');
});

test('normalizeAgentImBindingKey 会标准化绑定 key 的平台部分', () => {
  expect(normalizeAgentImBindingKey('xiaomifeng')).toBe('netease-bee');
  expect(normalizeAgentImBindingKey('feishu:bot-a')).toBe('feishu:bot-a');
  expect(normalizeAgentImBindingKey(' feishu : bot-a ')).toBe('feishu:bot-a');
  expect(normalizeAgentImBindingKey(' xiaomifeng ')).toBe('netease-bee');
});

test('isAgentImBindingPlatformConfigured 支持多实例与 netease-bee', () => {
  const config = createConfig({
    dingtalk: {
      instances: [
        { instanceId: 'a', instanceName: 'A', enabled: false } as unknown as DingTalkInstanceConfig,
        { instanceId: 'b', instanceName: 'B', enabled: true } as unknown as DingTalkInstanceConfig,
      ],
    },
    'netease-bee': {
      ...DEFAULT_IM_CONFIG['netease-bee'],
      enabled: true,
      clientId: 'bee-client',
      secret: 'bee-secret',
    },
  });

  expect(isAgentImBindingPlatformConfigured(config, 'dingtalk')).toBe(true);
  expect(isAgentImBindingPlatformConfigured(config, 'xiaomifeng')).toBe(true);
  expect(isAgentImBindingPlatformConfigured(config, 'weixin')).toBe(false);
});

test('isAgentImBindingPlatformConfigured 支持 NIM 和 POPO 单实例渠道', () => {
  const config = createConfig({
    nim: {
      instances: [
        {
          instanceId: 'nim-primary',
          instanceName: 'NIM Primary',
          enabled: true,
          appKey: 'nim-app-key',
          account: 'nim-bot',
          token: 'nim-token',
        } as NimInstanceConfig,
      ],
    },
    popo: {
      instances: [
        {
          instanceId: 'popo-primary',
          instanceName: 'POPO Primary',
          enabled: true,
          appKey: 'popo-app-key',
          appSecret: 'popo-secret',
          token: 'popo-token',
        } as PopoInstanceConfig,
      ],
    },
  });

  expect(isAgentImBindingPlatformConfigured(config, 'nim')).toBe(true);
  expect(isAgentImBindingPlatformConfigured(config, 'popo')).toBe(true);
});

test('hasAgentImBindingInstanceConfigs 可识别未来 NIM 和 POPO 实例数组', () => {
  const config = createConfig({
    nim: {
      instances: [
        {
          ...DEFAULT_IM_CONFIG.nim,
          instanceId: 'nim-primary',
          instanceName: 'NIM Primary',
          enabled: true,
        },
      ],
    } as unknown as IMGatewayConfig['nim'],
    popo: {
      instances: [
        {
          ...DEFAULT_IM_CONFIG.popo,
          instanceId: 'popo-primary',
          instanceName: 'POPO Primary',
          enabled: true,
        },
      ],
    } as unknown as IMGatewayConfig['popo'],
  });

  expect(hasAgentImBindingInstanceConfigs(config, 'nim')).toBe(true);
  expect(hasAgentImBindingInstanceConfigs(config, 'popo')).toBe(true);
  expect(hasAgentImBindingInstanceConfigs(DEFAULT_IM_CONFIG, 'nim')).toBe(false);
  expect(hasAgentImBindingInstanceConfigs(DEFAULT_IM_CONFIG, 'popo')).toBe(false);
});

test('isAgentImBindingPlatformConfigured 在 NIM/POPO 实例模式下按启用实例判断', () => {
  const config = createConfig({
    nim: {
      instances: [
        {
          ...DEFAULT_IM_CONFIG.nim,
          instanceId: 'nim-disabled',
          instanceName: 'NIM Disabled',
          enabled: false,
        },
      ],
    } as unknown as IMGatewayConfig['nim'],
    popo: {
      instances: [
        {
          ...DEFAULT_IM_CONFIG.popo,
          instanceId: 'popo-enabled',
          instanceName: 'POPO Enabled',
          enabled: true,
        },
      ],
    } as unknown as IMGatewayConfig['popo'],
  });

  expect(isAgentImBindingPlatformConfigured(config, 'nim')).toBe(false);
  expect(isAgentImBindingPlatformConfigured(config, 'popo')).toBe(true);
});

test('isMultiInstanceAgentBindingPlatform 能识别多实例平台', () => {
  expect(isMultiInstanceAgentBindingPlatform('feishu')).toBe(true);
  expect(isMultiInstanceAgentBindingPlatform('weixin')).toBe(false);
  expect(isMultiInstanceAgentBindingPlatform('nim')).toBe(false);
  expect(isMultiInstanceAgentBindingPlatform('popo')).toBe(false);
});

test('getAgentImBindingEnabledInstances 仅返回已启用实例', () => {
  const config = createConfig({
    feishu: {
      instances: [
        { instanceId: 'a', instanceName: 'A', enabled: false } as unknown as FeishuInstanceConfig,
        { instanceId: 'b', instanceName: 'B', enabled: true } as unknown as FeishuInstanceConfig,
      ],
    },
  });

  expect(
    getAgentImBindingEnabledInstances(config, 'feishu').map((instance) => instance.instanceId),
  ).toEqual(['b']);
});

test('getAgentImBindingEnabledInstances 支持未来 NIM 和 POPO 实例数组', () => {
  const config = createConfig({
    nim: {
      instances: [
        {
          ...DEFAULT_IM_CONFIG.nim,
          instanceId: 'nim-disabled',
          instanceName: 'NIM Disabled',
          enabled: false,
        },
        {
          ...DEFAULT_IM_CONFIG.nim,
          instanceId: 'nim-enabled',
          instanceName: 'NIM Enabled',
          enabled: true,
        },
      ],
    } as unknown as IMGatewayConfig['nim'],
  });

  expect(
    getAgentImBindingEnabledInstances(config, 'nim').map((instance) => instance.instanceId),
  ).toEqual(['nim-enabled']);
});

test('hasAgentImBindingInstanceConfigs 可识别 Email 实例数组', () => {
  const config = createConfig({
    email: {
      instances: [
        {
          instanceId: 'email-enabled',
          instanceName: 'Email Enabled',
          enabled: true,
          transport: 'ws',
          email: 'bot@example.com',
          apiKey: 'ck_test',
          agentId: 'main',
        } as EmailInstanceConfig,
      ],
    } as IMGatewayConfig['email'],
  });

  expect(hasAgentImBindingInstanceConfigs(config, 'email')).toBe(true);
  expect(hasAgentImBindingInstanceConfigs(DEFAULT_IM_CONFIG, 'email')).toBe(false);
});

test('getAgentImBindingEnabledInstances 仅返回已启用 Email 实例', () => {
  const config = createConfig({
    email: {
      instances: [
        {
          instanceId: 'email-disabled',
          instanceName: 'Email Disabled',
          enabled: false,
          transport: 'ws',
          email: 'disabled@example.com',
          apiKey: 'ck_disabled',
          agentId: 'main',
        } as EmailInstanceConfig,
        {
          instanceId: 'email-enabled',
          instanceName: 'Email Enabled',
          enabled: true,
          transport: 'ws',
          email: 'bot@example.com',
          apiKey: 'ck_test',
          agentId: 'main',
        } as EmailInstanceConfig,
      ],
    } as IMGatewayConfig['email'],
  });

  expect(
    getAgentImBindingEnabledInstances(config, 'email').map((instance) => instance.instanceId),
  ).toEqual(['email-enabled']);
});

test('collectAgentBoundBindingKeys 会过滤已禁用的 Email 实例绑定', () => {
  const config = createConfig({
    email: {
      instances: [
        {
          instanceId: 'email-disabled',
          instanceName: 'Email Disabled',
          enabled: false,
          transport: 'ws',
          email: 'disabled@example.com',
          apiKey: 'ck_disabled',
          agentId: 'main',
        } as EmailInstanceConfig,
        {
          instanceId: 'email-enabled',
          instanceName: 'Email Enabled',
          enabled: true,
          transport: 'ws',
          email: 'bot@example.com',
          apiKey: 'ck_test',
          agentId: 'main',
        } as EmailInstanceConfig,
      ],
    } as IMGatewayConfig['email'],
  });

  expect(
    collectAgentBoundBindingKeys(
      {
        'email:email-disabled': 'agent-1',
        'email:email-enabled': 'agent-1',
      },
      'agent-1',
      ['email'],
      config,
    ),
  ).toEqual(new Set(['email:email-enabled']));
});

test('collectAgentBoundBindingKeys 会按可见平台列表回填绑定 key', () => {
  expect(
    collectAgentBoundBindingKeys(
      {
        'netease-bee': 'agent-1',
        'qq:bot-1': 'agent-1',
        weixin: 'agent-2',
      },
      'agent-1',
      ['qq', 'netease-bee'],
    ),
  ).toEqual(new Set(['qq:bot-1', 'netease-bee']));
});

test('buildAgentBindingKeyBindings 会清理旧绑定并写入标准 key', () => {
  expect(
    buildAgentBindingKeyBindings(
      {
        'qq:bot-1': 'agent-1',
        'netease-bee': 'agent-1',
        weixin: 'agent-2',
      },
      'agent-1',
      ['xiaomifeng', 'wecom:corp-1'],
    ),
  ).toEqual({
    weixin: 'agent-2',
    'netease-bee': 'agent-1',
    'wecom:corp-1': 'agent-1',
  });
});

test('buildAgentBindingKeyBindings 会清理空白并避免写入脏实例 key', () => {
  expect(
    buildAgentBindingKeyBindings(
      {
        'feishu:bot-old': 'agent-1',
      },
      'agent-1',
      [' feishu : bot-new '],
    ),
  ).toEqual({
    'feishu:bot-new': 'agent-1',
  });
});

test('buildAgentBindingKeyBindings 会同时清理同一 Agent 的平台级和实例级旧绑定', () => {
  expect(
    buildAgentBindingKeyBindings(
      {
        feishu: 'agent-1',
        'feishu:bot-old': 'agent-1',
        'feishu:bot-other': 'agent-2',
        'dingtalk:bot-old': 'agent-1',
      },
      'agent-1',
      ['feishu:bot-new'],
    ),
  ).toEqual({
    'feishu:bot-other': 'agent-2',
    'feishu:bot-new': 'agent-1',
  });
});

test('buildAgentBindingKeyBindings 会写入 Email 实例 key 并清理同 Agent 旧绑定', () => {
  expect(
    buildAgentBindingKeyBindings(
      {
        'email:email-old': 'agent-1',
        'email:email-other': 'agent-2',
      },
      'agent-1',
      ['email:email-enabled'],
    ),
  ).toEqual({
    'email:email-other': 'agent-2',
    'email:email-enabled': 'agent-1',
  });
});

test('buildAgentBindingKeyBindings 会用当前选择接管其他 Agent 的旧绑定', () => {
  expect(
    buildAgentBindingKeyBindings(
      {
        'feishu:bot-a': 'agent-2',
        dingtalk: 'agent-3',
      },
      'agent-1',
      ['feishu:bot-a', 'dingtalk'],
    ),
  ).toEqual({
    'feishu:bot-a': 'agent-1',
    dingtalk: 'agent-1',
  });
});

test('collectAgentBoundBindingKeys 不会把其他 Agent 的实例绑定回填给当前 Agent', () => {
  expect(
    collectAgentBoundBindingKeys(
      {
        'feishu:bot-a': 'agent-1',
        'feishu:bot-b': 'agent-2',
        feishu: 'agent-1',
      },
      'agent-1',
      ['feishu'],
    ),
  ).toEqual(new Set(['feishu:bot-a', 'feishu']));
});

test('collectAgentBoundBindingKeys 会过滤已禁用的多实例绑定', () => {
  const config = createConfig({
    feishu: {
      instances: [
        { instanceId: 'enabled', instanceName: 'Enabled', enabled: true } as unknown as FeishuInstanceConfig,
        { instanceId: 'disabled', instanceName: 'Disabled', enabled: false } as unknown as FeishuInstanceConfig,
      ],
    },
  });

  expect(
    collectAgentBoundBindingKeys(
      {
        'feishu:enabled': 'agent-1',
        'feishu:disabled': 'agent-1',
      },
      'agent-1',
      ['feishu'],
      config,
    ),
  ).toEqual(new Set(['feishu:enabled']));
});

test('collectAgentBoundBindingKeys 会按实例级保留 NIM 和 POPO 绑定', () => {
  const config = createConfig({
    nim: {
      instances: [
        { instanceId: 'nim-enabled', instanceName: 'NIM Enabled', enabled: true } as NimInstanceConfig,
      ],
    },
    popo: {
      instances: [
        { instanceId: 'popo-enabled', instanceName: 'POPO Enabled', enabled: true } as PopoInstanceConfig,
      ],
    },
    feishu: {
      instances: [
        { instanceId: 'enabled', instanceName: 'Enabled', enabled: true } as unknown as FeishuInstanceConfig,
        { instanceId: 'disabled', instanceName: 'Disabled', enabled: false } as unknown as FeishuInstanceConfig,
      ],
    },
  });

  expect(
    collectAgentBoundBindingKeys(
      {
        nim: 'agent-1',
        'nim:nim-enabled': 'agent-1',
        popo: 'agent-1',
        'popo:popo-enabled': 'agent-1',
        'feishu:enabled': 'agent-1',
        'feishu:disabled': 'agent-1',
      },
      'agent-1',
      ['nim', 'popo', 'feishu'],
      config,
    ),
  ).toEqual(new Set(['nim', 'nim:nim-enabled', 'popo', 'popo:popo-enabled', 'feishu:enabled']));
});

test('collectAgentBoundBindingKeys 在 NIM/POPO 实例模式下过滤禁用实例并保留旧平台绑定', () => {
  const config = createConfig({
    nim: {
      instances: [
        {
          ...DEFAULT_IM_CONFIG.nim,
          instanceId: 'enabled',
          instanceName: 'NIM Enabled',
          enabled: true,
        },
        {
          ...DEFAULT_IM_CONFIG.nim,
          instanceId: 'disabled',
          instanceName: 'NIM Disabled',
          enabled: false,
        },
      ],
    } as unknown as IMGatewayConfig['nim'],
    popo: {
      instances: [
        {
          ...DEFAULT_IM_CONFIG.popo,
          instanceId: 'enabled',
          instanceName: 'POPO Enabled',
          enabled: true,
        },
      ],
    } as unknown as IMGatewayConfig['popo'],
  });

  expect(
    collectAgentBoundBindingKeys(
      {
        nim: 'agent-1',
        'nim:enabled': 'agent-1',
        'nim:disabled': 'agent-1',
        'popo:enabled': 'agent-1',
      },
      'agent-1',
      ['nim', 'popo'],
      config,
    ),
  ).toEqual(new Set(['nim', 'nim:enabled', 'popo:enabled']));
});

test('buildAgentBindingKeyBindings 会用实例级 key 写入 NIM 和 POPO 绑定', () => {
  expect(
    buildAgentBindingKeyBindings(
      {
        nim: 'agent-1',
        'nim:nim-old': 'agent-1',
        'feishu:old': 'agent-1',
        weixin: 'agent-2',
      },
      'agent-1',
      ['nim:nim-enabled', 'popo:popo-enabled'],
    ),
  ).toEqual({
    weixin: 'agent-2',
    'nim:nim-enabled': 'agent-1',
    'popo:popo-enabled': 'agent-1',
  });
});
