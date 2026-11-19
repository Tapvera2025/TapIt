import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { HeadingText } from '../../layout/PageIntro.js';
import {
  Button,
  Card,
  Empty,
  Icon,
  Modal,
  SkeletonCard,
  WorkspacePageContainer,
} from '../../../ui/index.js';
import { ErrorToast } from '../../../ui/ErrorToast.js';
import {
  listCandidates,
  listInterviews,
  listRequisitions,
  updateRequisitionStatus,
} from '../api/recruitmentApi.js';
import { ApplicationLinkModal } from '../components/ApplicationLinkModal.js';
import { PipelineRoundBuilder } from '../components/PipelineRoundBuilder.js';
import { RequisitionFormModal } from '../components/RequisitionFormModal.js';
import { RequisitionStatusBadge } from '../components/StatusBadge.js';
import type { JobRequisition, RequisitionStatus } from '../types/index.js';
import { employmentLabels } from './recruitment-overview-data.js';
import './requisitions.css';

const statuses = [
  ['open', 'Open'],
  ['on_hold', 'On Hold'],
  ['closed', 'Closed'],
  ['draft', 'Draft'],
  ['filled', 'Filled'],
  ['cancelled', 'Cancelled'],
] as const satisfies readonly (readonly [RequisitionStatus, string])[];

const nextStatus: Partial<
  Record<RequisitionStatus, { status: RequisitionStatus; label: string }>
> = {
  draft: { status: 'open', label: 'Publish Requisition' },
  open: { status: 'on_hold', label: 'Put on Hold' },
  on_hold: { status: 'open', label: 'Resume Hiring' },
};

const dateFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const targetDateFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const numberFormat = new Intl.NumberFormat();
const dayMs = 86_400_000;

type Panel = {
  readonly kind: 'details' | 'application' | 'pipeline';
  readonly id: string;
};
type JobCounts = ReadonlyMap<string, number>;

function countByJob(records: readonly { readonly requisitionId: string }[]): JobCounts {
  const counts = new Map<string, number>();
  for (const { requisitionId } of records)
    counts.set(requisitionId, (counts.get(requisitionId) ?? 0) + 1);
  return counts;
}

export function RequisitionsPage({
  onAddCandidateForRequisition,
}: {
  readonly onAddCandidateForRequisition?: (req: JobRequisition) => void;
}): React.JSX.Element {
  const [requisitions, setRequisitions] = useState<JobRequisition[]>([]);
  const [applicants, setApplicants] = useState<JobCounts | null>(null);
  const [interviews, setInterviews] = useState<JobCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [actionBusy, setActionBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [department, setDepartment] = useState('');
  const [location, setLocation] = useState('');
  const [employment, setEmployment] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [showCreate, setShowCreate] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);

  useEffect(() => {
    let active = true;
    void listRequisitions()
      .then((jobs) => {
        if (active) setRequisitions(jobs);
      })
      .catch((error: unknown) => {
        if (active)
          setLoadError(
            error instanceof Error ? error.message : 'Unable to load requisitions.',
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    void listCandidates()
      .then((records) => {
        if (active) setApplicants(countByJob(records));
      })
      .catch(() => {
        if (active) setApplicants(null);
      });
    void listInterviews({ status: 'completed' })
      .then((records) => {
        if (active)
          setInterviews(
            countByJob(records.filter(({ status }) => status === 'completed')),
          );
      })
      .catch(() => {
        if (active) setInterviews(null);
      });
    return () => {
      active = false;
    };
  }, [loadVersion]);

  const { departments, locations, totals } = useMemo(() => {
    const names = new Map<string, string>();
    const places = new Set<string>();
    const count = new Map<RequisitionStatus, number>();
    for (const job of requisitions) {
      names.set(job.departmentId, job.departmentName ?? 'Unnamed department');
      if (job.location?.trim()) places.add(job.location.trim());
      count.set(job.status, (count.get(job.status) ?? 0) + 1);
    }
    return {
      departments: [...names].sort((a, b) => a[1].localeCompare(b[1])),
      locations: [...places].sort((a, b) => a.localeCompare(b)),
      totals: count,
    };
  }, [requisitions]);

  const term = search.trim().toLocaleLowerCase();
  const visible = requisitions.filter(
    (job) =>
      (!status || job.status === status) &&
      (!department || job.departmentId === department) &&
      (!location || job.location?.trim() === location) &&
      (!employment || job.employmentType === employment) &&
      (!term ||
        [
          job.title,
          job.requisitionNumber,
          job.departmentName,
          job.location,
          job.positionName,
        ].some((value) => value?.toLocaleLowerCase().includes(term))),
  );
  const hasFilters = Boolean(term || status || department || location || employment);
  const selectedJob = panel ? requisitions.find(({ id }) => id === panel.id) : undefined;

  function resetFilters() {
    setSearch('');
    setStatus('');
    setDepartment('');
    setLocation('');
    setEmployment('');
  }

  function reloadJobs() {
    setLoadError(null);
    setLoading(true);
    setLoadVersion((version) => version + 1);
  }

  async function changeStatus(job: JobRequisition, status: RequisitionStatus) {
    setActionBusy(true);
    setActionError(null);
    try {
      const updated = await updateRequisitionStatus(job.id, status);
      setRequisitions((current) =>
        current.map((item) => (item.id === job.id ? updated : item)),
      );
    } catch (error: unknown) {
      setActionError(
        error instanceof Error ? error.message : 'Failed to update requisition status.',
      );
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <WorkspacePageContainer className="requisition-workspace">
      <header className="requisition-page-heading">
        <div className="min-w-0">
          <div className="requisition-page-title">
            <span className="requisition-icon-tile">
              <Icon name="briefcase" className="size-5" />
            </span>
            <h1><HeadingText fallback="Job Requisitions" /></h1>
          </div>
          {!loading && !loadError && (
            <div
              className="requisition-status-summary"
              role="group"
              aria-label="Filter by requisition status"
            >
              {statuses.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  data-status={key}
                  aria-pressed={status === key}
                  onClick={() => setStatus(status === key ? '' : key)}
                >
                  <span aria-hidden="true" className="requisition-status-dot" />
                  {label} <strong>{numberFormat.format(totals.get(key) ?? 0)}</strong>
                </button>
              ))}
            </div>
          )}
        </div>
        <Button
          onClick={() => setShowCreate(true)}
          disabled={loading}
          className="requisition-create"
        >
          <Icon name="plus" className="size-4" /> Create Requisition
        </Button>
      </header>

      <Card className="requisition-toolbar">
        <div
          className="requisition-filters"
          role="group"
          aria-label="Requisition filters"
        >
          <label className="requisition-search">
            <Icon name="search" className="size-4" />
            <span className="sr-only">Search job requisitions</span>
            <input
              className="ui-form-control"
              placeholder="Search jobs"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <Filter
            label="Department"
            icon="building"
            value={department}
            onChange={setDepartment}
          >
            <option value="">All departments</option>
            {departments.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Filter>
          <Filter label="Status" icon="circle-dot" value={status} onChange={setStatus}>
            <option value="">All statuses</option>
            {statuses.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Filter>
          <Filter label="Location" icon="pin" value={location} onChange={setLocation}>
            <option value="">All locations</option>
            {locations.map((place) => (
              <option key={place} value={place}>
                {place}
              </option>
            ))}
          </Filter>
          <Filter
            label="Employment type"
            icon="briefcase"
            value={employment}
            onChange={setEmployment}
          >
            <option value="">All job types</option>
            {Object.entries(employmentLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Filter>
        </div>
        <div
          className="requisition-view-switch"
          role="group"
          aria-label="Requisition layout"
        >
          <button
            type="button"
            aria-label="Grid view"
            aria-pressed={view === 'grid'}
            onClick={() => setView('grid')}
          >
            <Icon name="grid" className="size-4" />
          </button>
          <button
            type="button"
            aria-label="List view"
            aria-pressed={view === 'list'}
            onClick={() => setView('list')}
          >
            <Icon name="list" className="size-4" />
          </button>
        </div>
      </Card>

      {loadError ? (
        <Card>
          <p role="alert" className="text-sm text-app-muted">
            {loadError}
          </p>
          <Button kind="secondary" className="mt-3" onClick={reloadJobs}>
            Try again
          </Button>
        </Card>
      ) : loading ? (
        <div className="requisition-collection" data-view={view}>
          {Array.from({ length: 6 }, (_, index) => (
            <SkeletonCard key={index} className={view === 'grid' ? 'h-72' : 'h-20'} />
          ))}
        </div>
      ) : (
        <>
          <div className="requisition-results">
            <p role="status">
              {numberFormat.format(visible.length)}{' '}
              {visible.length === 1 ? 'requisition' : 'requisitions'}
            </p>
            {hasFilters && (
              <button type="button" onClick={resetFilters}>
                Clear filters
              </button>
            )}
          </div>
          {visible.length === 0 ? (
            <Empty>
              {hasFilters
                ? 'No requisitions match the current filters.'
                : 'No job requisitions yet.'}
            </Empty>
          ) : (
            <div className="requisition-collection" data-view={view}>
              {visible.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  applicants={applicants?.get(job.id) ?? (applicants ? 0 : null)}
                  interviews={interviews?.get(job.id) ?? (interviews ? 0 : null)}
                  onDetails={() => {
                    setActionError(null);
                    setPanel({ kind: 'details', id: job.id });
                  }}
                  onApplication={() => setPanel({ kind: 'application', id: job.id })}
                />
              ))}
            </div>
          )}
        </>
      )}

      {showCreate && (
        <RequisitionFormModal
          onClose={() => setShowCreate(false)}
          onCreated={(job) => {
            setRequisitions((current) => [job, ...current]);
            resetFilters();
            if (loadError) reloadJobs();
          }}
        />
      )}
      {selectedJob && panel?.kind === 'details' && (
        <JobDetails
          job={selectedJob}
          busy={actionBusy}
          error={actionError}
          onClose={() => setPanel(null)}
          onPipeline={() => setPanel({ kind: 'pipeline', id: selectedJob.id })}
          onApplication={() => setPanel({ kind: 'application', id: selectedJob.id })}
          onAddCandidate={
            onAddCandidateForRequisition && selectedJob.status === 'open'
              ? () => {
                  setPanel(null);
                  onAddCandidateForRequisition(selectedJob);
                }
              : undefined
          }
          onChangeStatus={(status) => void changeStatus(selectedJob, status)}
        />
      )}
      {selectedJob && panel?.kind === 'application' && (
        <ApplicationLinkModal requisition={selectedJob} onClose={() => setPanel(null)} />
      )}
      {selectedJob && panel?.kind === 'pipeline' && (
        <Modal
          title={`Interview pipeline · ${selectedJob.title}`}
          onClose={() => setPanel(null)}
          dirty={false}
        >
          <p className="mb-3 text-xs text-app-muted">
            Define the interview rounds for this requisition. Drag to reorder them.
          </p>
          <PipelineRoundBuilder requisitionId={selectedJob.id} />
        </Modal>
      )}
    </WorkspacePageContainer>
  );
}

function Filter({
  label,
  icon,
  value,
  onChange,
  children,
}: {
  readonly label: string;
  readonly icon: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly children: ReactNode;
}) {
  return (
    <label className="requisition-filter">
      <Icon name={icon} className="size-4" />
      <span className="sr-only">{label}</span>
      <select
        className="ui-form-control"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
      <Icon name="chevron-down" className="size-3.5" />
    </label>
  );
}

function JobCard({
  job,
  applicants,
  interviews,
  onDetails,
  onApplication,
}: {
  readonly job: JobRequisition;
  readonly applicants: number | null;
  readonly interviews: number | null;
  readonly onDetails: () => void;
  readonly onApplication: () => void;
}) {
  const draft = job.status === 'draft';
  return (
    <article className="ui-card requisition-card" data-status={job.status}>
      <div className="requisition-card-identity">
        <div className="requisition-card-header">
          <RequisitionStatusBadge
            status={job.status}
            className="requisition-card-status"
          />
          <span className="requisition-card-department">
            <Icon name="building" className="size-3.5 shrink-0" />
            {job.departmentName ?? 'Department'}
          </span>
          <button
            type="button"
            className="requisition-icon-button"
            aria-label={`Application link for ${job.title}`}
            title="Student application link"
            onClick={onApplication}
          >
            <Icon name="link" className="size-4" />
          </button>
        </div>
        <h2>{job.title}</h2>
        <ul className="requisition-card-meta">
          <li>
            <Icon name="briefcase" className="size-3.5" />
            {employmentLabels[job.employmentType]}
          </li>
          {job.location && (
            <li>
              <Icon name="pin" className="size-3.5" />
              {job.location}
            </li>
          )}
          <li>
            <Icon name="users" className="size-3.5" />
            {job.openingsCount} {job.openingsCount === 1 ? 'opening' : 'openings'}
          </li>
        </ul>
      </div>

      {draft ? (
        <div className="requisition-draft">
          <span className="requisition-draft-icon">
            <Icon name="clipboard" className="size-6" />
          </span>
          <p>Ready for review and publication</p>
        </div>
      ) : (
        <>
          <dl className="requisition-card-metrics">
            <JobMetric label="Applicants" value={applicants} />
            <JobMetric label="Completed interviews" value={interviews} />
          </dl>
          <JobTimeline job={job} />
        </>
      )}

      <div className="requisition-card-footer">
        <span title={job.requisitionNumber}>{job.requisitionNumber}</span>
        <button
          className="requisition-details-action"
          type="button"
          aria-label={`${draft ? 'Review draft' : 'View details'} for ${job.title}`}
          onClick={onDetails}
        >
          {draft ? 'Review draft' : 'View details'}{' '}
          <Icon name="chevron-right" className="size-4" />
        </button>
      </div>
    </article>
  );
}

function JobMetric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: number | null;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {value === null ? (
          <span aria-label="Count unavailable">—</span>
        ) : (
          numberFormat.format(value)
        )}
      </dd>
    </div>
  );
}

function calendarDay(date: Date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

function JobTimeline({ job }: { readonly job: JobRequisition }) {
  const created = new Date(job.createdAt);
  const closed = job.closedAt ? new Date(job.closedAt) : null;
  const target = job.targetHireDate ? new Date(job.targetHireDate) : null;
  const now = calendarDay(new Date());
  const start = calendarDay(created);
  const end = target?.getTime();
  const remaining = end === undefined ? NaN : Math.round((end - now) / dayMs);
  const active = job.status === 'open' || job.status === 'on_hold';
  const showProgress = active && end !== undefined && end > start;
  const progress = showProgress
    ? Math.max(0, Math.min(100, ((now - start) / (end - start)) * 100))
    : 0;

  return (
    <div className="requisition-timeline">
      <div className="requisition-timeline-dates">
        <p>
          <Icon name="calendar" className="size-3.5 shrink-0" />
          <span>
            Created <time dateTime={job.createdAt}>{dateFormat.format(created)}</time>
          </span>
        </p>
        {closed ? (
          <p>
            Closed{' '}
            <time dateTime={job.closedAt ?? undefined}>{dateFormat.format(closed)}</time>
          </p>
        ) : (
          target && (
            <p>
              Target{' '}
              <time dateTime={job.targetHireDate ?? undefined}>
                {targetDateFormat.format(target)}
              </time>
            </p>
          )
        )}
      </div>
      {active && Number.isFinite(remaining) && (
        <div className="requisition-timeline-progress">
          {showProgress && (
            <div className="requisition-timeline-track" aria-hidden="true">
              <span style={{ inlineSize: `${progress}%` }} />
            </div>
          )}
          <span>
            {remaining < 0
              ? 'Target passed'
              : remaining === 0
                ? 'Target today'
                : `${remaining} ${remaining === 1 ? 'day' : 'days'} to target`}
          </span>
        </div>
      )}
    </div>
  );
}

function JobDetails({
  job,
  busy,
  error,
  onClose,
  onPipeline,
  onApplication,
  onAddCandidate,
  onChangeStatus,
}: {
  readonly job: JobRequisition;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onPipeline: () => void;
  readonly onApplication: () => void;
  readonly onAddCandidate: (() => void) | undefined;
  readonly onChangeStatus: (status: RequisitionStatus) => void;
}) {
  const transition = nextStatus[job.status];
  const titleQuery = encodeURIComponent(job.title);
  const titleSlug = encodeURIComponent(job.title.toLowerCase().replace(/\s+/g, '-'));
  const jobBoards = [
    ['LinkedIn', `https://www.linkedin.com/jobs/search/?keywords=${titleQuery}`],
    ['Naukri', `https://www.naukri.com/${titleSlug}-jobs`],
    ['Indeed', `https://in.indeed.com/jobs?q=${titleQuery}`],
    ['Internshala', `https://internshala.com/jobs/${titleSlug}`],
  ];
  return (
    <Modal
      title={job.title}
      onClose={onClose}
      dirty={false}
      footer={
        transition && (
          <div className="flex justify-end">
            <Button
              kind={job.status === 'open' ? 'secondary' : 'primary'}
              disabled={busy}
              onClick={() => onChangeStatus(transition.status)}
            >
              {busy ? 'Updating…' : transition.label}
            </Button>
          </div>
        )
      }
    >
      <div className="space-y-5">
        {error && <ErrorToast message={error} />}
        <div className="flex flex-wrap items-center gap-2.5">
          <RequisitionStatusBadge status={job.status} />
          <span className="text-sm text-app-muted">{job.requisitionNumber}</span>
        </div>
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          {[
            ['Department', job.departmentName],
            ['Position', job.positionName],
            ['Employment type', employmentLabels[job.employmentType]],
            ['Location', job.location],
            ['Openings', job.openingsCount],
            [
              'Target hire date',
              job.targetHireDate
                ? targetDateFormat.format(new Date(job.targetHireDate))
                : null,
            ],
          ].map(
            ([label, value]) =>
              value != null &&
              value !== '' && (
                <div key={label} className="min-w-0">
                  <dt className="text-xs text-app-muted">{label}</dt>
                  <dd className="mt-1 font-medium break-words">{value}</dd>
                </div>
              ),
          )}
        </dl>
        {job.description && (
          <section>
            <h3 className="text-sm font-semibold">Job description</h3>
            <p className="mt-1.5 text-sm whitespace-pre-wrap break-words text-app-muted">
              {job.description}
            </p>
          </section>
        )}
        {job.requirements && (
          <section>
            <h3 className="text-sm font-semibold">Requirements</h3>
            <p className="mt-1.5 text-sm whitespace-pre-wrap break-words text-app-muted">
              {job.requirements}
            </p>
          </section>
        )}
        <div className="flex flex-wrap gap-2 border-t border-app-border pt-4">
          <Button kind="secondary" onClick={onPipeline}>
            <Icon name="hierarchy" className="size-4" /> Interview Pipeline
          </Button>
          <Button kind="secondary" onClick={onApplication}>
            <Icon name="link" className="size-4" /> Student Application Link
          </Button>
          {onAddCandidate && (
            <Button kind="secondary" onClick={onAddCandidate}>
              <Icon name="user-plus" className="size-4" /> Add Candidate
            </Button>
          )}
        </div>
        <section>
          <h3 className="text-xs font-semibold text-app-muted">Search job boards</h3>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
            {jobBoards.map(([name, href]) => (
              <a
                key={name}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm font-medium hover:text-app-accent hover:underline"
              >
                {name}
                <Icon name="external-link" className="size-3" />
              </a>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  );
}
