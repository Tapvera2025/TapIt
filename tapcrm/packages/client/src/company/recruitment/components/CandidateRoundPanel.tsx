import { useEffect, useState } from 'react';
import { Button } from '../../../ui/components.js';
import { Icon } from '../../../ui/Icon.js';
import { getCompanyEmployees, type CompanyEmployee } from '../../api/companyApi.js';
import {
  assignRoundInterviewer,
  createCandidateRound,
  listCandidateRounds,
  listPipelineRounds,
  recordRoundDecision,
  submitRoundFeedback,
} from '../api/recruitmentApi.js';
import type {
  AssignRoundInterviewerInput,
  CandidateRound,
  CandidateRoundStatus,
  PipelineRound,
  PipelineRoundMode,
  RoundDecisionInput,
  RoundRecommendation,
  SubmitRoundFeedbackInput,
} from '../types/index.js';

const STATUS_BADGE: Record<
  CandidateRoundStatus,
  { label: string; className: string }
> = {
  pending: { label: 'Pending', className: 'bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400' },
  scheduled: { label: 'Scheduled', className: 'bg-blue-500/10 border-blue-500/20 text-blue-700 dark:text-blue-400' },
  completed: { label: 'Completed', className: 'bg-app-accent/10 border-app-accent/20 text-app-accent' },
  passed: { label: 'Passed', className: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400' },
  failed: { label: 'Failed', className: 'bg-red-500/10 border-red-500/20 text-red-700 dark:text-red-400' },
  skipped: { label: 'Skipped', className: 'bg-app-border/40 border-app-border text-app-muted' },
};

const MODE_LABELS: Record<PipelineRoundMode, string> = {
  online: 'Online',
  offline: 'In-Person',
  phone: 'Phone',
};

function AssignInterviewerForm({
  round,
  employees,
  onAssigned,
  onCancel,
}: {
  readonly round: CandidateRound;
  readonly employees: CompanyEmployee[];
  readonly onAssigned: (updated: CandidateRound) => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const [assignedTo, setAssignedTo] = useState(round.assignedTo ?? '');
  const [scheduledAt, setScheduledAt] = useState(round.scheduledAt?.slice(0, 16) ?? '');
  const [mode, setMode] = useState<PipelineRoundMode>(round.mode ?? 'online');
  const [meetingLink, setMeetingLink] = useState(round.meetingLink ?? '');
  const [location, setLocation] = useState(round.location ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!assignedTo) {
      setError('Select an interviewer.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const input: AssignRoundInterviewerInput = {
        assignedTo,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        mode,
        meetingLink: meetingLink.trim() || null,
        location: location.trim() || null,
      };
      const updated = await assignRoundInterviewer(round.candidateId, round.id, input);
      onAssigned(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign interviewer');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSave(e)} className="mt-3 space-y-3 rounded-lg border border-app-accent/30 bg-app-background p-3">
      {error && (
        <p className="text-xs text-app-danger">{error}</p>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold text-app-muted">Interviewer *</label>
          <select
            value={assignedTo}
            onChange={(e) => setAssignedTo(e.target.value)}
            disabled={submitting}
            required
            className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-xs text-app-foreground outline-none focus:border-app-accent"
          >
            <option value="">Select employee...</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.fullName} {emp.positionName ? `(${emp.positionName})` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-app-muted">Schedule Date/Time</label>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            disabled={submitting}
            className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-xs text-app-foreground outline-none focus:border-app-accent"
          />
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold text-app-muted">Mode</label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as PipelineRoundMode)}
            disabled={submitting}
            className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-xs text-app-foreground outline-none focus:border-app-accent"
          >
            <option value="online">Online</option>
            <option value="offline">In-Person</option>
            <option value="phone">Phone</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-app-muted">
            {mode === 'offline' ? 'Location' : 'Meeting Link'}
          </label>
          {mode === 'offline' ? (
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              disabled={submitting}
              placeholder="e.g. Conference Room B, Floor 3"
              className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-xs text-app-foreground outline-none focus:border-app-accent"
            />
          ) : (
            <input
              value={meetingLink}
              onChange={(e) => setMeetingLink(e.target.value)}
              disabled={submitting}
              placeholder="https://meet.google.com/..."
              className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-xs text-app-foreground outline-none focus:border-app-accent"
            />
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={submitting} className="rounded px-3 py-1.5 text-xs text-app-muted hover:text-app-foreground">
          Cancel
        </button>
        <button type="submit" disabled={submitting} className="rounded-lg bg-app-accent px-3 py-1.5 text-xs font-semibold text-app-on-accent hover:opacity-90 disabled:opacity-50">
          {submitting ? 'Assigning...' : 'Assign Interviewer'}
        </button>
      </div>
    </form>
  );
}

function FeedbackFormInline({
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
  const [recommendation, setRecommendation] = useState<RoundRecommendation>(round.recommendation ?? 'pass');
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
      setError(err instanceof Error ? err.message : 'Failed to save feedback');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="mt-3 space-y-3 rounded-lg border border-app-border bg-app-background p-3">
      <p className="text-xs font-bold uppercase tracking-wider text-app-muted">Interviewer Feedback</p>
      {error && <p className="text-xs text-app-danger">{error}</p>}

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold text-app-muted">Recommendation *</label>
          <select
            value={recommendation}
            onChange={(e) => setRecommendation(e.target.value as RoundRecommendation)}
            disabled={submitting}
            className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-xs text-app-foreground outline-none focus:border-app-accent"
          >
            <option value="pass">Pass</option>
            <option value="fail">Fail</option>
            <option value="hold">Hold / Needs review</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-app-muted">Rating (1–5)</label>
          <select
            value={rating}
            onChange={(e) => setRating(e.target.value)}
            disabled={submitting}
            className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-xs text-app-foreground outline-none focus:border-app-accent"
          >
            <option value="">—</option>
            <option value="1">1 — Poor</option>
            <option value="2">2 — Below average</option>
            <option value="3">3 — Average</option>
            <option value="4">4 — Good</option>
            <option value="5">5 — Excellent</option>
          </select>
        </div>
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        disabled={submitting}
        rows={3}
        placeholder="Interview observations, technical assessment, behavioural notes..."
        className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-xs text-app-foreground outline-none focus:border-app-accent"
      />

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={submitting} className="rounded px-3 py-1.5 text-xs text-app-muted hover:text-app-foreground">
          Cancel
        </button>
        <button type="submit" disabled={submitting} className="rounded-lg bg-app-accent px-3 py-1.5 text-xs font-semibold text-app-on-accent hover:opacity-90 disabled:opacity-50">
          {submitting ? 'Saving...' : 'Save Feedback'}
        </button>
      </div>
    </form>
  );
}

function HrDecisionForm({
  round,
  onDecided,
  onCancel,
}: {
  readonly round: CandidateRound;
  readonly onDecided: (updated: CandidateRound) => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const [decision, setDecision] = useState<'pass' | 'fail' | 'skip'>('pass');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const input: RoundDecisionInput = { decision, notes: notes.trim() || null };
      const updated = await recordRoundDecision(round.candidateId, round.id, input);
      onDecided(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record decision');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="mt-3 space-y-3 rounded-lg border border-app-border bg-app-background p-3">
      <p className="text-xs font-bold uppercase tracking-wider text-app-muted">HR Decision</p>
      {error && <p className="text-xs text-app-danger">{error}</p>}

      <div className="flex gap-2">
        {(['pass', 'fail', 'skip'] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDecision(d)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold capitalize transition ${
              decision === d
                ? d === 'pass'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700'
                  : d === 'fail'
                    ? 'border-red-500/40 bg-red-500/10 text-red-700'
                    : 'border-app-border bg-app-surface text-app-foreground'
                : 'border-app-border text-app-muted hover:text-app-foreground'
            }`}
          >
            {d}
          </button>
        ))}
      </div>

      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        disabled={submitting}
        placeholder="Optional decision notes for the candidate record..."
        className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-xs text-app-foreground outline-none focus:border-app-accent"
      />

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={submitting} className="rounded px-3 py-1.5 text-xs text-app-muted hover:text-app-foreground">
          Cancel
        </button>
        <button type="submit" disabled={submitting} className="rounded-lg bg-app-accent px-3 py-1.5 text-xs font-semibold text-app-on-accent hover:opacity-90 disabled:opacity-50">
          {submitting ? 'Recording...' : `Record ${decision.charAt(0).toUpperCase()}${decision.slice(1)}`}
        </button>
      </div>
    </form>
  );
}

export function CandidateRoundPanel({
  candidateId,
  requisitionId,
}: {
  readonly candidateId: string;
  readonly requisitionId: string | undefined;
}): React.JSX.Element {
  const [candidateRounds, setCandidateRounds] = useState<CandidateRound[]>([]);
  const [pipelineRounds, setPipelineRounds] = useState<PipelineRound[]>([]);
  const [employees, setEmployees] = useState<CompanyEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [selectedPipelineRound, setSelectedPipelineRound] = useState('');
  const [createBusy, setCreateBusy] = useState(false);

  const [assignTarget, setAssignTarget] = useState<string | null>(null);
  const [feedbackTarget, setFeedbackTarget] = useState<string | null>(null);
  const [decisionTarget, setDecisionTarget] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const promises: Promise<void>[] = [
      listCandidateRounds(candidateId)
        .then((data) => { if (!cancelled) setCandidateRounds(data); })
        .catch(() => {}),
      getCompanyEmployees()
        .then((emps) => { if (!cancelled) setEmployees(emps); })
        .catch(() => {}),
    ];

    if (requisitionId) {
      promises.push(
        listPipelineRounds(requisitionId)
          .then((data) => { if (!cancelled) setPipelineRounds(data.sort((a, b) => a.orderIndex - b.orderIndex)); })
          .catch(() => {}),
      );
    }

    void Promise.all(promises).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [candidateId, requisitionId]);

  async function handleAddRound() {
    if (!selectedPipelineRound) return;
    setCreateBusy(true);
    setError(null);
    try {
      const created = await createCandidateRound(candidateId, { pipelineRoundId: selectedPipelineRound });
      setCandidateRounds((prev) => [...prev, created]);
      setAdding(false);
      setSelectedPipelineRound('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create round');
    } finally {
      setCreateBusy(false);
    }
  }

  const usedPipelineRoundIds = new Set(candidateRounds.map((r) => r.pipelineRoundId));
  const availablePipelineRounds = pipelineRounds.filter((pr) => !usedPipelineRoundIds.has(pr.id));

  if (loading) {
    return (
      <div className="py-4 text-center text-xs text-app-muted">Loading interview pipeline...</div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-lg border border-[#d86b6b]/30 bg-[#d86b6b]/10 px-3 py-2 text-xs text-app-danger">
          {error}
        </p>
      )}

      {candidateRounds.length === 0 && !adding && (
        <p className="text-xs text-app-muted">
          No pipeline rounds added for this candidate yet.
          {pipelineRounds.length > 0
            ? ' Select a round from the job pipeline below to begin tracking.'
            : ' The job requisition has no pipeline rounds defined.'}
        </p>
      )}

      <div className="space-y-3">
        {candidateRounds
          .slice()
          .sort((a, b) => (a.pipelineRoundOrder ?? 0) - (b.pipelineRoundOrder ?? 0))
          .map((round) => {
            const badge = STATUS_BADGE[round.status] ?? STATUS_BADGE['pending'];
            const isAssigning = assignTarget === round.id;
            const isSubmittingFeedback = feedbackTarget === round.id;
            const isDeciding = decisionTarget === round.id;

            return (
              <div
                key={round.id}
                className="rounded-xl border border-app-border bg-app-surface p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold uppercase text-app-accent">
                        Round {round.pipelineRoundOrder ?? '?'}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${badge.className}`}
                      >
                        ● {badge.label}
                      </span>
                      {round.mode && (
                        <span className="inline-flex items-center rounded-md border border-app-border/60 bg-app-background px-2 py-0.5 text-xs text-app-muted">
                          {MODE_LABELS[round.mode]}
                        </span>
                      )}
                    </div>
                    <h4 className="mt-0.5 font-semibold text-app-foreground">
                      {round.pipelineRoundName ?? 'Interview Round'}
                    </h4>
                    {round.assignedToName && (
                      <p className="mt-0.5 text-xs text-app-muted">
                        Interviewer: <span className="font-medium text-app-foreground">{round.assignedToName}</span>
                      </p>
                    )}
                    {round.scheduledAt && (
                      <p className="text-xs text-app-muted">
                        Scheduled: {new Date(round.scheduledAt).toLocaleString()}
                      </p>
                    )}
                    {round.meetingLink && (
                      <p className="truncate text-xs text-app-muted">
                        Link:{' '}
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
                      <p className="text-xs text-app-muted">Location: {round.location}</p>
                    )}
                  </div>

                  {!isAssigning && !isSubmittingFeedback && !isDeciding && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {(round.status === 'pending' || round.status === 'scheduled') && (
                        <button
                          type="button"
                          onClick={() => {
                            setAssignTarget(round.id);
                            setFeedbackTarget(null);
                            setDecisionTarget(null);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-app-border px-2.5 py-1.5 text-xs font-semibold text-app-foreground hover:border-app-accent hover:text-app-accent transition-colors"
                        >
                          <Icon name="users" className="size-3" />
                          {round.assignedTo ? 'Reassign' : 'Assign'}
                        </button>
                      )}

                      {(round.status === 'scheduled' || round.status === 'completed' || round.status === 'pending') && (
                        <button
                          type="button"
                          onClick={() => {
                            setFeedbackTarget(round.id);
                            setAssignTarget(null);
                            setDecisionTarget(null);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-app-border px-2.5 py-1.5 text-xs font-semibold text-app-foreground hover:border-app-accent hover:text-app-accent transition-colors"
                        >
                          <Icon name="pencil" className="size-3" />
                          Feedback
                        </button>
                      )}

                      {(round.status === 'scheduled' || round.status === 'completed' || round.status === 'pending') && (
                        <button
                          type="button"
                          onClick={() => {
                            setDecisionTarget(round.id);
                            setAssignTarget(null);
                            setFeedbackTarget(null);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-app-border px-2.5 py-1.5 text-xs font-semibold text-app-foreground hover:border-app-accent hover:text-app-accent transition-colors"
                        >
                          HR Decision
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {round.interviewerNotes && (
                  <div className="mt-3 rounded-lg bg-app-background p-2.5 text-xs space-y-1">
                    <p className="font-semibold text-app-muted">Interviewer Notes</p>
                    <p className="text-app-foreground">{round.interviewerNotes}</p>
                    {round.rating && (
                      <p className="text-app-muted">Rating: {round.rating}/5</p>
                    )}
                    {round.recommendation && (
                      <p
                        className={`font-bold uppercase ${
                          round.recommendation === 'pass'
                            ? 'text-emerald-600'
                            : round.recommendation === 'fail'
                              ? 'text-red-600'
                              : 'text-amber-600'
                        }`}
                      >
                        Recommendation: {round.recommendation}
                      </p>
                    )}
                  </div>
                )}

                {isAssigning && (
                  <AssignInterviewerForm
                    round={round}
                    employees={employees}
                    onAssigned={(updated) => {
                      setCandidateRounds((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
                      setAssignTarget(null);
                    }}
                    onCancel={() => setAssignTarget(null)}
                  />
                )}

                {isSubmittingFeedback && (
                  <FeedbackFormInline
                    round={round}
                    onSubmitted={(updated) => {
                      setCandidateRounds((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
                      setFeedbackTarget(null);
                    }}
                    onCancel={() => setFeedbackTarget(null)}
                  />
                )}

                {isDeciding && (
                  <HrDecisionForm
                    round={round}
                    onDecided={(updated) => {
                      setCandidateRounds((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
                      setDecisionTarget(null);
                    }}
                    onCancel={() => setDecisionTarget(null)}
                  />
                )}
              </div>
            );
          })}
      </div>

      {adding && availablePipelineRounds.length > 0 && (
        <div className="rounded-xl border border-app-accent/30 bg-app-surface p-4">
          <p className="mb-2 text-xs font-semibold text-app-muted">Add Pipeline Round</p>
          <div className="flex items-center gap-2">
            <select
              value={selectedPipelineRound}
              onChange={(e) => setSelectedPipelineRound(e.target.value)}
              disabled={createBusy}
              className="flex-1 rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm text-app-foreground outline-none focus:border-app-accent"
            >
              <option value="">Select round...</option>
              {availablePipelineRounds.map((pr) => (
                <option key={pr.id} value={pr.id}>
                  {pr.orderIndex}. {pr.name} ({MODE_LABELS[pr.mode]})
                </option>
              ))}
            </select>
            <Button
              kind="primary"
              disabled={!selectedPipelineRound || createBusy}
              onClick={() => void handleAddRound()}
            >
              {createBusy ? 'Adding...' : 'Add'}
            </Button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              disabled={createBusy}
              className="text-xs text-app-muted hover:text-app-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!adding && availablePipelineRounds.length > 0 && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-app-border py-2 text-xs text-app-muted transition-colors hover:border-app-accent hover:text-app-accent"
        >
          <Icon name="plus" className="size-3.5" />
          Add Round to Pipeline
        </button>
      )}
    </div>
  );
}
