import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getPath: (name: string) => {
      if (name === 'home') return os.homedir();
      return os.tmpdir();
    },
  },
}));

const mockRuntimeState = vi.hoisted(() => ({
  proxyPort: null as number | null,
  codexAccountId: 'acct-runtime-test' as string | null,
  enabledProviders: [] as Array<{
    providerName: string;
    baseURL: string;
    apiKey: string;
    apiType: 'anthropic' | 'openai';
    authType?: 'apikey' | 'oauth';
    codingPlanEnabled: boolean;
    models: Array<{
      id: string;
      name: string;
      supportsImage?: boolean;
      contextWindow?: number;
      customParams?: Record<string, unknown>;
    }>;
  }>,
  rawApiConfig: {
    config: {
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-test',
      apiType: 'openai',
    },
    providerMetadata: {
      providerName: 'openai',
      codingPlanEnabled: false,
      supportsImage: false,
      modelName: 'GPT Test',
    },
  },
}));

vi.mock('./claudeSettings', () => ({
  getAllServerModelMetadata: () => [],
  resolveAllEnabledProviderConfigs: () => mockRuntimeState.enabledProviders,
  resolveAllProviderApiKeys: () => ({}),
  resolveRawApiConfig: () => mockRuntimeState.rawApiConfig,
}));

vi.mock('./openclawLocalExtensions', () => ({
  hasBundledOpenClawExtension: (id: string) => [
    'mcp-bridge',
    'openclaw-lark',
    'openclaw-nim-channel',
    'nimsuite-openclaw-nim-channel',
    'qwen-portal-auth',
    'clawemail-email',
  ].includes(id),
  resolveOpenClawExtensionConfigId: (id: string) => ({
    'openclaw-nim-channel': 'nimsuite-openclaw-nim-channel',
  }[id] ?? id),
  resolveOpenClawExtensionLoadPath: (id: string) => (
    id === 'custom-plugin' ? '/tmp/custom-plugin' : null
  ),
}));

vi.mock('./openclawTokenProxy', () => ({
  getOpenClawTokenProxyPort: () => mockRuntimeState.proxyPort,
}));

vi.mock('./openaiCodexAuth', () => ({
  readOpenAICodexAuthFile: () => mockRuntimeState.codexAccountId
    ? {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        accountId: mockRuntimeState.codexAccountId,
        expiresAt: 0,
      }
    : null,
}));

describe('OpenClawConfigSync runtime config output', () => {
  let tmpDir: string;
  let configPath: string;
  let stateDir: string;

  beforeEach(() => {
    mockRuntimeState.proxyPort = null;
    mockRuntimeState.codexAccountId = 'acct-runtime-test';
    mockRuntimeState.enabledProviders = [];
    mockRuntimeState.rawApiConfig = {
      config: {
        baseURL: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-test',
        apiType: 'openai',
      },
      providerMetadata: {
        providerName: 'openai',
        codingPlanEnabled: false,
        supportsImage: false,
        modelName: 'GPT Test',
      },
    };
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-config-sync-'));
    stateDir = path.join(tmpDir, 'state');
    configPath = path.join(stateDir, 'openclaw.json');
    fs.mkdirSync(stateDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.resetModules();
  });

  const createSync = async (overrides: Record<string, unknown> = {}) => {
    const { OpenClawConfigSync } = await import('./openclawConfigSync');
    return new OpenClawConfigSync({
      engineManager: {
        getConfigPath: () => configPath,
        getGatewayToken: () => 'gateway-token',
        getStateDir: () => stateDir,
        getBaseDir: () => tmpDir,
        getStatus: () => ({ version: 'test-version' }),
        getDesiredVersion: () => 'test-version',
      } as never,
      getCoworkConfig: () => ({
        workingDirectory: tmpDir,
        systemPrompt: '',
        executionMode: 'local',
        agentEngine: 'openclaw',
        memoryEnabled: false,
        memoryImplicitUpdateEnabled: false,
        memoryLlmJudgeEnabled: false,
        memoryGuardLevel: 'balanced',
        memoryUserMemoriesMaxItems: 100,
        skipMissedJobs: false,
        embeddingEnabled: false,
        embeddingProvider: 'openai',
        embeddingModel: '',
        embeddingLocalModelPath: '',
        embeddingVectorWeight: 0.7,
        embeddingRemoteBaseUrl: '',
        embeddingRemoteApiKey: '',
        dreamingEnabled: false,
        dreamingFrequency: '0 3 * * *',
        dreamingModel: '',
        dreamingTimezone: '',
        openClawSessionPolicy: { keepAlive: '30d' },
      }),
      getDingTalkInstances: () => [],
      getFeishuInstances: () => [],
      getQQInstances: () => [],
      getWecomInstances: () => [],
      getPopoConfig: () => null,
      getNimConfig: () => null,
      getEmailOpenClawConfig: () => null,
      getNeteaseBeeChanConfig: () => null,
      getWeixinConfig: () => null,
      getIMSettings: () => null,
      getSkillsList: () => [],
      getAgents: () => [],
      ...overrides,
    } as never);
  };

  test('writes main workspace without unsupported agents.defaults.cwd', async () => {
    const sync = await createSync();

    const result = sync.sync('cwd-schema-compat');
    expect(result.ok).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.agents.defaults.workspace).toBe(path.join(stateDir, 'workspace-main'));
    expect(config.agents.defaults).not.toHaveProperty('cwd');
    expect(config.agents.defaults.heartbeat).toEqual({
      every: '1h',
      target: 'none',
      lightContext: true,
      isolatedSession: true,
    });
  });

  test('does not write memory search config while embedding is disabled', async () => {
    const sync = await createSync();

    const result = sync.sync('embedding-disabled');
    expect(result.ok).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.agents.defaults.memorySearch).toBeUndefined();
  });

  test('writes memory search config with safe provider and cjk tokenizer', async () => {
    const sync = await createSync({
      getCoworkConfig: () => ({
        workingDirectory: tmpDir,
        systemPrompt: '',
        executionMode: 'local',
        agentEngine: 'openclaw',
        memoryEnabled: false,
        memoryImplicitUpdateEnabled: false,
        memoryLlmJudgeEnabled: false,
        memoryGuardLevel: 'balanced',
        memoryUserMemoriesMaxItems: 100,
        skipMissedJobs: false,
        embeddingEnabled: true,
        embeddingProvider: 'legacy-provider',
        embeddingModel: 'text-embedding-3-small',
        embeddingLocalModelPath: '',
        embeddingVectorWeight: 1.25,
        embeddingRemoteBaseUrl: 'https://embedding.example/v1',
        embeddingRemoteApiKey: 'embedding-key',
        dreamingEnabled: false,
        dreamingFrequency: '0 3 * * *',
        dreamingModel: '',
        dreamingTimezone: '',
        openClawSessionPolicy: { keepAlive: '30d' },
      }),
    });

    const result = sync.sync('embedding-enabled');
    expect(result.ok).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.agents.defaults.memorySearch).toMatchObject({
      enabled: true,
      provider: 'openai',
      model: 'text-embedding-3-small',
      remote: {
        baseUrl: 'https://embedding.example/v1',
        apiKey: 'embedding-key',
      },
      store: {
        fts: { tokenizer: 'trigram' },
      },
      query: {
        hybrid: { vectorWeight: 1 },
      },
    });
  });

  test('normalizes supported memory search provider values before writing config', async () => {
    const sync = await createSync({
      getCoworkConfig: () => ({
        workingDirectory: tmpDir,
        systemPrompt: '',
        executionMode: 'local',
        agentEngine: 'openclaw',
        memoryEnabled: false,
        memoryImplicitUpdateEnabled: false,
        memoryLlmJudgeEnabled: false,
        memoryGuardLevel: 'balanced',
        memoryUserMemoriesMaxItems: 100,
        skipMissedJobs: false,
        embeddingEnabled: true,
        embeddingProvider: ' Gemini ',
        embeddingModel: 'gemini-embedding-001',
        embeddingLocalModelPath: '',
        embeddingVectorWeight: 0.25,
        embeddingRemoteBaseUrl: '',
        embeddingRemoteApiKey: '',
        dreamingEnabled: false,
        dreamingFrequency: '0 3 * * *',
        dreamingModel: '',
        dreamingTimezone: '',
        openClawSessionPolicy: { keepAlive: '30d' },
      }),
    });

    const result = sync.sync('embedding-provider-normalized');
    expect(result.ok).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.agents.defaults.memorySearch.provider).toBe('gemini');
    expect(config.agents.defaults.memorySearch.query.hybrid.vectorWeight).toBe(0.25);
  });

  test('stamps openclaw config metadata when writing full config', async () => {
    const sync = await createSync();

    const result = sync.sync('meta-stamp');
    expect(result.ok).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.meta.lastTouchedVersion).toBe('test-version');
    expect(typeof config.meta.lastTouchedAt).toBe('string');
    expect(Number.isNaN(Date.parse(config.meta.lastTouchedAt))).toBe(false);
  });

  test('ignores meta-only differences when detecting config changes', async () => {
    const sync = await createSync();

    const first = sync.sync('meta-initial');
    expect(first.ok).toBe(true);
    expect(first.changed).toBe(true);

    const existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    existing.meta = {
      lastTouchedVersion: 'older-version',
      lastTouchedAt: '2026-05-01T00:00:00.000Z',
    };
    fs.writeFileSync(configPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');

    const second = sync.sync('meta-only-diff');
    expect(second.ok).toBe(true);
    expect(second.changed).toBe(false);
  });

  test('preserves runtime-injected gateway fields while keeping managed mode', async () => {
    fs.writeFileSync(configPath, JSON.stringify({
      gateway: {
        mode: 'remote',
        auth: { mode: 'token', token: '${OPENCLAW_GATEWAY_TOKEN}' },
        tailscale: { mode: 'off' },
      },
    }, null, 2));

    const sync = await createSync();
    const result = sync.sync('preserve-gateway-runtime-fields');
    expect(result.ok).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.gateway).toMatchObject({
      mode: 'local',
      auth: { mode: 'token', token: '${OPENCLAW_GATEWAY_TOKEN}' },
      tailscale: { mode: 'off' },
    });
  });

  test('disables mcporter so MCP routing uses the built-in bridge', async () => {
    const sync = await createSync();

    const result = sync.sync('managed-skill-overrides');
    expect(result.ok).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.skills.entries.mcporter).toEqual({ enabled: false });
  });

  test('syncs dreaming settings into memory-core plugin config', async () => {
    const sync = await createSync({
      getCoworkConfig: () => ({
        workingDirectory: tmpDir,
        systemPrompt: '',
        executionMode: 'local',
        agentEngine: 'openclaw',
        memoryEnabled: false,
        memoryImplicitUpdateEnabled: false,
        memoryLlmJudgeEnabled: false,
        memoryGuardLevel: 'balanced',
        memoryUserMemoriesMaxItems: 100,
        skipMissedJobs: false,
        embeddingEnabled: false,
        embeddingProvider: 'openai',
        embeddingModel: '',
        embeddingLocalModelPath: '',
        embeddingVectorWeight: 0.7,
        embeddingRemoteBaseUrl: '',
        embeddingRemoteApiKey: '',
        dreamingEnabled: true,
        dreamingFrequency: '0 */6 * * *',
        dreamingModel: 'dream-model',
        dreamingTimezone: 'Asia/Shanghai',
        openClawSessionPolicy: { keepAlive: '30d' },
      }),
    });

    const result = sync.sync('dreaming-enabled');
    expect(result.ok).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.plugins.entries['memory-core'].config.dreaming).toEqual({
      enabled: true,
      frequency: '0 */6 * * *',
      model: 'dream-model',
      timezone: 'Asia/Shanghai',
    });
  });

  test('does not write native MCP servers before resolver hook is enabled', async () => {
    const sync = await createSync();

    const result = sync.sync('native-mcp-disabled');
    expect(result.ok).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config).not.toHaveProperty('mcp');
  });

  test('writes native MCP servers when resolver hook is provided', async () => {
    const sync = await createSync({
      getResolvedMcpServers: () => [
        {
          name: 'local-memory',
          transportType: 'stdio',
          command: '/usr/local/bin/node',
          args: ['server.js'],
          env: { MEMORY_PATH: '/tmp/memory' },
        },
        {
          name: 'remote-docs',
          transportType: 'sse',
          url: 'https://mcp.example.com/sse',
          headers: { Authorization: 'Bearer token' },
        },
        {
          name: 'stream-api',
          transportType: 'http',
          url: 'https://mcp.example.com/mcp',
          headers: { 'X-Api-Key': 'secret' },
        },
      ],
    });

    const result = sync.sync('native-mcp-enabled');
    expect(result.ok).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.mcp.servers).toEqual({
      'local-memory': {
        command: '/usr/local/bin/node',
        args: ['server.js'],
        env: { MEMORY_PATH: '/tmp/memory' },
      },
      'remote-docs': {
        url: 'https://mcp.example.com/sse',
        headers: { authorization: 'Bearer token' },
      },
      'stream-api': {
        url: 'https://mcp.example.com/mcp',
        headers: { 'x-api-key': 'secret' },
        transport: 'streamable-http',
      },
    });
  });

  test('writes QingShu managed native MCP server config', async () => {
    const sync = await createSync({
      getResolvedMcpServers: () => [
        {
          name: 'qingshu-managed',
          transportType: 'http',
          url: 'http://127.0.0.1:54321/mcp',
          headers: { 'X-QingShu-Managed-Mcp-Secret': 'managed-secret' },
        },
      ],
    });

    const result = sync.sync('qingshu-managed-native-mcp');
    expect(result.ok).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.mcp.servers['qingshu-managed']).toEqual({
      url: 'http://127.0.0.1:54321/mcp',
      headers: { 'x-qingshu-managed-mcp-secret': 'managed-secret' },
      transport: 'streamable-http',
    });
  });

  test('writes enabled user plugins into OpenClaw plugin entries', async () => {
    const sync = await createSync({
      getUserPlugins: () => [
        {
          pluginId: 'custom-plugin',
          source: 'local',
          spec: '/tmp/custom-plugin',
          enabled: true,
          installedAt: 1,
          config: {
            apiKey: '${CUSTOM_PLUGIN_API_KEY}',
            mode: 'safe',
          },
        },
        {
          pluginId: 'disabled-plugin',
          source: 'local',
          spec: '/tmp/disabled-plugin',
          enabled: false,
          installedAt: 2,
        },
      ],
    });

    const result = sync.sync('user-plugin-entries');
    expect(result.ok).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.plugins.entries['custom-plugin']).toEqual({
      enabled: true,
      config: {
        apiKey: '${CUSTOM_PLUGIN_API_KEY}',
        mode: 'safe',
      },
    });
    expect(config.plugins.entries).not.toHaveProperty('disabled-plugin');
    expect(config.plugins.allow).toContain('custom-plugin');
    expect(config.plugins.allow).not.toContain('disabled-plugin');
  });

  test('writes only supported Weixin channel schema fields', async () => {
    const sync = await createSync({
      getWeixinConfig: () => ({
        enabled: true,
        accountId: 'wx-account-1',
        dmPolicy: 'open',
        allowFrom: ['user-1'],
        groupPolicy: 'open',
        groupAllowFrom: [],
        debug: true,
      }),
    });

    const result = sync.sync('weixin-channel-schema');
    expect(result.ok).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.channels['openclaw-weixin']).toEqual({
      enabled: true,
      dmPolicy: 'open',
      allowFrom: ['user-1', '*'],
    });
    expect(config.channels['openclaw-weixin']).not.toHaveProperty('accountId');
  });

  test('prefers external lark and bundled qqbot plugin entries', async () => {
    const sync = await createSync({
      getFeishuInstances: () => [{
        enabled: true,
        appId: 'cli_feishu_app',
        appSecret: 'secret',
        instanceId: 'feishu-instance-1',
        instanceName: 'Feishu Bot 1',
        domain: 'feishu',
        dmPolicy: 'open',
        allowFrom: ['*'],
        groupPolicy: 'allowlist',
        groupAllowFrom: [],
        groups: { '*': { requireMention: true } },
        historyLimit: 50,
        streaming: true,
        replyMode: 'auto',
        blockStreaming: false,
        footer: {},
        mediaMaxMb: 30,
        debug: true,
      }],
      getQQInstances: () => [{
        enabled: true,
        appId: 'qq-app-id',
        appSecret: 'qq-secret',
        instanceId: 'qq-instance-1',
        instanceName: 'QQ Bot 1',
        dmPolicy: 'open',
        allowFrom: ['*'],
        groupPolicy: 'open',
        groupAllowFrom: [],
        historyLimit: 50,
        markdownSupport: true,
        imageServerBaseUrl: '',
        debug: true,
      }],
    });

    const result = sync.sync('feishu-lark-qqbot');
    expect(result.ok).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.plugins.entries['openclaw-lark']).toEqual({ enabled: true });
    expect(config.plugins.entries.feishu).toEqual({ enabled: false });
    expect(config.plugins.entries.qqbot).toEqual({ enabled: true });
    expect(config.plugins.entries).not.toHaveProperty('openclaw-qqbot');
  });

  test('marks multi-instance IM channels enabled at top level', async () => {
    const sync = await createSync({
      getFeishuInstances: () => [{
        enabled: true,
        appId: 'feishu-app-id',
        appSecret: 'feishu-secret',
        instanceId: 'feishu-instance-1',
        instanceName: 'Feishu Bot 1',
        domain: 'feishu',
        dmPolicy: 'open',
        allowFrom: ['*'],
        groupPolicy: 'allowlist',
        groupAllowFrom: [],
        groups: {},
        historyLimit: 50,
        mediaMaxMb: 30,
      }],
      getDingTalkInstances: () => [{
        enabled: true,
        clientId: 'dingtalk-client-id',
        clientSecret: 'dingtalk-secret',
        instanceId: 'dingtalk-instance-1',
        instanceName: 'DingTalk Bot 1',
        dmPolicy: 'open',
        allowFrom: ['*'],
        groupPolicy: 'open',
      }],
      getQQInstances: () => [{
        enabled: true,
        appId: 'qq-app-id',
        appSecret: 'qq-secret',
        instanceId: 'qq-instance-1',
        instanceName: 'QQ Bot 1',
        dmPolicy: 'open',
        allowFrom: ['*'],
        groupPolicy: 'open',
        groupAllowFrom: [],
        historyLimit: 50,
        markdownSupport: true,
      }],
      getWecomInstances: () => [{
        enabled: true,
        botId: 'wecom-bot-id',
        secret: 'wecom-secret',
        instanceId: 'wecom-instance-1',
        instanceName: 'WeCom Bot 1',
        dmPolicy: 'open',
        allowFrom: ['*'],
        groupPolicy: 'open',
        groupAllowFrom: [],
      }],
      getEmailOpenClawConfig: () => ({
        instances: [{
          enabled: true,
          instanceId: 'email-work',
          instanceName: 'Work Email',
          transport: 'ws',
          email: 'bot@example.com',
          apiKey: 'email-secret-api-key',
          agentId: 'main',
          allowFrom: ['*@example.com'],
          replyMode: 'complete',
          replyTo: 'sender',
          a2aEnabled: true,
          a2aAgentDomains: ['example.com'],
          a2aMaxPingPongTurns: 8,
        }],
      }),
    });

    const result = sync.sync('multi-instance-channel-enabled');
    expect(result.ok).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.channels.feishu.enabled).toBe(true);
    expect(config.channels.dingtalk.enabled).toBe(true);
    expect(config.channels.qqbot.enabled).toBe(true);
    expect(config.channels.wecom.enabled).toBe(true);
    expect(config.channels.email).toEqual({
      enabled: true,
      accounts: {
        'email-work': {
          enabled: true,
          name: 'Work Email',
          email: 'bot@example.com',
          transport: 'ws',
          apiKey: '${LOBSTER_EMAIL_WORK_APIKEY}',
          allowFrom: ['*@example.com'],
          replyMode: 'complete',
          replyTo: 'sender',
          a2a: {
            enabled: true,
            agentDomains: ['example.com'],
            maxPingPongTurns: 8,
          },
        },
      },
    });
    expect(JSON.stringify(config)).not.toContain('email-secret-api-key');
    expect(config.plugins.entries['clawemail-email']).toEqual({ enabled: true });

    const env = sync.collectSecretEnvVars();
    expect(env.LOBSTER_EMAIL_WORK_APIKEY).toBe('email-secret-api-key');
  });

  test('projects legacy Feishu group chat ids into groups config', async () => {
    const sync = await createSync({
      getFeishuInstances: () => [{
        enabled: true,
        appId: 'feishu-app-id',
        appSecret: 'feishu-secret',
        instanceId: 'afc83707-a3ea-40a5-ba71-fbb72a817002',
        instanceName: 'Feishu Bot 1',
        domain: 'feishu',
        dmPolicy: 'open',
        allowFrom: [],
        groupPolicy: 'allowlist',
        groupAllowFrom: [
          'oc_6f3f554b197f45f82fe2f2526387f80e',
          'ou_sender_open_id',
          'oc_6f3f554b197f45f82fe2f2526387f80e',
        ],
        groups: {},
        historyLimit: 50,
        streaming: true,
        replyMode: 'auto',
        blockStreaming: false,
        footer: { status: true, elapsed: true },
        mediaMaxMb: 30,
        debug: false,
      }],
    });

    const result = sync.sync('feishu-group-chat-allowlist');
    expect(result.ok).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const account = config.channels.feishu.accounts.afc83707;
    expect(account.groupPolicy).toBe('allowlist');
    expect(account.groupAllowFrom).toEqual(['ou_sender_open_id']);
    expect(account.groups).toEqual({
      '*': { requireMention: true },
      oc_6f3f554b197f45f82fe2f2526387f80e: { requireMention: true },
    });
    expect(JSON.stringify(config)).not.toContain('feishu-secret');
  });

  test('cleans stale plugin package ids and preserves manifest entry config', async () => {
    fs.writeFileSync(configPath, JSON.stringify({
      plugins: {
        entries: {
          'clawemail-email': { enabled: true },
          'openclaw-nim-channel': { enabled: true },
          'nimsuite-openclaw-nim-channel': { enabled: false, config: { retained: true } },
          'qwen-portal-auth': { enabled: true },
        },
      },
    }, null, 2));

    const sync = await createSync({
      getNimConfig: () => ({
        enabled: true,
        appKey: 'nim-app-key',
        account: 'nim-account',
        token: 'nim-token',
      }),
    });

    const result = sync.sync('plugin-entry-cleanup');
    expect(result.ok).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.plugins.entries).not.toHaveProperty('clawemail-email');
    expect(config.plugins.entries).not.toHaveProperty('openclaw-nim-channel');
    expect(config.plugins.entries).not.toHaveProperty('qwen-portal-auth');
    expect(config.plugins.entries['nimsuite-openclaw-nim-channel']).toEqual({
      enabled: true,
      config: { retained: true },
    });
  });

  test('declares qwen portal auth plugin for DashScope providers when installed', async () => {
    const { ProviderName } = await import('../../shared/providers');
    mockRuntimeState.rawApiConfig = {
      config: {
        baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        apiKey: 'sk-qwen',
        model: 'qwen3.6-plus',
        apiType: 'openai',
      },
      providerMetadata: {
        providerName: ProviderName.Qwen,
        codingPlanEnabled: false,
        supportsImage: true,
        modelName: 'qwen3.6-plus',
      },
    };

    const sync = await createSync();
    const result = sync.sync('qwen-portal-auth-entry');
    expect(result.ok).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.plugins.entries['qwen-portal-auth']).toEqual({ enabled: true });
  });

  test('writes platform-level agent bindings with account wildcard and keeps instance bindings exact', async () => {
    const {
      OPENCLAW_BINDING_ANY_ACCOUNT_ID,
    } = await import('./openclawConfigSync');
    const sync = await createSync({
      getDingTalkInstances: () => [{
        enabled: true,
        clientId: 'ding-client-id',
        clientSecret: 'ding-secret',
        dmPolicy: 'open',
        allowFrom: ['*'],
        groupPolicy: 'open',
        sessionTimeout: 0,
        separateSessionByConversation: false,
        groupSessionScope: 'group',
        sharedMemoryAcrossConversations: false,
        gatewayBaseUrl: '',
        debug: false,
        instanceId: 'b8a32c47-c852-4ad2-bbfa-631797fc56ea',
        instanceName: 'DingTalk Bot 1',
      }],
      getWeixinConfig: () => ({
        enabled: true,
        accountId: '97a130e3b62f@im.bot',
        dmPolicy: 'open',
        allowFrom: [],
        debug: false,
      }),
      getEmailOpenClawConfig: () => ({
        instances: [{
          enabled: true,
          instanceId: 'email-sales',
          instanceName: 'Sales Email',
          transport: 'imap',
          email: 'sales@example.com',
          password: 'email-password',
          agentId: 'main',
        }],
      }),
      getTelegramInstances: () => [{
        enabled: true,
        instanceId: 'tgabcdef-1234-5678-9000-telegram',
        instanceName: 'Telegram Sales',
        botToken: 'telegram-secret-token',
        dmPolicy: 'open',
        allowFrom: ['*'],
        groupPolicy: 'allowlist',
        groupAllowFrom: [],
        groups: {},
        historyLimit: 50,
        replyToMode: 'off',
        linkPreview: true,
        streaming: 'off',
        mediaMaxMb: 5,
        proxy: '',
        webhookUrl: '',
        webhookSecret: '',
        debug: false,
      }],
      getDiscordInstances: () => [{
        enabled: true,
        instanceId: 'dcabcdef-1234-5678-9000-discord',
        instanceName: 'Discord Sales',
        botToken: 'discord-secret-token',
        dmPolicy: 'open',
        allowFrom: ['*'],
        groupPolicy: 'allowlist',
        groupAllowFrom: [],
        guilds: {},
        historyLimit: 50,
        streaming: 'off',
        mediaMaxMb: 25,
        proxy: '',
        debug: false,
      }],
      getIMSettings: () => ({
        platformAgentBindings: {
          'dingtalk:b8a32c47-c852-4ad2-bbfa-631797fc56ea': 'instance-agent',
          'telegram:tgabcdef-1234-5678-9000-telegram': 'telegram-agent',
          'discord:dcabcdef-1234-5678-9000-discord': 'discord-agent',
          'email:email-sales': 'email-agent',
          dingtalk: 'platform-agent',
          weixin: 'weixin-agent',
        },
      }),
      getAgents: () => [
        {
          id: 'instance-agent',
          enabled: true,
          name: 'Instance Agent',
          prompt: '',
          model: 'openai/gpt-test',
          source: 'user',
        },
        {
          id: 'platform-agent',
          enabled: true,
          name: 'Platform Agent',
          prompt: '',
          model: 'openai/gpt-test',
          source: 'user',
        },
        {
          id: 'weixin-agent',
          enabled: true,
          name: 'Weixin Agent',
          prompt: '',
          model: 'openai/gpt-test',
          source: 'user',
        },
        {
          id: 'telegram-agent',
          enabled: true,
          name: 'Telegram Agent',
          prompt: '',
          model: 'openai/gpt-test',
          source: 'user',
        },
        {
          id: 'discord-agent',
          enabled: true,
          name: 'Discord Agent',
          prompt: '',
          model: 'openai/gpt-test',
          source: 'user',
        },
        {
          id: 'email-agent',
          enabled: true,
          name: 'Email Agent',
          prompt: '',
          model: 'openai/gpt-test',
          source: 'user',
        },
      ],
    });

    const result = sync.sync('platform-binding-wildcard');
    expect(result.ok).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.bindings).toEqual([
      {
        agentId: 'instance-agent',
        match: {
          channel: 'dingtalk',
          accountId: 'b8a32c47',
        },
      },
      {
        agentId: 'platform-agent',
        match: {
          channel: 'dingtalk',
          accountId: OPENCLAW_BINDING_ANY_ACCOUNT_ID,
        },
      },
      {
        agentId: 'telegram-agent',
        match: {
          channel: 'telegram',
          accountId: 'tgabcdef',
        },
      },
      {
        agentId: 'discord-agent',
        match: {
          channel: 'discord',
          accountId: 'dcabcdef',
        },
      },
      {
        agentId: 'email-agent',
        match: {
          channel: 'email',
          accountId: 'email-sa',
        },
      },
      {
        agentId: 'weixin-agent',
        match: {
          channel: 'openclaw-weixin',
          accountId: OPENCLAW_BINDING_ANY_ACCOUNT_ID,
        },
      },
    ]);
  });

  test('does not create an agent model allowlist for OpenAI OAuth when system proxy is enabled', async () => {
    const { ProviderName } = await import('../../shared/providers');
    const { setSystemProxyEnabled } = await import('./systemProxy');
    setSystemProxyEnabled(true);
    mockRuntimeState.rawApiConfig = {
      config: {
        baseURL: 'https://api.openai.com/v1',
        apiKey: '',
        model: 'gpt-5.4',
        apiType: 'openai',
      },
      providerMetadata: {
        providerName: ProviderName.OpenAI,
        authType: 'oauth',
        codingPlanEnabled: false,
        supportsImage: true,
        modelName: 'GPT-5.4',
      },
    };
    mockRuntimeState.enabledProviders = [
      {
        providerName: ProviderName.OpenAI,
        baseURL: 'https://api.openai.com/v1',
        apiKey: '',
        apiType: 'openai',
        authType: 'oauth',
        codingPlanEnabled: false,
        models: [{ id: 'gpt-5.4', name: 'GPT-5.4', supportsImage: true }],
      },
      {
        providerName: ProviderName.DeepSeek,
        baseURL: 'https://api.deepseek.com',
        apiKey: 'sk-deepseek',
        apiType: 'openai',
        codingPlanEnabled: false,
        models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', supportsImage: false }],
      },
    ];

    try {
      const sync = await createSync();
      const result = sync.sync('openai-oauth-system-proxy');
      expect(result.ok).toBe(true);

      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      expect(config.models.providers['openai-codex']).toMatchObject({
        baseUrl: 'https://chatgpt.com/backend-api/codex',
        api: 'openai-codex-responses',
        auth: 'oauth',
        headers: {
          'chatgpt-account-id': 'acct-runtime-test',
          originator: 'pi',
          'OpenAI-Beta': 'responses=experimental',
        },
      });
      expect(config.models.providers['openai-codex']).not.toHaveProperty('apiKey');
      expect(config.models.providers.deepseek).toBeDefined();
      expect(config.agents.defaults.models).toBeUndefined();
    } finally {
      setSystemProxyEnabled(false);
    }
  });

  test('writes model custom params as OpenClaw extra_body defaults', async () => {
    const { ProviderName } = await import('../../shared/providers');
    mockRuntimeState.enabledProviders = [
      {
        providerName: ProviderName.DeepSeek,
        baseURL: 'https://api.deepseek.com',
        apiKey: 'sk-deepseek',
        apiType: 'openai',
        codingPlanEnabled: false,
        models: [{
          id: 'deepseek-v4-flash',
          name: 'DeepSeek V4 Flash',
          supportsImage: false,
          customParams: {
            thinking: { type: 'enabled', budget_tokens: 1024 },
          },
        }],
      },
    ];

    const sync = await createSync();
    const result = sync.sync('model-custom-params');
    expect(result.ok).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.agents.defaults.models).toMatchObject({
      'deepseek/deepseek-v4-flash': {
        params: {
          extra_body: {
            thinking: { type: 'enabled', budget_tokens: 1024 },
          },
        },
      },
    });
  });

  test('writes MiniMax OAuth providers with oauth auth metadata', async () => {
    const { ProviderName } = await import('../../shared/providers');
    mockRuntimeState.rawApiConfig = {
      config: {
        baseURL: 'https://api.minimaxi.com/anthropic',
        apiKey: 'oauth-access-token',
        model: 'MiniMax-M2.7',
        apiType: 'anthropic',
      },
      providerMetadata: {
        providerName: ProviderName.Minimax,
        authType: 'oauth',
        codingPlanEnabled: false,
        supportsImage: false,
        modelName: 'MiniMax M2.7',
      },
    };
    mockRuntimeState.enabledProviders = [
      {
        providerName: ProviderName.Minimax,
        baseURL: 'https://api.minimaxi.com/anthropic',
        apiKey: 'oauth-access-token',
        apiType: 'anthropic',
        authType: 'oauth',
        codingPlanEnabled: false,
        models: [{ id: 'MiniMax-M2.7', name: 'MiniMax M2.7', supportsImage: false }],
      },
    ];

    const sync = await createSync();
    const result = sync.sync('minimax-oauth-provider');
    expect(result.ok).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.models.providers.minimax.auth).toBe('oauth');
    expect(config.models.providers.minimax.baseUrl).toBe('https://api.minimaxi.com/anthropic');
    expect(config.models.providers.minimax.apiKey).toBe('${LOBSTER_APIKEY_MINIMAX}');
  });

  test('updates managed session model refs when agent ids contain colons', async () => {
    const agentId = 'qingshu-managed:qingshu-presales-analysis';
    const sessionKey = `agent:${agentId}:lobsterai:session-1`;
    const sessionsDir = path.join(stateDir, 'agents', agentId, 'sessions');
    const sessionsPath = path.join(sessionsDir, 'sessions.json');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(sessionsPath, JSON.stringify({
      [sessionKey]: {
        modelProvider: 'lobster',
        model: 'gpt-test',
        systemPromptReport: {
          provider: 'lobster',
          model: 'gpt-test',
        },
      },
    }, null, 2));

    const sync = await createSync({
      getAgents: () => [{
        id: agentId,
        name: 'Presales',
        description: '',
        systemPrompt: '',
        identity: '',
        model: '',
        icon: '',
        skillIds: [],
        toolBundleIds: [],
        enabled: true,
        isDefault: false,
        source: 'custom',
        presetId: '',
        createdAt: 0,
        updatedAt: 0,
      }],
    });

    const result = sync.sync('managed-session-colon-agent-id');
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);

    const sessionStore = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
    expect(sessionStore[sessionKey]).toMatchObject({
      modelProvider: 'openai',
      model: 'gpt-test',
      systemPromptReport: {
        provider: 'openai',
        model: 'gpt-test',
      },
    });
  });

  test('writes QingShu managed agents into OpenClaw agent list and workspaces', async () => {
    const agentId = 'qingshu-managed:qingshu-presales-analysis';
    const sync = await createSync({
      getAgents: () => [{
        id: agentId,
        name: '售前分析',
        description: '售前供需分析',
        systemPrompt: 'managed prompt',
        identity: 'managed identity',
        model: '',
        workingDirectory: '',
        icon: '',
        skillIds: ['qingshu-presales-analysis'],
        toolBundleIds: [],
        enabled: true,
        isDefault: false,
        source: 'managed',
        sourceType: 'qingshu-managed',
        readOnly: true,
        allowed: true,
        backendAgentId: 'qingshu-presales-analysis',
        managedToolNames: [
          'claw.dictionary.search',
          'lbs.presales.store.supply-demand-balance',
        ],
        managedBaseSkillIds: ['qingshu-presales-analysis'],
        managedExtraSkillIds: [],
        presetId: '',
        createdAt: 0,
        updatedAt: 0,
      }],
    });

    const result = sync.sync('qingshu-managed-agent-workspace');
    expect(result.ok).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.agents.list).toContainEqual(expect.objectContaining({
      id: agentId,
      identity: { name: '售前分析' },
      skills: ['qingshu-presales-analysis'],
      workspace: path.join(stateDir, `workspace-${agentId}`),
      model: { primary: 'openai/gpt-test' },
    }));

    const workspaceDir = path.join(stateDir, `workspace-${agentId}`);
    expect(fs.readFileSync(path.join(workspaceDir, 'SOUL.md'), 'utf8')).toBe('managed prompt\n');
    expect(fs.readFileSync(path.join(workspaceDir, 'IDENTITY.md'), 'utf8')).toBe('managed identity\n');
    expect(fs.readFileSync(path.join(workspaceDir, 'AGENTS.md'), 'utf8')).toContain('managed prompt');
    expect(fs.existsSync(path.join(workspaceDir, 'memory'))).toBe(true);
    expect(fs.existsSync(path.join(workspaceDir, 'MEMORY.md'))).toBe(true);
  });
});
