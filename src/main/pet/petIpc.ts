import { BrowserWindow, dialog, ipcMain } from 'electron';

import { DEFAULT_PET_CONFIG, normalizePetConfig } from '../../shared/pet/config';
import {
  DEFAULT_PET_ID,
  PetAssetPolicy,
  PetIpcChannel,
  PetMode,
  PetRendererRoute,
  PetSource,
  PetStatus,
} from '../../shared/pet/constants';
import type { PetRuntimeSession, PetRuntimeState } from '../../shared/pet/types';
import { t } from '../i18n';
import { applyPetConfigToCatalog, canSelectPetEntry } from './catalogPolicy';
import { PetConfigStore } from './petConfigStore';
import { PetStore } from './petStore';
import { PetWindowController } from './petWindowController';

type RegisterPetIpcOptions = {
  configStore: PetConfigStore;
  petStore: PetStore;
  windowController: PetWindowController;
  getMainWindow: () => BrowserWindow | null;
  showMainWindow: () => void;
};

type PetRuntimeProjection = {
  status: PetStatus;
  message: string | null;
  session: {
    id: string;
    title: string;
  } | null;
  activeSessions: PetRuntimeSession[];
};

const sendStateToAllWindows = (state: PetRuntimeState): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    if (isPetFloatingWindowUrl(win.webContents.getURL())) continue;
    win.webContents.send(PetIpcChannel.StateChanged, state);
  }
};

const isPetFloatingWindowUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.hash.replace(/^#\/?/, '') === PetRendererRoute.Floating;
  } catch {
    return url.includes(`#${PetRendererRoute.Floating}`) || url.includes(`#/${PetRendererRoute.Floating}`);
  }
};

export function buildPetRuntimeState(
  configStore: PetConfigStore,
  petStore: PetStore,
  projection: PetRuntimeProjection,
): PetRuntimeState {
  const config = configStore.getConfig();
  const pets = applyPetConfigToCatalog(petStore.listPets(), config);
  const activePet = config.selectedPetId
    ? pets.find((pet) => pet.id === config.selectedPetId) ?? null
    : null;
  return {
    config,
    status: projection.status,
    message: projection.message,
    session: projection.session,
    activeSessions: projection.activeSessions,
    activePet: activePet ?? pets.find((pet) => pet.selectable) ?? null,
    pets,
  };
}

const isPetStatus = (value: unknown): value is PetStatus => (
  value === PetStatus.Running
  || value === PetStatus.Waiting
  || value === PetStatus.Review
  || value === PetStatus.Failed
  || value === PetStatus.Idle
);

const normalizePetStatus = (value: unknown): PetStatus => (
  isPetStatus(value) ? value : PetStatus.Idle
);

const normalizeRuntimeSession = (value: unknown): PetRuntimeSession | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (!id) return null;
  const title = typeof record.title === 'string' && record.title.trim()
    ? record.title.trim()
    : id;
  const message = typeof record.message === 'string' && record.message.trim()
    ? record.message.trim().slice(0, 220)
    : null;
  const progressLabel = typeof record.progressLabel === 'string' && record.progressLabel.trim()
    ? record.progressLabel.trim().slice(0, 80)
    : null;
  const updatedAt = typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
    ? record.updatedAt
    : Date.now();
  return {
    id,
    title: title.slice(0, 120),
    status: normalizePetStatus(record.status),
    message,
    progressLabel,
    updatedAt,
  };
};

const normalizeActiveSessions = (value: unknown): PetRuntimeSession[] => {
  if (!Array.isArray(value)) return [];
  const sessions = new Map<string, PetRuntimeSession>();
  for (const item of value) {
    const session = normalizeRuntimeSession(item);
    if (!session || sessions.has(session.id)) continue;
    sessions.set(session.id, session);
    if (sessions.size >= 8) break;
  }
  return [...sessions.values()];
};

export function registerPetIpc(options: RegisterPetIpcOptions): {
  emitState: (status?: PetStatus) => PetRuntimeState;
} {
  const acknowledgedSessionAt = new Map<string, number>();
  let currentProjection: PetRuntimeProjection = {
    status: PetStatus.Idle,
    message: null,
    session: null,
    activeSessions: [],
  };

  const emitState = (status = currentProjection.status): PetRuntimeState => {
    currentProjection = {
      ...currentProjection,
      status,
    };
    const state = buildPetRuntimeState(options.configStore, options.petStore, currentProjection);
    sendStateToAllWindows(state);
    options.windowController.setRuntimeState(state);
    return state;
  };

  const removeAcknowledgedSessions = (sessions: PetRuntimeSession[]): PetRuntimeSession[] => (
    sessions.filter((session) => {
      const ackedAt = acknowledgedSessionAt.get(session.id) ?? 0;
      return ackedAt <= 0 || session.updatedAt > ackedAt;
    })
  );

  ipcMain.handle(PetIpcChannel.GetState, () => {
    return { success: true, state: buildPetRuntimeState(options.configStore, options.petStore, currentProjection) };
  });

  ipcMain.handle(PetIpcChannel.GetConfig, () => {
    return { success: true, config: options.configStore.getConfig() };
  });

  ipcMain.handle(PetIpcChannel.SetConfig, (_event, update: unknown) => {
    try {
      const current = options.configStore.getConfig();
      const updateRecord = update && typeof update === 'object' ? update as Record<string, unknown> : {};
      const normalized = normalizePetConfig({
        ...current,
        ...updateRecord,
      });
      const floatingEnabled = normalized.mode === PetMode.Floating || normalized.mode === PetMode.Both;
      const next = options.configStore.setConfig(normalized);
      const modeWasUpdated = updateRecord.mode === PetMode.Floating
        || updateRecord.mode === PetMode.Both
        || updateRecord.mode === PetMode.Embedded;
      const nextWithFloatingMode = options.configStore.setConfig({
        ...next,
        floatingWindow: {
          ...next.floatingWindow,
          enabled: floatingEnabled ? next.floatingWindow.enabled || modeWasUpdated || next.floatingWindow.visible : next.floatingWindow.enabled,
          visible: floatingEnabled ? next.floatingWindow.visible || modeWasUpdated : false,
        },
      });
      options.windowController.syncConfig(nextWithFloatingMode);
      return { success: true, config: emitState().config };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to save pet config.' };
    }
  });

  ipcMain.handle(PetIpcChannel.Refresh, () => {
    try {
      return { success: true, state: emitState() };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to refresh pets.' };
    }
  });

  ipcMain.handle(PetIpcChannel.ListPets, () => {
    return {
      success: true,
      pets: applyPetConfigToCatalog(options.petStore.listPets(), options.configStore.getConfig()),
    };
  });

  ipcMain.handle(PetIpcChannel.EnsurePet, async (_event, id: unknown) => {
    try {
      if (typeof id !== 'string' || !id.trim()) {
        throw new Error('Pet id is required.');
      }
      const configured = applyPetConfigToCatalog(options.petStore.listPets(), options.configStore.getConfig())
        .find((pet) => pet.id === id.trim());
      if (configured && !configured.selectable) {
        throw new Error(configured.error || 'Pet is not selectable.');
      }
      const pet = await options.petStore.ensurePet(id.trim());
      emitState();
      return { success: true, pet };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to load pet.' };
    }
  });

  ipcMain.handle(PetIpcChannel.SelectPet, async (_event, id: unknown) => {
    try {
      const petId = typeof id === 'string' && id.trim() ? id.trim() : DEFAULT_PET_ID;
      const config = options.configStore.getConfig();
      const currentEntry = applyPetConfigToCatalog(options.petStore.listPets(), config)
        .find((pet) => pet.id === petId);
      if (currentEntry && !currentEntry.selectable) {
        throw new Error(currentEntry.error || 'Pet is not selectable.');
      }
      if (
        config.assetPolicy === PetAssetPolicy.BundledOnly
        && !currentEntry?.installed
        && currentEntry?.source === PetSource.Downloaded
      ) {
        throw new Error('Pet downloads are disabled by asset policy.');
      }
      const pet = await options.petStore.ensurePet(petId);
      options.configStore.setConfig({
        ...config,
        enabled: true,
        selectedPetId: pet.id,
      });
      const state = emitState();
      return { success: true, pet, state };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to select pet.' };
    }
  });

  ipcMain.handle(PetIpcChannel.ImportPet, async (event, input: unknown) => {
    const currentConfig = options.configStore.getConfig();
    if (!currentConfig.customPetsEnabled) {
      return { success: false, error: 'Custom pets are disabled.' };
    }
    const owner = BrowserWindow.fromWebContents(event.sender) ?? options.getMainWindow();
    let importPath: string | undefined;
    if (input && typeof input === 'object' && typeof (input as { path?: unknown }).path === 'string') {
      importPath = (input as { path: string }).path;
    }
    if (!importPath) {
      const result = await dialog.showOpenDialog(owner ?? undefined, {
        title: t('petImportDialogTitle'),
        properties: ['openFile', 'openDirectory'],
        filters: [{ name: t('petImportDialogFilter'), extensions: ['zip', 'json'] }],
      });
      importPath = result.canceled ? undefined : result.filePaths[0];
    }
    if (!importPath) {
      return { success: true, canceled: true };
    }
    const imported = await options.petStore.importPet({ path: importPath });
    if (imported.success && imported.pet) {
      const current = options.configStore.getConfig();
      options.configStore.setConfig({
        ...current,
        customPetsEnabled: true,
        selectedPetId: imported.pet.id,
      });
      return { ...imported, state: emitState() };
    }
    return imported;
  });

  ipcMain.handle(PetIpcChannel.DeletePet, (_event, id: unknown) => {
    try {
      if (typeof id !== 'string' || !id.trim()) {
        throw new Error('Pet id is required.');
      }
      const deleted = options.petStore.deletePet(id.trim());
      if (!deleted) {
        return { success: false, error: 'Only custom pets can be deleted.' };
      }
      const current = options.configStore.getConfig();
      if (current.selectedPetId === id.trim()) {
        const nextConfig = options.configStore.getConfig();
        const fallback = applyPetConfigToCatalog(options.petStore.listPets(), nextConfig)
          .find((pet) => canSelectPetEntry(pet, nextConfig).selectable)
          ?.id ?? DEFAULT_PET_CONFIG.selectedPetId;
        options.configStore.setConfig({ ...nextConfig, selectedPetId: fallback });
      }
      return { success: true, state: emitState() };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to delete pet.' };
    }
  });

  ipcMain.handle(PetIpcChannel.SetStatus, (_event, status: unknown) => {
    const nextStatus = status === PetStatus.Running
      || status === PetStatus.Waiting
      || status === PetStatus.Review
      || status === PetStatus.Failed
      ? status
      : PetStatus.Idle;
    return { success: true, state: emitState(nextStatus) };
  });

  ipcMain.handle(PetIpcChannel.SetRuntimeProjection, (_event, input: unknown) => {
    const data = input && typeof input === 'object' ? input as Record<string, unknown> : {};
    const status = normalizePetStatus(data.status);
    const rawMessage = typeof data.message === 'string' ? data.message.trim() : '';
    const rawSession = data.session && typeof data.session === 'object'
      ? data.session as Record<string, unknown>
      : null;
    currentProjection = {
      status,
      message: rawMessage ? rawMessage.slice(0, 220) : null,
      session: rawSession && typeof rawSession.id === 'string' && rawSession.id.trim()
        ? {
          id: rawSession.id.trim(),
          title: typeof rawSession.title === 'string' && rawSession.title.trim()
            ? rawSession.title.trim()
            : rawSession.id.trim(),
        }
        : null,
      activeSessions: removeAcknowledgedSessions(normalizeActiveSessions(data.activeSessions)),
    };
    return { success: true, state: emitState(currentProjection.status) };
  });

  ipcMain.handle(PetIpcChannel.AcknowledgeSession, (_event, sessionId: unknown) => {
    const id = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!id) return { success: false, error: 'Pet session id is required.' };
    acknowledgedSessionAt.set(id, Date.now());
    currentProjection = {
      ...currentProjection,
      activeSessions: currentProjection.activeSessions.filter((session) => session.id !== id),
    };
    return { success: true, state: emitState() };
  });

  ipcMain.handle(PetIpcChannel.SetFloatingVisible, (_event, visible: unknown) => {
    const config = options.windowController.setVisible(visible === true);
    return { success: true, config, state: emitState() };
  });

  ipcMain.handle(PetIpcChannel.ActivateMainWindow, () => {
    options.showMainWindow();
    const win = options.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('app:openPetSession', currentProjection.session);
    }
    return { success: true };
  });

  ipcMain.handle(PetIpcChannel.ActivateSession, (_event, sessionId: unknown) => {
    const id = typeof sessionId === 'string' ? sessionId.trim() : '';
    options.showMainWindow();
    const win = options.getMainWindow();
    if (win && !win.isDestroyed()) {
      const session = id
        ? currentProjection.activeSessions.find((item) => item.id === id) ?? { id, title: id }
        : currentProjection.session;
      win.webContents.send('app:openPetSession', session);
    }
    return { success: true };
  });

  ipcMain.handle(PetIpcChannel.MoveFloatingWindowBy, (_event, delta: unknown) => {
    const data = delta && typeof delta === 'object' ? delta as Record<string, unknown> : {};
    const deltaX = typeof data.deltaX === 'number' ? data.deltaX : 0;
    const deltaY = typeof data.deltaY === 'number' ? data.deltaY : 0;
    options.windowController.moveBy(deltaX, deltaY);
    return { success: true };
  });

  ipcMain.handle(PetIpcChannel.PersistFloatingWindowPosition, () => {
    options.windowController.persistPosition();
    return { success: true };
  });

  ipcMain.handle(PetIpcChannel.SetFloatingActivityOpen, (_event, open: unknown) => {
    options.windowController.setActivityOpen(open === true);
    return { success: true };
  });

  ipcMain.handle(PetIpcChannel.OpenSettings, () => {
    const win = options.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('app:openSettings', { initialTab: 'general', section: 'pet' });
      if (!win.isVisible()) win.show();
      win.focus();
    }
    return { success: true };
  });

  emitState();
  return { emitState };
}
