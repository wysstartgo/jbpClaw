export type QingShuManagedToolRuntimeContext = {
  agentId?: string;
  sessionId?: string;
  skillIds?: string[];
};

const activeContexts = new Map<string, QingShuManagedToolRuntimeContext>();

const normalizeString = (value?: string | null): string | undefined => {
  const normalized = value?.trim();
  return normalized || undefined;
};

const normalizeSkillIds = (skillIds?: string[]): string[] => (
  Array.from(new Set((skillIds ?? [])
    .map((skillId) => skillId.trim())
    .filter(Boolean)))
);

export const setQingShuManagedToolRuntimeContext = (
  context: QingShuManagedToolRuntimeContext,
): void => {
  const sessionId = normalizeString(context.sessionId);
  if (!sessionId) return;

  activeContexts.set(sessionId, {
    agentId: normalizeString(context.agentId),
    sessionId,
    skillIds: normalizeSkillIds(context.skillIds),
  });
};

export const clearQingShuManagedToolRuntimeContext = (sessionId?: string | null): void => {
  const normalizedSessionId = normalizeString(sessionId);
  if (!normalizedSessionId) return;
  activeContexts.delete(normalizedSessionId);
};

export const getQingShuManagedToolRuntimeContext = (): QingShuManagedToolRuntimeContext | null => {
  const contexts = Array.from(activeContexts.values());
  if (contexts.length === 0) {
    return null;
  }
  if (contexts.length === 1) {
    return contexts[0] ?? null;
  }

  // Native MCP calls do not yet carry the originating session id. In concurrent
  // turns, omit runtime context rather than attributing a call to the wrong skill.
  return null;
};
