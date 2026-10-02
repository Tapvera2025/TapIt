import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import {
  BLOCKER_LABELS,
  createRun,
  formatDate,
  formatMonth,
  formatPaise,
  getRunDetail,
  getRunEmployees,
  listRunDrifts,
  listRuns,
  patchRun,
  previousMonthStart,
  publishRun,
  remediateDrift,
  reviseSlip,
  type CreateRunResult,
  type ReviewEmployee,
  type RunBlocker,
  type RunDetail,
  type RunDrift,
  type RunStatus,
  type RunSummary,
} from '../api/payrollApi.js';
import { Button, Card, Modal, Notice, Page } from '../../ui/components.js';

const STATUS_CLASSES: Record<RunStatus, string> = {
  draft: 'bg-app-background text-app-muted',
  computing: 'bg-amber-500/14 text-amber-800 dark:text-amber-200',
  review: 'bg-sky-500/12 text-sky-800 dark:text-sky-200',
  publishing: 'bg-amber-500/14 text-amber-800 dark:text-amber-200',
  published: 'bg-emerald-500/12 text-emerald-800 dark:text-emerald-200',
  failed: 'bg-rose-500/12 text-rose-800 dark:text-rose-200',
  cancelled: 'bg-app-background text-app-muted',
};

const STATUS_LABELS: Record<RunStatus, string> = {
  draft: 'Draft',
  computing: 'Calculating',
  review: 'Ready for review',
  publishing: 'Publishing',
  published: 'Published',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

function StatusBadge({ status }: { status: RunStatus }): React.JSX.Element {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASSES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** Blockers grouped by person, each with a readable label and its dates. */
function BlockerList({ blockers, title }: { blockers: RunBlocker[]; title: string }): React.JSX.Element {
  const groups = new Map<string, { name: string; items: RunBlocker[] }>();
  for (const blocker of blockers) {
    const key = blocker.userId ?? 'run';
    const group = groups.get(key) ?? { name: blocker.fullName ?? (blocker.userId === null ? 'Whole run' : 'Employee'), items: [] };
    group.items.push(blocker);
    groups.set(key, group);
  }
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/8 p-4">
      <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">{title}</p>
      <ul className="mt-2 max-h-60 space-y-2 overflow-y-auto text-xs text-amber-900 dark:text-amber-200">
        {[...groups.entries()].map(([key, group]) => {
          const kinds = new Map<string, string[]>();
          for (const item of group.items) {
            const list = kinds.get(item.kind) ?? [];
            if (item.workDate) list.push(formatDate(item.workDate));
            kinds.set(item.kind, list);
          }
          return (
            <li key={key}>
              <span className="font-semibold">{group.name}</span>
              {': '}
              {[...kinds.entries()]
                .map(([kind, dates]) => `${BLOCKER_LABELS[kind] ?? kind}${dates.length ? ` (${dates.slice(0, 5).join(', ')}${dates.length > 5 ? ` +${dates.length - 5} more` : ''})` : ''}`)
                .join('; ')}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CreatedSummary({ result, onDismiss }: { result: CreateRunResult; onDismiss: () => void }): React.JSX.Element {
  const noSalary = result.warnings.filter((w) => w.kind === 'no-salary-structure');
  const noLeaving = result.warnings.filter((w) => w.kind === 'no-leaving-date');
  return (
    <Card className="mt-6 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold">
          Run created with {result.employeeCount} employee{result.employeeCount === 1 ? '' : 's'}. Review the notes below, then start the calculation.
        </p>
        <button type="button" className="text-xs text-app-muted hover:text-app-foreground" onClick={onDismiss}>Dismiss</button>
      </div>
      {noSalary.length > 0 && (
        <Notice error>
          No salary structure for {noSalary.map((w) => w.fullName).join(', ')} — they will be paid nothing this month.
          Add their salary under Payroll → Salary structures, cancel this run and create it again.
        </Notice>
      )}
      {noLeaving.length > 0 && (
        <Notice error>
          {noLeaving.map((w) => w.fullName).join(', ')} {noLeaving.length === 1 ? 'is' : 'are'} deactivated but {noLeaving.length === 1 ? 'has' : 'have'} no leaving date,
          so they are paid for the whole month. Set a leaving date on the employee to stop pay on the right day.
        </Notice>
      )}
      {result.blockers.length > 0 && (
        <BlockerList
          blockers={result.blockers}
          title={`${result.blockers.length} open attendance item(s). The run can be calculated now, but it can only be published once these are resolved.`}
        />
      )}
    </Card>
  );
}

function RevisePayslip({
  employee,
  onClose,
  onRevised,
}: {
  employee: ReviewEmployee;
  onClose: () => void;
  onRevised: (message: string) => void;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!employee.payslipId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await reviseSlip(employee.payslipId, reason.trim());
      onRevised(`Revision ${result.revisionNumber} published for ${employee.fullName}: net pay ${formatPaise(result.previousNetPaise)} → ${formatPaise(result.netPaise)}.`);
    } catch (err) {
      setError(errorText(err, 'Unable to revise the payslip.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Revise ${employee.fullName}'s payslip`} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <p className="text-sm text-app-muted">
          A revision recalculates the month from today&apos;s attendance, leave, salary and payroll entries, and publishes it as a new version.
          The published payslip is kept. Record the correction first (for example an arrear under Bonuses &amp; deductions).
        </p>
        <label className="block text-xs font-semibold text-app-muted">
          <span className="mb-2 block">Reason</span>
          <textarea
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
          />
        </label>
        {error && <Notice error>{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button kind="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy || reason.trim().length === 0}>{busy ? 'Revising…' : 'Publish revision'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmModal({
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-sm text-app-muted">{body}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button kind="secondary" onClick={onClose}>Go back</Button>
        <Button kind={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}

function RunDetailPanel({
  runId,
  onChanged,
  onStarted,
}: {
  runId: string;
  onChanged: () => void;
  onStarted: () => void;
}): React.JSX.Element {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [employees, setEmployees] = useState<ReviewEmployee[]>([]);
  const [drifts, setDrifts] = useState<RunDrift[]>([]);
  const [blockers, setBlockers] = useState<RunBlocker[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'publish' | 'cancel' | null>(null);
  const [revising, setRevising] = useState<ReviewEmployee | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [runData, empData, driftData] = await Promise.all([
        getRunDetail(runId),
        getRunEmployees(runId),
        listRunDrifts(runId),
      ]);
      setRun(runData);
      setEmployees(empData.employees);
      setDrifts(driftData.drifts);
      setError(null);
    } catch (err) {
      setError(errorText(err, 'Unable to load the run.'));
    }
  }, [runId]);

  useEffect(() => {
    setRun(null);
    setBlockers(null);
    setNotice(null);
    void load();
  }, [load]);

  // While the calculation runs, refresh until it settles.
  const active = run?.status === 'computing' || run?.status === 'publishing';
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => { void load(); }, 2000);
    return () => window.clearInterval(timer);
  }, [active, load]);
  // Tell the list when the status moves (a calculation settling, a publish).
  const lastStatus = useRef<RunStatus | null>(null);
  useEffect(() => {
    if (!run) return;
    if (lastStatus.current !== null && lastStatus.current !== run.status) onChanged();
    lastStatus.current = run.status;
  }, [run, onChanged]);

  async function act(action: 'start' | 'cancel' | 'recalculate'): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    setBlockers(null);
    try {
      const result = await patchRun(runId, action);
      if (action === 'start') onStarted();
      if (action === 'recalculate' && result.recalculated === 0) setNotice('Nothing has changed since the calculation.');
      onChanged();
      await load();
    } catch (err) {
      setError(errorText(err, 'The action could not be completed.'));
    } finally {
      setBusy(false);
    }
  }

  async function publish(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    setBlockers(null);
    try {
      const result = await publishRun(runId);
      if (result.status === 'blocked') {
        setBlockers(result.blockers);
      } else {
        setNotice(`Published ${result.payslips} payslip${result.payslips === 1 ? '' : 's'}. Employees can now see them under My Payslips.`);
      }
      onChanged();
      await load();
    } catch (err) {
      setError(errorText(err, 'Unable to publish the run.'));
    } finally {
      setBusy(false);
    }
  }

  async function remediate(driftId: string): Promise<void> {
    setBusy(true);
    try {
      await remediateDrift(runId, driftId);
      setDrifts((await listRunDrifts(runId)).drifts);
    } catch (err) {
      setError(errorText(err, 'Unable to resolve the item.'));
    } finally {
      setBusy(false);
    }
  }

  if (!run) {
    return <Card>{error ? <Notice error>{error}</Notice> : <p className="text-sm text-app-muted">Loading run…</p>}</Card>;
  }

  const month = formatMonth(run.periodStart);
  const totals = employees.reduce(
    (sum, e) => ({
      gross: sum.gross + BigInt(e.grossPaise ?? '0'),
      deductions: sum.deductions + BigInt(e.deductionsPaise ?? '0'),
      net: sum.net + BigInt(e.netPaise ?? '0'),
    }),
    { gross: 0n, deductions: 0n, net: 0n },
  );
  const unresolvedDrifts = drifts.filter((d) => !d.resolvedAt);
  const noSalary = employees.filter((e) => !e.hasSalaryStructure);

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-app-muted">Payroll run</p>
          <h2 className="mt-1 font-display text-2xl font-bold">{month}</h2>
          <p className="text-xs text-app-muted">
            {formatDate(run.periodStart)} – {formatDate(run.periodEnd)} · created {formatDate(run.createdAt)}
            {run.publishedAt ? ` · published ${formatDate(run.publishedAt)}` : ''}
          </p>
        </div>
        <StatusBadge status={run.status} />
      </div>

      {run.status === 'draft' && (
        <Notice>
          Attendance, leave, salaries and payroll entries for {month} were frozen when this run was created.
          Start the calculation to produce draft payslips for review. Nothing is visible to employees until you publish.
        </Notice>
      )}
      {active && (
        <Notice>
          {run.status === 'computing'
            ? `Calculating payslips… ${run.computedCount} of ${run.employeeCount} done.`
            : 'Publishing…'}
        </Notice>
      )}
      {run.status === 'failed' && (
        <Notice error>
          The calculation failed for {run.failedCount} employee{run.failedCount === 1 ? '' : 's'}. Create a new run for {month} to try again;
          if it fails again, contact support.
        </Notice>
      )}
      {run.status === 'review' && run.inputsChanged && (
        <Notice error>
          Attendance, leave, salary or payroll entries changed after this run was calculated. Recalculate before publishing.
        </Notice>
      )}
      {run.status === 'review' && noSalary.length > 0 && (
        <Notice error>
          {noSalary.map((e) => e.fullName).join(', ')} {noSalary.length === 1 ? 'has' : 'have'} no salary structure and will be paid nothing.
        </Notice>
      )}
      {notice && <Notice>{notice}</Notice>}
      {error && <Notice error>{error}</Notice>}
      {blockers && blockers.length > 0 && (
        <BlockerList blockers={blockers} title="This run can't be published yet. Resolve these items, then try again." />
      )}

      <div className="flex flex-wrap gap-2">
        {run.status === 'draft' && (
          <Button disabled={busy} onClick={() => void act('start')}>{busy ? 'Starting…' : 'Start calculation'}</Button>
        )}
        {run.status === 'review' && (
          <>
            <Button disabled={busy || unresolvedDrifts.length > 0} onClick={() => setConfirm('publish')}>Publish payslips</Button>
            <Button kind="secondary" disabled={busy} onClick={() => void act('recalculate')}>{busy ? 'Working…' : 'Recalculate'}</Button>
          </>
        )}
        {(run.status === 'draft' || run.status === 'review' || run.status === 'computing') && (
          <Button kind="danger" disabled={busy} onClick={() => setConfirm('cancel')}>Cancel run</Button>
        )}
      </div>

      {employees.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-app-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-app-border text-left text-xs uppercase tracking-wider text-app-muted">
                <th className="px-3 py-2.5">Employee</th>
                <th className="px-3 py-2.5 text-right">Paid days</th>
                <th className="px-3 py-2.5 text-right">Gross</th>
                <th className="px-3 py-2.5 text-right">Deductions</th>
                <th className="px-3 py-2.5 text-right">Net pay</th>
                <th className="px-3 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => {
                const open = expanded === employee.userId;
                return (
                  <Fragment key={employee.userId}>
                    <tr
                      className="cursor-pointer border-b border-app-border last:border-0 hover:bg-app-background"
                      onClick={() => setExpanded(open ? null : employee.userId)}
                    >
                      <td className="px-3 py-2.5">
                        <p className="font-medium">{employee.fullName}</p>
                        <p className="text-xs text-app-muted">
                          {[employee.employeeCode, employee.departmentName].filter(Boolean).join(' · ')}
                          {!employee.hasSalaryStructure && <span className="ml-1 text-app-danger">No salary structure</span>}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {employee.paidDayCount === null ? '—' : `${employee.paidDayCount} / ${employee.periodDayCount}`}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatPaise(employee.grossPaise)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatPaise(employee.deductionsPaise)}</td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatPaise(employee.netPaise)}</td>
                      <td className="px-3 py-2.5 text-xs text-app-muted">
                        {employee.status === 'failed' ? <span className="text-app-danger">Failed</span>
                          : employee.payslipStatus === 'published' ? 'Published'
                          : employee.status === 'computed' ? 'Calculated'
                          : 'Waiting'}
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b border-app-border bg-app-background/60">
                        <td colSpan={6} className="px-3 py-3">
                          {employee.lines.length === 0 ? (
                            <p className="text-xs text-app-muted">No payslip lines yet.</p>
                          ) : (
                            <div className="grid gap-4 md:grid-cols-2">
                              {(['earning', 'deduction'] as const).map((kind) => (
                                <div key={kind}>
                                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-app-muted">
                                    {kind === 'earning' ? 'Earnings' : 'Deductions'}
                                  </p>
                                  {employee.lines.filter((l) => l.kind === kind).map((line) => (
                                    <div key={line.code} className="flex justify-between text-xs">
                                      <span>{line.label}</span>
                                      <span className="tabular-nums">{formatPaise(line.amountPaise)}</span>
                                    </div>
                                  ))}
                                </div>
                              ))}
                            </div>
                          )}
                          {employee.payslipStatus === 'published' && employee.payslipId && (
                            <div className="mt-3">
                              <Button kind="secondary" onClick={(e) => { e.stopPropagation(); setRevising(employee); }}>
                                Revise payslip
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-app-border text-sm font-semibold">
                <td className="px-3 py-2.5">Total ({employees.length})</td>
                <td />
                <td className="px-3 py-2.5 text-right tabular-nums">{formatPaise(totals.gross.toString())}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatPaise(totals.deductions.toString())}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatPaise(totals.net.toString())}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {drifts.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-app-muted">
            Changes found after publication ({unresolvedDrifts.length} open)
          </p>
          <div className="space-y-1.5">
            {drifts.map((drift) => (
              <div
                key={drift.id}
                className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs ${drift.resolvedAt ? 'bg-app-background text-app-muted' : 'bg-amber-500/8 text-amber-900 dark:text-amber-200'}`}
              >
                <span>
                  <span className="font-medium">{drift.fullName}</span>: {BLOCKER_LABELS[drift.sourceType ?? ''] ?? drift.kind}
                  {drift.resolvedAt && ` · resolved ${formatDate(drift.resolvedAt)}`}
                </span>
                {!drift.resolvedAt && drift.kind === 'blocker' && (
                  <Button kind="secondary" disabled={busy} onClick={() => void remediate(drift.id)}>Mark resolved</Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {confirm === 'publish' && (
        <ConfirmModal
          title={`Publish ${month} payroll?`}
          body={`${employees.length} payslip(s) totalling ${formatPaise(totals.net.toString())} net will be published and shown to employees. Published payslips can't be edited; later corrections are issued as revisions.`}
          confirmLabel="Publish"
          onClose={() => setConfirm(null)}
          onConfirm={() => { setConfirm(null); void publish(); }}
        />
      )}
      {confirm === 'cancel' && (
        <ConfirmModal
          title={`Cancel the ${month} run?`}
          body="The draft payslips are kept for the record but never shown to employees. You can create a new run for the month afterwards."
          confirmLabel="Cancel run"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => { setConfirm(null); void act('cancel'); }}
        />
      )}
      {revising && (
        <RevisePayslip
          employee={revising}
          onClose={() => setRevising(null)}
          onRevised={(message) => { setRevising(null); setNotice(message); void load(); }}
        />
      )}
    </Card>
  );
}

export function RunsPage({ onNavigate }: { onNavigate?: (path: string) => void } = {}): React.JSX.Element {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [month, setMonth] = useState(previousMonthStart().slice(0, 7));
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<{ message: string; needsSettings: boolean } | null>(null);
  const [created, setCreated] = useState<CreateRunResult | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const { runs: data } = await listRuns();
      setRuns(data);
      setError(null);
    } catch (err) {
      setError(errorText(err, 'Unable to load payroll runs.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleCreate(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      setCreateError({ message: 'Choose the month to pay.', needsSettings: false });
      return;
    }
    setCreating(true);
    setCreateError(null);
    setCreated(null);
    try {
      const result = await createRun(`${month}-01`);
      setCreated(result);
      setShowCreate(false);
      setSelectedRunId(result.runId);
      await load();
    } catch (err) {
      const code = (err as { code?: string }).code;
      setCreateError({ message: errorText(err, 'Unable to create the run.'), needsSettings: code === 'PAYROLL_NO_CONFIG' });
    } finally {
      setCreating(false);
    }
  }

  return (
    <Page
      eyebrow="Payroll"
      title="Payroll runs"
      description="Create a run for a month, calculate payslips from attendance, leave, salaries and payroll entries, review them, then publish them to employees."
      action={!showCreate && <Button onClick={() => { setShowCreate(true); setCreated(null); }}>New run</Button>}
    >
      {showCreate && (
        <Card className="mt-6">
          <form onSubmit={(e) => void handleCreate(e)} className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-semibold text-app-muted">
              <span className="mb-2 block">Month to pay</span>
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
              />
            </label>
            <Button type="submit" disabled={creating}>{creating ? 'Creating…' : 'Create run'}</Button>
            <Button kind="secondary" onClick={() => { setShowCreate(false); setCreateError(null); }}>Cancel</Button>
          </form>
          <p className="mt-3 text-xs text-app-muted">
            A month can be published once every attendance day in it is closed and no corrections or break reviews are pending.
          </p>
          {createError && (
            <div className="mt-3">
              <Notice error>
                {createError.message}
                {createError.needsSettings && onNavigate && (
                  <button type="button" className="ml-2 underline" onClick={() => onNavigate('/company/payroll/settings')}>
                    Open payroll settings
                  </button>
                )}
              </Notice>
            </div>
          )}
        </Card>
      )}

      {created && <CreatedSummary result={created} onDismiss={() => setCreated(null)} />}
      {error && <div className="mt-6"><Notice error>{error}</Notice></div>}
      {loading && <p className="mt-6 text-sm text-app-muted">Loading runs…</p>}
      {!loading && runs.length === 0 && !showCreate && (
        <Card className="mt-6 text-center">
          <p className="text-sm text-app-muted">
            No payroll runs yet. Accept payroll settings and record salaries first, then create a run.
          </p>
        </Card>
      )}

      {runs.length > 0 && (
        <div className="mt-6 grid gap-4 lg:grid-cols-[300px_1fr]">
          <div className="space-y-2">
            {runs.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => setSelectedRunId(run.id)}
                className={`w-full rounded-xl border px-4 py-3 text-left transition ${run.id === selectedRunId ? 'border-app-accent bg-app-accent/5' : 'border-app-border bg-app-surface hover:border-app-accent'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{formatMonth(run.periodStart)}</span>
                  <StatusBadge status={run.status} />
                </div>
                <p className="mt-1 text-xs text-app-muted">
                  {run.employeeCount} employee{run.employeeCount === 1 ? '' : 's'}
                  {run.status === 'computing' ? ` · ${run.computedCount} calculated` : ''}
                  {run.inputsChanged && run.status === 'review' ? ' · inputs changed' : ''}
                </p>
              </button>
            ))}
          </div>
          {selectedRunId
            ? <RunDetailPanel runId={selectedRunId} onChanged={() => void load()} onStarted={() => setCreated(null)} />
            : <Card><p className="text-sm text-app-muted">Select a run to review it.</p></Card>}
        </div>
      )}
    </Page>
  );
}
