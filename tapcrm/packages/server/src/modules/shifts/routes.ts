import type { Resource } from '@tapcrm/authz';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { route } from '../../platform/http/route.js';
import { sql } from '../../platform/dal/sql.js';
import {
  assign,
  createShift,
  decideRequest,
  explainShifts,
  listShiftTemplates,
  reviseShift,
} from './service.js';
import {
  assignmentSchema,
  createShiftSchema,
  decideSchema,
  explainQuerySchema,
  reviseShiftSchema,
} from './validators.js';

/** Design §6.4 — the six bindings AUTHORIZATION.md §6.5 lists. Raising and listing requests wait for G3. */

async function loadShift(ctx: RequestContext, id: string): Promise<Resource | null> {
  return db.maybeOne<Resource>(
    ctx,
    sql`
    SELECT 'shift' AS type, id, organization_id AS "organizationId" FROM shift WHERE id = ${id}
  `,
  );
}

async function loadShiftRequest(
  ctx: RequestContext,
  id: string,
): Promise<Resource | null> {
  return db.maybeOne<Resource>(
    ctx,
    sql`
    SELECT 'shiftRequest' AS type, r.id, r.organization_id AS "organizationId", r.user_id AS "userId",
           u.team_id AS "teamId", u.department_id AS "departmentId",
           r.requested_by AS "requestedBy", r.status
    FROM shift_request r
    JOIN app_user u ON u.organization_id = r.organization_id AND u.id = r.user_id
    WHERE r.id = ${id}
  `,
  );
}

export function registerShiftRoutes(): void {
  route({
    method: 'GET',
    path: '/api/shifts',
    action: 'shifts:view',
    module: 'shifts',
    handler: async ({ ctx }) => listShiftTemplates(ctx),
  });

  route({
    method: 'POST',
    path: '/api/shifts',
    action: 'shifts:manage',
    module: 'shifts',
    handler: async ({ ctx, body }) => createShift(ctx, createShiftSchema.parse(body)),
  });

  route({
    method: 'PATCH',
    path: '/api/shifts/:id',
    action: 'shifts:manage',
    module: 'shifts',
    resourceParam: 'id',
    loadResource: loadShift,
    handler: async ({ ctx, params, body }) =>
      reviseShift(ctx, params['id']!, reviseShiftSchema.parse(body)),
  });

  route({
    method: 'GET',
    path: '/api/shifts/assignments',
    action: 'shifts:view',
    module: 'shifts',
    handler: async ({ ctx, query }) =>
      explainShifts(ctx, explainQuerySchema.parse(query)),
  });

  route({
    method: 'POST',
    path: '/api/shifts/assignments',
    action: 'shifts:manage',
    module: 'shifts',
    handler: async ({ ctx, body }) => assign(ctx, assignmentSchema.parse(body)),
  });

  route({
    method: 'POST',
    path: '/api/shifts/requests/:id/decide',
    action: 'shifts:approve',
    module: 'shifts',
    resourceParam: 'id',
    loadResource: loadShiftRequest,
    status: 200,
    handler: async ({ ctx, params, body }) =>
      decideRequest(ctx, params['id']!, decideSchema.parse(body)),
  });
}
