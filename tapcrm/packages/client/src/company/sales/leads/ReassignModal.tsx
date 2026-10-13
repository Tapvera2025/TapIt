import { useEffect, useState } from 'react';
import { Button, Field } from '../../../ui/components.js';
import {
  getHandoverTargets,
  reassignLead,
  type HandoverTarget,
  type Lead,
} from './api.js';
import {
  hasFormProblems,
  validateReassignForm,
  type ReassignFormInput,
} from './reassign-helpers.js';

/**
 * Reassign a lead to a new owner (R1 plan step 1.15). The handover-
 * targets endpoint already returns pool-eligible users resolved via
 * the availability facade, so we reuse it rather than build a parallel
 * `/eligible-agents` route.
 */

export function ReassignModal({
  lead,
  canTransferSourcingCredit,
  onClose,
  onReassigned,
}: {
  lead: Lead;
  canTransferSourcingCredit: boolean;
  onClose: () => void;
  onReassigned: (updated: Lead) => void;
}): React.JSX.Element {
  const [targets, setTargets] = useState<HandoverTarget[]>([]);
  const [targetsError, setTargetsError] = useState<string | null>(null);
  const [form, setForm] = useState<ReassignFormInput>({
    newOwnerId: '',
    reason: '',
    transferPendingCallbacks: true,
    transferScheduledActivities: true,
    transferSourcingCredit: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getHandoverTargets(lead.id)
      .then((rows) => {
        if (!cancelled) {
          setTargets(rows);
          setTargetsError(null);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setTargetsError(cause instanceof Error ? cause.message : 'Could not load eligible agents.');
      });
    return () => {
      cancelled = true;
    };
  }, [lead.id]);

  const problems = validateReassignForm(form);
  const canSubmit = !submitting && !hasFormProblems(problems);

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const updated = await reassignLead(lead.id, form);
      onReassigned(updated);
      onClose();
    } catch (cause: unknown) {
      setSubmitError(cause instanceof Error ? cause.message : 'Unable to reassign.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Reassign lead"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <section className="relative w-full max-w-lg rounded-xl border border-app-border bg-app-background p-6 shadow-2xl">
        <header className="mb-5 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-app-accent">Reassignment</p>
            <h2 className="mt-2 font-display text-2xl font-bold">Reassign lead #{lead.leadNumber}</h2>
            <p className="mt-1 text-xs text-app-muted">
              Current holder: {lead.currentHolderName ?? 'Unrouted'}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded p-2 text-app-muted hover:bg-app-background hover:text-app-foreground"
          >
            ×
          </button>
        </header>

        {targetsError && (
          <p className="mb-3 rounded-lg bg-[#d86b6b]/10 p-3 text-sm text-app-danger" role="alert">
            {targetsError}
          </p>
        )}

        <label className="text-xs font-semibold text-app-muted">
          <span className="mb-2 block">New owner</span>
          <select
            value={form.newOwnerId}
            onChange={(event) => setForm({ ...form, newOwnerId: event.target.value })}
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm"
          >
            <option value="">Select an eligible agent</option>
            {targets.map((target) => (
              <option key={target.id} value={target.id} disabled={!target.selectable}>
                {target.fullName} · {target.positionCode.replaceAll('-', ' ')} · {target.availability.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
          {problems.newOwnerId && <p className="mt-1 text-xs text-app-danger">{problems.newOwnerId}</p>}
        </label>

        <div className="mt-4">
          <Field
            label="Reason (required)"
            value={form.reason}
            onChange={(reason) => setForm({ ...form, reason })}
            required
            placeholder="At least 5 characters — logged in the audit trail"
          />
          {problems.reason && <p className="mt-1 text-xs text-app-danger">{problems.reason}</p>}
        </div>

        <fieldset className="mt-5 space-y-2">
          <legend className="text-xs font-bold uppercase tracking-[0.14em] text-app-muted">
            Transfer options
          </legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.transferPendingCallbacks}
              onChange={(event) => setForm({ ...form, transferPendingCallbacks: event.target.checked })}
            />
            <span>Pending callbacks</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.transferScheduledActivities}
              onChange={(event) => setForm({ ...form, transferScheduledActivities: event.target.checked })}
            />
            <span>Scheduled activities</span>
          </label>
          {canTransferSourcingCredit && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.transferSourcingCredit}
                onChange={(event) => setForm({ ...form, transferSourcingCredit: event.target.checked })}
              />
              <span>
                Transfer sourcing credit <span className="text-xs text-app-muted">(Super Admin only)</span>
              </span>
            </label>
          )}
        </fieldset>

        {submitError && (
          <p className="mt-4 rounded-lg bg-[#d86b6b]/10 p-3 text-sm text-app-danger" role="alert">
            {submitError}
          </p>
        )}

        <footer className="mt-6 flex justify-end gap-3">
          <Button kind="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={() => void submit()}>
            {submitting ? 'Reassigning…' : 'Reassign'}
          </Button>
        </footer>
      </section>
    </div>
  );
}
