-- =====================================================================
-- 0060 - Employment dates on employee records (roadmap finding 6)
--
-- The first and last day a person works here. Attendance opens days only
-- inside this window (§8.6), a day outside it is `not-employed`, a device
-- punch outside it is refused for review (§10.3 step 6), and payroll
-- prorates by it (L23). Both are inclusive calendar dates in the
-- organization's timezone.
--
-- Nullable: a record without a joining date has no lower bound, and one
-- without a leaving date falls back to the account status, as before. HR
-- fills them in; nothing is guessed from when an account was created.
-- =====================================================================

ALTER TABLE app_user
  ADD COLUMN joined_on date,
  ADD COLUMN left_on   date,
  -- Only an employee has an employment window.
  ADD CONSTRAINT app_user_employment_dates_employee
    CHECK ((joined_on IS NULL AND left_on IS NULL) OR account_type = 'employee'),
  ADD CONSTRAINT app_user_employment_window
    CHECK (left_on IS NULL OR joined_on IS NULL OR left_on >= joined_on);

-- No new grants: app_user is already written by the app role.
