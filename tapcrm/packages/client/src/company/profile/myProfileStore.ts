import { useEffect, useSyncExternalStore } from 'react';
import {
  getIdentitySessionSnapshot,
  subscribeIdentitySessionChange,
} from '../../identity/api/authApi.js';
import { getMyProfile, type MyProfile } from '../api/myProfileApi.js';

/**
 * One shared copy of the signed-in employee's profile, so the avatar ring,
 * the "complete your profile" prompt and the My Profile page always show the
 * same percentage. Cleared whenever the session changes hands.
 */

interface MyProfileState {
  readonly profile: MyProfile | null;
  readonly loading: boolean;
  readonly error: string;
}

const EMPTY: MyProfileState = { profile: null, loading: false, error: '' };

let state: MyProfileState = EMPTY;
let loadedForEpoch: number | null = null;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: Partial<MyProfileState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Puts a fresh copy (e.g. the answer to a save) in place without another request. */
export function setMyProfile(profile: MyProfile): void {
  emit({ profile, error: '' });
}

export function refreshMyProfile(): Promise<void> {
  if (inFlight) return inFlight;
  const epoch = getIdentitySessionSnapshot().epoch;
  emit({ loading: true });
  inFlight = getMyProfile()
    .then((profile) => {
      // A different person signed in while this was loading.
      if (getIdentitySessionSnapshot().epoch !== epoch) return;
      emit({ profile, loading: false, error: '' });
    })
    .catch((cause: unknown) => {
      emit({ loading: false, error: cause instanceof Error ? cause.message : 'Unable to load your profile.' });
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

subscribeIdentitySessionChange((detail) => {
  // A token refresh keeps the same person; anything else starts over.
  if (detail.reason === 'refresh') return;
  loadedForEpoch = null;
  state = EMPTY;
  for (const listener of listeners) listener();
  if (detail.reason === 'login') clearPromptDismissal();
});

/** The signed-in employee's profile; loads once per session when `enabled`. */
export function useMyProfile(enabled: boolean): MyProfileState {
  const snapshot = useSyncExternalStore(subscribe, () => (enabled ? state : EMPTY), () => EMPTY);
  useEffect(() => {
    if (!enabled) return;
    const epoch = getIdentitySessionSnapshot().epoch;
    if (loadedForEpoch === epoch) return;
    loadedForEpoch = epoch;
    void refreshMyProfile();
  }, [enabled]);
  return snapshot;
}

/** The completion percentage, or null when there is no employee profile to complete. */
export function completionPercent(profile: MyProfile | null): number | null {
  return profile && profile.applicable ? profile.completion.percent : null;
}

// "Skip for later" hides the prompt until the next sign-in, not for good.
const PROMPT_KEY_PREFIX = 'tapcrm.profile_prompt_skipped.';

function promptKey(): string | null {
  const { principalId } = getIdentitySessionSnapshot();
  return principalId ? `${PROMPT_KEY_PREFIX}${principalId}` : null;
}

export function isPromptDismissed(): boolean {
  const key = promptKey();
  if (!key) return false;
  try {
    return sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function dismissPrompt(): void {
  const key = promptKey();
  if (!key) return;
  try {
    sessionStorage.setItem(key, '1');
  } catch {
    // Storage unavailable: the prompt simply shows again on the next page load.
  }
}

function clearPromptDismissal(): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(PROMPT_KEY_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {
    // Nothing to clear.
  }
}
