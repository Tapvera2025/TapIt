import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, Empty, SkeletonMessageThread } from '../ui/components.js';
import { Icon } from '../ui/Icon.js';
import {
  REACTION_EMOJI,
  forwardMessage,
  reactToMessage,
  removeReaction,
  sendMessage,
  unsendMessage,
  type ChatMessage,
  type Conversation,
  type ConversationKind,
  type ConversationMember,
  type ReactionEmoji,
} from './api/chatApi.js';
import type { useChat } from './useChat.js';

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const CHAT_LIST_MIN_WIDTH = 220;
const CHAT_LIST_MAX_WIDTH = 320;
const clampChatListWidth = (width: number): number =>
  Math.max(CHAT_LIST_MIN_WIDTH, Math.min(CHAT_LIST_MAX_WIDTH, width));

/** Highlights `@FullName` tokens the message actually recorded as mentions — not a live guess from the body text. */
function renderMessageBody(body: string, mentions: readonly { userId: string; fullName: string }[]): ReactNode {
  if (mentions.length === 0) return body;
  const names = [...new Set(mentions.map((m) => m.fullName))].sort((a, b) => b.length - a.length);
  const mentionTokens = new Set(names.map((n) => `@${n}`));
  const pattern = new RegExp(`(@(?:${names.map(escapeRegExp).join('|')}))`, 'g');
  return body.split(pattern).map((part, index) =>
    mentionTokens.has(part) ? (
      <span key={index} className="rounded bg-app-accent/20 px-0.5 font-semibold text-app-accent">{part}</span>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}

/**
 * The conversation list + thread, shared by every tab (Direct Messages now;
 * Internal Groups, Phase 3 — Project Groups, Phase 4). What differs between
 * tabs — how a conversation is labelled, what "New" does, whether there is a
 * management panel — is passed in by the page that owns this component; the
 * messaging mechanics (send, reply, forward, react, unsend, typing, seen,
 * pagination) live here exactly once.
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
  messageActions,
  clientMode = false,
}: {
  /** Owned by the page (not this component), so the page's own "New" flow can drive the same instance. */
  chat: ReturnType<typeof useChat>;
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
  /** A notification deep link (e.g. a mention): open this conversation on mount, once. */
  initialConversationId?: string | undefined;
  /** Scroll to and highlight this message once it's loaded, once. */
  initialMessageId?: string | undefined;
  messageActions?: {
    sendMessage: typeof sendMessage;
    reactToMessage: typeof reactToMessage;
    removeReaction: typeof removeReaction;
  };
  /** Client portal discussions share the thread UI but omit company-only actions. */
  clientMode?: boolean;
}): React.JSX.Element {
  const [composer, setComposer] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<ChatMessage | null>(null);
  const [reactingMessageId, setReactingMessageId] = useState<string | null>(null);
  const [reactionDetail, setReactionDetail] = useState<{ messageId: string; emoji: string } | null>(null);
  const [openActionsFor, setOpenActionsFor] = useState<string | null>(null);
  const [actionMenuPosition, setActionMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [chatListWidth, setChatListWidth] = useState(320);
  const chatListResizeStartRef = useRef<{ x: number; width: number } | null>(null);
  const [isResizingChatList, setIsResizingChatList] = useState(false);
  const [seenDetailFor, setSeenDetailFor] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState('');
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [pendingMentions, setPendingMentions] = useState<Map<string, string>>(new Map());
  const threadEndRef = useRef<HTMLDivElement>(null);
  const threadScrollRef = useRef<HTMLDivElement>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastOpenedInitialIdRef = useRef<string | null>(null);
  const lastScrolledMessageIdRef = useRef<string | null>(null);
  const openConversation = chat.openConversation;

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

  useEffect(() => {
    const thread = threadScrollRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [chat.messages.length, chat.activeId]);

  const MAX_COMPOSER_HEIGHT = 160;
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
  }, [composer]);

  useEffect(() => () => {
    if (highlightTimeout.current) clearTimeout(highlightTimeout.current);
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
  }, []);

  // Clicking anywhere that isn't one of the popovers themselves (reaction
  // detail, seen detail, the message-actions menu, the emoji picker, the
  // mention dropdown) closes whichever of them is open — including clicking
  // empty space in the thread, not just another message.
  useEffect(() => {
    const closeOpenPopovers = (event: MouseEvent): void => {
      if ((event.target as HTMLElement).closest('[data-chat-popover]')) return;
      setReactionDetail(null);
      setSeenDetailFor(null);
      setOpenActionsFor(null);
      setActionMenuPosition(null);
      setReactingMessageId(null);
      setMentionQuery(null);
    };
    const closeActionsOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpenActionsFor(null);
        setActionMenuPosition(null);
      }
    };
    document.addEventListener('mousedown', closeOpenPopovers);
    document.addEventListener('keydown', closeActionsOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOpenPopovers);
      document.removeEventListener('keydown', closeActionsOnEscape);
    };
  }, []);

  const scrollToMessage = (messageId: string): void => {
    const el = document.getElementById(`chat-message-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (highlightTimeout.current) clearTimeout(highlightTimeout.current);
    setHighlightedMessageId(messageId);
    highlightTimeout.current = setTimeout(() => setHighlightedMessageId(null), 1200);
  };

  useEffect(() => {
    // Keyed on the id itself, not "has any deep link ever been consumed" — a
    // second notification for a different conversation, arriving while this
    // same tab/component is still mounted, must still be honored.
    if (!initialConversationId || lastOpenedInitialIdRef.current === initialConversationId) return;
    lastOpenedInitialIdRef.current = initialConversationId;
    void openConversation(initialConversationId);
  }, [initialConversationId, openConversation]);

  useEffect(() => {
    if (!initialMessageId || lastScrolledMessageIdRef.current === initialMessageId) return;
    if (!chat.messages.some((m) => m.id === initialMessageId)) return;
    lastScrolledMessageIdRef.current = initialMessageId;
    scrollToMessage(initialMessageId);
  }, [initialMessageId, chat.messages]);

  const activeConversation = useMemo(
    () => chat.conversations.find((c) => c.id === chat.activeId) ?? null,
    [chat.conversations, chat.activeId],
  );

  const onComposerChange = (value: string, cursor: number): void => {
    setComposer(value);
    chat.notifyTyping('start');
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => chat.notifyTyping('stop'), 2000);

    if (kind === 'direct') return;
    const upToCursor = value.slice(0, cursor);
    const at = upToCursor.lastIndexOf('@');
    const fragment = at === -1 ? null : upToCursor.slice(at + 1);
    setMentionQuery(fragment !== null && !/\s/.test(fragment) ? fragment : null);
  };

  const mentionCandidates = useMemo(() => {
    if (mentionQuery === null || !activeConversation) return [];
    const query = mentionQuery.toLowerCase();
    return activeConversation.members
      .filter((m) => m.userId !== currentUserId && m.fullName.toLowerCase().includes(query))
      .slice(0, 6);
  }, [mentionQuery, activeConversation, currentUserId]);

  const selectMention = (member: ConversationMember): void => {
    const el = composerRef.current;
    const cursor = el?.selectionStart ?? composer.length;
    const upToCursor = composer.slice(0, cursor);
    const at = upToCursor.lastIndexOf('@');
    if (at === -1) return;
    const insertion = `@${member.fullName} `;
    const next = composer.slice(0, at) + insertion + composer.slice(cursor);
    setComposer(next);
    setPendingMentions((current) => new Map(current).set(member.userId, member.fullName));
    setMentionQuery(null);
    const pos = at + insertion.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  const send = async (): Promise<void> => {
    const body = composer.trim();
    if (!body || !chat.activeId || sending) return;
    setSending(true);
    chat.notifyTyping('stop');
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    try {
      // Only mentions whose "@Name" text is still actually present survive an edit after picking them.
      const mentionedUserIds = [...pendingMentions.entries()]
        .filter(([, fullName]) => body.includes(`@${fullName}`))
        .map(([userId]) => userId);
      const message = await (messageActions?.sendMessage ?? sendMessage)(chat.activeId, body, replyTo?.id ?? null, mentionedUserIds);
      chat.applyOptimisticMessage(message);
      setComposer('');
      setReplyTo(null);
      setPendingMentions(new Map());
      setMentionQuery(null);
      void chat.refreshConversations();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Unable to send message.');
    } finally {
      setSending(false);
    }
  };

  const copyText = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard unavailable — nothing to fall back to worth doing here */
    }
  };

  const onUnsend = async (message: ChatMessage): Promise<void> => {
    try {
      chat.replaceMessage(await unsendMessage(message.id));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Unable to unsend message.');
    }
  };

  const setMessageActionsPosition = (message: ChatMessage, mine: boolean, anchor: DOMRect): void => {
    const menuWidth = 144;
    const menuHeight = clientMode ? 160 : mine ? 196 : 160;
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

  const clearLongPress = (): void => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  const startMessageLongPress = (event: React.PointerEvent<HTMLDivElement>, message: ChatMessage, mine: boolean): void => {
    if (event.pointerType !== 'touch' || !window.matchMedia('(max-width: 767px)').matches || (event.target as HTMLElement).closest('button')) return;
    clearLongPress();
    const anchor = event.currentTarget.getBoundingClientRect();
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      setMessageActionsPosition(message, mine, anchor);
    }, 520);
  };

  const toggleReaction = async (message: ChatMessage, emoji: ReactionEmoji): Promise<void> => {
    setReactingMessageId(null);
    setReactionDetail(null);
    const existingReaction = message.reactions.find((r) => r.userId === currentUserId);
    try {
      const remove = messageActions?.removeReaction ?? removeReaction;
      const add = messageActions?.reactToMessage ?? reactToMessage;
      if (existingReaction?.emoji === emoji) {
        chat.replaceMessage(await remove(message.id, emoji));
      } else {
        if (existingReaction) await remove(message.id, existingReaction.emoji);
        chat.replaceMessage(await add(message.id, emoji));
      }
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Unable to react.');
    }
  };

  const onForward = async (targetConversationId: string): Promise<void> => {
    if (!forwardingMessage) return;
    try {
      await forwardMessage(forwardingMessage.id, targetConversationId);
      setForwardingMessage(null);
      if (targetConversationId === chat.activeId) await chat.openConversation(targetConversationId);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Unable to forward message.');
    }
  };

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
                return (
                  <li key={conversation.id} className="border-b border-app-border/70 last:border-b-0">
                    <button
                      type="button"
                      onClick={() => void chat.openConversation(conversation.id)}
                      className={`my-1 flex w-full items-start gap-3 rounded-lg px-2 py-3 text-left hover:bg-app-surface-raised ${active ? 'bg-app-accent/10 text-app-accent' : ''}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold">{conversationLabel(conversation)}</span>
                          {conversation.unreadCount > 0 && (
                            <span className="shrink-0 rounded-full bg-app-accent px-1.5 py-0.5 text-[10px] font-bold text-app-on-accent">
                              {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
                            </span>
                          )}
                        </span>
                        {conversation.lastMessage && (
                          <span className="mt-0.5 block truncate text-xs text-app-muted">
                            {conversation.lastMessage.deletedAt ? 'Message unsent' : (conversation.lastMessage.body ?? '')}
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
      <div className={`relative flex min-h-0 min-w-0 flex-1 flex-col ${!hideList ? 'md:before:absolute md:before:inset-y-5 md:before:left-0 md:before:w-px md:before:bg-app-border' : ''} ${!hideList && !chat.activeId ? 'hidden md:flex' : 'flex'}`}>
        {!chat.activeId ? (
          <div className="grid flex-1 place-items-center text-sm text-app-muted">Select a conversation, or start a new one.</div>
        ) : (
          <>
            <div className={`relative flex shrink-0 items-center justify-between gap-3 px-4 py-3 after:absolute after:bottom-0 after:left-4 after:right-4 after:h-px after:bg-app-border sm:px-5 ${clientMode ? 'bg-app-surface' : ''}`}>
              <div className="flex min-w-0 items-center gap-2">
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
                {clientMode && (
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-app-accent/10 text-app-accent ring-1 ring-inset ring-app-accent/15">
                    <Icon name="users" className="size-5" />
                  </span>
                )}
                <div className="min-w-0">
                  <p className={`${clientMode ? 'text-sm sm:text-base' : 'text-sm'} truncate font-semibold`}>{activeConversation ? conversationLabel(activeConversation) : ''}</p>
                  {clientMode && activeConversation && (
                    <p className="mt-0.5 truncate text-xs text-app-muted">Project group · {activeConversation.members.length} members</p>
                  )}
                  {!clientMode && activeConversation?.description && kind !== 'direct' && (
                    <p className="truncate text-xs text-app-muted">{activeConversation.description}</p>
                  )}
                  {chat.typingUsers.length > 0 && <p className="text-xs text-app-accent">typing…</p>}
                </div>
              </div>
              {activeConversation && headerExtra?.(activeConversation)}
            </div>

            <div
              ref={threadScrollRef}
              onScroll={() => {
                if (openActionsFor) {
                  setOpenActionsFor(null);
                  setActionMenuPosition(null);
                }
              }}
              data-lenis-prevent
              className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${clientMode ? 'bg-app-background/35 p-3 sm:p-5 md:p-6' : 'p-4'}`}
            >
              {chat.loadingMessages && chat.messages.length === 0 ? (
                <SkeletonMessageThread />
              ) : (
                <>
                  {chat.hasMore && (
                    <div className="mb-3 text-center">
                      <Button kind="secondary" onClick={() => void chat.loadMoreMessages()} className="!px-3 !py-1.5 !text-xs">
                        Load older
                      </Button>
                    </div>
                  )}
                  <ul className={`flex min-w-0 flex-col ${clientMode ? 'gap-5 sm:gap-6' : 'gap-3'}`}>
                    {chat.messages.map((message) => {
                      const mine = message.senderId === currentUserId;
                      const unsent = message.deletedAt !== null;
                      const sender = activeConversation?.members.find((m) => m.userId === message.senderId);
                      return (
                        <li key={message.id} id={`chat-message-${message.id}`} className={`min-w-0 flex flex-col ${mine ? 'items-end' : 'items-start'} ${message.reactions.length > 0 ? 'mb-3' : ''}`}>
                          {!mine && kind !== 'direct' && sender && (clientMode ? (
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
                              onPointerUp={clearLongPress}
                              onPointerCancel={clearLongPress}
                              onPointerMove={clearLongPress}
                              onContextMenu={(event) => {
                                if (window.matchMedia('(max-width: 767px)').matches) event.preventDefault();
                              }}
                              className={`${clientMode ? 'rounded-[18px] px-4 pb-2.5 pt-3 text-sm leading-6 shadow-sm sm:px-5' : 'rounded-[18px] px-3 pb-2 pt-2 text-sm'} ${mine ? 'rounded-br-[5px]' : 'rounded-bl-[5px]'} ${openActionsFor === message.id ? 'z-50' : ''} group relative w-fit max-w-full min-w-0 overflow-visible border break-words transition-colors duration-500 ${mine ? 'border-app-accent/25 bg-app-accent/10' : 'border-app-border bg-app-surface-raised'} ${highlightedMessageId === message.id ? '!bg-app-accent/40' : ''}`}
                            >
                            {message.forwarded && <p className="mb-1 text-[11px] italic text-app-muted">Forwarded</p>}
                            {message.replyPreview && !unsent && (
                              <button
                                type="button"
                                onClick={() => scrollToMessage(message.replyPreview!.id)}
                                className="mb-1 block w-full truncate border-l-2 border-app-accent/50 pl-2 text-left text-xs text-app-muted hover:text-app-accent"
                              >
                                {message.replyPreview.deletedAt ? 'Message unsent' : (message.replyPreview.body ?? '')}
                              </button>
                            )}
                            <p className={`inline whitespace-pre-wrap break-words ${unsent ? 'italic text-app-muted' : ''}`}>{unsent ? 'This message was unsent' : renderMessageBody(message.body ?? '', message.mentions)}</p>
                            <span aria-hidden="true" className="ml-2 inline-flex invisible items-center gap-1 whitespace-nowrap text-[10px]">
                              {timeLabel(message.createdAt)}
                              {mine && message.seenBy.length > 0 && ' ✓✓'}
                            </span>
                            <span className="absolute bottom-1.5 right-2 inline-flex items-center gap-1 whitespace-nowrap text-[10px] text-app-muted">
                              <time dateTime={message.createdAt}>{timeLabel(message.createdAt)}</time>
                            {mine && message.seenBy.length > 0 && (
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
                            )}
                            </span>
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
                            <span
                              aria-hidden="true"
                              className={`pointer-events-none absolute bottom-[-1px] h-3.5 w-3.5 ${mine ? '-right-2 bg-app-accent/10 [clip-path:polygon(0_0,100%_100%,0_100%)]' : '-left-2 bg-app-surface-raised [clip-path:polygon(100%_0,0_100%,100%_100%)]'}`}
                            />
                            </div>
                            {message.reactions.length > 0 && (
                              <div className={`absolute -bottom-3 left-2 flex flex-wrap gap-1 text-xs ${openActionsFor === message.id ? 'z-50' : 'z-10'}`}>
                                {[...new Set(message.reactions.map((r) => r.emoji))].map((emoji) => {
                                  const reactors = message.reactions.filter((r) => r.emoji === emoji);
                                  const open = reactionDetail?.messageId === message.id && reactionDetail.emoji === emoji;
                                  return (
                                    <span key={emoji} data-chat-popover className="relative">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (reactors.some((r) => r.userId === currentUserId)) {
                                            void toggleReaction(message, emoji);
                                          } else {
                                            setReactionDetail(open ? null : { messageId: message.id, emoji });
                                          }
                                        }}
                                        aria-label={reactors.some((r) => r.userId === currentUserId) ? 'Remove your reaction' : 'View reactions'}
                                        className="rounded-full border border-app-border bg-app-surface px-1.5 py-0.5 shadow-sm hover:border-app-accent"
                                      >
                                        {emoji}{reactors.length > 1 ? reactors.length : ''}
                                      </button>
                                      {open && (
                                        <div className="absolute bottom-full left-0 z-10 mb-1 min-w-max rounded-lg border border-app-border bg-app-surface px-2 py-1 text-[11px] text-app-muted shadow-lg">
                                          {reactors.map((r) => (
                                            <p key={r.userId} className="whitespace-nowrap">
                                              {r.userId === currentUserId
                                                ? 'You'
                                                : activeConversation?.members.find((m) => m.userId === r.userId)?.fullName ?? 'Someone'}
                                            </p>
                                          ))}
                                        </div>
                                      )}
                                    </span>
                                  );
                                })}
                              </div>
                            )}

                          </div>

                          {openActionsFor === message.id && actionMenuPosition && createPortal(
                            <>
                              <div
                                className="fixed inset-0 z-40 bg-app-background/25 backdrop-blur-[2px] md:hidden"
                                aria-hidden="true"
                                onClick={() => { setOpenActionsFor(null); setActionMenuPosition(null); }}
                              />
                              <div
                                data-chat-popover
                                className="fixed z-50 min-w-36 max-w-[calc(100vw-2rem)] rounded-lg border border-app-border bg-app-surface py-1 text-xs shadow-lg"
                                style={{ top: actionMenuPosition.top, left: actionMenuPosition.left }}
                              >
                              <button
                                type="button"
                                onClick={() => { setReplyTo(message); setOpenActionsFor(null); setActionMenuPosition(null); }}
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-app-surface-raised"
                              >
                                <Icon name="reply" className="size-4" /> Reply
                              </button>
                              {!clientMode && <button
                                type="button"
                                onClick={() => { setForwardingMessage(message); setOpenActionsFor(null); setActionMenuPosition(null); }}
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-app-surface-raised"
                              >
                                <Icon name="forward" className="size-4" /> Forward
                              </button>}
                              <button
                                type="button"
                                onClick={() => { void copyText(message.body ?? ''); setOpenActionsFor(null); setActionMenuPosition(null); }}
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-app-surface-raised"
                              >
                                <Icon name="copy" className="size-4" /> Copy
                              </button>
                              <button
                                type="button"
                                onClick={() => { setReactingMessageId(message.id); setOpenActionsFor(null); setActionMenuPosition(null); }}
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-app-surface-raised"
                              >
                                <Icon name="smile" className="size-4" /> React
                              </button>
                              {!clientMode && mine && (
                                <button
                                  type="button"
                                  onClick={() => { void onUnsend(message); setOpenActionsFor(null); setActionMenuPosition(null); }}
                                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-app-danger hover:bg-app-surface-raised"
                                >
                                  <Icon name="trash" className="size-4" /> Unsend
                                </button>
                              )}
                              </div>
                            </>,
                            document.body,
                          )}

                          {reactingMessageId === message.id && (
                            <div data-chat-popover className="mt-1 flex gap-1 rounded-lg border border-app-border bg-app-surface p-1">
                              {REACTION_EMOJI.map((emoji) => (
                                <button key={emoji} type="button" onClick={() => void toggleReaction(message, emoji)} className="rounded p-1 text-base hover:bg-app-surface-raised">
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <div ref={threadEndRef} />
                </>
              )}
            </div>

            {replyTo && (
              <div className="flex shrink-0 items-center justify-between gap-2 border-t border-app-border bg-app-surface-raised px-4 py-2 text-xs text-app-muted">
                <span className="truncate">Replying to: {replyTo.deletedAt ? 'Message unsent' : replyTo.body}</span>
                <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply">✕</button>
              </div>
            )}

            <div className={`flex shrink-0 items-stretch gap-2 border-t border-app-border bg-app-surface ${clientMode ? 'p-3 sm:gap-3 sm:p-4' : 'p-3'}`}>
              <div className="relative min-w-0 flex-1">
                {mentionQuery !== null && (
                  <div data-chat-popover className="absolute bottom-full left-0 z-20 mb-1 w-56 rounded-lg border border-app-border bg-app-surface py-1 text-sm shadow-lg">
                    {mentionCandidates.length === 0 ? (
                      <p className="px-3 py-1.5 text-xs text-app-muted">No matching members</p>
                    ) : (
                      mentionCandidates.map((member) => (
                        <button
                          key={member.userId}
                          type="button"
                          onClick={() => selectMention(member)}
                          className="block w-full truncate px-3 py-1.5 text-left hover:bg-app-surface-raised"
                        >
                          {member.fullName}
                        </button>
                      ))
                    )}
                  </div>
                )}
                <textarea
                  ref={composerRef}
                  value={composer}
                  onChange={(event) => onComposerChange(event.target.value, event.target.selectionStart)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                    if (event.key === 'Escape' && mentionQuery !== null) setMentionQuery(null);
                  }}
                  placeholder="Type a message..."
                  rows={1}
                  style={{ maxHeight: MAX_COMPOSER_HEIGHT }}
                  data-lenis-prevent
                  className={`block min-h-10 w-full resize-none overflow-y-auto whitespace-pre-wrap border border-app-border px-3 py-2.5 text-sm leading-5 outline-none focus:border-app-accent ${clientMode ? 'rounded-xl bg-app-surface-raised sm:px-4' : 'rounded-lg bg-app-background'}`}
                />
              </div>
              <Button onClick={() => void send()} disabled={sending || composer.trim().length === 0} className={`min-w-[4.25rem] shrink-0 self-stretch !py-0 ${clientMode ? '!rounded-xl !px-4' : ''}`}>Send</Button>
            </div>
          </>
        )}
      </div>

      {forwardingMessage && (
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
        </div>
      )}

      {(actionError || chat.error) && (
        <p role="alert" className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-[#d86b6b]/30 bg-app-surface px-4 py-2 text-sm text-app-danger shadow-lg">
          {actionError || chat.error}
        </p>
      )}
    </div>
  );
}
