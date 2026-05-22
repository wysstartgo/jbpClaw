export interface QingShuFilePublishSuccess {
  success: true;
  fileId: string;
  shareUrl: string;
  originalFileName: string;
  contentType?: string;
  size?: number;
  checksum?: string;
  expiresAt?: string;
}

export interface QingShuFilePublishFailure {
  success: false;
  error: string;
}

export type QingShuFilePublishResult =
  | QingShuFilePublishSuccess
  | QingShuFilePublishFailure;
