import { loadConfig } from '../../../config.js';

/**
 * Google Calendar v3 over plain fetch: free/busy, and events with a Google
 * Meet conference. Every call acts on the token holder's primary calendar.
 *
 *   freeBusy        POST /calendar/v3/freeBusy
 *   insert          POST /calendar/v3/calendars/primary/events
 *                   ?conferenceDataVersion=1&sendUpdates=all — the new
 *                   conference (a fresh Meet link per event, as Google
 *                   recommends) and Google's own invitations to every guest
 *   patch / delete  the same event, with sendUpdates so guests hear about it
 */

export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
] as const;

/** Google refused the token: the person has to connect again. */
export class CalendarAuthError extends Error {}
/** Anything else that went wrong talking to Google. */
export class CalendarError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
  }
}

export interface BusyInterval {
  readonly start: Date;
  readonly end: Date;
}

export interface CalendarGuest {
  readonly email: string;
  readonly name?: string | null;
}

export interface NewCalendarEvent {
  readonly summary: string;
  readonly description: string;
  readonly start: Date;
  readonly end: Date;
  readonly timeZone: string;
  readonly guests: readonly CalendarGuest[];
  /** Unique per attempt; Google ignores a repeated conference request id. */
  readonly requestId: string;
}

export interface CalendarEvent {
  readonly eventId: string;
  readonly meetUrl: string | null;
}

interface GoogleEvent {
  readonly id?: string;
  readonly hangoutLink?: string;
  readonly attendees?: ReadonlyArray<{ email?: string; displayName?: string; responseStatus?: string; organizer?: boolean }>;
  readonly conferenceData?: {
    readonly entryPoints?: ReadonlyArray<{ entryPointType?: string; uri?: string }>;
    readonly createRequest?: { status?: { statusCode?: string } };
  };
}

function base(): string {
  return `${loadConfig().GOOGLE_API_BASE_URL.replace(/\/$/, '')}/calendar/v3`;
}

async function call<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${base()}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (cause) {
    throw new CalendarError(`Google Calendar unreachable: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (response.status === 204 || (method === 'DELETE' && response.ok)) return undefined as T;
  const payload = (await response.json().catch(() => ({}))) as { error?: { message?: string; status?: string } } & T;
  if (response.status === 401 || response.status === 403) {
    throw new CalendarAuthError(payload.error?.message ?? `Google refused access (HTTP ${response.status})`);
  }
  if (!response.ok) {
    throw new CalendarError(payload.error?.message ?? `Google Calendar answered HTTP ${response.status}`, response.status);
  }
  return payload;
}

function meetUrlOf(event: GoogleEvent): string | null {
  const video = event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === 'video')?.uri;
  return video ?? event.hangoutLink ?? null;
}

/** Busy times on the token holder's primary calendar between the two instants. */
export async function freeBusy(token: string, from: Date, to: Date): Promise<BusyInterval[]> {
  const result = await call<{ calendars?: Record<string, { busy?: Array<{ start: string; end: string }>; errors?: unknown[] }> }>(
    token,
    'POST',
    '/freeBusy',
    { timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: 'primary' }] },
  );
  const calendar = result.calendars?.['primary'] ?? Object.values(result.calendars ?? {})[0];
  if (!calendar) return [];
  if (calendar.errors?.length) throw new CalendarError('Google could not read this calendar');
  return (calendar.busy ?? []).map((slot) => ({ start: new Date(slot.start), end: new Date(slot.end) }));
}

/** Creates the event with a Meet link and has Google invite every guest. */
export async function insertEvent(token: string, input: NewCalendarEvent): Promise<CalendarEvent> {
  const body = {
    summary: input.summary,
    description: input.description,
    start: { dateTime: input.start.toISOString(), timeZone: input.timeZone },
    end: { dateTime: input.end.toISOString(), timeZone: input.timeZone },
    attendees: input.guests.map((guest) => ({ email: guest.email, ...(guest.name ? { displayName: guest.name } : {}) })),
    guestsCanInviteOthers: false,
    reminders: { useDefault: true },
    conferenceData: {
      createRequest: { requestId: input.requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } },
    },
  };
  let event = await call<GoogleEvent>(token, 'POST', '/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all', body);
  const eventId = event.id;
  if (!eventId) throw new CalendarError('Google did not return the new event');
  // The conference is usually ready at once; when Google is still making it,
  // read the event back briefly.
  for (let attempt = 0; attempt < 3 && !meetUrlOf(event); attempt += 1) {
    if (event.conferenceData?.createRequest?.status?.statusCode === 'failure') break;
    await new Promise((resolve) => setTimeout(resolve, 800));
    event = await call<GoogleEvent>(token, 'GET', `/calendars/primary/events/${encodeURIComponent(eventId)}`);
  }
  return { eventId, meetUrl: meetUrlOf(event) };
}

/** Moves the event; Google tells the guests. The Meet link stays the same. */
export async function moveEvent(token: string, eventId: string, start: Date, end: Date, timeZone: string): Promise<void> {
  await call(token, 'PATCH', `/calendars/primary/events/${encodeURIComponent(eventId)}?conferenceDataVersion=1&sendUpdates=all`, {
    start: { dateTime: start.toISOString(), timeZone },
    end: { dateTime: end.toISOString(), timeZone },
  });
}

/** Adds someone to the guest list without emailing the others. */
export async function addGuest(token: string, eventId: string, guest: CalendarGuest): Promise<void> {
  const event = await call<GoogleEvent>(token, 'GET', `/calendars/primary/events/${encodeURIComponent(eventId)}`);
  const attendees = [...(event.attendees ?? [])];
  if (attendees.some((attendee) => attendee.email?.toLowerCase() === guest.email.toLowerCase())) return;
  attendees.push({ email: guest.email, ...(guest.name ? { displayName: guest.name } : {}) });
  await call(token, 'PATCH', `/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=none`, { attendees });
}

/** Cancels the event; Google tells the guests. */
export async function deleteEvent(token: string, eventId: string): Promise<void> {
  try {
    await call(token, 'DELETE', `/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`);
  } catch (cause) {
    // Already gone from the calendar (deleted there by hand): nothing to cancel.
    if (cause instanceof CalendarError && (cause.status === 404 || cause.status === 410)) return;
    throw cause;
  }
}
