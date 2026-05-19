/**
 * IM Service
 * IPC wrapper for IM gateway operations
 */

import type { Platform } from '@shared/platform';
import { PlatformRegistry } from '@shared/platform';

import { store } from '../store';
import {
  addDingTalkInstance,
  addDiscordInstance,
  addEmailInstance,
  addFeishuInstance,
  addNimInstance,
  addPopoInstance,
  addQQInstance,
  addTelegramInstance,
  addWecomInstance,
  removeDingTalkInstance,
  removeDiscordInstance,
  removeEmailInstance,
  removeFeishuInstance,
  removeNimInstance,
  removePopoInstance,
  removeQQInstance,
  removeTelegramInstance,
  removeWecomInstance,
  setConfig,
  setDingTalkInstanceConfig,
  setDiscordInstanceConfig,
  setEmailInstanceConfig,
  setError,
  setFeishuInstanceConfig,
  setLoading,
  setNimInstanceConfig,
  setPopoInstanceConfig,
  setQQInstanceConfig,
  setStatus,
  setTelegramInstanceConfig,
  setWecomInstanceConfig,
} from '../store/slices/imSlice';
import type {
  DingTalkInstanceConfig,
  DiscordInstanceConfig,
  EmailInstanceConfig,
  FeishuInstanceConfig,
  IMConfigResult,
  IMConnectivityTestResponse,
  IMConnectivityTestResult,
  IMGatewayConfig,
  IMGatewayResult,
  IMGatewayStatus,
  IMStatusResult,
  NimInstanceConfig,
  PopoInstanceConfig,
  QQInstanceConfig,
  TelegramInstanceConfig,
  WecomInstanceConfig,
} from '../types/im';

class IMService {
  private statusUnsubscribe: (() => void) | null = null;
  private messageUnsubscribe: (() => void) | null = null;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize IM service (with concurrency guard to prevent duplicate init)
   */
  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._doInit();
    return this.initPromise;
  }

  private async _doInit(): Promise<void> {
    // Set up status change listener
    this.statusUnsubscribe = window.electron.im.onStatusChange((status: IMGatewayStatus) => {
      store.dispatch(setStatus(status));
    });

    // Set up message listener (for logging/monitoring)
    this.messageUnsubscribe = window.electron.im.onMessageReceived((message) => {
      console.log('[IM Service] Message received:', message);
    });

    // Load initial config and status
    await this.loadConfig();
    await this.loadStatus();
  }

  /**
   * Clean up listeners
   */
  destroy(): void {
    if (this.statusUnsubscribe) {
      this.statusUnsubscribe();
      this.statusUnsubscribe = null;
    }
    if (this.messageUnsubscribe) {
      this.messageUnsubscribe();
      this.messageUnsubscribe = null;
    }
    this.initPromise = null;
  }

  /**
   * Load configuration from main process
   */
  async loadConfig(): Promise<IMGatewayConfig | null> {
    try {
      store.dispatch(setLoading(true));
      const result: IMConfigResult = await window.electron.im.getConfig();
      if (result.success && result.config) {
        store.dispatch(setConfig(result.config));
        return result.config;
      } else {
        store.dispatch(setError(result.error || 'Failed to load IM config'));
        return null;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load IM config';
      store.dispatch(setError(message));
      return null;
    } finally {
      store.dispatch(setLoading(false));
    }
  }

  /**
   * Load status from main process
   */
  async loadStatus(): Promise<IMGatewayStatus | null> {
    try {
      const result: IMStatusResult = await window.electron.im.getStatus();
      if (result.success && result.status) {
        store.dispatch(setStatus(result.status));
        return result.status;
      }
      return null;
    } catch (error) {
      console.error('[IM Service] Failed to load status:', error);
      return null;
    }
  }

  /**
   * Update configuration and trigger gateway sync/restart.
   * Used by toggleGateway and other operations that need immediate effect.
   */
  async updateConfig(config: Partial<IMGatewayConfig>): Promise<boolean> {
    try {
      store.dispatch(setLoading(true));
      const result: IMGatewayResult = await window.electron.im.setConfig(config, { syncGateway: true });
      if (result.success) {
        // Reload config to get merged values
        await this.loadConfig();
        return true;
      } else {
        store.dispatch(setError(result.error || 'Failed to update IM config'));
        return false;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update IM config';
      store.dispatch(setError(message));
      return false;
    } finally {
      store.dispatch(setLoading(false));
    }
  }

  /**
   * Persist configuration to DB without triggering gateway sync/restart.
   * Used by onBlur handlers to save field values silently.
   */
  async persistConfig(config: Partial<IMGatewayConfig>): Promise<boolean> {
    try {
      const result: IMGatewayResult = await window.electron.im.setConfig(config, { syncGateway: false });
      if (result.success) {
        return true;
      } else {
        console.error('[IM Service] Failed to persist config:', result.error);
        return false;
      }
    } catch (error) {
      console.error('[IM Service] Failed to persist config:', error);
      return false;
    }
  }

  /**
   * Sync IM gateway config (regenerate openclaw.json and restart gateway).
   * Called from the global Settings Save button.
   */
  async saveAndSyncConfig(): Promise<boolean> {
    try {
      const result: IMGatewayResult = await window.electron.im.syncConfig();
      return result.success;
    } catch (error) {
      console.error('[IM Service] Failed to sync IM config:', error);
      return false;
    }
  }

  /**
   * Start a gateway
   */
  async startGateway(platform: Platform): Promise<boolean> {
    try {
      store.dispatch(setLoading(true));
      store.dispatch(setError(null));
      const result: IMGatewayResult = await window.electron.im.startGateway(platform);
      if (result.success) {
        await this.loadStatus();
        return true;
      } else {
        store.dispatch(setError(result.error || `Failed to start ${platform} gateway`));
        return false;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to start ${platform} gateway`;
      store.dispatch(setError(message));
      return false;
    } finally {
      store.dispatch(setLoading(false));
    }
  }

  /**
   * Stop a gateway
   */
  async stopGateway(platform: Platform): Promise<boolean> {
    try {
      store.dispatch(setLoading(true));
      const result: IMGatewayResult = await window.electron.im.stopGateway(platform);
      if (result.success) {
        await this.loadStatus();
        return true;
      } else {
        store.dispatch(setError(result.error || `Failed to stop ${platform} gateway`));
        return false;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to stop ${platform} gateway`;
      store.dispatch(setError(message));
      return false;
    } finally {
      store.dispatch(setLoading(false));
    }
  }

  /**
   * Test gateway connectivity and conversation readiness
   */
  async testGateway(
    platform: Platform,
    configOverride?: Partial<IMGatewayConfig>
  ): Promise<IMConnectivityTestResult | null> {
    try {
      store.dispatch(setLoading(true));
      const result: IMConnectivityTestResponse = await window.electron.im.testGateway(platform, configOverride);
      if (result.success && result.result) {
        return result.result;
      }
      store.dispatch(setError(result.error || `Failed to test ${platform} connectivity`));
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to test ${platform} connectivity`;
      store.dispatch(setError(message));
      return null;
    } finally {
      store.dispatch(setLoading(false));
    }
  }

  /**
   * Get current config from store
   */
  getConfig(): IMGatewayConfig {
    return store.getState().im.config;
  }

  /**
   * Get current status from store
   */
  getStatus(): IMGatewayStatus {
    return store.getState().im.status;
  }

  /**
   * Check if any gateway is connected
   */
  isAnyConnected(): boolean {
    const status = this.getStatus();
    return PlatformRegistry.platforms.some((platform) => {
      if (platform === 'dingtalk') {
        return status.dingtalk.instances.some((item) => item.connected);
      }
      if (platform === 'feishu') {
        return status.feishu.instances.some((item) => item.connected);
      }
      if (platform === 'qq') {
        return status.qq.instances.some((item) => item.connected);
      }
      if (platform === 'wecom') {
        return status.wecom.instances.some((item) => item.connected);
      }
      if (platform === 'email') {
        return status.email.instances.some((item) => item.connected);
      }
      if (platform === 'telegram') {
        return status.telegram.instances?.some((item) => item.connected) ?? status.telegram.connected;
      }
      if (platform === 'discord') {
        return status.discord.instances?.some((item) => item.connected) ?? status.discord.connected;
      }
      return Boolean(status[platform]?.connected);
    });
  }

  /**
   * List pending pairing requests and approved allowFrom for a platform
   */
  async listPairingRequests(platform: string) {
    return window.electron.im.listPairingRequests(platform);
  }

  /**
   * Approve a pairing code
   */
  async approvePairingCode(platform: string, code: string) {
    return window.electron.im.approvePairingCode(platform, code);
  }

  /**
   * Reject a pairing request
   */
  async rejectPairingRequest(platform: string, code: string) {
    return window.electron.im.rejectPairingRequest(platform, code);
  }

  async addDingTalkInstance(name: string): Promise<DingTalkInstanceConfig | null> {
    const result = await window.electron.im.addDingTalkInstance(name);
    if (result.success && result.instance) {
      store.dispatch(addDingTalkInstance(result.instance));
      return result.instance;
    }
    store.dispatch(setError(result.error || 'Failed to add DingTalk instance'));
    return null;
  }

  async updateDingTalkInstanceConfig(
    instanceId: string,
    config: Partial<DingTalkInstanceConfig>,
    options?: { syncGateway?: boolean }
  ): Promise<boolean> {
    const syncGateway = options?.syncGateway ?? true;
    const result = await window.electron.im.setDingTalkInstanceConfig(instanceId, config, { syncGateway });
    if (result.success) {
      if (syncGateway) {
        await this.loadConfig();
        await this.loadStatus();
      } else {
        store.dispatch(setDingTalkInstanceConfig({ instanceId, config }));
      }
      return true;
    }
    store.dispatch(setError(result.error || 'Failed to update DingTalk instance'));
    return false;
  }

  async persistDingTalkInstanceConfig(
    instanceId: string,
    config: Partial<DingTalkInstanceConfig>
  ): Promise<boolean> {
    return this.updateDingTalkInstanceConfig(instanceId, config, { syncGateway: false });
  }

  async deleteDingTalkInstance(instanceId: string): Promise<boolean> {
    const result = await window.electron.im.deleteDingTalkInstance(instanceId);
    if (result.success) {
      store.dispatch(removeDingTalkInstance(instanceId));
      return true;
    }
    store.dispatch(setError(result.error || 'Failed to delete DingTalk instance'));
    return false;
  }

  async addFeishuInstance(name: string): Promise<FeishuInstanceConfig | null> {
    const result = await window.electron.im.addFeishuInstance(name);
    if (result.success && result.instance) {
      store.dispatch(addFeishuInstance(result.instance));
      return result.instance;
    }
    store.dispatch(setError(result.error || 'Failed to add Feishu instance'));
    return null;
  }

  async updateFeishuInstanceConfig(
    instanceId: string,
    config: Partial<FeishuInstanceConfig>,
    options?: { syncGateway?: boolean }
  ): Promise<boolean> {
    const syncGateway = options?.syncGateway ?? true;
    const result = await window.electron.im.setFeishuInstanceConfig(instanceId, config, { syncGateway });
    if (result.success) {
      if (syncGateway) {
        await this.loadConfig();
        await this.loadStatus();
      } else {
        store.dispatch(setFeishuInstanceConfig({ instanceId, config }));
      }
      return true;
    }
    store.dispatch(setError(result.error || 'Failed to update Feishu instance'));
    return false;
  }

  async persistFeishuInstanceConfig(
    instanceId: string,
    config: Partial<FeishuInstanceConfig>
  ): Promise<boolean> {
    return this.updateFeishuInstanceConfig(instanceId, config, { syncGateway: false });
  }

  async deleteFeishuInstance(instanceId: string): Promise<boolean> {
    const result = await window.electron.im.deleteFeishuInstance(instanceId);
    if (result.success) {
      store.dispatch(removeFeishuInstance(instanceId));
      return true;
    }
    store.dispatch(setError(result.error || 'Failed to delete Feishu instance'));
    return false;
  }

  async addTelegramInstance(name: string): Promise<TelegramInstanceConfig | null> {
    const result = await window.electron.im.addTelegramInstance(name);
    if (result.success && result.instance) {
      store.dispatch(addTelegramInstance(result.instance));
      return result.instance;
    }
    store.dispatch(setError(result.error || 'Failed to add Telegram instance'));
    return null;
  }

  async updateTelegramInstanceConfig(
    instanceId: string,
    config: Partial<TelegramInstanceConfig>,
    options?: { syncGateway?: boolean }
  ): Promise<boolean> {
    const syncGateway = options?.syncGateway ?? true;
    const result = await window.electron.im.setTelegramInstanceConfig(instanceId, config, { syncGateway });
    if (result.success) {
      if (syncGateway) {
        await this.loadConfig();
        await this.loadStatus();
      } else {
        store.dispatch(setTelegramInstanceConfig({ instanceId, config }));
      }
      return true;
    }
    store.dispatch(setError(result.error || 'Failed to update Telegram instance'));
    return false;
  }

  async persistTelegramInstanceConfig(
    instanceId: string,
    config: Partial<TelegramInstanceConfig>
  ): Promise<boolean> {
    return this.updateTelegramInstanceConfig(instanceId, config, { syncGateway: false });
  }

  async deleteTelegramInstance(instanceId: string): Promise<boolean> {
    const result = await window.electron.im.deleteTelegramInstance(instanceId);
    if (result.success) {
      store.dispatch(removeTelegramInstance(instanceId));
      return true;
    }
    store.dispatch(setError(result.error || 'Failed to delete Telegram instance'));
    return false;
  }

  async addDiscordInstance(name: string): Promise<DiscordInstanceConfig | null> {
    const result = await window.electron.im.addDiscordInstance(name);
    if (result.success && result.instance) {
      store.dispatch(addDiscordInstance(result.instance));
      return result.instance;
    }
    store.dispatch(setError(result.error || 'Failed to add Discord instance'));
    return null;
  }

  async updateDiscordInstanceConfig(
    instanceId: string,
    config: Partial<DiscordInstanceConfig>,
    options?: { syncGateway?: boolean }
  ): Promise<boolean> {
    const syncGateway = options?.syncGateway ?? true;
    const result = await window.electron.im.setDiscordInstanceConfig(instanceId, config, { syncGateway });
    if (result.success) {
      if (syncGateway) {
        await this.loadConfig();
        await this.loadStatus();
      } else {
        store.dispatch(setDiscordInstanceConfig({ instanceId, config }));
      }
      return true;
    }
    store.dispatch(setError(result.error || 'Failed to update Discord instance'));
    return false;
  }

  async persistDiscordInstanceConfig(
    instanceId: string,
    config: Partial<DiscordInstanceConfig>
  ): Promise<boolean> {
    return this.updateDiscordInstanceConfig(instanceId, config, { syncGateway: false });
  }

  async deleteDiscordInstance(instanceId: string): Promise<boolean> {
    const result = await window.electron.im.deleteDiscordInstance(instanceId);
    if (result.success) {
      store.dispatch(removeDiscordInstance(instanceId));
      return true;
    }
    store.dispatch(setError(result.error || 'Failed to delete Discord instance'));
    return false;
  }

  async addQQInstance(name: string): Promise<QQInstanceConfig | null> {
    const result = await window.electron.im.addQQInstance(name);
    if (result.success && result.instance) {
      store.dispatch(addQQInstance(result.instance));
      return result.instance;
    }
    store.dispatch(setError(result.error || 'Failed to add QQ instance'));
    return null;
  }

  async updateQQInstanceConfig(
    instanceId: string,
    config: Partial<QQInstanceConfig>,
    options?: { syncGateway?: boolean }
  ): Promise<boolean> {
    const syncGateway = options?.syncGateway ?? true;
    const result = await window.electron.im.setQQInstanceConfig(instanceId, config, { syncGateway });
    if (result.success) {
      if (syncGateway) {
        await this.loadConfig();
        await this.loadStatus();
      } else {
        store.dispatch(setQQInstanceConfig({ instanceId, config }));
      }
      return true;
    }
    store.dispatch(setError(result.error || 'Failed to update QQ instance'));
    return false;
  }

  async persistQQInstanceConfig(
    instanceId: string,
    config: Partial<QQInstanceConfig>
  ): Promise<boolean> {
    return this.updateQQInstanceConfig(instanceId, config, { syncGateway: false });
  }

  async deleteQQInstance(instanceId: string): Promise<boolean> {
    const result = await window.electron.im.deleteQQInstance(instanceId);
    if (result.success) {
      store.dispatch(removeQQInstance(instanceId));
      return true;
    }
    store.dispatch(setError(result.error || 'Failed to delete QQ instance'));
    return false;
  }

  async addNimInstance(name: string): Promise<NimInstanceConfig | null> {
    const result = await window.electron.im.addNimInstance(name);
    if (result.success && result.instance) {
      store.dispatch(addNimInstance(result.instance));
      return result.instance;
    }
    store.dispatch(setError(result.error || 'Failed to add NIM instance'));
    return null;
  }

  async updateNimInstanceConfig(
    instanceId: string,
    config: Partial<NimInstanceConfig>,
    options?: { syncGateway?: boolean }
  ): Promise<boolean> {
    const syncGateway = options?.syncGateway ?? true;
    const result = await window.electron.im.setNimInstanceConfig(instanceId, config, { syncGateway });
    if (result.success) {
      if (syncGateway) {
        await this.loadConfig();
        await this.loadStatus();
      } else {
        store.dispatch(setNimInstanceConfig({ instanceId, config }));
      }
      return true;
    }
    store.dispatch(setError(result.error || 'Failed to update NIM instance'));
    return false;
  }

  async persistNimInstanceConfig(
    instanceId: string,
    config: Partial<NimInstanceConfig>
  ): Promise<boolean> {
    return this.updateNimInstanceConfig(instanceId, config, { syncGateway: false });
  }

  async deleteNimInstance(instanceId: string): Promise<boolean> {
    const result = await window.electron.im.deleteNimInstance(instanceId);
    if (result.success) {
      store.dispatch(removeNimInstance(instanceId));
      return true;
    }
    store.dispatch(setError(result.error || 'Failed to delete NIM instance'));
    return false;
  }

  async addPopoInstance(name: string): Promise<PopoInstanceConfig | null> {
    const result = await window.electron.im.addPopoInstance(name);
    if (result.success && result.instance) {
      store.dispatch(addPopoInstance(result.instance));
      return result.instance;
    }
    store.dispatch(setError(result.error || 'Failed to add POPO instance'));
    return null;
  }

  async updatePopoInstanceConfig(
    instanceId: string,
    config: Partial<PopoInstanceConfig>,
    options?: { syncGateway?: boolean }
  ): Promise<boolean> {
    const syncGateway = options?.syncGateway ?? true;
    const result = await window.electron.im.setPopoInstanceConfig(instanceId, config, { syncGateway });
    if (result.success) {
      if (syncGateway) {
        await this.loadConfig();
        await this.loadStatus();
      } else {
        store.dispatch(setPopoInstanceConfig({ instanceId, config }));
      }
      return true;
    }
    store.dispatch(setError(result.error || 'Failed to update POPO instance'));
    return false;
  }

  async persistPopoInstanceConfig(
    instanceId: string,
    config: Partial<PopoInstanceConfig>
  ): Promise<boolean> {
    return this.updatePopoInstanceConfig(instanceId, config, { syncGateway: false });
  }

  async deletePopoInstance(instanceId: string): Promise<boolean> {
    const result = await window.electron.im.deletePopoInstance(instanceId);
    if (result.success) {
      store.dispatch(removePopoInstance(instanceId));
      return true;
    }
    store.dispatch(setError(result.error || 'Failed to delete POPO instance'));
    return false;
  }

  async addWecomInstance(name: string): Promise<WecomInstanceConfig | null> {
    const result = await window.electron.im.addWecomInstance(name);
    if (result.success && result.instance) {
      store.dispatch(addWecomInstance(result.instance));
      return result.instance;
    }
    store.dispatch(setError(result.error || 'Failed to add WeCom instance'));
    return null;
  }

  async updateWecomInstanceConfig(
    instanceId: string,
    config: Partial<WecomInstanceConfig>,
    options?: { syncGateway?: boolean }
  ): Promise<boolean> {
    const syncGateway = options?.syncGateway ?? true;
    const result = await window.electron.im.setWecomInstanceConfig(instanceId, config, { syncGateway });
    if (result.success) {
      if (syncGateway) {
        await this.loadConfig();
        await this.loadStatus();
      } else {
        store.dispatch(setWecomInstanceConfig({ instanceId, config }));
      }
      return true;
    }
    store.dispatch(setError(result.error || 'Failed to update WeCom instance'));
    return false;
  }

  async persistWecomInstanceConfig(
    instanceId: string,
    config: Partial<WecomInstanceConfig>
  ): Promise<boolean> {
    return this.updateWecomInstanceConfig(instanceId, config, { syncGateway: false });
  }

  async deleteWecomInstance(instanceId: string): Promise<boolean> {
    const result = await window.electron.im.deleteWecomInstance(instanceId);
    if (result.success) {
      store.dispatch(removeWecomInstance(instanceId));
      return true;
    }
    store.dispatch(setError(result.error || 'Failed to delete WeCom instance'));
    return false;
  }

  async addEmailInstance(name: string): Promise<EmailInstanceConfig | null> {
    const result = await window.electron.im.addEmailInstance(name);
    if (result.success && result.instance) {
      store.dispatch(addEmailInstance(result.instance));
      return result.instance;
    }
    store.dispatch(setError(result.error || 'Failed to add Email instance'));
    return null;
  }

  async updateEmailInstanceConfig(
    instanceId: string,
    config: Partial<EmailInstanceConfig>,
    options?: { syncGateway?: boolean }
  ): Promise<boolean> {
    const syncGateway = options?.syncGateway ?? true;
    const result = await window.electron.im.setEmailInstanceConfig(instanceId, config, { syncGateway });
    if (result.success) {
      if (syncGateway) {
        await this.loadConfig();
        await this.loadStatus();
      } else {
        store.dispatch(setEmailInstanceConfig({ instanceId, config }));
      }
      return true;
    }
    store.dispatch(setError(result.error || 'Failed to update Email instance'));
    return false;
  }

  async persistEmailInstanceConfig(
    instanceId: string,
    config: Partial<EmailInstanceConfig>
  ): Promise<boolean> {
    return this.updateEmailInstanceConfig(instanceId, config, { syncGateway: false });
  }

  async deleteEmailInstance(instanceId: string): Promise<boolean> {
    const result = await window.electron.im.deleteEmailInstance(instanceId);
    if (result.success) {
      store.dispatch(removeEmailInstance(instanceId));
      return true;
    }
    store.dispatch(setError(result.error || 'Failed to delete Email instance'));
    return false;
  }

  /**
   * Fetch the OpenClaw config schema (JSON Schema + uiHints) from the gateway.
   */
  async getOpenClawConfigSchema(): Promise<{ schema: Record<string, unknown>; uiHints: Record<string, Record<string, unknown>> } | null> {
    try {
      const result = await window.electron.im.getOpenClawConfigSchema();
      if (result.success && result.result) {
        return result.result;
      }
      return null;
    } catch {
      return null;
    }
  }
}

export const imService = new IMService();
