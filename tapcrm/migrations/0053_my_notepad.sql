-- =====================================================================
-- 0053 — My Notepad
--
-- Personal notepad available to every authenticated user.
-- Current note and historical snapshots.
-- =====================================================================

CREATE TABLE my_notepad (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  content          text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, user_id),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id)
);

CREATE TABLE my_notepad_history (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  content          text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id)
);

-- Tenant RLS (TN-2, PG-4, CI-33)
SELECT apply_tenant_rls('my_notepad');
SELECT apply_tenant_rls('my_notepad_history');

-- updated_at trigger
CREATE TRIGGER trg_my_notepad_updated BEFORE UPDATE ON my_notepad
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON my_notepad TO tapcrm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON my_notepad_history TO tapcrm_app;

-- Indexes (TECH.md IX-1: leading with organization_id)
CREATE INDEX ix_my_notepad_history_user_created
  ON my_notepad_history (organization_id, user_id, created_at DESC, id DESC);
