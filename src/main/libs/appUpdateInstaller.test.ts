import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { AppUpdateSource } from '../../shared/appUpdate/constants';

const mockElectronState = vi.hoisted(() => ({
  userDataDir: '',
  fetchImpl: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return mockElectronState.userDataDir;
      if (name === 'temp') return os.tmpdir();
      return os.tmpdir();
    },
  },
  session: {
    defaultSession: {
      fetch: (...args: unknown[]) => mockElectronState.fetchImpl(...args),
    },
  },
}));

import { cancelActiveDownload, downloadUpdate } from './appUpdateInstaller';

function createResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'content-length': String(Buffer.byteLength(body)),
    },
  });
}

describe('appUpdateInstaller download paths', () => {
  beforeEach(() => {
    mockElectronState.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-update-installer-'));
    mockElectronState.fetchImpl.mockReset();
    mockElectronState.fetchImpl.mockResolvedValue(createResponse('installer'));
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
