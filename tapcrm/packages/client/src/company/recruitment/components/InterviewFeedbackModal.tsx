import { useState } from 'react';
import { Button, Modal, Notice, Select } from '../../../ui/components.js';
import { submitInterviewFeedback } from '../api/recruitmentApi.js';
import type {
  Interview,
  InterviewFeedback,
  InterviewRecommendation,
} from '../types/index.js';

export function InterviewFeedbackModal({
  interview,
  currentUserId,
  onClose,
  onSubmitted,
}: {
  readonly interview: Interview;
  readonly currentUserId?: string | undefined;
  readonly onClose: () => void;
  readonly onSubmitted: (feedback: InterviewFeedback) => void;
}): React.JSX.Element {
  const [recommendation, setRecommendation] = useState<InterviewRecommendation>('hire');
  const [rating, setRating] = useState('4');
  const [feedback, setFeedback] = useState('');
  const [strengths, setStrengths] = useState('');
  const [areasForImprovement, setAreasForImprovement] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!feedback.trim()) {
      setError('Please provide feedback commentary');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const fb = await submitInterviewFeedback(interview.id, {
        interviewerId: currentUserId ?? 'evaluator-1',
        recommendation,
        rating: rating ? parseInt(rating, 10) : undefined,
        feedback: feedback.trim(),
        strengths: strengths.trim() || undefined,
        areasForImprovement: areasForImprovement.trim() || undefined,
      });

      onSubmitted(fb);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to submit interview feedback');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Submit Interview Feedback: ${interview.candidateName ?? 'Candidate'}`} onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {error && <Notice error>{error}</Notice>}

        <div className="rounded-lg border border-app-border bg-app-surface p-3 text-xs text-app-muted">
          <p>
            <strong className="text-app-foreground">Stage:</strong> {interview.stage} (Round {interview.round}) ·{' '}
            <strong className="text-app-foreground">Role:</strong> {interview.requisitionTitle ?? 'Job Requisition'}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Overall Recommendation"
            value={recommendation}
            onChange={(val) => setRecommendation(val as InterviewRecommendation)}
            disabled={submitting}
            options={[
              { value: 'strong_hire', label: 'Strong Hire (Definite Yes)' },
              { value: 'hire', label: 'Hire (Meets Criteria)' },
              { value: 'hold', label: 'Hold (Needs More Evaluation)' },
              { value: 'no_hire', label: 'No Hire (Does Not Meet Criteria)' },
              { value: 'strong_no_hire', label: 'Strong No Hire (Reject)' },
            ]}
          />

          <Select
            label="Evaluation Rating (1 - 5 Stars)"
            value={rating}
            onChange={setRating}
            disabled={submitting}
            options={[
              { value: '5', label: '5 ★ — Exceptional' },
              { value: '4', label: '4 ★ — Strong' },
              { value: '3', label: '3 ★ — Acceptable / Baseline' },
              { value: '2', label: '2 ★ — Below Expectations' },
              { value: '1', label: '1 ★ — Poor' },
            ]}
          />
        </div>

        <label className="block text-xs font-semibold text-app-muted">
          <span className="mb-2 block">Detailed Evaluation &amp; Feedback</span>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={4}
            required
            disabled={submitting}
            placeholder="Assess technical depth, problem-solving ability, communication, culture alignment..."
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
          />
        </label>

        <label className="block text-xs font-semibold text-app-muted">
          <span className="mb-2 block">Key Strengths Demonstrated</span>
          <textarea
            value={strengths}
            onChange={(e) => setStrengths(e.target.value)}
            rows={2}
            disabled={submitting}
            placeholder="e.g. Exceptional system design, deep understanding of indexing, clear communicator..."
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
          />
        </label>

        <label className="block text-xs font-semibold text-app-muted">
          <span className="mb-2 block">Areas for Development / Growth</span>
          <textarea
            value={areasForImprovement}
            onChange={(e) => setAreasForImprovement(e.target.value)}
            rows={2}
            disabled={submitting}
            placeholder="e.g. Needs familiarity with our cloud architecture / limited exposure to distributed queues..."
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
          />
        </label>

        <div className="mt-6 flex justify-end gap-3 border-t border-app-border pt-4">
          <Button type="button" kind="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" kind="primary" disabled={submitting}>
            {submitting ? 'Submitting...' : 'Submit Feedback'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
