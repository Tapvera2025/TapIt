import type { Resource } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { route } from '../../../platform/http/route.js';
import {
  dunInvoice,
  approveWriteOff,
  createDispute,
  createPromise,
  createTask,
  getStatement,
  listAging,
  listAgingBuckets,
  listCollections,
  listDisputes,
  listPromises,
  listReminders,
  listStatementClients,
  listTasks,
  listTds,
  listWriteOffs,
  proposeWriteOff,
  resolveDispute,
  resolvePromise,
  setDunningSchedule,
  updateTask,
} from './service.js';
import {
  collectionTaskSchema,
  disputeResolutionSchema,
  disputeSchema,
  dunningScheduleSchema,
  dunningSchema,
  promiseResolutionSchema,
  promiseSchema,
  taskStatusSchema,
  writeOffSchema,
} from './validators.js';

async function invoiceResource(
  ctx: RequestContext,
  id: string,
): Promise<Resource | null> {
  const row = await db.maybeOne<{
    id: string;
    organizationId: string;
    createdBy: string;
  }>(
    ctx,
    sql`SELECT id,organization_id AS "organizationId",issued_by AS "createdBy"
      FROM finance_invoice WHERE organization_id=${ctx.organizationId} AND id=${id}`,
  );
  return row ? { type: 'invoice', ...row, proposedBy: null } : null;
}

async function clientResource(ctx: RequestContext, id: string): Promise<Resource | null> {
  const row = await db.maybeOne<{ id: string }>(
    ctx,
    sql`SELECT id FROM client WHERE organization_id=${ctx.organizationId} AND id=${id}`,
  );
  return row
    ? {
        type: 'client',
        id: row.id,
        organizationId: ctx.organizationId,
        proposedBy: null,
      }
    : null;
}
async function writeOffResource(
  ctx: RequestContext,
  id: string,
): Promise<Resource | null> {
  const row = await db.maybeOne<{ id: string; invoiceId: string; proposedBy: string }>(
    ctx,
    sql`SELECT w.id,i.id AS "invoiceId",w.proposed_by AS "proposedBy" FROM finance_receivable_write_off w JOIN finance_invoice i ON i.organization_id=w.organization_id AND i.id=w.invoice_id WHERE w.organization_id=${ctx.organizationId} AND w.id=${id}`,
  );
  return row
    ? {
        type: 'invoice',
        id: row.invoiceId,
        organizationId: ctx.organizationId,
        proposedBy: row.proposedBy,
      }
    : null;
}

export function registerReceivablesRoutes(): void {
  route({
    method: 'GET',
    path: '/api/receivables/aging',
    action: 'receivables:view',
    module: 'receivables',
    handler: async ({ ctx }) => listAging(ctx),
  });
  route({
    method: 'GET',
    path: '/api/receivables/aging/buckets',
    action: 'receivables:view',
    module: 'receivables',
    handler: async ({ ctx }) => listAgingBuckets(ctx),
  });
  route({
    method: 'GET',
    path: '/api/receivables/statement/:clientId',
    action: 'receivables:view',
    module: 'receivables',
    resourceParam: 'clientId',
    loadResource: clientResource,
    handler: async ({ ctx, params }) => getStatement(ctx, params['clientId']!),
  });
  route({
    method: 'GET',
    path: '/api/receivables/disputes',
    action: 'receivables:view',
    module: 'receivables',
    handler: async ({ ctx }) => listDisputes(ctx),
  });
  route({
    method: 'GET',
    path: '/api/receivables/statements',
    action: 'receivables:view',
    module: 'receivables',
    handler: async ({ ctx }) => listStatementClients(ctx),
  });
  route({
    method: 'GET',
    path: '/api/receivables/promises',
    action: 'receivables:view',
    module: 'receivables',
    handler: async ({ ctx }) => listPromises(ctx),
  });
  route({
    method: 'GET',
    path: '/api/receivables/tasks',
    action: 'receivables:view',
    module: 'receivables',
    handler: async ({ ctx }) => listTasks(ctx),
  });
  route({
    method: 'GET',
    path: '/api/receivables/reminders',
    action: 'receivables:view',
    module: 'receivables',
    handler: async ({ ctx }) => listReminders(ctx),
  });
  route({
    method: 'GET',
    path: '/api/receivables/write-offs',
    action: 'receivables:view',
    module: 'receivables',
    handler: async ({ ctx }) => listWriteOffs(ctx),
  });
  route({
    method: 'GET',
    path: '/api/receivables/collections',
    action: 'receivables:view',
    module: 'receivables',
    handler: async ({ ctx }) => listCollections(ctx),
  });
  route({
    method: 'POST',
    path: '/api/receivables/:invoiceId/disputes',
    action: 'receivables:dun',
    module: 'receivables',
    resourceParam: 'invoiceId',
    loadResource: invoiceResource,
    handler: async ({ ctx, params, body }) =>
      createDispute(ctx, params['invoiceId']!, disputeSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/receivables/disputes/:id/resolve',
    action: 'receivables:dun',
    module: 'receivables',
    resourceParam: 'id',
    loadResource: async (ctx, id) => {
      const row = await db.maybeOne<{
        id: string;
        organizationId: string;
        invoiceId: string;
      }>(
        ctx,
        sql`SELECT id,organization_id AS "organizationId",invoice_id AS "invoiceId" FROM finance_receivable_dispute WHERE organization_id=${ctx.organizationId} AND id=${id}`,
      );
      return row
        ? {
            type: 'invoice',
            id: row.invoiceId,
            organizationId: row.organizationId,
            proposedBy: null,
          }
        : null;
    },
    handler: async ({ ctx, params, body }) =>
      resolveDispute(ctx, params['id']!, disputeResolutionSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/receivables/:invoiceId/promises',
    action: 'receivables:dun',
    module: 'receivables',
    resourceParam: 'invoiceId',
    loadResource: invoiceResource,
    handler: async ({ ctx, params, body }) =>
      createPromise(ctx, params['invoiceId']!, promiseSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/receivables/promises/:id/resolve',
    action: 'receivables:dun',
    module: 'receivables',
    resourceParam: 'id',
    loadResource: async (ctx, id) => {
      const row = await db.maybeOne<{ invoiceId: string }>(
        ctx,
        sql`SELECT invoice_id AS "invoiceId" FROM finance_receivable_promise WHERE organization_id=${ctx.organizationId} AND id=${id}`,
      );
      return row
        ? {
            type: 'invoice',
            id: row.invoiceId,
            organizationId: ctx.organizationId,
            proposedBy: null,
          }
        : null;
    },
    handler: async ({ ctx, params, body }) =>
      resolvePromise(ctx, params['id']!, promiseResolutionSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/receivables/tasks',
    action: 'receivables:dun',
    module: 'receivables',
    status: 201,
    handler: async ({ ctx, body }) => createTask(ctx, collectionTaskSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/receivables/tasks/:id/status',
    action: 'receivables:dun',
    module: 'receivables',
    resourceParam: 'id',
    loadResource: async (ctx, id) => {
      const row = await db.maybeOne<{ id: string; organizationId: string }>(
        ctx,
        sql`SELECT id,organization_id AS "organizationId" FROM finance_receivable_collection_task WHERE organization_id=${ctx.organizationId} AND id=${id}`,
      );
      return row
        ? {
            type: 'invoice',
            id: row.id,
            organizationId: row.organizationId,
            proposedBy: null,
          }
        : null;
    },
    handler: async ({ ctx, params, body }) =>
      updateTask(ctx, params['id']!, taskStatusSchema.parse(body)),
  });
  route({
    method: 'GET',
    path: '/api/receivables/tds',
    action: 'receivables:view',
    module: 'receivables',
    handler: async ({ ctx }) => listTds(ctx),
  });
  route({
    method: 'POST',
    path: '/api/receivables/:invoiceId/dun',
    action: 'receivables:dun',
    module: 'receivables',
    resourceParam: 'invoiceId',
    loadResource: invoiceResource,
    handler: async ({ ctx, params, body }) =>
      dunInvoice(ctx, params['invoiceId']!, dunningSchema.parse(body).reason),
  });
  route({
    method: 'PUT',
    path: '/api/receivables/dunning-schedule',
    action: 'receivables:dun',
    module: 'receivables',
    handler: async ({ ctx, body }) =>
      setDunningSchedule(ctx, dunningScheduleSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/receivables/:invoiceId/write-off',
    action: 'receivables:write-off',
    module: 'receivables',
    resourceParam: 'invoiceId',
    loadResource: invoiceResource,
    handler: async ({ ctx, params, body }) =>
      proposeWriteOff(ctx, params['invoiceId']!, writeOffSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/receivables/write-offs/:id/approve',
    action: 'receivables:write-off',
    module: 'receivables',
    resourceParam: 'id',
    loadResource: writeOffResource,
    handler: async ({ ctx, params, body }) =>
      approveWriteOff(ctx, params['id']!, dunningSchema.parse(body).reason),
  });
}
