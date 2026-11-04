-- Finance Phase 6: vendor master, bills, reimbursements, subscriptions,
-- purchase requests and immutable payment-run manifests.

CREATE TABLE finance_vendor (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id),
  legal_name text NOT NULL, display_name text NOT NULL, email citext, phone text,
  gstin text, pan text, currency text NOT NULL DEFAULT 'INR' CHECK (currency ~ '^[A-Z]{3}$'),
  payment_terms_days integer NOT NULL DEFAULT 30 CHECK (payment_terms_days BETWEEN 0 AND 365),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','blocked')),
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), FOREIGN KEY (organization_id,created_by) REFERENCES app_user(organization_id,id)
);

CREATE TABLE finance_vendor_bank_account (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), vendor_id uuid,
  bank_name text NOT NULL, account_reference text NOT NULL, ifsc text, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  proposed_by uuid NOT NULL, approved_by uuid, reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), FOREIGN KEY (organization_id,vendor_id) REFERENCES finance_vendor(organization_id,id),
  FOREIGN KEY (organization_id,proposed_by) REFERENCES app_user(organization_id,id), FOREIGN KEY (organization_id,approved_by) REFERENCES app_user(organization_id,id)
);

CREATE TABLE finance_payable_bill (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), vendor_id uuid NOT NULL,
  source_type text NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual','expense_claim','subscription','purchase_request')),
  source_id uuid, invoice_number text NOT NULL, issue_date date NOT NULL, due_date date NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'), subtotal numeric(18,2) NOT NULL CHECK (subtotal >= 0),
  tax_total numeric(18,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0), total numeric(18,2) NOT NULL CHECK (total > 0),
  gstin text, tds_section text, tds_rate numeric(7,4) NOT NULL DEFAULT 0 CHECK (tds_rate BETWEEN 0 AND 100), rcm boolean NOT NULL DEFAULT false,
  extraction_status text NOT NULL DEFAULT 'manual' CHECK (extraction_status IN ('manual','needs_review','confirmed')),
  status text NOT NULL DEFAULT 'needs_review' CHECK (status IN ('draft','needs_review','approved','partially_paid','paid','rejected','disputed')),
  duplicate_key text NOT NULL, artifact_filename text, artifact_relative_path text, artifact_mime_type text, artifact_sha256 text,
  journal_id uuid, created_by uuid NOT NULL, approved_by uuid, approved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), UNIQUE (organization_id,vendor_id,invoice_number), UNIQUE (organization_id,source_type,source_id), UNIQUE (organization_id,artifact_sha256),
  FOREIGN KEY (organization_id,vendor_id) REFERENCES finance_vendor(organization_id,id), FOREIGN KEY (organization_id,created_by) REFERENCES app_user(organization_id,id), FOREIGN KEY (organization_id,approved_by) REFERENCES app_user(organization_id,id)
);

CREATE TABLE finance_payable_subscription (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), vendor_id uuid NOT NULL,
  name text NOT NULL, amount numeric(18,2) NOT NULL CHECK (amount > 0), currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  recurrence text NOT NULL CHECK (recurrence IN ('monthly','quarterly','annual')), next_due_date date NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','cancelled')), owner_id uuid, reason text NOT NULL,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), FOREIGN KEY (organization_id,vendor_id) REFERENCES finance_vendor(organization_id,id), FOREIGN KEY (organization_id,owner_id) REFERENCES app_user(organization_id,id), FOREIGN KEY (organization_id,created_by) REFERENCES app_user(organization_id,id)
);

CREATE TABLE finance_purchase_request (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), vendor_id uuid,
  requester_id uuid NOT NULL, description text NOT NULL, amount numeric(18,2) NOT NULL CHECK (amount > 0), currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','matched')), reason text NOT NULL,
  approved_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), FOREIGN KEY (organization_id,vendor_id) REFERENCES finance_vendor(organization_id,id), FOREIGN KEY (organization_id,requester_id) REFERENCES app_user(organization_id,id), FOREIGN KEY (organization_id,approved_by) REFERENCES app_user(organization_id,id)
);

CREATE TABLE finance_payment_run (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), manifest jsonb NOT NULL,
  manifest_sha256 text NOT NULL, currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'), total numeric(18,2) NOT NULL CHECK (total > 0),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','executed','rejected')), created_by uuid NOT NULL,
  approved_by uuid, executed_by uuid, journal_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), UNIQUE (organization_id,manifest_sha256), FOREIGN KEY (organization_id,created_by) REFERENCES app_user(organization_id,id), FOREIGN KEY (organization_id,approved_by) REFERENCES app_user(organization_id,id), FOREIGN KEY (organization_id,executed_by) REFERENCES app_user(organization_id,id)
);

CREATE TABLE finance_payment_run_item (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), run_id uuid NOT NULL, bill_id uuid NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0), UNIQUE (organization_id,run_id,bill_id),
  FOREIGN KEY (organization_id,run_id) REFERENCES finance_payment_run(organization_id,id), FOREIGN KEY (organization_id,bill_id) REFERENCES finance_payable_bill(organization_id,id)
);

CREATE INDEX ix_finance_vendor_status ON finance_vendor(organization_id,status);
CREATE INDEX ix_finance_bill_status ON finance_payable_bill(organization_id,status,due_date);
CREATE INDEX ix_finance_run_status ON finance_payment_run(organization_id,status,created_at DESC);
CREATE TRIGGER trg_finance_vendor_updated BEFORE UPDATE ON finance_vendor FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_finance_vendor_bank_updated BEFORE UPDATE ON finance_vendor_bank_account FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_finance_bill_updated BEFORE UPDATE ON finance_payable_bill FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_finance_subscription_updated BEFORE UPDATE ON finance_payable_subscription FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_finance_purchase_request_updated BEFORE UPDATE ON finance_purchase_request FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_finance_payment_run_updated BEFORE UPDATE ON finance_payment_run FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT apply_tenant_rls('finance_vendor'); SELECT apply_tenant_rls('finance_vendor_bank_account'); SELECT apply_tenant_rls('finance_payable_bill');
SELECT apply_tenant_rls('finance_payable_subscription'); SELECT apply_tenant_rls('finance_purchase_request'); SELECT apply_tenant_rls('finance_payment_run'); SELECT apply_tenant_rls('finance_payment_run_item');
GRANT SELECT,INSERT,UPDATE ON finance_vendor,finance_vendor_bank_account,finance_payable_bill,finance_payable_subscription,finance_purchase_request,finance_payment_run,finance_payment_run_item TO tapcrm_app;
REVOKE DELETE ON finance_vendor,finance_vendor_bank_account,finance_payable_bill,finance_payable_subscription,finance_purchase_request,finance_payment_run,finance_payment_run_item FROM tapcrm_app;
