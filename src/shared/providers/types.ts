import type { ApiFormat } from './constants';

export interface ProviderModelConfig {
  id: string;
  name: string;
  supportsImage?: boolean;
  contextWindow?: number;
  openClawProviderId?: string;
  customParams?: Record<string, unknown>;
}

export interface ProviderConfig {
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  apiFormat?: ApiFormat | 'native';
  codingPlanEnabled?: boolean;
  authType?: 'apikey' | 'oauth';
  oauthRefreshToken?: string;
  oauthTokenExpiresAt?: number;
  oauthAccessToken?: string;
  oauthBaseUrl?: string;
  displayName?: string;
  models?: ProviderModelConfig[];
}
