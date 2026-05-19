import { XMarkIcon } from '@heroicons/react/24/outline';
import React, { useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import { scheduledTaskService } from '../../services/scheduledTask';
import { i18nService } from '../../services/i18n';
import type { RunFilter, ScheduledTaskRun } from '../../../scheduledTask/types';
import RunSessionModal from './RunSessionModal';
import { formatDateTime, formatDuration } from './utils';

interface TaskRunHistoryProps {
  taskId: string;
  runs: ScheduledTaskRun[];
}

const statusIcons: Record<string, { icon: string; color: string }> = {
  success: { icon: '✓', color: 'text-green-500' },
  error: { icon: '✗', color: 'text-red-500' },
  skipped: { icon: '↷', color: 'text-yellow-500' },
  running: { icon: '●', color: 'text-blue-500' },
};

const STATUS_OPTIONS = ['success', 'error', 'skipped', 'running'] as const;

const statusFilterConfig: Record<string, { label: string; tone: string; badgeClass: string }> = {
  success: {
    label: 'scheduledTasksStatusSuccess',
    tone: 'text-green-600 dark:text-green-500',
    badgeClass: 'bg-green-50 dark:bg-green-500/10',
  },
  error: {
    label: 'scheduledTasksStatusError',
    tone: 'text-red-500 dark:text-red-400',
    badgeClass: 'bg-red-50 dark:bg-red-500/10',
  },
  skipped: {
    label: 'scheduledTasksStatusSkipped',
    tone: 'text-yellow-600 dark:text-yellow-500',
    badgeClass: 'bg-yellow-50 dark:bg-yellow-500/10',
  },
  running: {
    label: 'scheduledTasksStatusRunning',
    tone: 'text-primary dark:text-primary-hover',
    badgeClass: 'bg-primary/10 dark:bg-primary/20',
  },
};

const EMPTY_FILTER: RunFilter = {};

function hasActiveRunFilter(filter: RunFilter): boolean {
  return Boolean(filter.startDate || filter.endDate || filter.status);
}

function applyClientRunFilter(runs: ScheduledTaskRun[], filter: RunFilter): ScheduledTaskRun[] {
  return runs.filter((run) => {
    if (filter.status && run.status !== filter.status) return false;
    if (filter.startDate && run.startedAt < `${filter.startDate}T00:00:00`) return false;
    if (filter.endDate && run.startedAt > `${filter.endDate}T23:59:59`) return false;
    return true;
  });
}

const TaskRunHistory: React.FC<TaskRunHistoryProps> = ({ taskId, runs }) => {
  const hasMore = useSelector((state: RootState) => state.scheduledTask.runsHasMore[taskId] ?? false);
  const [viewingRun, setViewingRun] = useState<ScheduledTaskRun | null>(null);
  const [filter, setFilter] = useState<RunFilter>(EMPTY_FILTER);
  const isFilterActive = hasActiveRunFilter(filter);

  const displayedRuns = useMemo(
    () => (isFilterActive ? applyClientRunFilter(runs, filter) : runs),
    [runs, filter, isFilterActive],
  );

  const updateFilter = (nextFilter: RunFilter) => {
    setFilter(nextFilter);
    void scheduledTaskService.loadRuns(taskId, 50, 0, nextFilter);
  };

  const handleStatusToggle = (status: string) => {
    updateFilter({
      ...filter,
      status: filter.status === status ? undefined : status,
    });
  };

  const handleStartDateChange = (value: string) => {
    updateFilter({
      ...filter,
      startDate: value || undefined,
    });
  };

  const handleEndDateChange = (value: string) => {
    updateFilter({
      ...filter,
      endDate: value || undefined,
    });
  };

  const handleClearFilter = () => {
    updateFilter(EMPTY_FILTER);
  };

  const handleLoadMore = async () => {
    await scheduledTaskService.loadRuns(taskId, 50, runs.length, filter);
  };

  if (runs.length === 0 && !isFilterActive) {
    return (
      <div className="text-center py-6 text-sm text-secondary">
        {i18nService.t('scheduledTasksNoRuns')}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-surface/70 px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_OPTIONS.map((status) => {
            const cfg = statusFilterConfig[status];
            const selected = filter.status === status;
            return (
              <button
                key={status}
                type="button"
                onClick={() => handleStatusToggle(status)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  selected
                    ? `${cfg.badgeClass} ${cfg.tone}`
                    : 'text-secondary hover:bg-surface-raised hover:text-foreground'
                }`}
              >
                {i18nService.t(cfg.label)}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-secondary">
            <span>{i18nService.t('scheduledTasksFilterStartDate')}</span>
            <input
              type="date"
              value={filter.startDate ?? ''}
              max={filter.endDate}
              onChange={(event) => handleStartDateChange(event.target.value)}
              className="h-7 rounded-md border border-border bg-surface px-2 text-xs text-foreground outline-none focus:border-primary"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-secondary">
            <span>{i18nService.t('scheduledTasksFilterEndDate')}</span>
            <input
              type="date"
              value={filter.endDate ?? ''}
              min={filter.startDate}
              onChange={(event) => handleEndDateChange(event.target.value)}
              className="h-7 rounded-md border border-border bg-surface px-2 text-xs text-foreground outline-none focus:border-primary"
            />
          </label>
          {isFilterActive && (
            <button
              type="button"
              onClick={handleClearFilter}
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
              title={i18nService.t('scheduledTasksFilterClear')}
            >
              <XMarkIcon className="h-3.5 w-3.5" />
              {i18nService.t('scheduledTasksFilterClear')}
            </button>
          )}
        </div>
      </div>
      {displayedRuns.length === 0 && (
        <div className="text-center py-6 text-sm text-secondary">
          {i18nService.t('scheduledTasksFilterNoResults')}
        </div>
      )}
      <div className="divide-y divide-border/50">
        {displayedRuns.map((run) => {
          const statusInfo = statusIcons[run.status] || { icon: '?', color: '' };
          return (
            <div key={run.id} className="flex items-center justify-between py-2.5 px-1">
              <div className="flex items-center gap-3 min-w-0">
                <span className={`text-sm font-bold ${statusInfo.color}`}>{statusInfo.icon}</span>
                <div className="min-w-0">
                  <span className="text-sm text-foreground">
                    {formatDateTime(new Date(run.startedAt))}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0 ml-2">
                {run.durationMs !== null && (
                  <span className="text-xs text-secondary">
                    {formatDuration(run.durationMs)}
                  </span>
                )}
                {run.status === 'error' && run.error && (
                  <span
                    className="text-xs text-red-500 max-w-[150px] truncate"
                    title={run.error}
                  >
                    {run.error}
                  </span>
                )}
                {(run.sessionId || run.sessionKey) && (
                  <button
                    type="button"
                    onClick={() => setViewingRun(run)}
                    className="text-xs text-primary hover:text-primary-hover transition-colors"
                  >
                    {i18nService.t('scheduledTasksViewSession')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {hasMore && (
        <button
          type="button"
          onClick={handleLoadMore}
          className="w-full py-2 mt-2 text-sm text-primary hover:text-primary-hover transition-colors"
        >
          {i18nService.t('scheduledTasksLoadMore')}
        </button>
      )}
      {viewingRun && (
        <RunSessionModal
          sessionId={viewingRun.sessionId}
          sessionKey={viewingRun.sessionKey}
          onClose={() => setViewingRun(null)}
        />
      )}
    </div>
  );
};

export default TaskRunHistory;
