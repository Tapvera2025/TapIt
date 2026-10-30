import { useState } from 'react';
import { calendarMonth } from '../../ui/calendar-model.js';
import { Icon } from '../../ui/Icon.js';
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

export function MonthlyAttendanceKpis({
  month,
  presentDays,
  lateDays,
  absentDays,
  halfDays,
  paidLeaveDayCount,
  unpaidLeave,
  wfhDays,
}: {
  month: string;
  presentDays: number;
  lateDays: number;
  absentDays: number;
  halfDays: number;
  paidLeaveDayCount: number;
  unpaidLeave: number;
  wfhDays: number;
}): React.JSX.Element {
  const [hoveredSegment, setHoveredSegment] = useState<{ label: string; value: number; percentage: number; color: string } | null>(null);
  const primaryItems = [
    { label: 'Present Days', value: presentDays, color: '#42c9a4' },
    { label: 'Late Days', value: lateDays, color: '#f5b84b' },
    { label: 'Absent Days', value: absentDays, color: '#f47777' },
    { label: 'Half Days', value: halfDays, color: '#8570e9' },
  ];
  const secondaryItems = [
    { label: 'Paid Leave', value: paidLeaveDayCount, color: '#70a5ed' },
    { label: 'Unpaid Leave', value: unpaidLeave, color: '#b6a0f4' },
    { label: 'WFH Days', value: wfhDays, color: '#a7bde8' },
  ];
  const total = primaryItems.reduce((sum, item) => sum + item.value, 0);
  const radius = 74;
  const circumference = 2 * Math.PI * radius;
  const segmentGap = 3;
  let segmentOffset = 0;
  const primaryPercentages = primaryItems.map((item) => {
    const percentage = total > 0 ? (item.value / total) * 100 : 0;
    return { ...item, percentage };
  });

  return (
    <section className="rounded-2xl border border-indigo-100 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--app-surface)_96%,#eef0ff),var(--app-surface))] p-5 shadow-sm dark:border-indigo-950/70 dark:bg-[linear-gradient(135deg,color-mix(in_srgb,var(--app-surface)_95%,#17152d),var(--app-surface))] sm:p-6 xl:h-full xl:overflow-y-auto">
      <div className="flex items-center gap-4">
        <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-violet-100 text-violet-600 dark:bg-violet-950/50 dark:text-violet-300">
          <Icon name="calendar" className="size-7" />
        </span>
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight text-app-foreground">Monthly attendance</h2>
          <p className="mt-1 text-sm text-app-muted">Attendance summary for {month}.</p>
        </div>
      </div>

      <div className="mt-6 grid items-center gap-6 lg:grid-cols-[minmax(230px,0.9fr)_minmax(260px,1fr)]">
        <div className="relative mx-auto grid size-[220px] place-items-center" aria-label={`${total} attendance days represented in the monthly summary`}>
          <svg viewBox="0 0 220 220" className="size-full -rotate-90 overflow-visible" role="img" aria-label="Monthly attendance distribution">
            <circle cx="110" cy="110" r={radius} fill="none" stroke="currentColor" strokeWidth="28" className="text-app-border/50" />
            {primaryPercentages.map((item) => {
              const segmentLength = (item.percentage / 100) * circumference;
              const visibleLength = Math.max(0, segmentLength - segmentGap);
              const currentOffset = segmentOffset;
              segmentOffset += segmentLength;
              return (
                <circle
                  key={item.label}
                  cx="110"
                  cy="110"
                  r={radius}
                  fill="none"
                  stroke={item.color}
                  strokeWidth="28"
                  strokeDasharray={`${visibleLength} ${circumference - visibleLength}`}
                  strokeDashoffset={-currentOffset}
                  className="cursor-pointer transition-opacity hover:opacity-70"
                  onMouseEnter={() => setHoveredSegment(item)}
                  onMouseLeave={() => setHoveredSegment(null)}
                  onFocus={() => setHoveredSegment(item)}
                  onBlur={() => setHoveredSegment(null)}
                >
                  <title>{`${item.label}: ${item.value} days (${item.percentage.toFixed(1)}%)`}</title>
                </circle>
              );
            })}
          </svg>
          {hoveredSegment && (
            <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-app-border bg-app-surface px-2 py-1 text-center shadow-lg" role="status">
              <p className="text-[10px] font-semibold leading-3 text-app-muted">{hoveredSegment.label}</p>
              <p className="mt-0.5 text-xs font-bold leading-4 text-app-foreground">{hoveredSegment.value} days</p>
              <p className="text-[9px] leading-3 tabular-nums text-app-muted">{hoveredSegment.percentage.toFixed(1)}%</p>
            </div>
          )}
          <div className="pointer-events-none absolute grid size-[150px] place-items-center rounded-full bg-app-surface text-center shadow-sm">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-app-muted">This month</p>
              <p className="mt-1 text-xl font-bold tracking-tight text-app-foreground">{month}</p>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {primaryPercentages.map((item) => (
            <div key={item.label} className="grid grid-cols-[14px_minmax(0,1fr)_auto_auto] items-center gap-3 text-sm">
              <span className="size-3.5 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="font-medium text-app-foreground">{item.label}</span>
              <strong className="tabular-nums text-app-foreground">{item.value}</strong>
              <span className="w-12 text-right tabular-nums text-app-muted">{item.percentage.toFixed(1)}%</span>
            </div>
          ))}
          <div className="border-t border-app-border pt-3">
            {secondaryItems.map((item) => (
              <div key={item.label} className="mt-3 grid grid-cols-[14px_minmax(0,1fr)_auto_auto] items-center gap-3 text-sm">
                <span className="size-3.5 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="font-medium text-app-foreground">{item.label}</span>
                <strong className="tabular-nums text-app-foreground">{item.value}</strong>
                <span className="w-12 text-right tabular-nums text-app-muted">{total > 0 ? `${((item.value / total) * 100).toFixed(1)}%` : '0%'}</span>
              </div>
            ))}
          </div>
        </div>

      </div>

    </section>
  );
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
