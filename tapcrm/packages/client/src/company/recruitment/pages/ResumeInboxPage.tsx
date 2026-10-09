import { useEffect, useState } from 'react';
import { Card, Empty, Notice, Page, SkeletonTable } from '../../../ui/components.js';
import {
  listRequisitions,
  listResumeSubmissions,
} from '../api/recruitmentApi.js';
import { ResumeSubmissionStatusBadge } from '../components/StatusBadge.js';
import { ResumeUploadModal } from '../components/ResumeUploadModal.js';
import { ResumeReviewModal } from '../components/ResumeReviewModal.js';
import type {
  CandidateResumeSubmission,
  JobRequisition,
  ResumeSubmissionStatus,
} from '../types/index.js';

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

  // Modals
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedSubmission, setSelectedSubmission] = useState<CandidateResumeSubmission | null>(null);

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
  }, [statusFilter, reqFilter]);

  const visible = submissions.filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      s.firstName.toLowerCase().includes(q) ||
      s.lastName.toLowerCase().includes(q) ||
      s.email.toLowerCase().includes(q) ||
      (s.requisitionTitle?.toLowerCase().includes(q) ?? false) ||
      (s.requisitionNumber?.toLowerCase().includes(q) ?? false) ||
      (s.parsedData?.skills.some((sk) => sk.toLowerCase().includes(q)) ?? false)
    );
  });

  return (
    <Page
      eyebrow="People / HR"
      title="Resume Inbox"
      description="Candidate resume collection, automated parsing intelligence, review queue, and pipeline conversion."
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
        <div className="grid gap-3 sm:grid-cols-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search candidate name, email, skills..."
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm text-app-foreground outline-none focus:border-app-accent"
            aria-label="Search resume submissions"
          />

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ResumeSubmissionStatus | 'all')}
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm text-app-foreground outline-none focus:border-app-accent"
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
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm text-app-foreground outline-none focus:border-app-accent"
            aria-label="Filter by job requisition"
          >
            <option value="all">All Requisitions</option>
            {requisitions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.requisitionNumber} - {r.title}
              </option>
            ))}
          </select>
        </div>
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
          <div className="hidden border-b border-app-border bg-app-surface-raised px-5 py-3 text-xs font-bold uppercase tracking-wider text-app-muted md:grid md:grid-cols-[1.5fr_1.4fr_1fr_1.2fr_1fr_1fr_1.1fr] md:items-center">
            <span>Candidate Name</span>
            <span>Applied Requisition</span>
            <span>Channel</span>
            <span>Parsed Skills</span>
            <span>Submitted</span>
            <span>Status</span>
            <span className="text-right">Actions</span>
          </div>

          <div className="divide-y divide-app-border">
            {visible.map((sub) => (
              <div
                key={sub.id}
                className="grid gap-2 px-5 py-4 text-sm md:grid-cols-[1.5fr_1.4fr_1fr_1.2fr_1fr_1fr_1.1fr] md:items-center"
              >
                <div>
                  <p className="font-semibold text-app-foreground">
                    {sub.firstName} {sub.lastName}
                  </p>
                  <p className="text-xs text-app-muted truncate">{sub.email}</p>
                  {sub.phone && <p className="text-xs text-app-muted">{sub.phone}</p>}
                </div>

                <div>
                  <p className="font-medium text-app-foreground">
                    {sub.requisitionTitle ?? 'Requisition'}
                  </p>
                  <p className="text-xs font-mono text-app-muted">{sub.requisitionNumber}</p>
                </div>

                <div>
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                      sub.source === 'application_link'
                        ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300'
                        : 'bg-purple-500/10 text-purple-700 dark:text-purple-300'
                    }`}
                  >
                    {sub.source === 'application_link' ? 'Campus Link' : 'HR Upload'}
                  </span>
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
                    className="rounded border border-app-border px-2.5 py-1 text-xs font-semibold text-app-foreground hover:border-app-accent hover:text-app-accent"
                  >
                    Review
                  </button>

                  {sub.status === 'submitted' && (
                    <button
                      type="button"
                      onClick={() => setSelectedSubmission(sub)}
                      className="rounded bg-app-accent px-2.5 py-1 text-xs font-bold text-app-on-accent hover:opacity-90"
                    >
                      + Candidate
                    </button>
                  )}
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
            setSubmissions((prev) => [newSub, ...prev]);
            setShowUploadModal(false);
            setSelectedSubmission(newSub);
          }}
        />
      )}

      {/* Review Modal */}
      {selectedSubmission && (
        <ResumeReviewModal
          submission={selectedSubmission}
          onClose={() => setSelectedSubmission(null)}
          onUpdated={(updated) => {
            setSubmissions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
          }}
          onCandidateCreated={(candId) => {
            if (onNavigateToCandidate) {
              onNavigateToCandidate(candId);
            }
          }}
        />
      )}
    </Page>
  );
}
