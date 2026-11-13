import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IDENTITY_BOOTSTRAP_UPDATED_EVENT,
  IDENTITY_SESSION_CHANGED_EVENT,
  setIdentitySessionPrincipal,
} from '../identity/api/authApi.js';
import { getCompanyIdentity, type CompanyIdentity } from './api/companyApi.js';

/** Focus / visibility refreshes happen at most this often. */
export const IDENTITY_FOCUS_REFRESH_MIN_INTERVAL_MS = 30_000;
/** Background refresh while the tab is visible. */
export const IDENTITY_POLL_INTERVAL_MS = 5 * 60_000;
/** Bootstrap-updated / authorization-denied signals are coalesced over this window. */
export const IDENTITY_SIGNAL_REFRESH_MIN_INTERVAL_MS = 5_000;

/**
 * Pure throttle: true when no refresh has run yet, or at least `minIntervalMs`
 * has elapsed since the last one (also true if the clock moved backwards).
 */
export function shouldRefreshIdentity(
  now: number,
  lastRefreshAt: number | null,
  minIntervalMs: number,
): boolean {
  if (lastRefreshAt === null) return true;
  if (now < lastRefreshAt) return true;
  return now - lastRefreshAt >= minIntervalMs;
}

/**
 * Loads the signed-in identity (user, modules, capabilities) and keeps it
 * current: refetched when permissions change, when the window regains focus,
 * and periodically while visible. Refreshes are silent -- they never clear the
 * identity and failures keep the last good one.
 */
export function useCompanyIdentity(): { identity: CompanyIdentity | null; error: string } {
  const [identity, setIdentity] = useState<CompanyIdentity | null>(null);
  const [error, setError] = useState('');
  const mountedRef = useRef(true);
  const requestSeqRef = useRef(0);
  const appliedSeqRef = useRef(0);
  const lastRefreshAtRef = useRef<number | null>(null);
  const lastJsonRef = useRef<string | null>(null);

  const load = useCallback((silent: boolean): void => {
    const seq = ++requestSeqRef.current;
    lastRefreshAtRef.current = Date.now();
    void getCompanyIdentity()
      .then((next) => {
        // Ignore unmounted callers and responses older than one already applied.
        if (!mountedRef.current || seq < appliedSeqRef.current) return;
        appliedSeqRef.current = seq;
        if (next.organization) {
          setIdentitySessionPrincipal(next.user.id, next.organization.id);
        }
        const json = JSON.stringify(next);
        if (json === lastJsonRef.current) return;
        lastJsonRef.current = json;
        setIdentity(next);
        setError('');
      })
      .catch((cause: unknown) => {
        if (silent || !mountedRef.current || seq < appliedSeqRef.current) return;
        setError(cause instanceof Error ? cause.message : 'Unable to load company workspace.');
      });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load(false);

    const refreshIfDue = (minIntervalMs: number): void => {
      if (!shouldRefreshIdentity(Date.now(), lastRefreshAtRef.current, minIntervalMs)) return;
      load(true);
    };
    const visible = (): boolean => document.visibilityState !== 'hidden';

    const onSessionChanged = (event: Event): void => {
      const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason;
      if (reason === 'permissions-changed') load(true);
    };
    const onBootstrapUpdated = (): void => refreshIfDue(IDENTITY_SIGNAL_REFRESH_MIN_INTERVAL_MS);
    const onFocus = (): void => {
      if (visible()) refreshIfDue(IDENTITY_FOCUS_REFRESH_MIN_INTERVAL_MS);
    };
    const onVisibility = (): void => {
      if (visible()) refreshIfDue(IDENTITY_FOCUS_REFRESH_MIN_INTERVAL_MS);
    };
    const timer = window.setInterval(() => {
      if (visible()) load(true);
    }, IDENTITY_POLL_INTERVAL_MS);

    window.addEventListener(IDENTITY_SESSION_CHANGED_EVENT, onSessionChanged);
    window.addEventListener(IDENTITY_BOOTSTRAP_UPDATED_EVENT, onBootstrapUpdated);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
      window.removeEventListener(IDENTITY_SESSION_CHANGED_EVENT, onSessionChanged);
      window.removeEventListener(IDENTITY_BOOTSTRAP_UPDATED_EVENT, onBootstrapUpdated);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  return { identity, error };
}
