import { describe, expect, test } from 'vitest';

import type { AuthCallbackPayload } from '../../common/auth';
import { AuthIpcChannel } from '../../shared/auth/constants';
import { AuthCallbackRouter, type AuthCallbackTarget } from './authCallbackRouter';

function createTarget(): {
  target: AuthCallbackTarget;
  sent: Array<{ channel: string; payload: AuthCallbackPayload }>;
} {
  const sent: Array<{ channel: string; payload: AuthCallbackPayload }> = [];
  return {
    sent,
    target: {
      isDestroyed: () => false,
      send: (channel, payload) => {
        sent.push({ channel, payload });
      },
    },
  };
}

describe('AuthCallbackRouter', () => {
  test('sends callback immediately when renderer listener is ready', () => {
    const { target, sent } = createTarget();
    const router = new AuthCallbackRouter({ getTarget: () => target });

    expect(router.markListenerReadyAndConsumePending()).toBeNull();
    router.handleDeepLink('lobsterai://auth/callback?code=ready-code');

    expect(sent).toEqual([
      { channel: AuthIpcChannel.Callback, payload: { code: 'ready-code' } },
    ]);
  });

  test('buffers callback until renderer listener becomes ready', () => {
    const { target, sent } = createTarget();
    const router = new AuthCallbackRouter({ getTarget: () => target });

    router.handleDeepLink('lobsterai://auth/callback?code=pending-code');

    expect(sent).toEqual([]);
    expect(router.markListenerReadyAndConsumePending()).toEqual({ code: 'pending-code' });
    expect(router.markListenerReadyAndConsumePending()).toBeNull();
  });

  test('preserves optional callback state', () => {
    const { target, sent } = createTarget();
    const router = new AuthCallbackRouter({ getTarget: () => target });

    router.markListenerReadyAndConsumePending();
    router.handleDeepLink('lobsterai://auth/callback?code=ready-code&state=csrf-state');

    expect(sent).toEqual([
      {
        channel: AuthIpcChannel.Callback,
        payload: { code: 'ready-code', state: 'csrf-state' },
      },
    ]);
  });

  test('keeps renderer listener ready for child frame artifact loads', () => {
    const { target, sent } = createTarget();
    const router = new AuthCallbackRouter({ getTarget: () => target });

    router.markListenerReadyAndConsumePending();
    router.handleNavigationStarted({ isMainFrame: false, isInPlace: false });
    router.handleDeepLink('lobsterai://auth/callback?code=iframe-code');

    expect(sent).toEqual([
      { channel: AuthIpcChannel.Callback, payload: { code: 'iframe-code' } },
    ]);
  });

  test('marks renderer unavailable for main frame document navigation', () => {
    const { target, sent } = createTarget();
    const router = new AuthCallbackRouter({ getTarget: () => target });

    router.markListenerReadyAndConsumePending();
    router.handleNavigationStarted({ isMainFrame: true, isInPlace: false });
    router.handleDeepLink('lobsterai://auth/callback?code=reload-code');

    expect(sent).toEqual([]);
    expect(router.markListenerReadyAndConsumePending()).toEqual({ code: 'reload-code' });
  });
});
