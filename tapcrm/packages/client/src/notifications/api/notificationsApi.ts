import { identityRequest } from '../../identity/api/authApi.js';

export interface AppNotification {
  id: string;
  type: string;
  /** `operational` = something needs you; never silenced by preferences (NT-3). */
  priority: 'informational' | 'operational';
  title: string;
  body: string;
  /** In-app path (NT-5). */
  link: string | null;
  metadata: Record<string, unknown>;
  read: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  notifications: AppNotification[];
  unreadCount: number;
  nextCursor: string | null;
}

export function getNotifications(options: { unread?: boolean; limit?: number; cursor?: string } = {}): Promise<NotificationPage> {
  const query = new URLSearchParams();
  if (options.unread) query.set('unread', 'true');
  if (options.limit) query.set('limit', String(options.limit));
  if (options.cursor) query.set('cursor', options.cursor);
  const suffix = query.toString();
  return identityRequest<NotificationPage>(`/api/notifications${suffix ? `?${suffix}` : ''}`);
}

export async function getUnreadCount(): Promise<number> {
  return (await identityRequest<{ unreadCount: number }>('/api/notifications/unread-count')).unreadCount;
}

export function markNotificationRead(id: string): Promise<{ notification: AppNotification }> {
  return identityRequest(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
}

export function markAllNotificationsRead(): Promise<{ updated: number }> {
  return identityRequest('/api/notifications/read-all', { method: 'POST' });
}
