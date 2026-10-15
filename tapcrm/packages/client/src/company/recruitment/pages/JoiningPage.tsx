import { useEffect, useState } from 'react';
import { Card, Empty, Notice, Page, SkeletonTable } from '../../../ui/components.js';
import { listJoinings } from '../api/recruitmentApi.js';
import { JoiningStatusModal } from '../components/JoiningStatusModal.js';
import { SendJoiningEmailModal } from '../components/SendJoiningEmailModal.js';
import { JoiningStatusBadge } from '../components/StatusBadge.js';
import type { CandidateJoining, JoiningFilter, JoiningStatus } from '../types/index.js';

export function JoiningPage({
  onNavigateToEmployees,
}: {
  readonly onNavigateToEmployees: () => void;
}): React.JSX.Element {
  const [joinings, setJoinings] = useState<CandidateJoining[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<JoiningStatus | 'all'>('all');

  // Modals
  const [selectedJoining, setSelectedJoining] = useState<CandidateJoining | null>(null);
  const [emailJoining, setEmailJoining] = useState<CandidateJoining | null>(null);

  async function load() {
    setLoading(true);
    try {
      const filter: JoiningFilter = {
        status: statusFilter,
      };
      const data = await listJoinings(filter);
      setJoinings(data);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load joining records');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [statusFilter]);

  return (
    <Page variant="recruitment"
      eyebrow="People / HR"
      title="Candidate Joining &amp; Onboarding"
      description="Pre-boarding tracking, joining confirmation, and handoff to the organization Employee module."
      action={
        <button
          type="button"
          onClick={onNavigateToEmployees}
          className="w-full rounded-xl border border-app-border bg-app-surface px-5 py-2.5 text-center text-sm font-semibold text-app-foreground transition hover:border-app-accent hover:text-app-accent sm:w-auto"
        >
          View Employee Directory →
        </button>
      }
    >
      {error && (
        <div className="mt-6">
          <Notice error>{error}</Notice>
        </div>
      )}

      {/* Workflow Explanatory Notice */}
      <div className="mt-6 rounded-xl border border-app-accent/30 bg-app-accent/10 p-4 text-xs text-app-foreground">
        <p className="font-bold uppercase tracking-wider text-app-accent">
          Lifecycle Handoff: Recruitment → Employee
        </p>
        <p className="mt-1">
          Once a candidate confirms and reaches <strong className="text-app-accent">Joined</strong> status,
          their operational employment identity, credentials, team assignment, and organizational hierarchy are managed
          inside the existing <strong>Employee</strong> module.
        </p>
      </div>

      {/* Filter Bar */}
      <Card className="mt-6 p-4">
        <div className="max-w-xs">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as JoiningStatus | 'all')}
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm outline-none focus:border-app-accent"
            aria-label="Filter by joining status"
          >
            <option value="all">All Joining Statuses</option>
            <option value="pending">Pending Pre-boarding</option>
            <option value="confirmed">Confirmed</option>
            <option value="joined">Joined (Active)</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </Card>

      {/* Joining Table */}
      {loading ? (
        <div className="mt-6">
          <SkeletonTable columns={5} rows={6} />
        </div>
      ) : joinings.length === 0 ? (
        <Empty>
          No candidate joining records found matching the current criteria. Candidate joining records are generated
          when job offers are accepted.
        </Empty>
      ) : (
        <section className="mt-6 overflow-hidden rounded-2xl border border-app-border bg-app-surface">
          <div className="hidden border-b border-app-border bg-app-surface-raised px-5 py-3 text-xs font-bold uppercase tracking-wider text-app-muted md:grid md:grid-cols-[1.5fr_1fr_1fr_1.2fr_auto] md:items-center">
            <span>Candidate</span>
            <span>Expected Date</span>
            <span>Status</span>
            <span>Acknowledgement</span>
            <span className="text-right">Actions</span>
          </div>

          <div className="divide-y divide-app-border">
            {joinings.map((join) => (
              <div
                key={join.id}
                className="grid gap-2 px-5 py-4 text-sm md:grid-cols-[1.5fr_1fr_1fr_1.2fr_auto] md:items-center"
              >
                <div>
                  <p className="font-semibold">{join.candidateName ?? 'Candidate'}</p>
                  <p className="text-xs text-app-muted">{join.candidateEmail ?? 'Applicant'}</p>
                  {join.actualJoiningDate && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">
                      Joined: {join.actualJoiningDate}
                    </p>
                  )}
                </div>

                <div className="text-xs font-medium text-app-foreground">
                  {join.expectedJoiningDate ?? <span className="text-app-muted italic">—</span>}
                </div>

                <div>
                  <JoiningStatusBadge status={join.status} />
                </div>

                <div className="text-xs">
                  {join.acknowledgedAt ? (
                    <div>
                      <span className="inline-flex items-center rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                        ● Acknowledged
                      </span>
                      <p className="mt-0.5 text-app-muted">
                        {new Date(join.acknowledgedAt).toLocaleDateString()}
                      </p>
                    </div>
                  ) : join.joiningEmailSentAt ? (
                    <div>
                      <span className="inline-flex items-center rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                        ○ Awaiting
                      </span>
                      <p className="mt-0.5 text-app-muted">
                        Sent {new Date(join.joiningEmailSentAt).toLocaleDateString()}
                      </p>
                    </div>
                  ) : (
                    <span className="text-app-muted italic">Email not sent</span>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2 pt-2 md:pt-0">
                  <button
                    type="button"
                    onClick={() => setEmailJoining(join)}
                    className="rounded border border-app-border px-2.5 py-1 text-xs font-semibold text-app-foreground hover:border-app-accent hover:text-app-accent"
                  >
                    {join.joiningEmailSentAt ? 'Resend Email' : 'Send Email'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedJoining(join)}
                    className="rounded border border-app-border px-2.5 py-1 text-xs font-semibold text-app-foreground hover:border-app-accent hover:text-app-accent"
                  >
                    Update Status
                  </button>

                  {join.status === 'joined' && (
                    <button
                      type="button"
                      onClick={onNavigateToEmployees}
                      className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-emerald-700"
                    >
                      Employee Record →
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {selectedJoining && (
        <JoiningStatusModal
          joining={selectedJoining}
          onClose={() => setSelectedJoining(null)}
          onUpdated={(updated) => {
            setJoinings((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
          }}
          onNavigateToEmployees={onNavigateToEmployees}
        />
      )}

      {emailJoining && (
        <SendJoiningEmailModal
          joining={emailJoining}
          onClose={() => setEmailJoining(null)}
          onSent={(result) => {
            if (result.sent) {
              setJoinings((prev) =>
                prev.map((j) =>
                  j.id === emailJoining.id
                    ? { ...j, joiningEmailSentAt: new Date().toISOString() }
                    : j,
                ),
              );
            }
          }}
        />
      )}
    </Page>
  );
}
