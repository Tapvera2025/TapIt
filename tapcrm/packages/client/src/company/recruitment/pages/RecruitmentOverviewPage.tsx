import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Card, Icon, SkeletonPage, WorkspacePageContainer } from '../../../ui/index.js';
import {
  listCandidates,
  listInterviews,
  listJoinings,
  listOffers,
  listRequisitions,
} from '../api/recruitmentApi.js';
import { ApplicationLinkModal } from '../components/ApplicationLinkModal.js';
import { CandidateStatusBadge } from '../components/StatusBadge.js';
import type { Interview, InterviewStage, JobRequisition } from '../types/index.js';
import {
  employmentLabels,
  pipelineStages,
  summarizeOverview,
  type RecruitmentOverviewData,
} from './recruitment-overview-data.js';
import './recruitment-overview.css';

const REQUISITIONS = '/company/recruitment/requisitions';
const CANDIDATES = '/company/recruitment/candidates';
const INTERVIEWS = '/company/recruitment/interviews';
const OFFERS = '/company/recruitment/offers';
const JOINING = '/company/recruitment/joining';
const number = new Intl.NumberFormat();
const day = new Intl.DateTimeFormat(undefined, { day: '2-digit' });
const month = new Intl.DateTimeFormat(undefined, { month: 'short' });
const dateLabel = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const interviewLabels: Record<InterviewStage, string> = {
  screening: 'Screening interview',
  technical: 'Technical interview',
  managerial: 'Managerial interview',
  hr: 'HR interview',
  final: 'Final interview',
};

type Overview = ReturnType<typeof summarizeOverview>;
type PipelineStage = (typeof pipelineStages)[number]['key'];
type LoadState = { status: 'loading' } | { status: 'ready'; overview: Overview } | { status: 'error'; message: string };

function pipelineStagePath(stage: PipelineStage, requisitionId: string) {
  const query = new URLSearchParams({ requisitionId });
  switch (stage) {
    case 'interview': return `${INTERVIEWS}?${query}`;
    case 'offers': return `${OFFERS}?${query}`;
    case 'joining': return `${JOINING}?${query}`;
    default:
      query.set('status', stage);
      return `${CANDIDATES}?${query}`;
  }
}

export function RecruitmentOverviewPage({
  onNavigate,
  onOpenCreateRequisition,
  onOpenAddCandidate,
}: {
  readonly onNavigate: (path: string) => void;
  readonly onOpenCreateRequisition?: () => void;
  readonly onOpenAddCandidate?: () => void;
}): React.JSX.Element {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [requestVersion, setRequestVersion] = useState(0);
  const [appLinkRequisition, setAppLinkRequisition] = useState<JobRequisition | null>(null);

  useEffect(() => {
    let cancelled = false;

    void Promise.all([listRequisitions(), listCandidates(), listInterviews(), listOffers(), listJoinings()])
      .then(([requisitions, candidates, interviews, offers, joinings]) => {
        if (cancelled) return;
        const data: RecruitmentOverviewData = { requisitions, candidates, interviews, offers, joinings };
        setState({ status: 'ready', overview: summarizeOverview(data, new Date()) });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Unable to load the recruitment overview.',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [requestVersion]);

  return (
    <WorkspacePageContainer>
      {(onOpenAddCandidate || onOpenCreateRequisition) && (
        <div className="mb-5 flex flex-col gap-2 sm:flex-row xl:hidden">
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
      )}

      {state.status === 'loading' && <SkeletonPage cards={4} rows={4} />}
      {state.status === 'error' && (
        <div className="rounded-xl border border-app-border bg-app-surface p-5 text-sm" role="alert">
          <p className="font-semibold">Couldn’t load the recruitment overview</p>
          <p className="mt-1 text-app-muted">{state.message}</p>
          <button
            type="button"
            className="mt-3 font-semibold text-app-accent hover:underline"
            onClick={() => {
              setState({ status: 'loading' });
              setRequestVersion((version) => version + 1);
            }}
          >
            Try again
          </button>
        </div>
      )}
      {state.status === 'ready' && (
        <div className="recruitment-overview">
          <div className="recruitment-overview-top">
            <HiringPipeline
              jobs={state.overview.openJobs}
              counts={state.overview.pipeline}
              onNavigate={onNavigate}
            />
            <div className="recruitment-overview-metrics">
              <MetricCard
                title="Total Applicants"
                icon="users"
                count={state.overview.applicantCount}
                activity={state.overview.applicantActivity}
                activityLabel="New applicants"
              />
              <MetricCard
                title="Completed Interviews"
                icon="message"
                count={state.overview.completedInterviews}
                activity={state.overview.interviewActivity}
                activityLabel="Completed interviews"
              />
              <MetricCard
                title="Open Jobs"
                icon="briefcase"
                count={state.overview.openJobs.length}
                activity={state.overview.requisitionActivity}
                activityLabel="New requisitions"
                comparisonLabel="New jobs vs prior 7 days"
              />
            </div>
            <div className="recruitment-overview-side">
              <UpcomingInterviews interviews={state.overview.upcoming} onViewAll={() => onNavigate(INTERVIEWS)} />
              <CandidateSources
                sources={state.overview.sources}
                total={state.overview.applicantCount}
                onViewAll={() => onNavigate(CANDIDATES)}
              />
            </div>
          </div>

          <div className="recruitment-overview-lower">
            <JobStatus statuses={state.overview.jobStatuses} onViewAll={() => onNavigate(REQUISITIONS)} />
            <DashboardPanel title="New Applicants" actionLabel="View all candidates" onAction={() => onNavigate(CANDIDATES)}>
              {state.overview.recentApplicants.length === 0 ? <EmptyMessage>No applicants yet.</EmptyMessage> : (
                <ul className="recruitment-overview-list">
                  {state.overview.recentApplicants.map((candidate) => (
                    <li key={candidate.id} className="recruitment-overview-list-row">
                      <span className="recruitment-overview-initials" aria-hidden="true">
                        {`${candidate.firstName.charAt(0)}${candidate.lastName.charAt(0)}`}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="recruitment-overview-item-title">{candidate.fullName || `${candidate.firstName} ${candidate.lastName}`}</p>
                        {candidate.requisitionTitle && <p className="recruitment-overview-detail">{candidate.requisitionTitle}</p>}
                      </div>
                      <CandidateStatusBadge status={candidate.status} className="shrink-0" />
                    </li>
                  ))}
                </ul>
              )}
            </DashboardPanel>
            <DashboardPanel title="Open Jobs" actionLabel="View all requisitions" onAction={() => onNavigate(REQUISITIONS)}>
              {state.overview.openJobs.length === 0 ? <EmptyMessage>No open requisitions.</EmptyMessage> : (
                <ul className="recruitment-overview-list">
                  {state.overview.openJobs.slice(0, 5).map((job) => (
                    <li key={job.id} className="recruitment-overview-list-row">
                      <span className="recruitment-overview-initials" aria-hidden="true"><Icon name="briefcase" className="size-4" /></span>
                      <div className="min-w-0 flex-1">
                        <p className="recruitment-overview-item-title">{job.title}</p>
                        <p className="recruitment-overview-detail">
                          {job.requisitionNumber} · {number.format(job.openingsCount)} {job.openingsCount === 1 ? 'opening' : 'openings'}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="recruitment-overview-action"
                        aria-label={`Student application link for ${job.title}`}
                        title="Student application link"
                        onClick={() => setAppLinkRequisition(job)}
                      >
                        <Icon name="link" className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </DashboardPanel>
          </div>
        </div>
      )}

      {appLinkRequisition && (
        <ApplicationLinkModal requisition={appLinkRequisition} onClose={() => setAppLinkRequisition(null)} />
      )}
    </WorkspacePageContainer>
  );
}

function DashboardPanel({ title, actionLabel, onAction, className = '', children }: {
  readonly title: string;
  readonly actionLabel: string;
  readonly onAction: () => void;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <Card className={`recruitment-overview-panel ${className}`}>
      <div className="recruitment-overview-panel-header">
        <h2>{title}</h2>
        <button type="button" className="recruitment-overview-action" aria-label={actionLabel} title={actionLabel} onClick={onAction}>
          <Icon name="arrow" className="size-5" />
        </button>
      </div>
      {children}
    </Card>
  );
}

function EmptyMessage({ children }: { readonly children: ReactNode }) {
  return <p className="recruitment-overview-empty">{children}</p>;
}

function HiringPipeline({ jobs, counts, onNavigate }: {
  readonly jobs: Overview['openJobs'];
  readonly counts: Overview['pipeline'];
  readonly onNavigate: (path: string) => void;
}) {
  const [departmentId, setDepartmentId] = useState('');
  const departments = useMemo(() => Array.from(new Map(jobs.map((job) => [job.departmentId, job.departmentName ?? 'Unnamed department'])))
    .sort((a, b) => a[1].localeCompare(b[1])), [jobs]);
  const visibleJobs = departmentId ? jobs.filter((job) => job.departmentId === departmentId) : jobs;

  return (
    <DashboardPanel className="recruitment-overview-pipeline" title="Hiring Pipeline" actionLabel="View job requisitions" onAction={() => onNavigate(REQUISITIONS)}>
      {jobs.length === 0 ? <EmptyMessage>No open requisitions in the hiring pipeline.</EmptyMessage> : (
        <div className="recruitment-overview-pipeline-frame" role="region" aria-label="Hiring pipeline jobs" tabIndex={visibleJobs.length > 4 ? 0 : undefined}>
          <table className="recruitment-overview-pipeline-table" role="table">
            <caption className="sr-only">Candidates by current hiring stage for open jobs</caption>
            <thead role="rowgroup">
              <tr role="row">
                <th scope="col" className="recruitment-overview-job-column" role="columnheader">
                  <label className="recruitment-overview-job-filter">
                    <span className="sr-only">Filter pipeline by department</span>
                    <select className="ui-form-control" value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
                      <option value="">All open jobs</option>
                      {departments.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                    </select>
                    <Icon name="chevron-down" className="size-3.5" />
                  </label>
                </th>
                {pipelineStages.map(({ key, label }) => (
                  <th key={key} scope="col" className="recruitment-overview-stage-heading" role="columnheader">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody role="rowgroup">
              {visibleJobs.map((job) => (
                <tr key={job.id} role="row">
                  <th scope="row" className="recruitment-overview-job-column" role="rowheader">
                    <p className="recruitment-overview-item-title">{job.title}</p>
                    <p className="recruitment-overview-detail">{[employmentLabels[job.employmentType], job.location || job.departmentName].filter(Boolean).join(' · ')}</p>
                  </th>
                  {pipelineStages.map((stage, index) => {
                    const count = counts.get(job.id)?.[stage.key] ?? 0;
                    const href = pipelineStagePath(stage.key, job.id);
                    return (
                      <td key={stage.key} role="cell">
                        <span className="recruitment-overview-mobile-stage-heading" aria-hidden="true">
                          {'shortLabel' in stage ? (
                            <>
                              <span className="recruitment-overview-stage-label">{stage.label}</span>
                              <span className="recruitment-overview-short-stage-label">{stage.shortLabel}</span>
                            </>
                          ) : stage.label}
                        </span>
                        <a
                          href={href}
                          aria-label={`${stage.label} for ${job.title}, ${number.format(count)} ${count === 1 ? 'candidate' : 'candidates'}`}
                          className="recruitment-overview-stage"
                          data-empty={count === 0 || undefined}
                          style={{ '--stage-tint': `${9 + index * 5}%` } as CSSProperties}
                          onClick={(event) => {
                            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                            event.preventDefault();
                            onNavigate(href);
                          }}
                        >
                          {count === 0 ? '–' : number.format(count)}
                        </a>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashboardPanel>
  );
}

function UpcomingInterviews({ interviews, onViewAll }: {
  readonly interviews: Interview[];
  readonly onViewAll: () => void;
}) {
  return (
    <DashboardPanel title="Upcoming Interviews" actionLabel="View all interviews" onAction={onViewAll}>
      {interviews.length === 0 ? <EmptyMessage>No upcoming interviews scheduled.</EmptyMessage> : (
        <ul className="recruitment-overview-list">
          {interviews.map((interview) => {
            const start = new Date(interview.scheduledAt);
            const end = new Date(start.getTime() + interview.durationMinutes * 60_000);
            return (
              <li key={interview.id} className="recruitment-overview-interview">
                <time dateTime={interview.scheduledAt} className="recruitment-overview-date">
                  <strong>{day.format(start)}</strong>
                  <span>{month.format(start)}</span>
                </time>
                <div className="min-w-0 flex-1">
                  <p className="recruitment-overview-item-title">{interviewLabels[interview.stage]}</p>
                  <p className="recruitment-overview-detail">
                    {[interview.candidateName, interview.requisitionTitle].filter(Boolean).join(' · ')}
                  </p>
                  <p className="recruitment-overview-interview-time">
                    <Icon name="clock" className="size-3.5 shrink-0" />
                    <span>{time.formatRange(start, end)} · Round {interview.round}</span>
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardPanel>
  );
}

function CandidateSources({ sources, total, onViewAll }: {
  readonly sources: Overview['sources'];
  readonly total: number;
  readonly onViewAll: () => void;
}) {
  const arc = 'M48 176 A85 85 0 1 1 168 176';
  let running = 0;

  return (
    <DashboardPanel className="recruitment-overview-sources" title="Candidate Sources" actionLabel="View candidate sources" onAction={onViewAll}>
      <div className="recruitment-overview-source-chart">
        <svg viewBox="0 18 216 172" fill="none" aria-hidden="true">
          <path d={arc} stroke="var(--recruitment-overview-track)" strokeWidth="11" strokeLinecap="round" />
          {sources.map(({ key, count }) => {
            const share = count / total * 100;
            const inset = sources.length === 1 ? 0 : Math.min(2, share / 4);
            const start = running + inset;
            running += share;
            return (
              <path key={key} d={arc} pathLength="100" data-source={key} stroke="var(--source-color)" strokeWidth="11"
                strokeLinecap={share >= 8 ? 'round' : 'butt'}
                strokeDasharray={`${share - 2 * inset} 100`} strokeDashoffset={-start} />
            );
          })}
        </svg>
        <div className="recruitment-overview-source-total">
          <span>Total candidates</span>
          <strong>{number.format(total)}</strong>
        </div>
      </div>
      {sources.length === 0 ? <p className="recruitment-overview-detail text-center">Source data will appear as candidates are added.</p> : (
        <ul className="recruitment-overview-source-legend">
          {sources.map(({ key, label, count }) => (
            <li key={key} data-source={key}>
              <span aria-hidden="true" className="recruitment-overview-swatch" />
              <span><strong>{number.format(count)}</strong> {label}</span>
            </li>
          ))}
        </ul>
      )}
    </DashboardPanel>
  );
}

function MetricCard({ title, icon, count, activity, activityLabel, comparisonLabel = 'vs prior 7 days' }: {
  readonly title: string;
  readonly icon: string;
  readonly count: number;
  readonly activity: Overview['applicantActivity'];
  readonly activityLabel: string;
  readonly comparisonLabel?: string;
}) {
  const max = Math.max(1, ...activity.days.map((entry) => entry.count));
  const { difference } = activity;

  return (
    <Card className="recruitment-overview-panel recruitment-overview-metric">
      <h2><span className="recruitment-overview-metric-icon"><Icon name={icon} className="size-4" /></span>{title}</h2>
      <div className="recruitment-overview-metric-value">
        <strong>{number.format(count)}</strong>
        <div className="recruitment-overview-comparison">
          <span data-trend={difference > 0 ? 'up' : difference < 0 ? 'down' : undefined}>
            <span aria-hidden="true">{difference > 0 ? '↗ ' : difference < 0 ? '↘ ' : ''}</span>
            {difference > 0 ? '+' : ''}{number.format(difference)}
          </span>
          <small>{comparisonLabel}</small>
        </div>
      </div>
      <div
        className="recruitment-overview-sparkline"
        role="img"
        aria-label={`${activityLabel} by day over the last 7 days. ${activity.days.map(({ date, count: daily }) => `${dateLabel.format(date)}: ${daily}`).join(', ')}`}
      >
        {activity.days.map(({ date, count: daily }) => (
          <div key={date.getTime()} className="recruitment-overview-spark-column" title={`${dateLabel.format(date)}: ${number.format(daily)} ${activityLabel.toLowerCase()}`}>
            <span style={{ height: daily === 0 ? 0 : `max(3px, ${daily / max * 100}%)` }} />
          </div>
        ))}
      </div>
    </Card>
  );
}

function JobStatus({ statuses, onViewAll }: {
  readonly statuses: Overview['jobStatuses'];
  readonly onViewAll: () => void;
}) {
  const total = statuses.reduce((sum, { count }) => sum + count, 0);

  return (
    <DashboardPanel title="Job Status" actionLabel="View requisition statuses" onAction={onViewAll}>
      {total === 0 ? <EmptyMessage>No requisitions yet.</EmptyMessage> : (
        <ul className="recruitment-overview-status">
          {statuses.map(({ key, label, count }) => (
            <li key={key} data-status={key}>
              <span>{label}</span>
              <span className="recruitment-overview-status-track" aria-hidden="true">
                <span style={{ width: `${count / total * 100}%` }} />
              </span>
              <strong>{number.format(count)}</strong>
            </li>
          ))}
        </ul>
      )}
    </DashboardPanel>
  );
}
