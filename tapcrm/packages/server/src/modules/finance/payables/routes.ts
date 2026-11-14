import type { Resource } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { route } from '../../../platform/http/route.js';
import { parsePagination } from '../pagination.js';
import * as service from './service.js';
import {
  bankChangeSchema,
  billDecisionSchema,
  billSchema,
  purchaseRequestDecisionSchema,
  purchaseRequestMatchSchema,
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
async function bankChangeResource(
  ctx: RequestContext,
  id: string,
): Promise<Resource | null> {
  const row = await db.maybeOne<{
    id: string;
    organizationId: string;
    proposedBy: string;
    approvedBy: string | null;
  }>(
    ctx,
    sql`SELECT id,organization_id AS "organizationId",proposed_by AS "proposedBy",approved_by AS "approvedBy" FROM finance_vendor_bank_account WHERE organization_id=${ctx.organizationId} AND id=${id}`,
  );
  return row ? { type: 'vendorBankChange', ...row } : null;
}
async function purchaseRequestResource(
  ctx: RequestContext,
  id: string,
): Promise<Resource | null> {
  const row = await db.maybeOne<{
    id: string;
    organizationId: string;
    createdBy: string;
    requesterId: string;
    approvedBy: string | null;
  }>(
    ctx,
    sql`SELECT id,organization_id AS "organizationId",requester_id AS "createdBy",requester_id AS "requesterId",approved_by AS "approvedBy" FROM finance_purchase_request WHERE organization_id=${ctx.organizationId} AND id=${id}`,
  );
  return row ? { type: 'purchaseRequest', ...row } : null;
}

export function registerPayablesRoutes(): void {
  route({
    method: 'GET',
    path: '/api/payables/vendors',
    action: 'payables:view',
    module: 'payables',
    handler: async ({ ctx, query }) => service.listVendors(ctx, parsePagination(query)),
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
    action: 'payables:create-vendor-bank-change',
    module: 'payables',
    resourceParam: 'id',
    loadResource: async (ctx, id) => {
      const row = await db.maybeOne<{ id: string; organizationId: string }>(
        ctx,
        sql`SELECT id,organization_id AS "organizationId" FROM finance_vendor WHERE organization_id=${ctx.organizationId} AND id=${id}`,
      );
      return row ? { type: 'vendor', ...row } : null;
    },
    handler: async ({ ctx, params, body }) =>
      service.proposeBankChange(ctx, params['id']!, bankChangeSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/payables/vendor-bank-changes/:id/approve',
    action: 'payables:approve-vendor-bank-change',
    module: 'payables',
    resourceParam: 'id',
    loadResource: bankChangeResource,
    handler: async ({ ctx, params, body }) =>
      service.approveBankChange(ctx, params['id']!, billDecisionSchema.parse(body)),
  });
  route({
    method: 'GET',
    path: '/api/payables/vendor-bank-changes',
    action: 'payables:view',
    module: 'payables',
    handler: async ({ ctx, query }) =>
      service.listBankChanges(ctx, parsePagination(query)),
  });
  route({
    method: 'GET',
    path: '/api/payables/bills',
    action: 'payables:view',
    module: 'payables',
    handler: async ({ ctx, query }) => service.listBills(ctx, parsePagination(query)),
  });
  route({
    method: 'GET',
    path: '/api/payables/reimbursement-claims',
    action: 'payables:create-bill',
    module: 'payables',
    handler: async ({ ctx }) => service.listReimbursementClaims(ctx),
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
    action: 'payables:create-bill',
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
    handler: async ({ ctx, query }) =>
      service.listSubscriptions(ctx, parsePagination(query)),
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
    handler: async ({ ctx, query }) =>
      service.listPurchaseRequests(ctx, parsePagination(query)),
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
    method: 'POST',
    path: '/api/payables/purchase-requests/:id/approve',
    action: 'payables:approve-purchase-request',
    module: 'payables',
    resourceParam: 'id',
    loadResource: purchaseRequestResource,
    handler: async ({ ctx, params, body }) =>
      service.approvePurchaseRequest(
        ctx,
        params['id']!,
        purchaseRequestDecisionSchema.parse(body),
      ),
  });
  route({
    method: 'POST',
    path: '/api/payables/purchase-requests/:id/match-bill',
    action: 'payables:match-purchase-request',
    module: 'payables',
    resourceParam: 'id',
    loadResource: purchaseRequestResource,
    handler: async ({ ctx, params, body }) =>
      service.matchPurchaseRequest(
        ctx,
        params['id']!,
        purchaseRequestMatchSchema.parse(body),
      ),
  });
  route({
    method: 'GET',
    path: '/api/payables/runs',
    action: 'payables:view',
    module: 'payables',
    handler: async ({ ctx, query }) => service.listRuns(ctx, parsePagination(query)),
  });
  route({
    method: 'GET',
    path: '/api/payables/runs/candidates',
    action: 'payables:view',
    module: 'payables',
    handler: async ({ ctx }) => service.listPaymentRunCandidates(ctx),
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
