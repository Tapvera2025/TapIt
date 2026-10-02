-- =====================================================================
-- 0048 - Holidays and week-offs (attendance design, step 2, §7)
--
-- Two tables. `holiday` covers dated holidays (national, regional,
-- optional, shift-scoped) AND week-off rules; the sub-kind is `type`.
-- `holiday_scope` targets a department or a shift by TYPED foreign key,
-- never a (kind, id) pair (§7).
-- =====================================================================

CREATE TABLE holiday (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  name            text NOT NULL CHECK (length(trim(name)) > 0),
  type            text NOT NULL CHECK (type IN ('national', 'regional', 'optional', 'week-off')),  -- HO-1
  holiday_date    date,                    -- dated holidays: NULL for week-off rules
  recurrence      jsonb,                   -- week-off only: {"weekdays":[6,7]} or {"weekdays":[6],"weeksOfMonth":[2,4]}
  effective_from  date,                    -- week-off rules only
  effective_to    date,                    -- exclusive; NULL = open-ended
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn')),
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),            -- the target of holiday_scope's composite key
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id),
  -- Design §7: shape of the two kinds.
  CHECK ((type = 'week-off') = (recurrence IS NOT NULL)),
  CHECK ((type = 'week-off') = (effective_from IS NOT NULL)),
  CHECK (type = 'week-off' OR holiday_date IS NOT NULL),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

-- Scope as rows with TYPED columns. A national holiday has no rows here.
-- A regional holiday has one row per department; a shift-scoped holiday has
-- one row per shift. Exactly one of the two ids is set per row.
CREATE TABLE holiday_scope (
  organization_id uuid NOT NULL REFERENCES organization(id),
  holiday_id      uuid NOT NULL,
  department_id   uuid,                        -- HO-1 regional
  shift_id        uuid,                        -- HO-2
  CHECK (num_nonnulls(department_id, shift_id) = 1),
  FOREIGN KEY (organization_id, holiday_id)    REFERENCES holiday    (organization_id, id),
  FOREIGN KEY (organization_id, department_id) REFERENCES department (organization_id, id),
  FOREIGN KEY (organization_id, shift_id)      REFERENCES shift      (organization_id, id),
  -- NULLS NOT DISTINCT, or a plain UNIQUE would let the same scope row in twice:
  -- PostgreSQL treats NULLs as different values in an ordinary unique constraint.
  UNIQUE NULLS NOT DISTINCT (organization_id, holiday_id, department_id, shift_id)
);

CREATE INDEX ix_holiday_date ON holiday (organization_id, holiday_date) WHERE holiday_date IS NOT NULL;
CREATE INDEX ix_holiday_weekoff ON holiday (organization_id, effective_from) WHERE type = 'week-off';
CREATE INDEX ix_holiday_scope_holiday ON holiday_scope (organization_id, holiday_id);
CREATE INDEX ix_holiday_scope_department ON holiday_scope (organization_id, department_id) WHERE department_id IS NOT NULL;
CREATE INDEX ix_holiday_scope_shift ON holiday_scope (organization_id, shift_id) WHERE shift_id IS NOT NULL;

SELECT apply_tenant_rls('holiday');
SELECT apply_tenant_rls('holiday_scope');

GRANT SELECT, INSERT, UPDATE ON holiday TO tapcrm_app;             -- withdrawal is UPDATE (HO-3)
GRANT SELECT, INSERT, DELETE ON holiday_scope TO tapcrm_app;       -- replacing scope removes the old rows
