-- =====================================================================
-- 0061 — My Todo
--
-- Personal todo management available to every authenticated user.
-- =====================================================================

CREATE TABLE my_todo (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  title            text NOT NULL,
  description      text,
  priority         text NOT NULL DEFAULT 'medium'
                     CHECK (priority IN ('low', 'medium', 'high')),
  scheduled_date   date,
  due_time         text,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'completed')),
  completed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id)
);

-- Tenant RLS (TN-2, PG-4, CI-33)
SELECT apply_tenant_rls('my_todo');

-- updated_at trigger
CREATE TRIGGER trg_my_todo_updated BEFORE UPDATE ON my_todo
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON my_todo TO tapcrm_app;

-- Indexes (TECH.md IX-1: leading with organization_id)
CREATE INDEX ix_my_todo_user_scheduled
  ON my_todo (organization_id, user_id, scheduled_date, status);

CREATE INDEX ix_my_todo_user_created
  ON my_todo (organization_id, user_id, created_at DESC, id DESC);
