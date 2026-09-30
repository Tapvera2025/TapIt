import type { Resource } from '@tapcrm/authz';

export type HandoverStatus = 'pending' | 'accepted' | 'declined' | 'expired';
export type HandoverDisposition = 'accepted' | 'rejected' | 'callback';
export type HandoverAvailability = 'working' | 'on_break' | 'not_punched_in';
export type HandoverMode = 'direct' | 'team_queue';

export interface Handover {
  id: string; organizationId: string; leadId: string; fromUserId: string; fromUserName: string | null;
  toUserId: string | null; toUserName: string | null; status: HandoverStatus; handoverMode: HandoverMode; offeredAt: Date; acceptedAt: Date | null;
  declinedAt: Date | null; expiredAt: Date | null; disposition: HandoverDisposition | null; dispositionAt: Date | null;
  reason: string | null; annotations: Record<string, unknown>; corrections: HandoverAnnotation[]; queueClaimedAt: Date | null; timeToAcceptSeconds: number | null; timeToOutcomeSeconds: number | null;
}

export interface HandoverAnnotation { id: string; authorId: string; annotation: string; createdAt: Date; }

export interface HandoverTarget { id: string; fullName: string; positionCode: 'sales-supervisor' | 'sales-team-lead'; teamId: string | null; availability: HandoverAvailability; selectable: boolean; acceptedLastHour: number; }
export type HandoverResource = Resource & { organizationId: string; leadId: string; fromUserId: string; toUserId: string | null; status: string; handoverMode: HandoverMode; disposition: string | null; ownerId: string | null; currentHolderId: string | null; salesTeamId: string | null; salesPoolId: string | null; departmentId: string | null };
