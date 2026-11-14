-- 0111 — Finance Phase 3: immutable invoice drafts and human release.
-- Draft creation is automated; issue/send is only possible with a one-time
-- server-issued review token bound to the exact manifest fingerprint.

CREATE TABLE finance_invoice_draft (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id),
  client_id uuid NOT NULL, legal_entity_id uuid NOT NULL, contract_id uuid,
  period_start date NOT NULL, period_end date NOT NULL, currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','cancelled')),
  subtotal numeric(18,2) NOT NULL CHECK (subtotal >= 0), tax_total numeric(18,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  discount_total numeric(18,2) NOT NULL DEFAULT 0 CHECK (discount_total >= 0), total numeric(18,2) NOT NULL CHECK (total >= 0),
  manifest jsonb NOT NULL, manifest_fingerprint text NOT NULL CHECK (length(manifest_fingerprint) = 64), version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  review_token_hash text, review_token_expires_at timestamptz, reviewed_by uuid, reviewed_at timestamptz,
  issued_invoice_id uuid, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), UNIQUE (organization_id,manifest_fingerprint),
  FOREIGN KEY (organization_id,client_id) REFERENCES client(organization_id,id),
  FOREIGN KEY (organization_id,legal_entity_id) REFERENCES finance_legal_entity(organization_id,id),
  FOREIGN KEY (organization_id,contract_id) REFERENCES finance_contract(organization_id,id),
  FOREIGN KEY (organization_id,created_by) REFERENCES app_user(organization_id,id),
  FOREIGN KEY (organization_id,reviewed_by) REFERENCES app_user(organization_id,id),
  CHECK (period_end >= period_start), CHECK (total = subtotal + tax_total - discount_total)
);

CREATE TABLE finance_invoice (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), draft_id uuid NOT NULL,
  invoice_number text NOT NULL, client_id uuid NOT NULL, legal_entity_id uuid NOT NULL, contract_id uuid,
  invoice_date date NOT NULL, due_date date NOT NULL, currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  subtotal numeric(18,2) NOT NULL, tax_total numeric(18,2) NOT NULL, discount_total numeric(18,2) NOT NULL, total numeric(18,2) NOT NULL,
  manifest jsonb NOT NULL, manifest_fingerprint text NOT NULL CHECK (length(manifest_fingerprint) = 64), journal_id uuid,
  pdf_relative_path text, pdf_sha256 text,
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','voided')), issued_by uuid NOT NULL, issued_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), UNIQUE (organization_id,invoice_number), UNIQUE (organization_id,draft_id), UNIQUE (organization_id,manifest_fingerprint),
  FOREIGN KEY (organization_id,draft_id) REFERENCES finance_invoice_draft(organization_id,id),
  FOREIGN KEY (organization_id,client_id) REFERENCES client(organization_id,id),
  FOREIGN KEY (organization_id,legal_entity_id) REFERENCES finance_legal_entity(organization_id,id),
  FOREIGN KEY (organization_id,contract_id) REFERENCES finance_contract(organization_id,id),
  FOREIGN KEY (organization_id,issued_by) REFERENCES app_user(organization_id,id)
);

CREATE TABLE finance_invoice_delivery (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), invoice_id uuid NOT NULL,
  recipient text NOT NULL, subject text NOT NULL, status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0), created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz,
  UNIQUE (organization_id,invoice_id), FOREIGN KEY (organization_id,invoice_id) REFERENCES finance_invoice(organization_id,id)
);

CREATE TABLE finance_invoice_batch_manifest (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), draft_ids uuid[] NOT NULL,
  manifest jsonb NOT NULL, manifest_fingerprint text NOT NULL CHECK (length(manifest_fingerprint) = 64),
  token_hash text NOT NULL, token_expires_at timestamptz NOT NULL, consumed_at timestamptz, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), UNIQUE (organization_id,manifest_fingerprint),
  FOREIGN KEY (organization_id,created_by) REFERENCES app_user(organization_id,id)
);

CREATE INDEX ix_finance_invoice_draft_period ON finance_invoice_draft(organization_id,client_id,contract_id,period_start,period_end,status);
CREATE INDEX ix_finance_invoice_status ON finance_invoice(organization_id,invoice_date,status);
CREATE INDEX ix_finance_invoice_delivery_status ON finance_invoice_delivery(organization_id,status,created_at);

CREATE TRIGGER trg_finance_invoice_draft_updated BEFORE UPDATE ON finance_invoice_draft FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT apply_tenant_rls('finance_invoice_draft'); SELECT apply_tenant_rls('finance_invoice');
SELECT apply_tenant_rls('finance_invoice_delivery'); SELECT apply_tenant_rls('finance_invoice_batch_manifest');
GRANT SELECT, INSERT, UPDATE ON finance_invoice_draft, finance_invoice, finance_invoice_delivery, finance_invoice_batch_manifest TO tapcrm_app;
REVOKE DELETE ON finance_invoice_draft, finance_invoice, finance_invoice_delivery, finance_invoice_batch_manifest FROM tapcrm_app;
