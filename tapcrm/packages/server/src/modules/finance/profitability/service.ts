import { createHash } from 'node:crypto';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { ProfitabilityError } from './errors.js';
import type { AllocationInput, BudgetInput, DecisionInput, DirectCostInput, LeakageDecisionInput, MarginInput, MetricInput, PayrollImportInput, RateInput, RevenueInput, TimeCostInput } from './validators.js';

function units(value: string, scale: number): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0').slice(0, scale));
}
function cents(value: string): bigint { return units(value, 2); }
function money(value: bigint): string { return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`; }
function hoursRateToCents(hours: string, rate: string): string { return money((units(hours, 4) * cents(rate)) / 10000n); }
function auditPayload(ctx: RequestContext, action: string, targetId: string, reason: string, after: unknown) {
  return { action, actorId: ctx.principal.id, actorType: ctx.principal.accountType, targetType: 'profitability', targetId, reason, after, requestId: ctx.requestId, sourceIp: ctx.sourceIp };
}
export async function audit(ctx: RequestContext, tx: Tx, action: string, targetId: string, reason: string, after: unknown) {
  await tx.query(sql`INSERT INTO audit_outbox (organization_id,stream,payload) VALUES (${ctx.organizationId},'activity',${JSON.stringify(auditPayload(ctx, action, targetId, reason, after))}::jsonb)`);
}
async function project(ctx: RequestContext, tx: Tx, id: string) {
  const row = await tx.maybeOne<{ id: string; clientId: string; currency: string }>(sql`SELECT id,client_id AS "clientId",currency FROM project WHERE organization_id=${ctx.organizationId} AND id=${id} AND archived_at IS NULL`);
  if (!row) throw new ProfitabilityError('Active project not found.', 404);
  return row;
}

export const listBudgets = (ctx: RequestContext) => db.query(ctx, sql`SELECT b.id,b.project_id AS "projectId",p.name AS "projectName",b.client_id AS "clientId",b.name,b.currency,b.period_start AS "periodStart",b.period_end AS "periodEnd",b.status,b.version,b.created_at AS "createdAt",COALESCE(sum(l.amount),0)::text AS "budgetTotal" FROM finance_profitability_budget b JOIN project p ON p.organization_id=b.organization_id AND p.id=b.project_id LEFT JOIN finance_profitability_budget_line l ON l.organization_id=b.organization_id AND l.budget_id=b.id WHERE b.organization_id=${ctx.organizationId} GROUP BY b.id,p.name ORDER BY b.period_start DESC,b.created_at DESC`);
export const listMargins = (ctx: RequestContext, periodStart: string, periodEnd: string) => db.query(ctx, sql`SELECT m.id,m.project_id AS "projectId",p.name AS "projectName",m.client_id AS "clientId",c.business_name AS "clientName",m.period_start AS "periodStart",m.period_end AS "periodEnd",m.currency,m.revenue,m.direct_cost AS "directCost",m.shared_cost AS "sharedCost",m.advertising_cost AS "advertisingCost",m.contribution,m.contribution_percent AS "contributionPercent",m.created_at AS "createdAt" FROM finance_profitability_margin_snapshot m JOIN project p ON p.organization_id=m.organization_id AND p.id=m.project_id JOIN client c ON c.organization_id=m.organization_id AND c.id=m.client_id WHERE m.organization_id=${ctx.organizationId} AND m.period_start=${periodStart} AND m.period_end=${periodEnd} ORDER BY m.contribution`);
export const listAllocationRuns = (ctx: RequestContext) => db.query(ctx, sql`SELECT id,period_start AS "periodStart",period_end AS "periodEnd",driver,status,manifest_sha256 AS "manifestSha256",reason,created_by AS "createdBy",approved_by AS "approvedBy",created_at AS "createdAt" FROM finance_profitability_allocation_run WHERE organization_id=${ctx.organizationId} ORDER BY created_at DESC`);

export async function createBudget(ctx: RequestContext, input: BudgetInput) {
  return db.transaction(ctx, async (tx) => {
    const p = await project(ctx, tx, input.projectId);
    if (p.currency !== input.currency) throw new ProfitabilityError('Budget currency must match the project currency.');
    const budget = await tx.one<{ id: string }>(sql`INSERT INTO finance_profitability_budget (organization_id,project_id,client_id,name,currency,period_start,period_end,status,version,reason,created_by) VALUES (${ctx.organizationId},${p.id},${p.clientId},${input.name},${input.currency},${input.periodStart},${input.periodEnd},'draft',${input.version},${input.reason},${ctx.principal.id}) RETURNING id`);
    for (const line of input.lines) await tx.query(sql`INSERT INTO finance_profitability_budget_line (organization_id,budget_id,category,amount,reason) VALUES (${ctx.organizationId},${budget.id},${line.category},${line.amount},${line.reason})`);
    await audit(ctx, tx, 'profitability.budget.created', budget.id, input.reason, input);
    return budget;
  });
}

export async function approveBudget(ctx: RequestContext, id: string, input: DecisionInput) {
  return db.transaction(ctx, async (tx) => {
    const row = await tx.one<{ status: string; createdBy: string }>(sql`SELECT status,created_by AS "createdBy" FROM finance_profitability_budget WHERE organization_id=${ctx.organizationId} AND id=${id} FOR UPDATE`);
    if (row.status !== 'draft' && row.status !== 'submitted') throw new ProfitabilityError('Only draft or submitted budgets can be approved.');
    if (row.createdBy === ctx.principal.id) throw new ProfitabilityError('The budget creator cannot approve the same budget.');
    await tx.query(sql`UPDATE finance_profitability_budget SET status='approved',approved_by=${ctx.principal.id},approved_at=now(),updated_at=now() WHERE organization_id=${ctx.organizationId} AND id=${id}`);
    await audit(ctx, tx, 'profitability.budget.approved', id, input.reason, { status: 'approved' });
    return { id, status: 'approved' };
  });
}

export async function createCostRate(ctx: RequestContext, input: RateInput) {
  return db.transaction(ctx, async (tx) => {
    if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) throw new ProfitabilityError('Cost-rate end date cannot precede its start date.');
    if (input.userId) {
      const user = await tx.maybeOne<{ id: string }>(sql`SELECT id FROM app_user WHERE organization_id=${ctx.organizationId} AND id=${input.userId} AND account_type='employee'`);
      if (!user) throw new ProfitabilityError('Employee not found.', 404);
    }
    const row = await tx.one<{ id: string }>(sql`INSERT INTO finance_profitability_cost_rate (organization_id,user_id,role_code,currency,hourly_rate,effective_from,effective_to,reason,created_by) VALUES (${ctx.organizationId},${input.userId ?? null},${input.roleCode ?? null},${input.currency},${input.hourlyRate},${input.effectiveFrom},${input.effectiveTo ?? null},${input.reason},${ctx.principal.id}) RETURNING id`);
    await audit(ctx, tx, 'profitability.cost_rate.created', row.id, input.reason, { ...input, hourlyRate: '[restricted]' });
    return row;
  });
}

export async function createTimeCost(ctx: RequestContext, input: TimeCostInput) {
  return db.transaction(ctx, async (tx) => {
    const p = await project(ctx, tx, input.projectId);
    if (p.currency !== input.currency) throw new ProfitabilityError('Time-cost currency must match the project currency.');
    const rate = await tx.maybeOne<{ hourlyRate: string }>(sql`SELECT r.hourly_rate::text AS "hourlyRate" FROM finance_profitability_cost_rate r LEFT JOIN app_user u ON u.organization_id=r.organization_id AND u.id=${input.userId} LEFT JOIN designation d ON d.organization_id=u.organization_id AND d.id=u.designation_id WHERE r.organization_id=${ctx.organizationId} AND r.currency=${input.currency} AND r.status='active' AND r.effective_from <= ${input.workDate} AND (r.effective_to IS NULL OR r.effective_to >= ${input.workDate}) AND (r.user_id=${input.userId} OR (r.user_id IS NULL AND lower(r.role_code)=lower(d.name))) ORDER BY (r.user_id IS NOT NULL) DESC,r.effective_from DESC LIMIT 1`);
    if (!rate) throw new ProfitabilityError('No effective restricted cost rate exists for this employee and date.');
    const amount = hoursRateToCents(input.hours, rate.hourlyRate);
    const row = await tx.one<{ id: string }>(sql`INSERT INTO finance_profitability_cost_entry (organization_id,project_id,client_id,category,allocation_mode,source_type,source_id,work_date,hours,billable_hours,hourly_rate,amount,currency,description,created_by) VALUES (${ctx.organizationId},${p.id},${p.clientId},'staff_time','direct',${input.sourceType},${input.sourceId},${input.workDate},${input.hours},${input.billableHours ?? input.hours},${rate.hourlyRate},${amount},${input.currency},'Approved time cost',${ctx.principal.id}) RETURNING id`);
    await audit(ctx, tx, 'profitability.time_cost.created', row.id, input.reason, { projectId: p.id, hours: input.hours, amount });
    return row;
  });
}

export async function createDirectCost(ctx: RequestContext, input: DirectCostInput) {
  return db.transaction(ctx, async (tx) => {
    const p = input.projectId ? await project(ctx, tx, input.projectId) : null;
    if (p && p.currency !== input.currency) throw new ProfitabilityError('Cost currency must match the project currency.');
    const row = await tx.one<{ id: string }>(sql`INSERT INTO finance_profitability_cost_entry (organization_id,project_id,client_id,category,allocation_mode,source_type,source_id,work_date,amount,currency,description,created_by) VALUES (${ctx.organizationId},${p?.id ?? null},${p?.clientId ?? null},${input.category},${input.allocationMode},${input.sourceType},${input.sourceId},${input.workDate},${input.amount},${input.currency},${input.description},${ctx.principal.id}) RETURNING id`);
    await audit(ctx, tx, 'profitability.cost_entry.created', row.id, input.reason, input);
    return row;
  });
}

export async function importPublishedPayrollCosts(ctx: RequestContext, input: PayrollImportInput) {
  return db.transaction(ctx, async (tx) => {
    const run = await tx.maybeOne<{ periodEnd: string }>(sql`SELECT period_end AS "periodEnd" FROM payroll_run WHERE organization_id=${ctx.organizationId} AND id=${input.runId} AND status='published'`);
    if (!run) throw new ProfitabilityError('Only a published payroll run can be imported.', 422);
    const slips = await tx.query<{ id: string; amount: string; currency: string }>(sql`SELECT id,(COALESCE(gross_paise,0)+COALESCE(employer_contribution_paise,0))::text AS amount,COALESCE(inputs->>'currency','INR') AS currency FROM payslip WHERE organization_id=${ctx.organizationId} AND run_id=${input.runId} AND status='published'`);
    let imported = 0;
    for (const slip of slips) {
      const amount = money(BigInt(slip.amount) / 100n);
      const inserted = await tx.maybeOne<{ id: string }>(sql`INSERT INTO finance_profitability_cost_entry (organization_id,category,allocation_mode,source_type,source_id,work_date,amount,currency,description,created_by) VALUES (${ctx.organizationId},'payroll','shared','payroll.published',${slip.id},${run.periodEnd},${amount},${slip.currency},'Published payroll expense for profitability allocation',${ctx.principal.id}) ON CONFLICT (organization_id,source_type,source_id) DO NOTHING RETURNING id`);
      if (inserted) imported += 1;
    }
    await audit(ctx, tx, 'profitability.payroll.imported', input.runId, input.reason, { imported, oneWay: true, journalsCreated: 0 });
    return { runId: input.runId, imported, journalsCreated: 0 };
  });
}

export async function recordRevenue(ctx: RequestContext, input: RevenueInput) {
  return db.transaction(ctx, async (tx) => {
    const p = await project(ctx, tx, input.projectId);
    if (p.currency !== input.currency) throw new ProfitabilityError('Revenue currency must match the project currency.');
    const row = await tx.one<{ id: string }>(sql`INSERT INTO finance_profitability_revenue (organization_id,project_id,client_id,source_type,source_id,period_start,amount,currency,reason,created_by) VALUES (${ctx.organizationId},${p.id},${p.clientId},${input.sourceType},${input.sourceId},${input.periodStart},${input.amount},${input.currency},${input.reason},${ctx.principal.id}) RETURNING id`);
    await audit(ctx, tx, 'profitability.revenue.attributed', row.id, input.reason, input);
    return row;
  });
}

export async function createAllocationRun(ctx: RequestContext, input: AllocationInput) {
  return db.transaction(ctx, async (tx) => {
    const entries = await tx.query<{ id: string; amount: string }>(sql`SELECT id,amount::text FROM finance_profitability_cost_entry WHERE organization_id=${ctx.organizationId} AND allocation_mode='shared' AND work_date BETWEEN ${input.periodStart} AND ${input.periodEnd} AND NOT EXISTS (SELECT 1 FROM finance_profitability_allocation a JOIN finance_profitability_allocation_run r ON r.organization_id=a.organization_id AND r.id=a.run_id WHERE a.organization_id=finance_profitability_cost_entry.organization_id AND a.cost_entry_id=finance_profitability_cost_entry.id AND r.status IN ('proposed','approved')) FOR SHARE`);
    const projects = await tx.query<{ id: string; weight: string }>(sql`SELECT p.id,CASE WHEN ${input.driver}='equal' THEN '1' WHEN ${input.driver}='budget' THEN COALESCE((SELECT sum(l.amount) FROM finance_profitability_budget b JOIN finance_profitability_budget_line l ON l.organization_id=b.organization_id AND l.budget_id=b.id WHERE b.organization_id=p.organization_id AND b.project_id=p.id AND b.status='approved' AND b.period_start <= ${input.periodEnd} AND b.period_end >= ${input.periodStart}),0)::text ELSE COALESCE((SELECT sum(c.hours) FROM finance_profitability_cost_entry c WHERE c.organization_id=p.organization_id AND c.project_id=p.id AND c.category='staff_time' AND c.work_date BETWEEN ${input.periodStart} AND ${input.periodEnd}),0)::text END AS weight FROM project p WHERE p.organization_id=${ctx.organizationId} AND p.archived_at IS NULL`);
    if (!entries.length) throw new ProfitabilityError('No unallocated shared costs exist for this period.');
    const weights = projects.filter((p) => Number(p.weight) > 0);
    if (!weights.length) throw new ProfitabilityError('No eligible projects have weight for this allocation driver.');
    const manifest: Array<{ entryId: string; projectId: string; amount: string; weight: string }> = [];
    for (const entry of entries) {
      let remaining = cents(entry.amount);
      const totalWeight = weights.reduce((sum, p) => sum + Number(p.weight), 0);
      for (let i = 0; i < weights.length; i += 1) {
        const p = weights[i]!;
        const amount = i === weights.length - 1 ? remaining : (cents(entry.amount) * BigInt(Math.floor((Number(p.weight) / totalWeight) * 1000000))) / 1000000n;
        remaining -= amount;
        if (amount > 0n) manifest.push({ entryId: entry.id, projectId: p.id, amount: money(amount), weight: (Number(p.weight) / totalWeight).toFixed(8) });
      }
    }
    const manifestHash = createHash('sha256').update(JSON.stringify({ ...input, allocations: manifest })).digest('hex');
    const run = await tx.one<{ id: string }>(sql`INSERT INTO finance_profitability_allocation_run (organization_id,period_start,period_end,driver,manifest,manifest_sha256,reason,created_by) VALUES (${ctx.organizationId},${input.periodStart},${input.periodEnd},${input.driver},${JSON.stringify({ allocations: manifest })}::jsonb,${manifestHash},${input.reason},${ctx.principal.id}) RETURNING id`);
    for (const item of manifest) await tx.query(sql`INSERT INTO finance_profitability_allocation (organization_id,run_id,cost_entry_id,project_id,amount,weight) VALUES (${ctx.organizationId},${run.id},${item.entryId},${item.projectId},${item.amount},${item.weight})`);
    await audit(ctx, tx, 'profitability.allocation.proposed', run.id, input.reason, { manifestHash, entries: manifest.length });
    return { id: run.id, manifestHash, status: 'proposed' };
  });
}

export async function approveAllocationRun(ctx: RequestContext, id: string, input: DecisionInput) {
  return db.transaction(ctx, async (tx) => {
    const row = await tx.one<{ status: string; createdBy: string }>(sql`SELECT status,created_by AS "createdBy" FROM finance_profitability_allocation_run WHERE organization_id=${ctx.organizationId} AND id=${id} FOR UPDATE`);
    if (row.status !== 'proposed') throw new ProfitabilityError('Only proposed allocation runs can be approved.');
    if (row.createdBy === ctx.principal.id) throw new ProfitabilityError('The allocation-run proposer cannot approve the same run.');
    await tx.query(sql`UPDATE finance_profitability_allocation_run SET status='approved',approved_by=${ctx.principal.id},approved_at=now() WHERE organization_id=${ctx.organizationId} AND id=${id}`);
    await audit(ctx, tx, 'profitability.allocation.approved', id, input.reason, { status: 'approved' });
    return { id, status: 'approved' };
  });
}

export async function refreshMargin(ctx: RequestContext, input: MarginInput) {
  return db.transaction(ctx, async (tx) => {
    const p = await project(ctx, tx, input.projectId);
    const revenue = await tx.one<{ total: string }>(sql`SELECT COALESCE(sum(amount),0)::text AS total FROM finance_profitability_revenue WHERE organization_id=${ctx.organizationId} AND project_id=${p.id} AND period_start BETWEEN ${input.periodStart} AND ${input.periodEnd} AND currency=${input.currency}`);
    const direct = await tx.one<{ total: string }>(sql`SELECT COALESCE(sum(amount),0)::text AS total FROM finance_profitability_cost_entry WHERE organization_id=${ctx.organizationId} AND project_id=${p.id} AND allocation_mode='direct' AND work_date BETWEEN ${input.periodStart} AND ${input.periodEnd} AND currency=${input.currency}`);
    const shared = await tx.one<{ total: string }>(sql`SELECT COALESCE(sum(a.amount),0)::text AS total FROM finance_profitability_allocation a JOIN finance_profitability_allocation_run r ON r.organization_id=a.organization_id AND r.id=a.run_id WHERE a.organization_id=${ctx.organizationId} AND a.project_id=${p.id} AND r.status='approved' AND r.period_start <= ${input.periodEnd} AND r.period_end >= ${input.periodStart}`);
    const advertising = await tx.one<{ total: string }>(sql`SELECT COALESCE(sum(s.amount),0)::text AS total FROM finance_advertising_spend s WHERE s.organization_id=${ctx.organizationId} AND s.project_id=${p.id} AND s.spend_date BETWEEN ${input.periodStart} AND ${input.periodEnd} AND s.currency=${input.currency}`);
    const revenueCents = cents(revenue.total); const directCents = cents(direct.total); const sharedCents = cents(shared.total); const advertisingCents = cents(advertising.total); const contribution = revenueCents - directCents - sharedCents - advertisingCents;
    const hash = createHash('sha256').update(JSON.stringify({ revenue: revenue.total, direct: direct.total, shared: shared.total, advertising: advertising.total, periodStart: input.periodStart, periodEnd: input.periodEnd })).digest('hex');
    const row = await tx.one<{ id: string }>(sql`INSERT INTO finance_profitability_margin_snapshot (organization_id,project_id,client_id,period_start,period_end,currency,revenue,direct_cost,shared_cost,advertising_cost,contribution,contribution_percent,source_hash) VALUES (${ctx.organizationId},${p.id},${p.clientId},${input.periodStart},${input.periodEnd},${input.currency},${revenue.total},${direct.total},${shared.total},${advertising.total},${money(contribution)},${revenueCents === 0n ? null : Number(contribution * 10000n / revenueCents) / 100},${hash}) RETURNING id`);
    await audit(ctx, tx, 'profitability.margin.refreshed', row.id, input.reason, { projectId: p.id, periodStart: input.periodStart, periodEnd: input.periodEnd, sourceHash: hash });
    return { id: row.id, projectId: p.id, revenue: revenue.total, directCost: direct.total, sharedCost: shared.total, advertisingCost: advertising.total, contribution: money(contribution) };
  });
}

export const listLeakage = (ctx: RequestContext) => db.query(ctx, sql`SELECT f.id,f.project_id AS "projectId",p.name AS "projectName",f.client_id AS "clientId",c.business_name AS "clientName",f.period_start AS "periodStart",f.period_end AS "periodEnd",f.finding_type AS "findingType",f.severity,f.amount,f.evidence,f.status,f.resolution,f.detected_at AS "detectedAt" FROM finance_profitability_leakage_finding f JOIN project p ON p.organization_id=f.organization_id AND p.id=f.project_id JOIN client c ON c.organization_id=f.organization_id AND c.id=f.client_id WHERE f.organization_id=${ctx.organizationId} ORDER BY CASE f.status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END,f.detected_at DESC`);
export const listMetrics = (ctx: RequestContext) => db.query(ctx, sql`SELECT m.id,m.project_id AS "projectId",p.name AS "projectName",m.client_id AS "clientId",m.period_start AS "periodStart",m.period_end AS "periodEnd",m.currency,m.billable_hours AS "billableHours",m.available_hours AS "availableHours",m.recognized_revenue AS "recognizedRevenue",m.theoretical_value AS "theoreticalValue",m.utilization_percent AS "utilizationPercent",m.realization_percent AS "realizationPercent",m.created_at AS "createdAt" FROM finance_profitability_metric_snapshot m JOIN project p ON p.organization_id=m.organization_id AND p.id=m.project_id WHERE m.organization_id=${ctx.organizationId} ORDER BY m.period_end DESC`);
export const listAdvertisingAccounts = (ctx: RequestContext) => db.query(ctx, sql`SELECT a.id,a.provider,a.external_account_id AS "externalAccountId",a.name,a.project_id AS "projectId",a.client_id AS "clientId",a.funding_model AS "fundingModel",a.currency,a.status,a.last_sync_at AS "lastSyncAt",a.last_sync_status AS "lastSyncStatus",a.last_sync_message AS "lastSyncMessage",a.freshness_hours AS "freshnessHours",CASE WHEN a.last_sync_at IS NULL OR a.last_sync_at < now() - make_interval(hours => a.freshness_hours) THEN true ELSE false END AS stale FROM finance_advertising_account a WHERE a.organization_id=${ctx.organizationId} ORDER BY a.name`);

export async function refreshMetric(ctx: RequestContext, input: MetricInput) {
  return db.transaction(ctx, async (tx) => {
    const p = await project(ctx, tx, input.projectId);
    const row = await tx.one<{ billable: string }>(sql`SELECT COALESCE(sum(billable_hours),0)::text AS billable FROM finance_profitability_cost_entry WHERE organization_id=${ctx.organizationId} AND project_id=${p.id} AND work_date BETWEEN ${input.periodStart} AND ${input.periodEnd} AND currency=${input.currency}`);
    const billable = Number(row.billable); const available = Number(input.availableHours); const theoretical = Number(input.theoreticalValue); const revenue = await tx.one<{ total: string }>(sql`SELECT COALESCE(sum(amount),0)::text AS total FROM finance_profitability_revenue WHERE organization_id=${ctx.organizationId} AND project_id=${p.id} AND period_start BETWEEN ${input.periodStart} AND ${input.periodEnd} AND currency=${input.currency}`);
    const sourceHash = createHash('sha256').update(JSON.stringify({ billable, available, theoretical, revenue: revenue.total })).digest('hex');
    const inserted = await tx.one<{ id: string }>(sql`INSERT INTO finance_profitability_metric_snapshot (organization_id,project_id,client_id,period_start,period_end,currency,billable_hours,available_hours,recognized_revenue,theoretical_value,utilization_percent,realization_percent,source_hash) VALUES (${ctx.organizationId},${p.id},${p.clientId},${input.periodStart},${input.periodEnd},${input.currency},${billable},${available},${revenue.total},${input.theoreticalValue},${available === 0 ? null : billable / available * 100},${theoretical === 0 ? null : Number(cents(revenue.total)) / Number(cents(input.theoreticalValue)) * 100},${sourceHash}) RETURNING id`);
    await audit(ctx, tx, 'profitability.metrics.refreshed', inserted.id, input.reason, { projectId: p.id, periodStart: input.periodStart, periodEnd: input.periodEnd, sourceHash });
    return { id: inserted.id, projectId: p.id, billableHours: billable, utilizationPercent: available === 0 ? null : billable / available * 100, realizationPercent: theoretical === 0 ? null : Number(cents(revenue.total)) / Number(cents(input.theoreticalValue)) * 100 };
  });
}

export async function scanLeakage(ctx: RequestContext, periodStart: string, periodEnd: string, reason = 'Scheduled revenue-leakage scan.') {
  return db.transaction(ctx, async (tx) => {
    const rows = await tx.query<{ projectId: string; clientId: string; direct: string; revenue: string; advertising: string; shared: string; budget: string }>(sql`SELECT p.id AS "projectId",p.client_id AS "clientId",COALESCE((SELECT sum(e.amount) FROM finance_profitability_cost_entry e WHERE e.organization_id=p.organization_id AND e.project_id=p.id AND e.allocation_mode='direct' AND e.work_date BETWEEN ${periodStart} AND ${periodEnd}),0)::text AS direct,COALESCE((SELECT sum(r.amount) FROM finance_profitability_revenue r WHERE r.organization_id=p.organization_id AND r.project_id=p.id AND r.period_start BETWEEN ${periodStart} AND ${periodEnd}),0)::text AS revenue,COALESCE((SELECT sum(s.amount) FROM finance_advertising_spend s WHERE s.organization_id=p.organization_id AND s.project_id=p.id AND s.spend_date BETWEEN ${periodStart} AND ${periodEnd}),0)::text AS advertising,COALESCE((SELECT sum(a.amount) FROM finance_profitability_allocation a JOIN finance_profitability_allocation_run ar ON ar.organization_id=a.organization_id AND ar.id=a.run_id WHERE a.organization_id=p.organization_id AND a.project_id=p.id AND ar.status='approved' AND ar.period_start <= ${periodEnd} AND ar.period_end >= ${periodStart}),0)::text AS shared,COALESCE((SELECT sum(l.amount) FROM finance_profitability_budget b JOIN finance_profitability_budget_line l ON l.organization_id=b.organization_id AND l.budget_id=b.id WHERE b.organization_id=p.organization_id AND b.project_id=p.id AND b.status='approved' AND b.period_start <= ${periodEnd} AND b.period_end >= ${periodStart}),0)::text AS budget FROM project p WHERE p.organization_id=${ctx.organizationId} AND p.archived_at IS NULL`);
    let findings = 0;
    for (const row of rows) {
      const direct = cents(row.direct); const revenue = cents(row.revenue); const actual = direct + cents(row.shared) + cents(row.advertising); const budget = cents(row.budget);
      if (direct > 0n && revenue === 0n) {
        await tx.query(sql`INSERT INTO finance_profitability_leakage_finding (organization_id,project_id,client_id,period_start,period_end,finding_type,severity,amount,evidence) VALUES (${ctx.organizationId},${row.projectId},${row.clientId},${periodStart},${periodEnd},'unbilled_revenue','high',${row.direct},${JSON.stringify({ directCost: row.direct, message: 'Project has approved direct cost but no attributed revenue.' })}::jsonb) ON CONFLICT (organization_id,project_id,period_start,period_end,finding_type) DO UPDATE SET amount=EXCLUDED.amount,evidence=EXCLUDED.evidence,detected_at=now() WHERE finance_profitability_leakage_finding.status <> 'resolved'`);
        findings += 1;
      } else if (revenue > 0n && direct === 0n) {
        await tx.query(sql`INSERT INTO finance_profitability_leakage_finding (organization_id,project_id,client_id,period_start,period_end,finding_type,severity,amount,evidence) VALUES (${ctx.organizationId},${row.projectId},${row.clientId},${periodStart},${periodEnd},'missing_cost','medium',${row.revenue},${JSON.stringify({ revenue: row.revenue, message: 'Project has attributed revenue but no direct cost.' })}::jsonb) ON CONFLICT (organization_id,project_id,period_start,period_end,finding_type) DO UPDATE SET amount=EXCLUDED.amount,evidence=EXCLUDED.evidence,detected_at=now() WHERE finance_profitability_leakage_finding.status <> 'resolved'`);
        findings += 1;
      }
      if (budget > 0n && actual > budget) {
        await tx.query(sql`INSERT INTO finance_profitability_leakage_finding (organization_id,project_id,client_id,period_start,period_end,finding_type,severity,amount,evidence) VALUES (${ctx.organizationId},${row.projectId},${row.clientId},${periodStart},${periodEnd},'budget_overrun','high',${money(actual - budget)},${JSON.stringify({ actual: money(actual), budget: money(budget), message: 'Allocated and advertising costs exceed the approved project budget.' })}::jsonb) ON CONFLICT (organization_id,project_id,period_start,period_end,finding_type) DO UPDATE SET amount=EXCLUDED.amount,evidence=EXCLUDED.evidence,detected_at=now() WHERE finance_profitability_leakage_finding.status <> 'resolved'`);
        findings += 1;
      }
    }
    await audit(ctx, tx, 'profitability.leakage.scanned', `${periodStart}:${periodEnd}`, reason, { periodStart, periodEnd, findings });
    return { findings };
  });
}

export async function decideLeakage(ctx: RequestContext, id: string, input: LeakageDecisionInput) {
  return db.transaction(ctx, async (tx) => {
    const finding = await tx.maybeOne<{ status: 'open' | 'acknowledged' | 'resolved' }>(sql`SELECT status FROM finance_profitability_leakage_finding WHERE organization_id=${ctx.organizationId} AND id=${id} FOR UPDATE`);
    if (!finding) throw new ProfitabilityError('Leakage finding not found.', 404);
    if (finding.status === 'resolved' && input.status !== 'resolved') throw new ProfitabilityError('A resolved leakage finding cannot be reopened through this action.');
    await tx.query(sql`UPDATE finance_profitability_leakage_finding SET status=${input.status},resolution=${input.resolution},resolved_by=${input.status === 'resolved' ? ctx.principal.id : null},resolved_at=${input.status === 'resolved' ? new Date() : null} WHERE organization_id=${ctx.organizationId} AND id=${id}`);
    await audit(ctx, tx, 'profitability.leakage.decided', id, input.resolution, { status: input.status });
    return { id, status: input.status };
  });
}
