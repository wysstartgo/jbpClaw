import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
  },
}));

vi.mock('./coworkOpenAICompatProxy', () => ({
  configureCoworkOpenAICompatProxy: vi.fn(),
  getCoworkOpenAICompatProxyBaseURL: () => 'http://127.0.0.1:12345/v1',
  getCoworkOpenAICompatProxyStatus: () => ({ running: true }),
}));

const openAICodexAuthState = vi.hoisted(() => ({
  tokens: null as null | {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  },
}));

vi.mock('./openaiCodexAuth', () => ({
  readOpenAICodexAuthFile: () => openAICodexAuthState.tokens,
}));

import {
  clearServerModelMetadata,
  getAllServerModelMetadata,
  resolveAllEnabledProviderConfigs,
  resolveAllProviderApiKeys,
  resolveRawApiConfig,
  setStoreGetter,
  updateServerModelMetadata,
} from './claudeSettings';

const createStore = (appConfig: unknown) => ({
  get: (key: string) => (key === 'app_config' ? appConfig : undefined),
});

describe('claudeSettings MiniMax OAuth credentials', () => {
  beforeEach(() => {
    setStoreGetter(() => null);
    openAICodexAuthState.tokens = null;
  });

  test('rejects MiniMax OAuth when login has not completed', () => {
    setStoreGetter(() => createStore({
      model: {
        defaultModel: 'MiniMax-M2.7',
        defaultModelProvider: 'minimax',
      },
      providers: {
        minimax: {
          enabled: true,
          apiKey: 'legacy-api-key',
          baseUrl: 'https://api.minimaxi.com/v1',
          apiFormat: 'anthropic',
          authType: 'oauth',
          models: [{ id: 'MiniMax-M2.7', name: 'MiniMax M2.7' }],
        },
      },
    }) as never);

    const raw = resolveRawApiConfig();
    const envKeys = resolveAllProviderApiKeys();
    const providerConfigs = resolveAllEnabledProviderConfigs();

    expect(raw.config).toBeNull();
    expect(raw.error).toBe('MiniMax OAuth mode selected but login not completed.');
    expect(envKeys).not.toHaveProperty('MINIMAX');
    expect(providerConfigs).toHaveLength(0);
  });

  test('uses MiniMax OAuth access token when login has completed', () => {
    setStoreGetter(() => createStore({
      model: {
        defaultModel: 'MiniMax-M2.7',
        defaultModelProvider: 'minimax',
      },
      providers: {
        minimax: {
          enabled: true,
          apiKey: 'legacy-api-key',
          baseUrl: 'https://api.minimaxi.com/v1',
          apiFormat: 'openai',
          authType: 'oauth',
          oauthAccessToken: 'oauth-access-token',
          oauthBaseUrl: 'https://api.minimaxi.com/anthropic',
          models: [{ id: 'MiniMax-M2.7', name: 'MiniMax M2.7' }],
        },
      },
    }) as never);

    const raw = resolveRawApiConfig();
    const envKeys = resolveAllProviderApiKeys();
    const providerConfigs = resolveAllEnabledProviderConfigs();

    expect(raw.config).toMatchObject({
      apiKey: 'oauth-access-token',
      baseURL: 'https://api.minimaxi.com/anthropic',
      apiType: 'anthropic',
    });
    expect(envKeys.MINIMAX).toBe('oauth-access-token');
    expect(providerConfigs[0]).toMatchObject({
      providerName: 'minimax',
      apiKey: 'oauth-access-token',
      baseURL: 'https://api.minimaxi.com/anthropic',
      apiType: 'anthropic',
    });
  });
});

describe('claudeSettings OpenAI Codex OAuth credentials', () => {
  beforeEach(() => {
    setStoreGetter(() => null);
    openAICodexAuthState.tokens = null;
  });

  test('rejects OpenAI Codex OAuth when login has not completed', () => {
    setStoreGetter(() => createStore({
      model: {
        defaultModel: 'gpt-5.3-codex',
        defaultModelProvider: 'openai',
      },
      providers: {
        openai: {
          enabled: true,
          apiKey: '',
          baseUrl: 'https://api.openai.com/v1',
          apiFormat: 'openai',
          authType: 'oauth',
          models: [{ id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex' }],
        },
      },
    }) as never);

    const raw = resolveRawApiConfig();
    const envKeys = resolveAllProviderApiKeys();
    const providerConfigs = resolveAllEnabledProviderConfigs();

    expect(raw.config).toBeNull();
    expect(raw.error).toBe('OpenAI Codex OAuth mode selected but login not completed.');
    expect(envKeys).not.toHaveProperty('OPENAI');
    expect(providerConfigs).toHaveLength(0);
  });

  test('uses OpenAI Codex OAuth marker after login without exporting token env', () => {
    openAICodexAuthState.tokens = {
      accessToken: 'codex-access-token',
      refreshToken: 'codex-refresh-token',
      expiresAt: 1893456000000,
    };
    setStoreGetter(() => createStore({
      model: {
        defaultModel: 'gpt-5.3-codex',
        defaultModelProvider: 'openai',
      },
      providers: {
        openai: {
          enabled: true,
          apiKey: '',
          baseUrl: 'https://api.openai.com/v1',
          apiFormat: 'openai',
          authType: 'oauth',
          models: [{ id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex' }],
        },
      },
    }) as never);

    const raw = resolveRawApiConfig();
    const envKeys = resolveAllProviderApiKeys();
    const providerConfigs = resolveAllEnabledProviderConfigs();

    expect(raw.config).toMatchObject({
      apiKey: 'codex-oauth',
      baseURL: 'https://api.openai.com/v1',
      apiType: 'openai',
    });
    expect(raw.providerMetadata?.authType).toBe('oauth');
    expect(envKeys).not.toHaveProperty('OPENAI');
    expect(providerConfigs).toHaveLength(0);
  });
});

describe('claudeSettings provider model metadata', () => {
  beforeEach(() => {
    setStoreGetter(() => null);
    openAICodexAuthState.tokens = null;
    clearServerModelMetadata();
  });

  test('fills missing model display names from model ids', () => {
    setStoreGetter(() => createStore({
      model: {
        defaultModel: 'custom-model',
        defaultModelProvider: 'custom_0',
      },
      providers: {
        custom_0: {
          enabled: true,
          apiKey: 'custom-api-key',
          baseUrl: 'https://example.com/v1',
          apiFormat: 'openai',
          models: [{ id: 'custom-model' }],
        },
      },
    }) as never);

    const raw = resolveRawApiConfig();
    const providerConfigs = resolveAllEnabledProviderConfigs();

    expect(raw.providerMetadata?.modelName).toBe('custom-model');
    expect(providerConfigs[0]?.models[0]).toMatchObject({
      id: 'custom-model',
      name: 'custom-model',
    });
  });

  test('does not report server model metadata changes when only order changes', () => {
    expect(updateServerModelMetadata([
      { modelId: 'qwen3.6-plus', supportsImage: true, contextWindow: 256000 },
      { modelId: 'deepseek-v3.2', supportsImage: false },
    ])).toBe(true);

    expect(updateServerModelMetadata([
      { modelId: 'deepseek-v3.2', supportsImage: false },
      { modelId: 'qwen3.6-plus', supportsImage: true, contextWindow: 256000 },
    ])).toBe(false);

    expect(getAllServerModelMetadata()).toEqual(expect.arrayContaining([
      { modelId: 'qwen3.6-plus', supportsImage: true, contextWindow: 256000 },
      { modelId: 'deepseek-v3.2', supportsImage: false },
    ]));
  });

  test('reports server model metadata changes when image capability changes', () => {
    updateServerModelMetadata([
      { modelId: 'qwen3.6-plus', supportsImage: false },
    ]);

    expect(updateServerModelMetadata([
      { modelId: 'qwen3.6-plus', supportsImage: true },
    ])).toBe(true);
  });
});
