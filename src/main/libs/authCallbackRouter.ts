import { AuthIpcChannel } from '../../shared/auth/constants';
import type { AuthCallbackPayload } from '../../common/auth';

export interface AuthCallbackTarget {
  isDestroyed(): boolean;
  send(channel: string, payload: AuthCallbackPayload): void;
}

interface AuthCallbackRouterOptions {
  getTarget: () => AuthCallbackTarget | null;
  onParseError?: (error: unknown) => void;
}

interface NavigationStartedOptions {
  isMainFrame: boolean;
  isInPlace: boolean;
}

export class AuthCallbackRouter {
  private pendingAuthCallback: AuthCallbackPayload | null = null;
  private listenerReady = false;

  constructor(private readonly options: AuthCallbackRouterOptions) {}

  handleDeepLink(url: string): void {
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== 'auth' || parsed.pathname !== '/callback') return;

      const code = parsed.searchParams.get('code');
      if (!code) return;
      const state = parsed.searchParams.get('state') || undefined;

      this.deliverOrBuffer({ code, ...(state ? { state } : {}) });
    } catch (error) {
      this.options.onParseError?.(error);
    }
  }

  markListenerReadyAndConsumePending(): AuthCallbackPayload | null {
    this.listenerReady = true;
    const callback = this.pendingAuthCallback;
    this.pendingAuthCallback = null;
    return callback;
  }

  markRendererUnavailable(): void {
    this.listenerReady = false;
  }

  handleNavigationStarted({ isMainFrame, isInPlace }: NavigationStartedOptions): void {
    if (isMainFrame && !isInPlace) {
      this.markRendererUnavailable();
    }
  }

  private deliverOrBuffer(payload: AuthCallbackPayload): void {
    if (this.listenerReady) {
      const target = this.options.getTarget();
      if (target && !target.isDestroyed()) {
        target.send(AuthIpcChannel.Callback, payload);
        return;
      }
    }

    this.pendingAuthCallback = payload;
  }
}
