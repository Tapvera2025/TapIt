import { useEffect, useState } from 'react';
import { Button, Modal, Notice, SkeletonCard } from '../../ui/index.js';
import {
  getEmployeeProfileDetails,
  type EmployeeProfileDetails,
  type ProfileCompletionItem,
  type ProfileCompletionSummary,
} from '../api/myProfileApi.js';
import { DOCUMENT_TYPE_LABELS } from '../api/verificationApi.js';
import { ProfileCompletionBar } from '../profile/ProfileCompletionRing.js';

/**
 * HR's view of how far an employee has got with their own profile: what is
 * still missing and, for people who can manage employees, what they entered.
 * Documents are reviewed in the existing Verify window.
 */
export function EmployeeProfileStatusModal({
  employeeId,
  employeeName,
  summary,
  canManage,
  onClose,
  onOpenVerification,
}: {
  employeeId: string;
  employeeName: string;
  summary: ProfileCompletionSummary | undefined;
  canManage: boolean;
  onClose: () => void;
  onOpenVerification: () => void;
}): React.JSX.Element {
  const [details, setDetails] = useState<EmployeeProfileDetails | null>(null);
  const [loading, setLoading] = useState(canManage);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    getEmployeeProfileDetails(employeeId)
      .then((next) => {
        if (!cancelled) setDetails(next);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load the profile.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canManage, employeeId]);

  const completion = details?.completion ?? null;
  const percent = completion?.percent ?? summary?.percent ?? 0;
  const done = completion?.completedCount ?? summary?.completedCount ?? 0;
  const total = completion?.totalCount ?? summary?.totalCount ?? 0;
  const pending: ProfileCompletionItem[] =
    completion?.items.filter((item) => item.state !== 'done') ?? summary?.pending ?? [];

  return (
    <Modal
      title={`${employeeName} — profile`}
      onClose={onClose}
      dirty={false}
      size="lg"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button kind="secondary" onClick={onClose}>
            Close
          </Button>
          <Button onClick={onOpenVerification}>Review documents</Button>
        </div>
      }
    >
      <div className="space-y-5 text-sm">
        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs font-semibold">
            <span className="text-app-muted">
              {done} of {total} done
            </span>
            <span className="text-app-foreground">{percent}%</span>
          </div>
          <ProfileCompletionBar percent={percent} />
        </div>

        {pending.length === 0 ? (
          <Notice>The employee has submitted everything. Review their documents to finish verification.</Notice>
        ) : (
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-app-muted">Not submitted yet</p>
            <ul className="flex flex-wrap gap-1.5">
              {pending.map((item) => (
                <li
                  key={item.key}
                  title={item.note ?? undefined}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                    item.state === 'rejected'
                      ? 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                      : 'border-app-border bg-app-background text-app-muted'
                  }`}
                >
                  {item.label}
                  {item.state === 'rejected' ? ' · rejected, awaiting new copy' : ''}
                </li>
              ))}
            </ul>
          </div>
        )}

        {canManage && loading && <SkeletonCard className="h-48" />}
        {canManage && error && <Notice error>{error}</Notice>}
        {details && <SubmittedDetails details={details} />}
      </div>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-app-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-app-foreground">{value || '—'}</dd>
    </div>
  );
}

function SubmittedDetails({ details }: { details: EmployeeProfileDetails }): React.JSX.Element {
  const p = details.personal;
  const address = [p.addressLine1, p.addressLine2, p.city, p.state, p.postalCode].filter(Boolean).join(', ');
  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-app-muted">Personal</h3>
        <dl className="grid gap-3 sm:grid-cols-3">
          <Row label="Date of birth" value={p.dateOfBirth} />
          <Row label="Gender" value={p.gender} />
          <Row label="Phone" value={p.phone} />
          <div className="sm:col-span-3">
            <Row label="Address" value={address} />
          </div>
          <Row label="Emergency contact" value={p.emergencyContactName} />
          <Row label="Relationship" value={p.emergencyContactRelation} />
          <Row label="Emergency phone" value={p.emergencyContactPhone} />
        </dl>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-app-muted">Education</h3>
        {details.qualifications.length === 0 ? (
          <p className="text-app-muted">Nothing added yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {details.qualifications.map((q, index) => (
              <li key={q.id ?? index} className="rounded-lg bg-app-background px-3 py-2">
                <span className="font-semibold text-app-foreground">{q.degree}</span>
                {q.fieldOfStudy ? `, ${q.fieldOfStudy}` : ''} — {q.institution}
                {q.passingYear ? ` (${q.passingYear})` : ''}
                {q.grade ? ` · ${q.grade}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-app-muted">Work experience</h3>
        {details.noPriorExperience ? (
          <p className="text-app-muted">First job — no prior experience.</p>
        ) : details.experience.length === 0 ? (
          <p className="text-app-muted">Nothing added yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {details.experience.map((e, index) => (
              <li key={e.id ?? index} className="rounded-lg bg-app-background px-3 py-2">
                <span className="font-semibold text-app-foreground">{e.jobTitle}</span> at {e.companyName}
                <span className="text-app-muted">
                  {' '}
                  · {e.startDate} – {e.endDate ?? 'present'}
                </span>
                {e.description && <p className="mt-0.5 text-xs text-app-muted">{e.description}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-app-muted">Skills</h3>
        {details.skills.length === 0 ? (
          <p className="text-app-muted">Nothing added yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {details.skills.map((s) => (
              <li key={s.skillName} className="rounded-full border border-app-border px-2.5 py-1 text-xs">
                {s.skillName}
                {s.proficiency ? <span className="text-app-muted"> · {s.proficiency}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-app-muted">Documents</h3>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {details.requiredDocumentTypes.map((type) => {
            const docs = details.documents.filter((doc) => doc.documentType === type);
            const state = docs.some((doc) => doc.status === 'APPROVED')
              ? 'Approved'
              : docs.some((doc) => doc.status === 'PENDING')
                ? 'Waiting for review'
                : docs.some((doc) => doc.status === 'REJECTED')
                  ? 'Rejected'
                  : 'Not uploaded';
            return (
              <li key={type} className="flex items-center justify-between gap-2 rounded-lg bg-app-background px-3 py-2 text-xs">
                <span className="truncate text-app-foreground">{DOCUMENT_TYPE_LABELS[type].label}</span>
                <span className={state === 'Not uploaded' || state === 'Rejected' ? 'font-semibold text-rose-600 dark:text-rose-400' : 'text-app-muted'}>
                  {state}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
