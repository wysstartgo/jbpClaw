import {
  QingShuManagedAccessState,
  resolveQingShuManagedAccessState,
} from '@shared/qingshuManaged/access';
import type {
  QingShuManagedCatalogSnapshot,
  QingShuManagedSkillDescriptor,
} from '@shared/qingshuManaged/types';

import { AppCustomEvent } from '../constants/app';
import { store } from '../store';
import { LocalizedText, LocalSkillInfo, MarketplaceSkill, MarketTag, Skill, WorkspaceSkillInstall } from '../types/skill';
import { i18nService } from './i18n';

export function resolveLocalizedText(text: string | LocalizedText): string {
  if (!text) return '';
  if (typeof text === 'string') return text;
  const lang = i18nService.getLanguage();
  return text[lang] || text.en || '';
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(s => parseInt(s, 10) || 0);
  const pb = b.split('.').map(s => parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

type EmailConnectivityCheck = {
  code: 'imap_connection' | 'smtp_connection';
  level: 'pass' | 'fail';
  message: string;
  durationMs: number;
};

type EmailConnectivityTestResult = {
  testedAt: number;
  verdict: 'pass' | 'fail';
  checks: EmailConnectivityCheck[];
};

class SkillService {
  private skills: Skill[] = [];
  private initialized = false;
  private localSkillDescriptions: Map<string, string | LocalizedText> = new Map();
  private marketplaceSkillDescriptions: Map<string, string | LocalizedText> = new Map();

  private showManagedUnavailableToast(message?: string) {
    window.dispatchEvent(new CustomEvent(AppCustomEvent.ShowToast, {
      detail: message || i18nService.t('managedUnavailableHint'),
    }));
  }

  private resolveManagedAccessState(sourceType?: string, allowed?: boolean) {
    return resolveQingShuManagedAccessState({
      sourceType,
      allowed,
      isLoggedIn: store.getState().auth.isLoggedIn,
    });
  }

  private resolveManagedCatalogEnabled(
    descriptor: QingShuManagedSkillDescriptor,
    accessState: QingShuManagedAccessState,
  ): boolean {
    return accessState === QingShuManagedAccessState.Available
      && descriptor.enabled === true;
  }

  private async loadManagedCatalog(): Promise<QingShuManagedCatalogSnapshot | null> {
    try {
      const result = await window.electron.qingshuManaged.getCatalog();
      if (!result.success) {
        return null;
      }
      return result.snapshot ?? null;
    } catch {
      return null;
    }
  }

  private toVirtualManagedSkill(
    descriptor: QingShuManagedSkillDescriptor,
    syncedAt: number,
  ): Skill {
    return {
      id: descriptor.skillId,
      name: descriptor.name,
      description: descriptor.description,
      enabled: false,
      isOfficial: true,
      isBuiltIn: true,
      updatedAt: syncedAt || Date.now(),
      prompt: descriptor.promptTemplate || '',
      skillPath: '',
      version: descriptor.version,
      sourceType: descriptor.sourceType,
      readOnly: true,
      backendSkillId: descriptor.skillId,
      backendAgentIds: descriptor.backendAgentIds ?? [],
      packageUrl: descriptor.packageUrl,
      catalogVersion: descriptor.catalogVersion,
      installedBy: 'qingshu-sync',
      toolRefs: descriptor.toolRefs ?? [],
      policyNote: descriptor.policyNote,
      allowed: descriptor.allowed,
    };
  }

  private mergeManagedCatalogSkills(
    installedSkills: Skill[],
    catalog: QingShuManagedCatalogSnapshot | null,
  ): Skill[] {
    const descriptorById = new Map<string, QingShuManagedSkillDescriptor>();
    if (catalog?.skills?.length) {
      for (const descriptor of catalog.skills) {
        descriptorById.set(descriptor.skillId, descriptor);
      }
    }

    const mergedInstalledSkills = installedSkills.map((skill) => {
      const descriptor = descriptorById.get(skill.backendSkillId || skill.id);
      if (!descriptor) {
        if (skill.sourceType === 'qingshu-managed') {
          const accessState = this.resolveManagedAccessState(skill.sourceType, skill.allowed);
          return {
            ...skill,
            allowed: true,
            enabled: accessState === QingShuManagedAccessState.Available ? skill.enabled : false,
          };
        }
        return skill;
      }

      const isAllowed = descriptor.allowed === true;
      const accessState = this.resolveManagedAccessState(descriptor.sourceType, isAllowed);
      return {
        ...skill,
        name: descriptor.name || skill.name,
        description: descriptor.description || skill.description,
        version: descriptor.version || skill.version,
        prompt: descriptor.promptTemplate || skill.prompt,
        sourceType: descriptor.sourceType,
        readOnly: true,
        backendSkillId: descriptor.skillId,
        backendAgentIds: descriptor.backendAgentIds ?? skill.backendAgentIds,
        packageUrl: descriptor.packageUrl,
        catalogVersion: descriptor.catalogVersion,
        installedBy: 'qingshu-sync',
        toolRefs: descriptor.toolRefs ?? skill.toolRefs,
        policyNote: descriptor.policyNote,
        allowed: isAllowed,
        enabled: this.resolveManagedCatalogEnabled(descriptor, accessState),
      };
    });

    if (!catalog?.skills?.length) {
      return mergedInstalledSkills;
    }

    const existingManagedIds = new Set(
      mergedInstalledSkills
        .filter((skill) => skill.sourceType === 'qingshu-managed')
        .map((skill) => skill.backendSkillId || skill.id),
    );

    const virtualManagedSkills = catalog.skills
      .filter((descriptor) => !existingManagedIds.has(descriptor.skillId))
      .filter((descriptor) => descriptor.allowed === false)
      .map((descriptor) => this.toVirtualManagedSkill(descriptor, catalog.syncedAt));

    return [...mergedInstalledSkills, ...virtualManagedSkills].sort((a, b) => {
      if (a.sourceType === 'qingshu-managed' && b.sourceType !== 'qingshu-managed') {
        return -1;
      }
      if (a.sourceType !== 'qingshu-managed' && b.sourceType === 'qingshu-managed') {
        return 1;
      }
      return b.updatedAt - a.updatedAt;
    });
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.loadSkills();
    this.initialized = true;
  }

  async loadSkills(): Promise<Skill[]> {
    try {
      const result = await window.electron.skills.list();
      if (result.success && result.skills) {
        const catalog = await this.loadManagedCatalog();
        this.skills = this.mergeManagedCatalogSkills(result.skills, catalog);
      } else {
        this.skills = [];
      }
      return this.skills;
    } catch (error) {
      console.error('Failed to load skills:', error);
      this.skills = [];
      return this.skills;
    }
  }

  async setSkillEnabled(id: string, enabled: boolean): Promise<Skill[]> {
    try {
      const targetSkill = this.skills.find((skill) => skill.id === id);
      const accessState = this.resolveManagedAccessState(targetSkill?.sourceType, targetSkill?.allowed);
      if (accessState === QingShuManagedAccessState.LoginRequired) {
        this.showManagedUnavailableToast();
        return this.skills;
      }
      if (accessState === QingShuManagedAccessState.Forbidden) {
        this.showManagedUnavailableToast(targetSkill?.policyNote || i18nService.t('managedForbiddenHint'));
        return this.skills;
      }
      const result = await window.electron.skills.setEnabled({ id, enabled });
      if (result.success && result.skills) {
        this.skills = result.skills;
        return this.skills;
      }
      throw new Error(result.error || 'Failed to update skill');
    } catch (error) {
      console.error('Failed to update skill:', error);
      throw error;
    }
  }

  async deleteSkill(id: string): Promise<{ success: boolean; skills?: Skill[]; error?: string }> {
    try {
      const result = await window.electron.skills.delete(id);
      if (result.success && result.skills) {
        this.skills = result.skills;
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete skill';
      console.error('Failed to delete skill:', error);
      return { success: false, error: message };
    }
  }

  async downloadSkill(source: string): Promise<{
    success: boolean;
    skills?: Skill[];
    error?: string;
    auditReport?: any;
    pendingInstallId?: string;
  }> {
    try {
      const result = await window.electron.skills.download(source);
      if (result.success && result.skills) {
        this.skills = result.skills;
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to download skill';
      console.error('Failed to download skill:', error);
      return { success: false, error: message };
    }
  }

  async listWorkspaceTemporarySkills(installedSkills?: Skill[]): Promise<WorkspaceSkillInstall[]> {
    try {
      const result = await window.electron.skills.listWorkspaceInstalls();
      if (!result.success || !result.installs) {
        return [];
      }

      const installedSkillIds = new Set((installedSkills ?? this.skills).map((skill) => skill.id));
      return result.installs
        .map((install) => ({
          ...install,
          skillIds: install.skillIds.filter((skillId) => !installedSkillIds.has(skillId)),
        }))
        .filter((install) => install.skillIds.length > 0);
    } catch (error) {
      console.error('Failed to list workspace temporary skills:', error);
      return [];
    }
  }

  async confirmInstall(
    pendingId: string,
    action: string
  ): Promise<{ success: boolean; skills?: Skill[]; error?: string }> {
    try {
      const result = await window.electron.skills.confirmInstall(pendingId, action);
      if (result.success && result.skills) {
        this.skills = result.skills;
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to confirm install';
      console.error('Failed to confirm install:', error);
      return { success: false, error: message };
    }
  }

  async upgradeSkill(skillId: string, downloadUrl: string): Promise<{
    success: boolean;
    skills?: Skill[];
    error?: string;
    auditReport?: any;
    pendingInstallId?: string;
  }> {
    try {
      const result = await window.electron.skills.upgrade(skillId, downloadUrl);
      if (result.success && result.skills) {
        this.skills = result.skills;
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upgrade skill';
      console.error('Failed to upgrade skill:', error);
      return { success: false, error: message };
    }
  }

  async getSkillsRoot(): Promise<string | null> {
    try {
      const result = await window.electron.skills.getRoot();
      if (result.success && result.path) {
        return result.path;
      }
      return null;
    } catch (error) {
      console.error('Failed to get skills root:', error);
      return null;
    }
  }

  onSkillsChanged(callback: () => void): () => void {
    return window.electron.skills.onChanged(callback);
  }

  getSkills(): Skill[] {
    return this.skills;
  }

  getEnabledSkills(): Skill[] {
    return this.skills.filter(s => s.enabled);
  }

  getSkillById(id: string): Skill | undefined {
    return this.skills.find(s => s.id === id);
  }

  async getSkillConfig(skillId: string): Promise<Record<string, string>> {
    try {
      const result = await window.electron.skills.getConfig(skillId);
      if (result.success && result.config) {
        return result.config;
      }
      return {};
    } catch (error) {
      console.error('Failed to get skill config:', error);
      return {};
    }
  }

  async setSkillConfig(skillId: string, config: Record<string, string>): Promise<boolean> {
    try {
      const result = await window.electron.skills.setConfig(skillId, config);
      return result.success;
    } catch (error) {
      console.error('Failed to set skill config:', error);
      return false;
    }
  }

  async testEmailConnectivity(
    skillId: string,
    config: Record<string, string>
  ): Promise<EmailConnectivityTestResult | null> {
    try {
      const result = await window.electron.skills.testEmailConnectivity(skillId, config);
      if (result.success && result.result) {
        return result.result;
      }
      return null;
    } catch (error) {
      console.error('Failed to test email connectivity:', error);
      return null;
    }
  }

  async getAutoRoutingPrompt(): Promise<string | null> {
    try {
      const result = await window.electron.skills.autoRoutingPrompt();
      return result.success ? (result.prompt || null) : null;
    } catch (error) {
      console.error('Failed to get auto-routing prompt:', error);
      return null;
    }
  }
  async fetchMarketplaceSkills(): Promise<{ skills: MarketplaceSkill[]; tags: MarketTag[] }> {
    try {
      const result = await window.electron.skills.fetchMarketplace();
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to fetch marketplace');
      }
      const json = JSON.parse(result.data);
      const value = json?.data?.value;
      // Store local skill descriptions for i18n lookup
      const localSkills: LocalSkillInfo[] = Array.isArray(value?.localSkill) ? value.localSkill : [];
      this.localSkillDescriptions.clear();
      for (const ls of localSkills) {
        this.localSkillDescriptions.set(ls.name, ls.description);
      }
      const skills: MarketplaceSkill[] = Array.isArray(value?.marketplace) ? value.marketplace : [];
      const tags: MarketTag[] = Array.isArray(value?.marketTags) ? value.marketTags : [];
      // Also store marketplace skill descriptions for i18n lookup (keyed by id)
      this.marketplaceSkillDescriptions.clear();
      for (const ms of skills) {
        if (typeof ms.description === 'object') {
          this.marketplaceSkillDescriptions.set(ms.id, ms.description);
        }
      }
      return { skills, tags };
    } catch (error) {
      console.error('Failed to fetch marketplace skills:', error);
      return { skills: [], tags: [] };
    }
  }

  getLocalizedSkillDescription(skillId: string, skillName: string, fallback: string): string {
    const localDesc = this.localSkillDescriptions.get(skillName);
    if (localDesc != null) return resolveLocalizedText(localDesc);
    const marketDesc = this.marketplaceSkillDescriptions.get(skillId);
    if (marketDesc != null) return resolveLocalizedText(marketDesc);
    return fallback;
  }

  getInstalledSkillDescription(skill: Skill): string {
    const fallback = skill.description || '';
    const shouldUseMarketplaceDescription = skill.isBuiltIn || skill.sourceType === 'preset';
    if (!shouldUseMarketplaceDescription) {
      return fallback;
    }
    return this.getLocalizedSkillDescription(skill.id, skill.name, fallback);
  }
}

export const skillService = new SkillService();
