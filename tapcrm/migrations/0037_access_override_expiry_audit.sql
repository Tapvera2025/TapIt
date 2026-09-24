-- AM-7: expiry is still evaluated from expires_at at authorization time.
-- This marker is only for idempotent maintenance auditing; it is never used
-- to make an authorization decision.
ALTER TABLE user_override
  ADD COLUMN expiry_audited_at timestamptz;

