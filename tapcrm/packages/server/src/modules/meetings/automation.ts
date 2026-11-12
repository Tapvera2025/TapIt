import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { organizationTimezone } from './availability.js';
import { takeOffCalendar } from './calendar-sync.js';
import { Outbox, formatWhen, staffUrl, tellClient, tellStaff } from './messages.js';
import { claimReminder, clientContacts, findMeetingTx, insertMeetingEvent, type MeetingRecord } from './repository.js';

/**
 * The once-a-minute pass over a company's meetings.
 *
 *   expire     a request nobody answered before its time, or offered times
 *              that all passed
 *   nudge      the host, two hours after a request still has no answer
 *   escalate   their manager and the Super Admins, four hours after (or two
 *              hours before the time, whichever comes first)
 *   remind     the client a day and an hour before; staff ten minutes before.
 *              Only the latest due reminder goes out, and none whose moment
 *              had passed when the meeting was confirmed
 *   outcome    the host, 15 minutes after the end, to record how it went
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NUDGE_AFTER = 2 * HOUR;
const ESCALATE_AFTER = 4 * HOUR;
const ESCALATE_BEFORE_START = 2 * HOUR;

export type ClientReminder = 'client_24h' | 'client_1h';

/** The one client reminder due now for a meeting confirmed at `confirmedAt`, if any. */
export function clientReminderDue(startsAt: Date, confirmedAt: Date, now: Date): ClientReminder | null {
  const start = startsAt.getTime();
  if (now.getTime() >= start) return null;
  let due: ClientReminder | null = null;
  for (const [kind, before] of [['client_24h', 24 * HOUR], ['client_1h', HOUR]] as const) {
    const at = start - before;
    if (at <= now.getTime() && at >= confirmedAt.getTime() - MINUTE) due = kind;
  }
  return due;
}

export async function runMeetingAutomation(ctx: RequestContext, now: Date): Promise<number> {
  let handled = 0;
  handled += await expireStale(ctx, now);
  const candidates = await db.query<{ id: string }>(ctx, sql`
    SELECT m.id FROM meeting m
     WHERE m.organization_id = ${ctx.organizationId}
       AND ((m.status = 'confirmed' AND m.starts_at > ${now} AND m.starts_at <= ${new Date(now.getTime() + 24 * HOUR)})
         OR (m.status = 'confirmed' AND m.ends_at <= ${new Date(now.getTime() - 15 * MINUTE)} AND m.ends_at > ${new Date(now.getTime() - 7 * 24 * HOUR)})
         OR (m.status = 'requested' AND m.created_at <= ${new Date(now.getTime() - 30 * MINUTE)}))
     ORDER BY m.starts_at
     LIMIT 200
  `);
  for (const { id } of candidates) {
    const outbox = new Outbox();
    handled += await db.transaction(ctx, async (tx) => {
      const row = await findMeetingTx(tx, ctx.organizationId, id);
      if (!row) return 0;
      const zone = await organizationTimezone(tx, ctx.organizationId);
      if (row.status === 'requested') return chaseAnswer(ctx, tx, row, now, zone, outbox);
      if (new Date(row.startsAt) > now) return remind(ctx, tx, row, now, zone, outbox);
      return askOutcome(ctx, tx, row, zone);
    });
    await outbox.flush();
  }
  return handled;
}

async function expireStale(ctx: RequestContext, now: Date): Promise<number> {
  const stale = await db.query<{ id: string }>(ctx, sql`
    SELECT m.id FROM meeting m
     WHERE m.organization_id = ${ctx.organizationId}
       AND ((m.status = 'requested' AND m.starts_at <= ${now})
         OR (m.status = 'proposed' AND NOT EXISTS (
               SELECT 1 FROM meeting_proposal p
                WHERE p.organization_id = m.organization_id AND p.meeting_id = m.id
                  AND p.chosen_at IS NULL AND p.withdrawn_at IS NULL AND p.starts_at > ${now})))
     LIMIT 200
  `);
  let expired = 0;
  for (const { id } of stale) {
    const outbox = new Outbox();
    const row = await db.transaction(ctx, async (tx) => {
      await tx.query(sql`SELECT id FROM meeting WHERE organization_id = ${ctx.organizationId} AND id = ${id} FOR UPDATE`);
      const current = await findMeetingTx(tx, ctx.organizationId, id);
      if (!current || (current.status !== 'requested' && current.status !== 'proposed')) return null;
      await tx.query(sql`
        UPDATE meeting_proposal SET withdrawn_at = now()
         WHERE organization_id = ${ctx.organizationId} AND meeting_id = ${id} AND chosen_at IS NULL AND withdrawn_at IS NULL
      `);
      await tx.query(sql`UPDATE meeting SET status = 'expired' WHERE organization_id = ${ctx.organizationId} AND id = ${id}`);
      await insertMeetingEvent(tx, ctx.organizationId, id, 'expired', { id: null, kind: 'system' }, { from: current.status });
      const zone = await organizationTimezone(tx, ctx.organizationId);
      await tellStaff(tx, ctx, [current.hostId], {
        type: 'meeting.expired',
        title: `Meeting request from ${current.clientBusiness ?? 'a client'} lapsed`,
        body: current.status === 'requested'
          ? `Nobody answered the request for ${formatWhen(new Date(current.startsAt), zone)} before that time.`
          : 'The client did not pick any of the times offered before they passed.',
        meetingId: id,
      });
      if (current.clientId) {
        await tellClient(tx, ctx, outbox, await clientContacts(tx, ctx.organizationId, current.clientId), {
          type: 'meeting.expired',
          title: 'Your meeting request lapsed',
          lines: [
            current.status === 'requested'
              ? `${current.hostName} could not answer your request for ${formatWhen(new Date(current.startsAt), current.clientTimezone ?? zone)} in time. We're sorry.`
              : 'The times offered for your meeting have passed.',
            'You can ask for a new meeting from the portal.',
          ],
          meetingId: id,
        });
      }
      return current;
    });
    if (row) {
      expired += 1;
      await takeOffCalendar(ctx, row);
    }
    await outbox.flush();
  }
  return expired;
}

async function chaseAnswer(ctx: RequestContext, tx: Tx, row: MeetingRecord, now: Date, zone: string, outbox: Outbox): Promise<number> {
  const asked = new Date(row.createdAt).getTime();
  const start = new Date(row.startsAt).getTime();
  let done = 0;
  if (now.getTime() - asked >= NUDGE_AFTER && await claimReminder(tx, ctx.organizationId, row.id, 'host_nudge')) {
    await tellStaff(tx, ctx, [row.hostId], {
      type: 'meeting.waiting',
      title: `${row.clientBusiness ?? 'A client'} is waiting for your answer`,
      body: `They asked to meet on ${formatWhen(new Date(row.startsAt), zone)}. Accept it, offer other times, or decline.`,
      meetingId: row.id,
      urgent: true,
    });
    outbox.email(row.hostEmail, `${row.clientBusiness ?? 'A client'} is waiting for your answer`, [
      `${row.clientName ?? 'A client'} asked to meet on ${formatWhen(new Date(row.startsAt), zone)} and has not heard back yet.`,
    ], { label: 'Answer the request', url: staffUrl(row.id) });
    await insertMeetingEvent(tx, ctx.organizationId, row.id, 'reminded', { id: null, kind: 'system' }, { who: 'host' });
    done += 1;
  }
  const due = now.getTime() - asked >= ESCALATE_AFTER || start - now.getTime() <= ESCALATE_BEFORE_START;
  if (due && await claimReminder(tx, ctx.organizationId, row.id, 'escalation')) {
    const managers = await tx.query<{ id: string }>(sql`
      SELECT manager.id FROM app_user host
        JOIN app_user manager ON manager.organization_id = host.organization_id AND manager.id = host.reports_to
       WHERE host.organization_id = ${ctx.organizationId} AND host.id = ${row.hostId} AND manager.status = 'active'
      UNION
      SELECT id FROM app_user
       WHERE organization_id = ${ctx.organizationId} AND account_type = 'super-admin' AND status = 'active'
    `);
    await tellStaff(tx, ctx, managers.map((manager) => manager.id).filter((id) => id !== row.hostId), {
      type: 'meeting.escalated',
      title: `${row.hostName} hasn't answered ${row.clientBusiness ?? 'a client'}`,
      body: `${row.clientBusiness ?? 'A client'} asked ${row.hostName} for a meeting on ${formatWhen(new Date(row.startsAt), zone)} and is still waiting. Step in if needed.`,
      meetingId: row.id,
      urgent: true,
    });
    await insertMeetingEvent(tx, ctx.organizationId, row.id, 'escalated', { id: null, kind: 'system' }, { recipients: managers.length });
    done += 1;
  }
  return done;
}

async function remind(ctx: RequestContext, tx: Tx, row: MeetingRecord, now: Date, zone: string, outbox: Outbox): Promise<number> {
  const startsAt = new Date(row.startsAt);
  const confirmedAt = new Date(row.confirmedAt ?? row.createdAt);
  let done = 0;
  const due = clientReminderDue(startsAt, confirmedAt, now);
  if (due && row.clientId && await claimReminder(tx, ctx.organizationId, row.id, due)) {
    const clientZone = row.clientTimezone ?? row.clientDefaultTimezone ?? zone;
    await tellClient(tx, ctx, outbox, await clientContacts(tx, ctx.organizationId, row.clientId), {
      type: 'meeting.reminder',
      title: due === 'client_1h' ? `Your meeting with ${row.hostName} is in an hour` : `Reminder: meeting with ${row.hostName} tomorrow`,
      lines: [`Your meeting with ${row.hostName} is on ${formatWhen(startsAt, clientZone)}.`],
      meetingId: row.id,
      meetUrl: row.meetUrl,
      urgent: due === 'client_1h',
    });
    await insertMeetingEvent(tx, ctx.organizationId, row.id, 'reminded', { id: null, kind: 'system' }, { who: 'client', when: due });
    done += 1;
  }
  const soon = startsAt.getTime() - 10 * MINUTE;
  if (soon <= now.getTime() && soon >= confirmedAt.getTime() - MINUTE && await claimReminder(tx, ctx.organizationId, row.id, 'staff_soon')) {
    const staff = row.attendees.filter((attendee) => attendee.userId && (attendee.role === 'host' || attendee.role === 'staff')).map((attendee) => attendee.userId!);
    await tellStaff(tx, ctx, [row.hostId, ...staff], {
      type: 'meeting.reminder',
      title: `Meeting with ${row.clientBusiness ?? 'a client'} in 10 minutes`,
      body: `"${row.title}" at ${formatWhen(startsAt, zone)}.${row.meetUrl ? ' Open it to join.' : ' It has no link yet: add one.'}`,
      meetingId: row.id,
      urgent: true,
    });
    done += 1;
  }
  return done;
}

async function askOutcome(ctx: RequestContext, tx: Tx, row: MeetingRecord, zone: string): Promise<number> {
  if (!(await claimReminder(tx, ctx.organizationId, row.id, 'outcome'))) return 0;
  await tellStaff(tx, ctx, [row.hostId], {
    type: 'meeting.outcome',
    title: `How did the meeting with ${row.clientBusiness ?? 'the client'} go?`,
    body: `"${row.title}" on ${formatWhen(new Date(row.startsAt), zone)}. Record whether it happened, with a note for the team.`,
    meetingId: row.id,
  });
  return 1;
}
