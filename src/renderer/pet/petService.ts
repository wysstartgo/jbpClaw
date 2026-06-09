import { DEFAULT_PET_CONFIG } from '../../shared/pet/config';
import { PET_NOTIFICATION_LIFETIME_MS, PetStatus } from '../../shared/pet/constants';
import type { PetCatalogEntry, PetConfig, PetRuntimeSession, PetRuntimeState } from '../../shared/pet/types';
import type { RootState } from '../store';
import type { CoworkMessage, CoworkSessionStatus } from '../types/cowork';

type Listener = (state: PetRuntimeState) => void;
type PetRuntimeProjection = Pick<PetRuntimeState, 'status' | 'message' | 'session' | 'activeSessions'>;
type CoworkPetProjectionState = {
  pendingPermissions: unknown[];
  isStreaming: boolean;
  sessions?: Array<{
    id: string;
    title: string;
    status: CoworkSessionStatus;
    updatedAt: number;
  }>;
  currentSession: {
    id?: string;
    title?: string;
    status?: CoworkSessionStatus;
    messages?: CoworkMessage[];
    updatedAt?: number;
  } | null;
};

export const resolvePetStatusFromCoworkState = (cowork: CoworkPetProjectionState): PetStatus => {
  if (cowork.pendingPermissions.length > 0) {
    return PetStatus.Waiting;
  }

  if (cowork.isStreaming || cowork.currentSession?.status === 'running') {
    return PetStatus.Running;
  }

  if (cowork.currentSession?.status === 'error') {
    return PetStatus.Failed;
  }

  if (cowork.currentSession?.status === 'completed') {
    return PetStatus.Review;
  }

  return PetStatus.Idle;
};

const truncateText = (value: string, maxLength: number): string => {
  const preview = value.length > maxLength * 8 ? value.slice(0, maxLength * 8) : value;
  const normalized = preview.split(/\s+/).filter(Boolean).join(' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
};

export const resolvePetMessageFromCoworkState = (cowork: CoworkPetProjectionState, status: PetStatus): string | null => {
  if (status === PetStatus.Waiting) {
    return 'Needs input';
  }

  if (status === PetStatus.Running) {
    const latestUserMessage = [...(cowork.currentSession?.messages ?? [])]
      .reverse()
      .find((message) => message.type === 'user' && message.content.trim());
    return latestUserMessage
      ? truncateText(latestUserMessage.content, 120)
      : 'Thinking';
  }

  if (status === PetStatus.Review) {
    const latestAssistantMessage = [...(cowork.currentSession?.messages ?? [])]
      .reverse()
      .find((message) => message.type === 'assistant' && message.content.trim());
    return latestAssistantMessage
      ? truncateText(latestAssistantMessage.content, 200)
      : 'Ready';
  }

  if (status === PetStatus.Failed) {
    const latestErrorMessage = [...(cowork.currentSession?.messages ?? [])]
      .reverse()
      .find((message) => (
        (message.type === 'system' || message.metadata?.isError) && message.content.trim()
      ));
    return latestErrorMessage
      ? truncateText(latestErrorMessage.content, 160)
      : 'Blocked';
  }

  return null;
};

const statusToProgressLabel = (status: PetStatus): string => {
  switch (status) {
    case PetStatus.Waiting:
      return 'Needs input';
    case PetStatus.Review:
      return 'Ready';
    case PetStatus.Failed:
      return 'Blocked';
    case PetStatus.Running:
      return 'Loading';
    case PetStatus.Idle:
    default:
      return 'Idle';
  }
};

const mapCoworkStatusToPetStatus = (status: CoworkSessionStatus | undefined): PetStatus => {
  if (status === 'running') return PetStatus.Running;
  if (status === 'completed') return PetStatus.Review;
  if (status === 'error') return PetStatus.Failed;
  return PetStatus.Idle;
};

const resolveSessionMessage = (
  session: { id?: string; title?: string; status?: CoworkSessionStatus; messages?: CoworkMessage[]; updatedAt?: number } | null,
  status: PetStatus,
): string | null => resolvePetMessageFromCoworkState({
  pendingPermissions: [],
  isStreaming: status === PetStatus.Running,
  currentSession: session,
}, status);

const petSessionStatusPriority = (status: PetStatus): number => {
  switch (status) {
    case PetStatus.Waiting:
      return 0;
    case PetStatus.Running:
      return 1;
    case PetStatus.Review:
      return 2;
    case PetStatus.Failed:
      return 3;
    case PetStatus.Idle:
    default:
      return 4;
  }
};

const sortPetRuntimeSessions = (sessions: PetRuntimeSession[]): PetRuntimeSession[] => (
  [...sessions].sort((a, b) => {
    const priorityDelta = petSessionStatusPriority(a.status) - petSessionStatusPriority(b.status);
    if (priorityDelta !== 0) return priorityDelta;
    return b.updatedAt - a.updatedAt;
  })
);

export const resolvePetSessionSnapshotsFromCoworkState = (cowork: CoworkPetProjectionState): PetRuntimeSession[] => {
  const sessions = new Map<string, PetRuntimeSession>();
  const permissionSessionIds = new Set(
    cowork.pendingPermissions
      .map((permission) => {
        if (!permission || typeof permission !== 'object') return null;
        const sessionId = (permission as { sessionId?: unknown }).sessionId;
        return typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : null;
      })
      .filter((sessionId): sessionId is string => !!sessionId),
  );

  for (const summary of cowork.sessions ?? []) {
    const hasPermission = permissionSessionIds.has(summary.id);
    if (
      summary.status !== 'running'
      && summary.status !== 'completed'
      && summary.status !== 'error'
      && !hasPermission
    ) continue;
    const status = hasPermission ? PetStatus.Waiting : mapCoworkStatusToPetStatus(summary.status);
    sessions.set(summary.id, {
      id: summary.id,
      title: summary.title || summary.id,
      status,
      message: null,
      progressLabel: statusToProgressLabel(status),
      updatedAt: summary.updatedAt,
    });
  }

  const current = cowork.currentSession;
  if (current?.id) {
    const status = permissionSessionIds.has(current.id)
      ? PetStatus.Waiting
      : mapCoworkStatusToPetStatus(current.status);
    if (status !== PetStatus.Idle) {
      sessions.set(current.id, {
        id: current.id,
        title: current.title || current.id,
        status,
        message: resolveSessionMessage(current, status),
        progressLabel: statusToProgressLabel(status),
        updatedAt: current.updatedAt ?? Date.now(),
      });
    }
  }

  return sortPetRuntimeSessions([...sessions.values()])
    .slice(0, 12);
};

export const resolvePetActiveSessionsFromCoworkState = (cowork: CoworkPetProjectionState): PetRuntimeSession[] => (
  resolvePetSessionSnapshotsFromCoworkState(cowork)
    .filter((session) => session.status === PetStatus.Running || session.status === PetStatus.Waiting)
    .slice(0, 5)
);

export const mergePetSessionNotifications = (
  previous: PetRuntimeSession[],
  snapshots: PetRuntimeSession[],
  acknowledgedAt: Record<string, number>,
  now = Date.now(),
  options: { terminalSnapshotCutoffMs?: number } = {},
): PetRuntimeSession[] => {
  const merged = new Map(previous.map((session) => [session.id, session]));
  const currentIds = new Set(snapshots.map((session) => session.id));

  for (const session of snapshots) {
    const ackedAt = acknowledgedAt[session.id] ?? 0;
    if (ackedAt > 0 && session.updatedAt <= ackedAt) {
      merged.delete(session.id);
      continue;
    }

    if (session.status === PetStatus.Running || session.status === PetStatus.Waiting) {
      merged.set(session.id, session);
      continue;
    }

    if (session.status === PetStatus.Review || session.status === PetStatus.Failed) {
      const terminalSnapshotCutoffMs = options.terminalSnapshotCutoffMs ?? 0;
      const isExistingNotification = merged.has(session.id);
      const isNewTerminalAfterCutoff = terminalSnapshotCutoffMs <= 0 || session.updatedAt >= terminalSnapshotCutoffMs;
      if (!isExistingNotification && !isNewTerminalAfterCutoff) continue;
      merged.set(session.id, session);
    }
  }

  for (const session of previous) {
    if (!currentIds.has(session.id) && session.status !== PetStatus.Review && session.status !== PetStatus.Failed) {
      merged.delete(session.id);
    }
  }

  const visibleSessions = [...merged.values()].filter((session) => {
    const lifetimeMs = PET_NOTIFICATION_LIFETIME_MS[session.status];
    return lifetimeMs <= 0 ? false : now - session.updatedAt < lifetimeMs;
  });

  return sortPetRuntimeSessions(visibleSessions).slice(0, 8);
};

class PetService {
  private static readonly MaxRememberedSessionMessages = 100;
  private static readonly MaxAcknowledgedSessions = 100;

  private state: PetRuntimeState | null = null;
  private listeners = new Set<Listener>();
  private cleanup: (() => void) | null = null;
  private lastSentStatus: PetStatus | null = null;
  private sessionMessages = new Map<string, string>();
  private trackedSessions = new Map<string, PetRuntimeSession>();
  private acknowledgedSessionAt = new Map<string, number>();
  private readonly notificationStartedAt = Date.now();

  async init(): Promise<PetRuntimeState | null> {
    if (this.cleanup) return this.state;
    this.cleanup = window.electron.pet.onStateChanged((state) => {
      this.state = state;
      this.lastSentStatus = state.status;
      this.syncTrackedSessionsFromState(state);
      this.notify();
    });
    const stateResult = await window.electron.pet.getState();
    if (stateResult.success && stateResult.state) {
      this.state = stateResult.state;
      this.lastSentStatus = this.state.status;
      this.syncTrackedSessionsFromState(this.state);
      this.notify();
    } else {
      const [configResult, petsResult] = await Promise.all([
        window.electron.pet.getConfig(),
        window.electron.pet.listPets(),
      ]);
      if (configResult.success && configResult.config && petsResult.success) {
        const pets = petsResult.pets ?? [];
        const activePet = this.resolveActivePet(configResult.config, pets);
        this.state = {
          config: configResult.config,
          status: PetStatus.Idle,
          message: null,
          session: null,
          activeSessions: [],
          activePet,
          pets,
        };
        this.lastSentStatus = this.state.status;
        this.notify();
      }
    }
    return this.state;
  }

  getState(): PetRuntimeState | null {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    if (this.state) listener(this.state);
    return () => this.listeners.delete(listener);
  }

  async setConfig(config: Partial<PetConfig>): Promise<void> {
    const currentConfig = this.state?.config ?? DEFAULT_PET_CONFIG;
    const result = await window.electron.pet.setConfig({
      ...currentConfig,
      ...config,
      floatingWindow: {
        ...currentConfig.floatingWindow,
        ...(config.floatingWindow ?? {}),
      },
    });
    if (result.success && result.config && this.state) {
      await this.refresh();
      return;
    }
    if (!result.success && result.error) {
      throw new Error(result.error);
    }
  }

  async setFloatingVisible(visible: boolean): Promise<void> {
    const result = await window.electron.pet.setFloatingVisible(visible);
    if (result.success && result.state) {
      this.state = result.state;
      this.notify();
      return;
    }
    if (result.success && result.config && this.state) {
      this.state = { ...this.state, config: result.config };
      this.notify();
      return;
    }
    if (!result.success && result.error) {
      throw new Error(result.error);
    }
  }

  async resizeFloatingWindowBy(delta: { deltaX: number; deltaY: number }): Promise<void> {
    const result = await window.electron.pet.resizeFloatingWindowBy(delta);
    if (result.success && result.state) {
      this.state = result.state;
      this.notify();
      return;
    }
    if (result.success && result.config && this.state) {
      this.state = { ...this.state, config: result.config };
      this.notify();
      return;
    }
    if (!result.success && result.error) {
      throw new Error(result.error);
    }
  }

  async selectPet(id: string): Promise<void> {
    const result = await window.electron.pet.selectPet(id);
    if (result.success && result.state) {
      this.state = result.state;
      this.notify();
      return;
    }
    if (!result.success) {
      throw new Error(result.error || 'Failed to select pet.');
    }
  }

  async importPet(): Promise<void> {
    const result = await window.electron.pet.importPet();
    if (result.success && result.state) {
      this.state = result.state;
      this.notify();
      return;
    }
    if (result.success && !result.canceled) {
      await this.refresh();
    }
    if (!result.success && result.error) {
      throw new Error(result.error);
    }
  }

  async deletePet(id: string): Promise<void> {
    const result = await window.electron.pet.deletePet(id);
    if (!result.success) {
      throw new Error(result.error || 'Failed to delete pet.');
    }
    await this.refresh();
  }

  async setStatus(status: PetStatus): Promise<void> {
    if (this.lastSentStatus === status) return;
    const result = await window.electron.pet.setStatus(status);
    if (result.success && result.state) {
      this.state = result.state;
      this.lastSentStatus = result.state.status;
      this.notify();
      return;
    }
    if (!result.success) {
      throw new Error(result.error || 'Failed to update pet status.');
    }
  }

  async setStatusFromCoworkState(cowork: RootState['cowork']): Promise<void> {
    await this.setRuntimeProjectionFromCoworkState(cowork);
  }

  rememberSessionMessage(sessionId: string, message: CoworkMessage | string): void {
    const rawContent = typeof message === 'string' ? message : message.content;
    const content = truncateText(rawContent, 160);
    if (!sessionId || !content) return;
    this.sessionMessages.set(sessionId, content);
    this.pruneMapToLimit(this.sessionMessages, PetService.MaxRememberedSessionMessages);
  }

  async acknowledgeSession(sessionId: string): Promise<void> {
    if (!sessionId) return;
    this.acknowledgedSessionAt.set(sessionId, Date.now());
    this.pruneMapToLimit(this.acknowledgedSessionAt, PetService.MaxAcknowledgedSessions);
    const result = await window.electron.pet.acknowledgeSession(sessionId);
    if (result.success && result.state) {
      this.state = result.state;
      this.lastSentStatus = result.state.status;
      this.syncTrackedSessionsFromState(result.state);
      this.notify();
      return;
    }
    if (!result.success && result.error) {
      throw new Error(result.error);
    }
    if (!this.state) return;
    const nextTrackedSessions = new Map(
      (this.trackedSessions.size > 0
        ? [...this.trackedSessions.values()]
        : this.state.activeSessions
      ).map((session) => [session.id, session]),
    );
    nextTrackedSessions.delete(sessionId);
    this.trackedSessions = nextTrackedSessions;
    const projection: PetRuntimeProjection = {
      status: this.state.status,
      message: this.state.message,
      session: this.state.session,
      activeSessions: [...this.trackedSessions.values()],
    };
    await this.sendRuntimeProjection(projection);
  }

  async setRuntimeProjectionFromCoworkState(cowork: RootState['cowork']): Promise<void> {
    const status = resolvePetStatusFromCoworkState(cowork);
    const session = cowork.currentSession?.id
      ? {
        id: cowork.currentSession.id,
        title: cowork.currentSession.title,
      }
      : null;
    const snapshots = resolvePetSessionSnapshotsFromCoworkState(cowork).map((activeSession) => ({
      ...activeSession,
      message: activeSession.message ?? this.sessionMessages.get(activeSession.id) ?? null,
    }));
    const activeSessions = mergePetSessionNotifications(
      [...this.trackedSessions.values()],
      snapshots,
      Object.fromEntries(this.acknowledgedSessionAt.entries()),
      Date.now(),
      { terminalSnapshotCutoffMs: this.notificationStartedAt },
    );
    this.trackedSessions = new Map(activeSessions.map((activeSession) => [activeSession.id, activeSession]));

    const projection: PetRuntimeProjection = {
      status,
      message: resolvePetMessageFromCoworkState(cowork, status),
      session,
      activeSessions,
    };
    await this.sendRuntimeProjection(projection);
  }

  private async sendRuntimeProjection(projection: PetRuntimeProjection): Promise<void> {
    const petApi = window.electron?.pet;
    if (!petApi?.setRuntimeProjection) return;

    const statusUnchanged = this.lastSentStatus === projection.status;
    const messageUnchanged = this.state?.message === projection.message;
    const sessionUnchanged = this.state?.session?.id === projection.session?.id && this.state?.session?.title === projection.session?.title;
    const activeSessionsUnchanged = JSON.stringify(this.state?.activeSessions ?? []) === JSON.stringify(projection.activeSessions);
    if (statusUnchanged && messageUnchanged && sessionUnchanged && activeSessionsUnchanged) return;
    const result = await petApi.setRuntimeProjection(projection);
    if (result.success && result.state) {
      this.state = result.state;
      this.lastSentStatus = result.state.status;
      this.notify();
      return;
    }
    if (!result.success) {
      throw new Error(result.error || 'Failed to update pet runtime projection.');
    }
  }

  async refresh(): Promise<void> {
    const refreshResult = await window.electron.pet.refresh?.();
    if (refreshResult?.success && refreshResult.state) {
      this.state = refreshResult.state;
      this.lastSentStatus = this.state.status;
      this.syncTrackedSessionsFromState(this.state);
      this.notify();
      return;
    }
    if (refreshResult && !refreshResult.success && refreshResult.error) {
      throw new Error(refreshResult.error);
    }

    const stateResult = await window.electron.pet.getState();
    if (stateResult.success && stateResult.state) {
      this.state = stateResult.state;
      this.lastSentStatus = this.state.status;
      this.syncTrackedSessionsFromState(this.state);
      this.notify();
      return;
    }

    const [configResult, petsResult] = await Promise.all([
      window.electron.pet.getConfig(),
      window.electron.pet.listPets(),
    ]);
    if (configResult.success && configResult.config && petsResult.success) {
      const pets = petsResult.pets ?? [];
      this.state = {
        config: configResult.config,
        status: this.state?.status ?? PetStatus.Idle,
        message: this.state?.message ?? null,
        session: this.state?.session ?? null,
        activeSessions: this.state?.activeSessions ?? [],
        activePet: this.resolveActivePet(configResult.config, pets),
        pets,
      };
      this.lastSentStatus = this.state.status;
      this.syncTrackedSessionsFromState(this.state);
      this.notify();
    }
  }

  private resolveActivePet(config: PetConfig, pets: PetCatalogEntry[]): PetCatalogEntry | null {
    return pets.find((pet) => pet.id === config.selectedPetId)
      ?? pets.find((pet) => pet.selectable)
      ?? null;
  }

  private notify(): void {
    if (!this.state) return;
    this.listeners.forEach((listener) => listener(this.state!));
  }

  private syncTrackedSessionsFromState(state: PetRuntimeState): void {
    this.trackedSessions = new Map(state.activeSessions.map((activeSession) => [activeSession.id, activeSession]));
  }

  private pruneMapToLimit<K, V>(map: Map<K, V>, limit: number): void {
    while (map.size > limit) {
      const oldestKey = map.keys().next().value as K | undefined;
      if (oldestKey === undefined) return;
      map.delete(oldestKey);
    }
  }
}

export const petService = new PetService();
