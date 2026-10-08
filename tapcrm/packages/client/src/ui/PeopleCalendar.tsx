import { useEffect, useMemo, useRef } from 'react';
import {
  addCalendarDays,
  calendarDateLabel,
  calendarMonth,
  calendarMonthLabel,
  calendarWeek,
  shiftCalendarMonth,
  validDateOnly,
  validMonth,
  weekdayIndex,
} from './calendar-model.js';

export type CalendarTone = 'positive' | 'negative' | 'warning' | 'neutral' | 'muted';
export interface PeopleCalendarDay {
  date: string;
  /** Server-stored day answer, or an explicit missing/open/unevaluated label. */
  label: string;
  tone: CalendarTone;
  markers?: readonly string[];
  shiftLabel?: string | null;
  halfDay?: boolean;
}

export interface PeopleCalendarProps {
  month: string;
  selectedDate: string;
  days: readonly PeopleCalendarDay[];
  view: 'month' | 'week';
  onMonthChange: (month: string) => void;
  onSelectDate: (date: string) => void;
  onViewChange: (view: 'month' | 'week') => void;
  idPrefix?: string;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const TONE_CLASSES: Record<CalendarTone, string> = {
  positive: 'bg-emerald-500/12 text-emerald-800 dark:text-emerald-200',
  negative: 'bg-rose-500/12 text-rose-800 dark:text-rose-200',
  warning: 'bg-amber-500/14 text-amber-900 dark:text-amber-200',
  neutral: 'bg-sky-500/12 text-sky-900 dark:text-sky-200',
  muted: 'bg-app-surface-raised text-app-muted',
};

/**
 * One responsive month calendar. The desktop grid contains 28–42 DateOnly
 * cells; mobile uses a seven-day strip and a chronological list. No status is
 * inferred from event timestamps in the calendar itself.
 */
export function PeopleCalendar({
  month,
  selectedDate,
  days,
  view,
  onMonthChange,
  onSelectDate,
  onViewChange,
  idPrefix = 'people-calendar',
}: PeopleCalendarProps): React.JSX.Element {
  if (!validMonth(month) || !validDateOnly(selectedDate)) {
    throw new Error('PeopleCalendar requires a month and selected DateOnly.');
  }
  const rootRef = useRef<HTMLDivElement>(null);
  const keyboardFocusDate = useRef<string | null>(null);
  const byDate = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);
  const monthDays = useMemo(() => calendarMonth(month), [month]);
  const weekDays = useMemo(() => calendarWeek(selectedDate), [selectedDate]);
  const desktopDays = view === 'week' ? weekDays : monthDays;
  const mobileDays = view === 'week'
    ? weekDays
    : monthDays.filter((date) => date.startsWith(month));

  useEffect(() => {
    const targetDate = keyboardFocusDate.current;
    if (targetDate === null || targetDate !== selectedDate) return;
    keyboardFocusDate.current = null;
    const candidates = rootRef.current?.querySelectorAll<HTMLButtonElement>(
      `button[data-calendar-date="${targetDate}"]`,
    );
    for (const candidate of candidates ?? []) {
      if (candidate.getClientRects().length > 0) {
        candidate.focus();
        break;
      }
    }
  }, [month, selectedDate, view]);

  function selectDate(date: string, fromKeyboard = false): void {
    if (fromKeyboard) keyboardFocusDate.current = date;
    if (!date.startsWith(month)) onMonthChange(date.slice(0, 7));
    onSelectDate(date);
  }

  function handleDateKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, date: string): void {
    const week = calendarWeek(date);
    const offset = event.key === 'ArrowLeft' ? -1
      : event.key === 'ArrowRight' ? 1
        : event.key === 'ArrowUp' ? -7
          : event.key === 'ArrowDown' ? 7
            : event.key === 'Home' ? -weekdayIndex(date)
              : event.key === 'End' ? 6 - weekdayIndex(date)
                : null;
    if (offset === null) return;
    event.preventDefault();
    const nextDate = event.key === 'Home' ? week[0]!
      : event.key === 'End' ? week[6]!
        : addCalendarDays(date, offset);
    selectDate(nextDate, true);
  }

  function dayButton(date: string, surface: 'grid' | 'strip' | 'list'): React.JSX.Element {
    const day = byDate.get(date);
    const isSelected = selectedDate === date;
    const isCurrentMonth = date.startsWith(month);
    const label = day?.label ?? 'No attendance record';
    const markers = (day?.markers ?? []).slice(0, 2);
    const lateMarker = markers.find((marker) => marker.startsWith('Late +'));
    const extraMarkers = markers.filter((marker) => marker !== lateMarker);
    const statusClass = TONE_CLASSES[day?.tone ?? 'muted'];
    const base = 'group relative min-w-0 rounded-xl border text-left transition-colors duration-150 focus-visible:z-10';
    const sizing = surface === 'grid'
      ? 'min-h-25 p-2.5 lg:min-h-29'
      : surface === 'strip'
        ? 'min-h-16 p-1.5 text-center'
        : 'flex w-full items-center gap-3 p-3';
    return (
      <button
        key={`${surface}-${date}`}
        type="button"
        id={`${idPrefix}-${surface}-${date}`}
        data-calendar-date={date}
        aria-current={isSelected ? 'date' : undefined}
        aria-label={`${calendarDateLabel(date)}: ${label}${markers.length ? `; ${markers.join(', ')}` : ''}${day?.shiftLabel ? `; shift ${day.shiftLabel}` : ''}`}
        onClick={() => selectDate(date)}
        onKeyDown={(event) => handleDateKeyDown(event, date)}
        className={`${base} ${sizing} ${isSelected ? 'border-app-accent bg-app-accent/8 ring-1 ring-app-accent' : 'border-app-border bg-app-surface hover:border-app-accent/50'} ${isCurrentMonth ? '' : 'opacity-45'}`}
      >
        <span className={`${surface === 'list' ? 'w-12 shrink-0' : 'flex items-start justify-between gap-1'} text-sm font-bold tabular-nums`}>
          <span>{surface === 'list' ? calendarDateLabel(date).split(',')[0] : Number(date.slice(-2))}</span>
          {surface !== 'list' && lateMarker && <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold leading-none text-amber-800 dark:text-amber-200">{lateMarker}</span>}
        </span>
        {surface === 'list' && <span className="sr-only">{calendarDateLabel(date)}</span>}
        <span className={surface === 'list' ? 'min-w-0 flex-1' : 'mt-2 block'}>
          <span className={`inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold leading-4 ${statusClass}`}>
            {day?.halfDay && <span aria-hidden="true" className="inline-block size-2 rounded-full bg-current opacity-70 [clip-path:inset(0_50%_0_0)]" />}
            <span className="truncate">{label}</span>
          </span>
          {surface !== 'strip' && day?.shiftLabel && (
            <span className="mt-1 block truncate text-[11px] tabular-nums text-app-muted">{day.shiftLabel}</span>
          )}
          {surface !== 'strip' && extraMarkers.length > 0 && (
            <span className="mt-1 flex flex-wrap gap-1" aria-hidden="true">
              {extraMarkers.map((marker) => (
                <span key={marker} className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-200">
                  {marker}
                </span>
              ))}
            </span>
          )}
        </span>
      </button>
    );
  }

  return (
    <div ref={rootRef} className="rounded-2xl border border-app-border bg-app-surface p-3 sm:p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-app-muted">Work calendar</p>
          <h2 className="mt-0.5 text-xl font-bold tracking-tight">{calendarMonthLabel(month)}</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-app-border p-0.5" aria-label="Calendar view">
            {(['month', 'week'] as const).map((option) => (
              <button key={option} type="button" aria-pressed={view === option}
                onClick={() => onViewChange(option)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-semibold capitalize ${view === option ? 'bg-app-foreground text-app-surface' : 'text-app-muted hover:text-app-foreground'}`}>
                {option}
              </button>
            ))}
          </div>
          <button type="button" aria-label="Previous month" onClick={() => onMonthChange(shiftCalendarMonth(month, -1))}
            className="rounded-lg border border-app-border px-2.5 py-1.5 text-sm hover:border-app-accent">‹</button>
          <button type="button" aria-label="Next month" onClick={() => onMonthChange(shiftCalendarMonth(month, 1))}
            className="rounded-lg border border-app-border px-2.5 py-1.5 text-sm hover:border-app-accent">›</button>
        </div>
      </div>

      <div className="hidden grid-cols-7 gap-1.5 md:grid" role="grid" aria-label={`${calendarMonthLabel(month)} attendance`}>
        {WEEKDAYS.map((weekday) => <div key={weekday} className="px-2 pb-1 text-xs font-semibold text-app-muted">{weekday}</div>)}
        {desktopDays.map((date) => dayButton(date, 'grid'))}
      </div>
      <div className="md:hidden">
        <div className="mb-3 grid grid-cols-7 gap-1" aria-label="Selected week">
          {weekDays.map((date) => (
            <div key={date} className="min-w-0">
              <div className="mb-1 text-center text-[10px] font-semibold text-app-muted">{WEEKDAYS[weekdayIndex(date)]}</div>
              {dayButton(date, 'strip')}
            </div>
          ))}
        </div>
        <div className="space-y-1" aria-label={view === 'month' ? 'Dates this month' : 'Dates this week'}>
          {mobileDays.map((date) => dayButton(date, 'list'))}
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite">Selected {calendarDateLabel(selectedDate)}</p>
    </div>
  );
}
