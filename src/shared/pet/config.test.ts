import { describe, expect, test } from 'vitest';

import { DEFAULT_PET_CONFIG, normalizePetConfig } from './config';
import { PetAnchor, PetAssetPolicy, PetMode } from './constants';

describe('normalizePetConfig', () => {
  test('uses defaults for missing config', () => {
    expect(normalizePetConfig(undefined)).toEqual(DEFAULT_PET_CONFIG);
  });

  test('normalizes valid persisted values', () => {
    const config = normalizePetConfig({
      enabled: false,
      mode: PetMode.Both,
      selectedPetId: 'dewey',
      anchor: PetAnchor.AppBottom,
      animationsEnabled: false,
      customPetsEnabled: false,
      assetPolicy: PetAssetPolicy.DownloadOnDemand,
      floatingWindow: {
        enabled: true,
        visible: true,
        displayId: 'display-a',
        x: 10.4,
        y: 20.6,
        width: 240,
        height: 220,
      },
    });

    expect(config.enabled).toBe(false);
    expect(config.mode).toBe(PetMode.Both);
    expect(config.selectedPetId).toBe('dewey');
    expect(config.anchor).toBe(PetAnchor.AppBottom);
    expect(config.animationsEnabled).toBe(false);
    expect(config.customPetsEnabled).toBe(false);
    expect(config.assetPolicy).toBe(PetAssetPolicy.DownloadOnDemand);
    expect(config.floatingWindow).toMatchObject({
      enabled: true,
      visible: true,
      displayId: 'display-a',
      x: 10,
      y: 21,
      width: 240,
      height: 220,
    });
  });

  test('rejects invalid discriminants', () => {
    const config = normalizePetConfig({
      mode: 'sidecar',
      anchor: 'left',
      assetPolicy: 'network',
      floatingWindow: {
        width: 9999,
        height: 1,
      },
    });

    expect(config.mode).toBe(PetMode.Embedded);
    expect(config.anchor).toBe(PetAnchor.Composer);
    expect(config.assetPolicy).toBe(PetAssetPolicy.Mixed);
    expect(config.floatingWindow.width).toBe(520);
    expect(config.floatingWindow.height).toBe(120);
  });
});
