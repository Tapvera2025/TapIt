import { useEffect, useState } from 'react';
import { atsScanSummary, type AtsCriteriaSettings, type AtsScanSummary } from '@tapcrm/contracts';
import { Card, Empty, Notice, Page, SkeletonTable } from '../../../ui/components.js';
import {
  getAtsCriteria,
  listRequisitions,
  listResumeSubmissions,
  runAtsScan,
} from '../api/recruitmentApi.js';
import { ResumeSubmissionStatusBadge } from '../components/StatusBadge.js';
import { ResumeUploadModal } from '../components/ResumeUploadModal.js';
import { ResumeReviewModal } from '../components/ResumeReviewModal.js';
import { AtsScoreBadge } from '../components/AtsScoreBadge.js';
import { AtsCriteriaModal } from '../components/AtsCriteriaModal.js';
import {
  submissionSource,
  type CandidateResumeSubmission,
  type JobRequisition,
  type ResumeSubmissionStatus,
} from '../types/index.js';

type SortOrder = 'newest' | 'ats';

interface BulkScan {
  readonly count: number;
  readonly done: number;
  readonly failed: number;
  readonly firstError: string | null;
  readonly running: boolean;
}

function isOpen(submission: CandidateResumeSubmission): boolean {
  return submission.status === 'submitted' || submission.status === 'reviewed';
}

/** Open applications without a current ATS report. */
function needsScan(submission: CandidateResumeSubmission): boolean {
  return isOpen(submission) && (!submission.ats || submission.ats.stale);
}

const SELECT_CLASS =
  'w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm text-app-foreground outline-none focus:border-app-accent';

export function ResumeInboxPage({
  onNavigateToCandidate,
}: {
  readonly onNavigateToCandidate?: (candidateId: string) => void;
}): React.JSX.Element {
  const [submissions, setSubmissions] = useState<CandidateResumeSubmission[]>([]);
  const [requisitions, setRequisitions] = useState<JobRequisition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ResumeSubmissionStatus | 'all'>('all');
  const [reqFilter, setReqFilter] = useState<string>('all');
  const [sort, setSort] = useState<SortOrder>('newest');

  // Modals
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedSubmission, setSelectedSubmission] = useState<CandidateResumeSubmission | null>(null);
  const [criteriaModal, setCriteriaModal] = useState<{ settings: AtsCriteriaSettings | undefined; thenScan: boolean } | null>(null);

  // ATS bulk scanning for the selected job
  const [bulk, setBulk] = useState<BulkScan | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [subs, reqs] = await Promise.all([
        listResumeSubmissions({
          search: search.trim() || undefined,
          status: statusFilter,
          requisitionId: reqFilter !== 'all' ? reqFilter : undefined,
        }),
        listRequisitions(),
      ]);
      setSubmissions(subs);
      setRequisitions(reqs);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load resume submissions');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    setBulk(null);
  }, [statusFilter, reqFilter]);

  function updateAts(submissionId: string, summary: AtsScanSummary) {
    setSubmissions((previous) => previous.map((s) => (s.id === submissionId ? { ...s, ats: summary } : s)));
  }

  const visible = submissions
    .filter((s) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        s.firstName.toLowerCase().includes(q) ||
        s.lastName.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q) ||
        (s.requisitionTitle?.toLowerCase().includes(q) ?? false) ||
        (s.requisitionNumber?.toLowerCase().includes(q) ?? false) ||
        (s.parsedData?.skills?.some((sk) => sk.toLowerCase().includes(q)) ?? false)
      );
    })
    .sort((a, b) => {
      if (sort === 'ats') {
        const scoreA = a.ats?.score ?? -1;
        const scoreB = b.ats?.score ?? -1;
        if (scoreA !== scoreB) return scoreB - scoreA;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const selectedRequisition = reqFilter !== 'all' ? requisitions.find((r) => r.id === reqFilter) ?? null : null;
  const requisitionLabel = selectedRequisition
    ? `${selectedRequisition.requisitionNumber} — ${selectedRequisition.title}`
    : '';
  const toScan = visible.filter(needsScan);

  async function scanAll(queue: CandidateResumeSubmission[]) {
    let done = 0;
    let failed = 0;
    let firstError: string | null = null;
    setBulk({ count: queue.length, done, failed, firstError, running: true });
    // One at a time: each scan reads a file and parses it on the server.
    for (const submission of queue) {
      try {
        const report = await runAtsScan(submission.id);
        updateAts(submission.id, atsScanSummary(report));
      } catch (cause) {
        failed += 1;
        firstError ??= cause instanceof Error ? cause.message : 'Scan failed';
      }
      done += 1;
      setBulk({ count: queue.length, done, failed, firstError, running: done < queue.length });
    }
  }

  async function startBulkScan() {
    if (!selectedRequisition || toScan.length === 0) return;
    setError(null);
    try {
      const settings = await getAtsCriteria(selectedRequisition.id);
      if (!settings.configured) {
        setCriteriaModal({ settings, thenScan: true });
        return;
      }
      await scanAll(toScan);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to start the ATS scan');
    }
  }

  return (
    <Page variant="recruitment"
      eyebrow="People / HR"
      title="Resume Inbox"
      description="Collect resumes, screen them against each job's ATS criteria, then accept or reject with the evidence in front of you."
      action={
        <button
          type="button"
          onClick={() => setShowUploadModal(true)}
          className="w-full rounded-xl bg-app-accent px-5 py-2.5 text-center text-sm font-semibold text-app-on-accent shadow-xs transition hover:opacity-90 sm:w-auto"
        >
          + Upload Resume
        </button>
      }
    >
      {error && (
        <div className="mt-6">
          <Notice error>{error}</Notice>
        </div>
      )}

      {/* Filters Bar */}
      <Card className="mt-6 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search candidate name, email, skills..."
            className={SELECT_CLASS}
            aria-label="Search resume submissions"
          />

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ResumeSubmissionStatus | 'all')}
            className={SELECT_CLASS}
            aria-label="Filter by submission status"
          >
            <option value="all">All Submission Statuses</option>
            <option value="submitted">New (Submitted)</option>
            <option value="reviewed">Reviewed</option>
            <option value="converted">Added as Candidate</option>
            <option value="rejected">Rejected</option>
          </select>

          <select
            value={reqFilter}
            onChange={(e) => setReqFilter(e.target.value)}
            className={SELECT_CLASS}
            aria-label="Filter by job requisition"
          >
            <option value="all">All Requisitions</option>
            {requisitions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.requisitionNumber} - {r.title}
              </option>
            ))}
          </select>

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOrder)}
            className={SELECT_CLASS}
            aria-label="Sort resume submissions"
          >
            <option value="newest">Newest first</option>
            <option value="ats">Highest ATS score first</option>
          </select>
        </div>

        {/* ATS screening for the selected job */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-app-border pt-3">
          {selectedRequisition ? (
            <>
              <p className="text-xs text-app-muted">
                <span className="font-semibold text-app-foreground">ATS screening</span> for {requisitionLabel}
                {bulk?.running
                  ? ` · Scanning ${Math.min(bulk.done + 1, bulk.count)} of ${bulk.count}…`
                  : toScan.length > 0
                    ? ` · ${toScan.length} open application${toScan.length === 1 ? '' : 's'} without a current score`
                    : ' · every open application has a current score'}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setCriteriaModal({ settings: undefined, thenScan: false })}
                  disabled={bulk?.running}
                  className="rounded-lg border border-app-border px-3 py-1.5 text-xs font-semibold text-app-foreground hover:border-app-accent hover:text-app-accent disabled:opacity-50"
                >
                  Screening criteria
                </button>
                <button
                  type="button"
                  onClick={() => void startBulkScan()}
                  disabled={bulk?.running || toScan.length === 0}
                  className="ui-primary rounded-lg px-3 py-1.5 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {bulk?.running ? 'Scanning…' : toScan.length === 0 ? 'All scanned' : `Scan ${toScan.length} unscanned`}
                </button>
              </div>
            </>
          ) : (
            <p className="text-xs text-app-muted">
              Choose a job above to set its ATS screening criteria and scan all of its applications in one go.
            </p>
          )}
        </div>
        {bulk && !bulk.running && (
          <p className={`mt-2 text-xs ${bulk.failed > 0 ? 'text-app-danger' : 'text-app-muted'}`} role="status">
            Scanned {bulk.count - bulk.failed} of {bulk.count}.
            {bulk.failed > 0 && bulk.firstError ? ` ${bulk.failed} could not be scanned: ${bulk.firstError}` : ''}
          </p>
        )}
      </Card>

      {/* Submissions Table / List */}
      {loading ? (
        <div className="mt-6">
          <SkeletonTable columns={5} rows={6} />
        </div>
      ) : visible.length === 0 ? (
        <Empty>
          No resume submissions match your criteria. Applications submitted through your student
          links or HR manual uploads will appear here.
        </Empty>
      ) : (
        <section className="mt-6 overflow-hidden rounded-2xl border border-app-border bg-app-surface">
          <div className="hidden border-b border-app-border bg-app-surface-raised px-5 py-3 text-xs font-bold uppercase tracking-wider text-app-muted md:grid md:grid-cols-[1.6fr_1.3fr_1.2fr_1.1fr_0.8fr_0.9fr_1.1fr] md:items-center">
            <span>Candidate</span>
            <span>Applied Requisition</span>
            <span>Parsed Skills</span>
            <span>ATS Score</span>
            <span>Submitted</span>
            <span>Status</span>
            <span className="text-right">Actions</span>
          </div>

          <div className="divide-y divide-app-border">
            {visible.map((sub) => (
              <div
                key={sub.id}
                className="grid gap-2 px-5 py-4 text-sm md:grid-cols-[1.6fr_1.3fr_1.2fr_1.1fr_0.8fr_0.9fr_1.1fr] md:items-center"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-app-foreground">
                    {sub.firstName} {sub.lastName}
                  </p>
                  <p className="truncate text-xs text-app-muted">{sub.email}</p>
                  <span
                    className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      submissionSource(sub) === 'application_link'
                        ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300'
                        : 'bg-purple-500/10 text-purple-700 dark:text-purple-300'
                    }`}
                  >
                    {submissionSource(sub) === 'application_link' ? 'Application link' : 'HR upload'}
                  </span>
                </div>

                <div>
                  <p className="font-medium text-app-foreground">
                    {sub.requisitionTitle ?? 'Requisition'}
                  </p>
                  <p className="text-xs font-mono text-app-muted">{sub.requisitionNumber}</p>
                </div>

                <div className="flex flex-wrap gap-1 overflow-hidden">
                  {sub.parsedData?.skills && sub.parsedData.skills.length > 0 ? (
                    sub.parsedData.skills.slice(0, 3).map((skill) => (
                      <span
                        key={skill}
                        className="rounded border border-app-border bg-app-surface-raised px-1.5 py-0.5 text-[10px] font-medium capitalize text-app-muted"
                      >
                        {skill}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-app-muted">—</span>
                  )}
                  {sub.parsedData?.skills && sub.parsedData.skills.length > 3 && (
                    <span className="text-[10px] text-app-muted">
                      +{sub.parsedData.skills.length - 3}
                    </span>
                  )}
                </div>

                <div>
                  <span className="mr-2 text-xs text-app-muted md:hidden">ATS:</span>
                  <AtsScoreBadge summary={sub.ats} />
                </div>

                <div className="text-xs text-app-muted">
                  {new Date(sub.createdAt).toLocaleDateString()}
                </div>

                <div>
                  <ResumeSubmissionStatusBadge status={sub.status} />
                </div>

                <div className="flex items-center justify-end gap-1.5 pt-2 md:pt-0">
                  <button
                    type="button"
                    onClick={() => setSelectedSubmission(sub)}
                    className={
                      isOpen(sub)
                        ? 'rounded bg-app-accent px-2.5 py-1 text-xs font-bold text-app-on-accent hover:opacity-90'
                        : 'rounded border border-app-border px-2.5 py-1 text-xs font-semibold text-app-foreground hover:border-app-accent hover:text-app-accent'
                    }
                  >
                    {isOpen(sub) ? (sub.ats && !sub.ats.stale ? 'Review & decide' : 'Review & scan') : 'View'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <ResumeUploadModal
          requisitions={requisitions}
          onClose={() => setShowUploadModal(false)}
          onUploaded={(newSub) => {
            // The upload response has no job details; take them from the job list so the row and review window name the job.
            const job = requisitions.find((requisition) => requisition.id === newSub.requisitionId);
            const withAts = {
              ...newSub,
              requisitionTitle: newSub.requisitionTitle ?? job?.title,
              requisitionNumber: newSub.requisitionNumber ?? job?.requisitionNumber,
              ats: null,
            };
            setSubmissions((prev) => [withAts, ...prev]);
            setShowUploadModal(false);
            setSelectedSubmission(withAts);
          }}
        />
      )}

      {/* Review Modal */}
      {selectedSubmission && (
        <ResumeReviewModal
          submission={selectedSubmission}
          onClose={() => setSelectedSubmission(null)}
          onUpdated={(updated) => {
            setSubmissions((prev) => prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)));
          }}
          onAtsUpdated={updateAts}
          onCandidateCreated={(candId) => {
            if (onNavigateToCandidate) {
              onNavigateToCandidate(candId);
            }
          }}
        />
      )}

      {/* ATS criteria for the selected job */}
      {criteriaModal && selectedRequisition && (
        <AtsCriteriaModal
          requisitionId={selectedRequisition.id}
          requisitionLabel={requisitionLabel}
          initial={criteriaModal.settings}
          saveLabel={criteriaModal.thenScan ? `Save & scan ${toScan.length}` : 'Save criteria'}
          onClose={() => setCriteriaModal(null)}
          onSaved={() => {
            const thenScan = criteriaModal.thenScan;
            setCriteriaModal(null);
            // Saved criteria can make earlier reports stale: refresh, then scan if asked.
            void load().then(async () => {
              if (!thenScan) return;
              const fresh = await listResumeSubmissions({ requisitionId: selectedRequisition.id, status: statusFilter });
              setSubmissions(fresh);
              await scanAll(fresh.filter(needsScan));
            });
          }}
        />
      )}
    </Page>
  );
}
