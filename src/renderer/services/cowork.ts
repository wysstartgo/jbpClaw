import type { OpenClawSessionPatch } from '../../common/openclawSession';
import { AppCustomEvent } from '../constants/app';
import { petService } from '../pet/petService';
import { store } from '../store';
import {
  addMessage,
  addSession,
  clearCurrentSession,
  clearCoworkInputQueue,
  clearPendingPermissions,
  deleteSession as deleteSessionAction,
  deleteSessions as deleteSessionsAction,
  dequeuePendingPermission,
  enqueuePendingPermission,
  setConfig,
  setCurrentSession,
  setRemoteManaged,
  setSessions,
  setStreaming,
  updateMessageContent,
  updateSessionPinned,
  updateSessionStatus,
  updateSessionTitle,
} from '../store/slices/coworkSlice';
import { clearActiveSkills, setActiveSkillIds } from '../store/slices/skillSlice';
import type {
  CoworkApiConfig,
  CoworkConfigUpdate,
  CoworkContinueOptions,
  CoworkMemoryStats,
  CoworkMessage,
  CoworkPermissionResult,
  CoworkSession,
  CoworkSessionListResult,
  CoworkStartOptions,
  CoworkUserMemoryEntry,
  OpenClawEngineStatus,
  OpenClawSessionPolicyConfig,
} from '../types/cowork';
import { getCoworkVisibleErrorMessage } from './coworkErrorMessage';

export function mergeLoadedSessionWithCurrentSession(
  loadedSession: CoworkSession,
  currentSession: CoworkSession | null | undefined,
): CoworkSession {
  if (!currentSession || currentSession.id !== loadedSession.id) {
    return loadedSession;
  }

  if (loadedSession.messages.length >= currentSession.messages.length) {
    return loadedSession;
  }

  const loadedMessagesById = new Map(
    loadedSession.messages.map((message) => [message.id, message]),
  );
  const currentMessageIds = new Set(currentSession.messages.map((message) => message.id));
  const mergedMessages = currentSession.messages.map((message) => (
    loadedMessagesById.get(message.id) ?? message
  ));

  for (const message of loadedSession.messages) {
    if (!currentMessageIds.has(message.id)) {
      mergedMessages.push(message);
    }
  }

  return {
    ...loadedSession,
    messages: mergedMessages,
    updatedAt: Math.max(loadedSession.updatedAt, currentSession.updatedAt),
  };
}

class CoworkService {
  private static readonly MaxLoadSessionRequestKeys = 100;

  private streamListenerCleanups: Array<() => void> = [];
  private initialized = false;
  private openClawStatus: OpenClawEngineStatus | null = null;
  private openClawStatusListeners = new Set<(status: OpenClawEngineStatus) => void>();
  private openClawEngineListenerAttached = false;
  private latestLoadSessionsRequestIds = new Map<string, number>();
  private pendingLoadSessionsByKey = new Map<string, Promise<void>>();
  private latestLoadSessionRequestId = 0;

  async init(): Promise<void> {
    if (this.initialized) return;

    // Load initial config
    await this.loadConfig();

    // Load sessions list
    await this.loadSessions();

    // Set up stream listeners
    this.setupStreamListeners();
    this.setupOpenClawEngineListeners();

    // Load OpenClaw status
    await this.loadOpenClawEngineStatus();

    this.initialized = true;
  }

  private setupStreamListeners(): void {
    const cowork = window.electron?.cowork;
    if (!cowork) return;

    // Clean up any existing listeners
    this.cleanupListeners();

    // Message listener - also check if session exists (for IM-created sessions)
    const messageCleanup = cowork.onStreamMessage(async ({ sessionId, message }) => {
      // Check if session exists in current list
      const state = store.getState().cowork;
      const sessionExists = state.sessions.some(s => s.id === sessionId);

      if (!sessionExists) {
        // Session was created by IM or another source, refresh the session list
        await this.loadSessions();
      }

      // A new user turn means this session is actively running again
      // (especially important for IM-triggered turns that do not call continueSession from renderer).
      if (message.type === 'user') {
        store.dispatch(updateSessionStatus({ sessionId, status: 'running' }));
        void petService.setStatusFromCoworkState(store.getState().cowork);
      }

      // Do not force status back to "running" on arbitrary messages.
      // Late stream chunks can arrive after an error/complete event.
      if (message.type === 'user' || message.type === 'assistant' || message.type === 'system') {
        petService.rememberSessionMessage(sessionId, message);
      }
      store.dispatch(addMessage({ sessionId, message }));
      void petService.setRuntimeProjectionFromCoworkState(store.getState().cowork);
    });
    this.streamListenerCleanups.push(messageCleanup);

    // Message update listener (for streaming content updates)
    const messageUpdateCleanup = cowork.onStreamMessageUpdate(({ sessionId, messageId, content, metadata }) => {
      petService.rememberSessionMessage(sessionId, content);
      store.dispatch(updateMessageContent({ sessionId, messageId, content, metadata }));
      void petService.setStatusFromCoworkState(store.getState().cowork);
    });
    this.streamListenerCleanups.push(messageUpdateCleanup);

    // Permission request listener
    const permissionCleanup = cowork.onStreamPermission(({ sessionId, request }) => {
      store.dispatch(enqueuePendingPermission({
        sessionId,
        toolName: request.toolName,
        toolInput: request.toolInput,
        requestId: request.requestId,
        toolUseId: request.toolUseId ?? null,
      }));
      void petService.setStatusFromCoworkState(store.getState().cowork);
    });
    this.streamListenerCleanups.push(permissionCleanup);

    // Permission dismiss listener (timeout or server-side resolution)
    const permissionDismissCleanup = cowork.onStreamPermissionDismiss(({ requestId }) => {
      store.dispatch(dequeuePendingPermission({ requestId }));
      void petService.setRuntimeProjectionFromCoworkState(store.getState().cowork);
    });
    this.streamListenerCleanups.push(permissionDismissCleanup);

    // Complete listener
    const completeCleanup = cowork.onStreamComplete(({ sessionId }) => {
      store.dispatch(updateSessionStatus({ sessionId, status: 'completed' }));
      void petService.setStatusFromCoworkState(store.getState().cowork);
      const state = store.getState().cowork;
      if (state.currentSession?.id === sessionId) {
          void this.loadSession(sessionId, { preserveSelection: true });
      }
    });
    this.streamListenerCleanups.push(completeCleanup);

    // Error listener
    const errorCleanup = cowork.onStreamError(({ sessionId, error }) => {
      store.dispatch(updateSessionStatus({ sessionId, status: 'error' }));
      void petService.setStatusFromCoworkState(store.getState().cowork);
      // Surface the error as a visible message so the user knows what happened.
      if (error) {
        store.dispatch(addMessage({
          sessionId,
          message: {
            id: `error-${Date.now()}`,
            type: 'system',
            content: getCoworkVisibleErrorMessage(error),
            timestamp: Date.now(),
          },
        }));
        void petService.setRuntimeProjectionFromCoworkState(store.getState().cowork);
      }
    });
    this.streamListenerCleanups.push(errorCleanup);

    // Sessions changed listener (new channel sessions discovered by polling)
    const sessionsChangedCleanup = cowork.onSessionsChanged(() => {
      const beforeState = store.getState().cowork;
      console.debug('[CoworkService] sessions changed, refreshing session list with', beforeState.sessions.length, 'known sessions');
      void this.loadSessions().then(() => {
        const state = store.getState().cowork;
        console.debug('[CoworkService] refreshed session list with', state.sessions.length, 'sessions');
        const currentSessionId = state.currentSessionId;
        if (currentSessionId && state.currentSession?.id === currentSessionId) {
          void this.loadSession(currentSessionId, { preserveSelection: true });
        }
      }).catch((err) => {
        console.error('[CoworkService] session list refresh failed:', err);
      });
    });
    this.streamListenerCleanups.push(sessionsChangedCleanup);
  }

  setupStreamListenersForTest(): void {
    if (!import.meta.env?.TEST) return;
    this.setupStreamListeners();
  }

  private setupOpenClawEngineListeners(): void {
    if (this.openClawEngineListenerAttached) return;
    const engineApi = window.electron?.openclaw?.engine;
    if (!engineApi?.onProgress) return;

    const statusCleanup = engineApi.onProgress((status) => {
      this.notifyOpenClawStatus(status);
    });
    this.streamListenerCleanups.push(statusCleanup);
    this.openClawEngineListenerAttached = true;
  }

  private notifyOpenClawStatus(status: OpenClawEngineStatus): void {
    this.openClawStatus = status;
    this.openClawStatusListeners.forEach((listener) => {
      listener(status);
    });
  }

  private cleanupListeners(): void {
    this.streamListenerCleanups.forEach(cleanup => cleanup());
    this.streamListenerCleanups = [];
    this.openClawEngineListenerAttached = false;
  }

  cleanupListenersForTest(): void {
    if (!import.meta.env?.TEST) return;
    this.cleanupListeners();
  }

  async loadSessions(agentId?: string): Promise<void> {
    const requestKey = agentId ?? '__all__';
    const pendingRequest = this.pendingLoadSessionsByKey.get(requestKey);
    if (pendingRequest) {
      return pendingRequest;
    }

    const requestId = (this.latestLoadSessionsRequestIds.get(requestKey) ?? 0) + 1;
    this.latestLoadSessionsRequestIds.set(requestKey, requestId);
    this.pruneLoadSessionRequestIds();

    const requestPromise = this.loadSessionsForKey(agentId, requestKey, requestId);
    this.pendingLoadSessionsByKey.set(requestKey, requestPromise);
    try {
      await requestPromise;
    } finally {
      if (this.pendingLoadSessionsByKey.get(requestKey) === requestPromise) {
        this.pendingLoadSessionsByKey.delete(requestKey);
      }
    }
  }

  private pruneLoadSessionRequestIds(): void {
    while (this.latestLoadSessionsRequestIds.size > CoworkService.MaxLoadSessionRequestKeys) {
      const oldestKey = this.latestLoadSessionsRequestIds.keys().next().value as string | undefined;
      if (!oldestKey) return;
      if (this.pendingLoadSessionsByKey.has(oldestKey)) return;
      this.latestLoadSessionsRequestIds.delete(oldestKey);
    }
  }

  private async loadSessionsForKey(agentId: string | undefined, requestKey: string, requestId: number): Promise<void> {
    const result = await window.electron?.cowork?.listSessions(agentId);
    if (result?.success && result.sessions) {
      // High-frequency IM traffic can trigger overlapping list refreshes.
      // Ignore stale responses so an older snapshot does not hide newer sessions.
      if (requestId !== this.latestLoadSessionsRequestIds.get(requestKey)) {
        return;
      }
      store.dispatch(setSessions(result.sessions));
    }
  }

  async listSessionsForAgentPreview(
    agentId: string,
    limit: number,
    offset: number,
  ): Promise<CoworkSessionListResult> {
    const result = await window.electron?.cowork?.listSessions(agentId);
    if (!result?.success || !result.sessions) {
      return {
        success: false,
        error: result?.error ?? 'Cowork IPC is unavailable',
      };
    }

    const sessions = result.sessions.slice(offset, offset + limit);
    return {
      success: true,
      sessions,
      hasMore: offset + sessions.length < result.sessions.length,
    };
  }

  async loadConfig(): Promise<void> {
    const [coworkResult, sessionPolicyResult] = await Promise.all([
      window.electron?.cowork?.getConfig(),
      window.electron?.openclaw?.sessionPolicy?.get?.(),
    ]);

    if (coworkResult?.success && coworkResult.config) {
      const cfg = coworkResult.config as unknown as Record<string, unknown>;
      store.dispatch(setConfig({
        ...coworkResult.config,
        dreamingEnabled: (cfg.dreamingEnabled as boolean) ?? false,
        dreamingFrequency: (cfg.dreamingFrequency as string) ?? '0 3 * * *',
        dreamingModel: (cfg.dreamingModel as string) ?? '',
        dreamingTimezone: (cfg.dreamingTimezone as string) ?? '',
        openClawSessionPolicy: sessionPolicyResult?.success && sessionPolicyResult.config
          ? sessionPolicyResult.config
          : { keepAlive: '30d' },
      }));
    }
  }

  async loadOpenClawEngineStatus(): Promise<OpenClawEngineStatus | null> {
    this.setupOpenClawEngineListeners();
    const engineApi = window.electron?.openclaw?.engine;
    if (!engineApi?.getStatus) {
      return null;
    }
    const result = await engineApi.getStatus();
    if (result?.success && result.status) {
      this.notifyOpenClawStatus(result.status);
      return result.status;
    }
    return this.openClawStatus;
  }

  async startSession(options: CoworkStartOptions): Promise<{ session: CoworkSession | null; error?: string }> {
    const cowork = window.electron?.cowork;
    if (!cowork) {
      console.error('Cowork API not available');
      return { session: null, error: 'Cowork API not available' };
    }

    store.dispatch(setStreaming(true));
    void petService.setRuntimeProjectionFromCoworkState(store.getState().cowork);

    const result = await cowork.startSession(options);
    if (result.success && result.session) {
      store.dispatch(addSession(result.session));
      if (result.session.status !== 'running') {
        store.dispatch(setStreaming(false));
      }
      void petService.setRuntimeProjectionFromCoworkState(store.getState().cowork);
      return { session: result.session };
    }

    if (result.engineStatus) {
      this.notifyOpenClawStatus(result.engineStatus);
    }

    // Show a user-visible error when session start fails
    if (result.error) {
      const errorContent = getCoworkVisibleErrorMessage(result.error, result.code);
      window.dispatchEvent(new CustomEvent(AppCustomEvent.ShowToast, { detail: errorContent }));
    }

    store.dispatch(setStreaming(false));
    void petService.setRuntimeProjectionFromCoworkState(store.getState().cowork);
    console.error('Failed to start session:', result.error);
    return { session: null, error: result.error };
  }

  async continueSession(options: CoworkContinueOptions): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork) {
      console.error('Cowork API not available');
      return false;
    }

    store.dispatch(setStreaming(true));
    store.dispatch(updateSessionStatus({ sessionId: options.sessionId, status: 'running' }));
    void petService.setRuntimeProjectionFromCoworkState(store.getState().cowork);

    const result = await cowork.continueSession({
      sessionId: options.sessionId,
      prompt: options.prompt,
      systemPrompt: options.systemPrompt,
      activeSkillIds: options.activeSkillIds,
      imageAttachments: options.imageAttachments,
      skipInitialUserMessage: options.skipInitialUserMessage,
    });
    if (!result.success) {
      store.dispatch(setStreaming(false));
      if (result.engineStatus) {
        this.notifyOpenClawStatus(result.engineStatus);
      }
      const visibleErrorContent = result.error
        ? getCoworkVisibleErrorMessage(result.error, result.code)
        : null;
      if (result.code !== 'ENGINE_NOT_READY') {
        store.dispatch(updateSessionStatus({ sessionId: options.sessionId, status: 'error' }));
        if (visibleErrorContent) {
          store.dispatch(addMessage({
            sessionId: options.sessionId,
            message: {
              id: `error-${Date.now()}`,
              type: 'system',
              content: visibleErrorContent,
              timestamp: Date.now(),
            },
          }));
        }
      }
      if (visibleErrorContent && result.code === 'ENGINE_NOT_READY') {
        store.dispatch(addMessage({
          sessionId: options.sessionId,
          message: {
            id: `error-${Date.now()}`,
            type: 'system',
            content: visibleErrorContent,
            timestamp: Date.now(),
          },
        }));
      }
      void petService.setRuntimeProjectionFromCoworkState(store.getState().cowork);
      console.error('Failed to continue session:', result.error);
      return false;
    }

    void petService.setRuntimeProjectionFromCoworkState(store.getState().cowork);
    return true;
  }

  async stopSession(sessionId: string): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork) return false;

    const result = await cowork.stopSession(sessionId);
    if (result.success) {
      store.dispatch(setStreaming(false));
      store.dispatch(updateSessionStatus({ sessionId, status: 'idle' }));
      void petService.setRuntimeProjectionFromCoworkState(store.getState().cowork);
      return true;
    }

    console.error('Failed to stop session:', result.error);
    return false;
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork) return false;

    const result = await cowork.deleteSession(sessionId);
    if (result.success) {
      store.dispatch(deleteSessionAction(sessionId));
      void petService.setRuntimeProjectionFromCoworkState(store.getState().cowork);
      return true;
    }

    console.error('Failed to delete session:', result.error);
    return false;
  }

  async deleteSessions(sessionIds: string[]): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork) return false;

    const result = await cowork.deleteSessions(sessionIds);
    if (result.success) {
      store.dispatch(deleteSessionsAction(sessionIds));
      void petService.setRuntimeProjectionFromCoworkState(store.getState().cowork);
      return true;
    }

    console.error('Failed to batch delete sessions:', result.error);
    return false;
  }

  async setSessionPinned(sessionId: string, pinned: boolean): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork?.setSessionPinned) return false;

    const result = await cowork.setSessionPinned({ sessionId, pinned });
    if (result.success) {
      store.dispatch(updateSessionPinned({ sessionId, pinned }));
      return true;
    }

    console.error('Failed to update session pin:', result.error);
    return false;
  }

  async renameSession(sessionId: string, title: string): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork?.renameSession) return false;

    const normalizedTitle = title.trim();
    if (!normalizedTitle) return false;

    const result = await cowork.renameSession({ sessionId, title: normalizedTitle });
    if (result.success) {
      store.dispatch(updateSessionTitle({ sessionId, title: normalizedTitle }));
      return true;
    }

    console.error('Failed to rename session:', result.error);
    return false;
  }

  async editUserMessage(options: {
    sessionId: string;
    messageId: string;
    content: string;
    metadata?: CoworkMessage['metadata'];
  }): Promise<CoworkSession | null> {
    const cowork = window.electron?.cowork;
    if (!cowork?.editUserMessage) return null;

    const result = await cowork.editUserMessage(options);
    if (result.success && result.session) {
      store.dispatch(setCurrentSession(result.session));
      store.dispatch(clearCoworkInputQueue(options.sessionId));
      store.dispatch(setStreaming(false));
      void petService.setRuntimeProjectionFromCoworkState(store.getState().cowork);
      return result.session;
    }

    console.error('Failed to edit user message:', result.error);
    return null;
  }

  async forkSession(sessionId: string, messageId: string): Promise<CoworkSession | null> {
    const cowork = window.electron?.cowork;
    if (!cowork?.forkSession) return null;

    const result = await cowork.forkSession({ sessionId, messageId });
    if (result.success && result.session) {
      store.dispatch(addSession(result.session));
      void petService.setRuntimeProjectionFromCoworkState(store.getState().cowork);
      return result.session;
    }

    console.error('Failed to fork session:', result.error);
    return null;
  }

  async exportSessionResultImage(options: {
    rect: { x: number; y: number; width: number; height: number };
    defaultFileName?: string;
  }): Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }> {
    const cowork = window.electron?.cowork;
    if (!cowork?.exportResultImage) {
      return { success: false, error: 'Cowork export API not available' };
    }

    try {
      const result = await cowork.exportResultImage(options);
      return result ?? { success: false, error: 'Failed to export session image' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to export session image',
      };
    }
  }

  async captureSessionImageChunk(options: {
    rect: { x: number; y: number; width: number; height: number };
  }): Promise<{ success: boolean; width?: number; height?: number; pngBase64?: string; error?: string }> {
    const cowork = window.electron?.cowork;
    if (!cowork?.captureImageChunk) {
      return { success: false, error: 'Cowork capture API not available' };
    }

    try {
      const result = await cowork.captureImageChunk(options);
      return result ?? { success: false, error: 'Failed to capture session image chunk' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to capture session image chunk',
      };
    }
  }

  async saveSessionResultImage(options: {
    pngBase64: string;
    defaultFileName?: string;
  }): Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }> {
    const cowork = window.electron?.cowork;
    if (!cowork?.saveResultImage) {
      return { success: false, error: 'Cowork save image API not available' };
    }

    try {
      const result = await cowork.saveResultImage(options);
      return result ?? { success: false, error: 'Failed to save session image' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save session image',
      };
    }
  }

  async loadSession(
    sessionId: string,
    options: { preserveSelection?: boolean } = {},
  ): Promise<CoworkSession | null> {
    const cowork = window.electron?.cowork;
    if (!cowork) return null;
    const requestId = ++this.latestLoadSessionRequestId;
    const expectedSessionId = options.preserveSelection ? sessionId : null;

    const result = await cowork.getSession(sessionId);
    if (result.success && result.session) {
      // Keep only the latest session load result to avoid stale async overwrites.
      if (requestId !== this.latestLoadSessionRequestId) {
        return result.session;
      }
      if (expectedSessionId && store.getState().cowork.currentSessionId !== expectedSessionId) {
        return result.session;
      }
      const sessionToApply = mergeLoadedSessionWithCurrentSession(
        result.session,
        store.getState().cowork.currentSession,
      );
      store.dispatch(setCurrentSession(sessionToApply));
      store.dispatch(setStreaming(sessionToApply.status === 'running'));
      void petService.setRuntimeProjectionFromCoworkState(store.getState().cowork);

      const imResult = await cowork.remoteManaged(sessionId);
      if (
        requestId === this.latestLoadSessionRequestId
        && (!expectedSessionId || store.getState().cowork.currentSessionId === expectedSessionId)
      ) {
        store.dispatch(setRemoteManaged(imResult?.remoteManaged ?? false));
      }

      return result.session;
    }

    console.error('Failed to load session:', result.error);
    return null;
  }

  async patchSession(sessionId: string, patch: OpenClawSessionPatch): Promise<CoworkSession | null> {
    const sessionApi = window.electron?.openclaw?.session;
    if (!sessionApi?.patch) {
      console.error('OpenClaw session patch API not available');
      return null;
    }

    const result = await sessionApi.patch({ sessionId, patch });
    if (result.success && result.session) {
      const currentSessionId = store.getState().cowork.currentSessionId;
      if (currentSessionId === sessionId) {
        store.dispatch(setCurrentSession(result.session));
        store.dispatch(setStreaming(result.session.status === 'running'));
      }
      return result.session;
    }

    console.error('Failed to patch session:', result.error);
    return null;
  }

  async respondToPermission(requestId: string, result: CoworkPermissionResult): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork) return false;

    const response = await cowork.respondToPermission({ requestId, result });
    if (response.success) {
      store.dispatch(dequeuePendingPermission({ requestId }));
      return true;
    }

    console.error('Failed to respond to permission:', response.error);
    return false;
  }

  async updateConfig(config: CoworkConfigUpdate): Promise<boolean> {
    const cowork = window.electron?.cowork;
    if (!cowork) return false;

    const currentConfig = store.getState().cowork.config;
    const engineChanged = config.agentEngine !== undefined
      && config.agentEngine !== currentConfig.agentEngine;
    const result = await cowork.setConfig(config);
    if (result.success) {
      store.dispatch(setConfig({ ...currentConfig, ...config }));
      if (engineChanged) {
        store.dispatch(clearPendingPermissions());
        store.dispatch(setStreaming(false));
        void petService.setRuntimeProjectionFromCoworkState(store.getState().cowork);
      }
      return true;
    }

    console.error('Failed to update config:', result.error);
    return false;
  }

  async updateSessionPolicy(config: OpenClawSessionPolicyConfig): Promise<boolean> {
    const sessionPolicyApi = window.electron?.openclaw?.sessionPolicy;
    if (!sessionPolicyApi) return false;

    const currentConfig = store.getState().cowork.config;
    const result = await sessionPolicyApi.set(config);
    if (result.success) {
      store.dispatch(setConfig({
        ...currentConfig,
        openClawSessionPolicy: result.config ?? config,
      }));
      return true;
    }

    console.error('Failed to update OpenClaw session policy:', result.error);
    return false;
  }

  async getApiConfig(): Promise<CoworkApiConfig | null> {
    if (!window.electron?.getApiConfig) {
      return null;
    }
    return window.electron.getApiConfig();
  }

  async checkApiConfig(options?: { probeModel?: boolean }): Promise<{ hasConfig: boolean; config: CoworkApiConfig | null; error?: string } | null> {
    if (!window.electron?.checkApiConfig) {
      return null;
    }
    return window.electron.checkApiConfig(options);
  }

  async saveApiConfig(config: CoworkApiConfig): Promise<{ success: boolean; error?: string } | null> {
    if (!window.electron?.saveApiConfig) {
      return null;
    }
    return window.electron.saveApiConfig(config);
  }

  async listMemoryEntries(input: {
    query?: string;
    limit?: number;
    offset?: number;
  }): Promise<CoworkUserMemoryEntry[]> {
    const api = window.electron?.cowork?.listMemoryEntries;
    if (!api) return [];
    const result = await api(input);
    if (!result?.success || !result.entries) return [];
    return result.entries;
  }

  async createMemoryEntry(input: {
    text: string;
  }): Promise<CoworkUserMemoryEntry | null> {
    const api = window.electron?.cowork?.createMemoryEntry;
    if (!api) return null;
    const result = await api(input);
    if (!result?.success || !result.entry) return null;
    return result.entry;
  }

  async updateMemoryEntry(input: {
    id: string;
    text: string;
  }): Promise<CoworkUserMemoryEntry | null> {
    const api = window.electron?.cowork?.updateMemoryEntry;
    if (!api) return null;
    const result = await api(input);
    if (!result?.success || !result.entry) return null;
    return result.entry;
  }

  async deleteMemoryEntry(input: { id: string }): Promise<boolean> {
    const api = window.electron?.cowork?.deleteMemoryEntry;
    if (!api) return false;
    const result = await api(input);
    return Boolean(result?.success);
  }

  async getMemoryStats(): Promise<CoworkMemoryStats | null> {
    const api = window.electron?.cowork?.getMemoryStats;
    if (!api) return null;
    const result = await api();
    if (!result?.success || !result.stats) return null;
    return result.stats;
  }

  async readBootstrapFile(filename: string): Promise<string> {
    const api = window.electron?.cowork?.readBootstrapFile;
    if (!api) return '';
    const result = await api(filename);
    if (!result?.success) {
      console.warn(`[CoworkService] readBootstrapFile: failed to read ${filename}`, result?.error);
      return '';
    }
    return result.content || '';
  }

  async writeBootstrapFile(filename: string, content: string): Promise<boolean> {
    const api = window.electron?.cowork?.writeBootstrapFile;
    if (!api) return false;
    const result = await api(filename, content);
    return Boolean(result?.success);
  }

  onOpenClawEngineStatus(callback: (status: OpenClawEngineStatus) => void): () => void {
    this.setupOpenClawEngineListeners();
    this.openClawStatusListeners.add(callback);
    if (this.openClawStatus) {
      callback(this.openClawStatus);
    }
    return () => {
      this.openClawStatusListeners.delete(callback);
    };
  }

  async getOpenClawEngineStatus(): Promise<OpenClawEngineStatus | null> {
    return this.loadOpenClawEngineStatus();
  }

  async installOpenClawEngine(): Promise<OpenClawEngineStatus | null> {
    const engineApi = window.electron?.openclaw?.engine;
    if (!engineApi?.install) {
      return null;
    }
    const result = await engineApi.install();
    if (result?.status) {
      this.notifyOpenClawStatus(result.status);
      return result.status;
    }
    return this.openClawStatus;
  }

  async retryOpenClawInstall(): Promise<OpenClawEngineStatus | null> {
    const engineApi = window.electron?.openclaw?.engine;
    if (!engineApi?.retryInstall) {
      return null;
    }
    const result = await engineApi.retryInstall();
    if (result?.status) {
      this.notifyOpenClawStatus(result.status);
      return result.status;
    }
    return this.openClawStatus;
  }

  async restartOpenClawGateway(): Promise<OpenClawEngineStatus | null> {
    const engineApi = window.electron?.openclaw?.engine;
    if (!engineApi?.restartGateway) {
      return null;
    }
    const result = await engineApi.restartGateway();
    if (result?.status) {
      this.notifyOpenClawStatus(result.status);
      return result.status;
    }
    return this.openClawStatus;
  }

  async generateSessionTitle(prompt: string | null): Promise<string | null> {
    if (!window.electron?.generateSessionTitle) {
      return null;
    }
    return window.electron.generateSessionTitle(prompt);
  }

  async getRecentCwds(limit?: number): Promise<string[]> {
    if (!window.electron?.getRecentCwds) {
      return [];
    }
    return window.electron.getRecentCwds(limit);
  }

  clearSession(options: { restoreAgentSkills?: boolean } = {}): void {
    store.dispatch(clearCurrentSession());
    void petService.setRuntimeProjectionFromCoworkState(store.getState().cowork);
    if (!options.restoreAgentSkills) {
      return;
    }

    const state = store.getState();
    const currentAgent = state.agent.agents.find((agent) => agent.id === state.agent.currentAgentId);
    const skillIds = currentAgent?.skillIds ?? [];
    if (skillIds.length > 0) {
      store.dispatch(setActiveSkillIds(skillIds));
    } else {
      store.dispatch(clearActiveSkills());
    }
  }

  destroy(): void {
    this.cleanupListeners();
    this.openClawStatusListeners.clear();
    this.latestLoadSessionsRequestIds.clear();
    this.pendingLoadSessionsByKey.clear();
    this.initialized = false;
  }
}

export const coworkService = new CoworkService();
