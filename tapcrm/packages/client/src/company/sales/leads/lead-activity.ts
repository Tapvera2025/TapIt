/**
 * Plain-words lines for the lead's Activity list.
 *
 * The API records events by name (LEAD_ACTIVITY_EVENTS in
 * server/src/modules/sales/leads/activity-types.ts); unknown names fall back
 * to the name itself with the dots and underscores turned into spaces.
 */
import { leadStatusLabel, lossReasonLabel } from './lead-status.js';

export interface LeadActivityLike {
  readonly eventName: string;
  readonly metadata?: Readonly<Record<string, unknown>> | null;
}

const EVENT_LABELS: Readonly<Record<string, string>> = {
  'lead.created': 'Lead added',
  'lead.assigned': 'Assigned to an owner',
  'lead.reassigned': 'Transferred to a new owner',
  'lead.nurtured': 'Moved to nurture',
  'lead.stalled': 'Flagged as stalled',
  'lead.reengaged': 'Re-engaged from an earlier lead',
  'call.recorded': 'Call logged',
  'handover.offered': 'Handover offered',
  'handover.accepted': 'Handover accepted',
  'handover.declined': 'Handover declined',
  'handover.expired': 'Handover expired',
  'handover.disposition_recorded': 'Handover outcome recorded',
  'callback.scheduled': 'Callback booked',
  'callback.rescheduled': 'Callback rescheduled',
  'callback.completed': 'Callback done',
  'callback.missed': 'Callback missed',
  'callback.not_reachable': 'Called, couldn’t reach them',
  'callback.cancelled': 'Callback cancelled',
  'callback.requested': 'Callback requested',
  'deal.creation_requested': 'Deal requested',
  'duplicate.warning': 'Possible duplicate found',
  'whatsapp.message_received': 'WhatsApp message received',
  'whatsapp.message_sent': 'WhatsApp message sent',
  'demo.scheduled': 'Demo booked',
  'demo.completed': 'Demo done',
  'proposal.follow_up': 'Proposal follow-up',
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function leadActivityLabel(activity: LeadActivityLike): string {
  const metadata = activity.metadata ?? {};
  switch (activity.eventName) {
    case 'lead.status_changed': {
      const from = text(metadata['from']);
      const to = text(metadata['to']);
      if (!to) return 'Status changed';
      return from
        ? `Status changed from ${leadStatusLabel(from)} to ${leadStatusLabel(to)}`
        : `Status changed to ${leadStatusLabel(to)}`;
    }
    case 'lead.closed_lost': {
      const reason = text(metadata['lossReason']);
      return reason ? `Marked as lost: ${lossReasonLabel(reason)}` : 'Marked as lost';
    }
    case 'lead.converted': {
      const dealNumber = text(metadata['dealNumber']);
      return dealNumber ? `Converted to deal #${dealNumber}` : 'Converted to a deal';
    }
    case 'lead.created': {
      const importName = text(metadata['importName']);
      return importName ? `Imported from “${importName}”` : (EVENT_LABELS['lead.created'] ?? 'Lead added');
    }
    case 'lead.assigned':
      return metadata['via'] === 'sheet' ? 'Assigned from the import sheet' : (EVENT_LABELS['lead.assigned'] ?? 'Assigned to an owner');
    default:
      return (
        EVENT_LABELS[activity.eventName] ?? activity.eventName.replaceAll(/[._]/g, ' ')
      );
  }
}

/** The deal a conversion entry points to. */
export function convertedDealId(activity: LeadActivityLike): string | null {
  return activity.eventName === 'lead.converted'
    ? text(activity.metadata?.['dealId'])
    : null;
}
