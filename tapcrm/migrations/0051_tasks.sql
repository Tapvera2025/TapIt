-- =====================================================================
-- 0051 — Tasks (Global Company Task Management)
--
-- Task and task_assignee tables, tenant RLS, indexes, and triggers.
-- =====================================================================

CREATE TABLE task (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  title            text NOT NULL,
  description      text,
  project_id       uuid,
  priority         text NOT NULL DEFAULT 'medium'
                     CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  due_date         timestamptz,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id)
);

CREATE TABLE task_assignee (
  organization_id  uuid NOT NULL REFERENCES organization(id),
  task_id          uuid NOT NULL,
  user_id          uuid NOT NULL,
  assigned_at      timestamptz NOT NULL DEFAULT now(),
  assigned_by      uuid NOT NULL,
  PRIMARY KEY (organization_id, task_id, user_id),
  FOREIGN KEY (organization_id, task_id) REFERENCES task (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, assigned_by) REFERENCES app_user (organization_id, id)
);

-- Tenant RLS (TN-2, PG-4, CI-33)
SELECT apply_tenant_rls('task');
SELECT apply_tenant_rls('task_assignee');

-- updated_at trigger
CREATE TRIGGER trg_task_updated BEFORE UPDATE ON task
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON task TO tapcrm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON task_assignee TO tapcrm_app;

-- Indexes (TECH.md IX-1: leading with organization_id)
CREATE INDEX ix_task_org_status     ON task (organization_id, status);
CREATE INDEX ix_task_org_priority   ON task (organization_id, priority);
CREATE INDEX ix_task_org_due_date   ON task (organization_id, due_date);
CREATE INDEX ix_task_org_created_by ON task (organization_id, created_by);
CREATE INDEX ix_task_org_project_id ON task (organization_id, project_id) WHERE project_id IS NOT NULL;

CREATE INDEX ix_task_assignee_user  ON task_assignee (organization_id, user_id);
CREATE INDEX ix_task_assignee_task  ON task_assignee (organization_id, task_id);

-- Ensure module entitlement for the tasks module across organizations
UPDATE module SET is_core = true WHERE key = 'tasks';

INSERT INTO organization_module (organization_id, module_id, status, enabled_at)
SELECT o.id, m.id, 'enabled', now()
FROM organization o
CROSS JOIN module m
WHERE m.key = 'tasks'
ON CONFLICT (organization_id, module_id) DO NOTHING;
