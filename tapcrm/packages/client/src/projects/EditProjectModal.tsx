import { useState } from 'react';
import { Button, Field, Modal, Notice, Select } from '../ui/components.js';
import {
  PROJECT_SERVICES,
  PROJECT_SERVICE_LABELS,
  updateProject,
  type Project,
  type ProjectPriority,
  type ProjectServiceKind,
  type ProjectWorkStatus,
} from './api/projectsApi.js';

const PRIORITIES: ProjectPriority[] = ['low', 'medium', 'high'];
const WORK_STATUSES: ProjectWorkStatus[] = ['new', 'ongoing', 'ended', 'expired'];
const WORK_STATUS_LABELS: Record<ProjectWorkStatus, string> = { new: 'New', ongoing: 'Ongoing', ended: 'Ended', expired: 'Expired' };

/** Editable fields only: the client and assignees have their own, narrower flows (the client is fixed at creation; the team is managed from the Assigned employees panel). */
export function EditProjectModal({ project, onClose, onSaved }: { project: Project; onClose: () => void; onSaved: (project: Project) => void }): React.JSX.Element {
  const [name, setName] = useState(project.name);
  const [services, setServices] = useState<Set<ProjectServiceKind>>(new Set(project.services.map((s) => s.service)));
  const [otherLabel, setOtherLabel] = useState(project.services.find((s) => s.service === 'other')?.otherLabel ?? '');
  const [startDate, setStartDate] = useState(project.startDate.slice(0, 10));
  const [expectedEndDate, setExpectedEndDate] = useState(project.expectedEndDate?.slice(0, 10) ?? '');
  const [priority, setPriority] = useState<ProjectPriority>(project.priority);
  const [workStatus, setWorkStatus] = useState<ProjectWorkStatus>(project.workStatus);
  const [budget, setBudget] = useState(project.budget ?? '');
  const [description, setDescription] = useState(project.description ?? '');
  const [remarks, setRemarks] = useState(project.remarks ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggleService = (service: ProjectServiceKind): void => {
    setServices((current) => {
      const next = new Set(current);
      if (next.has(service)) next.delete(service);
      else next.add(service);
      return next;
    });
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (services.size === 0) {
      setError('Select at least one service');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const updated = await updateProject(project.id, {
        name,
        services: [...services].map((service) => ({ service, otherLabel: service === 'other' ? otherLabel.trim() : null })),
        startDate,
        expectedEndDate: expectedEndDate || null,
        priority,
        workStatus,
        budget: budget.trim() || null,
        description: description.trim() || null,
        remarks: remarks.trim() || null,
      });
      onSaved(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update project.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Edit ${project.name}`} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="max-h-[75vh] space-y-4 overflow-y-auto pr-1">
        {error && <Notice error>{error}</Notice>}

        <Field label="Project name" value={name} onChange={setName} required />

        <div>
          <p className="mb-2 text-xs font-semibold text-app-muted">Services</p>
          <div className="flex flex-wrap gap-3">
            {PROJECT_SERVICES.map((service) => (
              <label key={service} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={services.has(service)} onChange={() => toggleService(service)} />
                {PROJECT_SERVICE_LABELS[service]}
              </label>
            ))}
          </div>
          {services.has('other') && (
            <div className="mt-2">
              <Field label="Name the other service" value={otherLabel} onChange={setOtherLabel} required />
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Start date" type="date" value={startDate} onChange={setStartDate} required />
          <Field label="Expected end date" type="date" value={expectedEndDate} onChange={setExpectedEndDate} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Select label="Priority" value={priority} onChange={(v) => setPriority(v as ProjectPriority)} required options={PRIORITIES.map((p) => ({ value: p, label: p[0]!.toUpperCase() + p.slice(1) }))} />
          <Select label="Work status" value={workStatus} onChange={(v) => setWorkStatus(v as ProjectWorkStatus)} required options={WORK_STATUSES.map((s) => ({ value: s, label: WORK_STATUS_LABELS[s] }))} />
        </div>

        <Field label={`Budget (${project.currency})`} type="number" value={budget} onChange={setBudget} />

        <label className="text-xs font-semibold text-app-muted">
          <span className="mb-2 block">Description</span>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm outline-none focus:border-app-accent" />
        </label>
        <label className="text-xs font-semibold text-app-muted">
          <span className="mb-2 block">Remarks</span>
          <textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} rows={2} className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm outline-none focus:border-app-accent" />
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <Button kind="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving || !name.trim()}>{saving ? 'Saving…' : 'Save changes'}</Button>
        </div>
      </form>
    </Modal>
  );
}
