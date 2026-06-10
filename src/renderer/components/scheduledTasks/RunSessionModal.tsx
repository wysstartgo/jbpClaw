import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { XMarkIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { i18nService } from '../../services/i18n';
import type { CoworkSession, CoworkMessage } from '../../types/cowork';
import {
  buildConversationTurns,
  buildDisplayItems,
} from '../cowork/coworkConversationTurns';
import {
  UserMessageItem,
  AssistantTurnBlock,
} from '../cowork/CoworkSessionDetail';

interface RunSessionModalProps {
  sessionId?: string | null;
  sessionKey?: string | null;
  onClose: () => void;
}

const MAX_RETRIES = 5;
const RETRY_INTERVAL_MS = 3000;
const TRANSCRIPT_RUN_SESSION_KEY_RE = /(?:^|:)run:[0-9a-f-]{36}(?:$|:)/i;

export const getRunSessionLoadOrder = (
  sessionId?: string | null,
  sessionKey?: string | null,
): Array<'sessionKey' | 'sessionId'> => {
  const normalizedSessionId = sessionId?.trim() ?? '';
  const normalizedSessionKey = sessionKey?.trim() ?? '';
  const preferSessionKey = Boolean(
    normalizedSessionKey
    && TRANSCRIPT_RUN_SESSION_KEY_RE.test(normalizedSessionKey)
  );

  const loadOrder: Array<'sessionKey' | 'sessionId'> = [];
  if (preferSessionKey && normalizedSessionKey) {
    loadOrder.push('sessionKey');
  }
  if (normalizedSessionId) {
    loadOrder.push('sessionId');
  }
  if (!preferSessionKey && normalizedSessionKey) {
    loadOrder.push('sessionKey');
  }
  return loadOrder;
};

const RunSessionModal: React.FC<RunSessionModalProps> = ({ sessionId, sessionKey, onClose }) => {
  const [session, setSession] = useState<CoworkSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  const loadSession = useCallback(async (isRetry = false): Promise<boolean> => {
    if (!isRetry) {
      setLoading(true);
      setError(null);
    }

    try {
      let loadedSession: CoworkSession | null = null;
      const loadOrder = getRunSessionLoadOrder(sessionId, sessionKey);

      for (const source of loadOrder) {
        if (source === 'sessionKey' && sessionKey) {
          const result = await window.electron?.scheduledTasks?.resolveSession(sessionKey);
          if (result?.success && result.session) {
            loadedSession = result.session;
            break;
          }
        }

        if (source === 'sessionId' && sessionId) {
          const result = await window.electron?.cowork?.getSession(sessionId);
          if (result?.success && result.session) {
            loadedSession = result.session;
            break;
          }
        }
      }

      if (cancelledRef.current) return false;

      if (loadedSession) {
        setSession(loadedSession);
        setLoading(false);
        setError(null);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [sessionId, sessionKey]);

  useEffect(() => {
    cancelledRef.current = false;

    const run = async () => {
      const success = await loadSession();
      if (cancelledRef.current) return;

      if (!success) {
        // Start polling retries
        setRetryCount(1);
      }
    };

    run();

    return () => {
      cancelledRef.current = true;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [loadSession]);

  // Polling retry effect
  useEffect(() => {
    if (retryCount === 0 || retryCount > MAX_RETRIES || session) return;

    retryTimerRef.current = setTimeout(async () => {
      if (cancelledRef.current) return;
      const success = await loadSession(true);
      if (cancelledRef.current) return;

      if (!success) {
        if (retryCount >= MAX_RETRIES) {
          setLoading(false);
          setError(i18nService.t('scheduledTasksSessionNotSynced'));
        } else {
          setRetryCount(prev => prev + 1);
        }
      }
    }, RETRY_INTERVAL_MS);

    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [retryCount, session, loadSession]);

  const handleManualRetry = async () => {
    setError(null);
    setLoading(true);
    setRetryCount(0);
    const success = await loadSession();
    if (!success) {
      setRetryCount(1);
    }
  };

  const messages: CoworkMessage[] = session?.messages ?? [];
  const displayItems = useMemo(() => buildDisplayItems(messages), [messages]);
  const turns = useMemo(() => buildConversationTurns(displayItems), [displayItems]);

  return (
    <div
      className="jbp-visual-backdrop fixed inset-0 z-[9999] flex items-center justify-center"
      onClick={onClose}
    >
      {/* Modal */}
      <div
        className="jbp-visual-panel relative mx-4 flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-subtle bg-surface/50 px-5 py-3 shrink-0">
          <h3 className="text-sm font-semibold text-foreground truncate">
            {session?.title || i18nService.t('scheduledTasksViewSession')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-secondary hover:bg-surface-raised transition-colors"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <svg className="w-5 h-5 animate-spin text-secondary" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="opacity-75" />
              </svg>
              <span className="text-sm text-secondary">
                {retryCount > 0
                  ? `${i18nService.t('scheduledTasksSessionSyncing')} (${retryCount}/${MAX_RETRIES})`
                  : i18nService.t('loading')}
              </span>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <span className="text-sm text-secondary">{error}</span>
              <button
                type="button"
                onClick={handleManualRetry}
                className="jbp-visual-secondary-action inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors"
              >
                <ArrowPathIcon className="w-3.5 h-3.5" />
                {i18nService.t('scheduledTasksSessionRetry')}
              </button>
            </div>
          )}

          {!loading && !error && turns.length === 0 && (
            <div className="flex items-center justify-center py-16">
              <span className="text-sm text-secondary">
                {i18nService.t('scheduledTasksNoRuns')}
              </span>
            </div>
          )}

          {!loading && !error && turns.length > 0 && (
            <div className="py-2">
              {turns.map((turn) => {
                const showAssistantBlock = turn.assistantItems.length > 0;

                return (
                  <React.Fragment key={turn.id}>
                    {turn.userMessage && (
                      <UserMessageItem message={turn.userMessage} skills={[]} />
                    )}
                    {showAssistantBlock && (
                      <AssistantTurnBlock
                        turn={turn}
                        showTypingIndicator={false}
                        showCopyButtons={true}
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RunSessionModal;
