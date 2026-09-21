import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import type { SqlFragment } from '@tapcrm/authz';

export interface ReportingUser {
  id: string;
  fullName?: string;
  organizationId: string;
  isEmployee: boolean;
  isSuperAdmin: boolean;
  status: string;
  departmentId: string | null;
  teamId: string | null;
  positionId: string | null;
  reportsTo: string | null;
}

export interface ReportingManagerOption {
  id: string;
  fullName: string;
  accountType: 'employee' | 'super-admin';
}

export async function listReportingManagerOptions(
  ctx: RequestContext,
  departmentId: string,
  positionId: string,
  subjectUserId: string | null = null,
  teamId: string | null = null,
): Promise<ReportingManagerOption[]> {
  return db.query<ReportingManagerOption>(
    ctx,
    sql`
    WITH RECURSIVE position_chain AS (
      SELECT parent.id
      FROM position child
      JOIN position parent
        ON parent.organization_id = child.organization_id
       AND parent.id = child.parent_position_id
       AND parent.status = 'active'
      WHERE child.organization_id = ${ctx.organizationId}
        AND child.id = ${positionId}
      UNION ALL
      SELECT parent.parent_position_id
      FROM position parent
      JOIN position_chain child ON child.id = parent.id
      WHERE parent.organization_id = ${ctx.organizationId}
        AND parent.status = 'active'
        AND parent.parent_position_id IS NOT NULL
    ), reporting_subtree AS (
      SELECT id
      FROM app_user
      WHERE organization_id = ${ctx.organizationId} AND id = ${subjectUserId}::uuid
      UNION ALL
      SELECT child.id
      FROM app_user child
      JOIN reporting_subtree parent ON child.reports_to = parent.id
      WHERE child.organization_id = ${ctx.organizationId}
    )
    SELECT u.id, u.full_name, u.account_type
    FROM app_user u
    WHERE u.organization_id = ${ctx.organizationId}
      AND u.status = 'active'
      AND (${subjectUserId}::uuid IS NULL OR u.id NOT IN (SELECT id FROM reporting_subtree))
      AND (
        (
          u.account_type = 'super-admin'
          AND EXISTS (
            SELECT 1 FROM position root_position
            WHERE root_position.organization_id = ${ctx.organizationId}
              AND root_position.id = ${positionId}
              AND root_position.parent_position_id IS NULL
          )
        )
        OR (
          u.account_type = 'employee'
          AND u.department_id = ${departmentId}
          AND u.position_id IN (SELECT id FROM position_chain)
          AND (${teamId}::uuid IS NULL OR u.team_id = ${teamId}::uuid)
          AND EXISTS (
            SELECT 1
            FROM position manager_position
            WHERE manager_position.organization_id = ${ctx.organizationId}
              AND manager_position.id = u.position_id
              AND manager_position.status = 'active'
          )
        )
      )
    ORDER BY (u.account_type = 'super-admin') DESC, u.full_name, u.id
  `,
  );
}

export async function findReportingUser(
  tx: Tx,
  organizationId: string,
  userId: string,
): Promise<ReportingUser | null> {
  return tx.maybeOne<ReportingUser>(sql`
    SELECT id, full_name, organization_id, (account_type = 'employee') AS is_employee,
           (account_type = 'super-admin') AS is_super_admin,
           status, department_id, team_id, position_id, reports_to
    FROM app_user
    WHERE organization_id = ${organizationId} AND id = ${userId}
  `);
}

export async function isPositionAncestor(
  tx: Tx,
  organizationId: string,
  subjectPositionId: string,
  managerPositionId: string,
): Promise<boolean> {
  const rows = await tx.query<{ id: string }>(sql`
    WITH RECURSIVE position_chain AS (
      SELECT parent.id, parent.parent_position_id, ARRAY[child.id] AS path
      FROM position child
      JOIN position parent
        ON parent.organization_id = child.organization_id
       AND parent.id = child.parent_position_id
       AND parent.status = 'active'
      WHERE child.organization_id = ${organizationId}
        AND child.id = ${subjectPositionId}
      UNION ALL
      SELECT parent.id, parent.parent_position_id, child.path || parent.id
      FROM position parent
      JOIN position_chain child ON child.parent_position_id = parent.id
      WHERE parent.organization_id = ${organizationId}
        AND parent.status = 'active'
        AND NOT parent.id = ANY(child.path)
    )
    SELECT id FROM position_chain WHERE id = ${managerPositionId} LIMIT 1
  `);
  return rows.length > 0;
}

/**
 * Resolves the employee's effective manager without changing reports_to.
 * Explicit valid relationships win. Otherwise, an employee inherits the
 * reporting line from the active holder of the true parent position, or from
 * the organization's active Super Admin when the position is a root.
 */
export async function findEffectiveManager(
  tx: Tx,
  organizationId: string,
  userId: string,
): Promise<ReportingUser | null> {
  const subject = await findReportingUser(tx, organizationId, userId);
  if (!subject) return null;

  if (subject.reportsTo !== null && subject.reportsTo !== subject.id) {
    const manager = await findReportingUser(tx, organizationId, subject.reportsTo);
    if (
      manager &&
      manager.status === 'active' &&
      (manager.isSuperAdmin ||
        (manager.isEmployee &&
          manager.departmentId === subject.departmentId &&
          manager.positionId !== null &&
          subject.positionId !== null &&
          (await isPositionAncestor(
            tx,
            organizationId,
            subject.positionId,
            manager.positionId,
          ))))
    ) {
      return manager;
    }
  }

  if (subject.positionId === null) return null;
  const parentManager = await tx.maybeOne<ReportingUser>(sql`
    SELECT manager.id, manager.full_name, manager.organization_id,
           (manager.account_type = 'employee') AS is_employee,
           (manager.account_type = 'super-admin') AS is_super_admin,
           manager.status, manager.department_id, manager.team_id,
           manager.position_id, manager.reports_to
    FROM position subject_position
    JOIN position parent_position
      ON parent_position.organization_id = subject_position.organization_id
     AND parent_position.id = subject_position.parent_position_id
     AND parent_position.status = 'active'
    JOIN app_user manager
      ON manager.organization_id = subject_position.organization_id
     AND manager.position_id = parent_position.id
     AND manager.account_type = 'employee'
     AND manager.status = 'active'
     AND manager.department_id = subject.department_id
     AND (subject.team_id IS NULL OR manager.team_id = subject.team_id)
    WHERE subject_position.organization_id = ${organizationId}
      AND subject_position.id = ${subject.positionId}
      AND subject_position.status = 'active'
    ORDER BY manager.id
    LIMIT 1
  `);
  if (parentManager) return parentManager;

  const rootPosition = await tx.maybeOne<{ id: string }>(sql`
    SELECT id FROM position
    WHERE organization_id = ${organizationId}
      AND id = ${subject.positionId}
      AND parent_position_id IS NULL
  `);
  if (!rootPosition) return null;
  return tx.maybeOne<ReportingUser>(sql`
    SELECT id, full_name, organization_id, (account_type = 'employee') AS is_employee,
           (account_type = 'super-admin') AS is_super_admin,
           status, department_id, team_id, position_id, reports_to
    FROM app_user
    WHERE organization_id = ${organizationId}
      AND account_type = 'super-admin'
      AND status = 'active'
    ORDER BY id
    LIMIT 1
  `);
}

export async function createsReportingCycle(
  tx: Tx,
  organizationId: string,
  subjectUserId: string,
  managerUserId: string,
): Promise<boolean> {
  const rows = await tx.query<{ id: string }>(sql`
    WITH RECURSIVE manager_chain AS (
      SELECT id, reports_to, ARRAY[id] AS path
      FROM app_user
      WHERE organization_id = ${organizationId} AND id = ${managerUserId}
      UNION ALL
      SELECT manager.id, manager.reports_to, child.path || manager.id
      FROM app_user manager
      JOIN manager_chain child ON child.reports_to = manager.id
      WHERE manager.organization_id = ${organizationId}
        AND NOT manager.id = ANY(child.path)
    )
    SELECT id FROM manager_chain WHERE id = ${subjectUserId} LIMIT 1
  `);
  return rows.length > 0;
}

/** The subject plus every direct and indirect report, cycle-safe and tenant-scoped. */
export async function listReportingSubtree(
  tx: Tx,
  organizationId: string,
  subjectUserId: string,
): Promise<ReportingUser[]> {
  return tx.query<ReportingUser>(sql`
    WITH RECURSIVE reporting_tree AS (
      SELECT id, organization_id, account_type, status, department_id, team_id,
             position_id, reports_to, ARRAY[id] AS path, 0 AS depth
      FROM app_user
      WHERE organization_id = ${organizationId} AND id = ${subjectUserId}
      UNION ALL
      SELECT child.id, child.organization_id, child.account_type, child.status,
             child.department_id, child.team_id, child.position_id, child.reports_to,
             parent.path || child.id, parent.depth + 1
      FROM app_user child
      JOIN reporting_tree parent ON child.reports_to = parent.id
      WHERE child.organization_id = ${organizationId}
        AND NOT child.id = ANY(parent.path)
    )
    SELECT id, organization_id, (account_type = 'employee') AS is_employee,
           (account_type = 'super-admin') AS is_super_admin,
           status, department_id, team_id, position_id, reports_to
    FROM reporting_tree
    ORDER BY depth, id
  `);
}

export async function listActiveReportingUsers(
  tx: Tx,
  organizationId: string,
): Promise<ReportingUser[]> {
  return tx.query<ReportingUser>(sql`
    SELECT id, organization_id, (account_type = 'employee') AS is_employee,
           (account_type = 'super-admin') AS is_super_admin,
           status, department_id, team_id, position_id, reports_to
    FROM app_user
    WHERE organization_id = ${organizationId}
      AND account_type = 'employee'
      AND status = 'active'
    ORDER BY id
  `);
}

export async function updateReportingManagers(
  tx: Tx,
  organizationId: string,
  updates: readonly { userId: string; managerUserId: string | null }[],
): Promise<void> {
  for (const update of updates) {
    await tx.query(sql`
      UPDATE app_user
      SET reports_to = ${update.managerUserId}
      WHERE organization_id = ${organizationId} AND id = ${update.userId}
    `);
  }
}

export async function areReportingUsersVisible(
  tx: Tx,
  organizationId: string,
  userIds: readonly string[],
  visibility: SqlFragment,
): Promise<boolean> {
  if (userIds.length === 0) return true;
  const visible = await tx.query<{ id: string }>(sql`
    SELECT u.id
    FROM app_user u
    WHERE u.organization_id = ${organizationId}
      AND u.id = ANY(${userIds}::uuid[])
      AND ${visibility}
  `);
  return visible.length === userIds.length;
}

export async function loadReportingUserResource(ctx: RequestContext, id: string) {
  const row = await db.maybeOne<ReportingUser>(
    ctx,
    sql`
    SELECT id, organization_id, (account_type = 'employee') AS is_employee,
           (account_type = 'super-admin') AS is_super_admin,
           status, department_id, team_id, position_id, reports_to
    FROM app_user
    WHERE organization_id = ${ctx.organizationId} AND id = ${id}
  `,
  );
  return row === null ? null : { ...row, type: 'user' as const, id: row.id };
}
