import type { Request, Response } from 'express';
import {
  SOCIAL_PORTAL_PLATFORMS,
  type SocialPortalAccount,
  type SocialPortalOverview,
  type SocialPortalPlatform,
  type SocialPortalProvider,
  type SocialPortalDisconnectResult,
} from '@tapcrm/contracts';
import { ApplicationError } from '../../errors.js';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { requireModuleEnabled } from '../../platform/module-entitlement.js';
import { completeOAuth, selectOAuthAccounts, startOAuth } from './oauth.js';
import { getProvider, getProviderReadiness } from './providers/index.js';
import type { OAuthCredential, SocialPlatform } from './providers/types.js';
import { ensureClient, findAccounts } from './repository.js';
import { decryptCredentials, socialSecurityReady } from './security.js';
import {
  connectionCredentialContext,
  disconnectAccount,
  getAccountConnection,
  markGrantRevoked,
  sharesGrant,
} from './service.js';
import type { AccountRow } from './types.js';

/**
 * The client portal's side of social connections: a client signs in to a platform
 * and chooses which of its own accounts the agency may publish to.
 *
 * Every route here is bound to `social:connect-own-accounts`, which only client
 * principals hold, and the framework has already checked that the route's client is
 * the principal's own (A2 and the socialWorkspace resource policy). These functions
 * check it again, together with the organization, the client-portal module and the
 * client being active, so a mistake in one layer is not enough to reach another
 * client. Nothing returned here carries a token, an OAuth scope or another client's
 * details.
 */

/** Google's Business Profile API policy, read 2026-11-12, does not clearly allow one
 * CRM-owned API project to serve unrelated businesses' automated posting
 * (https://developers.google.com/my-business/content/policies). Until that is settled
 * in writing, Business Profile stays an agency connection only. */
const GOOGLE_BUSINESS_PORTAL_MESSAGE =
  'Google Business Profile can’t be connected from the client portal yet. Your agency manages Business Profile posting for you; ask them if you need a change.';

const NAMES: Record<SocialPortalPlatform, string> = {
  facebook: 'Facebook Page',
  instagram: 'Instagram professional account',
  youtube: 'YouTube channel',
  google_business: 'Google Business Profile',
};

const REQUIREMENTS: Record<SocialPortalPlatform, string[]> = {
  facebook: [
    'A Facebook Page (personal profiles cannot be connected).',
    'A Facebook login that can create content on that Page.',
  ],
  instagram: [
    'An Instagram Business or Creator account (personal accounts are not supported).',
    'The Instagram account linked to a Facebook Page.',
    'A Facebook login that manages that Page. You sign in with Facebook, not Instagram.',
  ],
  youtube: [
    'A YouTube channel. You choose the Google account or Brand Account that owns it.',
    'Posting to YouTube means uploading videos.',
  ],
  google_business: [],
};

/** The signed-in client, connecting accounts for its own CRM client and nothing else. */
async function requireOwnClient(ctx: RequestContext, clientId: string): Promise<void> {
  if (
    ctx.principal.accountType !== 'client' ||
    ctx.principal.clientId !== clientId ||
    ctx.principal.organizationId !== ctx.organizationId
  )
    throw new ApplicationError(
      'Only the client’s own login can manage these connections.',
      403,
      'SOCIAL_CLIENT_PORTAL_ONLY',
    );
  await requireModuleEnabled(ctx, 'client-portal');
  await db.transaction(ctx, (tx) => ensureClient(tx, ctx.organizationId, clientId));
}

function portalPlatform(platform: SocialPlatform): SocialPortalPlatform {
  const match = SOCIAL_PORTAL_PLATFORMS.find((item) => item === platform);
  if (!match)
    throw new ApplicationError(
      'This platform can’t be connected from the client portal. Ask your agency.',
      422,
      'SOCIAL_PORTAL_UNSUPPORTED',
    );
  return match;
}

function providerStatus(platform: SocialPortalPlatform): SocialPortalProvider {
  const base = { platform, name: NAMES[platform], requirements: REQUIREMENTS[platform] };
  if (platform === 'google_business')
    return { ...base, status: 'unavailable', message: GOOGLE_BUSINESS_PORTAL_MESSAGE };
  // A client is never shown configuration names or approval details.
  if (!socialSecurityReady() || getProviderReadiness(platform).status !== 'ready')
    return {
      ...base,
      status: 'setup_required',
      message: `Your agency hasn’t finished setting up ${NAMES[platform]} connections yet.`,
    };
  return { ...base, status: 'ready', message: '' };
}

/** A platform the client can start a sign-in for right now. */
function readyPlatform(platform: SocialPlatform): SocialPortalPlatform {
  const allowed = portalPlatform(platform);
  const status = providerStatus(allowed);
  if (status.status !== 'ready')
    throw new ApplicationError(status.message, 422, 'SOCIAL_SETUP_REQUIRED');
  return allowed;
}

function accountDto(row: AccountRow): SocialPortalAccount {
  const own = row.connectionOrigin === 'client_portal';
  return {
    id: row.id,
    platform: row.platform,
    name: row.name,
    profileImageUrl: row.profileImageUrl,
    status: row.status,
    managedBy: own ? 'client' : 'agency',
    connectedAt: row.connectedAt.toISOString(),
    lastError: own ? row.lastError : null,
  };
}

export async function getPortalOverview(
  ctx: RequestContext,
  clientId: string,
): Promise<SocialPortalOverview> {
  await requireOwnClient(ctx, clientId);
  const rows = await db.transaction(ctx, (tx) =>
    findAccounts(tx, ctx.organizationId, clientId),
  );
  return {
    clientId,
    providers: SOCIAL_PORTAL_PLATFORMS.map(providerStatus),
    // The client's own disconnected accounts stay listed so it can reconnect them; the
    // agency's are its own history.
    accounts: rows
      .filter(
        (row) =>
          row.status !== 'disconnected' || row.connectionOrigin === 'client_portal',
      )
      .map(accountDto),
  };
}

export async function startPortalConnection(
  ctx: RequestContext,
  clientId: string,
  platform: SocialPlatform,
  res: Response,
): Promise<{ authorizationUrl: string }> {
  await requireOwnClient(ctx, clientId);
  readyPlatform(platform);
  return startOAuth(ctx, clientId, platform, res, { surface: 'client_portal' });
}

export async function completePortalConnection(
  ctx: RequestContext,
  clientId: string,
  platform: SocialPlatform,
  input: { code: string; state: string },
  req: Request,
  res: Response,
) {
  await requireOwnClient(ctx, clientId);
  portalPlatform(platform);
  return completeOAuth(ctx, clientId, platform, input, req, res, {
    surface: 'client_portal',
  });
}

export async function selectPortalAccounts(
  ctx: RequestContext,
  clientId: string,
  platform: SocialPlatform,
  input: { state: string; accountIds: string[] },
): Promise<SocialPortalOverview> {
  await requireOwnClient(ctx, clientId);
  portalPlatform(platform);
  await selectOAuthAccounts(ctx, clientId, platform, input, { surface: 'client_portal' });
  return getPortalOverview(ctx, clientId);
}

/** Disconnects one of the client's own accounts. Its token is removed and its scheduled
 * posts are cancelled. Revoking the platform permission is a separate, explicit choice:
 * it removes TapIt's access for that whole platform login, not only this account. An
 * account the agency manages is never changed from here. */
export async function disconnectPortalAccount(
  ctx: RequestContext,
  clientId: string,
  accountId: string,
  revokeGrant: boolean,
): Promise<SocialPortalDisconnectResult> {
  await requireOwnClient(ctx, clientId);
  const account = await getAccountConnection(ctx, clientId, accountId);
  if (
    account.connectionOrigin !== 'client_portal' ||
    account.connectionClientId !== clientId
  )
    throw new ApplicationError(
      'Your agency manages this account. Ask them if it should be disconnected.',
      403,
      'SOCIAL_AGENCY_MANAGED',
    );
  // A Meta revoke removes TapIt from the whole Facebook login. When the agency's own
  // company login is that same Facebook user, revoking would cut the agency off too, so
  // the client disconnects here and settles the platform side with the agency.
  if (
    revokeGrant &&
    sharesGrant(account.connectionPlatform) &&
    account.connectionExternalAccountId
  ) {
    const agencyUses = await db.maybeOne<{ found: boolean }>(
      ctx,
      sql`SELECT true AS found FROM social_connection
        WHERE organization_id = ${ctx.organizationId} AND platform = ANY(${['facebook', 'instagram']}::text[])
          AND external_account_id = ${account.connectionExternalAccountId} AND client_id IS NULL AND status <> 'disconnected'
        LIMIT 1`,
    );
    if (agencyUses)
      throw new ApplicationError(
        'Your agency also uses this Facebook login for its own connection, so its access can’t be removed from here. Disconnect the account without removing access, and talk to your agency about the login.',
        409,
        'SOCIAL_REVOKE_AFFECTS_AGENCY',
      );
  }
  let revocationStatus: SocialPortalDisconnectResult['revocationStatus'] =
    'not_requested';
  if (revokeGrant) {
    revocationStatus = 'remove_access_in_platform_settings';
    if (account.credentialsEncrypted) {
      try {
        const credentials = decryptCredentials<OAuthCredential>(
          account.credentialsEncrypted,
          connectionCredentialContext(ctx.organizationId, {
            id: account.connectionId,
            clientId,
            platform: account.connectionPlatform,
          }),
        );
        await getProvider(account.connectionPlatform).revoke(credentials);
        revocationStatus = 'revoked';
      } catch {
        // The platform's own settings are the way to remove access then; nothing
        // about the failure (it may quote the token) is passed on.
        revocationStatus = 'remove_access_in_platform_settings';
      }
    }
  }
  const { cancelledScheduledPosts } = await disconnectAccount(ctx, clientId, accountId);
  const othersNeedReconnect =
    revocationStatus === 'revoked'
      ? await markGrantRevoked(ctx, {
          platform: account.connectionPlatform,
          externalAccountId: account.connectionExternalAccountId,
          connectionId: account.connectionId,
        })
      : 0;
  return {
    disconnected: true,
    revocationStatus,
    othersNeedReconnect,
    cancelledScheduledPosts,
  };
}
