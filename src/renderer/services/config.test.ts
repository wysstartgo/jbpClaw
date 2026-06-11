import { afterEach, expect, test, vi } from 'vitest';

import { OpenClawProviderId, ProviderName } from '../../shared/providers';
import { type AppConfig, CONFIG_KEYS, defaultConfig } from '../config';

const mockStoredConfig = vi.hoisted(() => ({
  value: null as unknown,
  saved: null as unknown,
}));

vi.mock('./store', () => ({
  localStore: {
    getItem: vi.fn(async (key: string) => (
      key === CONFIG_KEYS.APP_CONFIG ? mockStoredConfig.value : null
    )),
    setItem: vi.fn(async (_key: string, value: unknown) => {
      mockStoredConfig.saved = value;
    }),
    removeItem: vi.fn(),
  },
}));

afterEach(() => {
  mockStoredConfig.value = null;
  mockStoredConfig.saved = null;
  vi.resetModules();
});

const makeLegacyConfigWithoutMiniMaxAddedModels = (): AppConfig => ({
  ...defaultConfig,
  providers: {
    ...defaultConfig.providers,
    [ProviderName.Minimax]: {
      ...defaultConfig.providers![ProviderName.Minimax],
      enabled: true,
      apiKey: 'sk-minimax',
      models: defaultConfig.providers![ProviderName.Minimax].models?.filter(
        model => model.id !== 'MiniMax-M3' && model.id !== 'MiniMax-M2.7'
      ),
    },
  },
});

const makeLegacyConfigWithDeepSeekV4WithoutContextWindow = (): AppConfig => ({
  ...defaultConfig,
  providers: {
    ...defaultConfig.providers,
    [ProviderName.DeepSeek]: {
      ...defaultConfig.providers![ProviderName.DeepSeek],
      enabled: true,
      apiKey: 'sk-deepseek',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', supportsImage: false },
        { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', supportsImage: false },
      ],
    },
  },
});

const makeLegacyConfigWithOldMimoModels = (): AppConfig => ({
  ...defaultConfig,
  providers: {
    ...defaultConfig.providers,
    [ProviderName.Xiaomi]: {
      ...defaultConfig.providers![ProviderName.Xiaomi],
      enabled: true,
      apiKey: 'sk-xiaomi',
      models: [
        { id: 'mimo-v2-pro', name: 'MiMo V2 Pro', supportsImage: false, contextWindow: 128_000 },
        { id: 'mimo-v2-flash', name: 'MiMo V2 Flash', supportsImage: false, contextWindow: 64_000 },
      ],
    },
  },
});

const makeConfigWithCustomContextWindows = (): AppConfig => ({
  ...defaultConfig,
  providers: {
    ...defaultConfig.providers,
    [ProviderName.Minimax]: {
      ...defaultConfig.providers![ProviderName.Minimax],
      enabled: true,
      apiKey: 'sk-minimax',
      models: [
        { id: 'MiniMax-M3', name: 'MiniMax M3', supportsImage: false, contextWindow: 512_000 },
      ],
    },
    [ProviderName.DeepSeek]: {
      ...defaultConfig.providers![ProviderName.DeepSeek],
      enabled: true,
      apiKey: 'sk-deepseek',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', supportsImage: false, contextWindow: 256_000 },
        { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', supportsImage: false, contextWindow: 384_000 },
      ],
    },
    [ProviderName.Xiaomi]: {
      ...defaultConfig.providers![ProviderName.Xiaomi],
      enabled: true,
      apiKey: 'sk-xiaomi',
      models: [
        { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro', supportsImage: false, contextWindow: 640_000 },
        { id: 'mimo-v2.5', name: 'MiMo V2.5', supportsImage: true, contextWindow: 768_000 },
      ],
    },
  },
});

const makeConfigWithDeletedProviderModel = (
  providerName: ProviderName,
  deletedModelId: string,
): AppConfig => ({
  ...defaultConfig,
  providerModelMigrationVersions: {
    [providerName]: 1,
  },
  providers: {
    ...defaultConfig.providers,
    [providerName]: {
      ...defaultConfig.providers![providerName],
      enabled: true,
      apiKey: `sk-${providerName}`,
      models: defaultConfig.providers![providerName].models?.filter(
        model => model.id !== deletedModelId
      ),
    },
  },
});

const addedProviderMigrationCases: Array<{ providerName: ProviderName; deletedModelId: string }> = [
  { providerName: ProviderName.DeepSeek, deletedModelId: 'deepseek-v4-flash' },
  { providerName: ProviderName.Moonshot, deletedModelId: 'kimi-k2.6' },
  { providerName: ProviderName.Qwen, deletedModelId: 'qwen3.6-plus' },
  { providerName: ProviderName.Volcengine, deletedModelId: 'doubao-seed-2-0-pro-260215' },
  { providerName: ProviderName.Minimax, deletedModelId: 'MiniMax-M3' },
  { providerName: ProviderName.Xiaomi, deletedModelId: 'mimo-v2.5-pro' },
  { providerName: ProviderName.OpenAI, deletedModelId: 'gpt-5.4' },
];

test('configService fills missing provider model names from model ids', async () => {
  const defaultProviders = defaultConfig.providers!;
  mockStoredConfig.value = {
    ...defaultConfig,
    providers: {
      ...defaultProviders,
      openai: {
        ...defaultProviders.openai,
        models: [
          { id: 'custom-openai-model' },
        ],
      },
    },
  };

  const { configService } = await import('./config');
  await configService.init();

  expect(configService.getConfig().providers!.openai.models?.find(
    (model) => model.id === 'custom-openai-model',
  )?.name).toBe('custom-openai-model');
});

test('configService preserves model-level OpenClaw provider ids', async () => {
  const defaultProviders = defaultConfig.providers!;
  mockStoredConfig.value = {
    ...defaultConfig,
    providers: {
      ...defaultProviders,
      openai: {
        ...defaultProviders.openai,
        models: [
          {
            id: 'gpt-5.3-codex',
            name: 'GPT-5.3 Codex',
            supportsImage: true,
            openClawProviderId: OpenClawProviderId.OpenAICodex,
          },
        ],
      },
    },
  };

  const { configService } = await import('./config');
  await configService.init();

  expect(configService.getConfig().providers!.openai.models?.find(
    (model) => model.id === 'gpt-5.3-codex',
  )?.openClawProviderId).toBe(OpenClawProviderId.OpenAICodex);
});

test('configService updateConfig preserves stored providers when applying partial updates', async () => {
  const defaultProviders = defaultConfig.providers!;
  mockStoredConfig.value = {
    ...defaultConfig,
    providers: {
      ...defaultProviders,
      openai: {
        ...defaultProviders.openai,
        apiKey: 'stored-openai-key',
        models: [
          { id: 'stored-only-model', name: 'Stored Only Model', supportsImage: false },
        ],
      },
    },
  };

  const { configService } = await import('./config');
  await configService.updateConfig({
    model: {
      ...defaultConfig.model,
      defaultModel: 'stored-only-model',
    },
  });

  const savedConfig = mockStoredConfig.saved as typeof defaultConfig;
  expect(savedConfig.providers!.openai.apiKey).toBe('stored-openai-key');
  expect(savedConfig.providers!.openai.models?.map((model) => model.id)).toContain('stored-only-model');
});

test('configService preserves MiniMax OAuth runtime fields', async () => {
  const defaultProviders = defaultConfig.providers!;
  mockStoredConfig.value = {
    ...defaultConfig,
    providers: {
      ...defaultProviders,
      minimax: {
        ...defaultProviders.minimax,
        authType: 'oauth',
        oauthAccessToken: 'oauth-access-token',
        oauthBaseUrl: 'https://api.minimaxi.com/anthropic',
        oauthRefreshToken: 'oauth-refresh-token',
        oauthTokenExpiresAt: 1234567890,
      },
    },
  };

  const { configService } = await import('./config');
  await configService.init();

  expect(configService.getConfig().providers!.minimax.oauthAccessToken).toBe('oauth-access-token');
  expect(configService.getConfig().providers!.minimax.oauthBaseUrl).toBe('https://api.minimaxi.com/anthropic');
  expect(configService.getConfig().providers!.minimax.oauthRefreshToken).toBe('oauth-refresh-token');
});

test('configService normalizes fixed provider api formats from provider registry', async () => {
  const defaultProviders = defaultConfig.providers!;
  mockStoredConfig.value = {
    ...defaultConfig,
    providers: {
      ...defaultProviders,
      [ProviderName.Qianfan]: {
        ...defaultProviders[ProviderName.Qianfan],
        apiFormat: 'anthropic',
      },
      [ProviderName.Copilot]: {
        ...defaultProviders[ProviderName.Copilot],
        apiFormat: 'anthropic',
      },
      [ProviderName.Moonshot]: {
        ...defaultProviders[ProviderName.Moonshot],
        apiFormat: 'anthropic',
      },
    },
  };

  const { configService } = await import('./config');
  await configService.init();

  expect(configService.getConfig().providers![ProviderName.Qianfan].apiFormat).toBe('openai');
  expect(configService.getConfig().providers![ProviderName.Copilot].apiFormat).toBe('openai');
  expect(configService.getConfig().providers![ProviderName.Moonshot].apiFormat).toBe('openai');
});

test('configService persists injected provider models during init', async () => {
  mockStoredConfig.value = makeLegacyConfigWithoutMiniMaxAddedModels();

  const { configService } = await import('./config');
  await configService.init();

  const savedConfig = mockStoredConfig.saved as AppConfig;
  expect(savedConfig.providers?.[ProviderName.Minimax].models?.[0]).toMatchObject({
    id: 'MiniMax-M3',
    contextWindow: 1_000_000,
  });
});

test('configService preserves injected provider models when saving partial config updates', async () => {
  const legacyConfig = makeLegacyConfigWithoutMiniMaxAddedModels();
  mockStoredConfig.value = legacyConfig;

  const { configService } = await import('./config');
  await configService.updateConfig({
    model: {
      ...legacyConfig.model,
      defaultModel: 'MiniMax-M3',
      defaultModelProvider: ProviderName.Minimax,
    },
  });

  const savedConfig = mockStoredConfig.saved as AppConfig;
  expect(savedConfig.providers?.[ProviderName.Minimax].models?.map(model => model.id)).toContain('MiniMax-M3');
  expect(savedConfig.model.defaultModel).toBe('MiniMax-M3');
  expect(savedConfig.model.defaultModelProvider).toBe(ProviderName.Minimax);
});

test('configService fills DeepSeek V4 context windows when saving partial config updates', async () => {
  const legacyConfig = makeLegacyConfigWithDeepSeekV4WithoutContextWindow();
  mockStoredConfig.value = legacyConfig;

  const { configService } = await import('./config');
  await configService.updateConfig({
    model: {
      ...legacyConfig.model,
      defaultModel: 'deepseek-v4-flash',
      defaultModelProvider: ProviderName.DeepSeek,
    },
  });

  const savedConfig = mockStoredConfig.saved as AppConfig;
  expect(savedConfig.providers?.[ProviderName.DeepSeek].models).toEqual([
    { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', supportsImage: false, contextWindow: 1_000_000 },
    { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', supportsImage: false, contextWindow: 1_000_000 },
  ]);
});

test('configService preserves old MiMo models while injecting V2.5 models and 1M contexts', async () => {
  mockStoredConfig.value = {
    ...makeLegacyConfigWithOldMimoModels(),
    model: {
      ...defaultConfig.model,
      defaultModel: 'mimo-v2-pro',
      defaultModelProvider: ProviderName.Xiaomi,
    },
  };

  const { configService } = await import('./config');
  await configService.init();

  const savedConfig = mockStoredConfig.saved as AppConfig;
  expect(savedConfig.providers?.[ProviderName.Xiaomi].models).toEqual([
    { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro', supportsImage: false, contextWindow: 1_000_000 },
    { id: 'mimo-v2.5', name: 'MiMo V2.5', supportsImage: true, contextWindow: 1_000_000 },
    { id: 'mimo-v2-pro', name: 'MiMo V2 Pro', supportsImage: false, contextWindow: 128_000 },
    { id: 'mimo-v2-flash', name: 'MiMo V2 Flash', supportsImage: false, contextWindow: 64_000 },
  ]);
  expect(savedConfig.model.defaultModel).toBe('mimo-v2-pro');
  expect(savedConfig.model.defaultModelProvider).toBe(ProviderName.Xiaomi);
});

test('configService preserves user-configured context windows for known models', async () => {
  mockStoredConfig.value = makeConfigWithCustomContextWindows();

  const { configService } = await import('./config');
  await configService.init();

  const savedConfig = mockStoredConfig.saved as AppConfig;
  expect(savedConfig.providers?.[ProviderName.Minimax].models?.find(model => model.id === 'MiniMax-M3')?.contextWindow).toBe(512_000);
  expect(savedConfig.providers?.[ProviderName.DeepSeek].models?.find(model => model.id === 'deepseek-v4-flash')?.contextWindow).toBe(256_000);
  expect(savedConfig.providers?.[ProviderName.DeepSeek].models?.find(model => model.id === 'deepseek-v4-pro')?.contextWindow).toBe(384_000);
  expect(savedConfig.providers?.[ProviderName.Xiaomi].models?.find(model => model.id === 'mimo-v2.5-pro')?.contextWindow).toBe(640_000);
  expect(savedConfig.providers?.[ProviderName.Xiaomi].models?.find(model => model.id === 'mimo-v2.5')?.contextWindow).toBe(768_000);
});

test.each(addedProviderMigrationCases)(
  'configService does not re-inject a deleted $providerName model after migration is applied',
  async ({ providerName, deletedModelId }) => {
    mockStoredConfig.value = makeConfigWithDeletedProviderModel(providerName, deletedModelId);

    const { configService } = await import('./config');
    await configService.init();

    expect(configService.getConfig().providers?.[providerName].models?.map(model => model.id)).not.toContain(deletedModelId);
  }
);

test('configService treats a provider with any migrated model as already migrated', async () => {
  const deletedModelId = 'mimo-v2.5-pro';
  mockStoredConfig.value = {
    ...defaultConfig,
    providerModelMigrationVersions: undefined,
    providers: {
      ...defaultConfig.providers,
      [ProviderName.Xiaomi]: {
        ...defaultConfig.providers![ProviderName.Xiaomi],
        enabled: true,
        apiKey: 'sk-xiaomi',
        models: defaultConfig.providers![ProviderName.Xiaomi].models?.filter(
          model => model.id !== deletedModelId
        ),
      },
    },
  };

  const { configService } = await import('./config');
  await configService.init();

  const savedConfig = mockStoredConfig.saved as AppConfig;
  expect(savedConfig.providerModelMigrationVersions?.[ProviderName.Xiaomi]).toBe(1);
  expect(savedConfig.providers?.[ProviderName.Xiaomi].models?.map(model => model.id)).not.toContain(deletedModelId);
});

test('configService does not re-inject a deleted model after migration is applied', async () => {
  const deletedModelId = 'mimo-v2.5-pro';
  const legacyConfig = makeConfigWithDeletedProviderModel(ProviderName.Xiaomi, deletedModelId);
  mockStoredConfig.value = legacyConfig;

  const { configService } = await import('./config');
  await configService.updateConfig({
    model: {
      ...legacyConfig.model,
      defaultModel: 'mimo-v2.5',
      defaultModelProvider: ProviderName.Xiaomi,
    },
  });

  const savedConfig = mockStoredConfig.saved as AppConfig;
  expect(savedConfig.providers?.[ProviderName.Xiaomi].models?.map(model => model.id)).not.toContain(deletedModelId);
  expect(savedConfig.model.defaultModel).toBe('mimo-v2.5');
  expect(savedConfig.model.defaultModelProvider).toBe(ProviderName.Xiaomi);
});

test('configService marks provider model migrations when saving provider edits from default config', async () => {
  const deletedModelId = 'MiniMax-M3';

  const { configService } = await import('./config');
  await configService.updateConfig({
    providers: {
      ...defaultConfig.providers,
      [ProviderName.Minimax]: {
        ...defaultConfig.providers![ProviderName.Minimax],
        models: defaultConfig.providers![ProviderName.Minimax].models?.filter(
          model => model.id !== deletedModelId
        ),
      },
    },
  });

  const savedConfig = mockStoredConfig.saved as AppConfig;
  expect(savedConfig.providerModelMigrationVersions?.[ProviderName.Minimax]).toBe(1);
  expect(savedConfig.providers?.[ProviderName.Minimax].models?.map(model => model.id)).not.toContain(deletedModelId);
});
