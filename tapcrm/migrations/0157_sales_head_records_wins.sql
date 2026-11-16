-- =====================================================================
-- 0157 — Only the Sales Head records a deal as won
--
-- PRD §10.5: "The Sales Department Head confirms the advance payment
-- (`deals:confirm-payment`) and then records the win (`deals:record-win`)."
-- Every win reports to the Head's wins-to-record queue (DL-5). The starter
-- matrix gave the whole deals module to every sales position, so team
-- leads, supervisors and agents could also record wins on their own deals.
--
-- The matrix no longer emits it outside the Sales Head (policy-matrix.ts,
-- SALES_HEAD_ONLY_ACTIONS). This removes the grant the matrix handed out
-- at team, pool and own scope, the same way 0156 did for confirming the
-- advance. The Sales Head's department-wide grant is kept. A Super Admin
-- can grant it again to a position on purpose.
-- =====================================================================

DELETE FROM position_policy
 WHERE action = 'deals:record-win'
   AND scope IN ('team', 'pool', 'own', 'participant');
