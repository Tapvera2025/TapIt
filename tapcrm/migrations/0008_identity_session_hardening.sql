-- =====================================================================
-- 0008 — Identity session hardening and the last tenant-RLS gap
--
-- Three things, all of which the previous migrations left open:
--
--   1. `approval_delegation` was created in 0006 with `organization_id` and
--      tenant-safe foreign keys but never had `apply_tenant_rls()` called on
--      it. PG-4 requires RLS ENABLE + FORCE on every tenant-owned table, and
--      the CI-33 schema scan has been red because of this one table.
--
--   2. `refresh_token` can be marked used but not REVOKED. ID-6 requires that
--      detecting a replayed token "revokes the whole family" — which is a
--      different state from "this one was spent normally", and cannot be
--      expressed by overloading `used_at`. Reconstructing why a family died is
--      a security question that gets asked after an incident, so the reason is
--      stored rather than inferred.
--
--   3. The access paths the session lifecycle actually uses have no supporting
--      indexes. Revoking a family, listing a user's devices and expiring a
--      session are all issued per request or per security event; at the §17
--      3-year target (10,000 employees, 6,000 concurrent) each of these is a
--      sequential scan without the indexes below.
--
-- Forward-only (DP-1). Nothing here edits an applied migration.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The tenant-RLS gap — PG-4, TN-2, CI-33
-- ---------------------------------------------------------------------
SELECT apply_tenant_rls('approval_delegation');

-- ---------------------------------------------------------------------
-- 2. Refresh-token revocation as a first-class state — ID-6
--
-- `used_at`     the token was spent in a normal rotation
-- `revoked_at`  the token was killed, and may never be spent
--
-- A token can be both: a replayed token is already used, and revoking its
-- family kills every sibling including the one that was legitimately spent.
-- ---------------------------------------------------------------------
ALTER TABLE refresh_token
  ADD COLUMN IF NOT EXISTS revoked_at     timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_reason text;

COMMENT ON COLUMN refresh_token.revoked_at IS
  'ID-6. Set when the token is killed rather than spent. Distinct from used_at: a replayed token is used AND revoked, and so is every sibling in its family.';

COMMENT ON COLUMN refresh_token.revoked_reason IS
  'Why the family died — reuse-detected, logout, password-change, session-revoked, user-deactivated. Read during incident reconstruction, so it is stored rather than inferred.';

-- A revoked token must carry its reason. A revocation nobody can explain later
-- is not evidence of anything.
ALTER TABLE refresh_token
  DROP CONSTRAINT IF EXISTS refresh_token_revocation_has_reason;

ALTER TABLE refresh_token
  ADD CONSTRAINT refresh_token_revocation_has_reason
  CHECK (revoked_at IS NULL OR length(coalesce(revoked_reason, '')) > 0);

-- ---------------------------------------------------------------------
-- 3. Indexes for the paths the session lifecycle actually takes
--
-- IX-1: tenant-scoped indexes lead with organization_id.
-- IX-5: partial indexes where a stable status predicate makes them smaller —
--       live sessions and unspent tokens are a small slice of the table, and
--       both are the only slice these queries ever read.
-- ---------------------------------------------------------------------

-- Family revocation on reuse detection: one statement, one index.
CREATE INDEX IF NOT EXISTS ix_refresh_token_family
  ON refresh_token (organization_id, family_id);

-- Rotation and logout both reach every token of one session.
CREATE INDEX IF NOT EXISTS ix_refresh_token_session
  ON refresh_token (organization_id, session_id);

-- ID-8 "list my active sessions", and revoke-all, both read exactly this slice.
CREATE INDEX IF NOT EXISTS ix_session_user_live
  ON session (organization_id, user_id, last_active_at DESC)
  WHERE revoked_at IS NULL;

-- The nightly expiry sweep, and the resolver's expires_at test.
CREATE INDEX IF NOT EXISTS ix_session_expiry
  ON session (organization_id, expires_at)
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------
-- 4. Session-version bookkeeping — ID-7
--
-- "Every account carries a session version. Deactivation, password change,
--  role change or explicit revocation increments it and invalidates all
--  sessions within 60 seconds."
--
-- The resolver compares app_user.session_version to the token's claim on every
-- request, so the invalidation is immediate rather than eventual. That
-- comparison is the hottest read in the product; it belongs in the index that
-- already serves the resolver's lookup.
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_app_user_session_version
  ON app_user (organization_id, id, session_version)
  WHERE status = 'active';
