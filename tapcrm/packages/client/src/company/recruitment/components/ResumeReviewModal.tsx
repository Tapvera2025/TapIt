import { useEffect, useRef, useState } from 'react';
import { Button, Field, Modal, Notice, Select } from '../../../ui/components.js';
import { Icon } from '../../../ui/Icon.js';
import { getIdentityAccessToken } from '../../../identity/api/authApi.js';
import {
  convertResumeSubmission,
  getResumeDownloadUrl,
  updateResumeSubmissionStatus,
} from '../api/recruitmentApi.js';
import { ResumeSubmissionStatusBadge } from './StatusBadge.js';
import { AtsScanPanel } from './AtsScanPanel.js';
import { ResumeParsedDetails } from './ResumeParsedDetails.js';
import { resumeNotes } from '../resumeAutofill.js';
import { atsScanSummary, type AtsScanSummary } from '@tapcrm/contracts';
import {
  submissionSource,
  type CandidateResumeSubmission,
  type CandidateSource,
} from '../types/index.js';

export function ResumeReviewModal({
  submission: initialSubmission,
  onClose,
  onUpdated,
  onCandidateCreated,
  onAtsUpdated,
}: {
  readonly submission: CandidateResumeSubmission;
  readonly onClose: () => void;
  readonly onUpdated: (submission: CandidateResumeSubmission) => void;
  readonly onCandidateCreated?: ((candidateId: string) => void) | undefined;
  /** A new ATS report exists for this application; the inbox row can show it. */
  readonly onAtsUpdated?: ((submissionId: string, summary: AtsScanSummary) => void) | undefined;
}): React.JSX.Element {
  const [submission, setSubmission] = useState<CandidateResumeSubmission>(initialSubmission);
  const [converting, setConverting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');

  // Editable candidate fields for conversion
  const [firstName, setFirstName] = useState(submission.firstName);
  const [lastName, setLastName] = useState(submission.lastName);
  const [email, setEmail] = useState(submission.email);
  const [phone, setPhone] = useState(submission.phone ?? '');
  const [source, setSource] = useState<CandidateSource>(
    submissionSource(submission) === 'application_link' ? 'career_site' : 'direct',
  );
  // Notes start from what the parser read; records from the first parser version had no reliable summary.
  const [screeningNotes, setScreeningNotes] = useState(
    submission.parsedData?.parserVersion ? resumeNotes(submission.parsedData) : '',
  );

  const [downloading, setDownloading] = useState(false);
  const [submittingAction, setSubmittingAction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const parsed = submission.parsedData;

  // A decision started from the ATS panel opens its form higher up the window.
  const decisionForm = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (rejecting || converting) decisionForm.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [rejecting, converting]);

  async function handleDownloadResume() {
    setDownloading(true);
    setError(null);
    try {
      const res = await getResumeDownloadUrl(submission.id);
      const rawUrl = res.downloadUrl || res.url;
      if (!rawUrl) return;
      // Proxy URLs are relative paths — fetch through the API with auth then open as blob
      if (rawUrl.startsWith('/')) {
        const token = getIdentityAccessToken();
        const fetchRes = await fetch(rawUrl, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!fetchRes.ok) throw new Error('Failed to download resume');
        const blob = await fetchRes.blob();
        window.open(URL.createObjectURL(blob), '_blank', 'noopener,noreferrer');
      } else {
        window.open(rawUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to retrieve resume download link');
    } finally {
      setDownloading(false);
    }
  }

  async function handleReject() {
    setSubmittingAction(true);
    setError(null);
    try {
      const updated = await updateResumeSubmissionStatus(
        submission.id,
        'rejected',
        rejectionReason.trim() || undefined,
      );
      // The list row keeps its ATS summary; the status endpoint does not return it.
      const merged = { ...updated, ats: submission.ats };
      setSubmission(merged);
      onUpdated(merged);
      setRejecting(false);
      setSuccessMsg('Submission marked as rejected.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to reject submission');
    } finally {
      setSubmittingAction(false);
    }
  }

  async function handleConvert() {
    setSubmittingAction(true);
    setError(null);
    try {
      const res = await convertResumeSubmission(submission.id, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        source,
        screeningNotes: screeningNotes.trim() || undefined,
      });

      const merged = { ...res.submission, ats: submission.ats };
      setSubmission(merged);
      onUpdated(merged);
      setConverting(false);
      setSuccessMsg('Candidate created successfully from resume submission!');

      if (onCandidateCreated) {
        onCandidateCreated(res.candidateId || res.candidate?.id || res.submission?.candidateId || '');
      }
    } catch (cause) {
      if (cause instanceof Error && (cause.message.includes('already exists') || cause.message.includes('409'))) {
        setError('A candidate with this email address already exists for this job requisition.');
      } else {
        setError(cause instanceof Error ? cause.message : 'Failed to convert submission to candidate');
      }
    } finally {
      setSubmittingAction(false);
    }
  }

  return (
    <Modal
      title={`${submission.firstName} ${submission.lastName} — ${submission.requisitionNumber ?? 'Requisition'}`}
      onClose={onClose}
      size="lg"
      // The window stays open after a rejection or conversion, so only a half-done one counts as unsaved.
      dirty={rejecting || converting}
    >
      <div className="space-y-6">
        {error && <Notice error>{error}</Notice>}
        {successMsg && <Notice>{successMsg}</Notice>}

        {/* Top Header Card */}
        <div className="rounded-xl border border-app-border bg-app-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-app-foreground">
                  {submission.firstName} {submission.lastName}
                </h3>
                <ResumeSubmissionStatusBadge status={submission.status} />
              </div>
              <p className="text-xs text-app-muted">
                Applied for: <span className="font-medium text-app-foreground">{submission.requisitionTitle ?? 'Role'}</span>
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                kind="secondary"
                disabled={downloading}
                onClick={() => void handleDownloadResume()}
              >
                {downloading ? (
                  'Loading Resume...'
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <Icon name="notepad" className="size-4" />
                    <span>View / Download Resume</span>
                  </span>
                )}
              </Button>
            </div>
          </div>

          <div className="mt-4 grid gap-2 border-t border-app-border pt-3 text-xs sm:grid-cols-3">
            <div>
              <span className="text-app-muted">Email: </span>
              <span className="font-medium text-app-foreground">{submission.email}</span>
            </div>
            <div>
              <span className="text-app-muted">Phone: </span>
              <span className="font-medium text-app-foreground">{submission.phone ?? 'Not provided'}</span>
            </div>
            <div>
              <span className="text-app-muted">Source: </span>
              <span className="capitalize font-medium text-app-foreground">
                {submissionSource(submission) === 'application_link' ? 'Campus Application Link' : 'HR Manual Upload'}
              </span>
            </div>
            <div>
              <span className="text-app-muted">File: </span>
              <span className="font-mono text-app-foreground">{submission.resumeFilename}</span>
            </div>
            <div>
              <span className="text-app-muted">File Size: </span>
              <span>{(submission.resumeFileSize / 1024).toFixed(1)} KB</span>
            </div>
            <div>
              <span className="text-app-muted">Submitted: </span>
              <span>{new Date(submission.createdAt).toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Rejection Form Mode */}
        <div ref={decisionForm} />
        {rejecting && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 space-y-3">
            <h4 className="font-semibold text-rose-800 dark:text-rose-200">
              Reject Resume Submission
            </h4>
            <p className="text-xs text-rose-700 dark:text-rose-300">
              Provide an optional internal rejection reason for HR audit tracking:
            </p>
            <textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              rows={3}
              placeholder="e.g. Does not meet minimum years of experience requirement..."
              className="w-full rounded-lg border border-app-border bg-app-background p-2.5 text-xs text-app-foreground outline-none focus:border-rose-500"
            />
            <div className="flex justify-end gap-2">
              <Button
                kind="secondary"
                disabled={submittingAction}
                onClick={() => setRejecting(false)}
              >
                Cancel
              </Button>
              <Button
                kind="primary"
                disabled={submittingAction}
                onClick={() => void handleReject()}
              >
                {submittingAction ? 'Rejecting...' : 'Confirm Rejection'}
              </Button>
            </div>
          </div>
        )}

        {/* Conversion Form Mode */}
        {converting ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-4">
            <div>
              <h4 className="font-semibold text-emerald-800 dark:text-emerald-200">
                Add to Candidate Pipeline
              </h4>
              <p className="text-xs text-emerald-700 dark:text-emerald-300">
                Review and refine candidate details before officially creating the candidate profile.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="First Name *"
                value={firstName}
                onChange={setFirstName}
                required
              />

              <Field
                label="Last Name *"
                value={lastName}
                onChange={setLastName}
                required
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Email *"
                type="email"
                value={email}
                onChange={setEmail}
                required
              />

              <Field
                label="Phone"
                type="tel"
                value={phone}
                onChange={setPhone}
              />
            </div>

            <Select
              label="Candidate Sourcing Channel"
              value={source}
              onChange={(val) => setSource(val as CandidateSource)}
              options={[
                { value: 'career_site', label: 'Career Portal / Campus Link' },
                { value: 'direct', label: 'Direct Application' },
                { value: 'referral', label: 'Internal Referral' },
                { value: 'job_board', label: 'Job Board' },
                { value: 'agency', label: 'Staffing Agency' },
                { value: 'linkedin', label: 'LinkedIn' },
                { value: 'other', label: 'Other' },
              ]}
            />

            <label className="block text-xs font-semibold text-app-muted">
              <span className="mb-2 block">Screening Notes</span>
              <textarea
                value={screeningNotes}
                onChange={(e) => setScreeningNotes(e.target.value)}
                rows={3}
                placeholder="Initial HR screening observations..."
                className="w-full rounded-lg border border-app-border bg-app-background p-2.5 text-xs text-app-foreground outline-none"
              />
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                kind="secondary"
                disabled={submittingAction}
                onClick={() => setConverting(false)}
              >
                Cancel
              </Button>
              <Button
                kind="primary"
                disabled={submittingAction}
                onClick={() => void handleConvert()}
              >
                {submittingAction ? 'Adding Candidate...' : 'Confirm & Add Candidate'}
              </Button>
            </div>
          </div>
        ) : (
          /* Parsed Data Showcase */
          <div className="space-y-4">
            {!rejecting && (
              <AtsScanPanel
                submission={submission}
                onScanned={(report) => {
                  const summary = atsScanSummary(report);
                  setSubmission((previous) => ({ ...previous, ats: summary }));
                  onAtsUpdated?.(submission.id, summary);
                }}
                onReject={(note) => {
                  if (note && !rejectionReason.trim()) setRejectionReason(note);
                  setRejecting(true);
                }}
                onAccept={(note) => {
                  // The ATS line leads the notes so it is the first thing read on the candidate profile.
                  if (note) setScreeningNotes((previous) => (previous.trim() ? `${note}\n\n${previous.trim()}` : note));
                  setConverting(true);
                }}
              />
            )}

            <ResumeParsedDetails parsed={parsed} />
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-app-border pt-4">
          <Button kind="secondary" onClick={onClose} disabled={submittingAction}>
            Close
          </Button>

          {!converting && !rejecting && submission.status !== 'converted' && (
            <div className="flex items-center gap-2">
              {submission.status !== 'rejected' && (
                <Button
                  kind="secondary"
                  onClick={() => setRejecting(true)}
                  disabled={submittingAction}
                >
                  Reject
                </Button>
              )}

              <Button
                kind="primary"
                onClick={() => setConverting(true)}
                disabled={submittingAction}
              >
                + Add as Candidate
              </Button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
