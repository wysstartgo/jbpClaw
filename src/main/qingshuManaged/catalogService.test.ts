import { describe, expect, test, vi } from 'vitest';

import type { AuthAdapter } from '../auth/adapter';
import type { SkillManager } from '../skillManager';
import { QingShuManagedCatalogService } from './catalogService';

const createAuthAdapter = (): AuthAdapter => ({
  getBackend: vi.fn(async () => ({ success: true, backend: 'qtb' as never })),
  login: vi.fn(async () => ({ success: false })),
  loginWithPassword: vi.fn(async () => ({ success: false })),
  getFeishuScanWindowUrl: vi.fn(async () => ({ success: false })),
  createFeishuScanSession: vi.fn(async () => ({ success: false })),
  pollFeishuScanSession: vi.fn(async () => ({ success: false })),
  exchange: vi.fn(async () => ({ success: false })),
  createBridgeTicket: vi.fn(async () => ({ success: false })),
  exchangeBridgeCode: vi.fn(async () => ({ success: false })),
  getPendingCallback: vi.fn(() => null),
  getPendingBridgeCode: vi.fn(() => null),
  getUser: vi.fn(async () => ({ success: false })),
  getQuota: vi.fn(async () => ({ success: false })),
  getProfileSummary: vi.fn(async () => ({ success: false })),
  logout: vi.fn(async () => ({ success: true })),
  refreshToken: vi.fn(async () => ({ success: false })),
  getAccessToken: vi.fn(async () => 'expired-token'),
  getModels: vi.fn(async () => ({ success: true, models: [] })),
});

describe('QingShuManagedCatalogService auth invalidation', () => {
  test('notifies auth invalidation when managed tool refresh fails after 401', async () => {
    const onAuthSessionInvalidated = vi.fn();
    const service = new QingShuManagedCatalogService({
      fetchFn: vi.fn(async () => new Response(JSON.stringify({
        code: 401,
        msg: 'please login',
      }), { status: 401 })),
      getAuthAdapter: createAuthAdapter,
      resolveApiBaseUrl: () => 'https://qingshu.example',
      isAuthenticated: () => true,
      skillManager: {
        listSkills: () => [],
      } as unknown as SkillManager,
      onAuthSessionInvalidated,
    });

    await expect(service.invokeManagedMcpTool('claw.dictionary.search', {})).rejects.toThrow('please login');

    expect(onAuthSessionInvalidated).toHaveBeenCalledWith(
      'qingshu-managed-refresh-failed:/api/qingshu-claw/managed/tools/claw.dictionary.search/invoke',
    );
  });

  test('retries refresh when managed tool returns auth failure in response body', async () => {
    const refreshToken = vi.fn(async () => ({ success: true, accessToken: 'fresh-token' }));
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 403,
        msg: 'authentication failed, please login',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 200,
        data: {
          toolName: 'claw.dictionary.search',
          success: true,
          summary: 'ok',
          data: { items: [] },
        },
      }), { status: 200 }));

    const service = new QingShuManagedCatalogService({
      fetchFn,
      getAuthAdapter: () => ({
        ...createAuthAdapter(),
        refreshToken,
      }),
      resolveApiBaseUrl: () => 'https://qingshu.example',
      isAuthenticated: () => true,
      skillManager: {
        listSkills: () => [],
      } as unknown as SkillManager,
    });

    const result = await service.invokeManagedMcpTool('claw.dictionary.search', {});
    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(result.isError).toBe(false);
  });
});
