import { useCallback, useEffect, useState } from 'react';
import {
  createWorkingDayException,
  createWeekdaySchedule,
  listWorkingDayExceptions,
  listWeekdaySchedules,
  setWorkingDayExceptionStatus,
  setWeekdayScheduleStatus,
  type WorkingDayException,
  type WeekdaySchedule,
} from '../api/shiftsApi.js';
import { getCompanyDepartments, type CompanyDepartment } from '../api/companyApi.js';
import { Button, Card, Page, SkeletonTableRows } from '../../ui/components.js';

const WEEKDAYS = [
  { value: 1, short: 'Mon', name: 'Monday' },
  { value: 2, short: 'Tue', name: 'Tuesday' },
  { value: 3, short: 'Wed', name: 'Wednesday' },
  { value: 4, short: 'Thu', name: 'Thursday' },
  { value: 5, short: 'Fri', name: 'Friday' },
  { value: 6, short: 'Sat', name: 'Saturday' },
  { value: 7, short: 'Sun', name: 'Sunday' },
] as const;

function weekdayNames(values: readonly number[]): string {
  return WEEKDAYS.filter((day) => values.includes(day.value)).map((day) => day.name).join(', ');
}

export function WeekdaySchedulesPage(): React.JSX.Element {
  const [schedules, setSchedules] = useState<WeekdaySchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [workingWeekdays, setWorkingWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [formError, setFormError] = useState('');
  const [scheduleFieldErrors, setScheduleFieldErrors] = useState({ name: '', weekdays: '' });
  const [saving, setSaving] = useState(false);
  const [exceptions, setExceptions] = useState<WorkingDayException[]>([]);
  const [departments, setDepartments] = useState<CompanyDepartment[]>([]);
  const [exceptionFormOpen, setExceptionFormOpen] = useState(false);
  const [exceptionDate, setExceptionDate] = useState('');
  const [exceptionReason, setExceptionReason] = useState('');
  const [exceptionScope, setExceptionScope] = useState<'organization' | 'departments'>('organization');
  const [exceptionDepartments, setExceptionDepartments] = useState<string[]>([]);
  const [exceptionFormError, setExceptionFormError] = useState('');
  const [exceptionFieldErrors, setExceptionFieldErrors] = useState({ date: '', reason: '', scope: '' });
  const [exceptionSaving, setExceptionSaving] = useState(false);
  const [exceptionPage, setExceptionPage] = useState(1);
  const [exceptionTotal, setExceptionTotal] = useState(0);
  const [exceptionTotalPages, setExceptionTotalPages] = useState(1);
  const [exceptionStatusTarget, setExceptionStatusTarget] = useState<WorkingDayException | null>(null);
  const [exceptionStatusError, setExceptionStatusError] = useState('');
  const [exceptionStatusSaving, setExceptionStatusSaving] = useState(false);
  const [scheduleStatusTarget, setScheduleStatusTarget] = useState<WeekdaySchedule | null>(null);
  const [scheduleStatusError, setScheduleStatusError] = useState('');
  const [scheduleStatusSaving, setScheduleStatusSaving] = useState(false);
  const exceptionPageSize = 10;

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [nextSchedules, nextExceptions, nextDepartments] = await Promise.all([
        listWeekdaySchedules(),
        listWorkingDayExceptions(exceptionPage, exceptionPageSize),
        getCompanyDepartments(),
      ]);
      setSchedules(nextSchedules);
      setExceptions(nextExceptions.items);
      setExceptionTotal(nextExceptions.total);
      setExceptionTotalPages(nextExceptions.totalPages);
      setDepartments(nextDepartments.filter((department) => department.status === 'active'));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load weekday schedules.');
    } finally {
      setLoading(false);
    }
  }, [exceptionPage]);

  useEffect(() => { void load(); }, [load]);

  function resetForm(): void {
    setName('');
    setWorkingWeekdays([1, 2, 3, 4, 5]);
    setFormError('');
    setScheduleFieldErrors({ name: '', weekdays: '' });
    setFormOpen(false);
  }

  function resetExceptionForm(): void {
    setExceptionDate('');
    setExceptionReason('');
    setExceptionScope('organization');
    setExceptionDepartments([]);
    setExceptionFormError('');
    setExceptionFieldErrors({ date: '', reason: '', scope: '' });
    setExceptionFormOpen(false);
  }

  function toggleWeekday(value: number): void {
    setWorkingWeekdays((current) =>
      current.includes(value)
        ? current.filter((day) => day !== value)
        : [...current, value].sort((a, b) => a - b),
    );
    setFormError('');
    setScheduleFieldErrors((current) => ({ ...current, weekdays: '' }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmedName = name.trim();
    const nextErrors = { name: '', weekdays: '' };
    if (!trimmedName) {
      nextErrors.name = 'Schedule name is required.';
    }
    if (trimmedName.length > 120) {
      nextErrors.name = 'Schedule name must be 120 characters or fewer.';
    }
    if (workingWeekdays.length === 0) {
      nextErrors.weekdays = 'Select at least one working weekday.';
    }
    setScheduleFieldErrors(nextErrors);
    if (nextErrors.name || nextErrors.weekdays) {
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await createWeekdaySchedule({ name: trimmedName, workingWeekdays });
      resetForm();
      await load();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Unable to create weekday schedule.');
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(schedule: WeekdaySchedule): Promise<void> {
    setScheduleStatusTarget(schedule);
    setScheduleStatusError('');
  }

  async function submitScheduleStatus(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!scheduleStatusTarget) return;
    const nextStatus = scheduleStatusTarget.status === 'active' ? 'inactive' : 'active';
    setScheduleStatusSaving(true);
    setScheduleStatusError('');
    try {
      await setWeekdayScheduleStatus(scheduleStatusTarget.id, nextStatus);
      setScheduleStatusTarget(null);
      await load();
    } catch (cause) {
      setScheduleStatusError(cause instanceof Error ? cause.message : 'Unable to update weekday schedule.');
    } finally {
      setScheduleStatusSaving(false);
    }
  }

  function toggleExceptionDepartment(id: string): void {
    setExceptionDepartments((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
    setExceptionFormError('');
    setExceptionFieldErrors((current) => ({ ...current, scope: '' }));
  }

  async function submitException(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const nextErrors = { date: '', reason: '', scope: '' };
    const reason = exceptionReason.trim();
    if (!exceptionDate) {
      nextErrors.date = 'Working date is required.';
    }
    if (!reason) {
      nextErrors.reason = 'Reason is required.';
    } else if (reason.length > 500) {
      nextErrors.reason = 'Reason must be 500 characters or fewer.';
    }
    if (exceptionScope === 'departments' && exceptionDepartments.length === 0) {
      nextErrors.scope = 'Select at least one department.';
    }
    setExceptionFieldErrors(nextErrors);
    if (nextErrors.date || nextErrors.reason || nextErrors.scope) {
      return;
    }
    setExceptionSaving(true);
    setExceptionFormError('');
    try {
      await createWorkingDayException({
        exceptionDate,
        reason,
        scope: exceptionScope === 'organization'
          ? { type: 'organization', departmentIds: [] }
          : { type: 'departments', departmentIds: exceptionDepartments },
      });
      resetExceptionForm();
      setExceptionPage(1);
      await load();
    } catch (cause) {
      setExceptionFormError(cause instanceof Error ? cause.message : 'Unable to create the exception.');
    } finally {
      setExceptionSaving(false);
    }
  }

  function beginExceptionStatusChange(exception: WorkingDayException): void {
    setExceptionStatusTarget(exception);
    setExceptionStatusError('');
  }

  async function submitExceptionStatus(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!exceptionStatusTarget) return;
    setExceptionStatusSaving(true);
    setExceptionStatusError('');
    try {
      await setWorkingDayExceptionStatus(
        exceptionStatusTarget.id,
        exceptionStatusTarget.status === 'active' ? 'inactive' : 'active',
      );
      setExceptionStatusTarget(null);
      await load();
    } catch (cause) {
      setExceptionStatusError(cause instanceof Error ? cause.message : 'Unable to update the working-day exception.');
    } finally {
      setExceptionStatusSaving(false);
    }
  }

  return (
    <Page
      eyebrow="People"
      title="Weekday schedules"
      description="Define which weekdays count as working days. Shift timings and attendance thresholds continue to come from the employee’s assigned shift."
      action={!formOpen ? <Button onClick={() => setFormOpen(true)}>New schedule</Button> : undefined}
    >
      {formOpen && (
        <Card>
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-bold">Create weekday schedule</h2>
              <p className="mt-1 text-sm text-app-muted">Use one schedule for a common working pattern such as Monday–Friday.</p>
            </div>
            <button type="button" className="text-sm font-semibold text-app-muted hover:text-app-foreground" onClick={resetForm}>Cancel</button>
          </div>
          <form onSubmit={(event) => void submit(event)} className="space-y-5">
            <div>
              <label htmlFor="weekday-schedule-name" className="mb-1.5 block text-sm font-semibold">Schedule name <span className="text-app-danger">*</span></label>
              <input
                id="weekday-schedule-name"
                value={name}
                onChange={(event) => { setName(event.target.value); setFormError(''); setScheduleFieldErrors((current) => ({ ...current, name: '' })); }}
                placeholder="Monday to Friday"
                maxLength={120}
                required
                aria-invalid={Boolean(scheduleFieldErrors.name)}
                aria-describedby={scheduleFieldErrors.name ? 'weekday-schedule-name-error' : undefined}
                className={`w-full rounded-xl border bg-app-background px-3.5 py-2.5 text-sm outline-none focus:border-app-accent ${scheduleFieldErrors.name ? 'border-app-danger' : 'border-app-border'}`}
              />
              {scheduleFieldErrors.name && <p id="weekday-schedule-name-error" role="alert" className="mt-1.5 text-xs text-app-danger">{scheduleFieldErrors.name}</p>}
            </div>
            <fieldset>
              <legend className={`mb-2 text-sm font-semibold ${scheduleFieldErrors.weekdays ? 'text-app-danger' : ''}`}>Working weekdays <span className="text-app-danger">*</span></legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                {WEEKDAYS.map((day) => {
                  const selected = workingWeekdays.includes(day.value);
                  return (
                    <button
                      key={day.value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleWeekday(day.value)}
                      className={`rounded-xl border px-3 py-3 text-left transition ${selected ? 'border-app-accent bg-app-accent/10 text-app-accent' : 'border-app-border bg-app-background text-app-muted hover:border-app-accent'}`}
                    >
                      <span className="block text-sm font-bold">{day.short}</span>
                      <span className="mt-1 block text-xs">{selected ? 'Working day' : 'Week off'}</span>
                    </button>
                  );
                })}
              </div>
              {scheduleFieldErrors.weekdays && <p id="weekday-schedule-weekdays-error" role="alert" className="mt-1.5 text-xs text-app-danger">{scheduleFieldErrors.weekdays}</p>}
            </fieldset>
            {formError && <p role="alert" className="rounded-lg border border-app-danger/30 bg-app-danger/10 px-3 py-2 text-sm text-app-danger">{formError}</p>}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Create schedule'}</Button>
              <Button kind="secondary" onClick={resetForm}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      {error && <p role="alert" className="rounded-xl border border-app-danger/30 bg-app-danger/10 px-4 py-3 text-sm text-app-danger">{error}</p>}
      <Card className="overflow-hidden p-0">
        <div className="border-b border-app-border px-5 py-4">
          <h2 className="font-display text-lg font-bold">Available schedules</h2>
          <p className="mt-1 text-sm text-app-muted">Assign an active schedule while creating an employee.</p>
        </div>
        {loading ? <SkeletonTableRows count={3} /> : schedules.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-app-muted">No weekday schedules created yet.</div>
        ) : (
          <div className="divide-y divide-app-border">
            {scheduleStatusTarget && (
              <form onSubmit={(event) => void submitScheduleStatus(event)} className="m-4 rounded-xl border border-app-accent/30 bg-app-accent/5 p-4">
                <p className="text-sm font-semibold">
                  {scheduleStatusTarget.status === 'active' ? 'Deactivate' : 'Reactivate'} “{scheduleStatusTarget.name}”?
                </p>
                <p className="mt-1 text-sm text-app-muted">Attendance from today onward will use the updated schedule status.</p>
                {scheduleStatusError && <p role="alert" className="mt-3 rounded-lg border border-app-danger/30 bg-app-danger/10 px-3 py-2 text-sm text-app-danger">{scheduleStatusError}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="submit" disabled={scheduleStatusSaving}>{scheduleStatusSaving ? 'Updating…' : 'Confirm'}</Button>
                  <Button kind="secondary" type="button" onClick={() => setScheduleStatusTarget(null)}>Cancel</Button>
                </div>
              </form>
            )}
            {schedules.map((schedule) => (
              <div key={schedule.id} className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{schedule.name}</h3>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${schedule.status === 'active' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-app-background text-app-muted'}`}>
                      {schedule.status === 'active' ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-app-muted">{weekdayNames(schedule.workingWeekdays)}</p>
                </div>
                <Button kind="secondary" disabled={scheduleStatusSaving} onClick={() => void changeStatus(schedule)}>
                  {schedule.status === 'active' ? 'Deactivate' : 'Reactivate'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-bold">Working-day exceptions</h2>
            <p className="mt-1 text-sm text-app-muted">Turn a scheduled week-off into a working day for the whole organization or selected departments.</p>
          </div>
          {!exceptionFormOpen && <Button onClick={() => setExceptionFormOpen(true)}>New exception</Button>}
        </div>

        {exceptionFormOpen && (
          <form onSubmit={(event) => void submitException(event)} className="mb-6 rounded-xl border border-app-border bg-app-surface-raised p-4 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="working-day-exception-date" className="mb-1.5 block text-sm font-semibold">Working date <span className="text-app-danger">*</span></label>
                <input id="working-day-exception-date" type="date" value={exceptionDate} required aria-invalid={Boolean(exceptionFieldErrors.date)} aria-describedby={exceptionFieldErrors.date ? 'working-day-exception-date-error' : undefined} onChange={(event) => { setExceptionDate(event.target.value); setExceptionFormError(''); setExceptionFieldErrors((current) => ({ ...current, date: '' })); }} className={`w-full rounded-xl border bg-app-background px-3.5 py-2.5 text-sm outline-none focus:border-app-accent ${exceptionFieldErrors.date ? 'border-app-danger' : 'border-app-border'}`} />
                {exceptionFieldErrors.date && <p id="working-day-exception-date-error" role="alert" className="mt-1.5 text-xs text-app-danger">{exceptionFieldErrors.date}</p>}
              </div>
              <div>
                <label htmlFor="working-day-exception-reason" className="mb-1.5 block text-sm font-semibold">Reason <span className="text-app-danger">*</span></label>
                <input id="working-day-exception-reason" value={exceptionReason} required aria-invalid={Boolean(exceptionFieldErrors.reason)} aria-describedby={exceptionFieldErrors.reason ? 'working-day-exception-reason-error' : undefined} onChange={(event) => { setExceptionReason(event.target.value); setExceptionFormError(''); setExceptionFieldErrors((current) => ({ ...current, reason: '' })); }} maxLength={500} placeholder="Annual closing day made working" className={`w-full rounded-xl border bg-app-background px-3.5 py-2.5 text-sm outline-none focus:border-app-accent ${exceptionFieldErrors.reason ? 'border-app-danger' : 'border-app-border'}`} />
                {exceptionFieldErrors.reason && <p id="working-day-exception-reason-error" role="alert" className="mt-1.5 text-xs text-app-danger">{exceptionFieldErrors.reason}</p>}
              </div>
            </div>
            <fieldset>
              <legend className={`mb-2 text-sm font-semibold ${exceptionFieldErrors.scope ? 'text-app-danger' : ''}`}>Applies to <span className="text-app-danger">*</span></legend>
              <div className="flex flex-wrap gap-2">
                {(['organization', 'departments'] as const).map((scope) => (
                  <button key={scope} type="button" aria-pressed={exceptionScope === scope} onClick={() => { setExceptionScope(scope); setExceptionFormError(''); setExceptionFieldErrors((current) => ({ ...current, scope: '' })); }} className={`rounded-xl border px-3 py-2 text-sm font-semibold ${exceptionScope === scope ? 'border-app-accent bg-app-accent/10 text-app-accent' : 'border-app-border text-app-muted'}`}>
                    {scope === 'organization' ? 'Entire organization' : 'Selected departments'}
                  </button>
                ))}
              </div>
            </fieldset>
            {exceptionScope === 'departments' && (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {departments.map((department) => (
                  <label key={department.id} className="flex items-center gap-2 rounded-lg border border-app-border px-3 py-2 text-sm">
                    <input type="checkbox" checked={exceptionDepartments.includes(department.id)} onChange={() => toggleExceptionDepartment(department.id)} />
                    <span>{department.name}</span>
                  </label>
                ))}
                {departments.length === 0 && <p className="text-sm text-app-muted">No active departments are available.</p>}
                {exceptionFieldErrors.scope && <p id="working-day-exception-scope-error" role="alert" className="sm:col-span-2 lg:col-span-3 text-xs text-app-danger">{exceptionFieldErrors.scope}</p>}
              </div>
            )}
            {exceptionFormError && <p role="alert" className="rounded-lg border border-app-danger/30 bg-app-danger/10 px-3 py-2 text-sm text-app-danger">{exceptionFormError}</p>}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={exceptionSaving}>{exceptionSaving ? 'Saving…' : 'Create exception'}</Button>
              <Button kind="secondary" type="button" onClick={resetExceptionForm}>Cancel</Button>
            </div>
          </form>
        )}

        {exceptions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-app-border px-5 py-10 text-center text-sm text-app-muted">No working-day exceptions created yet.</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-app-border">
            {exceptionStatusTarget && (
              <form onSubmit={(event) => void submitExceptionStatus(event)} className="m-4 rounded-xl border border-app-accent/30 bg-app-accent/5 p-4">
                <p className="text-sm font-semibold">
                  {exceptionStatusTarget.status === 'active' ? 'Deactivate' : 'Reactivate'} the exception for {exceptionStatusTarget.exceptionDate}?
                </p>
                <p className="mt-1 text-sm text-app-muted">{exceptionStatusTarget.reason}</p>
                {exceptionStatusError && <p role="alert" className="mt-3 rounded-lg border border-app-danger/30 bg-app-danger/10 px-3 py-2 text-sm text-app-danger">{exceptionStatusError}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="submit" disabled={exceptionStatusSaving}>{exceptionStatusSaving ? 'Updating…' : 'Confirm'}</Button>
                  <Button kind="secondary" type="button" onClick={() => setExceptionStatusTarget(null)}>Cancel</Button>
                </div>
              </form>
            )}
            <table className="w-full min-w-[720px] text-sm">
              <thead><tr className="border-b border-app-border bg-app-surface-raised text-left text-xs uppercase tracking-wider text-app-muted"><th className="px-4 py-3">Date</th><th className="px-4 py-3">Reason</th><th className="px-4 py-3">Scope</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Action</th></tr></thead>
              <tbody>
                {exceptions.map((exception) => (
                  <tr key={exception.id} className="border-b border-app-border last:border-0">
                    <td className="px-4 py-3 font-semibold">{new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${exception.exceptionDate}T12:00:00Z`))}</td>
                    <td className="px-4 py-3">{exception.reason}</td>
                    <td className="px-4 py-3 text-app-muted">{exception.departmentNames.length === 0 ? 'Entire organization' : exception.departmentNames.join(', ')}</td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${exception.status === 'active' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-app-background text-app-muted'}`}>{exception.status === 'active' ? 'Active' : 'Inactive'}</span></td>
                    <td className="px-4 py-3 text-right"><Button kind="secondary" disabled={exceptionStatusSaving} onClick={() => beginExceptionStatusChange(exception)}>{exception.status === 'active' ? 'Deactivate' : 'Reactivate'}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-app-border px-4 py-3 text-sm text-app-muted">
              <span>{exceptionTotal} exception{exceptionTotal === 1 ? '' : 's'} · Page {exceptionPage} of {exceptionTotalPages}</span>
              <div className="flex gap-2">
                <Button kind="secondary" disabled={exceptionPage <= 1} onClick={() => setExceptionPage((page) => page - 1)}>Previous</Button>
                <Button kind="secondary" disabled={exceptionPage >= exceptionTotalPages} onClick={() => setExceptionPage((page) => page + 1)}>Next</Button>
              </div>
            </div>
          </div>
        )}
      </Card>
    </Page>
  );
}
