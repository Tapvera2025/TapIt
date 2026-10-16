import { useEffect, useState } from 'react';
import { createGeofenceLocation, decideGeofenceAppeal, getGeofenceAdminData, setGeofenceAssignment, updateGeofenceLocation, type GeofenceAdminData } from '../api/geofenceApi.js';
import { Icon } from '../../ui/Icon.js';

const initialForm = { name: '', latitude: '', longitude: '', radiusMetres: '150', accuracyThresholdMetres: '100' };

export function GeofencingPage({ onBack }: { onBack: () => void }): React.JSX.Element {
  const [data, setData] = useState<GeofenceAdminData | null>(null);
  const [form, setForm] = useState(initialForm);
  const [selectedUser, setSelectedUser] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function reload() { setData(await getGeofenceAdminData()); }
  useEffect(() => { void reload().catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to load geofences')); }, []);

  async function create(event: React.FormEvent) {
    event.preventDefault(); setError(''); setMessage('');
    try {
      await createGeofenceLocation({ name: form.name, latitude: Number(form.latitude), longitude: Number(form.longitude), radiusMetres: Number(form.radiusMetres), accuracyThresholdMetres: Number(form.accuracyThresholdMetres) });
      setForm(initialForm); setMessage('Location created.'); await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to create location'); }
  }

  async function assign(locationId: string, enabled: boolean) {
    const userId = selectedUser[locationId]; if (!userId) return;
    setError(''); setMessage('');
    try { await setGeofenceAssignment(locationId, userId, enabled); setMessage(enabled ? 'User added to the location.' : 'User removed from the location.'); await reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to update assignment'); }
  }

  return <main className="min-h-screen bg-app-background p-5 text-app-foreground sm:p-6 md:p-8">
    <div className="mx-auto max-w-7xl">
      <button type="button" onClick={onBack} className="group mb-5 inline-flex items-center gap-2 text-sm font-bold text-app-muted transition-colors hover:text-app-accent"><span className="text-lg leading-none transition-transform group-hover:-translate-x-0.5">←</span> Back to CRM</button>
      <header className="mb-6 space-y-1">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-app-accent">Identity</p>
        <h1 className="font-display text-2xl font-bold">Geofencing</h1>
        <p className="text-sm text-app-muted">Manage approved workplace locations and employee sign-in boundaries.</p>
      </header>
      {message && <p className="mb-4 rounded-lg border border-app-accent/30 bg-app-accent/10 px-4 py-3 text-sm text-app-accent">{message}</p>}
      {error && <p className="mb-4 rounded-lg border border-[#d86b6b]/30 bg-[#d86b6b]/10 px-4 py-3 text-sm text-app-danger">{error}</p>}
      <form onSubmit={(event) => { void create(event); }} className="mb-6 overflow-hidden rounded-2xl border border-app-border bg-app-surface shadow-sm">
        <div className="flex flex-col gap-4 px-5 pb-3 pt-5 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:pt-6"><div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-app-accent/10 text-app-accent"><Icon name="pin" className="size-5" /></span><div><h2 className="font-display text-lg font-bold">Shared locations</h2><p className="mt-1 text-sm text-app-muted">Create and manage approved sign-in boundaries for your team.</p></div></div><p className="flex items-center gap-2 text-xs text-app-muted"><span className="size-2 rounded-full bg-app-accent" /> 90-day coordinate retention</p></div>
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-12 sm:p-6">
          {([['name', 'Location name', 'e.g. Head office'], ['latitude', 'Latitude', 'e.g. 28.6139'], ['longitude', 'Longitude', 'e.g. 77.2090'], ['radiusMetres', 'Radius (m)', '150'], ['accuracyThresholdMetres', 'Accuracy (m)', '100']] as const).map(([key, label, placeholder], index) => <label key={key} className={`text-xs font-semibold text-app-muted ${index === 0 ? 'lg:col-span-4' : 'lg:col-span-2'}`}><span className="mb-2 block">{label}</span><input required placeholder={placeholder} inputMode={key === 'name' ? 'text' : 'decimal'} className="w-full rounded-xl border border-app-border bg-app-surface px-3.5 py-3 text-sm text-app-foreground outline-none transition focus:border-app-accent focus:ring-2 focus:ring-app-accent/10" value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></label>)}
        </div>
        <div className="mx-5 mb-5 flex flex-col-reverse gap-3 rounded-xl bg-app-surface-raised/70 px-4 py-3 sm:mx-6 sm:mb-6 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs leading-5 text-app-muted">Use latitude and longitude from your approved workplace address.</p><button type="submit" className="inline-flex items-center justify-center gap-2 rounded-xl bg-app-accent px-4 py-2.5 text-sm font-bold text-app-on-accent"><span className="text-lg leading-none">+</span> Add shared location</button></div>
      </form>
      {((data?.appeals) ?? []).filter((appeal) => appeal.status === 'pending').length > 0 && <section className="mb-5 rounded-2xl border border-amber-400/30 bg-app-surface p-5"><p className="text-xs font-bold uppercase tracking-[0.12em] text-amber-500">Appeal review</p>{(data?.appeals ?? []).filter((appeal) => appeal.status === 'pending').map((appeal) => <div key={appeal.id} className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-app-border pt-3 text-sm"><span><strong>{appeal.userName}</strong> requested review: {appeal.reason}<span className="ml-2 text-xs text-app-muted">Accuracy {appeal.accuracyMetres ?? 'unknown'}m</span></span><span className="flex gap-2"><button type="button" onClick={() => { const locationId = appeal.locations[0]?.id; if (!locationId) return; void decideGeofenceAppeal(appeal.id, { decision: 'approve', locationId, until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }).then(reload); }} className="rounded-lg bg-app-accent px-3 py-2 text-xs font-bold text-app-on-accent">Approve 24h</button><button type="button" onClick={() => { void decideGeofenceAppeal(appeal.id, { decision: 'deny' }).then(reload); }} className="rounded-lg border border-app-border px-3 py-2 text-xs font-bold">Deny</button></span></div>)}</section>}
      <div className="grid gap-5 md:grid-cols-2">{data?.locations.map((location) => <section key={location.id} className="rounded-2xl border border-app-border bg-app-surface p-5">
        <div className="flex items-start justify-between gap-4"><div><h2 className="font-display text-xl font-bold">{location.name}</h2><p className="mt-1 text-xs text-app-muted">{location.latitude}, {location.longitude} · {location.radiusMetres}m radius · {location.accuracyThresholdMetres}m accuracy</p></div><button type="button" onClick={() => { void updateGeofenceLocation(location.id, { status: location.status === 'active' ? 'inactive' : 'active' }).then(reload); }} className="rounded-full border border-app-border px-3 py-1 text-xs font-bold">{location.status === 'active' ? 'Active' : 'Inactive'}</button></div>
        <div className="mt-5 border-t border-app-border pt-4"><p className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-app-muted">Assigned employees</p>{location.assignments.length === 0 ? <p className="text-sm text-app-muted">No employees assigned.</p> : <ul className="space-y-2">{location.assignments.map((assignment) => <li key={assignment.userId} className="flex items-center justify-between gap-3 text-sm"><span>{assignment.userName}<span className="ml-2 text-xs text-app-muted">{assignment.userEmail}</span></span><button type="button" onClick={() => { setSelectedUser({ [location.id]: assignment.userId }); void assign(location.id, false); }} className="text-xs font-bold text-app-danger hover:underline">Remove</button></li>)}</ul>}
        <div className="mt-4 flex gap-2"><select className="min-w-0 flex-1 rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm text-app-foreground" value={selectedUser[location.id] ?? ''} onChange={(event) => setSelectedUser({ ...selectedUser, [location.id]: event.target.value })}><option value="">Select employee</option>{data?.users.filter((user) => !location.assignments.some((assignment) => assignment.userId === user.id)).map((user) => <option key={user.id} value={user.id}>{user.fullName} ({user.email})</option>)}</select><button type="button" onClick={() => { void assign(location.id, true); }} className="rounded-lg bg-app-accent px-3 py-2 text-xs font-bold text-app-on-accent">Assign</button></div></div>
      </section>)}</div>
    </div>
  </main>;
}
