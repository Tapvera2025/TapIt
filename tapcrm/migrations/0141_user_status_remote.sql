-- =====================================================================
-- 0141 — Live status: punches from outside the office without WFH
--
-- A web or mobile punch-in without approved WFH is flagged
-- `remote-without-approval` when the day is calculated, but the live board
-- and the Today page only knew `is_wfh`, so they called such a person
-- "In Office" all day. The projector now records the same rule on the row:
-- the day's arrival came from the web or the app and there is no WFH
-- approval. Rows are rebuilt by the projector on the next event or sweep.
-- =====================================================================

ALTER TABLE user_status
  ADD COLUMN is_remote boolean NOT NULL DEFAULT false;
