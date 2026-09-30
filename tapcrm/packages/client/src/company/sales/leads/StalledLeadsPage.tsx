import { useEffect, useState } from 'react';
import { Button, Card, Page } from '../../../ui/components.js';
import { getStalledLeads, type Lead } from './api.js';

export function StalledLeadsPage({ onBack, onNavigate }: { onBack: () => void; onNavigate: (path: string) => void }): React.JSX.Element {
  const [items, setItems] = useState<Lead[]>([]); const [error, setError] = useState('');
  useEffect(() => { void getStalledLeads().then((page) => setItems(page.items)).catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to load stalled leads.')); }, []);
  return <Page eyebrow="Sales" title="Stalled Leads" description="Leads requiring review under the current Sales visibility scope." action={<Button kind="secondary" onClick={onBack}>Back to leads</Button>}>{error && <p className="mb-4 text-sm text-app-danger">{error}</p>}<Card className="overflow-hidden p-0">{items.length === 0 ? <p className="p-6 text-sm text-app-muted">No stalled leads require review.</p> : <div className="divide-y divide-app-border">{items.map((lead) => <button key={lead.id} onClick={() => onNavigate(`/company/sales/leads/${lead.id}`)} className="flex w-full flex-wrap items-center justify-between gap-4 p-5 text-left hover:bg-app-background"><div><p className="font-display text-lg font-bold">{lead.contactName}</p><p className="mt-1 text-sm text-app-muted">Owner: {lead.ownerName ?? 'Unrouted'} · {lead.salesTeamName ?? 'No team'}</p></div><div className="text-right text-xs"><span className="rounded-full bg-[#d86b6b]/10 px-3 py-1 font-bold text-app-danger">{lead.stalledReason ?? 'stalled'}</span><p className="mt-2 text-app-muted">{lead.stalledAt ? new Date(lead.stalledAt).toLocaleDateString() : '—'}</p></div></button>)}</div>}</Card></Page>;
}
