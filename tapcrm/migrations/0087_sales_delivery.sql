-- Sales v1.1 R2 — Delivery brief + project link (R2 plan step 2.6).
--
-- One brief per deal (R-DEL-01). Accepting the brief creates exactly one
-- project through an idempotent service event (R-DEL-04). Multi-project
-- allocation is deferred — R2 is single-project; a per-project
-- allocation sub-table lands in R3.

CREATE TABLE delivery_brief (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid NOT NULL REFERENCES organization(id),
  deal_id            uuid NOT NULL,
  commercials_id     uuid NOT NULL,
  state              text NOT NULL DEFAULT 'draft'
                       CHECK (state IN ('draft','submitted','changes_requested','accepted','cancelled')),
  content            jsonb NOT NULL DEFAULT '{}'::jsonb,
  project_id         uuid,
  submitted_at       timestamptz,
  reviewed_at        timestamptz,
  reviewed_by        uuid,
  accepted_at        timestamptz,
  accepted_by        uuid,
  cancelled_at       timestamptz,
  cancelled_reason   text,
  change_notes       text,
  created_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, id),
  UNIQUE (organization_id, deal_id),
  FOREIGN KEY (organization_id, deal_id)        REFERENCES deal (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, commercials_id) REFERENCES commercials (organization_id, id),
  FOREIGN KEY (organization_id, project_id)     REFERENCES project (organization_id, id),
  FOREIGN KEY (organization_id, reviewed_by)    REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, accepted_by)    REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, created_by)     REFERENCES app_user (organization_id, id),
  CHECK (accepted_at IS NULL OR state = 'accepted'),
  CHECK (accepted_at IS NULL OR project_id IS NOT NULL),
  CHECK (project_id IS NULL OR state = 'accepted'),
  CHECK (submitted_at IS NULL OR state IN ('submitted','changes_requested','accepted','cancelled')),
  CHECK (cancelled_at IS NULL OR state = 'cancelled')
);

CREATE INDEX ix_brief_org_state     ON delivery_brief (organization_id, state);
CREATE INDEX ix_brief_org_project   ON delivery_brief (organization_id, project_id) WHERE project_id IS NOT NULL;

SELECT apply_tenant_rls('delivery_brief');
CREATE TRIGGER trg_delivery_brief_updated BEFORE UPDATE ON delivery_brief FOR EACH ROW EXECUTE FUNCTION set_updated_at();
GRANT SELECT, INSERT, UPDATE ON delivery_brief TO tapcrm_app;
