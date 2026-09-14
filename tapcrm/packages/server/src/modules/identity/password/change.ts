import { bootstrapDb, db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { IdentityAuthenticationError, IdentityValidationError } from '../errors.js';
import { verifyIdentityAccessToken } from '../authentication/crypto.js';
import { createIdentityContext } from '../authentication/principal.js';
import { findUserById } from '../repository.js';
import { hashIdentityPassword, verifyIdentityPassword } from './service.js';

export async function changeTemporaryPassword(input: { accessToken: string; currentPassword: string; newPassword: string }): Promise<void> {
  const claims = await verifyIdentityAccessToken(input.accessToken);
  const user = await findUserById(claims.userId, claims.organizationId);
  if (!user || user.status !== 'active' || user.organizationStatus !== 'active' || user.accountType !== claims.accountType) {
    throw new IdentityAuthenticationError(user?.organizationStatus === 'suspended' ? 'IDENTITY_ORGANIZATION_SUSPENDED' : 'IDENTITY_SESSION_EXPIRED');
  }
  if (!user.mustChangePassword) {
    throw new IdentityValidationError('IDENTITY_PASSWORD_CHANGE_NOT_REQUIRED', 'A temporary password change is not required');
  }
  const session = await bootstrapDb.readAs<{ id: string }>(claims.organizationId, sql`
    SELECT id FROM session
    WHERE organization_id = ${claims.organizationId} AND id = ${claims.sessionId}
      AND user_id = ${claims.userId} AND session_version = ${claims.sessionVersion}
      AND revoked_at IS NULL AND expires_at > now()
  `);
  if (!session[0]) throw new IdentityAuthenticationError('IDENTITY_SESSION_EXPIRED');
  if (!await verifyIdentityPassword(user.passwordHash ?? '', input.currentPassword)) {
    throw new IdentityValidationError('IDENTITY_TEMPORARY_PASSWORD_INVALID', 'Current password is invalid');
  }
  const passwordHash = await hashIdentityPassword(input.newPassword);
  await db.transaction(createIdentityContext(user, `identity:temporary-password:${user.id}`), async (tx) => {
    await tx.query(sql`
      UPDATE app_user
      SET password_hash = ${passwordHash}, must_change_password = false, session_version = session_version + 1
      WHERE organization_id = ${user.organizationId} AND id = ${user.id} AND must_change_password = true
    `);
    await tx.query(sql`
      UPDATE session SET revoked_at = now()
      WHERE organization_id = ${user.organizationId} AND user_id = ${user.id} AND revoked_at IS NULL
    `);
    await tx.query(sql`
      INSERT INTO audit_outbox(organization_id, stream, payload)
      VALUES (
        ${user.organizationId}, 'activity',
        ${JSON.stringify({ action: 'employee.password_changed', actorId: user.id, actorType: user.accountType, targetType: 'user', targetId: user.id })}::jsonb
      )
    `);
  });
}
