import { describe, expect, test } from 'vitest';

import { AuthBackend, DEFAULT_AUTH_CONFIG } from '../../common/auth';
import { resolveAuthConfig } from './config';

const createStore = (auth: Record<string, unknown>) => ({
  get: () => ({ auth }),
});

describe('resolveAuthConfig', () => {
  test('migrates stale local eladmin-mp base URLs to current default', () => {
    const config = resolveAuthConfig(createStore({
      backend: AuthBackend.Qtb,
      eladminMpBaseUrl: 'http://localhost:8000/jbpapi',
    }) as never);

    expect(config.eladminMpBaseUrl).toBe(DEFAULT_AUTH_CONFIG.eladminMpBaseUrl);
  });

  test('keeps explicit non-stale eladmin-mp base URL', () => {
    const config = resolveAuthConfig(createStore({
      backend: AuthBackend.Qtb,
      eladminMpBaseUrl: 'http://localhost:8010/custom-api/',
    }) as never);

    expect(config.eladminMpBaseUrl).toBe('http://localhost:8010/custom-api');
  });
});
