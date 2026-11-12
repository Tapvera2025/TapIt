import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Icon } from '../ui/index.js';

/**
 * "Send later" presets — in the sender's own time zone (the browser's) —
 * plus a custom date and time. A weekend choice is called out, since not
 * messaging clients at the weekend is half the reason this exists.
 */

export function formatSendAt(date: Date): string {
  return date.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function at(base: Date, days: number, hours: number, minutes = 0): Date {
  const date = new Date(base);
  date.setDate(date.getDate() + days);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

export function schedulePresets(now: Date): { label: string; date: Date }[] {
  const presets: { label: string; date: Date }[] = [];
  const inAnHour = new Date(now.getTime() + 60 * 60_000);
  inAnHour.setMinutes(Math.ceil(inAnHour.getMinutes() / 5) * 5, 0, 0);
  presets.push({ label: 'In 1 hour', date: inAnHour });
  const evening = at(now, 0, 18);
  if (evening.getTime() - now.getTime() > 90 * 60_000) presets.push({ label: 'This evening', date: evening });
  const tomorrow = at(now, 1, 9);
  presets.push({ label: tomorrow.getDay() === 0 || tomorrow.getDay() === 6 ? 'Tomorrow (weekend)' : 'Tomorrow morning', date: tomorrow });
  const daysToMonday = ((8 - now.getDay()) % 7) || 7;
  const monday = at(now, daysToMonday, 9);
  if (daysToMonday > 1) presets.push({ label: 'Monday morning', date: monday });
  return presets;
}

function toLocalInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function DateTimeField({ value, onChange, min }: { value: Date; onChange: (date: Date) => void; min?: Date }): React.JSX.Element {
  return (
    <input
      type="datetime-local"
      value={toLocalInput(value)}
      min={min ? toLocalInput(min) : undefined}
      onChange={(event) => {
        const parsed = new Date(event.target.value);
        if (!Number.isNaN(parsed.getTime())) onChange(parsed);
      }}
      className="h-9 w-full rounded-lg border border-app-border bg-app-background px-2 text-sm outline-none focus:border-app-accent"
    />
  );
}

export function weekendNote(date: Date): string | null {
  return date.getDay() === 0 || date.getDay() === 6 ? 'That is a weekend.' : null;
}

export function SchedulePicker({ anchor, onPick, onClose }: { anchor: DOMRect; onPick: (date: Date) => void; onClose: () => void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const now = useMemo(() => new Date(), []);
  const presets = useMemo(() => schedulePresets(now), [now]);
  const [custom, setCustom] = useState<Date | null>(null);
  const [position, setPosition] = useState({ top: -9999, left: -9999 });
  const width = 280;

  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight ?? 260;
    const top = Math.max(8, anchor.top - height - 6);
    const left = Math.min(Math.max(8, anchor.right - width), window.innerWidth - width - 8);
    setPosition({ top, left });
  }, [anchor, custom]);

  // Added once (see EmojiPopover): a new `onClose` each render must not drop an Escape.
  const dismiss = useEffectEvent(() => onClose());
  useEffect(() => {
    const close = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) dismiss();
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') dismiss();
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', close), 0);
    document.addEventListener('keydown', escape);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, []);

  const tooSoon = custom !== null && custom.getTime() < Date.now() + 60_000;

  return createPortal(
    <div ref={ref} data-chat-popover role="dialog" aria-label="Send later" className="fixed z-[61] rounded-xl border border-app-border bg-app-surface p-1.5 shadow-2xl" style={{ top: position.top, left: position.left, width }}>
      <p className="flex items-center gap-1.5 px-2 pb-1 pt-1.5 text-xs font-semibold text-app-muted"><Icon name="clock" className="size-3.5" /> Send later</p>
      {presets.map((preset) => (
        <button key={preset.label} type="button" onClick={() => onPick(preset.date)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-app-surface-raised">
          <span>{preset.label}</span>
          <span className="text-xs text-app-muted">{formatSendAt(preset.date)}</span>
        </button>
      ))}
      <div className="my-1 h-px bg-app-border" />
      {custom === null ? (
        <button type="button" onClick={() => setCustom(new Date(now.getTime() + 2 * 3_600_000))} className="w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-app-surface-raised">
          Custom date and time…
        </button>
      ) : (
        <div className="space-y-2 p-2">
          <DateTimeField value={custom} onChange={setCustom} min={now} />
          {weekendNote(custom) && <p className="text-xs text-[#d97706]">{weekendNote(custom)}</p>}
          {tooSoon && <p className="text-xs text-app-danger">Choose a time at least a minute from now.</p>}
          <Button onClick={() => onPick(custom)} disabled={tooSoon} className="w-full !py-1.5 !text-xs">Schedule for {formatSendAt(custom)}</Button>
        </div>
      )}
      <p className="px-2 pb-1 pt-1 text-[11px] text-app-muted">Times are in your time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone}).</p>
    </div>,
    document.body,
  );
}
