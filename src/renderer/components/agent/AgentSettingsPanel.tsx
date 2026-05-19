import { LockClosedIcon, PlusIcon, TrashIcon,WrenchScrewdriverIcon, XMarkIcon } from '@heroicons/react/24/outline';
import type { Platform } from '@shared/platform';
import { PlatformRegistry } from '@shared/platform';
import { QingShuManagedAccessState } from '@shared/qingshuManaged/access';
import { QingShuObjectSourceType } from '@shared/qingshuManaged/constants';
import type {
  QingShuManagedCatalogSnapshot,
  QingShuManagedSkillDescriptor,
  QingShuManagedToolDescriptor,
} from '@shared/qingshuManaged/types';
import React, { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import { agentService } from '../../services/agent';
import { i18nService } from '../../services/i18n';
import { imService } from '../../services/im';
import { loadQingShuAgentGovernanceSummary } from '../../services/qingshuGovernanceSummary';
import { qingshuManagedService } from '../../services/qingshuManaged';
import {
  resolveQingShuManagedAccessPresentation,
  resolveQingShuSourceLabelKey,
} from '../../services/qingshuManagedUi';
import { RootState } from '../../store';
import type { Agent } from '../../types/agent';
import type { IMGatewayConfig } from '../../types/im';
import { getVisibleIMPlatforms } from '../../utils/regionFilter';
import AgentAvatarPicker from './AgentAvatarPicker';
import { resolveAgentBundleSaveFlow } from './agentBundleSaveFlow';
import {
  buildAgentBundleSaveWarningState,
} from './agentBundleSaveGuard';
import AgentConfirmDialog from './AgentConfirmDialog';
import {
  hasBindingSelectionChanges,
  hasCreateAgentDraftChanges,
  hasOrderedSelectionChanges,
} from './agentDraftState';
import {
  buildAgentBindingKeyBindings,
  collectAgentBoundBindingKeys,
  getAgentImBindingEnabledInstances,
  getVisibleAgentImBindingPlatforms,
  hasAgentImBindingInstanceConfigs,
  isAgentImBindingPlatformConfigured,
} from './agentImBindingConfig';
import { buildPersistedUpdateAgentRequest } from './agentPersistedDraft';
import AgentSkillSelector from './AgentSkillSelector';
import AgentToolBundleCompatibilityHint from './AgentToolBundleCompatibilityHint';
import AgentToolBundleDebugGuide from './AgentToolBundleDebugGuide';
import AgentToolBundleDebugSelector from './AgentToolBundleDebugSelector';
import AgentToolBundleReadOnlyPanel from './AgentToolBundleReadOnlyPanel';
import AgentToolBundleSelector from './AgentToolBundleSelector';
import AgentWorkingDirectoryField from './AgentWorkingDirectoryField';
import { AgentConfirmDialogVariant } from './constants';

type SettingsTab = 'basic' | 'skills' | 'im';

interface AgentSettingsPanelProps {
  agentId: string | null;
  onClose: () => void;
  onSwitchAgent?: (agentId: string) => void;
}

const AgentSettingsPanel: React.FC<AgentSettingsPanelProps> = ({ agentId, onClose, onSwitchAgent }) => {
  const showGovernanceDebug = import.meta.env.DEV;
  const currentAgentId = useSelector((state: RootState) => state.agent.currentAgentId);
  const agents = useSelector((state: RootState) => state.agent.agents);
  const isLoggedIn = useSelector((state: RootState) => state.auth.isLoggedIn);
  const installedSkills = useSelector((state: RootState) => state.skill.skills);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [managedCatalog, setManagedCatalog] = useState<QingShuManagedCatalogSnapshot | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [identity, setIdentity] = useState('');
  const [workingDirectory, setWorkingDirectory] = useState('');
  const [icon, setIcon] = useState('');
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [managedBaseSkillIds, setManagedBaseSkillIds] = useState<string[]>([]);
  const [managedExtraSkillIds, setManagedExtraSkillIds] = useState<string[]>([]);
  const [savedManagedExtraSkillIds, setSavedManagedExtraSkillIds] = useState<string[]>([]);
  const [toolBundleIds, setToolBundleIds] = useState<string[]>([]);
  const [savedToolBundleIds, setSavedToolBundleIds] = useState<string[]>([]);
  const [debugToolBundleIds, setDebugToolBundleIds] = useState<string[]>([]);
  const [saveWarningSignature, setSaveWarningSignature] = useState<string | null>(null);
  const [saveWarningMissingBundles, setSaveWarningMissingBundles] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>('basic');

  // IM binding state
  const [imConfig, setImConfig] = useState<IMGatewayConfig | null>(null);
  const [boundBindingKeys, setBoundBindingKeys] = useState<Set<string>>(new Set());
  const [initialBoundBindingKeys, setInitialBoundBindingKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    setActiveTab('basic');
    setShowDeleteConfirm(false);
    setSaveWarningSignature(null);
    setSaveWarningMissingBundles([]);
    setManagedCatalog(null);
    window.electron?.agents?.get(agentId).then((a) => {
      if (cancelled) return;
      if (a) {
        setAgent(a);
        setName(a.name);
        setDescription(a.description);
        setSystemPrompt(a.systemPrompt);
        setIdentity(a.identity);
        setWorkingDirectory(a.workingDirectory ?? '');
        setIcon(a.icon);
        setSkillIds(a.skillIds ?? []);
        setManagedBaseSkillIds(a.managedBaseSkillIds ?? []);
        setManagedExtraSkillIds(a.managedExtraSkillIds ?? []);
        setSavedManagedExtraSkillIds(a.managedExtraSkillIds ?? []);
        setToolBundleIds(a.toolBundleIds ?? []);
        setSavedToolBundleIds(a.toolBundleIds ?? []);
        setDebugToolBundleIds(a.toolBundleIds ?? []);
      }
    });
    qingshuManagedService.getCatalog().then((snapshot) => {
      if (!cancelled) {
        setManagedCatalog(snapshot);
      }
    }).catch(() => {
      if (!cancelled) {
        setManagedCatalog(null);
      }
    });
    // Load IM config for bindings
    imService.loadConfig().then((cfg) => {
      if (cancelled) return;
      if (cfg) {
        setImConfig(cfg);
        const bound = collectAgentBoundBindingKeys(
          cfg.settings?.platformAgentBindings,
          agentId,
          undefined,
          cfg,
        );
        setBoundBindingKeys(bound);
        setInitialBoundBindingKeys(new Set(bound));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [agentId]);

  useEffect(() => {
    setSaveWarningSignature(null);
    setSaveWarningMissingBundles([]);
  }, [skillIds, toolBundleIds]);

  const saveWarningState = useMemo(
    () => buildAgentBundleSaveWarningState(saveWarningMissingBundles),
    [saveWarningMissingBundles],
  );
  const saveWarningMoreText = saveWarningState && saveWarningState.hiddenBundleCount > 0
    ? i18nService.t('agentToolBundlesSaveWarningMore')
      .replace('{count}', String(saveWarningState.hiddenBundleCount))
    : '';
  const saveButtonLabel = saving
    ? (i18nService.t('saving') || 'Saving...')
    : saveWarningState
      ? (i18nService.t('agentToolBundlesConfirmSave') || 'Save Again')
      : (i18nService.t('save') || 'Save');
  const visibleImPlatforms = useMemo(() => getVisibleAgentImBindingPlatforms(
    PlatformRegistry.platforms.filter((platform) => (
      getVisibleIMPlatforms(i18nService.getLanguage()) as readonly string[]
    ).includes(platform)),
    imConfig,
    imConfig?.settings?.platformAgentBindings,
  ), [imConfig]);
  const isManagedReadOnly = agent?.readOnly === true;
  const managedAgentAccess = resolveQingShuManagedAccessPresentation({
    sourceType: agent?.sourceType,
    allowed: agent?.allowed,
    isLoggedIn,
    policyNote: agent?.policyNote,
  });
  const isManagedUnavailable = (
    isManagedReadOnly && managedAgentAccess.accessState === QingShuManagedAccessState.LoginRequired
  );
  const isManagedForbidden = (
    isManagedReadOnly && managedAgentAccess.accessState === QingShuManagedAccessState.Forbidden
  );
  const hasManagedExtraSkillChanges = useMemo(
    () => hasOrderedSelectionChanges(managedExtraSkillIds, savedManagedExtraSkillIds),
    [managedExtraSkillIds, savedManagedExtraSkillIds],
  );
  const getManagedLockTag = (allowed?: boolean, policyNote?: string) => {
    const access = resolveQingShuManagedAccessPresentation({
      sourceType: QingShuObjectSourceType.QingShuManaged,
      allowed,
      isLoggedIn,
      policyNote,
    });
    return access.lockTagKey ? i18nService.t(access.lockTagKey) : '';
  };
  const getManagedLockHint = (allowed?: boolean, policyNote?: string) => {
    const access = resolveQingShuManagedAccessPresentation({
      sourceType: QingShuObjectSourceType.QingShuManaged,
      allowed,
      isLoggedIn,
      policyNote,
    });
    if (access.lockHintOverride) {
      return access.lockHintOverride;
    }
    return access.lockHintKey ? i18nService.t(access.lockHintKey) : '';
  };
  const managedSkillDetails = useMemo(() => {
    if (!isManagedReadOnly || !agent || !managedCatalog) {
      return [] as Array<QingShuManagedSkillDescriptor | { skillId: string; name: string; description: string; policyNote?: string }>;
    }
    const skillMap = new Map(managedCatalog.skills.map((skill) => [skill.skillId, skill]));
    return (managedBaseSkillIds ?? []).map((skillId) => (
      skillMap.get(skillId) ?? {
        skillId,
        name: skillId,
        description: '',
      }
    ));
  }, [agent, isManagedReadOnly, managedBaseSkillIds, managedCatalog]);
  const managedExtraSkillDetails = useMemo(() => {
    if (!isManagedReadOnly) {
      return [] as Array<{ id: string; name: string; description: string; sourceType?: string }>;
    }
    const skillMap = new Map(installedSkills.map((skill) => [skill.id, skill]));
    return managedExtraSkillIds.map((skillId) => ({
      id: skillId,
      name: skillMap.get(skillId)?.name || skillId,
      description: skillMap.get(skillId)?.description || '',
      sourceType: skillMap.get(skillId)?.sourceType,
    }));
  }, [installedSkills, isManagedReadOnly, managedExtraSkillIds]);
  const managedToolDetails = useMemo(() => {
    if (!isManagedReadOnly || !agent || !managedCatalog) {
      return [] as Array<QingShuManagedToolDescriptor | { toolName: string; description: string; policyNote?: string }>;
    }
    const toolMap = new Map(managedCatalog.tools.map((tool) => [tool.toolName, tool]));
    return (agent.managedToolNames ?? []).map((toolName) => (
      toolMap.get(toolName) ?? {
        toolName,
        description: '',
      }
    ));
  }, [agent, isManagedReadOnly, managedCatalog]);
  const getSkillSourceLabel = (sourceType?: string) => {
    return i18nService.t(resolveQingShuSourceLabelKey(sourceType));
  };
  const isDirty = useMemo(() => {
    if (!agent) {
      return false;
    }

    if (hasCreateAgentDraftChanges(
      {
        name,
        description,
        systemPrompt,
        identity,
        workingDirectory,
        icon,
        skillIds,
        toolBundleIds,
        boundBindingKeys,
      },
      {
        name: agent.name,
        description: agent.description,
        systemPrompt: agent.systemPrompt,
        identity: agent.identity,
        workingDirectory: agent.workingDirectory ?? '',
        icon: agent.icon,
        skillIds: agent.skillIds ?? [],
        toolBundleIds: savedToolBundleIds,
        boundBindingKeys: initialBoundBindingKeys,
      },
    )) {
      return true;
    }

    if (hasOrderedSelectionChanges(managedExtraSkillIds, savedManagedExtraSkillIds)) {
      return true;
    }

    return false;
  }, [
    agent,
    boundBindingKeys,
    description,
    icon,
    identity,
    initialBoundBindingKeys,
    managedExtraSkillIds,
    name,
    savedManagedExtraSkillIds,
    savedToolBundleIds,
    skillIds,
    systemPrompt,
    toolBundleIds,
    workingDirectory,
  ]);

  if (!agentId) return null;

  const handleClose = () => {
    if (saving) {
      return;
    }
    if (isDirty) {
      setShowUnsavedConfirm(true);
      return;
    }
    onClose();
  };

  const handleConfirmDiscard = () => {
    setShowUnsavedConfirm(false);
    onClose();
  };

  const handleSave = async () => {
    if (isManagedReadOnly) {
      if (isManagedUnavailable || isManagedForbidden || !agent) return;
      setSaving(true);
      try {
        const mergedSkillIds = Array.from(new Set([
          ...managedBaseSkillIds,
          ...managedExtraSkillIds,
        ]));
        await agentService.updateAgent(agentId, {
          skillIds: mergedSkillIds,
        });
        onClose();
      } finally {
        setSaving(false);
      }
      return;
    }
    if (!name.trim()) {
      setActiveTab('basic');
      window.dispatchEvent(new CustomEvent('app:showToast', {
        detail: i18nService.t('agentNameRequired'),
      }));
      return;
    }
    setSaving(true);
    try {
      const summary = await loadQingShuAgentGovernanceSummary(skillIds, toolBundleIds);
      const saveFlow = resolveAgentBundleSaveFlow({
        skillIds,
        toolBundleIds,
        missingBundles: summary.missingBundles,
        acknowledgedSignature: saveWarningSignature,
      });
      setSaveWarningSignature(saveFlow.nextAcknowledgedSignature);
      setSaveWarningMissingBundles(saveFlow.nextMissingBundles);
      if (!saveFlow.allowSave) {
        setActiveTab('skills');
        return;
      }

      await agentService.updateAgent(agentId, buildPersistedUpdateAgentRequest({
        name,
        description,
        systemPrompt,
        identity,
        workingDirectory,
        icon,
        skillIds,
        toolBundleIds,
        debugToolBundleIds,
      }));
      // Persist IM bindings if changed
      const bindingsChanged = hasBindingSelectionChanges(boundBindingKeys, initialBoundBindingKeys);
      if (bindingsChanged && imConfig) {
        const currentBindings = buildAgentBindingKeyBindings(
          imConfig.settings?.platformAgentBindings,
          agentId,
          boundBindingKeys,
        );
        await imService.persistConfig({
          settings: { ...imConfig.settings, platformAgentBindings: currentBindings },
        });
        await imService.saveAndSyncConfig();
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (isManagedReadOnly) return;
    const success = await agentService.deleteAgent(agentId);
    if (success) {
      onClose();
    }
  };

  const handleToggleIMBinding = (bindingKey: string) => {
    const next = new Set(boundBindingKeys);
    if (next.has(bindingKey)) {
      next.delete(bindingKey);
    } else {
      next.add(bindingKey);
    }
    setBoundBindingKeys(next);
  };

  const isPlatformConfigured = (platform: Platform): boolean => {
    return isAgentImBindingPlatformConfigured(imConfig, platform);
  };

  const getAgentName = (agentIdValue: string): string | null => {
    if (!agentIdValue || agentIdValue === 'main') {
      return null;
    }
    return agents.find((entry) => entry.id === agentIdValue)?.name || agentIdValue;
  };

  const renderToggle = (isOn: boolean) => (
    <div
      className={`relative w-9 h-5 rounded-full transition-colors ${
        isOn ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
      }`}
    >
      <div
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
          isOn ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </div>
  );

  const isMainAgent = agentId === 'main';

  const tabs: { key: SettingsTab; label: string }[] = [
    { key: 'basic', label: i18nService.t('agentTabBasic') || 'Basic Info' },
    { key: 'skills', label: i18nService.t('agentTabSkills') || 'Skills' },
    { key: 'im', label: i18nService.t('agentTabIM') || 'IM Channels' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={handleClose}>
      <div
        className="w-full max-w-2xl mx-4 rounded-xl shadow-xl bg-surface border border-border max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: agent icon + name + close */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-xl">{icon || '🤖'}</span>
            <h3 className="text-base font-semibold text-foreground">
              {name || (i18nService.t('agentSettings') || 'Agent Settings')}
            </h3>
          </div>
          <button type="button" onClick={handleClose} className="p-1 rounded-lg hover:bg-surface-raised">
            <XMarkIcon className="h-5 w-5 text-secondary" />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-border px-5">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
                activeTab === tab.key
                  ? 'text-primary'
                  : 'text-secondary hover:text-foreground'
              }`}
            >
              {tab.label}
              {activeTab === tab.key && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="px-5 py-4 overflow-y-auto flex-1 min-h-[300px]">
          {activeTab === 'basic' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-secondary mb-1">
                  {i18nService.t('agentName') || 'Name'}
                </label>
                {isManagedReadOnly && (
                  <p className="mb-2 text-xs text-secondary">
                    {i18nService.t('managedReadOnlyHint')}
                  </p>
                )}
                {isManagedUnavailable && (
                  <div className="mb-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-secondary">
                    <div className="inline-flex items-center gap-1 rounded-full border border-border bg-background/80 px-2 py-1 text-[10px] font-medium text-secondary">
                      <LockClosedIcon className="h-3 w-3" />
                      {i18nService.t('managedUnavailableTag')}
                    </div>
                    <div className="mt-2 leading-5">
                      {i18nService.t('managedUnavailableHint')}
                    </div>
                  </div>
                )}
                {isManagedForbidden && !isManagedUnavailable && (
                  <div className="mb-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-secondary">
                    <div className="inline-flex items-center gap-1 rounded-full border border-border bg-background/80 px-2 py-1 text-[10px] font-medium text-secondary">
                      <LockClosedIcon className="h-3 w-3" />
                      {i18nService.t('managedForbiddenTag')}
                    </div>
                    <div className="mt-2 leading-5">
                      {agent?.policyNote || i18nService.t('managedForbiddenHint')}
                    </div>
                  </div>
                )}
                <div className="flex gap-2">
                  <AgentAvatarPicker value={icon} onChange={setIcon} />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={isManagedReadOnly}
                    className="flex-1 px-3 py-2 rounded-lg border border-border bg-transparent text-foreground text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-secondary mb-1">
                  {i18nService.t('agentDescription') || 'Description'}
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={isManagedReadOnly}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-transparent text-foreground text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-secondary mb-1">
                  {i18nService.t('systemPrompt') || 'System Prompt'}
                </label>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  disabled={isManagedReadOnly}
                  rows={4}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-transparent text-foreground text-sm resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-secondary mb-1">
                  {i18nService.t('agentIdentity') || 'Identity'}
                </label>
                <textarea
                  value={identity}
                  onChange={(e) => setIdentity(e.target.value)}
                  disabled={isManagedReadOnly}
                  rows={3}
                  placeholder={i18nService.t('agentIdentityPlaceholder') || 'Identity description (IDENTITY.md)...'}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-transparent text-foreground text-sm resize-none"
                />
              </div>
              {!isManagedReadOnly && (
                <AgentWorkingDirectoryField
                  value={workingDirectory}
                  onChange={setWorkingDirectory}
                />
              )}
              {agent?.policyNote && (
                <div className="rounded-lg border border-border bg-surface-raised/60 px-3 py-2 text-xs text-secondary">
                  {agent.policyNote}
                </div>
              )}
            </div>
          )}

          {activeTab === 'skills' && (
            isManagedReadOnly ? (
              <div className={`overflow-hidden rounded-2xl border ${
                isManagedUnavailable
                  ? 'border-border/70 bg-muted/20 saturate-0'
                  : 'border-border bg-surface'
              }`}>
                <section className="px-4 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.16em] text-secondary/70 uppercase">
                        <span className="h-1.5 w-1.5 rounded-full bg-secondary/60" />
                        {i18nService.t('managedBaseSkillsEyebrow')}
                      </div>
                      <div className="mt-2 text-sm font-semibold text-foreground">
                        {i18nService.t('managedBaseSkillsTitle')}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-secondary/75">
                        {i18nService.t('managedBaseSkillsHint')}
                      </p>
                    </div>
                    <div className="shrink-0 rounded-full border border-border bg-background/70 px-2.5 py-1 text-[11px] font-medium text-secondary">
                      {i18nService.t('managedBaseSkillsCount').replace('{count}', String(managedSkillDetails.length))}
                    </div>
                  </div>
                  <div className="mt-4 space-y-2.5">
                    {managedSkillDetails.length > 0 ? managedSkillDetails.map((skill) => (
                      <div
                        key={skill.skillId}
                        className={`rounded-xl border px-3.5 py-3 ${
                          isManagedUnavailable
                            ? 'border-border/60 bg-muted/25'
                            : 'border-border/80 bg-surface-raised/60'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-medium text-foreground">
                                {skill.name || skill.skillId}
                              </div>
                              <span className="rounded-full border border-border bg-background/70 px-2 py-0.5 text-[10px] font-medium text-secondary">
                                {i18nService.t('sourceTypeQingShuManaged')}
                              </span>
                              {getManagedLockTag(
                                'allowed' in skill ? skill.allowed : undefined,
                                'policyNote' in skill ? skill.policyNote : undefined,
                              ) ? (
                                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background/70 px-2 py-0.5 text-[10px] font-medium text-secondary">
                                  <LockClosedIcon className="h-3 w-3" />
                                  {getManagedLockTag(
                                    'allowed' in skill ? skill.allowed : undefined,
                                    'policyNote' in skill ? skill.policyNote : undefined,
                                  )}
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-1 text-[11px] text-secondary/80">
                              {skill.skillId}
                            </div>
                          </div>
                        </div>
                        {skill.description ? (
                          <div className="mt-2 text-xs leading-5 text-secondary">
                            {skill.description}
                          </div>
                        ) : null}
                        {getManagedLockHint(
                          'allowed' in skill ? skill.allowed : undefined,
                          'policyNote' in skill ? skill.policyNote : undefined,
                        ) ? (
                          <div className="mt-2 text-[11px] leading-5 text-secondary/80">
                            {getManagedLockHint(
                              'allowed' in skill ? skill.allowed : undefined,
                              'policyNote' in skill ? skill.policyNote : undefined,
                            )}
                          </div>
                        ) : null}
                        {'policyNote' in skill && skill.policyNote && !('allowed' in skill && skill.allowed === false) ? (
                          <div className="mt-2 text-[11px] leading-5 text-secondary/80">
                            {skill.policyNote}
                          </div>
                        ) : null}
                      </div>
                    )) : (
                      <span className="text-xs text-secondary">-</span>
                    )}
                  </div>
                </section>

                <section className="border-t border-border/70 px-4 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.16em] text-secondary/70 uppercase">
                        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary/12 text-primary">
                          <PlusIcon className="h-2.5 w-2.5" />
                        </span>
                        {i18nService.t('managedExtraSkillsEyebrow')}
                      </div>
                      <div className="mt-2 text-sm font-semibold text-foreground">
                        {i18nService.t('managedExtraSkillsTitle')}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-secondary/75">
                        {i18nService.t('managedExtraSkillsHint')}
                      </p>
                    </div>
                    <div className="shrink-0 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                      {i18nService.t('managedExtraSkillsCount').replace('{count}', String(managedExtraSkillIds.length))}
                    </div>
                  </div>
                  <div className="mt-4 rounded-2xl border border-border bg-background/70 p-3">
                    <AgentSkillSelector
                      selectedSkillIds={managedExtraSkillIds}
                      toolBundleIds={[]}
                      onChange={setManagedExtraSkillIds}
                      allowManagedSkills={false}
                      usesAllEnabledSkillsWhenEmpty={false}
                    />
                  </div>
                  <div className="mt-3">
                    {managedExtraSkillDetails.length > 0 ? (
                      <div className="space-y-2">
                        {managedExtraSkillDetails.map((skill) => (
                          <div
                            key={skill.id}
                            className="rounded-xl border border-primary/15 bg-primary/[0.045] px-3.5 py-3"
                          >
                            <div className="flex items-center gap-2">
                              <div className="text-sm font-medium text-foreground">
                                {skill.name}
                              </div>
                              <span className="rounded-full border border-primary/20 bg-background/70 px-2 py-0.5 text-[10px] font-medium text-primary">
                                {i18nService.t('managedExtraSkillTag')}
                              </span>
                              <span className="rounded-full border border-border bg-background/70 px-2 py-0.5 text-[10px] font-medium text-secondary">
                                {getSkillSourceLabel(skill.sourceType)}
                              </span>
                            </div>
                            {skill.description ? (
                              <div className="mt-2 text-xs leading-5 text-secondary">
                                {skill.description}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-border px-3.5 py-3 text-xs text-secondary/70">
                        {i18nService.t('managedExtraSkillsEmpty')}
                      </div>
                    )}
                  </div>
                </section>

                <section className="border-t border-border/70 px-4 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.16em] text-secondary/70 uppercase">
                        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-secondary/12 text-secondary">
                          <WrenchScrewdriverIcon className="h-2.5 w-2.5" />
                        </span>
                        {i18nService.t('managedToolsEyebrow')}
                      </div>
                      <div className="mt-2 text-sm font-semibold text-foreground">
                        {i18nService.t('managedToolsTitle')}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-secondary/75">
                        {i18nService.t('managedToolsHint')}
                      </p>
                    </div>
                    <div className="shrink-0 rounded-full border border-border bg-background/70 px-2.5 py-1 text-[11px] font-medium text-secondary">
                      {i18nService.t('managedToolsCount').replace('{count}', String(managedToolDetails.length))}
                    </div>
                  </div>
                  <div className="mt-4 space-y-2.5">
                    {managedToolDetails.length > 0 ? managedToolDetails.map((tool) => (
                      <div
                        key={tool.toolName}
                        className={`rounded-xl border px-3.5 py-3 ${
                          isManagedUnavailable
                            ? 'border-border/60 bg-muted/25'
                            : 'border-border/80 bg-surface-raised/40'
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-medium text-foreground">
                            {tool.toolName}
                          </div>
                          <span className="rounded-full border border-border bg-background/70 px-2 py-0.5 text-[10px] font-medium text-secondary">
                            {i18nService.t('readOnlyTag')}
                          </span>
                          {getManagedLockTag(
                            'allowed' in tool ? tool.allowed : undefined,
                            'policyNote' in tool ? tool.policyNote : undefined,
                          ) ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background/70 px-2 py-0.5 text-[10px] font-medium text-secondary">
                              <LockClosedIcon className="h-3 w-3" />
                              {getManagedLockTag(
                                'allowed' in tool ? tool.allowed : undefined,
                                'policyNote' in tool ? tool.policyNote : undefined,
                              )}
                            </span>
                          ) : null}
                        </div>
                        {tool.description ? (
                          <div className="mt-2 text-xs leading-5 text-secondary">
                            {tool.description}
                          </div>
                        ) : null}
                        {getManagedLockHint(
                          'allowed' in tool ? tool.allowed : undefined,
                          'policyNote' in tool ? tool.policyNote : undefined,
                        ) ? (
                          <div className="mt-2 text-[11px] leading-5 text-secondary/80">
                            {getManagedLockHint(
                              'allowed' in tool ? tool.allowed : undefined,
                              'policyNote' in tool ? tool.policyNote : undefined,
                            )}
                          </div>
                        ) : null}
                        {'policyNote' in tool && tool.policyNote && !('allowed' in tool && tool.allowed === false) ? (
                          <div className="mt-2 text-[11px] leading-5 text-secondary/80">
                            {tool.policyNote}
                          </div>
                        ) : null}
                      </div>
                    )) : (
                      <span className="text-xs text-secondary">-</span>
                    )}
                  </div>
                </section>
              </div>
            ) : (
            <>
              <AgentToolBundleSelector
                selectedBundleIds={toolBundleIds}
                onChange={(nextBundleIds) => {
                  setToolBundleIds(nextBundleIds);
                  if (showGovernanceDebug) {
                    setDebugToolBundleIds(nextBundleIds);
                  }
                }}
              />
              <AgentToolBundleCompatibilityHint
                skillIds={skillIds}
                toolBundleIds={toolBundleIds}
                usesAllEnabledSkills={skillIds.length === 0}
              />
              {showGovernanceDebug ? (
                <>
                  <AgentToolBundleDebugGuide />
                  <AgentToolBundleReadOnlyPanel toolBundleIds={savedToolBundleIds} />
                  <AgentToolBundleDebugSelector
                    selectedBundleIds={debugToolBundleIds}
                    baselineBundleIds={toolBundleIds}
                    onChange={setDebugToolBundleIds}
                  />
                </>
              ) : null}
              <AgentSkillSelector
                selectedSkillIds={skillIds}
                toolBundleIds={showGovernanceDebug ? debugToolBundleIds : toolBundleIds}
                onChange={setSkillIds}
              />
            </>
            )
          )}

          {activeTab === 'im' && (
            <div>
              <p className="text-xs text-secondary/60 mb-4">
                {i18nService.t('agentIMBindHint') || 'Select IM channels this Agent responds to'}
              </p>
              <div className="space-y-1">
                {visibleImPlatforms.map((platform) => {
                    const logo = PlatformRegistry.logo(platform);
                    const bindings = imConfig?.settings?.platformAgentBindings || {};

                    if (hasAgentImBindingInstanceConfigs(imConfig, platform)) {
                      const enabledInstances = getAgentImBindingEnabledInstances(imConfig, platform);
                      if (enabledInstances.length === 0) {
                        return (
                          <div
                            key={platform}
                            className="flex items-center justify-between px-3 py-2.5 rounded-lg opacity-50"
                          >
                            <div className="flex items-center gap-3">
                              <div className="flex h-8 w-8 items-center justify-center">
                                <img src={logo} alt={i18nService.t(platform)} className="w-6 h-6 object-contain rounded" />
                              </div>
                              <div>
                                <div className="text-sm font-medium text-foreground">
                                  {i18nService.t(platform)}
                                </div>
                                <div className="text-xs text-secondary/50">
                                  {i18nService.t('agentIMNotConfiguredHint') || 'Please configure in Settings > IM Bots first'}
                                </div>
                              </div>
                            </div>
                            <span className="text-xs text-secondary/50">
                              {i18nService.t('agentIMNotConfigured') || 'Not configured'}
                            </span>
                          </div>
                        );
                      }

                      return (
                        <div key={platform} className="rounded-lg border border-border overflow-hidden">
                          <div className="flex items-center gap-3 px-3 py-2.5 bg-surface-raised">
                            <div className="flex h-8 w-8 items-center justify-center">
                              <img src={logo} alt={i18nService.t(platform)} className="w-6 h-6 object-contain rounded" />
                            </div>
                            <span className="text-sm font-semibold text-foreground">
                              {i18nService.t(platform)}
                            </span>
                          </div>
                          {enabledInstances.map((instance, index) => {
                            const bindingKey = `${platform}:${instance.instanceId}`;
                            const isBound = boundBindingKeys.has(bindingKey);
                            const otherAgentId = bindings[bindingKey];
                            const boundToOther = Boolean(otherAgentId && otherAgentId !== agentId && !isBound);
                            const otherAgentName = otherAgentId ? getAgentName(otherAgentId) : null;
                            return (
                              <div
                                key={instance.instanceId}
                                className={`flex items-center justify-between px-3 py-2 pl-14 transition-colors ${
                                  'cursor-pointer hover:bg-surface-raised'
                                } ${index < enabledInstances.length - 1 ? 'border-b border-border/60' : ''}`}
                                onClick={() => handleToggleIMBinding(bindingKey)}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                                  <span className="truncate text-sm text-foreground">
                                    {instance.instanceName}
                                  </span>
                                  {boundToOther && otherAgentName && (
                                    <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-600 dark:text-amber-400">
                                      {(i18nService.t('agentIMBoundToOther') || '→ {agent}').replace('{agent}', otherAgentName)}
                                    </span>
                                  )}
                                </div>
                                {renderToggle(isBound)}
                              </div>
                            );
                          })}
                        </div>
                      );
                    }

                    const configured = isPlatformConfigured(platform);
                    const isBound = boundBindingKeys.has(platform);
                    const otherAgentId = bindings[platform];
                    const boundToOther = configured && Boolean(otherAgentId && otherAgentId !== agentId && !isBound);
                    const otherAgentName = otherAgentId ? getAgentName(otherAgentId) : null;
                    return (
                      <div
                        key={platform}
                        className={`flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors ${
                          configured
                            ? 'hover:bg-surface-raised cursor-pointer'
                            : 'opacity-50'
                        }`}
                        onClick={() => configured && handleToggleIMBinding(platform)}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex h-8 w-8 items-center justify-center">
                            <img src={logo} alt={i18nService.t(platform)} className="w-6 h-6 object-contain rounded" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-foreground">
                              {i18nService.t(platform)}
                            </div>
                            {!configured && (
                              <div className="text-xs text-secondary/50">
                                {i18nService.t('agentIMNotConfiguredHint') || 'Please configure in Settings > IM Bots first'}
                              </div>
                            )}
                          </div>
                          {boundToOther && otherAgentName && (
                            <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-600 dark:text-amber-400">
                              {(i18nService.t('agentIMBoundToOther') || '→ {agent}').replace('{agent}', otherAgentName)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {configured ? (
                            renderToggle(isBound)
                          ) : (
                            <span className="text-xs text-secondary/50">
                              {i18nService.t('agentIMNotConfigured') || 'Not configured'}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-border">
          <div>
            {!isMainAgent && !showDeleteConfirm && !isManagedReadOnly && (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                <TrashIcon className="h-4 w-4" />
                {i18nService.t('delete') || 'Delete'}
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="min-h-[1rem]">
              {saveWarningState ? (
                <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-right">
                  <div className="text-xs font-medium text-amber-800 dark:text-amber-200">
                    {i18nService.t('agentToolBundlesSaveWarningTitle')}
                  </div>
                  <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                    {i18nService.t('agentToolBundlesSaveWarningBody')
                      .replace('{count}', String(saveWarningState.missingBundles.length))
                      .replace('{bundles}', saveWarningState.previewBundles.join(', '))
                      .replace('{moreText}', saveWarningMoreText)}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="flex gap-2">
              {onSwitchAgent && agentId !== currentAgentId && (
                <button
                  type="button"
                  onClick={() => {
                    if (isManagedUnavailable) {
                      return;
                    }
                    onSwitchAgent(agentId);
                  }}
                  disabled={isManagedUnavailable || isManagedForbidden}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-primary text-primary hover:bg-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {(isManagedUnavailable || isManagedForbidden)
                    ? (isManagedUnavailable
                      ? i18nService.t('managedUnavailableTag')
                      : i18nService.t('managedForbiddenTag'))
                    : (i18nService.t('switchToAgent') || 'Use this Agent')}
                </button>
              )}
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-sm font-medium rounded-lg text-secondary hover:bg-surface-raised transition-colors"
              >
                {i18nService.t('cancel') || 'Cancel'}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isManagedReadOnly
                  ? (saving || isManagedUnavailable || isManagedForbidden || !hasManagedExtraSkillChanges)
                  : saving}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saveButtonLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
      {showDeleteConfirm && (
        <AgentConfirmDialog
          variant={AgentConfirmDialogVariant.Delete}
          title={i18nService.t('confirmDelete')}
          message={i18nService.t('confirmDeleteMessage')}
          cancelLabel={i18nService.t('cancel')}
          confirmLabel={i18nService.t('delete')}
          onCancel={() => setShowDeleteConfirm(false)}
          onConfirm={handleDelete}
        />
      )}
      {showUnsavedConfirm && (
        <AgentConfirmDialog
          variant={AgentConfirmDialogVariant.Unsaved}
          title={i18nService.t('agentUnsavedTitle')}
          message={i18nService.t('agentUnsavedMessage')}
          cancelLabel={i18nService.t('cancel')}
          confirmLabel={i18nService.t('discard')}
          onCancel={() => setShowUnsavedConfirm(false)}
          onConfirm={handleConfirmDiscard}
        />
      )}
    </div>
  );
};

export default AgentSettingsPanel;
