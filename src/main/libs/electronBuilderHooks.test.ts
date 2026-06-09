import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  __test__: {
    buildMacosGeneratedHelpers,
    getOpenClawRuntimeBuildHint,
    removeAllBinDirsInCfmind,
    resolveOpenClawRuntimeTargetId,
    verifyPreinstalledPlugins,
  },
} = require('../../../scripts/electron-builder-hooks.cjs');

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeTempPackageJson(payload: unknown): string {
  const packageRoot = makeTempDir('electron-builder-package-');
  const packageJsonPath = path.join(packageRoot, 'package.json');
  fs.writeFileSync(packageJsonPath, JSON.stringify(payload), 'utf8');
  return packageJsonPath;
}

describe('electron-builder hooks OpenClaw plugin verification', () => {
  test('logs only required plugin entries as verified', () => {
    const runtimeRoot = makeTempDir('electron-builder-runtime-');
    fs.mkdirSync(path.join(runtimeRoot, 'third-party-extensions', 'required-plugin'), { recursive: true });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const packageJsonPath = writeTempPackageJson({
      openclaw: {
        plugins: [
          {},
          { id: '' },
          { id: 'required-plugin' },
          { id: 'optional-plugin', optional: true },
        ],
      },
    });

    verifyPreinstalledPlugins(runtimeRoot, 'npm run openclaw:runtime:host', { packageJsonPath });

    expect(logSpy).toHaveBeenCalledWith(
      '[electron-builder-hooks] Verified 1 required preinstalled OpenClaw plugin(s).',
    );
  });

  test('skips verification when package metadata cannot be read', () => {
    const runtimeRoot = makeTempDir('electron-builder-runtime-');
    const packageRoot = makeTempDir('electron-builder-package-');
    const malformedPackageJsonPath = path.join(packageRoot, 'package.json');
    const missingPackageJsonPath = path.join(packageRoot, 'missing-package.json');

    fs.writeFileSync(malformedPackageJsonPath, '{ not valid json', 'utf8');

    expect(() => verifyPreinstalledPlugins(runtimeRoot, 'npm run openclaw:runtime:host', {
      packageJsonPath: malformedPackageJsonPath,
    })).not.toThrow();
    expect(() => verifyPreinstalledPlugins(runtimeRoot, 'npm run openclaw:runtime:host', {
      packageJsonPath: missingPackageJsonPath,
    })).not.toThrow();
  });

  test('ignores optional plugins when verifying preinstalled OpenClaw plugins', () => {
    const runtimeRoot = makeTempDir('electron-builder-runtime-');
    fs.mkdirSync(path.join(runtimeRoot, 'third-party-extensions', 'required-plugin'), { recursive: true });

    const packageJsonPath = writeTempPackageJson({
      openclaw: {
        plugins: [
          { id: 'required-plugin' },
          { id: 'optional-plugin', optional: true },
        ],
      },
    });

    expect(() => verifyPreinstalledPlugins(runtimeRoot, 'npm run openclaw:runtime:host', { packageJsonPath }))
      .not.toThrow();
  });

  test('ignores plugin metadata entries without ids', () => {
    const runtimeRoot = makeTempDir('electron-builder-runtime-');
    fs.mkdirSync(path.join(runtimeRoot, 'third-party-extensions', 'required-plugin'), { recursive: true });

    const packageJsonPath = writeTempPackageJson({
      openclaw: {
        plugins: [
          {},
          { optional: false },
          { id: '' },
          { id: 'required-plugin' },
        ],
      },
    });

    expect(() => verifyPreinstalledPlugins(runtimeRoot, 'npm run openclaw:runtime:host', { packageJsonPath }))
      .not.toThrow();
  });

  test('still fails when a required plugin is missing', () => {
    const runtimeRoot = makeTempDir('electron-builder-runtime-');

    const packageJsonPath = writeTempPackageJson({
      openclaw: {
        plugins: [
          { id: 'required-plugin' },
          { id: 'optional-plugin', optional: true },
        ],
      },
    });

    expect(() => verifyPreinstalledPlugins(runtimeRoot, 'npm run openclaw:runtime:host', { packageJsonPath }))
      .toThrow(/required-plugin/);
  });
});

describe('electron-builder hooks OpenClaw runtime target resolution', () => {
  test('resolves platform and arch specific OpenClaw runtime ids', () => {
    expect(resolveOpenClawRuntimeTargetId({ electronPlatformName: 'darwin', arch: 3 })).toBe('mac-arm64');
    expect(resolveOpenClawRuntimeTargetId({ electronPlatformName: 'darwin', arch: 1 })).toBe('mac-x64');
    expect(resolveOpenClawRuntimeTargetId({ electronPlatformName: 'win32', arch: 3 })).toBe('win-arm64');
    expect(resolveOpenClawRuntimeTargetId({ electronPlatformName: 'win32', arch: 1 })).toBe('win-x64');
    expect(resolveOpenClawRuntimeTargetId({ electronPlatformName: 'linux', arch: 3 })).toBe('linux-arm64');
    expect(resolveOpenClawRuntimeTargetId({ electronPlatformName: 'linux', arch: 1 })).toBe('linux-x64');
  });

  test('falls back to host runtime build command when target id is unknown', () => {
    expect(resolveOpenClawRuntimeTargetId({ electronPlatformName: 'freebsd', arch: 1 })).toBe(null);
    expect(getOpenClawRuntimeBuildHint(null)).toBe('npm run openclaw:runtime:host');
    expect(getOpenClawRuntimeBuildHint('mac-arm64')).toBe('npm run openclaw:runtime:mac-arm64');
  });
});

describe('electron-builder hooks macOS helper generation', () => {
  test('builds both macOS speech and TTS helpers for mac targets', () => {
    const speech = vi.fn(() => '/tmp/speech-helper');
    const tts = vi.fn(() => '/tmp/tts-helper');

    const result = buildMacosGeneratedHelpers(
      { electronPlatformName: 'darwin', arch: 3 },
      { speech, tts },
    );

    expect(result).toMatchObject({
      arch: 'arm64',
      speechHelperPath: '/tmp/speech-helper',
      ttsHelperPath: '/tmp/tts-helper',
    });
    expect(result.outputDir).toContain(path.join('build', 'generated', 'macos-speech'));
    expect(speech).toHaveBeenCalledWith(expect.objectContaining({ arch: 'arm64' }));
    expect(tts).toHaveBeenCalledWith(expect.objectContaining({ arch: 'arm64' }));
  });

  test('skips macOS speech and TTS helpers for non-mac targets', () => {
    const speech = vi.fn(() => '/tmp/speech-helper');
    const tts = vi.fn(() => '/tmp/tts-helper');

    const result = buildMacosGeneratedHelpers(
      { electronPlatformName: 'win32', arch: 1 },
      { speech, tts },
    );

    expect(result).toBe(null);
    expect(speech).not.toHaveBeenCalled();
    expect(tts).not.toHaveBeenCalled();
  });
});

describe('electron-builder hooks macOS codesign cleanup', () => {
  test('removes every node_modules .bin directory from packaged cfmind', () => {
    const appOutDir = makeTempDir('electron-builder-app-');
    const appRoot = path.join(appOutDir, 'JBPClaw.app');
    const firstBin = path.join(appRoot, 'Contents', 'Resources', 'cfmind', 'node_modules', '.bin');
    const nestedBin = path.join(appRoot, 'Contents', 'Resources', 'cfmind', 'third-party-extensions', 'demo', 'node_modules', '.bin');
    const keepFile = path.join(appRoot, 'Contents', 'Resources', 'cfmind', 'third-party-extensions', 'demo', 'index.js');

    fs.mkdirSync(firstBin, { recursive: true });
    fs.mkdirSync(nestedBin, { recursive: true });
    fs.writeFileSync(path.join(firstBin, 'cli'), 'shim', 'utf8');
    fs.writeFileSync(path.join(nestedBin, 'cli'), 'shim', 'utf8');
    fs.writeFileSync(keepFile, 'module.exports = {};', 'utf8');

    removeAllBinDirsInCfmind(appRoot);

    expect(fs.existsSync(firstBin)).toBe(false);
    expect(fs.existsSync(nestedBin)).toBe(false);
    expect(fs.existsSync(keepFile)).toBe(true);
  });
});
