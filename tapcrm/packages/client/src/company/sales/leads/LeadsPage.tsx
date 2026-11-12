import { useEffect, useState } from 'react';
import { Button, Card, Field, Page } from '../../../ui/index.js';
import { createLeadSource, getCampaigns, getLeadSources, getLeads, type Campaign, type Lead, type LeadSource } from './api.js';
import { isClosedLeadStatus, leadStatusLabel } from './lead-status.js';
import { leadRowHint } from '../guide/lead-guidance.js';
import { leadsListGuidance } from '../guide/page-guidance.js';
import { SalesCoach } from '../guide/SalesGuide.js';
import { AddLeadDrawer, useAddLeadShortcut } from './AddLeadDrawer.js';
import { ImportLeadsWizard } from './imports/ImportLeadsWizard.js';
import { LeadsViewTabs } from './imports/LeadsViewTabs.js';
import { IMPORTED_LEADS_PATH } from './imports/import-format.js';

export function LeadsPage({ onNavigate, currentUserId = '', isManager = false, canViewImports = false, canImport = false }: { onNavigate: (path: string) => void; currentUserId?: string; isManager?: boolean; canViewImports?: boolean; canImport?: boolean }): React.JSX.Element {
  const [importOpen, setImportOpen] = useState(false);
  const [items, setItems] = useState<Lead[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [open, setOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourcesShown, setSourcesShown] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const reload = () => Promise.all([getLeads(), getLeadSources(), getCampaigns()])
    .then(([page, nextSources, nextCampaigns]) => { setItems(page.items); setSources(nextSources); setCampaigns(nextCampaigns); })
    .catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to load leads.'))
    .finally(() => setLoaded(true));
  useEffect(() => { void reload(); }, []);
  const [duplicates, setDuplicates] = useState<Array<{ leadId: string; leadNumber: string; ownerName: string | null }>>([]);
  useAddLeadShortcut(() => setOpen(true));

  const activeSources = sources.filter((source) => source.status === 'active');
  const counts = {
    firstCall: items.filter((lead) => lead.currentHolderId === currentUserId && (lead.status === 'new' || lead.status === 'assigned')).length,
    unowned: items.filter((lead) => !lead.ownerId && !isClosedLeadStatus(lead.status)).length,
  };
  const guidance = loaded ? leadsListGuidance(counts, { isManager, canAddLeads: true, canRecordWin: false, canDecideApprovals: false }) : null;
  const showSources = isManager || (loaded && activeSources.length === 0);

  return (
    <Page
      eyebrow="Sales"
      title="Leads"
      description="Every enquiry and potential customer. Open one to see what to do next."
      action={
        <div className="flex flex-wrap gap-2">
          <Button kind="secondary" onClick={() => onNavigate('/company/sales/leads/stalled')} title="Leads with no activity for a while">Stalled leads</Button>
          <Button kind="secondary" onClick={() => onNavigate('/company/sales/leads/re-engagement')} title="Lost leads worth another try">Re-engagement</Button>
          {canImport && <Button kind="secondary" onClick={() => setImportOpen(true)}>Import leads</Button>}
          <Button onClick={() => setOpen(true)}>Add lead</Button>
        </div>
      }
    >
      <SalesCoach guidance={guidance} onNavigate={onNavigate} onCommand={(command) => { if (command.type === 'add-lead') setOpen(true); }} />
      {canViewImports && <LeadsViewTabs active="all" onNavigate={onNavigate} />}
      {importOpen && <ImportLeadsWizard sources={sources} campaigns={campaigns} onClose={() => setImportOpen(false)} onDone={(importId) => { setImportOpen(false); onNavigate(`${IMPORTED_LEADS_PATH}?import=${importId}`); }} />}
      {error && <p className="rounded-lg bg-[#d86b6b]/10 p-3 text-sm text-app-danger">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-app-accent/10 p-3 text-sm">{notice}</p>}
      {duplicates.length > 0 && <Card className="border border-amber-500/40 bg-amber-500/10"><p className="font-semibold">Possible duplicate lead created</p><p className="mt-1 text-sm text-app-muted">Check these existing leads before you reach out: {duplicates.map((duplicate) => `#${duplicate.leadNumber}${duplicate.ownerName ? ` (${duplicate.ownerName})` : ''}`).join(', ')}.</p></Card>}
      {open && <AddLeadDrawer sources={sources} campaigns={campaigns} onClose={() => setOpen(false)} onCreated={(lead, dupes) => {
        setDuplicates(dupes);
        void reload();
        // Open the lead only when it is yours to work. An inbound enquiry goes
        // to whoever routing picks (or waits for an owner), which the person
        // who typed it in may not be able to open.
        const yours = lead.ownerId === currentUserId || lead.currentHolderId === currentUserId;
        if (yours) {
          setNotice('');
          if (!dupes.length) onNavigate(`/company/sales/leads/${lead.id}`);
        } else {
          setNotice(lead.ownerId
            ? `Lead #${lead.leadNumber} for ${lead.contactName} was added and went to ${lead.ownerName ?? 'a colleague'}.`
            : `Lead #${lead.leadNumber} for ${lead.contactName} was added. Nobody is free to take it right now, so it is waiting for a manager to assign it.`);
        }
      }} onOpenExisting={(leadId) => onNavigate(`/company/sales/leads/${leadId}`)} />}
      {sourceOpen && <SourceForm onCancel={() => setSourceOpen(false)} onSave={async (input) => { try { await createLeadSource(input); setSourceOpen(false); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to create source.'); } }} />}

      {showSources && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold">Lead sources</h2>
              <p className="mt-1 text-sm text-app-muted">
                {activeSources.length === 0
                  ? 'Add at least one source (where leads come from, like Website or Referral) before adding leads.'
                  : 'Inbound sources (they contacted us) are routed to the right team. Outbound sources (we found them) stay with whoever adds the lead.'}
              </p>
            </div>
            <div className="flex gap-2">
              {activeSources.length > 0 && <Button kind="secondary" onClick={() => setSourcesShown((shown) => !shown)}>{sourcesShown ? 'Hide' : `Show ${activeSources.length}`}</Button>}
              <Button kind="secondary" onClick={() => setSourceOpen(true)}>New source</Button>
            </div>
          </div>
          {sourcesShown && (
            <div className="mt-4 flex flex-wrap gap-2">
              {sources.map((source) => <span key={source.id} className="rounded-full bg-app-background px-3 py-1.5 text-xs font-semibold">{source.name} · {source.direction}{source.status === 'inactive' ? ' · off' : ''}</span>)}
            </div>
          )}
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        {!loaded ? (
          <p className="p-6 text-sm text-app-muted">Loading leads…</p>
        ) : items.length === 0 ? (
          <div className="p-6">
            <h2 className="font-display text-xl font-bold">No leads yet</h2>
            <p className="mt-2 text-sm text-app-muted">Leads arrive from your website and ad forms, from imports, or when someone adds one here.</p>
            {activeSources.length > 0 && <Button className="mt-4" onClick={() => setOpen(true)}>Add your first lead</Button>}
          </div>
        ) : (
          <div className="divide-y divide-app-border">
            {items.map((lead) => {
              const hint = leadRowHint(lead, currentUserId);
              return (
                <button key={lead.id} className="flex w-full flex-wrap items-center justify-between gap-4 p-5 text-left hover:bg-app-background" onClick={() => onNavigate(`/company/sales/leads/${lead.id}`)}>
                  <div className="min-w-0">
                    <p className="font-display text-lg font-bold">{lead.contactName}</p>
                    <p className="mt-1 text-sm text-app-muted">#{lead.leadNumber}{lead.companyName ? ` · ${lead.companyName}` : ''} · {lead.sourceName}{lead.campaignName ? ` · ${lead.campaignName}` : ''}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 text-right text-xs">
                    <span className="rounded-full bg-app-background px-3 py-1 font-bold">{leadStatusLabel(lead.status)}</span>
                    <span className={`font-semibold ${hint.urgent ? 'text-app-accent' : 'text-app-muted'}`}>{hint.urgent ? '→ ' : ''}{hint.label}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Card>
    </Page>
  );
}

const _LeadForm = function LeadForm({ sources, campaigns, onCancel, onSave }: { sources: LeadSource[]; campaigns: Campaign[]; onCancel: () => void; onSave: (input: { contactName: string; companyName?: string | undefined; phone?: string | undefined; email?: string | undefined; sourceId: string; campaignId?: string | undefined }) => Promise<void> }): React.JSX.Element {
  const [contactName, setContactName] = useState(''); const [companyName, setCompanyName] = useState(''); const [phone, setPhone] = useState(''); const [email, setEmail] = useState(''); const [sourceId, setSourceId] = useState(sources[0]?.id ?? ''); const [campaignId, setCampaignId] = useState('');
  return <Card className="mb-6"><h2 className="font-display text-xl font-bold">New lead</h2><div className="mt-5 grid gap-4 md:grid-cols-2"><Field label="Contact name" value={contactName} onChange={setContactName} required /><Field label="Company" value={companyName} onChange={setCompanyName} /><Field label="Phone" value={phone} onChange={setPhone} /><Field label="Email" value={email} onChange={setEmail} type="email" /><label className="text-xs font-semibold text-app-muted"><span className="mb-2 block">Source</span><select value={sourceId} onChange={(event) => setSourceId(event.target.value)} className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm" required><option value="">Select source</option>{sources.filter((source) => source.status === 'active').map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label><label className="text-xs font-semibold text-app-muted"><span className="mb-2 block">Campaign</span><select value={campaignId} onChange={(event) => setCampaignId(event.target.value)} className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm"><option value="">No campaign</option>{campaigns.filter((campaign) => campaign.status === 'active').map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label></div><div className="mt-5 flex justify-end gap-3"><Button kind="secondary" onClick={onCancel}>Cancel</Button><Button disabled={!contactName.trim() || (!phone.trim() && !email.trim()) || !sourceId} onClick={() => void onSave({ contactName: contactName.trim(), companyName: companyName.trim() || undefined, phone: phone.trim() || undefined, email: email.trim() || undefined, sourceId, campaignId: campaignId || undefined })}>Create lead</Button></div></Card>;
};

function SourceForm({ onCancel, onSave }: { onCancel: () => void; onSave: (input: { name: string; direction: 'inbound' | 'outbound' }) => Promise<void> }): React.JSX.Element {
  const [name, setName] = useState(''); const [direction, setDirection] = useState<'inbound' | 'outbound'>('inbound');
  return <Card className="mb-6"><h2 className="font-display text-xl font-bold">New lead source</h2><div className="mt-5 grid gap-4 md:grid-cols-2"><Field label="Name" value={name} onChange={setName} required /><label className="text-xs font-semibold text-app-muted"><span className="mb-2 block">Direction</span><select value={direction} onChange={(event) => setDirection(event.target.value as 'inbound' | 'outbound')} className="w-full rounded-lg border border-app-border bg-app-background px-3 py-2.5 text-sm"><option value="inbound">Inbound: they contact us (routed to a team)</option><option value="outbound">Outbound: we find them (stays with whoever adds it)</option></select></label></div><div className="mt-5 flex justify-end gap-3"><Button kind="secondary" onClick={onCancel}>Cancel</Button><Button disabled={!name.trim()} onClick={() => void onSave({ name: name.trim(), direction })}>Create source</Button></div></Card>;
}
