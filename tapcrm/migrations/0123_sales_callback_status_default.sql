-- Callback hardening: align the lead_callback.status column default with the
-- check constraint introduced in migration 0059. The old default 'scheduled'
-- was never dropped, so inserts that omit `status` fail the check
-- `lead_callback_status_check` with "new row ... violates check constraint".
--
-- Values are already migrated by 0059's UPDATE; this only resets the default
-- so the normal insert path (which does not set status) succeeds.

ALTER TABLE lead_callback ALTER COLUMN status SET DEFAULT 'pending';
