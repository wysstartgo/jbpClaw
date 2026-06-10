import {
  BellAlertIcon,
  BriefcaseIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  CodeBracketSquareIcon,
  NewspaperIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import React from 'react';

import { i18nService } from '../../services/i18n';
import Modal from '../common/Modal';
import { type ScheduledTaskTemplate, ScheduledTaskTemplateIcon } from './taskTemplates';

const templateIconComponents: Record<
  ScheduledTaskTemplateIcon,
  React.ElementType<{ className?: string }>
> = {
  [ScheduledTaskTemplateIcon.Newspaper]: NewspaperIcon,
  [ScheduledTaskTemplateIcon.Briefcase]: BriefcaseIcon,
  [ScheduledTaskTemplateIcon.Calendar]: CalendarDaysIcon,
  [ScheduledTaskTemplateIcon.Report]: ChartBarIcon,
  [ScheduledTaskTemplateIcon.Code]: CodeBracketSquareIcon,
  [ScheduledTaskTemplateIcon.Reminder]: BellAlertIcon,
};

interface ScheduledTaskTemplatePickerModalProps {
  templates: readonly ScheduledTaskTemplate[];
  onClose: () => void;
  onNew: () => void;
  onSelect: (template: ScheduledTaskTemplate) => void;
}

const ScheduledTaskTemplatePickerModal: React.FC<ScheduledTaskTemplatePickerModalProps> = ({
  templates,
  onClose,
  onNew,
  onSelect,
}) => {
  return (
    <Modal
      isOpen
      onClose={onClose}
      overlayClassName="jbp-visual-backdrop fixed inset-0 z-[60] flex items-center justify-center"
      className="jbp-visual-panel flex max-h-[82vh] w-[calc(100vw-56px)] max-w-[820px] flex-col overflow-hidden rounded-2xl"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">
            {i18nService.t('scheduledTasksTemplateTitle')}
          </h2>
          <p className="mt-0.5 truncate text-sm text-secondary">
            {i18nService.t('scheduledTasksTemplateSubtitle')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onNew}
            className="jbp-visual-secondary-action h-8 rounded-xl px-3 text-sm font-medium transition-colors"
          >
            {i18nService.t('scheduledTasksTemplateNew')}
          </button>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-surface-raised transition-colors">
            <XMarkIcon className="h-5 w-5 text-secondary" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        {templates.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-secondary">
            {i18nService.t('scheduledTasksTemplateEmpty')}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {templates.map((template) => {
              const Icon = templateIconComponents[template.icon];
              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => onSelect(template)}
                  className="jbp-visual-selectable-card group flex min-h-[156px] flex-col items-start rounded-xl p-4 text-left transition-colors"
                >
                  <div className="flex w-full items-start gap-3">
                    <div className="jbp-visual-icon-tile flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-foreground">
                        {i18nService.t(template.titleKey)}
                      </div>
                      <div className="mt-1 truncate text-xs text-secondary">
                        {i18nService.t(template.scheduleLabelKey)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 text-sm leading-6 text-foreground/85 line-clamp-3">
                    {i18nService.t(template.descriptionKey)}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ScheduledTaskTemplatePickerModal;
