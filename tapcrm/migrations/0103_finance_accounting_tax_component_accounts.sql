-- Component accounts let statutory exports preserve IGST/CGST/SGST/Cess
-- without changing the existing generic GST accounts.
INSERT INTO ledger_account (organization_id, code, name, account_type, normal_balance, system_key, is_system_account)
SELECT o.id, a.code, a.name, a.account_type, a.normal_balance, a.system_key, true
FROM organization o
CROSS JOIN (VALUES
  ('1410', 'Input IGST', 'asset', 'debit', 'input-igst'),
  ('1420', 'Input CGST', 'asset', 'debit', 'input-cgst'),
  ('1430', 'Input SGST', 'asset', 'debit', 'input-sgst'),
  ('1440', 'Input Cess', 'asset', 'debit', 'input-cess'),
  ('2110', 'Output IGST', 'liability', 'credit', 'output-igst'),
  ('2120', 'Output CGST', 'liability', 'credit', 'output-cgst'),
  ('2130', 'Output SGST', 'liability', 'credit', 'output-sgst'),
  ('2140', 'Output Cess', 'liability', 'credit', 'output-cess')
) AS a(code, name, account_type, normal_balance, system_key)
ON CONFLICT (organization_id, system_key) DO NOTHING;
