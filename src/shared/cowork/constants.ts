export const CoworkIpcChannel = {
  ForkSession: 'cowork:session:fork',
  EditUserMessage: 'cowork:message:editUserMessage',
} as const;

export type CoworkIpcChannel = typeof CoworkIpcChannel[keyof typeof CoworkIpcChannel];
