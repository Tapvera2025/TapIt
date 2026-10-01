import { useState } from 'react';
import { Button, Field, Modal, Notice, Select } from '../../../ui/components.js';
import { Icon } from '../../../ui/Icon.js';
import {
  convertResumeSubmission,
  getResumeDownloadUrl,
  updateResumeSubmissionStatus,
} from '../api/recruitmentApi.js';
import { ResumeSubmissionStatusBadge } from './StatusBadge.js';
import type {
  CandidateResumeSubmission,
  CandidateSource,
} from '../types/index.js';

export function ResumeReviewModal({
  submission: initialSubmission,
  onClose,
  onUpdated,
  onCandidateCreated,
}: {
  readonly submission: CandidateResumeSubmission;
  readonly onClose: () => void;
  readonly onUpdated: (submission: CandidateResumeSubmission) => void;
  readonly onCandidateCreated?: ((candidateId: string) => void) | undefined;
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
    submission.source === 'application_link' ? 'career_site' : 'direct',
  );
  const [screeningNotes, setScreeningNotes] = useState(
    submission.parsedData?.summary ? `Extracted Summary: ${submission.parsedData.summary}` : '',
  );

  const [downloading, setDownloading] = useState(false);
  const [submittingAction, setSubmittingAction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const parsed = submission.parsedData;

  async function handleDownloadResume() {
    setDownloading(true);
    setError(null);
    try {
      const res = await getResumeDownloadUrl(submission.id);
      const url = res.downloadUrl || res.url;
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
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
      setSubmission(updated);
      onUpdated(updated);
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

      setSubmission(res.submission);
      onUpdated(res.submission);
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
                {submission.source === 'application_link' ? 'Campus Application Link' : 'HR Manual Upload'}
              </span>
            </div>
            <div>
              <span className="text-app-muted">File: </span>
              <span className="font-mono text-app-foreground">{submission.resumeFileName}</span>
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
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h4 className="font-semibold text-app-foreground">
                  Extracted Resume Intelligence
                </h4>
                <span className="rounded-full bg-app-accent/10 px-2 py-0.5 text-[10px] font-bold text-app-accent">
                  Heuristic Parser
                </span>
              </div>
              <p className="text-[11px] text-app-muted">
                Extracted automatically · Non-guaranteed
              </p>
            </div>

            {/* Skills */}
            <div className="rounded-xl border border-app-border bg-app-surface p-4">
              <h5 className="text-xs font-bold uppercase tracking-wider text-app-muted">
                Identified Technical Skills
              </h5>
              {parsed?.skills && parsed.skills.length > 0 ? (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {parsed.skills.map((skill) => (
                    <span
                      key={skill}
                      className="rounded-md border border-app-border bg-app-surface-raised px-2.5 py-1 text-xs font-medium capitalize text-app-foreground"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-app-muted">
                  No standard tech keywords detected in resume text.
                </p>
              )}
            </div>

            {/* Education & Experience */}
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-app-border bg-app-surface p-4">
                <h5 className="text-xs font-bold uppercase tracking-wider text-app-muted">
                  Education Details
                </h5>
                {parsed?.education && parsed.education.length > 0 ? (
                  <div className="mt-2 space-y-2">
                    {parsed.education.map((edu, idx) => (
                      <div key={idx} className="rounded-lg bg-app-background p-2 text-xs">
                        <p className="font-semibold text-app-foreground">{edu.degree ?? 'Degree'}</p>
                        <p className="text-app-muted">{edu.institution ?? 'Institution'}</p>
                        {edu.year && <p className="text-[11px] text-app-accent">{edu.year}</p>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-app-muted">No explicit degree patterns identified.</p>
                )}
              </div>

              <div className="rounded-xl border border-app-border bg-app-surface p-4">
                <h5 className="text-xs font-bold uppercase tracking-wider text-app-muted">
                  Experience Mentions
                </h5>
                {parsed?.experience && parsed.experience.length > 0 ? (
                  <div className="mt-2 space-y-2">
                    {parsed.experience.map((exp, idx) => (
                      <div key={idx} className="rounded-lg bg-app-background p-2 text-xs">
                        <p className="font-semibold text-app-foreground">{exp.title ?? 'Position'}</p>
                        {exp.duration && <p className="text-[11px] text-app-accent">{exp.duration}</p>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-app-muted">No standard job titles detected.</p>
                )}
              </div>
            </div>

            {/* Raw Text Preview */}
            {parsed?.rawTextPreview && (
              <div className="rounded-xl border border-app-border bg-app-surface p-4">
                <h5 className="text-xs font-bold uppercase tracking-wider text-app-muted">
                  Resume Text Excerpt
                </h5>
                <pre className="mt-2 max-h-36 overflow-y-auto whitespace-pre-wrap rounded-lg bg-app-background p-2.5 font-mono text-[11px] text-app-muted">
                  {parsed.rawTextPreview}
                </pre>
              </div>
            )}
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
