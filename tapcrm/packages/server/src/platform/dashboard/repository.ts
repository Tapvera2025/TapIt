import { platformDb } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

export async function stats() {
  return platformDb.one(
    'health-check',
    'read platform dashboard statistics',
    sql`
    SELECT
      (SELECT count(*)::int FROM organization) AS total_organizations,
      (SELECT count(*)::int FROM organization WHERE status = 'active') AS active_organizations,
      (SELECT count(*)::int FROM organization WHERE status = 'suspended') AS suspended_organizations,
      (SELECT count(*)::int FROM admin_invitation WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()) AS pending_invitations,
      (SELECT count(*)::int FROM admin_invitation) AS total_invitations,
      (SELECT count(*)::int FROM admin_invitation WHERE accepted_at IS NOT NULL) AS accepted_invitations,
      (SELECT count(*)::int FROM admin_invitation WHERE accepted_at IS NULL AND revoked_at IS NOT NULL) AS revoked_invitations,
      (SELECT count(*)::int FROM admin_invitation WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at <= now()) AS expired_invitations,
      (SELECT count(*)::int FROM platform_user WHERE status = 'active') AS platform_admins
  `,
  );
}
