import { db, bootstrapDb, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { IdentityAuthenticationError, IdentityValidationError } from '../errors.js';
import { loadConfig } from '../../../config.js';
import { createIdentityContext, type IdentityUser } from '../authentication/principal.js';
import { findUserById } from '../repository.js';
import { createFamilyId, hashRefreshToken, signIdentityAccessToken, signIdentityRefreshToken, verifyIdentityRefreshToken } from '../authentication/crypto.js';
import { createSession, rotateRefreshToken } from './repository.js';
import { listActiveSessions, revokeAllSessions, revokeRefreshFamily, revokeSession } from './repository.js';
import { verifyIdentityAccessToken } from '../authentication/crypto.js';
import { sendRefreshReuseAlert } from '../notifications/security-email.js';

export async function createIdentitySession(tx: Tx, user: IdentityUser, input: { deviceLabel: string | null; ip: string | null; userAgent: string | null }) {
  const config = loadConfig();
  const expiresAt = new Date(Date.now() + config.REFRESH_TOKEN_TTL_SECONDS * 1000);
  const session = await createSession(tx, { organizationId: user.organizationId, userId: user.id, sessionVersion: user.sessionVersion, ...input, expiresAt });
  const familyId = createFamilyId();
  const refreshToken = await signIdentityRefreshToken(session.id, user.organizationId, familyId);
  await tx.query(sql`INSERT INTO refresh_token(organization_id, session_id, token_hash, family_id, expires_at) VALUES (${user.organizationId}, ${session.id}, ${hashRefreshToken(refreshToken)}, ${familyId}, ${expiresAt})`);
  const accessToken = await signIdentityAccessToken({ userId: user.id, organizationId: user.organizationId, sessionId: session.id, sessionVersion: user.sessionVersion, accountType: user.accountType });
  return { accessToken, refreshToken, expiresIn: config.ACCESS_TOKEN_TTL_SECONDS };
}

export async function refreshIdentitySession(rawRefreshToken: string) {
  const claims = await verifyIdentityRefreshToken(rawRefreshToken);
  const rows = await bootstrapDb.readAs<IdentityUser & { sessionId: string; familyId: string; refreshExpiresAt: Date; refreshUsedAt: Date | null }>(claims.organizationId, sql`
    SELECT u.id, u.organization_id, u.account_type, u.email, u.password_hash, u.status,
           o.status AS organization_status, u.session_version, u.full_name,
           u.position_id, u.department_id, u.team_id, u.reports_to, u.client_id, u.geofence_required, p.organizational_level,
           s.id AS session_id, r.family_id, r.expires_at AS refresh_expires_at, r.used_at AS refresh_used_at
    FROM app_user u JOIN session s ON s.organization_id = u.organization_id AND s.user_id = u.id
    JOIN refresh_token r ON r.organization_id = s.organization_id AND r.session_id = s.id
    JOIN organization o ON o.id = u.organization_id
    LEFT JOIN position p ON p.id = u.position_id
    WHERE u.organization_id = ${claims.organizationId} AND s.id = ${claims.sessionId} AND r.token_hash = ${hashRefreshToken(rawRefreshToken)}
  `);
  const current = rows[0];
  if (!current || current.familyId !== claims.familyId || current.refreshExpiresAt <= new Date()) throw new IdentityAuthenticationError('IDENTITY_REFRESH_TOKEN_INVALID');
  if (current.status !== 'active') throw new IdentityAuthenticationError('IDENTITY_SESSION_EXPIRED');
  if (current.organizationStatus !== 'active') throw new IdentityAuthenticationError('IDENTITY_ORGANIZATION_SUSPENDED');
  if (current.refreshUsedAt) {
    await db.transaction(createIdentityContext(current, `identity:refresh-reuse:${claims.sessionId}`), (tx) => revokeRefreshFamily(tx, claims.organizationId, claims.familyId));
    await sendRefreshReuseAlert(current.email, null);
    throw new IdentityAuthenticationError('IDENTITY_REFRESH_TOKEN_REUSE');
  }
  const config = loadConfig();
  const expiresAt = new Date(Date.now() + config.REFRESH_TOKEN_TTL_SECONDS * 1000);
  const nextRefreshToken = await signIdentityRefreshToken(claims.sessionId, claims.organizationId, claims.familyId);
  const accessToken = await signIdentityAccessToken({ userId: current.id, organizationId: current.organizationId, sessionId: claims.sessionId, sessionVersion: current.sessionVersion, accountType: current.accountType });
  let reuseDetected = false;
  await db.transaction(createIdentityContext(current, `identity:refresh:${claims.sessionId}`), async (tx) => {
    const rotated = await rotateRefreshToken(tx, { organizationId: claims.organizationId, sessionId: claims.sessionId, tokenHash: hashRefreshToken(rawRefreshToken), nextTokenHash: hashRefreshToken(nextRefreshToken), familyId: claims.familyId, expiresAt });
    if (!rotated) {
      reuseDetected = true;
      await revokeRefreshFamily(tx, claims.organizationId, claims.familyId);
    }
  });
  if (reuseDetected) {
    await sendRefreshReuseAlert(current.email, null);
    throw new IdentityAuthenticationError('IDENTITY_REFRESH_TOKEN_REUSE');
  }
  return { accessToken, refreshToken: nextRefreshToken, expiresIn: config.ACCESS_TOKEN_TTL_SECONDS };
}

async function claimsFromAccessToken(accessToken: string) {
  return verifyIdentityAccessToken(accessToken);
}

export async function getActiveSessions(accessToken: string) {
  const claims = await claimsFromAccessToken(accessToken);
  const user = await findUserById(claims.userId, claims.organizationId);
  if (!user) throw new IdentityAuthenticationError('IDENTITY_SESSION_EXPIRED');
  return db.transaction(createIdentityContext(user, `identity:sessions:${claims.userId}`), (tx) => listActiveSessions(tx, claims.organizationId, claims.userId));
}

export async function revokeOneSession(accessToken: string, sessionId: string): Promise<void> {
  const claims = await claimsFromAccessToken(accessToken);
  const user = await findUserById(claims.userId, claims.organizationId);
  if (!user) throw new IdentityAuthenticationError('IDENTITY_SESSION_EXPIRED');
  const revoked = await db.transaction(createIdentityContext(user, `identity:revoke-session:${sessionId}`), (tx) => revokeSession(tx, claims.organizationId, claims.userId, sessionId));
  if (!revoked) throw new IdentityValidationError('IDENTITY_SESSION_NOT_FOUND', 'Session not found or already revoked');
}

export async function revokeEverySession(accessToken: string): Promise<void> {
  const claims = await claimsFromAccessToken(accessToken);
  const user = await findUserById(claims.userId, claims.organizationId);
  if (!user) throw new IdentityAuthenticationError('IDENTITY_SESSION_EXPIRED');
  await db.transaction(createIdentityContext(user, `identity:revoke-all:${claims.userId}`), (tx) => revokeAllSessions(tx, claims.organizationId, claims.userId));
}
