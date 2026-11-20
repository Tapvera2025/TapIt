import { createContext, useContext, type ReactNode } from 'react';
import { useNotifications } from './useNotifications.js';

type NotificationsState = ReturnType<typeof useNotifications>;

export const NotificationsContext = createContext<NotificationsState | null>(null);

/**
 * One notification feed (one REST page, one socket, one fallback poll) shared by
 * everything in a portal: the header bell AND the sidebar badges. Mount it once
 * per portal shell; without it each consumer would open its own socket.
 */
export function NotificationsProvider({
  children,
  onPermissionsChanged,
}: {
  children: ReactNode;
  /** The portal's reaction when the server says the person's powers changed. */
  onPermissionsChanged?: () => void;
}): React.JSX.Element {
  const value = useNotifications(onPermissionsChanged ? { onPermissionsChanged } : {});
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

/** The shared feed. Throws if no provider is mounted (a wiring bug, not a runtime state). */
export function useNotificationsFeed(): NotificationsState {
  const value = useContext(NotificationsContext);
  if (!value) throw new Error('useNotificationsFeed must be used inside <NotificationsProvider>.');
  return value;
}

/** Like useNotificationsFeed, but null when there is no provider (e.g. isolated renders and tests). */
export function useOptionalNotificationsFeed(): NotificationsState | null {
  return useContext(NotificationsContext);
}
