import { describe, expect, test, vi } from 'vitest';

import type { AuthAdapter } from '../auth/adapter';
import { createQingShuAuthFetchProvider } from './authFetchProvider';

const createAuthAdapter = (overrides: Partial<AuthAdapter> = {}): AuthAdapter => ({
  getBackend: vi.fn(async () => ({ success: true, backend: 'qtb' as never })),
  login: vi.fn(async () => ({ success: false })),
  loginWithPassword: vi.fn(async () => ({ success: false })),
  getFeishuScanWindowUrl: vi.fn(async () => ({ success: false })),
  getFeishuAuthorizeUrl: vi.fn(async () => ({ success: false })),
  createFeishuScanSession: vi.fn(async () => ({ success: false })),
  pollFeishuScanSession: vi.fn(async () => ({ success: false })),
  exchange: vi.fn(async () => ({ success: false })),
  createBridgeTicket: vi.fn(async () => ({ success: false })),
  exchangeBridgeCode: vi.fn(async () => ({ success: false })),
  getUser: vi.fn(async () => ({ success: false })),
  getQuota: vi.fn(async () => ({ success: false })),
  getProfileSummary: vi.fn(async () => ({ success: false })),
  logout: vi.fn(async () => ({ success: true })),
  refreshToken: vi.fn(async () => ({ success: false })),
  getAccessToken: vi.fn(async () => 'expired-token'),
  getModels: vi.fn(async () => ({ success: true, models: [] })),
  ...overrides,
});

describe('createQingShuAuthFetchProvider', () => {
  test('refreshes when auth failure is returned in response body', async () => {
    const refreshToken = vi.fn(async () => ({ success: true, accessToken: 'fresh-token' }));
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 403,
        msg: 'please login',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 200,
        data: { ok: true },
      }), { status: 200 }));

    const provider = createQingShuAuthFetchProvider({
      fetchFn,
      getAuthAdapter: () => createAuthAdapter({ refreshToken }),
      resolveApiBaseUrl: () => 'https://qingshu.example',
    });

    const result = await provider.fetchJsonWithAuth<{ code: number; data: { ok: boolean } }>(
      '/api/qingshu/test'
    );

    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ code: 200, data: { ok: true } });
  });
});
