import {
  ArrowPathIcon,
  BoltIcon,
  ClockIcon,
  EllipsisVerticalIcon,
  PlayCircleIcon,
} from '@heroicons/react/24/outline';
import React from 'react';
import { useDispatch, useSelector } from 'react-redux';

import type { ScheduledTask } from '../../../scheduledTask/types';
import { i18nService } from '../../services/i18n';
import { scheduledTaskService } from '../../services/scheduledTask';
import { RootState } from '../../store';
import { selectTask, setViewMode } from '../../store/slices/scheduledTaskSlice';
import { formatDateTime, formatNextRunRelative, formatScheduleLabel, getStatusLabelKey, getStatusTone } from './utils';

interface TaskListItemProps {
  task: ScheduledTask;
  onRequestDelete: (taskId: string, taskName: string) => void;
}

const TaskListItem: React.FC<TaskListItemProps> = ({ task, onRequestDelete }) => {
  const dispatch = useDispatch();
  const [showMenu, setShowMenu] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  const effectiveStatus = task.state.runningAtMs ? 'running' : task.state.lastStatus;
  const isRunning = effectiveStatus === 'running';
  const statusLabel = i18nService.t(getStatusLabelKey(effectiveStatus));
  const statusTone = getStatusTone(effectiveStatus);
  const statusBadgeClass = effectiveStatus === 'running'
    ? 'jbp-visual-status-pill'
    : 'jbp-visual-muted-pill';
  const nextRunRelative = task.enabled ? formatNextRunRelative(task.state.nextRunAtMs) : null;

  return (
    <div
      className="jbp-visual-selectable-card cursor-pointer rounded-2xl p-4 transition-all hover:-translate-y-[1px]"
      onClick={() => dispatch(selectTask(task.id))}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Left Side: Icon & Titles */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            {/* Semantic Icon Container */}
            <div className="jbp-visual-icon-tile relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
              {effectiveStatus === 'running' ? <BoltIcon className="h-5 w-5" /> : <PlayCircleIcon className="h-5 w-5" />}
            </div>
            
            <div className="min-w-0 flex flex-col justify-center">
              <div className="flex items-center gap-2">
                <div className={`truncate text-sm font-semibold ${task.enabled ? 'text-foreground' : 'text-secondary/70 line-through'}`}>
                  {task.name}
                </div>
                {/* Micro Tag for EXEUCTION STATUS */}
                {effectiveStatus !== null && (
                  <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusTone} ${statusBadgeClass}`}>
                    {statusLabel}
                  </span>
                )}
                {effectiveStatus === null && (
                  <span className="jbp-visual-muted-pill rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                    {i18nService.t('scheduledTasksStatusIdle')}
                  </span>
                )}
              </div>

              {/* Data Row (High Density Key-Value) */}
              <div className="mt-1 flex items-center gap-3 text-xs text-secondary/80 truncate">
                <span>
                  {i18nService.t('scheduledTasksListColSchedule')}:&nbsp;
                  <span className="text-secondary">{formatScheduleLabel(task.schedule)}</span>
                </span>
                <span className="text-border/60">|</span>
                <span>
                  {i18nService.t('scheduledTasksHistoryColTime')}:&nbsp;
                  <span className="text-secondary">
                    {task.state.runningAtMs
                      ? formatDateTime(new Date(task.state.runningAtMs))
                      : (
                        task.state.lastRunAtMs
                          ? formatDateTime(new Date(task.state.lastRunAtMs))
                          : '-'
                    )}
                  </span>
                </span>
                {task.enabled && task.state.nextRunAtMs !== null && (
                  <>
                    <span className="text-border/60">|</span>
                    <span>
                      {i18nService.t('scheduledTasksNextRun')}:&nbsp;
                      <span className="text-secondary">
                        {formatDateTime(new Date(task.state.nextRunAtMs))}
                        {nextRunRelative ? ` (${nextRunRelative})` : ''}
                      </span>
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Switch + Menu */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void scheduledTaskService.toggleTask(task.id, !task.enabled);
            }}
            className={`jbp-visual-toggle relative h-5 w-9 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-1 focus:ring-offset-surface ${task.enabled ? 'is-on' : ''}`}
            aria-label={i18nService.t('scheduledTasksFormEnabled')}
          >
            <span
              className={`jbp-visual-toggle-knob absolute left-0.5 top-0.5 h-4 w-4 rounded-full transition-transform ${
                task.enabled ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
          
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setShowMenu((value) => !value);
              }}
              className="rounded-lg p-1.5 text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
              aria-label={i18nService.t('scheduledTasksListColMore')}
            >
              <EllipsisVerticalIcon className="h-5 w-5" />
            </button>
            {showMenu && (
              <div className="jbp-visual-panel absolute right-0 top-full z-50 mt-1 w-36 rounded-xl py-1">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setShowMenu(false);
                    void scheduledTaskService.runManually(task.id);
                  }}
                  disabled={isRunning}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-surface-raised disabled:cursor-wait disabled:opacity-60"
                >
                  {isRunning && <ArrowPathIcon className="h-3.5 w-3.5 animate-spin text-primary" />}
                  <span>{i18nService.t(isRunning ? 'scheduledTasksStatusRunning' : 'scheduledTasksRun')}</span>
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setShowMenu(false);
                    dispatch(selectTask(task.id));
                    dispatch(setViewMode('edit'));
                  }}
                  className="w-full px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-surface-raised"
                >
                  {i18nService.t('scheduledTasksEdit')}
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setShowMenu(false);
                    onRequestDelete(task.id, task.name);
                  }}
                  className="w-full px-3 py-1.5 text-left text-sm text-destructive transition-colors hover:bg-surface-raised"
                >
                  {i18nService.t('scheduledTasksDelete')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

interface TaskListProps {
  onRequestDelete: (taskId: string, taskName: string) => void;
  tasks?: ScheduledTask[];
}

const TaskList: React.FC<TaskListProps> = ({ onRequestDelete, tasks: providedTasks }) => {
  const allTasks = useSelector((state: RootState) => state.scheduledTask.tasks);
  const loading = useSelector((state: RootState) => state.scheduledTask.loading);
  const tasks = providedTasks ?? allTasks;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-secondary">
          {i18nService.t('loading')}
        </div>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16">
        <div className="jbp-visual-icon-tile mb-4 flex h-12 w-12 items-center justify-center rounded-2xl">
          <ClockIcon className="h-6 w-6" />
        </div>
        <p className="text-sm font-medium text-secondary mb-1">
          {i18nService.t('scheduledTasksEmptyState')}
        </p>
        <p className="text-xs text-secondary/70 text-center">
          {i18nService.t('scheduledTasksEmptyHint')}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      {tasks.map((task) => (
        <TaskListItem key={task.id} task={task} onRequestDelete={onRequestDelete} />
      ))}
    </div>
  );
};

export default TaskList;
