import { randomUUID } from 'node:crypto';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { organizationTimezone } from './availability.js';
import { calendarAccess, markNeedsReconnect } from './google/access.js';
import { CalendarAuthError, addGuest, deleteEvent, insertEvent, moveEvent } from './google/calendar.js';
import { tellStaff } from './messages.js';
import { findMeeting, insertMeetingEvent, type MeetingRecord } from './repository.js';

/**
 * Keeps a confirmed meeting's Google Calendar event in step with TapCRM.
 * Runs after the meeting change commits: Google is slow and can fail, and the
 * meeting stands either way. A failure is recorded on the meeting and the host
 * is told, so they can reconnect or paste a link.
 */

function describe(row: MeetingRecord): string {
  return [
    row.agenda ?? '',
    row.projectName ? `Project: ${row.projectName}` : '',
    row.clientBusiness ? `Client: ${row.clientBusiness}` : '',
    'Booked through TapCRM.',
  ].filter(Boolean).join('\n\n');
}

async function recordFailure(ctx: RequestContext, row: MeetingRecord, message: string): Promise<void> {
  await db.transaction(ctx, async (tx) => {
    await tx.query(sql`UPDATE meeting SET calendar_error = ${message.slice(0, 500)} WHERE organization_id = ${ctx.organizationId} AND id = ${row.id}`);
    await insertMeetingEvent(tx, ctx.organizationId, row.id, 'calendar_failed', { id: null, kind: 'system' }, { message: message.slice(0, 300) });
    await tellStaff(tx, ctx, [row.hostId], {
      type: 'meeting.calendar_failed',
      title: 'Google Calendar did not take the meeting',
      body: `${message} Open the meeting to add a link yourself, or reconnect Google Calendar.`,
      meetingId: row.id,
      urgent: true,
      includeActor: true,
    });
  });
}

/** Creates the event with a Meet link on the host's calendar. Returns the link, if any. */
export async function putOnCalendar(ctx: RequestContext, meetingId: string): Promise<string | null> {
  const row = await findMeeting(ctx, meetingId);
  if (!row || row.status !== 'confirmed') return row?.meetUrl ?? null;
  if (row.calendarEventId) return row.meetUrl;
  const access = await calendarAccess(ctx, row.hostId);
  if (access.token === null) {
    if (access.reason === 'off') return row.meetUrl;
    if (!row.meetUrl) {
      await recordFailure(ctx, row, access.reason === 'not_connected'
        ? `${row.hostName} has not connected Google Calendar, so no Meet link was made.`
        : `${row.hostName}'s Google Calendar needs reconnecting, so no Meet link was made.`);
    }
    return row.meetUrl;
  }
  const zone = await db.transaction(ctx, (tx) => organizationTimezone(tx, ctx.organizationId));
  try {
    const guests = row.attendees
      .filter((attendee) => attendee.email && attendee.userId !== row.hostId)
      .map((attendee) => ({ email: attendee.email!, name: attendee.name }));
    const event = await insertEvent(access.token, {
      summary: row.title,
      description: describe(row),
      start: new Date(row.startsAt),
      end: new Date(row.endsAt),
      timeZone: zone,
      guests,
      requestId: randomUUID(),
    });
    await db.transaction(ctx, (tx) => tx.query(sql`
      UPDATE meeting
         SET calendar_event_id = ${event.eventId}, calendar_owner_id = ${row.hostId},
             meet_url = COALESCE(${event.meetUrl}, meet_url), calendar_error = NULL
       WHERE organization_id = ${ctx.organizationId} AND id = ${row.id}
    `));
    return event.meetUrl ?? row.meetUrl;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (cause instanceof CalendarAuthError) await markNeedsReconnect(ctx, row.hostId, message);
    await recordFailure(ctx, row, `Google Calendar refused the event (${message}).`);
    return row.meetUrl;
  }
}

/** Moves the event to the meeting's current time, or creates it when there is none yet. */
export async function moveOnCalendar(ctx: RequestContext, meetingId: string): Promise<string | null> {
  const row = await findMeeting(ctx, meetingId);
  if (!row || row.status !== 'confirmed') return null;
  if (!row.calendarEventId || !row.calendarOwnerId) return putOnCalendar(ctx, meetingId);
  const access = await calendarAccess(ctx, row.calendarOwnerId);
  if (access.token === null) {
    await recordFailure(ctx, row, 'The Google Calendar event could not be moved; update it by hand.');
    return row.meetUrl;
  }
  try {
    const zone = await db.transaction(ctx, (tx) => organizationTimezone(tx, ctx.organizationId));
    await moveEvent(access.token, row.calendarEventId, new Date(row.startsAt), new Date(row.endsAt), zone);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (cause instanceof CalendarAuthError) await markNeedsReconnect(ctx, row.calendarOwnerId, message);
    await recordFailure(ctx, row, `The Google Calendar event could not be moved (${message}).`);
  }
  return row.meetUrl;
}

/** Cancels the event; Google tells the guests. */
export async function takeOffCalendar(ctx: RequestContext, row: Pick<MeetingRecord, 'id' | 'calendarEventId' | 'calendarOwnerId'>): Promise<void> {
  if (!row.calendarEventId || !row.calendarOwnerId) return;
  const access = await calendarAccess(ctx, row.calendarOwnerId);
  if (access.token === null) return;
  try {
    await deleteEvent(access.token, row.calendarEventId);
  } catch (cause) {
    if (cause instanceof CalendarAuthError) await markNeedsReconnect(ctx, row.calendarOwnerId, cause.message);
    console.error('[meetings] calendar event not cancelled', row.id, cause instanceof Error ? cause.message : cause);
  }
}

/** Adds someone joining uninvited to the event, so Meet lets them straight in. */
export async function addToCalendarEvent(
  ctx: RequestContext,
  row: Pick<MeetingRecord, 'id' | 'calendarEventId' | 'calendarOwnerId'>,
  guest: { email: string; name: string },
): Promise<void> {
  if (!row.calendarEventId || !row.calendarOwnerId) return;
  const access = await calendarAccess(ctx, row.calendarOwnerId);
  if (access.token === null) return;
  try {
    await addGuest(access.token, row.calendarEventId, guest);
  } catch (cause) {
    console.error('[meetings] could not add guest', row.id, cause instanceof Error ? cause.message : cause);
  }
}
