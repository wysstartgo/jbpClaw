export const QingShuFileIpcChannel = {
  Publish: 'qingshuFile:publish',
} as const;

export type QingShuFileIpcChannel =
  typeof QingShuFileIpcChannel[keyof typeof QingShuFileIpcChannel];

export const QingShuFileToolName = {
  Publish: 'qingshu_file_publish',
} as const;

export type QingShuFileToolName =
  typeof QingShuFileToolName[keyof typeof QingShuFileToolName];
