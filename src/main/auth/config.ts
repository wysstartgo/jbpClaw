import type { AuthConfig } from '../../common/auth';
import { AuthBackend, DEFAULT_AUTH_CONFIG } from '../../common/auth';
import { getServerApiBaseUrl } from '../libs/endpoints';
import type { SqliteStore } from '../sqliteStore';

type StoredAppConfig = {
  auth?: Partial<AuthConfig>;
};

export type ResolvedAuthBackendConfig = {
  backend: AuthBackend;
  apiBaseUrl: string | null;
  webBaseUrl: string | null;
  eladminMpBaseUrl: string | null;
};

const normalizeBaseUrl = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().replace(/\/+$/, '');
};

const normalizeEladminMpBaseUrl = (value: unknown): string => {
  const normalized = normalizeBaseUrl(value);
  if (!normalized || normalized === 'http://localhost:8000' || normalized === 'http://localhost:8000/jbpapi') {
    return DEFAULT_AUTH_CONFIG.eladminMpBaseUrl;
  }
  return normalized;
};

export const resolveAuthConfig = (store: SqliteStore | null | undefined): AuthConfig => {
  const storedConfig = store?.get<StoredAppConfig>('app_config');
  const authConfig = storedConfig?.auth;
  const normalizedQtbApiBaseUrl =
    normalizeBaseUrl(authConfig?.qtbApiBaseUrl) || DEFAULT_AUTH_CONFIG.qtbApiBaseUrl;
  const normalizedQtbWebBaseUrl =
    normalizeBaseUrl(authConfig?.qtbWebBaseUrl) || DEFAULT_AUTH_CONFIG.qtbWebBaseUrl;
  const normalizedEladminMpBaseUrl = normalizeEladminMpBaseUrl(authConfig?.eladminMpBaseUrl);

  return {
    backend: authConfig?.backend === AuthBackend.Qtb
      ? AuthBackend.Qtb
      : DEFAULT_AUTH_CONFIG.backend,
    qtbApiBaseUrl: normalizedQtbApiBaseUrl,
    qtbWebBaseUrl: normalizedQtbWebBaseUrl,
    eladminMpBaseUrl: normalizedEladminMpBaseUrl,
  };
};

export const resolveAuthBackendConfig = (store: SqliteStore): ResolvedAuthBackendConfig => {
  const authConfig = resolveAuthConfig(store);

  if (authConfig.backend === AuthBackend.Qtb) {
    return {
      backend: AuthBackend.Qtb,
      apiBaseUrl: authConfig.qtbApiBaseUrl,
      webBaseUrl: authConfig.qtbWebBaseUrl,
      eladminMpBaseUrl: authConfig.eladminMpBaseUrl,
    };
  }

  const legacyBaseUrl = getServerApiBaseUrl();
  return {
    backend: AuthBackend.LegacyLobster,
    apiBaseUrl: legacyBaseUrl,
    webBaseUrl: legacyBaseUrl,
    eladminMpBaseUrl: authConfig.eladminMpBaseUrl,
  };
};
