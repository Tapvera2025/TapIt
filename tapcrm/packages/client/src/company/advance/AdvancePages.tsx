import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Empty,
  Loading,
  Notice,
  Page,
  Select,
} from '../../ui/components.js';
import {
  approveAdvance,
  createManualAdvance,
  downloadApprovedAdvances,
  listAdvances,
  listMyAdvances,
  rejectAdvance,
  requestAdvance,
  type Advance,
} from './api/advanceApi.js';
import { getCompanyEmployees, type CompanyEmployee } from '../api/companyApi.js';

const money = (paise: string | null): string =>
  paise === null
    ? '—'
    : `₹${(Number(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const periodLabel = (period: string): string =>
  new Date(`${period.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
const month = (): string => `${new Date().toISOString().slice(0, 7)}-01`;
function amountInPaise(value: string, label = 'Amount'): number {
  const rupees = Number(value);
  if (!Number.isFinite(rupees) || rupees <= 0)
    throw new Error(`${label} must be greater than ₹0.`);
  const paise = Math.round(rupees * 100);
  if (!Number.isSafeInteger(paise) || paise <= 0)
    throw new Error(`${label} is too large or invalid.`);
  return paise;
}
function requirePeriod(value: string, label: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(value)) throw new Error(`${label} is required.`);
  return value;
}
function requireText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  return trimmed;
}
function StatusBadge({ status }: { status: string }): React.JSX.Element {
  const classes: Record<string, string> = {
    pending: 'bg-amber-500/15 text-amber-800 dark:text-amber-200',
    approved: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200',
    rejected: 'bg-rose-500/15 text-rose-800 dark:text-rose-200',
    partial: 'bg-sky-500/15 text-sky-800 dark:text-sky-200',
    completed: 'bg-teal-500/15 text-teal-800 dark:text-teal-200',
    cancelled: 'bg-app-surface-raised text-app-muted',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${classes[status] ?? 'bg-app-surface-raised text-app-muted'}`}
    >
      {status}
    </span>
  );
}
function Form({
  title,
  onSubmit,
  submitLabel,
  children,
}: {
  title: string;
  onSubmit: () => void;
  submitLabel: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Card>
      <h2 className="text-lg font-bold">{title}</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
      <div className="mt-5">
        <Button onClick={onSubmit}>{submitLabel}</Button>
      </div>
    </Card>
  );
}

export function MyAdvancesPage(): React.JSX.Element {
  const [rows, setRows] = useState<Advance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState(month());
  const [reason, setReason] = useState('');
  const load = () => {
    setLoading(true);
    void listMyAdvances()
      .then((r) => setRows(r.rows))
      .catch((e) => setError(e instanceof Error ? e.message : 'Unable to load advances.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);
  async function submit(): Promise<void> {
    setError('');
    try {
      await requestAdvance({
        amountPaise: amountInPaise(amount),
        requestedForPeriod: requirePeriod(period, 'Advance month'),
        reason: requireText(reason, 'Reason'),
      });
      setAmount('');
      setReason('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to request advance.');
    }
  }
  const totals = useMemo(
    () => ({
      pending: rows.filter((r) => r.status === 'pending').length,
      approved: rows.filter((r) => r.status === 'approved').length,
      rejected: rows.filter((r) => r.status === 'rejected').length,
      outstanding: rows
        .filter((r) => r.status === 'approved')
        .reduce((sum, r) => sum + Number(r.outstandingAmountPaise), 0),
    }),
    [rows],
  );
  return (
    <Page
      eyebrow="HR · Advances"
      title="My Advances"
      description="Request and track employee advances."
    >
      {error && <Notice error>{error}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <p className="text-sm text-app-muted">Pending</p>
          <p className="mt-1 text-2xl font-bold">{totals.pending}</p>
        </Card>
        <Card>
          <p className="text-sm text-app-muted">Approved</p>
          <p className="mt-1 text-2xl font-bold">{totals.approved}</p>
        </Card>
        <Card>
          <p className="text-sm text-app-muted">Rejected</p>
          <p className="mt-1 text-2xl font-bold">{totals.rejected}</p>
        </Card>
        <Card>
          <p className="text-sm text-app-muted">Outstanding</p>
          <p className="mt-1 text-2xl font-bold">{money(String(totals.outstanding))}</p>
        </Card>
      </div>
      <Form
        title="Request an advance"
        onSubmit={() => void submit()}
        submitLabel="Request advance"
      >
        <label className="text-sm font-semibold">
          Amount (₹)
          <input
            className="mt-2 w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5"
            type="number"
            min="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="text-sm font-semibold">
          Advance month
          <input
            className="mt-2 w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5"
            type="month"
            value={period.slice(0, 7)}
            onChange={(e) => setPeriod(`${e.target.value}-01`)}
          />
        </label>
        <label className="text-sm font-semibold sm:col-span-2">
          Reason
          <textarea
            className="mt-2 w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      </Form>
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-app-border bg-app-surface-raised text-left text-xs text-app-muted">
              {[
                'Requested for',
                'Requested',
                'Approved',
                'Date',
                'Status',
                'Outstanding',
                'Reason',
              ].map((x) => (
                <th className="px-4 py-3" key={x}>
                  {x}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="px-4 py-6" colSpan={7}>
                  <Loading />
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr className="border-b border-app-border last:border-0" key={r.id}>
                  <td className="px-4 py-3">{periodLabel(r.requestedForPeriod)}</td>
                  <td className="px-4 py-3">{money(r.requestedAmountPaise)}</td>
                  <td className="px-4 py-3">{money(r.approvedAmountPaise)}</td>
                  <td className="px-4 py-3">
                    {new Date(r.requestedAt).toLocaleDateString('en-IN')}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3">
                    {r.status === 'approved' ? money(r.outstandingAmountPaise) : '—'}
                  </td>
                  <td className="px-4 py-3">{r.rejectionReason ?? r.reason}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {!loading && rows.length === 0 && <Empty>No advance requests yet.</Empty>}
      </Card>
    </Page>
  );
}

export function AdvanceRequestsPage(): React.JSX.Element {
  return <AdminAdvances />;
}
function AdminAdvances(): React.JSX.Element {
  const [rows, setRows] = useState<Advance[]>([]);
  const [approvedRows, setApprovedRows] = useState<Advance[]>([]);
  const [status, setStatus] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [approvedLoading, setApprovedLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Advance | null>(null);
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [employees, setEmployees] = useState<
    Array<CompanyEmployee & { employeeId?: string }>
  >([]);
  const [manualEmployee, setManualEmployee] = useState('');
  const [manualAmount, setManualAmount] = useState('');
  const [manualPeriod, setManualPeriod] = useState(month());
  const [manualReason, setManualReason] = useState('');
  const loadApproved = () => {
    setApprovedLoading(true);
    void listAdvances({ status: 'approved', pageSize: 100 })
      .then((r) => setApprovedRows(r.rows))
      .catch((e) =>
        setError(e instanceof Error ? e.message : 'Unable to load approved advances.'),
      )
      .finally(() => setApprovedLoading(false));
  };
  const load = () => {
    setLoading(true);
    void listAdvances({ status })
      .then((r) => setRows(r.rows))
      .catch((e) => setError(e instanceof Error ? e.message : 'Unable to load requests.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [status]);
  useEffect(loadApproved, []);
  useEffect(() => {
    void getCompanyEmployees()
      .then(setEmployees)
      .catch(() => undefined);
  }, []);
  async function approve(): Promise<void> {
    if (!selected) return;
    setError('');
    try {
      const approvedAmountPaise = amountInPaise(value, 'Approved amount');
      if (approvedAmountPaise > Number(selected.requestedAmountPaise)) {
        throw new Error(
          `Approved amount cannot exceed the requested amount of ${money(selected.requestedAmountPaise)}.`,
        );
      }
      await approveAdvance(selected.id, {
        approvedAmountPaise,
        approvalNote: note.trim(),
      });
      setSelected(null);
      load();
      loadApproved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to approve.');
    }
  }
  async function reject(): Promise<void> {
    if (!selected) return;
    setError('');
    try {
      await rejectAdvance(selected.id, requireText(rejectReason, 'Rejection reason'));
      setSelected(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to reject.');
    }
  }
  async function manual(): Promise<void> {
    setError('');
    try {
      await createManualAdvance({
        employeeId: requireText(manualEmployee, 'Employee'),
        amountPaise: amountInPaise(manualAmount),
        requestedForPeriod: requirePeriod(manualPeriod, 'Advance month'),
        reason: requireText(manualReason, 'Reason'),
      });
      setManualAmount('');
      setManualReason('');
      load();
      loadApproved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to create manual advance.');
    }
  }
  async function exportApproved(format: 'csv' | 'xlsx'): Promise<void> {
    setError('');
    try {
      const blob = await downloadApprovedAdvances({}, format);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `approved-advances.${format}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to export approved advances.');
    }
  }
  return (
    <Page
      eyebrow="HR · Advances"
      title="Advance Requests"
      description="Review employee requests and manage approvals."
    >
      {error && <Notice error>{error}</Notice>}
      <Form
        title="Create a manual advance"
        onSubmit={() => void manual()}
        submitLabel="Create approved advance"
      >
        <label className="text-sm font-semibold">
          Employee
          <select
            className="mt-2 w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5"
            value={manualEmployee}
            onChange={(e) => setManualEmployee(e.target.value)}
          >
            <option value="">Select employee</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.fullName} · {employee.employeeId ?? employee.id}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          Amount (₹)
          <input
            className="mt-2 w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5"
            type="number"
            min="0.01"
            value={manualAmount}
            onChange={(e) => setManualAmount(e.target.value)}
          />
        </label>
        <label className="text-sm font-semibold">
          Advance month
          <input
            className="mt-2 w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5"
            type="month"
            value={manualPeriod.slice(0, 7)}
            onChange={(e) => setManualPeriod(`${e.target.value}-01`)}
          />
        </label>
        <label className="text-sm font-semibold sm:col-span-2">
          Reason
          <textarea
            className="mt-2 w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5"
            rows={2}
            value={manualReason}
            onChange={(e) => setManualReason(e.target.value)}
          />
        </label>
      </Form>
      <Card>
        <div className="flex flex-wrap gap-2">
          <Select
            label="Status"
            value={status}
            onChange={setStatus}
            options={['pending', 'approved', 'rejected', 'all'].map((x) => ({
              value: x,
              label: x[0]!.toUpperCase() + x.slice(1),
            }))}
          />
        </div>
      </Card>
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b border-app-border bg-app-surface-raised text-left text-xs text-app-muted">
              {[
                'Employee',
                'Department',
                'Requested',
                'Approved',
                'Month',
                'Date',
                'Status',
                'Actions',
              ].map((x) => (
                <th className="px-4 py-3" key={x}>
                  {x}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="px-4 py-6" colSpan={8}>
                  <Loading />
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr className="border-b border-app-border last:border-0" key={r.id}>
                  <td className="px-4 py-3">
                    <p className="font-semibold">{r.employeeName}</p>
                    <p className="text-xs text-app-muted">{r.employeeCode ?? '—'}</p>
                  </td>
                  <td className="px-4 py-3">{r.departmentName ?? '—'}</td>
                  <td className="px-4 py-3">{money(r.requestedAmountPaise)}</td>
                  <td className="px-4 py-3">{money(r.approvedAmountPaise)}</td>
                  <td className="px-4 py-3">{periodLabel(r.requestedForPeriod)}</td>
                  <td className="px-4 py-3">
                    {new Date(r.requestedAt).toLocaleDateString('en-IN')}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3">
                    {r.status === 'pending' && (
                      <Button
                        onClick={() => {
                          setSelected(r);
                          setValue(String(Number(r.requestedAmountPaise) / 100));
                          setNote('');
                          setRejectReason('');
                        }}
                      >
                        Review
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {!loading && rows.length === 0 && <Empty>No requests match this status.</Empty>}
      </Card>
      {selected && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Review {selected.employeeName}</h2>
              <p className="text-sm text-app-muted">
                Requested {money(selected.requestedAmountPaise)} ·{' '}
                {periodLabel(selected.requestedForPeriod)}
              </p>
            </div>
            <Button kind="secondary" onClick={() => setSelected(null)}>
              Close
            </Button>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold">
              Approved amount (₹)
              <input
                className="mt-2 w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5"
                type="number"
                min="0.01"
                max={Number(selected.requestedAmountPaise) / 100}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
            <label className="text-sm font-semibold">
              Approval note
              <textarea
                className="mt-2 w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5"
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button onClick={() => void approve()}>Approve ₹{value || '0'}</Button>
            <input
              className="min-w-56 flex-1 rounded-lg border border-app-border bg-app-background px-3 py-2.5"
              placeholder="Required rejection reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
            <Button kind="secondary" onClick={() => void reject()}>
              Reject
            </Button>
          </div>
        </Card>
      )}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Approved advances · Payroll handoff</h2>
            <p className="mt-1 text-sm text-app-muted">
              Approved advances are available here for payroll processing. No separate
              deduction schedule is required.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void exportApproved('csv')}>Export CSV</Button>
            <Button kind="secondary" onClick={() => void exportApproved('xlsx')}>
              Export XLSX
            </Button>
          </div>
        </div>
      </Card>
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b border-app-border bg-app-surface-raised text-left text-xs text-app-muted">
              {[
                'Employee',
                'Advance',
                'Approved',
                'Recovered',
                'Outstanding',
                'Advance Month',
                'Approved Date',
              ].map((x) => (
                <th className="px-4 py-3" key={x}>
                  {x}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {approvedLoading ? (
              <tr>
                <td className="px-4 py-6" colSpan={7}>
                  <Loading />
                </td>
              </tr>
            ) : (
              approvedRows.map((r) => (
                <tr className="border-b border-app-border last:border-0" key={r.id}>
                  <td className="px-4 py-3">
                    <p className="font-semibold">{r.employeeName}</p>
                    <p className="text-xs text-app-muted">{r.employeeCode ?? '—'}</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{r.id}</td>
                  <td className="px-4 py-3">{money(r.approvedAmountPaise)}</td>
                  <td className="px-4 py-3">{money(r.recoveredAmountPaise)}</td>
                  <td className="px-4 py-3">{money(r.outstandingAmountPaise)}</td>
                  <td className="px-4 py-3">{periodLabel(r.requestedForPeriod)}</td>
                  <td className="px-4 py-3">
                    {r.approvedAt
                      ? new Date(r.approvedAt).toLocaleDateString('en-IN')
                      : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {!approvedLoading && approvedRows.length === 0 && (
          <Empty>No approved advances are ready for payroll.</Empty>
        )}
      </Card>
    </Page>
  );
}
