import type { ReadinessReport, UnmetCondition } from '../deals/api.js';

interface ReadinessPanelProps {
  readonly dealId: string;
  readonly report: ReadinessReport | null;
  readonly loading: boolean;
  readonly onNavigate: (path: string) => void;
}

/**
 * Shows every readiness check with the server-provided resolver copy. For
 * each unmet condition we also expose a deep-link into the deal detail —
 * approvers are routed via the Approvals queue; contract/brief resolvers
 * land on the deal and let the user drive from there. (Dedicated routes
 * for contracts/delivery brief are in R2 steps 2.21+.)
 */
export function ReadinessPanel({ dealId, report, loading, onNavigate }: ReadinessPanelProps): React.JSX.Element {
  if (loading && !report) {
    return <p className="text-xs text-app-muted">Checking readiness…</p>;
  }
  if (!report) {
    return (
      <p className="text-xs text-app-muted">
        Readiness unavailable (you may lack visibility on all dimensions).
      </p>
    );
  }
  if (report.canClose) {
    return (
      <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
        All close conditions met — ready to record win.
      </p>
    );
  }
  return (
    <ul className="space-y-2 text-xs">
      {report.unmet.map((condition) => (
        <li
          key={condition.condition}
          className="rounded-lg border border-app-border p-2"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold capitalize text-app-foreground">
              {condition.condition.replaceAll('_', ' ')}
            </span>
            <ResolveLink dealId={dealId} condition={condition} onNavigate={onNavigate} />
          </div>
          <p className="mt-1 text-app-muted">{condition.description}</p>
          <p className="mt-1 italic text-app-muted">{condition.resolver}</p>
        </li>
      ))}
    </ul>
  );
}

function ResolveLink({
  dealId,
  condition,
  onNavigate,
}: {
  dealId: string;
  condition: UnmetCondition;
  onNavigate: (path: string) => void;
}): React.JSX.Element | null {
  // For an MVP we route everything to the deal detail — the deal page hosts
  // stage / approvals / probability controls today, and will host contract
  // + brief surfaces as they land. "authority" has no deep-link because
  // the current user cannot resolve it themselves.
  if (condition.condition === 'authority') {
    return <span className="text-app-muted">Owner only</span>;
  }
  if (condition.condition === 'already_closed' || condition.condition === 'already_terminal') {
    return null;
  }
  return (
    <button
      type="button"
      onClick={() => onNavigate(`/company/sales/deals/${dealId}`)}
      className="text-app-accent underline"
    >
      Resolve
    </button>
  );
}
