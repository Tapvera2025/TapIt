import { useEffect, useState } from 'react';
import { Card, Empty, Loading, Notice, Page } from '../../../ui/components.js';
import {
  getInterviewResume,
  listMyInterviews,
  saveMyInterviewFeedback,
  submitRoundFeedback,
} from '../api/recruitmentApi.js';
import type {
  AssignedInterview,
  AssignedPanelInterview,
  CandidateRound,
  InterviewFeedback,
  InterviewRecommendation,
  MyInterviews,
  RoundRecommendation,
  SubmitRoundFeedbackInput,
} from '../types/index.js';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  scheduled: 'Scheduled',
  completed: 'Completed',
  passed: 'Passed',
  failed: 'Failed',
  skipped: 'Skipped',
  no_show: 'No show',
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400',
  scheduled: 'bg-blue-500/10 border-blue-500/20 text-blue-700 dark:text-blue-400',
  completed: 'bg-app-accent/10 border-app-accent/20 text-app-accent',
  passed: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400',
  failed: 'bg-red-500/10 border-red-500/20 text-red-700 dark:text-red-400',
  skipped: 'bg-app-border/40 border-app-border text-app-muted',
  no_show: 'bg-app-border/40 border-app-border text-app-muted',
};

const STAGE_LABEL: Record<string, string> = {
  screening: 'Screening',
  technical: 'Technical',
  managerial: 'Managerial',
  hr: 'HR',
  final: 'Final',
};

const TYPE_LABEL: Record<string, string> = {
  in_person: 'In person',
  video: 'Video',
  phone: 'Phone',
};

const RECOMMENDATION_LABEL: Record<InterviewRecommendation, string> = {
  strong_hire: 'Strong hire',
  hire: 'Hire',
  hold: 'Hold',
  no_hire: 'No hire',
  strong_no_hire: 'Strong no hire',
};

const RECOMMENDATION_COLOR: Record<InterviewRecommendation, string> = {
  strong_hire: 'text-emerald-600',
  hire: 'text-emerald-600',
  hold: 'text-amber-600',
  no_hire: 'text-red-600',
  strong_no_hire: 'text-red-600',
};

const INPUT_CLASS =
  'w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm text-app-foreground outline-none focus:border-app-accent';

function formatWhen(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function isWebLink(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

/** Rounds and panel interviews on one list, in time order. */
type Entry =
  | { readonly kind: 'round'; readonly item: AssignedInterview }
  | { readonly kind: 'interview'; readonly item: AssignedPanelInterview };

function entryTime(entry: Entry): number {
  const value = entry.item.scheduledAt;
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

function isUpcoming(entry: Entry): boolean {
  return entry.kind === 'round'
    ? entry.item.status === 'pending' || entry.item.status === 'scheduled'
    : entry.item.status === 'scheduled';
}

export function MyInterviewsPage(): React.JSX.Element {
  const [mine, setMine] = useState<MyInterviews>({ rounds: [], interviews: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedbackTarget, setFeedbackTarget] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listMyInterviews()
      .then((data) => {
        if (!cancelled) setMine(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load your interviews');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const entries: Entry[] = [
    ...mine.rounds.map((item): Entry => ({ kind: 'round', item })),
    ...mine.interviews.map((item): Entry => ({ kind: 'interview', item })),
  ];
  const upcoming = entries.filter(isUpcoming).sort((a, b) => entryTime(a) - entryTime(b));
  const done = entries.filter((entry) => !isUpcoming(entry)).sort((a, b) => entryTime(b) - entryTime(a));

  function roundSaved(updated: CandidateRound) {
    // The saved round lacks the candidate and job; keep them.
    setMine((prev) => ({ ...prev, rounds: prev.rounds.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)) }));
    setFeedbackTarget(null);
  }

  function interviewFeedbackSaved(interviewId: string, feedback: InterviewFeedback) {
    // The first feedback completes a scheduled interview, as on the server.
    setMine((prev) => ({
      ...prev,
      interviews: prev.interviews.map((i) =>
        i.id === interviewId ? { ...i, myFeedback: feedback, status: i.status === 'scheduled' ? 'completed' : i.status } : i,
      ),
    }));
    setFeedbackTarget(null);
  }

  function renderEntry(entry: Entry): React.JSX.Element {
    const key = `${entry.kind}:${entry.item.id}`;
    const common = {
      feedbackOpen: feedbackTarget === key,
      onOpenFeedback: () => setFeedbackTarget(key),
      onCancelFeedback: () => setFeedbackTarget(null),
    };
    return entry.kind === 'round' ? (
      <RoundCard key={key} round={entry.item} {...common} onFeedbackSubmitted={roundSaved} />
    ) : (
      <PanelInterviewCard
        key={key}
        interview={entry.item}
        {...common}
        onFeedbackSaved={(feedback) => interviewFeedbackSaved(entry.item.id, feedback)}
      />
    );
  }

  return (
    <Page
      eyebrow="Recruitment"
      title="My Interviews"
      description="Interviews you are on the panel for, and interview rounds assigned to you. Review the brief and the resume, conduct the interview, then give your feedback."
    >
      {error && (
        <div className="mt-6">
          <Notice error>{error}</Notice>
        </div>
      )}

      {loading ? (
        <div className="mt-6">
          <Loading />
        </div>
      ) : entries.length === 0 ? (
        <Empty>You have no interviews right now.</Empty>
      ) : (
        <div className="mt-6 space-y-8">
          {upcoming.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-app-muted">
                Upcoming ({upcoming.length})
              </h2>
              <div className="space-y-4">{upcoming.map(renderEntry)}</div>
            </section>
          )}

          {done.length > 0 && (
            <section>
              {/* Feedback can still be changed until HR decides. */}
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-app-muted">
                Completed ({done.length})
              </h2>
              <div className="space-y-4">{done.map(renderEntry)}</div>
            </section>
          )}
        </div>
      )}
    </Page>
  );
}

function StatusChip({ status }: { readonly status: string }): React.JSX.Element {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${
        STATUS_COLOR[status] ?? STATUS_COLOR['pending']
      }`}
    >
      ● {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function ResumeButton({ kind, id }: { readonly kind: 'round' | 'interview'; readonly id: string }): React.JSX.Element {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openResume() {
    setOpening(true);
    setError(null);
    try {
      const blob = await getInterviewResume(kind, id);
      window.open(URL.createObjectURL(blob), '_blank', 'noopener,noreferrer');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The resume could not be opened.');
    } finally {
      setOpening(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        onClick={() => { void openResume(); }}
        disabled={opening}
        className="rounded-lg border border-app-border px-3 py-1.5 text-xs font-semibold text-app-foreground hover:bg-app-surface disabled:opacity-50"
      >
        {opening ? 'Opening…' : 'View Resume'}
      </button>
      {error && <span className="mt-1 text-xs text-app-danger" role="alert">{error}</span>}
    </span>
  );
}

function FeedbackButton({ hasFeedback, onClick }: { readonly hasFeedback: boolean; readonly onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-app-accent/40 bg-app-accent/10 px-3 py-1.5 text-xs font-semibold text-app-accent hover:bg-app-accent/20"
    >
      {hasFeedback ? 'Update Feedback' : 'Submit Feedback'}
    </button>
  );
}

function FormButtons({ submitting, onCancel }: { readonly submitting: boolean; readonly onCancel: () => void }): React.JSX.Element {
  return (
    <div className="flex justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        disabled={submitting}
        className="rounded-lg border border-app-border px-4 py-2 text-xs font-semibold text-app-foreground hover:bg-app-surface"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={submitting}
        className="rounded-lg bg-app-accent px-4 py-2 text-xs font-semibold text-app-on-accent hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? 'Saving…' : 'Save Feedback'}
      </button>
    </div>
  );
}

function FormError({ error }: { readonly error: string | null }): React.JSX.Element | null {
  if (!error) return null;
  return (
    <p className="rounded-lg border border-[#d86b6b]/30 bg-[#d86b6b]/10 px-3 py-2 text-xs text-app-danger" role="alert">
      {error}
    </p>
  );
}

/* ------------------------------------------------------------------ *
 * Scheduled interviews (the panel)
 * ------------------------------------------------------------------ */

function PanelInterviewCard({
  interview,
  feedbackOpen,
  onOpenFeedback,
  onCancelFeedback,
  onFeedbackSaved,
}: {
  readonly interview: AssignedPanelInterview;
  readonly feedbackOpen: boolean;
  readonly onOpenFeedback: () => void;
  readonly onCancelFeedback: () => void;
  readonly onFeedbackSaved: (feedback: InterviewFeedback) => void;
}): React.JSX.Element {
  const canGiveFeedback = interview.status === 'scheduled' || interview.status === 'completed';
  const feedback = interview.myFeedback;
  const when = formatWhen(interview.scheduledAt);
  const place = interview.locationOrLink?.trim();

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-app-accent">
              {STAGE_LABEL[interview.stage] ?? interview.stage} · Round {interview.round}
            </span>
            <StatusChip status={interview.status} />
          </div>
          <h3 className="mt-1 font-semibold text-app-foreground">{interview.candidateName}</h3>
          <p className="mt-0.5 text-sm text-app-muted">
            {interview.requisitionTitle} ({interview.requisitionNumber})
          </p>
          <p className="mt-1 text-xs text-app-muted">
            {TYPE_LABEL[interview.interviewType] ?? interview.interviewType} · {interview.durationMinutes} min
            {when ? ` · ${when}` : ''}
          </p>
          {place && (
            <p className="mt-0.5 truncate text-xs text-app-muted">
              {isWebLink(place) ? (
                <>
                  Meeting:{' '}
                  <a href={place} target="_blank" rel="noopener noreferrer" className="font-mono text-app-accent hover:underline">
                    {place}
                  </a>
                </>
              ) : (
                <>Location: {place}</>
              )}
            </p>
          )}
          {interview.panel.length > 0 && (
            <p className="mt-0.5 text-xs text-app-muted">Panel: {interview.panel.join(', ')}</p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-start gap-2">
          {interview.hasResume && <ResumeButton kind="interview" id={interview.id} />}
          {canGiveFeedback && !feedbackOpen && <FeedbackButton hasFeedback={!!feedback} onClick={onOpenFeedback} />}
        </div>
      </div>

      {interview.notes && (
        <div className="mt-3 rounded-lg border border-app-border bg-app-background p-3 text-xs">
          <p className="font-semibold text-app-muted">Notes from HR</p>
          <p className="mt-1 whitespace-pre-line text-app-foreground">{interview.notes}</p>
        </div>
      )}

      {feedback && !feedbackOpen && (
        <div className="mt-3 space-y-1 rounded-lg border border-app-border bg-app-background p-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-app-muted">Your recommendation:</span>
            <span className={`font-bold uppercase ${RECOMMENDATION_COLOR[feedback.recommendation]}`}>
              {RECOMMENDATION_LABEL[feedback.recommendation]}
            </span>
            {feedback.rating ? <span className="text-app-muted">· Rating: {feedback.rating}/5</span> : null}
          </div>
          <p className="whitespace-pre-line text-app-foreground">{feedback.feedback}</p>
          {feedback.strengths && (
            <p className="text-app-foreground"><span className="font-semibold text-app-muted">Strengths: </span>{feedback.strengths}</p>
          )}
          {feedback.areasForImprovement && (
            <p className="text-app-foreground"><span className="font-semibold text-app-muted">To improve: </span>{feedback.areasForImprovement}</p>
          )}
        </div>
      )}

      {feedbackOpen && (
        <PanelFeedbackForm interview={interview} onSaved={onFeedbackSaved} onCancel={onCancelFeedback} />
      )}
    </Card>
  );
}

function PanelFeedbackForm({
  interview,
  onSaved,
  onCancel,
}: {
  readonly interview: AssignedPanelInterview;
  readonly onSaved: (feedback: InterviewFeedback) => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const previous = interview.myFeedback;
  const [recommendation, setRecommendation] = useState<InterviewRecommendation | ''>(previous?.recommendation ?? '');
  const [rating, setRating] = useState(previous?.rating ? String(previous.rating) : '');
  const [comments, setComments] = useState(previous?.feedback ?? '');
  const [strengths, setStrengths] = useState(previous?.strengths ?? '');
  const [areas, setAreas] = useState(previous?.areasForImprovement ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!recommendation) {
      setError('Choose a recommendation.');
      return;
    }
    if (!comments.trim()) {
      setError('Write your feedback on the interview.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const saved = await saveMyInterviewFeedback(interview.id, {
        recommendation,
        rating: rating ? parseInt(rating, 10) : null,
        feedback: comments.trim(),
        strengths: strengths.trim() || null,
        areasForImprovement: areas.trim() || null,
      });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your feedback could not be saved.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 space-y-3 border-t border-app-border pt-4">
      <p className="text-xs font-bold uppercase tracking-wider text-app-muted">Your Feedback</p>
      <FormError error={error} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-app-muted">Recommendation *</span>
          <select
            value={recommendation}
            onChange={(e) => setRecommendation(e.target.value as InterviewRecommendation | '')}
            disabled={submitting}
            className={INPUT_CLASS}
          >
            <option value="">Choose…</option>
            <option value="strong_hire">Strong hire — a definite yes</option>
            <option value="hire">Hire — meets the bar</option>
            <option value="hold">Hold — needs more evaluation</option>
            <option value="no_hire">No hire — does not meet the bar</option>
            <option value="strong_no_hire">Strong no hire</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-app-muted">Rating (1–5)</span>
          <select value={rating} onChange={(e) => setRating(e.target.value)} disabled={submitting} className={INPUT_CLASS}>
            <option value="">No rating</option>
            <option value="5">5 — Exceptional</option>
            <option value="4">4 — Strong</option>
            <option value="3">3 — Acceptable</option>
            <option value="2">2 — Below expectations</option>
            <option value="1">1 — Poor</option>
          </select>
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-app-muted">Feedback *</span>
        <textarea
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          disabled={submitting}
          rows={4}
          placeholder="Technical depth, problem solving, communication, and anything HR should know…"
          className={INPUT_CLASS}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-app-muted">Strengths</span>
          <textarea value={strengths} onChange={(e) => setStrengths(e.target.value)} disabled={submitting} rows={2} className={INPUT_CLASS} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-app-muted">Areas to improve</span>
          <textarea value={areas} onChange={(e) => setAreas(e.target.value)} disabled={submitting} rows={2} className={INPUT_CLASS} />
        </label>
      </div>

      <FormButtons submitting={submitting} onCancel={onCancel} />
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Pipeline rounds
 * ------------------------------------------------------------------ */

function RoundCard({
  round,
  feedbackOpen,
  onOpenFeedback,
  onCancelFeedback,
  onFeedbackSubmitted,
}: {
  readonly round: AssignedInterview;
  readonly feedbackOpen: boolean;
  readonly onOpenFeedback: () => void;
  readonly onCancelFeedback: () => void;
  readonly onFeedbackSubmitted: (updated: CandidateRound) => void;
}): React.JSX.Element {
  const canSubmitFeedback = round.status === 'pending' || round.status === 'scheduled' || round.status === 'completed';
  const hasFeedback = !!round.recommendation;
  const when = formatWhen(round.scheduledAt);

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-app-accent">
              Round {round.pipelineRoundOrder ?? '?'}
            </span>
            <StatusChip status={round.status} />
          </div>
          <h3 className="mt-1 font-semibold text-app-foreground">
            {round.pipelineRoundName ?? 'Interview Round'}
          </h3>
          <p className="mt-0.5 text-sm text-app-foreground">
            {round.candidateName}
            <span className="text-app-muted"> · {round.requisitionTitle} ({round.requisitionNumber})</span>
          </p>
          {when && <p className="mt-0.5 text-xs text-app-muted">Scheduled: {when}</p>}
          {round.meetingLink && (
            <p className="mt-0.5 truncate text-xs text-app-muted">
              Meeting:{' '}
              <a
                href={round.meetingLink}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-app-accent hover:underline"
              >
                {round.meetingLink}
              </a>
            </p>
          )}
          {round.location && (
            <p className="mt-0.5 text-xs text-app-muted">Location: {round.location}</p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-start gap-2">
          {round.hasResume && <ResumeButton kind="round" id={round.id} />}
          {canSubmitFeedback && !feedbackOpen && <FeedbackButton hasFeedback={hasFeedback} onClick={onOpenFeedback} />}
        </div>
      </div>

      {round.interviewerBrief && (
        <div className="mt-3 rounded-lg border border-app-border bg-app-background p-3 text-xs">
          <p className="font-semibold text-app-muted">Brief for interviewers</p>
          <p className="mt-1 whitespace-pre-line text-app-foreground">{round.interviewerBrief}</p>
        </div>
      )}

      {hasFeedback && !feedbackOpen && (
        <div className="mt-3 space-y-1 rounded-lg border border-app-border bg-app-background p-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-app-muted">Your recommendation:</span>
            <span
              className={`font-bold uppercase ${
                round.recommendation === 'pass'
                  ? 'text-emerald-600'
                  : round.recommendation === 'fail'
                    ? 'text-red-600'
                    : 'text-amber-600'
              }`}
            >
              {round.recommendation}
            </span>
            {round.rating ? <span className="text-app-muted">· Rating: {round.rating}/5</span> : null}
          </div>
          {round.interviewerNotes && (
            <p className="text-app-foreground">{round.interviewerNotes}</p>
          )}
        </div>
      )}

      {feedbackOpen && (
        <RoundFeedbackForm
          round={round}
          onSubmitted={onFeedbackSubmitted}
          onCancel={onCancelFeedback}
        />
      )}
    </Card>
  );
}

function RoundFeedbackForm({
  round,
  onSubmitted,
  onCancel,
}: {
  readonly round: CandidateRound;
  readonly onSubmitted: (updated: CandidateRound) => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const [notes, setNotes] = useState(round.interviewerNotes ?? '');
  const [rating, setRating] = useState(String(round.rating ?? ''));
  const [recommendation, setRecommendation] = useState<RoundRecommendation>(
    round.recommendation ?? 'pass',
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const input: SubmitRoundFeedbackInput = {
        recommendation,
        interviewerNotes: notes.trim() || null,
        rating: rating ? parseInt(rating, 10) : null,
      };
      const updated = await submitRoundFeedback(round.candidateId, round.id, input);
      onSubmitted(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit feedback');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 space-y-3 border-t border-app-border pt-4">
      <p className="text-xs font-bold uppercase tracking-wider text-app-muted">Submit Feedback</p>
      <FormError error={error} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-app-muted">Recommendation *</span>
          <select
            value={recommendation}
            onChange={(e) => setRecommendation(e.target.value as RoundRecommendation)}
            disabled={submitting}
            className={INPUT_CLASS}
          >
            <option value="pass">Pass — Recommend advancing</option>
            <option value="fail">Fail — Do not advance</option>
            <option value="hold">Hold — Needs further review</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-app-muted">Rating (1–5)</span>
          <select value={rating} onChange={(e) => setRating(e.target.value)} disabled={submitting} className={INPUT_CLASS}>
            <option value="">No rating</option>
            <option value="1">1 — Poor</option>
            <option value="2">2 — Below average</option>
            <option value="3">3 — Average</option>
            <option value="4">4 — Good</option>
            <option value="5">5 — Excellent</option>
          </select>
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-app-muted">Interview Notes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={submitting}
          rows={4}
          placeholder="Technical assessment, behavioural observations, candidate strengths and concerns..."
          className={INPUT_CLASS}
        />
      </label>

      <FormButtons submitting={submitting} onCancel={onCancel} />
    </form>
  );
}
