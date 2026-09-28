-- =====================================================================
-- 0043 — Audit legal holds (AU-8)
--
-- Holds are first-class tenant records. They are deliberately separate from
-- audit_entry: applying or releasing a hold never rewrites append-only audit
-- history, and future retention can use the active-hold predicate safely.
-- =====================================================================

CREATE TABLE audit_legal_hold (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  hold_type       text NOT NULL CHECK (hold_type IN ('user', 'client', 'date-range')),
  target_id       uuid,
  starts_at       timestamptz,
  ends_at         timestamptz,
  reason          text NOT NULL CHECK (length(btrim(reason)) > 0),
  placed_by       uuid NOT NULL,
  placed_at       timestamptz NOT NULL DEFAULT now(),
  released_by     uuid,
  released_at     timestamptz,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released')),
  CONSTRAINT audit_legal_hold_target_fk
    FOREIGN KEY (organization_id, placed_by) REFERENCES app_user(organization_id, id),
  CONSTRAINT audit_legal_hold_released_by_fk
    FOREIGN KEY (organization_id, released_by) REFERENCES app_user(organization_id, id),
  CONSTRAINT audit_legal_hold_shape CHECK (
    (hold_type IN ('user', 'client') AND target_id IS NOT NULL AND starts_at IS NULL AND ends_at IS NULL)
    OR
    (hold_type = 'date-range' AND target_id IS NULL AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at >= starts_at)
  ),
  CONSTRAINT audit_legal_hold_release_shape CHECK (
    (status = 'active' AND released_by IS NULL AND released_at IS NULL)
    OR
    (status = 'released' AND released_by IS NOT NULL AND released_at IS NOT NULL)
  )
);

SELECT apply_tenant_rls('audit_legal_hold');

GRANT SELECT, INSERT, UPDATE ON audit_legal_hold TO tapcrm_app;
REVOKE DELETE ON audit_legal_hold FROM tapcrm_app;

CREATE INDEX ix_audit_legal_hold_active
  ON audit_legal_hold (organization_id, status, hold_type);
CREATE INDEX ix_audit_legal_hold_target
  ON audit_legal_hold (organization_id, target_id)
  WHERE status = 'active' AND target_id IS NOT NULL;
CREATE INDEX ix_audit_legal_hold_dates
  ON audit_legal_hold (organization_id, starts_at, ends_at)
  WHERE status = 'active' AND hold_type = 'date-range';

COMMENT ON TABLE audit_legal_hold IS
  'AU-8 first-class legal holds. Active holds protect matching audit entries; releasing one hold never changes other holds.';
