import type {
  SocialCompanyAssetPlatform,
  SocialCompanyConnection,
  SocialCompanyLocation,
  SocialCompanyLocationSuggestion,
  SocialCompanyPlatform,
  SocialConnectionStatus,
} from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import {
  SocialConflictError,
  SocialNotFoundError,
  SocialValidationError,
} from './errors.js';
import { getCompanyProvider, getProvider } from './providers/index.js';
import {
  ProviderError,
  type OAuthCredential,
  type ProviderCapabilities,
  type ProviderIdentity,
  type SearchConsoleProperty,
} from './providers/types.js';
import {
  cancelScheduledForAccount,
  ensureClient,
  lockPlatformAccounts,
  writeAudit,
} from './repository.js';
import { decryptCredentials, encryptCredentials } from './security.js';
import {
  connectionCredentialContext,
  credentialsForConnection,
  locationCredentialContext,
  markConnectionReconnectRequired,
  markGrantRevoked,
} from './service.js';
import { emailHost, hostOf, suggestClient, type ClientCandidate } from './suggestions.js';
import type { ConnectionRow, LocationRow } from './types.js';

/**
 * Company-wide connections: a company signs in to a platform ONCE and assigns
 * what that sign-in manages to its CRM clients. An agency's few staff logins —
 * a Google account, a Facebook login, a LinkedIn member, a YouTube channel —
 * each serve many clients. One stored token per platform account serves every
 * client, so reconnecting or adding a client never mints another refresh token
 * (Google keeps at most 100 per account per OAuth client and silently cancels
 * the oldest).
 *
 * What a sign-in manages is kept as "locations": Business Profiles, Facebook
 * Pages, the Instagram accounts linked to them, LinkedIn pages, YouTube
 * channels, and the Search Console properties a Google account can read.
 * Publishing destinations are assigned through a client's social_account;
 * a Search Console property, which is only read, is assigned on its own row.
 *
 * Callers are authorized by the route (`system:manage-integrations`); the
 * client a location is assigned to is checked here to be an active client of
 * the same organization.
 */

/** What each company sign-in lists. */
const COMPANY_ASSETS: Record<
  SocialCompanyPlatform,
  readonly SocialCompanyAssetPlatform[]
> = {
  google_business: ['google_business', 'search_console'],
  facebook: ['facebook', 'instagram'],
  linkedin: ['linkedin'],
  youtube: ['youtube'],
};

/** How messages name each company sign-in. Google Business Profile keeps its wording. */
const LOGIN: Record<
  SocialCompanyPlatform,
  { account: string; items: string; disconnected: string; missing: string }
> = {
  google_business: {
    account: 'Google account',
    items: 'locations',
    disconnected: 'The company Google connection was disconnected before publishing.',
    missing:
      'Google no longer lists this location for the company account. Check its managers in Google Business Profile.',
  },
  facebook: {
    account: 'Facebook login',
    items: 'Pages',
    disconnected: 'The company Facebook login was disconnected before publishing.',
    missing:
      'Meta no longer lists this for the company Facebook login. Check its Page access in Meta Business Suite.',
  },
  linkedin: {
    account: 'LinkedIn login',
    items: 'pages',
    disconnected: 'The company LinkedIn login was disconnected before publishing.',
    missing:
      'LinkedIn no longer lists this page for the company login. Check its admins on LinkedIn.',
  },
  youtube: {
    account: 'YouTube channel sign-in',
    items: 'channel',
    disconnected: 'The company YouTube channel was disconnected before publishing.',
    missing:
      'Google no longer lists this channel for the company sign-in. Sign in to the channel again.',
  },
};

/** Why an assignment was refused for something the sign-in no longer manages. */
function missingAssetMessage(platform: SocialCompanyAssetPlatform, name: string): string {
  switch (platform) {
    case 'google_business':
      return `Google no longer lists ${name} for this account. Refresh the locations, or check the profile's managers in Google.`;
    case 'facebook':
    case 'instagram':
      return `Meta no longer lists ${name} for this login. Refresh, or check its Page access in Meta Business Suite.`;
    case 'linkedin':
      return `LinkedIn no longer lists ${name} for this login. Refresh, or check its admins on LinkedIn.`;
    case 'youtube':
      return `${name} is no longer available to this sign-in. Sign in to the channel again.`;
    case 'search_console':
      return `Search Console no longer lists ${name} for this Google account. Refresh, or check its users in Search Console.`;
  }
}

/** Something a company sign-in manages, as discovery reports it. It carries a token only
 * where the platform gives the item one of its own (a Meta Page token), and that token is
 * encrypted for its location before it is stored. */
export interface CompanyAsset {
  platform: SocialCompanyAssetPlatform;
  externalId: string;
  name: string;
  profileImageUrl?: string | undefined;
  capabilities: Partial<Record<keyof ProviderCapabilities, boolean>>;
  metadata?: Record<string, unknown> | undefined;
  credentials?: OAuthCredential | undefined;
}

function propertyAsset(property: SearchConsoleProperty): CompanyAsset {
  const domain = /^sc-domain:(.+)$/i.exec(property.siteUrl)?.[1]?.toLowerCase();
  let name = domain ?? property.siteUrl;
  if (!domain)
    try {
      const url = new URL(property.siteUrl);
      name = `${url.host}${url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')}`;
    } catch {
      /* Listed as Search Console returned it. */
    }
  return {
    platform: 'search_console',
    externalId: property.siteUrl,
    name,
    capabilities: {},
    metadata: {
      permissionLevel: property.permissionLevel,
      websiteUri: domain ? `https://${domain}/` : property.siteUrl,
    },
  };
}

/** Everything a company sign-in manages now. A Google sign-in's Search Console
 * properties are optional: if they cannot be listed, its profiles still are, and
 * the reason is kept on the connection. */
export async function discoverCompanyAssets(
  platform: SocialCompanyPlatform,
  credentials: OAuthCredential,
): Promise<{ assets: CompanyAsset[]; warning: string | null }> {
  const provider = getCompanyProvider(platform);
  const assets: CompanyAsset[] = (await provider.discoverAccounts(credentials)).map(
    (account) => ({
      platform: account.platform,
      externalId: account.externalId,
      name: account.name,
      ...(account.profileImageUrl ? { profileImageUrl: account.profileImageUrl } : {}),
      capabilities: account.capabilities,
      ...(account.metadata ? { metadata: account.metadata } : {}),
      ...(account.locationCredentials
        ? { credentials: account.locationCredentials }
        : {}),
    }),
  );
  let warning: string | null = null;
  if (provider.listSearchConsoleProperties)
    try {
      for (const property of await provider.listSearchConsoleProperties(credentials))
        assets.push(propertyAsset(property));
    } catch (error) {
      if (error instanceof ProviderError && error.reconnectRequired) throw error;
      warning =
        'Search Console properties could not be listed. Check that the Search Console API is enabled for the CRM’s Google project, then refresh.';
    }
  return { assets, warning };
}

interface ConnectionSummaryRow {
  id: string;
  platform: SocialCompanyPlatform;
  externalAccountEmail: string | null;
  externalAccountName: string | null;
  status: SocialConnectionStatus;
  createdAt: Date;
  connectedByName: string | null;
  lastDiscoveredAt: Date | null;
  lastError: string | null;
  locationCount: number;
  assignedCount: number;
}
const CONNECTION_SUMMARY = sql`SELECT c.id, c.platform, c.external_account_email, c.external_account_name, c.status, c.created_at, c.last_discovered_at, c.last_error,
  u.full_name AS connected_by_name,
  (SELECT count(*)::int FROM social_connection_location l WHERE l.organization_id = c.organization_id AND l.connection_id = c.id AND l.status = 'available') AS location_count,
  (SELECT count(*)::int FROM social_account a WHERE a.organization_id = c.organization_id AND a.connection_id = c.id AND a.status <> 'disconnected')
    + (SELECT count(*)::int FROM social_connection_location p WHERE p.organization_id = c.organization_id AND p.connection_id = c.id AND p.client_id IS NOT NULL) AS assigned_count
  FROM social_connection c LEFT JOIN app_user u ON u.organization_id = c.organization_id AND u.id = c.created_by`;

function connectionDto(row: ConnectionSummaryRow): SocialCompanyConnection {
  return {
    id: row.id,
    platform: row.platform,
    accountEmail: row.externalAccountEmail,
    accountName: row.externalAccountName,
    status: row.status,
    connectedAt: row.createdAt.toISOString(),
    connectedByName: row.connectedByName,
    lastDiscoveredAt: row.lastDiscoveredAt?.toISOString() ?? null,
    lastError: row.lastError,
    locationCount: row.locationCount,
    assignedCount: row.assignedCount,
  };
}

interface LocationListRow extends LocationRow {
  accountId: string | null;
  assignedClientId: string | null;
  assignedClientName: string | null;
  accountStatus: SocialConnectionStatus | null;
  via: 'company_connection' | 'client_connection' | null;
}
/** A live account for the same platform location in any client, preferring the one
 * assigned from this very location. An older client sign-in shows as `client_connection`.
 * A Search Console property is assigned on a location row instead: this one, or the
 * same property reached through another of the company's Google sign-ins. */
const LOCATION_LIST = sql`SELECT l.*, assigned.account_id,
  COALESCE(assigned.client_id, property.client_id) AS assigned_client_id,
  COALESCE(assigned.client_name, property.client_name) AS assigned_client_name,
  COALESCE(assigned.account_status, property.connection_status) AS account_status,
  COALESCE(assigned.via, property.via) AS via
  FROM social_connection_location l
  LEFT JOIN LATERAL (
    SELECT a.id AS account_id, a.client_id, COALESCE(NULLIF(cl.business_name, ''), cl.client_name) AS client_name,
      a.status AS account_status,
      CASE WHEN a.location_id IS NULL THEN 'client_connection' ELSE 'company_connection' END AS via
    FROM social_account a JOIN client cl ON cl.organization_id = a.organization_id AND cl.id = a.client_id
    WHERE l.platform <> 'search_console' AND a.organization_id = l.organization_id AND a.platform = l.platform
      AND a.external_id = l.external_id AND a.status <> 'disconnected'
    ORDER BY (a.location_id = l.id) DESC NULLS LAST, a.connected_at DESC
    LIMIT 1
  ) assigned ON true
  LEFT JOIN LATERAL (
    SELECT p.client_id, COALESCE(NULLIF(cl.business_name, ''), cl.client_name) AS client_name,
      c.status AS connection_status, 'company_connection' AS via
    FROM social_connection_location p
    JOIN client cl ON cl.organization_id = p.organization_id AND cl.id = p.client_id
    JOIN social_connection c ON c.organization_id = p.organization_id AND c.id = p.connection_id
    WHERE l.platform = 'search_console' AND p.organization_id = l.organization_id
      AND p.platform = 'search_console' AND p.external_id = l.external_id AND p.client_id IS NOT NULL
    LIMIT 1
  ) property ON true`;

/** Only web links reach the browser; anything else from the platform is dropped. */
function webUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

const PROPERTY_LEVELS: Record<string, string> = {
  siteOwner: 'Owner',
  siteFullUser: 'Full user',
  siteRestrictedUser: 'Restricted user',
};

/** A short line that tells similar locations apart. */
function locationDetail(row: LocationRow): string | null {
  const metadata = row.metadata;
  switch (row.platform) {
    case 'instagram': {
      const username = metadata['username'];
      return typeof username === 'string' && username ? `@${username}` : null;
    }
    case 'linkedin':
      return metadata['accountType'] === 'organization'
        ? 'Company page'
        : 'Member profile';
    case 'search_console': {
      const kind = row.externalId.startsWith('sc-domain:')
        ? 'Domain property'
        : 'URL-prefix property';
      const level = PROPERTY_LEVELS[String(metadata['permissionLevel'])];
      return level ? `${kind} · ${level}` : kind;
    }
    default:
      return null;
  }
}

function locationDto(
  row: LocationListRow,
  suggestion: SocialCompanyLocationSuggestion | null = null,
): SocialCompanyLocation {
  const address = row.metadata['address'];
  const assignment =
    row.assignedClientId && row.accountStatus && row.via
      ? {
          accountId: row.accountId,
          clientId: row.assignedClientId,
          clientName: row.assignedClientName ?? '',
          status: row.accountStatus,
          via: row.via,
        }
      : null;
  return {
    id: row.id,
    connectionId: row.connectionId,
    platform: row.platform,
    externalId: row.externalId,
    name: row.name,
    address: typeof address === 'string' && address ? address : null,
    detail: locationDetail(row),
    websiteUrl: webUrl(row.metadata['websiteUri']),
    mapsUrl: webUrl(row.metadata['mapsUri']),
    status: row.status,
    lastSeenAt: row.lastSeenAt.toISOString(),
    assignment,
    suggestion: assignment || row.status !== 'available' ? null : suggestion,
  };
}

/** The organization's active clients, with every name and website known for each. */
async function clientCandidates(tx: Tx, ctx: RequestContext): Promise<ClientCandidate[]> {
  const clients = await tx.query<{
    id: string;
    clientName: string;
    businessName: string;
    email: string;
  }>(
    sql`SELECT id, client_name, business_name, email FROM client WHERE organization_id = ${ctx.organizationId} AND status = 'active'`,
  );
  const known = await tx.query<{ clientId: string; site: string | null }>(sql`
    SELECT client_id, normalized_host AS site FROM seo_sites
      WHERE organization_id = ${ctx.organizationId} AND client_id IS NOT NULL AND active
    UNION ALL
    SELECT client_id, metadata->>'websiteUri' FROM social_account
      WHERE organization_id = ${ctx.organizationId} AND status <> 'disconnected' AND metadata ? 'websiteUri'
    UNION ALL
    SELECT client_id, external_id FROM social_connection_location
      WHERE organization_id = ${ctx.organizationId} AND client_id IS NOT NULL`);
  const hosts = new Map<string, Set<string>>();
  for (const row of known) {
    const host = hostOf(row.site);
    if (host) hosts.set(row.clientId, (hosts.get(row.clientId) ?? new Set()).add(host));
  }
  return clients.map((client) => {
    const own = new Set(hosts.get(client.id) ?? []);
    const mail = emailHost(client.email);
    if (mail) own.add(mail);
    return {
      id: client.id,
      name: client.businessName || client.clientName,
      names: [client.businessName, client.clientName].filter(Boolean),
      hosts: [...own],
    };
  });
}

async function findConnection(
  tx: Tx,
  ctx: RequestContext,
  connectionId: string,
  lock: 'none' | 'share' | 'update' = 'none',
): Promise<ConnectionRow> {
  const row = await tx.maybeOne<ConnectionRow>(
    sql`SELECT * FROM social_connection WHERE organization_id = ${ctx.organizationId} AND id = ${connectionId} AND client_id IS NULL AND status <> 'disconnected' ${lock === 'update' ? sql`FOR UPDATE` : lock === 'share' ? sql`FOR SHARE` : sql``}`,
  );
  if (!row) throw new SocialNotFoundError('Company connection');
  return row;
}

export async function listCompanyConnections(
  ctx: RequestContext,
): Promise<SocialCompanyConnection[]> {
  const rows = await db.query<ConnectionSummaryRow>(
    ctx,
    sql`${CONNECTION_SUMMARY} WHERE c.organization_id = ${ctx.organizationId} AND c.client_id IS NULL AND c.status <> 'disconnected' ORDER BY c.created_at, c.id`,
  );
  return rows.map(connectionDto);
}

async function getCompanyConnection(
  ctx: RequestContext,
  connectionId: string,
): Promise<SocialCompanyConnection> {
  const row = await db.maybeOne<ConnectionSummaryRow>(
    ctx,
    sql`${CONNECTION_SUMMARY} WHERE c.organization_id = ${ctx.organizationId} AND c.id = ${connectionId} AND c.client_id IS NULL AND c.status <> 'disconnected'`,
  );
  if (!row) throw new SocialNotFoundError('Company connection');
  return connectionDto(row);
}

export async function listCompanyLocations(
  ctx: RequestContext,
  connectionId: string,
): Promise<SocialCompanyLocation[]> {
  return db.transaction(ctx, async (tx) => {
    await findConnection(tx, ctx, connectionId);
    const rows = await tx.query<LocationListRow>(
      sql`${LOCATION_LIST} WHERE l.organization_id = ${ctx.organizationId} AND l.connection_id = ${connectionId} ORDER BY l.status, l.platform, lower(l.name), l.id`,
    );
    const open = rows.filter(
      (row) => row.status === 'available' && !row.assignedClientId,
    );
    const clients = open.length ? await clientCandidates(tx, ctx) : [];
    return rows.map((row) =>
      locationDto(
        row,
        open.includes(row)
          ? suggestClient(
              {
                platform: row.platform,
                externalId: row.externalId,
                name: row.name,
                websiteUrl: webUrl(row.metadata['websiteUri']),
              },
              clients,
            )
          : null,
      ),
    );
  });
}

async function getCompanyLocation(
  ctx: RequestContext,
  connectionId: string,
  locationId: string,
): Promise<SocialCompanyLocation> {
  const row = await db.maybeOne<LocationListRow>(
    ctx,
    sql`${LOCATION_LIST} WHERE l.organization_id = ${ctx.organizationId} AND l.connection_id = ${connectionId} AND l.id = ${locationId}`,
  );
  if (!row) throw new SocialNotFoundError('Location');
  return locationDto(row);
}

/** The connection's location list becomes exactly what the platform returned now.
 * Locations it no longer returns stay as `missing`, with their assignments, and lose
 * their own token: the platform has withdrawn it with the access. */
async function replaceLocations(
  tx: Tx,
  ctx: RequestContext,
  connectionId: string,
  platform: SocialCompanyPlatform,
  locations: readonly CompanyAsset[],
): Promise<void> {
  const allowed = COMPANY_ASSETS[platform];
  const missing = LOGIN[platform].missing;
  const unique = new Map<string, CompanyAsset>();
  for (const location of locations)
    if (allowed.includes(location.platform)) unique.set(location.externalId, location);
  const rows = [...unique.values()].map((location) => ({
    platform: location.platform,
    external_id: location.externalId,
    name: (location.name.trim() || location.externalId).slice(0, 500),
    profile_image_url: location.profileImageUrl ?? null,
    capabilities: Object.entries(location.capabilities)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name),
    metadata: location.metadata ?? {},
    credentials_encrypted: location.credentials
      ? encryptCredentials(
          location.credentials,
          locationCredentialContext(ctx.organizationId, {
            connectionId,
            platform: location.platform,
            externalId: location.externalId,
          }),
        )
      : null,
  }));
  if (rows.length)
    await tx.query(sql`
      INSERT INTO social_connection_location (organization_id, connection_id, platform, external_id, name, profile_image_url, capabilities, metadata, credentials_encrypted)
      SELECT ${ctx.organizationId}, ${connectionId}, x.platform, x.external_id, x.name, x.profile_image_url,
        ARRAY(SELECT jsonb_array_elements_text(x.capabilities)), x.metadata, x.credentials_encrypted
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
        AS x(platform text, external_id text, name text, profile_image_url text, capabilities jsonb, metadata jsonb, credentials_encrypted text)
      ON CONFLICT (connection_id, external_id) DO UPDATE SET name = EXCLUDED.name,
        profile_image_url = EXCLUDED.profile_image_url, capabilities = EXCLUDED.capabilities,
        metadata = EXCLUDED.metadata, credentials_encrypted = EXCLUDED.credentials_encrypted,
        status = 'available', last_seen_at = now()
    `);
  await tx.query(
    sql`UPDATE social_connection_location SET status = 'missing', credentials_encrypted = NULL WHERE organization_id = ${ctx.organizationId} AND connection_id = ${connectionId} AND status = 'available' AND NOT (external_id = ANY(${[...unique.keys()]}::text[]))`,
  );
  // Assigned accounts follow their location's current details. One that needed a
  // reconnect because its Page token was refused works again with the fresh one.
  await tx.query(sql`
    UPDATE social_account a SET name = l.name, profile_image_url = l.profile_image_url,
      capabilities = l.capabilities, metadata = l.metadata,
      status = CASE WHEN a.status = 'reconnect_required' AND l.status = 'available' AND l.credentials_encrypted IS NOT NULL
        THEN 'connected' ELSE a.status END,
      last_error = CASE WHEN l.status = 'missing' THEN ${missing}
        WHEN a.status = 'reconnect_required' AND l.status = 'available' AND l.credentials_encrypted IS NOT NULL THEN NULL
        WHEN a.last_error = ${missing} THEN NULL ELSE a.last_error END
    FROM social_connection_location l
    WHERE a.organization_id = ${ctx.organizationId} AND a.connection_id = ${connectionId}
      AND l.organization_id = a.organization_id AND l.id = a.location_id AND a.status <> 'disconnected'
  `);
  await tx.query(
    sql`UPDATE social_connection SET last_discovered_at = now() WHERE organization_id = ${ctx.organizationId} AND id = ${connectionId}`,
  );
}

/** Stores the company's sign-in once per platform account and refreshes its location
 * list. Signing in again with the same account updates that row and heals every
 * location waiting for a reconnect. `warning` is a non-fatal discovery problem. */
export async function saveCompanyConnection(
  ctx: RequestContext,
  platform: SocialCompanyPlatform,
  credentials: OAuthCredential,
  identity: ProviderIdentity,
  locations: readonly CompanyAsset[],
  warning: string | null = null,
): Promise<SocialCompanyConnection> {
  const connectionId = await db.transaction(ctx, async (tx) => {
    // Two windows finishing the same sign-in at once would both find no row.
    await tx.query(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`social-company-connection:${ctx.organizationId}:${platform}:${identity.externalAccountId}`}, 0))`,
    );
    const existing = await tx.maybeOne<{ id: string }>(
      sql`SELECT id FROM social_connection WHERE organization_id = ${ctx.organizationId} AND client_id IS NULL AND platform = ${platform} AND external_account_id = ${identity.externalAccountId} AND status <> 'disconnected' FOR UPDATE`,
    );
    const id =
      existing?.id ?? (await tx.one<{ id: string }>(sql`SELECT uuidv7() AS id`)).id;
    const encrypted = encryptCredentials(
      credentials,
      connectionCredentialContext(ctx.organizationId, { id, clientId: null, platform }),
    );
    if (existing) {
      await tx.query(
        sql`UPDATE social_connection SET credentials_encrypted = ${encrypted}, scopes = ${credentials.scopes}, expires_at = ${credentials.expiresAt ?? null}::timestamptz, refresh_lease_until = NULL, status = 'connected', external_account_email = ${identity.email ?? null}, external_account_name = ${identity.name ?? null}, last_error = ${warning}, updated_at = now() WHERE organization_id = ${ctx.organizationId} AND id = ${id}`,
      );
      await tx.query(
        sql`UPDATE social_account SET status = 'connected', last_error = NULL WHERE organization_id = ${ctx.organizationId} AND connection_id = ${id} AND status = 'reconnect_required'`,
      );
    } else {
      await tx.query(
        sql`INSERT INTO social_connection (id, organization_id, client_id, platform, credentials_encrypted, scopes, expires_at, status, created_by, external_account_id, external_account_email, external_account_name, last_error)
          VALUES (${id}, ${ctx.organizationId}, NULL, ${platform}, ${encrypted}, ${credentials.scopes}, ${credentials.expiresAt ?? null}::timestamptz, 'connected', ${ctx.principal.id}, ${identity.externalAccountId}, ${identity.email ?? null}, ${identity.name ?? null}, ${warning})`,
      );
    }
    await replaceLocations(tx, ctx, id, platform, locations);
    await writeAudit(
      tx,
      ctx,
      null,
      existing ? 'company_connection.reconnected' : 'company_connection.connected',
      id,
      { platform, locations: locations.length },
    );
    return id;
  });
  return getCompanyConnection(ctx, connectionId);
}

/** Re-reads what the company sign-in manages, e.g. after a new customer added the
 * company's Google account as a manager of their Business Profile, or gave the
 * company's Facebook login a role on their Page. */
export async function syncCompanyConnection(
  ctx: RequestContext,
  connectionId: string,
  trigger: 'manual' | 'scheduled',
): Promise<SocialCompanyConnection> {
  const connection = await db.transaction(ctx, (tx) =>
    findConnection(tx, ctx, connectionId),
  );
  const platform = connection.platform as SocialCompanyPlatform;
  const login = LOGIN[platform];
  if (connection.status !== 'connected')
    throw new SocialConflictError(
      `Reconnect this ${login.account} before refreshing its ${login.items}.`,
    );
  let discovery: Awaited<ReturnType<typeof discoverCompanyAssets>>;
  try {
    const credentials = await credentialsForConnection(
      ctx,
      connection,
      connection.externalAccountEmail ??
        connection.externalAccountName ??
        `the company ${login.account}`,
    );
    discovery = await discoverCompanyAssets(platform, credentials);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'The locations could not be refreshed.';
    await db.transaction(ctx, async (tx) => {
      if (error instanceof ProviderError && error.reconnectRequired)
        await markConnectionReconnectRequired(tx, ctx, connection, message);
      else
        await tx.query(
          sql`UPDATE social_connection SET last_error = ${message.slice(0, 1000)}, updated_at = now() WHERE organization_id = ${ctx.organizationId} AND id = ${connectionId} AND client_id IS NULL`,
        );
    });
    throw error;
  }
  await db.transaction(ctx, async (tx) => {
    const locked = await findConnection(tx, ctx, connectionId, 'update');
    await replaceLocations(
      tx,
      ctx,
      locked.id,
      locked.platform as SocialCompanyPlatform,
      discovery.assets,
    );
    await tx.query(
      sql`UPDATE social_connection SET last_error = ${discovery.warning}, updated_at = now() WHERE organization_id = ${ctx.organizationId} AND id = ${connectionId}`,
    );
    await writeAudit(tx, ctx, null, 'company_connection.synced', connectionId, {
      trigger,
      locations: discovery.assets.length,
    });
  });
  return getCompanyConnection(ctx, connectionId);
}

async function unassignAccount(
  tx: Tx,
  ctx: RequestContext,
  account: { id: string; clientId: string },
  reason: string,
): Promise<void> {
  await tx.query(
    sql`UPDATE social_account SET status = 'disconnected', last_error = NULL WHERE organization_id = ${ctx.organizationId} AND client_id = ${account.clientId} AND id = ${account.id}`,
  );
  await cancelScheduledForAccount(
    tx,
    ctx.organizationId,
    account.clientId,
    account.id,
    reason,
  );
  await writeAudit(tx, ctx, account.clientId, 'account.unassigned', account.id);
}

/** Assigns a Search Console property to one client, or unassigns it. A property
 * serves one client at a time, through whichever of the company's Google sign-ins
 * it was assigned on; assigning it again on another sign-in moves it there. `move`
 * takes it from another client in the same step. */
async function assignProperty(
  tx: Tx,
  ctx: RequestContext,
  location: LocationRow,
  clientId: string | null,
  move: boolean,
): Promise<void> {
  const holders = await tx.query<{ id: string; clientId: string; clientName: string }>(
    sql`SELECT p.id, p.client_id, COALESCE(NULLIF(cl.business_name, ''), cl.client_name) AS client_name
      FROM social_connection_location p JOIN client cl ON cl.organization_id = p.organization_id AND cl.id = p.client_id
      WHERE p.organization_id = ${ctx.organizationId} AND p.platform = 'search_console' AND p.external_id = ${location.externalId} AND p.client_id IS NOT NULL
      FOR UPDATE OF p`,
  );
  const release = sql`UPDATE social_connection_location SET client_id = NULL WHERE organization_id = ${ctx.organizationId} AND platform = 'search_console' AND external_id = ${location.externalId} AND client_id IS NOT NULL`;
  if (clientId === null) {
    await tx.query(release);
    for (const holder of holders)
      await writeAudit(tx, ctx, holder.clientId, 'property.unassigned', holder.id);
    return;
  }
  if (location.status === 'missing')
    throw new SocialValidationError(
      missingAssetMessage(location.platform, location.name),
    );
  await ensureClient(tx, ctx.organizationId, clientId);
  const elsewhere = holders.filter((holder) => holder.clientId !== clientId);
  if (elsewhere.length && !move)
    throw new SocialConflictError(
      `${location.name} is already assigned to ${elsewhere[0]!.clientName}. Unassign it there first.`,
    );
  if (!elsewhere.length && holders.some((holder) => holder.id === location.id)) return;
  await tx.query(release);
  for (const holder of elsewhere)
    await writeAudit(tx, ctx, holder.clientId, 'property.unassigned', holder.id);
  await tx.query(
    sql`UPDATE social_connection_location SET client_id = ${clientId} WHERE organization_id = ${ctx.organizationId} AND id = ${location.id}`,
  );
  await writeAudit(
    tx,
    ctx,
    clientId,
    holders.length ? 'property.moved' : 'property.assigned',
    location.id,
    { connectionId: location.connectionId },
  );
}

/** Assigns a company location to one client, or unassigns it (`clientId` null).
 * Unassigning cancels that client's scheduled posts to the location. A location the
 * client had connected through its own sign-in moves onto the company connection,
 * keeping its post history. `move` takes a location another client has through a
 * company login in the same transaction, so a failed move never leaves it with neither;
 * one another client connected with its own sign-in is still theirs to disconnect. */
export async function assignCompanyLocation(
  ctx: RequestContext,
  connectionId: string,
  locationId: string,
  clientId: string | null,
  options: { move?: boolean } = {},
): Promise<SocialCompanyLocation> {
  const move = options.move === true;
  await db.transaction(ctx, async (tx) => {
    // The platform account first, as a client sign-in of the same Page takes it; then
    // connection, location, accounts, posts — as every writer of these does.
    const identity = await tx.maybeOne<{ platform: string; externalId: string }>(
      sql`SELECT platform, external_id FROM social_connection_location WHERE organization_id = ${ctx.organizationId} AND connection_id = ${connectionId} AND id = ${locationId}`,
    );
    if (identity) await lockPlatformAccounts(tx, ctx.organizationId, [identity]);
    const connection = await findConnection(tx, ctx, connectionId, 'share');
    const location = await tx.maybeOne<LocationRow>(
      sql`SELECT * FROM social_connection_location WHERE organization_id = ${ctx.organizationId} AND connection_id = ${connectionId} AND id = ${locationId} FOR UPDATE`,
    );
    if (!location) throw new SocialNotFoundError('Location');
    if (location.platform === 'search_console') {
      await assignProperty(tx, ctx, location, clientId, move);
      return;
    }
    const live = await tx.query<{
      id: string;
      clientId: string;
      locationId: string | null;
      connectionId: string;
      clientName: string;
      origin: 'agency' | 'client_portal';
    }>(
      sql`SELECT a.id, a.client_id, a.location_id, a.connection_id, COALESCE(NULLIF(cl.business_name, ''), cl.client_name) AS client_name,
          c.connected_via AS origin
        FROM social_account a JOIN client cl ON cl.organization_id = a.organization_id AND cl.id = a.client_id
        JOIN social_connection c ON c.organization_id = a.organization_id AND c.id = a.connection_id
        WHERE a.organization_id = ${ctx.organizationId} AND a.platform = ${location.platform} AND a.external_id = ${location.externalId} AND a.status <> 'disconnected'
        FOR UPDATE OF a`,
    );
    if (clientId === null) {
      for (const account of live.filter((item) => item.locationId !== null))
        await unassignAccount(
          tx,
          ctx,
          account,
          'Location unassigned from this client before publishing.',
        );
      return;
    }
    if (location.status === 'missing')
      throw new SocialValidationError(
        missingAssetMessage(location.platform, location.name),
      );
    await ensureClient(tx, ctx.organizationId, clientId);
    const elsewhere = live.filter((item) => item.clientId !== clientId);
    const blocking = elsewhere.find((item) => !move || item.locationId === null);
    if (blocking)
      throw new SocialConflictError(
        blocking.locationId === null
          ? `${location.name} is connected to ${blocking.clientName} with that client’s own sign-in. Disconnect it there first.`
          : `${location.name} is already assigned to ${blocking.clientName}. Unassign it there first.`,
      );
    for (const account of elsewhere)
      await unassignAccount(
        tx,
        ctx,
        account,
        'Location moved to another client before publishing.',
      );
    const current = live.find((item) => item.clientId === clientId);
    if (current?.locationId === location.id) return;
    // The client connected this account itself from the client portal. The company login
    // does not take it over; the client (or staff, in the client's workspace) disconnects
    // it first.
    if (current && current.locationId === null && current.origin === 'client_portal')
      throw new SocialConflictError(
        `${location.name} was connected by ${current.clientName} from their client portal. Disconnect it in that client’s workspace first.`,
      );
    // A location with its own token (a Facebook Page) publishes even while the login
    // itself waits for a reconnect.
    const usable =
      connection.status === 'connected' || location.credentialsEncrypted !== null;
    const saved = await tx.one<{ id: string }>(sql`
      INSERT INTO social_account (organization_id, client_id, connection_id, location_id, platform, external_id, name, profile_image_url, capabilities, metadata, status)
      VALUES (${ctx.organizationId}, ${clientId}, ${connectionId}, ${location.id}, ${location.platform}, ${location.externalId}, ${location.name}, ${location.profileImageUrl},
        ${location.capabilities}, ${JSON.stringify(location.metadata)}::jsonb, ${usable ? 'connected' : 'reconnect_required'})
      ON CONFLICT (organization_id, client_id, platform, external_id) DO UPDATE SET connection_id = EXCLUDED.connection_id,
        location_id = EXCLUDED.location_id, name = EXCLUDED.name, profile_image_url = EXCLUDED.profile_image_url,
        capabilities = EXCLUDED.capabilities, metadata = EXCLUDED.metadata, status = EXCLUDED.status,
        connected_at = now(), last_error = NULL
      RETURNING id`);
    if (current && current.locationId === null)
      // The client's own sign-in for this location is no longer needed. It is not
      // revoked at the platform: it may be the same account as the company's.
      await tx.query(
        sql`UPDATE social_connection SET status = 'disconnected', credentials_encrypted = NULL, refresh_lease_until = NULL, updated_at = now()
          WHERE organization_id = ${ctx.organizationId} AND client_id = ${clientId} AND id = ${current.connectionId}
            AND NOT EXISTS (SELECT 1 FROM social_account a WHERE a.organization_id = social_connection.organization_id AND a.connection_id = social_connection.id AND a.status <> 'disconnected')`,
      );
    await writeAudit(
      tx,
      ctx,
      clientId,
      current ? 'account.moved_to_company_connection' : 'account.assigned',
      saved.id,
      { connectionId, locationId: location.id },
    );
  });
  return getCompanyLocation(ctx, connectionId, locationId);
}

/** Disconnects the company sign-in: every location it served is unassigned and their
 * scheduled posts are cancelled. Revoking at the platform is optional because it removes
 * the user's whole grant, including any other connection made with the same account. */
export async function disconnectCompanyConnection(
  ctx: RequestContext,
  connectionId: string,
  revokeGrant: boolean,
): Promise<{
  disconnected: true;
  revocationStatus: 'not_requested' | 'revoked' | 'remove_access_in_platform_settings';
  /** Other connections the same revoked grant served, now marked for reconnect. */
  othersNeedReconnect: number;
}> {
  const connection = await db.transaction(ctx, (tx) =>
    findConnection(tx, ctx, connectionId),
  );
  let revocationStatus:
    'not_requested' | 'revoked' | 'remove_access_in_platform_settings' = 'not_requested';
  if (revokeGrant && connection.credentialsEncrypted) {
    try {
      const credentials = decryptCredentials<OAuthCredential>(
        connection.credentialsEncrypted,
        connectionCredentialContext(ctx.organizationId, connection),
      );
      await getProvider(connection.platform).revoke(credentials);
      revocationStatus = 'revoked';
    } catch {
      revocationStatus = 'remove_access_in_platform_settings';
    }
  }
  await db.transaction(ctx, async (tx) => {
    await findConnection(tx, ctx, connectionId, 'update');
    const accounts = await tx.query<{ id: string; clientId: string }>(
      sql`SELECT id, client_id FROM social_account WHERE organization_id = ${ctx.organizationId} AND connection_id = ${connectionId} AND status <> 'disconnected' FOR UPDATE`,
    );
    for (const account of accounts)
      await unassignAccount(
        tx,
        ctx,
        account,
        LOGIN[connection.platform as SocialCompanyPlatform].disconnected,
      );
    // Search Console properties reached through this sign-in stop serving their clients.
    const properties = await tx.query<{ id: string; clientId: string }>(sql`
      WITH released AS (
        SELECT id, client_id FROM social_connection_location
        WHERE organization_id = ${ctx.organizationId} AND connection_id = ${connectionId} AND client_id IS NOT NULL
        FOR UPDATE
      )
      UPDATE social_connection_location l SET client_id = NULL FROM released r
      WHERE l.organization_id = ${ctx.organizationId} AND l.id = r.id
      RETURNING l.id, r.client_id`);
    for (const property of properties)
      await writeAudit(tx, ctx, property.clientId, 'property.unassigned', property.id);
    // The Pages' own tokens go with the login that read them.
    await tx.query(
      sql`UPDATE social_connection_location SET credentials_encrypted = NULL WHERE organization_id = ${ctx.organizationId} AND connection_id = ${connectionId} AND credentials_encrypted IS NOT NULL`,
    );
    await tx.query(
      sql`UPDATE social_connection SET status = 'disconnected', credentials_encrypted = NULL, refresh_lease_until = NULL, updated_at = now() WHERE organization_id = ${ctx.organizationId} AND id = ${connectionId} AND client_id IS NULL`,
    );
    await writeAudit(tx, ctx, null, 'company_connection.disconnected', connectionId, {
      revocationStatus,
      unassigned: accounts.length + properties.length,
    });
  });
  const othersNeedReconnect =
    revocationStatus === 'revoked'
      ? await markGrantRevoked(ctx, {
          platform: connection.platform,
          externalAccountId: connection.externalAccountId,
          connectionId,
        })
      : 0;
  return { disconnected: true, revocationStatus, othersNeedReconnect };
}

/** The company connections the daily refresh visits. */
export async function activeCompanyConnectionIds(ctx: RequestContext): Promise<string[]> {
  const rows = await db.query<{ id: string }>(
    ctx,
    sql`SELECT id FROM social_connection WHERE organization_id = ${ctx.organizationId} AND client_id IS NULL AND status = 'connected' ORDER BY created_at`,
  );
  return rows.map((row) => row.id);
}
