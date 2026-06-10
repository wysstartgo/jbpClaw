import { PlatformRegistry } from '@shared/platform';
import React, { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import type {
  ScheduledTask,
  ScheduledTaskChannelOption,
  ScheduledTaskConversationOption,
  ScheduledTaskInput,
} from '../../../scheduledTask/types';
import { triggerSystemDictation } from '../../hooks/useSpeechToText';
import { i18nService } from '../../services/i18n';
import { scheduledTaskService } from '../../services/scheduledTask';
import { RootState } from '../../store';
import type { Model } from '../../store/slices/modelSlice';
import { toOpenClawModelRef } from '../../utils/openclawModelRef';
import MicrophoneIcon from '../icons/MicrophoneIcon';
import ModelSelector from '../ModelSelector';
import {
  formatScheduleLabel,
  isSavedOnlyScheduledTaskChannelOption,
  mergeScheduledTaskChannelOptions,
  type PlanType,
  scheduledTaskChannelOptionKey,
  scheduleToPlanInfo,
} from './utils';
import type { ScheduledTaskTemplate } from './taskTemplates';

interface TaskFormProps {
  mode: 'create' | 'edit';
  task?: ScheduledTask;
  initialTemplate?: ScheduledTaskTemplate | null;
  onCancel: () => void;
  onSaved: (newTaskId?: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

interface FormState {
  name: string;
  description: string;
  planType: PlanType;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekdays: number[];
  monthDay: number;
  payloadText: string;
  notifyChannel: string;
  notifyTo: string;
  notifyAccountId?: string;
  modelId: string;
}

function nowDefaults() {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
    hour: 9,
    minute: 0,
    second: 0,
  };
}

const DEFAULT_FORM_STATE: FormState = {
  name: '',
  description: '',
  planType: 'daily',
  ...nowDefaults(),
  weekdays: [1, 2, 3, 4, 5],
  monthDay: 1,
  payloadText: '',
  notifyChannel: 'none',
  notifyTo: '',
  notifyAccountId: undefined,
  modelId: '',
};

function isIMChannel(channel: string): boolean {
  return PlatformRegistry.isIMChannel(channel);
}

function conversationOptionMatchesValue(
  channel: string,
  optionConversationId: string,
  selectedValue: string,
): boolean {
  const optionId = optionConversationId.trim();
  const value = selectedValue.trim();
  if (!optionId || !value) return false;
  if (optionId === value) return true;

  const platform = PlatformRegistry.platformOfChannel(channel);
  if (platform === 'nim') {
    if (optionId.endsWith(`:${value}`)) return true;
    if (optionId.endsWith(`|${value}`)) return true;
  }

  return false;
}

function createFormState(task?: ScheduledTask): FormState {
  if (!task) return { ...DEFAULT_FORM_STATE, ...nowDefaults() };

  const planInfo = scheduleToPlanInfo(task.schedule);
  return {
    name: task.name,
    description: task.description,
    planType: planInfo.planType,
    year: planInfo.year,
    month: planInfo.month,
    day: planInfo.day,
    hour: planInfo.hour,
    minute: planInfo.minute,
    second: planInfo.second,
    weekdays: planInfo.weekdays,
    monthDay: planInfo.monthDay,
    payloadText: task.payload.kind === 'systemEvent' ? task.payload.text : task.payload.message,
    notifyChannel: task.delivery.channel || 'none',
    notifyTo: task.delivery.to || '',
    notifyAccountId: task.delivery.accountId,
    modelId: task.payload.kind === 'agentTurn' ? (task.payload.model ?? '') : '',
  };
}

function applyScheduledTaskTemplate(form: FormState, template: ScheduledTaskTemplate): FormState {
  const dateDefaults = nowDefaults();
  return {
    ...form,
    ...dateDefaults,
    name: i18nService.t(template.titleKey),
    planType: template.schedule.planType,
    hour: template.schedule.hour,
    minute: template.schedule.minute,
    second: 0,
    weekdays: template.schedule.weekdays ? [...template.schedule.weekdays] : form.weekdays,
    monthDay: template.schedule.monthDay ?? form.monthDay,
    payloadText: i18nService.t(template.promptKey),
  };
}

function buildScheduleInput(form: FormState): ScheduledTaskInput['schedule'] {
  if (form.planType === 'once') {
    const date = new Date(form.year, form.month - 1, form.day, form.hour, form.minute, form.second);
    return { kind: 'at', at: date.toISOString() };
  }

  const min = String(form.minute);
  const hr = String(form.hour);

  if (form.planType === 'hourly') {
    return { kind: 'cron', expr: `${min} * * * *` };
  }

  if (form.planType === 'daily') {
    return { kind: 'cron', expr: `${min} ${hr} * * *` };
  }

  if (form.planType === 'weekly') {
    const dowField = [...form.weekdays].sort((a, b) => a - b).join(',');
    return { kind: 'cron', expr: `${min} ${hr} * * ${dowField}` };
  }

  return { kind: 'cron', expr: `${min} ${hr} ${form.monthDay} * *` };
}

const TaskForm: React.FC<TaskFormProps> = ({ mode, task, initialTemplate = null, onCancel, onSaved, onDirtyChange }) => {
  const [form, setForm] = useState<FormState>(() => {
    const initialForm = createFormState(task);
    return mode === 'create' && initialTemplate
      ? applyScheduledTaskTemplate(initialForm, initialTemplate)
      : initialForm;
  });
  const initialFormRef = useRef(JSON.stringify(createFormState(task)));
  const availableModels = useSelector((state: RootState) => state.model.availableModels);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [channelOptions, setChannelOptions] = useState<ScheduledTaskChannelOption[]>(() => {
    const base: ScheduledTaskChannelOption[] = [];
    const savedChannel = task?.delivery.channel;
    const savedAccountId = task?.delivery.accountId;
    if (savedChannel && isIMChannel(savedChannel) && !base.some((option) => (
      option.value === savedChannel && option.accountId === savedAccountId
    ))) {
      const platform = PlatformRegistry.platformOfChannel(savedChannel);
      const label = platform ? PlatformRegistry.get(platform).label : savedChannel;
      base.push({ value: savedChannel, label, accountId: savedAccountId });
    }
    return base;
  });
  const [availableChannelOptions, setAvailableChannelOptions] = useState<ScheduledTaskChannelOption[]>([]);
  const [conversations, setConversations] = useState<ScheduledTaskConversationOption[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isDirty = JSON.stringify(form) !== initialFormRef.current;
  const isAdvanced = form.planType === 'advanced';
  const showConversationSelector = isIMChannel(form.notifyChannel);
  const selectedFilterAccountId = channelOptions.find((option) => (
    option.value === form.notifyChannel && option.accountId === form.notifyAccountId
  ))?.filterAccountId;

  useEffect(() => {
    const cleanForm = createFormState(task);
    const nextForm = mode === 'create' && initialTemplate
      ? applyScheduledTaskTemplate(cleanForm, initialTemplate)
      : cleanForm;
    initialFormRef.current = JSON.stringify(cleanForm);
    setForm(nextForm);
  }, [task, initialTemplate, mode]);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const handleRequestCancel = () => {
    if (isDirty) {
      setShowLeaveConfirm(true);
      return;
    }
    onCancel();
  };

  useEffect(() => {
    let cancelled = false;
    void scheduledTaskService.listChannels().then((channels) => {
      if (cancelled || channels.length === 0) return;
      setAvailableChannelOptions(channels);
      setChannelOptions((current) => {
        return mergeScheduledTaskChannelOptions(channels, current);
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!showConversationSelector) {
      setConversations([]);
      return;
    }

    let cancelled = false;
    setConversationsLoading(true);
    void scheduledTaskService.listChannelConversations(
      form.notifyChannel,
      form.notifyAccountId,
      selectedFilterAccountId ?? form.notifyAccountId,
    ).then((result) => {
      if (cancelled) return;
      setConversations(result);
      setConversationsLoading(false);

      if (result.length > 0 && !form.notifyTo) {
        setForm((current) => ({ ...current, notifyTo: result[0].conversationId }));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [form.notifyChannel, form.notifyAccountId, form.notifyTo, selectedFilterAccountId, showConversationSelector]);

  const updateForm = (patch: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...patch }));
  };

  const validate = (): boolean => {
    const nextErrors: Record<string, string> = {};

    if (!form.name.trim()) {
      nextErrors.name = i18nService.t('scheduledTasksFormValidationNameRequired');
    }
    if (!form.payloadText.trim()) {
      nextErrors.payloadText = i18nService.t('scheduledTasksFormValidationPromptRequired');
    }

    if (form.planType === 'once') {
      const runAt = new Date(form.year, form.month - 1, form.day, form.hour, form.minute, form.second);
      if (runAt.getTime() <= Date.now()) {
        nextErrors.schedule = i18nService.t('scheduledTasksFormValidationDatetimeFuture');
      }
    }

    if (!isAdvanced && (form.hour < 0 || form.hour > 23 || form.minute < 0 || form.minute > 59)) {
      nextErrors.schedule = i18nService.t('scheduledTasksFormValidationTimeRequired');
    }

    if (form.planType === 'weekly' && form.weekdays.length === 0) {
      nextErrors.schedule = i18nService.t('scheduledTasksFormValidationWeekdayRequired');
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const schedule = isAdvanced && task
        ? task.schedule
        : buildScheduleInput(form);

      const input: ScheduledTaskInput = {
        name: form.name.trim(),
        description: '',
        enabled: true,
        schedule,
        sessionTarget: 'isolated',
        wakeMode: 'now',
        payload: {
          kind: 'agentTurn',
          message: form.payloadText.trim(),
          ...(form.modelId ? { model: form.modelId } : {}),
        },
        delivery: form.notifyChannel === 'none'
          ? { mode: 'none' }
          : {
              mode: 'announce',
              channel: form.notifyChannel,
              ...(form.notifyTo ? { to: form.notifyTo } : {}),
              ...(form.notifyAccountId ? { accountId: form.notifyAccountId } : {}),
            },
      };

      if (mode === 'create') {
        const newTaskId = await scheduledTaskService.createTask(input);
        initialFormRef.current = JSON.stringify(form);
        onDirtyChange?.(false);
        onSaved(newTaskId ?? undefined);
        return;
      } else if (task) {
        await scheduledTaskService.updateTaskById(task.id, input);
      }
      initialFormRef.current = JSON.stringify(form);
      onDirtyChange?.(false);
      onSaved();
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass = 'jbp-visual-soft-field w-full rounded-xl px-3 py-2.5 text-sm outline-none transition-[border-color,box-shadow,background-color]';
  const textareaInputClass = 'w-full rounded-t-xl px-3 py-2.5 text-sm text-foreground focus:outline-none resize-none bg-transparent';
  const labelClass = 'block text-sm font-medium text-foreground mb-1';
  const errorClass = 'mt-1 text-xs text-destructive';

  const selectedModelValue: Model | null = form.modelId
    ? availableModels.find((model) => toOpenClawModelRef(model) === form.modelId) ?? null
    : null;

  const handleModelChange = (model: Model | null) => {
    updateForm({ modelId: model ? toOpenClawModelRef(model) : '' });
  };

  const payloadTextareaRef = useRef<HTMLTextAreaElement>(null);

  const handleVoiceInput = async () => {
    payloadTextareaRef.current?.focus();
    const result = await triggerSystemDictation();
    if (result.success) return;

    window.dispatchEvent(new CustomEvent('app:showToast', {
      detail: result.error === 'permission_denied'
        ? i18nService.t('voiceInputPermissionDenied')
        : i18nService.t('voiceInputFailed'),
    }));
  };

  const timeValue = `${String(form.hour).padStart(2, '0')}:${String(form.minute).padStart(2, '0')}`;
  const handleTimeChange = (value: string) => {
    const [h, m] = value.split(':').map(Number);
    if (!Number.isNaN(h) && !Number.isNaN(m)) {
      updateForm({ hour: h, minute: m });
    }
  };

  const [channelDropdownOpen, setChannelDropdownOpen] = useState(false);
  const channelDropdownRef = React.useRef<HTMLDivElement>(null);
  const [convDropdownOpen, setConvDropdownOpen] = useState(false);
  const convDropdownRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (channelDropdownRef.current && !channelDropdownRef.current.contains(event.target as Node)) {
        setChannelDropdownOpen(false);
      }
      if (convDropdownRef.current && !convDropdownRef.current.contains(event.target as Node)) {
        setConvDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getChannelLogo = (channelValue: string): string | null => {
    const platform = PlatformRegistry.platformOfChannel(channelValue);
    if (platform) {
      return PlatformRegistry.logo(platform);
    }
    return null;
  };

  const isChannelUnsupported = (channelValue: string): boolean => {
    return channelValue === 'openclaw-weixin';
  };

  const getChannelDisplayLabel = (channelValue: string): string => {
    if (channelValue === 'none') return i18nService.t('scheduledTasksFormNotifyChannelNone');
    const platform = PlatformRegistry.platformOfChannel(channelValue);
    if (platform) {
      const label = i18nService.t(platform) || PlatformRegistry.get(platform).label;
      return isChannelUnsupported(channelValue)
        ? `${label} (${i18nService.t('scheduledTasksChannelUnsupported')})`
        : label;
    }
    const option = channelOptions.find((channel) => channel.value === channelValue);
    return option ? option.label : channelValue;
  };

  const renderScheduleRow = () => {
    if (isAdvanced) {
      return (
        <div>
          <label className={labelClass}>{i18nService.t('scheduledTasksFormScheduleType')}</label>
          <div className="jbp-visual-soft-card rounded-xl p-3">
            <p className="text-sm text-secondary">
              {formatScheduleLabel(task!.schedule)}
            </p>
            <p className="text-xs text-secondary mt-1">
              {i18nService.t('scheduledTasksAdvancedSchedule')}
            </p>
          </div>
        </div>
      );
    }

    const planSelect = (
      <select
        value={form.planType}
        onChange={(event) => updateForm({ planType: event.target.value as PlanType })}
        className={`${inputClass} flex-1 min-w-0`}
      >
        <option value="once">{i18nService.t('scheduledTasksFormScheduleModeOnce')}</option>
        <option value="hourly">{i18nService.t('scheduledTasksFormScheduleModeHourly')}</option>
        <option value="daily">{i18nService.t('scheduledTasksFormScheduleModeDaily')}</option>
        <option value="weekly">{i18nService.t('scheduledTasksFormScheduleModeWeekly')}</option>
        <option value="monthly">{i18nService.t('scheduledTasksFormScheduleModeMonthly')}</option>
      </select>
    );

    if (form.planType === 'once') {
      const dateValue = `${form.year}-${String(form.month).padStart(2, '0')}-${String(form.day).padStart(2, '0')}`;
      const fullTimeValue = `${timeValue}:${String(form.second).padStart(2, '0')}`;
      return (
        <div>
          <label className={labelClass}>{i18nService.t('scheduledTasksFormScheduleType')}</label>
          <div className="flex items-center gap-3">
            {planSelect}
            <input
              type="date"
              value={dateValue}
              onChange={(e) => {
                const [y, mo, d] = e.target.value.split('-').map(Number);
                if (!Number.isNaN(y)) updateForm({ year: y, month: mo, day: d });
              }}
              className={`${inputClass} flex-1 min-w-0`}
            />
            <input
              type="time"
              step="1"
              value={fullTimeValue}
              onChange={(e) => {
                const parts = e.target.value.split(':').map(Number);
                const patch: Partial<FormState> = {};
                if (!Number.isNaN(parts[0])) patch.hour = parts[0];
                if (!Number.isNaN(parts[1])) patch.minute = parts[1];
                if (parts.length > 2 && !Number.isNaN(parts[2])) patch.second = parts[2];
                updateForm(patch);
              }}
              className={`${inputClass} flex-1 min-w-0`}
            />
          </div>
        </div>
      );
    }

    if (form.planType === 'daily') {
      return (
        <div>
          <label className={labelClass}>{i18nService.t('scheduledTasksFormScheduleType')}</label>
          <div className="flex items-center gap-3">
            {planSelect}
            <input
              type="time"
              value={timeValue}
              onChange={(e) => handleTimeChange(e.target.value)}
              className={`${inputClass} flex-1 min-w-0`}
            />
          </div>
        </div>
      );
    }

    if (form.planType === 'hourly') {
      return (
        <div>
          <label className={labelClass}>{i18nService.t('scheduledTasksFormScheduleType')}</label>
          <div className="flex items-center gap-3">
            {planSelect}
            <select
              value={form.minute}
              onChange={(e) => updateForm({ minute: Number(e.target.value) })}
              className="jbp-visual-soft-field w-20 shrink-0 rounded-xl px-3 py-2.5 text-center text-sm outline-none transition-[border-color,box-shadow,background-color]"
            >
              {Array.from({ length: 60 }, (_, i) => (
                <option key={i} value={i}>{String(i).padStart(2, '0')}</option>
              ))}
            </select>
            <span className="shrink-0 text-sm text-secondary">
              {i18nService.t('scheduledTasksFormHourlyMinuteSuffix')}
            </span>
          </div>
        </div>
      );
    }

    if (form.planType === 'weekly') {
      const weekdayShortLabels: [string, number][] =
        i18nService.getLanguage() === 'zh'
          ? [
              ['scheduledTasksFormWeekShortMon', 1],
              ['scheduledTasksFormWeekShortTue', 2],
              ['scheduledTasksFormWeekShortWed', 3],
              ['scheduledTasksFormWeekShortThu', 4],
              ['scheduledTasksFormWeekShortFri', 5],
              ['scheduledTasksFormWeekShortSat', 6],
              ['scheduledTasksFormWeekShortSun', 0],
            ]
          : [
              ['scheduledTasksFormWeekShortSun', 0],
              ['scheduledTasksFormWeekShortMon', 1],
              ['scheduledTasksFormWeekShortTue', 2],
              ['scheduledTasksFormWeekShortWed', 3],
              ['scheduledTasksFormWeekShortThu', 4],
              ['scheduledTasksFormWeekShortFri', 5],
              ['scheduledTasksFormWeekShortSat', 6],
            ];

      const toggleWeekday = (day: number) => {
        const next = form.weekdays.includes(day)
          ? form.weekdays.filter((value) => value !== day)
          : [...form.weekdays, day];
        updateForm({ weekdays: next });
      };

      return (
        <div>
          <label className={labelClass}>{i18nService.t('scheduledTasksFormScheduleType')}</label>
          <div className="flex items-center gap-3">
            {planSelect}
            <input
              type="time"
              value={timeValue}
              onChange={(e) => handleTimeChange(e.target.value)}
              className={`${inputClass} flex-1 min-w-0`}
            />
          </div>
          <div className="flex items-center gap-2 mt-2">
            {weekdayShortLabels.map(([key, dayValue]) => {
              const selected = form.weekdays.includes(dayValue);
              return (
                <button
                  key={dayValue}
                  type="button"
                  onClick={() => toggleWeekday(dayValue)}
                  className={`h-9 w-9 rounded-full text-sm font-medium transition-colors ${
                    selected
                      ? 'jbp-visual-primary-action'
                      : 'jbp-visual-secondary-action text-secondary'
                  }`}
                >
                  {i18nService.t(key)}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    return (
      <div>
        <label className={labelClass}>{i18nService.t('scheduledTasksFormScheduleType')}</label>
        <div className="flex items-center gap-3">
          {planSelect}
          <select
            value={form.monthDay}
            onChange={(e) => updateForm({ monthDay: Number(e.target.value) })}
            className={`${inputClass} flex-1 min-w-0`}
          >
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}{i18nService.t('scheduledTasksFormMonthDaySuffix')}
              </option>
            ))}
          </select>
          <input
            type="time"
            value={timeValue}
            onChange={(e) => handleTimeChange(e.target.value)}
            className={`${inputClass} flex-1 min-w-0`}
          />
        </div>
      </div>
    );
  };

  const renderNotifyRow = () => {
    const selectedLogo = getChannelLogo(form.notifyChannel);
    const selectedConversation = conversations.find(
      (conversation) => conversationOptionMatchesValue(form.notifyChannel, conversation.conversationId, form.notifyTo),
    );
    const selectedConversationLabel = selectedConversation
      ? selectedConversation.conversationId
      : form.notifyTo;

    return (
      <div>
        <label className={labelClass}>{i18nService.t('scheduledTasksFormNotifyChannel')}</label>
        <div className="flex items-center gap-3">
          <div className={`relative ${showConversationSelector ? 'flex-1 min-w-0' : 'w-full'}`} ref={channelDropdownRef}>
            <button
              type="button"
              onClick={() => setChannelDropdownOpen(!channelDropdownOpen)}
              className={`${inputClass} flex w-full cursor-pointer items-center justify-between`}
            >
              <span className="flex items-center gap-2 truncate">
                {selectedLogo ? (
                  <img src={selectedLogo} alt="" className="w-5 h-5 object-contain rounded" />
                ) : (
                  <span className="w-5 h-5" />
                )}
                <span className="truncate">
                  {(() => {
                    const base = getChannelDisplayLabel(form.notifyChannel);
                    if (!form.notifyAccountId) return base;
                    const selected = channelOptions.find((option) => (
                      option.value === form.notifyChannel && option.accountId === form.notifyAccountId
                    ));
                    return selected ? `${base} · ${selected.label}` : base;
                  })()}
                </span>
              </span>
              <svg className={`w-4 h-4 ml-2 flex-shrink-0 transition-transform ${channelDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {channelDropdownOpen && (
              <div className="jbp-visual-panel absolute z-50 mt-1 w-full overflow-hidden rounded-xl">
                <div
                  className="flex cursor-pointer items-center gap-2 px-3 py-2 transition-colors hover:bg-surface-raised"
                  onClick={() => {
                    updateForm({ notifyChannel: 'none', notifyTo: '', notifyAccountId: undefined });
                    setChannelDropdownOpen(false);
                  }}
                >
                  <span className="w-5 h-5" />
                  <span className="text-sm text-foreground">
                    {i18nService.t('scheduledTasksFormNotifyChannelNone')}
                  </span>
                </div>
                {channelOptions.map((channel) => {
                  const unsupported = isChannelUnsupported(channel.value);
                  const savedOnly = isSavedOnlyScheduledTaskChannelOption(channel, availableChannelOptions);
                  const logo = getChannelLogo(channel.value);
                  const platform = PlatformRegistry.platformOfChannel(channel.value);
                  const platformLabel = platform
                    ? (i18nService.t(platform) || channel.label)
                    : channel.label;
                  const displayName = channel.accountId ? `${platformLabel} · ${channel.label}` : platformLabel;
                  const isActive = form.notifyChannel === channel.value
                    && (channel.accountId ? form.notifyAccountId === channel.accountId : !form.notifyAccountId);
                  return (
                    <div
                      key={scheduledTaskChannelOptionKey(channel)}
                      className={`flex items-center gap-2 px-3 py-2 transition-colors ${
                        unsupported
                          ? 'opacity-50 cursor-not-allowed'
                          : 'cursor-pointer hover:bg-surface-raised'
                      } ${isActive ? 'bg-surface-raised' : ''}`}
                      onClick={() => {
                        if (!unsupported) {
                          updateForm({ notifyChannel: channel.value, notifyTo: '', notifyAccountId: channel.accountId });
                          setChannelDropdownOpen(false);
                        }
                      }}
                    >
                      {logo ? (
                        <img src={logo} alt={displayName} className="w-5 h-5 object-contain rounded" />
                      ) : (
                        <span className="w-5 h-5" />
                      )}
                      <span className={`text-sm ${unsupported || savedOnly ? 'text-secondary' : 'text-foreground'}`}>
                        {displayName}
                        {unsupported && ` (${i18nService.t('scheduledTasksChannelUnsupported')})`}
                        {!unsupported && savedOnly && ` (${i18nService.t('scheduledTasksChannelUnavailable')})`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {showConversationSelector && (
            <div className="relative flex-1 min-w-0" ref={convDropdownRef}>
              <button
                type="button"
                onClick={() => {
                  if (!conversationsLoading) setConvDropdownOpen(!convDropdownOpen);
                }}
                disabled={conversationsLoading}
                className={`${inputClass} flex w-full cursor-pointer items-center justify-between disabled:cursor-not-allowed disabled:opacity-50`}
              >
                <span className="truncate text-sm">
                  {conversationsLoading
                    ? i18nService.t('scheduledTasksFormNotifyConversationLoading')
                    : selectedConversationLabel || i18nService.t('scheduledTasksFormNotifyConversationNone')}
                </span>
                <svg className={`w-4 h-4 ml-2 flex-shrink-0 transition-transform ${convDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {convDropdownOpen && !conversationsLoading && (
                <div className="jbp-visual-panel absolute z-50 mt-1 w-full overflow-hidden rounded-xl">
                  {conversations.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-secondary">
                      {i18nService.t('scheduledTasksFormNotifyConversationNone')}
                    </div>
                  ) : (
                    conversations.map((conversation) => {
                      const isActive = conversationOptionMatchesValue(
                        form.notifyChannel,
                        conversation.conversationId,
                        form.notifyTo,
                      );
                      return (
                        <div
                          key={conversation.conversationId}
                          className={`px-3 py-2 text-sm cursor-pointer hover:bg-surface-raised transition-colors truncate ${
                            isActive ? 'bg-surface-raised text-foreground' : 'text-foreground'
                          }`}
                          onClick={() => {
                            updateForm({ notifyTo: conversation.conversationId });
                            setConvDropdownOpen(false);
                          }}
                        >
                          {conversation.conversationId}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <h2 className="text-lg font-semibold text-foreground">
        {mode === 'create' ? i18nService.t('scheduledTasksFormCreate') : i18nService.t('scheduledTasksFormUpdate')}
      </h2>

      <div>
        <label className={labelClass}>{i18nService.t('scheduledTasksFormName')}</label>
        <input
          type="text"
          value={form.name}
          onChange={(event) => updateForm({ name: event.target.value })}
          className={inputClass}
          placeholder={i18nService.t('scheduledTasksFormNamePlaceholder')}
        />
        {errors.name && <p className={errorClass}>{errors.name}</p>}
      </div>

      <div>
        <label className={labelClass}>
          {i18nService.t('scheduledTasksFormPayloadTextAgent')}
        </label>
        <div className="jbp-visual-soft-field rounded-xl p-0 focus-within:border-primary">
          <textarea
            ref={payloadTextareaRef}
            value={form.payloadText}
            onChange={(event) => updateForm({ payloadText: event.target.value })}
            className={textareaInputClass}
            placeholder={i18nService.t('scheduledTasksFormPromptPlaceholder')}
            rows={4}
          />
          <div className="flex items-center justify-between gap-2 px-2 py-1">
            <ModelSelector
              dropdownDirection="up"
              value={selectedModelValue}
              onChange={handleModelChange}
              defaultLabel={i18nService.t('scheduledTasksFormModelDefault')}
            />
            <button
              type="button"
              onClick={() => { void handleVoiceInput(); }}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-secondary hover:bg-surface-raised hover:text-foreground transition-colors"
              title={i18nService.t('voiceInput')}
              aria-label={i18nService.t('voiceInput')}
            >
              <MicrophoneIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
        {errors.payloadText && <p className={errorClass}>{errors.payloadText}</p>}
      </div>

      {renderScheduleRow()}
      {errors.schedule && <p className={errorClass}>{errors.schedule}</p>}

      {renderNotifyRow()}

      {submitError && (
        <div className="jbp-visual-danger-note flex items-start gap-2 rounded-xl px-3 py-2.5">
          <span className="min-w-0 break-words text-sm">
            {i18nService.t('scheduledTasksFormSubmitError')}{submitError}
          </span>
          <button
            type="button"
            onClick={() => setSubmitError(null)}
            className="ml-auto shrink-0 p-0.5 text-destructive transition-colors hover:opacity-80"
            aria-label="dismiss"
          >
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={handleRequestCancel}
          className="jbp-visual-secondary-action rounded-xl px-4 py-2 text-sm transition-colors"
        >
          {i18nService.t('cancel')}
        </button>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting}
          className="jbp-visual-primary-action rounded-xl px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
        >
          {submitting
            ? i18nService.t('saving')
            : mode === 'create'
              ? i18nService.t('scheduledTasksFormCreate')
              : i18nService.t('scheduledTasksFormUpdate')}
        </button>
      </div>

      {showLeaveConfirm && (
        <div className="jbp-visual-backdrop fixed inset-0 z-50 flex items-center justify-center">
          <div
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
            className="jbp-visual-panel w-full max-w-sm rounded-2xl p-5"
          >
            <h4 className="text-sm font-semibold text-foreground mb-2">
              {i18nService.t('taskFormUnsavedChanges')}
            </h4>
            <p className="text-sm text-secondary mb-4">
              {i18nService.t('taskFormLeaveConfirm')}
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowLeaveConfirm(false)}
                className="jbp-visual-secondary-action rounded-xl px-4 py-2 text-sm transition-colors"
              >
                {i18nService.t('taskFormStay')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowLeaveConfirm(false);
                  onDirtyChange?.(false);
                  onCancel();
                }}
                className="jbp-visual-danger-action rounded-xl px-4 py-2 text-sm font-medium transition-colors"
              >
                {i18nService.t('taskFormLeave')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TaskForm;
