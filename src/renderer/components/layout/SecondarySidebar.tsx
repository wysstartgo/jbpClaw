import {
  ChatBubbleOvalLeftEllipsisIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  Cog6ToothIcon,
  EllipsisHorizontalIcon,
  ListBulletIcon,
  PencilSquareIcon,
  PlusIcon,
  RectangleStackIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { Platform } from '@shared/platform';
import { PlatformRegistry } from '@shared/platform';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import { AppCustomEvent } from '../../constants/app';
import { agentService } from '../../services/agent';
import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { localStore } from '../../services/store';
import { RootState } from '../../store';
import type { CoworkSessionSummary } from '../../types/cowork';
import AgentCreateModal from '../agent/AgentCreateModal';
import AgentSettingsPanel from '../agent/AgentSettingsPanel';
import QingShuBrandMark from '../branding/QingShuBrandMark';
import SearchIcon from '../icons/SearchIcon';

interface SidebarAgent {
  id: string;
  name: string;
  description: string;
  icon: string;
  enabled: boolean;
  isDefault: boolean;
  source: 'custom' | 'preset' | 'managed';
  sourceType?: string;
  readOnly?: boolean;
  allowed?: boolean;
  backendAgentId?: string;
  managedToolNames?: string[];
  managedBaseSkillIds?: string[];
  managedExtraSkillIds?: string[];
  policyNote?: string;
  skillIds: string[];
  toolBundleIds: string[];
}

interface ConversationGroup {
  id: string;
  title: string;
  searchTerms: string[];
  agent: SidebarAgent;
  sessions: CoworkSessionSummary[];
}

interface ConversationSection {
  id: string;
  title: string;
  groups: ConversationGroup[];
}

interface SecondarySidebarProps {
  currentSessionId: string | null;
  isAgentWorkspaceActive: boolean;
  onCreateConversation: (agentId: string) => void | Promise<void>;
  onSelectConversation: (agentId: string, sessionId: string) => void | Promise<void>;
  onOpenHistoryDrawer: (payload: { title: string; agentId: string; sessions: CoworkSessionSummary[] }) => void;
  onOpenAgentWorkspace: () => void;
  onOpenGlobalSearch: () => void;
}

type MenuState =
  | { kind: 'agent'; agentId: string; top: number; left: number }
  | { kind: 'session'; sessionId: string; top: number; left: number };

const MAX_VISIBLE_SESSIONS = 5;
const MENU_WIDTH = 176;
const PINNED_AGENT_IDS_STORE_KEY = 'workbench_pinned_agent_ids';
const SOURCE_PRIORITY: Record<SidebarAgent['source'], number> = {
  managed: 0,
  preset: 1,
  custom: 2,
};

const AgentPinIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <g transform="rotate(45 12 12)">
      <path d="M9 3h6l-1 5 2 2v2H8v-2l2-2-1-5z" />
      <path d="M12 12v9" />
    </g>
  </svg>
);

const formatCompactTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  const now = Date.now();
  const diff = now - timestamp;
  const oneDay = 24 * 60 * 60 * 1000;

  if (diff < oneDay) {
    return date.toLocaleTimeString(i18nService.getLanguage() === 'zh' ? 'zh-CN' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return date.toLocaleDateString(i18nService.getLanguage() === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'numeric',
    day: 'numeric',
  });
};

const resolveMenuPosition = (rect: DOMRect): { top: number; left: number } => ({
  top: rect.bottom + 8,
  left: Math.max(12, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 12)),
});

const isImageIcon = (value: string): boolean => /^(https?:\/\/|data:|\/)/.test(value);

const AgentAvatar: React.FC<{ agent: SidebarAgent; title: string }> = ({ agent, title }) => {
  const icon = (agent.icon || '').trim();

  if (agent.id === 'main') {
    return (
      <QingShuBrandMark
        className="relative flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary shadow-subtle ring-1 ring-white/45"
        iconClassName="text-[11px] font-semibold leading-none text-primary-foreground"
      />
    );
  }

  if (icon && isImageIcon(icon)) {
    return (
      <img
        src={icon}
        alt=""
        className="h-5 w-5 shrink-0 rounded-xl bg-background object-cover"
      />
    );
  }

  if (icon) {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-xl bg-background text-[11px] leading-none shadow-sm">
        {icon}
      </span>
    );
  }

  const fallback = Array.from((title || '?').trim()).slice(0, 2).join('') || '?';
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-xl bg-background text-[10px] leading-none shadow-sm">
      {fallback}
    </span>
  );
};

const ManagedAgentMark: React.FC = () => (
  <span
    className="inline-flex shrink-0"
    title={i18nService.t('sourceTypeQingShuManaged')}
    aria-label={i18nService.t('sourceTypeQingShuManaged')}
  >
    <QingShuBrandMark
      className="relative flex h-5 w-5 items-center justify-center overflow-hidden rounded-full bg-primary shadow-subtle ring-1 ring-white/45"
      iconClassName="text-[10px] font-semibold leading-none text-primary-foreground"
    />
  </span>
);

const SessionSourceIcon: React.FC<{ session: CoworkSessionSummary }> = ({ session }) => {
  if (session.source === 'im' && session.platform) {
    return (
      <span className="flex h-3.5 w-3.5 items-center justify-center overflow-hidden rounded-[4px] bg-white/95 shadow-[0_1px_2px_rgba(15,23,42,0.08)] ring-1 ring-black/8 dark:bg-white/95 dark:ring-white/12">
        <img
          src={PlatformRegistry.logo(session.platform as Platform)}
          alt={PlatformRegistry.get(session.platform as Platform).label}
          className="h-3 w-3 object-contain"
        />
      </span>
    );
  }

  return <ChatBubbleOvalLeftEllipsisIcon className="h-3.5 w-3.5" />;
};

const ConversationGroupBlock: React.FC<{
  group: ConversationGroup;
  expanded: boolean;
  isPinned: boolean;
  currentSessionId: string | null;
  isBatchMode: boolean;
  selectedSessionIds: Set<string>;
  searchQuery: string;
  renamingSessionId: string | null;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onRenameSave: () => void | Promise<void>;
  onRenameCancel: () => void;
  onToggleExpanded: () => void;
  onCreateConversation: () => void;
  onSelectConversation: (sessionId: string) => void;
  onToggleSelection: (sessionId: string) => void;
  onOpenHistoryDrawer: () => void;
  onOpenAgentMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onOpenSessionMenu: (event: React.MouseEvent<HTMLButtonElement>, sessionId: string) => void;
}> = ({
  group,
  expanded,
  isPinned,
  currentSessionId,
  isBatchMode,
  selectedSessionIds,
  searchQuery,
  renamingSessionId,
  renameValue,
  onRenameValueChange,
  onRenameSave,
  onRenameCancel,
  onToggleExpanded,
  onCreateConversation,
  onSelectConversation,
  onToggleSelection,
  onOpenHistoryDrawer,
  onOpenAgentMenu,
  onOpenSessionMenu,
}) => {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredSessions = useMemo(() => {
    if (!normalizedQuery) {
      return group.sessions;
    }
    return group.sessions.filter((session) => session.title.toLowerCase().includes(normalizedQuery));
  }, [group.sessions, normalizedQuery]);

  const visibleSessions = filteredSessions.slice(0, MAX_VISIBLE_SESSIONS);
  const hasMore = filteredSessions.length > MAX_VISIBLE_SESSIONS;
  const isManagedAgent = group.agent.source === 'managed';

  return (
    <section className="jbp-visual-soft-card group rounded-2xl px-1.5 py-1.5">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onCreateConversation}
          className="min-w-0 flex-1 rounded-xl px-1.5 py-1 text-left transition-colors hover:bg-background/70"
        >
          <div className="flex items-center gap-1.5">
            <AgentAvatar agent={group.agent} title={group.title} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <div className="truncate text-xs font-semibold text-foreground">{group.title}</div>
                {isManagedAgent && <ManagedAgentMark />}
                {isPinned && <AgentPinIcon className="h-2.5 w-2.5 shrink-0 text-primary" />}
              </div>
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={onOpenAgentMenu}
          className="rounded-lg p-1 text-secondary opacity-0 transition-all hover:bg-background/80 hover:text-foreground group-hover:opacity-100"
          aria-label={i18nService.t('coworkSessionActions')}
        >
          <EllipsisHorizontalIcon className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={onToggleExpanded}
          className="rounded-lg p-1 text-secondary transition-colors hover:bg-background/80 hover:text-foreground"
          aria-label={expanded ? i18nService.t('collapse') : i18nService.t('expand')}
        >
          {expanded ? <ChevronDownIcon className="h-3 w-3" /> : <ChevronRightIcon className="h-3 w-3" />}
        </button>
      </div>

      {expanded && (
        <div className="mt-1 space-y-0.5">
          {visibleSessions.length === 0 ? (
            <div className="px-2 py-2 text-[11px] text-secondary">
              {normalizedQuery ? i18nService.t('searchNoResults') : i18nService.t('workbenchConversationEmpty')}
            </div>
          ) : (
            visibleSessions.map((session) => {
              const isActive = session.id === currentSessionId;
              const isRenaming = renamingSessionId === session.id;
              return (
                <div
                  key={session.id}
                  className={`group/session relative flex items-center gap-1.5 rounded-lg px-2.5 py-2 transition-colors duration-200 ${
                    isActive
                      ? 'bg-primary-muted text-primary font-medium before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r-full before:bg-primary'
                      : 'text-foreground hover:bg-surface-raised'
                  } ${session.status === 'running' && !isActive ? 'qs-session-running' : ''}`}
                >
                  {isBatchMode && (
                    <button
                      type="button"
                      onClick={() => onToggleSelection(session.id)}
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                        selectedSessionIds.has(session.id)
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-surface text-transparent'
                      }`}
                      aria-label={selectedSessionIds.has(session.id)
                        ? i18nService.t('batchDeselectSession')
                        : i18nService.t('batchSelectSession')}
                    >
                      <CheckIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {isRenaming ? (
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                        <span className={`relative flex h-5 w-5 shrink-0 items-center justify-center rounded-xl ${
                        isActive ? 'bg-primary/14 text-primary' : 'bg-surface text-secondary'
                      }`}>
                        <SessionSourceIcon session={session} />
                        <span
                          className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface ${
                            session.status === 'running' ? 'bg-primary animate-pulse' : 'bg-border'
                          }`}
                        />
                      </span>
                      <input
                        value={renameValue}
                        autoFocus
                        onChange={(event) => onRenameValueChange(event.target.value)}
                        onClick={(event) => event.stopPropagation()}
                        onBlur={() => void onRenameSave()}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void onRenameSave();
                          } else if (event.key === 'Escape') {
                            event.preventDefault();
                            onRenameCancel();
                          }
                        }}
                        className="w-full rounded-lg border border-primary/30 bg-background px-2 py-1 text-xs font-medium text-foreground outline-none ring-2 ring-primary/10"
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        if (isBatchMode) {
                          onToggleSelection(session.id);
                          return;
                        }
                        onSelectConversation(session.id);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    >
                      <span className={`relative flex h-5 w-5 shrink-0 items-center justify-center rounded-xl ${
                        isActive ? 'bg-primary/14 text-primary' : 'bg-background text-secondary'
                      }`}>
                        <SessionSourceIcon session={session} />
                        {session.status === 'running' && (
                          <span
                            className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface bg-primary animate-pulse"
                          />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">{session.title}</span>
                        <span className="block truncate text-[10px] text-muted">
                          {formatCompactTime(session.updatedAt)}
                        </span>
                      </span>
                    </button>
                  )}

                  {!isRenaming && (
                    <div className="ml-auto flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={(event) => onOpenSessionMenu(event, session.id)}
                        className={`rounded-lg p-1 text-secondary transition-colors hover:bg-background hover:text-foreground ${
                          isBatchMode ? 'hidden' : isActive ? 'opacity-100' : 'opacity-0 group-hover/session:opacity-100'
                        }`}
                        aria-label={i18nService.t('coworkSessionActions')}
                      >
                        <EllipsisHorizontalIcon className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}

          {hasMore && (
            <button
              type="button"
              onClick={onOpenHistoryDrawer}
              className="w-full rounded-xl px-2 py-1.5 text-left text-xs font-medium text-secondary transition-colors hover:bg-background/80 hover:text-foreground"
            >
              {i18nService.t('workbenchExpandMore')}
            </button>
          )}
        </div>
      )}
    </section>
  );
};

const SecondarySidebar: React.FC<SecondarySidebarProps> = ({
  currentSessionId,
  isAgentWorkspaceActive,
  onCreateConversation,
  onSelectConversation,
  onOpenHistoryDrawer,
  onOpenAgentWorkspace,
  onOpenGlobalSearch,
}) => {
  const agents = useSelector((state: RootState) => state.agent.agents);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateAgentOpen, setIsCreateAgentOpen] = useState(false);
  const [settingsAgentId, setSettingsAgentId] = useState<string | null>(null);
  const [groupSessions, setGroupSessions] = useState<Record<string, CoworkSessionSummary[]>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [pinnedAgentIds, setPinnedAgentIds] = useState<string[]>([]);
  const [menuState, setMenuState] = useState<MenuState | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [batchGroupId, setBatchGroupId] = useState<string | null>(null);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<string | null>(null);
  const loadGroupSessionsRequestIdRef = useRef(0);

  const enabledAgents = useMemo(() => {
    const filteredAgents = agents.filter((agent) => agent.enabled) as SidebarAgent[];
    const fallbackMainAgent: SidebarAgent = {
      id: 'main',
      name: i18nService.t('workbenchConversationGroupMain'),
      description: '',
      icon: '',
      enabled: true,
      isDefault: true,
      source: 'custom',
      skillIds: [],
      toolBundleIds: [],
    };
    const mainAgent = filteredAgents.find((agent) => agent.id === 'main') ?? fallbackMainAgent;
    const otherAgents = filteredAgents
      .filter((agent) => agent.id !== 'main')
      .sort((leftAgent, rightAgent) => {
        const leftPriority = SOURCE_PRIORITY[leftAgent.source];
        const rightPriority = SOURCE_PRIORITY[rightAgent.source];
        if (leftPriority !== rightPriority) {
          return leftPriority - rightPriority;
        }
        return leftAgent.name.localeCompare(rightAgent.name, 'zh-CN');
      });

    return [mainAgent, ...otherAgents];
  }, [agents]);

  const loadGroupSessions = useCallback(async () => {
    const electronApi = window.electron?.cowork;
    if (!electronApi) {
      return;
    }
    const requestId = ++loadGroupSessionsRequestIdRef.current;

    const sessionResults = await Promise.all(
      enabledAgents.map(async (agent) => {
        const result = await electronApi.listSessions(agent.id);
        return [
          agent.id,
          result.success && result.sessions ? result.sessions : [],
        ] as const;
      }),
    );

    if (requestId !== loadGroupSessionsRequestIdRef.current) {
      return;
    }
    setGroupSessions(Object.fromEntries(sessionResults));
  }, [enabledAgents]);

  useEffect(() => {
    agentService.loadAgents();
  }, []);

  useEffect(() => {
    let isMounted = true;
    void localStore.getItem<string[]>(PINNED_AGENT_IDS_STORE_KEY).then((storedValue) => {
      if (!isMounted) {
        return;
      }
      setPinnedAgentIds(Array.isArray(storedValue) ? storedValue : []);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    void loadGroupSessions();
  }, [loadGroupSessions]);

  useEffect(() => {
    const coworkApi = window.electron?.cowork;
    if (!coworkApi?.onSessionsChanged) {
      return;
    }
    const unsubscribe = coworkApi.onSessionsChanged(() => {
      void loadGroupSessions();
    });
    return unsubscribe;
  }, [loadGroupSessions]);

  useEffect(() => {
    setExpandedGroups((current) => {
      const nextState: Record<string, boolean> = {};
      enabledAgents.forEach((agent) => {
        nextState[agent.id] = current[agent.id] ?? agent.id === 'main';
      });
      return nextState;
    });
  }, [enabledAgents]);

  useEffect(() => {
    const validAgentIds = new Set(enabledAgents.map((agent) => agent.id));
    const normalizedPinnedIds = pinnedAgentIds.filter((agentId) => validAgentIds.has(agentId));
    if (normalizedPinnedIds.length !== pinnedAgentIds.length) {
      setPinnedAgentIds(normalizedPinnedIds);
      void localStore.setItem(PINNED_AGENT_IDS_STORE_KEY, normalizedPinnedIds);
    }
  }, [enabledAgents, pinnedAgentIds]);

  useEffect(() => {
    if (!menuState) {
      return;
    }

    const handleCloseMenu = () => {
      setMenuState(null);
    };

    document.addEventListener('mousedown', handleCloseMenu);
    window.addEventListener('resize', handleCloseMenu);
    window.addEventListener('scroll', handleCloseMenu, true);
    return () => {
      document.removeEventListener('mousedown', handleCloseMenu);
      window.removeEventListener('resize', handleCloseMenu);
      window.removeEventListener('scroll', handleCloseMenu, true);
    };
  }, [menuState]);

  const handleTogglePinAgent = useCallback(async (agentId: string) => {
    const nextPinnedIds = pinnedAgentIds.includes(agentId)
      ? pinnedAgentIds.filter((id) => id !== agentId)
      : [agentId, ...pinnedAgentIds.filter((id) => id !== agentId)];
    setPinnedAgentIds(nextPinnedIds);
    await localStore.setItem(PINNED_AGENT_IDS_STORE_KEY, nextPinnedIds);
    setMenuState(null);
  }, [pinnedAgentIds]);

  const groups: ConversationGroup[] = useMemo(() => {
    const groupsByPinnedOrder = [...enabledAgents]
      .sort((leftAgent, rightAgent) => {
        const leftPinnedIndex = pinnedAgentIds.indexOf(leftAgent.id);
        const rightPinnedIndex = pinnedAgentIds.indexOf(rightAgent.id);

        if (leftPinnedIndex !== -1 && rightPinnedIndex !== -1) {
          return leftPinnedIndex - rightPinnedIndex;
        }
        if (leftPinnedIndex !== -1) {
          return -1;
        }
        if (rightPinnedIndex !== -1) {
          return 1;
        }
        if (leftAgent.id === 'main') {
          return -1;
        }
        if (rightAgent.id === 'main') {
          return 1;
        }
        return 0;
      });

    return groupsByPinnedOrder.map((agent) => {
      const groupTitle = agent.id === 'main'
        ? i18nService.t('workbenchConversationGroupMain')
        : agent.name;

      return {
        id: agent.id,
        title: groupTitle,
        searchTerms: [
          groupTitle,
          agent.name,
          agent.description || '',
          agent.id,
          agent.source === 'managed' ? i18nService.t('sourceTypeQingShuManaged') : '',
        ].filter(Boolean),
        agent,
        sessions: groupSessions[agent.id] ?? [],
      };
    });
  }, [enabledAgents, groupSessions, pinnedAgentIds]);

  const batchGroup = useMemo(
    () => groups.find((group) => group.id === batchGroupId) ?? null,
    [batchGroupId, groups],
  );

  const batchGroupSessions = useMemo(
    () => batchGroup?.sessions ?? [],
    [batchGroup],
  );

  const visibleGroups = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return groups;
    }

    return groups.filter((group) => {
      const matchesGroup = group.searchTerms.some((term) => term.toLowerCase().includes(normalizedQuery));
      const matchesSessions = group.sessions.some((session) => session.title.toLowerCase().includes(normalizedQuery));
      return matchesGroup || matchesSessions;
    });
  }, [groups, searchQuery]);

  const visibleSections = useMemo<ConversationSection[]>(() => {
    const visibleGroupMap = new Map(visibleGroups.map((group) => [group.id, group]));
    const pinnedGroupIds = pinnedAgentIds.filter((agentId) => visibleGroupMap.has(agentId));
    const pinnedGroupIdSet = new Set(pinnedGroupIds);

    const pinnedGroups = pinnedGroupIds
      .map((agentId) => visibleGroupMap.get(agentId))
      .filter((group): group is ConversationGroup => Boolean(group));

    const mainGroups = pinnedGroupIdSet.has('main')
      ? []
      : [visibleGroupMap.get('main')].filter((group): group is ConversationGroup => Boolean(group));

    const managedGroups = visibleGroups.filter((group) => (
      !pinnedGroupIdSet.has(group.id)
      && group.id !== 'main'
      && group.agent.source === 'managed'
    ));

    const otherGroups = visibleGroups.filter((group) => (
      !pinnedGroupIdSet.has(group.id)
      && group.id !== 'main'
      && group.agent.source !== 'managed'
    ));

    return [
      {
        id: 'pinned',
        title: i18nService.t('workbenchPinnedAgentsSection'),
        groups: pinnedGroups,
      },
      {
        id: 'main',
        title: i18nService.t('workbenchMainAgentSection'),
        groups: mainGroups,
      },
      {
        id: 'managed',
        title: i18nService.t('workbenchManagedAgentsSection'),
        groups: managedGroups,
      },
      {
        id: 'other',
        title: i18nService.t('workbenchOtherAgentsSection'),
        groups: otherGroups,
      },
    ].filter((section) => section.groups.length > 0);
  }, [pinnedAgentIds, visibleGroups]);

  const sessionById = useMemo(() => {
    const pairs = Object.values(groupSessions).flat().map((session) => [session.id, session] as const);
    return new Map(pairs);
  }, [groupSessions]);

  useEffect(() => {
    if (!batchGroupId) {
      return;
    }

    if (!batchGroup) {
      setBatchGroupId(null);
      setSelectedSessionIds(new Set());
      setShowBatchDeleteConfirm(false);
      return;
    }

    const validSessionIds = new Set(batchGroupSessions.map((session) => session.id));
    setSelectedSessionIds((current) => {
      const nextSelection = new Set(
        Array.from(current).filter((sessionId) => validSessionIds.has(sessionId)),
      );
      return nextSelection.size === current.size ? current : nextSelection;
    });
  }, [batchGroup, batchGroupId, batchGroupSessions]);

  const handleRenameStart = useCallback((session: CoworkSessionSummary) => {
    setRenamingSessionId(session.id);
    setRenameValue(session.title);
    setMenuState(null);
  }, []);

  const handleRenameCancel = useCallback(() => {
    setRenamingSessionId(null);
    setRenameValue('');
  }, []);

  const handleRenameSave = useCallback(async () => {
    if (!renamingSessionId) {
      return;
    }

    const nextTitle = renameValue.trim();
    const targetSession = sessionById.get(renamingSessionId);
    if (!targetSession) {
      handleRenameCancel();
      return;
    }

    if (nextTitle && nextTitle !== targetSession.title) {
      await coworkService.renameSession(renamingSessionId, nextTitle);
    }
    handleRenameCancel();
  }, [handleRenameCancel, renameValue, renamingSessionId, sessionById]);

  const showToast = useCallback((message: string) => {
    window.dispatchEvent(new CustomEvent(AppCustomEvent.ShowToast, { detail: message }));
  }, []);

  const handleRequestDeleteSession = useCallback((sessionId: string) => {
    setPendingDeleteSessionId(sessionId);
    setMenuState(null);
  }, []);

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    const deleted = await coworkService.deleteSession(sessionId);
    if (deleted) {
      setGroupSessions((current) => {
        const nextEntries = Object.entries(current).map(([groupId, sessions]) => [
          groupId,
          sessions.filter((session) => session.id !== sessionId),
        ] as const);
        return Object.fromEntries(nextEntries);
      });
    } else {
      showToast(i18nService.t('deleteConversationFailed'));
    }
    if (renamingSessionId === sessionId) {
      handleRenameCancel();
    }
    setPendingDeleteSessionId(null);
  }, [handleRenameCancel, renamingSessionId, showToast]);

  const handleTogglePinSession = useCallback(async (sessionId: string) => {
    const session = sessionById.get(sessionId);
    if (!session) {
      return;
    }
    await coworkService.setSessionPinned(sessionId, !session.pinned);
    setMenuState(null);
  }, [sessionById]);

  const selectedSession = menuState?.kind === 'session' ? sessionById.get(menuState.sessionId) ?? null : null;

  const handleEnterBatchMode = useCallback((sessionId: string) => {
    const targetGroup = groups.find((group) => group.sessions.some((session) => session.id === sessionId));
    if (!targetGroup) {
      return;
    }
    setBatchGroupId(targetGroup.id);
    setExpandedGroups((current) => ({
      ...current,
      [targetGroup.id]: true,
    }));
    setSelectedSessionIds(new Set([sessionId]));
    setMenuState(null);
  }, [groups]);

  const handleExitBatchMode = useCallback(() => {
    setBatchGroupId(null);
    setSelectedSessionIds(new Set());
    setShowBatchDeleteConfirm(false);
  }, []);

  const handleToggleSelection = useCallback((sessionId: string) => {
    setSelectedSessionIds((current) => {
      const nextSelection = new Set(current);
      if (nextSelection.has(sessionId)) {
        nextSelection.delete(sessionId);
      } else {
        nextSelection.add(sessionId);
      }
      return nextSelection;
    });
  }, []);

  const handleToggleSelectAll = useCallback(() => {
    if (!batchGroup) {
      return;
    }
    setSelectedSessionIds((current) => {
      if (current.size === batchGroup.sessions.length) {
        return new Set();
      }
      return new Set(batchGroup.sessions.map((session) => session.id));
    });
  }, [batchGroup]);

  const handleBatchDelete = useCallback(async () => {
    const sessionIds = Array.from(selectedSessionIds);
    if (sessionIds.length === 0) {
      return;
    }
    const deleted = await coworkService.deleteSessions(sessionIds);
    if (deleted) {
      const sessionIdSet = new Set(sessionIds);
      setGroupSessions((current) => {
        const nextEntries = Object.entries(current).map(([groupId, sessions]) => [
          groupId,
          sessions.filter((session) => !sessionIdSet.has(session.id)),
        ] as const);
        return Object.fromEntries(nextEntries);
      });
      handleExitBatchMode();
    }
  }, [handleExitBatchMode, selectedSessionIds]);

  return (
    <>
      <aside className={`jbp-visual-workbench-rail flex w-[320px] shrink-0 flex-col border-r px-5 pb-5 ${window.electron?.platform === 'darwin' ? 'pt-8' : 'pt-5'}`}>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <SearchIcon className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    onOpenGlobalSearch();
                  }
                }}
                placeholder={i18nService.t('workbenchConversationSearchPlaceholder')}
                className="jbp-visual-soft-field w-full rounded-lg py-2.5 pl-9 pr-3 text-sm outline-none transition-[border-color,box-shadow,background-color] placeholder:text-secondary"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setIsCreateAgentOpen(true)}
              className="jbp-visual-primary-action group flex h-[38px] items-center justify-center gap-2 rounded-lg border border-transparent px-3 text-sm font-medium transition-all active:scale-[0.98]"
            >
              <span className="flex items-center justify-center text-primary-foreground">
                <PlusIcon className="h-4 w-4" strokeWidth={2.5} />
              </span>
              <span>{i18nService.t('workbenchCreateDedicatedAgent')}</span>
            </button>
            <button
              type="button"
              onClick={onOpenAgentWorkspace}
              className={`group flex h-[38px] items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors ${
                isAgentWorkspaceActive
                  ? 'border-primary/25 bg-primary/10 text-primary'
                  : 'border-border bg-surface text-foreground hover:bg-surface-raised'
              }`}
            >
              <span className={`flex items-center justify-center transition-colors ${
                isAgentWorkspaceActive ? 'text-primary' : 'text-secondary group-hover:text-foreground'
              }`}>
                <RectangleStackIcon className="h-4 w-4" />
              </span>
              {isAgentWorkspaceActive
                ? i18nService.t('workbenchConversationReturnAction')
                : i18nService.t('workbenchAgentManageAction')}
            </button>
          </div>
        </div>

        <div className="mt-5 flex-1 overflow-y-auto pr-1">
          {visibleSections.length === 0 ? (
            <div className="rounded-[20px] border border-border/70 bg-surface/65 px-4 py-4 text-sm text-secondary">
              {searchQuery.trim()
                ? i18nService.t('searchNoResults')
                : i18nService.t('workbenchConversationEmpty')}
            </div>
          ) : (
            <div className="space-y-2.5">
              {visibleSections.map((section) => (
                <section key={section.id} className="space-y-1.5">
                  <div className="flex items-center gap-2 px-1">
                    <span className="shrink-0 text-[11px] font-semibold tracking-[0.12em] text-secondary">
                      {section.title}
                    </span>
                    <div className="h-px flex-1 bg-border/70" />
                  </div>
                  <div className="space-y-1.5">
                    {section.groups.map((group) => (
                      <ConversationGroupBlock
                        key={group.id}
                        group={group}
                        expanded={expandedGroups[group.id] ?? false}
                        isPinned={pinnedAgentIds.includes(group.agent.id)}
                        currentSessionId={currentSessionId}
                        isBatchMode={batchGroupId === group.id}
                        selectedSessionIds={selectedSessionIds}
                        searchQuery={searchQuery}
                        renamingSessionId={renamingSessionId}
                        renameValue={renameValue}
                        onRenameValueChange={setRenameValue}
                        onRenameSave={handleRenameSave}
                        onRenameCancel={handleRenameCancel}
                        onToggleExpanded={() => {
                          setExpandedGroups((current) => ({
                            ...current,
                            [group.id]: !current[group.id],
                          }));
                        }}
                        onCreateConversation={() => {
                          void onCreateConversation(group.agent.id);
                        }}
                        onSelectConversation={(sessionId) => {
                          void onSelectConversation(group.agent.id, sessionId);
                        }}
                        onToggleSelection={handleToggleSelection}
                        onOpenHistoryDrawer={() => {
                          onOpenHistoryDrawer({
                            title: group.title,
                            agentId: group.agent.id,
                            sessions: group.sessions,
                          });
                        }}
                        onOpenAgentMenu={(event) => {
                          event.stopPropagation();
                          const { top, left } = resolveMenuPosition(event.currentTarget.getBoundingClientRect());
                          setMenuState({
                            kind: 'agent',
                            agentId: group.agent.id,
                            top,
                            left,
                          });
                        }}
                        onOpenSessionMenu={(event, sessionId) => {
                          event.stopPropagation();
                          const { top, left } = resolveMenuPosition(event.currentTarget.getBoundingClientRect());
                          setMenuState({
                            kind: 'session',
                            sessionId,
                            top,
                            left,
                          });
                        }}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        {batchGroup && (
          <div className="mt-4 rounded-[20px] border border-border bg-surface p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-foreground">
                  {i18nService.t('batchOperations')}
                </div>
                <div className="mt-1 text-xs text-secondary">
                  {i18nService.t('workbenchBatchModeHint').replace('{group}', batchGroup.title)}
                </div>
              </div>
              <button
                type="button"
                onClick={handleExitBatchMode}
                className="rounded-xl p-2 text-secondary transition-colors hover:bg-background/80 hover:text-foreground"
                aria-label={i18nService.t('batchCancel')}
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={handleToggleSelectAll}
                className="flex-1 rounded-[16px] border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-raised"
              >
                {batchGroup.sessions.length > 0 && selectedSessionIds.size === batchGroup.sessions.length
                  ? i18nService.t('batchDeselectAll')
                  : i18nService.t('batchSelectAll')}
              </button>
              <button
                type="button"
                onClick={() => setShowBatchDeleteConfirm(true)}
                disabled={selectedSessionIds.size === 0}
                className="jbp-visual-danger-action flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                <TrashIcon className="h-4 w-4" />
                {i18nService.t('batchDelete')} ({selectedSessionIds.size})
              </button>
            </div>
          </div>
        )}
      </aside>

      <AgentCreateModal isOpen={isCreateAgentOpen} onClose={() => setIsCreateAgentOpen(false)} />
      <AgentSettingsPanel
        agentId={settingsAgentId}
        onClose={() => setSettingsAgentId(null)}
      />

      {menuState?.kind === 'agent' && (
        <div
          className="fixed z-50 min-w-[176px] rounded-2xl border border-border bg-surface py-1 shadow-popover"
          style={{ top: menuState.top, left: menuState.left }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => void handleTogglePinAgent(menuState.agentId)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface-raised"
          >
            <AgentPinIcon className="h-4 w-4 text-secondary" />
            {pinnedAgentIds.includes(menuState.agentId)
              ? i18nService.t('unpinConversation')
              : i18nService.t('pinConversation')}
          </button>
          <button
            type="button"
            onClick={() => {
              setSettingsAgentId(menuState.agentId);
              setMenuState(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface-raised"
          >
            <Cog6ToothIcon className="h-4 w-4 text-secondary" />
            {i18nService.t('agentSettings')}
          </button>
        </div>
      )}

      {menuState?.kind === 'session' && selectedSession && (
        <div
          className="fixed z-50 min-w-[176px] rounded-2xl border border-border bg-surface py-1 shadow-popover"
          style={{ top: menuState.top, left: menuState.left }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => handleEnterBatchMode(selectedSession.id)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface-raised"
          >
            <ListBulletIcon className="h-4 w-4 text-secondary" />
            {i18nService.t('batchOperations')}
          </button>
          <button
            type="button"
            onClick={() => handleRenameStart(selectedSession)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface-raised"
          >
            <PencilSquareIcon className="h-4 w-4 text-secondary" />
            {i18nService.t('renameConversation')}
          </button>
          <button
            type="button"
            onClick={() => void handleTogglePinSession(selectedSession.id)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface-raised"
          >
            <AgentPinIcon className="h-4 w-4 text-secondary" />
            {selectedSession.pinned
              ? i18nService.t('unpinConversation')
              : i18nService.t('pinConversation')}
          </button>
          <button
            type="button"
            onClick={() => handleRequestDeleteSession(selectedSession.id)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[color:var(--lobster-destructive)] transition-colors hover:bg-[color-mix(in_srgb,var(--lobster-destructive)_10%,transparent)]"
          >
            <TrashIcon className="h-4 w-4" />
            {i18nService.t('deleteConversation')}
          </button>
        </div>
      )}

      {pendingDeleteSessionId && (
        <div
          className="jbp-visual-backdrop fixed inset-0 z-50 flex items-center justify-center"
          onClick={() => setPendingDeleteSessionId(null)}
        >
          <div
            className="jbp-visual-panel w-full max-w-sm rounded-[28px] p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="jbp-visual-danger-note flex h-10 w-10 items-center justify-center rounded-2xl">
                <TrashIcon className="h-5 w-5" />
              </div>
              <div>
                <div className="text-base font-semibold text-foreground">
                  {i18nService.t('deleteConversation')}
                </div>
                <div className="mt-1 text-sm text-secondary">
                  {sessionById.get(pendingDeleteSessionId)?.title || i18nService.t('deleteConversation')}
                </div>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-secondary">
              {i18nService.t('confirmDeleteMessage')}
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDeleteSessionId(null)}
                className="rounded-2xl border border-border px-4 py-2 text-sm font-medium text-secondary transition-colors hover:bg-surface-raised"
              >
                {i18nService.t('cancel')}
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteSession(pendingDeleteSessionId)}
                className="jbp-visual-danger-action rounded-2xl px-4 py-2 text-sm font-medium transition-colors"
              >
                {i18nService.t('deleteConversation')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showBatchDeleteConfirm && batchGroup && (
        <div
          className="jbp-visual-backdrop fixed inset-0 z-50 flex items-center justify-center"
          onClick={() => setShowBatchDeleteConfirm(false)}
        >
          <div
            className="jbp-visual-panel w-full max-w-sm rounded-[28px] p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="jbp-visual-danger-note flex h-10 w-10 items-center justify-center rounded-2xl">
                <TrashIcon className="h-5 w-5" />
              </div>
              <div>
                <div className="text-base font-semibold text-foreground">
                  {i18nService.t('batchDeleteConfirmTitle')}
                </div>
                <div className="mt-1 text-sm text-secondary">
                  {i18nService.t('workbenchBatchModeHint').replace('{group}', batchGroup.title)}
                </div>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-secondary">
              {i18nService.t('batchDeleteConfirmMessage').replace('{count}', String(selectedSessionIds.size))}
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowBatchDeleteConfirm(false)}
                className="rounded-2xl border border-border px-4 py-2 text-sm font-medium text-secondary transition-colors hover:bg-surface-raised"
              >
                {i18nService.t('cancel')}
              </button>
              <button
                type="button"
                onClick={() => void handleBatchDelete()}
                className="jbp-visual-danger-action rounded-2xl px-4 py-2 text-sm font-medium transition-colors"
              >
                {i18nService.t('batchDelete')} ({selectedSessionIds.size})
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default SecondarySidebar;
