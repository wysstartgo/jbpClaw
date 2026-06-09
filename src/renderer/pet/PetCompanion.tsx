import {
  ArrowPathIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  PaperAirplaneIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import React, { useEffect, useMemo, useState } from 'react';

import { PetMode, PetSource, PetStatus } from '../../shared/pet/constants';
import type { PetCatalogEntry, PetRuntimeSession, PetRuntimeState } from '../../shared/pet/types';
import { i18nService } from '../services/i18n';
import {
  nextPetFrameIndex,
  PetInteractionState,
  resolveFramePosition,
  resolvePetAnimation,
} from './animation';
import { petService } from './petService';

type PetCompanionProps = {
  state: PetRuntimeState;
  variant?: 'embedded' | 'floating';
  className?: string;
};

const FLOATING_INTERACTIVE_TARGET_SELECTOR = '.non-draggable';

const statusLabel = (status: PetStatus): string => {
  switch (status) {
    case PetStatus.Running:
      return i18nService.t('petStatusRunning');
    case PetStatus.Waiting:
      return i18nService.t('petStatusWaiting');
    case PetStatus.Review:
      return i18nService.t('petStatusReview');
    case PetStatus.Failed:
      return i18nService.t('petStatusFailed');
    case PetStatus.Idle:
    default:
      return i18nService.t('petStatusIdle');
  }
};

const canRenderEmbedded = (state: PetRuntimeState): boolean => (
  state.config.enabled
  && (state.config.mode === PetMode.Embedded || state.config.mode === PetMode.Both)
  && !!state.activePet?.manifest
);

const canToggleFloatingWindow = (state: PetRuntimeState): boolean => (
  state.config.mode === PetMode.Floating || state.config.mode === PetMode.Both
);

const sessionStatusDotClass = (status: PetStatus): string => {
  switch (status) {
    case PetStatus.Waiting:
      return 'bg-orange-500 text-white';
    case PetStatus.Review:
      return 'bg-green-500 text-white';
    case PetStatus.Failed:
      return 'bg-red-500 text-white';
    case PetStatus.Running:
      return 'bg-blue-500 text-white';
    case PetStatus.Idle:
    default:
      return 'bg-neutral-300 text-neutral-800';
  }
};

const sessionStatusIcon = (status: PetStatus): React.ReactNode => {
  switch (status) {
    case PetStatus.Waiting:
      return <ClockIcon className="h-3.5 w-3.5" />;
    case PetStatus.Review:
      return <CheckCircleIcon className="h-3.5 w-3.5" />;
    case PetStatus.Failed:
      return <ExclamationTriangleIcon className="h-3.5 w-3.5" />;
    case PetStatus.Running:
      return <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />;
    case PetStatus.Idle:
    default:
      return null;
  }
};

const activityBadgeClass = (status: PetStatus): string => {
  switch (status) {
    case PetStatus.Waiting:
      return 'bg-orange-500 text-white ring-orange-200';
    case PetStatus.Review:
      return 'bg-green-500 text-white ring-green-200';
    case PetStatus.Failed:
      return 'bg-red-500 text-white ring-red-200';
    case PetStatus.Running:
      return 'bg-blue-500 text-white ring-blue-200';
    case PetStatus.Idle:
    default:
      return 'bg-neutral-800 text-white ring-white';
  }
};

const sourceLabel = (pet: PetCatalogEntry): string => {
  if (pet.source === PetSource.Custom) return i18nService.t('petSourceCustom');
  if (pet.source === PetSource.LegacyAvatar) return i18nService.t('petSourceLegacyAvatar');
  if (pet.source === PetSource.CodexCustom) return i18nService.t('petSourceCodexCustom');
  if (pet.bundled) return i18nService.t('petSourceBuiltIn');
  return pet.installed ? i18nService.t('petSourceCached') : i18nService.t('petSourceOnDemand');
};

export const PetSprite: React.FC<{
  pet: PetCatalogEntry;
  status: PetStatus;
  animationsEnabled: boolean;
  interaction?: PetInteractionState;
  animationKey?: string | null;
  size?: number;
}> = ({ pet, status, animationsEnabled, interaction = PetInteractionState.None, animationKey = null, size = 84 }) => {
  const manifest = pet.manifest;
  const animation = useMemo(
    () => manifest ? resolvePetAnimation(manifest, status, interaction) : null,
    [manifest, status, interaction],
  );
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    setFrameIndex(0);
  }, [pet.id, status, interaction, animationKey]);

  useEffect(() => {
    if (!animation || !animationsEnabled || animation.frames.length <= 1) return;
    const frame = animation.frames[frameIndex] ?? animation.frames[0];
    const timer = window.setTimeout(() => {
      setFrameIndex((current) => nextPetFrameIndex(animation, current));
    }, frame.durationMs);
    return () => window.clearTimeout(timer);
  }, [animation, animationsEnabled, frameIndex]);

  if (!manifest || !animation) return null;

  const frame = animation.frames[frameIndex] ?? animation.frames[0];
  const { row, column } = resolveFramePosition(frame.spriteIndex, manifest.frame.columns);
  const scale = size / manifest.frame.width;
  const sheetWidth = manifest.frame.width * manifest.frame.columns * scale;
  const sheetHeight = manifest.frame.height * manifest.frame.rows * scale;

  return (
    <div
      className="relative overflow-hidden"
      style={{ width: size, height: Math.round(manifest.frame.height * scale) }}
      aria-label={`${pet.displayName} ${statusLabel(status)}`}
    >
      <img
        src={`localfile://${encodeURI(manifest.spritesheetPath)}`}
        alt=""
        draggable={false}
        className="pointer-events-none select-none"
        style={{
          width: sheetWidth,
          height: sheetHeight,
          maxWidth: 'none',
          transform: `translate(${-column * size}px, ${-row * manifest.frame.height * scale}px)`,
          imageRendering: 'auto',
        }}
      />
    </div>
  );
};

type PetMenuProps = {
  pet: PetCatalogEntry;
  state: PetRuntimeState;
  isFloating: boolean;
  positionClass: string;
  onClosePet: () => void;
  onDismiss: () => void;
};

export const PetMenu: React.FC<PetMenuProps> = ({
  pet,
  state,
  isFloating,
  positionClass,
  onClosePet,
  onDismiss,
}) => {
  if (isFloating) {
    return (
      <button
        type="button"
        className={`non-draggable absolute z-[80] inline-flex h-6 items-center justify-center whitespace-nowrap rounded-full border border-neutral-200 bg-white px-2.5 text-[11px] font-medium leading-none text-neutral-700 shadow-[0_6px_14px_-10px_rgba(0,0,0,0.45)] ring-1 ring-white transition hover:bg-neutral-100 hover:text-black focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${positionClass}`}
        onClick={(event) => {
          event.stopPropagation();
          onClosePet();
        }}
        title={i18nService.t('petClose')}
        aria-label={i18nService.t('petClose')}
      >
        {i18nService.t('petClose')}
      </button>
    );
  }

  return (
    <div className={`non-draggable absolute z-[80] w-56 rounded-lg border border-border bg-surface p-2 text-sm shadow-xl ${positionClass}`}>
      <div className="mb-2 border-b border-border/70 pb-2">
        <div className="font-medium text-foreground">{pet.displayName}</div>
        <div className="text-xs text-secondary">{sourceLabel(pet)} · {statusLabel(state.status)}</div>
      </div>
      <button
        type="button"
        className="w-full rounded-md px-2 py-1.5 text-left text-foreground hover:bg-surface-hover"
        onClick={() => {
          onDismiss();
          void window.electron.pet.openSettings();
        }}
      >
        {i18nService.t('petOpenSettings')}
      </button>
      <button
        type="button"
        disabled={!canToggleFloatingWindow(state)}
        className="w-full rounded-md px-2 py-1.5 text-left text-foreground hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => {
          onDismiss();
          void petService.setFloatingVisible(!state.config.floatingWindow.visible);
        }}
      >
        {state.config.floatingWindow.visible ? i18nService.t('petHideFloatingWindow') : i18nService.t('petShowFloatingWindow')}
      </button>
      <button
        type="button"
        className="w-full rounded-md px-2 py-1.5 text-left text-secondary hover:bg-surface-hover"
        onClick={() => {
          onDismiss();
          void petService.setConfig({ enabled: false });
        }}
      >
        {i18nService.t('petHide')}
      </button>
    </div>
  );
};

type PetSessionNotificationProps = {
  session: PetRuntimeSession;
  collapsed: boolean;
  onActivate: (sessionId: string) => void;
  onClose: (event: React.MouseEvent<HTMLButtonElement>, sessionId: string) => void;
  onToggleExpanded: (event: React.MouseEvent<HTMLButtonElement>, sessionId: string) => void;
};

type PetActivityToggleProps = {
  open: boolean;
  count: number;
  status: PetStatus;
  onOpen: () => void;
  onCollapse: () => void;
};

export const PetActivityToggle: React.FC<PetActivityToggleProps> = ({
  open,
  count,
  status,
  onOpen,
  onCollapse,
}) => {
  if (open) {
    return (
      <button
        type="button"
        className="non-draggable absolute -right-1 -top-1 z-20 inline-flex h-6 w-6 items-center justify-center rounded-full border border-neutral-200 bg-white p-0 text-neutral-600 opacity-95 shadow-sm ring-2 ring-white transition hover:bg-neutral-100 hover:text-black focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onCollapse();
        }}
        title={i18nService.t('petCollapseActivity')}
        aria-label={i18nService.t('petCollapseActivity')}
        aria-expanded="true"
      >
        <ChevronRightIcon className="h-3.5 w-3.5 rotate-90" />
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`non-draggable absolute -right-1 -top-1 z-20 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold leading-none shadow-[0_6px_14px_-8px_rgba(0,0,0,0.5)] ring-2 transition hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${activityBadgeClass(status)}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      title={i18nService.t('petOpenActivity')}
      aria-label={i18nService.t('petOpenActivity')}
      aria-expanded="false"
    >
      {count}
    </button>
  );
};

export const PetSessionNotification: React.FC<PetSessionNotificationProps> = ({
  session,
  collapsed,
  onActivate,
  onClose,
  onToggleExpanded,
}) => {
  const sessionBody = session.message ?? session.progressLabel ?? statusLabel(session.status);

  return (
    <div
      className="group relative w-full snap-start scroll-mt-2 text-left"
      role="listitem"
    >
      <div className="relative z-[1] overflow-hidden rounded-[8px] border border-neutral-200 bg-white text-black shadow-[0_14px_30px_-20px_rgba(0,0,0,0.4)] transition-[background-color,border-color,box-shadow] duration-200 ease-out hover:border-neutral-300 hover:bg-white hover:shadow-[0_18px_38px_-22px_rgba(0,0,0,0.48)]">
        <button
          type="button"
          className="block w-full min-w-0 cursor-pointer px-3 py-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          onClick={() => onActivate(session.id)}
          title={session.message ?? session.title}
          aria-label={`${session.title}. ${session.message ?? statusLabel(session.status)}`}
        >
          <span className="flex min-w-0 items-center pr-14">
            <span className="min-w-0 truncate text-[13px] font-semibold leading-[17px] text-black">
              {session.title}
            </span>
          </span>
          <span className={`${collapsed ? 'line-clamp-1' : 'line-clamp-4'} mt-0.5 block overflow-hidden pr-2 text-[12px] leading-4 text-neutral-800`}>
            {sessionBody}
          </span>
        </button>
        <span className={`pointer-events-none absolute right-8 top-1.5 z-0 flex h-6 w-6 items-center justify-center rounded-full ${sessionStatusDotClass(session.status)}`}>
          {sessionStatusIcon(session.status)}
        </span>
        <button
          type="button"
          className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-white text-neutral-600 shadow-sm ring-1 ring-neutral-200 transition hover:bg-neutral-100 hover:text-black focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          onClick={(event) => onToggleExpanded(event, session.id)}
          title={collapsed ? i18nService.t('petExpandSession') : i18nService.t('petCollapseSession')}
          aria-expanded={!collapsed}
          aria-label={collapsed ? i18nService.t('petExpandSession') : i18nService.t('petCollapseSession')}
        >
          <ChevronRightIcon className={`h-3.5 w-3.5 transition-transform ${collapsed ? '' : 'rotate-90'}`} />
        </button>
        <button
          type="button"
          className="absolute left-1 top-1 z-20 flex h-6 w-6 -translate-x-1 items-center justify-center rounded-full bg-white text-neutral-500 opacity-0 shadow-sm ring-1 ring-neutral-200 transition hover:bg-neutral-100 hover:text-black focus:translate-x-0 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:translate-x-0 group-focus-within:opacity-100"
          onClick={(event) => onClose(event, session.id)}
          title={i18nService.t('petCloseSession')}
          aria-label={i18nService.t('petCloseSession')}
        >
          <XMarkIcon className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="absolute bottom-1 right-2 z-10 flex h-5 translate-x-1 items-center gap-1 rounded-full bg-white px-2 text-[11px] font-medium leading-none text-neutral-800 opacity-0 shadow-[0px_5px_10px_-7px_rgba(0,0,0,0.22)] ring-1 ring-neutral-200 transition hover:bg-neutral-100 focus:translate-x-0 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:translate-x-0 group-focus-within:opacity-100"
          onClick={(event) => {
            event.stopPropagation();
            onActivate(session.id);
          }}
          title={i18nService.t('petReplyInSession')}
          aria-label={i18nService.t('petReplyInSession')}
        >
          <PaperAirplaneIcon className="h-3 w-3" />
          {i18nService.t('petReplyInSession')}
        </button>
      </div>
    </div>
  );
};

const PetCompanion: React.FC<PetCompanionProps> = ({
  state,
  variant = 'embedded',
  className = '',
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [petHovered, setPetHovered] = useState(false);
  const [activityTrayOpen, setActivityTrayOpen] = useState(true);
  const [collapsedSessionIds, setCollapsedSessionIds] = useState<Record<string, boolean>>({});
  const [dragState, setDragState] = useState<{
    pointerId: number;
    lastX: number;
    lastY: number;
    moved: boolean;
    direction: 'left' | 'right' | null;
  } | null>(null);
  const [resizeState, setResizeState] = useState<{
    pointerId: number;
    lastX: number;
    lastY: number;
  } | null>(null);
  const pet = state.activePet;
  const visible = variant === 'floating'
    ? state.config.enabled && !!pet?.manifest
    : canRenderEmbedded(state);

  const spriteSize = variant === 'floating'
    ? Math.max(104, Math.min(260, Math.round(state.config.floatingWindow.width * 0.58)))
    : 72;
  const menuPositionClass = variant === 'floating' ? 'right-6 top-5' : 'right-0 bottom-full mb-2';
  const isFloating = variant === 'floating';
  const isDragging = !!dragState;
  const activeSessions = state.activeSessions;
  const hasActiveSessions = activeSessions.length > 0;
  const activeSessionCount = activeSessions.length;
  const primarySessionStatus = activeSessions[0]?.status ?? PetStatus.Idle;
  const spriteAnimationKey = [
    state.session?.id ?? 'none',
    state.message ?? '',
    activeSessions.map((session) => `${session.id}:${session.status}:${session.updatedAt}`).join('|'),
  ].join(':');
  const bubbleTitle = state.session?.title ?? statusLabel(state.status);
  const bubbleMessage = state.message ?? statusLabel(state.status);
  const handlePetActivate = () => {
    if (isFloating) {
      void window.electron.pet.activateMainWindow();
      return;
    }
    setMenuOpen((open) => !open);
  };

  useEffect(() => {
    if (!isFloating) return;
    void window.electron.pet.setFloatingActivityOpen(hasActiveSessions && activityTrayOpen);
  }, [activityTrayOpen, hasActiveSessions, isFloating]);

  useEffect(() => {
    if (!isFloating) return;
    let ignoresMouseEvents = false;
    let pendingIgnore: boolean | null = null;
    let scheduled = false;

    const flushMouseEventMode = () => {
      scheduled = false;
      if (pendingIgnore === null || pendingIgnore === ignoresMouseEvents) return;
      ignoresMouseEvents = pendingIgnore;
      void window.electron.pet.setFloatingWindowIgnoresMouseEvents(ignoresMouseEvents).catch((error) => {
        console.error('[PetCompanion] failed to update floating mouse event mode:', error);
      });
    };

    const setIgnored = (ignored: boolean) => {
      pendingIgnore = ignored;
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(flushMouseEventMode);
    };

    const handleMouseMove = (event: MouseEvent | PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      setIgnored(!target?.closest(FLOATING_INTERACTIVE_TARGET_SELECTOR));
    };

    const handlePointerLeave = () => {
      setIgnored(true);
    };

    setIgnored(true);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('pointermove', handleMouseMove);
    window.addEventListener('pointerleave', handlePointerLeave);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('pointermove', handleMouseMove);
      window.removeEventListener('pointerleave', handlePointerLeave);
      void window.electron.pet.setFloatingWindowIgnoresMouseEvents(false).catch((error) => {
        console.error('[PetCompanion] failed to restore floating mouse event mode:', error);
      });
    };
  }, [isFloating]);

  const closePet = () => {
    setMenuOpen(false);
    void petService.setFloatingVisible(false);
  };

  if (!visible || !pet) return null;

  const sprite = (
    <PetSprite
      pet={pet}
      status={state.status}
      animationsEnabled={state.config.animationsEnabled}
      animationKey={spriteAnimationKey}
      interaction={
        dragState?.direction === 'left'
          ? PetInteractionState.DraggingLeft
          : dragState?.direction === 'right'
            ? PetInteractionState.DraggingRight
            : isDragging
              ? PetInteractionState.Dragging
              : petHovered
                ? PetInteractionState.Hover
                : PetInteractionState.None
      }
      size={spriteSize}
    />
  );

  const activateSession = (sessionId: string) => {
    setMenuOpen(false);
    void petService.acknowledgeSession(sessionId);
    void window.electron.pet.activateSession(sessionId);
  };

  const closeSessionNotification = (event: React.MouseEvent<HTMLButtonElement>, sessionId: string) => {
    event.stopPropagation();
    void petService.acknowledgeSession(sessionId);
  };

  const toggleSessionExpanded = (event: React.MouseEvent<HTMLButtonElement>, sessionId: string) => {
    event.stopPropagation();
    setCollapsedSessionIds((current) => ({
      ...current,
      [sessionId]: !current[sessionId],
    }));
  };

  const handleFloatingPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragState({
      pointerId: event.pointerId,
      lastX: event.screenX,
      lastY: event.screenY,
      moved: false,
      direction: 'right',
    });
  };

  const handleFloatingResizePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setMenuOpen(false);
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizeState({
      pointerId: event.pointerId,
      lastX: event.screenX,
      lastY: event.screenY,
    });
  };

  const handleFloatingResizePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    const deltaX = event.screenX - resizeState.lastX;
    const deltaY = event.screenY - resizeState.lastY;
    if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;
    event.preventDefault();
    event.stopPropagation();
    setResizeState({
      pointerId: event.pointerId,
      lastX: event.screenX,
      lastY: event.screenY,
    });
    void petService.resizeFloatingWindowBy({ deltaX, deltaY });
  };

  const handleFloatingResizePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.releasePointerCapture(event.pointerId);
    setResizeState(null);
  };

  const handleFloatingResizePointerCancel = () => {
    setResizeState(null);
  };

  const handleFloatingPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const deltaX = event.screenX - dragState.lastX;
    const deltaY = event.screenY - dragState.lastY;
    if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;
    event.preventDefault();
    event.stopPropagation();
    setDragState({
      pointerId: event.pointerId,
      lastX: event.screenX,
      lastY: event.screenY,
      moved: dragState.moved || Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2,
      direction: Math.abs(deltaX) >= 1
        ? deltaX > 0 ? 'right' : 'left'
        : dragState.direction,
    });
    void window.electron.pet.moveFloatingWindowBy({ deltaX, deltaY });
  };

  const handleFloatingPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.releasePointerCapture(event.pointerId);
    const moved = dragState.moved;
    setDragState(null);
    void window.electron.pet.persistFloatingWindowPosition();
    if (!moved) {
      void window.electron.pet.activateMainWindow();
    }
  };

  return (
    <div className={`pet-companion relative ${variant === 'floating' ? 'h-screen w-screen' : ''} ${className}`}>
      {isFloating ? (
        <div className="absolute right-3 top-3">
          <button
            type="button"
            className={`pet-companion-trigger non-draggable inline-flex touch-none select-none items-end border-0 bg-transparent p-0 text-left shadow-none transition focus:outline-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
            onPointerDown={handleFloatingPointerDown}
            onPointerMove={handleFloatingPointerMove}
            onPointerUp={handleFloatingPointerUp}
            onPointerEnter={() => setPetHovered(true)}
            onPointerLeave={() => {
              if (!isDragging) setPetHovered(false);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenuOpen(true);
            }}
            onDragStart={(event) => event.preventDefault()}
            onPointerCancel={() => {
              setDragState(null);
              void window.electron.pet.persistFloatingWindowPosition();
            }}
            title={`${pet.displayName} - ${statusLabel(state.status)}`}
            aria-label={`${pet.displayName} - ${statusLabel(state.status)}`}
          >
            {sprite}
          </button>
          {hasActiveSessions && (
            <PetActivityToggle
              open={activityTrayOpen}
              count={activeSessionCount}
              status={primarySessionStatus}
              onOpen={() => setActivityTrayOpen(true)}
              onCollapse={() => setActivityTrayOpen(false)}
            />
          )}
          <button
            type="button"
            className={`non-draggable absolute bottom-1 right-1 z-20 h-7 w-7 cursor-nwse-resize touch-none rounded-full border border-white/75 bg-white/80 p-0 text-neutral-700 opacity-0 shadow-[0_10px_28px_-14px_rgba(15,23,42,0.6),0_2px_8px_-4px_rgba(15,23,42,0.35)] backdrop-blur-md ring-1 ring-black/5 transition duration-150 hover:scale-105 hover:bg-white hover:text-black hover:opacity-100 focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-blue-500 ${resizeState ? 'scale-105 bg-white opacity-100 text-black' : ''}`}
            onPointerDown={handleFloatingResizePointerDown}
            onPointerMove={handleFloatingResizePointerMove}
            onPointerUp={handleFloatingResizePointerUp}
            onPointerCancel={handleFloatingResizePointerCancel}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            title={i18nService.t('petResizeFloatingWindow')}
            aria-label={i18nService.t('petResizeFloatingWindow')}
          >
            <span className="absolute inset-0 rounded-full bg-gradient-to-br from-white/80 to-neutral-200/70" />
            <svg
              className="absolute inset-0 m-auto h-4 w-4"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M4 4h4M4 4v4M12 12H8M12 12V8M4.75 4.75l6.5 6.5"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="pet-companion-trigger non-draggable flex items-end gap-2 border-0 bg-transparent p-0 text-left shadow-none transition hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() => setMenuOpen((open) => !open)}
          onPointerEnter={() => setPetHovered(true)}
          onPointerLeave={() => setPetHovered(false)}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenuOpen(true);
          }}
          title={`${pet.displayName} - ${statusLabel(state.status)}`}
        >
          {sprite}
        </button>
      )}

      {isFloating && hasActiveSessions && activityTrayOpen && (
        <div
          className="non-draggable absolute right-[118px] top-3 z-[70] flex max-h-[300px] w-[276px] flex-col items-stretch gap-2 overflow-y-auto overflow-x-hidden text-left"
          role="list"
          aria-label={i18nService.t('petNotificationList')}
        >
          {activeSessions.map((session) => {
            const collapsed = collapsedSessionIds[session.id] ?? false;
            return (
              <PetSessionNotification
                key={session.id}
                session={session}
                collapsed={collapsed}
                onActivate={activateSession}
                onClose={closeSessionNotification}
                onToggleExpanded={toggleSessionExpanded}
              />
            );
          })}
        </div>
      )}
      {!isFloating && (state.status !== PetStatus.Idle || !!state.message || !!state.session) && (
        <button
          type="button"
          className={`non-draggable absolute z-[70] max-w-[220px] rounded-lg border border-border/70 bg-surface/95 px-3 py-2 text-left shadow-lg backdrop-blur transition hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
            isFloating ? 'left-[76px] top-5' : 'left-[58px] top-0'
          }`}
          onClick={handlePetActivate}
          title={bubbleMessage}
        >
          <span className="block truncate text-[11px] font-medium text-foreground">
            {bubbleTitle}
          </span>
          <span className="line-clamp-2 block text-[10px] leading-snug text-secondary">
            {bubbleMessage}
          </span>
        </button>
      )}

      {menuOpen && (
        <PetMenu
          pet={pet}
          state={state}
          isFloating={isFloating}
          positionClass={menuPositionClass}
          onClosePet={closePet}
          onDismiss={() => setMenuOpen(false)}
        />
      )}
    </div>
  );
};

export default PetCompanion;
