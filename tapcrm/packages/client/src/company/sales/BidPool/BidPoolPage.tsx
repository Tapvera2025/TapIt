import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Field, Icon, Page } from '../../../ui/index.js';
import { ErrorToast } from '../../../ui/ErrorToast.js';
import { useCompanyPageMetadata } from '../../layout/CompanyNavbarContext.js';
import { AddLeadDrawer } from '../leads/AddLeadDrawer.js';
import { getCampaigns, getLeadSources, type Campaign, type Lead, type LeadSource } from '../leads/api.js';
import { ImportLeadsWizard } from '../leads/imports/ImportLeadsWizard.js';
import { LeadsViewTabs } from '../leads/imports/LeadsViewTabs.js';
import { IMPORTED_LEADS_PATH } from '../leads/imports/import-format.js';
import { BidCard } from './BidCard.js';
import { useBidPool } from './useBidPool.js';
import './bid-pool.css';

interface Toast {
  readonly id: number;
  readonly kind: 'info' | 'error' | 'warning';
  readonly message: string;
}

export function BidPoolPage({ onNavigate, currentUserId = '', canAddLead = false, canImport = false, canViewImports = false, canReviewTriage = false, canViewCallbacks = false, canClaim = true }: {
  onNavigate: (path: string) => void;
  currentUserId?: string;
  canAddLead?: boolean;
  canImport?: boolean;
  canViewImports?: boolean;
  canReviewTriage?: boolean;
  canViewCallbacks?: boolean;
  canClaim?: boolean;
}): React.JSX.Element {
  const pageMetadata = useMemo(() => ({
    eyebrow: 'Sales',
    title: 'Lead Pool (Live)',
    description: 'Claim time-sensitive inbound enquiries. Each lead stays masked until you claim it.',
    lockTitle: true,
  }), []);
  useCompanyPageMetadata(pageMetadata);
  const { cards, loading, error, refresh, removeLocally } = useBidPool();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [search, setSearch] = useState('');
  const [leadOpen, setLeadOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!canAddLead && !canImport) return;
    Promise.all([getLeadSources(), getCampaigns()])
      .then(([nextSources, nextCampaigns]) => { setSources(nextSources); setCampaigns(nextCampaigns); setCatalogError(''); })
      .catch((cause) => setCatalogError(cause instanceof Error ? cause.message : 'Unable to load lead setup data.'));
  }, [canAddLead, canImport]);

  function pushToast(kind: Toast['kind'], message: string): void {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), 4500);
  }

  const shown = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return cards;
    return cards.filter((card) => [card.maskedName, card.maskedPhone, card.source, card.campaign, card.location, card.service]
      .some((value) => value?.toLowerCase().includes(query)));
  }, [cards, search]);

  return (
    <Page
      eyebrow="Sales"
      title="Lead Pool (Live)"
      description="Claim time-sensitive inbound enquiries. Each lead stays masked until you claim it."
      hideMobileAction
      action={<div className="flex flex-wrap gap-2">
        {canImport && <Button kind="secondary" onClick={() => setImportOpen(true)}><Icon name="upload" className="size-4" /> Import CSV</Button>}
        {canAddLead && <Button onClick={() => setLeadOpen(true)}><Icon name="plus" className="size-4" /> New Lead</Button>}
        <Button kind="secondary" onClick={() => void refresh()}><Icon name="refresh" className="size-4" /> Refresh</Button>
      </div>}
    >
      {error && <ErrorToast message={error} />}
      {catalogError && <ErrorToast message={catalogError} />}
      {notice && <p role="status" className="rounded-xl border border-app-accent/20 bg-app-accent/10 p-3 text-sm text-app-foreground">{notice}</p>}

      <LeadsViewTabs active="pool" count={loading && cards.length === 0 ? undefined : cards.length} canViewImports={canViewImports} canViewCallbacks={canViewCallbacks} canReviewTriage={canReviewTriage} onNavigate={onNavigate} />

      <Card className="bid-pool-filter-card">
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-full max-w-3xl flex-1">
            <Field label="Search live pool" value={search} onChange={setSearch} placeholder="Search by name, source, or location…" />
          </div>
          <span className="ml-auto pb-2 text-sm text-app-muted">{shown.length} {shown.length === 1 ? 'record' : 'records'}</span>
        </div>
      </Card>

      <div className="pointer-events-none fixed inset-x-0 top-4 z-40 flex flex-col items-center gap-2">
        {toasts.map((toast) => <div key={toast.id} role="status" className={`pointer-events-auto rounded-lg px-4 py-2 text-sm shadow-lg ${toast.kind === 'error' ? 'bg-app-danger text-white' : toast.kind === 'warning' ? 'bg-amber-500 text-amber-950' : 'bg-app-foreground text-app-background'}`}>{toast.message}</div>)}
      </div>

      {loading && cards.length === 0 ? <Card><p className="text-sm text-app-muted">Loading live enquiries…</p></Card> : shown.length === 0 ? (
        <Card className="bid-pool-empty">
          <span className="grid size-12 place-items-center rounded-2xl bg-app-accent/10 text-app-accent"><Icon name="radio" className="size-6" /></span>
          <div><h2 className="font-display text-xl font-bold">{cards.length ? 'No enquiries match your search' : 'No live leads right now'}</h2><p className="mt-1 text-sm text-app-muted">{cards.length ? 'Try a different name, source, or location.' : 'New inbound enquiries will appear here as they enter the live pool.'}</p></div>
        </Card>
      ) : (
        <Card className="bid-pool-table-card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <div className="bid-pool-table-min-width">
              <div className="bid-pool-table-head" aria-hidden="true"><span>Lead &amp; enquiry</span><span>Source</span><span>Stage &amp; status</span><span>Owner</span><span>Estimate</span><span>Action</span></div>
              <div className="divide-y divide-app-border">
                {shown.map((card) => <BidCard key={card.leadId} card={card} row canClaim={canClaim} callbacks={{
                  onClaimed: (leadId) => { removeLocally(leadId); onNavigate(`/company/sales/leads/${leadId}`); },
                  onPassed: (leadId) => { removeLocally(leadId, { cooldown: true }); pushToast('info', 'Passed — hidden for 5 minutes.'); },
                  onLost: (leadId, kind, message) => { removeLocally(leadId); pushToast(kind === 'already_claimed' ? 'warning' : 'error', message); },
                }} />)}
              </div>
            </div>
          </div>
        </Card>
      )}

      {importOpen && <ImportLeadsWizard sources={sources} campaigns={campaigns} onClose={() => setImportOpen(false)} onDone={(importId) => { setImportOpen(false); onNavigate(`${IMPORTED_LEADS_PATH}?import=${importId}`); }} />}
      {leadOpen && <AddLeadDrawer sources={sources} campaigns={campaigns} onClose={() => setLeadOpen(false)} onCreated={(lead: Lead, duplicates) => {
        setLeadOpen(false);
        setNotice(duplicates.length ? `Lead #${lead.leadNumber} was created. Review ${duplicates.length} possible duplicate${duplicates.length === 1 ? '' : 's'} in the lead record.` : `Lead #${lead.leadNumber} was added.`);
        if (lead.ownerId === currentUserId || lead.currentHolderId === currentUserId) onNavigate(`/company/sales/leads/${lead.id}`);
      }} onOpenExisting={(leadId) => onNavigate(`/company/sales/leads/${leadId}`)} />}
    </Page>
  );
}
