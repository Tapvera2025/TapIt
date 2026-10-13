import { useState } from 'react';
import { Button, Modal, Notice } from '../../../ui/components.js';
import { cancelPenalty } from '../api/penaltiesApi.js';
import { PENALTY_LABELS, type Penalty } from '../types/index.js';

const money = (paise: string): string =>
  `₹${(Number(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

export function PenaltyCancelModal({
  penalty,
  onClose,
  onCancelled,
}: {
  penalty: Penalty;
  onClose: () => void;
  onCancelled: () => Promise<void>;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function confirm(): Promise<void> {
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setError('Cancellation reason must be at least 3 characters.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await cancelPenalty(penalty.id, trimmed);
      await onCancelled();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to cancel penalty.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Cancel Penalty" onClose={saving ? () => undefined : onClose} dirty={reason.trim().length > 0}>
      {error && <Notice error>{error}</Notice>}
      <dl className="grid gap-4 rounded-lg border border-app-border bg-app-surface-raised p-4 sm:grid-cols-3">
        <div><dt className="text-xs text-app-muted">Employee</dt><dd className="mt-1 font-semibold">{penalty.employeeName}</dd></div>
        <div><dt className="text-xs text-app-muted">Amount</dt><dd className="mt-1 font-semibold">{money(penalty.amountPaise)}</dd></div>
        <div><dt className="text-xs text-app-muted">Penalty type</dt><dd className="mt-1 font-semibold">{PENALTY_LABELS[penalty.penaltyType]}</dd></div>
      </dl>
      <label className="mt-5 block text-xs font-semibold text-app-muted">
        <span className="mb-2 block">Cancellation Reason *</span>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={4}
          disabled={saving}
          className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent disabled:opacity-60"
          placeholder="Explain why this penalty is being cancelled."
        />
      </label>
      <div className="mt-5 flex justify-end gap-2">
        <Button kind="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button kind="danger" onClick={() => void confirm()} disabled={saving}>
          {saving ? 'Cancelling…' : 'Confirm Cancellation'}
        </Button>
      </div>
    </Modal>
  );
}
