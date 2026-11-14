-- Phase 9 hardening: project account balances in base currency and provide
-- idempotency for FX revaluation requests.

ALTER TABLE finance_fx_revaluation_run
  ADD COLUMN IF NOT EXISTS idempotency_key text;
UPDATE finance_fx_revaluation_run
SET idempotency_key = id::text
WHERE idempotency_key IS NULL;
ALTER TABLE finance_fx_revaluation_run ALTER COLUMN idempotency_key SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_finance_fx_revaluation_idempotency
  ON finance_fx_revaluation_run(organization_id, idempotency_key);

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
    NEW.base_debit, NEW.base_credit, NEW.base_debit - NEW.base_credit
  )
  ON CONFLICT (organization_id, period_id, ledger_account_id)
  DO UPDATE SET debit_total = account_balance.debit_total + EXCLUDED.debit_total,
                credit_total = account_balance.credit_total + EXCLUDED.credit_total,
                balance = account_balance.balance + EXCLUDED.balance;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION accounting_apply_balance_for_line() FROM PUBLIC, tapcrm_app;
