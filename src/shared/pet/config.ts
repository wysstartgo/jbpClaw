import {
  DEFAULT_PET_ID,
  PetAnchor,
  PetAssetPolicy,
  PetMode,
} from './constants';
import type { PetConfig } from './types';

export const DEFAULT_PET_CONFIG: PetConfig = {
  enabled: true,
  mode: PetMode.Embedded,
  selectedPetId: DEFAULT_PET_ID,
  anchor: PetAnchor.Composer,
  animationsEnabled: true,
  customPetsEnabled: true,
  assetPolicy: PetAssetPolicy.Mixed,
  floatingWindow: {
    enabled: false,
    visible: false,
    width: 180,
    height: 190,
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  !!value && typeof value === 'object' && !Array.isArray(value)
);

const normalizeBoolean = (value: unknown, fallback: boolean): boolean => (
  typeof value === 'boolean' ? value : fallback
);

const normalizeNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
};

export function normalizePetConfig(value: unknown): PetConfig {
  if (!isRecord(value)) return DEFAULT_PET_CONFIG;

  const floatingWindow = isRecord(value.floatingWindow) ? value.floatingWindow : {};
  const selectedPetId = typeof value.selectedPetId === 'string' && value.selectedPetId.trim()
    ? value.selectedPetId.trim()
    : value.selectedPetId === null
      ? null
      : DEFAULT_PET_CONFIG.selectedPetId;

  return {
    enabled: normalizeBoolean(value.enabled, DEFAULT_PET_CONFIG.enabled),
    mode: value.mode === PetMode.Floating || value.mode === PetMode.Both
      ? value.mode
      : PetMode.Embedded,
    selectedPetId,
    anchor: value.anchor === PetAnchor.AppBottom || value.anchor === PetAnchor.ScreenBottom
      ? value.anchor
      : PetAnchor.Composer,
    animationsEnabled: normalizeBoolean(value.animationsEnabled, DEFAULT_PET_CONFIG.animationsEnabled),
    customPetsEnabled: normalizeBoolean(value.customPetsEnabled, DEFAULT_PET_CONFIG.customPetsEnabled),
    assetPolicy: value.assetPolicy === PetAssetPolicy.BundledOnly || value.assetPolicy === PetAssetPolicy.DownloadOnDemand
      ? value.assetPolicy
      : PetAssetPolicy.Mixed,
    floatingWindow: {
      enabled: normalizeBoolean(floatingWindow.enabled, DEFAULT_PET_CONFIG.floatingWindow.enabled),
      visible: normalizeBoolean(floatingWindow.visible, DEFAULT_PET_CONFIG.floatingWindow.visible),
      ...(typeof floatingWindow.displayId === 'string' && floatingWindow.displayId.trim()
        ? { displayId: floatingWindow.displayId.trim() }
        : {}),
      ...(typeof floatingWindow.x === 'number' && Number.isFinite(floatingWindow.x)
        ? { x: Math.round(floatingWindow.x) }
        : {}),
      ...(typeof floatingWindow.y === 'number' && Number.isFinite(floatingWindow.y)
        ? { y: Math.round(floatingWindow.y) }
        : {}),
      width: normalizeNumber(floatingWindow.width, DEFAULT_PET_CONFIG.floatingWindow.width, 120, 520),
      height: normalizeNumber(floatingWindow.height, DEFAULT_PET_CONFIG.floatingWindow.height, 120, 520),
    },
  };
}
