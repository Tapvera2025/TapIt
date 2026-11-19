import type {
  Candidate,
  CandidateJoining,
  CandidateSource,
  EmploymentType,
  Interview,
  JobOffer,
  JobRequisition,
  RequisitionStatus,
} from '../types/index.js';

export const employmentLabels: Record<EmploymentType, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contract: 'Contract',
  internship: 'Internship',
};

export const pipelineStages = [
  { key: 'applied', label: 'Applied' },
  { key: 'screening', label: 'Screening', shortLabel: 'Screen' },
  { key: 'interview', label: 'Interviews', shortLabel: 'Interview' },
  { key: 'selected', label: 'Selected', shortLabel: 'Select' },
  { key: 'offers', label: 'Offers' },
  { key: 'joining', label: 'Joining' },
] as const;

type PipelineStage = (typeof pipelineStages)[number]['key'];

const sourceCategories = [
  { key: 'job_board', label: 'Job boards' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'referral', label: 'Referrals' },
  { key: 'career_site', label: 'Career site' },
  { key: 'direct', label: 'Direct' },
  { key: 'agency', label: 'Agency' },
  { key: 'internal', label: 'Internal' },
  { key: 'other', label: 'Other' },
] as const satisfies ReadonlyArray<{ key: CandidateSource; label: string }>;

const requisitionStatuses = [
  { key: 'open', label: 'Open' },
  { key: 'on_hold', label: 'On hold' },
  { key: 'filled', label: 'Filled' },
  { key: 'draft', label: 'Draft' },
  { key: 'closed', label: 'Closed' },
  { key: 'cancelled', label: 'Cancelled' },
] as const satisfies ReadonlyArray<{ key: RequisitionStatus; label: string }>;

export interface RecruitmentOverviewData {
  readonly requisitions: JobRequisition[];
  readonly candidates: Candidate[];
  readonly interviews: Interview[];
  readonly offers: JobOffer[];
  readonly joinings: CandidateJoining[];
}

function pipelineCounts(data: RecruitmentOverviewData) {
  const offerCandidates = new Set(data.offers
    .filter(({ status }) => status === 'draft' || status === 'sent' || status === 'accepted')
    .map(({ candidateId }) => candidateId));
  const joiningCandidates = new Set(data.joinings
    .filter(({ status }) => status !== 'cancelled')
    .map(({ candidateId }) => candidateId));
  const byRequisition = new Map<string, Record<PipelineStage, number>>();

  for (const candidate of data.candidates) {
    if (candidate.status === 'rejected' || candidate.status === 'withdrawn') continue;

    let counts = byRequisition.get(candidate.requisitionId);
    if (!counts) {
      counts = { applied: 0, screening: 0, interview: 0, selected: 0, offers: 0, joining: 0 };
      byRequisition.set(candidate.requisitionId, counts);
    }

    if (joiningCandidates.has(candidate.id)) counts.joining += 1;
    else if (offerCandidates.has(candidate.id)) counts.offers += 1;
    else counts[candidate.status] += 1;
  }

  return byRequisition;
}

function localDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function localDayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function weeklyActivity(dates: readonly string[], now: Date) {
  const today = localDay(now);
  const days = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(today);
    date.setDate(date.getDate() - 13 + index);
    return { date, count: 0 };
  });
  const byDay = new Map(days.map((day) => [localDayKey(day.date), day]));

  for (const value of dates) {
    const day = byDay.get(localDayKey(new Date(value)));
    if (day) day.count += 1;
  }

  const sum = (period: typeof days) => period.reduce((total, day) => total + day.count, 0);
  const current = days.slice(7);
  return { days: current, difference: sum(current) - sum(days.slice(0, 7)) };
}

export function summarizeOverview(data: RecruitmentOverviewData, now: Date) {
  const { candidates, interviews, requisitions } = data;
  const candidateIds = new Set(candidates.map(({ id }) => id));
  const completed = interviews.filter(({ status }) => status === 'completed');
  const upcoming = interviews
    .filter(({ status, scheduledAt, candidateId }) => status === 'scheduled'
      && Date.parse(scheduledAt) >= now.getTime() && candidateIds.has(candidateId))
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))
    .slice(0, 3);
  const sourceCounts = new Map<CandidateSource, number>();
  const statusCounts = new Map<RequisitionStatus, number>();
  for (const { source } of candidates) sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
  for (const { status } of requisitions) statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);

  return {
    applicantCount: candidates.length,
    openJobs: requisitions.filter(({ status }) => status === 'open'),
    pipeline: pipelineCounts(data),
    upcoming,
    sources: sourceCategories
      .map((source) => ({ ...source, count: sourceCounts.get(source.key) ?? 0 }))
      .filter(({ count }) => count > 0),
    jobStatuses: requisitionStatuses.map((status) => ({ ...status, count: statusCounts.get(status.key) ?? 0 })),
    recentApplicants: [...candidates]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, 5),
    applicantActivity: weeklyActivity(candidates.map(({ createdAt }) => createdAt), now),
    interviewActivity: weeklyActivity(completed.map(({ scheduledAt }) => scheduledAt), now),
    completedInterviews: completed.length,
    requisitionActivity: weeklyActivity(requisitions.map(({ createdAt }) => createdAt), now),
  };
}
