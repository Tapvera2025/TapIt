import { useState } from 'react';
import { Button, Field, Modal, Notice, Select } from '../../../ui/components.js';
import { updateJoiningStatus } from '../api/recruitmentApi.js';
import type { CandidateJoining, JoiningStatus } from '../types/index.js';

export function JoiningStatusModal({
  joining,
  onClose,
  onUpdated,
  onNavigateToEmployees,
}: {
  readonly joining: CandidateJoining;
  readonly onClose: () => void;
  readonly onUpdated: (joining: CandidateJoining) => void;
  readonly onNavigateToEmployees?: () => void;
}): React.JSX.Element {
  const [status, setStatus] = useState<JoiningStatus>(joining.status);
  const [actualJoiningDate, setActualJoiningDate] = useState(
    joining.actualJoiningDate ?? (joining.status === 'joined' ? new Date().toISOString().split('T')[0] ?? '' : ''),
  );
  const [notes, setNotes] = useState(joining.notes ?? '');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const updated = await updateJoiningStatus(joining.id, {
        status,
        actualJoiningDate: actualJoiningDate || undefined,
        notes: notes.trim() || undefined,
      });

      onUpdated(updated);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to update joining status');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Manage Joining: ${joining.candidateName ?? 'Candidate'}`} onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {error && <Notice error>{error}</Notice>}

        <div className="rounded-xl border border-app-border bg-app-surface p-4 text-xs text-app-muted space-y-1">
          <p>
            <strong className="text-app-foreground">Candidate:</strong> {joining.candidateName ?? 'Candidate'}
          </p>
          <p>
            <strong className="text-app-foreground">Expected Joining Date:</strong> {joining.expectedJoiningDate}
          </p>
          <p className="text-app-accent font-medium pt-1">
            Workflow: Offer Accepted → Joining Pipeline → Joined → Employee Directory
          </p>
        </div>

        <Select
          label="Joining Lifecycle Status"
          value={status}
          onChange={(val) => {
            const nextStatus = val as JoiningStatus;
            setStatus(nextStatus);
            if (nextStatus === 'joined' && !actualJoiningDate) {
              setActualJoiningDate(new Date().toISOString().split('T')[0] ?? '');
            }
          }}
          disabled={submitting}
          options={[
            { value: 'pending', label: 'Pending Pre-boarding' },
            { value: 'confirmed', label: 'Confirmed (Joining Date Set)' },
            { value: 'joined', label: 'Joined (Active Onboarded)' },
            { value: 'cancelled', label: 'Cancelled / Did Not Join' },
          ]}
        />

        <Field
          label="Actual Joining Date"
          type="date"
          value={actualJoiningDate}
          onChange={setActualJoiningDate}
          disabled={submitting}
        />

        <label className="block text-xs font-semibold text-app-muted">
          <span className="mb-2 block">Joining Notes / Equipment Status</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            disabled={submitting}
            placeholder="Equipment dispatched, statutory forms completed, reporting manager aligned..."
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
          />
        </label>

        {status === 'joined' && onNavigateToEmployees && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-200">
            <p className="font-semibold">Candidate has joined the organization!</p>
            <p className="mt-1">
              You can view and manage their full organizational identity, team, and reporting hierarchy in the
              Employees module.
            </p>
            <button
              type="button"
              onClick={onNavigateToEmployees}
              className="mt-2 text-xs font-bold underline hover:text-emerald-900 dark:hover:text-emerald-100"
            >
              Open Employees Directory ↗
            </button>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3 border-t border-app-border pt-4">
          <Button type="button" kind="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" kind="primary" disabled={submitting}>
            {submitting ? 'Updating...' : 'Save Joining Status'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
