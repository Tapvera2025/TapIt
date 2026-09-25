import type { Request } from 'express';
import { bootstrapDb, db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { IdentityAuthenticationError } from '../errors.js';
import { verifyIdentityAccessToken } from './crypto.js';
import { createIdentityContext, toPrincipal, type IdentityUser } from './principal.js';

export async function resolvePrincipal(req: Request) {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return resolvePrincipalFromToken(header.slice(7).trim());
}

/**
 * Same token and session-version check as HTTP (TECH RT-1). `touch: false` lets
 * the socket layer re-validate a long-lived connection without counting that as
 * user activity on the session.
 */
export async function resolvePrincipalFromToken(token: string, options: { touch?: boolean } = {}) {
  const claims = await verifyIdentityAccessToken(token);
  const rows = await bootstrapDb.readAs<IdentityUser>(claims.organizationId, sql`
    SELECT u.id, u.organization_id, u.account_type, u.email, u.password_hash, u.status,
           o.status AS organization_status, u.session_version, u.must_change_password, u.locked_until, u.full_name,
           u.position_id, u.department_id, u.team_id, u.reports_to, u.client_id, u.geofence_required, p.organizational_level
    FROM app_user u LEFT JOIN position p ON p.id = u.position_id
    JOIN organization o ON o.id = u.organization_id
    JOIN session s ON s.organization_id = u.organization_id AND s.user_id = u.id
    WHERE u.id = ${claims.userId} AND u.organization_id = ${claims.organizationId} AND s.id = ${claims.sessionId}
      AND s.session_version = u.session_version AND s.revoked_at IS NULL AND s.expires_at > now()
  `);
  const user = rows[0];
  if (!user || user.status !== 'active' || user.sessionVersion !== claims.sessionVersion || user.accountType !== claims.accountType) throw new IdentityAuthenticationError('IDENTITY_SESSION_EXPIRED');
  if (user.organizationStatus !== 'active') throw new IdentityAuthenticationError('IDENTITY_ORGANIZATION_SUSPENDED');
  if (user.lockedUntil && user.lockedUntil > new Date()) throw new IdentityAuthenticationError('IDENTITY_ACCOUNT_LOCKED', undefined, 429);
  if (user.mustChangePassword) throw new IdentityAuthenticationError('IDENTITY_PASSWORD_CHANGE_REQUIRED');
  if (options.touch === false) return { principal: toPrincipal(user), organizationId: user.organizationId };
  await db.transaction(
    createIdentityContext(user, `identity:session:${claims.sessionId}`),
    (tx) => tx.query(sql`
      UPDATE session SET last_active_at = now()
      WHERE organization_id = ${user.organizationId} AND id = ${claims.sessionId} AND revoked_at IS NULL
    `).then(() => undefined),
  );
  return { principal: toPrincipal(user), organizationId: user.organizationId };
}
