export const ArtifactTypeValue = {
  Html: 'html',
  Svg: 'svg',
  Image: 'image',
  Mermaid: 'mermaid',
  React: 'react',
  Code: 'code',
  Markdown: 'markdown',
  Text: 'text',
  Document: 'document',
  LocalService: 'local-service',
} as const;
export type ArtifactType = typeof ArtifactTypeValue[keyof typeof ArtifactTypeValue];

export const PREVIEWABLE_ARTIFACT_TYPES = new Set<ArtifactType>([
  ArtifactTypeValue.Html,
  ArtifactTypeValue.Svg,
  ArtifactTypeValue.Mermaid,
  ArtifactTypeValue.Image,
  ArtifactTypeValue.Markdown,
  ArtifactTypeValue.Text,
  ArtifactTypeValue.Document,
  ArtifactTypeValue.LocalService,
]);

export type ArtifactSource = 'codeblock' | 'tool';

export interface Artifact {
  id: string;
  messageId: string;
  conversationId?: string;
  sessionId?: string;
  type: ArtifactType;
  title: string;
  content: string;
  language?: string;
  fileName?: string;
  filePath?: string;
  url?: string;
  contentVersion?: number;
  source?: ArtifactSource;
  createdAt: number;
}

export interface ArtifactMarker {
  type: ArtifactType;
  title: string;
  content: string;
  language?: string;
  fullMatch: string;
}
