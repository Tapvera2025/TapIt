import { useEffect, useState } from 'react';
import { Button, Icon } from '../ui/index.js';
import { invalidatePresence } from './presence.js';
import type { ChatTransport } from './transport.js';

/**
 * A slim bar above the message box in a direct message while the other
 * person is on a break (their dot is orange). It says so in plain words, so a
 * message that goes unanswered is not a mystery, and offers to tell you when
 * they're back: the server sends that notification once their break ends.
 */
export function BreakReturnStrip({
  conversationId,
  name,
  transport,
  onError,
}: {
  conversationId: string;
  /** The other person's full name; the strip uses the first name. */
  name: string;
  transport: ChatTransport;
  onError: (message: string) => void;
}): React.JSX.Element | null {
  const [watching, setWatching] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setWatching(false);
    if (!transport.getBreakReturnWatch) return undefined;
    let current = true;
    transport.getBreakReturnWatch(conversationId)
      .then((result) => { if (current) setWatching(result.watching); })
      .catch(() => undefined);
    return () => { current = false; };
  }, [conversationId, transport]);

  const watch = transport.watchBreakReturn;
  const cancel = transport.cancelBreakReturnWatch;
  if (!watch || !cancel) return null;

  const firstName = name.trim().split(/\s+/)[0] || name;

  const toggle = async (): Promise<void> => {
    setBusy(true);
    try {
      setWatching((await (watching ? cancel(conversationId) : watch(conversationId))).watching);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'That did not work.');
      // Most likely their dot was out of date (they are already back): refresh it.
      invalidatePresence();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="status" className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-app-border bg-[#f59e0b]/10 px-4 py-2 text-xs">
      <span className="flex min-w-0 items-center gap-1.5 text-app-foreground">
        <Icon name="coffee" className="size-3.5 shrink-0 text-[#d97706]" />
        <span>
          {watching
            ? `${firstName} is on a break. You'll get a notification when they're back.`
            : `${firstName} is on a break. They'll see your message when they're back.`}
        </span>
      </span>
      <Button kind="secondary" disabled={busy} onClick={() => void toggle()} className="!px-2.5 !py-1 !text-xs">
        {watching ? 'Cancel' : `Tell me when ${firstName} is back`}
      </Button>
    </div>
  );
}
