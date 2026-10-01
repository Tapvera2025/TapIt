import { useEffect, useState } from 'react';
import { getIdentityAccessToken } from '../../../identity/api/authApi.js';
import { Button, Modal, Notice } from '../../../ui/components.js';
import {
  listInterviews,
  listJoinings,
  listOffers,
  updateCandidateScreening,
  updateCandidateStatus,
} from '../api/recruitmentApi.js';
import {
  CandidateStatusBadge,
  InterviewStatusBadge,
  JoiningStatusBadge,
  OfferStatusBadge,
} from './StatusBadge.js';
import { InterviewRescheduleModal } from './InterviewRescheduleModal.js';
import { InterviewDecisionModal } from './InterviewDecisionModal.js';
import { HiringDialog } from './HiringDialog.js';
import type {
  Candidate,
  CandidateJoining,
  CandidateStatus,
  Interview,
  JobOffer,
} from '../types/index.js';

export function CandidateDetailModal({
  candidate: initialCandidate,
  onClose,
  onUpdated,
  onScheduleInterview,
  onCreateOffer,
}: {
  readonly candidate: Candidate;
  readonly onClose: () => void;
  readonly onUpdated: (candidate: Candidate) => void;
  readonly onScheduleInterview?: ((candidate: Candidate) => void) | undefined;
  readonly onCreateOffer?: ((candidate: Candidate) => void) | undefined;
}): React.JSX.Element {
  const [candidate, setCandidate] = useState<Candidate>(initialCandidate);
  const [activeSection, setActiveSection] = useState<'profile' | 'screening' | 'interviews' | 'offer'>(
    candidate.status === 'screening' ? 'screening' : 'profile',
  );

  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [offers, setOffers] = useState<JobOffer[]>([]);
  const [joinings, setJoinings] = useState<CandidateJoining[]>([]);
  const [loadingExtras, setLoadingExtras] = useState(true);

  // Screening notes edit
  const [screeningNotes, setScreeningNotes] = useState(candidate.screeningNotes ?? '');
  const [savingScreening, setSavingScreening] = useState(false);

  // Rejection dialog
  const [rejecting, setRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');

  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // New Interview & Hiring Modals
  const [rescheduleTarget, setRescheduleTarget] = useState<Interview | null>(null);
  const [decisionTarget, setDecisionTarget] = useState<Interview | null>(null);
  const [hiringOpen, setHiringOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingExtras(true);

    void Promise.all([
      listInterviews({ candidateId: candidate.id }),
      listOffers({ candidateId: candidate.id }),
      listJoinings(),
    ])
      .then(([ints, offs, joins]) => {
        if (!cancelled) {
          setInterviews(ints);
          setOffers(offs);
          setJoinings(joins.filter((j) => j.candidateId === candidate.id));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingExtras(false);
      });

    return () => {
      cancelled = true;
    };
  }, [candidate.id]);

  async function handleStatusTransition(nextStatus: CandidateStatus, reason?: string) {
    setActionBusy(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const updated = await updateCandidateStatus(candidate.id, {
        status: nextStatus,
        rejectionReason: reason ?? undefined,
      });
      setCandidate(updated);
      onUpdated(updated);
      setSuccessMsg(`Candidate moved to ${nextStatus.toUpperCase()}`);
      setRejecting(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to update candidate status');
    } finally {
      setActionBusy(false);
    }
  }

  async function handleSaveScreening() {
    setSavingScreening(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const updated = await updateCandidateScreening(candidate.id, screeningNotes.trim());
      setCandidate(updated);
      onUpdated(updated);
      setSuccessMsg('Screening notes updated successfully.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to save screening notes');
    } finally {
      setSavingScreening(false);
    }
  }

  return (
    <Modal title="Candidate Profile & Workflow" onClose={onClose}>
      <div className="space-y-6">
        {error && <Notice error>{error}</Notice>}
        {successMsg && <Notice>{successMsg}</Notice>}

        {/* Top Header Card */}
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-app-border bg-app-surface p-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="font-display text-xl font-bold">
                {candidate.fullName ?? `${candidate.firstName} ${candidate.lastName}`}
              </h2>
              <CandidateStatusBadge status={candidate.status} />
            </div>
            <p className="mt-1 text-sm text-app-muted">
              {candidate.email} {candidate.phone ? `· ${candidate.phone}` : ''}
            </p>
            <p className="mt-1 text-xs text-app-accent font-medium">
              Applied for: {candidate.requisitionTitle ?? 'Job Requisition'} ({candidate.requisitionNumber ?? 'REQ'})
            </p>
          </div>

          <div className="flex items-center gap-2">
            {candidate.resumeUrl && (
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    try {
                      const url = candidate.resumeUrl;
                      if (!url) return;
                      if (url.startsWith('http') && !url.includes('/api/recruitment/')) {
                        window.open(url, '_blank', 'noopener,noreferrer');
                        return;
                      }
                      const token = getIdentityAccessToken();
                      const res = await fetch(url, {
                        headers: token ? { Authorization: `Bearer ${token}` } : {},
                      });
                      if (!res.ok) throw new Error('Failed to load resume document');
                      const blob = await res.blob();
                      const blobUrl = URL.createObjectURL(blob);
                      window.open(blobUrl, '_blank', 'noopener,noreferrer');
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Unable to view resume');
                    }
                  })();
                }}
                className="rounded-lg border border-app-border px-3 py-1.5 text-xs font-semibold text-app-foreground hover:border-app-accent hover:text-app-accent transition"
              >
                View Resume ↗
              </button>
            )}
          </div>
        </div>

        {/* Workflow State Actions */}
        <div className="rounded-xl border border-app-border bg-app-background p-3">
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-app-muted">
            Workflow Transitions
          </p>
          <div className="flex flex-wrap gap-2">
            {candidate.status === 'applied' && (
              <Button
                kind="primary"
                disabled={actionBusy}
                onClick={() => void handleStatusTransition('screening')}
              >
                Start Screening
              </Button>
            )}

            {candidate.status === 'screening' && (
              <>
                <Button
                  kind="primary"
                  disabled={actionBusy}
                  onClick={() => {
                    void handleStatusTransition('interview');
                    setActiveSection('interviews');
                  }}
                >
                  Pass to Interview Round
                </Button>
                <Button
                  kind="danger"
                  disabled={actionBusy}
                  onClick={() => setRejecting(true)}
                >
                  Reject from Screening
                </Button>
              </>
            )}

            {candidate.status === 'interview' && (
              <>
                <Button
                  kind="primary"
                  disabled={actionBusy}
                  onClick={() => void handleStatusTransition('selected')}
                >
                  Mark Selected (Hire Decision)
                </Button>
                {onScheduleInterview && (
                  <Button
                    kind="secondary"
                    disabled={actionBusy}
                    onClick={() => {
                      onClose();
                      onScheduleInterview(candidate);
                    }}
                  >
                    + Schedule Interview
                  </Button>
                )}
                <Button
                  kind="danger"
                  disabled={actionBusy}
                  onClick={() => setRejecting(true)}
                >
                  Reject Candidate
                </Button>
              </>
            )}

            {candidate.status === 'selected' && (
              <>
                {onCreateOffer && offers.length === 0 && (
                  <Button
                    kind="primary"
                    disabled={actionBusy}
                    onClick={() => {
                      onClose();
                      onCreateOffer(candidate);
                    }}
                  >
                    Generate Job Offer
                  </Button>
                )}
                <Button
                  kind="secondary"
                  disabled={actionBusy}
                  onClick={() => void handleStatusTransition('withdrawn')}
                >
                  Mark Withdrawn
                </Button>
              </>
            )}

            {candidate.status === 'rejected' && (
              <span className="text-xs text-app-danger">
                Candidate was marked as rejected: {candidate.rejectionReason ?? 'No reason recorded'}
              </span>
            )}

            {candidate.status === 'withdrawn' && (
              <span className="text-xs text-app-muted">Candidate has withdrawn their application.</span>
            )}
          </div>
        </div>

        {/* Rejection Sub-Form */}
        {rejecting && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 space-y-3">
            <p className="text-sm font-bold text-rose-700 dark:text-rose-300">
              Confirm Candidate Rejection
            </p>
            <label className="block text-xs font-semibold text-app-muted">
              <span className="mb-1 block">Rejection Reason</span>
              <input
                type="text"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="e.g. Compensation mismatch / Skills did not match senior criteria"
                className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm text-app-foreground outline-none focus:border-app-accent"
              />
            </label>
            <div className="flex gap-2">
              <Button
                kind="danger"
                disabled={actionBusy}
                onClick={() => void handleStatusTransition('rejected', rejectionReason)}
              >
                Confirm Rejection
              </Button>
              <Button kind="secondary" onClick={() => setRejecting(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Section Navigation */}
        <div className="flex border-b border-app-border">
          {(['profile', 'screening', 'interviews', 'offer'] as const).map((sec) => (
            <button
              key={sec}
              type="button"
              onClick={() => setActiveSection(sec)}
              className={`border-b-2 px-4 py-2 text-sm font-semibold capitalize transition ${
                activeSection === sec
                  ? 'border-app-accent text-app-accent'
                  : 'border-transparent text-app-muted hover:text-app-foreground'
              }`}
            >
              {sec === 'profile'
                ? 'Profile Info'
                : sec === 'screening'
                  ? 'Screening'
                  : sec === 'interviews'
                    ? `Interviews (${interviews.length})`
                    : `Offer & Joining (${offers.length})`}
            </button>
          ))}
        </div>

        {/* Section 1: Profile */}
        {activeSection === 'profile' && (
          <div className="space-y-4 text-sm">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-app-border p-3">
                <span className="text-xs font-semibold text-app-muted">Application Source</span>
                <p className="mt-1 font-medium capitalize">{candidate.source}</p>
              </div>
              <div className="rounded-lg border border-app-border p-3">
                <span className="text-xs font-semibold text-app-muted">Applied Date</span>
                <p className="mt-1 font-medium">
                  {new Date(candidate.createdAt).toLocaleDateString()}
                </p>
              </div>
              <div className="rounded-lg border border-app-border p-3">
                <span className="text-xs font-semibold text-app-muted">Primary Phone</span>
                <p className="mt-1 font-medium">{candidate.phone ?? 'None provided'}</p>
              </div>
              <div className="rounded-lg border border-app-border p-3">
                <span className="text-xs font-semibold text-app-muted">Email Address</span>
                <p className="mt-1 font-medium">{candidate.email}</p>
              </div>
            </div>
          </div>
        )}

        {/* Section 2: Screening */}
        {activeSection === 'screening' && (
          <div className="space-y-4">
            <label className="block text-xs font-semibold text-app-muted">
              <span className="mb-2 block">HR Screening Assessment &amp; Notes</span>
              <textarea
                value={screeningNotes}
                onChange={(e) => setScreeningNotes(e.target.value)}
                rows={5}
                disabled={savingScreening}
                placeholder="Log candidate phone screen feedback, notice period, location preferences, salary expectations..."
                className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
              />
            </label>
            <div className="flex justify-end">
              <Button
                kind="primary"
                disabled={savingScreening}
                onClick={() => void handleSaveScreening()}
              >
                {savingScreening ? 'Saving...' : 'Save Screening Notes'}
              </Button>
            </div>
          </div>
        )}

        {/* Section 3: Interviews */}
        {activeSection === 'interviews' && (
          <div className="space-y-4">
            {loadingExtras ? (
              <div className="rounded-xl border border-app-border bg-app-surface p-6 text-center text-sm text-app-muted">
                Loading candidate interviews...
              </div>
            ) : interviews.length === 0 ? (
              <div className="rounded-xl border border-app-border bg-app-surface p-6 text-center text-sm text-app-muted">
                <p>No interviews scheduled for this candidate yet.</p>
                {onScheduleInterview && (
                  <Button
                    kind="secondary"
                    className="mt-3"
                    onClick={() => {
                      onClose();
                      onScheduleInterview(candidate);
                    }}
                  >
                    Schedule First Interview Round
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {interviews.map((int) => (
                  <div key={int.id} className="rounded-xl border border-app-border bg-app-surface p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-xs font-bold uppercase text-app-accent">
                          Round {int.round} · {int.stage}
                        </span>
                        <h4 className="font-semibold capitalize">
                          {int.interviewType.replace('_', ' ')} Interview ({int.durationMinutes} mins)
                        </h4>
                        <p className="text-xs text-app-muted">
                          Scheduled for {new Date(int.scheduledAt).toLocaleString()}
                        </p>
                      </div>
                      <InterviewStatusBadge status={int.status} />
                    </div>

                    {int.locationOrLink && (
                      <p className="mt-2 text-xs text-app-muted truncate">
                        Link / Location: <span className="font-mono text-app-foreground">{int.locationOrLink}</span>
                      </p>
                    )}

                    {int.feedback && int.feedback.length > 0 && (
                      <div className="mt-3 border-t border-app-border pt-3">
                        <p className="text-xs font-bold text-app-muted uppercase">Feedback Received</p>
                        {int.feedback.map((fb) => (
                          <div key={fb.id} className="mt-2 rounded-lg bg-app-background p-2.5 text-xs space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="font-bold">{fb.interviewerName ?? 'Evaluator'}</span>
                              <span className="font-semibold uppercase text-app-accent">
                                {fb.recommendation.replace(/_/g, ' ')} {fb.rating ? `(${fb.rating}/5)` : ''}
                              </span>
                            </div>
                            <p className="text-app-foreground">{fb.feedback}</p>
                            {fb.strengths && <p className="text-app-success">Strengths: {fb.strengths}</p>}
                            {fb.areasForImprovement && <p className="text-app-muted">Improvements: {fb.areasForImprovement}</p>}
                          </div>
                        ))}
                      </div>
                    )}

                    {int.status === 'scheduled' && (
                      <div className="mt-3 flex items-center justify-end gap-2 border-t border-app-border pt-2.5">
                        <Button
                          kind="secondary"
                          onClick={() => setRescheduleTarget(int)}
                        >
                          Reschedule
                        </Button>
                        <Button
                          kind="secondary"
                          onClick={() => setDecisionTarget(int)}
                        >
                          Record Decision
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Section 4: Offer & Joining */}
        {activeSection === 'offer' && (
          <div className="space-y-4">
            {offers.length === 0 ? (
              <div className="rounded-xl border border-app-border bg-app-surface p-6 text-center text-sm text-app-muted">
                <p>No job offer generated yet.</p>
                {candidate.status === 'selected' && onCreateOffer && (
                  <Button
                    kind="primary"
                    className="mt-3"
                    onClick={() => {
                      onClose();
                      onCreateOffer(candidate);
                    }}
                  >
                    Generate Job Offer
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {offers.map((off) => (
                  <div key={off.id} className="rounded-xl border border-app-border bg-app-surface p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h4 className="font-semibold">
                          Job Offer — {off.positionName ?? 'Role Position'}
                        </h4>
                        <p className="text-xs text-app-muted">
                          Offered: {off.currency} {Number(off.offeredSalary).toLocaleString()}
                        </p>
                        <p className="text-xs text-app-muted">
                          Offer Date: {off.offerDate} · Valid Until: {off.validUntil ?? 'N/A'}
                        </p>
                      </div>
                      <OfferStatusBadge status={off.status} />
                    </div>

                    {off.expectedJoiningDate && (
                      <p className="mt-2 text-xs font-medium text-app-accent">
                        Expected Joining: {off.expectedJoiningDate}
                      </p>
                    )}

                    {off.notes && <p className="mt-1 text-xs text-app-muted">{off.notes}</p>}
                  </div>
                ))}

                {joinings.length > 0 && (
                  <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-200">
                        Joining Record
                      </span>
                      <JoiningStatusBadge status={joinings[0]?.status ?? 'pending'} />
                    </div>
                    <p className="mt-1 text-sm font-medium">
                      Expected Joining Date: {joinings[0]?.expectedJoiningDate}
                    </p>
                    {joinings[0]?.actualJoiningDate && (
                      <p className="text-xs text-emerald-700 dark:text-emerald-300">
                        Confirmed Joined On: {joinings[0].actualJoiningDate}
                      </p>
                    )}
                  </div>
                )}

                {/* Hire as Employee CTA */}
                {candidate.status === 'selected' && offers.some((o) => o.status === 'accepted') && (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                    <div>
                      <h4 className="font-semibold text-emerald-800 dark:text-emerald-200">
                        Ready for Employee Onboarding
                      </h4>
                      <p className="text-xs text-emerald-700 dark:text-emerald-300">
                        Candidate has accepted the offer. Finalize joining and provision their company employee account.
                      </p>
                    </div>
                    {joinings[0]?.status === 'joined' ? (
                      <span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold text-white">
                        Officially Hired
                      </span>
                    ) : (
                      <Button kind="primary" onClick={() => setHiringOpen(true)}>
                        Hire as Employee
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end border-t border-app-border pt-4">
          <Button kind="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      {/* Reschedule Modal */}
      {rescheduleTarget && (
        <InterviewRescheduleModal
          interview={rescheduleTarget}
          onClose={() => setRescheduleTarget(null)}
          onRescheduled={(updatedInt) => {
            setInterviews((prev) =>
              prev.map((i) => (i.id === rescheduleTarget.id ? { ...i, status: 'rescheduled' } : i)),
            );
            setInterviews((prev) => [updatedInt, ...prev]);
            setRescheduleTarget(null);
            setSuccessMsg('Interview successfully rescheduled.');
          }}
        />
      )}

      {/* Decision Modal */}
      {decisionTarget && (
        <InterviewDecisionModal
          interview={decisionTarget}
          onClose={() => setDecisionTarget(null)}
          onDecisionRecorded={(dec) => {
            const nextCandStatus: CandidateStatus = dec === 'accepted' ? 'selected' : 'rejected';
            const updatedCand = { ...candidate, status: nextCandStatus };
            setCandidate(updatedCand);
            onUpdated(updatedCand);
            setDecisionTarget(null);
            setSuccessMsg(
              dec === 'accepted'
                ? 'Candidate accepted and moved to Selected.'
                : 'Candidate rejected.',
            );
          }}
        />
      )}

      {/* Hiring Modal */}
      {hiringOpen && (
        <HiringDialog
          candidate={candidate}
          offer={offers.find((o) => o.status === 'accepted')}
          joining={joinings[0]}
          onClose={() => setHiringOpen(false)}
          onHired={() => {
            setHiringOpen(false);
            if (joinings[0]) {
              const updatedJoining: CandidateJoining = {
                ...joinings[0],
                status: 'joined',
                actualJoiningDate: new Date().toISOString().split('T')[0],
              };
              setJoinings([updatedJoining]);
            }
            setSuccessMsg('Candidate officially hired as employee. Onboarding email sent.');
          }}
        />
      )}
    </Modal>
  );
}
