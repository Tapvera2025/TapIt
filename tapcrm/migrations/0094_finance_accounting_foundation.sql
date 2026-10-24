-- =====================================================================
-- 0094 — Finance / Accounting foundation (P6)
--
-- Phase 1 owns the chart of accounts and accounting periods. Journals,
-- journal lines and account balances are added in the ledger phase so no
-- partially implemented posting path can look authoritative.
-- =====================================================================

CREATE TABLE ledger_account (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  code                text NOT NULL CHECK (length(trim(code)) > 0),
  name                text NOT NULL CHECK (length(trim(name)) > 0),
  account_type        text NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  parent_account_id   uuid,
  normal_balance      text NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
  system_key          text,
  is_system_account   boolean NOT NULL DEFAULT false,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, system_key),
  FOREIGN KEY (organization_id, parent_account_id)
    REFERENCES ledger_account (organization_id, id),
  CHECK (system_key IS NULL OR length(trim(system_key)) > 0),
  CHECK ((account_type IN ('asset', 'expense') AND normal_balance = 'debit') OR
         (account_type IN ('liability', 'equity', 'income') AND normal_balance = 'credit'))
);

CREATE INDEX ix_ledger_account_parent
  ON ledger_account (organization_id, parent_account_id, code);

CREATE TABLE accounting_period (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id   uuid NOT NULL REFERENCES organization(id),
  financial_year    text NOT NULL CHECK (financial_year ~ '^[0-9]{4}-[0-9]{4}$'),
  period_start      date NOT NULL,
  period_end        date NOT NULL,
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closing', 'closed', 'reopened')),
  closed_by         uuid,
  closed_at         timestamptz,
  reopened_by       uuid,
  reopened_at       timestamptz,
  reopen_reason     text,
  last_posted_by    uuid,
  last_posted_at    timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, period_start),
  FOREIGN KEY (organization_id, closed_by) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, reopened_by) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, last_posted_by) REFERENCES app_user (organization_id, id),
  CHECK (period_end >= period_start),
  CHECK (period_end = (period_start + interval '1 month - 1 day')::date),
  CHECK ((status = 'closed' AND closed_by IS NOT NULL AND closed_at IS NOT NULL)
      OR status <> 'closed'),
  CHECK ((status = 'reopened' AND reopened_by IS NOT NULL AND reopened_at IS NOT NULL
          AND reopen_reason IS NOT NULL AND length(trim(reopen_reason)) > 0)
      OR status <> 'reopened')
);

CREATE INDEX ix_accounting_period_dates
  ON accounting_period (organization_id, period_start, period_end);

SELECT apply_tenant_rls('ledger_account');
SELECT apply_tenant_rls('accounting_period');

GRANT SELECT, INSERT, UPDATE ON ledger_account TO tapcrm_app;
REVOKE DELETE ON ledger_account FROM tapcrm_app;
GRANT SELECT, INSERT, UPDATE ON accounting_period TO tapcrm_app;
REVOKE DELETE ON accounting_period FROM tapcrm_app;
