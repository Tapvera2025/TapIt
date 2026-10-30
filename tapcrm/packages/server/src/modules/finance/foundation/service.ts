import { globalAccess } from '@tapcrm/contracts';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { FinanceFoundationValidationError, FinanceFoundationVersionConflictError } from './errors.js';
import { ensureFoundation, findFoundation, lockFoundation, updateFoundation } from './repository.js';
import type { UpdateFinanceFoundationInput } from './validators.js';

export async function getFinanceFoundation(ctx: RequestContext) {
  const foundation = await findFoundation(ctx);
  if (foundation) return foundation;
  await db.transaction(ctx, (tx) => ensureFoundation(tx, ctx));
  const created = await findFoundation(ctx);
  if (!created) throw new FinanceFoundationValidationError('Finance foundation could not be initialized.');
  return created;
}

export async function updateFinanceFoundation(ctx: RequestContext, input: UpdateFinanceFoundationInput) {
  if (!input.supportedCurrencies.includes(input.functionalCurrency)) {
    throw new FinanceFoundationValidationError('Functional currency must be included in supported currencies.');
  }
  if (!globalAccess(ctx.principal) && input.status === 'active') {
    throw new FinanceFoundationValidationError('Only Super Admin can activate finance configuration.');
  }
  await db.transaction(ctx, async (tx) => {
    await ensureFoundation(tx, ctx);
    const current = await lockFoundation(tx, ctx.organizationId);
    if (!current) throw new FinanceFoundationValidationError('Finance foundation could not be initialized.');
    if (current.version !== input.expectedVersion) throw new FinanceFoundationVersionConflictError();
    const before = { legalName: current.legalName, countryCode: current.countryCode, functionalCurrency: current.functionalCurrency, supportedCurrencies: current.supportedCurrencies, timezone: current.timezone, fiscalYearStartMonth: current.fiscalYearStartMonth, status: current.status, taxPolicyStatus: current.taxPolicyStatus, statutorySourceStatus: current.statutorySourceStatus, revenuePolicyStatus: current.revenuePolicyStatus, paymentProviderStatus: current.paymentProviderStatus };
    await updateFoundation(tx, ctx, input);
    const after = { legalName: input.legalName, countryCode: input.countryCode, functionalCurrency: input.functionalCurrency, supportedCurrencies: input.supportedCurrencies, timezone: input.timezone, fiscalYearStartMonth: input.fiscalYearStartMonth, status: input.status, taxPolicyStatus: input.taxPolicyStatus, statutorySourceStatus: input.statutorySourceStatus, revenuePolicyStatus: input.revenuePolicyStatus, paymentProviderStatus: input.paymentProviderStatus };
    await tx.query(sql`
      INSERT INTO audit_outbox (organization_id, stream, payload)
      VALUES (${ctx.organizationId}, 'finance', ${JSON.stringify({ action: 'finance.foundation.updated', actorId: ctx.principal.id, actorType: ctx.principal.accountType, targetType: 'financeFoundation', targetId: ctx.organizationId, before, after, reason: input.reason, requestId: ctx.requestId, sourceIp: ctx.sourceIp })}::jsonb)
    `);
  });
  return getFinanceFoundation(ctx);
}
