import { useEffect, useState } from 'react';
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
  Page,
  Select,
} from '../components/OrganizationUi.js';
import { suggestNextCode } from '../../ui/code-suggest.js';
import type { OrganizationDepartment } from '../types/index.js';
import { IdentityApiError } from '../../identity/api/authApi.js';

const empty = { code: '', name: '', kind: 'support', status: 'active' };
type DepartmentFieldErrors = { code?: string; name?: string };
export function DepartmentsPage(): React.JSX.Element {
  const [items, setItems] = useState<OrganizationDepartment[]>([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<OrganizationDepartment | null>(null);
  const [lastCode, setLastCode] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState('');
  async function load() {
    setLoading(true);
    try {
      setItems(await organizationApi.departments());
      setError(null);
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }
  const [fieldErrors, setFieldErrors] = useState<DepartmentFieldErrors>({});
  const [formError, setFormError] = useState('');
  function setFormField(field: keyof typeof empty, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (field !== 'code' && field !== 'name') return current;
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }
  useEffect(() => {
    void load();
  }, []);
  function startCreate() {
    setEditing(null);
    setForm({ ...empty, code: suggestNextCode(items.map((i) => i.code), lastCode || undefined) });
    setOpen(true);
    setMessage('');
    setFieldErrors({});
    setFormError('');
  }
  function startEdit(item: OrganizationDepartment) {
    setEditing(item);
    setForm({ code: item.code, name: item.name, kind: item.kind, status: item.status });
    setOpen(true);
    setMessage('');
    setFieldErrors({});
    setFormError('');
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors: DepartmentFieldErrors = {};
    if (!form.name.trim()) nextErrors.name = 'Department name is required.';
    else if (form.name.trim().length > 160) nextErrors.name = 'Department name must be at most 160 characters.';
    if (!editing && !form.code.trim()) nextErrors.code = 'Department code is required.';
    else if (!editing && (form.code.trim().length > 64 || !/^[a-z0-9][a-z0-9-]*$/.test(form.code.trim()))) nextErrors.code = 'Code can use only lowercase letters, numbers, and hyphens.';
    setFieldErrors(nextErrors);
    setFormError('');
    if (Object.keys(nextErrors).length) return;
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await organizationApi.updateDepartment(editing.id, {
          name: form.name,
          status: form.status,
        });
      } else {
        await organizationApi.createDepartment(form);
        setLastCode(form.code);
      }
      setOpen(false);
      setMessage('Department saved.');
      await load();
    } catch (cause) {
      if (cause instanceof IdentityApiError && cause.code === 'ORG_DEPARTMENT_CODE_EXISTS') {
        setFieldErrors({ code: 'Department code already exists. Please use a different code.' });
        setFormError('');
      } else if (cause instanceof Error) {
        setFormError(cause.message);
      } else {
        setFormError('Unable to save department.');
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page
      eyebrow="Organization"
      title="Departments"
      description="Manage the department structure used by teams, positions, and visibility."
      action={<Button onClick={startCreate}>Add department</Button>}
    >
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
      {loading ? (
        <SkeletonTable columns={4} rows={5} />
      ) : items.length === 0 ? (
        <Empty>No departments are visible to this account.</Empty>
      ) : (
        <Card className="mt-6 overflow-hidden p-0">
          <div className="divide-y divide-app-border">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-4 p-5"
              >
                <div>
                  <p className="font-semibold">{item.name}</p>
                  <p className="mt-1 text-xs text-app-muted">
                    {item.code} · {item.kind}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-app-accent/15 px-3 py-1 text-xs font-bold text-app-accent">
                    {item.status}
                  </span>
                  <Button kind="secondary" onClick={() => startEdit(item)}>
                    Edit
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
      {open && (
        <Modal
          title={editing ? 'Edit department' : 'Create department'}
          onClose={() => setOpen(false)}
        >
          <form
            onSubmit={(event) => {
              void submit(event);
            }}
            className="grid gap-4"
          >
            <Field
              label="Code"
              value={form.code}
              onChange={(value) => setFormField('code', value.toLowerCase())}
              error={fieldErrors.code}
              disabled={Boolean(editing)}
              required
            />
            {!editing && <p className="-mt-3 text-xs text-app-muted">Auto-generated — edit as needed.</p>}
            <Field
              label="Name"
              value={form.name}
              onChange={(value) => setFormField('name', value)}
              error={fieldErrors.name}
              required
            />
            <Select
              label="Department type / kind"
              value={form.kind}
              onChange={(value) => setFormField('kind', value)}
              options={[
                { value: 'support', label: 'Support' },
                { value: 'delivery', label: 'Delivery' },
              ]}
              disabled={Boolean(editing)}
            />
            <Select
              label="Status"
              value={form.status}
              onChange={(value) => setFormField('status', value)}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
            />
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save department'}
            </Button>
            {formError && <ErrorMessage cause={new Error(formError)} />}
          </form>
        </Modal>
      )}
    </Page>
  );
}
