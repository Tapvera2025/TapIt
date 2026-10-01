-- =====================================================================
-- 0054 — Clients and Projects (modules `clients`, `projects`)
--
-- Both modules already have reviewed actions and position grants in
-- AUTHORIZATION.md / the permission matrix (clients:view/manage,
-- projects:view/manage/view-financials) — this migration is what makes
-- those pre-declared, previously-unbound actions have something real to act
-- on. No new registry actions; see routes.ts in each module for the one new
-- binding (the project's discussion-group creation step).
--
-- `app_user.client_id` has existed since 0002 with no FK (a forward-looking
-- placeholder for exactly this table).
-- =====================================================================

CREATE TABLE client (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id   uuid NOT NULL REFERENCES organization(id),
  -- The named contact vs. the company they represent — a person, not a firm,
  -- signs a client account in.
  client_name       text NOT NULL,
  business_name     text NOT NULL,
  -- Denormalized for list/detail display without a join; the REAL login
  -- identity (and its uniqueness) lives on app_user + identity_email_directory,
  -- same as every other account type. This column is a display convenience,
  -- not a second source of truth for authentication.
  email             citext NOT NULL,
  region            text NOT NULL CHECK (region IN ('global', 'us', 'ca', 'au', 'in')),
  -- Snapshotted from region at creation, not a live lookup: a project created
  -- under one currency must not silently redenominate if the client's region
  -- is edited later (same reasoning as PRD's "the sales conversation did in
  -- fact reach closure and the history should say so").
  currency          text NOT NULL,
  timezone          text NOT NULL,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by        uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, email),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id)
);

ALTER TABLE app_user
  ADD CONSTRAINT app_user_client_id_fkey FOREIGN KEY (organization_id, client_id) REFERENCES client (organization_id, id);

CREATE TABLE project (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id      uuid NOT NULL REFERENCES organization(id),
  client_id            uuid NOT NULL,
  name                 text NOT NULL,
  priority             text NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
  -- 'expired' is set only by a person (product decision), never derived from
  -- the expected end date passing — an unattended cron flipping a client-
  -- visible status is exactly the kind of silent state change this schema
  -- avoids elsewhere (e.g. AZ-I6's "the nightly job only marks, never decides").
  work_status          text NOT NULL DEFAULT 'new' CHECK (work_status IN ('new', 'ongoing', 'ended', 'expired')),
  start_date           date NOT NULL,
  expected_end_date    date,
  budget               numeric(18, 2) CHECK (budget IS NULL OR budget >= 0),
  -- Snapshotted from the client's currency at creation, same reasoning as client.currency above.
  currency             text NOT NULL,
  description          text,
  remarks              text,
  created_by           uuid NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  archived_at          timestamptz,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, client_id) REFERENCES client (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id),
  CHECK (expected_end_date IS NULL OR expected_end_date >= start_date)
);

CREATE INDEX ix_project_client ON project (organization_id, client_id);

-- ---------------------------------------------------------------------
-- Services offered on this project. A fixed set plus free-text 'other',
-- matching the business's actual catalogue: Website, SEO, Ads, SMO, Google
-- Marketing. A partial unique index (not the primary key) enforces "at most
-- one row per named service" while leaving 'other' free to repeat with
-- different labels ("Email Marketing", "Branding", ...).
-- ---------------------------------------------------------------------
CREATE TABLE project_service (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  project_id       uuid NOT NULL,
  service          text NOT NULL CHECK (service IN ('website', 'seo', 'ads', 'smo', 'google_marketing', 'other')),
  other_label      text,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, project_id) REFERENCES project (organization_id, id) ON DELETE CASCADE,
  CHECK (service <> 'other' OR (other_label IS NOT NULL AND length(trim(other_label)) > 0)),
  CHECK (service = 'other' OR other_label IS NULL)
);

CREATE UNIQUE INDEX ix_project_service_unique_named
  ON project_service (project_id, service)
  WHERE service <> 'other';

-- ---------------------------------------------------------------------
-- Employees assigned to the project. `POST /api/projects/:id/team`
-- (already declared, projects:manage) replaces this set; the notification
-- ("You have been added to a new project") and the Tasks module's project
-- filter (task.project_id, already present since the Tasks module landed)
-- both key off this table.
-- ---------------------------------------------------------------------
CREATE TABLE project_assignee (
  project_id       uuid NOT NULL,
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  assigned_at      timestamptz NOT NULL DEFAULT now(),
  assigned_by      uuid NOT NULL,
  PRIMARY KEY (project_id, user_id),
  FOREIGN KEY (organization_id, project_id) REFERENCES project (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, assigned_by) REFERENCES app_user (organization_id, id)
);

SELECT apply_tenant_rls('client');
SELECT apply_tenant_rls('project');
SELECT apply_tenant_rls('project_service');
SELECT apply_tenant_rls('project_assignee');
-- Default privileges from 0001 already grant the runtime role SELECT/INSERT/
-- UPDATE/DELETE on tables created here.
