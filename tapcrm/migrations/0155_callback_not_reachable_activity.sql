-- =====================================================================
-- 0155 — "Couldn't reach them" gets its own timeline entry
--
-- An agent who called and got no answer recorded the callback as
-- not reachable, but the lead's timeline said "Callback missed", which
-- reads as if nobody called at all. A missed callback (nobody called in
-- time) and an unanswered call are different facts, so they are now two
-- different activity events.
--
-- Existing entries written for an unanswered call are relabelled: they
-- are found through the callback they name, whose status is
-- 'not_reachable'. Entries for callbacks that really were missed stay as
-- they are.
-- =====================================================================

ALTER TABLE lead_activity DROP CONSTRAINT IF EXISTS lead_activity_event_name_check;
ALTER TABLE lead_activity ADD CONSTRAINT lead_activity_event_name_check CHECK (event_name IN (
  'lead.created',
  'lead.assigned',
  'lead.reassigned',
  'lead.status_changed',
  'lead.nurtured',
  'lead.stalled',
  'lead.closed_lost',
  'lead.converted',
  'lead.reengaged',
  'call.recorded',
  'handover.offered',
  'handover.accepted',
  'handover.declined',
  'handover.expired',
  'handover.disposition_recorded',
  'callback.scheduled',
  'callback.rescheduled',
  'callback.completed',
  'callback.missed',
  'callback.not_reachable',
  'callback.cancelled',
  'callback.requested',
  'deal.creation_requested',
  'duplicate.warning',
  'whatsapp.message_received',
  'whatsapp.message_sent',
  'demo.scheduled',
  'demo.completed',
  'proposal.follow_up'
));

UPDATE lead_activity a
   SET event_name = 'callback.not_reachable'
  FROM lead_callback c
 WHERE a.event_name               = 'callback.missed'
   AND c.organization_id          = a.organization_id
   AND c.id::text                 = a.metadata ->> 'callbackId'
   AND c.status                   = 'not_reachable';
