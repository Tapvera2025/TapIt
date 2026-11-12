import { randomBytes, createHash } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  SOCIAL_COMPANY_PLATFORMS,
  type SocialCompanyConnection,
  type SocialCompanyPlatform,
  type SocialPortalCandidate,
  type SocialPortalPlatform,
} from '@tapcrm/contracts';
import { ApplicationError } from '../../errors.js';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import {
  decryptCredentials,
  encryptCredentials,
  hashState,
  safeEqual,
  socialBaseUrl,
  type CredentialContext,
} from './security.js';
import {
  getCompanyProvider,
  getProvider,
  listProviderReadiness,
} from './providers/index.js';
import {
  ProviderError,
  SOCIAL_PLATFORMS,
  type DiscoveredAccount,
  type ProviderIdentity,
  type SocialPlatform,
} from './providers/types.js';
import { discoverCompanyAssets, saveCompanyConnection } from './company.js';
import { platformAccountHolders, sameClientHolders } from './repository.js';
import { saveConnectionAccounts, sharesGrant } from './service.js';

const context = { organizationId: 'oauth', clientId: 'oauth', platform: 'oauth' };
const stateSchema = z.object({
  organizationId: z.string().uuid(),
  /** Null for a company-wide sign-in, which belongs to no single client. */
  clientId: z.string().uuid().nullable(),
  userId: z.string().uuid(),
  sessionVersion: z.number(),
  platform: z.enum(SOCIAL_PLATFORMS),
  /** Where the sign-in started. A client-portal sign-in returns to the client portal
   * and can only be completed there, by the same client login. States sealed before
   * this field existed were all started in the agency workspace. */
  surface: z.enum(['workspace', 'client_portal']).default('workspace'),
  nonce: z.string(),
  expiresAt: z.number(),
});
type State = z.infer<typeof stateSchema>;
/** `workspace`: the agency's Manage Social Media screens. `client_portal`: a client
 * connecting its own accounts. */
export type OAuthSurface = State['surface'];
const COOKIE = 'tapcrm_social_oauth';

function callbackUri(platform: SocialPlatform): string {
  return new URL(`/api/social/oauth/${platform}/callback`, socialBaseUrl()).href;
}
function cookieValue(req: Request): string {
  const entry = (req.headers.cookie ?? '')
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${COOKIE}=`));
  return entry ? entry.slice(COOKIE.length + 1) : '';
}
/** How long the agency has to choose a client's accounts once the platform has
 * authorized them. The sign-in itself must still return within 10 minutes. */
const SELECTION_MINUTES = 30;

/** `selection`: the sign-in already returned, and its database row (not the sealed
 * state's own 10 minutes) says how long the choice stays open. */
function readState(
  state: string,
  stage: 'authorization' | 'selection' = 'authorization',
): State {
  if (!state || state.length > 8192)
    throw new ApplicationError(
      'Invalid OAuth state. Start the connection again.',
      422,
      'SOCIAL_OAUTH_INVALID',
    );
  const parsed = stateSchema.safeParse(decryptCredentials<unknown>(state, context));
  if (!parsed.success)
    throw new ApplicationError(
      'Invalid OAuth state. Start the connection again.',
      422,
      'SOCIAL_OAUTH_INVALID',
    );
  const payload = parsed.data;
  if (stage === 'authorization' && payload.expiresAt <= Date.now())
    throw new ApplicationError(
      'The connection request expired. Start again.',
      422,
      'SOCIAL_OAUTH_EXPIRED',
    );
  return payload;
}
/** The PKCE verifier is sealed for the client being connected. A company sign-in has no
 * client and no connection yet, so its verifier is sealed to the authorization request. */
function verifierContext(
  organizationId: string,
  clientId: string | null,
  platform: SocialPlatform,
  stateHash: string,
): CredentialContext {
  return clientId === null
    ? { organizationId, connectionId: `authorization:${stateHash}`, platform }
    : { organizationId, clientId, platform };
}
function checkBrowser(req: Request, state: string): void {
  if (!safeEqual(cookieValue(req), hashState(state)))
    throw new ApplicationError(
      'OAuth browser validation failed. Start the connection in this browser again.',
      422,
      'SOCIAL_OAUTH_INVALID',
    );
}

/** A client-portal sign-in is only ever for the signed-in client's own CRM client. The
 * route's authorization already checks this; services check it again. */
function assertSurface(
  ctx: RequestContext,
  clientId: string | null,
  surface: OAuthSurface,
): void {
  if (surface === 'workspace') {
    if (ctx.principal.accountType === 'client')
      throw new ApplicationError(
        'Connect your accounts from the client portal.',
        403,
        'SOCIAL_CLIENT_PORTAL_ONLY',
      );
    return;
  }
  if (
    ctx.principal.accountType !== 'client' ||
    clientId === null ||
    ctx.principal.clientId !== clientId ||
    ctx.principal.organizationId !== ctx.organizationId
  )
    throw new ApplicationError(
      'Only the client’s own login can connect accounts here.',
      403,
      'SOCIAL_CLIENT_PORTAL_ONLY',
    );
}

/** What the client sees when a platform authorized no account it can use. */
const NO_PORTAL_ACCOUNTS: Partial<Record<SocialPlatform, string>> = {
  facebook:
    'No Facebook Page was found that this Facebook login can post to. Sign in with a login that manages the Page (with content permission), and keep the Pages selected on Facebook’s screen.',
  instagram:
    'No Instagram professional account was found. Instagram must be a Business or Creator account linked to a Facebook Page that this Facebook login manages, and Instagram must be allowed on Facebook’s screen.',
  youtube:
    'No YouTube channel was found for the Google account you chose. Choose the account or Brand Account that owns the channel.',
};

function companyPlatform(platform: SocialPlatform): SocialCompanyPlatform {
  const match = SOCIAL_COMPANY_PLATFORMS.find((item) => item === platform);
  if (!match)
    throw new ApplicationError(
      'This platform cannot be connected for the whole company.',
      422,
      'SOCIAL_COMPANY_UNSUPPORTED',
    );
  return match;
}

/** Starts a platform sign-in for one client, or for the whole company (`clientId` null).
 * A company sign-in asks for what the company provider lists: a Meta login asks for its
 * Pages and their Instagram accounts, a Google login also for Search Console. */
export async function startOAuth(
  ctx: RequestContext,
  clientId: string | null,
  platform: SocialPlatform,
  res: Response,
  options: { surface?: OAuthSurface } = {},
) {
  const surface = options.surface ?? 'workspace';
  assertSurface(ctx, clientId, surface);
  const provider =
    clientId === null
      ? getCompanyProvider(companyPlatform(platform))
      : getProvider(platform);
  const state = encryptCredentials<State>(
    {
      organizationId: ctx.organizationId,
      clientId,
      userId: ctx.principal.id,
      sessionVersion: ctx.principal.sessionVersion,
      platform,
      surface,
      nonce: randomBytes(32).toString('base64url'),
      expiresAt: Date.now() + 600_000,
    },
    context,
  );
  const verifier = randomBytes(48).toString('base64url');
  const stateHash = hashState(state);
  await db.transaction(ctx, async (tx) => {
    await tx.query(
      sql`DELETE FROM social_oauth_state WHERE organization_id = ${ctx.organizationId} AND expires_at < now()`,
    );
    await tx.query(sql`
      INSERT INTO social_oauth_state (organization_id,client_id,state_hash,platform,created_by,verifier_encrypted,expires_at,surface)
      VALUES (${ctx.organizationId},${clientId},${stateHash},${platform},${ctx.principal.id},
        ${encryptCredentials({ verifier }, verifierContext(ctx.organizationId, clientId, platform, stateHash))},now() + interval '10 minutes',${surface})
    `);
    await tx.query(sql`INSERT INTO social_audit_log (organization_id,client_id,actor_id,action,details)
      VALUES (${ctx.organizationId},${clientId},${ctx.principal.id},'oauth.started',${JSON.stringify({ platform, scope: clientId === null ? 'company' : 'client', surface })}::jsonb)`);
  });
  res.cookie(COOKIE, hashState(state), {
    httpOnly: true,
    secure: socialBaseUrl().protocol === 'https:',
    sameSite: 'lax',
    path: '/api/social',
    maxAge: 600_000,
  });
  return {
    authorizationUrl: provider.getAuthorizationUrl({
      state,
      redirectUri: callbackUri(platform),
      ...(provider.supportsPkce
        ? { codeChallenge: createHash('sha256').update(verifier).digest('base64url') }
        : {}),
    }),
  };
}

export async function completeOAuth(
  ctx: RequestContext,
  clientId: string,
  platform: SocialPlatform,
  input: { code: string; state: string },
  req: Request,
  res: Response,
  options: { surface?: OAuthSurface } = {},
) {
  const surface = options.surface ?? 'workspace';
  assertSurface(ctx, clientId, surface);
  const state = readState(input.state);
  checkBrowser(req, input.state);
  if (
    state.organizationId !== ctx.organizationId ||
    state.clientId !== clientId ||
    state.userId !== ctx.principal.id ||
    state.sessionVersion !== ctx.principal.sessionVersion ||
    state.platform !== platform ||
    state.surface !== surface
  )
    throw new ApplicationError(
      'This connection belongs to a different CRM session or client.',
      422,
      'SOCIAL_OAUTH_INVALID',
    );
  const consumed = await db.transaction(ctx, (tx) =>
    tx.maybeOne<{ verifierEncrypted: string }>(sql`
    UPDATE social_oauth_state SET consumed_at = now()
    WHERE organization_id = ${ctx.organizationId} AND client_id = ${clientId} AND state_hash = ${hashState(input.state)}
      AND created_by = ${ctx.principal.id} AND platform = ${platform} AND surface = ${surface} AND consumed_at IS NULL AND expires_at > now()
    RETURNING verifier_encrypted
  `),
  );
  if (!consumed)
    throw new ApplicationError(
      'This connection request was already used or expired. Start again.',
      422,
      'SOCIAL_OAUTH_INVALID',
    );
  res.clearCookie(COOKIE, { path: '/api/social' });
  const { verifier } = decryptCredentials<{ verifier: string }>(
    consumed.verifierEncrypted,
    verifierContext(ctx.organizationId, clientId, platform, hashState(input.state)),
  );
  const provider = getProvider(platform);
  try {
    const credentials = await provider.exchangeCode({
      code: input.code,
      redirectUri: callbackUri(platform),
      ...(provider.supportsPkce ? { codeVerifier: verifier } : {}),
    });
    const accounts = await provider.discoverAccounts(credentials);
    if (!accounts.length)
      throw new ApplicationError(
        (surface === 'client_portal' ? NO_PORTAL_ACCOUNTS[platform] : undefined) ??
          'No supported accounts were authorized. Check account type and platform permissions.',
        422,
        'SOCIAL_NO_ACCOUNTS',
      );
    // Who signed in, where one grant serves every connection that user makes (Meta), so
    // revoking it later can flag the others. Never a reason to refuse the connection.
    const identity: ProviderIdentity | null =
      sharesGrant(platform) && provider.getAuthorizedIdentity
        ? await provider.getAuthorizedIdentity(credentials).catch(() => null)
        : null;
    // Retain discovery credentials encrypted until the agency explicitly chooses this
    // client's accounts. Say which ones another client already uses: a Page serves one.
    const { holders, own } = await db.transaction(ctx, async (tx) => {
      await tx.query(sql`
        UPDATE social_oauth_state SET verifier_encrypted = ${encryptCredentials({ stage: 'selection', accounts, identity }, { organizationId: ctx.organizationId, clientId, platform })},
          expires_at = now() + make_interval(mins => ${SELECTION_MINUTES})
        WHERE organization_id = ${ctx.organizationId} AND client_id = ${clientId} AND state_hash = ${hashState(input.state)} AND surface = ${surface}
      `);
      return {
        holders: await platformAccountHolders(tx, ctx.organizationId, accounts, clientId),
        own: await sameClientHolders(tx, ctx.organizationId, accounts, clientId),
      };
    });
    if (surface === 'client_portal')
      return {
        state: input.state,
        platform: platform as SocialPortalPlatform,
        expiresInMinutes: SELECTION_MINUTES,
        // No other client's name, and nothing about the agency's logins.
        candidates: accounts.map(
          ({ platform: accountPlatform, externalId, name, profileImageUrl }) => {
            const key = `${accountPlatform}:${externalId}`;
            const current = own.get(key);
            const availability: SocialPortalCandidate['availability'] = holders.has(key)
              ? 'unavailable'
              : current === 'agency'
                ? 'managed_by_agency'
                : current === 'client_portal'
                  ? 'reconnect'
                  : 'available';
            return {
              platform: accountPlatform,
              externalId,
              name,
              profileImageUrl: profileImageUrl ?? null,
              availability,
            };
          },
        ),
      };
    return {
      state: input.state,
      expiresInMinutes: SELECTION_MINUTES,
      candidates: accounts.map(
        ({
          platform: accountPlatform,
          externalId,
          name,
          profileImageUrl,
          capabilities,
        }) => {
          const holder = holders.get(`${accountPlatform}:${externalId}`);
          // The client connected it itself from the client portal: the agency does not
          // replace that sign-in; the client reconnects it, or it is disconnected first.
          const clientOwned =
            own.get(`${accountPlatform}:${externalId}`) === 'client_portal';
          return {
            platform: accountPlatform,
            externalId,
            name,
            profileImageUrl,
            capabilities,
            assignedTo: holder
              ? { clientName: holder.clientName, viaCompany: holder.viaCompany }
              : clientOwned
                ? { clientName: null, viaCompany: false, viaClientPortal: true }
                : null,
          };
        },
      ),
    };
  } catch (error) {
    // A provider's own messages speak to the agency (app approval, account roles). A
    // client is told what it can do about it instead.
    if (surface === 'client_portal' && error instanceof ProviderError)
      throw error.code === 'OAUTH_PERMISSIONS_MISSING'
        ? new ApplicationError(
            'Some permissions were switched off on the platform’s screen, so posts could not be published. Connect again and keep every requested permission switched on.',
            422,
            'SOCIAL_OAUTH_PERMISSIONS_MISSING',
          )
        : error.code === 'YOUTUBE_CHANNEL_MISSING' && NO_PORTAL_ACCOUNTS.youtube
          ? new ApplicationError(NO_PORTAL_ACCOUNTS.youtube, 422, 'SOCIAL_NO_ACCOUNTS')
          : new ApplicationError(
              'The platform could not complete the connection. Try again, or ask your agency for help.',
              422,
              'SOCIAL_OAUTH_FAILED',
            );
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError(
      surface === 'client_portal'
        ? 'The platform could not complete the connection. Try again, or ask your agency for help.'
        : 'The platform could not complete the connection. Check app approval, consent and callback configuration, then reconnect.',
      422,
      'SOCIAL_OAUTH_FAILED',
    );
  }
}

/** Completes a company-wide sign-in: one stored token for the signed-in platform account,
 * and every location it manages listed for assignment to clients. */
export async function completeCompanyOAuth(
  ctx: RequestContext,
  platform: SocialCompanyPlatform,
  input: { code: string; state: string },
  req: Request,
  res: Response,
): Promise<SocialCompanyConnection> {
  const state = readState(input.state);
  checkBrowser(req, input.state);
  if (
    state.organizationId !== ctx.organizationId ||
    state.clientId !== null ||
    state.userId !== ctx.principal.id ||
    state.sessionVersion !== ctx.principal.sessionVersion ||
    state.platform !== platform ||
    state.surface !== 'workspace'
  )
    throw new ApplicationError(
      'This connection belongs to a different CRM session.',
      422,
      'SOCIAL_OAUTH_INVALID',
    );
  const stateHash = hashState(input.state);
  const consumed = await db.transaction(ctx, (tx) =>
    tx.maybeOne<{ verifierEncrypted: string }>(sql`
    UPDATE social_oauth_state SET consumed_at = now()
    WHERE organization_id = ${ctx.organizationId} AND client_id IS NULL AND state_hash = ${stateHash}
      AND created_by = ${ctx.principal.id} AND platform = ${platform} AND surface = 'workspace' AND consumed_at IS NULL AND expires_at > now()
    RETURNING verifier_encrypted
  `),
  );
  if (!consumed)
    throw new ApplicationError(
      'This connection request was already used or expired. Start again.',
      422,
      'SOCIAL_OAUTH_INVALID',
    );
  res.clearCookie(COOKIE, { path: '/api/social' });
  const { verifier } = decryptCredentials<{ verifier: string }>(
    consumed.verifierEncrypted,
    verifierContext(ctx.organizationId, null, platform, stateHash),
  );
  const provider = getCompanyProvider(platform);
  try {
    if (!provider.getAuthorizedIdentity)
      throw new ApplicationError(
        'This platform cannot be connected for the whole company.',
        422,
        'SOCIAL_COMPANY_UNSUPPORTED',
      );
    const credentials = await provider.exchangeCode({
      code: input.code,
      redirectUri: callbackUri(platform),
      ...(provider.supportsPkce ? { codeVerifier: verifier } : {}),
    });
    const identity = await provider.getAuthorizedIdentity(credentials);
    const discovery = await discoverCompanyAssets(platform, credentials);
    const connection = await saveCompanyConnection(
      ctx,
      platform,
      credentials,
      identity,
      discovery.assets,
      discovery.warning,
    );
    await db.query(
      ctx,
      sql`DELETE FROM social_oauth_state WHERE organization_id = ${ctx.organizationId} AND state_hash = ${stateHash}`,
    );
    return connection;
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError(
      'The platform could not complete the connection. Check app approval, consent and callback configuration, then reconnect.',
      422,
      'SOCIAL_OAUTH_FAILED',
    );
  }
}

export async function selectOAuthAccounts(
  ctx: RequestContext,
  clientId: string,
  platform: SocialPlatform,
  input: { state: string; accountIds: string[] },
  options: { surface?: OAuthSurface } = {},
) {
  const surface = options.surface ?? 'workspace';
  assertSurface(ctx, clientId, surface);
  const state = readState(input.state, 'selection');
  if (
    state.organizationId !== ctx.organizationId ||
    state.clientId !== clientId ||
    state.userId !== ctx.principal.id ||
    state.sessionVersion !== ctx.principal.sessionVersion ||
    state.platform !== platform ||
    state.surface !== surface
  )
    throw new ApplicationError(
      'Connection session mismatch. Start again.',
      422,
      'SOCIAL_OAUTH_INVALID',
    );
  const stateHash = hashState(input.state);
  const used = () =>
    new ApplicationError(
      'Connection selection expired or was already used. Start again.',
      422,
      'SOCIAL_OAUTH_INVALID',
    );
  const accounts = await db.transaction(ctx, async (tx) => {
    const row = await tx.maybeOne<{ verifierEncrypted: string }>(sql`
      SELECT verifier_encrypted FROM social_oauth_state WHERE organization_id = ${ctx.organizationId} AND client_id = ${clientId}
        AND state_hash = ${stateHash} AND created_by = ${ctx.principal.id} AND platform = ${platform} AND surface = ${surface}
        AND consumed_at IS NOT NULL AND expires_at > now()
    `);
    if (!row) throw used();
    const pending = decryptCredentials<{
      stage: string;
      accounts: DiscoveredAccount[];
      identity?: ProviderIdentity | null;
    }>(row.verifierEncrypted, { organizationId: ctx.organizationId, clientId, platform });
    if (pending.stage !== 'selection')
      throw new ApplicationError(
        'Complete platform authorization first.',
        422,
        'SOCIAL_OAUTH_INVALID',
      );
    const selected = pending.accounts.filter((account) =>
      input.accountIds.includes(account.externalId),
    );
    if (selected.length !== new Set(input.accountIds).size || !selected.length)
      throw new ApplicationError(
        'Select at least one of the authorized accounts.',
        422,
        'SOCIAL_OAUTH_INVALID',
      );
    return { selected, identity: pending.identity ?? null };
  });
  // The sign-in is used up together with the save, never before it: if one of the
  // accounts is refused (another client uses it), the choice can be corrected.
  return saveConnectionAccounts(ctx, clientId, accounts.selected, {
    grantedBy: accounts.identity,
    origin: surface === 'client_portal' ? 'client_portal' : 'agency',
    consume: async (tx) => {
      const consumed = await tx.maybeOne<{ stateHash: string }>(
        sql`DELETE FROM social_oauth_state WHERE organization_id = ${ctx.organizationId} AND client_id = ${clientId} AND state_hash = ${stateHash}
          AND created_by = ${ctx.principal.id} AND surface = ${surface} AND consumed_at IS NOT NULL AND expires_at > now() RETURNING state_hash`,
      );
      if (!consumed) throw used();
    },
  });
}

/** Bearer-based CRM sessions cannot accompany a provider redirect. Relay the short-lived
 * authorization code in a fragment, then complete using the existing authenticated API.
 * A sealed state, browser-bound HttpOnly cookie and single-use database row protect both legs. */
export function buildSocialOAuthRouter(): Router {
  const router = Router();
  router.get('/:platform/callback', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const platform = z.enum(SOCIAL_PLATFORMS).parse(req.params['platform']);
      const state = z.string().max(8192).parse(req.query['state']);
      const payload = readState(state);
      checkBrowser(req, state);
      if (payload.platform !== platform) throw new Error('provider mismatch');
      // One registered callback serves every kind of sign-in; the sealed state says which.
      const scope = payload.clientId === null ? 'company' : 'client';
      const portal = payload.surface === 'client_portal';
      const data = req.query['error']
        ? {
            error: 'SOCIAL_OAUTH_DENIED',
            message: 'Authorization was declined. You can connect again.',
            platform,
            scope,
            clientId: payload.clientId,
          }
        : {
            code: z.string().min(1).max(8192).parse(req.query['code']),
            state,
            platform,
            scope,
            clientId: payload.clientId,
          };
      // Fixed destinations only: nothing from the request chooses where this redirects.
      const destination = new URL(
        portal
          ? '/client/social'
          : scope === 'company'
            ? '/company/social/connections'
            : '/company/social',
        socialBaseUrl(),
      );
      destination.hash = `social-oauth=${encodeURIComponent(JSON.stringify(data))}`;
      res.redirect(303, destination.href);
    } catch {
      res
        .status(400)
        .type('text/plain')
        .send(
          'Social connection validation failed. Return to CRM Connected Accounts and start again.',
        );
    }
  });
  return router;
}

export function providerReadiness() {
  return listProviderReadiness();
}
