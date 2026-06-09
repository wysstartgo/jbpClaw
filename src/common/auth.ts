export const AuthBackend = {
  LegacyLobster: 'legacy_lobster',
  Qtb: 'qtb',
} as const;

export type AuthBackend = typeof AuthBackend[keyof typeof AuthBackend];

export interface AuthConfig {
  backend: AuthBackend;
  qtbApiBaseUrl: string;
  qtbWebBaseUrl: string;
  eladminMpBaseUrl: string;
}

export interface AuthCallbackPayload {
  code: string;
  state?: string;
}

export interface AuthPasswordLoginInput {
  username: string;
  password: string;
}

export const AuthLoginMode = {
  Scan: 'scan',
  Manual: 'manual',
} as const;

export type AuthLoginMode = typeof AuthLoginMode[keyof typeof AuthLoginMode];

export const BridgeTarget = {
  Web: 'web',
  Desktop: 'desktop',
} as const;

export type BridgeTarget = typeof BridgeTarget[keyof typeof BridgeTarget];

export interface CreateBridgeTicketRequest {
  target: BridgeTarget;
  redirectPath?: string;
}

export interface CreateBridgeTicketResponse {
  code: string;
  expiresAt: number;
  launchUrl?: string;
}

export interface ExchangeBridgeCodeRequest {
  code: string;
  target: BridgeTarget;
}

export interface WebBridgeSessionPayload {
  target: typeof BridgeTarget.Web;
  accessToken: string;
  redirectPath?: string;
}

export interface DesktopBridgeSessionPayload {
  target: typeof BridgeTarget.Desktop;
  accessToken: string;
  refreshToken: string;
  expiresAt?: number;
  refreshExpiresAt?: number;
  redirectPath?: string;
}

export type BridgeSessionPayload = WebBridgeSessionPayload | DesktopBridgeSessionPayload;

export const FeishuScanSessionStatus = {
  Pending: 'PENDING',
  Scanned: 'SCANNED',
  Bound: 'BOUND',
  Failed: 'FAILED',
  Expired: 'EXPIRED',
} as const;

export type FeishuScanSessionStatus =
  typeof FeishuScanSessionStatus[keyof typeof FeishuScanSessionStatus];

export interface FeishuScanSession {
  scanSessionId: string;
  status: FeishuScanSessionStatus;
  authorizeUrl?: string;
  qrCodeContent?: string;
  expiredAt?: number;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface FeishuScanSessionPollResult extends FeishuScanSession {
  authenticated?: boolean;
  user?: any;
  quota?: any;
}

export const DEFAULT_QTB_API_BASE_URL = 'http://localhost:9080';
export const DEFAULT_QTB_WEB_BASE_URL = 'http://localhost:9080/webapp';
export const DEFAULT_ELADMIN_MP_BASE_URL = 'http://localhost:8008/cqjbpapi';

export const DEFAULT_AUTH_CONFIG: AuthConfig = {
  backend: AuthBackend.Qtb,
  qtbApiBaseUrl: DEFAULT_QTB_API_BASE_URL,
  qtbWebBaseUrl: DEFAULT_QTB_WEB_BASE_URL,
  eladminMpBaseUrl: DEFAULT_ELADMIN_MP_BASE_URL,
};
