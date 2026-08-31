import { visibilityFilter } from '@tapcrm/authz';
import { route } from '../../platform/http/route.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { RequestContext } from '../../platform/dal/context.js';
import type { Resource } from '@tapcrm/authz';
import { RequestValidationError } from '../../platform/http/auth-error.js';
import { ConflictError, NotFoundError } from '../../platform/http/error-handler.js';
import { z } from 'zod';
import { buildPositionImpactPreview } from './impact.js';

import {
  assertDepartmentCanBeDeleted,
  assertDesignationCanBeDeleted,
  assertPositionCanBeDeleted,
  getDepartment,
  getDesignation,
  getPosition,
  getTeam,
  validatePositionHierarchy,
  validateTeamMembers,
  validateTeamStructure,
} from './validation.js';

/* ==================================================================== *
 * Schemas
 * ==================================================================== */

const departmentCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9][a-z0-9_-]*$/),
  name: z.string().trim().min(1).max(200),
  kind: z.enum(['support', 'delivery']),
});

const departmentPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    status: z.enum(['active', 'inactive']).optional(),
  })
  .refine((value) => value.name !== undefined || value.status !== undefined, {
    message: 'At least one field must be provided.',
  });

const teamCreateSchema = z.object({
  departmentId: z.string().uuid(),
  kind: z.enum(['sales-team', 'sales-pool', 'dev-subteam']),
  name: z.string().trim().min(1).max(200),
  leadUserId: z.string().uuid().nullable().optional(),
  parentTeamId: z.string().uuid().nullable().optional(),
  sharedVisibility: z.boolean().optional(),
});

const teamPatchSchema = z
  .object({
    kind: z.enum(['sales-team', 'sales-pool', 'dev-subteam']).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    leadUserId: z.string().uuid().nullable().optional(),
    parentTeamId: z.string().uuid().nullable().optional(),
    sharedVisibility: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.kind !== undefined ||
      value.name !== undefined ||
      value.leadUserId !== undefined ||
      value.parentTeamId !== undefined ||
      value.sharedVisibility !== undefined,
    {
      message: 'At least one field must be provided.',
    },
  );

const positionCreateSchema = z.object({
  departmentId: z.string().uuid(),
  code: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9][a-z0-9_-]*$/),
  name: z.string().trim().min(1).max(200),
  organizationalLevel: z.number().int().min(1).max(100),
  parentPositionId: z.string().uuid().nullable().optional(),
  maxDealValue: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .nullable()
    .optional(),
  maxDiscountPercent: z.number().min(0).max(100).nullable().optional(),
  allowsCustomTerms: z.boolean().optional(),
});

const positionPatchSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1)
      .max(50)
      .regex(/^[a-z0-9][a-z0-9_-]*$/)
      .optional(),
    name: z.string().trim().min(1).max(200).optional(),
    organizationalLevel: z.number().int().min(1).max(100).optional(),
    parentPositionId: z.string().uuid().nullable().optional(),
    maxDealValue: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .nullable()
      .optional(),
    maxDiscountPercent: z.number().min(0).max(100).nullable().optional(),
    allowsCustomTerms: z.boolean().optional(),
    status: z.enum(['active', 'inactive']).optional(),
  })
  .refine(
    (value) =>
      value.code !== undefined ||
      value.name !== undefined ||
      value.organizationalLevel !== undefined ||
      value.parentPositionId !== undefined ||
      value.maxDealValue !== undefined ||
      value.maxDiscountPercent !== undefined ||
      value.allowsCustomTerms !== undefined ||
      value.status !== undefined,
    {
      message: 'At least one field must be provided.',
    },
  );

const policySchema = z.object({
  action: z.string().trim().min(1).max(150),
  allowed: z.boolean().default(true),
  scope: z.enum(['own', 'participant', 'pool', 'team', 'department', 'all-people']),
  fields: z.array(z.string().trim().min(1)).nullable().optional(),
  constraints: z.array(z.string().trim().min(1)).nullable().optional(),
});

const policyListSchema = z.object({
  policies: z.array(policySchema).max(200),
});

const designationCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  specializations: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
});

const designationPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    specializations: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  })
  .refine((value) => value.name !== undefined || value.specializations !== undefined, {
    message: 'At least one field must be provided.',
  });

const addMembersSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(500),
});

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    throw new RequestValidationError(parsed.error.issues);
  }

  return parsed.data;
}

async function loadResource(
  ctx: RequestContext,
  table: string,
  id: string,
  extra: Record<string, unknown> = {},
): Promise<Resource | null> {
  const allowedTables = new Set([
    'department',
    'team',
    'position',
    'designation',
    'app_user',
  ]);

  if (!allowedTables.has(table)) {
    throw new Error(`Unsupported organization resource table: ${table}`);
  }

  const row = await db.maybeOne<Record<string, unknown>>(
    ctx,
    sql`
      SELECT *
      FROM ${sql.raw(table)}
      WHERE id = ${id}
        AND organization_id = ${ctx.organizationId}
    `,
  );

  if (row === null) {
    return null;
  }

  return {
    ...row,
    ...extra,
    type: table,
    id,
  };
}

/* ==================================================================== *
 * Reads
 * ==================================================================== */

export function registerOrganizationRoutes(): void {
  route({
    method: 'GET',
    path: '/api/org/departments',
    action: 'org:view-structure',
    handler: async ({ ctx }) => {
      const filter = await visibilityFilter(ctx, 'org:view-structure', 'department');

      return db.query(
        ctx,
        sql`
          SELECT
            id,
            code,
            name,
            kind,
            status,
            created_at,
            updated_at
          FROM department
          WHERE ${filter}
          ORDER BY code
        `,
      );
    },
  });

  route({
    method: 'GET',
    path: '/api/org/teams',
    action: 'org:view-structure',
    handler: async ({ ctx }) => {
      const filter = await visibilityFilter(ctx, 'org:view-structure', 'team');

      return db.query(
        ctx,
        sql`
          SELECT
            id,
            department_id,
            kind,
            name,
            lead_user_id,
            parent_team_id,
            shared_visibility,
            created_at,
            updated_at
          FROM team
          WHERE ${filter}
          ORDER BY name
        `,
      );
    },
  });

  route({
    method: 'GET',
    path: '/api/org/ladder/:departmentCode',
    action: 'org:view-structure',
    handler: async ({ ctx, params }) => {
      const filter = await visibilityFilter(ctx, 'org:view-structure', 'position');

      return db.query(
        ctx,
        sql`
          SELECT
            p.id,
            p.code,
            p.name,
            p.department_id,
            p.organizational_level,
            p.parent_position_id,
            p.is_seeded,
            p.status,
            p.max_deal_value,
            p.max_discount_percent,
            p.allows_custom_terms,
            COUNT(u.id)::int AS holder_count
          FROM position p
          JOIN department d
            ON d.id = p.department_id
          LEFT JOIN app_user u
            ON u.position_id = p.id
           AND u.account_type = 'employee'
           AND u.status = 'active'
          WHERE d.code = ${params['departmentCode'] ?? ''}
            AND ${filter}
          GROUP BY
            p.id,
            p.code,
            p.name,
            p.department_id,
            p.organizational_level,
            p.parent_position_id,
            p.is_seeded,
            p.status,
            p.max_deal_value,
            p.max_discount_percent,
            p.allows_custom_terms
          ORDER BY
            p.organizational_level DESC,
            p.code
        `,
      );
    },
  });

  route({
    method: 'GET',
    path: '/api/org/chart',
    action: 'org:view-people',
    handler: async ({ ctx }) => {
      const filter = await visibilityFilter(ctx, 'org:view-people', 'user');

      return db.query(
        ctx,
        sql`
          SELECT
            u.id,
            u.full_name,
            u.email,
            u.position_id,
            p.code AS position_code,
            p.name AS position_name,
            u.department_id,
            d.code AS department_code,
            d.name AS department_name,
            u.team_id,
            t.name AS team_name,
            u.designation_id,
            des.name AS designation_name,
            u.reports_to,
            manager.full_name AS manager_name,
            (
              u.reports_to IS NULL
              AND p.parent_position_id IS NOT NULL
            ) AS missing_manager
          FROM app_user u
          LEFT JOIN position p
            ON p.id = u.position_id
          LEFT JOIN department d
            ON d.id = u.department_id
          LEFT JOIN team t
            ON t.id = u.team_id
          LEFT JOIN designation des
            ON des.id = u.designation_id
          LEFT JOIN app_user manager
            ON manager.id = u.reports_to
          WHERE u.account_type = 'employee'
            AND u.status = 'active'
            AND ${filter}
          ORDER BY
            d.code,
            p.organizational_level DESC,
            u.full_name
        `,
      );
    },
  });

  route({
    method: 'GET',
    path: '/api/org/positions/:id/holders',
    action: 'org:view-people',
    resourceParam: 'id',
    loadResource: (ctx, id) => loadResource(ctx, 'position', id),
    handler: async ({ ctx, params }) => {
      return db.query(
        ctx,
        sql`
          SELECT
            id,
            full_name,
            email,
            status,
            department_id,
            team_id,
            designation_id,
            reports_to
          FROM app_user
          WHERE organization_id = ${ctx.organizationId}
            AND position_id = ${params['id'] ?? ''}
            AND account_type = 'employee'
          ORDER BY full_name
        `,
      );
    },
  });

  route({
    method: 'GET',
    path: '/api/org/positions/:id/policies',
    action: 'org:view-policies',
    resourceParam: 'id',
    loadResource: (ctx, id) => loadResource(ctx, 'position', id),
    handler: async ({ ctx, params }) => {
      return db.query(
        ctx,
        sql`
          SELECT
            id,
            action,
            allowed,
            scope,
            fields,
            constraints,
            created_at,
            updated_at
          FROM position_policy
          WHERE organization_id = ${ctx.organizationId}
            AND position_id = ${params['id'] ?? ''}
          ORDER BY action
        `,
      );
    },
  });

  route({
    method: 'GET',
    path: '/api/org/designations',
    action: 'org:manage-designations',
    handler: async ({ ctx }) => {
      return db.query(
        ctx,
        sql`
          SELECT
            id,
            name,
            specializations,
            created_at,
            updated_at
          FROM designation
          WHERE organization_id = ${ctx.organizationId}
          ORDER BY name
        `,
      );
    },
  });

  /* ================================================================== *
   * Departments
   * ================================================================== */

  route({
    method: 'POST',
    path: '/api/org/departments',
    action: 'org:manage-departments',
    handler: async ({ ctx, body }) => {
      const input = parseBody(departmentCreateSchema, body);

      return db.one(
        ctx,
        sql`
          INSERT INTO department (
            organization_id,
            code,
            name,
            kind
          )
          VALUES (
            ${ctx.organizationId},
            ${input.code},
            ${input.name},
            ${input.kind}
          )
          RETURNING
            id,
            code,
            name,
            kind,
            status,
            created_at,
            updated_at
        `,
      );
    },
  });

  route({
    method: 'PATCH',
    path: '/api/org/departments/:id',
    action: 'org:manage-departments',
    resourceParam: 'id',
    loadResource: (ctx, id) => loadResource(ctx, 'department', id),
    handler: async ({ ctx, params, body }) => {
      const input = parseBody(departmentPatchSchema, body);

      const department = await getDepartment(ctx, params['id'] ?? '');

      /**
       * A department cannot become active if its required
       * structural data is missing. The basic lifecycle is kept
       * simple here; employee assignment is validated by the
       * employee module.
       */
      if (input.status === 'active' && department.status === 'inactive') {
        const activePositionCount = await db.maybeOne<{
          count: number;
        }>(
          ctx,
          sql`
            SELECT COUNT(*)::int AS count
            FROM position
            WHERE organization_id = ${ctx.organizationId}
              AND department_id = ${department.id}
              AND status = 'active'
          `,
        );

        if ((activePositionCount?.count ?? 0) === 0) {
          throw new ConflictError(
            'The department cannot be activated before it has an active position.',
            'department_requires_active_position',
          );
        }
      }

      return db.one(
        ctx,
        sql`
          UPDATE department
          SET
            name = COALESCE(${input.name ?? null}, name),
            status = COALESCE(${input.status ?? null}, status),
            updated_at = now()
          WHERE id = ${department.id}
            AND organization_id = ${ctx.organizationId}
          RETURNING
            id,
            code,
            name,
            kind,
            status,
            created_at,
            updated_at
        `,
      );
    },
  });

  route({
    method: 'DELETE',
    path: '/api/org/departments/:id',
    action: 'org:manage-departments',
    resourceParam: 'id',
    loadResource: (ctx, id) => loadResource(ctx, 'department', id),
    handler: async ({ ctx, params }) => {
      const departmentId = params['id'] ?? '';

      const department = await getDepartment(ctx, departmentId);

      return db.transaction(ctx, async (tx) => {
        await assertDepartmentCanBeDeleted(tx, ctx, department.id);

        /**
         * No cascade cleanup.
         *
         * D-2 says a department in use is deactivated,
         * not destroyed.
         */
        return tx.query(
          sql`
            DELETE FROM department
            WHERE id = ${department.id}
              AND organization_id = ${ctx.organizationId}
            RETURNING
              id,
              code,
              name,
              kind,
              status
          `,
        );
      });
    },
  });

  /* ================================================================== *
   * Teams
   * ================================================================== */

  route({
    method: 'POST',
    path: '/api/org/teams',
    action: 'org:manage-teams',
    handler: async ({ ctx, body }) => {
      const input = parseBody(teamCreateSchema, body);

      return db.transaction(ctx, async (tx) => {
        await validateTeamStructure(tx, ctx, input);

        return tx.one(
          sql`
            INSERT INTO team (
              organization_id,
              department_id,
              kind,
              name,
              lead_user_id,
              parent_team_id,
              shared_visibility
            )
            VALUES (
              ${ctx.organizationId},
              ${input.departmentId},
              ${input.kind},
              ${input.name},
              ${input.leadUserId ?? null},
              ${input.parentTeamId ?? null},
              ${input.sharedVisibility ?? false}
            )
            RETURNING
              id,
              department_id,
              kind,
              name,
              lead_user_id,
              parent_team_id,
              shared_visibility,
              created_at,
              updated_at
          `,
        );
      });
    },
  });

  route({
    method: 'PATCH',
    path: '/api/org/teams/:id',
    action: 'org:manage-teams',
    resourceParam: 'id',
    loadResource: (ctx, id) =>
      loadResource(ctx, 'team', id, {
        teamId: id,
      }),
    handler: async ({ ctx, params, body }) => {
      const input = parseBody(teamPatchSchema, body);

      const existing = await getTeam(ctx, params['id'] ?? '');

      const next = {
        departmentId: existing.departmentId,
        kind: input.kind ?? existing.kind,
        leadUserId:
          input.leadUserId !== undefined ? input.leadUserId : existing.leadUserId,
        parentTeamId:
          input.parentTeamId !== undefined ? input.parentTeamId : existing.parentTeamId,
      } as const;

      return db.transaction(ctx, async (tx) => {
        await validateTeamStructure(tx, ctx, next, existing);

        /**
         * Team kind is not allowed to silently change
         * when existing structure would become invalid.
         */
        if (existing.kind !== next.kind && existing.kind === 'sales-team') {
          const childPools = await tx.maybeOne<{
            count: number;
          }>(
            sql`
              SELECT COUNT(*)::int AS count
              FROM team
              WHERE organization_id = ${ctx.organizationId}
                AND parent_team_id = ${existing.id}
            `,
          );

          if ((childPools?.count ?? 0) > 0) {
            throw new ConflictError(
              'A sales-team with child pools cannot change team kind until those pools are reassigned.',
              'team_has_children',
            );
          }
        }

        return tx.one(
          sql`
            UPDATE team
            SET
              kind = ${next.kind},
              name = COALESCE(${input.name ?? null}, name),
              lead_user_id = ${next.leadUserId},
              parent_team_id = ${next.parentTeamId},
              shared_visibility =
                COALESCE(
                  ${input.sharedVisibility ?? null},
                  shared_visibility
                ),
              updated_at = now()
            WHERE id = ${existing.id}
              AND organization_id = ${ctx.organizationId}
            RETURNING
              id,
              department_id,
              kind,
              name,
              lead_user_id,
              parent_team_id,
              shared_visibility,
              created_at,
              updated_at
          `,
        );
      });
    },
  });

  route({
    method: 'POST',
    path: '/api/org/teams/:id/members',
    action: 'org:manage-teams',
    resourceParam: 'id',
    loadResource: (ctx, id) =>
      loadResource(ctx, 'team', id, {
        teamId: id,
      }),
    handler: async ({ ctx, params, body }) => {
      const input = parseBody(addMembersSchema, body);

      const team = await getTeam(ctx, params['id'] ?? '');

      return db.transaction(ctx, async (tx) => {
        await validateTeamMembers(tx, ctx, team, input.userIds);

        const previousTeams = await tx.query<{
          userId: string;
          previousTeamId: string | null;
        }>(
          sql`
      SELECT
        id AS "userId",
        team_id AS "previousTeamId"
      FROM app_user
      WHERE organization_id = ${ctx.organizationId}
        AND id = ANY(${input.userIds}::uuid[])
        AND account_type = 'employee'
    `,
        );

        await tx.query(
          sql`
      UPDATE app_user
      SET
        team_id = ${team.id},
        updated_at = now()
      WHERE organization_id = ${ctx.organizationId}
        AND id = ANY(${input.userIds}::uuid[])
        AND account_type = 'employee'
    `,
        );

        await tx.query(
          sql`
      INSERT INTO audit_outbox (
        organization_id,
        stream,
        payload
      )
      VALUES (
        ${ctx.organizationId},
        'access',
        ${JSON.stringify({
          action: 'org:manage-teams',
          targetType: 'team',
          targetId: team.id,
          kind: 'team-membership-change',
          changes: previousTeams.map((item) => ({
            userId: item.userId,
            previousTeamId: item.previousTeamId,
            newTeamId: team.id,
          })),
        })}::jsonb
      )
    `,
        );

        return tx.query(
          sql`
      SELECT
        id,
        full_name,
        email,
        team_id,
        department_id,
        position_id,
        status
      FROM app_user
      WHERE organization_id = ${ctx.organizationId}
        AND team_id = ${team.id}
        AND account_type = 'employee'
      ORDER BY full_name
    `,
        );
      });
    },
  });

  /* ================================================================== *
   * Positions
   * ================================================================== */

  route({
    method: 'POST',
    path: '/api/org/positions',
    action: 'org:manage-positions',
    handler: async ({ ctx, body }) => {
      const input = parseBody(positionCreateSchema, body);

      return db.transaction(ctx, async (tx) => {
        /**
         * C-2:
         * Custom positions cannot be root positions.
         */
        await validatePositionHierarchy(
          tx,
          ctx,
          {
            departmentId: input.departmentId,
            organizationalLevel: input.organizationalLevel,
            parentPositionId: input.parentPositionId ?? null,
          },
          {
            allowParentlessSeeded: false,
          },
        );

        return tx.one(
          sql`
            INSERT INTO position (
              organization_id,
              department_id,
              code,
              name,
              organizational_level,
              parent_position_id,
              max_deal_value,
              max_discount_percent,
              allows_custom_terms,
              is_seeded,
              status
            )
            VALUES (
              ${ctx.organizationId},
              ${input.departmentId},
              ${input.code},
              ${input.name},
              ${input.organizationalLevel},
              ${input.parentPositionId ?? null},
              ${input.maxDealValue ?? null},
              ${input.maxDiscountPercent ?? null},
              ${input.allowsCustomTerms ?? false},
              false,
              'active'
            )
            RETURNING
              id,
              department_id,
              code,
              name,
              organizational_level,
              parent_position_id,
              is_seeded,
              status,
              max_deal_value,
              max_discount_percent,
              allows_custom_terms
          `,
        );
      });
    },
  });

  route({
    method: 'PATCH',
    path: '/api/org/positions/:id',
    action: 'org:manage-positions',
    resourceParam: 'id',
    loadResource: (ctx, id) => loadResource(ctx, 'position', id),
    handler: async ({ ctx, params, body }) => {
      const input = parseBody(positionPatchSchema, body);

      const existing = await getPosition(ctx, params['id'] ?? '');

      /**
       * Seeded structural fields are protected.
       *
       * A seeded position can still be activated/deactivated
       * and its operational approval limits can be configured,
       * but its identity/hierarchy should not be casually changed.
       */
      if (
        existing.isSeeded &&
        (input.code !== undefined ||
          input.name !== undefined ||
          input.organizationalLevel !== undefined ||
          input.parentPositionId !== undefined)
      ) {
        throw new ConflictError(
          'Seeded position identity and hierarchy are immutable. Create a custom position instead.',
          'seeded_position_structure',
        );
      }

      const nextLevel = input.organizationalLevel ?? existing.organizationalLevel;

      const nextParent =
        input.parentPositionId !== undefined
          ? input.parentPositionId
          : existing.parentPositionId;

      return db.transaction(ctx, async (tx) => {
        if (
          !existing.isSeeded &&
          (input.organizationalLevel !== undefined ||
            input.parentPositionId !== undefined)
        ) {
          await validatePositionHierarchy(
            tx,
            ctx,
            {
              departmentId: existing.departmentId,
              organizationalLevel: nextLevel,
              parentPositionId: nextParent,
            },
            {
              existingPositionId: existing.id,
              allowParentlessSeeded: false,
            },
          );
        }

        return tx.one(
          sql`
            UPDATE position
            SET
              code = COALESCE(${input.code ?? null}, code),
              name = COALESCE(${input.name ?? null}, name),
              organizational_level = ${nextLevel},
              parent_position_id = ${nextParent},
              max_deal_value =
                CASE
                  WHEN ${input.maxDealValue !== undefined}
                    THEN ${input.maxDealValue}
                  ELSE max_deal_value
                END,
              max_discount_percent =
                CASE
                  WHEN ${input.maxDiscountPercent !== undefined}
                    THEN ${input.maxDiscountPercent}
                  ELSE max_discount_percent
                END,
              allows_custom_terms =
                COALESCE(
                  ${input.allowsCustomTerms ?? null},
                  allows_custom_terms
                ),
              status =
                COALESCE(
                  ${input.status ?? null},
                  status
                ),
              updated_at = now()
            WHERE id = ${existing.id}
              AND organization_id = ${ctx.organizationId}
            RETURNING
              id,
              department_id,
              code,
              name,
              organizational_level,
              parent_position_id,
              is_seeded,
              status,
              max_deal_value,
              max_discount_percent,
              allows_custom_terms
          `,
        );
      });
    },
  });

  route({
    method: 'DELETE',
    path: '/api/org/positions/:id',
    action: 'org:manage-positions',
    resourceParam: 'id',
    loadResource: (ctx, id) => loadResource(ctx, 'position', id),
    handler: async ({ ctx, params }) => {
      const position = await getPosition(ctx, params['id'] ?? '');

      return db.transaction(ctx, async (tx) => {
        await assertPositionCanBeDeleted(tx, ctx, position);

        return tx.query(
          sql`
            DELETE FROM position
            WHERE id = ${position.id}
              AND organization_id = ${ctx.organizationId}
            RETURNING
              id,
              department_id,
              code,
              name,
              organizational_level,
              parent_position_id,
              is_seeded,
              status
          `,
        );
      });
    },
  });

  /* ================================================================== *
   * Position policies
   * ================================================================== */

  route({
    method: 'PUT',
    path: '/api/org/positions/:id/policies',
    action: 'org:manage-positions',
    resourceParam: 'id',
    loadResource: (ctx, id) => loadResource(ctx, 'position', id),
    handler: async ({ ctx, params, body }) => {
      const input = parseBody(policyListSchema, body);

      const position = await getPosition(ctx, params['id'] ?? '');

      if (position.status !== 'active') {
        throw new ConflictError(
          'Policies cannot be changed for an inactive position.',
          'inactive_position',
        );
      }

      const uniqueActions = new Set(input.policies.map((policy) => policy.action));

      if (uniqueActions.size !== input.policies.length) {
        throw new ConflictError(
          'A position may have only one policy row per action.',
          'duplicate_policy_action',
        );
      }

      return db.transaction(ctx, async (tx) => {
        const beforePolicies = await tx.query<{
          action: string;
          allowed: boolean;
          scope: string;
          fields: string[] | null;
          constraints: string[] | null;
        }>(
          sql`
          SELECT
            action,
            allowed,
            scope,
            fields,
            constraints
          FROM position_policy
          WHERE organization_id = ${ctx.organizationId}
            AND position_id = ${position.id}
          ORDER BY action
        `,
        );

        await tx.query(
          sql`
          DELETE FROM position_policy
          WHERE organization_id = ${ctx.organizationId}
            AND position_id = ${position.id}
        `,
        );

        for (const policy of input.policies) {
          await tx.query(
            sql`
            INSERT INTO position_policy (
              organization_id,
              position_id,
              action,
              allowed,
              scope,
              fields,
              constraints
            )
            VALUES (
              ${ctx.organizationId},
              ${position.id},
              ${policy.action},
              ${policy.allowed},
              ${policy.scope},
              ${policy.fields ?? null},
              ${policy.constraints ?? null}
            )
          `,
          );
        }

        const afterPolicies = await tx.query<{
          action: string;
          allowed: boolean;
          scope: string;
          fields: string[] | null;
          constraints: string[] | null;
        }>(
          sql`
          SELECT
            action,
            allowed,
            scope,
            fields,
            constraints
          FROM position_policy
          WHERE organization_id = ${ctx.organizationId}
            AND position_id = ${position.id}
          ORDER BY action
        `,
        );

        const holders = await tx.query<{
          id: string;
          fullName: string;
          email: string | null;
        }>(
          sql`
          SELECT
            id,
            full_name AS "fullName",
            email
          FROM app_user
          WHERE organization_id = ${ctx.organizationId}
            AND position_id = ${position.id}
            AND account_type = 'employee'
            AND status = 'active'
          ORDER BY full_name
        `,
        );

        await tx.query(
          sql`
          INSERT INTO audit_outbox (
            organization_id,
            stream,
            payload
          )
          VALUES (
            ${ctx.organizationId},
            'access',
            ${JSON.stringify({
              action: 'org:manage-positions',
              targetType: 'position',
              targetId: position.id,
              kind: 'position-policy-change',
              before: beforePolicies,
              after: afterPolicies,
              holderIds: holders.map((holder) => holder.id),
              holderCount: holders.length,
            })}::jsonb
          )
        `,
        );

        await tx.query(
          sql`
          INSERT INTO domain_outbox (
            organization_id,
            event_name,
            payload
          )
          VALUES (
            ${ctx.organizationId},
            'organization.position-policies-changed',
            ${JSON.stringify({
              positionId: position.id,
              positionCode: position.code,
              holderIds: holders.map((holder) => holder.id),
              holderCount: holders.length,
              before: beforePolicies,
              after: afterPolicies,
            })}::jsonb
          )
        `,
        );

        return afterPolicies;
      });
    },
  });

  route({
    method: 'POST',
    path: '/api/org/positions/:id/policy-preview',
    action: 'org:manage-positions',
    resourceParam: 'id',
    loadResource: (ctx, id) => loadResource(ctx, 'position', id),
    handler: async ({ ctx, params, body }) => {
      const input = parseBody(policyListSchema, body);

      return buildPositionImpactPreview(ctx, params['id'] ?? '', input.policies);
    },
  });

  /* ================================================================== *
   * Designations
   * ================================================================== */

  route({
    method: 'POST',
    path: '/api/org/designations',
    action: 'org:manage-designations',
    handler: async ({ ctx, body }) => {
      const input = parseBody(designationCreateSchema, body);

      const specializations = [...new Set(input.specializations)];

      return db.one(
        ctx,
        sql`
          INSERT INTO designation (
            organization_id,
            name,
            specializations
          )
          VALUES (
            ${ctx.organizationId},
            ${input.name},
            ${specializations}
          )
          RETURNING
            id,
            name,
            specializations,
            created_at,
            updated_at
        `,
      );
    },
  });

  route({
    method: 'PATCH',
    path: '/api/org/designations/:id',
    action: 'org:manage-designations',
    resourceParam: 'id',
    loadResource: (ctx, id) => loadResource(ctx, 'designation', id),
    handler: async ({ ctx, params, body }) => {
      const input = parseBody(designationPatchSchema, body);

      const designation = await getDesignation(ctx, params['id'] ?? '');

      const specializations =
        input.specializations !== undefined
          ? [...new Set(input.specializations)]
          : undefined;

      return db.one(
        ctx,
        sql`
          UPDATE designation
          SET
            name =
              COALESCE(
                ${input.name ?? null},
                name
              ),
            specializations =
              CASE
                WHEN ${specializations !== undefined}
                  THEN ${specializations}
                ELSE specializations
              END,
            updated_at = now()
          WHERE id = ${designation.id}
            AND organization_id = ${ctx.organizationId}
          RETURNING
            id,
            name,
            specializations,
            created_at,
            updated_at
        `,
      );
    },
  });

  route({
    method: 'DELETE',
    path: '/api/org/designations/:id',
    action: 'org:manage-designations',
    resourceParam: 'id',
    loadResource: (ctx, id) => loadResource(ctx, 'designation', id),
    handler: async ({ ctx, params }) => {
      const designation = await getDesignation(ctx, params['id'] ?? '');

      return db.transaction(ctx, async (tx) => {
        await assertDesignationCanBeDeleted(tx, ctx, designation.id);

        return tx.query(
          sql`
            DELETE FROM designation
            WHERE id = ${designation.id}
              AND organization_id = ${ctx.organizationId}
            RETURNING
              id,
              name,
              specializations,
              created_at,
              updated_at
          `,
        );
      });
    },
  });
}
