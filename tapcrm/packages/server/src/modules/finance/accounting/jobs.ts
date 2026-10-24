import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { defineJob, type JobHandle } from '../../../platform/jobs/runner.js';

interface IntegrityReport {
  readonly journalDebit: string;
  readonly journalCredit: string;
  readonly balanceProjectionMismatches: string;
  readonly balanced: boolean;
}

export async function runAccountingIntegrityCheck(ctx: RequestContext): Promise<IntegrityReport> {
  const totals = await db.one<{ debit: string; credit: string }>(ctx, sql`
    SELECT COALESCE(sum(debit), 0)::text AS debit, COALESCE(sum(credit), 0)::text AS credit
    FROM journal_line WHERE organization_id = ${ctx.organizationId}
  `);
  const mismatch = await db.one<{ count: string }>(ctx, sql`
    SELECT count(*)::text AS count
    FROM (
      SELECT ab.ledger_account_id, ab.period_id,
             ab.debit_total, ab.credit_total,
             COALESCE(sum(jl.debit), 0)::numeric(20,2) AS expected_debit,
             COALESCE(sum(jl.credit), 0)::numeric(20,2) AS expected_credit
      FROM account_balance ab
      LEFT JOIN journal_entry je ON je.organization_id = ab.organization_id AND je.period_id = ab.period_id
      LEFT JOIN journal_line jl ON jl.organization_id = ab.organization_id AND jl.journal_entry_id = je.id AND jl.ledger_account_id = ab.ledger_account_id
      WHERE ab.organization_id = ${ctx.organizationId}
      GROUP BY ab.ledger_account_id, ab.period_id, ab.debit_total, ab.credit_total
    ) projection
    WHERE debit_total <> expected_debit OR credit_total <> expected_credit
  `);
  const balanced = totals.debit === totals.credit && mismatch.count === '0';
  const report = { journalDebit: totals.debit, journalCredit: totals.credit, balanceProjectionMismatches: mismatch.count, balanced };
  if (!balanced) {
    console.error(JSON.stringify({ level: 'critical', alert: 'accounting-integrity-failure', organizationId: ctx.organizationId, ...report }));
  }
  return report;
}

export interface AccountingJobs { readonly integrityCheck: JobHandle<undefined>; }

export function registerAccountingJobs(): AccountingJobs {
  const integrityCheck = defineJob<undefined>({
    name: 'accounting.integrity-check',
    perOrganization: true,
    module: 'accounting',
    schedule: { pattern: '0 2 * * *', tz: 'Asia/Kolkata' },
    attempts: 2,
    handler: async ({ ctx }) => {
      const report = await runAccountingIntegrityCheck(ctx);
      return { itemsProcessed: 1, errorCount: report.balanced ? 0 : 1, details: { ...report } };
    },
  });
  return { integrityCheck };
}
