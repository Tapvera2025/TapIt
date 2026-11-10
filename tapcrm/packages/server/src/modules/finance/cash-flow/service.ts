import { createHash } from 'node:crypto';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { CashFlowError } from './errors.js';
import type { ForecastInput, ScenarioInput } from './validators.js';

function cents(value: string | number): bigint {
  const text = String(value);
  const [whole = '0', fraction = ''] = text.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
}
function money(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}
function datePlus(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function auditPayload(
  ctx: RequestContext,
  action: string,
  targetId: string,
  reason: string,
  after: unknown,
) {
  return {
    action,
    actorId: ctx.principal.id,
    actorType: ctx.principal.accountType,
    targetType: 'cash-flow',
    targetId,
    reason,
    after,
    requestId: ctx.requestId,
    sourceIp: ctx.sourceIp,
  };
}
async function audit(
  ctx: RequestContext,
  tx: Tx,
  action: string,
  targetId: string,
  reason: string,
  after: unknown,
) {
  await tx.query(
    sql`INSERT INTO audit_outbox (organization_id,stream,payload) VALUES (${ctx.organizationId},'activity',${JSON.stringify(auditPayload(ctx, action, targetId, reason, after))}::jsonb)`,
  );
}

export const listSnapshots = (ctx: RequestContext) =>
  db.query(
    ctx,
    sql`SELECT id,as_of_date AS "asOfDate",horizon_weeks AS "horizonWeeks",base_currency AS "baseCurrency",minimum_cash AS "minimumCash",source_hash AS "sourceHash",created_at AS "createdAt" FROM finance_cash_flow_snapshot WHERE organization_id=${ctx.organizationId} ORDER BY created_at DESC LIMIT 30`,
  );
export const listForecast = (ctx: RequestContext, snapshotId: string) =>
  db.query(
    ctx,
    sql`SELECT id,snapshot_id AS "snapshotId",bucket_number AS "bucketNumber",bucket_start AS "bucketStart",bucket_end AS "bucketEnd",opening_cash AS "openingCash",contracted_cash AS "contractedCash",issued_cash AS "issuedCash",expected_collections AS "expectedCollections",other_inflows AS "otherInflows",payable_outflows AS "payableOutflows",recurring_outflows AS "recurringOutflows",other_outflows AS "otherOutflows",closing_cash AS "closingCash",minimum_cash AS "minimumCash",variance_to_minimum AS "varianceToMinimum",evidence FROM finance_cash_flow_forecast WHERE organization_id=${ctx.organizationId} AND snapshot_id=${snapshotId} ORDER BY bucket_number`,
  );
export const listScenarios = (ctx: RequestContext) =>
  db.query(
    ctx,
    sql`SELECT id,name,base_snapshot_id AS "baseSnapshotId",base_currency AS "baseCurrency",assumptions,status,created_by AS "createdBy",created_at AS "createdAt",updated_at AS "updatedAt" FROM finance_cash_flow_scenario WHERE organization_id=${ctx.organizationId} ORDER BY created_at DESC LIMIT 50`,
  );
export async function listScenarioForecast(ctx: RequestContext, scenarioId: string) {
  const scenario = await db.maybeOne<{
    assumptions: {
      adjustments?: Array<{
        bucketNumber: number;
        inflowDelta: string;
        outflowDelta: string;
        note: string;
      }>;
    };
    snapshotId: string;
  }>(
    ctx,
    sql`SELECT assumptions,base_snapshot_id AS "snapshotId" FROM finance_cash_flow_scenario WHERE organization_id=${ctx.organizationId} AND id=${scenarioId}`,
  );
  if (!scenario) throw new CashFlowError('Cash-flow scenario not found.', 404);
  const rows = (await listForecast(ctx, scenario.snapshotId)) as Array<{
    id: string;
    bucketNumber: number;
    bucketStart: string;
    bucketEnd: string;
    openingCash: string;
    closingCash: string;
    minimumCash: string;
    contractedCash: string;
    issuedCash: string;
    expectedCollections: string;
    payableOutflows: string;
    recurringOutflows: string;
  }>;
  const adjustments = new Map(
    (scenario.assumptions.adjustments ?? []).map((item) => [item.bucketNumber, item]),
  );
  let cumulativeInflow = 0n;
  let cumulativeOutflow = 0n;
  return rows.map((row) => {
    const adjustment = adjustments.get(row.bucketNumber);
    const inflowDelta = adjustment ? cents(adjustment.inflowDelta) : 0n;
    const outflowDelta = adjustment ? cents(adjustment.outflowDelta) : 0n;
    cumulativeInflow += inflowDelta;
    cumulativeOutflow += outflowDelta;
    const closingCash = cents(row.closingCash) + cumulativeInflow - cumulativeOutflow;
    return {
      ...row,
      scenarioInflowDelta: money(inflowDelta),
      scenarioOutflowDelta: money(outflowDelta),
      scenarioClosingCash: money(closingCash),
      scenarioVarianceToMinimum: money(closingCash - cents(row.minimumCash)),
      note: adjustment?.note ?? null,
    };
  });
}

export async function getCommandCentre(ctx: RequestContext, baseCurrency: string) {
  const [
    cash,
    receivables,
    payables,
    unreconciled,
    budget,
    contracted,
    issued,
    collected,
    actual,
  ] = await Promise.all([
    db.maybeOne<{ amount: string }>(
      ctx,
      sql`SELECT COALESCE(SUM(CASE WHEN le.system_key IN ('bank','gateway-clearing') THEN jl.debit-jl.credit ELSE 0 END),0)::text AS amount FROM journal_line jl JOIN journal_entry je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id JOIN ledger_account le ON le.organization_id=jl.organization_id AND le.id=jl.ledger_account_id WHERE jl.organization_id=${ctx.organizationId}`,
    ),
    db.maybeOne<{ amount: string }>(
      ctx,
      sql`SELECT COALESCE(SUM(GREATEST(round(i.total*100)::bigint-COALESCE((SELECT SUM(pa.amount_minor) FROM payment_allocation pa WHERE pa.organization_id=i.organization_id AND pa.invoice_id=i.id),0),0)),0)::text AS amount FROM finance_invoice i WHERE i.organization_id=${ctx.organizationId} AND i.status='issued' AND i.receivable_status NOT IN ('paid','written_off') AND i.currency=${baseCurrency}`,
    ),
    db.maybeOne<{ amount: string }>(
      ctx,
      sql`SELECT COALESCE(SUM(total),0)::text AS amount FROM finance_payable_bill WHERE organization_id=${ctx.organizationId} AND status IN ('approved','partially_paid') AND currency=${baseCurrency}`,
    ),
    db.maybeOne<{ count: string }>(
      ctx,
      sql`SELECT COUNT(*)::text AS count FROM finance_bank_statement_line WHERE organization_id=${ctx.organizationId} AND matched_receipt_id IS NULL`,
    ),
    db.maybeOne<{ amount: string }>(
      ctx,
      sql`SELECT COALESCE(SUM(l.amount),0)::text AS amount FROM finance_profitability_budget b JOIN finance_profitability_budget_line l ON l.organization_id=b.organization_id AND l.budget_id=b.id WHERE b.organization_id=${ctx.organizationId} AND b.status='approved' AND b.currency=${baseCurrency}`,
    ),
    db.maybeOne<{ amount: string }>(
      ctx,
      sql`SELECT COALESCE(SUM(amount),0)::text AS amount FROM finance_billable_event WHERE organization_id=${ctx.organizationId} AND state IN ('approved','pending','partially_billed') AND currency=${baseCurrency}`,
    ),
    db.maybeOne<{ amount: string }>(
      ctx,
      sql`SELECT COALESCE(SUM(total),0)::text AS amount FROM finance_invoice WHERE organization_id=${ctx.organizationId} AND status='issued' AND currency=${baseCurrency}`,
    ),
    db.maybeOne<{ amount: string }>(
      ctx,
      sql`SELECT COALESCE(SUM(amount_minor),0)::text AS amount FROM payment_receipt WHERE organization_id=${ctx.organizationId} AND state IN ('verified','reconciled') AND currency=${baseCurrency}`,
    ),
    db.maybeOne<{ amount: string }>(
      ctx,
      sql`SELECT COALESCE(SUM(amount),0)::text AS amount FROM finance_profitability_cost_entry WHERE organization_id=${ctx.organizationId} AND currency=${baseCurrency}`,
    ),
  ]);
  return {
    baseCurrency,
    reconciledCash: money(cents(cash?.amount ?? '0')),
    receivablesOutstanding: money(BigInt(receivables?.amount ?? '0')),
    approvedPayables: payables?.amount ?? '0.00',
    unreconciledBankLines: Number(unreconciled?.count ?? '0'),
    approvedBudget: budget?.amount ?? '0.00',
    contractedCash: contracted?.amount ?? '0.00',
    issuedCash: issued?.amount ?? '0.00',
    collectedCash: money(BigInt(collected?.amount ?? '0')),
    actualCost: actual?.amount ?? '0.00',
    advisory: true,
  };
}

export async function createForecast(ctx: RequestContext, input: ForecastInput) {
  return db.transaction(ctx, async (tx) => {
    const current = await tx.maybeOne<{ amount: string }>(
      sql`SELECT COALESCE(SUM(CASE WHEN le.system_key IN ('bank','gateway-clearing') THEN jl.debit-jl.credit ELSE 0 END),0)::text AS amount FROM journal_line jl JOIN journal_entry je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id JOIN ledger_account le ON le.organization_id=jl.organization_id AND le.id=jl.ledger_account_id WHERE jl.organization_id=${ctx.organizationId}`,
    );
    const invoiceRows = await tx.query<{
      invoiceDate: string;
      dueDate: string;
      outstanding: string;
      total: string;
    }>(
      sql`SELECT invoice_date::text AS "invoiceDate",due_date::text AS "dueDate",GREATEST(round(total*100)::bigint-COALESCE((SELECT SUM(pa.amount_minor) FROM payment_allocation pa WHERE pa.organization_id=i.organization_id AND pa.invoice_id=i.id),0),0)::text AS outstanding,total::text FROM finance_invoice i WHERE i.organization_id=${ctx.organizationId} AND i.status='issued' AND i.receivable_status NOT IN ('paid','written_off') AND i.currency=${input.baseCurrency} AND (invoice_date >= ${input.asOfDate} OR due_date >= ${input.asOfDate})`,
    );
    const contractedRows = await tx.query<{ eventDate: string; amount: string }>(
      sql`SELECT event_date::text AS "eventDate",amount::text FROM finance_billable_event WHERE organization_id=${ctx.organizationId} AND state IN ('approved','pending','partially_billed') AND currency=${input.baseCurrency} AND event_date >= ${input.asOfDate}`,
    );
    const payableRows = await tx.query<{ dueDate: string; amount: string }>(
      sql`SELECT due_date::text AS "dueDate",total::text AS amount FROM finance_payable_bill WHERE organization_id=${ctx.organizationId} AND status IN ('approved','partially_paid') AND currency=${input.baseCurrency} AND due_date >= ${input.asOfDate}`,
    );
    const subscriptionRows = await tx.query<{ nextDueDate: string; amount: string }>(
      sql`SELECT next_due_date::text AS "nextDueDate",amount::text FROM finance_payable_subscription WHERE organization_id=${ctx.organizationId} AND status='active' AND currency=${input.baseCurrency} AND next_due_date >= ${input.asOfDate}`,
    );
    const sourceHash = createHash('sha256')
      .update(
        JSON.stringify({
          forecastVersion: 'v2-date-safe-collections',
          asOfDate: input.asOfDate,
          baseCurrency: input.baseCurrency,
          horizonWeeks: input.horizonWeeks,
          minimumCash: input.minimumCash,
          invoiceRows,
          contractedRows,
          payableRows,
          subscriptionRows,
        }),
      )
      .digest('hex');
    const snapshot = await tx.maybeOne<{ id: string }>(
      sql`INSERT INTO finance_cash_flow_snapshot (organization_id,as_of_date,horizon_weeks,base_currency,minimum_cash,source_hash,source_data,created_by) VALUES (${ctx.organizationId},${input.asOfDate},${input.horizonWeeks},${input.baseCurrency},${input.minimumCash},${sourceHash},${JSON.stringify({ invoiceCount: invoiceRows.length, contractedCount: contractedRows.length, payableCount: payableRows.length, subscriptionCount: subscriptionRows.length, advisory: true })}::jsonb,${ctx.principal.id}) ON CONFLICT (organization_id,as_of_date,horizon_weeks,base_currency,source_hash) DO NOTHING RETURNING id`,
    );
    if (!snapshot) {
      const existing = await tx.one<{ id: string }>(
        sql`SELECT id FROM finance_cash_flow_snapshot WHERE organization_id=${ctx.organizationId} AND as_of_date=${input.asOfDate} AND horizon_weeks=${input.horizonWeeks} AND base_currency=${input.baseCurrency} AND source_hash=${sourceHash}`,
      );
      return {
        id: existing.id,
        horizonWeeks: input.horizonWeeks,
        baseCurrency: input.baseCurrency,
        advisory: true,
        idempotent: true,
      };
    }
    let opening = cents(current?.amount ?? '0');
    for (let bucket = 1; bucket <= input.horizonWeeks; bucket += 1) {
      const start = datePlus(input.asOfDate, (bucket - 1) * 7);
      const end = datePlus(start, 6);
      const contracted = contractedRows
        .filter((row) => row.eventDate >= start && row.eventDate <= end)
        .reduce((sum, row) => sum + cents(row.amount), 0n);
      const issued = invoiceRows
        .filter((row) => row.invoiceDate >= start && row.invoiceDate <= end)
        .reduce((sum, row) => sum + cents(row.total), 0n);
      const expectedCollections = invoiceRows
        .filter((row) => row.dueDate >= start && row.dueDate <= end)
        .reduce((sum, row) => sum + BigInt(row.outstanding), 0n);
      const payable = payableRows
        .filter((row) => row.dueDate >= start && row.dueDate <= end)
        .reduce((sum, row) => sum + cents(row.amount), 0n);
      const recurring = subscriptionRows
        .filter((row) => row.nextDueDate >= start && row.nextDueDate <= end)
        .reduce((sum, row) => sum + cents(row.amount), 0n);
      const closing = opening + expectedCollections + contracted - payable - recurring;
      await tx.query(
        sql`INSERT INTO finance_cash_flow_forecast (organization_id,snapshot_id,bucket_number,bucket_start,bucket_end,opening_cash,contracted_cash,issued_cash,expected_collections,other_inflows,payable_outflows,recurring_outflows,other_outflows,closing_cash,minimum_cash,variance_to_minimum,evidence) VALUES (${ctx.organizationId},${snapshot.id},${bucket},${start},${end},${money(opening)},${money(contracted)},${money(issued)},${money(expectedCollections)},'0.00',${money(payable)},${money(recurring)},'0.00',${money(closing)},${input.minimumCash},${money(closing - cents(input.minimumCash))},${JSON.stringify({ contracted: contractedRows.filter((row) => row.eventDate >= start && row.eventDate <= end).length, issued: invoiceRows.filter((row) => row.invoiceDate >= start && row.invoiceDate <= end).length, expectedCollections: invoiceRows.filter((row) => row.dueDate >= start && row.dueDate <= end).length, payables: payableRows.filter((row) => row.dueDate >= start && row.dueDate <= end).length, subscriptions: subscriptionRows.filter((row) => row.nextDueDate >= start && row.nextDueDate <= end).length })}::jsonb)`,
      );
      opening = closing;
    }
    await audit(ctx, tx, 'cash_flow.forecast.created', snapshot.id, input.reason, {
      ...input,
      advisory: true,
    });
    return {
      id: snapshot.id,
      horizonWeeks: input.horizonWeeks,
      baseCurrency: input.baseCurrency,
      advisory: true,
    };
  });
}

export async function createScenario(ctx: RequestContext, input: ScenarioInput) {
  return db.transaction(ctx, async (tx) => {
    const snapshot = await tx.maybeOne<{ id: string; currency: string }>(
      sql`SELECT id,base_currency AS currency FROM finance_cash_flow_snapshot WHERE organization_id=${ctx.organizationId} AND id=${input.snapshotId}`,
    );
    if (!snapshot) throw new CashFlowError('Forecast snapshot not found.', 404);
    if (snapshot.currency !== input.baseCurrency)
      throw new CashFlowError('Scenario currency must match the forecast currency.');
    const row = await tx.one<{ id: string }>(
      sql`INSERT INTO finance_cash_flow_scenario (organization_id,name,base_snapshot_id,base_currency,assumptions,status,created_by) VALUES (${ctx.organizationId},${input.name},${input.snapshotId},${input.baseCurrency},${JSON.stringify({ adjustments: input.adjustments, advisory: true })}::jsonb,${input.status},${ctx.principal.id}) RETURNING id`,
    );
    await audit(ctx, tx, 'cash_flow.scenario.created', row.id, input.reason, {
      name: input.name,
      snapshotId: input.snapshotId,
      advisory: true,
    });
    return row;
  });
}
