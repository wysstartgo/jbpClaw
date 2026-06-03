export const AuthIpcChannel = {
  Callback: 'auth:callback',
  GetPendingCallback: 'auth:getPendingCallback',
} as const;

export type AuthIpcChannel = typeof AuthIpcChannel[keyof typeof AuthIpcChannel];
