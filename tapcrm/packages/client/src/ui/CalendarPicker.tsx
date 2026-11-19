import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, InputHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.js';

type DateInputType = 'date' | 'month';
type PickerChangeEvent = Pick<ChangeEvent<HTMLInputElement>, 'target'>;
type ElementRef = { current: HTMLElement | null };
type PopoverPosition = { left: number; top: number; width: number; maxHeight: number };

function useAnchoredPopoverPosition(
  open: boolean,
  anchorRef: ElementRef,
  panelRef: ElementRef,
  preferredWidth: number,
): PopoverPosition | null {
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const place = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const panel = panelRef.current;
      if (!anchor || !panel) return;

      const edge = 12;
      const gap = 8;
      const boundary = anchorRef.current?.closest<HTMLElement>('dialog[open], [role="dialog"]');
      const boundaryRect = boundary?.getBoundingClientRect();
      const minLeft = Math.max(edge, (boundaryRect?.left ?? 0) + edge);
      const maxRight = Math.min(window.innerWidth - edge, (boundaryRect?.right ?? window.innerWidth) - edge);
      const minTop = Math.max(edge, (boundaryRect?.top ?? 0) + edge);
      const maxBottom = Math.min(window.innerHeight - edge, (boundaryRect?.bottom ?? window.innerHeight) - edge);
      const availableWidth = Math.max(80, maxRight - minLeft);
      const width = Math.min(preferredWidth, availableWidth);
      const left = Math.max(minLeft, Math.min(anchor.left, maxRight - width));
      const belowSpace = Math.max(0, maxBottom - anchor.bottom - gap);
      const aboveSpace = Math.max(0, anchor.top - minTop - gap);
      const naturalHeight = panel.scrollHeight;
      const placeAbove = belowSpace < naturalHeight && aboveSpace > belowSpace;
      const availableHeight = Math.max(80, maxBottom - minTop);
      const maxHeight = Math.min(naturalHeight, availableHeight);
      const rawTop = placeAbove ? anchor.top - gap - maxHeight : anchor.bottom + gap;
      const top = Math.max(minTop, Math.min(rawTop, maxBottom - maxHeight));
      setPosition((current) => current && current.left === left && current.top === top && current.width === width && current.maxHeight === maxHeight
        ? current
        : { left, top, width, maxHeight });
    };

    place();
    // Portalled panels can attach their ref one paint after the anchor's
    // layout effect. Retry once after the portal has committed so the picker
    // never remains stuck in its hidden measurement state.
    const frame = window.requestAnimationFrame(place);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchorRef, panelRef, preferredWidth]);

  return position;
}

export type CalendarPickerProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'min' | 'max'> & {
  type: DateInputType;
  value: string;
  min?: string | undefined;
  max?: string | undefined;
  onChange: (event: PickerChangeEvent) => void;
};

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDateKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return dateKey(date) === value ? date : null;
}

function dateLabel(value: string): string {
  const date = parseDateKey(value);
  return date
    ? `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()}`
    : '';
}

function monthLabel(value: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return '';
  return new Date(Number(match[1]), Number(match[2]) - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function withinDateBounds(value: string, min?: string, max?: string): boolean {
  return (!min || value >= min) && (!max || value <= max);
}

/** Shared single date and month picker used in form fields across the app. */
export function CalendarPicker({
  type,
  value,
  onChange,
  id,
  name,
  min,
  max,
  required,
  disabled,
  placeholder,
  className = '',
  autoComplete,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  onKeyDown: onInputKeyDown,
  ...inputAttributes
}: CalendarPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const selectedDate = type === 'date' ? parseDateKey(value) : null;
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const current = selectedDate ?? new Date();
    return new Date(current.getFullYear(), current.getMonth(), 1);
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const popoverPosition = useAnchoredPopoverPosition(open, rootRef, panelRef, 320);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const firstDay = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1).getDay();
  const monthLength = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate();
  const cells = useMemo(() => [
    ...Array.from({ length: firstDay }, () => null),
    ...Array.from({ length: monthLength }, (_, index) => new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), index + 1)),
  ], [firstDay, monthLength, visibleMonth]);
  const shownValue = type === 'month' ? monthLabel(value) : dateLabel(value);
  const accessibleLabel = ariaLabel ?? (type === 'month' ? 'Choose month' : 'Choose date');

  function emit(nextValue: string) {
    if (nextValue && type === 'date' && !withinDateBounds(nextValue, min, max)) return;
    if (nextValue && type === 'month' && !withinDateBounds(nextValue, min?.slice(0, 7), max?.slice(0, 7))) return;
    onChange({ target: { value: nextValue } as HTMLInputElement });
    setOpen(false);
  }

  function openPicker() {
    if (disabled) return;
    const date = type === 'date' ? parseDateKey(value) : null;
    const month = type === 'month' ? /^(\d{4})-(\d{2})$/.exec(value) : null;
    const current = date ?? (month
      ? new Date(Number(month[1]), Number(month[2]) - 1, 1)
      : new Date());
    setVisibleMonth(new Date(current.getFullYear(), current.getMonth(), 1));
    setOpen(true);
  }

  const panelClass = 'calendar-popover-scroll fixed z-[200] max-w-[calc(100vw-1.5rem)] overflow-y-auto overscroll-contain rounded-2xl border border-app-border bg-app-surface p-3.5 shadow-xl sm:p-4';

  return (
    <div ref={rootRef} className="relative w-full">
      {name && <input type="hidden" name={name} value={value} disabled={disabled} />}
      <div className="relative">
        <input
          {...inputAttributes}
          id={id}
          type="text"
          required={required}
          disabled={disabled}
          inputMode="none"
          autoComplete={autoComplete}
          value={shownValue}
          placeholder={placeholder ?? (type === 'month' ? 'Select month' : 'dd-mm-yyyy')}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          aria-haspopup="dialog"
          aria-expanded={open}
          // Not readOnly: browsers skip validation on read-only inputs, so a
          // `required` date would let an empty form through. Typing, pasting and
          // deleting are blocked by onBeforeInput below, and inputMode="none"
          // keeps the phone keyboard closed.
          onPointerDown={(event) => {
            // A real pointer handler is more reliable than relying on the
            // text input's synthetic click inside nested modal forms.
            event.preventDefault();
            openPicker();
          }}
          onBeforeInput={(event) => event.preventDefault()}
          onChange={() => undefined}
          onKeyDown={(event) => {
            onInputKeyDown?.(event);
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              openPicker();
            }
          }}
          className={`ui-form-control w-full cursor-pointer px-3 py-2.5 pr-10 text-sm text-app-foreground outline-none disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
        />
        <button
          type="button"
          aria-label={accessibleLabel}
          disabled={disabled}
          onPointerDown={(event) => {
            event.preventDefault();
            openPicker();
          }}
          onClick={openPicker}
          className="absolute inset-y-0 right-0 grid w-10 place-items-center text-app-muted transition hover:text-app-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Icon name="calendar" className="size-4" />
        </button>
      </div>
      {open && createPortal((
        <section
          ref={panelRef}
          role="dialog"
          aria-label={accessibleLabel}
          className={panelClass}
          style={popoverPosition ? {
            left: popoverPosition.left,
            top: popoverPosition.top,
            width: popoverPosition.width,
            maxHeight: popoverPosition.maxHeight,
          } : { width: 320, visibility: 'hidden' }}
        >
          <header className="flex items-center justify-between gap-2">
            <button
              type="button"
              aria-label={type === 'month' ? 'Previous year' : 'Previous month'}
              onClick={() => setVisibleMonth((current) => new Date(current.getFullYear() - (type === 'month' ? 1 : 0), current.getMonth() - (type === 'date' ? 1 : 0), 1))}
              className="grid size-8 place-items-center rounded-lg text-app-muted transition hover:bg-app-surface-raised hover:text-app-foreground"
            >
              <Icon name="chevron-left" className="size-4" />
            </button>
            <p className="text-sm font-semibold text-app-foreground">
              {type === 'month'
                ? visibleMonth.getFullYear()
                : visibleMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </p>
            <button
              type="button"
              aria-label={type === 'month' ? 'Next year' : 'Next month'}
              onClick={() => setVisibleMonth((current) => new Date(current.getFullYear() + (type === 'month' ? 1 : 0), current.getMonth() + (type === 'date' ? 1 : 0), 1))}
              className="grid size-8 place-items-center rounded-lg text-app-muted transition hover:bg-app-surface-raised hover:text-app-foreground"
            >
              <Icon name="chevron-right" className="size-4" />
            </button>
          </header>

          {type === 'date' ? (
            <>
              <div className="mt-2 grid grid-cols-7 text-center text-[10px] font-semibold uppercase text-app-muted">
                {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => <span key={day} className="py-1.5">{day}</span>)}
              </div>
              <div className="grid grid-cols-7 gap-y-1 text-center">
                {cells.map((date, index) => {
                  if (!date) return <span key={`blank-${index}`} />;
                  const key = dateKey(date);
                  const isSelected = key === value;
                  const isDisabled = !withinDateBounds(key, min, max);
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={isDisabled}
                      aria-label={date.toLocaleDateString()}
                      aria-pressed={isSelected}
                      onClick={() => emit(key)}
                      className={`mx-auto grid size-8 place-items-center rounded-full text-xs transition ${isSelected ? 'bg-app-accent font-semibold text-app-on-accent' : 'text-app-foreground hover:bg-app-accent/10 hover:text-app-accent'} disabled:cursor-not-allowed disabled:opacity-30`}
                    >
                      {date.getDate()}
                    </button>
                  );
                })}
              </div>
              <footer className="mt-3 flex justify-between border-t border-app-border/70 pt-3">
                <button type="button" onClick={() => emit('')} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-app-muted hover:bg-app-surface-raised hover:text-app-foreground">Clear</button>
                <button type="button" disabled={!withinDateBounds(dateKey(new Date()), min, max)} onClick={() => emit(dateKey(new Date()))} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-app-accent hover:bg-app-accent/10 disabled:cursor-not-allowed disabled:opacity-40">Today</button>
              </footer>
            </>
          ) : (
            <div className="mt-3 grid grid-cols-3 gap-1.5">
              {Array.from({ length: 12 }, (_, index) => {
                const key = monthKey(visibleMonth.getFullYear(), index);
                const disabledMonth = !withinDateBounds(key, min?.slice(0, 7), max?.slice(0, 7));
                const selected = key === value;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={disabledMonth}
                    aria-pressed={selected}
                    onClick={() => emit(key)}
                    className={`min-h-10 rounded-lg text-xs font-medium transition ${selected ? 'bg-app-accent text-app-on-accent' : 'text-app-foreground hover:bg-app-accent/10 hover:text-app-accent'} disabled:cursor-not-allowed disabled:opacity-30`}
                  >
                    {new Date(visibleMonth.getFullYear(), index, 1).toLocaleDateString(undefined, { month: 'short' })}
                  </button>
                );
              })}
            </div>
          )}
        </section>
      ), document.body)}
    </div>
  );
}

export type DateRangeCalendarProps = {
  open: boolean;
  startDate: string;
  endDate: string;
  onRangeChange: (startDate: string, endDate: string) => void;
  onApply: () => void;
  onCancel: () => void;
  anchorRef?: ElementRef;
  className?: string;
  label?: string;
};

/** Shared custom range calendar used by the task filter and other date-range pickers. */
export function DateRangeCalendar({
  open,
  startDate,
  endDate,
  onRangeChange,
  onApply,
  onCancel,
  anchorRef,
  className,
  label = 'Select date range',
}: DateRangeCalendarProps): React.JSX.Element | null {
  const initialDate = parseDateKey(startDate) ?? new Date();
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(initialDate.getFullYear(), initialDate.getMonth(), 1));
  const fallbackAnchorRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const popoverPosition = useAnchoredPopoverPosition(open, anchorRef ?? fallbackAnchorRef, panelRef, 336);
  useEffect(() => {
    if (!open) return;
    const current = parseDateKey(startDate) ?? new Date();
    setVisibleMonth(new Date(current.getFullYear(), current.getMonth(), 1));
  }, [open]);

  if (!open) return null;
  const firstDay = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1).getDay();
  const monthLength = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array.from({ length: firstDay }, () => null),
    ...Array.from({ length: monthLength }, (_, index) => new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), index + 1)),
  ];

  function selectDate(date: Date) {
    const key = dateKey(date);
    if (!startDate || endDate) {
      onRangeChange(key, '');
    } else if (key < startDate) {
      onRangeChange(key, '');
    } else {
      onRangeChange(startDate, key);
    }
  }

  function selectQuickRange(range: 'today' | 'week' | 'month') {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    if (range === 'week') {
      const daysSinceMonday = (start.getDay() + 6) % 7;
      start.setDate(start.getDate() - daysSinceMonday);
      end.setTime(start.getTime());
      end.setDate(end.getDate() + 6);
    } else if (range === 'month') {
      start.setDate(1);
      end.setMonth(end.getMonth() + 1, 0);
    }
    onRangeChange(dateKey(start), dateKey(end));
    setVisibleMonth(new Date(start.getFullYear(), start.getMonth(), 1));
  }

  return (
    <section
      ref={panelRef}
      role="dialog"
      aria-label={label}
      className={`calendar-popover-scroll ${className ?? 'fixed z-[70] overflow-y-auto overscroll-contain rounded-2xl border border-app-border bg-app-surface p-4 shadow-2xl'}`}
      style={popoverPosition ? {
        left: popoverPosition.left,
        top: popoverPosition.top,
        width: popoverPosition.width,
        maxHeight: popoverPosition.maxHeight,
      } : { width: 336, visibility: 'hidden' }}
    >
      <header className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-app-foreground">Select date range</h3>
        <button type="button" onClick={() => onRangeChange('', '')} className="text-xs font-medium text-app-accent hover:underline">Clear</button>
      </header>
      <div className="mt-3 flex items-center justify-between">
        <button type="button" aria-label="Previous month" onClick={() => setVisibleMonth((month) => new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="grid size-8 place-items-center rounded-lg text-app-muted hover:bg-app-surface-raised hover:text-app-foreground"><Icon name="chevron-left" className="size-4" /></button>
        <p className="text-sm font-semibold text-app-foreground">{visibleMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p>
        <button type="button" aria-label="Next month" onClick={() => setVisibleMonth((month) => new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="grid size-8 place-items-center rounded-lg text-app-muted hover:bg-app-surface-raised hover:text-app-foreground"><Icon name="chevron-right" className="size-4" /></button>
      </div>
      <div className="mt-2 grid grid-cols-7 text-center text-[10px] font-semibold uppercase text-app-muted">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => <span key={day} className="py-1">{day}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center">
        {cells.map((date, index) => {
          if (!date) return <span key={`blank-${index}`} />;
          const key = dateKey(date);
          const isStart = key === startDate;
          const isEnd = key === endDate;
          const inRange = Boolean(startDate && endDate && key > startDate && key < endDate);
          return (
            <button
              key={key}
              type="button"
              onClick={() => selectDate(date)}
              aria-label={date.toLocaleDateString()}
              aria-pressed={isStart || isEnd}
              className={`mx-auto grid size-7 place-items-center rounded-full text-xs transition-colors sm:size-8 ${isStart || isEnd ? 'bg-app-accent text-app-on-accent' : inRange ? 'rounded-lg bg-app-accent/10 text-app-accent' : 'text-app-foreground hover:bg-app-surface-raised'}`}
            >{date.getDate()}</button>
          );
        })}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1.5 border-t border-app-border/70 pt-3">
        {([['today', 'Today'], ['week', 'This Week'], ['month', 'This Month']] as const).map(([range, text]) => (
          <button key={range} type="button" onClick={() => selectQuickRange(range)} className="min-h-8 rounded-lg bg-app-surface-raised px-1.5 text-[10px] font-medium text-app-muted transition-colors hover:bg-app-accent/10 hover:text-app-accent sm:text-xs">{text}</button>
        ))}
      </div>
      <footer className="mt-3 flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs font-medium text-app-muted hover:bg-app-surface-raised hover:text-app-foreground">Cancel</button>
        <button type="button" disabled={!startDate || !endDate} onClick={onApply} className="rounded-lg bg-app-accent px-3 py-1.5 text-xs font-semibold text-app-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">Apply</button>
      </footer>
    </section>
  );
}
