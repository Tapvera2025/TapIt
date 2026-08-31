import { bootstrapDb, platformDb } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

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

/**
 * ID-8: Lists all active sessions for a user.
 */
export async function listUserSessions(
  organizationId: string,
  userId: string,
  currentSessionId?: string,
): Promise<UserSessionInfo[]> {
  const rows = await bootstrapDb.readAs<{
    id: string;
    deviceLabel: string | null;
    ip: string | null;
    approxLocation: string | null;
    userAgent: string | null;
    createdAt: string;
    lastActiveAt: string;
    expiresAt: string;
  }>(
    organizationId,
    sql`
      SELECT
        id,
        device_label AS "deviceLabel",
        ip::text,
        approx_location AS "approxLocation",
        user_agent AS "userAgent",
        created_at AS "createdAt",
        last_active_at AS "lastActiveAt",
        expires_at AS "expiresAt"
      FROM session
      WHERE organization_id = ${organizationId}
        AND user_id = ${userId}
        AND revoked_at IS NULL
        AND expires_at > NOW()
      ORDER BY last_active_at DESC
    `,
  );

  return rows.map((r) => ({
    id: r.id,
    deviceLabel: r.deviceLabel,
    ip: r.ip,
    approxLocation: r.approxLocation,
    userAgent: r.userAgent,
    createdAt: r.createdAt,
    lastActiveAt: r.lastActiveAt,
    expiresAt: r.expiresAt,
    isCurrent: r.id === currentSessionId,
  }));
}

/**
 * ID-8: Revokes a single session.
 */
export async function revokeSingleSession(
  organizationId: string,
  userId: string,
  sessionId: string,
): Promise<void> {
  await platformDb.query(
    'health-check',
    'revoke single session',
    sql`
      UPDATE session
      SET revoked_at = NOW()
      WHERE organization_id = ${organizationId}
        AND user_id = ${userId}
        AND id = ${sessionId}
        AND revoked_at IS NULL
    `,
  );
}

/**
 * ID-8: Revokes all active sessions EXCEPT the current one.
 */
export async function revokeOtherSessions(
  organizationId: string,
  userId: string,
  currentSessionId: string,
): Promise<void> {
  await platformDb.query(
    'health-check',
    'revoke other sessions',
    sql`
      UPDATE session
      SET revoked_at = NOW()
      WHERE organization_id = ${organizationId}
        AND user_id = ${userId}
        AND id <> ${currentSessionId}
        AND revoked_at IS NULL
    `,
  );
}

/**
 * ID-7: Revokes ALL sessions and increments user session_version.
 */
export async function revokeAllUserSessions(
  organizationId: string,
  userId: string,
): Promise<void> {
  await platformDb.query(
    'health-check',
    'revoke all sessions and increment session version',
    sql`
      UPDATE session
      SET revoked_at = NOW()
      WHERE organization_id = ${organizationId}
        AND user_id = ${userId}
        AND revoked_at IS NULL
    `,
  );

  await platformDb.query(
    'health-check',
    'increment user session version',
    sql`
      UPDATE app_user
      SET session_version = session_version + 1,
          updated_at = NOW()
      WHERE organization_id = ${organizationId}
        AND id = ${userId}
    `,
  );
}

/**
 * Updates session's last_active_at timestamp.
 */
export async function touchSession(
  organizationId: string,
  sessionId: string,
): Promise<void> {
  try {
    await platformDb.query(
      'health-check',
      'touch session last active',
      sql`
        UPDATE session
        SET last_active_at = NOW()
        WHERE organization_id = ${organizationId}
          AND id = ${sessionId}
      `,
    );
  } catch {
    // Non-blocking
  }
}
