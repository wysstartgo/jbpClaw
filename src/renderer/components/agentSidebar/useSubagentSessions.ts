import { useCallback, useEffect, useRef, useState } from 'react';

import type { SubagentSessionSummary } from '../../types/cowork';

const POLL_INTERVAL_MS = 5_000;

export const useSubagentSessions = (
  currentSessionId: string | null,
  currentSessionStatus?: string,
) => {
  const [subagentsBySessionId, setSubagentsBySessionId] = useState<Record<string, SubagentSessionSummary[]>>({});
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSubagents = useCallback(async (sessionId: string) => {
    try {
      const result = await window.electron?.cowork?.listSubagentSessions(sessionId);
      if (!result?.success || !result.runs) return;

      const summaries = result.runs.map((run) => ({
        id: run.id,
        agentId: run.agentId,
        task: run.task,
        label: run.label,
        sessionKey: run.sessionKey,
        parentSessionId: sessionId,
        status: run.status,
        createdAt: run.createdAt,
      }));

      setSubagentsBySessionId((prev) => {
        const existing = prev[sessionId];
        if (existing && JSON.stringify(existing) === JSON.stringify(summaries)) {
          return prev;
        }
        return { ...prev, [sessionId]: summaries };
      });
    } catch {
      // Subagent rows are supplemental; sidebar remains usable if polling fails.
    }
  }, []);

  useEffect(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    if (!currentSessionId) return;

    void fetchSubagents(currentSessionId);

    if (currentSessionStatus === 'running') {
      pollingRef.current = setInterval(() => {
        void fetchSubagents(currentSessionId);
      }, POLL_INTERVAL_MS);
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [currentSessionId, currentSessionStatus, fetchSubagents]);

  return { subagentsBySessionId, refetchSubagents: fetchSubagents };
};
