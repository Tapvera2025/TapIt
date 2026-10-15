import { useCallback, useEffect, useRef, useState } from 'react';
import { listMyInterviews } from './api/recruitmentApi.js';

/** Rechecks are cheap, but not on every click. */
const RECHECK_MS = 30_000;

/**
 * Whether the signed-in user has interviews — a pipeline round HR assigned to
 * them, or a scheduled interview that names them on the panel — for the
 * sidebar's "My Interviews" (shown only to people with interviews). Checked
 * when the workspace opens, again as they move around the app or come back to
 * the tab (at most every 30 seconds), and at once when they open My Interviews
 * — so an interview HR sets up shows without a reload. Anyone who cannot
 * interview, or a tenant without recruitment, simply has none.
 */
export function useHasAssignedInterviews(enabled: boolean, pathname: string): boolean {
  const [hasInterviews, setHasInterviews] = useState(false);
  const lastChecked = useRef(0);
  const inFlight = useRef(false);

  const check = useCallback(async (force: boolean) => {
    if (!enabled || inFlight.current) return;
    if (!force && Date.now() - lastChecked.current < RECHECK_MS) return;
    inFlight.current = true;
    lastChecked.current = Date.now();
    try {
      const mine = await listMyInterviews();
      setHasInterviews(mine.rounds.length + mine.interviews.length > 0);
    } catch {
      setHasInterviews(false);
    } finally {
      inFlight.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) setHasInterviews(false);
    void check(true);
  }, [enabled, check]);

  useEffect(() => {
    void check(pathname === '/company/my-interviews');
  }, [pathname, check]);

  useEffect(() => {
    const onFocus = () => { void check(false); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [check]);

  return hasInterviews;
}
