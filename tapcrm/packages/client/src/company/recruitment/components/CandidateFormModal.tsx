import { useState } from 'react';
import { Button, Field, Modal, Notice, Select } from '../../../ui/components.js';
import {
  createCandidate,
  parseCandidateResume,
  uploadCandidateResume,
} from '../api/recruitmentApi.js';
import type {
  Candidate,
  CandidateSource,
  JobRequisition,
} from '../types/index.js';

export function CandidateFormModal({
  requisitions,
  defaultRequisitionId,
  onClose,
  onCreated,
}: {
  readonly requisitions: JobRequisition[];
  readonly defaultRequisitionId?: string | undefined;
  readonly onClose: () => void;
  readonly onCreated: (candidate: Candidate) => void;
}): React.JSX.Element {
  const [requisitionId, setRequisitionId] = useState(
    defaultRequisitionId || (requisitions.length > 0 && requisitions[0] ? requisitions[0].id : ''),
  );
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [resumeUrl, setResumeUrl] = useState('');
  const [source, setSource] = useState<CandidateSource>('linkedin');
  const [screeningNotes, setScreeningNotes] = useState('');

  // Resume Upload & Parse state
  const [file, setFile] = useState<File | null>(null);
  const [fileBase64, setFileBase64] = useState<string>('');
  const [resumeObjectKey, setResumeObjectKey] = useState<string | null>(null);
  const [resumeFileName, setResumeFileName] = useState<string | null>(null);
  const [resumeMimeType, setResumeMimeType] = useState<string | null>(null);
  const [resumeSize, setResumeSize] = useState<number | null>(null);
  const [resumeUploadedAt, setResumeUploadedAt] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseSuccess, setParseSuccess] = useState(false);
  const [parseNotice, setParseNotice] = useState<{
    type: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allowedMimeTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
  ];

  async function handleFileSelected(selectedFile: File) {
    setError(null);
    setParseNotice(null);
    setParseSuccess(false);

    if (selectedFile.size > 10 * 1024 * 1024) {
      setError('Resume file size cannot exceed 10MB.');
      return;
    }

    const lowerExt = selectedFile.name.toLowerCase().split('.').pop() ?? '';
    const isAllowedExt = ['pdf', 'doc', 'docx', 'txt'].includes(lowerExt);
    if (!allowedMimeTypes.includes(selectedFile.type) && !isAllowedExt) {
      setError('Unsupported file type. Please upload a PDF, DOC, DOCX, or TXT file.');
      return;
    }

    setFile(selectedFile);
    setUploading(true);

    const reader = new FileReader();
    reader.onload = async () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? (result.split(',')[1] ?? '') : result;
      setFileBase64(base64);

      try {
        const uploadResult = await uploadCandidateResume({
          filename: selectedFile.name,
          mimeType: selectedFile.type || 'application/pdf',
          fileBase64: base64,
          requisitionId: requisitionId || undefined,
        });

        setResumeObjectKey(uploadResult.resumeObjectKey);
        setResumeFileName(uploadResult.resumeFileName);
        setResumeMimeType(uploadResult.resumeMimeType);
        setResumeSize(uploadResult.resumeSize);
        setResumeUploadedAt(uploadResult.resumeUploadedAt);
        if (uploadResult.previewUrl) {
          setResumeUrl(uploadResult.previewUrl);
        }
      } catch (uploadCause) {
        setError(
          uploadCause instanceof Error
            ? uploadCause.message
            : 'Unable to upload resume. Please try again.',
        );
      } finally {
        setUploading(false);
      }
    };

    reader.onerror = () => {
      setUploading(false);
      setError('Failed to read the selected resume file.');
    };

    reader.readAsDataURL(selectedFile);
  }

  async function handleParseResume() {
    if (!file && !resumeObjectKey) {
      return;
    }

    setParsing(true);
    setParseNotice(null);

    try {
      const res = await parseCandidateResume({
        resumeObjectKey: resumeObjectKey || undefined,
        fileBase64: !resumeObjectKey ? fileBase64 : undefined,
        filename: resumeFileName || file?.name || 'resume.pdf',
        mimeType: resumeMimeType || file?.type || 'application/pdf',
      });

      const parsed = res.parsed;
      let fieldsFound = 0;

      if (parsed.firstName) {
        setFirstName(parsed.firstName);
        fieldsFound++;
      }
      if (parsed.lastName) {
        setLastName(parsed.lastName);
        fieldsFound++;
      }
      if (parsed.email) {
        setEmail(parsed.email);
        fieldsFound++;
      }
      if (parsed.phone) {
        setPhone(parsed.phone);
        fieldsFound++;
      }

      // Format extracted skills, experience, and education into screening notes
      const notesParts: string[] = [];
      if (parsed.skills && parsed.skills.length > 0) {
        fieldsFound++;
        notesParts.push(`Skills: ${parsed.skills.join(', ')}`);
      }
      if (parsed.experience && parsed.experience.length > 0) {
        fieldsFound++;
        const expSummary = parsed.experience
          .map((e) => `${e.title}${e.duration ? ` (${e.duration})` : ''}`)
          .join('; ');
        notesParts.push(`Experience: ${expSummary}`);
      }
      if (parsed.education && parsed.education.length > 0) {
        fieldsFound++;
        const eduSummary = parsed.education
          .map((e) => `${e.degree}${e.year ? ` (${e.year})` : ''}`)
          .join('; ');
        notesParts.push(`Education: ${eduSummary}`);
      }

      if (notesParts.length > 0) {
        const extraNotes = notesParts.join('\n\n');
        setScreeningNotes((prev) =>
          prev.trim() ? prev.trim() + '\n\n---\nResume Extracted Notes:\n' + extraNotes : extraNotes,
        );
      }

      setParseSuccess(true);
      if (fieldsFound > 0) {
        setParseNotice({
          type: 'success',
          message:
            'Resume parsed successfully ✓ Candidate information has been pre-filled. Please review before creating the candidate.',
        });
      } else {
        setParseNotice({
          type: 'warning',
          message:
            "We couldn't extract contact information from this resume. You can enter the candidate details manually.",
        });
      }
    } catch {
      setParseNotice({
        type: 'warning',
        message:
          "We couldn't extract information from this resume. You can enter the candidate details manually.",
      });
    } finally {
      setParsing(false);
    }
  }

  function handleReplaceResume() {
    setFile(null);
    setFileBase64('');
    setResumeObjectKey(null);
    setResumeFileName(null);
    setResumeMimeType(null);
    setResumeSize(null);
    setResumeUploadedAt(null);
    setResumeUrl('');
    setParseSuccess(false);
    setParseNotice(null);
    setError(null);
  }

  function handleViewResume() {
    if (file) {
      const blobUrl = URL.createObjectURL(file);
      window.open(blobUrl, '_blank');
    } else if (resumeUrl) {
      window.open(resumeUrl, '_blank');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!requisitionId) {
      setError('Please select an applied requisition');
      return;
    }
    if (!firstName.trim() || !lastName.trim()) {
      setError('Please provide candidate first and last name');
      return;
    }
    if (!email.trim()) {
      setError('Please provide candidate email address');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const created = await createCandidate({
        requisitionId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        resumeUrl: resumeUrl.trim() || undefined,
        resumeObjectKey: resumeObjectKey || undefined,
        resumeFileName: resumeFileName || undefined,
        resumeMimeType: resumeMimeType || undefined,
        resumeSize: resumeSize || undefined,
        resumeUploadedAt: resumeUploadedAt || undefined,
        source,
        screeningNotes: screeningNotes.trim() || undefined,
      });
      onCreated(created);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to add candidate');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Add Candidate" onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {error && <Notice error>{error}</Notice>}

        {/* Applied Requisition Selection */}
        <Select
          label="Applied Job Requisition"
          value={requisitionId}
          onChange={setRequisitionId}
          disabled={submitting || uploading}
          options={requisitions.map((r) => ({
            value: r.id,
            label: `${r.requisitionNumber} - ${r.title} (${r.departmentName ?? 'General'})`,
          }))}
          required
        />

        {/* Resume Upload & Parse Section */}
        <div className="space-y-3 rounded-xl border border-app-border bg-app-surface/50 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-app-muted">
              Resume Document
            </span>
            <span className="text-[11px] text-app-muted">PDF, DOC, DOCX, TXT · Max 10MB</span>
          </div>

          {file ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl border border-app-border bg-app-background p-3 text-sm">
                <div className="flex items-center gap-2.5 truncate">
                  <span className="text-2xl" aria-hidden="true">📄</span>
                  <div className="truncate">
                    <p className="font-semibold text-app-foreground truncate">{file.name}</p>
                    <p className="text-xs text-app-muted">
                      {(file.size / 1024).toFixed(1)} KB · {file.type || 'Document'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    kind="secondary"
                    disabled={uploading || parsing || submitting}
                    onClick={handleViewResume}
                    className="!py-1 !px-2.5 !text-xs"
                  >
                    View
                  </Button>
                  <Button
                    type="button"
                    kind="secondary"
                    disabled={uploading || parsing || submitting}
                    onClick={handleReplaceResume}
                    className="!py-1 !px-2.5 !text-xs"
                  >
                    Replace
                  </Button>
                </div>
              </div>

              {uploading && (
                <div className="flex items-center gap-2 text-xs text-app-muted animate-pulse">
                  <span>⏳</span>
                  <span>Uploading resume...</span>
                </div>
              )}

              {!uploading && !parseSuccess && (
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-emerald-400 flex items-center gap-1.5">
                    <span>✓</span> Resume uploaded successfully
                  </span>
                  <Button
                    type="button"
                    kind="secondary"
                    disabled={parsing || submitting}
                    onClick={() => void handleParseResume()}
                    className="!py-1.5 !px-3 !text-xs font-semibold"
                  >
                    {parsing ? 'Analyzing resume...' : 'Parse Resume'}
                  </Button>
                </div>
              )}

              {parsing && (
                <div className="flex items-center gap-2 rounded-lg border border-app-accent/30 bg-app-accent/10 p-2.5 text-xs text-app-accent">
                  <span className="animate-spin">🔄</span>
                  <span>Analyzing resume... Extracting candidate information...</span>
                </div>
              )}

              {parseNotice && (
                <Notice error={parseNotice.type === 'error'}>
                  {parseNotice.message}
                </Notice>
              )}
            </div>
          ) : (
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const droppedFile = e.dataTransfer.files?.[0];
                if (droppedFile) void handleFileSelected(droppedFile);
              }}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition ${
                isDragging
                  ? 'border-app-accent bg-app-accent/10'
                  : 'border-app-border bg-app-background hover:border-app-accent hover:bg-app-accent/5'
              }`}
            >
              <span className="text-3xl" aria-hidden="true">📄</span>
              <p className="mt-2 text-sm font-semibold text-app-foreground">
                Upload Resume
              </p>
              <p className="text-xs text-app-muted mt-1">
                Drag &amp; drop or Browse
              </p>
              <p className="text-[11px] text-app-muted mt-0.5">
                PDF / DOC / DOCX / TXT up to 10MB
              </p>
              <input
                type="file"
                accept=".pdf,.doc,.docx,.txt"
                className="hidden"
                disabled={submitting || uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFileSelected(f);
                }}
              />
            </label>
          )}
        </div>

        {/* Candidate Information Header */}
        <div className="pt-2">
          <p className="text-xs font-bold uppercase tracking-wider text-app-muted mb-3">
            Candidate Information
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="First Name"
              value={firstName}
              onChange={setFirstName}
              placeholder="e.g. John"
              required
              disabled={submitting}
            />
            <Field
              label="Last Name"
              value={lastName}
              onChange={setLastName}
              placeholder="e.g. Doe"
              required
              disabled={submitting}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Email Address"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="john.doe@example.com"
            required
            disabled={submitting}
          />
          <Field
            label="Phone Number"
            type="tel"
            value={phone}
            onChange={setPhone}
            placeholder="+91 98765 43210"
            disabled={submitting}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Application Source"
            value={source}
            onChange={(val) => setSource(val as CandidateSource)}
            disabled={submitting}
            options={[
              { value: 'linkedin', label: 'LinkedIn' },
              { value: 'direct', label: 'Direct Application' },
              { value: 'referral', label: 'Employee Referral' },
              { value: 'career_site', label: 'Career Site' },
              { value: 'job_board', label: 'Job Board' },
              { value: 'agency', label: 'Recruitment Agency' },
              { value: 'internal', label: 'Internal Transfer' },
              { value: 'other', label: 'Other' },
            ]}
          />

          <Field
            label="Resume / Portfolio URL"
            type="url"
            value={resumeUrl}
            onChange={setResumeUrl}
            placeholder="https://..."
            disabled={submitting}
          />
        </div>

        <label className="block text-xs font-semibold text-app-muted">
          <span className="mb-2 block">Initial Screening Notes &amp; Extracted Info</span>
          <textarea
            value={screeningNotes}
            onChange={(e) => setScreeningNotes(e.target.value)}
            rows={4}
            disabled={submitting}
            placeholder="Initial recruiter impressions, extracted skills, experience summary..."
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
          />
        </label>

        <div className="mt-6 flex justify-end gap-3 border-t border-app-border pt-4">
          <Button type="button" kind="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" kind="primary" disabled={submitting || uploading || parsing}>
            {submitting ? 'Adding Candidate...' : 'Create Candidate'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
