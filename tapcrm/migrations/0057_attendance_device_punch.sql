-- =====================================================================
-- 0057 - Attendance: one event per device punch (step 5 prerequisite)
--
-- A raw device punch becomes at most one attendance event. `appendEvent`
-- finds an earlier event for the same punch under the person's lock; this
-- index is the backstop when two deliveries of one punch race. The event
-- stays the punch's even after a later, earlier punch of its burst retires
-- it, so a redelivery never appends it again.
--
-- System voids never carry the punch (0050: only device rows do), so the
-- index covers original device events only. The foreign key to
-- biometric_punch arrives with the biometric tables (0058).
-- =====================================================================

CREATE UNIQUE INDEX ux_attendance_event_device_punch
  ON attendance_event (organization_id, biometric_punch_id)
  WHERE biometric_punch_id IS NOT NULL;
