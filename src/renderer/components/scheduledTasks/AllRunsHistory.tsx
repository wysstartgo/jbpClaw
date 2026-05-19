import { CheckCircleIcon, ClockIcon, PlayCircleIcon, XCircleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import React, { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import { TaskStatus } from '../../../scheduledTask/constants';
import type { RunFilter, ScheduledTaskRunWithName } from '../../../scheduledTask/types';
import { i18nService } from '../../services/i18n';
import { scheduledTaskService } from '../../services/scheduledTask';
import { RootState } from '../../store';
import RunSessionModal from './RunSessionModal';
import { formatDateTime, formatDuration } from './utils';

const STATUS_OPTIONS = [
  TaskStatus.Success,
  TaskStatus.Error,
  TaskStatus.Skipped,
  TaskStatus.Running,
] as const;

const statusConfig: Record<TaskStatus, { label: string; tone: string; badgeClass: string; icon: React.ReactNode }> = {
  [TaskStatus.Success]: {
    label: 'scheduledTasksStatusSuccess',
    tone: 'text-green-600 dark:text-green-500',
    badgeClass: 'bg-green-50 dark:bg-green-500/10',
    icon: <CheckCircleIcon className="h-5 w-5" />,
  },
  [TaskStatus.Error]: {
    label: 'scheduledTasksStatusError',
    tone: 'text-red-500 dark:text-red-400',
    badgeClass: 'bg-red-50 dark:bg-red-500/10',
    icon: <XCircleIcon className="h-5 w-5" />,
  },
  [TaskStatus.Skipped]: {
    label: 'scheduledTasksStatusSkipped',
    tone: 'text-yellow-600 dark:text-yellow-500',
    badgeClass: 'bg-yellow-50 dark:bg-yellow-500/10',
    icon: <PlayCircleIcon className="h-5 w-5" />,
  },
  [TaskStatus.Running]: {
    label: 'scheduledTasksStatusRunning',
    tone: 'text-primary dark:text-primary-hover',
    badgeClass: 'bg-primary/10 dark:bg-primary/20',
    icon: <ClockIcon className="h-5 w-5 animate-pulse" />,
  },
};

const EMPTY_FILTER: RunFilter = {};

function hasActiveRunFilter(filter: RunFilter): boolean {
  return Boolean(filter.startDate || filter.endDate || filter.status);
}

function applyClientRunFilter(
  runs: ScheduledTaskRunWithName[],
  filter: RunFilter,
): ScheduledTaskRunWithName[] {
  return runs.filter((run) => {
    if (filter.status && run.status !== filter.status) return false;
    if (filter.startDate && run.startedAt < `${filter.startDate}T00:00:00`) return false;
    if (filter.endDate && run.startedAt > `${filter.endDate}T23:59:59`) return false;
    return true;
  });
}

const AllRunsHistory: React.FC = () => {
  const allRuns = useSelector((state: RootState) => state.scheduledTask.allRuns);
  const hasMore = useSelector((state: RootState) => state.scheduledTask.allRunsHasMore);
  const [viewingRun, setViewingRun] = useState<ScheduledTaskRunWithName | null>(null);
  const [filter, setFilter] = useState<RunFilter>(EMPTY_FILTER);
  const isFilterActive = hasActiveRunFilter(filter);

  const displayedRuns = useMemo(
    () => (isFilterActive ? applyClientRunFilter(allRuns, filter) : allRuns),
    [allRuns, filter, isFilterActive],
  );

  useEffect(() => {
    scheduledTaskService.loadAllRuns(50, 0, filter);
    // Initial load only. Filter updates are handled by explicit user actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateFilter = (nextFilter: RunFilter) => {
    setFilter(nextFilter);
    scheduledTaskService.loadAllRuns(50, 0, nextFilter);
  };

  const handleStatusToggle = (status: TaskStatus) => {
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

  const handleLoadMore = () => {
    scheduledTaskService.loadAllRuns(50, allRuns.length, filter);
  };

  const handleViewSession = (run: ScheduledTaskRunWithName) => {
    if (run.sessionId || run.sessionKey) {
      setViewingRun(run);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-surface/70 px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_OPTIONS.map((status) => {
            const cfg = statusConfig[status];
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
        <div className="flex flex-col items-center justify-center py-16 px-6">
          <ClockIcon className="h-12 w-12 text-secondary/40 mb-4" />
          <p className="text-sm font-medium text-secondary">
            {isFilterActive
              ? i18nService.t('scheduledTasksFilterNoResults')
              : i18nService.t('scheduledTasksHistoryEmpty')}
          </p>
        </div>
      )}

      {displayedRuns.map((run) => {
        const cfg = statusConfig[run.status] || {
          label: 'scheduledTasksStatusIdle',
          tone: 'text-secondary',
          badgeClass: 'bg-surface-raised',
          icon: <ClockIcon className="h-5 w-5" />,
        };
        const hasSession = run.sessionId || run.sessionKey;

        return (
          <div
            key={run.id}
            className={`flex items-center justify-between gap-4 py-3 px-4 rounded-xl transition-colors ${
              hasSession
                ? 'cursor-pointer hover:bg-surface-raised'
                : ''
            }`}
            onClick={() => handleViewSession(run)}
          >
            {/* Left Side: Icon + Title + Time */}
            <div className="flex items-center gap-4 min-w-0 flex-1">
              {/* Dynamic Status Icon Container */}
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${cfg.badgeClass} ${cfg.tone}`}>
                {cfg.icon}
              </div>
              
              <div className="min-w-0 flex flex-col justify-center">
                <div className="truncate text-[14px] font-semibold text-foreground">
                  {run.taskName}
                </div>
                <div className="mt-0.5 text-[12px] text-secondary/80">
                  {formatDateTime(new Date(run.startedAt))}
                </div>
              </div>
            </div>

            {/* Right Side: Execution Metric & Result */}
            <div className="flex items-center gap-6 shrink-0 text-right">
              <div className="flex flex-col items-end">
                <div className="text-[14px] text-foreground font-mono">
                  {run.durationMs !== null ? formatDuration(run.durationMs) : '-'}
                </div>
                <div className="mt-0.5 text-[11px] text-secondary/70 uppercase">
                  {i18nService.t('duration') || 'Duration'}
                </div>
              </div>
              <div className="w-20 flex justify-end">
                <span className={`px-2 py-0.5 text-[11px] uppercase tracking-wider font-bold rounded-md ${cfg.tone} ${cfg.badgeClass}`}>
                  {i18nService.t(cfg.label)}
                </span>
              </div>
            </div>
          </div>
        );
      })}

      {hasMore && (
        <button
          type="button"
          onClick={handleLoadMore}
          className="w-full mt-4 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-primary transition-colors hover:bg-surface-raised"
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

export default AllRunsHistory;
