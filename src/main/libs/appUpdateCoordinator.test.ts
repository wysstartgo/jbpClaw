import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mockElectronState = vi.hoisted(() => ({
  userDataDir: '',
  version: '2026.5.1',
  fetchImpl: vi.fn(),
  windows: [] as Array<{ isDestroyed: () => boolean; webContents: { send: ReturnType<typeof vi.fn> } }>,
}));

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return mockElectronState.userDataDir;
      return os.tmpdir();
    },
    getVersion: () => mockElectronState.version,
  },
  BrowserWindow: {
    getAllWindows: () => mockElectronState.windows,
  },
  session: {
    defaultSession: {
      fetch: (...args: unknown[]) => mockElectronState.fetchImpl(...args),
    },
  },
}));

import { type AppUpdateInfo,AppUpdateSource, AppUpdateStatus } from '../../shared/appUpdate/constants';
import { KeyfromStoreKey } from '../../shared/keyfrom';
import { AppUpdateCoordinator } from './appUpdateCoordinator';

const readyKey = (source: string) => `app_update_ready_file:${source}`;

function createStore(initialValues: Record<string, unknown> = {}) {
  const values = new Map<string, unknown>(Object.entries(initialValues));
  return {
    values,
    store: {
      get: <T,>(key: string): T | undefined => values.get(key) as T | undefined,
      set: (key: string, value: unknown) => {
        values.set(key, value);
      },
      delete: (key: string) => {
        values.delete(key);
      },
    },
  };
}

function createUpdateInfo(version: string): AppUpdateInfo {
  return {
    latestVersion: version,
    date: '2026-05-09',
    changeLog: {
      zh: { title: '更新', content: ['修复问题'] },
      en: { title: 'Update', content: ['Bug fixes'] },
    },
    url: 'https://example.com/update.dmg',
  };
}

describe('AppUpdateCoordinator ready state restore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-update-coordinator-'));
    mockElectronState.userDataDir = tmpDir;
    mockElectronState.version = '2026.5.1';
    mockElectronState.fetchImpl.mockReset();
    mockElectronState.windows = [];
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  test('starts idle when no ready installer record exists', () => {
    const { store } = createStore();
    const coordinator = new AppUpdateCoordinator(store as never);

    expect(coordinator.getState().status).toBe(AppUpdateStatus.Idle);
    expect(coordinator.getUpdateCacheDir()).toBe(path.join(tmpDir, 'updates'));
  });

  test('restores a newer manual ready installer from the store', () => {
    const installerPath = path.join(tmpDir, 'updates', 'lobsterai-update-manual-1.dmg');
    fs.mkdirSync(path.dirname(installerPath), { recursive: true });
    fs.writeFileSync(installerPath, 'installer');
    const info = createUpdateInfo('2026.5.2');
    const { store } = createStore({
      [readyKey(AppUpdateSource.Manual)]: {
        version: info.latestVersion,
        filePath: installerPath,
        fileHash: 'hash',
        info,
      },
    });

    const coordinator = new AppUpdateCoordinator(store as never);
    const state = coordinator.getState();

    expect(state.status).toBe(AppUpdateStatus.Ready);
    expect(state.source).toBe(AppUpdateSource.Manual);
    expect(state.info?.latestVersion).toBe('2026.5.2');
    expect(state.readyFilePath).toBe(installerPath);
  });

  test('clears stale ready installer records that are not newer than current version', () => {
    const installerPath = path.join(tmpDir, 'updates', 'lobsterai-update-auto-1.dmg');
    fs.mkdirSync(path.dirname(installerPath), { recursive: true });
    fs.writeFileSync(installerPath, 'installer');
    const { store, values } = createStore({
      [readyKey(AppUpdateSource.Auto)]: {
        version: '2026.5.1',
        filePath: installerPath,
        fileHash: 'hash',
      },
    });

    const coordinator = new AppUpdateCoordinator(store as never);

    expect(coordinator.getState().status).toBe(AppUpdateStatus.Idle);
    expect(values.has(readyKey(AppUpdateSource.Auto))).toBe(false);
  });

  test('clears ready installer records when the file is missing', () => {
    const missingPath = path.join(tmpDir, 'updates', 'missing.dmg');
    const { store, values } = createStore({
      [readyKey(AppUpdateSource.Manual)]: {
        version: '2026.5.2',
        filePath: missingPath,
        fileHash: 'hash',
      },
    });

    const coordinator = new AppUpdateCoordinator(store as never);

    expect(coordinator.getState().status).toBe(AppUpdateStatus.Idle);
    expect(values.has(readyKey(AppUpdateSource.Manual))).toBe(false);
  });
});

describe('AppUpdateCoordinator manual check', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-update-check-'));
    mockElectronState.userDataDir = tmpDir;
    mockElectronState.version = '2026.5.1';
    mockElectronState.fetchImpl.mockReset();
    mockElectronState.windows = [];
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  test('manual check reports available update without downloading', async () => {
    mockElectronState.fetchImpl.mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data: {
        value: {
          version: '2026.5.2',
          date: '2026-05-09',
          changeLog: {
            ch: { title: '更新', content: ['修复问题'] },
            en: { title: 'Update', content: ['Bug fixes'] },
          },
          macArm: { url: 'https://example.com/QingShuClaw.dmg' },
        },
      },
    }), { status: 200 }));
    const { store, values } = createStore({ installation_uuid: 'uuid-test' });
    const coordinator = new AppUpdateCoordinator(store as never);

    const result = await coordinator.checkNow({ manual: true, userId: 'user-1' });

    expect(result.success).toBe(true);
    expect(result.updateFound).toBe(true);
    expect(result.state.status).toBe(AppUpdateStatus.Available);
    expect(result.state.source).toBe(AppUpdateSource.Manual);
    expect(result.state.info?.latestVersion).toBe('2026.5.2');
    expect(result.state.readyFilePath).toBeNull();
    expect(values.get('installation_uuid')).toBe('uuid-test');
    const requestedUrl = String(mockElectronState.fetchImpl.mock.calls[0][0]);
    expect(requestedUrl).toContain('uuid=uuid-test');
    expect(requestedUrl).toContain('userId=user-1');
    expect(requestedUrl).toContain('version=2026.5.1');
    expect(requestedUrl).toContain('firstKeyfrom=official');
    expect(requestedUrl).toContain('latestKeyfrom=official');
    expect(values.get(KeyfromStoreKey.Attribution)).toMatchObject({
      firstKeyfrom: 'official',
      latestKeyfrom: 'official',
    });
  });

  test('manual check preserves first keyfrom and sends latest keyfrom', async () => {
    mockElectronState.fetchImpl.mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data: {
        value: {
          version: '2026.5.2',
          macArm: { url: 'https://example.com/QingShuClaw.dmg' },
        },
      },
    }), { status: 200 }));
    const { store, values } = createStore({
      installation_uuid: 'uuid-test',
      [KeyfromStoreKey.Attribution]: {
        firstKeyfrom: 'partner_a',
        latestKeyfrom: 'partner_b',
        updatedAt: 1,
      },
    });
    const coordinator = new AppUpdateCoordinator(store as never);

    await coordinator.checkNow({ manual: true });

    const requestedUrl = String(mockElectronState.fetchImpl.mock.calls[0][0]);
    expect(requestedUrl).toContain('firstKeyfrom=partner_a');
    expect(requestedUrl).toContain('latestKeyfrom=official');
    expect(values.get(KeyfromStoreKey.Attribution)).toMatchObject({
      firstKeyfrom: 'partner_a',
      latestKeyfrom: 'official',
    });
  });

  test('emits state changes to active windows', async () => {
    const send = vi.fn();
    mockElectronState.windows = [{
      isDestroyed: () => false,
      webContents: { send },
    }];
    mockElectronState.fetchImpl.mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data: {
        value: {
          version: '2026.5.2',
          macArm: { url: 'https://example.com/QingShuClaw.dmg' },
        },
      },
    }), { status: 200 }));
    const { store } = createStore();
    const coordinator = new AppUpdateCoordinator(store as never);

    await coordinator.checkNow({ manual: true });

    expect(send).toHaveBeenCalledWith('appUpdate:stateChanged', expect.objectContaining({
      status: AppUpdateStatus.Available,
      source: AppUpdateSource.Manual,
    }));
  });

  test('manual check returns idle when no newer version is available', async () => {
    mockElectronState.fetchImpl.mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      data: { value: { version: '2026.5.1' } },
    }), { status: 200 }));
    const { store } = createStore();
    const coordinator = new AppUpdateCoordinator(store as never);

    const result = await coordinator.checkNow({ manual: true });

    expect(result.success).toBe(true);
    expect(result.updateFound).toBe(false);
    expect(result.state.status).toBe(AppUpdateStatus.Idle);
    expect(result.state.source).toBe(AppUpdateSource.Manual);
  });

  test('setAvailableUpdate registers a renderer-discovered update', () => {
    const { store } = createStore();
    const coordinator = new AppUpdateCoordinator(store as never);
    const info = createUpdateInfo('2026.5.2');

    const state = coordinator.setAvailableUpdate(info, AppUpdateSource.Manual);

    expect(state.status).toBe(AppUpdateStatus.Available);
    expect(state.source).toBe(AppUpdateSource.Manual);
    expect(state.info?.latestVersion).toBe('2026.5.2');
    expect(state.readyFilePath).toBeNull();
  });

  test('setAvailableUpdate does not interrupt an active download', async () => {
    let releaseDownload!: () => void;
    mockElectronState.fetchImpl
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: {
          value: {
            version: '2026.5.2',
            macArm: { url: 'https://example.com/QingShuClaw.dmg' },
          },
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('partial'));
          releaseDownload = () => controller.close();
        },
      }), {
        status: 200,
        headers: {
          'content-length': '100',
        },
      }));
    const { store } = createStore();
    const coordinator = new AppUpdateCoordinator(store as never);
    await coordinator.checkNow({ manual: true });
    const downloadPromise = coordinator.retryDownload();
    await vi.waitFor(() => {
      expect(coordinator.getState().status).toBe(AppUpdateStatus.Downloading);
    });

    const state = coordinator.setAvailableUpdate(createUpdateInfo('2026.5.3'), AppUpdateSource.Manual);
    coordinator.cancelDownload();
    releaseDownload();
    await downloadPromise;

    expect(state.status).toBe(AppUpdateStatus.Downloading);
    expect(state.info?.latestVersion).toBe('2026.5.2');
  });

  test('manual check is disabled by enterprise config', async () => {
    const { store } = createStore({
      enterprise_config: { disableUpdate: true },
    });
    const coordinator = new AppUpdateCoordinator(store as never);

    const result = await coordinator.checkNow({ manual: true });

    expect(result.success).toBe(true);
    expect(result.updateFound).toBe(false);
    expect(result.state.status).toBe(AppUpdateStatus.Idle);
    expect(result.state.source).toBe(AppUpdateSource.Manual);
    expect(mockElectronState.fetchImpl).not.toHaveBeenCalled();
  });

  test('retryDownload downloads an available update and persists ready state', async () => {
    mockElectronState.fetchImpl
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: {
          value: {
            version: '2026.5.2',
            macArm: { url: 'https://example.com/QingShuClaw.dmg' },
          },
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response('installer', {
        status: 200,
        headers: {
          'content-length': String(Buffer.byteLength('installer')),
        },
      }));
    const { store, values } = createStore({ installation_uuid: 'uuid-test' });
    const coordinator = new AppUpdateCoordinator(store as never);
    await coordinator.checkNow({ manual: true });

    const state = await coordinator.retryDownload();

    expect(state.status).toBe(AppUpdateStatus.Ready);
    expect(state.source).toBe(AppUpdateSource.Manual);
    expect(state.readyFilePath).toContain(path.join(tmpDir, 'updates'));
    expect(state.readyFileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.readFileSync(state.readyFilePath!, 'utf8')).toBe('installer');
    const persisted = values.get(readyKey(AppUpdateSource.Manual)) as { version?: string; filePath?: string } | undefined;
    expect(persisted?.version).toBe('2026.5.2');
    expect(persisted?.filePath).toBe(state.readyFilePath);
  });

  test('auto check predownloads a direct installer and marks the ready modal for opening', async () => {
    mockElectronState.fetchImpl
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: {
          value: {
            version: '2026.5.2',
            macArm: { url: 'https://example.com/QingShuClaw.dmg' },
          },
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response('installer', {
        status: 200,
        headers: {
          'content-length': String(Buffer.byteLength('installer')),
        },
      }));
    const { store, values } = createStore({ installation_uuid: 'uuid-test' });
    const coordinator = new AppUpdateCoordinator(store as never);

    const result = await coordinator.checkNow({ manual: false });

    expect(result.success).toBe(true);
    expect(result.updateFound).toBe(true);
    await vi.waitFor(() => {
      expect(coordinator.getState().status).toBe(AppUpdateStatus.Ready);
    });
    expect(coordinator.getState().source).toBe(AppUpdateSource.Auto);
    expect(coordinator.shouldAutoOpenReadyModal()).toBe(true);
    coordinator.consumeAutoOpenReadyModal();
    expect(coordinator.shouldAutoOpenReadyModal()).toBe(false);
    const persisted = values.get(readyKey(AppUpdateSource.Auto)) as { version?: string; filePath?: string } | undefined;
    expect(persisted?.version).toBe('2026.5.2');
    expect(persisted?.filePath).toContain(path.join(tmpDir, 'updates'));
  });

  test('auto check keeps invalid installer urls available instead of failing', async () => {
    mockElectronState.fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify({
      code: 0,
      data: {
        value: {
          version: '2026.5.2',
          macArm: { url: 'not a valid url' },
        },
      },
    }), { status: 200 }));
    const { store } = createStore({ installation_uuid: 'uuid-test' });
    const coordinator = new AppUpdateCoordinator(store as never);

    const result = await coordinator.checkNow({ manual: false });

    expect(result.success).toBe(true);
    expect(result.updateFound).toBe(true);
    expect(result.state.status).toBe(AppUpdateStatus.Available);
    expect(result.state.source).toBe(AppUpdateSource.Auto);
    expect(result.state.readyFilePath).toBeNull();
    expect(result.state.errorMessage).toBeNull();
    expect(mockElectronState.fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('checkNow reuses an already downloaded ready installer for the same version', async () => {
    mockElectronState.fetchImpl
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: {
          value: {
            version: '2026.5.2',
            macArm: { url: 'https://example.com/QingShuClaw.dmg' },
          },
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response('installer', {
        status: 200,
        headers: {
          'content-length': String(Buffer.byteLength('installer')),
        },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: {
          value: {
            version: '2026.5.2',
            macArm: { url: 'https://example.com/QingShuClaw.dmg' },
          },
        },
      }), { status: 200 }));
    const { store } = createStore({ installation_uuid: 'uuid-test' });
    const coordinator = new AppUpdateCoordinator(store as never);
    await coordinator.checkNow({ manual: true });
    const readyState = await coordinator.retryDownload();

    const second = await coordinator.checkNow({ manual: true });

    expect(second.success).toBe(true);
    expect(second.updateFound).toBe(true);
    expect(second.state.status).toBe(AppUpdateStatus.Ready);
    expect(second.state.readyFilePath).toBe(readyState.readyFilePath);
    expect(mockElectronState.fetchImpl).toHaveBeenCalledTimes(3);
  });

  test('cancelDownload restores available state during an active download', async () => {
    let releaseDownload!: () => void;
    mockElectronState.fetchImpl
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: {
          value: {
            version: '2026.5.2',
            macArm: { url: 'https://example.com/QingShuClaw.dmg' },
          },
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('partial'));
          releaseDownload = () => controller.close();
        },
      }), {
        status: 200,
        headers: {
          'content-length': '100',
        },
      }));
    const { store } = createStore({ installation_uuid: 'uuid-test' });
    const coordinator = new AppUpdateCoordinator(store as never);
    await coordinator.checkNow({ manual: true });

    const downloadPromise = coordinator.retryDownload();
    await vi.waitFor(() => {
      expect(coordinator.getState().status).toBe(AppUpdateStatus.Downloading);
    });
    const cancelledState = coordinator.cancelDownload();
    releaseDownload();
    await downloadPromise;

    expect(cancelledState.status).toBe(AppUpdateStatus.Available);
    expect(cancelledState.info?.latestVersion).toBe('2026.5.2');
    expect(cancelledState.progress).toBeNull();
    expect(cancelledState.readyFilePath).toBeNull();
  });
});
