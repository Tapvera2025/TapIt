-- =====================================================================
-- 0052 - Attendance day-open signals (§8.6, guard A)
--
-- One extra column on the watermark row: the earliest date the last run
-- could not finish. Advancing the watermark reads this column and stops
-- short of that date. Cleared on the run that completes it.
-- =====================================================================

ALTER TABLE attendance_day_open_state
  ADD COLUMN last_failed_date date;

-- No new grants (owned by attendance already).
