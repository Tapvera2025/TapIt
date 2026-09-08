-- =====================================================================
-- 0007 — Company Admin invitations
-- =====================================================================
CREATE TABLE admin_invitation (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  email            citext NOT NULL,
  token_hash       bytea NOT NULL UNIQUE,
  expires_at       timestamptz NOT NULL,
  accepted_at      timestamptz,
  revoked_at       timestamptz,
  created_by       uuid NOT NULL REFERENCES platform_user(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_admin_invitation_org ON admin_invitation(organization_id, email, created_at DESC);
CREATE INDEX ix_admin_invitation_pending ON admin_invitation(email, expires_at)
WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- Control-plane table: accessed through platformDb, not tenant db.
GRANT SELECT, INSERT, UPDATE, DELETE ON admin_invitation TO tapcrm_app;
