function zoneParts(instant: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** Interpret the composer's wall-clock input in the workspace timezone, never the browser timezone. */
export function scheduleToUtc(value: string, timezone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error('Choose a publishing date and time.');
  const wall = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 16) !== value)
    throw new Error('Choose a valid publishing date and time.');
  const candidates = new Set<number>();
  // Sample both sides of a daylight-saving transition to find all valid offsets.
  for (const delta of [-86_400_000, 0, 86_400_000]) {
    const sampled = wall + delta;
    const localAsUtc = Date.parse(`${zoneParts(sampled, timezone)}:00Z`);
    const candidate = wall - (localAsUtc - sampled);
    if (zoneParts(candidate, timezone) === value) candidates.add(candidate);
  }
  if (candidates.size === 0)
    throw new Error(
      `That time does not exist in ${timezone} because the clocks change. Choose another time.`,
    );
  if (candidates.size > 1)
    throw new Error(
      `That time occurs twice in ${timezone} because the clocks change. Choose a time outside the clock change.`,
    );
  return new Date([...candidates][0]!).toISOString();
}

export function scheduleInZone(instant: string, timezone: string): string {
  return zoneParts(new Date(instant).getTime(), timezone);
}
