import { useEffect, useState } from 'react';
import {
  listBreakPolicies,
  createBreakPolicy,
  assignBreakPolicy,
  type BreakPolicyRow,
} from '../api/breaksApi.js';

function fmtDate(value: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
}

function AssignPanel({ policyId, onDone }: { policyId: string; onDone: () => void }): React.JSX.Element {
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [priority, setPriority] = useState('0');
  const [userId, setUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleAssign(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!effectiveFrom) { setErr('Effective from is required.'); return; }
    setBusy(true); setErr(null);
    try {
      await assignBreakPolicy(policyId, {
        effectiveFrom,
        effectiveTo: effectiveTo || null,
        priority: Number(priority) || 0,
        userId: userId.trim() || null,
      });
      onDone();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Failed to assign.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleAssign(e)} className="mt-3 space-y-3 rounded-xl border border-app-border p-4">
      <p className="text-xs font-semibold">Assign policy</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-semibold text-app-muted">Effective from</label>
          <input
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-app-muted">Effective to (optional)</label>
          <input
            type="date"
            value={effectiveTo}
            onChange={(e) => setEffectiveTo(e.target.value)}
            className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-app-muted">Priority</label>
          <input
            type="number"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            min="0"
            className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-app-muted">User ID (leave blank for org-wide)</label>
          <input
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="UUID or blank"
            className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm font-mono"
          />
        </div>
      </div>
      {err && <p className="text-xs text-app-danger">{err}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-app-accent px-3 py-1.5 text-xs font-semibold text-app-on-accent disabled:opacity-50"
        >
          {busy ? 'Assigning…' : 'Assign'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg border border-app-border px-3 py-1.5 text-xs text-app-muted hover:border-app-accent"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function PolicyCard({ policy, onRefresh }: { policy: BreakPolicyRow; onRefresh: () => void }): React.JSX.Element {
  const [showAssign, setShowAssign] = useState(false);

  return (
    <div className="rounded-2xl border border-app-border bg-app-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{policy.name}</p>
          <p className="mt-0.5 text-xs text-app-muted">Created {fmtDate(policy.createdAt)}</p>
          <p className="mt-0.5 font-mono text-[10px] text-app-muted">{policy.id}</p>
        </div>
        {!showAssign && (
          <button
            type="button"
            onClick={() => setShowAssign(true)}
            className="rounded border border-app-border px-2.5 py-1 text-xs text-app-muted hover:border-app-accent hover:text-app-foreground"
          >
            Assign
          </button>
        )}
      </div>
      {showAssign && (
        <AssignPanel
          policyId={policy.id}
          onDone={() => { setShowAssign(false); onRefresh(); }}
        />
      )}
    </div>
  );
}

export function BreakPoliciesPage(): React.JSX.Element {
  const [policies, setPolicies] = useState<BreakPolicyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [upperTotal, setUpperTotal] = useState('');
  const [upperSingle, setUpperSingle] = useState('');
  const [grace, setGrace] = useState('0');
  const [warningPct, setWarningPct] = useState('80');
  const [countsTwh, setCountsTwh] = useState(true);

  async function load(): Promise<void> {
    setLoading(true);
    try {
      const data = await listBreakPolicies();
      setPolicies(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function handleCreate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!name.trim() || !effectiveFrom) { setFormError('Name and effective date are required.'); return; }
    setSubmitting(true); setFormError(null);
    try {
      await createBreakPolicy({
        name: name.trim(),
        effectiveFrom,
        upperTotalMinutes: upperTotal ? Number(upperTotal) : null,
        upperSingleMinutes: upperSingle ? Number(upperSingle) : null,
        graceMinutes: Number(grace) || 0,
        warningPercent: Number(warningPct) || 80,
        countsTowardWorkHours: countsTwh,
        rules: [],
      });
      setShowForm(false);
      setName(''); setEffectiveFrom(''); setUpperTotal(''); setUpperSingle('');
      setGrace('0'); setWarningPct('80'); setCountsTwh(true);
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Break Policies</h2>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-app-accent px-3 py-1.5 text-xs font-semibold text-app-on-accent"
          >
            New policy
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={(e) => void handleCreate(e)} className="rounded-2xl border border-app-border bg-app-surface p-5 space-y-4">
          <p className="text-sm font-semibold">New break policy</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-app-muted">Policy name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Standard break policy"
                className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-app-muted">Effective from</label>
              <input
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-app-muted">Max total break (minutes)</label>
              <input
                type="number"
                value={upperTotal}
                onChange={(e) => setUpperTotal(e.target.value)}
                min="1"
                placeholder="e.g. 60"
                className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-app-muted">Max single break (minutes)</label>
              <input
                type="number"
                value={upperSingle}
                onChange={(e) => setUpperSingle(e.target.value)}
                min="1"
                placeholder="e.g. 20"
                className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-app-muted">Grace minutes</label>
              <input
                type="number"
                value={grace}
                onChange={(e) => setGrace(e.target.value)}
                min="0"
                className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-app-muted">Warning threshold (%)</label>
              <input
                type="number"
                value={warningPct}
                onChange={(e) => setWarningPct(e.target.value)}
                min="1"
                max="100"
                className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-sm"
              />
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <input
                id="countsTwh"
                type="checkbox"
                checked={countsTwh}
                onChange={(e) => setCountsTwh(e.target.checked)}
                className="rounded border-app-border"
              />
              <label htmlFor="countsTwh" className="text-sm text-app-foreground">
                Counts toward work hours
              </label>
            </div>
          </div>
          {formError && <p className="text-xs text-app-danger">{formError}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-app-accent px-4 py-2 text-sm font-semibold text-app-on-accent disabled:opacity-50"
            >
              {submitting ? 'Creating…' : 'Create policy'}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setFormError(null); }}
              className="rounded-lg border border-app-border px-4 py-2 text-sm text-app-muted hover:border-app-accent"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && <p className="text-sm text-app-danger">{error}</p>}
      {loading && <p className="text-sm text-app-muted">Loading policies…</p>}

      {!loading && policies.length === 0 && (
        <div className="rounded-2xl border border-app-border bg-app-surface p-8 text-center text-sm text-app-muted">
          No break policies yet.
        </div>
      )}

      {policies.length > 0 && (
        <div className="space-y-2">
          {policies.map((p) => (
            <PolicyCard key={p.id} policy={p} onRefresh={load} />
          ))}
        </div>
      )}
    </div>
  );
}
