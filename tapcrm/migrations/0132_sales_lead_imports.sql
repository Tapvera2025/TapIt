-- Lead Imports (Sales): bring lead lists in from CSV, Excel or Google Sheets,
-- assign them to the sales team, and see whether the assignees call them.
--
-- An import is uploaded as a draft, its columns are matched to lead fields,
-- and a background job turns every row into a lead through the intake
-- pipeline (dedupe, contact and company identity, routing record). Leads stay
-- unassigned until someone with lead-imports:manage hands them out.
--
-- Additive and forward-only (tools/migrate.ts).

-- ---------------------------------------------------------------------
-- 1. Module catalog and registry actions (AUTHORIZATION.md §6.4).
--    Both actions are tenant-wide (no resource): an import belongs to the
--    company, not to a team. Super Admin holds them; a Super Admin can grant
--    them to a position (a Sales Head, say) on purpose.
-- ---------------------------------------------------------------------
INSERT INTO module (key, name, description) VALUES
('lead-imports', 'Lead Imports', 'Import lead lists from CSV, Excel or Google Sheets, assign them to the sales team and track the calls')
ON CONFLICT (key) DO NOTHING;

INSERT INTO registry_action (
  action, module, resource, domain, sensitive, approval_bearing, initiator_field,
  position_grantable, delegation_allowed, super_admin_only, description
) VALUES
  ('lead-imports:view', 'lead-imports', NULL, 'business', false, false, NULL, true, true, false,
   'See lead imports, the leads they created, who they were assigned to and whether those leads were called.'),
  ('lead-imports:manage', 'lead-imports', NULL, 'business', true, false, NULL, true, false, false,
   'Import lead lists and assign imported leads to people in the Sales department.')
ON CONFLICT (action) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. Imports. One row per uploaded list. The file itself is not kept: its
--    rows are, in lead_import_row, together with what became of each.
-- ---------------------------------------------------------------------
CREATE TABLE lead_import (
  id                      uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id         uuid NOT NULL REFERENCES organization(id),
  name                    text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 160),
  source_kind             text NOT NULL CHECK (source_kind IN ('csv', 'excel', 'google_sheet', 'paste')),
  file_name               text CHECK (length(file_name) <= 255),
  source_url              text CHECK (length(source_url) <= 2048),
  sheet_name              text CHECK (length(sheet_name) <= 255),
  -- SHA-256 of the uploaded bytes (PRD R-IMP-02), so a re-upload is visible.
  file_digest             text CHECK (file_digest ~ '^[0-9a-f]{64}$'),
  status                  text NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'queued', 'importing', 'completed', 'failed', 'cancelled')),
  headers                 text[] NOT NULL DEFAULT '{}',
  -- { "<column index>": "<lead field>" }; columns not named are left out.
  column_mapping          jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(column_mapping) = 'object'),
  -- The "Assigned to" column's values, as written in the file, matched to
  -- employees: { "<normalized value>": "<employee id>" | null }.
  assignee_mapping        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(assignee_mapping) = 'object'),
  lead_source_id          uuid,
  campaign_id             uuid,
  -- Prefixed to phone numbers written without a country code ('91' = India).
  default_country_code    text CHECK (default_country_code ~ '^[1-9][0-9]{0,2}$'),
  extra_columns_to_notes  boolean NOT NULL DEFAULT true,
  total_rows              integer NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  processed_rows          integer NOT NULL DEFAULT 0 CHECK (processed_rows >= 0),
  created_count           integer NOT NULL DEFAULT 0 CHECK (created_count >= 0),
  existing_count          integer NOT NULL DEFAULT 0 CHECK (existing_count >= 0),
  duplicate_count         integer NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  invalid_count           integer NOT NULL DEFAULT 0 CHECK (invalid_count >= 0),
  failed_count            integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  last_error              text,
  created_by              uuid NOT NULL,
  started_by              uuid,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  started_at              timestamptz,
  -- Touched by the running import job; a stale heartbeat lets a new job resume.
  heartbeat_at            timestamptz,
  completed_at            timestamptz,
  UNIQUE (organization_id, id),
  -- Every import that ran knows which lead source its leads carry.
  CHECK (status IN ('draft', 'cancelled') OR lead_source_id IS NOT NULL),
  FOREIGN KEY (organization_id, lead_source_id) REFERENCES lead_source (organization_id, id),
  FOREIGN KEY (organization_id, campaign_id) REFERENCES campaign (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, started_by) REFERENCES app_user (organization_id, id)
);
CREATE INDEX ix_lead_import_created ON lead_import (organization_id, created_at DESC);
CREATE INDEX ix_lead_import_active ON lead_import (organization_id, status)
  WHERE status IN ('queued', 'importing');
CREATE TRIGGER lead_import_updated_at BEFORE UPDATE ON lead_import
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT apply_tenant_rls('lead_import');
REVOKE DELETE ON lead_import FROM tapcrm_app;

-- ---------------------------------------------------------------------
-- 3. Rows. `cells` is the row exactly as uploaded, aligned with
--    lead_import.headers. A row that created a lead owns it here, and the
--    assignment made from the Imported leads view is recorded on that row.
-- ---------------------------------------------------------------------
CREATE TABLE lead_import_row (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id   uuid NOT NULL REFERENCES organization(id),
  import_id         uuid NOT NULL,
  row_number        integer NOT NULL CHECK (row_number >= 1),
  cells             text[] NOT NULL,
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'created', 'existing', 'duplicate', 'invalid', 'failed')),
  -- Why a row was not imported (a quarantine reason or an error message).
  reason            text,
  -- What the row said, for the report, even when it never became a lead.
  contact_name      text,
  phone             text,
  email             text,
  -- The row's "Assigned to" value as written, matched or not.
  assignee_value    text,
  lead_id           uuid,
  submission_id     uuid,
  assigned_to       uuid,
  assigned_by       uuid,
  assigned_at       timestamptz,
  -- 'sheet': from the file's "Assigned to" column; 'manual': handed out
  -- from the Imported leads view.
  assigned_via      text CHECK (assigned_via IN ('sheet', 'manual')),
  processed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, import_id, row_number),
  -- created: made this lead; existing: the contact already had an active
  -- lead; duplicate: an earlier row of the same import made it.
  CHECK ((status IN ('created', 'existing', 'duplicate')) = (lead_id IS NOT NULL)),
  CHECK (assigned_to IS NULL OR status = 'created'),
  CHECK ((assigned_to IS NULL) = (assigned_at IS NULL)),
  CHECK ((assigned_to IS NULL) = (assigned_via IS NULL)),
  FOREIGN KEY (organization_id, import_id) REFERENCES lead_import (organization_id, id),
  FOREIGN KEY (organization_id, lead_id) REFERENCES lead (organization_id, id),
  FOREIGN KEY (organization_id, submission_id) REFERENCES lead_submission (organization_id, id),
  FOREIGN KEY (organization_id, assigned_to) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, assigned_by) REFERENCES app_user (organization_id, id)
);
CREATE INDEX ix_lead_import_row_status ON lead_import_row (organization_id, import_id, status, row_number);
CREATE INDEX ix_lead_import_row_lead ON lead_import_row (organization_id, lead_id) WHERE lead_id IS NOT NULL;
-- A lead is "imported" by exactly one row: the one that created it.
CREATE UNIQUE INDEX ux_lead_import_row_created_lead ON lead_import_row (organization_id, lead_id)
  WHERE status = 'created';
CREATE INDEX ix_lead_import_row_assigned ON lead_import_row (organization_id, assigned_to, assigned_at DESC)
  WHERE assigned_to IS NOT NULL;
CREATE TRIGGER lead_import_row_updated_at BEFORE UPDATE ON lead_import_row
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT apply_tenant_rls('lead_import_row');
REVOKE DELETE ON lead_import_row FROM tapcrm_app;

-- ---------------------------------------------------------------------
-- 4. Calls are matched to leads on the last ten digits of the number, which
--    survives a missing or different country prefix on either side.
--    telephony_call.contact_number holds only '+' and digits.
-- ---------------------------------------------------------------------
CREATE INDEX ix_telephony_call_contact_tail ON telephony_call (organization_id, right(contact_number, 10))
  WHERE contact_number IS NOT NULL;

-- ---------------------------------------------------------------------
-- 5. Companies that already work leads get Lead Imports with them. No
--    position defaults: Super Admin holds both actions until it grants them.
-- ---------------------------------------------------------------------
INSERT INTO organization_module (organization_id, module_id, status, enabled_at)
SELECT om.organization_id, imports.id, 'enabled', now()
FROM organization_module om
JOIN module leads ON leads.id = om.module_id AND leads.key = 'leads'
CROSS JOIN module imports
WHERE imports.key = 'lead-imports'
  AND om.status = 'enabled'
ON CONFLICT (organization_id, module_id) DO NOTHING;
