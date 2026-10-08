import { useEffect, useRef, useState } from 'react';
import { PeopleCalendar, type PeopleCalendarDay } from '../../ui/PeopleCalendar.js';
import {
  getAttendanceDays,
  getAttendanceDayDetail,
  listCorrections,
  requestAttendanceCorrection,
  type AttendanceDayView,
  type AttendanceDayDetail,
  type CorrectionListItem,
  type CorrectionRequest,
} from './attendanceApi.js';
import { calendarMonth } from '../../ui/calendar-model.js';

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function currentMonth(): string {
  return todayDate().slice(0, 7);
}

function dayTone(day: AttendanceDayView): PeopleCalendarDay['tone'] {
  if (day.minutes.late > 0) return 'warning';
  if (day.dayType === 'holiday' || day.dayType === 'leave') return 'neutral';
  const status = day.status?.toLowerCase() ?? '';
  if (status === 'present' || status === 'full-day') return 'positive';
  if (status === 'absent') return 'negative';
  if (status === 'half-day') return 'warning';
  if (day.minutes.worked > 0) return 'positive';
  return 'muted';
}

function dayLabel(day: AttendanceDayView): string {
  if (day.dayType === 'holiday') return 'Holiday';
  if (day.dayType === 'leave') return 'On leave';
  if (day.status) return day.status;
  if (day.minutes.worked > 0) return `${Math.floor(day.minutes.worked / 60)}h ${day.minutes.worked % 60}m`;
  return 'No record';
}

function fmt(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function AttendancePage({ userId }: { userId: string }): React.JSX.Element {
  const today = todayDate();
  const [month, setMonth] = useState(currentMonth());
  const [selectedDate, setSelectedDate] = useState(today);
  const [view, setView] = useState<'month' | 'week'>('month');
  const [days, setDays] = useState<AttendanceDayView[]>([]);
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

  useEffect(() => {
    const grid = calendarMonth(month);
    const from = grid[0]!;
    const to = grid[grid.length - 1]!;
    daysAbort.current?.abort();
    daysAbort.current = new AbortController();
    const sig = daysAbort.current.signal;
    void (async () => { try { setDays(await getAttendanceDays(from, to, userId, sig)); } catch { /* optional */ } })();
    return () => { daysAbort.current?.abort(); };
  }, [month, userId]);

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
      ? `${fmtTime(day.shift.start)}–${fmtTime(day.shift.end)}`
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

  return (
    <div className="space-y-4 p-4 sm:p-6">
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

      <div className="rounded-2xl border border-app-border bg-app-surface p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-app-muted">
            {selectedDate}
          </p>
          {(detail?.allowedActions?.requestCorrection || (!detailLoading && !detail && selectedDate <= today)) && !showCorrectionForm && (
            <button
              type="button"
              onClick={() => { setShowCorrectionForm(true); setCorrectionNotice(null); if (!detail) setCorrectionKind('add-event'); }}
              className="rounded-lg border border-app-border px-3 py-1.5 text-xs text-app-muted hover:border-app-accent hover:text-app-foreground"
            >
              Request correction
            </button>
          )}
        </div>

        {correctionNotice && <p role="status" className="mb-2 text-sm text-emerald-700 dark:text-emerald-300">{correctionNotice}</p>}
        {detailLoading && <p className="text-sm text-app-muted">Loading…</p>}

        {!detailLoading && !detail && (
          <p className="text-sm text-app-muted">No attendance record for this date.</p>
        )}

        {detail?.record && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3">
              {[
                { label: 'Worked', value: fmt(detail.record.minutes.worked) },
                { label: 'Break', value: fmt(detail.record.minutes.break) },
                { label: 'Arrival', value: fmtTime(detail.record.arrivalAt) },
                { label: 'Departure', value: fmtTime(detail.record.departureAt) },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-xl bg-app-surface-raised px-3 py-2.5">
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
                    <div key={ev.id} className="flex items-center gap-3 rounded-lg bg-app-surface-raised px-3 py-2 text-xs">
                      <span className="font-semibold uppercase">{ev.kind.replace(/-/g, ' ')}</span>
                      <span className="tabular-nums text-app-muted">{fmtTime(ev.at ?? ev.occurredAt ?? null)}</span>
                      <span className="text-app-muted">{ev.source}</span>
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

            <div className="flex gap-2">
              {(['add-event', 'void-event'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setCorrectionKind(k)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${correctionKind === k ? 'border-app-accent bg-app-accent/10 text-app-accent' : 'border-app-border text-app-muted hover:border-app-accent'}`}
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
                      {ev.kind.replace(/-/g, ' ')} — {fmtTime(ev.at ?? ev.occurredAt ?? null)}
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

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void submitCorrection()}
                disabled={submitting}
                className="rounded-lg bg-app-accent px-4 py-2 text-sm font-semibold text-app-on-accent disabled:opacity-50"
              >
                {submitting ? 'Submitting…' : 'Submit'}
              </button>
              <button
                type="button"
                onClick={() => { setShowCorrectionForm(false); setCorrectionError(null); }}
                className="rounded-lg border border-app-border px-4 py-2 text-sm text-app-muted hover:border-app-accent"
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
                  {item.kind === 'add-event' ? `Add ${(item.payload.kind ?? '').replace(/-/g, ' ')} at ${fmtTime(item.payload.at ?? null)}` : item.kind.replace(/-/g, ' ')}
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
    </div>
  );
}
