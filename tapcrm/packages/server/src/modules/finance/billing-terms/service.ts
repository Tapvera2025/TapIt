import { db, type Tx } from '../../../platform/dal/db.js';
import type { RequestContext } from '../../../platform/dal/context.js';
import { sql } from '../../../platform/dal/sql.js';
import { BillingTermsNotFoundError, BillingTermsValidationError } from './errors.js';
import * as repo from './repository.js';
import type { ProfileInput, RateCardInput, RateCardVersionInput, ContractInput, ScheduleInput, BillableEventInput, ContractAmendmentInput, ContractUsageInput, ContractDocumentInput } from './validators.js';
import { readContractDocument, storeContractDocument, removeContractDocument } from './file-store.js';

async function audit(ctx: RequestContext, action: string, targetId: string, before: unknown, after: unknown, reason: string, tx: Tx) {
  await tx.query(sql`INSERT INTO audit_outbox (organization_id, stream, payload) VALUES (${ctx.organizationId}, 'finance', ${JSON.stringify({ action, actorId: ctx.principal.id, actorType: ctx.principal.accountType, targetType: 'financeCommercial', targetId, before, after, reason, requestId: ctx.requestId, sourceIp: ctx.sourceIp })}::jsonb)`);
}

export const getProfiles = (ctx: RequestContext) => repo.listProfiles(ctx);
export const getContracts = (ctx: RequestContext) => repo.listContracts(ctx);
export const getRateCards = (ctx: RequestContext) => repo.listRateCards(ctx);
export async function getRateCard(ctx: RequestContext, id: string) { const row = await repo.findRateCard(ctx, id, ctx.principal.accountType === 'super-admin'); if (!row) throw new BillingTermsNotFoundError('Rate card not found.'); return row; }
export const getSchedules = (ctx: RequestContext) => repo.listSchedules(ctx);
export const getBillableEvents = (ctx: RequestContext) => repo.listEvents(ctx);
export const getContractAmendments = async (ctx: RequestContext, contractId: string) => { if (!(await repo.findContract(ctx, contractId))) throw new BillingTermsNotFoundError('Contract not found.'); return repo.listContractAmendments(ctx, contractId); };
export const getContract = async (ctx: RequestContext, contractId: string) => { const row = await repo.findContract(ctx, contractId); if (!row) throw new BillingTermsNotFoundError('Contract not found.'); return row; };
export const getContractUsage = async (ctx: RequestContext, contractId: string) => { await getContract(ctx, contractId); return repo.listContractUsage(ctx, contractId); };
export const getContractDocuments = async (ctx: RequestContext, contractId: string) => { await getContract(ctx, contractId); return repo.listContractDocuments(ctx, contractId); };
function scaled(value: string, scale: number): bigint { const [whole, fraction = ''] = value.split('.'); return BigInt(whole || '0') * (10n ** BigInt(scale)) + BigInt((fraction + '0'.repeat(scale)).slice(0, scale)); }
function decimal(value: bigint, scale: number): string { const base = 10n ** BigInt(scale); const whole = value / base; const fraction = (value % base).toString().padStart(scale, '0').replace(/0+$/, ''); return fraction ? `${whole}.${fraction}` : `${whole}`; }
function multiplyQuantityRate(quantity: string, rate: string): string { const cents = (scaled(quantity, 4) * scaled(rate, 2) + 5000n) / 10000n; return decimal(cents, 2); }

export async function saveProfile(ctx: RequestContext, input: ProfileInput) {
  const id = await db.transaction(ctx, async (tx) => {
    const row = await repo.insertProfile(tx, ctx.organizationId, ctx.principal.id, input);
    await audit(ctx, 'billing.profile.changed', row.id, null, input, input.reason, tx);
    return row.id;
  });
  const row = await repo.findProfile(ctx, input.clientId);
  if (!row || row.id !== id) throw new BillingTermsNotFoundError();
  return row;
}

export async function createRateCard(ctx: RequestContext, input: RateCardInput) {
  const id = await db.transaction(ctx, async (tx) => {
    const row = await repo.insertRateCard(tx, ctx.organizationId, ctx.principal.id, input);
    await audit(ctx, 'billing.rate_card.created', row.id, null, input, input.reason, tx);
    return row.id;
  });
  return { id, name: input.name, status: 'active' };
}

export async function addRateCardVersion(ctx: RequestContext, cardId: string, input: RateCardVersionInput) {
  return db.transaction(ctx, async (tx) => {
    const current = await tx.maybeOne<{ version: number }>(sql`SELECT COALESCE(max(version_number), 0)::int AS version FROM finance_rate_card_version WHERE organization_id = ${ctx.organizationId} AND rate_card_id = ${cardId}`);
    if (!current) throw new BillingTermsNotFoundError('Rate card not found.');
    const version = await repo.insertVersion(tx, ctx.organizationId, ctx.principal.id, cardId, current.version + 1, input);
    await audit(ctx, 'billing.rate_card.versioned', version.id, null, input, input.reason, tx);
    return version;
  });
}

export async function createContract(ctx: RequestContext, input: ContractInput) {
  const result = await db.transaction(ctx, async (tx) => {
    const row = await repo.insertContract(tx, ctx.organizationId, ctx.principal.id, input);
    await audit(ctx, 'billing.contract.created', row.id, null, input, input.reason, tx);
    return row;
  });
  return repo.findContract(ctx, result.id);
}

export async function amendContract(ctx: RequestContext, contractId: string, input: ContractAmendmentInput) {
  const result = await db.transaction(ctx, async (tx) => {
    const current = await tx.maybeOne<{ id:string; version:number; status:string }>(sql`SELECT id, version, status FROM finance_contract WHERE organization_id=${ctx.organizationId} AND id=${contractId} FOR UPDATE`);
    if (!current) throw new BillingTermsNotFoundError('Contract not found.');
    if (current.status === 'cancelled' || current.status === 'expired') throw new BillingTermsValidationError('Cancelled or expired contracts cannot be amended.');
    const amended = await repo.amendContract(tx, ctx.organizationId, contractId, ctx.principal.id, input, current.version + 1);
    await audit(ctx, 'billing.contract.amended', contractId, { version: current.version }, { version: current.version + 1, terms: amended.terms }, input.reason, tx);
    return amended;
  });
  return repo.findContract(ctx, contractId).then((contract) => ({ contract, amendment: result }));
}

export async function changeContractStatus(ctx: RequestContext, contractId: string, status: 'active'|'expired'|'cancelled', reason: string) {
  return db.transaction(ctx, async (tx) => {
    const current = await tx.maybeOne<{ status:string }>(sql`SELECT status FROM finance_contract WHERE organization_id=${ctx.organizationId} AND id=${contractId} FOR UPDATE`);
    if (!current) throw new BillingTermsNotFoundError('Contract not found.');
    if (current.status === status) throw new BillingTermsValidationError(`Contract is already ${status}.`);
    if (current.status === 'cancelled' || current.status === 'expired') throw new BillingTermsValidationError('A terminal contract cannot change status.');
    await repo.updateContractStatus(tx, ctx.organizationId, contractId, status);
    await audit(ctx, 'billing.contract.status_changed', contractId, { status: current.status }, { status }, reason, tx);
    return { id: contractId, status };
  });
}

export async function recordContractUsage(ctx: RequestContext, contractId: string, input: ContractUsageInput) {
  return db.transaction(ctx, async (tx) => {
    const contract = await tx.maybeOne<{ status:string; overageRate:string|null; retainerQuantity:string|null; retainerUnit:string|null }>(sql`SELECT status, overage_rate::text AS "overageRate", retainer_quantity::text AS "retainerQuantity", retainer_unit AS "retainerUnit" FROM finance_contract WHERE organization_id=${ctx.organizationId} AND id=${contractId} FOR SHARE`);
    if (!contract) throw new BillingTermsNotFoundError('Contract not found.');
    if (contract.status === 'cancelled' || contract.status === 'expired') throw new BillingTermsValidationError('Usage cannot be recorded for a terminal contract.');
    if (contract.retainerUnit && contract.retainerUnit !== input.unit) throw new BillingTermsValidationError(`Usage unit must match the contract retainer unit (${contract.retainerUnit}).`);
    const consumed = await tx.one<{ quantity:string }>(sql`SELECT COALESCE(sum(quantity),0)::text AS quantity FROM finance_contract_usage WHERE organization_id=${ctx.organizationId} AND contract_id=${contractId} AND unit=${input.unit}`);
    const requested = scaled(input.quantity, 4); const allowance = contract.retainerQuantity ? scaled(contract.retainerQuantity, 4) : 0n; const alreadyUsed = scaled(consumed.quantity, 4); const remaining = allowance > alreadyUsed ? allowance - alreadyUsed : 0n; const baseQuantity = requested < remaining ? requested : remaining; const overageQuantity = requested - baseQuantity; const overageRate = contract.overageRate ?? input.unitRate; const baseAmount = multiplyQuantityRate(decimal(baseQuantity, 4), input.unitRate); const overageAmount = multiplyQuantityRate(decimal(overageQuantity, 4), overageRate); const amount = (scaled(baseAmount, 2) + scaled(overageAmount, 2)).toString();
    const row = await repo.insertUsage(tx, ctx.organizationId, contractId, ctx.principal.id, input, { amount:decimal(BigInt(amount), 2), retainerQuantity:decimal(baseQuantity, 4), overageQuantity:decimal(overageQuantity, 4), overageRate, isOverage:overageQuantity > 0n });
    await audit(ctx, 'billing.contract.usage_recorded', row.id, null, { ...input, amount:decimal(BigInt(amount), 2), retainerQuantityApplied:decimal(baseQuantity, 4), overageQuantity:decimal(overageQuantity, 4), overageRateApplied:overageRate }, input.reason, tx);
    return row;
  });
}

export async function uploadContractDocument(ctx: RequestContext, contractId: string, input: ContractDocumentInput) {
  await getContract(ctx, contractId);
  const stored = await storeContractDocument(ctx.organizationId, contractId, input.originalFilename, input.mimeType, input.data);
  try {
    const result = await db.transaction(ctx, async (tx) => {
      const row = await repo.insertDocument(tx, ctx.organizationId, contractId, ctx.principal.id, input, stored);
      await audit(ctx, 'billing.contract.document_uploaded', row.id, null, { contractId, filename: input.originalFilename, sha256: stored.sha256 }, input.reason, tx);
      return row;
    });
    return { ...result, ...stored, originalFilename: input.originalFilename, mimeType: stored.mimeType };
  } catch (error) { await removeContractDocument(stored.relativePath); throw error; }
}

export async function downloadContractDocument(ctx: RequestContext, contractId: string, documentId: string) {
  const row = await repo.findContractDocument(ctx, contractId, documentId); if (!row) throw new BillingTermsNotFoundError('Contract document not found.');
  return { row, body: await readContractDocument(row.relativePath) };
}

export async function createSchedule(ctx: RequestContext, input: ScheduleInput) {
  return db.transaction(ctx, async (tx) => {
    const contract = await tx.maybeOne<{ id:string; status:string }>(sql`SELECT id, status FROM finance_contract WHERE organization_id=${ctx.organizationId} AND id=${input.contractId} FOR SHARE`);
    if (!contract) throw new BillingTermsNotFoundError('Contract not found.');
    if (contract.status === 'cancelled' || contract.status === 'expired') throw new BillingTermsValidationError('Schedules cannot be created for terminal contracts.');
    const row = await repo.insertSchedule(tx, ctx.organizationId, ctx.principal.id, input);
    await audit(ctx, 'billing.schedule.created', row.id, null, input, input.reason, tx);
    return row;
  });
}

export async function createBillableEvent(ctx: RequestContext, input: BillableEventInput) {
  return db.transaction(ctx, async (tx) => {
    if (input.contractId) {
      const contract = await tx.maybeOne<{ clientId:string; status:string }>(sql`SELECT client_id AS "clientId", status FROM finance_contract WHERE organization_id=${ctx.organizationId} AND id=${input.contractId} FOR SHARE`);
      if (!contract) throw new BillingTermsNotFoundError('Contract not found.');
      if (contract.clientId !== input.clientId) throw new BillingTermsValidationError('The contract does not belong to the selected client.');
      if (contract.status === 'cancelled' || contract.status === 'expired') throw new BillingTermsValidationError('Billable events cannot be created for terminal contracts.');
    }
    const row = await repo.insertEvent(tx, ctx.organizationId, ctx.principal.id, input);
    await audit(ctx, 'billing.billable_event.created', row.id, null, input, input.reason, tx);
    return row;
  });
}

export async function decideBillableEvent(ctx: RequestContext, id: string, decision: 'approved' | 'rejected', reason: string) {
  if (reason.trim().length < 3) throw new BillingTermsValidationError('A reason is required.');
  await db.transaction(ctx, async (tx) => {
    const row = await tx.maybeOne<{ id: string }>(sql`SELECT id FROM finance_billable_event WHERE organization_id = ${ctx.organizationId} AND id = ${id}`);
    if (!row) throw new BillingTermsNotFoundError('Billable event not found.');
    await repo.decideEvent(tx, ctx.organizationId, id, decision, ctx.principal.id);
    await audit(ctx, 'billing.billable_event.decided', id, null, { decision }, reason, tx);
  });
  return { id, state: decision };
}
