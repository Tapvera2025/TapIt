import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, Empty, SkeletonMessageThread } from '../ui/index.js';
import { Icon } from '../ui/index.js';
import {
  QUICK_REACTIONS,
  type ChatMessage,
  type Conversation,
  type ConversationKind,
  type MessageAttachment,
  type MessagePreview,
  type ReactionEmoji,
} from './api/chatApi.js';
import { AttachmentGallery, Lightbox } from './attachments.js';
import { Avatar, GroupAvatar, PresenceLabel } from './Avatar.js';
import { Composer } from './Composer.js';
import { EditHistory } from './EditHistory.js';
import { EmojiPopover } from './emoji/EmojiPicker.js';
import { LinkPreviewCard } from './LinkPreviewCard.js';
import { toPlainText } from './markdown.js';
import { MessageMarkdown } from './MessageMarkdown.js';
import { PinnedBar } from './PinnedBar.js';
import { usePresenceMap } from './presence.js';
import { ScheduledPanel } from './ScheduledPanel.js';
import { companyChatTransport, type ChatTransport } from './transport.js';
import type { ChatController } from './useChat.js';

/** Mirrors the server's edit window (modules/chat/service.ts EDIT_WINDOW_MINUTES). */
export const EDIT_WINDOW_MS = 15 * 60_000;

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dateTimeLabel(iso: string): string {
  return new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const escapeRegExp =(text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
}

/** One line for a conversation list or reply preview: formatting stripped, files described. */
export function previewLine(preview: Pick<MessagePreview, 'body' | 'deletedAt' | 'attachmentCount' | 'firstAttachment'>): string {
  if (preview.deletedAt) return 'Message unsent';
  const text = toPlainText(preview.body ?? '');
  if (text) return (preview.attachmentCount ?? 0) > 0 ? `📎 ${text}` : text;
  const count = preview.attachmentCount ?? 0;
  if (count > 1) return `📎 ${count} files`;
  if (count === 1 && preview.firstAttachment) return preview.firstAttachment.kind === 'image' ? '📷 Photo' : `📎 ${preview.firstAttachment.fileName}`;
  return '';
}

const CHAT_LIST_MIN_WIDTH = 220;
const CHAT_LIST_MAX_WIDTH = 520;
const clampChatListWidth = (width: number): number =>
  Math.max(CHAT_LIST_MIN_WIDTH, Math.min(CHAT_LIST_MAX_WIDTH, width));
const CHAT_LIST_DEFAULT_WIDTH = typeof window === 'undefined'
  ? 320
  : Math.min(380, Math.max(CHAT_LIST_MIN_WIDTH, Math.round(window.innerWidth * 0.18)));

type MenuAction = 'reply' | 'react' | 'edit' | 'copy' | 'forward' | 'pin' | 'save' | 'unsend';

/**
 * The conversation list + thread, shared by every tab (Direct Messages,
 * Internal Groups, Project Groups) and the client portal. What differs
 * between tabs — how a conversation is labelled, what "New" does, whether
 * there is a management panel — is passed in by the page that owns this
 * component; what differs between company and client is the transport.
 * The messaging mechanics (send with files, format, reply, edit, forward,
 * react, pin, save, schedule, unsend, typing, seen, pagination, jumping to
 * a message) live here exactly once.
 */
export function ConversationWorkspace({
  chat,
  kind,
  currentUserId,
  title,
  emptyHint,
  conversationLabel,
  onNewClick,
  newLabel = 'New',
  headerExtra,
  hideList = false,
  initialConversationId,
  initialMessageId,
  initialNonce = 0,
  transport = companyChatTransport,
  clientMode = false,
}: {
  /** Owned by the page (not this component), so the page's own "New" flow can drive the same instance. */
  chat: ChatController;
  kind: ConversationKind;
  currentUserId: string;
  title: string;
  emptyHint: string;
  conversationLabel: (conversation: Conversation) => string;
  /** Omit to hide the "New" button entirely (e.g. a non-admin viewing Internal Groups). */
  onNewClick?: () => void;
  newLabel?: string;
  headerExtra?: (conversation: Conversation) => ReactNode;
  /** A project's Discussions tab has exactly one conversation to show — no list needed. */
  hideList?: boolean;
  /** A deep link (notification, search result, saved message): open this conversation. */
  initialConversationId?: string | undefined;
  /** …and scroll to and highlight this message (loading the history around it if needed). */
  initialMessageId?: string | undefined;
  /** Changes when the same link is followed again. */
  initialNonce?: number;
  transport?: ChatTransport;
  /** Client portal discussions share the thread UI but omit company-only actions. */
  clientMode?: boolean;
}): React.JSX.Element {
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<ChatMessage | null>(null);
  const [reactingMessageId, setReactingMessageId] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<{ messageId: string; anchor: DOMRect } | null>(null);
  const [reactionDetail, setReactionDetail] = useState<{ messageId: string; emoji: string } | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [openActionsFor, setOpenActionsFor] = useState<string | null>(null);
  const [actionMenuPosition, setActionMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [chatListWidth, setChatListWidth] = useState(CHAT_LIST_DEFAULT_WIDTH);
  const chatListResizeStartRef = useRef<{ x: number; width: number } | null>(null);
  const [isResizingChatList, setIsResizingChatList] = useState(false);
  const [seenDetailFor, setSeenDetailFor] = useState<string | null>(null);
  const [infoMessageId, setInfoMessageId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState('');
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
  const [swipeReply, setSwipeReply] = useState<{ id: string; offset: number } | null>(null);
  const [lightbox, setLightbox] = useState<{ images: MessageAttachment[]; index: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [nearBottom, setNearBottom] = useState(true);
  const [localPinsVersion, setLocalPinsVersion] = useState(0);
  const [localScheduledVersion, setLocalScheduledVersion] = useState(0);
  const threadScrollRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageSwipeRef = useRef<{ id: string; x: number; y: number; mine: boolean } | null>(null);
  const highlightTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDeepLinkRef = useRef<string | null>(null);
  const fileDropRef = useRef<((files: File[]) => void) | null>(null);
  const dragDepth = useRef(0);
  const scrollMemo = useRef<{ conversationId: string | null; first: string | null; last: string | null; height: number }>({ conversationId: null, first: null, last: null, height: 0 });
  const openConversation = chat.openConversation;
  const presence = usePresenceMap(transport.presence && !clientMode);

  const fail = useCallback((message: string) => setActionError(message), []);
  useEffect(() => {
    if (!actionError) return undefined;
    const timer = setTimeout(() => setActionError(''), 6000);
    return () => clearTimeout(timer);
  }, [actionError]);

  const startChatListResize = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (!window.matchMedia('(min-width: 768px)').matches || event.button !== 0 || event.pointerType === 'touch') return;
    event.preventDefault();
    chatListResizeStartRef.current = { x: event.clientX, width: chatListWidth };
    setIsResizingChatList(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const resizeChatList = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const start = chatListResizeStartRef.current;
    if (!start) return;
    setChatListWidth(clampChatListWidth(start.width + event.clientX - start.x));
  };

  const stopChatListResize = (event?: React.PointerEvent<HTMLButtonElement>): void => {
    chatListResizeStartRef.current = null;
    setIsResizingChatList(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if (event && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const resizeChatListWithKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    setChatListWidth((width) => clampChatListWidth(width + (event.key === 'ArrowRight' ? 16 : -16)));
  };

  /* ------------------------------------------------------------ scrolling */

  // Opening a conversation lands at the bottom; a message arriving keeps you
  // at the bottom if you were there (or sent it); older pages loading above
  // keep what you were reading in place. While you are at the bottom, late
  // layout (images, link-preview cards) keeps you there too.
  const stickToBottom = useRef(true);
  const listRef = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    const thread = threadScrollRef.current;
    const memo = scrollMemo.current;
    const first = chat.messages[0]?.id ?? null;
    const last = chat.messages[chat.messages.length - 1] ?? null;
    if (!thread) return;
    const opened = memo.conversationId !== chat.activeId || (memo.last === null && last !== null);
    if (opened) {
      stickToBottom.current = !pendingScrollId;
      if (!pendingScrollId) thread.scrollTop = thread.scrollHeight;
    } else if (first !== memo.first && last?.id === memo.last && memo.height > 0) {
      thread.scrollTop += thread.scrollHeight - memo.height;
    } else if (last && last.id !== memo.last && !pendingScrollId) {
      const distance = memo.height - thread.scrollTop - thread.clientHeight;
      if (distance < 160 || last.senderId === currentUserId) {
        thread.scrollTop = thread.scrollHeight;
        stickToBottom.current = true;
      }
    }
    scrollMemo.current = { conversationId: chat.activeId, first, last: last?.id ?? null, height: thread.scrollHeight };
  }, [chat.messages, chat.activeId, currentUserId, pendingScrollId]);

  useEffect(() => {
    const list = listRef.current;
    const thread = threadScrollRef.current;
    if (!list || !thread || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current) thread.scrollTop = thread.scrollHeight;
      scrollMemo.current = { ...scrollMemo.current, height: thread.scrollHeight };
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [chat.activeId, chat.loadingMessages]);

  useEffect(() => () => {
    if (highlightTimeout.current) clearTimeout(highlightTimeout.current);
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
  }, []);

  // Clicking anywhere that isn't one of the popovers themselves closes
  // whichever of them is open — including clicking empty space in the thread.
  useEffect(() => {
    const closeOpenPopovers = (event: MouseEvent): void => {
      if ((event.target as HTMLElement).closest('[data-chat-popover]')) return;
      setReactionDetail(null);
      setSeenDetailFor(null);
      setHistoryFor(null);
      setOpenActionsFor(null);
      setActionMenuPosition(null);
      setReactingMessageId(null);
    };
    const closeActionsOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpenActionsFor(null);
        setActionMenuPosition(null);
        setReactingMessageId(null);
        setHistoryFor(null);
      }
    };
    document.addEventListener('mousedown', closeOpenPopovers);
    document.addEventListener('keydown', closeActionsOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOpenPopovers);
      document.removeEventListener('keydown', closeActionsOnEscape);
    };
  }, []);

  const highlight = (messageId: string): void => {
    const el = document.getElementById(`chat-message-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (highlightTimeout.current) clearTimeout(highlightTimeout.current);
    setHighlightedMessageId(messageId);
    highlightTimeout.current = setTimeout(() => setHighlightedMessageId(null), 1600);
  };

  /** Scroll to a message, loading the history around it first when it is not on screen. */
  const jumpTo = useCallback(async (messageId: string): Promise<void> => {
    const found = await chat.jumpToMessage(messageId);
    if (!found) {
      setActionError('That message is no longer available.');
      return;
    }
    setPendingScrollId(messageId);
  }, [chat]);

  useEffect(() => {
    if (!pendingScrollId) return;
    stickToBottom.current = false;
    if (!chat.messages.some((m) => m.id === pendingScrollId)) return;
    const id = pendingScrollId;
    requestAnimationFrame(() => {
      highlight(id);
      setPendingScrollId(null);
    });
  }, [pendingScrollId, chat.messages]);

  useEffect(() => {
    // Keyed on the link itself (and its nonce), so following a second link —
    // or the same one again — while this component stays mounted still works.
    if (!initialConversationId) return;
    const key = `${initialConversationId}|${initialMessageId ?? ''}|${initialNonce}`;
    if (lastDeepLinkRef.current === key) return;
    lastDeepLinkRef.current = key;
    if (initialMessageId) setPendingScrollId(initialMessageId);
    if (chat.activeId === initialConversationId && initialMessageId) {
      void chat.jumpToMessage(initialMessageId);
    } else {
      void openConversation(initialConversationId, { aroundMessageId: initialMessageId });
    }
    // chat.activeId/jumpToMessage are read at the moment the link arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConversationId, initialMessageId, initialNonce, openConversation]);

  const activeConversation = useMemo(
    () => chat.conversations.find((c) => c.id === chat.activeId) ?? null,
    [chat.conversations, chat.activeId],
  );

  // A different conversation: drop reply/edit state that belonged to the last one.
  useEffect(() => {
    setReplyTo(null);
    setEditing(null);
    setLightbox(null);
  }, [chat.activeId]);

  const memberName = useCallback((userId: string): string => {
    if (userId === currentUserId) return 'You';
    return activeConversation?.members.find((m) => m.userId === userId)?.fullName ?? 'Someone';
  }, [activeConversation, currentUserId]);

  const otherMember = (conversation: Conversation) => conversation.members.find((m) => m.userId !== currentUserId) ?? null;

  /* -------------------------------------------------------------- actions */

  const copyText = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard unavailable — nothing to fall back to worth doing here */
    }
  };

  const canEdit = (message: ChatMessage): boolean =>
    message.senderId === currentUserId && !message.deletedAt && !message.forwarded && Date.now() - new Date(message.createdAt).getTime() < EDIT_WINDOW_MS;

  const menuActions = (message: ChatMessage, mine: boolean): MenuAction[] => {
    const actions: MenuAction[] = ['reply', 'react'];
    if (canEdit(message)) actions.push('edit');
    if (message.body) actions.push('copy');
    if (!clientMode && transport.forwardMessage) actions.push('forward');
    if (!clientMode && transport.pinMessage) actions.push('pin');
    if (!clientMode && transport.saveMessage) actions.push('save');
    if (!clientMode && mine && transport.unsendMessage) actions.push('unsend');
    return actions;
  };

  const setMessageActionsPosition = (message: ChatMessage, mine: boolean, anchor: DOMRect): void => {
    const menuWidth = 176;
    const menuHeight = menuActions(message, mine).length * 32 + 10;
    const belowTop = anchor.bottom + 4 + (message.reactions.length > 0 ? 20 : 0);
    const top = belowTop + menuHeight <= window.innerHeight - 8
      ? belowTop
      : Math.max(8, anchor.top - menuHeight - 4);
    const left = mine
      ? Math.max(8, anchor.right - menuWidth)
      : Math.min(Math.max(8, anchor.left), window.innerWidth - menuWidth - 8);
    setActionMenuPosition({ top, left });
    setOpenActionsFor(message.id);
  };

  const toggleMessageActions = (message: ChatMessage, mine: boolean, event: React.MouseEvent<HTMLButtonElement>): void => {
    if (openActionsFor === message.id) {
      setOpenActionsFor(null);
      setActionMenuPosition(null);
      return;
    }
    setMessageActionsPosition(message, mine, event.currentTarget.getBoundingClientRect());
  };

  const closeMenu = (): void => {
    setOpenActionsFor(null);
    setActionMenuPosition(null);
  };

  const runMessageAction = async (action: () => Promise<ChatMessage | undefined>, failure: string): Promise<void> => {
    try {
      const updated = await action();
      if (updated) chat.replaceMessage(updated);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : failure);
    }
  };

  const onMenuAction = (action: MenuAction, message: ChatMessage): void => {
    closeMenu();
    switch (action) {
      case 'reply':
        setEditing(null);
        setReplyTo(message);
        break;
      case 'react':
        setReactingMessageId(message.id);
        break;
      case 'edit':
        setReplyTo(null);
        setEditing(message);
        break;
      case 'copy':
        void copyText(message.body ?? '');
        break;
      case 'forward':
        setForwardingMessage(message);
        break;
      case 'pin':
        void runMessageAction(async () => {
          const updated = message.pinnedAt ? await transport.unpinMessage?.(message.id) : await transport.pinMessage?.(message.id);
          setLocalPinsVersion((version) => version + 1);
          return updated;
        }, 'Unable to change the pin.');
        break;
      case 'save':
        void runMessageAction(() => (message.saved ? transport.unsaveMessage?.(message.id) : transport.saveMessage?.(message.id)) ?? Promise.resolve(undefined), 'Unable to save the message.');
        break;
      case 'unsend':
        void runMessageAction(async () => {
          const updated = await transport.unsendMessage?.(message.id);
          setLocalPinsVersion((version) => version + 1);
          return updated;
        }, 'Unable to unsend message.');
        break;
      default:
        break;
    }
  };

  const clearLongPress = (): void => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  const clearMessageSwipe = (): void => {
    messageSwipeRef.current = null;
    setSwipeReply(null);
  };

  const startMessageLongPress = (event: React.PointerEvent<HTMLDivElement>, message: ChatMessage, mine: boolean): void => {
    if (event.pointerType !== 'touch' || !window.matchMedia('(max-width: 767px)').matches || (event.target as HTMLElement).closest('button, a')) return;
    clearLongPress();
    event.currentTarget.setPointerCapture(event.pointerId);
    messageSwipeRef.current = { id: message.id, x: event.clientX, y: event.clientY, mine };
    const bubble = event.currentTarget;
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      const thread = threadScrollRef.current;
      const bubbleBounds = bubble.getBoundingClientRect();
      const threadBounds = thread?.getBoundingClientRect();
      if (thread && threadBounds && bubbleBounds.top < threadBounds.top + 16) {
        thread.scrollBy({ top: bubbleBounds.top - threadBounds.top - 16, behavior: 'auto' });
      }
      requestAnimationFrame(() => setMessageActionsPosition(message, mine, bubble.getBoundingClientRect()));
    }, 520);
  };

  const moveMessageSwipe = (event: React.PointerEvent<HTMLDivElement>, message: ChatMessage): void => {
    const gesture = messageSwipeRef.current;
    if (!gesture || gesture.id !== message.id) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) return;
    clearLongPress();
    setSwipeReply({ id: message.id, offset: Math.max(-72, Math.min(72, dx)) });
  };

  const finishMessageSwipe = (event: React.PointerEvent<HTMLDivElement>, message: ChatMessage): void => {
    const gesture = messageSwipeRef.current;
    clearLongPress();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!gesture || gesture.id !== message.id) {
      clearMessageSwipe();
      return;
    }
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (Math.abs(dx) >= 56 && Math.abs(dx) > Math.abs(dy)) {
      setEditing(null);
      setReplyTo(message);
      closeMenu();
    }
    clearMessageSwipe();
  };

  /** Several reactions per person (product decision): each emoji toggles independently. */
  const toggleReaction = async (message: ChatMessage, emoji: ReactionEmoji): Promise<void> => {
    setReactingMessageId(null);
    setReactionDetail(null);
    setPickerFor(null);
    const mineAlready = message.reactions.some((r) => r.userId === currentUserId && r.emoji === emoji);
    await runMessageAction(
      () => (mineAlready
        ? transport.removeReaction(message.conversationId, message.id, emoji)
        : transport.reactToMessage(message.conversationId, message.id, emoji)),
      'Unable to react.',
    );
  };

  const onForward = async (targetConversationId: string): Promise<void> => {
    if (!forwardingMessage || !transport.forwardMessage) return;
    try {
      await transport.forwardMessage(forwardingMessage.id, targetConversationId);
      setForwardingMessage(null);
      if (targetConversationId === chat.activeId) await chat.jumpToLatest();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Unable to forward message.');
    }
  };

  const editLast = (): void => {
    const last = [...chat.messages].reverse().find((message) => canEdit(message));
    if (last) {
      setReplyTo(null);
      setEditing(last);
    }
  };

  /* --------------------------------------------------------- drag & drop */

  const hasFiles = (event: React.DragEvent): boolean => [...event.dataTransfer.types].includes('Files');
  const onDragEnter = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!hasFiles(event) || editing) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragLeave = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!hasFiles(event)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    fileDropRef.current?.([...event.dataTransfer.files]);
  };

  /* -------------------------------------------------------------- render */

  const renderMeta = (message: ChatMessage, mine: boolean, invisible: boolean): ReactNode => (
    <>
      {message.pinnedAt && <Icon name="pushpin" className="size-3 text-app-accent" />}
      {message.saved && <Icon name="bookmark" filled className="size-3 text-[#f59e0b]" />}
      {message.editedAt && (invisible ? <span>edited</span> : (
        <span data-chat-popover className="relative">
          <button type="button" onClick={() => setHistoryFor(historyFor === message.id ? null : message.id)} className="hover:text-app-accent hover:underline" aria-label="View edit history">
            edited
          </button>
          {historyFor === message.id && <EditHistory message={message} transport={transport} align={mine ? 'right' : 'left'} />}
        </span>
      ))}
      {invisible ? timeLabel(message.createdAt) : <time dateTime={message.createdAt}>{timeLabel(message.createdAt)}</time>}
      {mine && message.seenBy.length > 0 && (invisible ? ' ✓✓' : (
        <span data-chat-popover className="relative">
          <button
            type="button"
            onClick={() => setSeenDetailFor(seenDetailFor === message.id ? null : message.id)}
            aria-label="View message read receipts"
            className="flex items-center text-app-accent hover:text-app-accent"
          >
            <Icon name="check" className="size-3.5" />
            <Icon name="check" className="-ml-2 size-3.5" />
          </button>
          {seenDetailFor === message.id && (
            <div className="absolute bottom-full right-0 z-10 mb-1 min-w-max rounded-lg border border-app-border bg-app-surface px-2 py-1 text-[11px] text-app-muted shadow-lg">
              {message.seenBy.map((userId) => {
                const member = activeConversation?.members.find((m) => m.userId === userId);
                return (
                  <p key={userId} className="whitespace-nowrap">
                    {member?.fullName ?? 'Someone'}
                    {member?.lastReadAt ? ` — ${timeLabel(member.lastReadAt)}` : ''}
                  </p>
                );
              })}
            </div>
          )}
        </span>
      ))}
    </>
  );

  const messageList = chat.messages;
  const scheduledVersion = chat.scheduledVersion + localScheduledVersion;
  const pinsVersion = chat.pinsVersion + localPinsVersion;
  const directOther = activeConversation && kind === 'direct' ? otherMember(activeConversation) : null;

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      {/* Conversation list */}
      {!hideList && (
        <div
          className={`relative flex w-full min-h-0 flex-1 flex-col border-0 bg-transparent outline-none md:h-full md:w-[var(--chat-list-width)] md:flex-none ${chat.activeId ? 'hidden md:flex' : ''} ${isResizingChatList ? 'select-none' : ''}`}
          style={{ '--chat-list-width': `${chatListWidth}px` } as React.CSSProperties}
        >
          <button
            type="button"
            className={`absolute inset-y-0 -right-2 z-20 hidden w-4 cursor-col-resize items-center justify-center md:flex ${isResizingChatList ? 'is-resizing' : ''}`}
            onPointerDown={startChatListResize}
            onPointerMove={resizeChatList}
            onPointerUp={stopChatListResize}
            onPointerCancel={stopChatListResize}
            onKeyDown={resizeChatListWithKeyboard}
            aria-label="Resize conversation list"
            aria-orientation="vertical"
            aria-valuemin={CHAT_LIST_MIN_WIDTH}
            aria-valuemax={CHAT_LIST_MAX_WIDTH}
            aria-valuenow={chatListWidth}
            role="separator"
            title="Drag to resize conversation list"
          >
            <span className={`h-12 w-1 rounded-full bg-app-border transition-colors ${isResizingChatList ? 'bg-app-accent' : 'hover:bg-app-accent/70'}`} aria-hidden="true" />
          </button>
          <div className="flex items-center justify-between gap-2 px-5 py-4">
            <p className="text-sm font-semibold">{title}</p>
            {onNewClick && <Button onClick={onNewClick} className="!px-3 !py-1.5 !text-xs">{newLabel}</Button>}
          </div>
          <div className="mx-4 h-px shrink-0 bg-app-border/70" />
          <div data-lenis-prevent className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {chat.conversations.length === 0 && (
              <div className="px-4">
                <Empty>{emptyHint}</Empty>
              </div>
            )}
            <ul className="px-3">
              {chat.conversations.map((conversation) => {
                const active = conversation.id === chat.activeId;
                const other = kind === 'direct' ? otherMember(conversation) : null;
                const label = conversationLabel(conversation);
                return (
                  <li key={conversation.id} className="border-b border-app-border/70 last:border-b-0">
                    <button
                      type="button"
                      onClick={() => void chat.openConversation(conversation.id)}
                      className={`my-1 flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-app-surface-raised ${active ? 'bg-app-accent/10 text-app-accent' : ''}`}
                    >
                      {other
                        ? <Avatar name={other.fullName} seed={other.userId} presence={presence[other.userId]} size="md" />
                        : <GroupAvatar name={label} seed={conversation.id} size="md" />}
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold">{label}</span>
                          {conversation.unreadCount > 0 && (
                            <span className="shrink-0 rounded-full bg-app-accent px-1.5 py-0.5 text-[10px] font-bold text-app-on-accent">
                              {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
                            </span>
                          )}
                        </span>
                        {conversation.lastMessage && (
                          <span className="mt-0.5 block truncate text-xs text-app-muted">
                            {kind !== 'direct' && !conversation.lastMessage.deletedAt && conversation.lastMessage.senderId !== currentUserId
                              ? `${conversation.members.find((m) => m.userId === conversation.lastMessage?.senderId)?.fullName.split(' ')[0] ?? 'Someone'}: `
                              : conversation.lastMessage.senderId === currentUserId && !conversation.lastMessage.deletedAt ? 'You: ' : ''}
                            {previewLine(conversation.lastMessage)}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {/* Thread */}
      <div
        className={`relative flex min-h-0 min-w-0 flex-1 flex-col ${!hideList ? 'md:before:absolute md:before:inset-y-5 md:before:left-0 md:before:w-px md:before:bg-app-border' : ''} ${!hideList && !chat.activeId ? 'hidden md:flex' : 'flex'}`}
        onDragEnter={onDragEnter}
        onDragOver={(event) => { if (hasFiles(event)) event.preventDefault(); }}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {!chat.activeId ? (
          <div className="grid flex-1 place-items-center text-sm text-app-muted">Select a conversation, or start a new one.</div>
        ) : (
          <>
            <div className={`relative flex shrink-0 items-center justify-between gap-3 px-4 py-3 after:absolute after:bottom-0 after:left-4 after:right-4 after:h-px after:bg-app-border sm:px-5 ${clientMode ? 'bg-app-surface' : ''}`}>
              <div className="flex min-w-0 items-center gap-2.5">
                {!hideList && (
                  <button
                    type="button"
                    onClick={() => chat.setActiveId(null)}
                    className="grid size-8 shrink-0 place-items-center rounded-lg border border-app-border text-app-muted hover:border-app-accent hover:text-app-accent md:hidden"
                    aria-label="Back to conversations"
                  >
                    <Icon name="chevron-left" className="size-4" />
                  </button>
                )}
                {clientMode ? (
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-app-accent/10 text-app-accent ring-1 ring-inset ring-app-accent/15">
                    <Icon name="users" className="size-5" />
                  </span>
                ) : directOther ? (
                  <Avatar name={directOther.fullName} seed={directOther.userId} presence={presence[directOther.userId]} size="md" />
                ) : activeConversation ? (
                  <GroupAvatar name={conversationLabel(activeConversation)} seed={activeConversation.id} size="md" />
                ) : null}
                <div className="min-w-0">
                  <p className={`${clientMode ? 'text-sm sm:text-base' : 'text-sm'} truncate font-semibold`}>{activeConversation ? conversationLabel(activeConversation) : ''}</p>
                  {chat.typingUsers.length > 0 ? (
                    <p className="text-xs text-app-accent">
                      {kind === 'direct' ? 'typing…' : `${chat.typingUsers.map((id) => memberName(id).split(' ')[0]).join(', ')} typing…`}
                    </p>
                  ) : clientMode && activeConversation ? (
                    <p className="mt-0.5 truncate text-xs text-app-muted">Project group · {activeConversation.members.length} members</p>
                  ) : directOther && presence[directOther.userId] ? (
                    <PresenceLabel presence={presence[directOther.userId]!} />
                  ) : activeConversation && kind !== 'direct' ? (
                    <p className="truncate text-xs text-app-muted">
                      {activeConversation.description ? `${activeConversation.description} · ` : ''}{activeConversation.members.length} members
                    </p>
                  ) : null}
                </div>
              </div>
              {activeConversation && headerExtra?.(activeConversation)}
            </div>

            <PinnedBar
              conversationId={chat.activeId}
              transport={transport}
              version={pinsVersion}
              memberName={memberName}
              onJump={(messageId) => void jumpTo(messageId)}
              onError={fail}
            />

            <div
              ref={threadScrollRef}
              data-chat-thread
              onScroll={(event) => {
                if (openActionsFor) closeMenu();
                const el = event.currentTarget;
                const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
                stickToBottom.current = distance < 80;
                setNearBottom(distance < 200);
              }}
              data-lenis-prevent
              className={`relative min-h-0 flex-1 overscroll-contain ${messageList.length > 0 || chat.hasMore ? 'overflow-y-auto' : 'overflow-y-hidden'} ${clientMode ? 'bg-app-background/35 p-3 sm:p-5 md:p-6' : 'p-4'}`}
            >
              {chat.loadingMessages && messageList.length === 0 ? (
                <SkeletonMessageThread />
              ) : (
                <>
                  {chat.hasMore && (
                    <div className="mb-3 text-center">
                      <Button kind="secondary" onClick={() => void chat.loadMoreMessages()} disabled={chat.loadingMessages} className="!px-3 !py-1.5 !text-xs">
                        {chat.loadingMessages ? 'Loading…' : 'Load older'}
                      </Button>
                    </div>
                  )}
                  <ul ref={listRef} className={`flex min-w-0 flex-col ${clientMode ? 'gap-5 sm:gap-6' : 'gap-3'}`}>
                    {messageList.map((message, index) => {
                      const mine = message.senderId === currentUserId;
                      const unsent = message.deletedAt !== null;
                      const sender = activeConversation?.members.find((m) => m.userId === message.senderId);
                      const previous = messageList[index - 1];
                      const newDay = !previous || new Date(previous.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
                      const runStart = newDay || !previous || previous.senderId !== message.senderId
                        || new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() > 5 * 60_000;
                      const showSender = !mine && kind !== 'direct';
                      const files = unsent ? [] : (message.attachments ?? []);
                      const previews = unsent ? [] : (message.linkPreviews ?? []);
                      const hasText = !unsent && (message.body ?? '').length > 0;
                      const actions = menuActions(message, mine);
                      return (
                        <Fragment key={message.id}>
                          {newDay && (
                            <li className="my-1 flex justify-center" aria-hidden="true">
                              <span className="rounded-full bg-app-surface-raised px-3 py-0.5 text-[11px] font-medium text-app-muted">{dayLabel(message.createdAt)}</span>
                            </li>
                          )}
                          <li id={`chat-message-${message.id}`} className={`flex min-w-0 gap-2 ${mine ? 'flex-row-reverse' : 'flex-row'} ${message.reactions.length > 0 ? 'mb-3' : ''}`}>
                            {showSender && !clientMode && (
                              <span className="mt-auto w-8 shrink-0">
                                {runStart && sender && <Avatar name={sender.fullName} seed={sender.userId} presence={presence[sender.userId]} size="sm" />}
                              </span>
                            )}
                            <div className={`flex min-w-0 flex-1 flex-col ${mine ? 'items-end' : 'items-start'}`}>
                              {showSender && runStart && sender && (clientMode ? (
                                <span className="mb-1 flex max-w-[86%] items-center gap-2 text-xs font-semibold text-app-muted">
                                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-app-surface-raised text-[10px] font-bold text-app-accent ring-1 ring-inset ring-app-border">
                                    {sender.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}
                                  </span>
                                  <span className="truncate">{sender.fullName}</span>
                                </span>
                              ) : (
                                <span className="mb-0.5 max-w-[80%] truncate text-[11px] font-semibold text-app-muted">{sender.fullName}</span>
                              ))}
                              <div className={`${clientMode ? 'max-w-[88%] sm:max-w-[76%]' : 'max-w-[80%]'} relative w-fit min-w-0`}>
                                <div
                                  onPointerDown={(event) => startMessageLongPress(event, message, mine)}
                                  onPointerUp={(event) => finishMessageSwipe(event, message)}
                                  onPointerCancel={(event) => {
                                    clearLongPress();
                                    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                                    clearMessageSwipe();
                                  }}
                                  onPointerMove={(event) => moveMessageSwipe(event, message)}
                                  onContextMenu={(event) => {
                                    if (window.matchMedia('(max-width: 767px)').matches) event.preventDefault();
                                  }}
                                  className={`${clientMode ? 'rounded-[18px] px-4 pb-2.5 pt-3 text-sm leading-6 shadow-sm sm:px-5' : 'rounded-[18px] px-3 pb-2 pt-2 text-sm'} ${mine ? 'rounded-br-none' : 'rounded-bl-none'} ${openActionsFor === message.id || historyFor === message.id || seenDetailFor === message.id ? 'z-50' : ''} group relative w-fit max-w-full min-w-0 touch-pan-y select-none overflow-visible border break-words transition-[transform,background-color,border-color,color] duration-150 [-webkit-touch-callout:none] ${mine ? 'border-app-accent/25 bg-app-accent/10' : 'border-app-border bg-app-surface-raised'} ${highlightedMessageId === message.id ? '!bg-app-accent/40' : ''}`}
                                  style={swipeReply?.id === message.id ? { transform: `translateX(${swipeReply.offset}px)` } : undefined}
                                >
                                  {message.forwarded && <p className="mb-1 flex items-center gap-1 text-[11px] italic text-app-muted"><Icon name="forward" className="size-3" /> Forwarded</p>}
                                  {message.replyPreview && !unsent && (
                                    <button
                                      type="button"
                                      onClick={() => void jumpTo(message.replyPreview!.id)}
                                      className="mb-1 block w-full truncate rounded-md border-l-2 border-app-accent/50 bg-app-background/40 px-2 py-0.5 text-left text-xs text-app-muted hover:text-app-accent"
                                    >
                                      <span className="font-semibold">{memberName(message.replyPreview.senderId)}</span>{' '}
                                      {previewLine(message.replyPreview)}
                                    </button>
                                  )}
                                  {files.length > 0 && (
                                    <div className="pt-1">
                                      <AttachmentGallery attachments={files} onOpenImage={(images, imageIndex) => setLightbox({ images, index: imageIndex })} />
                                    </div>
                                  )}
                                  {unsent ? (
                                    <p className="inline whitespace-pre-wrap break-words italic text-app-muted">
                                      This message was unsent
                                      <span aria-hidden="true" className="invisible ml-2 inline-flex items-center gap-1 whitespace-nowrap text-[10px]">{timeLabel(message.createdAt)}</span>
                                    </p>
                                  ) : hasText ? (
                                    <div className="select-text">
                                      <MessageMarkdown
                                        body={message.body ?? ''}
                                        mentions={message.mentions}
                                        trailing={(
                                          <span aria-hidden="true" className="invisible ml-2 inline-flex items-center gap-1 whitespace-nowrap text-[10px]">
                                            {renderMeta(message, mine, true)}
                                          </span>
                                        )}
                                      />
                                    </div>
                                  ) : null}
                                  {previews.map((preview) => <LinkPreviewCard key={preview.url} preview={preview} />)}
                                  {hasText || unsent ? (
                                    <span className="absolute bottom-1.5 right-2 inline-flex items-center gap-1 whitespace-nowrap text-[10px] text-app-muted">
                                      {renderMeta(message, mine, false)}
                                    </span>
                                  ) : (
                                    <span className="mt-0.5 flex items-center justify-end gap-1 whitespace-nowrap text-[10px] text-app-muted">
                                      {renderMeta(message, mine, false)}
                                    </span>
                                  )}
                                  {!unsent && (
                                    <span data-chat-popover className="absolute right-1.5 top-1.5 hidden items-center md:flex">
                                      <button
                                        type="button"
                                        onClick={(event) => toggleMessageActions(message, mine, event)}
                                        aria-label={openActionsFor === message.id ? 'Hide message actions' : 'Show message actions'}
                                        aria-expanded={openActionsFor === message.id}
                                        className={`pointer-events-none grid size-6 place-items-center rounded-md text-app-muted opacity-0 transition-[background-color,opacity,color] duration-150 group-hover:pointer-events-auto group-hover:bg-app-surface-raised group-hover:opacity-100 group-hover:text-app-accent focus-visible:pointer-events-auto focus-visible:bg-app-surface-raised focus-visible:opacity-100 focus-visible:text-app-accent focus-visible:outline-2 focus-visible:outline-app-accent focus-visible:outline-offset-1 ${openActionsFor === message.id ? 'pointer-events-auto bg-app-surface-raised opacity-100 text-app-accent' : ''}`}
                                      >
                                        <Icon name={openActionsFor === message.id ? 'chevron-up' : 'chevron-down'} className="size-3.5" />
                                      </button>
                                    </span>
                                  )}
                                </div>
                                {message.reactions.length > 0 && (
                                  <div className={`absolute -bottom-3 ${mine ? 'right-2' : 'left-2'} flex flex-wrap gap-1 text-xs ${openActionsFor === message.id ? 'z-50' : 'z-10'}`}>
                                    {[...new Set(message.reactions.map((r) => r.emoji))].map((emoji) => {
                                      const reactors = message.reactions.filter((r) => r.emoji === emoji);
                                      const reactedByMe = reactors.some((r) => r.userId === currentUserId);
                                      const open = reactionDetail?.messageId === message.id && reactionDetail.emoji === emoji;
                                      const names = reactors.map((r) => memberName(r.userId)).join(', ');
                                      return (
                                        <span key={emoji} data-chat-popover className="relative">
                                          <button
                                            type="button"
                                            onClick={() => void toggleReaction(message, emoji)}
                                            onContextMenu={(event) => {
                                              event.preventDefault();
                                              setReactionDetail(open ? null : { messageId: message.id, emoji });
                                            }}
                                            title={`${names} — click to ${reactedByMe ? 'remove your' : 'add your'} ${emoji}`}
                                            aria-label={`${emoji} ${reactors.length}, ${reactedByMe ? 'remove your reaction' : 'add your reaction'}`}
                                            aria-pressed={reactedByMe}
                                            className={`rounded-full border px-1.5 py-0.5 shadow-sm ${reactedByMe ? 'border-app-accent bg-app-accent/15' : 'border-app-border bg-app-surface hover:border-app-accent'}`}
                                          >
                                            {emoji}{reactors.length > 1 ? <span className="ml-0.5 text-[10px] font-semibold">{reactors.length}</span> : ''}
                                          </button>
                                          {open && (
                                            <div className="absolute bottom-full left-0 z-10 mb-1 min-w-max rounded-lg border border-app-border bg-app-surface px-2 py-1 text-[11px] text-app-muted shadow-lg">
                                              {reactors.map((r) => (
                                                <p key={r.userId} className="whitespace-nowrap">{memberName(r.userId)}</p>
                                              ))}
                                            </div>
                                          )}
                                        </span>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>

                          </div>

                              {openActionsFor === message.id && actionMenuPosition && createPortal(
                                <>
                                  <div
                                    className="fixed inset-0 z-40 bg-app-background/25 backdrop-blur-[2px] md:hidden"
                                    aria-hidden="true"
                                    onClick={closeMenu}
                                  />
                                  <div
                                    data-chat-popover
                                    role="menu"
                                    className="fixed z-50 min-w-44 max-w-[calc(100vw-2rem)] rounded-lg border border-app-border bg-app-surface py-1 text-xs shadow-lg"
                                    style={{ top: actionMenuPosition.top, left: actionMenuPosition.left }}
                                  >
                                    {actions.map((action) => {
                                      const item = {
                                        reply: { icon: 'reply', label: 'Reply' },
                                        react: { icon: 'smile', label: 'React' },
                                        edit: { icon: 'pencil', label: 'Edit' },
                                        copy: { icon: 'copy', label: 'Copy text' },
                                        forward: { icon: 'forward', label: 'Forward' },
                                        pin: { icon: message.pinnedAt ? 'pushpin-off' : 'pushpin', label: message.pinnedAt ? 'Unpin' : 'Pin to conversation' },
                                        save: { icon: 'bookmark', label: message.saved ? 'Remove from saved' : 'Save for later' },
                                        unsend: { icon: 'trash', label: 'Unsend' },
                                      }[action];
                                      return (
                                        <button
                                          key={action}
                                          type="button"
                                          role="menuitem"
                                          onClick={() => onMenuAction(action, message)}
                                          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-app-surface-raised ${action === 'unsend' ? 'text-app-danger' : ''}`}
                                        >
                                          <Icon name={item.icon} className="size-4" filled={action === 'save' && message.saved === true} /> {item.label}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </>,
                                document.body,
                              )}

                              {reactingMessageId === message.id && (
                                <div data-chat-popover className={`mt-1 flex items-center gap-0.5 rounded-full border border-app-border bg-app-surface p-1 shadow-md ${message.reactions.length > 0 ? 'mt-4' : ''}`}>
                                  {QUICK_REACTIONS.map((emoji) => (
                                    <button key={emoji} type="button" onClick={() => void toggleReaction(message, emoji)} className="grid size-8 place-items-center rounded-full text-lg transition-transform hover:scale-110 hover:bg-app-surface-raised" aria-label={`React ${emoji}`}>
                                      {emoji}
                                    </button>
                                  ))}
                                  <button
                                    type="button"
                                    onClick={(event) => setPickerFor({ messageId: message.id, anchor: event.currentTarget.getBoundingClientRect() })}
                                    className="grid size-8 place-items-center rounded-full text-app-muted hover:bg-app-surface-raised hover:text-app-accent"
                                    aria-label="More emoji"
                                    title="More emoji"
                                  >
                                    <Icon name="smile-plus" className="size-[18px]" />
                                  </button>
                                </div>
                              )}
                          </li>
                        </Fragment>
                      );
                    })}
                  </ul>
                  {chat.hasNewer && (
                    <div className="mt-3 text-center">
                      <Button kind="secondary" onClick={() => void chat.loadNewerMessages()} disabled={chat.loadingMessages} className="!px-3 !py-1.5 !text-xs">
                        {chat.loadingMessages ? 'Loading…' : 'Load newer'}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>

            {(chat.hasNewer || (!nearBottom && messageList.length > 0)) && (
              <button
                type="button"
                onClick={() => {
                  if (chat.hasNewer) void chat.jumpToLatest();
                  else threadScrollRef.current?.scrollTo({ top: threadScrollRef.current.scrollHeight, behavior: 'smooth' });
                }}
                className="absolute bottom-24 right-5 z-30 flex items-center gap-1.5 rounded-full border border-app-border bg-app-surface px-3 py-1.5 text-xs font-semibold text-app-accent shadow-lg hover:border-app-accent"
              >
                <Icon name="arrow-down" className="size-3.5" />
                {chat.newMessagesBelow > 0 ? `${chat.newMessagesBelow} new` : 'Latest'}
              </button>
            )}

            {dragging && (
              <div className="pointer-events-none absolute inset-2 z-40 grid place-items-center rounded-2xl border-2 border-dashed border-app-accent bg-app-accent/10 backdrop-blur-[1px]">
                <p className="flex items-center gap-2 rounded-full bg-app-surface px-4 py-2 text-sm font-semibold text-app-accent shadow"><Icon name="upload" className="size-4" /> Drop files to share</p>
              </div>
            )}

            {activeConversation && (
              <ScheduledPanel
                conversationId={activeConversation.id}
                transport={transport}
                version={scheduledVersion}
                onError={fail}
                onSentNow={() => void chat.jumpToLatest()}
              />
            )}

            {activeConversation && (
              <Composer
                conversation={activeConversation}
                kind={kind}
                currentUserId={currentUserId}
                transport={transport}
                replyTo={replyTo}
                onCancelReply={() => setReplyTo(null)}
                editing={editing}
                onCancelEdit={() => setEditing(null)}
                onSent={(message) => {
                  chat.applyOptimisticMessage(message);
                  void chat.refreshConversations();
                }}
                onEdited={(message) => {
                  chat.replaceMessage(message);
                  void chat.refreshConversations();
                }}
                onScheduled={() => setLocalScheduledVersion((version) => version + 1)}
                onTyping={chat.notifyTyping}
                onError={fail}
                onEditLast={editLast}
                fileDropRef={fileDropRef}
                clientMode={clientMode}
              />
            )}
          </>
        )}
      </div>

      {pickerFor && (
        <EmojiPopover
          anchor={pickerFor.anchor}
          onSelect={(emoji) => {
            const target = chat.messages.find((m) => m.id === pickerFor.messageId);
            if (target) void toggleReaction(target, emoji);
            setPickerFor(null);
          }}
          onClose={() => setPickerFor(null)}
        />
      )}

      {lightbox && <Lightbox images={lightbox.images} startIndex={lightbox.index} onClose={() => setLightbox(null)} />}

      {forwardingMessage && (
        createPortal(
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setForwardingMessage(null)}>
            <div data-lenis-prevent className="ui-card max-h-[70vh] w-full max-w-sm overflow-y-auto overscroll-contain p-4" onClick={(event) => event.stopPropagation()}>
              <p className="mb-3 text-sm font-semibold">Forward to…</p>
              <ul>
                {chat.conversations.map((conversation) => (
                  <li key={conversation.id}>
                    <button type="button" onClick={() => void onForward(conversation.id)} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-app-surface-raised">
                      {conversationLabel(conversation)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>,
          document.body,
        )
      )}

      {(actionError || chat.error) && (
        <p role="alert" className="fixed bottom-4 left-1/2 z-50 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg border border-[#d86b6b]/30 bg-app-surface px-4 py-2 text-sm text-app-danger shadow-lg">
          {actionError || chat.error}
        </p>
      )}
    </div>
  );
}
