import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getIdentityAccessToken } from '../identity/api/authApi.js';
import {
  getNotifications,
  getUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from './api/notificationsApi.js';

const PAGE_SIZE = 20;
/** RT-6: polling is only a fallback while the socket is down. */
const POLL_FALLBACK_MS = 60_000;
const RECONNECT_MS = 5_000;

/**
 * The client half of the notification engine.
 *
 * The REST API is the source of truth; the socket is only a "something changed,
 * refetch" signal (RT-4 — payloads carry identifiers, never bodies). So a
 * missed socket event costs nothing: the next fetch, or the 60-second fallback
 * poll while disconnected, catches up.
 */
export function useNotifications(): {
  items: AppNotification[];
  unreadCount: number;
  hasMore: boolean;
  loading: boolean;
  error: string;
  /** The newest notification that arrived live, for a transient toast. */
  incoming: AppNotification | null;
  dismissIncoming: () => void;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
} {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [incoming, setIncoming] = useState<AppNotification | null>(null);
  const knownIds = useRef<Set<string> | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async (announce = false): Promise<void> => {
    try {
      const page = await getNotifications({ limit: PAGE_SIZE });
      if (!mounted.current) return;
      setItems(page.notifications);
      setUnreadCount(page.unreadCount);
      setNextCursor(page.nextCursor);
      setError('');
      const known = knownIds.current;
      if (announce && known) {
        const fresh = page.notifications.find((n) => !n.read && !known.has(n.id));
        if (fresh) setIncoming(fresh);
      }
      knownIds.current = new Set(page.notifications.map((n) => n.id));
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Unable to load notifications.');
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    // First paint: just the badge is cheap; the list loads with the first page.
    void refresh();

    let socket: Socket | null = io({
      path: '/socket.io',
      // A function, so every reconnect presents the CURRENT token.
      auth: (send) => send({ token: getIdentityAccessToken() ?? '' }),
      reconnectionDelayMax: 30_000,
    });

    let retry: ReturnType<typeof setTimeout> | undefined;
    socket.on('connect', () => void refresh());
    socket.on('notification:new', () => void refresh(true));
    socket.on('notification:read', (payload: { id?: string; all?: boolean }) => {
      if (payload.all) {
        setItems((current) => current.map((n) => ({ ...n, read: true })));
        setUnreadCount(0);
      } else if (payload.id) {
        setItems((current) => current.map((n) => (n.id === payload.id ? { ...n, read: true } : n)));
        void getUnreadCount().then((count) => mounted.current && setUnreadCount(count)).catch(() => undefined);
      }
    });
    // A middleware rejection (expired token) is not auto-retried by socket.io.
    // Touching the API refreshes the access token, then we reconnect.
    socket.on('connect_error', () => {
      retry = setTimeout(() => {
        void getUnreadCount()
          .catch(() => undefined)
          .finally(() => socket?.connect());
      }, RECONNECT_MS);
    });

    const poll = setInterval(() => {
      if (!socket?.connected) void refresh(true);
    }, POLL_FALLBACK_MS);

    return () => {
      mounted.current = false;
      clearInterval(poll);
      if (retry) clearTimeout(retry);
      socket?.close();
      socket = null;
    };
  }, [refresh]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (!nextCursor || loading) return;
    setLoading(true);
    try {
      const page = await getNotifications({ limit: PAGE_SIZE, cursor: nextCursor });
      setItems((current) => [...current, ...page.notifications.filter((n) => !current.some((c) => c.id === n.id))]);
      setNextCursor(page.nextCursor);
      setUnreadCount(page.unreadCount);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load more notifications.');
    } finally {
      setLoading(false);
    }
  }, [nextCursor, loading]);

  const markRead = useCallback(async (id: string): Promise<void> => {
    const wasUnread = items.some((n) => n.id === id && !n.read);
    if (!wasUnread) return;
    // Optimistic; rolled back if the server refuses.
    setItems((current) => current.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnreadCount((count) => Math.max(0, count - 1));
    try {
      await markNotificationRead(id);
    } catch {
      void refresh();
    }
  }, [items, refresh]);

  const markAllRead = useCallback(async (): Promise<void> => {
    setItems((current) => current.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    try {
      await markAllNotificationsRead();
    } catch {
      void refresh();
    }
  }, [refresh]);

  return {
    items,
    unreadCount,
    hasMore: nextCursor !== null,
    loading,
    error,
    incoming,
    dismissIncoming: () => setIncoming(null),
    refresh: () => refresh(),
    loadMore,
    markRead,
    markAllRead,
  };
}
