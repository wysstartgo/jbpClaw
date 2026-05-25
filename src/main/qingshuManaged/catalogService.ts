import {
  QingShuManagedToolRuntime,
  QingShuObjectSourceType,
} from '../../shared/qingshuManaged/constants';
import { QingShuFileToolName } from '../../shared/qingshuFile/constants';
import type {
  QingShuManagedAgentDescriptor,
  QingShuManagedCatalogSnapshot,
  QingShuManagedSkillDescriptor,
  QingShuManagedToolDescriptor,
} from '../../shared/qingshuManaged/types';
import type { AuthAdapter } from '../auth/adapter';
import type { Agent } from '../coworkStore';
import type { SkillManager } from '../skillManager';

type FetchFn = (url: string, options?: RequestInit) => Promise<Response>;

type QingShuManagedCatalogServiceDeps = {
  fetchFn: FetchFn;
  getAuthAdapter: () => AuthAdapter;
  resolveApiBaseUrl: () => string | null;
  isAuthenticated: () => boolean;
  skillManager: SkillManager;
  store?: {
    get<T = unknown>(key: string): T | undefined;
    set<T = unknown>(key: string, value: T): void;
  };
  onCatalogChanged?: () => void;
  onAuthSessionInvalidated?: (reason: string) => void;
};

type QtbResult<T> = {
  code: number;
  msg?: string;
  data?: T;
};

type ManagedToolInvokeResponse = {
  toolName: string;
  success: boolean;
  summary?: string;
  data?: unknown;
  errorMessage?: string;
};

export type QingShuManagedNativeToolManifestEntry = {
  server: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type QingShuManagedMcpToolResult = {
  content: Array<{ type: string; text?: string }>;
  isError: boolean;
};

const MANAGED_AGENT_ID_PREFIX = 'qingshu-managed:';
const QINGSHU_MANAGED_CATALOG_SNAPSHOT_KEY = 'qingshuManaged.catalogSnapshot.v1';
const QINGSHU_MANAGED_AGENT_EXTRA_SKILL_IDS_KEY = 'qingshuManaged.agentExtraSkillIds.v1';
const MANAGED_TOOL_TIMEOUT_MS = 600_000;
const QINGSHU_AUTHENTICATION_FAILED_PATTERN = /authentication failed|please login|未登录|登录失效|登录已失效|认证失败|token.*(expired|invalid)|invalid.*token/i;
const QINGSHU_LOCAL_ONLY_TOOL_NAMES = new Set<string>([
  QingShuFileToolName.Publish,
]);

const emptySnapshot = (): QingShuManagedCatalogSnapshot => ({
  catalogVersion: '',
  syncedAt: 0,
  agents: [],
  skills: [],
  tools: [],
});

const toManagedAgentId = (backendAgentId: string): string =>
  `${MANAGED_AGENT_ID_PREFIX}${backendAgentId}`;

const fromManagedAgentId = (agentId: string): string | null =>
  agentId.startsWith(MANAGED_AGENT_ID_PREFIX)
    ? agentId.slice(MANAGED_AGENT_ID_PREFIX.length)
    : null;

const buildAuthHeaders = (accessToken: string, headers?: HeadersInit): Headers => {
  const result = new Headers(headers);
  result.set('Authorization', `Bearer ${accessToken}`);
  result.set('auth', `Bearer ${accessToken}`);
  return result;
};

const stringifyToolPayload = (payload: unknown): string => {
  if (typeof payload === 'string') {
    return payload;
  }
  return JSON.stringify(payload ?? {}, null, 2);
};

const clipText = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;

const buildManagedToolAlias = (toolName: string): string =>
  `mcp_${QingShuManagedToolRuntime.ServerName.replace(/[^a-z0-9]+/gi, '_')}_${toolName.replace(/[^a-z0-9]+/gi, '_')}`
    .toLowerCase();

const summarizeToolArgs = (args: Record<string, unknown>): string =>
  clipText(stringifyToolPayload(args), 512);

const isAbortError = (error: unknown): boolean =>
  error instanceof Error
  && (error.name === 'AbortError' || /abort|timed out/i.test(error.message));

const isQingShuAuthFailure = (response: Response, body?: QtbResult<unknown> | null): boolean => {
  if (response.status === 401) return true;
  if (!body) return false;
  return body.code === 401
    || (body.code === 403 && QINGSHU_AUTHENTICATION_FAILED_PATTERN.test(body.msg || ''));
};

export class QingShuManagedCatalogService {
  private snapshot: QingShuManagedCatalogSnapshot;

  constructor(private readonly deps: QingShuManagedCatalogServiceDeps) {
    this.snapshot = this.loadPersistedSnapshot();
  }

  getSnapshot(): QingShuManagedCatalogSnapshot {
    return {
      ...this.snapshot,
      agents: this.snapshot.agents.map((agent) => ({ ...agent })),
      skills: this.snapshot.skills.map((skill) => ({ ...skill })),
      tools: this.snapshot.tools.map((tool) => ({ ...tool })),
    };
  }

  reset(): void {
    this.snapshot = emptySnapshot();
    this.persistSnapshot();
    this.deps.onCatalogChanged?.();
  }

  async syncCatalog(): Promise<{ success: boolean; snapshot?: QingShuManagedCatalogSnapshot; error?: string }> {
    try {
      const accessToken = await this.deps.getAuthAdapter().getAccessToken();
      if (!accessToken || !this.deps.resolveApiBaseUrl()) {
        return { success: true, snapshot: this.getSnapshot() };
      }

      const agents = await this.fetchResult<QingShuManagedAgentDescriptor[]>(
        '/api/qingshu-claw/managed/agents',
      );
      const skillMap = new Map<string, QingShuManagedSkillDescriptor>();
      const toolMap = new Map<string, QingShuManagedToolDescriptor>();

      for (const agent of agents) {
        const agentId = encodeURIComponent(agent.agentId);
        const [skills, tools] = await Promise.all([
          this.fetchResult<QingShuManagedSkillDescriptor[]>(
            `/api/qingshu-claw/managed/agents/${agentId}/skills`,
          ),
          this.fetchResult<QingShuManagedToolDescriptor[]>(
            `/api/qingshu-claw/managed/agents/${agentId}/tools`,
          ),
        ]);

        for (const skill of skills) {
          skillMap.set(skill.skillId, skill);
          try {
            this.deps.skillManager.applyManagedSkillAccess(skill);
          } catch (error) {
            console.warn(
              `[QingShuManaged] failed to apply managed skill access for "${skill.skillId}": ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
          if (skill.allowed) {
            const syncResult = await this.deps.skillManager.syncManagedSkillPackage(skill);
            if (!syncResult.success) {
              console.warn(
                `[QingShuManaged] failed to sync managed skill "${skill.skillId}": ${syncResult.error}`,
              );
            }
          }
        }

        for (const tool of tools) {
          toolMap.set(tool.toolName, tool);
        }
      }

      const disabledCount = this.deps.skillManager.disableManagedSkillsNotInCatalog(
        new Set(skillMap.keys()),
      );
      if (disabledCount > 0) {
        console.log(
          '[QingShuManaged] disabled %d local managed skills that are absent from the latest catalog',
          disabledCount,
        );
      }

      const catalogVersion = [
        ...agents.map((agent) => agent.catalogVersion || ''),
        ...Array.from(skillMap.values()).map((skill) => skill.catalogVersion || ''),
        ...Array.from(toolMap.values()).map((tool) => tool.catalogVersion || ''),
      ]
        .filter((value) => value.length > 0)
        .sort()
        .pop() || String(Date.now());

      this.snapshot = {
        catalogVersion,
        syncedAt: Date.now(),
        agents,
        skills: Array.from(skillMap.values()),
        tools: Array.from(toolMap.values()),
      };
      this.persistSnapshot();
      this.deps.onCatalogChanged?.();
      return { success: true, snapshot: this.getSnapshot() };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to sync QingShu managed catalog',
      };
    }
  }

  listManagedAgents(): Agent[] {
    const availableExtraSkillIds = new Set(
      this.deps.skillManager
        .listSkills()
        .filter((skill) =>
          skill.enabled
          && skill.sourceType !== QingShuObjectSourceType.QingShuManaged,
        )
        .map((skill) => skill.id),
    );

    return this.snapshot.agents.map((agent) => {
      const extraSkillIds = this.getManagedAgentExtraSkillIds(toManagedAgentId(agent.agentId))
        .filter((skillId) => availableExtraSkillIds.has(skillId));
      const mergedSkillIds = Array.from(new Set([...(agent.skillIds ?? []), ...extraSkillIds]));
      return {
        id: toManagedAgentId(agent.agentId),
        name: agent.name,
        description: agent.description,
        systemPrompt: agent.systemPrompt?.trim() || '',
        identity: agent.identity?.trim() || '',
        model: '',
        workingDirectory: '',
        icon: '🦞',
        skillIds: mergedSkillIds,
        toolBundleIds: [] as string[],
        enabled: agent.enabled && agent.allowed,
        isDefault: false,
        source: 'managed',
        sourceType: QingShuObjectSourceType.QingShuManaged,
        readOnly: true,
        allowed: agent.allowed,
        backendAgentId: agent.agentId,
        managedToolNames: agent.toolNames,
        managedBaseSkillIds: agent.skillIds ?? [],
        managedExtraSkillIds: extraSkillIds,
        policyNote: agent.policyNote,
        presetId: '',
        createdAt: this.snapshot.syncedAt,
        updatedAt: this.snapshot.syncedAt,
      };
    });
  }

  getManagedAgent(agentId: string): Agent | null {
    return this.listManagedAgents().find((agent) => agent.id === agentId) ?? null;
  }

  getManagedAgentExtraSkillIds(agentId: string): string[] {
    const backendAgentId = fromManagedAgentId(agentId);
    if (!backendAgentId || !this.deps.store) {
      return [];
    }

    const raw = this.deps.store.get<Record<string, unknown>>(QINGSHU_MANAGED_AGENT_EXTRA_SKILL_IDS_KEY);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return [];
    }

    const value = raw[backendAgentId];
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  setManagedAgentExtraSkillIds(agentId: string, skillIds: string[]): Agent | null {
    const backendAgentId = fromManagedAgentId(agentId);
    if (!backendAgentId || !this.deps.store) {
      return null;
    }

    const normalizedSkillIds = Array.from(new Set(
      skillIds
        .map((skillId) => skillId.trim())
        .filter(Boolean),
    ));

    const raw = this.deps.store.get<Record<string, unknown>>(QINGSHU_MANAGED_AGENT_EXTRA_SKILL_IDS_KEY);
    const nextMap: Record<string, string[]> = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? Object.fromEntries(
        Object.entries(raw)
          .filter(([, value]) => Array.isArray(value))
          .map(([key, value]) => [
            key,
            (value as unknown[])
              .filter((item): item is string => typeof item === 'string')
              .map((item) => item.trim())
              .filter(Boolean),
          ]),
      )
      : {};

    if (normalizedSkillIds.length > 0) {
      nextMap[backendAgentId] = normalizedSkillIds;
    } else {
      delete nextMap[backendAgentId];
    }

    this.deps.store.set(QINGSHU_MANAGED_AGENT_EXTRA_SKILL_IDS_KEY, nextMap);
    return this.getManagedAgent(agentId);
  }

  getManagedToolsForAgent(agentId: string): QingShuManagedToolDescriptor[] {
    const backendAgentId = fromManagedAgentId(agentId);
    if (!backendAgentId) {
      return [];
    }
    const agent = this.snapshot.agents.find((item) => item.agentId === backendAgentId);
    if (!agent) {
      return [];
    }
    const toolNames = new Set(agent.toolNames);
    return this.snapshot.tools.filter((tool) => toolNames.has(tool.toolName));
  }

  getManagedToolRuntimeManifest(): QingShuManagedNativeToolManifestEntry[] {
    if (!this.deps.isAuthenticated()) {
      return [];
    }

    return this.snapshot.tools
      .filter((tool) => tool.allowed && !QINGSHU_LOCAL_ONLY_TOOL_NAMES.has(tool.toolName))
      .map((tool) => ({
        server: QingShuManagedToolRuntime.ServerName,
        name: tool.toolName,
        description: `${tool.description} [MCP alias: ${buildManagedToolAlias(tool.toolName)}]`,
        inputSchema: tool.inputSchema ?? {},
      }));
  }

  async invokeManagedMcpTool(
    toolName: string,
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<QingShuManagedMcpToolResult> {
    return this.invokeManagedTool(toolName, args, options);
  }

  private async invokeManagedTool(
    toolName: string,
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<{ content: Array<{ type: string; text?: string }>; isError: boolean }> {
    if (QINGSHU_LOCAL_ONLY_TOOL_NAMES.has(toolName)) {
      const errorMessage = `Tool "${toolName}" must be invoked through QingShuClaw local MCP runtime.`;
      console.warn(`[QingShuManaged] blocked backend invocation for local-only tool "${toolName}"`);
      return {
        content: [{ type: 'text', text: errorMessage }],
        isError: true,
      };
    }

    const toolAlias = buildManagedToolAlias(toolName);
    const backendPath = `/api/qingshu-claw/managed/tools/${encodeURIComponent(toolName)}/invoke`;
    console.log(
      `[QingShuManaged] invoking MCP tool "${toolAlias}" mapped to "${toolName}" with args ${summarizeToolArgs(args)}`,
    );
    try {
      const body = await this.fetchResult<ManagedToolInvokeResponse>(
        backendPath,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          signal: options?.signal,
          body: JSON.stringify({
            arguments: args,
          }),
        },
        {
          timeoutMs: MANAGED_TOOL_TIMEOUT_MS,
        },
      );

      const summaryText = body.summary?.trim()
        || (body.success ? 'Managed tool invocation succeeded' : body.errorMessage?.trim())
        || 'Managed tool invocation finished';
      console.log(
        `[QingShuManaged] MCP tool "${toolAlias}" completed with success=${body.success === true} summary="${clipText(summaryText, 240)}"`,
      );

      return {
        content: [
          {
            type: 'text',
            text: stringifyToolPayload(body.data ?? body.summary ?? body.errorMessage ?? {}),
          },
        ],
        isError: body.success !== true,
      };
    } catch (error) {
      if (isAbortError(error)) {
        const message = `Managed tool invocation timed out after ${Math.floor(MANAGED_TOOL_TIMEOUT_MS / 1000)}s`;
        console.error(
          `[QingShuManaged] MCP tool "${toolAlias}" mapped to "${toolName}" timed out via "${backendPath}":`,
          error,
        );
        return {
          content: [
            {
              type: 'text',
              text: message,
            },
          ],
          isError: true,
        };
      }
      console.error(
        `[QingShuManaged] MCP tool "${toolAlias}" mapped to "${toolName}" failed via "${backendPath}":`,
        error,
      );
      throw error;
    }
  }

  private async fetchResult<T>(
    path: string,
    init?: RequestInit,
    options?: { timeoutMs?: number },
  ): Promise<T> {
    const response = await this.fetchWithAuth(path, init, options);
    const body = await response.json().catch((): QtbResult<T> | null => null);
    if (isQingShuAuthFailure(response, body)) {
      this.notifyAuthSessionInvalidated(`qingshu-managed-auth-failed:${path}`);
    }
    if (!response.ok || !body || body.code !== 200) {
      throw new Error(body?.msg || `QingShu managed request failed: ${response.status}`);
    }
    return body.data as T;
  }

  private async fetchWithAuth(
    path: string,
    init?: RequestInit,
    options?: { timeoutMs?: number },
  ): Promise<Response> {
    const baseUrl = this.deps.resolveApiBaseUrl();
    if (!baseUrl) {
      throw new Error('QTB auth API base URL is not configured');
    }

    const adapter = this.deps.getAuthAdapter();
    const accessToken = await adapter.getAccessToken();
    if (!accessToken) {
      throw new Error('QingShu auth token is not available');
    }

    const timeoutMs = options?.timeoutMs;
    const deadlineAt = typeof timeoutMs === 'number' && timeoutMs > 0
      ? Date.now() + timeoutMs
      : null;

    const execute = async (token: string): Promise<Response> => {
      const controller = new AbortController();
      const upstreamSignal = init?.signal;
      const onAbort = () => controller.abort(
        upstreamSignal instanceof AbortSignal && upstreamSignal.reason
          ? upstreamSignal.reason
          : 'aborted',
      );
      if (upstreamSignal?.aborted) {
        onAbort();
      } else if (upstreamSignal) {
        upstreamSignal.addEventListener('abort', onAbort, { once: true });
      }

      const remainingMs = deadlineAt == null ? null : deadlineAt - Date.now();
      if (remainingMs != null && remainingMs <= 0) {
        if (upstreamSignal) {
          upstreamSignal.removeEventListener('abort', onAbort);
        }
        throw new Error(`Managed tool invocation timed out after ${Math.floor(timeoutMs! / 1000)}s`);
      }

      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      if (remainingMs != null) {
        timeoutId = setTimeout(() => {
          controller.abort(`Managed tool invocation timed out after ${Math.floor(timeoutMs! / 1000)}s`);
        }, remainingMs);
      }

      try {
        return await this.deps.fetchFn(`${baseUrl}${path}`, {
          ...init,
          headers: buildAuthHeaders(token, init?.headers),
          signal: controller.signal,
        });
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (upstreamSignal) {
          upstreamSignal.removeEventListener('abort', onAbort);
        }
      }
    };

    const parseResponseBody = async (response: Response): Promise<QtbResult<unknown> | null> => {
      const cloned = response.clone();
      return await cloned.json().catch((): null => null) as QtbResult<unknown> | null;
    };

    console.debug(`[QingShuManaged] sending authenticated request to "${path}"`);
    let response = await execute(accessToken);
    const responseBody = await parseResponseBody(response);
    if (!isQingShuAuthFailure(response, responseBody)) {
      console.debug(`[QingShuManaged] request to "${path}" returned status=${response.status}`);
      return response;
    }

    console.warn(`[QingShuManaged] request to "${path}" returned an auth failure, attempting token refresh`);
    const refreshed = await adapter.refreshToken();
    if (!refreshed.success || !refreshed.accessToken) {
      console.warn(`[QingShuManaged] token refresh failed for "${path}", keeping original auth failure response`);
      this.notifyAuthSessionInvalidated(`qingshu-managed-refresh-failed:${path}`);
      return response;
    }

    response = await execute(refreshed.accessToken);
    console.debug(`[QingShuManaged] retry request to "${path}" returned status=${response.status}`);
    return response;
  }

  private notifyAuthSessionInvalidated(reason: string): void {
    this.deps.onAuthSessionInvalidated?.(reason);
  }

  private loadPersistedSnapshot(): QingShuManagedCatalogSnapshot {
    const raw = this.deps.store?.get<QingShuManagedCatalogSnapshot>(QINGSHU_MANAGED_CATALOG_SNAPSHOT_KEY);
    if (!raw) {
      return emptySnapshot();
    }

    return {
      catalogVersion: typeof raw.catalogVersion === 'string' ? raw.catalogVersion : '',
      syncedAt: typeof raw.syncedAt === 'number' ? raw.syncedAt : 0,
      agents: Array.isArray(raw.agents) ? raw.agents : [],
      skills: Array.isArray(raw.skills) ? raw.skills : [],
      tools: Array.isArray(raw.tools) ? raw.tools : [],
    };
  }

  private persistSnapshot(): void {
    this.deps.store?.set(QINGSHU_MANAGED_CATALOG_SNAPSHOT_KEY, this.snapshot);
  }
}
