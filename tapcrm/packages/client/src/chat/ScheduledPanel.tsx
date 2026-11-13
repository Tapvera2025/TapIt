import { useCallback, useEffect, useState } from 'react';
import { Button, Icon } from '../ui/index.js';
import type { ScheduledMessage } from './api/chatApi.js';
import { toPlainText } from './markdown.js';
import { DateTimeField, formatSendAt, weekendNote } from './SchedulePicker.js';
import type { ChatTransport } from './transport.js';

/**
 * The viewer's pending "Send later" messages in this conversation: a slim
 * bar above the composer that expands into a list where each can be
 * rescheduled, edited, sent now or cancelled.
 */
export function ScheduledPanel({
  conversationId,
  transport,
  version,
  onError,
  onSentNow,
}: {
  conversationId: string;
  transport: ChatTransport;
  /** Bump to refetch (a socket said the list changed, or the composer scheduled one). */
  version: number;
  onError: (message: string) => void;
  onSentNow: (messageId: string) => void;
}): React.JSX.Element | null {
  const [items, setItems] = useState<ScheduledMessage[]>([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState('');
  const [draftAt, setDraftAt] = useState<Date>(new Date());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!transport.getScheduledMessages) return;
    try {
      setItems(await transport.getScheduledMessages(conversationId));
    } catch {
      setItems([]);
    }
  }, [conversationId, transport]);

  useEffect(() => {
    void load();
  }, [load, version]);

  useEffect(() => {
    setOpen(false);
    setEditingId(null);
  }, [conversationId]);

  if (!transport.getScheduledMessages || items.length === 0) return null;

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await action();
      await load();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (item: ScheduledMessage): void => {
    setEditingId(item.id);
    setDraftBody(item.body);
    setDraftAt(new Date(item.sendAt));
  };

  const next = items[0]!;
  return (
    <div className="shrink-0 border-t border-app-border bg-app-surface-raised/60">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-xs text-app-muted hover:text-app-foreground" aria-expanded={open}>
        <span className="flex min-w-0 items-center gap-1.5">
          <Icon name="clock" className="size-3.5 shrink-0 text-app-accent" />
          <span className="truncate">
            {items.length === 1 ? '1 message scheduled' : `${items.length} messages scheduled`} · next {formatSendAt(new Date(next.sendAt))}
          </span>
        </span>
        <Icon name={open ? 'chevron-down' : 'chevron-up'} className="size-3.5 shrink-0" />
      </button>
      {open && (
        <ul data-lenis-prevent className="max-h-72 space-y-2 overflow-y-auto px-3 pb-3">
          {items.map((item) => (
            <li key={item.id} className="rounded-xl border border-app-border bg-app-surface p-3 text-sm">
              {editingId === item.id ? (
                <div className="space-y-2">
                  <textarea
                    value={draftBody}
                    onChange={(event) => setDraftBody(event.target.value)}
                    rows={3}
                    className="w-full resize-y rounded-lg border border-app-border bg-app-background px-2.5 py-2 text-sm outline-none focus:border-app-accent"
                    aria-label="Scheduled message text"
                  />
                  <DateTimeField value={draftAt} onChange={setDraftAt} min={new Date()} />
                  {weekendNote(draftAt) && <p className="text-xs text-[#d97706]">{weekendNote(draftAt)}</p>}
                  <div className="flex justify-end gap-2">
                    <Button kind="secondary" onClick={() => setEditingId(null)} className="!px-3 !py-1.5 !text-xs">Cancel</Button>
                    <Button
                      disabled={busy || (!draftBody.trim() && item.attachments.length === 0)}
                      onClick={() => void run(async () => {
                        await transport.updateScheduledMessage?.(item.id, { body: draftBody.trim(), sendAt: draftAt.toISOString() });
                        setEditingId(null);
                      })}
                      className="!px-3 !py-1.5 !text-xs"
                    >
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-app-accent">
                    <Icon name="clock" className="size-3.5" /> {formatSendAt(new Date(item.sendAt))}
                    {weekendNote(new Date(item.sendAt)) && <span className="font-normal text-[#d97706]">· weekend</span>}
                  </p>
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-app-foreground">
                    {toPlainText(item.body) || <span className="italic text-app-muted">No text</span>}
                  </p>
                  {item.attachments.length > 0 && (
                    <p className="mt-1 text-xs text-app-muted">📎 {item.attachments.map((file) => file.fileName).join(', ')}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button
                      kind="secondary"
                      disabled={busy}
                      onClick={() => void run(async () => {
                        const result = await transport.sendScheduledNow?.(item.id);
                        if (result?.sent && result.messageId) onSentNow(result.messageId);
                        else if (result?.failureReason) onError(result.failureReason);
                      })}
                      className="!px-2.5 !py-1 !text-xs"
                    >
                      Send now
                    </Button>
                    <Button kind="secondary" disabled={busy} onClick={() => startEdit(item)} className="!px-2.5 !py-1 !text-xs">Edit</Button>
                    <Button
                      kind="danger"
                      disabled={busy}
                      onClick={() => void run(() => transport.cancelScheduledMessage?.(item.id) ?? Promise.resolve())}
                      className="!px-2.5 !py-1 !text-xs"
                      title="Delete it — it will not be sent"
                    >
                      Delete
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
