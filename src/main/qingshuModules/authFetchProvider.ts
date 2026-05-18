import type { AuthAdapter } from '../auth/adapter';
import type { QingShuAuthFetchProvider, QingShuFetchJsonOptions } from './types';

type CreateQingShuAuthFetchProviderDeps = {
  fetchFn: (url: string, options?: RequestInit) => Promise<Response>;
  getAuthAdapter: () => AuthAdapter;
  resolveApiBaseUrl: () => string | null;
};

type QingShuResultBody = {
  code?: number;
  msg?: string;
};

const QINGSHU_AUTH_FAILURE_PATTERN = /authentication failed|please login|未登录|登录失效|登录已失效|认证失败|token.*(expired|invalid)|invalid.*token/i;

const buildUrl = (
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | boolean | null | undefined>,
): string => {
  const target = path.startsWith('http://') || path.startsWith('https://')
    ? new URL(path)
    : new URL(path.replace(/^\//, ''), `${baseUrl.replace(/\/+$/, '')}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) {
        continue;
      }
      target.searchParams.set(key, String(value));
    }
  }
  return target.toString();
};

export const createQingShuAuthFetchProvider = (
  deps: CreateQingShuAuthFetchProviderDeps,
): QingShuAuthFetchProvider => {
  const resolveBaseUrl = (): string => {
    const baseUrl = deps.resolveApiBaseUrl();
    if (!baseUrl) {
      throw new Error('QingShu API base URL is not configured');
    }
    return baseUrl;
  };

  const buildHeaders = (accessToken: string, headers?: HeadersInit): Headers => {
    const result = new Headers(headers);
    result.set('Authorization', `Bearer ${accessToken}`);
    result.set('auth', `Bearer ${accessToken}`);
    return result;
  };

  const isQingShuAuthFailure = (
    response: Response,
    body?: QingShuResultBody | null,
  ): boolean => {
    if (response.status === 401) {
      return true;
    }
    if (!body) {
      return false;
    }
    return body.code === 401
      || (body.code === 403 && QINGSHU_AUTH_FAILURE_PATTERN.test(body.msg || ''));
  };

  const fetchWithAuth = async (path: string, options?: QingShuFetchJsonOptions): Promise<Response> => {
    const adapter = deps.getAuthAdapter();
    const accessToken = await adapter.getAccessToken();
    if (!accessToken) {
      throw new Error('QingShu auth token is not available');
    }

    const requestUrl = buildUrl(resolveBaseUrl(), path, options?.query);
    const doFetch = async (token: string): Promise<Response> =>
      deps.fetchFn(requestUrl, {
        ...options,
        headers: buildHeaders(token, options?.headers),
      });

    const parseResponseBody = async (response: Response): Promise<QingShuResultBody | null> => {
      const cloned = response.clone();
      return await cloned.json().catch((): null => null) as QingShuResultBody | null;
    };

    let response = await doFetch(accessToken);
    const responseBody = await parseResponseBody(response);
    if (!isQingShuAuthFailure(response, responseBody)) {
      return response;
    }

    const refreshResult = await adapter.refreshToken();
    if (!refreshResult.success || !refreshResult.accessToken) {
      return response;
    }
    response = await doFetch(refreshResult.accessToken);
    return response;
  };

  return {
    async fetchJsonWithAuth<T>(path: string, options?: QingShuFetchJsonOptions): Promise<T> {
      const response = await fetchWithAuth(path, options);
      const data: unknown = await response.json().catch((): null => null);
      if (!response.ok) {
        const message =
          typeof data === 'object' && data && 'msg' in data && typeof data.msg === 'string'
            ? data.msg
            : `QingShu request failed with status ${response.status}`;
        throw new Error(message);
      }
      return data as T;
    },

    async getCurrentUser() {
      return deps.getAuthAdapter().getUser();
    },

    async refreshIfNeeded() {
      return deps.getAuthAdapter().refreshToken();
    },
  };
};
