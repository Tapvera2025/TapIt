import type {
  SocialCompanyConnection,
  SocialCompanyLocation,
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
import { getProvider } from './providers/index.js';
import {
  ProviderError,
  type DiscoveredAccount,
  type OAuthCredential,
  type ProviderIdentity,
} from './providers/types.js';
import { cancelScheduledForAccount, ensureClient, writeAudit } from './repository.js';
import { decryptCredentials, encryptCredentials } from './security.js';
import {
  connectionCredentialContext,
  credentialsForConnection,
  markConnectionReconnectRequired,
} from './service.js';
import type { ConnectionRow, LocationRow } from './types.js';

/**
 * Company-wide connections: a company signs in to a platform ONCE and assigns
 * the locations that sign-in manages to its CRM clients. One stored token per
 * platform account serves every client, so reconnecting or adding a client never
 * mints another refresh token (Google keeps at most 100 per account per OAuth
 * client and silently cancels the oldest).
 *
 * Callers are authorized by the route (`system:manage-integrations`); the
 * client a location is assigned to is checked here to be an active client of
 * the same organization.
 */

const MISSING_LOCATION =
  'Google no longer lists this location for the company account. Check its managers in Google Business Profile.';

interface ConnectionSummaryRow {
  id: string;
  platform: SocialCompanyPlatform;
  externalAccountEmail: string | null;
  status: SocialConnectionStatus;
  createdAt: Date;
  connectedByName: string | null;
  lastDiscoveredAt: Date | null;
  lastError: string | null;
  locationCount: number;
  assignedCount: number;
}
const CONNECTION_SUMMARY = sql`SELECT c.id, c.platform, c.external_account_email, c.status, c.created_at, c.last_discovered_at, c.last_error,
  u.full_name AS connected_by_name,
  (SELECT count(*)::int FROM social_connection_location l WHERE l.organization_id = c.organization_id AND l.connection_id = c.id AND l.status = 'available') AS location_count,
  (SELECT count(*)::int FROM social_account a WHERE a.organization_id = c.organization_id AND a.connection_id = c.id AND a.status <> 'disconnected') AS assigned_count
  FROM social_connection c LEFT JOIN app_user u ON u.organization_id = c.organization_id AND u.id = c.created_by`;

function connectionDto(row: ConnectionSummaryRow): SocialCompanyConnection {
  return {
    id: row.id,
    platform: row.platform,
    accountEmail: row.externalAccountEmail,
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
 * assigned from this very location. An older client sign-in shows as `client_connection`. */
const LOCATION_LIST = sql`SELECT l.*, assigned.account_id, assigned.client_id AS assigned_client_id,
  assigned.client_name AS assigned_client_name, assigned.account_status, assigned.via
  FROM social_connection_location l
  LEFT JOIN LATERAL (
    SELECT a.id AS account_id, a.client_id, COALESCE(NULLIF(cl.business_name, ''), cl.client_name) AS client_name,
      a.status AS account_status,
      CASE WHEN a.location_id IS NULL THEN 'client_connection' ELSE 'company_connection' END AS via
    FROM social_account a JOIN client cl ON cl.organization_id = a.organization_id AND cl.id = a.client_id
    WHERE a.organization_id = l.organization_id AND a.platform = l.platform AND a.external_id = l.external_id
      AND a.status <> 'disconnected'
    ORDER BY (a.location_id = l.id) DESC NULLS LAST, a.connected_at DESC
    LIMIT 1
  ) assigned ON true`;

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

function locationDto(row: LocationListRow): SocialCompanyLocation {
  const address = row.metadata['address'];
  return {
    id: row.id,
    connectionId: row.connectionId,
    platform: row.platform as SocialCompanyPlatform,
    externalId: row.externalId,
    name: row.name,
    address: typeof address === 'string' && address ? address : null,
    websiteUrl: webUrl(row.metadata['websiteUri']),
    mapsUrl: webUrl(row.metadata['mapsUri']),
    status: row.status,
    lastSeenAt: row.lastSeenAt.toISOString(),
    assignment:
      row.accountId && row.assignedClientId && row.accountStatus && row.via
        ? {
            accountId: row.accountId,
            clientId: row.assignedClientId,
            clientName: row.assignedClientName ?? '',
            status: row.accountStatus,
            via: row.via,
          }
        : null,
  };
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
      sql`${LOCATION_LIST} WHERE l.organization_id = ${ctx.organizationId} AND l.connection_id = ${connectionId} ORDER BY l.status, lower(l.name), l.id`,
    );
    return rows.map(locationDto);
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
 * Locations it no longer returns stay as `missing`, with their assignments. */
async function replaceLocations(
  tx: Tx,
  ctx: RequestContext,
  connectionId: string,
  platform: SocialCompanyPlatform,
  locations: readonly DiscoveredAccount[],
): Promise<void> {
  const unique = new Map<string, DiscoveredAccount>();
  for (const location of locations)
    if (location.platform === platform) unique.set(location.externalId, location);
  const rows = [...unique.values()].map((location) => ({
    external_id: location.externalId,
    name: (location.name.trim() || location.externalId).slice(0, 500),
    profile_image_url: location.profileImageUrl ?? null,
    capabilities: Object.entries(location.capabilities)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name),
    metadata: location.metadata ?? {},
  }));
  if (rows.length)
    await tx.query(sql`
      INSERT INTO social_connection_location (organization_id, connection_id, platform, external_id, name, profile_image_url, capabilities, metadata)
      SELECT ${ctx.organizationId}, ${connectionId}, ${platform}, x.external_id, x.name, x.profile_image_url,
        ARRAY(SELECT jsonb_array_elements_text(x.capabilities)), x.metadata
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
        AS x(external_id text, name text, profile_image_url text, capabilities jsonb, metadata jsonb)
      ON CONFLICT (connection_id, external_id) DO UPDATE SET name = EXCLUDED.name,
        profile_image_url = EXCLUDED.profile_image_url, capabilities = EXCLUDED.capabilities,
        metadata = EXCLUDED.metadata, status = 'available', last_seen_at = now()
    `);
  await tx.query(
    sql`UPDATE social_connection_location SET status = 'missing' WHERE organization_id = ${ctx.organizationId} AND connection_id = ${connectionId} AND status = 'available' AND NOT (external_id = ANY(${[...unique.keys()]}::text[]))`,
  );
  // Assigned accounts follow their location's current details.
  await tx.query(sql`
    UPDATE social_account a SET name = l.name, profile_image_url = l.profile_image_url,
      capabilities = l.capabilities, metadata = l.metadata,
      last_error = CASE WHEN l.status = 'missing' THEN ${MISSING_LOCATION}
        WHEN a.last_error = ${MISSING_LOCATION} THEN NULL ELSE a.last_error END
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
 * location waiting for a reconnect. */
export async function saveCompanyConnection(
  ctx: RequestContext,
  platform: SocialCompanyPlatform,
  credentials: OAuthCredential,
  identity: ProviderIdentity,
  locations: readonly DiscoveredAccount[],
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
        sql`UPDATE social_connection SET credentials_encrypted = ${encrypted}, scopes = ${credentials.scopes}, expires_at = ${credentials.expiresAt ?? null}::timestamptz, refresh_lease_until = NULL, status = 'connected', external_account_email = ${identity.email ?? null}, last_error = NULL, updated_at = now() WHERE organization_id = ${ctx.organizationId} AND id = ${id}`,
      );
      await tx.query(
        sql`UPDATE social_account SET status = 'connected', last_error = NULL WHERE organization_id = ${ctx.organizationId} AND connection_id = ${id} AND status = 'reconnect_required'`,
      );
    } else {
      await tx.query(
        sql`INSERT INTO social_connection (id, organization_id, client_id, platform, credentials_encrypted, scopes, expires_at, status, created_by, external_account_id, external_account_email)
          VALUES (${id}, ${ctx.organizationId}, NULL, ${platform}, ${encrypted}, ${credentials.scopes}, ${credentials.expiresAt ?? null}::timestamptz, 'connected', ${ctx.principal.id}, ${identity.externalAccountId}, ${identity.email ?? null})`,
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

/** Re-reads the locations the company account manages, e.g. after a new customer
 * added the company's Google account as a manager of their Business Profile. */
export async function syncCompanyConnection(
  ctx: RequestContext,
  connectionId: string,
  trigger: 'manual' | 'scheduled',
): Promise<SocialCompanyConnection> {
  const connection = await db.transaction(ctx, (tx) =>
    findConnection(tx, ctx, connectionId),
  );
  if (connection.status !== 'connected')
    throw new SocialConflictError(
      'Reconnect this Google account before refreshing its locations.',
    );
  let locations: DiscoveredAccount[];
  try {
    const credentials = await credentialsForConnection(
      ctx,
      connection,
      connection.externalAccountEmail ?? 'the company Google account',
    );
    locations = await getProvider(connection.platform).discoverAccounts(credentials);
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
      locations,
    );
    await tx.query(
      sql`UPDATE social_connection SET last_error = NULL, updated_at = now() WHERE organization_id = ${ctx.organizationId} AND id = ${connectionId}`,
    );
    await writeAudit(tx, ctx, null, 'company_connection.synced', connectionId, {
      trigger,
      locations: locations.length,
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

/** Assigns a company location to one client, or unassigns it (`clientId` null).
 * Unassigning cancels that client's scheduled posts to the location. A location the
 * client had connected through its own sign-in moves onto the company connection,
 * keeping its post history. */
export async function assignCompanyLocation(
  ctx: RequestContext,
  connectionId: string,
  locationId: string,
  clientId: string | null,
): Promise<SocialCompanyLocation> {
  await db.transaction(ctx, async (tx) => {
    // Lock order: connection, location, accounts, posts — as every writer of these does.
    const connection = await findConnection(tx, ctx, connectionId, 'share');
    const location = await tx.maybeOne<LocationRow>(
      sql`SELECT * FROM social_connection_location WHERE organization_id = ${ctx.organizationId} AND connection_id = ${connectionId} AND id = ${locationId} FOR UPDATE`,
    );
    if (!location) throw new SocialNotFoundError('Location');
    const live = await tx.query<{
      id: string;
      clientId: string;
      locationId: string | null;
      connectionId: string;
      clientName: string;
    }>(
      sql`SELECT a.id, a.client_id, a.location_id, a.connection_id, COALESCE(NULLIF(cl.business_name, ''), cl.client_name) AS client_name
        FROM social_account a JOIN client cl ON cl.organization_id = a.organization_id AND cl.id = a.client_id
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
        `Google no longer lists ${location.name} for this account. Refresh the locations, or check the profile's managers in Google.`,
      );
    await ensureClient(tx, ctx.organizationId, clientId);
    const elsewhere = live.find((item) => item.clientId !== clientId);
    if (elsewhere)
      throw new SocialConflictError(
        `${location.name} is already assigned to ${elsewhere.clientName}. Unassign it there first.`,
      );
    const current = live.find((item) => item.clientId === clientId);
    if (current?.locationId === location.id) return;
    const saved = await tx.one<{ id: string }>(sql`
      INSERT INTO social_account (organization_id, client_id, connection_id, location_id, platform, external_id, name, profile_image_url, capabilities, metadata, status)
      VALUES (${ctx.organizationId}, ${clientId}, ${connectionId}, ${location.id}, ${location.platform}, ${location.externalId}, ${location.name}, ${location.profileImageUrl},
        ${location.capabilities}, ${JSON.stringify(location.metadata)}::jsonb, ${connection.status === 'connected' ? 'connected' : 'reconnect_required'})
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
        'The company Google connection was disconnected before publishing.',
      );
    await tx.query(
      sql`UPDATE social_connection SET status = 'disconnected', credentials_encrypted = NULL, refresh_lease_until = NULL, updated_at = now() WHERE organization_id = ${ctx.organizationId} AND id = ${connectionId} AND client_id IS NULL`,
    );
    await writeAudit(tx, ctx, null, 'company_connection.disconnected', connectionId, {
      revocationStatus,
      unassigned: accounts.length,
    });
  });
  return { disconnected: true, revocationStatus };
}

/** The company connections the daily refresh visits. */
export async function activeCompanyConnectionIds(ctx: RequestContext): Promise<string[]> {
  const rows = await db.query<{ id: string }>(
    ctx,
    sql`SELECT id FROM social_connection WHERE organization_id = ${ctx.organizationId} AND client_id IS NULL AND status = 'connected' ORDER BY created_at`,
  );
  return rows.map((row) => row.id);
}
