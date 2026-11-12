import { useEffect, useSyncExternalStore } from 'react';
import { getPresence, type ChatPresence } from './api/chatApi.js';

/**
 * Presence for chat avatars via GET /api/chat/presence: green when someone is
 * punched in and working or has TapIt open, orange on a break, grey otherwise.
 *
 * One shared store for the whole page: every avatar subscribes, but there is
 * a single request — on first use, every minute while anything is shown,
 * when the tab regains focus, and (debounced) when the server says someone's
 * status changed or they opened/closed TapIt (`chat:presence`, forwarded by
 * useChat's socket).
 */

type Listener = () => void;

const REFRESH_MS = 60_000;
const DEBOUNCE_MS = 1_500;

let snapshot: Record<string, ChatPresence> = {};
let subscribers = 0;
let disabled = false;
let timer: ReturnType<typeof setInterval> | undefined;
let pending: ReturnType<typeof setTimeout> | undefined;
let inFlight: Promise<void> | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

async function load(): Promise<void> {
  if (disabled) return;
  if (inFlight) return inFlight;
  inFlight = getPresence()
    .then((next) => {
      snapshot = next;
      emit();
    })
    .catch(() => undefined)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

const onFocus = (): void => {
  void load();
};

/** Ask for a refresh soon (several status changes in a burst cost one request). */
export function invalidatePresence(): void {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = undefined;
    void load();
  }, DEBOUNCE_MS);
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function retain(): () => void {
  subscribers += 1;
  if (subscribers === 1) {
    void load();
    timer = setInterval(() => void load(), REFRESH_MS);
    window.addEventListener('focus', onFocus);
  }
  return () => {
    subscribers -= 1;
    if (subscribers === 0) {
      if (timer) clearInterval(timer);
      timer = undefined;
      window.removeEventListener('focus', onFocus);
    }
  };
}

/** Client-portal pages show no presence (an employee's attendance is not the client's business). */
export function disablePresence(value: boolean): void {
  disabled = value;
}

/** The presence map; `enabled: false` reads nothing and polls nothing. */
export function usePresenceMap(enabled = true): Record<string, ChatPresence> {
  useEffect(() => (enabled ? retain() : undefined), [enabled]);
  return useSyncExternalStore(subscribe, () => (enabled ? snapshot : EMPTY), () => EMPTY);
}

const EMPTY: Record<string, ChatPresence> = {};

export const PRESENCE_LABEL: Record<ChatPresence, string> = {
  active: 'Active',
  idle: 'On a break',
  offline: 'Offline',
};
