-- Phase 6 — tenant-scoped tax import/export metadata and immutable artifacts.
CREATE TABLE accounting_tax_artifact (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  kind            text NOT NULL CHECK (kind IN ('gstr1', 'gstr3b', 'gstr2b-import', 'tds-26q', 'tds-receivable-reconciliation')),
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  filename        text NOT NULL CHECK (length(trim(filename)) > 0),
  relative_path   text NOT NULL CHECK (length(trim(relative_path)) > 0),
  mime_type       text NOT NULL,
  size_bytes      bigint NOT NULL CHECK (size_bytes > 0),
  sha256          text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  row_count       integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, relative_path),
  CHECK (period_end >= period_start)
  ,FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id)
);

CREATE INDEX ix_accounting_tax_artifact_period
  ON accounting_tax_artifact (organization_id, kind, period_start, period_end, created_at DESC);

CREATE TABLE accounting_gstr2b_import (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  artifact_id     uuid NOT NULL,
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  original_filename text NOT NULL,
  status          text NOT NULL DEFAULT 'imported' CHECK (status IN ('imported', 'reconciled', 'failed')),
  row_count       integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  summary         jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_by     uuid NOT NULL,
  imported_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, artifact_id) REFERENCES accounting_tax_artifact (organization_id, id),
  CHECK (period_end >= period_start)
  ,FOREIGN KEY (organization_id, imported_by) REFERENCES app_user (organization_id, id)
);

CREATE INDEX ix_accounting_gstr2b_import_period
  ON accounting_gstr2b_import (organization_id, period_start, period_end, imported_at DESC);

CREATE TABLE accounting_gstr2b_line (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  import_id       uuid NOT NULL,
  supplier_gstin  text NOT NULL,
  invoice_number  text NOT NULL,
  invoice_date    date NOT NULL,
  taxable_value   numeric(20,2) NOT NULL CHECK (taxable_value >= 0),
  igst            numeric(20,2) NOT NULL DEFAULT 0 CHECK (igst >= 0),
  cgst            numeric(20,2) NOT NULL DEFAULT 0 CHECK (cgst >= 0),
  sgst            numeric(20,2) NOT NULL DEFAULT 0 CHECK (sgst >= 0),
  cess            numeric(20,2) NOT NULL DEFAULT 0 CHECK (cess >= 0),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, import_id, supplier_gstin, invoice_number, invoice_date),
  FOREIGN KEY (organization_id, import_id) REFERENCES accounting_gstr2b_import (organization_id, id) ON DELETE CASCADE
);

CREATE INDEX ix_accounting_gstr2b_line_import ON accounting_gstr2b_line (organization_id, import_id);

SELECT apply_tenant_rls('accounting_tax_artifact');
SELECT apply_tenant_rls('accounting_gstr2b_import');
SELECT apply_tenant_rls('accounting_gstr2b_line');

GRANT SELECT, INSERT ON accounting_tax_artifact TO tapcrm_app;
GRANT SELECT, INSERT, UPDATE ON accounting_gstr2b_import TO tapcrm_app;
GRANT SELECT, INSERT ON accounting_gstr2b_line TO tapcrm_app;
REVOKE UPDATE, DELETE ON accounting_tax_artifact FROM tapcrm_app;
REVOKE UPDATE, DELETE ON accounting_gstr2b_line FROM tapcrm_app;
