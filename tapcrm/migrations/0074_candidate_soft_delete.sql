-- Migration 0071: Soft-delete support for candidates
-- Adds deleted_at to the candidate table so HR can remove candidates without
-- permanently destroying audit history or related interview/joining records.

ALTER TABLE candidate ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS ix_candidate_org_deleted
  ON candidate (organization_id, deleted_at)
  WHERE deleted_at IS NULL;
