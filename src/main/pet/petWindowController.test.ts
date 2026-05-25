import { describe, expect, test, vi } from 'vitest';

const mockElectron = vi.hoisted(() => {
  class MockBrowserWindow {
    bounds: Electron.Rectangle;
    readonly webContents = {
      send: vi.fn(),
    };

    constructor(options: Electron.BrowserWindowConstructorOptions) {
      this.bounds = {
        x: options.x ?? 0,
        y: options.y ?? 0,
        width: options.width ?? 0,
        height: options.height ?? 0,
      };
      state.windows.push(this);
    }

    isDestroyed(): boolean {
      return false;
    }

    getBounds(): Electron.Rectangle {
      return { ...this.bounds };
    }

    setBounds(bounds: Electron.Rectangle): void {
      this.bounds = { ...bounds };
    }

    close(): void {}

    setVisibleOnAllWorkspaces(): void {}

    setAlwaysOnTop(): void {}

    setMenu(): void {}

    showInactive(): void {}

    once(_eventName: string, callback: () => void): void {
      callback();
    }

    on(): void {}

    loadFile(): void {}

    loadURL(): Promise<void> {
      return Promise.resolve();
    }
  }

  const state = {
    BrowserWindow: MockBrowserWindow,
    windows: [] as MockBrowserWindow[],
    workArea: { x: 0, y: 0, width: 1200, height: 800 },
  };
  return state;
});

vi.mock('electron', () => ({
  BrowserWindow: mockElectron.BrowserWindow,
  screen: {
    getAllDisplays: () => [{ id: 1, workArea: mockElectron.workArea }],
    getPrimaryDisplay: () => ({ id: 1, workArea: mockElectron.workArea }),
    getDisplayMatching: () => ({ id: 1, workArea: mockElectron.workArea }),
  },
}));

import { DEFAULT_PET_CONFIG } from '../../shared/pet/config';
import { PetMode, PetSource, PetStatus } from '../../shared/pet/constants';
import type { PetConfig, PetRuntimeState } from '../../shared/pet/types';
import { PetWindowController } from './petWindowController';

const createConfigStore = (config: PetConfig) => ({
  config,
  getConfig() {
    return this.config;
  },
  setConfig(update: Partial<PetConfig>) {
    this.config = {
      ...this.config,
      ...update,
      floatingWindow: {
        ...this.config.floatingWindow,
        ...(update.floatingWindow ?? {}),
      },
    };
    return this.config;
  },
});

const createRuntimeState = (config: PetConfig, activeSessionCount: number): PetRuntimeState => ({
  config,
  status: PetStatus.Running,
  message: null,
  session: null,
  activePet: {
    id: 'codex',
    displayName: 'Codex',
    description: 'Codex pet',
    source: PetSource.Bundled,
    bundled: true,
    installed: true,
    selectable: true,
  },
  pets: [],
  activeSessions: Array.from({ length: activeSessionCount }, (_, index) => ({
    id: `session-${index + 1}`,
    title: `Session ${index + 1}`,
    status: PetStatus.Running,
    message: null,
    progressLabel: 'Loading',
    updatedAt: index + 1,
  })),
});

describe('PetWindowController floating activity bounds', () => {
  test('shrinks the transparent floating window back to the pet while keeping the right edge anchored', () => {
    mockElectron.windows = [];
    const config: PetConfig = {
      ...DEFAULT_PET_CONFIG,
      enabled: true,
      mode: PetMode.Floating,
      floatingWindow: {
        ...DEFAULT_PET_CONFIG.floatingWindow,
        enabled: true,
        visible: true,
        x: 900,
        y: 100,
        width: 180,
        height: 190,
      },
    };
    const store = createConfigStore(config);
    const controller = new PetWindowController(store, {
      preloadPath: '/tmp/preload.js',
      isDev: false,
    });

    controller.setRuntimeState(createRuntimeState(config, 2));
    const window = mockElectron.windows[0];
    expect(window.getBounds()).toMatchObject({ x: 770, y: 100, width: 430, height: 320 });

    controller.setActivityOpen(false);

    expect(window.getBounds()).toMatchObject({ x: 1020, y: 100, width: 180, height: 190 });
  });
});
