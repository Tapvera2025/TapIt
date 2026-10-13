-- =====================================================================
-- 0075 — Sales: Contact + Company first-class entities
--
-- Promotes contact and company to first-class entities so that a single
-- contact can hold multiple enquiries over time, carry consent and a
-- preferred timezone, and be deduplicated reliably across intake sources.
--
-- See PRD v1.1 §20 and R0 implementation plan step 0.1.
--
-- Lead keeps its existing contact_name / company_name / phone / email
-- columns for backward compatibility during the transition. The intake
-- service (step 1.1) begins writing contact_id and company_id instead;
-- callers of the old columns are migrated incrementally.
--
-- New tables:
--   contact                 — person who may enquire; one per (org, phone or email)
--   company                 — organisation they represent (optional)
--
-- Existing table changes:
--   lead                    — adds contact_id, company_id, backfilled
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Company
--
-- Created first because contact.company_id references it.
-- ---------------------------------------------------------------------
CREATE TABLE company (
  id                 uuid        PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid        NOT NULL REFERENCES organization(id),
  name               text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  domain             text        CHECK (domain IS NULL OR char_length(domain) <= 253),
  billing_reference  text,
  created_by         uuid        NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id)
);

CREATE INDEX ix_company_org_name_lower ON company (organization_id, lower(name));
CREATE INDEX ix_company_org_domain     ON company (organization_id, lower(domain)) WHERE domain IS NOT NULL;

CREATE TRIGGER trg_company_updated
  BEFORE UPDATE ON company
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT apply_tenant_rls('company');

-- ---------------------------------------------------------------------
-- 2. Contact
--
-- One row per (organization, primary_phone) and per (organization,
-- primary_email). Dedupe happens on these two keys; name/company are
-- never used as identity.
--
-- preferred_timezone follows PRD §21.5 (dual-clock model):
--   - derived from phone country code, form input, IP geolocation
--   - defaults to 'Asia/Kolkata' when nothing better is known
--   - the customer-facing clock reads this; the operational clock is
--     always 'Asia/Kolkata' at the tenant level
--
-- consent and opt_out are jsonb bags so per-channel policy can evolve
-- without further migrations.
-- ---------------------------------------------------------------------
CREATE TABLE contact (
  id                 uuid        PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid        NOT NULL REFERENCES organization(id),
  full_name          text        CHECK (full_name IS NULL OR char_length(full_name) BETWEEN 1 AND 200),
  primary_phone      text        CHECK (primary_phone IS NULL OR primary_phone ~ '^\+[1-9][0-9]{1,14}$'),
  primary_phone_raw  text,
  primary_email      citext,
  company_id         uuid,
  preferred_timezone text        NOT NULL DEFAULT 'Asia/Kolkata',
  preferred_channel  text        CHECK (preferred_channel IS NULL OR preferred_channel IN ('phone', 'email', 'whatsapp', 'sms')),
  consent            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  opt_out            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by         uuid        NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, company_id) REFERENCES company (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id),
  CHECK (primary_phone IS NOT NULL OR primary_email IS NOT NULL)
);

-- Partial unique indexes so NULLs do not collide. One contact per
-- (org, phone) and one per (org, email); the row may have both.
CREATE UNIQUE INDEX uniq_contact_org_phone
  ON contact (organization_id, primary_phone) WHERE primary_phone IS NOT NULL;
CREATE UNIQUE INDEX uniq_contact_org_email
  ON contact (organization_id, primary_email) WHERE primary_email IS NOT NULL;

CREATE INDEX ix_contact_org_company ON contact (organization_id, company_id) WHERE company_id IS NOT NULL;

CREATE TRIGGER trg_contact_updated
  BEFORE UPDATE ON contact
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT apply_tenant_rls('contact');

-- ---------------------------------------------------------------------
-- 3. Lead → Contact / Company link
--
-- Additive only. The old lead.contact_name / company_name / phone / email
-- columns are kept intact; the new intake service writes contact_id and
-- company_id, and old code paths continue to work until migrated.
-- ---------------------------------------------------------------------
ALTER TABLE lead
  ADD COLUMN contact_id uuid,
  ADD COLUMN company_id uuid;

ALTER TABLE lead
  ADD CONSTRAINT fk_lead_contact
    FOREIGN KEY (organization_id, contact_id) REFERENCES contact (organization_id, id),
  ADD CONSTRAINT fk_lead_company
    FOREIGN KEY (organization_id, company_id) REFERENCES company (organization_id, id);

CREATE INDEX ix_lead_org_contact ON lead (organization_id, contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX ix_lead_org_company ON lead (organization_id, company_id) WHERE company_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 4. Backfill companies from existing lead.company_name
--
-- One company per (organization_id, lower(company_name)) using the
-- earliest-seen lead as the canonical creator. Names are preserved as
-- originally cased; the uniqueness key is the lowercased form.
-- ---------------------------------------------------------------------
INSERT INTO company (organization_id, name, created_by, created_at, updated_at)
SELECT DISTINCT ON (l.organization_id, lower(l.company_name))
       l.organization_id,
       l.company_name,
       l.created_by,
       l.created_at,
       l.created_at
FROM   lead l
WHERE  l.company_name IS NOT NULL
  AND  char_length(trim(l.company_name)) > 0
ORDER  BY l.organization_id, lower(l.company_name), l.created_at;

-- Link leads to the newly created companies.
UPDATE lead l
   SET company_id = c.id
  FROM company c
 WHERE c.organization_id = l.organization_id
   AND l.company_name IS NOT NULL
   AND lower(c.name)   = lower(l.company_name)
   AND l.company_id    IS NULL;

-- ---------------------------------------------------------------------
-- 5. Backfill contacts from existing lead rows
--
-- Dedupe key order: phone wins over email when both exist.
-- A lead with neither phone nor email is skipped; it stays searchable
-- by contact_name only until a reviewer adds identifiers.
--
-- The earliest-seen lead's name + created_by seed the contact row.
-- ---------------------------------------------------------------------
WITH ranked AS (
  SELECT l.*,
         COALESCE(NULLIF(l.phone, ''), 'EMAIL:' || l.email::text) AS dedupe_key,
         row_number() OVER (
           PARTITION BY l.organization_id,
                        COALESCE(NULLIF(l.phone, ''), 'EMAIL:' || l.email::text)
           ORDER BY l.created_at, l.id
         ) AS rn
  FROM   lead l
  WHERE  l.phone IS NOT NULL
    OR   l.email IS NOT NULL
),
first_rows AS (
  SELECT organization_id,
         contact_name,
         NULLIF(phone, '')       AS primary_phone_raw,
         email                   AS primary_email,
         company_id               AS seed_company_id,
         created_by,
         created_at
  FROM   ranked
  WHERE  rn = 1
)
INSERT INTO contact (
         organization_id, full_name, primary_phone, primary_phone_raw,
         primary_email, company_id, preferred_timezone,
         created_by, created_at, updated_at
       )
SELECT   organization_id,
         contact_name,
         -- Only promote a phone to primary_phone (E.164-constrained) if it
         -- already begins with '+'. Everything else lives in
         -- primary_phone_raw and will be normalised later.
         CASE WHEN primary_phone_raw ~ '^\+[1-9][0-9]{1,14}$' THEN primary_phone_raw ELSE NULL END,
         primary_phone_raw,
         primary_email,
         seed_company_id,
         'Asia/Kolkata',
         created_by,
         created_at,
         created_at
FROM     first_rows;

-- Link leads to the backfilled contacts. Match on phone first, then on
-- email, so a lead with both finds its canonical contact deterministically.
UPDATE lead l
   SET contact_id = c.id
  FROM contact c
 WHERE c.organization_id = l.organization_id
   AND l.contact_id IS NULL
   AND (
         (l.phone IS NOT NULL AND l.phone = c.primary_phone_raw)
         OR
         (l.phone IS NULL AND l.email IS NOT NULL AND l.email = c.primary_email)
       );

-- ---------------------------------------------------------------------
-- 6. Grants
--
-- The app role writes to contact + company via the intake service and
-- lead-management UI. Deletes are reserved for data-retention jobs
-- which run with a separate elevated role (not granted here).
-- ---------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON company, contact TO tapcrm_app;
