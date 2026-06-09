export const QingShuObjectSourceType = {
  QingShuManaged: 'qingshu-managed',
  LocalCustom: 'local-custom',
  Preset: 'preset',
} as const;

export type QingShuObjectSourceType =
  typeof QingShuObjectSourceType[keyof typeof QingShuObjectSourceType];

export const QingShuManagedInstaller = {
  QingShuSync: 'qingshu-sync',
} as const;

export type QingShuManagedInstaller =
  typeof QingShuManagedInstaller[keyof typeof QingShuManagedInstaller];

export const QingShuManagedToolRuntime = {
  ServerName: 'qingshu-managed',
} as const;

const OPENCLAW_TOOL_NAME_SEPARATOR = '__';

const sanitizeOpenClawToolFragment = (value: string, fallback: string): string => {
  const sanitized = value.trim().replace(/[^A-Za-z0-9_-]/g, '-');
  return sanitized || fallback;
};

export const buildQingShuManagedToolAlias = (toolName: string): string => {
  const normalizedToolName = toolName.trim();
  if (!normalizedToolName) return '';
  const serverName = sanitizeOpenClawToolFragment(QingShuManagedToolRuntime.ServerName, 'mcp')
    .slice(0, 30);
  const maxToolNameLength = Math.max(
    1,
    64 - serverName.length - OPENCLAW_TOOL_NAME_SEPARATOR.length,
  );
  const safeToolName = sanitizeOpenClawToolFragment(normalizedToolName, 'tool')
    .slice(0, maxToolNameLength);
  return `${serverName}${OPENCLAW_TOOL_NAME_SEPARATOR}${safeToolName}`;
};

export const getQingShuManagedToolAliasPattern = (): string =>
  `${QingShuManagedToolRuntime.ServerName}${OPENCLAW_TOOL_NAME_SEPARATOR}*`;
