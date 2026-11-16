import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Card, Field, Modal, Notice, Page, Select, SkeletonTable } from '../ui/index.js';
import { Icon } from '../ui/index.js';
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
 * this same list). After a client is added, `onAddProject` (when the user can
 * manage projects) powers the "Add project" action of the follow-up toast.
 */
export function ClientsPage({ onOpenClient, onAddProject }: { onOpenClient?: (clientId: string) => void; onAddProject?: (client: Client) => void }): React.JSX.Element {
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
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

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
      const client = await createClient(form);
      setShowCreate(false);
      setForm(blankForm);
      setShowPassword(false);
      announceClientCreated(client);
      await load();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Unable to create client.');
    } finally {
      setSaving(false);
    }
  };

  const announceClientCreated = (client: Client): void => {
    if (!onAddProject) {
      toast.success('Client added');
      return;
    }
    toast.custom((t) => (
      <ClientAddedToast
        visible={t.visible}
        clientName={client.clientName}
        onAddProject={() => { toast.dismiss(t.id); onAddProject(client); }}
        onLater={() => toast.dismiss(t.id)}
      />
    ), { id: `client-added-${client.id}`, duration: 12_000 });
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
      setShowNewPassword(false);
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
      action={<Button onClick={() => { setShowCreate(true); setShowPassword(false); }}>Add client</Button>}
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
        <SkeletonTable columns={4} rows={5} />
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
                    <button type="button" onClick={() => { setCredentialsFor(client); setNewPassword(generateStrongPassword()); setShowNewPassword(false); }} className="text-xs font-semibold text-app-accent hover:underline">
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
        <Modal title="Add client" onClose={() => { setShowCreate(false); setShowPassword(false); }}>
          {/* The email and password are the new client's, not the signed-in
              person's: the hints below stop the browser filling in a saved login. */}
          <form onSubmit={(event) => void submitCreate(event)} className="space-y-4" autoComplete="off">
            {formError && <Notice error>{formError}</Notice>}
            <Field label="Client name" value={form.clientName} onChange={(v) => setForm((f) => ({ ...f, clientName: v }))} required />
            <Field label="Business name" value={form.businessName} onChange={(v) => setForm((f) => ({ ...f, businessName: v }))} required />
            <Field label="Email" type="email" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} autoComplete="off" required />
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
              <div className="relative mt-2">
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  minLength={12}
                  value={form.password}
                  onChange={(event) => setForm((f) => ({ ...f, password: event.target.value }))}
                  placeholder="At least 12 characters"
                  className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 pr-12 text-sm outline-none focus:border-app-accent"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-app-muted hover:bg-app-surface-raised hover:text-app-accent focus-visible:outline-2 focus-visible:outline-app-accent"
                >
                  <Icon name={showPassword ? 'eye-off' : 'eye'} className="size-[18px]" />
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button kind="secondary" type="button" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create client'}</Button>
            </div>
          </form>
        </Modal>
      )}

      {credentialsFor && (
        <Modal title={`${credentialsFor.hasActiveLogin ? 'Reset' : 'Set'} password — ${credentialsFor.clientName}`} onClose={() => { setCredentialsFor(null); setShowNewPassword(false); }}>
          <form onSubmit={(event) => void submitCredentials(event)} className="space-y-4">
            {formError && <Notice error>{formError}</Notice>}
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-app-muted">Password</span>
                <button type="button" onClick={() => setNewPassword(generateStrongPassword())} className="text-xs font-semibold text-app-accent hover:underline">
                  Generate password
                </button>
              </div>
              <div className="relative mt-2">
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  minLength={12}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 pr-12 text-sm outline-none focus:border-app-accent"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword((visible) => !visible)}
                  aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showNewPassword}
                  className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-app-muted hover:bg-app-surface-raised hover:text-app-accent focus-visible:outline-2 focus-visible:outline-app-accent"
                >
                  <Icon name={showNewPassword ? 'eye-off' : 'eye'} className="size-[18px]" />
                </button>
              </div>
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

/** Follow-up toast after a client is added: offers to jump straight into a new project for them. */
function ClientAddedToast({ visible, clientName, onAddProject, onLater }: { visible: boolean; clientName: string; onAddProject: () => void; onLater: () => void }): React.JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-auto w-[min(92vw,380px)] rounded-2xl border border-app-border bg-app-surface p-4 text-app-foreground shadow-lg transition duration-200 ${visible ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'}`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-app-accent"><Icon name="check" className="size-[18px]" /></span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Client added</p>
          <p className="mt-0.5 text-sm text-app-muted">Want to add a project for <strong>{clientName}</strong> now?</p>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button kind="secondary" onClick={onLater} className="!px-3 !py-1.5 !text-xs">Later</Button>
        <Button onClick={onAddProject} className="!px-3 !py-1.5 !text-xs">Add project</Button>
      </div>
    </div>
  );
}
