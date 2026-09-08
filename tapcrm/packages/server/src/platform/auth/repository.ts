import { platformDb } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

export interface PlatformUserRow {
  id: string;
  email: string;
  fullName: string;
  passwordHash: string;
  role: 'MASTER_ADMIN';
  status: string;
  sessionVersion: number;
  mfaRequired: boolean;
}

export async function findUserByEmail(email: string): Promise<PlatformUserRow | null> {
  return platformDb.maybeOne<PlatformUserRow>(
    'health-check',
    'platform authentication user lookup',
    sql`
    SELECT id, email, full_name, password_hash, role, status, session_version, mfa_required
    FROM platform_user WHERE email = ${email.toLowerCase()}
  `,
  );
}

export async function findUserById(id: string): Promise<PlatformUserRow | null> {
  return platformDb.maybeOne<PlatformUserRow>(
    'health-check',
    'platform session validation',
    sql`
    SELECT id, email, full_name, password_hash, role, status, session_version, mfa_required
    FROM platform_user WHERE id = ${id}
  `,
  );
}

export async function createSession(input: {
  userId: string;
  sessionVersion: number;
  deviceLabel: string | null;
  ip: string | null;
  userAgent: string | null;
  expiresAt: Date;
}): Promise<{ id: string }> {
  return platformDb.one(
    'health-check',
    'create platform session',
    sql`
    INSERT INTO platform_session(platform_user_id, session_version, device_label, ip, user_agent, expires_at)
    VALUES (${input.userId}, ${input.sessionVersion}, ${input.deviceLabel}, ${input.ip}, ${input.userAgent}, ${input.expiresAt})
    RETURNING id
  `,
  );
}

export async function revokeSession(id: string): Promise<void> {
  await platformDb.query(
    'health-check',
    'revoke platform session',
    sql`UPDATE platform_session SET revoked_at = now() WHERE id = ${id} AND revoked_at IS NULL`,
  );
}

export async function findSessionUserId(sessionId: string): Promise<string | null> {
  const row = await platformDb.maybeOne<{ platformUserId: string }>(
    'health-check',
    'resolve platform session user',
    sql`SELECT platform_user_id FROM platform_session WHERE id = ${sessionId}`,
  );
  return row?.platformUserId ?? null;
}

export async function sessionIsCurrent(
  sessionId: string,
  userId: string,
  version: number,
): Promise<boolean> {
  const row = await platformDb.maybeOne<{ id: string }>(
    'health-check',
    'validate platform session',
    sql`
    SELECT s.id FROM platform_session s
    JOIN platform_user u ON u.id = s.platform_user_id
    WHERE s.id = ${sessionId} AND s.platform_user_id = ${userId}
      AND s.session_version = ${version} AND u.session_version = ${version}
      AND u.status = 'active' AND s.revoked_at IS NULL AND s.expires_at > now()
  `,
  );
  return row !== null;
}

export async function insertRefresh(input: {
  sessionId: string;
  tokenHash: Buffer;
  familyId: string;
  parentId: string | null;
  expiresAt: Date;
}): Promise<{ id: string }> {
  return platformDb.one(
    'health-check',
    'store platform refresh token',
    sql`
    INSERT INTO platform_refresh_token(session_id, token_hash, family_id, parent_id, expires_at)
    VALUES (${input.sessionId}, ${input.tokenHash}, ${input.familyId}, ${input.parentId}, ${input.expiresAt})
    RETURNING id
  `,
  );
}

export async function rotateRefresh(input: {
  tokenHash: Buffer;
  sessionId: string;
  familyId: string;
  newTokenHash: Buffer;
  expiresAt: Date;
}): Promise<{ id: string; parentId: string }> {
  return platformDb.transaction(
    'health-check',
    'rotate platform refresh token',
    async (tx) => {
      const rows = await tx.query<{
        id: string;
        usedAt: Date | null;
        expiresAt: Date;
      }>(sql`
      SELECT id, used_at, expires_at FROM platform_refresh_token
      WHERE token_hash = ${input.tokenHash} AND session_id = ${input.sessionId} AND family_id = ${input.familyId}
      FOR UPDATE
    `);
      const current = rows[0];
      if (!current) throw new Error('refresh token not found');
      if (current.usedAt !== null || current.expiresAt <= new Date())
        throw new Error('refresh token already used or expired');
      await tx.query(
        sql`UPDATE platform_refresh_token SET used_at = now() WHERE id = ${current.id}`,
      );
      const created = await tx.one<{ id: string }>(sql`
      INSERT INTO platform_refresh_token(session_id, token_hash, family_id, parent_id, expires_at)
      VALUES (${input.sessionId}, ${input.newTokenHash}, ${input.familyId}, ${current.id}, ${input.expiresAt})
      RETURNING id
    `);
      return { id: created.id, parentId: current.id };
    },
  );
}

export async function revokeRefreshFamily(familyId: string): Promise<void> {
  await platformDb.query(
    'health-check',
    'revoke compromised platform refresh family',
    sql`
    UPDATE platform_session SET revoked_at = now()
    WHERE id IN (SELECT session_id FROM platform_refresh_token WHERE family_id = ${familyId}) AND revoked_at IS NULL
  `,
  );
}

export async function touchSession(id: string): Promise<void> {
  await platformDb.query(
    'health-check',
    'touch platform session',
    sql`UPDATE platform_session SET last_active_at = now() WHERE id = ${id} AND revoked_at IS NULL`,
  );
}
