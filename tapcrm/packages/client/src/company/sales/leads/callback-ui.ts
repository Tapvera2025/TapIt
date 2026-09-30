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
