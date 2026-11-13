import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { ChatMessage, Conversation } from '../chat/api/chatApi.js';
import { mergeMessages, useThreadState, type ChatController } from '../chat/useChat.js';
import { identityApiBasePath, getIdentityAccessToken } from '../identity/api/authApi.js';
import { getProjectDiscussionMessage, getProjectDiscussionMessages, listClientProjectDiscussions, markProjectDiscussionRead } from './api/projectDiscussionApi.js';

export const CLIENT_CHAT_UNREAD_CHANGED_EVENT = 'tapcrm:client-chat-unread-changed';
interface ClientDiscussion { projectId: string; projectName: string; conversation: Conversation }

export function useClientMessages(): ChatController & { currentUserId: string; loaded: boolean; projectIdForConversation: (conversationId: string) => string | null } {
  const [discussions, setDiscussions] = useState<ClientDiscussion[]>([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [pinsVersion, setPinsVersion] = useState(0);
  const activeRef = useRef<string | null>(null);
  const discussionRef = useRef(new Map<string, ClientDiscussion>());
  const socketRef = useRef<ReturnType<typeof io> | null>(null);
  activeRef.current = activeId;

  const projectFor = useCallback((conversationId: string): string => {
    const entry = discussionRef.current.get(conversationId);
    if (!entry) throw new Error('This project discussion is no longer available.');
    return entry.projectId;
  }, []);

  const thread = useThreadState(
    useCallback((conversationId: string, options: { limit?: number; cursor?: string; after?: string; around?: string }) =>
      getProjectDiscussionMessages(projectFor(conversationId), conversationId, options), [projectFor]),
    useCallback((conversationId: string, messageId: string) =>
      getProjectDiscussionMessage(projectFor(conversationId), conversationId, messageId), [projectFor]),
  );
  const threadRef = useRef(thread);
  threadRef.current = thread;

  const refreshConversations = useCallback(async () => {
    try {
      const result = await listClientProjectDiscussions();
      setCurrentUserId(result.currentUserId);
      const authorized = result.discussions.filter((entry) => entry.conversation.kind === 'project'
        && entry.conversation.projectId === entry.projectId
        && entry.conversation.members.some((member) => member.userId === result.currentUserId));
      discussionRef.current = new Map(authorized.map((entry) => [entry.conversation.id, entry]));
      setDiscussions(authorized);
      setError('');
      const unread = authorized.reduce((sum, entry) => sum + entry.conversation.unreadCount, 0);
      window.dispatchEvent(new CustomEvent(CLIENT_CHAT_UNREAD_CHANGED_EVENT, { detail: { unread } }));
      if (activeRef.current && !discussionRef.current.has(activeRef.current)) {
        activeRef.current = null;
        setActiveIdState(null);
        threadRef.current.reset();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load messages.');
    } finally {
      setLoaded(true);
    }
  }, []);

  const markRead = useCallback(async (conversationId: string) => {
    const entry = discussionRef.current.get(conversationId);
    if (!entry) return;
    await markProjectDiscussionRead(entry.projectId, conversationId).catch(() => undefined);
    void refreshConversations();
  }, [refreshConversations]);

  const loadMessages = useCallback(async (conversationId: string, aroundMessageId?: string) => {
    if (!discussionRef.current.has(conversationId)) { setError('This project discussion is no longer available.'); return; }
    const current = threadRef.current;
    current.setLoadingMessages(true);
    try {
      if (aroundMessageId) await current.loadAround(conversationId, aroundMessageId).catch(() => current.loadLatest(conversationId));
      else await current.loadLatest(conversationId);
      await markRead(conversationId);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load messages.');
    } finally {
      current.setLoadingMessages(false);
    }
  }, [markRead]);

  const openConversation = useCallback(async (id: string, options: { aroundMessageId?: string | undefined } = {}) => {
    if (!discussionRef.current.has(id)) return;
    if (activeRef.current !== id) threadRef.current.reset();
    activeRef.current = id;
    setActiveIdState(id);
    setTypingUsers([]);
    await loadMessages(id, options.aroundMessageId);
  }, [loadMessages]);

  const setActiveId = useCallback((id: string | null) => {
    activeRef.current = id;
    setActiveIdState(id);
    if (id === null) threadRef.current.reset();
  }, []);

  const loadMoreMessages = useCallback(async () => {
    if (activeRef.current) await threadRef.current.loadOlder(activeRef.current).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load more messages.'));
  }, []);
  const loadNewerMessages = useCallback(async () => {
    if (activeRef.current) await threadRef.current.loadNewer(activeRef.current).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load newer messages.'));
  }, []);
  const jumpToLatest = useCallback(async () => {
    if (activeRef.current) await loadMessages(activeRef.current);
  }, [loadMessages]);
  const jumpToMessage = useCallback(async (messageId: string) => {
    const conversationId = activeRef.current;
    if (!conversationId) return false;
    if (threadRef.current.messages.some((message) => message.id === messageId)) return true;
    try {
      await threadRef.current.loadAround(conversationId, messageId);
      return true;
    } catch {
      return false;
    }
  }, []);
  const applyOptimisticMessage = useCallback((message: ChatMessage) => {
    if (threadRef.current.hasNewer && activeRef.current) {
      void loadMessages(activeRef.current);
      return;
    }
    threadRef.current.setMessages((current) => mergeMessages(current, [message]));
  }, [loadMessages]);
  const replaceMessage = useCallback((message: ChatMessage) => {
    threadRef.current.setMessages((current) => current.map((item) => (item.id === message.id ? message : item)));
  }, []);
  const refreshMessage = useCallback(async (messageId: string) => {
    if (activeRef.current) await threadRef.current.refreshOne(activeRef.current, messageId);
  }, []);
  const projectIdForConversation = useCallback((conversationId: string): string | null => discussionRef.current.get(conversationId)?.projectId ?? null, []);
  const notifyTyping = useCallback((state: 'start' | 'stop') => {
    if (activeId && socketRef.current?.connected) socketRef.current.emit('chat:typing', { conversationId: activeId, state });
  }, [activeId]);

  useEffect(() => { void refreshConversations(); }, [refreshConversations]);
  useEffect(() => {
    const socket = io({ path: `${identityApiBasePath()}/socket.io`, auth: (send) => send({ token: getIdentityAccessToken() ?? '' }), reconnectionDelayMax: 30_000 });
    socketRef.current = socket;
    const isActive = (payload: { conversationId?: string }) => payload.conversationId !== undefined && payload.conversationId === activeRef.current;
    const refreshAfterReconnect = (): void => {
      void refreshConversations();
      if (activeRef.current) void threadRef.current.mergeLatest(activeRef.current).catch(() => undefined);
    };
    const recoverWhenVisible = (): void => {
      if (document.visibilityState === 'hidden') return;
      if (!socket.connected) socket.connect();
      refreshAfterReconnect();
    };
    socket.on('connect', refreshAfterReconnect);
    socket.on('chat:message:new', (payload: { conversationId?: string; id?: string }) => {
      void refreshConversations();
      if (isActive(payload) && payload.id) {
        const conversationId = payload.conversationId!;
        void threadRef.current.arrived(conversationId, payload.id).then((appended) => {
          if (appended) void markRead(conversationId);
        });
      }
    });
    const refreshOne = (payload: { conversationId?: string; id?: string }) => {
      if (isActive(payload) && payload.id) void threadRef.current.refreshOne(payload.conversationId!, payload.id);
    };
    socket.on('chat:message:unsent', (payload: { conversationId?: string; id?: string }) => {
      void refreshConversations();
      refreshOne(payload);
      if (isActive(payload)) setPinsVersion((version) => version + 1);
    });
    socket.on('chat:message:edited', (payload: { conversationId?: string; id?: string }) => {
      void refreshConversations();
      refreshOne(payload);
    });
    socket.on('chat:message:updated', refreshOne);
    socket.on('chat:message:reaction', refreshOne);
    socket.on('chat:message:pinned', (payload: { conversationId?: string; id?: string }) => {
      refreshOne(payload);
      if (isActive(payload)) setPinsVersion((version) => version + 1);
    });
    socket.on('chat:message:read', (payload: { conversationId?: string }) => {
      if (isActive(payload)) void threadRef.current.mergeLatest(payload.conversationId!).catch(() => undefined);
    });
    socket.on('chat:conversation:new', () => void refreshConversations());
    socket.on('chat:conversation:updated', (payload: { id?: string; removed?: boolean }) => {
      void refreshConversations();
      if (payload.id === activeRef.current && payload.removed) setActiveId(null);
    });
    socket.on('chat:typing', (payload: { conversationId?: string; userId?: string; state?: 'start' | 'stop' }) => {
      if (!payload.conversationId || payload.conversationId !== activeRef.current || !payload.userId || payload.userId === currentUserId) return;
      setTypingUsers((current) => payload.state === 'start'
        ? (current.includes(payload.userId!) ? current : [...current, payload.userId!])
        : current.filter((id) => id !== payload.userId));
    });
    // Closed by the server when the access token expires; socket.io does not
    // retry that itself. Fetching refreshes the token, then reconnect.
    let retry: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    socket.on('disconnect', (reason) => {
      if (reason !== 'io server disconnect') return;
      retry = setTimeout(() => {
        void refreshConversations().finally(() => {
          if (!disposed) socket.connect();
        });
      }, 1_000);
    });
    const poll = window.setInterval(() => { if (!socket.connected) refreshAfterReconnect(); }, 15_000);
    document.addEventListener('visibilitychange', recoverWhenVisible);
    window.addEventListener('pageshow', recoverWhenVisible);
    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', recoverWhenVisible);
      window.removeEventListener('pageshow', recoverWhenVisible);
      socket.close();
      socketRef.current = null;
    };
  }, [currentUserId, markRead, refreshConversations, setActiveId]);

  const conversations = discussions.map(({ conversation, projectName }) => ({ ...conversation, name: conversation.name || projectName }));
  return {
    conversations, currentUserId, projectIdForConversation, loaded, activeId, setActiveId,
    messages: thread.messages, hasMore: thread.hasMore, hasNewer: thread.hasNewer, newMessagesBelow: thread.newMessagesBelow,
    loadingMessages: thread.loadingMessages, typingUsers, error, refreshConversations,
    openConversation, loadMoreMessages, loadNewerMessages, jumpToLatest, jumpToMessage, notifyTyping,
    applyOptimisticMessage, replaceMessage, refreshMessage, pinsVersion, scheduledVersion: 0,
  };
}
