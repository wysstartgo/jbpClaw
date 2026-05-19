export interface CoworkRuntimeImageAttachment {
  name: string;
  mimeType: string;
  base64Data: string;
}

export interface CoworkCachedImageAttachment {
  name: string;
  mimeType?: string;
  path: string;
  sizeBytes?: number;
}

export type CoworkImageAttachmentInput =
  | CoworkRuntimeImageAttachment
  | CoworkCachedImageAttachment;

export type CoworkImageAttachment = CoworkRuntimeImageAttachment;

export interface CoworkImageAttachmentMetadata {
  name: string;
  mimeType: string;
  sizeBytes?: number;
  base64Length?: number;
  source?: 'runtime' | 'cached';
}

export const isCoworkRuntimeImageAttachment = (value: unknown): value is CoworkRuntimeImageAttachment => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const attachment = value as CoworkRuntimeImageAttachment;
  return typeof attachment.name === 'string'
    && typeof attachment.mimeType === 'string'
    && typeof attachment.base64Data === 'string';
};

export const isCoworkCachedImageAttachment = (value: unknown): value is CoworkCachedImageAttachment => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const attachment = value as CoworkCachedImageAttachment;
  return typeof attachment.name === 'string'
    && typeof attachment.path === 'string'
    && !('base64Data' in attachment);
};

const isCoworkImageAttachmentMetadata = (value: unknown): value is CoworkImageAttachmentMetadata => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const attachment = value as CoworkImageAttachmentMetadata;
  return typeof attachment.name === 'string'
    && typeof attachment.mimeType === 'string';
};

export const estimateBase64ByteLength = (base64Data: string): number => {
  const normalized = base64Data.trim();
  if (!normalized) return 0;
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
};

export const summarizeCoworkImageAttachments = (
  attachments?: readonly unknown[] | null,
): CoworkImageAttachmentMetadata[] | undefined => {
  if (!attachments?.length) {
    return undefined;
  }
  const summaries = attachments
    .map((attachment) => {
      if (isCoworkRuntimeImageAttachment(attachment)) {
        return {
          name: attachment.name,
          mimeType: attachment.mimeType,
          sizeBytes: estimateBase64ByteLength(attachment.base64Data),
          base64Length: attachment.base64Data.length,
          source: 'runtime' as const,
        };
      }
      if (isCoworkCachedImageAttachment(attachment)) {
        return {
          name: attachment.name,
          mimeType: attachment.mimeType || 'application/octet-stream',
          ...(typeof attachment.sizeBytes === 'number' ? { sizeBytes: attachment.sizeBytes } : {}),
          source: 'cached' as const,
        };
      }
      if (isCoworkImageAttachmentMetadata(attachment)) {
        return {
          name: attachment.name,
          mimeType: attachment.mimeType,
          ...(typeof attachment.sizeBytes === 'number' ? { sizeBytes: attachment.sizeBytes } : {}),
          ...(typeof attachment.base64Length === 'number' ? { base64Length: attachment.base64Length } : {}),
          ...(attachment.source ? { source: attachment.source } : {}),
        };
      }
      return null;
    })
    .filter((attachment): attachment is CoworkImageAttachmentMetadata => attachment !== null);
  return summaries.length ? summaries : undefined;
};

export const stripCoworkImageAttachmentPayloads = (
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
  if (!metadata) {
    return undefined;
  }

  const { imageAttachments, ...rest } = metadata;
  const summary = Array.isArray(imageAttachments)
    ? summarizeCoworkImageAttachments(imageAttachments)
    : undefined;
  return {
    ...rest,
    ...(summary?.length ? { imageAttachments: summary } : {}),
  };
};
