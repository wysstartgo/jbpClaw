export const APP_NAME = 'JBPClaw';
export const APP_ID = 'lobsterai';
export const EXPORT_FORMAT_TYPE = 'lobsterai.providers';
export const EXPORT_PASSWORD = 'lobsterai-APP';

export const AppCustomEvent = {
  ShowToast: 'app:showToast',
  ShowLoginWelcome: 'app:showLoginWelcome',
  AgentCatalogRefreshed: 'app:agentCatalogRefreshed',
  FocusCoworkInput: 'app:focusCoworkInput',
  ShortcutNewCoworkSession: 'cowork:shortcut:new-session',
  StartWakeDictation: 'app:startWakeDictation',
  UpdateWakeActivationOverlay: 'app:updateWakeActivationOverlay',
} as const;
export type AppCustomEvent = typeof AppCustomEvent[keyof typeof AppCustomEvent];
