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

export type RealtimeConnectionState = 'connected' | 'reconnecting' | 'disconnected';
type ConnectionStateListener = (state: RealtimeConnectionState) => void;
const connectionListeners = new Set<ConnectionStateListener>();

export function getRealtimeState(): RealtimeConnectionState {
  if (socket === null) return 'disconnected';
  if (socket.connected) return 'connected';
  return 'reconnecting';
}

function notifyConnectionState(): void {
  const state = getRealtimeState();
  for (const listener of connectionListeners) {
    listener(state);
  }
}

export function subscribeConnectionState(listener: ConnectionStateListener): () => void {
  connectionListeners.add(listener);
  listener(getRealtimeState());
  return () => connectionListeners.delete(listener);
}

export function subscribeStatusChanged(listener: StatusChangedListener): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

type RealtimeEventListener = (payload: unknown) => void;
const eventListeners = new Map<string, Set<RealtimeEventListener>>();
let holders = 0;

/**
 * Keeps the socket open for as long as someone needs it. Every page that uses
 * the socket holds it and releases it when it closes, so one page closing does
 * not cut off another that is still listening.
 */
export function retainRealtime(): () => void {
  holders += 1;
  connectRealtime();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders -= 1;
    if (holders === 0) disconnectRealtime();
  };
}

/**
 * Listens for one server event by name (for example `sales.lead.reassigned`,
 * from server/src/modules/sales/realtime/sales-channel.ts) and keeps the
 * socket open while listening. Returns the function that stops listening.
 */
export function subscribeRealtimeEvent<T>(event: string, listener: (payload: T) => void): () => void {
  const listeners = eventListeners.get(event) ?? new Set<RealtimeEventListener>();
  const entry: RealtimeEventListener = (payload) => listener(payload as T);
  listeners.add(entry);
  eventListeners.set(event, listeners);
  const release = retainRealtime();
  return () => {
    listeners.delete(entry);
    if (listeners.size === 0) eventListeners.delete(event);
    release();
  };
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
    notifyConnectionState();
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

  socket.onAny((event: string, payload: unknown) => {
    for (const listener of eventListeners.get(event) ?? []) listener(payload);
  });

  socket.on('connect_error', (err: Error) => {
    if (err.message === 'UNAUTHENTICATED') {
      disconnectRealtime();
      return;
    }
    connectionFailed = true;
    notifyConnectionState();
    startPoll();
  });

  socket.on('disconnect', () => {
    connectionFailed = true;
    notifyConnectionState();
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
  notifyConnectionState();
  if (coalesceTimer !== null) { clearTimeout(coalesceTimer); coalesceTimer = null; }
  coalesced.clear();
}
