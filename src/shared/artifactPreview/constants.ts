export const ArtifactPreviewIpc = {
  CreateSession: 'artifact:createPreviewSession',
  CreateOfficeSession: 'artifact:createOfficePreviewSession',
  DestroySession: 'artifact:destroyPreviewSession',
} as const;

export type ArtifactPreviewIpc = typeof ArtifactPreviewIpc[keyof typeof ArtifactPreviewIpc];
