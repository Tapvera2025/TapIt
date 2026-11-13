import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getIdentityAccessToken, identityApiBasePath } from '../identity/api/authApi.js';
import {
  getConversations,
  getMessage,
  getMessages,
  markConversationRead,
  type ChatMessage,
  type Conversation,
  type ConversationKind,
  type MessagePage,
} from './api/chatApi.js';
import { CHAT_UNREAD_CHANGED_EVENT } from './ChatUnreadContext.js';
import { invalidatePresence } from './presence.js';

/** RT-6 fallback: only matters while the socket is down. */
const POLL_FALLBACK_MS = 15_000;
const RECONNECT_MS = 5_000;
const TYPING_STOP_MS = 3_000;
const PAGE = 30;

/**
 * What ConversationWorkspace drives. Implemented by `useChat` (company
 * Messages) and `useClientMessages` (client portal).
 */
export interface ChatController {
  conversations: Conversation[];
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  /** Oldest first, as the thread renders. */
  messages: ChatMessage[];
  hasMore: boolean;
  /** True while showing history (after jumping to an old message): newer messages exist below. */
  hasNewer: boolean;
  /** New messages that arrived while viewing history. */
  newMessagesBelow: number;
  loadingMessages: boolean;
  typingUsers: string[];
  error: string;
  refreshConversations: () => Promise<void>;
  openConversation: (id: string, options?: { aroundMessageId?: string | undefined }) => Promise<void>;
  loadMoreMessages: () => Promise<void>;
  loadNewerMessages: () => Promise<void>;
  jumpToLatest: () => Promise<void>;
  /** Makes sure `messageId` is in `messages` (loading a window around it if needed). False if it no longer exists. */
  jumpToMessage: (messageId: string) => Promise<boolean>;
  notifyTyping: (state: 'start' | 'stop') => void;
  applyOptimisticMessage: (message: ChatMessage) => void;
  replaceMessage: (message: ChatMessage) => void;
  refreshMessage: (messageId: string) => Promise<void>;
  /** Bumped when this conversation's pins change elsewhere (refetch the pinned bar). */
  pinsVersion: number;
  /** Bumped when the viewer's scheduled messages change elsewhere (another tab, or one was sent). */
  scheduledVersion: number;
}

export function sortMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.sort((a, b) => (a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt)));
}

/** Replace by id, add what is new, keep chronological order. */
export function mergeMessages(current: readonly ChatMessage[], incoming: readonly ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return [...current];
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return sortMessages([...byId.values()]);
}

/** The thread state machine shared by both data layers: pages, windows and merges. */
export function useThreadState(fetchPage: (conversationId: string, options: { limit?: number; cursor?: string; after?: string; around?: string }) => Promise<MessagePage>, fetchOne: (conversationId: string, messageId: string) => Promise<ChatMessage>) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [newerCursor, setNewerCursor] = useState<string | null>(null);
  const [newMessagesBelow, setNewMessagesBelow] = useState(0);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const newerRef = useRef<string | null>(null);
  newerRef.current = newerCursor;
  const loadingRef = useRef(false);

  const applyPage = useCallback((page: MessagePage, mode: 'replace' | 'older' | 'newer') => {
    const ordered = [...page.messages].reverse();
    if (mode === 'replace') {
      setMessages(ordered);
      setNextCursor(page.nextCursor);
      setNewerCursor(page.newerCursor ?? null);
      setNewMessagesBelow(0);
    } else if (mode === 'older') {
      setMessages((current) => mergeMessages(current, ordered));
      setNextCursor(page.nextCursor);
    } else {
      setMessages((current) => mergeMessages(current, ordered));
      setNewerCursor(page.newerCursor ?? null);
      if (!page.newerCursor) setNewMessagesBelow(0);
    }
  }, []);

  const loadLatest = useCallback(async (conversationId: string) => {
    applyPage(await fetchPage(conversationId, { limit: PAGE }), 'replace');
  }, [applyPage, fetchPage]);

  const loadAround = useCallback(async (conversationId: string, messageId: string) => {
    applyPage(await fetchPage(conversationId, { limit: PAGE, around: messageId }), 'replace');
  }, [applyPage, fetchPage]);

  const loadOlder = useCallback(async (conversationId: string) => {
    if (!nextCursor || loadingRef.current) return;
    loadingRef.current = true;
    setLoadingMessages(true);
    try {
      applyPage(await fetchPage(conversationId, { limit: PAGE, cursor: nextCursor }), 'older');
    } finally {
      loadingRef.current = false;
      setLoadingMessages(false);
    }
  }, [applyPage, fetchPage, nextCursor]);

  const loadNewer = useCallback(async (conversationId: string) => {
    if (!newerCursor || loadingRef.current) return;
    loadingRef.current = true;
    setLoadingMessages(true);
    try {
      applyPage(await fetchPage(conversationId, { limit: PAGE, after: newerCursor }), 'newer');
    } finally {
      loadingRef.current = false;
      setLoadingMessages(false);
    }
  }, [applyPage, fetchPage, newerCursor]);

  /** A socket said something changed: at the latest page, merge the newest messages (keeps older pages loaded). */
  const mergeLatest = useCallback(async (conversationId: string) => {
    if (newerRef.current) return;
    const page = await fetchPage(conversationId, { limit: PAGE });
    setMessages((current) => mergeMessages(current, [...page.messages].reverse()));
  }, [fetchPage]);

  const refreshOne = useCallback(async (conversationId: string, messageId: string) => {
    try {
      const message = await fetchOne(conversationId, messageId);
      setMessages((current) => (current.some((m) => m.id === messageId) ? current.map((m) => (m.id === messageId ? message : m)) : current));
    } catch {
      /* gone or no longer visible: the next page load reconciles */
    }
  }, [fetchOne]);

  const arrived = useCallback(async (conversationId: string, messageId: string) => {
    if (newerRef.current) {
      setNewMessagesBelow((count) => count + 1);
      return false;
    }
    try {
      const message = await fetchOne(conversationId, messageId);
      setMessages((current) => mergeMessages(current, [message]));
      return true;
    } catch {
      await mergeLatest(conversationId);
      return true;
    }
  }, [fetchOne, mergeLatest]);

  const reset = useCallback(() => {
    setMessages([]);
    setNextCursor(null);
    setNewerCursor(null);
    setNewMessagesBelow(0);
  }, []);

  return {
    messages,
    setMessages,
    hasMore: nextCursor !== null,
    hasNewer: newerCursor !== null,
    newMessagesBelow,
    loadingMessages,
    setLoadingMessages,
    loadLatest,
    loadAround,
    loadOlder,
    loadNewer,
    mergeLatest,
    refreshOne,
    arrived,
    reset,
  };
}

/**
 * The data layer shared by every conversation tab (Direct Messages,
 * Internal Groups, Project Groups). Same shape as `useNotifications`: REST
 * is the source of truth, the socket is only "something changed, refetch"
 * (RT-4 — no message bodies travel over it). A socket event about one
 * message refetches that message only. `archived` lists the archived
 * conversations instead of the active ones (Internal Groups' Archived view).
 */
export function useChat(kind: ConversationKind, options: { archived?: boolean } = {}): ChatController {
  const archived = options.archived === true;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [pinsVersion, setPinsVersion] = useState(0);
  const [scheduledVersion, setScheduledVersion] = useState(0);
  const activeIdRef = useRef<string | null>(null);
  const conversationsRef = useRef<Conversation[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const typingTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const thread = useThreadState(
    useCallback((conversationId, options) => getMessages(conversationId, options), []),
    useCallback((_conversationId, messageId) => getMessage(messageId), []),
  );
  const threadRef = useRef(thread);
  threadRef.current = thread;

  activeIdRef.current = activeId;
  conversationsRef.current = conversations;

  const refreshConversations = useCallback(async (): Promise<void> => {
    try {
      const list = await getConversations(kind, { archived });
      setConversations(list.map((conversation) =>
        conversation.id === activeIdRef.current ? { ...conversation, unreadCount: 0 } : conversation,
      ));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load conversations.');
    }
  }, [archived, kind]);

  const markRead = useCallback((conversationId: string): void => {
    void markConversationRead(conversationId)
      .then(() => window.dispatchEvent(new Event(CHAT_UNREAD_CHANGED_EVENT)))
      .catch(() => window.dispatchEvent(new Event(CHAT_UNREAD_CHANGED_EVENT)));
  }, []);

  const loadMessages = useCallback(async (conversationId: string, aroundMessageId?: string): Promise<void> => {
    const current = threadRef.current;
    current.setLoadingMessages(true);
    try {
      if (aroundMessageId) await current.loadAround(conversationId, aroundMessageId);
      else await current.loadLatest(conversationId);
      setError('');
      markRead(conversationId);
    } catch (cause) {
      if (aroundMessageId) {
        // The message is gone (unsent long ago, or the link is stale): open the latest page instead.
        await current.loadLatest(conversationId).catch(() => undefined);
      } else {
        setError(cause instanceof Error ? cause.message : 'Unable to load messages.');
      }
      window.dispatchEvent(new Event(CHAT_UNREAD_CHANGED_EVENT));
    } finally {
      current.setLoadingMessages(false);
    }
  }, [markRead]);

  const openConversation = useCallback(async (id: string, options: { aroundMessageId?: string | undefined } = {}): Promise<void> => {
    if (activeIdRef.current !== id) threadRef.current.reset();
    activeIdRef.current = id;
    setActiveIdState(id);
    setTypingUsers([]);
    const unreadCount = conversationsRef.current.find((conversation) => conversation.id === id)?.unreadCount ?? 0;
    setConversations((current) => current.map((conversation) =>
      conversation.id === id ? { ...conversation, unreadCount: 0 } : conversation,
    ));
    if (unreadCount > 0) {
      window.dispatchEvent(new CustomEvent(CHAT_UNREAD_CHANGED_EVENT, {
        detail: { kind, count: unreadCount, optimistic: true },
      }));
    }
    await loadMessages(id, options.aroundMessageId);
  }, [kind, loadMessages]);

  const setActiveId = useCallback((id: string | null): void => {
    activeIdRef.current = id;
    setActiveIdState(id);
    if (id === null) threadRef.current.reset();
  }, []);

  const loadMoreMessages = useCallback(async (): Promise<void> => {
    if (!activeId) return;
    try {
      await thread.loadOlder(activeId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load more messages.');
    }
  }, [activeId, thread]);

  const loadNewerMessages = useCallback(async (): Promise<void> => {
    if (!activeId) return;
    try {
      await thread.loadNewer(activeId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load newer messages.');
    }
  }, [activeId, thread]);

  const jumpToLatest = useCallback(async (): Promise<void> => {
    if (activeIdRef.current) await loadMessages(activeIdRef.current);
  }, [loadMessages]);

  const jumpToMessage = useCallback(async (messageId: string): Promise<boolean> => {
    const conversationId = activeIdRef.current;
    if (!conversationId) return false;
    if (threadRef.current.messages.some((message) => message.id === messageId)) return true;
    try {
      await threadRef.current.loadAround(conversationId, messageId);
      return true;
    } catch {
      return false;
    }
  }, []);

  const applyOptimisticMessage = useCallback((message: ChatMessage): void => {
    // Sending while viewing history: return to the present first.
    if (threadRef.current.hasNewer && activeIdRef.current) {
      void loadMessages(activeIdRef.current);
      return;
    }
    threadRef.current.setMessages((current) => mergeMessages(current, [message]));
  }, [loadMessages]);

  const replaceMessage = useCallback((message: ChatMessage): void => {
    threadRef.current.setMessages((current) => current.map((m) => (m.id === message.id ? message : m)));
  }, []);

  const refreshMessage = useCallback(async (messageId: string): Promise<void> => {
    if (activeIdRef.current) await threadRef.current.refreshOne(activeIdRef.current, messageId);
  }, []);

  useEffect(() => {
    void refreshConversations();
    const timers = typingTimers.current;

    let socket: Socket | null = io({ path: `${identityApiBasePath()}/socket.io`, auth: (send) => send({ token: getIdentityAccessToken() ?? '' }), reconnectionDelayMax: 30_000 });
    let retry: ReturnType<typeof setTimeout> | undefined;

    const active = (payload: { conversationId?: string }): string | null =>
      payload.conversationId && payload.conversationId === activeIdRef.current ? payload.conversationId : null;

    const refreshAfterReconnect = (): void => {
      void refreshConversations();
      if (activeIdRef.current) void threadRef.current.mergeLatest(activeIdRef.current).catch(() => undefined);
    };
    const recoverWhenVisible = (): void => {
      if (document.visibilityState === 'hidden') return;
      if (!socket?.connected) socket?.connect();
      refreshAfterReconnect();
    };

    socket.on('connect', refreshAfterReconnect);
    socket.on('chat:conversation:new', () => void refreshConversations());
    socket.on('chat:conversation:updated', (payload: { id?: string; removed?: boolean }) => {
      void refreshConversations();
      if (payload.id && payload.id === activeIdRef.current) {
        // Removed from the group I'm currently viewing: back out of it.
        if (payload.removed) {
          activeIdRef.current = null;
          setActiveIdState(null);
          threadRef.current.reset();
        } else void threadRef.current.mergeLatest(payload.id).catch(() => undefined);
      }
    });
    socket.on('chat:message:new', (payload: { conversationId?: string; id?: string }) => {
      void refreshConversations();
      const conversationId = active(payload);
      if (!conversationId || !payload.id) return;
      void threadRef.current.arrived(conversationId, payload.id).then((appended) => {
        if (appended && document.visibilityState !== 'hidden') {
          void markConversationRead(conversationId).then(() => window.dispatchEvent(new Event(CHAT_UNREAD_CHANGED_EVENT))).catch(() => undefined);
        }
      });
    });
    const refreshOne = (payload: { conversationId?: string; id?: string }): void => {
      const conversationId = active(payload);
      if (conversationId && payload.id) void threadRef.current.refreshOne(conversationId, payload.id);
    };
    socket.on('chat:message:unsent', (payload: { conversationId?: string; id?: string }) => {
      void refreshConversations();
      refreshOne(payload);
      if (active(payload)) setPinsVersion((version) => version + 1);
    });
    socket.on('chat:message:edited', (payload: { conversationId?: string; id?: string }) => {
      void refreshConversations();
      refreshOne(payload);
      if (active(payload)) setPinsVersion((version) => version + 1);
    });
    socket.on('chat:message:updated', refreshOne);
    socket.on('chat:message:reaction', refreshOne);
    socket.on('chat:message:pinned', (payload: { conversationId?: string; id?: string }) => {
      refreshOne(payload);
      void refreshConversations();
      if (active(payload)) setPinsVersion((version) => version + 1);
    });
    socket.on('chat:message:read', (payload: { conversationId?: string }) => {
      const conversationId = active(payload);
      if (conversationId) void threadRef.current.mergeLatest(conversationId).catch(() => undefined);
    });
    socket.on('chat:presence', () => invalidatePresence());
    socket.on('chat:scheduled:updated', () => setScheduledVersion((version) => version + 1));
    socket.on('chat:typing', (payload: { conversationId?: string; userId?: string; state?: 'start' | 'stop' }) => {
      if (!payload.conversationId || payload.conversationId !== activeIdRef.current || !payload.userId) return;
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
    // The server closes a socket when its access token expires (and when
    // permissions change). socket.io never retries those by itself: touch the
    // API, which refreshes the token, then reconnect — otherwise messages stop
    // arriving live and this person looks offline to everyone.
    socket.on('disconnect', (reason) => {
      if (reason !== 'io server disconnect') return;
      retry = setTimeout(() => {
        void refreshConversations().finally(() => socket?.connect());
      }, 1_000);
    });
    socketRef.current = socket;

    document.addEventListener('visibilitychange', recoverWhenVisible);
    window.addEventListener('pageshow', recoverWhenVisible);

    const poll = setInterval(() => {
      if (!socket?.connected) refreshAfterReconnect();
    }, POLL_FALLBACK_MS);

    return () => {
      clearInterval(poll);
      document.removeEventListener('visibilitychange', recoverWhenVisible);
      window.removeEventListener('pageshow', recoverWhenVisible);
      if (retry) clearTimeout(retry);
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
      socket?.close();
      socket = null;
      socketRef.current = null;
    };
    // Deliberately []: refreshConversations/threadRef/activeIdRef are stable
    // across renders; re-subscribing the socket on every change would thrash it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const notifyTyping = useCallback((state: 'start' | 'stop'): void => {
    if (activeId && socketRef.current?.connected) socketRef.current.emit('chat:typing', { conversationId: activeId, state });
  }, [activeId]);

  return {
    conversations,
    activeId,
    setActiveId,
    messages: thread.messages,
    hasMore: thread.hasMore,
    hasNewer: thread.hasNewer,
    newMessagesBelow: thread.newMessagesBelow,
    loadingMessages: thread.loadingMessages,
    typingUsers,
    error,
    refreshConversations,
    openConversation,
    loadMoreMessages,
    loadNewerMessages,
    jumpToLatest,
    jumpToMessage,
    notifyTyping,
    applyOptimisticMessage,
    replaceMessage,
    refreshMessage,
    pinsVersion,
    scheduledVersion,
  };
}
