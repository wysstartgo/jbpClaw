import CryptoJS from 'crypto-js';
import {
  AuthBackend,
  BridgeTarget,
  FeishuScanSessionStatus,
  type AuthPasswordLoginInput,
  type CreateBridgeTicketRequest,
  type CreateBridgeTicketResponse,
  type DesktopBridgeSessionPayload,
  type ExchangeBridgeCodeRequest,
  type FeishuScanSession,
  type FeishuScanSessionPollResult,
} from '../../common/auth';

type StoredAuthTokens = {
  accessToken: string;
  refreshToken: string;
};

type NormalizeQuotaFn = (raw: Record<string, unknown>) => Record<string, unknown>;
type FetchFn = (url: string, options?: RequestInit) => Promise<Response>;
type OpenExternalFn = (url: string) => Promise<void>;

type AuthAdapterDeps = {
  backend: AuthBackend;
  fetchFn: FetchFn;
  openExternal: OpenExternalFn;
  onAuthSessionInvalidated?: (reason: string) => void;
  onServerModelMetadataUpdated?: () => void | Promise<void>;
  resolveApiBaseUrl: () => string | null;
  resolveWebBaseUrl: () => string | null;
  getAuthTokens: () => StoredAuthTokens | null;
  saveAuthTokens: (accessToken: string, refreshToken: string) => void;
  clearAuthTokens: () => void;
  normalizeQuota: NormalizeQuotaFn;
  updateServerModelMetadata: (
    models: Array<{ modelId: string; supportsImage?: boolean; contextWindow?: number }>
  ) => boolean;
  clearServerModelMetadata: () => void;
};

export interface AuthAdapter {
  getBackend(): Promise<{ success: boolean; backend: AuthBackend }>;
  login(input?: { loginUrl?: string }): Promise<{ success: boolean; error?: string }>;
  loginWithPassword(
    input: AuthPasswordLoginInput
  ): Promise<{ success: boolean; user?: any; quota?: any; error?: string }>;
  getFeishuScanWindowUrl(input: {
    authorizeUrl?: string;
    scanSessionId?: string;
  }): Promise<{ success: boolean; url?: string; error?: string }>;
  getFeishuAuthorizeUrl(): Promise<{ success: boolean; url?: string; error?: string }>;
  createFeishuScanSession(): Promise<{
    success: boolean;
    session?: FeishuScanSession;
    error?: string;
  }>;
  pollFeishuScanSession(scanSessionId: string): Promise<{
    success: boolean;
    session?: FeishuScanSessionPollResult;
    error?: string;
  }>;
  exchange(
    code: string,
    input?: { state?: string }
  ): Promise<{ success: boolean; user?: any; quota?: any; error?: string }>;
  createBridgeTicket(
    input: CreateBridgeTicketRequest
  ): Promise<{ success: boolean; data?: CreateBridgeTicketResponse; error?: string }>;
  exchangeBridgeCode(
    input: ExchangeBridgeCodeRequest
  ): Promise<{ success: boolean; user?: any; quota?: any; error?: string }>;
  getUser(): Promise<{ success: boolean; user?: any; quota?: any }>;
  getQuota(): Promise<{ success: boolean; quota?: any }>;
  getProfileSummary(): Promise<{ success: boolean; data?: any }>;
  logout(): Promise<{ success: boolean }>;
  refreshToken(): Promise<{ success: boolean; accessToken?: string }>;
  getAccessToken(): Promise<string | null>;
  getModels(): Promise<{
    success: boolean;
    models?: Array<{
      modelId: string;
      modelName: string;
      provider: string;
      apiFormat: string;
      supportsImage?: boolean;
    }>;
    error?: string;
  }>;
}

type QtbResult<T> = {
  code: number;
  msg?: string;
  data?: T;
};

type QtbUser = {
  id?: number | string;
  name?: string;
  displayName?: string;
  email?: string;
  isAdmin?: number;
  lastLogin?: string;
};

type QtbTokenClaims = {
  token_user_id?: number | string;
  token_user_name?: string;
  token_user_display_name?: string;
  token_user_email?: string;
  token_is_admin?: number;
};

type QtbQuota = {
  planName: string;
  subscriptionStatus: string;
  creditsLimit: number;
  creditsUsed: number;
  creditsRemaining: number;
};

type QtbProfileSummary = {
  id: number;
  nickname: string;
  avatarUrl: string | null;
  totalCreditsRemaining: number;
  creditItems: Array<{
    type: 'subscription' | 'boost' | 'free';
    label: string;
    labelEn: string;
    creditsRemaining: number;
    expiresAt: string | null;
  }>;
};

type QtbModel = {
  modelId: string;
  modelName: string;
  provider: string;
  apiFormat: string;
  modelKind?: string;
  supportsImage?: boolean;
  contextWindow?: number;
};

function notifyServerModelMetadataUpdated(deps: AuthAdapterDeps, tag: string): void {
  if (!deps.onServerModelMetadataUpdated) {
    return;
  }

  Promise.resolve(deps.onServerModelMetadataUpdated()).catch((error) => {
    console.warn(`[${tag}] Failed to refresh OpenClaw config after server model metadata update:`, error);
  });
}

type QtbAuthResponse = {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt?: number | null;
  refreshExpiresAt?: number | null;
  policyVersion?: number | null;
  effectiveAuth?: Record<string, unknown> | null;
};

type QtbScanSession = {
  scanSessionId: string;
  status: FeishuScanSessionStatus;
  authorizeUrl?: string;
  qrCodeContent?: string;
  expiredAt?: number;
  authResponse?: QtbAuthResponse | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

type QtbBridgeTicket = CreateBridgeTicketResponse;
type QtbBridgeSession = Partial<DesktopBridgeSessionPayload> & {
  accessToken?: string | null;
  refreshToken?: string | null;
  redirectPath?: string | null;
  target?: string | null;
};

const QTB_LOGIN_PASSWORD_ENCRYPTION_KEY = CryptoJS.enc.Utf8.parse('supersonic@2024');
const QTB_ACCESS_ERROR_CODE = 403;
const QTB_AUTHENTICATION_FAILED_PATTERN = /authentication failed|please login/i;
const QTB_DESKTOP_FEISHU_SCAN_PATH = '/login/desktop-scan';

const buildUnavailableError = (backend: AuthBackend): string =>
  `Auth backend ${backend} is not implemented yet in QingShuClaw`;

const createQtbQuotaFallback = () => ({
  planName: 'QTB',
  subscriptionStatus: 'active',
  creditsLimit: 0,
  creditsUsed: 0,
  creditsRemaining: 0,
});

const decodeJwtPayload = <T>(token: string): T | null => {
  try {
    const parts = token.split('.');
    if (parts.length < 2 || !parts[1]) {
      return null;
    }

    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf-8')) as T;
  } catch {
    return null;
  }
};

const normalizeIdentityValue = (value?: string | null): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || /^(null|undefined)$/i.test(normalized)) {
    return '';
  }
  return normalized;
};

const normalizeQtbUser = (user: QtbUser, claims?: QtbTokenClaims | null) => {
  const displayName = normalizeIdentityValue(
    user.displayName || claims?.token_user_display_name || ''
  );
  const name = normalizeIdentityValue(user.name || claims?.token_user_name || '');
  const email = normalizeIdentityValue(user.email || claims?.token_user_email || '');
  const nickname = displayName || name || email || 'QTB User';
  const userId = normalizeIdentityValue(
    String(user.id ?? claims?.token_user_id ?? name ?? email ?? '')
  );
  return {
    userId,
    phone: '',
    nickname,
    avatarUrl: '',
    name,
    displayName: displayName || nickname,
    email,
    isAdmin: user.isAdmin ?? claims?.token_is_admin ?? 0,
    lastLogin: user.lastLogin ?? null,
  };
};

const encryptQtbPassword = (password: string): string => {
  if (!password) {
    return password;
  }

  const src = CryptoJS.enc.Utf8.parse(password);
  const encrypted = CryptoJS.AES.encrypt(src, QTB_LOGIN_PASSWORD_ENCRYPTION_KEY, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  });
  return encrypted.toString();
};

const buildQtbAuthHeaders = (
  accessToken: string,
  headers: Record<string, string> = {}
): Record<string, string> => ({
  ...headers,
  Authorization: `Bearer ${accessToken}`,
  auth: `Bearer ${accessToken}`,
});

const isQtbAccessError = (body?: QtbResult<unknown> | null): boolean => {
  if (!body) {
    return false;
  }
  return body.code === QTB_ACCESS_ERROR_CODE
    || QTB_AUTHENTICATION_FAILED_PATTERN.test(body.msg || '');
};

export const createUnavailableAuthAdapter = (
  backend: AuthBackend,
  deps: Pick<AuthAdapterDeps, 'clearAuthTokens' | 'clearServerModelMetadata'>
): AuthAdapter => ({
  async getBackend() {
    return { success: true, backend };
  },
  async login() {
    return { success: false, error: buildUnavailableError(backend) };
  },
  async loginWithPassword() {
    return { success: false, error: buildUnavailableError(backend) };
  },
  async getFeishuScanWindowUrl() {
    return { success: false, error: buildUnavailableError(backend) };
  },
  async getFeishuAuthorizeUrl() {
    return { success: false, error: buildUnavailableError(backend) };
  },
  async createFeishuScanSession() {
    return { success: false, error: buildUnavailableError(backend) };
  },
  async pollFeishuScanSession() {
    return { success: false, error: buildUnavailableError(backend) };
  },
  async exchange() {
    return { success: false, error: buildUnavailableError(backend) };
  },
  async createBridgeTicket() {
    return { success: false, error: buildUnavailableError(backend) };
  },
  async exchangeBridgeCode() {
    return { success: false, error: buildUnavailableError(backend) };
  },
  async getUser() {
    return { success: false };
  },
  async getQuota() {
    return { success: false };
  },
  async getProfileSummary() {
    return { success: false };
  },
  async logout() {
    deps.clearAuthTokens();
    deps.clearServerModelMetadata();
    return { success: true };
  },
  async refreshToken() {
    return { success: false, error: buildUnavailableError(backend) };
  },
  async getAccessToken() {
    return null;
  },
  async getModels() {
    return { success: false, error: buildUnavailableError(backend) };
  },
});

export const createLegacyLobsterAuthAdapter = (deps: AuthAdapterDeps): AuthAdapter => {
  const resolveApiBaseUrl = (): string => {
    const baseUrl = deps.resolveApiBaseUrl();
    if (!baseUrl) {
      throw new Error('Auth API base URL is not configured');
    }
    return baseUrl;
  };

  const fetchWithAuth = async (url: string, options?: RequestInit): Promise<Response> => {
    const tokens = deps.getAuthTokens();
    if (!tokens) {
      throw new Error('No auth tokens');
    }

    const doFetch = (accessToken: string) =>
      deps.fetchFn(url, {
        ...options,
        headers: {
          ...(options?.headers as Record<string, string>),
          Authorization: `Bearer ${accessToken}`,
        },
      });

    let response = await doFetch(tokens.accessToken);
    if (response.status !== 401 || !tokens.refreshToken) {
      return response;
    }

    const refreshResponse = await deps.fetchFn(`${resolveApiBaseUrl()}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });

    if (!refreshResponse.ok) {
      return response;
    }

    const refreshBody = await refreshResponse.json() as {
      code: number;
      data?: { accessToken: string; refreshToken?: string };
    };

    if (refreshBody.code !== 0 || !refreshBody.data?.accessToken) {
      return response;
    }

    deps.saveAuthTokens(
      refreshBody.data.accessToken,
      refreshBody.data.refreshToken || tokens.refreshToken
    );
    response = await doFetch(refreshBody.data.accessToken);
    return response;
  };

  return {
    async getBackend() {
      return { success: true, backend: deps.backend };
    },

    async login(input = {}) {
      try {
        const baseUrl = input.loginUrl || `${resolveApiBaseUrl()}/login`;
        const finalUrl = `${baseUrl}?source=electron`;
        await deps.openExternal(finalUrl);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to open login',
        };
      }
    },

    async loginWithPassword() {
      return {
        success: false,
        error: `Auth backend ${deps.backend} does not support password login`,
      };
    },

    async getFeishuScanWindowUrl() {
      return {
        success: false,
        error: `Auth backend ${deps.backend} does not support Feishu scan login`,
      };
    },

    async getFeishuAuthorizeUrl() {
      return {
        success: false,
        error: `Auth backend ${deps.backend} does not support Feishu login`,
      };
    },

    async createFeishuScanSession() {
      return {
        success: false,
        error: `Auth backend ${deps.backend} does not support Feishu scan login`,
      };
    },

    async pollFeishuScanSession() {
      return {
        success: false,
        error: `Auth backend ${deps.backend} does not support Feishu scan login`,
      };
    },

    async exchange(code) {
      try {
        const response = await deps.fetchFn(`${resolveApiBaseUrl()}/api/auth/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ authCode: code }),
        });
        if (!response.ok) {
          return { success: false, error: `Exchange failed: ${response.status}` };
        }

        const body = await response.json() as {
          code: number;
          message?: string;
          data?: {
            accessToken: string;
            refreshToken: string;
            user: Record<string, unknown>;
            quota: Record<string, unknown>;
          };
        };

        if (body.code !== 0 || !body.data) {
          return { success: false, error: body.message || 'Exchange failed' };
        }

        deps.saveAuthTokens(body.data.accessToken, body.data.refreshToken);
        return {
          success: true,
          user: body.data.user,
          quota: deps.normalizeQuota(body.data.quota),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Exchange failed',
        };
      }
    },

    async getUser() {
      try {
        const tokens = deps.getAuthTokens();
        if (!tokens) {
          return { success: false };
        }

        const profileResponse = await fetchWithAuth(`${resolveApiBaseUrl()}/api/user/profile`);
        if (!profileResponse.ok) {
          return { success: false };
        }

        const profileBody = await profileResponse.json() as {
          code: number;
          data?: Record<string, unknown>;
        };
        if (profileBody.code !== 0 || !profileBody.data) {
          return { success: false };
        }

        const quotaResponse = await fetchWithAuth(`${resolveApiBaseUrl()}/api/user/quota`);
        let quota = null;
        if (quotaResponse.ok) {
          const quotaBody = await quotaResponse.json() as {
            code: number;
            data?: Record<string, unknown>;
          };
          if (quotaBody.code === 0 && quotaBody.data) {
            quota = deps.normalizeQuota(quotaBody.data);
          }
        }

        return { success: true, user: profileBody.data, quota };
      } catch {
        return { success: false };
      }
    },

    async getQuota() {
      try {
        const tokens = deps.getAuthTokens();
        if (!tokens) {
          return { success: false };
        }

        const response = await fetchWithAuth(`${resolveApiBaseUrl()}/api/user/quota`);
        if (!response.ok) {
          return { success: false };
        }

        const body = await response.json() as {
          code: number;
          data?: Record<string, unknown>;
        };
        if (body.code !== 0 || !body.data) {
          return { success: false };
        }

        return { success: true, quota: deps.normalizeQuota(body.data) };
      } catch {
        return { success: false };
      }
    },

    async getProfileSummary() {
      try {
        const tokens = deps.getAuthTokens();
        if (!tokens) {
          return { success: false };
        }

        const response = await fetchWithAuth(`${resolveApiBaseUrl()}/api/user/profile-summary`);
        if (!response.ok) {
          return { success: false };
        }

        const body = await response.json() as {
          code: number;
          data?: Record<string, unknown>;
        };
        if (body.code !== 0 || !body.data) {
          return { success: false };
        }

        return { success: true, data: body.data };
      } catch {
        return { success: false };
      }
    },

    async logout() {
      try {
        const tokens = deps.getAuthTokens();
        if (tokens) {
          await deps.fetchFn(`${resolveApiBaseUrl()}/api/auth/logout`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
          }).catch(() => {});
        }
      } finally {
        deps.clearAuthTokens();
        deps.clearServerModelMetadata();
      }
      return { success: true };
    },

    async refreshToken() {
      try {
        const tokens = deps.getAuthTokens();
        if (!tokens?.refreshToken) {
          return { success: false };
        }

        const response = await deps.fetchFn(`${resolveApiBaseUrl()}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: tokens.refreshToken }),
        });
        if (!response.ok) {
          return { success: false };
        }

        const body = await response.json() as {
          code: number;
          data?: { accessToken: string; refreshToken?: string };
        };
        if (body.code !== 0 || !body.data?.accessToken) {
          return { success: false };
        }

        deps.saveAuthTokens(body.data.accessToken, body.data.refreshToken || tokens.refreshToken);
        return { success: true, accessToken: body.data.accessToken };
      } catch {
        return { success: false };
      }
    },

    async getAccessToken() {
      return deps.getAuthTokens()?.accessToken || null;
    },

    async createBridgeTicket() {
      return {
        success: false,
        error: `Auth backend ${deps.backend} does not support bridge login`,
      };
    },

    async exchangeBridgeCode() {
      return {
        success: false,
        error: `Auth backend ${deps.backend} does not support bridge login`,
      };
    },

    async getModels() {
      try {
        const tokens = deps.getAuthTokens();
        if (!tokens) {
          console.log('[Auth:getModels] No auth tokens available');
          return { success: false };
        }

        const url = `${resolveApiBaseUrl()}/api/models/available`;
        console.log('[Auth:getModels] Fetching:', url);
        const response = await fetchWithAuth(url);
        console.log('[Auth:getModels] Response status:', response.status);
        if (!response.ok) {
          console.log('[Auth:getModels] Response not ok:', response.status, response.statusText);
          return { success: false };
        }

        const data = await response.json() as {
          code: number;
          data: Array<{
            modelId: string;
            modelName: string;
            provider: string;
            apiFormat: string;
            supportsImage?: boolean;
          }>;
        };
        console.log('[Auth:getModels] Response data:', JSON.stringify(data).slice(0, 500));
        if (data.code !== 0) {
          return { success: false };
        }

        if (deps.updateServerModelMetadata(data.data)) {
          notifyServerModelMetadataUpdated(deps, 'Auth:getModels');
        }
        return { success: true, models: data.data };
      } catch (error) {
        console.error('[Auth:getModels] Error:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to fetch models',
        };
      }
    },
  };
};

export const createQtbAuthAdapter = (deps: AuthAdapterDeps): AuthAdapter => {
  const resolveApiBaseUrl = (): string => {
    const baseUrl = deps.resolveApiBaseUrl();
    if (!baseUrl) {
      throw new Error('QTB auth API base URL is not configured');
    }
    return baseUrl;
  };

  const resolveWebBaseUrl = (): string => {
    const baseUrl = deps.resolveWebBaseUrl();
    if (!baseUrl) {
      throw new Error('QTB web base URL is not configured');
    }
    return baseUrl;
  };

  const fetchQtbResult = async <T>(path: string, options?: RequestInit): Promise<QtbResult<T>> => {
    const response = await deps.fetchFn(`${resolveApiBaseUrl()}${path}`, options);
    if (!response.ok) {
      throw new Error(`QTB request failed: ${response.status}`);
    }
    return await response.json() as QtbResult<T>;
  };

  const fetchQtbResultWithAuth = async <T>(
    accessToken: string,
    path: string,
    options?: RequestInit
  ): Promise<QtbResult<T>> => {
    return fetchQtbResult<T>(path, {
      ...options,
      headers: buildQtbAuthHeaders(accessToken, options?.headers as Record<string, string> | undefined),
    });
  };

  const refreshQtbAccessToken = async (): Promise<string | null> => {
    const tokens = deps.getAuthTokens();
    if (!tokens?.refreshToken) {
      return null;
    }

    const tryBridgeRefresh = async () => {
      const body = await fetchQtbResult<QtbBridgeSession>('/api/qingshu-claw/auth/bridge/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });
      if (body.code !== 200 || !body.data?.accessToken) {
        return null;
      }
      deps.saveAuthTokens(body.data.accessToken, body.data.refreshToken || tokens.refreshToken);
      return body.data.accessToken;
    };

    const tryQingShuRefresh = async () => {
      const body = await fetchQtbResult<QtbAuthResponse>('/api/datachat/qingshu/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });
      if (body.code !== 200 || !body.data?.accessToken) {
        return null;
      }
      deps.saveAuthTokens(body.data.accessToken, body.data.refreshToken || tokens.refreshToken);
      return body.data.accessToken;
    };

    const refreshedToken = await tryBridgeRefresh().catch((): null => null)
      || await tryQingShuRefresh().catch((): null => null);

    if (!refreshedToken) {
      deps.onAuthSessionInvalidated?.('refresh-failed');
    }

    return refreshedToken;
  };

  const fetchQtbResultWithSession = async <T>(
    path: string,
    options?: RequestInit,
    accessToken?: string | null
  ): Promise<QtbResult<T>> => {
    const activeToken = accessToken || deps.getAuthTokens()?.accessToken;
    if (!activeToken) {
      throw new Error('No QTB auth token available');
    }

    let body = await fetchQtbResultWithAuth<T>(activeToken, path, options);
    if (!isQtbAccessError(body)) {
      return body;
    }

    const refreshedAccessToken = await refreshQtbAccessToken();
    if (!refreshedAccessToken) {
      return body;
    }

    body = await fetchQtbResultWithAuth<T>(refreshedAccessToken, path, options);
    return body;
  };

  const fetchCurrentUser = async (accessToken?: string | null): Promise<QtbUser> => {
    const activeToken = accessToken || deps.getAuthTokens()?.accessToken;
    if (!activeToken) {
      throw new Error('No QTB auth token available');
    }

    let response = await deps.fetchFn(`${resolveApiBaseUrl()}/api/auth/user/getCurrentUser`, {
      method: 'GET',
      headers: buildQtbAuthHeaders(activeToken),
    });
    if (!response.ok) {
      throw new Error(`QTB current user request failed: ${response.status}`);
    }

    let body = await response.json() as QtbUser | QtbResult<QtbUser>;
    if (
      typeof body === 'object'
      && body !== null
      && 'code' in body
      && isQtbAccessError(body as QtbResult<QtbUser>)
    ) {
      const refreshedAccessToken = await refreshQtbAccessToken();
      if (!refreshedAccessToken) {
        throw new Error((body as QtbResult<QtbUser>).msg || 'authentication failed, please login');
      }
      response = await deps.fetchFn(`${resolveApiBaseUrl()}/api/auth/user/getCurrentUser`, {
        method: 'GET',
        headers: buildQtbAuthHeaders(refreshedAccessToken),
      });
      if (!response.ok) {
        throw new Error(`QTB current user request failed: ${response.status}`);
      }
      body = await response.json() as QtbUser | QtbResult<QtbUser>;
    }

    if (
      typeof body === 'object'
      && body !== null
      && 'data' in body
      && (body as QtbResult<QtbUser>).data
    ) {
      return (body as QtbResult<QtbUser>).data as QtbUser;
    }

    return body as QtbUser;
  };

  const fetchQtbQuota = async (accessToken?: string | null): Promise<QtbQuota> => {
    const activeToken = accessToken || deps.getAuthTokens()?.accessToken;
    if (!activeToken) {
      throw new Error('No QTB auth token available');
    }

    const body = await fetchQtbResultWithSession<QtbQuota>(
      '/api/qingshu-claw/auth/quota',
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
      },
      activeToken
    );

    if (body.code !== 200 || !body.data) {
      throw new Error(body.msg || 'Failed to fetch QTB quota');
    }

    return body.data;
  };

  const buildLoginSuccess = async (accessToken: string, refreshToken?: string | null) => {
    const claims = decodeJwtPayload<QtbTokenClaims>(accessToken);
    const [user, quota] = await Promise.all([
      fetchCurrentUser(accessToken),
      fetchQtbQuota(accessToken).catch(() => createQtbQuotaFallback()),
    ]);
    deps.saveAuthTokens(accessToken, refreshToken || accessToken);
    return {
      success: true,
      user: normalizeQtbUser(user, claims),
      quota,
    };
  };

  const normalizeBridgeLaunchUrl = (
    target: CreateBridgeTicketRequest['target'],
    response: QtbBridgeTicket
  ): string => {
    const rawLaunchUrl = response.launchUrl?.trim();
    if (!rawLaunchUrl) {
      if (target === BridgeTarget.Web) {
        return `${resolveWebBaseUrl()}/login/bridge?code=${encodeURIComponent(response.code)}`;
      }
      return `lobsterai://auth/bridge?code=${encodeURIComponent(response.code)}`;
    }

    if (/^https?:\/\//i.test(rawLaunchUrl) || rawLaunchUrl.startsWith('lobsterai://')) {
      return rawLaunchUrl;
    }

    if (target === BridgeTarget.Web && rawLaunchUrl.startsWith('/')) {
      return `${resolveWebBaseUrl()}${rawLaunchUrl}`;
    }

    return rawLaunchUrl;
  };

  const normalizeScanSession = (session: QtbScanSession): FeishuScanSession => ({
    scanSessionId: session.scanSessionId,
    status: session.status,
    authorizeUrl: session.authorizeUrl,
    qrCodeContent: session.qrCodeContent,
    expiredAt: session.expiredAt,
    errorCode: session.errorCode ?? null,
    errorMessage: session.errorMessage ?? null,
  });

  const getFeishuAuthorizeUrl = async () => {
    try {
      console.log('[QtbAuth] Requesting the Feishu authorize URL from the auth service');
      const body = await fetchQtbResult<string>('/api/auth/feishu/authorize', {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      if (body.code !== 200 || !body.data) {
        console.warn(`[QtbAuth] The auth service rejected the Feishu authorize URL request: ${body.msg || 'unknown error'}`);
        return { success: false, error: body.msg || 'Failed to get Feishu authorize URL' };
      }

      console.log('[QtbAuth] Received the Feishu authorize URL from the auth service');
      return { success: true, url: body.data };
    } catch (error) {
      console.error('[QtbAuth] Failed to fetch the Feishu authorize URL:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get Feishu authorize URL',
      };
    }
  };

  const getFeishuScanWindowUrl = async (input: {
    authorizeUrl?: string;
    scanSessionId?: string;
  }) => {
    const normalizedScanSessionId = input.scanSessionId?.trim();
    if (normalizedScanSessionId) {
      return {
        success: true,
        url: `${resolveWebBaseUrl()}${QTB_DESKTOP_FEISHU_SCAN_PATH}?scanSessionId=${encodeURIComponent(normalizedScanSessionId)}`,
      };
    }

    const normalizedAuthorizeUrl = input.authorizeUrl?.trim();
    if (normalizedAuthorizeUrl) {
      return {
        success: true,
        url: normalizedAuthorizeUrl,
      };
    }

    return {
      success: false,
      error: 'Failed to resolve Feishu scan window URL',
    };
  };

  return {
    async getBackend() {
      return { success: true, backend: deps.backend };
    },

    async login(input = {}) {
      try {
        let authorizeUrl = input.loginUrl?.trim();
        if (!authorizeUrl) {
          const result = await getFeishuAuthorizeUrl();
          if (!result.success || !result.url) {
            return { success: false, error: result.error || 'Failed to get Feishu authorize URL' };
          }
          authorizeUrl = result.url;
        }

        console.log('[QtbAuth] Opening the Feishu login page in the system browser');
        await deps.openExternal(authorizeUrl);
        return { success: true };
      } catch (error) {
        console.error('[QtbAuth] Failed to open the Feishu login page:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to open Feishu login',
        };
      }
    },

    async loginWithPassword(input) {
      try {
        const payload = {
          name: input.username.trim(),
          password: encryptQtbPassword(input.password),
        };

        const body = await fetchQtbResult<QtbBridgeSession>('/api/qingshu-claw/auth/password-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (body.code !== 200 || !body.data?.accessToken || !body.data?.refreshToken) {
          return { success: false, error: body.msg || 'QTB password login failed' };
        }

        return await buildLoginSuccess(body.data.accessToken, body.data.refreshToken);
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'QTB password login failed',
        };
      }
    },

    async getFeishuScanWindowUrl(input) {
      return getFeishuScanWindowUrl(input);
    },

    async getFeishuAuthorizeUrl() {
      return getFeishuAuthorizeUrl();
    },

    async createFeishuScanSession() {
      try {
        console.log('[QtbAuth] Creating a Feishu scan session for QingShuClaw');
        const body = await fetchQtbResult<QtbScanSession>('/api/datachat/qingshu/auth/scan/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channelType: 'qingshu',
            clientName: 'QingShuClaw',
            clientVersion: 'dev',
          }),
        });

        if (body.code !== 200 || !body.data) {
          console.warn(`[QtbAuth] The auth service rejected the Feishu scan session request: ${body.msg || 'unknown error'}`);
          return {
            success: false,
            error: body.msg || 'Failed to create Feishu scan session',
          };
        }

        console.log(
          `[QtbAuth] Created a Feishu scan session, sessionId=${body.data.scanSessionId}, status=${body.data.status}, expiredAt=${body.data.expiredAt ?? 'unknown'}`
        );

        return {
          success: true,
          session: normalizeScanSession(body.data),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create Feishu scan session',
        };
      }
    },

    async pollFeishuScanSession(scanSessionId: string) {
      try {
        const normalizedScanSessionId = scanSessionId.trim();
        if (!normalizedScanSessionId) {
          return { success: false, error: 'scanSessionId is required' };
        }

        console.debug(
          `[QtbAuth] Polling the Feishu scan session, sessionId=${normalizedScanSessionId}`
        );

        const body = await fetchQtbResult<QtbScanSession>(
          `/api/datachat/qingshu/auth/scan/session/${encodeURIComponent(normalizedScanSessionId)}`,
          {
            method: 'GET',
            headers: { Accept: 'application/json' },
          }
        );

        if (body.code !== 200 || !body.data) {
          console.warn(
            `[QtbAuth] The auth service rejected the Feishu scan session poll, sessionId=${normalizedScanSessionId}, message=${body.msg || 'unknown error'}`
          );
          return {
            success: false,
            error: body.msg || 'Failed to poll Feishu scan session',
          };
        }

        const session = body.data;
        console.debug(
          `[QtbAuth] Received the Feishu scan session status, sessionId=${normalizedScanSessionId}, status=${session.status}, hasAuthResponse=${session.authResponse?.accessToken ? 'yes' : 'no'}`
        );
        if (
          session.status === FeishuScanSessionStatus.Bound
          && session.authResponse?.accessToken
        ) {
          console.log(
            `[QtbAuth] The Feishu scan session is bound and ready to authenticate, sessionId=${normalizedScanSessionId}`
          );
          const loginResult = await buildLoginSuccess(
            session.authResponse.accessToken,
            session.authResponse.refreshToken
          );

          return {
            success: true,
            session: {
              ...normalizeScanSession(session),
              authenticated: true,
              user: loginResult.user,
              quota: loginResult.quota,
            },
          };
        }

        return {
          success: true,
          session: normalizeScanSession(session),
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to poll Feishu scan session',
        };
      }
    },

    async exchange(code, input = {}) {
      try {
        const body = await fetchQtbResult<string>('/api/auth/feishu/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code,
            ...(input.state ? { state: input.state } : {}),
          }),
        });

        if (body.code !== 200 || !body.data) {
          return { success: false, error: body.msg || 'QTB Feishu login failed' };
        }

        return await buildLoginSuccess(body.data, body.data);
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'QTB Feishu login failed',
        };
      }
    },

    async createBridgeTicket(input) {
      try {
        const body = await fetchQtbResultWithSession<QtbBridgeTicket>(
          '/api/qingshu-claw/auth/bridge/tickets',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
          }
        );

        if (body.code !== 200 || !body.data?.code) {
          return {
            success: false,
            error: body.msg || 'Failed to create bridge ticket',
          };
        }

        return {
          success: true,
          data: {
            ...body.data,
            launchUrl: normalizeBridgeLaunchUrl(input.target, body.data),
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create bridge ticket',
        };
      }
    },

    async exchangeBridgeCode(input) {
      try {
        const body = await fetchQtbResult<QtbBridgeSession>('/api/qingshu-claw/auth/bridge/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });

        if (body.code !== 200 || !body.data?.accessToken) {
          return {
            success: false,
            error: body.msg || 'Failed to exchange bridge code',
          };
        }

        return await buildLoginSuccess(body.data.accessToken, body.data.refreshToken);
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to exchange bridge code',
        };
      }
    },

    async getUser() {
      try {
        const accessToken = deps.getAuthTokens()?.accessToken;
        if (!accessToken) {
          return { success: false };
        }

        const claims = decodeJwtPayload<QtbTokenClaims>(accessToken);
        const [user, quota] = await Promise.all([
          fetchCurrentUser(accessToken),
          fetchQtbQuota(accessToken).catch(() => createQtbQuotaFallback()),
        ]);
        return {
          success: true,
          user: normalizeQtbUser(user, claims),
          quota,
        };
      } catch {
        return { success: false };
      }
    },

    async getQuota() {
      try {
        const quota = await fetchQtbQuota();
        return { success: true, quota };
      } catch {
        return { success: false };
      }
    },

    async getProfileSummary() {
      try {
        const body = await fetchQtbResultWithSession<QtbProfileSummary>(
          '/api/qingshu-claw/auth/profile-summary',
          {
            method: 'GET',
            headers: { Accept: 'application/json' },
          }
        );

        if (body.code !== 200 || !body.data) {
          return { success: false };
        }

        return { success: true, data: body.data };
      } catch {
        return { success: false };
      }
    },

    async logout() {
      deps.clearAuthTokens();
      deps.clearServerModelMetadata();
      return { success: true };
    },

    async refreshToken() {
      try {
        const refreshedAccessToken = await refreshQtbAccessToken();
        if (!refreshedAccessToken) {
          return { success: false };
        }

        return { success: true, accessToken: refreshedAccessToken };
      } catch {
        return { success: false };
      }
    },

    async getAccessToken() {
      return deps.getAuthTokens()?.accessToken || null;
    },

    async getModels() {
      try {
        const body = await fetchQtbResultWithSession<QtbModel[]>(
          '/api/qingshu-claw/models/available',
          {
            method: 'GET',
            headers: { Accept: 'application/json' },
          }
        );

        if (body.code !== 200 || !body.data) {
          console.warn('[QtbAuth] server models request failed:', {
            code: body.code,
            message: body.msg || 'unknown error',
          });
          return {
            success: false,
            error: body.msg || 'Failed to fetch QTB server models',
          };
        }

        const chatModels = body.data.filter(model => (model.modelKind ?? 'chat') === 'chat');
        if (chatModels.length === 0) {
          console.log('[QtbAuth] server models request returned an empty list');
        } else {
          console.log(`[QtbAuth] loaded ${chatModels.length} server chat models`);
        }
        if (deps.updateServerModelMetadata(chatModels)) {
          notifyServerModelMetadataUpdated(deps, 'QtbAuth');
        }
        return { success: true, models: chatModels };
      } catch (error) {
        console.error('[QtbAuth] server models request crashed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to fetch QTB server models',
        };
      }
    },
  };
};
