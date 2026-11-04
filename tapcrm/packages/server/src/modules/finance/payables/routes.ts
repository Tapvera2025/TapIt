import type { Resource } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { route } from '../../../platform/http/route.js';
import * as service from './service.js';
import {
  bankChangeSchema,
  billDecisionSchema,
  billSchema,
  extractionConfirmationSchema,
  paymentRunDecisionSchema,
  paymentRunSchema,
  purchaseRequestSchema,
  reimbursementSchema,
  subscriptionSchema,
  vendorSchema,
} from './validators.js';

async function billResource(ctx: RequestContext, id: string): Promise<Resource | null> {
  const row = await db.maybeOne<{
    id: string;
    organizationId: string;
    createdBy: string;
    approvedBy: string | null;
  }>(
    ctx,
    sql`SELECT id,organization_id AS "organizationId",created_by AS "createdBy",approved_by AS "approvedBy" FROM finance_payable_bill WHERE organization_id=${ctx.organizationId} AND id=${id}`,
  );
  return row ? { type: 'vendorBill', ...row } : null;
}
async function runResource(ctx: RequestContext, id: string): Promise<Resource | null> {
  const row = await db.maybeOne<{
    id: string;
    organizationId: string;
    createdBy: string;
    approvedBy: string | null;
  }>(
    ctx,
    sql`SELECT id,organization_id AS "organizationId",created_by AS "createdBy",approved_by AS "approvedBy" FROM finance_payment_run WHERE organization_id=${ctx.organizationId} AND id=${id}`,
  );
  return row ? { type: 'paymentRun', ...row } : null;
}

export function registerPayablesRoutes(): void {
  route({
    method: 'GET',
    path: '/api/payables/vendors',
    action: 'payables:view',
    module: 'payables',
    handler: async ({ ctx }) => service.listVendors(ctx),
  });
  route({
    method: 'POST',
    path: '/api/payables/vendors',
    action: 'payables:create-bill',
    module: 'payables',
    status: 201,
    handler: async ({ ctx, body }) => service.createVendor(ctx, vendorSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/payables/vendors/:id/bank-changes',
    action: 'payables:create-bill',
    module: 'payables',
    resourceParam: 'id',
    loadResource: async (ctx, id) => ({
      type: 'vendorBill',
      id,
      organizationId: ctx.organizationId,
    }),
    handler: async ({ ctx, params, body }) =>
      service.proposeBankChange(ctx, params['id']!, bankChangeSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/payables/vendor-bank-changes/:id/approve',
    action: 'payables:approve-bill',
    module: 'payables',
    resourceParam: 'id',
    loadResource: async (ctx, id) => ({
      type: 'vendorBill',
      id,
      organizationId: ctx.organizationId,
    }),
    handler: async ({ ctx, params, body }) =>
      service.approveBankChange(ctx, params['id']!, billDecisionSchema.parse(body)),
  });
  route({
    method: 'GET',
    path: '/api/payables/bills',
    action: 'payables:view',
    module: 'payables',
    handler: async ({ ctx }) => service.listBills(ctx),
  });
  route({
    method: 'POST',
    path: '/api/payables/bills',
    action: 'payables:create-bill',
    module: 'payables',
    status: 201,
    handler: async ({ ctx, body }) => service.createBill(ctx, billSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/payables/bills/from-expense',
    action: 'payables:create-bill',
    module: 'payables',
    status: 201,
    handler: async ({ ctx, body }) =>
      service.createExpenseReimbursement(ctx, reimbursementSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/payables/bills/:id/approve',
    action: 'payables:approve-bill',
    module: 'payables',
    resourceParam: 'id',
    loadResource: billResource,
    handler: async ({ ctx, params, body }) =>
      service.approveBill(ctx, params['id']!, billDecisionSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/payables/bills/:id/confirm-extraction',
    action: 'payables:approve-bill',
    module: 'payables',
    resourceParam: 'id',
    loadResource: billResource,
    handler: async ({ ctx, params, body }) =>
      service.confirmBillExtraction(
        ctx,
        params['id']!,
        extractionConfirmationSchema.parse(body).reason,
      ),
  });
  route({
    method: 'GET',
    path: '/api/payables/bills/:id/artifact',
    action: 'payables:view',
    module: 'payables',
    resourceParam: 'id',
    loadResource: billResource,
    handler: async ({ ctx, params, res }) => {
      const file = await service.downloadBillArtifact(ctx, params['id']!);
      res.setHeader('Content-Type', file.mimeType);
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${file.filename.replaceAll('"', '')}"`,
      );
      res.send(file.body);
      return null;
    },
  });
  route({
    method: 'GET',
    path: '/api/payables/subscriptions',
    action: 'payables:view',
    module: 'payables',
    handler: async ({ ctx }) => service.listSubscriptions(ctx),
  });
  route({
    method: 'POST',
    path: '/api/payables/subscriptions',
    action: 'payables:create-bill',
    module: 'payables',
    status: 201,
    handler: async ({ ctx, body }) =>
      service.createSubscription(ctx, subscriptionSchema.parse(body)),
  });
  route({
    method: 'GET',
    path: '/api/payables/purchase-requests',
    action: 'payables:view',
    module: 'payables',
    handler: async ({ ctx }) => service.listPurchaseRequests(ctx),
  });
  route({
    method: 'POST',
    path: '/api/payables/purchase-requests',
    action: 'payables:create-bill',
    module: 'payables',
    status: 201,
    handler: async ({ ctx, body }) =>
      service.createPurchaseRequest(ctx, purchaseRequestSchema.parse(body)),
  });
  route({
    method: 'GET',
    path: '/api/payables/runs',
    action: 'payables:view',
    module: 'payables',
    handler: async ({ ctx }) => service.listRuns(ctx),
  });
  route({
    method: 'POST',
    path: '/api/payables/runs',
    action: 'payables:create-bill',
    module: 'payables',
    status: 201,
    handler: async ({ ctx, body }) =>
      service.createPaymentRun(ctx, paymentRunSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/payables/runs/:id/approve',
    action: 'payables:execute-run',
    module: 'payables',
    resourceParam: 'id',
    loadResource: runResource,
    handler: async ({ ctx, params, body }) =>
      service.approvePaymentRun(ctx, params['id']!, paymentRunDecisionSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/payables/runs/:id/execute',
    action: 'payables:execute-run',
    module: 'payables',
    resourceParam: 'id',
    loadResource: runResource,
    handler: async ({ ctx, params, body }) =>
      service.executePaymentRun(ctx, params['id']!, paymentRunDecisionSchema.parse(body)),
  });
}
