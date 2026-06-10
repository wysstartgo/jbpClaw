import React from 'react';
import { i18nService } from '../../services/i18n';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';

interface DeleteConfirmModalProps {
  taskName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  taskName,
  onConfirm,
  onCancel,
}) => {
  return (
    <div
      className="jbp-visual-backdrop fixed inset-0 z-[9999] flex items-center justify-center"
      onClick={onCancel}
    >
      {/* Modal */}
      <div
        className="jbp-visual-panel relative w-80 rounded-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center text-center">
          <div className="jbp-visual-danger-note mb-3 flex h-10 w-10 items-center justify-center rounded-2xl">
            <ExclamationTriangleIcon className="h-5 w-5" />
          </div>
          <h3 className="text-sm font-semibold text-foreground mb-2">
            {i18nService.t('scheduledTasksDelete')}
          </h3>
          <p className="text-sm text-secondary mb-5">
            {i18nService.t('scheduledTasksDeleteConfirm').replace('{name}', taskName)}
          </p>
          <div className="flex items-center gap-3 w-full">
            <button
              type="button"
              onClick={onCancel}
              className="jbp-visual-secondary-action flex-1 rounded-xl px-4 py-2 text-sm transition-colors"
            >
              {i18nService.t('cancel')}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="jbp-visual-danger-action flex-1 rounded-xl px-4 py-2 text-sm transition-colors"
            >
              {i18nService.t('scheduledTasksDelete')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeleteConfirmModal;
