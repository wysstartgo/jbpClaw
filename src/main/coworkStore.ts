import crypto from 'crypto';
import { app } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

import type { Platform } from '../shared/platform';
import { QingShuObjectSourceType, type QingShuObjectSourceType as QingShuObjectSourceTypeValue } from '../shared/qingshuManaged/constants';
import {
  type CoworkMemoryGuardLevel,
  extractTurnMemoryChanges,
  isQuestionLikeMemoryText,
} from './libs/coworkMemoryExtractor';
import { judgeMemoryCandidate } from './libs/coworkMemoryJudge';

// Default working directory for new users
const getDefaultWorkingDirectory = (): string => {
  return path.join(os.homedir(), 'lobsterai', 'project');
};

const TASK_WORKSPACE_CONTAINER_DIR = '.lobsterai-tasks';

const normalizeRecentWorkspacePath = (cwd: string): string => {
  const resolved = path.resolve(cwd);
  const marker = `${path.sep}${TASK_WORKSPACE_CONTAINER_DIR}${path.sep}`;
  const markerIndex = resolved.lastIndexOf(marker);
  if (markerIndex > 0) {
    return resolved.slice(0, markerIndex);
  }
  return resolved;
};

const DEFAULT_MEMORY_ENABLED = true;
const DEFAULT_MEMORY_IMPLICIT_UPDATE_ENABLED = true;
const DEFAULT_MEMORY_LLM_JUDGE_ENABLED = false;
const DEFAULT_MEMORY_GUARD_LEVEL: CoworkMemoryGuardLevel = 'strict';
const DEFAULT_MEMORY_USER_MEMORIES_MAX_ITEMS = 12;
const DEFAULT_SKIP_MISSED_JOBS = true;
const DEFAULT_EMBEDDING_ENABLED = false;
const DEFAULT_EMBEDDING_PROVIDER = 'openai';
const DEFAULT_EMBEDDING_MODEL = '';
const DEFAULT_EMBEDDING_LOCAL_MODEL_PATH = '';
const DEFAULT_EMBEDDING_VECTOR_WEIGHT = 0.7;
const DEFAULT_EMBEDDING_REMOTE_BASE_URL = '';
const DEFAULT_EMBEDDING_REMOTE_API_KEY = '';
const DEFAULT_DREAMING_ENABLED = false;
const DEFAULT_DREAMING_FREQUENCY = '0 3 * * *';
const DEFAULT_DREAMING_MODEL = '';
const DEFAULT_DREAMING_TIMEZONE = '';
const OPENCLAW_SESSION_KEEP_ALIVE_VALUES = ['1d', '7d', '30d', '365d'] as const;
type OpenClawSessionKeepAlive = typeof OPENCLAW_SESSION_KEEP_ALIVE_VALUES[number];
type OpenClawSessionPolicyConfig = {
  keepAlive: OpenClawSessionKeepAlive;
};
const DEFAULT_OPENCLAW_SESSION_POLICY_CONFIG: OpenClawSessionPolicyConfig = {
  keepAlive: '30d',
};
const MIN_MEMORY_USER_MEMORIES_MAX_ITEMS = 1;
const MAX_MEMORY_USER_MEMORIES_MAX_ITEMS = 60;
const MEMORY_NEAR_DUPLICATE_MIN_SCORE = 0.82;
const MEMORY_PROCEDURAL_TEXT_RE = /(执行以下命令|run\s+(?:the\s+)?following\s+command|\b(?:cd|npm|pnpm|yarn|node|python|bash|sh|git|curl|wget)\b|\$[A-Z_][A-Z0-9_]*|&&|--[a-z0-9-]+|\/tmp\/|\.sh\b|\.bat\b|\.ps1\b)/i;
const MEMORY_ASSISTANT_STYLE_TEXT_RE = /^(?:使用|use)\s+[A-Za-z0-9._-]+\s*(?:技能|skill)/i;

function normalizeMemoryGuardLevel(value: string | undefined): CoworkMemoryGuardLevel {
  if (value === 'strict' || value === 'standard' || value === 'relaxed') return value;
  return DEFAULT_MEMORY_GUARD_LEVEL;
}

function parseBooleanConfig(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
  return fallback;
}

function clampMemoryUserMemoriesMaxItems(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MEMORY_USER_MEMORIES_MAX_ITEMS;
  return Math.max(
    MIN_MEMORY_USER_MEMORIES_MAX_ITEMS,
    Math.min(MAX_MEMORY_USER_MEMORIES_MAX_ITEMS, Math.floor(value))
  );
}

function parseEmbeddingVectorWeight(value: string | undefined): number {
  if (!value) return DEFAULT_EMBEDDING_VECTOR_WEIGHT;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_EMBEDDING_VECTOR_WEIGHT;
  return Math.max(0, Math.min(1, parsed));
}

function normalizeOpenClawSessionPolicyConfig(value: unknown): OpenClawSessionPolicyConfig {
  const keepAlive = (value as { keepAlive?: string } | null)?.keepAlive;
  if (keepAlive && OPENCLAW_SESSION_KEEP_ALIVE_VALUES.includes(keepAlive as OpenClawSessionKeepAlive)) {
    return { keepAlive: keepAlive as OpenClawSessionKeepAlive };
  }
  return DEFAULT_OPENCLAW_SESSION_POLICY_CONFIG;
}

function normalizeMemoryText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function extractConversationSearchTerms(value: string): string[] {
  const normalized = normalizeMemoryText(value).toLowerCase();
  if (!normalized) return [];

  const terms: string[] = [];
  const seen = new Set<string>();
  const addTerm = (term: string): void => {
    const normalizedTerm = normalizeMemoryText(term).toLowerCase();
    if (!normalizedTerm) return;
    if (/^[a-z0-9]$/i.test(normalizedTerm)) return;
    if (seen.has(normalizedTerm)) return;
    seen.add(normalizedTerm);
    terms.push(normalizedTerm);
  };

  // Keep the full phrase and additionally match by per-token terms.
  addTerm(normalized);
  const tokens = normalized
    .split(/[\s,，、|/\\;；]+/g)
    .map((token) => token.replace(/^['"`]+|['"`]+$/g, '').trim())
    .filter(Boolean);

  for (const token of tokens) {
    addTerm(token);
    if (terms.length >= 8) break;
  }

  return terms.slice(0, 8);
}

function normalizeMemoryMatchKey(value: string): string {
  return normalizeMemoryText(value)
    .toLowerCase()
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMemorySemanticKey(value: string): string {
  const key = normalizeMemoryMatchKey(value);
  if (!key) return '';
  return key
    .replace(/^(?:the user|user|i am|i m|i|my|me)\s+/i, '')
    .replace(/^(?:该用户|这个用户|用户|本人|我的|我们|咱们|咱|我|你的|你)\s*/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildTokenFrequencyMap(value: string): Map<string, number> {
  const tokens = value
    .split(/\s+/g)
    .map((token) => token.trim())
    .filter(Boolean);
  const map = new Map<string, number>();
  for (const token of tokens) {
    map.set(token, (map.get(token) || 0) + 1);
  }
  return map;
}

function scoreTokenOverlap(left: string, right: string): number {
  const leftMap = buildTokenFrequencyMap(left);
  const rightMap = buildTokenFrequencyMap(right);
  if (leftMap.size === 0 || rightMap.size === 0) return 0;

  let leftCount = 0;
  let rightCount = 0;
  let intersection = 0;
  for (const count of leftMap.values()) leftCount += count;
  for (const count of rightMap.values()) rightCount += count;
  for (const [token, leftValue] of leftMap.entries()) {
    intersection += Math.min(leftValue, rightMap.get(token) || 0);
  }

  const denominator = Math.min(leftCount, rightCount);
  if (denominator <= 0) return 0;
  return intersection / denominator;
}

function buildCharacterBigramMap(value: string): Map<string, number> {
  const compact = value.replace(/\s+/g, '').trim();
  if (!compact) return new Map<string, number>();
  if (compact.length <= 1) return new Map<string, number>([[compact, 1]]);

  const map = new Map<string, number>();
  for (let index = 0; index < compact.length - 1; index += 1) {
    const gram = compact.slice(index, index + 2);
    map.set(gram, (map.get(gram) || 0) + 1);
  }
  return map;
}

function scoreCharacterBigramDice(left: string, right: string): number {
  const leftMap = buildCharacterBigramMap(left);
  const rightMap = buildCharacterBigramMap(right);
  if (leftMap.size === 0 || rightMap.size === 0) return 0;

  let leftCount = 0;
  let rightCount = 0;
  let intersection = 0;
  for (const count of leftMap.values()) leftCount += count;
  for (const count of rightMap.values()) rightCount += count;
  for (const [gram, leftValue] of leftMap.entries()) {
    intersection += Math.min(leftValue, rightMap.get(gram) || 0);
  }

  const denominator = leftCount + rightCount;
  if (denominator <= 0) return 0;
  return (2 * intersection) / denominator;
}

function scoreMemorySimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;

  const compactLeft = left.replace(/\s+/g, '');
  const compactRight = right.replace(/\s+/g, '');
  if (compactLeft && compactLeft === compactRight) {
    return 1;
  }

  let phraseScore = 0;
  if (compactLeft && compactRight && (compactLeft.includes(compactRight) || compactRight.includes(compactLeft))) {
    phraseScore = Math.min(compactLeft.length, compactRight.length) / Math.max(compactLeft.length, compactRight.length);
  }

  return Math.max(
    phraseScore,
    scoreTokenOverlap(left, right),
    scoreCharacterBigramDice(left, right)
  );
}

function scoreMemoryTextQuality(value: string): number {
  const normalized = normalizeMemoryText(value);
  if (!normalized) return 0;
  let score = normalized.length;
  if (/^(?:该用户|这个用户|用户)\s*/u.test(normalized)) {
    score -= 12;
  }
  if (/^(?:the user|user)\b/i.test(normalized)) {
    score -= 12;
  }
  if (/^(?:我|我的|我是|我有|我会|我喜欢|我偏好)/u.test(normalized)) {
    score += 4;
  }
  if (/^(?:i|i am|i'm|my)\b/i.test(normalized)) {
    score += 4;
  }
  return score;
}

function choosePreferredMemoryText(currentText: string, incomingText: string): string {
  const normalizedCurrent = truncate(normalizeMemoryText(currentText), 360);
  const normalizedIncoming = truncate(normalizeMemoryText(incomingText), 360);
  if (!normalizedCurrent) return normalizedIncoming;
  if (!normalizedIncoming) return normalizedCurrent;

  const currentScore = scoreMemoryTextQuality(normalizedCurrent);
  const incomingScore = scoreMemoryTextQuality(normalizedIncoming);
  if (incomingScore > currentScore + 1) return normalizedIncoming;
  if (currentScore > incomingScore + 1) return normalizedCurrent;
  return normalizedIncoming.length >= normalizedCurrent.length ? normalizedIncoming : normalizedCurrent;
}

function isMeaningfulDeleteFragment(value: string): boolean {
  if (!value) return false;
  const tokens = value.split(/\s+/g).filter(Boolean);
  if (tokens.length >= 2) return true;
  if (/[\u3400-\u9fff]/u.test(value)) return value.length >= 4;
  return value.length >= 6;
}

function includesAsBoundedPhrase(target: string, fragment: string): boolean {
  if (!target || !fragment) return false;
  const paddedTarget = ` ${target} `;
  const paddedFragment = ` ${fragment} `;
  if (paddedTarget.includes(paddedFragment)) {
    return true;
  }
  // CJK phrases are often unsegmented, so token boundaries are unreliable.
  if (/[\u3400-\u9fff]/u.test(fragment) && !fragment.includes(' ')) {
    return target.includes(fragment);
  }
  return false;
}

function scoreDeleteMatch(targetKey: string, queryKey: string): number {
  if (!targetKey || !queryKey) return 0;
  if (targetKey === queryKey) {
    return 1000 + queryKey.length;
  }
  if (!isMeaningfulDeleteFragment(queryKey)) {
    return 0;
  }
  if (!includesAsBoundedPhrase(targetKey, queryKey)) {
    return 0;
  }
  return 100 + Math.min(targetKey.length, queryKey.length);
}

function buildMemoryFingerprint(text: string): string {
  const key = normalizeMemoryMatchKey(text);
  return crypto.createHash('sha1').update(key).digest('hex');
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 1)}…`;
}

function parseTimeToMs(input?: string | null): number | null {
  if (!input) return null;
  const timestamp = Date.parse(input);
  if (!Number.isFinite(timestamp)) return null;
  return timestamp;
}

function normalizeMessageTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function shouldAutoDeleteMemoryText(text: string): boolean {
  const normalized = normalizeMemoryText(text);
  if (!normalized) return false;
  return MEMORY_ASSISTANT_STYLE_TEXT_RE.test(normalized)
    || MEMORY_PROCEDURAL_TEXT_RE.test(normalized)
    || isQuestionLikeMemoryText(normalized);
}

function hasTableColumn(db: Database.Database, tableName: string, columnName: string): boolean {
  try {
    const columns = db.pragma(`table_info(${tableName})`) as Array<{ name: string }>;
    return columns.some(column => column.name === columnName);
  } catch {
    return false;
  }
}

// Types mirroring src/types/cowork.ts for main process use
export type CoworkSessionStatus = 'idle' | 'running' | 'completed' | 'error';
export type CoworkMessageType = 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system';
export type CoworkExecutionMode = 'auto' | 'local' | 'sandbox';
export type CoworkAgentEngine = 'openclaw' | 'yd_cowork';

export type AgentSource = 'custom' | 'preset' | 'managed';
export type PluginSource = 'npm' | 'clawhub' | 'git' | 'local';

export interface Agent {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  identity: string;
  model: string;
  workingDirectory: string;
  icon: string;
  skillIds: string[];
  toolBundleIds: string[];
  enabled: boolean;
  isDefault: boolean;
  source: AgentSource;
  sourceType?: QingShuObjectSourceTypeValue;
  readOnly?: boolean;
  allowed?: boolean;
  backendAgentId?: string;
  managedToolNames?: string[];
  managedBaseSkillIds?: string[];
  managedExtraSkillIds?: string[];
  policyNote?: string;
  presetId: string;
  createdAt: number;
  updatedAt: number;
}

export interface UserInstalledPlugin {
  pluginId: string;
  source: PluginSource;
  spec: string;
  registry?: string;
  version?: string;
  enabled: boolean;
  installedAt: number;
  config?: Record<string, unknown>;
}

export interface CreateAgentRequest {
  id?: string;
  name: string;
  description?: string;
  systemPrompt?: string;
  identity?: string;
  model?: string;
  workingDirectory?: string;
  icon?: string;
  skillIds?: string[];
  toolBundleIds?: string[];
  source?: AgentSource;
  presetId?: string;
}

export interface UpdateAgentRequest {
  name?: string;
  description?: string;
  systemPrompt?: string;
  identity?: string;
  model?: string;
  workingDirectory?: string;
  icon?: string;
  skillIds?: string[];
  toolBundleIds?: string[];
  enabled?: boolean;
}

const COWORK_AGENT_ENGINE = 'openclaw';

function normalizeCoworkAgentEngineValue(value?: string | null): CoworkAgentEngine {
  if (value === COWORK_AGENT_ENGINE || value === 'openclaw') {
    return value;
  }
  return COWORK_AGENT_ENGINE;
}

export interface CoworkMessageMetadata {
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  toolUseId?: string | null;
  error?: string;
  isError?: boolean;
  isStreaming?: boolean;
  isFinal?: boolean;
  skillIds?: string[];
  [key: string]: unknown;
}

export interface CoworkConversationReplacementEntry {
  role: 'user' | 'assistant';
  text: string;
  metadata?: CoworkMessageMetadata;
  timestamp?: number;
}

export interface CoworkMessage {
  id: string;
  type: CoworkMessageType;
  content: string;
  timestamp: number;
  metadata?: CoworkMessageMetadata;
}

export interface CoworkSession {
  id: string;
  title: string;
  claudeSessionId: string | null;
  status: CoworkSessionStatus;
  pinned: boolean;
  parentSessionId?: string | null;
  forkedFromMessageId?: string | null;
  forkedAt?: number | null;
  cwd: string;
  systemPrompt: string;
  modelOverride: string;
  executionMode: CoworkExecutionMode;
  activeSkillIds: string[];
  agentId: string;
  messages: CoworkMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface CoworkSessionSummary {
  id: string;
  title: string;
  status: CoworkSessionStatus;
  pinned: boolean;
  agentId: string;
  source: 'chat' | 'im';
  platform?: Platform;
  conversationId?: string;
  createdAt: number;
  updatedAt: number;
}

export type CoworkUserMemoryStatus = 'created' | 'stale' | 'deleted';

export interface CoworkUserMemory {
  id: string;
  text: string;
  confidence: number;
  isExplicit: boolean;
  status: CoworkUserMemoryStatus;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
}

export interface CoworkUserMemorySource {
  id: string;
  memoryId: string;
  sessionId: string | null;
  messageId: string | null;
  role: 'user' | 'assistant' | 'tool' | 'system';
  isActive: boolean;
  createdAt: number;
}

export interface CoworkUserMemorySourceInput {
  sessionId?: string;
  messageId?: string;
  role?: 'user' | 'assistant' | 'tool' | 'system';
}

export interface CoworkUserMemoryStats {
  total: number;
  created: number;
  stale: number;
  deleted: number;
  explicit: number;
  implicit: number;
}

export interface CoworkConversationSearchRecord {
  sessionId: string;
  title: string;
  updatedAt: number;
  url: string;
  human: string;
  assistant: string;
}

export interface CoworkConfig {
  workingDirectory: string;
  systemPrompt: string;
  executionMode: CoworkExecutionMode;
  agentEngine: CoworkAgentEngine;
  memoryEnabled: boolean;
  memoryImplicitUpdateEnabled: boolean;
  memoryLlmJudgeEnabled: boolean;
  memoryGuardLevel: CoworkMemoryGuardLevel;
  memoryUserMemoriesMaxItems: number;
  skipMissedJobs: boolean;
  embeddingEnabled: boolean;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingLocalModelPath: string;
  embeddingVectorWeight: number;
  embeddingRemoteBaseUrl: string;
  embeddingRemoteApiKey: string;
  dreamingEnabled: boolean;
  dreamingFrequency: string;
  dreamingModel: string;
  dreamingTimezone: string;
  openClawSessionPolicy: OpenClawSessionPolicyConfig;
}

export type CoworkConfigUpdate = Partial<Pick<
  CoworkConfig,
  | 'workingDirectory'
  | 'executionMode'
  | 'agentEngine'
  | 'memoryEnabled'
  | 'memoryImplicitUpdateEnabled'
  | 'memoryLlmJudgeEnabled'
  | 'memoryGuardLevel'
  | 'memoryUserMemoriesMaxItems'
  | 'skipMissedJobs'
  | 'embeddingEnabled'
  | 'embeddingProvider'
  | 'embeddingModel'
  | 'embeddingLocalModelPath'
  | 'embeddingVectorWeight'
  | 'embeddingRemoteBaseUrl'
  | 'embeddingRemoteApiKey'
  | 'dreamingEnabled'
  | 'dreamingFrequency'
  | 'dreamingModel'
  | 'dreamingTimezone'
  | 'openClawSessionPolicy'
>>;

export interface ApplyTurnMemoryUpdatesOptions {
  sessionId: string;
  userText: string;
  assistantText: string;
  implicitEnabled: boolean;
  memoryLlmJudgeEnabled: boolean;
  guardLevel: CoworkMemoryGuardLevel;
  userMessageId?: string;
  assistantMessageId?: string;
}

export interface ApplyTurnMemoryUpdatesResult {
  totalChanges: number;
  created: number;
  updated: number;
  deleted: number;
  judgeRejected: number;
  llmReviewed: number;
  skipped: number;
}

let cachedDefaultSystemPrompt: string | null = null;

const getDefaultSystemPrompt = (): string => {
  if (cachedDefaultSystemPrompt !== null) {
    return cachedDefaultSystemPrompt;
  }
  try {
    const promptPath = path.join(app.getAppPath(), 'resources', 'SYSTEM_PROMPT.md');
    cachedDefaultSystemPrompt = fs.readFileSync(promptPath, 'utf-8');
  } catch {
    cachedDefaultSystemPrompt = '';
  }
  return cachedDefaultSystemPrompt;
};

interface CoworkMessageRow {
  id: string;
  type: string;
  content: string;
  metadata: string | null;
  created_at: number;
  sequence: number | null;
}

interface CoworkUserMemoryRow {
  id: string;
  text: string;
  fingerprint: string;
  confidence: number;
  is_explicit: number;
  status: string;
  created_at: number;
  updated_at: number;
  last_used_at: number | null;
}

const parseJsonStringArray = (value?: string | null): string[] => {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
};

export class CoworkStore {
  private db: Database.Database;
  private saveDb: () => void;
  private lastChanges = 0;

  constructor(db: Database.Database, saveDb: () => void) {
    this.db = db;
    this.saveDb = saveDb;
  }

  private getOne<T>(sql: string, params: (string | number | null)[] = []): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  private getAll<T>(sql: string, params: (string | number | null)[] = []): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  private run(sql: string, params: (string | number | null)[] = []): number {
    const result = this.db.prepare(sql).run(...params);
    this.lastChanges = result.changes;
    return result.changes;
  }

  createSession(
    title: string,
    cwd: string,
    systemPrompt: string = '',
    executionMode: CoworkExecutionMode = 'local',
    activeSkillIds: string[] = [],
    agentId: string = 'main',
    modelOverride: string = ''
  ): CoworkSession {
    const id = uuidv4();
    const now = Date.now();

    this.run(`
      INSERT INTO cowork_sessions (id, title, claude_session_id, status, cwd, system_prompt, model_override, execution_mode, active_skill_ids, agent_id, pinned, created_at, updated_at)
      VALUES (?, ?, NULL, 'idle', ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `, [id, title, cwd, systemPrompt, modelOverride, executionMode, JSON.stringify(activeSkillIds), agentId, now, now]);

    this.saveDb();

    return {
      id,
      title,
      claudeSessionId: null,
      status: 'idle',
      pinned: false,
      cwd,
      systemPrompt,
      modelOverride,
      executionMode,
      activeSkillIds,
      agentId,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  getSession(id: string): CoworkSession | null {
    interface SessionRow {
      id: string;
      title: string;
      claude_session_id: string | null;
      status: string;
      pinned?: number | null;
      parent_session_id?: string | null;
      forked_from_message_id?: string | null;
      forked_at?: number | null;
      cwd: string;
      system_prompt: string;
      model_override?: string | null;
      execution_mode?: string | null;
      active_skill_ids?: string | null;
      agent_id?: string | null;
      created_at: number;
      updated_at: number;
    }

    const parentSessionExpr = hasTableColumn(this.db, 'cowork_sessions', 'parent_session_id')
      ? 'parent_session_id'
      : 'NULL AS parent_session_id';
    const forkedFromMessageExpr = hasTableColumn(this.db, 'cowork_sessions', 'forked_from_message_id')
      ? 'forked_from_message_id'
      : 'NULL AS forked_from_message_id';
    const forkedAtExpr = hasTableColumn(this.db, 'cowork_sessions', 'forked_at')
      ? 'forked_at'
      : 'NULL AS forked_at';

    const row = this.getOne<SessionRow>(`
      SELECT id, title, claude_session_id, status, pinned, ${parentSessionExpr}, ${forkedFromMessageExpr}, ${forkedAtExpr}, cwd, system_prompt, model_override, execution_mode, active_skill_ids, agent_id, created_at, updated_at
      FROM cowork_sessions
      WHERE id = ?
    `, [id]);

    if (!row) return null;

    const messages = this.getSessionMessages(id);

    let activeSkillIds: string[] = [];
    if (row.active_skill_ids) {
      try {
        activeSkillIds = JSON.parse(row.active_skill_ids);
      } catch (error) {
        console.error(`[CoworkStore] Failed to parse active skill IDs for session ${id}:`, error);
        activeSkillIds = [];
      }
    }

    return {
      id: row.id,
      title: row.title,
      claudeSessionId: row.claude_session_id,
      status: row.status as CoworkSessionStatus,
      pinned: Boolean(row.pinned),
      parentSessionId: row.parent_session_id ?? null,
      forkedFromMessageId: row.forked_from_message_id ?? null,
      forkedAt: row.forked_at ?? null,
      cwd: row.cwd,
      systemPrompt: row.system_prompt,
      modelOverride: row.model_override || '',
      executionMode: (row.execution_mode as CoworkExecutionMode) || 'local',
      activeSkillIds,
      agentId: row.agent_id || 'main',
      messages,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  forkSession(sourceSessionId: string, fromMessageId: string): CoworkSession | null {
    interface SourceSessionRow {
      id: string;
      title: string;
      cwd: string;
      system_prompt: string;
      model_override?: string | null;
      execution_mode?: string | null;
      active_skill_ids?: string | null;
      agent_id?: string | null;
    }

    interface SourceMessageRow {
      id: string;
      type: string;
      content: string;
      metadata: string | null;
      created_at: number;
      sequence: number | null;
    }

    const fork = this.db.transaction(() => {
      const source = this.getOne<SourceSessionRow>(`
        SELECT id, title, cwd, system_prompt, model_override, execution_mode, active_skill_ids, agent_id
        FROM cowork_sessions
        WHERE id = ?
      `, [sourceSessionId]);
      if (!source) return null;

      const anchor = this.getOne<{ sequence: number | null }>(
        'SELECT COALESCE(sequence, created_at) as sequence FROM cowork_messages WHERE id = ? AND session_id = ?',
        [fromMessageId, sourceSessionId],
      );
      if (!anchor) return null;

      const activeSkillIds = parseJsonStringArray(source.active_skill_ids);
      const now = Date.now();
      const forkedSessionId = uuidv4();
      const title = `${source.title} (fork)`;

      this.run(`
        INSERT INTO cowork_sessions (
          id, title, claude_session_id, status, cwd, system_prompt, model_override,
          execution_mode, active_skill_ids, agent_id, pinned, parent_session_id,
          forked_from_message_id, forked_at, created_at, updated_at
        )
        VALUES (?, ?, NULL, 'idle', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
      `, [
        forkedSessionId,
        title,
        source.cwd,
        source.system_prompt,
        source.model_override || '',
        (source.execution_mode as CoworkExecutionMode) || 'local',
        JSON.stringify(activeSkillIds),
        source.agent_id || 'main',
        sourceSessionId,
        fromMessageId,
        now,
        now,
        now,
      ]);

      const sourceRows = this.getAll<SourceMessageRow>(`
        SELECT id, type, content, metadata, created_at, sequence
        FROM cowork_messages
        WHERE session_id = ?
          AND COALESCE(sequence, created_at) <= ?
        ORDER BY COALESCE(sequence, created_at) ASC, created_at ASC, ROWID ASC
      `, [sourceSessionId, anchor.sequence]);

      sourceRows.forEach((message, index) => {
        this.run(`
          INSERT INTO cowork_messages (id, session_id, type, content, metadata, created_at, sequence)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          uuidv4(),
          forkedSessionId,
          message.type,
          message.content,
          message.metadata,
          message.created_at,
          index + 1,
        ]);
      });

      return forkedSessionId;
    });

    const forkedSessionId = fork();
    if (!forkedSessionId) return null;
    this.saveDb();
    return this.getSession(forkedSessionId);
  }

  updateSession(
    id: string,
    updates: Partial<Pick<CoworkSession, 'title' | 'claudeSessionId' | 'status' | 'cwd' | 'systemPrompt' | 'modelOverride' | 'executionMode'>>,
    options: { touchUpdatedAt?: boolean } = {},
  ): void {
    const now = Date.now();
    const setClauses: string[] = [];
    const values: (string | number | null)[] = [];

    if (options.touchUpdatedAt !== false) {
      setClauses.push('updated_at = ?');
      values.push(now);
    }

    if (updates.title !== undefined) {
      setClauses.push('title = ?');
      values.push(updates.title);
    }
    if (updates.claudeSessionId !== undefined) {
      setClauses.push('claude_session_id = ?');
      values.push(updates.claudeSessionId);
    }
    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      values.push(updates.status);
    }
    if (updates.cwd !== undefined) {
      setClauses.push('cwd = ?');
      values.push(updates.cwd);
    }
    if (updates.systemPrompt !== undefined) {
      setClauses.push('system_prompt = ?');
      values.push(updates.systemPrompt);
    }
    if (updates.modelOverride !== undefined) {
      setClauses.push('model_override = ?');
      values.push(updates.modelOverride);
    }
    if (updates.executionMode !== undefined) {
      setClauses.push('execution_mode = ?');
      values.push(updates.executionMode);
    }

    if (setClauses.length === 0) {
      return;
    }

    values.push(id);
    this.run(`
      UPDATE cowork_sessions
      SET ${setClauses.join(', ')}
      WHERE id = ?
    `, values);

    this.saveDb();
  }

  deleteSession(id: string): void {
    const deleteSession = this.db.transaction((sessionId: string) => {
      this.markMemorySourcesInactiveBySession(sessionId);
      this.deleteSessionRows([sessionId]);
    });
    deleteSession(id);
    this.markOrphanImplicitMemoriesStale();
    this.saveDb();
  }

  deleteSessions(ids: string[]): void {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (uniqueIds.length === 0) return;

    const deleteSessions = this.db.transaction((sessionIds: string[]) => {
      for (const id of sessionIds) {
        this.markMemorySourcesInactiveBySession(id);
      }
      this.deleteSessionRows(sessionIds);
    });
    deleteSessions(uniqueIds);
    this.markOrphanImplicitMemoriesStale();
    this.saveDb();
  }

  listSessionIdsByAgent(agentId: string): string[] {
    const rows = this.getAll<{ id: string }>(
      'SELECT id FROM cowork_sessions WHERE agent_id = ?',
      [agentId],
    );
    return rows.map((row) => row.id);
  }

  private deleteSessionRows(ids: string[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.run(`DELETE FROM cowork_messages WHERE session_id IN (${placeholders})`, ids);
    this.run(`DELETE FROM cowork_sessions WHERE id IN (${placeholders})`, ids);
  }

  private deleteSessionsForAgent(agentId: string): string[] {
    const sessionIds = this.listSessionIdsByAgent(agentId);
    for (const sessionId of sessionIds) {
      this.markMemorySourcesInactiveBySession(sessionId);
    }
    this.deleteSessionRows(sessionIds);
    return sessionIds;
  }

  setSessionPinned(id: string, pinned: boolean): void {
    this.run('UPDATE cowork_sessions SET pinned = ? WHERE id = ?', [pinned ? 1 : 0, id]);
    this.saveDb();
  }

  listSessions(agentId?: string): CoworkSessionSummary[] {
    interface SessionSummaryRow {
      id: string;
      title: string;
      status: string;
      pinned: number | null;
      agent_id: string | null;
      created_at: number;
      updated_at: number;
    }

    let rows: SessionSummaryRow[];
    if (agentId) {
      if (agentId === 'main') {
        rows = this.getAll<SessionSummaryRow>(`
          SELECT id, title, status, pinned, agent_id, created_at, updated_at
          FROM cowork_sessions
          WHERE agent_id = ?
            OR agent_id IS NULL
            OR TRIM(agent_id) = ''
          ORDER BY pinned DESC, updated_at DESC
        `, [agentId]);
      } else {
        rows = this.getAll<SessionSummaryRow>(`
          SELECT id, title, status, pinned, agent_id, created_at, updated_at
          FROM cowork_sessions
          WHERE agent_id = ?
          ORDER BY pinned DESC, updated_at DESC
        `, [agentId]);
      }
    } else {
      rows = this.getAll<SessionSummaryRow>(`
        SELECT id, title, status, pinned, agent_id, created_at, updated_at
        FROM cowork_sessions
        ORDER BY pinned DESC, updated_at DESC
      `);
    }

    return rows.map(row => ({
      id: row.id,
      title: row.title,
      status: row.status as CoworkSessionStatus,
      pinned: Boolean(row.pinned),
      agentId: row.agent_id || 'main',
      source: 'chat' as const,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  resetRunningSessions(): number {
    const now = Date.now();
    this.run(`
      UPDATE cowork_sessions
      SET status = 'idle', updated_at = ?
      WHERE status = 'running'
    `, [now]);
    this.saveDb();

    return this.lastChanges;
  }

  listRecentCwds(limit: number = 8): string[] {
    interface CwdRow {
      cwd: string;
      updated_at: number;
    }

    const rows = this.getAll<CwdRow>(`
      SELECT cwd, updated_at
      FROM cowork_sessions
      WHERE cwd IS NOT NULL AND TRIM(cwd) != ''
      ORDER BY updated_at DESC
      LIMIT ?
    `, [Math.max(limit * 8, limit)]);

    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const normalized = normalizeRecentWorkspacePath(row.cwd);
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      deduped.push(normalized);
      if (deduped.length >= limit) {
        break;
      }
    }

    return deduped;
  }

  private getSessionMessages(sessionId: string): CoworkMessage[] {
    const rows = this.getAll<CoworkMessageRow>(`
      SELECT id, type, content, metadata, created_at, sequence
      FROM cowork_messages
      WHERE session_id = ?
      ORDER BY
        COALESCE(sequence, created_at) ASC,
        created_at ASC,
        ROWID ASC
    `, [sessionId]);

    return rows.map((row) => {
      let metadata: CoworkMessageMetadata | undefined;
      if (row.metadata) {
        try {
          metadata = JSON.parse(row.metadata) as CoworkMessageMetadata;
        } catch (error) {
          console.warn(`[CoworkStore] discarded corrupt metadata for message ${row.id} in session ${sessionId}:`, error);
        }
      }
      return {
        id: row.id,
        type: row.type as CoworkMessageType,
        content: row.content,
        timestamp: row.created_at,
        metadata,
      };
    });
  }

  addMessage(
    sessionId: string,
    message: Omit<CoworkMessage, 'id' | 'timestamp'> & { timestamp?: number },
  ): CoworkMessage {
    const id = uuidv4();
    const timestamp = normalizeMessageTimestamp(message.timestamp) ?? Date.now();

    const sequenceRow = this.getOne<{ next_seq: number }>(`
      SELECT COALESCE(MAX(sequence), 0) + 1 as next_seq
      FROM cowork_messages
      WHERE session_id = ?
    `, [sessionId]);
    const sequence = Number(sequenceRow?.next_seq) || 1;

    this.run(`
      INSERT INTO cowork_messages (id, session_id, type, content, metadata, created_at, sequence)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      sessionId,
      message.type,
      message.content,
      message.metadata ? JSON.stringify(message.metadata) : null,
      timestamp,
      sequence,
    ]);

    this.run('UPDATE cowork_sessions SET updated_at = ? WHERE id = ?', [timestamp, sessionId]);

    this.saveDb();

    return {
      id,
      type: message.type,
      content: message.content,
      timestamp,
      metadata: message.metadata,
    };
  }

  /**
   * Insert a message before an existing message (by shifting sequences).
   * Used for channel-originated sessions where user messages need to appear
   * before assistant messages that were created during streaming.
   */
  insertMessageBeforeId(
    sessionId: string,
    beforeMessageId: string,
    message: Omit<CoworkMessage, 'id' | 'timestamp'> & { timestamp?: number },
  ): CoworkMessage {
    const id = uuidv4();
    const timestamp = normalizeMessageTimestamp(message.timestamp) ?? Date.now();

    // Get the target message's sequence
    const targetRow = this.getOne<{ sequence: number | null }>(
      'SELECT sequence FROM cowork_messages WHERE id = ? AND session_id = ?',
      [beforeMessageId, sessionId],
    );
    const targetSequence = typeof targetRow?.sequence === 'number' ? targetRow.sequence : undefined;

    if (targetSequence === undefined) {
      // Fallback to normal append if the target message is not found
      return this.addMessage(sessionId, message);
    }

    // Shift all messages with sequence >= target up by 1
    this.run(
      'UPDATE cowork_messages SET sequence = sequence + 1 WHERE session_id = ? AND sequence >= ?',
      [sessionId, targetSequence],
    );

    // Insert at the target's original sequence
    this.run(`
      INSERT INTO cowork_messages (id, session_id, type, content, metadata, created_at, sequence)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      sessionId,
      message.type,
      message.content,
      message.metadata ? JSON.stringify(message.metadata) : null,
      timestamp,
      targetSequence,
    ]);

    this.run('UPDATE cowork_sessions SET updated_at = ? WHERE id = ?', [timestamp, sessionId]);
    this.saveDb();

    return {
      id,
      type: message.type,
      content: message.content,
      timestamp,
      metadata: message.metadata,
    };
  }

  /**
   * Delete a message from a session.
   * Used by reconciliation to remove duplicate or spurious messages.
   */
  deleteMessage(sessionId: string, messageId: string): boolean {
    this.run(
      'DELETE FROM cowork_messages WHERE id = ? AND session_id = ?',
      [messageId, sessionId],
    );
    const deleted = this.lastChanges > 0;
    if (deleted) {
      this.saveDb();
    }
    return deleted;
  }

  /**
   * Replace all user/assistant messages in a session with the given list.
   * Tool messages (tool_use, tool_result, system) are preserved in their existing positions.
   * Used by history reconciliation to align local state with the authoritative gateway history.
   */
  replaceConversationMessages(
    sessionId: string,
    authoritative: CoworkConversationReplacementEntry[],
  ): void {
    const now = Date.now();
    const existingRows = this.getAll<{
      type: string;
      content: string;
      created_at: number;
    }>(
      `
      SELECT type, content, created_at
      FROM cowork_messages
      WHERE session_id = ? AND type IN ('user', 'assistant')
      ORDER BY COALESCE(sequence, created_at) ASC, created_at ASC, ROWID ASC
    `,
      [sessionId],
    );
    const existingTimestamps = new Map<string, number[]>();
    for (const row of existingRows) {
      if ((row.type !== 'user' && row.type !== 'assistant') || typeof row.content !== 'string') continue;
      const timestamp = normalizeMessageTimestamp(Number(row.created_at));
      if (timestamp == null) continue;
      const key = `${row.type}\x1f${row.content}`;
      const timestamps = existingTimestamps.get(key) ?? [];
      timestamps.push(timestamp);
      existingTimestamps.set(key, timestamps);
    }

    // Delete all existing user/assistant messages for this session
    this.run(
      "DELETE FROM cowork_messages WHERE session_id = ? AND type IN ('user', 'assistant')",
      [sessionId],
    );

    // Re-insert authoritative messages with correct sequence numbers
    // First, get the current max sequence from remaining messages (tool_use, tool_result, system)
    const seqRow = this.getOne<{ max_seq: number }>(
      'SELECT COALESCE(MAX(sequence), 0) as max_seq FROM cowork_messages WHERE session_id = ?',
      [sessionId],
    );
    let nextSeq = (Number(seqRow?.max_seq) || 0) + 1;
    const insertedTimestamps: number[] = [];

    for (const entry of authoritative) {
      const id = uuidv4();
      const existingKey = `${entry.role}\x1f${entry.text}`;
      const matchingExistingTimestamps = existingTimestamps.get(existingKey);
      const existingTimestamp = matchingExistingTimestamps?.shift();
      const messageTimestamp = normalizeMessageTimestamp(entry.timestamp)
        ?? existingTimestamp
        ?? now;
      insertedTimestamps.push(messageTimestamp);
      this.run(`
        INSERT INTO cowork_messages (id, session_id, type, content, metadata, created_at, sequence)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        id,
        sessionId,
        entry.role,
        entry.text,
        JSON.stringify({ isStreaming: false, isFinal: true, ...(entry.metadata ?? {}) }),
        messageTimestamp,
        nextSeq++,
      ]);
    }

    const updatedAt = insertedTimestamps.length > 0
      ? insertedTimestamps[insertedTimestamps.length - 1]
      : now;
    this.run('UPDATE cowork_sessions SET updated_at = ? WHERE id = ?', [updatedAt, sessionId]);
    this.saveDb();
  }

  updateMessage(sessionId: string, messageId: string, updates: { content?: string; metadata?: CoworkMessageMetadata }): void {
    const setClauses: string[] = [];
    const values: (string | null)[] = [];

    if (updates.content !== undefined) {
      setClauses.push('content = ?');
      values.push(updates.content);
    }
    if (updates.metadata !== undefined) {
      setClauses.push('metadata = ?');
      values.push(updates.metadata ? JSON.stringify(updates.metadata) : null);
    }

    if (setClauses.length === 0) return;

    values.push(messageId);
    values.push(sessionId);
    this.run(`
      UPDATE cowork_messages
      SET ${setClauses.join(', ')}
      WHERE id = ? AND session_id = ?
    `, values);

    this.saveDb();
  }

  // Config operations
  getConfig(): CoworkConfig {
    interface ConfigRow {
      key: string;
      value: string;
    }

    const configKeys = [
      'workingDirectory',
      'executionMode',
      'agentEngine',
      'memoryEnabled',
      'memoryImplicitUpdateEnabled',
      'memoryLlmJudgeEnabled',
      'memoryGuardLevel',
      'memoryUserMemoriesMaxItems',
      'skipMissedJobs',
      'embeddingEnabled',
      'embeddingProvider',
      'embeddingModel',
      'embeddingLocalModelPath',
      'embeddingVectorWeight',
      'embeddingRemoteBaseUrl',
      'embeddingRemoteApiKey',
      'dreamingEnabled',
      'dreamingFrequency',
      'dreamingModel',
      'dreamingTimezone',
      'openClawSessionPolicy',
    ] as const;
    const configRows = this.getAll<ConfigRow>(
      `SELECT key, value FROM cowork_config WHERE key IN (${configKeys.map(() => '?').join(', ')})`,
      [...configKeys],
    );
    const configByKey = new Map(configRows.map((row) => [row.key, row.value]));

    const normalizedAgentEngine = normalizeCoworkAgentEngineValue(configByKey.get('agentEngine'));
    let openClawSessionPolicy = DEFAULT_OPENCLAW_SESSION_POLICY_CONFIG;
    const openClawSessionPolicyValue = configByKey.get('openClawSessionPolicy');
    if (openClawSessionPolicyValue) {
      try {
        openClawSessionPolicy = normalizeOpenClawSessionPolicyConfig(JSON.parse(openClawSessionPolicyValue));
      } catch {
        openClawSessionPolicy = DEFAULT_OPENCLAW_SESSION_POLICY_CONFIG;
      }
    }

    return {
      workingDirectory: configByKey.get('workingDirectory') || getDefaultWorkingDirectory(),
      systemPrompt: getDefaultSystemPrompt(),
      executionMode: (configByKey.get('executionMode') as CoworkExecutionMode) || 'local',
      agentEngine: normalizedAgentEngine,
      memoryEnabled: parseBooleanConfig(configByKey.get('memoryEnabled'), DEFAULT_MEMORY_ENABLED),
      memoryImplicitUpdateEnabled: parseBooleanConfig(
        configByKey.get('memoryImplicitUpdateEnabled'),
        DEFAULT_MEMORY_IMPLICIT_UPDATE_ENABLED
      ),
      memoryLlmJudgeEnabled: parseBooleanConfig(
        configByKey.get('memoryLlmJudgeEnabled'),
        DEFAULT_MEMORY_LLM_JUDGE_ENABLED
      ),
      memoryGuardLevel: normalizeMemoryGuardLevel(configByKey.get('memoryGuardLevel')),
      memoryUserMemoriesMaxItems: clampMemoryUserMemoriesMaxItems(Number(configByKey.get('memoryUserMemoriesMaxItems'))),
      skipMissedJobs: parseBooleanConfig(configByKey.get('skipMissedJobs'), DEFAULT_SKIP_MISSED_JOBS),
      embeddingEnabled: parseBooleanConfig(configByKey.get('embeddingEnabled'), DEFAULT_EMBEDDING_ENABLED),
      embeddingProvider: configByKey.get('embeddingProvider') || DEFAULT_EMBEDDING_PROVIDER,
      embeddingModel: configByKey.get('embeddingModel') || DEFAULT_EMBEDDING_MODEL,
      embeddingLocalModelPath: configByKey.get('embeddingLocalModelPath') || DEFAULT_EMBEDDING_LOCAL_MODEL_PATH,
      embeddingVectorWeight: parseEmbeddingVectorWeight(configByKey.get('embeddingVectorWeight')),
      embeddingRemoteBaseUrl: configByKey.get('embeddingRemoteBaseUrl') || DEFAULT_EMBEDDING_REMOTE_BASE_URL,
      embeddingRemoteApiKey: configByKey.get('embeddingRemoteApiKey') || DEFAULT_EMBEDDING_REMOTE_API_KEY,
      dreamingEnabled: parseBooleanConfig(configByKey.get('dreamingEnabled'), DEFAULT_DREAMING_ENABLED),
      dreamingFrequency: configByKey.get('dreamingFrequency') || DEFAULT_DREAMING_FREQUENCY,
      dreamingModel: configByKey.get('dreamingModel') || DEFAULT_DREAMING_MODEL,
      dreamingTimezone: configByKey.get('dreamingTimezone') || DEFAULT_DREAMING_TIMEZONE,
      openClawSessionPolicy,
    };
  }

  setConfig(config: CoworkConfigUpdate): void {
    const now = Date.now();

    if (config.workingDirectory !== undefined) {
      this.run(`
        INSERT INTO cowork_config (key, value, updated_at)
        VALUES ('workingDirectory', ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `, [config.workingDirectory, now]);
    }

    if (config.executionMode !== undefined) {
      this.run(`
        INSERT INTO cowork_config (key, value, updated_at)
        VALUES ('executionMode', ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `, [config.executionMode, now]);
    }

    if (config.agentEngine !== undefined) {
      const normalizedAgentEngine = normalizeCoworkAgentEngineValue(config.agentEngine);
      this.run(`
        INSERT INTO cowork_config (key, value, updated_at)
        VALUES ('agentEngine', ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `, [normalizedAgentEngine, now]);
    }

    if (config.memoryEnabled !== undefined) {
      this.run(`
        INSERT INTO cowork_config (key, value, updated_at)
        VALUES ('memoryEnabled', ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `, [config.memoryEnabled ? '1' : '0', now]);
    }

    if (config.memoryImplicitUpdateEnabled !== undefined) {
      this.run(`
        INSERT INTO cowork_config (key, value, updated_at)
        VALUES ('memoryImplicitUpdateEnabled', ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `, [config.memoryImplicitUpdateEnabled ? '1' : '0', now]);
    }

    if (config.memoryLlmJudgeEnabled !== undefined) {
      this.run(`
        INSERT INTO cowork_config (key, value, updated_at)
        VALUES ('memoryLlmJudgeEnabled', ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `, [config.memoryLlmJudgeEnabled ? '1' : '0', now]);
    }

    if (config.memoryGuardLevel !== undefined) {
      this.run(`
        INSERT INTO cowork_config (key, value, updated_at)
        VALUES ('memoryGuardLevel', ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `, [normalizeMemoryGuardLevel(config.memoryGuardLevel), now]);
    }

    if (config.memoryUserMemoriesMaxItems !== undefined) {
      this.run(`
        INSERT INTO cowork_config (key, value, updated_at)
        VALUES ('memoryUserMemoriesMaxItems', ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `, [String(clampMemoryUserMemoriesMaxItems(config.memoryUserMemoriesMaxItems)), now]);
    }

    if (config.skipMissedJobs !== undefined) {
      this.run(`
        INSERT INTO cowork_config (key, value, updated_at)
        VALUES ('skipMissedJobs', ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `, [config.skipMissedJobs ? '1' : '0', now]);
    }

    if (config.embeddingEnabled !== undefined) {
      this.run(`
        INSERT INTO cowork_config (key, value, updated_at)
        VALUES ('embeddingEnabled', ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `, [config.embeddingEnabled ? '1' : '0', now]);
    }

    if (config.embeddingProvider !== undefined) {
      this.run(`
        INSERT INTO cowork_config (key, value, updated_at)
        VALUES ('embeddingProvider', ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `, [String(config.embeddingProvider), now]);
    }

    if (config.embeddingModel !== undefined) {
      this.run(`
        INSERT INTO cowork_config (key, value, updated_at)
        VALUES ('embeddingModel', ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `, [String(config.embeddingModel), now]);
    }

    if (config.embeddingLocalModelPath !== undefined) {
      this.run(`
        INSERT INTO cowork_config (key, value, updated_at)
        VALUES ('embeddingLocalModelPath', ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `, [String(config.embeddingLocalModelPath), now]);
    }

    if (config.embeddingVectorWeight !== undefined) {
      const embeddingVectorWeight = Number.isFinite(config.embeddingVectorWeight)
        ? Math.max(0, Math.min(1, config.embeddingVectorWeight))
        : DEFAULT_EMBEDDING_VECTOR_WEIGHT;
      this.run(`
        INSERT INTO cowork_config (key, value, updated_at)
        VALUES ('embeddingVectorWeight', ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `, [String(embeddingVectorWeight), now]);
    }

    if (config.embeddingRemoteBaseUrl !== undefined) {
      this.run(`
        INSERT INTO cowork_config (key, value, updated_at)
        VALUES ('embeddingRemoteBaseUrl', ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `, [String(config.embeddingRemoteBaseUrl), now]);
    }

    if (config.embeddingRemoteApiKey !== undefined) {
      this.run(`
        INSERT INTO cowork_config (key, value, updated_at)
        VALUES ('embeddingRemoteApiKey', ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `, [String(config.embeddingRemoteApiKey), now]);
    }

    if (config.dreamingEnabled !== undefined) {
      this.run(`
        INSERT INTO cowork_config (key, value, updated_at)
        VALUES ('dreamingEnabled', ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `, [config.dreamingEnabled ? '1' : '0', now]);
    }

    if (config.dreamingFrequency !== undefined) {
      this.run(`
        INSERT INTO cowork_config (key, value, updated_at)
        VALUES ('dreamingFrequency', ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `, [String(config.dreamingFrequency), now]);
    }

    if (config.dreamingModel !== undefined) {
      this.run(`
        INSERT INTO cowork_config (key, value, updated_at)
        VALUES ('dreamingModel', ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `, [String(config.dreamingModel), now]);
    }

    if (config.dreamingTimezone !== undefined) {
      this.run(`
        INSERT INTO cowork_config (key, value, updated_at)
        VALUES ('dreamingTimezone', ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `, [String(config.dreamingTimezone), now]);
    }

    if (config.openClawSessionPolicy !== undefined) {
      this.run(`
        INSERT INTO cowork_config (key, value, updated_at)
        VALUES ('openClawSessionPolicy', ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `, [JSON.stringify(normalizeOpenClawSessionPolicyConfig(config.openClawSessionPolicy)), now]);
    }

    this.saveDb();
  }

  getAppLanguage(): 'zh' | 'en' {
    interface KvRow {
      value: string;
    }

    const row = this.getOne<KvRow>('SELECT value FROM kv WHERE key = ?', ['app_config']);
    if (!row?.value) {
      return 'zh';
    }

    try {
      const config = JSON.parse(row.value) as { language?: string };
      return config.language === 'en' ? 'en' : 'zh';
    } catch {
      return 'zh';
    }
  }

  private mapMemoryRow(row: CoworkUserMemoryRow): CoworkUserMemory {
    return {
      id: row.id,
      text: row.text,
      confidence: Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : 0.7,
      isExplicit: Boolean(row.is_explicit),
      status: (row.status === 'stale' || row.status === 'deleted' ? row.status : 'created') as CoworkUserMemoryStatus,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      lastUsedAt: row.last_used_at === null ? null : Number(row.last_used_at),
    };
  }

  private addMemorySource(memoryId: string, source?: CoworkUserMemorySourceInput): void {
    const now = Date.now();
    this.run(`
      INSERT INTO user_memory_sources (id, memory_id, session_id, message_id, role, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `, [
      uuidv4(),
      memoryId,
      source?.sessionId || null,
      source?.messageId || null,
      source?.role || 'system',
      now,
    ]);
  }

  private createOrReviveUserMemory(input: {
    text: string;
    confidence?: number;
    isExplicit?: boolean;
    source?: CoworkUserMemorySourceInput;
  }): { memory: CoworkUserMemory; created: boolean; updated: boolean } {
    const normalizedText = truncate(normalizeMemoryText(input.text), 360);
    if (!normalizedText) {
      throw new Error('Memory text is required');
    }

    const now = Date.now();
    const fingerprint = buildMemoryFingerprint(normalizedText);
    const confidence = Math.max(0, Math.min(1, Number.isFinite(input.confidence) ? Number(input.confidence) : 0.75));
    const explicitFlag = input.isExplicit ? 1 : 0;

    let existing = this.getOne<CoworkUserMemoryRow>(`
      SELECT id, text, fingerprint, confidence, is_explicit, status, created_at, updated_at, last_used_at
      FROM user_memories
      WHERE fingerprint = ? AND status != 'deleted'
      ORDER BY updated_at DESC
      LIMIT 1
    `, [fingerprint]);

    if (!existing) {
      const incomingSemanticKey = normalizeMemorySemanticKey(normalizedText);
      if (incomingSemanticKey) {
        const candidates = this.getAll<CoworkUserMemoryRow>(`
          SELECT id, text, fingerprint, confidence, is_explicit, status, created_at, updated_at, last_used_at
          FROM user_memories
          WHERE status != 'deleted'
          ORDER BY updated_at DESC
          LIMIT 200
        `);
        let bestCandidate: CoworkUserMemoryRow | null = null;
        let bestScore = 0;
        for (const candidate of candidates) {
          const candidateSemanticKey = normalizeMemorySemanticKey(candidate.text);
          if (!candidateSemanticKey) continue;
          const score = scoreMemorySimilarity(candidateSemanticKey, incomingSemanticKey);
          if (score <= bestScore) continue;
          bestScore = score;
          bestCandidate = candidate;
        }
        if (bestCandidate && bestScore >= MEMORY_NEAR_DUPLICATE_MIN_SCORE) {
          existing = bestCandidate;
        }
      }
    }

    if (existing) {
      const mergedText = choosePreferredMemoryText(existing.text, normalizedText);
      const mergedExplicit = existing.is_explicit ? 1 : explicitFlag;
      const mergedConfidence = Math.max(Number(existing.confidence) || 0, confidence);
      this.run(`
        UPDATE user_memories
        SET text = ?, fingerprint = ?, confidence = ?, is_explicit = ?, status = 'created', updated_at = ?
        WHERE id = ?
      `, [mergedText, buildMemoryFingerprint(mergedText), mergedConfidence, mergedExplicit, now, existing.id]);
      this.addMemorySource(existing.id, input.source);
      const memory = this.getOne<CoworkUserMemoryRow>(`
        SELECT id, text, fingerprint, confidence, is_explicit, status, created_at, updated_at, last_used_at
        FROM user_memories
        WHERE id = ?
      `, [existing.id]);
      if (!memory) {
        throw new Error('Failed to reload updated memory');
      }
      return { memory: this.mapMemoryRow(memory), created: false, updated: true };
    }

    const id = uuidv4();
    this.run(`
      INSERT INTO user_memories (
        id, text, fingerprint, confidence, is_explicit, status, created_at, updated_at, last_used_at
      ) VALUES (?, ?, ?, ?, ?, 'created', ?, ?, NULL)
    `, [id, normalizedText, fingerprint, confidence, explicitFlag, now, now]);
    this.addMemorySource(id, input.source);

    const memory = this.getOne<CoworkUserMemoryRow>(`
      SELECT id, text, fingerprint, confidence, is_explicit, status, created_at, updated_at, last_used_at
      FROM user_memories
      WHERE id = ?
    `, [id]);
    if (!memory) {
      throw new Error('Failed to load created memory');
    }

    return { memory: this.mapMemoryRow(memory), created: true, updated: false };
  }

  listUserMemories(options: {
    query?: string;
    status?: CoworkUserMemoryStatus | 'all';
    limit?: number;
    offset?: number;
    includeDeleted?: boolean;
  } = {}): CoworkUserMemory[] {
    const query = normalizeMemoryText(options.query || '');
    const includeDeleted = Boolean(options.includeDeleted);
    const status = options.status || 'all';
    const limit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 200)));
    const offset = Math.max(0, Math.floor(options.offset ?? 0));

    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (!includeDeleted && status === 'all') {
      clauses.push(`status != 'deleted'`);
    }
    if (status !== 'all') {
      clauses.push('status = ?');
      params.push(status);
    }
    if (query) {
      clauses.push('LOWER(text) LIKE ?');
      params.push(`%${query.toLowerCase()}%`);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    const rows = this.getAll<CoworkUserMemoryRow>(`
      SELECT id, text, fingerprint, confidence, is_explicit, status, created_at, updated_at, last_used_at
      FROM user_memories
      ${whereClause}
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    return rows.map((row) => this.mapMemoryRow(row));
  }

  createUserMemory(input: {
    text: string;
    confidence?: number;
    isExplicit?: boolean;
    source?: CoworkUserMemorySourceInput;
  }): CoworkUserMemory {
    const result = this.createOrReviveUserMemory(input);
    this.saveDb();
    return result.memory;
  }

  updateUserMemory(input: {
    id: string;
    text?: string;
    confidence?: number;
    status?: CoworkUserMemoryStatus;
    isExplicit?: boolean;
  }): CoworkUserMemory | null {
    const current = this.getOne<CoworkUserMemoryRow>(`
      SELECT id, text, fingerprint, confidence, is_explicit, status, created_at, updated_at, last_used_at
      FROM user_memories
      WHERE id = ?
    `, [input.id]);
    if (!current) return null;

    const now = Date.now();
    const nextText = input.text !== undefined ? truncate(normalizeMemoryText(input.text), 360) : current.text;
    if (!nextText) {
      throw new Error('Memory text is required');
    }
    const nextConfidence = input.confidence !== undefined
      ? Math.max(0, Math.min(1, Number(input.confidence)))
      : Number(current.confidence);
    const nextStatus = input.status && (input.status === 'created' || input.status === 'stale' || input.status === 'deleted')
      ? input.status
      : current.status;
    const nextExplicit = input.isExplicit !== undefined ? (input.isExplicit ? 1 : 0) : current.is_explicit;

    this.run(`
      UPDATE user_memories
      SET text = ?, fingerprint = ?, confidence = ?, is_explicit = ?, status = ?, updated_at = ?
      WHERE id = ?
    `, [nextText, buildMemoryFingerprint(nextText), nextConfidence, nextExplicit, nextStatus, now, input.id]);

    const updated = this.getOne<CoworkUserMemoryRow>(`
      SELECT id, text, fingerprint, confidence, is_explicit, status, created_at, updated_at, last_used_at
      FROM user_memories
      WHERE id = ?
    `, [input.id]);

    this.saveDb();
    return updated ? this.mapMemoryRow(updated) : null;
  }

  deleteUserMemory(id: string): boolean {
    const now = Date.now();
    this.run(`
      UPDATE user_memories
      SET status = 'deleted', updated_at = ?
      WHERE id = ?
    `, [now, id]);
    // 先记录主表删除结果，避免后续 sources 表无记录时误判删除失败。
    const memoryUpdated = this.lastChanges > 0;
    this.run(`
      UPDATE user_memory_sources
      SET is_active = 0
      WHERE memory_id = ?
    `, [id]);
    this.saveDb();
    return memoryUpdated;
  }

  getUserMemoryStats(): CoworkUserMemoryStats {
    const rows = this.getAll<{
      status: string;
      is_explicit: number;
      count: number;
    }>(`
      SELECT status, is_explicit, COUNT(*) AS count
      FROM user_memories
      GROUP BY status, is_explicit
    `);

    const stats: CoworkUserMemoryStats = {
      total: 0,
      created: 0,
      stale: 0,
      deleted: 0,
      explicit: 0,
      implicit: 0,
    };

    for (const row of rows) {
      const count = Number(row.count) || 0;
      stats.total += count;
      if (row.status === 'created') stats.created += count;
      if (row.status === 'stale') stats.stale += count;
      if (row.status === 'deleted') stats.deleted += count;
      if (row.is_explicit) stats.explicit += count;
      else stats.implicit += count;
    }

    return stats;
  }

  autoDeleteNonPersonalMemories(): number {
    const rows = this.getAll<Pick<CoworkUserMemoryRow, 'id' | 'text'>>(
      `SELECT id, text FROM user_memories WHERE status = 'created'`
    );
    if (rows.length === 0) return 0;

    const now = Date.now();
    let deleted = 0;
    for (const row of rows) {
      if (!shouldAutoDeleteMemoryText(row.text)) {
        continue;
      }
      this.run(`
        UPDATE user_memories
        SET status = 'deleted', updated_at = ?
        WHERE id = ?
      `, [now, row.id]);
      this.run(`
        UPDATE user_memory_sources
        SET is_active = 0
        WHERE memory_id = ?
      `, [row.id]);
      deleted += 1;
    }

    if (deleted > 0) {
      this.saveDb();
    }
    return deleted;
  }

  markMemorySourcesInactiveBySession(sessionId: string): void {
    this.run(`
      UPDATE user_memory_sources
      SET is_active = 0
      WHERE session_id = ? AND is_active = 1
    `, [sessionId]);
  }

  markOrphanImplicitMemoriesStale(): void {
    const now = Date.now();
    this.run(`
      UPDATE user_memories
      SET status = 'stale', updated_at = ?
      WHERE is_explicit = 0
        AND status = 'created'
        AND NOT EXISTS (
          SELECT 1
          FROM user_memory_sources s
          WHERE s.memory_id = user_memories.id AND s.is_active = 1
        )
    `, [now]);
  }

  async applyTurnMemoryUpdates(options: ApplyTurnMemoryUpdatesOptions): Promise<ApplyTurnMemoryUpdatesResult> {
    const result: ApplyTurnMemoryUpdatesResult = {
      totalChanges: 0,
      created: 0,
      updated: 0,
      deleted: 0,
      judgeRejected: 0,
      llmReviewed: 0,
      skipped: 0,
    };

    const extracted = extractTurnMemoryChanges({
      userText: options.userText,
      assistantText: options.assistantText,
      guardLevel: options.guardLevel,
      maxImplicitAdds: options.implicitEnabled ? 2 : 0,
    });
    result.totalChanges = extracted.length;

    let deleteCandidates: CoworkUserMemory[] | null = null;

    for (const change of extracted) {
      if (change.action === 'add') {
        if (!options.implicitEnabled && !change.isExplicit) {
          result.skipped += 1;
          continue;
        }
        const judge = await judgeMemoryCandidate({
          text: change.text,
          isExplicit: change.isExplicit,
          guardLevel: options.guardLevel,
          llmEnabled: options.memoryLlmJudgeEnabled,
        });
        if (judge.source === 'llm') {
          result.llmReviewed += 1;
        }
        if (!judge.accepted) {
          result.judgeRejected += 1;
          result.skipped += 1;
          continue;
        }

        const write = this.createOrReviveUserMemory({
          text: change.text,
          confidence: change.confidence,
          isExplicit: change.isExplicit,
          source: {
            role: 'user',
            sessionId: options.sessionId,
            messageId: options.userMessageId,
          },
        });

        if (!change.isExplicit && options.assistantMessageId) {
          this.addMemorySource(write.memory.id, {
            role: 'assistant',
            sessionId: options.sessionId,
            messageId: options.assistantMessageId,
          });
        }

        if (write.created) result.created += 1;
        else if (write.updated) result.updated += 1;
        else result.skipped += 1;
        continue;
      }

      const key = normalizeMemoryMatchKey(change.text);
      if (!key) {
        result.skipped += 1;
        continue;
      }

      if (!deleteCandidates) {
        deleteCandidates = this.listUserMemories({ status: 'all', includeDeleted: false, limit: 100 });
      }
      const candidates = deleteCandidates;
      let target: CoworkUserMemory | null = null;
      let bestScore = 0;
      for (const entry of candidates) {
        const currentKey = normalizeMemoryMatchKey(entry.text);
        if (!currentKey) continue;
        const score = scoreDeleteMatch(currentKey, key);
        if (score <= bestScore) continue;
        bestScore = score;
        target = entry;
      }

      if (!target) {
        result.skipped += 1;
        continue;
      }

      const deleted = this.deleteUserMemory(target.id);
      if (deleted) result.deleted += 1;
      else result.skipped += 1;
    }

    this.markOrphanImplicitMemoriesStale();
    this.saveDb();
    return result;
  }

  private getLatestMessageByType(sessionId: string, type: 'user' | 'assistant'): string {
    const row = this.getOne<{ content: string }>(`
      SELECT content
      FROM cowork_messages
      WHERE session_id = ? AND type = ?
      ORDER BY created_at DESC, ROWID DESC
      LIMIT 1
    `, [sessionId, type]);
    return truncate((row?.content || '').replace(/\s+/g, ' ').trim(), 280);
  }

  conversationSearch(options: {
    query: string;
    maxResults?: number;
    before?: string;
    after?: string;
  }): CoworkConversationSearchRecord[] {
    const terms = extractConversationSearchTerms(options.query);
    if (terms.length === 0) return [];

    const maxResults = Math.max(1, Math.min(10, Math.floor(options.maxResults ?? 5)));
    const beforeMs = parseTimeToMs(options.before);
    const afterMs = parseTimeToMs(options.after);

    const likeClauses = terms.map(() => 'LOWER(m.content) LIKE ?');
    const clauses: string[] = [
      "m.type IN ('user', 'assistant')",
      `(${likeClauses.join(' OR ')})`,
    ];
    const params: Array<string | number> = terms.map((term) => `%${term}%`);

    if (beforeMs !== null) {
      clauses.push('m.created_at < ?');
      params.push(beforeMs);
    }
    if (afterMs !== null) {
      clauses.push('m.created_at > ?');
      params.push(afterMs);
    }

    const rows = this.getAll<{
      session_id: string;
      title: string;
      updated_at: number;
      type: string;
      content: string;
      created_at: number;
    }>(`
      SELECT m.session_id, s.title, s.updated_at, m.type, m.content, m.created_at
      FROM cowork_messages m
      INNER JOIN cowork_sessions s ON s.id = m.session_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY m.created_at DESC
      LIMIT ?
    `, [...params, maxResults * 40]);

    const bySession = new Map<string, CoworkConversationSearchRecord>();
    for (const row of rows) {
      if (!row.session_id) continue;
      let current = bySession.get(row.session_id);
      if (!current) {
        current = {
          sessionId: row.session_id,
          title: row.title || 'Untitled',
          updatedAt: Number(row.updated_at) || 0,
          url: `https://claude.ai/chat/${row.session_id}`,
          human: '',
          assistant: '',
        };
        bySession.set(row.session_id, current);
      }

      const snippet = truncate((row.content || '').replace(/\s+/g, ' ').trim(), 280);
      if (row.type === 'user' && !current.human) {
        current.human = snippet;
      }
      if (row.type === 'assistant' && !current.assistant) {
        current.assistant = snippet;
      }

      if (bySession.size >= maxResults) {
        const complete = Array.from(bySession.values()).every((entry) => entry.human && entry.assistant);
        if (complete) break;
      }
    }

    const records = Array.from(bySession.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, maxResults)
      .map((entry) => ({
        ...entry,
        human: entry.human || this.getLatestMessageByType(entry.sessionId, 'user'),
        assistant: entry.assistant || this.getLatestMessageByType(entry.sessionId, 'assistant'),
      }));

    return records;
  }

  recentChats(options: {
    n?: number;
    sortOrder?: 'asc' | 'desc';
    before?: string;
    after?: string;
  }): CoworkConversationSearchRecord[] {
    const n = Math.max(1, Math.min(20, Math.floor(options.n ?? 3)));
    const sortOrder = options.sortOrder === 'asc' ? 'asc' : 'desc';
    const beforeMs = parseTimeToMs(options.before);
    const afterMs = parseTimeToMs(options.after);

    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (beforeMs !== null) {
      clauses.push('updated_at < ?');
      params.push(beforeMs);
    }
    if (afterMs !== null) {
      clauses.push('updated_at > ?');
      params.push(afterMs);
    }

    const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const rows = this.getAll<{
      id: string;
      title: string;
      updated_at: number;
    }>(`
      SELECT id, title, updated_at
      FROM cowork_sessions
      ${whereClause}
      ORDER BY updated_at ${sortOrder.toUpperCase()}
      LIMIT ?
    `, [...params, n]);

    return rows.map((row) => ({
      sessionId: row.id,
      title: row.title || 'Untitled',
      updatedAt: Number(row.updated_at) || 0,
      url: `https://claude.ai/chat/${row.id}`,
      human: this.getLatestMessageByType(row.id, 'user'),
      assistant: this.getLatestMessageByType(row.id, 'assistant'),
    }));
  }

  // ========== Agent CRUD ==========

  listAgents(): Agent[] {
    interface AgentRow {
      id: string;
      name: string;
      description: string;
      system_prompt: string;
      identity: string;
      model: string;
      working_directory?: string | null;
      icon: string;
      skill_ids: string;
      tool_bundle_ids: string | null;
      enabled: number;
      is_default: number;
      source: string;
      preset_id: string;
      created_at: number;
      updated_at: number;
    }

    const rows = this.getAll<AgentRow>(`
      SELECT * FROM agents ORDER BY is_default DESC, created_at ASC
    `);

    return rows.map(row => this.mapAgentRow(row));
  }

  getAgent(id: string): Agent | null {
    interface AgentRow {
      id: string;
      name: string;
      description: string;
      system_prompt: string;
      identity: string;
      model: string;
      working_directory?: string | null;
      icon: string;
      skill_ids: string;
      tool_bundle_ids: string | null;
      enabled: number;
      is_default: number;
      source: string;
      preset_id: string;
      created_at: number;
      updated_at: number;
    }

    const row = this.getOne<AgentRow>(`SELECT * FROM agents WHERE id = ?`, [id]);
    if (!row) return null;
    return this.mapAgentRow(row);
  }

  createAgent(request: CreateAgentRequest): Agent {
    const id = request.id || request.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || uuidv4();
    const now = Date.now();

    // Ensure no duplicate ID
    const existing = this.getAgent(id);
    if (existing) {
      // Append timestamp to make unique
      return this.createAgent({ ...request, id: `${id}-${Date.now()}` });
    }

    let removedOrphanSessionCount = 0;
    const createAgent = this.db.transaction(() => {
      removedOrphanSessionCount = this.deleteSessionsForAgent(id).length;

      this.run(`
        INSERT INTO agents (id, name, description, system_prompt, identity, model, working_directory, icon, skill_ids, tool_bundle_ids, enabled, is_default, source, preset_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?)
      `, [
        id,
        request.name,
        request.description || '',
        request.systemPrompt || '',
        request.identity || '',
        request.model || '',
        request.workingDirectory || '',
        request.icon || '',
        JSON.stringify(request.skillIds || []),
        JSON.stringify(request.toolBundleIds || []),
        request.source || 'custom',
        request.presetId || '',
        now,
        now,
      ]);
    });
    createAgent();

    if (removedOrphanSessionCount > 0) {
      this.markOrphanImplicitMemoriesStale();
    }
    this.saveDb();
    return this.getAgent(id)!;
  }

  updateAgent(id: string, updates: UpdateAgentRequest): Agent | null {
    const existing = this.getAgent(id);
    if (!existing) return null;

    const now = Date.now();
    const setClauses: string[] = ['updated_at = ?'];
    const values: (string | number | null)[] = [now];

    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      setClauses.push('description = ?');
      values.push(updates.description);
    }
    if (updates.systemPrompt !== undefined) {
      setClauses.push('system_prompt = ?');
      values.push(updates.systemPrompt);
    }
    if (updates.identity !== undefined) {
      setClauses.push('identity = ?');
      values.push(updates.identity);
    }
    if (updates.model !== undefined) {
      setClauses.push('model = ?');
      values.push(updates.model);
    }
    if (updates.workingDirectory !== undefined) {
      setClauses.push('working_directory = ?');
      values.push(updates.workingDirectory);
    }
    if (updates.icon !== undefined) {
      setClauses.push('icon = ?');
      values.push(updates.icon);
    }
    if (updates.skillIds !== undefined) {
      setClauses.push('skill_ids = ?');
      values.push(JSON.stringify(updates.skillIds));
    }
    if (updates.toolBundleIds !== undefined) {
      setClauses.push('tool_bundle_ids = ?');
      values.push(JSON.stringify(updates.toolBundleIds));
    }
    if (updates.enabled !== undefined) {
      setClauses.push('enabled = ?');
      values.push(updates.enabled ? 1 : 0);
    }

    values.push(id);
    this.run(`UPDATE agents SET ${setClauses.join(', ')} WHERE id = ?`, values);
    this.saveDb();

    return this.getAgent(id);
  }

  deleteAgent(id: string): boolean {
    if (id === 'main') return false; // Cannot delete default agent
    const deleteAgent = this.db.transaction((agentId: string): boolean => {
      const changes = this.run('DELETE FROM agents WHERE id = ? AND is_default = 0', [agentId]);
      if (changes === 0) {
        return false;
      }

      this.deleteSessionsForAgent(agentId);
      return true;
    });

    const deleted = deleteAgent(id);
    if (deleted) {
      this.markOrphanImplicitMemoriesStale();
    }
    this.saveDb();
    return deleted;
  }

  listUserPlugins(): UserInstalledPlugin[] {
    const rows = this.getAll<{
      plugin_id: string;
      source: string;
      spec: string;
      registry: string | null;
      version: string | null;
      enabled: number;
      installed_at: number;
      config: string | null;
    }>('SELECT * FROM user_plugins ORDER BY installed_at ASC');

    return rows.map(row => ({
      pluginId: row.plugin_id,
      source: row.source as PluginSource,
      spec: row.spec,
      registry: row.registry || undefined,
      version: row.version || undefined,
      enabled: Boolean(row.enabled),
      installedAt: row.installed_at,
      config: row.config ? JSON.parse(row.config) as Record<string, unknown> : undefined,
    }));
  }

  addUserPlugin(plugin: UserInstalledPlugin): void {
    this.db.prepare(
      `INSERT INTO user_plugins (plugin_id, source, spec, registry, version, enabled, installed_at, config)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(plugin_id) DO UPDATE SET
         source = excluded.source,
         spec = excluded.spec,
         registry = excluded.registry,
         version = excluded.version,
         enabled = excluded.enabled,
         installed_at = excluded.installed_at,
         config = COALESCE(excluded.config, user_plugins.config)`,
    ).run(
      plugin.pluginId,
      plugin.source,
      plugin.spec,
      plugin.registry || null,
      plugin.version || null,
      plugin.enabled ? 1 : 0,
      plugin.installedAt,
      plugin.config ? JSON.stringify(plugin.config) : null,
    );
    this.saveDb();
  }

  removeUserPlugin(pluginId: string): void {
    this.db.prepare('DELETE FROM user_plugins WHERE plugin_id = ?').run(pluginId);
    this.saveDb();
  }

  setUserPluginEnabled(pluginId: string, enabled: boolean): void {
    this.db.prepare('UPDATE user_plugins SET enabled = ? WHERE plugin_id = ?')
      .run(enabled ? 1 : 0, pluginId);
    this.saveDb();
  }

  getUserPluginConfig(pluginId: string): Record<string, unknown> | null {
    const row = this.getOne<{ config: string | null }>(
      'SELECT config FROM user_plugins WHERE plugin_id = ?',
      [pluginId],
    );
    if (!row?.config) return null;
    try {
      return JSON.parse(row.config) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  setUserPluginConfig(pluginId: string, config: Record<string, unknown>): void {
    this.db.prepare('UPDATE user_plugins SET config = ? WHERE plugin_id = ?')
      .run(JSON.stringify(config), pluginId);
    this.saveDb();
  }

  getUserPlugin(pluginId: string): UserInstalledPlugin | undefined {
    const row = this.getOne<{
      plugin_id: string;
      source: string;
      spec: string;
      registry: string | null;
      version: string | null;
      enabled: number;
      installed_at: number;
      config: string | null;
    }>('SELECT * FROM user_plugins WHERE plugin_id = ?', [pluginId]);

    if (!row) return undefined;
    return {
      pluginId: row.plugin_id,
      source: row.source as PluginSource,
      spec: row.spec,
      registry: row.registry || undefined,
      version: row.version || undefined,
      enabled: Boolean(row.enabled),
      installedAt: row.installed_at,
      config: row.config ? JSON.parse(row.config) as Record<string, unknown> : undefined,
    };
  }

  private mapAgentRow(row: {
    id: string;
    name: string;
    description: string;
    system_prompt: string;
    identity: string;
    model: string;
    working_directory?: string | null;
    icon: string;
    skill_ids: string;
    tool_bundle_ids?: string | null;
    enabled: number;
    is_default: number;
    source: string;
    preset_id: string;
    created_at: number;
    updated_at: number;
  }): Agent {
    const skillIds = parseJsonStringArray(row.skill_ids);
    const toolBundleIds = parseJsonStringArray(row.tool_bundle_ids);
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      systemPrompt: row.system_prompt,
      identity: row.identity,
      model: row.model,
      workingDirectory: row.working_directory || '',
      icon: row.icon,
      skillIds,
      toolBundleIds,
      enabled: Boolean(row.enabled),
      isDefault: Boolean(row.is_default),
      source: row.source as AgentSource,
      sourceType: row.source === 'preset'
        ? QingShuObjectSourceType.Preset
        : QingShuObjectSourceType.LocalCustom,
      readOnly: false,
      backendAgentId: undefined,
      managedToolNames: [],
      policyNote: '',
      presetId: row.preset_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
