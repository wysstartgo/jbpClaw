export const CoworkIpcChannel = {
  ForkSession: 'cowork:session:fork',
  EditUserMessage: 'cowork:message:editUserMessage',
  EditUserMessageAndRerun: 'cowork:message:editUserMessageAndRerun',
} as const;

export type CoworkIpcChannel = typeof CoworkIpcChannel[keyof typeof CoworkIpcChannel];

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
