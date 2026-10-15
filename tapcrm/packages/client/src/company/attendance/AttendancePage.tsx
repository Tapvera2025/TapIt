import { useEffect, useRef, useState } from 'react';
import { PeopleCalendar, type PeopleCalendarDay } from '../../ui/PeopleCalendar.js';
import {
  attendanceErrorMessage,
  getAttendanceDays,
  getAttendanceDayDetail,
  getEmployeeWiseReport,
  listCorrections,
  requestAttendanceCorrection,
  type AttendanceDayView,
  type AttendanceDayDetail,
  type CorrectionListItem,
  type CorrectionRequest,
  type EmployeeWiseReport,
} from './attendanceApi.js';
import { calendarMonth } from '../../ui/calendar-model.js';
import { attendanceStatus, AttendanceKpis, AttendanceMonthlyHighlights } from './AttendanceVisuals.js';
import { Card, Skeleton, SkeletonMetric, WorkspacePageContainer } from '../../ui/components.js';

function todayDate(timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values['year']}-${values['month']}-${values['day']}`;
}

function currentMonth(timezone: string): string {
  return todayDate(timezone).slice(0, 7);
}

function addDays(value: string, amount: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function daysValue(units: number): string | number {
  const value = units / 2;
  return Number.isInteger(value) ? value : value.toFixed(1);
}

function dayTone(day: AttendanceDayView): PeopleCalendarDay['tone'] {
  if (day.dayType === 'week-off') return 'muted';
  if (day.dayType === 'holiday' || day.dayType === 'leave') return 'neutral';
  const status = day.status?.toLowerCase() ?? '';
  if (status === 'present' || status === 'full-day') return 'positive';
  if (status === 'absent') return 'negative';
  if (status === 'half-day') return 'warning';
  if (day.state === 'open' && !day.status && day.arrivalAt !== null) return 'warning';
  if (day.minutes.late > 0) return 'warning';
  if (day.minutes.worked > 0) return 'positive';
  return 'muted';
}

function dayLabel(day: AttendanceDayView): string {
  if (day.dayType === 'week-off') return 'No attendance record';
  if (day.dayType === 'holiday') return 'Holiday';
  if (day.dayType === 'leave') return 'On leave';
  if (day.state === 'open' && !day.status && day.arrivalAt !== null) return 'In progress — punch out pending';
  if (day.status) return day.status;
  if (day.minutes.worked > 0) return `${Math.floor(day.minutes.worked / 60)}h ${day.minutes.worked % 60}m`;
  return 'No record';
}

function recentStatusClass(day: AttendanceDayView): string {
  if (day.state === 'open' && !day.status && day.arrivalAt !== null) {
    return 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800';
  }
  return attendanceStatus({ status: day.status, dayType: day.dayType, isWfh: day.isWfh }).className;
}

function fmt(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtTime(value: string | null, timezone: string): string {
  if (!value) return '—';
  // Shift start/end values are local time-only strings (HH:mm or HH:mm:ss),
  // not timestamps. Parsing them with Date produces "Invalid Date" in browsers.
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (match) return `${match[1]}:${match[2]}`;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime())
    ? '—'
    : new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: timezone }).format(instant);
}

function fmtDate(value: string): string {
  const instant = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(instant.getTime())
    ? value
    : new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(instant);
}

function fmtMonth(value: string): string {
  const instant = new Date(`${value}-01T12:00:00Z`);
  return Number.isNaN(instant.getTime())
    ? value
    : new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(instant);
}

export function AttendancePage({ userId, organizationTimezone }: { userId: string; organizationTimezone: string }): React.JSX.Element {
  const today = todayDate(organizationTimezone);
  const [month, setMonth] = useState(currentMonth(organizationTimezone));
  const [selectedDate, setSelectedDate] = useState(today);
  const [view, setView] = useState<'month' | 'week'>('month');
  const [days, setDays] = useState<AttendanceDayView[]>([]);
  const [daysLoading, setDaysLoading] = useState(true);
  const [daysError, setDaysError] = useState<string | null>(null);
  const [monthlyReport, setMonthlyReport] = useState<EmployeeWiseReport | null>(null);
  const [monthlyLoading, setMonthlyLoading] = useState(true);
  const [monthlyError, setMonthlyError] = useState<string | null>(null);
  const [recentDays, setRecentDays] = useState<AttendanceDayView[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [currentDetail, setCurrentDetail] = useState<AttendanceDayDetail | null>(null);
  const [currentLoading, setCurrentLoading] = useState(true);
  const [detail, setDetail] = useState<AttendanceDayDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showCorrectionForm, setShowCorrectionForm] = useState(false);
  const [myCorrections, setMyCorrections] = useState<CorrectionListItem[]>([]);
  const [correctionNotice, setCorrectionNotice] = useState<string | null>(null);

  function loadMyCorrections(): void {
    void listCorrections({ status: 'all', mine: true })
      .then((result) => setMyCorrections(result.corrections.slice(0, 10)))
      .catch(() => setMyCorrections([]));
  }

  useEffect(() => { loadMyCorrections(); }, []);
  const [correctionKind, setCorrectionKind] = useState<'add-event' | 'void-event'>('add-event');
  const [correctionEventKind, setCorrectionEventKind] = useState<'in' | 'out' | 'break-start' | 'break-end'>('in');
  const [correctionAt, setCorrectionAt] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionTargetId, setCorrectionTargetId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const daysAbort = useRef<AbortController | null>(null);
  const detailAbort = useRef<AbortController | null>(null);
  const monthlyAbort = useRef<AbortController | null>(null);
  const recentAbort = useRef<AbortController | null>(null);
  const currentAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    const grid = calendarMonth(month);
    const from = grid[0]!;
    const to = grid[grid.length - 1]!;
    daysAbort.current?.abort();
    daysAbort.current = new AbortController();
    const sig = daysAbort.current.signal;
    void (async () => {
      setDaysLoading(true);
      setDaysError(null);
      try {
        setDays(await getAttendanceDays(from, to, userId, sig));
      } catch (cause) {
        if (!(cause instanceof Error && cause.name === 'AbortError')) {
          setDaysError(attendanceErrorMessage(cause, 'Unable to load your attendance calendar.'));
        }
      } finally {
        if (!sig.aborted) setDaysLoading(false);
      }
    })();
    return () => { daysAbort.current?.abort(); };
  }, [month, userId]);

  useEffect(() => {
    const [year, monthNumber] = month.split('-');
    monthlyAbort.current?.abort();
    monthlyAbort.current = new AbortController();
    const sig = monthlyAbort.current.signal;
    void (async () => {
      setMonthlyLoading(true);
      setMonthlyError(null);
      try {
        setMonthlyReport(await getEmployeeWiseReport(userId, monthNumber!, Number(year), sig));
      } catch (cause) {
        if (!(cause instanceof Error && cause.name === 'AbortError')) {
          setMonthlyError(attendanceErrorMessage(cause, 'Unable to load monthly attendance KPIs.'));
        }
      } finally {
        if (!sig.aborted) setMonthlyLoading(false);
      }
    })();
    return () => { monthlyAbort.current?.abort(); };
  }, [month, userId]);

  useEffect(() => {
    recentAbort.current?.abort();
    recentAbort.current = new AbortController();
    const sig = recentAbort.current.signal;
    void (async () => {
      setRecentLoading(true);
      setRecentError(null);
      try {
        setRecentDays(await getAttendanceDays(addDays(today, -6), today, userId, sig));
      } catch (cause) {
        if (!(cause instanceof Error && cause.name === 'AbortError')) {
          setRecentError(attendanceErrorMessage(cause, 'Unable to load recent attendance.'));
        }
      } finally {
        if (!sig.aborted) setRecentLoading(false);
      }
    })();
    return () => { recentAbort.current?.abort(); };
  }, [today, userId]);

  useEffect(() => {
    currentAbort.current?.abort();
    currentAbort.current = new AbortController();
    const sig = currentAbort.current.signal;
    void (async () => {
      setCurrentLoading(true);
      try {
        setCurrentDetail(await getAttendanceDayDetail(userId, today, sig));
      } catch (cause) {
        if (!(cause instanceof Error && cause.name === 'AbortError')) setCurrentDetail(null);
      } finally {
        if (!sig.aborted) setCurrentLoading(false);
      }
    })();
    return () => { currentAbort.current?.abort(); };
  }, [today, userId]);

  useEffect(() => {
    setDetail(null);
    setDetailLoading(true);
    setShowCorrectionForm(false);
    detailAbort.current?.abort();
    detailAbort.current = new AbortController();
    const sig = detailAbort.current.signal;
    void (async () => {
      try {
        const d = await getAttendanceDayDetail(userId, selectedDate, sig);
        setDetail(d);
        setDetailLoading(false);
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') setDetailLoading(false);
      }
    })();
    return () => { detailAbort.current?.abort(); };
  }, [selectedDate, userId]);

  const calDays: PeopleCalendarDay[] = days.map((day) => ({
    date: day.workDate,
    label: dayLabel(day),
    tone: dayTone(day),
    shiftLabel: day.shift.start && day.shift.end
          ? `${fmtTime(day.shift.start, organizationTimezone)}–${fmtTime(day.shift.end, organizationTimezone)}`
      : null,
    halfDay: day.status?.toLowerCase().includes('half') ?? false,
    ...(day.minutes.late > 0 ? { markers: [`Late +${day.minutes.late}m`] } : {}),
  }));

  async function submitCorrection(): Promise<void> {
    if (correctionReason.trim().length < 20) { setCorrectionError('Please explain the correction in at least 20 characters.'); return; }
    setSubmitting(true);
    setCorrectionError(null);
    try {
      let body: CorrectionRequest;
      if (correctionKind === 'void-event') {
        if (!correctionTargetId) { setCorrectionError('Select event to void.'); setSubmitting(false); return; }
        body = { workDate: selectedDate, reason: correctionReason, kind: 'void-event', payload: { targetEventId: correctionTargetId } };
      } else {
        if (!correctionAt) { setCorrectionError('Select date/time for the event.'); setSubmitting(false); return; }
        body = { workDate: selectedDate, reason: correctionReason, kind: 'add-event', payload: { kind: correctionEventKind, at: new Date(correctionAt).toISOString() } };
      }
      await requestAttendanceCorrection(body);
      setCorrectionNotice('Correction requested. HR will review it; you can follow it below.');
      loadMyCorrections();
      setShowCorrectionForm(false);
      setCorrectionReason('');
      setCorrectionAt('');
      setDetail(null);
      setDetailLoading(true);
      void (async () => {
        try { setDetail(await getAttendanceDayDetail(userId, selectedDate)); }
        catch { /* ignore */ }
        finally { setDetailLoading(false); }
      })();
    } catch (err) {
      setCorrectionError(err instanceof Error ? err.message : 'Failed to submit correction.');
    } finally {
      setSubmitting(false);
    }
  }

  const effectiveEvents = detail?.events.effective ?? [];
  const monthlySummary = monthlyReport?.summary;
  const currentRecord = currentDetail?.record ?? null;
  const currentStatus = currentRecord?.state === 'open' && currentRecord.arrivalAt !== null
    ? 'Working'
    : currentRecord?.status ?? (currentRecord?.arrivalAt ? 'Present' : 'No record');
  const recentRecords = [...recentDays].sort((left, right) => right.workDate.localeCompare(left.workDate));
  const workingDays = monthlyReport?.records.filter((record) => record.dayType === 'working').length ?? 0;
  const presentDays = (monthlySummary?.presentUnits ?? 0) / 2;
  const attendancePercent = workingDays > 0 ? `${Math.round((presentDays / workingDays) * 100)}%` : '—';
  const onTimePercent = presentDays > 0 ? `${Math.max(0, Math.round(((presentDays - (monthlySummary?.lateDays ?? 0)) / presentDays) * 100))}%` : '—';
  const totalHours = monthlySummary ? `${(monthlySummary.workedMinutes / 60).toFixed(1)}h` : '—';
  const averageHours = presentDays > 0 && monthlySummary ? `${(monthlySummary.workedMinutes / presentDays / 60).toFixed(1)}h` : '—';

  return (
    <WorkspacePageContainer className="space-y-4">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-app-accent">My Attendance</p>
            <h1 className="mt-1 font-display text-2xl font-bold">Attendance overview</h1>
            <p className="mt-1 text-sm text-app-muted">Current status, monthly attendance, and recent punch history.</p>
          </div>
          <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${currentStatus === 'Working' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-app-surface-raised text-app-muted'}`}>
            {currentLoading ? 'Loading status…' : currentStatus}
          </span>
        </div>

        <Card>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
            ['Arrived', fmtTime(currentRecord?.arrivalAt ?? null, organizationTimezone)],
              ['Work', fmt(currentRecord?.minutes.worked ?? 0)],
              ['Break', fmt(currentRecord?.minutes.break ?? 0)],
            ['Punched out', fmtTime(currentRecord?.departureAt ?? null, organizationTimezone)],
            ].map(([label, value]) => <div key={label} className="rounded-xl bg-app-surface-raised px-4 py-3"><p className="text-xs font-semibold text-app-muted">{label}</p><p className="mt-1 text-xl font-bold tabular-nums">{value}</p></div>)}
          </div>
        </Card>

        {monthlyError && <p role="alert" className="rounded-xl border border-[#d86b6b]/30 bg-[#d86b6b]/10 px-3 py-2 text-sm text-app-danger">{monthlyError}</p>}
        <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.9fr)]">
          <div className="min-w-0 space-y-4">
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold">Monthly attendance</h2><p className="mt-1 text-sm text-app-muted">Attendance summary for {fmtMonth(month)}.</p></div><span className="text-xs text-app-muted">Based on calculated attendance records</span></div>
              {monthlySummary && <div className="mt-4"><AttendanceKpis columns={5} items={[{ label: 'Present days', value: daysValue(monthlySummary.presentUnits), tone: 'border-emerald-200 dark:border-emerald-800' }, { label: 'Late days', value: monthlySummary.lateDays, tone: 'border-amber-200 dark:border-amber-800' }, { label: 'Absent days', value: daysValue(monthlySummary.absentUnits), tone: 'border-rose-200 dark:border-rose-800' }, { label: 'Paid leave', value: daysValue(monthlySummary.paidLeaveUnits), tone: 'border-violet-200 dark:border-violet-800' }, { label: 'Unpaid leave', value: daysValue(monthlySummary.unpaidLeaveUnits), tone: 'border-violet-200 dark:border-violet-800' }, { label: 'Half days', value: monthlySummary.halfDays, tone: 'border-amber-200 dark:border-amber-800' }, { label: 'WFH days', value: monthlySummary.wfhDays, tone: 'border-sky-200 dark:border-sky-800' }, { label: 'Worked', value: fmt(monthlySummary.workedMinutes) }]} /></div>}
              {monthlyLoading && !monthlySummary && <p role="status" className="mt-4 text-sm text-app-muted">Loading monthly attendance summary…</p>}
            </Card>

            {monthlySummary && <AttendanceMonthlyHighlights month={fmtMonth(month)} attendance={attendancePercent} onTime={onTimePercent} totalHours={totalHours} averageHours={averageHours} />}
          </div>

          <Card className="min-w-0 overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold">Recent days</h2><p className="mt-1 text-sm text-app-muted">Your latest seven attendance records.</p></div></div>
            {recentError && <p role="alert" className="mt-3 text-sm text-app-danger">{recentError}</p>}
            {recentLoading ? <p role="status" className="mt-3 text-sm text-app-muted">Loading recent attendance…</p> : recentRecords.length === 0 ? <p className="mt-3 text-sm text-app-muted">No attendance records for the recent seven days.</p> : <div className="mt-4 max-h-[30rem] overflow-y-auto overscroll-contain divide-y divide-app-border rounded-xl border border-app-border pr-1">{recentRecords.map((day) => <button key={day.workDate} type="button" onClick={() => setSelectedDate(day.workDate)} className="flex w-full flex-col gap-2 px-4 py-3 text-left hover:bg-app-background"><span className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3"><span className="font-semibold whitespace-nowrap">{fmtDate(day.workDate)}</span><span className={`shrink-0 self-start whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${recentStatusClass(day)}`}>{dayLabel(day)}</span></span><span className="min-w-0 whitespace-normal break-words text-xs leading-5 text-app-muted">{fmtTime(day.arrivalAt, organizationTimezone)} – {fmtTime(day.departureAt, organizationTimezone)} · Work {fmt(day.minutes.worked)} · Break {fmt(day.minutes.break)}</span></button>)}</div>}
          </Card>
        </div>
      </div>
      <PeopleCalendar
        month={month}
        selectedDate={selectedDate}
        days={calDays}
        view={view}
        onMonthChange={setMonth}
        onSelectDate={setSelectedDate}
        onViewChange={setView}
        idPrefix="attendance"
      />
      {daysLoading && <p role="status" className="text-sm text-app-muted">Loading attendance calendar…</p>}
      {daysError && <p role="alert" className="rounded-xl border border-[#d86b6b]/30 bg-[#d86b6b]/10 px-3 py-2 text-sm text-app-danger">{daysError}</p>}

      <div className="rounded-2xl border border-app-border bg-app-surface p-4 sm:p-5">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-app-muted">
            {fmtDate(selectedDate)}
          </p>
          {(detail?.allowedActions?.requestCorrection || (!detailLoading && !detail && selectedDate <= today)) && !showCorrectionForm && (
            <button
              type="button"
              onClick={() => { setShowCorrectionForm(true); setCorrectionNotice(null); if (!detail) setCorrectionKind('add-event'); }}
              className="w-full rounded-lg border border-app-border px-3 py-2 text-xs text-app-muted hover:border-app-accent hover:text-app-foreground sm:w-auto sm:py-1.5"
            >
              Request correction
            </button>
          )}
        </div>

        {correctionNotice && <p role="status" className="mb-2 text-sm text-emerald-700 dark:text-emerald-300">{correctionNotice}</p>}
        {detailLoading && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="status" aria-label="Loading attendance details">
            {Array.from({ length: 4 }, (_, index) => <SkeletonMetric key={index} />)}
            <div className="sm:col-span-2 lg:col-span-4 space-y-2 rounded-xl bg-app-surface-raised p-4">
              <Skeleton className="h-3 w-20" />
              {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-8 w-full" />)}
            </div>
          </div>
        )}

        {!detailLoading && !detail && (
          <p className="text-sm text-app-muted">No attendance record for this date.</p>
        )}

        {detail?.record && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
              {[
                { label: 'Worked', value: fmt(detail.record.minutes.worked) },
                { label: 'Break', value: fmt(detail.record.minutes.break) },
                { label: 'Arrival', value: fmtTime(detail.record.arrivalAt, organizationTimezone) },
                { label: 'Departure', value: fmtTime(detail.record.departureAt, organizationTimezone) },
              ].map(({ label, value }) => (
                <div key={label} className="min-w-0 rounded-xl bg-app-surface-raised px-3 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-app-muted">{label}</p>
                  <p className="mt-0.5 text-base font-bold tabular-nums">{value}</p>
                </div>
              ))}
            </div>

            {effectiveEvents.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-app-muted">Events</p>
                <div className="space-y-1">
                  {effectiveEvents.map((ev) => (
                    <div key={ev.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-app-surface-raised px-3 py-2 text-xs">
                      <span className="font-semibold uppercase">{ev.kind.replace(/-/g, ' ')}</span>
                      <span className="tabular-nums text-app-muted">{fmtTime(ev.at ?? ev.occurredAt ?? null, organizationTimezone)}</span>
                      <span className="truncate text-app-muted">{ev.source}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {showCorrectionForm && (
          <div className="mt-4 space-y-3 rounded-xl border border-app-border p-4">
            <p className="text-sm font-semibold">Request correction</p>

            <div className="grid grid-cols-2 gap-2 sm:flex">
              {(['add-event', 'void-event'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setCorrectionKind(k)}
                  className={`rounded-lg border px-3 py-2 text-xs font-medium sm:py-1.5 ${correctionKind === k ? 'border-app-accent bg-app-accent/10 text-app-accent' : 'border-app-border text-app-muted hover:border-app-accent'}`}
                >
                  {k === 'add-event' ? 'Add event' : 'Void event'}
                </button>
              ))}
            </div>

            {correctionKind === 'add-event' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-app-muted">Event type</label>
                  <select
                    value={correctionEventKind}
                    onChange={(e) => setCorrectionEventKind(e.target.value as typeof correctionEventKind)}
                    className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm"
                  >
                    <option value="in">Check-in</option>
                    <option value="out">Check-out</option>
                    <option value="break-start">Break start</option>
                    <option value="break-end">Break end</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-app-muted">Date & time</label>
                  <input
                    type="datetime-local"
                    value={correctionAt}
                    onChange={(e) => setCorrectionAt(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm"
                  />
                </div>
              </div>
            )}

            {correctionKind === 'void-event' && (
              <div>
                <label className="block text-xs font-semibold text-app-muted">Event to void</label>
                <select
                  value={correctionTargetId}
                  onChange={(e) => setCorrectionTargetId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm"
                >
                  <option value="">Select event…</option>
                  {effectiveEvents.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.kind.replace(/-/g, ' ')} — {fmtTime(ev.at ?? ev.occurredAt ?? null, organizationTimezone)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-app-muted">Reason</label>
              <textarea
                value={correctionReason}
                onChange={(e) => setCorrectionReason(e.target.value)}
                rows={2}
                placeholder="Explain why this correction is needed…"
                className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm placeholder:text-app-muted focus:outline-none focus:ring-2 focus:ring-app-accent/30"
              />
            </div>

            {correctionError && <p className="text-xs text-app-danger">{correctionError}</p>}

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => void submitCorrection()}
                disabled={submitting}
                className="w-full rounded-lg bg-app-accent px-4 py-2 text-sm font-semibold text-app-on-accent disabled:opacity-50 sm:w-auto"
              >
                {submitting ? 'Submitting…' : 'Submit'}
              </button>
              <button
                type="button"
                onClick={() => { setShowCorrectionForm(false); setCorrectionError(null); }}
                className="w-full rounded-lg border border-app-border px-4 py-2 text-sm text-app-muted hover:border-app-accent sm:w-auto"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {myCorrections.length > 0 && (
        <div className="rounded-2xl border border-app-border bg-app-surface p-4 sm:p-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-app-muted">My correction requests</p>
          <div className="space-y-1.5">
            {myCorrections.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-app-surface-raised px-3 py-2 text-xs">
                <span>
                  <span className="font-semibold">{item.workDate}</span>
                  {' · '}
                  {item.kind === 'add-event' ? `Add ${(item.payload.kind ?? '').replace(/-/g, ' ')} at ${fmtTime(item.payload.at ?? null, organizationTimezone)}` : item.kind.replace(/-/g, ' ')}
                  {item.decisionNote ? <span className="text-app-muted"> — {item.decisionNote}</span> : null}
                </span>
                <span className={`rounded-full px-2 py-0.5 font-semibold capitalize ${item.status === 'approved' ? 'bg-emerald-500/12 text-emerald-800 dark:text-emerald-200' : item.status === 'rejected' ? 'bg-rose-500/12 text-rose-800 dark:text-rose-200' : 'bg-amber-500/14 text-amber-800 dark:text-amber-200'}`}>
                  {item.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </WorkspacePageContainer>
  );
}
