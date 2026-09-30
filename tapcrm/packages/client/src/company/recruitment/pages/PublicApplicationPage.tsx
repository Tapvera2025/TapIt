import { useEffect, useState } from 'react';
import { BrandLogo } from '../../../ui/BrandLogo.js';
import { Button, Notice } from '../../../ui/components.js';
import { Icon } from '../../../ui/Icon.js';
import {
  getPublicApplicationLinkDetails,
  submitPublicApplication,
} from '../api/recruitmentApi.js';
import type { PublicJobRequisitionDetails } from '../types/index.js';

export function PublicApplicationPage({
  token,
}: {
  readonly token: string;
}): React.JSX.Element {
  const [loading, setLoading] = useState(true);
  const [linkUnavailable, setLinkUnavailable] = useState(false);
  const [requisition, setRequisition] = useState<PublicJobRequisitionDetails | null>(null);

  // Form State
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileBase64, setFileBase64] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLinkUnavailable(false);
    setError(null);

    getPublicApplicationLinkDetails(token)
      .then((data) => {
        if (!cancelled) {
          const resolvedReq = data?.requisition;
          if (resolvedReq) {
            setRequisition(resolvedReq);
          } else {
            setLinkUnavailable(true);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLinkUnavailable(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  function handleFileSelected(selectedFile: File) {
    setError(null);
    if (selectedFile.size > 10 * 1024 * 1024) {
      setError('Resume file size cannot exceed 10MB.');
      return;
    }

    const lowerExt = selectedFile.name.toLowerCase().split('.').pop() ?? '';
    const allowedExts = ['pdf', 'doc', 'docx', 'txt'];
    const allowedMime = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
    ];

    if (!allowedExts.includes(lowerExt) && !allowedMime.includes(selectedFile.type)) {
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
      setError('Failed to read the selected file.');
    };
    reader.readAsDataURL(selectedFile);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      setError('Please provide your full first and last name.');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!file || !fileBase64) {
      setError('Please attach your resume document.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await submitPublicApplication(token, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        resumeBase64: fileBase64,
        resumeFilename: file.name,
        resumeMimeType: file.type || 'application/pdf',
      });
      setSubmitted(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Failed to submit your application. Please check your connection and try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-app-background p-6 text-app-foreground">
        <div className="text-center">
          <BrandLogo className="mx-auto mb-4 w-40" />
          <p className="text-sm text-app-muted">Loading application details...</p>
        </div>
      </main>
    );
  }

  if (linkUnavailable || !requisition) {
    return (
      <main className="grid min-h-screen place-items-center bg-app-background p-6 text-app-foreground">
        <div className="max-w-md rounded-2xl border border-app-border bg-app-surface p-8 text-center shadow-lg">
          <BrandLogo className="mx-auto mb-6 w-36" />
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rose-500/10 text-rose-600">
            <svg className="size-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </div>
          <h1 className="font-display text-xl font-bold text-app-foreground">
            Application Unavailable
          </h1>
          <p className="mt-2 text-sm text-app-muted">
            This application link is no longer active, has expired, or has reached its submission
            capacity.
          </p>
          <p className="mt-4 text-xs text-app-muted">
            If you believe this is in error, please contact the campus recruitment coordinator or
            hiring representative.
          </p>
        </div>
      </main>
    );
  }

  if (submitted) {
    return (
      <main className="grid min-h-screen place-items-center bg-app-background p-6 text-app-foreground">
        <div className="max-w-md rounded-2xl border border-emerald-500/30 bg-app-surface p-8 text-center shadow-lg">
          <BrandLogo className="mx-auto mb-6 w-36" />
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
            <Icon name="check" className="size-8" />
          </div>
          <h1 className="font-display text-2xl font-bold text-app-foreground">
            Application Submitted!
          </h1>
          <p className="mt-3 text-sm text-app-muted">
            Thank you for applying for the{' '}
            <strong className="text-app-foreground">{requisition.title}</strong> position.
          </p>
          <p className="mt-2 text-xs text-app-muted">
            Your resume and details have been forwarded to the hiring team. We will review your
            application and reach out via email regarding next steps.
          </p>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-app-background text-app-foreground">
      {/* Header */}
      <header className="border-b border-app-border bg-app-surface/60 backdrop-blur px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <BrandLogo className="w-36" />
          <span className="rounded-full border border-app-border bg-app-surface-raised px-3 py-1 text-xs font-semibold text-app-muted">
            Campus &amp; Early Careers
          </span>
        </div>
      </header>

      {/* Main Container */}
      <main className="mx-auto max-w-4xl px-4 py-8 md:px-6">
        {/* Job Overview Card */}
        <section className="rounded-2xl border border-app-border bg-app-surface p-6 md:p-8 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-app-accent">
                {requisition.departmentName ?? 'Engineering & Technology'}
              </span>
              <h1 className="mt-1 font-display text-2xl font-bold text-app-foreground md:text-3xl">
                {requisition.title}
              </h1>
              <p className="mt-1 text-xs text-app-muted font-mono">
                Req Reference: {requisition.requisitionNumber}
              </p>
            </div>

            <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">
              ● Actively Sourcing
            </span>
          </div>

          <div className="mt-6 flex flex-wrap gap-4 border-y border-app-border py-4 text-xs">
            <div>
              <span className="text-app-muted">Employment Type: </span>
              <span className="font-semibold capitalize text-app-foreground">
                {requisition.employmentType.replace('_', ' ')}
              </span>
            </div>
            {requisition.location && (
              <div>
                <span className="text-app-muted">Location: </span>
                <span className="font-semibold text-app-foreground">{requisition.location}</span>
              </div>
            )}
            <div>
              <span className="text-app-muted">Openings: </span>
              <span className="font-semibold text-app-foreground">{requisition.openingsCount}</span>
            </div>
          </div>

          {requisition.description && (
            <div className="mt-5 space-y-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-app-muted">
                Role Description
              </h2>
              <p className="whitespace-pre-line text-sm text-app-foreground/90 leading-relaxed">
                {requisition.description}
              </p>
            </div>
          )}

          {requisition.requirements && (
            <div className="mt-5 space-y-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-app-muted">
                Key Requirements &amp; Qualifications
              </h2>
              <p className="whitespace-pre-line text-sm text-app-foreground/90 leading-relaxed">
                {requisition.requirements}
              </p>
            </div>
          )}
        </section>

        {/* Application Form Card */}
        <section className="mt-8 rounded-2xl border border-app-border bg-app-surface p-6 md:p-8 shadow-sm">
          <h2 className="font-display text-xl font-bold text-app-foreground">
            Submit Your Application
          </h2>
          <p className="mt-1 text-xs text-app-muted">
            Please fill in your contact information and attach your latest resume or CV.
          </p>

          <form onSubmit={(e) => void handleSubmit(e)} className="mt-6 space-y-5">
            {error && <Notice error>{error}</Notice>}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-app-muted">
                <span className="mb-2 block">First Name *</span>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  disabled={submitting}
                  placeholder="e.g. Siddhartha"
                  className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
                />
              </label>

              <label className="block text-xs font-semibold text-app-muted">
                <span className="mb-2 block">Last Name *</span>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  disabled={submitting}
                  placeholder="e.g. Banerjee"
                  className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-app-muted">
                <span className="mb-2 block">Email Address *</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={submitting}
                  placeholder="name@university.edu"
                  className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
                />
              </label>

              <label className="block text-xs font-semibold text-app-muted">
                <span className="mb-2 block">Phone Number</span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={submitting}
                  placeholder="+91 98765 43210"
                  className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
                />
              </label>
            </div>

            {/* Resume Upload Box */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-app-muted">
                Attach Resume / CV * (PDF, DOCX, DOC, TXT · Max 10MB)
              </label>

              {file ? (
                <div className="flex items-center justify-between rounded-xl border border-app-border bg-app-background p-4 text-sm">
                  <div className="flex items-center gap-3 truncate">
                    <Icon name="notepad" className="size-6 text-app-muted shrink-0" />
                    <div className="truncate">
                      <p className="font-semibold text-app-foreground truncate">{file.name}</p>
                      <p className="text-xs text-app-muted">
                        {(file.size / 1024).toFixed(1)} KB · Ready to upload
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
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-app-border bg-app-background p-8 text-center transition hover:border-app-accent hover:bg-app-accent/5">
                  <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-app-accent/10 text-app-accent">
                    <Icon name="notepad" className="size-6" />
                  </div>
                  <p className="mt-2 text-sm font-semibold text-app-foreground">
                    Upload your resume document
                  </p>
                  <p className="mt-1 text-xs text-app-muted">
                    Drag and drop or click to browse (PDF or Word document up to 10MB)
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

            <div className="pt-2">
              <Button
                kind="primary"
                type="submit"
                disabled={submitting || !file}
                className="w-full py-3 text-base"
              >
                {submitting ? 'Submitting Application...' : 'Submit Application'}
              </Button>
            </div>
          </form>
        </section>
      </main>

      <footer className="mt-12 border-t border-app-border py-6 text-center text-xs text-app-muted">
        Powered by TapCRM Recruitment Intelligence Platform
      </footer>
    </div>
  );
}
