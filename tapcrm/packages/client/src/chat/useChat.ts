import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getIdentityAccessToken } from '../identity/api/authApi.js';
import {
  getConversation,
  getConversations,
  getMessages,
  markConversationRead,
  type ChatMessage,
  type Conversation,
} from './api/chatApi.js';

/** RT-6 fallback: only matters while the socket is down. */
const POLL_FALLBACK_MS = 60_000;
const RECONNECT_MS = 5_000;
const TYPING_STOP_MS = 3_000;

/**
 * The Direct Messages tab's data layer. Same shape as `useNotifications`:
 * REST is the source of truth, the socket is only "something changed,
 * refetch" (RT-4 — no message bodies travel over it).
 */
export function useChat(): {
  conversations: Conversation[];
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  messages: ChatMessage[];
  hasMore: boolean;
  loadingMessages: boolean;
  typingUsers: string[];
  error: string;
  refreshConversations: () => Promise<void>;
  openConversation: (id: string) => Promise<void>;
  loadMoreMessages: () => Promise<void>;
  notifyTyping: (state: 'start' | 'stop') => void;
  applyOptimisticMessage: (message: ChatMessage) => void;
  replaceMessage: (message: ChatMessage) => void;
} {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [error, setError] = useState('');
  const activeIdRef = useRef<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const typingTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  activeIdRef.current = activeId;

  const refreshConversations = useCallback(async (): Promise<void> => {
    try {
      const list = await getConversations('direct');
      setConversations(list);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load conversations.');
    }
  }, []);

  const loadMessages = useCallback(async (conversationId: string): Promise<void> => {
    setLoadingMessages(true);
    try {
      const page = await getMessages(conversationId, { limit: 30 });
      // API returns newest-first; the thread renders oldest-first.
      setMessages([...page.messages].reverse());
      setNextCursor(page.nextCursor);
      void markConversationRead(conversationId).catch(() => undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load messages.');
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  const openConversation = useCallback(async (id: string): Promise<void> => {
    setActiveIdState(id);
    setTypingUsers([]);
    await loadMessages(id);
  }, [loadMessages]);

  const loadMoreMessages = useCallback(async (): Promise<void> => {
    if (!activeId || !nextCursor || loadingMessages) return;
    setLoadingMessages(true);
    try {
      const page = await getMessages(activeId, { limit: 30, cursor: nextCursor });
      setMessages((current) => [...[...page.messages].reverse(), ...current]);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load more messages.');
    } finally {
      setLoadingMessages(false);
    }
  }, [activeId, nextCursor, loadingMessages]);

  const applyOptimisticMessage = useCallback((message: ChatMessage): void => {
    setMessages((current) => [...current, message]);
  }, []);

  const replaceMessage = useCallback((message: ChatMessage): void => {
    setMessages((current) => current.map((m) => (m.id === message.id ? message : m)));
  }, []);

  useEffect(() => {
    void refreshConversations();

    let socket: Socket | null = io({ path: '/socket.io', auth: (send) => send({ token: getIdentityAccessToken() ?? '' }), reconnectionDelayMax: 30_000 });
    let retry: ReturnType<typeof setTimeout> | undefined;

    const onConversationEvent = (payload: { conversationId?: string }) => {
      void refreshConversations();
      if (payload.conversationId && payload.conversationId === activeIdRef.current) void loadMessages(payload.conversationId);
    };

    socket.on('chat:conversation:new', () => void refreshConversations());
    socket.on('chat:message:new', onConversationEvent);
    socket.on('chat:message:unsent', onConversationEvent);
    socket.on('chat:message:reaction', onConversationEvent);
    socket.on('chat:message:read', () => {
      if (activeIdRef.current) void getConversation(activeIdRef.current).catch(() => undefined);
      void refreshConversations();
    });
    socket.on('chat:typing', (payload: { conversationId?: string; userId?: string; state?: 'start' | 'stop' }) => {
      if (!payload.conversationId || payload.conversationId !== activeIdRef.current || !payload.userId) return;
      const timers = typingTimers.current;
      const existing = timers.get(payload.userId);
      if (existing) clearTimeout(existing);
      if (payload.state === 'start') {
        setTypingUsers((current) => (current.includes(payload.userId!) ? current : [...current, payload.userId!]));
        timers.set(payload.userId, setTimeout(() => {
          setTypingUsers((current) => current.filter((id) => id !== payload.userId));
          timers.delete(payload.userId!);
        }, TYPING_STOP_MS));
      } else {
        setTypingUsers((current) => current.filter((id) => id !== payload.userId));
        timers.delete(payload.userId);
      }
    });
    socket.on('connect_error', () => {
      retry = setTimeout(() => socket?.connect(), RECONNECT_MS);
    });
    socketRef.current = socket;

    const poll = setInterval(() => {
      if (!socket?.connected) {
        void refreshConversations();
        if (activeIdRef.current) void loadMessages(activeIdRef.current);
      }
    }, POLL_FALLBACK_MS);

    return () => {
      clearInterval(poll);
      if (retry) clearTimeout(retry);
      const timers = typingTimers.current;
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
      socket?.close();
      socket = null;
      socketRef.current = null;
    };
    // Deliberately []: refreshConversations/loadMessages/activeIdRef are stable
    // across renders; re-subscribing the socket on every change would thrash it.
  }, []);

  const notifyTyping = useCallback((state: 'start' | 'stop'): void => {
    if (activeId && socketRef.current?.connected) socketRef.current.emit('chat:typing', { conversationId: activeId, state });
  }, [activeId]);

  return {
    conversations,
    activeId,
    setActiveId: setActiveIdState,
    messages,
    hasMore: nextCursor !== null,
    loadingMessages,
    typingUsers,
    error,
    refreshConversations,
    openConversation,
    loadMoreMessages,
    notifyTyping,
    applyOptimisticMessage,
    replaceMessage,
  };
}
