import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { AppUpdateSource } from '../../shared/appUpdate/constants';

const mockElectronState = vi.hoisted(() => ({
  userDataDir: '',
  fetchImpl: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock('child_process', () => ({
  exec: vi.fn(),
  spawn: mocks.spawn,
}));

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return mockElectronState.userDataDir;
      if (name === 'temp') return os.tmpdir();
      return os.tmpdir();
    },
    quit: vi.fn(),
  },
  session: {
    defaultSession: {
      fetch: (...args: unknown[]) => mockElectronState.fetchImpl(...args),
    },
  },
}));

import {
  buildWindowsUpdateLauncherArgs,
  cancelActiveDownload,
  downloadUpdate,
  spawnDetachedWindowsUpdateLauncher,
} from './appUpdateInstaller';

function createResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'content-length': String(Buffer.byteLength(body)),
    },
  });
}

function createChildProcess(pid = 1234): EventEmitter & { pid?: number; unref: () => void } {
  const child = new EventEmitter() as EventEmitter & { pid?: number; unref: () => void };
  child.pid = pid;
  child.unref = vi.fn();
  return child;
}

describe('appUpdateInstaller download paths', () => {
  beforeEach(() => {
    mockElectronState.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-update-installer-'));
    mockElectronState.fetchImpl.mockReset();
    mockElectronState.fetchImpl.mockResolvedValue(createResponse('installer'));
    mocks.spawn.mockReset();
  });

  afterEach(() => {
    cancelActiveDownload();
    fs.rmSync(mockElectronState.userDataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  test('stores legacy manual downloads in the app update cache', async () => {
    const filePath = await downloadUpdate('https://example.com/JBPClaw.dmg', () => {});

    expect(filePath).toContain(path.join(mockElectronState.userDataDir, 'updates'));
    expect(path.basename(filePath)).toMatch(/^lobsterai-update-manual-\d+\.dmg$/);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('installer');
  });

  test('stores source-scoped auto downloads in the app update cache', async () => {
    const filePath = await downloadUpdate('https://example.com/JBPClaw.exe', AppUpdateSource.Auto, () => {});

    expect(filePath).toContain(path.join(mockElectronState.userDataDir, 'updates'));
    expect(path.basename(filePath)).toMatch(/^lobsterai-update-auto-\d+\.exe$/);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('installer');
  });
});

describe('Windows update launcher', () => {
  beforeEach(() => {
    mocks.spawn.mockReset();
  });

  test('builds hidden PowerShell launcher arguments', () => {
    expect(buildWindowsUpdateLauncherArgs('C:\\Temp\\lobsterai update.ps1')).toEqual([
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-WindowStyle',
      'Hidden',
      '-File',
      'C:\\Temp\\lobsterai update.ps1',
    ]);
  });

  test('spawns detached hidden PowerShell and resolves after the process starts', async () => {
    const child = createChildProcess(4321);
    mocks.spawn.mockReturnValue(child);

    const result = spawnDetachedWindowsUpdateLauncher('C:\\Temp\\lobsterai update.ps1');

    expect(mocks.spawn).toHaveBeenCalledWith(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-WindowStyle',
        'Hidden',
        '-File',
        'C:\\Temp\\lobsterai update.ps1',
      ],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      },
    );

    child.emit('spawn');

    await expect(result).resolves.toBe(4321);
    expect(child.unref).toHaveBeenCalledOnce();
  });

  test('rejects when PowerShell spawn throws synchronously', async () => {
    const error = new Error('powershell is unavailable');
    mocks.spawn.mockImplementation(() => {
      throw error;
    });

    await expect(spawnDetachedWindowsUpdateLauncher('C:\\Temp\\update.ps1')).rejects.toBe(error);
  });

  test('rejects when PowerShell emits a launch error', async () => {
    const child = createChildProcess();
    const error = new Error('blocked by policy');
    mocks.spawn.mockReturnValue(child);

    const result = spawnDetachedWindowsUpdateLauncher('C:\\Temp\\update.ps1');
    child.emit('error', error);

    await expect(result).rejects.toBe(error);
    expect(child.unref).not.toHaveBeenCalled();
  });
});
