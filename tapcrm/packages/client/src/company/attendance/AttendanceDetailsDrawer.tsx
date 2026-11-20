import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarPicker, calendarMonth } from '../../ui/index.js';
import { Icon } from '../../ui/Icon.js';
import { getAttendanceDayDetail, type AttendanceDayDetail, type AttendanceEventView } from './attendanceApi.js';

export type AttendanceDrawerPeriod = 'daily' | 'weekly' | 'monthly';

export interface AttendanceDrawerEmployee {
  id: string;
  employeeId: string | null;
  fullName: string;
  email?: string | null;
  departmentName: string | null;
  teamName?: string | null;
  positionName?: string | null;
  designationName?: string | null;
  shift?: { kind: string | null; start: string | null; end: string | null; source?: string | null; graceMinutes?: number | null; timezone?: string } | null;
}

export interface AttendanceDrawerDay {
  date: string;
  status: string | null;
  dayType: string | null;
  isWfh: boolean;
  arrivalAt: string | null;
  departureAt: string | null;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
  flags?: string[];
  shiftSource?: string | null;
  recordState?: 'open' | 'closed';
}

export interface AttendanceDrawerSummary {
  presentUnits: number;
  leaveUnits: number;
  absentUnits: number;
  holidayUnits: number;
  wfhDays: number;
  lateDays: number;
  lateMinutes: number;
  workedMinutes: number;
  breakMinutes: number;
  overtimeMinutes: number;
}

export interface AttendanceDetailsDrawerProps {
  employee: AttendanceDrawerEmployee;
  period: AttendanceDrawerPeriod;
  periodLabel: string;
  days: AttendanceDrawerDay[];
  month?: string;
  periodDates?: string[];
  summary?: AttendanceDrawerSummary;
  onPeriodChange: (period: AttendanceDrawerPeriod, anchorDate: string) => Promise<void>;
  onClose: () => void;
}

const duration = (minutes: number): string => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
const clockTime = (value: string | null, timeZone?: string): string => value
  ? new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, ...(timeZone ? { timeZone } : {}) })
  : '—';
const dateLabel = (date: string): string => new Date(`${date}T00:00:00.000Z`).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });

function dateInTimeZone(value: number, timeZone?: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
}

function dayStatus(day: AttendanceDrawerDay | undefined): { label: string; code: string; tone: string } {
  if (!day) return { label: 'No attendance record', code: '—', tone: 'border-app-border bg-app-surface-raised/60 text-app-muted' };
  if (day.dayType === 'week-off') return { label: 'Week off', code: '—', tone: 'border-app-border bg-app-surface-raised/60 text-app-muted' };
  if (day.isWfh && (day.status === 'present' || day.status === 'full-day')) return { label: 'Work from home', code: 'W', tone: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300' };
  if (day.status === 'present' || day.status === 'full-day') return { label: 'Present', code: 'P', tone: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300' };
  if (day.status === 'half-day' || day.status === 'half-day-leave') return { label: 'Half day', code: 'HD', tone: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300' };
  if (day.status === 'absent') return { label: 'Absent', code: 'A', tone: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300' };
  if (day.status === 'leave') return { label: 'Leave', code: 'L', tone: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300' };
  if (day.status === 'holiday' || day.dayType === 'holiday') return { label: 'Holiday', code: 'H', tone: 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300' };
  if (day.recordState === 'open') return { label: day.arrivalAt ? 'In progress' : 'No punch', code: '…', tone: 'border-app-border bg-app-surface-raised/60 text-app-muted' };
  return { label: day.arrivalAt ? 'In progress' : day.status ?? 'No punch', code: day.arrivalAt ? '…' : '—', tone: 'border-app-border bg-app-surface-raised/60 text-app-muted' };
}

function summaryFor(days: AttendanceDrawerDay[]): AttendanceDrawerSummary {
  return {
    presentUnits: days.reduce((sum, day) => sum + (day.status === 'half-day' || day.status === 'half-day-leave' ? 0.5 : ['present', 'full-day'].includes(day.status ?? '') || Boolean(day.arrivalAt) ? 1 : 0), 0),
    leaveUnits: days.reduce((sum, day) => sum + (day.status === 'half-day-leave' ? 0.5 : day.status === 'leave' ? 1 : 0), 0),
    absentUnits: days.filter((day) => day.status === 'absent').length,
    holidayUnits: days.filter((day) => day.status === 'holiday' || day.dayType === 'holiday').length,
    wfhDays: days.filter((day) => day.isWfh).length,
    lateDays: days.filter((day) => day.lateMinutes > 0).length,
    lateMinutes: days.reduce((sum, day) => sum + day.lateMinutes, 0),
    workedMinutes: days.reduce((sum, day) => sum + day.workedMinutes, 0),
    breakMinutes: days.reduce((sum, day) => sum + day.breakMinutes, 0),
    overtimeMinutes: days.reduce((sum, day) => sum + day.overtimeMinutes, 0),
  };
}

function clockMinutes(value: string | null, timeZone?: string): number | null {
  if (!value) return null;
  const timeMatch = /^(\d{1,2}):(\d{2})/.exec(value);
  if (timeMatch) return Number(timeMatch[1]) * 60 + Number(timeMatch[2]);
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  if (timeZone) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value);
    if (Number.isFinite(hour) && Number.isFinite(minute)) return hour * 60 + minute;
  }
  return instant.getHours() * 60 + instant.getMinutes();
}

function clockRange(day: AttendanceDrawerDay, shift: AttendanceDrawerEmployee['shift'], eventMinutes: number[] = []): { start: number; end: number; actualIn: number | null; actualOut: number | null; shiftStart: number | null; shiftEnd: number | null; ticks: number[] } {
  let shiftStart = clockMinutes(shift?.start ?? null);
  let shiftEnd = clockMinutes(shift?.end ?? null);
  if (shiftStart !== null && shiftEnd !== null && shiftEnd <= shiftStart) shiftEnd += 1440;
  let actualIn = clockMinutes(day.arrivalAt, shift?.timezone);
  let actualOut = clockMinutes(day.departureAt, shift?.timezone);
  if (actualIn !== null && shiftStart !== null) {
    while (actualIn < shiftStart - 720) actualIn += 1440;
    while (actualIn > shiftStart + 720) actualIn -= 1440;
  }
  if (actualOut !== null && actualIn !== null) {
    while (actualOut < actualIn) actualOut += 1440;
  }

  const firstEvent = eventMinutes[0] ?? null;
  const lastEvent = eventMinutes[eventMinutes.length - 1] ?? null;
  const anchorStart = shiftStart ?? actualIn ?? firstEvent ?? 9 * 60;
  const anchorEnd = shiftEnd ?? actualOut ?? anchorStart + 8 * 60;
  const earliest = Math.min(anchorStart, actualIn ?? anchorStart, firstEvent ?? anchorStart);
  const latest = Math.max(anchorEnd, actualOut ?? anchorEnd, lastEvent ?? anchorEnd);
  let start = Math.floor((earliest - 60) / 60) * 60;
  let end = Math.ceil((latest + 60) / 60) * 60;
  if (end - start < 6 * 60) {
    const middle = (start + end) / 2;
    start = Math.floor((middle - 3 * 60) / 60) * 60;
    end = start + 6 * 60;
  }
  const tickInterval = end - start > 15 * 60 ? 3 * 60 : 2 * 60;
  const firstTick = Math.ceil(start / tickInterval) * tickInterval;
  const ticks: number[] = [];
  for (let tick = firstTick; tick < end; tick += tickInterval) ticks.push(tick);
  return { start, end, actualIn, actualOut, shiftStart, shiftEnd, ticks };
}

function formatHour(minutes: number): string {
  const hour = ((Math.floor(minutes / 60) % 24) + 24) % 24;
  return String(hour).padStart(2, '0');
}

function formatClockMinute(minutes: number): string {
  return `${formatHour(minutes)}:${String(((Math.floor(minutes) % 60) + 60) % 60).padStart(2, '0')}`;
}

function lateMinutesForShift(day: AttendanceDrawerDay, shift: AttendanceDrawerEmployee['shift']): number {
  if (!day.arrivalAt || !shift?.start || day.dayType !== 'working' || day.status === 'half-day-leave') return day.lateMinutes;
  let arrival = clockMinutes(day.arrivalAt, shift.timezone);
  const start = clockMinutes(shift.start);
  if (arrival === null || start === null) return day.lateMinutes;
  while (arrival < start - 720) arrival += 1440;
  while (arrival > start + 720) arrival -= 1440;
  return Math.max(0, Math.floor(arrival - start - Math.max(0, shift.graceMinutes ?? 0)));
}

type TimelinePoint = { id: string; kind: string; at: string; minute: number; source: string; evidence?: string };
type TimelineSegment = { start: number; end: number; kind: 'work' | 'break' | 'overtime'; active: boolean };

function normalizeTimelineEvents(events: AttendanceEventView[], shift: AttendanceDrawerEmployee['shift']): TimelinePoint[] {
  const sorted = events.flatMap((event) => {
    const at = event.at ?? event.occurredAt;
    if (!at) return [];
    const instant = new Date(at).getTime();
    const minute = clockMinutes(at, shift?.timezone);
    return Number.isNaN(instant) || minute === null ? [] : [{ event, at, instant, minute }];
  }).sort((left, right) => left.instant - right.instant);
  if (sorted.length === 0) return [];

  const shiftStart = clockMinutes(shift?.start ?? null);
  let firstMinute = sorted[0]!.minute;
  if (shiftStart !== null) {
    while (firstMinute < shiftStart - 720) firstMinute += 1440;
    while (firstMinute > shiftStart + 720) firstMinute -= 1440;
  }
  const firstInstant = sorted[0]!.instant;
  return sorted.map(({ event, at, instant }) => ({
    id: event.id,
    kind: event.kind,
    at,
    minute: Math.floor(firstMinute + (instant - firstInstant) / 60_000),
    source: event.source,
    ...(event.evidence ? { evidence: event.evidence } : {}),
  }));
}

function currentTimelineMinute(day: AttendanceDrawerDay, points: TimelinePoint[], shift: AttendanceDrawerEmployee['shift'], now: number): number | null {
  const origin = points.find((point) => point.kind === 'in' || point.kind === 'scan');
  const originAt = origin?.at ?? day.arrivalAt;
  if (!originAt) return null;
  const originInstant = new Date(originAt).getTime();
  let originMinute = clockMinutes(originAt, shift?.timezone);
  if (Number.isNaN(originInstant) || originMinute === null) return null;
  const shiftStart = clockMinutes(shift?.start ?? null);
  if (shiftStart !== null) {
    while (originMinute < shiftStart - 720) originMinute += 1440;
    while (originMinute > shiftStart + 720) originMinute -= 1440;
  }
  return Math.floor(originMinute + Math.max(0, now - originInstant) / 60_000);
}

function buildTimelineSegments(points: TimelinePoint[], regularWorkMinutes: number, extendTo?: number): TimelineSegment[] {
  const intervals: Array<{ start: number; end: number; kind: 'work' | 'break'; active: boolean }> = [];
  let state: 'off' | 'work' | 'break' = 'off';
  let openedAt: number | null = null;
  const closeInterval = (at: number) => {
    if (openedAt !== null && at > openedAt && state !== 'off') intervals.push({ start: openedAt, end: at, kind: state, active: false });
    openedAt = null;
  };

  for (const point of points) {
    if (point.kind === 'in') {
      if (state === 'off') { state = 'work'; openedAt = point.minute; }
    } else if (point.kind === 'scan') {
      if (state === 'off') { state = 'work'; openedAt = point.minute; }
      else if (state === 'break') { closeInterval(point.minute); state = 'work'; openedAt = point.minute; }
    } else if (point.kind === 'break-start' && state === 'work') {
      closeInterval(point.minute); state = 'break'; openedAt = point.minute;
    } else if (point.kind === 'break-end' && state === 'break') {
      closeInterval(point.minute); state = 'work'; openedAt = point.minute;
    } else if ((point.kind === 'out' || point.kind === 'auto-out') && state !== 'off') {
      closeInterval(point.minute); state = 'off';
    }
  }

  if (openedAt !== null && state !== 'off' && extendTo !== undefined && extendTo > openedAt) {
    intervals.push({ start: openedAt, end: extendTo, kind: state, active: true });
  }

  let regularRemaining = Math.max(0, regularWorkMinutes);
  return intervals.flatMap((interval): TimelineSegment[] => {
    if (interval.kind === 'break') return [{ ...interval, kind: 'break' }];
    const length = interval.end - interval.start;
    const regularLength = Math.min(length, regularRemaining);
    regularRemaining = Math.max(0, regularRemaining - regularLength);
    const parts: TimelineSegment[] = [];
    if (regularLength > 0) parts.push({ start: interval.start, end: interval.start + regularLength, kind: 'work', active: interval.active });
    if (length > regularLength) parts.push({ start: interval.start + regularLength, end: interval.end, kind: 'overtime', active: interval.active });
    return parts;
  });
}

function eventLabel(point: TimelinePoint, index: number, points: TimelinePoint[]): string {
  if (point.kind === 'in') return 'Punch in';
  if (point.kind === 'out') return 'Punch out';
  if (point.kind === 'auto-out') return 'Punch out (auto)';
  if (point.kind === 'break-start') return 'Break started';
  if (point.kind === 'break-end') return 'Break ended';
  if (point.kind === 'scan' && index === 0) return 'Punch in';
  if (point.kind === 'scan' && points[index - 1]?.kind === 'break-start') return 'Break ended (scan)';
  return 'Activity scan';
}

function DailyTimeline({ day, shift, events, eventsState, isLive, now }: { day: AttendanceDrawerDay; shift: AttendanceDrawerEmployee['shift']; events: AttendanceEventView[]; eventsState: 'loading' | 'loaded' | 'unavailable'; isLive: boolean; now: number }): React.JSX.Element {
  const points = normalizeTimelineEvents(events, shift);
  const liveUntil = isLive ? currentTimelineMinute(day, points, shift, now) : null;
  const eventMinutes = [...points.map((point) => point.minute), ...(liveUntil === null ? [] : [liveUntil])];
  const range = clockRange(day, shift, eventMinutes);
  const rangeWidth = range.end - range.start;
  const spanEnd = isLive ? liveUntil : range.actualOut;
  const span = points.length === 0 && range.actualIn !== null && spanEnd !== null && spanEnd > range.actualIn
    ? { left: ((range.actualIn - range.start) / rangeWidth) * 100, width: ((spanEnd - range.actualIn) / rangeWidth) * 100 }
    : null;
  const lateMinutes = lateMinutesForShift(day, shift);
  const rawLiveSegments = isLive ? buildTimelineSegments(points, Number.MAX_SAFE_INTEGER, liveUntil ?? undefined) : [];
  const liveWorked = Math.round(rawLiveSegments.filter((segment) => segment.kind === 'work' || segment.kind === 'overtime').reduce((sum, segment) => sum + segment.end - segment.start, 0));
  const liveBreak = Math.round(rawLiveSegments.filter((segment) => segment.kind === 'break').reduce((sum, segment) => sum + segment.end - segment.start, 0));
  const scheduledStart = clockMinutes(shift?.start ?? null);
  let scheduledEnd = clockMinutes(shift?.end ?? null);
  if (scheduledStart !== null && scheduledEnd !== null && scheduledEnd <= scheduledStart) scheduledEnd += 1440;
  const scheduledMinutes = scheduledStart !== null && scheduledEnd !== null ? scheduledEnd - scheduledStart : null;
  const liveWorkMinutes = isLive ? (points.length > 0 ? liveWorked : Math.max(0, Math.round((liveUntil ?? 0) - (range.actualIn ?? liveUntil ?? 0) - day.breakMinutes))) : day.workedMinutes;
  const liveBreakMinutes = isLive ? (points.length > 0 ? liveBreak : day.breakMinutes) : day.breakMinutes;
  const liveOvertimeMinutes = isLive ? Math.max(0, liveWorkMinutes - (scheduledMinutes ?? Number.MAX_SAFE_INTEGER)) : day.overtimeMinutes;
  const regularWorkMinutes = isLive ? Math.max(0, liveWorkMinutes - liveOvertimeMinutes) : Math.max(0, day.workedMinutes - day.overtimeMinutes);
  const segments = buildTimelineSegments(points, regularWorkMinutes, isLive ? liveUntil ?? undefined : undefined);
  const segmentStyle: Record<TimelineSegment['kind'], { label: string; color: string }> = {
    work: { label: 'Working time', color: 'bg-emerald-500' },
    break: { label: 'Break', color: 'bg-sky-500' },
    overtime: { label: 'Overtime', color: 'bg-amber-500' },
  };
  const eventTone = (kind: string) => kind.startsWith('break') ? 'bg-sky-500' : kind === 'auto-out' ? 'bg-amber-500' : 'bg-emerald-600';
  const durationParts = [
    { label: 'Working time', value: regularWorkMinutes, color: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300' },
    { label: 'Break', value: liveBreakMinutes, color: 'bg-sky-500', text: 'text-sky-700 dark:text-sky-300' },
    { label: 'Overtime', value: liveOvertimeMinutes, color: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300' },
  ].filter((part) => part.value > 0);
  const totalRecordedMinutes = durationParts.reduce((sum, part) => sum + part.value, 0);

  return <div className="mt-3 rounded-xl border border-app-border bg-app-surface-raised/40 p-3 sm:p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-app-muted">Daily timeline</p><p className="mt-0.5 text-xs text-app-muted">Punches, breaks, and working time across the day</p></div>
      {shift?.start && shift.end && <span className="rounded-full border border-app-border bg-app-surface px-2.5 py-1 text-[10px] font-medium text-app-muted">Scheduled {shift.start.slice(0, 5)}–{shift.end.slice(0, 5)}</span>}
    </div>

    <div className="mt-4 overflow-x-auto pb-1">
      <div className="min-w-[520px]">
      <div className="relative h-4 text-[9px] font-medium tabular-nums text-app-muted">
        {range.ticks.map((tick, index) => <span key={tick} className="absolute" style={{ left: `${((tick - range.start) / rangeWidth) * 100}%`, transform: index === 0 ? 'translateX(0)' : index === range.ticks.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)' }}>{formatHour(tick)}:00</span>)}
      </div>
      <div className="relative h-7 rounded-full border border-app-border bg-app-surface shadow-inner">
        {range.ticks.map((tick) => <span key={tick} aria-hidden="true" className="absolute inset-y-0 w-px bg-app-border/70" style={{ left: `${((tick - range.start) / rangeWidth) * 100}%` }} />)}
        {range.shiftStart !== null && <span className="absolute -top-1 z-20 h-9 w-0 border-l-2 border-dashed border-slate-500" style={{ left: `${((range.shiftStart - range.start) / rangeWidth) * 100}%` }} title={`Scheduled punch in ${formatClockMinute(range.shiftStart)}`} />}
        {range.shiftEnd !== null && <span className="absolute -top-1 z-20 h-9 w-0 border-l-2 border-dashed border-slate-500" style={{ left: `${((range.shiftEnd - range.start) / rangeWidth) * 100}%` }} title={`Scheduled punch out ${formatClockMinute(range.shiftEnd)}`} />}
        {span && <span className="absolute inset-y-1 min-w-1 rounded-full bg-emerald-500" style={{ left: `${span.left}%`, width: `${Math.max(span.width, 0.8)}%` }} title={`${isLive ? 'Working now' : 'Recorded punch span'}${eventsState === 'unavailable' ? '; event details unavailable' : ''}`} />}
        {segments.map((segment, index) => <span key={`${segment.kind}-${segment.start}-${index}`} className={`absolute inset-y-1 min-w-1 rounded-full ${segmentStyle[segment.kind].color} ${segment.active ? 'ring-2 ring-white/80 dark:ring-slate-950/80' : ''}`} style={{ left: `${((segment.start - range.start) / rangeWidth) * 100}%`, width: `${Math.max(((segment.end - segment.start) / rangeWidth) * 100, 0.8)}%` }} title={`${segment.active ? `${segment.kind === 'break' ? 'On break' : 'Working'} now · ` : ''}${segmentStyle[segment.kind].label}: ${duration(Math.round(segment.end - segment.start))}`} />)}
        {points.map((point) => <span key={point.id} className={`absolute -top-1 h-9 w-0.5 ${point.kind.startsWith('break') ? 'bg-sky-600' : point.kind === 'auto-out' ? 'bg-amber-600' : 'bg-emerald-700'}`} style={{ left: `${((point.minute - range.start) / rangeWidth) * 100}%` }} title={`${point.kind} at ${clockTime(point.at, shift?.timezone)}`} />)}
        {points.map((point) => <span key={`${point.id}-dot`} className={`absolute top-1/2 z-10 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-app-surface ${eventTone(point.kind)}`} style={{ left: `${((point.minute - range.start) / rangeWidth) * 100}%` }} />)}
        {isLive && liveUntil !== null && <><span className="absolute -top-1 h-9 w-0.5 bg-violet-600" style={{ left: `${((liveUntil - range.start) / rangeWidth) * 100}%` }} /><span className="absolute top-1/2 z-10 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-600 ring-2 ring-white dark:ring-slate-950" style={{ left: `${((liveUntil - range.start) / rangeWidth) * 100}%` }} title="Current time" /></>}
      </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px]">
        <span className="font-semibold text-app-foreground">Punch in <span className="tabular-nums text-app-muted">{clockTime(day.arrivalAt, shift?.timezone)}</span></span>
        <span className="font-semibold text-app-foreground">Punch out <span className="tabular-nums text-app-muted">{clockTime(day.departureAt, shift?.timezone)}</span></span>
      </div>
      {(range.shiftStart !== null || range.shiftEnd !== null) && <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[9px] font-medium text-app-muted">{range.shiftStart !== null && <span className="inline-flex items-center gap-1.5"><span className="h-3 border-l-2 border-dashed border-slate-500" />Scheduled punch in {formatClockMinute(range.shiftStart)}</span>}{range.shiftEnd !== null && <span className="inline-flex items-center gap-1.5"><span className="h-3 border-l-2 border-dashed border-slate-500" />Scheduled punch out {formatClockMinute(range.shiftEnd)}</span>}</div>}
      {(points.length > 0 || isLive) && <div className="mt-3 flex flex-wrap gap-1.5">{points.map((point, index) => <span key={point.id} title={`${point.source}${point.evidence ? ` · ${point.evidence}` : ''}`} className="inline-flex items-center gap-1.5 rounded-lg border border-app-border bg-app-surface px-2 py-1 text-[10px] font-medium text-app-foreground"><span className={`size-1.5 rounded-full ${eventTone(point.kind)}`} />{eventLabel(point, index, points)} <span className="tabular-nums text-app-muted">{clockTime(point.at, shift?.timezone)}</span></span>)}{isLive && <span className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-[10px] font-semibold text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300"><span className="size-1.5 rounded-full bg-violet-600" />Now <span className="tabular-nums">{clockTime(new Date(now).toISOString(), shift?.timezone)}</span></span>}</div>}
      {isLive && <p className="mt-2 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">{segments.find((segment) => segment.active)?.kind === 'break' ? 'Currently on break' : 'Currently working'} · elapsed time updates automatically</p>}
      {eventsState === 'loading' && <p className="mt-2 text-[10px] text-app-muted">Loading punch and break events...</p>}
      {eventsState === 'unavailable' && <p className="mt-2 text-[10px] text-app-muted">Detailed event times could not be loaded. Showing the recorded daily totals.</p>}
      {eventsState === 'loaded' && points.length === 0 && day.breakMinutes > 0 && <p className="mt-2 text-[10px] text-app-muted">Break duration is recorded, but start and end times are not available in the event log.</p>}
      {eventsState === 'loaded' && points.length === 0 && (day.arrivalAt || day.departureAt) && day.breakMinutes === 0 && <p className="mt-2 text-[10px] text-app-muted">Only the summary punch span is available; intermediate event times are not in the log.</p>}
      {eventsState === 'loaded' && points.length === 0 && !day.arrivalAt && !day.departureAt && <p className="mt-2 text-[10px] text-app-muted">No punch times were recorded for this date.</p>}
    </div>

    <div className="mt-4 border-t border-app-border pt-3">
      <div className="flex items-center justify-between gap-2"><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-app-muted">{isLive ? 'Time so far' : 'Recorded time'}</p><span className="text-[10px] tabular-nums text-app-muted">{duration(totalRecordedMinutes)} total</span></div>
      {totalRecordedMinutes > 0 ? <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-app-border/60" aria-label="Recorded work, break, and overtime distribution">
        {durationParts.map((part) => <span key={part.label} className={`${part.color} first:rounded-l-full last:rounded-r-full`} style={{ width: `${(part.value / totalRecordedMinutes) * 100}%` }} title={`${part.label}: ${duration(part.value)}`} />)}
      </div> : <div className="mt-2 h-3 rounded-full bg-app-border/60" />}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
        {durationParts.map((part) => <span key={part.label} className={`inline-flex items-center gap-1.5 text-[10px] font-semibold ${part.text}`}><span className={`size-2 rounded-full ${part.color}`} />{part.label} · {duration(part.value)}</span>)}
        {durationParts.length === 0 && <span className="text-[10px] text-app-muted">No worked, break, or overtime duration recorded.</span>}
      </div>
    </div>

    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {[
        { label: 'Late', value: lateMinutes >= 60 ? duration(lateMinutes) : `${lateMinutes}m` },
        { label: 'Day type', value: (day.dayType ?? '—').replaceAll('-', ' ') },
        { label: 'Status', value: dayStatus(day).label },
        { label: 'Shift source', value: (day.shiftSource ?? '—').replaceAll('-', ' ') },
      ].map((item) => <div key={item.label} className="min-w-0 rounded-lg border border-app-border/75 bg-app-surface px-2.5 py-2"><p className="text-[9px] font-bold uppercase tracking-wide text-app-muted">{item.label}</p><p className="mt-1 truncate text-[10px] font-semibold text-app-foreground">{item.value}</p></div>)}
    </div>
    {day.flags && day.flags.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{day.flags.map((flag) => <span key={flag} className="rounded-full border border-app-border bg-app-surface px-2 py-1 text-[10px] text-app-muted">{flag.replaceAll('-', ' ')}</span>)}</div>}
  </div>;
}

export function AttendanceDetailsDrawer({ employee, period, periodLabel, days, month, periodDates, summary, onPeriodChange, onClose }: AttendanceDetailsDrawerProps): React.JSX.Element {
  const sortedDays = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const fallbackDate = sortedDays.find((day) => day.arrivalAt || day.status)?.date ?? sortedDays[0]?.date ?? periodDates?.[0] ?? '';
  const monthValue: string = month && /^\d{4}-\d{2}$/.test(month)
    ? month
    : fallbackDate && /^\d{4}-\d{2}/.test(fallbackDate)
      ? fallbackDate.slice(0, 7)
      : new Date().toISOString().slice(0, 7);
  const calendarDates: readonly string[] = period === 'monthly' && monthValue.length === 7
    ? calendarMonth(monthValue)
    : periodDates ?? sortedDays.map((day) => day.date);
  const [selectedDate, setSelectedDate] = useState<string>(() => fallbackDate || calendarDates[0] || '');
  const [switchingPeriod, setSwitchingPeriod] = useState(false);
  const [periodSwitchError, setPeriodSwitchError] = useState('');
  const [dailyEvents, setDailyEvents] = useState<AttendanceEventView[]>([]);
  const [dailyRecord, setDailyRecord] = useState<AttendanceDayDetail['record'] | null>(null);
  const [dailyEventsState, setDailyEventsState] = useState<'loading' | 'loaded' | 'unavailable'>('loading');
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [drawerVisible, setDrawerVisible] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const closing = useRef(false);
  const requestCloseRef = useRef<() => void>(() => undefined);
  const records = new Map(sortedDays.map((day) => [day.date, day]));
  const reportDay = records.get(selectedDate);
  const dailyShift = dailyRecord ? {
    kind: dailyRecord.shift?.kind ?? null,
    start: dailyRecord.shift?.start ?? null,
    end: dailyRecord.shift?.end ?? null,
    source: dailyRecord.shiftSource,
    graceMinutes: dailyRecord.shift?.graceMinutes ?? null,
    ...(dailyRecord.shift?.timezone ? { timezone: dailyRecord.shift.timezone } : {}),
  } : employee.shift;
  const selectedDay = dailyRecord ? {
    ...(reportDay ?? { date: selectedDate, status: null, dayType: dailyRecord.dayType, isWfh: dailyRecord.isWfh, arrivalAt: null, departureAt: null, workedMinutes: 0, breakMinutes: 0, lateMinutes: 0, overtimeMinutes: 0 }),
    status: dailyRecord.state === 'open' ? null : dailyRecord.status ?? reportDay?.status ?? null,
    dayType: dailyRecord.dayType,
    isWfh: dailyRecord.isWfh,
    arrivalAt: dailyRecord.arrivalAt ?? reportDay?.arrivalAt ?? null,
    departureAt: dailyRecord.departureAt ?? reportDay?.departureAt ?? null,
    workedMinutes: dailyRecord.minutes.worked,
    breakMinutes: dailyRecord.minutes.break,
    lateMinutes: dailyRecord.minutes.late,
    overtimeMinutes: dailyRecord.minutes.overtime,
    flags: dailyRecord.flags,
    shiftSource: dailyRecord.shiftSource,
    recordState: dailyRecord.state,
  } : reportDay;
  const selectedStatus = dayStatus(selectedDay);
  const totals = summary ?? summaryFor(sortedDays);
  const monthLabel = period === 'monthly' && monthValue.length === 7
    ? new Date(`${monthValue}-01T00:00:00.000Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : periodLabel;
  const initials = employee.fullName.split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  const titleId = `attendance-drawer-${employee.id}`;
  const isLiveSelectedDay = dailyRecord?.state === 'open' && selectedDate === dateInTimeZone(clockNow, dailyRecord.shift?.timezone);
  const profileShift = dailyRecord ? dailyShift : employee.shift;
  const requestClose = () => {
    if (closing.current) return;
    closing.current = true;
    setDrawerVisible(false);
    closeTimer.current = window.setTimeout(onClose, 300);
  };
  requestCloseRef.current = requestClose;

  useEffect(() => {
    const validDates = new Set([...(periodDates ?? []), ...days.map((day) => day.date), ...(period === 'monthly' && monthValue.length === 7 ? calendarMonth(monthValue) : [])]);
    if (selectedDate && validDates.has(selectedDate)) return;
    setSelectedDate(sortedDays.find((day) => day.arrivalAt || day.status)?.date ?? sortedDays[0]?.date ?? periodDates?.[0] ?? (monthValue.length === 7 ? `${monthValue}-01` : ''));
  }, [employee.id, period, periodLabel, month, days, periodDates, selectedDate, monthValue]);

  async function selectPeriod(nextPeriod: AttendanceDrawerPeriod): Promise<void> {
    if (nextPeriod === period || switchingPeriod) return;
    const anchorDate = selectedDate || periodDates?.[0] || (monthValue.length === 7 ? `${monthValue}-01` : '');
    if (!anchorDate) return;
    setSwitchingPeriod(true);
    setPeriodSwitchError('');
    try {
      await onPeriodChange(nextPeriod, anchorDate);
    } catch (cause) {
      setPeriodSwitchError(cause instanceof Error ? cause.message : 'Unable to load this attendance period.');
    } finally {
      setSwitchingPeriod(false);
    }
  }

  async function selectDate(nextDate: string): Promise<void> {
    if (!nextDate || switchingPeriod) return;
    const previousDate = selectedDate;
    setSelectedDate(nextDate);
    setSwitchingPeriod(true);
    setPeriodSwitchError('');
    try {
      await onPeriodChange(period, nextDate);
    } catch (cause) {
      setSelectedDate(previousDate);
      setPeriodSwitchError(cause instanceof Error ? cause.message : 'Unable to load this attendance date.');
    } finally {
      setSwitchingPeriod(false);
    }
  }

  useEffect(() => {
    let revealFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      revealFrame = window.requestAnimationFrame(() => setDrawerVisible(true));
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (revealFrame) window.cancelAnimationFrame(revealFrame);
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    };
  }, []);
  const totalCards = [
    { label: 'Present units', value: `${totals.presentUnits}`, tone: 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/25' },
    { label: 'Leave', value: `${totals.leaveUnits}`, tone: 'border-violet-200 bg-violet-50/70 dark:border-violet-900 dark:bg-violet-950/25' },
    { label: 'Absent', value: `${totals.absentUnits}`, tone: 'border-rose-200 bg-rose-50/70 dark:border-rose-900 dark:bg-rose-950/25' },
    { label: 'Holiday', value: `${totals.holidayUnits}`, tone: 'border-indigo-200 bg-indigo-50/70 dark:border-indigo-900 dark:bg-indigo-950/25' },
    { label: 'WFH days', value: `${totals.wfhDays}`, tone: 'border-sky-200 bg-sky-50/70 dark:border-sky-900 dark:bg-sky-950/25' },
    { label: 'Late', value: `${totals.lateDays} days · ${totals.lateMinutes}m`, tone: 'border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/25' },
    { label: 'Worked', value: duration(totals.workedMinutes), tone: 'border-app-border bg-app-surface-raised/70' },
    { label: 'Break', value: duration(totals.breakMinutes), tone: 'border-app-border bg-app-surface-raised/70' },
    { label: 'Overtime', value: `${totals.overtimeMinutes}m`, tone: 'border-app-border bg-app-surface-raised/70' },
  ];
  const profile = [
    { label: 'Employee ID', value: employee.employeeId ?? '—' },
    { label: 'Email', value: employee.email ?? '—' },
    { label: 'Department', value: employee.departmentName ?? '—' },
    { label: 'Team', value: employee.teamName ?? '—' },
    { label: 'Position', value: employee.positionName ?? '—' },
    { label: 'Designation', value: employee.designationName ?? '—' },
    { label: 'Shift', value: profileShift?.kind ?? '—' },
    { label: 'Shift hours', value: profileShift?.start && profileShift.end ? `${profileShift.start} – ${profileShift.end}` : '—' },
  ];

  useEffect(() => {
    if (!selectedDate) {
      setDailyEvents([]);
      setDailyRecord(null);
      setDailyEventsState('loaded');
      return;
    }
    const controller = new AbortController();
    setDailyEvents([]);
    setDailyRecord(null);
    setDailyEventsState('loading');
    void getAttendanceDayDetail(employee.id, selectedDate, controller.signal).then((detail) => {
      if (!controller.signal.aborted) {
        setDailyEvents(detail.events.effective);
        setDailyRecord(detail.record);
        setDailyEventsState('loaded');
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setDailyEvents([]);
        setDailyRecord(null);
        setDailyEventsState('unavailable');
      }
    });
    return () => controller.abort();
  }, [employee.id, selectedDate]);

  useEffect(() => {
    if (!isLiveSelectedDay) return;
    const interval = window.setInterval(() => setClockNow(Date.now()), 15_000);
    return () => window.clearInterval(interval);
  }, [isLiveSelectedDay]);

  useEffect(() => {
    if (!isLiveSelectedDay) return;
    const controller = new AbortController();
    const refresh = () => {
      void getAttendanceDayDetail(employee.id, selectedDate, controller.signal).then((detail) => {
        if (!controller.signal.aborted) {
          setDailyEvents(detail.events.effective);
          setDailyRecord(detail.record);
        }
      }).catch(() => undefined);
    };
    const interval = window.setInterval(refresh, 30_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [employee.id, isLiveSelectedDay, selectedDate]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (event.target instanceof Element && event.target.closest('[data-calendar-picker-popover], [data-date-range-calendar]')) return;
      requestCloseRef.current();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
      previousFocus?.focus();
    };
  }, []);

  return createPortal(<div className="fixed inset-0 z-[100]">
    <button type="button" tabIndex={-1} aria-label="Close employee attendance details" onClick={requestClose} className={`absolute inset-0 cursor-default bg-slate-950/45 backdrop-blur-[2px] transition-opacity duration-200 ${drawerVisible ? 'opacity-100' : 'opacity-0'}`} />
    <aside role="dialog" aria-modal="true" aria-labelledby={titleId} className={`absolute inset-y-0 right-0 flex w-full flex-col border-l border-app-border bg-app-surface shadow-2xl transition-transform duration-300 ease-out will-change-transform sm:w-[min(94vw,900px)] ${drawerVisible ? 'translate-x-0' : 'translate-x-full'}`}>
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-app-border px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-app-accent/10 text-sm font-bold text-app-accent">{initials}</span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-app-accent">{period} attendance</p>
            <h2 id={titleId} className="mt-0.5 truncate font-display text-lg font-bold text-app-foreground sm:text-xl">{employee.fullName}</h2>
            <p className="mt-0.5 truncate text-xs text-app-muted">{employee.employeeId ?? 'No employee ID'} · {periodLabel}</p>
          </div>
        </div>
        <div className="flex w-full shrink-0 items-center justify-between gap-2 sm:w-auto sm:justify-end">
          <CalendarPicker
            variant="icon"
            type={period === 'monthly' ? 'month' : 'date'}
            value={period === 'monthly' ? monthValue : selectedDate}
            disabled={switchingPeriod}
            aria-label={`Change date in ${period} attendance`}
            onChange={(event) => {
              const nextValue = event.target.value;
              if (!nextValue) return;
              void selectDate(nextValue);
            }}
            className="grid size-10 shrink-0 place-items-center rounded-xl border border-app-border bg-app-surface-raised text-app-muted transition hover:border-app-accent/50 hover:text-app-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent disabled:cursor-not-allowed disabled:opacity-60"
          />
          <div role="group" aria-label="Attendance period" aria-busy={switchingPeriod} className="inline-flex min-w-0 rounded-xl border border-app-border bg-app-surface-raised/70 p-1">
            {([
              { id: 'daily' as const, label: 'Daily' },
              { id: 'weekly' as const, label: 'Weekly' },
              { id: 'monthly' as const, label: 'Monthly' },
            ]).map((item) => <button key={item.id} type="button" aria-pressed={period === item.id} disabled={switchingPeriod || period === item.id} onClick={() => void selectPeriod(item.id)} className={`min-h-8 rounded-lg px-2.5 text-[11px] font-semibold transition sm:px-3 ${period === item.id ? 'bg-app-accent text-app-on-accent shadow-sm' : 'text-app-muted hover:bg-app-surface hover:text-app-foreground'} disabled:cursor-default`}>{item.label}</button>)}
          </div>
          <button type="button" autoFocus onClick={requestClose} aria-label="Close employee details" className="grid size-10 shrink-0 place-items-center rounded-xl border border-app-border bg-app-surface-raised text-app-muted transition hover:text-app-foreground"><Icon name="close" className="size-4" /></button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 sm:space-y-5 sm:p-5">
        {periodSwitchError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">{periodSwitchError}</p>}
        <section className="rounded-2xl border border-app-border bg-app-surface-raised/45 p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-bold text-app-foreground">{period === 'daily' ? 'Daily overview' : period === 'weekly' ? 'Weekly overview' : 'Monthly overview'}</h3><p className="mt-0.5 text-xs text-app-muted">Attendance totals for {monthLabel}</p></div>{profileShift && <span className="rounded-full border border-app-border bg-app-surface px-2.5 py-1 text-[10px] font-semibold text-app-muted">{profileShift.kind ?? 'Shift'}{profileShift.source ? ` · ${profileShift.source}` : ''}</span>}</div>
          <div className="mt-3 grid grid-cols-2 gap-2 min-[440px]:grid-cols-3 lg:grid-cols-5">{totalCards.map((item) => <div key={item.label} className={`min-w-0 rounded-xl border px-2.5 py-2 ${item.tone}`}><p className="truncate text-[9px] font-bold uppercase tracking-[0.07em] text-app-muted">{item.label}</p><p className="mt-1 truncate text-sm font-bold tabular-nums text-app-foreground">{item.value}</p></div>)}</div>
        </section>

        <section className="rounded-2xl border border-app-border bg-app-surface p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-bold text-app-foreground">{period === 'monthly' ? `${monthLabel} calendar` : period === 'weekly' ? 'Week calendar' : 'Day details'}</h3><p className="mt-0.5 text-xs text-app-muted">{period === 'daily' ? 'Attendance for the selected date.' : 'Select a date to inspect its punch and work details.'}</p></div><div className="flex flex-wrap gap-1.5 text-[9px] font-semibold text-app-muted"><span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700">P Present</span><span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-sky-700">W WFH</span><span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">HD Half day</span><span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-rose-700">A Absent</span><span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-1 text-violet-700">L Leave</span><span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-1 text-indigo-700">H Holiday</span></div></div>
          {period === 'daily' ? <div className="mt-4 flex">{selectedDate && <DayTile date={selectedDate} day={records.get(selectedDate)} active onSelect={setSelectedDate} className="w-14 shrink-0" />}</div> : <div className="mt-4 grid grid-cols-7 gap-1 sm:gap-1.5">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((weekday) => <span key={weekday} className="pb-1 text-center text-[9px] font-bold uppercase tracking-wide text-app-muted sm:text-[10px]">{weekday}</span>)}
            {calendarDates.map((day) => {
              if (period === 'monthly' && monthValue.length === 7 && !day.startsWith(`${monthValue}-`)) return <span key={day} aria-hidden="true" className="min-h-11 sm:min-h-14" />;
              const record = records.get(day);
              return <DayTile key={day} date={day} day={record} active={day === selectedDate} onSelect={setSelectedDate} />;
            })}
          </div>}
        </section>

        <section className="rounded-2xl border border-app-border bg-app-surface p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-app-border pb-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-app-muted">Selected date</p><h3 className="mt-0.5 text-sm font-bold text-app-foreground">{selectedDate ? dateLabel(selectedDate) : periodLabel}</h3></div><span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${selectedStatus.tone}`}>{selectedStatus.label}</span></div>
          {selectedDay ? <DailyTimeline day={selectedDay} shift={dailyShift} events={dailyEvents} eventsState={dailyEventsState} isLive={isLiveSelectedDay} now={clockNow} /> : dailyEventsState === 'loading' ? <p role="status" className="mt-3 rounded-xl border border-dashed border-app-border px-3 py-5 text-center text-xs text-app-muted">Loading this day&apos;s attendance details…</p> : <p className="mt-3 rounded-xl border border-dashed border-app-border px-3 py-5 text-center text-xs text-app-muted">No attendance record was saved for this day.</p>}
        </section>

        <section className="rounded-2xl border border-app-border bg-app-surface p-3 sm:p-4"><h3 className="text-sm font-bold text-app-foreground">Employee information</h3><div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">{profile.map((item) => <div key={item.label} className="min-w-0 rounded-xl border border-app-border/75 bg-app-surface-raised/45 px-3 py-2"><p className="text-[9px] font-bold uppercase tracking-wide text-app-muted">{item.label}</p><p className="mt-1 break-words text-xs font-medium text-app-foreground">{item.value}</p></div>)}</div></section>
      </div>
    </aside>
  </div>, document.body);
}

function DayTile({ date, day, active, onSelect, className = '' }: { date: string; day: AttendanceDrawerDay | undefined; active: boolean; onSelect: (date: string) => void; className?: string }): React.JSX.Element {
  const status = dayStatus(day);
  return <button type="button" disabled={!date} onClick={() => date && onSelect(date)} aria-pressed={active} aria-label={date ? `${dateLabel(date)}: ${status.label}` : 'No attendance record'} title={date ? `${dateLabel(date)} · ${status.label}` : undefined} className={`flex min-h-11 min-w-0 flex-col items-center justify-center rounded-lg border px-0.5 py-1 transition sm:min-h-14 sm:rounded-xl ${status.tone} ${active ? 'ring-2 ring-app-accent ring-offset-1 ring-offset-app-surface' : date ? 'hover:-translate-y-px hover:shadow-sm' : ''} disabled:cursor-default ${className}`}>
    {date ? <><span className="text-[9px] leading-none opacity-75 sm:text-[10px]">{Number(date.slice(8))}</span><span className="mt-1 max-w-full truncate text-[9px] font-bold leading-none sm:text-[10px]">{status.code}</span></> : <span aria-hidden="true">—</span>}
  </button>;
}
