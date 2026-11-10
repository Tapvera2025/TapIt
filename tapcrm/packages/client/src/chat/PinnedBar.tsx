import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/index.js';
import type { ChatMessage, PinnedMessage } from './api/chatApi.js';
import { toPlainText } from './markdown.js';
import type { ChatTransport } from './transport.js';

function summary(message: ChatMessage): string {
  if (message.deletedAt) return 'Message unsent';
  const text = toPlainText(message.body ?? '');
  if (text) return text;
  const files = message.attachments ?? [];
  if (files.length === 1) return files[0]!.kind === 'image' ? '📷 Photo' : `📎 ${files[0]!.fileName}`;
  return files.length > 1 ? `📎 ${files.length} files` : '';
}

/**
 * The pins of a conversation, under its header: the newest pin (click to
 * jump to it), a counter that cycles through the others, and a list with
 * jump/unpin for each.
 */
export function PinnedBar({
  conversationId,
  transport,
  version,
  memberName,
  onJump,
  onError,
}: {
  conversationId: string;
  transport: ChatTransport;
  version: number;
  memberName: (userId: string) => string;
  onJump: (messageId: string) => void;
  onError: (message: string) => void;
}): React.JSX.Element | null {
  const [pins, setPins] = useState<PinnedMessage[]>([]);
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const next = await transport.getPins(conversationId);
      setPins(next);
      setIndex((current) => Math.min(current, Math.max(0, next.length - 1)));
    } catch {
      setPins([]);
    }
  }, [conversationId, transport]);

  useEffect(() => {
    setIndex(0);
    setOpen(false);
  }, [conversationId]);

  useEffect(() => {
    void load();
  }, [load, version]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent): void => {
      if (listRef.current && !listRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (pins.length === 0) return null;
  const current = pins[index] ?? pins[0]!;

  return (
    <div ref={listRef} data-chat-popover className="relative z-20 shrink-0 border-b border-app-border bg-app-surface/95 px-3 py-1.5 sm:px-5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            onJump(current.message.id);
            if (pins.length > 1) setIndex((value) => (value + 1) % pins.length);
          }}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-app-surface-raised"
          title="Go to pinned message"
        >
          <span className="flex shrink-0 flex-col gap-0.5" aria-hidden="true">
            {pins.slice(0, 4).map((pin, dotIndex) => (
              <span key={pin.message.id} className={`h-1.5 w-0.5 rounded-full ${dotIndex === index % 4 ? 'bg-app-accent' : 'bg-app-border'}`} />
            ))}
          </span>
          <Icon name="pushpin" className="size-4 shrink-0 text-app-accent" />
          <span className="min-w-0">
            <span className="block text-[11px] font-semibold text-app-accent">
              Pinned{pins.length > 1 ? ` · ${index + 1} of ${pins.length}` : ''}
            </span>
            <span className="block truncate text-xs text-app-foreground">
              <span className="font-semibold">{memberName(current.message.senderId)}:</span> {summary(current.message)}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-app-muted hover:bg-app-surface-raised hover:text-app-accent"
          aria-expanded={open}
        >
          {open ? 'Close' : `All pins (${pins.length})`}
        </button>
      </div>
      {open && (
        <div data-lenis-prevent className="absolute inset-x-3 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-xl border border-app-border bg-app-surface p-1.5 shadow-xl sm:inset-x-5">
          {pins.map((pin) => (
            <div key={pin.message.id} className="flex items-start gap-2 rounded-lg p-2 hover:bg-app-surface-raised">
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { setOpen(false); onJump(pin.message.id); }}>
                <span className="block text-xs font-semibold">{memberName(pin.message.senderId)}</span>
                <span className="line-clamp-2 block text-sm text-app-foreground">{summary(pin.message)}</span>
                <span className="mt-0.5 block text-[11px] text-app-muted">
                  Pinned by {pin.pinnedByName} · {new Date(pin.pinnedAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}
                </span>
              </button>
              {transport.unpinMessage && (
                <button
                  type="button"
                  onClick={() => void transport.unpinMessage?.(pin.message.id).then(() => load()).catch((cause: unknown) => onError(cause instanceof Error ? cause.message : 'Unable to unpin.'))}
                  className="grid size-7 shrink-0 place-items-center rounded-md text-app-muted hover:bg-app-surface hover:text-app-danger"
                  aria-label="Unpin"
                  title="Unpin"
                >
                  <Icon name="pushpin-off" className="size-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
