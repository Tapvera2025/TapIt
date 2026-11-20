import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Button, Icon, Modal, Page, Select } from '../../../ui/index.js';
import { ErrorToast } from '../../../ui/ErrorToast.js';
import { useBidPool } from '../BidPool/useBidPool.js';
import { AddLeadDrawer } from '../leads/AddLeadDrawer.js';
import { getCampaigns, getLeadSources, getLeads, type Campaign, type LeadPage, type LeadSource } from '../leads/api.js';
import { ImportLeadsWizard } from '../leads/imports/ImportLeadsWizard.js';
import { IMPORTED_LEADS_PATH } from '../leads/imports/import-format.js';
import { isClosedLeadStatus } from '../leads/lead-status.js';
import { ClaimsDistribution } from './ClaimsDistribution.js';
import { getSalesOverviewMetrics } from './dashboard-api.js';
import { SalesOverviewMetricCards } from './SalesOverviewMetrics.js';
import { SalesOverviewAttention } from './SalesOverviewAttention.js';
import { SalesOverviewTodos } from './SalesOverviewTodos.js';
import { useOverviewData } from './useOverviewData.js';
import './sales-overview.css';

interface SalesOverviewPageProps {
  userId: string;
  timezone: string;
  isManager: boolean;
  canViewLeads: boolean;
  canAddLead: boolean;
  canEditLead: boolean;
  canImport: boolean;
  canClaim: boolean;
  canViewCallbacks: boolean;
  canScheduleCallback: boolean;
  canInitiateHandover: boolean;
  canViewTerritories: boolean;
  canViewTriage: boolean;
  canForecast: boolean;
  onNavigate: (path: string) => void;
}

type Shortcut = 'lead' | 'import' | 'handover';

export function SalesOverviewPage(props: SalesOverviewPageProps): React.JSX.Element {
  const { userId, timezone, canViewLeads, canViewCallbacks, onNavigate } = props;
  const [shortcut, setShortcut] = useState<Shortcut | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const pool = useBidPool(canViewLeads);
  const [now, setNow] = useState(() => new Date());
  const hasOffers = pool.cards.length > 0;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), hasOffers ? 1000 : 30_000);
    return () => window.clearInterval(timer);
  }, [hasOffers]);

  const liveCount = pool.loading || pool.error ? null : pool.cards.filter((card) => Date.parse(card.expiresAt) > now.getTime()).length;
  const closeShortcut = () => setShortcut(null);

  return (
    <Page eyebrow="Sales" title="Sales Overview" description="Track your pipeline and pick up the work that needs attention.">
      {(props.canAddLead || props.canScheduleCallback || props.canImport || props.canInitiateHandover || canViewLeads) && (
        <div className="sales-overview-shortcuts" role="group" aria-label="Sales quick actions">
          {props.canAddLead && <ShortcutButton icon="user-plus" label="+ New Lead" onClick={() => setShortcut('lead')} />}
          {props.canScheduleCallback && <ShortcutButton icon="calendar-plus" label="+ Callback" onClick={() => onNavigate('/company/sales/callbacks/schedule')} />}
          {props.canImport && <ShortcutButton icon="upload" label="+ Import CSV" onClick={() => setShortcut('import')} />}
          {props.canInitiateHandover && <ShortcutButton icon="arrow-left-right" label="+ Handover" onClick={() => setShortcut('handover')} />}
          {canViewLeads && <ShortcutButton icon="radio" label={`Live Bid Pool${liveCount === null ? '' : ` (${liveCount})`}`} onClick={() => onNavigate('/company/sales/bid-pool')} />}
        </div>
      )}

      {canViewLeads && <Metrics refreshKey={refreshKey} showLeaderboard={props.isManager} onNavigate={onNavigate} />}
      {(canViewLeads || canViewCallbacks) && (
        <SalesOverviewAttention
          pool={pool}
          now={now}
          canViewLeads={canViewLeads}
          canViewCallbacks={canViewCallbacks}
          canClaim={props.canClaim}
          canEditLead={props.canEditLead}
          timezone={timezone}
          onNavigate={onNavigate}
        />
      )}
      <SalesOverviewTodos timezone={timezone} onNavigate={onNavigate} />

      <nav aria-label="Sales workspaces" className="flex flex-wrap gap-2">
        {props.canViewTriage && <Button kind="secondary" onClick={() => onNavigate('/company/sales/triage')}>Triage queue</Button>}
        {props.canViewTerritories && <Button kind="secondary" onClick={() => onNavigate('/company/sales/territories')}>Territories &amp; routing</Button>}
        {props.canForecast && <Button kind="secondary" onClick={() => onNavigate('/company/sales/reports')}>Performance reports</Button>}
        <Button kind="secondary" onClick={() => onNavigate('/company/sales/setup')}>Setup checklist</Button>
      </nav>

      {((shortcut === 'lead' && props.canAddLead) || (shortcut === 'import' && props.canImport)) && (
        <LeadShortcut key={shortcut} type={shortcut} onClose={closeShortcut} onNavigate={onNavigate} onCreated={() => setRefreshKey((key) => key + 1)} />
      )}
      {shortcut === 'handover' && props.canInitiateHandover && (
        <HandoverShortcut userId={userId} onClose={closeShortcut} onNavigate={onNavigate} />
      )}
    </Page>
  );
}

function Metrics({ refreshKey, showLeaderboard, onNavigate }: { refreshKey: number; showLeaderboard: boolean; onNavigate: (path: string) => void }): React.JSX.Element {
  const { data, error } = useOverviewData(getSalesOverviewMetrics, 'Unable to load sales metrics.', refreshKey);
  return (
    <SalesOverviewMetricCards
      metrics={data}
      error={error}
      onNavigate={onNavigate}
      leaderboard={showLeaderboard && <ClaimsDistribution overview />}
    />
  );
}

function ShortcutButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }): React.JSX.Element {
  return (
    <Button kind="secondary" className="sales-overview-shortcut" onClick={onClick}>
      <span className="sales-overview-shortcut-icon"><Icon name={icon} className="size-[1.15rem]" /></span>
      <span>{label}</span>
    </Button>
  );
}

function LeadShortcut({ type, onClose, onNavigate, onCreated }: {
  type: 'lead' | 'import';
  onClose: () => void;
  onNavigate: (path: string) => void;
  onCreated: () => void;
}): React.JSX.Element {
  const [fields, setFields] = useState<{ sources: LeadSource[]; campaigns: Campaign[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([getLeadSources(), getCampaigns()])
      .then(([sources, campaigns]) => { if (active) setFields({ sources, campaigns }); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load lead sources.'); });
    return () => { active = false; };
  }, []);

  if (!fields) {
    return (
      <Modal title={type === 'lead' ? 'New lead' : 'Import leads'} onClose={onClose}>
        {error ? <ErrorToast message={error} /> : <p role="status" className="text-sm text-app-muted">Loading lead sources…</p>}
      </Modal>
    );
  }
  if (type === 'import') {
    return <ImportLeadsWizard {...fields} onClose={onClose} onDone={(id) => {
      onClose();
      onNavigate(`${IMPORTED_LEADS_PATH}?import=${id}`);
    }} />;
  }
  return <AddLeadDrawer {...fields} onClose={onClose} onOpenExisting={(id) => onNavigate(`/company/sales/leads/${id}`)} onCreated={(lead, duplicates) => {
    onCreated();
    const assignment = lead.ownerName ? ` Assigned to ${lead.ownerName}.` : '';
    toast.success(`Lead #${lead.leadNumber} created.${assignment}`);
    if (duplicates.length) toast(`Possible duplicates: ${duplicates.map((item) => `#${item.leadNumber}`).join(', ')}`);
  }} />;
}

function HandoverShortcut({ userId, onClose, onNavigate }: { userId: string; onClose: () => void; onNavigate: (path: string) => void }): React.JSX.Element {
  const [leadId, setLeadId] = useState('');
  const [page, setPage] = useState(1);
  const [leads, setLeads] = useState<LeadPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getLeads({ currentHolderId: userId, page, pageSize: 30 })
      .then((result) => { if (active) setLeads(result); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load your leads.'); });
    return () => { active = false; };
  }, [page, userId]);

  const options = (leads?.items ?? []).filter(({ status }) => !isClosedLeadStatus(status)).map((lead) => ({
    value: lead.id,
    label: `${lead.contactName} · #${lead.leadNumber}`,
  }));

  function changePage(next: number) {
    setLeadId('');
    setLeads(null);
    setError(null);
    setPage(next);
  }

  return (
    <Modal title="Hand over a live call" onClose={onClose} footer={
      <Button disabled={!leadId} onClick={() => onNavigate(`/company/sales/leads/${leadId}?focus=handover`)}>Continue to handover</Button>
    }>
      {error && <ErrorToast message={error} />}
      {!leads && !error && <p role="status" className="text-sm text-app-muted">Loading your leads…</p>}
      {leads && (options.length > 0
        ? <Select label="Lead you’re currently handling" value={leadId} onChange={setLeadId} options={options} />
        : <p className="text-sm text-app-muted">No open leads you’re currently handling on this page.</p>)}
      {leads && leads.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button kind="secondary" disabled={page <= 1} onClick={() => changePage(page - 1)}>Previous</Button>
          <span className="text-sm text-app-muted">{page} / {leads.totalPages}</span>
          <Button kind="secondary" disabled={page >= leads.totalPages} onClick={() => changePage(page + 1)}>Next</Button>
        </div>
      )}
    </Modal>
  );
}
