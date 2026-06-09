import { store } from '../store';
import { setSkills } from '../store/slices/skillSlice';
import { agentService } from './agent';
import { i18nService } from './i18n';
import { skillService } from './skill';

class QingShuManagedService {
  async syncCatalog(options?: { shouldApply?: () => boolean }): Promise<void> {
    const shouldApply = options?.shouldApply;
    const result = await window.electron.qingshuManaged.syncCatalog();
    await this.applySyncResult(result, shouldApply);
  }

  async refreshCatalogManual(options?: { shouldApply?: () => boolean }): Promise<void> {
    const shouldApply = options?.shouldApply;
    const result = await window.electron.qingshuManaged.refreshCatalogManual();
    await this.applySyncResult(result, shouldApply);
  }

  private async applySyncResult(
    result: { success: boolean; error?: string; throttled?: boolean; retryAfterMs?: number },
    shouldApply?: () => boolean,
  ): Promise<void> {
    if (!result.success) {
      if (result.throttled) {
        const retryAfterSeconds = Math.max(1, Math.ceil((result.retryAfterMs ?? 0) / 1000));
        throw new Error(i18nService.t('managedSkillRefreshThrottled').replace('{seconds}', String(retryAfterSeconds)));
      }
      throw new Error(result.error || 'Failed to sync JBP managed catalog');
    }
    if (shouldApply && !shouldApply()) {
      return;
    }

    const skills = await skillService.loadSkills();
    if (shouldApply && !shouldApply()) {
      return;
    }
    store.dispatch(setSkills(skills));
    if (shouldApply && !shouldApply()) {
      return;
    }
    await agentService.loadAgents({ shouldApply, refreshManagedCatalog: false });
  }

  async getCatalog() {
    const result = await window.electron.qingshuManaged.getCatalog();
    if (!result.success) {
      throw new Error(result.error || 'Failed to get JBP managed catalog');
    }
    return result.snapshot ?? null;
  }
}

export const qingshuManagedService = new QingShuManagedService();
