import { createOpaqueToken, hashToken } from '../../../platform/auth/crypto.js';
import { db, bootstrapDb, platformDb } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { hashIdentityPassword } from './service.js';
import { sendPasswordResetEmail } from '../notifications/authentication-email.js';
import { createIdentityContext } from '../authentication/principal.js';
import { findUserByEmail, findUserById } from '../repository.js';
import { IdentityValidationError } from '../errors.js';

const RESET_TTL_MS = 30 * 60 * 1000;

export async function requestPasswordReset(email: string): Promise<void> {
  const identityUser = await findUserByEmail(email);
  // Keep reset requests indistinguishable for unknown or unverified addresses.
  if (!identityUser || identityUser.status !== 'active' || !identityUser.emailVerifiedAt) return;
  const organization = await bootstrapDb.readAs<{ organizationCode: string }>(identityUser.organizationId, sql`
    SELECT code AS organization_code FROM organization WHERE id = ${identityUser.organizationId}
  `);
  const organizationCode = organization[0]?.organizationCode;
  if (!organizationCode) return;
  const token = createOpaqueToken(32);
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);
  await db.transaction(createIdentityContext(identityUser, `identity:password-reset:${identityUser.id}`), async (tx) => {
    await tx.query(sql`UPDATE password_reset_token SET used_at = now() WHERE organization_id = ${identityUser.organizationId} AND user_id = ${identityUser.id} AND used_at IS NULL`);
    await tx.query(sql`INSERT INTO password_reset_token(organization_id, user_id, token_hash, expires_at) VALUES (${identityUser.organizationId}, ${identityUser.id}, ${hashToken(token)}, ${expiresAt})`);
  });
  await sendPasswordResetEmail(identityUser.email, token, organizationCode);
}

export async function resetPassword(token: string, password: string): Promise<void> {
  const tokenHash = hashToken(token);
  const passwordHash = await hashIdentityPassword(password);
  const user = await platformDb.maybeOne<{ id: string; organizationId: string; email: string; organizationCode: string }>('health-check', 'resolve password reset token', sql`
    SELECT r.user_id AS id, r.organization_id, u.email, o.code AS organization_code
    FROM password_reset_token r JOIN app_user u ON u.id = r.user_id
    JOIN organization o ON o.id = r.organization_id
    WHERE r.token_hash = ${tokenHash} AND r.used_at IS NULL AND r.expires_at > now()
  `);
  if (!user) throw new IdentityValidationError('IDENTITY_PASSWORD_RESET_INVALID', 'Invalid or expired password reset token');
  const identityUser = await findUserById(user.id, user.organizationId);
  if (!identityUser) throw new IdentityValidationError('IDENTITY_PASSWORD_RESET_INVALID', 'Invalid or expired password reset token');
  await db.transaction(createIdentityContext(identityUser, `identity:password-reset-consume:${identityUser.id}`), async (tx) => {
    const consumed = await tx.maybeOne<{ id: string }>(sql`UPDATE password_reset_token SET used_at = now() WHERE token_hash = ${tokenHash} AND used_at IS NULL AND expires_at > now() RETURNING id`);
    if (!consumed) throw new IdentityValidationError('IDENTITY_PASSWORD_RESET_INVALID', 'Invalid or expired password reset token');
    await tx.query(sql`UPDATE app_user SET password_hash = ${passwordHash}, session_version = session_version + 1 WHERE organization_id = ${user.organizationId} AND id = ${user.id}`);
    await tx.query(sql`UPDATE session SET revoked_at = now() WHERE organization_id = ${user.organizationId} AND user_id = ${user.id} AND revoked_at IS NULL`);
  });
}
