import { useEffect, useState } from 'react';
import { Card, Empty, Loading, Notice, Page } from '../../../ui/components.js';
import { Icon } from '../../../ui/Icon.js';
import { listRequisitions, updateRequisitionStatus } from '../api/recruitmentApi.js';
import { RequisitionFormModal } from '../components/RequisitionFormModal.js';
import { ApplicationLinkModal } from '../components/ApplicationLinkModal.js';
import { RequisitionStatusBadge } from '../components/StatusBadge.js';
import type { EmploymentType, JobRequisition, RequisitionStatus } from '../types/index.js';

export function RequisitionsPage({
  onAddCandidateForRequisition,
}: {
  readonly onAddCandidateForRequisition?: (req: JobRequisition) => void;
}): React.JSX.Element {
  const [requisitions, setRequisitions] = useState<JobRequisition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<RequisitionStatus | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<EmploymentType | 'all'>('all');

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [appLinkRequisition, setAppLinkRequisition] = useState<JobRequisition | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await listRequisitions({
        search: search.trim() || undefined,
        status: statusFilter,
        employmentType: typeFilter,
      });
      setRequisitions(data);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load requisitions');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [statusFilter, typeFilter]);

  async function handleToggleStatus(req: JobRequisition, nextStatus: RequisitionStatus) {
    setActionBusy(true);
    try {
      const updated = await updateRequisitionStatus(req.id, nextStatus);
      setRequisitions((prev) => prev.map((r) => (r.id === req.id ? updated : r)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to update requisition status');
    } finally {
      setActionBusy(false);
    }
  }

  const visible = requisitions.filter((r) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      r.title.toLowerCase().includes(s) ||
      r.requisitionNumber.toLowerCase().includes(s) ||
      (r.departmentName?.toLowerCase().includes(s) ?? false) ||
      (r.location?.toLowerCase().includes(s) ?? false)
    );
  });

  return (
    <Page
      eyebrow="People / HR"
      title="Job Requisitions"
      description="Headcount approval, job specifications, openings tracking, and hiring targets."
      action={
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="w-full rounded-xl bg-app-accent px-5 py-2.5 text-center text-sm font-semibold text-app-on-accent shadow-xs transition hover:opacity-90 sm:w-auto"
        >
          + Create Requisition
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
            placeholder="Search by title, req number, or location..."
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent"
            aria-label="Search job requisitions"
          />

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as RequisitionStatus | 'all')}
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent"
            aria-label="Filter by status"
          >
            <option value="all">All Requisition Statuses</option>
            <option value="open">Open (Active)</option>
            <option value="draft">Draft</option>
            <option value="on_hold">On Hold</option>
            <option value="filled">Filled</option>
            <option value="closed">Closed</option>
            <option value="cancelled">Cancelled</option>
          </select>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as EmploymentType | 'all')}
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent"
            aria-label="Filter by employment type"
          >
            <option value="all">All Employment Types</option>
            <option value="full_time">Full Time</option>
            <option value="part_time">Part Time</option>
            <option value="contract">Contract</option>
            <option value="internship">Internship</option>
          </select>
        </div>
      </Card>

      {/* Requisitions List Table */}
      {loading ? (
        <div className="mt-6">
          <Loading />
        </div>
      ) : visible.length === 0 ? (
        <Empty>
          No job requisitions match the current criteria. Create a new requisition to begin sourcing candidates.
        </Empty>
      ) : (
        <section className="mt-6 rounded-2xl border border-app-border bg-app-surface">
          <div className="hidden border-b border-app-border bg-app-surface-raised px-5 py-3 text-xs font-bold uppercase tracking-wider text-app-muted md:grid md:grid-cols-[1.8fr_1.3fr_1.2fr_1fr_auto] md:items-center md:gap-4">
            <span>Requisition</span>
            <span>Department &amp; Role</span>
            <span>Details</span>
            <span>Status</span>
            <span className="text-right">Actions</span>
          </div>

          <div className="divide-y divide-app-border">
            {visible.map((req) => (
              <div
                key={req.id}
                className="grid gap-3 px-5 py-4 text-sm md:grid-cols-[1.8fr_1.3fr_1.2fr_1fr_auto] md:items-center md:gap-4"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-app-foreground truncate">{req.title}</p>
                  <p className="text-xs font-mono text-app-muted">{req.requisitionNumber}</p>
                  {req.location && <p className="text-xs text-app-muted truncate">{req.location}</p>}
                </div>

                <div className="min-w-0">
                  <p className="font-medium text-app-foreground truncate">{req.departmentName ?? 'Department'}</p>
                  {req.positionName && <p className="text-xs text-app-muted truncate">{req.positionName}</p>}
                </div>

                <div className="min-w-0 text-xs">
                  <span className="font-semibold text-app-foreground">{req.openingsCount} open</span>
                  <span className="text-app-muted"> · </span>
                  <span className="capitalize text-app-foreground">{req.employmentType.replace('_', ' ')}</span>
                  {req.targetHireDate && (
                    <p className="text-app-muted mt-0.5">Target: {new Date(req.targetHireDate).toLocaleDateString()}</p>
                  )}
                </div>

                <div>
                  <RequisitionStatusBadge status={req.status} />
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2 md:justify-end md:pt-0">
                  <button
                    type="button"
                    onClick={() => setAppLinkRequisition(req)}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-app-accent/40 bg-app-accent/10 px-2.5 py-1.5 text-xs font-semibold text-app-accent hover:border-app-accent hover:bg-app-accent/20 transition-colors shadow-xs"
                    title="Student Application Link"
                    aria-label="Student Application Link"
                  >
                    <Icon name="pin" className="size-3.5" />
                    <span>Link</span>
                  </button>

                  {onAddCandidateForRequisition && req.status === 'open' && (
                    <button
                      type="button"
                      onClick={() => onAddCandidateForRequisition(req)}
                      className="inline-flex items-center whitespace-nowrap rounded-lg border border-app-border bg-app-surface px-2.5 py-1.5 text-xs font-semibold text-app-foreground hover:border-app-accent hover:text-app-accent transition-colors"
                    >
                      + Candidate
                    </button>
                  )}

                  {req.status === 'draft' && (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => void handleToggleStatus(req, 'open')}
                      className="inline-flex items-center whitespace-nowrap rounded-lg bg-app-accent px-2.5 py-1.5 text-xs font-bold text-app-on-accent hover:opacity-90 disabled:opacity-50"
                    >
                      Publish Open
                    </button>
                  )}

                  {req.status === 'open' && (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => void handleToggleStatus(req, 'on_hold')}
                      className="inline-flex items-center whitespace-nowrap rounded-lg border border-app-border bg-app-surface px-2.5 py-1.5 text-xs font-semibold text-app-muted hover:text-app-foreground disabled:opacity-50"
                    >
                      Hold
                    </button>
                  )}

                  {req.status === 'on_hold' && (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => void handleToggleStatus(req, 'open')}
                      className="inline-flex items-center whitespace-nowrap rounded-lg border border-app-border bg-app-surface px-2.5 py-1.5 text-xs font-semibold text-app-accent hover:bg-app-accent/10 disabled:opacity-50"
                    >
                      Resume
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {showCreateModal && (
        <RequisitionFormModal
          onClose={() => setShowCreateModal(false)}
          onCreated={(newReq) => {
            setRequisitions((prev) => [newReq, ...prev]);
          }}
        />
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
