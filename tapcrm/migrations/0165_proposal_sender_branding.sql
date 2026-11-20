ALTER TABLE organization
  ADD COLUMN IF NOT EXISTS proposal_logo_data_url text;

-- Keep the sender identity on each newly published version so later changes
-- to the organization profile do not alter an issued proposal.
ALTER TABLE commercials
  ADD COLUMN IF NOT EXISTS sender_branding jsonb;
