export const GPT_IMAGE_2_MODEL_ID = 'gpt-image-2';
export const CANVAS20_LEGACY_MODEL_ID = 'canvas-20';

const MEDIA_MODEL_ID_ALIASES: Record<string, string> = {
  [CANVAS20_LEGACY_MODEL_ID]: GPT_IMAGE_2_MODEL_ID,
};

export function canonicalizeMediaModelId(modelId: string | null | undefined): string {
  const normalized = typeof modelId === 'string' ? modelId.trim() : '';
  return MEDIA_MODEL_ID_ALIASES[normalized] ?? normalized;
}

export function mediaModelDisplayName(modelId: string | null | undefined, fallbackName?: string | null): string {
  const canonicalModelId = canonicalizeMediaModelId(modelId);
  if (canonicalModelId === GPT_IMAGE_2_MODEL_ID) {
    return GPT_IMAGE_2_MODEL_ID;
  }
  const normalizedFallback = typeof fallbackName === 'string' ? fallbackName.trim() : '';
  return normalizedFallback || canonicalModelId;
}
