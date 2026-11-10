import { useCallback, useEffect, useState } from 'react';
import {
  acceptConfig,
  formatDate,
  formatMonth,
  listConfigs,
  type PayrollConfig,
} from '../api/payrollApi.js';
import { Button, Card, Notice, Page, SkeletonTable } from '../../ui/index.js';

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** One line per statutory rule the settings carry; empty when none are set. */
function statutorySummary(settings: Record<string, unknown>): string[] {
  const out: string[] = [];
  const pf = settings['pf'] as { employeeRate?: number; employerRate?: number; wageCeiling?: number } | undefined;
  if (pf && typeof pf.employeeRate === 'number' && typeof pf.employerRate === 'number')
    out.push(`PF ${+(pf.employeeRate * 100).toFixed(3)}% employee, ${+(pf.employerRate * 100).toFixed(3)}% employer${typeof pf.wageCeiling === 'number' && pf.wageCeiling > 0 ? `, wage capped at ₹${pf.wageCeiling.toLocaleString('en-IN')}` : ''}`);
  const pt = settings['professionalTax'] as { monthly?: number } | undefined;
  if (pt && typeof pt.monthly === 'number') out.push(`Professional tax ₹${pt.monthly.toLocaleString('en-IN')} a month`);
  const esi = settings['esi'] as { enabled?: boolean; employeeRate?: number; employerRate?: number; wageLimit?: number } | undefined;
  if (esi && typeof esi.enabled === 'boolean')
    out.push(esi.enabled
      ? `ESI ${+((esi.employeeRate ?? 0.0075) * 100).toFixed(3)}% employee, ${+((esi.employerRate ?? 0.0325) * 100).toFixed(3)}% employer, up to ₹${(esi.wageLimit ?? 21000).toLocaleString('en-IN')} gross`
      : 'ESI off');
  const ot = settings['overtime'] as { enabled?: boolean; multiplier?: number } | undefined;
  const hw = settings['holidayWork'] as { enabled?: boolean; multiplier?: number } | undefined;
  const rate = settings['ordinaryRate'] as { workingDaysPerMonth?: number; hoursPerDay?: number } | undefined;
  const ordinary = `basic ÷ (${rate?.workingDaysPerMonth ?? 26} days × ${rate?.hoursPerDay ?? 8} h)`;
  if (ot?.enabled) out.push(`Overtime paid at ${ot.multiplier ?? 2}× the hourly rate (${ordinary})`);
  if (hw?.enabled) out.push(`Work on holidays and weekly offs paid at ${hw.multiplier ?? 2}× the hourly rate`);
  return out;
}

const percent = (value: string): number | null => {
  const n = Number(value);
  return value.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 100 ? n / 100 : null;
};
const rupees = (value: string): number | null => {
  const n = Number(value);
  return value.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null;
};

const STATUS_LABELS: Record<PayrollConfig['status'], string> = {
  active: 'In use',
  superseded: 'Replaced',
  voided: 'Voided',
};

export function PayrollSettingsPage(): React.JSX.Element {
  const [configs, setConfigs] = useState<PayrollConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [month, setMonth] = useState(thisMonth());
  const [approval, setApproval] = useState('');
  const [payDay, setPayDay] = useState('');
  const [notes, setNotes] = useState('');
  // Statutory rules (PY-4). Left off, the salary structure's own PF/PT/ESI amounts apply.
  const [pfOn, setPfOn] = useState(true);
  const [pfEmployee, setPfEmployee] = useState('12');
  const [pfEmployer, setPfEmployer] = useState('12');
  const [pfCeiling, setPfCeiling] = useState('15000');
  const [ptMonthly, setPtMonthly] = useState(''); // PT differs by state: blank keeps the salary line's amount
  const [esiOn, setEsiOn] = useState(false);
  const [esiEmployee, setEsiEmployee] = useState('0.75');
  const [esiEmployer, setEsiEmployer] = useState('3.25');
  const [esiLimit, setEsiLimit] = useState('21000');
  // Overtime and holiday work are unpaid unless switched on.
  const [otOn, setOtOn] = useState(false);
  const [otMultiplier, setOtMultiplier] = useState('2');
  const [holidayOn, setHolidayOn] = useState(false);
  const [holidayMultiplier, setHolidayMultiplier] = useState('2');
  const [daysPerMonth, setDaysPerMonth] = useState('26');
  const [hoursPerDay, setHoursPerDay] = useState('8');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setConfigs((await listConfigs()).configs);
      setError(null);
    } catch (err) {
      setError(errorText(err, 'Unable to load payroll settings.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const effectiveFrom = `${month}-01`;
  const replacing = configs.find((c) => c.status === 'active' && c.effectiveFrom === effectiveFrom) ?? null;
  const inUse = configs
    .filter((c) => c.status === 'active')
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0] ?? null;

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const settings: Record<string, unknown> = { currency: 'INR' };
      if (payDay.trim()) settings['payDay'] = Number(payDay);
      if (notes.trim()) settings['notes'] = notes.trim();
      if (pfOn) {
        const employeeRate = percent(pfEmployee);
        const employerRate = percent(pfEmployer);
        if (employeeRate === null || employerRate === null) throw new Error('Enter the PF rates as percentages, for example 12.');
        settings['pf'] = { employeeRate, employerRate, ...(rupees(pfCeiling) ? { wageCeiling: rupees(pfCeiling) } : {}) };
      }
      if (ptMonthly.trim()) {
        const monthly = rupees(ptMonthly);
        if (monthly === null) throw new Error('Enter professional tax as a monthly amount in rupees.');
        settings['professionalTax'] = { monthly };
      }
      if (otOn) settings['overtime'] = { enabled: true, multiplier: rupees(otMultiplier) ?? 2 };
      if (holidayOn) settings['holidayWork'] = { enabled: true, multiplier: rupees(holidayMultiplier) ?? 2 };
      if (otOn || holidayOn)
        settings['ordinaryRate'] = { workingDaysPerMonth: rupees(daysPerMonth) ?? 26, hoursPerDay: rupees(hoursPerDay) ?? 8 };
      settings['esi'] = esiOn
        ? { enabled: true, employeeRate: percent(esiEmployee) ?? 0.0075, employerRate: percent(esiEmployer) ?? 0.0325, wageLimit: rupees(esiLimit) ?? 21000 }
        : { enabled: false };
      await acceptConfig({
        effectiveFrom,
        caHrApproval: approval.trim(),
        settings,
        supersedesConfigId: replacing?.id ?? null,
      });
      setNotice(
        replacing
          ? `Settings for ${formatMonth(effectiveFrom)} replaced.`
          : `Settings accepted, effective ${formatMonth(effectiveFrom)}. Payroll can now be run for that month and later.`,
      );
      setShowForm(false);
      setApproval('');
      setNotes('');
      setPayDay('');
      await load();
    } catch (err) {
      setError(errorText(err, 'Unable to accept the settings.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      eyebrow="Payroll"
      title="Payroll settings"
      description="Payroll runs only for months covered by accepted settings. Accepted settings are kept as evidence and never edited: to change them, accept new settings from a month on."
      action={!showForm && <Button onClick={() => setShowForm(true)}>Accept settings</Button>}
    >
      {!loading && configs.length === 0 && !showForm && (
        <div className="mt-6">
          <Notice error>No payroll settings are accepted yet, so no payroll run can be created. Accept settings to get started.</Notice>
        </div>
      )}
      {inUse && (
        <Card className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-app-muted">In use</p>
          <p className="mt-1 text-lg font-semibold">From {formatMonth(inUse.effectiveFrom)}</p>
          <p className="text-sm text-app-muted">Approved by {inUse.caHrApproval}</p>
          {statutorySummary(inUse.settings).length > 0 ? (
            <ul className="mt-2 space-y-0.5 text-sm">
              {statutorySummary(inUse.settings).map((line) => <li key={line}>{line}</li>)}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-app-muted">No statutory rules set: PF, PT and ESI come from each salary structure as entered. Overtime and holiday work are not paid.</p>
          )}
        </Card>
      )}
      {showForm && (
        <Card className="mt-6">
          <form onSubmit={(e) => void submit(e)} className="grid gap-4 md:grid-cols-2">
            <label className="text-xs font-semibold text-app-muted">
              <span className="mb-2 block">Applies from month</span>
              <input
                type="month"
                required
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
              />
            </label>
            <label className="text-xs font-semibold text-app-muted">
              <span className="mb-2 block">Approved by (CA / HR, with reference)</span>
              <input
                required
                value={approval}
                placeholder="e.g. CA R. Mehta, email of 12 Sep 2026"
                onChange={(e) => setApproval(e.target.value)}
                className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
              />
            </label>
            <label className="text-xs font-semibold text-app-muted">
              <span className="mb-2 block">Pay day (optional)</span>
              <input
                inputMode="numeric"
                value={payDay}
                placeholder="e.g. 1"
                onChange={(e) => setPayDay(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
                className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
              />
            </label>
            <label className="text-xs font-semibold text-app-muted">
              <span className="mb-2 block">Notes (optional)</span>
              <input
                value={notes}
                placeholder="e.g. PF at 12% of basic, professional tax as per Maharashtra slab"
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
              />
            </label>
            <fieldset className="grid gap-4 rounded-xl border border-app-border p-4 md:col-span-2 md:grid-cols-3">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-app-muted">Statutory deductions</legend>
              <p className="text-xs text-app-muted md:col-span-3">
                Applied to salary lines tagged PF, PT or ESI. PF is taken on the earned PF wage (lines tagged PF wage), capped at the ceiling.
              </p>
              <label className="flex items-center gap-2 text-sm md:col-span-3">
                <input type="checkbox" checked={pfOn} onChange={(e) => setPfOn(e.target.checked)} />
                Calculate PF from these rates
              </label>
              <label className="text-xs font-semibold text-app-muted">
                <span className="mb-2 block">PF employee rate (%)</span>
                <input
                  inputMode="decimal"
                  value={pfEmployee}
                  placeholder="12"
                  disabled={!pfOn}
                  onChange={(e) => setPfEmployee(e.target.value)}
                  className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent disabled:opacity-50"
                />
              </label>
              <label className="text-xs font-semibold text-app-muted">
                <span className="mb-2 block">PF employer rate (%)</span>
                <input
                  inputMode="decimal"
                  value={pfEmployer}
                  placeholder="12"
                  disabled={!pfOn}
                  onChange={(e) => setPfEmployer(e.target.value)}
                  className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent disabled:opacity-50"
                />
              </label>
              <label className="text-xs font-semibold text-app-muted">
                <span className="mb-2 block">PF wage ceiling (₹, blank for none)</span>
                <input
                  inputMode="decimal"
                  value={pfCeiling}
                  placeholder="15000"
                  disabled={!pfOn}
                  onChange={(e) => setPfCeiling(e.target.value)}
                  className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent disabled:opacity-50"
                />
              </label>
              <label className="text-xs font-semibold text-app-muted">
                <span className="mb-2 block">Professional tax per month (₹, blank to use the salary line)</span>
                <input
                  inputMode="decimal"
                  value={ptMonthly}
                  placeholder="200"
                  onChange={(e) => setPtMonthly(e.target.value)}
                  className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent disabled:opacity-50"
                />
              </label>
              <label className="flex items-center gap-2 text-sm md:col-span-3">
                <input type="checkbox" checked={esiOn} onChange={(e) => setEsiOn(e.target.checked)} />
                Deduct ESI
              </label>
              <label className="text-xs font-semibold text-app-muted">
                <span className="mb-2 block">ESI employee rate (%)</span>
                <input
                  inputMode="decimal"
                  value={esiEmployee}
                  placeholder="0.75"
                  disabled={!esiOn}
                  onChange={(e) => setEsiEmployee(e.target.value)}
                  className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent disabled:opacity-50"
                />
              </label>
              <label className="text-xs font-semibold text-app-muted">
                <span className="mb-2 block">ESI employer rate (%)</span>
                <input
                  inputMode="decimal"
                  value={esiEmployer}
                  placeholder="3.25"
                  disabled={!esiOn}
                  onChange={(e) => setEsiEmployer(e.target.value)}
                  className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent disabled:opacity-50"
                />
              </label>
              <label className="text-xs font-semibold text-app-muted">
                <span className="mb-2 block">ESI applies up to gross (₹)</span>
                <input
                  inputMode="decimal"
                  value={esiLimit}
                  placeholder="21000"
                  disabled={!esiOn}
                  onChange={(e) => setEsiLimit(e.target.value)}
                  className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent disabled:opacity-50"
                />
              </label>
            </fieldset>
            <fieldset className="grid gap-4 rounded-xl border border-app-border p-4 md:col-span-2 md:grid-cols-3">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-app-muted">Overtime and holiday work</legend>
              <p className="text-xs text-app-muted md:col-span-3">
                The hourly rate is the basic wage (lines tagged PF wage) over working days × hours. Overtime counts only confirmed overtime on working days.
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={otOn} onChange={(e) => setOtOn(e.target.checked)} />
                Pay overtime
              </label>
              <label className="text-xs font-semibold text-app-muted">
                <span className="mb-2 block">Overtime multiplier</span>
                <input
                  inputMode="decimal"
                  value={otMultiplier}
                  placeholder="2"
                  disabled={!otOn}
                  onChange={(e) => setOtMultiplier(e.target.value)}
                  className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent disabled:opacity-50"
                />
              </label>
              <span className="hidden md:block" />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={holidayOn} onChange={(e) => setHolidayOn(e.target.checked)} />
                Pay work on holidays and weekly offs
              </label>
              <label className="text-xs font-semibold text-app-muted">
                <span className="mb-2 block">Holiday work multiplier</span>
                <input
                  inputMode="decimal"
                  value={holidayMultiplier}
                  placeholder="2"
                  disabled={!holidayOn}
                  onChange={(e) => setHolidayMultiplier(e.target.value)}
                  className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent disabled:opacity-50"
                />
              </label>
              <span className="hidden md:block" />
              <label className="text-xs font-semibold text-app-muted">
                <span className="mb-2 block">Working days a month (hourly rate)</span>
                <input
                  inputMode="decimal"
                  value={daysPerMonth}
                  placeholder="26"
                  disabled={!otOn && !holidayOn}
                  onChange={(e) => setDaysPerMonth(e.target.value)}
                  className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent disabled:opacity-50"
                />
              </label>
              <label className="text-xs font-semibold text-app-muted">
                <span className="mb-2 block">Hours a day (hourly rate)</span>
                <input
                  inputMode="decimal"
                  value={hoursPerDay}
                  placeholder="8"
                  disabled={!otOn && !holidayOn}
                  onChange={(e) => setHoursPerDay(e.target.value)}
                  className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent disabled:opacity-50"
                />
              </label>
            </fieldset>
            {replacing && (
              <div className="md:col-span-2">
                <Notice>Settings for {formatMonth(effectiveFrom)} are already accepted. Saving replaces them; the earlier version stays on record.</Notice>
              </div>
            )}
            <div className="flex gap-2 md:col-span-2">
              <Button type="submit" disabled={busy || approval.trim() === ''}>{busy ? 'Saving…' : replacing ? 'Replace settings' : 'Accept settings'}</Button>
              <Button kind="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}
      {notice && <div className="mt-4"><Notice>{notice}</Notice></div>}
      {error && <div className="mt-4"><Notice error>{error}</Notice></div>}
      {loading && <div className="mt-6"><SkeletonTable columns={5} rows={5} /></div>}
      {configs.length > 0 && (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-app-border bg-app-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-app-border text-left text-xs uppercase tracking-wider text-app-muted">
                <th className="px-4 py-3">From</th>
                <th className="px-4 py-3">Approved by</th>
                <th className="px-4 py-3">Notes</th>
                <th className="px-4 py-3">Accepted</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {configs.map((config) => (
                <tr key={config.id} className={`border-b border-app-border last:border-0 ${config.status !== 'active' ? 'text-app-muted' : ''}`}>
                  <td className="px-4 py-3 font-medium">{formatMonth(config.effectiveFrom)}</td>
                  <td className="px-4 py-3">{config.caHrApproval}</td>
                  <td className="px-4 py-3 text-xs">
                    {typeof config.settings['notes'] === 'string' ? config.settings['notes'] : '—'}
                    {typeof config.settings['payDay'] === 'number' && <span className="block">Pay day: {String(config.settings['payDay'])}</span>}
                    {statutorySummary(config.settings).map((line) => <span key={line} className="block">{line}</span>)}
                  </td>
                  <td className="px-4 py-3 text-xs">{config.acceptedByName ?? '—'}, {formatDate(config.acceptedAt)}</td>
                  <td className="px-4 py-3 text-xs">{STATUS_LABELS[config.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
