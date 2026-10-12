import { useRef, useState } from 'react';
import type { ParsedCandidateData } from '@tapcrm/contracts';
import { Button, Field, Modal, Notice, Select } from '../../../ui/components.js';
import { Icon } from '../../../ui/Icon.js';
import {
  createCandidate,
  parseCandidateResume,
  uploadCandidateResume,
} from '../api/recruitmentApi.js';
import {
  acceptSuggestion,
  applyParsedResume,
  clearAutofill,
  editField,
  EMPTY_AUTOFILL,
  resumeMimeType as mimeTypeOf,
  resumeNotes,
  type AutofillField,
  type AutofillState,
} from '../resumeAutofill.js';
import type {
  Candidate,
  CandidateSource,
  JobRequisition,
} from '../types/index.js';
import { autofillHint, ResumeAutofillNotice, type ResumeReadStatus } from './ResumeAutofillNotice.js';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];

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
  const [form, setForm] = useState<AutofillState>(EMPTY_AUTOFILL);
  const [resumeUrl, setResumeUrl] = useState('');
  const [source, setSource] = useState<CandidateSource>('linkedin');
  const [screeningNotes, setScreeningNotes] = useState('');

  // Resume upload & reading state
  const [file, setFile] = useState<File | null>(null);
  const [resumeObjectKey, setResumeObjectKey] = useState<string | null>(null);
  const [resumeFileName, setResumeFileName] = useState<string | null>(null);
  const [resumeMimeType, setResumeMimeType] = useState<string | null>(null);
  const [resumeSize, setResumeSize] = useState<number | null>(null);
  const [resumeUploadedAt, setResumeUploadedAt] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [readStatus, setReadStatus] = useState<ResumeReadStatus>('idle');
  const [parsed, setParsed] = useState<ParsedCandidateData | null>(null);
  // Only the latest resume may fill the form, and notes written from a
  // resume are replaced, not stacked, when the resume changes.
  const latestRead = useRef(0);
  const notesFromResume = useRef('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { firstName, lastName, email, phone } = form.values;
  const setField = (field: AutofillField) => (value: string) => setForm((current) => editField(current, field, value));
  const applySuggestion = (field: AutofillField) => setForm((current) => acceptSuggestion(current, field));

  function withdrawResumeNotes() {
    const previous = notesFromResume.current;
    notesFromResume.current = '';
    if (!previous) return;
    setScreeningNotes((current) => {
      if (current.trim() === previous) return '';
      return current.replace(`\n\n${previous}`, '');
    });
  }

  function addResumeNotes(result: ParsedCandidateData) {
    const notes = resumeNotes(result);
    notesFromResume.current = notes;
    if (!notes) return;
    setScreeningNotes((current) => (current.trim() ? `${current.trim()}\n\n${notes}` : notes));
  }

  async function readResume(objectKey: string, filename: string, mimeType: string, read: number) {
    setReadStatus('reading');
    try {
      const { parsed: result } = await parseCandidateResume({ resumeObjectKey: objectKey, filename, mimeType });
      if (latestRead.current !== read) return;
      setParsed(result);
      setForm((current) => applyParsedResume(current, result));
      addResumeNotes(result);
      setReadStatus('done');
    } catch {
      if (latestRead.current === read) setReadStatus('failed');
    }
  }

  function handleFileSelected(selectedFile: File) {
    setError(null);

    if (selectedFile.size > 10 * 1024 * 1024) {
      setError('Resume file size cannot exceed 10MB.');
      return;
    }

    const lowerExt = selectedFile.name.toLowerCase().split('.').pop() ?? '';
    const isAllowedExt = ['pdf', 'doc', 'docx', 'txt'].includes(lowerExt);
    if (!ALLOWED_MIME_TYPES.includes(selectedFile.type) && !isAllowedExt) {
      setError('Unsupported file type. Please upload a PDF, DOC, DOCX, or TXT file.');
      return;
    }

    const read = latestRead.current + 1;
    latestRead.current = read;
    setFile(selectedFile);
    setUploading(true);
    setParsed(null);
    setReadStatus('idle');

    const reader = new FileReader();
    reader.onload = async () => {
      if (latestRead.current !== read) return;
      const result = reader.result as string;
      const base64 = result.includes(',') ? (result.split(',')[1] ?? '') : result;
      const mimeType = mimeTypeOf(selectedFile);

      try {
        const uploadResult = await uploadCandidateResume({
          filename: selectedFile.name,
          mimeType,
          fileBase64: base64,
          requisitionId: requisitionId || undefined,
        });
        if (latestRead.current !== read) return;

        setResumeObjectKey(uploadResult.resumeObjectKey);
        setResumeFileName(uploadResult.resumeFileName);
        setResumeMimeType(uploadResult.resumeMimeType);
        setResumeSize(uploadResult.resumeSize);
        setResumeUploadedAt(uploadResult.resumeUploadedAt);
        if (uploadResult.previewUrl) {
          setResumeUrl(uploadResult.previewUrl);
        }
        setUploading(false);
        // Reading starts on its own: the details fill in while HR reviews the file.
        void readResume(uploadResult.resumeObjectKey, uploadResult.resumeFileName, uploadResult.resumeMimeType || mimeType, read);
      } catch (uploadCause) {
        if (latestRead.current !== read) return;
        setUploading(false);
        setError(
          uploadCause instanceof Error
            ? uploadCause.message
            : 'Unable to upload resume. Please try again.',
        );
      }
    };

    reader.onerror = () => {
      if (latestRead.current !== read) return;
      setUploading(false);
      setError('Failed to read the selected resume file.');
    };

    reader.readAsDataURL(selectedFile);
  }

  function handleReplaceResume() {
    latestRead.current += 1;
    setFile(null);
    setResumeObjectKey(null);
    setResumeFileName(null);
    setResumeMimeType(null);
    setResumeSize(null);
    setResumeUploadedAt(null);
    setResumeUrl('');
    setParsed(null);
    setReadStatus('idle');
    setUploading(false);
    setError(null);
    // Details and notes that came from this resume go with it; HR's own typing stays.
    setForm((current) => clearAutofill(current));
    withdrawResumeNotes();
  }

  function handleViewResume() {
    if (file) {
      const blobUrl = URL.createObjectURL(file);
      window.open(blobUrl, '_blank');
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
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

  const reading = readStatus === 'reading';
  const nameSuggestion = [form.suggestions.firstName ?? firstName, form.suggestions.lastName ?? lastName].join(' ').trim();

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

        {/* Resume upload: reading it fills in the candidate's details */}
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
                  <Icon name="notepad" className="size-6 text-app-muted shrink-0" />
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
                    disabled={uploading || submitting}
                    onClick={handleViewResume}
                    className="!py-1 !px-2.5 !text-xs"
                  >
                    View
                  </Button>
                  <Button
                    type="button"
                    kind="secondary"
                    disabled={uploading || submitting}
                    onClick={handleReplaceResume}
                    className="!py-1 !px-2.5 !text-xs"
                  >
                    Replace
                  </Button>
                </div>
              </div>

              {uploading && (
                <div className="flex items-center gap-2 text-xs text-app-muted animate-pulse">
                  <span className="size-3.5 animate-spin rounded-full border-2 border-app-muted border-t-transparent" />
                  <span>Uploading resume...</span>
                </div>
              )}

              <ResumeAutofillNotice status={readStatus} parsed={parsed} state={form} />

              {readStatus === 'failed' && resumeObjectKey && (
                <Button
                  type="button"
                  kind="secondary"
                  disabled={submitting}
                  onClick={() => void readResume(resumeObjectKey, resumeFileName ?? file.name, resumeMimeType ?? mimeTypeOf(file), latestRead.current)}
                  className="!py-1.5 !px-3 !text-xs font-semibold"
                >
                  Try reading again
                </Button>
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
                if (droppedFile) handleFileSelected(droppedFile);
              }}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition ${
                isDragging
                  ? 'border-app-accent bg-app-accent/10'
                  : 'border-app-border bg-app-background hover:border-app-accent hover:bg-app-accent/5'
              }`}
            >
              <Icon name="notepad" className="size-8 text-app-muted" />
              <p className="mt-2 text-sm font-semibold text-app-foreground">
                Upload Resume
              </p>
              <p className="text-xs text-app-muted mt-1">
                Drag &amp; drop or Browse
              </p>
              <p className="text-[11px] text-app-muted mt-0.5">
                The candidate&apos;s details are filled in from it
              </p>
              <input
                type="file"
                accept=".pdf,.doc,.docx,.txt"
                className="hidden"
                disabled={submitting || uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileSelected(f);
                  e.target.value = '';
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
              onChange={setField('firstName')}
              placeholder="e.g. John"
              required
              disabled={submitting}
              hint={autofillHint(form, 'firstName', applySuggestion, nameSuggestion)}
            />
            <Field
              label="Last Name"
              value={lastName}
              onChange={setField('lastName')}
              placeholder="e.g. Doe"
              required
              disabled={submitting}
              hint={form.suggestions.firstName === undefined ? autofillHint(form, 'lastName', applySuggestion, nameSuggestion) : null}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Email Address"
            type="email"
            value={email}
            onChange={setField('email')}
            placeholder="john.doe@example.com"
            required
            disabled={submitting}
            hint={autofillHint(form, 'email', applySuggestion)}
          />
          <Field
            label="Phone Number"
            type="tel"
            value={phone}
            onChange={setField('phone')}
            placeholder="+91 98765 43210"
            disabled={submitting}
            hint={autofillHint(form, 'phone', applySuggestion)}
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
          <Button type="submit" kind="primary" disabled={submitting || uploading}>
            {submitting ? 'Adding Candidate...' : reading ? 'Create Candidate (reading resume…)' : 'Create Candidate'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
