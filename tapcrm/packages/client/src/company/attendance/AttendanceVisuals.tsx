import { calendarMonth } from '../../ui/calendar-model.js';
import type { EmployeeWiseDay, MonthlyAttendanceRow } from './attendanceApi.js';

export type AttendanceCalendarEntry = { status: EmployeeWiseDay['status']; dayType?: EmployeeWiseDay['dayType']; isWfh: boolean; date?: string; lateMinutes?: number };

export function attendanceStatus(entry: AttendanceCalendarEntry | undefined): { label: string; className: string } {
  if (!entry) return { label: '—', className: 'bg-app-surface-raised text-app-muted border-app-border' };
  if (entry.dayType === 'week-off') return { label: 'No attendance record', className: 'bg-app-surface-raised text-app-muted border-app-border' };
  if (entry.isWfh && (entry.status === 'present' || entry.status === 'full-day')) return { label: 'WFH', className: 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800' };
  if (entry.status === 'present' || entry.status === 'full-day') return { label: 'Present', className: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800' };
  if (entry.status === 'absent') return { label: 'Absent', className: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800' };
  if (entry.status === 'half-day' || entry.status === 'half-day-leave') return { label: 'Half day', className: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800' };
  if (entry.status === 'leave') return { label: 'Leave', className: 'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-950/50 dark:text-violet-300 dark:border-violet-800' };
  if (entry.status === 'holiday' || entry.dayType === 'holiday') return { label: 'Holiday', className: 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800' };
  return { label: entry.status ?? 'No record', className: 'bg-app-surface-raised text-app-muted border-app-border' };
}

export function AttendanceLegend(): React.JSX.Element {
  return <div className="flex flex-wrap gap-2 text-[11px] font-semibold text-app-muted">{['present', 'absent', 'wfh', 'half-day', 'leave', 'holiday'].map((key) => { const entry = key === 'wfh' ? { status: 'present', isWfh: true } : { status: key, isWfh: false }; const tone = attendanceStatus(entry); return <span key={key} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${tone.className}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{tone.label}</span>; })}</div>;
}

export function AttendanceKpis({ items, className = '', columns = 5 }: { items: Array<{ label: string; value: string | number; tone?: string }>; className?: string; columns?: 4 | 5 }): React.JSX.Element {
  const largeColumns = columns === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-5';
  return <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${largeColumns} ${className}`}>{items.map((item) => <div key={item.label} className={`flex min-h-[112px] h-full flex-col rounded-2xl border border-app-border bg-app-surface p-4 shadow-sm ${item.tone ?? ''}`}><p className="min-h-10 text-[10px] font-bold uppercase leading-5 tracking-[0.12em] text-app-muted">{item.label}</p><p className="mt-auto text-xl font-bold tabular-nums">{item.value}</p></div>)}</div>;
}

export function AttendanceMonthlyHighlights({
  month,
  attendance,
  onTime,
  totalHours,
  averageHours,
}: {
  month: string;
  attendance: string;
  onTime: string;
  totalHours: string;
  averageHours: string;
}): React.JSX.Element {
  const items = [
    { label: 'Attendance', value: attendance, className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
    { label: 'On time', value: onTime, className: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300' },
    { label: 'Total hours', value: totalHours, className: 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300' },
    { label: 'Average / day', value: averageHours, className: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  ];
  return <section className="rounded-2xl border border-app-border bg-app-surface p-5 shadow-sm"><div><p className="text-sm text-app-muted">This month</p><h2 className="mt-1 text-2xl font-bold">{month}</h2></div><div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">{items.map((item) => <div key={item.label} className={`rounded-2xl border p-4 ${item.className}`}><p className="text-sm font-semibold opacity-80">{item.label}</p><p className="mt-3 text-2xl font-bold tabular-nums">{item.value}</p></div>)}</div></section>;
}

export function AttendanceCalendar({ month, records, onSelect }: { month: string; records: ReadonlyMap<string, AttendanceCalendarEntry>; onSelect?: (date: string) => void }): React.JSX.Element {
  const dates = calendarMonth(month);
  return <div className="overflow-x-auto"><div className="min-w-[620px]"><div className="grid grid-cols-7 gap-2 text-center text-[10px] font-bold uppercase tracking-wider text-app-muted">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span key={day}>{day}</span>)}</div><div className="mt-2 grid grid-cols-7 gap-2">{dates.map((date) => { const entry = records.get(date); const status = attendanceStatus(entry); return <button key={date} type="button" onClick={() => onSelect?.(date)} className={`min-h-[68px] rounded-xl border p-2 text-left transition hover:-translate-y-0.5 hover:shadow-md ${status.className}`}><span className="flex items-center justify-between text-xs font-bold"><span>{Number(date.slice(8))}</span>{entry?.lateMinutes ? <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-800 dark:text-amber-200">Late +{entry.lateMinutes}m</span> : null}</span><span className="mt-3 block truncate text-[10px] font-semibold">{status.label}</span></button>; })}</div></div></div>;
}

export function monthlyRowToCalendar(row: MonthlyAttendanceRow): Map<string, AttendanceCalendarEntry> {
  return new Map(row.records.map((record) => [record.date, { status: record.status, dayType: record.dayType, isWfh: record.isWfh, lateMinutes: record.lateMinutes }]));
}
