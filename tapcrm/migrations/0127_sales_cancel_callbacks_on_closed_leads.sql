-- Callbacks left open on leads that are already converted or closed-lost.
--
-- A converted or closed-lost lead cannot have a callback, but converting or
-- closing a lead did not close its pending callback. Those callbacks stayed in
-- the owner's My Work, kept sending reminders and were later marked missed.
-- The services now cancel them when a lead closes; this cancels the ones left
-- behind before that, and records each one on the lead's activity timeline.

WITH cancelled AS (
  UPDATE lead_callback c
     SET status       = 'cancelled',
         cancelled_at = now(),
         updated_at   = now()
    FROM lead l
   WHERE l.organization_id = c.organization_id
     AND l.id              = c.lead_id
     AND l.status IN ('converted', 'closed_lost')
     AND c.status = 'pending'
  RETURNING c.organization_id, c.lead_id, c.id, l.status AS lead_status
)
INSERT INTO lead_activity (organization_id, lead_id, event_name, actor_id, metadata)
SELECT organization_id,
       lead_id,
       'callback.cancelled',
       NULL,
       jsonb_build_object(
         'callbackId', id,
         'reason', CASE WHEN lead_status = 'converted' THEN 'lead_converted' ELSE 'lead_closed_lost' END
       )
  FROM cancelled;
