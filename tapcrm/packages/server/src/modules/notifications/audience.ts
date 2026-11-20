import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { OutboxPayload } from './types.js';

/**
 * Audience resolution. Callers select the people involved in the event.
 * A holders audience also checks whether each candidate holds the action.
 *
 * Runs inside the dispatcher's tenant transaction, so RLS already confines
 * every query to one organization; the explicit organization_id predicates are
 * defence in depth, matching the rest of the codebase.
 *
 * Only ACTIVE accounts are ever returned. Explicit `users` may include client
 * accounts (portal notifications) but never service accounts; the group forms
 * (positions/departments/holders) select employees and Super Admin only.
 */
export async function resolveAudience(
  tx: Tx,
  organizationId: string,
  payload: Pick<OutboxPayload, 'audience' | 'actorId'>,
): Promise<string[]> {
  const { audience } = payload;
  const recipients = new Set<string>();

  if (audience.users?.length) {
    const rows = await tx.query<{ id: string }>(sql`
      SELECT id FROM app_user
      WHERE organization_id = ${organizationId}
        AND id = ANY(${[...audience.users]}::uuid[])
        AND status = 'active' AND account_type <> 'service'
    `);
    rows.forEach((r) => recipients.add(r.id));
  }

  if (audience.positions?.length) {
    const rows = await tx.query<{ id: string }>(sql`
      SELECT id FROM app_user
      WHERE organization_id = ${organizationId}
        AND position_id = ANY(${[...audience.positions]}::uuid[])
        AND status = 'active' AND account_type = 'employee'
    `);
    rows.forEach((r) => recipients.add(r.id));
  }

  if (audience.departments?.length) {
    const rows = await tx.query<{ id: string }>(sql`
      SELECT id FROM app_user
      WHERE organization_id = ${organizationId}
        AND department_id = ANY(${[...audience.departments]}::uuid[])
        AND status = 'active' AND account_type = 'employee'
    `);
    rows.forEach((r) => recipients.add(r.id));
  }

  if (audience.superAdmins) {
    const rows = await tx.query<{ id: string }>(sql`
      SELECT id FROM app_user
      WHERE organization_id = ${organizationId}
        AND status = 'active' AND account_type = 'super-admin'
    `);
    rows.forEach((r) => recipients.add(r.id));
  }

  const holders = audience.holders ?? [];
  for (const { action, departmentId, teamId, userIds, scope } of Array.isArray(holders) ? holders : [holders]) {
    // Mirrors platform/authz-adapter `resolveSet`: an unexpired, unrevoked
    // override REPLACES the position's policy for that action (§4.4), whether
    // it allows or denies. Super Admin holds everything (globalAccess).
    const rows = await tx.query<{ id: string }>(sql`
      SELECT u.id FROM app_user u
      LEFT JOIN LATERAL (
        SELECT o.allowed, o.scope
          FROM user_override o
         WHERE o.organization_id = u.organization_id AND o.user_id = u.id
           AND o.action = ${action}
           AND o.revoked_at IS NULL
           AND (o.expires_at IS NULL OR o.expires_at > now())
         ORDER BY o.granted_at DESC LIMIT 1
      ) override_policy ON TRUE
      LEFT JOIN position_policy p
        ON p.organization_id = u.organization_id AND p.position_id = u.position_id AND p.action = ${action}
      WHERE u.organization_id = ${organizationId}
        AND u.status = 'active'
        AND (${userIds ?? null}::uuid[] IS NULL OR u.id = ANY(${userIds ?? null}::uuid[]))
        AND (${departmentId ?? null}::uuid IS NULL OR u.department_id = ${departmentId ?? null}::uuid)
        AND (${teamId ?? null}::uuid IS NULL OR u.team_id = ${teamId ?? null}::uuid)
        AND (
          u.account_type = 'super-admin'
          OR (
            u.account_type = 'employee'
            AND COALESCE(override_policy.allowed, p.allowed, false)
            AND (${scope ?? null}::text IS NULL OR COALESCE(override_policy.scope, p.scope) = ${scope ?? null})
          )
        )
    `);
    rows.forEach((r) => recipients.add(r.id));
  }

  for (const id of audience.excludeUserIds ?? []) recipients.delete(id);
  if (!audience.includeActor && payload.actorId) recipients.delete(payload.actorId);

  return [...recipients];
}
