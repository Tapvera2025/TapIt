/**
 * Sales v1.1 — centralised activity-type union (R1 plan step 1.18).
 *
 * Every call site that writes to `lead_activity.event_name` imports
 * from here so the TS union stays in lock-step with the DB constraint
 * (see migration 0078). Adding a new activity type is a two-line change
 * — bump the migration + bump the array below.
 */

export const LEAD_ACTIVITY_EVENTS = [
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
  'proposal.follow_up',
] as const;

export type LeadActivityEvent = (typeof LEAD_ACTIVITY_EVENTS)[number];

export function isLeadActivityEvent(value: string): value is LeadActivityEvent {
  return (LEAD_ACTIVITY_EVENTS as readonly string[]).includes(value);
}
