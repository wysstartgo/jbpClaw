import { app } from 'electron';
import { join } from 'path';

import type { ProviderConfig as SharedProviderConfig, ProviderModelConfig } from '../../shared/providers';
import { ProviderName, ProviderRegistry, isQingShuServerProvider, resolveCodingPlanBaseUrl } from '../../shared/providers';
import type { SqliteStore } from '../sqliteStore';
import type { CoworkApiConfig } from './coworkConfigStore';
import { type AnthropicApiFormat,normalizeProviderApiFormat } from './coworkFormatTransform';
import {
  configureCoworkOpenAICompatProxy,
  getCoworkOpenAICompatProxyBaseURL,
  getCoworkOpenAICompatProxyStatus,
  type OpenAICompatProxyTarget,
} from './coworkOpenAICompatProxy';
import { readOpenAICodexAuthFile } from './openaiCodexAuth';

const QINGSHU_SERVER_PROXY_PATH = '/api/qingshu-claw/proxy/v1';

type ProviderModelInputConfig = Omit<ProviderModelConfig, 'name'> & { name?: string };
type ProviderConfig = Omit<SharedProviderConfig, 'apiFormat' | 'models'> & {
  apiFormat?: 'anthropic' | 'openai' | 'native';
  models?: ProviderModelInputConfig[];
};

type AppConfig = {
  model?: {
    defaultModel?: string;
    defaultModelProvider?: string;
  };
  providers?: Record<string, ProviderConfig>;
};

export type ApiConfigResolution = {
  config: CoworkApiConfig | null;
  error?: string;
  providerMetadata?: {
    providerName: string;
    authType?: ProviderConfig['authType'];
    codingPlanEnabled: boolean;
    supportsImage?: boolean;
    modelName?: string;
    contextWindow?: number;
  };
};

// Store getter function injected from main.ts
let storeGetter: (() => SqliteStore | null) | null = null;

export function setStoreGetter(getter: () => SqliteStore | null): void {
  storeGetter = getter;
}

// Auth token getter injected from main.ts for server model provider
let authTokensGetter: (() => { accessToken: string; refreshToken: string } | null) | null = null;

export function setAuthTokensGetter(getter: () => { accessToken: string; refreshToken: string } | null): void {
  authTokensGetter = getter;
}

// Server base URL getter injected from main.ts
let serverBaseUrlGetter: (() => string) | null = null;

export function setServerBaseUrlGetter(getter: () => string): void {
  serverBaseUrlGetter = getter;
}

let qingShuInvocationContextGetter: (() => {
  clientUserId?: string | null;
  deviceId?: string | null;
} | null) | null = null;

export function setQingShuInvocationContextGetter(getter: () => {
  clientUserId?: string | null;
  deviceId?: string | null;
} | null): void {
  qingShuInvocationContextGetter = getter;
}

// Cached server model metadata (populated when auth:getModels is called)
// Keyed by modelId → { supportsImage }
let serverModelMetadataCache: Map<string, { supportsImage?: boolean }> = new Map();

export function updateServerModelMetadata(models: Array<{ modelId: string; supportsImage?: boolean }>): boolean {
  const previous = serializeServerModelMetadata(getAllServerModelMetadata());
  const nextCache = new Map(models.map(m => [m.modelId, { supportsImage: m.supportsImage }]));
  const next = serializeServerModelMetadata(Array.from(nextCache.entries()).map(([modelId, meta]) => ({
    modelId,
    supportsImage: meta.supportsImage,
  })));
  serverModelMetadataCache = nextCache;
  return previous !== next;
}

export function clearServerModelMetadata(): void {
  serverModelMetadataCache.clear();
}

export function getAllServerModelMetadata(): Array<{ modelId: string; supportsImage?: boolean }> {
  return Array.from(serverModelMetadataCache.entries()).map(([modelId, meta]) => ({
    modelId,
    supportsImage: meta.supportsImage,
  }));
}

const serializeServerModelMetadata = (
  models: Array<{ modelId: string; supportsImage?: boolean }>,
): string => JSON.stringify(
  models
    .map((model) => ({
      modelId: model.modelId,
      supportsImage: model.supportsImage,
    }))
    .sort((a, b) => a.modelId.localeCompare(b.modelId)),
);

function buildServerFallbackModels(effectiveModelId: string): NonNullable<ProviderConfig['models']> {
  const models = getAllServerModelMetadata().map((model) => ({
    id: model.modelId,
    name: model.modelId,
    supportsImage: model.supportsImage,
  }));

  if (!models.some(model => model.id === effectiveModelId)) {
    const cachedMeta = serverModelMetadataCache.get(effectiveModelId);
    models.unshift({
      id: effectiveModelId,
      name: effectiveModelId,
      supportsImage: cachedMeta?.supportsImage,
    });
  }

  return models;
}

function normalizeProviderModels(providerName: string, models?: ProviderModelInputConfig[]): ProviderModelConfig[] {
  return (models ?? [])
    .filter(model => model.id?.trim())
    .map(model => ({
      ...model,
      id: model.id,
      name: model.name || model.id,
      supportsImage: ProviderRegistry.resolveModelSupportsImage(
        providerName,
        model.id,
        model.supportsImage,
      ),
    }));
}

const getStore = (): SqliteStore | null => {
  if (!storeGetter) {
    return null;
  }
  return storeGetter();
};

export function getClaudeCodePath(): string {
  if (app.isPackaged) {
    return join(
      process.resourcesPath,
      'app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk/cli.js'
    );
  }

  // In development, try to find the SDK in the project root node_modules
  // app.getAppPath() might point to dist-electron or other build output directories
  // We need to look in the project root
  const appPath = app.getAppPath();
  // If appPath ends with dist-electron, go up one level
  const rootDir = appPath.endsWith('dist-electron') 
    ? join(appPath, '..') 
    : appPath;

  return join(rootDir, 'node_modules/@anthropic-ai/claude-agent-sdk/cli.js');
}

type MatchedProvider = {
  providerName: string;
  providerConfig: ProviderConfig;
  modelId: string;
  apiFormat: AnthropicApiFormat;
  baseURL: string;
  supportsImage?: boolean;
  modelName?: string;
  contextWindow?: number;
};

function resolveProviderCredential(providerName: string, providerConfig: ProviderConfig): {
  apiKey: string;
  baseURLOverride?: string;
  apiFormatOverride?: AnthropicApiFormat;
  isOAuth: boolean;
} {
  if (providerName === ProviderName.OpenAI && providerConfig.authType === 'oauth') {
    const codexAuth = readOpenAICodexAuthFile();
    return {
      apiKey: codexAuth ? 'codex-oauth' : '',
      isOAuth: true,
    };
  }

  if (providerName === ProviderName.Minimax && providerConfig.authType === 'oauth') {
    const oauthToken = providerConfig.oauthAccessToken?.trim() || '';
    return {
      apiKey: oauthToken,
      baseURLOverride: providerConfig.oauthBaseUrl?.trim() || undefined,
      apiFormatOverride: oauthToken ? 'anthropic' : undefined,
      isOAuth: true,
    };
  }

  return {
    apiKey: providerConfig.apiKey?.trim() || '',
    isOAuth: false,
  };
}

function getEffectiveProviderApiFormat(providerName: string, apiFormat: unknown): AnthropicApiFormat {
  if (
    providerName === ProviderName.OpenAI
    || providerName === ProviderName.Gemini
    || providerName === ProviderName.StepFun
    || providerName === ProviderName.Youdaozhiyun
    || providerName === ProviderName.Qianfan
    || providerName === ProviderName.Copilot
    || providerName === ProviderName.Moonshot
  ) {
    return 'openai';
  }
  if (providerName === ProviderName.Anthropic) {
    return 'anthropic';
  }
  return normalizeProviderApiFormat(apiFormat);
}

function providerRequiresApiKey(providerName: string): boolean {
  return providerName !== ProviderName.Ollama && providerName !== ProviderName.LmStudio;
}

function tryQingShuServerFallback(modelId?: string): MatchedProvider | null {
  const tokens = authTokensGetter?.();
  const serverBaseUrl = serverBaseUrlGetter?.();
  if (!tokens?.accessToken || !serverBaseUrl) return null;
  const effectiveModelId = modelId?.trim() || '';
  if (!effectiveModelId) return null;
  const baseURL = `${serverBaseUrl}${QINGSHU_SERVER_PROXY_PATH}`;
  const cachedMeta = serverModelMetadataCache.get(effectiveModelId);
  console.log('[ClaudeSettings] qingshu-server fallback activated:', { baseURL, modelId: effectiveModelId, supportsImage: cachedMeta?.supportsImage });
  return {
    providerName: ProviderName.QingShuServer,
    providerConfig: { enabled: true, apiKey: tokens.accessToken, baseUrl: baseURL, apiFormat: 'openai', models: buildServerFallbackModels(effectiveModelId) },
    modelId: effectiveModelId,
    apiFormat: 'openai',
    baseURL,
    supportsImage: cachedMeta?.supportsImage,
  };
}

function resolveMatchedProvider(appConfig: AppConfig): { matched: MatchedProvider | null; error?: string } {
  const providers = appConfig.providers ?? {};

  const resolveFallbackModel = (): {
    providerName: string;
    providerConfig: ProviderConfig;
    modelId: string;
  } | null => {
    for (const [providerName, providerConfig] of Object.entries(providers)) {
      if (!providerConfig?.enabled || !providerConfig.models || providerConfig.models.length === 0) {
        continue;
      }
      const fallbackModel = providerConfig.models.find((model) => model.id?.trim());
      if (!fallbackModel) {
        continue;
      }
      return {
        providerName,
        providerConfig,
        modelId: fallbackModel.id.trim(),
      };
    }
    return null;
  };

  const configuredModelId = appConfig.model?.defaultModel?.trim();
  let modelId = configuredModelId || '';
  if (!modelId) {
    const fallback = resolveFallbackModel();
    if (!fallback) {
      const serverFallback = tryQingShuServerFallback(configuredModelId);
      if (serverFallback) return { matched: serverFallback };
      return { matched: null, error: 'No available model configured in enabled providers.' };
    }
    modelId = fallback.modelId;
  }

  let providerEntry: [string, ProviderConfig] | undefined;
  const preferredProviderName = appConfig.model?.defaultModelProvider?.trim();

  // Handle QingShu server provider: dynamically construct from auth tokens.
  if (isQingShuServerProvider(preferredProviderName)) {
    const serverMatch = tryQingShuServerFallback(modelId);
    if (serverMatch) {
      return { matched: serverMatch };
    }
  }

  if (preferredProviderName) {
    const preferredProvider = providers[preferredProviderName];
    if (
      preferredProvider?.enabled
      && preferredProvider.models?.some((model) => model.id === modelId)
    ) {
      providerEntry = [preferredProviderName, preferredProvider];
    }
  }

  if (!providerEntry) {
    providerEntry = Object.entries(providers).find(([, provider]) => {
      if (!provider?.enabled || !provider.models) {
        return false;
      }
      return provider.models.some((model) => model.id === modelId);
    });
  }

  if (!providerEntry) {
    const fallback = resolveFallbackModel();
    if (fallback) {
      modelId = fallback.modelId;
      providerEntry = [fallback.providerName, fallback.providerConfig];
    } else {
      const serverFallback = tryQingShuServerFallback(modelId);
      if (serverFallback) return { matched: serverFallback };
      return { matched: null, error: `No enabled provider found for model: ${modelId}` };
    }
  }

  const [providerName, providerConfig] = providerEntry;
  const credential = resolveProviderCredential(providerName, providerConfig);
  if (providerName === ProviderName.OpenAI && credential.isOAuth && !credential.apiKey) {
    const serverFallback = tryQingShuServerFallback(modelId);
    if (serverFallback) return { matched: serverFallback };
    return { matched: null, error: 'OpenAI Codex OAuth mode selected but login not completed.' };
  }
  if (credential.isOAuth && !credential.apiKey) {
    const serverFallback = tryQingShuServerFallback(modelId);
    if (serverFallback) return { matched: serverFallback };
    return { matched: null, error: 'MiniMax OAuth mode selected but login not completed.' };
  }
  let apiFormat = getEffectiveProviderApiFormat(providerName, providerConfig.apiFormat);
  let baseURL = providerConfig.baseUrl?.trim();

  if (providerConfig.codingPlanEnabled) {
    const resolved = resolveCodingPlanBaseUrl(providerName, true, apiFormat, baseURL ?? '');
    baseURL = resolved.baseUrl;
    apiFormat = resolved.effectiveFormat;
  }

  if (!baseURL) {
    const serverFallback = tryQingShuServerFallback(modelId);
    if (serverFallback) return { matched: serverFallback };
    return { matched: null, error: `Provider ${providerName} is missing base URL.` };
  }

  if (apiFormat === 'anthropic' && providerRequiresApiKey(providerName) && !credential.apiKey) {
    const serverFallback = tryQingShuServerFallback(modelId);
    if (serverFallback) return { matched: serverFallback };
    return { matched: null, error: `Provider ${providerName} requires API key for Anthropic-compatible mode.` };
  }

  const normalizedModels = normalizeProviderModels(providerName, providerConfig.models);
  const matchedModel = normalizedModels.find((m) => m.id === modelId);

  return {
    matched: {
      providerName,
      providerConfig: {
        ...providerConfig,
        apiKey: credential.apiKey || providerConfig.apiKey,
        models: normalizedModels,
      },
      modelId,
      apiFormat: credential.apiFormatOverride ?? apiFormat,
      baseURL: credential.baseURLOverride ?? baseURL,
      supportsImage: matchedModel?.supportsImage,
      modelName: matchedModel?.name,
      contextWindow: matchedModel?.contextWindow,
    },
  };
}

export function resolveCurrentApiConfig(target: OpenAICompatProxyTarget = 'local'): ApiConfigResolution {
  const sqliteStore = getStore();
  if (!sqliteStore) {
    return {
      config: null,
      error: 'Store is not initialized.',
    };
  }

  const appConfig = sqliteStore.get<AppConfig>('app_config');
  if (!appConfig) {
    return {
      config: null,
      error: 'Application config not found.',
    };
  }

  const { matched, error } = resolveMatchedProvider(appConfig);
  if (!matched) {
    return {
      config: null,
      error,
    };
  }

  const resolvedBaseURL = matched.baseURL;
  const resolvedApiKey = matched.providerConfig.apiKey?.trim() || '';
  // Providers that don't require auth (e.g. Ollama) still need a non-empty
  // placeholder so downstream components (OpenClaw gateway, compat proxy)
  // don't reject the request with "No API key found for provider".
  const effectiveApiKey = resolvedApiKey
    || (!providerRequiresApiKey(matched.providerName) ? 'sk-lobsterai-local' : '');

  if (matched.apiFormat === 'anthropic') {
    return {
      config: {
        apiKey: effectiveApiKey,
        baseURL: resolvedBaseURL,
        model: matched.modelId,
        apiType: 'anthropic',
      },
      providerMetadata: {
        providerName: matched.providerName,
        codingPlanEnabled: !!matched.providerConfig.codingPlanEnabled,
        supportsImage: matched.supportsImage,
      },
    };
  }

  const proxyStatus = getCoworkOpenAICompatProxyStatus();
  if (!proxyStatus.running) {
    return {
      config: null,
      error: 'OpenAI compatibility proxy is not running.',
    };
  }

  configureCoworkOpenAICompatProxy({
    baseURL: resolvedBaseURL,
    apiKey: resolvedApiKey || undefined,
    model: matched.modelId,
    provider: matched.providerName,
    ...(isQingShuServerProvider(matched.providerName) ? (qingShuInvocationContextGetter?.() ?? {}) : {}),
  });

  const proxyBaseURL = getCoworkOpenAICompatProxyBaseURL(target);
  if (!proxyBaseURL) {
    return {
      config: null,
      error: 'OpenAI compatibility proxy base URL is unavailable.',
    };
  }

  return {
    config: {
      apiKey: resolvedApiKey || 'lobsterai-openai-compat',
      baseURL: proxyBaseURL,
      model: matched.modelId,
      apiType: 'openai',
    },
    providerMetadata: {
      providerName: matched.providerName,
      codingPlanEnabled: !!matched.providerConfig.codingPlanEnabled,
    },
  };
}

export function getCurrentApiConfig(target: OpenAICompatProxyTarget = 'local'): CoworkApiConfig | null {
  return resolveCurrentApiConfig(target).config;
}

/**
 * Resolve the raw API config directly from the app config,
 * without requiring the OpenAI compatibility proxy.
 * Used by OpenClaw config sync which has its own model routing.
 */
export function resolveRawApiConfig(): ApiConfigResolution {
  const sqliteStore = getStore();
  if (!sqliteStore) {
    return { config: null, error: 'Store is not initialized.' };
  }
  const appConfig = sqliteStore.get<AppConfig>('app_config');
  if (!appConfig) {
    return { config: null, error: 'Application config not found.' };
  }
  const { matched, error } = resolveMatchedProvider(appConfig);
  if (!matched) {
    return { config: null, error };
  }
  const apiKey = matched.providerConfig.apiKey?.trim() || '';
  console.log('[ClaudeSettings] resolved raw API config:', JSON.stringify({
    ...matched,
    providerConfig: { ...matched.providerConfig, apiKey: apiKey ? '***' : '' },
  }));
  // OpenClaw's gateway requires a non-empty apiKey for every provider — even
  // local servers (Ollama, vLLM, etc.) that don't enforce auth.  When the user
  // leaves the key blank we supply a placeholder so the gateway doesn't reject
  // the request with "No API key found for provider".
  const effectiveApiKey = apiKey
    || (!providerRequiresApiKey(matched.providerName) ? 'sk-lobsterai-local' : '');
  return {
    config: {
      apiKey: effectiveApiKey,
      baseURL: matched.baseURL,
      model: matched.modelId,
      apiType: matched.apiFormat === 'anthropic' ? 'anthropic' : 'openai',
    },
    providerMetadata: {
      providerName: matched.providerName,
      authType: matched.providerConfig.authType,
      codingPlanEnabled: !!matched.providerConfig.codingPlanEnabled,
      supportsImage: matched.supportsImage,
      modelName: matched.modelName,
      contextWindow: matched.contextWindow,
    },
  };
}

/**
 * Collect apiKeys for ALL configured providers (not just the currently selected one).
 * Used by OpenClaw config sync to pre-register all apiKeys as env vars at gateway
 * startup, so switching between providers doesn't require a process restart.
 *
 * Returns a map of env-var-safe provider name → apiKey.
 */
export function resolveAllProviderApiKeys(): Record<string, string> {
  const result: Record<string, string> = {};

  // QingShu server token is now managed by the token proxy
  // (openclawTokenProxy.ts) — no longer injected as an env var.

  // All configured custom providers
  const sqliteStore = getStore();
  if (!sqliteStore) return result;
  const appConfig = sqliteStore.get<AppConfig>('app_config');
  if (!appConfig?.providers) return result;

  for (const [providerName, providerConfig] of Object.entries(appConfig.providers)) {
    if (!providerConfig?.enabled) continue;
    const apiKey = resolveProviderCredential(providerName, providerConfig).apiKey;
    if (providerName === ProviderName.OpenAI && providerConfig.authType === 'oauth') continue;
    if (!apiKey && providerRequiresApiKey(providerName)) continue;
    const envName = providerName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    result[envName] = apiKey || 'sk-lobsterai-local';
  }

  return result;
}

export type ProviderRawConfig = {
  providerName: string;
  baseURL: string;
  apiKey: string;
  apiType: 'anthropic' | 'openai';
  authType?: ProviderConfig['authType'];
  codingPlanEnabled: boolean;
  models: ProviderModelConfig[];
};

export function resolveAllEnabledProviderConfigs(): ProviderRawConfig[] {
  const sqliteStore = getStore();
  if (!sqliteStore) return [];
  const appConfig = sqliteStore.get<AppConfig>('app_config');
  if (!appConfig?.providers) return [];

  const result: ProviderRawConfig[] = [];

  for (const [providerName, providerConfig] of Object.entries(appConfig.providers)) {
    if (!providerConfig?.enabled) continue;
    if (isQingShuServerProvider(providerName)) continue;

    const credential = resolveProviderCredential(providerName, providerConfig);
    const apiKey = credential.apiKey;
    if (providerName === ProviderName.OpenAI && providerConfig.authType === 'oauth') continue;
    if (!apiKey && providerRequiresApiKey(providerName)) continue;

    const baseURL = credential.baseURLOverride || providerConfig.baseUrl?.trim() || '';

    let effectiveBaseURL = baseURL;
    let effectiveApiFormat = credential.apiFormatOverride ?? getEffectiveProviderApiFormat(providerName, providerConfig.apiFormat);

    if (providerConfig.codingPlanEnabled) {
      const resolved = resolveCodingPlanBaseUrl(providerName, true, effectiveApiFormat, effectiveBaseURL);
      effectiveBaseURL = resolved.baseUrl;
      effectiveApiFormat = resolved.effectiveFormat;
    }

    if (!effectiveBaseURL) continue;

    const models = (providerConfig.models ?? []).filter((m) => m.id?.trim());
    if (models.length === 0) continue;

    result.push({
      providerName,
      baseURL: effectiveBaseURL,
      apiKey: apiKey || 'sk-lobsterai-local',
      apiType: effectiveApiFormat === 'anthropic' ? 'anthropic' : 'openai',
      authType: providerConfig.authType,
      codingPlanEnabled: !!providerConfig.codingPlanEnabled,
      models: normalizeProviderModels(providerName, models),
    });
  }

  return result;
}

export function buildEnvForConfig(config: CoworkApiConfig): Record<string, string> {
  const baseEnv = { ...process.env } as Record<string, string>;

  baseEnv.ANTHROPIC_AUTH_TOKEN = config.apiKey;
  baseEnv.ANTHROPIC_API_KEY = config.apiKey;
  baseEnv.ANTHROPIC_BASE_URL = config.baseURL;
  baseEnv.ANTHROPIC_MODEL = config.model;

  return baseEnv;
}
