import { bootstrapDb } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { IdentityUser } from './authentication/principal.js';

export async function findUserByEmail(email: string): Promise<IdentityUser | null> {
  const directoryRows = await bootstrapDb.readIdentityDirectory<{ userId: string; organizationId: string }>(sql`
    SELECT user_id, organization_id
    FROM identity_email_directory
    WHERE email = ${email.trim().toLowerCase()}
  `);
  const directoryEntry = directoryRows[0];
  if (!directoryEntry) return null;

  const rows = await bootstrapDb.readAs<IdentityUser>(directoryEntry.organizationId, sql`
    SELECT u.id, u.organization_id, u.account_type, u.email, u.password_hash, u.status,
           o.status AS organization_status, u.session_version, u.must_change_password, u.locked_until,
           email_verified_at,
           full_name, position_id, department_id, team_id, reports_to, client_id, geofence_required,
           NULL::integer AS organizational_level
    FROM app_user u
    JOIN organization o ON o.id = u.organization_id
    WHERE u.id = ${directoryEntry.userId} AND u.organization_id = ${directoryEntry.organizationId}
  `);
  return rows[0] ?? null;
}

export async function findUserById(userId: string, organizationId: string): Promise<IdentityUser | null> {
  const rows = await bootstrapDb.readAs<IdentityUser>(organizationId, sql`
    SELECT u.id, u.organization_id, u.account_type, u.email, u.password_hash, u.status,
           o.status AS organization_status, u.session_version, u.must_change_password, u.locked_until,
           email_verified_at,
           full_name, position_id, department_id, team_id, reports_to, client_id, geofence_required,
           NULL::integer AS organizational_level
    FROM app_user u
    JOIN organization o ON o.id = u.organization_id
    WHERE u.id = ${userId} AND u.organization_id = ${organizationId}
  `);
  return rows[0] ?? null;
}
