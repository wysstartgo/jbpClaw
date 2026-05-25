import { describe, expect, test } from 'vitest';

import { isPetFloatingRoute, normalizeRendererHashRoute } from './floatingRoute';

describe('pet floating renderer route', () => {
  test('recognizes hash routes used by Electron loadURL and loadFile', () => {
    expect(isPetFloatingRoute('#pet-floating')).toBe(true);
    expect(isPetFloatingRoute('#/pet-floating')).toBe(true);
  });

  test('keeps normal renderer routes in the main app', () => {
    expect(normalizeRendererHashRoute('')).toBe('');
    expect(isPetFloatingRoute('')).toBe(false);
    expect(isPetFloatingRoute('#settings')).toBe(false);
  });
});
