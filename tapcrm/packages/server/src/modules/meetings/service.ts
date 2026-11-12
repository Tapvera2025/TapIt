import { effectivePolicy, visibilityFilter } from '@tapcrm/authz';
import { globalAccess } from '@tapcrm/contracts';
import { ApplicationError } from '../../errors.js';
import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { findSlots, googleBusy, organizationTimezone } from './availability.js';
import { addToCalendarEvent, moveOnCalendar, putOnCalendar, takeOffCalendar } from './calendar-sync.js';
import { Outbox, formatWhen, staffUrl, tellClient, tellStaff } from './messages.js';
import {
  addAttendee,
  clashingMeeting,
  clientContacts,
  findMeeting,
  findMeetingTx,
  insertMeetingEvent,
  listMeetingRecords,
  lockHostDiary,
  projectHosts,
  resetTimeReminders,
  toPortalMeeting,
  toStaffMeeting,
  type MeetingRecord,
} from './repository.js';
import type { AvailabilityResult, Meeting, MeetingStatus, PortalMeeting } from './types.js';
import type { MeetingListQuery, PortalRequestInput, ScheduleMeetingInput } from './validators.js';

const MINUTE = 60_000;
/** A client asks at least this far ahead, so the host has time to answer. */
export const CLIENT_NOTICE_MINUTES = 240;
const STAFF_NOTICE_MINUTES = 15;
const CLIENT_BOOKING_DAYS = 21;
const STAFF_BOOKING_DAYS = 60;
const MAX_OPEN_CLIENT_REQUESTS = 3;

const notFound = () => new ApplicationError('Meeting not found', 404, 'MEETING_NOT_FOUND');
const conflict = (message: string) => new ApplicationError(message, 409, 'MEETING_CONFLICT');
const invalid = (message: string) => new ApplicationError(message, 422, 'MEETING_INVALID');

function requireClient(ctx: RequestContext): { clientId: string; userId: string } {
  const { principal } = ctx;
  if (principal.accountType !== 'client' || !principal.clientId) {
    throw new ApplicationError('Only client accounts can do this', 403, 'MEETINGS_CLIENT_ONLY');
  }
  return { clientId: principal.clientId, userId: principal.id };
}

const staffActor = (ctx: RequestContext) => ({ id: ctx.principal.id, kind: 'staff' as const });
const clientActor = (ctx: RequestContext) => ({ id: ctx.principal.id, kind: 'client' as const });

interface ClientRecord { id: string; name: string; businessName: string; timezone: string; status: string }

async function clientRecord(tx: Tx, organizationId: string, clientId: string): Promise<ClientRecord | null> {
  return tx.maybeOne<ClientRecord>(sql`
    SELECT id, client_name AS name, business_name AS "businessName", timezone, status
      FROM client WHERE organization_id = ${organizationId} AND id = ${clientId}
  `);
}

async function clientProject(tx: Tx, organizationId: string, clientId: string, projectId: string): Promise<{ id: string; name: string } | null> {
  return tx.maybeOne<{ id: string; name: string }>(sql`
    SELECT id, name FROM project
     WHERE organization_id = ${organizationId} AND id = ${projectId} AND client_id = ${clientId} AND archived_at IS NULL
  `);
}

async function staffPeople(tx: Tx, organizationId: string, ids: readonly string[]): Promise<Array<{ id: string; name: string; email: string | null }>> {
  if (ids.length === 0) return [];
  return tx.query<{ id: string; name: string; email: string | null }>(sql`
    SELECT id, full_name AS name, email::text AS email FROM app_user
     WHERE organization_id = ${organizationId} AND id = ANY(${[...ids]}::uuid[])
       AND status = 'active' AND account_type IN ('employee', 'super-admin')
  `);
}

/** The host least booked in the week around the slot, for "anyone from the team". */
async function leastBusy(tx: Tx, organizationId: string, hostIds: readonly string[], around: Date): Promise<string> {
  const rows = await tx.query<{ hostId: string; open: number }>(sql`
    SELECT h.id AS "hostId", COUNT(m.id)::int AS open
      FROM unnest(${[...hostIds]}::uuid[]) AS h(id)
      LEFT JOIN meeting m ON m.organization_id = ${organizationId} AND m.host_id = h.id
       AND m.status IN ('requested', 'proposed', 'confirmed')
       AND m.starts_at BETWEEN ${new Date(around.getTime() - 7 * 24 * 60 * MINUTE)} AND ${new Date(around.getTime() + 7 * 24 * 60 * MINUTE)}
     GROUP BY h.id
  `);
  const counts = new Map(rows.map((row) => [row.hostId, row.open]));
  return [...hostIds].sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0))[0]!;
}

/** Is everyone free at exactly this time (TapCRM schedule and Google)? */
async function freeAt(
  ctx: RequestContext,
  userIds: readonly string[],
  startsAt: Date,
  durationMinutes: number,
  mode: 'all' | 'any',
  excludeMeetingId: string | null = null,
): Promise<string[]> {
  const result = await findSlots(ctx, {
    userIds,
    mode,
    durationMinutes,
    from: startsAt,
    to: new Date(startsAt.getTime() + durationMinutes * MINUTE),
    excludeMeetingId,
  });
  return result.slots.find((slot) => slot.startsAt.getTime() === startsAt.getTime())?.hostIds.slice() ?? [];
}

async function lockedMeeting(tx: Tx, organizationId: string, id: string): Promise<MeetingRecord> {
  await tx.query(sql`SELECT id FROM meeting WHERE organization_id = ${organizationId} AND id = ${id} FOR UPDATE`);
  const row = await findMeetingTx(tx, organizationId, id);
  if (!row) throw notFound();
  return row;
}

function requireStatus(row: MeetingRecord, allowed: readonly MeetingStatus[], message: string): void {
  if (!allowed.includes(row.status)) throw conflict(message);
}

async function withdrawProposals(tx: Tx, organizationId: string, meetingId: string): Promise<void> {
  await tx.query(sql`
    UPDATE meeting_proposal SET withdrawn_at = now()
     WHERE organization_id = ${organizationId} AND meeting_id = ${meetingId} AND chosen_at IS NULL AND withdrawn_at IS NULL
  `);
}

function clientZone(row: MeetingRecord): string {
  return row.clientTimezone ?? row.clientDefaultTimezone ?? 'Asia/Kolkata';
}

function onBehalf(ctx: RequestContext, row: MeetingRecord): Record<string, unknown> {
  return ctx.principal.id === row.hostId ? {} : { onBehalfOf: row.hostName };
}

/* ================================================================== *
 * Staff: lists and lookups
 * ================================================================== */

function rangeFilter(query: MeetingListQuery) {
  const from = query.from ?? new Date(Date.now() - 30 * 24 * 60 * MINUTE);
  const to = query.to ?? new Date(Date.now() + 90 * 24 * 60 * MINUTE);
  return sql`m.starts_at >= ${from} AND m.starts_at < ${to}
    AND (${query.status ?? null}::text IS NULL OR m.status = ${query.status ?? null}::text)
    AND (${query.hostId ?? null}::uuid IS NULL OR m.host_id = ${query.hostId ?? null}::uuid)
    AND (${query.clientId ?? null}::uuid IS NULL OR m.client_id = ${query.clientId ?? null}::uuid)`;
}

/** Meetings the person hosts or was invited to. */
export async function listMyMeetings(ctx: RequestContext, query: MeetingListQuery): Promise<Meeting[]> {
  const mine = sql`(m.host_id = ${ctx.principal.id} OR EXISTS (
    SELECT 1 FROM meeting_attendee a WHERE a.organization_id = m.organization_id AND a.meeting_id = m.id AND a.user_id = ${ctx.principal.id}))`;
  const rows = await listMeetingRecords(ctx, sql`${mine} AND ${rangeFilter(query)}`);
  return rows.map(toStaffMeeting);
}

/** The tracking board: every meeting within the person's meetings:view reach. */
export async function listAllMeetings(ctx: RequestContext, query: MeetingListQuery): Promise<Meeting[]> {
  const scope = await visibilityFilter(ctx, 'meetings:view', 'meeting');
  const rows = await listMeetingRecords(ctx, sql`${scope} AND ${rangeFilter(query)}`, 500);
  return rows.map(toStaffMeeting);
}

/** Colleagues who can be invited to a meeting. */
export async function listMeetingPeople(ctx: RequestContext): Promise<Array<{ id: string; name: string; role: string | null }>> {
  return db.query<{ id: string; name: string; role: string | null }>(ctx, sql`
    SELECT u.id, u.full_name AS name, p.name AS role
      FROM app_user u
      LEFT JOIN position p ON p.organization_id = u.organization_id AND p.id = u.position_id
     WHERE u.organization_id = ${ctx.organizationId} AND u.status = 'active'
       AND u.account_type IN ('employee', 'super-admin')
     ORDER BY u.full_name
  `);
}

async function hostReachesAllClients(ctx: RequestContext): Promise<boolean> {
  if (globalAccess(ctx.principal)) return true;
  const policy = await effectivePolicy(ctx, 'meetings:host');
  return Boolean(policy?.allowed && policy.scope !== 'own' && policy.scope !== 'participant');
}

/** Clients the person can book a meeting with: those of their projects, or every client for a manager. */
export async function listMeetableClients(ctx: RequestContext): Promise<Array<{ id: string; name: string; businessName: string; projects: Array<{ id: string; name: string }> }>> {
  const everyone = await hostReachesAllClients(ctx);
  const rows = await db.query<{ id: string; name: string; businessName: string; projectId: string | null; projectName: string | null }>(ctx, sql`
    SELECT c.id, c.client_name AS name, c.business_name AS "businessName", pr.id AS "projectId", pr.name AS "projectName"
      FROM client c
      LEFT JOIN project pr ON pr.organization_id = c.organization_id AND pr.client_id = c.id AND pr.archived_at IS NULL
     WHERE c.organization_id = ${ctx.organizationId} AND c.status = 'active'
       AND (${everyone} OR EXISTS (
             SELECT 1 FROM project mine
               JOIN project_assignee pa ON pa.organization_id = mine.organization_id AND pa.project_id = mine.id
              WHERE mine.organization_id = c.organization_id AND mine.client_id = c.id
                AND mine.archived_at IS NULL AND pa.user_id = ${ctx.principal.id}))
     ORDER BY c.business_name, pr.name
  `);
  const clients = new Map<string, { id: string; name: string; businessName: string; projects: Array<{ id: string; name: string }> }>();
  for (const row of rows) {
    const client = clients.get(row.id) ?? { id: row.id, name: row.name, businessName: row.businessName, projects: [] };
    if (row.projectId && row.projectName) client.projects.push({ id: row.projectId, name: row.projectName });
    clients.set(row.id, client);
  }
  return [...clients.values()];
}

/** Free times for the people who would be in a meeting. */
export async function staffAvailability(
  ctx: RequestContext,
  query: { userIds: readonly string[]; durationMinutes: number; days: number },
): Promise<AvailabilityResult> {
  const from = new Date(Date.now() + STAFF_NOTICE_MINUTES * MINUTE);
  const to = new Date(Date.now() + query.days * 24 * 60 * MINUTE);
  return findSlots(ctx, { userIds: [...new Set(query.userIds)], mode: 'all', durationMinutes: query.durationMinutes, from, to });
}

/* ================================================================== *
 * Staff: booking a meeting with a client
 * ================================================================== */

export async function scheduleMeeting(ctx: RequestContext, input: ScheduleMeetingInput): Promise<Meeting> {
  const now = Date.now();
  const startsAt = input.startsAt;
  if (startsAt.getTime() < now + 5 * MINUTE) throw invalid('Pick a time in the future.');
  if (startsAt.getTime() > now + STAFF_BOOKING_DAYS * 24 * 60 * MINUTE) throw invalid(`Book within the next ${STAFF_BOOKING_DAYS} days.`);
  const endsAt = new Date(startsAt.getTime() + input.durationMinutes * MINUTE);
  const hostId = ctx.principal.id;
  const staffIds = [...new Set(input.staffIds)].filter((id) => id !== hostId);

  const allowed = (await listMeetableClients(ctx)).find((client) => client.id === input.clientId);
  if (!allowed) throw new ApplicationError('You can book meetings only with the clients of your projects.', 403, 'MEETINGS_CLIENT_OUT_OF_REACH');
  if (input.projectId && !allowed.projects.some((project) => project.id === input.projectId)) throw invalid('That project is not this client’s.');

  const free = await freeAt(ctx, [hostId, ...staffIds], startsAt, input.durationMinutes, 'all');
  if (free.length === 0) throw conflict('Someone in the meeting is no longer free then. Pick another time.');

  const outbox = new Outbox();
  const meetingId = await db.transaction(ctx, async (tx) => {
    const staff = await staffPeople(tx, ctx.organizationId, staffIds);
    if (staff.length !== staffIds.length) throw invalid('Some of the people you added are not active employees.');
    const [host] = await staffPeople(tx, ctx.organizationId, [hostId]);
    if (!host) throw invalid('Only employees can host a meeting.');
    const client = await clientRecord(tx, ctx.organizationId, input.clientId);
    if (!client) throw notFound();
    for (const id of [hostId, ...staffIds]) {
      await lockHostDiary(tx, ctx.organizationId, id);
      if (await clashingMeeting(tx, ctx.organizationId, id, startsAt, endsAt, null)) throw conflict('Someone in the meeting was just booked then. Pick another time.');
    }
    const created = await tx.one<{ id: string }>(sql`
      INSERT INTO meeting (organization_id, title, agenda, status, origin, host_id, client_id, project_id, requested_by,
                           starts_at, ends_at, client_timezone, meet_url, confirmed_at)
      VALUES (${ctx.organizationId}, ${input.title}, ${input.agenda ?? null}, 'confirmed', 'staff', ${hostId}, ${client.id},
              ${input.projectId ?? null}, ${hostId}, ${startsAt}, ${endsAt}, ${client.timezone}, ${input.meetUrl ?? null}, now())
      RETURNING id
    `);
    await addAttendee(tx, ctx.organizationId, created.id, { userId: hostId, email: host.email, name: host.name, role: 'host', addedBy: hostId });
    for (const person of staff) {
      await addAttendee(tx, ctx.organizationId, created.id, { userId: person.id, email: person.email, name: person.name, role: 'staff', addedBy: hostId });
    }
    const contacts = await clientContacts(tx, ctx.organizationId, client.id);
    for (const contact of contacts) {
      await addAttendee(tx, ctx.organizationId, created.id, { userId: contact.userId, email: contact.email, name: contact.name, role: 'client', addedBy: hostId });
    }
    await insertMeetingEvent(tx, ctx.organizationId, created.id, 'scheduled', staffActor(ctx), { startsAt: startsAt.toISOString() });
    const zone = await organizationTimezone(tx, ctx.organizationId);
    await tellStaff(tx, ctx, staffIds, {
      type: 'meeting.scheduled',
      title: `Client meeting with ${client.businessName}`,
      body: `${host.name} added you to "${input.title}" on ${formatWhen(startsAt, zone)}.`,
      meetingId: created.id,
    });
    return created.id;
  });
  const meetUrl = await putOnCalendar(ctx, meetingId);
  const row = await findMeeting(ctx, meetingId);
  if (!row) throw notFound();
  await db.transaction(ctx, async (tx) => {
    await tellClient(tx, ctx, outbox, await clientContacts(tx, ctx.organizationId, row.clientId!), {
      type: 'meeting.confirmed',
      title: `Meeting with ${row.hostName}: ${formatWhen(new Date(row.startsAt), clientZone(row))}`,
      lines: [
        `${row.hostName} booked a meeting with you: "${row.title}".`,
        `When: ${formatWhen(new Date(row.startsAt), clientZone(row))} (${input.durationMinutes} minutes).`,
        meetUrl ? '' : 'The meeting link will follow.',
      ],
      meetingId,
      meetUrl,
    });
  });
  await outbox.flush();
  return toStaffMeeting((await findMeeting(ctx, meetingId))!);
}

/* ================================================================== *
 * Staff: answering a request
 * ================================================================== */

export async function acceptMeeting(ctx: RequestContext, id: string, input: { meetUrl?: string | null | undefined }): Promise<Meeting> {
  const current = await findMeeting(ctx, id);
  if (!current) throw notFound();
  requireStatus(current, ['requested'], 'This request has already been answered.');
  if (new Date(current.startsAt).getTime() <= Date.now()) throw conflict('That time has passed. Offer the client other times instead.');
  const duration = Math.round((new Date(current.endsAt).getTime() - new Date(current.startsAt).getTime()) / MINUTE);
  const google = await googleBusy(ctx, current.hostId, new Date(current.startsAt), new Date(current.endsAt));
  if (google.busy.length > 0) throw conflict(`${current.hostId === ctx.principal.id ? 'Your' : `${current.hostName}'s`} Google Calendar is busy then. Offer the client other times instead.`);

  await db.transaction(ctx, async (tx) => {
    await lockHostDiary(tx, ctx.organizationId, current.hostId);
    const row = await lockedMeeting(tx, ctx.organizationId, id);
    requireStatus(row, ['requested'], 'This request has already been answered.');
    if (await clashingMeeting(tx, ctx.organizationId, row.hostId, new Date(row.startsAt), new Date(row.endsAt), row.id)) {
      throw conflict('Another meeting was booked at that time. Offer the client other times instead.');
    }
    await tx.query(sql`
      UPDATE meeting SET status = 'confirmed', responded_at = now(), confirmed_at = now(),
                         meet_url = COALESCE(${input.meetUrl ?? null}, meet_url)
       WHERE organization_id = ${ctx.organizationId} AND id = ${id}
    `);
    await insertMeetingEvent(tx, ctx.organizationId, id, 'accepted', staffActor(ctx), { durationMinutes: duration, ...onBehalf(ctx, row) });
  });
  const meetUrl = await putOnCalendar(ctx, id);
  const row = (await findMeeting(ctx, id))!;
  const outbox = new Outbox();
  await db.transaction(ctx, async (tx) => {
    if (!row.clientId) return;
    await tellClient(tx, ctx, outbox, await clientContacts(tx, ctx.organizationId, row.clientId), {
      type: 'meeting.confirmed',
      title: `Meeting confirmed with ${row.hostName}`,
      lines: [
        `${row.hostName} accepted your meeting request.`,
        `When: ${formatWhen(new Date(row.startsAt), clientZone(row))}.`,
        meetUrl ? '' : 'The meeting link will follow.',
      ],
      meetingId: id,
      meetUrl,
    });
  });
  await outbox.flush();
  return toStaffMeeting(row);
}

export async function proposeTimes(ctx: RequestContext, id: string, input: { times: readonly Date[]; note?: string | null | undefined }): Promise<Meeting> {
  const current = await findMeeting(ctx, id);
  if (!current) throw notFound();
  requireStatus(current, ['requested', 'proposed', 'confirmed'], 'This meeting can no longer be moved.');
  const duration = Math.round((new Date(current.endsAt).getTime() - new Date(current.startsAt).getTime()) / MINUTE);
  const times = [...new Map(input.times.map((time) => [time.getTime(), time])).values()].sort((a, b) => a.getTime() - b.getTime());
  const organizationZone = await db.transaction(ctx, (tx) => organizationTimezone(tx, ctx.organizationId));
  for (const time of times) {
    if (time.getTime() < Date.now() + 30 * MINUTE) throw invalid('Offer times at least 30 minutes from now.');
    if ((await freeAt(ctx, [current.hostId], time, duration, 'all', id)).length === 0) {
      throw conflict(`${formatWhen(time, organizationZone)} is no longer free. Pick from the free times.`);
    }
  }

  const outbox = new Outbox();
  await db.transaction(ctx, async (tx) => {
    await lockHostDiary(tx, ctx.organizationId, current.hostId);
    const row = await lockedMeeting(tx, ctx.organizationId, id);
    requireStatus(row, ['requested', 'proposed', 'confirmed'], 'This meeting can no longer be moved.');
    for (const time of times) {
      if (await clashingMeeting(tx, ctx.organizationId, row.hostId, time, new Date(time.getTime() + duration * MINUTE), row.id)) {
        throw conflict('One of those times was just taken. Pick again.');
      }
    }
    await withdrawProposals(tx, ctx.organizationId, id);
    for (const time of times) {
      await tx.query(sql`
        INSERT INTO meeting_proposal (organization_id, meeting_id, starts_at, ends_at, proposed_by)
        VALUES (${ctx.organizationId}, ${id}, ${time}, ${new Date(time.getTime() + duration * MINUTE)}, ${ctx.principal.id})
      `);
    }
    await tx.query(sql`
      UPDATE meeting SET status = 'proposed', responded_at = COALESCE(responded_at, now())
       WHERE organization_id = ${ctx.organizationId} AND id = ${id}
    `);
    await insertMeetingEvent(tx, ctx.organizationId, id, 'proposed', staffActor(ctx), {
      from: row.status,
      times: times.map((time) => time.toISOString()),
      note: input.note ?? null,
      ...onBehalf(ctx, row),
    });
    if (row.clientId) {
      const zone = clientZone(row);
      await tellClient(tx, ctx, outbox, await clientContacts(tx, ctx.organizationId, row.clientId), {
        type: 'meeting.proposed',
        title: `${row.hostName} offered other times`,
        lines: [
          row.status === 'confirmed'
            ? `${row.hostName} needs to move your meeting on ${formatWhen(new Date(row.startsAt), zone)}.`
            : `${row.hostName} can't make ${formatWhen(new Date(row.startsAt), zone)}.`,
          ...(input.note ? [`Note: ${input.note}`] : []),
          `Pick one of these times in the portal: ${times.map((time) => formatWhen(time, zone)).join('; ')}.`,
        ],
        meetingId: id,
        urgent: true,
      });
    }
  });
  await outbox.flush();
  return toStaffMeeting((await findMeeting(ctx, id))!);
}

export async function declineMeeting(ctx: RequestContext, id: string, input: { reason: string }): Promise<Meeting> {
  const outbox = new Outbox();
  const before = await db.transaction(ctx, async (tx) => {
    const row = await lockedMeeting(tx, ctx.organizationId, id);
    requireStatus(row, ['requested', 'proposed'], 'Only a waiting request can be declined. Cancel a confirmed meeting instead.');
    await withdrawProposals(tx, ctx.organizationId, id);
    await tx.query(sql`
      UPDATE meeting SET status = 'declined', decline_reason = ${input.reason}, responded_at = COALESCE(responded_at, now())
       WHERE organization_id = ${ctx.organizationId} AND id = ${id}
    `);
    await insertMeetingEvent(tx, ctx.organizationId, id, 'declined', staffActor(ctx), { reason: input.reason, ...onBehalf(ctx, row) });
    if (row.clientId) {
      await tellClient(tx, ctx, outbox, await clientContacts(tx, ctx.organizationId, row.clientId), {
        type: 'meeting.declined',
        title: `${row.hostName} can't take this meeting`,
        lines: [
          `${row.hostName} can't meet on ${formatWhen(new Date(row.startsAt), clientZone(row))}: ${input.reason}`,
          'You can ask someone else on your project team for a meeting from the portal.',
        ],
        meetingId: id,
      });
    }
    return row;
  });
  await takeOffCalendar(ctx, before);
  await outbox.flush();
  return toStaffMeeting((await findMeeting(ctx, id))!);
}

export async function cancelMeeting(ctx: RequestContext, id: string, input: { reason: string }): Promise<Meeting> {
  const outbox = new Outbox();
  const before = await db.transaction(ctx, async (tx) => {
    const row = await lockedMeeting(tx, ctx.organizationId, id);
    requireStatus(row, ['requested', 'proposed', 'confirmed'], 'This meeting is already closed.');
    await withdrawProposals(tx, ctx.organizationId, id);
    await tx.query(sql`
      UPDATE meeting SET status = 'cancelled', cancel_reason = ${input.reason}, cancelled_by = ${ctx.principal.id}
       WHERE organization_id = ${ctx.organizationId} AND id = ${id}
    `);
    await insertMeetingEvent(tx, ctx.organizationId, id, 'cancelled', staffActor(ctx), { reason: input.reason, from: row.status, ...onBehalf(ctx, row) });
    const zone = await organizationTimezone(tx, ctx.organizationId);
    const staff = row.attendees.filter((attendee) => attendee.userId && (attendee.role === 'host' || attendee.role === 'staff')).map((attendee) => attendee.userId!);
    await tellStaff(tx, ctx, [row.hostId, ...staff], {
      type: 'meeting.cancelled',
      title: `Meeting with ${row.clientBusiness ?? 'a client'} cancelled`,
      body: `"${row.title}" on ${formatWhen(new Date(row.startsAt), zone)} was cancelled: ${input.reason}`,
      meetingId: id,
    });
    if (row.clientId) {
      await tellClient(tx, ctx, outbox, await clientContacts(tx, ctx.organizationId, row.clientId), {
        type: 'meeting.cancelled',
        title: 'Your meeting was cancelled',
        lines: [
          `The meeting with ${row.hostName} on ${formatWhen(new Date(row.startsAt), clientZone(row))} was cancelled: ${input.reason}`,
          'You can ask for a new meeting from the portal.',
        ],
        meetingId: id,
        urgent: row.status === 'confirmed',
      });
    }
    return row;
  });
  await takeOffCalendar(ctx, before);
  await outbox.flush();
  return toStaffMeeting((await findMeeting(ctx, id))!);
}

export async function completeMeeting(ctx: RequestContext, id: string, input: { outcome: 'completed' | 'no_show'; note?: string | null | undefined }): Promise<Meeting> {
  await db.transaction(ctx, async (tx) => {
    const row = await lockedMeeting(tx, ctx.organizationId, id);
    requireStatus(row, ['confirmed', 'completed', 'no_show'], 'Only a confirmed meeting has an outcome.');
    if (new Date(row.startsAt).getTime() > Date.now()) throw conflict('Record how it went once the meeting has started.');
    await tx.query(sql`
      UPDATE meeting SET status = ${input.outcome}, outcome_note = ${input.note ?? null}
       WHERE organization_id = ${ctx.organizationId} AND id = ${id}
    `);
    await insertMeetingEvent(tx, ctx.organizationId, id, input.outcome, staffActor(ctx), { note: input.note ?? null });
  });
  return toStaffMeeting((await findMeeting(ctx, id))!);
}

export async function setMeetingLink(ctx: RequestContext, id: string, input: { meetUrl: string }): Promise<Meeting> {
  const outbox = new Outbox();
  await db.transaction(ctx, async (tx) => {
    const row = await lockedMeeting(tx, ctx.organizationId, id);
    requireStatus(row, ['requested', 'proposed', 'confirmed'], 'This meeting is closed.');
    await tx.query(sql`
      UPDATE meeting SET meet_url = ${input.meetUrl}, calendar_error = NULL
       WHERE organization_id = ${ctx.organizationId} AND id = ${id}
    `);
    await insertMeetingEvent(tx, ctx.organizationId, id, 'link_added', staffActor(ctx));
    if (row.status === 'confirmed' && row.clientId) {
      await tellClient(tx, ctx, outbox, await clientContacts(tx, ctx.organizationId, row.clientId), {
        type: 'meeting.link',
        title: `Link for your meeting with ${row.hostName}`,
        lines: [`Here is the link for your meeting on ${formatWhen(new Date(row.startsAt), clientZone(row))}.`],
        meetingId: id,
        meetUrl: input.meetUrl,
      });
    }
  });
  await outbox.flush();
  return toStaffMeeting((await findMeeting(ctx, id))!);
}

/** Someone with meetings:join steps into a meeting they were not invited to. */
export async function joinMeeting(ctx: RequestContext, id: string): Promise<{ meetUrl: string; meeting: Meeting }> {
  const joined = await db.transaction(ctx, async (tx) => {
    const row = await lockedMeeting(tx, ctx.organizationId, id);
    requireStatus(row, ['confirmed'], 'Only a confirmed meeting can be joined.');
    if (!row.meetUrl) throw conflict('This meeting has no link yet.');
    const [me] = await staffPeople(tx, ctx.organizationId, [ctx.principal.id]);
    if (!me) throw new ApplicationError('Only employees can join.', 403, 'MEETINGS_STAFF_ONLY');
    const already = row.attendees.some((attendee) => attendee.userId === me.id);
    if (!already) await addAttendee(tx, ctx.organizationId, id, { userId: me.id, email: me.email, name: me.name, role: 'observer', addedBy: me.id });
    await insertMeetingEvent(tx, ctx.organizationId, id, 'joined', staffActor(ctx), { invited: already });
    if (!already) {
      await tellStaff(tx, ctx, [row.hostId], {
        type: 'meeting.joined',
        title: `${me.name} is joining your meeting`,
        body: `${me.name} is joining "${row.title}" with ${row.clientBusiness ?? 'the client'}.`,
        meetingId: id,
      });
    }
    return { row, me, already };
  });
  if (!joined.already && joined.me.email) {
    await addToCalendarEvent(ctx, joined.row, { email: joined.me.email, name: joined.me.name });
  }
  return { meetUrl: joined.row.meetUrl!, meeting: toStaffMeeting((await findMeeting(ctx, id))!) };
}

/* ================================================================== *
 * Client portal
 * ================================================================== */

export async function portalListMeetings(ctx: RequestContext): Promise<PortalMeeting[]> {
  const { clientId, userId } = requireClient(ctx);
  const rows = await listMeetingRecords(ctx, sql`m.client_id = ${clientId}
    AND (m.status IN ('requested', 'proposed', 'confirmed') OR m.starts_at >= now() - interval '90 days')`);
  const now = new Date();
  return rows.map((row) => toPortalMeeting(row, userId, now));
}

/** The people on the project the client may ask for a meeting. */
export async function portalHosts(ctx: RequestContext, projectId: string): Promise<{ project: { id: string; name: string }; hosts: Array<{ id: string; name: string; role: string | null }> }> {
  const { clientId } = requireClient(ctx);
  return db.transaction(ctx, async (tx) => {
    const project = await clientProject(tx, ctx.organizationId, clientId, projectId);
    if (!project) throw new ApplicationError('Project not found', 404, 'CLIENT_PORTAL_NOT_FOUND');
    const hosts = await projectHosts(tx, ctx.organizationId, clientId, projectId);
    return { project, hosts: hosts.map(({ id, name, role }) => ({ id, name, role })) };
  });
}

export async function portalSlots(
  ctx: RequestContext,
  projectId: string,
  query: { hostId?: string | undefined; durationMinutes: number },
): Promise<{ timezone: string; slots: Array<{ startsAt: Date; endsAt: Date }> }> {
  const { clientId } = requireClient(ctx);
  const { hosts, timezone } = await db.transaction(ctx, async (tx) => {
    const project = await clientProject(tx, ctx.organizationId, clientId, projectId);
    if (!project) throw new ApplicationError('Project not found', 404, 'CLIENT_PORTAL_NOT_FOUND');
    const client = await clientRecord(tx, ctx.organizationId, clientId);
    return { hosts: await projectHosts(tx, ctx.organizationId, clientId, projectId), timezone: client?.timezone ?? 'Asia/Kolkata' };
  });
  const candidates = query.hostId ? hosts.filter((host) => host.id === query.hostId) : hosts;
  if (candidates.length === 0) return { timezone, slots: [] };
  const result = await findSlots(ctx, {
    userIds: candidates.map((host) => host.id),
    mode: query.hostId ? 'all' : 'any',
    durationMinutes: query.durationMinutes,
    from: new Date(Date.now() + CLIENT_NOTICE_MINUTES * MINUTE),
    to: new Date(Date.now() + CLIENT_BOOKING_DAYS * 24 * 60 * MINUTE),
  });
  return { timezone, slots: result.slots.map(({ startsAt, endsAt }) => ({ startsAt, endsAt })) };
}

export async function portalRequestMeeting(ctx: RequestContext, input: PortalRequestInput): Promise<PortalMeeting> {
  const { clientId, userId } = requireClient(ctx);
  const startsAt = input.startsAt;
  const now = Date.now();
  if (startsAt.getTime() < now + (CLIENT_NOTICE_MINUTES - 5) * MINUTE) {
    throw invalid(`Pick a time at least ${CLIENT_NOTICE_MINUTES / 60} hours from now, so the team can answer.`);
  }
  if (startsAt.getTime() > now + CLIENT_BOOKING_DAYS * 24 * 60 * MINUTE) throw invalid(`Pick a time within the next ${CLIENT_BOOKING_DAYS} days.`);
  const endsAt = new Date(startsAt.getTime() + input.durationMinutes * MINUTE);

  const { hosts, project, client, open } = await db.transaction(ctx, async (tx) => {
    const projectRow = await clientProject(tx, ctx.organizationId, clientId, input.projectId);
    if (!projectRow) throw new ApplicationError('Project not found', 404, 'CLIENT_PORTAL_NOT_FOUND');
    const clientRow = await clientRecord(tx, ctx.organizationId, clientId);
    if (!clientRow || clientRow.status !== 'active') throw new ApplicationError('This client account is inactive', 403, 'CLIENT_PORTAL_INACTIVE');
    const waiting = await tx.one<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count FROM meeting
       WHERE organization_id = ${ctx.organizationId} AND client_id = ${clientId} AND status IN ('requested', 'proposed')
    `);
    return { hosts: await projectHosts(tx, ctx.organizationId, clientId, input.projectId), project: projectRow, client: clientRow, open: waiting.count };
  });
  if (open >= MAX_OPEN_CLIENT_REQUESTS) {
    throw conflict(`You already have ${open} meeting requests waiting for an answer. Wait for those, or cancel one, before asking again.`);
  }
  const candidates = input.hostId ? hosts.filter((host) => host.id === input.hostId) : hosts;
  if (candidates.length === 0) throw invalid('That person is not available for meetings on this project.');
  const free = await freeAt(ctx, candidates.map((host) => host.id), startsAt, input.durationMinutes, 'any');
  if (free.length === 0) throw conflict('That time was just taken. Pick another one.');

  const outbox = new Outbox();
  const meetingId = await db.transaction(ctx, async (tx) => {
    const hostId = input.hostId ?? (await leastBusy(tx, ctx.organizationId, free, startsAt));
    const host = hosts.find((candidate) => candidate.id === hostId)!;
    await lockHostDiary(tx, ctx.organizationId, hostId);
    if (await clashingMeeting(tx, ctx.organizationId, hostId, startsAt, endsAt, null)) throw conflict('That time was just taken. Pick another one.');
    const title = (project.name.toLowerCase().includes(client.businessName.toLowerCase())
      ? project.name
      : `${client.businessName} · ${project.name}`).slice(0, 200);
    const created = await tx.one<{ id: string }>(sql`
      INSERT INTO meeting (organization_id, title, agenda, status, origin, host_id, client_id, project_id, requested_by,
                           starts_at, ends_at, client_timezone)
      VALUES (${ctx.organizationId}, ${title}, ${input.agenda}, 'requested', 'client', ${hostId}, ${clientId}, ${project.id},
              ${userId}, ${startsAt}, ${endsAt}, ${client.timezone})
      RETURNING id
    `);
    await addAttendee(tx, ctx.organizationId, created.id, { userId: hostId, email: host.email, name: host.name, role: 'host', addedBy: userId });
    for (const contact of await clientContacts(tx, ctx.organizationId, clientId)) {
      await addAttendee(tx, ctx.organizationId, created.id, { userId: contact.userId, email: contact.email, name: contact.name, role: 'client', addedBy: userId });
    }
    await insertMeetingEvent(tx, ctx.organizationId, created.id, 'requested', clientActor(ctx), {
      startsAt: startsAt.toISOString(),
      durationMinutes: input.durationMinutes,
      askedFor: input.hostId ? 'person' : 'anyone',
    });
    const zone = await organizationTimezone(tx, ctx.organizationId);
    await tellStaff(tx, ctx, [hostId], {
      type: 'meeting.requested',
      title: `Meeting request from ${client.businessName}`,
      body: `${client.name} asked to meet on ${formatWhen(startsAt, zone)} about ${project.name}: "${input.agenda.slice(0, 300)}". Accept it or offer other times.`,
      meetingId: created.id,
      urgent: true,
    });
    outbox.email(host.email, `Meeting request from ${client.businessName}`, [
      `${client.name} (${client.businessName}) asked to meet you on ${formatWhen(startsAt, zone)} for ${input.durationMinutes} minutes.`,
      `Project: ${project.name}`,
      `About: ${input.agenda}`,
      '',
      'Accept it, or offer other times, in TapCRM.',
    ], { label: 'Answer the request', url: staffUrl(created.id) });
    return created.id;
  });
  await outbox.flush();
  return toPortalMeeting((await findMeeting(ctx, meetingId))!, userId, new Date());
}

export async function portalChooseProposal(ctx: RequestContext, id: string, proposalId: string): Promise<PortalMeeting> {
  const { clientId, userId } = requireClient(ctx);
  const current = await findMeeting(ctx, id);
  if (!current || current.clientId !== clientId) throw notFound();
  requireStatus(current, ['proposed'], 'There are no times to pick on this meeting.');
  const proposal = current.proposals.find((item) => item.id === proposalId && item.chosenAt === null && item.withdrawnAt === null);
  if (!proposal) throw conflict('That time is no longer on offer. Refresh and pick again.');
  const startsAt = new Date(proposal.startsAt);
  const endsAt = new Date(proposal.endsAt);
  if (startsAt.getTime() <= Date.now()) throw conflict('That time has passed. Ask for a new meeting instead.');
  const google = await googleBusy(ctx, current.hostId, startsAt, endsAt);
  const busy = google.busy.filter((slot) => !(current.calendarEventId && slot.start === new Date(current.startsAt).getTime() && slot.end === new Date(current.endsAt).getTime()));
  if (busy.some((slot) => slot.start < endsAt.getTime() && slot.end > startsAt.getTime())) {
    throw conflict(`${current.hostName} was just booked then. Ask for a new meeting instead.`);
  }

  const outbox = new Outbox();
  await db.transaction(ctx, async (tx) => {
    await lockHostDiary(tx, ctx.organizationId, current.hostId);
    const row = await lockedMeeting(tx, ctx.organizationId, id);
    requireStatus(row, ['proposed'], 'There are no times to pick on this meeting.');
    if (await clashingMeeting(tx, ctx.organizationId, row.hostId, startsAt, endsAt, row.id)) {
      throw conflict(`${row.hostName} was just booked then. Ask for a new meeting instead.`);
    }
    await tx.query(sql`UPDATE meeting_proposal SET chosen_at = now() WHERE organization_id = ${ctx.organizationId} AND id = ${proposalId}`);
    await withdrawProposals(tx, ctx.organizationId, id);
    await tx.query(sql`
      UPDATE meeting SET status = 'confirmed', starts_at = ${startsAt}, ends_at = ${endsAt}, confirmed_at = now()
       WHERE organization_id = ${ctx.organizationId} AND id = ${id}
    `);
    await resetTimeReminders(tx, ctx.organizationId, id);
    await insertMeetingEvent(tx, ctx.organizationId, id, 'chosen', clientActor(ctx), { startsAt: startsAt.toISOString() });
    const zone = await organizationTimezone(tx, ctx.organizationId);
    await tellStaff(tx, ctx, [row.hostId], {
      type: 'meeting.chosen',
      title: `${row.clientBusiness ?? 'The client'} picked a time`,
      body: `The meeting "${row.title}" is now on ${formatWhen(startsAt, zone)}.`,
      meetingId: id,
    });
  });
  const meetUrl = current.calendarEventId ? await moveOnCalendar(ctx, id) : await putOnCalendar(ctx, id);
  const row = (await findMeeting(ctx, id))!;
  await db.transaction(ctx, async (tx) => {
    await tellClient(tx, ctx, outbox, await clientContacts(tx, ctx.organizationId, clientId), {
      type: 'meeting.confirmed',
      title: `Meeting confirmed with ${row.hostName}`,
      lines: [`Your meeting is on ${formatWhen(startsAt, clientZone(row))}.`, meetUrl ? '' : 'The meeting link will follow.'],
      meetingId: id,
      meetUrl,
      includeActor: true,
    });
  });
  await outbox.flush();
  return toPortalMeeting(row, userId, new Date());
}

export async function portalCancelMeeting(ctx: RequestContext, id: string, input: { reason?: string | null | undefined }): Promise<PortalMeeting> {
  const { clientId, userId } = requireClient(ctx);
  const outbox = new Outbox();
  const before = await db.transaction(ctx, async (tx) => {
    const row = await lockedMeeting(tx, ctx.organizationId, id);
    if (row.clientId !== clientId) throw notFound();
    requireStatus(row, ['requested', 'proposed', 'confirmed'], 'This meeting is already closed.');
    const reason = input.reason?.trim() || 'Cancelled by the client';
    await withdrawProposals(tx, ctx.organizationId, id);
    await tx.query(sql`
      UPDATE meeting SET status = 'cancelled', cancel_reason = ${reason}, cancelled_by = ${userId}
       WHERE organization_id = ${ctx.organizationId} AND id = ${id}
    `);
    await insertMeetingEvent(tx, ctx.organizationId, id, 'cancelled', clientActor(ctx), { reason, from: row.status });
    const zone = await organizationTimezone(tx, ctx.organizationId);
    const staff = row.attendees.filter((attendee) => attendee.userId && (attendee.role === 'host' || attendee.role === 'staff')).map((attendee) => attendee.userId!);
    await tellStaff(tx, ctx, [row.hostId, ...staff], {
      type: 'meeting.cancelled',
      title: `${row.clientBusiness ?? 'The client'} cancelled a meeting`,
      body: `"${row.title}" on ${formatWhen(new Date(row.startsAt), zone)} was cancelled by the client: ${reason}`,
      meetingId: id,
    });
    const hostEmail = row.hostEmail;
    outbox.email(hostEmail, `${row.clientBusiness ?? 'A client'} cancelled a meeting`, [
      `"${row.title}" on ${formatWhen(new Date(row.startsAt), zone)} was cancelled by the client.`,
      `Reason: ${reason}`,
    ], { label: 'Open the meeting', url: staffUrl(id) });
    return row;
  });
  await takeOffCalendar(ctx, before);
  await outbox.flush();
  return toPortalMeeting((await findMeeting(ctx, id))!, userId, new Date());
}
