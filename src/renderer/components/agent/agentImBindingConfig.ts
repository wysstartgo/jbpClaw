import type { Platform } from '@shared/platform';
import { PlatformRegistry } from '@shared/platform';

import type {
  DingTalkInstanceConfig,
  DiscordInstanceConfig,
  FeishuInstanceConfig,
  IMGatewayConfig,
  IMPlatform,
  QQInstanceConfig,
  TelegramInstanceConfig,
  WecomInstanceConfig,
} from '../../types/im';

export type AgentImBindingPlatform = IMPlatform | Platform;
export const MultiInstanceAgentBindingPlatform = {
  DingTalk: 'dingtalk',
  Discord: 'discord',
  Feishu: 'feishu',
  QQ: 'qq',
  Telegram: 'telegram',
  Wecom: 'wecom',
} as const;
export type MultiInstanceAgentBindingPlatform =
  typeof MultiInstanceAgentBindingPlatform[keyof typeof MultiInstanceAgentBindingPlatform];

type MultiInstanceAgentBindingConfig =
  | DingTalkInstanceConfig
  | DiscordInstanceConfig
  | FeishuInstanceConfig
  | QQInstanceConfig
  | TelegramInstanceConfig
  | WecomInstanceConfig;
type AgentImBindingInstanceConfig = MultiInstanceAgentBindingConfig & {
  instanceId: string;
  instanceName: string;
  enabled?: boolean;
};

const MULTI_INSTANCE_AGENT_BINDING_PLATFORMS = new Set<Platform>(
  Object.values(MultiInstanceAgentBindingPlatform),
);

export const normalizeAgentImBindingPlatform = (
  platform: AgentImBindingPlatform | string,
): Platform | Exclude<IMPlatform, 'xiaomifeng'> => {
  if (platform === 'xiaomifeng') {
    return 'netease-bee';
  }
  return platform as Platform | Exclude<IMPlatform, 'xiaomifeng'>;
};

export const normalizeAgentImBindingKey = (bindingKey: string): string => {
  const normalizedBindingKey = bindingKey.trim();
  const separatorIndex = normalizedBindingKey.indexOf(':');
  if (separatorIndex === -1) {
    return normalizeAgentImBindingPlatform(normalizedBindingKey);
  }

  const platform = normalizedBindingKey.slice(0, separatorIndex).trim();
  const instanceId = normalizedBindingKey.slice(separatorIndex + 1).trim();
  return `${normalizeAgentImBindingPlatform(platform)}:${instanceId}`;
};

export const isMultiInstanceAgentBindingPlatform = (
  platform: AgentImBindingPlatform | string,
): platform is MultiInstanceAgentBindingPlatform => (
  MULTI_INSTANCE_AGENT_BINDING_PLATFORMS.has(
    normalizeAgentImBindingPlatform(platform) as Platform,
  )
);

const getMultiInstanceAgentBindingConfigs = (
  config: IMGatewayConfig | null,
  platform: MultiInstanceAgentBindingPlatform,
): MultiInstanceAgentBindingConfig[] => {
  if (!config) {
    return [];
  }

  if (platform === MultiInstanceAgentBindingPlatform.DingTalk) {
    return config.dingtalk.instances;
  }
  if (platform === MultiInstanceAgentBindingPlatform.Discord) {
    return config.discord.instances ?? [];
  }
  if (platform === MultiInstanceAgentBindingPlatform.Feishu) {
    return config.feishu.instances;
  }
  if (platform === MultiInstanceAgentBindingPlatform.QQ) {
    return config.qq.instances;
  }
  if (platform === MultiInstanceAgentBindingPlatform.Telegram) {
    return config.telegram.instances ?? [];
  }
  return config.wecom.instances;
};

const getAgentImBindingInstanceConfigs = (
  config: IMGatewayConfig | null,
  platform: AgentImBindingPlatform | string,
): AgentImBindingInstanceConfig[] => {
  if (!config) {
    return [];
  }

  const normalizedPlatform = normalizeAgentImBindingPlatform(platform);
  if (isMultiInstanceAgentBindingPlatform(normalizedPlatform)) {
    return getMultiInstanceAgentBindingConfigs(config, normalizedPlatform) as AgentImBindingInstanceConfig[];
  }

  const platformConfig = (
    config as unknown as Record<string, { instances?: unknown } | undefined>
  )[normalizedPlatform];
  if (!platformConfig || !Array.isArray(platformConfig.instances)) {
    return [];
  }

  return platformConfig.instances.filter((instance): instance is AgentImBindingInstanceConfig => (
    Boolean(
      instance
      && typeof instance === 'object'
      && typeof (instance as { instanceId?: unknown }).instanceId === 'string'
      && typeof (instance as { instanceName?: unknown }).instanceName === 'string',
    )
  ));
};

export const hasAgentImBindingInstanceConfigs = (
  config: IMGatewayConfig | null,
  platform: AgentImBindingPlatform | string,
): boolean => getAgentImBindingInstanceConfigs(config, platform).length > 0;

export const getAgentImBindingEnabledInstances = (
  config: IMGatewayConfig | null,
  platform: AgentImBindingPlatform | string,
): AgentImBindingInstanceConfig[] => (
  getAgentImBindingInstanceConfigs(config, platform).filter((instance) => instance.enabled)
);

export const isAgentImBindingPlatformConfigured = (
  config: IMGatewayConfig | null,
  platform: AgentImBindingPlatform,
): boolean => {
  if (!config) {
    return false;
  }

  const normalizedPlatform = normalizeAgentImBindingPlatform(platform);
  if (hasAgentImBindingInstanceConfigs(config, normalizedPlatform)) {
    return getAgentImBindingEnabledInstances(config, normalizedPlatform).length > 0;
  }

  return Boolean(
    (config as unknown as Record<string, { enabled?: boolean } | undefined>)[normalizedPlatform]?.enabled,
  );
};

export const collectAgentBoundBindingKeys = <TPlatform extends AgentImBindingPlatform>(
  bindings: Record<string, string> | undefined,
  agentId: string,
  visiblePlatforms?: readonly TPlatform[],
  config?: IMGatewayConfig | null,
): Set<string> => {
  const normalizedVisiblePlatforms = visiblePlatforms
    ? new Set(visiblePlatforms.map((platform) => normalizeAgentImBindingPlatform(platform)))
    : null;
  const enabledInstanceKeys = config
    ? new Set(
        Object.keys(config as unknown as Record<string, unknown>).flatMap((platform) => {
          const normalizedPlatform = normalizeAgentImBindingPlatform(platform);
          return getAgentImBindingEnabledInstances(config, normalizedPlatform).map(
            (instance) => `${normalizedPlatform}:${instance.instanceId}`,
          );
        }),
      )
    : null;

  const boundKeys = new Set<string>();
  for (const [bindingKey, boundAgentId] of Object.entries(bindings ?? {})) {
    if (boundAgentId !== agentId) {
      continue;
    }

    const normalizedBindingKey = normalizeAgentImBindingKey(bindingKey);
    const separatorIndex = normalizedBindingKey.indexOf(':');
    const normalizedPlatform = normalizeAgentImBindingPlatform(
      separatorIndex === -1
        ? normalizedBindingKey
        : normalizedBindingKey.slice(0, separatorIndex),
    );
    if (normalizedVisiblePlatforms && !normalizedVisiblePlatforms.has(normalizedPlatform)) {
      continue;
    }
    if (
      enabledInstanceKeys
      && separatorIndex !== -1
      && hasAgentImBindingInstanceConfigs(config ?? null, normalizedPlatform)
      && !enabledInstanceKeys.has(normalizedBindingKey)
    ) {
      continue;
    }

    boundKeys.add(normalizedBindingKey);
  }
  return boundKeys;
};

export const buildAgentBindingKeyBindings = (
  bindings: Record<string, string> | undefined,
  agentId: string,
  boundBindingKeys: Iterable<string>,
): Record<string, string> => {
  const nextBindings = { ...(bindings ?? {}) };
  for (const [bindingKey, boundAgentId] of Object.entries(nextBindings)) {
    if (boundAgentId === agentId) {
      delete nextBindings[bindingKey];
    }
  }

  for (const bindingKey of boundBindingKeys) {
    nextBindings[normalizeAgentImBindingKey(bindingKey)] = agentId;
  }
  return nextBindings;
};

export const getVisibleAgentImBindingPlatforms = (
  visiblePlatforms: readonly Platform[],
  config: IMGatewayConfig | null,
  bindings?: Record<string, string>,
): Platform[] => {
  const visible = new Set<Platform>(visiblePlatforms);
  for (const bindingKey of Object.keys(bindings ?? {})) {
    const normalizedKey = normalizeAgentImBindingKey(bindingKey);
    const platform = normalizeAgentImBindingPlatform(
      normalizedKey.includes(':') ? normalizedKey.slice(0, normalizedKey.indexOf(':')) : normalizedKey,
    );
    if (PlatformRegistry.platforms.includes(platform as Platform)) {
      visible.add(platform as Platform);
    }
  }

  for (const platform of PlatformRegistry.platforms) {
    if (visible.has(platform)) {
      continue;
    }
    if (isAgentImBindingPlatformConfigured(config, platform)) {
      visible.add(platform);
    }
  }

  return PlatformRegistry.platforms.filter((platform) => visible.has(platform));
};
