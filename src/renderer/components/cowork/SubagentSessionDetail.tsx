import { ArrowLeftIcon, TrashIcon } from '@heroicons/react/20/solid';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { i18nService } from '../../services/i18n';
import type { CoworkMessage, SubagentSessionSummary } from '../../types/cowork';
import ComposeIcon from '../icons/ComposeIcon';
import SidebarToggleIcon from '../icons/SidebarToggleIcon';
import ConversationTurnsView from './ConversationTurnsView';

interface SubagentSessionDetailProps {
  subagent: SubagentSessionSummary;
  onBack: () => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  updateBadge?: React.ReactNode;
}

const SubagentSessionDetail: React.FC<SubagentSessionDetailProps> = ({
  subagent,
  onBack,
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
  updateBadge,
}) => {
  const isMac = window.electron.platform === 'darwin';
  const [messages, setMessages] = useState<CoworkMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'running' | 'done' | 'error'>(subagent.status);
  const [deleting, setDeleting] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(0);

  useEffect(() => {
    if (messages.length > prevMessageCountRef.current && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
    prevMessageCountRef.current = messages.length;
  }, [messages]);

  const fetchHistory = useCallback(async () => {
    try {
      const result = await window.electron?.cowork?.getSubTaskHistory({
        parentSessionId: subagent.parentSessionId,
        agentId: subagent.agentId ?? subagent.id,
        sessionKey: subagent.sessionKey ?? undefined,
      });
      if (result?.success && result.messages) {
        setMessages(result.messages);
      }
    } catch {
      // 子任务详情是辅助视图，读取失败时保持当前内容。
    } finally {
      setLoading(false);
    }
  }, [subagent.agentId, subagent.id, subagent.parentSessionId, subagent.sessionKey]);

  const fetchStatus = useCallback(async () => {
    try {
      const result = await window.electron?.cowork?.listSubagentSessions(subagent.parentSessionId);
      const run = result?.runs?.find((item) => item.id === subagent.id);
      if (run?.status) {
        setStatus(run.status);
      }
    } catch {
      // 状态轮询失败不影响已加载的子任务对话展示。
    }
  }, [subagent.id, subagent.parentSessionId]);

  useEffect(() => {
    void fetchHistory();
    void fetchStatus();

    if (status !== 'running') return undefined;
    const timer = window.setInterval(() => {
      void fetchHistory();
      void fetchStatus();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [fetchHistory, fetchStatus, status]);

  const effectiveMessages = useMemo(() => {
    if (messages.length > 0) return messages;
    if (!subagent.task) return messages;
    return [{
      id: 'synthetic-task',
      type: 'user' as const,
      content: subagent.task,
      timestamp: subagent.createdAt,
    }];
  }, [messages, subagent.createdAt, subagent.task]);
  const displayTitle = subagent.agentId ?? subagent.label ?? i18nService.t('subagentUnnamed');

  const handleDelete = useCallback(async () => {
    if (deleting) return;
    const confirmed = window.confirm(i18nService.t('subagentDeleteConfirm'));
    if (!confirmed) return;

    setDeleting(true);
    try {
      const result = await window.electron?.cowork?.deleteSubagentSession({
        parentSessionId: subagent.parentSessionId,
        runId: subagent.id,
      });
      if (result?.success) {
        onBack();
      } else {
        window.alert(result?.error || i18nService.t('subagentDeleteFailed'));
      }
    } catch {
      window.alert(i18nService.t('subagentDeleteFailed'));
    } finally {
      setDeleting(false);
    }
  }, [deleting, onBack, subagent.id, subagent.parentSessionId]);

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="draggable flex h-12 shrink-0 items-center gap-3 border-b border-border bg-background px-4">
        <div className="non-draggable flex items-center gap-2">
          {isSidebarCollapsed && (
            <div className={`mr-1 flex items-center gap-1 ${isMac ? 'pl-[68px]' : ''}`}>
              <button
                type="button"
                onClick={onToggleSidebar}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-surface-raised"
              >
                <SidebarToggleIcon className="h-4 w-4" isCollapsed />
              </button>
              <button
                type="button"
                onClick={onNewChat}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-surface-raised"
              >
                <ComposeIcon className="h-4 w-4" />
              </button>
              {updateBadge}
            </div>
          )}
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-foreground/60 transition-colors hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.05]"
            aria-label={i18nService.t('back')}
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              status === 'done'
                ? 'bg-green-500'
                : status === 'error'
                  ? 'bg-red-500'
                  : 'animate-pulse bg-blue-500'
            }`}
          />
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {displayTitle}
          </span>
        </div>

        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
          status === 'done'
            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
            : status === 'error'
              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
              : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
        }`}>
          {status === 'done'
            ? i18nService.t('subagentCompleted')
            : status === 'error'
              ? i18nService.t('subagentError')
              : i18nService.t('subagentWorking')}
        </span>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="non-draggable inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-foreground/45 transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={i18nService.t('subagentDelete')}
          title={i18nService.t('subagentDelete')}
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>

      <div ref={contentRef} className="flex-1 overflow-y-auto px-3 pb-[120px] pt-3">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            <span className="ml-3 text-sm text-secondary">
              {i18nService.t('loading')}
            </span>
          </div>
        ) : (
          <ConversationTurnsView
            messages={effectiveMessages}
            isStreaming={status === 'running'}
            readOnly
          />
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border bg-surface px-4 py-2">
        <span className="text-xs text-secondary">
          {messages.length > 0 ? `${messages.length} ${i18nService.t('subTaskMessages')}` : ''}
        </span>
        {subagent.label && (
          <span className="text-xs font-medium text-blue-500/70">
            {subagent.label}
          </span>
        )}
      </div>
    </div>
  );
};

export default SubagentSessionDetail;
