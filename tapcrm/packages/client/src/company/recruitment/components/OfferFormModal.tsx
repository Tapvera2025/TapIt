import { useEffect, useState } from 'react';
import { Button, Field, Modal, Notice, Select } from '../../../ui/components.js';
import {
  getCompanyDesignations,
  type CompanyDesignation,
} from '../../api/companyApi.js';
import { createOffer, updateCandidateStatus } from '../api/recruitmentApi.js';
import type {
  Candidate,
  JobOffer,
  JobRequisition,
  OfferStatus,
} from '../types/index.js';

export function OfferFormModal({
  candidates,
  requisitions,
  preselectedCandidate,
  onClose,
  onCreated,
}: {
  readonly candidates: Candidate[];
  readonly requisitions: JobRequisition[];
  readonly preselectedCandidate?: Candidate | undefined;
  readonly onClose: () => void;
  readonly onCreated: (offer: JobOffer) => void;
}): React.JSX.Element {
  const [candidateId, setCandidateId] = useState(
    preselectedCandidate?.id ?? (candidates.length > 0 && candidates[0] ? candidates[0].id : ''),
  );
  const [requisitionId, setRequisitionId] = useState(
    preselectedCandidate?.requisitionId ?? (requisitions.length > 0 && requisitions[0] ? requisitions[0].id : ''),
  );
  const [designations, setDesignations] = useState<CompanyDesignation[]>([]);
  const [designationId, setDesignationId] = useState('');

  const [offeredSalary, setOfferedSalary] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [offerDate, setOfferDate] = useState(() => new Date().toISOString().split('T')[0] ?? '2026-09-24');
  const [validUntil, setValidUntil] = useState(() => {
    const d = new Date(Date.now() + 7 * 86400000);
    return d.toISOString().split('T')[0] ?? '2026-10-01';
  });
  const [expectedJoiningDate, setExpectedJoiningDate] = useState(() => {
    const d = new Date(Date.now() + 30 * 86400000);
    return d.toISOString().split('T')[0] ?? '2026-10-24';
  });
  const [status, setStatus] = useState<OfferStatus>('sent');
  const [notes, setNotes] = useState('');

  const [loadingDesignations, setLoadingDesignations] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getCompanyDesignations()
      .then((desigs) => {
        if (!cancelled) {
          setDesignations(desigs.filter((d) => d.status === 'active'));
          if (desigs.length > 0 && desigs[0]) {
            setDesignationId(desigs[0].id);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load company designations');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDesignations(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function handleCandidateChange(id: string) {
    setCandidateId(id);
    const cand = candidates.find((c) => c.id === id);
    if (cand?.requisitionId) {
      setRequisitionId(cand.requisitionId);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!candidateId) {
      setError('Please select a candidate');
      return;
    }
    if (!requisitionId) {
      setError('Please select a job requisition');
      return;
    }
    if (!offeredSalary || isNaN(Number(offeredSalary)) || Number(offeredSalary) <= 0) {
      setError('Please provide a valid annual compensation amount');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const selectedDesignation = designations.find((d) => d.id === designationId);

      const offer = await createOffer({
        candidateId,
        requisitionId,
        designationId: designationId || undefined,
        offeredSalary: Number(offeredSalary),
        currency,
        offerDate,
        validUntil: validUntil || undefined,
        expectedJoiningDate: expectedJoiningDate || undefined,
        status,
        notes: notes.trim()
          ? `${notes.trim()}${selectedDesignation ? ` (Designation: ${selectedDesignation.name})` : ''}`
          : selectedDesignation
            ? `Designation: ${selectedDesignation.name}`
            : undefined,
      });

      // Update candidate status to 'selected' if not already
      const cand = candidates.find((c) => c.id === candidateId);
      if (cand && cand.status !== 'selected') {
        await updateCandidateStatus(cand.id, { status: 'selected' });
      }

      onCreated(offer);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to create job offer');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Create Job Offer" onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {error && <Notice error>{error}</Notice>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Selected Candidate"
            value={candidateId}
            onChange={handleCandidateChange}
            disabled={Boolean(preselectedCandidate) || submitting}
            options={candidates.map((c) => ({
              value: c.id,
              label: `${c.fullName ?? `${c.firstName} ${c.lastName}`} (${c.status})`,
            }))}
            required
          />

          <Select
            label="Job Requisition"
            value={requisitionId}
            onChange={setRequisitionId}
            disabled={submitting}
            options={requisitions.map((r) => ({
              value: r.id,
              label: `${r.requisitionNumber} - ${r.title}`,
            }))}
            required
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Offered Designation / Title"
            value={designationId}
            onChange={setDesignationId}
            disabled={loadingDesignations || submitting}
            options={designations.map((d) => ({
              value: d.id,
              label: d.name,
            }))}
          />

          <Select
            label="Offer Status"
            value={status}
            onChange={(val) => setStatus(val as OfferStatus)}
            disabled={submitting}
            options={[
              { value: 'sent', label: 'Sent to Candidate' },
              { value: 'draft', label: 'Draft (Pending Approval)' },
              { value: 'accepted', label: 'Accepted by Candidate' },
            ]}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Select
            label="Currency"
            value={currency}
            onChange={setCurrency}
            disabled={submitting}
            options={[
              { value: 'INR', label: 'INR (₹)' },
              { value: 'USD', label: 'USD ($)' },
              { value: 'EUR', label: 'EUR (€)' },
              { value: 'GBP', label: 'GBP (£)' },
            ]}
          />

          <div className="sm:col-span-2">
            <Field
              label="Offered Annual Compensation"
              type="number"
              value={offeredSalary}
              onChange={setOfferedSalary}
              placeholder="e.g. 1800000"
              required
              disabled={submitting}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Offer Issue Date"
            type="date"
            value={offerDate}
            onChange={setOfferDate}
            required
            disabled={submitting}
          />

          <Field
            label="Offer Expiry Date"
            type="date"
            value={validUntil}
            onChange={setValidUntil}
            disabled={submitting}
          />

          <Field
            label="Expected Joining Date"
            type="date"
            value={expectedJoiningDate}
            onChange={setExpectedJoiningDate}
            disabled={submitting}
          />
        </div>

        <label className="block text-xs font-semibold text-app-muted">
          <span className="mb-2 block">Offer Notes &amp; Special Terms</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            disabled={submitting}
            placeholder="Relocation allowance, probation terms, bonus clauses..."
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
          />
        </label>

        <div className="mt-6 flex justify-end gap-3 border-t border-app-border pt-4">
          <Button type="button" kind="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" kind="primary" disabled={submitting}>
            {submitting ? 'Generating Offer...' : 'Create & Issue Offer'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
