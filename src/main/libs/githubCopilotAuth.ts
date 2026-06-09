/**
 * GitHub Copilot OAuth Device Flow service.
 *
 * Implements the device code authorization flow:
 * 1. Request a device code from GitHub
 * 2. User visits the verification URL and enters the code
 * 3. Poll GitHub for an access token
 * 4. Exchange the GitHub token for a Copilot API token
 */

import { session } from 'electron';

const GITHUB_CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';

export const DEFAULT_COPILOT_API_BASE_URL = 'https://api.individual.githubcopilot.com';

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface CopilotAuthStatus {
  status: 'idle' | 'awaiting_user' | 'polling' | 'authenticated' | 'error';
  userCode?: string;
  verificationUri?: string;
  error?: string;
  token?: string;
  githubUser?: string;
}

let currentPollAbort: AbortController | null = null;

async function fetchJson<T>(url: string, options: RequestInit): Promise<T> {
  const response = await session.defaultSession.fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return response.json() as Promise<T>;
}

export function deriveCopilotApiBaseUrlFromToken(token: string): string | null {
  const trimmed = token.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/(?:^|;)\s*proxy-ep=([^;\s]+)/i);
  const proxyEp = match?.[1]?.trim();
  if (!proxyEp) {
    return null;
  }

  const host = proxyEp.replace(/^https?:\/\//, '').replace(/^proxy\./i, 'api.');
  if (!host) {
    return null;
  }

  return `https://${host}`;
}

export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const body = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    scope: 'read:user',
  });

  const response = await session.defaultSession.fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to request device code: HTTP ${response.status} - ${text}`);
  }

  return response.json() as Promise<DeviceCodeResponse>;
}

export async function pollForAccessToken(
  deviceCode: string,
  interval: number,
  expiresIn: number,
  onStatusChange?: (status: string) => void,
): Promise<string> {
  cancelPolling();

  const controller = new AbortController();
  currentPollAbort = controller;

  const pollInterval = Math.max(interval, 5) * 1000;
  const deadline = Date.now() + expiresIn * 1000;

  while (Date.now() < deadline) {
    if (controller.signal.aborted) {
      throw new Error('Polling cancelled');
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    if (controller.signal.aborted) {
      throw new Error('Polling cancelled');
    }

    try {
      const body = new URLSearchParams({
        client_id: GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      });

      const response = await session.defaultSession.fetch(ACCESS_TOKEN_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
        signal: controller.signal,
      });

      const data = await response.json() as Record<string, unknown>;

      if (typeof data.access_token === 'string' && data.access_token) {
        currentPollAbort = null;
        return data.access_token;
      }

      if (data.error === 'authorization_pending') {
        onStatusChange?.('waiting');
        continue;
      }

      if (data.error === 'slow_down') {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }

      if (data.error === 'expired_token') {
        throw new Error('Device code expired. Please try again.');
      }

      if (data.error === 'access_denied') {
        throw new Error('Authorization was denied by the user.');
      }

      if (typeof data.error === 'string' && data.error) {
        const description = typeof data.error_description === 'string' ? data.error_description : '';
        throw new Error(`GitHub OAuth error: ${data.error}${description ? ` - ${description}` : ''}`);
      }
    } catch (error: unknown) {
      if (error instanceof Error && (error.name === 'AbortError' || controller.signal.aborted)) {
        throw new Error('Polling cancelled');
      }
      throw error;
    }
  }

  throw new Error('Device code expired. Please try again.');
}

export async function getCopilotToken(githubAccessToken: string): Promise<{
  token: string;
  expiresAt: number;
  baseUrl: string;
}> {
  const response = await session.defaultSession.fetch(COPILOT_TOKEN_URL, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${githubAccessToken}`,
      Accept: 'application/json',
      'Editor-Version': 'vscode/1.96.2',
      'Editor-Plugin-Version': 'copilot-chat/0.26.7',
      'User-Agent': 'GitHubCopilotChat/0.26.7',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 401) {
      throw new Error('GitHub token is invalid or expired. Please re-authenticate.');
    }
    if (response.status === 403) {
      throw new Error('You do not have an active GitHub Copilot subscription.');
    }
    throw new Error(`Failed to get Copilot token: HTTP ${response.status} - ${text}`);
  }

  const data = await response.json() as Record<string, unknown>;
  const token = typeof data.token === 'string' ? data.token : '';
  const rawExpiresAt = data.expires_at;

  let expiresAt: number;
  if (typeof rawExpiresAt === 'number' && Number.isFinite(rawExpiresAt)) {
    expiresAt = rawExpiresAt > 10_000_000_000 ? rawExpiresAt : rawExpiresAt * 1000;
  } else {
    expiresAt = Date.now() + 30 * 60 * 1000;
  }

  const baseUrl = deriveCopilotApiBaseUrlFromToken(token) ?? DEFAULT_COPILOT_API_BASE_URL;
  console.log(`[GithubCopilotAuth] resolved API base URL: ${baseUrl}`);

  return {
    token,
    expiresAt,
    baseUrl,
  };
}

export async function getGitHubUser(accessToken: string): Promise<string> {
  const data = await fetchJson<Record<string, unknown>>('https://api.github.com/user', {
    headers: {
      Authorization: `token ${accessToken}`,
      Accept: 'application/json',
      'User-Agent': 'JBPClaw',
    },
  });
  return typeof data.login === 'string' ? data.login : 'unknown';
}

export function cancelPolling(): void {
  if (currentPollAbort) {
    currentPollAbort.abort();
    currentPollAbort = null;
  }
}

export async function authenticateWithDeviceFlow(
  onDeviceCode: (userCode: string, verificationUri: string) => void,
  onStatusChange?: (status: string) => void,
): Promise<{
  copilotToken: string;
  githubToken: string;
  githubUser: string;
  expiresAt: number;
  baseUrl: string;
}> {
  const deviceCodeResponse = await requestDeviceCode();
  onDeviceCode(deviceCodeResponse.user_code, deviceCodeResponse.verification_uri);

  const githubAccessToken = await pollForAccessToken(
    deviceCodeResponse.device_code,
    deviceCodeResponse.interval,
    deviceCodeResponse.expires_in,
    onStatusChange,
  );

  const githubUser = await getGitHubUser(githubAccessToken);
  const { token: copilotToken, expiresAt, baseUrl } = await getCopilotToken(githubAccessToken);

  return { copilotToken, githubToken: githubAccessToken, githubUser, expiresAt, baseUrl };
}
