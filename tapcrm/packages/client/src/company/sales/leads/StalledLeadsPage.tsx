import { useEffect, useState } from 'react';
import { Button, Card, Icon, Page } from '../../../ui/index.js';
import { ErrorToast } from '../../../ui/ErrorToast.js';
import { getStalledLeads, type Lead } from './api.js';
import { LeadsViewTabs } from './imports/LeadsViewTabs.js';

export function StalledLeadsPage({ canViewImports, canViewCallbacks, canReviewTriage, onBack, onNavigate }: {
  canViewImports: boolean;
  canViewCallbacks: boolean;
  canReviewTriage: boolean;
  onBack: () => void;
  onNavigate: (path: string) => void;
}): React.JSX.Element {
  const [items, setItems] = useState<Lead[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    getStalledLeads()
      .then((page) => { if (active) setItems(page.items); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load stalled leads.'); });
    return () => { active = false; };
  }, []);

  return (
    <Page eyebrow="Sales" title="Inactive Leads" description="Review leads that need a follow-up after a missed callback or a period without activity." action={<Button kind="secondary" onClick={onBack}>Back to leads</Button>}>
      <LeadsViewTabs active="stalled" count={items?.length} canViewImports={canViewImports} canViewCallbacks={canViewCallbacks} canReviewTriage={canReviewTriage} onNavigate={onNavigate} />
      {error && <ErrorToast message={error} />}
      {!items && !error && <Card><p role="status" className="text-sm text-app-muted">Loading inactive leads…</p></Card>}
      {items && (
        <Card className="sales-work-panel">
          <h2 className="font-display text-lg font-bold">Leads that need attention</h2>
          {items.length === 0 ? <p className="mt-3 text-sm text-app-muted">No inactive leads require review.</p> : (
            <ul className="mt-3 divide-y divide-app-border border-t border-app-border">
              {items.map((lead) => (
                <li className="sales-work-row" key={lead.id}>
                  <span className="sales-work-icon" data-urgent="true"><Icon name="refresh" className="size-5" /></span>
                  <div className="min-w-0">
                    <p className="break-words font-semibold">{lead.contactName}</p>
                    <p className="mt-1 text-sm text-app-muted">{[`#${lead.leadNumber}`, lead.companyName, lead.ownerName ?? 'Unassigned'].filter(Boolean).join(' · ')}</p>
                    <p className="mt-1 text-xs font-semibold text-app-danger">{lead.stalledReason === 'missed_callback' ? 'Missed callback' : 'Inactive'}</p>
                  </div>
                  <Button kind="secondary" onClick={() => onNavigate(`/company/sales/leads/${lead.id}?focus=status`)}>Review lead</Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </Page>
  );
}
