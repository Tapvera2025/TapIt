import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Empty, Loading } from '../ui/components.js';
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
  type ReactionEmoji,
} from './api/chatApi.js';
import type { useChat } from './useChat.js';

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
}): React.JSX.Element {
  const [composer, setComposer] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<ChatMessage | null>(null);
  const [reactingMessageId, setReactingMessageId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState('');
  const threadEndRef = useRef<HTMLDivElement>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: 'end' });
  }, [chat.messages.length, chat.activeId]);

  const activeConversation = useMemo(
    () => chat.conversations.find((c) => c.id === chat.activeId) ?? null,
    [chat.conversations, chat.activeId],
  );

  const onComposerChange = (value: string): void => {
    setComposer(value);
    chat.notifyTyping('start');
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => chat.notifyTyping('stop'), 2000);
  };

  const send = async (): Promise<void> => {
    const body = composer.trim();
    if (!body || !chat.activeId || sending) return;
    setSending(true);
    chat.notifyTyping('stop');
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    try {
      const message = await sendMessage(chat.activeId, body, replyTo?.id ?? null);
      chat.applyOptimisticMessage(message);
      setComposer('');
      setReplyTo(null);
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

      {/* Thread */}
      <div className="flex min-h-0 flex-1 flex-col">
        {!chat.activeId ? (
          <div className="grid flex-1 place-items-center text-sm text-app-muted">Select a conversation, or start a new one.</div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-app-border p-4">
              <div>
                <p className="text-sm font-semibold">{activeConversation ? conversationLabel(activeConversation) : ''}</p>
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
                  <ul className="flex flex-col gap-3">
                    {chat.messages.map((message) => {
                      const mine = message.senderId === currentUserId;
                      const unsent = message.deletedAt !== null;
                      const sender = activeConversation?.members.find((m) => m.userId === message.senderId);
                      return (
                        <li key={message.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                          {!mine && kind !== 'direct' && sender && (
                            <span className="mb-0.5 text-[11px] font-semibold text-app-muted">{sender.fullName}</span>
                          )}
                          <div className={`max-w-[80%] rounded-xl border px-3 py-2 text-sm ${mine ? 'border-app-accent/30 bg-app-accent/10' : 'border-app-border bg-app-surface-raised'}`}>
                            {message.forwarded && <p className="mb-1 text-[11px] italic text-app-muted">Forwarded</p>}
                            {message.replyPreview && !unsent && (
                              <p className="mb-1 truncate border-l-2 border-app-accent/50 pl-2 text-xs text-app-muted">
                                {message.replyPreview.deletedAt ? 'Message unsent' : (message.replyPreview.body ?? '')}
                              </p>
                            )}
                            <p className={unsent ? 'italic text-app-muted' : ''}>{unsent ? 'This message was unsent' : message.body}</p>
                            {message.reactions.length > 0 && (
                              <p className="mt-1 text-xs">
                                {[...new Map(message.reactions.map((r) => [r.emoji, message.reactions.filter((x) => x.emoji === r.emoji).length])).entries()]
                                  .map(([emoji, count]) => `${emoji}${count > 1 ? count : ''}`)
                                  .join(' ')}
                              </p>
                            )}
                          </div>

                          <div className="mt-1 flex items-center gap-2 text-[11px] text-app-muted">
                            <span>{timeLabel(message.createdAt)}</span>
                            {mine && message.seenBy.length > 0 && <span>Seen</span>}
                            {!unsent && (
                              <>
                                <button type="button" onClick={() => setReplyTo(message)} className="hover:text-app-accent">Reply</button>
                                <button type="button" onClick={() => setForwardingMessage(message)} className="hover:text-app-accent">Forward</button>
                                <button type="button" onClick={() => void copyText(message.body ?? '')} className="hover:text-app-accent">Copy</button>
                                <button type="button" onClick={() => setReactingMessageId(reactingMessageId === message.id ? null : message.id)} className="hover:text-app-accent">React</button>
                                {mine && <button type="button" onClick={() => void onUnsend(message)} className="hover:text-app-danger">Unsend</button>}
                              </>
                            )}
                          </div>

                          {reactingMessageId === message.id && (
                            <div className="mt-1 flex gap-1 rounded-lg border border-app-border bg-app-surface p-1">
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
              <div className="flex items-center justify-between gap-2 border-t border-app-border bg-app-surface-raised px-4 py-2 text-xs text-app-muted">
                <span className="truncate">Replying to: {replyTo.deletedAt ? 'Message unsent' : replyTo.body}</span>
                <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply">✕</button>
              </div>
            )}

            <div className="flex items-center gap-2 border-t border-app-border p-3">
              <textarea
                value={composer}
                onChange={(event) => onComposerChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder="Type a message…"
                rows={1}
                className="min-h-10 flex-1 resize-none rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm outline-none focus:border-app-accent"
              />
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
