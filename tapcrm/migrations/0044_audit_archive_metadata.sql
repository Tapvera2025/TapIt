-- =====================================================================
-- 0044 — Audit archive metadata and retention state (AU-4/AU-5/AU-9)
-- =====================================================================

CREATE TABLE audit_archive (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid NOT NULL REFERENCES organization(id),
  stream             text NOT NULL CHECK (stream IN ('access', 'activity')),
  sequence_start     bigint NOT NULL,
  sequence_end       bigint NOT NULL,
  occurred_start     timestamptz NOT NULL,
  occurred_end       timestamptz NOT NULL,
  record_count       integer NOT NULL CHECK (record_count > 0),
  first_hash         bytea NOT NULL,
  last_hash          bytea NOT NULL,
  object_key         text NOT NULL,
  object_checksum    text NOT NULL,
  object_size_bytes  bigint NOT NULL CHECK (object_size_bytes >= 0),
  encryption_key_id  text NOT NULL,
  archived_at        timestamptz NOT NULL DEFAULT now(),
  storage_verified_at timestamptz NOT NULL,
  status             text NOT NULL DEFAULT 'archived' CHECK (status IN ('archived', 'purged')),
  purged_at          timestamptz,
  CONSTRAINT audit_archive_range CHECK (sequence_end >= sequence_start AND occurred_end >= occurred_start),
  CONSTRAINT audit_archive_status_shape CHECK (
    (status = 'archived' AND purged_at IS NULL) OR (status = 'purged' AND purged_at IS NOT NULL)
  ),
  UNIQUE (organization_id, stream, sequence_start, sequence_end)
);

SELECT apply_tenant_rls('audit_archive');

GRANT SELECT, INSERT, UPDATE ON audit_archive TO tapcrm_app;
REVOKE DELETE ON audit_archive FROM tapcrm_app;

CREATE INDEX ix_audit_archive_search
  ON audit_archive (organization_id, stream, occurred_start DESC, occurred_end DESC)
  WHERE status = 'archived';
CREATE INDEX ix_audit_archive_sequence
  ON audit_archive (organization_id, stream, sequence_start, sequence_end);

COMMENT ON TABLE audit_archive IS
  'AU-4/AU-9 immutable archive manifests. Payloads are encrypted objects in centralized WORM storage; metadata preserves chain boundaries and checksums.';
