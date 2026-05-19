/**
 * IM Gateway Store
 * SQLite operations for IM configuration storage
 */

import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

import { PlatformRegistry } from '../../shared/platform';
import {
  hasMeaningfulNimSingleConfig,
  hasMeaningfulPopoSingleConfig,
  ImSingleToMultiInstancePlatform,
  planSingleToMultiInstanceMigration,
} from './imSingleToMultiInstanceMigration';
import {
  DEFAULT_DINGTALK_MULTI_INSTANCE_CONFIG,
  DEFAULT_DINGTALK_OPENCLAW_CONFIG,
  DEFAULT_DISCORD_MULTI_INSTANCE_CONFIG,
  DEFAULT_DISCORD_OPENCLAW_CONFIG,
  DEFAULT_EMAIL_INSTANCE_CONFIG,
  DEFAULT_EMAIL_MULTI_INSTANCE_CONFIG,
  DEFAULT_FEISHU_MULTI_INSTANCE_CONFIG,
  DEFAULT_FEISHU_OPENCLAW_CONFIG,
  DEFAULT_IM_SETTINGS,
  DEFAULT_NETEASE_BEE_CONFIG,
  DEFAULT_NIM_CONFIG,
  DEFAULT_NIM_MULTI_INSTANCE_CONFIG,
  DEFAULT_POPO_CONFIG,
  DEFAULT_POPO_MULTI_INSTANCE_CONFIG,
  DEFAULT_QQ_CONFIG,
  DEFAULT_QQ_MULTI_INSTANCE_CONFIG,
  DEFAULT_TELEGRAM_MULTI_INSTANCE_CONFIG,
  DEFAULT_TELEGRAM_OPENCLAW_CONFIG,
  DEFAULT_WECOM_CONFIG,
  DEFAULT_WECOM_MULTI_INSTANCE_CONFIG,
  DEFAULT_WEIXIN_CONFIG,
  DingTalkInstanceConfig,
  DingTalkMultiInstanceConfig,
  DingTalkOpenClawConfig,
  DiscordInstanceConfig,
  DiscordMultiInstanceConfig,
  DiscordOpenClawConfig,
  EmailInstanceConfig,
  EmailMultiInstanceConfig,
  FeishuInstanceConfig,
  FeishuMultiInstanceConfig,
  FeishuOpenClawConfig,
  IMGatewayConfig,
  IMSessionMapping,
  IMSettings,
  NeteaseBeeChanConfig,
  NimConfig,
  NimInstanceConfig,
  NimMultiInstanceConfig,
  Platform,
  PopoInstanceConfig,
  PopoMultiInstanceConfig,
  PopoOpenClawConfig,
  QQConfig,
  QQInstanceConfig,
  QQMultiInstanceConfig,
  TelegramInstanceConfig,
  TelegramMultiInstanceConfig,
  TelegramOpenClawConfig,
  WecomInstanceConfig,
  WecomMultiInstanceConfig,
  WecomOpenClawConfig,
  WeixinOpenClawConfig,
} from './types';

interface StoredConversationReplyRoute {
  channel: string;
  to: string;
  accountId?: string;
}

interface IMSessionMappingRow {
  im_conversation_id: string;
  platform: Platform;
  cowork_session_id: string;
  agent_id: string | null;
  openclaw_session_key: string | null;
  created_at: number;
  last_active_at: number;
}

function mapIMSessionMappingRow(row: IMSessionMappingRow): IMSessionMapping {
  return {
    imConversationId: row.im_conversation_id,
    platform: row.platform,
    coworkSessionId: row.cowork_session_id,
    agentId: row.agent_id || 'main',
    ...(row.openclaw_session_key ? { openClawSessionKey: row.openclaw_session_key } : {}),
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
  };
}

function isLegacyEmailInstanceConfig(
  value: EmailMultiInstanceConfig | (Partial<EmailInstanceConfig> & { email?: string }),
): value is Partial<EmailInstanceConfig> & { email: string } {
  return !('instances' in value) && typeof value.email === 'string' && value.email.length > 0;
}

function pickPrimaryNimInstance(instances: readonly NimInstanceConfig[]): NimInstanceConfig | null {
  return instances.find((instance) => instance.enabled && Boolean(instance.appKey && instance.account && instance.token))
    ?? instances[0]
    ?? null;
}

function isPopoInstanceConfigured(instance: PopoInstanceConfig): boolean {
  return Boolean(
    instance.appKey
    && instance.appSecret
    && instance.aesKey
    && (instance.connectionMode === 'websocket' || instance.token),
  );
}

function pickPrimaryPopoInstance(instances: readonly PopoInstanceConfig[]): PopoInstanceConfig | null {
  return instances.find((instance) => instance.enabled && isPopoInstanceConfigured(instance))
    ?? instances[0]
    ?? null;
}

export class IMStore {
  private db: Database.Database;
  private saveDb: () => void;

  constructor(db: Database.Database, saveDb: () => void) {
    this.db = db;
    this.saveDb = saveDb;
    this.initializeTables();
    this.migrateDefaults();
  }

  private getOne<T>(sql: string, params: Array<string | number | null> = []): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  private getAll<T>(sql: string, params: Array<string | number | null> = []): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  private run(sql: string, params: Array<string | number | null> = []): number {
    return this.db.prepare(sql).run(...params).changes;
  }

  private initializeTables() {
    this.run(`
      CREATE TABLE IF NOT EXISTS im_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    // IM session mappings table for Cowork mode
    this.run(`
      CREATE TABLE IF NOT EXISTS im_session_mappings (
        im_conversation_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        cowork_session_id TEXT NOT NULL,
        openclaw_session_key TEXT,
        created_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL,
        PRIMARY KEY (im_conversation_id, platform)
      );
    `);

    // Migration: Add agent_id column to im_session_mappings
    const mappingCols = this.getAll<{ name: string }>('PRAGMA table_info(im_session_mappings)');
    const mappingColNames = mappingCols.map((row) => row.name);
    if (!mappingColNames.includes('agent_id')) {
      this.run("ALTER TABLE im_session_mappings ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'main'");
    }
    if (!mappingColNames.includes('openclaw_session_key')) {
      this.run('ALTER TABLE im_session_mappings ADD COLUMN openclaw_session_key TEXT');
    }

    this.saveDb();
  }

  /**
   * Migrate existing IM configs to ensure stable defaults.
   */
  private migrateDefaults(): void {
    const platforms = PlatformRegistry.platforms;
    let changed = false;

    for (const platform of platforms) {
      const row = this.getOne<{ value: string }>('SELECT value FROM im_config WHERE key = ?', [platform]);
      if (!row) continue;

      try {
        const config = JSON.parse(row.value);
        if (config.debug === undefined || config.debug === false) {
          config.debug = true;
          const now = Date.now();
          this.run(
            'UPDATE im_config SET value = ?, updated_at = ? WHERE key = ?',
            [JSON.stringify(config), now, platform]
          );
          changed = true;
        }
      } catch {
        // Ignore parse errors
      }
    }

    const settingsResult = this.getOne<{ value: string }>('SELECT value FROM im_config WHERE key = ?', ['settings']);
    if (settingsResult) {
      try {
        const settings = JSON.parse(settingsResult.value) as Partial<IMSettings>;
        // Keep IM and desktop behavior aligned: skills auto-routing should be on by default.
        // Historical renderer default could persist `skillsEnabled: false` unintentionally.
        if (settings.skillsEnabled !== true) {
          settings.skillsEnabled = true;
          const now = Date.now();
          this.run(
            'UPDATE im_config SET value = ?, updated_at = ? WHERE key = ?',
            [JSON.stringify(settings), now, 'settings']
          );
          changed = true;
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Migrate feishu renderMode from 'text' to 'card' (previous renderer default was incorrect)
    const feishuResult = this.getOne<{ value: string }>('SELECT value FROM im_config WHERE key = ?', ['feishu']);
    if (feishuResult) {
      try {
        const feishuConfig = JSON.parse(feishuResult.value) as Partial<{ renderMode: string }>;
        if (feishuConfig.renderMode === 'text') {
          feishuConfig.renderMode = 'card';
          const now = Date.now();
          this.run(
            'UPDATE im_config SET value = ?, updated_at = ? WHERE key = ?',
            [JSON.stringify(feishuConfig), now, 'feishu']
          );
          changed = true;
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Migrate old native Telegram config to new OpenClaw format
    const oldTelegramResult = this.getOne<{ value: string }>('SELECT value FROM im_config WHERE key = ?', ['telegram']);
    const newTelegramResult = this.getOne<{ value: string }>('SELECT value FROM im_config WHERE key = ?', ['telegramOpenClaw']);
    if (oldTelegramResult && !newTelegramResult) {
      try {
        const oldConfig = JSON.parse(oldTelegramResult.value) as {
          enabled?: boolean;
          botToken?: string;
          allowedUserIds?: string[];
          debug?: boolean;
        };
        if (oldConfig.botToken) {
          const hasAllowList = Array.isArray(oldConfig.allowedUserIds) && oldConfig.allowedUserIds.length > 0;
          const newConfig = {
            ...DEFAULT_TELEGRAM_OPENCLAW_CONFIG,
            enabled: oldConfig.enabled ?? false,
            botToken: oldConfig.botToken,
            allowFrom: oldConfig.allowedUserIds ?? [],
            dmPolicy: hasAllowList ? 'allowlist' as const : 'pairing' as const,
            debug: oldConfig.debug ?? true,
          };
          const now = Date.now();
          this.run(
            'INSERT OR REPLACE INTO im_config (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)',
            ['telegramOpenClaw', JSON.stringify(newConfig), now, now]
          );
          this.run('DELETE FROM im_config WHERE key = ?', ['telegram']);
          changed = true;
          console.log('[IMStore] Migrated old Telegram config to OpenClaw format');
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Migrate old native Discord config to new OpenClaw format
    const oldDiscordResult = this.getOne<{ value: string }>('SELECT value FROM im_config WHERE key = ?', ['discord']);
    const newDiscordResult = this.getOne<{ value: string }>('SELECT value FROM im_config WHERE key = ?', ['discordOpenClaw']);
    if (oldDiscordResult && !newDiscordResult) {
      try {
        const oldConfig = JSON.parse(oldDiscordResult.value) as {
          enabled?: boolean;
          botToken?: string;
          debug?: boolean;
        };
        if (oldConfig.botToken) {
          const newConfig = {
            ...DEFAULT_DISCORD_OPENCLAW_CONFIG,
            enabled: oldConfig.enabled ?? false,
            botToken: oldConfig.botToken,
            debug: oldConfig.debug ?? true,
          };
          const now = Date.now();
          this.run(
            'INSERT OR REPLACE INTO im_config (key, value, updated_at) VALUES (?, ?, ?)',
            ['discordOpenClaw', JSON.stringify(newConfig), now]
          );
          this.run('DELETE FROM im_config WHERE key = ?', ['discord']);
          changed = true;
          console.log('[IMStore] Migrated old Discord config to OpenClaw format');
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Migrate old native Feishu config to new OpenClaw format
    const oldFeishuResult2 = this.getOne<{ value: string }>('SELECT value FROM im_config WHERE key = ?', ['feishu']);
    const newFeishuResult = this.getOne<{ value: string }>('SELECT value FROM im_config WHERE key = ?', ['feishuOpenClaw']);
    if (oldFeishuResult2 && !newFeishuResult) {
      try {
        const oldConfig = JSON.parse(oldFeishuResult2.value) as Partial<{ enabled: boolean; appId: string; appSecret: string; domain: string; debug: boolean }>;
        if (oldConfig.appId) {
          const newConfig: FeishuOpenClawConfig = {
            ...DEFAULT_FEISHU_OPENCLAW_CONFIG,
            enabled: oldConfig.enabled ?? false,
            appId: oldConfig.appId,
            appSecret: oldConfig.appSecret ?? '',
            domain: oldConfig.domain || 'feishu',
            debug: oldConfig.debug ?? true,
          };
          const now = Date.now();
          this.run(
            'INSERT OR REPLACE INTO im_config (key, value, updated_at) VALUES (?, ?, ?)',
            ['feishuOpenClaw', JSON.stringify(newConfig), now]
          );
          this.run('DELETE FROM im_config WHERE key = ?', ['feishu']);
          changed = true;
          console.log('[IMStore] Migrated old Feishu config to OpenClaw format');
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Migrate old native DingTalk config to new OpenClaw format
    const oldDingtalkResult = this.getOne<{ value: string }>('SELECT value FROM im_config WHERE key = ?', ['dingtalk']);
    const newDingtalkResult = this.getOne<{ value: string }>('SELECT value FROM im_config WHERE key = ?', ['dingtalkOpenClaw']);
    if (oldDingtalkResult && !newDingtalkResult) {
      try {
        const oldConfig = JSON.parse(oldDingtalkResult.value) as Partial<{ enabled: boolean; clientId: string; clientSecret: string; debug: boolean }>;
        if (oldConfig.clientId) {
          const newConfig: DingTalkOpenClawConfig = {
            ...DEFAULT_DINGTALK_OPENCLAW_CONFIG,
            enabled: oldConfig.enabled ?? false,
            clientId: oldConfig.clientId,
            clientSecret: oldConfig.clientSecret ?? '',
            debug: oldConfig.debug ?? false,
          };
          const now = Date.now();
          this.run(
            'INSERT OR REPLACE INTO im_config (key, value, updated_at) VALUES (?, ?, ?)',
            ['dingtalkOpenClaw', JSON.stringify(newConfig), now]
          );
          this.run('DELETE FROM im_config WHERE key = ?', ['dingtalk']);
          changed = true;
          console.log('[IMStore] Migrated old DingTalk config to OpenClaw format');
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Migrate old native WeCom config to new OpenClaw format
    const oldWecomResult = this.getOne<{ value: string }>('SELECT value FROM im_config WHERE key = ?', ['wecom']);
    const newWecomResult = this.getOne<{ value: string }>('SELECT value FROM im_config WHERE key = ?', ['wecomOpenClaw']);
    if (oldWecomResult && !newWecomResult) {
      try {
        const oldConfig = JSON.parse(oldWecomResult.value) as Partial<{ enabled: boolean; botId: string; secret: string; debug: boolean }>;
        if (oldConfig.botId) {
          const newConfig: WecomOpenClawConfig = {
            ...DEFAULT_WECOM_CONFIG,
            enabled: oldConfig.enabled ?? false,
            botId: oldConfig.botId,
            secret: oldConfig.secret ?? '',
            debug: oldConfig.debug ?? true,
          };
          const now = Date.now();
          this.run(
            'INSERT OR REPLACE INTO im_config (key, value, updated_at) VALUES (?, ?, ?)',
            ['wecomOpenClaw', JSON.stringify(newConfig), now]
          );
          this.run('DELETE FROM im_config WHERE key = ?', ['wecom']);
          changed = true;
          console.log('[IMStore] Migrated old WeCom config to OpenClaw format');
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Migrate popo configs that have token but no connectionMode:
    // These are existing webhook users from before connectionMode was introduced.
    // Preserve their setup by explicitly setting connectionMode to 'webhook'.
    const popoResult = this.getOne<{ value: string }>('SELECT value FROM im_config WHERE key = ?', ['popo']);
    if (popoResult) {
      try {
        const popoConfig = JSON.parse(popoResult.value) as Partial<PopoOpenClawConfig>;
        if (popoConfig.token && !popoConfig.connectionMode) {
          popoConfig.connectionMode = 'webhook';
          const now = Date.now();
          this.run(
            'UPDATE im_config SET value = ?, updated_at = ? WHERE key = ?',
            [JSON.stringify(popoConfig), now, 'popo']
          );
          changed = true;
          console.log('[IMStore] Migrated popo config: inferred connectionMode=webhook from existing token');
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Migrate 'xiaomifeng' config key to 'netease-bee'
    const oldXmfResult = this.getOne<{ value: string }>('SELECT value FROM im_config WHERE key = ?', ['xiaomifeng']);
    const newBeeResult = this.getOne<{ value: string }>('SELECT value FROM im_config WHERE key = ?', ['netease-bee']);
    if (oldXmfResult && !newBeeResult) {
      try {
        const oldConfig = JSON.parse(oldXmfResult.value) as Partial<NeteaseBeeChanConfig>;
        const now = Date.now();
        this.run(
          'INSERT INTO im_config (key, value, updated_at) VALUES (?, ?, ?)',
          ['netease-bee', JSON.stringify({ ...DEFAULT_NETEASE_BEE_CONFIG, ...oldConfig }), now]
        );
        this.run('DELETE FROM im_config WHERE key = ?', ['xiaomifeng']);
        changed = true;
        console.log('[IMStore] Migrated xiaomifeng config to netease-bee');
      } catch {
        // Ignore parse errors
      }
    }

    // Migrate single DingTalk config to multi-instance format
    const oldDingTalkSingle = this.getOne<{ value: string }>('SELECT value FROM im_config WHERE key = ?', ['dingtalkOpenClaw']);
    const existingDingTalkInstances = this.getAll<{ key: string }>('SELECT key FROM im_config WHERE key LIKE ?', ['dingtalk:%']);
    if (oldDingTalkSingle && existingDingTalkInstances.length === 0) {
      try {
        const oldConfig = JSON.parse(oldDingTalkSingle.value) as DingTalkOpenClawConfig;
        const instanceId = crypto.randomUUID();
        const instanceConfig: DingTalkInstanceConfig = {
          ...DEFAULT_DINGTALK_OPENCLAW_CONFIG,
          ...oldConfig,
          instanceId,
          instanceName: 'DingTalk Bot 1',
        };
        const now = Date.now();
        this.run(
          'INSERT OR REPLACE INTO im_config (key, value, updated_at) VALUES (?, ?, ?)',
          [`dingtalk:${instanceId}`, JSON.stringify(instanceConfig), now]
        );
        this.run('DELETE FROM im_config WHERE key = ?', ['dingtalkOpenClaw']);
        const settings = this.getConfigValue<IMSettings>('settings');
        if (settings?.platformAgentBindings?.dingtalk) {
          settings.platformAgentBindings[`dingtalk:${instanceId}`] = settings.platformAgentBindings.dingtalk;
          delete settings.platformAgentBindings.dingtalk;
          this.run(
            'INSERT OR REPLACE INTO im_config (key, value, updated_at) VALUES (?, ?, ?)',
            ['settings', JSON.stringify(settings), now]
          );
        }
        changed = true;
      } catch {
        // Ignore parse errors
      }
    }

    // Migrate single Feishu config to multi-instance format
    const oldFeishuSingle = this.getOne<{ value: string }>('SELECT value FROM im_config WHERE key = ?', ['feishuOpenClaw']);
    const existingFeishuInstances = this.getAll<{ key: string }>('SELECT key FROM im_config WHERE key LIKE ?', ['feishu:%']);
    if (oldFeishuSingle && existingFeishuInstances.length === 0) {
      try {
        const oldConfig = JSON.parse(oldFeishuSingle.value) as FeishuOpenClawConfig;
        const instanceId = crypto.randomUUID();
        const instanceConfig: FeishuInstanceConfig = {
          ...DEFAULT_FEISHU_OPENCLAW_CONFIG,
          ...oldConfig,
          instanceId,
          instanceName: 'Feishu Bot 1',
        };
        const now = Date.now();
        this.run(
          'INSERT OR REPLACE INTO im_config (key, value, updated_at) VALUES (?, ?, ?)',
          [`feishu:${instanceId}`, JSON.stringify(instanceConfig), now]
        );
        this.run('DELETE FROM im_config WHERE key = ?', ['feishuOpenClaw']);
        const settings = this.getConfigValue<IMSettings>('settings');
        if (settings?.platformAgentBindings?.feishu) {
          settings.platformAgentBindings[`feishu:${instanceId}`] = settings.platformAgentBindings.feishu;
          delete settings.platformAgentBindings.feishu;
          this.run(
            'INSERT OR REPLACE INTO im_config (key, value, updated_at) VALUES (?, ?, ?)',
            ['settings', JSON.stringify(settings), now]
          );
        }
        changed = true;
      } catch {
        // Ignore parse errors
      }
    }

    // Migrate single QQ config to multi-instance format
    const oldQQSingle = this.getOne<{ value: string }>('SELECT value FROM im_config WHERE key = ?', ['qq']);
    const existingQQInstances = this.getAll<{ key: string }>('SELECT key FROM im_config WHERE key LIKE ?', ['qq:%']);
    if (oldQQSingle && existingQQInstances.length === 0) {
      try {
        const oldConfig = JSON.parse(oldQQSingle.value) as QQConfig;
        const instanceId = crypto.randomUUID();
        const instanceConfig: QQInstanceConfig = {
          ...DEFAULT_QQ_CONFIG,
          ...oldConfig,
          instanceId,
          instanceName: 'QQ Bot 1',
        };
        const now = Date.now();
        this.run(
          'INSERT OR REPLACE INTO im_config (key, value, updated_at) VALUES (?, ?, ?)',
          [`qq:${instanceId}`, JSON.stringify(instanceConfig), now]
        );
        this.run('DELETE FROM im_config WHERE key = ?', ['qq']);
        const settings = this.getConfigValue<IMSettings>('settings');
        if (settings?.platformAgentBindings?.qq) {
          settings.platformAgentBindings[`qq:${instanceId}`] = settings.platformAgentBindings.qq;
          delete settings.platformAgentBindings.qq;
          this.run(
            'INSERT OR REPLACE INTO im_config (key, value, updated_at) VALUES (?, ?, ?)',
            ['settings', JSON.stringify(settings), now]
          );
        }
        changed = true;
      } catch {
        // Ignore parse errors
      }
    }

    // Migrate single WeCom config to multi-instance format
    const oldWecomSingle = this.getOne<{ value: string }>('SELECT value FROM im_config WHERE key = ?', ['wecomOpenClaw']);
    const existingWecomInstances = this.getAll<{ key: string }>('SELECT key FROM im_config WHERE key LIKE ?', ['wecom:%']);
    if (oldWecomSingle && existingWecomInstances.length === 0) {
      try {
        const oldConfig = JSON.parse(oldWecomSingle.value) as WecomOpenClawConfig;
        const instanceId = crypto.randomUUID();
        const instanceConfig: WecomInstanceConfig = {
          ...DEFAULT_WECOM_CONFIG,
          ...oldConfig,
          instanceId,
          instanceName: 'WeCom Bot 1',
        };
        const now = Date.now();
        this.run(
          'INSERT OR REPLACE INTO im_config (key, value, updated_at) VALUES (?, ?, ?)',
          [`wecom:${instanceId}`, JSON.stringify(instanceConfig), now]
        );
        this.run('DELETE FROM im_config WHERE key = ?', ['wecomOpenClaw']);
        const settings = this.getConfigValue<IMSettings>('settings');
        if (settings?.platformAgentBindings?.wecom) {
          settings.platformAgentBindings[`wecom:${instanceId}`] = settings.platformAgentBindings.wecom;
          delete settings.platformAgentBindings.wecom;
          this.run(
            'INSERT OR REPLACE INTO im_config (key, value, updated_at) VALUES (?, ?, ?)',
            ['settings', JSON.stringify(settings), now]
          );
        }
        changed = true;
      } catch {
        // Ignore parse errors
      }
    }

    if (changed) {
      this.saveDb();
    }
  }

  private getConfigValue<T>(key: string): T | undefined {
    const row = this.getOne<{ value: string }>('SELECT value FROM im_config WHERE key = ?', [key]);
    if (!row) return undefined;
    const value = row.value;
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      console.warn(`Failed to parse im_config value for ${key}`, error);
      return undefined;
    }
  }

  private setConfigValue<T>(key: string, value: T): void {
    const now = Date.now();
    this.run(`
      INSERT INTO im_config (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `, [key, JSON.stringify(value), now]);
    this.saveDb();
  }

  private deletePlatformAgentBinding(bindingKey: string): void {
    const settings = this.getIMSettings();
    if (!settings.platformAgentBindings?.[bindingKey]) {
      return;
    }

    const platformAgentBindings = { ...settings.platformAgentBindings };
    delete platformAgentBindings[bindingKey];
    this.setIMSettings({ platformAgentBindings });
  }

  private deleteInstanceSessionMappings(platform: Platform, instanceId: string): void {
    const accountId = instanceId.slice(0, 8);
    if (!accountId) {
      return;
    }
    this.run(
      'DELETE FROM im_session_mappings WHERE platform = ? AND im_conversation_id LIKE ?',
      [platform, `${accountId}:%`],
    );
    this.saveDb();
  }

  private replaceMultiInstanceConfig<TInstance extends { instanceId: string }>(
    platform: 'dingtalk' | 'discord' | 'feishu' | 'nim' | 'popo' | 'qq' | 'telegram' | 'wecom',
    nextInstances: TInstance[],
    currentInstances: TInstance[],
    setInstanceConfig: (instanceId: string, config: Partial<TInstance>) => void,
  ): void {
    const nextInstanceIds = new Set(nextInstances.map((instance) => instance.instanceId));
    for (const currentInstance of currentInstances) {
      if (!nextInstanceIds.has(currentInstance.instanceId)) {
        this.deletePlatformAgentBinding(`${platform}:${currentInstance.instanceId}`);
        this.run('DELETE FROM im_config WHERE key = ?', [`${platform}:${currentInstance.instanceId}`]);
      }
    }

    for (const instance of nextInstances) {
      setInstanceConfig(instance.instanceId, instance);
    }
    this.saveDb();
  }

  private migrateNimSingleConfigToInstanceIfNeeded(): void {
    const legacy = this.getConfigValue<NimConfig>('nim');
    const existingInstanceIds = this.getNimInstances({ migrateLegacy: false })
      .map((instance) => instance.instanceId);
    const plan = planSingleToMultiInstanceMigration({
      platform: ImSingleToMultiInstancePlatform.Nim,
      singleConfig: legacy,
      existingInstanceIds,
      createInstanceId: () => randomUUID(),
      defaultInstanceName: 'NIM Bot 1',
      shouldMigrateConfig: hasMeaningfulNimSingleConfig,
    });

    if (!plan.shouldMigrate || !plan.instance) {
      return;
    }

    const now = Date.now();
    this.run(
      'INSERT OR REPLACE INTO im_config (key, value, updated_at) VALUES (?, ?, ?)',
      [plan.instanceKey, JSON.stringify(plan.instance), now],
    );
    this.run('DELETE FROM im_config WHERE key = ?', ['nim']);
    this.saveDb();
  }

  private migratePopoSingleConfigToInstanceIfNeeded(): void {
    const legacy = this.getConfigValue<PopoOpenClawConfig>('popo');
    const existingInstanceIds = this.getPopoInstances({ migrateLegacy: false })
      .map((instance) => instance.instanceId);
    const plan = planSingleToMultiInstanceMigration({
      platform: ImSingleToMultiInstancePlatform.Popo,
      singleConfig: legacy,
      existingInstanceIds,
      createInstanceId: () => randomUUID(),
      defaultInstanceName: 'POPO Bot 1',
      shouldMigrateConfig: hasMeaningfulPopoSingleConfig,
    });

    if (!plan.shouldMigrate || !plan.instance) {
      return;
    }

    const now = Date.now();
    this.run(
      'INSERT OR REPLACE INTO im_config (key, value, updated_at) VALUES (?, ?, ?)',
      [plan.instanceKey, JSON.stringify(plan.instance), now],
    );
    this.run('DELETE FROM im_config WHERE key = ?', ['popo']);
    this.saveDb();
  }

  // ==================== Full Config Operations ====================

  getConfig(): IMGatewayConfig {
    const dingtalk = this.getDingTalkMultiInstanceConfig();
    const feishu = this.getFeishuMultiInstanceConfig();
    const telegram = this.getTelegramOpenClawConfig();
    const telegramMulti = this.getTelegramMultiInstanceConfig();
    const discord = this.getDiscordOpenClawConfig();
    const discordMulti = this.getDiscordMultiInstanceConfig();
    const nimMulti = this.getNimMultiInstanceConfig();
    const neteaseBeeChan = this.getConfigValue<NeteaseBeeChanConfig>('netease-bee') ?? DEFAULT_NETEASE_BEE_CONFIG;
    const qq = this.getQQMultiInstanceConfig();
    const wecom = this.getWecomMultiInstanceConfig();
    const popoMulti = this.getPopoMultiInstanceConfig();
    const weixin = this.getConfigValue<WeixinOpenClawConfig>('weixin') ?? DEFAULT_WEIXIN_CONFIG;
    const email = this.getEmailConfig();
    const settings = this.getConfigValue<IMSettings>('settings') ?? DEFAULT_IM_SETTINGS;

    // Resolve enabled field: default to false for safety
    // User must explicitly enable the service by setting enabled: true
    const resolveEnabled = <T extends { enabled?: boolean }>(stored: T, defaults: T): T => {
      const merged = { ...defaults, ...stored };
      // If enabled is not explicitly set, default to false (safer behavior)
      if (stored.enabled === undefined) {
        return { ...merged, enabled: false };
      }
      return merged;
    };

    const resolveInstanceEnabled = <
      T extends { instances: Array<{ enabled?: boolean }> }
    >(stored: T, defaults: T): T => ({
      ...defaults,
      ...stored,
      instances: (stored.instances ?? defaults.instances).map((instance) => {
        if (instance.enabled === undefined) {
          return { ...instance, enabled: false };
        }
        return instance;
      }) as T['instances'],
    });

    const nim = {
      ...this.getPrimaryNimConfig(),
      ...resolveInstanceEnabled(nimMulti, DEFAULT_NIM_MULTI_INSTANCE_CONFIG),
    } as NimMultiInstanceConfig;
    const popo = {
      ...this.getPrimaryPopoConfig(),
      ...resolveInstanceEnabled(popoMulti, DEFAULT_POPO_MULTI_INSTANCE_CONFIG),
    } as PopoMultiInstanceConfig;
    const telegramCompat = {
      ...resolveEnabled(telegram, DEFAULT_TELEGRAM_OPENCLAW_CONFIG),
      ...resolveInstanceEnabled(telegramMulti, DEFAULT_TELEGRAM_MULTI_INSTANCE_CONFIG),
    };
    const discordCompat = {
      ...resolveEnabled(discord, DEFAULT_DISCORD_OPENCLAW_CONFIG),
      ...resolveInstanceEnabled(discordMulti, DEFAULT_DISCORD_MULTI_INSTANCE_CONFIG),
    };

    return {
      dingtalk: resolveInstanceEnabled(dingtalk, DEFAULT_DINGTALK_MULTI_INSTANCE_CONFIG),
      feishu: resolveInstanceEnabled(feishu, DEFAULT_FEISHU_MULTI_INSTANCE_CONFIG),
      telegram: telegramCompat,
      discord: discordCompat,
      nim,
      'netease-bee': resolveEnabled(neteaseBeeChan, DEFAULT_NETEASE_BEE_CONFIG),
      qq: resolveInstanceEnabled(qq, DEFAULT_QQ_MULTI_INSTANCE_CONFIG),
      wecom: resolveInstanceEnabled(wecom, DEFAULT_WECOM_MULTI_INSTANCE_CONFIG),
      popo,
      weixin: resolveEnabled(weixin, DEFAULT_WEIXIN_CONFIG),
      email: resolveInstanceEnabled(email, DEFAULT_EMAIL_MULTI_INSTANCE_CONFIG),
      settings: { ...DEFAULT_IM_SETTINGS, ...settings },
    };
  }

  setConfig(config: Partial<IMGatewayConfig>): void {
    if (config.settings) {
      this.setIMSettings(config.settings);
    }
    if (config.dingtalk) {
      this.setDingTalkMultiInstanceConfig(config.dingtalk);
    }
    if (config.feishu) {
      this.setFeishuMultiInstanceConfig(config.feishu);
    }
    if (config.telegram) {
      if (Array.isArray(config.telegram.instances)) {
        this.setTelegramMultiInstanceConfig(config.telegram);
      }
      const { instances: _instances, ...singleConfig } = config.telegram;
      this.setTelegramOpenClawConfig(singleConfig);
    }
    if (config.discord) {
      if (Array.isArray(config.discord.instances)) {
        this.setDiscordMultiInstanceConfig(config.discord);
      }
      const { instances: _instances, ...singleConfig } = config.discord;
      this.setDiscordOpenClawConfig(singleConfig);
    }
    if (config.nim) {
      if (Array.isArray(config.nim.instances)) {
        this.setNimMultiInstanceConfig(config.nim);
      } else {
        this.setNimConfig(config.nim as Partial<NimConfig>);
      }
    }
    if (config['netease-bee']) {
      this.setNeteaseBeeChanConfig(config['netease-bee']);
    }
    if (config.qq) {
      this.setQQMultiInstanceConfig(config.qq);
    }
    if (config.wecom) {
      this.setWecomMultiInstanceConfig(config.wecom);
    }
    if (config.popo) {
      if (Array.isArray(config.popo.instances)) {
        this.setPopoMultiInstanceConfig(config.popo);
      } else {
        this.setPopoConfig(config.popo as Partial<PopoOpenClawConfig>);
      }
    }
    if (config.weixin) {
      this.setWeixinConfig(config.weixin);
    }
    if (config.email) {
      this.setEmailConfig(config.email);
    }
  }

  // ==================== DingTalk OpenClaw Config ====================

  getDingTalkOpenClawConfig(): DingTalkOpenClawConfig {
    return this.getDingTalkInstances()[0] ?? { ...DEFAULT_DINGTALK_OPENCLAW_CONFIG };
  }

  setDingTalkOpenClawConfig(config: Partial<DingTalkOpenClawConfig>): void {
    const current = this.getDingTalkInstances()[0];
    if (current) {
      this.setDingTalkInstanceConfig(current.instanceId, config);
      return;
    }
    const instanceId = crypto.randomUUID();
    this.setDingTalkInstanceConfig(instanceId, {
      ...config,
      instanceId,
      instanceName: 'DingTalk Bot 1',
    });
  }

  getDingTalkInstances(): DingTalkInstanceConfig[] {
    const rows = this.getAll<{ key: string; value: string }>('SELECT key, value FROM im_config WHERE key LIKE ?', ['dingtalk:%']);
    return rows.flatMap((row) => {
      try {
        const config = JSON.parse(row.value) as DingTalkInstanceConfig;
        return [{ ...DEFAULT_DINGTALK_OPENCLAW_CONFIG, ...config }];
      } catch {
        return [];
      }
    });
  }

  getDingTalkInstanceConfig(instanceId: string): DingTalkInstanceConfig | null {
    const stored = this.getConfigValue<DingTalkInstanceConfig>(`dingtalk:${instanceId}`);
    return stored ? { ...DEFAULT_DINGTALK_OPENCLAW_CONFIG, ...stored } : null;
  }

  setDingTalkInstanceConfig(instanceId: string, config: Partial<DingTalkInstanceConfig>): void {
    const current = this.getDingTalkInstanceConfig(instanceId);
    this.setConfigValue(`dingtalk:${instanceId}`, current
      ? { ...current, ...config }
      : {
          ...DEFAULT_DINGTALK_OPENCLAW_CONFIG,
          instanceId,
          instanceName: config.instanceName || 'DingTalk Bot',
          ...config,
        });
  }

  deleteDingTalkInstance(instanceId: string): void {
    this.deletePlatformAgentBinding(`dingtalk:${instanceId}`);
    this.run('DELETE FROM im_config WHERE key = ?', [`dingtalk:${instanceId}`]);
    this.saveDb();
  }

  getDingTalkMultiInstanceConfig(): DingTalkMultiInstanceConfig {
    const instances = this.getDingTalkInstances();
    return instances.length > 0 ? { instances } : DEFAULT_DINGTALK_MULTI_INSTANCE_CONFIG;
  }

  setDingTalkMultiInstanceConfig(config: DingTalkMultiInstanceConfig): void {
    this.replaceMultiInstanceConfig(
      'dingtalk',
      config.instances,
      this.getDingTalkInstances(),
      (instanceId, instance) => this.setDingTalkInstanceConfig(instanceId, instance),
    );
  }

  // ==================== Feishu OpenClaw Config ====================

  getFeishuOpenClawConfig(): FeishuOpenClawConfig {
    return this.getFeishuInstances()[0] ?? { ...DEFAULT_FEISHU_OPENCLAW_CONFIG };
  }

  setFeishuOpenClawConfig(config: Partial<FeishuOpenClawConfig>): void {
    const current = this.getFeishuInstances()[0];
    if (current) {
      this.setFeishuInstanceConfig(current.instanceId, config);
      return;
    }
    const instanceId = crypto.randomUUID();
    this.setFeishuInstanceConfig(instanceId, {
      ...config,
      instanceId,
      instanceName: 'Feishu Bot 1',
    });
  }

  getFeishuInstances(): FeishuInstanceConfig[] {
    const rows = this.getAll<{ key: string; value: string }>('SELECT key, value FROM im_config WHERE key LIKE ?', ['feishu:%']);
    return rows.flatMap((row) => {
      try {
        const config = JSON.parse(row.value) as FeishuInstanceConfig;
        return [{ ...DEFAULT_FEISHU_OPENCLAW_CONFIG, ...config }];
      } catch {
        return [];
      }
    });
  }

  getFeishuInstanceConfig(instanceId: string): FeishuInstanceConfig | null {
    const stored = this.getConfigValue<FeishuInstanceConfig>(`feishu:${instanceId}`);
    return stored ? { ...DEFAULT_FEISHU_OPENCLAW_CONFIG, ...stored } : null;
  }

  setFeishuInstanceConfig(instanceId: string, config: Partial<FeishuInstanceConfig>): void {
    const current = this.getFeishuInstanceConfig(instanceId);
    this.setConfigValue(`feishu:${instanceId}`, current
      ? { ...current, ...config }
      : {
          ...DEFAULT_FEISHU_OPENCLAW_CONFIG,
          instanceId,
          instanceName: config.instanceName || 'Feishu Bot',
          ...config,
        });
  }

  deleteFeishuInstance(instanceId: string): void {
    this.deletePlatformAgentBinding(`feishu:${instanceId}`);
    this.run('DELETE FROM im_config WHERE key = ?', [`feishu:${instanceId}`]);
    this.saveDb();
  }

  getFeishuMultiInstanceConfig(): FeishuMultiInstanceConfig {
    const instances = this.getFeishuInstances();
    return instances.length > 0 ? { instances } : DEFAULT_FEISHU_MULTI_INSTANCE_CONFIG;
  }

  setFeishuMultiInstanceConfig(config: FeishuMultiInstanceConfig): void {
    this.replaceMultiInstanceConfig(
      'feishu',
      config.instances,
      this.getFeishuInstances(),
      (instanceId, instance) => this.setFeishuInstanceConfig(instanceId, instance),
    );
  }

  // ==================== Discord OpenClaw Config ====================

  getDiscordOpenClawConfig(): DiscordOpenClawConfig {
    return this.getDiscordInstances()[0] ?? {
      ...DEFAULT_DISCORD_OPENCLAW_CONFIG,
      ...this.getConfigValue<DiscordOpenClawConfig>('discordOpenClaw'),
    };
  }

  setDiscordOpenClawConfig(config: Partial<DiscordOpenClawConfig>): void {
    const current = {
      ...DEFAULT_DISCORD_OPENCLAW_CONFIG,
      ...this.getConfigValue<DiscordOpenClawConfig>('discordOpenClaw'),
    };
    this.setConfigValue('discordOpenClaw', { ...current, ...config });
    const first = this.getDiscordInstances()[0];
    if (first) {
      this.setDiscordInstanceConfig(first.instanceId, config);
    }
  }

  getDiscordInstances(): DiscordInstanceConfig[] {
    const rows = this.getAll<{ key: string; value: string }>('SELECT key, value FROM im_config WHERE key LIKE ?', ['discord:%']);
    return rows.flatMap((row) => {
      try {
        const config = JSON.parse(row.value) as DiscordInstanceConfig;
        return [{ ...DEFAULT_DISCORD_OPENCLAW_CONFIG, ...config }];
      } catch {
        return [];
      }
    });
  }

  getDiscordInstanceConfig(instanceId: string): DiscordInstanceConfig | null {
    const stored = this.getConfigValue<DiscordInstanceConfig>(`discord:${instanceId}`);
    return stored ? { ...DEFAULT_DISCORD_OPENCLAW_CONFIG, ...stored } : null;
  }

  setDiscordInstanceConfig(instanceId: string, config: Partial<DiscordInstanceConfig>): void {
    const current = this.getDiscordInstanceConfig(instanceId);
    this.setConfigValue(`discord:${instanceId}`, current
      ? { ...current, ...config }
      : {
          ...DEFAULT_DISCORD_OPENCLAW_CONFIG,
          instanceId,
          instanceName: config.instanceName || 'Discord Bot',
          ...config,
        });
  }

  deleteDiscordInstance(instanceId: string): void {
    this.deletePlatformAgentBinding(`discord:${instanceId}`);
    this.run('DELETE FROM im_config WHERE key = ?', [`discord:${instanceId}`]);
    this.deleteInstanceSessionMappings('discord', instanceId);
    this.saveDb();
  }

  getDiscordMultiInstanceConfig(): DiscordMultiInstanceConfig {
    const instances = this.getDiscordInstances();
    return instances.length > 0 ? { instances } : DEFAULT_DISCORD_MULTI_INSTANCE_CONFIG;
  }

  setDiscordMultiInstanceConfig(config: DiscordMultiInstanceConfig): void {
    this.replaceMultiInstanceConfig(
      'discord',
      config.instances,
      this.getDiscordInstances(),
      (instanceId, instance) => this.setDiscordInstanceConfig(instanceId, instance),
    );
  }

  // ==================== NIM Config ====================

  getNimConfig(): NimConfig {
    return this.getPrimaryNimConfig();
  }

  setNimConfig(config: Partial<NimConfig>): void {
    const primaryInstance = pickPrimaryNimInstance(this.getNimInstances());
    if (primaryInstance) {
      this.setNimInstanceConfig(primaryInstance.instanceId, {
        ...primaryInstance,
        ...config,
      });
      return;
    }

    const current = this.getPrimaryNimConfig();
    this.setConfigValue('nim', { ...current, ...config });
  }

  private getPrimaryNimConfig(): NimConfig {
    const instances = this.getNimInstances();
    const primaryInstance = pickPrimaryNimInstance(instances);
    if (primaryInstance) {
      const { instanceId: _instanceId, instanceName: _instanceName, ...config } = primaryInstance;
      return { ...DEFAULT_NIM_CONFIG, ...config };
    }

    const stored = this.getConfigValue<NimConfig>('nim');
    return { ...DEFAULT_NIM_CONFIG, ...stored };
  }

  getNimInstances(options: { migrateLegacy?: boolean } = {}): NimInstanceConfig[] {
    const rows = this.getAll<{ key: string; value: string }>('SELECT key, value FROM im_config WHERE key LIKE ?', ['nim:%']);
    if (rows.length > 0) {
      return rows.flatMap((row) => {
        try {
          const config = JSON.parse(row.value) as NimInstanceConfig;
          return [{ ...DEFAULT_NIM_CONFIG, ...config }];
        } catch {
          return [];
        }
      });
    }

    if (options.migrateLegacy === false) {
      return [];
    }

    this.migrateNimSingleConfigToInstanceIfNeeded();
    const migratedRows = this.getAll<{ key: string; value: string }>('SELECT key, value FROM im_config WHERE key LIKE ?', ['nim:%']);
    return migratedRows.flatMap((row) => {
      try {
        const config = JSON.parse(row.value) as NimInstanceConfig;
        return [{ ...DEFAULT_NIM_CONFIG, ...config }];
      } catch {
        return [];
      }
    });
  }

  getNimInstanceConfig(instanceId: string): NimInstanceConfig | null {
    const stored = this.getConfigValue<NimInstanceConfig>(`nim:${instanceId}`);
    return stored ? { ...DEFAULT_NIM_CONFIG, ...stored } : null;
  }

  setNimInstanceConfig(instanceId: string, config: Partial<NimInstanceConfig>): void {
    const current = this.getNimInstanceConfig(instanceId);
    this.setConfigValue(`nim:${instanceId}`, current
      ? { ...current, ...config }
      : {
          ...DEFAULT_NIM_CONFIG,
          instanceId,
          instanceName: config.instanceName || 'NIM Bot',
          ...config,
        });
    this.run('DELETE FROM im_config WHERE key = ?', ['nim']);
    this.saveDb();
  }

  deleteNimInstance(instanceId: string): void {
    this.deletePlatformAgentBinding(`nim:${instanceId}`);
    this.run('DELETE FROM im_config WHERE key = ?', [`nim:${instanceId}`]);
    this.run('DELETE FROM im_session_mappings WHERE platform = ?', [`nim:${instanceId}`]);
    this.saveDb();
  }

  getNimMultiInstanceConfig(): NimMultiInstanceConfig {
    const instances = this.getNimInstances();
    return instances.length > 0 ? { instances } : DEFAULT_NIM_MULTI_INSTANCE_CONFIG;
  }

  setNimMultiInstanceConfig(config: NimMultiInstanceConfig): void {
    this.replaceMultiInstanceConfig(
      'nim',
      config.instances,
      this.getNimInstances(),
      (instanceId, instance) => this.setNimInstanceConfig(instanceId, instance),
    );
  }

  // ==================== NeteaseBee Chan Config ====================

  getNeteaseBeeChanConfig(): NeteaseBeeChanConfig {
    const stored = this.getConfigValue<NeteaseBeeChanConfig>('netease-bee');
    return { ...DEFAULT_NETEASE_BEE_CONFIG, ...stored };
  }

  setNeteaseBeeChanConfig(config: Partial<NeteaseBeeChanConfig>): void {
    const current = this.getNeteaseBeeChanConfig();
    this.setConfigValue('netease-bee', { ...current, ...config });
  }

  // ==================== Telegram OpenClaw Config ====================

  getTelegramOpenClawConfig(): TelegramOpenClawConfig {
    return this.getTelegramInstances()[0] ?? {
      ...DEFAULT_TELEGRAM_OPENCLAW_CONFIG,
      ...this.getConfigValue<TelegramOpenClawConfig>('telegramOpenClaw'),
    };
  }

  setTelegramOpenClawConfig(config: Partial<TelegramOpenClawConfig>): void {
    const current = {
      ...DEFAULT_TELEGRAM_OPENCLAW_CONFIG,
      ...this.getConfigValue<TelegramOpenClawConfig>('telegramOpenClaw'),
    };
    this.setConfigValue('telegramOpenClaw', { ...current, ...config });
    const first = this.getTelegramInstances()[0];
    if (first) {
      this.setTelegramInstanceConfig(first.instanceId, config);
    }
  }

  getTelegramInstances(): TelegramInstanceConfig[] {
    const rows = this.getAll<{ key: string; value: string }>('SELECT key, value FROM im_config WHERE key LIKE ?', ['telegram:%']);
    return rows.flatMap((row) => {
      try {
        const config = JSON.parse(row.value) as TelegramInstanceConfig;
        return [{ ...DEFAULT_TELEGRAM_OPENCLAW_CONFIG, ...config }];
      } catch {
        return [];
      }
    });
  }

  getTelegramInstanceConfig(instanceId: string): TelegramInstanceConfig | null {
    const stored = this.getConfigValue<TelegramInstanceConfig>(`telegram:${instanceId}`);
    return stored ? { ...DEFAULT_TELEGRAM_OPENCLAW_CONFIG, ...stored } : null;
  }

  setTelegramInstanceConfig(instanceId: string, config: Partial<TelegramInstanceConfig>): void {
    const current = this.getTelegramInstanceConfig(instanceId);
    this.setConfigValue(`telegram:${instanceId}`, current
      ? { ...current, ...config }
      : {
          ...DEFAULT_TELEGRAM_OPENCLAW_CONFIG,
          instanceId,
          instanceName: config.instanceName || 'Telegram Bot',
          ...config,
        });
  }

  deleteTelegramInstance(instanceId: string): void {
    this.deletePlatformAgentBinding(`telegram:${instanceId}`);
    this.run('DELETE FROM im_config WHERE key = ?', [`telegram:${instanceId}`]);
    this.deleteInstanceSessionMappings('telegram', instanceId);
    this.saveDb();
  }

  getTelegramMultiInstanceConfig(): TelegramMultiInstanceConfig {
    const instances = this.getTelegramInstances();
    return instances.length > 0 ? { instances } : DEFAULT_TELEGRAM_MULTI_INSTANCE_CONFIG;
  }

  setTelegramMultiInstanceConfig(config: TelegramMultiInstanceConfig): void {
    this.replaceMultiInstanceConfig(
      'telegram',
      config.instances,
      this.getTelegramInstances(),
      (instanceId, instance) => this.setTelegramInstanceConfig(instanceId, instance),
    );
  }

  // ==================== QQ Config ====================

  getQQConfig(): QQConfig {
    return this.getQQInstances()[0] ?? { ...DEFAULT_QQ_CONFIG };
  }

  setQQConfig(config: Partial<QQConfig>): void {
    const current = this.getQQInstances()[0];
    if (current) {
      this.setQQInstanceConfig(current.instanceId, config);
      return;
    }
    const instanceId = crypto.randomUUID();
    this.setQQInstanceConfig(instanceId, {
      ...config,
      instanceId,
      instanceName: 'QQ Bot 1',
    });
  }

  getQQInstances(): QQInstanceConfig[] {
    const rows = this.getAll<{ key: string; value: string }>('SELECT key, value FROM im_config WHERE key LIKE ?', ['qq:%']);
    return rows.flatMap((row) => {
      try {
        const config = JSON.parse(row.value) as QQInstanceConfig;
        return [{ ...DEFAULT_QQ_CONFIG, ...config }];
      } catch {
        return [];
      }
    });
  }

  getQQInstanceConfig(instanceId: string): QQInstanceConfig | null {
    const stored = this.getConfigValue<QQInstanceConfig>(`qq:${instanceId}`);
    return stored ? { ...DEFAULT_QQ_CONFIG, ...stored } : null;
  }

  setQQInstanceConfig(instanceId: string, config: Partial<QQInstanceConfig>): void {
    const current = this.getQQInstanceConfig(instanceId);
    this.setConfigValue(`qq:${instanceId}`, current
      ? { ...current, ...config }
      : {
          ...DEFAULT_QQ_CONFIG,
          instanceId,
          instanceName: config.instanceName || 'QQ Bot',
          ...config,
        });
  }

  deleteQQInstance(instanceId: string): void {
    this.deletePlatformAgentBinding(`qq:${instanceId}`);
    this.run('DELETE FROM im_config WHERE key = ?', [`qq:${instanceId}`]);
    this.saveDb();
  }

  getQQMultiInstanceConfig(): QQMultiInstanceConfig {
    const instances = this.getQQInstances();
    return instances.length > 0 ? { instances } : DEFAULT_QQ_MULTI_INSTANCE_CONFIG;
  }

  setQQMultiInstanceConfig(config: QQMultiInstanceConfig): void {
    this.replaceMultiInstanceConfig(
      'qq',
      config.instances,
      this.getQQInstances(),
      (instanceId, instance) => this.setQQInstanceConfig(instanceId, instance),
    );
  }

  // ==================== WeCom OpenClaw Config ====================

  getWecomConfig(): WecomOpenClawConfig {
    return this.getWecomInstances()[0] ?? { ...DEFAULT_WECOM_CONFIG };
  }

  setWecomConfig(config: Partial<WecomOpenClawConfig>): void {
    const current = this.getWecomInstances()[0];
    if (current) {
      this.setWecomInstanceConfig(current.instanceId, config);
      return;
    }
    const instanceId = crypto.randomUUID();
    this.setWecomInstanceConfig(instanceId, {
      ...config,
      instanceId,
      instanceName: 'WeCom Bot 1',
    });
  }

  getWecomInstances(): WecomInstanceConfig[] {
    const rows = this.getAll<{ key: string; value: string }>('SELECT key, value FROM im_config WHERE key LIKE ?', ['wecom:%']);
    return rows.flatMap((row) => {
      try {
        const config = JSON.parse(row.value) as WecomInstanceConfig;
        return [{ ...DEFAULT_WECOM_CONFIG, ...config }];
      } catch {
        return [];
      }
    });
  }

  getWecomInstanceConfig(instanceId: string): WecomInstanceConfig | null {
    const stored = this.getConfigValue<WecomInstanceConfig>(`wecom:${instanceId}`);
    return stored ? { ...DEFAULT_WECOM_CONFIG, ...stored } : null;
  }

  setWecomInstanceConfig(instanceId: string, config: Partial<WecomInstanceConfig>): void {
    const current = this.getWecomInstanceConfig(instanceId);
    this.setConfigValue(`wecom:${instanceId}`, current
      ? { ...current, ...config }
      : {
          ...DEFAULT_WECOM_CONFIG,
          instanceId,
          instanceName: config.instanceName || 'WeCom Bot',
          ...config,
        });
  }

  deleteWecomInstance(instanceId: string): void {
    this.deletePlatformAgentBinding(`wecom:${instanceId}`);
    this.run('DELETE FROM im_config WHERE key = ?', [`wecom:${instanceId}`]);
    this.saveDb();
  }

  getWecomMultiInstanceConfig(): WecomMultiInstanceConfig {
    const instances = this.getWecomInstances();
    return instances.length > 0 ? { instances } : DEFAULT_WECOM_MULTI_INSTANCE_CONFIG;
  }

  setWecomMultiInstanceConfig(config: WecomMultiInstanceConfig): void {
    this.replaceMultiInstanceConfig(
      'wecom',
      config.instances,
      this.getWecomInstances(),
      (instanceId, instance) => this.setWecomInstanceConfig(instanceId, instance),
    );
  }

  // ==================== POPO ====================

  getPopoConfig(): PopoOpenClawConfig {
    return this.getPrimaryPopoConfig();
  }

  setPopoConfig(config: Partial<PopoOpenClawConfig>): void {
    const primaryInstance = pickPrimaryPopoInstance(this.getPopoInstances());
    if (primaryInstance) {
      this.setPopoInstanceConfig(primaryInstance.instanceId, {
        ...primaryInstance,
        ...config,
      });
      return;
    }

    const current = this.getPrimaryPopoConfig();
    this.setConfigValue('popo', { ...current, ...config });
  }

  private getPrimaryPopoConfig(): PopoOpenClawConfig {
    const instances = this.getPopoInstances();
    const primaryInstance = pickPrimaryPopoInstance(instances);
    if (primaryInstance) {
      const { instanceId: _instanceId, instanceName: _instanceName, ...config } = primaryInstance;
      return { ...DEFAULT_POPO_CONFIG, ...config };
    }

    const stored = this.getConfigValue<PopoOpenClawConfig>('popo');
    return { ...DEFAULT_POPO_CONFIG, ...stored };
  }

  getPopoInstances(options: { migrateLegacy?: boolean } = {}): PopoInstanceConfig[] {
    const rows = this.getAll<{ key: string; value: string }>('SELECT key, value FROM im_config WHERE key LIKE ?', ['popo:%']);
    if (rows.length > 0) {
      return rows.flatMap((row) => {
        try {
          const config = JSON.parse(row.value) as PopoInstanceConfig;
          return [{ ...DEFAULT_POPO_CONFIG, ...config }];
        } catch {
          return [];
        }
      });
    }

    if (options.migrateLegacy === false) {
      return [];
    }

    this.migratePopoSingleConfigToInstanceIfNeeded();
    const migratedRows = this.getAll<{ key: string; value: string }>('SELECT key, value FROM im_config WHERE key LIKE ?', ['popo:%']);
    return migratedRows.flatMap((row) => {
      try {
        const config = JSON.parse(row.value) as PopoInstanceConfig;
        return [{ ...DEFAULT_POPO_CONFIG, ...config }];
      } catch {
        return [];
      }
    });
  }

  getPopoInstanceConfig(instanceId: string): PopoInstanceConfig | null {
    const stored = this.getConfigValue<PopoInstanceConfig>(`popo:${instanceId}`);
    return stored ? { ...DEFAULT_POPO_CONFIG, ...stored } : null;
  }

  setPopoInstanceConfig(instanceId: string, config: Partial<PopoInstanceConfig>): void {
    const current = this.getPopoInstanceConfig(instanceId);
    this.setConfigValue(`popo:${instanceId}`, current
      ? { ...current, ...config }
      : {
          ...DEFAULT_POPO_CONFIG,
          instanceId,
          instanceName: config.instanceName || 'POPO Bot',
          ...config,
        });
    this.run('DELETE FROM im_config WHERE key = ?', ['popo']);
    this.saveDb();
  }

  deletePopoInstance(instanceId: string): void {
    this.deletePlatformAgentBinding(`popo:${instanceId}`);
    this.run('DELETE FROM im_config WHERE key = ?', [`popo:${instanceId}`]);
    this.run('DELETE FROM im_session_mappings WHERE platform = ?', [`popo:${instanceId}`]);
    this.saveDb();
  }

  getPopoMultiInstanceConfig(): PopoMultiInstanceConfig {
    const instances = this.getPopoInstances();
    return instances.length > 0 ? { instances } : DEFAULT_POPO_MULTI_INSTANCE_CONFIG;
  }

  setPopoMultiInstanceConfig(config: PopoMultiInstanceConfig): void {
    this.replaceMultiInstanceConfig(
      'popo',
      config.instances,
      this.getPopoInstances(),
      (instanceId, instance) => this.setPopoInstanceConfig(instanceId, instance),
    );
  }

  // ==================== Weixin (微信) ====================

  getWeixinConfig(): WeixinOpenClawConfig {
    const stored = this.getConfigValue<WeixinOpenClawConfig>('weixin');
    return { ...DEFAULT_WEIXIN_CONFIG, ...stored };
  }

  setWeixinConfig(config: Partial<WeixinOpenClawConfig>): void {
    const current = this.getWeixinConfig();
    this.setConfigValue('weixin', { ...current, ...config });
  }

  // ==================== Email Channel Config ====================

  getEmailConfig(): EmailMultiInstanceConfig {
    const stored = this.getConfigValue<EmailMultiInstanceConfig | (Partial<EmailInstanceConfig> & { email?: string })>('email');
    if (!stored) {
      return DEFAULT_EMAIL_MULTI_INSTANCE_CONFIG;
    }

    if ('instances' in stored && Array.isArray(stored.instances)) {
      return {
        instances: stored.instances.map((instance) => ({
          ...DEFAULT_EMAIL_INSTANCE_CONFIG,
          ...instance,
        } as EmailInstanceConfig)),
      };
    }

    if (isLegacyEmailInstanceConfig(stored)) {
      return {
        instances: [{
          ...DEFAULT_EMAIL_INSTANCE_CONFIG,
          ...stored,
          instanceId: stored.instanceId ?? 'email-1',
          instanceName: stored.instanceName ?? 'Default',
          enabled: stored.enabled ?? false,
          transport: stored.transport ?? 'imap',
          email: stored.email,
          agentId: stored.agentId ?? 'main',
        } as EmailInstanceConfig],
      };
    }

    return DEFAULT_EMAIL_MULTI_INSTANCE_CONFIG;
  }

  setEmailConfig(config: EmailMultiInstanceConfig): void {
    this.setConfigValue('email', config);
  }

  setEmailInstanceConfig(instanceId: string, config: Partial<EmailInstanceConfig>): void {
    const current = this.getEmailConfig();
    const existing = current.instances.find((instance) => instance.instanceId === instanceId);
    const nextInstance = {
      ...DEFAULT_EMAIL_INSTANCE_CONFIG,
      ...existing,
      ...config,
      instanceId,
      instanceName: config.instanceName ?? existing?.instanceName ?? 'Email Bot',
    } as EmailInstanceConfig;
    const nextInstances = existing
      ? current.instances.map((instance) => instance.instanceId === instanceId ? nextInstance : instance)
      : [...current.instances, nextInstance];
    this.setEmailConfig({ instances: nextInstances });
  }

  deleteEmailInstance(instanceId: string): void {
    this.deletePlatformAgentBinding(`email:${instanceId}`);
    const current = this.getEmailConfig();
    this.setEmailConfig({
      instances: current.instances.filter((instance) => instance.instanceId !== instanceId),
    });
  }

  // ==================== IM Settings ====================

  getIMSettings(): IMSettings {
    const stored = this.getConfigValue<IMSettings>('settings');
    return { ...DEFAULT_IM_SETTINGS, ...stored };
  }

  setIMSettings(settings: Partial<IMSettings>): void {
    const current = this.getIMSettings();
    this.setConfigValue('settings', { ...current, ...settings });
  }

  // ==================== Utility ====================

  /**
   * Clear all IM configuration
   */
  clearConfig(): void {
    this.run('DELETE FROM im_config');
    this.saveDb();
  }

  /**
   * Check if IM is configured (at least one platform has credentials)
   */
  isConfigured(): boolean {
    const config = this.getConfig();
    const hasDingTalk = this.getDingTalkInstances().some((instance) => !!(instance.clientId && instance.clientSecret));
    const hasFeishu = this.getFeishuInstances().some((instance) => !!(instance.appId && instance.appSecret));
    const hasTelegram = !!config.telegram.botToken;
    const hasDiscord = !!config.discord.botToken;
    const hasNim = this.getNimInstances().some((instance) => !!(
      (instance.nimToken && instance.nimToken.trim())
      || (instance.appKey && instance.account && instance.token)
    ));
    const hasNeteaseBeeChan = !!(config['netease-bee']?.clientId && config['netease-bee']?.secret);
    const hasQQ = this.getQQInstances().some((instance) => !!(instance.appId && instance.appSecret));
    const hasWecom = this.getWecomInstances().some((instance) => !!(instance.botId && instance.secret));
    const hasPopo = this.getPopoInstances().some((instance) => !!(
      instance.appKey
      && instance.appSecret
      && instance.aesKey
      && ((instance.connectionMode ?? 'websocket') === 'websocket' || instance.token)
    ));
    return hasDingTalk || hasFeishu || hasTelegram || hasDiscord || hasNim || hasNeteaseBeeChan || hasQQ || hasWecom || hasPopo;
  }

  // ==================== Notification Target Persistence ====================

  /**
   * Get persisted notification target for a platform
   */
  getNotificationTarget(platform: Platform): string | null {
    return this.getConfigValue<string>(`notification_target:${platform}`) ?? null;
  }

  /**
   * Persist notification target for a platform
   */
  setNotificationTarget(platform: Platform, target: string): void {
    this.setConfigValue(`notification_target:${platform}`, target);
  }

  getConversationReplyRoute(
    platform: Platform,
    conversationId: string,
  ): StoredConversationReplyRoute | null {
    const normalizedConversationId = conversationId.trim();
    if (!normalizedConversationId) {
      return null;
    }
    return this.getConfigValue<StoredConversationReplyRoute>(
      `conversation_reply_route:${platform}:${normalizedConversationId}`,
    ) ?? null;
  }

  setConversationReplyRoute(
    platform: Platform,
    conversationId: string,
    route: StoredConversationReplyRoute,
  ): void {
    const normalizedConversationId = conversationId.trim();
    if (!normalizedConversationId) {
      return;
    }
    this.setConfigValue(`conversation_reply_route:${platform}:${normalizedConversationId}`, route);
  }

  // ==================== Session Mapping Operations ====================

  /**
   * Get session mapping by IM conversation ID and platform
   */
  getSessionMapping(imConversationId: string, platform: Platform): IMSessionMapping | null {
    const row = this.getOne<IMSessionMappingRow>(
      'SELECT im_conversation_id, platform, cowork_session_id, agent_id, openclaw_session_key, created_at, last_active_at FROM im_session_mappings WHERE im_conversation_id = ? AND platform = ?',
      [imConversationId, platform]
    );
    return row ? mapIMSessionMappingRow(row) : null;
  }

  /**
   * Find the IM mapping that owns a given cowork session ID.
   */
  getSessionMappingByCoworkSessionId(coworkSessionId: string): IMSessionMapping | null {
    const row = this.getOne<IMSessionMappingRow>(
      'SELECT im_conversation_id, platform, cowork_session_id, agent_id, openclaw_session_key, created_at, last_active_at FROM im_session_mappings WHERE cowork_session_id = ? LIMIT 1',
      [coworkSessionId]
    );
    return row ? mapIMSessionMappingRow(row) : null;
  }

  /**
   * Create a new session mapping
   */
  createSessionMapping(
    imConversationId: string,
    platform: Platform,
    coworkSessionId: string,
    agentId: string = 'main',
    openClawSessionKey: string = '',
  ): IMSessionMapping {
    const now = Date.now();
    const normalizedOpenClawSessionKey = openClawSessionKey.trim();
    this.run(
      'INSERT INTO im_session_mappings (im_conversation_id, platform, cowork_session_id, agent_id, openclaw_session_key, created_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [imConversationId, platform, coworkSessionId, agentId, normalizedOpenClawSessionKey || null, now, now]
    );
    this.saveDb();
    return {
      imConversationId,
      platform,
      coworkSessionId,
      agentId,
      ...(normalizedOpenClawSessionKey ? { openClawSessionKey: normalizedOpenClawSessionKey } : {}),
      createdAt: now,
      lastActiveAt: now,
    };
  }

  /**
   * Update last active time for a session mapping
   */
  updateSessionLastActive(imConversationId: string, platform: Platform): void {
    const now = Date.now();
    this.run(
      'UPDATE im_session_mappings SET last_active_at = ? WHERE im_conversation_id = ? AND platform = ?',
      [now, imConversationId, platform]
    );
    this.saveDb();
  }

  /**
   * Update the target session and agent for an existing mapping.
   * Used when the platform's agent binding changes.
   */
  updateSessionMappingTarget(
    imConversationId: string,
    platform: Platform,
    newCoworkSessionId: string,
    newAgentId: string,
    newOpenClawSessionKey?: string,
  ): void {
    const now = Date.now();
    const normalizedOpenClawSessionKey = newOpenClawSessionKey?.trim() || null;
    this.run(
      'UPDATE im_session_mappings SET cowork_session_id = ?, agent_id = ?, openclaw_session_key = COALESCE(?, openclaw_session_key), last_active_at = ? WHERE im_conversation_id = ? AND platform = ?',
      [newCoworkSessionId, newAgentId, normalizedOpenClawSessionKey, now, imConversationId, platform]
    );
    this.saveDb();
  }

  updateSessionOpenClawSessionKey(
    imConversationId: string,
    platform: Platform,
    openClawSessionKey: string,
  ): void {
    const normalizedKey = openClawSessionKey.trim();
    if (!normalizedKey) return;
    const now = Date.now();
    this.run(
      'UPDATE im_session_mappings SET openclaw_session_key = ?, last_active_at = ? WHERE im_conversation_id = ? AND platform = ?',
      [normalizedKey, now, imConversationId, platform]
    );
    this.saveDb();
  }

  /**
   * Delete a session mapping
   */
  deleteSessionMapping(imConversationId: string, platform: Platform): void {
    this.run(
      'DELETE FROM im_session_mappings WHERE im_conversation_id = ? AND platform = ?',
      [imConversationId, platform]
    );
    this.saveDb();
  }

  /**
   * Delete all session mappings that reference a given cowork session ID.
   * Called when a cowork session is deleted so that the IM conversation
   * can be re-synced as a fresh session.
   */
  deleteSessionMappingByCoworkSessionId(coworkSessionId: string): void {
    this.run(
      'DELETE FROM im_session_mappings WHERE cowork_session_id = ?',
      [coworkSessionId]
    );
    this.saveDb();
  }

  /**
   * List all session mappings for a platform, optionally filtered by IM bot accountId.
   */
  listSessionMappings(platform?: Platform, accountId?: string): IMSessionMapping[] {
    let query: string;
    let params: string[] = [];

    if (platform && accountId) {
      query = "SELECT im_conversation_id, platform, cowork_session_id, agent_id, openclaw_session_key, created_at, last_active_at FROM im_session_mappings WHERE platform = ? AND (im_conversation_id LIKE ? OR im_conversation_id LIKE 'group:%') ORDER BY last_active_at DESC";
      params = [platform, `${accountId}:%`];
    } else if (platform) {
      query = 'SELECT im_conversation_id, platform, cowork_session_id, agent_id, openclaw_session_key, created_at, last_active_at FROM im_session_mappings WHERE platform = ? ORDER BY last_active_at DESC';
      params = [platform];
    } else {
      query = 'SELECT im_conversation_id, platform, cowork_session_id, agent_id, openclaw_session_key, created_at, last_active_at FROM im_session_mappings ORDER BY last_active_at DESC';
    }

    return this.getAll<IMSessionMappingRow>(query, params).map(mapIMSessionMappingRow);
  }
}
