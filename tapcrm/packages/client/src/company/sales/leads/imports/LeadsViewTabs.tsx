import { Icon } from '../../../../ui/index.js';
import { IMPORTED_LEADS_PATH } from './import-format.js';
import '../../BidPool/bid-pool.css';

const views = [
  { id: 'all', label: 'All leads', path: '/company/sales/leads', icon: 'users' },
  { id: 'pool', label: 'Lead Pool (Live)', path: '/company/sales/bid-pool', icon: 'radio' },
  { id: 'stalled', label: 'Inactive leads', path: '/company/sales/leads/stalled', icon: 'clock' },
  { id: 'follow-up', label: 'Follow-up required', path: '/company/sales/callbacks/list?status=pending', icon: 'calendar' },
  { id: 'review', label: 'Needs review', path: '/company/sales/triage', icon: 'inbox' },
  { id: 'imported', label: 'Imported leads', path: IMPORTED_LEADS_PATH, icon: 'upload' },
] as const;

export function LeadsViewTabs({ active, count, canViewImports = false, canViewCallbacks = false, canReviewTriage = false, canViewLeads = true, onNavigate }: {
  active: typeof views[number]['id'];
  count?: number | undefined;
  canViewImports?: boolean;
  canViewCallbacks?: boolean;
  canReviewTriage?: boolean;
  canViewLeads?: boolean;
  onNavigate: (path: string) => void;
}): React.JSX.Element {
  const allowed = { all: canViewLeads, pool: canViewLeads, stalled: canViewLeads, 'follow-up': canViewCallbacks, review: canReviewTriage, imported: canViewImports };
  return (
    <nav className="bid-pool-tabs" aria-label="Lead views">
      {views.filter((view) => view.id === active || allowed[view.id]).map((view) => (
        <button key={view.id} type="button" aria-current={view.id === active ? 'page' : undefined} className={view.id === active ? 'is-active' : ''} onClick={() => { if (view.id !== active) onNavigate(view.path); }}>
          <Icon name={view.icon} className="size-4 shrink-0" />
          <span>{view.label}</span>
          {view.id === active && count !== undefined && <span className="bid-pool-tab-count">{count}</span>}
        </button>
      ))}
    </nav>
  );
}
