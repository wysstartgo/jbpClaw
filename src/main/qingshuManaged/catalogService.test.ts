import { describe, expect, test, vi } from 'vitest';

import { QingShuFileToolName } from '../../shared/qingshuFile/constants';
import { QingShuObjectSourceType } from '../../shared/qingshuManaged/constants';
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
  test('does not expose local-only JBP tools through backend managed runtime manifest', async () => {
    const service = new QingShuManagedCatalogService({
      fetchFn: vi.fn(),
      getAuthAdapter: createAuthAdapter,
      resolveApiBaseUrl: () => 'https://qingshu.example',
      isAuthenticated: () => true,
      skillManager: {
        listSkills: () => [],
      } as unknown as SkillManager,
      store: {
        get: vi.fn(() => ({
          catalogVersion: 'test',
          syncedAt: 1,
          agents: [],
          skills: [],
          tools: [
            {
              toolName: QingShuFileToolName.Publish,
              description: 'Publish file',
              toolType: 'native',
              allowed: true,
              ownerSkillRefs: [],
              sourceType: 'qingshu-managed',
              readOnly: true,
              catalogVersion: 'test',
            },
            {
              toolName: 'claw.dictionary.search',
              description: 'Search dictionary',
              toolType: 'api',
              allowed: true,
              ownerSkillRefs: [],
              sourceType: 'qingshu-managed',
              readOnly: true,
              catalogVersion: 'test',
            },
          ],
        })),
        set: vi.fn(),
      },
    });

    const manifest = service.getManagedToolRuntimeManifest();
    expect(manifest.map((tool) => tool.name)).toEqual([
      'claw.dictionary.search',
    ]);
    expect(manifest[0]?.description).toContain(
      '[MCP alias: qingshu-managed__claw-dictionary-search]',
    );
  });

  test('blocks backend invocation for local-only JBP tools', async () => {
    const fetchFn = vi.fn();
    const service = new QingShuManagedCatalogService({
      fetchFn,
      getAuthAdapter: createAuthAdapter,
      resolveApiBaseUrl: () => 'https://qingshu.example',
      isAuthenticated: () => true,
      skillManager: {
        listSkills: () => [],
      } as unknown as SkillManager,
    });

    const result = await service.invokeManagedMcpTool(QingShuFileToolName.Publish, {
      filePath: '/tmp/report.png',
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: expect.stringContaining('JBPClaw local MCP runtime'),
        },
      ],
    });
  });

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

  test('sends trace metadata and auth headers when invoking managed tools', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
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
      getAuthAdapter: createAuthAdapter,
      resolveApiBaseUrl: () => 'https://qingshu.example',
      isAuthenticated: () => true,
      getDeviceId: () => 'device-001',
      skillManager: {
        listSkills: () => [],
      } as unknown as SkillManager,
    });

    await service.invokeManagedMcpTool('claw.dictionary.search', {
      keyword: '老乡鸡',
    });

    const requestInit = fetchFn.mock.calls[0]?.[1];
    expect(requestInit?.headers).toBeInstanceOf(Headers);
    const headers = requestInit?.headers as Headers;
    const requestId = headers.get('x-qingshu-request-id');
    expect(requestId).toMatch(/^qingshu_tool_/);
    expect(headers.get('traceId')).toBe(requestId);
    expect(headers.get('x-qingshu-device-id')).toBe('device-001');
    expect(headers.get('Authorization')).toBe('Bearer expired-token');
    expect(headers.get('auth')).toBe('Bearer expired-token');
  });

  test('routes eladmin-mp-api tools to local SSO runtime', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 200,
        data: {
          callbackUrl: 'https://eladmin.example/sso/callback?clientId=eladmin-mp&principalType=user&externalTenantCode=qtb&externalUserId=u1&nonce=n1&timestamp=1710000000000&redirect=%2Fqingshu-agent%2Ftool-runtime&signature=sig',
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        token: 'Bearer eladmin-token',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        summary: 'mapping ok',
        data: { items: [] },
        warnings: [],
        permission: {},
        traceId: 'trace-1',
      }), { status: 200 }));

    const service = new QingShuManagedCatalogService({
      fetchFn,
      getAuthAdapter: () => ({
        ...createAuthAdapter(),
        getAccessToken: vi.fn(async () => 'qtb-token'),
      }),
      resolveApiBaseUrl: () => 'https://qtb.example',
      resolveEladminMpBaseUrl: () => 'https://eladmin.example/jbpapi',
      isAuthenticated: () => true,
      skillManager: {
        listSkills: () => [],
      } as unknown as SkillManager,
      store: {
        get: () => ({
          catalogVersion: 'test',
          syncedAt: Date.now(),
          agents: [],
          skills: [],
          tools: [{
            toolName: 'eladmin_mp_sso_mapping_check',
            description: 'check mapping',
            toolType: 'eladmin-mp-api',
            toolDomain: 'governance',
            allowed: true,
            ownerSkillRefs: ['eladmin-mp-access-governance'],
            inputSchema: {},
            dangerLevel: 'read',
            sourceType: QingShuObjectSourceType.QingShuManaged,
            readOnly: true,
            catalogVersion: 'test',
            backendToolName: 'eladmin_mp_sso_mapping_check',
          }],
        }),
        set: vi.fn(),
      },
    });

    const result = await service.invokeManagedMcpTool('eladmin_mp_sso_mapping_check', {
      filters: { externalUserId: 'u1' },
    });

    expect(result.isError).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(String(fetchFn.mock.calls[1][0])).toBe('https://eladmin.example/jbpapi/auth/sso/client/exchange');
    expect(String(fetchFn.mock.calls[2][0])).toBe('https://eladmin.example/jbpapi/api/qingshu-agent/eladmin-mp/tools/invoke');
    expect(fetchFn.mock.calls.some(([url]) => String(url).includes('/managed/tools/'))).toBe(false);
  });

  test('parses eladmin SSO callback params from Vue hash route', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 200,
        data: {
          callbackUrl: 'https://eladmin.example/jbpapi/#/sso/callback?clientId=eladmin-mp&principalType=QTB_USER&externalTenantCode=qtb-default&externalUserId=u1&nonce=n1&timestamp=1710000000000&redirect=%2Fqingshu-agent%2Ftool-runtime&signature=sig',
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        token: 'Bearer eladmin-token',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        summary: 'mapping ok',
        data: { items: [] },
        warnings: [],
        permission: {},
        traceId: 'trace-1',
      }), { status: 200 }));

    const service = new QingShuManagedCatalogService({
      fetchFn,
      getAuthAdapter: () => ({
        ...createAuthAdapter(),
        getAccessToken: vi.fn(async () => 'qtb-token'),
      }),
      resolveApiBaseUrl: () => 'https://qtb.example',
      resolveEladminMpBaseUrl: () => 'https://eladmin.example/jbpapi',
      isAuthenticated: () => true,
      skillManager: {
        listSkills: () => [],
      } as unknown as SkillManager,
      store: {
        get: () => ({
          catalogVersion: 'test',
          syncedAt: Date.now(),
          agents: [],
          skills: [],
          tools: [{
            toolName: 'eladmin_mp_sso_mapping_check',
            description: 'check mapping',
            toolType: 'eladmin-mp-api',
            toolDomain: 'governance',
            allowed: true,
            ownerSkillRefs: ['eladmin-mp-access-governance'],
            inputSchema: {},
            dangerLevel: 'read',
            sourceType: QingShuObjectSourceType.QingShuManaged,
            readOnly: true,
            catalogVersion: 'test',
            backendToolName: 'eladmin_mp_sso_mapping_check',
          }],
        }),
        set: vi.fn(),
      },
    });

    const result = await service.invokeManagedMcpTool('eladmin_mp_sso_mapping_check', {
      filters: { externalUserId: 'u1' },
    });

    expect(result.isError).toBe(false);
    const exchangeBody = JSON.parse(String(fetchFn.mock.calls[1][1]?.body));
    expect(exchangeBody).toMatchObject({
      clientId: 'eladmin-mp',
      principalType: 'QTB_USER',
      externalTenantCode: 'qtb-default',
      externalUserId: 'u1',
      redirect: '/qingshu-agent/tool-runtime',
    });
    expect(exchangeBody.timestamp).toBe(1710000000000);
  });

  test('explains eladmin context path when SSO exchange endpoint returns 404', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 200,
        data: {
          callbackUrl: 'https://eladmin.example/sso/callback?clientId=eladmin-mp&principalType=user&externalTenantCode=qtb&externalUserId=u1&nonce=n1&timestamp=1710000000000&redirect=%2Fqingshu-agent%2Ftool-runtime&signature=sig',
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }));

    const service = new QingShuManagedCatalogService({
      fetchFn,
      getAuthAdapter: () => ({
        ...createAuthAdapter(),
        getAccessToken: vi.fn(async () => 'qtb-token'),
      }),
      resolveApiBaseUrl: () => 'https://qtb.example',
      resolveEladminMpBaseUrl: () => 'https://eladmin.example',
      isAuthenticated: () => true,
      skillManager: {
        listSkills: () => [],
      } as unknown as SkillManager,
      store: {
        get: () => ({
          catalogVersion: 'test',
          syncedAt: Date.now(),
          agents: [],
          skills: [],
          tools: [{
            toolName: 'eladmin_mp_sso_mapping_check',
            description: 'check mapping',
            toolType: 'eladmin-mp-api',
            toolDomain: 'governance',
            allowed: true,
            ownerSkillRefs: ['eladmin-mp-access-governance'],
            inputSchema: {},
            dangerLevel: 'read',
            sourceType: QingShuObjectSourceType.QingShuManaged,
            readOnly: true,
            catalogVersion: 'test',
            backendToolName: 'eladmin_mp_sso_mapping_check',
          }],
        }),
        set: vi.fn(),
      },
    });

    await expect(service.invokeManagedMcpTool('eladmin_mp_sso_mapping_check', {}))
      .rejects.toThrow('eladmin-mp API 地址是否包含 eladmin 后端 context-path');
  });

  test('explains QTB SSO server config gate when local eladmin runtime cannot create ticket', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 500,
        msg: 'SSO server 未启用',
      }), { status: 500 }));

    const service = new QingShuManagedCatalogService({
      fetchFn,
      getAuthAdapter: () => ({
        ...createAuthAdapter(),
        getAccessToken: vi.fn(async () => 'qtb-token'),
      }),
      resolveApiBaseUrl: () => 'https://qtb.example',
      resolveEladminMpBaseUrl: () => 'https://eladmin.example',
      isAuthenticated: () => true,
      skillManager: {
        listSkills: () => [],
      } as unknown as SkillManager,
      store: {
        get: () => ({
          catalogVersion: 'test',
          syncedAt: Date.now(),
          agents: [],
          skills: [],
          tools: [{
            toolName: 'eladmin_mp_sso_mapping_check',
            description: 'check mapping',
            toolType: 'eladmin-mp-api',
            toolDomain: 'governance',
            allowed: true,
            ownerSkillRefs: ['eladmin-mp-access-governance'],
            inputSchema: {},
            dangerLevel: 'read',
            sourceType: QingShuObjectSourceType.QingShuManaged,
            readOnly: true,
            catalogVersion: 'test',
            backendToolName: 'eladmin_mp_sso_mapping_check',
          }],
        }),
        set: vi.fn(),
      },
    });

    await expect(service.invokeManagedMcpTool('eladmin_mp_sso_mapping_check', {}))
      .rejects.toThrow('这是 QTB 后端配置开关未启用，不代表 JBPClaw 或 QTB 进程未启动');
  });
});
