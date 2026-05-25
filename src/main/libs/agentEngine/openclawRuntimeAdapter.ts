import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'crypto';
import { app, BrowserWindow } from 'electron';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

import { stripCoworkImageAttachmentPayloads } from '../../../common/coworkImageAttachments';
import type { OpenClawSessionPatch } from '../../../common/openclawSession';
import type {
  CoworkConversationReplacementEntry,
  CoworkExecutionMode,
  CoworkMessage,
  CoworkSession,
  CoworkSessionStatus,
  CoworkStore,
} from '../../coworkStore';
import { t } from '../../i18n';
import { getCommandDangerLevel,isDeleteCommand } from '../commandSafety';
import { setCoworkProxyAgentId, setCoworkProxySessionId } from '../coworkOpenAICompatProxy';
import { extractOpenClawAssistantStreamText } from '../openclawAssistantText';
import {
  buildManagedSessionKey,
  isManagedSessionKey,
  type OpenClawChannelSessionSync,
  parseChannelSessionKey,
  parseManagedSessionKey,
} from '../openclawChannelSessionSync';
import { OPENCLAW_AGENT_TIMEOUT_SECONDS } from '../openclawConfigSync';
import {
  OpenClawEngineManager,
  type OpenClawGatewayConnectionInfo,
} from '../openclawEngineManager';
import {
  extractGatewayHistoryEntries,
  extractGatewayMessageText,
  type GatewayHistoryEntry,
  isHeartbeatAckText,
  isTransientGatewayStatusText,
  shouldSuppressHeartbeatText,
  stripTrailingSilentReplyTail,
  stripTrailingSilentReplyToken,
} from '../openclawHistory';
import { buildOpenClawLocalTimeContextPrompt } from '../openclawLocalTimeContextPrompt';
import { buildTransientSessionFromOpenClawTranscript } from '../openclawTranscript';
import type { SubagentMessageStore } from '../../subagentMessageStore';
import type { SubagentRunStore } from '../../subagentRunStore';
import { mergeAgentInstructionPrompt, mergeAgentSkillIds } from './agentContext';
import { AgentLifecyclePhase, type AgentLifecyclePhase as AgentLifecyclePhaseValue } from './constants';
import { SubagentTracker } from './subagentTracker';
import type {
  CoworkContinueOptions,
  CoworkRuntime,
  CoworkRuntimeEvents,
  CoworkStartOptions,
  PermissionRequest,
} from './types';

const OPENCLAW_GATEWAY_TOOL_EVENTS_CAP = 'tool-events';
const BRIDGE_MAX_MESSAGES = 20;
const BRIDGE_MAX_MESSAGE_CHARS = 1200;
// OpenClaw may spend extra time loading plugins or fetching bootstrap metadata
// before the gateway client handshake completes, so avoid false startup timeout.
const GATEWAY_READY_TIMEOUT_MS = 60_000;
const FINAL_HISTORY_SYNC_LIMIT = 50;
const CHANNEL_SESSION_DISCOVERY_LIMIT = 200;
const INTERNAL_SYSTEM_PROMPT_HEADER = '[LobsterAI system instructions]';
const INTERNAL_SYSTEM_PROMPT_REPLACEMENT_HINT =
  'If earlier LobsterAI system instructions exist, replace them with this version.';
const CHAT_FINAL_COMPLETION_FALLBACK_DELAY_MS = 3000;

/** How we chose assistant text to persist at chat.final (for tests and logs). */
export type PersistedSegmentPickReason =
  | 'both_empty'
  | 'previous_only'
  | 'final_only'
  | 'stream_authority_same_or_longer'
  | 'stream_shorter_prefer_chat_final'
  | 'chat_path_prefer_final';

/**
 * Prefer agent-stream segment text when it is authoritative (longer or equal vs chat.final).
 * When only the chat path updated the UI, prefer chat.final extraction.
 */
export function pickPersistedAssistantSegment(
  previousSegmentText: string,
  finalSegmentText: string,
  hasSeenAgentAssistantStream: boolean,
): { content: string; reason: PersistedSegmentPickReason } {
  const prev = previousSegmentText;
  const fin = finalSegmentText;
  if (!prev.trim() && !fin.trim()) {
    return { content: '', reason: 'both_empty' };
  }
  if (!prev.trim()) {
    return { content: fin, reason: 'final_only' };
  }
  if (!fin.trim()) {
    return { content: prev, reason: 'previous_only' };
  }
  if (hasSeenAgentAssistantStream) {
    if (prev.length >= fin.length) {
      return { content: prev, reason: 'stream_authority_same_or_longer' };
    }
    return { content: fin, reason: 'stream_shorter_prefer_chat_final' };
  }
  return { content: fin, reason: 'chat_path_prefer_final' };
}

type GatewayEventFrame = {
  event: string;
  seq?: number;
  payload?: unknown;
};

type GatewayClientLike = {
  start: () => void;
  stop: () => void;
  request: <T = Record<string, unknown>>(
    method: string,
    params?: unknown,
    opts?: { expectFinal?: boolean; timeoutMs?: number | null },
  ) => Promise<T>;
};

type GatewayClientCtor = new (options: Record<string, unknown>) => GatewayClientLike;

type OpenClawRuntimeAdapterOptions = {
  normalizeModelRef?: (modelRef: string) => string;
};

type ChatEventState = 'delta' | 'final' | 'aborted' | 'error';

type ChatEventPayload = {
  runId?: string;
  sessionKey?: string;
  state?: ChatEventState;
  message?: unknown;
  errorMessage?: string;
  stopReason?: string;
};

type AgentEventPayload = {
  seq?: number;
  runId?: string;
  sessionKey?: string;
  stream?: string;
  data?: unknown;
};

type ExecApprovalRequestedPayload = {
  id?: string;
  request?: {
    command?: string;
    cwd?: string | null;
    host?: string | null;
    security?: string | null;
    ask?: string | null;
    resolvedPath?: string | null;
    sessionKey?: string | null;
    agentId?: string | null;
  };
};

type ExecApprovalResolvedPayload = {
  id?: string;
};

type TextStreamMode = 'unknown' | 'snapshot' | 'delta';

type ActiveTurn = {
  sessionId: string;
  sessionKey: string;
  runId: string;
  turnToken: number;
  startedAtMs: number;
  knownRunIds: Set<string>;
  assistantMessageId: string | null;
  committedAssistantText: string;
  currentAssistantSegmentText: string;
  currentText: string;
  /** Highest text length from agent assistant events (immune to chat delta noise). */
  agentAssistantTextLength: number;
  /**
   * Once true for the current assistant segment, chat.delta must not overwrite
   * `currentAssistantSegmentText` (even if agentAssistantTextLength is reset).
   */
  hasSeenAgentAssistantStream: boolean;
  /** Dedup debug log when chat.delta tries to overwrite an agent-owned segment. */
  chatDeltaOverwriteSkipLogged?: boolean;
  currentContentText: string;
  currentContentBlocks: string[];
  sawNonTextContentBlocks: boolean;
  textStreamMode: TextStreamMode;
  toolUseMessageIdByToolCallId: Map<string, string>;
  toolResultMessageIdByToolCallId: Map<string, string>;
  toolResultTextByToolCallId: Map<string, string>;
  stopRequested: boolean;
  /** True while async user message prefetch is in progress for channel sessions. */
  pendingUserSync: boolean;
  /** Chat events buffered while pendingUserSync is true. */
  bufferedChatPayloads: BufferedChatEvent[];
  /** Agent events buffered while pendingUserSync is true. */
  bufferedAgentPayloads: BufferedAgentEvent[];
  /** Client-side timeout watchdog timer (fallback for missing gateway abort events). */
  timeoutTimer?: ReturnType<typeof setTimeout>;
  /** True after the gateway has reported the run lifecycle end. */
  lifecycleEndReceived?: boolean;
  /** True after chat.final has been reconciled and is waiting for lifecycle end. */
  chatFinalReady?: boolean;
  /** Run id captured from chat.final for the eventual completion event. */
  chatFinalRunId?: string;
  /** Fallback timer used when chat.final arrives but lifecycle end is lost. */
  chatFinalCompletionTimer?: ReturnType<typeof setTimeout>;
};

type BufferedChatEvent = {
  payload: unknown;
  seq: number | undefined;
  bufferedAt: number;
};

type BufferedAgentEvent = {
  payload: unknown;
  seq: number | undefined;
  bufferedAt: number;
};

type PendingApprovalEntry = {
  requestId: string;
  sessionId: string;
  /** When true, use 'allow-always' decision so OpenClaw adds the command to its allowlist. */
  allowAlways?: boolean;
};

type ChannelHistorySyncEntry = {
  role: 'user' | 'assistant';
  text: string;
  metadata?: CoworkMessage['metadata'];
  timestamp?: number;
};

const buildAssistantMetadataFromHistoryEntry = (
  entry: GatewayHistoryEntry,
): CoworkMessage['metadata'] | undefined => {
  if (entry.role !== 'assistant') return undefined;

  const usage = entry.usage;
  const metadata: CoworkMessage['metadata'] = {
    isStreaming: false,
    isFinal: true,
    ...(usage && (
      usage.input !== undefined
      || usage.output !== undefined
      || usage.cacheRead !== undefined
    ) ? {
        usage: {
          ...(usage.input !== undefined ? { inputTokens: usage.input } : {}),
          ...(usage.output !== undefined ? { outputTokens: usage.output } : {}),
          ...(usage.cacheRead !== undefined ? { cacheReadTokens: usage.cacheRead } : {}),
        },
      } : {}),
    ...(entry.model ? { model: entry.model } : {}),
  };

  return Object.keys(metadata).length > 2 ? metadata : undefined;
};

const buildAssistantMetadataFromFinalMessage = (
  message: unknown,
): CoworkMessage['metadata'] | undefined => {
  if (!isRecord(message)) return undefined;

  const usage = isRecord(message.usage) ? message.usage : null;
  const inputTokens = usage
    ? (typeof usage.input === 'number' ? usage.input
      : typeof usage.inputTokens === 'number' ? usage.inputTokens
      : undefined)
    : undefined;
  const outputTokens = usage
    ? (typeof usage.output === 'number' ? usage.output
      : typeof usage.outputTokens === 'number' ? usage.outputTokens
      : undefined)
    : undefined;
  const cacheReadTokens = usage
    ? (typeof usage.cacheRead === 'number' ? usage.cacheRead
      : typeof usage.cacheReadTokens === 'number' ? usage.cacheReadTokens
      : undefined)
    : undefined;
  const model = typeof message.model === 'string' && message.model.trim()
    ? message.model.trim()
    : undefined;

  const metadata: CoworkMessage['metadata'] = {
    isStreaming: false,
    isFinal: true,
    ...(inputTokens !== undefined || outputTokens !== undefined || cacheReadTokens !== undefined ? {
      usage: {
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
        ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
      },
    } : {}),
    ...(model ? { model } : {}),
  };

  return Object.keys(metadata).length > 2 ? metadata : undefined;
};

const computeContextPercent = (
  inputTokens: number | undefined,
  contextTokens: number | undefined,
): number | undefined => {
  if (
    typeof inputTokens !== 'number'
    || typeof contextTokens !== 'number'
    || !Number.isFinite(inputTokens)
    || !Number.isFinite(contextTokens)
    || inputTokens <= 0
    || contextTokens <= 0
  ) {
    return undefined;
  }

  return Math.min(Math.round((inputTokens / contextTokens) * 100), 100);
};

const extractInputTokensFromMetadata = (
  metadata: CoworkMessage['metadata'] | undefined,
): number | undefined => {
  const usage = metadata?.usage;
  if (!isRecord(usage)) return undefined;
  const inputTokens = usage.inputTokens;
  return typeof inputTokens === 'number' && Number.isFinite(inputTokens)
    ? inputTokens
    : undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
};

const isSameChannelHistoryEntry = (
  left: ChannelHistorySyncEntry,
  right: ChannelHistorySyncEntry,
): boolean => {
  return left.role === right.role && left.text === right.text;
};

const truncate = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}...`;
};

const normalizeAgentLifecyclePhase = (value: unknown): AgentLifecyclePhaseValue | '' => {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  const phases = Object.values(AgentLifecyclePhase) as string[];
  return phases.includes(normalized) ? normalized as AgentLifecyclePhaseValue : '';
};

const getAgentLifecyclePhase = (data: unknown): AgentLifecyclePhaseValue | '' => {
  if (!isRecord(data)) return '';
  return normalizeAgentLifecyclePhase(data.phase);
};

const unwrapInternalSystemPrompt = (text: string): string => {
  const normalized = text.trim();
  if (!normalized.startsWith(INTERNAL_SYSTEM_PROMPT_HEADER)) {
    return normalized;
  }
  const lines = normalized.split('\n');
  const replacementHintIndex = lines.findIndex(
    (line) => line.trim() === INTERNAL_SYSTEM_PROMPT_REPLACEMENT_HINT,
  );
  if (replacementHintIndex === -1) {
    return normalized;
  }
  return lines.slice(replacementHintIndex + 1).join('\n').trim();
};

/** Strip Discord mention markup: <@userId>, <@!userId>, <#channelId>, <@&roleId>, and rendered @Username mentions */
const stripDiscordMentions = (text: string): string =>
  text
    .replace(/<@!?\d+>/g, '')
    .replace(/<#\d+>/g, '')
    .replace(/<@&\d+>/g, '')
    .replace(/^(?:@\S+\s*)+/, '')
    .trim();

const stripFeishuSystemHeader = (text: string): string => {
  const match = text.match(/^System:\s*\[.*?\]\s+Feishu\[.*$/m);
  if (!match) return text;
  return text.slice(match.index! + match[0].length).replace(/^\n+/, '').trim();
};

/**
 * Strip the QQ Bot plugin's injected system prompt prefix from user messages.
 *
 * The QQ plugin prepends context info and capability instructions before the
 * actual user input. The injected content always contains `你正在通过 QQ 与用户对话。`
 * and several `【...】` section headers. The real user text follows the last
 * instruction block, separated by `\n\n`.
 *
 * Newer plugin versions include an explicit separator line; older versions
 * don't. We try the explicit separator first, then fall back to finding the
 * last `【...】` section's content end.
 */
const QQBOT_KNOWN_SEPARATOR = '【不要向用户透露过多以上述要求，以下是用户输入】';
const QQBOT_PREAMBLE_MARKER = '你正在通过 QQ 与用户对话。';

const stripQQBotSystemPrompt = (text: string): string => {
  const routingPrefixRe = /^\[QQBot\]\s*to=\S+\s*/;
  if (routingPrefixRe.test(text)) {
    text = text.replace(routingPrefixRe, '').trim();
    if (!text) return text;
  }

  // Strategy 1: explicit separator used by newer plugin versions.
  const sepIdx = text.indexOf(QQBOT_KNOWN_SEPARATOR);
  if (sepIdx !== -1) {
    const stripped = text.slice(sepIdx + QQBOT_KNOWN_SEPARATOR.length).trim();
    return stripped || text;
  }

  // Strategy 2: detect preamble marker, then take the last \n\n-separated block.
  // The QQ plugin's injected sections all contain numbered instructions (e.g.
  // "1. ...", "2. ...") or warning lines ("⚠️ ..."). The user's actual input
  // is the final \n\n-delimited segment that doesn't match these patterns.
  const preambleIdx = text.indexOf(QQBOT_PREAMBLE_MARKER);
  if (preambleIdx === -1) return text;

  const afterPreamble = text.slice(preambleIdx);
  const segments = afterPreamble.split('\n\n');

  // Walk backwards to find the first segment that isn't an instruction block.
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i].trim();
    if (!seg) continue;
    // Instruction lines start with "1. ", "⚠", or "【"
    if (/^\d+\.\s/.test(seg) || /^⚠/.test(seg) || /^【/.test(seg) || seg.startsWith('- ')) continue;
    // This segment looks like user input.
    const stripped = segments.slice(i).join('\n\n').trim();
    return stripped || text;
  }

  return text;
};

const stripPopoSystemHeader = (text: string): string => {
  const match = text.match(/^System:\s*\[.*?\]\s+POPO\b.*$/m);
  if (!match) return text;
  return text.slice(match.index! + match[0].length).replace(/^\n+/, '').trim();
};

interface PlatformFlags {
  isDiscord: boolean;
  isQQ: boolean;
  isPopo: boolean;
  isFeishu: boolean;
}

const normalizeEntryText = (
  role: 'user' | 'assistant',
  text: string,
  flags: PlatformFlags,
): string => {
  let result = text.trim();
  if (!result) return result;
  if (flags.isPopo) result = result.replace(/<br\s*\/?>/gi, '\n');
  if (flags.isDiscord) result = stripDiscordMentions(result);
  if (flags.isQQ && role === 'user') result = stripQQBotSystemPrompt(result);
  if (flags.isPopo && role === 'user') result = stripPopoSystemHeader(result);
  if (flags.isFeishu && role === 'user') result = stripFeishuSystemHeader(result);
  return result;
};

const isSameHistoryEntry = (
  left: { role: 'user' | 'assistant'; text: string },
  right: { role: 'user' | 'assistant'; text: string },
): boolean => left.role === right.role && left.text === right.text;

const historyEntryKey = (entry: { role: 'user' | 'assistant'; text: string }): string => {
  return `${entry.role}\x1f${entry.text}`;
};

const isValidMessageTimestamp = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
};

const applyLocalTimestampsToEntries = (
  entries: ChannelHistorySyncEntry[],
  localEntries: Array<{ role: 'user' | 'assistant'; text: string; timestamp?: number }>,
): CoworkConversationReplacementEntry[] => {
  const localTimestamps = new Map<string, number[]>();
  for (const entry of localEntries) {
    if (!isValidMessageTimestamp(entry.timestamp)) continue;
    const key = historyEntryKey(entry);
    const timestamps = localTimestamps.get(key) ?? [];
    timestamps.push(entry.timestamp);
    localTimestamps.set(key, timestamps);
  }

  return entries.map((entry) => {
    if (isValidMessageTimestamp(entry.timestamp)) {
      return entry;
    }
    const timestamps = localTimestamps.get(historyEntryKey(entry));
    const timestamp = timestamps?.shift();
    return timestamp != null ? { ...entry, timestamp } : entry;
  });
};

const findTailAlignment = (
  localEntries: ReadonlyArray<{ role: 'user' | 'assistant'; text: string }>,
  authEntries: ReadonlyArray<{ role: 'user' | 'assistant'; text: string }>,
): { localIdx: number; authIdx: number } | null => {
  if (authEntries.length === 0) return null;
  if (localEntries.length === 0) return { localIdx: 0, authIdx: 0 };

  const maxEntryOverlap = Math.min(localEntries.length, authEntries.length);
  for (let overlap = maxEntryOverlap; overlap >= 1; overlap -= 1) {
    const localStart = localEntries.length - overlap;
    let match = true;
    for (let idx = 0; idx < overlap; idx += 1) {
      if (!isSameHistoryEntry(localEntries[localStart + idx], authEntries[idx])) {
        match = false;
        break;
      }
    }
    if (match) {
      return { localIdx: localStart, authIdx: 0 };
    }
  }

  const localUsers: Array<{ idx: number; text: string }> = [];
  for (let i = 0; i < localEntries.length; i++) {
    if (localEntries[i].role === 'user') {
      localUsers.push({ idx: i, text: localEntries[i].text });
    }
  }

  const authUsers: Array<{ idx: number; text: string }> = [];
  for (let i = 0; i < authEntries.length; i++) {
    const entry = authEntries[i];
    if (entry.role === 'user') {
      authUsers.push({ idx: i, text: entry.text });
    }
  }

  if (authUsers.length === 0 || localUsers.length === 0) {
    return { localIdx: 0, authIdx: 0 };
  }

  const maxK = Math.min(localUsers.length, authUsers.length);
  for (let k = maxK; k >= 1; k--) {
    const localStart = localUsers.length - k;
    let match = true;
    for (let j = 0; j < k; j++) {
      if (localUsers[localStart + j].text !== authUsers[j].text) {
        match = false;
        break;
      }
    }
    if (match) {
      const localIdx = localUsers[localStart].idx;
      const authIdx = authUsers[0].idx;
      if (authIdx > 0) {
        const leadingLocalIdx = localIdx - authIdx;
        const leadingAuthAlreadyPresent = leadingLocalIdx >= 0
          && authEntries.slice(0, authIdx).every((entry, idx) =>
            isSameHistoryEntry(localEntries[leadingLocalIdx + idx], entry),
          );
        if (!leadingAuthAlreadyPresent) {
          return {
            localIdx: Math.max(0, leadingLocalIdx),
            authIdx: 0,
          };
        }
      }
      return { localIdx, authIdx };
    }
  }

  return null;
};

const extractMessageText = extractGatewayMessageText;

const summarizeGatewayMessageShape = (message: unknown): string => {
  if (!isRecord(message)) {
    return `non-record:${typeof message}`;
  }

  const role = typeof message.role === 'string' ? message.role : '?';
  const content = message.content;
  if (typeof content === 'string') {
    return `role=${role} content=string(${content.length}) text="${truncate(content, 120)}"`;
  }
  if (Array.isArray(content)) {
    const parts = content.map((item) => {
      if (!isRecord(item)) return typeof item;
      const type = typeof item.type === 'string' ? item.type : 'object';
      const text = typeof item.text === 'string' ? `:${truncate(item.text, 60)}` : '';
      return `${type}${text}`;
    });
    return `role=${role} content=[${parts.join(', ')}]`;
  }
  if (isRecord(content)) {
    return `role=${role} contentKeys=${Object.keys(content).join(',')}`;
  }
  if (typeof message.text === 'string') {
    return `role=${role} text=${truncate(message.text, 120)}`;
  }
  return `role=${role} keys=${Object.keys(message).join(',')}`;
};

const extractTextBlocksAndSignals = (
  message: unknown,
): { textBlocks: string[]; sawNonTextContentBlocks: boolean } => {
  if (!isRecord(message)) {
    return {
      textBlocks: [],
      sawNonTextContentBlocks: false,
    };
  }

  const content = message.content;
  if (typeof content === 'string') {
    const text = content.trim();
    return {
      textBlocks: text ? [text] : [],
      sawNonTextContentBlocks: false,
    };
  }
  if (!Array.isArray(content)) {
    return {
      textBlocks: [],
      sawNonTextContentBlocks: false,
    };
  }

  const textBlocks: string[] = [];
  let sawNonTextContentBlocks = false;
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === 'text' && typeof block.text === 'string') {
      const text = block.text.trim();
      if (text) {
        textBlocks.push(text);
      }
      continue;
    }
    if (typeof block.type === 'string' && block.type !== 'thinking') {
      sawNonTextContentBlocks = true;
      console.log('[Debug:extractBlocks] non-text block type:', block.type, 'content:', JSON.stringify(block).slice(0, 500));
    }
  }

  return {
    textBlocks,
    sawNonTextContentBlocks,
  };
};

/**
 * Extract file paths from assistant "message" tool calls in chat.history.
 * Only scans messages after the last user message (current turn).
 * The model sends files to Telegram using: toolCall { name: "message", arguments: { action: "send", filePath: "..." } }
 */
const extractSentFilePathsFromHistory = (messages: unknown[]): string[] => {
  // Find the last user message index to scope to current turn only
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (isRecord(msg) && (msg as Record<string, unknown>).role === 'user') {
      lastUserIdx = i;
      break;
    }
  }

  const filePaths: string[] = [];
  const seen = new Set<string>();
  const startIdx = lastUserIdx >= 0 ? lastUserIdx + 1 : 0;
  for (let i = startIdx; i < messages.length; i++) {
    const msg = messages[i];
    if (!isRecord(msg)) continue;
    const role = typeof msg.role === 'string' ? msg.role.trim().toLowerCase() : '';
    if (role !== 'assistant') continue;
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content as Array<Record<string, unknown>>) {
      if (!isRecord(block)) continue;
      if (block.type !== 'toolCall' || block.name !== 'message') continue;
      const args = block.arguments;
      if (!isRecord(args)) continue;
      const filePath = typeof args.filePath === 'string' ? args.filePath.trim() : '';
      if (filePath && !seen.has(filePath)) {
        seen.add(filePath);
        filePaths.push(filePath);
      }
    }
  }
  return filePaths;
};

/**
 * Extract and concatenate all assistant text from the current turn in chat.history.
 * The current turn starts after the last user message.
 */
const extractCurrentTurnAssistantText = (messages: unknown[]): string => {
  // Find the last user message index (turn boundary)
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (isRecord(msg) && (msg as Record<string, unknown>).role === 'user') {
      lastUserIdx = i;
      break;
    }
  }

  const startIdx = lastUserIdx >= 0 ? lastUserIdx + 1 : 0;
  const textParts: string[] = [];
  for (let i = startIdx; i < messages.length; i++) {
    const msg = messages[i];
    if (!isRecord(msg)) continue;
    const role = typeof msg.role === 'string' ? msg.role.trim().toLowerCase() : '';
    if (role !== 'assistant') continue;
    let text = extractMessageText(msg).trim();
    text = stripTrailingSilentReplyToken(text);
    if (text && !isTransientGatewayStatusText(text)) {
      textParts.push(text);
    }
  }
  return textParts.join('\n\n');
};

const extractCurrentTurnAssistantMetadata = (messages: unknown[]): CoworkMessage['metadata'] | undefined => {
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (isRecord(msg) && msg.role === 'user') {
      lastUserIdx = i;
      break;
    }
  }

  const startIdx = lastUserIdx >= 0 ? lastUserIdx + 1 : 0;
  let latestMetadata: CoworkMessage['metadata'] | undefined;
  for (let i = startIdx; i < messages.length; i++) {
    const entry = extractGatewayHistoryEntries([messages[i]])[0];
    if (!entry || entry.role !== 'assistant') continue;
    const text = entry.text.trim();
    if (!text || isTransientGatewayStatusText(text)) continue;
    latestMetadata = buildAssistantMetadataFromHistoryEntry(entry) ?? latestMetadata;
  }
  return latestMetadata;
};

const isDroppedBoundaryTextBlockSubset = (streamedTextBlocks: string[], finalTextBlocks: string[]): boolean => {
  if (finalTextBlocks.length === 0 || finalTextBlocks.length >= streamedTextBlocks.length) {
    return false;
  }
  if (finalTextBlocks.every((block, index) => streamedTextBlocks[index] === block)) {
    return true;
  }
  const suffixStart = streamedTextBlocks.length - finalTextBlocks.length;
  return finalTextBlocks.every((block, index) => streamedTextBlocks[suffixStart + index] === block);
};

const extractToolText = (payload: unknown): string => {
  if (typeof payload === 'string') {
    return payload;
  }

  if (Array.isArray(payload)) {
    const lines = payload
      .map((item) => extractToolText(item).trim())
      .filter(Boolean);
    if (lines.length > 0) {
      return lines.join('\n');
    }
  }

  if (!isRecord(payload)) {
    if (payload === undefined || payload === null) return '';
    try {
      return JSON.stringify(payload, null, 2);
    } catch {
      return String(payload);
    }
  }

  if (typeof payload.text === 'string' && payload.text.trim()) {
    return payload.text;
  }
  if (typeof payload.output === 'string' && payload.output.trim()) {
    return payload.output;
  }
  if (typeof payload.stdout === 'string' || typeof payload.stderr === 'string') {
    const chunks = [
      typeof payload.stdout === 'string' ? payload.stdout : '',
      typeof payload.stderr === 'string' ? payload.stderr : '',
    ].filter(Boolean);
    if (chunks.length > 0) {
      return chunks.join('\n');
    }
  }

  const content = payload.content;
  if (typeof content === 'string' && content.trim()) {
    return content;
  }
  if (Array.isArray(content)) {
    const chunks: string[] = [];
    for (const item of content) {
      if (typeof item === 'string' && item.trim()) {
        chunks.push(item);
        continue;
      }
      if (!isRecord(item)) continue;
      if (typeof item.text === 'string' && item.text.trim()) {
        chunks.push(item.text);
        continue;
      }
      if (typeof item.content === 'string' && item.content.trim()) {
        chunks.push(item.content);
      }
    }
    if (chunks.length > 0) {
      return chunks.join('\n');
    }
  }

  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
};

const toToolInputRecord = (value: unknown): Record<string, unknown> => {
  if (isRecord(value)) {
    return value;
  }
  if (value === undefined || value === null) {
    return {};
  }
  return { value };
};

const mergeStreamingText = (
  previousText: string,
  incomingText: string,
  mode: TextStreamMode,
): { text: string; mode: TextStreamMode } => {
  if (!incomingText) {
    return { text: previousText, mode };
  }
  if (!previousText) {
    return { text: incomingText, mode };
  }
  if (incomingText === previousText) {
    return { text: previousText, mode };
  }

  if (mode === 'snapshot') {
    if (previousText.startsWith(incomingText) && incomingText.length < previousText.length) {
      return { text: previousText, mode };
    }
    return { text: incomingText, mode };
  }

  if (mode === 'delta') {
    if (incomingText.startsWith(previousText)) {
      return { text: incomingText, mode: 'snapshot' };
    }
    return { text: previousText + incomingText, mode };
  }

  if (incomingText.startsWith(previousText)) {
    return { text: incomingText, mode: 'snapshot' };
  }
  if (previousText.startsWith(incomingText)) {
    return { text: previousText, mode: 'snapshot' };
  }
  if (incomingText.includes(previousText) && incomingText.length > previousText.length) {
    return { text: incomingText, mode: 'snapshot' };
  }

  // Do not infer suffix-prefix overlap after snapshot detection fails. Token
  // boundaries can naturally repeat characters, e.g. ".p" + "ptx"; trimming the
  // apparent overlap would corrupt file names such as ".pptx" into ".ptx".
  return { text: previousText + incomingText, mode: 'delta' };
};

export const __openclawRuntimeAdapterTestUtils = {
  mergeStreamingText,
  computeContextPercent,
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const waitWithTimeout = async (promise: Promise<void>, timeoutMs: number): Promise<void> => {
  let timeoutId: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<void>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`OpenClaw gateway client connect timeout after ${timeoutMs}ms.`));
    }, timeoutMs);
  });
  try {
    await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

export class OpenClawRuntimeAdapter extends EventEmitter implements CoworkRuntime {
  private readonly store: CoworkStore;
  private readonly engineManager: OpenClawEngineManager;
  private readonly options: OpenClawRuntimeAdapterOptions;
  private readonly activeTurns = new Map<string, ActiveTurn>();
  private readonly sessionIdBySessionKey = new Map<string, string>();
  private readonly sessionIdByRunId = new Map<string, string>();
  private readonly pendingAgentEventsByRunId = new Map<string, AgentEventPayload[]>();
  private readonly lastChatSeqByRunId = new Map<string, number>();
  private readonly lastAgentSeqByRunId = new Map<string, number>();
  private readonly pendingApprovals = new Map<string, PendingApprovalEntry>();
  private readonly pendingTurns = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
  private readonly confirmationModeBySession = new Map<string, 'modal' | 'text'>();
  private readonly bridgedSessions = new Set<string>();
  private readonly lastSystemPromptBySession = new Map<string, string>();
  private readonly lastPatchedModelBySession = new Map<string, string>();
  private readonly sessionModelPatchQueue = new Map<string, Promise<void>>();
  private readonly gatewayHistoryCountBySession = new Map<string, number>();
  private readonly latestTurnTokenBySession = new Map<string, number>();

  private gatewayClient: GatewayClientLike | null = null;
  private gatewayClientVersion: string | null = null;
  private gatewayClientEntryPath: string | null = null;
  /** Holds the client between start() and onHelloOk so stopGatewayClient can clean it up. */
  private pendingGatewayClient: GatewayClientLike | null = null;
  private gatewayReadyPromise: Promise<void> | null = null;
  /** Serializes concurrent calls to ensureGatewayClientReady to prevent duplicate clients. */
  private gatewayClientInitLock: Promise<void> | null = null;
  private channelSessionSync: OpenClawChannelSessionSync | null = null;
  private readonly knownChannelSessionIds = new Set<string>();
  private readonly fullySyncedSessions = new Set<string>();
  /** Per-session cursor: number of gateway history entries (user+assistant) already synced locally. */
  private readonly channelSyncCursor = new Map<string, number>();
  /** Sessions re-created after user deletion — use latestOnly sync to avoid replaying old history. */
  private readonly reCreatedChannelSessionIds = new Set<string>();
  /** Channel sessionKeys explicitly deleted by the user. Polling will not re-create these. */
  private readonly deletedChannelKeys = new Set<string>();
  /** Sessions that were manually stopped by the user. Used to suppress the timeout hint
   *  when the gateway sends back a late 'aborted' event after stopSession() already cleaned up the turn. */
  private readonly manuallyStoppedSessions = new Set<string>();
  /** Timestamp of recent manual stops, used to suppress late gateway events that can recreate a ghost turn. */
  private readonly stoppedSessionTimestamps = new Map<string, number>();
  /** runId values that have already terminated with lifecycle phase=error. */
  private readonly terminatedRunIds = new Set<string>();
  /**
   * Recently completed/aborted/errored runIds are kept briefly so late gateway
   * events cannot re-create a ghost turn or attach to the next user turn.
   */
  private readonly recentlyClosedRunIds = new Map<string, number>();
  /** Session keys whose origin is "heartbeat" — discovered via polling, used to filter real-time events. */
  private readonly heartbeatSessionKeys = new Set<string>();
  /** Authoritative context window tokens from OpenClaw sessions.list, keyed by sessionKey. */
  private readonly sessionContextTokensCache = new Map<string, number>();
  private channelPollingTimer: ReturnType<typeof setInterval> | null = null;

  private static readonly CHANNEL_POLL_INTERVAL_MS = 10_000;
  private static readonly STOP_COOLDOWN_MS = 10_000;
  private static readonly FULL_HISTORY_SYNC_LIMIT = 50;
  private browserPrewarmAttempted = false;

  /** Gateway WS auto-reconnect state */
  private gatewayReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private gatewayReconnectAttempt = 0;
  /** Set to true before intentionally stopping the client (e.g. version upgrade) to suppress auto-reconnect. */
  private gatewayStoppingIntentionally = false;
  private readonly intentionallyStoppedGatewayClients = new WeakSet<GatewayClientLike>();
  private static readonly GATEWAY_RECONNECT_MAX_ATTEMPTS = 10;
  private static readonly GATEWAY_RECONNECT_DELAYS = [2_000, 5_000, 10_000, 15_000, 30_000]; // ms
  private static readonly RECENTLY_CLOSED_RUN_ID_TTL_MS = 120_000;
  private static readonly RECENTLY_CLOSED_RUN_ID_LIMIT = 1000;
  private static readonly RECENT_RUN_ID_LIMIT = 1000;
  private static readonly SESSION_CONTEXT_CACHE_LIMIT = 500;
  private static readonly SESSION_KEY_CACHE_LIMIT = 1000;
  private static readonly DELETED_CHANNEL_KEY_LIMIT = 500;

  /** Gateway tick heartbeat watchdog state */
  private lastTickTimestamp = 0;
  private tickWatchdogTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly TICK_WATCHDOG_INTERVAL_MS = 60_000; // check every 60s
  private static readonly TICK_TIMEOUT_MS = 90_000; // 3 tick cycles (30s each) without response → dead

  /** Throttle state for messageUpdate IPC emissions during streaming */
  private lastMessageUpdateEmitTime: Map<string, number> = new Map();
  private pendingMessageUpdateTimer: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private static readonly MESSAGE_UPDATE_THROTTLE_MS = 200;

  /** Throttle state for SQLite store writes during streaming */
  private lastStoreUpdateTime: Map<string, number> = new Map();
  private pendingStoreUpdateTimer: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private static readonly STORE_UPDATE_THROTTLE_MS = 250;
  private readonly subagentTracker: SubagentTracker | null;

  /**
   * Server-side agent timeout in seconds (mirrors agents.defaults.timeoutSeconds in openclaw config).
   * Used to set a client-side fallback timer that fires slightly after the server timeout,
   * so LobsterAI can recover even when the gateway fails to deliver the abort event.
   */
  agentTimeoutSeconds = OPENCLAW_AGENT_TIMEOUT_SECONDS;
  private static readonly CLIENT_TIMEOUT_GRACE_MS = 30_000;

  constructor(
    store: CoworkStore,
    engineManager: OpenClawEngineManager,
    options: OpenClawRuntimeAdapterOptions = {},
    subagentRunStore?: SubagentRunStore,
    subagentMessageStore?: SubagentMessageStore,
  ) {
    super();
    this.store = store;
    this.engineManager = engineManager;
    this.options = options;
    this.subagentTracker = subagentRunStore
      ? new SubagentTracker(subagentRunStore, subagentMessageStore ?? null, () => this.gatewayClient)
      : null;
  }

  private normalizeModelRef(modelRef: string): string {
    const normalized = modelRef.trim();
    if (!normalized) return normalized;
    return this.options.normalizeModelRef?.(normalized) ?? normalized;
  }

  private rememberSessionContextTokens(row: unknown): void {
    if (!isRecord(row)) return;
    const key = typeof row.key === 'string' ? row.key : '';
    const contextTokens = row.contextTokens;
    if (!key || typeof contextTokens !== 'number' || !Number.isFinite(contextTokens) || contextTokens <= 0) {
      return;
    }
    this.sessionContextTokensCache.set(key, contextTokens);
    this.pruneMapToLimit(
      this.sessionContextTokensCache,
      OpenClawRuntimeAdapter.SESSION_CONTEXT_CACHE_LIMIT,
    );
  }

  private async refreshSessionContextTokens(sessionKey: string): Promise<number | undefined> {
    const cached = this.sessionContextTokensCache.get(sessionKey);
    if (cached !== undefined) return cached;

    const client = this.gatewayClient;
    if (!client) return undefined;

    try {
      const result = await client.request<{ sessions?: unknown[] }>('sessions.list', {
        activeMinutes: 60,
        limit: 50,
      }, { timeoutMs: 5_000 });
      const sessions = result?.sessions;
      if (Array.isArray(sessions)) {
        for (const row of sessions) {
          this.rememberSessionContextTokens(row);
        }
      }
      return this.sessionContextTokensCache.get(sessionKey);
    } catch (error) {
      console.debug('[OpenClawRuntime] failed to refresh session context tokens:', error);
      return undefined;
    }
  }

  private enrichAssistantMetadataWithCachedContext(
    sessionKey: string,
    metadata: CoworkMessage['metadata'] | undefined,
  ): CoworkMessage['metadata'] | undefined {
    const inputTokens = extractInputTokensFromMetadata(metadata);
    if (inputTokens === undefined || metadata?.contextPercent !== undefined) {
      return metadata;
    }

    const contextPercent = computeContextPercent(
      inputTokens,
      this.sessionContextTokensCache.get(sessionKey),
    );
    if (contextPercent === undefined) return metadata;

    return {
      ...(metadata ?? {}),
      contextPercent,
    };
  }

  private async enrichAssistantMetadataWithContext(
    sessionKey: string,
    metadata: CoworkMessage['metadata'] | undefined,
  ): Promise<CoworkMessage['metadata'] | undefined> {
    const cachedMetadata = this.enrichAssistantMetadataWithCachedContext(sessionKey, metadata);
    if (cachedMetadata?.contextPercent !== undefined || metadata?.contextPercent !== undefined) {
      return cachedMetadata;
    }

    const inputTokens = extractInputTokensFromMetadata(metadata);
    if (inputTokens === undefined) return metadata;

    const contextTokens = await this.refreshSessionContextTokens(sessionKey);
    const contextPercent = computeContextPercent(inputTokens, contextTokens);
    if (contextPercent === undefined) return metadata;

    return {
      ...(metadata ?? {}),
      contextPercent,
    };
  }

  setChannelSessionSync(sync: OpenClawChannelSessionSync): void {
    this.channelSessionSync = sync;
  }

  /**
   * Fetch session history from OpenClaw by sessionKey and return a transient
   * CoworkSession object (not persisted to local database).
   * First checks if a local session already exists via channel sync.
   * Returns a CoworkSession if successful, or null.
   */
  async fetchSessionByKey(sessionKey: string): Promise<CoworkSession | null> {
    const managedSession = parseManagedSessionKey(sessionKey);
    if (managedSession) {
      return this.store.getSession(managedSession.sessionId) ?? null;
    }

    // 1. Try existing local session via channel/main-agent resolution
    if (this.channelSessionSync) {
      const existingId = this.channelSessionSync.resolveSession(sessionKey);
      if (existingId) {
        const session = this.store.getSession(existingId);
        if (session && session.messages.length > 0) {
          return session;
        }
      }
    }

    const transcriptSession = await this.readTranscriptSessionByKey(sessionKey);
    if (transcriptSession) {
      return transcriptSession;
    }

    // 2. Fetch history from OpenClaw server and build a transient session object
    const client = this.gatewayClient;
    if (!client) return null;

    try {
      const history = await client.request<{ messages?: unknown[] }>('chat.history', {
        sessionKey,
        limit: OpenClawRuntimeAdapter.FULL_HISTORY_SYNC_LIMIT,
      }, { timeoutMs: 10_000 });
      if (!Array.isArray(history?.messages) || history.messages.length === 0) {
        return this.readFromDeletedTranscript(sessionKey);
      }

      const now = Date.now();
      const messages: CoworkMessage[] = [];
      let msgIndex = 0;

      for (const entry of extractGatewayHistoryEntries(history.messages)) {
        messages.push({
          id: `transient-${msgIndex++}`,
          type: entry.role,
          content: entry.text,
          timestamp: now,
          metadata: entry.role === 'assistant' ? { isStreaming: false, isFinal: true } : {},
        });
      }

      if (messages.length === 0) return null;

      // Return a transient session (not saved to database)
      return {
        id: `transient-${sessionKey}`,
        title: sessionKey.split(':').pop() || 'Cron Session',
        claudeSessionId: null,
        status: 'completed' as CoworkSessionStatus,
        pinned: false,
        cwd: '',
        systemPrompt: '',
        modelOverride: '',
        executionMode: 'local' as CoworkExecutionMode,
        activeSkillIds: [],
        messages,
        agentId: 'main',
        createdAt: now,
        updatedAt: now,
      };
    } catch (error) {
      console.error('[OpenClawRuntime] fetchSessionByKey: failed to fetch history:', error);
      return null;
    }
  }

  /**
   * Prefer local transcript files for task-history replay so we can preserve
   * full turn history and tool records instead of relying on byte-limited
   * chat.history windows.
   */
  private async readTranscriptSessionByKey(sessionKey: string): Promise<CoworkSession | null> {
    try {
      const agentMatch = sessionKey.match(/^agent:([^:]+):/);
      const agentId = agentMatch?.[1] ?? 'main';
      const runMatch = sessionKey.match(/(?:^|:)run:([0-9a-f-]{36})(?:$|:)/i);
      const sessionId = runMatch?.[1];
      if (!sessionId) return null;

      const stateDir = this.engineManager.getStateDir();
      const sessionsDir = path.join(stateDir, 'agents', agentId, 'sessions');
      const activeFilePath = path.join(sessionsDir, `${sessionId}.jsonl`);

      let targetFilePath: string | null = null;
      if (fs.existsSync(activeFilePath)) {
        targetFilePath = activeFilePath;
      } else {
        const files = await fs.promises.readdir(sessionsDir).catch(() => [] as string[]);
        const deletedFile = files
          .filter((fileName) => fileName.startsWith(`${sessionId}.jsonl.deleted.`))
          .sort((left, right) => right.localeCompare(left))[0];
        if (deletedFile) {
          targetFilePath = path.join(sessionsDir, deletedFile);
        }
      }

      if (!targetFilePath) {
        return null;
      }

      const fileContent = await fs.promises.readFile(targetFilePath, 'utf-8');
      return buildTransientSessionFromOpenClawTranscript({
        sessionKey,
        title: sessionKey.split(':').pop() || 'Cron Session',
        fileContent,
      });
    } catch (error) {
      console.warn('[OpenClawRuntime] readTranscriptSessionByKey failed:', error);
      return null;
    }
  }

  /**
   * Fallback for fetchSessionByKey when chat.history returns no messages.
   *
   * openclaw's maintenance logic may archive a session transcript by renaming
   * `{sessionId}.jsonl` → `{sessionId}.jsonl.deleted.{timestamp}` while the
   * session entry remains in sessions.json. In that case chat.history cannot
   * find the file (it only looks for the plain `.jsonl` path) and returns [].
   * This method reads the archived file directly from disk.
   */
  private async readFromDeletedTranscript(sessionKey: string): Promise<CoworkSession | null> {
    try {
      return this.readTranscriptSessionByKey(sessionKey);
    } catch (error) {
      console.warn('[OpenClawRuntime] readFromDeletedTranscript failed:', error);
      return null;
    }
  }

  /**
   * Ensure the gateway WebSocket client is connected.
   * Called when IM channels (e.g. Telegram) are enabled in OpenClaw mode
   * so that channel-originated events can be received without waiting
   * for a LobsterAI-initiated session.
   */
  async connectGatewayIfNeeded(): Promise<void> {
    if (this.gatewayClient) {
      console.log('[ChannelSync] connectGatewayIfNeeded: gateway client already exists, skipping');
      return;
    }
    console.log('[ChannelSync] connectGatewayIfNeeded: no gateway client, initializing...');
    try {
      await this.ensureGatewayClientReady();
      console.log('[ChannelSync] connectGatewayIfNeeded: gateway client ready, starting channel polling');
      this.startChannelPolling();
    } catch (error) {
      console.error('[ChannelSync] connectGatewayIfNeeded: failed to initialize gateway client:', error);
      throw error;
    }
  }

  /**
   * Force-reconnect the gateway WebSocket client.
   * Used after the OpenClaw gateway process has been restarted (e.g. after config sync).
   * Unlike `connectGatewayIfNeeded`, this always tears down the old client first
   * to avoid a race where the old client's `onClose` fires after a new client is created.
   */
  async reconnectGateway(): Promise<void> {
    console.log('[ChannelSync] reconnectGateway: tearing down old client and reconnecting...');
    this.stopGatewayClient();
    try {
      await this.ensureGatewayClientReady();
      console.log('[ChannelSync] reconnectGateway: gateway client ready, starting channel polling');
      this.startChannelPolling();
    } catch (error) {
      console.error('[ChannelSync] reconnectGateway: failed to initialize gateway client:', error);
      throw error;
    }
  }

  /**
   * Explicitly disconnect the gateway WebSocket client.
   * Called before the OpenClaw gateway process is restarted so that the old
   * client's async `onClose` handler cannot interfere with a subsequently
   * created client.
   */
  disconnectGatewayClient(): void {
    console.log('[ChannelSync] disconnectGatewayClient: explicitly tearing down gateway client');
    this.stopGatewayClient();
  }


  /**
   * Start periodic polling for channel-originated sessions (e.g. Telegram).
   * Uses the gateway `sessions.list` RPC to discover sessions that may not
   * have been delivered via WebSocket events.
   */
  startChannelPolling(): void {
    if (!this.channelSessionSync) {
      console.warn('[ChannelSync] startChannelPolling: no channelSessionSync set, skipping');
      return;
    }
    // Already running
    if (this.channelPollingTimer) {
      console.debug('[ChannelSync] channel polling is already running');
      return;
    }

    console.log('[ChannelSync] startChannelPolling: starting periodic channel session discovery');
    // Run once immediately, then at interval
    void this.pollChannelSessions();
    this.channelPollingTimer = setInterval(() => {
      void this.pollChannelSessions();
    }, OpenClawRuntimeAdapter.CHANNEL_POLL_INTERVAL_MS);
  }

  stopChannelPolling(): void {
    if (this.channelPollingTimer) {
      clearInterval(this.channelPollingTimer);
      this.channelPollingTimer = null;
    }
  }

  private async pollChannelSessions(): Promise<void> {
    if (!this.gatewayClient || !this.channelSessionSync) {
      console.debug('[ChannelSync] skipped channel polling because gateway client or sync service is missing');
      return;
    }
    try {
      const params = { activeMinutes: 60, limit: CHANNEL_SESSION_DISCOVERY_LIMIT };
      const result = await this.gatewayClient.request('sessions.list', params);
      const sessions = (result as Record<string, unknown>)?.sessions;
      if (!Array.isArray(sessions)) {
        console.warn('[ChannelSync] pollChannelSessions: sessions.list returned non-array sessions:', typeof sessions, 'full result keys:', Object.keys(result as Record<string, unknown>));
        return;
      }
      let hasNew = false;
      let channelCount = 0;
      const newSessionsToSync: Array<{ sessionId: string; sessionKey: string }> = [];
      for (const row of sessions) {
        this.rememberSessionContextTokens(row);
        const key = typeof row?.key === 'string' ? row.key : '';
        if (!key) continue;
        // Skip heartbeat-originated sessions (origin.label === 'heartbeat')
        if (isRecord(row)) {
          const rowOrigin = (row as Record<string, unknown>).origin;
          if (isRecord(rowOrigin) && (rowOrigin as Record<string, unknown>).label === 'heartbeat') {
            this.heartbeatSessionKeys.add(key);
            continue;
          }
        }
        const isChannel = this.channelSessionSync.isChannelSessionKey(key);
        if (!isChannel) continue;
        // Skip keys that were explicitly deleted by the user — only real-time events re-create them
        if (this.deletedChannelKeys.has(key)) continue;
        // Skip gateway sessions belonging to a previously-bound agent.
        // After an agent binding change, the gateway retains old sessions under the old agentId.
        // Only process sessions matching the current platformAgentBindings.
        if (!this.channelSessionSync.isCurrentBindingKey(key)) continue;
        channelCount++;
        // Use resolveOrCreateSession so new channel sessions are auto-created
        const sessionId = this.channelSessionSync.resolveOrCreateSession(key);
        if (sessionId && !this.knownChannelSessionIds.has(sessionId)) {
          this.knownChannelSessionIds.add(sessionId);
          this.rememberSessionKey(sessionId, key);
          hasNew = true;
          // Queue full history sync for newly discovered sessions
          if (!this.fullySyncedSessions.has(sessionId)) {
            newSessionsToSync.push({ sessionId, sessionKey: key });
          }
        }
      }
      if (hasNew) {
        let notified = 0;
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send('cowork:sessions:changed');
            notified++;
          }
        }
        console.log('[ChannelSync] discovered', channelCount, 'channel sessions, notified', notified, 'windows');
      }
      // Sync full history for newly discovered sessions
      for (const { sessionId, sessionKey } of newSessionsToSync) {
        await this.syncFullChannelHistory(sessionId, sessionKey);
      }

      // Incremental sync for already-known sessions: check if the gateway has messages
      // that weren't picked up during initial sync or real-time events.
      if (channelCount > 0) {
        const syncedThisCycle = new Set<string>();
        for (const row of sessions) {
          const key = typeof row?.key === 'string' ? row.key : '';
          if (!key) continue;
          if (!this.channelSessionSync.isChannelSessionKey(key)) continue;
          if (this.deletedChannelKeys.has(key)) continue;
          if (this.heartbeatSessionKeys.has(key)) continue;
          // Skip sessions belonging to a previously-bound agent
          if (!this.channelSessionSync.isCurrentBindingKey(key)) continue;
          const sessionId = this.sessionIdBySessionKey.get(key);
          if (!sessionId || !this.fullySyncedSessions.has(sessionId)) continue;
          // Safety net: only sync each sessionId once per poll cycle
          if (syncedThisCycle.has(sessionId)) continue;
          syncedThisCycle.add(sessionId);
          // Skip sessions with an active turn (they handle their own sync)
          if (this.activeTurns.has(sessionId)) continue;
          try {
            await this.incrementalChannelSync(sessionId, key);
          } catch (err) {
            console.warn('[ChannelSync] incremental sync failed for', key, err);
          }
        }
      }
    } catch (error) {
      console.error('[ChannelSync] pollChannelSessions: error during polling:', error);
    }
  }

  override on<U extends keyof CoworkRuntimeEvents>(
    event: U,
    listener: CoworkRuntimeEvents[U],
  ): this {
    return super.on(event, listener);
  }

  override off<U extends keyof CoworkRuntimeEvents>(
    event: U,
    listener: CoworkRuntimeEvents[U],
  ): this {
    return super.off(event, listener);
  }

  async startSession(sessionId: string, prompt: string, options: CoworkStartOptions = {}): Promise<void> {
    await this.runTurn(sessionId, prompt, {
      skipInitialUserMessage: options.skipInitialUserMessage,
      skillIds: options.skillIds,
      systemPrompt: options.systemPrompt,
      confirmationMode: options.confirmationMode,
      imageAttachments: options.imageAttachments,
      agentId: options.agentId,
    });
  }

  async continueSession(sessionId: string, prompt: string, options: CoworkContinueOptions = {}): Promise<void> {
    await this.runTurn(sessionId, prompt, {
      skipInitialUserMessage: options.skipInitialUserMessage ?? false,
      systemPrompt: options.systemPrompt,
      skillIds: options.skillIds,
      imageAttachments: options.imageAttachments,
    });
  }

  async patchSession(sessionId: string, patch: OpenClawSessionPatch): Promise<void> {
    const session = this.store.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const activeTurnSessionKey = this.activeTurns.get(sessionId)?.sessionKey?.trim();
    const rememberedSessionKey = this.getSessionKeysForSession(sessionId)
      .find((key) => !isManagedSessionKey(key));
    const persistedChannelSession = this.channelSessionSync
      ?.getOpenClawSessionKeyForCoworkSession(sessionId);
    const persistedChannelSessionKey = persistedChannelSession?.sessionKey
      && !isManagedSessionKey(persistedChannelSession.sessionKey)
      ? persistedChannelSession.sessionKey
      : '';
    const agentId = session.agentId || 'main';
    const sessionKey = activeTurnSessionKey
      || rememberedSessionKey
      || persistedChannelSessionKey;
    if (!sessionKey && persistedChannelSession?.isChannelSession) {
      throw new Error('Cannot patch IM channel session because the OpenClaw session key is missing.');
    }
    const targetSessionKey = sessionKey || this.toSessionKey(sessionId, agentId);

    this.rememberSessionKey(sessionId, targetSessionKey);
    await this.ensureGatewayClientReady();

    const normalizedPatch: OpenClawSessionPatch = {
      ...patch,
      ...(patch.model !== undefined
        ? { model: patch.model ? this.normalizeModelRef(patch.model) : patch.model }
        : {}),
    };

    const sendPatch = async (): Promise<void> => {
      const client = this.requireGatewayClient();
      await client.request('sessions.patch', {
        key: targetSessionKey,
        ...normalizedPatch,
      });
    };

    if (normalizedPatch.model !== undefined) {
      await this.enqueueSessionModelPatch(sessionId, sendPatch);
      this.lastPatchedModelBySession.delete(sessionId);
      return;
    }

    await sendPatch();
  }

  stopSession(sessionId: string): void {
    this.manuallyStoppedSessions.add(sessionId);
    this.stoppedSessionTimestamps.set(sessionId, Date.now());
    const turn = this.activeTurns.get(sessionId);
    if (turn) {
      turn.stopRequested = true;
      const client = this.gatewayClient;
      if (client) {
        void client.request('chat.abort', {
          sessionKey: turn.sessionKey,
          runId: turn.runId,
        }).catch((error) => {
          console.warn('[OpenClawRuntime] Failed to abort chat run:', error);
        });
      }
    }

    this.cleanupSessionTurn(sessionId);
    this.clearPendingApprovalsBySession(sessionId);
    this.store.updateSession(sessionId, { status: 'idle' });
    this.emit('sessionStopped', sessionId);
    this.resolveTurn(sessionId);
  }

  stopAllSessions(): void {
    const activeSessionIds = Array.from(this.activeTurns.keys());
    activeSessionIds.forEach((sessionId) => {
      this.stopSession(sessionId);
    });
  }

  async resetSessionHistory(sessionId: string): Promise<void> {
    const session = this.store.getSession(sessionId);
    if (!session) return;
    const sessionKey = this.toSessionKey(sessionId, session.agentId);
    if (this.activeTurns.has(sessionId)) {
      throw new Error(`Session ${sessionId} is still running.`);
    }

    this.bridgedSessions.delete(sessionId);
    this.lastSystemPromptBySession.delete(sessionId);
    this.lastPatchedModelBySession.delete(sessionId);
    this.sessionContextTokensCache.delete(sessionKey);

    const client = this.gatewayClient;
    if (!client) return;

    try {
      await client.request('sessions.reset', {
        key: sessionKey,
        reason: 'reset',
      }, { timeoutMs: 10_000 });
    } catch (error) {
      console.warn('[OpenClawRuntime] failed to reset gateway session history after message edit:', error);
    }
  }

  respondToPermission(requestId: string, result: PermissionResult): void {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) {
      return;
    }

    const decision = result.behavior !== 'allow' ? 'deny'
      : pending.allowAlways ? 'allow-always'
      : 'allow-once';
    const client = this.gatewayClient;
    if (!client) {
      this.pendingApprovals.delete(requestId);
      return;
    }

    const sessionId = pending.sessionId;
    // Only schedule continuation for user-initiated approvals (desktop modal),
    // not for auto-approved commands (allowAlways).
    const needsContinuation = !pending.allowAlways;

    void client.request('exec.approval.resolve', {
      id: requestId,
      decision,
    }).then(() => {
      if (!needsContinuation) return;
      // Continue the session so the model can see the command result.
      const prompt = decision !== 'deny'
        ? t('execApprovalApproved')
        : t('execApprovalDenied');
      const tryContinue = (retries: number) => {
        if (!this.store.getSession(sessionId)) return; // session deleted
        if (!this.isSessionActive(sessionId)) {
          void this.continueSession(sessionId, prompt).catch((error) => {
            console.warn('[OpenClawRuntime] failed to continue session after approval:', error);
          });
          return;
        }
        // Session still active (user approved before run ended). Retry after delay.
        if (retries > 0) {
          setTimeout(() => tryContinue(retries - 1), 1000);
        }
      };
      tryContinue(10);
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.emit('error', sessionId, `Failed to resolve OpenClaw approval: ${message}`);
    }).finally(() => {
      this.pendingApprovals.delete(requestId);
    });
  }

  isSessionActive(sessionId: string): boolean {
    return this.activeTurns.has(sessionId);
  }

  hasActiveSessions(): boolean {
    return this.activeTurns.size > 0;
  }

  getSessionConfirmationMode(sessionId: string): 'modal' | 'text' | null {
    return this.confirmationModeBySession.get(sessionId) ?? null;
  }

  private async enqueueSessionModelPatch(sessionId: string, task: () => Promise<void>): Promise<void> {
    const previous = this.sessionModelPatchQueue.get(sessionId) ?? Promise.resolve();
    const next = previous.catch((): void => undefined).then(task);
    this.sessionModelPatchQueue.set(sessionId, next);

    try {
      await next;
    } finally {
      if (this.sessionModelPatchQueue.get(sessionId) === next) {
        this.sessionModelPatchQueue.delete(sessionId);
      }
    }
  }

  private async ensureSessionModelForTurn(options: {
    sessionId: string;
    sessionKey: string;
    model: string;
    source: 'sessionOverride' | 'agentModel';
  }): Promise<void> {
    const { sessionId, sessionKey, model, source } = options;
    if (!model) {
      this.lastPatchedModelBySession.delete(sessionId);
      return;
    }

    const mustPatchBeforeTurn = source === 'sessionOverride';
    if (!mustPatchBeforeTurn && model === this.lastPatchedModelBySession.get(sessionId)) {
      return;
    }

    try {
      await this.enqueueSessionModelPatch(sessionId, async () => {
        if (!mustPatchBeforeTurn && model === this.lastPatchedModelBySession.get(sessionId)) {
          return;
        }

        const client = this.requireGatewayClient();
        console.debug(
          '[OpenClawRuntime] patching the session model before chat.send',
          `sessionId=${sessionId}`,
          `sessionKey=${sessionKey}`,
          `model=${model}`,
          `source=${source}`,
        );
        await client.request('sessions.patch', { key: sessionKey, model });
        this.lastPatchedModelBySession.set(sessionId, model);
      });
    } catch (error) {
      console.warn('[OpenClawRuntime] failed to patch the session model before chat.send:', error);
      if (mustPatchBeforeTurn) {
        throw error;
      }
    }
  }

  private async runTurn(
    sessionId: string,
    prompt: string,
    options: {
      skipInitialUserMessage?: boolean;
      systemPrompt?: string;
      skillIds?: string[];
      confirmationMode?: 'modal' | 'text';
      imageAttachments?: Array<{ name: string; mimeType: string; base64Data: string }>;
      agentId?: string;
    },
  ): Promise<void> {
    if (!prompt.trim() && (!options.imageAttachments || options.imageAttachments.length === 0)) {
      throw new Error('Prompt is required.');
    }
    if (this.activeTurns.has(sessionId)) {
      throw new Error(`Session ${sessionId} is still running.`);
    }

    const session = this.store.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const confirmationMode = options.confirmationMode
      ?? this.confirmationModeBySession.get(sessionId)
      ?? 'modal';
    this.confirmationModeBySession.set(sessionId, confirmationMode);

    if (!options.skipInitialUserMessage) {
      const agentForMetadata = this.store.getAgent(options.agentId || session.agentId || 'main');
      const effectiveSkillIds = mergeAgentSkillIds(options.skillIds, agentForMetadata);
      const metadata = (effectiveSkillIds.length || options.imageAttachments?.length)
        ? {
          ...(effectiveSkillIds.length ? { skillIds: effectiveSkillIds } : {}),
          ...stripCoworkImageAttachmentPayloads({ imageAttachments: options.imageAttachments }),
        }
        : undefined;
      const userMessage = this.store.addMessage(sessionId, {
        type: 'user',
        content: prompt,
        metadata,
      });
      this.emit('message', sessionId, userMessage);
    }

    const agentId = options.agentId || session.agentId || 'main';
    const sessionKey = this.toSessionKey(sessionId, agentId);
    this.rememberSessionKey(sessionId, sessionKey);

    this.store.updateSession(sessionId, { status: 'running' });
    setCoworkProxySessionId(sessionId);
    setCoworkProxyAgentId(agentId);
    await this.ensureGatewayClientReady();
    this.startChannelPolling();

    const runId = randomUUID();
    const turnToken = this.nextTurnToken(sessionId);

    const agent = this.store.getAgent(agentId);
    const effectiveSystemPrompt = mergeAgentInstructionPrompt(
      options.systemPrompt ?? session.systemPrompt,
      agent,
    );
    const rawCurrentModel = session.modelOverride || agent?.model || '';
    // Session modelOverride is user-selected and must not be rewritten by
    // provider migration; only agent-level refs are safe to normalize.
    const currentModel = session.modelOverride
      ? rawCurrentModel
      : (rawCurrentModel ? this.normalizeModelRef(rawCurrentModel) : '');
    if (!session.modelOverride && currentModel && currentModel !== rawCurrentModel && agent?.id) {
      this.store.updateAgent(agent.id, { model: currentModel });
    }
    const channelSessionKey = this.channelSessionSync
      ?.getOpenClawSessionKeyForCoworkSession(sessionId)
      .sessionKey;
    try {
      await this.ensureSessionModelForTurn({
        sessionId,
        sessionKey: channelSessionKey || sessionKey,
        model: currentModel,
        source: session.modelOverride ? 'sessionOverride' : 'agentModel',
      });
    } catch (error) {
      this.store.updateSession(sessionId, { status: 'error' });
      const message = error instanceof Error ? error.message : String(error);
      this.emit('error', sessionId, message);
      throw error;
    }

    const outboundMessage = await this.buildOutboundPrompt(
      sessionId,
      prompt,
      effectiveSystemPrompt,
      agentId,
    );
    const runCwd = session.cwd?.trim() ? path.resolve(session.cwd.trim()) : undefined;
    const completionPromise = new Promise<void>((resolve, reject) => {
      this.pendingTurns.set(sessionId, { resolve, reject });
    });
    this.manuallyStoppedSessions.delete(sessionId);
    this.stoppedSessionTimestamps.delete(sessionId);
    this.activeTurns.set(sessionId, {
      sessionId,
      sessionKey,
      runId,
      turnToken,
      startedAtMs: Date.now(),
      knownRunIds: new Set([runId]),
      assistantMessageId: null,
      committedAssistantText: '',
      currentAssistantSegmentText: '',
      currentText: '',
      agentAssistantTextLength: 0,
      hasSeenAgentAssistantStream: false,
      currentContentText: '',
      currentContentBlocks: [],
      sawNonTextContentBlocks: false,
      textStreamMode: 'unknown',
      toolUseMessageIdByToolCallId: new Map(),
      toolResultMessageIdByToolCallId: new Map(),
      toolResultTextByToolCallId: new Map(),
      stopRequested: false,
      pendingUserSync: false,
      bufferedChatPayloads: [],
      bufferedAgentPayloads: [],
    });
    this.sessionIdByRunId.set(runId, sessionId);

    // Start client-side timeout watchdog.
    // OpenClaw gateway has a known issue where embedded run timeouts may not
    // produce a WS abort/final event (the subscription is torn down before the
    // lifecycle event fires). This timer fires slightly after the server-side
    // timeout to recover the UI from a stuck "running" state.
    this.startTurnTimeoutWatchdog(sessionId);

    const client = this.requireGatewayClient();
    try {
      console.log('[OpenClawRuntime] chat.send params:', { sessionKey, messageLength: outboundMessage.length, runId });
      const attachments = options.imageAttachments?.length
        ? options.imageAttachments.map((img) => ({
          type: 'image',
          mimeType: img.mimeType,
          content: img.base64Data,
        }))
        : undefined;
      if (attachments) {
        console.log('[OpenClawRuntime] chat.send with attachments:', attachments.length, 'images,', attachments.map(a => ({ type: a.type, mimeType: a.mimeType, contentLength: a.content?.length ?? 0 })));
      }
      const chatSendStartMs = Date.now();
      const sendResult = await client.request<Record<string, unknown>>('chat.send', {
        sessionKey,
        message: outboundMessage,
        deliver: false,
        idempotencyKey: runId,
        ...(runCwd ? { cwd: runCwd } : {}),
        ...(attachments ? { attachments } : {}),
      }, { timeoutMs: 90_000 });
      const chatSendElapsedMs = Date.now() - chatSendStartMs;
      if (chatSendElapsedMs > 10_000) {
        console.warn(`[OpenClawRuntime] chat.send took ${chatSendElapsedMs}ms — gateway may still be initializing`);
      }
      const returnedRunId = typeof sendResult?.runId === 'string' ? sendResult.runId.trim() : '';
      if (returnedRunId) {
        this.bindRunIdToTurn(sessionId, returnedRunId);
      }
    } catch (error) {
      this.cleanupSessionTurn(sessionId);
      this.store.updateSession(sessionId, { status: 'error' });
      const message = error instanceof Error ? error.message : String(error);
      this.emit('error', sessionId, message);
      this.pendingTurns.delete(sessionId);
      throw error;
    }

    await completionPromise;
  }

  private async buildOutboundPrompt(
    sessionId: string,
    prompt: string,
    systemPrompt?: string,
    agentId?: string,
  ): Promise<string> {
    const normalizedSystemPrompt = (systemPrompt ?? '').trim();
    const previousSystemPrompt = this.lastSystemPromptBySession.get(sessionId) ?? '';
    const shouldInjectSystemPrompt = Boolean(
      normalizedSystemPrompt
      && normalizedSystemPrompt !== previousSystemPrompt,
    );

    if (normalizedSystemPrompt) {
      this.lastSystemPromptBySession.set(sessionId, normalizedSystemPrompt);
    } else {
      this.lastSystemPromptBySession.delete(sessionId);
    }

    const session = this.store.getSession(sessionId);
    const agent = agentId ? this.store.getAgent(agentId) : null;
    const currentModel = session?.modelOverride || agent?.model || '';

    const sections: string[] = [];
    if (shouldInjectSystemPrompt) {
      sections.push(this.buildSystemPromptPrefix(normalizedSystemPrompt));
    }
    sections.push(buildOpenClawLocalTimeContextPrompt());
    if (currentModel) {
      sections.push(`[Session info]\nCurrent model: ${currentModel}`);
    }

    if (this.bridgedSessions.has(sessionId)) {
      if (prompt.trim()) {
        sections.push(`[Current user request]\n${prompt}`);
      }
      return sections.join('\n\n');
    }

    const client = this.requireGatewayClient();
    const sessionKey = this.toSessionKey(sessionId, agentId);
    let hasHistory = false;
    try {
      const history = await client.request<{ messages?: unknown[] }>('chat.history', {
        sessionKey,
        limit: 1,
      }, { timeoutMs: 3_000 });
      hasHistory = Array.isArray(history?.messages) && history.messages.length > 0;
    } catch (error) {
      console.warn('[OpenClawRuntime] chat.history check failed, continuing without history guard:', error);
    }

    this.bridgedSessions.add(sessionId);

    if (!hasHistory) {
      if (session) {
        const bridgePrefix = this.buildBridgePrefix(session.messages, prompt);
        if (bridgePrefix) {
          sections.push(bridgePrefix);
        }
      }
    }

    if (prompt.trim()) {
      sections.push(`[Current user request]\n${prompt}`);
    }
    return sections.join('\n\n');
  }

  private buildSystemPromptPrefix(systemPrompt: string): string {
    return [
      '[LobsterAI system instructions]',
      'Apply the instructions below as the highest-priority guidance for this session.',
      'If earlier LobsterAI system instructions exist, replace them with this version.',
      systemPrompt,
    ].join('\n');
  }

  private buildBridgePrefix(messages: CoworkMessage[], currentPrompt: string): string {
    const normalizedCurrentPrompt = currentPrompt.trim();
    if (!normalizedCurrentPrompt) return '';

    const source = messages
      .filter((message) => {
        if (message.type !== 'user' && message.type !== 'assistant') {
          return false;
        }
        if (!message.content.trim()) {
          return false;
        }
        if (message.metadata?.isThinking) {
          return false;
        }
        return true;
      })
      .map((message) => ({
        type: message.type,
        content: message.content.trim(),
      }));

    if (source.length === 0) {
      return '';
    }

    if (source[source.length - 1]?.type === 'user'
      && source[source.length - 1]?.content === normalizedCurrentPrompt) {
      source.pop();
    }

    const recent = source.slice(-BRIDGE_MAX_MESSAGES);
    if (recent.length === 0) {
      return '';
    }

    const lines = recent.map((entry) => {
      const role = entry.type === 'user' ? 'User' : 'Assistant';
      return `${role}: ${truncate(entry.content, BRIDGE_MAX_MESSAGE_CHARS)}`;
    });

    return [
      '[Context bridge from previous LobsterAI conversation]',
      'Use this prior context for continuity. Focus your final answer on the current request.',
      ...lines,
    ].join('\n');
  }

  private async ensureGatewayClientReady(): Promise<void> {
    // Serialize concurrent calls: if another init is already in progress, wait for it.
    if (this.gatewayClientInitLock) {
      await this.gatewayClientInitLock;
      return;
    }
    this.gatewayClientInitLock = this._ensureGatewayClientReadyImpl();
    try {
      await this.gatewayClientInitLock;
    } finally {
      this.gatewayClientInitLock = null;
    }
  }

  private async _ensureGatewayClientReadyImpl(): Promise<void> {
    console.log('[ChannelSync] ensureGatewayClientReady: starting engine gateway...');
    const engineStatus = await this.engineManager.startGateway();
    console.log('[ChannelSync] ensureGatewayClientReady: engine phase=', engineStatus.phase, 'message=', engineStatus.message);
    if (engineStatus.phase !== 'running') {
      const message = engineStatus.message || 'OpenClaw engine is not running.';
      throw new Error(message);
    }

    const connection = this.engineManager.getGatewayConnectionInfo();
    console.log('[ChannelSync] ensureGatewayClientReady: connection info — url=', connection.url ? '✓' : '✗', 'token=', connection.token ? '✓' : '✗', 'version=', connection.version, 'clientEntryPath=', connection.clientEntryPath ? '✓' : '✗');
    const missing: string[] = [];
    if (!connection.url) missing.push('url');
    if (!connection.token) missing.push('token');
    if (!connection.version) missing.push('version');
    if (!connection.clientEntryPath) missing.push('clientEntryPath');
    if (missing.length > 0) {
      throw new Error(`OpenClaw gateway connection info is incomplete (missing: ${missing.join(', ')})`);
    }

    const needsNewClient = !this.gatewayClient
      || this.gatewayClientVersion !== connection.version
      || this.gatewayClientEntryPath !== connection.clientEntryPath;
    console.log('[ChannelSync] ensureGatewayClientReady: needsNewClient=', needsNewClient, 'hasExistingClient=', !!this.gatewayClient);
    if (!needsNewClient && this.gatewayReadyPromise) {
      await waitWithTimeout(this.gatewayReadyPromise, GATEWAY_READY_TIMEOUT_MS);
      return;
    }

    this.stopGatewayClient();
    console.log('[ChannelSync] ensureGatewayClientReady: creating gateway client, url=', connection.url);
    await this.createGatewayClient(connection);
    console.log('[ChannelSync] ensureGatewayClientReady: createGatewayClient returned, waiting for handshake...');
    if (this.gatewayReadyPromise) {
      await waitWithTimeout(this.gatewayReadyPromise, GATEWAY_READY_TIMEOUT_MS);
    }
    console.log('[ChannelSync] ensureGatewayClientReady: gateway client created and ready');

    // Browser pre-warm disabled: the empty browser window is disruptive.
    // The browser will start on-demand when the AI agent first calls the browser tool.
    // this.prewarmBrowserIfNeeded(connection);
  }

  private async createGatewayClient(connection: OpenClawGatewayConnectionInfo): Promise<void> {
    const GatewayClient = await this.loadGatewayClientCtor(connection.clientEntryPath);

    let resolveReady: (() => void) | null = null;
    let rejectReady: ((error: Error) => void) | null = null;
    let settled = false;

    this.gatewayReadyPromise = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });

    const settleResolve = () => {
      if (settled) return;
      settled = true;
      resolveReady?.();
    };
    const settleReject = (error: Error) => {
      if (settled) return;
      settled = true;
      rejectReady?.(error);
    };

    const client = new GatewayClient({
      url: connection.url,
      token: connection.token,
      clientDisplayName: 'LobsterAI',
      clientVersion: app.getVersion(),
      mode: 'backend',
      caps: [OPENCLAW_GATEWAY_TOOL_EVENTS_CAP],
      role: 'operator',
      scopes: ['operator.admin'],
      onHelloOk: () => {
        console.log('[ChannelSync] GatewayClient: onHelloOk — handshake succeeded');
        // Expose the client only after the connect handshake completes.
        // Setting gatewayClient earlier would let concurrent code send
        // request frames before the connect frame, causing 1008 rejection.
        this.gatewayClient = client;
        this.gatewayClientVersion = connection.version;
        this.gatewayClientEntryPath = connection.clientEntryPath;
        settleResolve();
        this.lastTickTimestamp = Date.now();
        this.startTickWatchdog();
      },
      onConnectError: (error: Error) => {
        console.error('[ChannelSync] GatewayClient: onConnectError —', error.message);
        // Transient startup errors can happen while OpenClaw is still loading
        // plugins. GatewayClient will retry internally, so only fail fast for
        // auth errors that are unlikely to recover.
        const message = error.message.toLowerCase();
        const isAuthFailure = message.includes('auth')
          || message.includes('denied')
          || message.includes('forbidden');
        if (isAuthFailure) {
          settleReject(error);
          return;
        }
        console.log('[ChannelSync] GatewayClient: transient connect error, waiting for auto-reconnect...');
      },
      onClose: (_code: number, reason: string) => {
        console.log('[ChannelSync] GatewayClient: onClose — code:', _code, 'reason:', reason, 'settled:', settled);
        if (!settled) {
          // The initial handshake may close while the gateway is still loading
          // plugins. Keep the pending client alive so its built-in reconnect
          // can finish the handshake; waitWithTimeout remains the authority on
          // when to give up.
          console.log('[ChannelSync] GatewayClient: connection closed before handshake, waiting for auto-reconnect...');
          return;
        }

        // If stopGatewayClient() triggered this onClose, don't do anything —
        // the caller is already handling cleanup and may be creating a new client.
        if (this.gatewayStoppingIntentionally || this.intentionallyStoppedGatewayClients.has(client)) {
          return;
        }

        console.warn('[OpenClawRuntime] gateway WS disconnected — code:', _code, 'reason:', reason);
        const disconnectedError = new Error(reason || 'OpenClaw gateway client disconnected');
        const activeSessionIds = Array.from(this.activeTurns.keys());
        activeSessionIds.forEach((sessionId) => {
          this.store.updateSession(sessionId, { status: 'error' });
          this.emit('error', sessionId, disconnectedError.message);
          this.cleanupSessionTurn(sessionId);
          this.rejectTurn(sessionId, disconnectedError);
        });
        this.stopGatewayClient();
        this.gatewayReadyPromise = Promise.reject(disconnectedError);
        this.gatewayReadyPromise.catch(() => {
          // suppress unhandled rejection noise; auto-reconnect will re-establish
        });

        // Auto-reconnect after unexpected disconnect
        this.scheduleGatewayReconnect();
      },
      onEvent: (event: GatewayEventFrame) => {
        this.handleGatewayEvent(event);
      },
    });

    // gatewayClient/version/entryPath are now set inside onHelloOk,
    // after the connect handshake succeeds. We only keep a local ref
    // for stopGatewayClient() cleanup if start() fails synchronously.
    this.pendingGatewayClient = client;
    client.start();
  }

  private stopGatewayClient(): void {
    this.gatewayStoppingIntentionally = true;
    this.stopChannelPolling();
    this.cancelGatewayReconnect();
    this.stopTickWatchdog();
    // Stop whichever client exists — the promoted one or the pending one.
    const clientToStop = this.gatewayClient ?? this.pendingGatewayClient;
    try {
      if (clientToStop) {
        this.intentionallyStoppedGatewayClients.add(clientToStop);
      }
      clientToStop?.stop();
    } catch (error) {
      console.warn('[OpenClawRuntime] Failed to stop gateway client:', error);
    }
    this.gatewayClient = null;
    this.pendingGatewayClient = null;
    this.gatewayClientVersion = null;
    this.gatewayClientEntryPath = null;
    this.gatewayReadyPromise = null;
    this.channelSessionSync?.clearCache();
    this.knownChannelSessionIds.clear();
    this.heartbeatSessionKeys.clear();
    this.recentlyClosedRunIds.clear();
    this.browserPrewarmAttempted = false;
    this.lastTickTimestamp = 0;
    // Clear throttled streaming timers.
    for (const timer of this.pendingMessageUpdateTimer.values()) {
      clearTimeout(timer);
    }
    this.pendingMessageUpdateTimer.clear();
    this.lastMessageUpdateEmitTime.clear();
    for (const timer of this.pendingStoreUpdateTimer.values()) {
      clearTimeout(timer);
    }
    this.pendingStoreUpdateTimer.clear();
    this.lastStoreUpdateTime.clear();
    this.gatewayStoppingIntentionally = false;
  }

  private pruneMapToLimit<K, V>(map: Map<K, V>, limit: number): void {
    while (map.size > limit) {
      const oldestKey = map.keys().next().value as K | undefined;
      if (oldestKey === undefined) return;
      map.delete(oldestKey);
    }
  }

  private pruneSetToLimit<T>(set: Set<T>, limit: number): void {
    while (set.size > limit) {
      const oldestValue = set.values().next().value as T | undefined;
      if (oldestValue === undefined) return;
      set.delete(oldestValue);
    }
  }

  private pruneRecentlyClosedRunIds(now = Date.now()): void {
    for (const [runId, expiresAt] of this.recentlyClosedRunIds.entries()) {
      if (expiresAt <= now) {
        this.recentlyClosedRunIds.delete(runId);
      }
    }

    while (this.recentlyClosedRunIds.size > OpenClawRuntimeAdapter.RECENTLY_CLOSED_RUN_ID_LIMIT) {
      const oldestRunId = this.recentlyClosedRunIds.keys().next().value as string | undefined;
      if (!oldestRunId) return;
      this.recentlyClosedRunIds.delete(oldestRunId);
    }
  }

  private rememberRecentlyClosedRunId(runId: string): void {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) return;
    const now = Date.now();
    this.recentlyClosedRunIds.set(
      normalizedRunId,
      now + OpenClawRuntimeAdapter.RECENTLY_CLOSED_RUN_ID_TTL_MS,
    );
    this.pruneRecentlyClosedRunIds(now);
  }

  private isRecentlyClosedRunId(runId: string): boolean {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) return false;
    const expiresAt = this.recentlyClosedRunIds.get(normalizedRunId);
    if (expiresAt === undefined) return false;
    if (expiresAt <= Date.now()) {
      this.recentlyClosedRunIds.delete(normalizedRunId);
      return false;
    }
    return true;
  }

  private cancelGatewayReconnect(): void {
    if (this.gatewayReconnectTimer) {
      clearTimeout(this.gatewayReconnectTimer);
      this.gatewayReconnectTimer = null;
    }
  }

  /**
   * Throttled emit for messageUpdate during streaming.
   * OpenClaw sends full-replacement deltas, so intermediate updates can be safely skipped.
   * Uses leading + trailing pattern: emit immediately if enough time has passed,
   * otherwise schedule a trailing emit to deliver the latest content.
   */
  private throttledEmitMessageUpdate(sessionId: string, messageId: string, content: string): void {
    const now = Date.now();
    const lastEmit = this.lastMessageUpdateEmitTime.get(messageId) ?? 0;
    const elapsed = now - lastEmit;

    if (elapsed >= OpenClawRuntimeAdapter.MESSAGE_UPDATE_THROTTLE_MS) {
      this.clearPendingMessageUpdate(messageId);
      this.lastMessageUpdateEmitTime.set(messageId, now);
      this.emit('messageUpdate', sessionId, messageId, content);
      return;
    }

    // Schedule a trailing emit to ensure the latest content is delivered
    this.clearPendingMessageUpdate(messageId);
    this.pendingMessageUpdateTimer.set(messageId, setTimeout(() => {
      this.pendingMessageUpdateTimer.delete(messageId);
      this.lastMessageUpdateEmitTime.set(messageId, Date.now());
      this.emit('messageUpdate', sessionId, messageId, content);
    }, OpenClawRuntimeAdapter.MESSAGE_UPDATE_THROTTLE_MS - elapsed));
  }

  private clearPendingMessageUpdate(messageId: string): void {
    const timer = this.pendingMessageUpdateTimer.get(messageId);
    if (timer) {
      clearTimeout(timer);
      this.pendingMessageUpdateTimer.delete(messageId);
    }
  }

  /**
   * Throttled SQLite store write for streaming message updates.
   * Uses leading + trailing pattern identical to throttledEmitMessageUpdate.
   * Final correctness is guaranteed by syncFinalAssistantWithHistory.
   */
  private throttledStoreUpdateMessage(
    sessionId: string,
    messageId: string,
    content: string,
    metadata: { isStreaming: boolean; isFinal: boolean },
  ): void {
    const now = Date.now();
    const lastUpdate = this.lastStoreUpdateTime.get(messageId) ?? 0;
    const elapsed = now - lastUpdate;

    if (elapsed >= OpenClawRuntimeAdapter.STORE_UPDATE_THROTTLE_MS) {
      this.clearPendingStoreUpdate(messageId);
      this.lastStoreUpdateTime.set(messageId, now);
      this.store.updateMessage(sessionId, messageId, { content, metadata });
      return;
    }

    // Schedule a trailing write to ensure the latest content is persisted
    this.clearPendingStoreUpdate(messageId);
    this.pendingStoreUpdateTimer.set(messageId, setTimeout(() => {
      this.pendingStoreUpdateTimer.delete(messageId);
      this.lastStoreUpdateTime.set(messageId, Date.now());
      // Guard: skip write if the session turn has already been cleaned up
      const activeTurn = this.activeTurns.get(sessionId);
      if (activeTurn?.assistantMessageId === messageId) {
        this.store.updateMessage(sessionId, messageId, { content, metadata });
      }
    }, OpenClawRuntimeAdapter.STORE_UPDATE_THROTTLE_MS - elapsed));
  }

  private clearPendingStoreUpdate(messageId: string): void {
    const timer = this.pendingStoreUpdateTimer.get(messageId);
    if (timer) {
      clearTimeout(timer);
      this.pendingStoreUpdateTimer.delete(messageId);
    }
  }

  /** Flush any pending throttled store write immediately (e.g. before segment split or final sync). */
  private flushPendingStoreUpdate(sessionId: string, messageId: string): void {
    const timer = this.pendingStoreUpdateTimer.get(messageId);
    if (!timer) return;
    clearTimeout(timer);
    this.pendingStoreUpdateTimer.delete(messageId);
    this.lastStoreUpdateTime.set(messageId, Date.now());
    // Persist the latest in-memory content only; caller is responsible for metadata.
    const turn = this.activeTurns.get(sessionId);
    if (turn?.assistantMessageId === messageId && turn.currentAssistantSegmentText) {
      this.store.updateMessage(sessionId, messageId, {
        content: turn.currentAssistantSegmentText,
      });
    }
  }

  private startTickWatchdog(): void {
    this.stopTickWatchdog();
    console.log('[TickWatchdog] started');
    this.tickWatchdogTimer = setInterval(() => {
      this.checkTickHealth();
    }, OpenClawRuntimeAdapter.TICK_WATCHDOG_INTERVAL_MS);
  }

  private stopTickWatchdog(): void {
    if (this.tickWatchdogTimer) {
      clearInterval(this.tickWatchdogTimer);
      this.tickWatchdogTimer = null;
    }
  }

  private checkTickHealth(): void {
    if (this.lastTickTimestamp <= 0) return;
    const elapsed = Date.now() - this.lastTickTimestamp;
    if (elapsed <= OpenClawRuntimeAdapter.TICK_TIMEOUT_MS) return;

    console.warn(`[TickWatchdog] no tick received for ${Math.round(elapsed / 1000)}s (threshold: ${OpenClawRuntimeAdapter.TICK_TIMEOUT_MS / 1000}s) — connection is likely dead, triggering reconnect`);
    this.cancelGatewayReconnect();
    this.stopGatewayClient();
    this.gatewayReconnectAttempt = 0;
    this.scheduleGatewayReconnect();
  }

  /**
   * Called when the system resumes from sleep/suspend.
   * Resets the reconnect counter and triggers an immediate reconnect or health check.
   */
  onSystemResume(): void {
    console.log('[GatewayReconnect] system resumed from sleep');
    this.cancelGatewayReconnect();
    this.gatewayReconnectAttempt = 0;
    if (!this.gatewayClient) {
      void this.attemptGatewayReconnect();
    } else {
      this.checkTickHealth();
    }
  }

  /**
   * Schedule an automatic gateway WS reconnection attempt with exponential backoff.
   * Called from onClose when the connection drops unexpectedly after a successful handshake.
   */
  private scheduleGatewayReconnect(): void {
    if (this.gatewayReconnectAttempt >= OpenClawRuntimeAdapter.GATEWAY_RECONNECT_MAX_ATTEMPTS) {
      console.error('[GatewayReconnect] max attempts reached (' + OpenClawRuntimeAdapter.GATEWAY_RECONNECT_MAX_ATTEMPTS + '), giving up. Restart the app to reconnect.');
      return;
    }

    const delays = OpenClawRuntimeAdapter.GATEWAY_RECONNECT_DELAYS;
    const delay = delays[Math.min(this.gatewayReconnectAttempt, delays.length - 1)];
    this.gatewayReconnectAttempt++;

    console.log(`[GatewayReconnect] scheduling reconnect attempt ${this.gatewayReconnectAttempt}/${OpenClawRuntimeAdapter.GATEWAY_RECONNECT_MAX_ATTEMPTS} in ${delay}ms`);

    this.gatewayReconnectTimer = setTimeout(() => {
      this.gatewayReconnectTimer = null;
      void this.attemptGatewayReconnect();
    }, delay);
  }

  private async attemptGatewayReconnect(): Promise<void> {
    console.log(`[GatewayReconnect] attempting reconnect (attempt ${this.gatewayReconnectAttempt})`);
    try {
      // connectGatewayIfNeeded checks if client already exists, so safe to call
      await this.connectGatewayIfNeeded();
      console.log('[GatewayReconnect] reconnected successfully');
      this.gatewayReconnectAttempt = 0; // reset counter on success
    } catch (error) {
      console.warn('[GatewayReconnect] reconnect failed:', error);
      this.scheduleGatewayReconnect(); // retry with next backoff
    }
  }

  private prewarmBrowserIfNeeded(connection: OpenClawGatewayConnectionInfo): void {
    if (this.browserPrewarmAttempted) return;
    if (!connection.port || !connection.token) return;
    this.browserPrewarmAttempted = true;

    const browserControlPort = connection.port + 2;
    const token = connection.token;
    console.log(`[OpenClawRuntime] browser pre-warm: gatewayPort=${connection.port}, browserControlPort=${browserControlPort}`);
    void this.prewarmBrowserWithRetry(browserControlPort, token);
  }

  private probeBrowserControlService(toolCallId: string, phase: string): void {
    const connection = this.engineManager.getGatewayConnectionInfo();
    if (!connection.port || !connection.token) {
      console.log(`[OpenClawRuntime] browser probe (${toolCallId}/${phase}): no gateway connection info`);
      return;
    }
    const browserControlPort = connection.port + 2;
    const token = connection.token;
    const probeStartTime = Date.now();
    console.log(`[OpenClawRuntime] browser probe (${toolCallId}/${phase}): checking port ${browserControlPort} ...`);

    // Probe multiple endpoints to diagnose reachability
    const endpoints = [`http://127.0.0.1:${browserControlPort}/status`, `http://127.0.0.1:${browserControlPort}/`];
    for (const probeUrl of endpoints) {
      fetch(probeUrl, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
        signal: AbortSignal.timeout(5_000),
      })
        .then(async (response) => {
          const body = await response.text().catch(() => '');
          console.log(
            `[OpenClawRuntime] browser probe (${toolCallId}/${phase}): ${probeUrl} → HTTP ${response.status} (${Date.now() - probeStartTime}ms) body=${body.slice(0, 500)}`,
          );
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(
            `[OpenClawRuntime] browser probe (${toolCallId}/${phase}): ${probeUrl} → FAILED (${Date.now() - probeStartTime}ms) error=${message}`,
          );
        });
    }
  }

  private async prewarmBrowserWithRetry(
    port: number,
    token: string,
    maxRetries = 5,
  ): Promise<void> {
    const url = `http://127.0.0.1:${port}/start?profile=openclaw`;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const startTime = Date.now();
      console.log(
        `[OpenClawRuntime] browser pre-warm attempt ${attempt}/${maxRetries} → POST http://127.0.0.1:${port}/start?profile=openclaw`,
      );

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          signal: AbortSignal.timeout(90_000),
        });
        const body = await response.text();
        if (response.ok) {
          console.log(
            `[OpenClawRuntime] browser pre-warm succeeded (${Date.now() - startTime}ms): ${body.slice(0, 200)}`,
          );
          return;
        }
        console.warn(
          `[OpenClawRuntime] browser pre-warm attempt ${attempt} returned HTTP ${response.status} (${Date.now() - startTime}ms): ${body.slice(0, 200)}`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[OpenClawRuntime] browser pre-warm attempt ${attempt} failed (${Date.now() - startTime}ms): ${message}`,
        );
      }

      if (attempt < maxRetries) {
        const delayMs = Math.min(5000, 2000 * attempt);
        console.log(`[OpenClawRuntime] browser pre-warm retrying in ${delayMs}ms...`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    console.warn('[OpenClawRuntime] browser pre-warm exhausted all retries (non-fatal, browser will start on first tool use)');
  }

  private async loadGatewayClientCtor(clientEntryPath: string): Promise<GatewayClientCtor> {
    const resolveCtorFromExports = (loaded: Record<string, unknown>): GatewayClientCtor | null => {
      const direct = loaded.GatewayClient;
      if (typeof direct === 'function') {
        return direct as GatewayClientCtor;
      }

      const exportedValues = Object.values(loaded);
      for (const candidate of exportedValues) {
        if (typeof candidate !== 'function') {
          continue;
        }
        const maybeCtor = candidate as {
          name?: string;
          prototype?: {
            start?: unknown;
            stop?: unknown;
            request?: unknown;
          };
        };
        if (maybeCtor.name === 'GatewayClient') {
          return candidate as GatewayClientCtor;
        }
        const proto = maybeCtor.prototype;
        if (proto
          && typeof proto.start === 'function'
          && typeof proto.stop === 'function'
          && typeof proto.request === 'function') {
          return candidate as GatewayClientCtor;
        }
      }

      return null;
    };

    // Use require() with file path directly. TypeScript's CJS output downgrades
    // dynamic import() to require(), which doesn't support file:// URLs.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const loaded = require(clientEntryPath) as Record<string, unknown>;
    const directCtor = resolveCtorFromExports(loaded);
    if (directCtor) {
      return directCtor;
    }

    // OpenClaw v2026.4.8 no longer exposes GatewayClient from the first
    // client-*.js artifact. The actual constructor lives in a hashed
    // method-scopes bundle, so probe sibling files before failing.
    const distDir = path.dirname(clientEntryPath);
    try {
      const fallbackEntries = fs.readdirSync(distDir)
        .filter((name) => /^method-scopes(?:-.*)?\.js$/i.test(name))
        .sort();
      console.log(`[ChannelSync] loadGatewayClientCtor: fallback candidates from ${distDir}: ${fallbackEntries.join(', ') || '(none)'}`);
      for (const entry of fallbackEntries) {
        const fallbackPath = path.join(distDir, entry);
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const fallbackLoaded = require(fallbackPath) as Record<string, unknown>;
          const fallbackCtor = resolveCtorFromExports(fallbackLoaded);
          if (fallbackCtor) {
            console.log(`[ChannelSync] loadGatewayClientCtor: using fallback module ${fallbackPath}`);
            return fallbackCtor;
          }
          console.log(`[ChannelSync] loadGatewayClientCtor: fallback module ${fallbackPath} did not expose GatewayClient`);
        } catch (fallbackError) {
          console.warn(`[ChannelSync] loadGatewayClientCtor: fallback module ${fallbackPath} failed:`, fallbackError);
        }
      }
    } catch (fallbackScanError) {
      console.warn(`[ChannelSync] loadGatewayClientCtor: failed to scan fallback modules in ${distDir}:`, fallbackScanError);
    }

    const exportKeysPreview = Object.keys(loaded).slice(0, 20).join(', ');
    throw new Error(
      `Invalid OpenClaw gateway client module: ${clientEntryPath} (exports: ${exportKeysPreview || 'none'})`,
    );
  }

  private handleGatewayEvent(event: GatewayEventFrame): void {
    if (event.event === 'tick') {
      this.lastTickTimestamp = Date.now();
      return;
    }

    if (event.event === 'chat') {
      this.handleChatEvent(event.payload, event.seq);
      return;
    }

    if (event.event === 'agent') {
      // Process assistant text updates here (before handleAgentEvent) because
      // handleAgentEvent may enqueue events when sessionId mapping isn't ready.
      this.processAgentAssistantText(event.payload);
      this.handleAgentEvent(event.payload, event.seq);
      return;
    }

    if (event.event === 'exec.approval.requested') {
      this.handleApprovalRequested(event.payload);
      return;
    }

    if (event.event === 'exec.approval.resolved') {
      this.handleApprovalResolved(event.payload);
    }

    if (event.event === 'cron') {
      console.debug('[OpenClawRuntime] received cron event:', JSON.stringify(event));
    }
  }

  private handleAgentEvent(payload: unknown, seq?: number): void {
    if (!isRecord(payload)) return;
    const agentPayload = payload as AgentEventPayload;
    const runId = typeof agentPayload.runId === 'string' ? agentPayload.runId.trim() : '';
    const sessionKey = typeof agentPayload.sessionKey === 'string' ? agentPayload.sessionKey.trim() : '';
    const stream = typeof agentPayload.stream === 'string' ? agentPayload.stream.trim() : '';
    const lifecyclePhase = stream === 'lifecycle' ? getAgentLifecyclePhase(agentPayload.data) : '';

    if (runId && lifecyclePhase === AgentLifecyclePhase.Error) {
      this.terminatedRunIds.add(runId);
      this.pruneSetToLimit(
        this.terminatedRunIds,
        OpenClawRuntimeAdapter.RECENT_RUN_ID_LIMIT,
      );
    }

    if (runId && this.isRecentlyClosedRunId(runId)) {
      console.debug('[OpenClawRuntime] dropped late agent event for a closed run.');
      return;
    }

    if (lifecyclePhase === AgentLifecyclePhase.Fallback) {
      console.debug('[OpenClawRuntime] ignored agent lifecycle fallback event.');
      return;
    }

    const sessionIdByRunId = runId ? this.sessionIdByRunId.get(runId) : undefined;
    const sessionIdBySessionKey = sessionKey ? this.resolveSessionIdBySessionKey(sessionKey) ?? undefined : undefined;
    let sessionId = sessionIdByRunId ?? sessionIdBySessionKey;

    // Re-create ActiveTurn for channel session follow-up turns.
    // Exclude stream=error events (e.g. seq gap notifications) — they are diagnostic alerts,
    // not new run events, and must not create a ghost ActiveTurn that blocks the next user turn.
    if (sessionId && !this.activeTurns.has(sessionId) && sessionKey && stream !== 'error' && !this.terminatedRunIds.has(runId)) {
      if (this.manuallyStoppedSessions.has(sessionId) && isManagedSessionKey(sessionKey)) {
        console.debug('[OpenClawRuntime] suppressed late agent event for manually stopped desktop session');
        return;
      }
      console.debug('[OpenClawRuntime] recreating active turn for channel follow-up event');
      this.ensureActiveTurn(sessionId, sessionKey, runId);
    }

    // Try to resolve channel-originated sessions (e.g. Telegram via OpenClaw)
    if (!sessionId && sessionKey && this.channelSessionSync) {
      const channelSessionId = this.channelSessionSync.resolveOrCreateSession(sessionKey)
        || (!this.heartbeatSessionKeys.has(sessionKey) && this.channelSessionSync.resolveOrCreateMainAgentSession(sessionKey))
        || this.channelSessionSync.resolveOrCreateCronSession(sessionKey)
        || null;
      console.debug('[OpenClawRuntime] resolved channel-originated agent event');
      if (channelSessionId) {
        // If this key was previously deleted, allow re-creation but skip history sync
        if (this.deletedChannelKeys.has(sessionKey)) {
          this.deletedChannelKeys.delete(sessionKey);
          this.fullySyncedSessions.add(channelSessionId);
          this.reCreatedChannelSessionIds.add(channelSessionId);
          console.debug('[OpenClawRuntime] re-created deleted channel session and skipped full history sync');
        }
        this.rememberSessionKey(channelSessionId, sessionKey);
        sessionId = channelSessionId;
        this.ensureActiveTurn(channelSessionId, sessionKey, runId);
      }
    }

    if (!sessionId) {
      console.debug('[OpenClawRuntime] buffered or dropped agent event without resolved session');
      if (runId) {
        this.enqueuePendingAgentEvent(runId, agentPayload, seq);
      }
      return;
    }
    if (sessionIdByRunId && sessionIdBySessionKey && sessionIdByRunId !== sessionIdBySessionKey) {
      console.debug('[OpenClawRuntime] dropped agent event because run and session key resolved to different sessions');
      return;
    }

    const turn = this.activeTurns.get(sessionId);
    if (!turn) {
      console.debug('[OpenClawRuntime] dropped agent event because no active turn exists');
      return;
    }

    if (sessionKey && !runId && turn.sessionKey !== sessionKey) {
      console.debug('[OpenClawRuntime] dropped agent event because session key mismatched active turn');
      return;
    }

    if (runId) {
      const mappedSessionId = this.sessionIdByRunId.get(runId);
      if (mappedSessionId && mappedSessionId !== sessionId) {
        console.debug('[OpenClawRuntime] dropped agent event because run id is already mapped to another session');
        return;
      }
      this.bindRunIdToTurn(sessionId, runId);
    }

    // Buffer agent events while user messages are being prefetched for channel sessions.
    // Must be checked BEFORE seq dedup so that replayed events are not dropped.
    if (turn.pendingUserSync) {
      console.debug('[OpenClawRuntime] buffered agent event while channel user sync is pending');
      turn.bufferedAgentPayloads.push({ payload: agentPayload, seq, bufferedAt: Date.now() });
      return;
    }

    // Sequence-based dedup (placed after buffer check to match handleChatEvent pattern)
    if (typeof seq === 'number' && Number.isFinite(seq) && runId) {
      const lastSeq = this.lastAgentSeqByRunId.get(runId);
      if (lastSeq !== undefined && seq <= lastSeq) {
        return;
      }
      this.lastAgentSeqByRunId.set(runId, seq);
    }

    // Fast-path: skip assistant-stream events — they carry the same text as
    // chat deltas and dispatchAgentEvent() has no handler for stream=assistant.
    if (stream === 'assistant') {
      return;
    }

    this.dispatchAgentEvent(sessionId, turn, {
      ...agentPayload,
      ...(typeof seq === 'number' && Number.isFinite(seq) ? { seq } : {}),
    });
  }

  private dispatchAgentEvent(sessionId: string, turn: ActiveTurn, agentPayload: AgentEventPayload): void {
    const stream = typeof agentPayload.stream === 'string' ? agentPayload.stream.trim() : '';
    const hasToolShape = isRecord(agentPayload.data) && typeof agentPayload.data.toolCallId === 'string';
    if (stream === 'tool' || stream === 'tools' || (!stream && hasToolShape)) {
      if (Array.isArray(agentPayload.data)) {
        for (const entry of agentPayload.data) {
          this.handleAgentToolEvent(sessionId, turn, entry);
        }
      } else {
        this.handleAgentToolEvent(sessionId, turn, agentPayload.data);
      }
      return;
    }
    if (stream === 'lifecycle') {
      const lifecycleData = agentPayload.data;
      const lifecycleRunId = typeof agentPayload.runId === 'string' ? agentPayload.runId.trim() : '';
      if (
        lifecycleRunId
        && getAgentLifecyclePhase(lifecycleData) === AgentLifecyclePhase.Error
      ) {
        this.terminatedRunIds.add(lifecycleRunId);
        this.pruneSetToLimit(
          this.terminatedRunIds,
          OpenClawRuntimeAdapter.RECENT_RUN_ID_LIMIT,
        );
      }
      this.handleAgentLifecycleEvent(sessionId, agentPayload.data, lifecycleRunId);
    }
  }

  private enqueuePendingAgentEvent(runId: string, payload: AgentEventPayload, seq?: number): void {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) return;
    if (this.isRecentlyClosedRunId(normalizedRunId)) return;

    const stream = typeof payload.stream === 'string' ? payload.stream.trim() : '';
    if (stream === 'lifecycle' && getAgentLifecyclePhase(payload.data) === AgentLifecyclePhase.Fallback) {
      return;
    }
    const hasToolShape = isRecord(payload.data) && typeof payload.data.toolCallId === 'string';
    const isSupportedStream = stream === 'tool'
      || stream === 'tools'
      || stream === 'lifecycle'
      || (!stream && hasToolShape);
    if (!isSupportedStream) return;

    const queued = this.pendingAgentEventsByRunId.get(normalizedRunId) ?? [];
    queued.push({
      runId: normalizedRunId,
      sessionKey: payload.sessionKey,
      stream: payload.stream,
      data: payload.data,
      ...(typeof seq === 'number' && Number.isFinite(seq) ? { seq } : {}),
    });
    if (queued.length > 240) {
      queued.shift();
    }
    this.pendingAgentEventsByRunId.set(normalizedRunId, queued);

    if (this.pendingAgentEventsByRunId.size > 400) {
      const oldestRunId = this.pendingAgentEventsByRunId.keys().next().value as string | undefined;
      if (oldestRunId) {
        this.pendingAgentEventsByRunId.delete(oldestRunId);
      }
    }
  }

  private flushPendingAgentEvents(sessionId: string, runId: string): void {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) return;

    const queued = this.pendingAgentEventsByRunId.get(normalizedRunId);
    if (!queued || queued.length === 0) return;
    this.pendingAgentEventsByRunId.delete(normalizedRunId);

    const turn = this.activeTurns.get(sessionId);
    if (!turn) return;

    for (const event of queued) {
      this.dispatchAgentEvent(sessionId, turn, event);
    }
  }

  private rememberSessionKey(sessionId: string, sessionKey: string): void {
    const normalizedSessionKey = sessionKey.trim();
    if (!normalizedSessionKey) return;
    this.sessionIdBySessionKey.set(normalizedSessionKey, sessionId);
    this.pruneMapToLimit(
      this.sessionIdBySessionKey,
      OpenClawRuntimeAdapter.SESSION_KEY_CACHE_LIMIT,
    );
  }

  private resolveSessionIdBySessionKey(sessionKey: string): string | null {
    const normalizedSessionKey = sessionKey.trim();
    if (!normalizedSessionKey) return null;

    const mappedSessionId = this.sessionIdBySessionKey.get(normalizedSessionKey);
    if (mappedSessionId) {
      return mappedSessionId;
    }

    const parsedManagedSession = parseManagedSessionKey(normalizedSessionKey);
    if (!parsedManagedSession) {
      return null;
    }

    const session = this.store.getSession(parsedManagedSession.sessionId);
    if (!session) {
      return null;
    }

    this.rememberSessionKey(session.id, normalizedSessionKey);
    this.rememberSessionKey(session.id, this.toSessionKey(session.id, session.agentId));
    return session.id;
  }

  private nextTurnToken(sessionId: string): number {
    const nextToken = (this.latestTurnTokenBySession.get(sessionId) ?? 0) + 1;
    this.latestTurnTokenBySession.set(sessionId, nextToken);
    return nextToken;
  }

  private isCurrentTurnToken(sessionId: string, turnToken: number): boolean {
    return (this.latestTurnTokenBySession.get(sessionId) ?? 0) === turnToken;
  }

  private reuseFinalAssistantMessage(sessionId: string, content: string): string | null {
    const normalizedContent = content.trim();
    if (!normalizedContent) {
      return null;
    }

    const session = this.store.getSession(sessionId);
    const messages = session?.messages ?? [];
    // Scan backward: in normal flow the assistant message is last; after a skill switch
    // one user message may sit between the previous assistant reply and this sync.
    // Allow at most one non-assistant message before giving up.
    let nonAssistantCount = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.type === 'assistant') {
        if (msg.content.trim() !== normalizedContent) {
          return null;
        }
        this.store.updateMessage(sessionId, msg.id, {
          content,
          metadata: {
            isStreaming: false,
            isFinal: true,
          },
        });
        return msg.id;
      }
      nonAssistantCount++;
      if (nonAssistantCount > 1) {
        return null;
      }
    }
    return null;
  }

  private handleAgentLifecycleEvent(sessionId: string, data: unknown, eventRunId?: string): void {
    if (!isRecord(data)) return;
    const phase = getAgentLifecyclePhase(data);
    if (phase === AgentLifecyclePhase.Fallback) {
      return;
    }
    if (phase === AgentLifecyclePhase.Start) {
      this.store.updateSession(sessionId, { status: 'running' });
    }
    if (phase === AgentLifecyclePhase.End) {
      if (eventRunId && this.subagentTracker?.tryMarkDoneFromAnnounceRunId(eventRunId)) {
        return;
      }
      // Deferred completion fallback: the gateway should send a `chat state=final`
      // event that triggers handleChatFinal(). But after the OpenClaw upgrade, this
      // event may not arrive reliably for IM channel sessions.  The agent lifecycle
      // `phase=end` event IS reliable.  Wait a short window for handleChatFinal() to
      // run; if the turn is still active after that, complete it ourselves.
      const FALLBACK_DELAY_MS = 3000;
      const endingTurn = this.activeTurns.get(sessionId);
      if (endingTurn) {
        endingTurn.lifecycleEndReceived = true;
        if (endingTurn.chatFinalReady) {
          this.completeChatFinalReadyTurn(sessionId, endingTurn);
          return;
        }
      }
      const endingTurnToken = endingTurn?.turnToken;
      const endingRunId =
        endingTurn?.runId ??
        (isRecord(data) && typeof data.runId === 'string' ? data.runId : null);
      setTimeout(() => {
        const currentTurn = this.activeTurns.get(sessionId);
        if (!currentTurn) return;
        if (endingTurnToken !== undefined && currentTurn.turnToken !== endingTurnToken) return;
        if (endingRunId && !currentTurn.knownRunIds.has(endingRunId)) return;
        console.log('[OpenClawRuntime] agent lifecycle end fallback: completing turn that missed chat final, sessionId:', sessionId);
        void this.completeChannelTurnFallback(sessionId, currentTurn);
      }, FALLBACK_DELAY_MS);
    }

    if (phase === AgentLifecyclePhase.Error) {
      // Deferred error fallback: the gateway should also send a `chat state=error`
      // event that triggers handleChatError().  But after the OpenClaw upgrade, this
      // event may not arrive reliably — similar to the phase=end / chat final gap.
      // Wait a short window for handleChatError() to run first; if the turn is still
      // active after that, surface the error ourselves.
      const errorMessage = typeof data.error === 'string' ? data.error.trim() : 'OpenClaw run failed';
      const ERROR_FALLBACK_DELAY_MS = 2000;
      const errorTurn = this.activeTurns.get(sessionId);
      const errorTurnToken = errorTurn?.turnToken;
      const errorRunId =
        errorTurn?.runId ??
        (isRecord(data) && typeof data.runId === 'string' ? data.runId : null);
      setTimeout(() => {
        const turn = this.activeTurns.get(sessionId);
        if (!turn) return;
        if (errorTurnToken !== undefined && turn.turnToken !== errorTurnToken) return;
        if (errorRunId && !turn.knownRunIds.has(errorRunId)) return;
        console.log('[OpenClawRuntime] agent lifecycle error fallback: surfacing error that missed chat error event, sessionId:', sessionId, 'error:', errorMessage);
        // Abort the retrying run on the gateway so the session is freed for new messages.
        // Without this, the gateway continues retrying indefinitely and rejects subsequent chat.send requests.
        const client = this.gatewayClient;
        if (client) {
          console.log('[OpenClawRuntime] lifecycle error fallback: sending chat.abort to gateway, sessionKey:', turn.sessionKey, 'runId:', turn.runId);
          void client.request('chat.abort', {
            sessionKey: turn.sessionKey,
            runId: turn.runId,
          }).catch((err) => {
            console.warn('[OpenClawRuntime] lifecycle error fallback: chat.abort failed:', err);
          });
        }
        const erroredSessionKey = turn.sessionKey;
        this.store.updateSession(sessionId, { status: 'error' });
        const errorMsg = this.store.addMessage(sessionId, {
          type: 'system',
          content: errorMessage,
          metadata: { error: errorMessage },
        });
        this.emit('message', sessionId, errorMsg);
        this.emit('error', sessionId, errorMessage);
        this.cleanupSessionTurn(sessionId);
        this.rejectTurn(sessionId, new Error(errorMessage));
        void this.reconcileWithHistory(sessionId, erroredSessionKey);
      }, ERROR_FALLBACK_DELAY_MS);
    }
  }

  /**
   * Fallback completion for turns that never received a `chat state=final`
   * event. Called from handleAgentLifecycleEvent after a delay to give the normal
   * handleChatFinal path time to run first.
   */
  private async completeChannelTurnFallback(sessionId: string, turn: ActiveTurn): Promise<void> {
    if (!this.activeTurns.has(sessionId)) return;

    try {
      if (isManagedSessionKey(turn.sessionKey)) {
        await this.syncFinalAssistantWithHistory(sessionId, turn);
      } else {
        await this.reconcileWithHistory(sessionId, turn.sessionKey);
      }
    } catch (error) {
      console.warn('[OpenClawRuntime] fallback final sync failed:', error);
    }

    // Re-check after async final sync — handleChatFinal may have run in the meantime
    if (!this.activeTurns.has(sessionId)) return;

    this.store.updateSession(sessionId, { status: 'completed' });
    this.emit('complete', sessionId, turn.runId);
    this.cleanupSessionTurn(sessionId);
    this.resolveTurn(sessionId);
  }

  private handleAgentToolEvent(sessionId: string, turn: ActiveTurn, data: unknown): void {
    if (!isRecord(data)) return;

    const rawPhase = typeof data.phase === 'string' ? data.phase.trim() : '';
    const phase = rawPhase === 'end' ? 'result' : rawPhase;
    const toolCallId = typeof data.toolCallId === 'string' ? data.toolCallId.trim() : '';
    if (!toolCallId) return;
    if (phase !== 'start' && phase !== 'update' && phase !== 'result') return;

    const toolNameRaw = typeof data.name === 'string' ? data.name.trim() : '';
    const toolName = toolNameRaw || 'Tool';

    if (toolNameRaw.toLowerCase() === 'browser') {
      const isError = Boolean(data.isError);
      // Log full data keys and values for diagnosis
      const dataKeys = Object.keys(data);
      const resultType = data.result === undefined ? 'undefined'
        : data.result === null ? 'null'
          : typeof data.result === 'string' ? `string(len=${data.result.length})`
            : Array.isArray(data.result) ? `array(len=${data.result.length})`
              : `object(keys=${Object.keys(data.result as Record<string, unknown>).join(',')})`;
      console.log(
        `[OpenClawRuntime] browser tool event: phase=${phase} toolCallId=${toolCallId}`
        + ` dataKeys=[${dataKeys.join(',')}] resultType=${resultType}`
        + (phase === 'start' ? ` args=${JSON.stringify(data.args ?? {}).slice(0, 500)}` : '')
        + (phase === 'result' ? ` isError=${isError}` : ''),
      );
      if (phase === 'result') {
        // Log full result for browser events (may contain error details)
        try {
          const fullResult = JSON.stringify(data.result, null, 2);
          console.log(`[OpenClawRuntime] browser tool result (${toolCallId}): ${fullResult?.slice(0, 2000) ?? '(null)'}`);
        } catch {
          console.log(`[OpenClawRuntime] browser tool result (${toolCallId}): [unstringifiable] ${String(data.result).slice(0, 500)}`);
        }
        if (isError) {
          // Log any additional error-related fields
          const errorFields: Record<string, unknown> = {};
          for (const key of dataKeys) {
            if (/error|reason|message|detail|status/i.test(key)) {
              errorFields[key] = data[key];
            }
          }
          if (Object.keys(errorFields).length > 0) {
            console.log(`[OpenClawRuntime] browser tool error fields (${toolCallId}): ${JSON.stringify(errorFields).slice(0, 1000)}`);
          }
        }
      }
      // Probe browser control service reachability from Electron main process
      this.probeBrowserControlService(toolCallId, phase);
    }

    if (!turn.toolUseMessageIdByToolCallId.has(toolCallId)) {
      const toolUseMessage = this.store.addMessage(sessionId, {
        type: 'tool_use',
        content: `Using tool: ${toolName}`,
        metadata: {
          toolName,
          toolInput: toToolInputRecord(data.args),
          toolUseId: toolCallId,
        },
      });
      turn.toolUseMessageIdByToolCallId.set(toolCallId, toolUseMessage.id);
      this.emit('message', sessionId, toolUseMessage);

      if (toolNameRaw.toLowerCase() === 'sessions_spawn') {
        this.subagentTracker?.onToolStart(toolCallId, toToolInputRecord(data.args), sessionId);
      }
    }

    if (phase === 'update') {
      const incoming = extractToolText(data.partialResult);
      if (!incoming.trim()) return;

      const previous = turn.toolResultTextByToolCallId.get(toolCallId) ?? '';
      const merged = mergeStreamingText(previous, incoming, 'unknown').text;

      const existingResultMessageId = turn.toolResultMessageIdByToolCallId.get(toolCallId);
      if (!existingResultMessageId) {
        const resultMessage = this.store.addMessage(sessionId, {
          type: 'tool_result',
          content: merged,
          metadata: {
            toolResult: merged,
            toolUseId: toolCallId,
            isError: false,
            isStreaming: true,
            isFinal: false,
          },
        });
        turn.toolResultMessageIdByToolCallId.set(toolCallId, resultMessage.id);
        turn.toolResultTextByToolCallId.set(toolCallId, merged);
        this.emit('message', sessionId, resultMessage);
        return;
      }

      if (merged !== previous) {
        this.store.updateMessage(sessionId, existingResultMessageId, {
          content: merged,
          metadata: {
            toolResult: merged,
            toolUseId: toolCallId,
            isError: false,
            isStreaming: true,
            isFinal: false,
          },
        });
        turn.toolResultTextByToolCallId.set(toolCallId, merged);
        this.emit('messageUpdate', sessionId, existingResultMessageId, merged);
      }
      return;
    }

    if (phase === 'result') {
      const incoming = extractToolText(data.result);
      const previous = turn.toolResultTextByToolCallId.get(toolCallId) ?? '';
      const isError = Boolean(data.isError);
      const finalContent = incoming.trim() ? incoming : previous;
      const finalError = isError ? (finalContent || 'Tool execution failed') : undefined;
      const existingResultMessageId = turn.toolResultMessageIdByToolCallId.get(toolCallId);

      if (existingResultMessageId) {
        this.store.updateMessage(sessionId, existingResultMessageId, {
          content: finalContent,
          metadata: {
            toolResult: finalContent,
            toolUseId: toolCallId,
            error: finalError,
            isError,
            isStreaming: false,
            isFinal: true,
          },
        });
        this.emit('messageUpdate', sessionId, existingResultMessageId, finalContent);
      } else {
        const resultMessage = this.store.addMessage(sessionId, {
          type: 'tool_result',
          content: finalContent,
          metadata: {
            toolResult: finalContent,
            toolUseId: toolCallId,
            error: finalError,
            isError,
            isStreaming: false,
            isFinal: true,
          },
        });
        turn.toolResultMessageIdByToolCallId.set(toolCallId, resultMessage.id);
        this.emit('message', sessionId, resultMessage);
      }
      turn.toolResultTextByToolCallId.set(toolCallId, finalContent);

      if (toolNameRaw.toLowerCase() === 'sessions_spawn' && finalContent) {
        this.subagentTracker?.onSpawnResult(toolCallId, finalContent);
      }

      if (toolNameRaw.toLowerCase() === 'sessions_resume' || toolNameRaw.toLowerCase() === 'sessions_read') {
        this.subagentTracker?.onResumeOrReadResult(toToolInputRecord(data.args));
      }
    }
  }

  private handleChatEvent(payload: unknown, seq?: number): void {
    if (!isRecord(payload)) return;
    const chatPayload = payload as ChatEventPayload;
    const state = chatPayload.state;
    if (!state) return;
    const runId = typeof chatPayload.runId === 'string' ? chatPayload.runId.trim() : '';
    console.debug(
      '[OpenClawRuntime] handleChatEvent:',
      `state=${state}`,
      `runId=${typeof chatPayload.runId === 'string' ? chatPayload.runId : ''}`,
      `sessionKey=${typeof chatPayload.sessionKey === 'string' ? chatPayload.sessionKey : ''}`,
      `message=${summarizeGatewayMessageShape(chatPayload.message)}`
    );

    if (runId && this.isRecentlyClosedRunId(runId)) {
      console.debug('[OpenClawRuntime] dropped late chat event for a closed run.');
      return;
    }

    const sessionId = this.resolveSessionIdFromChatPayload(chatPayload);
    if (!sessionId) {
      console.log('[Debug:handleChatEvent] no sessionId resolved, dropping event');
      return;
    }

    const turn = this.activeTurns.get(sessionId);
    if (!turn) {
      console.log('[Debug:handleChatEvent] no active turn for sessionId:', sessionId);
      return;
    }

    // Buffer chat events while user messages are being prefetched for channel sessions
    if (turn.pendingUserSync) {
      console.log('[Debug:handleChatEvent] buffering chat event (pendingUserSync), sessionId:', sessionId, 'buffered:', turn.bufferedChatPayloads.length + 1);
      turn.bufferedChatPayloads.push({ payload, seq, bufferedAt: Date.now() });
      return;
    }

    if (typeof seq === 'number' && Number.isFinite(seq) && runId) {
      const lastSeq = this.lastChatSeqByRunId.get(runId);
      if (lastSeq !== undefined && seq <= lastSeq) {
        return;
      }
      this.lastChatSeqByRunId.set(runId, seq);
    }

    if (state === 'delta') {
      this.handleChatDelta(sessionId, turn, chatPayload);
      return;
    }

    if (state === 'final') {
      this.handleChatFinal(sessionId, turn, chatPayload);
      return;
    }

    if (state === 'aborted') {
      this.handleChatAborted(sessionId, turn);
      return;
    }

    if (state === 'error') {
      this.handleChatError(sessionId, turn, chatPayload);
    }
  }

  private updateTurnTextState(
    turn: ActiveTurn,
    message: unknown,
    options: { protectBoundaryDrops?: boolean; forceReplace?: boolean } = {},
  ): void {
    const contentText = extractMessageText(message).trim();
    const { textBlocks, sawNonTextContentBlocks } = extractTextBlocksAndSignals(message);

    if (contentText) {
      const nextContentBlocks = textBlocks.length > 0 ? textBlocks : [contentText];
      const shouldProtectBoundaryDrop = Boolean(
        options.protectBoundaryDrops
        && (turn.sawNonTextContentBlocks || sawNonTextContentBlocks)
        && isDroppedBoundaryTextBlockSubset(turn.currentContentBlocks, nextContentBlocks),
      );
      if (!shouldProtectBoundaryDrop) {
        if (options.forceReplace) {
          turn.currentContentText = contentText;
          turn.currentContentBlocks = nextContentBlocks;
          turn.textStreamMode = 'snapshot';
        } else {
          const merged = mergeStreamingText(turn.currentContentText, contentText, turn.textStreamMode);
          turn.currentContentText = merged.text;
          turn.textStreamMode = merged.mode;
          if (merged.mode === 'snapshot') {
            turn.currentContentBlocks = nextContentBlocks;
          } else {
            const mergedText = merged.text.trim();
            if (mergedText) {
              turn.currentContentBlocks = [mergedText];
            }
          }
        }
      }
    }

    if (sawNonTextContentBlocks) {
      turn.sawNonTextContentBlocks = true;
    }
    turn.currentText = turn.currentContentText.trim();
  }

  private resolveFinalTurnText(turn: ActiveTurn, message: unknown): string {
    const streamedText = turn.currentText.trim();
    const streamedTextBlocks = [...turn.currentContentBlocks];
    const streamedSawNonTextContentBlocks = turn.sawNonTextContentBlocks;

    this.updateTurnTextState(turn, message, { forceReplace: true });
    const finalText = turn.currentText.trim();

    if (!finalText) {
      return streamedText;
    }

    const shouldFallbackToStreamedText = streamedSawNonTextContentBlocks
      && isDroppedBoundaryTextBlockSubset(streamedTextBlocks, turn.currentContentBlocks);
    if (shouldFallbackToStreamedText && streamedText) {
      turn.currentContentText = streamedText;
      turn.currentContentBlocks = streamedTextBlocks;
      turn.currentText = streamedText;
      return streamedText;
    }

    return finalText;
  }

  private resolveAssistantSegmentText(turn: ActiveTurn, fullText: string): string {
    const normalizedFullText = fullText.trim();
    const committed = turn.committedAssistantText;
    if (!normalizedFullText) {
      return '';
    }
    if (!committed) {
      return normalizedFullText;
    }
    if (normalizedFullText.startsWith(committed)) {
      return normalizedFullText.slice(committed.length).trimStart();
    }
    return normalizedFullText;
  }

  /**
   * Process agent assistant-stream text directly from handleGatewayEvent.
   * This bypasses handleAgentEvent's session resolution (which may enqueue events),
   * ensuring text updates and reset detection always work.
   */
  private processAgentAssistantText(payload: unknown): void {
    if (!isRecord(payload)) return;
    const p = payload as Record<string, unknown>;
    if (p.stream !== 'assistant') return;

    const dataField = isRecord(p.data) ? p.data as Record<string, unknown> : p;
    const text = extractOpenClawAssistantStreamText(dataField) || extractOpenClawAssistantStreamText(p);

    const runId = typeof p.runId === 'string' ? p.runId.trim() : '';
    const sessionKey = typeof p.sessionKey === 'string' ? p.sessionKey.trim() : '';
    if (runId && this.isRecentlyClosedRunId(runId)) {
      console.debug('[OpenClawRuntime] dropped late assistant text for a closed run.');
      return;
    }
    let sessionId = runId ? this.sessionIdByRunId.get(runId) : undefined;
    if (!sessionId && sessionKey) {
      sessionId = this.resolveSessionIdBySessionKey(sessionKey) ?? undefined;
      if (!sessionId && this.channelSessionSync) {
        sessionId = this.channelSessionSync.resolveOrCreateSession(sessionKey)
          || (!this.heartbeatSessionKeys.has(sessionKey) && this.channelSessionSync.resolveOrCreateMainAgentSession(sessionKey))
          || this.channelSessionSync.resolveOrCreateCronSession(sessionKey)
          || undefined;
        if (sessionId) {
          this.rememberSessionKey(sessionId, sessionKey);
        }
      }
      if (sessionId && !this.activeTurns.has(sessionId)) {
        this.ensureActiveTurn(sessionId, sessionKey, runId);
      }
      if (sessionId && runId) {
        this.bindRunIdToTurn(sessionId, runId);
      }
    }
    const turn = sessionId ? this.activeTurns.get(sessionId) : undefined;

    if (!text || !turn || !sessionId) {
      if (text) {
        console.debug(
          '[Debug:processAssistant] skipped: text.len:',
          text.length,
          'runId:',
          runId.slice(0, 8),
          'sessionKey:',
          sessionKey,
          'sid:',
          !!sessionId,
          'turn:',
          !!turn
        );
      }
      return;
    }
    if (isTransientGatewayStatusText(text)) {
      if (turn.assistantMessageId) {
        this.deleteAssistantMessage(sessionId, turn.assistantMessageId);
        turn.assistantMessageId = null;
      }
      turn.currentText = '';
      turn.currentAssistantSegmentText = '';
      return;
    }

    // Detect text reset: new model call starts → text length drops significantly.
    // Only trigger when hwm is meaningful (> 5 chars) to avoid false positives
    // from early chat delta / agent event interleaving.
    if (text.length < turn.agentAssistantTextLength
        && turn.agentAssistantTextLength > 5
        && turn.assistantMessageId) {
      console.debug('[Debug:textReset] detected:', turn.agentAssistantTextLength, '->',
        text.length, 'splitting. prevText:', turn.currentText.slice(0, 80));
      this.splitAssistantSegmentBeforeTool(sessionId, turn);
      turn.agentAssistantTextLength = 0;
    }

    // Track high-water mark.
    turn.agentAssistantTextLength = Math.max(turn.agentAssistantTextLength, text.length);
    if (text.trim().length > 0) {
      turn.hasSeenAgentAssistantStream = true;
    }

    // Update turn text state and push to store.
    turn.currentText = text;
    const displayText = stripTrailingSilentReplyTail(text);
    turn.currentAssistantSegmentText = this.resolveAssistantSegmentText(turn, displayText);

    if (!turn.assistantMessageId && turn.currentAssistantSegmentText) {
      // Create a new message for the new text segment (after split).
      const assistantMessage = this.store.addMessage(sessionId, {
        type: 'assistant',
        content: turn.currentAssistantSegmentText,
        metadata: { isStreaming: true, isFinal: false },
      });
      turn.assistantMessageId = assistantMessage.id;
      this.emit('message', sessionId, assistantMessage);
    } else if (turn.assistantMessageId && turn.currentAssistantSegmentText) {
      this.throttledStoreUpdateMessage(sessionId, turn.assistantMessageId,
        turn.currentAssistantSegmentText, { isStreaming: true, isFinal: false });
      this.throttledEmitMessageUpdate(sessionId, turn.assistantMessageId, turn.currentAssistantSegmentText);
    }
  }

  private splitAssistantSegmentBeforeTool(sessionId: string, turn: ActiveTurn): void {
    if (!turn.assistantMessageId) return;
    const messageId = turn.assistantMessageId;

    // Flush pending throttled updates so store content is current before reading.
    this.flushPendingStoreUpdate(sessionId, messageId);
    this.clearPendingMessageUpdate(messageId);

    // Committed text: use agentAssistantTextLength as the reliable segment length,
    // since currentText/currentAssistantSegmentText may be overwritten by chat deltas.
    // Read the actual content from the store (which was updated by processAgentAssistantText).
    const session = this.store.getSession(sessionId);
    const currentMsg = session?.messages.find((m) => m.id === messageId);
    const storeContent = currentMsg?.content?.trim() || '';

    if (storeContent) {
      turn.committedAssistantText = `${turn.committedAssistantText}${storeContent}`;
    }

    this.store.updateMessage(sessionId, messageId, {
      metadata: { isStreaming: false, isFinal: true },
    });
    if (storeContent) {
      this.emit('messageUpdate', sessionId, messageId, storeContent);
    }

    turn.assistantMessageId = null;
    turn.currentAssistantSegmentText = '';
    turn.hasSeenAgentAssistantStream = false;
    turn.chatDeltaOverwriteSkipLogged = false;
  }

  private deleteAssistantMessage(sessionId: string, messageId: string): void {
    this.clearPendingStoreUpdate(messageId);
    this.clearPendingMessageUpdate(messageId);
    this.store.deleteMessage(sessionId, messageId);
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('cowork:sessions:changed');
      }
    }
  }

  private handleChatDelta(sessionId: string, turn: ActiveTurn, payload: ChatEventPayload): void {
    const previousText = turn.currentText;
    const previousContentText = turn.currentContentText;
    const previousContentBlocks = [...turn.currentContentBlocks];
    const previousSawNonTextContentBlocks = turn.sawNonTextContentBlocks;
    const previousTextStreamMode = turn.textStreamMode;
    const previousSegmentText = turn.currentAssistantSegmentText;

    this.updateTurnTextState(turn, payload.message, { protectBoundaryDrops: true });

    // Debug: log when non-text content blocks first appear during streaming
    if (turn.sawNonTextContentBlocks && !previousSawNonTextContentBlocks) {
      console.log('[Debug:handleChatDelta] non-text content blocks detected during streaming, sessionId:', sessionId);
      if (isRecord(payload.message) && Array.isArray((payload.message as Record<string, unknown>).content)) {
        const content = (payload.message as Record<string, unknown>).content as Array<Record<string, unknown>>;
        for (const block of content) {
          if (isRecord(block) && typeof block.type === 'string' && block.type !== 'text' && block.type !== 'thinking') {
            console.log('[Debug:handleChatDelta] non-text block:', JSON.stringify(block).slice(0, 1000));
          }
        }
      }
    }
    const streamedText = turn.currentText;
    if (previousText && streamedText && streamedText.length < previousText.length) {
      turn.currentText = previousText;
      turn.currentContentText = previousContentText;
      turn.currentContentBlocks = previousContentBlocks;
      turn.sawNonTextContentBlocks = previousSawNonTextContentBlocks;
      turn.textStreamMode = previousTextStreamMode;
      return;
    }

    if (!streamedText) return;
    if (isHeartbeatAckText(streamedText)) {
      turn.currentText = streamedText;
      turn.currentAssistantSegmentText = '';
      if (turn.assistantMessageId) {
        this.deleteAssistantMessage(sessionId, turn.assistantMessageId);
        turn.assistantMessageId = null;
      }
      return;
    }
    if (isTransientGatewayStatusText(streamedText)) {
      turn.currentText = '';
      turn.currentAssistantSegmentText = '';
      if (turn.assistantMessageId) {
        this.deleteAssistantMessage(sessionId, turn.assistantMessageId);
        turn.assistantMessageId = null;
      }
      return;
    }
    const displayStreamedText = stripTrailingSilentReplyTail(streamedText);
    const segmentText = this.resolveAssistantSegmentText(turn, displayStreamedText);
    if (!segmentText) return;
    if (segmentText === previousSegmentText && streamedText === previousText) return;

    if (!turn.assistantMessageId) {
      const assistantMessage = this.store.addMessage(sessionId, {
        type: 'assistant',
        content: segmentText,
        metadata: {
          isStreaming: true,
          isFinal: false,
        },
      });
      turn.assistantMessageId = assistantMessage.id;
      turn.currentAssistantSegmentText = segmentText;
      this.emit('message', sessionId, assistantMessage);
      return;
    }

    if (turn.assistantMessageId && segmentText !== previousSegmentText) {
      // Only update segment text from chat delta if this segment has NOT yet received
      // agent assistant stream text. Agent stream preserves formatting; chat delta uses
      // extractGatewayMessageText (multi-block trim/join), which can break GFM tables.
      // hasSeenAgentAssistantStream stays true across agentAssistantTextLength resets
      // (e.g. split before tool) until a new assistant segment begins.
      if (!turn.hasSeenAgentAssistantStream) {
        turn.currentAssistantSegmentText = segmentText;
      } else if (!turn.chatDeltaOverwriteSkipLogged) {
        turn.chatDeltaOverwriteSkipLogged = true;
        console.debug('[OpenClawRuntime] skipping further chat.delta segment overwrite; agent stream owns this assistant segment until split');
      }
    }
  }

  private async handleChatFinal(sessionId: string, turn: ActiveTurn, payload: ChatEventPayload): Promise<void> {
    const previousText = turn.currentText;
    const previousSegmentText = turn.currentAssistantSegmentText;
    const finalText = this.resolveFinalTurnText(turn, payload.message);
    console.debug(
      '[OpenClawRuntime] handleChatFinal:',
      `sessionId=${sessionId}`,
      `runId=${payload.runId ?? turn.runId}`,
      `message=${summarizeGatewayMessageShape(payload.message)}`,
      `previousTextLen=${previousText.length}`,
      `finalTextLen=${finalText.length}`,
      `finalText="${truncate(finalText, 200)}"`
    );
    if (isHeartbeatAckText(finalText)) {
      turn.currentText = finalText;
      turn.currentAssistantSegmentText = '';
      if (turn.assistantMessageId) {
        this.deleteAssistantMessage(sessionId, turn.assistantMessageId);
        turn.assistantMessageId = null;
      }
      this.store.updateSession(sessionId, { status: 'completed' });
      this.emit('complete', sessionId, payload.runId ?? turn.runId);
      this.cleanupSessionTurn(sessionId);
      this.resolveTurn(sessionId);
      return;
    }
    if (isTransientGatewayStatusText(finalText)) {
      if (turn.assistantMessageId) {
        this.deleteAssistantMessage(sessionId, turn.assistantMessageId);
        turn.assistantMessageId = null;
      }
      turn.currentText = '';
      turn.currentAssistantSegmentText = '';
      this.store.updateSession(sessionId, { status: 'idle' });
      this.emit('complete', sessionId, payload.runId ?? turn.runId);
      this.cleanupSessionTurn(sessionId);
      this.resolveTurn(sessionId);
      return;
    }
    const displayFinalText = stripTrailingSilentReplyTail(finalText);
    turn.currentText = displayFinalText;
    if (displayFinalText && turn.currentContentBlocks.length === 0) {
      turn.currentContentText = displayFinalText;
      turn.currentContentBlocks = [displayFinalText];
    }
    const finalSegmentText = this.resolveAssistantSegmentText(turn, displayFinalText);
    const finalMessageMetadata: CoworkMessage['metadata'] = this.enrichAssistantMetadataWithCachedContext(turn.sessionKey, {
      isStreaming: false,
      isFinal: true,
      ...(buildAssistantMetadataFromFinalMessage(payload.message) ?? {}),
    });
    turn.currentAssistantSegmentText = finalSegmentText;

    if (turn.assistantMessageId) {
      // Flush any pending throttled updates so store content is current.
      this.flushPendingStoreUpdate(sessionId, turn.assistantMessageId);
      this.clearPendingMessageUpdate(turn.assistantMessageId);
      const { content: persistedSegmentText, reason: persistPickReason } = pickPersistedAssistantSegment(
        previousSegmentText,
        finalSegmentText,
        turn.hasSeenAgentAssistantStream,
      );
      if (persistedSegmentText) {
        console.debug(
          '[OpenClawRuntime] persisting assistant segment at chat.final',
          `sessionId=${sessionId}`,
          `messageId=${turn.assistantMessageId}`,
          `reason=${persistPickReason}`,
          `previousLen=${previousSegmentText.length}`,
          `finalLen=${finalSegmentText.length}`,
          `persistedLen=${persistedSegmentText.length}`,
          `hadAgentStreamAuthority=${turn.hasSeenAgentAssistantStream}`,
        );
        this.store.updateMessage(sessionId, turn.assistantMessageId, {
          content: persistedSegmentText,
          metadata: finalMessageMetadata,
        });
        this.emit('messageUpdate', sessionId, turn.assistantMessageId, persistedSegmentText, finalMessageMetadata);
      }
    } else if (finalSegmentText) {
      const reusedMessageId = this.reuseFinalAssistantMessage(sessionId, finalSegmentText);
      if (reusedMessageId) {
        turn.assistantMessageId = reusedMessageId;
        this.store.updateMessage(sessionId, reusedMessageId, {
          metadata: finalMessageMetadata,
        });
        this.emit('messageUpdate', sessionId, reusedMessageId, finalSegmentText, finalMessageMetadata);
      } else {
        const assistantMessage = this.store.addMessage(sessionId, {
          type: 'assistant',
          content: finalSegmentText,
          metadata: finalMessageMetadata,
        });
        turn.assistantMessageId = assistantMessage.id;
        this.emit('message', sessionId, assistantMessage);
      }
    }

    if (!finalText.trim()) {
      console.debug(
        '[OpenClawRuntime] handleChatFinal: final payload had no text, falling back to chat.history sync',
        `sessionId=${sessionId}`,
        `runId=${payload.runId ?? turn.runId}`
      );
      await this.syncFinalAssistantWithHistory(sessionId, turn);
    }

    const messageRecord = isRecord(payload.message) ? payload.message : null;
    const stopReason = payload.stopReason
      ?? (messageRecord && typeof messageRecord.stopReason === 'string' ? messageRecord.stopReason : undefined);
    const errorMessageFromMessage = messageRecord && typeof messageRecord.errorMessage === 'string'
      ? messageRecord.errorMessage
      : undefined;
    const stoppedByError = stopReason === 'error';
    if (stoppedByError) {
      const errorMessage = payload.errorMessage?.trim() || errorMessageFromMessage?.trim() || 'OpenClaw run failed';
      const erroredSessionKey = turn.sessionKey;
      this.store.updateSession(sessionId, { status: 'error' });
      this.emit('error', sessionId, errorMessage);
      this.cleanupSessionTurn(sessionId);
      this.rejectTurn(sessionId, new Error(errorMessage));
      // Reconcile even on error so the UI shows messages already delivered.
      void this.reconcileWithHistory(sessionId, erroredSessionKey);
      return;
    }

    // Reconcile local messages with authoritative gateway history.
    // This replaces the old syncFinalAssistantWithHistory + syncChannelAfterTurn flow.
    // Awaited so that IM handlers reading from the store see reconciled data.
    await this.reconcileWithHistory(sessionId, turn.sessionKey);

    // Detect thinking-only response: the last API call returned no visible text
    // (only a thinking block), causing the run to complete silently without output.
    // This happens with qwen3.5-plus under very large context (~380K tokens).
    // Signal: turn.currentText is empty AND there was at least one tool call in THIS turn.
    // Scoped to the current turn to avoid false positives when previous turns had tool calls
    // but the current turn returned empty (e.g. session busy, network error).
    const sessionAfterReconcile = this.store.getSession(sessionId);
    if (sessionAfterReconcile) {
      const hadToolCall = turn.toolResultMessageIdByToolCallId.size > 0;
      const lastApiResponseHadNoText = !turn.currentText.trim();
      console.debug('[OpenClawRuntime] run end diagnostics, sessionId:', sessionId,
        'turn.currentText:', JSON.stringify(turn.currentText?.slice(0, 100)),
        'turn.committedAssistantText:', JSON.stringify(turn.committedAssistantText?.slice(0, 100)),
        'hadToolCall:', hadToolCall,
        'lastApiResponseHadNoText:', lastApiResponseHadNoText);
      if (hadToolCall && lastApiResponseHadNoText) {
        const hintMessage = this.store.addMessage(sessionId, {
          type: 'system',
          content: t('taskThinkingOnly'),
        });
        this.emit('message', sessionId, hintMessage);
        console.warn('[OpenClawRuntime] thinking-only response detected, sessionId:', sessionId);
      }
    }

    turn.chatFinalReady = true;
    turn.chatFinalRunId = payload.runId ?? turn.runId;
    if (turn.lifecycleEndReceived) {
      this.completeChatFinalReadyTurn(sessionId, turn);
      return;
    }
    if (!turn.chatFinalCompletionTimer) {
      const turnToken = turn.turnToken;
      const runId = turn.chatFinalRunId;
      turn.chatFinalCompletionTimer = setTimeout(() => {
        const currentTurn = this.activeTurns.get(sessionId);
        if (!currentTurn || currentTurn.turnToken !== turnToken) return;
        if (runId && !currentTurn.knownRunIds.has(runId)) return;
        console.debug('[OpenClawRuntime] chat final completion fallback fired after missing lifecycle end');
        this.completeChatFinalReadyTurn(sessionId, currentTurn);
      }, CHAT_FINAL_COMPLETION_FALLBACK_DELAY_MS);
    }
  }

  private completeChatFinalReadyTurn(sessionId: string, turn: ActiveTurn): void {
    if (!this.activeTurns.has(sessionId)) return;
    const runId = turn.chatFinalRunId ?? turn.runId;
    this.store.updateSession(sessionId, { status: 'completed' });
    this.emit('complete', sessionId, runId);
    this.cleanupSessionTurn(sessionId);
    this.resolveTurn(sessionId);
  }

  private handleChatAborted(sessionId: string, turn: ActiveTurn): void {
    const elapsedSec = ((Date.now() - turn.startedAtMs) / 1000).toFixed(1);
    this.store.updateSession(sessionId, { status: 'idle' });
    if (!turn.stopRequested && !this.manuallyStoppedSessions.has(sessionId)) {
      // The run was aborted without user request — most likely a timeout.
      // Add a visible hint so the user knows the task was interrupted.
      console.warn(
        '[AbortDiag] showing timeout hint to user',
        `sessionId=${sessionId}`,
        `runId=${turn.runId}`,
        `elapsed=${elapsedSec}s`,
        `turnToken=${turn.turnToken}`,
      );
      const hintMessage = this.store.addMessage(sessionId, {
        type: 'assistant',
        content: t('taskTimedOut'),
        metadata: { isTimeout: true },
      });
      this.emit('message', sessionId, hintMessage);
      this.emit('complete', sessionId, turn.runId);
    }
    const abortedSessionKey = turn.sessionKey;
    this.cleanupSessionTurn(sessionId);
    this.resolveTurn(sessionId);
    void this.reconcileWithHistory(sessionId, abortedSessionKey);
  }

  private handleChatError(sessionId: string, turn: ActiveTurn, payload: ChatEventPayload): void {
    console.log('[OpenClawRuntime] handleChatError payload:', JSON.stringify(payload).slice(0, 1000));
    let errorMessage = payload.errorMessage?.trim() || 'OpenClaw run failed';

    // Detect model API errors that are likely caused by unsupported image content
    // in tool results (e.g., Read tool returning image blocks for non-vision models).
    // Only match 400 Bad Request — other 4xx codes (403 forbidden, 429 rate limit, etc.)
    // have unrelated causes and should show their original error message.
    if (/^400\b/.test(errorMessage)) {
      errorMessage += '\n\n[Hint: If the model attempted to read an image file, this may be because the model does not support image input. Consider using a vision-capable model or avoid sending image files.]';
    }

    const erroredSessionKey = turn.sessionKey;
    this.store.updateSession(sessionId, { status: 'error' });
    // Persist error message to SQLite so it survives session switches
    const errorMsg = this.store.addMessage(sessionId, {
      type: 'system',
      content: errorMessage,
      metadata: { error: errorMessage },
    });
    this.emit('message', sessionId, errorMsg);
    this.emit('error', sessionId, errorMessage);
    this.cleanupSessionTurn(sessionId);
    this.rejectTurn(sessionId, new Error(errorMessage));
    void this.reconcileWithHistory(sessionId, erroredSessionKey);
  }

  private handleApprovalRequested(payload: unknown): void {
    if (!isRecord(payload)) return;
    const typedPayload = payload as ExecApprovalRequestedPayload;
    const requestId = typeof typedPayload.id === 'string' ? typedPayload.id.trim() : '';
    if (!requestId) return;
    if (!typedPayload.request || !isRecord(typedPayload.request)) return;

    const request = typedPayload.request;
    const sessionKey = typeof request.sessionKey === 'string' ? request.sessionKey.trim() : '';
    let sessionId = sessionKey ? this.resolveSessionIdBySessionKey(sessionKey) ?? undefined : undefined;

    // Try to resolve channel-originated sessions for approval requests
    if (!sessionId && sessionKey && this.channelSessionSync) {
      const channelSessionId = this.channelSessionSync.resolveOrCreateSession(sessionKey)
        || (!this.heartbeatSessionKeys.has(sessionKey) && this.channelSessionSync.resolveOrCreateMainAgentSession(sessionKey))
        || this.channelSessionSync.resolveOrCreateCronSession(sessionKey)
        || null;
      if (channelSessionId) {
        this.rememberSessionKey(channelSessionId, sessionKey);
        sessionId = channelSessionId;
      }
    }

    if (!sessionId) {
      return;
    }

    const command = typeof request.command === 'string' ? request.command : '';
    const isChannelSession = parseChannelSessionKey(sessionKey) !== null;

    // Stop means stop: suppress stale approvals before the auto-approve path so
    // late non-delete tool calls cannot continue a run after user cancellation.
    if (this.isSessionInStopCooldown(sessionId)) {
      return;
    }
    if (this.manuallyStoppedSessions.has(sessionId) && isManagedSessionKey(sessionKey)) {
      return;
    }

    // Auto-approve: channel sessions always, local sessions for non-delete commands.
    // Intentionally allows non-delete dangerous commands (git push, kill, chmod) without
    // prompting — this is a deliberate trade-off to avoid the approval-pending timing
    // issue on fresh installs.  Only file-deletion commands warrant a blocking modal.
    // The allow-always decision adds the command to the gateway allowlist so subsequent
    // calls skip the approval flow entirely.
    if (isChannelSession || !isDeleteCommand(command)) {
      this.pendingApprovals.set(requestId, { requestId, sessionId, allowAlways: true });
      this.respondToPermission(requestId, { behavior: 'allow', updatedInput: {} });
      return;
    }

    this.pendingApprovals.set(requestId, { requestId, sessionId });

    const { level: dangerLevel, reason: dangerReason } = getCommandDangerLevel(command);

    const permissionRequest: PermissionRequest = {
      requestId,
      toolName: 'Bash',
      toolInput: {
        command,
        dangerLevel,
        dangerReason,
        cwd: request.cwd ?? null,
        host: request.host ?? null,
        security: request.security ?? null,
        ask: request.ask ?? null,
        resolvedPath: request.resolvedPath ?? null,
        sessionKey: request.sessionKey ?? null,
        agentId: request.agentId ?? null,
      },
      toolUseId: requestId,
    };

    this.emit('permissionRequest', sessionId, permissionRequest);
  }

  private handleApprovalResolved(payload: unknown): void {
    if (!isRecord(payload)) return;
    const typedPayload = payload as ExecApprovalResolvedPayload;
    const requestId = typeof typedPayload.id === 'string' ? typedPayload.id.trim() : '';
    if (!requestId) return;
    this.pendingApprovals.delete(requestId);
  }

  private resolveSessionIdFromChatPayload(payload: ChatEventPayload): string | null {
    const runId = typeof payload.runId === 'string' ? payload.runId.trim() : '';
    if (runId && this.sessionIdByRunId.has(runId)) {
      const sid = this.sessionIdByRunId.get(runId) ?? null;
      return sid;
    }

    const sessionKey = typeof payload.sessionKey === 'string' ? payload.sessionKey.trim() : '';
    if (sessionKey) {
      const sessionId = this.resolveSessionIdBySessionKey(sessionKey);
      if (sessionId) {
        // Re-create ActiveTurn for channel session follow-up turns
        this.ensureActiveTurn(sessionId, sessionKey, runId);
        if (runId) {
          this.bindRunIdToTurn(sessionId, runId);
        }
        return sessionId;
      }
    }

    // Try to resolve channel-originated sessions
    if (sessionKey && this.channelSessionSync) {
      const channelSessionId = this.channelSessionSync.resolveOrCreateSession(sessionKey)
        || (!this.heartbeatSessionKeys.has(sessionKey) && this.channelSessionSync.resolveOrCreateMainAgentSession(sessionKey))
        || this.channelSessionSync.resolveOrCreateCronSession(sessionKey)
        || null;
      if (channelSessionId) {
        // If this key was previously deleted, allow re-creation but skip history sync
        if (this.deletedChannelKeys.has(sessionKey)) {
          this.deletedChannelKeys.delete(sessionKey);
          this.fullySyncedSessions.add(channelSessionId);
          this.reCreatedChannelSessionIds.add(channelSessionId);
          console.debug('[resolveSessionId] re-created after delete, skipping history sync for:', sessionKey);
        }
        this.rememberSessionKey(channelSessionId, sessionKey);
        this.ensureActiveTurn(channelSessionId, sessionKey, runId);
        if (runId) {
          this.bindRunIdToTurn(channelSessionId, runId);
        }
        return channelSessionId;
      }
    }

    console.warn('[resolveSessionId] failed — runId:', runId, 'sessionKey:', sessionKey);
    return null;
  }

  private syncSystemMessagesFromHistory(
    sessionId: string,
    historyMessages: unknown[],
    options: { previousCountKnown: boolean; previousCount: number },
  ): void {
    if (historyMessages.length === 0) {
      this.gatewayHistoryCountBySession.set(sessionId, 0);
      return;
    }

    const canUseCursor = options.previousCountKnown
      && options.previousCount >= 0
      && options.previousCount <= historyMessages.length;
    const entries = extractGatewayHistoryEntries(
      canUseCursor ? historyMessages.slice(options.previousCount) : historyMessages,
    );
    this.gatewayHistoryCountBySession.set(sessionId, historyMessages.length);

    const systemEntries = entries.filter((entry) => entry.role === 'system');
    if (systemEntries.length === 0) {
      return;
    }

    const session = this.store.getSession(sessionId);
    const sessionSystemPrompt = session?.systemPrompt?.trim() || '';
    const existingSystemTexts = new Set(
      (session?.messages ?? [])
        .filter((message) => message.type === 'system')
        .map((message) => message.content.trim())
        .filter(Boolean),
    );

    for (const entry of systemEntries) {
      if (isHeartbeatAckText(entry.text)) {
        continue;
      }
      const normalizedText = entry.text.trim();
      const unwrappedText = unwrapInternalSystemPrompt(normalizedText);
      const isInjectedSystemPrompt = normalizedText.startsWith(INTERNAL_SYSTEM_PROMPT_HEADER)
        || (sessionSystemPrompt
          && (
            normalizedText === sessionSystemPrompt
            || unwrappedText === sessionSystemPrompt
            || normalizedText.includes(sessionSystemPrompt)
            || unwrappedText.includes(sessionSystemPrompt)
          ));

      if (!normalizedText || isInjectedSystemPrompt || existingSystemTexts.has(normalizedText)) {
        continue;
      }

      const systemMessage = this.store.addMessage(sessionId, {
        type: 'system',
        content: normalizedText,
        metadata: {},
      });
      existingSystemTexts.add(normalizedText);
      this.emit('message', sessionId, systemMessage);
    }
  }

  /**
   * Channel history prefetch/full-sync intentionally skips historical system entries.
   * Seed the raw gateway history cursor so those older reminders are not replayed
   * under the next assistant reply during final-history sync.
   */
  private markGatewayHistoryWindowConsumed(sessionId: string, historyMessages: unknown[]): void {
    if (historyMessages.length === 0) {
      return;
    }
    this.gatewayHistoryCountBySession.set(sessionId, historyMessages.length);
  }

  /**
   * Reconcile local session messages with the authoritative gateway chat.history.
   *
   * This is the single source-of-truth sync method: after a turn completes,
   * it fetches the full conversation from OpenClaw and overwrites local
   * user/assistant messages to match exactly.  Tool messages (tool_use,
   * tool_result, system) are kept as-is because the gateway does not
   * expose them in chat.history.
   *
   * The reconciliation is idempotent — calling it multiple times produces
   * the same result.
   */
  private async reconcileWithHistory(
    sessionId: string,
    sessionKey: string,
    options?: { isFullSync?: boolean },
  ): Promise<void> {
    const client = this.gatewayClient;
    if (!client) {
      console.log('[Reconcile] no gateway client, skipping — sessionId:', sessionId);
      return;
    }

    // Skip reconciliation for main-window (managed) sessions — local store is
    // the source of truth; only channel/IM sessions need gateway reconciliation.
    if (isManagedSessionKey(sessionKey)) {
      return;
    }

    const limit = options?.isFullSync
      ? OpenClawRuntimeAdapter.FULL_HISTORY_SYNC_LIMIT
      : FINAL_HISTORY_SYNC_LIMIT;

    try {
      const history = await client.request<{ messages?: unknown[] }>('chat.history', {
        sessionKey,
        limit,
      }, { timeoutMs: 10_000 });
      if (!Array.isArray(history?.messages) || history.messages.length === 0) {
        console.log('[Reconcile] empty history — sessionId:', sessionId);
        this.channelSyncCursor.set(sessionId, 0);
        return;
      }

      // Update gateway history cursor for system message tracking
      this.gatewayHistoryCountBySession.set(sessionId, history.messages.length);

      // Sync system messages (reminders etc.)
      const previousHistoryCountKnown = this.gatewayHistoryCountBySession.has(sessionId);
      const previousHistoryCount = this.gatewayHistoryCountBySession.get(sessionId) ?? 0;
      this.syncSystemMessagesFromHistory(sessionId, history.messages, {
        previousCountKnown: previousHistoryCountKnown,
        previousCount: previousHistoryCount,
      });

      // Determine if this is a channel session (for platform text normalization)
      const isChannel = this.channelSessionSync
        && !isManagedSessionKey(sessionKey)
        && this.channelSessionSync.isChannelSessionKey(sessionKey);
      const platformFlags = {
        isDiscord: sessionKey.includes(':discord:'),
        isQQ: sessionKey.includes(':qqbot:'),
        isPopo: sessionKey.includes(':moltbot-popo:'),
        isFeishu: sessionKey.includes(':feishu:'),
      };

      // Extract authoritative user/assistant entries from gateway history
      const authoritativeEntries: ChannelHistorySyncEntry[] = [];
      for (const entry of extractGatewayHistoryEntries(history.messages)) {
        const role = entry.role;
        if (role !== 'user' && role !== 'assistant') continue;
        const text = normalizeEntryText(role, entry.text, platformFlags);
        if (!text || shouldSuppressHeartbeatText(role, text)) continue;
        const metadata = await this.enrichAssistantMetadataWithContext(
          sessionKey,
          buildAssistantMetadataFromHistoryEntry(entry),
        );
        authoritativeEntries.push({
          role: role as 'user' | 'assistant',
          text,
          ...(metadata ? { metadata } : {}),
          ...(entry.timestamp != null ? { timestamp: entry.timestamp } : {}),
        });
      }

      // For channel sessions, append file paths from "message" tool calls
      if (isChannel && authoritativeEntries.length > 0) {
        const sentFilePaths = extractSentFilePathsFromHistory(history.messages);
        if (sentFilePaths.length > 0) {
          const lastAssistantIdx = authoritativeEntries.findLastIndex(e => e.role === 'assistant');
          if (lastAssistantIdx >= 0) {
            const fileLinks = sentFilePaths
              .map((fp) => `[${path.basename(fp)}](${fp})`)
              .join('\n');
            authoritativeEntries[lastAssistantIdx] = {
              ...authoritativeEntries[lastAssistantIdx],
              text: `${authoritativeEntries[lastAssistantIdx].text}\n\n${fileLinks}`,
            };
          }
        }
      }

      if (authoritativeEntries.length === 0) {
        console.log('[Reconcile] no user/assistant entries in history — sessionId:', sessionId);
        this.channelSyncCursor.set(sessionId, 0);
        return;
      }

      // Collect local user/assistant messages for comparison
      const session = this.store.getSession(sessionId);
      const localEntries: ChannelHistorySyncEntry[] = [];
      if (session) {
        for (const msg of session.messages) {
          if (msg.type !== 'user' && msg.type !== 'assistant') continue;
          const text = normalizeEntryText(msg.type, msg.content, platformFlags);
          if (!text || shouldSuppressHeartbeatText(msg.type, text)) continue;
          localEntries.push({ role: msg.type, text, timestamp: msg.timestamp });
        }
      }

      // Compare: if already in sync, skip the expensive replace
      const isInSync = localEntries.length === authoritativeEntries.length
        && localEntries.every((entry, idx) =>
          entry.role === authoritativeEntries[idx].role
          && entry.text === authoritativeEntries[idx].text,
        );

      if (isInSync) {
        console.log('[Reconcile] already in sync — sessionId:', sessionId, 'entries:', localEntries.length);
        this.channelSyncCursor.set(sessionId, authoritativeEntries.length);
        return;
      }

      const alignment = findTailAlignment(localEntries, authoritativeEntries);
      let entriesToStore: ChannelHistorySyncEntry[];

      if (alignment && (alignment.localIdx > 0 || alignment.authIdx > 0)) {
        const authoritativeTail = authoritativeEntries.slice(alignment.authIdx);
        const tail = localEntries.slice(alignment.localIdx);
        const tailInSync = tail.length === authoritativeTail.length
          && tail.every((entry, idx) =>
            isSameHistoryEntry(entry, authoritativeTail[idx]),
          );
        if (tailInSync) {
          console.log(
            '[Reconcile] tail in sync — sessionId:', sessionId,
            'preserved:', alignment.localIdx, 'tail:', tail.length,
            'authSkipped:', alignment.authIdx,
          );
          this.channelSyncCursor.set(sessionId, authoritativeEntries.length);
          return;
        }
        entriesToStore = [...localEntries.slice(0, alignment.localIdx), ...authoritativeTail];
        console.log(
          '[Reconcile] tail replace — sessionId:', sessionId,
          'preserved:', alignment.localIdx, 'auth:', authoritativeTail.length,
          'authSkipped:', alignment.authIdx,
          'total:', entriesToStore.length,
        );
      } else if (isChannel && localEntries.length > authoritativeEntries.length) {
        console.warn(
          '[Reconcile] skipped shrinking channel history because gateway history may be windowed — sessionId:', sessionId,
          'local:', localEntries.length, 'auth:', authoritativeEntries.length,
          'rawHistory:', history.messages.length, 'limit:', limit,
        );
        this.channelSyncCursor.set(sessionId, authoritativeEntries.length);
        return;
      } else {
        entriesToStore = authoritativeEntries;
        console.log(
          '[Reconcile] full replace — sessionId:', sessionId,
          'local:', localEntries.length, '-> auth:', authoritativeEntries.length,
          'alignIdx:', alignment?.localIdx ?? -1,
        );
      }

      if (isChannel && entriesToStore.length < localEntries.length) {
        console.warn(
          '[Reconcile] skipped shortening channel history after tail alignment — sessionId:', sessionId,
          'local:', localEntries.length, 'next:', entriesToStore.length,
          'rawHistory:', history.messages.length, 'limit:', limit,
        );
        this.channelSyncCursor.set(sessionId, authoritativeEntries.length);
        return;
      }

      this.store.replaceConversationMessages(sessionId, applyLocalTimestampsToEntries(entriesToStore, localEntries));
      this.channelSyncCursor.set(sessionId, authoritativeEntries.length);

      // Notify renderer to refresh
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('cowork:sessions:changed');
        }
      }
    } catch (error) {
      console.warn('[Reconcile] failed — sessionId:', sessionId, 'error:', error);
    }
  }

  private async syncFinalAssistantWithHistory(sessionId: string, turn: ActiveTurn): Promise<void> {
    console.debug('[OpenClawRuntime] syncing final assistant text with gateway history');
    const client = this.gatewayClient;
    if (!client) {
      console.debug('[OpenClawRuntime] skipped final assistant sync because gateway client is missing');
      return;
    }

    try {
      const retryDelaysMs = [0, 120, 250, 500];
      let historyMessages: unknown[] | null = null;
      let canonicalText = '';
      let isChannel = false;

      for (const delayMs of retryDelaysMs) {
        if (delayMs > 0) {
          await sleep(delayMs);
        }

        const history = await client.request<{ messages?: unknown[] }>('chat.history', {
          sessionKey: turn.sessionKey,
          limit: FINAL_HISTORY_SYNC_LIMIT,
        }, { timeoutMs: 8_000 });
        const msgCount = Array.isArray(history?.messages) ? history.messages.length : 0;
        console.debug('[OpenClawRuntime] fetched gateway history for final assistant sync', { messages: msgCount, delayMs });
        if (!Array.isArray(history?.messages) || history.messages.length === 0) {
          this.gatewayHistoryCountBySession.set(sessionId, 0);
          continue;
        }

        historyMessages = history.messages;
        const previousHistoryCountKnown = this.gatewayHistoryCountBySession.has(sessionId);
        const previousHistoryCount = this.gatewayHistoryCountBySession.get(sessionId) ?? 0;
        this.syncSystemMessagesFromHistory(sessionId, history.messages, {
          previousCountKnown: previousHistoryCountKnown,
          previousCount: previousHistoryCount,
        });

        // Debug: dump all history message roles and content types
        for (let i = 0; i < history.messages.length; i++) {
          const m = history.messages[i] as Record<string, unknown>;
          if (!isRecord(m)) continue;
          const r = typeof m.role === 'string' ? m.role : '?';
          let contentSummary: string;
          if (Array.isArray(m.content)) {
            const types = (m.content as Array<Record<string, unknown>>).filter(isRecord).map((b) => b.type);
            contentSummary = `blocks:[${types.join(',')}]`;
          } else if (typeof m.content === 'string') {
            contentSummary = `text(${(m.content as string).length})`;
          } else {
            contentSummary = String(typeof m.content);
          }
          console.debug(`[OpenClawRuntime] final sync history entry ${i}: role=${r} content=${contentSummary}`);
          if (r !== 'user' && Array.isArray(m.content)) {
            for (const block of m.content as Array<Record<string, unknown>>) {
              if (isRecord(block) && typeof block.type === 'string' && block.type !== 'text' && block.type !== 'thinking') {
                console.debug(`[OpenClawRuntime] final sync non-text history block ${i}:`, JSON.stringify(block).slice(0, 800));
              }
            }
          }
        }

        isChannel = Boolean(
          this.channelSessionSync
          && !isManagedSessionKey(turn.sessionKey)
          && this.channelSessionSync.isChannelSessionKey(turn.sessionKey)
        );
        if (isChannel) {
          const latestOnly = this.reCreatedChannelSessionIds.has(sessionId);
          this.syncChannelUserMessages(sessionId, history.messages, latestOnly, turn.sessionKey.includes(':discord:'), turn.sessionKey.includes(':qqbot:'), turn.sessionKey.includes(':moltbot-popo:'), turn.sessionKey.includes(':feishu:'));
        }

        if (!this.isCurrentTurnToken(sessionId, turn.turnToken)) {
          console.debug('[OpenClawRuntime] skipped final assistant sync for stale turn token');
          return;
        }

        canonicalText = extractCurrentTurnAssistantText(history.messages);
        if (isTransientGatewayStatusText(canonicalText)) {
          canonicalText = '';
        }

        if (canonicalText) {
          break;
        }
      }

      if (!historyMessages || !canonicalText) {
        console.debug('[OpenClawRuntime] no canonical assistant text found in gateway history');
        return;
      }

      // For channel sessions, append file paths from "message" tool calls as clickable links
      if (isChannel) {
        const sentFilePaths = extractSentFilePathsFromHistory(historyMessages);
        if (sentFilePaths.length > 0) {
          console.debug('[OpenClawRuntime] found sent file paths during final assistant sync');
          const fileLinks = sentFilePaths
            .map((fp) => `[${path.basename(fp)}](${fp})`)
            .join('\n');
          canonicalText = `${canonicalText}\n\n${fileLinks}`;
        }
      }

      const assistantMetadata = await this.enrichAssistantMetadataWithContext(
        turn.sessionKey,
        extractCurrentTurnAssistantMetadata(historyMessages),
      );

      console.debug('[OpenClawRuntime] resolved canonical final assistant text', {
        length: canonicalText.length,
        hasAssistantMessage: Boolean(turn.assistantMessageId),
      });

      const canonicalSegmentText = this.resolveAssistantSegmentText(turn, canonicalText);
      console.debug('[Debug:syncFinal] canonicalSegmentText length:', canonicalSegmentText.length,
        'committed.length:', turn.committedAssistantText.length,
        'segment:', canonicalSegmentText.slice(0, 80));
      turn.currentText = canonicalText;
      turn.currentAssistantSegmentText = canonicalSegmentText;

      if (!canonicalSegmentText) {
        return;
      }

      if (!turn.assistantMessageId) {
        const reusedMessageId = this.reuseFinalAssistantMessage(sessionId, canonicalSegmentText);
        if (reusedMessageId) {
          turn.assistantMessageId = reusedMessageId;
          if (assistantMetadata) {
            this.store.updateMessage(sessionId, reusedMessageId, {
              metadata: assistantMetadata,
            });
            this.emit('messageUpdate', sessionId, reusedMessageId, canonicalSegmentText, assistantMetadata);
          }
          return;
        }

        const assistantMessage = this.store.addMessage(sessionId, {
          type: 'assistant',
          content: canonicalSegmentText,
          metadata: {
            isStreaming: false,
            isFinal: true,
            ...(assistantMetadata ?? {}),
          },
        });
        turn.assistantMessageId = assistantMessage.id;
        this.emit('message', sessionId, assistantMessage);
        return;
      }

      const session = this.store.getSession(sessionId);
      const currentMessage = session?.messages.find((message) => message.id === turn.assistantMessageId);
      const currentText = currentMessage?.content.trim() ?? '';
      if (canonicalSegmentText === currentText) {
        if (assistantMetadata) {
          this.store.updateMessage(sessionId, turn.assistantMessageId, {
            metadata: {
              ...(currentMessage?.metadata ?? {}),
              ...assistantMetadata,
            },
          });
        }
        // Content matches but renderer may not have received the last throttled update.
        // Force-emit so the UI shows the final text.
        this.emit('messageUpdate', sessionId, turn.assistantMessageId, canonicalSegmentText, assistantMetadata);
        return;
      }

      console.debug('[Debug:syncFinal] updating last segment:', currentText.length, '->', canonicalSegmentText.length);
      this.store.updateMessage(sessionId, turn.assistantMessageId, {
        content: canonicalSegmentText,
        metadata: {
          isStreaming: false,
          isFinal: true,
          ...(assistantMetadata ?? {}),
        },
      });
      this.emit('messageUpdate', sessionId, turn.assistantMessageId, canonicalSegmentText, assistantMetadata);
    } catch (error) {
      console.warn('[OpenClawRuntime] chat.history sync after final failed:', error);
    }
  }

  private collectChannelHistoryEntries(
    historyMessages: unknown[],
    isDiscord: boolean,
    isQQ: boolean,
    isPopo: boolean = false,
    isFeishu: boolean = false,
  ): ChannelHistorySyncEntry[] {
    const historyEntries: ChannelHistorySyncEntry[] = [];
    for (const message of historyMessages) {
      const entry = extractGatewayHistoryEntries([message])[0];
      if (!entry) continue;
      const role = entry.role;
      if (role !== 'user' && role !== 'assistant') continue;
      const text = normalizeEntryText(role, entry.text, { isDiscord, isQQ, isPopo, isFeishu });
      if (text && !shouldSuppressHeartbeatText(role, text)) {
        const metadata = buildAssistantMetadataFromHistoryEntry(entry);
        historyEntries.push({
          role: role as 'user' | 'assistant',
          text,
          ...(metadata ? { metadata } : {}),
          ...(entry.timestamp != null ? { timestamp: entry.timestamp } : {}),
        });
      }
    }
    return historyEntries;
  }

  private collectLocalChannelEntries(sessionId: string): ChannelHistorySyncEntry[] {
    const session = this.store.getSession(sessionId);
    if (!session) return [];

    const localEntries: ChannelHistorySyncEntry[] = [];
    for (const msg of session.messages) {
      if (msg.type !== 'user' && msg.type !== 'assistant') continue;
      const text = msg.content.trim();
      if (!text) continue;
      localEntries.push({ role: msg.type, text, timestamp: msg.timestamp });
    }
    return localEntries;
  }

  private computeChannelHistoryFirstNewIndex(
    localEntries: ChannelHistorySyncEntry[],
    historyEntries: ChannelHistorySyncEntry[],
    cursor: number,
  ): { firstNewIdx: number; strategy: string } {
    if (localEntries.length === 0) {
      return { firstNewIdx: 0, strategy: 'empty-local' };
    }

    // `chat.history` is byte-bounded in OpenClaw, so the returned window can slide
    // long before it reaches our requested count. Match the local tail against the
    // current history prefix to find the continuation point without trusting length.
    const maxOverlap = Math.min(localEntries.length, historyEntries.length);
    for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
      let matched = true;
      for (let idx = 0; idx < overlap; idx += 1) {
        const localEntry = localEntries[localEntries.length - overlap + idx];
        const historyEntry = historyEntries[idx];
        if (!isSameChannelHistoryEntry(localEntry, historyEntry)) {
          matched = false;
          break;
        }
      }
      if (matched) {
        return { firstNewIdx: overlap, strategy: 'tail-overlap' };
      }
    }

    let lastLocalUserIdx = -1;
    for (let idx = localEntries.length - 1; idx >= 0; idx -= 1) {
      if (localEntries[idx].role === 'user') {
        lastLocalUserIdx = idx;
        break;
      }
    }

    if (lastLocalUserIdx >= 0) {
      const lastLocalUser = localEntries[lastLocalUserIdx];
      let prevLocalUserText: string | undefined;
      for (let idx = lastLocalUserIdx - 1; idx >= 0; idx -= 1) {
        if (localEntries[idx].role === 'user') {
          prevLocalUserText = localEntries[idx].text;
          break;
        }
      }

      for (let idx = historyEntries.length - 1; idx >= 0; idx -= 1) {
        if (historyEntries[idx].role !== 'user' || historyEntries[idx].text !== lastLocalUser.text) {
          continue;
        }
        if (prevLocalUserText !== undefined && idx > 0) {
          let prevHistUserText: string | undefined;
          for (let histIdx = idx - 1; histIdx >= 0; histIdx -= 1) {
            if (historyEntries[histIdx].role === 'user') {
              prevHistUserText = historyEntries[histIdx].text;
              break;
            }
          }
          if (prevHistUserText !== prevLocalUserText) {
            continue;
          }
        }
        return { firstNewIdx: idx + 1, strategy: 'last-user-anchor' };
      }
    }

    // When cursor > 0, tail-overlap and last-user-anchor (above) are the correct
    // content-based strategies for detecting a sliding history window.  If both
    // failed the mismatch is caused by duplicates in the local store, not by
    // genuinely new gateway messages.  Trust the cursor — it was set to
    // historyEntries.length at the end of the previous sync — instead of falling
    // through to forward-match, which can produce wildly wrong firstNewIdx values
    // when local entries are polluted (causing either an infinite re-sync loop
    // when cursor == historyEntries.length, or a burst of old messages being
    // re-synced when cursor < historyEntries.length).
    //
    // forward-match is still used when cursor == 0 (initial sync / after restart)
    // because there is no cursor history to rely on.
    if (cursor > 0) {
      if (cursor >= historyEntries.length) {
        return { firstNewIdx: historyEntries.length, strategy: 'cursor-stable' };
      }
      return { firstNewIdx: cursor, strategy: 'cursor-fallback' };
    }

    let localIdx = 0;
    let forwardFirstNewIdx = 0;
    for (let idx = 0; idx < historyEntries.length; idx += 1) {
      if (localIdx < localEntries.length && isSameChannelHistoryEntry(historyEntries[idx], localEntries[localIdx])) {
        localIdx += 1;
        forwardFirstNewIdx = idx + 1;
      }
    }
    if (forwardFirstNewIdx > 0) {
      return { firstNewIdx: forwardFirstNewIdx, strategy: 'forward-match' };
    }

    if (historyEntries.length < cursor) {
      return { firstNewIdx: 0, strategy: 'history-rewrite' };
    }

    return {
      firstNewIdx: Math.min(cursor, historyEntries.length),
      strategy: 'cursor-fallback',
    };
  }

  /**
   * Sync user messages from gateway chat.history that haven't been added to the local store yet.
   * Used for channel-originated sessions (e.g. Telegram) where user messages arrive via the
   * gateway rather than the LobsterAI UI.
   *
   * Called at the start of a new turn (via prefetchChannelUserMessages) so that user messages
   * appear before the assistant's streaming response. Both chat and agent events are buffered
   * during prefetch, so the replay order matches direct cowork sessions.
   *
   * Reconciles against the local tail instead of trusting history length/cursor alone,
   * because OpenClaw's `chat.history` window can slide due to byte limits well before
   * the requested message count is reached.
   */
  private syncChannelUserMessages(sessionId: string, historyMessages: unknown[], latestOnly = false, isDiscord = false, isQQ = false, isPopo = false, isFeishu = false): void {
    const historyEntries = this.collectChannelHistoryEntries(historyMessages, isDiscord, isQQ, isPopo, isFeishu);

    const cursor = this.channelSyncCursor.get(sessionId) ?? 0;

    // When latestOnly is true (e.g. session re-created after deletion),
    // only sync the last user message — the one that triggered this turn.
    // Advance cursor to end so subsequent syncs don't replay old history.
    if (latestOnly) {
      if (historyEntries.length > 0) {
        const lastUser = [...historyEntries].reverse().find((entry) => entry.role === 'user');
        if (lastUser) {
          // Dedup: skip if this message already exists locally
          const session = this.store.getSession(sessionId);
          const alreadyExists = session?.messages.some(
            (m: CoworkMessage) => m.type === 'user' && m.content.trim() === lastUser.text,
          ) ?? false;
          if (!alreadyExists) {
            const userMessage = this.store.addMessage(sessionId, {
              type: 'user',
              content: lastUser.text,
              metadata: {},
              timestamp: lastUser.timestamp,
            });
            this.emit('message', sessionId, userMessage);
          }
        }
      }
      this.channelSyncCursor.set(sessionId, historyEntries.length);
      return;
    }

    const localEntries = this.collectLocalChannelEntries(sessionId);
    const { firstNewIdx } = this.computeChannelHistoryFirstNewIndex(localEntries, historyEntries, cursor);

    // Sync user messages from gateway history.
    // Only sync user messages here — assistant messages are already added by the
    // real-time streaming pipeline (handleChatDelta / handleAgentEvent) and by
    // syncFinalAssistantWithHistory's own addMessage/updateMessage logic.
    //
    // When syncing a user message, check whether the corresponding assistant response
    // was already created locally (e.g. due to prefetch timeout where the assistant
    // streamed before user messages were synced). If so, use insertMessageBeforeId
    // to place the user message before the assistant — preserving correct chronological
    // order. This handles the race condition where gateway chat.history lags behind
    // the real-time streaming events.
    // Collect all user message indices that need syncing:
    // 1. Normal: user messages from firstNewIdx onwards
    // 2. Repair: user messages before firstNewIdx that are missing locally
    //    (can happen when computeChannelHistoryFirstNewIndex's forward-match
    //    strategy matches the assistant but skips the preceding user message)
    const currentSession = this.store.getSession(sessionId);
    const localUserTextCounts = new Map<string, number>();
    if (currentSession) {
      for (const msg of currentSession.messages) {
        if (msg.type === 'user') {
          const text = msg.content.trim();
          localUserTextCounts.set(text, (localUserTextCounts.get(text) ?? 0) + 1);
        }
      }
    }

    const userIndicesToSync: number[] = [];
    // Normal range: from firstNewIdx onwards — these are definitively new messages.
    for (let i = firstNewIdx; i < historyEntries.length; i++) {
      if (historyEntries[i].role === 'user') {
        userIndicesToSync.push(i);
      }
    }
    // Repair range: before firstNewIdx. Use counts so repeated identical user
    // messages are not collapsed into one entry.
    const repairCounts = new Map(localUserTextCounts);
    for (let i = 0; i < firstNewIdx; i++) {
      if (historyEntries[i].role !== 'user') continue;
      const remaining = repairCounts.get(historyEntries[i].text) ?? 0;
      if (remaining > 0) {
        repairCounts.set(historyEntries[i].text, remaining - 1);
      } else {
        userIndicesToSync.push(i);
      }
    }

    for (const idx of userIndicesToSync) {
      const entry = historyEntries[idx];

      // Find the next assistant entry in history after this user entry, then
      // look for a matching local assistant message. If found, insert the user
      // message before it to maintain correct chronological order.
      let insertBeforeId: string | null = null;
      if (currentSession) {
        for (let j = idx + 1; j < historyEntries.length; j++) {
          if (historyEntries[j].role !== 'assistant') continue;
          const assistantText = historyEntries[j].text;
          // Match by content prefix — local text may be segmented or truncated
          const matchPrefix = assistantText.slice(0, 100);
          const localMatch = currentSession.messages.find(
            (m: CoworkMessage) => m.type === 'assistant' && m.content.trim().startsWith(matchPrefix),
          );
          if (localMatch) {
            insertBeforeId = localMatch.id;
          }
          break;
        }
      }

      let userMessage;
      if (insertBeforeId) {
        userMessage = this.store.insertMessageBeforeId(sessionId, insertBeforeId, {
          type: 'user',
          content: entry.text,
          metadata: {},
          timestamp: entry.timestamp,
        });
        console.debug('[syncChannelUserMessages] inserted user message before assistant, sessionId:', sessionId);
      } else {
        userMessage = this.store.addMessage(sessionId, {
          type: 'user',
          content: entry.text,
          metadata: {},
          timestamp: entry.timestamp,
        });
      }
      this.emit('message', sessionId, userMessage);
    }

    this.channelSyncCursor.set(sessionId, historyEntries.length);
  }

  private getUserMessageCount(sessionId: string): number {
    const session = this.store.getSession(sessionId);
    if (!session) return 0;
    return session.messages.filter((m: CoworkMessage) => m.type === 'user').length;
  }

  /**
   * Sync full conversation history for a newly discovered channel session.
   * Adds both user and assistant messages to the local CoworkStore in order.
   * Skipped if the session has already been fully synced.
   *
   * Uses position-based matching to avoid false dedup of identical-content messages.
   */

  private async syncFullChannelHistory(sessionId: string, sessionKey: string): Promise<void> {
    if (this.fullySyncedSessions.has(sessionId)) return;
    this.fullySyncedSessions.add(sessionId);

    try {
      await this.reconcileWithHistory(sessionId, sessionKey, { isFullSync: true });
    } catch (error) {
      console.error('[ChannelSync] syncFullChannelHistory: error:', error);
      // Remove from synced set so retry is possible
      this.fullySyncedSessions.delete(sessionId);
    }
  }

  /**
   * Incremental sync for an already-known channel session.
   * Delegates to reconcileWithHistory which handles diff and update.
   */
  private async incrementalChannelSync(sessionId: string, sessionKey: string): Promise<void> {
    await this.reconcileWithHistory(sessionId, sessionKey);
  }

  /**
   * Trigger an immediate incremental sync after a channel session turn completes,
   * so that the renderer sees the latest messages without waiting for the next poll.
   */
  private syncChannelAfterTurn(sessionId: string, sessionKey: string): void {
    if (!this.channelSessionSync || !sessionKey) return;
    if (!this.channelSessionSync.isChannelSessionKey(sessionKey)) return;
    if (!this.fullySyncedSessions.has(sessionId)) return;

    void this.reconcileWithHistory(sessionId, sessionKey).catch((err) => {
      console.warn('[ChannelSync] post-turn incremental sync failed for', sessionKey, err);
    });
  }

  private clearPendingApprovalsBySession(sessionId: string): void {
    for (const [requestId, pending] of this.pendingApprovals.entries()) {
      if (pending.sessionId === sessionId) {
        this.pendingApprovals.delete(requestId);
      }
    }
  }

  private cleanupSessionTurn(sessionId: string): void {
    const turn = this.activeTurns.get(sessionId);
    if (turn) {
      // Clear client-side timeout watchdog
      if (turn.timeoutTimer) {
        clearTimeout(turn.timeoutTimer);
        turn.timeoutTimer = undefined;
      }
      if (turn.chatFinalCompletionTimer) {
        clearTimeout(turn.chatFinalCompletionTimer);
        turn.chatFinalCompletionTimer = undefined;
      }
      // Cancel any pending throttled messageUpdate timer for this turn
      if (turn.assistantMessageId) {
        this.clearPendingMessageUpdate(turn.assistantMessageId);
        this.lastMessageUpdateEmitTime.delete(turn.assistantMessageId);
        this.clearPendingStoreUpdate(turn.assistantMessageId);
        this.lastStoreUpdateTime.delete(turn.assistantMessageId);
      }
      turn.knownRunIds.forEach((knownRunId) => {
        this.rememberRecentlyClosedRunId(knownRunId);
        this.sessionIdByRunId.delete(knownRunId);
        this.pendingAgentEventsByRunId.delete(knownRunId);
        this.lastChatSeqByRunId.delete(knownRunId);
        this.lastAgentSeqByRunId.delete(knownRunId);
      });
    }
    this.activeTurns.delete(sessionId);
    setCoworkProxySessionId(null);
    setCoworkProxyAgentId(null);
    // NOTE: Do NOT clear lastSystemPromptBySession here — it must persist
    // across turns so that the system prompt is only injected on the first
    // turn of a session (or when it actually changes).  Cleanup happens in
    // onSessionDeleted() when the session is removed entirely.
    this.reCreatedChannelSessionIds.delete(sessionId);
  }

  /**
   * Start a client-side timeout watchdog for a turn.
   * Fires after the server-side timeout + grace period, recovering the UI
   * if the gateway fails to deliver the abort/final event.
   */
  private startTurnTimeoutWatchdog(sessionId: string): void {
    const turn = this.activeTurns.get(sessionId);
    if (!turn) return;
    const timeoutMs = this.agentTimeoutSeconds * 1000
      + OpenClawRuntimeAdapter.CLIENT_TIMEOUT_GRACE_MS;
    turn.timeoutTimer = setTimeout(() => {
      const currentTurn = this.activeTurns.get(sessionId);
      if (!currentTurn || currentTurn.turnToken !== turn.turnToken) return;
      const elapsedSec = ((Date.now() - currentTurn.startedAtMs) / 1000).toFixed(1);
      console.warn(
        '[AbortDiag] client-side timeout watchdog fired',
        `sessionId=${sessionId}`,
        `runId=${currentTurn.runId}`,
        `elapsed=${elapsedSec}s`,
        `watchdogMs=${timeoutMs}`,
        'gateway did not deliver abort event',
      );
      this.handleChatAborted(sessionId, currentTurn);
    }, timeoutMs);
  }

  /**
   * Called when a session is deleted from the store.
   * Purges all in-memory references so that new channel messages
   * with the same sessionKey can create a fresh session.
   */
  onSessionDeleted(sessionId: string): void {
    // Remove sessionIdBySessionKey entries pointing to this session
    const removedKeys: string[] = [];
    for (const [key, id] of this.sessionIdBySessionKey.entries()) {
      if (id === sessionId) {
        this.sessionIdBySessionKey.delete(key);
        removedKeys.push(key);
      }
    }

    // Suppress polling re-creation for deleted channel keys.
    // Only real-time events (new IM messages) will re-create the session.
    for (const key of removedKeys) {
      this.deletedChannelKeys.add(key);
    }
    this.pruneSetToLimit(
      this.deletedChannelKeys,
      OpenClawRuntimeAdapter.DELETED_CHANNEL_KEY_LIMIT,
    );

    // Allow polling to rediscover channel sessions
    this.knownChannelSessionIds.delete(sessionId);

    // Allow full history re-sync when session is re-created
    this.fullySyncedSessions.delete(sessionId);
    this.channelSyncCursor.delete(sessionId);
    this.reCreatedChannelSessionIds.delete(sessionId);
    this.gatewayHistoryCountBySession.delete(sessionId);
    this.latestTurnTokenBySession.delete(sessionId);

    // Clean up active turn and related run-id mappings
    this.cleanupSessionTurn(sessionId);

    // Clean up pending approvals, bridged state, confirmation mode
    this.clearPendingApprovalsBySession(sessionId);
    this.bridgedSessions.delete(sessionId);
    this.confirmationModeBySession.delete(sessionId);
    this.manuallyStoppedSessions.delete(sessionId);
    this.stoppedSessionTimestamps.delete(sessionId);
    this.lastPatchedModelBySession.delete(sessionId);
    this.sessionModelPatchQueue.delete(sessionId);

    // Propagate to channel session sync
    if (this.channelSessionSync) {
      this.channelSessionSync.onSessionDeleted(sessionId);
    }
    this.subagentTracker?.onSessionDeleted(sessionId);
  }

  listSubagentRuns(parentSessionId: string) {
    return this.subagentTracker?.listSubagentRuns(parentSessionId) ?? [];
  }

  async getSubTaskHistory(
    parentSessionId: string,
    agentId: string,
    sessionKey?: string,
  ): Promise<CoworkMessage[]> {
    const messages = await this.subagentTracker?.getSubTaskHistory(parentSessionId, agentId, sessionKey) ?? [];
    return messages.map((message) => ({
      id: message.id,
      type: message.type,
      content: message.content,
      timestamp: message.timestamp,
      metadata: message.metadata,
    }));
  }

  /**
   * Ensure an ActiveTurn exists for a session. Used for channel-originated sessions
   * where new turns arrive after the previous turn was cleaned up.
   */
  private isSessionInStopCooldown(sessionId: string): boolean {
    const stoppedAt = this.stoppedSessionTimestamps.get(sessionId);
    if (stoppedAt === undefined) return false;
    if (Date.now() - stoppedAt < OpenClawRuntimeAdapter.STOP_COOLDOWN_MS) {
      return true;
    }
    this.stoppedSessionTimestamps.delete(sessionId);
    return false;
  }

  private ensureActiveTurn(sessionId: string, sessionKey: string, runId: string): void {
    if (this.activeTurns.has(sessionId)) return;
    if (runId && this.isRecentlyClosedRunId(runId)) {
      console.debug('[OpenClawRuntime] suppressed active turn creation for a closed run.');
      return;
    }
    if (this.isSessionInStopCooldown(sessionId)) {
      console.debug('[OpenClawRuntime] suppressed active turn creation during manual stop cooldown.');
      return;
    }
    if (this.manuallyStoppedSessions.has(sessionId)) {
      const isChannel = this.channelSessionSync
        && !isManagedSessionKey(sessionKey)
        && this.channelSessionSync.isChannelSessionKey(sessionKey);
      if (isChannel) {
        console.log('[Debug:ensureActiveTurn] cooldown expired, clearing manuallyStoppedSessions for channel re-activation, sessionId:', sessionId);
        this.manuallyStoppedSessions.delete(sessionId);
      } else {
        console.log('[Debug:ensureActiveTurn] suppressed — desktop session was manually stopped, sessionId:', sessionId);
        return;
      }
    }
    const turnRunId = runId || randomUUID();
    const turnToken = this.nextTurnToken(sessionId);
    const isChannel = this.channelSessionSync
      && !isManagedSessionKey(sessionKey)
      && this.channelSessionSync.isChannelSessionKey(sessionKey);
    console.log('[Debug:ensureActiveTurn] creating turn — sessionId:', sessionId, 'sessionKey:', sessionKey, 'runId:', turnRunId, 'isChannel:', !!isChannel, 'pendingUserSync:', !!isChannel);
    this.activeTurns.set(sessionId, {
      sessionId,
      sessionKey,
      runId: turnRunId,
      turnToken,
      startedAtMs: Date.now(),
      knownRunIds: new Set(runId ? [runId] : [turnRunId]),
      assistantMessageId: null,
      committedAssistantText: '',
      currentAssistantSegmentText: '',
      currentText: '',
      agentAssistantTextLength: 0,
      hasSeenAgentAssistantStream: false,
      currentContentText: '',
      currentContentBlocks: [],
      sawNonTextContentBlocks: false,
      textStreamMode: 'unknown',
      toolUseMessageIdByToolCallId: new Map(),
      toolResultMessageIdByToolCallId: new Map(),
      toolResultTextByToolCallId: new Map(),
      stopRequested: false,
      pendingUserSync: !!isChannel,
      bufferedChatPayloads: [],
      bufferedAgentPayloads: [],
    });
    if (runId) {
      this.sessionIdByRunId.set(runId, sessionId);
    }
    this.store.updateSession(sessionId, { status: 'running' });
    this.startTurnTimeoutWatchdog(sessionId);

    // For channel sessions, prefetch user messages before streaming starts
    if (isChannel) {
      void this.prefetchChannelUserMessages(sessionId, sessionKey);
    }
  }

  /**
   * Prefetch user messages from gateway history at the start of a channel session turn.
   * This ensures user messages appear before the assistant's streaming response.
   * Delta/final events are buffered until this completes.
   */
  private async prefetchChannelUserMessages(sessionId: string, sessionKey: string): Promise<void> {
    console.log('[Debug:prefetch] start — sessionId:', sessionId, 'sessionKey:', sessionKey);

    // Best-effort prefetch with 2 attempts. Final correctness is ensured by
    // reconcileWithHistory after the turn completes.
    const MAX_ATTEMPTS = 2;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const client = this.gatewayClient;
        if (!client) {
          console.log('[Debug:prefetch] no gateway client available');
          break;
        }

        const history = await client.request<{ messages?: unknown[] }>('chat.history', {
          sessionKey,
          limit: FINAL_HISTORY_SYNC_LIMIT,
        }, { timeoutMs: 5_000 });
        const msgCount = Array.isArray(history?.messages) ? history.messages.length : 0;
        console.log('[Debug:prefetch] chat.history returned', msgCount, 'messages (attempt', attempt, ')');

        if (Array.isArray(history?.messages) && history.messages.length > 0) {
          this.markGatewayHistoryWindowConsumed(sessionId, history.messages);
          const latestOnly = this.reCreatedChannelSessionIds.has(sessionId);
          const beforeCount = this.getUserMessageCount(sessionId);
                  this.syncChannelUserMessages(sessionId, history.messages, latestOnly, sessionKey.includes(':discord:'), sessionKey.includes(':qqbot:'), sessionKey.includes(':moltbot-popo:'), sessionKey.includes(':feishu:'));
          const afterCount = this.getUserMessageCount(sessionId);
          const newUserMessages = afterCount - beforeCount;
          console.log('[Debug:prefetch] synced user messages:', newUserMessages, '(before:', beforeCount, 'after:', afterCount, ')');

          if (newUserMessages > 0) {
            break;
          }

          // Retry once if buffered events suggest history hasn't caught up yet
          if (attempt < MAX_ATTEMPTS - 1) {
            const turn = this.activeTurns.get(sessionId);
            if (turn && (turn.bufferedChatPayloads.length > 0 || turn.bufferedAgentPayloads.length > 0)) {
              console.log('[Debug:prefetch] no new user messages but have buffered events, retrying after 500ms...');
              await new Promise((resolve) => setTimeout(resolve, 500));
              continue;
            }
          }
          break;
        } else {
          // Retry once if buffered events suggest history hasn't caught up yet
          if (attempt < MAX_ATTEMPTS - 1) {
            const turn = this.activeTurns.get(sessionId);
            if (turn && (turn.bufferedChatPayloads.length > 0 || turn.bufferedAgentPayloads.length > 0)) {
              console.log('[Debug:prefetch] empty history but have buffered events, retrying after 500ms...');
              await new Promise((resolve) => setTimeout(resolve, 500));
              continue;
            }
          }
          break;
        }
      } catch (error) {
        console.warn('[OpenClawRuntime] prefetchChannelUserMessages attempt', attempt, 'failed:', error);
        if (attempt < MAX_ATTEMPTS - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }

    const turn = this.activeTurns.get(sessionId);
    if (!turn) {
      console.log('[Debug:prefetch] turn was removed during prefetch, cannot replay. sessionId:', sessionId);
      return;
    }
    turn.pendingUserSync = false;

    const chatBuffered = turn.bufferedChatPayloads.length;
    const agentBuffered = turn.bufferedAgentPayloads.length;
    console.log('[Debug:prefetch] replaying buffered events — chat:', chatBuffered, 'agent:', agentBuffered);

    // Merge and replay both chat and agent events in sequence order
    // so that tool use/result messages are interleaved with assistant text segments
    // just like in direct cowork sessions.
    const allBuffered: Array<{ type: 'chat' | 'agent'; payload: unknown; seq?: number; bufferedAt: number; idx: number }> = [];
    let bufIdx = 0;
    for (const event of turn.bufferedChatPayloads) {
      allBuffered.push({ type: 'chat', payload: event.payload, seq: event.seq, bufferedAt: event.bufferedAt, idx: bufIdx++ });
    }
    for (const event of turn.bufferedAgentPayloads) {
      allBuffered.push({ type: 'agent', payload: event.payload, seq: event.seq, bufferedAt: event.bufferedAt, idx: bufIdx++ });
    }
    turn.bufferedChatPayloads = [];
    turn.bufferedAgentPayloads = [];

    allBuffered.sort((a, b) => {
      // Primary: sort by seq if both have it
      const hasSeqA = typeof a.seq === 'number';
      const hasSeqB = typeof b.seq === 'number';
      if (hasSeqA && hasSeqB) return a.seq! - b.seq!;
      // Events with seq come before events without
      if (hasSeqA !== hasSeqB) return hasSeqA ? -1 : 1;
      // Fallback: preserve arrival order via bufferedAt, then insertion index
      if (a.bufferedAt !== b.bufferedAt) return a.bufferedAt - b.bufferedAt;
      return a.idx - b.idx;
    });

    for (const event of allBuffered) {
      if (event.type === 'chat') {
        this.handleChatEvent(event.payload, event.seq);
      } else {
        this.handleAgentEvent(event.payload, event.seq);
      }
    }
    console.log('[Debug:prefetch] replay complete, sessionId:', sessionId);
  }

  private bindRunIdToTurn(sessionId: string, runId: string): void {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) return;
    if (this.isRecentlyClosedRunId(normalizedRunId)) {
      console.debug('[OpenClawRuntime] suppressed run binding for a closed run.');
      return;
    }
    const turn = this.activeTurns.get(sessionId);
    if (!turn) return;
    turn.knownRunIds.add(normalizedRunId);
    this.sessionIdByRunId.set(normalizedRunId, sessionId);
    this.flushPendingAgentEvents(sessionId, normalizedRunId);
  }

  private resolveTurn(sessionId: string): void {
    const pending = this.pendingTurns.get(sessionId);
    if (!pending) return;
    this.pendingTurns.delete(sessionId);
    pending.resolve();
  }

  private rejectTurn(sessionId: string, error: Error): void {
    const pending = this.pendingTurns.get(sessionId);
    if (!pending) return;
    this.pendingTurns.delete(sessionId);
    pending.reject(error);
  }

  private toSessionKey(sessionId: string, agentId?: string): string {
    return buildManagedSessionKey(sessionId, agentId);
  }

  private requireGatewayClient(): GatewayClientLike {
    if (!this.gatewayClient) {
      throw new Error('OpenClaw gateway client is unavailable.');
    }
    return this.gatewayClient;
  }

  /**
   * Return the current gateway client instance, or null if not yet connected.
   * Used by CronJobService to call cron.* APIs on the same gateway.
   */
  getGatewayClient(): GatewayClientLike | null {
    return this.gatewayClient;
  }

  getSessionKeysForSession(sessionId: string): string[] {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) {
      return [];
    }

    const keys: string[] = [];
    for (const [key, mappedSessionId] of this.sessionIdBySessionKey.entries()) {
      if (mappedSessionId === normalizedSessionId) {
        keys.push(key);
      }
    }

    const session = this.store.getSession(normalizedSessionId);
    const managedKey = this.toSessionKey(normalizedSessionId, session?.agentId);
    if (!keys.includes(managedKey)) {
      keys.push(managedKey);
    }

    keys.sort((left, right) => {
      const leftManaged = isManagedSessionKey(left);
      const rightManaged = isManagedSessionKey(right);
      if (leftManaged !== rightManaged) {
        return leftManaged ? 1 : -1;
      }
      return left.localeCompare(right);
    });

    return keys;
  }

  /**
   * Ensure the gateway client is connected and ready.
   * Resolves when the WebSocket connection is established and authenticated.
   */
  async ensureReady(): Promise<void> {
    await this.ensureGatewayClientReady();
  }
}
