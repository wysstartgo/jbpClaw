import { isQingShuManagedSource } from '@shared/qingshuManaged/access';
import React, { useState, useMemo, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import { i18nService } from '../../services/i18n';
import { resolveQingShuSourceLabelKey } from '../../services/qingshuManagedUi';
import { skillService } from '../../services/skill';
import { CheckIcon } from '@heroicons/react/24/outline';
import SearchIcon from '../icons/SearchIcon';
import AgentSkillGovernancePreview from './AgentSkillGovernancePreview';

interface AgentSkillSelectorProps {
  selectedSkillIds: string[];
  toolBundleIds?: string[];
  onChange: (skillIds: string[]) => void;
  allowManagedSkills?: boolean;
  usesAllEnabledSkillsWhenEmpty?: boolean;
}

const AgentSkillSelector: React.FC<AgentSkillSelectorProps> = ({
  selectedSkillIds,
  toolBundleIds = [],
  onChange,
  allowManagedSkills = true,
  usesAllEnabledSkillsWhenEmpty = true,
}) => {
  const skills = useSelector((state: RootState) => state.skill.skills);
  const [search, setSearch] = useState('');
  const [i18nReady, setI18nReady] = useState(false);
  const showGovernanceDebug = import.meta.env.DEV;
  const getSourceLabel = (sourceType?: string) => {
    return i18nService.t(resolveQingShuSourceLabelKey(sourceType));
  };

  // Load localized skill descriptions from marketplace API
  useEffect(() => {
    skillService.fetchMarketplaceSkills()
      .then(() => setI18nReady(true))
      .catch(() => setI18nReady(true));
  }, []);

  const enabledSkills = useMemo(
    () => skills.filter((s) => s.enabled && (allowManagedSkills || !isQingShuManagedSource(s.sourceType))),
    [allowManagedSkills, skills],
  );

  const filteredSkills = useMemo(() => {
    if (!search.trim()) return enabledSkills;
    const q = search.toLowerCase();
    return enabledSkills.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    );
  }, [enabledSkills, search]);

  const effectiveSkillIds = useMemo(
    () => (
      selectedSkillIds.length > 0
        ? selectedSkillIds
        : (usesAllEnabledSkillsWhenEmpty ? enabledSkills.map((skill) => skill.id) : [])
    ),
    [enabledSkills, selectedSkillIds, usesAllEnabledSkillsWhenEmpty],
  );

  const toggle = (skillId: string) => {
    if (selectedSkillIds.includes(skillId)) {
      onChange(selectedSkillIds.filter((id) => id !== skillId));
    } else {
      onChange([...selectedSkillIds, skillId]);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <p className="text-xs text-secondary/60 mb-3">
        {i18nService.t('agentSkillsHint') || 'Select skills available to this Agent. Leave empty to use all enabled skills.'}
      </p>
      {enabledSkills.length > 5 && (
        <div className="mb-2">
          <div className="relative">
            <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary/50" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={i18nService.t('agentSkillsSearch') || 'Search skills...'}
              className="jbp-visual-soft-field w-full rounded-lg py-1.5 pl-8 pr-3 text-sm outline-none transition-[border-color,box-shadow,background-color]"
            />
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {filteredSkills.length === 0 ? (
          <div className="px-3 py-3 text-sm text-secondary/50 text-center">
            {enabledSkills.length === 0 ? 'No skills installed' : 'No matching skills'}
          </div>
        ) : (
          filteredSkills.map((skill) => {
            const isSelected = selectedSkillIds.includes(skill.id);
            return (
              <button
                key={skill.id}
                type="button"
                onClick={() => toggle(skill.id)}
                className={`jbp-visual-selectable-card group mb-1 flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition-colors ${isSelected ? 'is-active' : ''}`}
              >
                <div className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                  isSelected
                    ? 'bg-primary border-primary'
                    : 'border-border dark:border-gray-500 group-hover:border-gray-400 dark:group-hover:border-gray-300'
                }`}>
                  {isSelected && <CheckIcon className="h-3 w-3 text-white" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 text-sm font-medium text-foreground truncate">
                      {skill.name}
                    </div>
                    <span className="shrink-0 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-secondary">
                      {getSourceLabel(skill.sourceType)}
                    </span>
                  </div>
                  {skill.description && (
                    <div className="text-xs text-secondary/60 truncate">
                      {i18nReady
                        ? skillService.getInstalledSkillDescription(skill)
                        : skill.description}
                    </div>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
      {showGovernanceDebug ? (
        <AgentSkillGovernancePreview
          skillIds={effectiveSkillIds}
          toolBundleIds={toolBundleIds}
          usesAllEnabledSkills={selectedSkillIds.length === 0}
        />
      ) : null}
    </div>
  );
};

export default AgentSkillSelector;
