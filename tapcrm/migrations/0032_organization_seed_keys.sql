-- Stable origin keys let bootstrap recognize a seeded row after a tenant
-- changes its display name. They describe provenance, not immutability.
ALTER TABLE team ADD COLUMN seed_code text;
ALTER TABLE designation ADD COLUMN seed_code text;

UPDATE team
SET seed_code = CASE lower(name)
  WHEN 'developer team' THEN 'developer-team'
  WHEN 'digital & marketing' THEN 'digital-marketing'
  WHEN 'content team' THEN 'content-team'
  ELSE seed_code
END
WHERE is_seeded = true AND seed_code IS NULL;

UPDATE designation
SET seed_code = CASE lower(name)
  WHEN 'developer' THEN 'developer'
  WHEN 'marketing executive' THEN 'marketing-executive'
  WHEN 'content writer' THEN 'content-writer'
  ELSE seed_code
END
WHERE is_seeded = true AND seed_code IS NULL;

CREATE UNIQUE INDEX ux_team_org_seed_code
  ON team (organization_id, seed_code)
  WHERE seed_code IS NOT NULL;

CREATE UNIQUE INDEX ux_designation_org_seed_code
  ON designation (organization_id, seed_code)
  WHERE seed_code IS NOT NULL;
