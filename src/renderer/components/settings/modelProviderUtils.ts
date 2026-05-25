import { OpenClawProviderId, ProviderName, ProviderRegistry } from '../../../shared/providers';
import { type AppConfig, defaultConfig } from '../../config';
import { i18nService } from '../../services/i18n';
import {
  buildOpenAICompatibleChatCompletionsUrl,
  buildOpenAIResponsesUrl,
  getEffectiveProviderApiFormat,
  shouldShowProviderApiFormatSelector,
  shouldUseMaxCompletionTokensForOpenAI,
  shouldUseOpenAIResponsesForProvider,
} from '../../services/providerRequestConfig';

export const CUSTOM_PROVIDER_KEYS = [
  'custom_0', 'custom_1', 'custom_2', 'custom_3', 'custom_4',
  'custom_5', 'custom_6', 'custom_7', 'custom_8', 'custom_9',
] as const;

export const providerKeys = [
  ...ProviderRegistry.providerIds,
  ...CUSTOM_PROVIDER_KEYS,
] as const;

export type ProviderType = (typeof providerKeys)[number];
export type ProvidersConfig = NonNullable<AppConfig['providers']>;
export type ProviderConfig = ProvidersConfig[string];
export type Model = NonNullable<ProviderConfig['models']>[number];

export const getEffectiveApiFormat = getEffectiveProviderApiFormat;
export const shouldShowApiFormatSelector = shouldShowProviderApiFormatSelector;
export {
  buildOpenAICompatibleChatCompletionsUrl,
  buildOpenAIResponsesUrl,
  shouldUseMaxCompletionTokensForOpenAI,
  shouldUseOpenAIResponsesForProvider,
};

export const providerRequiresApiKey = (provider: ProviderType): boolean => (
  provider !== ProviderName.Ollama
  && provider !== ProviderName.LmStudio
  && provider !== ProviderName.Copilot
);

export const hasProviderAuthConfigured = (provider: ProviderType, config: ProviderConfig): boolean => {
  if (provider === ProviderName.Ollama || provider === ProviderName.LmStudio) {
    return true;
  }

  if (provider === ProviderName.Minimax) {
    if (config.authType === 'apikey') {
      return config.apiKey.trim().length > 0;
    }
    return (config.oauthAccessToken?.trim().length ?? 0) > 0;
  }

  if (provider === ProviderName.OpenAI && config.authType === 'oauth') {
    return true;
  }

  return config.apiKey.trim().length > 0;
};

const normalizeBaseUrl = (baseUrl: string): string => baseUrl.trim().replace(/\/+$/, '').toLowerCase();

export const getProviderDefaultBaseUrl = (
  provider: ProviderType,
  apiFormat: 'anthropic' | 'openai' | 'gemini',
): string | null => {
  if (apiFormat === 'gemini') return null;
  return ProviderRegistry.getSwitchableBaseUrl(provider, apiFormat) ?? null;
};

export const shouldAutoSwitchProviderBaseUrl = (provider: ProviderType, currentBaseUrl: string): boolean => {
  const anthropicUrl = ProviderRegistry.getSwitchableBaseUrl(provider, 'anthropic');
  const openaiUrl = ProviderRegistry.getSwitchableBaseUrl(provider, 'openai');
  if (!anthropicUrl && !openaiUrl) {
    return false;
  }

  const normalizedCurrent = normalizeBaseUrl(currentBaseUrl);
  return (
    (anthropicUrl ? normalizedCurrent === normalizeBaseUrl(anthropicUrl) : false)
    || (openaiUrl ? normalizedCurrent === normalizeBaseUrl(openaiUrl) : false)
  );
};

export const resolveBaseUrl = (
  provider: ProviderType,
  baseUrl: string,
  apiFormat: 'anthropic' | 'openai' | 'gemini',
): string => {
  if (baseUrl.trim()) {
    if (shouldAutoSwitchProviderBaseUrl(provider, baseUrl) && (apiFormat === 'anthropic' || apiFormat === 'openai')) {
      const switchedUrl = ProviderRegistry.getSwitchableBaseUrl(provider, apiFormat);
      if (switchedUrl) return switchedUrl;
    }
    return baseUrl;
  }
  return getProviderDefaultBaseUrl(provider, apiFormat)
    || defaultConfig.providers?.[provider]?.baseUrl
    || '';
};

export const resolveModelSupportsImageForProvider = (
  providerName: string,
  model: { id: string; supportsImage?: boolean },
): boolean => ProviderRegistry.resolveModelSupportsImage(providerName, model.id, model.supportsImage);

export const getOpenClawProviderIdForConfig = (
  providerName: string,
  providerConfig: ProviderConfig,
): string => {
  if (providerName === ProviderName.OpenAI && providerConfig.authType === 'oauth') {
    return OpenClawProviderId.OpenAICodex;
  }
  return ProviderRegistry.getOpenClawProviderId(providerName);
};

export const getDefaultProviders = (): ProvidersConfig => {
  const providers = (defaultConfig.providers ?? {}) as ProvidersConfig;
  const entries = Object.entries(providers) as Array<[string, ProviderConfig]>;
  const secureSuffix = i18nService.t('modelSuffixSecure');
  return Object.fromEntries(
    entries.map(([providerKey, providerConfig]) => [
      providerKey,
      {
        ...providerConfig,
        models: providerConfig.models?.map(model => ({
          ...model,
          name: model.name.replace('(Secure)', secureSuffix),
          supportsImage: resolveModelSupportsImageForProvider(providerKey, model),
        })),
      },
    ]),
  ) as ProvidersConfig;
};

export const getDefaultActiveProvider = (): ProviderType => {
  const providers = (defaultConfig.providers ?? {}) as ProvidersConfig;
  const firstEnabledProvider = providerKeys.find(providerKey => providers[providerKey]?.enabled);
  return firstEnabledProvider ?? providerKeys[0];
};

export const CONNECTIVITY_TEST_TOKEN_BUDGET = 64;
