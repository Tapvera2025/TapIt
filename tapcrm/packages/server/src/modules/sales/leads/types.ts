import type { Resource } from '@tapcrm/authz';

export const LEAD_STATUSES = ['new', 'assigned', 'contacted', 'discovery', 'proposal_sent', 'follow_up', 'callback_scheduled', 'nurture', 'converted', 'closed_lost'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type LeadDirection = 'inbound' | 'outbound';
export type LeadSourceStatus = 'active' | 'inactive';
export const LEAD_LOSS_REASONS = ['not_interested', 'no_budget', 'no_need', 'competitor', 'unqualified', 'timing', 'duplicate', 'other', 'unspecified'] as const;
export type LeadLossReason = (typeof LEAD_LOSS_REASONS)[number];

export interface LeadSource { id: string; organizationId: string; name: string; direction: LeadDirection; status: LeadSourceStatus; createdAt: Date; updatedAt: Date; }
export interface Campaign { id: string; organizationId: string; name: string; status: LeadSourceStatus; createdAt: Date; updatedAt: Date; }
export type LeadActivityEvent = 'lead.created' | 'lead.assigned' | 'lead.status_changed' | 'lead.nurtured' | 'lead.stalled' | 'call.recorded' | 'handover.offered' | 'handover.accepted' | 'handover.declined' | 'handover.expired' | 'handover.disposition_recorded' | 'callback.scheduled' | 'callback.rescheduled' | 'callback.completed' | 'callback.missed' | 'callback.cancelled' | 'callback.requested' | 'deal.creation_requested' | 'lead.closed_lost' | 'duplicate.warning' | 'lead.reengaged';
export interface LeadActivity { id: string; eventName: LeadActivityEvent; actorId: string | null; metadata: Record<string, unknown>; createdAt: Date; }
export interface Lead {
  id: string; organizationId: string; leadNumber: string; ownerId: string | null; ownerName: string | null;
  currentHolderId: string | null; currentHolderName: string | null; territoryId: string | null; territoryName: string | null;
  salesTeamId: string | null; salesTeamName: string | null; salesPoolId: string | null; salesPoolName: string | null;
  sourceId: string; sourceName: string; sourceDirection: LeadDirection; campaignId: string | null; campaignName: string | null;
  status: LeadStatus; routingStatus: 'assigned' | 'unrouted'; contactName: string; companyName: string | null;
  phone: string | null; email: string | null; lossReason: LeadLossReason | null; lostAt: Date | null; previousLeadId: string | null; stalledAt: Date | null; stalledReason: string | null; createdBy: string; createdAt: Date; updatedAt: Date; activities: LeadActivity[];
}
export type LeadResource = Resource & Pick<Lead, 'organizationId' | 'ownerId' | 'currentHolderId' | 'salesTeamId' | 'salesPoolId'> & { departmentId: string | null };
export interface DuplicateWarning { leadId: string; leadNumber: string; ownerId: string | null; ownerName: string | null; }
export interface LeadCreateResult { lead: Lead; duplicates: DuplicateWarning[]; }
export interface PaginatedLeads { items: Lead[]; total: number; page: number; pageSize: number; totalPages: number; }

export type HandoverStatus = 'pending' | 'accepted' | 'declined' | 'expired';
export type HandoverDisposition = 'accepted' | 'rejected' | 'callback';
export type HandoverAvailability = 'working' | 'on_break' | 'not_punched_in';
export interface Handover {
  id: string; organizationId: string; leadId: string; fromUserId: string; fromUserName: string | null;
  toUserId: string; toUserName: string | null; status: HandoverStatus; offeredAt: Date; acceptedAt: Date | null;
  declinedAt: Date | null; expiredAt: Date | null; disposition: HandoverDisposition | null; dispositionAt: Date | null;
  reason: string | null; annotations: Record<string, unknown>; timeToAcceptSeconds: number | null; timeToOutcomeSeconds: number | null;
}
export interface HandoverTarget { id: string; fullName: string; positionCode: 'sales-supervisor' | 'sales-team-lead'; teamId: string | null; availability: HandoverAvailability; selectable: boolean; }
export type CallbackStatus = 'pending' | 'completed' | 'rescheduled' | 'not_reachable' | 'missed' | 'cancelled';
export type CallbackOutcome = 'connected' | 'follow_up_required' | 'converted' | 'not_interested' | 'not_reachable' | 'other';
export interface CallbackReminderDelivery { id: string; recipientId: string; channel: 'in-app' | 'push' | 'email' | 'whatsapp'; status: 'scheduled' | 'sent' | 'delivered' | 'failed'; scheduledAt: string; sentAt: string | null; deliveredAt: string | null; failedAt: string | null; detail: string | null; }
export interface CallbackReminder { id: string; reminderType: 't_minus_60' | 't_minus_15' | 'due'; scheduledAt: string; deliveries: CallbackReminderDelivery[]; }
export interface LeadCallback { id: string; organizationId: string; leadId: string; leadNumber: string; leadContactName: string; ownerId: string; ownerName: string | null; scheduledAt: Date; reason: string | null; status: CallbackStatus; outcome: CallbackOutcome | null; parentCallbackId: string | null; organizationTimezone: string; reminders: CallbackReminder[]; completedAt: Date | null; missedAt: Date | null; cancelledAt: Date | null; createdBy: string; createdAt: Date; updatedAt: Date; }
export type HandoverResource = Resource & { organizationId: string; leadId: string; fromUserId: string; toUserId: string; status: string; disposition: string | null; ownerId: string | null; currentHolderId: string | null; salesTeamId: string | null; salesPoolId: string | null; departmentId: string | null };
