import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch,useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { scheduledTaskService } from '../../services/scheduledTask';
import { RootState } from '../../store';
import { selectTask,setViewMode } from '../../store/slices/scheduledTaskSlice';
import ComposeIcon from '../icons/ComposeIcon';
import SidebarToggleIcon from '../icons/SidebarToggleIcon';
import WindowTitleBar from '../window/WindowTitleBar';
import AllRunsHistory from './AllRunsHistory';
import DeleteConfirmModal from './DeleteConfirmModal';
import ScheduledTaskTemplatePickerModal from './ScheduledTaskTemplatePickerModal';
import TaskDetail from './TaskDetail';
import TaskForm from './TaskForm';
import TaskList from './TaskList';
import { SCHEDULED_TASK_TEMPLATES, type ScheduledTaskTemplate } from './taskTemplates';

interface ScheduledTasksViewProps {
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  updateBadge?: React.ReactNode;
}

type TabType = 'tasks' | 'history';

const ScheduledTasksView: React.FC<ScheduledTasksViewProps> = ({
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
  updateBadge,
}) => {
  const dispatch = useDispatch();
  const isMac = window.electron.platform === 'darwin';
  const viewMode = useSelector((state: RootState) => state.scheduledTask.viewMode);
  const selectedTaskId = useSelector((state: RootState) => state.scheduledTask.selectedTaskId);
  const tasks = useSelector((state: RootState) => state.scheduledTask.tasks);
  const selectedTask = selectedTaskId ? tasks.find((t) => t.id === selectedTaskId) ?? null : null;
  const [activeTab, setActiveTab] = useState<TabType>('tasks');
  const [deleteTaskInfo, setDeleteTaskInfo] = useState<{ id: string; name: string } | null>(null);
  const isFormDirtyRef = useRef(false);
  const pendingLeaveActionRef = useRef<(() => void) | null>(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<ScheduledTaskTemplate | null>(null);

  const handleFormDirtyChange = useCallback((dirty: boolean) => {
    isFormDirtyRef.current = dirty;
  }, []);

  const handleRequestDelete = useCallback((taskId: string, taskName: string) => {
    setDeleteTaskInfo({ id: taskId, name: taskName });
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTaskInfo) return;
    const taskId = deleteTaskInfo.id;
    setDeleteTaskInfo(null);
    await scheduledTaskService.deleteTask(taskId);
    // If we were viewing this task's detail, go back to list
    if (selectedTaskId === taskId) {
      dispatch(selectTask(null));
      dispatch(setViewMode('list'));
    }
  }, [deleteTaskInfo, selectedTaskId, dispatch]);

  const handleCancelDelete = useCallback(() => {
    setDeleteTaskInfo(null);
  }, []);

  useEffect(() => {
    scheduledTaskService.loadTasks();
  }, []);

  const handleBackToList = () => {
    if ((viewMode === 'create' || viewMode === 'edit') && isFormDirtyRef.current) {
      pendingLeaveActionRef.current = () => {
        isFormDirtyRef.current = false;
        dispatch(selectTask(null));
        dispatch(setViewMode('list'));
      };
      setShowLeaveConfirm(true);
      return;
    }
    dispatch(selectTask(null));
    dispatch(setViewMode('list'));
  };

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    if (tab === 'tasks') {
      dispatch(selectTask(null));
      dispatch(setViewMode('list'));
    }
  };

  const handleCreateBlankTask = () => {
    setSelectedTemplate(null);
    setShowTemplatePicker(false);
    dispatch(setViewMode('create'));
  };

  const handleSelectTemplate = (template: ScheduledTaskTemplate) => {
    setSelectedTemplate(template);
    setShowTemplatePicker(false);
    dispatch(setViewMode('create'));
  };

  // Show tabs only in list view (not in create/edit/detail sub-views)
  const showTabs = viewMode === 'list' && !selectedTaskId;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="draggable flex h-12 items-center justify-between px-4 border-b border-border shrink-0">
        <div className="flex items-center space-x-3 h-8">
          {isSidebarCollapsed && (
            <div className={`non-draggable flex items-center gap-1 ${isMac ? 'pl-[68px]' : ''}`}>
              <button
                type="button"
                onClick={onToggleSidebar}
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-secondary hover:bg-surface-raised transition-colors"
              >
                <SidebarToggleIcon className="h-4 w-4" isCollapsed={true} />
              </button>
              <button
                type="button"
                onClick={onNewChat}
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-secondary hover:bg-surface-raised transition-colors"
              >
                <ComposeIcon className="h-4 w-4" />
              </button>
              {updateBadge}
            </div>
          )}
          {viewMode !== 'list' && (
            <button
              onClick={handleBackToList}
              className="non-draggable p-2 rounded-lg hover:bg-surface-raised text-secondary transition-colors"
              aria-label={i18nService.t('back')}
            >
              <ArrowLeftIcon className="h-5 w-5" />
            </button>
          )}
          <h1 className="text-lg font-semibold text-foreground">
            {i18nService.t('scheduledTasksTitle')}
          </h1>
        </div>
        <WindowTitleBar inline />
      </div>

      {/* Tabs + New Task button */}
      {showTabs && (
        <div className="flex items-center justify-between border-b border-border px-4 shrink-0">
          <div className="flex">
            <button
              type="button"
              onClick={() => handleTabChange('tasks')}
              className={`px-4 py-3 text-sm font-medium transition-colors relative ${
                activeTab === 'tasks'
                  ? 'text-foreground font-bold'
                  : 'text-secondary hover:text-foreground'
              }`}
            >
              {i18nService.t('scheduledTasksTabTasks')}
              {activeTab === 'tasks' && (
                <span className="absolute bottom-0 left-3 right-3 h-[3px] bg-primary rounded-t-sm" />
              )}
            </button>
            <button
              type="button"
              onClick={() => handleTabChange('history')}
              className={`px-4 py-3 text-sm font-medium transition-colors relative ${
                activeTab === 'history'
                  ? 'text-foreground font-bold'
                  : 'text-secondary hover:text-foreground'
              }`}
            >
              {i18nService.t('scheduledTasksTabHistory')}
              {activeTab === 'history' && (
                <span className="absolute bottom-0 left-3 right-3 h-[3px] bg-primary rounded-t-sm" />
              )}
            </button>
          </div>
          {activeTab === 'tasks' && (
            <button
              type="button"
              onClick={() => setShowTemplatePicker(true)}
              className="px-4 py-1.5 text-sm font-semibold bg-primary text-white rounded-[10px] hover:bg-primary-hover transition-colors shadow-sm"
            >
              {i18nService.t('scheduledTasksNewTask')}
            </button>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {showTabs && activeTab === 'history' ? (
          <AllRunsHistory />
        ) : (
          <>
            {viewMode === 'list' && <TaskList onRequestDelete={handleRequestDelete} />}
            {viewMode === 'create' && (
              <TaskForm
                mode="create"
                initialTemplate={selectedTemplate}
                onCancel={handleBackToList}
                onSaved={(newTaskId) => {
                  setSelectedTemplate(null);
                  if (newTaskId) {
                    dispatch(selectTask(newTaskId));
                    dispatch(setViewMode('detail'));
                  } else {
                    handleBackToList();
                  }
                }}
                onDirtyChange={handleFormDirtyChange}
              />
            )}
            {viewMode === 'edit' && selectedTask && (
              <TaskForm
                mode="edit"
                task={selectedTask}
                onCancel={() => dispatch(setViewMode('detail'))}
                onSaved={() => dispatch(setViewMode('detail'))}
                onDirtyChange={handleFormDirtyChange}
              />
            )}
            {viewMode === 'detail' && selectedTask && (
              <TaskDetail task={selectedTask} onRequestDelete={handleRequestDelete} />
            )}
          </>
        )}
      </div>

      {/* Delete confirmation modal */}
      {deleteTaskInfo && (
        <DeleteConfirmModal
          taskName={deleteTaskInfo.name}
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
        />
      )}

      {showTemplatePicker && (
        <ScheduledTaskTemplatePickerModal
          templates={SCHEDULED_TASK_TEMPLATES}
          onClose={() => setShowTemplatePicker(false)}
          onNew={handleCreateBlankTask}
          onSelect={handleSelectTemplate}
        />
      )}

      {showLeaveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35">
          <div
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-background border border-border shadow-modal p-5"
          >
            <h4 className="text-sm font-semibold text-foreground mb-2">
              {i18nService.t('taskFormUnsavedChanges')}
            </h4>
            <p className="text-sm text-secondary mb-4">
              {i18nService.t('taskFormLeaveConfirm')}
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowLeaveConfirm(false)}
                className="px-4 py-2 text-sm rounded-lg text-secondary hover:bg-surface-raised transition-colors border border-border"
              >
                {i18nService.t('taskFormStay')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowLeaveConfirm(false);
                  pendingLeaveActionRef.current?.();
                  pendingLeaveActionRef.current = null;
                }}
                className="px-4 py-2 text-sm font-medium bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                {i18nService.t('taskFormLeave')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScheduledTasksView;
