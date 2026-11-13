import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import type { SqlFragment } from '@tapcrm/authz';
import { sql } from '../../platform/dal/sql.js';
import type {
  ActorKind,
  AttendeeRole,
  Meeting,
  MeetingAttendee,
  MeetingHistoryEntry,
  MeetingOrigin,
  MeetingProposal,
  MeetingStatus,
  PortalMeeting,
} from './types.js';

/** The tables of this module: meeting, meeting_attendee, meeting_proposal, meeting_event, meeting_reminder. */

interface MeetingRow {
  id: string;
  title: string;
  agenda: string | null;
  status: MeetingStatus;
  origin: MeetingOrigin;
  hostId: string;
  hostName: string;
  hostRole: string | null;
  hostEmail: string | null;
  clientId: string | null;
  clientName: string | null;
  clientBusiness: string | null;
  clientEmail: string | null;
  clientDefaultTimezone: string | null;
  projectId: string | null;
  projectName: string | null;
  requestedById: string;
  requestedByName: string;
  requestedByAccountType: string;
  startsAt: Date;
  endsAt: Date;
  clientTimezone: string | null;
  meetUrl: string | null;
  calendarEventId: string | null;
  calendarOwnerId: string | null;
  calendarError: string | null;
  respondedAt: Date | null;
  confirmedAt: Date | null;
  declineReason: string | null;
  cancelReason: string | null;
  cancelledById: string | null;
  cancelledByName: string | null;
  cancelledByAccountType: string | null;
  outcomeNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  attendees: Array<{ userId: string | null; email: string | null; name: string | null; role: AttendeeRole }>;
  proposals: Array<{ id: string; startsAt: string; endsAt: string; chosenAt: string | null; withdrawnAt: string | null }>;
  history: Array<{ event: string; actorKind: ActorKind; actorName: string | null; detail: Record<string, unknown>; at: string }>;
}

/** Everything one meeting needs, internal fields included; mapped down for staff or the portal. */
export type MeetingRecord = MeetingRow;

const MEETING_SELECT = sql`
  SELECT m.id, m.title, m.agenda, m.status, m.origin,
         m.host_id AS "hostId", host.full_name AS "hostName", host_position.name AS "hostRole", host.email::text AS "hostEmail",
         m.client_id AS "clientId", c.client_name AS "clientName", c.business_name AS "clientBusiness",
         c.email::text AS "clientEmail", c.timezone AS "clientDefaultTimezone",
         m.project_id AS "projectId", pr.name AS "projectName",
         m.requested_by AS "requestedById", rb.full_name AS "requestedByName", rb.account_type AS "requestedByAccountType",
         m.starts_at AS "startsAt", m.ends_at AS "endsAt", m.client_timezone AS "clientTimezone",
         m.meet_url AS "meetUrl", m.calendar_event_id AS "calendarEventId", m.calendar_owner_id AS "calendarOwnerId",
         m.calendar_error AS "calendarError", m.responded_at AS "respondedAt", m.confirmed_at AS "confirmedAt",
         m.decline_reason AS "declineReason", m.cancel_reason AS "cancelReason",
         m.cancelled_by AS "cancelledById", cb.full_name AS "cancelledByName", cb.account_type AS "cancelledByAccountType",
         m.outcome_note AS "outcomeNote", m.created_at AS "createdAt", m.updated_at AS "updatedAt",
         COALESCE((
           SELECT json_agg(json_build_object('userId', a.user_id, 'email', COALESCE(a.email::text, au.email::text),
                                             'name', COALESCE(au.full_name, a.display_name), 'role', a.role) ORDER BY a.added_at)
             FROM meeting_attendee a
             LEFT JOIN app_user au ON au.organization_id = a.organization_id AND au.id = a.user_id
            WHERE a.organization_id = m.organization_id AND a.meeting_id = m.id), '[]'::json) AS attendees,
         COALESCE((
           SELECT json_agg(json_build_object('id', p.id, 'startsAt', p.starts_at, 'endsAt', p.ends_at,
                                             'chosenAt', p.chosen_at, 'withdrawnAt', p.withdrawn_at) ORDER BY p.starts_at)
             FROM meeting_proposal p
            WHERE p.organization_id = m.organization_id AND p.meeting_id = m.id), '[]'::json) AS proposals,
         COALESCE((
           SELECT json_agg(json_build_object('event', e.event, 'actorKind', e.actor_kind, 'actorName', ea.full_name,
                                             'detail', e.detail, 'at', e.created_at) ORDER BY e.created_at)
             FROM meeting_event e
             LEFT JOIN app_user ea ON ea.organization_id = e.organization_id AND ea.id = e.actor_id
            WHERE e.organization_id = m.organization_id AND e.meeting_id = m.id), '[]'::json) AS history
    FROM meeting m
    JOIN app_user host ON host.organization_id = m.organization_id AND host.id = m.host_id
    LEFT JOIN position host_position ON host_position.organization_id = host.organization_id AND host_position.id = host.position_id
    LEFT JOIN client c ON c.organization_id = m.organization_id AND c.id = m.client_id
    LEFT JOIN project pr ON pr.organization_id = m.organization_id AND pr.id = m.project_id
    JOIN app_user rb ON rb.organization_id = m.organization_id AND rb.id = m.requested_by
    LEFT JOIN app_user cb ON cb.organization_id = m.organization_id AND cb.id = m.cancelled_by`;

const date = (value: string | Date | null): Date | null => (value === null ? null : new Date(value));

export function toStaffMeeting(row: MeetingRecord): Meeting {
  return {
    id: row.id,
    title: row.title,
    agenda: row.agenda,
    status: row.status,
    origin: row.origin,
    host: { id: row.hostId, name: row.hostName, role: row.hostRole },
    client: row.clientId ? { id: row.clientId, name: row.clientName ?? '', businessName: row.clientBusiness ?? '' } : null,
    project: row.projectId ? { id: row.projectId, name: row.projectName ?? '' } : null,
    requestedBy: { id: row.requestedById, name: row.requestedByName, kind: row.requestedByAccountType === 'client' ? 'client' : 'staff' },
    startsAt: new Date(row.startsAt),
    endsAt: new Date(row.endsAt),
    clientTimezone: row.clientTimezone,
    meetUrl: row.meetUrl,
    onCalendar: row.calendarEventId !== null,
    calendarError: row.calendarError,
    respondedAt: date(row.respondedAt),
    declineReason: row.declineReason,
    cancelReason: row.cancelReason,
    cancelledBy: row.cancelledById
      ? { name: row.cancelledByName ?? '', kind: row.cancelledByAccountType === 'client' ? 'client' : 'staff' }
      : null,
    outcomeNote: row.outcomeNote,
    attendees: row.attendees.map((attendee): MeetingAttendee => ({ ...attendee })),
    proposals: row.proposals.map((proposal): MeetingProposal => ({
      id: proposal.id,
      startsAt: new Date(proposal.startsAt),
      endsAt: new Date(proposal.endsAt),
      chosenAt: date(proposal.chosenAt),
      withdrawnAt: date(proposal.withdrawnAt),
    })),
    history: row.history.map((entry): MeetingHistoryEntry => ({ ...entry, at: new Date(entry.at) })),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

export function toPortalMeeting(row: MeetingRecord, viewerId: string, now: Date): PortalMeeting {
  const clientSide = (id: string | null, accountType: string | null) => id !== null && (id === viewerId || accountType === 'client');
  return {
    id: row.id,
    title: row.title,
    agenda: row.agenda,
    status: row.status,
    host: { name: row.hostName, role: row.hostRole },
    project: row.projectId ? { id: row.projectId, name: row.projectName ?? '' } : null,
    startsAt: new Date(row.startsAt),
    endsAt: new Date(row.endsAt),
    meetUrl: row.status === 'confirmed' ? row.meetUrl : null,
    proposals: row.status === 'proposed'
      ? row.proposals
          .filter((proposal) => proposal.chosenAt === null && proposal.withdrawnAt === null && new Date(proposal.startsAt) > now)
          .map((proposal) => ({ id: proposal.id, startsAt: new Date(proposal.startsAt), endsAt: new Date(proposal.endsAt) }))
      : [],
    declineReason: row.status === 'declined' ? row.declineReason : null,
    cancelReason: row.status === 'cancelled' ? row.cancelReason : null,
    cancelledByYou: row.status === 'cancelled' ? clientSide(row.cancelledById, row.cancelledByAccountType) : null,
    requestedByYou: clientSide(row.requestedById, row.requestedByAccountType),
    createdAt: new Date(row.createdAt),
  };
}

export async function findMeetingTx(tx: Tx, organizationId: string, id: string): Promise<MeetingRecord | null> {
  return tx.maybeOne<MeetingRecord>(sql`${MEETING_SELECT} WHERE m.organization_id = ${organizationId} AND m.id = ${id}`);
}

export async function findMeeting(ctx: RequestContext, id: string): Promise<MeetingRecord | null> {
  return db.maybeOne<MeetingRecord>(ctx, sql`${MEETING_SELECT} WHERE m.organization_id = ${ctx.organizationId} AND m.id = ${id}`);
}

export async function listMeetingRecords(ctx: RequestContext, filter: SqlFragment, limit = 300): Promise<MeetingRecord[]> {
  return db.query<MeetingRecord>(ctx, sql`
    ${MEETING_SELECT}
    WHERE m.organization_id = ${ctx.organizationId} AND ${filter}
    ORDER BY m.starts_at DESC
    LIMIT ${limit}
  `);
}

/** Holds the host's diary while a time is checked and taken, so two answers cannot double-book them. */
export async function lockHostDiary(tx: Tx, organizationId: string, hostId: string): Promise<void> {
  await tx.query(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`meetings:${organizationId}:${hostId}`}, 0))`);
}

/** An open meeting (or offered time) of `userId` overlapping the slot, other than `exceptId`. */
export async function clashingMeeting(
  tx: Tx,
  organizationId: string,
  userId: string,
  startsAt: Date,
  endsAt: Date,
  exceptId: string | null,
): Promise<string | null> {
  const row = await tx.maybeOne<{ id: string }>(sql`
    SELECT m.id FROM meeting m
     WHERE m.organization_id = ${organizationId}
       AND m.status IN ('requested', 'proposed', 'confirmed')
       AND m.starts_at < ${endsAt} AND m.ends_at > ${startsAt}
       AND (${exceptId}::uuid IS NULL OR m.id <> ${exceptId}::uuid)
       AND (m.status <> 'proposed' OR m.calendar_event_id IS NOT NULL)
       AND (m.host_id = ${userId} OR EXISTS (
             SELECT 1 FROM meeting_attendee a WHERE a.organization_id = m.organization_id AND a.meeting_id = m.id
                AND a.user_id = ${userId} AND a.role IN ('host', 'staff')))
    UNION ALL
    SELECT p.meeting_id FROM meeting_proposal p
      JOIN meeting m ON m.organization_id = p.organization_id AND m.id = p.meeting_id
     WHERE p.organization_id = ${organizationId} AND m.status = 'proposed' AND m.host_id = ${userId}
       AND p.chosen_at IS NULL AND p.withdrawn_at IS NULL
       AND p.starts_at < ${endsAt} AND p.ends_at > ${startsAt}
       AND (${exceptId}::uuid IS NULL OR m.id <> ${exceptId}::uuid)
    LIMIT 1
  `);
  return row?.id ?? null;
}

export async function insertMeetingEvent(
  tx: Tx,
  organizationId: string,
  meetingId: string,
  event: string,
  actor: { id: string | null; kind: ActorKind },
  detail: Record<string, unknown> = {},
): Promise<void> {
  await tx.query(sql`
    INSERT INTO meeting_event (organization_id, meeting_id, event, actor_id, actor_kind, detail)
    VALUES (${organizationId}, ${meetingId}, ${event}, ${actor.id}, ${actor.kind}, ${JSON.stringify(detail)}::jsonb)
  `);
}

export async function addAttendee(
  tx: Tx,
  organizationId: string,
  meetingId: string,
  attendee: { userId: string | null; email: string | null; name: string | null; role: AttendeeRole; addedBy: string | null },
): Promise<void> {
  if (attendee.userId) {
    await tx.query(sql`
      INSERT INTO meeting_attendee (organization_id, meeting_id, user_id, email, display_name, role, added_by)
      VALUES (${organizationId}, ${meetingId}, ${attendee.userId}, ${attendee.email}, ${attendee.name}, ${attendee.role}, ${attendee.addedBy})
      ON CONFLICT (organization_id, meeting_id, user_id) WHERE user_id IS NOT NULL DO NOTHING
    `);
  } else {
    await tx.query(sql`
      INSERT INTO meeting_attendee (organization_id, meeting_id, user_id, email, display_name, role, added_by)
      VALUES (${organizationId}, ${meetingId}, NULL, ${attendee.email}, ${attendee.name}, ${attendee.role}, ${attendee.addedBy})
      ON CONFLICT (organization_id, meeting_id, email) WHERE user_id IS NULL DO NOTHING
    `);
  }
}

/** Reminders for the old time no longer apply once a meeting moves. */
export async function resetTimeReminders(tx: Tx, organizationId: string, meetingId: string): Promise<void> {
  await tx.query(sql`
    DELETE FROM meeting_reminder
     WHERE organization_id = ${organizationId} AND meeting_id = ${meetingId}
       AND kind IN ('client_24h', 'client_1h', 'staff_soon', 'outcome')
  `);
}

/** Records a reminder as sent; false when it already was. */
export async function claimReminder(tx: Tx, organizationId: string, meetingId: string, kind: string): Promise<boolean> {
  const rows = await tx.query<{ kind: string }>(sql`
    INSERT INTO meeting_reminder (organization_id, meeting_id, kind) VALUES (${organizationId}, ${meetingId}, ${kind})
    ON CONFLICT DO NOTHING RETURNING kind
  `);
  return rows.length > 0;
}

/**
 * Whether `u` (an app_user row) may be offered to clients: a Super Admin, or
 * someone whose position grants meetings:host unless a personal override takes
 * it away, or whose personal override grants it.
 */
export const HOLDS_HOST_U = sql`(u.account_type = 'super-admin' OR EXISTS (
      SELECT 1 FROM user_override granted
       WHERE granted.organization_id = u.organization_id AND granted.user_id = u.id
         AND granted.action = 'meetings:host' AND granted.allowed AND granted.revoked_at IS NULL
         AND (granted.expires_at IS NULL OR granted.expires_at > now()))
    OR (EXISTS (
      SELECT 1 FROM position_policy pp
       WHERE pp.organization_id = u.organization_id AND pp.position_id = u.position_id
         AND pp.action = 'meetings:host' AND pp.allowed)
      AND NOT EXISTS (
      SELECT 1 FROM user_override denied
       WHERE denied.organization_id = u.organization_id AND denied.user_id = u.id
         AND denied.action = 'meetings:host' AND NOT denied.allowed AND denied.revoked_at IS NULL
         AND (denied.expires_at IS NULL OR denied.expires_at > now()))))`;

export interface ProjectHost {
  readonly id: string;
  readonly name: string;
  readonly role: string | null;
  readonly email: string | null;
}

/** The people on the client's project who meet clients. */
export async function projectHosts(tx: Tx, organizationId: string, clientId: string, projectId: string): Promise<ProjectHost[]> {
  return tx.query<ProjectHost>(sql`
    SELECT u.id, u.full_name AS name, p.name AS role, u.email::text AS email
      FROM project_assignee pa
      JOIN project pr ON pr.organization_id = pa.organization_id AND pr.id = pa.project_id
      JOIN app_user u ON u.organization_id = pa.organization_id AND u.id = pa.user_id
      LEFT JOIN position p ON p.organization_id = u.organization_id AND p.id = u.position_id
     WHERE pa.organization_id = ${organizationId} AND pa.project_id = ${projectId}
       AND pr.client_id = ${clientId} AND pr.archived_at IS NULL
       AND u.status = 'active' AND u.account_type IN ('employee', 'super-admin')
       AND ${HOLDS_HOST_U}
     ORDER BY u.full_name
  `);
}

export interface ClientContact {
  readonly userId: string | null;
  readonly email: string;
  readonly name: string;
}

/** Who on the client's side hears about the meeting: the client record and its portal logins. */
export async function clientContacts(tx: Tx, organizationId: string, clientId: string): Promise<ClientContact[]> {
  const rows = await tx.query<ClientContact>(sql`
    SELECT NULL::uuid AS "userId", c.email::text AS email, c.client_name AS name
      FROM client c WHERE c.organization_id = ${organizationId} AND c.id = ${clientId}
    UNION ALL
    SELECT u.id, u.email::text, u.full_name
      FROM app_user u
     WHERE u.organization_id = ${organizationId} AND u.client_id = ${clientId}
       AND u.account_type = 'client' AND u.status = 'active' AND u.email IS NOT NULL
  `);
  const byEmail = new Map<string, ClientContact>();
  for (const row of rows) {
    const key = row.email.toLowerCase();
    const known = byEmail.get(key);
    // A portal login for the same address wins: it can also be told in the app.
    if (!known || (!known.userId && row.userId)) byEmail.set(key, row);
  }
  return [...byEmail.values()];
}
