import { CheckIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import { ProviderName, isQingShuServerProvider } from '@shared/providers';
import React from 'react';
import { createPortal } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';

import { getProviderIcon, ProviderIconId } from '../providers/uiRegistry';
import { i18nService } from '../services/i18n';
import { RootState } from '../store';
import type { Model } from '../store/slices/modelSlice';
import { getModelIdentityKey, isSameModelIdentity, selectAgentSelectedModel, setSelectedModel } from '../store/slices/modelSlice';

interface ModelSelectorProps {
  dropdownDirection?: 'up' | 'down' | 'auto';
  value?: Model | null;
  onChange?: (model: Model | null) => void;
  defaultLabel?: string;
  disabled?: boolean;
  compact?: boolean;
  portal?: boolean;
  alignDropdownToTriggerEnd?: boolean;
}

const DROPDOWN_MAX_HEIGHT = 344;
const DROPDOWN_WIDTH = 240;
const DROPDOWN_VIEWPORT_MARGIN = 8;
const MODEL_ICON_CLASS_NAME = 'h-[18px] w-[18px]';
const ModelSelectorGroup = {
  Server: 'server',
  User: 'user',
} as const;
type ModelSelectorGroup = typeof ModelSelectorGroup[keyof typeof ModelSelectorGroup];
const MODEL_ICON_PROVIDER_HINTS: Array<{ pattern: RegExp; providerName: ProviderName | ProviderIconId }> = [
  { pattern: /doubao|豆包/i, providerName: ProviderIconId.Doubao },
  { pattern: /deepseek/i, providerName: ProviderName.DeepSeek },
  { pattern: /minimax/i, providerName: ProviderName.Minimax },
  { pattern: /kimi|moonshot/i, providerName: ProviderName.Moonshot },
  { pattern: /glm|zhipu/i, providerName: ProviderName.Zhipu },
  { pattern: /qwen|qwq|qvq/i, providerName: ProviderName.Qwen },
  { pattern: /hy3|youdao/i, providerName: ProviderName.Youdaozhiyun },
  { pattern: /claude|anthropic/i, providerName: ProviderName.Anthropic },
  { pattern: /gemini/i, providerName: ProviderName.Gemini },
  { pattern: /gpt|openai/i, providerName: ProviderName.OpenAI },
];

const ModelSelector: React.FC<ModelSelectorProps> = ({
  dropdownDirection = 'auto',
  value,
  onChange,
  defaultLabel,
  disabled = false,
  compact = false,
  portal = false,
  alignDropdownToTriggerEnd = false,
}) => {
  const dispatch = useDispatch();
  const [isOpen, setIsOpen] = React.useState(false);
  const [resolvedDirection, setResolvedDirection] = React.useState<'up' | 'down'>('down');
  const [portalStyle, setPortalStyle] = React.useState<React.CSSProperties>({});
  const [activeGroup, setActiveGroup] = React.useState<ModelSelectorGroup>(ModelSelectorGroup.Server);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const selectedItemRef = React.useRef<HTMLButtonElement>(null);
  const controlled = onChange !== undefined;
  const globalSelectedModel = useSelector((state: RootState) => state.model.selectedModel);
  const currentAgentId = useSelector((state: RootState) => state.agent.currentAgentId);
  const currentAgentModelRef = useSelector((state: RootState) => {
    const currentAgent = state.agent.agents.find(agent => agent.id === state.agent.currentAgentId);
    return currentAgent?.model ?? '';
  });
  const agentSelectedModel = useSelector((state: RootState) => (
    selectAgentSelectedModel(state.model, state.agent.currentAgentId, currentAgentModelRef)
  ));
  const selectedModel = controlled ? value ?? null : agentSelectedModel ?? globalSelectedModel;
  const selectedModelKey = selectedModel ? getModelIdentityKey(selectedModel) : '';
  const availableModels = useSelector((state: RootState) => state.model.availableModels);
  const serverModels = availableModels.filter(m => m.isServerModel);
  const userModels = availableModels.filter(m => !m.isServerModel);
  const modelGroups = [
    ...(serverModels.length > 0
      ? [{ key: ModelSelectorGroup.Server, label: i18nService.t('modelGroupServer') }]
      : []),
    ...(userModels.length > 0
      ? [{ key: ModelSelectorGroup.User, label: i18nService.t('modelGroupUser') }]
      : []),
  ];
  const shouldShowGroupTabs = serverModels.length > 0;
  const isGroupAvailable = (group: ModelSelectorGroup): boolean => (
    group === ModelSelectorGroup.Server ? serverModels.length > 0 : userModels.length > 0
  );
  const getModelGroup = (model: Model | null): ModelSelectorGroup | null => {
    if (!model) return null;
    return model.isServerModel ? ModelSelectorGroup.Server : ModelSelectorGroup.User;
  };
  const getPreferredGroup = (): ModelSelectorGroup => {
    const selectedGroup = getModelGroup(selectedModel);
    if (selectedGroup && isGroupAvailable(selectedGroup)) return selectedGroup;
    return serverModels.length > 0 ? ModelSelectorGroup.Server : ModelSelectorGroup.User;
  };
  const visibleGroup = isGroupAvailable(activeGroup) ? activeGroup : getPreferredGroup();
  const visibleModels = shouldShowGroupTabs
    ? (visibleGroup === ModelSelectorGroup.Server ? serverModels : userModels)
    : availableModels;

  // 点击外部区域关闭下拉框
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const isInsideTrigger = containerRef.current?.contains(target);
      const isInsideDropdown = dropdownRef.current?.contains(target);

      if (!isInsideTrigger && !isInsideDropdown) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside, true);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
    };
  }, [isOpen]);

  const resolveDirection = React.useCallback(() => {
    if (dropdownDirection !== 'auto') return dropdownDirection;
    if (!containerRef.current) return 'down';
    const rect = containerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    return spaceBelow < DROPDOWN_MAX_HEIGHT && rect.top > spaceBelow ? 'up' : 'down';
  }, [dropdownDirection]);

  const updatePortalPosition = React.useCallback((direction: 'up' | 'down') => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const desiredLeft = alignDropdownToTriggerEnd
      ? rect.right - DROPDOWN_WIDTH
      : rect.left;
    const left = Math.min(
      Math.max(desiredLeft, DROPDOWN_VIEWPORT_MARGIN),
      window.innerWidth - DROPDOWN_WIDTH - DROPDOWN_VIEWPORT_MARGIN
    );
    const nextStyle: React.CSSProperties = {
      left,
      position: 'fixed',
      width: DROPDOWN_WIDTH,
      zIndex: 10000,
    };

    if (direction === 'up') {
      nextStyle.bottom = window.innerHeight - rect.top + 4;
    } else {
      nextStyle.top = rect.bottom + 4;
    }

    setPortalStyle(nextStyle);
  }, [alignDropdownToTriggerEnd]);

  React.useEffect(() => {
    if (!isOpen || !portal) return;

    const handlePositionUpdate = () => updatePortalPosition(resolvedDirection);
    window.addEventListener('resize', handlePositionUpdate);
    window.addEventListener('scroll', handlePositionUpdate, true);

    return () => {
      window.removeEventListener('resize', handlePositionUpdate);
      window.removeEventListener('scroll', handlePositionUpdate, true);
    };
  }, [isOpen, portal, resolvedDirection, updatePortalPosition]);

  React.useLayoutEffect(() => {
    if (!isOpen || !selectedModelKey) return;

    const scrollContainer = scrollContainerRef.current;
    const selectedItem = selectedItemRef.current;
    if (!scrollContainer || !selectedItem || !scrollContainer.contains(selectedItem)) return;

    const containerRect = scrollContainer.getBoundingClientRect();
    const selectedRect = selectedItem.getBoundingClientRect();
    const selectedOffsetTop = selectedRect.top - containerRect.top + scrollContainer.scrollTop;
    const targetScrollTop = selectedOffsetTop - ((scrollContainer.clientHeight - selectedItem.offsetHeight) / 2);
    const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
    scrollContainer.scrollTop = Math.min(Math.max(0, targetScrollTop), maxScrollTop);
  }, [isOpen, selectedModelKey, visibleGroup, visibleModels.length]);

  const toggleOpen = () => {
    if (disabled) return;
    if (!isOpen) {
      const nextDirection = resolveDirection();
      setResolvedDirection(nextDirection);
      if (portal) {
        updatePortalPosition(nextDirection);
      }
      setActiveGroup(getPreferredGroup());
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  };

  const handleModelSelect = (model: Model | null) => {
    if (disabled) return;
    if (controlled) {
      onChange(model);
    } else if (model) {
      dispatch(setSelectedModel({ agentId: currentAgentId, model }));
    }
    setIsOpen(false);
  };

  // 如果没有可用模型，显示提示
  if (availableModels.length === 0) {
    return (
      <div className="px-3 py-1.5 rounded-xl bg-surface text-secondary text-sm">
        {i18nService.t('modelSelectorNoModels')}
      </div>
    );
  }

  const dropdownPositionClass = resolvedDirection === 'up'
    ? 'bottom-full mb-1'
    : 'top-full mt-1';
  const dropdownAlignmentClass = alignDropdownToTriggerEnd ? 'right-0' : 'left-0';

  const isSelected = (model: Model): boolean => {
    if (!selectedModel) return false;
    return isSameModelIdentity(model, selectedModel);
  };

  const resolveModelIconProviderKey = (model: Model): string => {
    const providerKey = model.providerKey?.trim();
    if (providerKey && !isQingShuServerProvider(providerKey)) return providerKey;

    const searchableText = `${model.name} ${model.id}`;
    return MODEL_ICON_PROVIDER_HINTS.find(({ pattern }) => pattern.test(searchableText))?.providerName
      ?? providerKey
      ?? '';
  };

  const renderProviderIcon = (model: Model): React.ReactNode => {
    const icon = getProviderIcon(resolveModelIconProviderKey(model));
    if (!React.isValidElement<{ className?: string }>(icon)) return icon;

    const existingClassName = icon.props.className ? `${icon.props.className} ` : '';
    return React.cloneElement(icon, {
      className: `${existingClassName}${MODEL_ICON_CLASS_NAME}`,
    });
  };

  const triggerClassName = compact
    ? 'space-x-1.5 px-2 py-1 rounded-lg max-w-[220px]'
    : 'space-x-2 px-3 py-1.5 rounded-xl max-w-[280px]';
  const triggerTextClassName = compact
    ? 'font-normal text-[13px] leading-5'
    : 'font-medium text-sm';
  const triggerIconClassName = compact ? 'h-3.5 w-3.5' : 'h-4 w-4';

  const renderModelItem = (model: Model) => {
    const selected = isSelected(model);

    return (
      <button
        ref={selected ? selectedItemRef : undefined}
        type="button"
        key={getModelIdentityKey(model)}
        onClick={() => handleModelSelect(model)}
        className={`w-full px-3 py-2 text-left text-foreground hover:bg-surface-raised flex items-center gap-2.5 transition-colors ${
          selected ? 'bg-surface-raised/50' : ''
        }`}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-secondary">
          {renderProviderIcon(model)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-normal leading-5">
          {model.name}
        </span>
        {model.supportsImage && (
          <span className="shrink-0 rounded-md bg-surface-raised px-1.5 py-0.5 text-[10px] font-medium leading-none text-secondary">
            {i18nService.t('modelSupportsImageInputBadge')}
          </span>
        )}
        {selected && (
          <CheckIcon className="h-4 w-4 shrink-0 text-emerald-500" />
        )}
      </button>
    );
  };

  const renderGroupTabs = () => (
    <div className="border-b border-border/60 p-2">
      <div className="flex rounded-lg bg-surface-raised p-0.5" role="tablist" aria-label={i18nService.t('model')}>
        {modelGroups.map(group => (
          <button
            type="button"
            key={group.key}
            role="tab"
            aria-selected={visibleGroup === group.key}
            onClick={() => setActiveGroup(group.key)}
            className={`min-w-0 flex-1 rounded-md px-2 py-1.5 text-center text-[12px] font-medium leading-4 transition-colors ${
              visibleGroup === group.key
                ? 'bg-surface text-foreground shadow-sm'
                : 'text-secondary hover:text-foreground'
            }`}
          >
            <span className="truncate">{group.label}</span>
          </button>
        ))}
      </div>
    </div>
  );

  const dropdown = isOpen ? (
    <div
      ref={dropdownRef}
      style={portal ? portalStyle : undefined}
      className={`${portal ? '' : `absolute ${dropdownPositionClass} ${dropdownAlignmentClass}`} w-60 bg-surface rounded-xl popover-enter shadow-popover z-50 border-border border overflow-hidden`}
    >
      {shouldShowGroupTabs && renderGroupTabs()}
      <div ref={scrollContainerRef} className="model-selector-scroll max-h-72 overflow-y-auto py-1">
        {defaultLabel && (
          <button
            type="button"
            onClick={() => handleModelSelect(null)}
            className={`w-full px-3 py-2 text-left text-foreground hover:bg-surface-raised flex items-center justify-between gap-2 transition-colors ${
              !selectedModel ? 'bg-surface-raised/50' : ''
            }`}
          >
            <span className="truncate text-[13px] font-normal leading-5">{defaultLabel}</span>
            {!selectedModel && <CheckIcon className="h-4 w-4 shrink-0 text-emerald-500" />}
          </button>
        )}
        {visibleModels.map(renderModelItem)}
      </div>
    </div>
  ) : null;

  return (
    <div ref={containerRef} className={`relative ${disabled ? 'cursor-wait' : 'cursor-pointer'}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={toggleOpen}
        className={`flex items-center hover:bg-surface-raised text-foreground transition-colors disabled:opacity-70 disabled:cursor-wait ${triggerClassName} ${isOpen ? 'bg-surface-raised' : ''}`}
      >
        <span className={`${triggerTextClassName} truncate`}>{selectedModel?.name ?? defaultLabel ?? ''}</span>
        <ChevronDownIcon className={`${triggerIconClassName} shrink-0 text-secondary`} />
      </button>

      {portal && dropdown ? createPortal(dropdown, document.body) : dropdown}
    </div>
  );
};

export default ModelSelector;
