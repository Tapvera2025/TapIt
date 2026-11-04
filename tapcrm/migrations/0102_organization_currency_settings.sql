CREATE TABLE IF NOT EXISTS organization_currency_settings (
  organization_id uuid PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
  supported_currencies text[] NOT NULL DEFAULT ARRAY['INR']::text[],
  default_currency text NOT NULL DEFAULT 'INR',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_currency_settings_has_currency CHECK (cardinality(supported_currencies) > 0),
  CONSTRAINT organization_currency_settings_default_enabled CHECK (default_currency = ANY(supported_currencies))
);
INSERT INTO organization_currency_settings (organization_id) SELECT id FROM organization ON CONFLICT DO NOTHING;
ALTER TABLE organization_currency_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_currency_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_currency_settings_tenant ON organization_currency_settings USING (organization_id = current_organization_id()) WITH CHECK (organization_id = current_organization_id());
GRANT SELECT, INSERT, UPDATE ON organization_currency_settings TO tapcrm_app;
ALTER TABLE employee_advance ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'INR';
