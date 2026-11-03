import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Card, Modal, Notice, SkeletonTable } from '../ui/components.js';
import { Icon } from '../ui/Icon.js';
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
import type {
  SocialClient,
  SocialCompanyConnection,
  SocialCompanyLocation,
  SocialProvider,
} from './types.js';

/**
 * Company-wide Google Business Profile connection: the company signs in to Google
 * once, and every Business Profile that account manages can be assigned to a CRM
 * client. Nobody signs in again per client.
 */

const PLATFORM = 'google_business' as const;
const searchInput =
  'w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm placeholder:text-app-muted focus:outline-none focus:ring-2 focus:ring-app-accent disabled:opacity-50';

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

async function openGoogleSignIn(): Promise<void> {
  const result = await startCompanyConnection(PLATFORM);
  const url = new URL(result.authorizationUrl);
  if (url.protocol !== 'https:')
    throw new Error('The platform returned an invalid authorization URL.');
  window.location.assign(url.href);
}

/** A company sign-in Google just sent back. Completing it is single-use, and
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
            : 'Google did not authorize this connection.',
        );
      const code = payload['code'];
      const state = payload['state'];
      if (
        payload['platform'] !== PLATFORM ||
        typeof code !== 'string' ||
        typeof state !== 'string'
      )
        throw new Error('Google returned an incomplete authorization response.');
      const connection = await completeCompanyConnection(PLATFORM, code, state);
      toast.success(
        `Connected ${connection.accountEmail ?? 'your Google account'}: ${plural(connection.locationCount, 'location')} found.`,
      );
    })().catch((cause: unknown) => {
      toast.error(errorText(cause, 'Google sign-in could not be completed.'));
    });
  }
  return completion ?? Promise.resolve();
}

export function CompanyConnections({
  providers,
  onChanged,
}: {
  providers: SocialProvider[];
  /** Assignments changed, so a client's account list may be stale. */
  onChanged?: () => void;
}): React.JSX.Element {
  const provider = providers.find((item) => item.platform === PLATFORM);
  const ready = provider?.status === 'ready';
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

  async function connect(): Promise<void> {
    setBusy('connect');
    setError('');
    try {
      await openGoogleSignIn();
    } catch (cause) {
      setError(errorText(cause, 'Unable to start Google sign-in.'));
      setBusy('');
    }
  }
  async function refresh(connection: SocialCompanyConnection): Promise<void> {
    setBusy(connection.id);
    setError('');
    try {
      const updated = await syncCompanyConnection(connection.id);
      toast.success(`${plural(updated.locationCount, 'location')} found.`);
    } catch (cause) {
      setError(errorText(cause, 'Unable to refresh the locations.'));
    } finally {
      setBusy('');
      setRevision((value) => value + 1);
    }
  }
  /** Moving a location between clients is an unassign and an assign: the server
   * never moves one silently, because the old client's scheduled posts are cancelled. */
  async function assign(
    location: SocialCompanyLocation,
    client: { id: string; name: string } | null,
  ): Promise<void> {
    setBusy(location.id);
    setError('');
    try {
      if (
        client &&
        location.assignment?.via === 'company_connection' &&
        location.assignment.clientId !== client.id
      )
        await assignCompanyLocation(location.connectionId, location.id, null);
      await assignCompanyLocation(location.connectionId, location.id, client?.id ?? null);
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
  async function disconnect(): Promise<void> {
    if (!disconnecting) return;
    setBusy(disconnecting.id);
    setError('');
    try {
      const result = await disconnectCompanyConnection(disconnecting.id, revokeGrant);
      if (result.revocationStatus === 'remove_access_in_platform_settings')
        toast(
          'TapIt deleted its copy of the sign-in. To remove access completely, remove TapIt in your Google Account settings.',
        );
      toast.success('Google account disconnected');
      setDisconnecting(null);
      onChanged?.();
    } catch (cause) {
      setError(errorText(cause, 'Unable to disconnect this Google account.'));
    } finally {
      setBusy('');
      setRevision((value) => value + 1);
    }
  }

  return (
    <div className="space-y-5">
      {error && <Notice error>{error}</Notice>}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-app-accent/10 text-app-accent">
              <Icon name="building" />
            </span>
            <div className="min-w-0">
              <h2 className="font-semibold">
                Connect your company’s Google account once
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-app-muted">
                TapIt lists every Business Profile this Google account manages. Then you
                choose which client each profile belongs to. Nobody signs in again for
                each client.
              </p>
              <p className="mt-2 max-w-2xl text-xs leading-5 text-app-muted">
                New customer? Ask them to add your Google account as a Manager of their
                Business Profile, then click Refresh locations.
              </p>
            </div>
          </div>
          <Button disabled={!ready || Boolean(busy)} onClick={() => void connect()}>
            {busy === 'connect'
              ? 'Opening Google…'
              : connections?.length
                ? 'Connect another Google account'
                : 'Connect Google account'}
          </Button>
        </div>
        {provider && !ready && (
          <p className="mt-4 text-xs leading-5 text-amber-700 dark:text-amber-200">
            {provider.message}
          </p>
        )}
      </Card>
      {connections === null ? (
        <SkeletonTable columns={4} rows={4} />
      ) : connections.length === 0 ? (
        <Card>
          <SocialEmpty
            title="No company Google account connected"
            description="Connect the Google account your team uses to manage your customers’ Business Profiles."
          />
        </Card>
      ) : (
        connections.map((connection) => (
          <ConnectionCard
            key={connection.id}
            connection={connection}
            locations={locations[connection.id] ?? []}
            busy={busy}
            search={search}
            onSearch={setSearch}
            onRefresh={() => void refresh(connection)}
            onReconnect={() => void connect()}
            onDisconnect={() => {
              setRevokeGrant(false);
              setDisconnecting(connection);
            }}
            onAssign={setAssigning}
            onUnassign={setUnassigning}
            onUseCompanyConnection={(location) => {
              if (location.assignment)
                void assign(location, {
                  id: location.assignment.clientId,
                  name: location.assignment.clientName,
                });
            }}
          />
        ))
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
          title="Unassign location"
          dirty={false}
          onClose={() => setUnassigning(null)}
        >
          <p className="text-sm leading-6">
            Unassign {unassigning.name} from {unassigning.assignment.clientName}? Their
            scheduled posts to this profile are cancelled. Published posts stay on Google.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              kind="danger"
              disabled={Boolean(busy)}
              onClick={() => void assign(unassigning, null)}
            >
              Unassign location
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
          title="Disconnect Google account"
          dirty={false}
          onClose={() => setDisconnecting(null)}
        >
          <p className="text-sm leading-6">
            Disconnect {disconnecting.accountEmail ?? 'this Google account'}?{' '}
            {disconnecting.assignedCount
              ? `Its ${plural(disconnecting.assignedCount, 'location')} will be unassigned from their clients, and their scheduled posts cancelled.`
              : 'No client uses its locations right now.'}
          </p>
          <label className="mt-4 flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={revokeGrant}
              onChange={(event) => setRevokeGrant(event.target.checked)}
            />
            <span>
              Also remove TapIt’s access in Google. This also ends any other TapIt
              connection made with this Google account.
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
  onSearch,
  onRefresh,
  onReconnect,
  onDisconnect,
  onAssign,
  onUnassign,
  onUseCompanyConnection,
}: {
  connection: SocialCompanyConnection;
  locations: SocialCompanyLocation[];
  busy: string;
  search: string;
  onSearch: (value: string) => void;
  onRefresh: () => void;
  onReconnect: () => void;
  onDisconnect: () => void;
  onAssign: (location: SocialCompanyLocation) => void;
  onUnassign: (location: SocialCompanyLocation) => void;
  onUseCompanyConnection: (location: SocialCompanyLocation) => void;
}): React.JSX.Element {
  const term = search.trim().toLowerCase();
  const visible = locations.filter(
    (location) =>
      !term ||
      [location.name, location.address ?? '', location.assignment?.clientName ?? ''].some(
        (text) => text.toLowerCase().includes(term),
      ),
  );
  const needsReconnect = connection.status === 'reconnect_required';
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <PlatformMark platform={PLATFORM} />
        <div className="min-w-40 flex-1">
          <h3 className="font-semibold">{connection.accountEmail ?? 'Google account'}</h3>
          <p className="mt-1 text-xs text-app-muted">
            Connected
            {connection.connectedByName ? ` by ${connection.connectedByName}` : ''} on{' '}
            {when(connection.connectedAt)} · Locations refreshed{' '}
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
              {busy === connection.id ? 'Refreshing…' : 'Refresh locations'}
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
            Google stopped accepting this sign-in. Click Reconnect and sign in with{' '}
            {connection.accountEmail ?? 'the same Google account'}. Until then, posts to
            its locations fail.
          </Notice>
        </div>
      )}
      {!needsReconnect && connection.lastError && (
        <p className="mt-3 text-xs text-app-danger">{connection.lastError}</p>
      )}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-app-muted">
          <strong className="text-app-foreground">{connection.locationCount}</strong>{' '}
          {connection.locationCount === 1 ? 'location' : 'locations'} ·{' '}
          <strong className="text-app-foreground">{connection.assignedCount}</strong>{' '}
          assigned to clients
        </p>
        {locations.length > 0 && (
          <input
            type="search"
            placeholder="Search locations or clients…"
            aria-label="Search locations or clients"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            className={`${searchInput} max-w-xs`}
          />
        )}
      </div>
      {locations.length === 0 ? (
        <SocialEmpty
          title="No locations found"
          description="This Google account does not manage any Business Profile yet. Ask your customers to add it as a Manager, then refresh."
        />
      ) : (
        <ul className="mt-4 divide-y divide-app-border">
          {visible.map((location) => {
            const assignment = location.assignment;
            const disabled = Boolean(busy) || needsReconnect;
            return (
              <li
                key={location.id}
                className="flex flex-wrap items-center gap-3 py-4 first:pt-0 last:pb-0"
              >
                <div className="min-w-48 flex-1">
                  <p className="text-sm font-semibold">{location.name}</p>
                  {location.address && (
                    <p className="mt-1 text-xs text-app-muted">{location.address}</p>
                  )}
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
                    {location.status === 'missing' && (
                      <span className="text-app-danger">
                        No longer managed by this Google account
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
                          ? 'Uses the client’s own Google sign-in'
                          : assignment.status === 'connected'
                            ? 'Assigned'
                            : 'Waiting for reconnect'}
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
                      disabled={disabled || location.status === 'missing'}
                      onClick={() => onUseCompanyConnection(location)}
                    >
                      {busy === location.id ? 'Saving…' : 'Use company account'}
                    </Button>
                  ) : assignment ? (
                    <>
                      <Button
                        kind="secondary"
                        disabled={disabled || location.status === 'missing'}
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
                    <Button
                      kind="secondary"
                      disabled={disabled || location.status === 'missing'}
                      onClick={() => onAssign(location)}
                    >
                      Assign to client
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
          {visible.length === 0 && (
            <li className="py-6 text-center text-sm text-app-muted">
              No locations match “{search}”
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
          Choose the CRM client this Business Profile belongs to. Their posts can then be
          published to it.
        </p>
        {current && (
          <Notice>
            It is assigned to {current.clientName} now. Moving it cancels their scheduled
            posts to this profile. Published posts stay on Google.
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

/** From a client's Connected Accounts: assign one of the company's free locations. */
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
        setError(errorText(cause, 'Unable to load your company’s locations.'));
        setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  // Free locations, plus this client's own sign-ins that can move to the company account.
  const candidates = (items ?? []).filter(
    (location) =>
      location.status === 'available' &&
      (!location.assignment ||
        (location.assignment.via === 'client_connection' &&
          location.assignment.clientId === clientId)),
  );
  const term = search.trim().toLowerCase();
  const visible = candidates.filter(
    (location) =>
      !term ||
      location.name.toLowerCase().includes(term) ||
      (location.address ?? '').toLowerCase().includes(term),
  );
  async function assign(location: SocialCompanyLocation): Promise<void> {
    setBusy(location.id);
    setError('');
    try {
      await assignCompanyLocation(location.connectionId, location.id, clientId);
      toast.success(`${location.name} assigned to ${clientName}`);
      onAssigned();
    } catch (cause) {
      setError(errorText(cause, 'Unable to assign this location.'));
    } finally {
      setBusy('');
    }
  }
  return (
    <Modal
      title="Assign a Google Business Profile"
      size="lg"
      dirty={false}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="space-y-4">
        <p className="text-sm leading-6 text-app-muted">
          Profiles your company’s Google account manages that no client uses yet.
          Assigning one lets {clientName} publish to it.
        </p>
        {error && <Notice error>{error}</Notice>}
        {items === null ? (
          <SkeletonTable columns={2} rows={3} />
        ) : candidates.length === 0 ? (
          <SocialEmpty
            title="No free profiles"
            description="Connect your company’s Google account, or ask the customer to add it as a Manager of their Business Profile and refresh the locations."
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
              placeholder="Search profiles…"
              aria-label="Search profiles"
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
                <PlatformMark platform={PLATFORM} small />
                <span className="min-w-40 flex-1">
                  <span className="block text-sm font-semibold">{location.name}</span>
                  <span className="block text-xs text-app-muted">
                    {location.assignment
                      ? 'Connected with this client’s own sign-in — moves to the company account'
                      : (location.address ?? location.externalId)}
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
                No profiles match “{search}”
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
