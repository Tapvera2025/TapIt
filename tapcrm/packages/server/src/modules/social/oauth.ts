import { randomBytes, createHash } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { SocialCompanyConnection, SocialCompanyPlatform } from '@tapcrm/contracts';
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
import { getProvider, listProviderReadiness } from './providers/index.js';
import {
  SOCIAL_PLATFORMS,
  type DiscoveredAccount,
  type SocialPlatform,
} from './providers/types.js';
import { saveCompanyConnection } from './company.js';
import { saveConnectionAccounts } from './service.js';

const context = { organizationId: 'oauth', clientId: 'oauth', platform: 'oauth' };
const stateSchema = z.object({
  organizationId: z.string().uuid(),
  /** Null for a company-wide sign-in, which belongs to no single client. */
  clientId: z.string().uuid().nullable(),
  userId: z.string().uuid(),
  sessionVersion: z.number(),
  platform: z.enum(SOCIAL_PLATFORMS),
  nonce: z.string(),
  expiresAt: z.number(),
});
type State = z.infer<typeof stateSchema>;
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
function readState(state: string): State {
  if (!state || state.length > 8192)
    throw new ApplicationError(
      'Invalid OAuth state. Start the connection again.',
      422,
      'SOCIAL_OAUTH_INVALID',
    );
  const payload = stateSchema.parse(decryptCredentials<unknown>(state, context));
  if (payload.expiresAt <= Date.now())
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

/** Starts a platform sign-in for one client, or for the whole company (`clientId` null). */
export async function startOAuth(
  ctx: RequestContext,
  clientId: string | null,
  platform: SocialPlatform,
  res: Response,
) {
  const provider = getProvider(platform);
  const state = encryptCredentials<State>(
    {
      organizationId: ctx.organizationId,
      clientId,
      userId: ctx.principal.id,
      sessionVersion: ctx.principal.sessionVersion,
      platform,
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
      INSERT INTO social_oauth_state (organization_id,client_id,state_hash,platform,created_by,verifier_encrypted,expires_at)
      VALUES (${ctx.organizationId},${clientId},${stateHash},${platform},${ctx.principal.id},
        ${encryptCredentials({ verifier }, verifierContext(ctx.organizationId, clientId, platform, stateHash))},now() + interval '10 minutes')
    `);
    await tx.query(sql`INSERT INTO social_audit_log (organization_id,client_id,actor_id,action,details)
      VALUES (${ctx.organizationId},${clientId},${ctx.principal.id},'oauth.started',${JSON.stringify({ platform, scope: clientId === null ? 'company' : 'client' })}::jsonb)`);
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
) {
  const state = readState(input.state);
  checkBrowser(req, input.state);
  if (
    state.organizationId !== ctx.organizationId ||
    state.clientId !== clientId ||
    state.userId !== ctx.principal.id ||
    state.sessionVersion !== ctx.principal.sessionVersion ||
    state.platform !== platform
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
      AND created_by = ${ctx.principal.id} AND platform = ${platform} AND consumed_at IS NULL AND expires_at > now()
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
        'No supported accounts were authorized. Check account type and platform permissions.',
        422,
        'SOCIAL_NO_ACCOUNTS',
      );
    // Retain discovery credentials encrypted until the agency explicitly chooses this client's accounts.
    await db.transaction(ctx, (tx) =>
      tx.query(sql`
      UPDATE social_oauth_state SET verifier_encrypted = ${encryptCredentials({ stage: 'selection', accounts }, { organizationId: ctx.organizationId, clientId, platform })}
      WHERE organization_id = ${ctx.organizationId} AND client_id = ${clientId} AND state_hash = ${hashState(input.state)}
    `),
    );
    return {
      state: input.state,
      candidates: accounts.map(
        ({
          platform: accountPlatform,
          externalId,
          name,
          profileImageUrl,
          capabilities,
        }) => ({
          platform: accountPlatform,
          externalId,
          name,
          profileImageUrl,
          capabilities,
        }),
      ),
    };
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError(
      'The platform could not complete the connection. Check app approval, consent and callback configuration, then reconnect.',
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
    state.platform !== platform
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
      AND created_by = ${ctx.principal.id} AND platform = ${platform} AND consumed_at IS NULL AND expires_at > now()
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
  const provider = getProvider(platform);
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
    const locations = await provider.discoverAccounts(credentials);
    const connection = await saveCompanyConnection(
      ctx,
      platform,
      credentials,
      identity,
      locations,
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
) {
  const state = readState(input.state);
  if (
    state.organizationId !== ctx.organizationId ||
    state.clientId !== clientId ||
    state.userId !== ctx.principal.id ||
    state.sessionVersion !== ctx.principal.sessionVersion ||
    state.platform !== platform
  )
    throw new ApplicationError(
      'Connection session mismatch. Start again.',
      422,
      'SOCIAL_OAUTH_INVALID',
    );
  const accounts = await db.transaction(ctx, async (tx) => {
    const row = await tx.maybeOne<{ verifierEncrypted: string }>(sql`
      SELECT verifier_encrypted FROM social_oauth_state WHERE organization_id = ${ctx.organizationId} AND client_id = ${clientId}
        AND state_hash = ${hashState(input.state)} AND created_by = ${ctx.principal.id} AND platform = ${platform}
        AND consumed_at IS NOT NULL AND expires_at > now() FOR UPDATE
    `);
    if (!row)
      throw new ApplicationError(
        'Connection selection expired or was already used. Start again.',
        422,
        'SOCIAL_OAUTH_INVALID',
      );
    const pending = decryptCredentials<{ stage: string; accounts: DiscoveredAccount[] }>(
      row.verifierEncrypted,
      { organizationId: ctx.organizationId, clientId, platform },
    );
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
    await tx.query(
      sql`DELETE FROM social_oauth_state WHERE organization_id = ${ctx.organizationId} AND state_hash = ${hashState(input.state)}`,
    );
    return selected;
  });
  return saveConnectionAccounts(ctx, clientId, accounts);
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
      // One registered callback serves both kinds of sign-in; the sealed state says which.
      const scope = payload.clientId === null ? 'company' : 'client';
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
      const destination = new URL(
        scope === 'company' ? '/company/social/connections' : '/company/social',
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
