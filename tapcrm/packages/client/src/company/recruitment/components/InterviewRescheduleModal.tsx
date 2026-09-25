import { useState } from 'react';
import { Button, Field, Modal, Notice } from '../../../ui/components.js';
import { rescheduleInterview } from '../api/recruitmentApi.js';
import type { Interview } from '../types/index.js';

export function InterviewRescheduleModal({
  interview,
  onClose,
  onRescheduled,
}: {
  readonly interview: Interview;
  readonly onClose: () => void;
  readonly onRescheduled: (rescheduled: Interview) => void;
}): React.JSX.Element {
  const [scheduledAt, setScheduledAt] = useState(() => {
    const d = new Date(Date.now() + 48 * 3600000);
    d.setMinutes(0, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [durationMinutes, setDurationMinutes] = useState(
    String(interview.durationMinutes || 60),
  );
  const [locationOrLink, setLocationOrLink] = useState(
    interview.locationOrLink ?? 'https://meet.google.com/',
  );
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!scheduledAt) {
      setError('Please select a new interview date and time.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await rescheduleInterview(interview.id, {
        scheduledAt: new Date(scheduledAt).toISOString(),
        durationMinutes: parseInt(durationMinutes, 10) || 60,
        locationOrLink: locationOrLink.trim() || null,
        notes: notes.trim() || undefined,
      });

      onRescheduled(res.interview);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to reschedule interview');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={`Reschedule Interview — Round ${interview.round} (${interview.stage.toUpperCase()})`}
      onClose={onClose}
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {error && <Notice error>{error}</Notice>}

        <p className="text-xs text-app-muted">
          Selecting a new interview date/time will update the schedule and automatically dispatch
          an email notification with the revised timing to the candidate.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="New Date & Time *"
            type="datetime-local"
            value={scheduledAt}
            onChange={setScheduledAt}
            required
            disabled={submitting}
          />

          <Field
            label="Duration (Minutes) *"
            type="number"
            value={durationMinutes}
            onChange={setDurationMinutes}
            required
            disabled={submitting}
          />
        </div>

        <Field
          label="Meeting Link / Location"
          value={locationOrLink}
          onChange={setLocationOrLink}
          disabled={submitting}
          placeholder="Google Meet, Zoom, or Office Room"
        />

        <label className="block text-xs font-semibold text-app-muted">
          <span className="mb-2 block">Reschedule Reason / Panel Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={submitting}
            rows={3}
            placeholder="Reason for rescheduling (e.g. interviewer conflict, candidate requested change)..."
            className="w-full rounded-lg border border-app-border bg-app-background p-2.5 text-xs text-app-foreground outline-none focus:border-app-accent"
          />
        </label>

        <div className="flex justify-end gap-2 border-t border-app-border pt-4">
          <Button kind="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button kind="primary" type="submit" disabled={submitting}>
            {submitting ? 'Rescheduling...' : 'Confirm Reschedule'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
