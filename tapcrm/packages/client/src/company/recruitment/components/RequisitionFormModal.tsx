import { useEffect, useState } from 'react';
import { Button, Field, Modal, Notice, Select } from '../../../ui/components.js';
import {
  getCompanyDepartments,
  type CompanyDepartment,
} from '../../api/companyApi.js';
import { createRequisition } from '../api/recruitmentApi.js';
import type { EmploymentType, JobRequisition, RequisitionStatus } from '../types/index.js';

export function RequisitionFormModal({
  onClose,
  onCreated,
}: {
  readonly onClose: () => void;
  readonly onCreated: (requisition: JobRequisition) => void;
}): React.JSX.Element {
  const [departments, setDepartments] = useState<CompanyDepartment[]>([]);
  const [title, setTitle] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [openingsCount, setOpeningsCount] = useState('1');
  const [employmentType, setEmploymentType] = useState<EmploymentType>('full_time');
  const [location, setLocation] = useState('');
  const [targetHireDate, setTargetHireDate] = useState('');
  const [description, setDescription] = useState('');
  const [requirements, setRequirements] = useState('');
  const [status, setStatus] = useState<RequisitionStatus>('open');

  const [loadingDepts, setLoadingDepts] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getCompanyDepartments()
      .then((depts) => {
        if (!cancelled) {
          setDepartments(depts.filter((d) => d.status === 'active'));
          if (depts.length > 0 && depts[0]) {
            setDepartmentId(depts[0].id);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load company departments');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDepts(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('Please provide a job title');
      return;
    }
    if (!departmentId) {
      setError('Please select a department');
      return;
    }

    const count = parseInt(openingsCount, 10);
    if (isNaN(count) || count < 1) {
      setError('Openings count must be at least 1');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const created = await createRequisition({
        title: title.trim(),
        departmentId,
        openingsCount: count,
        employmentType,
        location: location.trim() || undefined,
        targetHireDate: targetHireDate || undefined,
        description: description.trim() || undefined,
        requirements: requirements.trim() || undefined,
        status,
      });
      onCreated(created);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to create requisition');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Create Job Requisition" onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        {error && <Notice error>{error}</Notice>}

        <Field
          label="Job Title"
          value={title}
          onChange={setTitle}
          placeholder="e.g. Senior Backend Engineer"
          required
          disabled={submitting}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Department"
            value={departmentId}
            onChange={setDepartmentId}
            disabled={loadingDepts || submitting}
            options={departments.map((d) => ({
              value: d.id,
              label: d.name,
            }))}
            required
          />

          <Select
            label="Employment Type"
            value={employmentType}
            onChange={(val) => setEmploymentType(val as EmploymentType)}
            disabled={submitting}
            options={[
              { value: 'full_time', label: 'Full Time' },
              { value: 'part_time', label: 'Part Time' },
              { value: 'contract', label: 'Contract' },
              { value: 'internship', label: 'Internship' },
            ]}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Openings Count"
            type="number"
            value={openingsCount}
            onChange={setOpeningsCount}
            required
            disabled={submitting}
          />

          <Field
            label="Location"
            value={location}
            onChange={setLocation}
            placeholder="e.g. Bangalore / Remote"
            disabled={submitting}
          />

          <Field
            label="Target Hire Date"
            type="date"
            value={targetHireDate}
            onChange={setTargetHireDate}
            disabled={submitting}
          />
        </div>

        <Select
          label="Initial Status"
          value={status}
          onChange={(val) => setStatus(val as RequisitionStatus)}
          disabled={submitting}
          options={[
            { value: 'open', label: 'Open (Active)' },
            { value: 'draft', label: 'Draft' },
          ]}
        />

        <label className="block text-xs font-semibold text-app-muted">
          <span className="mb-2 block">Job Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            disabled={submitting}
            placeholder="Describe role responsibilities and scope..."
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
          />
        </label>

        <label className="block text-xs font-semibold text-app-muted">
          <span className="mb-2 block">Key Requirements</span>
          <textarea
            value={requirements}
            onChange={(e) => setRequirements(e.target.value)}
            rows={3}
            disabled={submitting}
            placeholder="Key technical qualifications, experience, skills..."
            className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent"
          />
        </label>

        <div className="mt-6 flex justify-end gap-3 border-t border-app-border pt-4">
          <Button type="button" kind="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" kind="primary" disabled={submitting}>
            {submitting ? 'Creating Requisition...' : 'Create Requisition'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
