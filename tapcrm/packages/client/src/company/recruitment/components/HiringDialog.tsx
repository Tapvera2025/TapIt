import { useEffect, useState } from 'react';
import { Button, Field, Modal, Notice, Select } from '../../../ui/components.js';
import { Icon } from '../../../ui/Icon.js';
import { getCompanyEmployees, type CompanyEmployee } from '../../api/companyApi.js';
import { hireCandidate } from '../api/recruitmentApi.js';
import type { Candidate, CandidateJoining, JobOffer } from '../types/index.js';

export function HiringDialog({
  candidate,
  offer,
  joining,
  onClose,
  onHired,
}: {
  readonly candidate: Candidate;
  readonly offer?: JobOffer | undefined;
  readonly joining?: CandidateJoining | undefined;
  readonly onClose: () => void;
  readonly onHired: (employeeId: string) => void;
}): React.JSX.Element {
  const [actualJoiningDate, setActualJoiningDate] = useState(() => {
    return (
      joining?.expectedJoiningDate ||
      offer?.expectedJoiningDate ||
      new Date().toISOString().split('T')[0] ||
      '2026-10-01'
    );
  });
  const [specialization, setSpecialization] = useState(candidate.requisitionTitle ?? '');
  const [initialPassword, setInitialPassword] = useState('Welcome@TapCRM2026!');
  const [managerId, setManagerId] = useState('');

  const [employees, setEmployees] = useState<CompanyEmployee[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hiredResult, setHiredResult] = useState<{ employeeId: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getCompanyEmployees()
      .then((emps) => {
        if (!cancelled) setEmployees(emps);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleConfirmHire(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await hireCandidate(candidate.id, {
        actualJoiningDate: actualJoiningDate.trim() || undefined,
        specialization: specialization.trim() || undefined,
        password: initialPassword.trim() || undefined,
        reportsTo: managerId.trim() || undefined,
      });

      setHiredResult({ employeeId: res.employeeId });
      onHired(res.employeeId);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Failed to hire candidate. Verify that candidate is selected, offer is accepted, and joining is confirmed.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title="Hire Candidate as Employee"
      onClose={onClose}
    >
      {hiredResult ? (
        <div className="space-y-4 py-3">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-600">
              <Icon name="check" className="size-6" />
            </div>
            <h3 className="mt-2 text-base font-bold text-emerald-800 dark:text-emerald-200">
              Candidate Hired Successfully!
            </h3>
            <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
              Employee account has been provisioned and employee ID assigned.
            </p>
            <p className="mt-2 text-xs font-semibold text-app-foreground">
              An onboarding welcome email with login setup instructions has been sent to{' '}
              <span className="font-mono">{candidate.email}</span>.
            </p>
          </div>

          <div className="flex justify-end pt-3">
            <Button kind="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={(e) => void handleConfirmHire(e)} className="space-y-4">
          {error && <Notice error>{error}</Notice>}

          <div className="rounded-xl border border-app-border bg-app-surface p-4 text-xs space-y-2">
            <div className="flex justify-between">
              <span className="text-app-muted">Candidate:</span>
              <span className="font-semibold text-app-foreground">
                {candidate.fullName ?? `${candidate.firstName} ${candidate.lastName}`}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-app-muted">Email:</span>
              <span className="font-mono text-app-foreground">{candidate.email}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-app-muted">Target Position:</span>
              <span className="font-medium text-app-foreground">
                {candidate.requisitionTitle ?? 'Role'}
              </span>
            </div>
            {offer?.offeredSalary && (
              <div className="flex justify-between">
                <span className="text-app-muted">Offered Compensation:</span>
                <span className="font-semibold text-app-accent">
                  {offer.currency} {Number(offer.offeredSalary).toLocaleString()}
                </span>
              </div>
            )}
          </div>

          <p className="text-xs text-app-muted">
            Are you sure you want to officially transition this candidate into an active Employee?
            This will provision their company user credentials, finalize joining, and trigger the
            welcome onboarding email.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Actual Joining Date *"
              type="date"
              value={actualJoiningDate}
              onChange={setActualJoiningDate}
              required
              disabled={submitting}
            />

            <Field
              label="Specialization / Title"
              value={specialization}
              onChange={setSpecialization}
              disabled={submitting}
              placeholder="e.g. Backend Lead"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Reporting Manager"
              value={managerId}
              onChange={setManagerId}
              disabled={submitting}
              options={employees.map((emp) => ({
                value: emp.id,
                label: `${emp.fullName} (${emp.positionName ?? 'Manager'})`,
              }))}
            />

            <Field
              label="Temporary Password *"
              value={initialPassword}
              onChange={setInitialPassword}
              required
              disabled={submitting}
              placeholder="Initial login password"
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-app-border pt-4">
            <Button kind="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button kind="primary" type="submit" disabled={submitting}>
              {submitting ? 'Provisioning Employee...' : 'Confirm Hire & Send Onboarding Email'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
