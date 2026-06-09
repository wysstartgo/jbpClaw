import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import { agentService } from '../../services/agent';
import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { RootState } from '../../store';
import { selectCurrentSessionId } from '../../store/selectors/coworkSelectors';
import type { SubagentSessionSummary } from '../../types/cowork';
import { isDefaultAgentId } from '../../utils/agentDisplay';
import AgentCreateModal from '../agent/AgentCreateModal';
import AgentSettingsPanel from '../agent/AgentSettingsPanel';
import { type CoworkOpenShareOptionsEventDetail, CoworkUiEvent } from '../cowork/constants';
import AgentTreeNode from './AgentTreeNode';
import MyAgentSidebarHeader from './MyAgentSidebarHeader';
import type { AgentSidebarAgentNode, AgentSidebarTaskNode } from './types';
import { useAgentSidebarState } from './useAgentSidebarState';
import { useSubagentSessions } from './useSubagentSessions';

interface MyAgentSidebarTreeProps {
  isBatchMode: boolean;
  batchAgentId: string | null;
  deletedSessionIds: string[];
  selectedIds: Set<string>;
  onShowCowork: () => void;
  onToggleSelection: (sessionId: string, agentId: string) => void;
  onEnterBatchMode: (sessionId: string, agentId: string) => void;
  onBatchSelectableIdsChange: (sessionIds: string[]) => void;
  onSelectSubagent?: (subagent: SubagentSessionSummary) => void;
}

const MyAgentSidebarTree: React.FC<MyAgentSidebarTreeProps> = ({
  isBatchMode,
  batchAgentId,
  deletedSessionIds,
  selectedIds,
  onShowCowork,
  onToggleSelection,
  onEnterBatchMode,
  onBatchSelectableIdsChange,
  onSelectSubagent,
}) => {
  const currentAgentId = useSelector((state: RootState) => state.agent.currentAgentId);
  const currentSessionId = useSelector(selectCurrentSessionId);
  const currentSessionStatus = useSelector((state: RootState) => state.cowork.currentSession?.status);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [settingsAgentId, setSettingsAgentId] = useState<string | null>(null);
  const [selectedSubagentId, setSelectedSubagentId] = useState<string | null>(null);
  const { subagentsBySessionId, refetchSubagents } = useSubagentSessions(currentSessionId, currentSessionStatus);
  const {
    agentNodes,
    patchTaskPreview,
    removeTaskPreview,
    removeTaskPreviews,
    removeAgentTaskPreviews,
    retryLoadTasks,
    loadMoreTasks,
    collapseTasks,
    toggleAgentExpanded,
  } = useAgentSidebarState();

  useEffect(() => {
    void agentService.loadAgents();
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<SubagentSessionSummary | null>).detail;
      setSelectedSubagentId(detail?.id ?? null);
      if (!detail && currentSessionId) {
        void refetchSubagents(currentSessionId);
      }
    };
    window.addEventListener(CoworkUiEvent.SelectSubagent, handler);
    return () => window.removeEventListener(CoworkUiEvent.SelectSubagent, handler);
  }, [currentSessionId, refetchSubagents]);

  const handleSelectTask = async (task: AgentSidebarTaskNode) => {
    if (task.agentId !== currentAgentId) {
      agentService.switchAgent(task.agentId);
      await coworkService.loadSessions(task.agentId);
    }
    onShowCowork();
    window.dispatchEvent(new CustomEvent(CoworkUiEvent.SelectSubagent, { detail: null }));
    return coworkService.loadSession(task.id);
  };

  const handleDeleteTask = async (task: AgentSidebarTaskNode) => {
    const deleted = await coworkService.deleteSession(task.id);
    if (deleted) {
      removeTaskPreview(task.id);
    }
  };

  const handleToggleTaskPin = async (task: AgentSidebarTaskNode, pinned: boolean) => {
    const success = await coworkService.setSessionPinned(task.id, pinned);
    if (success) {
      patchTaskPreview(task.id, { pinned }, { preserveUpdatedAt: true });
    }
  };

  const handleRenameTask = async (task: AgentSidebarTaskNode, title: string) => {
    const renamed = await coworkService.renameSession(task.id, title);
    if (renamed) {
      patchTaskPreview(task.id, { title });
    }
  };

  const handleShareTask = async (task: AgentSidebarTaskNode) => {
    const session = await handleSelectTask(task);
    if (!session) return;

    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent<CoworkOpenShareOptionsEventDetail>(
        CoworkUiEvent.OpenShareOptions,
        { detail: { sessionId: task.id } },
      ));
    }, 0);
  };

  const handleEnterBatchMode = (task: AgentSidebarTaskNode) => {
    if (task.agentId !== currentAgentId) {
      agentService.switchAgent(task.agentId);
      void coworkService.loadSessions(task.agentId);
    }
    onEnterBatchMode(task.id, task.agentId);
  };

  const handleCreateTask = async (agent: AgentSidebarAgentNode) => {
    if (agent.id !== currentAgentId) {
      agentService.switchAgent(agent.id);
      await coworkService.loadSessions(agent.id);
    }
    coworkService.clearSession({ restoreAgentSkills: true });
    onShowCowork();
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('cowork:focus-input', {
        detail: { clear: false },
      }));
    }, 0);
  };

  const handleDeleteAgent = async (agent: AgentSidebarAgentNode) => {
    if (isDefaultAgentId(agent.id)) return;
    const deleted = await agentService.deleteAgent(agent.id);
    if (deleted) {
      removeAgentTaskPreviews(agent.id);
    }
    if (deleted && settingsAgentId === agent.id) {
      setSettingsAgentId(null);
    }
    if (!deleted) {
      window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('agentDeleteFailed') }));
    }
  };

  const handleToggleAgentPin = async (agent: AgentSidebarAgentNode, pinned: boolean) => {
    // 当前聚宝盆分支的 agent 状态模型尚未持久化 agent pin。
    // 先保留 UI seam，避免把 per-agent modelSlice/agentSlice 迁移混进本批次。
    void agent;
    window.dispatchEvent(new CustomEvent('app:showToast', {
      detail: pinned ? i18nService.t('agentPinUnsupported') : i18nService.t('agentUnpinUnsupported'),
    }));
  };

  const renderAgentNode = (agent: AgentSidebarAgentNode) => (
    <AgentTreeNode
      key={agent.id}
      agent={agent}
      isBatchMode={isBatchMode}
      batchAgentId={batchAgentId}
      selectedIds={selectedIds}
      showBatchOption
      subagentsBySessionId={subagentsBySessionId}
      selectedSubagentId={selectedSubagentId}
      onSelectSubagent={(subagent) => {
        onSelectSubagent?.(subagent);
        onShowCowork();
        window.dispatchEvent(new CustomEvent(CoworkUiEvent.SelectSubagent, { detail: subagent }));
      }}
      onToggleExpanded={toggleAgentExpanded}
      onEditAgent={(agent) => setSettingsAgentId(agent.id)}
      onCreateTask={(agent) => void handleCreateTask(agent)}
      onDeleteAgent={handleDeleteAgent}
      onToggleAgentPin={handleToggleAgentPin}
      onRetryLoadTasks={(agentId) => void retryLoadTasks(agentId)}
      onLoadMoreTasks={(agentId) => void loadMoreTasks(agentId)}
      onCollapseTasks={collapseTasks}
      onSelectTask={(task) => void handleSelectTask(task)}
      onDeleteTask={handleDeleteTask}
      onShareTask={handleShareTask}
      onToggleTaskPin={handleToggleTaskPin}
      onRenameTask={handleRenameTask}
      onToggleSelection={onToggleSelection}
      onEnterBatchMode={handleEnterBatchMode}
    />
  );

  const pinnedAgentNodes = agentNodes.filter((agent) => agent.pinned);
  const projectAgentNodes = agentNodes.filter((agent) => !agent.pinned);
  const hasPinnedAgents = pinnedAgentNodes.length > 0;

  useEffect(() => {
    if (deletedSessionIds.length === 0) return;
    removeTaskPreviews(deletedSessionIds);
  }, [deletedSessionIds, removeTaskPreviews]);

  useEffect(() => {
    if (!batchAgentId) {
      onBatchSelectableIdsChange([]);
      return;
    }

    const batchAgent = agentNodes.find((agent) => agent.id === batchAgentId);
    onBatchSelectableIdsChange(batchAgent?.tasks.map((task) => task.id) ?? []);
  }, [agentNodes, batchAgentId, onBatchSelectableIdsChange]);

  return (
    <div className="pb-3" role="tree" aria-label={i18nService.t('myAgents')}>
      {hasPinnedAgents && (
        <div className="space-y-0.5">
          <div className="sticky top-0 z-30 flex h-10 items-center bg-surface-raised px-1.5">
            <h2 className="min-w-0 truncate text-[14px] font-normal text-foreground opacity-[0.28]">
              {i18nService.t('myAgentSidebarPinned')}
            </h2>
          </div>
          {pinnedAgentNodes.map(renderAgentNode)}
        </div>
      )}

      <MyAgentSidebarHeader
        onCreateAgent={() => setIsCreateOpen(true)}
      />

      {agentNodes.length === 0 ? (
        <div className="px-3 py-6 text-center">
          <p className="text-xs font-medium text-secondary">
            {i18nService.t('myAgentSidebarNoAgents')}
          </p>
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="mt-3 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-hover"
          >
            {i18nService.t('createNewAgent')}
          </button>
        </div>
      ) : projectAgentNodes.length > 0 ? (
        <div className="space-y-0.5 px-0">
          {projectAgentNodes.map(renderAgentNode)}
        </div>
      ) : null}

      <AgentCreateModal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
      <AgentSettingsPanel
        agentId={settingsAgentId}
        onClose={() => setSettingsAgentId(null)}
      />
    </div>
  );
};

export default MyAgentSidebarTree;
