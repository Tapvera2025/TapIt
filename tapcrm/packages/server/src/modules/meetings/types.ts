export const MEETING_STATUSES = [
  'requested',
  'proposed',
  'confirmed',
  'declined',
  'cancelled',
  'expired',
  'completed',
  'no_show',
] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

/** Still to happen: these hold the people's time. */
export const OPEN_STATUSES: readonly MeetingStatus[] = ['requested', 'proposed', 'confirmed'];

/** Meeting lengths offered, in minutes. */
export const MEETING_DURATIONS = [15, 30, 45, 60] as const;

export type MeetingOrigin = 'client' | 'staff';
export type AttendeeRole = 'host' | 'staff' | 'client' | 'observer';
export type ActorKind = 'client' | 'staff' | 'system';

export interface MeetingPerson {
  readonly id: string;
  readonly name: string;
  readonly role: string | null;
}

export interface MeetingAttendee {
  readonly userId: string | null;
  readonly email: string | null;
  readonly name: string | null;
  readonly role: AttendeeRole;
}

export interface MeetingProposal {
  readonly id: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly chosenAt: Date | null;
  readonly withdrawnAt: Date | null;
}

export interface MeetingHistoryEntry {
  readonly event: string;
  readonly actorKind: ActorKind;
  readonly actorName: string | null;
  readonly detail: Record<string, unknown>;
  readonly at: Date;
}

/** A meeting as staff see it. */
export interface Meeting {
  readonly id: string;
  readonly title: string;
  readonly agenda: string | null;
  readonly status: MeetingStatus;
  readonly origin: MeetingOrigin;
  readonly host: MeetingPerson;
  readonly client: { readonly id: string; readonly name: string; readonly businessName: string } | null;
  readonly project: { readonly id: string; readonly name: string } | null;
  readonly requestedBy: { readonly id: string; readonly name: string; readonly kind: 'client' | 'staff' };
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly clientTimezone: string | null;
  readonly meetUrl: string | null;
  readonly onCalendar: boolean;
  readonly calendarError: string | null;
  readonly respondedAt: Date | null;
  readonly declineReason: string | null;
  readonly cancelReason: string | null;
  readonly cancelledBy: { readonly name: string; readonly kind: 'client' | 'staff' } | null;
  readonly outcomeNote: string | null;
  readonly attendees: readonly MeetingAttendee[];
  readonly proposals: readonly MeetingProposal[];
  readonly history: readonly MeetingHistoryEntry[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * A meeting as the client sees it in the portal: the host's name and role,
 * never their contact details, calendar or the internal history.
 */
export interface PortalMeeting {
  readonly id: string;
  readonly title: string;
  readonly agenda: string | null;
  readonly status: MeetingStatus;
  readonly host: { readonly name: string; readonly role: string | null };
  readonly project: { readonly id: string; readonly name: string } | null;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly meetUrl: string | null;
  /** Times the host offered instead, still open to pick. */
  readonly proposals: ReadonlyArray<{ readonly id: string; readonly startsAt: Date; readonly endsAt: Date }>;
  readonly declineReason: string | null;
  readonly cancelReason: string | null;
  readonly cancelledByYou: boolean | null;
  readonly requestedByYou: boolean;
  readonly createdAt: Date;
}

export interface MeetingSlot {
  readonly startsAt: Date;
  readonly endsAt: Date;
  /** Who is free then — for "anyone from the team". */
  readonly hostIds: readonly string[];
}

export interface AvailabilityResult {
  readonly slots: readonly MeetingSlot[];
  /** People whose Google Calendar could not be read (their TapCRM schedule still counts). */
  readonly calendarUnchecked: ReadonlyArray<{ readonly id: string; readonly name: string; readonly reason: string }>;
  readonly timezone: string;
}

/** What a route's resource loader returns for the meeting policy. */
export interface MeetingResource {
  readonly type: 'meeting';
  readonly id: string;
  readonly organizationId: string;
  readonly hostId: string;
  readonly hostTeamId: string | null;
  readonly hostDepartmentId: string | null;
  readonly status: MeetingStatus;
  readonly [field: string]: unknown;
}
