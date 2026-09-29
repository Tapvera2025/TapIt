/** Calendar arithmetic is UTC-only so DateOnly never becomes browser-local midnight. */
export function validDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function utcDate(value: string): Date {
  if (!validDateOnly(value)) throw new Error(`Invalid DateOnly: ${value}`);
  return new Date(`${value}T12:00:00.000Z`);
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addCalendarDays(value: string, days: number): string {
  const date = utcDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return dateOnly(date);
}

export function startOfCalendarWeek(value: string): string {
  const day = utcDate(value).getUTCDay();
  return addCalendarDays(value, -(day === 0 ? 6 : day - 1));
}

export function calendarWeek(value: string): string[] {
  const monday = startOfCalendarWeek(value);
  return Array.from({ length: 7 }, (_, index) => addCalendarDays(monday, index));
}

export function calendarMonth(month: string): string[] {
  if (!validMonth(month)) throw new Error(`Invalid calendar month: ${month}`);
  const first = `${month}-01`;
  const next = shiftCalendarMonth(month, 1);
  const last = addCalendarDays(`${next}-01`, -1);
  const start = startOfCalendarWeek(first);
  const end = addCalendarDays(startOfCalendarWeek(last), 6);
  const days: string[] = [];
  for (let day = start; day <= end; day = addCalendarDays(day, 1)) days.push(day);
  return days;
}

export function shiftCalendarMonth(month: string, offset: number): string {
  if (!validMonth(month)) throw new Error(`Invalid calendar month: ${month}`);
  const [year, part] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year!, part! - 1 + offset, 1, 12));
  return date.toISOString().slice(0, 7);
}

export function calendarMonthLabel(month: string, locale = 'en-IN'): string {
  if (!validMonth(month)) throw new Error(`Invalid calendar month: ${month}`);
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(utcDate(`${month}-01`));
}

export function calendarDateLabel(value: string, locale = 'en-IN'): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(utcDate(value));
}

export function weekdayIndex(value: string): number {
  const day = utcDate(value).getUTCDay();
  return day === 0 ? 6 : day - 1;
}
