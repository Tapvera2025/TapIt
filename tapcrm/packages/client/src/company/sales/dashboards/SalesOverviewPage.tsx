import { useEffect, useState } from 'react';
import { Button, Card, Page } from '../../../ui/index.js';
import { getAllCallbacks, type LeadCallback } from '../leads/api.js';
import { MyWorkPage } from '../MyWork/MyWorkPage.js';
import { ClaimsDistribution } from './ClaimsDistribution.js';
import { PoolHealth } from './PoolHealth.js';
import { getRoutingConfiguration, getTerritoryCoverage, type RoutingConfiguration, type TerritoryCoverage } from '../api.js';

interface SalesOverviewPageProps {
  isManager: boolean;
  userId: string;
  canViewLeads: boolean;
  canViewTerritories: boolean;
  canViewCallbacks: boolean;
  canForecast: boolean;
  onNavigate: (path: string) => void;
}

export function SalesOverviewPage(props: SalesOverviewPageProps): React.JSX.Element {
  if (!props.isManager) return <MyWorkPage userId={props.userId} onNavigate={props.onNavigate} />;

  return <ManagerOverview {...props} />;
}

function ManagerOverview({ isManager, canViewLeads, canViewTerritories, canViewCallbacks, canForecast, onNavigate }: SalesOverviewPageProps): React.JSX.Element {
  return (
    <Page
      eyebrow="Sales"
      title="Sales Overview"
      description="Where leads are waiting and what needs attention today."
      action={<Button onClick={() => onNavigate('/company/sales/my-work')}>Open My Work</Button>}
    >
      <div className="grid gap-5 xl:grid-cols-2">
        {canViewLeads && <PoolHealth />}
        {canViewLeads && <ClaimsDistribution />}
        {canViewTerritories && <CoverageAndRoutingCard onNavigate={onNavigate} />}
        {canViewCallbacks && <OverdueCallbacksCard onNavigate={onNavigate} />}
      </div>
      <Card className="mt-5">
        <h2 className="font-display text-lg font-bold">Go to a Sales workspace</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {canViewLeads && <Button kind="secondary" onClick={() => onNavigate('/company/sales/leads')}>Leads</Button>}
          {isManager && <Button kind="secondary" onClick={() => onNavigate('/company/sales/triage')}>Triage: leads with no owner</Button>}
          {canViewCallbacks && <Button kind="secondary" onClick={() => onNavigate('/company/sales/callbacks')}>Callbacks</Button>}
          {canForecast && <Button kind="secondary" onClick={() => onNavigate('/company/sales/reports')}>Performance reports</Button>}
          <Button kind="secondary" onClick={() => onNavigate('/company/sales/setup')}>Setup checklist</Button>
        </div>
      </Card>
    </Page>
  );
}

function CoverageAndRoutingCard({ onNavigate }: { onNavigate: (path: string) => void }): React.JSX.Element {
  const [coverage, setCoverage] = useState<TerritoryCoverage[] | null>(null);
  const [routing, setRouting] = useState<RoutingConfiguration | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    Promise.all([getTerritoryCoverage(), getRoutingConfiguration()])
      .then(([nextCoverage, nextRouting]) => {
        if (!current) return;
        setCoverage(nextCoverage);
        setRouting(nextRouting);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : 'Unable to load territory coverage.');
      });
    return () => { current = false; };
  }, []);

  const active = (coverage ?? []).filter((item) => item.territoryStatus === 'active');
  const poolCount = active.reduce((total, item) => total + item.salesPools.length, 0);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">Team coverage and routing</h2>
          <p className="mt-1 text-sm text-app-muted">Territories choose the Sales Team. Availability and workload determine agent assignment.</p>
        </div>
        <Button kind="secondary" onClick={() => onNavigate('/company/sales/territories')}>Manage coverage</Button>
      </div>
      {error && <p className="mt-3 text-sm text-app-danger" role="alert">{error}</p>}
      {coverage === null ? (
        <p className="mt-4 text-sm text-app-muted">Loading coverage…</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <MiniMetric label="Active territories" value={active.length} />
            <MiniMetric label="Sales teams" value={new Set(active.map((item) => item.salesTeamId)).size} />
            <MiniMetric label="Bid Pools" value={poolCount} />
          </div>
          <p className="mt-4 rounded-lg bg-app-background p-3 text-sm">
            Routing is <strong>{routing ? (routing.enabled ? 'on' : 'off') : 'unknown'}</strong>
            {routing?.enabled && <> · assignment strategy: <strong>{routing.assignmentStrategy.replaceAll('_', ' ')}</strong></>}
          </p>
          {active.length === 0 ? (
            <p className="mt-3 text-sm text-app-muted">No active territory rules. Territories are optional when one team covers all incoming leads.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {active.slice(0, 4).map((item) => (
                <li key={item.territoryId} className="flex flex-wrap justify-between gap-2 border-b border-app-border pb-2 last:border-0">
                  <span className="font-semibold">{item.territoryName}</span>
                  <span className="text-app-muted">{item.salesTeamName} · {item.salesPools.length} pool{item.salesPools.length === 1 ? '' : 's'}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

function OverdueCallbacksCard({ onNavigate }: { onNavigate: (path: string) => void }): React.JSX.Element {
  const [callbacks, setCallbacks] = useState<LeadCallback[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    const load = (): void => {
      getAllCallbacks({ status: 'pending' })
        .then((next) => { if (current) { setCallbacks(next); setError(null); } })
        .catch((cause: unknown) => { if (current) setError(cause instanceof Error ? cause.message : 'Unable to load callbacks.'); });
    };
    load();
    const timer = window.setInterval(load, 60_000);
    return () => { current = false; window.clearInterval(timer); };
  }, []);

  const overdue = (callbacks ?? []).filter((callback) => new Date(callback.scheduledAt).getTime() < Date.now());

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">Overdue follow-ups</h2>
          <p className="mt-1 text-sm text-app-muted">Pending callbacks whose scheduled time has passed.</p>
        </div>
        <Button kind="secondary" onClick={() => onNavigate('/company/sales/callbacks')}>Review callbacks</Button>
      </div>
      {error && <p className="mt-3 text-sm text-app-danger" role="alert">{error}</p>}
      <p className={`mt-4 font-display text-3xl font-bold ${overdue.length ? 'text-amber-700' : ''}`}>
        {callbacks === null ? '—' : overdue.length.toLocaleString()}
      </p>
      {overdue.length > 0 && (
        <ul className="mt-3 space-y-2 text-sm">
          {overdue.slice(0, 3).map((callback) => (
            <li key={callback.id} className="flex justify-between gap-3 border-t border-app-border pt-2">
              <span className="font-semibold">{callback.leadContactName} · #{callback.leadNumber}</span>
              <span className="text-app-muted">{callback.ownerName ?? 'No owner'}</span>
            </li>
          ))}
        </ul>
      )}
      {callbacks?.length === 0 && <p className="mt-2 text-sm text-app-muted">No pending callbacks. Scheduled callbacks will appear here when due.</p>}
    </Card>
  );
}

function MiniMetric({ label, value }: { label: string; value: number }): React.JSX.Element {
  return <div className="rounded-lg bg-app-background p-3"><p className="text-xs text-app-muted">{label}</p><p className="mt-1 font-display text-2xl font-bold">{value.toLocaleString()}</p></div>;
}
