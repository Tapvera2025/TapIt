-- Leads left on "callback scheduled" after their callback ended.
--
-- Recording a callback outcome never moved the lead on, so a lead stayed on
-- "callback scheduled" with nothing booked. The services now move it when
-- the callback ends; this moves the ones left behind before that, using the
-- lead's latest callback: a call that got through leaves it contacted, and
-- anything else leaves it in follow-up. Each move is recorded on the lead's
-- activity timeline.

WITH stuck AS (
  SELECT l.organization_id,
         l.id AS lead_id,
         CASE
           WHEN last_callback.status = 'completed'
            AND COALESCE(last_callback.outcome, '') NOT IN ('follow_up_required', 'not_reachable')
           THEN 'contacted'
           ELSE 'follow_up'
         END AS next_status
    FROM lead l
    LEFT JOIN LATERAL (
      SELECT c.status, c.outcome
        FROM lead_callback c
       WHERE c.organization_id = l.organization_id
         AND c.lead_id         = l.id
       ORDER BY COALESCE(c.completed_at, c.missed_at, c.cancelled_at, c.updated_at) DESC
       LIMIT 1
    ) last_callback ON true
   WHERE l.status = 'callback_scheduled'
     AND NOT EXISTS (
       SELECT 1
         FROM lead_callback p
        WHERE p.organization_id = l.organization_id
          AND p.lead_id         = l.id
          AND p.status          = 'pending'
     )
),
moved AS (
  UPDATE lead l
     SET status = stuck.next_status
    FROM stuck
   WHERE l.organization_id = stuck.organization_id
     AND l.id              = stuck.lead_id
  RETURNING l.organization_id, l.id, l.status
)
INSERT INTO lead_activity (organization_id, lead_id, event_name, actor_id, metadata)
SELECT organization_id,
       id,
       'lead.status_changed',
       NULL,
       jsonb_build_object('from', 'callback_scheduled', 'to', status, 'reason', 'callback_already_ended')
  FROM moved;
