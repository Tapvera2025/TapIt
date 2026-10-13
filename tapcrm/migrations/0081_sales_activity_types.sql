-- Sales v1.1 — extend lead_activity.event_name with the activity types
-- the R1 adapters produce (R1 plan step 1.18 + flagged follow-ups from
-- steps 1.5 reassign + 1.9 WhatsApp).

ALTER TABLE lead_activity DROP CONSTRAINT IF EXISTS lead_activity_event_name_check;
ALTER TABLE lead_activity ADD CONSTRAINT lead_activity_event_name_check CHECK (event_name IN (
  'lead.created',
  'lead.assigned',
  'lead.reassigned',
  'lead.status_changed',
  'lead.nurtured',
  'lead.stalled',
  'lead.closed_lost',
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
