import { localStore } from './store';
import { getBrandRuntimeConfigUrl } from './endpoints';
import type { LanguageType } from './i18n';
import { DEFAULT_QTB_API_BASE_URL, DEFAULT_QTB_WEB_BASE_URL } from '../../common/auth';

export type LocalizedText = {
  zh: string;
  en: string;
};

export interface AgreementConfig {
  title: LocalizedText;
  descriptionTemplate: LocalizedText;
  linkText: LocalizedText;
  linkUrl: string;
  version: string;
  required: boolean;
}

export interface UpdateConfig {
  enabled: boolean;
  autoCheckUrl: string;
  manualCheckUrl: string;
  fallbackDownloadUrl: string;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  forceUpdate: boolean;
  minimumSupportedVersion: string;
  forceReason: LocalizedText;
}

export interface BrandRuntimeConfig {
  agreement: AgreementConfig;
  update: UpdateConfig;
}

export interface PrivacyAgreementAcceptance {
  version: string;
  agreedAt: number;
}

type MaybeLocalizedText = string | Partial<LocalizedText> | null | undefined;

type RuntimeConfigApiResponse = {
  code?: number;
  data?: {
    value?: unknown;
  };
};

export const BRAND_RUNTIME_CONFIG_CACHE_KEY = 'brand_runtime_config_cache';
export const PRIVACY_AGREEMENT_ACCEPTANCE_KEY = 'privacy_agreement_acceptance';

const DEFAULT_UPDATE_POLL_INTERVAL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_UPDATE_HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000;
const DEFAULT_FORCE_UPDATE_REASON: LocalizedText = {
  zh: '当前版本已停止支持，请先完成升级后再继续使用。',
  en: 'This version is no longer supported. Please update before continuing.',
};

const DEFAULT_BRAND_RUNTIME_CONFIG: BrandRuntimeConfig = {
  agreement: {
    title: {
      zh: '聚宝盆 JBPClaw 使用协议',
      en: 'JBP JBPClaw Usage Agreement',
    },
    descriptionTemplate: {
      zh: '在使用 JBPClaw 前，请阅读{link}并确认。JBPClaw 搭载于聚宝盆中台，仅在用户权限范围内访问聚宝盆数据。',
      en: 'Before using JBPClaw, please read {link} and confirm. JBPClaw runs on the JBP platform and only accesses JBP data within the current user permission scope.',
    },
    linkText: {
      zh: '《聚宝盆 JBPClaw 使用协议》',
      en: 'the JBP JBPClaw Usage Agreement',
    },
    linkUrl: `${DEFAULT_QTB_WEB_BASE_URL}/login/agreement`,
    version: 'v1',
    required: true,
  },
  update: {
    enabled: true,
    autoCheckUrl: `${DEFAULT_QTB_API_BASE_URL}/api/qingshu-claw/update-manifest`,
    manualCheckUrl: `${DEFAULT_QTB_API_BASE_URL}/api/qingshu-claw/update-manifest/manual`,
    fallbackDownloadUrl: `${DEFAULT_QTB_WEB_BASE_URL}/login/download`,
    pollIntervalMs: DEFAULT_UPDATE_POLL_INTERVAL_MS,
    heartbeatIntervalMs: DEFAULT_UPDATE_HEARTBEAT_INTERVAL_MS,
    forceUpdate: false,
    minimumSupportedVersion: '',
    forceReason: DEFAULT_FORCE_UPDATE_REASON,
  },
};

const toPositiveInteger = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
};

const normalizeLocalizedText = (
  value: MaybeLocalizedText,
  fallback: LocalizedText
): LocalizedText => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return fallback;
    }
    return {
      zh: trimmed,
      en: trimmed,
    };
  }

  if (!value || typeof value !== 'object') {
    return fallback;
  }

  return {
    zh: typeof value.zh === 'string' && value.zh.trim() ? value.zh.trim() : fallback.zh,
    en: typeof value.en === 'string' && value.en.trim() ? value.en.trim() : fallback.en,
  };
};

const normalizeAgreementConfig = (value: unknown): AgreementConfig => {
  const agreement = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    title: normalizeLocalizedText(agreement.title as MaybeLocalizedText, DEFAULT_BRAND_RUNTIME_CONFIG.agreement.title),
    descriptionTemplate: normalizeLocalizedText(
      agreement.descriptionTemplate as MaybeLocalizedText,
      DEFAULT_BRAND_RUNTIME_CONFIG.agreement.descriptionTemplate
    ),
    linkText: normalizeLocalizedText(
      agreement.linkText as MaybeLocalizedText,
      DEFAULT_BRAND_RUNTIME_CONFIG.agreement.linkText
    ),
    linkUrl: typeof agreement.linkUrl === 'string' && agreement.linkUrl.trim()
      ? agreement.linkUrl.trim()
      : DEFAULT_BRAND_RUNTIME_CONFIG.agreement.linkUrl,
    version: typeof agreement.version === 'string' && agreement.version.trim()
      ? agreement.version.trim()
      : DEFAULT_BRAND_RUNTIME_CONFIG.agreement.version,
    required: typeof agreement.required === 'boolean'
      ? agreement.required
      : DEFAULT_BRAND_RUNTIME_CONFIG.agreement.required,
  };
};

const normalizeUpdateConfig = (value: unknown): UpdateConfig => {
  const update = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const autoCheckUrl = typeof update.autoCheckUrl === 'string' && update.autoCheckUrl.trim()
    ? update.autoCheckUrl.trim()
    : DEFAULT_BRAND_RUNTIME_CONFIG.update.autoCheckUrl;
  const manualCheckUrl = typeof update.manualCheckUrl === 'string' && update.manualCheckUrl.trim()
    ? update.manualCheckUrl.trim()
    : autoCheckUrl;

  return {
    enabled: typeof update.enabled === 'boolean'
      ? update.enabled
      : DEFAULT_BRAND_RUNTIME_CONFIG.update.enabled,
    autoCheckUrl,
    manualCheckUrl,
    fallbackDownloadUrl: typeof update.fallbackDownloadUrl === 'string' && update.fallbackDownloadUrl.trim()
      ? update.fallbackDownloadUrl.trim()
      : DEFAULT_BRAND_RUNTIME_CONFIG.update.fallbackDownloadUrl,
    pollIntervalMs: toPositiveInteger(update.pollIntervalMs, DEFAULT_BRAND_RUNTIME_CONFIG.update.pollIntervalMs),
    heartbeatIntervalMs: toPositiveInteger(
      update.heartbeatIntervalMs,
      DEFAULT_BRAND_RUNTIME_CONFIG.update.heartbeatIntervalMs
    ),
    forceUpdate: typeof update.forceUpdate === 'boolean'
      ? update.forceUpdate
      : DEFAULT_BRAND_RUNTIME_CONFIG.update.forceUpdate,
    minimumSupportedVersion: typeof update.minimumSupportedVersion === 'string'
      ? update.minimumSupportedVersion.trim()
      : DEFAULT_BRAND_RUNTIME_CONFIG.update.minimumSupportedVersion,
    forceReason: normalizeLocalizedText(
      update.forceReason as MaybeLocalizedText,
      DEFAULT_BRAND_RUNTIME_CONFIG.update.forceReason
    ),
  };
};

const normalizeBrandRuntimeConfig = (value: unknown): BrandRuntimeConfig => {
  const config = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    agreement: normalizeAgreementConfig(config.agreement),
    update: normalizeUpdateConfig(config.update),
  };
};

const parseMaybeJson = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

const extractRuntimeConfigPayload = (payload: unknown): unknown => {
  const parsedPayload = parseMaybeJson(payload);
  if (!parsedPayload || typeof parsedPayload !== 'object') {
    return parsedPayload;
  }

  const wrapped = parsedPayload as RuntimeConfigApiResponse;
  if ('data' in wrapped) {
    return parseMaybeJson(wrapped.data?.value);
  }

  return parsedPayload;
};

export const getDefaultBrandRuntimeConfig = (): BrandRuntimeConfig => {
  return DEFAULT_BRAND_RUNTIME_CONFIG;
};

export const getCachedBrandRuntimeConfig = async (): Promise<BrandRuntimeConfig> => {
  const cached = await localStore.getItem<BrandRuntimeConfig>(BRAND_RUNTIME_CONFIG_CACHE_KEY);
  if (!cached) {
    return DEFAULT_BRAND_RUNTIME_CONFIG;
  }
  return normalizeBrandRuntimeConfig(cached);
};

export const refreshBrandRuntimeConfig = async (): Promise<BrandRuntimeConfig> => {
  const response = await window.electron.api.fetch({
    url: getBrandRuntimeConfigUrl(),
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Brand runtime config request failed: ${response.status}`);
  }

  const runtimeConfig = normalizeBrandRuntimeConfig(extractRuntimeConfigPayload(response.data));
  await localStore.setItem(BRAND_RUNTIME_CONFIG_CACHE_KEY, runtimeConfig);
  return runtimeConfig;
};

export const resolveLocalizedText = (
  value: LocalizedText,
  language: LanguageType
): string => {
  return language === 'en' ? value.en : value.zh;
};

export const getPrivacyAgreementAcceptance = async (): Promise<PrivacyAgreementAcceptance | null> => {
  return await localStore.getItem<PrivacyAgreementAcceptance>(PRIVACY_AGREEMENT_ACCEPTANCE_KEY);
};

export const savePrivacyAgreementAcceptance = async (version: string): Promise<PrivacyAgreementAcceptance> => {
  const acceptance: PrivacyAgreementAcceptance = {
    version,
    agreedAt: Date.now(),
  };
  await localStore.setItem(PRIVACY_AGREEMENT_ACCEPTANCE_KEY, acceptance);
  return acceptance;
};
