import { useEffect, useState } from 'react';
import { Button, Card, Field, Page, Select } from '../../../ui/components.js';
import { createCallback, getAllCallbacks, getLeads, type Lead, type LeadCallback } from './api.js';
import { formatCallbackDate, organizationLocalToIso } from './callback-ui.js';

type CallbackView = 'list' | 'calendar' | 'board' | 'schedule';
const statuses = ['pending', 'completed', 'rescheduled', 'not_reachable', 'missed', 'cancelled'];

export function CallbacksPage({ view, organizationTimezone, onNavigate }: { view: CallbackView; organizationTimezone: string; onNavigate: (path: string) => void }): React.JSX.Element {
  const [callbacks, setCallbacks] = useState<LeadCallback[]>([]); const [status, setStatus] = useState(''); const [ownerId, setOwnerId] = useState(''); const [leadId, setLeadId] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [error, setError] = useState('');
  const reload = () => getAllCallbacks({ status: status || undefined, ownerId: ownerId || undefined, leadId: leadId || undefined, from: from ? new Date(from).toISOString() : undefined, to: to ? new Date(to).toISOString() : undefined }).then(setCallbacks).catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to load callbacks.'));
  useEffect(() => { void reload(); }, [status, ownerId, leadId, from, to]);
  const nav = (next: CallbackView) => onNavigate(`/company/sales/callbacks${next === 'list' ? '' : `/${next}`}`);
  if (view === 'schedule') return <ScheduleCallbackPage organizationTimezone={organizationTimezone} onBack={() => nav('list')} onCreated={(id) => onNavigate(`/company/sales/callbacks/${id}`)} />;
  return <Page eyebrow="Sales" title="Callbacks" description={`Operational callback work in ${organizationTimezone}.`} action={<div className="flex flex-wrap gap-2"><Button kind="secondary" onClick={() => nav('list')}>List</Button><Button kind="secondary" onClick={() => nav('calendar')}>Calendar</Button><Button kind="secondary" onClick={() => nav('board')}>Board</Button><Button onClick={() => nav('schedule')}>Schedule callback</Button></div>}>
    {error && <p className="mb-4 rounded-lg bg-[#d86b6b]/10 p-3 text-sm text-app-danger">{error}</p>}
    <div className="mb-5 grid gap-3 md:grid-cols-5"><Select label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'All statuses' }, ...statuses.map((value) => ({ value, label: value.replaceAll('_', ' ') }))]} /><Field label="Owner ID" value={ownerId} onChange={setOwnerId} placeholder="Optional user ID" /><Field label="Lead ID" value={leadId} onChange={setLeadId} placeholder="Optional Lead ID" /><Field label="From" value={from} onChange={setFrom} type="datetime-local" /><Field label="To" value={to} onChange={setTo} type="datetime-local" /></div>
    {view === 'list' ? <CallbackList callbacks={callbacks} timezone={organizationTimezone} onNavigate={onNavigate} /> : view === 'calendar' ? <CallbackCalendar callbacks={callbacks} timezone={organizationTimezone} onNavigate={onNavigate} /> : <CallbackBoard callbacks={callbacks} timezone={organizationTimezone} onNavigate={onNavigate} />}
  </Page>;
}

function CallbackList({ callbacks, timezone, onNavigate }: { callbacks: LeadCallback[]; timezone: string; onNavigate: (path: string) => void }): React.JSX.Element {
  return <Card className="overflow-hidden p-0">{callbacks.length === 0 ? <p className="p-6 text-sm text-app-muted">No callbacks match the selected filters.</p> : <div className="divide-y divide-app-border">{callbacks.map((callback) => <button key={callback.id} className="flex w-full flex-wrap items-center justify-between gap-4 p-5 text-left hover:bg-app-background" onClick={() => onNavigate(`/company/sales/callbacks/${callback.id}`)}><div><p className="font-display text-lg font-bold">{callback.leadContactName}</p><p className="mt-1 text-sm text-app-muted">Lead #{callback.leadNumber} · {formatCallbackDate(callback.scheduledAt, timezone)} · {callback.ownerName ?? 'Unknown owner'}</p></div><div className="text-right text-xs"><span className={`rounded-full px-3 py-1 font-bold ${callback.status === 'missed' ? 'bg-[#d86b6b]/10 text-app-danger' : 'bg-app-background'}`}>{callback.status.replaceAll('_', ' ')}</span><p className="mt-2 text-app-muted">{callback.outcome?.replaceAll('_', ' ') ?? 'No outcome'}</p></div></button>)}</div>}</Card>;
}

function CallbackCalendar({ callbacks, timezone, onNavigate }: { callbacks: LeadCallback[]; timezone: string; onNavigate: (path: string) => void }): React.JSX.Element {
  const days = Array.from({ length: 7 }, (_, index) => new Date(Date.now() + index * 86400000));
  const dayKey = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  return <div className="grid gap-3 md:grid-cols-7">{days.map((day) => { const key = dayKey(day); const items = callbacks.filter((callback) => dayKey(new Date(callback.scheduledAt)) === key); return <Card key={key} className="min-h-40"><p className="text-xs font-bold uppercase text-app-muted">{new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: timezone }).format(day)}</p>{items.map((callback) => <button key={callback.id} onClick={() => onNavigate(`/company/sales/callbacks/${callback.id}`)} className="mt-3 block w-full rounded-lg bg-app-background p-2 text-left text-xs"><span className="font-bold">{new Intl.DateTimeFormat(undefined, { timeStyle: 'short', timeZone: timezone }).format(new Date(callback.scheduledAt))}</span><br />{callback.status.replaceAll('_', ' ')}</button>)}</Card>; })}</div>;
}

function CallbackBoard({ callbacks, timezone, onNavigate }: { callbacks: LeadCallback[]; timezone: string; onNavigate: (path: string) => void }): React.JSX.Element {
  const columns = ['pending', 'not_reachable', 'missed', 'completed', 'rescheduled', 'cancelled'];
  return <div className="grid gap-4 xl:grid-cols-6">{columns.map((column) => <Card key={column} className="min-h-48"><h2 className="font-display font-bold capitalize">{column.replaceAll('_', ' ')}</h2>{callbacks.filter((callback) => callback.status === column).map((callback) => <button key={callback.id} onClick={() => onNavigate(`/company/sales/callbacks/${callback.id}`)} className="mt-3 w-full rounded-lg border border-app-border p-3 text-left text-xs"><p className="font-bold">{callback.leadContactName}</p><p className="mt-1 text-app-muted">{formatCallbackDate(callback.scheduledAt, timezone)}</p></button>)}</Card>)}</div>;
}

function ScheduleCallbackPage({ organizationTimezone, onBack, onCreated }: { organizationTimezone: string; onBack: () => void; onCreated: (id: string) => void }): React.JSX.Element {
  const [leads, setLeads] = useState<Lead[]>([]); const [leadId, setLeadId] = useState(''); const [scheduledAt, setScheduledAt] = useState(''); const [reason, setReason] = useState(''); const [error, setError] = useState('');
  useEffect(() => { void getLeads().then((page) => setLeads(page.items)).catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to load Leads.')); }, []);
  const save = async () => { try { const callback = await createCallback({ leadId, scheduledAt: organizationLocalToIso(scheduledAt, organizationTimezone), reason: reason.trim() || undefined }); onCreated(callback.id); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to schedule callback.'); } };
  return <Page eyebrow="Sales" title="Schedule callback" description={`Times are interpreted in ${organizationTimezone}.`} action={<Button kind="secondary" onClick={onBack}>Back to callbacks</Button>}>{error && <p className="mb-4 text-sm text-app-danger">{error}</p>}<Card className="max-w-2xl"><div className="grid gap-4 md:grid-cols-2"><Select label="Lead" value={leadId} onChange={setLeadId} options={leads.map((lead) => ({ value: lead.id, label: `${lead.contactName} · #${lead.leadNumber}` }))} /><Field label="Date and time" value={scheduledAt} onChange={setScheduledAt} type="datetime-local" /><Field label="Reason" value={reason} onChange={setReason} /></div><div className="mt-5 flex justify-end"><Button disabled={!leadId || !scheduledAt} onClick={() => void save()}>Schedule</Button></div></Card></Page>;
}
