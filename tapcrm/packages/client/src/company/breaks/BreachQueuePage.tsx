import { useEffect, useState } from 'react';
import {
  listBreaches,
  confirmBreach,
  waiveBreach,
  submitBreachExplanation,
  type BreachListItem,
} from '../api/breaksApi.js';
import { SkeletonTable } from '../../ui/components.js';

function fmtDate(value: string): string {
  return new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${value}T12:00:00Z`));
}

function fmtTs(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(new Date(value));
}

const STATUS_CLASSES: Record<string, string> = {
  pending: 'bg-amber-500/14 text-amber-800 dark:text-amber-200',
  advisory: 'bg-sky-500/12 text-sky-800 dark:text-sky-200',
  confirmed: 'bg-rose-500/12 text-rose-800 dark:text-rose-200',
  waived: 'bg-emerald-500/12 text-emerald-800 dark:text-emerald-200',
  suppressed: 'bg-app-surface-raised text-app-muted',
  superseded: 'bg-app-surface-raised text-app-muted',
};

type StatusFilter = 'pending' | 'advisory' | 'all';

function ActionPanel({
  breach,
  onDone,
}: {
  breach: BreachListItem;
  onDone: () => void;
}): React.JSX.Element {
  const [mode, setMode] = useState<'idle' | 'confirm' | 'waive' | 'explain'>('idle');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canAct = breach.status === 'pending' || breach.status === 'advisory';
  const canExplain = !breach.explanation && canAct;

  async function doConfirm(): Promise<void> {
    setBusy(true); setErr(null);
    try {
      await confirmBreach(breach.id, note.trim() || undefined);
      setMode('idle'); setNote(''); onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed.'); }
    finally { setBusy(false); }
  }

  async function doWaive(): Promise<void> {
    if (!note.trim()) { setErr('Reason is required to waive.'); return; }
    setBusy(true); setErr(null);
    try {
      await waiveBreach(breach.id, note.trim());
      setMode('idle'); setNote(''); onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed.'); }
    finally { setBusy(false); }
  }

  async function doExplain(): Promise<void> {
    if (!note.trim()) { setErr('Explanation cannot be empty.'); return; }
    setBusy(true); setErr(null);
    try {
      await submitBreachExplanation(breach.id, note.trim());
      setMode('idle'); setNote(''); onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed.'); }
    finally { setBusy(false); }
  }

  if (mode === 'idle') {
    return (
      <div className="flex flex-wrap gap-1.5">
        {canAct && (
          <>
            <button
              type="button"
              onClick={() => setMode('confirm')}
              className="rounded border border-rose-400 px-2 py-0.5 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setMode('waive')}
              className="rounded border border-emerald-500 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950"
            >
              Waive
            </button>
          </>
        )}
        {canExplain && (
          <button
            type="button"
            onClick={() => setMode('explain')}
            className="rounded border border-app-border px-2 py-0.5 text-xs text-app-muted hover:border-app-accent"
          >
            Add explanation
          </button>
        )}
      </div>
    );
  }

  const label = mode === 'confirm' ? 'Confirm breach' : mode === 'waive' ? 'Waive breach' : 'Add explanation';
  const noteRequired = mode !== 'confirm';

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-app-border p-3">
      <p className="text-xs font-semibold">{label}</p>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder={noteRequired ? 'Required…' : 'Optional note…'}
        className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-1.5 text-xs placeholder:text-app-muted focus:outline-none focus:ring-2 focus:ring-app-accent/30"
      />
      {err && <p className="text-xs text-app-danger">{err}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void (mode === 'confirm' ? doConfirm() : mode === 'waive' ? doWaive() : doExplain())}
          className="rounded-lg bg-app-accent px-3 py-1.5 text-xs font-semibold text-app-on-accent disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Submit'}
        </button>
        <button
          type="button"
          onClick={() => { setMode('idle'); setNote(''); setErr(null); }}
          className="rounded-lg border border-app-border px-3 py-1.5 text-xs text-app-muted hover:border-app-accent"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function BreachQueuePage(): React.JSX.Element {
  const [breaches, setBreaches] = useState<BreachListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('pending');

  function load(): void {
    setLoading(true);
    setError(null);
    const params = filter === 'all' ? { limit: 100 } : { status: filter, limit: 100 };
    let promise: Promise<BreachListItem[]>;
    try {
      promise = listBreaches(params);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load.');
      setLoading(false);
      return;
    }
    promise
      .then((items) => { setBreaches(items); setLoading(false); })
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : 'Failed to load.'); setLoading(false); });
  }

  useEffect(() => { load(); }, [filter]);

  const pending = breaches.filter((b) => b.status === 'pending').length;
  const advisory = breaches.filter((b) => b.status === 'advisory').length;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-app-border p-0.5">
          {(['pending', 'advisory', 'all'] as StatusFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize ${filter === f ? 'bg-app-foreground text-app-surface' : 'text-app-muted hover:text-app-foreground'}`}
            >
              {f}
            </button>
          ))}
        </div>
        {pending > 0 && (
          <span className="rounded-full bg-amber-500/14 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:text-amber-200">
            {pending} pending
          </span>
        )}
        {advisory > 0 && (
          <span className="rounded-full bg-sky-500/12 px-2.5 py-1 text-xs font-semibold text-sky-800 dark:text-sky-200">
            {advisory} advisory
          </span>
        )}
      </div>

      {error && <p className="text-sm text-app-danger">{error}</p>}
      {loading && <SkeletonTable columns={5} rows={5} />}

      {!loading && breaches.length === 0 && (
        <div className="rounded-2xl border border-app-border bg-app-surface p-8 text-center text-sm text-app-muted">
          No {filter === 'all' ? '' : filter} breaches.
        </div>
      )}

      {breaches.length > 0 && (
        <div className="space-y-2">
          {breaches.map((breach) => (
            <div key={breach.id} className="rounded-2xl border border-app-border bg-app-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold tabular-nums">{fmtDate(breach.workDate)}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLASSES[breach.status] ?? 'bg-app-surface-raised text-app-muted'}`}>
                      {breach.status}
                    </span>
                    {breach.autoApplied && (
                      <span className="rounded bg-app-surface-raised px-1.5 py-0.5 text-[10px] text-app-muted">Auto</span>
                    )}
                    {breach.occurrenceNumber !== null && (
                      <span className="text-xs text-app-muted">#{breach.occurrenceNumber}</span>
                    )}
                  </div>
                  {breach.matchedRuleId && (
                    <p className="mt-0.5 font-mono text-xs text-app-muted">{breach.matchedRuleId}</p>
                  )}
                </div>
                <p className="text-xs tabular-nums text-app-muted">Created {fmtTs(breach.createdAt)}</p>
              </div>

              {/* Decision details */}
              {(breach.confirmedAt || breach.waivedAt) && (
                <div className="mt-2 text-xs text-app-muted border-t border-app-border pt-2">
                  {breach.confirmedAt && <span>Confirmed {fmtTs(breach.confirmedAt)}</span>}
                  {breach.waivedAt && <span>Waived {fmtTs(breach.waivedAt)}{breach.waiverReason ? ` — ${breach.waiverReason}` : ''}</span>}
                </div>
              )}

              {/* Explanation */}
              {breach.explanation && (
                <div className="mt-2 rounded-lg bg-app-surface-raised px-3 py-2 text-xs text-app-muted border-t border-app-border">
                  <span className="font-semibold text-app-foreground">Explanation: </span>{breach.explanation}
                </div>
              )}

              <ActionPanel breach={breach} onDone={load} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
