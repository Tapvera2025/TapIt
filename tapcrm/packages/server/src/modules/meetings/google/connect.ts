import { randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { loadConfig } from '../../../config.js';
import { ApplicationError } from '../../../errors.js';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import {
  GoogleAuthUnavailableError,
  exchangeGoogleAuthorizationCode,
  revokeGoogleToken,
} from '../../../platform/integrations/google/token.js';
import { calendarMode, forgetCalendarToken, type CalendarMode } from './access.js';
import { CALENDAR_SCOPES } from './calendar.js';
import { hashState, openSecret, sameHash, sealSecret } from './crypto.js';

/**
 * "Connect Google Calendar" (MEETINGS_GOOGLE_AUTH=oauth).
 *
 * Bearer-token sessions cannot ride along on Google's redirect, so the
 * callback only relays the short-lived code to the app in a URL fragment and
 * the app completes the sign-in through the authenticated API. A random state,
 * kept as a hash in a single-use row and in an HttpOnly cookie for this
 * browser, ties the two legs together (the Social module does the same).
 */

const COOKIE = 'tapcrm_calendar_oauth';
const STATE_TTL_MS = 10 * 60_000;

/** Both legs — Google's callback and the app's completion call — live under here. */
function cookiePath(): string {
  return `${loadConfig().API_BASE_PATH}/meetings`;
}

function apiOrigin(): URL {
  return new URL(loadConfig().CLIENT_ORIGIN);
}

export function calendarRedirectUri(): string {
  return new URL(`${loadConfig().API_BASE_PATH}/meetings/google/callback`, apiOrigin()).href;
}

function cookieValue(req: Request): string {
  const entry = (req.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`));
  return entry ? decodeURIComponent(entry.slice(COOKIE.length + 1)) : '';
}

function invalid(message = 'This Google sign-in has expired or was already used. Start again.'): ApplicationError {
  return new ApplicationError(message, 422, 'MEETINGS_CALENDAR_SIGN_IN_INVALID');
}

export interface CalendarConnectionStatus {
  readonly mode: CalendarMode;
  readonly connected: boolean;
  readonly accountEmail: string | null;
  readonly needsReconnect: boolean;
  readonly lastError: string | null;
  readonly connectedAt: Date | null;
}

export async function calendarConnectionStatus(ctx: RequestContext): Promise<CalendarConnectionStatus> {
  const mode = calendarMode();
  if (mode !== 'oauth') {
    return { mode, connected: mode === 'service-account', accountEmail: null, needsReconnect: false, lastError: null, connectedAt: null };
  }
  const row = await db.maybeOne<{ accountEmail: string | null; status: string; lastError: string | null; connectedAt: Date }>(ctx, sql`
    SELECT account_email::text AS "accountEmail", status, last_error AS "lastError", connected_at AS "connectedAt"
      FROM calendar_connection WHERE organization_id = ${ctx.organizationId} AND user_id = ${ctx.principal.id}
  `);
  return {
    mode,
    connected: row?.status === 'active',
    accountEmail: row?.accountEmail ?? null,
    needsReconnect: row?.status === 'needs_reconnect',
    lastError: row?.lastError ?? null,
    connectedAt: row?.connectedAt ?? null,
  };
}

function requireOauthMode(): void {
  if (calendarMode() !== 'oauth') {
    throw new ApplicationError(
      'Google Calendar connections are not switched on for this company (MEETINGS_GOOGLE_AUTH).',
      409,
      'MEETINGS_CALENDAR_NOT_CONFIGURED',
    );
  }
}

export async function startCalendarConnect(ctx: RequestContext, res: Response): Promise<{ authorizationUrl: string }> {
  requireOauthMode();
  const config = loadConfig();
  if (!config.GOOGLE_OAUTH_CLIENT_ID) throw new ApplicationError('GOOGLE_OAUTH_CLIENT_ID is not set.', 503, 'MEETINGS_CALENDAR_NOT_CONFIGURED');
  const state = randomBytes(32).toString('base64url');
  const stateHash = hashState(state);
  await db.transaction(ctx, async (tx) => {
    await tx.query(sql`DELETE FROM calendar_oauth_state WHERE organization_id = ${ctx.organizationId} AND expires_at < now()`);
    await tx.query(sql`
      INSERT INTO calendar_oauth_state (organization_id, state_hash, user_id, expires_at)
      VALUES (${ctx.organizationId}, ${stateHash}, ${ctx.principal.id}, ${new Date(Date.now() + STATE_TTL_MS)})
    `);
  });
  res.cookie(COOKIE, stateHash, {
    httpOnly: true,
    secure: apiOrigin().protocol === 'https:',
    sameSite: 'lax',
    path: cookiePath(),
    maxAge: STATE_TTL_MS,
  });
  const url = new URL(config.GOOGLE_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: config.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: calendarRedirectUri(),
    response_type: 'code',
    scope: ['openid', 'email', ...CALENDAR_SCOPES].join(' '),
    access_type: 'offline',
    // Always ask, so Google returns a refresh token even on a reconnect.
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  }).toString();
  return { authorizationUrl: url.href };
}

/** The email Google put in the ID token it just issued over TLS to us. */
function emailFromIdToken(idToken: string | null): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as { email?: unknown };
    return typeof payload.email === 'string' ? payload.email : null;
  } catch {
    return null;
  }
}

export async function completeCalendarConnect(
  ctx: RequestContext,
  input: { code: string; state: string },
  req: Request,
  res: Response,
): Promise<CalendarConnectionStatus> {
  requireOauthMode();
  const stateHash = hashState(input.state);
  if (!sameHash(cookieValue(req), stateHash)) throw invalid('Finish connecting in the same browser you started in.');
  const consumed = await db.transaction(ctx, (tx) => tx.maybeOne<{ userId: string }>(sql`
    UPDATE calendar_oauth_state SET consumed_at = now()
     WHERE organization_id = ${ctx.organizationId} AND state_hash = ${stateHash}
       AND user_id = ${ctx.principal.id} AND consumed_at IS NULL AND expires_at > now()
    RETURNING user_id AS "userId"
  `));
  if (!consumed) throw invalid();
  res.clearCookie(COOKIE, { path: cookiePath() });

  let exchanged;
  try {
    exchanged = await exchangeGoogleAuthorizationCode(input.code, calendarRedirectUri());
  } catch (cause) {
    if (cause instanceof GoogleAuthUnavailableError) throw invalid(cause.message);
    throw cause;
  }
  const granted = new Set(exchanged.scope.split(' '));
  const missing = CALENDAR_SCOPES.filter((scope) => !granted.has(scope));
  if (missing.length > 0) {
    await revokeGoogleToken(exchanged.refreshToken ?? exchanged.accessToken);
    throw new ApplicationError(
      'Google did not give TapCRM access to your calendar. Connect again and leave both calendar permissions ticked.',
      422,
      'MEETINGS_CALENDAR_SCOPES_MISSING',
    );
  }
  if (!exchanged.refreshToken) {
    throw new ApplicationError(
      'Google did not return a long-lived sign-in. Remove TapCRM from your Google account’s third-party access, then connect again.',
      422,
      'MEETINGS_CALENDAR_NO_REFRESH_TOKEN',
    );
  }
  const sealed = sealSecret(exchanged.refreshToken, ctx.organizationId, ctx.principal.id);
  await db.transaction(ctx, (tx) => tx.query(sql`
    INSERT INTO calendar_connection (organization_id, user_id, provider, account_email, credentials_encrypted, scopes, status, last_error, connected_at)
    VALUES (${ctx.organizationId}, ${ctx.principal.id}, 'google', ${emailFromIdToken(exchanged.idToken)}, ${sealed},
            ${[...granted]}::text[], 'active', NULL, now())
    ON CONFLICT (organization_id, user_id) DO UPDATE
       SET account_email = EXCLUDED.account_email, credentials_encrypted = EXCLUDED.credentials_encrypted,
           scopes = EXCLUDED.scopes, status = 'active', last_error = NULL, connected_at = now()
  `));
  forgetCalendarToken(ctx.organizationId, ctx.principal.id);
  return calendarConnectionStatus(ctx);
}

export async function disconnectCalendar(ctx: RequestContext): Promise<CalendarConnectionStatus> {
  const row = await db.transaction(ctx, (tx) => tx.maybeOne<{ sealed: string }>(sql`
    DELETE FROM calendar_connection WHERE organization_id = ${ctx.organizationId} AND user_id = ${ctx.principal.id}
    RETURNING credentials_encrypted AS sealed
  `));
  forgetCalendarToken(ctx.organizationId, ctx.principal.id);
  if (row) {
    try {
      await revokeGoogleToken(openSecret(row.sealed, ctx.organizationId, ctx.principal.id));
    } catch {
      // The row is gone either way; an unreadable token cannot be revoked.
    }
  }
  return calendarConnectionStatus(ctx);
}

/** Google's redirect lands here; the code travels on to the app in a fragment. */
export function buildCalendarOAuthRouter(): Router {
  const router = Router();
  router.get('/callback', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const destination = new URL('/company/meetings/calendar', apiOrigin());
    try {
      const state = z.string().min(1).max(512).parse(req.query['state']);
      if (!sameHash(cookieValue(req), hashState(state))) throw new Error('browser mismatch');
      const fragment = req.query['error']
        ? new URLSearchParams({ calendar_error: 'denied' })
        : new URLSearchParams({ calendar_code: z.string().min(1).max(4096).parse(req.query['code']), calendar_state: state });
      destination.hash = fragment.toString();
    } catch {
      destination.hash = new URLSearchParams({ calendar_error: 'invalid' }).toString();
    }
    res.redirect(303, destination.href);
  });
  return router;
}
