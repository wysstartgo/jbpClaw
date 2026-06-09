import type { QingShuManagedToolDescriptor } from '../../shared/qingshuManaged/types';
import { EladminMpSessionService } from './eladminMpSessionService';

type FetchFn = (url: string, options?: RequestInit) => Promise<Response>;

export type EladminMpToolRuntimeDeps = {
  fetchFn: FetchFn;
  sessionService: EladminMpSessionService;
  resolveEladminMpBaseUrl: () => string | null;
};

export type EladminMpToolResult = {
  toolName: string;
  success: boolean;
  summary?: string;
  data?: unknown;
  errorMessage?: string;
};

const normalizeBaseUrl = (value: string | null | undefined): string | null => {
  const normalized = value?.trim().replace(/\/+$/, '');
  return normalized || null;
};

const buildToolPayload = (
  descriptor: QingShuManagedToolDescriptor,
  args: Record<string, unknown>,
): Record<string, unknown> => ({
  operation: descriptor.backendToolName || descriptor.toolName,
  tenantHint: args.tenantHint,
  timeRange: args.timeRange,
  filters: args.filters ?? {},
  dryRun: args.dryRun,
  confirm: args.confirm,
});

export class EladminMpToolRuntime {
  constructor(private readonly deps: EladminMpToolRuntimeDeps) {}

  async invoke(
    descriptor: QingShuManagedToolDescriptor,
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<EladminMpToolResult> {
    if (descriptor.toolType !== 'eladmin-mp-api') {
      throw new Error(`Unsupported eladmin-mp tool type: ${descriptor.toolType}`);
    }
    if (!descriptor.allowed) {
      return {
        toolName: descriptor.toolName,
        success: false,
        summary: 'Managed tool is not allowed by QTB catalog policy',
        errorMessage: descriptor.policyNote || 'permission denied',
      };
    }
    if (descriptor.dangerLevel === 'write' && args.dryRun !== true && args.confirm !== true) {
      return {
        toolName: descriptor.toolName,
        success: false,
        summary: '写工具必须先 dryRun 或显式 confirm=true',
        errorMessage: 'write tool requires dryRun=true or confirm=true',
      };
    }

    return await this.invokeWithToken(descriptor, args, options, false);
  }

  private async invokeWithToken(
    descriptor: QingShuManagedToolDescriptor,
    args: Record<string, unknown>,
    options: { signal?: AbortSignal } | undefined,
    forceRefresh: boolean,
  ): Promise<EladminMpToolResult> {
    const baseUrl = normalizeBaseUrl(this.deps.resolveEladminMpBaseUrl());
    if (!baseUrl) {
      throw new Error('eladmin-mp base URL is not configured');
    }

    const token = await this.deps.sessionService.getToken({ forceRefresh });
    const response = await this.deps.fetchFn(`${baseUrl}/api/qingshu-agent/eladmin-mp/tools/invoke`, {
      method: 'POST',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
      signal: options?.signal,
      body: JSON.stringify(buildToolPayload(descriptor, args)),
    });
    if (response.status === 401 && !forceRefresh) {
      this.deps.sessionService.clear();
      return await this.invokeWithToken(descriptor, args, options, true);
    }
    const body = await response.json().catch((): unknown => null);
    if (!response.ok) {
      const message = typeof body === 'object' && body && 'message' in body
        ? String((body as { message?: unknown }).message)
        : `eladmin-mp tool request failed: ${response.status}`;
      return {
        toolName: descriptor.toolName,
        success: false,
        summary: message,
        errorMessage: message,
        data: body,
      };
    }
    return {
      toolName: descriptor.toolName,
      success: Boolean((body as { success?: unknown } | null)?.success),
      summary: (body as { summary?: string } | null)?.summary,
      data: body,
      errorMessage: (body as { success?: unknown } | null)?.success ? undefined : 'eladmin-mp tool returned success=false',
    };
  }
}
