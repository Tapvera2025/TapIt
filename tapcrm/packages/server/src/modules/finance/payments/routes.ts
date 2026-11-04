import { route } from '../../../platform/http/route.js';
import { createLinkSchema, providerConfigSchema } from './validators.js';
import { disconnectProvider, generateLink, getConfigs, saveProvider } from './service.js';
import type { Resource } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import {
  allocateReceipt,
  createSettlement,
  importBankCsv,
  importSettlementCsv,
  listBankLines,
  listExceptions,
  listFxRevaluations,
  listReceipts,
  listSettlements,
  matchBankLine,
  recordFxRate,
  recordReceipt,
  revalueFx,
  resolveException,
  verifyReceipt,
} from './phase4.js';
import {
  allocatePaymentSchema,
  bankImportSchema,
  bankMatchSchema,
  exceptionResolutionSchema,
  fxRateSchema,
  fxRevaluationSchema,
  recordReceiptSchema,
  settlementImportSchema,
  settlementSchema,
  verifyReceiptSchema,
} from './validators.js';

async function receiptResource(
  ctx: RequestContext,
  id: string,
): Promise<Resource | null> {
  const row = await db.maybeOne<{ id: string; organizationId: string }>(
    ctx,
    sql`SELECT id,organization_id AS "organizationId" FROM payment_receipt WHERE organization_id=${ctx.organizationId} AND id=${id}`,
  );
  return row ? { type: 'receipt', ...row } : null;
}
async function bankLineResource(
  ctx: RequestContext,
  id: string,
): Promise<Resource | null> {
  const row = await db.maybeOne<{
    id: string;
    organizationId: string;
    recordedBy: string;
  }>(
    ctx,
    sql`SELECT l.id,l.organization_id AS "organizationId",i.uploaded_by AS "recordedBy" FROM finance_bank_statement_line l JOIN finance_bank_statement_import i ON i.organization_id=l.organization_id AND i.id=l.import_id WHERE l.organization_id=${ctx.organizationId} AND l.id=${id}`,
  );
  return row ? { type: 'bankReconciliation', ...row } : null;
}

export function registerPaymentRoutes(): void {
  route({
    method: 'GET',
    path: '/api/finance/payment-gateways',
    action: 'finance:manage-payment-gateways',
    module: 'accounting',
    handler: async ({ ctx }) => getConfigs(ctx),
  });
  route({
    method: 'POST',
    path: '/api/finance/payment-gateways',
    action: 'finance:manage-payment-gateways',
    module: 'accounting',
    handler: async ({ ctx, body }) => saveProvider(ctx, providerConfigSchema.parse(body)),
  });
  route({
    method: 'DELETE',
    path: '/api/finance/payment-gateways/:id',
    action: 'finance:manage-payment-gateways',
    module: 'accounting',
    handler: async ({ ctx, params, body }) => {
      await disconnectProvider(
        ctx,
        params['id']!,
        typeof (body as { reason?: unknown })?.reason === 'string'
          ? (body as { reason: string }).reason
          : 'Provider disconnected',
      );
      return null;
    },
  });
  route({
    method: 'POST',
    path: '/api/finance/payments/create-link',
    action: 'finance:manage-payment-gateways',
    module: 'accounting',
    handler: async ({ ctx, body }) => generateLink(ctx, createLinkSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/payments/receipts',
    action: 'payments:record',
    module: 'payments',
    status: 201,
    handler: async ({ ctx, body }) => recordReceipt(ctx, recordReceiptSchema.parse(body)),
  });
  route({
    method: 'GET',
    path: '/api/payments/receipts',
    action: 'payments:view',
    module: 'payments',
    handler: async ({ ctx }) => listReceipts(ctx),
  });
  route({
    method: 'POST',
    path: '/api/payments/receipts/:id/verify',
    action: 'payments:record',
    module: 'payments',
    resourceParam: 'id',
    loadResource: receiptResource,
    handler: async ({ ctx, params, body }) =>
      verifyReceipt(ctx, params['id']!, verifyReceiptSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/payments/receipts/:id/allocate',
    action: 'payments:allocate',
    module: 'payments',
    resourceParam: 'id',
    loadResource: receiptResource,
    handler: async ({ ctx, params, body }) =>
      allocateReceipt(ctx, params['id']!, allocatePaymentSchema.parse(body)),
  });
  route({
    method: 'GET',
    path: '/api/payments/bank-lines',
    action: 'payments:view',
    module: 'payments',
    handler: async ({ ctx }) => listBankLines(ctx),
  });
  route({
    method: 'POST',
    path: '/api/payments/bank-imports',
    action: 'payments:record',
    module: 'payments',
    status: 201,
    handler: async ({ ctx, body }) => importBankCsv(ctx, bankImportSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/payments/bank-lines/:id/match',
    action: 'payments:reconcile',
    module: 'payments',
    resourceParam: 'id',
    loadResource: bankLineResource,
    handler: async ({ ctx, params, body }) =>
      matchBankLine(ctx, params['id']!, bankMatchSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/payments/settlements',
    action: 'payments:record',
    module: 'payments',
    status: 201,
    handler: async ({ ctx, body }) => createSettlement(ctx, settlementSchema.parse(body)),
  });
  route({
    method: 'GET',
    path: '/api/payments/settlements',
    action: 'payments:view',
    module: 'payments',
    handler: async ({ ctx }) => listSettlements(ctx),
  });
  route({
    method: 'POST',
    path: '/api/payments/settlement-imports',
    action: 'payments:record',
    module: 'payments',
    status: 201,
    handler: async ({ ctx, body }) =>
      importSettlementCsv(ctx, settlementImportSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/payments/fx-rates',
    action: 'payments:record',
    module: 'payments',
    status: 201,
    handler: async ({ ctx, body }) => recordFxRate(ctx, fxRateSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/payments/fx-revaluations',
    action: 'payments:record',
    module: 'payments',
    handler: async ({ ctx, body }) => revalueFx(ctx, fxRevaluationSchema.parse(body)),
  });
  route({
    method: 'GET',
    path: '/api/payments/fx-revaluations',
    action: 'payments:view',
    module: 'payments',
    handler: async ({ ctx }) => listFxRevaluations(ctx),
  });
  route({
    method: 'GET',
    path: '/api/payments/exceptions',
    action: 'payments:view',
    module: 'payments',
    handler: async ({ ctx }) => listExceptions(ctx),
  });
  route({
    method: 'POST',
    path: '/api/payments/exceptions/:id/resolve',
    action: 'payments:reconcile',
    module: 'payments',
    resourceParam: 'id',
    loadResource: async (ctx, id) => {
      const row = await db.maybeOne<{
        id: string;
        organizationId: string;
        recordedBy: string;
      }>(
        ctx,
        sql`SELECT id,organization_id AS "organizationId",COALESCE(assigned_to,${ctx.principal.id}) AS "recordedBy" FROM finance_payment_exception WHERE organization_id=${ctx.organizationId} AND id=${id}`,
      );
      return row ? { type: 'bankReconciliation', ...row } : null;
    },
    handler: async ({ ctx, params, body }) =>
      resolveException(ctx, params['id']!, exceptionResolutionSchema.parse(body)),
  });
}
