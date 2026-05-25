import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import crypto from 'crypto';
import type { WebContents } from 'electron';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, net, powerMonitor, powerSaveBlocker, protocol, screen, session, shell, systemPreferences } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  AuthBackend,
  type AuthCallbackPayload,
  type AuthConfig,
  type AuthPasswordLoginInput,
} from '../common/auth';
import {
  type CoworkImageAttachmentInput,
  type CoworkRuntimeImageAttachment,
  isCoworkCachedImageAttachment,
  isCoworkRuntimeImageAttachment,
  stripCoworkImageAttachmentPayloads,
} from '../common/coworkImageAttachments';
import { OpenClawSessionIpc, type OpenClawSessionPatch } from '../common/openclawSession';
import { buildSessionTitleFromInput } from '../common/sessionTitle';
import { buildScheduledTaskEnginePrompt } from '../scheduledTask/enginePrompt';
import { migrateScheduledTaskRunsToOpenclaw,migrateScheduledTasksToOpenclaw } from '../scheduledTask/migrate';
import { type AppUpdateInfo,AppUpdateIpc, AppUpdateSource } from '../shared/appUpdate/constants';
import { ArtifactIpcChannel } from '../shared/artifact/constants';
import { ArtifactBrowserPartition, ArtifactPreviewIpc } from '../shared/artifactPreview/constants';
import { ClipboardIpc } from '../shared/clipboard/constants';
import {
  CoworkIpcChannel,
  normalizeToolResultMaxChars,
} from '../shared/cowork/constants';
import { DialogIpc } from '../shared/dialog/constants';
import { type ListLocalWebServicesOptions, type LocalWebService, LocalWebServicesIpc } from '../shared/localWebServices/constants';
import { PetStatus } from '../shared/pet/constants';
import { type Platform as SharedPlatform,PlatformRegistry } from '../shared/platform';
import { OpenClawProviderId, ProviderName, isQingShuServerProvider } from '../shared/providers';
import { QingShuFileIpcChannel, QingShuFileToolName } from '../shared/qingshuFile/constants';
import { QINGSHU_FILE_PUBLISH_PROMPT } from '../shared/qingshuFile/prompt';
import type { QingShuFilePublishResult } from '../shared/qingshuFile/types';
import {
  getQingShuManagedCapabilityErrorCode,
  QingShuManagedAccessState,
  resolveQingShuManagedAccessState,
} from '../shared/qingshuManaged/access';
import { QingShuObjectSourceType } from '../shared/qingshuManaged/constants';
import {
  SpeechErrorCode,
  SpeechFeatureFlagKey,
  type SpeechFollowUpActiveSessionRequest,
  type SpeechFollowUpArmRequest,
  SpeechIpcChannel,
  SpeechPermissionStatus,
  type SpeechStartOptions,
  SpeechStartSource,
  SpeechStateType,
} from '../shared/speech/constants';
import {
  TtsEngine,
  TtsIpcChannel,
  TtsPlaybackSource,
  type TtsPrepareOptions,
  type TtsQueryOptions,
  type TtsSpeakOptions,
  TtsStateType,
} from '../shared/tts/constants';
import {
  type WakeInputConfig,
  type WakeInputDictationRequest,
  WakeInputIpcChannel,
} from '../shared/wakeInput/constants';
import { AgentManager } from './agentManager';
import { APP_NAME, APP_USER_DATA_DIR_NAME } from './appConstants';
import {
  type AuthAdapter,
  createLegacyLobsterAuthAdapter,
  createQtbAuthAdapter,
} from './auth/adapter';
import { resolveAuthBackendConfig } from './auth/config';
import { getAutoLaunchEnabled, isAutoLaunched, setAutoLaunchEnabled } from './autoLaunchManager';
import { type CoworkMessage, type CoworkMessageMetadata, type CoworkSession, CoworkStore } from './coworkStore';
import { setLanguage, t } from './i18n';
import { IMGatewayConfig,IMGatewayManager, type IMLLMConfig } from './im';
import {
  approvePairingCode,
  listPairingRequests,
  readAllowFromStore,
  rejectPairingRequest,
} from './im/imPairingStore';
import { resolveIMScheduledTaskAgentId } from './im/imScheduledTaskAgent';
import { pollNimQrLogin, startNimQrLogin } from './im/nimQrLoginService';
import type { DiscordInstanceConfig, Platform, TelegramInstanceConfig } from './im/types';
import { registerNimQrLoginHandlers } from './ipcHandlers/nimQrLogin';
import {
  getCronJobService,
  initCronJobServiceManager,
  initScheduledTaskHelpers,
  registerScheduledTaskHandlers,
} from './ipcHandlers/scheduledTask';
import {
  ClaudeRuntimeAdapter,
  type CoworkAgentEngine,
  CoworkEngineRouter,
  OpenClawRuntimeAdapter,
  type PermissionRequest,
} from './libs/agentEngine';
import { mergeAgentInstructionPrompt, mergeAgentSkillIds } from './libs/agentEngine/agentContext';
import { AppUpdateCoordinator } from './libs/appUpdateCoordinator';
import { downloadUpdate, installUpdate } from './libs/appUpdateInstaller';
import { AssistantSpeechGuard } from './libs/assistantSpeechGuard';
import { clearServerModelMetadata,getAllServerModelMetadata, getCurrentApiConfig, resolveCurrentApiConfig, setAuthTokensGetter, setQingShuInvocationContextGetter, setServerBaseUrlGetter, setStoreGetter, updateServerModelMetadata } from './libs/claudeSettings';
import {
  clearCopilotTokenState,
  initCopilotTokenManager,
  refreshCopilotTokenNow,
  setCopilotTokenState,
} from './libs/copilotTokenManager';
import { saveCoworkApiConfig } from './libs/coworkConfigStore';
import { getCoworkLogPath } from './libs/coworkLogger';
import { registerProxyTokenRefresher,setProxyTokenRefresher,startCoworkOpenAICompatProxy, stopCoworkOpenAICompatProxy } from './libs/coworkOpenAICompatProxy';
import { CoworkRunner } from './libs/coworkRunner';
import { generateSessionTitle, getElectronNodeRuntimePath, probeCoworkModelReadiness } from './libs/coworkUtil';
import { EdgeTtsService } from './libs/edgeTtsService';
import { getServerApiBaseUrl, getSkillStoreUrl, refreshEndpointsTestMode } from './libs/endpoints';
import { mergeEnterpriseOpenclawConfig,resolveEnterpriseConfigPath, syncEnterpriseConfig } from './libs/enterpriseConfigSync';
import { createOfficePreviewSession, createPreviewSession, destroyPreviewSession, isPreviewServerUrl, stopHtmlPreviewServer } from './libs/htmlPreviewServer';
import { exportLogsZip } from './libs/logExport';
import { broadcastSpeechState,MacSpeechService } from './libs/macSpeechService';
import { broadcastTtsState,MacTtsService } from './libs/macTtsService';
import { McpBridgeServer } from './libs/mcpBridgeServer';
import { parsePrimaryModelRef } from './libs/openclawAgentModels';
import {
  buildManagedSessionKey,
  OpenClawChannelSessionSync,
} from './libs/openclawChannelSessionSync';
import {
  classifyAppConfigChange,
  classifyCoworkConfigChange,
  classifyImOpenClawConfigChange,
  createStableConfigFingerprint,
  OpenClawConfigImpact,
  OpenClawConfigImpactReason,
  removeImpactDecisionReasons,
} from './libs/openclawConfigImpact';
import type { ResolvedMcpServer } from './libs/openclawConfigSync';
import { OpenClawConfigSync } from './libs/openclawConfigSync';
import { OpenClawEngineManager, type OpenClawEngineStatus } from './libs/openclawEngineManager';
import { collectReferencedEnvVarNames, pickReferencedSecretEnvVars } from './libs/openclawSecretEnv';
import {
  addMemoryEntry,
  deleteMemoryEntry,
  ensureDefaultIdentity,
  getMainAgentWorkspacePath,
  migrateSqliteToMemoryMd,
  readBootstrapFile,
  readMemoryEntries,
  resolveMemoryFilePath,
  searchMemoryEntries,
  updateMemoryEntry,
  writeBootstrapFile,
} from './libs/openclawMemoryFile';
import { startOpenClawTokenProxy, stopOpenClawTokenProxy } from './libs/openclawTokenProxy';
import { migrateMainAgentWorkspace } from './libs/openclawWorkspaceMigration';
import { type PluginInstallParams,PluginManager } from './libs/pluginManager';
import { ensurePythonRuntimeReady } from './libs/pythonRuntime';
import { resolveStdioCommand } from './libs/resolveStdioCommand';
import { serializeForLog } from './libs/sanitizeForLog';
import {
  type ForegroundSpeechOrigin,
  resolveForegroundSpeechRetryDelayMs,
  shouldRetryForegroundSpeech,
} from './libs/speechErrorRecovery';
import {
  applySystemProxyEnv,
  resolveSystemProxyUrlForTargets,
  restoreOriginalProxyEnv,
  setSystemProxyEnabled,
} from './libs/systemProxy';
import { TtsRouterService } from './libs/ttsRouterService';
import { WakeInputService } from './libs/wakeInputService';
import { getLogFilePath, getRecentMainLogEntries,initLogger } from './logger';
import { type McpServerFormData,McpStore } from './mcpStore';
import { OpenClawSessionPolicyIpc } from './openclawSessionPolicy/constants';
import { loadOpenClawSessionPolicyConfig, saveOpenClawSessionPolicyConfig } from './openclawSessionPolicy/store';
import { PetConfigStore } from './pet/petConfigStore';
import { registerPetIpc } from './pet/petIpc';
import { PetStore } from './pet/petStore';
import { PetWindowController } from './pet/petWindowController';
import { QingShuManagedCatalogService } from './qingshuManaged/catalogService';
import { QingShuManagedMcpServer } from './qingshuManaged/managedMcpServer';
import {
  createQingShuAuthFetchProvider,
  createQingShuExtensionHost,
  createQingShuGovernanceService,
  resolveQingShuModuleFeatureFlagsFromConfig,
} from './qingshuModules';
import type {
  QingShuExtensionHost,
  QingShuGovernanceService,
  QingShuModuleFlagConfig,
} from './qingshuModules/types';
import { getAppsForFile, openFileWithApp } from './shellApps';
import { SkillManager } from './skillManager';
import { getSkillServiceManager } from './skillServices';
import { SqliteStore } from './sqliteStore';
import { SubagentMessageStore } from './subagentMessageStore';
import { SubagentRunStore } from './subagentRunStore';
import { createTray, destroyTray, updateTrayMenu } from './trayManager';
import {
  AppWindowStoreKey,
  MIN_APP_WINDOW_HEIGHT,
  MIN_APP_WINDOW_WIDTH,
  resolveInitialAppWindowState,
  type WindowRectangle,
} from './windowState';

// 设置应用程序名称
app.name = APP_NAME;
app.setName(APP_NAME);

const INVALID_FILE_NAME_PATTERN = /[<>:"/\\|?*\u0000-\u001F]/g;
const MIN_MEMORY_USER_MEMORIES_MAX_ITEMS = 1;
const MAX_MEMORY_USER_MEMORIES_MAX_ITEMS = 60;
const IPC_MESSAGE_CONTENT_MAX_CHARS = 120_000;
const IPC_UPDATE_CONTENT_MAX_CHARS = 120_000;
const IPC_STRING_MAX_CHARS = 4_000;
const IPC_MAX_DEPTH = 5;
const IPC_MAX_KEYS = 80;
const IPC_MAX_ITEMS = 40;
const MAX_INLINE_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_QINGSHU_FILE_UPLOAD_BYTES = 50 * 1024 * 1024;
const ENGINE_NOT_READY_CODE = 'ENGINE_NOT_READY';
const LOCAL_WEB_SERVICE_PROBE_TIMEOUT_MS = 700;
const LOCAL_WEB_SERVICE_TITLE_MAX_LENGTH = 80;
const LOCAL_WEB_SERVICE_PORTS = Array.from(new Set([
  3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010,
  3333, 4000, 4173, 5000, 5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180,
  8000, 8080, 8081, 8888,
])).sort((a, b) => a - b);
const PowerSaveBlockerType = {
  PreventAppSuspension: 'prevent-app-suspension',
} as const;
const RENAMED_PROVIDER_IDS: Record<string, string> = {
  'github-copilot': 'lobsterai-copilot',
  'lobsterai-server': 'qingshu-server',
};
const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'application/json': '.json',
  'text/csv': '.csv',
};

const cleanHtmlTitle = (value: string): string =>
  value.replace(/\s+/g, ' ').trim().slice(0, LOCAL_WEB_SERVICE_TITLE_MAX_LENGTH);

const extractHtmlTitle = (html: string): string => {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return '';
  return cleanHtmlTitle(match[1]
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'"));
};

const probeLocalWebService = async (port: number): Promise<LocalWebService | null> => {
  const url = `http://localhost:${port}/`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOCAL_WEB_SERVICE_PROBE_TIMEOUT_MS);

  try {
    const response = await session.defaultSession.fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('text/html')) {
      return null;
    }

    const html = await response.text();
    const title = extractHtmlTitle(html) || `localhost:${port}`;
    return {
      id: `localhost:${port}`,
      title,
      url,
      host: 'localhost',
      port,
      online: true,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const sanitizeLocalWebServicePorts = (ports: unknown): number[] => {
  if (!Array.isArray(ports)) return [];
  return Array.from(new Set(ports
    .filter((port): port is number => Number.isInteger(port) && port > 0 && port <= 65535)
    .slice(0, IPC_MAX_ITEMS)));
};
const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};
const QINGSHU_FILE_MIME_BY_EXTENSION: Record<string, string> = {
  ...IMAGE_MIME_BY_EXTENSION,
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.html': 'text/html',
  '.htm': 'text/html',
};

const sanitizeExportFileName = (value: string): string => {
  const sanitized = value.replace(INVALID_FILE_NAME_PATTERN, ' ').replace(/\s+/g, ' ').trim();
  return sanitized || 'cowork-session';
};

const normalizeOpenClawModelRef = (modelRef: string): string => {
  const parsed = parsePrimaryModelRef(modelRef);
  if (!parsed) {
    return modelRef;
  }
  const renamedProviderId = RENAMED_PROVIDER_IDS[parsed.providerId];
  return renamedProviderId ? `${renamedProviderId}/${parsed.modelId}` : parsed.primaryModel;
};

const sanitizeAttachmentFileName = (value?: string): string => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return 'attachment';
  const fileName = path.basename(raw);
  const sanitized = fileName.replace(INVALID_FILE_NAME_PATTERN, ' ').replace(/\s+/g, ' ').trim();
  return sanitized || 'attachment';
};

const inferAttachmentExtension = (fileName: string, mimeType?: string): string => {
  const fromName = path.extname(fileName).toLowerCase();
  if (fromName) {
    return fromName;
  }
  if (typeof mimeType === 'string') {
    const normalized = mimeType.toLowerCase().split(';')[0].trim();
    return MIME_EXTENSION_MAP[normalized] ?? '';
  }
  return '';
};

const resolveInlineAttachmentDir = (cwd?: string): string => {
  const trimmed = typeof cwd === 'string' ? cwd.trim() : '';
  if (trimmed) {
    const resolved = path.resolve(trimmed);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      return path.join(resolved, '.cowork-temp', 'attachments', 'manual');
    }
  }
  return path.join(app.getPath('temp'), 'lobsterai', 'attachments');
};

const inferImageMimeTypeFromFilePath = (filePath: string, fallback?: string): string => {
  const normalizedFallback = typeof fallback === 'string' ? fallback.trim() : '';
  if (normalizedFallback) {
    return normalizedFallback;
  }
  const extension = path.extname(filePath).toLowerCase();
  return IMAGE_MIME_BY_EXTENSION[extension] || 'application/octet-stream';
};

const inferQingShuUploadMimeType = (filePath: string): string => {
  const extension = path.extname(filePath).toLowerCase();
  return QINGSHU_FILE_MIME_BY_EXTENSION[extension] || 'application/octet-stream';
};

const resolveCoworkImageAttachmentsForRuntime = async (
  attachments?: CoworkImageAttachmentInput[],
): Promise<CoworkRuntimeImageAttachment[] | undefined> => {
  if (!attachments?.length) {
    return undefined;
  }

  const resolvedAttachments: CoworkRuntimeImageAttachment[] = [];
  for (const attachment of attachments) {
    if (isCoworkRuntimeImageAttachment(attachment)) {
      resolvedAttachments.push(attachment);
      continue;
    }
    if (!isCoworkCachedImageAttachment(attachment)) {
      continue;
    }

    const resolvedPath = resolveShellFilePath(attachment.path);
    const stat = await fs.promises.stat(resolvedPath);
    if (!stat.isFile()) {
      throw new Error(`Image attachment is not a file: ${resolvedPath}`);
    }
    if (stat.size > MAX_INLINE_ATTACHMENT_BYTES) {
      throw new Error(`Image attachment too large (max ${Math.floor(MAX_INLINE_ATTACHMENT_BYTES / (1024 * 1024))}MB)`);
    }

    const buffer = await fs.promises.readFile(resolvedPath);
    resolvedAttachments.push({
      name: sanitizeAttachmentFileName(attachment.name || path.basename(resolvedPath)),
      mimeType: inferImageMimeTypeFromFilePath(resolvedPath, attachment.mimeType),
      base64Data: buffer.toString('base64'),
    });
  }

  return resolvedAttachments.length ? resolvedAttachments : undefined;
};

const ensurePngFileName = (value: string): string => {
  return value.toLowerCase().endsWith('.png') ? value : `${value}.png`;
};

const ensureZipFileName = (value: string): string => {
  return value.toLowerCase().endsWith('.zip') ? value : `${value}.zip`;
};

const padTwoDigits = (value: number): string => value.toString().padStart(2, '0');

const buildLogExportFileName = (): string => {
  const now = new Date();
  const datePart = `${now.getFullYear()}${padTwoDigits(now.getMonth() + 1)}${padTwoDigits(now.getDate())}`;
  const timePart = `${padTwoDigits(now.getHours())}${padTwoDigits(now.getMinutes())}${padTwoDigits(now.getSeconds())}`;
  return `lobsterai-logs-${datePart}-${timePart}.zip`;
};

const OPENCLAW_DAILY_LOG_RETENTION_DAYS = 7;
const OPENCLAW_DAILY_LOG_RE = /^openclaw-\d{4}-\d{2}-\d{2}\.log$/;

function getRecentOpenClawDailyLogEntries(
  logDir: string | null,
): Array<{ archiveName: string; filePath: string }> {
  if (!logDir || !fs.existsSync(logDir)) return [];

  const cutoffMs = Date.now() - OPENCLAW_DAILY_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  return fs.readdirSync(logDir)
    .filter((fileName) => OPENCLAW_DAILY_LOG_RE.test(fileName))
    .map((fileName) => ({ archiveName: fileName, filePath: path.join(logDir, fileName) }))
    .filter(({ filePath }) => {
      try {
        return fs.statSync(filePath).mtimeMs >= cutoffMs;
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.archiveName.localeCompare(b.archiveName));
}

const describeUrlForLog = (value: string): string => {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return value;
  }
};

const getUrlOrigin = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const isAllowedAuthWindowUrl = (value: string, allowedOrigins: Set<string>): boolean => {
  try {
    const parsed = new URL(value);
    return allowedOrigins.has(parsed.origin);
  } catch {
    return false;
  }
};

const isIgnorableAuthWindowLoadError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  return /ERR_ABORTED/i.test(error.message) || /\(-3\)/.test(error.message);
};

const loadAuthWindowUrl = async (window: BrowserWindow, targetUrl: string): Promise<void> => {
  try {
    await window.loadURL(targetUrl);
  } catch (error) {
    if (isIgnorableAuthWindowLoadError(error)) {
      console.warn('[Auth] Ignored auth window navigation interruption during Feishu redirect:', error);
      return;
    }
    throw error;
  }
};

const openAuthPopupWindow = async (
  targetUrl: string,
  options: { title?: string; allowedOrigins?: string[] } = {}
): Promise<void> => {
  const allowedOrigins = new Set<string>(
    [
      'https://open.feishu.cn',
      'https://accounts.feishu.cn',
      'https://passport.feishu.cn',
      ...(options.allowedOrigins || []),
    ].filter(Boolean)
  );

  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.setTitle(options.title || '飞书扫码登录');
    if (authWindow.webContents.getURL() !== targetUrl) {
      await loadAuthWindowUrl(authWindow, targetUrl);
    }
    authWindow.show();
    authWindow.focus();
    return;
  }

  authWindow = new BrowserWindow({
    width: 460,
    height: 760,
    minWidth: 420,
    minHeight: 620,
    title: options.title || '飞书扫码登录',
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    modal: false,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: getInitialTheme() === 'dark' ? '#0F1117' : '#F8F9FB',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: isDev,
      spellcheck: false,
    },
  });

  authWindow.setMenu(null);
  authWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  authWindow.webContents.on('will-navigate', (event, navUrl) => {
    if (!isAllowedAuthWindowUrl(navUrl, allowedOrigins)) {
      event.preventDefault();
      void shell.openExternal(navUrl);
    }
  });
  authWindow.on('closed', () => {
    authWindow = null;
  });
  authWindow.once('ready-to-show', () => {
    authWindow?.show();
  });

  await loadAuthWindowUrl(authWindow, targetUrl);
};

const truncateIpcString = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n...[truncated in main IPC forwarding]`;
};

const sanitizeIpcPayload = (value: unknown, depth = 0, seen?: WeakSet<object>): unknown => {
  const localSeen = seen ?? new WeakSet<object>();
  if (
    value === null
    || typeof value === 'number'
    || typeof value === 'boolean'
    || typeof value === 'undefined'
  ) {
    return value;
  }
  if (typeof value === 'string') {
    return truncateIpcString(value, IPC_STRING_MAX_CHARS);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'function') {
    return '[function]';
  }
  if (depth >= IPC_MAX_DEPTH) {
    return '[truncated-depth]';
  }
  if (Array.isArray(value)) {
    const result = value.slice(0, IPC_MAX_ITEMS).map((entry) => sanitizeIpcPayload(entry, depth + 1, localSeen));
    if (value.length > IPC_MAX_ITEMS) {
      result.push(`[truncated-items:${value.length - IPC_MAX_ITEMS}]`);
    }
    return result;
  }
  if (typeof value === 'object') {
    if (localSeen.has(value as object)) {
      return '[circular]';
    }
    localSeen.add(value as object);
    const entries = Object.entries(value as Record<string, unknown>);
    const result: Record<string, unknown> = {};
    for (const [key, entry] of entries.slice(0, IPC_MAX_KEYS)) {
      result[key] = sanitizeIpcPayload(entry, depth + 1, localSeen);
    }
    if (entries.length > IPC_MAX_KEYS) {
      result.__truncated_keys__ = entries.length - IPC_MAX_KEYS;
    }
    return result;
  }
  return String(value);
};

const sanitizeCoworkMessageForIpc = (message: CoworkMessage): CoworkMessage => {
  if (!message || typeof message !== 'object') {
    return message;
  }

  let sanitizedMetadata: unknown;
  if (message.metadata && typeof message.metadata === 'object') {
    sanitizedMetadata = sanitizeIpcPayload(
      stripCoworkImageAttachmentPayloads(message.metadata as Record<string, unknown>),
    );
  } else {
    sanitizedMetadata = undefined;
  }

  return {
    ...message,
    content: typeof message.content === 'string'
      ? truncateIpcString(message.content, IPC_MESSAGE_CONTENT_MAX_CHARS)
      : '',
    metadata: sanitizedMetadata as CoworkMessage['metadata'],
  };
};

const sanitizeCoworkSessionForIpc = (session: CoworkSession | null): CoworkSession | null => {
  if (!session) {
    return session;
  }
  return {
    ...session,
    messages: session.messages.map((message) => sanitizeCoworkMessageForIpc(message)),
  };
};

const sanitizePermissionRequestForIpc = (request: PermissionRequest): PermissionRequest => {
  if (!request || typeof request !== 'object') {
    return request;
  }
  return {
    ...request,
    toolInput: sanitizeIpcPayload(request.toolInput ?? {}) as PermissionRequest['toolInput'],
  };
};

type CaptureRect = { x: number; y: number; width: number; height: number };

const normalizeCaptureRect = (rect?: Partial<CaptureRect> | null): CaptureRect | null => {
  if (!rect) return null;
  const normalized = {
    x: Math.max(0, Math.round(typeof rect.x === 'number' ? rect.x : 0)),
    y: Math.max(0, Math.round(typeof rect.y === 'number' ? rect.y : 0)),
    width: Math.max(0, Math.round(typeof rect.width === 'number' ? rect.width : 0)),
    height: Math.max(0, Math.round(typeof rect.height === 'number' ? rect.height : 0)),
  };
  return normalized.width > 0 && normalized.height > 0 ? normalized : null;
};

const resolveTaskWorkingDirectory = (workspaceRoot: string): string => {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  // Reject bare Windows drive roots (e.g. "D:\") — mkdir on drive roots causes EPERM,
  // and some agent engines (OpenClaw) also fail when given a drive root as workspace.
  if (process.platform === 'win32' && /^[a-zA-Z]:\\?$/.test(resolvedWorkspaceRoot)) {
    throw new Error(`Cannot use a drive root as the working directory (${resolvedWorkspaceRoot}). Please select a subfolder instead, for example: ${resolvedWorkspaceRoot}Projects`);
  }
  if (!fs.existsSync(resolvedWorkspaceRoot)) {
    fs.mkdirSync(resolvedWorkspaceRoot, { recursive: true });
  }
  if (!fs.statSync(resolvedWorkspaceRoot).isDirectory()) {
    throw new Error(`Selected workspace is not a directory: ${resolvedWorkspaceRoot}`);
  }
  return resolvedWorkspaceRoot;
};

const getDefaultExportImageName = (defaultFileName?: string): string => {
  const normalized = typeof defaultFileName === 'string' && defaultFileName.trim()
    ? defaultFileName.trim()
    : `cowork-session-${Date.now()}`;
  return ensurePngFileName(sanitizeExportFileName(normalized));
};

const savePngWithDialog = async (
  webContents: WebContents,
  pngData: Buffer,
  defaultFileName?: string,
): Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }> => {
  const defaultName = getDefaultExportImageName(defaultFileName);
  const ownerWindow = BrowserWindow.fromWebContents(webContents);
  const saveOptions = {
    title: 'Export Session Image',
    defaultPath: path.join(app.getPath('downloads'), defaultName),
    filters: [{ name: 'PNG Image', extensions: ['png'] }],
  };
  const saveResult = ownerWindow
    ? await dialog.showSaveDialog(ownerWindow, saveOptions)
    : await dialog.showSaveDialog(saveOptions);

  if (saveResult.canceled || !saveResult.filePath) {
    return { success: true, canceled: true };
  }

  const outputPath = ensurePngFileName(saveResult.filePath);
  await fs.promises.writeFile(outputPath, pngData);
  return { success: true, canceled: false, path: outputPath };
};

const configureUserDataPath = (): void => {
  const appDataPath = app.getPath('appData');
  const preferredUserDataPath = path.join(appDataPath, APP_USER_DATA_DIR_NAME);
  const currentUserDataPath = app.getPath('userData');

  if (currentUserDataPath !== preferredUserDataPath) {
    app.setPath('userData', preferredUserDataPath);
    console.log(`[Main] userData path updated: ${currentUserDataPath} -> ${preferredUserDataPath}`);
  }
};

configureUserDataPath();
initLogger();

const isDev = process.env.NODE_ENV === 'development';
const isLinux = process.platform === 'linux';
const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';
const DEV_SERVER_URL = process.env.ELECTRON_START_URL || 'http://localhost:5175';
const enableVerboseLogging =
  process.env.ELECTRON_ENABLE_LOGGING === '1' ||
  process.env.ELECTRON_ENABLE_LOGGING === 'true';
const disableGpu =
  process.env.LOBSTERAI_DISABLE_GPU === '1' ||
  process.env.LOBSTERAI_DISABLE_GPU === 'true' ||
  process.env.ELECTRON_DISABLE_GPU === '1' ||
  process.env.ELECTRON_DISABLE_GPU === 'true';
const reloadOnChildProcessGone =
  process.env.ELECTRON_RELOAD_ON_CHILD_PROCESS_GONE === '1' ||
  process.env.ELECTRON_RELOAD_ON_CHILD_PROCESS_GONE === 'true';
const TITLEBAR_HEIGHT = 48;
const TITLEBAR_COLORS = {
  dark: { color: '#0F1117', symbolColor: '#E4E5E9' },
  // Align light title bar with app light surface-muted tone to reduce visual contrast.
  light: { color: '#F3F4F6', symbolColor: '#1A1D23' },
} as const;

const safeDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const normalizeWindowsShellPath = (inputPath: string): string => {
  const trimmed = inputPath.trim();
  if (!trimmed) return inputPath;

  let normalized = trimmed;
  if (/^(?:file|localfile):\/\//i.test(normalized)) {
    try {
      const url = new URL(normalized);
      normalized = url.protocol === 'file:'
        ? fileURLToPath(url)
        : safeDecodeURIComponent(url.pathname);
    } catch {
      normalized = safeDecodeURIComponent(normalized.replace(/^(?:file|localfile):\/\//i, ''));
    }
  }

  if (!isWindows) return normalized;

  if (/^\/[A-Za-z]:/.test(normalized)) {
    normalized = normalized.slice(1);
  }

  const unixDriveMatch = normalized.match(/^[/\\]([A-Za-z])[/\\](.+)$/);
  if (unixDriveMatch) {
    const drive = unixDriveMatch[1].toUpperCase();
    const rest = unixDriveMatch[2].replace(/[/\\]+/g, '\\');
    return `${drive}:\\${rest}`;
  }

  if (/^[A-Za-z]:[/\\]/.test(normalized)) {
    const drive = normalized[0].toUpperCase();
    const rest = normalized.slice(1).replace(/\//g, '\\');
    return `${drive}${rest}`;
  }

  return normalized;
};

const resolveShellFilePath = (inputPath: string): string => {
  const normalizedPath = normalizeWindowsShellPath(inputPath);
  if (!normalizedPath.trim()) {
    return normalizedPath;
  }
  return path.resolve(normalizedPath);
};

const resolveExistingShellFilePath = (filePath: string): { ok: true; path: string } | { ok: false; error: string } => {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return { ok: false, error: 'Missing file path' };
  }
  const normalizedPath = resolveShellFilePath(filePath);
  if (!fs.existsSync(normalizedPath)) {
    console.warn('[Shell] target does not exist:', normalizedPath);
    return { ok: false, error: `Path does not exist: ${normalizedPath}` };
  }
  return { ok: true, path: normalizedPath };
};

// ==================== macOS Permissions ====================

/**
 * Check calendar permission on macOS by attempting to access Calendar app
 * Returns: 'authorized' | 'denied' | 'restricted' | 'not-determined'
 * On Windows, checks if Outlook is available
 * On Linux, returns 'not-supported'
 */
const checkCalendarPermission = async (): Promise<string> => {
  if (process.platform === 'darwin') {
    try {
      // Try to access Calendar to check permission
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);

      // Quick test to see if we can access Calendar
      await execAsync('osascript -l JavaScript -e \'Application("Calendar").name()\'', { timeout: 5000 });
      console.log('[Permissions] macOS Calendar access: authorized');
      return 'authorized';
    } catch (error) {
      const stderr = error && typeof error === 'object' && 'stderr' in error
        ? String(error.stderr ?? '')
        : '';
      // Check if it's a permission error
      if (stderr.includes('不能获取对象') ||
          stderr.includes('not authorized') ||
          stderr.includes('Permission denied')) {
        console.log('[Permissions] macOS Calendar access: not-determined (needs permission)');
        return 'not-determined';
      }
      console.warn('[Permissions] Failed to check macOS calendar permission:', error);
      return 'not-determined';
    }
  }

  if (process.platform === 'win32') {
    // Windows doesn't have a system-level calendar permission like macOS
    // Instead, we check if Outlook is available
    try {
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);

      // Check if Outlook COM object is accessible
      const checkScript = `
        try {
          $Outlook = New-Object -ComObject Outlook.Application
          $Outlook.Version
        } catch { exit 1 }
      `;
      await execAsync('powershell -Command "' + checkScript + '"', { timeout: 10000 });
      console.log('[Permissions] Windows Outlook is available');
      return 'authorized';
    } catch {
      console.log('[Permissions] Windows Outlook not available or not accessible');
      return 'not-determined';
    }
  }

  return 'not-supported';
};

/**
 * Request calendar permission on macOS
 * On Windows, attempts to initialize Outlook COM object
 */
const requestCalendarPermission = async (): Promise<boolean> => {
  if (process.platform === 'darwin') {
    try {
      // On macOS, we trigger permission by trying to access Calendar
      // The system will show permission dialog if needed
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);

      await execAsync('osascript -l JavaScript -e \'Application("Calendar").calendars()[0].name()\'', { timeout: 10000 });
      return true;
    } catch (error) {
      console.warn('[Permissions] Failed to request macOS calendar permission:', error);
      return false;
    }
  }

  if (process.platform === 'win32') {
    // Windows doesn't have a permission dialog for COM objects
    // We just check if Outlook is available
    const status = await checkCalendarPermission();
    return status === 'authorized';
  }

  return false;
};



// 配置应用
// Linux/Windows 禁用 Chromium 沙箱：桌面应用渲染自有代码，风险可控；
// Windows 下以管理员运行时沙箱无法降权会导致 GPU 进程启动失败 (error_code=18)
if (isLinux || isWindows) {
  app.commandLine.appendSwitch('no-sandbox');
}
if (isLinux) {
  app.commandLine.appendSwitch('disable-dev-shm-usage');
}
if (disableGpu) {
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  // 禁用硬件加速
  app.disableHardwareAcceleration();
}
if (enableVerboseLogging) {
  app.commandLine.appendSwitch('enable-logging');
  app.commandLine.appendSwitch('v', '1');
}

// 配置网络服务
app.on('ready', () => {
  // 配置网络服务重启策略
  app.configureHostResolver({
    enableBuiltInResolver: true,
    secureDnsMode: 'off'
  });
});

// 添加错误处理
app.on('render-process-gone', (_event, webContents, details) => {
  console.error('Render process gone:', details);
  const shouldReload =
    details.reason === 'crashed' ||
    details.reason === 'killed' ||
    details.reason === 'oom' ||
    details.reason === 'launch-failed' ||
    details.reason === 'integrity-failure';
  if (shouldReload) {
    scheduleReload(`render-process-gone (${details.reason})`, webContents);
  }
});

app.on('child-process-gone', (_event, details) => {
  console.error('Child process gone:', details);
  if (reloadOnChildProcessGone && (details.type === 'GPU' || details.type === 'Utility')) {
    scheduleReload(`child-process-gone (${details.type}/${details.reason})`);
  }
});

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
});

process.on('exit', (code) => {
  console.log(`[Main] Process exiting with code: ${code}`);
});

let store: SqliteStore | null = null;
let coworkStore: CoworkStore | null = null;
let coworkRunner: CoworkRunner | null = null;
let claudeRuntimeAdapter: ClaudeRuntimeAdapter | null = null;
let openClawRuntimeAdapter: OpenClawRuntimeAdapter | null = null;
let coworkEngineRouter: CoworkEngineRouter | null = null;
let skillManager: SkillManager | null = null;
let mcpStore: McpStore | null = null;
let mcpBridgeServer: McpBridgeServer | null = null;
let mcpBridgeSecret: string = require('crypto').randomUUID();
let resolvedMcpServersCache: ResolvedMcpServer[] = [];
let pluginManager: PluginManager | null = null;
let imGatewayManager: IMGatewayManager | null = null;
let subagentRunStore: SubagentRunStore | null = null;
let subagentMessageStore: SubagentMessageStore | null = null;
let storeInitPromise: Promise<SqliteStore> | null = null;
let openClawEngineManager: OpenClawEngineManager | null = null;
let openClawConfigSync: OpenClawConfigSync | null = null;
let qingShuExtensionHost: QingShuExtensionHost | null = null;
let qingShuGovernanceService: QingShuGovernanceService | null = null;
let qingShuManagedCatalogService: QingShuManagedCatalogService | null = null;
let qingShuManagedMcpServer: QingShuManagedMcpServer | null = null;
let publishQingShuFileHandler: ((filePath?: string) => Promise<QingShuFilePublishResult>) | null = null;
let appUpdateCoordinator: AppUpdateCoordinator | null = null;
let openClawBootstrapPromise: Promise<OpenClawEngineStatus> | null = null;
let openClawStatusForwarderBound = false;
let coworkRuntimeForwarderBound = false;
let memoryMigrationDone = false;
let preventSleepBlockerId: number | null = null;

type IMProviderConfigSnapshot = {
  enabled?: boolean;
  apiKey?: string;
  baseUrl?: string;
  models?: Array<{ id?: string }>;
};

type IMAppConfigSnapshot = {
  providers?: Record<string, IMProviderConfigSnapshot | undefined>;
  api?: {
    key?: string;
    baseUrl?: string;
  };
  model?: {
    defaultModel?: string;
  };
};

function setPreventSleepBlockerEnabled(enabled: boolean): void {
  if (enabled) {
    if (preventSleepBlockerId === null || !powerSaveBlocker.isStarted(preventSleepBlockerId)) {
      preventSleepBlockerId = powerSaveBlocker.start(PowerSaveBlockerType.PreventAppSuspension);
    }
    return;
  }

  if (preventSleepBlockerId !== null && powerSaveBlocker.isStarted(preventSleepBlockerId)) {
    powerSaveBlocker.stop(preventSleepBlockerId);
  }
  preventSleepBlockerId = null;
}

const initStore = async (): Promise<SqliteStore> => {
  if (!storeInitPromise) {
    if (!app.isReady()) {
      throw new Error('Store accessed before app is ready.');
    }
    storeInitPromise = Promise.race([
      SqliteStore.create(app.getPath('userData')),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Store initialization timed out after 15s')), 15_000)
      ),
    ]);
  }
  return storeInitPromise;
};

const getStore = (): SqliteStore => {
  if (!store) {
    throw new Error('Store not initialized. Call initStore() first.');
  }
  return store;
};

const getOpenClawEngineManager = (): OpenClawEngineManager => {
  if (!openClawEngineManager) {
    openClawEngineManager = new OpenClawEngineManager();
  }
  return openClawEngineManager;
};

const getAppUpdateCoordinator = (): AppUpdateCoordinator => {
  if (!appUpdateCoordinator) {
    appUpdateCoordinator = new AppUpdateCoordinator(getStore());
  }
  return appUpdateCoordinator;
};

const getPetConfigStore = (): PetConfigStore => {
  if (!petConfigStore) {
    petConfigStore = new PetConfigStore(getStore());
  }
  return petConfigStore;
};

const getPetStore = (): PetStore => {
  if (!petStore) {
    petStore = new PetStore();
  }
  return petStore;
};

const getPetWindowController = (): PetWindowController => {
  if (!petWindowController) {
    petWindowController = new PetWindowController(getPetConfigStore(), {
      preloadPath: PRELOAD_PATH,
      devServerUrl: DEV_SERVER_URL,
      isDev,
    });
  }
  return petWindowController;
};

const forwardOpenClawStatus = (status: OpenClawEngineStatus): void => {
  const windows = BrowserWindow.getAllWindows();
  windows.forEach((win) => {
    if (win.isDestroyed()) return;
    try {
      win.webContents.send('openclaw:engine:onProgress', status);
    } catch (error) {
      console.error('Failed to forward OpenClaw engine status:', error);
    }
  });
};

const bindOpenClawStatusForwarder = (): void => {
  if (openClawStatusForwarderBound) return;
  const manager = getOpenClawEngineManager();
  manager.on('status', (status) => {
    forwardOpenClawStatus(status);
  });
  openClawStatusForwarderBound = true;
  forwardOpenClawStatus(manager.getStatus());
};

const getEngineNotReadyResponse = (status: OpenClawEngineStatus) => {
  const fallbackMessage = 'AI engine is initializing. Please try again in a moment.';
  return {
    success: false,
    code: ENGINE_NOT_READY_CODE,
    error: status.message || fallbackMessage,
    engineStatus: status,
  };
};

const bootstrapOpenClawEngine = async (options: { forceReinstall?: boolean; reason?: string } = {}) => {
  if (openClawBootstrapPromise) {
    return openClawBootstrapPromise;
  }

  const manager = getOpenClawEngineManager();
  bindOpenClawStatusForwarder();

  const task = async (): Promise<OpenClawEngineStatus> => {
    const reason = options.reason || 'unknown';
    const t0 = Date.now();
    const elapsed = () => `${Date.now() - t0}ms`;
    try {
      console.log(`[OpenClaw] bootstrap starting (reason=${reason})`);

      // Start AskUser before config sync so the ask-user-question plugin receives a callback URL.
      await startAskUserServer().catch((err: unknown) => {
        console.error('[OpenClaw] bootstrap: AskUser server startup failed (non-fatal):', err);
      });
      console.log(`[OpenClaw] bootstrap: AskUser server setup done (${elapsed()}), askUserUrl=${mcpBridgeServer?.askUserCallbackUrl || 'null'}`);

      // Ensure IDENTITY.md has default content in the main agent workspace
      try {
        ensureDefaultIdentity(getMainAgentWorkspacePath(manager.getStateDir()));
      } catch (err) {
        console.warn('[OpenClaw] bootstrap: ensureDefaultIdentity failed (non-fatal):', err);
      }

      const syncResult = await syncOpenClawConfig({
        reason: `bootstrap:${reason}`,
        restartGatewayIfRunning: false,
      });
      console.log(`[OpenClaw] bootstrap: syncOpenClawConfig done (${elapsed()}), success=${syncResult.success}`);
      if (!syncResult.success) {
        return syncResult.status || manager.getStatus();
      }
      if (options.forceReinstall) {
        await manager.stopGateway();
        console.log(`[OpenClaw] bootstrap: stopGateway done (${elapsed()})`);
      }
      const ensuredStatus = await manager.ensureReady();
      console.log(`[OpenClaw] bootstrap: ensureReady done (${elapsed()}), phase=${ensuredStatus.phase}`);
      if (ensuredStatus.phase !== 'ready' && ensuredStatus.phase !== 'running') {
        return ensuredStatus;
      }
      const result = await manager.startGateway(`bootstrap:${reason}`);
      console.log(`[OpenClaw] bootstrap completed (${elapsed()}), phase=${result.phase}`);
      return result;
    } catch (error) {
      console.error(`[OpenClaw] bootstrap failed (${reason}, ${elapsed()}):`, error);
      return manager.getStatus();
    }
  };

  const promise = task().finally(() => {
    if (openClawBootstrapPromise === promise) {
      openClawBootstrapPromise = null;
    }
  });
  openClawBootstrapPromise = promise;
  return promise;
};

// Module-level handle so ensureOpenClawRunningForCowork can await any in-flight
// proactive token refresh before syncing config to the gateway.
let pendingTokenRefresh: Promise<string | null> | null = null;

const ensureOpenClawRunningForCowork = async () => {
  const manager = getOpenClawEngineManager();
  const status = manager.getStatus();
  if (status.phase === 'running') {
    // Token proxy handles dynamic token injection — no need to restart
    // the gateway for token changes. Just wait for any in-flight refresh.
    if (pendingTokenRefresh) {
      console.log('[OpenClaw] ensureRunning: awaiting pending token refresh before proceeding');
      await pendingTokenRefresh.catch(() => {});
    }
    return manager.getStatus();
  }
  if (status.phase === 'starting') {
    return status;
  }

  // Wait for any in-flight token refresh so that the gateway starts with
  // a fresh token rather than the stale one that triggered the refresh.
  if (pendingTokenRefresh) {
    console.log('[OpenClaw] ensureRunning: awaiting pending token refresh before gateway start');
    await pendingTokenRefresh.catch(() => {});
  }

  // Ensure AskUser server is started and config is synced before launching the gateway.
  await startAskUserServer().catch((err: unknown) => {
    console.error('[OpenClaw] ensureRunning: AskUser server startup failed (non-fatal):', err);
  });
  const syncResult = await syncOpenClawConfig({
    reason: 'ensureRunning:mcpConfig',
    restartGatewayIfRunning: false,
  });
  if (!syncResult.success) {
    console.error('[OpenClaw] ensureRunning: config sync failed:', syncResult.error);
  }

  return await manager.startGateway('ensure-running-for-cowork');
};

const getCoworkStore = () => {
  if (!coworkStore) {
    const sqliteStore = getStore();
    coworkStore = new CoworkStore(sqliteStore.getNativeDatabase(), sqliteStore.getSaveFunction());
    const cleaned = coworkStore.autoDeleteNonPersonalMemories();
    if (cleaned > 0) {
      console.info(`[cowork-memory] Auto-deleted ${cleaned} non-personal/procedural memories`);
    }
  }
  return coworkStore;
};

const getSubagentRunStore = (): SubagentRunStore => {
  if (!subagentRunStore) {
    subagentRunStore = new SubagentRunStore(getStore().getNativeDatabase());
  }
  return subagentRunStore;
};

const getSubagentMessageStore = (): SubagentMessageStore => {
  if (!subagentMessageStore) {
    subagentMessageStore = new SubagentMessageStore(getStore().getNativeDatabase());
  }
  return subagentMessageStore;
};

const mapPersistedSubagentMessage = (message: ReturnType<SubagentMessageStore['getMessages']>[number]) => {
  let metadata: Record<string, unknown> | undefined;
  if (message.metadata) {
    try {
      const parsed = JSON.parse(message.metadata);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        metadata = parsed as Record<string, unknown>;
      }
    } catch {
      metadata = undefined;
    }
  }
  return {
    id: message.id,
    type: message.type,
    content: message.content,
    timestamp: message.createdAt,
    metadata,
  };
};

let agentManager: AgentManager | null = null;
const getAgentManager = () => {
  if (!agentManager) {
    agentManager = new AgentManager(getCoworkStore(), {
      getManagedAgents: () => qingShuManagedCatalogService?.listManagedAgents() ?? [],
    });
  }
  return agentManager;
};

const resolveAgentDefaultWorkingDirectory = (agentId?: string): string => {
  const resolvedAgentId = agentId?.trim() || 'main';
  const agentWorkingDirectory = getAgentManager().getAgent(resolvedAgentId)?.workingDirectory?.trim();
  if (agentWorkingDirectory) return agentWorkingDirectory;
  return getCoworkStore().getConfig().workingDirectory.trim();
};

const resolveSessionWorkingDirectory = (options: { cwd?: string; agentId?: string }): string => {
  const explicitWorkingDirectory = options.cwd?.trim();
  if (explicitWorkingDirectory) return explicitWorkingDirectory;
  return resolveAgentDefaultWorkingDirectory(options.agentId);
};

const isQingShuServerModelRef = (modelRef: string): boolean => {
  const normalized = modelRef.trim();
  if (!normalized) return false;

  const parsed = parsePrimaryModelRef(normalized);
  if (parsed) {
    return isQingShuServerProvider(parsed.providerId);
  }

  return getAllServerModelMetadata().some((model) => model.modelId === normalized);
};

const shouldRefreshServerQuotaForSession = (sessionId: string): boolean => {
  const sessionRecord = getCoworkStore().getSession(sessionId);
  const sessionModelRef = sessionRecord?.modelOverride?.trim();
  if (sessionModelRef) {
    return isQingShuServerModelRef(sessionModelRef);
  }

  const agentModelRef = sessionRecord?.agentId
    ? getAgentManager().getAgent(sessionRecord.agentId)?.model?.trim()
    : '';
  if (agentModelRef) {
    return isQingShuServerModelRef(agentModelRef);
  }

  const apiConfig = resolveCurrentApiConfig();
  return isQingShuServerProvider(apiConfig.providerMetadata?.providerName);
};

const listWorkspaceSkillInstalls = (): Array<{
  agentId: string;
  agentName: string;
  workspacePath: string;
  skillIds: string[];
}> => {
  const stateDir = getOpenClawEngineManager().getStateDir();
  if (!fs.existsSync(stateDir)) {
    return [];
  }

  const installs: Array<{
    agentId: string;
    agentName: string;
    workspacePath: string;
    skillIds: string[];
  }> = [];

  for (const entry of fs.readdirSync(stateDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('workspace-')) {
      continue;
    }

    const agentId = entry.name.slice('workspace-'.length).trim();
    if (!agentId) {
      continue;
    }

    const workspacePath = path.join(stateDir, entry.name);
    const skillsPath = path.join(workspacePath, 'skills');
    if (!fs.existsSync(skillsPath) || !fs.statSync(skillsPath).isDirectory()) {
      continue;
    }

    const skillIds = fs.readdirSync(skillsPath, { withFileTypes: true })
      .filter((skillEntry) => skillEntry.isDirectory() && !skillEntry.name.startsWith('.'))
      .map((skillEntry) => skillEntry.name.trim())
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));

    if (skillIds.length === 0) {
      continue;
    }

    const agent = getAgentManager().getAgent(agentId);
    installs.push({
      agentId,
      agentName: agent?.name?.trim() || agentId,
      workspacePath,
      skillIds,
    });
  }

  return installs.sort((left, right) => left.agentName.localeCompare(right.agentName));
};

const normalizeIds = (values: string[] | undefined): string[] => Array.from(new Set(
  (values ?? [])
    .map((value) => value.trim())
    .filter(Boolean),
));

const hasQingShuAuthSession = (): boolean => {
  const authTokens = getStore().get<{ accessToken?: string }>('auth_tokens');
  return typeof authTokens?.accessToken === 'string' && authTokens.accessToken.trim().length > 0;
};

const buildManagedCapabilityDeniedResult = (options: {
  sourceType?: string;
  allowed?: boolean;
  policyNote?: string;
}): { success: false; code: string; error: string } | null => {
  const accessState = resolveQingShuManagedAccessState({
    sourceType: options.sourceType,
    allowed: options.allowed,
    isLoggedIn: hasQingShuAuthSession(),
  });
  const errorCode = getQingShuManagedCapabilityErrorCode(accessState);
  if (!errorCode) {
    return null;
  }

  if (accessState === QingShuManagedAccessState.Forbidden) {
    return {
      success: false,
      code: errorCode,
      error: options.policyNote?.trim() || 'Your account cannot use this QingShu managed capability.',
    };
  }

  return {
    success: false,
    code: errorCode,
    error: 'QingShu login is required to use this managed capability.',
  };
};

const resolveCoworkManagedCapabilityDeniedResult = (options: {
  agentId?: string | null;
  skillIds?: string[];
}): { success: false; code: string; error: string } | null => {
  const agentId = options.agentId?.trim();
  if (agentId) {
    const agent = getAgentManager().getAgent(agentId);
    const agentDenied = buildManagedCapabilityDeniedResult({
      sourceType: agent?.sourceType,
      allowed: agent?.allowed,
      policyNote: agent?.policyNote,
    });
    if (agentDenied) {
      return agentDenied;
    }
  }

  for (const skillId of normalizeIds(options.skillIds)) {
    const skill = getSkillManager().getSkillById(skillId);
    const skillDenied = buildManagedCapabilityDeniedResult({
      sourceType: skill?.sourceType,
      allowed: skill?.allowed,
      policyNote: skill?.policyNote,
    });
    if (skillDenied) {
      return skillDenied;
    }
  }

  return null;
};

const resolveCoworkAgentEngine = (): CoworkAgentEngine => {
  const configured = getCoworkStore().getConfig().agentEngine;
  return configured === 'openclaw' ? 'openclaw' : 'yd_cowork';
};

const getOpenClawConfigSync = (): OpenClawConfigSync => {
  if (!openClawConfigSync) {
    openClawConfigSync = new OpenClawConfigSync({
      engineManager: getOpenClawEngineManager(),
      getCoworkConfig: () => getCoworkStore().getConfig(),
      getSkillsList: () => getSkillManager().listSkills().map((skill) => ({
        id: skill.id,
        enabled: resolveQingShuManagedAccessState({
          sourceType: skill.sourceType,
          allowed: skill.allowed,
          isLoggedIn: hasQingShuAuthSession(),
        }) === QingShuManagedAccessState.Available && skill.enabled,
      })),
      getTelegramOpenClawConfig: () => {
        try {
          return getIMGatewayManager()?.getConfig()?.telegram ?? null;
        } catch {
          return null;
        }
      },
      getTelegramInstances: () => {
        try {
          return getIMGatewayManager().getIMStore().getTelegramInstances();
        } catch {
          return [];
        }
      },
      getDingTalkInstances: () => {
        try {
          return getIMGatewayManager().getIMStore().getDingTalkInstances();
        } catch {
          return [];
        }
      },
      getFeishuInstances: () => {
        try {
          return getIMGatewayManager().getIMStore().getFeishuInstances();
        } catch {
          return [];
        }
      },
      getQQInstances: () => {
        try {
          return getIMGatewayManager().getIMStore().getQQInstances();
        } catch {
          return [];
        }
      },
      getWecomInstances: () => {
        try {
          return getIMGatewayManager().getIMStore().getWecomInstances();
        } catch {
          return [];
        }
      },
      getPopoConfig: () => {
        try {
          return getIMGatewayManager().getIMStore().getPopoConfig();
          } catch {
          return null;
        }
      },
      getPopoInstances: () => {
        try {
          return getIMGatewayManager().getIMStore().getPopoInstances();
        } catch {
          return [];
        }
      },
      getNimConfig: () => {
        try {
          return getIMGatewayManager().getIMStore().getNimConfig();
        } catch {
          return null;
        }
      },
      getNimInstances: () => {
        try {
          return getIMGatewayManager().getIMStore().getNimInstances();
        } catch {
          return [];
        }
      },
      getNeteaseBeeChanConfig: () => {
        try {
          return getIMGatewayManager().getConfig()['netease-bee'];
        } catch {
          return null;
        }
      },
      getWeixinConfig: () => {
        try {
          return getIMGatewayManager().getConfig().weixin;
        } catch {
          return null;
        }
      },
      getEmailOpenClawConfig: () => {
        try {
          return getIMGatewayManager().getIMStore().getEmailConfig();
        } catch {
          return null;
        }
      },
      getIMSettings: () => {
        try {
          return getIMGatewayManager().getConfig().settings;
        } catch {
          return null;
        }
      },
      getDiscordOpenClawConfig: () => {
        try {
          return getIMGatewayManager()?.getConfig()?.discord ?? null;
        } catch {
          return null;
        }
      },
      getDiscordInstances: () => {
        try {
          return getIMGatewayManager().getIMStore().getDiscordInstances();
        } catch {
          return [];
        }
      },
      getMcpBridgeSecret: () => mcpBridgeSecret,
      getResolvedMcpServers: () => resolvedMcpServersCache,
      getAskUserCallbackUrl: () => mcpBridgeServer?.askUserCallbackUrl ?? null,
      getAgents: () => getAgentManager().listAgents(),
      getUserPlugins: () => getCoworkStore().listUserPlugins(),
      getQingShuEnabledToolBundles: () => qingShuExtensionHost?.getEnabledToolBundles() ?? [],
      getQingShuSharedToolCatalog: () => qingShuExtensionHost?.getSharedToolCatalog() ?? {
        generatedAt: Date.now(),
        modules: [],
        tools: [],
      },
    });
  }
  return openClawConfigSync;
};

// Deferred gateway restart: when a config change requires a gateway restart
// but active cowork sessions or cron jobs exist, we defer the restart until
// all workloads complete.  Do not force-restart while work is active: doing so
// pushes OpenClaw into a draining/restart window and causes user turns to fail.
let deferredHardRestartTimer: ReturnType<typeof setInterval> | null = null;
let deferredHardRestartTimeout: ReturnType<typeof setTimeout> | null = null;
const DEFERRED_RESTART_POLL_MS = 3_000;
const DEFERRED_RESTART_WAIT_LOG_MS = 5 * 60_000;

const hasActiveGatewayWorkloads = (): boolean => {
  if (openClawRuntimeAdapter?.hasActiveSessions()) return true;
  try {
    if (getCronJobService()?.hasRunningJobs()) return true;
  } catch {
    // CronJobService may not be initialized yet.
  }
  return false;
};

const clearDeferredHardRestart = () => {
  if (deferredHardRestartTimer) { clearInterval(deferredHardRestartTimer); deferredHardRestartTimer = null; }
  if (deferredHardRestartTimeout) { clearTimeout(deferredHardRestartTimeout); deferredHardRestartTimeout = null; }
};

const performGatewayRestart = async (reason: string): Promise<OpenClawEngineStatus> => {
  if (openClawRuntimeAdapter) {
    console.log(`[OpenClaw] performGatewayRestart: disconnecting runtime adapter before gateway restart (reason: ${reason})`);
    openClawRuntimeAdapter.disconnectGatewayClient();
  }
  return getOpenClawEngineManager().restartGateway(reason);
};

const executeDeferredHardGatewayRestart = async (reason: string) => {
  if (hasActiveGatewayWorkloads()) {
    console.log(`[OpenClaw] executeDeferredHardGatewayRestart: still waiting for active workloads (reason: ${reason})`);
    return;
  }

  clearDeferredHardRestart();
  console.log(`[OpenClaw] executeDeferredHardGatewayRestart: performing deferred restart (reason: ${reason})`);
  await performGatewayRestart(`deferred:${reason}`);
};

const scheduleDeferredHardGatewayRestart = (reason: string) => {
  if (deferredHardRestartTimer) {
    console.log(`[OpenClaw] scheduleDeferredHardGatewayRestart: already scheduled, skipping (reason: ${reason})`);
    return;
  }

  deferredHardRestartTimer = setInterval(() => {
    if (!hasActiveGatewayWorkloads()) {
      void executeDeferredHardGatewayRestart(reason);
    }
  }, DEFERRED_RESTART_POLL_MS);

  deferredHardRestartTimeout = setTimeout(() => {
    if (hasActiveGatewayWorkloads()) {
      console.warn(`[OpenClaw] scheduleDeferredHardGatewayRestart: still waiting for active workloads, keeping restart deferred (reason: ${reason})`);
      return;
    }
    void executeDeferredHardGatewayRestart(reason);
  }, DEFERRED_RESTART_WAIT_LOG_MS);
};

const requestGatewayRestart = async (reason: string): Promise<OpenClawEngineStatus> => {
  const manager = getOpenClawEngineManager();
  const status = manager.getStatus();
  if (status.phase === 'running' && hasActiveGatewayWorkloads()) {
    console.log(`[OpenClaw] requestGatewayRestart: deferring restart because active workloads exist (reason: ${reason})`);
    scheduleDeferredHardGatewayRestart(reason);
    return {
      ...status,
      message: 'OpenClaw gateway restart deferred until active workloads finish.',
    };
  }
  return performGatewayRestart(reason);
};

const ensureQingShuManagedMcpServer = async (): Promise<void> => {
  if (!qingShuManagedCatalogService) {
    return;
  }
  if (!qingShuManagedMcpServer) {
    qingShuManagedMcpServer = new QingShuManagedMcpServer(qingShuManagedCatalogService, {
      [QingShuFileToolName.Publish]: async (args) => {
        const filePath = typeof args.filePath === 'string' ? args.filePath : '';
        const result = publishQingShuFileHandler
          ? await publishQingShuFileHandler(filePath)
          : { success: false, error: 'QingShu file publisher is not initialized' };
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: result.success !== true,
        };
      },
    });
  }
  await qingShuManagedMcpServer.start();
};

const getQingShuManagedNativeMcpServerConfig = async (): Promise<ResolvedMcpServer | null> => {
  if (!qingShuManagedCatalogService) {
    return null;
  }
  await ensureQingShuManagedMcpServer();
  const config = qingShuManagedMcpServer?.getServerConfig();
  if (!config) {
    return null;
  }
  return config;
};

const refreshQingShuManagedMcpRuntimeConfig = (reason: string): void => {
  void ensureQingShuManagedMcpServer()
    .then(() => syncOpenClawConfig({ reason, restartGatewayIfRunning: true }))
    .catch((error) => {
      console.warn('[QingShuManagedMcp] failed to refresh native MCP config:', error);
    });
};

const getResolvedMcpServers = async (): Promise<ResolvedMcpServer[]> => {
  const enabledServers = getMcpStore().getEnabledServers();
  const electronPath = getElectronNodeRuntimePath();
  const npmBinDir = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'npm', 'bin')
    : '';
  const resolved: ResolvedMcpServer[] = [];

  for (const server of enabledServers) {
    try {
      if (server.transportType === 'stdio') {
        const stdio = await resolveStdioCommand(server);
        const shimEnv: Record<string, string> = {
          LOBSTERAI_ELECTRON_PATH: electronPath,
        };
        if (npmBinDir) {
          shimEnv.LOBSTERAI_NPM_BIN_DIR = npmBinDir;
        }
        resolved.push({
          name: server.name,
          transportType: 'stdio',
          command: stdio.command,
          args: stdio.args,
          env: { ...shimEnv, ...(stdio.env || {}) },
        });
        continue;
      }

      resolved.push({
        name: server.name,
        transportType: server.transportType,
        url: server.url,
        headers: server.headers,
      });
    } catch (error) {
      console.warn(`[MCP] failed to resolve native server "${server.name}", skipping:`, error);
    }
  }

  const managedConfig = await getQingShuManagedNativeMcpServerConfig();
  if (managedConfig) {
    resolved.push(managedConfig);
  }

  return resolved;
};

const syncOpenClawConfig = async (
  options: { reason: string; restartGatewayIfRunning?: boolean } = { reason: 'unknown' },
): Promise<{ success: boolean; changed: boolean; status?: OpenClawEngineStatus; error?: string }> => {
  // Always write openclaw.json immediately. OpenClaw's file watcher can drain
  // active work before reloading; deferring the write keeps model/channel
  // changes stale for new sessions. Only hard restarts are deferred below.
  try {
    resolvedMcpServersCache = await getResolvedMcpServers();
  } catch (error) {
    console.warn('[OpenClaw] failed to resolve native MCP server config:', error);
    resolvedMcpServersCache = [];
  }

  const syncResult = getOpenClawConfigSync().sync(options.reason);
  if (!syncResult.ok) {
    const status = getOpenClawEngineManager().setExternalError(
      `OpenClaw config sync failed: ${syncResult.error || 'unknown error'}`,
    );
    return {
      success: false,
      changed: false,
      status,
      error: syncResult.error,
    };
  }

  // After every successful config sync, merge enterprise openclaw.json
  // fields into the generated runtime config. Enterprise values win.
  try {
    mergeEnterpriseOpenclawConfig(getOpenClawEngineManager().getConfigPath());
  } catch { /* non-critical */ }

  // Update secret env vars so the gateway process receives the latest
  // plaintext credentials via environment variables (openclaw.json only
  // contains ${VAR} placeholders, never plaintext secrets).
  const nextSecretEnvVars = getOpenClawConfigSync().collectSecretEnvVars();
  const prevSecretEnvVars = getOpenClawEngineManager().getSecretEnvVars();
  let referencedSecretNames = new Set<string>();
  try {
    referencedSecretNames = collectReferencedEnvVarNames(
      fs.readFileSync(getOpenClawEngineManager().getConfigPath(), 'utf8'),
    );
  } catch {
    referencedSecretNames = new Set<string>();
  }
  const nextReferencedSecretEnvVars = pickReferencedSecretEnvVars(nextSecretEnvVars, referencedSecretNames);
  const prevReferencedSecretEnvVars = pickReferencedSecretEnvVars(prevSecretEnvVars, referencedSecretNames);
  const secretEnvVarsChanged = JSON.stringify(nextReferencedSecretEnvVars) !== JSON.stringify(prevReferencedSecretEnvVars);
  getOpenClawEngineManager().setSecretEnvVars(nextSecretEnvVars);

  const needsRestart = secretEnvVarsChanged || (syncResult.changed && !!options.restartGatewayIfRunning);

  if (!needsRestart) {
    return {
      success: true,
      changed: syncResult.changed,
    };
  }

  const manager = getOpenClawEngineManager();
  const status = manager.getStatus();
  if (status.phase !== 'running') {
    return {
      success: true,
      changed: true,
      status,
    };
  }

  if (hasActiveGatewayWorkloads()) {
    console.log(`[OpenClaw] syncOpenClawConfig: deferring hard restart because active workloads exist (reason: ${options.reason})`);
    scheduleDeferredHardGatewayRestart(options.reason);
    return {
      success: true,
      changed: true,
      status,
    };
  }

  // Tear down the runtime adapter's WebSocket client BEFORE killing the gateway process.
  // This prevents a race where the old client's async `onClose` fires after a new client
  // has already been created, destroying the new connection.
  if (openClawRuntimeAdapter) {
    console.log(`[OpenClaw] syncOpenClawConfig: pre-emptively disconnecting runtime adapter before gateway restart (reason: ${options.reason})`);
    openClawRuntimeAdapter.disconnectGatewayClient();
  }

  await manager.stopGateway();
  const restarted = await manager.startGateway(`config-sync:${options.reason}`);
  if (restarted.phase !== 'running') {
    return {
      success: false,
      changed: true,
      status: restarted,
      error: restarted.message || 'Failed to restart OpenClaw gateway after config sync.',
    };
  }
  return {
    success: true,
    changed: true,
    status: restarted,
  };
};

const getCoworkRunner = () => {
  if (!coworkRunner) {
    coworkRunner = new CoworkRunner(getCoworkStore());

    // Provide MCP server configuration to the runner
    coworkRunner.setMcpServerProvider(() => {
      return getMcpStore().getEnabledServers();
    });
    coworkRunner.setQingShuFilePublisher(async (filePath?: string) => {
      if (!publishQingShuFileHandler) {
        return { success: false, error: 'QingShu file publisher is not initialized' };
      }
      return publishQingShuFileHandler(filePath);
    });
  }
  return coworkRunner;
};

const broadcastCoworkSessionsChanged = (): void => {
  const windows = BrowserWindow.getAllWindows();
  windows.forEach((win) => {
    if (win.isDestroyed()) return;
    try {
      win.webContents.send('cowork:sessions:changed');
    } catch (error) {
      console.error('Failed to broadcast cowork sessions changed:', error);
    }
  });
};

const bindCoworkRuntimeForwarder = (): void => {
  if (coworkRuntimeForwarderBound) return;
  const runtime = getCoworkEngineRouter();

  runtime.on('message', (sessionId: string, message: CoworkMessage) => {
    const safeMessage = sanitizeCoworkMessageForIpc(message);
    const windows = BrowserWindow.getAllWindows();
    console.log('[CoworkForwarder] forwarding message: sessionId=', sessionId, 'type=', message?.type, 'windowCount=', windows.length);
    if (message?.type === 'assistant') {
      emitPetRuntimeState?.(PetStatus.Running);
    }
    windows.forEach((win) => {
      if (win.isDestroyed()) return;
      try {
        win.webContents.send('cowork:stream:message', { sessionId, message: safeMessage });
      } catch (error) {
        console.error('Failed to forward cowork message:', error);
      }
    });
    broadcastCoworkSessionsChanged();
  });

  runtime.on('messageUpdate', (
    sessionId: string,
    messageId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ) => {
    const safeContent = truncateIpcString(content, IPC_UPDATE_CONTENT_MAX_CHARS);
    const safeMetadata = metadata && typeof metadata === 'object'
      ? sanitizeCoworkMessageForIpc({
        id: messageId,
        type: 'assistant',
        content: '',
        timestamp: Date.now(),
        metadata,
      }).metadata
      : undefined;
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
      if (win.isDestroyed()) return;
      try {
        win.webContents.send('cowork:stream:messageUpdate', {
          sessionId,
          messageId,
          content: safeContent,
          ...(safeMetadata ? { metadata: safeMetadata } : {}),
        });
      } catch (error) {
        console.error('Failed to forward cowork message update:', error);
      }
    });
  });

  runtime.on('permissionRequest', (sessionId: string, request: PermissionRequest) => {
    if (runtime.getSessionConfirmationMode(sessionId) === 'text') {
      return;
    }
    emitPetRuntimeState?.(PetStatus.Waiting);
    const safeRequest = sanitizePermissionRequestForIpc(request);
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
      if (win.isDestroyed()) return;
      try {
        win.webContents.send('cowork:stream:permission', { sessionId, request: safeRequest });
      } catch (error) {
        console.error('Failed to forward cowork permission request:', error);
      }
    });
  });

  runtime.on('complete', (sessionId: string, claudeSessionId: string | null) => {
    emitPetRuntimeState?.(PetStatus.Review);
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
      if (win.isDestroyed()) return;
      win.webContents.send('cowork:stream:complete', { sessionId, claudeSessionId });
    });
    broadcastCoworkSessionsChanged();
    const followUpDecision = resolveSpeechFollowUpTriggerForCompletedSession(sessionId);
    console.log(
      `[SpeechFollowUp] Session ${sessionId} completed; armed=${speechFollowUpState.armed}, ` +
        `armed session=${speechFollowUpState.armedSessionId ?? 'none'}, active session=${speechFollowUpState.activeSessionId ?? 'none'}, ` +
        `trigger=${Boolean(followUpDecision.request)}, reason=${followUpDecision.reason}.`
    );
    if (followUpDecision.request) {
      disarmSpeechFollowUp(`session ${sessionId} finished`);
      assistantSpeechGuard?.scheduleFollowUp(followUpDecision.request);
    }
    // If this session used a server model, notify renderer to refresh quota.
    try {
      if (shouldRefreshServerQuotaForSession(sessionId)) {
        const windows = BrowserWindow.getAllWindows();
        windows.forEach((win) => {
          if (win.isDestroyed()) return;
          win.webContents.send('auth:quotaChanged');
        });
      }
    } catch {
      // ignore
    }
  });

  runtime.on('error', (sessionId: string, error: string) => {
    emitPetRuntimeState?.(PetStatus.Failed);
    // Mark session as error in store so the .catch() fallback can detect duplicates.
    try { getCoworkStore().updateSession(sessionId, { status: 'error' }); } catch { /* ignore */ }
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
      if (win.isDestroyed()) return;
      win.webContents.send('cowork:stream:error', { sessionId, error });
    });
    broadcastCoworkSessionsChanged();
    if (speechFollowUpState.armed) {
      console.warn(`[SpeechFollowUp] Session ${sessionId} failed; canceling follow-up dictation.`);
      disarmSpeechFollowUp(`session ${sessionId} failed`);
    }
    assistantSpeechGuard?.clearPendingFollowUp();
  });

  coworkRuntimeForwarderBound = true;
};

const getCoworkEngineRouter = () => {
  if (!coworkEngineRouter) {
    if (!claudeRuntimeAdapter) {
      claudeRuntimeAdapter = new ClaudeRuntimeAdapter(getCoworkRunner());
    }
    if (!openClawRuntimeAdapter) {
      openClawRuntimeAdapter = new OpenClawRuntimeAdapter(getCoworkStore(), getOpenClawEngineManager(), {
        normalizeModelRef: normalizeOpenClawModelRef,
      }, getSubagentRunStore(), getSubagentMessageStore());
      // Wire up channel session sync for IM conversations via OpenClaw
      try {
        const imManager = getIMGatewayManager();
        const imStore = imManager.getIMStore();
        if (imStore) {
          const channelSessionSync = new OpenClawChannelSessionSync({
            coworkStore: getCoworkStore(),
            imStore,
            getDefaultCwd: (agentId?: string) => resolveAgentDefaultWorkingDirectory(agentId) || os.homedir(),
            resolveJobName: (jobId) => getCronJobService().getJobNameSync(jobId),
          });
          openClawRuntimeAdapter.setChannelSessionSync(channelSessionSync);
        }
      } catch (error) {
        console.warn('[Main] Failed to set up channel session sync:', error);
      }
    }
    coworkEngineRouter = new CoworkEngineRouter({
      getCurrentEngine: resolveCoworkAgentEngine,
      openclawRuntime: openClawRuntimeAdapter,
      claudeRuntime: claudeRuntimeAdapter,
    });
  }
  return coworkEngineRouter;
};

const getSkillManager = () => {
  if (!skillManager) {
    skillManager = new SkillManager(getStore);
  }
  return skillManager;
};

const getMcpStore = () => {
  if (!mcpStore) {
    const sqliteStore = getStore();
    mcpStore = new McpStore(sqliteStore.getNativeDatabase());
  }
  return mcpStore;
};

const getPluginManager = (): PluginManager => {
  if (!pluginManager) {
    pluginManager = new PluginManager(getCoworkStore());
  }
  return pluginManager;
};

/**
 * Start the AskUser HTTP callback server for the ask-user-question plugin.
 * MCP tools are configured through OpenClaw native `mcp.servers`.
 */
const startAskUserServer = async (): Promise<void> => {
  if (!mcpBridgeServer) {
    mcpBridgeServer = new McpBridgeServer(mcpBridgeSecret);
  }
  if (!mcpBridgeServer.port) {
    console.log('[AskUser] starting HTTP callback server...');
    await mcpBridgeServer.start();
  }

  mcpBridgeServer.onAskUser((request) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
      if (win.isDestroyed()) return;
      try {
        win.webContents.send('cowork:stream:permission', {
          sessionId: '__askuser__',
          request: {
            requestId: request.requestId,
            toolName: 'AskUserQuestion',
            toolInput: { questions: request.questions },
          },
        });
      } catch (error) {
        console.error('[AskUser] failed to send permission request to window:', error);
      }
    });
  });

  mcpBridgeServer.onAskUserDismiss((requestId) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
      if (win.isDestroyed()) return;
      try {
        win.webContents.send('cowork:stream:permissionDismiss', { requestId });
      } catch {
        // ignore
      }
    });
  });

  console.log(`[AskUser] started: askUserUrl=${mcpBridgeServer.askUserCallbackUrl}`);
};

const refreshMcpRuntimeConfig = (reason: string): void => {
  syncOpenClawConfig({ reason, restartGatewayIfRunning: false })
    .catch(err => console.error('[MCP] native config sync error:', err));
};

const getIMGatewayManager = (): IMGatewayManager => {
  if (!imGatewayManager) {
    const sqliteStore = getStore();

    // Get Cowork dependencies for IM Cowork mode
    const runtime = getCoworkEngineRouter();
    const store = getCoworkStore();

    imGatewayManager = new IMGatewayManager(
      sqliteStore.getNativeDatabase(),
      sqliteStore.getSaveFunction(),
      {
        coworkRuntime: runtime,
        coworkStore: store,
        ensureCoworkReady: async () => {
          if (resolveCoworkAgentEngine() !== 'openclaw') {
            return;
          }
          const status = await ensureOpenClawRunningForCowork();
          if (status.phase !== 'running') {
            throw new Error(status.message || 'AI engine is initializing. Please try again in a moment.');
          }
        },
        isOpenClawEngine: () => resolveCoworkAgentEngine() === 'openclaw',
        syncOpenClawConfig: async () => {
          await syncOpenClawConfig({
            reason: 'im-gateway-start',
            restartGatewayIfRunning: true,
          });
        },
        ensureOpenClawGatewayConnected: async () => {
          if (openClawRuntimeAdapter) {
            await openClawRuntimeAdapter.connectGatewayIfNeeded();
          }
        },
        getOpenClawGatewayClient: () => openClawRuntimeAdapter?.getGatewayClient() ?? null,
        ensureOpenClawGatewayReady: async () => {
          if (!openClawRuntimeAdapter) {
            throw new Error('OpenClaw runtime adapter not initialized.');
          }
          await openClawRuntimeAdapter.ensureReady();
          await openClawRuntimeAdapter.connectGatewayIfNeeded();
        },
        getOpenClawSessionKeysForCoworkSession: (sessionId: string) => {
          return openClawRuntimeAdapter?.getSessionKeysForSession(sessionId) ?? [];
        },
        createScheduledTask: async ({ sessionId, message, request }) => {
          // if (message.platform === 'dingtalk') {
          //   await getIMGatewayManager().primeConversationReplyRoute(
          //     message.platform,
          //     message.conversationId,
          //     sessionId,
          //   );
          // }
          const channelName = PlatformRegistry.channelOf(message.platform);
          const hasChannel = !!(channelName && message.conversationId);
          // Strip IM subtype prefix (e.g. "direct:ou_xxx" -> "ou_xxx")
          let deliveryTo = message.conversationId;
          if (hasChannel && deliveryTo) {
            const colonIdx = deliveryTo.indexOf(':');
            if (colonIdx > 0) {
              deliveryTo = deliveryTo.slice(colonIdx + 1);
            }
          }
          const agentId = resolveIMScheduledTaskAgentId(getCoworkStore(), sessionId);
          const task = await getCronJobService().addJob({
            name: request.taskName,
            description: '',
            enabled: true,
            schedule: {
              kind: 'at',
              at: request.scheduleAt,
            },
            sessionTarget: hasChannel ? 'isolated' : 'main',
            wakeMode: 'now',
            payload: hasChannel
              ? { kind: 'agentTurn', message: request.payloadText }
              : { kind: 'systemEvent', text: request.payloadText },
            delivery: {
              mode: hasChannel ? 'announce' : 'none',
              ...(channelName ? { channel: channelName } : {}),
              ...(hasChannel ? { to: deliveryTo } : message.conversationId ? { to: message.conversationId } : {}),
            },
            agentId,
            ...(hasChannel ? {} : { sessionKey: buildManagedSessionKey(sessionId, agentId) }),
          });
          return {
            id: task.id,
            name: task.name,
            agentId: task.agentId,
            sessionKey: task.sessionKey,
            payloadText: task.payload.kind === 'systemEvent'
              ? task.payload.text
              : task.payload.kind === 'agentTurn'
                ? task.payload.message
                : '',
            scheduleAt: task.schedule.kind === 'at' ? task.schedule.at : request.scheduleAt,
          };
        },
      }
    );

    // Initialize with LLM config provider
    imGatewayManager.initialize({
      getLLMConfig: async (): Promise<IMLLMConfig | null> => {
        const appConfig = sqliteStore.get<IMAppConfigSnapshot>('app_config');
        if (!appConfig) return null;

        // Find first enabled provider
        const providers = appConfig.providers || {};
        for (const [providerName, providerConfig] of Object.entries(providers)) {
          if (providerConfig.enabled && providerConfig.apiKey) {
            const model = providerConfig.models?.[0]?.id;
            return {
              apiKey: providerConfig.apiKey,
              baseUrl: providerConfig.baseUrl,
              model: model,
              provider: providerName,
            };
          }
        }

        // Fallback to legacy api config
        if (appConfig.api?.key) {
          return {
            apiKey: appConfig.api.key,
            baseUrl: appConfig.api.baseUrl,
            model: appConfig.model?.defaultModel,
          };
        }

        return null;
      },
      getSkillsPrompt: async () => {
        return getSkillManager().buildAutoRoutingPrompt();
      },
    });

    // Forward IM events to renderer
    imGatewayManager.on('statusChange', (status) => {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('im:status:change', status);
        }
      });
    });

    imGatewayManager.on('message', (message) => {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('im:message:received', message);
        }
      });
    });

    imGatewayManager.on('error', ({ platform, error }) => {
      console.error(`[IM Gateway] ${platform} error:`, error);
    });
  }
  return imGatewayManager;
};

function mergeCoworkSystemPrompt(
  engine: CoworkAgentEngine,
  systemPrompt?: string,
): string | undefined {
  const sections = [
    buildScheduledTaskEnginePrompt(engine),
    QINGSHU_FILE_PUBLISH_PROMPT,
    systemPrompt?.trim() || '',
  ].filter(Boolean);
  return sections.length > 0 ? sections.join('\n\n') : undefined;
}

function buildCoworkSessionAgentContext(options: {
  engine: CoworkAgentEngine;
  agentId?: string;
  systemPrompt?: string;
  skillIds?: string[];
}): { systemPrompt?: string; skillIds: string[] } {
  const agentId = options.agentId?.trim() || 'main';
  const agent = getAgentManager().getAgent(agentId);
  const baseSystemPrompt = mergeCoworkSystemPrompt(options.engine, options.systemPrompt);
  return {
    systemPrompt: mergeAgentInstructionPrompt(baseSystemPrompt, agent),
    skillIds: mergeAgentSkillIds(options.skillIds, agent),
  };
}

const resolveExistingPath = (candidates: string[]): string => {
  const matched = candidates.find((candidate) => fs.existsSync(candidate));
  return matched || candidates[0];
};

// 获取正确的预加载脚本路径
const PRELOAD_PATH = app.isPackaged
  ? resolveExistingPath([
      path.join(__dirname, 'preload.js'),
      path.join(__dirname, 'main', 'preload.js'),
    ])
  : resolveExistingPath([
      path.join(__dirname, '../dist-electron/preload.js'),
      path.join(__dirname, '../dist-electron/main/preload.js'),
      path.join(__dirname, 'preload.js'),
    ]);

// 获取应用图标路径（Windows 使用 .ico，其他平台使用 .png）
const getAppIconPath = (): string | undefined => {
  if (process.platform !== 'win32' && process.platform !== 'linux') return undefined;
  const basePath = app.isPackaged
    ? path.join(process.resourcesPath, 'tray')
    : path.join(__dirname, '..', 'resources', 'tray');
  return process.platform === 'win32'
    ? path.join(basePath, 'tray-icon.ico')
    : path.join(basePath, 'tray-icon.png');
};

// 保存对主窗口的引用
let mainWindow: BrowserWindow | null = null;
let authWindow: BrowserWindow | null = null;
const macSpeechService = new MacSpeechService();
let petConfigStore: PetConfigStore | null = null;
let petStore: PetStore | null = null;
let petWindowController: PetWindowController | null = null;
let emitPetRuntimeState: ((status?: PetStatus) => unknown) | null = null;

let isQuitting = false;

// 存储活跃的流式请求控制器
const activeStreamControllers = new Map<string, AbortController>();
let lastReloadAt = 0;
const MIN_RELOAD_INTERVAL_MS = 5000;
let windowStateSaveTimer: ReturnType<typeof setTimeout> | null = null;
const WINDOW_STATE_SAVE_DEBOUNCE_MS = 300;

type AppConfigSettings = {
  theme?: string;
  language?: string;
  useSystemProxy?: boolean;
  auth?: Partial<AuthConfig>;
  qingshuModules?: Record<string, QingShuModuleFlagConfig | undefined>;
  pet?: unknown;
  speechInput?: {
    stopCommand?: string;
    submitCommand?: string;
    autoRestartAfterReply?: boolean;
  };
  wakeInput?: Partial<WakeInputConfig>;
  tts?: {
    enabled?: boolean;
    autoPlayAssistantReply?: boolean;
    engine?: TtsEngine;
    voiceId?: string;
    rate?: number;
    volume?: number;
  };
};

const DEFAULT_SPEECH_INPUT_CONFIG = {
  stopCommand: '停止输入',
  submitCommand: '结束发送',
  autoRestartAfterReply: false,
} as const;

const DEFAULT_WAKE_INPUT_CONFIG: WakeInputConfig = {
  enabled: false,
  wakeWords: ['打开青书爪'],
  submitCommand: '发送',
  cancelCommand: '取消',
  sessionTimeoutMs: 20_000,
  autoRestartAfterReply: false,
  activationReplyEnabled: false,
  activationReplyText: '在的',
};
type MainTtsConfig = {
  enabled: boolean;
  autoPlayAssistantReply: boolean;
  engine: TtsEngine;
  voiceId: string;
  rate: number;
  volume: number;
};

const DEFAULT_TTS_CONFIG: MainTtsConfig = {
  enabled: true,
  autoPlayAssistantReply: false,
  engine: TtsEngine.MacOsNative,
  voiceId: '',
  rate: 0.5,
  volume: 1,
};
const FOREGROUND_SPEECH_RETRY_DELAY_MS = 180;

const normalizeWakeWords = (wakeWords?: unknown): string[] => {
  if (!Array.isArray(wakeWords)) {
    return [...DEFAULT_WAKE_INPUT_CONFIG.wakeWords];
  }

  const normalizedWakeWords = wakeWords
    .map((wakeWord) => typeof wakeWord === 'string' ? wakeWord.trim() : '')
    .filter((wakeWord, index, items) => Boolean(wakeWord) && items.indexOf(wakeWord) === index);

  return normalizedWakeWords.length > 0
    ? normalizedWakeWords
    : [...DEFAULT_WAKE_INPUT_CONFIG.wakeWords];
};

const mergeWakeInputConfig = (
  config?: Partial<WakeInputConfig> & { wakeWord?: string }
): WakeInputConfig => {
  const legacyWakeWord = typeof config?.wakeWord === 'string' ? config.wakeWord.trim() : '';

  return {
    ...DEFAULT_WAKE_INPUT_CONFIG,
    ...(config ?? {}),
    wakeWords: normalizeWakeWords(
      Array.isArray(config?.wakeWords)
        ? config?.wakeWords
        : legacyWakeWord
          ? [legacyWakeWord]
          : DEFAULT_WAKE_INPUT_CONFIG.wakeWords
    ),
  };
};

const mergeTtsConfig = (
  config?: AppConfigSettings['tts']
): MainTtsConfig => ({
  ...DEFAULT_TTS_CONFIG,
  ...(config ?? {}),
  engine: Object.values(TtsEngine).includes(config?.engine as TtsEngine)
    ? (config?.engine as TtsEngine)
    : DEFAULT_TTS_CONFIG.engine,
});

let foregroundSpeechOrigin: ForegroundSpeechOrigin | null = null;
let foregroundSpeechStartOptions: SpeechStartOptions | null = null;
let foregroundSpeechRecoveryAttempts = 0;
let foregroundSpeechRecoveryTimer: NodeJS.Timeout | null = null;
let assistantSpeechGuard: AssistantSpeechGuard | null = null;

const clearForegroundSpeechRecoveryTimer = (): void => {
  if (foregroundSpeechRecoveryTimer) {
    clearTimeout(foregroundSpeechRecoveryTimer);
    foregroundSpeechRecoveryTimer = null;
  }
};

const normalizeForegroundSpeechOrigin = (options?: SpeechStartOptions): ForegroundSpeechOrigin | undefined => {
  if (options?.source === SpeechStartSource.Wake) {
    return 'wake';
  }
  if (options?.source === SpeechStartSource.FollowUp) {
    return 'follow_up';
  }
  if (options?.source === SpeechStartSource.Manual) {
    return 'manual';
  }
  return undefined;
};

const resetForegroundSpeechRecoveryState = (): void => {
  clearForegroundSpeechRecoveryTimer();
  foregroundSpeechRecoveryAttempts = 0;
  foregroundSpeechStartOptions = null;
};

const stopForegroundSpeechIfActive = async (reason: string): Promise<void> => {
  if (!foregroundSpeechOrigin) {
    return;
  }

  const activeOrigin = foregroundSpeechOrigin;
  console.log(`[SpeechFollowUp] Stopping foreground speech because ${reason}.`);
  foregroundSpeechOrigin = null;
  resetForegroundSpeechRecoveryState();
  wakeInputService.handleForegroundSpeechEnded(activeOrigin);
  await macSpeechService.stop();
};

type SpeechFollowUpState = {
  armed: boolean;
  armedSessionId: string | null;
  activeSessionId: string | null;
  config: WakeInputDictationRequest | null;
};

const speechFollowUpState: SpeechFollowUpState = {
  armed: false,
  armedSessionId: null,
  activeSessionId: null,
  config: null,
};

const isTempSessionId = (sessionId: string | null): boolean => {
  return Boolean(sessionId && sessionId.startsWith('temp-'));
};

const disarmSpeechFollowUp = (reason: string): void => {
  if (!speechFollowUpState.armed && !speechFollowUpState.config) {
    assistantSpeechGuard?.clearPendingFollowUp();
    return;
  }
  console.log(`[SpeechFollowUp] Disarmed follow-up dictation because ${reason}.`);
  speechFollowUpState.armed = false;
  speechFollowUpState.armedSessionId = null;
  speechFollowUpState.config = null;
  assistantSpeechGuard?.clearPendingFollowUp();
};

const armSpeechFollowUp = (payload: SpeechFollowUpArmRequest): void => {
  speechFollowUpState.armed = Boolean(payload.config?.autoRestartAfterReply);
  speechFollowUpState.armedSessionId = payload.sessionId;
  speechFollowUpState.config = payload.config;
  if (!speechFollowUpState.armed) {
    console.log('[SpeechFollowUp] Ignored arm request because auto restart is disabled.');
    speechFollowUpState.armedSessionId = null;
    speechFollowUpState.config = null;
    return;
  }
  console.log(
    `[SpeechFollowUp] Armed follow-up dictation for session ${payload.sessionId ?? 'pending-session'} ` +
      `while active session is ${speechFollowUpState.activeSessionId ?? 'none'}.`
  );
};

const setSpeechFollowUpActiveSession = (payload: SpeechFollowUpActiveSessionRequest): void => {
  const previousActiveSessionId = speechFollowUpState.activeSessionId;
  speechFollowUpState.activeSessionId = payload.sessionId;
  console.log(`[SpeechFollowUp] Active session updated to ${payload.sessionId ?? 'none'}.`);

  if (
    speechFollowUpState.armed
    && speechFollowUpState.config
    && (!speechFollowUpState.armedSessionId || isTempSessionId(speechFollowUpState.armedSessionId))
    && (!previousActiveSessionId || isTempSessionId(previousActiveSessionId))
    && payload.sessionId
  ) {
    speechFollowUpState.armedSessionId = payload.sessionId;
    console.log(`[SpeechFollowUp] Bound the armed follow-up to session ${payload.sessionId}.`);
  }
};

const shouldTriggerSpeechFollowUpForSession = (sessionId: string): boolean => {
  if (!speechFollowUpState.armed || !speechFollowUpState.config) {
    return false;
  }

  const { armedSessionId, activeSessionId } = speechFollowUpState;
  if (armedSessionId === sessionId) {
    return true;
  }
  if (!armedSessionId) {
    return activeSessionId === sessionId || activeSessionId === null;
  }
  if (isTempSessionId(armedSessionId)) {
    return activeSessionId === sessionId;
  }
  return false;
};

const resolveSpeechFollowUpRequestFromAppConfig = (
  config?: AppConfigSettings
): WakeInputDictationRequest | null => {
  const speechInputConfig = {
    ...DEFAULT_SPEECH_INPUT_CONFIG,
    ...(config?.speechInput ?? {}),
  };
  if (!speechInputConfig.autoRestartAfterReply) {
    return null;
  }

  const wakeInputConfig = mergeWakeInputConfig(config?.wakeInput);
  const shouldPreferWakeCommands = wakeInputConfig.enabled;

  return {
    submitCommand: shouldPreferWakeCommands ? wakeInputConfig.submitCommand : speechInputConfig.submitCommand,
    cancelCommand: shouldPreferWakeCommands ? wakeInputConfig.cancelCommand : speechInputConfig.stopCommand,
    sessionTimeoutMs: wakeInputConfig.sessionTimeoutMs,
    autoRestartAfterReply: true,
    source: 'follow_up',
  };
};

const armSpeechFollowUpFromAppConfig = (sessionId: string, reason: string): void => {
  const config = getStore().get<AppConfigSettings>('app_config');
  const request = resolveSpeechFollowUpRequestFromAppConfig(config);
  if (!request) {
    console.log(`[SpeechFollowUp] Skipped auto-arm for session ${sessionId} because follow-up is disabled (${reason}).`);
    return;
  }

  armSpeechFollowUp({
    sessionId,
    config: request,
  });
  console.log(`[SpeechFollowUp] Auto-armed follow-up dictation from app config for session ${sessionId} (${reason}).`);
};

const resolveSpeechFollowUpTriggerForCompletedSession = (
  sessionId: string
): { request: WakeInputDictationRequest | null; reason: string } => {
  if (speechFollowUpState.armed && speechFollowUpState.config) {
    const shouldTrigger = shouldTriggerSpeechFollowUpForSession(sessionId);
    if (!shouldTrigger) {
      return { request: null, reason: 'armed state did not match the completed session' };
    }
    return { request: speechFollowUpState.config, reason: 'armed follow-up matched' };
  }

  const config = getStore().get<AppConfigSettings>('app_config');
  const fallbackRequest = resolveSpeechFollowUpRequestFromAppConfig(config);
  if (!fallbackRequest) {
    return { request: null, reason: 'follow-up is disabled in app config' };
  }
  if (speechFollowUpState.activeSessionId !== sessionId) {
    return {
      request: null,
      reason: `completed session ${sessionId} is not the active session ${speechFollowUpState.activeSessionId ?? 'none'}`,
    };
  }
  return { request: fallbackRequest, reason: 'app config fallback matched the active session' };
};

const isMacSpeechInputEnabled = (): boolean => {
  const envOverride = process.env.LOBSTERAI_ENABLE_MAC_SPEECH_INPUT?.trim().toLowerCase();
  if (envOverride === '0' || envOverride === 'false') {
    return false;
  }
  if (envOverride === '1' || envOverride === 'true') {
    return true;
  }
  return getStore().get<boolean>(SpeechFeatureFlagKey.MacInputEnabled) !== false;
};

const syncWakeInputAvailabilityFromSpeech = async (): Promise<void> => {
  const speechAvailability = isMacSpeechInputEnabled()
    ? await macSpeechService.getAvailability()
    : {
        supported: false,
        permission: SpeechPermissionStatus.Unsupported,
        error: SpeechErrorCode.HelperUnavailable,
      };

  await wakeInputService.syncAvailability({
    supported: Boolean(speechAvailability.supported) && speechAvailability.permission === SpeechPermissionStatus.Granted,
    error: speechAvailability.error,
  });
};

const wakeInputService = new WakeInputService({
  config: DEFAULT_WAKE_INPUT_CONFIG,
  platform: process.platform,
  startListening: async () => {
    if (!isMacSpeechInputEnabled()) {
      return { success: false, error: SpeechErrorCode.HelperUnavailable };
    }
    return macSpeechService.start();
  },
  stopListening: async () => {
    return macSpeechService.stop();
  },
  shouldSuppressTriggering: () => assistantSpeechGuard?.isAssistantReplyActive() ?? false,
});
const macTtsService = new MacTtsService();
const edgeTtsService = new EdgeTtsService();
let cachedTtsConfig = mergeTtsConfig();
const ttsRouterService = new TtsRouterService(
  macTtsService,
  edgeTtsService,
  () => cachedTtsConfig,
);

const getWakeActivationReplyConfig = (): { enabled: boolean; text: string } => {
  const wakeInputConfig = mergeWakeInputConfig(getStore().get<AppConfigSettings>('app_config')?.wakeInput);
  return {
    enabled: wakeInputConfig.activationReplyEnabled,
    text: wakeInputConfig.activationReplyText.trim(),
  };
};

const showMainWindow = (): void => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (process.platform === 'darwin') {
    const macApp = app as Electron.App & {
      show?: () => void;
      isHidden?: () => boolean;
    };
    try {
      app.focus({ steal: true });
      if (typeof macApp.isHidden === 'function' && macApp.isHidden() && typeof macApp.show === 'function') {
        macApp.show();
      }
      app.dock?.show();
    } catch (error) {
      console.warn('[WakeInput] Failed to activate the macOS app before showing the main window:', error);
    }
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.moveTop();
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  if (!mainWindow.isFocused()) {
    mainWindow.focus();
  }
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.setAlwaysOnTop(false);
  }, 800);
};

const focusCoworkInputInMainWindow = (options?: { clear?: boolean }): void => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('app:focusCoworkInput', { clear: options?.clear === true });
};

const dispatchWakeDictationRequest = (request: WakeInputDictationRequest): void => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(WakeInputIpcChannel.DictationRequested, request);
  }
};

const maybeSpeakWakeActivationReply = async (): Promise<void> => {
  const ttsConfig = mergeTtsConfig(getStore().get<AppConfigSettings>('app_config')?.tts);
  const wakeReplyConfig = getWakeActivationReplyConfig();
  if (!ttsConfig.enabled || !wakeReplyConfig.enabled || !wakeReplyConfig.text) {
    return;
  }

  await ttsRouterService.stop();
  const replyResult = await ttsRouterService.speak(
    {
      text: wakeReplyConfig.text,
      voiceId: ttsConfig.voiceId,
      rate: ttsConfig.rate,
      volume: ttsConfig.volume,
      source: TtsPlaybackSource.WakeActivation,
    },
    {
      allowPrepare: false,
    },
  );
  if (!replyResult.success) {
    console.warn(
      '[WakeInput] Failed to play wake activation reply, continuing with dictation.',
      JSON.stringify({ error: replyResult.error }),
    );
  }
};

const prewarmWakeActivationReplyCache = (config?: AppConfigSettings): void => {
  const ttsConfig = mergeTtsConfig(config?.tts);
  const wakeInputConfig = mergeWakeInputConfig(config?.wakeInput);
  const wakeReplyText = wakeInputConfig.activationReplyText.trim();
  if (
    !ttsConfig.enabled
    || ttsConfig.engine !== TtsEngine.EdgeTts
    || !wakeInputConfig.activationReplyEnabled
    || !wakeReplyText
  ) {
    return;
  }

  void edgeTtsService.prewarmWakeActivationCache(
    {
      text: wakeReplyText,
      voiceId: ttsConfig.voiceId,
      rate: ttsConfig.rate,
      volume: ttsConfig.volume,
      source: TtsPlaybackSource.WakeActivation,
    },
    {
      allowPrepare: true,
    },
  ).then((result) => {
    if (!result.success) {
      console.warn(
        '[WakeInput] Failed to prewarm wake activation reply cache.',
        JSON.stringify({ error: result.error }),
      );
      return;
    }
    if (result.cacheHit) {
      console.log('[WakeInput] Wake activation reply cache already warm.');
      return;
    }
    console.log('[WakeInput] Wake activation reply cache warmed successfully.');
  }).catch((error) => {
    console.warn('[WakeInput] Wake activation reply cache warmup crashed:', error);
  });
};

const triggerSpeechFollowUpDictation = (request: WakeInputDictationRequest): void => {
  console.log('[SpeechFollowUp] Triggering follow-up dictation restart.');
  void ttsRouterService.stop();
  showMainWindow();
  focusCoworkInputInMainWindow({ clear: false });
  dispatchWakeDictationRequest({
    ...request,
    source: 'follow_up',
  } satisfies WakeInputDictationRequest);
};

assistantSpeechGuard = new AssistantSpeechGuard((request) => {
  console.log('[SpeechFollowUp] Releasing queued follow-up dictation after assistant playback guard.');
  triggerSpeechFollowUpDictation(request);
});

wakeInputService.on('stateChanged', (status) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(WakeInputIpcChannel.StateChanged, status);
    }
  }
});

wakeInputService.on('dictationRequested', (request) => {
  console.log('[WakeInput] Wake phrase matched, requesting dictation and showing the main window.');
  showMainWindow();
  focusCoworkInputInMainWindow({ clear: false });
  if (request.source === 'wake') {
    void maybeSpeakWakeActivationReply();
  }
  dispatchWakeDictationRequest(request);
});

macSpeechService.onStateChanged((event) => {
  if (wakeInputService.isBackgroundModeActive()) {
    void wakeInputService.handleSpeechState(event);
    return;
  }

  if (foregroundSpeechOrigin) {
    if (
      event.type === SpeechStateType.Error
      && shouldRetryForegroundSpeech(foregroundSpeechOrigin, foregroundSpeechRecoveryAttempts, event.code)
    ) {
      const retryOrigin = foregroundSpeechOrigin;
      const retryOptions: SpeechStartOptions = {
        ...(foregroundSpeechStartOptions ?? {}),
        source: retryOrigin === 'follow_up' ? SpeechStartSource.FollowUp : retryOrigin,
      };
      foregroundSpeechRecoveryAttempts += 1;
      clearForegroundSpeechRecoveryTimer();
      console.warn(
        `[MacSpeechService] Recoverable speech interruption detected for ${retryOrigin}; ` +
          `retrying in ${resolveForegroundSpeechRetryDelayMs(retryOrigin)}ms.`,
        JSON.stringify({ code: event.code, message: event.message }),
      );
      foregroundSpeechRecoveryTimer = setTimeout(() => {
        foregroundSpeechRecoveryTimer = null;
        void macSpeechService.start(retryOptions).then(async (result) => {
          if (result.success) {
            await wakeInputService.syncAvailability({ supported: true });
            console.log(`[MacSpeechService] Foreground speech recovered for ${retryOrigin}.`);
            return;
          }

          console.warn(
            `[MacSpeechService] Foreground speech recovery failed for ${retryOrigin}.`,
            JSON.stringify({ error: result.error }),
          );
          const failedOrigin = foregroundSpeechOrigin;
          resetForegroundSpeechRecoveryState();
          foregroundSpeechOrigin = null;
          if (failedOrigin) {
            wakeInputService.handleForegroundSpeechEnded(failedOrigin);
          }
          broadcastSpeechState(BrowserWindow.getAllWindows(), SpeechIpcChannel.StateChanged, event);
        }).catch((error) => {
          console.error('[MacSpeechService] Foreground speech recovery threw an error:', error);
          const failedOrigin = foregroundSpeechOrigin;
          resetForegroundSpeechRecoveryState();
          foregroundSpeechOrigin = null;
          if (failedOrigin) {
            wakeInputService.handleForegroundSpeechEnded(failedOrigin);
          }
          broadcastSpeechState(BrowserWindow.getAllWindows(), SpeechIpcChannel.StateChanged, event);
        });
      }, resolveForegroundSpeechRetryDelayMs(retryOrigin));
      return;
    }

    broadcastSpeechState(BrowserWindow.getAllWindows(), SpeechIpcChannel.StateChanged, event);
    if (event.type === SpeechStateType.Stopped || event.type === SpeechStateType.Error) {
      const finishedOrigin = foregroundSpeechOrigin;
      foregroundSpeechOrigin = null;
      resetForegroundSpeechRecoveryState();
      wakeInputService.handleForegroundSpeechEnded(finishedOrigin);
    }
    return;
  }

  broadcastSpeechState(BrowserWindow.getAllWindows(), SpeechIpcChannel.StateChanged, event);
});

ttsRouterService.on('stateChanged', (event) => {
  if (event.type === TtsStateType.Speaking) {
    assistantSpeechGuard?.handleTtsStarted(event.source);
  }
  if (event.type === TtsStateType.Stopped || event.type === TtsStateType.Error) {
    assistantSpeechGuard?.handleTtsStopped(event.source);
  }
  broadcastTtsState(BrowserWindow.getAllWindows(), TtsIpcChannel.StateChanged, event);
});

const getUseSystemProxyFromConfig = (config?: { useSystemProxy?: boolean }): boolean => {
  return config?.useSystemProxy === true;
};

const resolveThemeFromConfig = (config?: AppConfigSettings): 'light' | 'dark' => {
  if (config?.theme === 'dark') {
    return 'dark';
  }
  if (config?.theme === 'light') {
    return 'light';
  }
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
};

const getInitialTheme = (): 'light' | 'dark' => {
  const config = getStore().get<AppConfigSettings>('app_config');
  return resolveThemeFromConfig(config);
};

const getTitleBarOverlayOptions = () => {
  const config = getStore().get<AppConfigSettings>('app_config');
  const theme = resolveThemeFromConfig(config);
  return {
    color: TITLEBAR_COLORS[theme].color,
    symbolColor: TITLEBAR_COLORS[theme].symbolColor,
    height: TITLEBAR_HEIGHT,
  };
};

const updateTitleBarOverlay = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!isMac && !isWindows) {
    mainWindow.setTitleBarOverlay(getTitleBarOverlayOptions());
  }
  // Also update the window background color to match the theme
  const config = getStore().get<AppConfigSettings>('app_config');
  const theme = resolveThemeFromConfig(config);
  mainWindow.setBackgroundColor(theme === 'dark' ? '#0F1117' : '#F8F9FB');
};

const applyProxyPreference = async (useSystemProxy: boolean): Promise<void> => {
  setSystemProxyEnabled(useSystemProxy);

  try {
    await session.defaultSession.setProxy({ mode: useSystemProxy ? 'system' : 'direct' });
  } catch (error) {
    console.error('[Main] Failed to apply session proxy mode:', error);
  }

  if (!useSystemProxy) {
    restoreOriginalProxyEnv();
    console.log('[Main] System proxy disabled (direct mode).');
    return;
  }

  const { proxyUrl, targetUrl } = await resolveSystemProxyUrlForTargets();
  applySystemProxyEnv(proxyUrl);

  if (proxyUrl) {
    console.log(`[Main] System proxy enabled for process env via ${targetUrl}:`, proxyUrl);
  } else {
    console.warn('[Main] System proxy mode enabled, but no proxy endpoint was resolved (DIRECT).');
  }
};

const emitWindowState = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send('window:state-changed', {
    isMaximized: mainWindow.isMaximized(),
    isFullscreen: mainWindow.isFullScreen(),
    isFocused: mainWindow.isFocused(),
  });
};

const getDisplayWorkAreas = (): WindowRectangle[] => {
  return screen.getAllDisplays().map((display) => display.workArea);
};

const getCurrentAppWindowState = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;

  const bounds = mainWindow.isFullScreen()
    ? mainWindow.getNormalBounds()
    : mainWindow.isMaximized()
      ? mainWindow.getNormalBounds()
      : mainWindow.getBounds();

  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized: mainWindow.isMaximized(),
  };
};

const persistAppWindowState = () => {
  const state = getCurrentAppWindowState();
  if (!state) return;
  getStore().set(AppWindowStoreKey.State, state);
};

const schedulePersistAppWindowState = () => {
  if (windowStateSaveTimer) {
    clearTimeout(windowStateSaveTimer);
  }

  windowStateSaveTimer = setTimeout(() => {
    windowStateSaveTimer = null;
    persistAppWindowState();
  }, WINDOW_STATE_SAVE_DEBOUNCE_MS);
};

const showSystemMenu = (position?: { x?: number; y?: number }) => {
  if (!isWindows) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const isMaximized = mainWindow.isMaximized();
  const menu = Menu.buildFromTemplate([
    { label: 'Restore', enabled: isMaximized, click: () => mainWindow.restore() },
    { role: 'minimize' },
    { label: 'Maximize', enabled: !isMaximized, click: () => mainWindow.maximize() },
    { type: 'separator' },
    { role: 'close' },
  ]);

  menu.popup({
    window: mainWindow,
    x: Math.max(0, Math.round(position?.x ?? 0)),
    y: Math.max(0, Math.round(position?.y ?? 0)),
  });
};

const scheduleReload = (reason: string, webContents?: WebContents) => {
  const target = webContents ?? mainWindow?.webContents;
  if (!target || target.isDestroyed()) {
    return;
  }
  const now = Date.now();
  if (now - lastReloadAt < MIN_RELOAD_INTERVAL_MS) {
    console.warn(`Skipping reload (${reason}); last reload was ${now - lastReloadAt}ms ago.`);
    return;
  }
  lastReloadAt = now;
  console.warn(`Reloading window due to ${reason}`);
  target.reloadIgnoringCache();
};


// 确保应用程序只有一个实例
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  // Register custom protocol for OAuth callback
  app.setAsDefaultProtocolClient('lobsterai');

  // Buffer for deep link auth code received before renderer is ready
  let pendingAuthCallback: AuthCallbackPayload | null = null;
  let pendingBridgeCode: { code: string } | null = null;

  /**
   * Parse a lobsterai:// deep link and send (or buffer) the auth callback payload.
   */
  const handleDeepLink = (url: string) => {
    try {
      const parsed = new URL(url);
      if (parsed.hostname === 'auth' && parsed.pathname === '/callback') {
        const code = parsed.searchParams.get('code');
        const state = parsed.searchParams.get('state') || undefined;
        if (code) {
          const payload = { code, ...(state ? { state } : {}) };
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('auth:callback', payload);
          } else {
            pendingAuthCallback = payload;
          }
        }
      } else if (parsed.hostname === 'auth' && parsed.pathname === '/bridge') {
        const code = parsed.searchParams.get('code');
        if (code) {
          const payload = { code };
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('auth:bridgeCode', payload);
          } else {
            pendingBridgeCode = payload;
          }
        }
      }
    } catch (e) {
      console.error('[Main] Failed to parse deep link:', e);
    }
  };

  ipcMain.on('log:fromRenderer', (_event, level: string, tag: string, message: string) => {
    const safeLevel = level === 'error' || level === 'warn' || level === 'info' ? level : 'info';
    const safeTag = typeof tag === 'string'
      ? tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'Renderer'
      : 'Renderer';
    const safeMessage = typeof message === 'string'
      ? message.slice(0, 1000)
      : String(message).slice(0, 1000);
    const log = safeLevel === 'error' ? console.error : safeLevel === 'warn' ? console.warn : console.log;
    log(`[Renderer][${safeTag}] ${safeMessage}`);
  });

  // Allow renderer to retrieve a buffered auth code on init
  ipcMain.handle('auth:getPendingCallback', () => {
    const callback = pendingAuthCallback;
    pendingAuthCallback = null;
    return callback;
  });

  ipcMain.handle('auth:getPendingBridgeCode', () => {
    const bridgeCode = pendingBridgeCode;
    pendingBridgeCode = null;
    return bridgeCode;
  });

  const clearPendingAuthState = () => {
    pendingAuthCallback = null;
    pendingBridgeCode = null;
    if (authWindow && !authWindow.isDestroyed()) {
      authWindow.close();
    }
    authWindow = null;
  };

  // macOS: handle open-url event for deep links
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  app.on('second-instance', (_event, commandLine, workingDirectory) => {
    console.debug('[Main] second-instance event', { commandLine, workingDirectory });

    // Check for deep link in command line args (Windows/Linux)
    const deepLink = commandLine.find(arg => arg.startsWith('lobsterai://'));
    if (deepLink) {
      handleDeepLink(deepLink);
    }

    // Focus main window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      if (!mainWindow.isFocused()) mainWindow.focus();
    }
  });

  // IPC 处理程序
  ipcMain.handle('store:get', (_event, key) => {
    return getStore().get(key);
  });

  ipcMain.handle('store:set', async (_event, key, value) => {
    const previousAppConfig = key === 'app_config'
      ? getStore().get<AppConfigSettings>('app_config')
      : undefined;
    getStore().set(key, value);
    if (key === 'app_config') {
      refreshEndpointsTestMode(getStore());
      const impactDecision = classifyAppConfigChange(previousAppConfig, value);
      const proxyChanged = impactDecision.reasons.includes(OpenClawConfigImpactReason.AppUseSystemProxy);
      const actionDecision = removeImpactDecisionReasons(impactDecision, [
        OpenClawConfigImpactReason.AppUseSystemProxy,
      ]);

      // System proxy changes are handled by the app_config watcher after the
      // OS-level env/proxy preference has been applied. Avoid a duplicate sync
      // here that would restart the gateway twice.
      if (proxyChanged && getOpenClawEngineManager().getStatus().phase === 'running') {
        return;
      }

      if (actionDecision.impact !== OpenClawConfigImpact.None) {
        const syncResult = await syncOpenClawConfig({
          reason: 'app-config-change',
          restartGatewayIfRunning: actionDecision.impact === OpenClawConfigImpact.Restart,
        });
        if (!syncResult.success) {
          console.error('[OpenClaw] Failed to sync config after app_config update:', syncResult.error);
        }
      }
    }
  });

  ipcMain.handle('store:remove', (_event, key) => {
    getStore().delete(key);
  });

  ipcMain.handle('enterprise:getConfig', async () => {
    try {
      return getStore().get('enterprise_config') ?? null;
    } catch {
      return null;
    }
  });

  // Network status change handler
  // Remove any existing listener first to avoid duplicate registrations
  ipcMain.removeAllListeners('network:status-change');
  ipcMain.on('network:status-change', (_event, status: 'online' | 'offline') => {
    console.log(`[Main] Network status changed: ${status}`);

    if (status === 'online' && imGatewayManager) {
      console.log('[Main] Network restored, reconnecting IM gateways...');
      imGatewayManager.reconnectAllDisconnected();
    }
  });

  // Log IPC handlers
  ipcMain.handle('log:getPath', () => {
    return getLogFilePath();
  });

  ipcMain.handle('log:openFolder', () => {
    const logPath = getLogFilePath();
    if (logPath) {
      shell.showItemInFolder(logPath);
    }
  });

  ipcMain.handle('log:exportZip', async (event) => {
    try {
      const ownerWindow = BrowserWindow.fromWebContents(event.sender);
      if (!ownerWindow || ownerWindow.isDestroyed()) {
        return { success: false, error: 'Window is not available' };
      }

      const saveOptions = {
        title: 'Export Logs',
        defaultPath: path.join(app.getPath('downloads'), buildLogExportFileName()),
        filters: [{ name: 'Zip Archive', extensions: ['zip'] }],
      };

      const saveResult = await dialog.showSaveDialog(ownerWindow, saveOptions);

      if (saveResult.canceled || !saveResult.filePath) {
        return { success: true, canceled: true };
      }

      const outputPath = ensureZipFileName(saveResult.filePath);
      const manager = getOpenClawEngineManager();
      const archiveResult = await exportLogsZip({
        outputPath,
        entries: [
          ...getRecentMainLogEntries(),
          { archiveName: 'cowork.log', filePath: getCoworkLogPath() },
          ...manager.getRecentGatewayLogEntries(),
          ...getRecentOpenClawDailyLogEntries(manager.getOpenClawDailyLogDir()),
          ...(process.platform === 'win32'
            ? [{ archiveName: 'install-timing.log', filePath: path.join(app.getPath('appData'), 'LobsterAI', 'install-timing.log') }]
            : []),
        ],
      });

      return {
        success: true,
        canceled: false,
        path: outputPath,
        missingEntries: archiveResult.missingEntries,
      };
    } catch (error) {
      console.error('[LogExport] export failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to export logs',
      };
    }
  });

  // Auto-launch IPC handlers
  // Use SQLite store as the source of truth for UI state, because
  // app.getLoginItemSettings() returns unreliable values on macOS and
  // requires matching args on Windows.
  ipcMain.handle('app:getAutoLaunch', () => {
    const stored = getStore().get<boolean>('auto_launch_enabled');
    // Fall back to OS API if SQLite has no record yet (e.g. upgraded from older version)
    const enabled = stored ?? getAutoLaunchEnabled();
    return { enabled };
  });

  ipcMain.handle('app:setAutoLaunch', (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') {
      return { success: false, error: 'Invalid parameter: enabled must be boolean' };
    }
    try {
      setAutoLaunchEnabled(enabled);
      getStore().set('auto_launch_enabled', enabled);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set auto-launch',
      };
    }
  });

  ipcMain.handle('app:getPreventSleep', () => {
    const enabled = getStore().get<boolean>('prevent_sleep_enabled') ?? false;
    return { enabled };
  });

  ipcMain.handle('app:setPreventSleep', (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') {
      return { success: false, error: 'Invalid parameter: enabled must be boolean' };
    }
    try {
      setPreventSleepBlockerEnabled(enabled);
      getStore().set('prevent_sleep_enabled', enabled);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set prevent-sleep',
      };
    }
  });

  // Window control IPC handlers
  ipcMain.on('window-minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.on('window-close', () => {
    mainWindow?.close();
  });

  ipcMain.handle('window:isMaximized', () => {
    return mainWindow?.isMaximized() ?? false;
  });

  ipcMain.on('window:showSystemMenu', (_event, position: { x?: number; y?: number } | undefined) => {
    showSystemMenu(position);
  });

  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('app:getSystemLocale', () => app.getLocale());
  ipcMain.handle('app:relaunch', () => {
    console.log('[Main] app:relaunch requested, scheduling restart.');
    app.relaunch();
    app.quit();
  });

  // ── Auth IPC handlers ──

  /**
   * Helper: Persist auth tokens into the kv store.
   */
  const saveAuthTokens = (accessToken: string, refreshToken: string) => {
    getStore().set('auth_tokens', { accessToken, refreshToken });
  };

  const getAuthTokens = (): { accessToken: string; refreshToken: string } | null => {
    return getStore().get<{ accessToken: string; refreshToken: string }>('auth_tokens') || null;
  };

  const getOrCreateInstallationUuid = (): string => {
    const existing = getStore().get<string>('installation_uuid');
    if (typeof existing === 'string' && existing.trim()) {
      return existing.trim();
    }
    const next = crypto.randomUUID();
    getStore().set('installation_uuid', next);
    return next;
  };

  const resolveAuthUserIdForInvocation = (): string | null => {
    try {
      const tokens = getAuthTokens();
      if (!tokens?.accessToken) return null;
      const payload = JSON.parse(Buffer.from(tokens.accessToken.split('.')[1], 'base64').toString()) as Record<string, unknown>;
      const userId = payload.token_user_id ?? payload.userId ?? payload.user_id ?? payload.sub;
      return userId == null ? null : String(userId).trim() || null;
    } catch {
      return null;
    }
  };

  const clearAuthTokens = () => {
    getStore().delete('auth_tokens');
  };

  const clearLocalAuthSession = (reason: string) => {
    clearAuthTokens();
    clearServerModelMetadata();
    clearPendingAuthState();
    console.warn(`[Auth] Cleared the local auth session, reason=${reason}`);
    refreshQingShuManagedMcpRuntimeConfig('auth-session-invalidated');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('auth:sessionInvalidated', { reason });
    }
  };

  /**
   * Normalize quota data from various server response formats into a unified shape.
   */
  const normalizeQuota = (raw: Record<string, unknown>) => {
    let creditsLimit = 0;
    let creditsUsed = 0;
    let planName = t('authPlanFree');
    let subscriptionStatus = 'free';

    if (typeof raw.freeCreditsTotal === 'number') {
      // Free user format from /api/user/quota
      creditsLimit = raw.freeCreditsTotal as number;
      creditsUsed = (raw.freeCreditsUsed as number) || 0;
      planName = (raw.planName as string) || t('authPlanFree');
      subscriptionStatus = (raw.subscriptionStatus as string) || 'free';
    } else if (typeof raw.monthlyCreditsLimit === 'number') {
      // Paid user format from /api/user/quota
      creditsLimit = raw.monthlyCreditsLimit as number;
      creditsUsed = (raw.monthlyCreditsUsed as number) || 0;
      planName = (raw.planName as string) || t('authPlanStandard');
      subscriptionStatus = (raw.subscriptionStatus as string) || 'active';
    } else if (typeof raw.dailyCreditsLimit === 'number') {
      // Legacy exchange format
      creditsLimit = raw.dailyCreditsLimit as number;
      creditsUsed = (raw.dailyCreditsUsed as number) || 0;
      planName = (raw.planName as string) || t('authPlanFree');
      subscriptionStatus = (raw.subscriptionStatus as string) || 'free';
    } else if (typeof raw.creditsLimit === 'number') {
      // Already normalized
      return raw;
    }

    return {
      planName,
      subscriptionStatus,
      creditsLimit,
      creditsUsed,
      creditsRemaining: Math.max(0, creditsLimit - creditsUsed),
    };
  };

  const getCurrentAuthBackendConfig = () => resolveAuthBackendConfig(getStore());

  const getCurrentAuthApiBaseUrl = (): string | null => {
    return getCurrentAuthBackendConfig().apiBaseUrl;
  };

  const publishQingShuFile = async (filePath?: string): Promise<QingShuFilePublishResult> => {
    try {
      if (typeof filePath !== 'string' || !filePath.trim()) {
        return { success: false, error: 'Missing file path' };
      }

      const tokens = getAuthTokens();
      if (!tokens?.accessToken) {
        return { success: false, error: 'QingShu login is required before uploading files' };
      }

      const apiBaseUrl = getCurrentAuthApiBaseUrl();
      if (!apiBaseUrl) {
        return { success: false, error: 'QingShu API base URL is not configured' };
      }

      const resolvedPath = resolveShellFilePath(filePath);
      const stat = await fs.promises.stat(resolvedPath);
      if (!stat.isFile()) {
        return { success: false, error: `Path is not a file: ${resolvedPath}` };
      }
      if (stat.size > MAX_QINGSHU_FILE_UPLOAD_BYTES) {
        return {
          success: false,
          error: `File too large (max ${Math.floor(MAX_QINGSHU_FILE_UPLOAD_BYTES / (1024 * 1024))}MB)`,
        };
      }

      const buffer = await fs.promises.readFile(resolvedPath);
      const contentType = inferQingShuUploadMimeType(resolvedPath);
      const formData = new FormData();
      formData.append(
        'file',
        new Blob([buffer], { type: contentType }),
        sanitizeAttachmentFileName(path.basename(resolvedPath)),
      );

      const uploadUrl = new URL('/api/qingshu-claw/files/upload', apiBaseUrl).toString();
      const response = await session.defaultSession.fetch(uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          auth: `Bearer ${tokens.accessToken}`,
        },
        body: formData,
      });

      const body = await response.json().catch((): null => null) as {
        code?: number;
        msg?: string;
        data?: {
          fileId?: string;
          shareUrl?: string;
          originalFileName?: string;
          contentType?: string;
          size?: number;
          checksum?: string;
          expiresAt?: string;
        };
      } | null;

      if (!response.ok || !body || body.code !== 200 || !body.data?.fileId || !body.data?.shareUrl) {
        return {
          success: false,
          error: body?.msg || `QingShu file upload failed: ${response.status}`,
        };
      }

      return {
        success: true,
        fileId: body.data.fileId,
        shareUrl: body.data.shareUrl,
        originalFileName: body.data.originalFileName || path.basename(resolvedPath),
        contentType: body.data.contentType || contentType,
        size: body.data.size ?? stat.size,
        checksum: body.data.checksum,
        expiresAt: body.data.expiresAt,
      };
    } catch (error) {
      console.error('[QingShuFile] file upload failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to upload file',
      };
    }
  };
  publishQingShuFileHandler = publishQingShuFile;

  const resolveQingShuModuleFeatureFlags = (
    moduleId: string,
    enabledByDefault: boolean,
  ) => resolveQingShuModuleFeatureFlagsFromConfig(
    getStore().get<AppConfigSettings>('app_config'),
    moduleId,
    enabledByDefault,
  );

  const getCurrentAuthAdapter = (): AuthAdapter => {
    const backendConfig = getCurrentAuthBackendConfig();
    const openExternalForAuth = async (url: string) => {
      console.log(`[Auth] Opening the system browser for ${describeUrlForLog(url)}`);
      await shell.openExternal(url);
    };
    const fetchForAuth = async (url: string, options?: RequestInit): Promise<Response> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort(new Error('Auth request timed out after 15s'));
      }, 15000);

      try {
        return await session.defaultSession.fetch(url, {
          ...options,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    };

    if (backendConfig.backend === AuthBackend.Qtb) {
      return createQtbAuthAdapter({
        backend: backendConfig.backend,
        fetchFn: fetchForAuth,
        openExternal: openExternalForAuth,
        onAuthSessionInvalidated: clearLocalAuthSession,
        onServerModelMetadataUpdated: async () => {
          await syncOpenClawConfig({
            reason: 'server-models-updated',
            restartGatewayIfRunning: false,
          });
        },
        resolveApiBaseUrl: () => backendConfig.apiBaseUrl,
        resolveWebBaseUrl: () => backendConfig.webBaseUrl,
        getAuthTokens,
        saveAuthTokens,
        clearAuthTokens,
        normalizeQuota,
        updateServerModelMetadata,
        clearServerModelMetadata,
      });
    }

    return createLegacyLobsterAuthAdapter({
      backend: backendConfig.backend,
      fetchFn: fetchForAuth,
      openExternal: openExternalForAuth,
      onAuthSessionInvalidated: clearLocalAuthSession,
      onServerModelMetadataUpdated: async () => {
        await syncOpenClawConfig({
          reason: 'server-models-updated',
          restartGatewayIfRunning: false,
        });
      },
      resolveApiBaseUrl: () => backendConfig.apiBaseUrl,
      resolveWebBaseUrl: () => backendConfig.webBaseUrl,
      getAuthTokens,
      saveAuthTokens,
      clearAuthTokens,
      normalizeQuota,
      updateServerModelMetadata,
      clearServerModelMetadata,
    });
  };

  const getQingShuExtensionHost = (): QingShuExtensionHost => {
    if (!qingShuExtensionHost) {
      qingShuExtensionHost = createQingShuExtensionHost({
        auth: createQingShuAuthFetchProvider({
          fetchFn: (url: string, options?: RequestInit): Promise<Response> =>
            session.defaultSession.fetch(url, options),
          getAuthAdapter: getCurrentAuthAdapter,
          resolveApiBaseUrl: getCurrentAuthApiBaseUrl,
        }),
        resolveFeatureFlags: resolveQingShuModuleFeatureFlags,
        modules: [],
      });
      console.log('[QingShuExtensionHost] Initialized extension host with 0 module(s)');
    }
    return qingShuExtensionHost;
  };

  const getQingShuGovernanceService = (): QingShuGovernanceService => {
    if (!qingShuGovernanceService) {
      qingShuGovernanceService = createQingShuGovernanceService({
        getSharedToolCatalogSummary: () =>
          getOpenClawConfigSync().getQingShuSharedToolCatalogSummary(),
        listInstalledSkills: () =>
          getSkillManager().listSkills().map((skill) => ({
            id: skill.id,
            skillPath: skill.skillPath,
          })),
        resolveSkillPathById: (skillId: string) => {
          const skill = getSkillManager().listSkills().find((entry) => entry.id === skillId);
          return skill?.skillPath ?? null;
        },
      });
      console.log('[QingShuGovernanceService] Initialized governance service');
    }
    return qingShuGovernanceService;
  };

  const getQingShuManagedCatalogService = (): QingShuManagedCatalogService => {
    if (!qingShuManagedCatalogService) {
      qingShuManagedCatalogService = new QingShuManagedCatalogService({
        fetchFn: (url: string, options?: RequestInit): Promise<Response> =>
          session.defaultSession.fetch(url, options),
        getAuthAdapter: getCurrentAuthAdapter,
        resolveApiBaseUrl: getCurrentAuthApiBaseUrl,
        isAuthenticated: hasQingShuAuthSession,
        getDeviceId: getOrCreateInstallationUuid,
        skillManager: getSkillManager(),
        store: getStore(),
        onAuthSessionInvalidated: clearLocalAuthSession,
        onCatalogChanged: () => {
          refreshQingShuManagedMcpRuntimeConfig('qingshu-managed-catalog-changed');
        },
      });
      console.log('[QingShuManaged] Initialized managed catalog service');
    }
    return qingShuManagedCatalogService;
  };

  const syncQingShuManagedCatalogAndOpenClaw = async (
    reason: string,
  ): Promise<{ success: boolean; snapshot?: unknown; error?: string }> => {
    const syncResult = await getQingShuManagedCatalogService().syncCatalog();
    if (!syncResult.success) {
      console.warn(`[QingShuManaged] failed to sync managed catalog for "${reason}":`, syncResult.error);
    }
    const openClawResult = await syncOpenClawConfig({
      reason,
      restartGatewayIfRunning: true,
    });
    if (!openClawResult.success) {
      console.warn(`[QingShuManaged] failed to sync OpenClaw config for "${reason}":`, openClawResult.error);
    }
    return syncResult;
  };

  ipcMain.handle('auth:getBackend', async () => {
    return getCurrentAuthAdapter().getBackend();
  });

  ipcMain.handle('qingshuManaged:syncCatalog', async () => {
    return syncQingShuManagedCatalogAndOpenClaw('qingshu-managed-catalog-sync');
  });

  ipcMain.handle('qingshuManaged:getCatalog', async () => {
    return {
      success: true,
      snapshot: getQingShuManagedCatalogService().getSnapshot(),
    };
  });

  ipcMain.handle('auth:login', async (_event, { loginUrl }: { loginUrl?: string } = {}) => {
    console.log('[Auth] Received a login request from the renderer');
    const result = await getCurrentAuthAdapter().login({ loginUrl });
    if (result.success) {
      console.log('[Auth] Opened the external login flow successfully');
    } else {
      console.warn(`[Auth] Failed to open the external login flow: ${result.error || 'unknown error'}`);
    }
    return result;
  });

  ipcMain.handle('auth:loginWithPassword', async (_event, input: AuthPasswordLoginInput) => {
    return getCurrentAuthAdapter().loginWithPassword(input);
  });

  ipcMain.handle(
    'auth:openFeishuScanWindow',
    async (_event, input: { authorizeUrl?: string; scanSessionId?: string } = {}) => {
      try {
        const adapter = getCurrentAuthAdapter();
        const result = await adapter.getFeishuScanWindowUrl(input);
        if (!result.success || !result.url) {
          return {
            success: false,
            error: result.error || 'Failed to resolve Feishu scan window URL',
          };
        }

        const backendConfig = getCurrentAuthBackendConfig();
        const allowedOrigins = [
          getUrlOrigin(result.url),
          getUrlOrigin(backendConfig.apiBaseUrl),
          getUrlOrigin(backendConfig.webBaseUrl),
        ].filter((value): value is string => Boolean(value));
        await openAuthPopupWindow(result.url, {
          title: '飞书扫码登录',
          allowedOrigins,
        });
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to open Feishu scan window',
        };
      }
    }
  );

  ipcMain.handle('auth:createFeishuScanSession', async () => {
    return getCurrentAuthAdapter().createFeishuScanSession();
  });

  ipcMain.handle(
    'auth:pollFeishuScanSession',
    async (_event, { scanSessionId }: { scanSessionId: string }) => {
      return getCurrentAuthAdapter().pollFeishuScanSession(scanSessionId);
    }
  );

  ipcMain.handle(
    'auth:exchange',
    async (_event, { code, state }: AuthCallbackPayload) => {
      return getCurrentAuthAdapter().exchange(code, { state });
    }
  );

  ipcMain.handle('auth:createBridgeTicket', async (_event, input) => {
    return getCurrentAuthAdapter().createBridgeTicket(input);
  });

  ipcMain.handle('auth:exchangeBridgeCode', async (_event, input) => {
    return getCurrentAuthAdapter().exchangeBridgeCode(input);
  });

  ipcMain.handle('auth:getUser', async () => {
    return getCurrentAuthAdapter().getUser();
  });

  ipcMain.handle('auth:getQuota', async () => {
    return getCurrentAuthAdapter().getQuota();
  });

  ipcMain.handle('auth:getProfileSummary', async () => {
    return getCurrentAuthAdapter().getProfileSummary();
  });

  ipcMain.handle('auth:logout', async () => {
    try {
      return await getCurrentAuthAdapter().logout();
    } finally {
      clearLocalAuthSession('logout');
    }
  });

  ipcMain.handle('auth:refreshToken', async () => {
    return getCurrentAuthAdapter().refreshToken();
  });

  ipcMain.handle('auth:getAccessToken', async () => {
    return getCurrentAuthAdapter().getAccessToken();
  });

  ipcMain.handle('auth:getModels', async () => {
    return getCurrentAuthAdapter().getModels();
  });

  // Skills IPC handlers
  ipcMain.handle('skills:list', () => {
    try {
      const skills = getSkillManager().listSkills();
      return { success: true, skills };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to load skills' };
    }
  });

  ipcMain.handle('skills:setEnabled', (_event, options: { id: string; enabled: boolean }) => {
    try {
      const skills = getSkillManager().setSkillEnabled(options.id, options.enabled);
      return { success: true, skills };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to update skill' };
    }
  });

  ipcMain.handle('skills:delete', async (_event, id: string) => {
    try {
      const skills = await getSkillManager().deleteSkill(id);
      return { success: true, skills };
    } catch (error) {
      console.error('[skills] Failed to delete skill:', id, error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to delete skill' };
    }
  });

  ipcMain.handle('skills:download', async (_event, source: string) => {
    return getSkillManager().downloadSkill(source);
  });

  ipcMain.handle('skills:fetchMarketplace', async () => {
    const url = getSkillStoreUrl();
    console.log(`[SkillMarketplace] fetching from: ${url}`);
    try {
      const https = await import('https');
      const data = await new Promise<string>((resolve, reject) => {
        const req = https.get(url, { timeout: 10000 }, (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}`));
            res.resume();
            return;
          }

          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            body += chunk;
          });
          res.on('end', () => resolve(body));
          res.on('error', reject);
        });
        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Request timeout'));
        });
      });
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch skill marketplace',
      };
    }
  });

  ipcMain.handle('skills:upgrade', async (_event, skillId: string, downloadUrl: string) => {
    return getSkillManager().upgradeSkill(skillId, downloadUrl);
  });

  ipcMain.handle('skills:confirmInstall', async (_event, pendingId: string, action: string) => {
    const validActions = ['install', 'installDisabled', 'cancel'];
    if (!validActions.includes(action)) {
      return { success: false, error: 'Invalid action' };
    }
    return getSkillManager().confirmPendingInstall(
      pendingId,
      action as 'install' | 'installDisabled' | 'cancel'
    );
  });

  ipcMain.handle('skills:getRoot', () => {
    try {
      const root = getSkillManager().getSkillsRoot();
      return { success: true, path: root };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to resolve skills root' };
    }
  });

  ipcMain.handle('skills:listWorkspaceInstalls', () => {
    try {
      const installs = listWorkspaceSkillInstalls();
      return { success: true, installs };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to list workspace skill installs' };
    }
  });

  ipcMain.handle('skills:autoRoutingPrompt', () => {
    try {
      const prompt = getSkillManager().buildAutoRoutingPrompt();
      return { success: true, prompt };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to build auto-routing prompt' };
    }
  });

  ipcMain.handle('skills:getConfig', (_event, skillId: string) => {
    return getSkillManager().getSkillConfig(skillId);
  });

  ipcMain.handle('skills:setConfig', (_event, skillId: string, config: Record<string, string>) => {
    return getSkillManager().setSkillConfig(skillId, config);
  });

  ipcMain.handle('skills:testEmailConnectivity', async (
    _event,
    skillId: string,
    config: Record<string, string>
  ) => {
    return getSkillManager().testEmailConnectivity(skillId, config);
  });

  ipcMain.handle('skills:governance:analyzeById', (_event, skillId: string) => {
    try {
      const result = getQingShuGovernanceService().analyzeSkillById(skillId);
      if (!result) {
        return {
          success: false,
          error: `Failed to resolve skill path for ${skillId}`,
        };
      }
      return {
        success: true,
        result,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to analyze skill governance',
      };
    }
  });

  ipcMain.handle('skills:governance:analyzeFiles', (_event, skillFilePaths: string[]) => {
    try {
      return {
        success: true,
        results: getQingShuGovernanceService().analyzeSkillFiles(
          Array.isArray(skillFilePaths) ? skillFilePaths : [],
        ),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to analyze skill governance batch',
      };
    }
  });

  ipcMain.handle('skills:governance:getCatalogSummary', () => {
    try {
      return {
        success: true,
        summary: getQingShuGovernanceService().getSharedToolCatalogSummary(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get skill governance catalog summary',
      };
    }
  });

  ipcMain.handle('openclaw:engine:getStatus', async () => {
    try {
      const manager = getOpenClawEngineManager();
      return {
        success: true,
        status: manager.getStatus(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get OpenClaw engine status',
      };
    }
  });

  ipcMain.handle('openclaw:engine:install', async () => {
    try {
      const status = await bootstrapOpenClawEngine({
        forceReinstall: false,
        reason: 'manual-install',
      });
      return {
        success: status.phase === 'running' || status.phase === 'ready',
        status,
      };
    } catch (error) {
      const manager = getOpenClawEngineManager();
      return {
        success: false,
        status: manager.getStatus(),
        error: error instanceof Error ? error.message : 'Failed to install OpenClaw engine',
      };
    }
  });

  ipcMain.handle('openclaw:engine:retryInstall', async () => {
    try {
      const status = await bootstrapOpenClawEngine({
        forceReinstall: true,
        reason: 'manual-retry',
      });
      return {
        success: status.phase === 'running' || status.phase === 'ready',
        status,
      };
    } catch (error) {
      const manager = getOpenClawEngineManager();
      return {
        success: false,
        status: manager.getStatus(),
        error: error instanceof Error ? error.message : 'Failed to retry OpenClaw engine install',
      };
    }
  });

  let restartGatewayPromise: Promise<OpenClawEngineStatus> | null = null;
  ipcMain.handle('openclaw:engine:restartGateway', async () => {
    if (restartGatewayPromise) {
      const status = await restartGatewayPromise;
      return { success: status.phase === 'running' || status.phase === 'ready', status };
    }
    try {
      restartGatewayPromise = requestGatewayRestart('manual-restart');
      const status = await restartGatewayPromise;
      return {
        success: status.phase === 'running' || status.phase === 'ready',
        status,
      };
    } catch (error) {
      const manager = getOpenClawEngineManager();
      return {
        success: false,
        status: manager.getStatus(),
        error: error instanceof Error ? error.message : 'Failed to restart OpenClaw gateway',
      };
    } finally {
      restartGatewayPromise = null;
    }
  });

  // MCP Server IPC handlers
  ipcMain.handle('mcp:list', () => {
    try {
      const servers = getMcpStore().listServers();
      return { success: true, servers };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to list MCP servers' };
    }
  });

  ipcMain.handle('mcp:create', async (_event, data: McpServerFormData) => {
    try {
      getMcpStore().createServer(data);
      const servers = getMcpStore().listServers();
      refreshMcpRuntimeConfig('mcp-server-created');
      return { success: true, servers };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to create MCP server' };
    }
  });

  ipcMain.handle('mcp:update', async (_event, id: string, data: Partial<McpServerFormData>) => {
    try {
      getMcpStore().updateServer(id, data);
      const servers = getMcpStore().listServers();
      refreshMcpRuntimeConfig('mcp-server-updated');
      return { success: true, servers };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to update MCP server' };
    }
  });

  ipcMain.handle('mcp:delete', async (_event, id: string) => {
    try {
      getMcpStore().deleteServer(id);
      const servers = getMcpStore().listServers();
      refreshMcpRuntimeConfig('mcp-server-deleted');
      return { success: true, servers };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to delete MCP server' };
    }
  });

  ipcMain.handle('mcp:setEnabled', async (_event, options: { id: string; enabled: boolean }) => {
    try {
      getMcpStore().setEnabled(options.id, options.enabled);
      const servers = getMcpStore().listServers();
      refreshMcpRuntimeConfig('mcp-server-toggled');
      return { success: true, servers };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to update MCP server' };
    }
  });

  ipcMain.handle('mcp:fetchMarketplace', async () => {
    const url = app.isPackaged
      ? 'https://api-overmind.youdao.com/openapi/get/luna/hardware/lobsterai/prod/mcp-marketplace'
      : 'https://api-overmind.youdao.com/openapi/get/luna/hardware/lobsterai/test/mcp-marketplace';
    try {
      const https = await import('https');
      const data = await new Promise<string>((resolve, reject) => {
        const req = https.get(url, { timeout: 10000 }, (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}`));
            res.resume();
            return;
          }
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => { body += chunk; });
          res.on('end', () => resolve(body));
          res.on('error', reject);
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      });
      const json = JSON.parse(data);
      const value = json?.data?.value;
      if (!value) {
        return { success: false, error: 'Invalid response: missing data.value' };
      }
      const marketplace = typeof value === 'string' ? JSON.parse(value) : value;
      return { success: true, data: marketplace };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to fetch marketplace' };
    }
  });

  ipcMain.handle('plugins:list', async () => {
    try {
      const plugins = await getPluginManager().listPlugins();
      return { success: true, plugins };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to list plugins' };
    }
  });

  ipcMain.handle('plugins:install', async (event, params: PluginInstallParams) => {
    try {
      const result = await getPluginManager().installPlugin(params, (line) => {
        event.sender.send('plugins:installLog', line);
      });
      if (result.ok) {
        void syncOpenClawConfig({ reason: 'plugin-installed', restartGatewayIfRunning: false });
      }
      return result;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Failed to install plugin' };
    }
  });

  ipcMain.handle('plugins:uninstall', async (_event, pluginId: string) => {
    try {
      const result = await getPluginManager().uninstallPlugin(pluginId);
      if (result.ok) {
        void syncOpenClawConfig({ reason: 'plugin-uninstalled', restartGatewayIfRunning: false });
      }
      return result;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Failed to uninstall plugin' };
    }
  });

  ipcMain.handle('plugins:setEnabled', async (_event, pluginId: string, enabled: boolean) => {
    try {
      getPluginManager().setPluginEnabled(pluginId, enabled);
      await syncOpenClawConfig({ reason: 'plugin-enabled-updated', restartGatewayIfRunning: false });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Failed to update plugin state' };
    }
  });

  ipcMain.handle('plugins:getConfigSchema', async (_event, pluginId: string) => {
    try {
      return {
        success: true,
        schema: getPluginManager().getPluginConfigSchema(pluginId),
        config: getPluginManager().getPluginConfig(pluginId),
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to load plugin config schema' };
    }
  });

  ipcMain.handle('plugins:saveConfig', async (_event, pluginId: string, config: Record<string, unknown>) => {
    try {
      getPluginManager().savePluginConfig(pluginId, config);
      await syncOpenClawConfig({ reason: 'plugin-config-saved', restartGatewayIfRunning: false });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Failed to save plugin config' };
    }
  });

  // Cowork IPC handlers
  ipcMain.handle('cowork:session:start', async (_event, options: {
    prompt: string;
    cwd?: string;
    systemPrompt?: string;
    title?: string;
    activeSkillIds?: string[];
    imageAttachments?: CoworkImageAttachmentInput[];
    agentId?: string;
    modelOverride?: string;
  }) => {
    try {
      const activeEngine = resolveCoworkAgentEngine();
      if (activeEngine === 'openclaw') {
        const engineStatus = await ensureOpenClawRunningForCowork();
        if (engineStatus.phase !== 'running') {
          return getEngineNotReadyResponse(engineStatus);
        }
      }

      const coworkStoreInstance = getCoworkStore();
      const config = coworkStoreInstance.getConfig();
      const sessionAgentContext = buildCoworkSessionAgentContext({
        engine: activeEngine,
        agentId: options.agentId,
        systemPrompt: options.systemPrompt ?? config.systemPrompt,
        skillIds: options.activeSkillIds,
      });
      const systemPrompt = sessionAgentContext.systemPrompt;
      const sessionSkillIds = sessionAgentContext.skillIds;
      const denied = resolveCoworkManagedCapabilityDeniedResult({
        agentId: options.agentId || 'main',
        skillIds: sessionSkillIds,
      });
      if (denied) {
        return denied;
      }

      const selectedWorkspaceRoot = resolveSessionWorkingDirectory({
        cwd: options.cwd,
        agentId: options.agentId,
      });

      if (!selectedWorkspaceRoot) {
        return {
          success: false,
          error: 'Please select a task folder before submitting.',
        };
      }

      const defaultTitle = t('coworkDefaultSessionTitle');
      const fallbackTitle = buildSessionTitleFromInput(options.prompt, defaultTitle);
      const title = options.title?.trim() || fallbackTitle;
      const taskWorkingDirectory = resolveTaskWorkingDirectory(selectedWorkspaceRoot);
      const runtimeImageAttachments = await resolveCoworkImageAttachmentsForRuntime(options.imageAttachments);

      const session = coworkStoreInstance.createSession(
        title,
        taskWorkingDirectory,
        systemPrompt,
        config.executionMode || 'local',
        sessionSkillIds,
        options.agentId || 'main',
        options.modelOverride || ''
      );

      // Update session status to 'running' before starting async task
      // This ensures the frontend receives the correct status immediately
      coworkStoreInstance.updateSession(session.id, { status: 'running' });

      // Build metadata, include imageAttachments if present
      const messageMetadata: Record<string, unknown> = {};
      if (sessionSkillIds.length) {
        messageMetadata.skillIds = sessionSkillIds;
      }
      const imageAttachmentMetadata = stripCoworkImageAttachmentPayloads({
        imageAttachments: runtimeImageAttachments ?? options.imageAttachments,
      })?.imageAttachments;
      if (imageAttachmentMetadata) {
        messageMetadata.imageAttachments = imageAttachmentMetadata;
      }
      coworkStoreInstance.addMessage(session.id, {
        type: 'user',
        content: options.prompt,
        metadata: Object.keys(messageMetadata).length > 0 ? messageMetadata : undefined,
      });
      broadcastCoworkSessionsChanged();

      // Update session status to 'running' before starting async task
      // This ensures the frontend receives the correct status immediately
      coworkStoreInstance.updateSession(session.id, { status: 'running' });

      // Start the session asynchronously (skip initial user message since we already added it)
      const runtime = getCoworkEngineRouter();
      runtime.startSession(session.id, options.prompt, {
        skipInitialUserMessage: true,
        systemPrompt,
        skillIds: sessionSkillIds,
        workspaceRoot: selectedWorkspaceRoot,
        confirmationMode: 'modal',
        imageAttachments: runtimeImageAttachments,
        agentId: options.agentId,
      }).catch(error => {
        console.error('[Cowork] session error:', error);
        try {
          // The engine router already emits an 'error' event (handled at line ~990)
          // which sends cowork:stream:error to the renderer. Only send here if the
          // session hasn't been marked as error yet, to avoid duplicate messages.
          const existing = coworkStoreInstance.getSession(session.id);
          if (existing?.status === 'error') return;
          const errorMessage = error instanceof Error ? error.message : String(error);
          const windows = BrowserWindow.getAllWindows();
          windows.forEach((win) => {
            if (win.isDestroyed()) return;
            win.webContents.send('cowork:stream:error', { sessionId: session.id, error: errorMessage });
          });
        } catch (handlerError) {
          console.error('[Cowork] failed to send error notification to renderer:', handlerError);
        }
      });

      const sessionWithMessages = coworkStoreInstance.getSession(session.id) || {
        ...session,
        status: 'running' as const,
      };
      setSpeechFollowUpActiveSession({ sessionId: session.id });
      armSpeechFollowUpFromAppConfig(session.id, 'session start');
      return { success: true, session: sanitizeCoworkSessionForIpc(sessionWithMessages) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start session',
      };
    }
  });

  const continueCoworkSessionFromIpc = async (options: {
    sessionId: string;
    prompt: string;
    systemPrompt?: string;
    activeSkillIds?: string[];
    imageAttachments?: CoworkImageAttachmentInput[];
    skipInitialUserMessage?: boolean;
    errorPrefix?: string;
  }) => {
    try {
      const existingSession = getCoworkStore().getSession(options.sessionId);
      const activeEngine = resolveCoworkAgentEngine();
      if (activeEngine === 'openclaw') {
        const engineStatus = await ensureOpenClawRunningForCowork();
        if (engineStatus.phase !== 'running') {
          return getEngineNotReadyResponse(engineStatus);
        }
      }

      const runtime = getCoworkEngineRouter();
      const sessionAgentContext = buildCoworkSessionAgentContext({
        engine: activeEngine,
        agentId: existingSession?.agentId,
        systemPrompt: options.systemPrompt ?? existingSession?.systemPrompt,
        skillIds: options.activeSkillIds,
      });
      const denied = resolveCoworkManagedCapabilityDeniedResult({
        agentId: existingSession?.agentId || 'main',
        skillIds: sessionAgentContext.skillIds,
      });
      if (denied) {
        return denied;
      }
      const runtimeImageAttachments = await resolveCoworkImageAttachmentsForRuntime(options.imageAttachments);

      getCoworkStore().updateSession(options.sessionId, { status: 'running' });
      runtime.continueSession(options.sessionId, options.prompt, {
        systemPrompt: sessionAgentContext.systemPrompt,
        skillIds: sessionAgentContext.skillIds,
        imageAttachments: runtimeImageAttachments,
        skipInitialUserMessage: options.skipInitialUserMessage,
      }).catch(error => {
        console.error(`[Cowork] ${options.errorPrefix || 'continue'} error:`, error);
        try {
          // The engine router already emits an 'error' event (handled at line ~990)
          // which sends cowork:stream:error to the renderer. Only send here if the
          // session hasn't been marked as error yet, to avoid duplicate messages.
          const existing = getCoworkStore().getSession(options.sessionId);
          if (existing?.status === 'error') return;
          const errorMessage = error instanceof Error ? error.message : String(error);
          const windows = BrowserWindow.getAllWindows();
          windows.forEach((win) => {
            if (win.isDestroyed()) return;
            win.webContents.send('cowork:stream:error', { sessionId: options.sessionId, error: errorMessage });
          });
        } catch (handlerError) {
          console.error('[Cowork] failed to send error notification to renderer:', handlerError);
        }
      });

      const session = getCoworkStore().getSession(options.sessionId);
      setSpeechFollowUpActiveSession({ sessionId: options.sessionId });
      armSpeechFollowUpFromAppConfig(options.sessionId, 'session continue');
      return { success: true, session: sanitizeCoworkSessionForIpc(session) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to continue session',
      };
    }
  };

  ipcMain.handle('cowork:session:continue', async (_event, options: {
    sessionId: string;
    prompt: string;
    systemPrompt?: string;
    activeSkillIds?: string[];
    imageAttachments?: CoworkImageAttachmentInput[];
    skipInitialUserMessage?: boolean;
  }) => continueCoworkSessionFromIpc(options));

  ipcMain.handle('cowork:session:stop', async (_event, sessionId: string) => {
    try {
      const runtime = getCoworkEngineRouter();
      runtime.stopSession(sessionId);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to stop session',
      };
    }
  });

  ipcMain.handle('cowork:session:delete', async (_event, sessionId: string) => {
    try {
      getCoworkEngineRouter().stopSession(sessionId);
      const coworkStoreInstance = getCoworkStore();
      coworkStoreInstance.deleteSession(sessionId);
      broadcastCoworkSessionsChanged();
      // Clean up IM session mapping so that new channel messages
      // create a fresh session instead of referencing a deleted one.
      try {
        getIMGatewayManager()?.getIMStore()?.deleteSessionMappingByCoworkSessionId(sessionId);
      } catch {
        // IM store may not be initialised yet; safe to ignore.
      }
      // Notify runtime to purge in-memory caches for this session
      // so that channel messages can create a fresh session.
      try {
        getCoworkEngineRouter().onSessionDeleted(sessionId);
      } catch {
        // Router may not be initialised yet; safe to ignore.
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete session',
      };
    }
  });

  ipcMain.handle('cowork:session:deleteBatch', async (_event, sessionIds: string[]) => {
    try {
      const runtime = getCoworkEngineRouter();
      sessionIds.forEach((sessionId) => {
        runtime.stopSession(sessionId);
      });
      const coworkStoreInstance = getCoworkStore();
      coworkStoreInstance.deleteSessions(sessionIds);
      broadcastCoworkSessionsChanged();
      const router = getCoworkEngineRouter();
      for (const sessionId of sessionIds) {
        try {
          getIMGatewayManager()?.getIMStore()?.deleteSessionMappingByCoworkSessionId(sessionId);
        } catch {
          // IM store may not be initialised yet; safe to ignore.
        }
        try {
          router.onSessionDeleted(sessionId);
        } catch {
          // Router may not be initialised yet; safe to ignore.
        }
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to batch delete sessions',
      };
    }
  });

  ipcMain.handle('cowork:session:pin', async (_event, options: { sessionId: string; pinned: boolean }) => {
    try {
      const coworkStoreInstance = getCoworkStore();
      coworkStoreInstance.setSessionPinned(options.sessionId, options.pinned);
      broadcastCoworkSessionsChanged();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update session pin',
      };
    }
  });

  ipcMain.handle('cowork:session:rename', async (_event, options: { sessionId: string; title: string }) => {
    try {
      const title = options.title.trim();
      if (!title) {
        return { success: false, error: 'Title is required' };
      }
      const coworkStoreInstance = getCoworkStore();
      coworkStoreInstance.updateSession(options.sessionId, { title });
      broadcastCoworkSessionsChanged();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to rename session',
      };
    }
  });

  ipcMain.handle(CoworkIpcChannel.ForkSession, async (_event, options: { sessionId: string; messageId: string }) => {
    try {
      const coworkStoreInstance = getCoworkStore();
      const session = coworkStoreInstance.forkSession(options.sessionId, options.messageId);
      if (!session) {
        return { success: false, error: 'Failed to fork session' };
      }
      broadcastCoworkSessionsChanged();
      return { success: true, session: sanitizeCoworkSessionForIpc(session) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fork session',
      };
    }
  });

  ipcMain.handle(CoworkIpcChannel.EditUserMessage, async (_event, options: { sessionId: string; messageId: string; content: string; metadata?: CoworkMessageMetadata }) => {
    try {
      const content = typeof options.content === 'string' ? options.content.trim() : '';
      if (!content) {
        return { success: false, error: 'Message content is required' };
      }
      const runtime = getCoworkEngineRouter();
      if (runtime.isSessionActive(options.sessionId)) {
        return { success: false, error: 'Cannot edit a message while the session is running.' };
      }

      const coworkStoreInstance = getCoworkStore();
      const session = coworkStoreInstance.editUserMessageAndTruncateAfter(options.sessionId, options.messageId, {
        content,
        metadata: options.metadata,
      });
      if (!session) {
        return { success: false, error: 'Failed to edit user message' };
      }

      await runtime.resetSessionHistory?.(options.sessionId);
      broadcastCoworkSessionsChanged();
      return { success: true, session: sanitizeCoworkSessionForIpc(session) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to edit user message',
      };
    }
  });

  ipcMain.handle(CoworkIpcChannel.EditUserMessageAndRerun, async (_event, options: {
    sessionId: string;
    messageId: string;
    content: string;
    metadata?: CoworkMessageMetadata;
    systemPrompt?: string;
    activeSkillIds?: string[];
    imageAttachments?: CoworkImageAttachmentInput[];
  }) => {
    try {
      const content = typeof options.content === 'string' ? options.content.trim() : '';
      if (!content) {
        return { success: false, error: 'Message content is required' };
      }
      const runtime = getCoworkEngineRouter();
      if (runtime.isSessionActive(options.sessionId)) {
        return { success: false, error: 'Cannot edit a message while the session is running.' };
      }

      const coworkStoreInstance = getCoworkStore();
      const session = coworkStoreInstance.editUserMessageAndTruncateAfter(options.sessionId, options.messageId, {
        content,
        metadata: options.metadata,
      });
      if (!session) {
        return { success: false, error: 'Failed to edit user message' };
      }

      await runtime.resetSessionHistory?.(options.sessionId);
      broadcastCoworkSessionsChanged();

      return await continueCoworkSessionFromIpc({
        sessionId: options.sessionId,
        prompt: content,
        systemPrompt: options.systemPrompt,
        activeSkillIds: options.activeSkillIds,
        imageAttachments: options.imageAttachments,
        skipInitialUserMessage: true,
        errorPrefix: 'edit rerun',
      });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to edit and rerun user message',
      };
    }
  });

  ipcMain.handle('cowork:session:get', async (_event, sessionId: string) => {
    try {
      const session = getCoworkStore().getSession(sessionId);
      return { success: true, session: sanitizeCoworkSessionForIpc(session) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get session',
      };
    }
  });

  ipcMain.handle('cowork:session:remoteManaged', async (_event, sessionId: string) => {
    try {
      const mapping = getIMGatewayManager()?.getIMStore()?.getSessionMappingByCoworkSessionId(sessionId);
      return { success: true, remoteManaged: !!mapping };
    } catch (error) {
      return {
        success: false,
        remoteManaged: false,
        error: error instanceof Error ? error.message : 'Failed to check remote managed session',
      };
    }
  });

  ipcMain.handle('cowork:subTask:history', async (_event, options: {
    parentSessionId: string;
    agentId: string;
    sessionKey?: string;
  }) => {
    if (openClawRuntimeAdapter) {
      try {
        const messages = await openClawRuntimeAdapter.getSubTaskHistory(
          options.parentSessionId,
          options.agentId,
          options.sessionKey,
        );
        return { success: true, messages };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to fetch subagent history',
        };
      }
    }
    try {
      const runs = getSubagentRunStore().listSubagentRuns(options.parentSessionId);
      const run = runs.find((item) => {
        if (options.sessionKey && item.sessionKey !== options.sessionKey) {
          return false;
        }
        if (options.agentId && item.agentId !== options.agentId) {
          return false;
        }
        return true;
      });
      if (!run) {
        return { success: true, messages: [] };
      }
      return {
        success: true,
        messages: getSubagentMessageStore().getMessages(run.id).map(mapPersistedSubagentMessage),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch subagent history',
      };
    }
  });

  ipcMain.handle('cowork:subagent:list', async (_event, options: { parentSessionId: string }) => {
    try {
      return {
        success: true,
        runs: openClawRuntimeAdapter?.listSubagentRuns(options.parentSessionId)
          ?? getSubagentRunStore().listSubagentRuns(options.parentSessionId),
      };
    } catch (error) {
      return {
        success: false,
        runs: [],
        error: error instanceof Error ? error.message : 'Failed to list subagent sessions',
      };
    }
  });

  ipcMain.handle('cowork:session:list', async (_event, agentId?: string) => {
    try {
      const sessions = getCoworkStore().listSessions(agentId);
      const imStore = getIMGatewayManager()?.getIMStore?.();
      const enrichedSessions = sessions.map((session) => {
        const mapping = imStore?.getSessionMappingByCoworkSessionId(session.id);
        if (!mapping) {
          return session;
        }

        return {
          ...session,
          source: 'im' as const,
          platform: mapping.platform as SharedPlatform,
          conversationId: mapping.imConversationId,
        };
      });
      return { success: true, sessions: enrichedSessions };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list sessions',
      };
    }
  });

  // ========== Agent IPC Handlers ==========

  ipcMain.handle('agents:list', async (_event, options?: { refreshManagedCatalog?: boolean }) => {
    try {
      if (options?.refreshManagedCatalog !== false && hasQingShuAuthSession()) {
        const syncResult = await syncQingShuManagedCatalogAndOpenClaw('agents-list-refresh-managed-catalog');
        if (!syncResult.success) {
          console.warn('[QingShuManaged] Failed to refresh managed catalog before listing agents:', syncResult.error);
        }
      }
      const agents = getAgentManager().listAgents();
      return { success: true, agents };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to list agents' };
    }
  });

  ipcMain.handle('agents:get', async (_event, id: string) => {
    try {
      const agent = getAgentManager().getAgent(id);
      return { success: true, agent };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to get agent' };
    }
  });

  ipcMain.handle('agents:create', async (_event, request: import('./coworkStore').CreateAgentRequest) => {
    try {
      const agent = getAgentManager().createAgent(request);
      // Sync config so workspace files (SOUL.md, IDENTITY.md) are written
      // before OpenClaw scaffolds default templates for the new agent.
      syncOpenClawConfig({ reason: 'agent-created' }).catch(() => {});
      return { success: true, agent };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to create agent' };
    }
  });

  ipcMain.handle('agents:update', async (_event, id: string, updates: import('./coworkStore').UpdateAgentRequest) => {
    try {
      const managedAgent = qingShuManagedCatalogService?.getManagedAgent(id);
      if (managedAgent) {
        const denied = buildManagedCapabilityDeniedResult({
          sourceType: managedAgent.sourceType,
          allowed: managedAgent.allowed,
          policyNote: managedAgent.policyNote,
        });
        if (denied) {
          return denied;
        }
        const unsupportedKeys = Object.entries(updates)
          .filter(([, value]) => value !== undefined)
          .map(([key]) => key)
          .filter((key) => key !== 'skillIds');
        if (unsupportedKeys.length > 0) {
          throw new Error('Managed agents only support appending local skills.');
        }

        const requestedSkillIds = normalizeIds(updates.skillIds);
        const baseSkillIds = normalizeIds(managedAgent.managedBaseSkillIds ?? []);
        const missingBaseSkillIds = baseSkillIds.filter((skillId) => !requestedSkillIds.includes(skillId));
        if (missingBaseSkillIds.length > 0) {
          throw new Error('Managed base skills cannot be removed.');
        }

        const extraSkillIds = requestedSkillIds.filter((skillId) => !baseSkillIds.includes(skillId));
        const availableExtraSkillIds = new Set(
          getSkillManager()
            .listSkills()
            .filter((skill) =>
              skill.enabled
              && skill.sourceType !== QingShuObjectSourceType.QingShuManaged,
            )
            .map((skill) => skill.id),
        );
        const invalidExtraSkillIds = extraSkillIds.filter((skillId) => !availableExtraSkillIds.has(skillId));
        if (invalidExtraSkillIds.length > 0) {
          throw new Error(`These skills cannot be attached to a managed agent: ${invalidExtraSkillIds.join(', ')}`);
        }

        const agent = qingShuManagedCatalogService?.setManagedAgentExtraSkillIds(id, extraSkillIds) ?? null;
        syncOpenClawConfig({ reason: 'managed-agent-extra-skills-updated' }).catch(() => {});
        return { success: true, agent };
      }

      const agent = getAgentManager().updateAgent(id, updates);
      syncOpenClawConfig({ reason: 'agent-updated' }).catch(() => {});
      return { success: true, agent };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to update agent' };
    }
  });

  ipcMain.handle('agents:delete', async (_event, id: string) => {
    try {
      const result = getAgentManager().deleteAgent(id);

      // Clean up IM platform bindings that reference the deleted agent
      // so that channels fall back to the default 'main' agent.
      try {
        const imStore = getIMGatewayManager()?.getIMStore();
        if (imStore) {
          const imSettings = imStore.getIMSettings();
          const bindings = imSettings.platformAgentBindings;
          if (bindings) {
            let changed = false;
            for (const [platform, agentId] of Object.entries(bindings)) {
              if (agentId === id) {
                delete bindings[platform];
                changed = true;
              }
            }
            if (changed) {
              imStore.setIMSettings({ platformAgentBindings: bindings });
            }
          }
        }
      } catch {
        // IM store may not be initialised yet; safe to ignore.
      }

      syncOpenClawConfig({ reason: 'agent-deleted' }).catch(() => {});
      return { success: true, deleted: result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to delete agent' };
    }
  });

  ipcMain.handle('agents:presets', async () => {
    try {
      const presets = getAgentManager().getPresetAgents();
      return { success: true, presets };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to get presets' };
    }
  });

  ipcMain.handle('agents:addPreset', async (_event, presetId: string) => {
    try {
      const agent = getAgentManager().addPresetAgent(presetId);
      syncOpenClawConfig({ reason: 'agent-preset-added' }).catch(() => {});
      return { success: true, agent };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to add preset agent' };
    }
  });

  ipcMain.handle('cowork:session:exportResultImage', async (
    event,
    options: {
      rect: { x: number; y: number; width: number; height: number };
      defaultFileName?: string;
    }
  ) => {
    try {
      const { rect, defaultFileName } = options || {};
      const captureRect = normalizeCaptureRect(rect);
      if (!captureRect) {
        return { success: false, error: 'Capture rect is required' };
      }

      const image = await event.sender.capturePage(captureRect);
      return savePngWithDialog(event.sender, image.toPNG(), defaultFileName);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to export session image',
      };
    }
  });

  ipcMain.handle('cowork:session:captureImageChunk', async (
    event,
    options: {
      rect: { x: number; y: number; width: number; height: number };
    }
  ) => {
    try {
      const captureRect = normalizeCaptureRect(options?.rect);
      if (!captureRect) {
        return { success: false, error: 'Capture rect is required' };
      }

      const image = await event.sender.capturePage(captureRect);
      const pngBuffer = image.toPNG();

      return {
        success: true,
        width: captureRect.width,
        height: captureRect.height,
        pngBase64: pngBuffer.toString('base64'),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to capture session image chunk',
      };
    }
  });

  ipcMain.handle('cowork:session:saveResultImage', async (
    event,
    options: {
      pngBase64: string;
      defaultFileName?: string;
    }
  ) => {
    try {
      const base64 = typeof options?.pngBase64 === 'string' ? options.pngBase64.trim() : '';
      if (!base64) {
        return { success: false, error: 'Image data is required' };
      }

      const pngBuffer = Buffer.from(base64, 'base64');
      if (pngBuffer.length <= 0) {
        return { success: false, error: 'Invalid image data' };
      }

      return savePngWithDialog(event.sender, pngBuffer, options?.defaultFileName);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save session image',
      };
    }
  });

  ipcMain.handle('cowork:session:exportText', async (
    event,
    options: {
      content: string;
      defaultFileName?: string;
      fileExtension?: string;
    }
  ) => {
    try {
      const content = typeof options?.content === 'string' ? options.content : '';
      if (!content) {
        return { success: false, error: 'Export content is empty' };
      }

      const ext = options?.fileExtension || 'md';
      const filterName = ext === 'json' ? 'JSON' : 'Markdown';
      const defaultName = options?.defaultFileName || `session-export.${ext}`;
      const ownerWindow = BrowserWindow.fromWebContents(event.sender);
      const saveOptions = {
        title: 'Export Session',
        defaultPath: path.join(app.getPath('downloads'), defaultName),
        filters: [{ name: filterName, extensions: [ext] }],
      };
      const saveResult = ownerWindow
        ? await dialog.showSaveDialog(ownerWindow, saveOptions)
        : await dialog.showSaveDialog(saveOptions);

      if (saveResult.canceled || !saveResult.filePath) {
        return { success: true, canceled: true };
      }

      await fs.promises.writeFile(saveResult.filePath, content, 'utf-8');
      return { success: true, canceled: false, path: saveResult.filePath };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to export session',
      };
    }
  });

  ipcMain.handle('cowork:permission:respond', async (_event, options: {
    requestId: string;
    result: PermissionResult;
  }) => {
    try {
      // Dual-dispatch pattern: permission responses arrive through one IPC channel
      // but may target either of two independent subsystems.
      //
      // - resolveAskUser() handles AskUserQuestion plugin requests routed through
      //   the McpBridgeServer HTTP callback. It is a no-op when the requestId does
      //   not match a pending bridge request (i.e. for normal SDK permission requests).
      //
      // - respondToPermission() handles standard Claude Agent SDK permission requests
      //   managed by the CoworkEngineRouter. It is a no-op when the requestId does
      //   not match a pending SDK permission (i.e. for bridge plugin requests).
      //
      // Both calls are safe to invoke unconditionally; exactly one will match.

      // AskUserQuestion plugin responses go to the bridge server, not the runtime
      if (mcpBridgeServer && options.requestId) {
        const result = options.result;
        const askUserResponse: import('./libs/mcpBridgeServer').AskUserResponse = {
          behavior: result.behavior === 'allow' ? 'allow' : 'deny',
          answers: result.behavior === 'allow' && result.updatedInput && typeof result.updatedInput === 'object'
            ? (result.updatedInput as Record<string, unknown>).answers as Record<string, string> | undefined
            : undefined,
        };
        mcpBridgeServer.resolveAskUser(options.requestId, askUserResponse);
      }

      const runtime = getCoworkEngineRouter();
      runtime.respondToPermission(options.requestId, options.result);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to respond to permission',
      };
    }
  });

  ipcMain.handle('cowork:config:get', async () => {
    try {
      const config = getCoworkStore().getConfig();
      return { success: true, config };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get config',
      };
    }
  });

  ipcMain.handle(OpenClawSessionPolicyIpc.Get, async () => {
    try {
      const config = loadOpenClawSessionPolicyConfig(getStore());
      return { success: true, config };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get OpenClaw session policy',
      };
    }
  });

  ipcMain.handle(OpenClawSessionPolicyIpc.Set, async (_event, config: unknown) => {
    try {
      const saved = saveOpenClawSessionPolicyConfig(getStore(), config);
      await syncOpenClawConfig({ reason: 'session-policy-updated', restartGatewayIfRunning: false });
      return { success: true, config: saved };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save OpenClaw session policy',
      };
    }
  });

  ipcMain.handle(OpenClawSessionIpc.Patch, async (_event, input: unknown) => {
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Invalid OpenClaw session patch input.');
      }

      const request = input as { sessionId?: unknown; patch?: unknown };
      const sessionId = typeof request.sessionId === 'string' ? request.sessionId.trim() : '';
      if (!sessionId) {
        throw new Error('Session ID is required.');
      }

      const rawPatch = request.patch && typeof request.patch === 'object' && !Array.isArray(request.patch)
        ? request.patch as Record<string, unknown>
        : {};
      const patch: OpenClawSessionPatch = {
        model: typeof rawPatch.model === 'string' ? rawPatch.model : rawPatch.model === null ? null : undefined,
        thinkingLevel: typeof rawPatch.thinkingLevel === 'string' ? rawPatch.thinkingLevel : rawPatch.thinkingLevel === null ? null : undefined,
        reasoningLevel: typeof rawPatch.reasoningLevel === 'string' ? rawPatch.reasoningLevel : rawPatch.reasoningLevel === null ? null : undefined,
        elevatedLevel: typeof rawPatch.elevatedLevel === 'string' ? rawPatch.elevatedLevel : rawPatch.elevatedLevel === null ? null : undefined,
        responseUsage: rawPatch.responseUsage === 'off' || rawPatch.responseUsage === 'tokens' || rawPatch.responseUsage === 'full'
          ? rawPatch.responseUsage
          : rawPatch.responseUsage === null
            ? null
            : undefined,
        sendPolicy: rawPatch.sendPolicy === 'allow' || rawPatch.sendPolicy === 'deny'
          ? rawPatch.sendPolicy
          : rawPatch.sendPolicy === null
            ? null
            : undefined,
      };

      await getCoworkEngineRouter().patchSession(sessionId, patch);

      if (patch.model !== undefined) {
        getCoworkStore().updateSession(sessionId, {
          modelOverride: patch.model ?? '',
        });
      }

      const session = getCoworkStore().getSession(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      return { success: true, session: sanitizeCoworkSessionForIpc(session) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to patch OpenClaw session',
      };
    }
  });

  ipcMain.handle('cowork:memory:listEntries', async (_event, input: {
    query?: string;
    status?: 'created' | 'stale' | 'deleted' | 'all';
    includeDeleted?: boolean;
    limit?: number;
    offset?: number;
  }) => {
    try {
      const filePath = resolveMemoryFilePath(getMainAgentWorkspacePath(getOpenClawEngineManager().getStateDir()));

      // Lazy migration: SQLite → MEMORY.md (one-time, cached in memory)
      if (!memoryMigrationDone) {
        migrateSqliteToMemoryMd(filePath, {
          isMigrationDone: () => getStore().get<string>('openclawMemory.migration.v1.completed') === '1',
          markMigrationDone: () => {
            getStore().set('openclawMemory.migration.v1.completed', '1');
            memoryMigrationDone = true;
          },
          getActiveMemoryTexts: () => {
            return getCoworkStore().listUserMemories({ status: 'all', includeDeleted: false, limit: 200 })
              .map((m) => m.text);
          },
        });
        // Even if migration found nothing, skip future checks this session
        memoryMigrationDone = true;
      }

      const query = input?.query?.trim() || '';
      const entries = query
        ? searchMemoryEntries(filePath, query)
        : readMemoryEntries(filePath);
      return { success: true, entries };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list memory entries',
      };
    }
  });
  ipcMain.handle('cowork:memory:createEntry', async (_event, input: {
    text: string;
    confidence?: number;
    isExplicit?: boolean;
  }) => {
    try {
      const filePath = resolveMemoryFilePath(getMainAgentWorkspacePath(getOpenClawEngineManager().getStateDir()));
      const entry = addMemoryEntry(filePath, input.text);
      return { success: true, entry };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create memory entry',
      };
    }
  });
  ipcMain.handle('cowork:memory:updateEntry', async (_event, input: {
    id: string;
    text?: string;
    confidence?: number;
    status?: 'created' | 'stale' | 'deleted';
    isExplicit?: boolean;
  }) => {
    try {
      const filePath = resolveMemoryFilePath(getMainAgentWorkspacePath(getOpenClawEngineManager().getStateDir()));
      if (!input.text) {
        return { success: false, error: 'Memory text is required' };
      }
      const entry = updateMemoryEntry(filePath, input.id, input.text);
      if (!entry) {
        return { success: false, error: 'Memory entry not found' };
      }
      return { success: true, entry };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update memory entry',
      };
    }
  });
  ipcMain.handle('cowork:memory:deleteEntry', async (_event, input: {
    id: string;
  }) => {
    try {
      const filePath = resolveMemoryFilePath(getMainAgentWorkspacePath(getOpenClawEngineManager().getStateDir()));
      const success = deleteMemoryEntry(filePath, input.id);
      return success
        ? { success: true }
        : { success: false, error: 'Memory entry not found' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete memory entry',
      };
    }
  });
  ipcMain.handle('cowork:memory:getStats', async () => {
    try {
      const filePath = resolveMemoryFilePath(getMainAgentWorkspacePath(getOpenClawEngineManager().getStateDir()));
      const entries = readMemoryEntries(filePath);
      return {
        success: true,
        stats: {
          total: entries.length,
          created: entries.length,
          stale: 0,
          deleted: 0,
          explicit: entries.length,
          implicit: 0,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get memory stats',
      };
    }
  });
  ipcMain.handle('cowork:dreaming:status', async () => {
    try {
      const gwClient = openClawRuntimeAdapter?.getGatewayClient();
      if (!gwClient) {
        return { success: false, error: 'Gateway client not available' };
      }
      const result = await gwClient.request<Record<string, unknown>>(
        'doctor.memory.status',
        {},
        { timeoutMs: 10_000 },
      );
      const dreaming = (result as { dreaming?: unknown }).dreaming;
      return { success: true, data: dreaming ?? null };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch dreaming status',
      };
    }
  });
  ipcMain.handle('cowork:dreaming:diary', async () => {
    try {
      const gwClient = openClawRuntimeAdapter?.getGatewayClient();
      if (!gwClient) {
        return { success: false, error: 'Gateway client not available' };
      }
      const result = await gwClient.request<Record<string, unknown>>(
        'doctor.memory.dreamDiary',
        {},
        { timeoutMs: 10_000 },
      );
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch dream diary',
      };
    }
  });
  ipcMain.handle('cowork:bootstrap:read', async (_event, filename: string) => {
    try {
      const mainWorkspace = getMainAgentWorkspacePath(getOpenClawEngineManager().getStateDir());
      const content = readBootstrapFile(mainWorkspace, filename);
      return { success: true, content };
    } catch (error) {
      return {
        success: false,
        content: '',
        error: error instanceof Error ? error.message : 'Failed to read bootstrap file',
      };
    }
  });
  ipcMain.handle('cowork:bootstrap:write', async (_event, filename: string, content: string) => {
    try {
      const mainWorkspace = getMainAgentWorkspacePath(getOpenClawEngineManager().getStateDir());
      writeBootstrapFile(mainWorkspace, filename, content);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to write bootstrap file',
      };
    }
  });
  const VALID_EMBEDDING_PROVIDERS = ['local', 'openai', 'gemini', 'voyage', 'mistral', 'ollama'] as const;

  function normalizeEmbeddingConfig(config: {
    embeddingEnabled?: boolean;
    embeddingProvider?: string;
    embeddingModel?: string;
    embeddingLocalModelPath?: string;
    embeddingVectorWeight?: number;
    embeddingRemoteBaseUrl?: string;
    embeddingRemoteApiKey?: string;
  }) {
    return {
      embeddingEnabled: typeof config.embeddingEnabled === 'boolean'
        ? config.embeddingEnabled
        : undefined,
      embeddingProvider: typeof config.embeddingProvider === 'string'
        && (VALID_EMBEDDING_PROVIDERS as readonly string[]).includes(config.embeddingProvider)
        ? config.embeddingProvider
        : undefined,
      embeddingModel: typeof config.embeddingModel === 'string'
        ? config.embeddingModel.trim()
        : undefined,
      embeddingLocalModelPath: typeof config.embeddingLocalModelPath === 'string'
        ? config.embeddingLocalModelPath.trim()
        : undefined,
      embeddingVectorWeight: typeof config.embeddingVectorWeight === 'number'
        && Number.isFinite(config.embeddingVectorWeight)
        ? Math.max(0, Math.min(1, config.embeddingVectorWeight))
        : undefined,
      embeddingRemoteBaseUrl: typeof config.embeddingRemoteBaseUrl === 'string'
        ? config.embeddingRemoteBaseUrl.trim()
        : undefined,
      embeddingRemoteApiKey: typeof config.embeddingRemoteApiKey === 'string'
        ? config.embeddingRemoteApiKey.trim()
        : undefined,
    };
  }

  ipcMain.handle('cowork:config:set', async (_event, config: {
    workingDirectory?: string;
    executionMode?: 'auto' | 'local' | 'sandbox';
    agentEngine?: CoworkAgentEngine;
    memoryEnabled?: boolean;
    memoryImplicitUpdateEnabled?: boolean;
    memoryLlmJudgeEnabled?: boolean;
    memoryGuardLevel?: 'strict' | 'standard' | 'relaxed';
    memoryUserMemoriesMaxItems?: number;
    skipMissedJobs?: boolean;
    embeddingEnabled?: boolean;
    embeddingProvider?: string;
    embeddingModel?: string;
    embeddingLocalModelPath?: string;
    embeddingVectorWeight?: number;
    embeddingRemoteBaseUrl?: string;
    embeddingRemoteApiKey?: string;
    toolResultMaxChars?: number;
    openClawSessionPolicy?: { keepAlive?: '1d' | '7d' | '30d' | '365d' };
  }) => {
    try {
      const normalizedExecutionMode =
        config.executionMode && String(config.executionMode) === 'container'
          ? 'local'
          : config.executionMode;
      const normalizedAgentEngine = config.agentEngine === 'yd_cowork'
        ? 'yd_cowork'
        : config.agentEngine === 'openclaw'
          ? 'openclaw'
          : undefined;
      const normalizedMemoryEnabled = typeof config.memoryEnabled === 'boolean'
        ? config.memoryEnabled
        : undefined;
      const normalizedMemoryImplicitUpdateEnabled = typeof config.memoryImplicitUpdateEnabled === 'boolean'
        ? config.memoryImplicitUpdateEnabled
        : undefined;
      const normalizedMemoryLlmJudgeEnabled = typeof config.memoryLlmJudgeEnabled === 'boolean'
        ? config.memoryLlmJudgeEnabled
        : undefined;
      const normalizedMemoryGuardLevel = config.memoryGuardLevel === 'strict'
        || config.memoryGuardLevel === 'standard'
        || config.memoryGuardLevel === 'relaxed'
        ? config.memoryGuardLevel
        : undefined;
      const normalizedMemoryUserMemoriesMaxItems =
        typeof config.memoryUserMemoriesMaxItems === 'number' && Number.isFinite(config.memoryUserMemoriesMaxItems)
          ? Math.max(
            MIN_MEMORY_USER_MEMORIES_MAX_ITEMS,
            Math.min(MAX_MEMORY_USER_MEMORIES_MAX_ITEMS, Math.floor(config.memoryUserMemoriesMaxItems))
          )
        : undefined;
      const normalizedSkipMissedJobs =
        typeof config.skipMissedJobs === 'boolean'
          ? config.skipMissedJobs
          : undefined;
      const normalizedEmbedding = normalizeEmbeddingConfig(config);
      const normalizedToolResultMaxChars =
        config.toolResultMaxChars !== undefined
          ? normalizeToolResultMaxChars(config.toolResultMaxChars)
          : undefined;
      const normalizedOpenClawSessionPolicy =
        config.openClawSessionPolicy && typeof config.openClawSessionPolicy === 'object'
          ? {
              keepAlive:
                config.openClawSessionPolicy.keepAlive === '1d'
                || config.openClawSessionPolicy.keepAlive === '7d'
                || config.openClawSessionPolicy.keepAlive === '30d'
                || config.openClawSessionPolicy.keepAlive === '365d'
                  ? config.openClawSessionPolicy.keepAlive
                  : undefined,
            }
          : undefined;
      const normalizedConfig: Parameters<CoworkStore['setConfig']>[0] = {
        ...config,
        executionMode: normalizedExecutionMode,
        agentEngine: normalizedAgentEngine,
        memoryEnabled: normalizedMemoryEnabled,
        memoryImplicitUpdateEnabled: normalizedMemoryImplicitUpdateEnabled,
        memoryLlmJudgeEnabled: normalizedMemoryLlmJudgeEnabled,
        memoryGuardLevel: normalizedMemoryGuardLevel,
        memoryUserMemoriesMaxItems: normalizedMemoryUserMemoriesMaxItems,
        skipMissedJobs: normalizedSkipMissedJobs,
        ...normalizedEmbedding,
        toolResultMaxChars: normalizedToolResultMaxChars,
        openClawSessionPolicy: normalizedOpenClawSessionPolicy,
      };
      const previousConfig = getCoworkStore().getConfig();
      const previousWorkingDir = previousConfig.workingDirectory;
      getCoworkStore().setConfig(normalizedConfig);
      if (normalizedConfig.workingDirectory !== undefined && normalizedConfig.workingDirectory !== previousWorkingDir) {
        getSkillManager().handleWorkingDirectoryChange();
        // Main agent workspace is decoupled from workingDirectory; the selected
        // directory is now only synced to OpenClaw as task cwd.
      }

      const nextConfig = getCoworkStore().getConfig();
      if (normalizedAgentEngine !== undefined && normalizedAgentEngine !== previousConfig.agentEngine) {
        getCoworkEngineRouter().handleEngineConfigChanged(normalizedAgentEngine);
      }
      const switchedToOpenClaw = normalizedAgentEngine === 'openclaw'
        && previousConfig.agentEngine !== 'openclaw';

      const impactDecision = classifyCoworkConfigChange(previousConfig, nextConfig);
      if (impactDecision.impact !== OpenClawConfigImpact.None) {
        const syncResult = await syncOpenClawConfig({
          reason: 'cowork-config-change',
          restartGatewayIfRunning: impactDecision.impact === OpenClawConfigImpact.Restart,
        });
        if (!syncResult.success && nextConfig.agentEngine === 'openclaw') {
          return {
            success: false,
            code: ENGINE_NOT_READY_CODE,
            error: syncResult.error || 'OpenClaw config sync failed.',
            engineStatus: syncResult.status || getOpenClawEngineManager().getStatus(),
          };
        }
      }

      if (switchedToOpenClaw) {
        void ensureOpenClawRunningForCowork().catch((error) => {
          console.error('[OpenClaw] Failed to auto-start gateway after engine switch:', error);
        });
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set config',
      };
    }
  });

  // ==================== Scheduled Task IPC Handlers (OpenClaw) ====================

  initCronJobServiceManager({
    getOpenClawRuntimeAdapter: () => openClawRuntimeAdapter,
  });
  initScheduledTaskHelpers({
    getIMGatewayManager: () => getIMGatewayManager(),
  });
  registerScheduledTaskHandlers({
    getCronJobService,
    getIMGatewayManager: () => getIMGatewayManager(),
    getOpenClawRuntimeAdapter: () => openClawRuntimeAdapter,
  });
  registerNimQrLoginHandlers({
    startNimQrLogin,
    pollNimQrLogin,
  });

  // ==================== Permissions IPC Handlers ====================

  ipcMain.handle('permissions:checkCalendar', async () => {
    try {
      const status = await checkCalendarPermission();
      
      // Development mode: Auto-request permission if not determined
      // This provides a better dev experience without affecting production
      if (isDev && status === 'not-determined' && process.platform === 'darwin') {
        console.log('[Permissions] Development mode: Auto-requesting calendar permission...');
        try {
          await requestCalendarPermission();
          const newStatus = await checkCalendarPermission();
          console.log('[Permissions] Development mode: Permission status after request:', newStatus);
          return { success: true, status: newStatus, autoRequested: true };
        } catch (requestError) {
          console.warn('[Permissions] Development mode: Auto-request failed:', requestError);
        }
      }
      
      return { success: true, status };
    } catch (error) {
      console.error('[Main] Error checking calendar permission:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to check permission' };
    }
  });

  ipcMain.handle('permissions:requestCalendar', async () => {
    try {
      // Request permission and check status
      const granted = await requestCalendarPermission();
      const status = await checkCalendarPermission();
      return { success: true, granted, status };
    } catch (error) {
      console.error('[Main] Error requesting calendar permission:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to request permission' };
    }
  });

  // ==================== IM Gateway IPC Handlers ====================

  ipcMain.handle('im:config:get', async () => {
    try {
      const config = getIMGatewayManager().getConfig();
      return { success: true, config };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get IM config',
      };
    }
  });

  // Debounce + serialization for im:config:set → syncOpenClawConfig.
  // Rapid sequential config changes (e.g. toggling 4 platforms) are coalesced
  // into a single gateway restart instead of N restarts.
  // The running/pending flags prevent concurrent sync operations from racing:
  // if a sync is in progress when new changes arrive, they are queued and
  // a follow-up sync runs after the current one completes.
  let imConfigSyncTimer: ReturnType<typeof setTimeout> | null = null;
  let imConfigSyncRunning = false;
  let imConfigSyncPending = false;
  let imConfigSyncRestartGatewayIfRunning = false;
  let lastSyncedImOpenClawConfigFingerprint: string | null = null;
  const IM_CONFIG_SYNC_DEBOUNCE_MS = 600;
  type IMConfigSyncOptions = {
    restartGatewayIfRunning?: boolean;
  };
  type IMConfigSetOptions = IMConfigSyncOptions & {
    syncGateway?: boolean;
    markRestartOnSave?: boolean;
  };
  type IMConfigSyncResult = {
    success: boolean;
    error?: string;
    pending?: boolean;
  };
  let imConfigRestartOnNextSettingsSave = false;

  const getCurrentImOpenClawConfigFingerprint = () => {
    return createStableConfigFingerprint(getIMGatewayManager().getConfig());
  };

  const ensureLastSyncedImOpenClawConfigFingerprint = (fallbackFingerprint?: string) => {
    if (lastSyncedImOpenClawConfigFingerprint === null) {
      lastSyncedImOpenClawConfigFingerprint = fallbackFingerprint ?? getCurrentImOpenClawConfigFingerprint();
    }
    return lastSyncedImOpenClawConfigFingerprint;
  };

  const doImConfigSync = async (): Promise<IMConfigSyncResult> => {
    imConfigSyncRunning = true;
    const restartGatewayIfRunning = imConfigSyncRestartGatewayIfRunning;
    imConfigSyncRestartGatewayIfRunning = false;
    try {
      const syncResult = await syncOpenClawConfig({
        reason: 'im-config-change',
        restartGatewayIfRunning,
      });
      if (!syncResult.success) {
        throw new Error(syncResult.error || 'OpenClaw config sync failed.');
      }
      lastSyncedImOpenClawConfigFingerprint = getCurrentImOpenClawConfigFingerprint();
      imConfigRestartOnNextSettingsSave = false;
      // After config sync, ensure the runtime adapter's WebSocket client is
      // connected so channel events are received.
      if (openClawRuntimeAdapter) {
        try {
          await openClawRuntimeAdapter.connectGatewayIfNeeded();
        } catch (connectError) {
          console.error('[IM] Failed to connect gateway client after config sync:', connectError);
        }
      }
      return { success: true };
    } catch (error) {
      console.error('[IM] Config sync failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'OpenClaw config sync failed.',
      };
    } finally {
      imConfigSyncRunning = false;
      if (imConfigSyncPending) {
        const restartPendingGatewayIfRunning = imConfigSyncRestartGatewayIfRunning;
        imConfigSyncPending = false;
        scheduleImConfigSync({
          restartGatewayIfRunning: restartPendingGatewayIfRunning,
        });
      }
    }
  };

  const scheduleImConfigSync = (options: IMConfigSyncOptions = {}) => {
    if (options.restartGatewayIfRunning) {
      imConfigSyncRestartGatewayIfRunning = true;
    }
    if (imConfigSyncRunning) {
      // A sync is already in progress; mark pending so it re-runs after completion.
      imConfigSyncPending = true;
      return;
    }
    if (imConfigSyncTimer) clearTimeout(imConfigSyncTimer);
    imConfigSyncTimer = setTimeout(() => {
      imConfigSyncTimer = null;
      void doImConfigSync();
    }, IM_CONFIG_SYNC_DEBOUNCE_MS);
  };

  const runImConfigSyncNow = async (options: IMConfigSyncOptions = {}): Promise<IMConfigSyncResult> => {
    if (options.restartGatewayIfRunning) {
      imConfigSyncRestartGatewayIfRunning = true;
    }
    if (imConfigSyncTimer) {
      clearTimeout(imConfigSyncTimer);
      imConfigSyncTimer = null;
    }
    if (imConfigSyncRunning) {
      imConfigSyncPending = true;
      return { success: true, pending: true };
    }
    return await doImConfigSync();
  };

  const recordImOpenClawConfigMutation = (
    previousFingerprint: string,
    nextFingerprint: string,
    options: IMConfigSetOptions = {},
  ) => {
    ensureLastSyncedImOpenClawConfigFingerprint(previousFingerprint);
    if (options.markRestartOnSave) {
      imConfigRestartOnNextSettingsSave = true;
    }
    const impactDecision = classifyImOpenClawConfigChange(previousFingerprint, nextFingerprint, {
      forceRestart: options.restartGatewayIfRunning === true,
    });
    if (impactDecision.impact === OpenClawConfigImpact.None) {
      return;
    }

    if (options.syncGateway) {
      scheduleImConfigSync({
        restartGatewayIfRunning:
          options.restartGatewayIfRunning === true
          || impactDecision.impact === OpenClawConfigImpact.Restart,
      });
    }
  };

  const mutateImOpenClawConfig = (
    mutate: () => void,
    options: IMConfigSetOptions = {},
  ) => {
    const previousFingerprint = getCurrentImOpenClawConfigFingerprint();
    mutate();
    const nextFingerprint = getCurrentImOpenClawConfigFingerprint();
    recordImOpenClawConfigMutation(previousFingerprint, nextFingerprint, options);
  };

  ipcMain.handle('im:config:set', async (_event, config: Partial<IMGatewayConfig>, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(() => {
        getIMGatewayManager().setConfig(config, { syncGateway: false });
      }, {
        syncGateway: options?.syncGateway,
        restartGatewayIfRunning: options?.restartGatewayIfRunning,
        markRestartOnSave: options?.markRestartOnSave,
      });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set IM config',
      };
    }
  });

  // Explicitly trigger OpenClaw config sync + gateway restart.
  // Called from the global Settings Save button after config fields have been
  // persisted to DB via im:config:set (without syncGateway flag).
  ipcMain.handle('im:config:sync', async () => {
    try {
      const nextFingerprint = getCurrentImOpenClawConfigFingerprint();
      const previousFingerprint = ensureLastSyncedImOpenClawConfigFingerprint(nextFingerprint);
      const impactDecision = classifyImOpenClawConfigChange(previousFingerprint, nextFingerprint, {
        forceRestart: imConfigRestartOnNextSettingsSave,
      });
      if (impactDecision.impact === OpenClawConfigImpact.None) {
        lastSyncedImOpenClawConfigFingerprint = nextFingerprint;
        return { success: true, skipped: true };
      }
      const syncResult = await runImConfigSyncNow({
        restartGatewayIfRunning: impactDecision.impact === OpenClawConfigImpact.Restart,
      });
      if (!syncResult.success) {
        return { success: false, error: syncResult.error };
      }
      return { success: true, skipped: false };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to sync IM config',
      };
    }
  });

  ipcMain.handle('im:gateway:start', async (_event, platform: Platform) => {
    try {
      // Persist enabled state
      const manager = getIMGatewayManager();
      manager.setConfig({ [platform]: { enabled: true } });
      await manager.startGateway(platform);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start gateway',
      };
    }
  });

  ipcMain.handle('im:gateway:stop', async (_event, platform: Platform) => {
    try {
      // Persist disabled state
      const manager = getIMGatewayManager();
      manager.setConfig({ [platform]: { enabled: false } });
      await manager.stopGateway(platform);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to stop gateway',
      };
    }
  });

  ipcMain.handle('im:gateway:test', async (
    _event,
    platform: Platform,
    configOverride?: Partial<IMGatewayConfig>
  ) => {
    try {
      const result = await getIMGatewayManager().testGateway(platform, configOverride);
      return { success: true, result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to test gateway connectivity',
      };
    }
  });

  // Weixin QR login
  ipcMain.handle('im:weixin:qr-login-start', async () => {
    try {
      const result = await getIMGatewayManager().weixinQrLoginStart();
      return { success: true, ...result };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Failed to start Weixin QR login' };
    }
  });

  ipcMain.handle('im:weixin:qr-login-wait', async (_event, sessionKey?: string) => {
    try {
      const result = await getIMGatewayManager().weixinQrLoginWait(sessionKey);
      return { success: true, ...result };
    } catch (error) {
      return { success: false, connected: false, message: error instanceof Error ? error.message : 'Weixin QR login failed' };
    }
  });

  // POPO QR login
  ipcMain.handle('im:popo:qr-login-start', async () => {
    try {
      const result = getIMGatewayManager().popoQrLoginStart();
      return { success: true, ...result };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Failed to start POPO QR login' };
    }
  });

  ipcMain.handle('im:popo:qr-login-poll', async (_event, taskToken: string) => {
    try {
      const result = await getIMGatewayManager().popoQrLoginPoll(taskToken);
      return result;
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'POPO QR login poll failed' };
    }
  });

  ipcMain.handle('im:status:get', async () => {
    try {
      const status = await getIMGatewayManager().getStatusWithOpenClawRuntime();
      return { success: true, status };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get IM status',
      };
    }
  });

  ipcMain.handle('im:getLocalIp', () => {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
    return '127.0.0.1';
  });
  ipcMain.handle('im:openclaw:config-schema', async () => {
    try {
      const result = await getIMGatewayManager().getOpenClawConfigSchema();
      return { success: true, result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get OpenClaw config schema',
      };
    }
  });

  // ---- Pairing IPC handlers ----

  ipcMain.handle('im:pairing:list', async (_event, platform: string) => {
    try {
      const stateDir = getOpenClawEngineManager().getStateDir();
      const requests = listPairingRequests(platform, stateDir);
      const allowFrom = readAllowFromStore(platform, stateDir);
      return { success: true, requests, allowFrom };
    } catch (error) {
      return {
        success: false,
        requests: [],
        allowFrom: [],
        error: error instanceof Error ? error.message : 'Failed to list pairing requests',
      };
    }
  });

  ipcMain.handle('im:pairing:approve', async (_event, platform: string, code: string) => {
    try {
      const stateDir = getOpenClawEngineManager().getStateDir();
      const approved = approvePairingCode(platform, code, stateDir);
      if (!approved) {
        return { success: false, error: 'Pairing code not found or expired' };
      }
      // Restart gateway so it reloads the updated allowFrom from disk
      // (OpenClaw SDK caches allowFrom in memory)
      await syncOpenClawConfig({
        reason: `im-pairing-approval:${platform}`,
        restartGatewayIfRunning: true,
      });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to approve pairing code',
      };
    }
  });

  ipcMain.handle('im:pairing:reject', async (_event, platform: string, code: string) => {
    try {
      const stateDir = getOpenClawEngineManager().getStateDir();
      const rejected = rejectPairingRequest(platform, code, stateDir);
      if (!rejected) {
        return { success: false, error: 'Pairing code not found or expired' };
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reject pairing request',
      };
    }
  });

  ipcMain.handle('im:dingtalk:instance:add', async (_event, name: string) => {
    try {
      const { DEFAULT_DINGTALK_OPENCLAW_CONFIG } = await import('./im/types');
      const instanceId = crypto.randomUUID();
      const instance = {
        ...DEFAULT_DINGTALK_OPENCLAW_CONFIG,
        instanceId,
        instanceName: name || 'DingTalk Bot',
      };
      getIMGatewayManager().getIMStore().setDingTalkInstanceConfig(instanceId, instance);
      return { success: true, instance };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add DingTalk instance',
      };
    }
  });

  ipcMain.handle('im:dingtalk:instance:delete', async (_event, instanceId: string, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().deleteDingTalkInstance(instanceId),
        {
          syncGateway: options?.syncGateway ?? true,
          restartGatewayIfRunning: options?.restartGatewayIfRunning ?? true,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete DingTalk instance',
      };
    }
  });

  ipcMain.handle('im:dingtalk:instance:config:set', async (_event, instanceId: string, config: Record<string, unknown>, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().setDingTalkInstanceConfig(instanceId, config as never),
        {
          syncGateway: options?.syncGateway,
          restartGatewayIfRunning: options?.restartGatewayIfRunning,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set DingTalk instance config',
      };
    }
  });

  ipcMain.handle('im:feishu:instance:add', async (_event, name: string) => {
    try {
      const { DEFAULT_FEISHU_OPENCLAW_CONFIG } = await import('./im/types');
      const instanceId = crypto.randomUUID();
      const instance = {
        ...DEFAULT_FEISHU_OPENCLAW_CONFIG,
        instanceId,
        instanceName: name || 'Feishu Bot',
      };
      getIMGatewayManager().getIMStore().setFeishuInstanceConfig(instanceId, instance);
      return { success: true, instance };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add Feishu instance',
      };
    }
  });

  ipcMain.handle('im:feishu:instance:delete', async (_event, instanceId: string, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().deleteFeishuInstance(instanceId),
        {
          syncGateway: options?.syncGateway ?? true,
          restartGatewayIfRunning: options?.restartGatewayIfRunning ?? true,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete Feishu instance',
      };
    }
  });

  ipcMain.handle('im:feishu:instance:config:set', async (_event, instanceId: string, config: Record<string, unknown>, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().setFeishuInstanceConfig(instanceId, config as never),
        {
          syncGateway: options?.syncGateway,
          restartGatewayIfRunning: options?.restartGatewayIfRunning,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set Feishu instance config',
      };
    }
  });

  ipcMain.handle('im:telegram:instance:add', async (_event, name: string) => {
    try {
      const { DEFAULT_TELEGRAM_OPENCLAW_CONFIG } = await import('./im/types');
      const instanceId = crypto.randomUUID();
      const instance: TelegramInstanceConfig = {
        ...DEFAULT_TELEGRAM_OPENCLAW_CONFIG,
        instanceId,
        instanceName: name || 'Telegram Bot',
      };
      getIMGatewayManager().getIMStore().setTelegramInstanceConfig(instanceId, instance);
      return { success: true, instance };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add Telegram instance',
      };
    }
  });

  ipcMain.handle('im:telegram:instance:delete', async (_event, instanceId: string, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().deleteTelegramInstance(instanceId),
        {
          syncGateway: options?.syncGateway ?? true,
          restartGatewayIfRunning: options?.restartGatewayIfRunning ?? true,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete Telegram instance',
      };
    }
  });

  ipcMain.handle('im:telegram:instance:config:set', async (_event, instanceId: string, config: Partial<TelegramInstanceConfig>, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().setTelegramInstanceConfig(instanceId, config),
        {
          syncGateway: options?.syncGateway,
          restartGatewayIfRunning: options?.restartGatewayIfRunning,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set Telegram instance config',
      };
    }
  });

  ipcMain.handle('im:discord:instance:add', async (_event, name: string) => {
    try {
      const { DEFAULT_DISCORD_OPENCLAW_CONFIG } = await import('./im/types');
      const instanceId = crypto.randomUUID();
      const instance: DiscordInstanceConfig = {
        ...DEFAULT_DISCORD_OPENCLAW_CONFIG,
        instanceId,
        instanceName: name || 'Discord Bot',
      };
      getIMGatewayManager().getIMStore().setDiscordInstanceConfig(instanceId, instance);
      return { success: true, instance };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add Discord instance',
      };
    }
  });

  ipcMain.handle('im:discord:instance:delete', async (_event, instanceId: string, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().deleteDiscordInstance(instanceId),
        {
          syncGateway: options?.syncGateway ?? true,
          restartGatewayIfRunning: options?.restartGatewayIfRunning ?? true,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete Discord instance',
      };
    }
  });

  ipcMain.handle('im:discord:instance:config:set', async (_event, instanceId: string, config: Partial<DiscordInstanceConfig>, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().setDiscordInstanceConfig(instanceId, config),
        {
          syncGateway: options?.syncGateway,
          restartGatewayIfRunning: options?.restartGatewayIfRunning,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set Discord instance config',
      };
    }
  });

  ipcMain.handle('im:qq:instance:add', async (_event, name: string) => {
    try {
      const { DEFAULT_QQ_CONFIG } = await import('./im/types');
      const instanceId = crypto.randomUUID();
      const instance = {
        ...DEFAULT_QQ_CONFIG,
        instanceId,
        instanceName: name || 'QQ Bot',
      };
      getIMGatewayManager().getIMStore().setQQInstanceConfig(instanceId, instance);
      return { success: true, instance };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add QQ instance',
      };
    }
  });

  ipcMain.handle('im:qq:instance:delete', async (_event, instanceId: string, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().deleteQQInstance(instanceId),
        {
          syncGateway: options?.syncGateway ?? true,
          restartGatewayIfRunning: options?.restartGatewayIfRunning ?? true,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete QQ instance',
      };
    }
  });

  ipcMain.handle('im:qq:instance:config:set', async (_event, instanceId: string, config: Record<string, unknown>, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().setQQInstanceConfig(instanceId, config as never),
        {
          syncGateway: options?.syncGateway,
          restartGatewayIfRunning: options?.restartGatewayIfRunning,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set QQ instance config',
      };
    }
  });

  ipcMain.handle('im:nim:instance:add', async (_event, name: string) => {
    try {
      const { DEFAULT_NIM_CONFIG } = await import('./im/types');
      const instanceId = crypto.randomUUID();
      const instance = {
        ...DEFAULT_NIM_CONFIG,
        instanceId,
        instanceName: name || 'NIM Bot',
      };
      getIMGatewayManager().getIMStore().setNimInstanceConfig(instanceId, instance);
      return { success: true, instance };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add NIM instance',
      };
    }
  });

  ipcMain.handle('im:nim:instance:delete', async (_event, instanceId: string, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().deleteNimInstance(instanceId),
        {
          syncGateway: options?.syncGateway ?? true,
          restartGatewayIfRunning: options?.restartGatewayIfRunning ?? true,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete NIM instance',
      };
    }
  });

  ipcMain.handle('im:nim:instance:config:set', async (_event, instanceId: string, config: Record<string, unknown>, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().setNimInstanceConfig(instanceId, config as never),
        {
          syncGateway: options?.syncGateway,
          restartGatewayIfRunning: options?.restartGatewayIfRunning,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set NIM instance config',
      };
    }
  });

  ipcMain.handle('im:popo:instance:add', async (_event, name: string) => {
    try {
      const { DEFAULT_POPO_CONFIG } = await import('./im/types');
      const instanceId = crypto.randomUUID();
      const instance = {
        ...DEFAULT_POPO_CONFIG,
        instanceId,
        instanceName: name || 'POPO Bot',
      };
      getIMGatewayManager().getIMStore().setPopoInstanceConfig(instanceId, instance);
      return { success: true, instance };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add POPO instance',
      };
    }
  });

  ipcMain.handle('im:popo:instance:delete', async (_event, instanceId: string, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().deletePopoInstance(instanceId),
        {
          syncGateway: options?.syncGateway ?? true,
          restartGatewayIfRunning: options?.restartGatewayIfRunning ?? true,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete POPO instance',
      };
    }
  });

  ipcMain.handle('im:popo:instance:config:set', async (_event, instanceId: string, config: Record<string, unknown>, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().setPopoInstanceConfig(instanceId, config as never),
        {
          syncGateway: options?.syncGateway,
          restartGatewayIfRunning: options?.restartGatewayIfRunning,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set POPO instance config',
      };
    }
  });

  ipcMain.handle('im:wecom:instance:add', async (_event, name: string) => {
    try {
      const { DEFAULT_WECOM_CONFIG } = await import('./im/types');
      const instanceId = crypto.randomUUID();
      const instance = {
        ...DEFAULT_WECOM_CONFIG,
        instanceId,
        instanceName: name || 'WeCom Bot',
      };
      getIMGatewayManager().getIMStore().setWecomInstanceConfig(instanceId, instance);
      return { success: true, instance };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add WeCom instance',
      };
    }
  });

  ipcMain.handle('im:wecom:instance:delete', async (_event, instanceId: string, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().deleteWecomInstance(instanceId),
        {
          syncGateway: options?.syncGateway ?? true,
          restartGatewayIfRunning: options?.restartGatewayIfRunning ?? true,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete WeCom instance',
      };
    }
  });

  ipcMain.handle('im:wecom:instance:config:set', async (_event, instanceId: string, config: Record<string, unknown>, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().setWecomInstanceConfig(instanceId, config as never),
        {
          syncGateway: options?.syncGateway,
          restartGatewayIfRunning: options?.restartGatewayIfRunning,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set WeCom instance config',
      };
    }
  });

  ipcMain.handle('im:email:instance:add', async (_event, name: string) => {
    try {
      const { DEFAULT_EMAIL_INSTANCE_CONFIG } = await import('./im/types');
      type EmailInstanceConfig = import('./im/types').EmailInstanceConfig;
      const instanceId = crypto.randomUUID();
      const instance: EmailInstanceConfig = {
        ...DEFAULT_EMAIL_INSTANCE_CONFIG,
        instanceId,
        instanceName: name || 'Email Bot',
        email: '',
        agentId: 'main',
        enabled: false,
        transport: 'ws',
      };
      getIMGatewayManager().getIMStore().setEmailInstanceConfig(instanceId, instance);
      return { success: true, instance };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add Email instance',
      };
    }
  });

  ipcMain.handle('im:email:instance:delete', async (_event, instanceId: string, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().deleteEmailInstance(instanceId),
        {
          syncGateway: options?.syncGateway ?? true,
          restartGatewayIfRunning: options?.restartGatewayIfRunning ?? true,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete Email instance',
      };
    }
  });

  ipcMain.handle('im:email:instance:config:set', async (_event, instanceId: string, config: Record<string, unknown>, options?: IMConfigSetOptions) => {
    try {
      mutateImOpenClawConfig(
        () => getIMGatewayManager().getIMStore().setEmailInstanceConfig(instanceId, config as never),
        {
          syncGateway: options?.syncGateway,
          restartGatewayIfRunning: options?.restartGatewayIfRunning,
          markRestartOnSave: options?.markRestartOnSave,
        },
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set Email instance config',
      };
    }
  });

  // Feishu bot install helpers
  ipcMain.handle('feishu:install:qrcode', async (_event, { isLark }: { isLark: boolean }) => {
    try {
      return await getIMGatewayManager().startFeishuInstallQrcode(isLark);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : '获取二维码失败');
    }
  });

  ipcMain.handle('feishu:install:poll', async (_event, { deviceCode }: { deviceCode: string }) => {
    try {
      return await getIMGatewayManager().pollFeishuInstall(deviceCode);
    } catch (error) {
      return { done: false, error: error instanceof Error ? error.message : '轮询失败' };
    }
  });

  ipcMain.handle('feishu:install:verify', async (_event, { appId, appSecret }: { appId: string; appSecret: string }) => {
    try {
      return await getIMGatewayManager().verifyFeishuCredentials(appId, appSecret);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '验证失败' };
    }
  });

  ipcMain.handle('github-copilot:request-device-code', async () => {
    const { requestDeviceCode } = await import('./libs/githubCopilotAuth');
    try {
      const result = await requestDeviceCode();
      return {
        userCode: result.user_code,
        verificationUri: result.verification_uri,
        deviceCode: result.device_code,
        interval: result.interval,
        expiresIn: result.expires_in,
      };
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Failed to request device code');
    }
  });

  ipcMain.handle('github-copilot:poll-for-token', async (_event, { deviceCode, interval, expiresIn }: { deviceCode: string; interval: number; expiresIn: number }) => {
    const { getCopilotToken, getGitHubUser, pollForAccessToken } = await import('./libs/githubCopilotAuth');
    try {
      const githubAccessToken = await pollForAccessToken(deviceCode, interval, expiresIn);
      const githubUser = await getGitHubUser(githubAccessToken);
      const { token: copilotToken, expiresAt, baseUrl } = await getCopilotToken(githubAccessToken);
      getStore().set('github_copilot_github_token', githubAccessToken);
      setCopilotTokenState({ copilotToken, baseUrl, expiresAt, githubToken: githubAccessToken });
      return { success: true, token: copilotToken, githubUser, baseUrl };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Authentication failed' };
    }
  });

  ipcMain.handle('github-copilot:cancel-polling', async () => {
    const { cancelPolling } = await import('./libs/githubCopilotAuth');
    cancelPolling();
  });

  ipcMain.handle('github-copilot:sign-out', async () => {
    getStore().delete('github_copilot_github_token');
    clearCopilotTokenState();
  });

  ipcMain.handle('github-copilot:refresh-token', async () => {
    try {
      const state = await refreshCopilotTokenNow();
      return { success: true, token: state.copilotToken, baseUrl: state.baseUrl };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Token refresh failed' };
    }
  });

  ipcMain.handle('openai-codex-oauth:start', async () => {
    const { startOpenAICodexLogin } = await import('./libs/openaiCodexAuth');
    try {
      const tokens = await startOpenAICodexLogin();
      return {
        success: true as const,
        email: tokens.email ?? null,
        accountId: tokens.accountId ?? null,
        expiresAt: tokens.expiresAt,
      };
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('openai-codex-oauth:cancel', async () => {
    const { cancelOpenAICodexLogin } = await import('./libs/openaiCodexAuth');
    cancelOpenAICodexLogin();
  });

  ipcMain.handle('openai-codex-oauth:logout', async () => {
    const { logoutOpenAICodex } = await import('./libs/openaiCodexAuth');
    logoutOpenAICodex();
  });

  ipcMain.handle('openai-codex-oauth:status', async () => {
    const { readOpenAICodexAuthFile } = await import('./libs/openaiCodexAuth');
    const tokens = readOpenAICodexAuthFile();
    if (!tokens) return { loggedIn: false as const };
    return {
      loggedIn: true as const,
      email: tokens.email ?? null,
      accountId: tokens.accountId ?? null,
      expiresAt: tokens.expiresAt,
    };
  });

  ipcMain.handle('generate-session-title', async (_event, userInput: string | null) => {
    return generateSessionTitle(userInput, t('coworkDefaultSessionTitle'));
  });

  ipcMain.handle('get-recent-cwds', async (_event, limit?: number) => {
    const boundedLimit = limit ? Math.min(Math.max(limit, 1), 20) : 8;
    return getCoworkStore().listRecentCwds(boundedLimit);
  });

  ipcMain.handle('get-api-config', async () => {
    return getCurrentApiConfig();
  });

  ipcMain.handle('check-api-config', async (_event, options?: { probeModel?: boolean }) => {
    const { config, error } = resolveCurrentApiConfig();
    if (config && options?.probeModel) {
      const probe = await probeCoworkModelReadiness();
      if (probe.ok === false) {
        return { hasConfig: false, config: null, error: probe.error };
      }
    }
    return { hasConfig: config !== null, config, error };
  });

  ipcMain.handle('save-api-config', async (_event, config: {
    apiKey: string;
    baseURL: string;
    model: string;
    apiType?: 'anthropic' | 'openai';
  }) => {
    try {
      saveCoworkApiConfig(config);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save API config',
      };
    }
  });

  // Dialog handlers
  ipcMain.handle('dialog:selectDirectory', async (event) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions = {
      properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[],
    };
    const result = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, path: null };
    }
    return { success: true, path: result.filePaths[0] };
  });

  ipcMain.handle('dialog:selectFile', async (event, options?: { title?: string; filters?: { name: string; extensions: string[] }[] }) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions = {
      properties: ['openFile'] as ('openFile')[],
      title: options?.title,
      filters: options?.filters,
    };
    const result = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, path: null };
    }
    return { success: true, path: result.filePaths[0] };
  });

  ipcMain.handle('dialog:selectFiles', async (event, options?: { title?: string; filters?: { name: string; extensions: string[] }[] }) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions = {
      properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[],
      title: options?.title,
      filters: options?.filters,
    };
    const result = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, paths: [] };
    }
    return { success: true, paths: result.filePaths };
  });

  ipcMain.handle(
    'dialog:saveInlineFile',
    async (
      _event,
      options?: { dataBase64?: string; fileName?: string; mimeType?: string; cwd?: string }
    ) => {
      try {
        const dataBase64 = typeof options?.dataBase64 === 'string' ? options.dataBase64.trim() : '';
        if (!dataBase64) {
          return { success: false, path: null, error: 'Missing file data' };
        }

        const buffer = Buffer.from(dataBase64, 'base64');
        if (!buffer.length) {
          return { success: false, path: null, error: 'Invalid file data' };
        }
        if (buffer.length > MAX_INLINE_ATTACHMENT_BYTES) {
          return {
            success: false,
            path: null,
            error: `File too large (max ${Math.floor(MAX_INLINE_ATTACHMENT_BYTES / (1024 * 1024))}MB)`,
          };
        }

        const dir = resolveInlineAttachmentDir(options?.cwd);
        await fs.promises.mkdir(dir, { recursive: true });

        const safeFileName = sanitizeAttachmentFileName(options?.fileName);
        const extension = inferAttachmentExtension(safeFileName, options?.mimeType);
        const baseName = extension ? safeFileName.slice(0, -extension.length) : safeFileName;
        const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const finalName = `${baseName || 'attachment'}-${uniqueSuffix}${extension}`;
        const outputPath = path.join(dir, finalName);

        await fs.promises.writeFile(outputPath, buffer);
        return { success: true, path: outputPath };
      } catch (error) {
        return {
          success: false,
          path: null,
          error: error instanceof Error ? error.message : 'Failed to save inline file',
        };
      }
    }
  );

  // Read a local file as a data URL (data:<mime>;base64,...)
  const MAX_READ_AS_DATA_URL_BYTES = 20 * 1024 * 1024;
  const MIME_BY_EXT: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
  };
  ipcMain.handle(
    'dialog:readFileAsDataUrl',
    async (_event, filePath?: string): Promise<{ success: boolean; dataUrl?: string; error?: string }> => {
      try {
        if (typeof filePath !== 'string' || !filePath.trim()) {
          return { success: false, error: 'Missing file path' };
        }
        const resolvedPath = resolveShellFilePath(filePath);
        const stat = await fs.promises.stat(resolvedPath);
        if (!stat.isFile()) {
          return { success: false, error: 'Not a file' };
        }
        if (stat.size > MAX_READ_AS_DATA_URL_BYTES) {
          return {
            success: false,
            error: `File too large (max ${Math.floor(MAX_READ_AS_DATA_URL_BYTES / (1024 * 1024))}MB)`,
          };
        }
        const buffer = await fs.promises.readFile(resolvedPath);
        const ext = path.extname(resolvedPath).toLowerCase();
        const mimeType = MIME_BY_EXT[ext] || 'application/octet-stream';
        const base64 = buffer.toString('base64');
        return { success: true, dataUrl: `data:${mimeType};base64,${base64}` };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to read file',
        };
      }
    }
  );

  const MAX_READ_TEXT_FILE_BYTES = 2 * 1024 * 1024;
  ipcMain.handle(
    DialogIpc.ReadTextFile,
    async (_event, filePath?: string): Promise<{ success: boolean; content?: string; size?: number; readBytes?: number; truncated?: boolean; error?: string }> => {
      try {
        if (typeof filePath !== 'string' || !filePath.trim()) {
          return { success: false, error: 'Missing file path' };
        }
        const resolvedPath = resolveShellFilePath(filePath);
        const stat = await fs.promises.stat(resolvedPath);
        if (!stat.isFile()) {
          return { success: false, error: 'Not a file' };
        }

        const truncated = stat.size > MAX_READ_TEXT_FILE_BYTES;
        const handle = await fs.promises.open(resolvedPath, 'r');
        try {
          const bytesToRead = Math.min(stat.size, MAX_READ_TEXT_FILE_BYTES);
          const buffer = Buffer.alloc(bytesToRead);
          const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
          return {
            success: true,
            content: buffer.subarray(0, bytesRead).toString('utf8'),
            size: stat.size,
            readBytes: bytesRead,
            truncated,
          };
        } finally {
          await handle.close();
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to read text file',
        };
      }
    }
  );

  ipcMain.handle(
    QingShuFileIpcChannel.Publish,
    async (_event, filePath?: string): Promise<QingShuFilePublishResult> => publishQingShuFile(filePath),
  );

  ipcMain.handle(SpeechIpcChannel.GetAvailability, async () => {
    if (!isMacSpeechInputEnabled()) {
      return {
        enabled: false,
        supported: false,
        platform: process.platform,
        permission: SpeechPermissionStatus.Unsupported,
        speechAuthorization: SpeechPermissionStatus.Unsupported,
        microphoneAuthorization: SpeechPermissionStatus.Unsupported,
        listening: false,
      };
    }
    return macSpeechService.getAvailability();
  });

  ipcMain.handle(SpeechIpcChannel.Start, async (_event, options?: SpeechStartOptions) => {
    if (!isMacSpeechInputEnabled()) {
      return { success: false, error: SpeechErrorCode.HelperUnavailable };
    }
    await ttsRouterService.stop();
    const origin = await wakeInputService.prepareForegroundSpeechStart(normalizeForegroundSpeechOrigin(options));
    let result = await macSpeechService.start(options);
    if (!result.success && result.error === SpeechErrorCode.AlreadyListening) {
      await new Promise((resolve) => setTimeout(resolve, FOREGROUND_SPEECH_RETRY_DELAY_MS));
      result = await macSpeechService.start(options);
    }
    if (result.success) {
      await wakeInputService.syncAvailability({ supported: true });
      clearForegroundSpeechRecoveryTimer();
      foregroundSpeechRecoveryAttempts = 0;
      foregroundSpeechOrigin = origin;
      foregroundSpeechStartOptions = {
        ...options,
        source: origin === 'follow_up' ? SpeechStartSource.FollowUp : origin,
      };
      return result;
    }
    resetForegroundSpeechRecoveryState();
    wakeInputService.handleForegroundSpeechEnded(origin);
    return result;
  });

  ipcMain.handle(SpeechIpcChannel.Stop, async () => {
    resetForegroundSpeechRecoveryState();
    return macSpeechService.stop();
  });

  ipcMain.handle(SpeechIpcChannel.FollowUpArm, async (_event, payload?: SpeechFollowUpArmRequest) => {
    if (!payload?.config) {
      return { success: false, error: 'Missing follow-up dictation config.' };
    }
    armSpeechFollowUp(payload);
    return { success: true };
  });

  ipcMain.handle(SpeechIpcChannel.FollowUpDisarm, async () => {
    disarmSpeechFollowUp('renderer requested disarm');
    return { success: true };
  });

  ipcMain.handle(SpeechIpcChannel.FollowUpSetActiveSession, async (_event, payload?: SpeechFollowUpActiveSessionRequest) => {
    setSpeechFollowUpActiveSession({ sessionId: payload?.sessionId ?? null });
    return { success: true };
  });

  ipcMain.handle(WakeInputIpcChannel.GetStatus, async () => {
    return wakeInputService.getStatus();
  });

  ipcMain.handle(WakeInputIpcChannel.UpdateConfig, async (_event, partialConfig?: Partial<WakeInputConfig>) => {
    const config = wakeInputService.updateConfig(mergeWakeInputConfig(partialConfig));
    return { success: true, status: config };
  });

  ipcMain.handle(TtsIpcChannel.GetAvailability, async (_event, options?: TtsQueryOptions) => {
    return ttsRouterService.getAvailability(options);
  });

  ipcMain.handle(TtsIpcChannel.GetVoices, async (_event, options?: TtsQueryOptions) => {
    try {
      const voices = await ttsRouterService.getVoices(options);
      return { success: true, voices };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to list TTS voices.' };
    }
  });

  ipcMain.handle(TtsIpcChannel.Prepare, async (_event, options?: TtsPrepareOptions) => {
    return ttsRouterService.prepare(options);
  });

  ipcMain.handle(TtsIpcChannel.Speak, async (_event, options?: TtsSpeakOptions) => {
    if (options?.source === TtsPlaybackSource.AssistantReply) {
      await stopForegroundSpeechIfActive('assistant reply TTS is starting');
    }
    return ttsRouterService.speak(options ?? { text: '' });
  });

  ipcMain.handle(TtsIpcChannel.Stop, async () => {
    return ttsRouterService.stop();
  });

  ipcMain.handle(SpeechIpcChannel.TriggerSystemDictation, async () => {
    try {
      console.log(`[Voice] Dictation shortcut requested on ${process.platform}.`);
      const { exec } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(exec);

      if (process.platform === 'win32') {
        await execAsync(`powershell -NoProfile -Command "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class KS{[DllImport(\\\"user32.dll\\\")]public static extern void keybd_event(byte k,byte s,uint f,int e);public static void WinH(){keybd_event(0x5B,0,0,0);keybd_event(0x48,0,0,0);keybd_event(0x48,0,2,0);keybd_event(0x5B,0,2,0);}}'; [KS]::WinH()"`, { timeout: 5000 });
        console.log('[Voice] Windows dictation shortcut was sent successfully.');
        return { success: true };
      }

      if (process.platform === 'darwin') {
        if (!systemPreferences.isTrustedAccessibilityClient(false)) {
          console.warn('[Voice] macOS Accessibility permission is missing; requesting permission.');
          systemPreferences.isTrustedAccessibilityClient(true);
          return { success: false, error: 'permission_denied' };
        }

        try {
          await execAsync(`osascript -e 'tell application "System Events"
  set frontProcess to first application process whose frontmost is true
  tell frontProcess
    set editMenu to missing value
    repeat with menuBarItem in menu bar items of menu bar 1
      set itemName to name of menuBarItem
      if itemName is "Edit" or itemName is "编辑" then
        set editMenu to menu 1 of menuBarItem
        exit repeat
      end if
    end repeat
    if editMenu is missing value then error "Edit menu not found"
    set dictationItem to missing value
    repeat with menuItem in menu items of editMenu
      set itemName to name of menuItem
      if itemName contains "Dictation" or itemName contains "听写" then
        set dictationItem to menuItem
        exit repeat
      end if
    end repeat
    if dictationItem is missing value then error "Dictation menu item not found"
    click dictationItem
  end tell
end tell'`, { timeout: 5000 });
          console.log('[Voice] macOS dictation menu item was clicked successfully.');
          return { success: true };
        } catch (menuError) {
          console.warn('[Voice] macOS dictation menu item failed; falling back to keyboard shortcut:', menuError);
        }

        try {
          await execAsync(`osascript -e 'tell application "System Events" to key code 96'`, { timeout: 5000 });
          console.log('[Voice] macOS dictation key shortcut was sent successfully.');
          return { success: true };
        } catch (dictationKeyError) {
          console.warn('[Voice] macOS dictation key shortcut failed; falling back to Fn shortcut:', dictationKeyError);
        }

        try {
          await execAsync(`osascript -e 'tell application "System Events" to key code 63' -e 'delay 0.05' -e 'tell application "System Events" to key code 63'`, { timeout: 5000 });
          console.log('[Voice] macOS Fn dictation shortcut was sent successfully.');
          return { success: true };
        } catch (darwinError) {
          const stderr = typeof darwinError === 'object' && darwinError && 'stderr' in darwinError
            ? String((darwinError as { stderr?: unknown }).stderr ?? '')
            : '';
          const message = darwinError instanceof Error ? darwinError.message : String(darwinError);
          const lowerErrorText = `${stderr}\n${message}`.toLowerCase();
          if (
            lowerErrorText.includes('not allowed assistive access') ||
            lowerErrorText.includes('assistive') ||
            lowerErrorText.includes('not authorized') ||
            lowerErrorText.includes('1002')
          ) {
            return { success: false, error: 'permission_denied' };
          }
          console.warn('[Voice] macOS dictation shortcut failed:', darwinError);
          return { success: false, error: message || 'Unknown error' };
        }
      }

      console.warn(`[Voice] Dictation shortcut is unsupported on ${process.platform}.`);
      return { success: false, error: 'Unsupported platform' };
    } catch (error) {
      console.warn('[Voice] Dictation shortcut failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Shell handlers - 打开文件/文件夹
  ipcMain.handle('shell:openPath', async (_event, filePath: string) => {
    try {
      const resolved = resolveExistingShellFilePath(filePath);
      if (resolved.ok === false) return { success: false, error: resolved.error };
      const normalizedPath = resolved.path;
      const result = await shell.openPath(normalizedPath);
      if (result) {
        console.warn('[Shell] open path failed:', normalizedPath, result);
        return { success: false, error: `${result}: ${normalizedPath}` };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('shell:showItemInFolder', async (_event, filePath: string) => {
    try {
      const resolved = resolveExistingShellFilePath(filePath);
      if (resolved.ok === false) return { success: false, error: resolved.error };
      shell.showItemInFolder(resolved.path);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    try {
      if (typeof url === 'string' && isPreviewServerUrl(url)) {
        await shell.openExternal(url);
        return { success: true };
      }
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('shell:getAppsForFile', async (_event, filePath: string) => {
    try {
      const resolved = resolveExistingShellFilePath(filePath);
      if (resolved.ok === false) return { success: false, apps: [], error: resolved.error };
      const apps = await getAppsForFile(resolved.path);
      return { success: true, apps };
    } catch (error) {
      return { success: false, apps: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('shell:openPathWithApp', async (_event, filePath: string, appPath: string) => {
    try {
      const resolved = resolveExistingShellFilePath(filePath);
      if (resolved.ok === false) return { success: false, error: resolved.error };
      if (typeof appPath !== 'string' || !appPath.trim()) {
        return { success: false, error: 'Missing app path' };
      }
      await openFileWithApp(resolved.path, appPath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(ArtifactIpcChannel.OpenHtmlInBrowser, async (_event, htmlContent: string) => {
    try {
      const tmpDir = path.join(os.tmpdir(), 'lobsterai-preview');
      fs.mkdirSync(tmpDir, { recursive: true });
      const tmpFile = path.join(tmpDir, `preview-${Date.now()}.html`);
      fs.writeFileSync(tmpFile, htmlContent, 'utf-8');
      const result = await shell.openPath(tmpFile);
      if (result) {
        return { success: false, error: result };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(ClipboardIpc.WriteImageFromFile, async (_event, filePath: string) => {
    try {
      const normalizedPath = resolveShellFilePath(filePath);
      const image = nativeImage.createFromPath(normalizedPath);
      if (image.isEmpty()) {
        return { success: false, error: 'Failed to read image file' };
      }
      clipboard.writeImage(image);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(ClipboardIpc.WriteImageFromDataUrl, async (_event, dataUrl: string) => {
    try {
      const image = nativeImage.createFromDataURL(dataUrl);
      if (image.isEmpty()) {
        return { success: false, error: 'Failed to read image data' };
      }
      clipboard.writeImage(image);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  const artifactFileWatchers = new Map<string, { watcher: fs.FSWatcher; debounceTimer: ReturnType<typeof setTimeout> | null }>();

  ipcMain.handle(ArtifactIpcChannel.WatchFile, (_event, filePath: string) => {
    const normalizedPath = resolveShellFilePath(filePath);
    if (artifactFileWatchers.has(normalizedPath)) return;

    try {
      const watcher = fs.watch(normalizedPath, (eventType) => {
        if (eventType !== 'change') return;
        const entry = artifactFileWatchers.get(normalizedPath);
        if (!entry) return;

        if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
        entry.debounceTimer = setTimeout(() => {
          entry.debounceTimer = null;
          for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) {
              win.webContents.send(ArtifactIpcChannel.FileChanged, { filePath: normalizedPath });
            }
          }
        }, 300);
      });

      watcher.on('error', (error) => {
        console.warn('[Artifact] stopped watching file after watcher error:', error);
        artifactFileWatchers.delete(normalizedPath);
        watcher.close();
      });

      artifactFileWatchers.set(normalizedPath, { watcher, debounceTimer: null });
    } catch (error) {
      console.warn('[Artifact] failed to watch file:', error);
    }
  });

  ipcMain.handle(ArtifactIpcChannel.UnwatchFile, (_event, filePath: string) => {
    const normalizedPath = resolveShellFilePath(filePath);
    const entry = artifactFileWatchers.get(normalizedPath);
    if (!entry) return;

    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    entry.watcher.close();
    artifactFileWatchers.delete(normalizedPath);
  });

  ipcMain.handle(ArtifactPreviewIpc.CreateSession, async (_event, filePath: string) => {
    try {
      const resolved = resolveExistingShellFilePath(filePath);
      if (resolved.ok === false) return { success: false, error: resolved.error };
      const preview = await createPreviewSession(resolved.path);
      return { success: true, ...preview };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(ArtifactPreviewIpc.CreateOfficeSession, async (_event, filePath: string) => {
    try {
      const resolved = resolveExistingShellFilePath(filePath);
      if (resolved.ok === false) return { success: false, error: resolved.error };
      const preview = await createOfficePreviewSession(resolved.path);
      return { success: true, ...preview };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(ArtifactPreviewIpc.DestroySession, (_event, sessionId: string) => {
    destroyPreviewSession(sessionId);
    return { success: true };
  });

  ipcMain.handle(ArtifactPreviewIpc.ClearBrowserCookies, async () => {
    try {
      await session.fromPartition(ArtifactBrowserPartition.Default).clearStorageData({
        storages: ['cookies'],
      });
      return { success: true };
    } catch (error) {
      console.error('[ArtifactBrowser] failed to clear browser cookies:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(ArtifactPreviewIpc.ClearBrowserCache, async () => {
    try {
      await session.fromPartition(ArtifactBrowserPartition.Default).clearCache();
      return { success: true };
    } catch (error) {
      console.error('[ArtifactBrowser] failed to clear browser cache:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(LocalWebServicesIpc.List, async (_event, options?: ListLocalWebServicesOptions) => {
    const preferredPorts = sanitizeLocalWebServicePorts(options?.preferredPorts);
    const ports = Array.from(new Set([...preferredPorts, ...LOCAL_WEB_SERVICE_PORTS])).sort((a, b) => a - b);
    const results = await Promise.all(ports.map(port => probeLocalWebService(port)));
    return results.filter((service): service is LocalWebService => service !== null);
  });

  // App update state, download & install
  ipcMain.handle(AppUpdateIpc.GetState, async () => {
    return getAppUpdateCoordinator().getState();
  });

  ipcMain.handle(AppUpdateIpc.CheckNow, async (_event, options?: { manual?: boolean; userId?: string | null }) => {
    return getAppUpdateCoordinator().checkNow(options);
  });

  ipcMain.handle(AppUpdateIpc.SetAvailable, async (_event, info: AppUpdateInfo, options?: { source?: AppUpdateSource }) => {
    const state = getAppUpdateCoordinator().setAvailableUpdate(info, options?.source ?? AppUpdateSource.Manual);
    return { success: true, state };
  });

  ipcMain.handle(AppUpdateIpc.RetryDownload, async () => {
    const state = await getAppUpdateCoordinator().retryDownload();
    return { success: true, state };
  });

  ipcMain.handle(AppUpdateIpc.InstallReady, async () => {
    return getAppUpdateCoordinator().installReadyUpdate();
  });

  ipcMain.handle('appUpdate:download', async (event, url: string) => {
    // Block downloads in enterprise mode
    const enterprise = getStore().get<{ disableUpdate?: boolean }>('enterprise_config');
    if (enterprise?.disableUpdate) {
      return { success: false, error: 'Updates are managed by enterprise' };
    }
    try {
      const filePath = await downloadUpdate(url, (progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('appUpdate:downloadProgress', progress);
        }
      });
      return { success: true, filePath };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Download failed' };
    }
  });

  ipcMain.handle('appUpdate:cancelDownload', async () => {
    const state = getAppUpdateCoordinator().cancelDownload();
    return { success: true, state };
  });

  ipcMain.handle('appUpdate:install', async (_event, filePath: string) => {
    try {
      await installUpdate(filePath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Installation failed' };
    }
  });

  // API 代理处理程序 - 解决 CORS 问题
  const isCopilotUrl = (url: string) => url.includes('githubcopilot.com');
  const retryCopilotWithRefreshedToken = async (
    opts: { url: string; method: string; headers: Record<string, string>; body?: string },
  ): Promise<{ headers: Record<string, string>; retried: boolean }> => {
    try {
      const state = await refreshCopilotTokenNow();
      const refreshedHeaders = { ...opts.headers, Authorization: `Bearer ${state.copilotToken}` };
      console.log('[CopilotRetry] token refreshed, retrying request');
      return { headers: refreshedHeaders, retried: true };
    } catch (error) {
      console.warn('[CopilotRetry] token refresh failed, not retrying:', error);
      return { headers: opts.headers, retried: false };
    }
  };

  ipcMain.handle('api:fetch', async (_event, options: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }) => {
    console.log(`[api:fetch] ${options.method} ${options.url}`);
    const doFetch = async (headers: Record<string, string>) => {
      const response = await session.defaultSession.fetch(options.url, {
        method: options.method,
        headers,
        body: options.body,
      });

      const contentType = response.headers.get('content-type') || '';
      let data: string | object;

      if (contentType.includes('text/event-stream')) {
        // SSE 流式响应，返回完整的文本
        data = await response.text();
      } else if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        data,
      };
    };

    try {
      let result = await doFetch(options.headers);
      console.log(`[api:fetch] ${options.method} ${options.url} -> ${result.status} ${result.statusText}`, serializeForLog(result.data));

      if (!result.ok && (result.status === 401 || result.status === 403) && isCopilotUrl(options.url)) {
        console.log('[api:fetch] Copilot auth error, attempting token refresh and retry');
        const { headers: refreshedHeaders, retried } = await retryCopilotWithRefreshedToken(options);
        if (retried) {
          result = await doFetch(refreshedHeaders);
          console.log(`[api:fetch] retry -> ${result.status} ${result.statusText}`);
        }
      }

      return result;
    } catch (error) {
      console.error(`[api:fetch] ${options.method} ${options.url} -> ERROR:`, error instanceof Error ? error.message : error);
      return {
        ok: false,
        status: 0,
        statusText: error instanceof Error ? error.message : 'Network error',
        headers: {},
        data: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // SSE 流式 API 代理
  ipcMain.handle('api:stream', async (event, options: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
    requestId: string;
  }) => {
    const controller = new AbortController();

    // 存储 controller 以便后续取消
    activeStreamControllers.set(options.requestId, controller);

    try {
      let response = await session.defaultSession.fetch(options.url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
        signal: controller.signal,
      });

      if (!response.ok && (response.status === 401 || response.status === 403) && isCopilotUrl(options.url)) {
        console.log('[api:stream] Copilot auth error, attempting token refresh and retry');
        const { headers: refreshedHeaders, retried } = await retryCopilotWithRefreshedToken(options);
        if (retried) {
          response = await session.defaultSession.fetch(options.url, {
            method: options.method,
            headers: refreshedHeaders,
            body: options.body,
            signal: controller.signal,
          });
          console.log(`[api:stream] retry -> ${response.status} ${response.statusText}`);
        }
      }

      if (!response.ok) {
        const errorData = await response.text();
        activeStreamControllers.delete(options.requestId);
        return {
          ok: false,
          status: response.status,
          statusText: response.statusText,
          error: errorData,
        };
      }

      if (!response.body) {
        activeStreamControllers.delete(options.requestId);
        return {
          ok: false,
          status: response.status,
          statusText: 'No response body',
        };
      }

      // 读取流式响应并通过 IPC 发送
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      const readStream = async () => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              event.sender.send(`api:stream:${options.requestId}:done`);
              break;
            }
            const chunk = decoder.decode(value);
            event.sender.send(`api:stream:${options.requestId}:data`, chunk);
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            event.sender.send(`api:stream:${options.requestId}:abort`);
          } else {
            event.sender.send(`api:stream:${options.requestId}:error`,
              error instanceof Error ? error.message : 'Stream error');
          }
        } finally {
          activeStreamControllers.delete(options.requestId);
        }
      };

      // 异步读取流，立即返回成功状态
      readStream();

      return {
        ok: true,
        status: response.status,
        statusText: response.statusText,
      };
    } catch (error) {
      activeStreamControllers.delete(options.requestId);
      return {
        ok: false,
        status: 0,
        statusText: error instanceof Error ? error.message : 'Network error',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // 取消流式请求
  ipcMain.handle('api:stream:cancel', (_event, requestId: string) => {
    const controller = activeStreamControllers.get(requestId);
    if (controller) {
      controller.abort();
      activeStreamControllers.delete(requestId);
      return true;
    }
    return false;
  });

  // 企微 SDK 授权弹窗白名单域名
  const WECOM_AUTH_HOSTNAMES = new Set([
    'work.weixin.qq.com',
    'open.work.weixin.qq.com',
    'wwcdn.weixin.qq.com',
  ]);

  const isWecomAuthUrl = (url: string): boolean => {
    try {
      const hostname = new URL(url).hostname;
      return WECOM_AUTH_HOSTNAMES.has(hostname);
    } catch {
      return false;
    }
  };

  // 设置 Content Security Policy
  const setContentSecurityPolicy = () => {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      // 跳过企微授权页面，让其使用自身的 CSP（否则外部脚本被阻止导致空白页）
      if (isWecomAuthUrl(details.url)) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }

      const devPort = process.env.ELECTRON_START_URL?.match(/:(\d+)/)?.[1] || '5175';
      const cspDirectives = [
        "default-src 'self'",
        isDev ? `script-src 'self' 'unsafe-inline' http://localhost:${devPort} ws://localhost:${devPort}` : "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https: http: localfile:",
        // 允许连接到所有域名，不做限制
        "connect-src *",
        "font-src 'self' data: https:",
        "media-src 'self'",
        "worker-src 'self' blob:",
        "frame-src 'self' file: http://127.0.0.1:*"
      ];

      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': cspDirectives.join('; ')
        }
      });
    });
  };

  // 创建主窗口
  const createWindow = () => {
    // 如果窗口已经存在，就不再创建新窗口
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      if (!mainWindow.isFocused()) mainWindow.focus();
      return;
    }

    const initialWindowState = resolveInitialAppWindowState(
      getStore().get(AppWindowStoreKey.State),
      getDisplayWorkAreas(),
    );
    const { isMaximized: shouldRestoreMaximized, ...initialWindowBounds } = initialWindowState;

    mainWindow = new BrowserWindow({
      ...initialWindowBounds,
      title: APP_NAME,
      icon: getAppIconPath(),
      ...(isMac
        ? {
            titleBarStyle: 'hiddenInset' as const,
            trafficLightPosition: { x: 16, y: 16 },
          }
        : isWindows
          ? {
              frame: false,
              titleBarStyle: 'hidden' as const,
            }
          : {
            titleBarStyle: 'hidden' as const,
            titleBarOverlay: getTitleBarOverlayOptions(),
          }),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        preload: PRELOAD_PATH,
        backgroundThrottling: false,
        devTools: isDev,
        spellcheck: false,
        webviewTag: true,
        enableWebSQL: false,
        autoplayPolicy: 'document-user-activation-required',
        disableDialogs: true,
        navigateOnDragDrop: false
      },
      backgroundColor: getInitialTheme() === 'dark' ? '#0F1117' : '#F8F9FB',
      show: false,
      autoHideMenuBar: true,
      enableLargerThanScreen: false
    });

    // 设置 macOS Dock 图标（开发模式下 Electron 默认图标不是应用 Logo）
    if (isMac && isDev) {
      const iconPath = path.join(__dirname, '../build/icons/png/512x512.png');
      if (fs.existsSync(iconPath)) {
        app.dock.setIcon(nativeImage.createFromPath(iconPath));
      }
    }

    // 禁用窗口菜单
    mainWindow.setMenu(null);

    // 处理 window.open 请求（企微 SDK 授权弹窗等）
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (isWecomAuthUrl(url)) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 950,
            height: 640,
            title: '企业微信授权',
            autoHideMenuBar: true,
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: true,
            },
          },
        };
      }
      shell.openExternal(url);
      return { action: 'deny' };
    });

    mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
      webPreferences.nodeIntegration = false;
      webPreferences.nodeIntegrationInSubFrames = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      webPreferences.webSecurity = true;
      webPreferences.plugins = false;
      webPreferences.devTools = isDev;
      webPreferences.partition = ArtifactBrowserPartition.Default;
      delete webPreferences.preload;

      params.partition = ArtifactBrowserPartition.Default;
      params.allowpopups = 'false';

      const src = params.src ?? '';
      if (src.startsWith('javascript:')) {
        event.preventDefault();
      }
    });

    // 监听子窗口创建事件（企微授权弹窗安全限制）
    mainWindow.webContents.on('did-create-window', (childWindow) => {
      // 限制子窗口只能导航到企微域名，防止被劫持到其他站点
      childWindow.webContents.on('will-navigate', (event, navUrl) => {
        if (!isWecomAuthUrl(navUrl)) {
          event.preventDefault();
        }
      });
    });

    // 设置窗口的最小尺寸
    mainWindow.setMinimumSize(MIN_APP_WINDOW_WIDTH, MIN_APP_WINDOW_HEIGHT);
    if (shouldRestoreMaximized) {
      mainWindow.maximize();
    }

    // 设置窗口加载超时
    const loadTimeout = setTimeout(() => {
      if (mainWindow && mainWindow.webContents.isLoadingMainFrame()) {
        console.log('Window load timed out, attempting to reload...');
        scheduleReload('load-timeout');
      }
    }, 30000);

    // 清除超时
    mainWindow.webContents.once('did-finish-load', () => {
      clearTimeout(loadTimeout);
    });
    mainWindow.webContents.on('did-finish-load', () => {
      emitWindowState();
      if (openClawEngineManager && !mainWindow?.isDestroyed()) {
        mainWindow.webContents.send('openclaw:engine:onProgress', openClawEngineManager.getStatus());
      }
    });

    // 处理窗口关闭
    mainWindow.on('close', (e) => {
      if (windowStateSaveTimer) {
        clearTimeout(windowStateSaveTimer);
        windowStateSaveTimer = null;
      }
      persistAppWindowState();

      // In development, close should actually quit so `npm run electron:dev`
      // restarts from a clean process. In production we keep tray behavior.
      if (mainWindow && !isQuitting && !isDev) {
        e.preventDefault();
        mainWindow.hide();
      }
    });

    // 处理渲染进程崩溃或退出
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      console.error('Window render process gone:', details);
      scheduleReload('webContents-crashed');
    });

    if (isDev) {
      // 开发环境
      const maxRetries = 3;
      let retryCount = 0;

      const tryLoadURL = () => {
        mainWindow?.loadURL(DEV_SERVER_URL).catch((err) => {
          console.error('Failed to load URL:', err);
          retryCount++;
          
          if (retryCount < maxRetries) {
            console.log(`Retrying to load URL (${retryCount}/${maxRetries})...`);
            setTimeout(tryLoadURL, 3000);
          } else {
            console.error('Failed to load URL after maximum retries');
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.loadFile(path.join(__dirname, '../resources/error.html'));
            }
          }
        });
      };

      tryLoadURL();
      
      // 打开开发者工具
      mainWindow.webContents.openDevTools({ mode: 'detach', activate: true });
    } else {
      // 生产环境
      mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    // 添加错误处理
    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      console.error('Page failed to load:', errorCode, errorDescription);
      // 如果加载失败，尝试重新加载
      if (isDev) {
        setTimeout(() => {
          scheduleReload('did-fail-load');
        }, 3000);
      }
    });

    // 当窗口关闭时，清除引用
    mainWindow.on('closed', () => {
      if (windowStateSaveTimer) {
        clearTimeout(windowStateSaveTimer);
        windowStateSaveTimer = null;
      }
      mainWindow = null;
    });

    const forwardWindowState = () => emitWindowState();
    const forwardAndPersistWindowState = () => {
      emitWindowState();
      schedulePersistAppWindowState();
    };
    mainWindow.on('resize', schedulePersistAppWindowState);
    mainWindow.on('move', schedulePersistAppWindowState);
    mainWindow.on('maximize', forwardAndPersistWindowState);
    mainWindow.on('unmaximize', forwardAndPersistWindowState);
    mainWindow.on('enter-full-screen', forwardAndPersistWindowState);
    mainWindow.on('leave-full-screen', forwardAndPersistWindowState);
    mainWindow.on('focus', forwardWindowState);
    mainWindow.on('blur', forwardWindowState);

    // 等待内容加载完成后再显示窗口
    mainWindow.once('ready-to-show', () => {
      emitWindowState();
      // 开机自启时不显示窗口，仅显示托盘图标
      if (!isAutoLaunched()) {
        mainWindow?.show();
      }
      // Initialize main-process i18n from stored language before creating UI elements.
      const initLang = getStore().get<{ language?: string }>('app_config')?.language;
      setLanguage(initLang === 'en' ? 'en' : 'zh');
      // 窗口就绪后创建系统托盘
      createTray(() => mainWindow);

      // Start cron polling after the window is ready.
      (async () => {
        try {
          getCronJobService().startPolling();
        } catch (err) {
          console.warn('[Main] CronJobService not available yet, will start polling when OpenClaw is ready:', err);
        }

        // One-time migration: move tasks from legacy SQLite tables to OpenClaw gateway.
        migrateScheduledTasksToOpenclaw({
          db: getStore().getNativeDatabase(),
          getKv: (key) => getStore().get(key),
          setKv: (key, value) => getStore().set(key, value),
          cronJobService: getCronJobService(),
        }).catch((err) => {
          console.warn('[Main] Scheduled tasks migration failed:', err);
        });

        // One-time migration: copy legacy run history to OpenClaw cron/runs/ JSONL files.
        migrateScheduledTaskRunsToOpenclaw({
          db: getStore().getNativeDatabase(),
          getKv: (key) => getStore().get(key),
          setKv: (key, value) => getStore().set(key, value),
          openclawStateDir: getOpenClawEngineManager().getStateDir(),
        }).catch((err) => {
          console.warn('[Main] Scheduled task run history migration failed:', err);
        });
      })();
    });
  };

  let isCleanupFinished = false;
  let isCleanupInProgress = false;

  const runAppCleanup = async (): Promise<void> => {
    console.log('[Main] App is quitting, starting cleanup...');
    clearDeferredHardRestart();
    clearForegroundSpeechRecoveryTimer();
    if (windowStateSaveTimer) {
      clearTimeout(windowStateSaveTimer);
      windowStateSaveTimer = null;
    }
    assistantSpeechGuard?.dispose();
    wakeInputService.dispose();
    petWindowController?.close();
    destroyTray();
    skillManager?.stopWatching();

    // Stop Cowork sessions without blocking shutdown.
    if (coworkEngineRouter) {
      console.log('[Main] Stopping cowork sessions...');
      coworkEngineRouter.stopAllSessions();
    }

    await stopCoworkOpenAICompatProxy().catch((error) => {
      console.error('Failed to stop OpenAI compatibility proxy:', error);
    });

    stopOpenClawTokenProxy();
    macSpeechService.dispose();
    ttsRouterService.dispose();

    // Stop skill services.
    const skillServices = getSkillServiceManager();
    await skillServices.stopAll();

    // Stop all IM gateways gracefully.
    if (imGatewayManager) {
      await imGatewayManager.stopAll().catch(err => {
        console.error('[IM Gateway] Error stopping gateways on quit:', err);
      });
    }

    if (openClawEngineManager) {
      openClawRuntimeAdapter?.disconnectGatewayClient();
      await openClawEngineManager.stopGateway().catch((error) => {
        console.error('[OpenClaw] Failed to stop gateway on quit:', error);
      });
    }

    if (mcpBridgeServer) {
      await mcpBridgeServer.stop().catch((error) => {
      console.error('[McpBridge] Failed to stop bridge server on quit:', error);
    });
    mcpBridgeServer = null;
  }

    if (qingShuManagedMcpServer) {
      await qingShuManagedMcpServer.stop().catch((error) => {
        console.error('[QingShuManagedMcp] Failed to stop native MCP server on quit:', error);
      });
      qingShuManagedMcpServer = null;
    }

    // Stop the cron job polling
    try {
      getCronJobService().stopPolling();
    } catch {
      // CronJobService may not have been initialized — safe to ignore.
    }

    store?.close();
  };

  app.on('before-quit', (e) => {
    if (isCleanupFinished) return;

    e.preventDefault();
    if (isCleanupInProgress) {
      return;
    }

    isCleanupInProgress = true;
    isQuitting = true;

    void runAppCleanup()
      .catch((error) => {
        console.error('[Main] Cleanup error:', error);
      })
      .finally(() => {
        isCleanupFinished = true;
        isCleanupInProgress = false;
        app.exit(0);
      });
  });

  const handleTerminationSignal = (signal: NodeJS.Signals) => {
    if (isCleanupFinished || isCleanupInProgress) {
      return;
    }
    console.log(`[Main] Received ${signal}, running cleanup before exit...`);
    isCleanupInProgress = true;
    isQuitting = true;
    void runAppCleanup()
      .catch((error) => {
        console.error(`[Main] Cleanup error during ${signal}:`, error);
      })
      .finally(() => {
        isCleanupFinished = true;
        isCleanupInProgress = false;
        app.exit(0);
      });
  };

  process.once('SIGINT', () => handleTerminationSignal('SIGINT'));
  process.once('SIGTERM', () => handleTerminationSignal('SIGTERM'));

  // 初始化应用
  const initApp = async () => {
    console.log('[Main] initApp: waiting for app.whenReady()');
    await app.whenReady();
    console.log('[Main] initApp: app is ready');

    // Note: Calendar permission is checked on-demand when calendar operations are requested
    // We don't trigger permission dialogs at startup to avoid annoying users

    // Ensure default working directory exists
    const defaultProjectDir = path.join(os.homedir(), 'lobsterai', 'project');
    if (!fs.existsSync(defaultProjectDir)) {
      fs.mkdirSync(defaultProjectDir, { recursive: true });
      console.log('Created default project directory:', defaultProjectDir);
    }
    console.log('[Main] initApp: default project dir ensured');

    // 注册 localfile:// 自定义协议，用于安全加载本地文件（图片等）
    protocol.handle('localfile', (request) => {
      const url = new URL(request.url);
      const filePath = decodeURIComponent(url.pathname);
      return net.fetch(`file://${filePath}`);
    });

    console.log('[Main] initApp: starting initStore()');
    store = await initStore();
    console.log('[Main] initApp: store initialized');
    if (!emitPetRuntimeState) {
      const petIpc = registerPetIpc({
        configStore: getPetConfigStore(),
        petStore: getPetStore(),
        windowController: getPetWindowController(),
        getMainWindow: () => mainWindow,
        showMainWindow,
      });
      emitPetRuntimeState = petIpc.emitState;
    }
    refreshEndpointsTestMode(store);

    // Defensive recovery: app may be force-closed during execution and leave
    // stale running flags in DB. Normalize them on startup.
    const resetCount = getCoworkStore().resetRunningSessions();
    console.log('[Main] initApp: resetRunningSessions done, count:', resetCount);
    if (resetCount > 0) {
      console.log(`[Main] Reset ${resetCount} stuck cowork session(s) from running -> idle`);
    }
    const migratedAgentModelCount = getAgentManager().migrateRenamedProviderModelRefs(RENAMED_PROVIDER_IDS);
    if (migratedAgentModelCount > 0) {
      console.log(`[Main] Migrated ${migratedAgentModelCount} agent model ref(s) for renamed providers`);
    }
    // Inject store getter into claudeSettings
    setStoreGetter(() => store);
    // Inject auth getters for QingShu server provider routing
    // The getter proactively triggers a background token refresh when the
    // accessToken is within 5 minutes of expiry, so that the SDK always
    // gets a fresh token without blocking.
    //
    // refreshOnce() is the single entry-point for all token refresh paths
    // (proactive, proxy 401/403 retry). It deduplicates concurrent calls via
    // pendingTokenRefresh so that rolling refresh tokens are never consumed twice.
    const refreshOnce = async (reason: string): Promise<string | null> => {
      if (pendingTokenRefresh) {
        return pendingTokenRefresh;
      }
      let resolvedToken: string | null = null;
      pendingTokenRefresh = (async () => {
        try {
          const tokens = getAuthTokens();
          if (!tokens?.refreshToken) return null;
          const refreshResult = await getCurrentAuthAdapter().refreshToken();
          if (refreshResult.success && refreshResult.accessToken) {
              console.log(`[Auth] token refresh succeeded (reason: ${reason})`);
              resolvedToken = refreshResult.accessToken;
              // Token proxy handles fresh tokens dynamically, so we only
              // resync config without forcing a gateway restart.
              syncOpenClawConfig({ reason: `token-refresh:${reason}`, restartGatewayIfRunning: false }).catch((err) => {
                console.warn('[Auth] post-refresh OpenClaw config sync failed:', err);
              });
          }
        } catch (err) {
          console.warn(`[Auth] token refresh failed (reason: ${reason}):`, err);
        } finally {
          pendingTokenRefresh = null;
        }
        return resolvedToken;
      })();
      return pendingTokenRefresh;
    };

    setAuthTokensGetter(() => {
      const tokens = getAuthTokens();
      if (!tokens) return null;
      // Check if accessToken is close to expiry and trigger background refresh
      try {
        const payload = JSON.parse(Buffer.from(tokens.accessToken.split('.')[1], 'base64').toString());
        const expiresAt = payload.exp * 1000;
        if (expiresAt - Date.now() < 5 * 60 * 1000) {
          void refreshOnce('proactive'); // fire-and-forget
        }
      } catch { /* unable to parse JWT, return token as-is */ }
      return tokens;
    });
    setServerBaseUrlGetter(() => getCurrentAuthApiBaseUrl() || getServerApiBaseUrl());
    setQingShuInvocationContextGetter(() => ({
      clientUserId: resolveAuthUserIdForInvocation(),
      deviceId: getOrCreateInstallationUuid(),
    }));
    getQingShuExtensionHost();
    getQingShuGovernanceService();

    initCopilotTokenManager(getStore);
    const storedGithubToken = getStore().get('github_copilot_github_token') as string | undefined;
    if (storedGithubToken) {
      import('./libs/githubCopilotAuth').then(({ getCopilotToken }) =>
        getCopilotToken(storedGithubToken).then(({ token, expiresAt, baseUrl }) => {
          setCopilotTokenState({
            copilotToken: token,
            baseUrl,
            expiresAt,
            githubToken: storedGithubToken,
          });
          console.log('[Main] restored Copilot token state from stored GitHub token');
        })
      ).catch((error) => {
        console.warn('[Main] failed to restore Copilot token on startup:', error);
      });
    }

    // Wire up token refresher for the OpenAI compat proxy so it can retry
    // on 401/403 with a fresh accessToken instead of failing immediately.
    // Delegates to the shared refreshOnce() to avoid concurrent refresh races.
    setProxyTokenRefresher(() => refreshOnce('proxy'));
    registerProxyTokenRefresher(OpenClawProviderId.QingShuServer, () => refreshOnce('proxy'));
    registerProxyTokenRefresher(OpenClawProviderId.LobsteraiServer, () => refreshOnce('proxy'));
    registerProxyTokenRefresher(ProviderName.Copilot, async () => {
      const state = await refreshCopilotTokenNow();
      return state.copilotToken;
    });
    registerProxyTokenRefresher(OpenClawProviderId.LobsteraiCopilot, async () => {
      const state = await refreshCopilotTokenNow();
      return state.copilotToken;
    });

    // Start the lightweight token proxy before OpenClaw config sync so that
    // QingShu server provider can use the proxy URL in its config.
    try {
      await startOpenClawTokenProxy({
        getAuthTokens,
        refreshToken: refreshOnce,
        getServerBaseUrl: () => getCurrentAuthApiBaseUrl() || getServerApiBaseUrl(),
      });
      console.log('[Main] OpenClaw token proxy started');
    } catch (err) {
      console.warn('[Main] OpenClaw token proxy failed to start (non-fatal):', err);
    }

    // Enterprise config sync — must run before openclawConfigSync
    // so enterprise data is in SQLite when the config is generated.
    const enterpriseConfigPath = resolveEnterpriseConfigPath();
    if (enterpriseConfigPath) {
      try {
        const imStoreInstance = getIMGatewayManager().getIMStore();
        const mcpStoreInstance = getMcpStore();
        syncEnterpriseConfig(
          enterpriseConfigPath,
          store,
          imStoreInstance,
          (server) => {
            const existing = mcpStoreInstance.listServers().find(s => s.name === server.name);
            if (existing) {
              mcpStoreInstance.updateServer(existing.id, {
                name: server.name,
                description: server.description,
                transportType: server.transportType as 'stdio' | 'sse' | 'http',
                command: server.command,
                args: server.args,
                env: server.env,
              });
            } else {
              mcpStoreInstance.createServer({
                name: server.name,
                description: server.description,
                transportType: server.transportType as 'stdio' | 'sse' | 'http',
                command: server.command,
                args: server.args,
                env: server.env,
              });
            }
          },
          () => {
            // Clear all MCP servers (for overwrite mode)
            for (const s of mcpStoreInstance.listServers()) {
              mcpStoreInstance.deleteServer(s.id);
            }
          },
          (config) => {
            const cs = getCoworkStore();
            cs.setConfig(config);
          },
          () => {
            const cs = getCoworkStore();
            return cs.getConfig().workingDirectory;
          },
        );
      } catch (error) {
        console.error('[Enterprise] config sync failed:', error);
      }
    } else {
      // No enterprise config package found — clear any previously stored config
      // so the app exits enterprise mode after the package is removed.
      const hadEnterprise = store.get('enterprise_config');
      if (hadEnterprise) {
        store.delete('enterprise_config');
        // Reset executionMode to default so sandbox mode reverts to "off".
        const cs = getCoworkStore();
        cs.setConfig({ executionMode: 'local' });
        console.log('[Enterprise] config package removed, cleared enterprise mode and reset executionMode');
      }
    }

    bindCoworkRuntimeForwarder();
    bindOpenClawStatusForwarder();

    // One-time migration: move main agent workspace files from the user's
    // working directory to the fixed {STATE_DIR}/workspace-main/ path.
    try {
      const engineManager = getOpenClawEngineManager();
      migrateMainAgentWorkspace(
        engineManager.getStateDir(),
        getCoworkStore().getConfig().workingDirectory,
        getStore(),
      );
    } catch (err) {
      console.warn('[OpenClaw] main agent workspace migration failed (non-fatal):', err);
    }

    // Start proxy BEFORE config sync so proxy-dependent providers get the
    // correct baseURL on the first write, avoiding a mid-startup config
    // overwrite that triggers unnecessary gateway hot-reload.
    const appConfig = getStore().get<AppConfigSettings>('app_config');
    await applyProxyPreference(getUseSystemProxyFromConfig(appConfig));

    await startCoworkOpenAICompatProxy().catch((error) => {
      console.error('Failed to start OpenAI compatibility proxy:', error);
    });

    if (hasQingShuAuthSession()) {
      await syncQingShuManagedCatalogAndOpenClaw('startup-qingshu-managed-catalog');
    }

    const startupSync = await syncOpenClawConfig({
      reason: 'startup',
      restartGatewayIfRunning: false,
    });
    if (!startupSync.success) {
      console.error('[OpenClaw] Startup config sync failed:', startupSync.error);
    }
    if (resolveCoworkAgentEngine() === 'openclaw') {
      void ensureOpenClawRunningForCowork().then(() => {
        // Start cron polling once the gateway is confirmed running.
        try {
          getCronJobService().startPolling();
        } catch (err) {
          console.warn('[Main] CronJobService not available after OpenClaw startup:', err);
        }
      }).catch((error) => {
        console.error('[OpenClaw] Failed to auto-start gateway on app startup:', error);
      });
    }

    console.log('[Main] initApp: setStoreGetter done');
    const manager = getSkillManager();
    console.log('[Main] initApp: getSkillManager done');

    // When skills change (install/enable/disable/delete), re-sync AGENTS.md
    // so OpenClaw's IM channel agents pick up the latest skill list.
    manager.onSkillsChanged(() => {
      syncOpenClawConfig({ reason: 'skills-changed' }).catch((error) => {
        console.warn('[Main] Failed to sync OpenClaw config after skills change:', error);
      });
    });

    // Non-critical: sync bundled skills to user data.
    // Wrapped in try-catch so a failure here does not block window creation.
    try {
      manager.syncBundledSkillsToUserData();
      console.log('[Main] initApp: syncBundledSkillsToUserData done');
    } catch (error) {
      console.error('[Main] initApp: syncBundledSkillsToUserData failed:', error);
    }

    try {
      manager.recoverInterruptedUpgrades();
      console.log('[Main] initApp: recoverInterruptedUpgrades done');
    } catch (error) {
      console.error('[Main] initApp: recoverInterruptedUpgrades failed:', error);
    }

    try {
      const runtimeResult = await ensurePythonRuntimeReady();
      if (!runtimeResult.success) {
        console.error('[Main] initApp: ensurePythonRuntimeReady failed:', runtimeResult.error);
      } else {
        console.log('[Main] initApp: ensurePythonRuntimeReady done');
      }
    } catch (error) {
      console.error('[Main] initApp: ensurePythonRuntimeReady threw:', error);
    }

    try {
      manager.startWatching();
      console.log('[Main] initApp: startWatching done');
    } catch (error) {
      console.error('[Main] initApp: startWatching failed:', error);
    }

    // Start skill services (non-critical)
    try {
      const skillServices = getSkillServiceManager();
      console.log('[Main] initApp: getSkillServiceManager done');
      await skillServices.startAll();
      console.log('[Main] initApp: skill services started');
    } catch (error) {
      console.error('[Main] initApp: skill services failed:', error);
    }

    const wakeInputConfig = mergeWakeInputConfig(appConfig?.wakeInput);
    wakeInputService.updateConfig(wakeInputConfig);
    await syncWakeInputAvailabilityFromSpeech();
    await wakeInputService.startBackgroundListening();
    const initialTtsConfig = mergeTtsConfig(appConfig?.tts);
    cachedTtsConfig = initialTtsConfig;
    if (initialTtsConfig.engine === TtsEngine.EdgeTts) {
      void ttsRouterService.prepare({ engine: TtsEngine.EdgeTts }).catch((error) => {
        console.error('[TtsRouterService] Failed to prepare edge-tts during app init:', error);
      });
    }
    prewarmWakeActivationReplyCache(appConfig);

    // 设置安全策略
    setContentSecurityPolicy();

    // 创建窗口
    console.log('[Main] initApp: creating window');
    createWindow();
    console.log('[Main] initApp: window created');

    // Windows/Linux cold start: parse deep link from process.argv
    // Always buffer since renderer is not ready yet after createWindow()
    const coldStartDeepLink = process.argv.find(arg => arg.startsWith('lobsterai://'));
    if (coldStartDeepLink) {
      try {
        const parsed = new URL(coldStartDeepLink);
        if (parsed.hostname === 'auth' && parsed.pathname === '/callback') {
          const code = parsed.searchParams.get('code');
          const state = parsed.searchParams.get('state') || undefined;
          if (code) {
            pendingAuthCallback = { code, ...(state ? { state } : {}) };
          }
        }
      } catch (e) {
        console.error('[Main] Failed to parse cold-start deep link:', e);
      }
    }

    // Auto-reconnect IM bots that were enabled before restart
    getIMGatewayManager().startAllEnabled().catch((error) => {
      console.error('[IM] Failed to auto-start enabled gateways:', error);
    });

    // Reconnect OpenClaw gateway WS after system wake from sleep/suspend
    powerMonitor.on('resume', () => {
      if (openClawRuntimeAdapter) {
        openClawRuntimeAdapter.onSystemResume();
      }
    });

    // 首次启动时默认开启开机自启动（先写标记再设置，避免崩溃后重复设置）
    if (!getStore().get('auto_launch_initialized')) {
      getStore().set('auto_launch_initialized', true);
      getStore().set('auto_launch_enabled', true);
      setAutoLaunchEnabled(true);
    }

    // Restore prevent-sleep setting
    const preventSleepEnabled = getStore().get<boolean>('prevent_sleep_enabled');
    if (preventSleepEnabled) {
      try {
        setPreventSleepBlockerEnabled(true);
      } catch (err) {
        console.error('[Main] Failed to start prevent-sleep blocker:', err);
      }
    }

    let lastLanguage = getStore().get<AppConfigSettings>('app_config')?.language;
    let lastUseSystemProxy = getUseSystemProxyFromConfig(getStore().get<AppConfigSettings>('app_config'));
    let lastWakeInputConfig = JSON.stringify(mergeWakeInputConfig(getStore().get<AppConfigSettings>('app_config')?.wakeInput));
    let lastTtsConfig = JSON.stringify(mergeTtsConfig(getStore().get<AppConfigSettings>('app_config')?.tts));
    getStore().onDidChange<AppConfigSettings>('app_config', (newConfig, oldConfig) => {
      updateTitleBarOverlay();
      // 仅在语言变更时刷新托盘菜单文本
      const currentLanguage = newConfig?.language;
      if (currentLanguage !== lastLanguage) {
        lastLanguage = currentLanguage;
        setLanguage(currentLanguage === 'en' ? 'en' : 'zh');
        updateTrayMenu(() => mainWindow);
      }

      const previousUseSystemProxy = oldConfig
        ? getUseSystemProxyFromConfig(oldConfig)
        : lastUseSystemProxy;
      const currentUseSystemProxy = getUseSystemProxyFromConfig(newConfig);
      if (currentUseSystemProxy !== previousUseSystemProxy) {
        void applyProxyPreference(currentUseSystemProxy).then(() => {
          if (getOpenClawEngineManager().getStatus().phase === 'running') {
            void requestGatewayRestart('system-proxy-changed');
          }
        });
      }
      lastUseSystemProxy = currentUseSystemProxy;

      const currentWakeInputConfig = JSON.stringify(mergeWakeInputConfig(newConfig?.wakeInput));
      if (currentWakeInputConfig !== lastWakeInputConfig) {
        lastWakeInputConfig = currentWakeInputConfig;
        wakeInputService.updateConfig(mergeWakeInputConfig(newConfig?.wakeInput));
        void syncWakeInputAvailabilityFromSpeech().then(() => wakeInputService.startBackgroundListening()).catch((error) => {
          console.error('[WakeInput] Failed to refresh availability after config change:', error);
        });
        prewarmWakeActivationReplyCache(newConfig);
      }

      const currentTtsConfig = JSON.stringify(mergeTtsConfig(newConfig?.tts));
      if (currentTtsConfig !== lastTtsConfig) {
        lastTtsConfig = currentTtsConfig;
        const mergedTtsConfig = mergeTtsConfig(newConfig?.tts);
        cachedTtsConfig = mergedTtsConfig;
        void ttsRouterService.prepare({ engine: mergedTtsConfig.engine }).catch((error) => {
          console.error('[TtsRouterService] Failed to refresh TTS availability after config change:', error);
        });
        prewarmWakeActivationReplyCache(newConfig);
      }
    });

    // 在 macOS 上，当点击 dock 图标时显示已有窗口或重新创建
    app.on('activate', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (!mainWindow.isVisible()) mainWindow.show();
        if (!mainWindow.isFocused()) mainWindow.focus();
        return;
      }
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  };

  // 启动应用
  initApp().catch(console.error);

  // 当所有窗口关闭时退出应用
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    void stopHtmlPreviewServer();
  });
} 
