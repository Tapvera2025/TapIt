-- 0107 — Complete Phase 2 contract lifecycle, usage banks and evidence.

ALTER TABLE finance_contract
  ADD COLUMN IF NOT EXISTS renewal_term_months integer CHECK (renewal_term_months IS NULL OR renewal_term_months BETWEEN 1 AND 120),
  ADD COLUMN IF NOT EXISTS auto_renew boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS renewal_notice_days integer NOT NULL DEFAULT 30 CHECK (renewal_notice_days BETWEEN 0 AND 3650),
  ADD COLUMN IF NOT EXISTS retainer_quantity numeric(18,4) CHECK (retainer_quantity IS NULL OR retainer_quantity >= 0),
  ADD COLUMN IF NOT EXISTS retainer_unit text CHECK (retainer_unit IS NULL OR retainer_unit IN ('hours','units','amount')),
  ADD COLUMN IF NOT EXISTS overage_rate numeric(18,2) CHECK (overage_rate IS NULL OR overage_rate >= 0),
  ADD COLUMN IF NOT EXISTS signed_status text NOT NULL DEFAULT 'not_required' CHECK (signed_status IN ('not_required','pending','signed','expired'));

CREATE TABLE finance_contract_usage (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id),
  contract_id uuid NOT NULL, event_id uuid, usage_date date NOT NULL, unit text NOT NULL,
  quantity numeric(18,4) NOT NULL CHECK (quantity > 0), unit_rate numeric(18,2) NOT NULL CHECK (unit_rate >= 0),
  amount numeric(18,2) NOT NULL CHECK (amount >= 0), source_type text NOT NULL, source_id uuid NOT NULL,
  idempotency_key text NOT NULL, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), UNIQUE (organization_id,idempotency_key),
  FOREIGN KEY (organization_id,contract_id) REFERENCES finance_contract(organization_id,id),
  FOREIGN KEY (organization_id,event_id) REFERENCES finance_billable_event(organization_id,id),
  FOREIGN KEY (organization_id,created_by) REFERENCES app_user(organization_id,id)
);

CREATE TABLE finance_contract_document (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id),
  contract_id uuid NOT NULL, original_filename text NOT NULL, stored_filename text NOT NULL,
  mime_type text NOT NULL, size_bytes bigint NOT NULL CHECK (size_bytes > 0), relative_path text NOT NULL,
  sha256 text NOT NULL, reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  uploaded_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), UNIQUE (organization_id,relative_path),
  FOREIGN KEY (organization_id,contract_id) REFERENCES finance_contract(organization_id,id),
  FOREIGN KEY (organization_id,uploaded_by) REFERENCES app_user(organization_id,id)
);

CREATE INDEX ix_finance_contract_usage_contract ON finance_contract_usage(organization_id,contract_id,usage_date);
CREATE INDEX ix_finance_contract_document_contract ON finance_contract_document(organization_id,contract_id,created_at DESC);

SELECT apply_tenant_rls('finance_contract_usage');
SELECT apply_tenant_rls('finance_contract_document');
GRANT SELECT, INSERT ON finance_contract_usage, finance_contract_document TO tapcrm_app;
REVOKE DELETE, UPDATE ON finance_contract_usage, finance_contract_document FROM tapcrm_app;
