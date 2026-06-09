import { ArrowPathIcon, XCircleIcon as XCircleIconSolid } from '@heroicons/react/20/solid';
import {
  ArrowDownTrayIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  LockClosedIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { qingshuGovernanceService } from '../../services/qingshuGovernance';
import { qingshuManagedService } from '../../services/qingshuManaged';
import {
  resolveQingShuManagedAccessPresentation,
  resolveQingShuSourceLabelKey,
} from '../../services/qingshuManagedUi';
import { compareVersions,resolveLocalizedText, skillService } from '../../services/skill';
import { RootState } from '../../store';
import { setSkills } from '../../store/slices/skillSlice';
import type { QingShuSkillGovernanceResult } from '../../types/qingshuGovernance';
import { MarketplaceSkill, MarketTag, Skill, WorkspaceSkillInstall } from '../../types/skill';
import ErrorMessage from '../ErrorMessage';
import FolderOpenIcon from '../icons/FolderOpenIcon';
import LinkIcon from '../icons/LinkIcon';
import PencilSquareIcon from '../icons/PencilSquareIcon';
import PlusCircleIcon from '../icons/PlusCircleIcon';
import PuzzleIcon from '../icons/PuzzleIcon';
import SearchIcon from '../icons/SearchIcon';
import TrashIcon from '../icons/TrashIcon';
import UploadIcon from '../icons/UploadIcon';
import QingShuGovernancePreview from './QingShuGovernancePreview';
import {
  type SkillImportSourceType as SkillImportSourceTab,
  SkillImportSourceType,
  validateSkillImportSource,
} from './skillImportSource';
import SkillSecurityReport from './SkillSecurityReport';

type SkillTab = 'installed' | 'marketplace';
type ManagedSkillFilter = 'all' | 'available' | 'locked';
type DirectImportSource = 'zip' | 'folder' | 'remote';
const MANAGED_SKILL_MANUAL_REFRESH_COOLDOWN_MS = 60 * 1000;

interface SkillsManagerProps {
  readOnly?: boolean;
  onCreateByChat?: () => void;
}

const importSourceTypes: SkillImportSourceTab[] = [
  SkillImportSourceType.GitHub,
  SkillImportSourceType.ClawHub,
];

const importTabConfig: Record<SkillImportSourceTab, {
  tabLabelKey: string;
  descriptionKey: string;
  urlLabelKey: string;
  placeholderKey: string;
  examplesKey: string;
}> = {
  [SkillImportSourceType.GitHub]: {
    tabLabelKey: 'githubTabLabel',
    descriptionKey: 'githubImportDescription',
    urlLabelKey: 'githubImportUrlLabel',
    placeholderKey: 'githubSkillPlaceholder',
    examplesKey: 'githubImportExamples',
  },
  [SkillImportSourceType.ClawHub]: {
    tabLabelKey: 'clawhubTabLabel',
    descriptionKey: 'clawhubImportDescription',
    urlLabelKey: 'clawhubImportUrlLabel',
    placeholderKey: 'clawhubSkillPlaceholder',
    examplesKey: 'clawhubImportExamples',
  },
};

const SkillsManager: React.FC<SkillsManagerProps> = ({ readOnly, onCreateByChat }) => {
  const dispatch = useDispatch();
  const skills = useSelector((state: RootState) => state.skill.skills);
  const isLoggedIn = useSelector((state: RootState) => state.auth.isLoggedIn);
  const showGovernanceDebug = import.meta.env.DEV;

  const [skillSearchQuery, setSkillSearchQuery] = useState('');
  const [skillDownloadSource, setSkillDownloadSource] = useState('');
  const [skillActionError, setSkillActionError] = useState('');
  const [isDownloadingSkill, setIsDownloadingSkill] = useState(false);
  const [isAddSkillMenuOpen, setIsAddSkillMenuOpen] = useState(false);
  const [isRemoteImportOpen, setIsRemoteImportOpen] = useState(false);
  const [importTab, setImportTab] = useState<SkillImportSourceTab>(SkillImportSourceType.GitHub);
  const [activeTab, setActiveTab] = useState<SkillTab>('installed');
  const [marketplaceSkills, setMarketplaceSkills] = useState<MarketplaceSkill[]>([]);
  const [marketTags, setMarketTags] = useState<MarketTag[]>([]);
  const [activeMarketTag, setActiveMarketTag] = useState('all');
  const [managedSkillFilter, setManagedSkillFilter] = useState<ManagedSkillFilter>('all');
  const [workspaceTemporarySkills, setWorkspaceTemporarySkills] = useState<WorkspaceSkillInstall[]>([]);
  const [isLoadingMarketplace, setIsLoadingMarketplace] = useState(false);
  const [installingSkillId, setInstallingSkillId] = useState<string | null>(null);
  const [selectedMarketplaceSkill, setSelectedMarketplaceSkill] = useState<MarketplaceSkill | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [skillPendingDelete, setSkillPendingDelete] = useState<Skill | null>(null);
  const [isDeletingSkill, setIsDeletingSkill] = useState(false);
  const [securityReport, setSecurityReport] = useState<any>(null);
  const [pendingInstallId, setPendingInstallId] = useState<string | null>(null);
  const [pendingImportSource, setPendingImportSource] = useState<DirectImportSource | null>(null);
  const [isConfirmingInstall, setIsConfirmingInstall] = useState(false);
  const [governancePreviewSkillId, setGovernancePreviewSkillId] = useState<string | null>(null);
  const [governancePreviewTitle, setGovernancePreviewTitle] = useState<string | null>(null);
  const [governancePreviewResult, setGovernancePreviewResult] = useState<QingShuSkillGovernanceResult | null>(null);
  const [isRefreshingManagedSkills, setIsRefreshingManagedSkills] = useState(false);
  const [managedRefreshCooldownUntil, setManagedRefreshCooldownUntil] = useState(0);
  const [managedRefreshNow, setManagedRefreshNow] = useState(Date.now());
  const [upgradeState, setUpgradeState] = useState<{
    isActive: boolean;
    total: number;
    current: number;
    currentSkillName: string;
    currentSkillVersion: string;
  } | null>(null);
  const upgradeCancelledRef = useRef(false);

  const addSkillMenuRef = useRef<HTMLDivElement>(null);
  const addSkillButtonRef = useRef<HTMLButtonElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const getSourceLabel = (sourceType?: string) => {
    return i18nService.t(resolveQingShuSourceLabelKey(sourceType));
  };

  const getManagedSkillAccess = (skill: Skill) => resolveQingShuManagedAccessPresentation({
    sourceType: skill.sourceType,
    allowed: skill.allowed,
    isLoggedIn,
    policyNote: skill.policyNote,
  });

  const showToast = (message: string) => {
    window.dispatchEvent(new CustomEvent('app:showToast', { detail: message }));
  };

  const getManagedSkillLockTag = (skill: Skill) => {
    const tagKey = getManagedSkillAccess(skill).lockTagKey;
    return tagKey ? i18nService.t(tagKey) : '';
  };

  const getManagedSkillLockHint = (skill: Skill) => {
    const access = getManagedSkillAccess(skill);
    if (access.lockHintOverride) {
      return access.lockHintOverride;
    }
    return access.lockHintKey ? i18nService.t(access.lockHintKey) : '';
  };

  useEffect(() => {
    let isActive = true;
    const loadSkills = async () => {
      const loadedSkills = await skillService.loadSkills();
      if (!isActive) return;
      dispatch(setSkills(loadedSkills));
    };
    loadSkills();

    const unsubscribe = skillService.onSkillsChanged(async () => {
      const loadedSkills = await skillService.loadSkills();
      if (!isActive) return;
      dispatch(setSkills(loadedSkills));
    });

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [dispatch]);

  useEffect(() => {
    let isActive = true;
    const loadWorkspaceTemporarySkills = async () => {
      const installs = await skillService.listWorkspaceTemporarySkills(skills);
      if (!isActive) return;
      setWorkspaceTemporarySkills(installs);
    };

    if (activeTab === 'installed') {
      void loadWorkspaceTemporarySkills();
    }

    return () => {
      isActive = false;
    };
  }, [activeTab, skills]);

  useEffect(() => {
    let isActive = true;
    setIsLoadingMarketplace(true);
    skillService.fetchMarketplaceSkills().then((data) => {
      if (!isActive) return;
      setMarketplaceSkills(data.skills);
      setMarketTags(data.tags);
      setIsLoadingMarketplace(false);
    });
    return () => { isActive = false; };
  }, []);

  useEffect(() => {
    if (!managedRefreshCooldownUntil) return undefined;
    const intervalId = window.setInterval(() => {
      const now = Date.now();
      setManagedRefreshNow(now);
      if (now >= managedRefreshCooldownUntil) {
        setManagedRefreshCooldownUntil(0);
      }
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [managedRefreshCooldownUntil]);

  useEffect(() => {
    if (!isAddSkillMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const isInsideMenu = addSkillMenuRef.current?.contains(target);
      const isInsideButton = addSkillButtonRef.current?.contains(target);
      if (!isInsideMenu && !isInsideButton) {
        setIsAddSkillMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsAddSkillMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isAddSkillMenuOpen]);

  useEffect(() => {
    if (!isRemoteImportOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsRemoteImportOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    setTimeout(() => importInputRef.current?.focus(), 0);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [importTab, isRemoteImportOpen]);

  useEffect(() => {
    const hasOpenDialog = selectedSkill || selectedMarketplaceSkill;
    if (!hasOpenDialog) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (selectedSkill) {
          setSelectedSkill(null);
          setGovernancePreviewSkillId(null);
          setGovernancePreviewTitle(null);
          setGovernancePreviewResult(null);
        }
        if (selectedMarketplaceSkill) setSelectedMarketplaceSkill(null);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [selectedSkill, selectedMarketplaceSkill]);

  const filteredSkills = useMemo(() => {
    const query = skillSearchQuery.trim().replace(/\s+/g, ' ').toLowerCase();
    return skills.filter(skill => {
      const matchesSearch = skill.name.toLowerCase().includes(query)
        || skillService.getInstalledSkillDescription(skill).toLowerCase().includes(query);
      return matchesSearch;
    });
  }, [skills, skillSearchQuery]);

  const filteredManagedSkills = useMemo(
    () => filteredSkills.filter((skill) => skill.sourceType === 'qingshu-managed'),
    [filteredSkills],
  );

  const managedAvailableCount = useMemo(
    () => filteredManagedSkills.filter((skill) => !getManagedSkillAccess(skill).isLocked).length,
    [filteredManagedSkills, isLoggedIn],
  );

  const managedLockedCount = useMemo(
    () => filteredManagedSkills.filter((skill) => getManagedSkillAccess(skill).isLocked).length,
    [filteredManagedSkills, isLoggedIn],
  );

  const displayedInstalledSkills = useMemo(() => {
    return filteredSkills.filter((skill) => {
      if (skill.sourceType !== 'qingshu-managed') {
        return true;
      }
      if (managedSkillFilter === 'available') {
        return !getManagedSkillAccess(skill).isLocked;
      }
      if (managedSkillFilter === 'locked') {
        return getManagedSkillAccess(skill).isLocked;
      }
      return true;
    });
  }, [filteredSkills, isLoggedIn, managedSkillFilter]);

  const filteredMarketplaceSkills = useMemo(() => {
    const query = skillSearchQuery.trim().replace(/\s+/g, ' ').toLowerCase();
    let results = marketplaceSkills;
    if (query) {
      results = results.filter(skill => {
        return skill.name.toLowerCase().includes(query)
          || resolveLocalizedText(skill.description).toLowerCase().includes(query);
      });
    }
    if (activeMarketTag !== 'all') {
      results = results.filter(skill => skill.tags?.includes(activeMarketTag));
    }
    return results;
  }, [marketplaceSkills, skillSearchQuery, activeMarketTag]);

  const formatSkillDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const locale = i18nService.getLanguage() === 'zh' ? 'zh-CN' : 'en-US';
    return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date);
  };

  const handleToggleSkill = async (skillId: string) => {
    const targetSkill = skills.find(skill => skill.id === skillId);
    if (!targetSkill) return;
    try {
      const updatedSkills = await skillService.setSkillEnabled(skillId, !targetSkill.enabled);
      dispatch(setSkills(updatedSkills));
      setSkillActionError('');
    } catch (error) {
      setSkillActionError(error instanceof Error ? error.message : i18nService.t('skillUpdateFailed'));
    }
  };

  const managedRefreshRemainingSeconds = Math.max(
    0,
    Math.ceil((managedRefreshCooldownUntil - managedRefreshNow) / 1000),
  );

  const handleRefreshManagedSkills = async () => {
    const now = Date.now();
    const remainingSeconds = Math.max(0, Math.ceil((managedRefreshCooldownUntil - now) / 1000));
    if (isRefreshingManagedSkills) {
      return;
    }
    if (remainingSeconds > 0) {
      setSkillActionError(i18nService.t('managedSkillRefreshThrottled').replace('{seconds}', String(remainingSeconds)));
      return;
    }

    const refreshStartedAt = Date.now();
    setIsRefreshingManagedSkills(true);
    setManagedRefreshNow(refreshStartedAt);
    setManagedRefreshCooldownUntil(refreshStartedAt + MANAGED_SKILL_MANUAL_REFRESH_COOLDOWN_MS);
    setSkillActionError('');
    try {
      await qingshuManagedService.refreshCatalogManual();
    } catch (error) {
      setSkillActionError(error instanceof Error ? error.message : i18nService.t('managedSkillRefreshFailed'));
    } finally {
      setIsRefreshingManagedSkills(false);
    }
  };

  const handleRequestDeleteSkill = (skill: Skill) => {
    if (skill.isBuiltIn) {
      setSkillActionError(i18nService.t('skillBuiltInCannotDelete'));
      return;
    }
    setSkillActionError('');
    setSkillPendingDelete(skill);
  };

  const closeSelectedSkillDetail = () => {
    setSelectedSkill(null);
    setGovernancePreviewSkillId(null);
    setGovernancePreviewTitle(null);
    setGovernancePreviewResult(null);
  };

  const closeGovernancePreview = () => {
    setGovernancePreviewSkillId(null);
    setGovernancePreviewTitle(null);
    setGovernancePreviewResult(null);
  };

  const handleAnalyzeSkillFiles = async (title: string, skillFilePaths: string[]) => {
    const validSkillFilePaths = skillFilePaths
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (validSkillFilePaths.length === 0) {
      return;
    }

    setSkillActionError('');
    const results = await qingshuGovernanceService.analyzeSkillFiles(validSkillFilePaths);
    const firstResult = results[0]?.governance ?? null;
    if (!firstResult) {
      setSkillActionError(i18nService.t('skillGovernancePreviewLoadFailed'));
      return;
    }

    setGovernancePreviewSkillId(null);
    setGovernancePreviewTitle(title);
    setGovernancePreviewResult(firstResult);
    setIsAddSkillMenuOpen(false);
    setIsRemoteImportOpen(false);
  };

  const handleAnalyzeLocalSkillFile = async () => {
    const result = await window.electron.dialog.selectFile({
      title: i18nService.t('skillGovernanceAnalyzeSkillFile'),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (!result.success || !result.path) {
      return;
    }
    await handleAnalyzeSkillFiles(
      i18nService.t('skillGovernancePreviewSourceTitle').replace('{source}', result.path),
      [result.path],
    );
  };

  const handleAnalyzeLocalSkillFolder = async () => {
    const result = await window.electron.dialog.selectDirectory();
    if (!result.success || !result.path) {
      return;
    }
    const normalizedFolderPath = result.path.replace(/[\\/]$/, '');
    const skillFilePath = `${normalizedFolderPath}/SKILL.md`;
    await handleAnalyzeSkillFiles(
      i18nService.t('skillGovernancePreviewSourceTitle').replace('{source}', skillFilePath),
      [skillFilePath],
    );
  };

  const handleCancelDeleteSkill = () => {
    if (isDeletingSkill) return;
    setSkillPendingDelete(null);
  };

  const handleConfirmDeleteSkill = async () => {
    if (!skillPendingDelete || isDeletingSkill) return;
    setIsDeletingSkill(true);
    setSkillActionError('');
    const result = await skillService.deleteSkill(skillPendingDelete.id);
    if (!result.success) {
      setSkillActionError(result.error || i18nService.t('skillDeleteFailed'));
      setIsDeletingSkill(false);
      return;
    }
    if (result.skills) {
      dispatch(setSkills(result.skills));
    }
    setIsDeletingSkill(false);
    setSkillPendingDelete(null);
  };

  const handleAddSkillFromSource = async (source: string, sourceType: DirectImportSource) => {
    const trimmedSource = source.trim();
    if (!trimmedSource) return;
    setIsDownloadingSkill(true);
    setSkillActionError('');
    const result = await skillService.downloadSkill(trimmedSource);
    setIsDownloadingSkill(false);
    console.log('[SkillsManager] downloadSkill result:', JSON.stringify({
      success: result.success,
      error: result.error,
      hasAuditReport: !!result.auditReport,
      pendingInstallId: result.pendingInstallId,
      riskLevel: result.auditReport?.riskLevel,
      findingsCount: result.auditReport?.findings?.length,
    }));
    if (!result.success) {
      setSkillActionError(result.error || i18nService.t('skillDownloadFailed'));
      return;
    }
    // Security audit returned — show report modal
    if (result.auditReport && result.pendingInstallId) {
      setIsRemoteImportOpen(false);
      setSecurityReport(result.auditReport);
      setPendingInstallId(result.pendingInstallId);
      setPendingImportSource(sourceType);
      return;
    }
    if (result.skills) {
      dispatch(setSkills(result.skills));
    }
    showToast(i18nService.t('skillImportSuccess'));
    setSkillDownloadSource('');
    setIsAddSkillMenuOpen(false);
    setIsRemoteImportOpen(false);
  };

  const handleUploadSkillZip = async () => {
    if (isDownloadingSkill) return;
    const result = await window.electron.dialog.selectFile({
      title: i18nService.t('uploadSkillZip'),
      filters: [{ name: 'Zip', extensions: ['zip'] }],
    });
    if (result.success && result.path) {
      await handleAddSkillFromSource(result.path, 'zip');
    }
  };

  const handleUploadSkillFolder = async () => {
    if (isDownloadingSkill) return;
    const result = await window.electron.dialog.selectDirectory();
    if (result.success && result.path) {
      await handleAddSkillFromSource(result.path, 'folder');
    }
  };

  const handleOpenRemoteImport = () => {
    setIsAddSkillMenuOpen(false);
    setSkillActionError('');
    setSkillDownloadSource('');
    setImportTab(SkillImportSourceType.GitHub);
    setIsRemoteImportOpen(true);
  };

  const handleCreateByChat = () => {
    setIsAddSkillMenuOpen(false);
    const skillCreator = skills.find((skill) => skill.id === 'skill-creator');

    if (!skillCreator) {
      setActiveTab('marketplace');
      setSkillSearchQuery('skill-creator');
      window.dispatchEvent(new CustomEvent('app:showToast', {
        detail: i18nService.t('skillCreatorNotInstalled'),
      }));
      return;
    }

    if (!skillCreator.enabled) {
      setActiveTab('installed');
      setSkillSearchQuery('skill-creator');
      window.dispatchEvent(new CustomEvent('app:showToast', {
        detail: i18nService.t('skillCreatorNotEnabled'),
      }));
      return;
    }

    onCreateByChat?.();
  };

  const handleImportFromDialog = async () => {
    if (isDownloadingSkill) return;
    const validationError = validateSkillImportSource(skillDownloadSource, importTab);
    if (validationError) {
      setSkillActionError(i18nService.t(validationError));
      return;
    }
    await handleAddSkillFromSource(skillDownloadSource, 'remote');
  };

  const getSkillInstallStatus = (marketplaceSkill: MarketplaceSkill): 'not_installed' | 'installed' | 'update_available' => {
    const installed = skills.find(s => s.id === marketplaceSkill.id);
    if (!installed) return 'not_installed';
    if (!marketplaceSkill.version) return 'installed';
    const localVersion = installed.version || '0.0.0';
    if (compareVersions(marketplaceSkill.version, localVersion) > 0) return 'update_available';
    return 'installed';
  };

  const updatableSkills = useMemo(() => {
    return marketplaceSkills.filter(ms => {
      const installed = skills.find(s => s.id === ms.id);
      if (!installed || !ms.version) return false;
      const localVersion = installed.version || '0.0.0';
      return compareVersions(ms.version, localVersion) > 0;
    });
  }, [skills, marketplaceSkills]);

  const getInstalledVersion = (skillId: string): string | undefined => {
    return skills.find(s => s.id === skillId)?.version;
  };

  const handleUpgradeSkill = async (skill: MarketplaceSkill) => {
    if (upgradeState?.isActive || !skill.url) return;
    setSkillActionError('');
    setUpgradeState({
      isActive: true,
      total: 1,
      current: 1,
      currentSkillName: skill.name,
      currentSkillVersion: skill.version,
    });
    try {
      const result = await skillService.upgradeSkill(skill.id, skill.url);
      if (!result.success) {
        setSkillActionError(result.error || i18nService.t('skillUpgradeFailed'));
        setUpgradeState(null);
        return;
      }
      if (result.auditReport && result.pendingInstallId) {
        setUpgradeState(null);
        setSecurityReport(result.auditReport);
        setPendingInstallId(result.pendingInstallId);
        return;
      }
      if (result.skills) {
        dispatch(setSkills(result.skills));
      }
    } catch {
      setSkillActionError(i18nService.t('skillUpgradeFailed'));
    } finally {
      setUpgradeState(null);
    }
  };

  const handleUpgradeAll = async () => {
    if (upgradeState?.isActive || updatableSkills.length === 0) return;
    setSkillActionError('');
    upgradeCancelledRef.current = false;

    const toUpdate = [...updatableSkills];
    setUpgradeState({
      isActive: true,
      total: toUpdate.length,
      current: 0,
      currentSkillName: '',
      currentSkillVersion: '',
    });

    for (let i = 0; i < toUpdate.length; i++) {
      if (upgradeCancelledRef.current) break;
      const skill = toUpdate[i];
      setUpgradeState({
        isActive: true,
        total: toUpdate.length,
        current: i + 1,
        currentSkillName: skill.name,
        currentSkillVersion: skill.version,
      });

      try {
        const result = await skillService.upgradeSkill(skill.id, skill.url);
        if (!result.success) {
          console.warn('[SkillsManager] upgrade failed for', skill.id, result.error);
          continue;
        }
        if (result.auditReport && result.pendingInstallId) {
          setUpgradeState(null);
          setSecurityReport(result.auditReport);
          setPendingInstallId(result.pendingInstallId);
          return;
        }
        if (result.skills) {
          dispatch(setSkills(result.skills));
        }
      } catch (error) {
        console.warn('[SkillsManager] upgrade threw for', skill.id, error);
      }
    }

    setUpgradeState(null);
  };

  const handleInstallMarketplaceSkill = async (skill: MarketplaceSkill) => {
    if (installingSkillId || !skill.url) return;
    setInstallingSkillId(skill.id);
    setSkillActionError('');
    try {
      const result = await skillService.downloadSkill(skill.url);
      if (!result.success) {
        setSkillActionError(result.error || i18nService.t('skillInstallFailed'));
        return;
      }
      // Security audit returned — show report modal
      if (result.auditReport && result.pendingInstallId) {
        setSecurityReport(result.auditReport);
        setPendingInstallId(result.pendingInstallId);
        return;
      }
      if (result.skills) {
        dispatch(setSkills(result.skills));
      }
    } catch {
      setSkillActionError(i18nService.t('skillInstallFailed'));
    } finally {
      setInstallingSkillId(null);
    }
  };

  const handleSecurityReportAction = async (action: 'install' | 'installDisabled' | 'cancel') => {
    if (!pendingInstallId) return;
    setIsConfirmingInstall(true);
    try {
      const result = await skillService.confirmInstall(pendingInstallId, action);
      if (result.success && result.skills) {
        dispatch(setSkills(result.skills));
        if (action !== 'cancel' && pendingImportSource) {
          showToast(i18nService.t('skillImportSuccess'));
        }
      }
      if (!result.success && result.error) {
        setSkillActionError(result.error);
      }
    } catch {
      setSkillActionError(i18nService.t('skillInstallFailed'));
    } finally {
      setSecurityReport(null);
      setPendingInstallId(null);
      setPendingImportSource(null);
      setIsConfirmingInstall(false);
      setInstallingSkillId(null);
      setSkillDownloadSource('');
      setIsAddSkillMenuOpen(false);
      setIsRemoteImportOpen(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-secondary">
          {i18nService.t('skillsDescription')}
        </p>
      </div>

      {skillActionError && !isRemoteImportOpen && (
        <ErrorMessage
          message={skillActionError}
          onClose={() => setSkillActionError('')}
        />
      )}

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary" />
          <input
            type="text"
            placeholder={i18nService.t('searchSkills')}
            value={skillSearchQuery}
            onChange={(e) => setSkillSearchQuery(e.target.value)}
            className="w-full pl-9 pr-8 py-2 text-sm rounded-xl bg-surface text-foreground placeholder-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {skillSearchQuery && (
            <button
              type="button"
              onClick={() => setSkillSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-secondary hover:text-primary transition-colors"
            >
              <XCircleIconSolid className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="relative">
          <button
            ref={addSkillButtonRef}
            type="button"
            onClick={() => setIsAddSkillMenuOpen(prev => !prev)}
            disabled={readOnly}
            className="px-3 py-2 text-sm rounded-xl border transition-colors bg-surface border-border text-foreground hover:bg-surface-raised flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <PlusCircleIcon className="h-4 w-4" />
            <span>{i18nService.t('addSkill')}</span>
          </button>

          {isAddSkillMenuOpen && (
            <div
              ref={addSkillMenuRef}
              className="absolute right-0 mt-2 w-72 rounded-xl border border-border bg-surface shadow-lg z-50 overflow-hidden"
            >
              <p className="px-3 py-2 text-[11px] text-orange-600 dark:text-orange-400 border-b border-border">
                {i18nService.t('addSkillSecurityTip')}
              </p>
              <button
                type="button"
                onClick={handleUploadSkillZip}
                disabled={isDownloadingSkill}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-foreground hover:bg-surface-raised transition-colors disabled:opacity-50"
              >
                <UploadIcon className="h-4 w-4 text-secondary" />
                <span>{i18nService.t('uploadSkillZip')}</span>
              </button>
              <button
                type="button"
                onClick={handleUploadSkillFolder}
                disabled={isDownloadingSkill}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-foreground hover:bg-surface-raised transition-colors disabled:opacity-50"
              >
                <FolderOpenIcon className="h-4 w-4 text-secondary" />
                <span>{i18nService.t('uploadSkillFolder')}</span>
              </button>
              <button
                type="button"
                onClick={handleOpenRemoteImport}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-foreground hover:bg-surface-raised transition-colors"
              >
                <LinkIcon className="h-4 w-4 text-secondary" />
                <span>{i18nService.t('remoteImport')}</span>
              </button>
              <button
                type="button"
                onClick={handleCreateByChat}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-foreground hover:bg-surface-raised transition-colors"
              >
                <PencilSquareIcon className="h-4 w-4 text-secondary" />
                <span>{i18nService.t('createSkillByChat')}</span>
              </button>
              {showGovernanceDebug ? (
                <>
                  <div className="border-t border-border" />
                  <button
                    type="button"
                    onClick={handleAnalyzeLocalSkillFile}
                    disabled={isDownloadingSkill}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-foreground hover:bg-surface-raised transition-colors disabled:opacity-50"
                  >
                    <UploadIcon className="h-4 w-4 text-secondary" />
                    <span>{i18nService.t('skillGovernanceAnalyzeSkillFile')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleAnalyzeLocalSkillFolder}
                    disabled={isDownloadingSkill}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-foreground hover:bg-surface-raised transition-colors disabled:opacity-50"
                  >
                    <FolderOpenIcon className="h-4 w-4 text-secondary" />
                    <span>{i18nService.t('skillGovernanceAnalyzeSkillFolder')}</span>
                  </button>
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center border-b border-border">
        <button
          type="button"
          onClick={() => setActiveTab('installed')}
          className={`px-4 py-2 text-sm font-medium transition-colors relative ${
            activeTab === 'installed'
              ? 'text-foreground'
              : 'text-secondary hover:hover:text-foreground'
          }`}
        >
          {i18nService.t('skillInstalled')}
          {skills.length > 0 && (
            <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-surface-raised">
              {skills.length}
            </span>
          )}
          <div className={`absolute bottom-0 left-0 right-0 h-0.5 rounded-full transition-colors ${
            activeTab === 'installed' ? 'bg-primary' : 'bg-transparent'
          }`} />
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('marketplace')}
          className={`px-4 py-2 text-sm font-medium transition-colors relative ${
            activeTab === 'marketplace'
              ? 'text-foreground'
              : 'text-secondary hover:hover:text-foreground'
          }`}
        >
          {i18nService.t('skillMarketplace')}
          <div className={`absolute bottom-0 left-0 right-0 h-0.5 rounded-full transition-colors ${
            activeTab === 'marketplace' ? 'bg-primary' : 'bg-transparent'
          }`} />
        </button>
        <div className="ml-auto flex items-center gap-2 pr-1 pb-1">
          <button
            type="button"
            onClick={handleRefreshManagedSkills}
            disabled={!isLoggedIn || isRefreshingManagedSkills || managedRefreshRemainingSeconds > 0}
            title={
              !isLoggedIn
                ? i18nService.t('managedSkillRefreshLoginRequired')
                : managedRefreshRemainingSeconds > 0
                  ? i18nService.t('managedSkillRefreshCooldown').replace('{seconds}', String(managedRefreshRemainingSeconds))
                  : i18nService.t('managedSkillRefreshHint')
            }
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border border-sky-500/30 bg-sky-500/10 text-sky-700 hover:bg-sky-500/20 dark:text-sky-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ArrowPathIcon className={`h-3 w-3 ${isRefreshingManagedSkills ? 'animate-spin' : ''}`} />
            {isRefreshingManagedSkills
              ? i18nService.t('managedSkillRefreshing')
              : managedRefreshRemainingSeconds > 0
                ? i18nService.t('managedSkillRefreshCooldownShort').replace('{seconds}', String(managedRefreshRemainingSeconds))
                : i18nService.t('managedSkillRefresh')}
          </button>
          {updatableSkills.length > 0 && (
            <button
              type="button"
              onClick={handleUpgradeAll}
              disabled={upgradeState?.isActive === true}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ArrowPathIcon className="h-3 w-3" />
              {i18nService.t('skillUpgradeAll').replace('{count}', String(updatableSkills.length))}
            </button>
          )}
        </div>
      </div>

      {activeTab === 'installed' && (
      <>
      {workspaceTemporarySkills.length > 0 && (
        <details className="group mb-3 rounded-xl border border-amber-500/20 bg-amber-500/10">
          <summary className="list-none cursor-pointer px-3 py-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300">
                <FolderOpenIcon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-medium text-foreground">
                        {i18nService.t('workspaceTemporarySkillsTitle')}
                      </div>
                      <span className="rounded-full border border-amber-500/20 bg-background/80 px-2 py-1 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                        {i18nService.t('workspaceTemporarySkillsTag')}
                      </span>
                      <span className="rounded-full border border-amber-500/20 bg-background/80 px-2 py-1 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                        {i18nService.t('workspaceTemporarySkillsCount').replace('{count}', String(workspaceTemporarySkills.length))}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-secondary">
                      {i18nService.t('workspaceTemporarySkillsCollapsedHint')}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                    <span>{i18nService.t('workspaceTemporarySkillsExpandAction')}</span>
                    <ChevronRightIcon className="h-4 w-4 transition-transform group-open:rotate-90" />
                  </div>
                </div>
              </div>
            </div>
          </summary>
          <div className="border-t border-amber-500/15 px-3 pb-3">
            <p className="pt-3 text-xs leading-5 text-secondary">
              {i18nService.t('workspaceTemporarySkillsDescription')}
            </p>
            <div className="mt-3 space-y-2">
              {workspaceTemporarySkills.map((install) => (
                <div
                  key={`${install.agentId}:${install.workspacePath}`}
                  className="rounded-lg border border-amber-500/15 bg-background/70 px-3 py-2"
                >
                  <div className="text-xs font-medium text-foreground">
                    {i18nService.t('workspaceTemporarySkillsAgent').replace('{name}', install.agentName)}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {install.skillIds.map((skillId) => (
                      <span
                        key={`${install.agentId}:${skillId}`}
                        className="rounded-full border border-border bg-surface-raised px-2 py-1 text-[10px] font-medium text-secondary"
                      >
                        {skillId}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 break-all text-[11px] leading-5 text-secondary/80">
                    {i18nService.t('workspaceTemporarySkillsPath').replace('{path}', install.workspacePath)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </details>
      )}
      {filteredManagedSkills.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-raised/60 px-3 py-2">
          <div className="flex items-center gap-2 text-[11px] text-secondary">
            <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 font-medium text-emerald-700 dark:text-emerald-300">
              {i18nService.t('managedAvailableSection')} {managedAvailableCount}
            </span>
            <span className="rounded-full border border-border bg-muted/40 px-2 py-1 font-medium">
              {i18nService.t('managedLockedSection')} {managedLockedCount}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {([
              ['all', i18nService.t('managedFilterAll')],
              ['available', i18nService.t('managedFilterAvailable')],
              ['locked', i18nService.t('managedFilterLocked')],
            ] as Array<[ManagedSkillFilter, string]>).map(([filterValue, label]) => (
              <button
                key={filterValue}
                type="button"
                onClick={() => setManagedSkillFilter(filterValue)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  managedSkillFilter === filterValue
                    ? 'bg-primary text-white'
                    : 'border border-border bg-background text-secondary hover:bg-surface'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {displayedInstalledSkills.length === 0 ? (
          <div className="col-span-2 text-center py-8 text-sm text-secondary">
            {i18nService.t('noSkillsAvailable')}
          </div>
        ) : (
          displayedInstalledSkills.map((skill) => (
            (() => {
              const skillReadOnly = readOnly || skill.readOnly;
              const skillLocked = getManagedSkillAccess(skill).isLocked;
              const skillToggleDisabled = skillReadOnly || skillLocked;
              const managedLockTag = getManagedSkillLockTag(skill);
              const managedLockHint = getManagedSkillLockHint(skill);
              return (
            <div
              key={skill.id}
              className={`rounded-xl border p-3 transition-colors cursor-pointer ${
                skillLocked
                  ? 'border-border/70 bg-muted/30 saturate-0 opacity-85'
                  : 'border-border bg-surface hover:border-primary'
              }`}
              onClick={() => setSelectedSkill(skill)}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-surface flex items-center justify-center flex-shrink-0">
                    <PuzzleIcon className="h-4 w-4 text-secondary" />
                  </div>
                  <span className="text-sm font-medium text-foreground truncate">
                    {skill.name}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {managedLockTag && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background/80 px-2 py-1 text-[10px] font-medium text-secondary shadow-sm">
                      <LockClosedIcon className="h-3 w-3" />
                      {managedLockTag}
                    </span>
                  )}
                  {!skillReadOnly && !skill.isBuiltIn && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleRequestDeleteSkill(skill); }}
                      className="p-1 rounded-lg text-secondary hover:text-red-500 dark:hover:text-red-400 transition-colors"
                      title={i18nService.t('deleteSkill')}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  )}
                  <div
                    className={`w-9 h-5 rounded-full flex items-center transition-colors flex-shrink-0 ${
                      skillToggleDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                    } ${
                      skill.enabled ? 'bg-primary' : 'bg-border'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (skillToggleDisabled) {
                        if (skillLocked) {
                          void handleToggleSkill(skill.id);
                        }
                        return;
                      }
                      void handleToggleSkill(skill.id);
                    }}
                  >
                    <div
                      className={`w-3.5 h-3.5 rounded-full bg-white shadow-md transform transition-transform ${
                        skill.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                      }`}
                    />
                  </div>
                </div>
              </div>

              <p className="text-xs text-secondary line-clamp-2 mb-2">
                {skillService.getInstalledSkillDescription(skill)}
              </p>

              {managedLockHint && (
                <div className="mb-2 rounded-lg border border-border bg-background/70 px-2 py-1.5 text-[11px] leading-4 text-secondary">
                  {managedLockHint}
                </div>
              )}

              <div className="flex items-center justify-between text-[10px] text-secondary">
                <div className="flex items-center gap-2">
                <span className="px-1.5 py-0.5 rounded bg-surface-raised font-medium">
                  {getSourceLabel(skill.sourceType)}
                </span>
                <span>·</span>
                {skill.isOfficial && (
                  <>
                    <span className="px-1.5 py-0.5 rounded bg-primary-muted text-primary font-medium">
                      {i18nService.t('official')}
                    </span>
                    <span>·</span>
                  </>
                )}
                {skill.version && (
                  <>
                    <span className="px-1.5 py-0.5 rounded bg-surface-raised font-medium">
                      v{skill.version}
                    </span>
                    <span>·</span>
                  </>
                )}
                {skillReadOnly && (
                  <>
                    <span className="px-1.5 py-0.5 rounded bg-surface-raised font-medium">
                      {i18nService.t('readOnlyTag')}
                    </span>
                    <span>·</span>
                  </>
                )}
                {managedLockTag && (
                  <>
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 font-medium">
                      {managedLockTag}
                    </span>
                    <span>·</span>
                  </>
                )}
                <span>{formatSkillDate(skill.updatedAt)}</span>
                </div>
                {(() => {
                  const mp = marketplaceSkills.find(m => m.id === skill.id);
                  if (!skillReadOnly && mp && mp.version && compareVersions(mp.version, skill.version || '0.0.0') > 0) {
                    return (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleUpgradeSkill(mp); }}
                        disabled={upgradeState?.isActive === true}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <ArrowPathIcon className="h-3.5 w-3.5" />
                        {i18nService.t('skillUpgrade')}
                      </button>
                    );
                  }
                  return null;
                })()}
              </div>
            </div>
              );
            })()
          ))
        )}
      </div>
      </>
      )}

      {activeTab === 'marketplace' && (
        isLoadingMarketplace ? (
          <div className="text-center py-12 text-sm text-secondary">
            {i18nService.t('downloadingSkill')}
          </div>
        ) : (
          <>
            {marketTags.length > 0 && (
              <div className="sticky top-0 z-10 bg-background -mx-4 px-4 py-3 flex items-center gap-1.5 flex-wrap border-b border-border mb-4">
                <button
                  type="button"
                  onClick={() => setActiveMarketTag('all')}
                  className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                    activeMarketTag === 'all'
                      ? 'bg-primary text-white'
                      : 'bg-surface text-secondary hover:bg-surface-raised border border-border'
                  }`}
                >
                  {i18nService.t('skillCategoryAll')}
                </button>
                {marketTags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => setActiveMarketTag(tag.id)}
                    className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                      activeMarketTag === tag.id
                        ? 'bg-primary text-white'
                        : 'bg-surface text-secondary hover:bg-surface-raised border border-border'
                    }`}
                  >
                    {resolveLocalizedText(tag)}
                  </button>
                ))}
              </div>
            )}
            {filteredMarketplaceSkills.length === 0 ? (
              <div className="text-center py-12 text-sm text-secondary">
                {i18nService.t('skillMarketplaceEmpty')}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {filteredMarketplaceSkills.map((skill) => (
              <div
                key={skill.id}
                className="rounded-xl border border-border bg-surface p-3 transition-colors hover:border-primary cursor-pointer"
                onClick={() => setSelectedMarketplaceSkill(skill)}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-surface flex items-center justify-center flex-shrink-0">
                      <PuzzleIcon className="h-4 w-4 text-secondary" />
                    </div>
                    <span className="text-sm font-medium text-foreground truncate">
                      {skill.name}
                    </span>
                  </div>
                  <div className="flex-shrink-0">
                    {(() => {
                      const status = getSkillInstallStatus(skill);
                      if (status === 'update_available') {
                        return (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleUpgradeSkill(skill); }}
                            disabled={upgradeState?.isActive === true}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <ArrowPathIcon className="h-3.5 w-3.5" />
                            {i18nService.t('skillUpgrade')}
                          </button>
                        );
                      }
                      if (status === 'installed') {
                        return (
                          <span className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-lg text-green-600 dark:text-green-400 bg-green-500/10">
                            <CheckCircleIcon className="h-3.5 w-3.5" />
                            {i18nService.t('skillAlreadyInstalled')}
                          </span>
                        );
                      }
                      return !readOnly ? (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleInstallMarketplaceSkill(skill); }}
                          disabled={installingSkillId !== null}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-lg bg-primary text-white hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <ArrowDownTrayIcon className="h-3.5 w-3.5" />
                          {installingSkillId === skill.id ? i18nService.t('skillInstalling') : i18nService.t('skillInstall')}
                        </button>
                      ) : null;
                    })()}
                  </div>
                </div>

                <p className="text-xs text-secondary line-clamp-2 mb-2">
                  {resolveLocalizedText(skill.description)}
                </p>

                <div className="flex items-center gap-2 text-[10px] text-secondary">
                  {skill.source?.from && (
                    <>
                      <span className="px-1.5 py-0.5 rounded bg-surface-raised font-medium">
                        {skill.source.from}
                      </span>
                      <span>·</span>
                    </>
                  )}
                  {skill.version && (
                    <>
                      {(() => {
                        const installedVer = getInstalledVersion(skill.id);
                        if (installedVer && compareVersions(skill.version, installedVer) > 0) {
                          return (
                            <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium">
                              v{installedVer} → v{skill.version}
                            </span>
                          );
                        }
                        return (
                          <span className="px-1.5 py-0.5 rounded bg-surface-raised font-medium">
                            v{skill.version}
                          </span>
                        );
                      })()}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
            )}
          </>
        )
      )}

      {selectedMarketplaceSkill && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setSelectedMarketplaceSkill(null)}
        >
          <div
            className="w-full max-w-md mx-4 rounded-2xl bg-surface border border-border shadow-2xl p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-background flex items-center justify-center flex-shrink-0">
                  <PuzzleIcon className="h-5 w-5 text-secondary" />
                </div>
                <div className="min-w-0">
                  <div className="text-base font-semibold text-foreground truncate">
                    {selectedMarketplaceSkill.name}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedMarketplaceSkill(null)}
                className="p-1.5 rounded-lg text-secondary hover:text-foreground hover:bg-surface-raised transition-colors flex-shrink-0"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <p className="text-sm text-secondary mb-4">
              {resolveLocalizedText(selectedMarketplaceSkill.description)}
            </p>

            <div className="space-y-2 mb-5">
              {selectedMarketplaceSkill.version && (
                <div className="flex items-center text-xs">
                  <span className="w-16 flex-shrink-0 text-secondary">{i18nService.t('skillDetailVersion')}</span>
                  <span className="px-1.5 py-0.5 rounded bg-surface-raised text-foreground font-medium">
                    v{selectedMarketplaceSkill.version}
                  </span>
                </div>
              )}
              {selectedMarketplaceSkill.source?.from && (
                <div className="flex items-center text-xs">
                  <span className="w-16 flex-shrink-0 text-secondary">{i18nService.t('skillDetailSource')}</span>
                  <span className="px-1.5 py-0.5 rounded bg-surface-raised text-foreground font-medium">
                    {selectedMarketplaceSkill.source.from}
                  </span>
                  {selectedMarketplaceSkill.source.author && (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded bg-surface-raised text-foreground font-medium">
                      {selectedMarketplaceSkill.source.author}
                    </span>
                  )}
                </div>
              )}
              {selectedMarketplaceSkill.source?.url && (
                <div className="flex items-start text-xs">
                  <span className="w-16 flex-shrink-0 text-secondary pt-0.5">URL</span>
                  <button
                    type="button"
                    className="text-primary hover:underline break-all text-left"
                    onClick={(e) => { e.stopPropagation(); window.electron.shell.openExternal(selectedMarketplaceSkill.source.url); }}
                  >
                    {selectedMarketplaceSkill.source.url}
                  </button>
                </div>
              )}
            </div>

            {(() => {
              const status = getSkillInstallStatus(selectedMarketplaceSkill);
              if (status === 'update_available') {
                const installedVer = getInstalledVersion(selectedMarketplaceSkill.id);
                return (
                  <button
                    type="button"
                    onClick={() => handleUpgradeSkill(selectedMarketplaceSkill)}
                    disabled={upgradeState?.isActive === true}
                    className="w-full py-2.5 rounded-xl bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                  >
                    <ArrowPathIcon className="h-4 w-4" />
                    {i18nService.t('skillUpgrade')} v{installedVer} → v{selectedMarketplaceSkill.version}
                  </button>
                );
              }
              if (status === 'installed') {
                return (
                  <div className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-green-500/10 text-green-600 dark:text-green-400 text-sm font-medium">
                    <CheckCircleIcon className="h-4 w-4" />
                    {i18nService.t('skillAlreadyInstalled')}
                  </div>
                );
              }
              return !readOnly ? (
                <button
                  type="button"
                  onClick={() => handleInstallMarketplaceSkill(selectedMarketplaceSkill)}
                  disabled={installingSkillId !== null}
                  className="w-full py-2.5 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                >
                  <ArrowDownTrayIcon className="h-4 w-4" />
                  {installingSkillId === selectedMarketplaceSkill.id ? i18nService.t('skillInstalling') : i18nService.t('skillInstall')}
                </button>
              ) : null;
            })()}
          </div>
        </div>
      , document.body)}

      {selectedSkill && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={closeSelectedSkillDetail}
        >
          <div
            className="w-full max-w-md mx-4 rounded-2xl bg-surface border border-border shadow-2xl p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-background flex items-center justify-center flex-shrink-0">
                  <PuzzleIcon className="h-5 w-5 text-secondary" />
                </div>
                <div className="min-w-0">
                  <div className="text-base font-semibold text-foreground truncate">
                    {selectedSkill.name}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={closeSelectedSkillDetail}
                className="p-1.5 rounded-lg text-secondary hover:text-foreground hover:bg-surface-raised transition-colors flex-shrink-0"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <p className="text-sm text-secondary mb-4">
              {skillService.getInstalledSkillDescription(selectedSkill)}
            </p>
            {getManagedSkillLockHint(selectedSkill) && (
              <div className="mb-4 rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-xs text-secondary">
                <div className="inline-flex items-center gap-1 rounded-full border border-border bg-background/80 px-2 py-1 text-[10px] font-medium text-secondary">
                  <LockClosedIcon className="h-3 w-3" />
                  {getManagedSkillLockTag(selectedSkill)}
                </div>
                <div className="mt-2 leading-5">
                  {getManagedSkillLockHint(selectedSkill)}
                </div>
              </div>
            )}

            <div className="space-y-2 mb-5">
              {(() => {
                const mp = marketplaceSkills.find(m => m.id === selectedSkill.id);
                return (
                  <>
                    {selectedSkill.isOfficial && (
                      <div className="flex items-center text-xs">
                        <span className="w-16 flex-shrink-0 text-secondary">{i18nService.t('skillDetailSource')}</span>
                        <span className="px-1.5 py-0.5 rounded bg-primary-muted text-primary font-medium">
                          {i18nService.t('official')}
                        </span>
                        {mp?.source?.author && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded bg-surface-raised text-foreground font-medium">
                            {mp.source.author}
                          </span>
                        )}
                      </div>
                    )}
                    {!selectedSkill.isOfficial && mp?.source?.from && (
                      <div className="flex items-center text-xs">
                        <span className="w-16 flex-shrink-0 text-secondary">{i18nService.t('skillDetailSource')}</span>
                        <span className="px-1.5 py-0.5 rounded bg-surface-raised text-foreground font-medium">
                          {mp.source.from}
                        </span>
                        {mp.source.author && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded bg-surface-raised text-foreground font-medium">
                            {mp.source.author}
                          </span>
                        )}
                      </div>
                    )}
                    {!mp?.source?.from && (
                      <div className="flex items-center text-xs">
                        <span className="w-16 flex-shrink-0 text-secondary">{i18nService.t('skillDetailSource')}</span>
                        <span className="px-1.5 py-0.5 rounded bg-surface-raised text-foreground font-medium">
                          {getSourceLabel(selectedSkill.sourceType)}
                        </span>
                      </div>
                    )}
                    {mp?.source?.url && (
                      <div className="flex items-start text-xs">
                        <span className="w-16 flex-shrink-0 text-secondary pt-0.5">URL</span>
                        <button
                          type="button"
                          className="text-primary hover:underline break-all text-left"
                          onClick={(e) => { e.stopPropagation(); window.electron.shell.openExternal(mp.source.url); }}
                        >
                          {mp.source.url}
                        </button>
                      </div>
                    )}
                    {selectedSkill.policyNote && (
                      <div className="flex items-start text-xs">
                        <span className="w-16 flex-shrink-0 text-secondary pt-0.5">{i18nService.t('skillDetailPolicy')}</span>
                        <span className="text-foreground">{selectedSkill.policyNote}</span>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {!(readOnly || selectedSkill.readOnly) && !selectedSkill.isBuiltIn ? (
                  <button
                    type="button"
                    onClick={() => { closeSelectedSkillDetail(); handleRequestDeleteSkill(selectedSkill); }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl text-red-500 dark:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <TrashIcon className="h-4 w-4" />
                    {i18nService.t('deleteSkill')}
                  </button>
                ) : null}
                {showGovernanceDebug ? (
                  <button
                    type="button"
                    onClick={() => {
                      setGovernancePreviewResult(null);
                      setGovernancePreviewTitle(null);
                      setGovernancePreviewSkillId(selectedSkill.id);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl border border-border text-secondary hover:border-primary/30 hover:text-foreground hover:bg-surface-raised transition-colors"
                  >
                    {i18nService.t('skillGovernancePreviewAction')}
                  </button>
                ) : null}
              </div>
              <div
                className={`w-9 h-5 rounded-full flex items-center transition-colors flex-shrink-0 ${
                  (readOnly || selectedSkill.readOnly || getManagedSkillAccess(selectedSkill).isLocked)
                    ? 'opacity-50 cursor-not-allowed'
                    : 'cursor-pointer'
                } ${
                  selectedSkill.enabled ? 'bg-primary' : 'bg-border'
                }`}
                onClick={() => {
                  if (readOnly || selectedSkill.readOnly) return;
                  if (getManagedSkillAccess(selectedSkill).isLocked) {
                    void handleToggleSkill(selectedSkill.id);
                    return;
                  }
                  void handleToggleSkill(selectedSkill.id);
                  setSelectedSkill({ ...selectedSkill, enabled: !selectedSkill.enabled });
                }}
              >
                <div
                  className={`w-3.5 h-3.5 rounded-full bg-white shadow-md transform transition-transform ${
                    selectedSkill.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                  }`}
                />
              </div>
            </div>
          </div>
        </div>
      , document.body)}

      {showGovernanceDebug && governancePreviewSkillId ? (
        <QingShuGovernancePreview
          skillId={governancePreviewSkillId}
          onClose={closeGovernancePreview}
        />
      ) : null}

      {showGovernanceDebug && governancePreviewResult ? (
        <QingShuGovernancePreview
          governance={governancePreviewResult}
          title={governancePreviewTitle || i18nService.t('skillGovernancePreviewEyebrow')}
          onClose={closeGovernancePreview}
        />
      ) : null}

      {skillPendingDelete && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={handleCancelDeleteSkill}
        >
          <div
            className="w-full max-w-sm mx-4 rounded-2xl bg-surface border border-border shadow-2xl p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="text-lg font-semibold text-foreground">
              {i18nService.t('deleteSkill')}
            </div>
            <p className="mt-2 text-sm text-secondary">
              {i18nService.t('skillDeleteConfirm').replace('{name}', skillPendingDelete.name)}
            </p>
            {skillActionError && (
              <div className="mt-3 text-xs text-red-500">
                {skillActionError}
              </div>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleCancelDeleteSkill}
                disabled={isDeletingSkill}
                className="px-3 py-1.5 text-xs rounded-lg border border-border text-secondary hover:bg-surface-raised transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {i18nService.t('cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteSkill}
                disabled={isDeletingSkill}
                className="px-3 py-1.5 text-xs rounded-lg bg-red-500 text-white hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-400 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {i18nService.t('confirmDelete')}
              </button>
            </div>
          </div>
        </div>
      , document.body)}

      {isRemoteImportOpen && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => {
            setIsRemoteImportOpen(false);
            setSkillActionError('');
          }}
        >
          <div
            className="w-full max-w-md mx-4 rounded-2xl bg-surface border border-border shadow-2xl p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="text-lg font-semibold text-foreground">
                  {i18nService.t('remoteImportTitle')}
                </div>
                <p className="mt-1 text-sm text-secondary">
                  {i18nService.t(importTabConfig[importTab].descriptionKey)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsRemoteImportOpen(false);
                  setSkillActionError('');
                }}
                className="p-1.5 rounded-lg text-secondary hover:text-foreground hover:bg-surface-raised transition-colors"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 flex items-center gap-1 border-b border-border">
              {importSourceTypes.map((sourceType) => (
                <button
                  key={sourceType}
                  type="button"
                  onClick={() => {
                    setImportTab(sourceType);
                    setSkillDownloadSource('');
                    setSkillActionError('');
                  }}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors relative ${
                    importTab === sourceType
                      ? 'text-foreground'
                      : 'text-secondary hover:text-foreground'
                  }`}
                >
                  {i18nService.t(importTabConfig[sourceType].tabLabelKey)}
                  {importTab === sourceType ? (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
                  ) : null}
                </button>
              ))}
            </div>

            <div className="mt-5 space-y-3">
              <div className="text-xs font-semibold tracking-wide text-secondary">
                {i18nService.t(importTabConfig[importTab].urlLabelKey)}
              </div>
              <input
                ref={importInputRef}
                type="text"
                value={skillDownloadSource}
                onChange={(e) => setSkillDownloadSource(e.target.value)}
                placeholder={i18nService.t(importTabConfig[importTab].placeholderKey)}
                className="w-full px-3 py-2.5 text-sm rounded-xl bg-background text-foreground placeholder-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-xs text-secondary">
                {i18nService.t(importTabConfig[importTab].examplesKey)}
              </p>
              {skillActionError && (
                <div className="text-xs text-red-500">
                  {skillActionError}
                </div>
              )}
              <button
                type="button"
                onClick={handleImportFromDialog}
                disabled={isDownloadingSkill || !skillDownloadSource.trim()}
                className="w-full py-2.5 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
              >
                {isDownloadingSkill ? i18nService.t('importingSkill') : i18nService.t('importSkill')}
              </button>
            </div>
          </div>
        </div>
      , document.body)}

      {securityReport && (
        <SkillSecurityReport
          report={securityReport}
          onAction={handleSecurityReportAction}
          isLoading={isConfirmingInstall}
        />
      )}

      {upgradeState?.isActive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-sm mx-4 rounded-2xl dark:bg-claude-darkSurface bg-claude-surface border dark:border-claude-darkBorder border-claude-border shadow-2xl p-6">
            <div className="text-center">
              <div className="text-sm font-medium dark:text-claude-darkText text-claude-text mb-4">
                {i18nService.t('skillUpgrading')
                  .replace('{current}', String(upgradeState.current))
                  .replace('{total}', String(upgradeState.total))}
              </div>

              <div className="w-full h-2 rounded-full dark:bg-claude-darkBorder bg-claude-border mb-3">
                <div
                  className="h-full rounded-full bg-amber-500 transition-all duration-300"
                  style={{ width: `${(upgradeState.current / upgradeState.total) * 100}%` }}
                />
              </div>

              <div className="text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary mb-4">
                {i18nService.t('skillUpgradingCurrent')
                  .replace('{name}', upgradeState.currentSkillName)
                  .replace('{version}', upgradeState.currentSkillVersion)}
              </div>

              {upgradeState.total > 1 && (
                <button
                  type="button"
                  onClick={() => { upgradeCancelledRef.current = true; }}
                  className="px-4 py-1.5 text-xs rounded-lg border dark:border-claude-darkBorder border-claude-border dark:text-claude-darkTextSecondary text-claude-textSecondary dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover transition-colors"
                >
                  {i18nService.t('skillUpgradeCancel')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SkillsManager;
