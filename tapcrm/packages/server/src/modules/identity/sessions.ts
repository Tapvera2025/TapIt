import { identityDb, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

/**
 * Session and device management — ID-7, ID-8.
 *
 * Every write here goes through `identityDb`, which sets tenant context before
 * the statement runs. That is not a style preference: `session`, `app_user` and
 * `refresh_token` all have RLS forced, so a write issued without tenant context
 * matches no rows and reports success. Revocation that reports success and
 * revokes nothing is the worst possible shape for this particular file.
 *
 * The writes that MUST change something use `mustExecute`, so the difference
 * between "revoked" and "silently did nothing" is an exception rather than a
 * belief.
 */

export interface UserSessionInfo {
  readonly id: string;
  readonly deviceLabel: string | null;
  readonly ip: string | null;
  readonly approxLocation: string | null;
  readonly userAgent: string | null;
  readonly createdAt: string;
  readonly lastActiveAt: string;
  readonly expiresAt: string;
  readonly isCurrent: boolean;
}

/** Why a set of credentials was killed. Stored, because it gets asked for later. */
export type RevocationReason =
  | 'logout'
  | 'user-requested'
  | 'password-change'
  | 'reuse-detected'
  | 'session-revoked'
  | 'user-deactivated'
  | 'role-change';

/**
 * ID-8 — "Users can list their active sessions with device, approximate
 * location, IP and last activity, and revoke any of them individually or all at
 * once."
 */
export async function listUserSessions(
  organizationId: string,
  userId: string,
  currentSessionId?: string,
): Promise<UserSessionInfo[]> {
  const rows = await identityDb.read<Omit<UserSessionInfo, 'isCurrent'>>(
    organizationId,
    sql`
      SELECT
        id,
        device_label,
        ip::text AS ip,
        approx_location,
        user_agent,
        created_at,
        last_active_at,
        expires_at
      FROM session
      WHERE organization_id = ${organizationId}
        AND user_id = ${userId}
        AND revoked_at IS NULL
        AND expires_at > now()
      ORDER BY last_active_at DESC
    `,
  );

  return rows.map((row) => ({ ...row, isCurrent: row.id === currentSessionId }));
}

/**
 * Kills one session and every refresh token issued into it.
 *
 * Revoking the session without the tokens leaves a credential that can mint a
 * fresh session, which is the same as not revoking anything.
 */
export async function revokeSession(
  organizationId: string,
  userId: string,
  sessionId: string,
  reason: RevocationReason,
): Promise<void> {
  await identityDb.transaction(organizationId, async (tx) => {
    await tx.mustExecute(
      sql`
        UPDATE session
        SET revoked_at = now()
        WHERE organization_id = ${organizationId}
          AND user_id = ${userId}
          AND id = ${sessionId}
          AND revoked_at IS NULL
      `,
      `session ${sessionId}`,
    );

    await revokeTokensOfSessions(tx, organizationId, [sessionId], reason);
  });
}

/** ID-8 — the "sign out my other devices" case. Returns how many were killed. */
export async function revokeOtherSessions(
  organizationId: string,
  userId: string,
  currentSessionId: string,
  reason: RevocationReason = 'user-requested',
): Promise<number> {
  return identityDb.transaction(organizationId, async (tx) => {
    const revoked = await tx.query<{ id: string }>(sql`
      UPDATE session
      SET revoked_at = now()
      WHERE organization_id = ${organizationId}
        AND user_id = ${userId}
        AND id <> ${currentSessionId}
        AND revoked_at IS NULL
      RETURNING id
    `);

    if (revoked.length > 0) {
      await revokeTokensOfSessions(
        tx,
        organizationId,
        revoked.map((row) => row.id),
        reason,
      );
    }
    return revoked.length;
  });
}

/**
 * ID-7 — "Deactivation, password change, role change or explicit revocation
 * increments the session version and invalidates all sessions within 60
 * seconds."
 *
 * Two mechanisms, deliberately both. The session rows are revoked, which stops
 * refresh; and `session_version` is incremented, which stops every access token
 * already in the wild — the resolver compares the token's `ver` claim against
 * the user's current value on every request, so invalidation is immediate
 * rather than eventual.
 *
 * The version bump alone would close the access-token door and leave refresh
 * open; the revocation alone would do the reverse.
 */
export async function revokeAllUserSessions(
  organizationId: string,
  userId: string,
  reason: RevocationReason,
): Promise<void> {
  await identityDb.transaction(organizationId, async (tx) => {
    const revoked = await tx.query<{ id: string }>(sql`
      UPDATE session
      SET revoked_at = now()
      WHERE organization_id = ${organizationId}
        AND user_id = ${userId}
        AND revoked_at IS NULL
      RETURNING id
    `);

    if (revoked.length > 0) {
      await revokeTokensOfSessions(
        tx,
        organizationId,
        revoked.map((row) => row.id),
        reason,
      );
    }

    // This one must change something. The user exists — the caller just
    // authenticated as them or acted on them — so a zero row count means the
    // tenant context is wrong and every statement above was equally blind.
    await tx.mustExecute(
      sql`
        UPDATE app_user
        SET session_version = session_version + 1,
            updated_at = now()
        WHERE organization_id = ${organizationId}
          AND id = ${userId}
      `,
      `session version for user ${userId}`,
    );
  });
}

/** Kills every unspent refresh token belonging to the given sessions. */
async function revokeTokensOfSessions(
  tx: Tx,
  organizationId: string,
  sessionIds: readonly string[],
  reason: RevocationReason,
): Promise<void> {
  await tx.execute(sql`
    UPDATE refresh_token
    SET revoked_at = now(),
        revoked_reason = ${reason}
    WHERE organization_id = ${organizationId}
      AND session_id = ANY(${sessionIds}::uuid[])
      AND revoked_at IS NULL
  `);
}

/**
 * Records that a session is still in use.
 *
 * Deliberately throttled. `last_active_at` exists so a person can recognise
 * their own devices in the ID-8 list, and five-minute resolution answers that
 * perfectly well. Writing on every request would put a row update in front of
 * every read in the product — at the §17 target of 6,000 concurrent users that
 * is a hot row and a write amplification with no reader who benefits.
 *
 * Never throws: a failed heartbeat must not fail the request it rode in on.
 */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const lastTouched = new Map<string, number>();

export function touchSession(organizationId: string, sessionId: string): void {
  const now = Date.now();
  const previous = lastTouched.get(sessionId);
  if (previous !== undefined && now - previous < TOUCH_INTERVAL_MS) return;
  lastTouched.set(sessionId, now);

  // Keep the throttle map bounded on a long-lived process.
  if (lastTouched.size > 10_000) {
    for (const [key, at] of lastTouched) {
      if (now - at > TOUCH_INTERVAL_MS) lastTouched.delete(key);
    }
  }

  void identityDb
    .execute(
      organizationId,
      sql`
        UPDATE session
        SET last_active_at = now()
        WHERE organization_id = ${organizationId}
          AND id = ${sessionId}
          AND revoked_at IS NULL
      `,
    )
    .catch(() => undefined);
}
