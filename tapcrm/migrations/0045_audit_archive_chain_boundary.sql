-- Preserve the hash immediately preceding every archived range so the
-- integrity verifier can connect archived and live portions of each stream.
ALTER TABLE audit_archive ADD COLUMN first_prev_hash bytea;
