import type { Resource } from '@tapcrm/authz';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { route } from '../../platform/http/route.js';
import { makePenaltyResource } from './policy.js';
import {
  cancelPenalty,
  createPenalty,
  exportPenalties,
  getManagedPenalty,
  getPenalty,
  listPenalties,
} from './service.js';
import {
  cancelPenaltySchema,
  createPenaltySchema,
  listPenaltySchema,
} from './validators.js';

async function loadPenalty(ctx: RequestContext, id: string): Promise<Resource | null> {
  const row = await db.maybeOne<{
    id: string;
    organizationId: string;
    employeeId: string;
    departmentId: string | null;
    teamId: string | null;
  }>(
    ctx,
    sql`
    SELECT p.id, p.organization_id AS "organizationId", p.employee_id AS "employeeId", u.department_id AS "departmentId", u.team_id AS "teamId"
    FROM employee_penalty p JOIN app_user u ON u.organization_id = p.organization_id AND u.id = p.employee_id
    WHERE p.organization_id = ${ctx.organizationId} AND p.id = ${id}
  `,
  );
  return row
    ? makePenaltyResource(
        row.id,
        row.organizationId,
        row.employeeId,
        row.departmentId,
        row.teamId,
      )
    : null;
}

export function registerPenaltyRoutes(): void {
  route({
    method: 'GET',
    path: '/api/penalties/export',
    action: 'penalty:export',
    module: 'penalties',
    handler: async ({ ctx, query, res }) => {
      const format = query['format'] === 'xlsx' ? 'xlsx' : 'csv';
      const file = await exportPenalties(ctx, listPenaltySchema.parse(query), format);
      res.setHeader('Content-Type', file.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
      res.send(file.body);
      return null;
    },
  });
  route({
    method: 'GET',
    path: '/api/penalties/mine',
    action: 'penalty:view-own',
    module: 'penalties',
    handler: async ({ ctx, query }) =>
      listPenalties(ctx, listPenaltySchema.parse(query), true),
  });
  route({
    method: 'GET',
    path: '/api/penalties/mine/:id',
    action: 'penalty:view-own',
    module: 'penalties',
    resourceParam: 'id',
    loadResource: loadPenalty,
    handler: async ({ ctx, params }) => getPenalty(ctx, params['id']!),
  });
  route({
    method: 'GET',
    path: '/api/penalties',
    action: 'penalty:view',
    module: 'penalties',
    handler: async ({ ctx, query }) => listPenalties(ctx, listPenaltySchema.parse(query)),
  });
  route({
    method: 'POST',
    path: '/api/penalties',
    action: 'penalty:manage',
    module: 'penalties',
    status: 201,
    handler: async ({ ctx, body }) =>
      createPenalty(ctx, createPenaltySchema.parse(body ?? {})),
  });
  route({
    method: 'GET',
    path: '/api/penalties/:id',
    action: 'penalty:view',
    module: 'penalties',
    resourceParam: 'id',
    loadResource: loadPenalty,
    handler: async ({ ctx, params }) => getManagedPenalty(ctx, params['id']!),
  });
  route({
    method: 'POST',
    path: '/api/penalties/:id/cancel',
    action: 'penalty:manage',
    module: 'penalties',
    resourceParam: 'id',
    loadResource: loadPenalty,
    handler: async ({ ctx, params, body }) => {
      await cancelPenalty(ctx, params['id']!, cancelPenaltySchema.parse(body ?? {}));
      return null;
    },
  });
}
