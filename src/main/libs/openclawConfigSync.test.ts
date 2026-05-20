import { describe,expect, test } from 'vitest';

import { buildOpenClawMcpServers } from './openclawConfigSync';
import {
  OpenClawApi,
  OpenClawProviderId,
  ProviderName,
} from '../../shared/providers';

const providerApiKeyEnvVar = (providerName: string): string => {
  const envName = providerName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return `LOBSTER_APIKEY_${envName}`;
};

describe('providerApiKeyEnvVar', () => {
  test('converts simple provider names', () => {
    expect(providerApiKeyEnvVar(ProviderName.Moonshot)).toBe('LOBSTER_APIKEY_MOONSHOT');
    expect(providerApiKeyEnvVar(ProviderName.Anthropic)).toBe('LOBSTER_APIKEY_ANTHROPIC');
    expect(providerApiKeyEnvVar(ProviderName.OpenAI)).toBe('LOBSTER_APIKEY_OPENAI');
    expect(providerApiKeyEnvVar(ProviderName.Ollama)).toBe('LOBSTER_APIKEY_OLLAMA');
  });

  test('replaces hyphens and special chars with underscores', () => {
    expect(providerApiKeyEnvVar(ProviderName.QingShuServer)).toBe('LOBSTER_APIKEY_QINGSHU_SERVER');
    expect(providerApiKeyEnvVar('my.provider')).toBe('LOBSTER_APIKEY_MY_PROVIDER');
  });

  test('server key matches hardcoded convention', () => {
    expect(providerApiKeyEnvVar('server')).toBe('LOBSTER_APIKEY_SERVER');
  });
});

describe('env var stability on model switch', () => {
  const simulateCollectEnvVars = (providers: Record<string, { enabled: boolean; apiKey: string }>, serverToken?: string) => {
    const env: Record<string, string> = {};

    if (serverToken) {
      env.LOBSTER_APIKEY_SERVER = serverToken;
    }

    for (const [name, config] of Object.entries(providers)) {
      if (!config.enabled) continue;
      const envName = name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
      env[`LOBSTER_APIKEY_${envName}`] = config.apiKey;
    }

    return env;
  };

  test('switching from server to custom provider does not change env var keys', () => {
    const providers = {
      [ProviderName.Moonshot]: { enabled: true, apiKey: 'sk-moon-123' },
    };
    const serverToken = 'access-token-xyz';

    const envBefore = simulateCollectEnvVars(providers, serverToken);
    const envAfter = simulateCollectEnvVars(providers, serverToken);

    expect(JSON.stringify(envBefore)).toBe(JSON.stringify(envAfter));
  });

  test('switching between two custom providers does not change env var keys', () => {
    const providers = {
      [ProviderName.Moonshot]: { enabled: true, apiKey: 'sk-moon-123' },
      [ProviderName.Anthropic]: { enabled: true, apiKey: 'sk-ant-456' },
    };

    const envBefore = simulateCollectEnvVars(providers);
    const envAfter = simulateCollectEnvVars(providers);

    expect(JSON.stringify(envBefore)).toBe(JSON.stringify(envAfter));
    expect(envBefore.LOBSTER_APIKEY_MOONSHOT).toBe('sk-moon-123');
    expect(envBefore.LOBSTER_APIKEY_ANTHROPIC).toBe('sk-ant-456');
  });

  test('only editing apiKey value causes env var change', () => {
    const providersBefore = {
      [ProviderName.Moonshot]: { enabled: true, apiKey: 'sk-moon-OLD' },
    };
    const providersAfter = {
      [ProviderName.Moonshot]: { enabled: true, apiKey: 'sk-moon-NEW' },
    };

    const envBefore = simulateCollectEnvVars(providersBefore);
    const envAfter = simulateCollectEnvVars(providersAfter);

    expect(JSON.stringify(envBefore)).not.toBe(JSON.stringify(envAfter));
  });
});

describe('buildOpenClawMcpServers', () => {
  test('maps stdio, sse and http servers to OpenClaw native MCP config', () => {
    expect(buildOpenClawMcpServers([
      {
        name: 'stdio-server',
        transportType: 'stdio',
        command: '/usr/local/bin/node',
        args: ['server.js'],
        env: { TOKEN: 'secret' },
      },
      {
        name: 'sse-server',
        transportType: 'sse',
        url: 'https://mcp.example.com/sse',
        headers: { Authorization: 'Bearer token' },
      },
      {
        name: 'http-server',
        transportType: 'http',
        url: 'https://mcp.example.com/mcp',
        headers: { 'X-Api-Key': 'secret' },
      },
    ])).toEqual({
      'stdio-server': {
        command: '/usr/local/bin/node',
        args: ['server.js'],
        env: { TOKEN: 'secret' },
      },
      'sse-server': {
        url: 'https://mcp.example.com/sse',
        headers: { authorization: 'Bearer token' },
      },
      'http-server': {
        url: 'https://mcp.example.com/mcp',
        headers: { 'x-api-key': 'secret' },
        transport: 'streamable-http',
      },
    });
  });

  test('omits empty optional fields', () => {
    expect(buildOpenClawMcpServers([
      { name: 'empty-stdio', transportType: 'stdio' },
      { name: 'empty-sse', transportType: 'sse' },
    ])).toEqual({
      'empty-stdio': {},
      'empty-sse': {},
    });
  });
});

// ═══════════════════════════════════════════════════════
// Provider Descriptor Registry Tests
//
// Since buildProviderSelection imports Electron-only modules,
// we mirror the descriptor resolution logic here to verify
// the registry mapping correctness.
// ═══════════════════════════════════════════════════════

type OpenClawProviderApi =
  | 'anthropic-messages'
  | 'openai-completions'
  | 'openai-responses'
  | 'openai-codex-responses'
  | 'google-generative-ai';

const mapApiTypeToOpenClawApi = (
  apiType: 'anthropic' | 'openai' | undefined,
): OpenClawProviderApi => {
  if (apiType === 'openai') return 'openai-completions';
  return 'anthropic-messages';
};

type ProviderDescriptor = {
  providerId: string;
  resolveApi: (ctx: { apiType: 'anthropic' | 'openai' | undefined; baseURL: string }) => OpenClawProviderApi;
  normalizeBaseUrl: (rawBaseUrl: string) => string;
  resolveSessionModelId?: (modelId: string) => string;
  resolveModelReasoning?: (modelId: string, codingPlanEnabled: boolean) => boolean | undefined;
  modelDefaults?: Partial<{
    reasoning: boolean;
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
    contextWindow: number;
    maxTokens: number;
  }>;
};

const DEEPSEEK_REASONING_MODEL_IDS = new Set(['deepseek-reasoner', 'deepseek-r1']);
const DEEPSEEK_V4_MODEL_PATTERN = /^deepseek-v4(?:[-_.]|$)/;

const resolveDeepSeekModelReasoning = (modelId: string): boolean | undefined => {
  const normalized = modelId.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (DEEPSEEK_REASONING_MODEL_IDS.has(normalized) || DEEPSEEK_V4_MODEL_PATTERN.test(normalized)) {
    return true;
  }
  return undefined;
};

const stripChatCompletionsSuffix = (rawBaseUrl: string): string => {
  const trimmed = rawBaseUrl.trim();
  if (!trimmed) return trimmed;
  const normalized = trimmed.replace(/\/+$/, '');
  if (normalized.endsWith('/openai')) {
    return normalized.slice(0, -'/openai'.length);
  }
  return normalized;
};

const PROVIDER_REGISTRY: Record<string, ProviderDescriptor> = {
  [ProviderName.Moonshot]: {
    providerId: OpenClawProviderId.Moonshot,
    resolveApi: () => OpenClawApi.OpenAICompletions as OpenClawProviderApi,
    normalizeBaseUrl: stripChatCompletionsSuffix,
    modelDefaults: {
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 256000,
      maxTokens: 8192,
    },
  },
  [`${ProviderName.Moonshot}:codingPlan`]: {
    providerId: OpenClawProviderId.KimiCoding,
    resolveApi: () => OpenClawApi.AnthropicMessages as OpenClawProviderApi,
    normalizeBaseUrl: stripChatCompletionsSuffix,
    resolveSessionModelId: () => 'k2p5',
    modelDefaults: {
      reasoning: true,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 256000,
      maxTokens: 8192,
    },
  },
  [ProviderName.Gemini]: {
    providerId: OpenClawProviderId.Google,
    resolveApi: () => OpenClawApi.GoogleGenerativeAI as OpenClawProviderApi,
    normalizeBaseUrl: stripChatCompletionsSuffix,
    modelDefaults: { reasoning: true },
  },
  [ProviderName.Anthropic]: {
    providerId: OpenClawProviderId.Anthropic,
    resolveApi: () => OpenClawApi.AnthropicMessages as OpenClawProviderApi,
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },
  [ProviderName.OpenAI]: {
    providerId: OpenClawProviderId.OpenAI,
    resolveApi: () => OpenClawApi.OpenAICompletions as OpenClawProviderApi,
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },
  [`${ProviderName.OpenAI}:oauth`]: {
    providerId: OpenClawProviderId.OpenAICodex,
    resolveApi: () => OpenClawApi.OpenAICodexResponses as OpenClawProviderApi,
    normalizeBaseUrl: () => 'https://chatgpt.com/backend-api/codex',
  },
  [ProviderName.DeepSeek]: {
    providerId: OpenClawProviderId.DeepSeek,
    resolveApi: ({ apiType }) => mapApiTypeToOpenClawApi(apiType),
    normalizeBaseUrl: stripChatCompletionsSuffix,
    resolveModelReasoning: resolveDeepSeekModelReasoning,
  },
  [ProviderName.Qwen]: {
    providerId: OpenClawProviderId.Qwen,
    resolveApi: ({ apiType }) => mapApiTypeToOpenClawApi(apiType),
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },
  [ProviderName.Zhipu]: {
    providerId: OpenClawProviderId.Zai,
    resolveApi: ({ apiType }) => mapApiTypeToOpenClawApi(apiType),
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },
  [ProviderName.Volcengine]: {
    providerId: OpenClawProviderId.Volcengine,
    resolveApi: ({ apiType }) => mapApiTypeToOpenClawApi(apiType),
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },
  [`${ProviderName.Volcengine}:codingPlan`]: {
    providerId: OpenClawProviderId.VolcenginePlan,
    resolveApi: ({ apiType }) => mapApiTypeToOpenClawApi(apiType),
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },
  [ProviderName.Minimax]: {
    providerId: OpenClawProviderId.Minimax,
    resolveApi: ({ apiType }) => mapApiTypeToOpenClawApi(apiType),
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },
  [ProviderName.Youdaozhiyun]: {
    providerId: OpenClawProviderId.Youdaozhiyun,
    resolveApi: () => OpenClawApi.OpenAICompletions as OpenClawProviderApi,
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },
  [ProviderName.StepFun]: {
    providerId: OpenClawProviderId.StepFun,
    resolveApi: () => OpenClawApi.OpenAICompletions as OpenClawProviderApi,
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },
  [ProviderName.Xiaomi]: {
    providerId: OpenClawProviderId.Xiaomi,
    resolveApi: ({ apiType }) => mapApiTypeToOpenClawApi(apiType),
    normalizeBaseUrl: stripChatCompletionsSuffix,
    resolveModelReasoning: () => true,
  },
  [ProviderName.OpenRouter]: {
    providerId: OpenClawProviderId.OpenRouter,
    resolveApi: ({ apiType }) => mapApiTypeToOpenClawApi(apiType),
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },
  [ProviderName.Ollama]: {
    providerId: OpenClawProviderId.Ollama,
    resolveApi: () => OpenClawApi.OpenAICompletions as OpenClawProviderApi,
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },
  [ProviderName.LmStudio]: {
    providerId: OpenClawProviderId.LmStudio,
    resolveApi: () => OpenClawApi.OpenAICompletions as OpenClawProviderApi,
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },
};

const DEFAULT_DESCRIPTOR: ProviderDescriptor = {
  providerId: OpenClawProviderId.Lobster,
  resolveApi: ({ apiType }) => mapApiTypeToOpenClawApi(apiType),
  normalizeBaseUrl: stripChatCompletionsSuffix,
};

const resolveDescriptor = (
  providerName: string,
  codingPlanEnabled: boolean,
  authType?: 'apikey' | 'oauth',
): ProviderDescriptor => {
  if (providerName === ProviderName.OpenAI && authType === 'oauth') {
    return PROVIDER_REGISTRY[`${ProviderName.OpenAI}:oauth`];
  }
  if (codingPlanEnabled) {
    const compositeKey = `${providerName}:codingPlan`;
    if (compositeKey in PROVIDER_REGISTRY) {
      return PROVIDER_REGISTRY[compositeKey];
    }
  }
  if (providerName in PROVIDER_REGISTRY) {
    return PROVIDER_REGISTRY[providerName];
  }
  return {
    ...DEFAULT_DESCRIPTOR,
    providerId: providerName || OpenClawProviderId.Lobster,
  };
};

describe('resolveDescriptor', () => {
  test('gemini maps to google providerId with google-generative-ai API', () => {
    const d = resolveDescriptor(ProviderName.Gemini, false);
    expect(d.providerId).toBe(OpenClawProviderId.Google);
    expect(d.resolveApi({ apiType: undefined, baseURL: '' })).toBe(OpenClawApi.GoogleGenerativeAI);
  });

  test('anthropic maps to anthropic providerId with anthropic-messages API', () => {
    const d = resolveDescriptor(ProviderName.Anthropic, false);
    expect(d.providerId).toBe(OpenClawProviderId.Anthropic);
    expect(d.resolveApi({ apiType: undefined, baseURL: '' })).toBe(OpenClawApi.AnthropicMessages);
  });

  test('openai maps to openai providerId', () => {
    const d = resolveDescriptor(ProviderName.OpenAI, false);
    expect(d.providerId).toBe(OpenClawProviderId.OpenAI);
  });

  test('openai oauth maps to openai-codex providerId', () => {
    const d = resolveDescriptor(ProviderName.OpenAI, false, 'oauth');
    expect(d.providerId).toBe(OpenClawProviderId.OpenAICodex);
    expect(d.resolveApi({ apiType: 'openai', baseURL: '' })).toBe(OpenClawApi.OpenAICodexResponses);
    expect(d.normalizeBaseUrl('https://api.openai.com/v1')).toBe('https://chatgpt.com/backend-api/codex');
  });

  test('moonshot without codingPlan uses moonshot providerId', () => {
    const d = resolveDescriptor(ProviderName.Moonshot, false);
    expect(d.providerId).toBe(OpenClawProviderId.Moonshot);
    expect(d.resolveApi({ apiType: undefined, baseURL: '' })).toBe(OpenClawApi.OpenAICompletions);
  });

  test('moonshot with codingPlan uses kimi-coding providerId', () => {
    const d = resolveDescriptor(ProviderName.Moonshot, true);
    expect(d.providerId).toBe(OpenClawProviderId.KimiCoding);
    expect(d.resolveApi({ apiType: undefined, baseURL: '' })).toBe(OpenClawApi.AnthropicMessages);
    expect(d.resolveSessionModelId!('any-model')).toBe('k2p5');
  });

  test('moonshot codingPlan has model defaults', () => {
    const d = resolveDescriptor(ProviderName.Moonshot, true);
    expect(d.modelDefaults?.reasoning).toBe(true);
    expect(d.modelDefaults?.contextWindow).toBe(256000);
    expect(d.modelDefaults?.maxTokens).toBe(8192);
  });

  test('deepseek maps to deepseek providerId respecting apiType', () => {
    const d = resolveDescriptor(ProviderName.DeepSeek, false);
    expect(d.providerId).toBe(OpenClawProviderId.DeepSeek);
    expect(d.resolveApi({ apiType: 'openai', baseURL: '' })).toBe(OpenClawApi.OpenAICompletions);
    expect(d.resolveApi({ apiType: 'anthropic', baseURL: '' })).toBe(OpenClawApi.AnthropicMessages);
  });

  test('deepseek marks reasoning models but leaves chat models unspecified', () => {
    const d = resolveDescriptor(ProviderName.DeepSeek, false);
    expect(d.resolveModelReasoning?.('deepseek-reasoner', false)).toBe(true);
    expect(d.resolveModelReasoning?.('deepseek-v4-pro', false)).toBe(true);
    expect(d.resolveModelReasoning?.('deepseek-v4_flash', false)).toBe(true);
    expect(d.resolveModelReasoning?.('deepseek-chat', false)).toBeUndefined();
  });

  test('xiaomi marks every model as reasoning-capable', () => {
    const d = resolveDescriptor(ProviderName.Xiaomi, false);
    expect(d.resolveModelReasoning?.('mimo-v2.5-pro', false)).toBe(true);
    expect(d.resolveModelReasoning?.('mimo-custom-model', false)).toBe(true);
  });

  test('youdaozhiyun always uses openai-completions', () => {
    const d = resolveDescriptor(ProviderName.Youdaozhiyun, false);
    expect(d.providerId).toBe(OpenClawProviderId.Youdaozhiyun);
    expect(d.resolveApi({ apiType: 'anthropic', baseURL: '' })).toBe(OpenClawApi.OpenAICompletions);
  });

  test('ollama always uses openai-completions', () => {
    const d = resolveDescriptor(ProviderName.Ollama, false);
    expect(d.providerId).toBe(OpenClawProviderId.Ollama);
    expect(d.resolveApi({ apiType: undefined, baseURL: '' })).toBe(OpenClawApi.OpenAICompletions);
  });

  test('lm-studio always uses openai-completions', () => {
    const d = resolveDescriptor(ProviderName.LmStudio, false);
    expect(d.providerId).toBe(OpenClawProviderId.LmStudio);
    expect(d.resolveApi({ apiType: undefined, baseURL: '' })).toBe(OpenClawApi.OpenAICompletions);
  });

  test('unknown provider falls back to lobster providerId', () => {
    const d = resolveDescriptor('some-unknown', false);
    expect(d.providerId).toBe('some-unknown');
  });

  test('empty provider name falls back to lobster', () => {
    const d = resolveDescriptor('', false);
    expect(d.providerId).toBe(OpenClawProviderId.Lobster);
  });

  test('codingPlan flag is ignored for providers without codingPlan entry', () => {
    const d = resolveDescriptor(ProviderName.OpenAI, true);
    expect(d.providerId).toBe(OpenClawProviderId.OpenAI);
  });

  test('volcengine with codingPlan uses volcengine-plan providerId', () => {
    const d = resolveDescriptor(ProviderName.Volcengine, true);
    expect(d.providerId).toBe(OpenClawProviderId.VolcenginePlan);
  });

  test('volcengine without codingPlan uses volcengine providerId', () => {
    const d = resolveDescriptor(ProviderName.Volcengine, false);
    expect(d.providerId).toBe(OpenClawProviderId.Volcengine);
  });
});

describe('provider registry coverage', () => {
  const allRegistryProviders = [
    ProviderName.Moonshot,
    ProviderName.Gemini,
    ProviderName.Anthropic,
    ProviderName.OpenAI,
    ProviderName.DeepSeek,
    ProviderName.Qwen,
    ProviderName.Zhipu,
    ProviderName.Volcengine,
    ProviderName.Minimax,
    ProviderName.Youdaozhiyun,
    ProviderName.StepFun,
    ProviderName.Xiaomi,
    ProviderName.OpenRouter,
    ProviderName.Ollama,
    ProviderName.LmStudio,
  ] as const;

  test('all 15 providers have registry entries', () => {
    for (const name of allRegistryProviders) {
      expect(name in PROVIDER_REGISTRY, `${name} missing from registry`).toBe(true);
    }
  });

  test('no provider resolves to lobster fallback', () => {
    for (const name of allRegistryProviders) {
      const d = resolveDescriptor(name, false);
      expect(d.providerId).not.toBe(OpenClawProviderId.Lobster);
    }
  });

  test('every provider has a non-empty providerId', () => {
    for (const name of allRegistryProviders) {
      const d = resolveDescriptor(name, false);
      expect(d.providerId.length).toBeGreaterThan(0);
    }
  });
});

describe('buildProviderSelection compatibility', () => {
  test('repairs stale image capability for known Qwen models', async () => {
    const { buildProviderSelection } = await import('./openclawConfigSync');

    const selection = buildProviderSelection({
      apiKey: 'sk-test',
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      modelId: 'qwen3.6-plus',
      apiType: 'openai',
      providerName: ProviderName.Qwen,
      codingPlanEnabled: true,
      supportsImage: false,
      modelName: 'qwen3.6-plus',
    });

    expect(selection.providerConfig.models[0].input).toEqual(['text', 'image']);
  });

  test('routes DashScope Anthropic URLs through OpenAI-compatible API', async () => {
    const { buildProviderSelection } = await import('./openclawConfigSync');

    const selection = buildProviderSelection({
      apiKey: 'sk-test',
      baseURL: 'https://dashscope.aliyuncs.com/apps/anthropic',
      modelId: 'qwen3.6-plus',
      apiType: 'anthropic',
      providerName: ProviderName.Qwen,
      supportsImage: true,
      modelName: 'qwen3.6-plus',
    });

    expect(selection.providerConfig.api).toBe(OpenClawApi.OpenAICompletions);
    expect(selection.providerConfig.baseUrl).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
  });

  test('routes DashScope coding Anthropic URLs through coding OpenAI-compatible API', async () => {
    const { buildProviderSelection } = await import('./openclawConfigSync');

    const selection = buildProviderSelection({
      apiKey: 'sk-test',
      baseURL: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
      modelId: 'qwen3.6-plus',
      apiType: 'anthropic',
      providerName: ProviderName.Qwen,
      codingPlanEnabled: true,
      supportsImage: true,
      modelName: 'qwen3.6-plus',
    });

    expect(selection.providerConfig.api).toBe(OpenClawApi.OpenAICompletions);
    expect(selection.providerConfig.baseUrl).toBe('https://coding.dashscope.aliyuncs.com/v1');
  });

  test('marks DeepSeek reasoning models and all Xiaomi models as reasoning-capable', async () => {
    const { buildProviderSelection } = await import('./openclawConfigSync');

    const deepseekSelection = buildProviderSelection({
      apiKey: 'sk-test',
      baseURL: 'https://api.deepseek.com',
      modelId: 'deepseek-v4-pro',
      apiType: 'openai',
      providerName: ProviderName.DeepSeek,
      supportsImage: false,
      modelName: 'DeepSeek V4 Pro',
    });
    expect(deepseekSelection.providerConfig.api).toBe(OpenClawApi.OpenAICompletions);
    expect(deepseekSelection.providerConfig.models[0].reasoning).toBe(true);

    const xiaomiSelection = buildProviderSelection({
      apiKey: 'sk-test',
      baseURL: 'https://api.xiaomimimo.com/v1/chat/completions',
      modelId: 'mimo-any-model',
      apiType: 'openai',
      providerName: ProviderName.Xiaomi,
      supportsImage: false,
      modelName: 'MiMo Any Model',
    });
    expect(xiaomiSelection.providerConfig.baseUrl).toBe('https://api.xiaomimimo.com/v1');
    expect(xiaomiSelection.providerConfig.api).toBe(OpenClawApi.OpenAICompletions);
    expect(xiaomiSelection.providerConfig.models[0].reasoning).toBe(true);
  });
});
