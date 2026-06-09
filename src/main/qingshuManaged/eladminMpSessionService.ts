import type { AuthAdapter } from '../auth/adapter';

type FetchFn = (url: string, options?: RequestInit) => Promise<Response>;

type QtbResult<T> = {
  code: number;
  msg?: string;
  data?: T;
};

type TicketResponse = {
  callbackUrl?: string;
};

type ExchangeResponse = {
  token?: string;
  tenantCode?: string;
  redirect?: string;
  ssoSource?: string;
};

export type EladminMpSessionServiceDeps = {
  fetchFn: FetchFn;
  getAuthAdapter: () => AuthAdapter;
  resolveQtbApiBaseUrl: () => string | null;
  resolveEladminMpBaseUrl: () => string | null;
};

const SSO_CLIENT_ID = 'eladmin-mp';
const TOOL_RUNTIME_REDIRECT = '/qingshu-agent/tool-runtime';
const TOKEN_TTL_MS = 20 * 60 * 1000;
const QTB_SSO_SERVER_DISABLED_MESSAGE = 'SSO server 未启用';
const ELADMIN_MP_SSO_EXCHANGE_PATH = '/auth/sso/client/exchange';

const trimBaseUrl = (value: string | null | undefined): string | null => {
  const normalized = value?.trim().replace(/\/+$/, '');
  return normalized || null;
};

const parseQtbResult = async <T>(response: Response): Promise<T> => {
  const body = await response.json().catch((): QtbResult<T> | null => null);
  if (!response.ok || !body || body.code !== 200) {
    const message = body?.msg || `QTB SSO request failed: ${response.status}`;
    if (message.includes(QTB_SSO_SERVER_DISABLED_MESSAGE)) {
      throw new Error(
        `${QTB_SSO_SERVER_DISABLED_MESSAGE}：这是 QTB 后端配置开关未启用，不代表 JBPClaw 或 QTB 进程未启动。请检查当前 QTB profile 是否加载 s2.authentication.sso.server.enabled=true，并确认 s2.authentication.sso.server.clients.eladmin-mp 已配置 callback-url、shared-secret 和 allowed-redirect-prefixes。`,
      );
    }
    throw new Error(message);
  }
  return body.data as T;
};

export class EladminMpSessionService {
  private cachedToken: string | null = null;

  private cachedAt = 0;

  constructor(private readonly deps: EladminMpSessionServiceDeps) {}

  clear(): void {
    this.cachedToken = null;
    this.cachedAt = 0;
  }

  async getToken(options?: { forceRefresh?: boolean }): Promise<string> {
    if (!options?.forceRefresh && this.cachedToken && Date.now() - this.cachedAt < TOKEN_TTL_MS) {
      return this.cachedToken;
    }

    const token = await this.exchangeToken();
    this.cachedToken = token;
    this.cachedAt = Date.now();
    return token;
  }

  private async exchangeToken(): Promise<string> {
    const qtbBaseUrl = trimBaseUrl(this.deps.resolveQtbApiBaseUrl());
    const eladminBaseUrl = trimBaseUrl(this.deps.resolveEladminMpBaseUrl());
    if (!qtbBaseUrl) {
      throw new Error('QTB auth API base URL is not configured');
    }
    if (!eladminBaseUrl) {
      throw new Error('eladmin-mp base URL is not configured');
    }

    const qtbAccessToken = await this.deps.getAuthAdapter().getAccessToken();
    if (!qtbAccessToken) {
      throw new Error('JBP auth token is not available');
    }

    const ticketResponse = await this.deps.fetchFn(`${qtbBaseUrl}/api/auth/sso/server/ticket`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${qtbAccessToken}`,
        auth: `Bearer ${qtbAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clientId: SSO_CLIENT_ID,
        redirect: TOOL_RUNTIME_REDIRECT,
      }),
    });
    const ticket = await parseQtbResult<TicketResponse>(ticketResponse);
    const exchangePayload = this.parseCallbackUrl(ticket.callbackUrl);

    const exchangeUrl = `${eladminBaseUrl}${ELADMIN_MP_SSO_EXCHANGE_PATH}`;
    const exchangeResponse = await this.deps.fetchFn(exchangeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(exchangePayload),
    });
    if (!exchangeResponse.ok) {
      const text = await exchangeResponse.text().catch(() => '');
      if (exchangeResponse.status === 404) {
        throw new Error(
          `eladmin-mp SSO exchange failed: 404。当前请求地址为 ${exchangeUrl}，请检查 JBPClaw 设置中的 eladmin-mp API 地址是否包含 eladmin 后端 context-path，例如 http://localhost:8000/jbpapi 或 http://localhost:8008/cqjbpapi。`,
        );
      }
      throw new Error(text || `eladmin-mp SSO exchange failed: ${exchangeResponse.status}`);
    }
    const exchange = await exchangeResponse.json().catch((): ExchangeResponse | null => null);
    if (!exchange?.token) {
      throw new Error('eladmin-mp SSO exchange did not return a token');
    }
    return exchange.token;
  }

  private parseCallbackUrl(callbackUrl: string | undefined): Record<string, string | number> {
    if (!callbackUrl) {
      throw new Error('QTB SSO ticket did not return callbackUrl');
    }
    const parsed = new URL(callbackUrl, 'https://jbp.local');
    const hashQueryIndex = parsed.hash.indexOf('?');
    const params =
      parsed.searchParams.size > 0 || hashQueryIndex < 0
        ? parsed.searchParams
        : new URLSearchParams(parsed.hash.slice(hashQueryIndex + 1));
    const payload: Record<string, string | number> = {};
    for (const [key, value] of params.entries()) {
      payload[key] = key === 'timestamp' ? Number(value) : value;
    }
    if (!payload.clientId) {
      throw new Error('QTB SSO callbackUrl did not include clientId');
    }
    return payload;
  }
}
