import { useEffect, useMemo, useState } from 'react';
import { getCompanyDepartments, type CompanyDepartment } from '../api/companyApi.js';
import { listShifts, type ShiftTemplate } from '../api/shiftsApi.js';
import { createHoliday, createHolidayBatch, listHolidays, withdrawHoliday, type Holiday } from '../api/holidaysApi.js';
import { SkeletonTable } from '../../ui/components.js';

type HolidayType = 'national' | 'regional' | 'optional' | 'week-off';
type BulkHolidayRow = { name: string; holidayDate: string; type: 'national' | 'optional' };
const blankBulkRow = (): BulkHolidayRow => ({ name: '', holidayDate: '', type: 'national' });

function currentYear(): number { return new Date().getFullYear(); }
function formatDate(value: string | null): string {
  if (!value) return 'Recurring';
  return new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
}
function typeLabel(type: string): string { return type === 'week-off' ? 'Recurring week-off' : type.charAt(0).toUpperCase() + type.slice(1); }

export function HolidaysPage({ canManage = false }: { canManage?: boolean }): React.JSX.Element {
  const [year, setYear] = useState(currentYear());
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showBulkForm, setShowBulkForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<HolidayType>('national');
  const [holidayDate, setHolidayDate] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>([6, 7]);
  const [scopeKind, setScopeKind] = useState<'national' | 'department' | 'shift'>('national');
  const [scopeIds, setScopeIds] = useState<string[]>([]);
  const [departments, setDepartments] = useState<CompanyDepartment[]>([]);
  const [shifts, setShifts] = useState<ShiftTemplate[]>([]);
  const [bulkRows, setBulkRows] = useState<BulkHolidayRow[]>([blankBulkRow()]);

  async function reload(): Promise<void> {
    const { holidays: data } = await listHolidays({ from: `${year}-01-01`, to: `${year}-12-31` });
    setHolidays(data);
  }
  useEffect(() => {
    setLoading(true);
    void listHolidays({ from: `${year}-01-01`, to: `${year}-12-31` }).then(({ holidays: data }) => setHolidays(data)).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load holidays.')).finally(() => setLoading(false));
  }, [year]);
  useEffect(() => {
    if (!canManage) return;
    void Promise.all([getCompanyDepartments(), listShifts()]).then(([departmentRows, shiftRows]) => { setDepartments(departmentRows); setShifts(shiftRows); }).catch(() => undefined);
  }, [canManage]);

  const active = useMemo(() => holidays.filter((holiday) => holiday.status === 'active').sort((a, b) => (a.holidayDate ?? '').localeCompare(b.holidayDate ?? '')), [holidays]);
  const upcoming = active.filter((holiday) => holiday.holidayDate && holiday.holidayDate >= new Date().toISOString().slice(0, 10)).length;
  const scopeOptions = scopeKind === 'department' ? departments.map((item) => ({ id: item.id, label: `${item.code} · ${item.name}` })) : shifts.map((item) => ({ id: item.id, label: `${item.code} · ${item.name}` }));
  const togglePanel = (panel: 'single' | 'bulk') => { setShowForm(panel === 'single' ? !showForm : false); setShowBulkForm(panel === 'bulk' ? !showBulkForm : false); setError(null); };

  async function submitHoliday(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!name.trim()) return setError('Holiday name is required.');
    if (type !== 'week-off' && !holidayDate) return setError('Select a holiday date.');
    if (type === 'week-off' && (!effectiveFrom || weekdays.length === 0)) return setError('Week-offs need a start date and at least one weekday.');
    if (type === 'regional' && (scopeKind === 'national' || scopeIds.length === 0)) return setError('Select at least one department or shift for a regional holiday.');
    setSubmitting(true); setError(null);
    try {
      await createHoliday({ name: name.trim(), type, ...(type === 'week-off' ? { effectiveFrom, ...(effectiveTo ? { effectiveTo } : {}), recurrence: { weekdays } } : { holidayDate }), scopes: scopeKind === 'national' ? [] : scopeIds.map((id) => ({ departmentId: scopeKind === 'department' ? id : null, shiftId: scopeKind === 'shift' ? id : null })) });
      setShowForm(false); setName(''); setHolidayDate(''); setEffectiveFrom(''); setEffectiveTo(''); setWeekdays([6, 7]); setScopeIds([]); setScopeKind('national'); await reload();
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to create holiday.'); } finally { setSubmitting(false); }
  }
  async function submitBulk(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const rows = bulkRows.filter((row) => row.name.trim() || row.holidayDate);
    if (rows.length === 0 || rows.some((row) => !row.name.trim() || !row.holidayDate)) return setError('Each holiday row needs a name and date.');
    setSubmitting(true); setError(null);
    try { await createHolidayBatch({ holidays: rows }); setShowBulkForm(false); setBulkRows([blankBulkRow()]); await reload(); } catch (err) { setError(err instanceof Error ? err.message : 'Failed to create holidays.'); } finally { setSubmitting(false); }
  }
  async function handleWithdraw(id: string): Promise<void> {
    if (!window.confirm('Withdraw this holiday from the organization calendar?')) return;
    try { await withdrawHoliday(id); await reload(); } catch (err) { setError(err instanceof Error ? err.message : 'Failed to withdraw holiday.'); }
  }
  const updateBulkRow = (index: number, patch: Partial<BulkHolidayRow>) => setBulkRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col gap-5 rounded-3xl border border-app-border bg-app-surface/70 p-5 sm:p-7 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[0.18em] text-app-accent">HR · Calendar</p><h1 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">Holidays</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-app-muted sm:text-base">Plan organization days off and keep everyone’s attendance calendar in sync.</p></div>
        {canManage && <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row"><button type="button" onClick={() => togglePanel('single')} className="rounded-xl bg-app-accent px-4 py-2.5 text-sm font-semibold text-app-on-accent shadow-sm transition hover:-translate-y-px hover:brightness-110">{showForm ? 'Close form' : 'Add holiday'}</button><button type="button" onClick={() => togglePanel('bulk')} className="rounded-xl border border-app-accent/40 bg-app-accent/10 px-4 py-2.5 text-sm font-semibold text-app-accent transition hover:border-app-accent hover:bg-app-accent/15">{showBulkForm ? 'Close bulk entry' : 'Add multiple'}</button></div>}
      </header>

      <section className="grid gap-3 sm:grid-cols-[auto_1fr] lg:grid-cols-[auto_1fr_auto]">
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-app-border bg-app-surface p-2"><button type="button" onClick={() => setYear((value) => value - 1)} className="grid h-10 w-10 place-items-center rounded-xl border border-app-border text-lg transition hover:border-app-accent hover:text-app-accent" aria-label="Previous year">‹</button><span className="min-w-20 text-center text-lg font-bold tabular-nums">{year}</span><button type="button" onClick={() => setYear((value) => value + 1)} className="grid h-10 w-10 place-items-center rounded-xl border border-app-border text-lg transition hover:border-app-accent hover:text-app-accent" aria-label="Next year">›</button></div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><div className="rounded-2xl border border-app-border bg-app-surface p-4"><p className="text-xs font-semibold uppercase tracking-wider text-app-muted">Active holidays</p><p className="mt-1 text-2xl font-bold tabular-nums">{active.length}</p></div><div className="rounded-2xl border border-app-border bg-app-surface p-4"><p className="text-xs font-semibold uppercase tracking-wider text-app-muted">Upcoming</p><p className="mt-1 text-2xl font-bold tabular-nums">{upcoming}</p></div><div className="col-span-2 rounded-2xl border border-app-border bg-app-surface p-4 sm:col-span-1"><p className="text-xs font-semibold uppercase tracking-wider text-app-muted">Calendar year</p><p className="mt-1 text-2xl font-bold tabular-nums">{year}</p></div></div>
        <div className="hidden items-center justify-end text-right text-sm text-app-muted lg:flex">Changes update attendance automatically</div>
      </section>

      {error && <div role="alert" className="flex items-start justify-between gap-3 rounded-2xl border border-app-danger/30 bg-app-danger/10 px-4 py-3 text-sm text-app-danger"><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Dismiss error">×</button></div>}

      {canManage && showBulkForm && <form onSubmit={(event) => void submitBulk(event)} className="space-y-5 rounded-3xl border border-app-accent/20 bg-app-surface p-5 sm:p-6"><div><h2 className="text-lg font-bold">Add multiple holidays</h2><p className="mt-1 text-sm text-app-muted">Add several dated holidays together. Every row keeps its own name and type.</p></div><div className="space-y-3">{bulkRows.map((row, index) => <div key={index} className="grid gap-2 rounded-2xl border border-app-border bg-app-background/40 p-3 sm:grid-cols-[minmax(0,1fr)_12rem_9rem_auto] sm:items-center"><input value={row.name} onChange={(event) => updateBulkRow(index, { name: event.target.value })} className="min-w-0 rounded-xl border border-app-border bg-app-surface px-3 py-2.5 text-sm outline-none focus:border-app-accent" placeholder="Holiday name" /><input type="date" value={row.holidayDate} onChange={(event) => updateBulkRow(index, { holidayDate: event.target.value })} className="rounded-xl border border-app-border bg-app-surface px-3 py-2.5 text-sm outline-none focus:border-app-accent" /><select value={row.type} onChange={(event) => updateBulkRow(index, { type: event.target.value as BulkHolidayRow['type'] })} className="rounded-xl border border-app-border bg-app-surface px-3 py-2.5 text-sm outline-none focus:border-app-accent"><option value="national">National</option><option value="optional">Optional</option></select><button type="button" disabled={bulkRows.length === 1} onClick={() => setBulkRows((rows) => rows.filter((_, rowIndex) => rowIndex !== index))} className="rounded-xl border border-app-border px-3 py-2.5 text-sm text-app-danger transition hover:border-app-danger disabled:opacity-40" aria-label={`Remove holiday row ${index + 1}`}>Remove</button></div>)}</div><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><button type="button" onClick={() => setBulkRows((rows) => [...rows, blankBulkRow()])} className="text-left text-sm font-semibold text-app-accent hover:underline">+ Add another holiday</button><button type="submit" disabled={submitting} className="rounded-xl bg-app-accent px-5 py-2.5 text-sm font-semibold text-app-on-accent disabled:opacity-60">{submitting ? 'Saving…' : 'Save all holidays'}</button></div></form>}

      {canManage && showForm && <form onSubmit={(event) => void submitHoliday(event)} className="space-y-5 rounded-3xl border border-app-accent/20 bg-app-surface p-5 sm:p-6"><div><h2 className="text-lg font-bold">Add holiday</h2><p className="mt-1 text-sm text-app-muted">Create a dated holiday or a recurring week-off rule.</p></div><div className="grid gap-3 md:grid-cols-2"><label className="text-sm font-semibold">Holiday name<input value={name} onChange={(event) => setName(event.target.value)} className="mt-1.5 w-full rounded-xl border border-app-border bg-app-background px-3 py-2.5 font-normal outline-none focus:border-app-accent" placeholder="e.g. Independence Day" /></label><label className="text-sm font-semibold">Type<select value={type} onChange={(event) => { setType(event.target.value as HolidayType); setScopeIds([]); }} className="mt-1.5 w-full rounded-xl border border-app-border bg-app-background px-3 py-2.5 font-normal outline-none focus:border-app-accent"><option value="national">National</option><option value="regional">Regional</option><option value="optional">Optional</option><option value="week-off">Recurring week-off</option></select></label>{type !== 'week-off' ? <label className="text-sm font-semibold">Date<input type="date" value={holidayDate} onChange={(event) => setHolidayDate(event.target.value)} className="mt-1.5 w-full rounded-xl border border-app-border bg-app-background px-3 py-2.5 font-normal outline-none focus:border-app-accent" /></label> : <><label className="text-sm font-semibold">Effective from<input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} className="mt-1.5 w-full rounded-xl border border-app-border bg-app-background px-3 py-2.5 font-normal outline-none focus:border-app-accent" /></label><label className="text-sm font-semibold">Effective to <span className="font-normal text-app-muted">(optional)</span><input type="date" value={effectiveTo} onChange={(event) => setEffectiveTo(event.target.value)} className="mt-1.5 w-full rounded-xl border border-app-border bg-app-background px-3 py-2.5 font-normal outline-none focus:border-app-accent" /></label></>}</div>{type === 'week-off' && <fieldset><legend className="text-sm font-semibold">Repeats on</legend><div className="mt-2 flex flex-wrap gap-2">{[['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6], ['Sun', 7]].map(([label, day]) => <label key={day} className="inline-flex items-center gap-2 rounded-xl border border-app-border px-3 py-2 text-sm"><input type="checkbox" checked={weekdays.includes(day as number)} onChange={() => setWeekdays((current) => current.includes(day as number) ? current.filter((item) => item !== day) : [...current, day as number])} />{label}</label>)}</div></fieldset>}{type !== 'national' && <div className="grid gap-3 md:grid-cols-2"><label className="text-sm font-semibold">Scope<select value={scopeKind} onChange={(event) => { setScopeKind(event.target.value as typeof scopeKind); setScopeIds([]); }} className="mt-1.5 w-full rounded-xl border border-app-border bg-app-background px-3 py-2.5 font-normal outline-none focus:border-app-accent"><option value="national">Everyone</option><option value="department">Departments</option><option value="shift">Shifts</option></select></label>{scopeKind !== 'national' && <label className="text-sm font-semibold">{scopeKind === 'department' ? 'Departments' : 'Shifts'}<select multiple value={scopeIds} onChange={(event) => setScopeIds(Array.from(event.target.selectedOptions, (option) => option.value))} className="mt-1.5 min-h-28 w-full rounded-xl border border-app-border bg-app-background px-3 py-2.5 font-normal outline-none focus:border-app-accent">{scopeOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>}</div>}<div className="flex justify-end"><button type="submit" disabled={submitting} className="rounded-xl bg-app-accent px-5 py-2.5 text-sm font-semibold text-app-on-accent disabled:opacity-60">{submitting ? 'Saving…' : 'Save holiday'}</button></div></form>}

      <section className="overflow-hidden rounded-3xl border border-app-border bg-app-surface"><div className="flex flex-col gap-1 border-b border-app-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div><h2 className="font-bold">{year} holiday calendar</h2><p className="text-sm text-app-muted">{active.length === 0 ? 'No active holidays configured.' : `${active.length} active holiday${active.length === 1 ? '' : 's'} for this year.`}</p></div><span className="rounded-full bg-app-accent/10 px-3 py-1 text-xs font-semibold text-app-accent">{upcoming} upcoming</span></div>{loading && <div className="p-5"><SkeletonTable columns={canManage ? 4 : 3} rows={5} /></div>}{!loading && active.length === 0 && <div className="px-5 py-14 text-center sm:px-6"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-app-accent/10 text-xl text-app-accent">✦</div><h3 className="mt-4 font-semibold">No holidays for {year}</h3><p className="mt-1 text-sm text-app-muted">Add a holiday to start building the organization calendar.</p></div>}{!loading && active.length > 0 && <><div className="hidden md:block"><table className="w-full text-sm"><thead className="bg-app-background/40"><tr className="border-b border-app-border text-left"><th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-app-muted">Date</th><th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-app-muted">Holiday</th><th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-app-muted">Type</th>{canManage && <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-app-muted">Action</th>}</tr></thead><tbody>{active.map((holiday) => <tr key={holiday.id} className="border-b border-app-border last:border-0 hover:bg-app-background/40"><td className="px-6 py-4 tabular-nums text-app-muted">{formatDate(holiday.holidayDate)}</td><td className="px-6 py-4 font-semibold">{holiday.name}</td><td className="px-6 py-4 text-app-muted">{typeLabel(holiday.type)}</td>{canManage && <td className="px-6 py-4 text-right"><button type="button" onClick={() => void handleWithdraw(holiday.id)} className="rounded-lg px-2 py-1 text-sm font-semibold text-app-danger transition hover:bg-app-danger/10">Withdraw</button></td>}</tr>)}</tbody></table></div><div className="divide-y divide-app-border md:hidden">{active.map((holiday) => <article key={holiday.id} className="space-y-3 px-5 py-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{holiday.name}</p><p className="mt-1 text-sm text-app-muted">{formatDate(holiday.holidayDate)}</p></div><span className="shrink-0 rounded-full bg-app-background px-2.5 py-1 text-xs font-semibold text-app-muted">{typeLabel(holiday.type)}</span></div>{canManage && <button type="button" onClick={() => void handleWithdraw(holiday.id)} className="w-full rounded-xl border border-app-danger/30 px-3 py-2 text-sm font-semibold text-app-danger">Withdraw holiday</button>}</article>)}</div></>}</section>
    </div>
  );
}
