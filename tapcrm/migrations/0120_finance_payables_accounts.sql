-- Additive account required for vendor and reimbursement bill postings.
INSERT INTO ledger_account (organization_id, code, name, account_type, normal_balance, system_key, is_system_account)
SELECT o.id, '5400', 'General Operating Expense', 'expense', 'debit', 'general-expense', true
FROM organization o
ON CONFLICT (organization_id, system_key) DO NOTHING;
