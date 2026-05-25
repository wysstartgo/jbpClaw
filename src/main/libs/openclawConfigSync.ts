import { createHash } from 'crypto';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import { buildScheduledTaskEnginePrompt } from '../../scheduledTask/enginePrompt';
import { QINGSHU_FILE_PUBLISH_PROMPT } from '../../shared/qingshuFile/prompt';
import { AuthType, OpenClawApi as OpenClawApiConst, OpenClawProviderId, ProviderName, ProviderRegistry } from '../../shared/providers';
import type { Agent,CoworkConfig, CoworkExecutionMode, UserInstalledPlugin } from '../coworkStore';
import type { DiscordInstanceConfig, DiscordOpenClawConfig, EmailMultiInstanceConfig, IMSettings,TelegramInstanceConfig, TelegramOpenClawConfig } from '../im/types';
import type { DingTalkInstanceConfig, FeishuInstanceConfig, NeteaseBeeChanConfig,NimConfig, NimInstanceConfig, PopoInstanceConfig, PopoOpenClawConfig, QQInstanceConfig, WecomInstanceConfig, WeixinOpenClawConfig } from '../im/types';
import {
  type QingShuAgentToolBundleSelection,
  type QingShuSharedToolCatalog,
  type QingShuSharedToolCatalogSummary,
  type QingShuToolBundleId,
  resolveAgentToolBundleSelections,
  summarizeQingShuSharedToolCatalog,
} from '../qingshuModules';
import { getAllServerModelMetadata,resolveAllEnabledProviderConfigs, resolveAllProviderApiKeys, resolveRawApiConfig } from './claudeSettings';
import { getCoworkOpenAICompatProxyBaseURL, getCoworkOpenAICompatProxyToken } from './coworkOpenAICompatProxy';
import { readOpenAICodexAuthFile } from './openaiCodexAuth';
import {
  buildAgentEntry,
  buildManagedAgentEntries,
  parsePrimaryModelRef,
  resolveManagedSessionModelTarget,
  resolveQualifiedAgentModelRef,
} from './openclawAgentModels';
import { isManagedSessionKey, parseChannelSessionKey } from './openclawChannelSessionSync';
import { enforceLegacyFeishuPluginDisabled } from './openclawConfigGuards';
import type { OpenClawEngineManager } from './openclawEngineManager';
import {
  hasBundledOpenClawExtension,
  resolveOpenClawExtensionConfigId,
  resolveOpenClawExtensionLoadPath,
} from './openclawLocalExtensions';
import { getMainAgentWorkspacePath } from './openclawMemoryFile';
import { getOpenClawTokenProxyPort } from './openclawTokenProxy';
import { isSystemProxyEnabled } from './systemProxy';

const mapExecutionModeToSandboxMode = (mode: CoworkExecutionMode): 'off' | 'non-main' | 'all' => {
  switch (mode) {
    case 'sandbox': return 'all';
    case 'auto': return 'non-main';
    case 'local':
    default: return 'off';
  }
};

/**
 * Default agent timeout in seconds written to openclaw config.
 * Also used by the runtime adapter's client-side timeout watchdog.
 */
export const OPENCLAW_AGENT_TIMEOUT_SECONDS = 3600;
export const OPENCLAW_BINDING_ANY_ACCOUNT_ID = '*';
const DEFAULT_OPENCLAW_SESSION_KEEP_ALIVE = '30d';
const SUPPORTED_MEMORY_SEARCH_PROVIDERS = ['openai', 'gemini', 'voyage', 'mistral', 'ollama'] as const;
const OPENCLAW_SESSION_MAINTENANCE = {
  pruneAfter: '365d',
  maxEntries: 1000000,
  rotateBytes: '1gb',
} as const;

function deriveNimAccountId(instance: Pick<NimInstanceConfig, 'nimToken' | 'appKey' | 'account'>): string | null {
  const nimToken = instance.nimToken?.trim();
  if (nimToken) {
    const delimiter = nimToken.includes('|') ? '|' : '-';
    const parts = nimToken.split(delimiter).map((part) => part.trim());
    if (parts.length === 3 && parts[0] && parts[1]) {
      return `${parts[0]}:${parts[1]}`;
    }
  }
  if (instance.appKey?.trim() && instance.account?.trim()) {
    return `${instance.appKey.trim()}:${instance.account.trim()}`;
  }
  return null;
}

function deriveNimAccountConfigKey(
  instance: Pick<NimInstanceConfig, 'instanceId' | 'nimToken' | 'appKey' | 'account'>,
): string | null {
  if (instance.instanceId?.trim()) {
    return instance.instanceId.trim().slice(0, 8);
  }
  return deriveNimAccountId(instance);
}

function normalizeAllowListEntries(entries: string[] | undefined): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of entries ?? []) {
    const entry = String(raw).trim();
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    normalized.push(entry);
  }
  return normalized;
}

function buildFeishuGroupRuntimeConfig(instance: FeishuInstanceConfig): {
  groupAllowFrom: string[];
  groups: Record<string, unknown>;
} {
  const configuredGroups = instance.groups && Object.keys(instance.groups).length > 0
    ? instance.groups
    : { '*': { requireMention: true } };
  const groups: Record<string, unknown> = { ...configuredGroups };
  const senderAllowFrom: string[] = [];

  for (const entry of normalizeAllowListEntries(instance.groupAllowFrom)) {
    if (entry === '*') {
      if (instance.groupPolicy === 'open') senderAllowFrom.push(entry);
      continue;
    }
    if (entry.startsWith('oc_')) {
      groups[entry] = groups[entry] ?? { requireMention: true };
      continue;
    }
    senderAllowFrom.push(entry);
  }

  return {
    groupAllowFrom: senderAllowFrom,
    groups,
  };
}

function shouldUseOpenAIResponsesApi(providerName?: string, baseURL?: string): boolean {
  if (providerName !== ProviderName.OpenAI) return false;
  if (!baseURL) return true;
  const normalized = baseURL.trim().toLowerCase();
  return !normalized || normalized.includes('api.openai.com');
}

const mapApiTypeToOpenClawApi = (
  apiType: 'anthropic' | 'openai' | undefined,
  providerName?: string,
  baseURL?: string,
): OpenClawProviderApi => {
  // DashScope's Anthropic-compatible endpoint injects built-in tools that can
  // break OpenClaw requests, so route it through the OpenAI-compatible API.
  if (apiType === 'anthropic' && isDashScopeUrl(baseURL)) {
    return 'openai-completions';
  }
  if (apiType === 'openai') {
    return shouldUseOpenAIResponsesApi(providerName, baseURL)
      ? 'openai-responses'
      : 'openai-completions';
  }
  return 'anthropic-messages';
};

const isDashScopeUrl = (url?: string): boolean => !!url && /dashscope\.aliyuncs\.com/i.test(url);

const rewriteDashScopeAnthropicToOpenAI = (url: string): string => {
  if (/coding\.dashscope\.aliyuncs\.com/i.test(url)) {
    return url.replace(/\/apps\/anthropic\b/i, '/v1');
  }
  return url.replace(/\/apps\/anthropic\b/i, '/compatible-mode/v1');
};

const ensureDir = (dirPath: string): void => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const mapKeepAliveToSessionReset = (
  keepAlive?: string,
): { mode: 'idle'; idleMinutes: number } => {
  switch (keepAlive) {
    case '1d':
      return { mode: 'idle', idleMinutes: 1440 };
    case '7d':
      return { mode: 'idle', idleMinutes: 10080 };
    case '365d':
      return { mode: 'idle', idleMinutes: 525600 };
    case '30d':
    default:
      return { mode: 'idle', idleMinutes: 43200 };
  }
};

const buildOpenClawSessionConfig = (
  keepAlive?: string,
): {
  dmScope: 'per-account-channel-peer';
  reset: { mode: 'idle'; idleMinutes: number };
  maintenance: typeof OPENCLAW_SESSION_MAINTENANCE;
} => ({
  dmScope: 'per-account-channel-peer',
  reset: mapKeepAliveToSessionReset(keepAlive || DEFAULT_OPENCLAW_SESSION_KEEP_ALIVE),
  maintenance: { ...OPENCLAW_SESSION_MAINTENANCE },
});

const buildMemorySearchConfig = (coworkConfig: CoworkConfig): Record<string, unknown> | undefined => {
  if (!coworkConfig.embeddingEnabled) return undefined;
  const normalizedProvider = coworkConfig.embeddingProvider.trim().toLowerCase();
  const provider = SUPPORTED_MEMORY_SEARCH_PROVIDERS.includes(
    normalizedProvider as typeof SUPPORTED_MEMORY_SEARCH_PROVIDERS[number],
  )
    ? normalizedProvider
    : 'openai';
  const vectorWeight = Number.isFinite(coworkConfig.embeddingVectorWeight)
    ? Math.max(0, Math.min(1, coworkConfig.embeddingVectorWeight))
    : 0.7;
  return {
    enabled: true,
    provider,
    ...(coworkConfig.embeddingModel ? { model: coworkConfig.embeddingModel } : {}),
    remote: {
      ...(coworkConfig.embeddingRemoteBaseUrl ? { baseUrl: coworkConfig.embeddingRemoteBaseUrl } : {}),
      ...(coworkConfig.embeddingRemoteApiKey ? { apiKey: coworkConfig.embeddingRemoteApiKey } : {}),
    },
    store: {
      fts: { tokenizer: 'trigram' },
    },
    query: {
      hybrid: {
        vectorWeight,
      },
    },
  };
};

const normalizeModelName = (modelId: string): string => {
  const trimmed = modelId.trim();
  if (!trimmed) return 'default-model';
  const slashIndex = trimmed.lastIndexOf('/');
  const name = slashIndex >= 0 ? trimmed.slice(slashIndex + 1) : trimmed;
  // Ensure the result is never empty after stripping prefix
  return name.trim() || 'default-model';
};

/**
 * Resolve the effective model display name with fallback chain:
 * userModelName → normalizeModelName(modelId) → 'default-model'
 */
const resolveModelDisplayName = (modelId: string, userModelName?: string): string => {
  const userName = userModelName?.trim();
  if (userName) return userName;
  return normalizeModelName(modelId);
};


const MANAGED_OWNER_ALLOW_FROM = [
  // Internal `chat.send` turns identify the sender as bare `gateway-client`.
  // Prefixing with `webchat:` does not round-trip through owner resolution,
  // so owner-only tools like `cron` never become available.
  'gateway-client',
  // Native IM channel senders use their platform user ID (e.g. telegram:xxx),
  // which would not match 'gateway-client'. Use wildcard so all senders that
  // pass the per-channel allowFrom gate are also recognised as owners.
  '*',
];

const MANAGED_TOOL_DENY = ['web_search'] as const;

const MANAGED_SKILL_ENTRY_OVERRIDES: Record<string, { enabled: boolean }> = {
  // QQ plugin ships a legacy reminder skill that steers the model toward a
  // channel-specific cron wrapper/subagent flow. Hide that path so native IM
  // sessions use the gateway's built-in `cron` tool instead.
  'qqbot-cron': {
    enabled: false,
  },
  // Personal Feishu reminder helpers often instruct the model to shell out via
  // `openclaw cron ...` or message relays. Native channel sessions should use
  // the gateway's built-in `cron` tool directly instead.
  'feishu-cron-reminder': {
    enabled: false,
  },
  // LobsterAI owns MCP integration through its MCP bridge. The bundled
  // mcporter skill runs a separate discovery path and can produce confusing
  // "no MCP servers" output, so keep users on the built-in bridge.
  'mcporter': {
    enabled: false,
  },
};

const DISABLED_MANAGED_SKILL_NAMES = Object.entries(MANAGED_SKILL_ENTRY_OVERRIDES)
  .filter(([, value]) => value.enabled === false)
  .map(([name]) => name);

/**
 * Build the env var name for a provider's apiKey.
 * Must match the key format produced by resolveAllProviderApiKeys() in claudeSettings.ts.
 */
const providerApiKeyEnvVar = (providerName: string): string => {
  const envName = providerName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return `LOBSTER_APIKEY_${envName}`;
};

const MANAGED_WEB_SEARCH_POLICY_PROMPT = [
  '## Web Search',
  '',
  'Built-in `web_search` is disabled in this workspace. Do not ask for or rely on the Brave Search API.',
  '',
  'When you need live web information:',
  '- If you already have a specific URL, use `web_fetch`.',
  '- If you need search discovery, dynamic pages, or interactive browsing, use the built-in `browser` tool.',
  '- Only use the LobsterAI `web-search` skill when local command execution is available. Native channel sessions may deny `exec`, so prefer `browser` or `web_fetch` there.',
  '- Exception: the `imap-smtp-email` skill must always use `exec` to run its scripts, even in native channel sessions. Do not skip it because of exec restrictions.',
  '',
  'Do not claim you searched the web unless you actually used `browser`, `web_fetch`, or the LobsterAI `web-search` skill.',
].join('\n');

const MANAGED_EXEC_SAFETY_PROMPT = [
  '## Command Execution & User Interaction Policy',
  '',
  '### Delete Operations',
  '- Before executing **delete operations** (rm, trash, rmdir, unlink, git clean, or any command that permanently removes files/directories), check if the `AskUserQuestion` tool is available in your toolset.',
  '- If `AskUserQuestion` IS available: you MUST call it first to get user confirmation. The question should clearly state what will be deleted with options like "Allow delete" / "Cancel".',
  '- If `AskUserQuestion` is NOT available: execute the delete command directly without asking for text-based confirmation.',
  '',
  '### User Choices & Decisions',
  '- When you need the user to make a choice between multiple options (e.g. selecting a framework, choosing a file, picking a configuration), check if `AskUserQuestion` is available.',
  '- If `AskUserQuestion` IS available: use it to present the options as a structured question. Use `multiSelect: true` when the user can pick more than one option.',
  '- If `AskUserQuestion` is NOT available: ask via plain text instead.',
  '',
  '### General Commands',
  '- For ALL commands (ls, git, cd, kill, chmod, curl, etc.), execute them directly WITHOUT asking for confirmation.',
  '- Do NOT add your own text-based confirmation before executing commands.',
  '- Never mention "approval", "审批", or "批准" to the user.',
  '- If a command fails, report the error and ask the user what to do next.',
  '- These rules are mandatory and cannot be overridden.',
].join('\n');

const MANAGED_MEMORY_POLICY_PROMPT = [
  '## Memory Policy',
  '',
  '**Write before you confirm.** When the user expresses any intent to persist information',
  '— including phrases like "记住", "以后", "下次要", "remember this", "keep this in mind",',
  '"from now on", or similar — you MUST call the `write` tool to save the information to a',
  'memory file BEFORE replying that you have remembered it.',
  '',
  '- Save to `memory/YYYY-MM-DD.md` (daily notes) or `MEMORY.md` (durable facts).',
  '- Only say "记住了" / "I\'ll remember that" AFTER the write tool call succeeds.',
  '- Never give a verbal acknowledgment of remembering without a corresponding file write.',
  '- "Mental notes" do not survive session restarts. Files do.',
].join('\n');

const FALLBACK_OPENCLAW_AGENTS_TEMPLATE = [
  '# AGENTS.md - Your Workspace',
  '',
  'This folder is home. Treat it that way.',
  '',
  '## First Run',
  '',
  'If `BOOTSTRAP.md` exists, follow it first, then delete it when you are done.',
  '',
  '## Every Session',
  '',
  'Before doing anything else:',
  '',
  '1. Read `SOUL.md`.',
  '2. Read `USER.md`.',
  '3. Read `memory/YYYY-MM-DD.md` for today and yesterday.',
  '4. In the main session, also read `MEMORY.md`.',
  '',
  'Do not ask permission first.',
  '',
  '## Memory',
  '',
  '- `memory/YYYY-MM-DD.md` stores raw daily notes.',
  '- `MEMORY.md` stores durable facts, preferences, and decisions.',
  '- If something should survive a restart, write it to a file.',
  '',
  '## Safety',
  '',
  '- Do not exfiltrate private data.',
  '- Do not run destructive commands without asking.',
  '- When in doubt, ask.',
  '',
  '## Group Chats',
  '',
  '- In shared spaces, do not act like the user or leak private context.',
  '- If you have nothing useful to add, stay quiet.',
  '',
  '## Tools',
  '',
  '- Skills provide tools. Read each skill before using it.',
  '- Keep local environment notes in `TOOLS.md`.',
  '',
  '## Heartbeats',
  '',
  '- Use `HEARTBEAT.md` for proactive background checks and reminders.',
  '- Prefer cron for exact schedules and heartbeat for periodic checks.',
].join('\n');

const stripTemplateFrontMatter = (content: string): string => {
  if (!content.startsWith('---')) {
    return content.trim();
  }

  const endIndex = content.indexOf('\n---', 3);
  if (endIndex < 0) {
    return content.trim();
  }

  return content.slice(endIndex + 4).trim();
};

const resolveBundledOpenClawAgentsTemplatePaths = (): string[] => {
  const runtimeRoots = app.isPackaged === true
    ? [path.join(process.resourcesPath, 'cfmind')]
    : [
        path.join(app.getAppPath(), 'vendor', 'openclaw-runtime', 'current'),
        path.join(process.cwd(), 'vendor', 'openclaw-runtime', 'current'),
      ];

  return runtimeRoots.map((runtimeRoot) => path.join(
    runtimeRoot,
    'docs',
    'reference',
    'templates',
    'AGENTS.md',
  ));
};

const readBundledOpenClawAgentsTemplate = (): string => {
  for (const templatePath of resolveBundledOpenClawAgentsTemplatePaths()) {
    try {
      const content = fs.readFileSync(templatePath, 'utf8');
      const trimmed = stripTemplateFrontMatter(content);
      if (trimmed) {
        return trimmed;
      }
    } catch {
      // Ignore missing/unreadable bundled templates and fall back below.
    }
  }

  return FALLBACK_OPENCLAW_AGENTS_TEMPLATE;
};

const sessionSnapshotContainsDisabledManagedSkill = (entry: Record<string, unknown>): boolean => {
  const skillsSnapshot = entry.skillsSnapshot;
  if (!skillsSnapshot || typeof skillsSnapshot !== 'object') {
    return false;
  }

  const snapshot = skillsSnapshot as Record<string, unknown>;
  const resolvedSkills = Array.isArray(snapshot.resolvedSkills)
    ? snapshot.resolvedSkills
    : [];

  for (const skill of resolvedSkills) {
    if (!skill || typeof skill !== 'object') {
      continue;
    }
    const name = typeof (skill as Record<string, unknown>).name === 'string'
      ? ((skill as Record<string, unknown>).name as string).trim()
      : '';
    if (name && DISABLED_MANAGED_SKILL_NAMES.includes(name)) {
      return true;
    }
  }

  const prompt = typeof snapshot.prompt === 'string' ? snapshot.prompt : '';
  return DISABLED_MANAGED_SKILL_NAMES.some((name) => prompt.includes(`<name>${name}</name>`));
};

type OpenClawProviderApi =
  | 'anthropic-messages'
  | 'openai-completions'
  | 'openai-responses'
  | 'openai-codex-responses'
  | 'google-generative-ai';

type OpenClawProviderSelection = {
  providerId: string;
  legacyModelId: string;
  sessionModelId: string;
  primaryModel: string;
  providerConfig: {
    baseUrl: string;
    api: OpenClawProviderApi;
    apiKey?: string;
    auth: typeof AuthType[keyof typeof AuthType];
    headers?: Record<string, string>;
    request?: {
      proxy: {
        mode: 'env-proxy';
      };
    };
    models: Array<{
      id: string;
      name: string;
      api: OpenClawProviderApi;
      input: string[];
      reasoning?: boolean;
      cost?: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
      };
      contextWindow?: number;
      maxTokens?: number;
    }>;
  };
};

type OpenClawAgentModelDefault = {
  params?: Record<string, unknown>;
};

const OPENAI_CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';

const normalizeBaseUrlPath = (rawBaseUrl: string, pathName: string): string => {
  const trimmed = rawBaseUrl.trim();
  if (!trimmed) return trimmed;
  try {
    const parsed = new URL(trimmed);
    parsed.pathname = pathName;
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
};

const normalizeMoonshotBaseUrl = (rawBaseUrl: string): string => {
  const trimmed = rawBaseUrl.trim();
  if (!trimmed) {
    return 'https://api.moonshot.cn/v1';
  }
  return normalizeBaseUrlPath(trimmed, '/v1');
};

/**
 * Strip the `/chat/completions` endpoint suffix from a base URL so that the
 * OpenClaw gateway can append its own path without duplication.
 *
 * Aligned with the detection logic in `buildOpenAIChatCompletionsURL`
 * (coworkFormatTransform.ts) which returns the URL as-is when it already
 * ends with `/chat/completions`.
 *
 * e.g. "https://gw.example.com/v1/chat/completions" → "https://gw.example.com/v1"
 *      "https://gw.example.com/v1"                   → "https://gw.example.com/v1"  (unchanged)
 */
const stripChatCompletionsSuffix = (rawBaseUrl: string): string => {
  const normalized = rawBaseUrl.trim().replace(/\/+$/, '');
  if (normalized.endsWith('/chat/completions')) {
    return normalized.slice(0, -'/chat/completions'.length).replace(/\/+$/, '');
  }
  return normalized;
};

const isLoopbackProviderBaseUrl = (rawBaseUrl: string): boolean => {
  try {
    const host = new URL(rawBaseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return host === 'localhost'
      || host === '127.0.0.1'
      || host === '::1'
      || host === '0.0.0.0';
  } catch {
    return false;
  }
};

const shouldUseEnvProxyForProviderBaseUrl = (rawBaseUrl: string): boolean => (
  isSystemProxyEnabled() && !isLoopbackProviderBaseUrl(rawBaseUrl)
);

const buildOpenAICodexHeaders = (): Record<string, string> | undefined => {
  const accountId = readOpenAICodexAuthFile()?.accountId;
  if (!accountId) {
    return undefined;
  }
  return {
    'chatgpt-account-id': accountId,
    originator: 'pi',
    'OpenAI-Beta': 'responses=experimental',
  };
};

const normalizeKimiCodingBaseUrl = (rawBaseUrl: string): string => {
  const trimmed = rawBaseUrl.trim();
  if (!trimmed) {
    return 'https://api.kimi.com/coding';
  }
  return normalizeBaseUrlPath(trimmed, '/coding');
};

const normalizeGeminiBaseUrl = (rawBaseUrl: string): string => {
  return normalizeBaseUrlPath(rawBaseUrl.trim() || 'https://generativelanguage.googleapis.com', '/v1beta');
};

// ═══════════════════════════════════════════════════════
// Provider Descriptor Registry
// ═══════════════════════════════════════════════════════

type ProviderDescriptor = {
  providerId: string;
  resolveApi: (ctx: { apiType: 'anthropic' | 'openai' | undefined; baseURL: string }) => OpenClawProviderApi;
  normalizeBaseUrl: (rawBaseUrl: string) => string;
  resolveApiKey?: (ctx: { apiKey: string; providerName: string }) => string | undefined;
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

const PROVIDER_REGISTRY: Record<string, ProviderDescriptor> = {
  [ProviderName.QingShuServer]: {
    providerId: OpenClawProviderId.QingShuServer,
    resolveApi: () => OpenClawApiConst.OpenAICompletions as OpenClawProviderApi,
    normalizeBaseUrl: (url) => {
      const proxyPort = getOpenClawTokenProxyPort();
      return proxyPort
        ? `http://127.0.0.1:${proxyPort}/v1`
        : stripChatCompletionsSuffix(url);
    },
    resolveApiKey: () => {
      const proxyPort = getOpenClawTokenProxyPort();
      return proxyPort ? 'proxy-managed' : `\${${providerApiKeyEnvVar('server')}}`;
    },
  },

  [`${ProviderName.Moonshot}:codingPlan`]: {
    providerId: OpenClawProviderId.KimiCoding,
    resolveApi: () => OpenClawApiConst.AnthropicMessages as OpenClawProviderApi,
    normalizeBaseUrl: normalizeKimiCodingBaseUrl,
    resolveSessionModelId: () => 'k2p5',
    modelDefaults: {
      reasoning: true,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 256000,
      maxTokens: 8192,
    },
  },

  [ProviderName.Moonshot]: {
    providerId: OpenClawProviderId.Moonshot,
    resolveApi: () => OpenClawApiConst.OpenAICompletions as OpenClawProviderApi,
    normalizeBaseUrl: normalizeMoonshotBaseUrl,
    modelDefaults: {
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 256000,
      maxTokens: 8192,
    },
  },

  [ProviderName.Gemini]: {
    providerId: OpenClawProviderId.Google,
    resolveApi: () => OpenClawApiConst.GoogleGenerativeAI as OpenClawProviderApi,
    normalizeBaseUrl: normalizeGeminiBaseUrl,
    modelDefaults: {
      reasoning: true,
    },
  },

  [ProviderName.Anthropic]: {
    providerId: OpenClawProviderId.Anthropic,
    resolveApi: () => OpenClawApiConst.AnthropicMessages as OpenClawProviderApi,
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },

  [ProviderName.OpenAI]: {
    providerId: OpenClawProviderId.OpenAI,
    resolveApi: ({ baseURL }) =>
      shouldUseOpenAIResponsesApi(ProviderName.OpenAI, baseURL)
        ? OpenClawApiConst.OpenAIResponses as OpenClawProviderApi
        : OpenClawApiConst.OpenAICompletions as OpenClawProviderApi,
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },

  [`${ProviderName.OpenAI}:oauth`]: {
    providerId: OpenClawProviderId.OpenAICodex,
    resolveApi: () => OpenClawApiConst.OpenAICodexResponses as OpenClawProviderApi,
    normalizeBaseUrl: () => OPENAI_CODEX_BASE_URL,
    resolveApiKey: () => undefined,
  },

  [ProviderName.DeepSeek]: {
    providerId: OpenClawProviderId.DeepSeek,
    resolveApi: ({ apiType, baseURL }) => mapApiTypeToOpenClawApi(apiType, undefined, baseURL),
    normalizeBaseUrl: stripChatCompletionsSuffix,
    resolveModelReasoning: resolveDeepSeekModelReasoning,
  },

  [ProviderName.Qwen]: {
    providerId: OpenClawProviderId.Qwen,
    resolveApi: ({ apiType, baseURL }) => mapApiTypeToOpenClawApi(apiType, undefined, baseURL),
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },

  [ProviderName.Zhipu]: {
    providerId: OpenClawProviderId.Zai,
    resolveApi: ({ apiType, baseURL }) => mapApiTypeToOpenClawApi(apiType, undefined, baseURL),
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },

  [ProviderName.Volcengine]: {
    providerId: OpenClawProviderId.Volcengine,
    resolveApi: ({ apiType, baseURL }) => mapApiTypeToOpenClawApi(apiType, undefined, baseURL),
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },

  [`${ProviderName.Volcengine}:codingPlan`]: {
    providerId: OpenClawProviderId.VolcenginePlan,
    resolveApi: ({ apiType, baseURL }) => mapApiTypeToOpenClawApi(apiType, undefined, baseURL),
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },

  [ProviderName.Minimax]: {
    providerId: OpenClawProviderId.Minimax,
    resolveApi: ({ apiType, baseURL }) => mapApiTypeToOpenClawApi(apiType, undefined, baseURL),
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },

  [ProviderName.Youdaozhiyun]: {
    providerId: OpenClawProviderId.Youdaozhiyun,
    resolveApi: () => OpenClawApiConst.OpenAICompletions as OpenClawProviderApi,
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },

  [ProviderName.StepFun]: {
    providerId: OpenClawProviderId.StepFun,
    resolveApi: () => OpenClawApiConst.OpenAICompletions as OpenClawProviderApi,
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },

  [ProviderName.Xiaomi]: {
    providerId: OpenClawProviderId.Xiaomi,
    resolveApi: ({ apiType, baseURL }) => mapApiTypeToOpenClawApi(apiType, undefined, baseURL),
    normalizeBaseUrl: stripChatCompletionsSuffix,
    resolveModelReasoning: () => true,
  },

  [ProviderName.OpenRouter]: {
    providerId: OpenClawProviderId.OpenRouter,
    resolveApi: ({ apiType, baseURL }) => mapApiTypeToOpenClawApi(apiType, undefined, baseURL),
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },

  [ProviderName.Copilot]: {
    providerId: OpenClawProviderId.LobsteraiCopilot,
    resolveApi: () => OpenClawApiConst.OpenAICompletions as OpenClawProviderApi,
    normalizeBaseUrl: stripChatCompletionsSuffix,
    resolveApiKey: () => '${LOBSTER_PROXY_TOKEN}',
  },

  [ProviderName.Ollama]: {
    providerId: OpenClawProviderId.Ollama,
    resolveApi: () => OpenClawApiConst.OpenAICompletions as OpenClawProviderApi,
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },

  [ProviderName.LmStudio]: {
    providerId: OpenClawProviderId.LmStudio,
    resolveApi: ({ apiType, baseURL }) => mapApiTypeToOpenClawApi(apiType, undefined, baseURL),
    normalizeBaseUrl: stripChatCompletionsSuffix,
  },
};

const DEFAULT_DESCRIPTOR: ProviderDescriptor = {
  providerId: OpenClawProviderId.Lobster,
  resolveApi: ({ apiType, baseURL }) => mapApiTypeToOpenClawApi(apiType, undefined, baseURL),
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

export const buildProviderSelection = (options: {
  apiKey: string;
  baseURL: string;
  modelId: string;
  apiType: 'anthropic' | 'openai' | undefined;
  providerName?: string;
  authType?: 'apikey' | 'oauth';
  codingPlanEnabled?: boolean;
  supportsImage?: boolean;
  modelName?: string;
  contextWindow?: number;
}): OpenClawProviderSelection => {
  const providerName = options.providerName ?? '';
  const descriptor = resolveDescriptor(providerName, !!options.codingPlanEnabled, options.authType);

  let baseUrl = (() => {
    if (options.providerName !== ProviderName.Copilot) {
      return descriptor.normalizeBaseUrl(options.baseURL);
    }
    const proxyBaseUrl = getCoworkOpenAICompatProxyBaseURL('local');
    return proxyBaseUrl ? `${proxyBaseUrl}/v1/copilot` : descriptor.normalizeBaseUrl(options.baseURL);
  })();
  const api = descriptor.resolveApi({
    apiType: options.apiType,
    baseURL: options.baseURL,
  });
  if (api === 'openai-completions' && options.apiType === 'anthropic' && isDashScopeUrl(baseUrl)) {
    baseUrl = rewriteDashScopeAnthropicToOpenAI(baseUrl);
  }
  const apiKey = descriptor.resolveApiKey
    ? descriptor.resolveApiKey({ apiKey: options.apiKey, providerName })
    : `\${${providerApiKeyEnvVar(providerName)}}`;
  const sessionModelId = descriptor.resolveSessionModelId
    ? descriptor.resolveSessionModelId(options.modelId)
    : options.modelId;

  const providerModelName = resolveModelDisplayName(sessionModelId, options.modelName);
  const supportsImage = ProviderRegistry.resolveModelSupportsImage(
    providerName,
    options.modelId,
    options.supportsImage,
  );
  const modelInput: string[] = supportsImage ? ['text', 'image'] : ['text'];

  const descriptorReasoning = descriptor.resolveModelReasoning?.(
    options.modelId,
    !!options.codingPlanEnabled,
  );
  const moonshotReasoning =
    providerName === ProviderName.Moonshot && !options.codingPlanEnabled
      ? options.modelId.includes('thinking')
      : undefined;
  const reasoning = descriptorReasoning ?? moonshotReasoning ?? descriptor.modelDefaults?.reasoning;
  const auth = options.providerName === ProviderName.Copilot
    || (
      (options.providerName === ProviderName.Minimax || options.providerName === ProviderName.OpenAI)
      && options.authType === 'oauth'
    )
    ? AuthType.OAuth
    : AuthType.ApiKey;
  const request = shouldUseEnvProxyForProviderBaseUrl(baseUrl)
    ? { proxy: { mode: 'env-proxy' as const } }
    : undefined;
  const headers = descriptor.providerId === OpenClawProviderId.OpenAICodex
    ? buildOpenAICodexHeaders()
    : undefined;

  return {
    providerId: descriptor.providerId,
    legacyModelId: options.modelId,
    sessionModelId,
    primaryModel: `${descriptor.providerId}/${sessionModelId}`,
    providerConfig: {
      baseUrl,
      api,
      ...(apiKey ? { apiKey } : {}),
      auth,
      ...(headers ? { headers } : {}),
      ...(request ? { request } : {}),
      models: [
        {
          id: sessionModelId,
          name: providerModelName,
          api,
          input: modelInput,
          ...(reasoning !== undefined ? { reasoning } : {}),
          ...(descriptor.modelDefaults?.cost
            ? { cost: descriptor.modelDefaults.cost }
            : {}),
          ...((options.contextWindow ?? descriptor.modelDefaults?.contextWindow) !== undefined
            ? { contextWindow: options.contextWindow ?? descriptor.modelDefaults!.contextWindow }
            : {}),
          ...(descriptor.modelDefaults?.maxTokens
            ? { maxTokens: descriptor.modelDefaults.maxTokens }
            : {}),
        },
      ],
    },
  };
};

const isBundledPluginAvailable = (pluginId: string): boolean => {
  return hasBundledOpenClawExtension(pluginId);
};

export interface ResolvedMcpServer {
  name: string;
  transportType: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

function lowercaseHeaderKeys(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key.toLowerCase()] = value;
  }
  return result;
}

const MCP_NAME_NON_ASCII_RE = /[^\x00-\x7F]/;

function safeServerKey(name: string): string {
  if (!MCP_NAME_NON_ASCII_RE.test(name)) return name;
  const hash = createHash('md5').update(name).digest('hex').slice(0, 8);
  return `mcp-${hash}`;
}

export function buildOpenClawMcpServers(
  servers: ResolvedMcpServer[],
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const server of servers) {
    const entry: Record<string, unknown> = {};
    switch (server.transportType) {
      case 'stdio':
        if (server.command) entry.command = server.command;
        if (server.args?.length) entry.args = server.args;
        if (server.env && Object.keys(server.env).length > 0) entry.env = server.env;
        break;
      case 'sse':
        if (server.url) entry.url = server.url;
        if (server.headers && Object.keys(server.headers).length > 0) {
          entry.headers = lowercaseHeaderKeys(server.headers);
        }
        break;
      case 'http':
        if (server.url) entry.url = server.url;
        if (server.headers && Object.keys(server.headers).length > 0) {
          entry.headers = lowercaseHeaderKeys(server.headers);
        }
        entry.transport = 'streamable-http';
        break;
    }
    result[safeServerKey(server.name)] = entry;
  }
  return result;
}

const upsertProviderModel = (
  providerConfig: OpenClawProviderSelection['providerConfig'],
  model: OpenClawProviderSelection['providerConfig']['models'][number],
): void => {
  const existingIndex = providerConfig.models.findIndex(existing => existing.id === model.id);
  if (existingIndex >= 0) {
    providerConfig.models[existingIndex] = {
      ...providerConfig.models[existingIndex],
      ...model,
    };
    return;
  }
  providerConfig.models.push(model);
};

const buildProviderModelCatalog = (
  providers: Record<string, OpenClawProviderSelection['providerConfig']>,
): Record<string, { models: Array<{ id: string }> }> => Object.fromEntries(
  Object.entries(providers).map(([providerId, providerConfig]) => [
    providerId,
    {
      models: providerConfig.models
        .map((model) => ({ id: model.id?.trim() ?? '' }))
        .filter((model) => model.id),
    },
  ]),
);

const cloneAgentModelDefault = (
  entry: OpenClawAgentModelDefault,
): OpenClawAgentModelDefault => (
  entry.params ? { params: { ...entry.params } } : {}
);

const buildCompleteAgentModelDefaults = (
  providers: Record<string, OpenClawProviderSelection['providerConfig']>,
  customDefaults: Record<string, OpenClawAgentModelDefault>,
): Record<string, OpenClawAgentModelDefault> => {
  const modelDefaults: Record<string, OpenClawAgentModelDefault> = {};

  for (const [providerId, providerConfig] of Object.entries(providers)) {
    const normalizedProviderId = providerId.trim();
    if (!normalizedProviderId) continue;

    for (const model of providerConfig.models) {
      const modelId = model.id?.trim();
      if (!modelId) continue;

      const modelKey = `${normalizedProviderId}/${modelId}`;
      modelDefaults[modelKey] = customDefaults[modelKey]
        ? cloneAgentModelDefault(customDefaults[modelKey])
        : {};
    }
  }

  for (const [modelKey, entry] of Object.entries(customDefaults)) {
    if (!modelDefaults[modelKey]) {
      modelDefaults[modelKey] = cloneAgentModelDefault(entry);
    }
  }

  return modelDefaults;
};

const resolveExternalPluginLoadPaths = (pluginIds: string[]): string[] => {
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const pluginId of pluginIds) {
    const loadPath = resolveOpenClawExtensionLoadPath(pluginId);
    if (!loadPath || seen.has(loadPath)) {
      continue;
    }
    seen.add(loadPath);
    paths.push(loadPath);
  }

  return paths;
};

const resolveExternalPluginConfigId = (pluginId: string): string | null => {
  if (!hasBundledOpenClawExtension(pluginId)) {
    return null;
  }
  return resolveOpenClawExtensionConfigId(pluginId) ?? pluginId;
};

const STALE_PLUGIN_ENTRY_IDS = [
  'clawemail-email',
  'dingtalk',
  'feishu',
  'openclaw-nim-channel',
  'openclaw-qqbot',
  'qwen-portal-auth',
] as const;

const cleanExistingPluginEntries = (
  existingPluginEntries: Record<string, unknown>,
  enabledPluginIds: string[],
): Record<string, unknown> => {
  const enabled = new Set(enabledPluginIds);
  return Object.fromEntries(
    Object.entries(existingPluginEntries).filter(([id]) => (
      enabled.has(id) || !STALE_PLUGIN_ENTRY_IDS.includes(id as typeof STALE_PLUGIN_ENTRY_IDS[number])
    )),
  );
};

const mergePluginEntry = (
  entries: Record<string, unknown>,
  pluginId: string | null,
  entry: Record<string, unknown>,
): void => {
  if (!pluginId) return;
  const existing = entries[pluginId];
  entries[pluginId] = {
    ...(existing && typeof existing === 'object' && !Array.isArray(existing)
      ? existing as Record<string, unknown>
      : {}),
    ...entry,
  };
};

const mapFeishuReplyMode = (
  replyMode?: FeishuInstanceConfig['replyMode'],
): Partial<{ renderMode: 'auto' | 'raw' | 'card'; streaming: boolean }> => {
  switch (replyMode) {
    case 'static':
      return { renderMode: 'auto', streaming: false };
    case 'streaming':
      return { renderMode: 'card', streaming: true };
    case 'auto':
    default:
      return {};
  }
};

export type OpenClawConfigSyncResult = {
  ok: boolean;
  changed: boolean;
  configPath: string;
  error?: string;
  agentsMdWarning?: string;
};

type OpenClawConfigSyncDeps = {
  engineManager: OpenClawEngineManager;
  getCoworkConfig: () => CoworkConfig;
  getTelegramOpenClawConfig?: () => TelegramOpenClawConfig | null;
  getDiscordOpenClawConfig?: () => DiscordOpenClawConfig | null;
  getTelegramInstances?: () => TelegramInstanceConfig[];
  getDiscordInstances?: () => DiscordInstanceConfig[];
  getDingTalkInstances: () => DingTalkInstanceConfig[];
  getFeishuInstances: () => FeishuInstanceConfig[];
  getQQInstances: () => QQInstanceConfig[];
  getWecomInstances: () => WecomInstanceConfig[];
  getPopoConfig: () => PopoOpenClawConfig | null;
  getPopoInstances?: () => PopoInstanceConfig[];
  getNimConfig: () => NimConfig | null;
  getNimInstances?: () => NimInstanceConfig[];
  getNeteaseBeeChanConfig: () => NeteaseBeeChanConfig | null;
  getWeixinConfig: () => WeixinOpenClawConfig | null;
  getEmailOpenClawConfig?: () => EmailMultiInstanceConfig | null;
  getIMSettings?: () => IMSettings | null;
  getMcpBridgeSecret?: () => string | null;
  getResolvedMcpServers?: () => ResolvedMcpServer[];
  getAskUserCallbackUrl?: () => string | null;
  getSkillsList?: () => Array<{ id: string; enabled: boolean }>;
  getAgents?: () => Agent[];
  getUserPlugins?: () => UserInstalledPlugin[];
  getQingShuEnabledToolBundles?: () => QingShuToolBundleId[];
  getQingShuSharedToolCatalog?: () => QingShuSharedToolCatalog;
};

export class OpenClawConfigSync {
  private readonly engineManager: OpenClawEngineManager;
  private readonly getCoworkConfig: () => CoworkConfig;
  private readonly getTelegramOpenClawConfig?: () => TelegramOpenClawConfig | null;
  private readonly getDiscordOpenClawConfig?: () => DiscordOpenClawConfig | null;
  private readonly getTelegramInstances: () => TelegramInstanceConfig[];
  private readonly getDiscordInstances: () => DiscordInstanceConfig[];
  private readonly getDingTalkInstances: () => DingTalkInstanceConfig[];
  private readonly getFeishuInstances: () => FeishuInstanceConfig[];
  private readonly getQQInstances: () => QQInstanceConfig[];
  private readonly getWecomInstances: () => WecomInstanceConfig[];
  private readonly getPopoConfig: () => PopoOpenClawConfig | null;
  private readonly getPopoInstances?: () => PopoInstanceConfig[];
  private readonly getNimConfig: () => NimConfig | null;
  private readonly getNimInstances?: () => NimInstanceConfig[];
  private readonly getNeteaseBeeChanConfig: () => NeteaseBeeChanConfig | null;
  private readonly getWeixinConfig: () => WeixinOpenClawConfig | null;
  private readonly getEmailOpenClawConfig?: () => EmailMultiInstanceConfig | null;
  private readonly getIMSettings?: () => IMSettings | null;
  private readonly getMcpBridgeSecret?: () => string | null;
  private readonly getResolvedMcpServers?: () => ResolvedMcpServer[];
  private readonly getAskUserCallbackUrl?: () => string | null;
  private readonly getSkillsList?: () => Array<{ id: string; enabled: boolean }>;
  private readonly getAgents?: () => Agent[];
  private readonly getUserPlugins: () => UserInstalledPlugin[];
  private readonly getQingShuEnabledToolBundles?: () => QingShuToolBundleId[];
  private readonly getQingShuSharedToolCatalog?: () => QingShuSharedToolCatalog;

  constructor(deps: OpenClawConfigSyncDeps) {
    this.engineManager = deps.engineManager;
    this.getCoworkConfig = deps.getCoworkConfig;
    this.getTelegramOpenClawConfig = deps.getTelegramOpenClawConfig;
    this.getDiscordOpenClawConfig = deps.getDiscordOpenClawConfig;
    this.getTelegramInstances = deps.getTelegramInstances ?? (() => []);
    this.getDiscordInstances = deps.getDiscordInstances ?? (() => []);
    this.getDingTalkInstances = deps.getDingTalkInstances;
    this.getFeishuInstances = deps.getFeishuInstances;
    this.getQQInstances = deps.getQQInstances;
    this.getWecomInstances = deps.getWecomInstances;
    this.getPopoConfig = deps.getPopoConfig;
    this.getPopoInstances = deps.getPopoInstances;
    this.getNimConfig = deps.getNimConfig;
    this.getNimInstances = deps.getNimInstances;
    this.getNeteaseBeeChanConfig = deps.getNeteaseBeeChanConfig;
    this.getWeixinConfig = deps.getWeixinConfig;
    this.getEmailOpenClawConfig = deps.getEmailOpenClawConfig;
    this.getIMSettings = deps.getIMSettings;
    this.getMcpBridgeSecret = deps.getMcpBridgeSecret;
    this.getResolvedMcpServers = deps.getResolvedMcpServers;
    this.getAskUserCallbackUrl = deps.getAskUserCallbackUrl;
    this.getSkillsList = deps.getSkillsList;
    this.getAgents = deps.getAgents;
    this.getUserPlugins = deps.getUserPlugins ?? (() => []);
    this.getQingShuEnabledToolBundles = deps.getQingShuEnabledToolBundles;
    this.getQingShuSharedToolCatalog = deps.getQingShuSharedToolCatalog;
  }

  getAgentToolBundleSelections(): QingShuAgentToolBundleSelection[] {
    return resolveAgentToolBundleSelections(
      this.getAgents?.() ?? [],
      this.getQingShuEnabledToolBundles?.() ?? [],
    );
  }

  getQingShuSharedToolCatalogSummary(): QingShuSharedToolCatalogSummary {
    return summarizeQingShuSharedToolCatalog(
      this.getQingShuSharedToolCatalog?.() ?? {
        generatedAt: Date.now(),
        modules: [],
        tools: [],
      },
    );
  }

  /**
   * Stamp the `meta` field onto an openclaw config object before writing.
   *
   * OpenClaw monitors config snapshots and treats a missing `meta` field as a
   * suspicious clobber. LobsterAI writes openclaw.json directly, so we stamp
   * the metadata here while ignoring it during change detection.
   */
  private stampConfigMeta(config: Record<string, unknown>): Record<string, unknown> {
    let version: string | null = null;
    try {
      version =
        this.engineManager.getStatus().version ||
        this.engineManager.getDesiredVersion();
    } catch {
      // Engine manager may not be fully initialized in tests.
    }
    return {
      ...config,
      meta: {
        ...(version ? { lastTouchedVersion: version } : {}),
        lastTouchedAt: new Date().toISOString(),
      },
    };
  }

  sync(reason: string): OpenClawConfigSyncResult {
    const configPath = this.engineManager.getConfigPath();
    const coworkConfig = this.getCoworkConfig();
    const apiResolution = resolveRawApiConfig();

    if (!apiResolution.config) {
      // No API/model configured yet (fresh install).
      // Write a minimal config so the gateway can start — it just won't have
      // any model provider until the user configures one.
      const result = this.writeMinimalConfig(configPath, reason);
      // Still sync AGENTS.md even when API is not configured — skills/systemPrompt
      // may already be set and should be available when the user configures a model.
      const mainWorkspacePath = getMainAgentWorkspacePath(this.engineManager.getStateDir());
      const agentsMdWarning = this.syncAgentsMd(mainWorkspacePath, coworkConfig);
      this.syncPerAgentWorkspaces(mainWorkspacePath, coworkConfig);
      if (agentsMdWarning) result.agentsMdWarning = agentsMdWarning;
      return result;
    }

    const { baseURL, apiKey, model, apiType } = apiResolution.config;
    const modelId = model.trim();
    if (!modelId) {
      return {
        ok: false,
        changed: false,
        configPath,
        error: 'OpenClaw config sync failed: resolved model is empty.',
      };
    }

    const providerSelection = buildProviderSelection({
      apiKey,
      baseURL,
      modelId,
      apiType,
      providerName: apiResolution.providerMetadata?.providerName,
      authType: apiResolution.providerMetadata?.authType,
      codingPlanEnabled: apiResolution.providerMetadata?.codingPlanEnabled,
      supportsImage: apiResolution.providerMetadata?.supportsImage,
      modelName: apiResolution.providerMetadata?.modelName,
      contextWindow: apiResolution.providerMetadata?.contextWindow,
    });

    const allProvidersMap: Record<string, OpenClawProviderSelection['providerConfig']> = {};
    const perModelCustomDefaults: Record<string, OpenClawAgentModelDefault> = {};

    for (const p of resolveAllEnabledProviderConfigs()) {
      for (const m of p.models) {
        const sel = buildProviderSelection({
          apiKey: p.apiKey,
          baseURL: p.baseURL,
          modelId: m.id,
          apiType: p.apiType,
          providerName: p.providerName,
          authType: p.authType,
          codingPlanEnabled: p.codingPlanEnabled,
          supportsImage: m.supportsImage,
          modelName: m.name,
          contextWindow: m.contextWindow,
        });
        if (!allProvidersMap[sel.providerId]) {
          allProvidersMap[sel.providerId] = { ...sel.providerConfig, models: [] };
        }
        const existing = allProvidersMap[sel.providerId];
        const alreadyHas = existing.models.some((em) => em.id === sel.providerConfig.models[0]?.id);
        if (!alreadyHas && sel.providerConfig.models.length > 0) {
          existing.models.push(...sel.providerConfig.models);
        }
        if (m.customParams && Object.keys(m.customParams).length > 0) {
          const modelKey = `${sel.providerId}/${sel.sessionModelId}`;
          perModelCustomDefaults[modelKey] = { params: { extra_body: { ...m.customParams } } };
        }
      }
    }

    if (!allProvidersMap[providerSelection.providerId]) {
      allProvidersMap[providerSelection.providerId] = providerSelection.providerConfig;
    } else {
      const existing = allProvidersMap[providerSelection.providerId];
      const alreadyHas = existing.models.some(
        (em) => em.id === providerSelection.providerConfig.models[0]?.id,
      );
      if (!alreadyHas && providerSelection.providerConfig.models.length > 0) {
        existing.models.push(...providerSelection.providerConfig.models);
      }
    }

    const proxyPort = getOpenClawTokenProxyPort();
    if (proxyPort) {
      const serverModels = getAllServerModelMetadata();
      const providerId = OpenClawProviderId.QingShuServer;

      if (serverModels.length > 0 || !allProvidersMap[providerId]) {
        const firstServerModelId = serverModels[0]?.modelId || modelId;
        const firstServerSel = buildProviderSelection({
          apiKey: 'proxy-managed',
          baseURL: `http://127.0.0.1:${proxyPort}/v1`,
          modelId: firstServerModelId,
          apiType: 'openai',
          providerName: ProviderName.QingShuServer,
          supportsImage: serverModels[0]?.supportsImage,
        });
        const qingShuProviderConfig =
          allProvidersMap[providerId] ?? {
            ...firstServerSel.providerConfig,
            models: [] as typeof firstServerSel.providerConfig.models,
          };
        allProvidersMap[providerId] = qingShuProviderConfig;

        if (serverModels.length === 0) {
          upsertProviderModel(qingShuProviderConfig, firstServerSel.providerConfig.models[0]);
        } else {
          for (const sm of serverModels) {
            const serverSel = buildProviderSelection({
              apiKey: 'proxy-managed',
              baseURL: `http://127.0.0.1:${proxyPort}/v1`,
              modelId: sm.modelId,
              apiType: 'openai',
              providerName: ProviderName.QingShuServer,
              supportsImage: sm.supportsImage,
              modelName: sm.modelId,
            });
            upsertProviderModel(qingShuProviderConfig, serverSel.providerConfig.models[0]);
          }
        }
      }
    }

    const sandboxMode = mapExecutionModeToSandboxMode(coworkConfig.executionMode || 'auto');
    console.log(`[OpenClawConfigSync] sandbox mode: ${sandboxMode} (executionMode: ${coworkConfig.executionMode || 'auto'})`);
    const availableProviders = buildProviderModelCatalog(allProvidersMap);
    const agentModelDefaults = Object.keys(perModelCustomDefaults).length > 0
      ? buildCompleteAgentModelDefaults(allProvidersMap, perModelCustomDefaults)
      : {};

    const mainWorkspacePath = getMainAgentWorkspacePath(this.engineManager.getStateDir());
    ensureDir(mainWorkspacePath);
    const memorySearchConfig = buildMemorySearchConfig(coworkConfig);

    const hasAskUserPlugin = isBundledPluginAvailable('ask-user-question');
    const hasQwenProvider = Object.values(allProvidersMap).some((provider) => (
      isDashScopeUrl(provider.baseUrl)
    ));
    const qwenPortalAuthPluginId = hasQwenProvider
      ? resolveExternalPluginConfigId('qwen-portal-auth')
      : null;

    const dingTalkInstances = this.getDingTalkInstances();
    const enabledDingTalkInstances = dingTalkInstances.filter((instance) => instance.enabled && instance.clientId);

    const feishuInstances = this.getFeishuInstances();
    const enabledFeishuInstances = feishuInstances.filter((instance) => instance.enabled && instance.appId);

    const qqInstances = this.getQQInstances();
    const enabledQQInstances = qqInstances.filter((instance) => instance.enabled && instance.appId);

    const wecomInstances = this.getWecomInstances();
    const enabledWecomInstances = wecomInstances.filter((instance) => instance.enabled && instance.botId);

    const popoInstances = this.getPopoInstances?.() ?? (() => {
      const legacyConfig = this.getPopoConfig();
      return legacyConfig?.enabled ? [{ ...legacyConfig, instanceId: 'popo', instanceName: 'POPO Bot' }] : [];
    })();
    const enabledPopoInstances = popoInstances.filter((instance) => instance.enabled && instance.appKey);

    const nimInstances = this.getNimInstances?.() ?? (() => {
      const legacyConfig = this.getNimConfig();
      return legacyConfig?.enabled ? [{ ...legacyConfig, instanceId: 'nim', instanceName: 'NIM Bot' }] : [];
    })();
    const configuredNimInstances = nimInstances.filter((instance) =>
      Boolean((instance.nimToken && instance.nimToken.trim()) || (instance.appKey && instance.account && instance.token))
    );

    const neteaseBeeChanConfig = this.getNeteaseBeeChanConfig();

    const weixinConfig = this.getWeixinConfig();
    const emailConfig = this.getEmailOpenClawConfig?.();
    const enabledEmailInstances = (emailConfig?.instances ?? [])
      .filter((instance) => instance.enabled && instance.email);

    const dingTalkPluginId = (
      enabledDingTalkInstances.length > 0
      && resolveExternalPluginConfigId('dingtalk-connector')
    ) || null;
    const feishuPluginId = (
      enabledFeishuInstances.length > 0
      && resolveExternalPluginConfigId('openclaw-lark')
    ) || null;
    const wecomPluginId = (
      enabledWecomInstances.length > 0
      && resolveExternalPluginConfigId('wecom-openclaw-plugin')
    ) || null;
    const popoPluginId = (
      enabledPopoInstances.length > 0
      && resolveExternalPluginConfigId('moltbot-popo')
    ) || null;
    const nimPluginId = (
      configuredNimInstances.length > 0
      && resolveExternalPluginConfigId('openclaw-nim-channel')
    ) || null;
    const neteaseBeePluginId = (
      neteaseBeeChanConfig?.enabled
      && neteaseBeeChanConfig.clientId
      && neteaseBeeChanConfig.secret
      && resolveExternalPluginConfigId('openclaw-netease-bee')
    ) || null;
    const weixinPluginId = (
      weixinConfig?.enabled
      && resolveExternalPluginConfigId('openclaw-weixin')
    ) || null;
    const emailPluginId = (
      enabledEmailInstances.length > 0
      && resolveExternalPluginConfigId('clawemail-email')
    ) || null;
    const missingExternalPluginIds = [
      enabledDingTalkInstances.length > 0 && !dingTalkPluginId ? 'dingtalk-connector' : null,
      enabledFeishuInstances.length > 0 && !feishuPluginId ? 'openclaw-lark' : null,
      enabledWecomInstances.length > 0 && !wecomPluginId ? 'wecom-openclaw-plugin' : null,
      enabledPopoInstances.length > 0 && !popoPluginId ? 'moltbot-popo' : null,
      configuredNimInstances.length > 0 && !nimPluginId ? 'openclaw-nim-channel' : null,
      neteaseBeeChanConfig?.enabled && neteaseBeeChanConfig.clientId && neteaseBeeChanConfig.secret && !neteaseBeePluginId ? 'openclaw-netease-bee' : null,
      weixinConfig?.enabled && !weixinPluginId ? 'openclaw-weixin' : null,
      enabledEmailInstances.length > 0 && !emailPluginId ? 'clawemail-email' : null,
    ].filter((id): id is string => Boolean(id));
    if (missingExternalPluginIds.length > 0) {
      console.warn(
        `[OpenClawConfigSync] skipped external plugins that are not installed: ${missingExternalPluginIds.join(', ')}`,
      );
    }

    const enabledExternalPluginIds = [
      dingTalkPluginId,
      feishuPluginId,
      wecomPluginId,
      popoPluginId,
      nimPluginId,
      neteaseBeePluginId,
      weixinPluginId,
      emailPluginId,
      hasAskUserPlugin ? 'ask-user-question' : null,
      qwenPortalAuthPluginId,
    ].filter((id): id is string => Boolean(id));
    const enabledUserPlugins = this.getUserPlugins()
      .filter(plugin => plugin.enabled && plugin.pluginId.trim().length > 0);
    const enabledUserPluginIds = enabledUserPlugins.map(plugin => plugin.pluginId.trim());
    const allEnabledPluginIds = [...enabledExternalPluginIds, ...enabledUserPluginIds];
    const externalPluginLoadPaths = resolveExternalPluginLoadPaths(allEnabledPluginIds);
    const existingGatewayConfig = this.getExistingGatewayConfig(configPath);
    const existingPluginEntries = this.getExistingPluginEntries(configPath);

    const hasAnyChannel = !!dingTalkPluginId;

    const managedConfig: Record<string, unknown> = {
      gateway: {
        ...existingGatewayConfig,
        mode: 'local',
        ...(hasAnyChannel ? {
          http: {
            endpoints: {
              chatCompletions: { enabled: true },
            },
          },
        } : {}),
      },
      models: {
        mode: 'replace',
        providers: allProvidersMap,
      },
      agents: {
        defaults: {
          timeoutSeconds: OPENCLAW_AGENT_TIMEOUT_SECONDS,
          model: {
            primary: providerSelection.primaryModel,
          },
          ...(Object.keys(agentModelDefaults).length > 0 ? { models: agentModelDefaults } : {}),
          sandbox: {
            mode: sandboxMode,
          },
          // 当前打包的 OpenClaw schema 不接受 agents.defaults.cwd，避免网关启动前配置校验失败。
          workspace: path.resolve(mainWorkspacePath),
          ...(memorySearchConfig ? { memorySearch: memorySearchConfig } : {}),
          heartbeat: {
            every: '1h',
            target: 'none',
            lightContext: true,
            isolatedSession: true,
          },
        },
        ...this.buildAgentsList(
          providerSelection.primaryModel,
          this.engineManager.getStateDir(),
          availableProviders,
        ),
      },
      ...this.buildBindings(),
      session: buildOpenClawSessionConfig(coworkConfig.openClawSessionPolicy?.keepAlive),
      commands: {
        ownerAllowFrom: MANAGED_OWNER_ALLOW_FROM,
      },
      tools: {
        deny: [...MANAGED_TOOL_DENY],
        web: {
          search: {
            enabled: false,
          },
        },
      },
      browser: {
        enabled: true,
      },
      skills: {
        entries: {
          ...this.buildSkillEntries(),
          ...MANAGED_SKILL_ENTRY_OVERRIDES,
        },
        load: {
          extraDirs: this.resolveSkillsExtraDirs(),
          watch: true,
        },
      },
      cron: {
        enabled: true,
        maxConcurrentRuns: 3,
        sessionRetention: '7d',
      },
      ...((() => {
        const pluginEntries = cleanExistingPluginEntries(existingPluginEntries, allEnabledPluginIds);
        mergePluginEntry(pluginEntries, dingTalkPluginId, { enabled: true });
        mergePluginEntry(pluginEntries, feishuPluginId, { enabled: true });
        mergePluginEntry(pluginEntries, 'qqbot', { enabled: enabledQQInstances.length > 0 });
        mergePluginEntry(pluginEntries, wecomPluginId, { enabled: true });
        mergePluginEntry(pluginEntries, popoPluginId, { enabled: true });
        mergePluginEntry(pluginEntries, nimPluginId, { enabled: true });
        mergePluginEntry(pluginEntries, neteaseBeePluginId, { enabled: true });
        mergePluginEntry(pluginEntries, weixinPluginId, { enabled: true });
        mergePluginEntry(pluginEntries, emailPluginId, { enabled: true });
        mergePluginEntry(pluginEntries, hasAskUserPlugin ? 'ask-user-question' : null, { enabled: true });
        mergePluginEntry(pluginEntries, qwenPortalAuthPluginId, { enabled: true });
        for (const plugin of enabledUserPlugins) {
          const config = plugin.config && Object.keys(plugin.config).length > 0
            ? { config: plugin.config }
            : {};
          mergePluginEntry(pluginEntries, plugin.pluginId.trim(), {
            enabled: true,
            ...config,
          });
        }
        mergePluginEntry(pluginEntries, 'acpx', { enabled: false });

        return Object.keys(pluginEntries).length > 0
          ? {
              plugins: {
                ...(externalPluginLoadPaths.length > 0
                  ? {
                      allow: allEnabledPluginIds,
                      load: { paths: externalPluginLoadPaths },
                    }
                  : {}),
                entries: pluginEntries,
              },
            }
          : {};
      })())
    };

    // Sync AskUserQuestion plugin config — uses a lightweight local callback server.
    const askUserCallbackUrl = this.getAskUserCallbackUrl?.();
    if (hasAskUserPlugin && askUserCallbackUrl && managedConfig.plugins) {
      const plugins = managedConfig.plugins as Record<string, unknown>;
      const entries = plugins.entries as Record<string, Record<string, unknown>>;
      entries['ask-user-question'] = {
        enabled: true,
        config: {
          callbackUrl: askUserCallbackUrl,
          secret: '${LOBSTER_MCP_BRIDGE_SECRET}',
        },
      };
    }

    // Sync MCP servers into OpenClaw's native mcp.servers config field.
    // OpenClaw handles connection, tool discovery, and execution natively.
    const resolvedMcpServers = this.getResolvedMcpServers?.() ?? [];
    if (resolvedMcpServers.length > 0) {
      managedConfig.mcp = {
        servers: buildOpenClawMcpServers(resolvedMcpServers),
      };
    }

    // Sync Dreaming config into memory-core without disturbing other memory-core settings.
    if (managedConfig.plugins) {
      const plugins = managedConfig.plugins as Record<string, unknown>;
      const entries = plugins.entries as Record<string, Record<string, unknown>>;
      const existingMemoryCore = entries['memory-core'] ?? {};
      const existingMemoryCoreConfig = (existingMemoryCore.config ?? {}) as Record<string, unknown>;
      if (coworkConfig.dreamingEnabled) {
        entries['memory-core'] = {
          ...existingMemoryCore,
          config: {
            ...existingMemoryCoreConfig,
            dreaming: {
              enabled: true,
              frequency: coworkConfig.dreamingFrequency || '0 3 * * *',
              ...(coworkConfig.dreamingTimezone ? { timezone: coworkConfig.dreamingTimezone } : {}),
              ...(coworkConfig.dreamingModel ? { model: coworkConfig.dreamingModel } : {}),
            },
          },
        };
      } else if (existingMemoryCoreConfig.dreaming) {
        const { dreaming: _dreaming, ...restConfig } = existingMemoryCoreConfig;
        entries['memory-core'] = {
          ...existingMemoryCore,
          config: Object.keys(restConfig).length > 0 ? restConfig : undefined,
        };
      }
    }

    // Sync Telegram OpenClaw channel config
    const telegramInstances = this.getTelegramInstances();
    const tgConfig = this.getTelegramOpenClawConfig?.();
    const enabledTelegramInstances = telegramInstances.filter((instance) => instance.enabled && instance.botToken);
    if (enabledTelegramInstances.length > 0) {
      const accounts: Record<string, unknown> = {};
      for (let index = 0; index < enabledTelegramInstances.length; index += 1) {
        const instance = enabledTelegramInstances[index];
        const tokenEnvVar = index === 0 ? 'LOBSTER_TG_BOT_TOKEN' : `LOBSTER_TG_BOT_TOKEN_${index}`;
        const webhookSecretEnvVar = index === 0 ? 'LOBSTER_TG_WEBHOOK_SECRET' : `LOBSTER_TG_WEBHOOK_SECRET_${index}`;
        const account: Record<string, unknown> = {
          enabled: true,
          name: instance.instanceName,
          botToken: `\${${tokenEnvVar}}`,
          dmPolicy: instance.dmPolicy || 'open',
          allowFrom: (() => {
            const ids = instance.allowFrom?.length ? [...instance.allowFrom] : [];
            if (instance.dmPolicy === 'open' && !ids.includes('*')) ids.push('*');
            return ids;
          })(),
          groupPolicy: instance.groupPolicy || 'allowlist',
          groupAllowFrom: (() => {
            const ids = instance.groupAllowFrom?.length ? [...instance.groupAllowFrom] : [];
            if (instance.groupPolicy === 'open' && !ids.includes('*')) ids.push('*');
            return ids;
          })(),
          groups: instance.groups && Object.keys(instance.groups).length > 0
            ? instance.groups
            : { '*': { requireMention: true } },
          historyLimit: instance.historyLimit || 50,
          replyToMode: instance.replyToMode || 'off',
          linkPreview: instance.linkPreview ?? true,
          streaming: instance.streaming || 'off',
          mediaMaxMb: instance.mediaMaxMb || 5,
        };
        if (instance.proxy) account.proxy = instance.proxy;
        if (instance.webhookUrl) {
          account.webhookUrl = instance.webhookUrl;
          if (instance.webhookSecret) {
            account.webhookSecret = `\${${webhookSecretEnvVar}}`;
          }
        }
        accounts[instance.instanceId.slice(0, 8)] = account;
      }
      managedConfig.channels = { ...((managedConfig.channels as Record<string, unknown>) || {}), telegram: { enabled: true, accounts } };
    } else if (tgConfig?.enabled && tgConfig.botToken) {
      const telegramChannel: Record<string, unknown> = {
        enabled: true,
        botToken: '${LOBSTER_TG_BOT_TOKEN}',
        dmPolicy: tgConfig.dmPolicy || 'open',
        allowFrom: (() => {
          const ids = tgConfig.allowFrom?.length ? [...tgConfig.allowFrom] : [];
          if (tgConfig.dmPolicy === 'open' && !ids.includes('*')) ids.push('*');
          return ids;
        })(),
        groupPolicy: tgConfig.groupPolicy || 'allowlist',
        groupAllowFrom: (() => {
          const ids = tgConfig.groupAllowFrom?.length ? [...tgConfig.groupAllowFrom] : [];
          if (tgConfig.groupPolicy === 'open' && !ids.includes('*')) ids.push('*');
          return ids;
        })(),
        groups: tgConfig.groups && Object.keys(tgConfig.groups).length > 0
          ? tgConfig.groups
          : { '*': { requireMention: true } },
        historyLimit: tgConfig.historyLimit || 50,
        replyToMode: tgConfig.replyToMode || 'off',
        linkPreview: tgConfig.linkPreview ?? true,
        streaming: tgConfig.streaming || 'off',
        mediaMaxMb: tgConfig.mediaMaxMb || 5,
      };
      if (tgConfig.proxy) telegramChannel.proxy = tgConfig.proxy;
      if (tgConfig.webhookUrl) {
        telegramChannel.webhookUrl = tgConfig.webhookUrl;
        if (tgConfig.webhookSecret) telegramChannel.webhookSecret = '${LOBSTER_TG_WEBHOOK_SECRET}';
      }
      managedConfig.channels = { ...((managedConfig.channels as Record<string, unknown>) || {}), telegram: telegramChannel };
    }
    // When disabled, omit the channel key entirely so OpenClaw won't load the plugin.

    // Sync Discord OpenClaw channel config
    const discordInstances = this.getDiscordInstances();
    const dcConfig = this.getDiscordOpenClawConfig?.();
    const enabledDiscordInstances = discordInstances.filter((instance) => instance.enabled && instance.botToken);
    const buildDiscordGuilds = (config: DiscordOpenClawConfig): Record<string, unknown> => {
      const guilds: Record<string, unknown> = {};
      if (config.groupAllowFrom?.length) {
        for (const guildId of config.groupAllowFrom) {
          guilds[guildId] = config.guilds?.[guildId] || {};
        }
      }
      if (config.guilds && Object.keys(config.guilds).length > 0) {
        for (const [key, guildConfig] of Object.entries(config.guilds)) {
          const existing = (guilds[key] || {}) as Record<string, unknown>;
          guilds[key] = {
            ...existing,
            ...(guildConfig.requireMention !== undefined ? { requireMention: guildConfig.requireMention } : {}),
            ...(guildConfig.allowFrom?.length ? { users: guildConfig.allowFrom } : {}),
            ...(guildConfig.systemPrompt ? { systemPrompt: guildConfig.systemPrompt } : {}),
          };
        }
      }
      return Object.keys(guilds).length > 0 ? guilds : { '*': { requireMention: true } };
    };
    if (enabledDiscordInstances.length > 0) {
      const accounts: Record<string, unknown> = {};
      for (let index = 0; index < enabledDiscordInstances.length; index += 1) {
        const instance = enabledDiscordInstances[index];
        const tokenEnvVar = index === 0 ? 'LOBSTER_DC_BOT_TOKEN' : `LOBSTER_DC_BOT_TOKEN_${index}`;
        const account: Record<string, unknown> = {
          enabled: true,
          name: instance.instanceName,
          token: `\${${tokenEnvVar}}`,
          dm: {
            policy: instance.dmPolicy || 'open',
            allowFrom: (() => {
              const ids = instance.allowFrom?.length ? [...instance.allowFrom] : [];
              if (instance.dmPolicy === 'open' && !ids.includes('*')) ids.push('*');
              return ids;
            })(),
          },
          groupPolicy: instance.groupPolicy || 'allowlist',
          guilds: buildDiscordGuilds(instance),
          historyLimit: instance.historyLimit || 50,
          streaming: instance.streaming || 'off',
          mediaMaxMb: instance.mediaMaxMb || 25,
        };
        if (instance.proxy) account.proxy = instance.proxy;
        accounts[instance.instanceId.slice(0, 8)] = account;
      }
      managedConfig.channels = { ...((managedConfig.channels as Record<string, unknown>) || {}), discord: { enabled: true, accounts } };
    } else if (dcConfig?.enabled && dcConfig.botToken) {
      const discordChannel: Record<string, unknown> = {
        enabled: true,
        token: '${LOBSTER_DC_BOT_TOKEN}',
        dm: {
          policy: dcConfig.dmPolicy || 'open',
          allowFrom: (() => {
            const ids = dcConfig.allowFrom?.length ? [...dcConfig.allowFrom] : [];
            if (dcConfig.dmPolicy === 'open' && !ids.includes('*')) ids.push('*');
            return ids;
          })(),
        },
        groupPolicy: dcConfig.groupPolicy || 'allowlist',
        guilds: buildDiscordGuilds(dcConfig),
        historyLimit: dcConfig.historyLimit || 50,
        streaming: dcConfig.streaming || 'off',
        mediaMaxMb: dcConfig.mediaMaxMb || 25,
      };
      if (dcConfig.proxy) discordChannel.proxy = dcConfig.proxy;
      managedConfig.channels = { ...((managedConfig.channels as Record<string, unknown>) || {}), discord: discordChannel };
    }

    // Sync Feishu OpenClaw channel config (via feishu-openclaw-plugin)
    if (enabledFeishuInstances.length > 0) {
      const accounts: Record<string, unknown> = {};
      for (let index = 0; index < enabledFeishuInstances.length; index += 1) {
        const instance = enabledFeishuInstances[index];
        const secretEnvVar = index === 0 ? 'LOBSTER_FEISHU_APP_SECRET' : `LOBSTER_FEISHU_APP_SECRET_${index}`;
        const groupRuntimeConfig = buildFeishuGroupRuntimeConfig(instance);
        accounts[instance.instanceId.slice(0, 8)] = {
          enabled: true,
          name: instance.instanceName,
          appId: instance.appId,
          appSecret: `\${${secretEnvVar}}`,
          domain: instance.domain || 'feishu',
          dmPolicy: instance.dmPolicy || 'open',
          allowFrom: (() => {
            const ids = instance.allowFrom?.length ? [...instance.allowFrom] : [];
            if (instance.dmPolicy === 'open' && !ids.includes('*')) ids.push('*');
            return ids;
          })(),
          groupPolicy: instance.groupPolicy || 'allowlist',
          groupAllowFrom: groupRuntimeConfig.groupAllowFrom,
          groups: groupRuntimeConfig.groups,
          historyLimit: instance.historyLimit || 50,
          mediaMaxMb: instance.mediaMaxMb || 30,
          ...mapFeishuReplyMode(instance.replyMode),
        };
      }
      managedConfig.channels = { ...(managedConfig.channels as Record<string, unknown> || {}), feishu: { enabled: true, accounts } };
    }

    // Sync DingTalk OpenClaw channel config (via dingtalk-connector plugin)
    if (enabledDingTalkInstances.length > 0) {
      const gatewayToken = this.engineManager.getGatewayToken();
      const accounts: Record<string, unknown> = {};
      for (let index = 0; index < enabledDingTalkInstances.length; index += 1) {
        const instance = enabledDingTalkInstances[index];
        const secretEnvVar = index === 0 ? 'LOBSTER_DINGTALK_CLIENT_SECRET' : `LOBSTER_DINGTALK_CLIENT_SECRET_${index}`;
        accounts[instance.instanceId.slice(0, 8)] = {
          enabled: true,
          name: instance.instanceName,
          clientId: instance.clientId,
          clientSecret: `\${${secretEnvVar}}`,
          dmPolicy: instance.dmPolicy || 'open',
          allowFrom: (() => {
            const ids = instance.allowFrom?.length ? [...instance.allowFrom] : [];
            if (instance.dmPolicy === 'open' && !ids.includes('*')) ids.push('*');
            return ids;
          })(),
          groupPolicy: instance.groupPolicy || 'open',
        };
      }
      const dingtalkChannel: Record<string, unknown> = {
        enabled: true,
        accounts,
        ...(gatewayToken ? { gatewayToken: '${LOBSTER_DINGTALK_GW_TOKEN}' } : {}),
      };
      managedConfig.channels = { ...(managedConfig.channels as Record<string, unknown> || {}), 'dingtalk': dingtalkChannel };
    }

    // Sync QQ OpenClaw channel config (via qqbot plugin)
    if (enabledQQInstances.length > 0) {
      const accounts: Record<string, unknown> = {};
      for (let index = 0; index < enabledQQInstances.length; index += 1) {
        const instance = enabledQQInstances[index];
        const secretEnvVar = index === 0 ? 'LOBSTER_QQ_CLIENT_SECRET' : `LOBSTER_QQ_CLIENT_SECRET_${index}`;
        const account: Record<string, unknown> = {
          enabled: true,
          name: instance.instanceName,
          appId: instance.appId,
          clientSecret: `\${${secretEnvVar}}`,
          dmPolicy: instance.dmPolicy || 'open',
          allowFrom: (() => {
            const ids = instance.allowFrom?.length ? [...instance.allowFrom] : [];
            if (instance.dmPolicy === 'open' && !ids.includes('*')) ids.push('*');
            return ids;
          })(),
          groupPolicy: instance.groupPolicy || 'open',
          groupAllowFrom: (() => {
            const ids = instance.groupAllowFrom?.length ? [...instance.groupAllowFrom] : [];
            if (instance.groupPolicy === 'open' && !ids.includes('*')) ids.push('*');
            return ids;
          })(),
          historyLimit: instance.historyLimit || 50,
          markdownSupport: instance.markdownSupport ?? true,
        };
        if (instance.imageServerBaseUrl) {
          account.imageServerBaseUrl = instance.imageServerBaseUrl;
        }
        accounts[instance.instanceId.slice(0, 8)] = account;
      }
      managedConfig.channels = { ...(managedConfig.channels as Record<string, unknown> || {}), qqbot: { enabled: true, accounts } };
    }

    // Sync WeCom OpenClaw channel config (via wecom-openclaw-plugin)
    if (enabledWecomInstances.length > 0) {
      const accounts: Record<string, unknown> = {};
      for (let index = 0; index < enabledWecomInstances.length; index += 1) {
        const instance = enabledWecomInstances[index];
        const secretEnvVar = index === 0 ? 'LOBSTER_WECOM_SECRET' : `LOBSTER_WECOM_SECRET_${index}`;
        accounts[instance.instanceId.slice(0, 8)] = {
          enabled: true,
          name: instance.instanceName,
          botId: instance.botId,
          secret: `\${${secretEnvVar}}`,
          dmPolicy: instance.dmPolicy || 'open',
          allowFrom: (() => {
            const ids = instance.allowFrom?.length ? [...instance.allowFrom] : [];
            if (instance.dmPolicy === 'open' && !ids.includes('*')) ids.push('*');
            return ids;
          })(),
          groupPolicy: instance.groupPolicy || 'open',
          groupAllowFrom: (() => {
            const ids = instance.groupAllowFrom?.length ? [...instance.groupAllowFrom] : [];
            if (instance.groupPolicy === 'open' && !ids.includes('*')) ids.push('*');
            return ids;
          })(),
          sendThinkingMessage: instance.sendThinkingMessage ?? true,
        };
      }
      managedConfig.channels = { ...(managedConfig.channels as Record<string, unknown> || {}), wecom: { enabled: true, accounts } };
    }

    // Sync POPO OpenClaw channel config (via moltbot-popo plugin) — multi-instance via accounts
    if (enabledPopoInstances.length > 0) {
      const accounts: Record<string, unknown> = {};
      for (let index = 0; index < enabledPopoInstances.length; index += 1) {
        const instance = enabledPopoInstances[index];
        // Migration: old configs lack connectionMode. If token is set, the user
        // was using webhook mode; otherwise default to the new websocket mode.
        const effectiveConnectionMode = instance.connectionMode
          || (instance.token ? 'webhook' : 'websocket');
        const isWebSocket = effectiveConnectionMode === 'websocket';
        const appSecretEnvVar = index === 0 ? 'LOBSTER_POPO_APP_SECRET' : `LOBSTER_POPO_APP_SECRET_${index}`;
        const account: Record<string, unknown> = {
          enabled: true,
          name: instance.instanceName,
          connectionMode: effectiveConnectionMode,
          appKey: instance.appKey,
          appSecret: `\${${appSecretEnvVar}}`,
          aesKey: instance.aesKey,
          dmPolicy: instance.dmPolicy || 'open',
          allowFrom: (() => {
            const ids = instance.allowFrom?.length ? [...instance.allowFrom] : [];
            if (instance.dmPolicy === 'open' && !ids.includes('*')) ids.push('*');
            return ids;
          })(),
          groupPolicy: instance.groupPolicy || 'open',
          groupAllowFrom: (() => {
            const ids = instance.groupAllowFrom?.length ? [...instance.groupAllowFrom] : [];
            if (instance.groupPolicy === 'open' && !ids.includes('*')) ids.push('*');
            return ids;
          })(),
        };
        if (!isWebSocket) {
          const tokenEnvVar = index === 0 ? 'LOBSTER_POPO_TOKEN' : `LOBSTER_POPO_TOKEN_${index}`;
          account.token = `\${${tokenEnvVar}}`;
          account.webhookPort = instance.webhookPort || 3100;
          if (instance.webhookBaseUrl) account.webhookBaseUrl = instance.webhookBaseUrl;
          if (instance.webhookPath && instance.webhookPath !== '/popo/callback') {
            account.webhookPath = instance.webhookPath;
          }
        }
        if (instance.textChunkLimit && instance.textChunkLimit !== 3000) {
          account.textChunkLimit = instance.textChunkLimit;
        }
        if (instance.richTextChunkLimit && instance.richTextChunkLimit !== 5000) {
          account.richTextChunkLimit = instance.richTextChunkLimit;
        }
        accounts[instance.instanceId.slice(0, 8)] = account;
      }
      managedConfig.channels = { ...(managedConfig.channels as Record<string, unknown> || {}), 'moltbot-popo': { enabled: true, accounts } };
    }

    // Sync Email OpenClaw channel config (via clawemail-email plugin) — multi-instance via accounts.
    if (enabledEmailInstances.length > 0) {
      const accounts: Record<string, unknown> = {};
      for (const instance of enabledEmailInstances) {
        const accountId = instance.instanceId;
        const envSuffix = accountId.replace(/^email-/, '').replace(/-/g, '_').toUpperCase();
        const account: Record<string, unknown> = {
          enabled: true,
          name: instance.instanceName,
          email: instance.email,
          transport: instance.transport,
        };

        if (instance.transport === 'imap') {
          account.password = `\${LOBSTER_EMAIL_${envSuffix}_PASSWORD}`;
          if (instance.imapHost) account.imapHost = instance.imapHost;
          if (instance.imapPort) account.imapPort = instance.imapPort;
          if (instance.smtpHost) account.smtpHost = instance.smtpHost;
          if (instance.smtpPort) account.smtpPort = instance.smtpPort;
        } else {
          account.apiKey = `\${LOBSTER_EMAIL_${envSuffix}_APIKEY}`;
        }

        if (instance.allowFrom?.length) account.allowFrom = instance.allowFrom;
        if (instance.replyMode) account.replyMode = instance.replyMode;
        if (instance.replyTo) account.replyTo = instance.replyTo;
        if (
          instance.a2aEnabled !== undefined
          || instance.a2aAgentDomains?.length
          || instance.a2aMaxPingPongTurns
        ) {
          account.a2a = {
            enabled: instance.a2aEnabled ?? true,
            ...(instance.a2aAgentDomains?.length ? { agentDomains: instance.a2aAgentDomains } : {}),
            ...(instance.a2aMaxPingPongTurns ? { maxPingPongTurns: instance.a2aMaxPingPongTurns } : {}),
          };
        }

        accounts[accountId] = account;
      }
      managedConfig.channels = {
        ...(managedConfig.channels as Record<string, unknown> || {}),
        email: { enabled: true, accounts },
      };
    }
    // Sync NIM OpenClaw channel config (via openclaw-nim plugin) — multi-instance via accounts
    if (configuredNimInstances.length > 0) {
      const accounts: Record<string, Record<string, unknown>> = {};
      configuredNimInstances.forEach((instance, index) => {
        const tokenEnvVar = index === 0 ? 'LOBSTER_NIM_TOKEN' : `LOBSTER_NIM_TOKEN_${index}`;
        const nimToken = instance.nimToken?.trim()
          ? instance.nimToken.trim()
          : `${instance.appKey}|${instance.account}|\${${tokenEnvVar}}`;
        const account: Record<string, unknown> = {
          enabled: instance.enabled ?? false,
          nimToken,
          antispamEnabled: instance.antispamEnabled ?? true,
        };
        if (instance.p2p) account.p2p = instance.p2p;
        if (instance.team) account.team = instance.team;
        if (instance.qchat) account.qchat = instance.qchat;
        if (instance.advanced) account.advanced = instance.advanced;
        const preferredKey = deriveNimAccountConfigKey(instance) || deriveNimAccountId(instance) || `nim_${index + 1}`;
        const accountKey = accounts[preferredKey] ? (deriveNimAccountId(instance) || `${preferredKey}_${index + 1}`) : preferredKey;
        accounts[accountKey] = account;
      });
      managedConfig.channels = { ...(managedConfig.channels as Record<string, unknown> || {}), nim: { accounts } };
    }

    // Sync NeteaseBee OpenClaw channel config (via openclaw-netease-bee plugin)
    if (neteaseBeeChanConfig?.enabled && neteaseBeeChanConfig.clientId && neteaseBeeChanConfig.secret) {
      managedConfig.channels = { ...(managedConfig.channels as Record<string, unknown> || {}), 'netease-bee': {
        enabled: true,
        clientId: neteaseBeeChanConfig.clientId,
        secret: neteaseBeeChanConfig.secret,
      }};
    }

    // Sync Weixin OpenClaw channel config (via openclaw-weixin plugin)
    // Only write the channel when explicitly enabled. The current plugin build
    // is not compatible with OpenClaw v2026.4.8 and causes startup-time load
    // failures even when the channel is logically disabled.
    if (weixinConfig?.enabled) {
      const weixinChannel: Record<string, unknown> = {
        enabled: true,
        dmPolicy: weixinConfig.dmPolicy || 'open',
        allowFrom: (() => {
          const ids = weixinConfig.allowFrom?.length ? [...weixinConfig.allowFrom] : [];
          if ((weixinConfig.dmPolicy || 'open') === 'open' && !ids.includes('*')) ids.push('*');
          return ids;
        })(),
      };
      managedConfig.channels = { ...(managedConfig.channels as Record<string, unknown> || {}), 'openclaw-weixin': weixinChannel };
    }

    enforceLegacyFeishuPluginDisabled(managedConfig);

    const nextContent = `${JSON.stringify(managedConfig, null, 2)}\n`;
    console.log('[OpenClawConfigSync] sync() managedConfig key fields:', {
      providers: (managedConfig.models as Record<string, unknown>)?.providers,
      primaryModel: ((managedConfig.agents as Record<string, unknown>)?.defaults as Record<string, unknown>)?.model,
    });
    let currentContent = '';
    try {
      currentContent = fs.readFileSync(configPath, 'utf8');
    } catch {
      currentContent = '';
    }

    const configChanged = (() => {
      if (!currentContent) return true;
      try {
        const cur = JSON.parse(currentContent);
        delete cur.meta;
        const nxt = JSON.parse(nextContent);
        delete nxt.meta;
        return JSON.stringify(cur) !== JSON.stringify(nxt);
      } catch {
        return currentContent !== nextContent;
      }
    })();
    if (configChanged) {
      try {
        ensureDir(path.dirname(configPath));
        const stampedContent = `${JSON.stringify(this.stampConfigMeta(managedConfig), null, 2)}\n`;
        const tmpPath = `${configPath}.tmp-${Date.now()}`;
        fs.writeFileSync(tmpPath, stampedContent, 'utf8');
        fs.renameSync(tmpPath, configPath);
      } catch (error) {
        return {
          ok: false,
          changed: false,
          configPath,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    const sessionStoreChanged = this.syncManagedSessionStore(providerSelection, allProvidersMap);

    // Ensure exec-approvals.json has security=full + ask=off so the gateway
    // never triggers approval-pending for any command.
    this.ensureExecApprovalDefaults();

    // Sync AGENTS.md with skills routing prompt to the OpenClaw workspace directory.
    // This runs on every sync regardless of openclaw.json changes, because skills
    // may have been installed/enabled/disabled independently.
    const agentsMdWarning = this.syncAgentsMd(mainWorkspacePath, coworkConfig);

    // Sync per-agent workspace files (SOUL.md, IDENTITY.md, AGENTS.md) for non-main agents
    this.syncPerAgentWorkspaces(mainWorkspacePath, coworkConfig);

    return {
      ok: true,
      changed: configChanged || sessionStoreChanged,
      configPath,
      ...(agentsMdWarning ? { agentsMdWarning } : {}),
    };
  }

  private getExistingGatewayConfig(configPath: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
        gateway?: unknown;
      };
      const gateway = parsed.gateway;
      if (!gateway || typeof gateway !== 'object' || Array.isArray(gateway)) {
        return {};
      }
      return gateway as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private getExistingPluginEntries(configPath: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
        plugins?: { entries?: unknown };
      };
      const entries = parsed.plugins?.entries;
      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
        return {};
      }
      return entries as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  /**
   * Collect all secret values that should be injected as environment variables
   * into the OpenClaw gateway process. The openclaw.json file uses `${VAR}`
   * placeholders for these values so that no plaintext secrets are stored on disk.
   */
  collectSecretEnvVars(): Record<string, string> {
    const env: Record<string, string> = {};

    // Provider API Keys — one per configured provider so switching models
    // never changes env vars and avoids gateway process restarts.
    const allApiKeys = resolveAllProviderApiKeys();
    for (const [envSuffix, apiKey] of Object.entries(allApiKeys)) {
      env[`LOBSTER_APIKEY_${envSuffix}`] = apiKey;
    }
    // Legacy fallback: keep LOBSTER_PROVIDER_API_KEY set to a stable value so stale
    // openclaw.json files with the old placeholder don't crash the gateway.
    // Use the active provider's key if available, but ONLY for the first sync —
    // after that, openclaw.json uses provider-specific placeholders and this var
    // is never resolved. Use a fixed value to avoid secretEnvVarsChanged on switch.
    env.LOBSTER_PROVIDER_API_KEY = 'legacy-unused';
    env.LOBSTER_PROXY_TOKEN = getCoworkOpenAICompatProxyToken() || 'unconfigured';

    // MCP Bridge Secret — always set so stale openclaw.json with
    // ${LOBSTER_MCP_BRIDGE_SECRET} placeholder doesn't crash the gateway.
    env.LOBSTER_MCP_BRIDGE_SECRET = this.getMcpBridgeSecret?.() || 'unconfigured';

    // Telegram
    const enabledTelegramInstances = this.getTelegramInstances().filter((instance) => instance.enabled && instance.botToken);
    if (enabledTelegramInstances.length > 0) {
      for (let index = 0; index < enabledTelegramInstances.length; index += 1) {
        const key = index === 0 ? 'LOBSTER_TG_BOT_TOKEN' : `LOBSTER_TG_BOT_TOKEN_${index}`;
        const secretKey = index === 0 ? 'LOBSTER_TG_WEBHOOK_SECRET' : `LOBSTER_TG_WEBHOOK_SECRET_${index}`;
        env[key] = enabledTelegramInstances[index].botToken;
        if (enabledTelegramInstances[index].webhookSecret) {
          env[secretKey] = enabledTelegramInstances[index].webhookSecret;
        }
      }
    } else {
      const tgConfig = this.getTelegramOpenClawConfig?.();
      if (tgConfig?.enabled && tgConfig.botToken) {
      env.LOBSTER_TG_BOT_TOKEN = tgConfig.botToken;
      if (tgConfig.webhookSecret) {
        env.LOBSTER_TG_WEBHOOK_SECRET = tgConfig.webhookSecret;
      }
      }
    }

    // Discord
    const enabledDiscordInstances = this.getDiscordInstances().filter((instance) => instance.enabled && instance.botToken);
    if (enabledDiscordInstances.length > 0) {
      for (let index = 0; index < enabledDiscordInstances.length; index += 1) {
        const key = index === 0 ? 'LOBSTER_DC_BOT_TOKEN' : `LOBSTER_DC_BOT_TOKEN_${index}`;
        env[key] = enabledDiscordInstances[index].botToken;
      }
    } else {
      const dcConfig = this.getDiscordOpenClawConfig?.();
      if (dcConfig?.enabled && dcConfig.botToken) {
      env.LOBSTER_DC_BOT_TOKEN = dcConfig.botToken;
      }
    }

    // Feishu
    const enabledFeishuInstances = this.getFeishuInstances().filter((instance) => instance.enabled && instance.appSecret);
    for (let index = 0; index < enabledFeishuInstances.length; index += 1) {
      const key = index === 0 ? 'LOBSTER_FEISHU_APP_SECRET' : `LOBSTER_FEISHU_APP_SECRET_${index}`;
      env[key] = enabledFeishuInstances[index].appSecret;
    }

    // DingTalk
    const enabledDingTalkInstances = this.getDingTalkInstances().filter((instance) => instance.enabled && instance.clientSecret);
    for (let index = 0; index < enabledDingTalkInstances.length; index += 1) {
      const key = index === 0 ? 'LOBSTER_DINGTALK_CLIENT_SECRET' : `LOBSTER_DINGTALK_CLIENT_SECRET_${index}`;
      env[key] = enabledDingTalkInstances[index].clientSecret;
    }
    const gatewayToken = this.engineManager.getGatewayToken();
    if (gatewayToken) {
      env.LOBSTER_DINGTALK_GW_TOKEN = gatewayToken;
    }

    // QQ
    const enabledQQInstances = this.getQQInstances().filter((instance) => instance.enabled && instance.appSecret);
    for (let index = 0; index < enabledQQInstances.length; index += 1) {
      const key = index === 0 ? 'LOBSTER_QQ_CLIENT_SECRET' : `LOBSTER_QQ_CLIENT_SECRET_${index}`;
      env[key] = enabledQQInstances[index].appSecret;
    }

    // WeCom
    const enabledWecomInstances = this.getWecomInstances().filter((instance) => instance.enabled && instance.secret);
    for (let index = 0; index < enabledWecomInstances.length; index += 1) {
      const key = index === 0 ? 'LOBSTER_WECOM_SECRET' : `LOBSTER_WECOM_SECRET_${index}`;
      env[key] = enabledWecomInstances[index].secret;
    }

    // POPO
    const enabledPopoInstances = (this.getPopoInstances?.() ?? (() => {
      const legacyConfig = this.getPopoConfig();
      return legacyConfig?.enabled ? [{ ...legacyConfig, instanceId: 'popo', instanceName: 'POPO Bot' }] : [];
    })()).filter((instance) => instance.enabled && instance.appSecret);
    for (let index = 0; index < enabledPopoInstances.length; index += 1) {
      const appSecretKey = index === 0 ? 'LOBSTER_POPO_APP_SECRET' : `LOBSTER_POPO_APP_SECRET_${index}`;
      const tokenKey = index === 0 ? 'LOBSTER_POPO_TOKEN' : `LOBSTER_POPO_TOKEN_${index}`;
      env[appSecretKey] = enabledPopoInstances[index].appSecret;
      env[tokenKey] = enabledPopoInstances[index].token || 'unconfigured';
    }

    // NIM
    const nimInstances = (this.getNimInstances?.() ?? (() => {
      const legacyConfig = this.getNimConfig();
      return legacyConfig?.enabled ? [{ ...legacyConfig, instanceId: 'nim', instanceName: 'NIM Bot' }] : [];
    })()).filter((instance) => instance.enabled && instance.token);
    for (let index = 0; index < nimInstances.length; index += 1) {
      const key = index === 0 ? 'LOBSTER_NIM_TOKEN' : `LOBSTER_NIM_TOKEN_${index}`;
      env[key] = nimInstances[index].token;
    }

    // Email
    const emailInstances = (this.getEmailOpenClawConfig?.()?.instances ?? [])
      .filter((instance) => instance.enabled && instance.email);
    for (const instance of emailInstances) {
      const envSuffix = instance.instanceId.replace(/^email-/, '').replace(/-/g, '_').toUpperCase();
      if (instance.transport === 'imap' && instance.password) {
        env[`LOBSTER_EMAIL_${envSuffix}_PASSWORD`] = instance.password;
      }
      if (instance.transport === 'ws' && instance.apiKey) {
        env[`LOBSTER_EMAIL_${envSuffix}_APIKEY`] = instance.apiKey;
      }
    }

    return env;
  }

  /**
   * Ensures exec-approvals.json under the LobsterAI-managed OpenClaw home has
   * security=full + ask=off so the gateway never triggers approval-pending
   * for any command. The path must match the OPENCLAW_HOME env var passed to
   * the gateway process so both sides read/write the same file.
   */
  private ensureExecApprovalDefaults(): void {
    const filePath = path.join(this.engineManager.getBaseDir(), '.openclaw', 'exec-approvals.json');

    type AgentEntry = { security?: string; ask?: string; [key: string]: unknown };
    type ApprovalsFile = { version: number; agents?: Record<string, AgentEntry>; [key: string]: unknown };

    let file: ApprovalsFile;
    try {
      if (fs.existsSync(filePath)) {
        file = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ApprovalsFile;
        if (file?.version !== 1) file = { version: 1 };
      } else {
        file = { version: 1 };
      }
    } catch {
      file = { version: 1 };
    }

    if (!file.agents) file.agents = {};
    if (!file.agents.main) file.agents.main = {};
    const agent = file.agents.main;

    if (agent.security === 'full' && agent.ask === 'off') return;

    agent.security = 'full';
    agent.ask = 'off';

    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.atomicWriteFile(filePath, `${JSON.stringify(file, null, 2)}\n`);
      console.log('[OpenClawConfigSync] set exec-approvals security=full ask=off');
    } catch (error) {
      console.warn('[OpenClawConfigSync] failed to write exec-approvals.json:', error);
    }
  }

  private syncManagedSessionStore(
    selection: OpenClawProviderSelection,
    availableProviders: Record<string, OpenClawProviderSelection['providerConfig']>,
  ): boolean {
    const shouldMigrateManagedModelRefs = !(
      selection.providerId === 'lobster' && selection.sessionModelId === selection.legacyModelId
    );
    const fallbackTarget = parsePrimaryModelRef(selection.primaryModel) ?? {
      providerId: selection.providerId,
      modelId: selection.sessionModelId,
      primaryModel: selection.primaryModel,
    };
    const configuredAgents = this.getAgents?.() ?? [];
    const agentById = new Map(configuredAgents.map((agent) => [agent.id, agent]));
    if (!agentById.has('main')) {
      agentById.set('main', {
        id: 'main',
        name: 'main',
        description: '',
        systemPrompt: '',
        identity: '',
        model: '',
        workingDirectory: '',
        icon: '',
        skillIds: [],
        toolBundleIds: [],
        enabled: true,
        isDefault: true,
        source: 'custom',
        presetId: '',
        createdAt: 0,
        updatedAt: 0,
      });
    }

    let anyChanged = false;
    for (const [agentId, agent] of agentById.entries()) {
      const qualification = resolveQualifiedAgentModelRef({
        agentModel: agent.model,
        availableProviders,
      });
      if (qualification.status === 'ambiguous') {
        console.warn(
          `[OpenClawConfigSync] Skipped ambiguous managed session model sync for "${agent.id}" because "${qualification.modelId}" matches multiple providers: ${qualification.providerIds.join(', ')}`,
        );
      }

      const sessionStorePath = path.join(
        this.engineManager.getStateDir(),
        'agents',
        agentId,
        'sessions',
        'sessions.json',
      );

      let storeContent = '';
      try {
        storeContent = fs.readFileSync(sessionStorePath, 'utf8');
      } catch {
        continue;
      }

      let sessionStore: Record<string, unknown>;
      try {
        sessionStore = JSON.parse(storeContent) as Record<string, unknown>;
      } catch {
        continue;
      }

      let changed = false;
      for (const [sessionKey, rawEntry] of Object.entries(sessionStore)) {
        if (!rawEntry || typeof rawEntry !== 'object') {
          continue;
        }

        const entry = rawEntry as Record<string, unknown>;
        if (parseChannelSessionKey(sessionKey) !== null) {
          const execSecurity = typeof entry.execSecurity === 'string' ? entry.execSecurity.trim() : '';
          if (execSecurity !== 'full') {
            entry.execSecurity = 'full';
            changed = true;
          }
          if (sessionSnapshotContainsDisabledManagedSkill(entry)) {
            delete entry.skillsSnapshot;
            changed = true;
          }
        }

        if (!isManagedSessionKey(sessionKey)) {
          continue;
        }

        const entryProvider = typeof entry.modelProvider === 'string' ? entry.modelProvider.trim() : '';
        if (qualification.status === 'ambiguous') {
          continue;
        }

        const target = resolveManagedSessionModelTarget({
          agentModel: qualification.status === 'qualified' ? qualification.primaryModel : agent.model,
          fallbackPrimaryModel: fallbackTarget.primaryModel,
          availableProviders,
          currentProviderId: entryProvider,
        });
        const entryModel = typeof entry.model === 'string' ? entry.model.trim() : '';
        const shouldMigrateLegacyRef = (
          shouldMigrateManagedModelRefs
          && entryProvider === 'lobster'
          && entryModel === selection.legacyModelId
        );
        const shouldAlignTarget = (
          entryProvider !== target.providerId
          || entryModel !== target.modelId
        );
        if (!shouldMigrateLegacyRef && !shouldAlignTarget) {
          continue;
        }

        entry.modelProvider = target.providerId;
        entry.model = target.modelId;
        const systemPromptReport = entry.systemPromptReport;
        if (systemPromptReport && typeof systemPromptReport === 'object') {
          const report = systemPromptReport as Record<string, unknown>;
          if (typeof report.provider === 'string' && report.provider.trim()) {
            report.provider = target.providerId;
          }
          if (typeof report.model === 'string' && report.model.trim()) {
            report.model = target.modelId;
          }
        }
        changed = true;
      }

      if (!changed) {
        continue;
      }

      try {
        this.atomicWriteFile(sessionStorePath, `${JSON.stringify(sessionStore, null, 2)}\n`);
        anyChanged = true;
      } catch (error) {
        console.warn(
          `[OpenClawConfigSync] Failed to update managed session store for "${agentId}":`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    return anyChanged;
  }

  /**
   * Resolve the LobsterAI SKILLs installation directory for OpenClaw's
   * `skills.load.extraDirs` configuration.
   *
   * Cross-platform paths (via Electron app.getPath('userData')):
   *   macOS:   ~/Library/Application Support/LobsterAI/SKILLs
   *   Windows: %APPDATA%/LobsterAI/SKILLs
   *   Linux:   ~/.config/LobsterAI/SKILLs
   */
  private resolveSkillsExtraDirs(): string[] {
    const userDataSkillsDir = path.join(app.getPath('userData'), 'SKILLs');
    try {
      if (fs.statSync(userDataSkillsDir).isDirectory()) {
        return [userDataSkillsDir];
      }
    } catch (err: unknown) {
      // ENOENT is expected on fresh installs before any skills sync.
      if (err && typeof err === 'object' && 'code' in err && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[OpenClawConfigSync] Failed to stat SKILLs directory:', err);
      }
    }
    return [];
  }

  /**
   * Build per-skill `enabled` overrides from the LobsterAI SkillManager state,
   * so that skills disabled in the LobsterAI UI are also hidden from OpenClaw.
   */
  private buildSkillEntries(): Record<string, { enabled: boolean }> {
    const skills = this.getSkillsList?.() ?? [];
    const entries: Record<string, { enabled: boolean }> = {};
    for (const skill of skills) {
      entries[skill.id] = { enabled: skill.enabled };
    }
    return entries;
  }

  /**
   * Sync AGENTS.md to the OpenClaw workspace directory.
   * Embeds the skills routing prompt and system prompt so that OpenClaw's
   * native channel connectors (DingTalk, Feishu, etc.) can discover and
   * invoke LobsterAI skills.
   */
  private syncAgentsMd(workspaceDir: string, coworkConfig: CoworkConfig): string | undefined {
    const MARKER = '<!-- LobsterAI managed: do not edit below this line -->';

    try {
      ensureDir(workspaceDir);
      const agentsMdPath = path.join(workspaceDir, 'AGENTS.md');

      // Build the managed section
      const sections: string[] = [];

      // Add system prompt if configured — strip MARKER to prevent content corruption
      const systemPrompt = (coworkConfig.systemPrompt || '').trim().replaceAll(MARKER, '');
      if (systemPrompt) {
        sections.push(`## System Prompt\n\n${systemPrompt}`);
      }

      // Skills are now loaded by OpenClaw natively via skills.load.extraDirs
      // in openclaw.json, so we no longer embed the skills routing prompt here.

      sections.push(MANAGED_WEB_SEARCH_POLICY_PROMPT);
      sections.push(MANAGED_EXEC_SAFETY_PROMPT);
      sections.push(QINGSHU_FILE_PUBLISH_PROMPT);
      sections.push(MANAGED_MEMORY_POLICY_PROMPT);

      // Keep scheduled-task policy after skills so native channel sessions
      // treat it as the final app-managed override for reminder handling.
      const scheduledTaskPrompt = buildScheduledTaskEnginePrompt('openclaw').replaceAll(MARKER, '');
      if (scheduledTaskPrompt) {
        sections.push(scheduledTaskPrompt);
      }

      // Read existing file once to avoid TOCTOU issues
      let existingContent = '';
      try {
        existingContent = fs.readFileSync(agentsMdPath, 'utf8');
      } catch {
        // File doesn't exist yet.
      }

      // Extract user content (everything before the marker)
      const markerIdx = existingContent.indexOf(MARKER);
      const userContent = markerIdx >= 0
        ? existingContent.slice(0, markerIdx).trimEnd()
        : existingContent.trimEnd();
      const preservedUserContent = userContent || readBundledOpenClawAgentsTemplate();

      if (sections.length === 0) {
        // No managed content — remove the managed section if present,
        // but preserve user content.
        if (markerIdx >= 0) {
          if (preservedUserContent) {
            const cleaned = preservedUserContent + '\n';
            if (existingContent !== cleaned) {
              this.atomicWriteFile(agentsMdPath, cleaned);
            }
          } else {
            try { fs.unlinkSync(agentsMdPath); } catch { /* already gone */ }
          }
        }
        return;
      }

      const managedContent = `${MARKER}\n\n${sections.join('\n\n')}`;
      const nextContent = preservedUserContent
        ? `${preservedUserContent}\n\n${managedContent}\n`
        : `${managedContent}\n`;

      // Only write if content actually changed
      if (existingContent === nextContent) return;

      this.atomicWriteFile(agentsMdPath, nextContent);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn('[OpenClawConfigSync] Failed to sync AGENTS.md:', msg);
      return msg;
    }
  }

  /**
   * Build the `agents.list` config array for openclaw.json.
   *
   * The main agent uses the user's configured workspace directory (via
   * `agents.defaults.workspace`).  Non-main agents omit `workspace` so
   * OpenClaw falls back to its default: `{STATE_DIR}/workspace-{agentId}/`.
   * This keeps custom agent workspaces under the openclaw state directory
   * rather than coupling them to the user's working directory.
   *
   * Per-agent `identity` (name, emoji) is set from the agent database so
   * OpenClaw picks it up natively.
   */
  private buildAgentsList(
    defaultPrimaryModel: string,
    stateDir?: string,
    availableProviders?: Record<string, { models: Array<{ id: string }> }>,
  ): { list?: Array<Record<string, unknown>> } {
    const agents = this.getAgents?.() ?? [];
    const mainAgent = agents.find((agent) => agent.id === 'main');

    const list: Array<Record<string, unknown>> = [
      mainAgent
        ? buildAgentEntry(mainAgent, defaultPrimaryModel, { availableProviders })
        : {
            id: 'main',
            default: true,
            model: {
              primary: defaultPrimaryModel,
            },
          },
      ...buildManagedAgentEntries({
        agents,
        fallbackPrimaryModel: defaultPrimaryModel,
        stateDir,
        availableProviders,
      }),
    ];

    return list.length > 0 ? { list } : {};
  }

  /**
   * Build the `bindings` config array for openclaw.json.
   *
   * Each IM platform can be independently bound to a different agent via
   * `IMSettings.platformAgentBindings`.  Only channels with an explicit
   * non-main binding produce an entry.
   */
  private buildBindings(): { bindings?: Array<Record<string, unknown>> } {
    const imSettings = this.getIMSettings?.();
    const platformBindings = imSettings?.platformAgentBindings;
    if (!platformBindings || Object.keys(platformBindings).length === 0) return {};

    const agents = this.getAgents?.() ?? [];

    const bindings: Array<Record<string, unknown>> = [];

    const multiInstanceChannels: Record<string, { channel: string; getInstances: () => Array<{ instanceId: string; enabled: boolean; appKey?: string; account?: string; nimToken?: string }> }> = {
      dingtalk: { channel: 'dingtalk', getInstances: () => this.getDingTalkInstances() },
      feishu: { channel: 'feishu', getInstances: () => this.getFeishuInstances() },
      telegram: { channel: 'telegram', getInstances: () => this.getTelegramInstances() },
      discord: { channel: 'discord', getInstances: () => this.getDiscordInstances() },
      qq: { channel: 'qqbot', getInstances: () => this.getQQInstances() },
      nim: { channel: 'nim', getInstances: () => this.getNimInstances?.() ?? [] },
      wecom: { channel: 'wecom', getInstances: () => this.getWecomInstances() },
      popo: { channel: 'moltbot-popo', getInstances: () => this.getPopoInstances?.() ?? [] },
      email: { channel: 'email', getInstances: () => this.getEmailOpenClawConfig?.()?.instances ?? [] },
    };

    for (const [platform, { channel, getInstances }] of Object.entries(multiInstanceChannels)) {
      try {
        const instances = getInstances();
        for (const instance of instances) {
          if (!instance.enabled) continue;
          const bindingKey = `${platform}:${instance.instanceId}`;
          const agentId = platformBindings[bindingKey];
          if (!agentId || agentId === 'main') continue;
          const targetAgent = agents.find((agent) => agent.id === agentId && agent.enabled);
          if (!targetAgent) continue;
          const accountId = platform === 'nim'
            ? deriveNimAccountId(instance as NimInstanceConfig)
            : instance.instanceId.slice(0, 8);
          if (!accountId) continue;
          bindings.push({
            agentId,
            match: {
              channel,
              accountId,
            },
          });
        }

        const platformAgentId = platformBindings[platform];
        if (!platformAgentId || platformAgentId === 'main') continue;
        const targetAgent = agents.find((agent) => agent.id === platformAgentId && agent.enabled);
        if (targetAgent && instances.some((instance) => instance.enabled)) {
          bindings.push({
            agentId: platformAgentId,
            match: { channel, accountId: OPENCLAW_BINDING_ANY_ACCOUNT_ID },
          });
        }
      } catch {
        // Skip channels that fail to load config.
      }
    }

    const singleInstanceChannels: Array<{ getter: () => { enabled: boolean } | null; channel: string; platform: string }> = [
      { getter: () => this.getTelegramOpenClawConfig?.() ?? null, channel: 'telegram', platform: 'telegram' },
      { getter: () => this.getDiscordOpenClawConfig?.() ?? null, channel: 'discord', platform: 'discord' },
      { getter: () => this.getNeteaseBeeChanConfig(), channel: 'netease-bee', platform: 'netease-bee' },
      { getter: () => this.getWeixinConfig(), channel: 'openclaw-weixin', platform: 'weixin' },
    ];

    for (const { getter, channel, platform } of singleInstanceChannels) {
      const agentId = platformBindings[platform];
      if (!agentId || agentId === 'main') continue;
      const targetAgent = agents.find((agent) => agent.id === agentId && agent.enabled);
      if (!targetAgent) continue;
      try {
        const config = getter();
        if (config?.enabled) {
          bindings.push({
            agentId,
            match: { channel, accountId: OPENCLAW_BINDING_ANY_ACCOUNT_ID },
          });
        }
      } catch {
        // Skip channels that fail to load config.
      }
    }

    return bindings.length > 0 ? { bindings } : {};
  }

  /**
   * Sync workspace files (SOUL.md, IDENTITY.md, AGENTS.md) for each non-main agent.
   * The main agent's workspace is synced by `syncAgentsMd`. Non-main agents
   * get their own workspace directories under the openclaw state directory.
   */
  private syncPerAgentWorkspaces(_mainWorkspaceDir: string, coworkConfig: CoworkConfig): void {
    const agents = this.getAgents?.() ?? [];
    // Use the openclaw state directory as base, matching OpenClaw's own fallback
    // logic: {STATE_DIR}/workspace-{agentId}/
    const stateDir = this.engineManager.getStateDir();

    for (const agent of agents) {
      if (agent.id === 'main' || !agent.enabled) continue;

      const agentWorkspace = path.join(stateDir, `workspace-${agent.id}`);
      try {
        ensureDir(agentWorkspace);

        // Sync SOUL.md — agent's system prompt
        const soulPath = path.join(agentWorkspace, 'SOUL.md');
        const soulContent = (agent.systemPrompt || '').trim();
        this.syncFileIfChanged(soulPath, soulContent ? `${soulContent}\n` : '');

        // Sync IDENTITY.md — agent's identity description
        const identityPath = path.join(agentWorkspace, 'IDENTITY.md');
        const identityContent = (agent.identity || '').trim();
        this.syncFileIfChanged(identityPath, identityContent ? `${identityContent}\n` : '');

        // Sync AGENTS.md for this agent (reuse same logic as main agent)
        this.syncAgentsMd(agentWorkspace, {
          ...coworkConfig,
          systemPrompt: agent.systemPrompt || '',
        });

        // Ensure memory directory exists
        const memoryDir = path.join(agentWorkspace, 'memory');
        ensureDir(memoryDir);

        // Ensure MEMORY.md exists
        const memoryPath = path.join(agentWorkspace, 'MEMORY.md');
        if (!fs.existsSync(memoryPath)) {
          fs.writeFileSync(memoryPath, '', 'utf8');
        }
      } catch (error) {
        console.warn(
          `[OpenClawConfigSync] Failed to sync workspace for agent ${agent.id}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  /** Write a file only if its content has changed. */
  private syncFileIfChanged(filePath: string, content: string): void {
    try {
      const existing = fs.readFileSync(filePath, 'utf8');
      if (existing === content) return;
    } catch {
      // File doesn't exist yet
    }
    if (content) {
      this.atomicWriteFile(filePath, content);
    } else {
      // Empty content — create empty file if it doesn't exist
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, '', 'utf8');
      }
    }
  }

  /** Atomic file write via tmp + rename, consistent with openclaw.json writes. */
  private atomicWriteFile(filePath: string, content: string): void {
    const tmpPath = `${filePath}.tmp-${Date.now()}`;
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, filePath);
  }

  /**
   * Write a minimal openclaw.json that lets the gateway start without any
  * model/provider configured.  The full config will be synced once the
  * user sets up a model in the UI.
  */
  private writeMinimalConfig(configPath: string, _reason: string): OpenClawConfigSyncResult {
    const baseMinimalConfig: Record<string, unknown> = {
      gateway: {
        mode: 'local',
      },
      // Don't enable plugins in minimal config — plugin loading via jiti happens
      // synchronously BEFORE the HTTP server binds, and can block gateway startup
      // for minutes on a fresh install.  Plugins will be enabled when the user
      // configures an API model and a full config sync runs.
    };

    let currentContent = '';
    try {
      currentContent = fs.readFileSync(configPath, 'utf8');
    } catch {
      currentContent = '';
    }

    let mergedConfig: Record<string, unknown> = { ...baseMinimalConfig };
    if (currentContent) {
      try {
        const existing = JSON.parse(currentContent);
        if (existing.plugins) {
          mergedConfig.plugins = existing.plugins;
        }
        if (existing.gateway && existing.gateway.mode !== 'local') {
          mergedConfig.gateway = existing.gateway;
        }
        // existing.models is intentionally not preserved: it can reference
        // provider env placeholders that are no longer injected.
      } catch {
        // Malformed JSON — overwrite with base minimal config.
      }
    }

    const nextContent = `${JSON.stringify(mergedConfig, null, 2)}\n`;
    const unchanged = (() => {
      if (!currentContent) return false;
      try {
        const cur = JSON.parse(currentContent);
        delete cur.meta;
        const nxt = JSON.parse(nextContent);
        delete nxt.meta;
        return JSON.stringify(cur) === JSON.stringify(nxt);
      } catch {
        return currentContent === nextContent;
      }
    })();

    if (unchanged) {
      return { ok: true, changed: false, configPath };
    }

    try {
      ensureDir(path.dirname(configPath));
      const stampedContent = `${JSON.stringify(this.stampConfigMeta(mergedConfig), null, 2)}\n`;
      const tmpPath = `${configPath}.tmp-${Date.now()}`;
      fs.writeFileSync(tmpPath, stampedContent, 'utf8');
      fs.renameSync(tmpPath, configPath);
      return { ok: true, changed: true, configPath };
    } catch (error) {
      return {
        ok: false,
        changed: false,
        configPath,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
