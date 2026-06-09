import {
  ChatBubbleLeftRightIcon,
  ClockIcon,
  Cog6ToothIcon,
  PuzzlePieceIcon,
  Squares2X2Icon,
} from '@heroicons/react/24/outline';
import React from 'react';

import { i18nService } from '../../services/i18n';
import QingShuBrandMark from '../branding/QingShuBrandMark';
import SidebarKitsIcon from '../icons/SidebarKitsIcon';
import LoginButton from '../LoginButton';

export const WorkbenchMainViewId = {
  Cowork: 'cowork',
  ScheduledTasks: 'scheduledTasks',
  Skills: 'skills',
  Kits: 'kits',
  Applications: 'applications',
} as const;
export type WorkbenchMainView = typeof WorkbenchMainViewId[keyof typeof WorkbenchMainViewId];

interface PrimarySidebarProps {
  activeView: WorkbenchMainView;
  onSelectView: (view: WorkbenchMainView) => void;
  onOpenSettings: () => void;
}

type NavItem = {
  id: WorkbenchMainView;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const NAV_ITEMS: NavItem[] = [
  { id: WorkbenchMainViewId.Cowork, label: 'workbenchConversationNav', icon: ChatBubbleLeftRightIcon },
  { id: WorkbenchMainViewId.ScheduledTasks, label: 'workbenchTaskNav', icon: ClockIcon },
  { id: WorkbenchMainViewId.Skills, label: 'workbenchSkillNav', icon: PuzzlePieceIcon },
  { id: WorkbenchMainViewId.Kits, label: 'workbenchKitsNav', icon: SidebarKitsIcon },
  { id: WorkbenchMainViewId.Applications, label: 'workbenchApplicationNav', icon: Squares2X2Icon },
];

const PrimarySidebar: React.FC<PrimarySidebarProps> = ({ activeView, onSelectView, onOpenSettings }) => {
  return (
    <aside className="flex w-[96px] shrink-0 flex-col border-r border-black/5 dark:border-white/5 bg-surface px-2.5 py-4">
      <div className="draggable h-8 shrink-0" />

      <div className="mt-2 flex shrink-0 flex-col items-center px-1 text-center">
        <LoginButton variant="sidebar" />
      </div>

      <nav className="mt-7 flex flex-1 flex-col gap-1.5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectView(item.id)}
              className={`group relative flex flex-col items-center gap-1.5 rounded-[18px] px-1.5 py-2.5 text-center transition-colors duration-200 ${
                isActive
                  ? 'bg-surface text-foreground'
                  : 'text-secondary hover:bg-surface/70 hover:text-foreground'
              }`}
              aria-current={isActive ? 'page' : undefined}
            >
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-[14px] transition-colors duration-200 ${
                  isActive
                    ? 'bg-primary/12 text-primary ring-1 ring-primary/15'
                    : 'bg-transparent group-hover:bg-surface'
                }`}
              >
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <span className="text-[11px] font-medium leading-4">{i18nService.t(item.label)}</span>
            </button>
          );
        })}
      </nav>

      <div className="mt-3.5 flex shrink-0 flex-col gap-2.5">
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex flex-col items-center gap-1.5 rounded-[18px] px-1.5 py-2.5 text-secondary transition-colors hover:bg-surface/70 hover:text-foreground"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-[14px] bg-transparent">
            <Cog6ToothIcon className="h-[18px] w-[18px]" />
          </span>
          <span className="text-[11px] font-medium leading-4">{i18nService.t('settings')}</span>
        </button>
        <div className="px-2.5 py-2 text-center opacity-90">
          <div className="flex items-center justify-center">
            <QingShuBrandMark
              className="relative flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-red-600 shadow-[0_0_0_1px_rgba(0,0,0,0.55),0_4px_12px_rgba(220,38,38,0.46)] ring-1 ring-white/45"
              iconClassName="text-[12px] font-semibold leading-none text-white"
            />
          </div>
          <div className="mt-2 text-[11px] font-semibold leading-4 tracking-[0.08em] text-red-700 dark:text-red-400">
            {i18nService.t('workbenchBrandLine1')}
          </div>
          <div className="mt-1 text-[11px] font-medium leading-4 text-foreground/72 dark:text-foregroundSecondary/80">
            {i18nService.t('workbenchBrandLine2')}
          </div>
        </div>
      </div>
    </aside>
  );
};

export default PrimarySidebar;
