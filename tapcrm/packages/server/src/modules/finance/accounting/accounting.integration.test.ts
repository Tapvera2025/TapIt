import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decimal } from '@tapcrm/contracts';
import { installAuthz } from '../../../platform/authz-adapter.js';
import { createRequestContext } from '../../../platform/dal/context.js';
import { db, platformDb } from '../../../platform/dal/db.js';
import { closePools } from '../../../platform/dal/pool.js';
import { sql } from '../../../platform/dal/sql.js';
import { registerAccountingPolicies } from './policy.js';
import { provisionAccountingFoundation } from './provisioning.js';
import { postSourceJournalTx } from './facade.js';
import {
  closePeriod,
  createJournal,
  reverseJournal,
  updateChecklist,
} from './service.js';
import {
  exportAccountingReport,
  getBalanceSheet,
  getCashFlow,
  getGeneralLedger,
  getProfitAndLoss,
  getTrialBalance,
} from './reports.js';

const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const ORG = randomUUID();
const USER = randomUUID();
const DEBIT_ACCOUNT = randomUUID();
const CREDIT_ACCOUNT = randomUUID();
const JANUARY_PERIOD = randomUUID();
const FEBRUARY_PERIOD = randomUUID();

beforeAll(async () => {
  if (!enabled) return;
  installAuthz();
  registerAccountingPolicies();
  await platformDb.transaction('seed', 'accounting ledger phase 2', async (tx) => {
    await tx.query(
      sql`INSERT INTO organization (id, code, name) VALUES (${ORG}, ${`AC${ORG.slice(0, 6)}`}, 'Accounting Test Org')`,
    );
    await tx.query(sql`
      INSERT INTO app_user (id, organization_id, account_type, email, full_name)
      VALUES (${USER}, ${ORG}, 'service', ${`accounting-${ORG}@test.local`}, 'Accounting Test Service')
    `);
    await tx.query(sql`
      INSERT INTO ledger_account (id, organization_id, code, name, account_type, normal_balance)
      VALUES (${DEBIT_ACCOUNT}, ${ORG}, '9000', 'Test Debit', 'asset', 'debit'),
             (${CREDIT_ACCOUNT}, ${ORG}, '9900', 'Test Credit', 'income', 'credit')
    `);
    await tx.query(sql`
      INSERT INTO accounting_period (id, organization_id, financial_year, period_start, period_end)
      VALUES (${JANUARY_PERIOD}, ${ORG}, '2025-2026', '2025-01-01', '2025-01-31'),
             (${FEBRUARY_PERIOD}, ${ORG}, '2025-2026', '2025-02-01', '2025-02-28')
    `);
    await provisionAccountingFoundation(tx, ORG);
  });
});

afterAll(async () => closePools());

function context() {
  return createRequestContext({
    organizationId: ORG,
    principal: {
      id: USER,
      organizationId: ORG,
      sessionVersion: 1,
      accountType: 'super-admin',
    },
    requestId: randomUUID(),
  });
}

const balancedLines = [
  { accountId: DEBIT_ACCOUNT, debit: decimal('100.00'), credit: decimal('0') },
  { accountId: CREDIT_ACCOUNT, debit: decimal('0'), credit: decimal('100.00') },
] as const;

describe.skipIf(!enabled)('accounting ledger core (PostgreSQL)', () => {
  it('provisions the standard chart of accounts and April-to-March periods idempotently', async () => {
    const ctx = context();
    const accounts = await db.query<{ count: string }>(
      ctx,
      sql`
      SELECT count(*)::text AS count FROM ledger_account
      WHERE organization_id = ${ORG} AND is_system_account = true
    `,
    );
    const periods = await db.query<{ count: string }>(
      ctx,
      sql`
      SELECT count(*)::text AS count FROM accounting_period
      WHERE organization_id = ${ORG} AND financial_year = (
        CASE WHEN EXTRACT(MONTH FROM current_date) >= 4
          THEN EXTRACT(YEAR FROM current_date)::int || '-' || (EXTRACT(YEAR FROM current_date)::int + 1)
          ELSE (EXTRACT(YEAR FROM current_date)::int - 1) || '-' || EXTRACT(YEAR FROM current_date)::int
        END
      )
    `,
    );
    expect(Number(accounts[0]?.count)).toBe(25);
    expect(Number(periods[0]?.count)).toBe(12);
  });

  it('posts a balanced journal and materializes account balances', async () => {
    const ctx = context();
    const journal = await createJournal(ctx, {
      entryDate: '2025-01-15',
      description: 'Cash sale',
      sourceType: 'manual',
      lines: [...balancedLines],
    });

    expect(journal.lines).toHaveLength(2);
    expect(journal.debitTotal).toBe('100.00');
    expect(journal.creditTotal).toBe('100.00');

    const balances = await db.query<{
      accountId: string;
      debit: string;
      credit: string;
      balance: string;
    }>(
      ctx,
      sql`
      SELECT ledger_account_id AS "accountId", debit_total::text AS debit, credit_total::text AS credit, balance::text AS balance
      FROM account_balance WHERE organization_id = ${ORG} AND period_id = ${JANUARY_PERIOD}
      ORDER BY ledger_account_id
    `,
    );
    expect(balances).toHaveLength(2);
    expect(balances.map((row) => row.balance)).toContain('100.00');
    expect(balances.map((row) => row.balance)).toContain('-100.00');
  });

  it('posts source events through the façade and is idempotent by source event', async () => {
    const ctx = context();
    const sourceId = randomUUID();
    const input = {
      organizationId: ORG,
      postedBy: USER,
      entryDate: '2025-01-20',
      sourceType: 'test.source',
      sourceId,
      description: 'Source event',
      lines: [
        { accountKey: 'salary-expense', amountPaise: 12500n, side: 'debit' as const },
        { accountKey: 'salary-payable', amountPaise: 12500n, side: 'credit' as const },
      ],
    };
    const first = await db.transaction(ctx, (tx) => postSourceJournalTx(tx, input));
    const second = await db.transaction(ctx, (tx) => postSourceJournalTx(tx, input));

    expect(first.journalId).toBeTruthy();
    expect(first.duplicate).toBe(false);
    expect(second).toEqual({ journalId: first.journalId, duplicate: true });
    const rows = await db.query<{ count: string }>(
      ctx,
      sql`
      SELECT count(*)::text AS count
      FROM journal_entry
      WHERE organization_id = ${ORG} AND source_type = 'test.source' AND source_id = ${sourceId}::uuid
    `,
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('builds ledger reports, statements, comparisons and backend CSV exports from journals', async () => {
    const ctx = context();
    const ledger = await getGeneralLedger(
      ctx,
      { periodId: JANUARY_PERIOD },
      DEBIT_ACCOUNT,
    );
    expect(ledger.entries.length).toBeGreaterThan(0);
    expect(ledger.entries[0]?.runningBalance).toBe('100.00');

    const trialBalance = await getTrialBalance(ctx, {
      periodId: JANUARY_PERIOD,
      comparePeriodId: FEBRUARY_PERIOD,
    });
    expect(trialBalance.balanced).toBe(true);
    expect(trialBalance.totals.debit).toBe(trialBalance.totals.credit);

    const pnl = await getProfitAndLoss(ctx, { periodId: JANUARY_PERIOD });
    expect(pnl.revenueTotal).toBe('100.00');
    expect(pnl.netProfit).toBe('-25.00');

    const balanceSheet = await getBalanceSheet(ctx, {
      periodId: FEBRUARY_PERIOD,
      comparePeriodId: JANUARY_PERIOD,
    });
    expect(balanceSheet.assets.length).toBeGreaterThan(0);
    expect(balanceSheet.comparative.length).toBeGreaterThan(0);

    const cashFlow = await getCashFlow(ctx, { periodId: JANUARY_PERIOD });
    expect(cashFlow.closingCash).toBe('0.00');

    const csv = await exportAccountingReport(ctx, 'trial-balance', {
      periodId: JANUARY_PERIOD,
    });
    expect(csv.filename).toMatch(/^tapvera-trial-balance-/);
    expect(csv.body.toString('utf8')).toContain('accountId');
  });

  it('rejects unbalanced journals before any journal row is created', async () => {
    const ctx = context();
    await expect(
      createJournal(ctx, {
        entryDate: '2025-01-16',
        description: 'Invalid entry',
        sourceType: 'manual',
        lines: [
          { accountId: DEBIT_ACCOUNT, debit: decimal('10'), credit: decimal('0') },
          { accountId: CREDIT_ACCOUNT, debit: decimal('0'), credit: decimal('9') },
        ],
      }),
    ).rejects.toMatchObject({ code: 'ACCOUNTING_JOURNAL_UNBALANCED' });
  });

  it('creates an immutable reversal in a later open period', async () => {
    const ctx = context();
    const original = await createJournal(ctx, {
      entryDate: '2025-02-05',
      description: 'February accrual',
      sourceType: 'manual',
      lines: [...balancedLines],
    });
    const reversal = await reverseJournal(ctx, original.id, {
      entryDate: '2025-02-06',
      reason: 'Correction',
    });
    expect(reversal.reversalOfId).toBe(original.id);
    expect(reversal.lines[0]?.debit).toBe(original.lines[0]?.credit);

    await expect(
      reverseJournal(ctx, original.id, {
        entryDate: '2025-02-07',
        reason: 'Duplicate correction',
      }),
    ).rejects.toMatchObject({ code: 'ACCOUNTING_JOURNAL_ALREADY_REVERSED' });
  });

  it('rejects direct journal mutation and posting into a closed period', async () => {
    const ctx = context();
    const journal = await createJournal(ctx, {
      entryDate: '2025-02-08',
      description: 'Immutable entry',
      sourceType: 'manual',
      lines: [...balancedLines],
    });
    await expect(
      db.transaction(ctx, (tx) =>
        tx.query(
          sql`UPDATE journal_entry SET description = 'changed' WHERE id = ${journal.id}`,
        ),
      ),
    ).rejects.toThrow(/ACCOUNTING_JOURNAL_IMMUTABLE|permission denied/);
    await expect(
      db.transaction(ctx, (tx) =>
        tx.query(sql`
      INSERT INTO account_balance (organization_id, period_id, ledger_account_id, debit_total, credit_total, balance)
      VALUES (${ORG}, ${FEBRUARY_PERIOD}, ${DEBIT_ACCOUNT}, 1, 0, 1)
    `),
      ),
    ).rejects.toThrow(/permission denied/);

    await db.transaction(ctx, (tx) =>
      tx.query(sql`
      UPDATE accounting_period SET status = 'closed', closed_by = ${USER}, closed_at = now()
      WHERE id = ${FEBRUARY_PERIOD}
    `),
    );
    await expect(
      createJournal(ctx, {
        entryDate: '2025-02-20',
        description: 'Closed period entry',
        sourceType: 'manual',
        lines: [...balancedLines],
      }),
    ).rejects.toMatchObject({ code: 'ACCOUNTING_PERIOD_CLOSED' });
  });

  it('requires the close checklist and prevents a journal poster from closing', async () => {
    const ctx = context();
    await expect(closePeriod(ctx, JANUARY_PERIOD)).rejects.toMatchObject({
      code: 'ACCOUNTING_CLOSE_CHECKLIST_INCOMPLETE',
    });
    await updateChecklist(ctx, JANUARY_PERIOD, {
      bankReconciled: true,
      agingReconciled: true,
      payablesReconciled: true,
      gstReconciled: true,
      trialBalanceReconciled: true,
    });
    await expect(closePeriod(ctx, JANUARY_PERIOD)).rejects.toMatchObject({
      code: 'ACCOUNTING_CLOSE_SELF_POSTING',
    });
  });
});
