import { useEffect, useState } from 'react';
import {
  listRuns,
  createRun,
  getRunDetail,
  getRunEmployees,
  patchRun,
  publishRun,
  listRunDrifts,
  remediateDrift,
  type RunSummary,
  type RunDetail,
  type RunEmployee,
  type RunBlocker,
  type RunDrift,
  type RunStatus,
} from '../api/payrollApi.js';

function fmtPeriod(periodStart: string): string {
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${periodStart}T12:00:00Z`));
}

function fmtTs(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

const STATUS_CLASSES: Record<RunStatus, string> = {
  draft: 'bg-app-surface-raised text-app-muted',
  computing: 'bg-amber-500/14 text-amber-800 dark:text-amber-200',
  review: 'bg-sky-500/12 text-sky-800 dark:text-sky-200',
  publishing: 'bg-amber-500/14 text-amber-800 dark:text-amber-200',
  published: 'bg-emerald-500/12 text-emerald-800 dark:text-emerald-200',
  failed: 'bg-rose-500/12 text-rose-800 dark:text-rose-200',
  cancelled: 'bg-app-surface-raised text-app-muted',
};

function EmpStatusCount({ employees }: { employees: RunEmployee[] }): React.JSX.Element {
  const counts = employees.reduce<Record<string, number>>((acc, e) => {
    acc[e.status] = (acc[e.status] ?? 0) + 1;
    return acc;
  }, {});
  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(counts).map(([status, count]) => (
        <span key={status} className="rounded bg-app-surface-raised px-2 py-0.5 text-xs text-app-muted">
          {count} {status}
        </span>
      ))}
    </div>
  );
}

function BlockerList({ blockers }: { blockers: RunBlocker[] }): React.JSX.Element {
  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/8 p-3">
      <p className="mb-1.5 text-xs font-semibold text-amber-800 dark:text-amber-200">
        {blockers.length} open item{blockers.length !== 1 ? 's' : ''} — review before publishing
      </p>
      <div className="space-y-1 max-h-40 overflow-y-auto">
        {blockers.slice(0, 20).map((b, i) => (
          <div key={i} className="text-xs text-amber-900 dark:text-amber-300">
            <span className="font-medium">{b.kind}</span>
            {b.workDate && <span className="ml-1 text-amber-700 dark:text-amber-400">{b.workDate}</span>}
          </div>
        ))}
        {blockers.length > 20 && (
          <p className="text-xs text-amber-700">…and {blockers.length - 20} more</p>
        )}
      </div>
    </div>
  );
}

function RunDetailPanel({
  runId,
  onRefreshList,
}: {
  runId: string;
  onRefreshList: () => void;
}): React.JSX.Element {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [employees, setEmployees] = useState<RunEmployee[]>([]);
  const [drifts, setDrifts] = useState<RunDrift[]>([]);
  const [blockers, setBlockers] = useState<RunBlocker[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load(): void {
    setLoading(true);
    setError(null);
    Promise.all([
      getRunDetail(runId),
      getRunEmployees(runId),
      listRunDrifts(runId),
    ])
      .then(([runData, empData, driftData]) => {
        setRun(runData);
        setEmployees(empData.employees);
        setDrifts(driftData.drifts);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load run.');
        setLoading(false);
      });
  }

  useEffect(() => { load(); }, [runId]);

  async function handleStart(): Promise<void> {
    setBusy(true); setActionError(null);
    try {
      await patchRun(runId, 'start');
      onRefreshList(); load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to start computation.');
    } finally { setBusy(false); }
  }

  async function handleCancel(): Promise<void> {
    setBusy(true); setActionError(null);
    try {
      await patchRun(runId, 'cancel');
      onRefreshList(); load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to cancel run.');
    } finally { setBusy(false); }
  }

  async function handlePublish(): Promise<void> {
    setBusy(true); setActionError(null); setBlockers(null);
    try {
      const result = await publishRun(runId);
      if (result.status === 'blocked') {
        setBlockers(result.blockers);
      } else {
        onRefreshList(); load();
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to publish run.');
    } finally { setBusy(false); }
  }

  async function handleRemediate(driftId: string): Promise<void> {
    setBusy(true); setActionError(null);
    try {
      await remediateDrift(runId, driftId);
      const driftData = await listRunDrifts(runId);
      setDrifts(driftData.drifts);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to remediate drift.');
    } finally { setBusy(false); }
  }

  if (loading) return <div className="rounded-2xl border border-app-border bg-app-surface p-6 text-sm text-app-muted">Loading run…</div>;
  if (error) return <div className="rounded-2xl border border-app-border bg-app-surface p-6 text-sm text-app-danger">{error}</div>;
  if (!run) return <div className="rounded-2xl border border-app-border bg-app-surface p-6 text-sm text-app-muted">Run not found.</div>;

  const canStart = run.status === 'draft';
  const canCancel = run.status === 'review';
  const canPublish = run.status === 'review';
  const isActive = run.status === 'computing' || run.status === 'publishing';
  const unresolvedDrifts = drifts.filter((d) => !d.resolvedAt);

  return (
    <div className="space-y-4 rounded-2xl border border-app-border bg-app-surface p-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-app-muted">Run</p>
          <p className="mt-0.5 text-lg font-semibold">{fmtPeriod(run.periodStart)}</p>
          <p className="text-xs text-app-muted">{run.periodStart} → {run.periodEnd}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASSES[run.status]}`}>
          {run.status}
        </span>
      </div>

      {/* Timestamps */}
      <div className="flex flex-wrap gap-4 text-xs text-app-muted">
        <span>Created {fmtTs(run.createdAt)}</span>
        {run.publishedAt && <span>Published {fmtTs(run.publishedAt)}</span>}
        {run.inputsChanged && (
          <span className="text-amber-600 dark:text-amber-400">Inputs changed since freeze</span>
        )}
      </div>

      {/* Employees */}
      {employees.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-app-muted">
            {employees.length} employee{employees.length !== 1 ? 's' : ''}
          </p>
          <EmpStatusCount employees={employees} />
        </div>
      )}

      {/* Active state notice */}
      {isActive && (
        <div className="rounded-xl bg-amber-500/8 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          {run.status === 'computing' ? 'Computation in progress…' : 'Publishing in progress…'}
        </div>
      )}

      {/* Publish blockers from publish attempt */}
      {blockers && blockers.length > 0 && <BlockerList blockers={blockers} />}

      {/* Actions */}
      {(canStart || canCancel || canPublish) && (
        <div className="flex flex-wrap gap-2">
          {canStart && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleStart()}
              className="rounded-lg bg-app-accent px-4 py-2 text-sm font-semibold text-app-on-accent disabled:opacity-50"
            >
              {busy ? 'Starting…' : 'Start computation'}
            </button>
          )}
          {canPublish && (
            <button
              type="button"
              disabled={busy || unresolvedDrifts.length > 0}
              onClick={() => void handlePublish()}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              title={unresolvedDrifts.length > 0 ? `${unresolvedDrifts.length} unresolved drift(s)` : undefined}
            >
              {busy ? 'Publishing…' : 'Publish'}
            </button>
          )}
          {canCancel && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleCancel()}
              className="rounded-lg border border-rose-400 px-4 py-2 text-sm font-semibold text-rose-600 disabled:opacity-50 hover:bg-rose-50 dark:hover:bg-rose-950"
            >
              Cancel run
            </button>
          )}
        </div>
      )}

      {actionError && <p className="text-xs text-app-danger">{actionError}</p>}

      {/* Drifts */}
      {drifts.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-app-muted">
            Drifts ({unresolvedDrifts.length} unresolved)
          </p>
          <div className="space-y-1.5">
            {drifts.map((drift) => (
              <div
                key={drift.id}
                className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs ${drift.resolvedAt ? 'bg-app-surface-raised text-app-muted' : 'bg-amber-500/8 text-amber-900 dark:text-amber-200'}`}
              >
                <div className="min-w-0">
                  <span className="font-medium">{drift.kind}</span>
                  {drift.resolvedAt && (
                    <span className="ml-2 text-app-muted">Resolved {fmtTs(drift.resolvedAt)}</span>
                  )}
                </div>
                {!drift.resolvedAt && run.status !== 'published' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleRemediate(drift.id)}
                    className="shrink-0 rounded border border-amber-400 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950 disabled:opacity-50"
                  >
                    Remediate
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function RunsPage(): React.JSX.Element {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [periodStart, setPeriodStart] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createBlockers, setCreateBlockers] = useState<RunBlocker[]>([]);

  function load(): void {
    setLoading(true);
    listRuns()
      .then(({ runs: data }) => { setRuns(data); setLoading(false); })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load runs.');
        setLoading(false);
      });
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!periodStart) { setCreateError('Select a period.'); return; }
    if (!/^\d{4}-\d{2}-01$/.test(periodStart)) { setCreateError('Period must be the first of a month (YYYY-MM-01).'); return; }
    setCreating(true); setCreateError(null); setCreateBlockers([]);
    try {
      const result = await createRun(periodStart);
      setCreateBlockers(result.blockers);
      setShowCreateForm(false);
      setPeriodStart('');
      load();
      setSelectedRunId(result.runId);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create run.');
    } finally { setCreating(false); }
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Payroll Runs</h2>
        {!showCreateForm && (
          <button
            type="button"
            onClick={() => { setShowCreateForm(true); setCreateBlockers([]); }}
            className="rounded-lg bg-app-accent px-3 py-1.5 text-xs font-semibold text-app-on-accent"
          >
            New run
          </button>
        )}
      </div>

      {showCreateForm && (
        <form onSubmit={(e) => void handleCreate(e)} className="rounded-2xl border border-app-border bg-app-surface p-5 space-y-3">
          <p className="text-sm font-semibold">Create payroll run</p>
          <div>
            <label className="block text-xs font-semibold text-app-muted">Period start (first of month)</label>
            <input
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              className="mt-1 w-full max-w-xs rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm"
            />
            <p className="mt-1 text-xs text-app-muted">Must be the 1st of a month, e.g. 2026-09-01</p>
          </div>
          {createError && <p className="text-xs text-app-danger">{createError}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={creating}
              className="rounded-lg bg-app-accent px-4 py-2 text-sm font-semibold text-app-on-accent disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create run'}
            </button>
            <button
              type="button"
              onClick={() => { setShowCreateForm(false); setCreateError(null); }}
              className="rounded-lg border border-app-border px-4 py-2 text-sm text-app-muted hover:border-app-accent"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {createBlockers.length > 0 && (
        <BlockerList blockers={createBlockers} />
      )}

      {error && <p className="text-sm text-app-danger">{error}</p>}
      {loading && <p className="text-sm text-app-muted">Loading runs…</p>}

      {!loading && runs.length === 0 && (
        <div className="rounded-2xl border border-app-border bg-app-surface p-8 text-center text-sm text-app-muted">
          No payroll runs yet.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[280px,1fr]">
        {runs.length > 0 && (
          <div className="overflow-x-auto rounded-2xl border border-app-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-app-border text-left">
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-app-muted">Period</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-app-muted">Status</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr
                    key={run.id}
                    onClick={() => setSelectedRunId(run.id === selectedRunId ? null : run.id)}
                    className={`cursor-pointer border-b border-app-border last:border-0 hover:bg-app-surface-raised ${run.id === selectedRunId ? 'bg-app-accent/5' : ''}`}
                  >
                    <td className="px-4 py-3 font-medium">{fmtPeriod(run.periodStart)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLASSES[run.status]}`}>
                        {run.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {selectedRunId && (
          <RunDetailPanel runId={selectedRunId} onRefreshList={load} />
        )}
      </div>
    </div>
  );
}
