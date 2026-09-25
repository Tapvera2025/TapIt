import { useEffect, useState } from 'react';
import { Card, Empty, Loading, Notice, Page } from '../../../ui/components.js';
import { listCandidates, listRequisitions } from '../api/recruitmentApi.js';
import { CandidateDetailModal } from '../components/CandidateDetailModal.js';
import { CandidateFormModal } from '../components/CandidateFormModal.js';
import { CandidateStatusBadge } from '../components/StatusBadge.js';
import type {
  Candidate,
  CandidateFilter,
  CandidateSource,
  CandidateStatus,
  JobRequisition,
} from '../types/index.js';

export function CandidatesPage({
  onScheduleInterview,
  onCreateOffer,
}: {
  readonly onScheduleInterview?: (candidate: Candidate) => void;
  readonly onCreateOffer?: (candidate: Candidate) => void;
}): React.JSX.Element {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [requisitions, setRequisitions] = useState<JobRequisition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<CandidateStatus | 'all'>('all');
  const [sourceFilter, setSourceFilter] = useState<CandidateSource | 'all'>('all');
  const [reqFilter, setReqFilter] = useState<string>('all');

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);

  async function load() {
    setLoading(true);
    try {
      const filter: CandidateFilter = {
        search: search.trim() || undefined,
        status: statusFilter,
        source: sourceFilter,
        requisitionId: reqFilter !== 'all' ? reqFilter : undefined,
      };
      const [cands, reqs] = await Promise.all([
        listCandidates(filter),
        listRequisitions(),
      ]);
      setCandidates(cands);
      setRequisitions(reqs);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load candidates');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [statusFilter, sourceFilter, reqFilter]);

  const visible = candidates.filter((c) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      (c.fullName?.toLowerCase().includes(s) ?? false) ||
      c.firstName.toLowerCase().includes(s) ||
      c.lastName.toLowerCase().includes(s) ||
      c.email.toLowerCase().includes(s) ||
      (c.requisitionTitle?.toLowerCase().includes(s) ?? false) ||
      (c.requisitionNumber?.toLowerCase().includes(s) ?? false)
    );
  });

  return (
    <Page
      eyebrow="People / HR"
      title="Candidate Pipeline"
      description="Talent pool management, applicant tracking, screening, evaluation stages, and selection records."
      action={
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="rounded-lg bg-app-accent px-4 py-2.5 text-sm font-bold text-app-on-accent hover:opacity-90"
        >
          + Add Candidate
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
        <div className="grid gap-3 sm:grid-cols-4">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search candidate name, email, or role..."
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent"
            aria-label="Search candidates"
          />

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as CandidateStatus | 'all')}
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent"
            aria-label="Filter by candidate status"
          >
            <option value="all">All Candidate Statuses</option>
            <option value="applied">Applied (New)</option>
            <option value="screening">Screening</option>
            <option value="interview">Interviewing</option>
            <option value="selected">Selected</option>
            <option value="rejected">Rejected</option>
            <option value="withdrawn">Withdrawn</option>
          </select>

          <select
            value={reqFilter}
            onChange={(e) => setReqFilter(e.target.value)}
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent"
            aria-label="Filter by applied requisition"
          >
            <option value="all">All Requisitions</option>
            {requisitions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.requisitionNumber} - {r.title}
              </option>
            ))}
          </select>

          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as CandidateSource | 'all')}
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent"
            aria-label="Filter by source"
          >
            <option value="all">All Application Sources</option>
            <option value="linkedin">LinkedIn</option>
            <option value="direct">Direct</option>
            <option value="referral">Referral</option>
            <option value="career_site">Career Site</option>
            <option value="job_board">Job Board</option>
            <option value="agency">Agency</option>
            <option value="internal">Internal</option>
            <option value="other">Other</option>
          </select>
        </div>
      </Card>

      {/* Candidates List Table */}
      {loading ? (
        <div className="mt-6">
          <Loading />
        </div>
      ) : visible.length === 0 ? (
        <Empty>
          No candidates found matching the current filters. Add a new applicant or broaden your search criteria.
        </Empty>
      ) : (
        <section className="mt-6 overflow-hidden rounded-2xl border border-app-border bg-app-surface">
          <div className="hidden border-b border-app-border bg-app-surface-raised px-5 py-3 text-xs font-bold uppercase tracking-wider text-app-muted md:grid md:grid-cols-[1.5fr_1.4fr_0.9fr_1fr_0.9fr_1.3fr] md:items-center">
            <span>Candidate Name</span>
            <span>Applied Requisition</span>
            <span>Source</span>
            <span>Status</span>
            <span>Applied Date</span>
            <span className="text-right">Actions</span>
          </div>

          <div className="divide-y divide-app-border">
            {visible.map((cand) => (
              <div
                key={cand.id}
                className="grid gap-2 px-5 py-4 text-sm md:grid-cols-[1.5fr_1.4fr_0.9fr_1fr_0.9fr_1.3fr] md:items-center"
              >
                <div>
                  <button
                    type="button"
                    onClick={() => setSelectedCandidate(cand)}
                    className="font-semibold text-left text-app-foreground hover:text-app-accent hover:underline"
                  >
                    {cand.fullName ?? `${cand.firstName} ${cand.lastName}`}
                  </button>
                  <p className="text-xs text-app-muted">{cand.email}</p>
                  {cand.phone && <p className="text-xs text-app-muted">{cand.phone}</p>}
                </div>

                <div>
                  <p className="font-medium text-xs">
                    {cand.requisitionTitle ?? 'Requisition'}
                  </p>
                  <p className="text-[11px] font-mono text-app-muted">
                    {cand.requisitionNumber ?? 'REQ'}
                  </p>
                </div>

                <div className="capitalize text-xs text-app-muted">
                  {cand.source.replace('_', ' ')}
                </div>

                <div>
                  <CandidateStatusBadge status={cand.status} />
                </div>

                <div className="text-xs text-app-muted">
                  {new Date(cand.createdAt).toLocaleDateString()}
                </div>

                <div className="flex flex-wrap items-center justify-end gap-1.5 pt-2 md:pt-0">
                  <button
                    type="button"
                    onClick={() => setSelectedCandidate(cand)}
                    className="rounded border border-app-border px-2.5 py-1 text-xs font-semibold text-app-foreground hover:border-app-accent hover:text-app-accent"
                  >
                    Workflow Details
                  </button>

                  {cand.status === 'interview' && onScheduleInterview && (
                    <button
                      type="button"
                      onClick={() => onScheduleInterview(cand)}
                      className="rounded bg-app-accent/15 px-2.5 py-1 text-xs font-semibold text-app-accent hover:bg-app-accent/25"
                    >
                      + Schedule
                    </button>
                  )}

                  {cand.status === 'selected' && onCreateOffer && (
                    <button
                      type="button"
                      onClick={() => onCreateOffer(cand)}
                      className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-emerald-700"
                    >
                      Make Offer
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {showAddModal && (
        <CandidateFormModal
          requisitions={requisitions}
          onClose={() => setShowAddModal(false)}
          onCreated={(newCand) => {
            setCandidates((prev) => [newCand, ...prev]);
            setSelectedCandidate(newCand);
          }}
        />
      )}

      {selectedCandidate && (
        <CandidateDetailModal
          candidate={selectedCandidate}
          onClose={() => setSelectedCandidate(null)}
          onUpdated={(updated) => {
            setCandidates((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
            setSelectedCandidate(updated);
          }}
          onScheduleInterview={onScheduleInterview}
          onCreateOffer={onCreateOffer}
        />
      )}
    </Page>
  );
}
