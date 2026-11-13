import { useState } from 'react';
import { Button, Card, Field, Select } from '../../../ui/index.js';
import { markLeadLost, updateLeadStatus, type Lead } from './api.js';
import {
  isClosedLeadStatus,
  leadStatusLabel,
  leadStatusMeaning,
  LOSS_REASON_OPTIONS,
  lossReasonLabel,
  statusMoveOptions,
} from './lead-status.js';

/** Shows a lead's status and lets an editor move it on or mark it lost. */
export function LeadStatusPanel({
  lead,
  canEdit,
  lockedNote,
  onChanged,
}: {
  lead: Lead;
  canEdit: boolean;
  /** Why the viewer can see the status but not change it (a handed-over lead). */
  lockedNote?: string | undefined;
  onChanged: () => Promise<void>;
}): React.JSX.Element {
  const [nextStatus, setNextStatus] = useState('');
  const [markingLost, setMarkingLost] = useState(false);
  const [lossReason, setLossReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const closed = isClosedLeadStatus(lead.status);
  const moves = statusMoveOptions(lead.status);
  const noteRequired = lossReason === 'other';

  function resetLost(): void {
    setMarkingLost(false);
    setLossReason('');
    setNote('');
  }

  async function run(action: () => Promise<unknown>, after: () => void): Promise<void> {
    setBusy(true);
    setError('');
    try {
      await action();
      after();
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the lead.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="font-display text-lg font-bold">Status</h2>
      <p className="mt-2 text-sm font-semibold">
        {leadStatusLabel(lead.status)}
        {lead.status === 'closed_lost' && lead.lossReason
          ? ` · ${lossReasonLabel(lead.lossReason)}`
          : ''}
      </p>
      {leadStatusMeaning(lead.status) && (
        <p className="mt-1 text-xs text-app-muted">{leadStatusMeaning(lead.status)}</p>
      )}
      {error && (
        <p className="mt-2 text-xs text-app-danger" role="alert">
          {error}
        </p>
      )}
      {closed && (
        <p className="mt-3 text-xs text-app-muted">
          This lead is closed, so its status can't change.
        </p>
      )}
      {!closed && lockedNote && (
        <p className="mt-3 rounded-lg bg-app-background p-3 text-xs text-app-muted">{lockedNote}</p>
      )}
      {!closed && canEdit && (
        <div className="mt-4 space-y-4">
          {moves.length > 0 && (
            <div className="space-y-2">
              <Select
                label="Move the lead to"
                placeholder="Choose a status"
                value={nextStatus}
                onChange={setNextStatus}
                options={moves}
              />
              <Button
                kind="secondary"
                disabled={!nextStatus || busy}
                onClick={() =>
                  void run(
                    () => updateLeadStatus(lead.id, nextStatus),
                    () => setNextStatus(''),
                  )
                }
              >
                Move it
              </Button>
            </div>
          )}
          {markingLost ? (
            <div className="space-y-2 border-t border-app-border pt-4">
              <Select
                label="Why was it lost?"
                placeholder="Choose a reason"
                value={lossReason}
                onChange={setLossReason}
                options={[...LOSS_REASON_OPTIONS]}
              />
              <Field
                label={noteRequired ? 'Note (required for Other)' : 'Note (optional)'}
                value={note}
                onChange={setNote}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  kind="danger"
                  disabled={!lossReason || (noteRequired && !note.trim()) || busy}
                  onClick={() =>
                    void run(
                      () =>
                        markLeadLost(lead.id, {
                          lossReason,
                          note: note.trim() || undefined,
                        }),
                      resetLost,
                    )
                  }
                >
                  Mark lost
                </Button>
                <Button kind="secondary" disabled={busy} onClick={resetLost}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button kind="danger" disabled={busy} onClick={() => setMarkingLost(true)}>
              Mark as lost
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
