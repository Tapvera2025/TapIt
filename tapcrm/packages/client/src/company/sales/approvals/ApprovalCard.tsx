import type { ApprovalRequest } from './api.js';
import {
  APPROVAL_STATE_LABELS,
  describeDimension,
  describeSla,
  exceededDimensions,
  type SlaSeverity,
} from './approvals-helpers.js';
import type { Deal } from '../deals/api.js';

const SLA_CLASSES: Record<SlaSeverity, string> = {
  ok: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  warn: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  breach: 'bg-[#d86b6b] text-white',
  overdue: 'bg-[#d86b6b] text-white',
};

export interface ApprovalCardProps {
  readonly approval: ApprovalRequest;
  readonly deal: Deal | null;
  readonly onOpen: () => void;
}

export function ApprovalCard({ approval, deal, onOpen }: ApprovalCardProps): React.JSX.Element {
  const sla = describeSla(approval.slaDueAt);
  const exceeded = exceededDimensions(approval.dimensions);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="ui-card w-full p-5 text-left hover:border-app-accent"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-lg font-bold">
            {deal ? deal.title : 'Loading deal…'}
          </p>
          <p className="mt-1 text-xs text-app-muted">
            {deal ? (
              <>
                #{deal.dealNumber} · {deal.contactName ?? '—'}
                {deal.companyName ? ` · ${deal.companyName}` : ''}
              </>
            ) : (
              approval.dealId
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${SLA_CLASSES[sla.severity]}`}>
            SLA · {sla.label}
          </span>
          <span className="rounded-full bg-app-background px-3 py-1 text-xs font-bold">
            {APPROVAL_STATE_LABELS[approval.state]}
          </span>
          {approval.escalationCount > 0 && (
            <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-bold text-amber-700 dark:text-amber-300">
              Escalated
            </span>
          )}
        </div>
      </div>
      {exceeded.length > 0 && (
        <ul className="mt-4 space-y-1 text-xs text-app-muted">
          {exceeded.map((dim, i) => (
            <li key={i}>• {describeDimension(dim)}</li>
          ))}
        </ul>
      )}
      {approval.blockedReason === 'no_eligible_approver' && (
        <p className="mt-3 rounded-lg bg-[#d86b6b]/10 p-2 text-xs text-app-danger">
          No eligible approver — ask a Super Admin to route this request.
        </p>
      )}
    </button>
  );
}
