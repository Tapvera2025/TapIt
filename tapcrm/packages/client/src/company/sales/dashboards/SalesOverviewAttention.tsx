import { useEffect, useState } from 'react';
import { Avatar } from '../../../chat/Avatar.js';
import { Button, Card, Icon } from '../../../ui/index.js';
import { ErrorToast } from '../../../ui/ErrorToast.js';
import { BidCard } from '../BidPool/BidCard.js';
import type { UseBidPool } from '../BidPool/useBidPool.js';
import { getAllCallbacks, getStalledLeads } from '../leads/api.js';
import { formatCallbackDate } from '../leads/callback-ui.js';
import { isClosedLeadStatus } from '../leads/lead-status.js';
import { OverviewHeading, OverviewLink } from './SalesOverviewMetrics.js';
import { useOverviewData } from './useOverviewData.js';

const fetchPendingCallbacks = () => getAllCallbacks({ status: 'pending' });

export function SalesOverviewAttention({ pool, now, canViewLeads, canViewCallbacks, canClaim, canEditLead, timezone, onNavigate }: {
  pool: UseBidPool;
  now: Date;
  canViewLeads: boolean;
  canViewCallbacks: boolean;
  canClaim: boolean;
  canEditLead: boolean;
  timezone: string;
  onNavigate: (path: string) => void;
}): React.JSX.Element {
  const [claimError, setClaimError] = useState<string | null>(null);
  const cards = pool.cards.filter((card) => Date.parse(card.expiresAt) > now.getTime());
  const callbacks = useOverviewData(fetchPendingCallbacks, 'Unable to load callbacks.', 0, canViewCallbacks);
  const leads = useOverviewData(getStalledLeads, 'Unable to load stalled leads.', 0, canViewLeads);
  const overdue = canViewCallbacks ? (callbacks.data ?? []).filter((row) => Date.parse(row.scheduledAt) < now.getTime())
    .sort((first, second) => Date.parse(first.scheduledAt) - Date.parse(second.scheduledAt)) : [];
  const stalled = canViewLeads ? (leads.data?.items ?? []).filter((lead) => !isClosedLeadStatus(lead.status)) : [];
  const loading = (canViewLeads && (pool.loading || (!leads.data && !leads.error))) ||
    (canViewCallbacks && !callbacks.data && !callbacks.error);
  const errors = [canViewLeads && pool.error, canViewCallbacks && callbacks.error, canViewLeads && leads.error];
  const hasItems = cards.length > 0 || overdue.length > 0 || stalled.length > 0;

  useEffect(() => {
    if (!claimError) return;
    const timer = window.setTimeout(() => setClaimError(null), 6000);
    return () => window.clearTimeout(timer);
  }, [claimError]);

  return (
    <Card className="sales-overview-card">
      <OverviewHeading
        title="Needs Attention"
        action={canViewLeads && <OverviewLink onClick={() => onNavigate('/company/sales/my-work')}>Open My Work</OverviewLink>}
      />
      {claimError && <ErrorToast message={claimError} />}
      <div className="sales-overview-action-list">
        {errors.map((error, index) => error && <ErrorToast key={index} message={error} />)}
        {!hasItems && loading && <p role="status" className="sales-overview-list-state">Loading priorities…</p>}
        {!hasItems && !loading && !errors.some(Boolean) && <p className="sales-overview-list-state">Nothing needs attention right now.</p>}
        {canViewLeads && cards.slice(0, 2).map((card) => (
          <BidCard key={card.leadId} card={card} compact canClaim={canClaim} now={now} callbacks={{
            onClaimed: (leadId) => {
              pool.removeLocally(leadId);
              onNavigate(`/company/sales/leads/${leadId}`);
            },
            onPassed: (leadId) => pool.removeLocally(leadId, { cooldown: true }),
            onLost: (leadId, kind, message) => {
              if (kind === 'already_claimed') pool.removeLocally(leadId);
              setClaimError(message);
              void pool.refresh();
            },
          }} />
        ))}
        {overdue.slice(0, 2).map((callback) => (
          <AttentionRow
            key={callback.id}
            icon="phone"
            title={`Call back ${callback.leadContactName}`}
            detail={callback.reason || `Lead #${callback.leadNumber}`}
            meta={formatCallbackDate(callback.scheduledAt, timezone)}
            owner={callback.ownerName ? { id: callback.ownerId, name: callback.ownerName } : undefined}
            urgent
            action="Review callback"
            onAction={() => onNavigate(`/company/sales/callbacks/${callback.id}`)}
          />
        ))}
        {stalled.slice(0, 3).map((lead) => (
          <AttentionRow
            key={lead.id}
            icon="refresh"
            title={`Re-engage ${lead.contactName}`}
            detail={[lead.companyName, `#${lead.leadNumber}`].filter(Boolean).join(' · ')}
            meta={lead.stalledAt ? `Flagged inactive ${new Date(lead.stalledAt).toLocaleDateString(undefined, { timeZone: timezone })}` : 'Stalled lead'}
            owner={lead.currentHolderId && lead.currentHolderName ? { id: lead.currentHolderId, name: lead.currentHolderName } : undefined}
            action={canEditLead ? 'Re-engage' : 'Review lead'}
            onAction={() => onNavigate(`/company/sales/leads/${lead.id}?focus=status`)}
          />
        ))}
      </div>
    </Card>
  );
}

function AttentionRow({ icon, title, detail, meta, owner, urgent, action, onAction }: {
  icon: string;
  title: string;
  detail: string;
  meta: string;
  owner?: { id: string; name: string } | undefined;
  urgent?: boolean;
  action: string;
  onAction: () => void;
}): React.JSX.Element {
  return (
    <article className="sales-overview-action-row">
      <span className={`sales-overview-row-icon ${urgent ? 'bg-app-danger/12 text-app-danger' : 'bg-app-accent/12 text-app-accent'}`}><Icon name={icon} /></span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h3 className="font-semibold">{title}</h3>
          {urgent && <span className="sales-overview-urgent">Urgent</span>}
        </div>
        <p className="mt-0.5 text-sm text-app-muted">{detail}</p>
        <p className="mt-1 text-xs text-app-muted">{meta}</p>
      </div>
      <div className="sales-overview-row-action flex items-center gap-3">
        {owner && <Avatar name={owner.name} seed={owner.id} />}
        <Button onClick={onAction}>{action}</Button>
      </div>
    </article>
  );
}
