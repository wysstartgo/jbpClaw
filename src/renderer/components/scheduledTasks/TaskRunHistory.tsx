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
  success: { icon: '✓', color: 'text-success' },
  error: { icon: '✗', color: 'text-destructive' },
  skipped: { icon: '↷', color: 'text-warning' },
  running: { icon: '●', color: 'text-primary' },
};

const STATUS_OPTIONS = ['success', 'error', 'skipped', 'running'] as const;

const statusFilterConfig: Record<string, { label: string; tone: string; badgeClass: string }> = {
  success: {
    label: 'scheduledTasksStatusSuccess',
    tone: 'text-success',
    badgeClass: 'jbp-visual-success-pill',
  },
  error: {
    label: 'scheduledTasksStatusError',
    tone: 'text-destructive',
    badgeClass: 'jbp-visual-danger-note',
  },
  skipped: {
    label: 'scheduledTasksStatusSkipped',
    tone: 'text-warning',
    badgeClass: 'jbp-visual-warning-note',
  },
  running: {
    label: 'scheduledTasksStatusRunning',
    tone: 'text-primary',
    badgeClass: 'jbp-visual-status-pill',
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
      <div className="jbp-visual-soft-card mb-3 flex flex-wrap items-center gap-2 rounded-xl px-3 py-2">
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
                    : 'jbp-visual-muted-pill hover:text-foreground'
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
              className="jbp-visual-soft-field h-7 rounded-md px-2 text-xs outline-none"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-secondary">
            <span>{i18nService.t('scheduledTasksFilterEndDate')}</span>
            <input
              type="date"
              value={filter.endDate ?? ''}
              min={filter.startDate}
              onChange={(event) => handleEndDateChange(event.target.value)}
              className="jbp-visual-soft-field h-7 rounded-md px-2 text-xs outline-none"
            />
          </label>
          {isFilterActive && (
            <button
              type="button"
              onClick={handleClearFilter}
              className="jbp-visual-secondary-action inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs transition-colors"
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
      <div className="space-y-1">
        {displayedRuns.map((run) => {
          const statusInfo = statusIcons[run.status] || { icon: '?', color: '' };
          return (
            <div key={run.id} className="jbp-visual-selectable-card flex items-center justify-between rounded-xl px-3 py-2.5">
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
                    className="max-w-[150px] truncate text-xs text-destructive"
                    title={run.error}
                  >
                    {run.error}
                  </span>
                )}
                {(run.sessionId || run.sessionKey) && (
                  <button
                    type="button"
                    onClick={() => setViewingRun(run)}
                    className="jbp-visual-secondary-action rounded-lg px-2 py-1 text-xs transition-colors"
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
          className="jbp-visual-secondary-action mt-2 w-full rounded-xl py-2 text-sm transition-colors"
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
