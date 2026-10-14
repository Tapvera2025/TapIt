import { useEffect, useState } from 'react';
import { Button, Card, Field, Page } from '../../../ui/components.js';
import {
  closeTriageLead,
  getHandoverTargets,
  listTriage,
  rescueFromTriage,
  returnTriageToPool,
  type HandoverTarget,
  type TriageRow,
} from '../leads/api.js';
import { formatAge, labelForReason } from './triage-helpers.js';

type Dialog =
  | { kind: 'none' }
  | { kind: 'rescue'; row: TriageRow }
  | { kind: 'close'; row: TriageRow };

const POLL_INTERVAL_MS = 20_000;

export function TriagePage({ onNavigate }: { onNavigate: (path: string) => void }): React.JSX.Element {
  const [rows, setRows] = useState<TriageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' });

  const reload = async (): Promise<void> => {
    try {
      const result = await listTriage();
      setRows(result.items);
      setError(null);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Unable to load the triage queue.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  async function onReturn(leadId: string): Promise<void> {
    try {
      await returnTriageToPool(leadId);
      await reload();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Return-to-pool failed.');
    }
  }

  return (
    <Page
      eyebrow="Sales"
      title="Triage queue"
      description="Leads that fell out of the bid pool without an owner. Rescue them to an agent, return to the pool, or close with a reason."
      action={
        <Button kind="secondary" onClick={() => void reload()}>
          Refresh
        </Button>
      }
    >
      {error && (
        <p className="mb-4 rounded-lg bg-[#d86b6b]/10 p-3 text-sm text-app-danger" role="alert">
          {error}
        </p>
      )}

      {loading && rows.length === 0 ? (
        <Card>
          <p className="text-sm text-app-muted">Loading triage queue…</p>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <h2 className="font-display text-xl font-bold">No leads waiting in triage</h2>
          <p className="mt-2 text-sm text-app-muted">
            Everything the bid pool released found an owner or was rescued.
          </p>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-app-border text-left text-xs uppercase tracking-wide text-app-muted">
                <th className="p-3 font-semibold">Age</th>
                <th className="p-3 font-semibold">Lead</th>
                <th className="p-3 font-semibold">Reason</th>
                <th className="p-3 font-semibold">Source</th>
                <th className="p-3 font-semibold">Service</th>
                <th className="p-3 font-semibold">Location</th>
                <th className="p-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.leadId} className="border-b border-app-border last:border-b-0">
                  <td className="p-3 font-semibold">{formatAge(row.ageSeconds)}</td>
                  <td className="p-3">
                    <button
                      type="button"
                      className="font-semibold underline underline-offset-2 hover:text-app-accent"
                      onClick={() => onNavigate(`/company/sales/leads/${row.leadId}`)}
                    >
                      {row.contactName}
                    </button>
                    <p className="text-xs text-app-muted">#{row.leadNumber}</p>
                  </td>
                  <td className="p-3 text-xs text-app-muted">{labelForReason(row.reason)}</td>
                  <td className="p-3 text-xs">{row.sourceName}</td>
                  <td className="p-3 text-xs">{row.service ?? '—'}</td>
                  <td className="p-3 text-xs">{row.location ?? '—'}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => setDialog({ kind: 'rescue', row })}>Rescue</Button>
                      <Button kind="secondary" onClick={() => void onReturn(row.leadId)}>
                        Return to pool
                      </Button>
                      <Button kind="danger" onClick={() => setDialog({ kind: 'close', row })}>
                        Close
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {dialog.kind === 'rescue' && (
        <RescueDialog
          row={dialog.row}
          onClose={() => setDialog({ kind: 'none' })}
          onDone={async () => {
            setDialog({ kind: 'none' });
            await reload();
          }}
        />
      )}
      {dialog.kind === 'close' && (
        <CloseDialog
          row={dialog.row}
          onClose={() => setDialog({ kind: 'none' })}
          onDone={async () => {
            setDialog({ kind: 'none' });
            await reload();
          }}
        />
      )}
    </Page>
  );
}

function RescueDialog({
  row,
  onClose,
  onDone,
}: {
  row: TriageRow;
  onClose: () => void;
  onDone: () => Promise<void>;
}): React.JSX.Element {
  const [targets, setTargets] = useState<HandoverTarget[]>([]);
  const [newOwnerId, setNewOwnerId] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getHandoverTargets(row.leadId).then(setTargets).catch(() => setTargets([]));
  }, [row.leadId]);
  const canSubmit = !submitting && newOwnerId.length > 0 && reason.trim().length >= 5;
  async function submit(): Promise<void> {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await rescueFromTriage(row.leadId, { newOwnerId, reason: reason.trim() });
      await onDone();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Rescue failed.');
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <ActionDialog title={`Rescue #${row.leadNumber}`} onClose={onClose} submitting={submitting} canSubmit={canSubmit} submitLabel="Rescue" onSubmit={() => void submit()} error={error}>
      <label className="text-xs font-semibold text-app-muted">
        <span className="mb-2 block">New owner</span>
        <select
          value={newOwnerId}
          onChange={(event) => setNewOwnerId(event.target.value)}
          className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm"
        >
          <option value="">Pick an eligible agent</option>
          {targets.map((target) => (
            <option key={target.id} value={target.id} disabled={!target.selectable}>
              {target.fullName} · {target.availability.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
      </label>
      <div className="mt-4">
        <Field label="Reason" value={reason} onChange={setReason} required placeholder="Why this agent, at least 5 characters" />
      </div>
    </ActionDialog>
  );
}

function CloseDialog({
  row,
  onClose,
  onDone,
}: {
  row: TriageRow;
  onClose: () => void;
  onDone: () => Promise<void>;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [lossReason, setLossReason] = useState<'not_interested' | 'no_budget' | 'unqualified' | 'duplicate' | 'other'>('unqualified');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSubmit = !submitting && reason.trim().length >= 5;
  async function submit(): Promise<void> {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await closeTriageLead(row.leadId, { reason: reason.trim(), lossReason });
      await onDone();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Close failed.');
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <ActionDialog title={`Close #${row.leadNumber}`} onClose={onClose} submitting={submitting} canSubmit={canSubmit} submitLabel="Close lead" onSubmit={() => void submit()} error={error}>
      <label className="text-xs font-semibold text-app-muted">
        <span className="mb-2 block">Loss reason</span>
        <select
          value={lossReason}
          onChange={(event) => setLossReason(event.target.value as typeof lossReason)}
          className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm"
        >
          <option value="unqualified">Unqualified</option>
          <option value="not_interested">Not interested</option>
          <option value="no_budget">No budget</option>
          <option value="duplicate">Duplicate</option>
          <option value="other">Other</option>
        </select>
      </label>
      <div className="mt-4">
        <Field label="Reason" value={reason} onChange={setReason} required placeholder="Explain the close in the audit trail" />
      </div>
    </ActionDialog>
  );
}

function ActionDialog({
  title,
  onClose,
  submitting,
  canSubmit,
  submitLabel,
  onSubmit,
  error,
  children,
}: {
  title: string;
  onClose: () => void;
  submitting: boolean;
  canSubmit: boolean;
  submitLabel: string;
  onSubmit: () => void;
  error: string | null;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <button type="button" aria-label="Close dialog" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <section className="relative w-full max-w-md rounded-xl border border-app-border bg-app-background p-6 shadow-2xl">
        <header className="mb-4 flex items-start justify-between gap-3">
          <h2 className="font-display text-xl font-bold">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded p-1 text-app-muted hover:text-app-foreground">
            ×
          </button>
        </header>
        {children}
        {error && (
          <p className="mt-4 rounded-lg bg-[#d86b6b]/10 p-3 text-sm text-app-danger" role="alert">
            {error}
          </p>
        )}
        <footer className="mt-5 flex justify-end gap-3">
          <Button kind="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={onSubmit}>
            {submitting ? 'Working…' : submitLabel}
          </Button>
        </footer>
      </section>
    </div>
  );
}
