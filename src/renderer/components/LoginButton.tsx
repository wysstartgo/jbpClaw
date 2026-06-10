import { QRCodeSVG } from 'qrcode.react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import {
  AuthBackend,
  type AuthBackend as AuthBackendType,
  AuthLoginMode,
  type AuthLoginMode as AuthLoginModeType,
  type FeishuScanSession,
  FeishuScanSessionStatus,
} from '../../common/auth';
import { AppCustomEvent } from '../constants/app';
import { authService } from '../services/auth';
import { i18nService } from '../services/i18n';
import { RootState } from '../store';
import type { CreditItem } from '../store/slices/authSlice';
import QingShuBrandMark from './branding/QingShuBrandMark';

const FEISHU_LOGIN_WAIT_SECONDS = 60;
const FEISHU_LOGIN_POLL_INTERVAL_MS = 1500;
const FEISHU_SCAN_RETRY_BASE_DELAY_MS = 5000;
const FEISHU_SCAN_RETRY_MAX_DELAY_MS = 30000;

const getFeishuScanRetryDelay = (attempt: number): number => {
  const safeAttempt = Math.max(1, attempt);
  return Math.min(
    FEISHU_SCAN_RETRY_BASE_DELAY_MS * 2 ** (safeAttempt - 1),
    FEISHU_SCAN_RETRY_MAX_DELAY_MS
  );
};

const getFeishuCountdown = (expiredAt?: number): number => {
  if (!expiredAt) {
    return FEISHU_LOGIN_WAIT_SECONDS;
  }
  return Math.max(0, Math.ceil((expiredAt - Date.now()) / 1000));
};

const isReusableFeishuScanSession = (session?: FeishuScanSession | null): session is FeishuScanSession => {
  if (!session?.scanSessionId) {
    return false;
  }

  if (!session.qrCodeContent && !session.authorizeUrl) {
    return false;
  }

  if (!session.expiredAt) {
    return true;
  }

  return session.expiredAt - Date.now() > 3000;
};

const getSubscriptionBadge = (label: string) => {
  // Determine badge style based on label
  const isStandard = /标准|Standard/i.test(label);
  const isAdvanced = /进阶|Advanced/i.test(label);
  const isPro = /专业|Pro/i.test(label);

  if (isPro) {
    return {
      bg: 'bg-gradient-to-r from-amber-500 to-yellow-400',
      text: 'text-white',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
          <path d="M2 4l3 12h14l3-12-5 4-5-6-5 6z" /><path d="M5 16l-1.5 4h17L19 16" />
        </svg>
      ),
    };
  }
  if (isAdvanced) {
    return {
      bg: 'bg-gradient-to-r from-purple-500 to-violet-400',
      text: 'text-white',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      ),
    };
  }
  if (isStandard) {
    return {
      bg: 'bg-gradient-to-r from-blue-500 to-cyan-400',
      text: 'text-white',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ),
    };
  }

  return null;
};

const formatDate = (dateStr: string | null): string => {
  if (!dateStr) return '';
  // Format "2026-03-29" to "26.03.29"
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[0].slice(2)}.${parts[1]}.${parts[2]}`;
};

const formatCredits = (n: number): string => {
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(2);
};

const CreditItemRow: React.FC<{ item: CreditItem; isEn: boolean }> = ({ item, isEn }) => {
  const label = isEn ? item.labelEn : item.label;
  const badge = item.type === 'subscription' ? getSubscriptionBadge(label) : null;
  const expiresText = item.expiresAt
    ? `${i18nService.t('authExpiresAt')}${formatDate(item.expiresAt)}`
    : '';

  return (
    <div className="flex flex-col gap-0.5 py-1.5 first:pt-0 last:pb-0">
      <div className="flex items-center gap-1.5">
        {badge ? (
          <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.bg} ${badge.text}`}>
            {badge.icon}
            {label}
          </span>
        ) : (
          <span className="text-xs text-secondary">
            {label}
          </span>
        )}
        <span className="text-xs font-medium text-foreground">
          {formatCredits(item.creditsRemaining)}{i18nService.t('authCreditsUnit')}
        </span>
      </div>
      {expiresText && (
        <span className="text-[10px] text-secondary pl-0.5">
          {expiresText}
        </span>
      )}
    </div>
  );
};

const showToast = (message: string) => {
  window.dispatchEvent(new CustomEvent(AppCustomEvent.ShowToast, { detail: message }));
};

const showLoginWelcome = () => {
  window.dispatchEvent(new CustomEvent(AppCustomEvent.ShowLoginWelcome));
};

const AVATAR_TONES = [
  'from-amber-500 to-orange-500',
  'from-cyan-500 to-sky-500',
  'from-zinc-900 to-red-700',
  'from-fuchsia-500 to-pink-500',
  'from-indigo-500 to-blue-500',
  'from-rose-500 to-red-500',
] as const;

const getAvatarText = (value?: string | null): string => {
  const normalized = (value || '').trim();
  if (!normalized) {
    return '?';
  }

  const compact = normalized.replace(/\s+/g, '');
  return compact.slice(0, Math.min(2, compact.length)).toUpperCase();
};

const getAvatarTone = (seed: string): string => {
  if (!seed) {
    return AVATAR_TONES[0];
  }

  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_TONES[hash % AVATAR_TONES.length];
};

const normalizeIdentityText = (value?: string | null): string => {
  const normalized = (value || '').trim();
  if (!normalized || /^(null|undefined)$/i.test(normalized)) {
    return '';
  }
  return normalized;
};

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

type LoginButtonVariant = 'default' | 'sidebar';

const hasLocalOnlyScanCallback = (authorizeUrl?: string | null): boolean => {
  const normalizedAuthorizeUrl = (authorizeUrl || '').trim();
  if (!normalizedAuthorizeUrl) {
    return false;
  }

  try {
    const authorizeUri = new URL(normalizedAuthorizeUrl);
    const redirectUri = authorizeUri.searchParams.get('redirect_uri');
    if (!redirectUri) {
      return false;
    }

    const callbackUri = new URL(redirectUri);
    return LOOPBACK_HOSTS.has(callbackUri.hostname.toLowerCase());
  } catch {
    return false;
  }
};

const UserAvatar: React.FC<{
  avatarUrl?: string | null;
  displayName?: string | null;
  className?: string;
}> = ({ avatarUrl, displayName, className = 'h-4 w-4' }) => {
  if (avatarUrl) {
    return <img src={avatarUrl} alt="" className={`${className} rounded-full object-cover`} />;
  }

  const initials = getAvatarText(displayName);
  const tone = getAvatarTone(displayName || initials);
  return (
    <span
      className={`${className} inline-flex items-center justify-center rounded-full bg-gradient-to-br ${tone} text-[9px] font-semibold uppercase tracking-[0.08em] text-white shadow-sm`}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
};

const LobsterWaitingIndicator: React.FC = () => (
  <div className="qs-lobster-waiting-shell" aria-hidden="true">
    <div className="qs-lobster-grid" />
    <div className="qs-lobster-scan-ring">
      <div className="qs-lobster-scan-sweep" />
    </div>
    <div className="qs-lobster-ripple qs-lobster-ripple-1" />
    <div className="qs-lobster-ripple qs-lobster-ripple-2" />
    <div className="qs-lobster-ripple qs-lobster-ripple-3" />
    <div className="qs-lobster-trace qs-lobster-trace-a">
      <span className="qs-lobster-trace-tail" />
      <span className="qs-lobster-trace-head" />
    </div>
    <div className="qs-lobster-trace qs-lobster-trace-b">
      <span className="qs-lobster-trace-tail" />
      <span className="qs-lobster-trace-head" />
    </div>
    <div className="qs-lobster-core">
      <svg viewBox="0 0 96 96" className="qs-lobster-mark" fill="none">
        <path
          d="M48 20c4.9 0 8.8 3.9 8.8 8.8v10.4c5.8 2.2 9.9 7.8 9.9 14.4 0 5.6-2.9 10.6-7.3 13.5l4.5 10.9c0.9 2.1-0.1 4.5-2.2 5.4-2.1 0.9-4.5-0.1-5.4-2.2l-3.8-9.4h-8.9l-3.8 9.4c-0.9 2.1-3.3 3.1-5.4 2.2-2.1-0.9-3.1-3.3-2.2-5.4L36.6 67c-4.4-2.9-7.3-7.9-7.3-13.5 0-6.6 4.1-12.2 9.9-14.4V28.8c0-4.9 3.9-8.8 8.8-8.8Z"
          fill="currentColor"
          opacity="0.94"
        />
        <path
          d="M34.7 46.6 22.8 40c-3-1.7-6.7-0.6-8.4 2.4-1.7 3-0.6 6.7 2.4 8.4l10.8 6.1m33.7-10.3L73.2 40c3-1.7 6.7-0.6 8.4 2.4 1.7 3 0.6 6.7-2.4 8.4l-10.8 6.1"
          stroke="currentColor"
          strokeWidth="5.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M37 22 30 13m29 9 7-9M41.5 14.5 36 7m18.5 7.5L60 7"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <circle cx="41" cy="47.5" r="2.8" fill="#F8FAFC" />
        <circle cx="55" cy="47.5" r="2.8" fill="#F8FAFC" />
        <path
          d="M43.5 58.5c2.2 1.8 6.8 1.8 9 0"
          stroke="#F8FAFC"
          strokeWidth="3.2"
          strokeLinecap="round"
        />
      </svg>
    </div>
  </div>
);

const FeishuSdkQrPanel: React.FC<{
  authorizeUrl?: string | null;
  qrCodeContent?: string | null;
}> = ({ authorizeUrl, qrCodeContent }) => {
  const qrValue = (qrCodeContent || authorizeUrl || '').trim();
  const loadState: 'loading' | 'ready' | 'error' = qrValue
    ? 'ready'
    : authorizeUrl || qrCodeContent
      ? 'error'
      : 'loading';

  return (
    <div className="relative overflow-hidden rounded-[18px] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)] ring-1 ring-slate-900/5">
      {loadState === 'ready' && (
        <div className="flex h-[206px] w-[206px] items-center justify-center bg-white p-3">
          <QRCodeSVG
            value={qrValue}
            size={182}
            marginSize={1}
            bgColor="#FFFFFF"
            fgColor="#111827"
            level="M"
          />
        </div>
      )}
      {loadState !== 'ready' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/92 backdrop-blur-[1px]">
          <div className="scale-[0.72]">
            <LobsterWaitingIndicator />
          </div>
          <div className="mt-1 px-5 text-[11px] leading-5 text-claude-textSecondary">
            {loadState === 'error'
              ? i18nService.t('authFeishuScanQrUnavailable')
              : i18nService.t('authFeishuScanLoading')}
          </div>
        </div>
      )}
    </div>
  );
};

const QtbLoginPanel: React.FC<{
  onClose: () => void;
  authBackend: AuthBackendType;
  initialScanSession?: FeishuScanSession | null;
  initialScanLoading?: boolean;
  panelClassName?: string;
}> = ({ onClose, authBackend, initialScanSession = null, initialScanLoading = false, panelClassName }) => {
  const isLoggedIn = useSelector((state: RootState) => state.auth.isLoggedIn);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(
    initialScanLoading ? i18nService.t('authFeishuScanLoading') : ''
  );
  const [loginMode, setLoginMode] = useState<AuthLoginModeType>(AuthLoginMode.Scan);
  const [feishuCountdown, setFeishuCountdown] = useState(FEISHU_LOGIN_WAIT_SECONDS);
  const [feishuScanSession, setFeishuScanSession] = useState<FeishuScanSession | null>(
    initialScanSession
  );
  const [isCreatingFeishuSession, setIsCreatingFeishuSession] = useState(false);
  const [submittingMode, setSubmittingMode] = useState<'password' | 'browser' | null>(null);
  const [autoRetryAttempt, setAutoRetryAttempt] = useState(0);
  const [autoRetryAt, setAutoRetryAt] = useState<number | null>(null);
  const [autoRetryCountdown, setAutoRetryCountdown] = useState(0);
  const autoScanRequestedRef = useRef(false);
  const inputsDisabled = submittingMode === 'password';
  const localOnlyScanCallback = hasLocalOnlyScanCallback(feishuScanSession?.authorizeUrl);

  const resetAutoRetryState = useCallback(() => {
    setAutoRetryAttempt(0);
    setAutoRetryAt(null);
    setAutoRetryCountdown(0);
  }, []);

  const scheduleAutoRetry = useCallback((): number => {
    const nextAttempt = autoRetryAttempt + 1;
    const delayMs = getFeishuScanRetryDelay(nextAttempt);
    setAutoRetryAttempt(nextAttempt);
    setAutoRetryAt(Date.now() + delayMs);
    setAutoRetryCountdown(Math.ceil(delayMs / 1000));
    return delayMs;
  }, [autoRetryAttempt]);

  const completeFeishuLogin = useCallback(() => {
    autoScanRequestedRef.current = false;
    resetAutoRetryState();
    setFeishuScanSession(null);
    setNotice('');
    setFeishuCountdown(FEISHU_LOGIN_WAIT_SECONDS);
    showLoginWelcome();
    showToast(i18nService.t('authLoginSuccess'));
    onClose();
  }, [onClose, resetAutoRetryState]);

  useEffect(() => {
    if (!isLoggedIn) {
      return;
    }

    completeFeishuLogin();
  }, [completeFeishuLogin, isLoggedIn]);

  useEffect(() => {
    if (loginMode !== AuthLoginMode.Scan) {
      return;
    }

    if (initialScanLoading && !feishuScanSession) {
      setNotice(i18nService.t('authFeishuScanLoading'));
    }
  }, [initialScanLoading, feishuScanSession, loginMode]);

  useEffect(() => {
    if (
      loginMode !== AuthLoginMode.Scan
      || feishuScanSession
      || !isReusableFeishuScanSession(initialScanSession)
    ) {
      return;
    }

    setFeishuScanSession(initialScanSession);
    setNotice(i18nService.t('authFeishuScanReadyTip'));
  }, [initialScanSession, feishuScanSession, loginMode]);

  useEffect(() => {
    if (autoRetryAt === null) {
      setAutoRetryCountdown(0);
      return;
    }

    const syncCountdown = () => {
      const seconds = Math.max(0, Math.ceil((autoRetryAt - Date.now()) / 1000));
      setAutoRetryCountdown(seconds);
      if (seconds <= 0) {
        setAutoRetryAt(null);
      }
    };

    syncCountdown();
    const timer = window.setInterval(syncCountdown, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [autoRetryAt]);

  useEffect(() => {
    if (authBackend !== AuthBackend.Qtb || loginMode !== AuthLoginMode.Scan) {
      autoScanRequestedRef.current = false;
      return;
    }

    if (
      initialScanLoading
      || isReusableFeishuScanSession(initialScanSession)
      || isCreatingFeishuSession
      || feishuScanSession
      || (autoRetryAt !== null && autoRetryAt > Date.now())
      || autoScanRequestedRef.current
    ) {
      return;
    }

    let disposed = false;
    autoScanRequestedRef.current = true;

    const createDefaultScanSession = async () => {
      setError('');
      setNotice(i18nService.t('authFeishuScanLoading'));
      try {
        const session = await createFeishuScanSession();
        if (!disposed && session) {
          resetAutoRetryState();
          setFeishuScanSession(session);
          setNotice(i18nService.t('authFeishuScanReadyTip'));
          return;
        }

        autoScanRequestedRef.current = false;
      } catch (loginError) {
        if (disposed) {
          return;
        }
        autoScanRequestedRef.current = false;
        const retryDelayMs = scheduleAutoRetry();
        setError(
          loginError instanceof Error
            ? loginError.message
            : i18nService.t('authLoginFailed')
        );
        setNotice(
          i18nService.t('authFeishuScanRetryScheduled').replace(
            '{seconds}',
            String(Math.ceil(retryDelayMs / 1000))
          )
        );
      }
    };

    void createDefaultScanSession();

    return () => {
      disposed = true;
    };
  }, [
    authBackend,
    initialScanLoading,
    initialScanSession,
    loginMode,
    isCreatingFeishuSession,
    feishuScanSession,
    autoRetryAt,
    resetAutoRetryState,
    scheduleAutoRetry,
  ]);

  useEffect(() => {
    if (
      loginMode !== AuthLoginMode.Scan
      || feishuScanSession
      || isCreatingFeishuSession
      || autoRetryAt === null
    ) {
      return;
    }

    if (autoRetryCountdown > 0) {
      setNotice(
        i18nService.t('authFeishuScanRetryScheduled').replace(
          '{seconds}',
          String(autoRetryCountdown)
        )
      );
      return;
    }

    setNotice(i18nService.t('authFeishuScanLoading'));
  }, [autoRetryAt, autoRetryCountdown, feishuScanSession, isCreatingFeishuSession, loginMode]);

  useEffect(() => {
    if (!feishuScanSession?.expiredAt) {
      setFeishuCountdown(FEISHU_LOGIN_WAIT_SECONDS);
      return;
    }

    const syncCountdown = () => {
      setFeishuCountdown(getFeishuCountdown(feishuScanSession.expiredAt));
    };

    syncCountdown();
    const timer = window.setInterval(syncCountdown, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [feishuScanSession?.expiredAt]);

  useEffect(() => {
    if (!feishuScanSession?.scanSessionId || isLoggedIn) {
      return;
    }

    let disposed = false;
    let timer: number | null = null;

    const pollLoginState = async () => {
      try {
        const session = await authService.pollFeishuScanSession(feishuScanSession.scanSessionId);
        if (disposed) {
          return;
        }

        setFeishuScanSession(session);

        if (session.authenticated) {
          completeFeishuLogin();
          return;
        }

        if (session.status === FeishuScanSessionStatus.Scanned) {
          setNotice(i18nService.t('authFeishuLoginScannedTip'));
        } else if (session.status === FeishuScanSessionStatus.Bound) {
          setNotice(i18nService.t('authFeishuLoginBindingTip'));
        } else if (session.status === FeishuScanSessionStatus.Pending) {
          setNotice(i18nService.t('authFeishuScanReadyTip'));
        } else if (session.status === FeishuScanSessionStatus.Failed) {
          setError(session.errorMessage || i18nService.t('authLoginFailed'));
          return;
        } else if (session.status === FeishuScanSessionStatus.Expired) {
          if (authBackend === AuthBackend.Qtb && loginMode === AuthLoginMode.Scan) {
            autoScanRequestedRef.current = false;
            setNotice(i18nService.t('authFeishuScanExpiredRefreshing'));
            setFeishuScanSession(null);
          } else {
            setNotice(i18nService.t('authFeishuLoginTimeout'));
          }
          return;
        }
      } catch (pollError) {
        if (disposed) {
          return;
        }
        setError(
          pollError instanceof Error
            ? pollError.message
            : i18nService.t('authLoginFailed')
        );
        return;
      }

      timer = window.setTimeout(() => {
        void pollLoginState();
      }, FEISHU_LOGIN_POLL_INTERVAL_MS);
    };

    void pollLoginState();

    return () => {
      disposed = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [authBackend, completeFeishuLogin, feishuScanSession?.scanSessionId, isLoggedIn, loginMode]);

  const createFeishuScanSession = async (forceRefresh = false) => {
    setIsCreatingFeishuSession(true);
    setError('');
    try {
      const session = await authService.createFeishuScanSession(forceRefresh);
      return session;
    } catch (sessionError) {
      setError(
        sessionError instanceof Error
          ? sessionError.message
          : i18nService.t('authLoginFailed')
      );
      return null;
    } finally {
      setIsCreatingFeishuSession(false);
    }
  };

  const handlePasswordLogin = async () => {
    const normalizedUsername = username.trim();
    if (!normalizedUsername || !password) {
      setError(i18nService.t('authEnterUsernameAndPassword'));
      return;
    }

    setSubmittingMode('password');
    setError('');
    setNotice('');
    try {
      await authService.loginWithPassword(normalizedUsername, password);
      showLoginWelcome();
      showToast(i18nService.t('authLoginSuccess'));
      onClose();
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : i18nService.t('authLoginFailed')
      );
    } finally {
      setSubmittingMode(null);
    }
  };

  const handleBrowserFeishuLogin = async () => {
    setSubmittingMode('browser');
    setError('');
    setNotice('');
    try {
      const session = await createFeishuScanSession(true);
      if (!session?.authorizeUrl) {
        throw new Error(i18nService.t('authFeishuScanQrUnavailable'));
      }

      autoScanRequestedRef.current = true;
      setLoginMode(AuthLoginMode.Scan);
      setFeishuScanSession(session);
      setNotice(i18nService.t('authFeishuLoginPendingTip'));
      await window.electron.shell.openExternal(session.authorizeUrl);
      showToast(i18nService.t('authOpenFeishuLogin'));
    } catch (loginError) {
      autoScanRequestedRef.current = false;
      setError(
        loginError instanceof Error
          ? loginError.message
          : i18nService.t('authLoginFailed')
      );
    } finally {
      setSubmittingMode(null);
    }
  };

  const handleRefreshFeishuScan = async () => {
    autoScanRequestedRef.current = false;
    resetAutoRetryState();
    setError('');
    setNotice(i18nService.t('authFeishuScanLoading'));
    const session = await createFeishuScanSession(true);
    if (session) {
      setFeishuScanSession(session);
      setNotice(i18nService.t('authFeishuScanReadyTip'));
    }
  };

  const switchLoginMode = (nextMode: AuthLoginModeType) => {
    if (nextMode === loginMode) {
      return;
    }
    setLoginMode(nextMode);
    setError('');
    setNotice('');
    autoScanRequestedRef.current = false;
    resetAutoRetryState();
    if (nextMode === AuthLoginMode.Scan) {
      setFeishuScanSession(null);
    }
  };

  return (
    <div className={`jbp-visual-panel absolute z-[70] rounded-2xl p-4 popover-enter ${panelClassName ?? 'bottom-full left-0 mb-2'} ${loginMode === AuthLoginMode.Scan ? 'w-[19rem]' : 'w-[16.5rem]'}`}>
      <div className="jbp-visual-status-pill mb-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium tracking-[0.02em]">
        聚宝盆
      </div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-foreground">
          {i18nService.t('authLoginPanelTitle')}
        </div>
        <button
          type="button"
          onClick={() => switchLoginMode(loginMode === AuthLoginMode.Scan ? AuthLoginMode.Manual : AuthLoginMode.Scan)}
          className="rounded-full px-2 py-1 text-[10px] font-medium text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
        >
          {loginMode === AuthLoginMode.Scan
            ? i18nService.t('authLoginModeManual')
            : i18nService.t('authLoginModeScan')}
        </button>
      </div>

      {loginMode === AuthLoginMode.Scan ? (
        <div className="space-y-2.5">
          <div className="rounded-2xl border border-border-subtle bg-surface-raised/55 px-4 pb-4 pt-4 shadow-subtle">
            <div className="flex flex-col items-center text-center">
              <FeishuSdkQrPanel
                authorizeUrl={feishuScanSession?.authorizeUrl}
                qrCodeContent={feishuScanSession?.qrCodeContent}
              />
              <div className="mt-3 text-[11px] leading-5 text-secondary">
                {notice || i18nService.t('authFeishuScanPanelHint')}
              </div>
              <div className="jbp-visual-status-pill mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                {i18nService.t('authFeishuLoginCountdown').replace('{seconds}', String(feishuCountdown))}
              </div>
            </div>

            <div className="mt-3 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => void handleRefreshFeishuScan()}
                disabled={isCreatingFeishuSession || submittingMode !== null}
                className="rounded-full px-1.5 py-0.5 text-[10px] font-medium text-primary transition-colors hover:bg-primary-muted disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isCreatingFeishuSession
                  ? i18nService.t('authFeishuScanLoading')
                  : i18nService.t('authFeishuScanRefresh')}
              </button>
              <button
                type="button"
                onClick={() => switchLoginMode(AuthLoginMode.Manual)}
                className="rounded-full px-1.5 py-0.5 text-[10px] font-medium text-secondary transition-colors hover:bg-surface hover:text-foreground"
              >
                {i18nService.t('authLoginModeManual')}
              </button>
            </div>
          </div>

          {error && (
            <div className="jbp-visual-danger-note rounded-xl px-3 py-2 text-xs">
              {error}
            </div>
          )}

          {localOnlyScanCallback && (
            <div className="jbp-visual-warning-note rounded-xl px-3 py-2 text-[11px] leading-5">
              {i18nService.t('authFeishuScanLocalCallbackHint')}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <label className="block">
            <div className="mb-1 text-xs text-secondary">
              {i18nService.t('authUsername')}
            </div>
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={inputsDisabled}
              placeholder={i18nService.t('authUsernamePlaceholder')}
              className="jbp-visual-soft-field w-full rounded-xl px-3 py-2 text-sm outline-none transition-[border-color,box-shadow,background-color] disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>

          <label className="block">
            <div className="mb-1 text-xs text-secondary">
              {i18nService.t('password')}
            </div>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={inputsDisabled}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !inputsDisabled) {
                  void handlePasswordLogin();
                }
              }}
              placeholder={i18nService.t('authPasswordPlaceholder')}
              className="jbp-visual-soft-field w-full rounded-xl px-3 py-2 text-sm outline-none transition-[border-color,box-shadow,background-color] disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>

          {error && (
            <div className="jbp-visual-danger-note rounded-xl px-3 py-2 text-xs">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={() => void handlePasswordLogin()}
            disabled={inputsDisabled}
            className="jbp-visual-primary-action mt-1 w-full rounded-xl px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submittingMode === 'password'
              ? i18nService.t('authLoggingIn')
              : i18nService.t('authPasswordLogin')}
          </button>

          <button
            type="button"
            onClick={() => void handleBrowserFeishuLogin()}
            disabled={submittingMode === 'browser' || isCreatingFeishuSession}
            className="jbp-visual-secondary-action flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          >
            <svg viewBox="0 0 1024 1024" width="16" height="16" aria-hidden="true">
              <path
                d="M512 0C229.2 0 0 229.2 0 512s229.2 512 512 512 512-229.2 512-512S794.8 0 512 0z"
                fill="#3370FF"
              />
              <path
                d="M706.4 324.8L512 276.8l-194.4 48c-12.8 3.2-20.8 16-17.6 28.8l48 194.4c3.2 12.8 16 20.8 28.8 17.6l194.4-48 194.4 48c12.8 3.2 25.6-4.8 28.8-17.6l48-194.4c3.2-12.8-4.8-25.6-17.6-28.8z"
                fill="#fff"
              />
              <path
                d="M512 512L317.6 560c-12.8 3.2-20.8 16-17.6 28.8l48 194.4c3.2 12.8 16 20.8 28.8 17.6L512 752l135.2 48.8c12.8 3.2 25.6-4.8 28.8-17.6l48-194.4c3.2-12.8-4.8-25.6-17.6-28.8L512 512z"
                fill="#fff"
                opacity="0.6"
              />
            </svg>
            <span>
              {submittingMode === 'browser'
                ? i18nService.t('authOpenFeishuLogin')
                : i18nService.t('authFeishuScanOpenBrowser')}
            </span>
          </button>
        </div>
      )}
    </div>
  );
};

const UserMenu: React.FC<{
  onClose: () => void;
  authBackend: AuthBackendType;
  panelClassName?: string;
}> = ({ onClose, authBackend, panelClassName }) => {
  const user = useSelector((state: RootState) => state.auth.user);
  const profileSummary = useSelector((state: RootState) => state.auth.profileSummary);
  const [creditsExpanded, setCreditsExpanded] = useState(false);
  const isEn = i18nService.getLanguage() === 'en';
  const isLegacyBackend = authBackend === AuthBackend.LegacyLobster;
  const showCreditsSection = profileSummary !== null;

  useEffect(() => {
    authService.fetchProfileSummary();
  }, []);

  const handleLogout = async () => {
    await authService.logout();
    onClose();
  };

  const handleSubscribe = async () => {
    const { getPortalPricingUrl } = await import('../services/endpoints');
    await window.electron.shell.openExternal(getPortalPricingUrl());
  };

  const handleLearnMore = async () => {
    const { getPortalProfileUrl } = await import('../services/endpoints');
    await window.electron.shell.openExternal(getPortalProfileUrl());
  };

  const handleOpenQtbWeb = async () => {
    try {
      await authService.openQtbWebPortal('/');
      onClose();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : i18nService.t('authOpenQtbWebFailed')
      );
    }
  };

  const phoneSuffix = user?.phone ? user.phone.slice(-4) : '';
  const primaryIdentity = normalizeIdentityText(
    user?.nickname || user?.displayName || user?.name || user?.email
  );
  const secondaryCandidates = [
    normalizeIdentityText(user?.email),
    normalizeIdentityText(user?.name),
    normalizeIdentityText(user?.displayName),
  ];
  const secondaryIdentity = secondaryCandidates.find((value) => value && value !== primaryIdentity)
    || (phoneSuffix ? `****${phoneSuffix}` : '');

  const totalCredits = profileSummary?.totalCreditsRemaining ?? 0;
  const creditItems = profileSummary?.creditItems ?? [];
  const hasCredits = creditItems.length > 0;

  return (
    <div className={`absolute w-[14.5rem] overflow-hidden rounded-xl border border-claude-border bg-claude-surface shadow-popover z-[70] popover-enter dark:border-claude-darkBorder dark:bg-claude-darkSurface ${panelClassName ?? 'bottom-full left-[-0.5rem] mb-1'}`}>
      {/* Account info */}
      {authBackend === AuthBackend.Qtb ? (
        <button
          type="button"
          onClick={() => void handleOpenQtbWeb()}
          className="w-full px-4 py-3 border-b dark:border-claude-darkBorder border-claude-border text-left hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-medium dark:text-claude-darkText text-claude-text truncate">
                {primaryIdentity || phoneSuffix}
              </div>
              {secondaryIdentity && (
                <div className="text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary mt-0.5 truncate">
                  {secondaryIdentity}
                </div>
              )}
            </div>
            <div className="shrink-0 text-[11px] text-primary">
              {i18nService.t('authOpenQtbWeb')}
            </div>
          </div>
        </button>
      ) : (
        <div className="px-4 py-3 border-b dark:border-claude-darkBorder border-claude-border">
          <div className="text-sm font-medium dark:text-claude-darkText text-claude-text truncate">
            {primaryIdentity || phoneSuffix}
          </div>
          {secondaryIdentity && (
            <div className="text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary mt-0.5">
              {secondaryIdentity}
            </div>
          )}
        </div>
      )}

      {showCreditsSection && (
        <div className="border-b dark:border-claude-darkBorder border-claude-border">
          <button
            type="button"
            onClick={() => setCreditsExpanded(!creditsExpanded)}
            className="w-full px-4 py-2.5 flex items-center justify-between cursor-pointer hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover transition-colors"
          >
            <span className="text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary">
              {i18nService.t('authCreditsRemaining')}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium dark:text-claude-darkText text-claude-text">
                {formatCredits(totalCredits)}{i18nService.t('authCreditsUnit')}
              </span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`dark:text-claude-darkTextSecondary text-claude-textSecondary transition-transform duration-200 ${creditsExpanded ? 'rotate-180' : ''}`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </button>

          {creditsExpanded && (
            <div className="px-4 pb-3">
              {hasCredits ? (
                <div className="divide-y dark:divide-claude-darkBorder divide-claude-border">
                  {creditItems.map((item, idx) => (
                    <CreditItemRow key={idx} item={item} isEn={isEn} />
                  ))}
                </div>
              ) : (
                <div className="text-xs dark:text-claude-darkTextSecondary text-claude-textSecondary py-1">
                  {i18nService.t('authZeroCredits')}
                </div>
              )}
              {isLegacyBackend && (
                <button
                  type="button"
                  onClick={handleLearnMore}
                  className="mt-2 text-xs text-claude-accent hover:underline cursor-pointer"
                >
                  {i18nService.t('authLearnMore')}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="py-1">
        {isLegacyBackend && (
          <button
            type="button"
            onClick={handleSubscribe}
            className="w-full px-4 py-2 text-left text-sm dark:text-claude-darkText text-claude-text dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover transition-colors cursor-pointer"
          >
            {i18nService.t('authValueAddedServices')}
          </button>
        )}
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full cursor-pointer items-center gap-2 px-4 py-2 text-left text-sm text-[color:var(--lobster-destructive)] transition-colors hover:bg-surface-raised"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          {i18nService.t('authLogout')}
        </button>
      </div>
    </div>
  );
};

interface LoginButtonProps {
  variant?: LoginButtonVariant;
}

const LoginButton: React.FC<LoginButtonProps> = ({ variant = 'default' }) => {
  const { isLoggedIn, isLoading, user } = useSelector((state: RootState) => state.auth);
  const [showMenu, setShowMenu] = useState(false);
  const [authBackend, setAuthBackend] = useState<AuthBackendType>(AuthBackend.LegacyLobster);
  const [prefetchedScanSession, setPrefetchedScanSession] = useState<FeishuScanSession | null>(null);
  const [isPrefetchingScanSession, setIsPrefetchingScanSession] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showMenu]);

  useEffect(() => {
    let mounted = true;

    authService.getBackend().then((backend) => {
      if (mounted) {
        setAuthBackend(backend);
      }
    }).catch(() => {
      if (mounted) {
        setAuthBackend(AuthBackend.LegacyLobster);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  if (isLoading) {
    return null;
  }

  const isSidebarVariant = variant === 'sidebar';
  const panelClassName = isSidebarVariant
    ? 'left-full top-0 ml-3'
    : undefined;

  const handleClick = async () => {
    if (isLoggedIn) {
      setShowMenu(!showMenu);
    } else if (authBackend === AuthBackend.Qtb) {
      const nextShowMenu = !showMenu;
      setShowMenu(nextShowMenu);

      if (nextShowMenu) {
        setPrefetchedScanSession(null);
        setIsPrefetchingScanSession(true);
        authService.createFeishuScanSession()
          .then((session) => {
            setPrefetchedScanSession(session);
          })
          .catch(() => {
            setPrefetchedScanSession(null);
          })
          .finally(() => {
            setIsPrefetchingScanSession(false);
          });
      }
    } else {
      await authService.login();
    }
  };

  const phoneSuffix = user?.phone ? user.phone.slice(-4) : '';
  const primaryIdentity = normalizeIdentityText(
    user?.nickname || user?.displayName || user?.name || user?.email
  );

  return (
    <div ref={containerRef} className={`relative ${isSidebarVariant ? 'w-full' : ''}`}>
      <button
        type="button"
        onClick={handleClick}
        className={
          isSidebarVariant
            ? 'flex w-full flex-col items-center gap-2 rounded-2xl px-2 py-2 text-center text-secondary transition-colors hover:bg-surface-raised hover:text-foreground cursor-pointer'
            : 'inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-secondary hover:text-foreground hover:bg-surface-raised transition-colors cursor-pointer'
        }
      >
        {isLoggedIn ? (
          <>
            {isSidebarVariant ? (
              <span className="relative">
                <UserAvatar
                  avatarUrl={user?.avatarUrl}
                  displayName={primaryIdentity}
                  className="h-11 w-11 ring-1 ring-primary/12"
                />
                <span className="absolute -bottom-1 -right-1">
                  <QingShuBrandMark
                    className="relative flex h-4.5 w-4.5 items-center justify-center overflow-hidden rounded-full bg-primary shadow-sm ring-2 ring-background"
                    iconClassName="text-[9px] font-semibold leading-none text-primary-foreground"
                  />
                </span>
              </span>
            ) : (
              <UserAvatar
                avatarUrl={user?.avatarUrl}
                displayName={primaryIdentity}
                className="h-4 w-4"
              />
            )}
            <span className={isSidebarVariant ? 'max-w-full truncate text-sm font-medium text-foreground' : 'truncate max-w-[80px]'}>
              {primaryIdentity || `****${phoneSuffix}`}
            </span>
          </>
        ) : (
          <>
            {isSidebarVariant ? (
              <span className="jbp-visual-icon-tile relative flex h-11 w-11 items-center justify-center rounded-2xl shadow-subtle">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]"><circle cx="12" cy="8" r="5" /><path d="M20 21a8 8 0 0 0-16 0" /></svg>
                <span className="absolute -bottom-1 -right-1">
                  <QingShuBrandMark
                    className="relative flex h-4.5 w-4.5 items-center justify-center overflow-hidden rounded-full bg-primary shadow-sm ring-2 ring-background"
                    iconClassName="text-[9px] font-semibold leading-none text-primary-foreground"
                  />
                </span>
              </span>
            ) : (
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/12 text-primary shadow-subtle">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]"><circle cx="12" cy="8" r="5" /><path d="M20 21a8 8 0 0 0-16 0" /></svg>
              </span>
            )}
            <span className={isSidebarVariant ? 'text-sm font-medium text-foreground' : ''}>
              {i18nService.t('login')}
            </span>
          </>
        )}
      </button>
      {showMenu && isLoggedIn && (
        <UserMenu authBackend={authBackend} onClose={() => setShowMenu(false)} panelClassName={panelClassName} />
      )}
      {showMenu && !isLoggedIn && authBackend === AuthBackend.Qtb && (
        <QtbLoginPanel
          authBackend={authBackend}
          initialScanSession={prefetchedScanSession}
          initialScanLoading={isPrefetchingScanSession}
          onClose={() => setShowMenu(false)}
          panelClassName={panelClassName}
        />
      )}
    </div>
  );
};

export default LoginButton;
