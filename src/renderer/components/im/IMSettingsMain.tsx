/**
 * IM Settings Component
 * Configuration UI for DingTalk, Feishu and Telegram IM bots
 */

import { EyeIcon, EyeSlashIcon, XCircleIcon as XCircleIconSolid } from '@heroicons/react/20/solid';
import { CheckCircleIcon, ExclamationTriangleIcon,SignalIcon, XCircleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import type { Platform } from '@shared/platform';
import { PlatformRegistry } from '@shared/platform';
import WecomAIBotSDK from '@wecom/wecom-aibot-sdk';
import { QRCodeSVG } from 'qrcode.react';
import React, { useEffect, useMemo, useRef,useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { imService } from '../../services/im';
import { NimQrLoginErrorCode, NimQrLoginStatus, pollQrLogin, startQrLogin } from '../../services/nimQrLogin';
import { RootState } from '../../store';
import { clearError, setDingTalkInstanceConfig, setDiscordConfig, setEmailInstanceConfig, setFeishuInstanceConfig, setNeteaseBeeChanConfig, setNimInstanceConfig, setPopoInstanceConfig, setQQInstanceConfig, setTelegramOpenClawConfig, setWecomInstanceConfig, setWeixinConfig } from '../../store/slices/imSlice';
import type { DiscordOpenClawConfig, EmailInstanceConfig, IMConnectivityCheck, IMConnectivityTestResult, IMGatewayConfig, NimInstanceConfig, PopoInstanceConfig, PopoOpenClawConfig,TelegramOpenClawConfig, WeixinOpenClawConfig } from '../../types/im';
import { DEFAULT_EMAIL_INSTANCE_CONFIG, DEFAULT_NIM_CONFIG, DEFAULT_POPO_CONFIG, MAX_DINGTALK_INSTANCES, MAX_EMAIL_INSTANCES, MAX_FEISHU_INSTANCES, MAX_NIM_INSTANCES, MAX_POPO_INSTANCES, MAX_QQ_INSTANCES, MAX_WECOM_INSTANCES } from '../../types/im';
import { getVisibleIMPlatforms } from '../../utils/regionFilter';
import Modal from '../common/Modal';
import DingTalkInstanceSettings from './DingTalkInstanceSettings';
import FeishuInstanceSettings from './FeishuInstanceSettings';
import { nimFallbackInstanceSchema, nimFallbackUiHints } from './nimSchemaFallback';
import QQInstanceSettings from './QQInstanceSettings';
import type { UiHint } from './SchemaForm';
import { SchemaForm } from './SchemaForm';
import WecomInstanceSettings from './WecomInstanceSettings';



// Reusable guide card component for platform setup instructions
const PlatformGuide: React.FC<{
  title?: string;
  steps: string[];
  guideUrl?: string;
  guideLabel?: string;
}> = ({ title, steps, guideUrl, guideLabel }) => (
  <div className="mb-3 p-3 rounded-lg border border-dashed border-border-subtle">
    {title && (
      <p className="text-xs text-foreground leading-relaxed mb-1.5 font-medium">{title}</p>
    )}
    <ol className="text-xs text-secondary space-y-1 list-decimal list-inside">
      {steps.map((step, i) => (
        <li key={i}>{step}</li>
      ))}
    </ol>
    {guideUrl && (
      <button
        type="button"
        onClick={() => {
          window.electron.shell.openExternal(guideUrl).catch((err: unknown) => {
            console.error('[IM] Failed to open guide URL:', err);
          });
        }}
        className="mt-2 text-xs font-medium text-primary dark:text-primary hover:text-primary dark:hover:text-blue-200 underline underline-offset-2 transition-colors"
      >
        {guideLabel || i18nService.t('imViewGuide')}
      </button>
    )}
  </div>
);

type InstanceListItem = {
  instanceId: string;
  instanceName: string;
  enabled: boolean;
  detail?: string;
};

const InlineInstanceList: React.FC<{
  title: string;
  hint: string;
  primaryTag: string;
  emptyText: string;
  addLabel: string;
  maxInstances: number;
  instances: readonly InstanceListItem[];
  activeInstanceId: string | null;
  onSelect: (instanceId: string) => void;
  onAdd: () => void;
  onRename: (instanceId: string, name: string) => void;
  onDelete: (instanceId: string) => void;
}> = ({
  title,
  hint,
  primaryTag,
  emptyText,
  addLabel,
  maxInstances,
  instances,
  activeInstanceId,
  onSelect,
  onAdd,
  onRename,
  onDelete,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameValue, setNameValue] = useState('');

  const commitRename = (instance: InstanceListItem) => {
    const trimmed = nameValue.trim();
    setEditingId(null);
    if (trimmed && trimmed !== instance.instanceName) {
      onRename(instance.instanceId, trimmed);
    }
  };

  return (
    <div className="rounded-lg border border-border-subtle bg-surface-raised/40 p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-foreground">{title}</div>
          <div className="text-[11px] text-secondary">{hint}</div>
        </div>
        {instances.length < maxInstances && (
          <button
            type="button"
            onClick={onAdd}
            className="shrink-0 rounded-lg bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/20 transition-colors"
          >
            + {addLabel}
          </button>
        )}
      </div>

      {instances.length === 0 ? (
        <div className="rounded-md bg-surface px-2.5 py-2 text-xs text-secondary">{emptyText}</div>
      ) : (
        <div className="space-y-1.5">
          {instances.map((instance, index) => {
            const selected = activeInstanceId === instance.instanceId || (!activeInstanceId && index === 0);
            return (
              <div
                key={instance.instanceId}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(instance.instanceId)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(instance.instanceId);
                  }
                }}
                className={`flex items-center justify-between gap-3 rounded-md px-2.5 py-2 transition-colors ${
                  selected ? 'bg-primary/10 text-primary' : 'bg-surface text-foreground hover:bg-surface-raised'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {editingId === instance.instanceId ? (
                      <input
                        type="text"
                        value={nameValue}
                        onChange={(event) => setNameValue(event.target.value)}
                        onBlur={() => commitRename(instance)}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitRename(instance);
                          if (event.key === 'Escape') {
                            setEditingId(null);
                            setNameValue(instance.instanceName);
                          }
                        }}
                        autoFocus
                        className="min-w-0 flex-1 border-b border-primary bg-transparent text-xs font-medium text-foreground outline-none"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelect(instance.instanceId);
                          setEditingId(instance.instanceId);
                          setNameValue(instance.instanceName);
                        }}
                        className="truncate border-b border-dashed border-transparent text-left text-xs font-medium hover:border-primary"
                        title={i18nService.t('renameConversation')}
                      >
                        {instance.instanceName}
                      </button>
                    )}
                    {index === 0 && (
                      <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        {primaryTag}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-secondary">
                    {instance.detail || instance.instanceId}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    instance.enabled ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-gray-500/10 text-gray-500'
                  }`}>
                    {instance.enabled ? i18nService.t('enabled') : i18nService.t('disabled')}
                  </span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(instance.instanceId);
                    }}
                    className="rounded p-0.5 text-secondary hover:bg-red-500/10 hover:text-red-500 transition-colors"
                    title={i18nService.t('scheduledTasksDelete')}
                  >
                    <XMarkIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const NimInstanceSummary: React.FC<{ instances: readonly NimInstanceConfig[] }> = ({ instances }) => {
  if (instances.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-border-subtle bg-surface-raised/40 p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold text-foreground">
          {i18nService.t('nimInstancesTitle')}
        </div>
        <span className="text-[11px] text-secondary">
          {i18nService.t('nimInstancesPrimaryHint')}
        </span>
      </div>
      <div className="space-y-1.5">
        {instances.map((instance, index) => (
          <div
            key={instance.instanceId}
            className="flex items-center justify-between gap-3 rounded-md bg-surface px-2.5 py-2"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-xs font-medium text-foreground">
                  {instance.instanceName || `NIM Bot ${index + 1}`}
                </span>
                {index === 0 && (
                  <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    {i18nService.t('nimInstancesPrimaryTag')}
                  </span>
                )}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-secondary">
                {instance.account || instance.appKey || instance.instanceId}
              </div>
            </div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              instance.enabled ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-gray-500/10 text-gray-500'
            }`}>
              {instance.enabled ? i18nService.t('enabled') : i18nService.t('disabled')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

const PopoInstanceSummary: React.FC<{ instances: readonly PopoInstanceConfig[] }> = ({ instances }) => {
  if (instances.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-border-subtle bg-surface-raised/40 p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold text-foreground">
          {i18nService.t('popoInstancesTitle')}
        </div>
        <span className="text-[11px] text-secondary">
          {i18nService.t('popoInstancesPrimaryHint')}
        </span>
      </div>
      <div className="space-y-1.5">
        {instances.map((instance, index) => (
          <div
            key={instance.instanceId}
            className="flex items-center justify-between gap-3 rounded-md bg-surface px-2.5 py-2"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-xs font-medium text-foreground">
                  {instance.instanceName || `POPO Bot ${index + 1}`}
                </span>
                {index === 0 && (
                  <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    {i18nService.t('popoInstancesPrimaryTag')}
                  </span>
                )}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-secondary">
                {instance.appKey || instance.instanceId}
              </div>
            </div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              instance.enabled ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-gray-500/10 text-gray-500'
            }`}>
              {instance.enabled ? i18nService.t('enabled') : i18nService.t('disabled')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

const verdictColorClass: Record<IMConnectivityTestResult['verdict'], string> = {
  pass: 'bg-green-500/15 text-green-600 dark:text-green-400',
  warn: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-300',
  fail: 'bg-red-500/15 text-red-600 dark:text-red-400',
};

const checkLevelColorClass: Record<IMConnectivityCheck['level'], string> = {
  pass: 'text-green-600 dark:text-green-400',
  info: 'text-sky-600 dark:text-sky-400',
  warn: 'text-yellow-700 dark:text-yellow-300',
  fail: 'text-red-600 dark:text-red-400',
};

// Map of backend error messages to i18n keys
const errorMessageI18nMap: Record<string, string> = {
  '账号已在其它地方登录': 'kickedByOtherClient',
};

// Helper function to translate IM error messages
function translateIMError(error: string | null): string {
  if (!error) return '';
  const i18nKey = errorMessageI18nMap[error];
  if (i18nKey) {
    return i18nService.t(i18nKey);
  }
  return error;
}

// Helper function to deep-set a value in nested object by dot path
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function deepSet(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const keys = path.split('.');
  if (keys.some((key) => UNSAFE_OBJECT_KEYS.has(key))) {
    return obj;
  }
  const result = { ...obj };
  let current: Record<string, unknown> = result;
  for (let i = 0; i < keys.length - 1; i++) {
    const nextValue = current[keys[i]];
    const nextObject = nextValue && typeof nextValue === 'object' && !Array.isArray(nextValue)
      ? nextValue as Record<string, unknown>
      : {};
    current[keys[i]] = { ...nextObject };
    current = current[keys[i]] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
  return result;
}

const IMSettings: React.FC = () => {
  const dispatch = useDispatch();
  const { config, status, isLoading } = useSelector((state: RootState) => state.im);
  const [activePlatform, setActivePlatform] = useState<Platform>('weixin');
  const [activeQQInstanceId, setActiveQQInstanceId] = useState<string | null>(null);
  const [qqExpanded, setQqExpanded] = useState(false);
  const [activeFeishuInstanceId, setActiveFeishuInstanceId] = useState<string | null>(null);
  const [feishuExpanded, setFeishuExpanded] = useState(false);
  const [activeDingTalkInstanceId, setActiveDingTalkInstanceId] = useState<string | null>(null);
  const [dingtalkExpanded, setDingtalkExpanded] = useState(false);
  const [activeNimInstanceId, setActiveNimInstanceId] = useState<string | null>(null);
  const [nimExpanded, setNimExpanded] = useState(false);
  const [activePopoInstanceId, setActivePopoInstanceId] = useState<string | null>(null);
  const [popoExpanded, setPopoExpanded] = useState(false);
  const [activeWecomInstanceId, setActiveWecomInstanceId] = useState<string | null>(null);
  const [wecomExpanded, setWecomExpanded] = useState(false);
  const [activeEmailInstanceId, setActiveEmailInstanceId] = useState<string | null>(null);
  const [emailExpanded, setEmailExpanded] = useState(false);
  const [testingPlatform, setTestingPlatform] = useState<Platform | null>(null);
  const [connectivityResults, setConnectivityResults] = useState<Partial<Record<Platform, IMConnectivityTestResult>>>({});
  const [connectivityModalPlatform, setConnectivityModalPlatform] = useState<Platform | null>(null);
  const [language, setLanguage] = useState<'zh' | 'en'>(i18nService.getLanguage());
  const [allowedUserIdInput, setAllowedUserIdInput] = useState('');
  const [configLoaded, setConfigLoaded] = useState(false);
  // Re-entrancy guard for gateway toggle to prevent rapid ON→OFF→ON
  const [togglingPlatform, setTogglingPlatform] = useState<Platform | null>(null);
  // Track visibility of password fields (eye toggle)
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  // WeCom quick setup state
  const [wecomQuickSetupStatus, setWecomQuickSetupStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [wecomQuickSetupError, setWecomQuickSetupError] = useState<string>('');
  // Weixin QR login state
  const [weixinQrStatus, setWeixinQrStatus] = useState<'idle' | 'loading' | 'showing' | 'waiting' | 'success' | 'error'>('idle');
  const [weixinQrUrl, setWeixinQrUrl] = useState<string>('');
  const [weixinQrError, setWeixinQrError] = useState<string>('');
  const [weixinAllowedUserIdInput, setWeixinAllowedUserIdInput] = useState('');
  const weixinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // POPO QR login state
  const [popoQrStatus, setPopoQrStatus] = useState<'idle' | 'loading' | 'showing' | 'waiting' | 'success' | 'error'>('idle');
  const [popoQrUrl, setPopoQrUrl] = useState<string>('');
  const [popoQrError, setPopoQrError] = useState<string>('');
  const popoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // NIM QR login state
  const [nimQrStatus, setNimQrStatus] = useState<'idle' | 'loading' | 'showing' | 'success' | 'error'>('idle');
  const [nimQrValue, setNimQrValue] = useState<string>('');
  const [nimQrError, setNimQrError] = useState<string>('');
  const [nimQrTimeLeft, setNimQrTimeLeft] = useState<number>(0);
  const nimPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nimCountdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nimActiveUuidRef = useRef<string>('');
  const [localIp, setLocalIp] = useState<string>('');
  const isMountedRef = useRef(true);

  const clearNimQrTimers = () => {
    if (nimPollTimerRef.current) {
      clearInterval(nimPollTimerRef.current);
      nimPollTimerRef.current = null;
    }
    if (nimCountdownTimerRef.current) {
      clearInterval(nimCountdownTimerRef.current);
      nimCountdownTimerRef.current = null;
    }
  };

  // OpenClaw config schema for schema-driven forms
  const [openclawSchema, setOpenclawSchema] = useState<{ schema: Record<string, unknown>; uiHints: Record<string, Record<string, unknown>> } | null>(null);

  // Subscribe to language changes
  useEffect(() => {
    const unsubscribe = i18nService.subscribe(() => {
      setLanguage(i18nService.getLanguage());
    });
    return unsubscribe;
  }, []);

  // Track component mounted state for async operations
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearNimQrTimers();
    };
  }, []);

  // Fetch local IP for POPO webhook placeholder
  useEffect(() => {
    window.electron?.im?.getLocalIp?.().then((ip: string) => {
      if (isMountedRef.current) setLocalIp(ip);
    }).catch(() => {});
  }, []);

  // Reset wecom quick setup state when switching away from wecom
  useEffect(() => {
    if (activePlatform !== 'wecom') {
      setWecomQuickSetupStatus('idle');
      setWecomQuickSetupError('');
    }
  }, [activePlatform]);

  // Reset weixin QR login state when switching away from weixin
  useEffect(() => {
    if (activePlatform !== 'weixin') {
      if (weixinTimerRef.current) { clearTimeout(weixinTimerRef.current); weixinTimerRef.current = null; }
      setWeixinQrStatus('idle');
      setWeixinQrUrl('');
      setWeixinQrError('');
    }
  }, [activePlatform]);

  // Reset popo QR login state when switching away from popo
  useEffect(() => {
    if (activePlatform !== 'popo') {
      if (popoTimerRef.current) { clearTimeout(popoTimerRef.current); popoTimerRef.current = null; }
      setPopoQrStatus('idle');
      setPopoQrUrl('');
      setPopoQrError('');
    }
  }, [activePlatform]);

  // Reset NIM QR login state when switching away from nim
  useEffect(() => {
    if (activePlatform !== 'nim') {
      clearNimQrTimers();
      nimActiveUuidRef.current = '';
      setNimQrStatus('idle');
      setNimQrValue('');
      setNimQrError('');
      setNimQrTimeLeft(0);
    }
  }, [activePlatform]);

  // Reset password visibility when switching platforms
  useEffect(() => {
    setShowSecrets({});
  }, [activePlatform]);

  // Initialize IM service and subscribe status updates
  useEffect(() => {
    let cancelled = false;
    void imService.init().then(() => {
      if (!cancelled) {
        setConfigLoaded(true);
        // Fetch OpenClaw config schema for schema-driven rendering
        imService.getOpenClawConfigSchema().then(schema => {
          if (schema && isMountedRef.current) setOpenclawSchema(schema);
        });
      }
    });
    return () => {
      cancelled = true;
      setConfigLoaded(false);
      imService.destroy();
    };
  }, []);

  // Extract NIM channel schema and hints from the full OpenClaw config schema
  const nimSchemaData = useMemo(() => {
    if (!openclawSchema) {
      return { schema: nimFallbackInstanceSchema, hints: nimFallbackUiHints };
    }
    const { schema, uiHints } = openclawSchema;

    // Find the NIM channel key — could be 'nim' or 'openclaw-nim'
    const rootProperties = (schema.properties ?? {}) as Record<string, unknown>;
    const channelsSchema = rootProperties.channels as { properties?: Record<string, unknown> } | undefined;
    const channelsProps = channelsSchema?.properties ?? {};
    const channelKey = channelsProps['openclaw-nim'] ? 'openclaw-nim' : channelsProps['nim'] ? 'nim' : null;
    if (!channelKey) {
      return { schema: nimFallbackInstanceSchema, hints: nimFallbackUiHints };
    }

    const channelSchema = channelsProps[channelKey] as { properties?: Record<string, unknown> } | undefined;
    const channelProperties = channelSchema?.properties;
    const accountsSchema = channelProperties?.accounts as { additionalProperties?: Record<string, unknown> } | undefined;
    const instancesSchema = channelProperties?.instances as { items?: Record<string, unknown> } | undefined;
    const instanceSchema =
      accountsSchema?.additionalProperties
      || instancesSchema?.items;
    if (!instanceSchema) {
      return { schema: nimFallbackInstanceSchema, hints: nimFallbackUiHints };
    }

    const hints: Record<string, UiHint> = {};
    const accountHintPrefix = `channels.${channelKey}.accounts.`;
    const instanceHintPrefix = `channels.${channelKey}.instances.items.`;
    const directHintPrefix = `channels.${channelKey}.`;
    for (const [key, value] of Object.entries(uiHints)) {
      let relativeKey: string | null = null;
      if (key.startsWith(accountHintPrefix)) {
        relativeKey = key.slice(accountHintPrefix.length);
      } else if (key.startsWith(instanceHintPrefix)) {
        relativeKey = key.slice(instanceHintPrefix.length);
      } else if (key.startsWith(directHintPrefix)) {
        const directKey = key.slice(directHintPrefix.length);
        if (!directKey.startsWith('accounts.') && !directKey.startsWith('instances.')) {
          relativeKey = directKey;
        }
      }
      if (!relativeKey || relativeKey === 'nimToken') {
        continue;
      }
      const nextHint = { ...(value as unknown as UiHint) };
      if (nextHint.order === undefined) {
        nextHint.order = Object.keys(hints).length + 1;
      }
      hints[relativeKey] = nextHint;
    }

    return {
      schema: instanceSchema,
      hints: Object.keys(hints).length > 0 ? hints : nimFallbackUiHints,
    };
  }, [openclawSchema]);

  // Handle DingTalk multi-instance config
  const dingtalkMultiConfig = config.dingtalk;

  // Handle Feishu multi-instance config
  const feishuMultiConfig = config.feishu;

  // Pairing state for OpenClaw platforms
  const [pairingCodeInput, setPairingCodeInput] = useState<Record<string, string>>({});
  const [pairingStatus, setPairingStatus] = useState<Record<string, { type: 'success' | 'error'; message: string } | null>>({});

  const handleApprovePairing = async (platform: string, code: string) => {
    setPairingStatus((prev) => ({ ...prev, [platform]: null }));
    const result = await imService.approvePairingCode(platform, code);
    if (result.success) {
      setPairingStatus((prev) => ({ ...prev, [platform]: { type: 'success', message: i18nService.t('imPairingCodeApproved').replace('{code}', code) } }));
    } else {
      setPairingStatus((prev) => ({ ...prev, [platform]: { type: 'error', message: result.error || i18nService.t('imPairingCodeInvalid') } }));
    }
  };
  // Handle Telegram OpenClaw config change
  const tgOpenClawConfig = config.telegram;
  const handleTelegramOpenClawChange = (update: Partial<TelegramOpenClawConfig>) => {
    dispatch(setTelegramOpenClawConfig(update));
  };
  const handleSaveTelegramOpenClawConfig = async (override?: Partial<TelegramOpenClawConfig>) => {
    if (!configLoaded) return;
    const configToSave = override
      ? { ...tgOpenClawConfig, ...override }
      : tgOpenClawConfig;
    await imService.persistConfig({ telegram: configToSave });
  };

  const qqMultiConfig = config.qq;

  // Handle Discord OpenClaw config change
  const dcOpenClawConfig = config.discord;
  const handleDiscordOpenClawChange = (update: Partial<DiscordOpenClawConfig>) => {
    dispatch(setDiscordConfig(update));
  };
  const handleSaveDiscordOpenClawConfig = async (override?: Partial<DiscordOpenClawConfig>) => {
    if (!configLoaded) return;
    const configToSave = override
      ? { ...dcOpenClawConfig, ...override }
      : dcOpenClawConfig;
    await imService.persistConfig({ discord: configToSave });
  };

  // State for Discord allow-from inputs
  const [discordAllowedUserIdInput, setDiscordAllowedUserIdInput] = useState('');
  const [discordServerAllowIdInput, setDiscordServerAllowIdInput] = useState('');

  // State for POPO allow-from inputs
  const [popoAllowedUserIdInput, setPopoAllowedUserIdInput] = useState('');
  const [popoGroupAllowIdInput, setPopoGroupAllowIdInput] = useState('');

  const nimInstances = config.nim.instances;
  useEffect(() => {
    if (nimInstances.length > 0 && !nimInstances.some((instance) => instance.instanceId === activeNimInstanceId)) {
      setActiveNimInstanceId(nimInstances[0].instanceId);
    }
  }, [activeNimInstanceId, nimInstances]);
  const activeNimInstance = (
    nimInstances.find((instance) => instance.instanceId === activeNimInstanceId)
    ?? nimInstances[0]
  ) as NimInstanceConfig | undefined;
  const nimConfig: NimInstanceConfig = activeNimInstance ?? {
    ...DEFAULT_NIM_CONFIG,
    instanceId: 'nim-draft',
    instanceName: 'NIM Bot 1',
  };

  const popoInstances = config.popo.instances;
  useEffect(() => {
    if (popoInstances.length > 0 && !popoInstances.some((instance) => instance.instanceId === activePopoInstanceId)) {
      setActivePopoInstanceId(popoInstances[0].instanceId);
    }
  }, [activePopoInstanceId, popoInstances]);
  const activePopoInstance = (
    popoInstances.find((instance) => instance.instanceId === activePopoInstanceId)
    ?? popoInstances[0]
  ) as PopoInstanceConfig | undefined;
  const popoConfig: PopoInstanceConfig = activePopoInstance ?? {
    ...DEFAULT_POPO_CONFIG,
    instanceId: 'popo-draft',
    instanceName: 'POPO Bot 1',
  };

  const emailInstances = config.email.instances;
  useEffect(() => {
    if (emailInstances.length > 0 && !emailInstances.some((instance) => instance.instanceId === activeEmailInstanceId)) {
      setActiveEmailInstanceId(emailInstances[0].instanceId);
    }
  }, [activeEmailInstanceId, emailInstances]);
  const activeEmailInstance = (
    emailInstances.find((instance) => instance.instanceId === activeEmailInstanceId)
    ?? emailInstances[0]
  ) as EmailInstanceConfig | undefined;
  const emailConfig: EmailInstanceConfig = activeEmailInstance ?? {
    ...DEFAULT_EMAIL_INSTANCE_CONFIG,
    instanceId: 'email-draft',
    instanceName: 'Email Bot 1',
    email: '',
    agentId: 'main',
    enabled: false,
    transport: 'ws',
  };


  // Handle NetEase Bee config change
  const handleNeteaseBeeChanChange = (field: 'clientId' | 'secret', value: string) => {
    dispatch(setNeteaseBeeChanConfig({ [field]: value }));
  };

  // Handle Weixin OpenClaw config
  const weixinOpenClawConfig = config.weixin;
  const weixinRuntimeAccountId = status.weixin?.accountId || '';
  const weixinAccountId = weixinOpenClawConfig.accountId || weixinRuntimeAccountId;
  const handleWeixinChange = (update: Partial<WeixinOpenClawConfig>) => {
    dispatch(setWeixinConfig(update));
  };
  const handleSaveWeixinConfig = async (override?: Partial<WeixinOpenClawConfig>) => {
    if (!configLoaded) return;
    const configToSave = override
      ? { ...weixinOpenClawConfig, ...override }
      : weixinOpenClawConfig;
    await imService.persistConfig({ weixin: configToSave });
  };
  const persistConnectedWeixinConfig = async (accountId: string) => {
    const nextConfig = { ...weixinOpenClawConfig, enabled: true, accountId };
    dispatch(setWeixinConfig({ enabled: true, accountId }));
    dispatch(clearError());
    await imService.persistConfig({ weixin: nextConfig });
    await imService.loadStatus();
  };

  const ensurePrimaryNimInstance = async (): Promise<NimInstanceConfig | null> => {
    if (activeNimInstance) return activeNimInstance;
    if (nimInstances.length >= MAX_NIM_INSTANCES) return null;
    const instance = await imService.addNimInstance(`NIM Bot ${nimInstances.length + 1}`);
    if (instance) {
      setActiveNimInstanceId(instance.instanceId);
      setNimExpanded(true);
    }
    return instance;
  };

  const ensurePrimaryPopoInstance = async (): Promise<PopoInstanceConfig | null> => {
    if (activePopoInstance) return activePopoInstance;
    if (popoInstances.length >= MAX_POPO_INSTANCES) return null;
    const instance = await imService.addPopoInstance(`POPO Bot ${popoInstances.length + 1}`);
    if (instance) {
      setActivePopoInstanceId(instance.instanceId);
      setPopoExpanded(true);
    }
    return instance;
  };

  // Handle POPO OpenClaw config change
  const handlePopoChange = (update: Partial<PopoOpenClawConfig>) => {
    dispatch(setPopoInstanceConfig({ instanceId: popoConfig.instanceId, config: update }));
  };
  const handleSavePopoConfig = async (override?: Partial<PopoOpenClawConfig>) => {
    if (!configLoaded) return;
    const targetInstance = await ensurePrimaryPopoInstance();
    if (!targetInstance) return;
    const configToSave = override
      ? { ...targetInstance, ...override }
      : { ...targetInstance, ...popoConfig };
    await imService.persistPopoInstanceConfig(targetInstance.instanceId, configToSave);
  };

  const ensurePrimaryEmailInstance = async (): Promise<EmailInstanceConfig | null> => {
    if (activeEmailInstance) return activeEmailInstance;
    if (emailInstances.length >= MAX_EMAIL_INSTANCES) return null;
    const instance = await imService.addEmailInstance(`Email Bot ${emailInstances.length + 1}`);
    if (instance) {
      setActiveEmailInstanceId(instance.instanceId);
      setEmailExpanded(true);
    }
    return instance;
  };

  const handleEmailChange = (update: Partial<EmailInstanceConfig>) => {
    dispatch(setEmailInstanceConfig({ instanceId: emailConfig.instanceId, config: update }));
  };

  const handleSaveEmailConfig = async (override?: Partial<EmailInstanceConfig>) => {
    if (!configLoaded) return;
    const targetInstance = await ensurePrimaryEmailInstance();
    if (!targetInstance) return;
    const configToSave = override
      ? { ...targetInstance, ...override }
      : { ...targetInstance, ...emailConfig };
    await imService.persistEmailInstanceConfig(targetInstance.instanceId, configToSave);
  };

  const handleWeixinQrLogin = async () => {
    setWeixinQrStatus('loading');
    setWeixinQrError('');
    try {
      const startResult = await window.electron.im.weixinQrLoginStart();
      if (!isMountedRef.current) return;

      if (!startResult.success || !startResult.qrDataUrl) {
        setWeixinQrStatus('error');
        setWeixinQrError(startResult.message || i18nService.t('imWeixinQrFailed'));
        return;
      }

      setWeixinQrUrl(startResult.qrDataUrl);
      setWeixinQrStatus('showing');
      if (!startResult.sessionKey) {
        setWeixinQrStatus('error');
        setWeixinQrError(i18nService.t('imWeixinQrFailed'));
        return;
      }

      // QR expires in ~2 minutes. Show error and let user retry.
      if (weixinTimerRef.current) clearTimeout(weixinTimerRef.current);
      weixinTimerRef.current = setTimeout(() => {
        if (!isMountedRef.current) return;
        setWeixinQrStatus('error');
        setWeixinQrError(i18nService.t('imWeixinQrExpired'));
      }, 120000);

      // Start polling for scan result
      setWeixinQrStatus('waiting');
      const waitResult = await window.electron.im.weixinQrLoginWait(startResult.sessionKey);
      if (weixinTimerRef.current) { clearTimeout(weixinTimerRef.current); weixinTimerRef.current = null; }
      if (!isMountedRef.current) return;

      if (waitResult.success && (waitResult.connected || waitResult.alreadyConnected)) {
        const accountId = waitResult.accountId || weixinAccountId;
        if (!accountId) {
          setWeixinQrStatus('error');
          setWeixinQrError(i18nService.t('imWeixinQrAccountMissing'));
          return;
        }

        setWeixinQrStatus('success');
        await persistConnectedWeixinConfig(accountId);
      } else {
        setWeixinQrStatus('error');
        setWeixinQrError(waitResult.message || i18nService.t('imWeixinQrFailed'));
      }
    } catch (err) {
      if (weixinTimerRef.current) { clearTimeout(weixinTimerRef.current); weixinTimerRef.current = null; }
      if (!isMountedRef.current) return;
      setWeixinQrStatus('error');
      setWeixinQrError(String(err));
    }
  };

  const handlePopoQrLogin = async () => {
    setPopoQrStatus('loading');
    setPopoQrError('');
    try {
      const startResult = await window.electron.im.popoQrLoginStart();
      if (!isMountedRef.current) return;

      if (!startResult.success || !startResult.qrUrl) {
        setPopoQrStatus('error');
        setPopoQrError(startResult.message || i18nService.t('imPopoQrFailed'));
        return;
      }

      setPopoQrUrl(startResult.qrUrl);
      setPopoQrStatus('showing');

      // QR expires in ~10 minutes
      if (popoTimerRef.current) clearTimeout(popoTimerRef.current);
      popoTimerRef.current = setTimeout(() => {
        if (!isMountedRef.current) return;
        setPopoQrStatus('error');
        setPopoQrError(i18nService.t('imPopoQrExpired'));
      }, startResult.timeoutMs || 600000);

      // Start polling for scan result
      setPopoQrStatus('waiting');
      const pollResult = await window.electron.im.popoQrLoginPoll(startResult.taskToken!);
      if (popoTimerRef.current) { clearTimeout(popoTimerRef.current); popoTimerRef.current = null; }
      if (!isMountedRef.current) return;

      if (pollResult.success && pollResult.appKey && pollResult.appSecret && pollResult.aesKey) {
        setPopoQrStatus('success');
        // Auto-fill credentials and enable
        const update: Partial<PopoOpenClawConfig> = {
          appKey: pollResult.appKey,
          appSecret: pollResult.appSecret,
          aesKey: pollResult.aesKey,
          connectionMode: 'websocket',
          enabled: true,
        };
        const targetInstance = await ensurePrimaryPopoInstance();
        if (!targetInstance) return;
        dispatch(setPopoInstanceConfig({ instanceId: targetInstance.instanceId, config: update }));
        dispatch(clearError());
        // Persist to DB with gateway sync so openclaw.json gets updated and gateway restarts
        await imService.updatePopoInstanceConfig(targetInstance.instanceId, { ...targetInstance, ...update });
        // Explicitly trigger config sync to ensure openclaw.json is written immediately
        await window.electron.im.syncConfig();
        await imService.loadStatus();
      } else {
        setPopoQrStatus('error');
        setPopoQrError(pollResult.message || i18nService.t('imPopoQrFailed'));
      }
    } catch (err) {
      if (popoTimerRef.current) { clearTimeout(popoTimerRef.current); popoTimerRef.current = null; }
      if (!isMountedRef.current) return;
      setPopoQrStatus('error');
      setPopoQrError(String(err));
    }
  };

  const mapNimQrErrorToMessage = (errorCode?: string, fallback?: string) => {
    if (errorCode === NimQrLoginErrorCode.InvalidUserAgent) {
      return i18nService.t('imNimQrUnsupported');
    }
    if (errorCode === NimQrLoginErrorCode.Timeout) {
      return i18nService.t('imNimQrExpired');
    }
    if (fallback) {
      if (errorCode === NimQrLoginErrorCode.RequestFailed) {
        return i18nService.t('imNimQrFailedWithCode').replace('{code}', fallback);
      }
      return fallback;
    }
    return i18nService.t('imNimQrFailed');
  };

  const resetNimQrState = () => {
    clearNimQrTimers();
    nimActiveUuidRef.current = '';
    setNimQrStatus('idle');
    setNimQrValue('');
    setNimQrError('');
    setNimQrTimeLeft(0);
  };

  const handleNimQrLogin = async () => {
    resetNimQrState();
    setNimQrStatus('loading');
    try {
      const startResult = await startQrLogin();
      if (!isMountedRef.current) return;

      nimActiveUuidRef.current = startResult.uuid;
      setNimQrValue(startResult.qrValue);
      setNimQrTimeLeft(startResult.expiresIn);
      setNimQrStatus('showing');

      nimCountdownTimerRef.current = setInterval(() => {
        setNimQrTimeLeft((prev) => {
          if (prev <= 1) {
            clearNimQrTimers();
            nimActiveUuidRef.current = '';
            setNimQrStatus('error');
            setNimQrError(i18nService.t('imNimQrExpired'));
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      nimPollTimerRef.current = setInterval(async () => {
        const currentUuid = nimActiveUuidRef.current;
        if (!currentUuid) return;
        const pollResult = await pollQrLogin(currentUuid);
        if (!isMountedRef.current || nimActiveUuidRef.current !== currentUuid) {
          return;
        }
        if (pollResult.status === NimQrLoginStatus.Pending) {
          return;
        }

        clearNimQrTimers();
        nimActiveUuidRef.current = '';
        if (pollResult.status === NimQrLoginStatus.Success && pollResult.credentials) {
          const update = {
            appKey: pollResult.credentials.appKey,
            account: pollResult.credentials.account,
            token: pollResult.credentials.token,
            enabled: true,
          };
          dispatch(clearError());
          const targetInstance = await ensurePrimaryNimInstance();
          if (!targetInstance) return;
          dispatch(setNimInstanceConfig({ instanceId: targetInstance.instanceId, config: update }));
          await imService.updateNimInstanceConfig(targetInstance.instanceId, { ...targetInstance, ...update });
          await imService.loadStatus();
          if (!isMountedRef.current) return;
          setNimQrStatus('success');
          setNimQrError('');
          return;
        }

        setNimQrStatus('error');
        setNimQrError(mapNimQrErrorToMessage(pollResult.errorCode, pollResult.error));
      }, startResult.pollInterval);
    } catch (err) {
      clearNimQrTimers();
      nimActiveUuidRef.current = '';
      if (!isMountedRef.current) return;
      setNimQrStatus('error');
      setNimQrError(mapNimQrErrorToMessage(undefined, err instanceof Error ? err.message : String(err)));
    }
  };


  const handleSaveConfig = async () => {
    if (!configLoaded) return;

    // For Telegram, save telegram config directly
    if (activePlatform === 'telegram') {
      await imService.persistConfig({ telegram: tgOpenClawConfig });
      return;
    }

    // For Discord, save discord config directly
    if (activePlatform === 'discord') {
      await imService.persistConfig({ discord: dcOpenClawConfig });
      return;
    }

    // For Feishu, save feishu config directly
    if (activePlatform === 'feishu') {
      await imService.persistConfig({ feishu: feishuMultiConfig });
      return;
    }

    // For QQ, save qq config directly (OpenClaw mode)
    if (activePlatform === 'qq') {
      await imService.persistConfig({ qq: qqMultiConfig });
      return;
    }

    // For WeCom, save is handled per-instance in WecomInstanceSettings
    if (activePlatform === 'wecom') {
      await imService.persistConfig({ wecom: config.wecom });
      return;
    }

    // For Weixin, save weixin config directly (OpenClaw mode)
    if (activePlatform === 'weixin') {
      await imService.persistConfig({ weixin: weixinOpenClawConfig });
      return;
    }

    // For POPO, save popo config directly (OpenClaw mode)
    if (activePlatform === 'popo') {
      await handleSavePopoConfig();
      return;
    }

    // For NIM, save active instance config directly (OpenClaw mode)
    if (activePlatform === 'nim') {
      const targetInstance = await ensurePrimaryNimInstance();
      if (targetInstance) {
        await imService.persistNimInstanceConfig(targetInstance.instanceId, { ...targetInstance, ...nimConfig });
      }
      return;
    }

    if (activePlatform === 'email') {
      await handleSaveEmailConfig();
      return;
    }

    await imService.persistConfig({ [activePlatform]: config[activePlatform] });
  };



  const getCheckTitle = (code: IMConnectivityCheck['code']): string => {
    return i18nService.t(`imConnectivityCheckTitle_${code}`);
  };

  const getCheckSuggestion = (check: IMConnectivityCheck): string | undefined => {
    if (check.suggestion) {
      return check.suggestion;
    }
    if (check.code === 'gateway_running' && check.level === 'pass') {
      return undefined;
    }
    const suggestion = i18nService.t(`imConnectivityCheckSuggestion_${check.code}`);
    if (suggestion.startsWith('imConnectivityCheckSuggestion_')) {
      return undefined;
    }
    return suggestion;
  };

  const formatTestTime = (timestamp: number): string => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return String(timestamp);
    }
  };

  const runConnectivityTest = async (
    platform: Platform,
    configOverride?: Partial<IMGatewayConfig>
  ): Promise<IMConnectivityTestResult | null> => {
    setTestingPlatform(platform);
    const result = await imService.testGateway(platform, configOverride);
    if (result) {
      setConnectivityResults((prev) => ({ ...prev, [platform]: result }));
    }
    setTestingPlatform(null);
    return result;
  };

  // Toggle gateway on/off and persist enabled state
  const toggleGateway = async (platform: Platform) => {
    // Re-entrancy guard: if a toggle is already in progress for this platform, bail out.
    // This prevents rapid ON→OFF→ON clicks from causing concurrent native SDK init/uninit.
    if (togglingPlatform === platform) return;
    setTogglingPlatform(platform);

    try {
      // All OpenClaw platforms: im:config:set handler already calls
      // syncOpenClawConfig({ restartGatewayIfRunning: true }), so no startGateway/stopGateway needed.
      // Only updateConfig + loadStatus is required.
      // Pessimistic UI update: wait for IPC to complete before updating Redux state.
      // This prevents UI/backend state divergence when rapidly toggling, since the
      // backend debounces syncOpenClawConfig calls with a 600ms window.
      if (platform === 'telegram') {
        const newEnabled = !tgOpenClawConfig.enabled;
        const success = await imService.updateConfig({ telegram: { ...tgOpenClawConfig, enabled: newEnabled } });
        if (success) {
          dispatch(setTelegramOpenClawConfig({ enabled: newEnabled }));
          if (newEnabled) dispatch(clearError());
          await imService.loadStatus();
        }
        return;
      }

      if (platform === 'dingtalk') {
        // DingTalk multi-instance: toggle is handled per-instance in DingTalkInstanceSettings
        return;
      }

      if (platform === 'feishu') {
        // Feishu multi-instance: toggle is handled per-instance in FeishuInstanceSettings
        return;
      }

      if (platform === 'discord') {
        const newEnabled = !dcOpenClawConfig.enabled;
        const success = await imService.updateConfig({ discord: { ...dcOpenClawConfig, enabled: newEnabled } });
        if (success) {
          dispatch(setDiscordConfig({ enabled: newEnabled }));
          if (newEnabled) dispatch(clearError());
          await imService.loadStatus();
        }
        return;
      }

      if (platform === 'qq') {
        // QQ multi-instance: toggle is handled per-instance in QQInstanceSettings
        return;
      }

      if (platform === 'wecom') {
        // WeCom multi-instance: toggle is handled per-instance in WecomInstanceSettings
        return;
      }

      if (platform === 'weixin') {
        const newEnabled = !weixinOpenClawConfig.enabled;
        const success = await imService.updateConfig({ weixin: { ...weixinOpenClawConfig, enabled: newEnabled } });
        if (success) {
          dispatch(setWeixinConfig({ enabled: newEnabled }));
          if (newEnabled) dispatch(clearError());
          await imService.loadStatus();
        }
        return;
      }

      if (platform === 'popo') {
        const newEnabled = !popoConfig.enabled;
        const targetInstance = await ensurePrimaryPopoInstance();
        if (!targetInstance) return;
        const success = await imService.updatePopoInstanceConfig(targetInstance.instanceId, { ...targetInstance, ...popoConfig, enabled: newEnabled });
        if (success) {
          dispatch(setPopoInstanceConfig({ instanceId: targetInstance.instanceId, config: { enabled: newEnabled } }));
          if (newEnabled) dispatch(clearError());
          await imService.loadStatus();
        }
        return;
      }
      if (platform === 'nim') {
        const newEnabled = !nimConfig.enabled;
        const targetInstance = await ensurePrimaryNimInstance();
        if (!targetInstance) return;
        const success = await imService.updateNimInstanceConfig(targetInstance.instanceId, { ...targetInstance, ...nimConfig, enabled: newEnabled });
        if (success) {
          dispatch(setNimInstanceConfig({ instanceId: targetInstance.instanceId, config: { enabled: newEnabled } }));
          if (newEnabled) dispatch(clearError());
          await imService.loadStatus();
        }
        return;
      }

      if (platform === 'email') {
        const newEnabled = !emailConfig.enabled;
        const targetInstance = await ensurePrimaryEmailInstance();
        if (!targetInstance) return;
        const canEnable = Boolean(
          emailConfig.email
          && (
            (emailConfig.transport === 'imap' && emailConfig.password)
            || (emailConfig.transport === 'ws' && emailConfig.apiKey)
          ),
        );
        if (newEnabled && !canEnable) return;
        const success = await imService.updateEmailInstanceConfig(targetInstance.instanceId, { ...targetInstance, ...emailConfig, enabled: newEnabled });
        if (success) {
          dispatch(setEmailInstanceConfig({ instanceId: targetInstance.instanceId, config: { enabled: newEnabled } }));
          if (newEnabled) dispatch(clearError());
          await imService.loadStatus();
        }
        return;
      }

      if (platform === 'netease-bee') {
        const newEnabled = !config['netease-bee'].enabled;
        const success = await imService.updateConfig({
          'netease-bee': { ...config['netease-bee'], enabled: newEnabled },
        });
        if (success) {
          dispatch(setNeteaseBeeChanConfig({ enabled: newEnabled }));
          if (newEnabled) {
            dispatch(clearError());
          }
          await imService.loadStatus();
        }
        return;
      }

      console.warn(`[IM] Unsupported gateway toggle entry for platform ${platform}`);
    } finally {
      setTogglingPlatform(null);
    }
  };

  const dingtalkConnected = status.dingtalk?.instances?.some(i => i.connected) ?? false;
  const feishuConnected = status.feishu?.instances?.some(i => i.connected) ?? false;
  const telegramConnected = status.telegram.connected;
  const discordConnected = status.discord.connected;
  const nimConnected = status.nim.connected;
  const neteaseBeeChanConnected = status['netease-bee']?.connected ?? false;
  const qqConnected = status.qq?.instances?.some(i => i.connected) ?? false;
  const wecomConnected = status.wecom?.instances?.some(i => i.connected) ?? false;
  const weixinConnected = status.weixin?.connected ?? false;
  const popoConnected = status.popo?.connected ?? false;
  const emailConnected = status.email?.instances?.some(i => i.connected) ?? false;

  // Compute visible platforms based on language
  const platforms = useMemo<Platform[]>(() => {
    return getVisibleIMPlatforms(language) as Platform[];
  }, [language]);

  // Ensure activePlatform is always in visible platforms when language changes
  useEffect(() => {
    if (platforms.length > 0 && !platforms.includes(activePlatform)) {
      // If current activePlatform is not visible, switch to first visible platform
      setActivePlatform(platforms[0]);
    }
  }, [platforms, activePlatform]);

  // Check if platform can be started
  const canStart = (platform: Platform): boolean => {
    if (platform === 'dingtalk') {
      return config.dingtalk.instances.some(i => !!(i.clientId && i.clientSecret));
    }
    if (platform === 'telegram') {
      return !!tgOpenClawConfig.botToken;
    }
    if (platform === 'discord') {
      return !!config.discord.botToken;
    }
    if (platform === 'nim') {
      return !!(
        (nimConfig.nimToken && nimConfig.nimToken.trim())
        || (nimConfig.appKey && nimConfig.account && nimConfig.token)
      );
    }
    if (platform === 'netease-bee') {
      return !!(config['netease-bee'].clientId && config['netease-bee'].secret);
    }
    if (platform === 'qq') {
      return config.qq.instances.some(i => !!(i.appId && i.appSecret));
    }
    if (platform === 'wecom') {
      return config.wecom.instances.some(i => !!(i.botId && i.secret));
    }
    if (platform === 'weixin') {
      return true; // No credentials needed, connects via QR code in CLI
    }
    if (platform === 'popo') {
      return true; // Credentials provisioned via QR scan or manual input in openclaw.json
    }
    if (platform === 'email') {
      return config.email.instances.some((instance) => Boolean(
        instance.email
        && (
          (instance.transport === 'imap' && instance.password)
          || (instance.transport === 'ws' && instance.apiKey)
        ),
      ));
    }
    return config.feishu.instances?.some(i => !!(i.appId && i.appSecret));
  };

  // Get platform enabled state (persisted toggle state)
  const isPlatformEnabled = (platform: Platform): boolean => {
    if (platform === 'dingtalk') {
      return config.dingtalk.instances?.some(i => i.enabled);
    }
    if (platform === 'qq') {
      return config.qq.instances.some(i => i.enabled);
    }
    if (platform === 'feishu') {
      return config.feishu.instances?.some(i => i.enabled);
    }
    if (platform === 'wecom') {
      return config.wecom.instances?.some(i => i.enabled);
    }
    if (platform === 'email') {
      return config.email.instances?.some(i => i.enabled);
    }
    return (config[platform] as { enabled: boolean }).enabled;
  };

  // Get platform connection status (runtime state)
  const getPlatformConnected = (platform: Platform): boolean => {
    if (platform === 'dingtalk') return dingtalkConnected;
    if (platform === 'telegram') return telegramConnected;
    if (platform === 'discord') return discordConnected;
    if (platform === 'nim') return nimConnected;
    if (platform === 'netease-bee') return neteaseBeeChanConnected;
    if (platform === 'qq') return qqConnected;
    if (platform === 'wecom') return wecomConnected;
    if (platform === 'weixin') return weixinConnected;
    if (platform === 'popo') return popoConnected;
    if (platform === 'email') return emailConnected;
    return feishuConnected;
  };

  // Get platform transient starting status
  const getPlatformStarting = (platform: Platform): boolean => {
    if (platform === 'discord') return status.discord.starting;
    return false;
  };

  const handleConnectivityTest = async (platform: Platform) => {
    // Re-entrancy guard: if a test is already running, do nothing.
    if (testingPlatform) return;

    setConnectivityModalPlatform(platform);
    setTestingPlatform(platform);

    // For Telegram, persist telegram config and test
    if (platform === 'telegram') {
      await imService.persistConfig({ telegram: tgOpenClawConfig });
      const result = await runConnectivityTest(platform, {
        telegram: tgOpenClawConfig,
      } as Partial<IMGatewayConfig>);
      // Auto-enable: if OFF and auth_check passed, turn on automatically
      if (!tgOpenClawConfig.enabled && result) {
        const authCheck = result.checks.find((c) => c.code === 'auth_check');
        if (authCheck && authCheck.level === 'pass') {
          toggleGateway(platform);
        }
      }
      return;
    }

    // For DingTalk, persist dingtalk config and test (OpenClaw mode)
    if (platform === 'dingtalk') {
      await imService.persistConfig({ dingtalk: dingtalkMultiConfig });
      const result = await runConnectivityTest(platform, {
        dingtalk: dingtalkMultiConfig,
      } as Partial<IMGatewayConfig>);
      // Auto-enable: if the active instance is OFF and auth_check passed, turn on automatically
      if (activeDingTalkInstanceId && result) {
        const inst = dingtalkMultiConfig.instances.find(i => i.instanceId === activeDingTalkInstanceId);
        if (inst && !inst.enabled) {
          const authCheck = result.checks.find((c) => c.code === 'auth_check');
          if (authCheck && authCheck.level === 'pass') {
            dispatch(setDingTalkInstanceConfig({ instanceId: activeDingTalkInstanceId, config: { enabled: true } }));
            await imService.updateDingTalkInstanceConfig(activeDingTalkInstanceId, { enabled: true });
          }
        }
      }
      return;
    }

    // For QQ, persist qq config and test (OpenClaw mode)
    if (platform === 'qq') {
      await imService.persistConfig({ qq: qqMultiConfig });
      const result = await runConnectivityTest(platform, {
        qq: qqMultiConfig,
      } as Partial<IMGatewayConfig>);
      // Auto-enable: if the active instance is OFF and auth_check passed, turn on automatically
      if (activeQQInstanceId && result) {
        const inst = qqMultiConfig.instances.find(i => i.instanceId === activeQQInstanceId);
        if (inst && !inst.enabled) {
          const authCheck = result.checks.find((c) => c.code === 'auth_check');
          if (authCheck && authCheck.level === 'pass') {
            dispatch(setQQInstanceConfig({ instanceId: activeQQInstanceId, config: { enabled: true } }));
            await imService.updateQQInstanceConfig(activeQQInstanceId, { enabled: true });
          }
        }
      }
      return;
    }

    // For WeCom, persist wecom config and test (OpenClaw mode)
    if (platform === 'wecom') {
      const wecomMultiConfig = config.wecom;
      await imService.persistConfig({ wecom: wecomMultiConfig });
      const result = await runConnectivityTest(platform, {
        wecom: wecomMultiConfig,
      } as Partial<IMGatewayConfig>);
      // Auto-enable: if the active instance is OFF and auth_check passed, turn on automatically
      if (activeWecomInstanceId && result) {
        const inst = wecomMultiConfig.instances.find(i => i.instanceId === activeWecomInstanceId);
        if (inst && !inst.enabled) {
          const authCheck = result.checks.find((c) => c.code === 'auth_check');
          if (authCheck && authCheck.level === 'pass') {
            dispatch(setWecomInstanceConfig({ instanceId: activeWecomInstanceId, config: { enabled: true } }));
            await imService.updateWecomInstanceConfig(activeWecomInstanceId, { enabled: true });
          }
        }
      }
      return;
    }

    // For Weixin, persist weixin config and test (OpenClaw mode)
    if (platform === 'weixin') {
      await imService.persistConfig({ weixin: weixinOpenClawConfig });
      const result = await runConnectivityTest(platform, {
        weixin: weixinOpenClawConfig,
      } as Partial<IMGatewayConfig>);
      if (!weixinOpenClawConfig.enabled && result) {
        const authCheck = result.checks.find((c) => c.code === 'auth_check');
        if (authCheck && authCheck.level === 'pass') {
          toggleGateway(platform);
        }
      }
      return;
    }

    // For Feishu, persist feishu config and test (OpenClaw mode)
    if (platform === 'feishu') {
      await imService.persistConfig({ feishu: feishuMultiConfig });
      const result = await runConnectivityTest(platform, {
        feishu: feishuMultiConfig,
      } as Partial<IMGatewayConfig>);
      // Auto-enable: if the active instance is OFF and auth_check passed, turn on automatically
      if (activeFeishuInstanceId && result) {
        const inst = feishuMultiConfig.instances.find(i => i.instanceId === activeFeishuInstanceId);
        if (inst && !inst.enabled) {
          const authCheck = result.checks.find((c) => c.code === 'auth_check');
          if (authCheck && authCheck.level === 'pass') {
            dispatch(setFeishuInstanceConfig({ instanceId: activeFeishuInstanceId, config: { enabled: true } }));
            await imService.updateFeishuInstanceConfig(activeFeishuInstanceId, { enabled: true });
          }
        }
      }
      return;
    }

    if (platform === 'email') {
      await imService.persistConfig({ email: config.email });
      const result = await runConnectivityTest(platform, {
        email: config.email,
      } as Partial<IMGatewayConfig>);
      if (activeEmailInstanceId && result) {
        const inst = config.email.instances.find(i => i.instanceId === activeEmailInstanceId);
        if (inst && !inst.enabled) {
          const gatewayCheck = result.checks.find((c) => c.code === 'gateway_running');
          if (gatewayCheck && gatewayCheck.level !== 'fail') {
            dispatch(setEmailInstanceConfig({ instanceId: activeEmailInstanceId, config: { enabled: true } }));
            await imService.updateEmailInstanceConfig(activeEmailInstanceId, { enabled: true });
          }
        }
      }
      return;
    }

    // 1. Persist latest config to backend (without changing enabled state)
    await imService.persistConfig({
      [platform]: config[platform],
    } as Partial<IMGatewayConfig>);

    const isEnabled = isPlatformEnabled(platform);

    // For NIM, skip the frontend stop/start cycle entirely.
    // The backend's testNimConnectivity already manages the SDK lifecycle
    // (stop main → probe with temp instance → restart main) under a mutex,
    // so doing stop/start here would cause a race condition and potential crash.
    // When the gateway is OFF we skip stop/start entirely.
    // The main process testGateway → runAuthProbe will spawn an isolated
    // temporary NimGateway (for NIM) or use stateless HTTP calls for other
    // platforms, so no historical messages are ingested and the main
    // gateway state is never touched.

    // Run connectivity test (always passes configOverride so the backend uses
    // the latest unsaved credential values from the form).
    const result = await runConnectivityTest(platform, {
      [platform]: config[platform],
    } as Partial<IMGatewayConfig>);

    // Auto-enable: if the platform was OFF but auth_check passed, start it automatically.
    if (!isEnabled && result) {
      const authCheck = result.checks.find((c) => c.code === 'auth_check');
      if (authCheck && authCheck.level === 'pass') {
        toggleGateway(platform);
      }
    }
  };

  // Handle platform toggle
  const handlePlatformToggle = (platform: Platform) => {
    // Block toggle if a toggle is already in progress for any platform
    if (togglingPlatform) return;
    const isEnabled = isPlatformEnabled(platform);
    // Can toggle ON if credentials are present, can always toggle OFF
    const canToggle = isEnabled || canStart(platform);
    if (canToggle && !isLoading) {
      setActivePlatform(platform);
      toggleGateway(platform);
    }
  };

  const renderConnectivityTestButton = (platform: Platform) => (
    <button
      type="button"
      onClick={() => handleConnectivityTest(platform)}
      disabled={isLoading || testingPlatform === platform}
      className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-xl border border-border text-foreground hover:bg-surface-raised disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-[0.98]"
    >
      <SignalIcon className="h-3.5 w-3.5 mr-1.5" />
      {testingPlatform === platform
        ? i18nService.t('imConnectivityTesting')
        : connectivityResults[platform]
          ? i18nService.t('imConnectivityRetest')
          : i18nService.t('imConnectivityTest')}
    </button>
  );

  useEffect(() => {
    if (!connectivityModalPlatform) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setConnectivityModalPlatform(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [connectivityModalPlatform]);

  const renderPairingSection = (platform: string) => (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-secondary">
        {i18nService.t('imPairingApproval')}
      </label>
      <div className="flex gap-2">
        <input
          type="text"
          value={pairingCodeInput[platform] || ''}
          onChange={(e) => {
            setPairingCodeInput((prev) => ({ ...prev, [platform]: e.target.value.toUpperCase() }));
            if (pairingStatus[platform]) setPairingStatus((prev) => ({ ...prev, [platform]: null }));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const code = (pairingCodeInput[platform] || '').trim();
              if (code) {
                void handleApprovePairing(platform, code).then(() => {
                  setPairingCodeInput((prev) => ({ ...prev, [platform]: '' }));
                });
              }
            }
          }}
          className="block flex-1 rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm font-mono uppercase tracking-widest transition-colors"
          placeholder={i18nService.t('imPairingCodePlaceholder')}
          maxLength={8}
        />
        <button
          type="button"
          onClick={() => {
            const code = (pairingCodeInput[platform] || '').trim();
            if (code) {
              void handleApprovePairing(platform, code).then(() => {
                setPairingCodeInput((prev) => ({ ...prev, [platform]: '' }));
              });
            }
          }}
          className="px-3 py-2 rounded-lg text-xs font-medium bg-green-500/15 text-green-600 dark:text-green-400 hover:bg-green-500/25 transition-colors"
        >
          {i18nService.t('imPairingApprove')}
        </button>
      </div>
      {pairingStatus[platform] && (
        <p className={`text-xs ${pairingStatus[platform]!.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          {pairingStatus[platform]!.type === 'success' ? '\u2713' : '\u2717'} {pairingStatus[platform]!.message}
        </p>
      )}
    </div>
  );

  return (
    <div className="flex h-full gap-4">
      {/* Platform List - Left Side */}
      <div className="w-48 flex-shrink-0 border-r border-border pr-3 space-y-2 overflow-y-auto">
        {platforms.map((platform) => {
                const logo = PlatformRegistry.logo(platform);
           const isEnabled = isPlatformEnabled(platform);
          const isConnected = getPlatformConnected(platform) || getPlatformStarting(platform);
          const canToggle = isEnabled || canStart(platform);

          if (platform === 'dingtalk') {
            return (
              <div key="dingtalk">
                {/* DingTalk Platform Header - clickable to expand/collapse */}
                <div
                  onClick={() => { setActivePlatform('dingtalk'); setActiveDingTalkInstanceId(null); setDingtalkExpanded(!dingtalkExpanded); }}
                  className={`flex items-center p-2 rounded-xl cursor-pointer transition-colors ${
                    activePlatform === 'dingtalk'
                      ? 'bg-primary-muted border border-primary shadow-subtle'
                      : 'bg-surface hover:bg-surface-raised border border-transparent'
                  }`}
                >
                  <div className="flex flex-1 items-center">
                    <div className="mr-2 flex h-7 w-7 items-center justify-center">
                      <img src={PlatformRegistry.logo('dingtalk')} alt="DingTalk" className="w-6 h-6 object-contain rounded-md" />
                    </div>
                    <span className={`text-sm font-medium truncate ${activePlatform === 'dingtalk' ? 'text-primary' : 'text-foreground'}`}>
                      {i18nService.t('dingtalk')}
                    </span>
                  </div>
                  <span className="text-xs opacity-50">{dingtalkExpanded ? '\u25BC' : '\u25B6'}</span>
                </div>
                {/* DingTalk Instance Sub-items */}
                {dingtalkExpanded && (
                  <div className="ml-5 mt-1 space-y-1">
                    {config.dingtalk.instances.map((inst) => {
                      const instStatus = status.dingtalk?.instances?.find(s => s.instanceId === inst.instanceId);
                      const isSelected = activePlatform === 'dingtalk' && activeDingTalkInstanceId === inst.instanceId;
                      const dotColor = !inst.enabled ? 'bg-gray-400' : (instStatus?.connected ? 'bg-green-500' : 'bg-yellow-500');
                      return (
                        <div
                          key={inst.instanceId}
                          onClick={() => { setActivePlatform('dingtalk'); setActiveDingTalkInstanceId(inst.instanceId); }}
                          className={`flex items-center p-1.5 pl-2 rounded-lg cursor-pointer transition-colors text-sm ${
                            isSelected
                              ? 'bg-primary/10 dark:bg-primary/20'
                              : 'hover:bg-surface-raised'
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full ${dotColor} mr-2 flex-shrink-0`} />
                          <span className={`truncate flex-1 ${isSelected ? 'text-primary font-medium' : 'text-foreground'}`}>
                            {inst.instanceName}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          if (platform === 'feishu') {
            return (
              <div key="feishu">
                {/* Feishu Platform Header - clickable to expand/collapse */}
                <div
                  onClick={() => { setActivePlatform('feishu'); setActiveFeishuInstanceId(null); setFeishuExpanded(!feishuExpanded); }}
                  className={`flex items-center p-2 rounded-xl cursor-pointer transition-colors ${
                    activePlatform === 'feishu'
                      ? 'bg-primary-muted border border-primary shadow-subtle'
                      : 'bg-surface hover:bg-surface-raised border border-transparent'
                  }`}
                >
                  <div className="flex flex-1 items-center">
                    <div className="mr-2 flex h-7 w-7 items-center justify-center">
                      <img src={PlatformRegistry.logo('feishu')} alt="Feishu" className="w-6 h-6 object-contain rounded-md" />
                    </div>
                    <span className={`text-sm font-medium truncate ${activePlatform === 'feishu' ? 'text-primary' : 'text-foreground'}`}>
                      {i18nService.t('feishu')}
                    </span>
                  </div>
                  <span className="text-xs opacity-50">{feishuExpanded ? '\u25BC' : '\u25B6'}</span>
                </div>
                {/* Feishu Instance Sub-items */}
                {feishuExpanded && (
                  <div className="ml-5 mt-1 space-y-1">
                    {config.feishu.instances.map((inst) => {
                      const instStatus = status.feishu?.instances?.find(s => s.instanceId === inst.instanceId);
                      const isSelected = activePlatform === 'feishu' && activeFeishuInstanceId === inst.instanceId;
                      const dotColor = !inst.enabled ? 'bg-gray-400' : (instStatus?.connected ? 'bg-green-500' : 'bg-yellow-500');
                      return (
                        <div
                          key={inst.instanceId}
                          onClick={() => { setActivePlatform('feishu'); setActiveFeishuInstanceId(inst.instanceId); }}
                          className={`flex items-center p-1.5 pl-2 rounded-lg cursor-pointer transition-colors text-sm ${
                            isSelected
                              ? 'bg-primary/10 dark:bg-primary/20'
                              : 'hover:bg-surface-raised'
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full ${dotColor} mr-2 flex-shrink-0`} />
                          <span className={`truncate flex-1 ${isSelected ? 'text-primary font-medium' : 'text-foreground'}`}>
                            {inst.instanceName}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          if (platform === 'qq') {
            return (
              <div key="qq">
                {/* QQ Platform Header - clickable to expand/collapse */}
                <div
                  onClick={() => { setActivePlatform('qq'); setActiveQQInstanceId(null); setQqExpanded(!qqExpanded); }}
                  className={`flex items-center p-2 rounded-xl cursor-pointer transition-colors ${
                    activePlatform === 'qq'
                      ? 'bg-primary-muted border border-primary shadow-subtle'
                      : 'bg-surface hover:bg-surface-raised border border-transparent'
                  }`}
                >
                  <div className="flex flex-1 items-center">
                    <div className="mr-2 flex h-7 w-7 items-center justify-center">
                      <img src={PlatformRegistry.logo('qq')} alt="QQ" className="w-6 h-6 object-contain rounded-md" />
                    </div>
                    <span className={`text-sm font-medium truncate ${activePlatform === 'qq' ? 'text-primary' : 'text-foreground'}`}>
                      {i18nService.t('qq')}
                    </span>
                  </div>
                  <span className="text-xs opacity-50">{qqExpanded ? '\u25BC' : '\u25B6'}</span>
                </div>
                {/* QQ Instance Sub-items */}
                {qqExpanded && (
                  <div className="ml-5 mt-1 space-y-1">
                    {config.qq.instances.map((inst) => {
                      const instStatus = status.qq?.instances?.find(s => s.instanceId === inst.instanceId);
                      const isSelected = activePlatform === 'qq' && activeQQInstanceId === inst.instanceId;
                      const dotColor = !inst.enabled ? 'bg-gray-400' : (instStatus?.connected ? 'bg-green-500' : 'bg-yellow-500');
                      return (
                        <div
                          key={inst.instanceId}
                          onClick={() => { setActivePlatform('qq'); setActiveQQInstanceId(inst.instanceId); }}
                          className={`flex items-center p-1.5 pl-2 rounded-lg cursor-pointer transition-colors text-sm ${
                            isSelected
                              ? 'bg-primary/10 dark:bg-primary/20'
                              : 'hover:bg-surface-raised'
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full ${dotColor} mr-2 flex-shrink-0`} />
                          <span className={`truncate flex-1 ${isSelected ? 'text-primary font-medium' : 'text-foreground'}`}>
                            {inst.instanceName}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          if (platform === 'wecom') {
            return (
              <div key="wecom">
                {/* WeCom Platform Header - clickable to expand/collapse */}
                <div
                  onClick={() => { setActivePlatform('wecom'); setActiveWecomInstanceId(null); setWecomExpanded(!wecomExpanded); }}
                  className={`flex items-center p-2 rounded-xl cursor-pointer transition-colors ${
                    activePlatform === 'wecom'
                      ? 'bg-primary-muted border border-primary shadow-subtle'
                      : 'bg-surface hover:bg-surface-raised border border-transparent'
                  }`}
                >
                  <div className="flex flex-1 items-center">
                    <div className="mr-2 flex h-7 w-7 items-center justify-center">
                      <img src={PlatformRegistry.logo('wecom')} alt="WeCom" className="w-6 h-6 object-contain rounded-md" />
                    </div>
                    <span className={`text-sm font-medium truncate ${activePlatform === 'wecom' ? 'text-primary' : 'text-foreground'}`}>
                      {i18nService.t('wecom')}
                    </span>
                  </div>
                  <span className="text-xs opacity-50">{wecomExpanded ? '\u25BC' : '\u25B6'}</span>
                </div>
                {/* WeCom Instance Sub-items */}
                {wecomExpanded && (
                  <div className="ml-5 mt-1 space-y-1">
                    {config.wecom.instances.map((inst) => {
                      const instStatus = status.wecom?.instances?.find(s => s.instanceId === inst.instanceId);
                      const isSelected = activePlatform === 'wecom' && activeWecomInstanceId === inst.instanceId;
                      const dotColor = !inst.enabled ? 'bg-gray-400' : (instStatus?.connected ? 'bg-green-500' : 'bg-yellow-500');
                      return (
                        <div
                          key={inst.instanceId}
                          onClick={() => { setActivePlatform('wecom'); setActiveWecomInstanceId(inst.instanceId); }}
                          className={`flex items-center p-1.5 pl-2 rounded-lg cursor-pointer transition-colors text-sm ${
                            isSelected
                              ? 'bg-primary/10 dark:bg-primary/20'
                              : 'hover:bg-surface-raised'
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full ${dotColor} mr-2 flex-shrink-0`} />
                          <span className={`truncate flex-1 ${isSelected ? 'text-primary font-medium' : 'text-foreground'}`}>
                            {inst.instanceName}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          if (platform === 'nim') {
            return (
              <div key="nim">
                <div
                  onClick={() => { setActivePlatform('nim'); setActiveNimInstanceId(null); setNimExpanded(!nimExpanded); }}
                  className={`flex items-center p-2 rounded-xl cursor-pointer transition-colors ${
                    activePlatform === 'nim'
                      ? 'bg-primary-muted border border-primary shadow-subtle'
                      : 'bg-surface hover:bg-surface-raised border border-transparent'
                  }`}
                >
                  <div className="flex flex-1 items-center">
                    <div className="mr-2 flex h-7 w-7 items-center justify-center">
                      <img src={PlatformRegistry.logo('nim')} alt="NIM" className="w-6 h-6 object-contain rounded-md" />
                    </div>
                    <span className={`text-sm font-medium truncate ${activePlatform === 'nim' ? 'text-primary' : 'text-foreground'}`}>
                      {i18nService.t('nim')}
                    </span>
                  </div>
                  <span className="text-xs opacity-50">{nimExpanded ? '\u25BC' : '\u25B6'}</span>
                </div>
                {nimExpanded && (
                  <div className="ml-5 mt-1 space-y-1">
                    {config.nim.instances.map((inst) => {
                      const isSelected = activePlatform === 'nim' && activeNimInstanceId === inst.instanceId;
                      const dotColor = !inst.enabled ? 'bg-gray-400' : (nimConnected ? 'bg-green-500' : 'bg-yellow-500');
                      return (
                        <div
                          key={inst.instanceId}
                          onClick={() => { setActivePlatform('nim'); setActiveNimInstanceId(inst.instanceId); }}
                          className={`flex items-center p-1.5 pl-2 rounded-lg cursor-pointer transition-colors text-sm ${
                            isSelected ? 'bg-primary/10 dark:bg-primary/20' : 'hover:bg-surface-raised'
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full ${dotColor} mr-2 flex-shrink-0`} />
                          <span className={`truncate flex-1 ${isSelected ? 'text-primary font-medium' : 'text-foreground'}`}>
                            {inst.instanceName}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          if (platform === 'popo') {
            return (
              <div key="popo">
                <div
                  onClick={() => { setActivePlatform('popo'); setActivePopoInstanceId(null); setPopoExpanded(!popoExpanded); }}
                  className={`flex items-center p-2 rounded-xl cursor-pointer transition-colors ${
                    activePlatform === 'popo'
                      ? 'bg-primary-muted border border-primary shadow-subtle'
                      : 'bg-surface hover:bg-surface-raised border border-transparent'
                  }`}
                >
                  <div className="flex flex-1 items-center">
                    <div className="mr-2 flex h-7 w-7 items-center justify-center">
                      <img src={PlatformRegistry.logo('popo')} alt="POPO" className="w-6 h-6 object-contain rounded-md" />
                    </div>
                    <span className={`text-sm font-medium truncate ${activePlatform === 'popo' ? 'text-primary' : 'text-foreground'}`}>
                      {i18nService.t('popo')}
                    </span>
                  </div>
                  <span className="text-xs opacity-50">{popoExpanded ? '\u25BC' : '\u25B6'}</span>
                </div>
                {popoExpanded && (
                  <div className="ml-5 mt-1 space-y-1">
                    {config.popo.instances.map((inst) => {
                      const isSelected = activePlatform === 'popo' && activePopoInstanceId === inst.instanceId;
                      const dotColor = !inst.enabled ? 'bg-gray-400' : (popoConnected ? 'bg-green-500' : 'bg-yellow-500');
                      return (
                        <div
                          key={inst.instanceId}
                          onClick={() => { setActivePlatform('popo'); setActivePopoInstanceId(inst.instanceId); }}
                          className={`flex items-center p-1.5 pl-2 rounded-lg cursor-pointer transition-colors text-sm ${
                            isSelected ? 'bg-primary/10 dark:bg-primary/20' : 'hover:bg-surface-raised'
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full ${dotColor} mr-2 flex-shrink-0`} />
                          <span className={`truncate flex-1 ${isSelected ? 'text-primary font-medium' : 'text-foreground'}`}>
                            {inst.instanceName}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          if (platform === 'email') {
            return (
              <div key="email">
                <div
                  onClick={() => { setActivePlatform('email'); setActiveEmailInstanceId(null); setEmailExpanded(!emailExpanded); }}
                  className={`flex items-center p-2 rounded-xl cursor-pointer transition-colors ${
                    activePlatform === 'email'
                      ? 'bg-primary-muted border border-primary shadow-subtle'
                      : 'bg-surface hover:bg-surface-raised border border-transparent'
                  }`}
                >
                  <div className="flex flex-1 items-center">
                    <div className="mr-2 flex h-7 w-7 items-center justify-center">
                      <img src={PlatformRegistry.logo('email')} alt="Email" className="w-6 h-6 object-contain rounded-md" />
                    </div>
                    <span className={`text-sm font-medium truncate ${activePlatform === 'email' ? 'text-primary' : 'text-foreground'}`}>
                      {i18nService.t('emailTab') || 'Email'}
                    </span>
                  </div>
                  <span className="text-xs opacity-50">{emailExpanded ? '\u25BC' : '\u25B6'}</span>
                </div>
                {emailExpanded && (
                  <div className="ml-5 mt-1 space-y-1">
                    {config.email.instances.map((inst) => {
                      const instStatus = status.email?.instances?.find(s => s.instanceId === inst.instanceId);
                      const isSelected = activePlatform === 'email' && activeEmailInstanceId === inst.instanceId;
                      const dotColor = !inst.enabled ? 'bg-gray-400' : (instStatus?.connected ? 'bg-green-500' : 'bg-yellow-500');
                      return (
                        <div
                          key={inst.instanceId}
                          onClick={() => { setActivePlatform('email'); setActiveEmailInstanceId(inst.instanceId); }}
                          className={`flex items-center p-1.5 pl-2 rounded-lg cursor-pointer transition-colors text-sm ${
                            isSelected ? 'bg-primary/10 dark:bg-primary/20' : 'hover:bg-surface-raised'
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full ${dotColor} mr-2 flex-shrink-0`} />
                          <span className={`truncate flex-1 ${isSelected ? 'text-primary font-medium' : 'text-foreground'}`}>
                            {inst.instanceName}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          return (
            <div
              key={platform}
              onClick={() => setActivePlatform(platform)}
              className={`flex items-center p-2 rounded-xl cursor-pointer transition-colors ${
                activePlatform === platform
                  ? 'bg-primary-muted border border-primary shadow-subtle'
                  : 'bg-surface hover:bg-surface-raised border border-transparent'
              }`}
            >
              <div className="flex flex-1 items-center">
                <div className="mr-2 flex h-7 w-7 items-center justify-center">
                  <img
                    src={logo}
                    alt={i18nService.t(platform)}
                    className="w-6 h-6 object-contain rounded-md"
                  />
                </div>
                <span className={`text-sm font-medium truncate ${
                  activePlatform === platform
                    ? 'text-primary'
                    : 'text-foreground'
                }`}>
                  {i18nService.t(platform)}
                </span>
              </div>
              <div className="flex items-center ml-2">
                <div
                  className={`w-7 h-4 rounded-full flex items-center transition-colors ${
                    isEnabled
                      ? (isConnected ? 'bg-green-500' : 'bg-yellow-500')
                      : 'bg-gray-400 dark:bg-gray-600'
                  } ${(!canToggle || togglingPlatform === platform) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePlatformToggle(platform);
                  }}
                >
                  <div
                    className={`w-3 h-3 rounded-full bg-white shadow-md transform transition-transform ${
                      isEnabled ? 'translate-x-3.5' : 'translate-x-0.5'
                    }`}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Platform Settings - Right Side */}
      <div className="flex-1 min-w-0 pl-4 pr-2 space-y-4 overflow-y-auto [scrollbar-gutter:stable]">
        {/* Header with status (only for single-instance platforms without per-instance headers) */}
        {(activePlatform === 'weixin' || activePlatform === 'netease-bee') && (
        <div className="flex items-center gap-3 pb-3 border-b border-border-subtle">
          <div className="flex items-center gap-2">
             <div className="flex h-7 w-7 items-center justify-center rounded-md bg-surface border border-border-subtle p-1">
               <img
                src={PlatformRegistry.logo(activePlatform)}
                 alt={i18nService.t(activePlatform)}
                 className="w-4 h-4 object-contain rounded"
               />
            </div>
            <h3 className="text-sm font-medium text-foreground">
              {`${i18nService.t(activePlatform)}${i18nService.t('settings')}`}
            </h3>
          </div>
          <div className={`px-2 py-0.5 rounded-full text-xs font-medium ${
            getPlatformConnected(activePlatform) || getPlatformStarting(activePlatform)
              ? 'bg-green-500/15 text-green-600 dark:text-green-400'
              : 'bg-gray-500/15 text-gray-500 dark:text-gray-400'
          }`}>
            {getPlatformConnected(activePlatform)
              ? i18nService.t('connected')
              : getPlatformStarting(activePlatform)
                ? (i18nService.t('starting') || '启动中')
                : i18nService.t('disconnected')}
          </div>
        </div>
        )}


        {/* DingTalk Settings (multi-instance) */}
        {activePlatform === 'dingtalk' && !activeDingTalkInstanceId && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <img src={PlatformRegistry.logo('dingtalk')} alt="DingTalk" className="w-12 h-12 object-contain rounded-md mb-4 opacity-50" />
            <p className="text-sm text-secondary mb-4">
              {config.dingtalk.instances.length === 0
                ? (language === 'zh' ? '尚未添加钉钉实例，点击下方按钮添加' : 'No DingTalk instances yet. Click below to add one.')
                : (language === 'zh' ? '请在左侧选择一个钉钉实例' : 'Select a DingTalk instance from the sidebar.')}
            </p>
            {config.dingtalk.instances.length < MAX_DINGTALK_INSTANCES && (
              <button
                type="button"
                onClick={async (e) => {
                  e.stopPropagation();
                  const inst = await imService.addDingTalkInstance(`DingTalk Bot ${config.dingtalk.instances.length + 1}`);
                  if (inst) { setActiveDingTalkInstanceId(inst.instanceId); setDingtalkExpanded(true); }
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                + {i18nService.t('imDingTalkAddInstance')}
              </button>
            )}
          </div>
        )}
        {activePlatform === 'dingtalk' && activeDingTalkInstanceId && (() => {
          const selectedInstance = config.dingtalk.instances.find(i => i.instanceId === activeDingTalkInstanceId);
          if (!selectedInstance) return null;
          const selectedStatus = status.dingtalk?.instances?.find(s => s.instanceId === activeDingTalkInstanceId);
          return (
            <DingTalkInstanceSettings
              instance={selectedInstance}
              instanceStatus={selectedStatus}
              onConfigChange={(update) => {
                dispatch(setDingTalkInstanceConfig({ instanceId: activeDingTalkInstanceId, config: update }));
              }}
              onSave={async (override) => {
                const configToSave = override ? { ...selectedInstance, ...override } : selectedInstance;
                if (selectedInstance.enabled) {
                  await imService.updateDingTalkInstanceConfig(activeDingTalkInstanceId, configToSave);
                } else {
                  await imService.persistDingTalkInstanceConfig(activeDingTalkInstanceId, configToSave);
                }
              }}
              onRename={async (newName) => {
                dispatch(setDingTalkInstanceConfig({ instanceId: activeDingTalkInstanceId, config: { instanceName: newName } as any }));
                await imService.persistDingTalkInstanceConfig(activeDingTalkInstanceId, { instanceName: newName } as any);
              }}
              onDelete={async () => {
                await imService.deleteDingTalkInstance(activeDingTalkInstanceId);
                const remaining = config.dingtalk.instances.filter(i => i.instanceId !== activeDingTalkInstanceId);
                setActiveDingTalkInstanceId(remaining.length > 0 ? remaining[0].instanceId : null);
              }}
              onToggleEnabled={async () => {
                const newEnabled = !selectedInstance.enabled;
                if (newEnabled && !(selectedInstance.clientId && selectedInstance.clientSecret)) return;
                const success = await imService.updateDingTalkInstanceConfig(activeDingTalkInstanceId, { enabled: newEnabled });
                if (success) {
                  dispatch(setDingTalkInstanceConfig({ instanceId: activeDingTalkInstanceId, config: { enabled: newEnabled } }));
                  if (newEnabled) dispatch(clearError());
                }
              }}
              onTestConnectivity={() => {
                void handleConnectivityTest('dingtalk');
              }}
              testingPlatform={testingPlatform}
              connectivityResults={connectivityResults}
              language={language}
            />
          );
        })()}

        {/* Feishu Settings (multi-instance) */}
        {activePlatform === 'feishu' && !activeFeishuInstanceId && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <img src={PlatformRegistry.logo('feishu')} alt="Feishu" className="w-12 h-12 object-contain rounded-md mb-4 opacity-50" />
            <p className="text-sm text-secondary mb-4">
              {config.feishu.instances.length === 0
                ? (language === 'zh' ? '尚未添加飞书实例，点击下方按钮添加' : 'No Feishu instances yet. Click below to add one.')
                : (language === 'zh' ? '请在左侧选择一个飞书实例' : 'Select a Feishu instance from the sidebar.')}
            </p>
            {config.feishu.instances.length < MAX_FEISHU_INSTANCES && (
              <button
                type="button"
                onClick={async (e) => {
                  e.stopPropagation();
                  const inst = await imService.addFeishuInstance(`Feishu Bot ${config.feishu.instances.length + 1}`);
                  if (inst) { setActiveFeishuInstanceId(inst.instanceId); setFeishuExpanded(true); }
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                + {i18nService.t('imFeishuAddInstance')}
              </button>
            )}
          </div>
        )}
        {activePlatform === 'feishu' && activeFeishuInstanceId && (() => {
          const selectedInstance = config.feishu.instances.find(i => i.instanceId === activeFeishuInstanceId);
          if (!selectedInstance) return null;
          const selectedStatus = status.feishu?.instances?.find(s => s.instanceId === activeFeishuInstanceId);
          return (
            <FeishuInstanceSettings
              instance={selectedInstance}
              instanceStatus={selectedStatus}
              onConfigChange={(update) => {
                dispatch(setFeishuInstanceConfig({ instanceId: activeFeishuInstanceId, config: update }));
              }}
              onSave={async (override) => {
                const configToSave = override ? { ...selectedInstance, ...override } : selectedInstance;
                if (selectedInstance.enabled) {
                  await imService.updateFeishuInstanceConfig(activeFeishuInstanceId, configToSave);
                } else {
                  await imService.persistFeishuInstanceConfig(activeFeishuInstanceId, configToSave);
                }
              }}
              onRename={async (newName) => {
                dispatch(setFeishuInstanceConfig({ instanceId: activeFeishuInstanceId, config: { instanceName: newName } as any }));
                await imService.persistFeishuInstanceConfig(activeFeishuInstanceId, { instanceName: newName } as any);
              }}
              onDelete={async () => {
                await imService.deleteFeishuInstance(activeFeishuInstanceId);
                const remaining = config.feishu.instances.filter(i => i.instanceId !== activeFeishuInstanceId);
                setActiveFeishuInstanceId(remaining.length > 0 ? remaining[0].instanceId : null);
              }}
              onToggleEnabled={async () => {
                const newEnabled = !selectedInstance.enabled;
                if (newEnabled && !(selectedInstance.appId && selectedInstance.appSecret)) return;
                const success = await imService.updateFeishuInstanceConfig(activeFeishuInstanceId, { enabled: newEnabled });
                if (success) {
                  dispatch(setFeishuInstanceConfig({ instanceId: activeFeishuInstanceId, config: { enabled: newEnabled } }));
                  if (newEnabled) dispatch(clearError());
                }
              }}
              onTestConnectivity={() => {
                void handleConnectivityTest('feishu');
              }}
              testingPlatform={testingPlatform}
              connectivityResults={connectivityResults}
              language={language}
            />
          );
        })()}

        {/* QQ Settings (multi-instance) */}
        {activePlatform === 'qq' && !activeQQInstanceId && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <img src={PlatformRegistry.logo('qq')} alt="QQ" className="w-12 h-12 object-contain rounded-md mb-4 opacity-50" />
            <p className="text-sm text-secondary mb-4">
              {config.qq.instances.length === 0
                ? (language === 'zh' ? '尚未添加 QQ 实例，点击下方按钮添加' : 'No QQ instances yet. Click below to add one.')
                : (language === 'zh' ? '请在左侧选择一个 QQ 实例' : 'Select a QQ instance from the sidebar.')}
            </p>
            {config.qq.instances.length < MAX_QQ_INSTANCES && (
              <button
                type="button"
                onClick={async (e) => {
                  e.stopPropagation();
                  const inst = await imService.addQQInstance(`QQ Bot ${config.qq.instances.length + 1}`);
                  if (inst) { setActiveQQInstanceId(inst.instanceId); setQqExpanded(true); }
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                + {i18nService.t('imQQAddInstance')}
              </button>
            )}
          </div>
        )}
        {activePlatform === 'qq' && activeQQInstanceId && (() => {
          const selectedInstance = config.qq.instances.find(i => i.instanceId === activeQQInstanceId);
          if (!selectedInstance) return null;
          const selectedStatus = status.qq?.instances?.find(s => s.instanceId === activeQQInstanceId);
          return (
            <QQInstanceSettings
              instance={selectedInstance}
              instanceStatus={selectedStatus}
              onConfigChange={(update) => {
                dispatch(setQQInstanceConfig({ instanceId: activeQQInstanceId, config: update }));
              }}
              onSave={async (override) => {
                const configToSave = override ? { ...selectedInstance, ...override } : selectedInstance;
                if (selectedInstance.enabled) {
                  await imService.updateQQInstanceConfig(activeQQInstanceId, configToSave);
                } else {
                  await imService.persistQQInstanceConfig(activeQQInstanceId, configToSave);
                }
              }}
              onRename={async (newName) => {
                dispatch(setQQInstanceConfig({ instanceId: activeQQInstanceId, config: { instanceName: newName } as any }));
                await imService.persistQQInstanceConfig(activeQQInstanceId, { instanceName: newName } as any);
              }}
              onDelete={async () => {
                await imService.deleteQQInstance(activeQQInstanceId);
                const remaining = config.qq.instances.filter(i => i.instanceId !== activeQQInstanceId);
                setActiveQQInstanceId(remaining.length > 0 ? remaining[0].instanceId : null);
              }}
              onToggleEnabled={async () => {
                const newEnabled = !selectedInstance.enabled;
                if (newEnabled && !(selectedInstance.appId && selectedInstance.appSecret)) return;
                const success = await imService.updateQQInstanceConfig(activeQQInstanceId, { enabled: newEnabled });
                if (success) {
                  dispatch(setQQInstanceConfig({ instanceId: activeQQInstanceId, config: { enabled: newEnabled } }));
                  if (newEnabled) dispatch(clearError());
                }
              }}
              onTestConnectivity={() => {
                void handleConnectivityTest('qq');
              }}
              testingPlatform={testingPlatform}
              connectivityResults={connectivityResults}
              language={language}
            />
          );
        })()}

        {/* Email Settings (multi-instance) */}
        {activePlatform === 'email' && !activeEmailInstanceId && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <img src={PlatformRegistry.logo('email')} alt="Email" className="w-12 h-12 object-contain rounded-md mb-4 opacity-50" />
            <p className="text-sm text-secondary mb-4">
              {config.email.instances.length === 0
                ? (language === 'zh' ? '尚未添加邮箱实例，点击下方按钮添加' : 'No Email instances yet. Click below to add one.')
                : (language === 'zh' ? '请在左侧选择一个邮箱实例' : 'Select an Email instance from the sidebar.')}
            </p>
            {config.email.instances.length < MAX_EMAIL_INSTANCES && (
              <button
                type="button"
                onClick={async (e) => {
                  e.stopPropagation();
                  const inst = await imService.addEmailInstance(`Email Bot ${config.email.instances.length + 1}`);
                  if (inst) { setActiveEmailInstanceId(inst.instanceId); setEmailExpanded(true); }
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                + {language === 'zh' ? '添加邮箱实例' : 'Add Email Instance'}
              </button>
            )}
          </div>
        )}
        {activePlatform === 'email' && activeEmailInstanceId && (() => {
          const selectedInstance = config.email.instances.find(i => i.instanceId === activeEmailInstanceId);
          if (!selectedInstance) return null;
          const selectedStatus = status.email?.instances?.find(s => s.instanceId === activeEmailInstanceId);
          const canEnable = Boolean(
            selectedInstance.email
            && (
              (selectedInstance.transport === 'imap' && selectedInstance.password)
              || (selectedInstance.transport === 'ws' && selectedInstance.apiKey)
            ),
          );
          return (
            <div className="space-y-4">
              <InlineInstanceList
                title={language === 'zh' ? '邮箱实例' : 'Email Instances'}
                hint={language === 'zh' ? '可为不同邮箱账号配置独立 Agent 绑定。' : 'Configure separate Agent bindings for different email accounts.'}
                primaryTag={language === 'zh' ? '主实例' : 'Primary'}
                emptyText={language === 'zh' ? '暂无邮箱实例' : 'No email instances yet'}
                addLabel={language === 'zh' ? '添加邮箱实例' : 'Add Email'}
                maxInstances={MAX_EMAIL_INSTANCES}
                instances={config.email.instances.map((instance) => ({
                  instanceId: instance.instanceId,
                  instanceName: instance.instanceName,
                  enabled: instance.enabled,
                  detail: instance.email || instance.transport,
                }))}
                activeInstanceId={activeEmailInstanceId}
                onSelect={setActiveEmailInstanceId}
                onAdd={async () => {
                  const inst = await imService.addEmailInstance(`Email Bot ${config.email.instances.length + 1}`);
                  if (inst) setActiveEmailInstanceId(inst.instanceId);
                }}
                onRename={(instanceId, name) => {
                  dispatch(setEmailInstanceConfig({ instanceId, config: { instanceName: name } }));
                  void imService.persistEmailInstanceConfig(instanceId, { instanceName: name });
                }}
                onDelete={async (instanceId) => {
                  await imService.deleteEmailInstance(instanceId);
                  const remaining = config.email.instances.filter((instance) => instance.instanceId !== instanceId);
                  setActiveEmailInstanceId(remaining.length > 0 ? remaining[0].instanceId : null);
                }}
              />

              <div className="rounded-xl border border-border-subtle bg-surface-raised/40 p-4 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">{selectedInstance.instanceName}</h4>
                    <p className="text-xs text-secondary">
                      {selectedStatus?.connected
                        ? (language === 'zh' ? '邮箱通道已启用' : 'Email channel is enabled')
                        : (language === 'zh' ? '配置邮箱地址和凭据后可启用' : 'Configure email credentials before enabling')}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!selectedInstance.enabled && !canEnable}
                    onClick={() => void toggleGateway('email')}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      selectedInstance.enabled ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                        selectedInstance.enabled ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-secondary">{i18nService.t('emailAddress')}</span>
                    <input
                      type="email"
                      value={selectedInstance.email}
                      onChange={(event) => handleEmailChange({ email: event.target.value })}
                      onBlur={() => void handleSaveEmailConfig()}
                      placeholder="bot@example.com"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-secondary">Agent ID</span>
                    <input
                      type="text"
                      value={selectedInstance.agentId}
                      onChange={(event) => handleEmailChange({ agentId: event.target.value || 'main' })}
                      onBlur={() => void handleSaveEmailConfig()}
                      placeholder="main"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-secondary">{language === 'zh' ? '传输模式' : 'Transport'}</span>
                    <select
                      value={selectedInstance.transport}
                      onChange={(event) => {
                        const transport = event.target.value as EmailInstanceConfig['transport'];
                        handleEmailChange({ transport });
                        void handleSaveEmailConfig({ transport });
                      }}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
                    >
                      <option value="ws">WebSocket API</option>
                      <option value="imap">IMAP / SMTP</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-secondary">
                      {selectedInstance.transport === 'imap' ? i18nService.t('emailPassword') : 'API Key'}
                    </span>
                    <div className="relative">
                      <input
                        type={showSecrets[`email.${selectedInstance.instanceId}.secret`] ? 'text' : 'password'}
                        value={selectedInstance.transport === 'imap' ? (selectedInstance.password || '') : (selectedInstance.apiKey || '')}
                        onChange={(event) => {
                          const value = event.target.value;
                          handleEmailChange(selectedInstance.transport === 'imap' ? { password: value } : { apiKey: value });
                        }}
                        onBlur={() => void handleSaveEmailConfig()}
                        placeholder={selectedInstance.transport === 'imap' ? i18nService.t('emailPasswordPlaceholder') : 'ck_...'}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-10 text-sm text-foreground outline-none focus:border-primary/50"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSecrets(prev => ({
                          ...prev,
                          [`email.${selectedInstance.instanceId}.secret`]: !prev[`email.${selectedInstance.instanceId}.secret`],
                        }))}
                        className="absolute inset-y-0 right-2 flex items-center text-secondary hover:text-foreground"
                      >
                        {showSecrets[`email.${selectedInstance.instanceId}.secret`] ? <EyeIcon className="h-4 w-4" /> : <EyeSlashIcon className="h-4 w-4" />}
                      </button>
                    </div>
                  </label>
                  {selectedInstance.transport === 'imap' && (
                    <>
                      <label className="space-y-1">
                        <span className="text-xs font-medium text-secondary">IMAP Host</span>
                        <input
                          type="text"
                          value={selectedInstance.imapHost || ''}
                          onChange={(event) => handleEmailChange({ imapHost: event.target.value })}
                          onBlur={() => void handleSaveEmailConfig()}
                          placeholder="imap.example.com"
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs font-medium text-secondary">SMTP Host</span>
                        <input
                          type="text"
                          value={selectedInstance.smtpHost || ''}
                          onChange={(event) => handleEmailChange({ smtpHost: event.target.value })}
                          onBlur={() => void handleSaveEmailConfig()}
                          placeholder="smtp.example.com"
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
                        />
                      </label>
                    </>
                  )}
                  <label className="space-y-1 md:col-span-2">
                    <span className="text-xs font-medium text-secondary">{language === 'zh' ? '允许发件人' : 'Allowed Senders'}</span>
                    <input
                      type="text"
                      value={(selectedInstance.allowFrom || ['*']).join(', ')}
                      onChange={(event) => handleEmailChange({
                        allowFrom: event.target.value.split(',').map((item) => item.trim()).filter(Boolean),
                      })}
                      onBlur={() => void handleSaveEmailConfig()}
                      placeholder="*, user@example.com, *.trusted.com"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSaveEmailConfig()}
                    className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover"
                  >
                    {i18nService.t('save')}
                  </button>
                  {renderConnectivityTestButton('email')}
                  {!canEnable && (
                    <span className="text-xs text-amber-600 dark:text-amber-400">
                      {language === 'zh' ? '启用前需要邮箱地址和对应凭据。' : 'Email address and credentials are required before enabling.'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Telegram Settings */}
        {activePlatform === 'telegram' && (
          <div className="space-y-3">
            <PlatformGuide
              steps={[
                i18nService.t('imTelegramGuideStep1'),
                i18nService.t('imTelegramGuideStep2'),
                i18nService.t('imTelegramGuideStep3'),
                i18nService.t('imTelegramGuideStep4'),
              ]}
                guideUrl={PlatformRegistry.guideUrl('telegram')}
            />
            {/* Bot Token */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-secondary">
                Bot Token
              </label>
              <div className="relative">
                <input
                  type={showSecrets['telegram.botToken'] ? 'text' : 'password'}
                  value={tgOpenClawConfig.botToken}
                  onChange={(e) => handleTelegramOpenClawChange({ botToken: e.target.value })}
                  onBlur={() => handleSaveTelegramOpenClawConfig()}
                  className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 pr-16 text-sm transition-colors"
                  placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                />
                <div className="absolute right-2 inset-y-0 flex items-center gap-1">
                  {tgOpenClawConfig.botToken && (
                    <button
                      type="button"
                      onClick={() => { handleTelegramOpenClawChange({ botToken: '' }); void imService.persistConfig({ telegram: { ...tgOpenClawConfig, botToken: '' } }); }}
                      className="p-0.5 rounded text-secondary hover:text-primary transition-colors"
                      title={i18nService.t('clear') || 'Clear'}
                    >
                      <XCircleIconSolid className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowSecrets(prev => ({ ...prev, 'telegram.botToken': !prev['telegram.botToken'] }))}
                    className="p-0.5 rounded text-secondary hover:text-primary transition-colors"
                    title={showSecrets['telegram.botToken'] ? (i18nService.t('hide') || 'Hide') : (i18nService.t('show') || 'Show')}
                  >
                    {showSecrets['telegram.botToken'] ? <EyeIcon className="h-4 w-4" /> : <EyeSlashIcon className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <p className="text-xs text-secondary">
                {i18nService.t('imTelegramTokenHint')}
              </p>
            </div>

            {/* Advanced Settings (collapsible) */}
            <details className="group">
              <summary className="cursor-pointer text-xs font-medium text-secondary hover:text-primary transition-colors">
                {i18nService.t('imAdvancedSettings')}
              </summary>
              <div className="mt-2 space-y-3 pl-2 border-l-2 border-border-subtle">
                {/* DM Policy */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">
                    DM Policy
                  </label>
                  <select
                    value={tgOpenClawConfig.dmPolicy}
                    onChange={(e) => {
                      const update = { dmPolicy: e.target.value as TelegramOpenClawConfig['dmPolicy'] };
                      handleTelegramOpenClawChange(update);
                      void handleSaveTelegramOpenClawConfig(update);
                    }}
                    className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                  >
                    <option value="pairing">{i18nService.t('imDmPolicyPairing')}</option>
                    <option value="allowlist">{i18nService.t('imDmPolicyAllowlist')}</option>
                    <option value="open">{i18nService.t('imDmPolicyOpen')}</option>
                    <option value="disabled">{i18nService.t('imDmPolicyDisabled')}</option>
                  </select>
                </div>

                {/* Pairing Requests (shown when dmPolicy is 'pairing') */}
                {tgOpenClawConfig.dmPolicy === 'pairing' && renderPairingSection('telegram')}

                {/* Allow From */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">
                    Allow From (User IDs)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={allowedUserIdInput}
                      onChange={(e) => setAllowedUserIdInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const id = allowedUserIdInput.trim();
                          if (id && !tgOpenClawConfig.allowFrom.includes(id)) {
                            const newIds = [...tgOpenClawConfig.allowFrom, id];
                            handleTelegramOpenClawChange({ allowFrom: newIds });
                            setAllowedUserIdInput('');
                            void imService.persistConfig({ telegram: { ...tgOpenClawConfig, allowFrom: newIds } });
                          }
                        }
                      }}
                      className="block flex-1 rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                      placeholder={i18nService.t('imTelegramUserIdPlaceholder')}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const id = allowedUserIdInput.trim();
                        if (id && !tgOpenClawConfig.allowFrom.includes(id)) {
                          const newIds = [...tgOpenClawConfig.allowFrom, id];
                          handleTelegramOpenClawChange({ allowFrom: newIds });
                          setAllowedUserIdInput('');
                          void imService.persistConfig({ telegram: { ...tgOpenClawConfig, allowFrom: newIds } });
                        }
                      }}
                      className="px-3 py-2 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                    >
                      {i18nService.t('add') || '添加'}
                    </button>
                  </div>
                  {tgOpenClawConfig.allowFrom.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {tgOpenClawConfig.allowFrom.map((id) => (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-surface border-border-subtle border text-foreground"
                        >
                          {id}
                          <button
                            type="button"
                            onClick={() => {
                              const newIds = tgOpenClawConfig.allowFrom.filter((uid) => uid !== id);
                              handleTelegramOpenClawChange({ allowFrom: newIds });
                              void imService.persistConfig({ telegram: { ...tgOpenClawConfig, allowFrom: newIds } });
                            }}
                            className="text-secondary hover:text-red-500 dark:hover:text-red-400 transition-colors"
                          >
                            <XMarkIcon className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Streaming Mode */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">
                    Streaming
                  </label>
                  <select
                    value={tgOpenClawConfig.streaming}
                    onChange={(e) => {
                      const update = { streaming: e.target.value as TelegramOpenClawConfig['streaming'] };
                      handleTelegramOpenClawChange(update);
                      void handleSaveTelegramOpenClawConfig(update);
                    }}
                    className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                  >
                    <option value="off">Off</option>
                    <option value="partial">Partial</option>
                    <option value="block">Block</option>
                    <option value="progress">Progress</option>
                  </select>
                </div>

                {/* Proxy */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">
                    Proxy
                  </label>
                  <input
                    type="text"
                    value={tgOpenClawConfig.proxy}
                    onChange={(e) => handleTelegramOpenClawChange({ proxy: e.target.value })}
                    onBlur={() => handleSaveTelegramOpenClawConfig()}
                    className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                    placeholder="socks5://localhost:9050"
                  />
                </div>

                {/* Group Policy */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">
                    Group Policy
                  </label>
                  <select
                    value={tgOpenClawConfig.groupPolicy}
                    onChange={(e) => {
                      const update = { groupPolicy: e.target.value as TelegramOpenClawConfig['groupPolicy'] };
                      handleTelegramOpenClawChange(update);
                      void handleSaveTelegramOpenClawConfig(update);
                    }}
                    className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                  >
                    <option value="allowlist">Allowlist</option>
                    <option value="open">Open</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </div>

                {/* Reply-to Mode */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">
                    Reply-to Mode
                  </label>
                  <select
                    value={tgOpenClawConfig.replyToMode}
                    onChange={(e) => {
                      const update = { replyToMode: e.target.value as TelegramOpenClawConfig['replyToMode'] };
                      handleTelegramOpenClawChange(update);
                      void handleSaveTelegramOpenClawConfig(update);
                    }}
                    className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                  >
                    <option value="off">Off</option>
                    <option value="first">First</option>
                    <option value="all">All</option>
                  </select>
                </div>

                {/* History Limit */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">
                    History Limit
                  </label>
                  <input
                    type="number"
                    value={tgOpenClawConfig.historyLimit}
                    onChange={(e) => handleTelegramOpenClawChange({ historyLimit: parseInt(e.target.value) || 50 })}
                    onBlur={() => handleSaveTelegramOpenClawConfig()}
                    className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                    min="1"
                    max="200"
                  />
                </div>

                {/* Media Max MB */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">
                    Media Max (MB)
                  </label>
                  <input
                    type="number"
                    value={tgOpenClawConfig.mediaMaxMb}
                    onChange={(e) => handleTelegramOpenClawChange({ mediaMaxMb: parseInt(e.target.value) || 5 })}
                    onBlur={() => handleSaveTelegramOpenClawConfig()}
                    className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                    min="1"
                    max="50"
                  />
                </div>

                {/* Link Preview */}
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-secondary">
                    Link Preview
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const update = { linkPreview: !tgOpenClawConfig.linkPreview };
                      handleTelegramOpenClawChange(update);
                      void handleSaveTelegramOpenClawConfig(update);
                    }}
                    className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                      tgOpenClawConfig.linkPreview ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
                    }`}
                  >
                    <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      tgOpenClawConfig.linkPreview ? 'translate-x-4' : 'translate-x-0'
                    }`} />
                  </button>
                </div>

                {/* Webhook URL */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">
                    Webhook URL
                  </label>
                  <input
                    type="text"
                    value={tgOpenClawConfig.webhookUrl}
                    onChange={(e) => handleTelegramOpenClawChange({ webhookUrl: e.target.value })}
                    onBlur={() => handleSaveTelegramOpenClawConfig()}
                    className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                    placeholder="https://example.com/telegram-webhook"
                  />
                </div>

                {/* Webhook Secret */}
                {tgOpenClawConfig.webhookUrl && (
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-secondary">
                      Webhook Secret
                    </label>
                    <input
                      type="password"
                      value={tgOpenClawConfig.webhookSecret}
                      onChange={(e) => handleTelegramOpenClawChange({ webhookSecret: e.target.value })}
                      onBlur={() => handleSaveTelegramOpenClawConfig()}
                      className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                      placeholder="webhook-secret"
                    />
                  </div>
                )}
              </div>
            </details>

            <div className="pt-1">
              {renderConnectivityTestButton('telegram')}
            </div>
          </div>
        )}

        {/* Discord Settings */}
        {activePlatform === 'discord' && (
          <div className="space-y-3">
            <PlatformGuide
              steps={[
                i18nService.t('imDiscordGuideStep1'),
                i18nService.t('imDiscordGuideStep2'),
                i18nService.t('imDiscordGuideStep3'),
                i18nService.t('imDiscordGuideStep4'),
                i18nService.t('imDiscordGuideStep5'),
                i18nService.t('imDiscordGuideStep6'),
              ]}
                guideUrl={PlatformRegistry.guideUrl('discord')}
            />
            {/* Bot Token */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-secondary">
                Bot Token
              </label>
              <div className="relative">
                <input
                  type={showSecrets['discord.botToken'] ? 'text' : 'password'}
                  value={dcOpenClawConfig.botToken}
                  onChange={(e) => handleDiscordOpenClawChange({ botToken: e.target.value })}
                  onBlur={() => handleSaveDiscordOpenClawConfig()}
                  className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 pr-16 text-sm transition-colors"
                  placeholder="MTIzNDU2Nzg5MDEyMzQ1Njc4OQ..."
                />
                <div className="absolute right-2 inset-y-0 flex items-center gap-1">
                  {dcOpenClawConfig.botToken && (
                    <button
                      type="button"
                      onClick={() => { handleDiscordOpenClawChange({ botToken: '' }); void imService.persistConfig({ discord: { ...dcOpenClawConfig, botToken: '' } }); }}
                      className="p-0.5 rounded text-secondary hover:text-primary transition-colors"
                      title={i18nService.t('clear') || 'Clear'}
                    >
                      <XCircleIconSolid className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowSecrets(prev => ({ ...prev, 'discord.botToken': !prev['discord.botToken'] }))}
                    className="p-0.5 rounded text-secondary hover:text-primary transition-colors"
                    title={showSecrets['discord.botToken'] ? (i18nService.t('hide') || 'Hide') : (i18nService.t('show') || 'Show')}
                  >
                    {showSecrets['discord.botToken'] ? <EyeIcon className="h-4 w-4" /> : <EyeSlashIcon className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <p className="text-xs text-secondary">
                {i18nService.t('imDiscordTokenHint')}
              </p>
            </div>

            {/* Advanced Settings (collapsible) */}
            <details className="group">
              <summary className="cursor-pointer text-xs font-medium text-secondary hover:text-primary transition-colors">
                {i18nService.t('imAdvancedSettings')}
              </summary>
              <div className="mt-2 space-y-3 pl-2 border-l-2 border-border-subtle">
                {/* DM Policy */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">
                    DM Policy
                  </label>
                  <select
                    value={dcOpenClawConfig.dmPolicy}
                    onChange={(e) => {
                      const update = { dmPolicy: e.target.value as DiscordOpenClawConfig['dmPolicy'] };
                      handleDiscordOpenClawChange(update);
                      void handleSaveDiscordOpenClawConfig(update);
                    }}
                    className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                  >
                    <option value="pairing">{i18nService.t('imDmPolicyPairing')}</option>
                    <option value="allowlist">{i18nService.t('imDmPolicyAllowlist')}</option>
                    <option value="open">{i18nService.t('imDmPolicyOpen')}</option>
                    <option value="disabled">{i18nService.t('imDmPolicyDisabled')}</option>
                  </select>
                </div>

                {/* Pairing Requests (shown when dmPolicy is 'pairing') */}
                {dcOpenClawConfig.dmPolicy === 'pairing' && renderPairingSection('discord')}

                {/* Allow From (User IDs) */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">
                    Allow From (User IDs)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={discordAllowedUserIdInput}
                      onChange={(e) => setDiscordAllowedUserIdInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const id = discordAllowedUserIdInput.trim();
                          if (id && !dcOpenClawConfig.allowFrom.includes(id)) {
                            const newIds = [...dcOpenClawConfig.allowFrom, id];
                            handleDiscordOpenClawChange({ allowFrom: newIds });
                            setDiscordAllowedUserIdInput('');
                            void imService.persistConfig({ discord: { ...dcOpenClawConfig, allowFrom: newIds } });
                          }
                        }
                      }}
                      className="block flex-1 rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                      placeholder={i18nService.t('imDiscordUserIdPlaceholder')}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const id = discordAllowedUserIdInput.trim();
                        if (id && !dcOpenClawConfig.allowFrom.includes(id)) {
                          const newIds = [...dcOpenClawConfig.allowFrom, id];
                          handleDiscordOpenClawChange({ allowFrom: newIds });
                          setDiscordAllowedUserIdInput('');
                          void imService.persistConfig({ discord: { ...dcOpenClawConfig, allowFrom: newIds } });
                        }
                      }}
                      className="px-3 py-2 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                    >
                      {i18nService.t('add') || '添加'}
                    </button>
                  </div>
                  {dcOpenClawConfig.allowFrom.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {dcOpenClawConfig.allowFrom.map((id) => (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-surface border-border-subtle border text-foreground"
                        >
                          {id}
                          <button
                            type="button"
                            onClick={() => {
                              const newIds = dcOpenClawConfig.allowFrom.filter((uid) => uid !== id);
                              handleDiscordOpenClawChange({ allowFrom: newIds });
                              void imService.persistConfig({ discord: { ...dcOpenClawConfig, allowFrom: newIds } });
                            }}
                            className="text-secondary hover:text-red-500 transition-colors"
                          >
                            <XMarkIcon className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Streaming */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">
                    Streaming
                  </label>
                  <select
                    value={dcOpenClawConfig.streaming}
                    onChange={(e) => {
                      const update = { streaming: e.target.value as DiscordOpenClawConfig['streaming'] };
                      handleDiscordOpenClawChange(update);
                      void handleSaveDiscordOpenClawConfig(update);
                    }}
                    className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                  >
                    <option value="off">Off</option>
                    <option value="partial">Partial</option>
                    <option value="block">Block</option>
                    <option value="progress">Progress</option>
                  </select>
                </div>

                {/* Proxy */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">
                    Proxy
                  </label>
                  <input
                    type="text"
                    value={dcOpenClawConfig.proxy}
                    onChange={(e) => handleDiscordOpenClawChange({ proxy: e.target.value })}
                    onBlur={() => handleSaveDiscordOpenClawConfig()}
                    className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                    placeholder="http://proxy:port"
                  />
                </div>

                {/* Group Policy */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">
                    Group Policy
                  </label>
                  <select
                    value={dcOpenClawConfig.groupPolicy}
                    onChange={(e) => {
                      const update = { groupPolicy: e.target.value as DiscordOpenClawConfig['groupPolicy'] };
                      handleDiscordOpenClawChange(update);
                      void handleSaveDiscordOpenClawConfig(update);
                    }}
                    className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                  >
                    <option value="allowlist">{i18nService.t('imGroupPolicyAllowlist')}</option>
                    <option value="open">{i18nService.t('imGroupPolicyOpen')}</option>
                    <option value="disabled">{i18nService.t('imGroupPolicyDisabled')}</option>
                  </select>
                </div>

                {/* Group Allow From (Server IDs) */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">
                    Group Allow From (Server IDs)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={discordServerAllowIdInput}
                      onChange={(e) => setDiscordServerAllowIdInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const id = discordServerAllowIdInput.trim();
                          if (id && !dcOpenClawConfig.groupAllowFrom.includes(id)) {
                            const newIds = [...dcOpenClawConfig.groupAllowFrom, id];
                            handleDiscordOpenClawChange({ groupAllowFrom: newIds });
                            setDiscordServerAllowIdInput('');
                            void imService.persistConfig({ discord: { ...dcOpenClawConfig, groupAllowFrom: newIds } });
                          }
                        }
                      }}
                      className="block flex-1 rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                      placeholder={i18nService.t('imDiscordServerIdPlaceholder')}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const id = discordServerAllowIdInput.trim();
                        if (id && !dcOpenClawConfig.groupAllowFrom.includes(id)) {
                          const newIds = [...dcOpenClawConfig.groupAllowFrom, id];
                          handleDiscordOpenClawChange({ groupAllowFrom: newIds });
                          setDiscordServerAllowIdInput('');
                          void imService.persistConfig({ discord: { ...dcOpenClawConfig, groupAllowFrom: newIds } });
                        }
                      }}
                      className="px-3 py-2 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                    >
                      {i18nService.t('add') || '添加'}
                    </button>
                  </div>
                  {dcOpenClawConfig.groupAllowFrom.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {dcOpenClawConfig.groupAllowFrom.map((id) => (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-surface border-border-subtle border text-foreground"
                        >
                          {id}
                          <button
                            type="button"
                            onClick={() => {
                              const newIds = dcOpenClawConfig.groupAllowFrom.filter((gid) => gid !== id);
                              handleDiscordOpenClawChange({ groupAllowFrom: newIds });
                              void imService.persistConfig({ discord: { ...dcOpenClawConfig, groupAllowFrom: newIds } });
                            }}
                            className="text-secondary hover:text-red-500 transition-colors"
                          >
                            <XMarkIcon className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* History Limit */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">
                    History Limit
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={dcOpenClawConfig.historyLimit}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 50;
                      handleDiscordOpenClawChange({ historyLimit: val });
                    }}
                    onBlur={() => handleSaveDiscordOpenClawConfig()}
                    className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                  />
                </div>

                {/* Media Max MB */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">
                    Media Max MB
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={dcOpenClawConfig.mediaMaxMb}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 25;
                      handleDiscordOpenClawChange({ mediaMaxMb: val });
                    }}
                    onBlur={() => handleSaveDiscordOpenClawConfig()}
                    className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                  />
                </div>
              </div>
            </details>

            <div className="pt-1">
              {renderConnectivityTestButton('discord')}
            </div>

            {/* Bot username display */}
            {status.discord.botUsername && (
              <div className="text-xs text-green-600 dark:text-green-400 bg-green-500/10 px-3 py-2 rounded-lg">
                Bot: {status.discord.botUsername}
              </div>
            )}

            {/* Error display */}
            {status.discord.lastError && (
              <div className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">
                {status.discord.lastError}
              </div>
            )}
          </div>
        )}

        {/* NIM (NetEase IM) Settings */}
        {activePlatform === 'nim' && (
          <div className="space-y-3">
            <div className="rounded-lg border border-dashed border-border-subtle p-4 text-center space-y-3">
              {(nimQrStatus === 'idle' || nimQrStatus === 'error') && (
                <>
                  <button
                    type="button"
                    onClick={() => void handleNimQrLogin()}
                    className="px-4 py-2.5 rounded-lg text-sm font-medium bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {i18nService.t('imNimQrLogin')}
                  </button>
                  <p className="text-xs text-secondary">
                    {i18nService.t('imNimQrLoginHint')}
                  </p>
                  {nimQrStatus === 'error' && nimQrError && (
                    <div className="flex flex-col items-center gap-2">
                      <div className="flex items-center justify-center gap-1.5 text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">
                        <XCircleIcon className="h-4 w-4 flex-shrink-0" />
                        {nimQrError}
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleNimQrLogin()}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-raised text-foreground hover:bg-surface transition-colors"
                      >
                        {i18nService.t('imNimQrRefresh')}
                      </button>
                    </div>
                  )}
                </>
              )}
              {nimQrStatus === 'loading' && (
                <div className="flex flex-col items-center gap-2 py-2">
                  <ArrowPathIcon className="h-7 w-7 text-primary animate-spin" />
                  <span className="text-xs text-secondary">{i18nService.t('imNimQrGenerating')}</span>
                </div>
              )}
              {nimQrStatus === 'showing' && nimQrValue && (
                <div className="flex flex-col items-center gap-2">
                  <div className="p-2 bg-white rounded-lg inline-block">
                    <QRCodeSVG value={nimQrValue} size={160} />
                  </div>
                  <p className="text-xs text-secondary max-w-[240px]">
                    {i18nService.t('imNimQrScanPrompt')}
                  </p>
                  <p className="text-xs text-secondary">
                    {i18nService.t('imNimQrExpiresIn').replace('{seconds}', String(nimQrTimeLeft))}
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => void handleNimQrLogin()}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-raised text-foreground hover:bg-surface transition-colors"
                    >
                      {i18nService.t('imNimQrRefresh')}
                    </button>
                    <button
                      type="button"
                      onClick={resetNimQrState}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-raised text-secondary hover:bg-surface transition-colors"
                    >
                      {i18nService.t('imNimQrCancel')}
                    </button>
                  </div>
                </div>
              )}
              {nimQrStatus === 'success' && (
                <div className="flex items-center justify-center gap-1.5 text-xs text-green-600 dark:text-green-400 bg-green-500/10 px-3 py-2 rounded-lg">
                  <CheckCircleIcon className="h-4 w-4 flex-shrink-0" />
                  {i18nService.t('imNimQrSuccess')}
                </div>
              )}
            </div>

            <PlatformGuide
              title={i18nService.t('nimCredentialsGuide')}
              steps={[
                i18nService.t('nimGuideStep1'),
                i18nService.t('nimGuideStep2'),
                i18nService.t('nimGuideStep3'),
                i18nService.t('nimGuideStep4'),
              ]}
            />

            <NimInstanceSummary instances={config.nim.instances} />

            <InlineInstanceList
              title={i18nService.t('nimInstancesTitle')}
              hint={i18nService.t('nimInstancesEditHint')}
              primaryTag={i18nService.t('nimInstancesPrimaryTag')}
              emptyText={i18nService.t('nimInstancesEmpty')}
              addLabel={i18nService.t('imNimAddInstance')}
              maxInstances={MAX_NIM_INSTANCES}
              instances={config.nim.instances.map((instance) => ({
                instanceId: instance.instanceId,
                instanceName: instance.instanceName,
                enabled: instance.enabled,
                detail: instance.account || instance.appKey || instance.instanceId,
              }))}
              activeInstanceId={activeNimInstance?.instanceId ?? null}
              onSelect={setActiveNimInstanceId}
              onAdd={async () => {
                const inst = await imService.addNimInstance(`NIM Bot ${config.nim.instances.length + 1}`);
                if (inst) {
                  setActiveNimInstanceId(inst.instanceId);
                  setNimExpanded(true);
                }
              }}
              onRename={(instanceId, name) => {
                dispatch(setNimInstanceConfig({ instanceId, config: { instanceName: name } }));
                void imService.updateNimInstanceConfig(instanceId, { instanceName: name }, { syncGateway: false });
              }}
              onDelete={(instanceId) => {
                void imService.deleteNimInstance(instanceId).then((success) => {
                  if (!success) return;
                  const remaining = config.nim.instances.filter((instance) => instance.instanceId !== instanceId);
                  setActiveNimInstanceId(remaining[0]?.instanceId ?? null);
                });
              }}
            />

            {nimSchemaData ? (
              <SchemaForm
                schema={nimSchemaData.schema}
                hints={nimSchemaData.hints}
                value={nimConfig as unknown as Record<string, unknown>}
                onChange={(path, value) => {
                  const updated = deepSet({ ...nimConfig } as unknown as Record<string, unknown>, path, value);
                  dispatch(setNimInstanceConfig({ instanceId: nimConfig.instanceId, config: updated as Partial<NimInstanceConfig> }));
                }}
                onBlur={handleSaveConfig}
                showSecrets={showSecrets}
                onToggleSecret={(path) => setShowSecrets(prev => ({ ...prev, [path]: !prev[path] }))}
              />
            ) : (
              /* Fallback: minimal credential inputs when schema not yet loaded */
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">App Key</label>
                  <input
                    type="text"
                    value={nimConfig.appKey}
                    onChange={(e) => dispatch(setNimInstanceConfig({ instanceId: nimConfig.instanceId, config: { appKey: e.target.value } }))}
                    onBlur={handleSaveConfig}
                    className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                    placeholder="your_app_key"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">Account</label>
                  <input
                    type="text"
                    value={nimConfig.account}
                    onChange={(e) => dispatch(setNimInstanceConfig({ instanceId: nimConfig.instanceId, config: { account: e.target.value } }))}
                    onBlur={handleSaveConfig}
                    className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                    placeholder="bot_account_id"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">Token</label>
                  <input
                    type="password"
                    value={nimConfig.token}
                    onChange={(e) => dispatch(setNimInstanceConfig({ instanceId: nimConfig.instanceId, config: { token: e.target.value } }))}
                    onBlur={handleSaveConfig}
                    className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                    placeholder="••••••••••••"
                  />
                </div>
              </div>
            )}

            <div className="pt-1">
              {renderConnectivityTestButton('nim')}
            </div>

            {status.nim.botAccount && (
              <div className="text-xs text-green-600 dark:text-green-400 bg-green-500/10 px-3 py-2 rounded-lg">
                Account: {status.nim.botAccount}
              </div>
            )}

            {status.nim.lastError && (
              <div className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">
                {translateIMError(status.nim.lastError)}
              </div>
            )}
          </div>
        )}

        {/* 小蜜蜂设置*/}
        {activePlatform === 'netease-bee' && (
          <div className="space-y-3">
            {/* Client ID */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-secondary">
                Client ID
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={config['netease-bee'].clientId}
                  onChange={(e) => handleNeteaseBeeChanChange('clientId', e.target.value)}
                  onBlur={handleSaveConfig}
                  className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 pr-8 text-sm transition-colors"
                  placeholder={i18nService.t('neteaseBeeChanClientIdPlaceholder') || '您的Client ID'}
                />
                {config['netease-bee'].clientId && (
                  <div className="absolute right-2 inset-y-0 flex items-center">
                    <button
                      type="button"
                      onClick={() => { handleNeteaseBeeChanChange('clientId', ''); void imService.persistConfig({ 'netease-bee': { ...config['netease-bee'], clientId: '' } }); }}
                      className="p-0.5 rounded text-secondary hover:text-primary transition-colors"
                      title={i18nService.t('clear') || 'Clear'}
                    >
                      <XCircleIconSolid className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Client Secret */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-secondary">
                Client Secret
              </label>
              <div className="relative">
                <input
                  type={showSecrets['netease-bee.secret'] ? 'text' : 'password'}
                  value={config['netease-bee'].secret}
                  onChange={(e) => handleNeteaseBeeChanChange('secret', e.target.value)}
                  onBlur={handleSaveConfig}
                  className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 pr-16 text-sm transition-colors"
                  placeholder="••••••••••••"
                />
                <div className="absolute right-2 inset-y-0 flex items-center gap-1">
                  {config['netease-bee'].secret && (
                    <button
                      type="button"
                      onClick={() => { handleNeteaseBeeChanChange('secret', ''); void imService.persistConfig({ 'netease-bee': { ...config['netease-bee'], secret: '' } }); }}
                      className="p-0.5 rounded text-secondary hover:text-primary transition-colors"
                      title={i18nService.t('clear') || 'Clear'}
                    >
                      <XCircleIconSolid className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowSecrets(prev => ({ ...prev, 'netease-bee.secret': !prev['netease-bee.secret'] }))}
                    className="p-0.5 rounded text-secondary hover:text-primary transition-colors"
                    title={showSecrets['netease-bee.secret'] ? (i18nService.t('hide') || 'Hide') : (i18nService.t('show') || 'Show')}
                  >
                    {showSecrets['netease-bee.secret'] ? <EyeIcon className="h-4 w-4" /> : <EyeSlashIcon className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="pt-1">
              {renderConnectivityTestButton('netease-bee')}
            </div>

            {/* Bot account display */}
            {status['netease-bee']?.botAccount && (
              <div className="text-xs text-green-600 dark:text-green-400 bg-green-500/10 px-3 py-2 rounded-lg">
                Account: {status['netease-bee'].botAccount}
              </div>
            )}

            {/* Error display */}
            {status['netease-bee']?.lastError && (
              <div className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">
                {translateIMError(status['netease-bee'].lastError)}
              </div>
            )}
          </div>
        )}

        {/* Weixin (微信) Settings */}
        {activePlatform === 'weixin' && (
          <div className="space-y-3">
            {/* Scan QR code section */}
            <div className="rounded-lg border border-dashed border-border-subtle p-4 text-center space-y-3">
              {(weixinQrStatus === 'idle' || weixinQrStatus === 'error') && (
                <>
                  <button
                    type="button"
                    onClick={() => void handleWeixinQrLogin()}
                    className="px-4 py-2.5 rounded-lg text-sm font-medium bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {i18nService.t('imWeixinScanBtn')}
                  </button>
                  <p className="text-xs text-secondary">
                    {i18nService.t('imWeixinScanHint')}
                  </p>
                  {weixinQrStatus === 'error' && weixinQrError && (
                    <div className="flex items-center justify-center gap-1.5 text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">
                      <XCircleIcon className="h-4 w-4 flex-shrink-0" />
                      {weixinQrError}
                    </div>
                  )}
                </>
              )}
              {weixinQrStatus === 'loading' && (
                <div className="flex items-center justify-center gap-2 py-4">
                  <ArrowPathIcon className="h-5 w-5 animate-spin text-primary" />
                  <span className="text-sm text-secondary">
                    {i18nService.t('imWeixinQrLoading')}
                  </span>
                </div>
              )}
              {(weixinQrStatus === 'showing' || weixinQrStatus === 'waiting') && weixinQrUrl && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-foreground">
                    {i18nService.t('imWeixinQrScanPrompt')}
                  </p>
                  <div className="flex justify-center">
                    <div className="p-3 bg-white rounded-lg border border-border-subtle">
                      <QRCodeSVG value={weixinQrUrl} size={192} />
                    </div>
                  </div>
                </div>
              )}
              {weixinQrStatus === 'success' && (
                <div className="flex items-center justify-center gap-1.5 text-xs text-green-600 dark:text-green-400 bg-green-500/10 px-3 py-2 rounded-lg">
                  <CheckCircleIcon className="h-4 w-4 flex-shrink-0" />
                  {i18nService.t('imWeixinQrSuccess')}
                </div>
              )}
            </div>

            {/* Platform Guide */}
            <PlatformGuide
              steps={[
                i18nService.t('imWeixinGuideStep1'),
                i18nService.t('imWeixinGuideStep2'),
                i18nService.t('imWeixinGuideStep3'),
              ]}
                guideUrl={PlatformRegistry.guideUrl('weixin')}
            />

            {/* Connectivity test */}
            <div className="pt-1">
              {renderConnectivityTestButton('weixin')}
            </div>

            {/* Account ID display */}
            {weixinAccountId && (
              <div className="text-xs text-green-600 dark:text-green-400 bg-green-500/10 px-3 py-2 rounded-lg">
                Account ID: {weixinAccountId}
              </div>
            )}

            {/* Advanced Settings (collapsible) */}
            <details className="group">
              <summary className="cursor-pointer text-xs font-medium text-secondary hover:text-primary transition-colors">
                {i18nService.t('imAdvancedSettings')}
              </summary>
              <div className="mt-2 space-y-3 pl-2 border-l-2 border-border-subtle">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">
                    DM Policy
                  </label>
                  <select
                    value={weixinOpenClawConfig.dmPolicy}
                    onChange={(e) => {
                      const update = { dmPolicy: e.target.value as WeixinOpenClawConfig['dmPolicy'] };
                      handleWeixinChange(update);
                      void handleSaveWeixinConfig(update);
                    }}
                    className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                  >
                    <option value="open">{i18nService.t('imDmPolicyOpen')}</option>
                    <option value="pairing">{i18nService.t('imDmPolicyPairing')}</option>
                    <option value="allowlist">{i18nService.t('imDmPolicyAllowlist')}</option>
                    <option value="disabled">{i18nService.t('imDmPolicyDisabled')}</option>
                  </select>
                </div>

                {weixinOpenClawConfig.dmPolicy === 'pairing' && renderPairingSection('weixin')}

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">
                    Allow From (User IDs)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={weixinAllowedUserIdInput}
                      onChange={(e) => setWeixinAllowedUserIdInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const id = weixinAllowedUserIdInput.trim();
                          if (id && !weixinOpenClawConfig.allowFrom.includes(id)) {
                            const newIds = [...weixinOpenClawConfig.allowFrom, id];
                            handleWeixinChange({ allowFrom: newIds });
                            setWeixinAllowedUserIdInput('');
                            void handleSaveWeixinConfig({ allowFrom: newIds });
                          }
                        }
                      }}
                      className="block flex-1 rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                      placeholder="wxid_xxx@im.wechat"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const id = weixinAllowedUserIdInput.trim();
                        if (id && !weixinOpenClawConfig.allowFrom.includes(id)) {
                          const newIds = [...weixinOpenClawConfig.allowFrom, id];
                          handleWeixinChange({ allowFrom: newIds });
                          setWeixinAllowedUserIdInput('');
                          void handleSaveWeixinConfig({ allowFrom: newIds });
                        }
                      }}
                      className="px-3 py-2 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                    >
                      {i18nService.t('add') || '添加'}
                    </button>
                  </div>
                  {weixinOpenClawConfig.allowFrom.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {weixinOpenClawConfig.allowFrom.map((id) => (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-surface border-border-subtle border text-foreground"
                        >
                          {id}
                          <button
                            type="button"
                            onClick={() => {
                              const newIds = weixinOpenClawConfig.allowFrom.filter((uid) => uid !== id);
                              handleWeixinChange({ allowFrom: newIds });
                              void handleSaveWeixinConfig({ allowFrom: newIds });
                            }}
                            className="text-secondary hover:text-red-500 dark:hover:text-red-400 transition-colors"
                          >
                            <XMarkIcon className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </details>

            {/* Error display */}
            {status.weixin?.lastError && (
              <div className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">
                {status.weixin.lastError}
              </div>
            )}
          </div>
        )}

        {/* WeCom (企业微信) Multi-Instance Settings */}
        {activePlatform === 'wecom' && (() => {
          const wecomMultiConfig = config.wecom;
          const activeWecomInstance = activeWecomInstanceId
            ? wecomMultiConfig.instances.find(i => i.instanceId === activeWecomInstanceId)
            : null;
          const activeWecomStatus = activeWecomInstanceId
            ? status.wecom?.instances?.find(s => s.instanceId === activeWecomInstanceId)
            : undefined;

          if (activeWecomInstance) {
            return (
              <WecomInstanceSettings
                instance={activeWecomInstance}
                instanceStatus={activeWecomStatus}
                onConfigChange={(update) => {
                  dispatch(setWecomInstanceConfig({ instanceId: activeWecomInstanceId!, config: update }));
                }}
                onSave={async (override) => {
                  if (!configLoaded) return;
                  const configToSave = override
                    ? { ...activeWecomInstance, ...override }
                    : activeWecomInstance;
                  await imService.persistWecomInstanceConfig(activeWecomInstanceId!, configToSave);
                }}
                onRename={async (newName) => {
                  dispatch(setWecomInstanceConfig({ instanceId: activeWecomInstanceId!, config: { instanceName: newName } as any }));
                  await imService.persistWecomInstanceConfig(activeWecomInstanceId!, { instanceName: newName } as any);
                }}
                onDelete={async () => {
                  await imService.deleteWecomInstance(activeWecomInstanceId!);
                  setActiveWecomInstanceId(null);
                }}
                onToggleEnabled={async () => {
                  const newEnabled = !activeWecomInstance.enabled;
                  dispatch(setWecomInstanceConfig({ instanceId: activeWecomInstanceId!, config: { enabled: newEnabled } }));
                  await imService.updateWecomInstanceConfig(activeWecomInstanceId!, { enabled: newEnabled });
                }}
                onTestConnectivity={() => void handleConnectivityTest('wecom')}
                onQuickSetup={async () => {
                  setWecomQuickSetupStatus('pending');
                  setWecomQuickSetupError('');
                  try {
                    const bot = await WecomAIBotSDK.openBotInfoAuthWindow({ source: 'lobster-ai' });
                    if (!isMountedRef.current) return;
                    dispatch(setWecomInstanceConfig({ instanceId: activeWecomInstanceId!, config: { botId: bot.botid, secret: bot.secret, enabled: true } }));
                    dispatch(clearError());
                    await imService.updateWecomInstanceConfig(activeWecomInstanceId!, { botId: bot.botid, secret: bot.secret, enabled: true });
                    if (!isMountedRef.current) return;
                    await imService.loadStatus();
                    if (!isMountedRef.current) return;
                    setWecomQuickSetupStatus('success');
                  } catch (error: unknown) {
                    if (!isMountedRef.current) return;
                    setWecomQuickSetupStatus('error');
                    const err = error as { message?: string; code?: string };
                    setWecomQuickSetupError(err.message || err.code || 'Unknown error');
                  }
                }}
                quickSetupStatus={wecomQuickSetupStatus}
                quickSetupError={wecomQuickSetupError}
                testingPlatform={testingPlatform}
                connectivityResults={connectivityResults as Record<string, IMConnectivityTestResult>}
                language={language}
                renderPairingSection={renderPairingSection}
              />
            );
          }

          // No instance selected - show placeholder
          return (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <img src={PlatformRegistry.logo('wecom')} alt="WeCom" className="w-12 h-12 object-contain rounded-md mb-4 opacity-50" />
              <p className="text-sm text-secondary mb-4">
                {wecomMultiConfig.instances.length === 0
                  ? (language === 'zh' ? '尚未添加企业微信实例，点击下方按钮添加' : 'No WeCom instances yet. Click below to add one.')
                  : (language === 'zh' ? '请在左侧选择一个企业微信实例' : 'Select a WeCom instance from the sidebar.')}
              </p>
              {wecomMultiConfig.instances.length < MAX_WECOM_INSTANCES && (
                <button
                  type="button"
                  onClick={async (e) => {
                    e.stopPropagation();
                    const name = `WeCom Bot ${wecomMultiConfig.instances.length + 1}`;
                    const inst = await imService.addWecomInstance(name);
                    if (inst) {
                      setActiveWecomInstanceId(inst.instanceId);
                      setWecomExpanded(true);
                    }
                  }}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                >
                  + {i18nService.t('imWecomAddInstance')}
                </button>
              )}
            </div>
          );
        })()}

        {activePlatform === 'popo' && (
          <div className="space-y-3">
            {/* Scan QR code section */}
            <div className="rounded-lg border border-dashed border-border-subtle p-4 text-center space-y-3">
              {(popoQrStatus === 'idle' || popoQrStatus === 'error') && (
                <>
                  <button
                    type="button"
                    onClick={() => void handlePopoQrLogin()}
                    className="px-4 py-2.5 rounded-lg text-sm font-medium bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {i18nService.t('imPopoScanBtn')}
                  </button>
                  <p className="text-xs text-secondary">
                    {i18nService.t('imPopoScanHint')}
                  </p>
                  {popoQrStatus === 'error' && popoQrError && (
                    <div className="flex items-center justify-center gap-1.5 text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">
                      <XCircleIcon className="h-4 w-4 flex-shrink-0" />
                      {popoQrError}
                    </div>
                  )}
                </>
              )}
              {popoQrStatus === 'loading' && (
                <div className="flex items-center justify-center gap-2 py-4">
                  <ArrowPathIcon className="h-5 w-5 animate-spin text-primary" />
                  <span className="text-sm text-secondary">
                    {i18nService.t('imPopoQrLoading')}
                  </span>
                </div>
              )}
              {(popoQrStatus === 'showing' || popoQrStatus === 'waiting') && popoQrUrl && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-foreground">
                    {i18nService.t('imPopoQrScanPrompt')}
                  </p>
                  <div className="flex justify-center">
                    <div className="p-3 bg-white rounded-lg border border-border-subtle">
                      <QRCodeSVG value={popoQrUrl} size={192} />
                    </div>
                  </div>
                  {popoQrStatus === 'waiting' && (
                    <p className="text-xs text-secondary animate-pulse">
                      {i18nService.t('imPopoQrWaiting')}
                    </p>
                  )}
                </div>
              )}
              {popoQrStatus === 'success' && (
                <div className="flex items-center justify-center gap-1.5 text-xs text-green-600 dark:text-green-400 bg-green-500/10 px-3 py-2 rounded-lg">
                  <CheckCircleIcon className="h-4 w-4 flex-shrink-0" />
                  {i18nService.t('imPopoQrSuccess')}
                </div>
              )}
            </div>

            {/* Platform Guide */}
            <PlatformGuide
              steps={[
                i18nService.t('imPopoGuideStep1'),
                i18nService.t('imPopoGuideStep2'),
                i18nService.t('imPopoGuideStep3'),
              ]}
                guideUrl={PlatformRegistry.guideUrl('popo')}
            />

            <PopoInstanceSummary instances={config.popo.instances} />

            <InlineInstanceList
              title={i18nService.t('popoInstancesTitle')}
              hint={i18nService.t('popoInstancesEditHint')}
              primaryTag={i18nService.t('popoInstancesPrimaryTag')}
              emptyText={i18nService.t('popoInstancesEmpty')}
              addLabel={i18nService.t('imPopoAddInstance')}
              maxInstances={MAX_POPO_INSTANCES}
              instances={config.popo.instances.map((instance) => ({
                instanceId: instance.instanceId,
                instanceName: instance.instanceName,
                enabled: instance.enabled,
                detail: instance.appKey || instance.instanceId,
              }))}
              activeInstanceId={activePopoInstance?.instanceId ?? null}
              onSelect={setActivePopoInstanceId}
              onAdd={async () => {
                const inst = await imService.addPopoInstance(`POPO Bot ${config.popo.instances.length + 1}`);
                if (inst) {
                  setActivePopoInstanceId(inst.instanceId);
                  setPopoExpanded(true);
                }
              }}
              onRename={(instanceId, name) => {
                dispatch(setPopoInstanceConfig({ instanceId, config: { instanceName: name } }));
                void imService.updatePopoInstanceConfig(instanceId, { instanceName: name }, { syncGateway: false });
              }}
              onDelete={(instanceId) => {
                void imService.deletePopoInstance(instanceId).then((success) => {
                  if (!success) return;
                  const remaining = config.popo.instances.filter((instance) => instance.instanceId !== instanceId);
                  setActivePopoInstanceId(remaining[0]?.instanceId ?? null);
                });
              }}
            />

            {/* Bound status badge */}
            {popoConfig.appKey && (
              <div className="text-xs text-green-600 dark:text-green-400 bg-green-500/10 px-3 py-2 rounded-lg">
                AppKey: {popoConfig.appKey}
              </div>
            )}

            {/* AES Key input */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-secondary">AES Key</label>
              <div className="relative">
                <input
                  type={showSecrets['popo.aesKey'] ? 'text' : 'password'}
                  value={popoConfig.aesKey}
                  onChange={(e) => handlePopoChange({ aesKey: e.target.value })}
                  onBlur={() => void handleSavePopoConfig()}
                  placeholder="••••••••••••"
                  className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 pr-16 text-sm transition-colors"
                />
                <div className="absolute right-2 inset-y-0 flex items-center gap-1">
                  {popoConfig.aesKey && (
                    <button
                      type="button"
                      onClick={() => {
                        handlePopoChange({ aesKey: '' });
                        void handleSavePopoConfig({ aesKey: '' });
                      }}
                      className="p-0.5 rounded text-secondary hover:text-primary transition-colors"
                      title={i18nService.t('clear') || 'Clear'}
                    >
                      <XCircleIconSolid className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowSecrets(prev => ({ ...prev, 'popo.aesKey': !prev['popo.aesKey'] }))}
                    className="p-0.5 rounded text-secondary hover:text-primary transition-colors"
                    title={showSecrets['popo.aesKey'] ? (i18nService.t('hide') || 'Hide') : (i18nService.t('show') || 'Show')}
                  >
                    {showSecrets['popo.aesKey'] ? <EyeIcon className="h-4 w-4" /> : <EyeSlashIcon className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              {popoConfig.aesKey && popoConfig.aesKey.length !== 32 && (
                <p className="text-xs text-amber-500">AES Key {i18nService.t('imPopoAesKeyLengthWarning')}（{i18nService.t('imPopoAesKeyLengthCurrent')} {popoConfig.aesKey.length}）</p>
              )}
            </div>

            {/* Connectivity test */}
            <div className="pt-1">
              {renderConnectivityTestButton('popo')}
            </div>

            {/* Advanced Settings (collapsible) — credentials, connection mode, policies */}
            <details className="group">
              <summary className="cursor-pointer text-xs font-medium text-secondary hover:text-primary transition-colors">
                {i18nService.t('imAdvancedSettings')}
              </summary>
              <div className="mt-2 space-y-3 pl-2 border-l-2 border-border-subtle">

                {/* Connection Mode selector */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">
                    {i18nService.t('imPopoConnectionMode')}
                  </label>
                  <select
                    value={popoConfig.connectionMode || (popoConfig.token ? 'webhook' : 'websocket')}
                    onChange={(e) => {
                      const update = { connectionMode: e.target.value as PopoOpenClawConfig['connectionMode'] };
                      handlePopoChange(update);
                      void handleSavePopoConfig(update);
                    }}
                    className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                  >
                    <option value="websocket">{i18nService.t('imPopoConnectionModeWebsocket')}</option>
                    <option value="webhook">{i18nService.t('imPopoConnectionModeWebhook')}</option>
                  </select>
                </div>

                {/* Credential hint */}
                <p className="text-xs text-secondary">
                  {i18nService.t('imPopoCredentialHint')}
                </p>

                {/* AppKey input */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">AppKey</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={popoConfig.appKey}
                      onChange={(e) => handlePopoChange({ appKey: e.target.value })}
                      onBlur={() => void handleSavePopoConfig()}
                      placeholder="AppKey"
                      className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 pr-8 text-sm transition-colors"
                    />
                    {popoConfig.appKey && (
                      <div className="absolute right-2 inset-y-0 flex items-center">
                        <button
                          type="button"
                          onClick={() => {
                            handlePopoChange({ appKey: '' });
                            void handleSavePopoConfig({ appKey: '' });
                          }}
                          className="p-0.5 rounded text-secondary hover:text-primary transition-colors"
                          title={i18nService.t('clear') || 'Clear'}
                        >
                          <XCircleIconSolid className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* AppSecret input */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">AppSecret</label>
                  <div className="relative">
                    <input
                      type={showSecrets['popo.appSecret'] ? 'text' : 'password'}
                      value={popoConfig.appSecret}
                      onChange={(e) => handlePopoChange({ appSecret: e.target.value })}
                      onBlur={() => void handleSavePopoConfig()}
                      placeholder="••••••••••••"
                      className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 pr-16 text-sm transition-colors"
                    />
                    <div className="absolute right-2 inset-y-0 flex items-center gap-1">
                      {popoConfig.appSecret && (
                        <button
                          type="button"
                          onClick={() => {
                            handlePopoChange({ appSecret: '' });
                            void handleSavePopoConfig({ appSecret: '' });
                          }}
                          className="p-0.5 rounded text-secondary hover:text-primary transition-colors"
                          title={i18nService.t('clear') || 'Clear'}
                        >
                          <XCircleIconSolid className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowSecrets(prev => ({ ...prev, 'popo.appSecret': !prev['popo.appSecret'] }))}
                        className="p-0.5 rounded text-secondary hover:text-primary transition-colors"
                        title={showSecrets['popo.appSecret'] ? (i18nService.t('hide') || 'Hide') : (i18nService.t('show') || 'Show')}
                      >
                        {showSecrets['popo.appSecret'] ? <EyeIcon className="h-4 w-4" /> : <EyeSlashIcon className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Token input (webhook mode only) */}
                {(popoConfig.connectionMode || (popoConfig.token ? 'webhook' : 'websocket')) === 'webhook' && (
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">Token</label>
                  <div className="relative">
                    <input
                      type={showSecrets['popo.token'] ? 'text' : 'password'}
                      value={popoConfig.token}
                      onChange={(e) => handlePopoChange({ token: e.target.value })}
                      onBlur={() => void handleSavePopoConfig()}
                      placeholder="••••••••••••"
                      className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 pr-16 text-sm transition-colors"
                    />
                    <div className="absolute right-2 inset-y-0 flex items-center gap-1">
                      {popoConfig.token && (
                        <button
                          type="button"
                          onClick={() => {
                            handlePopoChange({ token: '' });
                            void handleSavePopoConfig({ token: '' });
                          }}
                          className="p-0.5 rounded text-secondary hover:text-primary transition-colors"
                          title={i18nService.t('clear') || 'Clear'}
                        >
                          <XCircleIconSolid className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowSecrets(prev => ({ ...prev, 'popo.token': !prev['popo.token'] }))}
                        className="p-0.5 rounded text-secondary hover:text-primary transition-colors"
                        title={showSecrets['popo.token'] ? (i18nService.t('hide') || 'Hide') : (i18nService.t('show') || 'Show')}
                      >
                        {showSecrets['popo.token'] ? <EyeIcon className="h-4 w-4" /> : <EyeSlashIcon className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                </div>
                )}

                {/* AES Key input */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">AES Key</label>
                  <div className="relative">
                    <input
                      type={showSecrets['popo.aesKey'] ? 'text' : 'password'}
                      value={popoConfig.aesKey}
                      onChange={(e) => handlePopoChange({ aesKey: e.target.value })}
                      onBlur={() => void handleSavePopoConfig()}
                      placeholder="••••••••••••"
                      className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 pr-16 text-sm transition-colors"
                    />
                    <div className="absolute right-2 inset-y-0 flex items-center gap-1">
                      {popoConfig.aesKey && (
                        <button
                          type="button"
                          onClick={() => {
                            handlePopoChange({ aesKey: '' });
                            void handleSavePopoConfig({ aesKey: '' });
                          }}
                          className="p-0.5 rounded text-secondary hover:text-primary transition-colors"
                          title={i18nService.t('clear') || 'Clear'}
                        >
                          <XCircleIconSolid className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowSecrets(prev => ({ ...prev, 'popo.aesKey': !prev['popo.aesKey'] }))}
                        className="p-0.5 rounded text-secondary hover:text-primary transition-colors"
                        title={showSecrets['popo.aesKey'] ? (i18nService.t('hide') || 'Hide') : (i18nService.t('show') || 'Show')}
                      >
                        {showSecrets['popo.aesKey'] ? <EyeIcon className="h-4 w-4" /> : <EyeSlashIcon className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  {popoConfig.aesKey && popoConfig.aesKey.length !== 32 && (
                    <p className="text-xs text-amber-500">AES Key {i18nService.t('lang') === 'zh' ? '需要为 32 个字符' : 'must be 32 characters'}（{i18nService.t('lang') === 'zh' ? '当前' : 'current'} {popoConfig.aesKey.length}）</p>
                  )}
                </div>

                {/* Webhook fields (webhook mode only) */}
                {(popoConfig.connectionMode || (popoConfig.token ? 'webhook' : 'websocket')) === 'webhook' && (
                <>
                {/* Webhook Base URL */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">Webhook Base URL</label>
                  <input
                    type="text"
                    value={popoConfig.webhookBaseUrl}
                    onChange={(e) => handlePopoChange({ webhookBaseUrl: e.target.value })}
                    onBlur={() => void handleSavePopoConfig()}
                    placeholder={localIp ? `http://${localIp}` : i18nService.t('imPopoWebhookPlaceholder')}
                    className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                  />
                </div>

                {/* Webhook Path */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">Webhook Path</label>
                  <input
                    type="text"
                    value={popoConfig.webhookPath}
                    onChange={(e) => handlePopoChange({ webhookPath: e.target.value })}
                    onBlur={() => void handleSavePopoConfig()}
                    placeholder="/popo/callback"
                    className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                  />
                </div>

                {/* Webhook Port */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">Webhook Port</label>
                  <input
                    type="number"
                    value={popoConfig.webhookPort}
                    onChange={(e) => handlePopoChange({ webhookPort: parseInt(e.target.value) || 3100 })}
                    onBlur={() => void handleSavePopoConfig()}
                    placeholder="3100"
                    className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                  />
                </div>
                </>
                )}

                {/* DM Policy */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">
                    DM Policy
                  </label>
                  <select
                    value={popoConfig.dmPolicy}
                    onChange={(e) => {
                      const update = { dmPolicy: e.target.value as PopoOpenClawConfig['dmPolicy'] };
                      handlePopoChange(update);
                      void handleSavePopoConfig(update);
                    }}
                    className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                  >
                    <option value="open">{i18nService.t('imDmPolicyOpen')}</option>
                    <option value="pairing">{i18nService.t('imDmPolicyPairing')}</option>
                    <option value="allowlist">{i18nService.t('imDmPolicyAllowlist')}</option>
                    <option value="disabled">{i18nService.t('imDmPolicyDisabled')}</option>
                  </select>
                </div>

                {/* Pairing Requests (shown when dmPolicy is 'pairing') */}
                {popoConfig.dmPolicy === 'pairing' && renderPairingSection('popo')}

                {/* Allow From */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">
                    Allow From (User IDs)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={popoAllowedUserIdInput}
                      onChange={(e) => setPopoAllowedUserIdInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const id = popoAllowedUserIdInput.trim();
                          if (id && !popoConfig.allowFrom.includes(id)) {
                            const newIds = [...popoConfig.allowFrom, id];
                            handlePopoChange({ allowFrom: newIds });
                            setPopoAllowedUserIdInput('');
                            void handleSavePopoConfig({ allowFrom: newIds });
                          }
                        }
                      }}
                      className="block flex-1 rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                      placeholder={i18nService.t('imPopoUserIdPlaceholder')}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const id = popoAllowedUserIdInput.trim();
                        if (id && !popoConfig.allowFrom.includes(id)) {
                          const newIds = [...popoConfig.allowFrom, id];
                          handlePopoChange({ allowFrom: newIds });
                          setPopoAllowedUserIdInput('');
                          void handleSavePopoConfig({ allowFrom: newIds });
                        }
                      }}
                      className="px-3 py-2 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                    >
                      {i18nService.t('add') || '添加'}
                    </button>
                  </div>
                  {popoConfig.allowFrom.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {popoConfig.allowFrom.map((id) => (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-surface border-border-subtle border text-foreground"
                        >
                          {id}
                          <button
                            type="button"
                            onClick={() => {
                              const newIds = popoConfig.allowFrom.filter((uid) => uid !== id);
                              handlePopoChange({ allowFrom: newIds });
                              void handleSavePopoConfig({ allowFrom: newIds });
                            }}
                            className="text-secondary hover:text-red-500 dark:hover:text-red-400 transition-colors"
                          >
                            <XMarkIcon className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Group Policy */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">
                    Group Policy
                  </label>
                  <select
                    value={popoConfig.groupPolicy}
                    onChange={(e) => {
                      const update = { groupPolicy: e.target.value as PopoOpenClawConfig['groupPolicy'] };
                      handlePopoChange(update);
                      void handleSavePopoConfig(update);
                    }}
                    className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                  >
                    <option value="open">Open</option>
                    <option value="allowlist">Allowlist</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </div>

                {/* Group Allow From */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">
                    Group Allow From (Chat IDs)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={popoGroupAllowIdInput}
                      onChange={(e) => setPopoGroupAllowIdInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const id = popoGroupAllowIdInput.trim();
                          if (id && !popoConfig.groupAllowFrom.includes(id)) {
                            const newIds = [...popoConfig.groupAllowFrom, id];
                            handlePopoChange({ groupAllowFrom: newIds });
                            setPopoGroupAllowIdInput('');
                            void handleSavePopoConfig({ groupAllowFrom: newIds });
                          }
                        }
                      }}
                      className="block flex-1 rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                      placeholder={i18nService.t('imPopoGroupIdPlaceholder')}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const id = popoGroupAllowIdInput.trim();
                        if (id && !popoConfig.groupAllowFrom.includes(id)) {
                          const newIds = [...popoConfig.groupAllowFrom, id];
                          handlePopoChange({ groupAllowFrom: newIds });
                          setPopoGroupAllowIdInput('');
                          void handleSavePopoConfig({ groupAllowFrom: newIds });
                        }
                      }}
                      className="px-3 py-2 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                    >
                      {i18nService.t('add') || '添加'}
                    </button>
                  </div>
                  {popoConfig.groupAllowFrom.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {popoConfig.groupAllowFrom.map((id) => (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-surface border-border-subtle border text-foreground"
                        >
                          {id}
                          <button
                            type="button"
                            onClick={() => {
                              const newIds = popoConfig.groupAllowFrom.filter((gid) => gid !== id);
                              handlePopoChange({ groupAllowFrom: newIds });
                              void handleSavePopoConfig({ groupAllowFrom: newIds });
                            }}
                            className="text-secondary hover:text-red-500 dark:hover:text-red-400 transition-colors"
                          >
                            <XMarkIcon className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Text Chunk Limit */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">Text Chunk Limit</label>
                  <input
                    type="number"
                    value={popoConfig.textChunkLimit}
                    onChange={(e) => handlePopoChange({ textChunkLimit: parseInt(e.target.value) || 3000 })}
                    onBlur={() => void handleSavePopoConfig()}
                    placeholder="3000"
                    className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                  />
                </div>

                {/* Rich Text Chunk Limit */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-secondary">Rich Text Chunk Limit</label>
                  <input
                    type="number"
                    value={popoConfig.richTextChunkLimit}
                    onChange={(e) => handlePopoChange({ richTextChunkLimit: parseInt(e.target.value) || 5000 })}
                    onBlur={() => void handleSavePopoConfig()}
                    placeholder="5000"
                    className="block w-full rounded-lg bg-surface border-border-subtle border focus:border-primary focus:ring-1 focus:ring-primary/30 text-foreground px-3 py-2 text-sm transition-colors"
                  />
                </div>

                {/* Debug toggle */}
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-secondary">Debug</label>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !popoConfig.debug;
                      handlePopoChange({ debug: next });
                      void handleSavePopoConfig({ debug: next });
                    }}
                    className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                      popoConfig.debug ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
                    }`}
                  >
                    <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      popoConfig.debug ? 'translate-x-4' : 'translate-x-0'
                    }`} />
                  </button>
                </div>
              </div>
            </details>

            {/* Error display */}
            {status.popo?.lastError && (
              <div className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">
                {status.popo.lastError}
              </div>
            )}
          </div>
        )}

        {connectivityModalPlatform && (
          <Modal onClose={() => setConnectivityModalPlatform(null)} overlayClassName="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" className="w-full max-w-2xl bg-surface rounded-2xl shadow-modal border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div className="text-sm font-semibold text-foreground">
                  {`${i18nService.t(connectivityModalPlatform)} ${i18nService.t('imConnectivitySectionTitle')}`}
                </div>
                <button
                  type="button"
                  aria-label={i18nService.t('close')}
                  onClick={() => setConnectivityModalPlatform(null)}
                  className="p-1 rounded-md hover:bg-surface-raised text-secondary"
                >
                  <XMarkIcon className="h-4 w-4" />
                </button>
              </div>

              <div className="p-4 max-h-[65vh] overflow-y-auto">
                {testingPlatform === connectivityModalPlatform ? (
                  <div className="text-sm text-secondary">
                    {i18nService.t('imConnectivityTesting')}
                  </div>
                ) : connectivityResults[connectivityModalPlatform] ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${verdictColorClass[connectivityResults[connectivityModalPlatform]!.verdict]}`}>
                        {connectivityResults[connectivityModalPlatform]!.verdict === 'pass' ? (
                          <CheckCircleIcon className="h-3.5 w-3.5" />
                        ) : connectivityResults[connectivityModalPlatform]!.verdict === 'warn' ? (
                          <ExclamationTriangleIcon className="h-3.5 w-3.5" />
                        ) : (
                          <XCircleIcon className="h-3.5 w-3.5" />
                        )}
                        {i18nService.t(`imConnectivityVerdict_${connectivityResults[connectivityModalPlatform]!.verdict}`)}
                      </div>
                      <div className="text-[11px] text-secondary">
                        {`${i18nService.t('imConnectivityLastChecked')}: ${formatTestTime(connectivityResults[connectivityModalPlatform]!.testedAt)}`}
                      </div>
                    </div>

                    <div className="space-y-2">
                      {connectivityResults[connectivityModalPlatform]!.checks.map((check, index) => (
                        <div
                          key={`${check.code}-${index}`}
                          className="rounded-lg border border-border-subtle px-2.5 py-2 bg-surface"
                        >
                          <div className={`text-xs font-medium ${checkLevelColorClass[check.level]}`}>
                            {getCheckTitle(check.code)}
                          </div>
                          <div className="mt-1 text-xs text-secondary">
                            {check.message}
                          </div>
                          {getCheckSuggestion(check) && (
                            <div className="mt-1 text-[11px] text-secondary">
                              {`${i18nService.t('imConnectivitySuggestion')}: ${getCheckSuggestion(check)}`}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-secondary">
                    {i18nService.t('imConnectivityNoResult')}
                  </div>
                )}
              </div>

              <div className="px-4 py-3 border-t border-border flex items-center justify-end">
                {renderConnectivityTestButton(connectivityModalPlatform)}
              </div>
          </Modal>
        )}
      </div>
    </div>
  );
};

export default IMSettings;
