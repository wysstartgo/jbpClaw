import { spawn } from 'child_process';
import { app } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';

import type { CoworkStore, PluginSource } from '../coworkStore';
import { getElectronNodeRuntimePath } from './coworkUtil';
import { findThirdPartyExtensionsDir } from './openclawLocalExtensions';

export interface PluginInstallParams {
  source: PluginSource;
  spec: string;
  registry?: string;
  version?: string;
}

export type PluginInstallLogCallback = (line: string) => void;

export interface PluginInstallResult {
  ok: boolean;
  pluginId?: string;
  version?: string;
  error?: string;
}

export interface PluginConfigUiHint {
  label?: string;
  help?: string;
  sensitive?: boolean;
  advanced?: boolean;
  placeholder?: string;
  order?: number;
}

export interface PluginConfigSchema {
  configSchema: Record<string, unknown>;
  uiHints: Record<string, PluginConfigUiHint>;
}

export interface PluginListItem {
  pluginId: string;
  version?: string;
  description?: string;
  source: PluginSource | 'bundled';
  enabled: boolean;
  canUninstall: boolean;
  hasConfig: boolean;
}

interface PluginManifest {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  configSchema?: Record<string, unknown>;
  uiHints?: Record<string, PluginConfigUiHint>;
}

function getOpenClawMjsPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'cfmind', 'openclaw.mjs');
  }
  return path.join(app.getAppPath(), 'vendor', 'openclaw-runtime', 'current', 'openclaw.mjs');
}

function getExtensionsDir(): string | null {
  return findThirdPartyExtensionsDir();
}

function readPluginManifest(pluginDir: string): PluginManifest | null {
  const manifestPath = path.join(pluginDir, 'openclaw.plugin.json');
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PluginManifest;
  } catch {
    return null;
  }
}

function readPluginVersion(pluginDir: string): string | undefined {
  const pkgPath = path.join(pluginDir, 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version || undefined;
  } catch {
    return undefined;
  }
}

function runAsync(
  command: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number; shell?: boolean; onLog?: (line: string) => void },
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd || process.cwd(),
      env: opts.env || process.env,
      shell: opts.shell || false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      opts.onLog?.(text);
    });
    child.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      opts.onLog?.(text);
    });

    const timer = opts.timeout
      ? setTimeout(() => {
          child.kill();
          reject(new Error('Process timed out'));
        }, opts.timeout)
      : null;

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code });
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}

function resolveNpmCliJs(): string | null {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'npm', 'bin', 'npm-cli.js')]
    : [
        path.join(app.getAppPath(), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        path.join(process.cwd(), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      ];
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

function resolveNpmCommand(): { command: string; baseArgs: string[]; env: NodeJS.ProcessEnv; shell: boolean } {
  const npmCliJs = resolveNpmCliJs();
  if (npmCliJs) {
    return {
      command: getElectronNodeRuntimePath(),
      baseArgs: [npmCliJs],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      shell: false,
    };
  }
  const isWin = process.platform === 'win32';
  return {
    command: isWin ? 'npm.cmd' : 'npm',
    baseArgs: [],
    env: { ...process.env },
    shell: isWin,
  };
}

function humanizeKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function generateHintsFromSchema(
  schema: Record<string, unknown>,
  existingHints: Record<string, PluginConfigUiHint>,
  prefix = '',
): Record<string, PluginConfigUiHint> {
  const hints = { ...existingHints };
  const properties = (schema.properties ?? schema) as Record<string, Record<string, unknown>>;

  for (const [key, prop] of Object.entries(properties)) {
    if (!prop || typeof prop !== 'object') continue;
    const dotPath = prefix ? `${prefix}.${key}` : key;

    if (prop.type === 'object' && prop.properties) {
      if (!hints[dotPath]) {
        hints[dotPath] = { label: humanizeKey(key) };
      }
      Object.assign(hints, generateHintsFromSchema(prop as Record<string, unknown>, hints, dotPath));
      continue;
    }

    if (prop.type && prop.type !== 'object' && !hints[dotPath]) {
      const isSensitive = /key|secret|token|password/i.test(key);
      hints[dotPath] = {
        label: humanizeKey(key),
        ...(isSensitive ? { sensitive: true } : {}),
        ...(typeof prop.default !== 'undefined' ? { placeholder: String(prop.default) } : {}),
      };
    }
  }

  return hints;
}

export class PluginManager {
  constructor(private readonly store: CoworkStore) {}

  async listPlugins(): Promise<PluginListItem[]> {
    const hiddenIds = getHiddenPluginIds();
    const userPlugins = this.store.listUserPlugins();
    const extensionsDir = getExtensionsDir();

    return userPlugins.filter(plugin => !isHiddenPlugin(plugin.pluginId, hiddenIds)).map(plugin => {
      let description: string | undefined;
      let version = plugin.version;
      let hasConfig = false;

      if (extensionsDir) {
        const pluginDir = path.join(extensionsDir, plugin.pluginId);
        const manifest = readPluginManifest(pluginDir);
        if (manifest) {
          description = manifest.description || manifest.name;
          hasConfig = !!(
            manifest.configSchema
            && typeof manifest.configSchema === 'object'
            && (manifest.configSchema as Record<string, unknown>).properties
            && Object.keys((manifest.configSchema as Record<string, unknown>).properties as object).length > 0
          );
        }
        if (!version) {
          version = readPluginVersion(pluginDir);
        }
      }

      return {
        pluginId: plugin.pluginId,
        version,
        description,
        source: plugin.source,
        enabled: plugin.enabled,
        canUninstall: true,
        hasConfig,
      };
    });
  }

  async installPlugin(params: PluginInstallParams, onLog?: PluginInstallLogCallback): Promise<PluginInstallResult> {
    const extensionsDir = getExtensionsDir();
    if (!extensionsDir) {
      return { ok: false, error: 'Extensions directory not found' };
    }

    const openclawMjs = getOpenClawMjsPath();
    if (!fs.existsSync(openclawMjs)) {
      return { ok: false, error: `OpenClaw CLI not found at ${openclawMjs}` };
    }

    let stagingDir: string | null = null;
    try {
      let installSpec: string;
      switch (params.source) {
        case 'clawhub':
          installSpec = `clawhub:${params.spec}`;
          break;
        case 'npm':
          onLog?.(`Packing ${params.spec}${params.version ? `@${params.version}` : ''} from npm...\n`);
          installSpec = await this.packNpmPlugin(params, onLog);
          break;
        case 'git':
          onLog?.(`Cloning ${params.spec}...\n`);
          installSpec = await this.packGitPlugin(params, onLog);
          break;
        case 'local':
          installSpec = params.spec;
          break;
      }

      stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lobsterai-plugin-stage-'));
      onLog?.(`Installing plugin from ${installSpec}...\n`);
      const installEnv: NodeJS.ProcessEnv = {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        OPENCLAW_STATE_DIR: stagingDir,
      };
      if (params.registry) {
        installEnv.npm_config_registry = params.registry;
      }

      const result = await runAsync(
        process.execPath,
        [openclawMjs, 'plugins', 'install', installSpec, '--force'],
        {
          cwd: stagingDir,
          env: installEnv,
          timeout: 5 * 60 * 1000,
          onLog,
        },
      );
      if (result.code !== 0) {
        return { ok: false, error: result.stderr || `Install exited with code ${result.code}` };
      }

      const stagedExtDir = path.join(stagingDir, 'extensions');
      const pluginId = this.discoverInstalledPluginId(
        fs.existsSync(stagedExtDir) ? stagedExtDir : stagingDir,
        params,
      );
      if (!pluginId) {
        return { ok: false, error: 'Plugin installed but could not determine plugin ID' };
      }

      const stagedPluginDir = path.join(stagedExtDir, pluginId);
      const targetPluginDir = path.join(extensionsDir, pluginId);
      onLog?.(`Copying ${pluginId} to extensions directory...\n`);
      if (fs.existsSync(targetPluginDir)) {
        await fs.promises.rm(targetPluginDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
      }
      await fs.promises.cp(stagedPluginDir, targetPluginDir, { recursive: true, force: true });
      const version = readPluginVersion(targetPluginDir) || params.version;
      this.store.addUserPlugin({
        pluginId,
        source: params.source,
        spec: params.spec,
        registry: params.registry,
        version,
        enabled: true,
        installedAt: Date.now(),
      });

      onLog?.(`Plugin ${pluginId}@${version || 'unknown'} installed successfully.\n`);
      return { ok: true, pluginId, version };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    } finally {
      if (stagingDir) {
        fs.promises.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  async uninstallPlugin(pluginId: string): Promise<{ ok: boolean; error?: string }> {
    const extensionsDir = getExtensionsDir();
    if (!extensionsDir) {
      return { ok: false, error: 'Extensions directory not found' };
    }

    try {
      const pluginDir = path.join(extensionsDir, pluginId);
      if (fs.existsSync(pluginDir)) {
        await fs.promises.rm(pluginDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
      }
      this.store.removeUserPlugin(pluginId);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `Failed to remove plugin directory: ${message}` };
    }
  }

  setPluginEnabled(pluginId: string, enabled: boolean): void {
    this.store.setUserPluginEnabled(pluginId, enabled);
  }

  getPluginConfigSchema(pluginId: string): PluginConfigSchema | null {
    const extensionsDir = getExtensionsDir();
    if (!extensionsDir) return null;

    const manifest = readPluginManifest(path.join(extensionsDir, pluginId));
    const schemaProps = (manifest?.configSchema as Record<string, unknown> | undefined)?.properties;
    if (!schemaProps || Object.keys(schemaProps as object).length === 0 || !manifest?.configSchema) {
      return null;
    }

    return {
      configSchema: manifest.configSchema,
      uiHints: generateHintsFromSchema(manifest.configSchema, manifest.uiHints ?? {}),
    };
  }

  getPluginConfig(pluginId: string): Record<string, unknown> | null {
    return this.store.getUserPluginConfig(pluginId);
  }

  savePluginConfig(pluginId: string, config: Record<string, unknown>): void {
    this.store.setUserPluginConfig(pluginId, config);
  }

  private async packNpmPlugin(params: PluginInstallParams, onLog?: PluginInstallLogCallback): Promise<string> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lobsterai-plugin-'));
    const spec = params.version ? `${params.spec}@${params.version}` : params.spec;
    const npm = resolveNpmCommand();
    const args = [...npm.baseArgs, 'pack', spec, '--pack-destination', tmpDir];
    if (params.registry) {
      args.push(`--registry=${params.registry}`);
    }

    const result = await runAsync(npm.command, args, {
      cwd: tmpDir,
      env: {
        ...npm.env,
        npm_config_prefer_offline: '',
        npm_config_prefer_online: '',
      },
      timeout: 3 * 60 * 1000,
      shell: npm.shell,
      onLog,
    });
    if (result.code !== 0) {
      throw new Error(`npm pack ${spec} failed: ${result.stderr}`);
    }

    const tgzName = result.stdout.split('\n').pop();
    if (!tgzName) {
      throw new Error('npm pack produced no output');
    }
    return path.join(tmpDir, tgzName);
  }

  private async packGitPlugin(params: PluginInstallParams, onLog?: PluginInstallLogCallback): Promise<string> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lobsterai-plugin-git-'));
    const sourceDir = path.join(tmpDir, 'source');
    const cloneArgs = ['clone', '--depth', '1'];
    if (params.version) {
      cloneArgs.push('--branch', params.version);
    }
    cloneArgs.push(params.spec, sourceDir);

    const cloneResult = await runAsync('git', cloneArgs, {
      cwd: tmpDir,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      timeout: 5 * 60 * 1000,
      onLog,
    });
    if (cloneResult.code !== 0) {
      throw new Error(`git clone failed: ${cloneResult.stderr}`);
    }

    const npm = resolveNpmCommand();
    const packResult = await runAsync(
      npm.command,
      [...npm.baseArgs, 'pack', sourceDir, '--pack-destination', tmpDir],
      {
        cwd: tmpDir,
        env: npm.env,
        timeout: 3 * 60 * 1000,
        shell: npm.shell,
        onLog,
      },
    );
    if (packResult.code !== 0) {
      throw new Error(`npm pack (git source) failed: ${packResult.stderr}`);
    }

    const tgzName = packResult.stdout.split('\n').pop();
    if (!tgzName) {
      throw new Error('npm pack produced no output for git source');
    }
    return path.join(tmpDir, tgzName);
  }

  private discoverInstalledPluginId(extensionsDir: string, params: PluginInstallParams): string | null {
    try {
      const entries = fs.readdirSync(extensionsDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory());

      for (const entry of entries) {
        const manifest = readPluginManifest(path.join(extensionsDir, entry.name));
        if (!manifest?.id) continue;

        const specLower = params.spec.toLowerCase();
        const idLower = manifest.id.toLowerCase();
        if (idLower.includes(specLower) || specLower.includes(idLower) || entry.name === params.spec) {
          return manifest.id;
        }
      }

      const lastSegment = params.spec.split('/').pop() || params.spec;
      const candidateDir = path.join(extensionsDir, lastSegment);
      if (fs.existsSync(candidateDir)) {
        const manifest = readPluginManifest(candidateDir);
        return manifest?.id || lastSegment;
      }
    } catch {
      // Ignore malformed extension directories.
    }
    return null;
  }
}

const INTERNAL_PLUGIN_IDS = [
  'ask-user-question',
  'memory-core',
  'qwen-portal-auth',
  'qqbot',
  'acpx',
  'browser',
  'llm-task',
  'thread-ownership',
  'google',
  'anthropic',
  'openai',
  'openai-codex',
  'deepseek',
  'moonshot',
  'minimax',
  'volcengine',
  'qianfan',
  'qwen',
  'qwen-portal',
  'zai',
  'youdaozhiyun',
  'stepfun',
  'xiaomi',
  'openrouter',
  'ollama',
  'lm-studio',
  'lobsterai-server',
  'github-copilot',
  'lobsterai-copilot',
  'lobster',
  'kimi',
  'dingtalk',
  'feishu',
  'feishu-openclaw-plugin',
  'openclaw-nim',
  'nim',
  'nimsuite-openclaw-nim-channel',
  'email',
  'discord',
  'telegram',
  'talk-voice',
  'memory-lancedb',
  'memory-wiki',
];

function readPreinstalledPluginIdsFromPackageJson(): string[] {
  try {
    const pkgPath = path.join(app.getAppPath(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const plugins = pkg.openclaw?.plugins;
    if (!Array.isArray(plugins)) return [];
    return plugins
      .map((p: { id?: string }) => p.id)
      .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0);
  } catch {
    return [];
  }
}

function getHiddenPluginIds(): Set<string> {
  const hidden = new Set<string>();
  for (const id of readPreinstalledPluginIdsFromPackageJson()) {
    hidden.add(id);
  }
  for (const id of INTERNAL_PLUGIN_IDS) {
    hidden.add(id);
  }
  return hidden;
}

function isHiddenPlugin(pluginId: string, hiddenIds: Set<string>): boolean {
  return hiddenIds.has(pluginId);
}

export function isHiddenUserPluginId(pluginId: string): boolean {
  return isHiddenPlugin(pluginId, getHiddenPluginIds());
}
