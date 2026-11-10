import { loadConfig } from '../../../config.js';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import {
  GoogleAuthUnavailableError,
  googleDelegatedAccessToken,
  googleRefreshedAccessToken,
} from '../../../platform/integrations/google/token.js';
import { CALENDAR_SCOPES } from './calendar.js';
import { openSecret } from './crypto.js';

/**
 * Whose Google Calendar TapCRM may use, and a token for it.
 *
 *   off              no calendar: hosts paste a meeting link
 *   oauth            the person's own connection (calendar_connection)
 *   service-account  Workspace delegation, acting as the person's email
 */
export type CalendarMode = 'off' | 'oauth' | 'service-account';

export function calendarMode(): CalendarMode {
  return loadConfig().MEETINGS_GOOGLE_AUTH;
}

export type CalendarAccess =
  | { readonly token: string }
  | {
      readonly token: null;
      readonly reason: 'off' | 'not_connected' | 'needs_reconnect' | 'error';
      readonly message?: string;
    };

type Ctx = RequestContext;

/** Access tokens from refresh tokens, per person, until shortly before they expire. */
const cached = new Map<string, { token: string; expiresAt: number }>();

export function forgetCalendarToken(organizationId: string, userId: string): void {
  cached.delete(`${organizationId}:${userId}`);
}

export async function markNeedsReconnect(ctx: Ctx, userId: string, message: string): Promise<void> {
  forgetCalendarToken(ctx.organizationId, userId);
  await db.query(ctx, sql`
    UPDATE calendar_connection SET status = 'needs_reconnect', last_error = ${message.slice(0, 500)}
     WHERE organization_id = ${ctx.organizationId} AND user_id = ${userId}
  `);
}

export async function calendarAccess(ctx: Ctx, userId: string): Promise<CalendarAccess> {
  const mode = calendarMode();
  if (mode === 'off') return { token: null, reason: 'off' };

  if (mode === 'service-account') {
    const person = await db.maybeOne<{ email: string | null }>(ctx, sql`
      SELECT email::text AS email FROM app_user WHERE organization_id = ${ctx.organizationId} AND id = ${userId}
    `);
    if (!person?.email) return { token: null, reason: 'not_connected', message: 'This person has no email address in TapCRM.' };
    try {
      return { token: await googleDelegatedAccessToken(CALENDAR_SCOPES, person.email) };
    } catch (cause) {
      return { token: null, reason: 'error', message: cause instanceof Error ? cause.message : String(cause) };
    }
  }

  const key = `${ctx.organizationId}:${userId}`;
  const hit = cached.get(key);
  if (hit && hit.expiresAt - 60_000 > Date.now()) return { token: hit.token };
  const connection = await db.maybeOne<{ sealed: string; status: string }>(ctx, sql`
    SELECT credentials_encrypted AS sealed, status FROM calendar_connection
     WHERE organization_id = ${ctx.organizationId} AND user_id = ${userId} AND provider = 'google'
  `);
  if (!connection) return { token: null, reason: 'not_connected' };
  if (connection.status !== 'active') return { token: null, reason: 'needs_reconnect' };
  try {
    const refreshToken = openSecret(connection.sealed, ctx.organizationId, userId);
    const fresh = await googleRefreshedAccessToken(refreshToken);
    cached.set(key, fresh);
    return { token: fresh.token };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (cause instanceof GoogleAuthUnavailableError) {
      await markNeedsReconnect(ctx, userId, message);
      return { token: null, reason: 'needs_reconnect', message };
    }
    return { token: null, reason: 'error', message };
  }
}
