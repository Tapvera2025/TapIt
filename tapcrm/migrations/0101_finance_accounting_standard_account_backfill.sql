-- Complete the standard system chart for organizations that existed before
-- the Phase 4 posting façade migration.

INSERT INTO ledger_account (organization_id, code, name, account_type, normal_balance, system_key, is_system_account)
SELECT o.id, v.code, v.name, v.account_type, v.normal_balance, v.system_key, true
FROM organization o
CROSS JOIN (VALUES
  ('1000', 'Cash', 'asset', 'debit', 'cash'),
  ('1100', 'Accounts Receivable', 'asset', 'debit', 'accounts-receivable'),
  ('1200', 'Bank', 'asset', 'debit', 'bank'),
  ('1300', 'TDS Receivable', 'asset', 'debit', 'tds-receivable'),
  ('1400', 'Input GST', 'asset', 'debit', 'input-gst'),
  ('2000', 'Accounts Payable', 'liability', 'credit', 'accounts-payable'),
  ('2100', 'GST Payable', 'liability', 'credit', 'gst-payable'),
  ('2200', 'TDS Payable', 'liability', 'credit', 'tds-payable'),
  ('2300', 'Advances from Customers', 'liability', 'credit', 'advances-from-customers'),
  ('2400', 'Deferred Revenue', 'liability', 'credit', 'deferred-revenue'),
  ('2500', 'Salary Payable', 'liability', 'credit', 'salary-payable'),
  ('2600', 'Statutory Liability', 'liability', 'credit', 'statutory-liability'),
  ('3000', 'Retained Earnings', 'equity', 'credit', 'retained-earnings'),
  ('4000', 'Revenue', 'income', 'credit', 'revenue'),
  ('5000', 'Salary Expense', 'expense', 'debit', 'salary-expense'),
  ('5100', 'Bad Debt', 'expense', 'debit', 'bad-debt'),
  ('5200', 'Employer Contribution Expense', 'expense', 'debit', 'employer-contribution-expense')
) AS v(code, name, account_type, normal_balance, system_key)
ON CONFLICT DO NOTHING;
