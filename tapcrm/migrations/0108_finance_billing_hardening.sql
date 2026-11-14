-- 0108 — Finance Phase 1/2 hardening: usage allocation and auditable pricing.
ALTER TABLE finance_contract_usage
  ADD COLUMN IF NOT EXISTS retainer_quantity_applied numeric(18,4) NOT NULL DEFAULT 0 CHECK (retainer_quantity_applied >= 0),
  ADD COLUMN IF NOT EXISTS overage_quantity numeric(18,4) NOT NULL DEFAULT 0 CHECK (overage_quantity >= 0),
  ADD COLUMN IF NOT EXISTS overage_rate_applied numeric(18,2) NOT NULL DEFAULT 0 CHECK (overage_rate_applied >= 0),
  ADD COLUMN IF NOT EXISTS is_overage boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS ix_finance_contract_usage_overage
  ON finance_contract_usage(organization_id, contract_id, is_overage, usage_date);
