import type { SqlFragment } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';

export interface ChartRow {
  id: string;
  fullName: string;
  positionId: string | null;
  departmentId: string | null;
  teamId: string | null;
  reportsTo: string | null;
  effectiveManagerId: string | null;
  effectiveManagerIds: string[];
  missingManager: boolean;
  managerVisible: boolean;
  email?: string;
  departmentName?: string | null;
  positionName?: string | null;
  positionCode?: string | null;
  teamName?: string | null;
  designationName?: string | null;
  specialization?: string | null;
  reportsToName?: string | null;
}

export interface ChartDepartmentRow {
  id: string;
  code: string;
  name: string;
  status: 'active' | 'inactive';
  headPositionNames: string[];
}

export async function listChartRows(
  ctx: RequestContext,
  filter: SqlFragment,
): Promise<ChartRow[]> {
  return db.query<ChartRow>(
    ctx,
    sql`
    SELECT u.id, u.full_name, u.email, u.position_id, u.department_id, u.team_id, u.reports_to,
           department.name AS department_name,
           position.name AS position_name,
           position.code AS position_code,
           team.name AS team_name,
           designation.name AS designation_name,
           u.specialization,
           CASE WHEN manager_valid.is_valid THEN manager.full_name
                ELSE COALESCE(effective.manager_name, root_manager.full_name)
           END AS reports_to_name,
           CASE WHEN manager_valid.is_valid THEN manager.id
                ELSE COALESCE(effective.manager_id, root_manager.id)
           END AS effective_manager_id,
           COALESCE(effective.manager_ids, ARRAY[]::uuid[]) AS effective_manager_ids,
           (
             (NOT manager_valid.is_valid AND effective.manager_id IS NULL AND root_manager.id IS NULL)
           ) AS missing_manager,
           (CASE WHEN manager_valid.is_valid THEN manager.id
                 ELSE COALESCE(effective.manager_id, root_manager.id)
            END IS NOT NULL) AS manager_visible
    FROM app_user u
    LEFT JOIN app_user manager
      ON manager.organization_id = u.organization_id AND manager.id = u.reports_to
    LEFT JOIN department ON department.organization_id = u.organization_id AND department.id = u.department_id
    LEFT JOIN position ON position.organization_id = u.organization_id AND position.id = u.position_id
    LEFT JOIN team ON team.organization_id = u.organization_id AND team.id = u.team_id
    LEFT JOIN designation ON designation.organization_id = u.organization_id AND designation.id = u.designation_id
    LEFT JOIN LATERAL (
      SELECT (ARRAY_AGG(manager_position_holder.id ORDER BY manager_position_holder.id))[1] AS manager_id,
             ARRAY_AGG(manager_position_holder.id ORDER BY manager_position_holder.id) AS manager_ids,
             (ARRAY_AGG(manager_position_holder.full_name ORDER BY manager_position_holder.id))[1] AS manager_name
      FROM position child_position
      JOIN position parent_position
        ON parent_position.organization_id = child_position.organization_id
       AND parent_position.id = child_position.parent_position_id
      JOIN app_user manager_position_holder
        ON manager_position_holder.organization_id = child_position.organization_id
       AND manager_position_holder.position_id = parent_position.id
       AND manager_position_holder.status = 'active'
       AND manager_position_holder.account_type = 'employee'
       AND manager_position_holder.department_id = u.department_id
       AND (u.team_id IS NULL OR manager_position_holder.team_id = u.team_id)
      WHERE child_position.organization_id = u.organization_id
        AND child_position.id = u.position_id
    ) effective ON u.reports_to IS NULL
    LEFT JOIN LATERAL (
      WITH RECURSIVE position_chain AS (
        SELECT id, parent_position_id, ARRAY[id] AS path
        FROM position
        WHERE organization_id = u.organization_id AND id = u.position_id
        UNION ALL
        SELECT parent.id, parent.parent_position_id, child.path || parent.id
        FROM position parent
        JOIN position_chain child ON child.parent_position_id = parent.id
        WHERE parent.organization_id = u.organization_id
          AND NOT parent.id = ANY(child.path)
      )
      SELECT true AS is_valid
      FROM position_chain
      WHERE id = manager.position_id
        AND manager.department_id = u.department_id
      LIMIT 1
    ) manager_check ON manager.account_type = 'employee'
    LEFT JOIN LATERAL (
      SELECT (
        manager.id IS NOT NULL
        AND manager.status = 'active'
        AND manager.account_type IN ('employee', 'super-admin')
        AND (
          manager.account_type = 'super-admin'
          OR (
            manager.department_id = u.department_id
            AND manager.position_id IS NOT NULL
            AND manager_check.is_valid IS TRUE
          )
        )
      ) AS is_valid
    ) manager_valid ON true
    LEFT JOIN LATERAL (
      SELECT root.id, root.full_name
      FROM app_user root
      JOIN position root_position
        ON root_position.organization_id = root.organization_id
       AND root_position.id = u.position_id
       AND root_position.parent_position_id IS NULL
      WHERE root.organization_id = u.organization_id
        AND root.account_type = 'super-admin'
        AND root.status = 'active'
        AND NOT manager_valid.is_valid
      ORDER BY root.id
      LIMIT 1
    ) root_manager ON true
    WHERE u.organization_id = ${ctx.organizationId}
      AND u.account_type = 'employee'
      AND u.status = 'active'
      AND ${filter}
    ORDER BY u.full_name
  `,
  );
}

/** Structure-only summaries contain department and position names, never employee identities. */
export async function listChartDepartments(
  ctx: RequestContext,
): Promise<ChartDepartmentRow[]> {
  return db.query<ChartDepartmentRow>(
    ctx,
    sql`
    SELECT d.id, d.code, d.name, d.status,
           COALESCE(
             ARRAY_AGG(p.name ORDER BY p.organizational_level DESC, p.name)
               FILTER (WHERE p.id IS NOT NULL),
             ARRAY[]::text[]
           ) AS head_position_names
    FROM department d
    LEFT JOIN position p
      ON p.organization_id = d.organization_id
     AND p.department_id = d.id
     AND p.parent_position_id IS NULL
     AND p.status = 'active'
    WHERE d.organization_id = ${ctx.organizationId} AND d.status = 'active'
    GROUP BY d.id
    ORDER BY d.code
  `,
  );
}
