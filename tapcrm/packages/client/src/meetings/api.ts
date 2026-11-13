import { identityRequest } from '../identity/api/authApi.js';

export type MeetingStatus = 'requested' | 'proposed' | 'confirmed' | 'declined' | 'cancelled' | 'expired' | 'completed' | 'no_show';

export const MEETING_DURATIONS = [15, 30, 45, 60] as const;

export interface MeetingAttendee {
  userId: string | null;
  email: string | null;
  name: string | null;
  role: 'host' | 'staff' | 'client' | 'observer';
}

export interface MeetingProposal {
  id: string;
  startsAt: string;
  endsAt: string;
  chosenAt: string | null;
  withdrawnAt: string | null;
}

export interface MeetingHistoryEntry {
  event: string;
  actorKind: 'client' | 'staff' | 'system';
  actorName: string | null;
  detail: Record<string, unknown>;
  at: string;
}

export interface Meeting {
  id: string;
  title: string;
  agenda: string | null;
  status: MeetingStatus;
  origin: 'client' | 'staff';
  host: { id: string; name: string; role: string | null };
  client: { id: string; name: string; businessName: string } | null;
  project: { id: string; name: string } | null;
  requestedBy: { id: string; name: string; kind: 'client' | 'staff' };
  startsAt: string;
  endsAt: string;
  clientTimezone: string | null;
  meetUrl: string | null;
  onCalendar: boolean;
  calendarError: string | null;
  respondedAt: string | null;
  declineReason: string | null;
  cancelReason: string | null;
  cancelledBy: { name: string; kind: 'client' | 'staff' } | null;
  outcomeNote: string | null;
  attendees: MeetingAttendee[];
  proposals: MeetingProposal[];
  history: MeetingHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface MeetingSlot {
  startsAt: string;
  endsAt: string;
  hostIds?: string[];
}

export interface Availability {
  slots: MeetingSlot[];
  calendarUnchecked: Array<{ id: string; name: string; reason: string }>;
  timezone: string;
}

export interface CalendarConnection {
  mode: 'off' | 'oauth' | 'service-account';
  connected: boolean;
  accountEmail: string | null;
  needsReconnect: boolean;
  lastError: string | null;
  connectedAt: string | null;
}

export interface MeetableClient {
  id: string;
  name: string;
  businessName: string;
  projects: Array<{ id: string; name: string }>;
}

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

function query(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : '';
}

/* Staff */

export const listMyMeetings = (params: { from?: string; to?: string } = {}) =>
  identityRequest<{ items: Meeting[] }>(`/api/meetings/mine${query(params)}`).then((result) => result.items);
export const listAllMeetings = (params: { from?: string; to?: string; status?: string } = {}) =>
  identityRequest<{ items: Meeting[] }>(`/api/meetings${query(params)}`).then((result) => result.items);
export const listMeetingPeople = () =>
  identityRequest<{ items: Array<{ id: string; name: string; role: string | null }> }>('/api/meetings/people').then((result) => result.items);
export const listMeetableClients = () =>
  identityRequest<{ items: MeetableClient[] }>('/api/meetings/clients').then((result) => result.items);
export const getAvailability = (userIds: readonly string[], durationMinutes: number, days = 14) =>
  identityRequest<Availability>(`/api/meetings/availability${query({ userIds: userIds.join(','), durationMinutes, days })}`);
export const scheduleMeeting = (input: {
  clientId: string;
  projectId: string | null;
  title: string;
  agenda: string | null;
  startsAt: string;
  durationMinutes: number;
  staffIds: string[];
  meetUrl: string | null;
}) => identityRequest<Meeting>('/api/meetings', json(input));
export const acceptMeeting = (id: string, meetUrl: string | null) =>
  identityRequest<Meeting>(`/api/meetings/${encodeURIComponent(id)}/accept`, json({ meetUrl }));
export const proposeMeetingTimes = (id: string, times: string[], note: string | null) =>
  identityRequest<Meeting>(`/api/meetings/${encodeURIComponent(id)}/propose`, json({ times, note }));
export const declineMeeting = (id: string, reason: string) =>
  identityRequest<Meeting>(`/api/meetings/${encodeURIComponent(id)}/decline`, json({ reason }));
export const cancelMeeting = (id: string, reason: string) =>
  identityRequest<Meeting>(`/api/meetings/${encodeURIComponent(id)}/cancel`, json({ reason }));
export const recordMeetingOutcome = (id: string, outcome: 'completed' | 'no_show', note: string | null) =>
  identityRequest<Meeting>(`/api/meetings/${encodeURIComponent(id)}/outcome`, json({ outcome, note }));
export const setMeetingLink = (id: string, meetUrl: string) =>
  identityRequest<Meeting>(`/api/meetings/${encodeURIComponent(id)}/link`, { method: 'PATCH', body: JSON.stringify({ meetUrl }) });
export const joinMeeting = (id: string) =>
  identityRequest<{ meetUrl: string; meeting: Meeting }>(`/api/meetings/${encodeURIComponent(id)}/join`, { method: 'POST' });

export const getCalendarConnection = () => identityRequest<CalendarConnection>('/api/meetings/calendar');
export const startCalendarConnect = () => identityRequest<{ authorizationUrl: string }>('/api/meetings/calendar/connect', { method: 'POST' });
export const completeCalendarConnect = (code: string, state: string) =>
  identityRequest<CalendarConnection>('/api/meetings/calendar/complete', json({ code, state }));
export const disconnectCalendar = () => identityRequest<CalendarConnection>('/api/meetings/calendar', { method: 'DELETE' });

/* Client portal */

export interface PortalMeeting {
  id: string;
  title: string;
  agenda: string | null;
  status: MeetingStatus;
  host: { name: string; role: string | null };
  project: { id: string; name: string } | null;
  startsAt: string;
  endsAt: string;
  meetUrl: string | null;
  proposals: Array<{ id: string; startsAt: string; endsAt: string }>;
  declineReason: string | null;
  cancelReason: string | null;
  cancelledByYou: boolean | null;
  requestedByYou: boolean;
  createdAt: string;
}

export const listPortalMeetings = () =>
  identityRequest<{ items: PortalMeeting[] }>('/api/client-portal/meetings').then((result) => result.items);
export const getPortalMeetingHosts = (projectId: string) =>
  identityRequest<{ project: { id: string; name: string }; hosts: Array<{ id: string; name: string; role: string | null }> }>(
    `/api/client-portal/projects/${encodeURIComponent(projectId)}/meeting-hosts`,
  );
export const getPortalMeetingSlots = (projectId: string, hostId: string | null, durationMinutes: number) =>
  identityRequest<{ timezone: string; slots: MeetingSlot[] }>(
    `/api/client-portal/projects/${encodeURIComponent(projectId)}/meeting-slots${query({ hostId, durationMinutes })}`,
  );
export const requestPortalMeeting = (input: { projectId: string; hostId: string | null; startsAt: string; durationMinutes: number; agenda: string }) =>
  identityRequest<PortalMeeting>('/api/client-portal/meetings', json(input));
export const choosePortalMeetingTime = (id: string, proposalId: string) =>
  identityRequest<PortalMeeting>(`/api/client-portal/meetings/${encodeURIComponent(id)}/choose`, json({ proposalId }));
export const cancelPortalMeeting = (id: string, reason: string | null) =>
  identityRequest<PortalMeeting>(`/api/client-portal/meetings/${encodeURIComponent(id)}/cancel`, json({ reason }));
