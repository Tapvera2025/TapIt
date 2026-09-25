import { useState } from 'react';
import { Button, Field, Modal, Notice, Select } from '../../../ui/components.js';
import { submitHrManualResume } from '../api/recruitmentApi.js';
import type { CandidateResumeSubmission, JobRequisition } from '../types/index.js';

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
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  // File state
  const [file, setFile] = useState<File | null>(null);
  const [fileBase64, setFileBase64] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allowedMimeTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
  ];

  function handleFileSelected(selectedFile: File) {
    setError(null);
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

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? (result.split(',')[1] ?? '') : result;
      setFileBase64(base64);
    };
    reader.onerror = () => {
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
    if (!firstName.trim() || !lastName.trim()) {
      setError('First and last names are required.');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setError('A valid candidate email is required.');
      return;
    }
    if (!file || !fileBase64) {
      setError('Please select a resume file to upload.');
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
        resumeMimeType: file.type || 'application/pdf',
      });
      onUploaded(submission);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to upload candidate resume');
    } finally {
      setSubmitting(false);
    }
  }

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

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="First Name *"
            value={firstName}
            onChange={setFirstName}
            required
            disabled={submitting}
            placeholder="e.g. John"
          />

          <Field
            label="Last Name *"
            value={lastName}
            onChange={setLastName}
            required
            disabled={submitting}
            placeholder="e.g. Doe"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Email Address *"
            type="email"
            value={email}
            onChange={setEmail}
            required
            disabled={submitting}
            placeholder="candidate@example.com"
          />

          <Field
            label="Phone Number"
            type="tel"
            value={phone}
            onChange={setPhone}
            disabled={submitting}
            placeholder="+91 98765 43210"
          />
        </div>

        {/* File Upload Zone */}
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-app-muted">
            Resume Document * (PDF, DOCX, DOC, TXT · Max 10MB)
          </label>

          {file ? (
            <div className="flex items-center justify-between rounded-xl border border-app-border bg-app-surface p-3 text-sm">
              <div className="flex items-center gap-2 truncate">
                <span className="text-xl" aria-hidden="true">📄</span>
                <div className="truncate">
                  <p className="font-semibold text-app-foreground truncate">{file.name}</p>
                  <p className="text-xs text-app-muted">
                    {(file.size / 1024).toFixed(1)} KB · {file.type || 'Document'}
                  </p>
                </div>
              </div>
              <Button
                kind="secondary"
                disabled={submitting}
                onClick={() => {
                  setFile(null);
                  setFileBase64('');
                }}
              >
                Remove
              </Button>
            </div>
          ) : (
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-app-border bg-app-surface p-6 text-center transition hover:border-app-accent hover:bg-app-accent/5">
              <span className="text-3xl" aria-hidden="true">📁</span>
              <p className="mt-2 text-sm font-semibold text-app-foreground">
                Click to browse or drag and drop resume here
              </p>
              <p className="text-xs text-app-muted">
                PDF, DOCX, DOC, or TXT up to 10MB
              </p>
              <input
                type="file"
                accept=".pdf,.doc,.docx,.txt"
                className="hidden"
                disabled={submitting}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileSelected(f);
                }}
              />
            </label>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-app-border pt-4">
          <Button kind="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button kind="primary" type="submit" disabled={submitting || !file}>
            {submitting ? 'Uploading & Parsing...' : 'Upload Resume'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
