import { useState } from 'react';
import { Button, Modal, Notice, Select } from '../../../ui/components.js';
import { recordInterviewDecision } from '../api/recruitmentApi.js';
import type { Interview } from '../types/index.js';

export function InterviewDecisionModal({
  interview,
  onClose,
  onDecisionRecorded,
}: {
  readonly interview: Interview;
  readonly onClose: () => void;
  readonly onDecisionRecorded: (decision: 'accepted' | 'rejected') => void;
}): React.JSX.Element {
  const [decision, setDecision] = useState<'accepted' | 'rejected'>('accepted');
  const [rejectionReason, setRejectionReason] = useState('');
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await recordInterviewDecision(interview.id, {
        decision,
        rejectionReason: decision === 'rejected' ? rejectionReason.trim() || undefined : undefined,
        notes: notes.trim() || undefined,
      });

      onDecisionRecorded(decision);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to record interview decision');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={`Record Interview Decision — ${interview.candidateName ?? 'Candidate'} (Round ${interview.round})`}
      onClose={onClose}
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {error && <Notice error>{error}</Notice>}

        <Select
          label="Evaluation Decision *"
          value={decision}
          onChange={(val) => setDecision(val as 'accepted' | 'rejected')}
          disabled={submitting}
          options={[
            { value: 'accepted', label: '✓ Accept / Selected (Advance to Offer)' },
            { value: 'rejected', label: '✕ Reject Candidate' },
          ]}
        />

        {decision === 'rejected' && (
          <label className="block text-xs font-semibold text-app-muted">
            <span className="mb-2 block">Rejection Reason (Internal Record)</span>
            <textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              disabled={submitting}
              rows={2}
              placeholder="e.g. Lacks required technical depth in distributed systems..."
              className="w-full rounded-lg border border-app-border bg-app-background p-2.5 text-xs text-app-foreground outline-none focus:border-rose-500"
            />
          </label>
        )}

        <label className="block text-xs font-semibold text-app-muted">
          <span className="mb-2 block">Final Evaluation Notes / Summary</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={submitting}
            rows={3}
            placeholder="Document interview panel summary, leadership remarks, or offer recommendations..."
            className="w-full rounded-lg border border-app-border bg-app-background p-2.5 text-xs text-app-foreground outline-none focus:border-app-accent"
          />
        </label>

        {decision === 'accepted' ? (
          <p className="text-xs text-emerald-700 dark:text-emerald-300">
            Accepting the candidate will advance their status to <strong>Selected</strong> and make
            them eligible for a formal Job Offer.
          </p>
        ) : (
          <p className="text-xs text-rose-700 dark:text-rose-300">
            Rejecting the candidate will update their status to <strong>Rejected</strong> and queue
            a respectful rejection notification email.
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-app-border pt-4">
          <Button kind="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            kind="primary"
            type="submit"
            disabled={submitting}
            className={decision === 'rejected' ? 'bg-rose-600 hover:bg-rose-700 text-white' : ''}
          >
            {submitting ? 'Recording...' : decision === 'accepted' ? 'Confirm Selection' : 'Confirm Rejection'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
