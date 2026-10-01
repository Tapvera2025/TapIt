import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Empty, Loading } from '../ui/components.js';
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
}): React.JSX.Element {
  const [composer, setComposer] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<ChatMessage | null>(null);
  const [reactingMessageId, setReactingMessageId] = useState<string | null>(null);
  const [reactionDetail, setReactionDetail] = useState<{ messageId: string; emoji: string } | null>(null);
  const [openActionsFor, setOpenActionsFor] = useState<string | null>(null);
  const [seenDetailFor, setSeenDetailFor] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState('');
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [pendingMentions, setPendingMentions] = useState<Map<string, string>>(new Map());
  const threadEndRef = useRef<HTMLDivElement>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const highlightTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastOpenedInitialIdRef = useRef<string | null>(null);
  const lastScrolledMessageIdRef = useRef<string | null>(null);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: 'end' });
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
      setReactingMessageId(null);
      setMentionQuery(null);
    };
    document.addEventListener('mousedown', closeOpenPopovers);
    return () => document.removeEventListener('mousedown', closeOpenPopovers);
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
    void chat.openConversation(initialConversationId);
    // Deliberately omits `chat`: openConversation is a stable useCallback.
  }, [initialConversationId]);

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
      const message = await sendMessage(chat.activeId, body, replyTo?.id ?? null, mentionedUserIds);
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

  const toggleReaction = async (message: ChatMessage, emoji: ReactionEmoji): Promise<void> => {
    setReactingMessageId(null);
    const mine = message.reactions.some((r) => r.userId === currentUserId && r.emoji === emoji);
    try {
      chat.replaceMessage(mine ? await removeReaction(message.id, emoji) : await reactToMessage(message.id, emoji));
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
        <div className="flex w-full shrink-0 flex-col border-b border-app-border md:h-full md:w-80 md:border-b-0 md:border-r">
          <div className="flex items-center justify-between gap-2 border-b border-app-border p-4">
            <p className="text-sm font-semibold">{title}</p>
            {onNewClick && <Button onClick={onNewClick} className="!px-3 !py-1.5 !text-xs">{newLabel}</Button>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {chat.conversations.length === 0 && <Empty>{emptyHint}</Empty>}
            <ul>
              {chat.conversations.map((conversation) => {
                const active = conversation.id === chat.activeId;
                return (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      onClick={() => void chat.openConversation(conversation.id)}
                      className={`flex w-full items-start gap-3 border-b border-app-border px-4 py-3 text-left hover:bg-app-surface-raised ${active ? 'bg-app-surface-raised' : ''}`}
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
      <div className="flex min-h-0 flex-1 flex-col">
        {!chat.activeId ? (
          <div className="grid flex-1 place-items-center text-sm text-app-muted">Select a conversation, or start a new one.</div>
        ) : (
          <>
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-app-border p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{activeConversation ? conversationLabel(activeConversation) : ''}</p>
                {activeConversation?.description && kind !== 'direct' && (
                  <p className="text-xs text-app-muted">{activeConversation.description}</p>
                )}
                {chat.typingUsers.length > 0 && <p className="text-xs text-app-accent">typing…</p>}
              </div>
              {activeConversation && headerExtra?.(activeConversation)}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {chat.loadingMessages && chat.messages.length === 0 ? (
                <Loading />
              ) : (
                <>
                  {chat.hasMore && (
                    <div className="mb-3 text-center">
                      <Button kind="secondary" onClick={() => void chat.loadMoreMessages()} className="!px-3 !py-1.5 !text-xs">
                        Load older
                      </Button>
                    </div>
                  )}
                  <ul className="flex min-w-0 flex-col gap-3">
                    {chat.messages.map((message) => {
                      const mine = message.senderId === currentUserId;
                      const unsent = message.deletedAt !== null;
                      const sender = activeConversation?.members.find((m) => m.userId === message.senderId);
                      return (
                        <li key={message.id} id={`chat-message-${message.id}`} className={`min-w-0 flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                          {!mine && kind !== 'direct' && sender && (
                            <span className="mb-0.5 max-w-[80%] truncate text-[11px] font-semibold text-app-muted">{sender.fullName}</span>
                          )}
                          <div
                            className={`max-w-[80%] min-w-0 rounded-xl border px-3 py-2 text-sm break-words transition-colors duration-700 ${mine ? 'border-app-accent/30 bg-app-accent/10' : 'border-app-border bg-app-surface-raised'} ${highlightedMessageId === message.id ? '!bg-app-accent/40' : ''}`}
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
                            <p className={`whitespace-pre-wrap break-words ${unsent ? 'italic text-app-muted' : ''}`}>{unsent ? 'This message was unsent' : renderMessageBody(message.body ?? '', message.mentions)}</p>
                            {message.reactions.length > 0 && (
                              <div className="relative mt-1 flex flex-wrap gap-1 text-xs">
                                {[...new Set(message.reactions.map((r) => r.emoji))].map((emoji) => {
                                  const reactors = message.reactions.filter((r) => r.emoji === emoji);
                                  const open = reactionDetail?.messageId === message.id && reactionDetail.emoji === emoji;
                                  return (
                                    <span key={emoji} data-chat-popover className="relative">
                                      <button
                                        type="button"
                                        onClick={() => setReactionDetail(open ? null : { messageId: message.id, emoji })}
                                        className="rounded-full border border-app-border bg-app-surface px-1.5 py-0.5 hover:border-app-accent"
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

                          <div className="mt-1 flex items-center gap-2 text-[11px] text-app-muted">
                            <span>{timeLabel(message.createdAt)}</span>
                            {mine && message.seenBy.length > 0 && (
                              <span data-chat-popover className="relative">
                                <button
                                  type="button"
                                  onClick={() => setSeenDetailFor(seenDetailFor === message.id ? null : message.id)}
                                  className="hover:text-app-accent"
                                >
                                  Seen
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
                            {!unsent && (
                              <div data-chat-popover className="relative">
                                <button
                                  type="button"
                                  onClick={() => setOpenActionsFor(openActionsFor === message.id ? null : message.id)}
                                  aria-label="Message actions"
                                  className="rounded p-1 hover:bg-app-surface-raised hover:text-app-accent"
                                >
                                  <Icon name="more" className="size-4" />
                                </button>
                                {openActionsFor === message.id && (
                                  <div className={`absolute bottom-full z-20 mb-1 min-w-36 rounded-lg border border-app-border bg-app-surface py-1 text-xs shadow-lg ${mine ? 'right-0' : 'left-0'}`}>
                                    <button
                                      type="button"
                                      onClick={() => { setReplyTo(message); setOpenActionsFor(null); }}
                                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-app-surface-raised"
                                    >
                                      <Icon name="reply" className="size-4" /> Reply
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => { setForwardingMessage(message); setOpenActionsFor(null); }}
                                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-app-surface-raised"
                                    >
                                      <Icon name="forward" className="size-4" /> Forward
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => { void copyText(message.body ?? ''); setOpenActionsFor(null); }}
                                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-app-surface-raised"
                                    >
                                      <Icon name="copy" className="size-4" /> Copy
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => { setReactingMessageId(message.id); setOpenActionsFor(null); }}
                                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-app-surface-raised"
                                    >
                                      <Icon name="smile" className="size-4" /> React
                                    </button>
                                    {mine && (
                                      <button
                                        type="button"
                                        onClick={() => { void onUnsend(message); setOpenActionsFor(null); }}
                                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-app-danger hover:bg-app-surface-raised"
                                      >
                                        <Icon name="trash" className="size-4" /> Unsend
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

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

            <div className="flex shrink-0 items-end gap-2 border-t border-app-border bg-app-surface p-3">
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
                  placeholder={kind === 'direct' ? 'Type a message…' : 'Type a message… (@ to mention someone)'}
                  rows={1}
                  style={{ maxHeight: MAX_COMPOSER_HEIGHT }}
                  className="min-h-10 w-full resize-none overflow-y-auto whitespace-pre-wrap rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent"
                />
              </div>
              <Button onClick={() => void send()} disabled={sending || composer.trim().length === 0}>Send</Button>
            </div>
          </>
        )}
      </div>

      {forwardingMessage && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setForwardingMessage(null)}>
          <div className="ui-card max-h-[70vh] w-full max-w-sm overflow-y-auto p-4" onClick={(event) => event.stopPropagation()}>
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
