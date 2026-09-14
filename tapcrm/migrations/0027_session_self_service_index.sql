CREATE INDEX IF NOT EXISTS ix_session_identity_active
  ON session (organization_id, user_id, revoked_at, expires_at, last_active_at DESC);
