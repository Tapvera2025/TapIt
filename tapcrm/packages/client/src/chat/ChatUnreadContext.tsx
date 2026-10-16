import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getIdentityAccessToken, identityApiBasePath } from '../identity/api/authApi.js';
import { getChatUnreadSummary, type ChatUnreadSummary, type ConversationKind } from './api/chatApi.js';

const EMPTY_SUMMARY: ChatUnreadSummary = { total: 0, direct: 0, group: 0, project: 0 };
const POLL_FALLBACK_MS = 60_000;
export const CHAT_UNREAD_CHANGED_EVENT = 'tapcrm:chat-unread-changed';

interface ChatUnreadChangedDetail {
  kind: ConversationKind;
  count: number;
  optimistic?: boolean;
}

const ChatUnreadContext = createContext<ChatUnreadSummary>(EMPTY_SUMMARY);

export function ChatUnreadProvider({ enabled, children }: { enabled: boolean; children: ReactNode }): React.JSX.Element {
  const [summary, setSummary] = useState<ChatUnreadSummary>(EMPTY_SUMMARY);

  useEffect(() => {
    if (!enabled) {
      setSummary(EMPTY_SUMMARY);
      return undefined;
    }

    let cancelled = false;
    let socket: Socket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const refresh = (): void => {
      void getChatUnreadSummary()
        .then((next) => {
          if (!cancelled) setSummary(next);
        })
        .catch(() => undefined);
    };

    refresh();
    socket = io({
      path: `${identityApiBasePath()}/socket.io`,
      auth: (send) => send({ token: getIdentityAccessToken() ?? '' }),
      reconnectionDelayMax: 30_000,
    });
    const onChatChange = (): void => refresh();
    socket.on('chat:message:new', onChatChange);
    socket.on('chat:message:read', onChatChange);
    socket.on('chat:message:unsent', onChatChange);
    socket.on('chat:conversation:new', onChatChange);
    socket.on('chat:conversation:updated', onChatChange);
    socket.on('connect_error', () => {
      retry = setTimeout(() => socket?.connect(), 5_000);
    });

    const onFocus = (): void => refresh();
    const onUnreadChanged = (event: Event): void => {
      const detail = (event as CustomEvent<ChatUnreadChangedDetail>).detail;
      if (detail?.optimistic && detail.count > 0) {
        setSummary((current) => {
          const removed = Math.min(current[detail.kind], detail.count);
          return {
            ...current,
            [detail.kind]: current[detail.kind] - removed,
            total: Math.max(0, current.total - removed),
          };
        });
        return;
      }
      refresh();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener(CHAT_UNREAD_CHANGED_EVENT, onUnreadChanged);
    const poll = window.setInterval(refresh, POLL_FALLBACK_MS);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(CHAT_UNREAD_CHANGED_EVENT, onUnreadChanged);
      if (retry) clearTimeout(retry);
      socket?.close();
      socket = null;
    };
  }, [enabled]);

  const value = useMemo(() => summary, [summary]);
  return <ChatUnreadContext.Provider value={value}>{children}</ChatUnreadContext.Provider>;
}

export function useChatUnread(): ChatUnreadSummary {
  return useContext(ChatUnreadContext);
}
