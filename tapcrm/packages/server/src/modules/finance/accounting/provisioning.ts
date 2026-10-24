import type { Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';

const STANDARD_ACCOUNTS = [
  ['cash', '1000', 'Cash', 'asset', 'debit'],
  ['accounts-receivable', '1100', 'Accounts Receivable', 'asset', 'debit'],
  ['bank', '1200', 'Bank', 'asset', 'debit'],
  ['tds-receivable', '1300', 'TDS Receivable', 'asset', 'debit'],
  ['input-gst', '1400', 'Input GST', 'asset', 'debit'],
  ['accounts-payable', '2000', 'Accounts Payable', 'liability', 'credit'],
  ['gst-payable', '2100', 'GST Payable', 'liability', 'credit'],
  ['tds-payable', '2200', 'TDS Payable', 'liability', 'credit'],
  ['advances-from-customers', '2300', 'Advances from Customers', 'liability', 'credit'],
  ['deferred-revenue', '2400', 'Deferred Revenue', 'liability', 'credit'],
  ['salary-payable', '2500', 'Salary Payable', 'liability', 'credit'],
  ['statutory-liability', '2600', 'Statutory Liability', 'liability', 'credit'],
  ['retained-earnings', '3000', 'Retained Earnings', 'equity', 'credit'],
  ['revenue', '4000', 'Revenue', 'income', 'credit'],
  ['salary-expense', '5000', 'Salary Expense', 'expense', 'debit'],
  [
    'employer-contribution-expense',
    '5200',
    'Employer Contribution Expense',
    'expense',
    'debit',
  ],
  ['bad-debt', '5100', 'Bad Debt', 'expense', 'debit'],
] as const;

export async function provisionAccountingFoundation(
  tx: Tx,
  organizationId: string,
): Promise<void> {
  for (const [systemKey, code, name, accountType, normalBalance] of STANDARD_ACCOUNTS) {
    await tx.query(sql`
      INSERT INTO ledger_account (organization_id, code, name, account_type, normal_balance, system_key, is_system_account)
      VALUES (${organizationId}, ${code}, ${name}, ${accountType}, ${normalBalance}, ${systemKey}, true)
      ON CONFLICT (organization_id, system_key) DO NOTHING
    `);
  }

  await tx.query(sql`
    INSERT INTO accounting_period (organization_id, financial_year, period_start, period_end)
    SELECT ${organizationId},
           CASE WHEN EXTRACT(MONTH FROM month_start) >= 4
             THEN EXTRACT(YEAR FROM month_start)::int || '-' || (EXTRACT(YEAR FROM month_start)::int + 1)
             ELSE (EXTRACT(YEAR FROM month_start)::int - 1) || '-' || EXTRACT(YEAR FROM month_start)::int
           END,
           month_start::date,
           (month_start + interval '1 month - 1 day')::date
    FROM generate_series(
      date_trunc('year', current_date - interval '3 months') + interval '3 months',
      date_trunc('year', current_date - interval '3 months') + interval '14 months',
      interval '1 month'
    ) AS month_start
    ON CONFLICT (organization_id, period_start) DO NOTHING
  `);
}
