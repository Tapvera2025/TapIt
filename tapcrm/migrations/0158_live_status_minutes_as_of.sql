-- =====================================================================
-- 0158 — Live attendance: record when the minute counts were worked out
--
-- `user_status` holds each person's worked and break minutes for the day.
-- They are worked out when something happens (a punch, a break, the end
-- of the shift), not every minute, so screens add the time that has
-- passed since then to whichever count is still running.
--
-- Screens used to count from `since`, the start of the current stretch.
-- That is only right when the row was worked out at that same moment; a
-- row worked out later (at shift end, for example) already includes part
-- of the stretch, and those minutes were counted twice. This column says
-- exactly when the counts were worked out. Rows written before it stay
-- NULL until their next update, and screens fall back to `since` for them.
-- =====================================================================

ALTER TABLE user_status ADD COLUMN minutes_as_of timestamptz;
