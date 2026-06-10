import { LockClosedIcon, PlusIcon, SparklesIcon } from '@heroicons/react/24/outline';
import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import { agentService } from '../../services/agent';
import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { resolveQingShuManagedAccessPresentation } from '../../services/qingshuManagedUi';
import { RootState } from '../../store';
import type { PresetAgent } from '../../types/agent';
import ComposeIcon from '../icons/ComposeIcon';
import SidebarToggleIcon from '../icons/SidebarToggleIcon';
import WindowTitleBar from '../window/WindowTitleBar';
import AgentCreateModal from './AgentCreateModal';
import AgentSettingsPanel from './AgentSettingsPanel';

interface AgentsViewProps {
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  onShowCowork?: () => void;
  updateBadge?: React.ReactNode;
}

const AgentsView: React.FC<AgentsViewProps> = ({
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
  onShowCowork,
  updateBadge,
}) => {
  const isMac = window.electron.platform === 'darwin';
  const agents = useSelector((state: RootState) => state.agent.agents);
  const currentAgentId = useSelector((state: RootState) => state.agent.currentAgentId);
  const isLoggedIn = useSelector((state: RootState) => state.auth.isLoggedIn);
  const [presets, setPresets] = useState<PresetAgent[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [settingsAgentId, setSettingsAgentId] = useState<string | null>(null);
  const [addingPreset, setAddingPreset] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const refreshAgentCatalog = async () => {
      await agentService.loadAgents();
      const nextPresets = await agentService.getPresets();
      if (active) {
        setPresets(nextPresets);
      }
    };

    void refreshAgentCatalog();

    return () => {
      active = false;
    };
  }, [isLoggedIn]);

  // Refresh presets when agents change (to update installed status)
  useEffect(() => {
    agentService.getPresets().then(setPresets);
  }, [agents]);

  const visibleAgents = agents.filter((a) => a.id !== 'main');
  const enabledAgents = visibleAgents.filter((a) => a.enabled);
  const presetAgents = enabledAgents.filter((a) => a.source === 'preset');
  const managedAgents = visibleAgents.filter((a) => a.source === 'managed');
  const customAgents = enabledAgents.filter((a) => a.source === 'custom');
  const managedAvailableAgents = managedAgents.filter((agent) => !resolveQingShuManagedAccessPresentation({
    sourceType: agent.sourceType,
    allowed: agent.allowed,
    isLoggedIn,
    policyNote: agent.policyNote,
  }).isLocked);
  const managedLockedAgents = managedAgents.filter((agent) => resolveQingShuManagedAccessPresentation({
    sourceType: agent.sourceType,
    allowed: agent.allowed,
    isLoggedIn,
    policyNote: agent.policyNote,
  }).isLocked);
  const uninstalledPresets = presets.filter((p) => !p.installed);

  const handleAddPreset = async (presetId: string) => {
    setAddingPreset(presetId);
    try {
      await agentService.addPreset(presetId);
    } finally {
      setAddingPreset(null);
    }
  };

  const handleSwitchAgent = async (agentId: string) => {
    const switched = agentService.switchAgent(agentId);
    if (!switched) {
      return;
    }
    await coworkService.loadSessions(agentId);
    onShowCowork?.();
  };

  return (
    <div className="flex-1 flex flex-col bg-surface h-full">
      {/* Header */}
      <div className="jbp-visual-workbench-rail draggable flex h-16 items-center justify-between px-8 border-b shrink-0">
        <div className={`flex items-center gap-3 ${isMac ? 'pl-[68px]' : ''}`}>
          {isSidebarCollapsed && (
            <div className="non-draggable flex items-center gap-1">
              <button
                type="button"
                onClick={onToggleSidebar}
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-secondary hover:bg-surface-raised transition-colors"
              >
                <SidebarToggleIcon className="h-4 w-4" isCollapsed={true} />
              </button>
              <button
                type="button"
                onClick={onNewChat}
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-secondary hover:bg-surface-raised transition-colors"
              >
                <ComposeIcon className="h-4 w-4" />
              </button>
              {updateBadge}
            </div>
          )}
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              {i18nService.t('myAgents')}
            </h1>
            <p className="text-xs text-muted mt-0.5">
              {i18nService.t('agentsSubtitle')}
            </p>
          </div>
        </div>
        <div className="non-draggable flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="jbp-visual-primary-action inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium transition-all hover:-translate-y-[1px] active:translate-y-0"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            {i18nService.t('createNewAgent')}
          </button>
          <WindowTitleBar inline />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0 [scrollbar-gutter:stable]">
        <div className="max-w-4xl mx-auto px-8 py-8">

          {/* Preset Agents Section */}
          {(presetAgents.length > 0 || uninstalledPresets.length > 0) && (
            <section className="mb-10">
              <SectionHeader
                icon="⚡"
                title={i18nService.t('presetAgents')}
                count={presetAgents.length + uninstalledPresets.length}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Installed presets */}
                {presetAgents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    icon={agent.icon}
                    name={agent.name}
                    description={agent.description}
                    isActive={agent.id === currentAgentId}
                    onClick={() => setSettingsAgentId(agent.id)}
                  />
                ))}
                {/* Uninstalled presets */}
                {uninstalledPresets.map((preset) => {
                  const isEn = i18nService.getLanguage() === 'en';
                  return (
                    <UninstalledPresetCard
                      key={preset.id}
                      icon={preset.icon}
                      name={isEn && preset.nameEn ? preset.nameEn : preset.name}
                      description={isEn && preset.descriptionEn ? preset.descriptionEn : preset.description}
                      isAdding={addingPreset === preset.id}
                      onAdd={() => handleAddPreset(preset.id)}
                    />
                  );
                })}
              </div>
            </section>
          )}

          {managedAgents.length > 0 && (
            <section className="mb-10">
              <div className="mb-4 flex items-center justify-between gap-3">
                <SectionHeader
                  icon="🏢"
                  title={i18nService.t('managedAgents')}
                  count={managedAgents.length}
                />
                <div className="flex items-center gap-2">
                  <span className="jbp-visual-success-pill inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium">
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {i18nService.t('managedAvailableSection')} {managedAvailableAgents.length}
                  </span>
                  <span className="jbp-visual-muted-pill inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium">
                    <LockClosedIcon className="h-3 w-3" />
                    {i18nService.t('managedLockedSection')} {managedLockedAgents.length}
                  </span>
                </div>
              </div>
              {managedAvailableAgents.length > 0 && (
                <div className="mb-4">
                  <div className="mb-2 text-xs font-medium text-secondary">
                    {i18nService.t('managedAvailableSection')}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {managedAvailableAgents.map((agent) => (
                      <AgentCard
                        key={agent.id}
                        icon={agent.icon}
                        name={agent.name}
                        description={agent.description}
                        isActive={agent.id === currentAgentId}
                        badgeLabel={i18nService.t('sourceTypeQingShuManaged')}
                        onClick={() => setSettingsAgentId(agent.id)}
                      />
                    ))}
                  </div>
                </div>
              )}
              {managedLockedAgents.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-medium text-secondary">
                    {i18nService.t('managedLockedSection')}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {managedLockedAgents.map((agent) => {
                      const access = resolveQingShuManagedAccessPresentation({
                        sourceType: agent.sourceType,
                        allowed: agent.allowed,
                        isLoggedIn,
                        policyNote: agent.policyNote,
                      });
                      const unavailableLabel = access.lockTagKey
                        ? i18nService.t(access.lockTagKey)
                        : '';
                      return (
                        <AgentCard
                          key={agent.id}
                          icon={agent.icon}
                          name={agent.name}
                          description={agent.description}
                          isActive={agent.id === currentAgentId}
                          badgeLabel={i18nService.t('sourceTypeQingShuManaged')}
                          unavailableLabel={unavailableLabel}
                          isUnavailable={true}
                          onClick={() => setSettingsAgentId(agent.id)}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Custom Agents Section */}
          <section>
            <SectionHeader
              icon="🎨"
              title={i18nService.t('myCustomAgents')}
              count={customAgents.length}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {customAgents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  icon={agent.icon}
                  name={agent.name}
                  description={agent.description}
                  isActive={agent.id === currentAgentId}
                  onClick={() => setSettingsAgentId(agent.id)}
                />
              ))}
              {/* Create new agent card */}
              <button
                type="button"
                onClick={() => setIsCreateOpen(true)}
                className="jbp-visual-selectable-card group flex min-h-[160px] cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-dashed p-6 transition-all duration-300 hover:-translate-y-[2px] active:translate-y-0"
              >
                <div className="jbp-visual-icon-tile flex h-12 w-12 items-center justify-center rounded-2xl transition-all duration-300 group-hover:scale-110">
                  <PlusIcon className="h-5 w-5 text-primary" />
                </div>
                <div className="text-center">
                  <span className="text-sm font-medium text-primary">
                    {i18nService.t('createNewAgent')}
                  </span>
                  <p className="mt-1 text-[11px] text-muted">
                    {i18nService.t('agentCreateModeHint')}
                  </p>
                </div>
              </button>
            </div>
          </section>
        </div>
      </div>

      {/* Modals */}
      <AgentCreateModal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
      <AgentSettingsPanel
        agentId={settingsAgentId}
        onClose={() => setSettingsAgentId(null)}
        onSwitchAgent={(id) => {
          setSettingsAgentId(null);
          void handleSwitchAgent(id);
        }}
      />
    </div>
  );
};

/* ── Section Header ─────────────────────────── */

const SectionHeader: React.FC<{ icon: string; title: string; count: number }> = ({ icon, title, count }) => (
  <div className="flex items-center gap-2.5 mb-4">
    <span className="text-base">{icon}</span>
    <h2 className="text-sm font-semibold text-foreground">{title}</h2>
    <span className="jbp-visual-muted-pill rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums">{count}</span>
  </div>
);

/* ── Agent Card (installed) ─────────────────────────── */

const AgentCard: React.FC<{
  icon: string;
  name: string;
  description: string;
  isActive: boolean;
  badgeLabel?: string;
  unavailableLabel?: string;
  isUnavailable?: boolean;
  onClick: () => void;
}> = ({ icon, name, description, isActive, badgeLabel, unavailableLabel, isUnavailable, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`jbp-visual-selectable-card group relative flex min-h-[160px] flex-col items-start gap-3 rounded-2xl p-5 text-left transition-all duration-250 ${
      isUnavailable
        ? 'is-disabled'
        : 'hover:-translate-y-[2px] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)] dark:hover:shadow-[0_8px_30px_rgba(0,0,0,0.2)]'
    } ${
      isActive
        ? 'is-active'
        : isUnavailable
          ? ''
          : ''
    }`}
  >
    {/* Active indicator dot */}
    {isActive && (
      <span className="absolute right-4 top-4 flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-40" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
      </span>
    )}

    {isUnavailable && (
      <div className="jbp-visual-muted-pill absolute right-3 top-3 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium shadow-sm">
        <LockClosedIcon className="h-3 w-3" />
        {unavailableLabel}
      </div>
    )}

    {/* Icon with gradient background & mask */}
    <div className={`flex shrink-0 h-11 w-11 items-center justify-center rounded-[14px] overflow-hidden transition-transform duration-200 group-hover:scale-105 ${
      isActive
        ? 'jbp-visual-icon-tile'
        : 'jbp-visual-soft-card shadow-sm'
    }`}>
      <span className="text-2xl drop-shadow-sm">{icon || '🤖'}</span>
    </div>

    <div className="min-w-0 w-full">
      <div className="flex items-center gap-2 min-w-0">
        <div className={`text-sm font-semibold truncate ${isUnavailable ? 'text-secondary' : 'text-foreground'}`}>
          {name}
        </div>
        {badgeLabel && (
          <span className="jbp-visual-status-pill shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium">
            {badgeLabel}
          </span>
        )}
      </div>
      {description && (
        <div className="text-xs text-secondary mt-1 line-clamp-2 leading-relaxed">
          {description}
        </div>
      )}
      {isUnavailable && (
        <div className="jbp-visual-muted-pill mt-2.5 rounded-lg px-2.5 py-1.5 text-[11px] leading-4">
          {i18nService.t('managedUnavailableHint')}
        </div>
      )}
    </div>
  </button>
);

/* ── Uninstalled Preset Card ─────────────────────────── */

const UninstalledPresetCard: React.FC<{
  icon: string;
  name: string;
  description: string;
  isAdding: boolean;
  onAdd: () => void;
}> = ({ icon, name, description, isAdding, onAdd }) => (
  <div className="jbp-visual-selectable-card group flex min-h-[160px] flex-col items-start gap-3 rounded-2xl border-dashed p-5 transition-all duration-250">
    <div className="jbp-visual-soft-card flex shrink-0 h-11 w-11 items-center justify-center rounded-[14px] overflow-hidden shadow-sm">
      <span className="text-2xl opacity-60 drop-shadow-sm">{icon || '🤖'}</span>
    </div>
    <div className="min-w-0 w-full flex-1">
      <div className="text-sm font-semibold text-foreground/70 truncate">
        {name}
      </div>
      {description && (
        <div className="text-xs text-secondary/60 mt-1 line-clamp-2 leading-relaxed">
          {description}
        </div>
      )}
    </div>
    <button
      type="button"
      onClick={onAdd}
      disabled={isAdding}
      className="jbp-visual-secondary-action self-end inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-medium disabled:opacity-50 transition-all duration-200"
    >
      <SparklesIcon className="h-3 w-3" />
      {isAdding ? '...' : i18nService.t('addAgent')}
    </button>
  </div>
);

export default AgentsView;
