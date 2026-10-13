import { useRef, useState } from 'react';
import type { ParsedCandidateData } from '@tapcrm/contracts';
import { Button, Field, Modal, Notice, Select } from '../../../ui/components.js';
import { Icon } from '../../../ui/Icon.js';
import { parseCandidateResume, submitHrManualResume } from '../api/recruitmentApi.js';
import {
  acceptSuggestion,
  applyParsedResume,
  clearAutofill,
  editField,
  EMPTY_AUTOFILL,
  resumeMimeType,
  type AutofillField,
  type AutofillState,
} from '../resumeAutofill.js';
import type { CandidateResumeSubmission, JobRequisition } from '../types/index.js';
import { autofillHint, ResumeAutofillNotice, type ResumeReadStatus } from './ResumeAutofillNotice.js';

const MAX_RESUME_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];

export function ResumeUploadModal({
  requisitions,
  defaultRequisitionId,
  onClose,
  onUploaded,
}: {
  readonly requisitions: JobRequisition[];
  readonly defaultRequisitionId?: string | undefined;
  readonly onClose: () => void;
  readonly onUploaded: (submission: CandidateResumeSubmission) => void;
}): React.JSX.Element {
  const [requisitionId, setRequisitionId] = useState(
    defaultRequisitionId ?? (requisitions.length > 0 && requisitions[0] ? requisitions[0].id : ''),
  );
  const [form, setForm] = useState<AutofillState>(EMPTY_AUTOFILL);

  // File state
  const [file, setFile] = useState<File | null>(null);
  const [fileBase64, setFileBase64] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  const [readStatus, setReadStatus] = useState<ResumeReadStatus>('idle');
  const [parsed, setParsed] = useState<ParsedCandidateData | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only the latest file's result may fill the form: a slow read of a file HR
  // has already replaced must not overwrite the new one.
  const latestRead = useRef(0);

  const { firstName, lastName, email, phone } = form.values;
  const setField = (field: AutofillField) => (value: string) => setForm((current) => editField(current, field, value));
  const applySuggestion = (field: AutofillField) => setForm((current) => acceptSuggestion(current, field));

  function removeFile() {
    latestRead.current += 1;
    setFile(null);
    setFileBase64('');
    setParsed(null);
    setReadStatus('idle');
    setForm((current) => clearAutofill(current));
  }

  function handleFileSelected(selectedFile: File) {
    setError(null);
    if (selectedFile.size > MAX_RESUME_BYTES) {
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
    setParsed(null);
    setReadStatus('reading');
    // Values the previous resume filled in belong to that resume.
    setForm((current) => clearAutofill(current));

    const reader = new FileReader();
    reader.onload = () => {
      if (latestRead.current !== read) return;
      const result = reader.result as string;
      const base64 = result.includes(',') ? (result.split(',')[1] ?? '') : result;
      setFileBase64(base64);
      void parseCandidateResume({
        fileBase64: base64,
        filename: selectedFile.name,
        mimeType: resumeMimeType(selectedFile),
      })
        .then(({ parsed: result }) => {
          if (latestRead.current !== read) return;
          setParsed(result);
          setForm((current) => applyParsedResume(current, result));
          setReadStatus('done');
        })
        .catch(() => {
          // HR can still type the details; the notice says reading failed.
          if (latestRead.current === read) setReadStatus('failed');
        });
    };
    reader.onerror = () => {
      if (latestRead.current !== read) return;
      setReadStatus('idle');
      setError('Failed to read the selected resume file.');
    };
    reader.readAsDataURL(selectedFile);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!requisitionId) {
      setError('Please select a job requisition.');
      return;
    }
    if (!file || !fileBase64) {
      setError('Please select a resume file to upload.');
      return;
    }
    if (!firstName.trim() || !lastName.trim()) {
      setError('First and last names are required.');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setError('A valid candidate email is required.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const submission = await submitHrManualResume({
        requisitionId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        resumeBase64: fileBase64,
        resumeFilename: file.name,
        resumeMimeType: resumeMimeType(file),
      });
      onUploaded(submission);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to upload candidate resume');
    } finally {
      setSubmitting(false);
    }
  }

  const reading = readStatus === 'reading';
  const nameSuggestion = [form.suggestions.firstName ?? firstName, form.suggestions.lastName ?? lastName].join(' ').trim();

  return (
    <Modal title="Upload Candidate Resume" onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {error && <Notice error>{error}</Notice>}

        <Select
          label="Job Requisition *"
          value={requisitionId}
          onChange={setRequisitionId}
          disabled={submitting}
          required
          options={requisitions.map((req) => ({
            value: req.id,
            label: `${req.requisitionNumber} - ${req.title} (${req.openingsCount} openings)`,
          }))}
        />

        {/* The resume comes first: reading it fills in the details below. */}
        <div className="space-y-2 pt-1">
          <span className="block text-xs font-semibold text-app-muted">
            Resume Document * (PDF, DOCX, DOC, TXT · Max 10MB)
          </span>

          {file ? (
            <div className="flex items-center justify-between rounded-xl border border-app-border bg-app-surface p-3 text-sm">
              <div className="flex items-center gap-2 truncate">
                <Icon name="notepad" className="size-5 text-app-muted shrink-0" />
                <div className="truncate">
                  <p className="font-semibold text-app-foreground truncate">{file.name}</p>
                  <p className="text-xs text-app-muted">
                    {(file.size / 1024).toFixed(1)} KB · {file.type || 'Document'}
                  </p>
                </div>
              </div>
              <Button kind="secondary" disabled={submitting} onClick={removeFile}>
                Remove
              </Button>
            </div>
          ) : (
            <label
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                const dropped = event.dataTransfer.files?.[0];
                if (dropped && !submitting) handleFileSelected(dropped);
              }}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition ${
                isDragging ? 'border-app-accent bg-app-accent/10' : 'border-app-border bg-app-surface hover:border-app-accent hover:bg-app-accent/5'
              }`}
            >
              <div className="flex size-10 items-center justify-center rounded-xl bg-app-accent/10 text-app-accent">
                <Icon name="notepad" className="size-5" />
              </div>
              <p className="mt-2 text-sm font-semibold text-app-foreground">
                Click to browse or drag and drop resume here
              </p>
              <p className="text-xs text-app-muted">
                The candidate&apos;s name, email and phone are filled in from it
              </p>
              <input
                type="file"
                accept=".pdf,.doc,.docx,.txt"
                className="hidden"
                disabled={submitting}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileSelected(f);
                  e.target.value = '';
                }}
              />
            </label>
          )}

          <ResumeAutofillNotice status={readStatus} parsed={parsed} state={form} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="First Name *"
            value={firstName}
            onChange={setField('firstName')}
            required
            disabled={submitting}
            placeholder="e.g. John"
            hint={autofillHint(form, 'firstName', applySuggestion, nameSuggestion)}
          />

          <Field
            label="Last Name *"
            value={lastName}
            onChange={setField('lastName')}
            required
            disabled={submitting}
            placeholder="e.g. Doe"
            hint={form.suggestions.firstName === undefined ? autofillHint(form, 'lastName', applySuggestion, nameSuggestion) : null}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Email Address *"
            type="email"
            value={email}
            onChange={setField('email')}
            required
            disabled={submitting}
            placeholder="candidate@example.com"
            hint={autofillHint(form, 'email', applySuggestion)}
          />

          <Field
            label="Phone Number"
            type="tel"
            value={phone}
            onChange={setField('phone')}
            disabled={submitting}
            placeholder="+91 98765 43210"
            hint={autofillHint(form, 'phone', applySuggestion)}
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-app-border pt-4">
          <Button kind="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button kind="primary" type="submit" disabled={submitting || !file || !fileBase64}>
            {submitting ? 'Uploading...' : reading ? 'Upload (reading resume…)' : 'Upload Resume'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
