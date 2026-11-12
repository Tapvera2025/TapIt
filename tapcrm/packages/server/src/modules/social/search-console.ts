import { loadConfig } from '../../config.js';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import {
  listSites,
  SearchConsoleConfigurationError,
  SearchConsoleUnavailableError,
  sharedSearchConsoleToken,
} from '../../platform/integrations/google/search-console.js';
import { googleAuthConfigured } from '../../platform/integrations/google/token.js';
import { ProviderError } from './providers/types.js';
import { credentialsForConnection, markConnectionReconnectRequired } from './service.js';

/**
 * Search Console access for one organization.
 *
 * An organization reads Search Console through its OWN Google logins: the
 * company connections whose sign-in listed the property (Company connections).
 * The server's shared login (GOOGLE_SEARCH_CONSOLE_AUTH) serves only the one
 * organization named in GOOGLE_SEARCH_CONSOLE_ORGANIZATION. So an organization
 * never sees, links or reads a property through another organization's login.
 */

export interface SearchConsolePropertyAccess {
  /** As Search Console names it: `https://www.example.com/` or `sc-domain:example.com`. */
  readonly propertyUrl: string;
  readonly permissionLevel: string;
  /** The client the property is assigned to under Company connections, if any. */
  readonly clientId: string | null;
  readonly clientName: string | null;
  /** `company_login`: one of the organization's own Google logins. `shared_login`:
   * the server's shared login, for the one organization allowed to use it. */
  readonly source: 'company_login' | 'shared_login';
  /** The Google account that reads it, when known. */
  readonly account: string | null;
  readonly status: 'connected' | 'reconnect_required';
}

interface PropertyRow {
  connectionId: string;
  propertyUrl: string;
  permissionLevel: string | null;
  clientId: string | null;
  clientName: string | null;
  account: string | null;
  status: 'connected' | 'reconnect_required';
}

/** The property rows of the organization's live Google logins: assigned rows first,
 * then working logins before ones waiting for a reconnect. */
function companyProperties(ctx: RequestContext): Promise<PropertyRow[]> {
  return db.query<PropertyRow>(
    ctx,
    sql`SELECT l.connection_id, l.external_id AS property_url, l.metadata->>'permissionLevel' AS permission_level,
      l.client_id, COALESCE(NULLIF(cl.business_name, ''), cl.client_name) AS client_name,
      COALESCE(c.external_account_email, c.external_account_name) AS account, c.status
    FROM social_connection_location l
    JOIN social_connection c ON c.organization_id = l.organization_id AND c.id = l.connection_id
    LEFT JOIN client cl ON cl.organization_id = l.organization_id AND cl.id = l.client_id
    WHERE l.organization_id = ${ctx.organizationId} AND l.platform = 'search_console' AND l.status = 'available'
      AND c.client_id IS NULL AND c.status <> 'disconnected'
    ORDER BY (l.client_id IS NOT NULL) DESC, (c.status = 'connected') DESC, c.created_at, l.id`,
  );
}

/** Whether this organization is the one the shared login serves. */
async function sharedLoginAllowed(ctx: RequestContext): Promise<boolean> {
  const code = loadConfig().GOOGLE_SEARCH_CONSOLE_ORGANIZATION;
  if (!code || !googleAuthConfigured()) return false;
  const row = await db.maybeOne<{ code: string }>(
    ctx,
    sql`SELECT code FROM organization WHERE id = ${ctx.organizationId}`,
  );
  return row !== null && row.code.toUpperCase() === code.toUpperCase();
}

/** True when the organization has any way to read Search Console. */
export async function searchConsoleConnected(ctx: RequestContext): Promise<boolean> {
  const row = await db.maybeOne<{ found: number }>(
    ctx,
    sql`SELECT 1 AS found FROM social_connection_location l
      JOIN social_connection c ON c.organization_id = l.organization_id AND c.id = l.connection_id
      WHERE l.organization_id = ${ctx.organizationId} AND l.platform = 'search_console'
        AND c.client_id IS NULL AND c.status <> 'disconnected'
      LIMIT 1`,
  );
  return row !== null || (await sharedLoginAllowed(ctx));
}

/** Every Search Console property the organization can read, once each, with the
 * client it is assigned to. A problem listing the shared login's properties is
 * returned, not thrown, so the organization's own properties are still offered. */
export async function listSearchConsoleProperties(ctx: RequestContext): Promise<{
  properties: SearchConsolePropertyAccess[];
  problem: SearchConsoleConfigurationError | SearchConsoleUnavailableError | null;
}> {
  const found = new Map<string, SearchConsolePropertyAccess>();
  for (const row of await companyProperties(ctx))
    if (!found.has(row.propertyUrl))
      found.set(row.propertyUrl, {
        propertyUrl: row.propertyUrl,
        permissionLevel: row.permissionLevel ?? 'siteRestrictedUser',
        clientId: row.clientId,
        clientName: row.clientName,
        source: 'company_login',
        account: row.account,
        status: row.status,
      });
  let problem: SearchConsoleConfigurationError | SearchConsoleUnavailableError | null =
    null;
  if (await sharedLoginAllowed(ctx))
    try {
      for (const site of await listSites(await sharedSearchConsoleToken()))
        if (site.permissionLevel !== 'siteUnverifiedUser' && !found.has(site.siteUrl))
          found.set(site.siteUrl, {
            propertyUrl: site.siteUrl,
            permissionLevel: site.permissionLevel,
            clientId: null,
            clientName: null,
            source: 'shared_login',
            account: null,
            status: 'connected',
          });
    } catch (error) {
      if (!(
        error instanceof SearchConsoleConfigurationError ||
        error instanceof SearchConsoleUnavailableError
      ))
        throw error;
      problem = error;
    }
  return { properties: [...found.values()], problem };
}

/**
 * A token that reads `propertyUrl` for this organization: from the Google login the
 * property is assigned through, else any other working login that lists it, else —
 * for the one organization allowed — the shared login. A login Google stopped
 * accepting is marked for reconnect (admins are told once) and the next is tried.
 */
export async function searchConsoleToken(
  ctx: RequestContext,
  propertyUrl: string,
): Promise<string> {
  const candidates = (await companyProperties(ctx)).filter(
    (row) => row.propertyUrl === propertyUrl && row.status === 'connected',
  );
  let reconnect: string | null = null;
  for (const row of candidates) {
    const connection = {
      id: row.connectionId,
      clientId: null,
      platform: 'google_business' as const,
    };
    try {
      const credentials = await credentialsForConnection(
        ctx,
        connection,
        row.account ?? 'the company Google login',
      );
      return credentials.accessToken;
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      if (error.reconnectRequired) {
        await db.transaction(ctx, (tx) =>
          markConnectionReconnectRequired(tx, ctx, connection, error.message),
        );
        reconnect = `Google stopped accepting the login ${row.account ?? 'that reads this property'}. Reconnect it under Social → Company connections.`;
        continue;
      }
      // A refresh already under way, a rate limit or a Google outage passes.
      if (error.transient) throw new SearchConsoleUnavailableError(error.message);
      throw new SearchConsoleConfigurationError(error.message);
    }
  }
  if (await sharedLoginAllowed(ctx)) return sharedSearchConsoleToken();
  throw new SearchConsoleConfigurationError(
    reconnect ??
      `None of your organization’s Google logins can read ${propertyUrl}. Connect the Google account that has access to it under Social → Company connections.`,
  );
}
