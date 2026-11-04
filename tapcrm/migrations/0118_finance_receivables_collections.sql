-- 0118 — Finance Phase 5: collections, disputes, promises, tasks and reminders.

CREATE TABLE finance_receivable_dispute (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id),
  invoice_id uuid NOT NULL, status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','under_review','resolved','rejected')),
  hold_collections boolean NOT NULL DEFAULT true, reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  resolution text, created_by uuid NOT NULL, resolved_by uuid, resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), FOREIGN KEY (organization_id,invoice_id) REFERENCES finance_invoice(organization_id,id),
  FOREIGN KEY (organization_id,created_by) REFERENCES app_user(organization_id,id), FOREIGN KEY (organization_id,resolved_by) REFERENCES app_user(organization_id,id)
);

CREATE TABLE finance_receivable_promise (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), invoice_id uuid NOT NULL,
  promised_amount numeric(18,2) NOT NULL CHECK (promised_amount > 0), promised_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','kept','broken','cancelled')), reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  created_by uuid NOT NULL, resolved_by uuid, resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), FOREIGN KEY (organization_id,invoice_id) REFERENCES finance_invoice(organization_id,id),
  FOREIGN KEY (organization_id,created_by) REFERENCES app_user(organization_id,id), FOREIGN KEY (organization_id,resolved_by) REFERENCES app_user(organization_id,id)
);

CREATE TABLE finance_receivable_collection_task (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), client_id uuid NOT NULL, invoice_id uuid,
  assigned_to uuid, task_type text NOT NULL CHECK (task_type IN ('reminder','call','review','promise_follow_up')), status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','completed','cancelled')),
  due_at timestamptz NOT NULL, title text NOT NULL, reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000), completed_by uuid, completed_at timestamptz, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id), FOREIGN KEY (organization_id,client_id) REFERENCES client(organization_id,id), FOREIGN KEY (organization_id,invoice_id) REFERENCES finance_invoice(organization_id,id),
  FOREIGN KEY (organization_id,assigned_to) REFERENCES app_user(organization_id,id), FOREIGN KEY (organization_id,completed_by) REFERENCES app_user(organization_id,id), FOREIGN KEY (organization_id,created_by) REFERENCES app_user(organization_id,id)
);

CREATE TABLE finance_receivable_reminder (
  id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organization(id), invoice_id uuid NOT NULL, reminder_date date NOT NULL,
  local_timezone text NOT NULL, status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','skipped','failed')), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,invoice_id,reminder_date), FOREIGN KEY (organization_id,invoice_id) REFERENCES finance_invoice(organization_id,id)
);

CREATE INDEX ix_receivable_dispute_invoice ON finance_receivable_dispute(organization_id,invoice_id,status);
CREATE INDEX ix_receivable_promise_due ON finance_receivable_promise(organization_id,status,promised_for);
CREATE INDEX ix_receivable_task_queue ON finance_receivable_collection_task(organization_id,status,due_at);
CREATE INDEX ix_receivable_reminder_status ON finance_receivable_reminder(organization_id,status,created_at);
CREATE TRIGGER trg_receivable_dispute_updated BEFORE UPDATE ON finance_receivable_dispute FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_receivable_promise_updated BEFORE UPDATE ON finance_receivable_promise FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_receivable_task_updated BEFORE UPDATE ON finance_receivable_collection_task FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT apply_tenant_rls('finance_receivable_dispute'); SELECT apply_tenant_rls('finance_receivable_promise'); SELECT apply_tenant_rls('finance_receivable_collection_task'); SELECT apply_tenant_rls('finance_receivable_reminder');
GRANT SELECT, INSERT, UPDATE ON finance_receivable_dispute, finance_receivable_promise, finance_receivable_collection_task, finance_receivable_reminder TO tapcrm_app;
REVOKE DELETE ON finance_receivable_dispute, finance_receivable_promise, finance_receivable_collection_task, finance_receivable_reminder FROM tapcrm_app;
