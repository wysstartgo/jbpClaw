import {
  AuthBackend,
  type AuthBackend as AuthBackendType,
  BridgeTarget,
  type CreateBridgeTicketRequest,
  DEFAULT_QTB_API_BASE_URL,
  type FeishuScanSession,
  type FeishuScanSessionPollResult,
} from '../../common/auth';
import { ProviderName } from '../../shared/providers';
import { AppCustomEvent } from '../constants/app';
import { store } from '../store';
import { setAgents, setCurrentAgentId } from '../store/slices/agentSlice';
import {
  setAuthLoading,
  setLoggedIn,
  setLoggedOut,
  setProfileSummary,
  updateQuota,
  updateUserAvatar,
} from '../store/slices/authSlice';
import { clearCurrentSession } from '../store/slices/coworkSlice';
import type { Model } from '../store/slices/modelSlice';
import { clearServerModels, setServerModels } from '../store/slices/modelSlice';
import { clearActiveSkills, setSkills } from '../store/slices/skillSlice';
import { disableQingShuManagedItems } from './authSessionReset';
import { agentService } from './agent';
import { configService } from './config';
import { i18nService } from './i18n';
import { qingshuManagedService } from './qingshuManaged';

class AuthService {
  private unsubCallback: (() => void) | null = null;
  private unsubBridgeCode: (() => void) | null = null;
  private unsubSessionInvalidated: (() => void) | null = null;
  private unsubQuotaChanged: (() => void) | null = null;
  private unsubWindowState: (() => void) | null = null;
  private lastRefreshTime = 0;
  private authSessionVersion = 0;
  private backgroundHydrationPromise: Promise<void> | null = null;
  private pendingFeishuScanSessionPromise: Promise<FeishuScanSession> | null = null;
  private cachedFeishuScanSession: FeishuScanSession | null = null;

  private isReusableFeishuScanSession(session?: FeishuScanSession | null): session is FeishuScanSession {
    if (!session?.scanSessionId) {
      return false;
    }

    if (!session.qrCodeContent && !session.authorizeUrl) {
      return false;
    }

    if (!session.expiredAt) {
      return true;
    }

    return session.expiredAt - Date.now() > 3000;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timeoutId: number | null = null;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = window.setTimeout(() => {
        reject(new Error(message));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    }
  }

  private getQtbApiBaseUrl(): string {
    const configured = configService.getConfig().auth?.qtbApiBaseUrl;
    if (typeof configured === 'string' && configured.trim()) {
      return configured.trim().replace(/\/+$/, '');
    }
    return DEFAULT_QTB_API_BASE_URL;
  }

  private normalizeFeishuScanSession(raw: any): FeishuScanSession {
    return {
      scanSessionId: raw?.scanSessionId || '',
      status: raw?.status,
      authorizeUrl: raw?.authorizeUrl || '',
      qrCodeContent: raw?.qrCodeContent || '',
      expiredAt: raw?.expiredAt,
      errorCode: raw?.errorCode ?? null,
      errorMessage: raw?.errorMessage ?? null,
    };
  }

  private async createFeishuScanSessionByApiFetch(): Promise<FeishuScanSession> {
    const baseUrl = this.getQtbApiBaseUrl();
    const response = await this.withTimeout(
      window.electron.api.fetch({
        url: `${baseUrl}/api/datachat/qingshu/auth/scan/session`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          channelType: 'qingshu',
          clientName: 'QingShuClaw',
          clientVersion: 'dev',
        }),
      }),
      15000,
      '创建飞书扫码会话超时，请检查本机 9080 服务与网络配置'
    );

    if (!response.ok || !response.data || typeof response.data !== 'object') {
      throw new Error(response.error || i18nService.t('authLoginFailed'));
    }

    const payload = response.data as {
      code?: number;
      msg?: string;
      data?: Record<string, unknown>;
    };
    if (payload.code !== 200 || !payload.data) {
      throw new Error(payload.msg || i18nService.t('authLoginFailed'));
    }

    const session = this.normalizeFeishuScanSession(payload.data);
    if (!session.scanSessionId || (!session.authorizeUrl && !session.qrCodeContent)) {
      throw new Error(i18nService.t('authFeishuScanQrUnavailable'));
    }
    return session;
  }

  private showToast(message: string) {
    window.dispatchEvent(new CustomEvent(AppCustomEvent.ShowToast, { detail: message }));
  }

  private notifyAgentCatalogRefreshed() {
    window.dispatchEvent(new CustomEvent(AppCustomEvent.AgentCatalogRefreshed));
  }

  private resetAuthRuntimeState(invalidateSession = false) {
    if (invalidateSession) {
      this.authSessionVersion += 1;
    }
    this.backgroundHydrationPromise = null;
    this.pendingFeishuScanSessionPromise = null;
    this.cachedFeishuScanSession = null;
    this.lastRefreshTime = 0;
  }

  private clearLocalSessionState() {
    this.resetAuthRuntimeState(true);
    const state = store.getState();
    const visibleAgents = disableQingShuManagedItems(state.agent.agents);
    const visibleSkills = disableQingShuManagedItems(state.skill.skills);
    store.dispatch(setAgents(visibleAgents));
    store.dispatch(setSkills(visibleSkills));
    store.dispatch(setCurrentAgentId('main'));
    store.dispatch(clearActiveSkills());
    store.dispatch(clearCurrentSession());
    store.dispatch(setLoggedOut());
    store.dispatch(clearServerModels());
  }

  private beginAuthenticatedSession(result: { user: any; quota?: any }): number {
    this.authSessionVersion += 1;
    store.dispatch(setLoggedIn({ user: result.user, quota: result.quota }));
    return this.authSessionVersion;
  }

  private isAuthSessionCurrent(version: number): boolean {
    return this.authSessionVersion === version && store.getState().auth.isLoggedIn;
  }

  private getAuthSessionGuard(version = this.authSessionVersion): () => boolean {
    return () => this.isAuthSessionCurrent(version);
  }

  private async hydrateAuthenticatedUser(version: number): Promise<void> {
    const shouldApply = () => this.isAuthSessionCurrent(version);
    const results = await Promise.allSettled([
      this.loadServerModels(shouldApply),
      qingshuManagedService.syncCatalog({ shouldApply }),
    ]);

    const catalogResult = results[1];
    if (catalogResult.status === 'rejected') {
      console.warn('[AuthService] failed to sync QingShu managed catalog:', catalogResult.reason);
    }

    if (!shouldApply()) {
      return;
    }

    // Re-apply the merged agent catalog after login so all workbench surfaces
    // refresh managed agents in place without switching the active conversation.
    await agentService.loadAgents({ shouldApply });
    if (!shouldApply()) {
      return;
    }
    this.notifyAgentCatalogRefreshed();

    void this.fetchProfileSummary(shouldApply);
  }

  private scheduleAuthenticatedHydration(version: number) {
    const task = this.hydrateAuthenticatedUser(version)
      .catch((error) => {
        console.warn('[AuthService] background hydration failed:', error);
      })
      .finally(() => {
        if (this.backgroundHydrationPromise === task) {
          this.backgroundHydrationPromise = null;
        }
      });

    this.backgroundHydrationPromise = task;
  }

  private async applyAuthenticatedUser(
    result: { user?: any; quota?: any },
    options: { backgroundHydration?: boolean } = {},
  ) {
    if (!result.user) {
      return false;
    }

    const version = this.beginAuthenticatedSession(result as { user: any; quota?: any });
    if (options.backgroundHydration) {
      this.scheduleAuthenticatedHydration(version);
      return true;
    }

    await this.hydrateAuthenticatedUser(version);
    return true;
  }

  /**
   * Initialize: try to restore login state from persisted token.
   */
  async init() {
    // Clean up any existing listeners to prevent stacking on repeated init()
    this.destroy();

    store.dispatch(setAuthLoading(true));
    try {
      const result = await window.electron.auth.getUser();
      const restored = result.success && await this.applyAuthenticatedUser(result, {
        backgroundHydration: true,
      });
      if (!restored) {
        this.clearLocalSessionState();
      }
    } catch {
      this.clearLocalSessionState();
    }

    // Listen for OAuth callback from protocol handler
    this.unsubCallback = window.electron.auth.onCallback(async ({ code, state }) => {
      await this.handleCallback(code, state);
    });
    this.unsubBridgeCode = window.electron.auth.onBridgeCode(async ({ code }) => {
      await this.handleBridgeCode(code);
    });
    this.unsubSessionInvalidated = window.electron.auth.onSessionInvalidated(({ reason }) => {
      this.clearLocalSessionState();
      if (reason?.startsWith('qingshu-managed-')) {
        this.showToast(i18nService.t('authQingShuManagedSessionExpired'));
      }
    });

    const pendingCallback = await window.electron.auth.getPendingCallback();
    if (pendingCallback?.code) {
      await this.handleCallback(pendingCallback.code, pendingCallback.state);
    }

    const pendingBridgeCode = await window.electron.auth.getPendingBridgeCode();
    if (pendingBridgeCode?.code) {
      await this.handleBridgeCode(pendingBridgeCode.code);
    }

    // Listen for quota changes (e.g. after cowork session using server model)
    this.unsubQuotaChanged = window.electron.auth.onQuotaChanged(() => {
      const shouldApply = this.getAuthSessionGuard();
      void this.refreshQuotaWithGuard(shouldApply);
      void this.loadServerModels(shouldApply);
    });

    // Refresh quota and models when Electron window gains focus — user may have purchased on portal
    this.unsubWindowState = window.electron.window.onStateChanged((state) => {
      if (state.isFocused && store.getState().auth.isLoggedIn) {
        const now = Date.now();
        if (now - this.lastRefreshTime > 30_000) {
          this.lastRefreshTime = now;
          const shouldApply = this.getAuthSessionGuard();
          void this.refreshQuotaWithGuard(shouldApply);
          void this.loadServerModels(shouldApply);
        }
      }
    });
  }

  /**
   * Initiate login (opens system browser).
   */
  async login() {
    const backend = await this.getBackend();
    const result = backend === AuthBackend.Qtb
      ? await window.electron.auth.login()
      : await window.electron.auth.login(await this.fetchLoginUrl());

    if (!result.success) {
      throw new Error(result.error || i18nService.t('authLoginFailed'));
    }
  }

  async createFeishuScanSession(forceRefresh = false): Promise<FeishuScanSession> {
    if (!forceRefresh && this.isReusableFeishuScanSession(this.cachedFeishuScanSession)) {
      return this.cachedFeishuScanSession;
    }

    if (!forceRefresh && this.pendingFeishuScanSessionPromise) {
      return this.pendingFeishuScanSessionPromise;
    }

    const requestPromise = (async () => {
      try {
        const result = await this.withTimeout(
          window.electron.auth.createFeishuScanSession(),
          8000,
          'auth:createFeishuScanSession timed out'
        );
        if (result.success && result.session) {
          this.cachedFeishuScanSession = result.session;
          return result.session;
        }
        throw new Error(result.error || 'auth:createFeishuScanSession returned no session');
      } catch (error) {
        console.warn('[Auth] Falling back to api.fetch for Feishu scan session:', error);
        const session = await this.createFeishuScanSessionByApiFetch();
        this.cachedFeishuScanSession = session;
        return session;
      } finally {
        this.pendingFeishuScanSessionPromise = null;
      }
    })();

    this.pendingFeishuScanSessionPromise = requestPromise;
    return requestPromise;
  }

  async openFeishuScanWindow(input: {
    authorizeUrl?: string;
    scanSessionId?: string;
  }) {
    const result = await this.withTimeout(
      window.electron.auth.openFeishuScanWindow(input),
      10000,
      '打开飞书扫码窗口超时，请重试'
    );
    if (!result.success) {
      throw new Error(result.error || i18nService.t('authLoginFailed'));
    }
  }

  async pollFeishuScanSession(scanSessionId: string): Promise<FeishuScanSessionPollResult> {
    const result = await window.electron.auth.pollFeishuScanSession(scanSessionId);
    if (!result.success || !result.session) {
      throw new Error(result.error || i18nService.t('authLoginFailed'));
    }

    if (
      this.cachedFeishuScanSession?.scanSessionId === scanSessionId
      && !result.session.authenticated
    ) {
      this.cachedFeishuScanSession = {
        ...this.cachedFeishuScanSession,
        ...result.session,
      };
    }

    if (
      result.session.authenticated
      || result.session.status === 'FAILED'
      || result.session.status === 'EXPIRED'
    ) {
      this.cachedFeishuScanSession = null;
    }

    if (result.session.authenticated && result.session.user) {
      await this.applyAuthenticatedUser(result.session);
    }

    return result.session;
  }

  async loginWithPassword(username: string, password: string) {
    const result = await window.electron.auth.loginWithPassword({
      username,
      password,
    });

    if (!result.success || !result.user || !result.quota) {
      throw new Error(result.error || i18nService.t('authLoginFailed'));
    }

    await this.applyAuthenticatedUser(result);
  }

  async getBackend(): Promise<AuthBackendType> {
    try {
      const result = await window.electron.auth.getBackend();
      return result.backend || AuthBackend.LegacyLobster;
    } catch {
      return AuthBackend.LegacyLobster;
    }
  }

  /**
   * Fetch login URL from overmind, fallback to Portal login page.
   */
  private async fetchLoginUrl(): Promise<string> {
    const { getLoginOvermindUrl } = await import('./endpoints');
    const url = getLoginOvermindUrl();
    try {
      const response = await window.electron.api.fetch({
        url,
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (response.ok && typeof response.data === 'object' && response.data !== null) {
        const value = (response.data as any)?.data?.value;
        if (typeof value === 'string' && value.trim()) {
          return value.trim();
        }
      }
    } catch (e) {
      console.error('[Auth] Failed to fetch login URL from overmind:', e);
    }
    // Fallback: use Portal login page directly
    const { getPortalLoginUrl } = await import('./endpoints');
    return getPortalLoginUrl();
  }

  /**
   * Handle OAuth callback with auth code.
   */
  async handleCallback(code: string, state?: string) {
    try {
      const result = await window.electron.auth.exchange(code, state);
      if (result.success) {
        await this.applyAuthenticatedUser(result);
      }
    } catch (e) {
      console.error('Auth callback failed:', e);
    }
  }

  async createBridgeTicket(input: CreateBridgeTicketRequest) {
    const result = await window.electron.auth.createBridgeTicket(input);
    if (!result.success || !result.data) {
      throw new Error(result.error || i18nService.t('authLoginFailed'));
    }
    return result.data;
  }

  async handleBridgeCode(code: string) {
    try {
      const result = await window.electron.auth.exchangeBridgeCode({
        code,
        target: BridgeTarget.Desktop,
      });
      if (result.success) {
        await this.applyAuthenticatedUser(result);
      } else {
        this.showToast(result.error || i18nService.t('authLoginFailed'));
      }
    } catch (e) {
      console.error('Bridge auth failed:', e);
      this.showToast(e instanceof Error ? e.message : i18nService.t('authLoginFailed'));
    }
  }

  async openQtbWebPortal(redirectPath = '/') {
    const bridgeTicket = await this.createBridgeTicket({
      target: BridgeTarget.Web,
      redirectPath,
    });
    if (!bridgeTicket.launchUrl) {
      throw new Error(i18nService.t('authLoginFailed'));
    }
    await window.electron.shell.openExternal(bridgeTicket.launchUrl);
  }

  async syncLoginState(): Promise<boolean> {
    try {
      const result = await window.electron.auth.getUser();
      if (!result.success || !result.user) {
        this.clearLocalSessionState();
        return false;
      }

      await this.applyAuthenticatedUser(result);
      return true;
    } catch {
      this.clearLocalSessionState();
      return false;
    }
  }

  /**
   * Logout.
   */
  async logout() {
    try {
      await window.electron.auth.logout();
    } finally {
      this.clearLocalSessionState();
    }
  }

  /**
   * Refresh quota information.
   */
  async refreshQuota() {
    const shouldApply = this.getAuthSessionGuard();
    return this.refreshQuotaWithGuard(shouldApply);
  }

  private async refreshQuotaWithGuard(shouldApply?: () => boolean) {
    try {
      const result = await window.electron.auth.getQuota();
      if (shouldApply && !shouldApply()) {
        return;
      }
      if (result.success && result.quota) {
        store.dispatch(updateQuota(result.quota));
        void this.fetchProfileSummary(shouldApply);
      }
    } catch {
      // ignore
    }
  }

  /**
   * Fetch profile summary (credits breakdown).
   */
  async fetchProfileSummary(shouldApply?: () => boolean) {
    try {
      const result = await window.electron.auth.getProfileSummary();
      if (shouldApply && !shouldApply()) {
        return;
      }
      if (result.success && result.data) {
        store.dispatch(setProfileSummary(result.data));
        if (result.data.avatarUrl) {
          store.dispatch(updateUserAvatar(result.data.avatarUrl));
        }
      }
    } catch {
      // ignore
    }
  }

  /**
   * Get current access token (for proxy API calls).
   */
  async getAccessToken(): Promise<string | null> {
    try {
      return await window.electron.auth.getAccessToken();
    } catch {
      return null;
    }
  }

  destroy() {
    this.resetAuthRuntimeState(true);
    this.unsubCallback?.();
    this.unsubCallback = null;
    this.unsubBridgeCode?.();
    this.unsubBridgeCode = null;
    this.unsubSessionInvalidated?.();
    this.unsubSessionInvalidated = null;
    this.unsubQuotaChanged?.();
    this.unsubQuotaChanged = null;
    this.unsubWindowState?.();
    this.unsubWindowState = null;
  }

  /**
   * Load available models from server and dispatch to store.
   */
  private async loadServerModels(shouldApply?: () => boolean) {
    try {
      const modelsResult = await window.electron.auth.getModels();
      if (shouldApply && !shouldApply()) {
        return;
      }
      if (modelsResult.success && modelsResult.models) {
        const serverModels: Model[] = modelsResult.models
          .filter((m: { modelKind?: string }) => (m.modelKind ?? 'chat') === 'chat')
          .map((m: { modelId: string; modelName: string; provider: string; apiFormat: string; modelKind?: string; supportsImage?: boolean }) => ({
          id: m.modelId,
          name: m.modelName,
          provider: m.provider,
          providerKey: ProviderName.QingShuServer,
          isServerModel: true,
          serverApiFormat: m.apiFormat,
          modelKind: m.modelKind ?? 'chat',
          supportsImage: m.supportsImage ?? false,
        }));
        store.dispatch(setServerModels(serverModels));
        console.log('[AuthService] server models injected into store:', {
          count: serverModels.length,
          modelIds: serverModels.map(model => model.id),
        });
      } else {
        console.warn('[AuthService] clearing server models because request was unsuccessful:', {
          error: 'unknown error',
        });
        store.dispatch(clearServerModels());
      }
    } catch (error) {
      if (shouldApply && !shouldApply()) {
        return;
      }
      console.error('[AuthService] clearing server models because request crashed:', error);
      store.dispatch(clearServerModels());
    }
  }
}

export const authService = new AuthService();
