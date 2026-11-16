-- =====================================================================
-- 0156 — Only the Sales Head confirms a deal's advance payment
--
-- PRD §10.5 / DL-4b: confirming that the advance arrived is a separate,
-- audited act "held by the Sales Department Head". The starter matrix gave
-- the whole deals module to every sales position, so team leads,
-- supervisors and agents were also granted `deals:confirm-payment` on
-- their own deals and saw the "Confirm advance received" button.
--
-- The matrix no longer emits it outside the Sales Head (policy-matrix.ts,
-- SALES_HEAD_ONLY_ACTIONS). This removes the grant the matrix handed out
-- at team, pool and own scope, the same way 0065 removed HR-only People
-- powers from narrower cells. The Sales Head's department-wide grant is
-- kept. A Super Admin can grant it again to a position on purpose.
-- =====================================================================

DELETE FROM position_policy
 WHERE action = 'deals:confirm-payment'
   AND scope IN ('team', 'pool', 'own', 'participant');
