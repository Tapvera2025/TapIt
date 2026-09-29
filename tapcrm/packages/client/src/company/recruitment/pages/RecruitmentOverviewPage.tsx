import { useEffect, useState } from 'react';
import { Card, Loading, Notice, Page } from '../../../ui/components.js';
import {
  getRecruitmentMetrics,
  listCandidates,
  listInterviews,
  listRequisitions,
} from '../api/recruitmentApi.js';
import {
  InterviewStatusBadge,
  RequisitionStatusBadge,
} from '../components/StatusBadge.js';
import { ApplicationLinkModal } from '../components/ApplicationLinkModal.js';
import type {
  Candidate,
  Interview,
  JobRequisition,
  RecruitmentMetrics,
} from '../types/index.js';

export function RecruitmentOverviewPage({
  onNavigate,
  onOpenCreateRequisition,
  onOpenAddCandidate,
}: {
  readonly onNavigate: (path: string) => void;
  readonly onOpenCreateRequisition?: () => void;
  readonly onOpenAddCandidate?: () => void;
}): React.JSX.Element {
  const [metrics, setMetrics] = useState<RecruitmentMetrics | null>(null);
  const [requisitions, setRequisitions] = useState<JobRequisition[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [appLinkRequisition, setAppLinkRequisition] = useState<JobRequisition | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    void Promise.all([
      getRecruitmentMetrics(),
      listRequisitions({ status: 'open' }),
      listCandidates(),
      listInterviews({ status: 'scheduled' }),
    ])
      .then(([m, reqs, cands, ints]) => {
        if (!cancelled) {
          setMetrics(m);
          setRequisitions(reqs.slice(0, 5));
          setCandidates(cands.slice(0, 5));
          setInterviews(ints.slice(0, 5));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load recruitment overview data');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Page
      eyebrow="People / HR"
      title="Recruitment Overview"
      description="Talent acquisition pipeline, active openings, candidate stages, and onboarding readiness."
      action={
        <div className="flex flex-wrap gap-2">
          {onOpenAddCandidate && (
            <button
              type="button"
              onClick={onOpenAddCandidate}
              className="rounded-lg border border-app-border bg-app-surface px-4 py-2.5 text-sm font-bold text-app-foreground hover:border-app-accent hover:text-app-accent"
            >
              + Add Candidate
            </button>
          )}
          {onOpenCreateRequisition && (
            <button
              type="button"
              onClick={onOpenCreateRequisition}
              className="rounded-lg bg-app-accent px-4 py-2.5 text-sm font-bold text-app-on-accent hover:opacity-90"
            >
              + Create Requisition
            </button>
          )}
        </div>
      }
    >
      {error && (
        <div className="mt-6">
          <Notice error>{error}</Notice>
        </div>
      )}

      {loading && !metrics ? (
        <div className="mt-6 space-y-4">
          <Loading />
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          {/* Key Metrics Grid */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
            <MetricCard
              label="Open Requisitions"
              value={metrics?.openRequisitions ?? 0}
              icon="📋"
              onClick={() => onNavigate('/company/recruitment/requisitions')}
            />
            <MetricCard
              label="Active Candidates"
              value={metrics?.activeCandidates ?? 0}
              icon="👥"
              onClick={() => onNavigate('/company/recruitment/candidates')}
            />
            <MetricCard
              label="In Screening"
              value={metrics?.candidatesInScreening ?? 0}
              icon="🔍"
              onClick={() => onNavigate('/company/recruitment/candidates')}
            />
            <MetricCard
              label="Scheduled Interviews"
              value={metrics?.upcomingInterviews ?? 0}
              icon="📅"
              onClick={() => onNavigate('/company/recruitment/interviews')}
            />
            <MetricCard
              label="Pending Offers"
              value={metrics?.offersPending ?? 0}
              icon="✉"
              onClick={() => onNavigate('/company/recruitment/offers')}
            />
            <MetricCard
              label="Pending Joinings"
              value={metrics?.joiningPending ?? 0}
              icon="🤝"
              onClick={() => onNavigate('/company/recruitment/joining')}
            />
          </div>

          {/* Visual Recruitment Pipeline Workflow */}
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg font-bold">HR Recruitment Pipeline</h3>
                <p className="mt-1 text-xs text-app-muted">
                  End-to-end operational talent acquisition lifecycle from requisition to employee onboarding.
                </p>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              <PipelineStageStep
                step="1"
                title="Requisitions"
                desc="Approved headcount"
                count={metrics?.openRequisitions ?? 0}
                onClick={() => onNavigate('/company/recruitment/requisitions')}
              />
              <PipelineStageStep
                step="2"
                title="Candidates"
                desc="Inbound & Sourced"
                count={metrics?.activeCandidates ?? 0}
                onClick={() => onNavigate('/company/recruitment/candidates')}
              />
              <PipelineStageStep
                step="3"
                title="Screening"
                desc="HR qualifications"
                count={metrics?.candidatesInScreening ?? 0}
                onClick={() => onNavigate('/company/recruitment/candidates')}
              />
              <PipelineStageStep
                step="4"
                title="Interviews"
                desc="Panel evaluation"
                count={metrics?.upcomingInterviews ?? 0}
                onClick={() => onNavigate('/company/recruitment/interviews')}
              />
              <PipelineStageStep
                step="5"
                title="Selected"
                desc="Hiring decision"
                count={candidates.filter((c) => c.status === 'selected').length}
                onClick={() => onNavigate('/company/recruitment/candidates')}
              />
              <PipelineStageStep
                step="6"
                title="Offers"
                desc="Formal package"
                count={metrics?.offersPending ?? 0}
                onClick={() => onNavigate('/company/recruitment/offers')}
              />
              <PipelineStageStep
                step="7"
                title="Joining"
                desc="Handoff to Employee"
                count={metrics?.joiningPending ?? 0}
                isLast
                onClick={() => onNavigate('/company/recruitment/joining')}
              />
            </div>
          </Card>

          {/* Recent Operational Highlights */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Open Requisitions Summary */}
            <Card className="p-5">
              <div className="flex items-center justify-between border-b border-app-border pb-3">
                <h3 className="font-display font-bold">Active Openings</h3>
                <button
                  type="button"
                  onClick={() => onNavigate('/company/recruitment/requisitions')}
                  className="text-xs font-semibold text-app-accent hover:underline"
                >
                  View all ({requisitions.length}) →
                </button>
              </div>

              {requisitions.length === 0 ? (
                <p className="mt-4 text-xs text-app-muted text-center py-4">No active open requisitions found.</p>
              ) : (
                <div className="mt-3 divide-y divide-app-border">
                  {requisitions.map((req) => (
                    <div key={req.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                      <div>
                        <p className="font-semibold text-sm">{req.title}</p>
                        <p className="text-xs text-app-muted">
                          {req.requisitionNumber} · {req.departmentName ?? 'Department'} · {req.openingsCount} opening{req.openingsCount > 1 ? 's' : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <RequisitionStatusBadge status={req.status} />
                        <button
                          type="button"
                          onClick={() => setAppLinkRequisition(req)}
                          className="inline-flex items-center gap-1 rounded-lg border border-app-accent/40 bg-app-accent/10 px-2 py-1 text-xs font-semibold text-app-accent hover:border-app-accent hover:bg-app-accent/20 transition-colors shadow-xs"
                          title="Student Application Link"
                          aria-label="Student Application Link"
                        >
                          🔗 Link
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Upcoming Interviews Summary */}
            <Card className="p-5">
              <div className="flex items-center justify-between border-b border-app-border pb-3">
                <h3 className="font-display font-bold">Scheduled Interviews</h3>
                <button
                  type="button"
                  onClick={() => onNavigate('/company/recruitment/interviews')}
                  className="text-xs font-semibold text-app-accent hover:underline"
                >
                  View all ({interviews.length}) →
                </button>
              </div>

              {interviews.length === 0 ? (
                <p className="mt-4 text-xs text-app-muted text-center py-4">No upcoming interviews scheduled.</p>
              ) : (
                <div className="mt-3 divide-y divide-app-border">
                  {interviews.map((int) => (
                    <div key={int.id} className="flex items-center justify-between py-3">
                      <div>
                        <p className="font-semibold text-sm">{int.candidateName ?? 'Candidate'}</p>
                        <p className="text-xs text-app-muted">
                          Round {int.round} ({int.stage}) · {new Date(int.scheduledAt).toLocaleDateString()}
                        </p>
                      </div>
                      <InterviewStatusBadge status={int.status} />
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {appLinkRequisition && (
        <ApplicationLinkModal
          requisition={appLinkRequisition}
          onClose={() => setAppLinkRequisition(null)}
        />
      )}
    </Page>
  );
}

function MetricCard({
  label,
  value,
  icon,
  onClick,
}: {
  readonly label: string;
  readonly value: number;
  readonly icon: string;
  readonly onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ui-card flex flex-col justify-between p-4 text-left transition hover:border-app-accent focus:outline-none"
    >
      <div className="flex items-center justify-between">
        <span className="text-lg" aria-hidden="true">
          {icon}
        </span>
        <span className="font-display text-2xl font-bold">{value}</span>
      </div>
      <p className="mt-3 text-xs font-semibold text-app-muted">{label}</p>
    </button>
  );
}

function PipelineStageStep({
  step,
  title,
  desc,
  count,
  isLast = false,
  onClick,
}: {
  readonly step: string;
  readonly title: string;
  readonly desc: string;
  readonly count: number;
  readonly isLast?: boolean;
  readonly onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex flex-col justify-between rounded-xl border border-app-border bg-app-surface p-3 text-left transition hover:border-app-accent"
    >
      <div>
        <div className="flex items-center justify-between">
          <span className="grid size-5 place-items-center rounded-full bg-app-accent/15 text-[10px] font-bold text-app-accent">
            {step}
          </span>
          <span className="font-bold text-sm text-app-foreground">{count}</span>
        </div>
        <p className="mt-2 text-xs font-bold text-app-foreground">{title}</p>
        <p className="mt-0.5 text-[11px] text-app-muted">{desc}</p>
      </div>
      {!isLast && (
        <span
          className="hidden lg:block absolute -right-2 top-1/2 -translate-y-1/2 text-app-muted/40 font-bold z-10"
          aria-hidden="true"
        >
          →
        </span>
      )}
    </button>
  );
}
