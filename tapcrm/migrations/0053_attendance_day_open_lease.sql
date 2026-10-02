-- =====================================================================
-- 0053 - Day-open lease (§8.6 concurrency guard for openDaysForOrganization)
--
-- Row-based per-organization lease so two overlapping day-open runs cannot
-- race the watermark. Acquire = UPDATE with a stale-timeout WHERE clause;
-- release = SET NULL. If the holder crashes before releasing, the next
-- run picks it up after `LEASE_TIMEOUT_MINUTES` (application-side constant).
--
-- Row-based rather than `pg_advisory_lock` because our DAL is
-- pool-per-transaction: a session-level advisory lock taken in one
-- transaction cannot be released from another. A row is orthogonal to
-- connection identity.
-- =====================================================================

ALTER TABLE attendance_day_open_state
  ADD COLUMN lease_acquired_at timestamptz,
  ADD COLUMN lease_holder      text;
