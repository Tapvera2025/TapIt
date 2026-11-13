export function formatCallbackDate(value: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(value));
}

export function organizationLocalToIso(value: string, timezone: string): string {
  const [date = '', clock = ''] = value.split('T');
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const [hour = 0, minute = 0] = clock.split(':').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let instant = target;
  for (let index = 0; index < 3; index += 1) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant));
    const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)])) as Record<string, number | undefined>;
    instant += target - Date.UTC(values['year'] ?? year, (values['month'] ?? month) - 1, values['day'] ?? day, values['hour'] ?? hour, values['minute'] ?? minute);
  }
  return new Date(instant).toISOString();
}

/** The current time in `timezone`, in the "YYYY-MM-DDTHH:mm" form a datetime-local input uses. */
export function organizationNowLocal(timezone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}`;
}

/** An hour after the callback's time, or an hour from now if that time has passed. */
export function anHourLater(scheduledAt: string, now: Date = new Date()): string {
  return new Date(Math.max(new Date(scheduledAt).getTime(), now.getTime()) + 60 * 60 * 1000).toISOString();
}

const CALLBACK_STATUS_LABELS: Readonly<Record<string, string>> = {
  pending: 'Pending',
  completed: 'Completed',
  rescheduled: 'Rescheduled',
  not_reachable: 'Not reachable',
  missed: 'Missed',
  cancelled: 'Cancelled',
};

export function callbackStatusLabel(status: string): string {
  return CALLBACK_STATUS_LABELS[status] ?? sentenceLabel(status);
}

/** A code such as "follow_up_required" as words: "Follow up required". */
export function sentenceLabel(code: string): string {
  const words = code.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

interface CallbackForFilter {
  readonly ownerId: string;
  readonly ownerName: string | null;
  readonly leadNumber: string;
  readonly leadContactName: string;
}

/**
 * The people who own the listed callbacks, by name, for the owner filter.
 * Owners already offered stay in the list when other filters hide their callbacks.
 */
export function callbackOwnerOptions(
  callbacks: readonly CallbackForFilter[],
  known: ReadonlyArray<{ value: string; label: string }> = [],
): Array<{ value: string; label: string }> {
  const owners = new Map<string, string>(
    known.map((owner) => [owner.value, owner.label]),
  );
  for (const callback of callbacks)
    owners.set(callback.ownerId, callback.ownerName ?? 'Unknown owner');
  return [...owners]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Callbacks for the chosen owner whose lead name or number matches the search ("#154" works too). */
export function filterCallbacks<T extends CallbackForFilter>(
  callbacks: readonly T[],
  ownerId: string,
  leadSearch: string,
): T[] {
  const search = leadSearch.trim().replace(/^#/, '').toLowerCase();
  return callbacks.filter(
    (callback) =>
      (!ownerId || callback.ownerId === ownerId) &&
      (!search ||
        callback.leadContactName.toLowerCase().includes(search) ||
        callback.leadNumber === search),
  );
}

/** How the callback list and board are ordered. */
export type CallbackOrder = 'newest' | 'latest_time' | 'soonest_time';

export const CALLBACK_ORDER_OPTIONS: ReadonlyArray<{ value: CallbackOrder; label: string }> = [
  { value: 'newest', label: 'Newest booked first' },
  { value: 'latest_time', label: 'Callback time, latest first' },
  { value: 'soonest_time', label: 'Callback time, soonest first' },
];

interface CallbackForOrder {
  readonly id: string;
  readonly scheduledAt: string;
  readonly createdAt?: string | undefined;
}

const instant = (value: string | undefined): number => (value ? new Date(value).getTime() : 0);

/**
 * Callbacks in the chosen order. "Newest booked first" puts the callback set
 * most recently at the top (falling back to its time when the booking time is
 * missing); the other two order by the callback's own time.
 */
export function sortCallbacks<T extends CallbackForOrder>(callbacks: readonly T[], order: CallbackOrder = 'newest'): T[] {
  const byTime = (a: T, b: T) => instant(a.scheduledAt) - instant(b.scheduledAt);
  return [...callbacks].sort((a, b) => {
    if (order === 'soonest_time') return byTime(a, b) || a.id.localeCompare(b.id);
    if (order === 'latest_time') return byTime(b, a) || a.id.localeCompare(b.id);
    return (instant(b.createdAt) - instant(a.createdAt)) || byTime(b, a) || a.id.localeCompare(b.id);
  });
}

/** A pending callback whose time has passed. */
export function isOverdueCallback(callback: { status: string; scheduledAt: string }, now: Date = new Date()): boolean {
  return callback.status === 'pending' && new Date(callback.scheduledAt).getTime() < now.getTime();
}

/** The calendar day ("YYYY-MM-DD") an instant falls on in `timezone`. */
export function organizationDayKey(value: Date | string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

export interface CalendarDay {
  /** "YYYY-MM-DD" */
  readonly key: string;
  readonly day: number;
  /** False for the leading and trailing days of the neighbouring months. */
  readonly inMonth: boolean;
}

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * The weeks of a month for a calendar grid, Monday first, padded with the
 * neighbouring months' days so every week has seven. `month` is 1–12.
 */
export function monthGrid(year: number, month: number): CalendarDay[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // days before the 1st, Monday first
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const weeks = Math.ceil((lead + daysInMonth) / 7);
  const grid: CalendarDay[][] = [];
  for (let week = 0; week < weeks; week += 1) {
    const row: CalendarDay[] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const date = new Date(Date.UTC(year, month - 1, 1 + week * 7 + weekday - lead));
      row.push({
        key: `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
        day: date.getUTCDate(),
        inMonth: date.getUTCMonth() === month - 1,
      });
    }
    grid.push(row);
  }
  return grid;
}

/** The month after (`step` 1) or before (`step` -1) the given one. */
export function shiftMonth(year: number, month: number, step: number): { year: number; month: number } {
  const date = new Date(Date.UTC(year, month - 1 + step, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

/** Callbacks grouped by the organization-local day they fall on. */
export function callbacksByDay<T extends { scheduledAt: string }>(callbacks: readonly T[], timezone: string): Map<string, T[]> {
  const days = new Map<string, T[]>();
  for (const callback of [...callbacks].sort((a, b) => instant(a.scheduledAt) - instant(b.scheduledAt))) {
    const key = organizationDayKey(callback.scheduledAt, timezone);
    days.set(key, [...(days.get(key) ?? []), callback]);
  }
  return days;
}
