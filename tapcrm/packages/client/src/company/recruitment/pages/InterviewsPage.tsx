import { useEffect, useState } from 'react';
import { Card, Empty, Notice, Page, SkeletonTable } from '../../../ui/components.js';
import { listCandidates, listInterviews, listRequisitions, updateInterviewStatus } from '../api/recruitmentApi.js';
import { InterviewFeedbackModal } from '../components/InterviewFeedbackModal.js';
import { InterviewScheduleModal } from '../components/InterviewScheduleModal.js';
import { InterviewStageBadge, InterviewStatusBadge } from '../components/StatusBadge.js';
import type {
  Candidate,
  Interview,
  InterviewFilter,
  InterviewStage,
  InterviewStatus,
  JobRequisition,
} from '../types/index.js';

export function InterviewsPage({
  preselectedCandidate,
}: {
  readonly preselectedCandidate?: Candidate | undefined;
}): React.JSX.Element {
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [requisitions, setRequisitions] = useState<JobRequisition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<InterviewStatus | 'all'>('all');
  const [stageFilter, setStageFilter] = useState<InterviewStage | 'all'>('all');

  // Modals
  const [showScheduleModal, setShowScheduleModal] = useState(Boolean(preselectedCandidate));
  const [feedbackInterview, setFeedbackInterview] = useState<Interview | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const filter: InterviewFilter = {
        status: statusFilter,
        stage: stageFilter,
      };
      const [ints, cands, reqs] = await Promise.all([
        listInterviews(filter),
        listCandidates(),
        listRequisitions(),
      ]);
      setInterviews(ints);
      setCandidates(cands);
      setRequisitions(reqs);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load interview schedules');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [statusFilter, stageFilter]);

  async function handleStatusChange(interview: Interview, nextStatus: InterviewStatus) {
    setActionBusy(true);
    try {
      const updated = await updateInterviewStatus(interview.id, nextStatus);
      setInterviews((prev) => prev.map((i) => (i.id === interview.id ? updated : i)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to update interview status');
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <Page
      eyebrow="People / HR"
      title="Interview Rounds"
      description="Panel coordination, technical & culture evaluations, scoring, and feedback logs."
      action={
        <button
          type="button"
          onClick={() => setShowScheduleModal(true)}
          className="w-full rounded-xl bg-app-accent px-5 py-2.5 text-center text-sm font-semibold text-app-on-accent shadow-xs transition hover:opacity-90 sm:w-auto"
        >
          + Schedule Interview
        </button>
      }
    >
      {error && (
        <div className="mt-6">
          <Notice error>{error}</Notice>
        </div>
      )}

      {/* Filters */}
      <Card className="mt-6 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as InterviewStatus | 'all')}
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent"
            aria-label="Filter by interview status"
          >
            <option value="all">All Interview Statuses</option>
            <option value="scheduled">Scheduled</option>
            <option value="completed">Completed</option>
            <option value="rescheduled">Rescheduled</option>
            <option value="cancelled">Cancelled</option>
            <option value="no_show">No Show</option>
          </select>

          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value as InterviewStage | 'all')}
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent"
            aria-label="Filter by interview stage"
          >
            <option value="all">All Stages</option>
            <option value="screening">Screening</option>
            <option value="technical">Technical</option>
            <option value="managerial">Managerial</option>
            <option value="hr">HR Round</option>
            <option value="final">Final Round</option>
          </select>
        </div>
      </Card>

      {/* Interviews Table */}
      {loading ? (
        <div className="mt-6">
          <SkeletonTable columns={5} rows={6} />
        </div>
      ) : interviews.length === 0 ? (
        <Empty>
          No interviews scheduled matching the current filters. Schedule a new round with an active candidate.
        </Empty>
      ) : (
        <section className="mt-6 overflow-hidden rounded-2xl border border-app-border bg-app-surface">
          <div className="hidden border-b border-app-border bg-app-surface-raised px-5 py-3 text-xs font-bold uppercase tracking-wider text-app-muted md:grid md:grid-cols-[1.5fr_1.3fr_1fr_1.1fr_1fr_1.3fr] md:items-center">
            <span>Candidate &amp; Role</span>
            <span>Stage &amp; Round</span>
            <span>Type &amp; Duration</span>
            <span>Scheduled Date</span>
            <span>Status</span>
            <span className="text-right">Actions</span>
          </div>

          <div className="divide-y divide-app-border">
            {interviews.map((int) => (
              <div
                key={int.id}
                className="grid gap-2 px-5 py-4 text-sm md:grid-cols-[1.5fr_1.3fr_1fr_1.1fr_1fr_1.3fr] md:items-center"
              >
                <div>
                  <p className="font-semibold">{int.candidateName ?? 'Candidate'}</p>
                  <p className="text-xs text-app-muted">{int.requisitionTitle ?? 'Job Requisition'}</p>
                </div>

                <div>
                  <div className="flex items-center gap-1.5">
                    <InterviewStageBadge stage={int.stage} />
                    <span className="text-xs font-medium text-app-muted">R{int.round}</span>
                  </div>
                  {int.interviewerNames && int.interviewerNames.length > 0 && (
                    <p className="text-xs text-app-muted mt-0.5 truncate">
                      Panel: {int.interviewerNames.join(', ')}
                    </p>
                  )}
                </div>

                <div>
                  <span className="capitalize text-xs font-medium">{int.interviewType.replace('_', ' ')}</span>
                  <p className="text-xs text-app-muted">{int.durationMinutes} mins</p>
                </div>

                <div className="text-xs text-app-foreground">
                  <p className="font-medium">{new Date(int.scheduledAt).toLocaleDateString()}</p>
                  <p className="text-app-muted">{new Date(int.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                </div>

                <div>
                  <InterviewStatusBadge status={int.status} />
                </div>

                <div className="flex flex-wrap items-center justify-end gap-1.5 pt-2 md:pt-0">
                  <button
                    type="button"
                    onClick={() => setFeedbackInterview(int)}
                    className="rounded bg-app-accent/15 px-2.5 py-1 text-xs font-semibold text-app-accent hover:bg-app-accent/25"
                  >
                    Feedback ({int.feedback?.length ?? 0})
                  </button>

                  {int.status === 'scheduled' && (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => void handleStatusChange(int, 'completed')}
                      className="rounded border border-app-border px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10"
                    >
                      Complete
                    </button>
                  )}

                  {int.status === 'scheduled' && (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => void handleStatusChange(int, 'cancelled')}
                      className="rounded border border-app-border px-2.5 py-1 text-xs font-semibold text-app-danger hover:bg-rose-500/10"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {showScheduleModal && (
        <InterviewScheduleModal
          candidates={candidates.filter((c) => c.status === 'interview' || c.status === 'screening' || c.status === 'applied')}
          requisitions={requisitions}
          preselectedCandidate={preselectedCandidate}
          onClose={() => setShowScheduleModal(false)}
          onScheduled={(newInt) => {
            setInterviews((prev) => [newInt, ...prev]);
          }}
        />
      )}

      {feedbackInterview && (
        <InterviewFeedbackModal
          interview={feedbackInterview}
          onClose={() => setFeedbackInterview(null)}
          onSubmitted={(newFb) => {
            setInterviews((prev) =>
              prev.map((i) =>
                i.id === feedbackInterview.id
                  ? {
                      ...i,
                      status: 'completed',
                      feedback: [...(i.feedback ?? []), newFb],
                    }
                  : i,
              ),
            );
          }}
        />
      )}
    </Page>
  );
}
