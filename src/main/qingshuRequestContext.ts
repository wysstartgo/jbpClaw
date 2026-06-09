import type { QingShuManagedToolRuntimeContext } from './qingshuManaged/toolRuntimeContext';

export const QINGSHU_CONTEXT_HEADERS = {
  TraceId: 'traceId',
  RequestId: 'x-qingshu-request-id',
  DeviceId: 'x-qingshu-device-id',
  ClientIp: 'x-qingshu-client-ip',
  AgentId: 'x-qingshu-agent-id',
  SessionId: 'x-qingshu-session-id',
  SkillId: 'x-qingshu-skill-id',
  SkillIds: 'x-qingshu-skill-ids',
  ClientUserId: 'x-qingshu-client-user-id',
} as const;

export type QingShuClientRequestContext = {
  requestId?: string | null;
  traceId?: string | null;
  deviceId?: string | null;
  clientIp?: string | null;
  agentId?: string | null;
  sessionId?: string | null;
  skillIds?: string[] | null;
  clientUserId?: string | null;
};

export const createQingShuRequestId = (prefix = 'qingshu_client'): string =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export const normalizeQingShuContextValue = (value?: string | null): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

export const normalizeQingShuSkillIds = (skillIds?: string[] | null): string[] => (
  Array.from(new Set((skillIds ?? [])
    .map((skillId) => skillId.trim())
    .filter(Boolean)))
);

export const buildQingShuClientRequestContext = (
  input: Omit<QingShuClientRequestContext, 'agentId' | 'sessionId' | 'skillIds'> & {
    runtimeContext?: QingShuManagedToolRuntimeContext | null;
    agentId?: string | null;
    sessionId?: string | null;
    skillIds?: string[] | null;
  },
): QingShuClientRequestContext => {
  const requestId = normalizeQingShuContextValue(input.requestId) || createQingShuRequestId();
  const explicitSkillIds = normalizeQingShuSkillIds(input.skillIds);
  const runtimeSkillIds = normalizeQingShuSkillIds(input.runtimeContext?.skillIds);
  return {
    requestId,
    traceId: normalizeQingShuContextValue(input.traceId) || requestId,
    deviceId: normalizeQingShuContextValue(input.deviceId),
    clientIp: normalizeQingShuContextValue(input.clientIp),
    agentId: normalizeQingShuContextValue(input.agentId) || normalizeQingShuContextValue(input.runtimeContext?.agentId),
    sessionId: normalizeQingShuContextValue(input.sessionId) || normalizeQingShuContextValue(input.runtimeContext?.sessionId),
    skillIds: explicitSkillIds.length > 0 ? explicitSkillIds : runtimeSkillIds,
    clientUserId: normalizeQingShuContextValue(input.clientUserId),
  };
};

export const appendQingShuContextHeaders = (
  headers: Headers,
  context: QingShuClientRequestContext,
): Headers => {
  const requestId = normalizeQingShuContextValue(context.requestId);
  const traceId = normalizeQingShuContextValue(context.traceId) || requestId;
  const skillIds = normalizeQingShuSkillIds(context.skillIds);

  if (traceId) headers.set(QINGSHU_CONTEXT_HEADERS.TraceId, traceId);
  if (requestId) headers.set(QINGSHU_CONTEXT_HEADERS.RequestId, requestId);
  if (context.deviceId) headers.set(QINGSHU_CONTEXT_HEADERS.DeviceId, context.deviceId);
  if (context.clientIp) headers.set(QINGSHU_CONTEXT_HEADERS.ClientIp, context.clientIp);
  if (context.agentId) headers.set(QINGSHU_CONTEXT_HEADERS.AgentId, context.agentId);
  if (context.sessionId) headers.set(QINGSHU_CONTEXT_HEADERS.SessionId, context.sessionId);
  if (skillIds.length > 0) {
    headers.set(QINGSHU_CONTEXT_HEADERS.SkillId, skillIds[0]);
    headers.set(QINGSHU_CONTEXT_HEADERS.SkillIds, skillIds.join(','));
  }
  if (context.clientUserId) {
    headers.set(QINGSHU_CONTEXT_HEADERS.ClientUserId, context.clientUserId);
  }
  return headers;
};

export const buildQingShuContextHeaders = (
  context: QingShuClientRequestContext,
  headers?: HeadersInit,
): Headers => appendQingShuContextHeaders(new Headers(headers), context);

export const buildQingShuContextHeaderRecord = (
  context: QingShuClientRequestContext,
  headers: Record<string, string> = {},
): Record<string, string> => {
  const result = buildQingShuContextHeaders(context, headers);
  const record: Record<string, string> = {};
  result.forEach((value, key) => {
    record[key] = value;
  });
  return record;
};
