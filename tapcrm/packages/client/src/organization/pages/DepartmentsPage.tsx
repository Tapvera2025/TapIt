import { useEffect, useState } from 'react';
import { organizationApi } from '../api/organizationApi.js';
import {
  Button,
  Card,
  Empty,
  ErrorMessage,
  Field,
  Loading,
  Modal,
  Notice,
  Page,
  Select,
} from '../components/OrganizationUi.js';
import type { OrganizationDepartment } from '../types/index.js';

const empty = { code: '', name: '', kind: 'support', status: 'active' };
export function DepartmentsPage(): React.JSX.Element {
  const [items, setItems] = useState<OrganizationDepartment[]>([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<OrganizationDepartment | null>(null);
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
  useEffect(() => {
    void load();
  }, []);
  function startCreate() {
    setEditing(null);
    setForm(empty);
    setOpen(true);
    setMessage('');
  }
  function startEdit(item: OrganizationDepartment) {
    setEditing(item);
    setForm({ code: item.code, name: item.name, kind: item.kind, status: item.status });
    setOpen(true);
    setMessage('');
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (editing)
        await organizationApi.updateDepartment(editing.id, {
          name: form.name,
          status: form.status,
        });
      else await organizationApi.createDepartment(form);
      setOpen(false);
      setMessage('Department saved.');
      await load();
    } catch (cause) {
      setError(cause);
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
        <Loading />
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
              onChange={(value) => setForm({ ...form, code: value })}
              required
            />
            <Field
              label="Name"
              value={form.name}
              onChange={(value) => setForm({ ...form, name: value })}
              required
            />
            <Select
              label="Department type / kind"
              value={form.kind}
              onChange={(value) => setForm({ ...form, kind: value })}
              options={[
                { value: 'support', label: 'Support' },
                { value: 'delivery', label: 'Delivery' },
              ]}
              disabled={Boolean(editing)}
            />
            <Select
              label="Status"
              value={form.status}
              onChange={(value) => setForm({ ...form, status: value })}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
            />
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save department'}
            </Button>
          </form>
        </Modal>
      )}
    </Page>
  );
}
