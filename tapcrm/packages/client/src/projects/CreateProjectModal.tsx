import { useEffect, useId, useState } from 'react';
import { getClient, getClients, type Client } from '../clients/api/clientsApi.js';
import { getChatColleagues } from '../chat/index.js';
import { Button, Field, Loading, Modal, Notice, Select } from '../ui/index.js';
import {
  PROJECT_SERVICES,
  PROJECT_SERVICE_LABELS,
  createProject,
  type Project,
  type ProjectPriority,
  type ProjectServiceKind,
  type ProjectWorkStatus,
} from './api/projectsApi.js';
import { ProjectAmountFields } from './ProjectAmountFields.js';
import { projectAmountProblem } from './project-amounts.js';

const PRIORITIES: ProjectPriority[] = ['low', 'medium', 'high'];
const WORK_STATUSES: ProjectWorkStatus[] = ['new', 'ongoing', 'ended', 'expired'];
const WORK_STATUS_LABELS: Record<ProjectWorkStatus, string> = { new: 'New', ongoing: 'Ongoing', ended: 'Ended', expired: 'Expired' };

/** Active clients for the picker. A preselected client (from the "Client added" toast) is fetched directly if it isn't on the first page, so the prefill never silently fails. */
async function loadActiveClients(preselectedId: string | undefined): Promise<Client[]> {
  const page = await getClients({ status: 'active' });
  if (!preselectedId || page.items.some((client) => client.id === preselectedId)) return page.items;
  const preselected = await getClient(preselectedId).catch(() => null);
  return preselected?.status === 'active' ? [preselected, ...page.items] : page.items;
}

/**
 * Step 1 of the wizard: the project's own details. Step 2 (discussion group) is a separate screen, by product decision.
 * `initialClientId` preselects the client (used by the "Client added" toast).
 */
export function CreateProjectModal({ onClose, onCreated, initialClientId }: { onClose: () => void; onCreated: (project: Project) => void; initialClientId?: string }): React.JSX.Element {
  const formId = useId();
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<Client[]>([]);
  const [employees, setEmployees] = useState<{ id: string; fullName: string }[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [clientId, setClientId] = useState(initialClientId ?? '');
  const [name, setName] = useState('');
  const [services, setServices] = useState<Set<ProjectServiceKind>>(new Set());
  const [otherLabel, setOtherLabel] = useState('');
  const [assigneeIds, setAssigneeIds] = useState<Set<string>>(new Set());
  const [startDate, setStartDate] = useState('');
  const [expectedEndDate, setExpectedEndDate] = useState('');
  const [priority, setPriority] = useState<ProjectPriority>('medium');
  const [workStatus, setWorkStatus] = useState<ProjectWorkStatus>('new');
  const [projectValue, setProjectValue] = useState('');
  const [upfrontAmount, setUpfrontAmount] = useState('');
  const [description, setDescription] = useState('');
  const [remarks, setRemarks] = useState('');

  // Deliberately []: initialClientId is fixed for the modal's lifetime (ProjectsPage keys the modal by it).
  useEffect(() => {
    void Promise.all([loadActiveClients(initialClientId), getChatColleagues()])
      .then(([clientList, employeeList]) => {
        setClients(clientList);
        setEmployees(employeeList);
        if (initialClientId && !clientList.some((c) => c.id === initialClientId)) setClientId('');
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to load clients and employees.'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const amountProblem = projectAmountProblem(projectValue, upfrontAmount);
    if (amountProblem) {
      setError(amountProblem);
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
        projectValue: projectValue.trim() || null,
        upfrontAmount: upfrontAmount.trim() || null,
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

  const showForm = !loading && clients.length > 0;

  return (
    <Modal
      title="New project"
      onClose={onClose}
      {...(showForm
        ? {
            footer: (
              <div className="flex justify-end gap-2">
                <Button kind="secondary" type="button" onClick={onClose}>Cancel</Button>
                <Button type="submit" form={formId} disabled={saving || !clientId}>{saving ? 'Creating…' : 'Create project'}</Button>
              </div>
            ),
          }
        : {})}
    >
      {loading ? (
        <Loading />
      ) : clients.length === 0 ? (
        <Notice error>Add a client before creating a project.</Notice>
      ) : (
        <form id={formId} onSubmit={(event) => void submit(event)} className="space-y-5">
          {error && <Notice error>{error}</Notice>}

          <Select label="Client" value={clientId} onChange={setClientId} required options={clients.map((c) => ({ value: c.id, label: `${c.clientName} — ${c.businessName}` }))} />
          {selectedClient && (
            <p className="text-xs text-app-muted">Business: {selectedClient.businessName} · Currency: {selectedClient.currency}</p>
          )}

          <Field label="Project name" value={name} onChange={setName} required />

          <div>
            <SectionLabel>Services</SectionLabel>
            <div className="flex flex-wrap gap-2">
              {PROJECT_SERVICES.map((service) => (
                <label
                  key={service}
                  className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition ${services.has(service) ? 'border-app-accent bg-app-accent/10 text-app-accent' : 'border-app-border hover:border-app-accent'}`}
                >
                  <input type="checkbox" className="size-4 accent-[var(--app-accent)]" checked={services.has(service)} onChange={() => toggleService(service)} />
                  {PROJECT_SERVICE_LABELS[service]}
                </label>
              ))}
            </div>
            {services.has('other') && (
              <div className="mt-3">
                <Field label="Name the other service" value={otherLabel} onChange={setOtherLabel} required />
              </div>
            )}
          </div>

          <div>
            <SectionLabel aside={assigneeIds.size > 0 ? <span className="text-xs text-app-muted">{assigneeIds.size} selected</span> : undefined}>Employees assigned</SectionLabel>
            {employees.length === 0 ? (
              <p className="rounded-xl border border-dashed border-app-border bg-app-background px-4 py-3 text-sm text-app-muted">No other active employees to assign yet. You can add people later from the project's page.</p>
            ) : (
              <div className="max-h-48 divide-y divide-app-border overflow-y-auto overscroll-contain rounded-xl border border-app-border">
                {employees.map((person) => (
                  <label key={person.id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm transition hover:bg-app-surface-raised">
                    <input type="checkbox" className="size-4 accent-[var(--app-accent)]" checked={assigneeIds.has(person.id)} onChange={() => toggleAssignee(person.id)} />
                    {person.fullName}
                  </label>
                ))}
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

          <ProjectAmountFields
            currency={selectedClient?.currency ?? null}
            projectValue={projectValue}
            upfrontAmount={upfrontAmount}
            onProjectValueChange={setProjectValue}
            onUpfrontAmountChange={setUpfrontAmount}
          />

          <label className="block text-xs font-semibold text-app-muted">
            <span className="mb-2 block">Description</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="w-full resize-y rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm outline-none focus:border-app-accent" />
          </label>
          <label className="block text-xs font-semibold text-app-muted">
            <span className="mb-2 block">Remarks</span>
            <textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} rows={2} className="w-full resize-y rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm outline-none focus:border-app-accent" />
          </label>
        </form>
      )}
    </Modal>
  );
}

function SectionLabel({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <p className="text-xs font-semibold text-app-muted">{children}</p>
      {aside}
    </div>
  );
}
