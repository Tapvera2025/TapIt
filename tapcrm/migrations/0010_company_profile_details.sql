-- =====================================================================
-- 0010 — Master Admin company profile details
-- =====================================================================
ALTER TABLE organization
  ADD COLUMN legal_company_name text NOT NULL DEFAULT '',
  ADD COLUMN company_type text NOT NULL DEFAULT 'Private',
  ADD COLUMN industry text NOT NULL DEFAULT 'IT / Software',
  ADD COLUMN website text NOT NULL DEFAULT '',
  ADD COLUMN company_email text NOT NULL DEFAULT '',
  ADD COLUMN owner_full_name text NOT NULL DEFAULT '',
  ADD COLUMN owner_designation text NOT NULL DEFAULT '',
  ADD COLUMN owner_mobile text NOT NULL DEFAULT '',
  ADD COLUMN owner_alternate_number text NOT NULL DEFAULT '',
  ADD COLUMN primary_phone text NOT NULL DEFAULT '',
  ADD COLUMN alternate_phone text NOT NULL DEFAULT '',
  ADD COLUMN support_email text NOT NULL DEFAULT '',
  ADD COLUMN address_line_1 text NOT NULL DEFAULT '',
  ADD COLUMN address_line_2 text NOT NULL DEFAULT '',
  ADD COLUMN city text NOT NULL DEFAULT '',
  ADD COLUMN state text NOT NULL DEFAULT '',
  ADD COLUMN country text NOT NULL DEFAULT '',
  ADD COLUMN postal_code text NOT NULL DEFAULT '',
  ADD COLUMN gstin text NOT NULL DEFAULT '',
  ADD COLUMN pan text NOT NULL DEFAULT '',
  ADD COLUMN registration_number text NOT NULL DEFAULT '';
