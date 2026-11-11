import { useCallback, useEffect, useState } from 'react';
import { Button, Icon } from '../ui/index.js';
import { getSavedMessages, unsaveMessage, type ConversationKind, type SavedMessage } from './api/chatApi.js';
import { FileBadge } from './attachments.js';
import { Avatar } from './Avatar.js';
import { whereSent } from './conversationLabel.js';
import { toPlainText } from './markdown.js';

/**
 * "Save for later" — the viewer's personal review tray: client requirements,
 * addresses, decisions. Only they see it; it lists messages from
 * conversations they still belong to, most recently saved first.
 */
export function SavedPanel({
  currentUserId,
  onOpen,
  onClose,
  version,
}: {
  currentUserId: string;
  onOpen: (target: { conversationId: string; messageId: string; kind: ConversationKind }) => void;
  onClose: () => void;
  version: number;
}): React.JSX.Element {
  const [items, setItems] = useState<SavedMessage[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async (next?: string) => {
    try {
      const page = await getSavedMessages({ limit: 20, ...(next ? { cursor: next } : {}) });
      setItems((current) => (next ? [...(current ?? []), ...page.items] : page.items));
      setCursor(page.nextCursor);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load saved messages.');
      setItems((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, version]);

  const remove = async (messageId: string): Promise<void> => {
    try {
      await unsaveMessage(messageId);
      setItems((current) => (current ?? []).filter((item) => item.message.id !== messageId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to remove it.');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
      <div className="flex items-center justify-between gap-2 border-b border-app-border p-3">
        <p className="flex items-center gap-2 text-sm font-semibold"><Icon name="bookmark" filled className="size-4 text-[#f59e0b]" /> Saved for later</p>
        <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-xl text-app-muted hover:bg-app-surface-raised" aria-label="Close saved messages">
          <Icon name="close" className="size-4" />
        </button>
      </div>
      <div data-lenis-prevent className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        {error && <p className="px-3 py-2 text-sm text-app-danger">{error}</p>}
        {items === null ? (
          <p className="py-8 text-center text-sm text-app-muted">Loading…</p>
        ) : items.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-app-muted">
            <Icon name="bookmark" className="mx-auto mb-2 size-8 opacity-50" />
            Nothing saved yet. Use <span className="font-semibold">Save for later</span> on any message to keep it here.
          </div>
        ) : (
          <ul className="space-y-1">
            {items.map((item) => {
              const message = item.message;
              const files = message.deletedAt ? [] : (message.attachments ?? []);
              return (
                <li key={message.id} className="group flex gap-2.5 rounded-xl p-2.5 hover:bg-app-surface-raised">
                  <Avatar name={item.senderName} seed={message.senderId} size="sm" />
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen({ conversationId: item.conversation.id, messageId: message.id, kind: item.conversation.kind })}>
                    <span className="block truncate text-xs">
                      <span className="font-semibold text-app-foreground">{message.senderId === currentUserId ? 'You' : item.senderName}</span>
                      <span className="text-app-muted">{whereSent(item.conversation.kind, item.conversation.label, message.senderId === currentUserId)}</span>
                    </span>
                    <span className="mt-0.5 line-clamp-3 block text-sm text-app-foreground">
                      {message.deletedAt ? <span className="italic text-app-muted">This message was unsent</span> : toPlainText(message.body ?? '')}
                    </span>
                    {files.length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {files.slice(0, 3).map((file) => (
                          <span key={file.id} className="inline-flex max-w-full items-center gap-1 rounded-md border border-app-border bg-app-surface px-1.5 py-0.5 text-[11px]">
                            <FileBadge kind={file.kind} fileName={file.fileName} className="size-4 !text-[6px]" />
                            <span className="truncate">{file.fileName}</span>
                          </span>
                        ))}
                      </span>
                    )}
                    <span className="mt-1 block text-[11px] text-app-muted">
                      Sent {new Date(message.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short' })} · saved {new Date(item.savedAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(message.id)}
                    className="grid size-8 shrink-0 place-items-center self-start rounded-lg text-app-muted opacity-70 hover:bg-app-surface hover:text-app-danger group-hover:opacity-100"
                    aria-label="Remove from saved"
                    title="Remove from saved"
                  >
                    <Icon name="close" className="size-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {cursor && (
          <div className="py-2 text-center">
            <Button kind="secondary" onClick={() => void load(cursor)} className="!px-3 !py-1.5 !text-xs">Load more</Button>
          </div>
        )}
      </div>
    </div>
  );
}
