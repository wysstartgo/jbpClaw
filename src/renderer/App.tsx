import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';
import React, { lazy, Suspense, useCallback, useEffect, useMemo,useRef, useState } from 'react';
import { useDispatch,useSelector } from 'react-redux';

import {
  AppUpdateStatus,
  type AppUpdateRuntimeState,
} from '../shared/appUpdate/constants';
import type { PetRuntimeState } from '../shared/pet/types';
import { OpenClawProviderId, ProviderName, ProviderRegistry } from '../shared/providers';
import { CoworkView } from './components/cowork';
import ConversationHistoryDrawer from './components/cowork/ConversationHistoryDrawer';
import CoworkPermissionModal from './components/cowork/CoworkPermissionModal';
import CoworkQuestionWizard from './components/cowork/CoworkQuestionWizard';
import EngineStartupOverlay from './components/cowork/EngineStartupOverlay';
import PrimarySidebar, { type WorkbenchMainView } from './components/layout/PrimarySidebar';
import SecondarySidebar from './components/layout/SecondarySidebar';
import LoginWelcomeOverlay from './components/LoginWelcomeOverlay';
import PrivacyDialog from './components/PrivacyDialog';
import { ScheduledTasksView } from './components/scheduledTasks';
import Settings, { type SettingsOpenOptions } from './components/Settings';
import { SkillsView } from './components/skills';
import Toast from './components/Toast';
import AppUpdateModal from './components/update/AppUpdateModal';
import WakeActivationOverlay from './components/WakeActivationOverlay';
import {
  nextWakeActivationOverlaySequence,
  shouldShowWakeActivationOverlay,
  WakeActivationOverlayPhase,
  type WakeActivationOverlayStateChange,
} from './components/wakeActivationOverlayHelpers';
import WindowTitleBar from './components/window/WindowTitleBar';
import { defaultConfig, getProviderDisplayName } from './config';
import { AppCustomEvent } from './constants/app';
import { isPetFloatingRoute } from './pet/floatingRoute';
import PetCompanion from './pet/PetCompanion';
import { petService } from './pet/petService';
import { usePetState } from './pet/usePetState';
import { agentService } from './services/agent';
import type { ApiConfig } from './services/api';
import { apiService } from './services/api';
import {
  type AppUpdateDownloadProgress,
  type AppUpdateInfo,
  applyBrandUpdatePolicy,
  checkForAppUpdate,
  clearStoredAppUpdateInfo,
  getStoredAppUpdateInfo,
  getStoredUpdateLastCheckedAt,
  setStoredAppUpdateInfo,
  setStoredUpdateLastCheckedAt,
} from './services/appUpdate';
import { authService } from './services/auth';
import {
  type BrandRuntimeConfig,
  getCachedBrandRuntimeConfig,
  getDefaultBrandRuntimeConfig,
  getPrivacyAgreementAcceptance,
  refreshBrandRuntimeConfig,
  savePrivacyAgreementAcceptance,
} from './services/brandRuntime';
import { configService } from './services/config';
import { coworkService } from './services/cowork';
import { i18nService } from './services/i18n';
import { scheduledTaskService } from './services/scheduledTask';
import { matchesShortcut } from './services/shortcuts';
import { themeService } from './services/theme';
import { RootState, store } from './store';
import { beginLoadSession, setDraftPrompt } from './store/slices/coworkSlice';
import {
  getModelIdentityKey,
  isSameModelIdentity,
  markSelectedModelPersisted,
  setAvailableModels,
  setSelectedModelSilently,
} from './store/slices/modelSlice';
import { clearSelection } from './store/slices/quickActionSlice';
import type { CoworkPermissionResult, CoworkSessionSummary } from './types/cowork';

const CoworkSearchModal = lazy(() => import('./components/cowork/CoworkSearchModal'));
const ApplicationsView = lazy(() => import('./components/apps/ApplicationsView'));
const AgentsView = lazy(() => import('./components/agent/AgentsView'));

const PetFloatingApp: React.FC = () => {
  const state = usePetState();

  useEffect(() => {
    void petService.init().catch((error) => {
      console.error('[App] PetFloatingApp init failed:', error);
    });
    document.documentElement.classList.add('pet-floating-window');
    return () => {
      document.documentElement.classList.remove('pet-floating-window');
    };
  }, []);

  if (!state) return null;
  return (
    <div className="h-screen w-screen overflow-hidden bg-transparent">
      <PetCompanion state={state} variant="floating" />
    </div>
  );
};

const getOpenClawProviderIdForConfig = (
  providerName: string,
  providerConfig: { authType?: string },
): string => {
  if (providerName === ProviderName.OpenAI && providerConfig.authType === 'oauth') {
    return OpenClawProviderId.OpenAICodex;
  }
  return ProviderRegistry.getOpenClawProviderId(providerName);
};

const createInitialAppUpdateState = (): AppUpdateRuntimeState => ({
  status: AppUpdateStatus.Idle,
  source: null,
  info: null,
  progress: null,
  readyFilePath: null,
  readyFileHash: null,
  errorMessage: null,
});

const MainApp: React.FC = () => {
  const electronApi = typeof window !== 'undefined' ? window.electron : undefined;
  const platform = electronApi?.platform ?? 'unknown';
  const [showSettings, setShowSettings] = useState(false);
  const [settingsOptions, setSettingsOptions] = useState<SettingsOpenOptions>({});
  const [mainView, setMainView] = useState<WorkbenchMainView>('cowork');
  const [coworkWorkspaceView, setCoworkWorkspaceView] = useState<'conversation' | 'agents'>('conversation');
  const [isInitialized, setIsInitialized] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showLoginWelcome, setShowLoginWelcome] = useState(false);
  const [showWakeActivationOverlay, setShowWakeActivationOverlay] = useState(false);
  const [wakeActivationOverlayPhase, setWakeActivationOverlayPhase] = useState<WakeActivationOverlayPhase>(
    WakeActivationOverlayPhase.Preparing
  );
  const [wakeActivationOverlayTranscript, setWakeActivationOverlayTranscript] = useState('');
  const [wakeActivationOverlaySequence, setWakeActivationOverlaySequence] = useState(0);
  const [, forceLanguageRefresh] = useState(0);
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [appUpdateState, setAppUpdateState] = useState<AppUpdateRuntimeState>(createInitialAppUpdateState);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updateModalState, setUpdateModalState] = useState<'info' | 'downloading' | 'installing' | 'error'>('info');
  const [downloadProgress, setDownloadProgress] = useState<AppUpdateDownloadProgress | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [privacyAgreed, setPrivacyAgreed] = useState<boolean | null>(null);
  const [brandRuntimeConfig, setBrandRuntimeConfig] = useState<BrandRuntimeConfig>(getDefaultBrandRuntimeConfig());
  const [enterpriseConfig, setEnterpriseConfig] = useState<{
    ui?: Record<string, 'hide' | 'disable' | 'readonly'>;
    disableUpdate?: boolean;
    autoAcceptPrivacy?: boolean;
  } | null>(null);
  const selectedModel = useSelector((state: RootState) => state.model.selectedModel);
  const availableModels = useSelector((state: RootState) => state.model.availableModels);
  const selectedModelDirty = useSelector((state: RootState) => state.model.selectedModelDirty);
  const currentSessionId = useSelector((state: RootState) => state.cowork.currentSessionId);
  const agents = useSelector((state: RootState) => state.agent.agents);
  const pendingPermissions = useSelector((state: RootState) => state.cowork.pendingPermissions);
  const pendingPermission = pendingPermissions[0] ?? null;
  const currentAgentId = useSelector((state: RootState) => state.agent.currentAgentId);
  const toastTimerRef = useRef<number | null>(null);
  const loginWelcomeTimerRef = useRef<number | null>(null);
  const hasInitialized = useRef(false);
  const shouldInstallReadyUpdateRef = useRef(false);
  const pendingConfiguredModelRecoveryRef = useRef<{
    fallbackModelKey: string | null;
  } | null>(null);
  const historyDrawerRequestIdRef = useRef(0);
  const globalSearchRequestIdRef = useRef(0);
  const dispatch = useDispatch();
  const isWindows = platform === 'win32';
  const [historyDrawerState, setHistoryDrawerState] = useState<{
    title: string;
    agentId: string;
    sessions: CoworkSessionSummary[];
    isLoading: boolean;
  } | null>(null);
  const [showCoworkSearch, setShowCoworkSearch] = useState(false);
  const [globalSearchSessions, setGlobalSearchSessions] = useState<CoworkSessionSummary[]>([]);
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const lazyPanelFallback = (
    <div className="flex h-full items-center justify-center text-sm text-secondary">
      {i18nService.t('loading')}
    </div>
  );

  const resolveConfiguredDefaultModel = useCallback(() => {
    const config = configService.getConfig();
    const configuredModelId = config.model.defaultModel?.trim();
    if (!configuredModelId) {
      return null;
    }
    return availableModels.find(
      (model) => model.id === configuredModelId
        && (!config.model.defaultModelProvider || model.providerKey === config.model.defaultModelProvider)
    ) ?? null;
  }, [availableModels]);

  const waitWithTimeout = useCallback(
    async <T,>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
      return await new Promise<T>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        promise.then(
          (value) => {
            window.clearTimeout(timer);
            resolve(value);
          },
          (error) => {
            window.clearTimeout(timer);
            reject(error);
          }
        );
      });
    },
    []
  );

  const disarmWakeFollowUp = useCallback(() => {
    if (!electronApi) {
      return;
    }
    void electronApi.speechFollowUp.disarm().catch((error) => {
      console.error('[WakeFollowUp] Failed to disarm speech follow-up:', error);
    });
  }, [electronApi]);

  const syncPrivacyAgreementState = useCallback(
    async (
      runtimeConfig: BrandRuntimeConfig,
      options?: { autoAccept?: boolean }
    ) => {
      if (!runtimeConfig.agreement.required) {
        setPrivacyAgreed(true);
        return true;
      }

      if (options?.autoAccept) {
        await savePrivacyAgreementAcceptance(runtimeConfig.agreement.version);
        setPrivacyAgreed(true);
        return true;
      }

      const acceptance = await getPrivacyAgreementAcceptance();
      const agreed = acceptance?.version === runtimeConfig.agreement.version;
      setPrivacyAgreed(agreed);
      return agreed;
    },
    []
  );

  // 初始化应用
  useEffect(() => {
    if (!electronApi) {
      return;
    }
    void electronApi.speechFollowUp.setActiveSession({ sessionId: currentSessionId ?? null }).catch((error) => {
      console.error('[WakeFollowUp] Failed to sync active session:', error);
    });
  }, [currentSessionId, electronApi]);

  useEffect(() => {
    if (hasInitialized.current) {
      return;
    }
    hasInitialized.current = true;
    const electronForInit = electronApi;

    const initializeApp = async () => {
      const startedAt = performance.now();
      const mark = (label: string) => {
        const elapsedMs = Math.round(performance.now() - startedAt);
        const message = `initializeApp ${label} (${elapsedMs}ms)`;
        console.info(`[App] ${message}`);
        try {
          electronForInit?.log.fromRenderer('info', 'AppInit', message);
        } catch {
          // Logging is best-effort during early startup.
        }
      };
      try {
        mark('start');
        if (!electronForInit) {
          throw new Error(i18nService.t('initializationElectronUnavailable'));
        }
        // 标记平台，用于 CSS 条件样式（如 Windows 标题栏按钮区域留白）
        document.documentElement.classList.add(`platform-${platform}`);
        const initTimeoutMs = platform === 'win32' ? 15_000 : 10_000;

        // 初始化配置
        await waitWithTimeout(configService.init(), initTimeoutMs, 'configService.init');
        mark('config ready');

        // Load enterprise config if present
        const entConfig = await electronForInit.enterprise.getConfig();
        setEnterpriseConfig(entConfig);
        mark('enterprise config ready');

        const cachedBrandConfig = await getCachedBrandRuntimeConfig();
        setBrandRuntimeConfig(cachedBrandConfig);
        mark('brand config ready');

        // 初始化主题
        themeService.initialize();
        mark('theme ready');

        // 初始化语言
        await waitWithTimeout(i18nService.initialize(), initTimeoutMs, 'i18nService.initialize');
        mark('i18n ready');

        void petService.init().catch((error) => {
          console.error('[App] initializeApp: petService.init failed:', error);
        });
        mark('pet service started');

        // 登录态恢复内部已经把重型同步拆到后台，这里尽早并行启动，
        // 让套餐模型和用户资料更快回到工作台，但不阻塞首屏。
        void authService.init().catch((error) => {
          console.error('[App] initializeApp: authService.init failed:', error);
        });
        mark('auth restore started');

        const config = await configService.getConfig();
        mark('app config loaded');
        
        const apiConfig: ApiConfig = {
          apiKey: config.api.key,
          baseUrl: config.api.baseUrl,
        };
        apiService.setConfig(apiConfig);

        // 从 providers 配置中加载可用模型列表到 Redux
        const providerModels: { id: string; name: string; provider?: string; providerKey?: string; openClawProviderId?: string; supportsImage?: boolean }[] = [];
        if (config.providers) {
          Object.entries(config.providers).forEach(([providerName, providerConfig]) => {
            if (providerConfig.enabled && providerConfig.models) {
              const openClawProviderId = getOpenClawProviderIdForConfig(providerName, providerConfig);
              providerConfig.models.forEach((model: { id: string; name: string; openClawProviderId?: string; supportsImage?: boolean }) => {
                providerModels.push({
                  id: model.id,
                  name: model.name,
                  provider: getProviderDisplayName(providerName, providerConfig),
                  providerKey: providerName,
                  openClawProviderId: model.openClawProviderId ?? openClawProviderId,
                  supportsImage: model.supportsImage ?? false,
                });
              });
            }
          });
        }
        const fallbackModels = config.model.availableModels.map(model => ({
          id: model.id,
          name: model.name,
          providerKey: undefined,
          openClawProviderId: model.openClawProviderId,
          supportsImage: model.supportsImage ?? false,
        }));
        const resolvedModels = providerModels.length > 0 ? providerModels : fallbackModels;
        if (resolvedModels.length > 0) {
          dispatch(setAvailableModels(resolvedModels));
          // Search all available models (including server models loaded by authService)
          // so that a previously selected server model is correctly restored.
          const allModels = store.getState().model.availableModels;
          const configuredModel = allModels.find(
            model => model.id === config.model.defaultModel
              && (!config.model.defaultModelProvider || model.providerKey === config.model.defaultModelProvider)
          ) ?? null;
          const preferredModel = configuredModel ?? allModels[0];
          pendingConfiguredModelRecoveryRef.current = null;
          if (config.model.defaultModel?.trim() && !configuredModel) {
            pendingConfiguredModelRecoveryRef.current = {
              fallbackModelKey: getModelIdentityKey(preferredModel),
            };
          }
          dispatch(setSelectedModelSilently(preferredModel));
        }

        if (entConfig?.disableUpdate || !cachedBrandConfig.update.enabled) {
          setUpdateInfo(null);
          await clearStoredAppUpdateInfo();
        } else {
          const cachedUpdateInfo = await getStoredAppUpdateInfo();
          setUpdateInfo(cachedUpdateInfo);
          if (cachedUpdateInfo?.forceUpdate) {
            setShowUpdateModal(true);
            setUpdateModalState('info');
            setUpdateError(null);
            setDownloadProgress(null);
          }
        }

        await syncPrivacyAgreementState(cachedBrandConfig, {
          autoAccept: entConfig?.autoAcceptPrivacy === true,
        });

        setIsInitialized(true);
        mark('shell ready');

        // 初始化定时任务服务，但不阻塞首屏
        void waitWithTimeout(scheduledTaskService.init(), 5000, 'scheduledTaskService.init').catch((error) => {
          console.error('[App] initializeApp: scheduledTaskService.init failed:', error);
        });

      } catch (error) {
        const elapsedMs = Math.round(performance.now() - startedAt);
        const message = error instanceof Error ? error.message : String(error);
        try {
          electronForInit?.log.fromRenderer('error', 'AppInit', `initializeApp failed after ${elapsedMs}ms: ${message}`);
        } catch {
          // Logging is best-effort during early startup.
        }
        console.error('Failed to initialize app:', error);
        setInitError(error instanceof Error && error.message ? error.message : i18nService.t('initializationError'));
        setIsInitialized(true);
      }
    };

    void initializeApp();
  }, [dispatch, electronApi, platform, syncPrivacyAgreementState, waitWithTimeout]);

  useEffect(() => {
    const unsubscribe = i18nService.subscribe(() => {
      forceLanguageRefresh((prev) => prev + 1);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isInitialized) {
      return;
    }

    let cancelled = false;

    const refreshRuntimeConfig = async () => {
      try {
        const latestRuntimeConfig = await refreshBrandRuntimeConfig();
        if (cancelled) {
          return;
        }

        setBrandRuntimeConfig(latestRuntimeConfig);

        if (enterpriseConfig?.disableUpdate || !latestRuntimeConfig.update.enabled) {
          setUpdateInfo(null);
          setShowUpdateModal(false);
          await clearStoredAppUpdateInfo();
        } else {
          const cachedUpdateInfo = await getStoredAppUpdateInfo();
          setUpdateInfo(cachedUpdateInfo);
          if (cachedUpdateInfo?.forceUpdate) {
            setShowUpdateModal(true);
            setUpdateModalState('info');
            setUpdateError(null);
            setDownloadProgress(null);
          }
        }

        await syncPrivacyAgreementState(latestRuntimeConfig, {
          autoAccept: enterpriseConfig?.autoAcceptPrivacy === true,
        });
      } catch (error) {
        console.warn('[BrandRuntime] Failed to refresh runtime config:', error);
      }
    };

    void refreshRuntimeConfig();

    return () => {
      cancelled = true;
    };
  }, [
    enterpriseConfig?.autoAcceptPrivacy,
    enterpriseConfig?.disableUpdate,
    isInitialized,
    syncPrivacyAgreementState,
  ]);

  // Network status monitoring
  useEffect(() => {
    if (!electronApi) {
      return;
    }
    const handleOnline = () => {
      console.log('[Renderer] Network online');
      electronApi.networkStatus.send('online');
    };

    const handleOffline = () => {
      console.log('[Renderer] Network offline');
      electronApi.networkStatus.send('offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [electronApi]);

  useEffect(() => {
    if (!isInitialized || !selectedModel?.id) {
      return;
    }

    const pendingRecovery = pendingConfiguredModelRecoveryRef.current;
    if (!pendingRecovery) {
      return;
    }

    const configuredModel = resolveConfiguredDefaultModel();
    if (!configuredModel) {
      if (
        selectedModelDirty
        || getModelIdentityKey(selectedModel) !== pendingRecovery.fallbackModelKey
      ) {
        pendingConfiguredModelRecoveryRef.current = null;
      }
      return;
    }

    pendingConfiguredModelRecoveryRef.current = null;
    if (!isSameModelIdentity(configuredModel, selectedModel) && !selectedModelDirty) {
      dispatch(setSelectedModelSilently(configuredModel));
    }
  }, [
    dispatch,
    isInitialized,
    resolveConfiguredDefaultModel,
    selectedModel,
    selectedModelDirty,
  ]);

  useEffect(() => {
    if (!isInitialized || !selectedModel?.id || !selectedModelDirty) {
      return;
    }

    const config = configService.getConfig();
    if (
      config.model.defaultModel === selectedModel.id
      && (config.model.defaultModelProvider ?? '') === (selectedModel.providerKey ?? '')
    ) {
      dispatch(markSelectedModelPersisted());
      return;
    }

    void configService.updateConfig({
      model: {
        ...config.model,
        defaultModel: selectedModel.id,
        defaultModelProvider: selectedModel.providerKey,
      },
    }).finally(() => {
      dispatch(markSelectedModelPersisted());
    });
  }, [dispatch, isInitialized, selectedModel, selectedModelDirty]);

  const handleShowSettings = useCallback((options?: SettingsOpenOptions) => {
    setSettingsOptions({
      initialTab: options?.initialTab,
      section: options?.section,
      notice: options?.notice,
      noticeI18nKey: options?.noticeI18nKey,
      noticeExtra: options?.noticeExtra,
    });
    setShowSettings(true);
  }, []);

  const handleShowSkills = useCallback(() => {
    setMainView('skills');
  }, []);

  const loadAgentSessions = useCallback(async (agentId: string): Promise<CoworkSessionSummary[]> => {
    const coworkApi = window.electron?.cowork;
    if (!coworkApi) {
      return [];
    }
    const result = await coworkApi.listSessions(agentId);
    return result.success && result.sessions ? result.sessions : [];
  }, []);

  const refreshHistoryDrawerSessions = useCallback(async (agentId: string, title: string) => {
    const requestId = ++historyDrawerRequestIdRef.current;
    setHistoryDrawerState((current) => {
      if (!current || current.agentId !== agentId) {
        return current;
      }
      return {
        ...current,
        title,
        isLoading: true,
      };
    });
    const sessions = await loadAgentSessions(agentId);
    if (requestId !== historyDrawerRequestIdRef.current) {
      return;
    }
    setHistoryDrawerState((current) => {
      if (!current || current.agentId !== agentId) {
        return current;
      }
      return {
        ...current,
        title,
        sessions,
        isLoading: false,
      };
    });
  }, [loadAgentSessions]);

  const loadGlobalSearchSessions = useCallback(async () => {
    const requestId = ++globalSearchRequestIdRef.current;
    setGlobalSearchLoading(true);
    if (!window.electron?.cowork) {
      setGlobalSearchSessions([]);
      setGlobalSearchLoading(false);
      return;
    }

    const enabledAgentIds = (agents.length > 0 ? agents : [{ id: 'main', enabled: true }])
      .filter((agent) => agent.enabled)
      .map((agent) => agent.id);
    const normalizedAgentIds = enabledAgentIds.includes('main')
      ? enabledAgentIds
      : ['main', ...enabledAgentIds];

    const sessionResults = await Promise.all(
      normalizedAgentIds.map((agentId) => loadAgentSessions(agentId)),
    );

    const mergedSessions = sessionResults
      .flat()
      .sort((leftSession, rightSession) => {
        if (leftSession.pinned !== rightSession.pinned) {
          return leftSession.pinned ? -1 : 1;
        }
        if (rightSession.updatedAt !== leftSession.updatedAt) {
          return rightSession.updatedAt - leftSession.updatedAt;
        }
        return rightSession.createdAt - leftSession.createdAt;
      });

    if (requestId !== globalSearchRequestIdRef.current) {
      return;
    }
    setGlobalSearchSessions(mergedSessions);
    setGlobalSearchLoading(false);
  }, [agents, loadAgentSessions]);

  const handleNewChat = useCallback(() => {
    disarmWakeFollowUp();
    // 仅在已经位于首页时清空输入，保留从会话返回首页时的首页草稿与附件。
    const shouldClearInput = mainView === 'cowork' && !currentSessionId;
    coworkService.clearSession();
    dispatch(clearSelection());
    setMainView('cowork');
    setCoworkWorkspaceView('conversation');
    setHistoryDrawerState(null);
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('cowork:focus-input', {
        detail: { clear: shouldClearInput },
      }));
    }, 0);
  }, [currentSessionId, disarmWakeFollowUp, dispatch, mainView]);

  const handleCreateSkillByChat = useCallback(() => {
    disarmWakeFollowUp();
    dispatch(setDraftPrompt({
      sessionId: '__home__',
      draft: i18nService.t('skillCreatorPrompt'),
    }));
    coworkService.clearSession();
    dispatch(clearSelection());
    setMainView('cowork');
    setCoworkWorkspaceView('conversation');
    setHistoryDrawerState(null);
  }, [disarmWakeFollowUp, dispatch]);

  const handleFocusCoworkInput = useCallback((clear = false) => {
    setMainView('cowork');
    setCoworkWorkspaceView('conversation');
    setHistoryDrawerState(null);
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent(AppCustomEvent.FocusCoworkInput, {
        detail: { clear },
      }));
    }, 0);
  }, []);

  const handleSelectMainView = useCallback((view: WorkbenchMainView) => {
    setMainView(view);
    if (view === 'cowork') {
      setCoworkWorkspaceView('conversation');
    }
    if (view !== 'cowork') {
      setHistoryDrawerState(null);
    }
  }, []);

  const ensureAgentContext = useCallback(async (agentId: string) => {
    if (!agentId || agentId === currentAgentId) {
      return;
    }
    const switched = agentService.switchAgent(agentId);
    if (switched) {
      await coworkService.loadSessions(agentId);
    }
  }, [currentAgentId]);

  const handleCreateConversationForAgent = useCallback(async (agentId: string) => {
    await ensureAgentContext(agentId);
    handleNewChat();
  }, [ensureAgentContext, handleNewChat]);

  const handleSelectConversation = useCallback(async (agentId: string, sessionId: string) => {
    await ensureAgentContext(agentId);
    dispatch(beginLoadSession(sessionId));
    setMainView('cowork');
    setCoworkWorkspaceView('conversation');
    setHistoryDrawerState(null);
    const loadedSession = await coworkService.loadSession(sessionId);
    if (!loadedSession) {
      coworkService.clearSession();
      window.dispatchEvent(new CustomEvent(AppCustomEvent.ShowToast, {
        detail: i18nService.t('coworkLoadSessionFailed'),
      }));
    }
  }, [dispatch, ensureAgentContext]);

  const handleOpenAgentWorkspace = useCallback(() => {
    setMainView('cowork');
    setCoworkWorkspaceView((current) => current === 'agents' ? 'conversation' : 'agents');
    setHistoryDrawerState(null);
  }, []);

  const handleOpenCoworkSearch = useCallback(() => {
    setMainView('cowork');
    void loadGlobalSearchSessions();
    setShowCoworkSearch(true);
  }, [loadGlobalSearchSessions]);

  const handleCloseCoworkSearch = useCallback(() => {
    setShowCoworkSearch(false);
  }, []);

  const handleOpenHistoryDrawer = useCallback((payload: {
    title: string;
    agentId: string;
    sessions: CoworkSessionSummary[];
  }) => {
    setHistoryDrawerState({
      ...payload,
      isLoading: payload.sessions.length === 0,
    });
    void refreshHistoryDrawerSessions(payload.agentId, payload.title);
  }, [refreshHistoryDrawerSessions]);

  const handleCloseHistoryDrawer = useCallback(() => {
    setHistoryDrawerState(null);
  }, []);

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    await coworkService.deleteSession(sessionId);
    setHistoryDrawerState((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        sessions: current.sessions.filter((session) => session.id !== sessionId),
      };
    });
  }, []);

  const handleTogglePinSession = useCallback(async (sessionId: string, pinned: boolean) => {
    await coworkService.setSessionPinned(sessionId, pinned);
    setHistoryDrawerState((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        sessions: current.sessions.map((session) => (
          session.id === sessionId ? { ...session, pinned } : session
        )),
      };
    });
  }, []);

  const handleRenameSession = useCallback(async (sessionId: string, title: string) => {
    await coworkService.renameSession(sessionId, title);
    setHistoryDrawerState((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        sessions: current.sessions.map((session) => (
          session.id === sessionId ? { ...session, title } : session
        )),
      };
    });
  }, []);

  useEffect(() => {
    const coworkApi = window.electron?.cowork;
    if (!coworkApi?.onSessionsChanged) {
      return;
    }

    const unsubscribe = coworkApi.onSessionsChanged(() => {
      if (historyDrawerState) {
        void refreshHistoryDrawerSessions(historyDrawerState.agentId, historyDrawerState.title);
      }
      if (showCoworkSearch) {
        void loadGlobalSearchSessions();
      }
    });

    return unsubscribe;
  }, [
    historyDrawerState,
    loadGlobalSearchSessions,
    refreshHistoryDrawerSessions,
    showCoworkSearch,
  ]);

  const triggerWakeActivationOverlay = useCallback(() => {
    setWakeActivationOverlayPhase(WakeActivationOverlayPhase.Preparing);
    setWakeActivationOverlayTranscript('');
    setShowWakeActivationOverlay(true);
    setWakeActivationOverlaySequence((current) => nextWakeActivationOverlaySequence(current));
  }, []);

  useEffect(() => {
    const handleWakeActivationOverlayUpdate = (event: Event) => {
      const detail = (event as CustomEvent<WakeActivationOverlayStateChange>).detail;
      if (!detail) {
        return;
      }

      if (detail.phase) {
        setWakeActivationOverlayPhase(detail.phase);
      }
      if (detail.transcript !== undefined) {
        setWakeActivationOverlayTranscript(detail.transcript);
      }
      setShowWakeActivationOverlay(detail.visible);
    };

    window.addEventListener(AppCustomEvent.UpdateWakeActivationOverlay, handleWakeActivationOverlayUpdate);
    return () => {
      window.removeEventListener(AppCustomEvent.UpdateWakeActivationOverlay, handleWakeActivationOverlayUpdate);
    };
  }, []);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 2200);
  }, []);

  const applyAppUpdateRuntimeState = useCallback(
    async (state: AppUpdateRuntimeState, options?: { autoInstallReady?: boolean }) => {
      setAppUpdateState(state);
      setDownloadProgress(state.progress);
      setUpdateError(state.errorMessage);

      if (state.info) {
        try {
          const currentVersion = await electronApi?.appInfo.getVersion();
          if (currentVersion) {
            const nextInfo = applyBrandUpdatePolicy(state.info, currentVersion, brandRuntimeConfig.update);
            setUpdateInfo(nextInfo);
            await setStoredAppUpdateInfo(nextInfo);
          }
        } catch (error) {
          console.error('[AppUpdate] failed to apply runtime update state:', error);
        }
      }

      if (state.status === AppUpdateStatus.Downloading || state.status === AppUpdateStatus.Checking) {
        setUpdateModalState('downloading');
        setShowUpdateModal(true);
        return;
      }
      if (state.status === AppUpdateStatus.Installing) {
        setUpdateModalState('installing');
        setShowUpdateModal(true);
        return;
      }
      if (state.status === AppUpdateStatus.Error) {
        setUpdateModalState('error');
        setShowUpdateModal(true);
        return;
      }
      if (state.status === AppUpdateStatus.Ready) {
        setUpdateModalState('info');
        setShowUpdateModal(true);
        if (options?.autoInstallReady && state.readyFilePath) {
          shouldInstallReadyUpdateRef.current = false;
          const installResult = await electronApi?.appUpdate.installReady();
          if (installResult && !installResult.success) {
            setUpdateModalState('error');
            setUpdateError(installResult.error || i18nService.t('updateInstallFailed'));
          }
        }
        return;
      }
      if (state.status === AppUpdateStatus.Available) {
        setUpdateModalState('info');
      }
    },
    [brandRuntimeConfig.update, electronApi]
  );

  useEffect(() => {
    if (!electronApi) {
      return;
    }

    let mounted = true;
    void electronApi.appUpdate.getState().then((state) => {
      if (mounted) {
        void applyAppUpdateRuntimeState(state);
      }
    }).catch((error) => {
      console.error('[AppUpdate] failed to load runtime state:', error);
    });

    const unsubscribe = electronApi.appUpdate.onStateChanged((state) => {
      void applyAppUpdateRuntimeState(state, {
        autoInstallReady: shouldInstallReadyUpdateRef.current,
      });
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [applyAppUpdateRuntimeState, electronApi]);

  const runUpdateCheck = useCallback(
    async (options?: { manual?: boolean }) => {
      if (!electronApi) {
        return null;
      }

      if (enterpriseConfig?.disableUpdate || !brandRuntimeConfig.update.enabled) {
        setUpdateInfo(null);
        setShowUpdateModal(false);
        await clearStoredAppUpdateInfo();
        return null;
      }

      const currentVersion = await electronApi.appInfo.getVersion();
      const requestedAt = Date.now();
      await setStoredUpdateLastCheckedAt(requestedAt);
      const nextUpdate = await checkForAppUpdate(currentVersion, {
        manual: options?.manual,
        updateConfig: brandRuntimeConfig.update,
      });

      setUpdateInfo(nextUpdate);

      if (nextUpdate) {
        await setStoredAppUpdateInfo(nextUpdate);
        const runtimeResult = await electronApi.appUpdate.setAvailable({
          latestVersion: nextUpdate.latestVersion,
          date: nextUpdate.date,
          changeLog: nextUpdate.changeLog,
          url: nextUpdate.url,
        }, { source: options?.manual ? 'manual' : 'auto' });
        await applyAppUpdateRuntimeState(runtimeResult.state);
        if (nextUpdate.forceUpdate) {
          setShowUpdateModal(true);
          setUpdateModalState('info');
          setUpdateError(null);
          setDownloadProgress(null);
        }
      } else {
        await clearStoredAppUpdateInfo();
        if (!options?.manual && !updateInfo?.forceUpdate) {
          setShowUpdateModal(false);
        }
      }

      return nextUpdate;
    },
    [applyAppUpdateRuntimeState, brandRuntimeConfig.update, electronApi, enterpriseConfig?.disableUpdate, updateInfo?.forceUpdate]
  );

  const handleUpdateFound = useCallback((info: AppUpdateInfo) => {
    setUpdateInfo(info);
    setUpdateModalState('info');
    setUpdateError(null);
    setDownloadProgress(null);
    setShowUpdateModal(true);
  }, []);

  const handleManualCheckUpdate = useCallback(async (): Promise<'available' | 'upToDate' | 'error'> => {
    try {
      const nextUpdate = await runUpdateCheck({ manual: true });
      if (nextUpdate) {
        handleUpdateFound(nextUpdate);
        return 'available';
      }
      return 'upToDate';
    } catch (error) {
      console.error('Failed to manually check app update:', error);
      return 'error';
    }
  }, [handleUpdateFound, runUpdateCheck]);

  const handleConfirmUpdate = useCallback(async () => {
    if (!updateInfo) return;
    if (!electronApi) {
      setUpdateModalState('error');
      setUpdateError(i18nService.t('initializationElectronUnavailable'));
      return;
    }

    if (appUpdateState.readyFilePath) {
      shouldInstallReadyUpdateRef.current = false;
      setUpdateModalState('installing');
      const installResult = await electronApi.appUpdate.installReady();
      if (!installResult.success) {
        setUpdateModalState('error');
        setUpdateError(installResult.error || i18nService.t('updateInstallFailed'));
      }
      return;
    }

    // If the URL is a fallback page (not a direct file download), open in browser
    if (updateInfo.url.includes('#') || updateInfo.url.endsWith('/download-list')) {
      if (!updateInfo.forceUpdate) {
        setShowUpdateModal(false);
      }
      if (!electronApi) {
        showToast(i18nService.t('updateOpenFailed'));
        return;
      }
      try {
        const result = await electronApi.shell.openExternal(updateInfo.url);
        if (!result.success) {
          showToast(i18nService.t('updateOpenFailed'));
        }
      } catch (error) {
        console.error('Failed to open update url:', error);
        showToast(i18nService.t('updateOpenFailed'));
      }
      return;
    }

    setUpdateModalState('downloading');
    setDownloadProgress(null);
    setUpdateError(null);

    const unsubscribe = electronApi.appUpdate.onDownloadProgress((progress) => {
      setDownloadProgress(progress);
    });

    try {
      shouldInstallReadyUpdateRef.current = true;
      const downloadResult = await electronApi.appUpdate.retryDownload();
      unsubscribe();

      if (!downloadResult.success) {
        setUpdateModalState('error');
        setUpdateError(i18nService.t('updateDownloadFailed'));
        return;
      }

      await applyAppUpdateRuntimeState(downloadResult.state, { autoInstallReady: true });
    } catch (error) {
      unsubscribe();
      shouldInstallReadyUpdateRef.current = false;
      const msg = error instanceof Error ? error.message : '';
      // If user cancelled, handleCancelDownload already set the state — don't overwrite
      if (msg === 'Download cancelled') {
        return;
      }
      setUpdateModalState('error');
      setUpdateError(msg || i18nService.t('updateDownloadFailed'));
    }
  }, [appUpdateState.readyFilePath, applyAppUpdateRuntimeState, electronApi, updateInfo, showToast]);

  const handleCancelDownload = useCallback(async () => {
    if (!electronApi) {
      return;
    }
    if (updateInfo?.forceUpdate) {
      return;
    }
    shouldInstallReadyUpdateRef.current = false;
    await electronApi.appUpdate.cancelDownload();
    setUpdateModalState('info');
    setDownloadProgress(null);
  }, [electronApi, updateInfo?.forceUpdate]);

  const handleRetryUpdate = useCallback(async () => {
    if (!electronApi) {
      return;
    }
    setUpdateModalState('info');
    setUpdateError(null);
    setDownloadProgress(null);
    if (appUpdateState.status === AppUpdateStatus.Error && updateInfo && !updateInfo.url.includes('#') && !updateInfo.url.endsWith('/download-list')) {
      shouldInstallReadyUpdateRef.current = false;
      const result = await electronApi.appUpdate.retryDownload();
      await applyAppUpdateRuntimeState(result.state);
    }
  }, [appUpdateState.status, applyAppUpdateRuntimeState, electronApi, updateInfo]);

  useEffect(() => {
    if (!updateInfo?.forceUpdate) {
      return;
    }

    setShowUpdateModal(true);
    setUpdateModalState('info');
    setUpdateError(null);
    setDownloadProgress(null);
  }, [updateInfo?.forceUpdate, updateInfo?.latestVersion]);

  const handlePrivacyAccept = useCallback(async () => {
    await savePrivacyAgreementAcceptance(brandRuntimeConfig.agreement.version);
    setPrivacyAgreed(true);
  }, [brandRuntimeConfig.agreement.version]);

  const handlePrivacyReject = useCallback(() => {
    // 立刻隐藏窗口，让用户感觉立即关闭
    electronApi?.window.close();
  }, [electronApi]);

  const handleExitApp = useCallback(() => {
    electronApi?.window.close();
  }, [electronApi]);

  const handlePermissionResponse = useCallback(async (result: CoworkPermissionResult) => {
    if (!pendingPermission) return;
    await coworkService.respondToPermission(pendingPermission.requestId, result);
  }, [pendingPermission]);

  const handleCloseSettings = () => {
    setShowSettings(false);
    const config = configService.getConfig();
    apiService.setConfig({
      apiKey: config.api.key,
      baseUrl: config.api.baseUrl,
    });

    if (config.providers) {
      const allModels: { id: string; name: string; provider?: string; providerKey?: string; openClawProviderId?: string; supportsImage?: boolean }[] = [];
      Object.entries(config.providers).forEach(([providerName, providerConfig]) => {
        if (providerConfig.enabled && providerConfig.models) {
          const openClawProviderId = getOpenClawProviderIdForConfig(providerName, providerConfig);
          providerConfig.models.forEach((model: { id: string; name: string; openClawProviderId?: string; supportsImage?: boolean }) => {
            allModels.push({
              id: model.id,
              name: model.name,
              provider: getProviderDisplayName(providerName, providerConfig),
              providerKey: providerName,
              openClawProviderId: model.openClawProviderId ?? openClawProviderId,
              supportsImage: model.supportsImage ?? false,
            });
          });
        }
      });
      if (allModels.length > 0) {
        dispatch(setAvailableModels(allModels));
      }
    }
  };

  const isShortcutInputActive = () => {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement)) return false;
    return activeElement.dataset.shortcutInput === 'true';
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || isShortcutInputActive()) return;

      const { shortcuts } = configService.getConfig();
      const activeShortcuts = {
        ...defaultConfig.shortcuts,
        ...(shortcuts ?? {}),
      };

      if (matchesShortcut(event, activeShortcuts.newChat)) {
        event.preventDefault();
        handleNewChat();
        return;
      }

      if (matchesShortcut(event, activeShortcuts.search)) {
        event.preventDefault();
        handleOpenCoworkSearch();
        return;
      }

      if (matchesShortcut(event, activeShortcuts.settings)) {
        event.preventDefault();
        handleShowSettings();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleOpenCoworkSearch, handleShowSettings, handleNewChat]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      if (loginWelcomeTimerRef.current) {
        window.clearTimeout(loginWelcomeTimerRef.current);
      }
    };
  }, []);

  // Listen for toast events from child components
  useEffect(() => {
    const handler = (e: Event) => {
      const message = (e as CustomEvent<string>).detail;
      if (message) showToast(message);
    };
    window.addEventListener(AppCustomEvent.ShowToast, handler);
    return () => window.removeEventListener(AppCustomEvent.ShowToast, handler);
  }, [showToast]);

  useEffect(() => {
    const handler = () => {
      if (showLoginWelcome) {
        return;
      }

      setShowLoginWelcome(true);
      if (loginWelcomeTimerRef.current) {
        window.clearTimeout(loginWelcomeTimerRef.current);
      }
      loginWelcomeTimerRef.current = window.setTimeout(() => {
        setShowLoginWelcome(false);
        loginWelcomeTimerRef.current = null;
      }, 2400);
    };

    window.addEventListener(AppCustomEvent.ShowLoginWelcome, handler);
    return () => {
      window.removeEventListener(AppCustomEvent.ShowLoginWelcome, handler);
    };
  }, [showLoginWelcome]);

  // 监听托盘菜单打开设置的 IPC 事件
  useEffect(() => {
    if (!electronApi) {
      return;
    }
    const unsubscribe = electronApi.ipcRenderer.on('app:openSettings', (options?: SettingsOpenOptions) => {
      handleShowSettings(options);
    });
    return unsubscribe;
  }, [electronApi, handleShowSettings]);

  useEffect(() => {
    if (!electronApi) {
      return;
    }
    const unsubscribe = electronApi.ipcRenderer.on('app:openPetSession', (session?: PetRuntimeState['session']) => {
      setMainView('cowork');
      setCoworkWorkspaceView('conversation');
      setHistoryDrawerState(null);
      if (session?.id) {
        dispatch(beginLoadSession(session.id));
        void coworkService.loadSession(session.id);
      }
    });
    return unsubscribe;
  }, [dispatch, electronApi]);

  // 监听托盘菜单新建任务的 IPC 事件
  useEffect(() => {
    if (!electronApi) {
      return;
    }
    const unsubscribe = electronApi.ipcRenderer.on('app:newTask', () => {
      handleNewChat();
    });
    return unsubscribe;
  }, [electronApi, handleNewChat]);

  useEffect(() => {
    if (!electronApi) {
      return;
    }
    const unsubscribe = electronApi.ipcRenderer.on('app:focusCoworkInput', (_payload?: { clear?: boolean }) => {
      handleFocusCoworkInput(Boolean(_payload?.clear));
    });
    return unsubscribe;
  }, [electronApi, handleFocusCoworkInput]);

  useEffect(() => {
    if (!electronApi) {
      return;
    }
    const unsubscribe = electronApi.wakeInput.onDictationRequested((request) => {
      disarmWakeFollowUp();
      handleFocusCoworkInput(false);
      if (shouldShowWakeActivationOverlay(request.source)) {
        triggerWakeActivationOverlay();
      }
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent(AppCustomEvent.StartWakeDictation, {
          detail: request,
        }));
      }, 0);
    });
    return unsubscribe;
  }, [disarmWakeFollowUp, electronApi, handleFocusCoworkInput, triggerWakeActivationOverlay]);

  useEffect(() => {
    if (!isInitialized) return;

    // Enterprise mode: completely skip update detection
    if (enterpriseConfig?.disableUpdate || !brandRuntimeConfig.update.enabled) return;

    let cancelled = false;

    const maybeCheck = async () => {
      if (cancelled) return;
      const now = Date.now();
      const lastCheckTime = await getStoredUpdateLastCheckedAt();
      if (lastCheckTime > 0 && now - lastCheckTime < brandRuntimeConfig.update.pollIntervalMs) {
        return;
      }

      try {
        await runUpdateCheck();
      } catch (error) {
        console.error('Failed to check app update:', error);
      }
    };

    // 启动时立即检查
    void maybeCheck();

    // 心跳：每 30 分钟检测是否距上次检查已超过 12 小时
    const timer = window.setInterval(() => {
      void maybeCheck();
    }, brandRuntimeConfig.update.heartbeatIntervalMs);

    // 窗口恢复可见时检测（覆盖休眠唤醒场景）
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void maybeCheck();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [
    brandRuntimeConfig.update.enabled,
    brandRuntimeConfig.update.heartbeatIntervalMs,
    brandRuntimeConfig.update.pollIntervalMs,
    enterpriseConfig?.disableUpdate,
    isInitialized,
    runUpdateCheck,
  ]);

  // 根据场景选择使用哪个权限组件
  const permissionModal = useMemo(() => {
    if (!pendingPermission) return null;

    // 检查是否为 AskUserQuestion 且有多个问题 -> 使用向导式组件
    const isQuestionTool = pendingPermission.toolName === 'AskUserQuestion';
    if (isQuestionTool && pendingPermission.toolInput) {
      const rawQuestions = (pendingPermission.toolInput as Record<string, unknown>).questions;
      const hasMultipleQuestions = Array.isArray(rawQuestions) && rawQuestions.length > 1;

      if (hasMultipleQuestions) {
        return (
          <CoworkQuestionWizard
            permission={pendingPermission}
            onRespond={handlePermissionResponse}
          />
        );
      }
    }

    // 其他情况使用原有的权限模态框
    return (
      <CoworkPermissionModal
        permission={pendingPermission}
        onRespond={handlePermissionResponse}
      />
    );
  }, [pendingPermission, handlePermissionResponse]);

  const isOverlayActive = showSettings || showUpdateModal || pendingPermissions.length > 0;
  const updateChecksManaged = Boolean(enterpriseConfig?.disableUpdate) || !brandRuntimeConfig.update.enabled;
  const windowsStandaloneTitleBar = isWindows ? (
    <div className="draggable relative h-9 shrink-0 bg-surface-raised">
      <WindowTitleBar isOverlayActive={isOverlayActive} />
    </div>
  ) : null;

  if (!isInitialized) {
    return (
      <div className="h-screen overflow-hidden flex flex-col">
        {windowsStandaloneTitleBar}
        <div className="flex-1 flex items-center justify-center bg-background">
          <div className="flex flex-col items-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-primary-hover flex items-center justify-center shadow-glow-accent animate-pulse">
              <ChatBubbleLeftRightIcon className="h-8 w-8 text-white" />
            </div>
            <div className="w-24 h-1 rounded-full bg-primary/20 overflow-hidden">
              <div className="h-full w-1/2 rounded-full bg-primary animate-shimmer" />
            </div>
            <div className="text-foreground text-xl font-medium">{i18nService.t('loading')}</div>
          </div>
        </div>
      </div>
    );
  }

  if (initError) {
    return (
      <div className="h-screen overflow-hidden flex flex-col">
        {windowsStandaloneTitleBar}
        <div className="flex-1 flex flex-col items-center justify-center bg-background">
          <div className="flex flex-col items-center space-y-6 max-w-md px-6">
            <div className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center shadow-lg">
              <ChatBubbleLeftRightIcon className="h-8 w-8 text-white" />
            </div>
            <div className="text-foreground text-xl font-medium text-center">{initError}</div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => window.electron.appInfo.relaunch()}
                className="px-6 py-2.5 bg-primary hover:bg-primary-hover text-white rounded-xl shadow-md transition-colors text-sm font-medium"
              >
                {i18nService.t('restartApp')}
              </button>
              <button
                onClick={() => handleShowSettings()}
                className="px-6 py-2.5 border border-border text-foreground hover:bg-surface-raised rounded-xl transition-colors text-sm font-medium"
              >
                {i18nService.t('openSettings')}
              </button>
            </div>
          </div>
          {showSettings && (
            <Settings
              onClose={handleCloseSettings}
              initialTab={settingsOptions.initialTab}
              section={settingsOptions.section}
              notice={settingsOptions.notice}
              noticeI18nKey={settingsOptions.noticeI18nKey}
              noticeExtra={settingsOptions.noticeExtra}
              onManualCheckUpdate={handleManualCheckUpdate}
              updateCheckManaged={updateChecksManaged}
              enterpriseConfig={enterpriseConfig}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-surface-raised">
      {showLoginWelcome && (
        <LoginWelcomeOverlay onClose={() => setShowLoginWelcome(false)} />
      )}
      {showWakeActivationOverlay && (
        <WakeActivationOverlay
          key={wakeActivationOverlaySequence}
          phase={wakeActivationOverlayPhase}
          transcript={wakeActivationOverlayTranscript}
        />
      )}
      {toastMessage && (
        <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
      )}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <PrimarySidebar
          activeView={mainView}
          onSelectView={handleSelectMainView}
          onOpenSettings={() => handleShowSettings()}
        />
        {mainView === 'cowork' && (
          <SecondarySidebar
            currentSessionId={currentSessionId}
            isAgentWorkspaceActive={coworkWorkspaceView === 'agents'}
            onCreateConversation={handleCreateConversationForAgent}
            onSelectConversation={handleSelectConversation}
            onOpenHistoryDrawer={handleOpenHistoryDrawer}
            onOpenAgentWorkspace={handleOpenAgentWorkspace}
            onOpenGlobalSearch={handleOpenCoworkSearch}
          />
        )}
        <div className="flex-1 min-w-0 p-1.5">
          <div className="relative h-full min-h-0 overflow-hidden rounded-[28px] bg-background">
            <EngineStartupOverlay suspended={showLoginWelcome} />
            {mainView === 'skills' ? (
              <SkillsView
                onCreateSkillByChat={handleCreateSkillByChat}
                readOnly={enterpriseConfig?.ui?.skills === 'readonly'}
              />
            ) : mainView === 'scheduledTasks' ? (
              <ScheduledTasksView />
            ) : mainView === 'applications' ? (
              <Suspense fallback={lazyPanelFallback}>
                <ApplicationsView />
              </Suspense>
            ) : coworkWorkspaceView === 'agents' ? (
              <Suspense fallback={lazyPanelFallback}>
                <AgentsView onShowCowork={() => setCoworkWorkspaceView('conversation')} />
              </Suspense>
            ) : (
              <CoworkView
                onRequestAppSettings={handleShowSettings}
                onShowSkills={handleShowSkills}
              />
            )}
            {mainView === 'cowork' && historyDrawerState && (
              <ConversationHistoryDrawer
                isOpen={true}
                title={historyDrawerState.title}
                sessions={historyDrawerState.sessions}
                isLoading={historyDrawerState.isLoading}
                currentSessionId={currentSessionId}
                onClose={handleCloseHistoryDrawer}
                onSelectSession={async (sessionId) => {
                  const targetSession = historyDrawerState.sessions.find((session) => session.id === sessionId);
                  const targetAgentId = targetSession?.agentId || 'main';
                  await handleSelectConversation(targetAgentId, sessionId);
                }}
                onDeleteSession={handleDeleteSession}
                onTogglePin={handleTogglePinSession}
                onRenameSession={handleRenameSession}
              />
            )}
          </div>
        </div>
      </div>
      {showCoworkSearch && (
        <Suspense fallback={null}>
          <CoworkSearchModal
            isOpen={showCoworkSearch}
            onClose={handleCloseCoworkSearch}
            sessions={globalSearchSessions}
            isLoading={globalSearchLoading}
            currentSessionId={currentSessionId}
            onSelectSession={async (sessionId) => {
              const targetSession = globalSearchSessions.find((session) => session.id === sessionId);
              const targetAgentId = targetSession?.agentId || 'main';
              await handleSelectConversation(targetAgentId, sessionId);
            }}
            onDeleteSession={async (sessionId) => {
              await coworkService.deleteSession(sessionId);
              setGlobalSearchSessions((current) => current.filter((session) => session.id !== sessionId));
            }}
            onTogglePin={async (sessionId, pinned) => {
              await coworkService.setSessionPinned(sessionId, pinned);
              setGlobalSearchSessions((current) => current.map((session) => (
                session.id === sessionId ? { ...session, pinned } : session
              )));
            }}
            onRenameSession={async (sessionId, title) => {
              await coworkService.renameSession(sessionId, title);
              setGlobalSearchSessions((current) => current.map((session) => (
                session.id === sessionId ? { ...session, title } : session
              )));
            }}
          />
        </Suspense>
      )}

      {/* 设置窗口显示在所有主内容之上，但不影响主界面的交互 */}
      {showSettings && (
        <Settings
          onClose={handleCloseSettings}
          initialTab={settingsOptions.initialTab}
          section={settingsOptions.section}
          notice={settingsOptions.notice}
          noticeI18nKey={settingsOptions.noticeI18nKey}
          noticeExtra={settingsOptions.noticeExtra}
          onManualCheckUpdate={handleManualCheckUpdate}
          updateCheckManaged={updateChecksManaged}
          enterpriseConfig={enterpriseConfig}
        />
      )}
      {showUpdateModal && updateInfo && (
        <AppUpdateModal
          updateInfo={updateInfo}
          onCancel={() => {
            if (!updateInfo.forceUpdate && (updateModalState === 'info' || updateModalState === 'error')) {
              setShowUpdateModal(false);
              setUpdateModalState('info');
              setUpdateError(null);
              setDownloadProgress(null);
            }
          }}
          onConfirm={handleConfirmUpdate}
          modalState={updateModalState}
          downloadProgress={downloadProgress}
          errorMessage={updateError}
          onCancelDownload={handleCancelDownload}
          onRetry={handleRetryUpdate}
          onExitApp={handleExitApp}
        />
      )}
      {permissionModal}
      {privacyAgreed === false && (
        <PrivacyDialog
          agreement={brandRuntimeConfig.agreement}
          onAccept={handlePrivacyAccept}
          onReject={handlePrivacyReject}
        />
      )}
    </div>
  );
};

const App: React.FC = () => (
  isPetFloatingRoute(window.location.hash) ? <PetFloatingApp /> : <MainApp />
);

export default App; 
