import { useCallback, useEffect, useState } from 'react';
import {
  formatDate,
  formatRupees,
  listStructureHistory,
  listStructureSummaries,
  saveStructure,
  type SalaryStructure,
  type SaveStructureLine,
  type StructureLineKind,
  type StructureSummary,
} from '../api/payrollApi.js';
import { Button, Modal, Notice, Page, SkeletonTable } from '../../ui/components.js';

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function firstOfNextMonth(): string {
  const now = new Date();
  const year = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
  const month = now.getMonth() === 11 ? 1 : now.getMonth() + 2;
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

interface LineDraft {
  key: number;
  label: string;
  code: string;
  codeTouched: boolean;
  kind: StructureLineKind;
  amount: string;
  prorated: boolean;
}

let nextKey = 1;
const draft = (label: string, kind: StructureLineKind, amount = '', prorated = true, code = ''): LineDraft => ({
  key: nextKey++,
  label,
  code: code || codeFrom(label),
  codeTouched: false,
  kind,
  amount,
  prorated,
});

function codeFrom(label: string): string {
  return label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}

const STARTER_LINES = (): LineDraft[] => [
  draft('Basic', 'earning', '', true, 'BASIC'),
  draft('House rent allowance', 'earning', '', true, 'HRA'),
  draft('Special allowance', 'earning', '', true, 'SPECIAL'),
  draft('Provident fund (employee)', 'deduction', '', false, 'PF'),
  draft('Professional tax', 'deduction', '', false, 'PT'),
];

const KIND_LABELS: Record<StructureLineKind, string> = {
  earning: 'Earning',
  deduction: 'Deduction',
  'employer-contribution': 'Employer contribution',
};

function SalaryForm({
  employee,
  base,
  correcting,
  onClose,
  onSaved,
}: {
  employee: StructureSummary;
  base: SalaryStructure | null;
  correcting: SalaryStructure | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}): React.JSX.Element {
  const source = correcting ?? base;
  const [effectiveFrom, setEffectiveFrom] = useState(correcting?.effectiveFrom ?? (base ? firstOfNextMonth() : todayIso().slice(0, 8) + '01'));
  const [lines, setLines] = useState<LineDraft[]>(() =>
    source
      ? source.lines.map((line) => ({ ...draft(line.label, line.kind, String(Number(line.amount)), line.prorated, line.code), codeTouched: true }))
      : STARTER_LINES(),
  );
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (key: number, patch: Partial<LineDraft>) =>
    setLines((current) => current.map((line) => {
      if (line.key !== key) return line;
      const next = { ...line, ...patch };
      if (patch.label !== undefined && !line.codeTouched) next.code = codeFrom(patch.label);
      return next;
    }));

  const filled = lines.filter((line) => line.label.trim() && line.amount.trim() !== '' && Number(line.amount) > 0);
  const sum = (kind: StructureLineKind) => filled.filter((l) => l.kind === kind).reduce((total, l) => total + Number(l.amount), 0);
  const earnings = sum('earning');
  const deductions = sum('deduction');

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    const invalid = lines.find((line) => line.label.trim() && (line.amount.trim() === '' || Number.isNaN(Number(line.amount)) || Number(line.amount) < 0));
    if (invalid) {
      setError(`Enter a monthly amount for "${invalid.label}", or remove the line.`);
      return;
    }
    const payload: SaveStructureLine[] = filled.map((line) => ({
      code: line.code || codeFrom(line.label),
      label: line.label.trim(),
      kind: line.kind,
      amount: line.amount.trim(),
      prorated: line.prorated,
    }));
    setBusy(true);
    try {
      const result = await saveStructure(employee.userId, {
        currency: 'INR',
        effectiveFrom,
        lines: payload,
        ...(correcting ? { replacesStructureId: correcting.id, reason: reason.trim() } : {}),
      });
      onSaved(
        correcting
          ? `Salary for ${employee.fullName} corrected, effective ${formatDate(effectiveFrom)}.`
          : result.closedStructureId
            ? `New salary for ${employee.fullName} starts ${formatDate(effectiveFrom)}; the previous one ends the day before.`
            : `Salary for ${employee.fullName} saved, effective ${formatDate(effectiveFrom)}.`,
      );
    } catch (err) {
      setError(errorText(err, 'Unable to save the salary.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={correcting ? `Correct ${employee.fullName}'s salary` : `Salary for ${employee.fullName}`} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-app-muted">
            <span className="mb-2 block">Effective from</span>
            <input
              type="date"
              required
              value={effectiveFrom}
              disabled={correcting !== null}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              className="rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent disabled:opacity-60"
            />
          </label>
          <p className="mt-1 text-xs text-app-muted">
            {correcting
              ? 'A correction replaces the salary from the same date. It is allowed only while no published payslip has used it.'
              : base
                ? 'The current salary ends the day before this date. Earlier months keep their salary.'
                : 'Enter monthly amounts. Pro-rated lines are paid for the days worked; fixed lines are paid in full.'}
          </p>
        </div>

        <div className="space-y-2">
          <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto_auto] gap-2 text-xs font-semibold text-app-muted md:grid">
            <span>Component</span><span>Code</span><span>Type</span><span>Monthly ₹</span><span>Pro-rated</span><span />
          </div>
          {lines.map((line) => (
            <div key={line.key} className="grid grid-cols-2 gap-2 md:grid-cols-[minmax(0,1.6fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto_auto] md:items-center">
              <input
                aria-label="Component name"
                value={line.label}
                placeholder="e.g. Conveyance"
                onChange={(e) => update(line.key, { label: e.target.value })}
                className="col-span-2 w-full min-w-0 rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent md:col-span-1"
              />
              <input
                aria-label="Code"
                value={line.code}
                onChange={(e) => update(line.key, { code: e.target.value.toUpperCase(), codeTouched: true })}
                className="w-full min-w-0 rounded-lg border border-app-border bg-app-background px-3 py-2 font-mono text-xs outline-none focus:border-app-accent"
              />
              <select
                aria-label="Type"
                value={line.kind}
                onChange={(e) => update(line.key, { kind: e.target.value as StructureLineKind })}
                className="w-full min-w-0 rounded-lg border border-app-border bg-app-background px-2 py-2 text-sm outline-none focus:border-app-accent"
              >
                {Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <input
                aria-label="Monthly amount"
                inputMode="decimal"
                value={line.amount}
                placeholder="0"
                onChange={(e) => update(line.key, { amount: e.target.value.replace(/[^0-9.]/g, '') })}
                className="w-full min-w-0 rounded-lg border border-app-border bg-app-background px-3 py-2 text-right text-sm tabular-nums outline-none focus:border-app-accent"
              />
              <label className="flex items-center gap-1.5 text-xs text-app-muted">
                <input type="checkbox" checked={line.prorated} onChange={(e) => update(line.key, { prorated: e.target.checked })} />
                <span className="md:hidden">Pro-rated</span>
              </label>
              <button
                type="button"
                aria-label={`Remove ${line.label || 'line'}`}
                onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}
                className="text-lg text-app-muted hover:text-app-danger"
              >
                ×
              </button>
            </div>
          ))}
          <Button kind="secondary" onClick={() => setLines((current) => [...current, draft('', 'earning')])}>Add component</Button>
        </div>

        <div className="grid grid-cols-3 gap-2 rounded-xl border border-app-border p-3 text-center text-sm">
          <div><p className="text-xs text-app-muted">Gross</p><p className="font-semibold tabular-nums">{formatRupees(String(earnings))}</p></div>
          <div><p className="text-xs text-app-muted">Deductions</p><p className="font-semibold tabular-nums">{formatRupees(String(deductions))}</p></div>
          <div><p className="text-xs text-app-muted">Net (full month)</p><p className="font-semibold tabular-nums">{formatRupees(String(earnings - deductions))}</p></div>
        </div>

        {correcting && (
          <label className="block text-xs font-semibold text-app-muted">
            <span className="mb-2 block">Why is it being corrected?</span>
            <input
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
            />
          </label>
        )}
        {error && <Notice error>{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button kind="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy || filled.length === 0 || (correcting !== null && reason.trim() === '')}>
            {busy ? 'Saving…' : correcting ? 'Save correction' : 'Save salary'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function SalaryHistory({
  employee,
  onClose,
  onSaved,
}: {
  employee: StructureSummary;
  onClose: () => void;
  onSaved: (message: string) => void;
}): React.JSX.Element {
  const [history, setHistory] = useState<SalaryStructure[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ correcting: SalaryStructure | null } | null>(null);

  useEffect(() => {
    listStructureHistory(employee.userId)
      .then((data) => setHistory(data.structures))
      .catch((err: unknown) => setError(errorText(err, 'Unable to load the salary history.')));
  }, [employee.userId]);

  const current = history?.find((s) => s.voidedAt === null) ?? null;

  if (form) {
    return (
      <SalaryForm
        employee={employee}
        base={current}
        correcting={form.correcting}
        onClose={() => setForm(null)}
        onSaved={onSaved}
      />
    );
  }

  return (
    <Modal title={`${employee.fullName} — salary`} onClose={onClose}>
      {error && <Notice error>{error}</Notice>}
      {!history && !error && <p className="text-sm text-app-muted">Loading…</p>}
      {history && (
        <div className="space-y-3">
          <Button onClick={() => setForm({ correcting: null })}>{current ? 'New salary from a date' : 'Add salary'}</Button>
          {history.length === 0 && <p className="text-sm text-app-muted">No salary recorded yet.</p>}
          {history.map((structure) => {
            const earnings = structure.lines.filter((l) => l.kind === 'earning').reduce((t, l) => t + Number(l.amount), 0);
            const deductions = structure.lines.filter((l) => l.kind === 'deduction').reduce((t, l) => t + Number(l.amount), 0);
            return (
              <div key={structure.id} className={`rounded-xl border border-app-border p-3 ${structure.voidedAt ? 'opacity-60' : ''}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">
                    {formatDate(structure.effectiveFrom)} – {structure.effectiveTo ? formatDate(dayBefore(structure.effectiveTo)) : 'onwards'}
                    {structure.voidedAt && <span className="ml-2 text-xs font-normal text-app-danger">Corrected: {structure.voidReason}</span>}
                  </p>
                  {!structure.voidedAt && !structure.usedByPublishedPayslip && (
                    <Button kind="secondary" onClick={() => setForm({ correcting: structure })}>Correct</Button>
                  )}
                  {structure.usedByPublishedPayslip && <span className="text-xs text-app-muted">Used in published payslips</span>}
                </div>
                <div className="mt-2 grid gap-x-6 gap-y-0.5 text-xs md:grid-cols-2">
                  {structure.lines.map((line) => (
                    <div key={line.id} className="flex justify-between">
                      <span>{line.label} <span className="text-app-muted">({line.kind === 'earning' ? 'earning' : line.kind === 'deduction' ? 'deduction' : 'employer'}{line.prorated ? '' : ', fixed'})</span></span>
                      <span className="tabular-nums">{formatRupees(line.amount)}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-app-muted">Gross {formatRupees(String(earnings))} · Deductions {formatRupees(String(deductions))} · Net {formatRupees(String(earnings - deductions))}</p>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

function dayBefore(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function SalariesPage(): React.JSX.Element {
  const [onDate, setOnDate] = useState(todayIso());
  const [rows, setRows] = useState<StructureSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<StructureSummary | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setRows((await listStructureSummaries(onDate)).employees);
      setError(null);
    } catch (err) {
      setError(errorText(err, 'Unable to load salaries.'));
    } finally {
      setLoading(false);
    }
  }, [onDate]);

  useEffect(() => { void load(); }, [load]);

  const visible = rows.filter((row) =>
    `${row.fullName} ${row.employeeCode ?? ''} ${row.departmentName ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const missing = rows.filter((row) => row.structureId === null).length;

  return (
    <Page
      eyebrow="Payroll"
      title="Salary structures"
      description="Each employee's monthly salary components. A new salary starts from a date and the earlier one is kept as history."
    >
      <div className="mt-6 flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold text-app-muted">
          <span className="mb-2 block">Salary in effect on</span>
          <input
            type="date"
            value={onDate}
            onChange={(e) => setOnDate(e.target.value)}
            className="rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
          />
        </label>
        <label className="min-w-64 flex-1 text-xs font-semibold text-app-muted">
          <span className="mb-2 block">Search</span>
          <input
            value={search}
            placeholder="Name, code or department"
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
          />
        </label>
      </div>
      {missing > 0 && (
        <div className="mt-4">
          <Notice error>{missing} employee{missing === 1 ? ' has' : 's have'} no salary on this date and would be paid nothing.</Notice>
        </div>
      )}
      {notice && <div className="mt-4"><Notice>{notice}</Notice></div>}
      {error && <div className="mt-4"><Notice error>{error}</Notice></div>}
      {loading ? (
        <div className="mt-6"><SkeletonTable columns={5} rows={5} /></div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-app-border bg-app-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-app-border text-left text-xs uppercase tracking-wider text-app-muted">
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3 text-right">Gross / month</th>
                <th className="px-4 py-3 text-right">Deductions</th>
                <th className="px-4 py-3 text-right">Net</th>
                <th className="px-4 py-3">Since</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.userId} className="border-b border-app-border last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium">{row.fullName}</p>
                    <p className="text-xs text-app-muted">{[row.employeeCode, row.departmentName].filter(Boolean).join(' · ')}</p>
                  </td>
                  {row.structureId ? (
                    <>
                      <td className="px-4 py-3 text-right tabular-nums">{formatRupees(row.earnings ?? '0')}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatRupees(row.deductions ?? '0')}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">
                        {formatRupees(String(Number(row.earnings ?? 0) - Number(row.deductions ?? 0)))}
                      </td>
                      <td className="px-4 py-3 text-xs text-app-muted">
                        {formatDate(row.effectiveFrom)}
                        {row.nextEffectiveFrom && <span className="block">changes {formatDate(row.nextEffectiveFrom)}</span>}
                      </td>
                    </>
                  ) : (
                    <td colSpan={4} className="px-4 py-3 text-xs text-app-danger">
                      No salary recorded{row.nextEffectiveFrom ? ` (starts ${formatDate(row.nextEffectiveFrom)})` : ''}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right">
                    <Button kind="secondary" onClick={() => { setNotice(null); setSelected(row); }}>
                      {row.structureId ? 'View / change' : 'Add salary'}
                    </Button>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-app-muted">No employees match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {selected && (
        <SalaryHistory
          employee={selected}
          onClose={() => setSelected(null)}
          onSaved={(message) => { setSelected(null); setNotice(message); void load(); }}
        />
      )}
    </Page>
  );
}
