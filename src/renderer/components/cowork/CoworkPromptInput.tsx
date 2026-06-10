import { ExclamationTriangleIcon, MicrophoneIcon } from '@heroicons/react/24/outline';
import { FolderIcon,PaperAirplaneIcon, StopIcon } from '@heroicons/react/24/solid';
import React, { useCallback,useEffect, useRef, useState } from 'react';
import { useDispatch,useSelector } from 'react-redux';

import { SpeechErrorCode } from '../../../shared/speech/constants';
import { DEFAULT_SPEECH_INPUT_CONFIG, DEFAULT_VOICE_POST_PROCESS_CONFIG, DEFAULT_WAKE_INPUT_CONFIG } from '../../config';
import { AppCustomEvent } from '../../constants/app';
import { agentService } from '../../services/agent';
import { configService } from '../../services/config';
import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { getInstalledKitSkillIds } from '../../services/kitCapability';
import { mcpService } from '../../services/mcp';
import { skillService } from '../../services/skill';
import { voiceTextPostProcessService } from '../../services/voiceTextPostProcess';
import { RootState } from '../../store';
import {
  addDraftAttachment,
  clearDraftAttachments,
  type DraftAttachment,
  enqueueCoworkInput,
  type QueuedCoworkInput,
  removeCoworkInputFromQueue,
  setDraftAttachments,
  setDraftPrompt,
  updateCurrentSessionModelOverride,
} from '../../store/slices/coworkSlice';
import { toggleActiveKit } from '../../store/slices/kitSlice';
import { setMcpServers } from '../../store/slices/mcpSlice';
import type { Model } from '../../store/slices/modelSlice';
import { setActiveSkillIds, setSkills, toggleActiveSkill } from '../../store/slices/skillSlice';
import { CoworkImageAttachment } from '../../types/cowork';
import type { LocalizedQuickAction } from '../../types/quickAction';
import { Skill } from '../../types/skill';
import { resolveOpenClawModelRef, toOpenClawModelRef } from '../../utils/openclawModelRef';
import { getCompactFolderName } from '../../utils/path';
import type { BrowserAnnotationPayload } from '../artifacts/ArtifactPanel';
import PaperClipIcon from '../icons/PaperClipIcon';
import PencilIcon from '../icons/PencilIcon';
import TrashIcon from '../icons/TrashIcon';
import XMarkIcon from '../icons/XMarkIcon';
import ModelSelector from '../ModelSelector';
import { ActiveKitBadge, KitsButton } from '../kits';
import { ActiveSkillBadge,SkillsButton } from '../skills';
import {
  WakeActivationOverlayPhase,
  type WakeActivationOverlayStateChange,
} from '../wakeActivationOverlayHelpers';
import { resolveAgentModelSelection, resolveEffectiveModel, shouldRepairAgentModelAfterSessionModelChange } from './agentModelSelection';
import AttachmentCard from './AttachmentCard';
import { buildSpeechDraftText, resolveSpeechVoiceCommand, SpeechVoiceCommandAction } from './coworkSpeechText';
import FolderSelectorPopover from './FolderSelectorPopover';
import {
  addPromptInputHistoryEntry,
  canNavigatePromptInputHistory,
  mergePromptInputHistoryEntries,
} from './promptInputHistory';
import {
  applyPromptSlashCommand,
  filterPromptSlashCommands,
  getBuiltinPromptSlashCommands,
  PromptBuiltinSlashCommandId,
  PromptSlashCommandKind,
  type PromptSlashCommandMatch,
} from './promptSlashCommands';
import { buildSelectedKitContextPrompt } from './selectedKitContextPrompt';
import { buildSelectedSkillRoutingPrompt } from './selectedSkillRoutingPrompt';

// CoworkAttachment is aliased from the Redux-persisted DraftAttachment type
// so that attachment state survives view switches (cowork ↔ skills, etc.)
type CoworkAttachment = DraftAttachment;

const INPUT_FILE_LABEL = '输入文件';
const EMPTY_ATTACHMENTS: CoworkAttachment[] = [];
const EMPTY_PROMPT_HISTORY: string[] = [];
const EMPTY_SLASH_COMMAND_MATCHES: PromptSlashCommandMatch[] = [];

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

const isImagePath = (filePath: string): boolean => {
  const dotIndex = filePath.lastIndexOf('.');
  if (dotIndex === -1) return false;
  const ext = filePath.slice(dotIndex).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
};

const isImageMimeType = (mimeType: string): boolean => {
  return mimeType.startsWith('image/');
};

const inferImageMimeTypeFromPath = (filePath: string): string => {
  const dotIndex = filePath.lastIndexOf('.');
  if (dotIndex === -1) return 'application/octet-stream';
  const ext = filePath.slice(dotIndex).toLowerCase();
  return IMAGE_MIME_BY_EXT[ext] || 'application/octet-stream';
};

const SlashCommandMenu: React.FC<{
  matches: PromptSlashCommandMatch[];
  onSelect: (match: PromptSlashCommandMatch) => void;
}> = ({ matches, onSelect }) => (
  <div className="absolute bottom-full left-3 right-3 z-30 mb-2 overflow-hidden rounded-xl border border-border bg-surface shadow-popover">
    <div className="border-b border-border px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-secondary">
      {i18nService.t('coworkSlashCommandsTitle')}
    </div>
    <div className="max-h-64 overflow-y-auto py-1">
      {matches.map((match) => (
        <button
          key={getSlashCommandMatchKey(match)}
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(match)}
          className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-raised"
        >
          <span className="mt-0.5 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
            /
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">
              {getSlashCommandMatchLabel(match)}
            </span>
            <span className="mt-0.5 block truncate text-xs text-secondary">
              {getSlashCommandMatchDescription(match)}
            </span>
          </span>
        </button>
      ))}
    </div>
  </div>
);

function getSlashCommandMatchKey(match: PromptSlashCommandMatch): string {
  switch (match.kind) {
    case PromptSlashCommandKind.Builtin:
      return `builtin:${match.id}`;
    case PromptSlashCommandKind.Skill:
      return `skill:${match.skill.id}`;
    case PromptSlashCommandKind.McpServer:
      return `mcp:${match.server.id}`;
    case PromptSlashCommandKind.QuickActionPrompt:
      return `quick-action:${match.action.id}:${match.prompt.id}`;
  }
}

function getSlashCommandMatchLabel(match: PromptSlashCommandMatch): string {
  switch (match.kind) {
    case PromptSlashCommandKind.Builtin:
      return match.label;
    case PromptSlashCommandKind.Skill:
      return match.skill.name;
    case PromptSlashCommandKind.McpServer:
      return match.server.name;
    case PromptSlashCommandKind.QuickActionPrompt:
      return match.action.label;
  }
}

function getSlashCommandMatchDescription(match: PromptSlashCommandMatch): string | undefined {
  switch (match.kind) {
    case PromptSlashCommandKind.Builtin:
      return match.description;
    case PromptSlashCommandKind.Skill:
      return `${i18nService.t('coworkSlashSkillPrefix')} · ${match.skill.description || match.skill.id}`;
    case PromptSlashCommandKind.McpServer:
      return `${i18nService.t('coworkSlashMcpPrefix')} · ${match.server.description || match.server.id}`;
    case PromptSlashCommandKind.QuickActionPrompt:
      return `${match.prompt.label}${match.prompt.description ? ` · ${match.prompt.description}` : ''}`;
  }
}

const getFileNameFromPath = (path: string): string => {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
};

const getSkillDirectoryFromPath = (skillPath: string): string => {
  const normalized = skillPath.trim().replace(/\\/g, '/');
  return normalized.replace(/\/SKILL\.md$/i, '') || normalized;
};

const buildInlinedSkillPrompt = (skill: Skill): string => {
  const skillDirectory = getSkillDirectoryFromPath(skill.skillPath);
  return [
    `## Skill: ${skill.name}`,
    '<skill_context>',
    `  <location>${skill.skillPath}</location>`,
    `  <directory>${skillDirectory}</directory>`,
    '  <path_rules>',
    '    Resolve relative file references from this skill against <directory>.',
    '    Do not assume skills are under the current workspace directory.',
    '  </path_rules>',
    '</skill_context>',
    '',
    skill.prompt,
  ].join('\n');
};

const buildMcpSlashPrompt = (name: string, description?: string): string => {
  const normalizedName = name.trim();
  const normalizedDescription = description?.trim();
  return normalizedDescription
    ? i18nService.t('coworkSlashMcpPromptWithDescription')
      .replace('{name}', normalizedName)
      .replace('{description}', normalizedDescription)
    : i18nService.t('coworkSlashMcpPrompt').replace('{name}', normalizedName);
};

export interface CoworkPromptInputRef {
  /** 设置输入框值 */
  setValue: (value: string) => void;
  /** 设置图片附件 */
  setImageAttachments: (attachments: CoworkImageAttachment[]) => void;
  /** 插入浏览器注释截图和注释文本 */
  insertBrowserAnnotation: (annotation: BrowserAnnotationPayload) => void;
  /** 聚焦输入框 */
  focus: () => void;
}

interface CoworkPromptInputProps {
  onSubmit: (prompt: string, skillPrompt?: string, imageAttachments?: CoworkImageAttachment[]) => boolean | void | Promise<boolean | void>;
  onStop?: () => void;
  isStreaming?: boolean;
  queuedCount?: number;
  queuedInputs?: QueuedCoworkInput[];
  placeholder?: string;
  disabled?: boolean;
  size?: 'normal' | 'large';
  workingDirectory?: string;
  onWorkingDirectoryChange?: (dir: string) => void;
  showFolderSelector?: boolean;
  showModelSelector?: boolean;
  onManageSkills?: () => void;
  sessionId?: string;
  /** When true, hides attachment/skill buttons but keeps the input box visible (disabled) */
  remoteManaged?: boolean;
}

type InputSpeechStatus = 'idle' | 'requesting_permission' | 'listening';
type PendingSpeechVoiceCommand = SpeechVoiceCommandAction | null;
type WakeDictationCommandConfig = {
  submitCommand: string;
  cancelCommand: string;
  sessionTimeoutMs: number;
  autoRestartAfterReply: boolean;
  source?: 'wake' | 'follow_up';
};

const CoworkPromptInput = React.forwardRef<CoworkPromptInputRef, CoworkPromptInputProps>(
  (props, ref) => {
    const {
      onSubmit,
      onStop,
      isStreaming = false,
      queuedCount = 0,
      queuedInputs = [],
      placeholder = 'Enter your task...',
      disabled = false,
      size = 'normal',
      workingDirectory = '',
      onWorkingDirectoryChange,
      showFolderSelector = false,
      showModelSelector = false,
      onManageSkills,
      sessionId,
      remoteManaged = false,
    } = props;
    const dispatch = useDispatch();
    const draftKey = sessionId || '__home__';
    const draftPrompt = useSelector((state: RootState) => state.cowork.draftPrompts[draftKey] || '');
    const attachments = useSelector(
      (state: RootState) => state.cowork.draftAttachments[draftKey] || EMPTY_ATTACHMENTS
    );
    const [value, setValue] = useState(draftPrompt);
    const [showFolderMenu, setShowFolderMenu] = useState(false);
    const [showFolderRequiredWarning, setShowFolderRequiredWarning] = useState(false);
    const [isDraggingFiles, setIsDraggingFiles] = useState(false);
    const [isAddingFile, setIsAddingFile] = useState(false);
    const [imageVisionHint, setImageVisionHint] = useState(false);
    const [speechStatus, setSpeechStatus] = useState<InputSpeechStatus>('idle');
    const [speechVisible, setSpeechVisible] = useState(window.electron.platform === 'darwin');
    const [speechCommandNonce, setSpeechCommandNonce] = useState(0);
    const [isPatchingModel, setIsPatchingModel] = useState(false);
    const [promptHistory, setPromptHistory] = useState<string[]>(EMPTY_PROMPT_HISTORY);
    const [promptHistoryIndex, setPromptHistoryIndex] = useState(-1);

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const folderButtonRef = useRef<HTMLButtonElement>(null);
    const dragDepthRef = useRef(0);
    const valueRef = useRef(value);
    const speechStatusRef = useRef<InputSpeechStatus>('idle');
    const speechBaseValueRef = useRef('');
    const pendingSpeechVoiceCommandRef = useRef<PendingSpeechVoiceCommand>(null);
    const wakeDictationConfigRef = useRef<WakeDictationCommandConfig | null>(null);
    const wakeDictationTimerRef = useRef<number | null>(null);
    const pendingWakeDictationStartRef = useRef<WakeDictationCommandConfig | null>(null);
    const activeWakeOverlayRef = useRef(false);
    const modelPatchRequestIdRef = useRef(0);
    const promptHistoryDraftRef = useRef('');
    const modelSupportsImageRef = useRef(false);

    const isLarge = size === 'large';
    const minHeight = isLarge ? 44 : 24;
    const maxHeight = isLarge ? 200 : 200;

  // 暴露方法给父组件
  React.useImperativeHandle(ref, () => ({
    setValue: (newValue: string) => {
      setValue(newValue);
      // 触发自动调整高度
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (textarea) {
          textarea.style.height = 'auto';
          textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight)}px`;
        }
      });
    },
    setImageAttachments: (imageAttachments: CoworkImageAttachment[]) => {
      const nextAttachments: CoworkAttachment[] = imageAttachments.map((attachment, index) => {
        if ('path' in attachment) {
          return {
            path: attachment.path,
            name: attachment.name,
            isImage: true,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
          };
        }
        return {
          path: `inline:${attachment.name}:${index}`,
          name: attachment.name,
          isImage: true,
          mimeType: attachment.mimeType,
        };
      });
      dispatch(setDraftAttachments({
        draftKey,
        attachments: nextAttachments,
      }));
    },
    insertBrowserAnnotation: (annotation: BrowserAnnotationPayload) => {
      const timestamp = Date.now();
      const imageName = `${i18nService.t('artifactBrowserAnnotationImageName')}-${timestamp}.png`;
      const annotationArea = [
        `shape=${annotation.annotation.shape}`,
        `color=${annotation.annotation.color}`,
        `x=${annotation.annotation.x}`,
        `y=${annotation.annotation.y}`,
        `width=${annotation.annotation.width}`,
        `height=${annotation.annotation.height}`,
      ].join(', ');
      const pageLabel = i18nService.t('artifactBrowserAnnotationPromptPage');
      const elementLabel = i18nService.t('artifactBrowserAnnotationPromptElement');
      const elementSummary = [
        annotation.element.tagName,
        annotation.element.text ? `"${annotation.element.text}"` : '',
        `${annotation.element.width}x${annotation.element.height}`,
      ].filter(Boolean).join(', ');
      const annotationPrompt = [
        i18nService.t('artifactBrowserAnnotationPromptTitle'),
        i18nService.t('artifactBrowserAnnotationPromptTarget'),
        '',
        `${i18nService.t('artifactBrowserAnnotationPromptScreenshot')}: ${annotation.screenshot.width} x ${annotation.screenshot.height}`,
        `${i18nService.t('artifactBrowserAnnotationPromptArea')}: ${annotationArea}`,
        annotation.pageTitle || annotation.pageUrl ? `${pageLabel}: ${[annotation.pageTitle, annotation.pageUrl].filter(Boolean).join(' - ')}` : '',
        elementSummary ? `${elementLabel}: ${elementSummary}` : '',
        '',
        `${i18nService.t('artifactBrowserAnnotationPromptComment')}:`,
        annotation.comment.trim(),
      ].filter(line => line !== '').join('\n');
      const nextValue = valueRef.current.trim()
        ? `${valueRef.current.trim()}\n\n${annotationPrompt}`
        : annotationPrompt;
      setValue(nextValue);
      speechBaseValueRef.current = nextValue;
      dispatch(setDraftPrompt({ sessionId: draftKey, draft: nextValue }));
      dispatch(addDraftAttachment({
        draftKey,
        attachment: {
          path: `inline:${imageName}:${timestamp}`,
          name: imageName,
          isImage: true,
          mimeType: 'image/png',
          dataUrl: annotation.imageDataUrl,
        },
      }));
      setImageVisionHint(!modelSupportsImageRef.current);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    },
    focus: () => {
      textareaRef.current?.focus();
    },
  }), [dispatch, draftKey, maxHeight, minHeight]);

  const activeSkillIds = useSelector((state: RootState) => state.skill.activeSkillIds);
  const activeKitIds = useSelector((state: RootState) => state.kit.activeKitIds);
  const installedKits = useSelector((state: RootState) => state.kit.installedKits);
  const marketplaceKits = useSelector((state: RootState) => state.kit.marketplaceKits);
  const skills = useSelector((state: RootState) => state.skill.skills);
  const mcpServers = useSelector((state: RootState) => state.mcp.servers);
  const quickActions = useSelector((state: RootState) => state.quickAction.actions) as LocalizedQuickAction[];
  const currentAgentId = useSelector((state: RootState) => state.agent.currentAgentId);
  const agents = useSelector((state: RootState) => state.agent.agents);
  const coworkAgentEngine = useSelector((state: RootState) => state.cowork.config.agentEngine);
  const availableModels = useSelector((state: RootState) => state.model.availableModels);
  const globalSelectedModel = useSelector((state: RootState) => state.model.selectedModel);
  const currentSession = useSelector((state: RootState) => state.cowork.currentSession);
  const isMac = window.electron.platform === 'darwin';
  const isSpeechActive = speechStatus !== 'idle';
  const currentAgent = agents.find((agent) => agent.id === currentAgentId);
  const currentSessionModelOverride = currentSession && currentSession.id === sessionId
    ? currentSession.modelOverride?.trim() ?? ''
    : '';
  const currentAgentModelRef = currentAgent?.model?.trim() ?? '';
  const shouldRepairCurrentAgentModel = shouldRepairAgentModelAfterSessionModelChange({
    sessionModel: currentSessionModelOverride,
    agentModel: currentAgentModelRef,
    availableModels,
  });
  const {
    selectedModel: agentSelectedModel,
    hasInvalidExplicitModel: agentModelIsInvalid,
  } = resolveAgentModelSelection({
    sessionModel: currentSessionModelOverride,
    agentModel: currentAgentModelRef,
    availableModels,
    fallbackModel: globalSelectedModel,
    engine: coworkAgentEngine,
  });
  const explicitSelectedModel = currentSessionModelOverride
    ? resolveOpenClawModelRef(currentSessionModelOverride, availableModels) ?? null
    : currentAgent?.model?.trim()
      ? resolveOpenClawModelRef(currentAgent.model, availableModels) ?? null
      : null;
  const effectiveSelectedModel = resolveEffectiveModel({
    sessionId,
    agentSelectedModel,
    globalSelectedModel,
  });
  const modelSupportsImage = !!effectiveSelectedModel?.supportsImage;
  modelSupportsImageRef.current = modelSupportsImage;

  const getSpeechVoiceCommandConfig = useCallback(() => ({
    ...DEFAULT_SPEECH_INPUT_CONFIG,
    ...(configService.getConfig().speechInput ?? {}),
  }), []);

  const markPendingSpeechVoiceCommand = useCallback((action: PendingSpeechVoiceCommand) => {
    pendingSpeechVoiceCommandRef.current = action;
    setSpeechCommandNonce((current) => current + 1);
  }, []);

  const maybeCorrectFinalSpeechText = useCallback(async (rawText: string): Promise<string> => {
    const normalized = rawText.trim();
    if (!normalized) {
      return '';
    }

    const postProcessConfig = configService.getConfig().voice?.postProcess ?? DEFAULT_VOICE_POST_PROCESS_CONFIG;
    if (!postProcessConfig.sttLlmCorrectionEnabled) {
      return normalized;
    }

    return voiceTextPostProcessService.correctSttText(normalized);
  }, []);

  const getFollowUpDictationConfig = useCallback((
    wakeConfigOverride?: WakeDictationCommandConfig | null,
  ): WakeDictationCommandConfig | null => {
    const speechInputConfig = {
      ...DEFAULT_SPEECH_INPUT_CONFIG,
      ...(configService.getConfig().speechInput ?? {}),
    };
    if (!speechInputConfig.autoRestartAfterReply) {
      return null;
    }

    const wakeInputConfig = {
      ...DEFAULT_WAKE_INPUT_CONFIG,
      ...(configService.getConfig().wakeInput ?? {}),
    };

    if (wakeConfigOverride) {
      return {
        ...wakeConfigOverride,
        autoRestartAfterReply: true,
        source: 'follow_up',
      };
    }

    return {
      submitCommand: speechInputConfig.submitCommand,
      cancelCommand: speechInputConfig.stopCommand,
      sessionTimeoutMs: wakeInputConfig.sessionTimeoutMs,
      autoRestartAfterReply: true,
      source: 'follow_up',
    };
  }, []);

  const armWakeFollowUpDictation = useCallback((config: WakeDictationCommandConfig | null) => {
    if (!config?.autoRestartAfterReply) {
      console.log('[WakeFollowUp] Disarmed follow-up dictation because auto restart is disabled.');
      void window.electron.speechFollowUp.disarm().catch((error) => {
        console.error('[WakeFollowUp] Failed to disarm speech follow-up:', error);
      });
      return;
    }
    console.log('[WakeFollowUp] Emitting arm request from prompt input.', {
      sessionId: sessionId ?? null,
      config,
    });
    void window.electron.speechFollowUp.arm({
      sessionId: sessionId ?? null,
      config,
    }).catch((error) => {
      console.error('[WakeFollowUp] Failed to arm speech follow-up:', error);
    });
  }, [sessionId]);

  const disarmWakeFollowUpDictation = useCallback(() => {
    console.log('[WakeFollowUp] Emitting disarm request from prompt input.');
    void window.electron.speechFollowUp.disarm().catch((error) => {
      console.error('[WakeFollowUp] Failed to disarm speech follow-up:', error);
    });
  }, []);

  const syncWakeActivationOverlay = useCallback((detail: WakeActivationOverlayStateChange) => {
    window.dispatchEvent(new CustomEvent(AppCustomEvent.UpdateWakeActivationOverlay, { detail }));
  }, []);

  const updateWakeActivationOverlay = useCallback((detail: Omit<WakeActivationOverlayStateChange, 'visible'>) => {
    if (!activeWakeOverlayRef.current) {
      return;
    }
    syncWakeActivationOverlay({ visible: true, ...detail });
  }, [syncWakeActivationOverlay]);

  const hideWakeActivationOverlay = useCallback(() => {
    activeWakeOverlayRef.current = false;
    syncWakeActivationOverlay({ visible: false });
  }, [syncWakeActivationOverlay]);

  const startWakeDictation = useCallback((detail: WakeDictationCommandConfig) => {
    console.log('[WakeFollowUp] Starting wake dictation.', {
      detail,
      isStreaming,
      isSpeechActive,
      speechVisible,
    });
    speechBaseValueRef.current = valueRef.current;
    pendingSpeechVoiceCommandRef.current = null;
    wakeDictationConfigRef.current = detail;
    activeWakeOverlayRef.current = detail.source === 'wake';
    if (activeWakeOverlayRef.current) {
      syncWakeActivationOverlay({
        visible: true,
        phase: WakeActivationOverlayPhase.Preparing,
        transcript: '',
      });
    }
    if (wakeDictationTimerRef.current) {
      window.clearTimeout(wakeDictationTimerRef.current);
    }
    wakeDictationTimerRef.current = window.setTimeout(() => {
      if (speechStatus !== 'idle') {
        markPendingSpeechVoiceCommand(null);
        wakeDictationConfigRef.current = null;
        hideWakeActivationOverlay();
        void window.electron.speech.stop().catch(() => undefined);
      }
      wakeDictationTimerRef.current = null;
    }, detail.sessionTimeoutMs);
    setSpeechStatus('requesting_permission');
    void window.electron.speech.start({ source: detail.source ?? 'wake' }).then((result) => {
      if (!result.success) {
        setSpeechStatus('idle');
        wakeDictationConfigRef.current = null;
        if (wakeDictationTimerRef.current) {
          window.clearTimeout(wakeDictationTimerRef.current);
          wakeDictationTimerRef.current = null;
        }
        hideWakeActivationOverlay();
        disarmWakeFollowUpDictation();
        window.dispatchEvent(new CustomEvent(AppCustomEvent.ShowToast, {
          detail: resolveSpeechErrorMessage(result.error, result.error),
        }));
      }
    });
  }, [disarmWakeFollowUpDictation, hideWakeActivationOverlay, markPendingSpeechVoiceCommand, speechStatus, syncWakeActivationOverlay]);

  // Load skills on mount
  useEffect(() => {
    const loadSkills = async () => {
      const loadedSkills = await skillService.loadSkills();
      dispatch(setSkills(loadedSkills));
    };
    loadSkills();
  }, [dispatch]);

  useEffect(() => {
    const unsubscribe = skillService.onSkillsChanged(async () => {
      const loadedSkills = await skillService.loadSkills();
      dispatch(setSkills(loadedSkills));
    });
    return () => {
      unsubscribe();
    };
  }, [dispatch]);

  useEffect(() => {
    if (mcpServers.length > 0) return;
    let isActive = true;
    const loadMcpServers = async () => {
      const loadedServers = await mcpService.loadServers();
      if (!isActive) return;
      dispatch(setMcpServers(loadedServers));
    };
    loadMcpServers();
    return () => {
      isActive = false;
    };
  }, [dispatch, mcpServers.length]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight)}px`;
    }
  }, [value, minHeight, maxHeight]);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    speechStatusRef.current = speechStatus;
  }, [speechStatus]);

  useEffect(() => {
    modelPatchRequestIdRef.current += 1;
    setIsPatchingModel(false);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || currentSession?.id !== sessionId) {
      return;
    }
    const sessionUserPrompts = currentSession.messages
      .filter((message) => message.type === 'user')
      .map((message) => message.content);
    const queuedPrompts = queuedInputs.map((input) => input.prompt);
    setPromptHistory((history) => mergePromptInputHistoryEntries(history, [
      ...sessionUserPrompts,
      ...queuedPrompts,
    ]));
  }, [currentSession?.id, currentSession?.messages, queuedInputs, sessionId]);

  useEffect(() => {
    const handleFocusInput = (event: Event) => {
      const detail = (event as CustomEvent<{ clear?: boolean }>).detail;
      const shouldClear = detail?.clear ?? true;
      if (shouldClear) {
        hideWakeActivationOverlay();
        setValue('');
        dispatch(clearDraftAttachments(draftKey));
        setImageVisionHint(false);
      }
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    };
    window.addEventListener('cowork:focus-input', handleFocusInput);
    window.addEventListener(AppCustomEvent.FocusCoworkInput, handleFocusInput);
    return () => {
      window.removeEventListener('cowork:focus-input', handleFocusInput);
      window.removeEventListener(AppCustomEvent.FocusCoworkInput, handleFocusInput);
    };
  }, [dispatch, draftKey, hideWakeActivationOverlay]);

  useEffect(() => {
    if (workingDirectory?.trim()) {
      setShowFolderRequiredWarning(false);
    }
  }, [workingDirectory]);

  useEffect(() => {
    if (!isMac) {
      return;
    }

    let active = true;
    window.electron.speech.getAvailability()
      .then((availability) => {
        if (!active) {
          return;
        }
        setSpeechVisible(availability.enabled ?? true);
      })
      .catch((error) => {
        console.error('Failed to inspect speech availability:', error);
        if (active) {
          setSpeechVisible(true);
        }
      });

    const unsubscribe = window.electron.speech.onStateChanged((event) => {
      switch (event.type) {
        case 'listening':
          setSpeechStatus('listening');
          updateWakeActivationOverlay({ phase: WakeActivationOverlayPhase.Dictating });
          break;
        case 'partial': {
          const currentCommandConfig = wakeDictationConfigRef.current
            ? {
                stopCommand: wakeDictationConfigRef.current.cancelCommand,
                submitCommand: wakeDictationConfigRef.current.submitCommand,
              }
            : getSpeechVoiceCommandConfig();
          const commandResult = resolveSpeechVoiceCommand(event.text || '', currentCommandConfig);
          const nextValue = buildSpeechDraftText(speechBaseValueRef.current, commandResult.cleanedSpeechText);
          setValue(nextValue);
          updateWakeActivationOverlay({
            phase: WakeActivationOverlayPhase.Dictating,
            transcript: nextValue,
          });
          if (commandResult.action) {
            speechBaseValueRef.current = nextValue;
            markPendingSpeechVoiceCommand(commandResult.action);
            void window.electron.speech.stop().catch(() => undefined);
          }
          break;
        }
        case 'final': {
          const currentCommandConfig = wakeDictationConfigRef.current
            ? {
                stopCommand: wakeDictationConfigRef.current.cancelCommand,
                submitCommand: wakeDictationConfigRef.current.submitCommand,
              }
            : getSpeechVoiceCommandConfig();
          void maybeCorrectFinalSpeechText(event.text || '').then((finalText) => {
            const commandResult = resolveSpeechVoiceCommand(finalText, currentCommandConfig);
            const nextValue = buildSpeechDraftText(speechBaseValueRef.current, commandResult.cleanedSpeechText);
            speechBaseValueRef.current = nextValue;
            setValue(nextValue);
            updateWakeActivationOverlay({
              phase: WakeActivationOverlayPhase.Dictating,
              transcript: nextValue,
            });
            if (commandResult.action) {
              markPendingSpeechVoiceCommand(commandResult.action);
              if (speechStatusRef.current !== 'idle') {
                void window.electron.speech.stop().catch(() => undefined);
              }
            }
          }).catch((error) => {
            console.warn('[CoworkPromptInput] Failed to post-process final speech text:', error);
            const commandResult = resolveSpeechVoiceCommand(event.text || '', currentCommandConfig);
            const nextValue = buildSpeechDraftText(speechBaseValueRef.current, commandResult.cleanedSpeechText);
            speechBaseValueRef.current = nextValue;
            setValue(nextValue);
            updateWakeActivationOverlay({
              phase: WakeActivationOverlayPhase.Dictating,
              transcript: nextValue,
            });
            if (commandResult.action) {
              markPendingSpeechVoiceCommand(commandResult.action);
              if (speechStatusRef.current !== 'idle') {
                void window.electron.speech.stop().catch(() => undefined);
              }
            }
          });
          break;
        }
        case 'stopped':
          setSpeechStatus('idle');
          break;
        case 'error':
          setSpeechStatus('idle');
          markPendingSpeechVoiceCommand(null);
          hideWakeActivationOverlay();
          disarmWakeFollowUpDictation();
          window.dispatchEvent(new CustomEvent('app:showToast', { detail: resolveSpeechErrorMessage(event.code, event.message) }));
          break;
      }
    });

    return () => {
      active = false;
      unsubscribe();
      hideWakeActivationOverlay();
      void window.electron.speech.stop().catch(() => undefined);
    };
  }, [
    disarmWakeFollowUpDictation,
    getSpeechVoiceCommandConfig,
    hideWakeActivationOverlay,
    isMac,
    markPendingSpeechVoiceCommand,
    maybeCorrectFinalSpeechText,
    updateWakeActivationOverlay,
  ]);

  // Sync value from draft when sessionId changes
  useEffect(() => {
    setValue(draftPrompt);
    speechBaseValueRef.current = draftPrompt;
    const hasImageWithoutVision = !modelSupportsImage && attachments.some((attachment) => (
      attachment.isImage || isImagePath(attachment.path)
    ));
    setImageVisionHint(hasImageWithoutVision);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]); // intentionally omit other deps to only trigger on session switch

  useEffect(() => {
    if (!isSpeechActive) {
      return;
    }
    pendingSpeechVoiceCommandRef.current = null;
    hideWakeActivationOverlay();
    void window.electron.speech.stop().catch(() => undefined);
  }, [draftKey, hideWakeActivationOverlay]);

  useEffect(() => {
    if (!isStreaming || !isSpeechActive) {
      return;
    }
    pendingSpeechVoiceCommandRef.current = null;
    hideWakeActivationOverlay();
    void window.electron.speech.stop().catch(() => undefined);
  }, [hideWakeActivationOverlay, isSpeechActive, isStreaming]);

  useEffect(() => {
    const pendingWakeDictation = pendingWakeDictationStartRef.current;
    if (!pendingWakeDictation) {
      return;
    }
    if (disabled || isStreaming || !isMac || !speechVisible || isSpeechActive) {
      console.log('[WakeFollowUp] Pending dictation is still waiting for prompt input readiness.', {
        disabled,
        isStreaming,
        isMac,
        speechVisible,
        isSpeechActive,
      });
      return;
    }
    console.log('[WakeFollowUp] Replaying pending dictation start.');
    pendingWakeDictationStartRef.current = null;
    startWakeDictation(pendingWakeDictation);
  }, [disabled, isMac, isSpeechActive, isStreaming, speechVisible, startWakeDictation]);

  useEffect(() => {
    if (value !== draftPrompt) {
      const timer = setTimeout(() => {
        dispatch(setDraftPrompt({ sessionId: draftKey, draft: value }));
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [value, draftPrompt, dispatch, draftKey]);

  const handleSubmit = useCallback(async (wakeConfigOverride?: WakeDictationCommandConfig | null) => {
    if (showFolderSelector && !workingDirectory?.trim()) {
      setShowFolderRequiredWarning(true);
      return;
    }

    const trimmedValue = value.trim();
    if ((!trimmedValue && attachments.length === 0) || disabled || isSpeechActive || isPatchingModel) return;
    setShowFolderRequiredWarning(false);

    const kitSkillIds = activeKitIds.flatMap((kitId) => getInstalledKitSkillIds(installedKits[kitId]));
    const effectiveActiveSkillIds = [...new Set([...activeSkillIds, ...kitSkillIds])];

    // Get active skills prompts and combine them
    const activeSkills = activeSkillIds
      .map(id => skills.find(s => s.id === id))
      .filter((s): s is Skill => s !== undefined);
    const kitContextPrompt = buildSelectedKitContextPrompt(activeKitIds, marketplaceKits, installedKits);
    const skillRoutingPrompt = buildSelectedSkillRoutingPrompt(activeSkills);
    const skillPromptParts = [
      activeSkills.length > 0 ? activeSkills.map(buildInlinedSkillPrompt).join('\n\n') : undefined,
      kitContextPrompt,
      skillRoutingPrompt,
    ].filter((part): part is string => Boolean(part && part.trim()));
    const skillPrompt = skillPromptParts.length > 0 ? skillPromptParts.join('\n\n') : undefined;

    // 图片附件只传轻量文件引用；main 进程会在运行时边界读取并转成 base64。
    const imageAtts: CoworkImageAttachment[] = [];
    for (const attachment of attachments) {
      if (attachment.isImage && attachment.dataUrl) {
        const match = /^data:([^;]+);base64,(.*)$/.exec(attachment.dataUrl);
        if (match) {
          imageAtts.push({
            name: attachment.name,
            mimeType: match[1] || attachment.mimeType || 'image/png',
            base64Data: match[2],
          });
        }
        continue;
      }
      if (attachment.isImage && attachment.path && !attachment.path.startsWith('inline:')) {
        imageAtts.push({
          name: attachment.name,
          mimeType: attachment.mimeType || inferImageMimeTypeFromPath(attachment.path),
          path: attachment.path,
          sizeBytes: attachment.sizeBytes,
        });
      }
    }

    // 图片已经通过 chat.send attachments 传递，避免再把本地路径写进 prompt。
    // 否则 OpenClaw 会把路径当作 Native-image 处理，路径校验失败时可能连 base64 图片也丢弃。
    const attachmentLines = attachments
      .filter((a) => !a.path.startsWith('inline:') && !(a.isImage && (
        a.dataUrl || imageAtts.some((img) => 'path' in img && img.path === a.path)
      )))
      .map((attachment) => `${INPUT_FILE_LABEL}: ${attachment.path}`)
      .join('\n');
    const finalPrompt = trimmedValue
      ? (attachmentLines ? `${trimmedValue}\n\n${attachmentLines}` : trimmedValue)
      : attachmentLines;

    if (isStreaming && sessionId) {
      dispatch(enqueueCoworkInput({
        id: `${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        sessionId,
        prompt: finalPrompt,
        skillPrompt,
        activeSkillIds: effectiveActiveSkillIds,
        imageAttachments: imageAtts.length > 0 ? imageAtts : undefined,
        createdAt: Date.now(),
      }));
      if (trimmedValue) {
        setPromptHistory((history) => addPromptInputHistoryEntry(history, trimmedValue));
      }
      setPromptHistoryIndex(-1);
      promptHistoryDraftRef.current = '';
      setValue('');
      speechBaseValueRef.current = '';
      dispatch(setDraftPrompt({ sessionId: draftKey, draft: '' }));
      dispatch(clearDraftAttachments(draftKey));
      setImageVisionHint(false);
      return true;
    }

    if (isStreaming) return;

    if (imageAtts.length > 0) {
      console.log('[CoworkPromptInput] handleSubmit: passing imageAtts to onSubmit', {
        count: imageAtts.length,
        names: imageAtts.map(a => a.name),
        sources: imageAtts.map(a => ('path' in a ? 'path' : 'base64')),
      });
    }
    updateWakeActivationOverlay({
      phase: WakeActivationOverlayPhase.Submitting,
      transcript: finalPrompt,
    });

    let result: boolean | void;
    try {
      result = await onSubmit(finalPrompt, skillPrompt, imageAtts.length > 0 ? imageAtts : undefined);
    } catch (error) {
      console.error('[CoworkPromptInput] Failed to submit wake dictation prompt:', error);
      hideWakeActivationOverlay();
      disarmWakeFollowUpDictation();
      return false;
    }

    if (result === false) {
      hideWakeActivationOverlay();
      disarmWakeFollowUpDictation();
      return false;
    }
    armWakeFollowUpDictation(getFollowUpDictationConfig(wakeConfigOverride ?? wakeDictationConfigRef.current));
    hideWakeActivationOverlay();
    if (trimmedValue) {
      setPromptHistory((history) => addPromptInputHistoryEntry(history, trimmedValue));
    }
    setPromptHistoryIndex(-1);
    promptHistoryDraftRef.current = '';
    setValue('');
    speechBaseValueRef.current = '';
    pendingSpeechVoiceCommandRef.current = null;
    dispatch(setDraftPrompt({ sessionId: draftKey, draft: '' }));
    dispatch(clearDraftAttachments(draftKey));
    setImageVisionHint(false);
  }, [
    value,
    isStreaming,
    disabled,
    isSpeechActive,
    isPatchingModel,
    onSubmit,
    sessionId,
    activeSkillIds,
    activeKitIds,
    installedKits,
    marketplaceKits,
    skills,
    attachments,
    showFolderSelector,
    workingDirectory,
    dispatch,
    armWakeFollowUpDictation,
    disarmWakeFollowUpDictation,
    getFollowUpDictationConfig,
    hideWakeActivationOverlay,
    updateWakeActivationOverlay,
  ]);

  useEffect(() => {
    if (speechStatus !== 'idle') {
      return;
    }

    const pendingSpeechVoiceCommand = pendingSpeechVoiceCommandRef.current;
    if (pendingSpeechVoiceCommand !== SpeechVoiceCommandAction.Submit) {
      pendingSpeechVoiceCommandRef.current = null;
      wakeDictationConfigRef.current = null;
      if (wakeDictationTimerRef.current) {
        window.clearTimeout(wakeDictationTimerRef.current);
        wakeDictationTimerRef.current = null;
      }
      if (pendingSpeechVoiceCommand === SpeechVoiceCommandAction.Stop) {
        hideWakeActivationOverlay();
      }
      disarmWakeFollowUpDictation();
      return;
    }

    const submittedWakeConfig = wakeDictationConfigRef.current;
    pendingSpeechVoiceCommandRef.current = null;
    wakeDictationConfigRef.current = null;
    if (wakeDictationTimerRef.current) {
      window.clearTimeout(wakeDictationTimerRef.current);
      wakeDictationTimerRef.current = null;
    }
    void handleSubmit(submittedWakeConfig);
  }, [disarmWakeFollowUpDictation, handleSubmit, hideWakeActivationOverlay, speechCommandNonce, speechStatus]);

  useEffect(() => {
    const handleWakeDictationStart = (event: Event) => {
      const detail = (event as CustomEvent<WakeDictationCommandConfig>).detail;
      if (!detail || !isMac) {
        hideWakeActivationOverlay();
        return;
      }
      if (disabled) {
        pendingWakeDictationStartRef.current = null;
        hideWakeActivationOverlay();
        console.log('[WakeFollowUp] Ignored wake dictation start because prompt input is disabled.');
        return;
      }
      if (isStreaming || isSpeechActive || !speechVisible) {
        console.log('[WakeFollowUp] Queued wake dictation start until prompt input is ready.', {
          isStreaming,
          isSpeechActive,
          speechVisible,
          detail,
        });
        pendingWakeDictationStartRef.current = detail;
        return;
      }
      pendingWakeDictationStartRef.current = null;
      startWakeDictation(detail);
    };

    window.addEventListener(AppCustomEvent.StartWakeDictation, handleWakeDictationStart);
    return () => {
      window.removeEventListener(AppCustomEvent.StartWakeDictation, handleWakeDictationStart);
    };
  }, [disabled, hideWakeActivationOverlay, isMac, isSpeechActive, isStreaming, speechVisible, startWakeDictation]);

  const handleSelectSkill = useCallback((skill: Skill) => {
    dispatch(toggleActiveSkill(skill.id));
  }, [dispatch]);

  const handleSelectKit = useCallback((kitId: string) => {
    dispatch(toggleActiveKit(kitId));
  }, [dispatch]);

  const handleManageSkills = useCallback(() => {
    if (onManageSkills) {
      onManageSkills();
    }
  }, [onManageSkills]);

  const handleManageKits = useCallback(() => {
    if (onManageSkills) {
      onManageSkills();
    }
  }, [onManageSkills]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      (event.key === 'ArrowUp' || event.key === 'ArrowDown')
      && !event.nativeEvent.isComposing
      && !event.shiftKey
      && !event.ctrlKey
      && !event.metaKey
      && !event.altKey
      && promptHistory.length > 0
      && canNavigatePromptInputHistory(
        event.currentTarget,
        value,
        event.key === 'ArrowUp' ? 'previous' : 'next',
        promptHistoryIndex === -1 ? null : promptHistory[promptHistoryIndex] ?? null,
      )
    ) {
      const currentIndex = promptHistoryIndex;
      const nextIndex = event.key === 'ArrowUp'
        ? Math.min(currentIndex + 1, promptHistory.length - 1)
        : currentIndex <= 0
          ? -1
          : currentIndex - 1;
      if (nextIndex !== currentIndex) {
        event.preventDefault();
        if (currentIndex === -1) {
          promptHistoryDraftRef.current = value;
        }
        setPromptHistoryIndex(nextIndex);
        setValue(nextIndex === -1 ? promptHistoryDraftRef.current : promptHistory[nextIndex]);
      }
      return;
    }

    // Enter to submit, any modifier+Enter (Shift/Ctrl/Cmd/Alt) for new line
    const isComposing = event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
    if (event.key === 'Enter' && !isComposing) {
      const hasModifier = event.shiftKey || event.ctrlKey || event.metaKey || event.altKey;
      if (!hasModifier && !disabled && !isSpeechActive && !isPatchingModel) {
        event.preventDefault();
        handleSubmit();
      } else if (hasModifier && !event.shiftKey) {
        // Shift+Enter already inserts newline natively; for Ctrl/Cmd/Alt+Enter, insert via execCommand to preserve undo history
        event.preventDefault();
        document.execCommand('insertText', false, '\n');
      }
    }
  };

  const handleStopClick = () => {
    disarmWakeFollowUpDictation();
    if (onStop) {
      onStop();
    }
  };

  const containerClass = isLarge
    ? 'jbp-visual-panel relative rounded-[16px] bg-surface shadow-[0_2px_6px_rgba(0,0,0,0.05)] focus-within:shadow-[0_4px_12px_rgba(0,0,0,0.06)] focus-within:ring-1 focus-within:ring-primary/20 focus-within:border-primary transition-all duration-300'
    : 'jbp-visual-soft-card relative flex items-end gap-2 p-3 rounded-[16px]';

  const textareaClass = isLarge
    ? `w-full resize-none bg-transparent px-4 pt-3 pb-3 text-foreground placeholder:dark:text-foregroundSecondary/60 placeholder:text-secondary/60 focus:outline-none text-[15px] leading-6 min-h-[${minHeight}px] max-h-[${maxHeight}px]`
    : 'flex-1 resize-none bg-transparent text-foreground placeholder:placeholder:text-secondary focus:outline-none text-sm leading-relaxed min-h-[24px] max-h-[200px]';

  const truncatePath = (path: string, maxLength = 30): string => {
    if (!path) return i18nService.t('noFolderSelected');
    return getCompactFolderName(path, maxLength) || i18nService.t('noFolderSelected');
  };

  const handleFolderSelect = (path: string) => {
    if (onWorkingDirectoryChange) {
      onWorkingDirectoryChange(path);
    }
  };

  const builtinSlashCommands = getBuiltinPromptSlashCommands({
    newSession: i18nService.t('coworkSlashNewSession'),
    newSessionDescription: i18nService.t('coworkSlashNewSessionDesc'),
    clearInput: i18nService.t('coworkSlashClearInput'),
    clearInputDescription: i18nService.t('coworkSlashClearInputDesc'),
    manageSkills: i18nService.t('coworkSlashManageSkills'),
    manageSkillsDescription: i18nService.t('coworkSlashManageSkillsDesc'),
    helpPrompt: i18nService.t('coworkSlashHelpPrompt'),
    helpPromptDescription: i18nService.t('coworkSlashHelpPromptDesc'),
  });
  const slashCommandMatches = !remoteManaged && !isSpeechActive
    ? filterPromptSlashCommands(quickActions, value, {
      builtinCommands: builtinSlashCommands,
      skills,
      mcpServers,
    })
    : EMPTY_SLASH_COMMAND_MATCHES;
  const showSlashCommands = slashCommandMatches.length > 0 && !disabled && !isStreaming;
  const submitTitle = isStreaming
    ? i18nService.t('coworkQueueInput')
    : i18nService.t('sendMessage');
  const queueHintText = queuedCount > 0
    ? i18nService.t('coworkQueuePendingCount').replace('{count}', String(queuedCount))
    : null;
  const queuedPreviewItems = queuedInputs.slice(0, 3);

  const handleRemoveQueuedInput = useCallback((item: QueuedCoworkInput) => {
    dispatch(removeCoworkInputFromQueue({
      sessionId: item.sessionId,
      inputId: item.id,
    }));
  }, [dispatch]);

  const handleEditQueuedInput = useCallback((item: QueuedCoworkInput) => {
    if (value.trim() || attachments.length > 0) {
      window.dispatchEvent(new CustomEvent(AppCustomEvent.ShowToast, {
        detail: i18nService.t('coworkQueueEditBlockedByDraft'),
      }));
      return;
    }
    dispatch(removeCoworkInputFromQueue({
      sessionId: item.sessionId,
      inputId: item.id,
    }));
    setValue(item.prompt);
    dispatch(setDraftPrompt({ sessionId: draftKey, draft: item.prompt }));
    dispatch(setActiveSkillIds(item.activeSkillIds ?? []));
    setPromptHistoryIndex(-1);
    promptHistoryDraftRef.current = '';
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, [attachments.length, dispatch, draftKey, value]);

  const applySlashCommand = useCallback((match: PromptSlashCommandMatch) => {
    if (match.kind === PromptSlashCommandKind.Builtin) {
      switch (match.id) {
        case PromptBuiltinSlashCommandId.NewSession:
          window.dispatchEvent(new CustomEvent(AppCustomEvent.ShortcutNewCoworkSession));
          setValue('');
          dispatch(setDraftPrompt({ sessionId: draftKey, draft: '' }));
          break;
        case PromptBuiltinSlashCommandId.ClearInput:
          setValue('');
          dispatch(setDraftPrompt({ sessionId: draftKey, draft: '' }));
          dispatch(clearDraftAttachments(draftKey));
          setImageVisionHint(false);
          break;
        case PromptBuiltinSlashCommandId.ManageSkills:
          onManageSkills?.();
          break;
        case PromptBuiltinSlashCommandId.HelpPrompt:
          setValue(i18nService.t('coworkSlashHelpPromptText'));
          dispatch(setDraftPrompt({ sessionId: draftKey, draft: i18nService.t('coworkSlashHelpPromptText') }));
          break;
      }
      setPromptHistoryIndex(-1);
      promptHistoryDraftRef.current = '';
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
      return;
    }

    if (match.kind === PromptSlashCommandKind.Skill) {
      const nextValue = applyPromptSlashCommand(
        value,
        i18nService.t('coworkSlashSkillPrompt').replace('{name}', match.skill.name),
      );
      setValue(nextValue);
      dispatch(setDraftPrompt({ sessionId: draftKey, draft: nextValue }));
      dispatch(setActiveSkillIds([match.skill.id]));
      setPromptHistoryIndex(-1);
      promptHistoryDraftRef.current = '';
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
      return;
    }

    if (match.kind === PromptSlashCommandKind.McpServer) {
      const nextValue = applyPromptSlashCommand(
        value,
        buildMcpSlashPrompt(match.server.name, match.server.description),
      );
      setValue(nextValue);
      dispatch(setDraftPrompt({ sessionId: draftKey, draft: nextValue }));
      setPromptHistoryIndex(-1);
      promptHistoryDraftRef.current = '';
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
      return;
    }

    const nextValue = applyPromptSlashCommand(value, match.prompt.prompt);
    setValue(nextValue);
    dispatch(setDraftPrompt({ sessionId: draftKey, draft: nextValue }));
    setPromptHistoryIndex(-1);
    promptHistoryDraftRef.current = '';
    if (match.action.skillMapping) {
      dispatch(setActiveSkillIds([match.action.skillMapping]));
    }
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, [dispatch, draftKey, onManageSkills, value]);

  function extractSpeechErrorReason(message?: string): string | null {
    const normalized = message?.trim();
    if (!normalized) {
      return null;
    }
    if (
      normalized === SpeechErrorCode.RuntimeError
      || normalized === SpeechErrorCode.StartFailed
      || normalized === SpeechErrorCode.HelperUnavailable
      || normalized === SpeechErrorCode.InvalidResponse
    ) {
      return null;
    }
    return normalized;
  }

  function resolveSpeechErrorMessage(code?: string, message?: string): string {
    const normalizedCode = code?.trim().toLowerCase();
    const normalizedMessage = message?.trim().toLowerCase();
    const reason = extractSpeechErrorReason(message);
    if (
      normalizedCode === SpeechErrorCode.SpeechPermissionDenied
      || normalizedCode === SpeechErrorCode.PermissionDenied
      || normalizedMessage?.includes('speech recognition permission was denied')
      || normalizedMessage?.includes('speech permission')
    ) {
      return i18nService.t('coworkSpeechPermissionDenied');
    }
    if (
      normalizedCode === SpeechErrorCode.MicrophonePermissionDenied
      || normalizedMessage?.includes('microphone permission was denied')
      || normalizedMessage?.includes('microphone permission')
    ) {
      return i18nService.t('coworkSpeechMicrophonePermissionDenied');
    }

    switch (code) {
      case SpeechErrorCode.RecognizerUnavailable:
        return i18nService.t('coworkSpeechRecognizerUnavailable');
      case SpeechErrorCode.AlreadyListening:
        return i18nService.t('coworkSpeechStartFailed');
      case SpeechErrorCode.DevPermissionPromptUnsupported:
        return i18nService.t('coworkSpeechDevPermissionPromptUnsupported');
      case SpeechErrorCode.HelperUnavailable:
      case SpeechErrorCode.UnsupportedPlatform:
        return i18nService.t('coworkSpeechUnavailable');
      case SpeechErrorCode.SpeechNoMatch:
        return i18nService.t('coworkSpeechNoMatch');
      case SpeechErrorCode.SpeechProcessInterrupted:
      case SpeechErrorCode.SpeechProcessInvalidated:
        return reason
          ? i18nService.t('coworkSpeechInterruptedWithReason').replace('{reason}', reason)
          : i18nService.t('coworkSpeechInterrupted');
      case SpeechErrorCode.StartFailed:
        return reason
          ? i18nService.t('coworkSpeechStartFailedWithReason').replace('{reason}', reason)
          : i18nService.t('coworkSpeechStartFailed');
      case SpeechErrorCode.RuntimeError:
      default:
        return reason
          ? i18nService.t('coworkSpeechRuntimeErrorWithReason').replace('{reason}', reason)
          : i18nService.t('coworkSpeechRuntimeError');
    }
  }

  const handleSpeechToggle = useCallback(async () => {
    if (!isMac || !speechVisible || disabled || isStreaming) {
      if (isMac && !speechVisible) {
        window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('coworkSpeechUnavailable') }));
      }
      return;
    }

    if (isSpeechActive) {
      pendingSpeechVoiceCommandRef.current = null;
      wakeDictationConfigRef.current = null;
      hideWakeActivationOverlay();
      disarmWakeFollowUpDictation();
      const result = await window.electron.speech.stop();
      if (!result.success) {
        window.dispatchEvent(new CustomEvent('app:showToast', { detail: resolveSpeechErrorMessage(result.error, result.error) }));
      }
      return;
    }

    speechBaseValueRef.current = valueRef.current;
    pendingSpeechVoiceCommandRef.current = null;
    wakeDictationConfigRef.current = null;
    disarmWakeFollowUpDictation();
    setSpeechStatus('requesting_permission');
    const result = await window.electron.speech.start({ source: 'manual' });
    if (!result.success) {
      setSpeechStatus('idle');
      window.dispatchEvent(new CustomEvent('app:showToast', { detail: resolveSpeechErrorMessage(result.error, result.error) }));
    }
  }, [disabled, disarmWakeFollowUpDictation, hideWakeActivationOverlay, isMac, isSpeechActive, isStreaming, speechVisible]);

  const addAttachment = useCallback((filePath: string, imageInfo?: { isImage: boolean; mimeType?: string; sizeBytes?: number }) => {
    if (!filePath) return;
    dispatch(addDraftAttachment({
      draftKey,
      attachment: {
        path: filePath,
        name: getFileNameFromPath(filePath),
        isImage: imageInfo?.isImage,
        mimeType: imageInfo?.mimeType,
        sizeBytes: imageInfo?.sizeBytes,
      },
    }));
  }, [dispatch, draftKey]);

  const fileToBase64 = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== 'string') {
          reject(new Error('Failed to read file'));
          return;
        }
        const commaIndex = result.indexOf(',');
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
      };
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }, []);

  const getNativeFilePath = useCallback((file: File): string | null => {
    const maybePath = (file as File & { path?: string }).path;
    if (typeof maybePath === 'string' && maybePath.trim()) {
      return maybePath;
    }
    return null;
  }, []);

  const saveInlineFile = useCallback(async (file: File): Promise<string | null> => {
    try {
      const dataBase64 = await fileToBase64(file);
      if (!dataBase64) {
        return null;
      }
      const result = await window.electron.dialog.saveInlineFile({
        dataBase64,
        fileName: file.name,
        mimeType: file.type,
        cwd: workingDirectory,
      });
      if (result.success && result.path) {
        return result.path;
      }
      return null;
    } catch (error) {
      console.error('Failed to save inline file:', error);
      return null;
    }
  }, [fileToBase64, workingDirectory]);

  const handleIncomingFiles = useCallback(async (fileList: FileList | File[]) => {
    if (disabled || isStreaming || isSpeechActive) return;
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;

    let hasImageWithoutVision = false;
    for (const file of files) {
      const nativePath = getNativeFilePath(file);

      // Check if this is an image file and model supports images
      const fileIsImage = nativePath
        ? isImagePath(nativePath)
        : isImageMimeType(file.type);

      if (fileIsImage) {
        if (modelSupportsImage) {
          // For images on vision-capable models, read as data URL
          if (nativePath) {
            try {
              addAttachment(nativePath, {
                isImage: true,
                mimeType: file.type || inferImageMimeTypeFromPath(nativePath),
                sizeBytes: file.size,
              });
              continue;
            } catch (error) {
              console.error('Failed to attach image file:', error);
            }
            // Fallback: add as regular file attachment
            addAttachment(nativePath);
          } else {
            const stagedPath = await saveInlineFile(file);
            if (stagedPath) {
              addAttachment(stagedPath, {
                isImage: true,
                mimeType: file.type || inferImageMimeTypeFromPath(stagedPath),
                sizeBytes: file.size,
              });
            } else {
              console.error('Failed to process clipboard image');
            }
          }
          continue;
        }
        // Model doesn't support image input — add as file path and show hint
        hasImageWithoutVision = true;
      }

      // Non-image file or model doesn't support images: use original flow
      if (nativePath) {
        addAttachment(nativePath);
        continue;
      }

      const stagedPath = await saveInlineFile(file);
      if (stagedPath) {
        addAttachment(stagedPath);
      }
    }
    if (hasImageWithoutVision) {
      setImageVisionHint(true);
    }
  }, [addAttachment, disabled, getNativeFilePath, isSpeechActive, isStreaming, modelSupportsImage, saveInlineFile]);

  const handleAddFile = useCallback(async () => {
    if (isAddingFile || disabled || isStreaming || isSpeechActive) return;
    setIsAddingFile(true);
    try {
      const result = await window.electron.dialog.selectFiles({
        title: i18nService.t('coworkAddFile'),
      });
      if (!result.success || result.paths.length === 0) return;
      let hasImageWithoutVision = false;
      for (const filePath of result.paths) {
        if (isImagePath(filePath)) {
          if (modelSupportsImage) {
            try {
              addAttachment(filePath, { isImage: true, mimeType: inferImageMimeTypeFromPath(filePath) });
              continue;
            } catch (error) {
              console.error('Failed to attach image file:', error);

            }
          } else {
            hasImageWithoutVision = true;
          }
        }
        addAttachment(filePath);
      }
      if (hasImageWithoutVision) {
        setImageVisionHint(true);

      }
    } catch (error) {
      console.error('Failed to select file:', error);
    } finally {
      setIsAddingFile(false);
    }
  }, [addAttachment, isAddingFile, disabled, isSpeechActive, isStreaming, modelSupportsImage]);

  const handleRemoveAttachment = useCallback((path: string) => {
    dispatch(setDraftAttachments({
      draftKey,
      attachments: attachments.filter((attachment) => attachment.path !== path),
    }));
  }, [attachments, dispatch, draftKey]);

  const hasFileTransfer = (dataTransfer: DataTransfer | null): boolean => {
    if (!dataTransfer) return false;
    if (dataTransfer.files.length > 0) return true;
    return Array.from(dataTransfer.types).includes('Files');
  };

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    if (!disabled && !isStreaming && !isSpeechActive) {
      setIsDraggingFiles(true);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = disabled || isStreaming || isSpeechActive ? 'none' : 'copy';
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDraggingFiles(false);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    if (disabled || isStreaming || isSpeechActive) return;
    void handleIncomingFiles(event.dataTransfer.files);
  };

  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (disabled || isStreaming || isSpeechActive) return;
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    void handleIncomingFiles(files);
  }, [disabled, handleIncomingFiles, isSpeechActive, isStreaming]);

  const canSubmit = !disabled && !isSpeechActive && !isPatchingModel && (!!value.trim() || attachments.length > 0);
  const enhancedContainerClass = isDraggingFiles
    ? `${containerClass} ring-2 ring-primary/50 border-primary/60`
    : containerClass;
  const speechButtonTitle = speechStatus === 'idle'
    ? i18nService.t('coworkSpeechStart')
    : i18nService.t('coworkSpeechStop');

  return (
    <div className="relative">
      {attachments.length > 0 && (
        <div className="mb-2 flex max-h-[136px] flex-wrap gap-2 overflow-y-auto">
          {attachments.map((attachment) => (
            <AttachmentCard
              key={attachment.path}
              attachment={attachment}
              onRemove={handleRemoveAttachment}
            />
          ))}
        </div>
      )}
      {imageVisionHint && (
        <div className="jbp-visual-warning-note mb-2 flex items-start gap-1.5 rounded-md px-2.5 py-1.5 text-xs">
          <ExclamationTriangleIcon className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          <span>
            {i18nService.getLanguage() === 'zh'
              ? '当前模型未启用图片输入，图片将以文件路径形式发送。若该模型本身支持图片理解，可在模型配置中开启图片输入选项。'
              : 'Image input is not enabled for the current model. Images will be sent as file paths. If the model supports vision, you can enable image input in the model configuration.'}
          </span>
          <button
            type="button"
            onClick={() => setImageVisionHint(false)}
            className="ml-auto flex-shrink-0 rounded-full p-0.5 hover:bg-[color-mix(in_srgb,var(--lobster-warning)_18%,transparent)]"
          >
            <XMarkIcon className="h-3 w-3" />
          </button>
        </div>
      )}
      {queueHintText && (
        <div className="mb-2 rounded-md border border-primary/20 bg-primary/5 px-2.5 py-1.5 text-xs text-primary">
          <div className="font-medium">{queueHintText}</div>
          {queuedPreviewItems.length > 0 && (
            <div className="mt-1 space-y-1 text-primary/80">
              {queuedPreviewItems.map((item, index) => (
                <div key={item.id} className="flex items-center gap-1.5 rounded bg-primary/5 px-1.5 py-1">
                  <div className="min-w-0 flex-1 truncate">
                    {i18nService.t('coworkQueuePreviewItem')
                      .replace('{index}', String(index + 1))
                      .replace('{text}', item.prompt)}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleEditQueuedInput(item)}
                    className="flex-shrink-0 rounded p-1 text-primary/70 hover:bg-primary/10 hover:text-primary"
                    title={i18nService.t('coworkQueueEdit')}
                    aria-label={i18nService.t('coworkQueueEdit')}
                  >
                    <PencilIcon className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveQueuedInput(item)}
                    className="flex-shrink-0 rounded p-1 text-primary/70 hover:bg-[color-mix(in_srgb,var(--lobster-destructive)_10%,transparent)] hover:text-[color:var(--lobster-destructive)]"
                    title={i18nService.t('coworkQueueDelete')}
                    aria-label={i18nService.t('coworkQueueDelete')}
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {queuedInputs.length > queuedPreviewItems.length && (
                <div className="text-primary/60">
                  {i18nService.t('coworkQueuePreviewMore')
                    .replace('{count}', String(queuedInputs.length - queuedPreviewItems.length))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {isMac && speechVisible && speechStatus !== 'idle' && (
        <div className="mb-2 rounded-md border border-primary/20 bg-primary/5 px-2.5 py-1.5 text-xs text-primary">
          {speechStatus === 'requesting_permission'
            ? i18nService.t('coworkSpeechRequestingPermission')
            : i18nService.t('coworkSpeechListening')}
        </div>
      )}
      <div
        className={enhancedContainerClass}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDraggingFiles && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] bg-primary/10 text-xs font-medium text-primary">
            {i18nService.t('coworkDropFileHint')}
          </div>
        )}
        {isLarge ? (
          <>
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={placeholder}
              disabled={disabled || isSpeechActive}
              rows={1}
              className={textareaClass}
              style={{ minHeight: `${minHeight}px` }}
            />
            {showSlashCommands && (
              <SlashCommandMenu matches={slashCommandMatches} onSelect={applySlashCommand} />
            )}
            <div className="flex items-center justify-between px-3 pb-3 pt-2">
              <div className="flex items-center gap-3 relative">
                {showFolderSelector && (
                  <>
                    <div className="relative group">
                      <button
                        ref={folderButtonRef as React.RefObject<HTMLButtonElement>}
                        type="button"
                        onClick={() => setShowFolderMenu(!showFolderMenu)}
                        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm text-secondary hover:bg-surface-raised hover:text-foreground transition-colors"
                      >
                        <FolderIcon className="h-4 w-4" />
                        <span className="max-w-[150px] truncate text-xs">
                          {truncatePath(workingDirectory)}
                        </span>
                      </button>
                      {/* Tooltip - hidden when folder menu is open */}
                      {!showFolderMenu && (
                        <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-3.5 py-2.5 text-[13px] leading-relaxed rounded-xl shadow-xl bg-background text-foreground border-border border opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-50 max-w-[400px] break-all whitespace-nowrap">
                          {truncatePath(workingDirectory, 120)}
                        </div>
                      )}
                    </div>
                    <FolderSelectorPopover
                      isOpen={showFolderMenu}
                      onClose={() => setShowFolderMenu(false)}
                      onSelectFolder={handleFolderSelect}
                      anchorRef={folderButtonRef as React.RefObject<HTMLElement>}
                    />
                  </>
                )}
                {showModelSelector && !remoteManaged && (
                  <div className="flex flex-col items-start gap-1">
                    <ModelSelector
                      dropdownDirection="up"
                      disabled={isPatchingModel}
                      value={coworkAgentEngine === 'openclaw'
                        ? (agentModelIsInvalid && currentSessionModelOverride
                          ? { id: '__invalid__', name: currentSessionModelOverride.split('/').pop() || currentSessionModelOverride } as Model
                          : explicitSelectedModel)
                        : undefined}
                      onChange={coworkAgentEngine === 'openclaw'
                        ? async (nextModel) => {
                          if (sessionId) {
                            if (isPatchingModel) return;
                            const nextModelRef = nextModel ? toOpenClawModelRef(nextModel) : '';
                            const previousModelOverride = currentSession?.id === sessionId
                              ? currentSession.modelOverride ?? ''
                              : '';
                            const requestId = modelPatchRequestIdRef.current + 1;
                            modelPatchRequestIdRef.current = requestId;
                            setIsPatchingModel(true);
                            dispatch(updateCurrentSessionModelOverride({ sessionId, modelOverride: nextModelRef }));
                            try {
                              const patchedSession = await coworkService.patchSession(sessionId, {
                                model: nextModelRef || null,
                              });
                              if (requestId !== modelPatchRequestIdRef.current) return;
                              if (!patchedSession) {
                                dispatch(updateCurrentSessionModelOverride({
                                  sessionId,
                                  modelOverride: previousModelOverride,
                                }));
                              } else if (currentAgent && shouldRepairCurrentAgentModel && nextModelRef) {
                                await agentService.updateAgent(currentAgent.id, { model: nextModelRef });
                              }
                            } catch {
                              if (requestId === modelPatchRequestIdRef.current) {
                                dispatch(updateCurrentSessionModelOverride({
                                  sessionId,
                                  modelOverride: previousModelOverride,
                                }));
                              }
                            } finally {
                              if (requestId === modelPatchRequestIdRef.current) {
                                setIsPatchingModel(false);
                              }
                            }
                            return;
                          }
                          if (!currentAgent) return;
                          await agentService.updateAgent(currentAgent.id, {
                              model: nextModel ? toOpenClawModelRef(nextModel) : '',
                            });
                          }
                        : undefined}
                      defaultLabel={sessionId
                        ? i18nService.t('agentDefaultModel')
                        : i18nService.t('scheduledTasksFormModelDefault')}
                    />
                    {coworkAgentEngine === 'openclaw' && agentModelIsInvalid && (
                      <span className="max-w-60 text-[11px] leading-4 text-[color:var(--lobster-destructive)]">
                        {i18nService.t('agentModelInvalidHint')}
                      </span>
                    )}
                  </div>
                )}
                {isMac && speechVisible && !remoteManaged && (
                  <button
                    type="button"
                    onClick={handleSpeechToggle}
                    className={`flex items-center justify-center p-1.5 rounded-lg text-sm transition-colors ${
                      isSpeechActive
                        ? 'text-[color:var(--lobster-destructive)] hover:bg-[color-mix(in_srgb,var(--lobster-destructive)_10%,transparent)]'
                        : 'text-secondary hover:bg-surface-raised hover:text-foreground'
                    }`}
                    title={speechButtonTitle}
                    aria-label={speechButtonTitle}
                    disabled={disabled || isStreaming}
                  >
                    {isSpeechActive ? <StopIcon className="h-4 w-4" /> : <MicrophoneIcon className="h-4 w-4" />}
                  </button>
                )}
                {!remoteManaged && (
                  <button
                    type="button"
                    onClick={handleAddFile}
                    className="flex items-center justify-center p-1.5 rounded-lg text-sm text-secondary hover:bg-surface-raised hover:text-foreground transition-colors"
                    title={i18nService.t('coworkAddFile')}
                    aria-label={i18nService.t('coworkAddFile')}
                    disabled={disabled || isStreaming || isAddingFile || isSpeechActive}
                  >
                    <PaperClipIcon className="h-4 w-4" />
                  </button>
                )}
                {!remoteManaged && (
                  <>
                    <SkillsButton
                      onSelectSkill={handleSelectSkill}
                      onManageSkills={handleManageSkills}
                    />
                    <ActiveSkillBadge />
                    <KitsButton
                      onSelectKit={handleSelectKit}
                      onManageKits={handleManageKits}
                    />
                    <ActiveKitBadge />
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                {isStreaming && !canSubmit ? (
                  <button
                    type="button"
                    onClick={handleStopClick}
                    className="jbp-visual-danger-action p-2 rounded-xl transition-all shadow-subtle hover:shadow-card active:scale-95"
                    aria-label={i18nService.t('stop')}
                  >
                    <StopIcon className="h-5 w-5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      void handleSubmit();
                    }}
                    disabled={!canSubmit}
                    title={submitTitle}
                    className="p-2 rounded-xl bg-primary hover:bg-primary-hover text-primary-foreground transition-all shadow-subtle hover:shadow-card active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label={submitTitle}
                  >
                    <PaperAirplaneIcon className="h-5 w-5" />
                  </button>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={placeholder}
              disabled={disabled || isSpeechActive}
              rows={1}
              className={textareaClass}
            />
            {showSlashCommands && (
              <SlashCommandMenu matches={slashCommandMatches} onSelect={applySlashCommand} />
            )}

            {!remoteManaged && (
              <div className="flex items-center gap-1">
                {isMac && speechVisible && (
                  <button
                    type="button"
                    onClick={handleSpeechToggle}
                    className={`flex-shrink-0 p-1.5 rounded-lg transition-colors ${
                      isSpeechActive
                        ? 'text-[color:var(--lobster-destructive)] hover:bg-[color-mix(in_srgb,var(--lobster-destructive)_10%,transparent)]'
                        : 'text-secondary hover:bg-surface-raised hover:text-foreground'
                    }`}
                    title={speechButtonTitle}
                    aria-label={speechButtonTitle}
                    disabled={disabled || isStreaming}
                  >
                    {isSpeechActive ? <StopIcon className="h-4 w-4" /> : <MicrophoneIcon className="h-4 w-4" />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleAddFile}
                  className="flex-shrink-0 p-1.5 rounded-lg text-secondary hover:bg-surface-raised hover:text-foreground transition-colors"
                  title={i18nService.t('coworkAddFile')}
                  aria-label={i18nService.t('coworkAddFile')}
                  disabled={disabled || isStreaming || isAddingFile || isSpeechActive}
                >
                  <PaperClipIcon className="h-4 w-4" />
                </button>
                <SkillsButton
                  onSelectSkill={handleSelectSkill}
                  onManageSkills={handleManageSkills}
                />
                <KitsButton
                  onSelectKit={handleSelectKit}
                  onManageKits={handleManageKits}
                />
              </div>
            )}

            {isStreaming && !canSubmit ? (
              <button
                type="button"
                onClick={handleStopClick}
                className="jbp-visual-danger-action flex-shrink-0 p-2 rounded-lg transition-all shadow-subtle hover:shadow-card active:scale-95"
                aria-label={i18nService.t('stop')}
              >
                <StopIcon className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  void handleSubmit();
                }}
                disabled={!canSubmit}
                title={submitTitle}
                className="flex-shrink-0 p-2 rounded-lg bg-primary hover:bg-primary-hover text-primary-foreground transition-all shadow-subtle hover:shadow-card active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label={submitTitle}
              >
                <PaperAirplaneIcon className="h-4 w-4" />
              </button>
            )}
          </>
        )}
      </div>
      {showFolderRequiredWarning && (
        <div className="mt-2 text-xs text-[color:var(--lobster-destructive)]">
          {i18nService.t('coworkSelectFolderFirst')}
        </div>
      )}
    </div>
  );
  }
);

CoworkPromptInput.displayName = 'CoworkPromptInput';

export default CoworkPromptInput;
