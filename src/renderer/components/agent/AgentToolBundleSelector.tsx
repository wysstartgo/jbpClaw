import React, { useEffect, useMemo, useState } from 'react';
import { Squares2X2Icon } from '@heroicons/react/24/outline';
import { qingshuGovernanceService } from '../../services/qingshuGovernance';
import { buildQingShuToolBundleOptions } from '../../services/qingshuToolBundles';
import { i18nService } from '../../services/i18n';
import type { QingShuSharedToolCatalogSummary } from '../../types/qingshuGovernance';

interface AgentToolBundleSelectorProps {
  selectedBundleIds: string[];
  onChange: (bundleIds: string[]) => void;
}

const AgentToolBundleSelector: React.FC<AgentToolBundleSelectorProps> = ({
  selectedBundleIds,
  onChange,
}) => {
  const [catalogSummary, setCatalogSummary] = useState<QingShuSharedToolCatalogSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void qingshuGovernanceService.getCatalogSummary().then((summary) => {
      if (!active) {
        return;
      }
      setCatalogSummary(summary);
      setLoading(false);
    }).catch(() => {
      if (!active) {
        return;
      }
      setCatalogSummary(null);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, []);

  const options = useMemo(
    () => buildQingShuToolBundleOptions(catalogSummary),
    [catalogSummary],
  );

  const normalizedSelectedBundleIds = useMemo(
    () => Array.from(new Set(selectedBundleIds.map((item) => item.trim()).filter(Boolean))).sort(),
    [selectedBundleIds],
  );

  const handleToggle = (bundleId: string) => {
    if (normalizedSelectedBundleIds.includes(bundleId)) {
      onChange(normalizedSelectedBundleIds.filter((item) => item !== bundleId));
      return;
    }
    onChange([...normalizedSelectedBundleIds, bundleId].sort());
  };

  return (
    <div className="jbp-visual-soft-card mb-3 rounded-xl p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold tracking-[0.14em] text-secondary uppercase">
            {i18nService.t('agentToolBundlesEditorEyebrow')}
          </div>
          <div className="mt-1 text-sm font-medium text-foreground">
            {i18nService.t('agentToolBundlesEditorTitle')}
          </div>
        </div>
        <span className="jbp-visual-status-pill inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium">
          <Squares2X2Icon className="h-3.5 w-3.5" />
          {i18nService.t('agentToolBundlesEditorBadge')}
        </span>
      </div>

      <p className="mt-2 text-xs text-secondary">
        {i18nService.t('agentToolBundlesEditorHint')}
      </p>

      {loading ? (
        <div className="mt-3 text-xs text-secondary">
          {i18nService.t('agentToolBundlesEditorLoading')}
        </div>
      ) : options.length === 0 ? (
        <div className="mt-3 text-xs text-secondary">
          {i18nService.t('agentToolBundlesEditorEmpty')}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {options.map((option) => {
            const selected = normalizedSelectedBundleIds.includes(option.bundleId);
            return (
              <button
                key={option.bundleId}
                type="button"
                onClick={() => handleToggle(option.bundleId)}
                className={`jbp-visual-selectable-card w-full rounded-lg px-3 py-3 text-left transition-colors ${
                  selected
                    ? 'is-active'
                    : ''
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground break-all">
                      {option.bundleId}
                    </div>
                    <div className="mt-1 text-xs text-secondary break-all">
                      {i18nService.t('agentToolBundlesEditorMeta')
                        .replace('{modules}', option.moduleIds.join(', ') || '-')
                        .replace('{tools}', String(option.toolCount))}
                    </div>
                  </div>
                  <div
                    className={`mt-0.5 h-4 w-4 rounded border ${
                      selected
                        ? 'border-primary bg-primary'
                        : 'border-border bg-background'
                    }`}
                  />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AgentToolBundleSelector;
