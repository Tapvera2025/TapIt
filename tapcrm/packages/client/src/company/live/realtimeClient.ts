import { io, type Socket } from 'socket.io-client';
import {
  getIdentityAccessToken,
  identityApiBasePath,
  invalidateIdentityPermissions,
  subscribeIdentitySessionChange,
} from '../../identity/api/authApi.js';
import { clearPeopleQueries } from '../api/client.js';

export type StatusChangedPayload = { userId: string };
export type PermissionsChangedPayload = { eventId: string; positionId: string | null };

type StatusChangedListener = (payload: StatusChangedPayload) => void;

const POLL_INTERVAL_MS = 30_000;
const MAX_RECONNECT_DELAY_MS = 60_000;
const COALESCE_WINDOW_MS = 400;

let socket: Socket | null = null;
let unsubscribeSession: (() => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let connectionFailed = false;
let failedRefetchTimer: ReturnType<typeof setTimeout> | null = null;

const statusListeners = new Set<StatusChangedListener>();
const coalesced = new Set<string>();
let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
let onBoardRefetch: (() => void) | null = null;

export function setLiveBoardRefetch(fn: (() => void) | null): void {
  onBoardRefetch = fn;
}

export function getConnectionFailed(): boolean {
  return connectionFailed;
}

export function subscribeStatusChanged(listener: StatusChangedListener): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

function flushCoalesced(): void {
  coalesceTimer = null;
  if (coalesced.size === 0) return;
  const ids = [...coalesced];
  coalesced.clear();
  for (const listener of statusListeners) {
    for (const userId of ids) {
      listener({ userId });
    }
  }
  onBoardRefetch?.();
}

function scheduleCoalesced(userId: string): void {
  coalesced.add(userId);
  if (coalesceTimer === null) {
    coalesceTimer = setTimeout(flushCoalesced, COALESCE_WINDOW_MS);
  }
}

function stopPoll(): void {
  if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; }
}

function startPoll(): void {
  stopPoll();
  pollTimer = setInterval(() => { onBoardRefetch?.(); }, POLL_INTERVAL_MS);
}

export function connectRealtime(): void {
  if (socket !== null) return;

  const token = getIdentityAccessToken();
  if (!token) return;

  const basePath = identityApiBasePath();
  socket = io(window.location.origin, {
    path: `${basePath}/socket.io`,
    auth: { token },
    reconnectionDelay: 1000,
    reconnectionDelayMax: MAX_RECONNECT_DELAY_MS,
    reconnectionAttempts: 8,
    transports: ['websocket', 'polling'],
  });

  socket.on('connect', () => {
    connectionFailed = false;
    stopPoll();
    if (failedRefetchTimer !== null) { clearTimeout(failedRefetchTimer); failedRefetchTimer = null; }
    onBoardRefetch?.();
  });

  socket.on('status:changed', (payload: StatusChangedPayload) => {
    scheduleCoalesced(payload.userId);
  });

  socket.on('permissions:changed', (_payload: PermissionsChangedPayload) => {
    clearPeopleQueries();
    invalidateIdentityPermissions();
  });

  socket.on('connect_error', (err: Error) => {
    if (err.message === 'UNAUTHENTICATED') {
      disconnectRealtime();
      return;
    }
    connectionFailed = true;
    startPoll();
  });

  socket.on('disconnect', () => {
    connectionFailed = true;
    startPoll();
  });

  // Reconnect with a fresh token when the session changes
  unsubscribeSession = subscribeIdentitySessionChange((detail) => {
    disconnectRealtime();
    if (detail.reason !== 'logout' && detail.reason !== 'expired') {
      // Brief delay to let the new token settle
      failedRefetchTimer = setTimeout(() => { connectRealtime(); }, 100);
    }
  });

  // Pause polling in hidden tabs
  document.addEventListener('visibilitychange', handleVisibility);
}

function handleVisibility(): void {
  if (document.visibilityState === 'visible' && connectionFailed) {
    onBoardRefetch?.();
  }
}

export function disconnectRealtime(): void {
  if (unsubscribeSession) { unsubscribeSession(); unsubscribeSession = null; }
  document.removeEventListener('visibilitychange', handleVisibility);
  stopPoll();
  if (failedRefetchTimer !== null) { clearTimeout(failedRefetchTimer); failedRefetchTimer = null; }
  socket?.disconnect();
  socket = null;
  connectionFailed = false;
  if (coalesceTimer !== null) { clearTimeout(coalesceTimer); coalesceTimer = null; }
  coalesced.clear();
}
