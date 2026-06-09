import { BrowserWindow, screen } from 'electron';
import path from 'path';

import { PetIpcChannel, PetMode, PetRendererRoute, PetStatus } from '../../shared/pet/constants';
import type { PetConfig, PetRuntimeState } from '../../shared/pet/types';
import { PetConfigStore } from './petConfigStore';

type CreateWindowOptions = {
  preloadPath: string;
  devServerUrl?: string;
  isDev: boolean;
};

const FLOATING_WINDOW_SIZE_LIMITS = {
  minWidth: 120,
  minHeight: 120,
  maxWidth: 520,
  maxHeight: 520,
} as const;

export class PetWindowController {
  private window: BrowserWindow | null = null;
  private latestState: PetRuntimeState | null = null;
  private activityOpen = true;
  private ignoresMouseEvents = false;

  constructor(
    private readonly configStore: PetConfigStore,
    private readonly options: CreateWindowOptions,
  ) {}

  syncConfig(config: PetConfig): void {
    if (!this.shouldShowFloatingWindow(config)) {
      this.close();
      return;
    }
    this.ensureWindow(config);
    this.sendState();
  }

  setRuntimeState(state: PetRuntimeState): void {
    const previousBounds = this.window && !this.window.isDestroyed()
      ? this.resolveBounds(this.latestState?.config ?? state.config)
      : null;
    this.latestState = state;
    this.syncConfig(state.config);
    const nextBounds = this.window && !this.window.isDestroyed()
      ? this.resolveBounds(state.config)
      : null;
    if (
      this.window
      && !this.window.isDestroyed()
      && previousBounds
      && nextBounds
      && (previousBounds.width !== nextBounds.width || previousBounds.height !== nextBounds.height)
    ) {
      this.window.setBounds(this.anchorNextBoundsToPreviousRight(previousBounds, nextBounds));
    }
    this.sendState();
  }

  setActivityOpen(open: boolean): void {
    this.activityOpen = open;
    if (!this.window || this.window.isDestroyed() || !this.latestState) return;
    const previousBounds = this.window.getBounds();
    const nextBounds = this.resolveBounds(this.latestState.config);
    if (previousBounds.width === nextBounds.width && previousBounds.height === nextBounds.height) return;
    this.window.setBounds(this.anchorNextBoundsToPreviousRight(previousBounds, nextBounds));
  }

  setIgnoresMouseEvents(ignores: boolean): void {
    this.ignoresMouseEvents = ignores;
    if (!this.window || this.window.isDestroyed()) return;
    this.window.setIgnoreMouseEvents(ignores, { forward: true });
  }

  setVisible(visible: boolean): PetConfig {
    const current = this.configStore.getConfig();
    const next = this.configStore.setConfig({
      mode: visible && current.mode === PetMode.Embedded ? PetMode.Both : current.mode,
      floatingWindow: {
        ...current.floatingWindow,
        enabled: visible || current.floatingWindow.enabled,
        visible,
      },
    });
    this.syncConfig(next);
    return next;
  }

  getWindow(): BrowserWindow | null {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }

  close(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.close();
    }
    this.window = null;
  }

  moveBy(deltaX: number, deltaY: number): void {
    if (!this.window || this.window.isDestroyed()) return;
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;
    const bounds = this.window.getBounds();
    const nextBounds = this.clampBounds({
      ...bounds,
      x: bounds.x + Math.round(deltaX),
      y: bounds.y + Math.round(deltaY),
    });
    this.window.setBounds(nextBounds);
  }

  resizeBy(deltaX: number, deltaY: number): PetConfig {
    const current = this.configStore.getConfig();
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return current;
    const previousBounds = this.window && !this.window.isDestroyed()
      ? this.window.getBounds()
      : null;
    const baseWidth = previousBounds?.width ?? current.floatingWindow.width;
    const baseHeight = previousBounds?.height ?? current.floatingWindow.height;
    const nextWidth = this.clampSize(baseWidth + Math.round(deltaX), FLOATING_WINDOW_SIZE_LIMITS.minWidth, FLOATING_WINDOW_SIZE_LIMITS.maxWidth);
    const nextHeight = this.clampSize(baseHeight + Math.round(deltaY), FLOATING_WINDOW_SIZE_LIMITS.minHeight, FLOATING_WINDOW_SIZE_LIMITS.maxHeight);
    const next = this.configStore.setConfig({
      floatingWindow: {
        ...current.floatingWindow,
        width: nextWidth,
        height: nextHeight,
      },
    });
    if (this.latestState) {
      this.latestState = { ...this.latestState, config: next };
    }
    this.syncConfig(next);
    if (this.window && !this.window.isDestroyed() && previousBounds) {
      const resolvedBounds = this.resolveBounds(next);
      this.window.setBounds(this.clampBounds({
        ...previousBounds,
        width: resolvedBounds.width,
        height: resolvedBounds.height,
      }));
      this.persistBounds();
    }
    this.sendState();
    return next;
  }

  persistPosition(): void {
    this.persistBounds();
  }

  private ensureWindow(config: PetConfig): void {
    if (this.window && !this.window.isDestroyed()) {
      return;
    }

    const bounds = this.resolveBounds(config);
    this.window = new BrowserWindow({
      ...bounds,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      alwaysOnTop: true,
      focusable: false,
      skipTaskbar: true,
      show: false,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: this.options.preloadPath,
        backgroundThrottling: false,
      },
    });

    this.window.setAlwaysOnTop(true, 'floating');
    this.window.setIgnoreMouseEvents(this.ignoresMouseEvents, { forward: true });
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.window.setMenu(null);
    this.window.once('ready-to-show', () => {
      this.window?.showInactive();
      this.sendState();
    });
    this.window.on('moved', () => this.persistBounds());
    this.window.on('closed', () => {
      this.window = null;
    });

    if (this.options.isDev && this.options.devServerUrl) {
      this.window.loadURL(`${this.options.devServerUrl}#${PetRendererRoute.Floating}`).catch((error) => {
        console.error('[PetWindow] failed to load dev URL:', error);
      });
    } else {
      this.window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: PetRendererRoute.Floating });
    }
  }

  private resolveBounds(config: PetConfig): Electron.Rectangle {
    const displays = screen.getAllDisplays();
    const configuredDisplay = config.floatingWindow.displayId
      ? displays.find((display) => String(display.id) === config.floatingWindow.displayId)
      : undefined;
    const workArea = configuredDisplay?.workArea ?? screen.getPrimaryDisplay().workArea;
    const activeSessionCount = this.activityOpen ? this.latestState?.activeSessions.length ?? 0 : 0;
    const width = activeSessionCount > 0
      ? Math.max(config.floatingWindow.width, 430)
      : config.floatingWindow.width;
    const height = activeSessionCount > 0
      ? Math.max(config.floatingWindow.height, 320)
      : config.floatingWindow.height;
    const rawX = typeof config.floatingWindow.x === 'number'
      ? config.floatingWindow.x
      : workArea.x + workArea.width - width - 32;
    const rawY = typeof config.floatingWindow.y === 'number'
      ? config.floatingWindow.y
      : workArea.y + workArea.height - height - 72;
    const x = Math.min(Math.max(rawX, workArea.x), workArea.x + workArea.width - width);
    const y = Math.min(Math.max(rawY, workArea.y), workArea.y + workArea.height - height);
    return { x, y, width, height };
  }

  private clampBounds(bounds: Electron.Rectangle): Electron.Rectangle {
    const workArea = screen.getDisplayMatching(bounds).workArea;
    const x = Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - bounds.width);
    const y = Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - bounds.height);
    return { ...bounds, x, y };
  }

  private clampSize(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  private anchorNextBoundsToPreviousRight(
    previousBounds: Electron.Rectangle,
    nextBounds: Electron.Rectangle,
  ): Electron.Rectangle {
    return this.clampBounds({
      ...nextBounds,
      x: previousBounds.x + previousBounds.width - nextBounds.width,
      y: previousBounds.y,
    });
  }

  private shouldShowFloatingWindow(config: PetConfig): boolean {
    return config.enabled
      && config.floatingWindow.enabled
      && config.floatingWindow.visible
      && (config.mode === PetMode.Floating || config.mode === PetMode.Both);
  }

  private persistBounds(): void {
    if (!this.window || this.window.isDestroyed()) return;
    const bounds = this.window.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const current = this.configStore.getConfig();
    const next = this.configStore.setConfig({
      floatingWindow: {
        ...current.floatingWindow,
        displayId: String(display.id),
        x: bounds.x,
        y: bounds.y,
        width: current.floatingWindow.width,
        height: current.floatingWindow.height,
      },
    });
    if (this.latestState) {
      this.latestState = {
        ...this.latestState,
        config: next,
      };
      this.sendState();
    }
  }

  private sendState(): void {
    if (!this.window || this.window.isDestroyed() || !this.latestState) return;
    this.window.webContents.send(PetIpcChannel.StateChanged, {
      ...this.latestState,
      status: this.latestState.status || PetStatus.Idle,
    });
  }
}
