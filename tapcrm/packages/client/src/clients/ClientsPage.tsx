import { useEffect, useState } from 'react';
import { Button, Card, Field, Loading, Modal, Notice, Page, Select } from '../ui/components.js';
import {
  CLIENT_REGIONS,
  CLIENT_REGION_LABELS,
  createClient,
  generateStrongPassword,
  getClients,
  revokeClientCredentials,
  setClientCredentials,
  type Client,
  type ClientRegion,
} from './api/clientsApi.js';

const blankForm = { clientName: '', businessName: '', email: '', password: '', region: 'in' as ClientRegion };

/**
 * Clients — Phase 4 of the build. The Super Admin adds a client here before
 * a project can reference one (Projects' "existing client" picker reads
 * this same list).
 */
export function ClientsPage({ onOpenClient }: { onOpenClient?: (clientId: string) => void }): React.JSX.Element {
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [credentialsFor, setCredentialsFor] = useState<Client | null>(null);
  const [newPassword, setNewPassword] = useState('');

  async function load(): Promise<void> {
    setLoading(true);
    try {
      const page = await getClients({ search });
      setClients(page.items);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load clients.');
    } finally {
      setLoading(false);
    }
  }

  // Deliberately []: `load` reads `search` at call time (the button re-reads current state); this only runs once on mount.
  useEffect(() => { void load(); }, []);

  const submitCreate = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      await createClient(form);
      setShowCreate(false);
      setForm(blankForm);
      await load();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Unable to create client.');
    } finally {
      setSaving(false);
    }
  };

  const submitCredentials = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!credentialsFor) return;
    setSaving(true);
    setFormError('');
    try {
      await setClientCredentials(credentialsFor.id, newPassword);
      setCredentialsFor(null);
      setNewPassword('');
      await load();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Unable to set the password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page
      eyebrow="Clients"
      title="Clients"
      description="The companies your projects are delivered for."
      action={<Button onClick={() => setShowCreate(true)}>Add client</Button>}
    >
      <Card className="mt-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Field label="Search" value={search} onChange={setSearch} placeholder="Name, business or email" />
          </div>
          <Button kind="secondary" onClick={() => void load()}>Search</Button>
        </div>
      </Card>

      {error && <div className="mt-4"><Notice error>{error}</Notice></div>}
      {loading ? (
        <Loading />
      ) : clients.length === 0 ? (
        <Card className="mt-6 text-center text-sm text-app-muted">No clients yet.</Card>
      ) : (
        <Card className="mt-6 overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-app-border text-xs uppercase tracking-wide text-app-muted">
              <tr>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Business</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Region</th>
                <th className="px-4 py-3">Login</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.id} className="border-b border-app-border last:border-b-0 hover:bg-app-surface-raised">
                  <td className="px-4 py-3">
                    {onOpenClient ? (
                      <button type="button" onClick={() => onOpenClient(client.id)} className="font-semibold text-app-accent hover:underline">
                        {client.clientName}
                      </button>
                    ) : (
                      <span className="font-semibold">{client.clientName}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{client.businessName}</td>
                  <td className="px-4 py-3 text-app-muted">{client.email}</td>
                  <td className="px-4 py-3">{CLIENT_REGION_LABELS[client.region]}</td>
                  <td className="px-4 py-3">
                    {client.hasActiveLogin ? <span className="text-app-accent">Active</span> : <span className="text-app-muted">None</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" onClick={() => { setCredentialsFor(client); setNewPassword(generateStrongPassword()); }} className="text-xs font-semibold text-app-accent hover:underline">
                      {client.hasActiveLogin ? 'Reset password' : 'Set password'}
                    </button>
                    {client.hasActiveLogin && (
                      <button
                        type="button"
                        onClick={() => void revokeClientCredentials(client.id).then(load)}
                        className="ml-3 text-xs font-semibold text-app-danger hover:underline"
                      >
                        Revoke login
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {showCreate && (
        <Modal title="Add client" onClose={() => setShowCreate(false)}>
          <form onSubmit={(event) => void submitCreate(event)} className="space-y-4">
            {formError && <Notice error>{formError}</Notice>}
            <Field label="Client name" value={form.clientName} onChange={(v) => setForm((f) => ({ ...f, clientName: v }))} required />
            <Field label="Business name" value={form.businessName} onChange={(v) => setForm((f) => ({ ...f, businessName: v }))} required />
            <Field label="Email" type="email" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} required />
            <Select
              label="Region"
              value={form.region}
              onChange={(v) => setForm((f) => ({ ...f, region: v as ClientRegion }))}
              options={CLIENT_REGIONS.map((region) => ({ value: region, label: CLIENT_REGION_LABELS[region] }))}
              required
            />
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-app-muted">Password</span>
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, password: generateStrongPassword() }))}
                  className="text-xs font-semibold text-app-accent hover:underline"
                >
                  Generate password
                </button>
              </div>
              <input
                type="text"
                required
                minLength={12}
                value={form.password}
                onChange={(event) => setForm((f) => ({ ...f, password: event.target.value }))}
                placeholder="At least 12 characters"
                className="mt-2 w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm outline-none focus:border-app-accent"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button kind="secondary" type="button" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create client'}</Button>
            </div>
          </form>
        </Modal>
      )}

      {credentialsFor && (
        <Modal title={`${credentialsFor.hasActiveLogin ? 'Reset' : 'Set'} password — ${credentialsFor.clientName}`} onClose={() => setCredentialsFor(null)}>
          <form onSubmit={(event) => void submitCredentials(event)} className="space-y-4">
            {formError && <Notice error>{formError}</Notice>}
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-app-muted">Password</span>
                <button type="button" onClick={() => setNewPassword(generateStrongPassword())} className="text-xs font-semibold text-app-accent hover:underline">
                  Generate password
                </button>
              </div>
              <input
                type="text"
                required
                minLength={12}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className="mt-2 w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm outline-none focus:border-app-accent"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button kind="secondary" type="button" onClick={() => setCredentialsFor(null)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
            </div>
          </form>
        </Modal>
      )}
    </Page>
  );
}
