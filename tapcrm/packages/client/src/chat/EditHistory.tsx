import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChatMessage, MessageEdit } from './api/chatApi.js';
import { toPlainText } from './markdown.js';
import type { ChatTransport } from './transport.js';

function when(iso: string): string {
  return new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/** Every version of an edited message, newest first — visible to everyone in the conversation. */
export function EditHistory({ message, transport, align }: { message: ChatMessage; transport: ChatTransport; align: 'left' | 'right' }): React.JSX.Element {
  const [edits, setEdits] = useState<MessageEdit[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [below, setBelow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Open above the label, unless the top of the thread would cut it off.
  useLayoutEffect(() => {
    const popover = ref.current;
    const anchor = popover?.parentElement;
    if (!popover || !anchor) return;
    const top = popover.closest('[data-chat-thread]')?.getBoundingClientRect().top ?? 0;
    setBelow(anchor.getBoundingClientRect().top - popover.offsetHeight - 4 < top);
  }, [edits, failed]);

  useEffect(() => {
    let alive = true;
    transport.getMessageEdits(message.conversationId, message.id)
      .then((list) => alive && setEdits(list))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [message.conversationId, message.id, message.editedAt, transport]);

  return (
    <div
      ref={ref}
      data-chat-popover
      role="dialog"
      aria-label="Edit history"
      className={`absolute z-40 w-72 max-w-[80vw] rounded-xl border border-app-border bg-app-surface p-2 text-left text-xs text-app-foreground shadow-xl ${below ? 'top-full mt-1' : 'bottom-full mb-1'} ${align === 'right' ? 'right-0' : 'left-0'}`}
    >
      <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-app-muted">Edit history</p>
      {failed ? (
        <p className="px-1 py-1 text-app-muted">History is unavailable.</p>
      ) : edits === null ? (
        <p className="px-1 py-1 text-app-muted">Loading…</p>
      ) : (
        <ol data-lenis-prevent className="max-h-64 space-y-1.5 overflow-y-auto">
          <li className="rounded-lg bg-app-accent/10 px-2 py-1.5">
            <p className="text-[10px] font-semibold text-app-accent">Now{message.editedAt ? ` · edited ${when(message.editedAt)}` : ''}</p>
            <p className="whitespace-pre-wrap break-words">{toPlainText(message.body ?? '') || '—'}</p>
          </li>
          {edits.map((edit, index) => (
            <li key={edit.id} className="rounded-lg bg-app-surface-raised px-2 py-1.5">
              <p className="text-[10px] font-semibold text-app-muted">
                {index === edits.length - 1 ? `Original · sent ${when(message.createdAt)}` : `Before the edit at ${when(edit.editedAt)}`}
              </p>
              <p className="whitespace-pre-wrap break-words">{toPlainText(edit.previousBody) || '—'}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
