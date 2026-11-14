import type { RequestContext } from '../../../../platform/dal/context.js';
import { randomUUID } from 'node:crypto';
import type { Resource } from '@tapcrm/authz';
import { db, type Tx } from '../../../../platform/dal/db.js';
import { sql } from '../../../../platform/dal/sql.js';
import { postJournalTx } from '../ledger.js';
import { AccountingCompletionError } from './errors.js';
import {
  paginate,
  type PaginatedResult,
  type PaginationInput,
} from '../../pagination.js';
import type {
  EntityInput,
  RecognizeInput,
  RevaluationInput,
  ScheduleInput,
  SyncInput,
  SyncSourceQuery,
} from './validators.js';

export async function loadScheduleResource(
  ctx: RequestContext,
  id: string,
): Promise<Resource | null> {
  const row = await db.maybeOne<{ id: string; organizationId: string }>(
    ctx,
    sql`SELECT id,organization_id AS "organizationId" FROM finance_accounting_schedule WHERE organization_id=${ctx.organizationId} AND id=${id}`,
  );
  return row
    ? { type: 'accountingSchedule', id: row.id, organizationId: row.organizationId }
    : null;
}

function audit(
  ctx: RequestContext,
  tx: Tx,
  action: string,
  targetId: string,
  reason: string,
  after: unknown,
) {
  return tx.query(
    sql`INSERT INTO audit_outbox (organization_id, stream, payload) VALUES (${ctx.organizationId}, 'activity', ${JSON.stringify({ action, actorId: ctx.principal.id, actorType: ctx.principal.accountType, targetType: 'accounting-completion', targetId, reason, after, requestId: ctx.requestId, sourceIp: ctx.sourceIp })}::jsonb)`,
  );
}

export const listEntities = (ctx: RequestContext) =>
  db.query(
    ctx,
    sql`SELECT id,code,legal_name AS "legalName",functional_currency AS "baseCurrency",timezone,tax_registration AS "taxRegistration",(status='active') AS "isActive",created_at AS "createdAt" FROM finance_legal_entity WHERE organization_id=${ctx.organizationId} ORDER BY code`,
  );

export async function createEntity(ctx: RequestContext, input: EntityInput) {
  return db.transaction(ctx, async (tx) => {
    const row = await tx.one<{ id: string }>(
      sql`INSERT INTO finance_legal_entity (organization_id,code,legal_name,country_code,functional_currency,timezone,status,tax_registration,created_by) VALUES (${ctx.organizationId},${input.code},${input.legalName},${input.countryCode},${input.baseCurrency},${input.timezone},'active',${JSON.stringify(input.taxRegistration)}::jsonb,${ctx.principal.id}) RETURNING id`,
    );
    await audit(ctx, tx, 'accounting.legal_entity.created', row.id, input.reason, input);
    return row;
  });
}

export const listSchedules = (ctx: RequestContext) =>
  db.query(
    ctx,
    sql`SELECT id,legal_entity_id AS "legalEntityId",schedule_type AS "scheduleType",description,source_type AS "sourceType",source_id AS "sourceId",debit_account_id AS "debitAccountId",credit_account_id AS "creditAccountId",total_amount::text AS "totalAmount",recognized_amount::text AS "recognizedAmount",currency,start_date::text AS "startDate",end_date::text AS "endDate",next_recognition_date::text AS "nextRecognitionDate",status,created_at AS "createdAt" FROM finance_accounting_schedule WHERE organization_id=${ctx.organizationId} ORDER BY next_recognition_date`,
  );

export const listRevaluations = (ctx: RequestContext) =>
  db.query(
    ctx,
    sql`SELECT id,legal_entity_id AS "legalEntityId",as_of_date::text AS "asOfDate",base_currency AS "baseCurrency",status,rates,journal_id AS "journalId",created_at AS "createdAt" FROM finance_fx_revaluation_run WHERE organization_id=${ctx.organizationId} ORDER BY created_at DESC LIMIT 100`,
  );

export async function listSyncSources(ctx: RequestContext, query: SyncSourceQuery) {
  if (query.sourceType === 'journal') {
    return db.query(
      ctx,
      sql`SELECT je.id, 'journal' AS "sourceType", concat(je.entry_date::text, ' · ', je.description) AS label, jsonb_build_object('journalId', je.id, 'entryDate', je.entry_date::text, 'description', je.description, 'sourceType', je.source_type) AS payload FROM journal_entry je WHERE je.organization_id=${ctx.organizationId} ORDER BY je.entry_date DESC, je.id DESC LIMIT 100`,
    );
  }
  return db.query(
    ctx,
    sql`SELECT id, 'accounting-schedule' AS "sourceType", concat(description, ' · ', schedule_type, ' · ', total_amount::text, ' ', currency) AS label, jsonb_build_object('scheduleId', id, 'description', description, 'scheduleType', schedule_type, 'totalAmount', total_amount::text, 'currency', currency) AS payload FROM finance_accounting_schedule WHERE organization_id=${ctx.organizationId} ORDER BY created_at DESC LIMIT 100`,
  );
}

export async function createSchedule(ctx: RequestContext, input: ScheduleInput) {
  if (
    input.endDate < input.startDate ||
    input.nextRecognitionDate < input.startDate ||
    input.nextRecognitionDate > input.endDate
  )
    throw new AccountingCompletionError('Schedule dates are invalid.');
  if (input.debitAccountId === input.creditAccountId)
    throw new AccountingCompletionError('Debit and credit accounts must be different.');
  return db.transaction(ctx, async (tx) => {
    const row = await tx.one<{ id: string }>(
      sql`INSERT INTO finance_accounting_schedule (organization_id,legal_entity_id,schedule_type,description,source_type,source_id,debit_account_id,credit_account_id,total_amount,currency,start_date,end_date,next_recognition_date,created_by) VALUES (${ctx.organizationId},${input.legalEntityId ?? null},${input.scheduleType},${input.description},${input.sourceType},${input.sourceId ?? null},${input.debitAccountId},${input.creditAccountId},${input.totalAmount},${input.currency},${input.startDate},${input.endDate},${input.nextRecognitionDate},${ctx.principal.id}) RETURNING id`,
    );
    await audit(ctx, tx, 'accounting.schedule.created', row.id, input.reason, input);
    return row;
  });
}

function minor(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
}
function money(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const abs = value < 0n ? -value : value;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

export async function recognizeSchedule(
  ctx: RequestContext,
  id: string,
  input: RecognizeInput,
) {
  return db.transaction(ctx, async (tx) => {
    const schedule = await tx.maybeOne<{
      id: string;
      debitAccountId: string;
      creditAccountId: string;
      totalAmount: string;
      recognizedAmount: string;
      currency: string;
      status: string;
      startDate: string;
      endDate: string;
      nextRecognitionDate: string;
    }>(
      sql`SELECT id,debit_account_id AS "debitAccountId",credit_account_id AS "creditAccountId",total_amount::text AS "totalAmount",recognized_amount::text AS "recognizedAmount",currency,status,start_date::text AS "startDate",end_date::text AS "endDate",next_recognition_date::text AS "nextRecognitionDate" FROM finance_accounting_schedule WHERE organization_id=${ctx.organizationId} AND id=${id} FOR UPDATE`,
    );
    if (!schedule)
      throw new AccountingCompletionError('Accounting schedule not found.', 404);
    if (schedule.status !== 'active')
      throw new AccountingCompletionError('Only active schedules can be recognized.');
    if (input.entryDate < schedule.startDate || input.entryDate > schedule.endDate)
      throw new AccountingCompletionError(
        'Recognition date must be within the schedule dates.',
      );
    if (input.entryDate < schedule.nextRecognitionDate)
      throw new AccountingCompletionError(
        'Recognition date cannot be before the next recognition date.',
      );
    const remaining = minor(schedule.totalAmount) - minor(schedule.recognizedAmount);
    const amount = minor(input.amount);
    if (amount <= 0n || amount > remaining)
      throw new AccountingCompletionError(
        'Recognition amount exceeds the remaining schedule balance.',
      );
    const journal = await postJournalTx(tx, {
      organizationId: ctx.organizationId,
      postedBy: ctx.principal.id,
      journal: {
        entryDate: input.entryDate,
        description: 'Accounting schedule recognition',
        sourceType: 'accounting-schedule-recognition',
        sourceId: randomUUID(),
        reason: input.reason,
        transactionCurrency: schedule.currency,
        baseCurrency: schedule.currency,
        exchangeRate: '1',
        lines: [
          {
            accountId: schedule.debitAccountId,
            debit: money(amount) as never,
            credit: '0' as never,
            dimensions: { scheduleId: id },
          },
          {
            accountId: schedule.creditAccountId,
            debit: '0' as never,
            credit: money(amount) as never,
            dimensions: { scheduleId: id },
          },
        ],
      },
    });
    const recognized = minor(schedule.recognizedAmount) + amount;
    await tx.query(
      sql`UPDATE finance_accounting_schedule SET recognized_amount=${money(recognized)},status=${recognized >= minor(schedule.totalAmount) ? 'completed' : 'active'},next_recognition_date=${input.entryDate},updated_at=now() WHERE organization_id=${ctx.organizationId} AND id=${id}`,
    );
    await audit(ctx, tx, 'accounting.schedule.recognized', id, input.reason, {
      amount: input.amount,
      journalId: journal.id,
    });
    return { id, journalId: journal.id, recognizedAmount: money(recognized) };
  });
}

export async function createRevaluation(ctx: RequestContext, input: RevaluationInput) {
  return db.transaction(ctx, async (tx) => {
    const existing = await tx.maybeOne<{ id: string; journalId: string | null }>(
      sql`SELECT id,journal_id AS "journalId" FROM finance_fx_revaluation_run WHERE organization_id=${ctx.organizationId} AND idempotency_key=${input.idempotencyKey}`,
    );
    if (existing)
      return { id: existing.id, journalId: existing.journalId, idempotent: true };
    const journalLines: Array<{
      accountId: string;
      debit: never;
      credit: never;
      dimensions: Record<string, string>;
    }> = [];
    for (const line of input.lines) {
      if (line.currency === input.baseCurrency)
        throw new AccountingCompletionError(
          'The revalued currency must differ from the base currency.',
        );
      if (
        minor(line.foreignAmount) <= 0n ||
        minor(line.oldBaseAmount) < 0n ||
        minor(line.newBaseAmount) < 0n ||
        Number(line.rate) <= 0
      )
        throw new AccountingCompletionError(
          'Foreign amount, base amounts, and exchange rate must be valid positive values.',
        );
      if (line.accountId === input.gainLossAccountId)
        throw new AccountingCompletionError(
          'The FX gain/loss account must differ from the account being revalued.',
        );
      const delta = minor(line.newBaseAmount) - minor(line.oldBaseAmount);
      if (delta === 0n) continue;
      if (delta > 0n)
        journalLines.push({
          accountId: line.accountId,
          debit: money(delta) as never,
          credit: '0' as never,
          dimensions: { fxCurrency: line.currency, fxRate: line.rate },
        });
      else
        journalLines.push({
          accountId: line.accountId,
          debit: '0' as never,
          credit: money(-delta) as never,
          dimensions: { fxCurrency: line.currency, fxRate: line.rate },
        });
    }
    if (!journalLines.length)
      throw new AccountingCompletionError('Revaluation has no currency variance.');
    const gainLoss = journalLines.reduce(
      (sum, line) => sum + minor(String(line.debit)) - minor(String(line.credit)),
      0n,
    );
    if (gainLoss !== 0n)
      journalLines.push(
        gainLoss > 0n
          ? {
              accountId: input.gainLossAccountId,
              debit: '0' as never,
              credit: money(gainLoss) as never,
              dimensions: { fxRevaluation: 'gain' },
            }
          : {
              accountId: input.gainLossAccountId,
              debit: money(-gainLoss) as never,
              credit: '0' as never,
              dimensions: { fxRevaluation: 'loss' },
            },
      );
    const journal = await postJournalTx(tx, {
      organizationId: ctx.organizationId,
      postedBy: ctx.principal.id,
      journal: {
        entryDate: input.asOfDate,
        description: 'FX revaluation',
        sourceType: 'fx-revaluation',
        reason: input.reason,
        legalEntityId: input.legalEntityId ?? null,
        transactionCurrency: input.baseCurrency,
        baseCurrency: input.baseCurrency,
        exchangeRate: '1',
        lines: journalLines,
      },
    });
    const row = await tx.one<{ id: string }>(
      sql`INSERT INTO finance_fx_revaluation_run (organization_id,legal_entity_id,as_of_date,base_currency,status,rates,idempotency_key,journal_id,created_by) VALUES (${ctx.organizationId},${input.legalEntityId ?? null},${input.asOfDate},${input.baseCurrency},'posted',${JSON.stringify(input.lines)}::jsonb,${input.idempotencyKey},${journal.id},${ctx.principal.id}) RETURNING id`,
    );
    await audit(ctx, tx, 'accounting.fx.revaluation.posted', row.id, input.reason, {
      journalId: journal.id,
    });
    return { id: row.id, journalId: journal.id };
  });
}

export async function enqueueSync(ctx: RequestContext, input: SyncInput) {
  return db.transaction(ctx, async (tx) => {
    let payload = input.payload;
    if (input.sourceType === 'journal') {
      const source = await tx.maybeOne<{
        id: string;
        entryDate: string;
        description: string;
        sourceType: string;
      }>(
        sql`SELECT id,entry_date::text AS "entryDate",description,source_type AS "sourceType" FROM journal_entry WHERE organization_id=${ctx.organizationId} AND id=${input.sourceId}`,
      );
      if (!source)
        throw new AccountingCompletionError('The selected journal was not found.', 404);
      payload = {
        journalId: source.id,
        entryDate: source.entryDate,
        description: source.description,
        sourceType: source.sourceType,
      };
    } else if (input.sourceType === 'accounting-schedule') {
      const source = await tx.maybeOne<{
        id: string;
        description: string;
        scheduleType: string;
        totalAmount: string;
        currency: string;
      }>(
        sql`SELECT id,description,schedule_type AS "scheduleType",total_amount::text AS "totalAmount",currency FROM finance_accounting_schedule WHERE organization_id=${ctx.organizationId} AND id=${input.sourceId}`,
      );
      if (!source)
        throw new AccountingCompletionError(
          'The selected accounting schedule was not found.',
          404,
        );
      payload = {
        scheduleId: source.id,
        description: source.description,
        scheduleType: source.scheduleType,
        totalAmount: source.totalAmount,
        currency: source.currency,
      };
    }
    if (!payload)
      throw new AccountingCompletionError(
        'A canonical payload is required for this synchronization source.',
      );
    const inserted = await tx.maybeOne<{ id: string; status: string }>(
      sql`INSERT INTO finance_accounting_sync_queue (organization_id,provider,entity_id,source_type,source_id,idempotency_key,payload,created_by) VALUES (${ctx.organizationId},${input.provider},${input.entityId ?? null},${input.sourceType},${input.sourceId},${input.idempotencyKey},${JSON.stringify(payload)}::jsonb,${ctx.principal.id}) ON CONFLICT (organization_id,provider,idempotency_key) DO NOTHING RETURNING id,status`,
    );
    if (inserted) {
      await audit(ctx, tx, 'accounting.external-sync.queued', inserted.id, input.reason, {
        provider: input.provider,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      });
      return inserted;
    }
    const existing = await tx.one<{ id: string; status: string }>(
      sql`SELECT id,status FROM finance_accounting_sync_queue WHERE organization_id=${ctx.organizationId} AND provider=${input.provider} AND idempotency_key=${input.idempotencyKey}`,
    );
    return { ...existing, idempotent: true };
  });
}

export const listSyncQueue = (ctx: RequestContext) =>
  db.query(
    ctx,
    sql`SELECT id,provider,entity_id AS "entityId",source_type AS "sourceType",source_id AS "sourceId",idempotency_key AS "idempotencyKey",status,attempts,last_error AS "lastError",created_at AS "createdAt",updated_at AS "updatedAt" FROM finance_accounting_sync_queue WHERE organization_id=${ctx.organizationId} ORDER BY created_at DESC LIMIT 100`,
  );

export const listSchedulesPage = (
  ctx: RequestContext,
  page: PaginationInput,
): Promise<PaginatedResult<unknown>> =>
  paginate(
    ctx,
    sql`SELECT id,legal_entity_id AS "legalEntityId",schedule_type AS "scheduleType",description,source_type AS "sourceType",source_id AS "sourceId",debit_account_id AS "debitAccountId",credit_account_id AS "creditAccountId",total_amount::text AS "totalAmount",recognized_amount::text AS "recognizedAmount",currency,start_date::text AS "startDate",end_date::text AS "endDate",next_recognition_date::text AS "nextRecognitionDate",status,created_at AS "createdAt" FROM finance_accounting_schedule WHERE organization_id=${ctx.organizationId} ORDER BY next_recognition_date LIMIT ${page.pageSize} OFFSET ${page.offset}`,
    sql`SELECT count(*)::text AS total FROM finance_accounting_schedule WHERE organization_id=${ctx.organizationId}`,
    page,
  );

export const listRevaluationsPage = (
  ctx: RequestContext,
  page: PaginationInput,
): Promise<PaginatedResult<unknown>> =>
  paginate(
    ctx,
    sql`SELECT id,legal_entity_id AS "legalEntityId",as_of_date::text AS "asOfDate",base_currency AS "baseCurrency",status,rates,journal_id AS "journalId",created_at AS "createdAt" FROM finance_fx_revaluation_run WHERE organization_id=${ctx.organizationId} ORDER BY created_at DESC LIMIT ${page.pageSize} OFFSET ${page.offset}`,
    sql`SELECT count(*)::text AS total FROM finance_fx_revaluation_run WHERE organization_id=${ctx.organizationId}`,
    page,
  );

export const listSyncQueuePage = (
  ctx: RequestContext,
  page: PaginationInput,
): Promise<PaginatedResult<unknown>> =>
  paginate(
    ctx,
    sql`SELECT id,provider,entity_id AS "entityId",source_type AS "sourceType",source_id AS "sourceId",idempotency_key AS "idempotencyKey",status,attempts,last_error AS "lastError",created_at AS "createdAt",updated_at AS "updatedAt" FROM finance_accounting_sync_queue WHERE organization_id=${ctx.organizationId} ORDER BY created_at DESC LIMIT ${page.pageSize} OFFSET ${page.offset}`,
    sql`SELECT count(*)::text AS total FROM finance_accounting_sync_queue WHERE organization_id=${ctx.organizationId}`,
    page,
  );

export const getCompletionOverview = async (ctx: RequestContext) => ({
  entities: await listEntities(ctx),
  schedules: await listSchedules(ctx),
  revaluations: await listRevaluations(ctx),
  syncQueue: await listSyncQueue(ctx),
  advisory: true,
  storage: 'backend-filesystem',
});
