import { useEffect, useState } from 'react';
import { Card, Notice, Page, SkeletonPage } from '../../../ui/components.js';
import { Icon } from '../../../ui/Icon.js';
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
        <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:items-center">
          {onOpenAddCandidate && (
            <button
              type="button"
              onClick={onOpenAddCandidate}
              className="w-full rounded-xl border border-app-border bg-app-surface px-5 py-2.5 text-center text-sm font-semibold text-app-foreground transition hover:border-app-accent hover:text-app-accent sm:w-auto"
            >
              + Add Candidate
            </button>
          )}
          {onOpenCreateRequisition && (
            <button
              type="button"
              onClick={onOpenCreateRequisition}
              className="w-full rounded-xl bg-app-accent px-5 py-2.5 text-center text-sm font-semibold text-app-on-accent shadow-xs transition hover:opacity-90 sm:w-auto"
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
        <div className="mt-6"><SkeletonPage cards={4} rows={4} /></div>
      ) : (
        <div className="mt-6 space-y-8">
           {/* Visual Recruitment Pipeline Workflow */}
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg font-bold">HR Recruitment Pipeline</h3>
                <p className="mt-1 text-xs text-app-muted">
                  End-to-end operational talent acquisition lifecycle from requisition to employee onboarding.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('/company/recruitment/requisitions')}
                className="hidden shrink-0 items-center gap-1.5 text-xs font-semibold text-app-accent hover:underline sm:inline-flex"
              >
                <Icon name="arrow" className="size-3.5" />
                View Details
              </button>
            </div>

            {/* ── Mobile: Vertical Timeline ── */}
            <div className="mt-6 sm:hidden">
              <MobilePipelineStage
                step="1"
                title="Requisitions"
                desc="Approved headcount"
                iconName="briefcase"
                count={metrics?.openRequisitions ?? 0}
                onClick={() => onNavigate('/company/recruitment/requisitions')}
              />
              <MobilePipelineStage
                step="2"
                title="Candidates"
                desc="Inbound & Sourced"
                iconName="users"
                count={metrics?.activeCandidates ?? 0}
                onClick={() => onNavigate('/company/recruitment/candidates')}
              />
              <MobilePipelineStage
                step="3"
                title="Screening"
                desc="HR qualifications"
                iconName="notepad"
                count={metrics?.candidatesInScreening ?? 0}
                onClick={() => onNavigate('/company/recruitment/candidates')}
              />
              <MobilePipelineStage
                step="4"
                title="Interviews"
                desc="Panel evaluation"
                iconName="history"
                count={metrics?.upcomingInterviews ?? 0}
                onClick={() => onNavigate('/company/recruitment/interviews')}
              />
              <MobilePipelineStage
                step="5"
                title="Selected"
                desc="Hiring decision"
                iconName="check"
                count={candidates.filter((c) => c.status === 'selected').length}
                onClick={() => onNavigate('/company/recruitment/candidates')}
              />
              <MobilePipelineStage
                step="6"
                title="Offers"
                desc="Formal package"
                iconName="bell"
                count={metrics?.offersPending ?? 0}
                onClick={() => onNavigate('/company/recruitment/offers')}
              />
              <MobilePipelineStage
                step="7"
                title="Joining"
                desc="Handoff to Employee"
                iconName="building"
                count={metrics?.joiningPending ?? 0}
                isLast
                onClick={() => onNavigate('/company/recruitment/joining')}
              />
            </div>

            {/* ── Desktop / Tablet: Original Grid ── */}
            <div className="mt-6 hidden gap-2 sm:grid sm:grid-cols-4 lg:grid-cols-7">
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
                          className="inline-flex items-center gap-1.5 rounded-lg border border-app-accent/40 bg-app-accent/10 px-2.5 py-1 text-xs font-semibold text-app-accent hover:border-app-accent hover:bg-app-accent/20 transition-colors shadow-xs"
                          title="Student Application Link"
                          aria-label="Student Application Link"
                        >
                          <Icon name="pin" className="size-3.5" />
                          <span>Link</span>
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

function MobilePipelineStage({
  step,
  title,
  desc,
  iconName,
  count,
  isLast = false,
  onClick,
}: {
  readonly step: string;
  readonly title: string;
  readonly desc: string;
  readonly iconName: string;
  readonly count: number;
  readonly isLast?: boolean;
  readonly onClick?: () => void;
}) {
  return (
    <div className="flex gap-3">
      {/* Timeline axis: numbered marker + connecting line */}
      <div className="flex shrink-0 flex-col items-center">
        <span className="grid size-7 place-items-center rounded-full border-2 border-app-accent/30 bg-app-accent/10 text-[11px] font-bold text-app-accent">
          {step}
        </span>
        {!isLast && (
          <span
            className="w-px grow bg-app-border"
            aria-hidden="true"
          />
        )}
      </div>

      {/* Stage card */}
      <button
        type="button"
        onClick={onClick}
        className="mb-3 flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-app-border bg-app-surface p-3 text-left transition active:border-app-accent"
      >
        {/* Icon */}
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-app-accent/10 text-app-accent">
          <Icon name={iconName} className="size-4" />
        </span>

        {/* Title + description */}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-app-foreground">{title}</p>
          <p className="mt-0.5 text-[11px] text-app-muted">{desc}</p>
        </div>

        {/* Count + chevron */}
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-sm font-bold text-app-foreground">{count}</span>
          <svg
            className="size-3.5 text-app-muted"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </div>
      </button>
    </div>
  );
}
