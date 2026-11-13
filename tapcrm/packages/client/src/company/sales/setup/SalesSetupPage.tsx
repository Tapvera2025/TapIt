import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Field, Page } from '../../../ui/index.js';
import { getCompanyTeams, type CompanyTeam } from '../../api/companyApi.js';
import { getConnections, type ConnectionsPayload } from '../calls/api.js';
import { getLeadSources, type LeadSource } from '../leads/api.js';
import { getRoutingConfiguration, getTerritories, type RoutingConfiguration, type Territory, type TerritoryDimension } from '../api.js';

type StepTone = 'ready' | 'action' | 'optional' | 'restricted' | 'review';
type PreviewInput = Record<TerritoryDimension, string>;

interface SalesSetupPageProps {
  canViewOrganization: boolean;
  canViewLeads: boolean;
  canViewTerritories: boolean;
  hasTelephony: boolean;
  canManageCalls: boolean;
  canViewTriage: boolean;
  onNavigate: (path: string) => void;
}

export function SalesSetupPage(props: SalesSetupPageProps): React.JSX.Element {
  const [teams, setTeams] = useState<CompanyTeam[] | null>(null);
  const [territories, setTerritories] = useState<Territory[] | null>(null);
  const [routing, setRouting] = useState<RoutingConfiguration | null>(null);
  const [sources, setSources] = useState<LeadSource[] | null>(null);
  const [connections, setConnections] = useState<ConnectionsPayload | null>(null);
  const [teamError, setTeamError] = useState('');
  const [territoryError, setTerritoryError] = useState('');
  const [sourceError, setSourceError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [preview, setPreview] = useState<PreviewInput>({ geography: '', industry: '', product: '', lead_source: '' });

  useEffect(() => {
    let current = true;
    if (props.canViewOrganization) {
      getCompanyTeams().then((value) => { if (current) setTeams(value); })
        .catch((cause: unknown) => { if (current) setTeamError(errorText(cause, 'Unable to check Sales teams.')); });
    }
    if (props.canViewTerritories) {
      Promise.all([getTerritories(), getRoutingConfiguration()])
        .then(([nextTerritories, nextRouting]) => { if (current) { setTerritories(nextTerritories); setRouting(nextRouting); } })
        .catch((cause: unknown) => { if (current) setTerritoryError(errorText(cause, 'Unable to check territory routing.')); });
    }
    if (props.canViewLeads) {
      getLeadSources().then((value) => { if (current) setSources(value); })
        .catch((cause: unknown) => { if (current) setSourceError(errorText(cause, 'Unable to check lead sources.')); });
    }
    if (props.hasTelephony && props.canManageCalls) {
      getConnections().then((value) => { if (current) setConnections(value); })
        .catch((cause: unknown) => { if (current) setConnectionError(errorText(cause, 'Unable to check calling connections.')); });
    }
    return () => { current = false; };
  }, [props.canViewOrganization, props.canViewLeads, props.canViewTerritories, props.hasTelephony, props.canManageCalls]);

  const salesTeams = teams?.filter((team) => team.kind === 'sales-team') ?? [];
  const salesPools = teams?.filter((team) => team.kind === 'sales-pool') ?? [];
  const hasSalesTeam = salesTeams.length > 0;
  const activeSources = sources?.filter((source) => source.status === 'active') ?? [];
  const activeConnections = connections?.connections.filter((connection) => connection.status === 'active') ?? [];
  const connectedConnections = connections?.connections.filter((connection) => connection.status !== 'disconnected') ?? [];
  const territoryActive = territories?.some((territory) => territory.status === 'active') ?? false;
  const selectedTerritory = useMemo(() => previewTerritory(territories ?? [], preview), [territories, preview]);

  return (
    <Page
      eyebrow="Sales · Setup"
      title="Sales setup checklist"
      description="Set up coverage and lead follow-up in order. This checklist reads your current configuration and won’t change it."
    >
      <div className="grid gap-4 xl:grid-cols-2">
        <SetupStep
          number="1"
          title="Create a Sales Team and optional pool"
          tone={!props.canViewOrganization ? 'restricted' : teamError ? 'action' : teams === null ? 'review' : hasSalesTeam ? 'ready' : 'action'}
          status={!props.canViewOrganization ? 'Admin access needed' : teamError ? 'Could not check teams' : teams === null ? 'Checking teams…' : hasSalesTeam ? `${salesTeams.length} team${salesTeams.length === 1 ? '' : 's'} found` : 'Create a Sales Team first'}
          detail="A Sales Team owns market coverage. Add a child Sales Pool if agents should claim shared inbound leads."
          error={teamError}
          action={props.canViewOrganization ? { label: 'Open Teams', path: '/company/organization/teams' } : undefined}
          onNavigate={props.onNavigate}
        >
          {teams && <p className="mt-3 text-xs text-app-muted">{salesPools.length} child pool{salesPools.length === 1 ? '' : 's'} found.</p>}
        </SetupStep>

        <SetupStep
          number="2"
          title="Add agents and check availability"
          tone={!props.canViewOrganization ? 'restricted' : teamError ? 'action' : teams === null ? 'review' : hasSalesTeam ? 'review' : 'action'}
          status={!props.canViewOrganization ? 'Admin access needed' : teamError ? 'Check team setup' : teams === null ? 'Checking team prerequisite…' : hasSalesTeam ? 'Review with your team' : 'Create a Sales Team first'}
          detail={teams !== null && !hasSalesTeam ? 'Create a Sales Team first, then add agents and check their availability. For automatic assignment, agents must be active and punched in to an eligible shift.' : 'Add the right people to the Sales Team and pool. For automatic assignment, agents must be active and punched in to an eligible shift.'}
          action={props.canViewOrganization ? { label: teams === null || teamError ? 'Open Teams' : hasSalesTeam ? 'Review team members' : 'Create a Sales Team first', path: '/company/organization/teams' } : undefined}
          onNavigate={props.onNavigate}
        />

        <SetupStep
          number="3"
          title="Choose territory rules and routing"
          tone={!props.canViewTerritories ? 'restricted' : territoryError ? 'action' : territories === null ? 'review' : routing?.enabled === false ? 'action' : territoryActive ? 'ready' : 'optional'}
          status={!props.canViewTerritories ? 'Territory access needed' : territoryError ? 'Could not check routing' : territories === null ? 'Checking routing…' : routing?.enabled === false ? 'Routing is off' : territoryActive ? 'Routing is on' : 'Optional'}
          detail={teams !== null && !hasSalesTeam ? 'Create a Sales Team first; each territory routes to a Sales Team. If one team handles every lead, you can skip territories.' : 'Territories send matching inbound leads to a Sales Team. If one team handles every lead, you can skip territories.'}
          error={territoryError}
          action={props.canViewTerritories ? { label: 'Open Territories', path: '/company/sales/territories' } : undefined}
          onNavigate={props.onNavigate}
        >
          {routing && <p className="mt-3 text-xs text-app-muted">Current strategy: {routing.assignmentStrategy.replaceAll('_', ' ')}.</p>}
        </SetupStep>

        <SetupStep
          number="4"
          title="Create lead source labels"
          tone={!props.canViewLeads ? 'restricted' : sourceError ? 'action' : sources === null ? 'review' : activeSources.length ? 'ready' : 'action'}
          status={!props.canViewLeads ? 'Lead access needed' : sourceError ? 'Could not check sources' : sources === null ? 'Checking sources…' : activeSources.length ? `${activeSources.length} active source${activeSources.length === 1 ? '' : 's'}` : 'Add a source'}
          detail="Sources label leads such as Website, Referral, or JustCall. Creating a label does not connect that external service; provider intake must already be configured."
          error={sourceError}
          action={props.canViewLeads ? { label: 'Open Leads and sources', path: '/company/sales/leads' } : undefined}
          onNavigate={props.onNavigate}
        />

        <SetupStep
          number="5"
          title="Connect JustCall or Aircall (optional)"
          tone={!props.hasTelephony ? 'optional' : !props.canManageCalls ? 'restricted' : connectionError ? 'action' : connections === null ? 'review' : activeConnections.length ? 'ready' : connectedConnections.length ? 'action' : 'action'}
          status={!props.hasTelephony ? 'Call analytics not enabled' : !props.canManageCalls ? 'Admin access needed' : connectionError ? 'Could not check providers' : connections === null ? 'Checking providers…' : activeConnections.length ? `${activeConnections.length} provider${activeConnections.length === 1 ? '' : 's'} connected` : connectedConnections.length ? 'Provider needs attention' : 'Connect a provider'}
          detail={!props.hasTelephony ? 'Call analytics is not enabled for this company. Ask a Super Admin to enable the telephony module if your team needs JustCall or Aircall analytics.' : 'The existing integration syncs call analytics and matches provider users to employees. It does not automatically create callbacks from missed calls.'}
          error={connectionError}
          action={props.canManageCalls ? { label: 'Open Call Integrations', path: '/company/sales/call-integrations' } : undefined}
          onNavigate={props.onNavigate}
        >
          {connections && <p className="mt-3 text-xs text-app-muted">{connections.connections.reduce((total, connection) => total + connection.unmatchedAgentCount, 0)} provider user(s) still need an employee match.</p>}
        </SetupStep>
      </div>

      <Card className="mt-5">
        <h2 className="font-display text-xl font-bold">Preview where an inbound lead would go</h2>
        <p className="mt-1 max-w-3xl text-sm text-app-muted">This preview uses the active territory rules currently loaded in the CRM. It shows a Sales Team, not the final agent; agent assignment depends on the live routing and availability checks.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Geography" value={preview.geography} onChange={(value) => setPreview((current) => ({ ...current, geography: value }))} placeholder="e.g. Pune" />
          <Field label="Industry" value={preview.industry} onChange={(value) => setPreview((current) => ({ ...current, industry: value }))} placeholder="e.g. Healthcare" />
          <Field label="Product or service" value={preview.product} onChange={(value) => setPreview((current) => ({ ...current, product: value }))} placeholder="e.g. Consulting" />
          <Field label="Lead source" value={preview.lead_source} onChange={(value) => setPreview((current) => ({ ...current, lead_source: value }))} placeholder="e.g. Website" />
        </div>
        <div className="mt-5 rounded-xl border border-app-border bg-app-background p-4" aria-live="polite">
          {territories === null ? (
            <p className="text-sm text-app-muted">{props.canViewTerritories ? (territoryError || 'Loading territory rules…') : 'Ask an administrator with territory access to preview routing.'}</p>
          ) : routing?.enabled === false ? (
            <p className="text-sm"><strong>Automatic territory routing is off.</strong> Turn it on in Territories to use these rules.</p>
          ) : selectedTerritory ? (
            <p className="text-sm"><strong>{selectedTerritory.name}</strong> matches and routes to <strong>{selectedTerritory.salesTeamName}</strong>. The agent is selected separately using the current assignment rules.</p>
          ) : territories.some((territory) => territory.status === 'active') ? (
            <p className="text-sm"><strong>No active territory matches these details.</strong> Review the rules or check the lead after it arrives; this preview does not create or route a lead.</p>
          ) : (
            <p className="text-sm"><strong>No active territories are configured.</strong> Territory rules are optional; default eligible-agent routing may still apply.</p>
          )}
        </div>
      </Card>

      <Card className="mt-5">
        <h2 className="font-display text-xl font-bold">Check a real inbound assignment</h2>
        <p className="mt-2 max-w-3xl text-sm text-app-muted">Submit a clearly labelled test enquiry through the website or provider that feeds your CRM, then open it in Leads or the Bid Pool and confirm its Sales Team and owner. A lead created manually inside the CRM follows the manual-entry path, so it doesn’t verify inbound routing.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {props.canViewLeads && <Button kind="secondary" onClick={() => props.onNavigate('/company/sales/leads')}>Review Leads</Button>}
          {props.canViewLeads && <Button kind="secondary" onClick={() => props.onNavigate('/company/sales/bid-pool')}>Review Bid Pool</Button>}
          {props.canViewTriage && <Button kind="secondary" onClick={() => props.onNavigate('/company/sales/triage')}>Review Triage</Button>}
        </div>
      </Card>
    </Page>
  );
}

function SetupStep({
  number,
  title,
  tone,
  status,
  detail,
  error,
  action,
  onNavigate,
  children,
}: {
  number: string;
  title: string;
  tone: StepTone;
  status: string;
  detail: string;
  error?: string;
  action?: { label: string; path: string } | undefined;
  onNavigate: (path: string) => void;
  children?: React.ReactNode;
}): React.JSX.Element {
  const badge = {
    ready: 'bg-app-success/10 text-app-success',
    action: 'bg-amber-500/15 text-amber-800',
    optional: 'bg-app-surface-raised text-app-muted',
    restricted: 'bg-app-surface-raised text-app-muted',
    review: 'bg-app-accent/10 text-app-accent',
  }[tone];
  return (
    <Card>
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-app-background font-bold">{number}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-bold">{title}</h2>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badge}`}>{status}</span>
          </div>
          <p className="mt-2 text-sm text-app-muted">{detail}</p>
          {error && <p className="mt-2 text-xs text-app-danger" role="alert">{error}</p>}
          {children}
          {action && <Button className="mt-4" kind="secondary" onClick={() => onNavigate(action.path)}>{action.label}</Button>}
        </div>
      </div>
    </Card>
  );
}

function previewTerritory(territories: readonly Territory[], input: PreviewInput): Territory | null {
  const normalize = (value: string | null | undefined): string => value?.trim().toLocaleLowerCase() ?? '';
  const matches = (territory: Territory): boolean => territory.status === 'active' && territory.rules.every((rule) => {
    const key = rule.dimension === 'lead_source' ? 'lead_source' : rule.dimension;
    return normalize(input[key]) !== '' && normalize(input[key]) === normalize(rule.value);
  });
  return territories.filter(matches).sort((a, b) => b.rules.length - a.rules.length || a.id.localeCompare(b.id))[0] ?? null;
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}
