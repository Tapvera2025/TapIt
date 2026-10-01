import { useEffect, useState } from 'react';
import { getClients, type Client } from '../clients/api/clientsApi.js';
import { getCompanyEmployees, type CompanyEmployee } from '../company/api/companyApi.js';
import { Button, Field, Loading, Modal, Notice, Select } from '../ui/components.js';
import {
  PROJECT_SERVICES,
  PROJECT_SERVICE_LABELS,
  createProject,
  type Project,
  type ProjectPriority,
  type ProjectServiceKind,
  type ProjectWorkStatus,
} from './api/projectsApi.js';

const PRIORITIES: ProjectPriority[] = ['low', 'medium', 'high'];
const WORK_STATUSES: ProjectWorkStatus[] = ['new', 'ongoing', 'ended', 'expired'];
const WORK_STATUS_LABELS: Record<ProjectWorkStatus, string> = { new: 'New', ongoing: 'Ongoing', ended: 'Ended', expired: 'Expired' };

/** Step 1 of the wizard: the project's own details. Step 2 (discussion group) is a separate screen, by product decision. */
export function CreateProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (project: Project) => void }): React.JSX.Element {
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<Client[]>([]);
  const [employees, setEmployees] = useState<CompanyEmployee[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [clientId, setClientId] = useState('');
  const [name, setName] = useState('');
  const [services, setServices] = useState<Set<ProjectServiceKind>>(new Set());
  const [otherLabel, setOtherLabel] = useState('');
  const [assigneeIds, setAssigneeIds] = useState<Set<string>>(new Set());
  const [startDate, setStartDate] = useState('');
  const [expectedEndDate, setExpectedEndDate] = useState('');
  const [priority, setPriority] = useState<ProjectPriority>('medium');
  const [workStatus, setWorkStatus] = useState<ProjectWorkStatus>('new');
  const [budget, setBudget] = useState('');
  const [description, setDescription] = useState('');
  const [remarks, setRemarks] = useState('');

  useEffect(() => {
    void Promise.all([getClients({ status: 'active' }), getCompanyEmployees()])
      .then(([clientPage, employeeList]) => {
        setClients(clientPage.items);
        setEmployees(employeeList);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to load clients and employees.'))
      .finally(() => setLoading(false));
  }, []);

  const selectedClient = clients.find((c) => c.id === clientId) ?? null;

  const toggleService = (service: ProjectServiceKind): void => {
    setServices((current) => {
      const next = new Set(current);
      if (next.has(service)) next.delete(service);
      else next.add(service);
      return next;
    });
  };

  const toggleAssignee = (id: string): void => {
    setAssigneeIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
      const project = await createProject({
        clientId,
        name,
        services: [...services].map((service) => ({ service, otherLabel: service === 'other' ? otherLabel.trim() : null })),
        assigneeIds: [...assigneeIds],
        startDate,
        expectedEndDate: expectedEndDate || null,
        priority,
        workStatus,
        budget: budget.trim() || null,
        description: description.trim() || null,
        remarks: remarks.trim() || null,
      });
      onCreated(project);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create project.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="New project" onClose={onClose}>
      {loading ? (
        <Loading />
      ) : clients.length === 0 ? (
        <Notice error>Add a client before creating a project.</Notice>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="max-h-[75vh] space-y-4 overflow-y-auto pr-1">
          {error && <Notice error>{error}</Notice>}

          <Select label="Client" value={clientId} onChange={setClientId} required options={clients.map((c) => ({ value: c.id, label: `${c.clientName} — ${c.businessName}` }))} />
          {selectedClient && (
            <p className="text-xs text-app-muted">Business: {selectedClient.businessName} · Currency: {selectedClient.currency}</p>
          )}

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

          <div>
            <p className="mb-2 text-xs font-semibold text-app-muted">Employees assigned</p>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-app-border">
              {employees.map((person) => (
                <label key={person.id} className="flex items-center gap-2 border-b border-app-border px-3 py-2 text-sm last:border-b-0">
                  <input type="checkbox" checked={assigneeIds.has(person.id)} onChange={() => toggleAssignee(person.id)} />
                  {person.fullName}
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Start date" type="date" value={startDate} onChange={setStartDate} required />
            <Field label="Expected end date" type="date" value={expectedEndDate} onChange={setExpectedEndDate} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Select label="Priority" value={priority} onChange={(v) => setPriority(v as ProjectPriority)} required options={PRIORITIES.map((p) => ({ value: p, label: p[0]!.toUpperCase() + p.slice(1) }))} />
            <Select label="Work status" value={workStatus} onChange={(v) => setWorkStatus(v as ProjectWorkStatus)} required options={WORK_STATUSES.map((s) => ({ value: s, label: WORK_STATUS_LABELS[s] }))} />
          </div>

          <Field label={`Budget${selectedClient ? ` (${selectedClient.currency})` : ''}`} type="number" value={budget} onChange={setBudget} />

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
            <Button type="submit" disabled={saving || !clientId}>{saving ? 'Creating…' : 'Create project'}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
