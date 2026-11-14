-- =====================================================================
-- 0105 — Finance shared foundation (Phase 1)
--
-- This is configuration only. It does not alter payroll, journals or posted
-- accounting data. Unresolved tax/statutory/provider decisions are represented
-- explicitly as pending review rather than guessed defaults.
-- =====================================================================

CREATE TABLE finance_legal_entity (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid NOT NULL REFERENCES organization(id),
  legal_name         text NOT NULL CHECK (length(btrim(legal_name)) BETWEEN 1 AND 200),
  country_code       text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  functional_currency text NOT NULL CHECK (functional_currency ~ '^[A-Z]{3}$'),
  timezone           text NOT NULL CHECK (length(btrim(timezone)) BETWEEN 1 AND 80),
  fiscal_year_start_month smallint NOT NULL DEFAULT 4 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  status             text NOT NULL DEFAULT 'pending_review'
                     CHECK (status IN ('draft', 'pending_review', 'active', 'inactive')),
  created_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, legal_name),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id)
);

CREATE TABLE finance_configuration (
  organization_id       uuid PRIMARY KEY REFERENCES organization(id),
  default_legal_entity_id uuid NOT NULL,
  supported_currencies  text[] NOT NULL DEFAULT ARRAY['INR', 'AUD']::text[],
  tax_policy_status     text NOT NULL DEFAULT 'pending_review'
                        CHECK (tax_policy_status IN ('pending_review', 'configured')),
  statutory_source_status text NOT NULL DEFAULT 'pending_review'
                        CHECK (statutory_source_status IN ('pending_review', 'configured')),
  revenue_policy_status text NOT NULL DEFAULT 'pending_review'
                        CHECK (revenue_policy_status IN ('pending_review', 'configured')),
  payment_provider_status text NOT NULL DEFAULT 'pending_review'
                        CHECK (payment_provider_status IN ('pending_review', 'configured')),
  version               integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by            uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, default_legal_entity_id)
    REFERENCES finance_legal_entity (organization_id, id),
  FOREIGN KEY (organization_id, updated_by)
    REFERENCES app_user (organization_id, id),
  CHECK (cardinality(supported_currencies) > 0)
);

CREATE INDEX ix_finance_legal_entity_status
  ON finance_legal_entity (organization_id, status, legal_name);

CREATE TRIGGER trg_finance_legal_entity_updated
  BEFORE UPDATE ON finance_legal_entity
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_finance_configuration_updated
  BEFORE UPDATE ON finance_configuration
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT apply_tenant_rls('finance_legal_entity');
SELECT apply_tenant_rls('finance_configuration');

GRANT SELECT, INSERT, UPDATE ON finance_legal_entity TO tapcrm_app;
GRANT SELECT, INSERT, UPDATE ON finance_configuration TO tapcrm_app;
REVOKE DELETE ON finance_legal_entity, finance_configuration FROM tapcrm_app;

INSERT INTO registry_action (
  action, module, resource, domain, sensitive, approval_bearing, initiator_field,
  position_grantable, delegation_allowed, super_admin_only, description
) VALUES
  ('accounting:view-finance-settings', 'accounting', NULL, 'business', true, false, NULL, true, false, false, 'View Finance foundation settings.'),
  ('accounting:manage-finance-settings', 'accounting', NULL, 'business', true, false, NULL, false, false, true, 'Manage Finance foundation settings.')
ON CONFLICT (action) DO UPDATE SET
  module = EXCLUDED.module,
  resource = EXCLUDED.resource,
  description = EXCLUDED.description;
