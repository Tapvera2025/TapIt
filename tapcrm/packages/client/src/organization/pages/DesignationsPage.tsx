import { useEffect, useState } from 'react';
import { Icon } from '../../ui/Icon.js';
import { WorkspacePageContainer } from '../../ui/components.js';
import { organizationApi } from '../api/organizationApi.js';
import {
  Button,
  Card,
  Empty,
  ErrorMessage,
  Field,
  SkeletonTable,
  Modal,
  Notice,
  Select,
} from '../components/OrganizationUi.js';
import type {
  OrganizationDepartment,
  OrganizationDesignation,
} from '../types/index.js';

export function DesignationsPage(): React.JSX.Element {
  const [items, setItems] = useState<OrganizationDesignation[]>([]);
  const [departments, setDepartments] = useState<OrganizationDepartment[]>([]);
  const [editing, setEditing] = useState<OrganizationDesignation | null>(null);
  const [departmentId, setDepartmentId] = useState('');
  const [name, setName] = useState('');
  const [specializations, setSpecializations] = useState('');
  const [status, setStatus] = useState('active');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState('');
  const departmentLookup = new Map(departments.map((item) => [item.id, item] as const));
  const departmentOptions = departments
    .filter((item) => item.status === 'active')
    .map((item) => ({ value: item.id, label: item.name }));
  async function load() {
    setLoading(true);
    try {
      const [designations, departmentList] = await Promise.all([
        organizationApi.designations(),
        organizationApi.departments(),
      ]);
      setItems(designations);
      setDepartments(departmentList);
      setError(null);
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  function create() {
    setEditing(null);
    setDepartmentId('');
    setName('');
    setSpecializations('');
    setStatus('active');
    setOpen(true);
  }
  function edit(item: OrganizationDesignation) {
    setEditing(item);
    setDepartmentId(item.departmentId);
    setName(item.name);
    setSpecializations(item.specializations.join(', '));
    setStatus(item.status);
    setOpen(true);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!departmentId) {
      setError(new Error('Please choose a department for this designation.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const values = specializations
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      if (editing)
        await organizationApi.updateDesignation(editing.id, {
          departmentId,
          name,
          specializations: values,
          status,
        });
      else
        await organizationApi.createDesignation({
          departmentId,
          name,
          specializations: values,
        });
      setOpen(false);
      setMessage('Designation saved.');
      await load();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }
  return (
    <WorkspacePageContainer>
      {message && (
        <div className="mt-5">
          <Notice>{message}</Notice>
        </div>
      )}
      {Boolean(error) && (
        <div className="mt-5">
          <ErrorMessage cause={error} />
        </div>
      )}
      <Card className="mt-5 overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-b-[color:var(--app-border)] px-5 py-5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-app-accent/10 text-app-accent">
              <Icon name="building" className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-app-muted">Organization</p>
              <h1 className="mt-0.5 text-base font-bold text-app-foreground">Designation directory</h1>
              <p className="mt-0.5 text-xs text-app-muted">Manage job titles and specializations. These values do not grant authorization.</p>
            </div>
          </div>
          <Button onClick={create}><span aria-hidden="true">+</span> Add designation</Button>
        </div>
        {loading ? (
          <div className="p-5"><SkeletonTable columns={4} rows={5} /></div>
        ) : items.length === 0 ? (
          <div className="p-8"><Empty>No designations are visible to this account.</Empty></div>
        ) : (
          <div className="divide-y divide-app-border">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-4 p-5"
              >
                <div>
                  <p className="font-semibold">{item.name}</p>
                  <p className="mt-1 text-xs text-app-muted">
                    {departmentLookup.get(item.departmentId)?.name ?? 'Unassigned department'}
                  </p>
                  <p className="mt-1 text-xs text-app-muted">
                    {item.specializations.length
                      ? item.specializations.join(' · ')
                      : 'No specializations'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-app-muted">{item.status}</span>
                  <Button kind="secondary" onClick={() => edit(item)}>
                    Edit
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      {open && (
        <Modal
          title={editing ? 'Edit designation' : 'Create designation'}
          onClose={() => setOpen(false)}
        >
          <form
            onSubmit={(event) => {
              void submit(event);
            }}
            className="grid gap-4"
          >
            <Select
              label="Department"
              value={departmentId}
              onChange={setDepartmentId}
              options={departmentOptions}
            />
            <Field label="Designation name" value={name} onChange={setName} required />
            <Field
              label="Specializations"
              value={specializations}
              onChange={setSpecializations}
              placeholder="Comma-separated values"
            />
            {editing && (
              <Select
                label="Status"
                value={status}
                onChange={setStatus}
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'inactive', label: 'Inactive' },
                ]}
              />
            )}
            <p className="text-xs text-app-muted">
              Authorization continues to come from Position → Position Policy → AuthZ.
            </p>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save designation'}
            </Button>
          </form>
        </Modal>
      )}
    </WorkspacePageContainer>
  );
}
