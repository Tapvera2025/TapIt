import { useEffect, useMemo, useState } from 'react';
import type { MeetingSlot } from './api.js';
import { formatClock, groupSlotsByDay } from './format.js';

/**
 * Free times, a day at a time. With `max` above 1 several can be picked (the
 * times a host offers); otherwise picking one replaces the last.
 */
export function SlotPicker({
  slots,
  timeZone,
  selected,
  onChange,
  max = 1,
  loading = false,
  emptyText = 'No free times in the next few weeks.',
}: {
  slots: readonly MeetingSlot[];
  timeZone: string;
  selected: readonly string[];
  onChange: (startsAt: string[]) => void;
  max?: number;
  loading?: boolean;
  emptyText?: string;
}): React.JSX.Element {
  const days = useMemo(() => groupSlotsByDay(slots, timeZone), [slots, timeZone]);
  const [dayKey, setDayKey] = useState<string>('');
  useEffect(() => {
    if (!days.some((day) => day.key === dayKey)) setDayKey(days[0]?.key ?? '');
  }, [days, dayKey]);
  const day = days.find((item) => item.key === dayKey);

  if (loading) return <p className="text-sm text-app-muted" role="status">Finding free times…</p>;
  if (days.length === 0) return <p className="text-sm text-app-muted">{emptyText}</p>;

  const toggle = (startsAt: string) => {
    if (selected.includes(startsAt)) onChange(selected.filter((item) => item !== startsAt));
    else if (max === 1) onChange([startsAt]);
    else if (selected.length < max) onChange([...selected, startsAt]);
  };

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex max-w-full gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Days with free times">
        {days.map((item) => {
          const picked = item.slots.some((slot) => selected.includes(slot.startsAt));
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={item.key === dayKey}
              onClick={() => setDayKey(item.key)}
              className={`shrink-0 rounded-xl border px-3 py-2 text-xs font-semibold transition ${item.key === dayKey ? 'border-app-accent bg-app-accent/10 text-app-accent' : 'border-app-border text-app-foreground hover:border-app-accent'}`}
            >
              {item.label}
              {picked && <span className="ml-1" aria-label="has a picked time">•</span>}
            </button>
          );
        })}
      </div>
      {day && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label={`Free times on ${day.label}`}>
          {day.slots.map((slot) => {
            const on = selected.includes(slot.startsAt);
            const full = !on && max > 1 && selected.length >= max;
            return (
              <button
                key={slot.startsAt}
                type="button"
                aria-pressed={on}
                disabled={full}
                onClick={() => toggle(slot.startsAt)}
                className={`rounded-lg border px-2 py-2 text-sm font-semibold transition disabled:opacity-40 ${on ? 'ui-primary border-transparent' : 'border-app-border hover:border-app-accent'}`}
              >
                {formatClock(slot.startsAt, timeZone)}
              </button>
            );
          })}
        </div>
      )}
      {max > 1 && <p className="text-xs text-app-muted">{selected.length} of up to {max} times picked.</p>}
    </div>
  );
}
