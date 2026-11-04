-- 0117 — Finance Phase 5 foundation: receivable balances and collections.

ALTER TABLE finance_invoice
  ADD COLUMN IF NOT EXISTS receivable_status text NOT NULL DEFAULT 'open'
    CHECK (receivable_status IN ('open','partially_paid','paid','overdue','disputed','written_off'));

CREATE TABLE finance_receivable_collection_activity (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  client_id uuid NOT NULL,
  invoice_id uuid,
  activity_type text NOT NULL CHECK (activity_type IN ('dunning','call','email','promise_to_pay','dispute','write_off')),
  channel text CHECK (channel IS NULL OR channel IN ('in_app','email','phone','manual')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','scheduled','completed','cancelled')),
  scheduled_for timestamptz,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  notes text,
  created_by uuid NOT NULL,
  completed_by uuid,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,client_id) REFERENCES client(organization_id,id),
  FOREIGN KEY (organization_id,invoice_id) REFERENCES finance_invoice(organization_id,id),
  FOREIGN KEY (organization_id,created_by) REFERENCES app_user(organization_id,id),
  FOREIGN KEY (organization_id,completed_by) REFERENCES app_user(organization_id,id)
);

CREATE TABLE finance_receivable_dunning_schedule (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  client_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  cadence_days integer NOT NULL DEFAULT 7 CHECK (cadence_days BETWEEN 1 AND 365),
  next_run_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,client_id),
  FOREIGN KEY (organization_id,client_id) REFERENCES client(organization_id,id),
  FOREIGN KEY (organization_id,updated_by) REFERENCES app_user(organization_id,id)
);

CREATE TABLE finance_receivable_write_off (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  invoice_id uuid NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected','posted')),
  proposed_by uuid NOT NULL,
  approved_by uuid,
  journal_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  FOREIGN KEY (organization_id,invoice_id) REFERENCES finance_invoice(organization_id,id),
  FOREIGN KEY (organization_id,proposed_by) REFERENCES app_user(organization_id,id),
  FOREIGN KEY (organization_id,approved_by) REFERENCES app_user(organization_id,id)
);

CREATE INDEX ix_finance_receivable_activity_client
  ON finance_receivable_collection_activity(organization_id,client_id,created_at DESC);
CREATE INDEX ix_finance_receivable_activity_invoice
  ON finance_receivable_collection_activity(organization_id,invoice_id,created_at DESC);
CREATE INDEX ix_finance_receivable_dunning_due
  ON finance_receivable_dunning_schedule(organization_id,enabled,next_run_at);
CREATE INDEX ix_finance_receivable_write_off_invoice
  ON finance_receivable_write_off(organization_id,invoice_id,status);

CREATE TRIGGER trg_finance_receivable_dunning_updated
  BEFORE UPDATE ON finance_receivable_dunning_schedule FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_finance_receivable_write_off_updated
  BEFORE UPDATE ON finance_receivable_write_off FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT apply_tenant_rls('finance_receivable_collection_activity');
SELECT apply_tenant_rls('finance_receivable_dunning_schedule');
SELECT apply_tenant_rls('finance_receivable_write_off');

GRANT SELECT, INSERT, UPDATE ON finance_invoice TO tapcrm_app;
GRANT SELECT, INSERT, UPDATE ON finance_receivable_collection_activity,
  finance_receivable_dunning_schedule, finance_receivable_write_off TO tapcrm_app;
REVOKE DELETE ON finance_receivable_collection_activity,
  finance_receivable_dunning_schedule, finance_receivable_write_off,
  payment_allocation FROM tapcrm_app;

CREATE OR REPLACE FUNCTION prevent_payment_allocation_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'payment_allocation rows are immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_allocation_immutable ON payment_allocation;
CREATE TRIGGER trg_payment_allocation_immutable
  BEFORE UPDATE OR DELETE ON payment_allocation
  FOR EACH ROW EXECUTE FUNCTION prevent_payment_allocation_mutation();
