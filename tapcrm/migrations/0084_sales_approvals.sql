-- Sales v1.1 R2 — Approval requests + decisions (R2 plan step 2.3).
--
-- `dimensions` captures the independent approval axes evaluated against
-- the actor's authority (R-APP-01): value, discount, margin, non-standard
-- terms, advance exceptions, contract-required policy. Each key maps to
-- a verdict shape like `{status: 'exceeds', threshold: ...}` so the UI
-- can render exactly what is unmet.
--
-- At most one `state='pending'` approval per deal is enforced in the
-- service layer; the partial unique index below gives the DB a backstop.

CREATE TABLE approval_request (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  deal_id             uuid NOT NULL,
  commercials_id      uuid NOT NULL,
  dimensions          jsonb NOT NULL,
  requested_by        uuid NOT NULL,
  requested_at        timestamptz NOT NULL DEFAULT now(),
  current_approver_id uuid,
  sla_due_at          timestamptz NOT NULL,
  escalation_count    integer NOT NULL DEFAULT 0,
  state               text NOT NULL DEFAULT 'pending'
                        CHECK (state IN ('pending','approved','rejected','returned','escalated','cancelled','invalidated')),
  blocked_reason      text,
  decided_at          timestamptz,
  decided_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, deal_id)             REFERENCES deal (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, commercials_id)      REFERENCES commercials (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, requested_by)        REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, current_approver_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, decided_by)          REFERENCES app_user (organization_id, id),
  CHECK (decided_at IS NULL OR state IN ('approved','rejected','returned','cancelled','invalidated')),
  CHECK (decided_by IS NULL OR decided_at IS NOT NULL)
);

CREATE INDEX ix_approval_org_state_sla  ON approval_request (organization_id, state, sla_due_at);
CREATE INDEX ix_approval_org_deal       ON approval_request (organization_id, deal_id);
CREATE INDEX ix_approval_org_approver   ON approval_request (organization_id, current_approver_id) WHERE state = 'pending';
CREATE UNIQUE INDEX uniq_approval_pending_per_deal
  ON approval_request (organization_id, deal_id)
  WHERE state IN ('pending','escalated','returned');

SELECT apply_tenant_rls('approval_request');
CREATE TRIGGER trg_approval_request_updated BEFORE UPDATE ON approval_request FOR EACH ROW EXECUTE FUNCTION set_updated_at();
GRANT SELECT, INSERT, UPDATE ON approval_request TO tapcrm_app;

CREATE TABLE approval_decision (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  request_id          uuid NOT NULL,
  actor_id            uuid NOT NULL,
  verdict             text NOT NULL CHECK (verdict IN ('approve','reject','return')),
  comment             text,
  decided_at          timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, request_id) REFERENCES approval_request (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, actor_id)   REFERENCES app_user (organization_id, id)
);
CREATE INDEX ix_approval_decision_request ON approval_decision (organization_id, request_id);

SELECT apply_tenant_rls('approval_decision');
GRANT SELECT, INSERT ON approval_decision TO tapcrm_app;
