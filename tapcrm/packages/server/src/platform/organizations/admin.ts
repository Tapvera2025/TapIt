import { platformDb } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

export async function adminStatus(organizationId: string) {
  return platformDb.query(
    'health-check',
    'read company admin invitation status',
    sql`
    SELECT id, email, expires_at, accepted_at, revoked_at, created_at, last_sent_at, resend_count
    FROM admin_invitation WHERE organization_id = ${organizationId} ORDER BY created_at DESC LIMIT 10
  `,
  );
}
