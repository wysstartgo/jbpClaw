import type { AuthConfig } from '../common/auth';
import { DEFAULT_AUTH_CONFIG } from '../common/auth';
import {
  type BrowserWebAccessConfig,
  defaultBrowserWebAccessConfig,
} from '../shared/browserWebAccess/constants';
import type { PetConfig } from '../shared/pet/types';
import type { ProviderConfig } from '../shared/providers';
import { ProviderRegistry } from '../shared/providers';
import { TtsEngine } from '../shared/tts/constants';
import type { WakeInputConfig } from '../shared/wakeInput/constants';

export interface VoicePostProcessConfig {
  sttLlmCorrectionEnabled: boolean;
  ttsLlmRewriteEnabled: boolean;
  ttsSkipKeywords: string[];
}

type AppProviderConfig = Omit<ProviderConfig, 'apiFormat'> & {
  apiFormat?: 'anthropic' | 'openai' | 'gemini';
};

// 配置类型定义
export interface AppConfig {
  // API 配置
  api: {
    key: string;
    baseUrl: string;
  };
  // 自定义模型提供商递增 ID 计数器（单调递增，删除后不复用）
  customProviderNextId?: number;
  // 模型配置
  model: {
    availableModels: Array<{
      id: string;
      name: string;
      supportsImage?: boolean;
      openClawProviderId?: string;
    }>;
    defaultModel: string;
    defaultModelProvider?: string;
  };
  // 多模型提供商配置
  providers?: Record<string, AppProviderConfig>;
  // 主题配置
  theme: 'light' | 'dark' | 'system';
  // 语言配置
  language: 'zh' | 'en';
  // 是否使用系统代理
  useSystemProxy: boolean;
  // 浏览器与网页访问配置
  browserWebAccess: BrowserWebAccessConfig;
  // 客户端宠物伙伴配置，由 pet IPC 作为写入真源。
  pet?: PetConfig;
  // 语言初始化标记 (用于判断是否是首次启动)
  language_initialized?: boolean;
  // 应用配置
  app: {
    port: number;
    isDevelopment: boolean;
    testMode?: boolean;
  };
  // 认证后端配置
  auth: AuthConfig;
  // 快捷键配置
  shortcuts?: {
    newChat: string;
    search: string;
    settings: string;
    [key: string]: string | undefined;
  };
  speechInput?: {
    stopCommand: string;
    submitCommand: string;
    autoRestartAfterReply: boolean;
  };
  wakeInput?: WakeInputConfig;
  tts?: {
    enabled: boolean;
    autoPlayAssistantReply: boolean;
    engine: TtsEngine;
    voiceId: string;
    rate: number;
    volume: number;
  };
  voice?: {
    postProcess: VoicePostProcessConfig;
  };
}

export const DEFAULT_SPEECH_INPUT_CONFIG: NonNullable<AppConfig['speechInput']> = {
  stopCommand: '停止输入',
  submitCommand: '结束发送',
  autoRestartAfterReply: false,
};

export const DEFAULT_WAKE_INPUT_CONFIG: NonNullable<AppConfig['wakeInput']> = {
  enabled: false,
  wakeWords: ['打开青书爪'],
  submitCommand: '发送',
  cancelCommand: '取消',
  sessionTimeoutMs: 20_000,
  autoRestartAfterReply: false,
  activationReplyEnabled: false,
  activationReplyText: '在的',
};

export const DEFAULT_TTS_CONFIG: NonNullable<AppConfig['tts']> = {
  enabled: true,
  autoPlayAssistantReply: false,
  engine: TtsEngine.MacOsNative,
  voiceId: '',
  rate: 0.5,
  volume: 1,
};

export const DEFAULT_VOICE_POST_PROCESS_CONFIG: VoicePostProcessConfig = {
  sttLlmCorrectionEnabled: false,
  ttsLlmRewriteEnabled: false,
  ttsSkipKeywords: [],
};

/**
 * Build default provider configs from the shared registry.
 * Each provider gets: enabled=false, empty apiKey, default baseUrl/apiFormat/models.
 * Providers with codingPlan support also get codingPlanEnabled=false.
 * The 'custom' provider is not in the registry and is hardcoded separately.
 */
const buildDefaultProviders = (): AppConfig['providers'] => {
  const providers: Record<string, AppProviderConfig> = {};

  for (const id of ProviderRegistry.providerIds) {
    const def = ProviderRegistry.get(id)!;
    providers[id] = {
      enabled: false,
      apiKey: '',
      baseUrl: def.defaultBaseUrl,
      apiFormat: def.defaultApiFormat,
      ...(def.codingPlanSupported ? { codingPlanEnabled: false } : {}),
      models: def.defaultModels.map(m => ({ ...m })),
    };
  }

  return providers as AppConfig['providers'];
};

// 默认配置
export const defaultConfig: AppConfig = {
  api: {
    key: '',
    baseUrl: 'https://api.deepseek.com/anthropic',
  },
  model: {
    availableModels: [
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', supportsImage: false },
    ],
    defaultModel: 'deepseek-reasoner',
    defaultModelProvider: 'deepseek',
  },
  providers: buildDefaultProviders(),
  theme: 'system',
  language: 'zh',
  useSystemProxy: false,
  browserWebAccess: defaultBrowserWebAccessConfig,
  app: {
    port: 3000,
    isDevelopment: process.env.NODE_ENV === 'development',
    testMode: process.env.NODE_ENV === 'development',
  },
  auth: DEFAULT_AUTH_CONFIG,
  shortcuts: {
    newChat: 'Ctrl+N',
    search: 'Ctrl+F',
    settings: 'Ctrl+,',
  },
  speechInput: DEFAULT_SPEECH_INPUT_CONFIG,
  wakeInput: DEFAULT_WAKE_INPUT_CONFIG,
  tts: DEFAULT_TTS_CONFIG,
  voice: {
    postProcess: DEFAULT_VOICE_POST_PROCESS_CONFIG,
  },
};

// 配置存储键
export const CONFIG_KEYS = {
  APP_CONFIG: 'app_config',
  AUTH: 'auth_state',
  CONVERSATIONS: 'conversations',
  PROVIDERS_EXPORT_KEY: 'providers_export_key',
  SKILLS: 'skills',
};

// Provider lists derived from ProviderRegistry — single source of truth
export const CHINA_PROVIDERS = [...ProviderRegistry.idsByRegion('china')] as const;
export const GLOBAL_PROVIDERS = ProviderRegistry.idsByRegion('global');

export const getVisibleProviders = (language: 'zh' | 'en'): readonly string[] => {
  if (language === 'zh') {
    return [...CHINA_PROVIDERS];
  }
  return ProviderRegistry.idsForEnLocale();
};

/**
 * 判断 provider key 是否为自定义提供商（custom_0, custom_1, ...）
 */
export const isCustomProvider = (key: string): boolean => key.startsWith('custom_');

/**
 * 从 custom_N key 中提取默认显示名称（如 custom_0 → "Custom0"）
 */
export const getCustomProviderDefaultName = (key: string): string => {
  const suffix = key.replace('custom_', '');
  return `Custom${suffix}`;
};

/**
 * 获取 provider 的显示名称，自定义 provider 优先使用 displayName，
 * 内置 provider 使用首字母大写的 key。
 */
export const getProviderDisplayName = (
  providerKey: string,
  providerConfig?: Record<string, unknown>,
): string => {
  if (isCustomProvider(providerKey)) {
    const name = providerConfig && typeof providerConfig.displayName === 'string'
      ? providerConfig.displayName
      : '';
    return name || getCustomProviderDefaultName(providerKey);
  }
  return ProviderRegistry.get(providerKey)?.label
    || providerKey.charAt(0).toUpperCase() + providerKey.slice(1);
};
