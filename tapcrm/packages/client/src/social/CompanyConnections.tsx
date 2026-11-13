import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Card, Modal, Notice, SkeletonTable } from '../ui/index.js';
import { Icon } from '../ui/index.js';
import {
  assignCompanyLocation,
  completeCompanyConnection,
  disconnectCompanyConnection,
  listCompanyConnections,
  listCompanyLocations,
  startCompanyConnection,
  syncCompanyConnection,
} from './api.js';
import { ClientSelector } from './ClientSelector.js';
import { PlatformMark, PostStatus, SocialEmpty } from './presentation.js';
import {
  ASSET_LABELS,
  COMPANY_LOGIN_LABELS,
  SOCIAL_COMPANY_PLATFORMS,
  type SocialClient,
  type SocialCompanyAssetPlatform,
  type SocialCompanyConnection,
  type SocialCompanyLocation,
  type SocialCompanyPlatform,
  type SocialProvider,
} from './types.js';

/**
 * Company logins: the company signs in ONCE with each login its team uses — a
 * Google account, a Facebook login, a LinkedIn member, a YouTube channel — and
 * every Business Profile, Facebook Page, Instagram account, LinkedIn page,
 * channel and Search Console property that login manages can be assigned to a
 * CRM client. Nobody signs in again for each client.
 */

const searchInput =
  'w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm placeholder:text-app-muted focus:outline-none focus:ring-2 focus:ring-app-accent disabled:opacity-50';

/** How a location is named in sentences. */
const ASSET_NOUNS: Record<SocialCompanyAssetPlatform, string> = {
  google_business: 'Business Profile',
  facebook: 'Facebook Page',
  instagram: 'Instagram account',
  linkedin: 'LinkedIn page',
  youtube: 'YouTube channel',
  search_console: 'Search Console property',
};
/** Where a revoked platform grant is removed by hand. */
const ACCESS_SETTINGS: Record<SocialCompanyPlatform, string> = {
  google_business: 'your Google Account settings',
  facebook: 'your Facebook settings (Business Integrations)',
  linkedin: 'your LinkedIn settings (Permitted services)',
  youtube: 'your Google Account settings',
};

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}
function when(value: string | null): string {
  return value
    ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
    : 'never';
}
function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}
function isCompanyPlatform(value: unknown): value is SocialCompanyPlatform {
  return SOCIAL_COMPANY_PLATFORMS.some((platform) => platform === value);
}
function connectionName(connection: SocialCompanyConnection): string {
  return (
    connection.accountEmail ??
    connection.accountName ??
    COMPANY_LOGIN_LABELS[connection.platform].account
  );
}
function readOnly(location: SocialCompanyLocation): boolean {
  return location.platform === 'search_console';
}

async function openSignIn(platform: SocialCompanyPlatform): Promise<void> {
  const result = await startCompanyConnection(platform);
  const url = new URL(result.authorizationUrl);
  if (url.protocol !== 'https:')
    throw new Error('The platform returned an invalid authorization URL.');
  window.location.assign(url.href);
}

/** A company sign-in the platform just sent back. Completing it is single-use, and
 * React runs effects twice in development, so the first run's request is kept
 * here and awaited by whichever run loads the page. */
let completion: Promise<void> | null = null;
function completeReturnedSignIn(): Promise<void> {
  if (window.location.hash.startsWith('#social-oauth=')) {
    const raw = window.location.hash.slice('#social-oauth='.length);
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${window.location.search}`,
    );
    completion = (async () => {
      const payload = JSON.parse(decodeURIComponent(raw)) as Record<string, unknown>;
      if (payload['scope'] !== 'company')
        throw new Error(
          'This sign-in was started from a client page. Start it there again.',
        );
      if (typeof payload['error'] === 'string')
        throw new Error(
          typeof payload['message'] === 'string'
            ? payload['message']
            : 'The platform did not authorize this connection.',
        );
      const platform = payload['platform'];
      const code = payload['code'];
      const state = payload['state'];
      if (
        !isCompanyPlatform(platform) ||
        typeof code !== 'string' ||
        typeof state !== 'string'
      )
        throw new Error('The platform returned an incomplete authorization response.');
      const connection = await completeCompanyConnection(platform, code, state);
      toast.success(
        `Connected ${connectionName(connection)}: ${plural(connection.locationCount, 'item')} found.`,
      );
    })().catch((cause: unknown) => {
      toast.error(errorText(cause, 'The sign-in could not be completed.'));
    });
  }
  return completion ?? Promise.resolve();
}

/** One entry per platform item, so two logins that manage the same Page suggest it once. */
function pendingSuggestions(
  locations: Record<string, SocialCompanyLocation[]>,
): SocialCompanyLocation[] {
  const seen = new Set<string>();
  const pending: SocialCompanyLocation[] = [];
  for (const location of Object.values(locations).flat()) {
    const key = `${location.platform}:${location.externalId}`;
    if (!location.suggestion || location.assignment || seen.has(key)) continue;
    seen.add(key);
    pending.push(location);
  }
  return pending;
}

export function CompanyConnections({
  providers,
  onChanged,
}: {
  providers: SocialProvider[];
  /** Assignments changed, so a client's account list may be stale. */
  onChanged?: () => void;
}): React.JSX.Element {
  const [connections, setConnections] = useState<SocialCompanyConnection[] | null>(null);
  const [locations, setLocations] = useState<Record<string, SocialCompanyLocation[]>>({});
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [search, setSearch] = useState('');
  const [assigning, setAssigning] = useState<SocialCompanyLocation | null>(null);
  const [unassigning, setUnassigning] = useState<SocialCompanyLocation | null>(null);
  const [disconnecting, setDisconnecting] = useState<SocialCompanyConnection | null>(
    null,
  );
  const [revokeGrant, setRevokeGrant] = useState(false);
  const readiness = (platform: SocialCompanyPlatform) =>
    providers.find((item) => item.platform === platform);
  const notReady = SOCIAL_COMPANY_PLATFORMS.flatMap((platform) => {
    const provider = readiness(platform);
    return provider && provider.status !== 'ready' ? [{ platform, provider }] : [];
  });
  const pending = useMemo(() => pendingSuggestions(locations), [locations]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await completeReturnedSignIn();
        const list = await listCompanyConnections();
        const entries = await Promise.all(
          list.map(
            async (item) => [item.id, await listCompanyLocations(item.id)] as const,
          ),
        );
        if (cancelled) return;
        setConnections(list);
        setLocations(Object.fromEntries(entries));
      } catch (cause) {
        if (cancelled) return;
        setError(errorText(cause, 'Unable to load company connections.'));
        setConnections((current) => current ?? []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [revision]);

  async function connect(platform: SocialCompanyPlatform): Promise<void> {
    setBusy(`connect:${platform}`);
    setError('');
    try {
      await openSignIn(platform);
    } catch (cause) {
      setError(errorText(cause, 'Unable to start the sign-in.'));
      setBusy('');
    }
  }
  async function refresh(connection: SocialCompanyConnection): Promise<void> {
    setBusy(connection.id);
    setError('');
    try {
      const updated = await syncCompanyConnection(connection.id);
      toast.success(`${plural(updated.locationCount, 'item')} found.`);
    } catch (cause) {
      setError(errorText(cause, 'Unable to refresh this login.'));
    } finally {
      setBusy('');
      setRevision((value) => value + 1);
    }
  }
  /** Moving a location between clients is asked for explicitly (`move`): the server
   * never moves one silently, because the old client's scheduled posts are cancelled.
   * It happens in one step, so a refused move leaves the old client assigned. */
  async function assign(
    location: SocialCompanyLocation,
    client: { id: string; name: string } | null,
  ): Promise<void> {
    setBusy(location.id);
    setError('');
    try {
      const move = Boolean(
        client &&
        location.assignment?.via === 'company_connection' &&
        location.assignment.clientId !== client.id,
      );
      await assignCompanyLocation(
        location.connectionId,
        location.id,
        client?.id ?? null,
        move,
      );
      toast.success(
        client
          ? `${location.name} assigned to ${client.name}`
          : `${location.name} unassigned`,
      );
      setAssigning(null);
      setUnassigning(null);
      onChanged?.();
    } catch (cause) {
      toast.error(errorText(cause, 'Unable to change this assignment.'));
    } finally {
      setBusy('');
      setRevision((value) => value + 1);
    }
  }
  /** Every suggestion, one after another. One that fails is reported and skipped. */
  async function acceptAll(): Promise<void> {
    setBusy('accept-all');
    setError('');
    let accepted = 0;
    const failed: string[] = [];
    for (const location of pending) {
      if (!location.suggestion) continue;
      try {
        await assignCompanyLocation(
          location.connectionId,
          location.id,
          location.suggestion.clientId,
        );
        accepted += 1;
      } catch (cause) {
        failed.push(`${location.name}: ${errorText(cause, 'not assigned')}`);
      }
    }
    if (accepted) {
      toast.success(`${plural(accepted, 'suggestion')} accepted`);
      onChanged?.();
    }
    if (failed.length)
      setError(`Some suggestions were not accepted. ${failed.join(' ')}`);
    setBusy('');
    setRevision((value) => value + 1);
  }
  async function disconnect(): Promise<void> {
    if (!disconnecting) return;
    setBusy(disconnecting.id);
    setError('');
    try {
      const result = await disconnectCompanyConnection(disconnecting.id, revokeGrant);
      if (result.revocationStatus === 'remove_access_in_platform_settings')
        toast(
          `TapIt deleted its copy of the sign-in. To remove access completely, remove TapIt in ${ACCESS_SETTINGS[disconnecting.platform]}.`,
        );
      if (result.othersNeedReconnect)
        toast(
          `${result.othersNeedReconnect} client connection${result.othersNeedReconnect === 1 ? '' : 's'} signed in with the same login lost access too and now need${result.othersNeedReconnect === 1 ? 's' : ''} a reconnect.`,
        );
      toast.success(`${connectionName(disconnecting)} disconnected`);
      setDisconnecting(null);
      onChanged?.();
    } catch (cause) {
      setError(errorText(cause, 'Unable to disconnect this login.'));
    } finally {
      setBusy('');
      setRevision((value) => value + 1);
    }
  }

  return (
    <div className="space-y-5">
      {error && <Notice error>{error}</Notice>}
      <Card>
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-app-accent/10 text-app-accent">
            <Icon name="building" />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold">Connect your team’s logins once</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-app-muted">
              Sign in with each Google, Facebook, LinkedIn or YouTube login your team uses
              for clients. TapIt lists everything each login manages — Business Profiles,
              Facebook Pages, Instagram accounts, LinkedIn pages, YouTube channels and
              Search Console properties. Then you choose which client each one belongs to.
              Nobody signs in again for each client.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {SOCIAL_COMPANY_PLATFORMS.map((platform) => (
            <Button
              key={platform}
              kind="secondary"
              disabled={readiness(platform)?.status !== 'ready' || Boolean(busy)}
              title={`Lists ${COMPANY_LOGIN_LABELS[platform].lists}`}
              onClick={() => void connect(platform)}
              className="inline-flex items-center gap-2"
            >
              <PlatformMark platform={platform} small />
              {busy === `connect:${platform}`
                ? 'Opening sign-in…'
                : `Connect ${COMPANY_LOGIN_LABELS[platform].connect}`}
            </Button>
          ))}
        </div>
        <p className="mt-3 max-w-3xl text-xs leading-5 text-app-muted">
          New client? Ask them to add your login as a Manager of their Business Profile,
          an admin of their Facebook Page or LinkedIn page, or a user of their Search
          Console property. Then click Refresh on that login. A YouTube channel is signed
          in on its own: choose the channel on Google’s screen.
        </p>
        {notReady.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs leading-5 text-amber-700 dark:text-amber-200">
            {notReady.map(({ platform, provider }) => (
              <li key={platform}>
                <strong>{COMPANY_LOGIN_LABELS[platform].connect}:</strong>{' '}
                {provider.message}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {pending.length > 0 && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-48 flex-1">
              <h3 className="font-semibold">
                {plural(pending.length, 'suggested assignment')}
              </h3>
              <p className="mt-1 text-xs leading-5 text-app-muted">
                Matched by website or by name, only where exactly one client fits. Check
                the list below, then accept them together.
              </p>
            </div>
            <Button disabled={Boolean(busy)} onClick={() => void acceptAll()}>
              {busy === 'accept-all'
                ? 'Assigning…'
                : `Accept all ${pending.length} suggestion${pending.length === 1 ? '' : 's'}`}
            </Button>
          </div>
        </Card>
      )}
      {connections === null ? (
        <SkeletonTable columns={4} rows={4} />
      ) : connections.length === 0 ? (
        <Card>
          <SocialEmpty
            title="No company logins connected"
            description="Connect the logins your team uses to manage your clients’ Pages, profiles, channels and Search Console properties."
          />
        </Card>
      ) : (
        <>
          <input
            type="search"
            placeholder="Search pages, profiles, properties or clients…"
            aria-label="Search pages, profiles, properties or clients"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={`${searchInput} max-w-md`}
          />
          {connections.map((connection) => (
            <ConnectionCard
              key={connection.id}
              connection={connection}
              locations={locations[connection.id] ?? []}
              busy={busy}
              search={search}
              onRefresh={() => void refresh(connection)}
              onReconnect={() => void connect(connection.platform)}
              onDisconnect={() => {
                setRevokeGrant(false);
                setDisconnecting(connection);
              }}
              onAssign={setAssigning}
              onUnassign={setUnassigning}
              onAccept={(location) => {
                if (location.suggestion)
                  void assign(location, {
                    id: location.suggestion.clientId,
                    name: location.suggestion.clientName,
                  });
              }}
              onUseCompanyConnection={(location) => {
                if (location.assignment)
                  void assign(location, {
                    id: location.assignment.clientId,
                    name: location.assignment.clientName,
                  });
              }}
            />
          ))}
        </>
      )}
      {assigning && (
        <AssignClientModal
          location={assigning}
          busy={busy === assigning.id}
          onClose={() => setAssigning(null)}
          onConfirm={(client) => void assign(assigning, client)}
        />
      )}
      {unassigning?.assignment && (
        <Modal
          title={`Unassign ${ASSET_NOUNS[unassigning.platform]}`}
          dirty={false}
          onClose={() => setUnassigning(null)}
        >
          <p className="text-sm leading-6">
            Unassign {unassigning.name} from {unassigning.assignment.clientName}?{' '}
            {readOnly(unassigning)
              ? 'Its Search Console data stops showing for this client.'
              : `Their scheduled posts to it are cancelled. Published posts stay on ${ASSET_LABELS[unassigning.platform]}.`}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              kind="danger"
              disabled={Boolean(busy)}
              onClick={() => void assign(unassigning, null)}
            >
              Unassign
            </Button>
            <Button
              kind="secondary"
              disabled={Boolean(busy)}
              onClick={() => setUnassigning(null)}
            >
              Keep it
            </Button>
          </div>
        </Modal>
      )}
      {disconnecting && (
        <Modal
          title={`Disconnect ${COMPANY_LOGIN_LABELS[disconnecting.platform].account}`}
          dirty={false}
          onClose={() => setDisconnecting(null)}
        >
          <p className="text-sm leading-6">
            Disconnect {connectionName(disconnecting)}?{' '}
            {disconnecting.assignedCount
              ? `Its ${plural(disconnecting.assignedCount, 'assignment')} will be removed from their clients, and their scheduled posts cancelled.`
              : 'No client uses anything from it right now.'}
          </p>
          <label className="mt-4 flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={revokeGrant}
              onChange={(event) => setRevokeGrant(event.target.checked)}
            />
            <span>
              Also remove TapIt’s access on the platform. This also ends any other TapIt
              connection made with this login.
            </span>
          </label>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              kind="danger"
              disabled={Boolean(busy)}
              onClick={() => void disconnect()}
            >
              Disconnect
            </Button>
            <Button
              kind="secondary"
              disabled={Boolean(busy)}
              onClick={() => setDisconnecting(null)}
            >
              Keep connected
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ConnectionCard({
  connection,
  locations,
  busy,
  search,
  onRefresh,
  onReconnect,
  onDisconnect,
  onAssign,
  onUnassign,
  onAccept,
  onUseCompanyConnection,
}: {
  connection: SocialCompanyConnection;
  locations: SocialCompanyLocation[];
  busy: string;
  search: string;
  onRefresh: () => void;
  onReconnect: () => void;
  onDisconnect: () => void;
  onAssign: (location: SocialCompanyLocation) => void;
  onUnassign: (location: SocialCompanyLocation) => void;
  onAccept: (location: SocialCompanyLocation) => void;
  onUseCompanyConnection: (location: SocialCompanyLocation) => void;
}): React.JSX.Element {
  const term = search.trim().toLowerCase();
  const visible = locations.filter(
    (location) =>
      !term ||
      [
        location.name,
        location.address ?? '',
        location.detail ?? '',
        location.assignment?.clientName ?? '',
        location.suggestion?.clientName ?? '',
        ASSET_LABELS[location.platform],
      ].some((text) => text.toLowerCase().includes(term)),
  );
  const needsReconnect = connection.status === 'reconnect_required';
  const login = COMPANY_LOGIN_LABELS[connection.platform];
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <PlatformMark platform={connection.platform} />
        <div className="min-w-40 flex-1">
          <h3 className="font-semibold">{connectionName(connection)}</h3>
          <p className="mt-1 text-xs text-app-muted">
            {login.account} · Connected
            {connection.connectedByName
              ? ` by ${connection.connectedByName}`
              : ''} on {when(connection.connectedAt)} · Refreshed{' '}
            {when(connection.lastDiscoveredAt)}
          </p>
        </div>
        <PostStatus status={connection.status} />
        <div className="flex flex-wrap gap-2">
          {needsReconnect ? (
            <Button disabled={Boolean(busy)} onClick={onReconnect}>
              Reconnect
            </Button>
          ) : (
            <Button kind="secondary" disabled={Boolean(busy)} onClick={onRefresh}>
              <Icon name="refresh" className="mr-2 inline size-4" />
              {busy === connection.id ? 'Refreshing…' : 'Refresh'}
            </Button>
          )}
          <Button kind="danger" disabled={Boolean(busy)} onClick={onDisconnect}>
            Disconnect
          </Button>
        </div>
      </div>
      {needsReconnect && (
        <div className="mt-4">
          <Notice error>
            The platform stopped accepting this sign-in. Click Reconnect and sign in with{' '}
            {connection.accountEmail ?? connection.accountName ?? 'the same login'}. Until
            then, posts to everything it serves fail.
          </Notice>
        </div>
      )}
      {!needsReconnect && connection.lastError && (
        <p className="mt-3 text-xs text-app-danger">{connection.lastError}</p>
      )}
      <p className="mt-5 text-sm text-app-muted">
        <strong className="text-app-foreground">{connection.locationCount}</strong>{' '}
        {connection.locationCount === 1 ? 'item' : 'items'} ·{' '}
        <strong className="text-app-foreground">{connection.assignedCount}</strong>{' '}
        assigned to clients
      </p>
      {locations.length === 0 ? (
        <SocialEmpty
          title="Nothing found yet"
          description={`This login does not manage any ${login.lists} yet. Ask your clients to give it access, then refresh.`}
        />
      ) : (
        <ul className="mt-4 divide-y divide-app-border">
          {visible.map((location) => {
            const assignment = location.assignment;
            const suggestion = location.suggestion;
            const disabled = Boolean(busy) || needsReconnect;
            const missing = location.status === 'missing';
            return (
              <li
                key={location.id}
                className="flex flex-wrap items-center gap-3 py-4 first:pt-0 last:pb-0"
              >
                <PlatformMark platform={location.platform} small />
                <div className="min-w-48 flex-1">
                  <p className="text-sm font-semibold">{location.name}</p>
                  <p className="mt-1 text-xs text-app-muted">
                    {[ASSET_LABELS[location.platform], location.detail, location.address]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-3 text-[11px] text-app-muted">
                    {location.websiteUrl && (
                      <a
                        href={location.websiteUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="hover:text-app-accent"
                      >
                        Website
                      </a>
                    )}
                    {location.mapsUrl && (
                      <a
                        href={location.mapsUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="hover:text-app-accent"
                      >
                        Google Maps
                      </a>
                    )}
                    {missing && (
                      <span className="text-app-danger">
                        No longer managed by this login
                      </span>
                    )}
                  </p>
                </div>
                <div className="min-w-40 text-sm">
                  {assignment ? (
                    <>
                      <span className="block font-semibold">{assignment.clientName}</span>
                      <span className="block text-xs text-app-muted">
                        {assignment.via === 'client_connection'
                          ? 'Uses the client’s own sign-in'
                          : assignment.status === 'connected'
                            ? 'Assigned'
                            : 'Waiting for reconnect'}
                      </span>
                    </>
                  ) : suggestion ? (
                    <>
                      <span className="block font-semibold">
                        {suggestion.clientName}?
                      </span>
                      <span className="block text-xs text-app-muted">
                        Suggested · {suggestion.reason === 'website' ? 'website' : 'name'}{' '}
                        matches
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-app-muted">Not assigned</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {assignment?.via === 'client_connection' ? (
                    <Button
                      kind="secondary"
                      disabled={disabled || missing}
                      onClick={() => onUseCompanyConnection(location)}
                    >
                      {busy === location.id ? 'Saving…' : 'Use company login'}
                    </Button>
                  ) : assignment ? (
                    <>
                      <Button
                        kind="secondary"
                        disabled={disabled || missing}
                        onClick={() => onAssign(location)}
                      >
                        Change client
                      </Button>
                      <Button
                        kind="danger"
                        disabled={Boolean(busy)}
                        onClick={() => onUnassign(location)}
                      >
                        Unassign
                      </Button>
                    </>
                  ) : (
                    <>
                      {suggestion && (
                        <Button
                          disabled={disabled || missing}
                          onClick={() => onAccept(location)}
                        >
                          {busy === location.id ? 'Assigning…' : 'Accept'}
                        </Button>
                      )}
                      <Button
                        kind="secondary"
                        disabled={disabled || missing}
                        onClick={() => onAssign(location)}
                      >
                        {suggestion ? 'Choose another' : 'Assign to client'}
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
          {visible.length === 0 && (
            <li className="py-6 text-center text-sm text-app-muted">
              Nothing matches “{search}”
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}

function AssignClientModal({
  location,
  busy,
  onClose,
  onConfirm,
}: {
  location: SocialCompanyLocation;
  busy: boolean;
  onClose: () => void;
  onConfirm: (client: { id: string; name: string }) => void;
}): React.JSX.Element {
  const [client, setClient] = useState<SocialClient | null>(null);
  const current = location.assignment;
  return (
    <Modal
      title={`Assign ${location.name}`}
      dirty={false}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="space-y-4">
        <p className="text-sm leading-6 text-app-muted">
          Choose the CRM client this {ASSET_NOUNS[location.platform]} belongs to.{' '}
          {readOnly(location)
            ? 'Its Search Console data then shows for that client.'
            : 'Their posts can then be published to it.'}
        </p>
        {current && (
          <Notice>
            It is assigned to {current.clientName} now.{' '}
            {readOnly(location)
              ? 'Moving it stops showing its data there.'
              : `Moving it cancels their scheduled posts to it. Published posts stay on ${ASSET_LABELS[location.platform]}.`}
          </Notice>
        )}
        <div className="min-h-80">
          <ClientSelector
            selected={client}
            onSelect={setClient}
            label="Assign to client"
            placeholder="Search your CRM clients"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!client || busy || client.id === current?.clientId}
            onClick={() => {
              if (client)
                onConfirm({
                  id: client.id,
                  name: client.businessName || client.clientName,
                });
            }}
          >
            {busy ? 'Saving…' : 'Assign'}
          </Button>
          <Button kind="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** From a client's Connected Accounts: assign something a company login manages. */
export function AssignLocationModal({
  clientId,
  clientName,
  onClose,
  onAssigned,
  onOpenConnections,
}: {
  clientId: string;
  clientName: string;
  onClose: () => void;
  onAssigned: () => void;
  onOpenConnections: () => void;
}): React.JSX.Element {
  const [items, setItems] = useState<SocialCompanyLocation[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    let cancelled = false;
    void listCompanyConnections()
      .then((connections) =>
        Promise.all(connections.map((connection) => listCompanyLocations(connection.id))),
      )
      .then((lists) => {
        if (!cancelled) setItems(lists.flat());
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(errorText(cause, 'Unable to load your company’s logins.'));
        setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  // Free items, plus this client's own sign-ins that can move to a company login.
  // Those suggested for this client come first.
  const candidates = (items ?? [])
    .filter(
      (location) =>
        location.status === 'available' &&
        (!location.assignment ||
          (location.assignment.via === 'client_connection' &&
            location.assignment.clientId === clientId)),
    )
    .sort(
      (left, right) =>
        Number(right.suggestion?.clientId === clientId) -
        Number(left.suggestion?.clientId === clientId),
    );
  const term = search.trim().toLowerCase();
  const visible = candidates.filter(
    (location) =>
      !term ||
      location.name.toLowerCase().includes(term) ||
      (location.address ?? '').toLowerCase().includes(term) ||
      ASSET_LABELS[location.platform].toLowerCase().includes(term),
  );
  async function assign(location: SocialCompanyLocation): Promise<void> {
    setBusy(location.id);
    setError('');
    try {
      await assignCompanyLocation(location.connectionId, location.id, clientId);
      toast.success(`${location.name} assigned to ${clientName}`);
      onAssigned();
    } catch (cause) {
      setError(errorText(cause, 'Unable to assign this.'));
    } finally {
      setBusy('');
    }
  }
  return (
    <Modal
      title="Assign from a company login"
      size="lg"
      dirty={false}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="space-y-4">
        <p className="text-sm leading-6 text-app-muted">
          Pages, profiles, channels and Search Console properties your company’s logins
          manage that no client uses yet. Assigning one lets {clientName} publish to it,
          or see its Search Console data.
        </p>
        {error && <Notice error>{error}</Notice>}
        {items === null ? (
          <SkeletonTable columns={2} rows={3} />
        ) : candidates.length === 0 ? (
          <SocialEmpty
            title="Nothing free to assign"
            description="Connect your team’s logins, or ask the client to give one of them access to their Page, profile or property, then refresh it."
            action={
              <Button kind="secondary" onClick={onOpenConnections}>
                Open company connections
              </Button>
            }
          />
        ) : (
          <div className="space-y-2">
            <input
              type="search"
              placeholder="Search…"
              aria-label="Search pages, profiles and properties"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              disabled={Boolean(busy)}
              className={searchInput}
            />
            {visible.map((location) => (
              <div
                key={location.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-app-border p-3"
              >
                <PlatformMark platform={location.platform} small />
                <span className="min-w-40 flex-1">
                  <span className="block text-sm font-semibold">{location.name}</span>
                  <span className="block text-xs text-app-muted">
                    {location.assignment
                      ? 'Connected with this client’s own sign-in — moves to the company login'
                      : [
                          ASSET_LABELS[location.platform],
                          location.detail ?? location.address,
                          location.suggestion?.clientId === clientId ? 'Suggested' : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                  </span>
                </span>
                <Button
                  kind="secondary"
                  disabled={Boolean(busy)}
                  onClick={() => void assign(location)}
                >
                  {busy === location.id ? 'Assigning…' : 'Assign'}
                </Button>
              </div>
            ))}
            {visible.length === 0 && (
              <p className="py-4 text-center text-sm text-app-muted">
                Nothing matches “{search}”
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
