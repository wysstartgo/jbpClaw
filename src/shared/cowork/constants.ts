export const CoworkIpcChannel = {
  MediaStatusPollUpdate: 'cowork:media:statusPollUpdate',
  ForkSession: 'cowork:session:fork',
  EditUserMessage: 'cowork:message:editUserMessage',
  EditUserMessageAndRerun: 'cowork:message:editUserMessageAndRerun',
  SubTaskHistory: 'cowork:subTask:history',
  SubagentList: 'cowork:subagent:list',
  SubagentDelete: 'cowork:subagent:delete',
} as const;

export type CoworkIpcChannel = typeof CoworkIpcChannel[keyof typeof CoworkIpcChannel];

export const CoworkForkMode = {
  None: 'none',
  Conversation: 'conversation',
  Worktree: 'worktree',
} as const;
export type CoworkForkMode = typeof CoworkForkMode[keyof typeof CoworkForkMode];

export const CoworkContextUsageSource = {
  Live: 'live',
  Cache: 'cache',
  Unavailable: 'unavailable',
} as const;
export type CoworkContextUsageSource =
  typeof CoworkContextUsageSource[keyof typeof CoworkContextUsageSource];

export const CoworkContextUsageFailureReason = {
  Timeout: 'timeout',
  GatewayError: 'gateway_error',
} as const;
export type CoworkContextUsageFailureReason =
  typeof CoworkContextUsageFailureReason[keyof typeof CoworkContextUsageFailureReason];

export const CoworkContextUsageRefreshMode = {
  Auto: 'auto',
  Manual: 'manual',
  PostRun: 'postRun',
} as const;
export type CoworkContextUsageRefreshMode =
  typeof CoworkContextUsageRefreshMode[keyof typeof CoworkContextUsageRefreshMode];

export const DEFAULT_TOOL_RESULT_MAX_CHARS = 300_000;
export const MIN_TOOL_RESULT_MAX_CHARS = 30_000;
export const MAX_TOOL_RESULT_MAX_CHARS = 500_000;

export function normalizeToolResultMaxChars(value: unknown, fallback = DEFAULT_TOOL_RESULT_MAX_CHARS): number {
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : Number.NaN;

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.max(
    MIN_TOOL_RESULT_MAX_CHARS,
    Math.min(MAX_TOOL_RESULT_MAX_CHARS, Math.floor(numericValue))
  );
}
