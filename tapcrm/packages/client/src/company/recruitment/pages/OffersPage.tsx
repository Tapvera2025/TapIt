import { useEffect, useState } from 'react';
import { Card, Empty, Notice, Page, SkeletonTable } from '../../../ui/components.js';
import { listCandidates, listOffers, listRequisitions, updateOfferStatus } from '../api/recruitmentApi.js';
import { OfferFormModal } from '../components/OfferFormModal.js';
import { OfferStatusBadge } from '../components/StatusBadge.js';
import type {
  Candidate,
  JobOffer,
  JobRequisition,
  OfferFilter,
  OfferStatus,
} from '../types/index.js';

export function OffersPage({
  preselectedCandidate,
  onNavigateToJoining,
}: {
  readonly preselectedCandidate?: Candidate | undefined;
  readonly onNavigateToJoining?: () => void;
}): React.JSX.Element {
  const [offers, setOffers] = useState<JobOffer[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [requisitions, setRequisitions] = useState<JobRequisition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<OfferStatus | 'all'>('all');

  // Modals & Action
  const [showCreateModal, setShowCreateModal] = useState(Boolean(preselectedCandidate));
  const [actionBusy, setActionBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const filter: OfferFilter = {
        status: statusFilter,
      };
      const [offs, cands, reqs] = await Promise.all([
        listOffers(filter),
        listCandidates(),
        listRequisitions(),
      ]);
      setOffers(offs);
      setCandidates(cands);
      setRequisitions(reqs);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load offers');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [statusFilter]);

  async function handleStatusChange(offer: JobOffer, nextStatus: OfferStatus) {
    setActionBusy(true);
    try {
      const updated = await updateOfferStatus(offer.id, nextStatus);
      setOffers((prev) => prev.map((o) => (o.id === offer.id ? updated : o)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to update offer status');
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <Page
      eyebrow="People / HR"
      title="Job Offers"
      description="Compensation structuring, formal letter issuance, candidate acceptance, and terms tracking."
      action={
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="w-full rounded-xl bg-app-accent px-5 py-2.5 text-center text-sm font-semibold text-app-on-accent shadow-xs transition hover:opacity-90 sm:w-auto"
        >
          + Create Offer
        </button>
      }
    >
      {error && (
        <div className="mt-6">
          <Notice error>{error}</Notice>
        </div>
      )}

      {/* Filter Bar */}
      <Card className="mt-6 p-4">
        <div className="max-w-xs">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as OfferStatus | 'all')}
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent"
            aria-label="Filter by offer status"
          >
            <option value="all">All Offer Statuses</option>
            <option value="draft">Draft (Internal)</option>
            <option value="sent">Sent to Candidate</option>
            <option value="accepted">Accepted (Pending Joining)</option>
            <option value="rejected">Declined</option>
            <option value="expired">Expired</option>
            <option value="withdrawn">Withdrawn</option>
          </select>
        </div>
      </Card>

      {/* Offers Table */}
      {loading ? (
        <div className="mt-6">
          <SkeletonTable columns={5} rows={6} />
        </div>
      ) : offers.length === 0 ? (
        <Empty>
          No job offers found matching the current criteria. Issue an offer for a selected candidate.
        </Empty>
      ) : (
        <section className="mt-6 overflow-hidden rounded-2xl border border-app-border bg-app-surface">
          <div className="hidden border-b border-app-border bg-app-surface-raised px-5 py-3 text-xs font-bold uppercase tracking-wider text-app-muted md:grid md:grid-cols-[1.5fr_1.3fr_1.1fr_1fr_1fr_1.4fr] md:items-center">
            <span>Candidate &amp; Role</span>
            <span>Designation</span>
            <span>Offered Package</span>
            <span>Dates</span>
            <span>Status</span>
            <span className="text-right">Actions</span>
          </div>

          <div className="divide-y divide-app-border">
            {offers.map((off) => (
              <div
                key={off.id}
                className="grid gap-2 px-5 py-4 text-sm md:grid-cols-[1.5fr_1.3fr_1.1fr_1fr_1fr_1.4fr] md:items-center"
              >
                <div>
                  <p className="font-semibold">{off.candidateName ?? 'Candidate'}</p>
                  <p className="text-xs text-app-muted">{off.requisitionTitle ?? 'Job Requisition'}</p>
                </div>

                <div>
                  <p className="font-medium text-xs">{off.positionName ?? off.designationName ?? 'Role Title'}</p>
                  {off.notes && <p className="text-[11px] text-app-muted truncate">{off.notes}</p>}
                </div>

                <div>
                  <span className="font-semibold">
                    {off.currency} {Number(off.offeredSalary).toLocaleString()}
                  </span>
                  <p className="text-[11px] text-app-muted">Annual CTC</p>
                </div>

                <div className="text-xs text-app-muted">
                  <p>Issued: {off.offerDate}</p>
                  {off.expectedJoiningDate && (
                    <p className="font-medium text-app-accent">Joining: {off.expectedJoiningDate}</p>
                  )}
                </div>

                <div>
                  <OfferStatusBadge status={off.status} />
                </div>

                <div className="flex flex-wrap items-center justify-end gap-1.5 pt-2 md:pt-0">
                  {off.status === 'draft' && (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => void handleStatusChange(off, 'sent')}
                      className="rounded bg-app-accent px-2.5 py-1 text-xs font-bold text-app-on-accent hover:opacity-90"
                    >
                      Send Offer
                    </button>
                  )}

                  {off.status === 'sent' && (
                    <>
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() => void handleStatusChange(off, 'accepted')}
                        className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
                      >
                        Mark Accepted
                      </button>
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() => void handleStatusChange(off, 'rejected')}
                        className="rounded border border-app-border px-2.5 py-1 text-xs font-semibold text-app-danger hover:bg-rose-500/10"
                      >
                        Declined
                      </button>
                    </>
                  )}

                  {off.status === 'accepted' && onNavigateToJoining && (
                    <button
                      type="button"
                      onClick={onNavigateToJoining}
                      className="rounded border border-app-border px-2.5 py-1 text-xs font-bold text-app-accent hover:underline"
                    >
                      View Joining →
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {showCreateModal && (
        <OfferFormModal
          candidates={candidates.filter((c) => c.status === 'selected' || c.status === 'interview')}
          requisitions={requisitions}
          preselectedCandidate={preselectedCandidate}
          onClose={() => setShowCreateModal(false)}
          onCreated={(newOff) => {
            setOffers((prev) => [newOff, ...prev]);
          }}
        />
      )}
    </Page>
  );
}
