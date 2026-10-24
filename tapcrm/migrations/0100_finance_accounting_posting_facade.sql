-- Phase 4 — source-owned accounting posting boundary.
-- Existing tenants receive the system accounts required by payroll and future
-- source modules. New tenants receive them from provisioning.ts.

INSERT INTO ledger_account (organization_id, code, name, account_type, normal_balance, system_key, is_system_account)
SELECT o.id, v.code, v.name, v.account_type, v.normal_balance, v.system_key, true
FROM organization o
CROSS JOIN (VALUES
  ('2600', 'Statutory Liability', 'liability', 'credit', 'statutory-liability'),
  ('5200', 'Employer Contribution Expense', 'expense', 'debit', 'employer-contribution-expense')
) AS v(code, name, account_type, normal_balance, system_key)
ON CONFLICT (organization_id, system_key) DO NOTHING;

CREATE UNIQUE INDEX ux_journal_entry_source_event
  ON journal_entry (organization_id, source_type, source_id)
  WHERE source_id IS NOT NULL;
