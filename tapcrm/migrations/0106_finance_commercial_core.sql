-- =====================================================================
-- 0106 — Finance commercial core (Phase 2)
-- Billing profiles, versioned rate cards, contracts, schedules and billable
-- events. Invoice issue/send and payment movement remain later phases.
-- =====================================================================

CREATE TABLE finance_client_billing_profile (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id),
  client_id uuid NOT NULL, legal_entity_id uuid NOT NULL, currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  timezone text NOT NULL CHECK (length(btrim(timezone)) BETWEEN 1 AND 80),
  payment_terms_days integer NOT NULL DEFAULT 0 CHECK (payment_terms_days BETWEEN 0 AND 3650),
  credit_limit numeric(18,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  credit_control text NOT NULL DEFAULT 'advisory' CHECK (credit_control IN ('advisory','blocking')),
  po_required boolean NOT NULL DEFAULT false, billing_contact_name text,
  billing_contact_email citext, billing_contact_phone text,
  tax_policy_status text NOT NULL DEFAULT 'pending_review' CHECK (tax_policy_status IN ('pending_review','configured')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0), created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), UNIQUE (organization_id,client_id),
  FOREIGN KEY (organization_id,client_id) REFERENCES client(organization_id,id),
  FOREIGN KEY (organization_id,legal_entity_id) REFERENCES finance_legal_entity(organization_id,id),
  FOREIGN KEY (organization_id,created_by) REFERENCES app_user(organization_id,id),
  CHECK (billing_contact_name IS NOT NULL OR billing_contact_email IS NOT NULL OR billing_contact_phone IS NOT NULL)
);

CREATE TABLE finance_rate_card (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160), description text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), UNIQUE (organization_id,name),
  FOREIGN KEY (organization_id,created_by) REFERENCES app_user(organization_id,id)
);

CREATE TABLE finance_rate_card_version (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), rate_card_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0), effective_from date NOT NULL, effective_to date,
  approved_by uuid, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), UNIQUE (organization_id,rate_card_id,version_number),
  FOREIGN KEY (organization_id,rate_card_id) REFERENCES finance_rate_card(organization_id,id),
  FOREIGN KEY (organization_id,approved_by) REFERENCES app_user(organization_id,id),
  FOREIGN KEY (organization_id,created_by) REFERENCES app_user(organization_id,id),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE finance_rate_card_line (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), rate_card_version_id uuid NOT NULL,
  service_key text NOT NULL CHECK (length(btrim(service_key)) BETWEEN 1 AND 160), pricing_model text NOT NULL CHECK (pricing_model IN ('hourly','monthly','fixed','retainer')),
  role_code text, project_type text, unit_rate numeric(18,2) NOT NULL CHECK (unit_rate >= 0), currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,rate_card_version_id) REFERENCES finance_rate_card_version(organization_id,id) ON DELETE CASCADE
);

CREATE TABLE finance_contract (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), client_id uuid NOT NULL, legal_entity_id uuid NOT NULL,
  contract_number text NOT NULL CHECK (length(btrim(contract_number)) BETWEEN 1 AND 80), title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'), billing_model text NOT NULL CHECK (billing_model IN ('fixed','hourly','monthly','retainer','milestone','percentage','hybrid')),
  start_date date NOT NULL, end_date date, status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','expired','cancelled')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0), created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), UNIQUE (organization_id,contract_number),
  FOREIGN KEY (organization_id,client_id) REFERENCES client(organization_id,id), FOREIGN KEY (organization_id,legal_entity_id) REFERENCES finance_legal_entity(organization_id,id),
  FOREIGN KEY (organization_id,created_by) REFERENCES app_user(organization_id,id), CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE TABLE finance_contract_amendment (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), contract_id uuid NOT NULL, version_number integer NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000), terms_snapshot jsonb NOT NULL, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), UNIQUE (organization_id,contract_id,version_number), FOREIGN KEY (organization_id,contract_id) REFERENCES finance_contract(organization_id,id),
  FOREIGN KEY (organization_id,created_by) REFERENCES app_user(organization_id,id)
);

CREATE TABLE finance_billing_schedule (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), contract_id uuid NOT NULL,
  recurrence text NOT NULL CHECK (recurrence IN ('once','monthly','quarterly','annual')), local_timezone text NOT NULL,
  billing_day smallint CHECK (billing_day BETWEEN 1 AND 31), next_bill_date date NOT NULL, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','cancelled')),
  generation_key text NOT NULL, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), UNIQUE (organization_id,generation_key), FOREIGN KEY (organization_id,contract_id) REFERENCES finance_contract(organization_id,id), FOREIGN KEY (organization_id,created_by) REFERENCES app_user(organization_id,id)
);

CREATE TABLE finance_billable_event (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), client_id uuid NOT NULL, contract_id uuid,
  source_type text NOT NULL, source_id uuid NOT NULL, service_key text NOT NULL, event_date date NOT NULL, currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  quantity numeric(18,4) NOT NULL CHECK (quantity > 0), amount numeric(18,2) NOT NULL CHECK (amount >= 0), approved_by uuid, state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected','partially_billed','billed')),
  billed_quantity numeric(18,4) NOT NULL DEFAULT 0 CHECK (billed_quantity >= 0 AND billed_quantity <= quantity), idempotency_key text NOT NULL,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id,id), UNIQUE (organization_id,idempotency_key),
  FOREIGN KEY (organization_id,client_id) REFERENCES client(organization_id,id), FOREIGN KEY (organization_id,contract_id) REFERENCES finance_contract(organization_id,id), FOREIGN KEY (organization_id,approved_by) REFERENCES app_user(organization_id,id), FOREIGN KEY (organization_id,created_by) REFERENCES app_user(organization_id,id)
);

CREATE INDEX ix_finance_contract_client ON finance_contract(organization_id,client_id,status);
CREATE INDEX ix_finance_billable_event_state ON finance_billable_event(organization_id,state,event_date);
CREATE INDEX ix_finance_schedule_next ON finance_billing_schedule(organization_id,status,next_bill_date);

CREATE TRIGGER trg_finance_profile_updated BEFORE UPDATE ON finance_client_billing_profile FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_finance_rate_card_updated BEFORE UPDATE ON finance_rate_card FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_finance_contract_updated BEFORE UPDATE ON finance_contract FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_finance_schedule_updated BEFORE UPDATE ON finance_billing_schedule FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_finance_event_updated BEFORE UPDATE ON finance_billable_event FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT apply_tenant_rls('finance_client_billing_profile'); SELECT apply_tenant_rls('finance_rate_card'); SELECT apply_tenant_rls('finance_rate_card_version');
SELECT apply_tenant_rls('finance_rate_card_line'); SELECT apply_tenant_rls('finance_contract'); SELECT apply_tenant_rls('finance_contract_amendment');
SELECT apply_tenant_rls('finance_billing_schedule'); SELECT apply_tenant_rls('finance_billable_event');

GRANT SELECT, INSERT, UPDATE ON finance_client_billing_profile, finance_rate_card, finance_contract, finance_billing_schedule, finance_billable_event TO tapcrm_app;
GRANT SELECT, INSERT ON finance_rate_card_version, finance_rate_card_line, finance_contract_amendment TO tapcrm_app;
REVOKE DELETE ON finance_client_billing_profile, finance_rate_card, finance_rate_card_version, finance_rate_card_line, finance_contract, finance_contract_amendment, finance_billing_schedule, finance_billable_event FROM tapcrm_app;
