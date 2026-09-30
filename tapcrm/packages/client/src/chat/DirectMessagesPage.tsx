import { useEffect, useMemo, useRef, useState } from 'react';
import { getCompanyEmployees, type CompanyEmployee } from '../company/api/companyApi.js';
import { Button, Empty, Loading } from '../ui/components.js';
import {
  REACTION_EMOJI,
  forwardMessage,
  reactToMessage,
  removeReaction,
  sendMessage,
  startDirectConversation,
  unsendMessage,
  type ChatMessage,
  type Conversation,
  type ReactionEmoji,
} from './api/chatApi.js';
import { useChat } from './useChat.js';

function otherMember(conversation: Conversation, myId: string): { userId: string; fullName: string } | null {
  const other = conversation.members.find((m) => m.userId !== myId);
  return other ? { userId: other.userId, fullName: other.fullName } : null;
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Direct Messages — Phase 2 of the messaging build. One of the three planned
 * tabs (Project Group and Internal Group land in Phase 3/4); see
 * team-docs for the full plan and packages/server/src/modules/chat for the
 * reference server implementation this UI talks to.
 */
export function DirectMessagesPage({ currentUserId }: { currentUserId: string }): React.JSX.Element {
  const chat = useChat();
  const [showPicker, setShowPicker] = useState(false);
  const [colleagues, setColleagues] = useState<CompanyEmployee[]>([]);
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

  const openPicker = (): void => {
    setShowPicker(true);
    if (colleagues.length === 0) {
      void getCompanyEmployees()
        .then((list) => setColleagues(list.filter((e) => e.id !== currentUserId)))
        .catch(() => setColleagues([]));
    }
  };

  const startChatWith = async (userId: string): Promise<void> => {
    setShowPicker(false);
    try {
      const conversation = await startDirectConversation(userId);
      await chat.refreshConversations();
      await chat.openConversation(conversation.id);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Unable to start conversation.');
    }
  };

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
          <p className="text-sm font-semibold">Direct Messages</p>
          <Button onClick={openPicker} className="!px-3 !py-1.5 !text-xs">New</Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {chat.conversations.length === 0 && <Empty>No conversations yet. Start one with &quot;New&quot;.</Empty>}
          <ul>
            {chat.conversations.map((conversation) => {
              const other = otherMember(conversation, currentUserId);
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
                        <span className="truncate text-sm font-semibold">{other?.fullName ?? 'Conversation'}</span>
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
            <div className="border-b border-app-border p-4">
              <p className="text-sm font-semibold">{activeConversation ? (otherMember(activeConversation, currentUserId)?.fullName ?? 'Conversation') : ''}</p>
              {chat.typingUsers.length > 0 && <p className="text-xs text-app-accent">typing…</p>}
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
                      return (
                        <li key={message.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
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

      {showPicker && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setShowPicker(false)}>
          <div className="ui-card max-h-[70vh] w-full max-w-sm overflow-y-auto p-4" onClick={(event) => event.stopPropagation()}>
            <p className="mb-3 text-sm font-semibold">Start a conversation</p>
            {colleagues.length === 0 ? (
              <Loading />
            ) : (
              <ul>
                {colleagues.map((person) => (
                  <li key={person.id}>
                    <button type="button" onClick={() => void startChatWith(person.id)} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-app-surface-raised">
                      {person.fullName}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {forwardingMessage && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setForwardingMessage(null)}>
          <div className="ui-card max-h-[70vh] w-full max-w-sm overflow-y-auto p-4" onClick={(event) => event.stopPropagation()}>
            <p className="mb-3 text-sm font-semibold">Forward to…</p>
            <ul>
              {chat.conversations.map((conversation) => {
                const other = otherMember(conversation, currentUserId);
                return (
                  <li key={conversation.id}>
                    <button type="button" onClick={() => void onForward(conversation.id)} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-app-surface-raised">
                      {other?.fullName ?? 'Conversation'}
                    </button>
                  </li>
                );
              })}
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
