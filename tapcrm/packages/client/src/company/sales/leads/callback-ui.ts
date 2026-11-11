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
