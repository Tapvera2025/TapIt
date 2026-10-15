-- Sales v1.1 R2 — Commercials + Proposal versioning (R2 plan step 2.2).
--
-- All amounts are integer minor units (paise) in `bigint`. The CHECK on
-- `total_minor = subtotal_minor - discount_minor + tax_minor` is the
-- invariant every server computation preserves (R-PROP-02).
--
-- `proposal_portal_token` holds only the SHA-256 of the raw share token
-- (R-PORTAL-01). The raw token is returned to the issuer once at
-- creation time and is never persisted.

CREATE TABLE commercials (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid NOT NULL REFERENCES organization(id),
  deal_id            uuid NOT NULL,
  version            integer NOT NULL,
  state              text NOT NULL DEFAULT 'draft'
                       CHECK (state IN ('draft','published','superseded','expired','accepted','rejected')),
  currency           text NOT NULL,
  subtotal_minor     bigint NOT NULL,
  discount_minor     bigint NOT NULL DEFAULT 0,
  tax_minor          bigint NOT NULL DEFAULT 0,
  total_minor        bigint NOT NULL,
  advance_minor      bigint NOT NULL DEFAULT 0,
  validity_at        timestamptz,
  scope              text,
  exclusions         text,
  timeline           text,
  terms              text,
  pdf_checksum       text,
  published_at       timestamptz,
  published_by       uuid,
  accepted_at        timestamptz,
  accepted_evidence  jsonb,
  created_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, id),
  UNIQUE (organization_id, deal_id, version),
  FOREIGN KEY (organization_id, deal_id)      REFERENCES deal (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, published_by) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, created_by)   REFERENCES app_user (organization_id, id),
  CHECK (subtotal_minor >= 0 AND discount_minor >= 0 AND tax_minor >= 0),
  CHECK (total_minor = subtotal_minor - discount_minor + tax_minor),
  CHECK (advance_minor BETWEEN 0 AND total_minor)
);

CREATE INDEX ix_commercials_org_deal_state ON commercials (organization_id, deal_id, state);
CREATE INDEX ix_commercials_org_state ON commercials (organization_id, state);

SELECT apply_tenant_rls('commercials');
CREATE TRIGGER trg_commercials_updated BEFORE UPDATE ON commercials FOR EACH ROW EXECUTE FUNCTION set_updated_at();
GRANT SELECT, INSERT, UPDATE ON commercials TO tapcrm_app;

-- Now that commercials exists, wire the FK on deal.commercials_id.
ALTER TABLE deal
  ADD CONSTRAINT deal_commercials_fk
  FOREIGN KEY (organization_id, commercials_id) REFERENCES commercials (organization_id, id);

CREATE TABLE commercials_item (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid NOT NULL REFERENCES organization(id),
  commercials_id     uuid NOT NULL,
  service_name       text NOT NULL,
  description        text,
  quantity           numeric(14,4) NOT NULL CHECK (quantity > 0),
  unit_price_minor   bigint NOT NULL CHECK (unit_price_minor >= 0),
  discount_minor     bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  tax_category       text NOT NULL DEFAULT 'standard',
  tax_rate_bps       integer NOT NULL DEFAULT 0 CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  line_total_minor   bigint NOT NULL CHECK (line_total_minor >= 0),
  milestone          text,
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, commercials_id) REFERENCES commercials (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX ix_commercials_item_order ON commercials_item (organization_id, commercials_id, sort_order);

SELECT apply_tenant_rls('commercials_item');
GRANT SELECT, INSERT, UPDATE, DELETE ON commercials_item TO tapcrm_app;

-- Public-link token (R-PORTAL-01): per-published-version, revocable.
CREATE TABLE proposal_portal_token (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid NOT NULL REFERENCES organization(id),
  commercials_id     uuid NOT NULL,
  token_hash         text NOT NULL UNIQUE,
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  recipient_verified boolean NOT NULL DEFAULT false,
  rate_limit_bucket  text,
  created_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, commercials_id) REFERENCES commercials (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, created_by)     REFERENCES app_user (organization_id, id)
);
CREATE INDEX ix_portal_token_commercials ON proposal_portal_token (organization_id, commercials_id);
CREATE INDEX ix_portal_token_expiry      ON proposal_portal_token (organization_id, expires_at) WHERE revoked_at IS NULL;

SELECT apply_tenant_rls('proposal_portal_token');
GRANT SELECT, INSERT, UPDATE ON proposal_portal_token TO tapcrm_app;
