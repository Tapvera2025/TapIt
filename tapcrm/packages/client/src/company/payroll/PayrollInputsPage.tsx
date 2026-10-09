import { useCallback, useEffect, useState } from 'react';
import {
  INPUT_KIND_LABELS,
  addInput,
  formatDate,
  formatMonth,
  formatRupees,
  listInputs,
  listStructureSummaries,
  previousMonthStart,
  revokeInput,
  type PayrollInput,
  type PayrollInputKind,
  type PayrollInputState,
  type StructureSummary,
} from '../api/payrollApi.js';
import { Button, Card, Modal, Notice, Page, SearchableSelect, SkeletonTable } from '../../ui/components.js';

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

type ManualKind = Exclude<PayrollInputKind, 'break-deduction'>;
const MANUAL_KINDS: ManualKind[] = ['bonus', 'arrear', 'adjustment', 'advance-recovery', 'tds'];
const DEDUCTION_KINDS = new Set<PayrollInputKind>(['advance-recovery', 'tds', 'break-deduction']);

const STATE_LABELS: Record<PayrollInputState, { label: string; className: string }> = {
  pending: { label: 'Waiting for the run', className: 'bg-app-background text-app-muted' },
  'in-run': { label: 'In the current run', className: 'bg-sky-500/12 text-sky-800 dark:text-sky-200' },
  published: { label: 'Paid', className: 'bg-emerald-500/12 text-emerald-800 dark:text-emerald-200' },
  unpaid: { label: 'Not paid — revise the payslip', className: 'bg-amber-500/14 text-amber-800 dark:text-amber-200' },
  revoked: { label: 'Withdrawn', className: 'bg-app-background text-app-muted line-through' },
};

function AddEntry({
  periodStart,
  employees,
  onClose,
  onAdded,
}: {
  periodStart: string;
  employees: StructureSummary[];
  onClose: () => void;
  onAdded: (message: string) => void;
}): React.JSX.Element {
  const [userId, setUserId] = useState('');
  const [kind, setKind] = useState<ManualKind>('bonus');
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await addInput({
        userId,
        periodStart,
        kind,
        amount: amount.trim(),
        label: label.trim() || INPUT_KIND_LABELS[kind],
        reason: reason.trim(),
      });
      const name = employees.find((e) => e.userId === userId)?.fullName ?? 'the employee';
      onAdded(`${INPUT_KIND_LABELS[kind]} of ${formatRupees(amount)} added for ${name} in ${formatMonth(periodStart)}.`);
    } catch (err) {
      setError(errorText(err, 'Unable to add the entry.'));
    } finally {
      setBusy(false);
    }
  }

  const valid = userId !== '' && Number(amount) > 0 && reason.trim() !== '';
  return (
    <Modal title={`Add a payroll entry for ${formatMonth(periodStart)}`} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <SearchableSelect
          label="Employee"
          value={userId}
          onChange={setUserId}
          options={employees.map((e) => ({ value: e.userId, label: `${e.fullName}${e.employeeCode ? ` (${e.employeeCode})` : ''}` }))}
          placeholder="Search employees"
        />
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-xs font-semibold text-app-muted">
            <span className="mb-2 block">Type</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as ManualKind)}
              className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
            >
              {MANUAL_KINDS.map((k) => (
                <option key={k} value={k}>{INPUT_KIND_LABELS[k]}{DEDUCTION_KINDS.has(k) ? ' — deducted' : ' — paid'}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-app-muted">
            <span className="mb-2 block">Amount (₹)</span>
            <input
              required
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-right text-sm text-app-foreground outline-none focus:border-app-accent"
            />
          </label>
        </div>
        <label className="block text-xs font-semibold text-app-muted">
          <span className="mb-2 block">Payslip label</span>
          <input
            value={label}
            placeholder={INPUT_KIND_LABELS[kind]}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
          />
        </label>
        <label className="block text-xs font-semibold text-app-muted">
          <span className="mb-2 block">Reason (kept on record)</span>
          <input
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
          />
        </label>
        {error && <Notice error>{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button kind="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy || !valid}>{busy ? 'Adding…' : 'Add entry'}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function PayrollInputsPage(): React.JSX.Element {
  const [month, setMonth] = useState(previousMonthStart().slice(0, 7));
  const [inputs, setInputs] = useState<PayrollInput[]>([]);
  const [employees, setEmployees] = useState<StructureSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [revoking, setRevoking] = useState<PayrollInput | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const periodStart = `${month}-01`;

  const load = useCallback(async (): Promise<void> => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    setLoading(true);
    try {
      const [inputData, employeeData] = await Promise.all([listInputs(`${month}-01`), listStructureSummaries(`${month}-01`)]);
      setInputs(inputData.inputs);
      setEmployees(employeeData.employees);
      setError(null);
    } catch (err) {
      setError(errorText(err, 'Unable to load payroll entries.'));
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { void load(); }, [load]);

  async function revoke(): Promise<void> {
    if (!revoking) return;
    try {
      await revokeInput(revoking.id, revokeReason.trim());
      setNotice(`${INPUT_KIND_LABELS[revoking.kind]} for ${revoking.fullName} withdrawn.`);
      setRevoking(null);
      setRevokeReason('');
      await load();
    } catch (err) {
      setError(errorText(err, 'Unable to withdraw the entry.'));
      setRevoking(null);
    }
  }

  const active = inputs.filter((i) => i.state !== 'revoked');
  const additions = active.filter((i) => !DEDUCTION_KINDS.has(i.kind)).reduce((t, i) => t + Number(i.amount), 0);
  const deductions = active.filter((i) => DEDUCTION_KINDS.has(i.kind)).reduce((t, i) => t + Number(i.amount), 0);

  return (
    <Page
      eyebrow="Payroll"
      title="Bonuses & deductions"
      description="One-off amounts for a month: bonuses, arrears and additions are paid; advance recoveries and TDS are deducted. Break deductions arrive here from the break queue."
      action={<Button onClick={() => { setNotice(null); setAdding(true); }}>Add entry</Button>}
    >
      <div className="mt-6 flex flex-wrap items-end gap-4">
        <label className="text-xs font-semibold text-app-muted">
          <span className="mb-2 block">Payroll month</span>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
          />
        </label>
        <p className="text-sm text-app-muted">
          Paid {formatRupees(String(additions))} · Deducted {formatRupees(String(deductions))}
        </p>
      </div>
      {notice && <div className="mt-4"><Notice>{notice}</Notice></div>}
      {error && <div className="mt-4"><Notice error>{error}</Notice></div>}
      {active.some((i) => i.state === 'unpaid') && (
        <div className="mt-4">
          <Notice error>
            Some entries were added after {formatMonth(periodStart)} was published. Revise those employees&apos; payslips from the payroll run to pay them.
          </Notice>
        </div>
      )}
      {loading ? (
        <div className="mt-6"><SkeletonTable columns={6} rows={5} /></div>
      ) : inputs.length === 0 ? (
        <Card className="mt-6 text-center"><p className="text-sm text-app-muted">No entries for {formatMonth(periodStart)}.</p></Card>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-app-border bg-app-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-app-border text-left text-xs uppercase tracking-wider text-app-muted">
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Entry</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {inputs.map((input) => {
                const state = STATE_LABELS[input.state];
                const deduction = DEDUCTION_KINDS.has(input.kind);
                return (
                  <tr key={input.id} className="border-b border-app-border last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium">{input.fullName}</p>
                      <p className="text-xs text-app-muted">{input.employeeCode ?? ''}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p>{input.label}</p>
                      <p className="text-xs text-app-muted">{INPUT_KIND_LABELS[input.kind]} · added {formatDate(input.createdAt)}{input.createdByName ? ` by ${input.createdByName}` : ''}</p>
                    </td>
                    <td className={`px-4 py-3 text-right tabular-nums ${deduction ? 'text-app-danger' : ''}`}>
                      {deduction ? '−' : '+'}{formatRupees(input.amount)}
                    </td>
                    <td className="px-4 py-3 text-xs text-app-muted">{input.revocationReason ? `Withdrawn: ${input.revocationReason}` : input.reason ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${state.className}`}>{state.label}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {input.kind !== 'break-deduction' && input.state !== 'revoked' && input.state !== 'published' && (
                        <Button kind="secondary" onClick={() => { setRevokeReason(''); setRevoking(input); }}>Withdraw</Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {adding && (
        <AddEntry
          periodStart={periodStart}
          employees={employees}
          onClose={() => setAdding(false)}
          onAdded={(message) => { setAdding(false); setNotice(message); void load(); }}
        />
      )}
      {revoking && (
        <Modal title={`Withdraw ${revoking.label}?`} onClose={() => setRevoking(null)}>
          <p className="text-sm text-app-muted">
            The entry stays on record as withdrawn. If it is already in a calculated run, recalculate the run before publishing.
          </p>
          <label className="mt-4 block text-xs font-semibold text-app-muted">
            <span className="mb-2 block">Reason</span>
            <input
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
            />
          </label>
          <div className="mt-5 flex justify-end gap-2">
            <Button kind="secondary" onClick={() => setRevoking(null)}>Go back</Button>
            <Button kind="danger" disabled={revokeReason.trim() === ''} onClick={() => void revoke()}>Withdraw</Button>
          </div>
        </Modal>
      )}
    </Page>
  );
}
