import { useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/Icon.js';
import type { AppNotification } from './api/notificationsApi.js';
import { useNotifications } from './useNotifications.js';

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * The header bell: unread badge, a dropdown notification centre, and a
 * transient toast for notifications that arrive while the app is open.
 */
export function NotificationBell({ onNavigate }: { onNavigate: (path: string) => void }): React.JSX.Element {
  const { items, unreadCount, hasMore, loading, error, incoming, dismissIncoming, loadMore, markRead, markAllRead } =
    useNotifications();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!incoming) return;
    const timer = setTimeout(dismissIncoming, 6_000);
    return () => clearTimeout(timer);
  }, [incoming, dismissIncoming]);

  const openNotification = (notification: AppNotification) => {
    void markRead(notification.id);
    dismissIncoming();
    setOpen(false);
    if (notification.link) onNavigate(notification.link);
  };

  const badge = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative rounded-lg border border-app-border p-2.5 text-app-muted hover:text-app-accent"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-haspopup="true"
        aria-expanded={open}
        title="Notifications"
      >
        <Icon name="bell" />
        {unreadCount > 0 && (
          <span
            className="absolute -right-1.5 -top-1.5 grid min-w-5 place-items-center rounded-full bg-app-accent px-1 text-[10px] font-bold leading-5 text-app-on-accent"
            aria-hidden="true"
          >
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div className="ui-card fixed inset-x-3 top-20 z-50 flex max-h-[70dvh] flex-col overflow-hidden md:absolute md:inset-x-auto md:right-0 md:top-full md:mt-2 md:w-96">
          <div className="flex items-center justify-between gap-3 border-b border-app-border px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
            <button
              type="button"
              onClick={() => void markAllRead()}
              disabled={unreadCount === 0}
              className="text-xs font-semibold text-app-accent disabled:text-app-muted disabled:opacity-60"
            >
              Mark all read
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {error && <p role="alert" className="p-4 text-sm text-app-danger">{error}</p>}
            {!error && items.length === 0 && (
              <p className="p-6 text-center text-sm text-app-muted">You&apos;re all caught up.</p>
            )}
            <ul>
              {items.map((notification) => (
                <li key={notification.id} className="border-b border-app-border last:border-b-0">
                  <button
                    type="button"
                    onClick={() => openNotification(notification)}
                    className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-app-surface-raised ${notification.read ? 'opacity-70' : ''}`}
                  >
                    <span
                      className={`mt-1.5 size-2 shrink-0 rounded-full ${notification.read ? 'bg-transparent' : 'bg-app-accent'}`}
                      aria-label={notification.read ? undefined : 'Unread'}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold">{notification.title}</span>
                        {notification.priority === 'operational' && (
                          <span className="shrink-0 rounded bg-app-accent/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-app-accent">
                            Action
                          </span>
                        )}
                      </span>
                      {notification.body && (
                        <span className="mt-0.5 line-clamp-2 block text-xs text-app-muted">{notification.body}</span>
                      )}
                      <span className="mt-1 block text-[11px] text-app-muted">{timeAgo(notification.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {hasMore && (
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loading}
                className="w-full px-4 py-3 text-center text-xs font-semibold text-app-accent disabled:opacity-60"
              >
                {loading ? 'Loading…' : 'Load older'}
              </button>
            )}
          </div>
        </div>
      )}

      {incoming && !open && (
        <div role="status" aria-live="polite" className="ui-card fixed bottom-4 right-4 z-50 w-[min(22rem,calc(100vw-2rem))]">
          <button type="button" onClick={() => openNotification(incoming)} className="block w-full px-4 py-3 text-left">
            <span className="block text-sm font-semibold">{incoming.title}</span>
            {incoming.body && <span className="mt-0.5 line-clamp-2 block text-xs text-app-muted">{incoming.body}</span>}
          </button>
          <button
            type="button"
            onClick={dismissIncoming}
            className="absolute right-2 top-2 rounded p-1 text-xs text-app-muted hover:text-app-foreground"
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
