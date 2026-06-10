import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';
import React, { useEffect,useState } from 'react';
import { useSelector } from 'react-redux';

import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { selectIsOpenClawEngine } from '../../store/selectors/coworkSelectors';
import type { OpenClawEngineStatus } from '../../types/cowork';

const resolveEngineStatusText = (status: OpenClawEngineStatus): string => {
  switch (status.phase) {
    case 'not_installed':
      return i18nService.t('coworkOpenClawNotInstalledNotice');
    case 'installing':
      return i18nService.t('coworkOpenClawInstalling');
    case 'ready':
      return i18nService.t('coworkOpenClawReadyNotice');
    case 'starting':
      return i18nService.t('coworkOpenClawStarting');
    case 'error':
      return i18nService.t('coworkOpenClawError');
    case 'running':
    default:
      return i18nService.t('coworkOpenClawRunning');
  }
};

/**
 * Global overlay shown when the OpenClaw gateway is starting up.
 * Renders on top of all views (cowork, skills, scheduled tasks, mcp).
 */
type EngineStartupOverlayProps = {
  suspended?: boolean;
};

const EngineStartupOverlay: React.FC<EngineStartupOverlayProps> = ({ suspended = false }) => {
  const isOpenClawEngine = useSelector(selectIsOpenClawEngine);
  const [status, setStatus] = useState<OpenClawEngineStatus | null>(null);

  useEffect(() => {
    if (!isOpenClawEngine) return;

    coworkService.getOpenClawEngineStatus().then((s) => {
      if (s) setStatus(s);
    });

    const unsubscribe = coworkService.onOpenClawEngineStatus((s) => {
      setStatus(s);
    });

    return unsubscribe;
  }, [isOpenClawEngine]);

  if (!isOpenClawEngine || !status || status.phase !== 'starting' || suspended) {
    return null;
  }

  const progressPercent = typeof status.progressPercent === 'number'
    ? Math.max(0, Math.min(100, Math.round(status.progressPercent)))
    : null;

  return (
    <div className="jbp-visual-backdrop fixed inset-0 z-[100] flex items-center justify-center px-6">
      <div className="jbp-visual-panel w-full max-w-md rounded-[calc(var(--lobster-radius)*3)] px-6 py-5">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="jbp-visual-icon-tile flex h-11 w-11 items-center justify-center rounded-2xl animate-pulse">
            <ChatBubbleLeftRightIcon className="h-5 w-5" />
          </div>
          <div className="text-sm font-medium text-foreground">
            {resolveEngineStatusText(status)}
          </div>
          {progressPercent !== null && (
            <div className="w-full space-y-1">
              <div className="jbp-visual-progress-track h-1.5 w-full overflow-hidden rounded-full">
                <div
                  className="jbp-visual-progress-bar h-full rounded-full transition-all"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="text-xs text-secondary">
                {progressPercent}%
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EngineStartupOverlay;
