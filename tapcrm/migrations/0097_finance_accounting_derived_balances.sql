-- =====================================================================
-- 0097 — Finance / Accounting derived balance hardening
--
-- account_balance is a maintained projection. It must never be manually
-- authored by the application; journal-line insertion is its only write path.
-- =====================================================================

CREATE OR REPLACE FUNCTION accounting_apply_balance_for_line()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  journal_period_id uuid;
BEGIN
  SELECT period_id INTO journal_period_id
  FROM journal_entry
  WHERE organization_id = NEW.organization_id AND id = NEW.journal_entry_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCOUNTING_JOURNAL_NOT_FOUND';
  END IF;

  INSERT INTO account_balance (
    organization_id, period_id, ledger_account_id, debit_total, credit_total, balance
  )
  VALUES (
    NEW.organization_id, journal_period_id, NEW.ledger_account_id,
    NEW.debit, NEW.credit, NEW.debit - NEW.credit
  )
  ON CONFLICT (organization_id, period_id, ledger_account_id)
  DO UPDATE SET debit_total = account_balance.debit_total + EXCLUDED.debit_total,
                credit_total = account_balance.credit_total + EXCLUDED.credit_total,
                balance = account_balance.balance + EXCLUDED.balance;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_journal_line_updates_account_balance
  AFTER INSERT ON journal_line
  FOR EACH ROW EXECUTE FUNCTION accounting_apply_balance_for_line();

REVOKE INSERT, UPDATE, DELETE ON account_balance FROM tapcrm_app;
REVOKE EXECUTE ON FUNCTION accounting_apply_balance_for_line() FROM PUBLIC, tapcrm_app;
