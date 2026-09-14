import { useEffect, useState } from 'react';
import { createGeofenceLocation, decideGeofenceAppeal, getGeofenceAdminData, setGeofenceAssignment, updateGeofenceLocation, type GeofenceAdminData } from '../api/geofenceApi.js';

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

  return <main className="min-h-screen bg-app-background p-6 text-app-foreground md:p-10">
    <div className="mx-auto max-w-6xl">
      <button type="button" onClick={onBack} className="mb-6 text-sm font-bold text-app-accent hover:underline">Back to CRM</button>
      <div className="mb-8"><p className="text-xs font-bold uppercase tracking-[0.16em] text-app-accent">Identity controls</p><h1 className="mt-2 font-display text-4xl font-bold tracking-[-0.05em]">Geofencing</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-app-muted">Shared locations are used only during sign-in. Employees see the assigned locations and the 90-day coordinate retention period.</p></div>
      {message && <p className="mb-4 rounded-lg border border-app-accent/30 bg-app-accent/10 px-4 py-3 text-sm text-app-accent">{message}</p>}
      {error && <p className="mb-4 rounded-lg border border-[#d86b6b]/30 bg-[#d86b6b]/10 px-4 py-3 text-sm text-[#d86b6b]">{error}</p>}
      <form onSubmit={(event) => { void create(event); }} className="mb-8 grid gap-3 rounded-2xl border border-app-border bg-app-surface p-5 md:grid-cols-5">
        {([['name', 'Location name'], ['latitude', 'Latitude'], ['longitude', 'Longitude'], ['radiusMetres', 'Radius (m)'], ['accuracyThresholdMetres', 'Accuracy (m)']] as const).map(([key, label]) => <label key={key} className="text-xs font-semibold text-app-muted"><span className="mb-2 block">{label}</span><input required className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm text-app-foreground outline-none focus:border-app-accent" value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></label>)}
        <button type="submit" className="rounded-lg bg-app-accent px-4 py-2.5 font-bold text-[#061412] md:col-span-5 md:justify-self-end">Add shared location</button>
      </form>
      {((data?.appeals) ?? []).filter((appeal) => appeal.status === 'pending').length > 0 && <section className="mb-5 rounded-2xl border border-amber-400/30 bg-app-surface p-5"><p className="text-xs font-bold uppercase tracking-[0.12em] text-amber-500">Appeal review</p>{(data?.appeals ?? []).filter((appeal) => appeal.status === 'pending').map((appeal) => <div key={appeal.id} className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-app-border pt-3 text-sm"><span><strong>{appeal.userName}</strong> requested review: {appeal.reason}<span className="ml-2 text-xs text-app-muted">Accuracy {appeal.accuracyMetres ?? 'unknown'}m</span></span><span className="flex gap-2"><button type="button" onClick={() => { const locationId = appeal.locations[0]?.id; if (!locationId) return; void decideGeofenceAppeal(appeal.id, { decision: 'approve', locationId, until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }).then(reload); }} className="rounded-lg bg-app-accent px-3 py-2 text-xs font-bold text-[#061412]">Approve 24h</button><button type="button" onClick={() => { void decideGeofenceAppeal(appeal.id, { decision: 'deny' }).then(reload); }} className="rounded-lg border border-app-border px-3 py-2 text-xs font-bold">Deny</button></span></div>)}</section>}
      <div className="grid gap-5 md:grid-cols-2">{data?.locations.map((location) => <section key={location.id} className="rounded-2xl border border-app-border bg-app-surface p-5">
        <div className="flex items-start justify-between gap-4"><div><h2 className="font-display text-xl font-bold">{location.name}</h2><p className="mt-1 text-xs text-app-muted">{location.latitude}, {location.longitude} · {location.radiusMetres}m radius · {location.accuracyThresholdMetres}m accuracy</p></div><button type="button" onClick={() => { void updateGeofenceLocation(location.id, { status: location.status === 'active' ? 'inactive' : 'active' }).then(reload); }} className="rounded-full border border-app-border px-3 py-1 text-xs font-bold">{location.status === 'active' ? 'Active' : 'Inactive'}</button></div>
        <div className="mt-5 border-t border-app-border pt-4"><p className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-app-muted">Assigned employees</p>{location.assignments.length === 0 ? <p className="text-sm text-app-muted">No employees assigned.</p> : <ul className="space-y-2">{location.assignments.map((assignment) => <li key={assignment.userId} className="flex items-center justify-between gap-3 text-sm"><span>{assignment.userName}<span className="ml-2 text-xs text-app-muted">{assignment.userEmail}</span></span><button type="button" onClick={() => { setSelectedUser({ [location.id]: assignment.userId }); void assign(location.id, false); }} className="text-xs font-bold text-[#d86b6b] hover:underline">Remove</button></li>)}</ul>}
        <div className="mt-4 flex gap-2"><select className="min-w-0 flex-1 rounded-lg border border-app-border bg-app-background px-3 py-2 text-sm text-app-foreground" value={selectedUser[location.id] ?? ''} onChange={(event) => setSelectedUser({ ...selectedUser, [location.id]: event.target.value })}><option value="">Select employee</option>{data?.users.filter((user) => !location.assignments.some((assignment) => assignment.userId === user.id)).map((user) => <option key={user.id} value={user.id}>{user.fullName} ({user.email})</option>)}</select><button type="button" onClick={() => { void assign(location.id, true); }} className="rounded-lg bg-app-accent px-3 py-2 text-xs font-bold text-[#061412]">Assign</button></div></div>
      </section>)}</div>
    </div>
  </main>;
}
