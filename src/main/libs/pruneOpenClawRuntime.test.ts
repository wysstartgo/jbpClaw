import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const {
  PACKAGES_TO_STUB,
  cleanExtensionNodeModules,
  pruneDuplicateOpenClawSdkFromExtensions,
  pruneUnusedBundledExtensions,
  shouldKeepBundledExtension,
} = require('../../../scripts/prune-openclaw-runtime.cjs');

test('pruneOpenClawRuntime keeps required bundled extensions', () => {
  expect(shouldKeepBundledExtension('openai')).toBe(true);
  expect(shouldKeepBundledExtension('browser')).toBe(true);
  expect(shouldKeepBundledExtension('feishu')).toBe(true);
  expect(shouldKeepBundledExtension('xiaomi')).toBe(true);
});

test('pruneOpenClawRuntime removes explicitly unwanted bundled extensions', () => {
  expect(shouldKeepBundledExtension('amazon-bedrock')).toBe(false);
  expect(shouldKeepBundledExtension('amazon-bedrock-mantle')).toBe(false);
  expect(shouldKeepBundledExtension('slack')).toBe(false);
  expect(shouldKeepBundledExtension('diffs')).toBe(false);
});

test('pruneOpenClawRuntime keeps sharp native bindings available', () => {
  expect(PACKAGES_TO_STUB).not.toContain('@img');
});

test('pruneOpenClawRuntime cleans node_modules in both extension roots', () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-prune-ext-'));
  try {
    const thirdPartyReadme = path.join(
      runtimeRoot,
      'third-party-extensions',
      'openclaw-lark',
      'node_modules',
      'pkg-a',
      'README.md',
    );
    const bundledReadme = path.join(
      runtimeRoot,
      'extensions',
      'bundled-channel',
      'node_modules',
      'pkg-b',
      'README.md',
    );
    const extensionSource = path.join(runtimeRoot, 'third-party-extensions', 'openclaw-lark', 'index.js');
    fs.mkdirSync(path.dirname(thirdPartyReadme), { recursive: true });
    fs.mkdirSync(path.dirname(bundledReadme), { recursive: true });
    fs.writeFileSync(thirdPartyReadme, 'third party docs', 'utf8');
    fs.writeFileSync(bundledReadme, 'bundled docs', 'utf8');
    fs.writeFileSync(extensionSource, 'module.exports = {};', 'utf8');

    const stats = { filesRemoved: 0, dirsRemoved: 0, bytesFreed: 0, stubbed: [], extensionsPruned: [] };
    cleanExtensionNodeModules(runtimeRoot, stats);

    expect(fs.existsSync(thirdPartyReadme)).toBe(false);
    expect(fs.existsSync(bundledReadme)).toBe(false);
    expect(fs.existsSync(extensionSource)).toBe(true);
    expect(stats.filesRemoved).toBe(2);
    expect(stats.bytesFreed).toBe('third party docs'.length + 'bundled docs'.length);
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('pruneOpenClawRuntime records bytes freed for pruned bundled extensions', () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-prune-bundled-'));
  try {
    const distExtDir = path.join(runtimeRoot, 'dist', 'extensions');
    const keptFile = path.join(distExtDir, 'openai', 'index.js');
    const prunedFile = path.join(distExtDir, 'slack', 'payload.bin');
    fs.mkdirSync(path.dirname(keptFile), { recursive: true });
    fs.mkdirSync(path.dirname(prunedFile), { recursive: true });
    fs.writeFileSync(keptFile, 'kept provider', 'utf8');
    fs.writeFileSync(prunedFile, 'unused channel payload', 'utf8');

    const stats = { filesRemoved: 0, dirsRemoved: 0, bytesFreed: 0, stubbed: [], extensionsPruned: [] };
    pruneUnusedBundledExtensions(distExtDir, stats);

    expect(fs.existsSync(keptFile)).toBe(true);
    expect(fs.existsSync(path.dirname(prunedFile))).toBe(false);
    expect(stats.extensionsPruned).toEqual(['slack']);
    expect(stats.dirsRemoved).toBe(1);
    expect(stats.bytesFreed).toBe('unused channel payload'.length);
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('pruneOpenClawRuntime removes duplicate openclaw SDK from third-party extensions only', () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-prune-sdk-'));
  try {
    const thirdPartyDir = path.join(runtimeRoot, 'third-party-extensions');
    const duplicateSdkFile = path.join(thirdPartyDir, 'openclaw-lark', 'node_modules', 'openclaw', 'index.js');
    const pluginFile = path.join(thirdPartyDir, 'openclaw-lark', 'index.js');
    const unrelatedFile = path.join(thirdPartyDir, 'openclaw-lark', 'node_modules', 'other-sdk', 'index.js');
    fs.mkdirSync(path.dirname(duplicateSdkFile), { recursive: true });
    fs.mkdirSync(path.dirname(unrelatedFile), { recursive: true });
    fs.writeFileSync(duplicateSdkFile, 'duplicate sdk', 'utf8');
    fs.writeFileSync(pluginFile, 'plugin entry', 'utf8');
    fs.writeFileSync(unrelatedFile, 'other sdk', 'utf8');

    const stats = { filesRemoved: 0, dirsRemoved: 0, bytesFreed: 0, stubbed: [], extensionsPruned: [] };
    pruneDuplicateOpenClawSdkFromExtensions(thirdPartyDir, stats);

    expect(fs.existsSync(path.dirname(duplicateSdkFile))).toBe(false);
    expect(fs.existsSync(pluginFile)).toBe(true);
    expect(fs.existsSync(unrelatedFile)).toBe(true);
    expect(stats.dirsRemoved).toBe(1);
    expect(stats.bytesFreed).toBe('duplicate sdk'.length);
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});
