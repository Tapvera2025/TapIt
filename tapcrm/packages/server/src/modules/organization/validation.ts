import { sql } from '../../platform/dal/sql.js';
import type { RequestContext } from '../../platform/dal/context.js';
import type { Tx } from '../../platform/dal/db.js';
import { db } from '../../platform/dal/db.js';
import {
  ConflictError,
  NotEligibleError,
  NotFoundError,
} from '../../platform/http/error-handler.js';

export type TeamKind = 'sales-team' | 'sales-pool' | 'dev-subteam';

export interface PositionInput {
  readonly departmentId: string;
  readonly organizationalLevel: number;
  readonly parentPositionId?: string | null | undefined;
}

export interface PositionPatchInput {
  readonly organizationalLevel?: number | undefined;
  readonly parentPositionId?: string | null | undefined;
}

export interface TeamInput {
  readonly departmentId: string;
  readonly kind: TeamKind;
  readonly leadUserId?: string | null | undefined;
  readonly parentTeamId?: string | null | undefined;
}

export interface ExistingPosition {
  readonly id: string;
  readonly organizationId: string;
  readonly departmentId: string;
  readonly code: string;
  readonly name: string;
  readonly organizationalLevel: number;
  readonly parentPositionId: string | null;
  readonly isSeeded: boolean;
  readonly status: 'active' | 'inactive';
}

export interface ExistingTeam {
  readonly id: string;
  readonly organizationId: string;
  readonly departmentId: string;
  readonly kind: TeamKind;
  readonly name: string;
  readonly leadUserId: string | null;
  readonly parentTeamId: string | null;
  readonly sharedVisibility: boolean;
}

export interface ExistingDepartment {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly kind: 'support' | 'delivery';
  readonly status: 'active' | 'inactive';
}

export interface ExistingDesignation {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly specializations: string[];
}

/**
 * Load a department strictly inside the request tenant.
 */
export async function getDepartment(
  ctx: RequestContext,
  departmentId: string,
): Promise<ExistingDepartment> {
  const row = await db.maybeOne<ExistingDepartment>(
    ctx,
    sql`
      SELECT
        id,
        organization_id,
        code,
        name,
        kind,
        status
      FROM department
      WHERE id = ${departmentId}
        AND organization_id = ${ctx.organizationId}
    `,
  );

  if (!row) {
    throw new NotFoundError('Department');
  }

  return row;
}

/**
 * Load a team strictly inside the request tenant.
 */
export async function getTeam(
  ctx: RequestContext,
  teamId: string,
): Promise<ExistingTeam> {
  const row = await db.maybeOne<ExistingTeam>(
    ctx,
    sql`
      SELECT
        id,
        organization_id,
        department_id,
        kind,
        name,
        lead_user_id,
        parent_team_id,
        shared_visibility
      FROM team
      WHERE id = ${teamId}
        AND organization_id = ${ctx.organizationId}
    `,
  );

  if (!row) {
    throw new NotFoundError('Team');
  }

  return row;
}

/**
 * Load a position strictly inside the request tenant.
 */
export async function getPosition(
  ctx: RequestContext,
  positionId: string,
): Promise<ExistingPosition> {
  const row = await db.maybeOne<ExistingPosition>(
    ctx,
    sql`
      SELECT
        id,
        organization_id,
        department_id,
        code,
        name,
        organizational_level,
        parent_position_id,
        is_seeded,
        status
      FROM position
      WHERE id = ${positionId}
        AND organization_id = ${ctx.organizationId}
    `,
  );

  if (!row) {
    throw new NotFoundError('Position');
  }

  return row;
}

/**
 * Load a designation strictly inside the request tenant.
 */
export async function getDesignation(
  ctx: RequestContext,
  designationId: string,
): Promise<ExistingDesignation> {
  const row = await db.maybeOne<ExistingDesignation>(
    ctx,
    sql`
      SELECT
        id,
        organization_id,
        name,
        specializations
      FROM designation
      WHERE id = ${designationId}
        AND organization_id = ${ctx.organizationId}
    `,
  );

  if (!row) {
    throw new NotFoundError('Designation');
  }

  return row;
}

/**
 * Department lifecycle.
 *
 * D-2:
 * - active users/positions => cannot delete
 * - deactivate instead
 */
export async function assertDepartmentCanBeDeleted(
  tx: Tx,
  ctx: RequestContext,
  departmentId: string,
): Promise<void> {
  const usage = await tx.maybeOne<{
    activeUsers: number;
    activePositions: number;
  }>(
    sql`
      SELECT
        (
          SELECT COUNT(*)::int
          FROM app_user
          WHERE organization_id = ${ctx.organizationId}
            AND department_id = ${departmentId}
            AND account_type = 'employee'
            AND status = 'active'
        ) AS "activeUsers",
        (
          SELECT COUNT(*)::int
          FROM position
          WHERE organization_id = ${ctx.organizationId}
            AND department_id = ${departmentId}
            AND status = 'active'
        ) AS "activePositions"
    `,
  );

  if (!usage) {
    throw new NotFoundError('Department');
  }

  if (usage.activeUsers > 0 || usage.activePositions > 0) {
    throw new ConflictError(
      'Department cannot be deleted while active users or active positions exist. Deactivate the department instead.',
      'department_in_use',
    );
  }
}

/**
 * Team rules T-1 and T-2.
 */
export async function validateTeamStructure(
  tx: Tx,
  ctx: RequestContext,
  input: TeamInput,
  existingTeam?: ExistingTeam,
): Promise<void> {
  const department = await tx.maybeOne<{
    id: string;
    code: string;
    status: 'active' | 'inactive';
  }>(
    sql`
      SELECT id, code, status
      FROM department
      WHERE id = ${input.departmentId}
        AND organization_id = ${ctx.organizationId}
    `,
  );

  if (!department) {
    throw new NotFoundError('Department');
  }

  if (department.status !== 'active') {
    throw new NotEligibleError(
      'department_inactive',
      'A team cannot be created or moved into an inactive department.',
      {
        unmet: ['department.status = active'],
        actual: { status: department.status },
      },
    );
  }

  if (input.kind === 'dev-subteam') {
    if (department.code !== 'development') {
      throw new NotEligibleError(
        'invalid_team_department',
        'A dev-subteam must belong to the Development department.',
        {
          unmet: ['team.kind = dev-subteam requires department.code = development'],
          actual: {
            departmentCode: department.code,
            teamKind: input.kind,
          },
        },
      );
    }

    if (input.parentTeamId !== null && input.parentTeamId !== undefined) {
      throw new NotEligibleError(
        'dev_subteam_cannot_nest',
        'Development sub-teams cannot have a parent team.',
        {
          unmet: ['dev-subteam.parentTeamId = null'],
        },
      );
    }

    const count = await tx.maybeOne<{ count: number }>(
      sql`
        SELECT COUNT(*)::int AS count
        FROM team
        WHERE organization_id = ${ctx.organizationId}
          AND department_id = ${input.departmentId}
          AND kind = 'dev-subteam'
          AND (${existingTeam?.id ?? null} IS NULL OR id <> ${existingTeam?.id ?? null})
      `,
    );

    if ((count?.count ?? 0) >= 3) {
      throw new ConflictError(
        'Development can contain exactly three dev-subteam units.',
        'development_dev_subteam_limit',
      );
    }
  }

  if (input.kind === 'sales-team') {
    if (department.code !== 'sales') {
      throw new NotEligibleError(
        'invalid_team_department',
        'A sales-team must belong to the Sales department.',
        {
          unmet: ['sales-team requires department.code = sales'],
          actual: {
            departmentCode: department.code,
            teamKind: input.kind,
          },
        },
      );
    }

    if (input.parentTeamId !== null && input.parentTeamId !== undefined) {
      throw new NotEligibleError(
        'sales_team_cannot_nest',
        'A sales-team is a root team and cannot have a parent.',
        {
          unmet: ['sales-team.parentTeamId = null'],
        },
      );
    }
  }

  if (input.kind === 'sales-pool') {
    if (department.code !== 'sales') {
      throw new NotEligibleError(
        'invalid_team_department',
        'A sales-pool must belong to the Sales department.',
        {
          unmet: ['sales-pool requires department.code = sales'],
          actual: {
            departmentCode: department.code,
            teamKind: input.kind,
          },
        },
      );
    }

    if (!input.parentTeamId) {
      throw new NotEligibleError(
        'sales_pool_requires_parent',
        'A sales-pool must belong to a sales-team.',
        {
          unmet: ['sales-pool.parentTeamId is required'],
        },
      );
    }

    const parent = await tx.maybeOne<{
      id: string;
      departmentId: string;
      kind: TeamKind;
    }>(
      sql`
        SELECT id, department_id AS "departmentId", kind
        FROM team
        WHERE id = ${input.parentTeamId}
          AND organization_id = ${ctx.organizationId}
      `,
    );

    if (!parent) {
      throw new NotFoundError('Parent team');
    }

    if (parent.departmentId !== input.departmentId) {
      throw new NotEligibleError(
        'cross_department_team_parent',
        'A sales-pool parent must belong to the same department.',
        {
          unmet: ['parentTeam.departmentId = team.departmentId'],
        },
      );
    }

    if (parent.kind !== 'sales-team') {
      throw new NotEligibleError(
        'invalid_sales_pool_parent',
        'A sales-pool parent must be a sales-team.',
        {
          unmet: ['parentTeam.kind = sales-team'],
          actual: { parentKind: parent.kind },
        },
      );
    }

    if (existingTeam?.id === input.parentTeamId) {
      throw new ConflictError('A team cannot be its own parent.', 'team_self_parent');
    }
  }

  if (input.leadUserId) {
    const user = await tx.maybeOne<{
      id: string;
      organizationId: string;
      accountType: string;
      departmentId: string | null;
      positionCode: string | null;
      teamId: string | null;
      status: string;
    }>(
      sql`
        SELECT
          u.id,
          u.organization_id AS "organizationId",
          u.account_type AS "accountType",
          u.department_id AS "departmentId",
          p.code AS "positionCode",
          u.team_id AS "teamId",
          u.status
        FROM app_user u
        LEFT JOIN position p ON p.id = u.position_id
        WHERE u.id = ${input.leadUserId}
          AND u.organization_id = ${ctx.organizationId}
      `,
    );

    if (!user) {
      throw new NotFoundError('Team lead user');
    }

    if (user.accountType !== 'employee') {
      throw new NotEligibleError(
        'invalid_team_lead_account',
        'A team lead must be an employee account.',
        {
          unmet: ['leadUser.accountType = employee'],
          actual: { accountType: user.accountType },
        },
      );
    }

    if (user.status !== 'active') {
      throw new NotEligibleError(
        'inactive_team_lead',
        'An inactive user cannot own a team.',
        {
          unmet: ['leadUser.status = active'],
        },
      );
    }

    if (user.departmentId !== input.departmentId) {
      throw new NotEligibleError(
        'team_lead_department_mismatch',
        'The team lead must belong to the same department as the team.',
        {
          unmet: ['leadUser.departmentId = team.departmentId'],
        },
      );
    }

    const requiredPosition =
      input.kind === 'sales-team'
        ? 'sales-team-lead'
        : input.kind === 'sales-pool'
          ? 'sales-supervisor'
          : 'developer-team-manager';

    if (user.positionCode !== requiredPosition) {
      throw new NotEligibleError(
        'invalid_team_lead_position',
        `This team requires a ${requiredPosition} position holder as its lead.`,
        {
          unmet: [`leadUser.position.code = ${requiredPosition}`],
          actual: { positionCode: user.positionCode },
        },
      );
    }
  }
}

/**
 * Position constraints C-1/C-2.
 */
export async function validatePositionHierarchy(
  tx: Tx,
  ctx: RequestContext,
  input: PositionInput,
  options: {
    readonly existingPositionId?: string;
    readonly allowParentlessSeeded?: boolean;
  } = {},
): Promise<void> {
  const department = await tx.maybeOne<{
    id: string;
    code: string;
    status: 'active' | 'inactive';
  }>(
    sql`
      SELECT id, code, status
      FROM department
      WHERE id = ${input.departmentId}
        AND organization_id = ${ctx.organizationId}
    `,
  );

  if (!department) {
    throw new NotFoundError('Department');
  }

  if (department.status !== 'active' && !options.allowParentlessSeeded) {
    throw new NotEligibleError(
      'department_inactive',
      'An active custom position cannot be created inside an inactive department.',
      {
        unmet: ['department.status = active'],
      },
    );
  }

  if (!input.parentPositionId) {
    if (!options.allowParentlessSeeded) {
      throw new NotEligibleError(
        'custom_position_requires_parent',
        'A custom position must have a parent position. Only seeded root positions may be parentless.',
        {
          unmet: ['parentPositionId is required for custom positions'],
        },
      );
    }

    return;
  }

  if (input.parentPositionId === options.existingPositionId) {
    throw new ConflictError(
      'A position cannot be its own parent.',
      'position_self_parent',
    );
  }

  const parent = await tx.maybeOne<{
    id: string;
    departmentId: string;
    organizationalLevel: number;
    status: 'active' | 'inactive';
  }>(
    sql`
      SELECT
        id,
        department_id AS "departmentId",
        organizational_level AS "organizationalLevel",
        status
      FROM position
      WHERE id = ${input.parentPositionId}
        AND organization_id = ${ctx.organizationId}
    `,
  );

  if (!parent) {
    throw new NotFoundError('Parent position');
  }

  if (parent.departmentId !== input.departmentId) {
    throw new NotEligibleError(
      'cross_department_position_parent',
      'A position parent must belong to the same department.',
      {
        unmet: ['parentPosition.departmentId = position.departmentId'],
      },
    );
  }

  if (input.organizationalLevel >= parent.organizationalLevel) {
    throw new NotEligibleError(
      'invalid_organizational_level',
      'A child position must have a strictly lower organizational level than its parent.',
      {
        unmet: ['position.organizationalLevel < parentPosition.organizationalLevel'],
        required: [`organizationalLevel < ${parent.organizationalLevel}`],
        actual: {
          organizationalLevel: input.organizationalLevel,
          parentLevel: parent.organizationalLevel,
        },
      },
    );
  }

  const descendants = await tx.query<{
    id: string;
    organizationalLevel: number;
  }>(
    sql`
      WITH RECURSIVE descendants AS (
        SELECT id, organizational_level
        FROM position
        WHERE parent_position_id = ${options.existingPositionId ?? null}
          AND organization_id = ${ctx.organizationId}

        UNION ALL

        SELECT p.id, p.organizational_level
        FROM position p
        JOIN descendants d ON p.parent_position_id = d.id
        WHERE p.organization_id = ${ctx.organizationId}
      )
      SELECT id, organizational_level AS "organizationalLevel"
      FROM descendants
      WHERE id <> ${options.existingPositionId ?? null}
    `,
  );

  for (const child of descendants) {
    if (input.organizationalLevel <= child.organizationalLevel) {
      throw new NotEligibleError(
        'position_would_invalidate_children',
        'The requested position level would invalidate a child position.',
        {
          unmet: [
            `position.organizationalLevel > child(${child.id}).organizationalLevel`,
          ],
          actual: {
            organizationalLevel: input.organizationalLevel,
            childLevel: child.organizationalLevel,
          },
        },
      );
    }
  }

  /**
   * Cycle detection.
   *
   * If the requested parent is somewhere below the current position,
   * assigning it would create a cycle.
   */
  if (options.existingPositionId) {
    const cycle = await tx.maybeOne<{ id: string }>(
      sql`
        WITH RECURSIVE ancestors AS (
          SELECT id, parent_position_id
          FROM position
          WHERE id = ${input.parentPositionId}
            AND organization_id = ${ctx.organizationId}

          UNION ALL

          SELECT p.id, p.parent_position_id
          FROM position p
          JOIN ancestors a ON p.id = a.parent_position_id
          WHERE p.organization_id = ${ctx.organizationId}
        )
        SELECT id
        FROM ancestors
        WHERE id = ${options.existingPositionId}
        LIMIT 1
      `,
    );

    if (cycle) {
      throw new ConflictError(
        'Changing this parent would create a reporting hierarchy cycle.',
        'position_hierarchy_cycle',
      );
    }
  }
}

/**
 * Position deletion rule.
 *
 * OR-5:
 * active holder => deactivate only.
 */
export async function assertPositionCanBeDeleted(
  tx: Tx,
  ctx: RequestContext,
  position: ExistingPosition,
): Promise<void> {
  if (position.isSeeded) {
    throw new ConflictError(
      'Seeded positions are structural configuration and cannot be deleted. Deactivate them when required.',
      'seeded_position',
    );
  }

  const holders = await tx.maybeOne<{ count: number }>(
    sql`
      SELECT COUNT(*)::int AS count
      FROM app_user
      WHERE organization_id = ${ctx.organizationId}
        AND position_id = ${position.id}
        AND account_type = 'employee'
        AND status = 'active'
    `,
  );

  if ((holders?.count ?? 0) > 0) {
    throw new ConflictError(
      'A position held by active users cannot be deleted. Deactivate the position instead.',
      'position_in_use',
    );
  }

  const children = await tx.maybeOne<{ count: number }>(
    sql`
      SELECT COUNT(*)::int AS count
      FROM position
      WHERE organization_id = ${ctx.organizationId}
        AND parent_position_id = ${position.id}
    `,
  );

  if ((children?.count ?? 0) > 0) {
    throw new ConflictError(
      'A position with child positions cannot be deleted until its hierarchy is reassigned.',
      'position_has_children',
    );
  }
}

/**
 * Prevent deleting a designation still used by employees.
 */
export async function assertDesignationCanBeDeleted(
  tx: Tx,
  ctx: RequestContext,
  designationId: string,
): Promise<void> {
  const count = await tx.maybeOne<{ count: number }>(
    sql`
      SELECT COUNT(*)::int AS count
      FROM app_user
      WHERE organization_id = ${ctx.organizationId}
        AND designation_id = ${designationId}
        AND account_type = 'employee'
        AND status IN ('active', 'inactive')
    `,
  );

  if ((count?.count ?? 0) > 0) {
    throw new ConflictError(
      'A designation assigned to employees cannot be deleted.',
      'designation_in_use',
    );
  }
}

/**
 * Validate that a user's team membership belongs to the same department
 * and is an active employee.
 */
export async function validateTeamMembers(
  tx: Tx,
  ctx: RequestContext,
  team: ExistingTeam,
  userIds: readonly string[],
): Promise<void> {
  const users = await tx.query<{
    id: string;
    accountType: string;
    status: string;
    departmentId: string | null;
  }>(
    sql`
      SELECT
        id,
        account_type AS "accountType",
        status,
        department_id AS "departmentId"
      FROM app_user
      WHERE organization_id = ${ctx.organizationId}
        AND id = ANY(${userIds}::uuid[])
    `,
  );

  if (users.length !== userIds.length) {
    throw new NotFoundError('One or more users were not found in this organization');
  }

  const invalid = users.filter(
    (user) =>
      user.accountType !== 'employee' ||
      user.status !== 'active' ||
      user.departmentId !== team.departmentId,
  );

  if (invalid.length > 0) {
    throw new NotEligibleError(
      'invalid_team_members',
      'Only active employees from the team department may be assigned to a team.',
      {
        unmet: [
          'user.accountType = employee',
          'user.status = active',
          'user.departmentId = team.departmentId',
        ],
        actual: invalid,
      },
    );
  }
}
