import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../ui/Icon.js';
import {
  DOCUMENT_TYPE_LABELS,
  VERIFICATION_DOCUMENT_TYPES,
  type VerificationDetailsResponse,
  type VerificationDocumentSummary,
  type VerificationDocumentType,
  approveVerificationDocument,
  completeEmployeeVerification,
  getEmployeeVerification,
  getVerificationDocumentDownloadUrl,
  initializeEmployeeVerification,
  rejectEmployeeVerification,
  rejectVerificationDocument,
  uploadVerificationDocument,
} from '../api/verificationApi.js';

interface EmployeeVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  employeeId: string;
  employeeName: string;
  canManage: boolean;
  initialData?: VerificationDetailsResponse['verification'] | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getStatusBadge(status?: string | null): { text: string; className: string } {
  switch (status) {
    case 'VERIFIED':
    case 'APPROVED':
      return {
        text: status === 'APPROVED' ? 'Approved' : 'Verified',
        className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20',
      };
    case 'PARTIALLY_VERIFIED':
      return {
        text: 'Partially Verified',
        className: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20',
      };
    case 'PENDING':
      return {
        text: 'Pending Review',
        className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20',
      };
    case 'REJECTED':
      return {
        text: 'Rejected',
        className: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20',
      };
    default:
      return {
        text: 'Not Uploaded',
        className: 'bg-zinc-500/10 text-zinc-500 border border-zinc-500/20',
      };
  }
}

export function EmployeeVerificationModal({
  isOpen,
  onClose,
  employeeId,
  employeeName,
  canManage,
  initialData,
}: EmployeeVerificationModalProps): React.JSX.Element | null {
  const [data, setData] = useState<VerificationDetailsResponse['verification'] | null>(
    initialData ?? null,
  );
  const [loading, setLoading] = useState(initialData === undefined);
  const [error, setError] = useState('');
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  // Rejection modal/form state for a single document
  const [rejectingDocId, setRejectingDocId] = useState<string | null>(null);
  const [docRejectionReason, setDocRejectionReason] = useState('');

  // Overall verification rejection state
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [overallRejectionReason, setOverallRejectionReason] = useState('');

  // Expanded document histories
  const [expandedHistories, setExpandedHistories] = useState<Record<string, boolean>>({});

  // File upload input tracking
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Staged files for Marksheet multi-upload
  const [stagedMarksheets, setStagedMarksheets] = useState<File[]>([]);
  const [marksheetError, setMarksheetError] = useState<string>('');

  // Persistent exclusion tracking so discarded documents NEVER re-appear on server refetches
  const [discardedDocIds, setDiscardedDocIds] = useState<Set<string>>(() => new Set());
  const [discardedDocTypes, setDiscardedDocTypes] = useState<Set<VerificationDocumentType>>(() => new Set());

  function handleRemoveStagedMarksheet(
    fileKeyOrIndex: string | number,
    e?: React.MouseEvent,
  ): void {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setStagedMarksheets((prev) =>
      prev.filter((f, idx) => {
        const key = `${f.name}-${f.size}-${idx}`;
        if (typeof fileKeyOrIndex === 'string') {
          return key !== fileKeyOrIndex && `${f.name}-${f.size}` !== fileKeyOrIndex;
        }
        return idx !== fileKeyOrIndex;
      }),
    );
    setMarksheetError('');
  }

  function handleDiscardUploadedDocument(
    docId: string,
    docType?: VerificationDocumentType,
    e?: React.MouseEvent,
  ): void {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (docType && fileInputRefs.current[docType]) {
      fileInputRefs.current[docType].value = '';
    }
    if (docId) {
      setDiscardedDocIds((prev) => {
        const next = new Set(prev);
        next.add(docId);
        return next;
      });
    }
    if (docType && docType !== 'MARKSHEET') {
      setDiscardedDocTypes((prev) => {
        const next = new Set(prev);
        next.add(docType);
        return next;
      });
    }
    setData((prev) => {
      if (!prev) return prev;
      const nextDocuments = prev.documents.filter((d) => {
        if (d.id === docId) return false;
        if (docType && docType !== 'MARKSHEET' && d.documentType === docType) return false;
        return true;
      });
      return {
        ...prev,
        documents: nextDocuments,
      };
    });
  }

  function handleMarksheetFileSelection(files: File[]): void {
    if (files.length === 0) return;
    const MAX_SIZE = 10 * 1024 * 1024;
    const oversized = files.filter((f) => f.size > MAX_SIZE);
    if (oversized.length > 0) {
      setMarksheetError(`File(s) exceed 10MB limit: ${oversized.map((f) => f.name).join(', ')}`);
    } else {
      setMarksheetError('');
    }

    setStagedMarksheets((prev) => {
      const existingKeys = new Set(prev.map((f) => `${f.name}-${f.size}`));
      const uniqueNew = files.filter((f) => !existingKeys.has(`${f.name}-${f.size}`));
      return [...prev, ...uniqueNew];
    });
  }

  async function handleUploadStagedMarksheets(): Promise<void> {
    if (!canManage || stagedMarksheets.length === 0) return;
    setActionBusy('upload-MARKSHEET');
    setMarksheetError('');
    setError('');
    try {
      const preparedList = await Promise.all(
        stagedMarksheets.map(async (file) => {
          const base64Raw = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const res = reader.result as string;
              const commaIdx = res.indexOf(',');
              resolve(commaIdx !== -1 ? res.slice(commaIdx + 1) : res);
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
          });
          return {
            documentType: 'MARKSHEET' as const,
            fileName: file.name,
            mimeType: file.type || 'application/pdf',
            fileBase64: base64Raw,
          };
        }),
      );

      if (preparedList.length === 1) {
        await uploadVerificationDocument(employeeId, preparedList[0]!);
      } else {
        await uploadVerificationDocument(employeeId, { documents: preparedList });
      }

      setStagedMarksheets([]);
      setMarksheetError('');
      await loadVerification();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to upload marksheets';
      setMarksheetError(msg);
      setError(msg);
    } finally {
      setActionBusy(null);
    }
  }

  async function loadVerification(): Promise<void> {
    if (!employeeId) return;
    try {
      const res = await getEmployeeVerification(employeeId);
      if (res.verification) {
        const filteredDocs = res.verification.documents.filter((d) => {
          if (discardedDocIds.has(d.id)) return false;
          if (d.documentType !== 'MARKSHEET' && discardedDocTypes.has(d.documentType)) return false;
          return true;
        });
        setData({
          ...res.verification,
          documents: filteredDocs,
        });
      } else if (canManage) {
        // Auto-initialize if canManage and not yet initialized
        const initRes = await initializeEmployeeVerification(employeeId);
        if (initRes.verification) {
          const filteredDocs = initRes.verification.documents.filter((d) => {
            if (discardedDocIds.has(d.id)) return false;
            if (d.documentType !== 'MARKSHEET' && discardedDocTypes.has(d.documentType)) return false;
            return true;
          });
          setData({
            ...initRes.verification,
            documents: filteredDocs,
          });
        } else {
          setData(null);
        }
      } else {
        setData(null);
      }
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load verification details');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isOpen || !employeeId) return;
    setLoading(true);
    setError('');
    void loadVerification();
  }, [isOpen, employeeId]);

  if (!isOpen) return null;

  async function handleFileUpload(
    docType: VerificationDocumentType,
    files: File[],
  ): Promise<void> {
    if (!canManage || files.length === 0) return;
    const MAX_SIZE = 10 * 1024 * 1024;
    const oversized = files.filter((f) => f.size > MAX_SIZE);
    if (oversized.length > 0) {
      setError(`File exceeds maximum allowed size of 10MB: ${oversized.map((f) => f.name).join(', ')}`);
      return;
    }
    setActionBusy(`upload-${docType}`);
    setError('');
    if (docType && docType !== 'MARKSHEET') {
      setDiscardedDocTypes((prev) => {
        const next = new Set(prev);
        next.delete(docType);
        return next;
      });
    }
    try {
      const preparedList = await Promise.all(
        files.map(async (file) => {
          const base64Raw = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const res = reader.result as string;
              // Strip data URL prefix (e.g. data:application/pdf;base64,)
              const commaIdx = res.indexOf(',');
              resolve(commaIdx !== -1 ? res.slice(commaIdx + 1) : res);
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
          });
          return {
            documentType: docType,
            fileName: file.name,
            mimeType: file.type || 'application/pdf',
            fileBase64: base64Raw,
          };
        }),
      );

      if (preparedList.length === 1) {
        await uploadVerificationDocument(employeeId, preparedList[0]!);
      } else {
        await uploadVerificationDocument(employeeId, { documents: preparedList });
      }

      await loadVerification();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload document');
    } finally {
      setActionBusy(null);
    }
  }

  async function handleDownload(doc: VerificationDocumentSummary): Promise<void> {
    setActionBusy(`download-${doc.id}`);
    setError('');
    try {
      const res = await getVerificationDocumentDownloadUrl(employeeId, doc.id);
      if (res.downloadUrl) {
        if (res.downloadUrl.startsWith('data:')) {
          const a = document.createElement('a');
          a.href = res.downloadUrl;
          a.download = doc.fileName || `${doc.documentType}.pdf`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        } else {
          window.open(res.downloadUrl, '_blank', 'noopener,noreferrer');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate download link');
    } finally {
      setActionBusy(null);
    }
  }

  async function handleApprove(doc: VerificationDocumentSummary): Promise<void> {
    if (!canManage) return;
    setActionBusy(`approve-${doc.id}`);
    setError('');
    try {
      await approveVerificationDocument(employeeId, doc.id);
      await loadVerification();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve document');
    } finally {
      setActionBusy(null);
    }
  }

  async function handleRejectDocumentSubmit(): Promise<void> {
    if (!canManage || !rejectingDocId) return;
    if (!docRejectionReason.trim()) {
      setError('Please provide a rejection reason');
      return;
    }
    setActionBusy(`reject-${rejectingDocId}`);
    setError('');
    try {
      await rejectVerificationDocument(employeeId, rejectingDocId, docRejectionReason.trim());
      setRejectingDocId(null);
      setDocRejectionReason('');
      await loadVerification();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject document');
    } finally {
      setActionBusy(null);
    }
  }

  async function handleCompleteVerification(): Promise<void> {
    if (!canManage) return;
    setActionBusy('complete');
    setError('');
    try {
      await completeEmployeeVerification(employeeId);
      await loadVerification();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete verification');
    } finally {
      setActionBusy(null);
    }
  }

  async function handleRejectVerificationSubmit(): Promise<void> {
    if (!canManage) return;
    if (!overallRejectionReason.trim()) {
      setError('Please provide an overall rejection reason');
      return;
    }
    setActionBusy('reject-overall');
    setError('');
    try {
      await rejectEmployeeVerification(employeeId, overallRejectionReason.trim());
      setShowRejectModal(false);
      setOverallRejectionReason('');
      await loadVerification();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject verification');
    } finally {
      setActionBusy(null);
    }
  }

  const currentDocsByType = new Map<VerificationDocumentType, VerificationDocumentSummary[]>();
  if (data?.documents) {
    for (const d of data.documents) {
      if (discardedDocIds.has(d.id)) continue;
      if (d.documentType !== 'MARKSHEET' && discardedDocTypes.has(d.documentType)) continue;
      const list = currentDocsByType.get(d.documentType) ?? [];
      list.push(d);
      currentDocsByType.set(d.documentType, list);
    }
  }

  const historyByDocType = new Map<VerificationDocumentType, VerificationDocumentSummary[]>();
  if (data?.history) {
    for (const h of data.history) {
      const existing = historyByDocType.get(h.documentType) ?? [];
      existing.push(h);
      historyByDocType.set(h.documentType, existing);
    }
  }

  const calculatedProgress = (() => {
    let approvedCount = 0;
    let pendingCount = 0;
    let rejectedCount = 0;

    for (const reqType of VERIFICATION_DOCUMENT_TYPES) {
      const typeDocs = currentDocsByType.get(reqType);
      if (!typeDocs || typeDocs.length === 0) continue;
      if (typeDocs.some((d) => d.status === 'REJECTED')) {
        rejectedCount++;
      } else if (typeDocs.some((d) => d.status === 'PENDING')) {
        pendingCount++;
      } else if (typeDocs.every((d) => d.status === 'APPROVED')) {
        approvedCount++;
      }
    }

    const missingCount = VERIFICATION_DOCUMENT_TYPES.length - currentDocsByType.size;

    return {
      requiredCount: VERIFICATION_DOCUMENT_TYPES.length,
      approvedCount,
      pendingCount,
      rejectedCount,
      missingCount: Math.max(0, missingCount),
      allApproved: approvedCount === VERIFICATION_DOCUMENT_TYPES.length,
    };
  })();

  const progress = data ? calculatedProgress : {
    requiredCount: 10,
    approvedCount: 0,
    pendingCount: 0,
    rejectedCount: 0,
    missingCount: 10,
    allApproved: false,
  };

  const progressPercent = Math.round((progress.approvedCount / progress.requiredCount) * 100);
  const statusBadge = getStatusBadge(data?.status);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4"
    >
      <div className="fixed inset-0 bg-[#080e17a6] backdrop-blur-xs transition-opacity" onClick={onClose} />

      <dialog
        open
        className="ui-dialog z-50 my-auto flex max-h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-3.5rem)] w-[calc(100%-1.5rem)] sm:w-[calc(100%-2rem)] max-w-3xl flex-col rounded-2xl border border-app-border bg-app-surface p-5 sm:p-6 shadow-2xl text-app-foreground overflow-hidden"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-app-border pb-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="font-display text-lg font-bold">Employee Verification</h2>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${statusBadge.className}`}>
                {statusBadge.text}
              </span>
            </div>
            <p className="text-xs text-app-muted mt-0.5">
              Employee: <span className="font-semibold text-app-foreground">{employeeName}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="grid size-8 place-items-center rounded-lg text-xl text-app-muted hover:bg-app-background"
          >
            ×
          </button>
        </div>

        {/* Content area */}
        <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4 pt-4 pb-4">
          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-500 font-medium">
              {error}
            </div>
          )}

          {data?.status === 'REJECTED' && data.rejectionReason && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs">
              <p className="font-bold text-rose-500 flex items-center gap-1.5">
                <span>⚠</span> Verification Rejected
              </p>
              <p className="mt-1 text-app-foreground leading-relaxed">
                {data.rejectionReason}
              </p>
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-sm text-app-muted animate-pulse">
              Loading verification details...
            </div>
          ) : (
            <>
              {/* Progress & Overview Card */}
              <div className="rounded-xl border border-app-border bg-app-background/50 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-app-muted">
                      Verification Progress
                    </span>
                    <p className="text-sm font-semibold text-app-foreground mt-0.5">
                      {progress.approvedCount} of {progress.requiredCount} Mandated Types Approved ({progressPercent}%)
                    </p>
                  </div>
                  {canManage && data?.status !== 'VERIFIED' && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowRejectModal(true)}
                        disabled={actionBusy !== null}
                        className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500 hover:text-white transition-colors disabled:opacity-50"
                      >
                        Reject Verification
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCompleteVerification()}
                        disabled={!progress.allApproved || actionBusy !== null}
                        title={
                          !progress.allApproved
                            ? 'All 10 mandated document types must be approved before completing verification'
                            : 'Mark employee verification as complete'
                        }
                        className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                      >
                        {actionBusy === 'complete' ? 'Completing…' : 'Complete Verification'}
                      </button>
                    </div>
                  )}
                  {data?.status === 'VERIFIED' && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                      ✓ Verified on {data.verifiedAt ? new Date(data.verifiedAt).toLocaleDateString() : 'Record'}
                    </span>
                  )}
                </div>

                {/* Progress bar */}
                <div className="h-2 w-full overflow-hidden rounded-full bg-app-border">
                  <div
                    className={`h-full transition-all duration-300 ${
                      progress.allApproved ? 'bg-emerald-500' : 'bg-app-accent'
                    }`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>

                {/* Stats Pills */}
                <div className="flex flex-wrap gap-2 pt-1 text-[11px]">
                  <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-600 dark:text-emerald-400">
                    Approved: <strong>{progress.approvedCount}</strong>
                  </span>
                  <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-medium text-amber-600 dark:text-amber-400">
                    Pending Review: <strong>{progress.pendingCount}</strong>
                  </span>
                  <span className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 font-medium text-rose-600 dark:text-rose-400">
                    Rejected: <strong>{progress.rejectedCount}</strong>
                  </span>
                  <span className="rounded-md border border-app-border bg-app-surface px-2 py-0.5 font-medium text-app-muted">
                    Missing: <strong>{progress.missingCount}</strong>
                  </span>
                </div>
              </div>

              {/* Document List */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-app-muted">
                  Required Documents ({VERIFICATION_DOCUMENT_TYPES.length})
                </h3>

                <div className="grid gap-3">
                  {VERIFICATION_DOCUMENT_TYPES.map((docType, idx) => {
                    const docList = currentDocsByType.get(docType) ?? [];
                    const history = historyByDocType.get(docType) ?? [];
                    const meta = DOCUMENT_TYPE_LABELS[docType];
                    const isHistoryExpanded = expandedHistories[docType] ?? false;

                    // Multi-document array section for Degree / Marksheet
                    if (docType === 'MARKSHEET') {
                      let sectionStatus = 'Not Uploaded';
                      if (docList.length > 0) {
                        if (docList.some((d) => d.status === 'REJECTED')) {
                          sectionStatus = 'REJECTED';
                        } else if (docList.some((d) => d.status === 'PENDING')) {
                          sectionStatus = 'PENDING';
                        } else if (docList.every((d) => d.status === 'APPROVED')) {
                          sectionStatus = 'APPROVED';
                        }
                      }
                      const sectionBadge = getStatusBadge(sectionStatus);

                      return (
                        <div
                          key={docType}
                          className={`rounded-xl border p-4 text-xs transition-colors space-y-3 ${
                            sectionStatus === 'APPROVED'
                              ? 'border-emerald-500/30 bg-emerald-500/5'
                              : sectionStatus === 'REJECTED'
                              ? 'border-rose-500/30 bg-rose-500/5'
                              : sectionStatus === 'PENDING'
                              ? 'border-amber-500/30 bg-amber-500/5'
                              : 'border-app-border bg-app-background/40'
                          }`}
                        >
                          {/* Header row for MARKSHEET */}
                          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                            <div className="flex items-start gap-2.5 min-w-0">
                              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-app-border bg-app-surface text-[10px] font-bold text-app-muted">
                                {idx + 1}
                              </span>
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-semibold text-app-foreground text-sm">
                                    {meta.label}
                                  </span>
                                  <span
                                    className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${sectionBadge.className}`}
                                  >
                                    {sectionBadge.text}
                                  </span>
                                  <span className="rounded bg-app-border/40 px-2 py-0.5 text-[10px] text-app-muted font-medium">
                                    Multi-Document Support ({docList.length} uploaded)
                                  </span>
                                </div>
                                <p className="mt-1 text-[11px] text-app-muted leading-relaxed">
                                  {meta.description} — Select and upload multiple marksheets (e.g. 10th, 12th, semester marksheets, degrees).
                                </p>
                              </div>
                            </div>

                            {/* Multi-file selection button */}
                            {canManage && (
                              <div className="shrink-0 self-end sm:self-start">
                                <input
                                  type="file"
                                  multiple
                                  ref={(el) => {
                                    fileInputRefs.current[docType] = el;
                                  }}
                                  className="hidden"
                                  accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
                                  onChange={(e) => {
                                    const files = Array.from(e.target.files ?? []);
                                    handleMarksheetFileSelection(files);
                                    e.target.value = '';
                                  }}
                                />
                                <button
                                  type="button"
                                  disabled={actionBusy === `upload-${docType}`}
                                  onClick={() => fileInputRefs.current[docType]?.click()}
                                  className="rounded-lg border border-app-accent/60 bg-app-accent/15 px-3 py-1.5 text-xs font-bold text-app-accent hover:bg-app-accent hover:text-app-on-accent transition-colors disabled:opacity-50 flex items-center gap-1.5"
                                >
                                  <span>+</span>
                                  <span>
                                    {docList.length > 0 ? 'Upload More Marksheets' : 'Upload Marksheets'}
                                  </span>
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Staged / Selected Files Box (Select -> Preview -> Remove -> Upload / Retry) */}
                          {stagedMarksheets.length > 0 && (
                            <div className="rounded-xl border border-app-accent/40 bg-app-accent/5 p-3.5 space-y-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-app-accent font-bold text-xs">
                                    Selected Marksheet Files ({stagedMarksheets.length})
                                  </span>
                                  <span className="text-[11px] text-app-muted">Ready to upload</span>
                                </div>
                                <button
                                  type="button"
                                  disabled={actionBusy !== null}
                                  onClick={() => {
                                    setStagedMarksheets([]);
                                    setMarksheetError('');
                                  }}
                                  className="text-[11px] text-app-muted hover:text-rose-500 transition-colors"
                                >
                                  Clear selection
                                </button>
                              </div>

                              {/* List of staged files with individual remove button */}
                              <div className="divide-y divide-app-border/40 rounded-lg border border-app-border bg-app-surface/90 overflow-hidden shadow-xs">
                                {stagedMarksheets.map((file, fIdx) => (
                                  <div
                                    key={`${file.name}-${file.size}-${fIdx}`}
                                    className="flex items-center justify-between p-2.5 text-xs hover:bg-app-background/50 transition-colors"
                                  >
                                    <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-2">
                                      <span className="text-base shrink-0 leading-none">📄</span>
                                      <span className="font-medium text-app-foreground truncate" title={file.name}>
                                        {file.name}
                                      </span>
                                      <span className="text-[10px] text-app-muted font-mono shrink-0">
                                        ({formatBytes(file.size)})
                                      </span>
                                    </div>
                                    <button
                                      type="button"
                                      disabled={actionBusy !== null}
                                      onClick={(e) => handleRemoveStagedMarksheet(`${file.name}-${file.size}-${fIdx}`, e)}
                                      className="shrink-0 rounded p-1 text-app-muted hover:bg-rose-500/10 hover:text-rose-500 transition-colors cursor-pointer"
                                      title={`Remove ${file.name}`}
                                      aria-label={`Remove ${file.name}`}
                                    >
                                      <Icon name="close" className="size-3.5 pointer-events-none" />
                                    </button>
                                  </div>
                                ))}
                              </div>

                              {marksheetError && (
                                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-500 flex items-start justify-between gap-2">
                                  <span>{marksheetError}</span>
                                  <button
                                    type="button"
                                    onClick={() => setMarksheetError('')}
                                    className="text-[11px] hover:underline shrink-0"
                                  >
                                    Dismiss
                                  </button>
                                </div>
                              )}

                              <div className="flex flex-wrap items-center gap-2 pt-1">
                                <button
                                  type="button"
                                  disabled={actionBusy === 'upload-MARKSHEET'}
                                  onClick={() => void handleUploadStagedMarksheets()}
                                  className="rounded-lg bg-app-accent px-3 py-1.5 text-xs font-bold text-app-on-accent hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
                                >
                                  {actionBusy === 'upload-MARKSHEET' ? (
                                    <>
                                      <span className="animate-spin text-xs">⏳</span>
                                      <span>Uploading ({stagedMarksheets.length})…</span>
                                    </>
                                  ) : marksheetError ? (
                                    <span>Retry Upload</span>
                                  ) : (
                                    <span>
                                      Upload {stagedMarksheets.length} Marksheet{stagedMarksheets.length > 1 ? 's' : ''}
                                    </span>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  disabled={actionBusy !== null}
                                  onClick={() => fileInputRefs.current[docType]?.click()}
                                  className="rounded-lg border border-app-border px-3 py-1.5 text-xs font-medium text-app-foreground hover:bg-app-surface transition-colors disabled:opacity-50"
                                >
                                  + Add More Files
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Uploaded marksheets list */}
                          {docList.length === 0 && stagedMarksheets.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-app-border/80 bg-app-surface/40 p-4 text-center text-app-muted">
                              <p className="text-xs">No marksheets or degree certificates uploaded yet.</p>
                              {canManage && (
                                <p className="text-[11px] mt-1 text-app-accent">
                                  Click &ldquo;Upload Marksheets&rdquo; to select one or multiple files at once.
                                </p>
                              )}
                            </div>
                          ) : docList.length > 0 ? (
                            <div className="space-y-2 pt-1">
                              <span className="text-[11px] font-semibold text-app-muted">
                                Uploaded Documents ({docList.length}):
                              </span>
                              {docList.map((doc, mIdx) => {
                                const mBadge = getStatusBadge(doc.status);
                                return (
                                  <div
                                    key={doc.id}
                                    className="rounded-lg border border-app-border/80 bg-app-surface/70 p-3 space-y-2"
                                  >
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-start justify-between gap-2">
                                          <div className="flex flex-wrap items-center gap-2 min-w-0 flex-1">
                                            <span className="font-semibold text-app-foreground text-xs truncate max-w-[260px] sm:max-w-md" title={doc.fileName}>
                                              📄 #{mIdx + 1}: {doc.fileName}
                                            </span>
                                            <span
                                              className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${mBadge.className}`}
                                            >
                                              {mBadge.text}
                                            </span>
                                            <span className="text-[10px] text-app-muted font-mono">
                                              {formatBytes(doc.fileSize)}
                                            </span>
                                          </div>
                                          {canManage && (
                                            <button
                                              type="button"
                                              id={`discard-doc-marksheet-${doc.id}`}
                                              disabled={actionBusy !== null}
                                              onClick={(e) => handleDiscardUploadedDocument(doc.id, 'MARKSHEET', e)}
                                              className="shrink-0 rounded p-1 text-app-muted hover:bg-rose-500/10 hover:text-rose-500 transition-colors cursor-pointer"
                                              title={`Discard ${doc.fileName}`}
                                              aria-label={`Discard ${doc.fileName}`}
                                            >
                                              <Icon name="close" className="size-3.5 pointer-events-none" />
                                            </button>
                                          )}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2 text-[10px] text-app-muted mt-1">
                                          <span>
                                            Uploaded: {new Date(doc.uploadedAt).toLocaleDateString()}
                                          </span>
                                          {doc.reviewedAt && (
                                            <>
                                              <span>·</span>
                                              <span>
                                                Reviewed: {new Date(doc.reviewedAt).toLocaleDateString()}
                                              </span>
                                            </>
                                          )}
                                        </div>
                                        {doc.status === 'REJECTED' && doc.rejectionReason && (
                                          <p className="text-[11px] text-rose-500 font-medium mt-1">
                                            Rejection Note: {doc.rejectionReason}
                                          </p>
                                        )}
                                      </div>

                                      {/* Actions for this specific marksheet in the array */}
                                      <div className="shrink-0 flex flex-wrap items-center gap-1.5">
                                        <button
                                          type="button"
                                          disabled={actionBusy === `download-${doc.id}`}
                                          onClick={() => void handleDownload(doc)}
                                          className="rounded-md border border-app-border px-2.5 py-1 text-[11px] font-semibold text-app-foreground hover:border-app-accent hover:text-app-accent transition-colors disabled:opacity-50"
                                        >
                                          {actionBusy === `download-${doc.id}` ? 'Loading…' : 'View / Download'}
                                        </button>

                                        {canManage && doc.status === 'PENDING' && (
                                          <>
                                            <button
                                              type="button"
                                              disabled={actionBusy !== null}
                                              onClick={() => void handleApprove(doc)}
                                              className="rounded-md bg-emerald-600 hover:bg-emerald-700 px-2.5 py-1 text-[11px] font-bold text-white transition-colors disabled:opacity-50"
                                            >
                                              Approve
                                            </button>
                                            <button
                                              type="button"
                                              disabled={actionBusy !== null}
                                              onClick={() => {
                                                setRejectingDocId(doc.id);
                                                setDocRejectionReason('');
                                              }}
                                              className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500 hover:text-white transition-colors disabled:opacity-50"
                                            >
                                              Reject
                                            </button>
                                          </>
                                        )}
                                      </div>
                                    </div>

                                    {/* Inline Rejection Reason for this specific marksheet */}
                                    {rejectingDocId === doc.id && (
                                      <div className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-2.5 space-y-2">
                                        <label className="block text-[11px] font-bold text-rose-500">
                                          Reason for rejecting {doc.fileName}:
                                        </label>
                                        <input
                                          type="text"
                                          value={docRejectionReason}
                                          onChange={(e) => setDocRejectionReason(e.target.value)}
                                          placeholder="e.g. Unclear grades, missing official stamp, invalid document"
                                          className="w-full rounded-md border border-app-border bg-app-background px-3 py-1.5 text-xs text-app-foreground outline-none focus:border-rose-500"
                                          autoFocus
                                        />
                                        <div className="flex gap-2 justify-end pt-1">
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setRejectingDocId(null);
                                              setDocRejectionReason('');
                                            }}
                                            className="rounded px-2.5 py-1 text-[11px] text-app-muted hover:text-app-foreground"
                                          >
                                            Cancel
                                          </button>
                                          <button
                                            type="button"
                                            disabled={actionBusy !== null || !docRejectionReason.trim()}
                                            onClick={() => void handleRejectDocumentSubmit()}
                                            className="rounded bg-rose-600 px-3 py-1 text-[11px] font-bold text-white hover:bg-rose-700 disabled:opacity-50"
                                          >
                                            {actionBusy === `reject-${doc.id}` ? 'Rejecting…' : 'Confirm Reject'}
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}

                          {/* Document History section for MARKSHEET if any */}
                          {history.length > 0 && (
                            <div className="mt-2.5 pt-2 border-t border-app-border/40">
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedHistories((prev) => ({
                                    ...prev,
                                    [docType]: !isHistoryExpanded,
                                  }))
                                }
                                className="text-[10px] text-app-muted hover:text-app-foreground font-semibold flex items-center gap-1"
                              >
                                <span>{isHistoryExpanded ? '▼' : '▶'}</span>
                                <span>Past Versions ({history.length})</span>
                              </button>

                              {isHistoryExpanded && (
                                <div className="mt-2 space-y-1.5 pl-3 border-l-2 border-app-border/60">
                                  {history.map((h) => {
                                    const hBadge = getStatusBadge(h.status);
                                    return (
                                      <div
                                        key={h.id}
                                        className="flex items-center justify-between text-[11px] py-1 text-app-muted"
                                      >
                                        <div className="flex items-center gap-2 min-w-0">
                                          <span className="font-mono text-app-foreground truncate max-w-[200px]">
                                            {h.fileName} (v{h.version})
                                          </span>
                                          <span
                                            className={`rounded px-1.5 py-0.2 text-[9px] font-bold ${hBadge.className}`}
                                          >
                                            {hBadge.text}
                                          </span>
                                        </div>
                                        <button
                                          type="button"
                                          disabled={actionBusy === `download-${h.id}`}
                                          onClick={() => void handleDownload(h)}
                                          className="text-[10px] text-app-accent hover:underline disabled:opacity-50"
                                        >
                                          Download
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    }

                    // Single-document card for the other 9 types
                    const currentDoc = docList[0];
                    const docBadge = getStatusBadge(currentDoc?.status ?? null);

                    return (
                      <div
                        key={docType}
                        className={`rounded-xl border p-3.5 text-xs transition-colors ${
                          currentDoc?.status === 'APPROVED'
                            ? 'border-emerald-500/30 bg-emerald-500/5'
                            : currentDoc?.status === 'REJECTED'
                            ? 'border-rose-500/30 bg-rose-500/5'
                            : currentDoc?.status === 'PENDING'
                            ? 'border-amber-500/30 bg-amber-500/5'
                            : 'border-app-border bg-app-background/40'
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                          <div className="flex items-start gap-2.5 min-w-0">
                            <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-app-border bg-app-surface text-[10px] font-bold text-app-muted">
                              {idx + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-app-foreground">
                                  {meta.label}
                                </span>
                                <span
                                  className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${docBadge.className}`}
                                >
                                  {docBadge.text}
                                </span>
                                {currentDoc && currentDoc.version > 1 && (
                                  <span className="rounded bg-app-border/40 px-1.5 py-0.5 text-[10px] text-app-muted font-mono">
                                    v{currentDoc.version}
                                  </span>
                                )}
                              </div>
                              <p className="mt-0.5 text-[11px] text-app-muted leading-relaxed">
                                {meta.description}
                              </p>

                              {currentDoc && (
                                <div className="mt-2 rounded-lg border border-app-border/60 bg-app-surface/60 p-2 text-[11px] space-y-1">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                      <div className="font-mono text-app-foreground truncate" title={currentDoc.fileName}>
                                        📄 {currentDoc.fileName}
                                      </div>
                                      <div className="text-[10px] text-app-muted mt-0.5">
                                        {formatBytes(currentDoc.fileSize)}
                                      </div>
                                    </div>
                                    {canManage && (
                                      <button
                                        type="button"
                                        id={`discard-doc-${docType}`}
                                        disabled={actionBusy !== null}
                                        onClick={(e) => handleDiscardUploadedDocument(currentDoc.id, docType, e)}
                                        className="shrink-0 rounded p-1 text-app-muted hover:bg-rose-500/10 hover:text-rose-500 transition-colors cursor-pointer"
                                        title={`Discard ${currentDoc.fileName}`}
                                        aria-label={`Discard ${currentDoc.fileName}`}
                                      >
                                        <Icon name="close" className="size-3.5 pointer-events-none" />
                                      </button>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-app-muted">
                                    <span>
                                      Uploaded:{' '}
                                      {new Date(currentDoc.uploadedAt).toLocaleDateString()}
                                    </span>
                                    {currentDoc.reviewedAt && (
                                      <>
                                        <span>·</span>
                                        <span>
                                          Reviewed:{' '}
                                          {new Date(currentDoc.reviewedAt).toLocaleDateString()}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                  {currentDoc.status === 'REJECTED' && currentDoc.rejectionReason && (
                                    <p className="text-[11px] text-rose-500 font-medium pt-0.5">
                                      Rejection Note: {currentDoc.rejectionReason}
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Action Buttons for Document */}
                          <div className="shrink-0 flex flex-wrap items-center gap-2 self-end sm:self-start">
                            {/* Hidden file input */}
                            <input
                              type="file"
                              ref={(el) => {
                                fileInputRefs.current[docType] = el;
                              }}
                              className="hidden"
                              accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
                              onChange={(e) => {
                                const files = Array.from(e.target.files ?? []);
                                if (files.length > 0) {
                                  void handleFileUpload(docType, files);
                                }
                                e.target.value = '';
                              }}
                            />

                            {/* View / Download */}
                            {currentDoc && (
                              <button
                                type="button"
                                disabled={actionBusy === `download-${currentDoc.id}`}
                                onClick={() => void handleDownload(currentDoc)}
                                className="rounded-lg border border-app-border px-2.5 py-1 text-[11px] font-semibold text-app-foreground hover:border-app-accent hover:text-app-accent transition-colors disabled:opacity-50"
                              >
                                {actionBusy === `download-${currentDoc.id}` ? 'Loading…' : 'View / Download'}
                              </button>
                            )}

                            {/* Upload / Re-upload button */}
                            {canManage && (
                              <button
                                type="button"
                                disabled={actionBusy === `upload-${docType}`}
                                onClick={() => fileInputRefs.current[docType]?.click()}
                                className="rounded-lg border border-app-accent/50 bg-app-accent/10 px-2.5 py-1 text-[11px] font-semibold text-app-accent hover:bg-app-accent hover:text-app-on-accent transition-colors disabled:opacity-50"
                              >
                                {actionBusy === `upload-${docType}`
                                  ? 'Uploading…'
                                  : currentDoc
                                  ? 'Re-upload'
                                  : 'Upload'}
                              </button>
                            )}

                            {/* Review Buttons (Approve / Reject) */}
                            {canManage && currentDoc && currentDoc.status === 'PENDING' && (
                              <>
                                <button
                                  type="button"
                                  disabled={actionBusy !== null}
                                  onClick={() => void handleApprove(currentDoc)}
                                  className="rounded-lg bg-emerald-600/90 hover:bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white transition-colors disabled:opacity-50"
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  disabled={actionBusy !== null}
                                  onClick={() => {
                                    setRejectingDocId(currentDoc.id);
                                    setDocRejectionReason('');
                                  }}
                                  className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500 hover:text-white transition-colors disabled:opacity-50"
                                >
                                  Reject
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Inline Rejection Reason Prompt for Document */}
                        {rejectingDocId === currentDoc?.id && (
                          <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 space-y-2">
                            <label className="block text-[11px] font-bold text-rose-500">
                              Reason for rejecting this {meta.label}:
                            </label>
                            <input
                              type="text"
                              value={docRejectionReason}
                              onChange={(e) => setDocRejectionReason(e.target.value)}
                              placeholder="e.g. Blurred document, invalid expiration date, name mismatch"
                              className="w-full rounded-md border border-app-border bg-app-background px-3 py-1.5 text-xs text-app-foreground outline-none focus:border-rose-500"
                              autoFocus
                            />
                            <div className="flex gap-2 justify-end pt-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setRejectingDocId(null);
                                  setDocRejectionReason('');
                                }}
                                className="rounded px-2.5 py-1 text-[11px] text-app-muted hover:text-app-foreground"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                disabled={actionBusy !== null || !docRejectionReason.trim()}
                                onClick={() => void handleRejectDocumentSubmit()}
                                className="rounded bg-rose-600 px-3 py-1 text-[11px] font-bold text-white hover:bg-rose-700 disabled:opacity-50"
                              >
                                {actionBusy === `reject-${currentDoc.id}` ? 'Rejecting…' : 'Confirm Reject'}
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Document History section */}
                        {history.length > 0 && (
                          <div className="mt-2.5 pt-2 border-t border-app-border/40">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedHistories((prev) => ({
                                  ...prev,
                                  [docType]: !isHistoryExpanded,
                                }))
                              }
                              className="text-[10px] text-app-muted hover:text-app-foreground font-semibold flex items-center gap-1"
                            >
                              <span>{isHistoryExpanded ? '▼' : '▶'}</span>
                              <span>Past Versions ({history.length})</span>
                            </button>

                            {isHistoryExpanded && (
                              <div className="mt-2 space-y-1.5 pl-3 border-l-2 border-app-border/60">
                                {history.map((h) => {
                                  const hBadge = getStatusBadge(h.status);
                                  return (
                                    <div
                                      key={h.id}
                                      className="flex items-center justify-between gap-2 text-[10px] text-app-muted"
                                    >
                                      <div className="truncate">
                                        <span className="font-mono text-app-foreground">v{h.version}</span> · {h.fileName} (
                                        {formatBytes(h.fileSize)})
                                        {h.rejectionReason && (
                                          <span className="text-rose-500 ml-1">
                                            - {h.rejectionReason}
                                          </span>
                                        )}
                                      </div>
                                      <div className="shrink-0 flex items-center gap-2">
                                        <span className={`rounded px-1.5 py-0.2 text-[9px] ${hBadge.className}`}>
                                          {hBadge.text}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => void handleDownload(h)}
                                          className="text-app-accent hover:underline"
                                        >
                                          View
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-app-border pt-3 text-right">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-app-border px-4 py-1.5 text-xs font-semibold hover:border-app-accent"
          >
            Close
          </button>
        </div>
      </dialog>

      {/* Reject Verification Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-[#080e1780] backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-rose-500/40 bg-app-surface p-5 shadow-2xl text-app-foreground space-y-3">
            <h3 className="font-display text-base font-bold text-rose-500">
              Reject Employee Verification
            </h3>
            <p className="text-xs text-app-muted">
              Provide a clear reason for rejecting the verification of{' '}
              <strong className="text-app-foreground">{employeeName}</strong>.
            </p>
            <textarea
              rows={3}
              value={overallRejectionReason}
              onChange={(e) => setOverallRejectionReason(e.target.value)}
              placeholder="e.g. Multiple falsified or expired credentials provided."
              className="w-full rounded-lg border border-app-border bg-app-background p-2.5 text-xs text-app-foreground outline-none focus:border-rose-500"
              autoFocus
            />
            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowRejectModal(false);
                  setOverallRejectionReason('');
                }}
                className="rounded-lg border border-app-border px-3 py-1.5 text-xs font-semibold hover:border-app-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionBusy !== null || !overallRejectionReason.trim()}
                onClick={() => void handleRejectVerificationSubmit()}
                className="rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {actionBusy === 'reject-overall' ? 'Rejecting…' : 'Confirm Reject Verification'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
