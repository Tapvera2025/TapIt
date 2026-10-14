import type { Resource } from '@tapcrm/authz';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { route } from '../../platform/http/route.js';
import { makeAdvanceResource } from './policy.js';
import {
  approveAdvance,
  createDeduction,
  createManualAdvance,
  exportApprovedAdvances,
  exportDeductions,
  getAdvance,
  listAdvances,
  listDeductions,
  rejectAdvance,
  requestAdvance,
} from './service.js';
import {
  approveAdvanceSchema,
  deductionSchema,
  listAdvanceSchema,
  listDeductionSchema,
  manualAdvanceSchema,
  rejectAdvanceSchema,
  requestAdvanceSchema,
} from './validators.js';

async function loadAdvance(ctx: RequestContext, id: string): Promise<Resource | null> {
  const row = await db.maybeOne<{
    id: string;
    organizationId: string;
    employeeId: string;
  }>(
    ctx,
    sql`SELECT id, organization_id AS "organizationId", employee_id AS "employeeId" FROM employee_advance WHERE organization_id=${ctx.organizationId} AND id=${id}`,
  );
  return row ? makeAdvanceResource(row.id, row.organizationId, row.employeeId) : null;
}

export function registerAdvanceRoutes(): void {
  route({
    method: 'GET',
    path: '/api/advances/mine',
    action: 'advance:view-own',
    module: 'advance',
    handler: async ({ ctx, query }) =>
      listAdvances(ctx, listAdvanceSchema.parse(query), true),
  });
  route({
    method: 'POST',
    path: '/api/advances',
    action: 'advance:request',
    module: 'advance',
    status: 201,
    handler: async ({ ctx, body }) =>
      // Express leaves req.body undefined when a client sends no JSON body.
      // Parse an empty object so the response identifies the missing fields
      // instead of collapsing everything into the misleading `request: Required`.
      requestAdvance(ctx, requestAdvanceSchema.parse(body ?? {})),
  });
  route({
    method: 'GET',
    path: '/api/advances/deductions/export',
    action: 'advance:export',
    module: 'advance',
    handler: async ({ ctx, query, res }) => {
      const format = query['format'] === 'xlsx' ? 'xlsx' : 'csv';
      const approved = query['view'] === 'approved';
      const file = approved
        ? await exportApprovedAdvances(ctx, listAdvanceSchema.parse(query), format)
        : await exportDeductions(ctx, listDeductionSchema.parse(query), format);
      res.setHeader('Content-Type', file.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
      res.send(file.body);
      return null;
    },
  });
  route({
    method: 'GET',
    path: '/api/advances/deductions',
    action: 'advance:view',
    module: 'advance',
    handler: async ({ ctx, query }) =>
      listDeductions(ctx, listDeductionSchema.parse(query)),
  });
  route({
    method: 'GET',
    path: '/api/advances',
    action: 'advance:view',
    module: 'advance',
    handler: async ({ ctx, query }) => listAdvances(ctx, listAdvanceSchema.parse(query)),
  });
  route({
    method: 'GET',
    path: '/api/advances/:id',
    action: 'advance:view',
    module: 'advance',
    resourceParam: 'id',
    loadResource: loadAdvance,
    handler: async ({ ctx, params }) => getAdvance(ctx, params['id']!),
  });
  route({
    method: 'POST',
    path: '/api/advances/:id/approve',
    action: 'advance:approve',
    module: 'advance',
    resourceParam: 'id',
    loadResource: loadAdvance,
    handler: async ({ ctx, params, body }) => {
      await approveAdvance(ctx, params['id']!, approveAdvanceSchema.parse(body ?? {}));
      return null;
    },
  });
  route({
    method: 'POST',
    path: '/api/advances/:id/reject',
    action: 'advance:approve',
    module: 'advance',
    resourceParam: 'id',
    loadResource: loadAdvance,
    handler: async ({ ctx, params, body }) => {
      await rejectAdvance(ctx, params['id']!, rejectAdvanceSchema.parse(body ?? {}));
      return null;
    },
  });
  route({
    method: 'POST',
    path: '/api/advances/manual',
    action: 'advance:manage',
    module: 'advance',
    status: 201,
    handler: async ({ ctx, body }) => {
      await createManualAdvance(ctx, manualAdvanceSchema.parse(body ?? {}));
      return null;
    },
  });
  route({
    method: 'POST',
    path: '/api/advances/:id/deductions',
    action: 'advance:manage',
    module: 'advance',
    resourceParam: 'id',
    loadResource: loadAdvance,
    handler: async ({ ctx, params, body }) => {
      await createDeduction(ctx, params['id']!, deductionSchema.parse(body ?? {}));
      return null;
    },
  });
}
