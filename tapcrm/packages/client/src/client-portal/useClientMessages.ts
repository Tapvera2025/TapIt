import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { ChatMessage, Conversation } from '../chat/api/chatApi.js';
import { identityApiBasePath, getIdentityAccessToken } from '../identity/api/authApi.js';
import { getProjectDiscussionMessages, listClientProjectDiscussions, markProjectDiscussionRead } from './api/projectDiscussionApi.js';

export const CLIENT_CHAT_UNREAD_CHANGED_EVENT = 'tapcrm:client-chat-unread-changed';
interface ClientDiscussion { projectId: string; projectName: string; conversation: Conversation }

export function useClientMessages() {
  const [discussions, setDiscussions] = useState<ClientDiscussion[]>([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const activeRef = useRef<string | null>(null);
  const discussionRef = useRef(new Map<string, ClientDiscussion>());
  const socketRef = useRef<ReturnType<typeof io> | null>(null);
  activeRef.current = activeId;

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
        setMessages([]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load messages.');
    } finally {
      setLoaded(true);
    }
  }, []);

  const loadMessages = useCallback(async (conversationId: string, cursor?: string) => {
    const entry = discussionRef.current.get(conversationId);
    if (!entry) { setError('This project discussion is no longer available.'); return; }
    setLoadingMessages(true);
    try {
      const page = await getProjectDiscussionMessages(entry.projectId, conversationId, { limit: 30, ...(cursor ? { cursor } : {}) });
      if (cursor) setMessages((current) => [...[...page.messages].reverse(), ...current]);
      else setMessages([...page.messages].reverse());
      setNextCursor(page.nextCursor);
      if (!cursor) {
        await markProjectDiscussionRead(entry.projectId, conversationId);
        void refreshConversations();
      }
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load messages.');
    } finally {
      setLoadingMessages(false);
    }
  }, [refreshConversations]);

  const openConversation = useCallback(async (id: string) => {
    if (!discussionRef.current.has(id)) return;
    activeRef.current = id;
    setActiveIdState(id);
    setTypingUsers([]);
    await loadMessages(id);
  }, [loadMessages]);
  const setActiveId = useCallback((id: string | null) => {
    activeRef.current = id;
    setActiveIdState(id);
  }, []);
  const loadMoreMessages = useCallback(async () => {
    if (activeRef.current && nextCursor && !loadingMessages) await loadMessages(activeRef.current, nextCursor);
  }, [loadMessages, loadingMessages, nextCursor]);
  const applyOptimisticMessage = useCallback((message: ChatMessage) => setMessages((current) => [...current, message]), []);
  const replaceMessage = useCallback((message: ChatMessage) => setMessages((current) => current.map((item) => item.id === message.id ? message : item)), []);
  const notifyTyping = useCallback((state: 'start' | 'stop') => {
    if (activeId && socketRef.current?.connected) socketRef.current.emit('chat:typing', { conversationId: activeId, state });
  }, [activeId]);

  useEffect(() => { void refreshConversations(); }, [refreshConversations]);
  useEffect(() => {
    const socket = io({ path: `${identityApiBasePath()}/socket.io`, auth: (send) => send({ token: getIdentityAccessToken() ?? '' }), reconnectionDelayMax: 30_000 });
    socketRef.current = socket;
    const onMessageChange = (payload: { conversationId?: string }) => {
      void refreshConversations();
      if (payload.conversationId && payload.conversationId === activeRef.current) void loadMessages(payload.conversationId);
    };
    socket.on('chat:message:new', onMessageChange);
    socket.on('chat:message:unsent', onMessageChange);
    socket.on('chat:message:reaction', onMessageChange);
    socket.on('chat:message:read', onMessageChange);
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
    const poll = window.setInterval(() => { if (!socket.connected) { void refreshConversations(); if (activeRef.current) void loadMessages(activeRef.current); } }, 60_000);
    return () => { window.clearInterval(poll); socket.close(); socketRef.current = null; };
  }, [currentUserId, loadMessages, refreshConversations, setActiveId]);

  const conversations = discussions.map(({ conversation, projectName }) => ({ ...conversation, name: conversation.name || projectName }));
  const projectIdForConversation = (conversationId: string): string | null => discussionRef.current.get(conversationId)?.projectId ?? null;
  return {
    conversations, currentUserId, projectIdForConversation, loaded, activeId, setActiveId, messages,
    hasMore: nextCursor !== null, loadingMessages, typingUsers, error, refreshConversations,
    openConversation, loadMoreMessages, notifyTyping, applyOptimisticMessage, replaceMessage,
  };
}
