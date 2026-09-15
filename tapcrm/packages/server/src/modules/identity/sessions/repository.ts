import { sql } from '../../../platform/dal/sql.js';
import type { Tx } from '../../../platform/dal/db.js';

export async function createSession(tx: Tx, input: {
  organizationId: string;
  userId: string;
  sessionVersion: number;
  deviceLabel: string | null;
  ip: string | null;
  userAgent: string | null;
  countryCode?: string | null;
  expiresAt: Date;
}) {
  return tx.one<{ id: string }>(sql`
    INSERT INTO session(organization_id, user_id, session_version, device_label, ip, user_agent, country_code, expires_at)
    VALUES (${input.organizationId}, ${input.userId}, ${input.sessionVersion}, ${input.deviceLabel}, ${input.ip}, ${input.userAgent}, ${input.countryCode ?? null}, ${input.expiresAt})
    RETURNING id
  `);
}

export async function rotateRefreshToken(tx: Tx, input: { organizationId: string; sessionId: string; tokenHash: string; nextTokenHash: string; familyId: string; expiresAt: Date }) {
  const token = await tx.maybeOne<{ id: string; usedAt: Date | null }>(sql`
    SELECT id, used_at FROM refresh_token
    WHERE organization_id = ${input.organizationId} AND session_id = ${input.sessionId} AND token_hash = ${input.tokenHash}
    FOR UPDATE
  `);
  if (!token || token.usedAt) return false;
  await tx.query(sql`UPDATE refresh_token SET used_at = now() WHERE id = ${token.id}`);
  await tx.query(sql`
    INSERT INTO refresh_token(organization_id, session_id, token_hash, family_id, parent_id, expires_at)
    VALUES (${input.organizationId}, ${input.sessionId}, ${input.nextTokenHash}, ${input.familyId}, ${token.id}, ${input.expiresAt})
  `);
  return true;
}

export async function revokeRefreshFamily(tx: Tx, organizationId: string, familyId: string): Promise<void> {
  await tx.query(sql`
    UPDATE session
    SET revoked_at = now()
    WHERE organization_id = ${organizationId}
      AND id IN (
        SELECT session_id FROM refresh_token
        WHERE organization_id = ${organizationId} AND family_id = ${familyId}
      )
      AND revoked_at IS NULL
  `);
}

export async function listActiveSessions(tx: Tx, organizationId: string, userId: string, currentSessionId: string) {
  return tx.query<{
    id: string;
    deviceLabel: string | null;
    approxLocation: string | null;
    ip: string | null;
    countryCode: string | null;
    userAgent: string | null;
    createdAt: Date;
    lastActiveAt: Date;
    expiresAt: Date;
    current: boolean;
  }>(sql`
    SELECT id, device_label, approx_location, ip, country_code, user_agent, created_at,
           last_active_at, expires_at, id = ${currentSessionId} AS current
    FROM session
    WHERE organization_id = ${organizationId}
      AND user_id = ${userId}
      AND revoked_at IS NULL
      AND expires_at > now()
    ORDER BY last_active_at DESC
  `);
}

export async function revokeSession(tx: Tx, organizationId: string, userId: string, sessionId: string): Promise<boolean> {
  const row = await tx.maybeOne<{ id: string }>(sql`
    UPDATE session SET revoked_at = now()
    WHERE organization_id = ${organizationId} AND user_id = ${userId}
      AND id = ${sessionId} AND revoked_at IS NULL
    RETURNING id
  `);
  return row !== null;
}

export async function revokeAllSessions(tx: Tx, organizationId: string, userId: string): Promise<void> {
  await tx.query(sql`
    UPDATE session SET revoked_at = now()
    WHERE organization_id = ${organizationId} AND user_id = ${userId} AND revoked_at IS NULL
  `);
  await tx.query(sql`
    UPDATE app_user SET session_version = session_version + 1
    WHERE organization_id = ${organizationId} AND id = ${userId}
  `);
}
