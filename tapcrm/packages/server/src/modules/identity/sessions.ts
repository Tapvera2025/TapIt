import { bootstrapDb, identityDb } from '../../platform/dal/db.js';
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
    SELECT id, device_label AS "deviceLabel", ip::text, approx_location AS "approxLocation",
           user_agent AS "userAgent", created_at AS "createdAt", last_active_at AS "lastActiveAt", expires_at AS "expiresAt"
    FROM session
    WHERE organization_id = ${organizationId} AND user_id = ${userId}
      AND revoked_at IS NULL AND expires_at > NOW()
    ORDER BY last_active_at DESC
  `,
  );
  return rows.map((r) => ({ ...r, isCurrent: r.id === currentSessionId }));
}

export async function revokeSingleSession(
  organizationId: string,
  userId: string,
  sessionId: string,
): Promise<void> {
  await identityDb.transactionForOrganization(organizationId, async (tx) => {
    await tx.query(sql`UPDATE session SET revoked_at = NOW()
      WHERE organization_id = ${organizationId} AND user_id = ${userId} AND id = ${sessionId} AND revoked_at IS NULL`);
  });
}

export async function revokeOtherSessions(
  organizationId: string,
  userId: string,
  currentSessionId: string,
): Promise<void> {
  await identityDb.transactionForOrganization(organizationId, async (tx) => {
    await tx.query(sql`UPDATE session SET revoked_at = NOW()
      WHERE organization_id = ${organizationId} AND user_id = ${userId} AND id <> ${currentSessionId} AND revoked_at IS NULL`);
  });
}

export async function revokeAllUserSessions(
  organizationId: string,
  userId: string,
): Promise<void> {
  await identityDb.transactionForOrganization(organizationId, async (tx) => {
    await tx.query(sql`UPDATE session SET revoked_at = NOW()
      WHERE organization_id = ${organizationId} AND user_id = ${userId} AND revoked_at IS NULL`);
    await tx.query(sql`UPDATE app_user SET session_version = session_version + 1, updated_at = NOW()
      WHERE organization_id = ${organizationId} AND id = ${userId}`);
  });
}

export async function touchSession(
  organizationId: string,
  sessionId: string,
): Promise<void> {
  try {
    await identityDb.transactionForOrganization(organizationId, async (tx) => {
      await tx.query(sql`UPDATE session SET last_active_at = NOW()
        WHERE organization_id = ${organizationId} AND id = ${sessionId} AND revoked_at IS NULL`);
    });
  } catch {
    // last-activity telemetry is deliberately non-blocking
  }
}
