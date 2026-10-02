import type { SqlFragment } from '@tapcrm/authz';
import type { DateOnly, PresenceState } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { DerivedRow } from './state.js';

/**
 * SQL for `user_status` (§9.3): the live-board projection.
 *
 * The projector is the sole writer (LS-9 intent). Callers hold the
 * per-person advisory lock via `lockRow` to avoid two writes racing on
 * the same (org, user) key.
 */

export interface Row {
  id: string; // = userId, since PK is (org, user_id)
  userId: string;
  workDate: DateOnly;
  state: PresenceState;
  since: Date | null;
  lastEventAt: Date | null;
  workedMinutes: number;
  breakMinutes: number;
  presenceConfidence: 'confirmed' | 'assumed';
  lastScanAt: Date | null;
  lastScanDevice: string | null;
  likelyFinishedAt: Date | null;
  isWfh: boolean;
  dayGroup: 'leave' | 'holiday' | null;
  shiftStartAt: Date | null;
  shiftEndAt: Date | null;
  windowStart: Date;
  windowEnd: Date;
  rolloverDueAt: Date;
  graceMinutes: number | null;
  flexibleTargetMinutes: number | null;
  updatedAt: Date;
}

/** Display fields are joined only after the board's subject visibility filter. */
export interface BoardRow extends Row {
  fullName: string;
  departmentId: string | null;
  departmentName: string | null;
  teamId: string | null;
  teamName: string | null;
}

export async function readRow(tx: Tx, userId: string): Promise<Row | null> {
  return tx.maybeOne<Row>(sql`
    SELECT user_id AS id, user_id, work_date::text AS work_date, state, since, last_event_at,
           worked_minutes, break_minutes, presence_confidence, last_scan_at, last_scan_device,
           likely_finished_at, is_wfh, day_group,
           shift_start_at, shift_end_at, window_start, window_end, rollover_due_at,
           grace_minutes, flexible_target_minutes, updated_at
    FROM user_status WHERE user_id = ${userId}
  `);
}

export interface UpsertRow extends DerivedRow {
  readonly organizationId: string;
  readonly userId: string;
}

/** Upsert one row. The projector's sole write path. */
export async function upsertRow(tx: Tx, row: UpsertRow): Promise<void> {
  await tx.query(sql`
    INSERT INTO user_status (
      organization_id, user_id, work_date, state, since, last_event_at,
      worked_minutes, break_minutes, presence_confidence, last_scan_at, last_scan_device,
      likely_finished_at, is_wfh, day_group,
      shift_start_at, shift_end_at, window_start, window_end, rollover_due_at,
      grace_minutes, flexible_target_minutes, updated_at
    ) VALUES (
      ${row.organizationId}, ${row.userId}, ${row.workDate}, ${row.state}, ${row.since}, ${row.lastEventAt},
      ${row.workedMinutes}, ${row.breakMinutes}, ${row.presenceConfidence}, ${row.lastScanAt}, ${row.lastScanDevice},
      ${row.likelyFinishedAt}, ${row.isWfh}, ${row.dayGroup},
      ${row.shiftStartAt}, ${row.shiftEndAt}, ${row.windowStart}, ${row.windowEnd}, ${row.rolloverDueAt},
      ${row.graceMinutes}, ${row.flexibleTargetMinutes}, now()
    )
    ON CONFLICT (organization_id, user_id) DO UPDATE SET
      work_date = EXCLUDED.work_date,
      state = EXCLUDED.state,
      since = EXCLUDED.since,
      last_event_at = EXCLUDED.last_event_at,
      worked_minutes = EXCLUDED.worked_minutes,
      break_minutes = EXCLUDED.break_minutes,
      presence_confidence = EXCLUDED.presence_confidence,
      last_scan_at = EXCLUDED.last_scan_at,
      last_scan_device = EXCLUDED.last_scan_device,
      likely_finished_at = EXCLUDED.likely_finished_at,
      is_wfh = EXCLUDED.is_wfh,
      day_group = EXCLUDED.day_group,
      shift_start_at = EXCLUDED.shift_start_at,
      shift_end_at = EXCLUDED.shift_end_at,
      window_start = EXCLUDED.window_start,
      window_end = EXCLUDED.window_end,
      rollover_due_at = EXCLUDED.rollover_due_at,
      grace_minutes = EXCLUDED.grace_minutes,
      flexible_target_minutes = EXCLUDED.flexible_target_minutes,
      updated_at = now()
  `);
}

/** Per-person mutex for the projector; separate key space from attendance's lock. */
export async function lockRow(tx: Tx, userId: string): Promise<void> {
  await tx.query(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended('live-status:' || current_organization_id()::text || ':' || ${userId}, 0)
    )
  `);
}

/**
 * `listBoard` — GET /api/attendance/live. Joins `app_user u` so the
 * `userStatus` policy filter can target `u.department_id` / `u.team_id`
 * (current placement, not the snapshot on the row).
 */
export async function listBoard(
  tx: Tx,
  visibility: SqlFragment,
): Promise<BoardRow[]> {
  return tx.query<BoardRow>(sql`
    SELECT r.user_id AS id, r.user_id, r.work_date::text AS work_date, r.state, r.since, r.last_event_at,
           r.worked_minutes, r.break_minutes, r.presence_confidence, r.last_scan_at, r.last_scan_device,
           r.likely_finished_at, r.is_wfh, r.day_group,
           r.shift_start_at, r.shift_end_at, r.window_start, r.window_end, r.rollover_due_at,
           r.grace_minutes, r.flexible_target_minutes, r.updated_at,
           u.full_name, u.department_id, d.name AS department_name,
           u.team_id, t.name AS team_name
    FROM user_status r
    JOIN app_user u ON u.organization_id = r.organization_id AND u.id = r.user_id
    LEFT JOIN department d ON d.organization_id = u.organization_id AND d.id = u.department_id
    LEFT JOIN team t ON t.organization_id = u.organization_id AND t.id = u.team_id
    WHERE (${visibility})
    ORDER BY u.full_name, u.id
  `);
}

/** Set of user ids that already have a `user_status` row in this tenant. */
export async function usersWithStatus(tx: Tx): Promise<Set<string>> {
  const rows = await tx.query<{ userId: string }>(sql`
    SELECT user_id FROM user_status
  `);
  return new Set(rows.map((r) => r.userId));
}

/** User ids whose next re-evaluation is due at or before `now`. */
export async function rolloverBatch(
  tx: Tx,
  now: Date,
  limit: number,
): Promise<string[]> {
  const rows = await tx.query<{ userId: string }>(sql`
    SELECT user_id FROM user_status
    WHERE rollover_due_at <= ${now}
    ORDER BY rollover_due_at LIMIT ${limit}
  `);
  return rows.map((r) => r.userId);
}

/**
 * Routing subject for the socket emit. Read from CURRENT `app_user`
 * placement — NOT from any stored snapshot. The HTTP `userStatus` filter
 * uses the same source, so a post-transfer emit lands in the new team's
 * viewer room.
 */
export interface RoutingSubject {
  readonly organizationId: string;
  readonly userId: string;
  readonly departmentId: string | null;
  readonly teamId: string | null;
}
export async function currentRoutingSubject(
  tx: Tx,
  userId: string,
): Promise<RoutingSubject | null> {
  return tx.maybeOne<RoutingSubject>(sql`
    SELECT organization_id, id AS user_id, department_id, team_id
    FROM app_user WHERE id = ${userId}
  `);
}
