-- =====================================================================
-- 0164 — Recruitment is HR's workspace, not every employee's
--
-- The starter matrix gave the base-employee column every recruitment power
-- at `participant` scope, and every new position starts from that column.
-- So Developers, Sales Agents, interns and every custom position held
-- requisition, candidate, offer and joining powers, and the menu offered
-- them the whole Recruitment workspace, whose pages then came back empty.
--
-- The matrix now gives that column nothing in Recruitment
-- (policy-matrix.ts). Interviewers keep what they need: every position holds
-- `recruitment:submit-round-feedback` at `participant` scope (0077,
-- PARTICIPANT_EVERYWHERE_ACTIONS), which is all "My Interviews" uses.
--
-- This removes the grants the matrix handed out at `participant` scope, the
-- way 0156 and 0157 removed sales grants. HR's and HR Executive's
-- department-wide grants are kept, as is any other scope a tenant chose.
-- A Super Admin can grant recruitment powers to a position again on purpose.
-- =====================================================================

DELETE FROM position_policy
 WHERE action LIKE 'recruitment:%'
   AND action <> 'recruitment:submit-round-feedback'
   AND scope = 'participant';
