-- =====================================================================
-- 0074 — Interviewers in every position
--
-- HR can assign an interview round to anyone, but only positions whose
-- starter matrix cell reached recruitment (HR, and ordinary employees at
-- `participant`) could see "My Interviews" or submit feedback. 0070 granted
-- the action to the positions that existed then; positions provisioned since
-- from the matrix — Developer Team Manager, Department Heads, Project
-- Managers — were left without it, so a round assigned to them never showed.
--
-- `participant` reaches only the rounds a person is the interviewer of, so
-- this gives no other access to candidates. Existing rows (HR's department
-- scope, or a tenant's own choice) are kept: ON CONFLICT DO NOTHING.
-- =====================================================================

INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
SELECT p.organization_id, p.id, 'recruitment:submit-round-feedback', true, 'participant'
FROM position p
WHERE p.status = 'active'
ON CONFLICT (organization_id, position_id, action) DO NOTHING;
