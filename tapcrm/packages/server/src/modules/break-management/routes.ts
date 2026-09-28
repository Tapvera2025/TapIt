import type { Resource } from '@tapcrm/authz';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { route } from '../../platform/http/route.js';
import { systemClock } from '../../platform/time.js';
import {
  listPolicies,
  createPolicy,
  revisePolicy,
  assignPolicy,
  previewPolicy,
  resolveUserPolicy,
  confirmBreach,
  waiveBreach,
  addExplanation,
  listBreaches,
  getAllowanceForCaller,
  getPromptsForCaller,
} from './service.js';
import {
  createPolicySchema,
  revisePolicySchema,
  assignPolicySchema,
  previewPolicySchema,
  listPoliciesSchema,
  resolveQuerySchema,
  confirmBreachSchema,
  waiveBreachSchema,
  explanationSchema,
  listBreachesSchema,
} from './validators.js';

async function loadBreakPolicy(ctx: RequestContext, id: string): Promise<Resource | null> {
  const row = await db.maybeOne<{ id: string; organizationId: string }>(
    ctx,
    sql`SELECT id, organization_id AS "organizationId" FROM break_policy WHERE id = ${id}`,
  );
  return row ? { type: 'breakPolicy', id: row.id, organizationId: row.organizationId } : null;
}

async function loadBreakPolicyUser(ctx: RequestContext, userId: string): Promise<Resource | null> {
  const row = await db.maybeOne<{
    id: string;
    organizationId: string;
    userId: string;
    departmentId: string | null;
    teamId: string | null;
  }>(
    ctx,
    sql`
      SELECT id, organization_id AS "organizationId",
             id AS "userId",
             department_id AS "departmentId",
             team_id AS "teamId"
      FROM app_user
      WHERE id = ${userId} AND account_type = 'employee'
    `,
  );
  return row
    ? {
        type: 'breakBreach',
        id: row.id,
        organizationId: row.organizationId,
        userId: row.userId,
        departmentId: row.departmentId,
        teamId: row.teamId,
      }
    : null;
}

async function loadBreachResource(ctx: RequestContext, id: string): Promise<Resource | null> {
  const row = await db.maybeOne<{
    id: string;
    organizationId: string;
    userId: string;
    departmentId: string | null;
    teamId: string | null;
  }>(
    ctx,
    sql`
      SELECT bb.id, bb.organization_id AS "organizationId", bb.user_id AS "userId",
             u.department_id AS "departmentId", u.team_id AS "teamId"
      FROM break_breach bb
      JOIN app_user u ON u.id = bb.user_id AND u.organization_id = bb.organization_id
      WHERE bb.id = ${id}
    `,
  );
  return row
    ? { type: 'breakBreach', id: row.id, organizationId: row.organizationId, userId: row.userId, departmentId: row.departmentId, teamId: row.teamId }
    : null;
}

export function registerBreakManagementRoutes(): void {
  // ── Employee self-service routes (Task 7) ───────────────────────────────────
  route({
    method: 'GET',
    path: '/api/breaks/allowance/me',
    action: 'breaks:view',
    module: 'break-management',
    handler: async ({ ctx }) => getAllowanceForCaller(ctx, systemClock),
  });

  route({
    method: 'GET',
    path: '/api/breaks/prompts/me',
    action: 'breaks:view',
    module: 'break-management',
    handler: async ({ ctx }) => getPromptsForCaller(ctx),
  });

  // ── Breach routes (Task 6) ──────────────────────────────────────────────────
  route({
    method: 'GET',
    path: '/api/breaks/breaches',
    action: 'breaks:view',
    module: 'break-management',
    handler: async ({ ctx, query }) => listBreaches(ctx, listBreachesSchema.parse(query)),
  });

  route({
    method: 'POST',
    path: '/api/breaks/breaches/:id/confirm',
    action: 'breaks:review-breach',
    module: 'break-management',
    resourceParam: 'id',
    loadResource: loadBreachResource,
    handler: async ({ ctx, params, body }) =>
      confirmBreach(ctx, params['id']!, confirmBreachSchema.parse(body)),
  });

  route({
    method: 'POST',
    path: '/api/breaks/breaches/:id/waive',
    action: 'breaks:review-breach',
    module: 'break-management',
    resourceParam: 'id',
    loadResource: loadBreachResource,
    handler: async ({ ctx, params, body }) =>
      waiveBreach(ctx, params['id']!, waiveBreachSchema.parse(body)),
  });

  route({
    method: 'POST',
    path: '/api/breaks/breaches/:id/explanation',
    action: 'breaks:explain',
    module: 'break-management',
    resourceParam: 'id',
    loadResource: loadBreachResource,
    handler: async ({ ctx, params, body }) =>
      addExplanation(ctx, params['id']!, explanationSchema.parse(body)),
  });

  // ── Policy routes ───────────────────────────────────────────────────────────
  route({
    method: 'GET',
    path: '/api/breaks/policies',
    action: 'breaks:manage-policy',
    module: 'break-management',
    handler: async ({ ctx, query }) => listPolicies(ctx, listPoliciesSchema.parse(query)),
  });

  route({
    method: 'POST',
    path: '/api/breaks/policies',
    action: 'breaks:manage-policy',
    module: 'break-management',
    status: 201,
    handler: async ({ ctx, body }) => createPolicy(ctx, createPolicySchema.parse(body)),
  });

  route({
    method: 'PATCH',
    path: '/api/breaks/policies/:id',
    action: 'breaks:manage-policy',
    module: 'break-management',
    resourceParam: 'id',
    loadResource: loadBreakPolicy,
    handler: async ({ ctx, params, body }) =>
      revisePolicy(ctx, params['id']!, revisePolicySchema.parse(body)),
  });

  route({
    method: 'POST',
    path: '/api/breaks/policies/:id/preview',
    action: 'breaks:manage-policy',
    module: 'break-management',
    resourceParam: 'id',
    loadResource: loadBreakPolicy,
    handler: async ({ ctx, params, body }) =>
      previewPolicy(ctx, params['id']!, previewPolicySchema.parse(body)),
  });

  route({
    method: 'POST',
    path: '/api/breaks/policies/:id/assign',
    action: 'breaks:manage-policy',
    module: 'break-management',
    status: 201,
    resourceParam: 'id',
    loadResource: loadBreakPolicy,
    handler: async ({ ctx, params, body }) =>
      assignPolicy(ctx, params['id']!, assignPolicySchema.parse(body)),
  });

  route({
    method: 'GET',
    path: '/api/breaks/policies/resolve/:userId',
    action: 'breaks:view',
    module: 'break-management',
    resourceParam: 'userId',
    loadResource: loadBreakPolicyUser,
    handler: async ({ ctx, params, query }) =>
      resolveUserPolicy(ctx, params['userId']!, resolveQuerySchema.parse(query)),
  });
}
