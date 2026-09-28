import type {
  AssignmentReason,
  DateOnly,
  EventKind,
  EventSource,
  Evidence,
  ResolvedShift,
} from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { ATTENDANCE_EVENTS, type RecalcRequested } from './events.js';

/**
 * SQL for the ledger, the day records and the assignments (design §8.1).
 * Dates come back as 'YYYY-MM-DD' text, never as JavaScript Dates (T-1).
 */

/** D24 — one person's writes run one at a time; everyone else in parallel. */
export async function lockPerson(tx: Tx, userId: string): Promise<void> {
  await tx.query(sql`
    SELECT pg_advisory_xact_lock(hashtextextended('attendance:' || current_organization_id()::text || ':' || ${userId}, 0))
  `);
}

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

export interface NewEvent {
  readonly organizationId: string;
  readonly userId: string;
  readonly kind: EventKind;
  readonly occurredAt: Date;
  readonly source: EventSource;
  readonly evidence: Evidence;
  readonly biometricPunchId?: string | null;
  readonly correctionId?: string | null;
  readonly supersedesEventId?: string | null;
  readonly isVoid?: boolean;
  readonly remote?: boolean;
  readonly clientEventId?: string | null;
  readonly clientRequestHash?: string | null;
  readonly clientTime?: Date | null;
  readonly recordedBy?: string | null;
}

/** The database generates every id, so a row can only ever name an older one (§8.1). */
export async function insertEvent(tx: Tx, e: NewEvent): Promise<string> {
  const row = await tx.one<{ id: string }>(sql`
    INSERT INTO attendance_event (
      organization_id, user_id, kind, occurred_at, source, evidence, biometric_punch_id, correction_id,
      supersedes_event_id, is_void, remote, client_event_id, client_request_hash, client_time, recorded_by
    ) VALUES (
      ${e.organizationId}, ${e.userId}, ${e.kind}, ${e.occurredAt}, ${e.source}, ${e.evidence},
      ${e.biometricPunchId ?? null}, ${e.correctionId ?? null}, ${e.supersedesEventId ?? null},
      ${e.isVoid ?? false}, ${e.remote ?? false}, ${e.clientEventId ?? null}, ${e.clientRequestHash ?? null},
      ${e.clientTime ?? null}, ${e.recordedBy ?? null}
    )
    RETURNING id
  `);
  return row.id;
}

export interface ClientEventRow {
  eventId: string;
  clientRequestHash: string | null;
  workDate: DateOnly | null;
  reason: AssignmentReason | null;
}

export async function findClientEvent(
  tx: Tx,
  userId: string,
  clientEventId: string,
): Promise<ClientEventRow | null> {
  return tx.maybeOne<ClientEventRow>(sql`
    SELECT e.id AS event_id, e.client_request_hash, r.work_date::text AS work_date, a.reason
    FROM attendance_event e
    LEFT JOIN attendance_event_assignment a ON a.organization_id = e.organization_id AND a.event_id = e.id
    LEFT JOIN attendance_record r ON r.organization_id = a.organization_id AND r.id = a.attendance_record_id
    WHERE e.user_id = ${userId} AND e.client_event_id = ${clientEventId}
  `);
}

/**
 * The event a device punch made, if it made one — retired or not. A raw punch
 * makes one event, however often it is delivered; the partial unique index of
 * migration 0057 is the backstop when two deliveries race.
 */
export async function findEventByBiometricPunchId(
  tx: Tx,
  userId: string,
  biometricPunchId: string,
): Promise<ClientEventRow | null> {
  return tx.maybeOne<ClientEventRow>(sql`
    SELECT e.id AS event_id, NULL::text AS client_request_hash,
           r.work_date::text AS work_date, a.reason
    FROM attendance_event e
    LEFT JOIN attendance_event_assignment a ON a.organization_id = e.organization_id AND a.event_id = e.id
    LEFT JOIN attendance_record r ON r.organization_id = a.organization_id AND r.id = a.attendance_record_id
    WHERE e.user_id = ${userId} AND e.biometric_punch_id = ${biometricPunchId}
  `);
}

export interface StoredEvent {
  id: string;
  userId: string;
  kind: EventKind;
  occurredAt: Date;
  source: EventSource;
  evidence: Evidence;
  isVoid: boolean;
  superseded: boolean;
  recordId: string | null;
  workDate: DateOnly | null;
}

export async function findEvent(tx: Tx, eventId: string): Promise<StoredEvent | null> {
  return tx.maybeOne<StoredEvent>(sql`
    SELECT e.id, e.user_id, e.kind, e.occurred_at, e.source, e.evidence, e.is_void,
           EXISTS (SELECT 1 FROM attendance_event s
                   WHERE s.organization_id = e.organization_id AND s.supersedes_event_id = e.id) AS superseded,
           a.attendance_record_id AS record_id, r.work_date::text AS work_date
    FROM attendance_event e
    LEFT JOIN attendance_event_assignment a ON a.organization_id = e.organization_id AND a.event_id = e.id
    LEFT JOIN attendance_record r ON r.organization_id = a.organization_id AND r.id = a.attendance_record_id
    WHERE e.id = ${eventId}
  `);
}

export interface NeighbourhoodEvent {
  id: string;
  kind: EventKind;
  occurredAt: Date;
  source: EventSource;
  evidence: Evidence;
  assignedDate: DateOnly | null;
  reason: AssignmentReason | null;
  pinned: boolean | null;
}

/**
 * D28 — `effectiveEventsOf`: the one definition of an effective event. Not a
 * void row, and not named by any row's `supersedes_event_id`. Returns those
 * whose instant falls in [from, to), or that are assigned to a day in
 * `firstDate..lastDate`, with their current assignment.
 */
export async function effectiveEventsOf(
  tx: Tx,
  userId: string,
  window: { readonly from: Date; readonly to: Date },
  dates: { readonly first: DateOnly; readonly last: DateOnly },
): Promise<NeighbourhoodEvent[]> {
  return tx.query<NeighbourhoodEvent>(sql`
    SELECT e.id, e.kind, e.occurred_at, e.source, e.evidence,
           r.work_date::text AS assigned_date, a.reason, a.pinned
    FROM attendance_event e
    LEFT JOIN attendance_event_assignment a ON a.organization_id = e.organization_id AND a.event_id = e.id
    LEFT JOIN attendance_record r ON r.organization_id = a.organization_id AND r.id = a.attendance_record_id
    WHERE e.user_id = ${userId}
      AND NOT e.is_void
      AND NOT EXISTS (SELECT 1 FROM attendance_event s
                      WHERE s.organization_id = e.organization_id AND s.supersedes_event_id = e.id)
      AND ((e.occurred_at >= ${window.from} AND e.occurred_at < ${window.to})
           OR r.work_date BETWEEN ${dates.first} AND ${dates.last})
    ORDER BY e.occurred_at, e.id
  `);
}

/* ------------------------------------------------------------------ *
 * Records
 * ------------------------------------------------------------------ */

export interface DayFactsRow {
  readonly workDate: DateOnly;
  readonly windowStart: Date;
  readonly windowEnd: Date;
  readonly closeDueAt: Date;
  readonly shift: ResolvedShift;
  /** `not-employed`: a day outside the person's employment window, kept and marked (§8.6). */
  readonly dayType: 'working' | 'week-off' | 'holiday' | 'not-employed';
}

export interface Placement {
  readonly departmentId: string | null;
  readonly teamId: string | null;
  readonly positionId: string | null;
}

export async function currentPlacement(tx: Tx, userId: string): Promise<Placement> {
  return tx.one<Placement>(
    sql`SELECT department_id, team_id, position_id FROM app_user WHERE id = ${userId}`,
  );
}

export interface AppUserRow extends Placement {
  readonly id: string;
  readonly organizationId: string;
  readonly accountType: string;
  readonly status: string;
  readonly joinedOn: DateOnly | null;
  readonly leftOn: DateOnly | null;
}

/** Employment + current placement for day-open (§8.6). Null when the user is not in the tenant. */
export async function findAppUser(tx: Tx, userId: string): Promise<AppUserRow | null> {
  return tx.maybeOne<AppUserRow>(sql`
    SELECT id, organization_id, account_type, status, department_id, team_id, position_id,
           joined_on::text AS joined_on, left_on::text AS left_on
    FROM app_user WHERE id = ${userId}
  `);
}

/* ------------------------------------------------------------------ *
 * Day-open watermark and lease (§8.6)
 * ------------------------------------------------------------------ */

const LEASE_STALE_INTERVAL = "interval '15 minutes'";

/**
 * Ensure the state row exists for the organization. A fresh organization
 * starts at yesterday in its own timezone, so its first run opens today and
 * nothing before it: day-open never invents history.
 */
export async function ensureDayOpenStateRow(
  tx: Tx,
  organizationId: string,
): Promise<void> {
  await tx.query(sql`
    INSERT INTO attendance_day_open_state (organization_id, materialised_through)
    SELECT id, (now() AT TIME ZONE timezone)::date - 1 FROM organization WHERE id = ${organizationId}
    ON CONFLICT (organization_id) DO NOTHING
  `);
}

export interface DayOpenState {
  readonly materialisedThrough: DateOnly;
  readonly lastFailedDate: DateOnly | null;
  readonly leaseAcquiredAt: Date | null;
  readonly leaseHolder: string | null;
}

export async function readDayOpenState(
  tx: Tx,
  organizationId: string,
): Promise<DayOpenState | null> {
  return tx.maybeOne<DayOpenState>(sql`
    SELECT materialised_through::text AS materialised_through,
           last_failed_date::text AS last_failed_date,
           lease_acquired_at, lease_holder
    FROM attendance_day_open_state WHERE organization_id = ${organizationId}
  `);
}

/**
 * Try to acquire the whole-run lease. Returns `true` if we got it (either as
 * a fresh lease or after taking over a stale one), `false` if another run
 * still holds a fresh lease.
 */
export async function tryAcquireDayOpenLease(
  tx: Tx,
  organizationId: string,
  holder: string,
): Promise<boolean> {
  const rows = await tx.query<{ organizationId: string }>(sql`
    UPDATE attendance_day_open_state
    SET lease_acquired_at = now(), lease_holder = ${holder}
    WHERE organization_id = ${organizationId}
      AND (lease_acquired_at IS NULL OR lease_acquired_at < now() - ${sql.raw(LEASE_STALE_INTERVAL)})
    RETURNING organization_id
  `);
  return rows.length === 1;
}

/** Keeps a long run's lease fresh. Only the holder can renew it. */
export async function renewDayOpenLease(
  tx: Tx,
  organizationId: string,
  holder: string,
): Promise<void> {
  await tx.query(sql`
    UPDATE attendance_day_open_state SET lease_acquired_at = now()
    WHERE organization_id = ${organizationId} AND lease_holder = ${holder}
  `);
}

/**
 * Releases the lease. With `holder`, only if that run still holds it, so a
 * run whose lease was taken over cannot release its successor's; without,
 * unconditionally (an operator's reset).
 */
export async function releaseDayOpenLease(
  tx: Tx,
  organizationId: string,
  holder?: string,
): Promise<void> {
  await tx.query(sql`
    UPDATE attendance_day_open_state
    SET lease_acquired_at = NULL, lease_holder = NULL
    WHERE organization_id = ${organizationId}
      AND (${holder ?? null}::text IS NULL OR lease_holder = ${holder ?? null})
  `);
}

export async function advanceWatermarkTo(
  tx: Tx,
  organizationId: string,
  date: DateOnly,
): Promise<void> {
  await tx.query(sql`
    UPDATE attendance_day_open_state
    SET materialised_through = ${date}
    WHERE organization_id = ${organizationId} AND materialised_through < ${date}
  `);
}

export async function recordDayOpenFailure(
  tx: Tx,
  organizationId: string,
  date: DateOnly,
): Promise<void> {
  await tx.query(sql`
    UPDATE attendance_day_open_state
    SET last_failed_date = ${date}
    WHERE organization_id = ${organizationId}
  `);
}

export async function clearDayOpenFailure(tx: Tx, organizationId: string): Promise<void> {
  await tx.query(sql`
    UPDATE attendance_day_open_state
    SET last_failed_date = NULL
    WHERE organization_id = ${organizationId}
  `);
}

/** `opensDaysOn` in SQL, over `app_user u`. The two must agree. */
function opensDaysSql(date: DateOnly) {
  return sql`
    u.account_type = 'employee'
    AND (u.joined_on IS NULL OR u.joined_on <= ${date}::date)
    AND CASE WHEN u.left_on IS NOT NULL THEN ${date}::date <= u.left_on
             ELSE u.status IN ('active', 'locked') END`;
}

/** The people day-open opens `date` for: those employed on it. Ordered for stable iteration. */
export async function listEmployedUserIds(tx: Tx, date: DateOnly): Promise<string[]> {
  const rows = await tx.query<{ id: string }>(sql`
    SELECT u.id FROM app_user u
    WHERE ${opensDaysSql(date)}
    ORDER BY u.id
  `);
  return rows.map((r) => r.id);
}

/** People employed on `date` who have no day for it yet. */
export async function employedWithoutDay(tx: Tx, date: DateOnly): Promise<string[]> {
  const rows = await tx.query<{ id: string }>(sql`
    SELECT u.id FROM app_user u
    WHERE ${opensDaysSql(date)}
      AND NOT EXISTS (
        SELECT 1 FROM attendance_record r
        WHERE r.organization_id = u.organization_id AND r.user_id = u.id AND r.work_date = ${date}::date
      )
    ORDER BY u.id
  `);
  return rows.map((r) => r.id);
}

/**
 * The placement each day from `from` to `to` recorded when it was built. The
 * directory keeps no history, so a built day is judged with this, not with
 * today's department (§8.1 "Why a placement snapshot").
 */
export async function placementsBetween(
  tx: Tx,
  userId: string,
  from: DateOnly,
  to: DateOnly,
): Promise<Map<DateOnly, Placement>> {
  const rows = await tx.query<{ workDate: DateOnly; placement: Placement }>(sql`
    SELECT work_date::text AS work_date, placement_snapshot AS placement
    FROM attendance_record
    WHERE user_id = ${userId} AND work_date BETWEEN ${from} AND ${to}
  `);
  return new Map(rows.map((row) => [row.workDate, row.placement]));
}

export interface RecordRow {
  id: string;
  workDate: DateOnly;
  state: 'open' | 'closed';
  inputVersion: number;
  attributionFlags: string[];
}

/**
 * Insert-then-lock (§8.4 steps 5 and 6): "find, else create" would lose a race
 * with day-open; the unique day index makes one insert a no-op and both
 * callers end up holding the same row.
 */
export async function materialise(
  tx: Tx,
  organizationId: string,
  userId: string,
  days: readonly DayFactsRow[],
  placement: Placement,
): Promise<Map<DateOnly, RecordRow>> {
  for (const day of days) {
    await tx.query(sql`
      INSERT INTO attendance_record (
        organization_id, user_id, work_date, window_start, window_end, close_due_at,
        shift_snapshot, shift_source, placement_snapshot, day_type
      ) VALUES (
        ${organizationId}, ${userId}, ${day.workDate}, ${day.windowStart}, ${day.windowEnd}, ${day.closeDueAt},
        ${JSON.stringify(day.shift)}::jsonb, ${day.shift.source}, ${JSON.stringify(placement)}::jsonb, ${day.dayType}
      )
      ON CONFLICT (organization_id, user_id, work_date) DO NOTHING
    `);
  }
  return lockRecords(
    tx,
    userId,
    days.map((day) => day.workDate),
  );
}

export async function lockRecords(
  tx: Tx,
  userId: string,
  dates: readonly DateOnly[],
): Promise<Map<DateOnly, RecordRow>> {
  if (dates.length === 0) return new Map();
  const rows = await tx.query<RecordRow>(sql`
    SELECT id, work_date::text AS work_date, state, input_version, attribution_flags
    FROM attendance_record
    WHERE user_id = ${userId} AND work_date = ANY(${[...dates]}::date[])
    ORDER BY work_date
    FOR UPDATE
  `);
  return new Map(rows.map((row) => [row.workDate, row]));
}

/**
 * `refreshDayFacts` (§8.5): while a day is open its facts follow the shifts;
 * a closed day's change only with `includeClosed`, for a past shift or
 * calendar change (SH-6, HO-3). Returns true when anything changed.
 */
export async function refreshFacts(
  tx: Tx,
  recordId: string,
  day: DayFactsRow,
  includeClosed = false,
): Promise<boolean> {
  const rows = await tx.query<{ id: string }>(sql`
    UPDATE attendance_record
    SET window_start = ${day.windowStart}, window_end = ${day.windowEnd}, close_due_at = ${day.closeDueAt},
        shift_snapshot = ${JSON.stringify(day.shift)}::jsonb, shift_source = ${day.shift.source},
        day_type = ${day.dayType}
    WHERE id = ${recordId} AND (state = 'open' OR ${includeClosed})
      AND (window_start, window_end, close_due_at, shift_snapshot, day_type) IS DISTINCT FROM
          (${day.windowStart}::timestamptz, ${day.windowEnd}::timestamptz, ${day.closeDueAt}::timestamptz,
           ${JSON.stringify(day.shift)}::jsonb, ${day.dayType}::text)
    RETURNING id
  `);
  return rows.length === 1;
}

export async function setAttributionFlags(
  tx: Tx,
  recordId: string,
  flags: readonly string[],
): Promise<boolean> {
  const rows = await tx.query<{ id: string }>(sql`
    UPDATE attendance_record SET attribution_flags = ${[...flags].sort()}::text[]
    WHERE id = ${recordId} AND attribution_flags IS DISTINCT FROM ${[...flags].sort()}::text[]
    RETURNING id
  `);
  return rows.length === 1;
}

/* ------------------------------------------------------------------ *
 * Assignments
 * ------------------------------------------------------------------ */

/** Writes the assignment only when its day or reason changed. Returns the day it left, if any. */
export async function assign(
  tx: Tx,
  a: {
    organizationId: string;
    userId: string;
    eventId: string;
    recordId: string;
    reason: AssignmentReason;
    pinned: boolean;
  },
): Promise<{ changed: boolean; previousRecordId: string | null }> {
  const previous = await tx.maybeOne<{ recordId: string; reason: AssignmentReason }>(sql`
    SELECT attendance_record_id AS record_id, reason FROM attendance_event_assignment WHERE event_id = ${a.eventId}
  `);
  if (
    previous !== null &&
    previous.recordId === a.recordId &&
    previous.reason === a.reason
  ) {
    return { changed: false, previousRecordId: previous.recordId };
  }
  await tx.query(sql`
    INSERT INTO attendance_event_assignment (organization_id, user_id, event_id, attendance_record_id, reason, pinned)
    VALUES (${a.organizationId}, ${a.userId}, ${a.eventId}, ${a.recordId}, ${a.reason}, ${a.pinned})
    ON CONFLICT (organization_id, event_id) DO UPDATE
    SET attendance_record_id = EXCLUDED.attendance_record_id, reason = EXCLUDED.reason, pinned = EXCLUDED.pinned,
        assignment_version = attendance_event_assignment.assignment_version + 1, assigned_at = now()
  `);
  return { changed: true, previousRecordId: previous?.recordId ?? null };
}

/** Single-record lookup for day-open. Returns null when the day has no record yet. */
export async function findRecordByDate(
  tx: Tx,
  userId: string,
  date: DateOnly,
): Promise<{ id: string; inputVersion: number } | null> {
  return tx.maybeOne<{ id: string; inputVersion: number }>(sql`
    SELECT id, input_version FROM attendance_record
    WHERE user_id = ${userId} AND work_date = ${date}
  `);
}

/** Full record for AT-12 day detail. Reads stored snapshots (design §8.1). */
export interface RecordDetailRow {
  id: string;
  workDate: DateOnly;
  state: 'open' | 'closed';
  status: string | null;
  dayType: string;
  shiftSnapshot: unknown;
  shiftSource: string;
  placementSnapshot: {
    departmentId: string | null;
    teamId: string | null;
    positionId: string | null;
  };
  windowStart: string;
  windowEnd: string;
  closeDueAt: string;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  earlyExitMinutes: number;
  overtimeMinutes: number;
  nightMinutes: number;
  presentUnits: number;
  paidLeaveUnits: number; // a half-day count, not money (CI-21)
  unpaidLeaveUnits: number;
  absentUnits: number;
  holidayUnits: number;
  arrivalAt: string | null;
  departureAt: string | null;
  isWfh: boolean;
  flags: string[];
  attributionFlags: string[];
  inputVersion: number;
  calculationVersion: number;
  rulesVersion: string;
  calculatedAt: string | null;
  closedAt: string | null;
  closedBy: string | null;
}
export async function findRecordFull(
  tx: Tx,
  userId: string,
  date: DateOnly,
): Promise<RecordDetailRow | null> {
  return tx.maybeOne<RecordDetailRow>(sql`
    SELECT id, work_date::text AS work_date, state, status, day_type,
           shift_snapshot, shift_source, placement_snapshot,
           window_start::text AS window_start, window_end::text AS window_end,
           close_due_at::text AS close_due_at,
           worked_minutes, break_minutes, late_minutes, early_exit_minutes,
           overtime_minutes, night_minutes,
           present_units, paid_leave_units, unpaid_leave_units, absent_units, holiday_units,
           arrival_at::text AS arrival_at, departure_at::text AS departure_at,
           is_wfh, flags, attribution_flags,
           input_version, calculation_version, rules_version,
           calculated_at::text AS calculated_at,
           closed_at::text AS closed_at, closed_by
    FROM attendance_record
    WHERE user_id = ${userId} AND work_date = ${date}
  `);
}

export interface SupersededEventRow {
  id: string;
  kind: EventKind;
  occurredAt: Date;
  source: EventSource;
  isVoid: boolean;
  supersededBy: string | null;
}

/**
 * Events for a person and date that are NOT effective — void rows, or events
 * that a later row supersedes. AT-12 shows these below the effective list so
 * a reviewer can see the ledger's history.
 */
export async function supersededEventsOf(
  tx: Tx,
  userId: string,
  date: DateOnly,
): Promise<SupersededEventRow[]> {
  return tx.query<SupersededEventRow>(sql`
    SELECT e.id, e.kind, e.occurred_at, e.source, e.is_void,
           (SELECT s.id FROM attendance_event s
            WHERE s.organization_id = e.organization_id AND s.supersedes_event_id = e.id
            LIMIT 1) AS superseded_by
    FROM attendance_event e
    JOIN attendance_event_assignment a
      ON a.organization_id = e.organization_id AND a.event_id = e.id
    JOIN attendance_record r
      ON r.organization_id = a.organization_id AND r.id = a.attendance_record_id
    WHERE e.user_id = ${userId} AND r.work_date = ${date}
      AND (e.is_void OR EXISTS (SELECT 1 FROM attendance_event s
                                WHERE s.organization_id = e.organization_id AND s.supersedes_event_id = e.id))
    ORDER BY e.occurred_at, e.id
  `);
}

export interface OverlayForDayRow {
  id: string;
  kind: string;
  paid: boolean | null;
  consequence: string | null;
  minutes: number | null;
  sourceKind: 'leave' | 'wfh' | 'break-breach';
  sourceId: string;
}
export async function overlaysForDay(
  tx: Tx,
  userId: string,
  date: DateOnly,
): Promise<OverlayForDayRow[]> {
  const rows = await tx.query<{
    id: string;
    kind: string;
    paid: boolean | null;
    consequence: string | null;
    minutes: number | null;
    leaveRequestId: string | null;
    breakBreachId: string | null;
  }>(sql`
    SELECT id, kind, paid, consequence, minutes, leave_request_id, break_breach_id
    FROM attendance_overlay WHERE user_id = ${userId} AND work_date = ${date}
    ORDER BY kind
  `);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    paid: r.paid,
    consequence: r.consequence,
    minutes: r.minutes,
    sourceKind:
      r.breakBreachId !== null
        ? ('break-breach' as const)
        : r.kind === 'wfh'
          ? ('wfh' as const)
          : ('leave' as const),
    sourceId: (r.leaveRequestId ?? r.breakBreachId)!,
  }));
}

/**
 * Insert a fresh attendance_record for `date` under the caller's person lock
 * (§8.6 day-open). Fails if the row already exists — caller must have checked.
 */
export async function insertNewRecord(
  tx: Tx,
  r: {
    readonly organizationId: string;
    readonly userId: string;
    readonly workDate: DateOnly;
    readonly windowStart: Date;
    readonly windowEnd: Date;
    readonly closeDueAt: Date;
    readonly shift: ResolvedShift;
    readonly dayType: 'working' | 'week-off' | 'holiday' | 'not-employed';
    readonly placement: Placement;
  },
): Promise<string> {
  const row = await tx.one<{ id: string }>(sql`
    INSERT INTO attendance_record (
      organization_id, user_id, work_date, window_start, window_end, close_due_at,
      shift_snapshot, shift_source, placement_snapshot, day_type
    ) VALUES (
      ${r.organizationId}, ${r.userId}, ${r.workDate}, ${r.windowStart}, ${r.windowEnd}, ${r.closeDueAt},
      ${JSON.stringify(r.shift)}::jsonb, ${r.shift.source},
      ${JSON.stringify(r.placement)}::jsonb, ${r.dayType}
    )
    RETURNING id
  `);
  return row.id;
}

/**
 * One-shot outbox insert for `attendance.recalc-requested`, used when a
 * record is created (input_version = 1 already) and no bump is needed.
 * `bumpInputVersions` is the right tool when the version is going up.
 */
export async function writeRecalcRequested(
  tx: Tx,
  organizationId: string,
  payload: RecalcRequested,
): Promise<void> {
  await tx.query(sql`
    INSERT INTO domain_outbox (organization_id, event_name, payload)
    VALUES (${organizationId}, ${ATTENDANCE_EVENTS.RECALC_REQUESTED}, ${JSON.stringify(payload)}::jsonb)
  `);
}

/* ------------------------------------------------------------------ *
 * Overlays (§8.1, L8) — leave, WFH, break-breach consequences
 * ------------------------------------------------------------------ */

export interface OverlayRow {
  readonly sourceKind: 'leave' | 'wfh' | 'break-breach';
  readonly sourceId: string;
  readonly userId: string;
  readonly workDate: DateOnly;
  readonly kind:
    | 'leave-full'
    | 'leave-first-half'
    | 'leave-second-half'
    | 'wfh'
    | 'breach-consequence';
  readonly paid: boolean | null;
  readonly consequence:
    'mark-late' | 'mark-half-day' | 'mark-absent' | 'deduct-minutes' | null;
  readonly minutes: number | null;
}

/**
 * Insert an overlay row. Returns `true` if a new row landed, `false` if the
 * same source+date+kind already existed (idempotent for the caller).
 *
 * The source-kind maps to one of the provenance columns:
 *   'leave' | 'wfh' → leave_request_id
 *   'break-breach'  → break_breach_id
 * so external callers never see the split.
 */
export async function upsertOverlay(
  tx: Tx,
  organizationId: string,
  input: OverlayRow,
): Promise<boolean> {
  const leaveRequestId =
    input.sourceKind === 'leave' || input.sourceKind === 'wfh' ? input.sourceId : null;
  const breakBreachId = input.sourceKind === 'break-breach' ? input.sourceId : null;
  const rows = await tx.query<{ id: string }>(sql`
    INSERT INTO attendance_overlay (
      organization_id, user_id, work_date, kind, paid, consequence, minutes,
      leave_request_id, break_breach_id
    ) VALUES (
      ${organizationId}, ${input.userId}, ${input.workDate}, ${input.kind},
      ${input.paid}, ${input.consequence}, ${input.minutes},
      ${leaveRequestId}, ${breakBreachId}
    )
    ON CONFLICT DO NOTHING
    RETURNING id
  `);
  return rows.length === 1;
}

/** The organization of the caller's transaction (set by the DAL, TN-6). */
export async function currentOrganizationId(tx: Tx): Promise<string> {
  return (await tx.one<{ id: string }>(sql`SELECT current_organization_id() AS id`)).id;
}

/** Whose overlays came from this source, sorted: the lock order for removing them (D24). */
export async function overlayOwners(
  tx: Tx,
  sourceKind: 'leave' | 'wfh' | 'break-breach',
  sourceId: string,
): Promise<string[]> {
  const column =
    sourceKind === 'leave' || sourceKind === 'wfh'
      ? 'leave_request_id'
      : 'break_breach_id';
  const rows = await tx.query<{ userId: string }>(sql`
    SELECT DISTINCT user_id FROM attendance_overlay
    WHERE ${sql.raw(column)} = ${sourceId}
    ORDER BY user_id
  `);
  return rows.map((row) => row.userId);
}

export interface AffectedDay {
  readonly userId: string;
  readonly workDate: DateOnly;
}

/**
 * Delete every overlay whose source matches, returning the days that were
 * touched (unique per person+date). Caller bumps each record.
 */
export async function deleteOverlaysBySource(
  tx: Tx,
  sourceKind: 'leave' | 'wfh' | 'break-breach',
  sourceId: string,
): Promise<AffectedDay[]> {
  const column =
    sourceKind === 'leave' || sourceKind === 'wfh'
      ? 'leave_request_id'
      : 'break_breach_id';
  const rows = await tx.query<AffectedDay>(sql`
    DELETE FROM attendance_overlay
    WHERE ${sql.raw(column)} = ${sourceId}
    RETURNING user_id, work_date::text AS work_date
  `);
  // Dedupe by (userId, workDate) so multi-overlay days bump once.
  const seen = new Set<string>();
  const out: AffectedDay[] = [];
  for (const r of rows) {
    const key = `${r.userId}:${r.workDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/**
 * Delete one overlay for a specific source and date.
 * Returns true if a row was deleted (caller may skip version bump if false).
 */
export async function deleteOverlayBySourceAndDate(
  tx: Tx,
  sourceId: string,
  workDate: DateOnly,
): Promise<boolean> {
  const rows = await tx.query<{ workDate: string }>(sql`
    DELETE FROM attendance_overlay
    WHERE leave_request_id = ${sourceId} AND work_date = ${workDate}
    RETURNING work_date::text AS "workDate"
  `);
  return rows.length > 0;
}

/** Every record whose inputs changed gets a new input version and a recalculation request. */
export async function bumpInputVersions(
  tx: Tx,
  organizationId: string,
  userId: string,
  recordIds: ReadonlySet<string>,
): Promise<void> {
  if (recordIds.size === 0) return;
  const rows = await tx.query<{ id: string; workDate: string; inputVersion: number }>(sql`
    UPDATE attendance_record SET input_version = input_version + 1, input_changed_at = now()
    WHERE id = ANY(${[...recordIds]}::uuid[])
    RETURNING id, work_date::text AS work_date, input_version
  `);
  for (const row of rows) {
    const payload: RecalcRequested = {
      recordId: row.id,
      userId,
      workDate: row.workDate,
      inputVersion: row.inputVersion,
    };
    await tx.query(sql`
      INSERT INTO domain_outbox (organization_id, event_name, payload)
      VALUES (${organizationId}, ${ATTENDANCE_EVENTS.RECALC_REQUESTED}, ${JSON.stringify(payload)}::jsonb)
    `);
  }
}

/* ------------------------------------------------------------------ *
 * Review items (§12.2)
 * ------------------------------------------------------------------ */

export type ReviewItemKind =
  | 'assumed-departure' | 'auto-close-failed' | 'reconciled-from-auto-close'
  | 'overtime-on-assumed' | 'same-instant-conflict' | 'departure-without-arrival'
  | 'previous-session-unconfirmed' | 'worked-remotely-without-approval' | 'punched-on-leave'
  | 'holiday-worked' | 'activity-after-finish' | 'late-synced-punch'
  | 'outside-shift-window' | 'overlapping-shift-windows' | 'not-evaluated'
  | 'retime-changes-subject';

/** Opens an item. For event_id IS NOT NULL: idempotent (unique index prevents duplicate).
 *  For event_id IS NULL: opens a new item only when none is currently open. */
export async function upsertReviewItem(
  tx: Tx,
  organizationId: string,
  item: {
    userId: string;
    workDate: DateOnly;
    kind: ReviewItemKind;
    eventId?: string | null;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.query(sql`
    INSERT INTO attendance_review_item (organization_id, user_id, work_date, kind, event_id, detail)
    VALUES (${organizationId}, ${item.userId}, ${item.workDate}, ${item.kind},
            ${item.eventId ?? null}, ${JSON.stringify(item.detail ?? {})}::jsonb)
    ON CONFLICT DO NOTHING
  `);
}

/** Resolves an open item. Pass `resolvedBy` for human closures; omit for system closures. */
export async function resolveReviewItem(
  tx: Tx,
  organizationId: string,
  item: {
    userId: string;
    workDate: DateOnly;
    kind: ReviewItemKind;
    eventId?: string | null;
    resolvedBy?: string | null;
    correctionId?: string | null;
    note?: string | null;
  },
): Promise<void> {
  const source = item.resolvedBy != null ? 'human' : 'system';
  await tx.query(sql`
    UPDATE attendance_review_item
    SET resolved_at      = now(),
        resolved_by      = ${item.resolvedBy ?? null},
        resolution_source = ${source},
        resolution_note  = ${item.note ?? null},
        correction_id    = ${item.correctionId ?? null}
    WHERE organization_id = ${organizationId}
      AND user_id   = ${item.userId}
      AND work_date = ${item.workDate}
      AND kind      = ${item.kind}
      AND (event_id = ${item.eventId ?? null}
           OR (event_id IS NULL AND ${item.eventId ?? null} IS NULL))
      AND resolved_at IS NULL
  `);
}

/** The current (non-void, non-superseded) auto-out assigned to this record, if any. */
export async function findAutoOutForRecord(
  tx: Tx,
  recordId: string,
): Promise<{ id: string; occurredAt: Date } | null> {
  return tx.maybeOne<{ id: string; occurredAt: Date }>(sql`
    SELECT e.id, e.occurred_at AS "occurredAt"
    FROM   attendance_event e
    JOIN   attendance_event_assignment a
           ON  a.organization_id      = e.organization_id
           AND a.event_id             = e.id
    WHERE  a.attendance_record_id = ${recordId}
      AND  e.kind     = 'auto-out'
      AND  e.is_void  = false
      AND  NOT EXISTS (
             SELECT 1 FROM attendance_event v
             WHERE  v.organization_id      = e.organization_id
               AND  v.supersedes_event_id  = e.id
           )
    LIMIT 1
  `);
}

/** Effective events for one record, optionally excluding auto-outs. */
export async function effectiveEventsOfRecord(
  tx: Tx,
  recordId: string,
  options: { excludeAutoOut?: boolean } = {},
): Promise<NeighbourhoodEvent[]> {
  return tx.query<NeighbourhoodEvent>(sql`
    SELECT e.id, e.user_id AS "userId", e.kind, e.occurred_at AS "occurredAt",
           e.source, e.evidence, e.is_void AS "isVoid",
           a.attendance_record_id AS "recordId",
           a.attendance_record_id AS "assignedRecordId",
           r.work_date::text       AS "assignedDate",
           a.reason, a.pinned
    FROM   attendance_event e
    JOIN   attendance_event_assignment a
           ON  a.organization_id = e.organization_id AND a.event_id = e.id
    JOIN   attendance_record r
           ON  r.id = a.attendance_record_id
    WHERE  a.attendance_record_id = ${recordId}
      AND  e.is_void = false
      AND  NOT EXISTS (
             SELECT 1 FROM attendance_event v
             WHERE  v.organization_id = e.organization_id
               AND  v.supersedes_event_id = e.id
           )
      AND  (${options.excludeAutoOut !== true}::boolean OR e.kind <> 'auto-out')
    ORDER BY e.occurred_at, e.kind
  `);
}

/** Lock the derived day after the caller holds the person's advisory lock. */
export async function findRecordForClosure(
  tx: Tx,
  userId: string,
  workDate: DateOnly,
): Promise<{ id: string; state: 'open' | 'closed'; dayType: string;
  closeDueAt: Date; closedBy: string | null; inputVersion: number } | null> {
  return tx.maybeOne<{ id: string; state: 'open' | 'closed'; dayType: string;
    closeDueAt: Date; closedBy: string | null; inputVersion: number }>(sql`
    SELECT id, state, day_type AS "dayType", close_due_at AS "closeDueAt",
           closed_by AS "closedBy", input_version AS "inputVersion"
    FROM attendance_record
    WHERE user_id = ${userId} AND work_date = ${workDate}
    FOR UPDATE
  `);
}

/** A derived answer can change on a closed record. Write only real changes. */
export async function setRecordClosure(
  tx: Tx,
  recordId: string,
  answer: { state: 'open'; closedBy: null } |
    { state: 'closed'; closedBy: 'punch-out' | 'auto-close' | 'no-show' | 'correction' },
  now: Date,
): Promise<boolean> {
  const rows = await tx.query<{ id: string }>(sql`
    UPDATE attendance_record
    SET state = ${answer.state},
        closed_by = ${answer.closedBy},
        closed_at = CASE WHEN ${answer.state} = 'open' THEN NULL ELSE ${now}::timestamptz END
    WHERE id = ${recordId}
      AND (state, closed_by) IS DISTINCT FROM (${answer.state}::text, ${answer.closedBy}::text)
    RETURNING id
  `);
  return rows.length === 1;
}

/* ------------------------------------------------------------------ *
 * Corrections (§12.1)
 * ------------------------------------------------------------------ */

export interface CorrectionRow {
  readonly id: string;
  readonly userId: string;
  readonly workDate: DateOnly;
  readonly kind: 'add-event' | 'replace-event' | 'void-event' | 'confirm-as-is';
  readonly payload: unknown;
  readonly reason: string;
  readonly batchId: string | null;
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly requestedBy: string;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
  readonly decisionNote: string | null;
}

export async function insertCorrection(
  tx: Tx,
  c: {
    organizationId: string;
    userId: string;
    workDate: DateOnly;
    kind: CorrectionRow['kind'];
    payload: unknown;
    reason: string;
    batchId?: string | null;
    requestedBy: string;
  },
): Promise<string> {
  const row = await tx.one<{ id: string }>(sql`
    INSERT INTO attendance_correction
      (organization_id, user_id, work_date, kind, payload, reason, batch_id, requested_by)
    VALUES
      (${c.organizationId}, ${c.userId}, ${c.workDate}, ${c.kind},
       ${JSON.stringify(c.payload)}::jsonb, ${c.reason}, ${c.batchId ?? null}, ${c.requestedBy})
    RETURNING id
  `);
  return row.id;
}

export async function findCorrectionById(
  tx: Tx,
  id: string,
): Promise<CorrectionRow | null> {
  return tx.maybeOne<CorrectionRow>(sql`
    SELECT id, user_id AS "userId", work_date::text AS "workDate", kind, payload, reason,
           batch_id AS "batchId", status, requested_by AS "requestedBy",
           decided_by AS "decidedBy", decided_at AS "decidedAt",
           decision_note AS "decisionNote"
    FROM attendance_correction
    WHERE id = ${id}
  `);
}

export async function findCorrectionForUpdate(
  tx: Tx,
  id: string,
): Promise<CorrectionRow | null> {
  return tx.maybeOne<CorrectionRow>(sql`
    SELECT id, user_id AS "userId", work_date::text AS "workDate", kind, payload, reason,
           batch_id AS "batchId", status, requested_by AS "requestedBy",
           decided_by AS "decidedBy", decided_at AS "decidedAt",
           decision_note AS "decisionNote"
    FROM attendance_correction
    WHERE id = ${id}
    FOR UPDATE
  `);
}

export async function updateCorrectionStatus(
  tx: Tx,
  id: string,
  update: { status: 'approved' | 'rejected'; decidedBy: string; decidedAt: Date; decisionNote?: string | null },
): Promise<void> {
  await tx.query(sql`
    UPDATE attendance_correction
    SET status       = ${update.status},
        decided_by   = ${update.decidedBy},
        decided_at   = ${update.decidedAt},
        decision_note = ${update.decisionNote ?? null}
    WHERE id = ${id}
  `);
}

/** Returns the effective event AND its assigned workDate; null if not effective. */
export async function findEffectiveEvent(
  tx: Tx,
  userId: string,
  eventId: string,
): Promise<{ id: string; kind: EventKind; occurredAt: Date; source: EventSource;
  evidence: Evidence; recordId: string | null; workDate: DateOnly | null } | null> {
  return tx.maybeOne<{ id: string; kind: EventKind; occurredAt: Date; source: EventSource;
    evidence: Evidence; recordId: string | null; workDate: DateOnly | null }>(sql`
    SELECT e.id, e.kind, e.occurred_at AS "occurredAt", e.source, e.evidence,
           a.attendance_record_id AS "recordId",
           r.work_date::text       AS "workDate"
    FROM   attendance_event e
    LEFT JOIN attendance_event_assignment a
              ON  a.organization_id = e.organization_id AND a.event_id = e.id
    LEFT JOIN attendance_record r
              ON  r.id = a.attendance_record_id
    WHERE  e.id = ${eventId} AND e.user_id = ${userId}
      AND  e.is_void = false
      AND  NOT EXISTS (
             SELECT 1 FROM attendance_event v
             WHERE  v.organization_id = e.organization_id
               AND  v.supersedes_event_id = e.id
           )
  `);
}

/** Loads a user's dept/team for authorization scope checks (mirrors shifts pattern). */
export async function findCorrectionSubject(
  tx: Tx,
  userId: string,
): Promise<{ id: string; organizationId: string; departmentId: string | null; teamId: string | null } | null> {
  return tx.maybeOne<{ id: string; organizationId: string;
    departmentId: string | null; teamId: string | null }>(sql`
    SELECT id, organization_id AS "organizationId",
           department_id AS "departmentId", team_id AS "teamId"
    FROM app_user
    WHERE id = ${userId} AND account_type = 'employee'
  `);
}
