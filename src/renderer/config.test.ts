import { test, expect } from 'vitest';
import {
  DEFAULT_TTS_CONFIG,
  DEFAULT_VOICE_POST_PROCESS_CONFIG,
  DEFAULT_WAKE_INPUT_CONFIG,
  defaultConfig,
  isCustomProvider,
  getCustomProviderDefaultName,
  getProviderDisplayName,
  ShortcutAction,
} from './config';

test('isCustomProvider: custom_0 is custom', () => {
  expect(isCustomProvider('custom_0')).toBe(true);
});

test('isCustomProvider: custom_1 is custom', () => {
  expect(isCustomProvider('custom_1')).toBe(true);
});

test('isCustomProvider: custom_99 is custom', () => {
  expect(isCustomProvider('custom_99')).toBe(true);
});

test('isCustomProvider: openai is not custom', () => {
  expect(isCustomProvider('openai')).toBe(false);
});

test('isCustomProvider: deepseek is not custom', () => {
  expect(isCustomProvider('deepseek')).toBe(false);
});

test('isCustomProvider: empty string is not custom', () => {
  expect(isCustomProvider('')).toBe(false);
});

test('isCustomProvider: "custom" without underscore is not custom', () => {
  expect(isCustomProvider('custom')).toBe(false);
});

test('getCustomProviderDefaultName: custom_0 -> Custom0', () => {
  expect(getCustomProviderDefaultName('custom_0')).toBe('Custom0');
});

test('getCustomProviderDefaultName: custom_1 -> Custom1', () => {
  expect(getCustomProviderDefaultName('custom_1')).toBe('Custom1');
});

test('getCustomProviderDefaultName: custom_42 -> Custom42', () => {
  expect(getCustomProviderDefaultName('custom_42')).toBe('Custom42');
});

test('getProviderDisplayName: built-in provider capitalizes first letter', () => {
  expect(getProviderDisplayName('openai')).toBe('OpenAI');
});

test('getProviderDisplayName: built-in provider with no config', () => {
  expect(getProviderDisplayName('deepseek')).toBe('DeepSeek');
});

test('getProviderDisplayName: custom provider without config uses default name', () => {
  expect(getProviderDisplayName('custom_0')).toBe('Custom0');
});

test('getProviderDisplayName: custom provider with empty displayName uses default', () => {
  expect(getProviderDisplayName('custom_0', { displayName: '' })).toBe('Custom0');
});

test('getProviderDisplayName: custom provider with displayName uses it', () => {
  expect(getProviderDisplayName('custom_0', { displayName: 'My GPT' })).toBe('My GPT');
});

test('getProviderDisplayName: custom provider with non-string displayName uses default', () => {
  expect(getProviderDisplayName('custom_1', { displayName: 123 })).toBe('Custom1');
});

test('getProviderDisplayName: custom provider with undefined displayName uses default', () => {
  expect(getProviderDisplayName('custom_2', { displayName: undefined })).toBe('Custom2');
});

test('getProviderDisplayName: custom provider with no displayName field uses default', () => {
  expect(getProviderDisplayName('custom_3', { apiKey: 'sk-xxx' })).toBe('Custom3');
});

test('DEFAULT_VOICE_POST_PROCESS_CONFIG: all new voice post-process toggles are off by default', () => {
  expect(DEFAULT_VOICE_POST_PROCESS_CONFIG).toEqual({
    sttLlmCorrectionEnabled: false,
    ttsLlmRewriteEnabled: false,
    ttsSkipKeywords: [],
  });
});

test('DEFAULT_WAKE_INPUT_CONFIG: wake activation reply stays off by default', () => {
  expect(DEFAULT_WAKE_INPUT_CONFIG.activationReplyEnabled).toBe(false);
  expect(DEFAULT_WAKE_INPUT_CONFIG.activationReplyText).toBe('在的');
});

test('DEFAULT_TTS_CONFIG: macOS native engine remains the default engine', () => {
  expect(DEFAULT_TTS_CONFIG.engine).toBe('macos_native');
});

test('defaultConfig leaves agent shortcuts unset', () => {
  expect(defaultConfig.shortcuts?.[ShortcutAction.PreviousAgent]).toBe('');
  expect(defaultConfig.shortcuts?.[ShortcutAction.NextAgent]).toBe('');
  expect(defaultConfig.shortcuts?.[ShortcutAction.ShowCurrentAgentTasks]).toBe('');
  expect(defaultConfig.shortcuts?.[ShortcutAction.OpenAgentTask1]).toBe('');
  expect(defaultConfig.shortcuts?.[ShortcutAction.OpenAgentTask2]).toBe('');
  expect(defaultConfig.shortcuts?.[ShortcutAction.OpenAgentTask3]).toBe('');
  expect(defaultConfig.shortcuts?.[ShortcutAction.OpenAgentTask4]).toBe('');
  expect(defaultConfig.shortcuts?.[ShortcutAction.OpenAgentTask5]).toBe('');
  expect(defaultConfig.shortcuts?.[ShortcutAction.OpenAgentTask6]).toBe('');
  expect(defaultConfig.shortcuts?.[ShortcutAction.OpenAgentTask7]).toBe('');
  expect(defaultConfig.shortcuts?.[ShortcutAction.OpenAgentTask8]).toBe('');
  expect(defaultConfig.shortcuts?.[ShortcutAction.OpenAgentTask9]).toBe('');
});
