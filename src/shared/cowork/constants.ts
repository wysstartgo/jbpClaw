export const CoworkIpcChannel = {
  ForkSession: 'cowork:session:fork',
  EditUserMessage: 'cowork:message:editUserMessage',
  EditUserMessageAndRerun: 'cowork:message:editUserMessageAndRerun',
} as const;

export type CoworkIpcChannel = typeof CoworkIpcChannel[keyof typeof CoworkIpcChannel];
