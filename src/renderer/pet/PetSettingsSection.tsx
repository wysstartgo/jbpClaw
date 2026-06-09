import { ArrowPathIcon, BoltIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import React, { useMemo, useState } from 'react';

import { PET_BUILTIN_CATALOG_ORDER, PetAnchor, PetAssetPolicy, PetMode, PetSource } from '../../shared/pet/constants';
import type { PetCatalogEntry } from '../../shared/pet/types';
import { i18nService } from '../services/i18n';
import { PetSprite } from './PetCompanion';
import { petService } from './petService';
import { usePetState } from './usePetState';

const sourceText = (pet: PetCatalogEntry): string => {
  if (pet.source === PetSource.Custom) return i18nService.t('petSourceCustom');
  if (pet.source === PetSource.LegacyAvatar) return i18nService.t('petSourceLegacyAvatar');
  if (pet.source === PetSource.CodexCustom) return i18nService.t('petSourceCodexCustom');
  if (pet.bundled) return i18nService.t('petSourceBundled');
  return pet.installed ? i18nService.t('petSourceDownloaded') : i18nService.t('petSourceOnDemand');
};

const petActionText = (pet: PetCatalogEntry, selected: boolean): string => {
  if (selected) return i18nService.t('petSelected');
  if (!pet.installed && pet.downloadUrl) return i18nService.t('petDownloadAndSelect');
  return i18nService.t('petSelect');
};

const petSortOrder = (pet: PetCatalogEntry): number => {
  const builtinIndex = PET_BUILTIN_CATALOG_ORDER.findIndex((id) => id === pet.id);
  if (builtinIndex >= 0 && (pet.source === PetSource.Bundled || pet.source === PetSource.Downloaded)) {
    return builtinIndex;
  }
  if (pet.source === PetSource.Custom || pet.source === PetSource.LegacyAvatar || pet.source === PetSource.CodexCustom) {
    return PET_BUILTIN_CATALOG_ORDER.length + 1;
  }
  return PET_BUILTIN_CATALOG_ORDER.length;
};

const isCustomPet = (pet: PetCatalogEntry): boolean => (
  pet.source === PetSource.Custom
  || pet.source === PetSource.LegacyAvatar
  || pet.source === PetSource.CodexCustom
);

const Toggle: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}> = ({ checked, onChange, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
      disabled ? 'cursor-not-allowed opacity-50' : ''
    } ${checked ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'}`}
  >
    <span
      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
        checked ? 'translate-x-6' : 'translate-x-1'
      }`}
    />
  </button>
);

const PetSettingsSection: React.FC = () => {
  const state = usePetState();
  const [error, setError] = useState<string | null>(null);
  const [busyPetId, setBusyPetId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [waking, setWaking] = useState(false);
  const [previewPetId, setPreviewPetId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const sortedPets = useMemo(
    () => [...(state?.pets ?? [])].sort((left, right) => {
      const orderDelta = petSortOrder(left) - petSortOrder(right);
      return orderDelta || left.displayName.localeCompare(right.displayName);
    }),
    [state?.pets],
  );
  const builtInPets = useMemo(
    () => sortedPets.filter((pet) => !isCustomPet(pet)),
    [sortedPets],
  );
  const customPets = useMemo(
    () => sortedPets.filter(isCustomPet),
    [sortedPets],
  );
  const previewPet = useMemo(
    () => sortedPets.find((pet) => pet.id === previewPetId)
      ?? state?.activePet
      ?? sortedPets.find((pet) => pet.selectable)
      ?? null,
    [previewPetId, sortedPets, state?.activePet],
  );

  if (!state) {
    return (
      <div className="rounded-lg border border-border bg-surface-subtle p-4 text-sm text-secondary">
        {i18nService.t('petLoadingConfig')}
      </div>
    );
  }

  const updateConfig = async (patch: Parameters<typeof petService.setConfig>[0]) => {
    setError(null);
    try {
      await petService.setConfig(patch);
    } catch (err) {
      setError(err instanceof Error ? err.message : i18nService.t('petSaveConfigFailed'));
    }
  };

  const wakePet = async () => {
    setError(null);
    setWaking(true);
    try {
      const selectedPetId = state.config.selectedPetId
        ?? state.activePet?.id
        ?? sortedPets.find((pet) => pet.selectable)?.id
        ?? null;
      if (selectedPetId && selectedPetId !== state.activePet?.id) {
        await petService.selectPet(selectedPetId);
      }
      await petService.setConfig({ enabled: true });
      if (state.config.mode === PetMode.Floating || state.config.mode === PetMode.Both) {
        await petService.setFloatingVisible(true);
      }
      await petService.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : i18nService.t('petSaveConfigFailed'));
    } finally {
      setWaking(false);
    }
  };

  const refreshPets = async () => {
    setError(null);
    setRefreshing(true);
    try {
      await petService.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : i18nService.t('petRefreshFailed'));
    } finally {
      setRefreshing(false);
    }
  };

  const renderPetList = (pets: PetCatalogEntry[], emptyText: string) => (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      {pets.length === 0 ? (
        <div className="px-4 py-6 text-sm text-secondary">{emptyText}</div>
      ) : pets.map((pet) => {
        const selected = pet.id === state.config.selectedPetId;
        const busy = busyPetId === pet.id;
        return (
          <div
            key={`${pet.source}-${pet.id}`}
            onPointerEnter={() => setPreviewPetId(pet.id)}
            onFocusCapture={() => setPreviewPetId(pet.id)}
            className={`flex min-h-[112px] items-center gap-4 border-b border-border px-4 py-3 last:border-b-0 ${
              selected ? 'bg-primary/5' : previewPet?.id === pet.id ? 'bg-surface-subtle/80' : ''
            } ${pet.selectable ? '' : 'opacity-70'}`}
          >
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-surface-subtle">
              {pet.manifest ? (
                <PetSprite
                  pet={pet}
                  status={state.status}
                  animationsEnabled={false}
                  size={56}
                />
              ) : (
                <span className="px-2 text-center text-[10px] leading-4 text-secondary">{i18nService.t('petPendingDownload')}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-medium text-foreground">{pet.displayName}</div>
              <div className="mt-1 line-clamp-2 text-sm leading-5 text-secondary">
                {pet.description || sourceText(pet)}
              </div>
              <div className="mt-1 text-xs text-secondary">{sourceText(pet)}</div>
              {pet.error && <div className="truncate text-xs text-red-500">{pet.error}</div>}
            </div>
            <button
              type="button"
              disabled={!pet.selectable || busy}
              title={pet.error || undefined}
              onClick={async () => {
                setError(null);
                setBusyPetId(pet.id);
                try {
                  await petService.selectPet(pet.id);
                  setPreviewPetId(pet.id);
                } catch (err) {
                  setError(err instanceof Error ? err.message : i18nService.t('petSaveConfigFailed'));
                } finally {
                  setBusyPetId(null);
                }
              }}
              className={`shrink-0 rounded-xl px-4 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                selected
                  ? 'bg-surface-subtle text-secondary'
                  : 'bg-surface-subtle text-foreground hover:bg-surface-hover'
              }`}
            >
              {busy ? i18nService.t('petLoading') : petActionText(pet, selected)}
            </button>
            {(pet.source === PetSource.Custom || pet.source === PetSource.LegacyAvatar) && (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setError(null);
                  setBusyPetId(pet.id);
                  try {
                    await petService.deletePet(pet.id);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : i18nService.t('petSaveConfigFailed'));
                  } finally {
                    setBusyPetId(null);
                  }
                }}
                className="rounded-md px-2 py-1 text-xs text-red-500 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {i18nService.t('petDelete')}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div id="pet-settings-section" className="space-y-5 rounded-lg border border-border bg-surface-subtle p-4">
      <div className="flex items-start justify-between gap-4">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
          className="flex min-w-0 flex-1 items-start gap-2 rounded-md text-left"
        >
          <ChevronDownIcon
            className={`mt-0.5 h-4 w-4 shrink-0 text-secondary transition-transform ${
              expanded ? 'rotate-180' : ''
            }`}
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground">{i18nService.t('petSettingsTitle')}</span>
            <span className="mt-1 block text-xs leading-5 text-secondary">
              {i18nService.t('petSettingsDescription')}
            </span>
          </span>
        </button>
        <Toggle
          checked={state.config.enabled}
          onChange={(enabled) => void updateConfig({ enabled })}
        />
      </div>

      {expanded && (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_180px]">
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-secondary">{i18nService.t('petDisplayMode')}</span>
                <select
                  value={state.config.mode}
                  onChange={(event) => void updateConfig({ mode: event.target.value as PetMode })}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none"
                >
                  <option value={PetMode.Embedded}>{i18nService.t('petModeEmbedded')}</option>
                  <option value={PetMode.Floating}>{i18nService.t('petModeFloating')}</option>
                  <option value={PetMode.Both}>{i18nService.t('petModeBoth')}</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-secondary">{i18nService.t('petAnchor')}</span>
                <select
                  value={state.config.anchor}
                  onChange={(event) => void updateConfig({ anchor: event.target.value as PetAnchor })}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none"
                >
                  <option value={PetAnchor.Composer}>{i18nService.t('petAnchorComposer')}</option>
                  <option value={PetAnchor.AppBottom}>{i18nService.t('petAnchorAppBottom')}</option>
                  <option value={PetAnchor.ScreenBottom}>{i18nService.t('petAnchorScreenBottom')}</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-secondary">{i18nService.t('petAssetPolicy')}</span>
                <select
                  value={state.config.assetPolicy}
                  onChange={(event) => void updateConfig({ assetPolicy: event.target.value as PetAssetPolicy })}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:outline-none"
                >
                  <option value={PetAssetPolicy.Mixed}>{i18nService.t('petAssetPolicyMixed')}</option>
                  <option value={PetAssetPolicy.BundledOnly}>{i18nService.t('petAssetPolicyBundledOnly')}</option>
                  <option value={PetAssetPolicy.DownloadOnDemand}>{i18nService.t('petAssetPolicyDownloadOnDemand')}</option>
                </select>
                <span className="mt-1 block text-xs text-secondary">{i18nService.t('petAssetPolicyHint')}</span>
              </label>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-foreground">{i18nService.t('petAnimations')}</div>
                  <div className="text-xs text-secondary">{i18nService.t('petAnimationsHint')}</div>
                </div>
                <Toggle
                  checked={state.config.animationsEnabled}
                  onChange={(animationsEnabled) => void updateConfig({ animationsEnabled })}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-foreground">{i18nService.t('petFloatingWindow')}</div>
                  <div className="text-xs text-secondary">{i18nService.t('petFloatingWindowHint')}</div>
                </div>
                <Toggle
                  checked={state.config.floatingWindow.visible}
                  disabled={state.config.mode === PetMode.Embedded}
                  onChange={(visible) => {
                    setError(null);
                    void petService.setFloatingVisible(visible).catch((err) => {
                      setError(err instanceof Error ? err.message : i18nService.t('petSaveConfigFailed'));
                    });
                  }}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-foreground">{i18nService.t('petCustomPets')}</div>
                  <div className="text-xs text-secondary">{i18nService.t('petCustomPetsHint')}</div>
                </div>
                <Toggle
                  checked={state.config.customPetsEnabled}
                  onChange={(customPetsEnabled) => void updateConfig({ customPetsEnabled })}
                />
              </div>
            </div>

            <div className="flex min-h-[170px] flex-col items-center justify-center rounded-lg border border-border bg-surface px-3 py-4 text-center">
              {previewPet?.manifest ? (
                <>
                  <PetSprite
                    pet={previewPet}
                    status={state.status}
                    animationsEnabled={state.config.animationsEnabled}
                    size={96}
                  />
                  <div className="mt-2 max-w-full truncate text-sm font-medium text-foreground">
                    {previewPet.displayName}
                  </div>
                  <div className="mt-1 text-xs text-secondary">{sourceText(previewPet)}</div>
                  {previewPet.id === state.config.selectedPetId && (
                    <div className="mt-2 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                      {i18nService.t('petSelected')}
                    </div>
                  )}
                </>
              ) : previewPet ? (
                <>
                  <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-border bg-surface-subtle px-3 text-xs text-secondary">
                    {i18nService.t('petPendingDownload')}
                  </div>
                  <div className="mt-2 max-w-full truncate text-sm font-medium text-foreground">
                    {previewPet.displayName}
                  </div>
                  <div className="mt-1 text-xs text-secondary">{sourceText(previewPet)}</div>
                </>
              ) : (
                <span className="text-xs text-secondary">{i18nService.t('petPreviewEmpty')}</span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <h5 className="text-xs font-medium uppercase tracking-wide text-secondary">{i18nService.t('petSelectTitle')}</h5>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={waking}
                onClick={() => void wakePet()}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                <BoltIcon className="h-3.5 w-3.5" />
                {waking ? i18nService.t('petWaking') : i18nService.t('petWake')}
              </button>
              <button
                type="button"
                disabled={refreshing}
                onClick={() => void refreshPets()}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ArrowPathIcon className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? i18nService.t('petRefreshing') : i18nService.t('petRefresh')}
              </button>
              <button
                type="button"
                disabled={!state.config.customPetsEnabled || importing}
                onClick={async () => {
                  setError(null);
                  setImporting(true);
                  try {
                    await petService.importPet();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : i18nService.t('petImportFailed'));
                  } finally {
                    setImporting(false);
                  }
                }}
                className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {importing ? i18nService.t('petImporting') : i18nService.t('petImport')}
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <div className="mb-2 flex items-end justify-between gap-3">
                <div>
                  <h6 className="text-sm font-medium text-foreground">{i18nService.t('petBuiltInPets')}</h6>
                  <p className="mt-0.5 text-xs text-secondary">{i18nService.t('petBuiltInPetsHint')}</p>
                </div>
                <span className="text-xs text-secondary">{builtInPets.length}</span>
              </div>
              {renderPetList(builtInPets, i18nService.t('petNoBuiltInPets'))}
            </div>

            <div>
              <div className="mb-2 flex items-end justify-between gap-3">
                <div>
                  <h6 className="text-sm font-medium text-foreground">{i18nService.t('petCustomPetListTitle')}</h6>
                  <p className="mt-0.5 text-xs text-secondary">{i18nService.t('petCustomPetListHint')}</p>
                </div>
                <span className="text-xs text-secondary">{customPets.length}</span>
              </div>
              {renderPetList(customPets, i18nService.t('petNoCustomPets'))}
            </div>
          </div>
        </>
      )}

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
          {error}
        </div>
      )}
    </div>
  );
};

export default PetSettingsSection;
