import type {
  AttendanceEventInput,
  DateOnly,
  LocalTime,
  ResolvedShift,
} from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { CalculatedAttendance, Overlay } from './calculate.js';
import { RULES_VERSION } from './calculate.js';

/** SQL for recalculation (design §8.5): the day's inputs, its stored answer, the month summary. */

export async function recordOwner(
  tx: Tx,
  recordId: string,
): Promise<{ userId: string } | null> {
  return tx.maybeOne<{ userId: string }>(
    sql`SELECT user_id FROM attendance_record WHERE id = ${recordId}`,
  );
}

export interface RecordForCalculation {
  id: string;
  userId: string;
  organizationId: string;            // needed by break policy resolver
  workDate: DateOnly;
  state: 'open' | 'closed';
  shiftSnapshot: ResolvedShift;
  placementSnapshot: unknown;        // jsonb, used by break policy resolver
  closeDueAt: Date;
  dayType: 'working' | 'week-off' | 'holiday' | 'not-employed';
  attributionFlags: string[];
  inputVersion: number;
  calculatedInputVersion: number;
}

export async function lockRecordForCalculation(
  tx: Tx,
  recordId: string,
): Promise<RecordForCalculation> {
  return tx.one<RecordForCalculation>(sql`
    SELECT id, user_id, organization_id, work_date::text AS work_date, state,
           shift_snapshot, placement_snapshot, close_due_at, day_type,
           attribution_flags, input_version, calculated_input_version
    FROM attendance_record WHERE id = ${recordId}
    FOR UPDATE
  `);
}

/** D28 — the record's effective events: assigned to it, not void, not superseded. */
export async function effectiveEventsForRecord(
  tx: Tx,
  recordId: string,
): Promise<AttendanceEventInput[]> {
  const rows = await tx.query<{
    id: string;
    kind: AttendanceEventInput['kind'];
    occurredAt: Date;
    source: AttendanceEventInput['source'];
    evidence: AttendanceEventInput['evidence'];
    reason: AttendanceEventInput['assignmentReason'];
  }>(sql`
    SELECT e.id, e.kind, e.occurred_at, e.source, e.evidence, a.reason
    FROM attendance_event_assignment a
    JOIN attendance_event e ON e.organization_id = a.organization_id AND e.id = a.event_id
    WHERE a.attendance_record_id = ${recordId}
      AND NOT e.is_void
      AND NOT EXISTS (SELECT 1 FROM attendance_event s
                      WHERE s.organization_id = e.organization_id AND s.supersedes_event_id = e.id)
    ORDER BY e.occurred_at, e.id
  `);
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    at: row.occurredAt.toISOString(),
    source: row.source,
    evidence: row.evidence,
    assignmentReason: row.reason,
  }));
}

export async function overlaysFor(
  tx: Tx,
  userId: string,
  date: DateOnly,
): Promise<Overlay[]> {
  const rows = await tx.query<{
    kind: Overlay['kind'];
    paid: boolean | null;
    consequence: Overlay['consequence'];
    minutes: number | null;
    leaveRequestId: string | null;
    breakBreachId: string | null;
  }>(sql`
    SELECT kind, paid, consequence, minutes, leave_request_id, break_breach_id
    FROM attendance_overlay WHERE user_id = ${userId} AND work_date = ${date}
    ORDER BY kind, created_at
  `);
  return rows.map((row) => ({
    kind: row.kind,
    paid: row.paid,
    consequence: row.consequence,
    minutes: row.minutes,
    sourceId: row.leaveRequestId ?? row.breakBreachId ?? '',
  }));
}

/** The night window in force on the date (D35), or null. */
export async function nightWindowOn(
  tx: Tx,
  date: DateOnly,
): Promise<{ from: LocalTime; to: LocalTime } | null> {
  const row = await tx.maybeOne<{ from: LocalTime | null; to: LocalTime | null }>(sql`
    SELECT to_char(night_window_from, 'HH24:MI') AS from, to_char(night_window_to, 'HH24:MI') AS to
    FROM attendance_setting WHERE effective_from <= ${date}
    ORDER BY effective_from DESC LIMIT 1
  `);
  return row?.from != null && row.to != null ? { from: row.from, to: row.to } : null;
}

/** Stores the answer for the input version it was computed from (AT-I3). */
export async function writeCalculation(
  tx: Tx,
  recordId: string,
  inputVersion: number,
  result: CalculatedAttendance,
  breakPolicySnapshot: unknown | null = null,
): Promise<void> {
  const snapshotJson =
    breakPolicySnapshot !== null && breakPolicySnapshot !== undefined
      ? JSON.stringify(breakPolicySnapshot)
      : null;
  await tx.query(sql`
    UPDATE attendance_record SET
      status = ${result.status},
      present_units = ${result.units.present},
      paid_leave_units = ${result.units.paidLeave},
      unpaid_leave_units = ${result.units.unpaidLeave},
      absent_units = ${result.units.absent},
      holiday_units = ${result.units.holiday},
      worked_minutes = ${result.workedMinutes},
      break_minutes = ${result.breakMinutes},
      late_minutes = ${result.lateMinutes},
      early_exit_minutes = ${result.earlyExitMinutes},
      overtime_minutes = ${result.overtimeMinutes},
      night_minutes = ${result.nightMinutes},
      arrival_at = ${result.arrivalAt}::timestamptz,
      departure_at = ${result.departureAt}::timestamptz,
      is_wfh = ${result.isWfh},
      flags = ${[...result.flags]}::text[],
      provenance = ${JSON.stringify(result.provenance)}::jsonb,
      rules_version = ${RULES_VERSION},
      calculated_input_version = ${inputVersion},
      calculation_version = calculation_version + 1,
      calculated_at = now(),
      break_policy_snapshot = ${snapshotJson}::jsonb
    WHERE id = ${recordId}
  `);
}

/** Rebuilds the person's month from its records — derived, so always rebuildable (§8.1). */
export async function refreshMonthSummary(
  tx: Tx,
  userId: string,
  date: DateOnly,
): Promise<void> {
  await tx.query(sql`
    INSERT INTO attendance_month_summary (
      organization_id, user_id, month, days, present_units, paid_leave_units, unpaid_leave_units,
      absent_units, holiday_units, worked_minutes, late_days, late_minutes, overtime_minutes,
      night_minutes, wfh_days, open_days, not_evaluated_days, stale_days, updated_at
    )
    SELECT organization_id, user_id, date_trunc('month', work_date)::date, count(*),
           sum(present_units), sum(paid_leave_units), sum(unpaid_leave_units), sum(absent_units),
           sum(holiday_units), sum(worked_minutes), count(*) FILTER (WHERE late_minutes > 0),
           sum(late_minutes), sum(overtime_minutes), sum(night_minutes), count(*) FILTER (WHERE is_wfh),
           count(*) FILTER (WHERE state = 'open'), count(*) FILTER (WHERE status = 'not-evaluated'),
           count(*) FILTER (WHERE calculated_input_version < input_version), now()
    FROM attendance_record
    WHERE user_id = ${userId}
      AND work_date >= date_trunc('month', ${date}::date)
      AND work_date < date_trunc('month', ${date}::date) + interval '1 month'
    GROUP BY organization_id, user_id, date_trunc('month', work_date)
    ON CONFLICT (organization_id, user_id, month) DO UPDATE SET
      days = EXCLUDED.days, present_units = EXCLUDED.present_units, paid_leave_units = EXCLUDED.paid_leave_units,
      unpaid_leave_units = EXCLUDED.unpaid_leave_units, absent_units = EXCLUDED.absent_units,
      holiday_units = EXCLUDED.holiday_units, worked_minutes = EXCLUDED.worked_minutes,
      late_days = EXCLUDED.late_days, late_minutes = EXCLUDED.late_minutes,
      overtime_minutes = EXCLUDED.overtime_minutes, night_minutes = EXCLUDED.night_minutes,
      wfh_days = EXCLUDED.wfh_days, open_days = EXCLUDED.open_days,
      not_evaluated_days = EXCLUDED.not_evaluated_days, stale_days = EXCLUDED.stale_days,
      updated_at = EXCLUDED.updated_at
  `);
}

/**
 * Days whose answer is older than their inputs, and have been for longer than
 * the normal path takes (§8.5), one page at a time in id order.
 */
export async function staleRecords(
  tx: Tx,
  changedBefore: Date,
  after: string | null,
  limit: number,
): Promise<{ id: string; inputVersion: number }[]> {
  return tx.query<{ id: string; inputVersion: number }>(sql`
    SELECT id, input_version FROM attendance_record
    WHERE calculated_input_version < input_version
      AND input_changed_at < ${changedBefore}
      AND (${after}::uuid IS NULL OR id > ${after}::uuid)
    ORDER BY id
    LIMIT ${limit}
  `);
}

/** §8.5: after the third generation fails, the day says so until a later input succeeds. */
export async function flagRecalculationFailed(tx: Tx, recordId: string): Promise<void> {
  await tx.query(sql`
    UPDATE attendance_record SET flags = array_append(flags, 'recalculation-failed')
    WHERE id = ${recordId} AND NOT ('recalculation-failed' = ANY(flags))
  `);
}

/** The person's existing days from `from` to `to` (inclusive; null for no end). */
export async function recordDates(
  tx: Tx,
  userId: string,
  from: DateOnly,
  to: DateOnly | null,
): Promise<DateOnly[]> {
  const rows = await tx.query<{ workDate: DateOnly }>(sql`
    SELECT work_date::text AS work_date FROM attendance_record
    WHERE user_id = ${userId} AND work_date >= ${from} AND (${to}::date IS NULL OR work_date <= ${to}::date)
    ORDER BY work_date
  `);
  return rows.map((row) => row.workDate);
}

/**
 * Who has a day between `from` and `to` that a change could reach: by the
 * department or shift the day was built with (§8.1 "Why a placement
 * snapshot"), which is also what the day is re-resolved with. With neither
 * filter, everyone.
 */
export async function peopleWithDays(
  tx: Tx,
  filter: {
    readonly departmentIds?: readonly string[];
    readonly shiftIds?: readonly string[];
  },
  from: DateOnly,
  to: DateOnly | null,
): Promise<string[]> {
  const departments = [...(filter.departmentIds ?? [])];
  const shifts = [...(filter.shiftIds ?? [])];
  const everyone = departments.length === 0 && shifts.length === 0;
  const rows = await tx.query<{ userId: string }>(sql`
    SELECT DISTINCT r.user_id FROM attendance_record r
    WHERE r.work_date >= ${from} AND (${to}::date IS NULL OR r.work_date <= ${to}::date)
      AND (${everyone}
           OR r.placement_snapshot->>'departmentId' = ANY(${departments}::text[])
           OR r.shift_snapshot->>'shiftId' = ANY(${shifts}::text[]))
    ORDER BY r.user_id
  `);
  return rows.map((row) => row.userId);
}

/* ------------------------------------------------------------------ *
 * Refresh requests — one person's share of a shift or holiday change
 * ------------------------------------------------------------------ */

export interface RefreshRequest {
  id: string;
  userId: string;
  fromDate: DateOnly;
  toDate: DateOnly | null;
  replays: number;
  completedAt: Date | null;
  failedAt: Date | null;
}

const REFRESH_COLUMNS = sql`
  id, user_id, from_date::text AS from_date, to_date::text AS to_date, replays, completed_at, failed_at
`;

/** One request per person for the change `eventId`. A second delivery adds nothing. */
export async function recordRefreshRequests(
  tx: Tx,
  organizationId: string,
  eventId: string,
  userIds: readonly string[],
  from: DateOnly,
  to: DateOnly | null,
): Promise<void> {
  if (userIds.length === 0) return;
  await tx.query(sql`
    INSERT INTO attendance_refresh_request (organization_id, user_id, source_event_id, from_date, to_date)
    SELECT ${organizationId}, person, ${eventId}, ${from}, ${to}::date
    FROM unnest(${[...userIds]}::uuid[]) AS person
    ON CONFLICT (organization_id, source_event_id, user_id) DO NOTHING
  `);
}

/** The change's requests that are neither completed nor failed. */
export async function openRefreshRequestsFor(
  tx: Tx,
  eventId: string,
): Promise<RefreshRequest[]> {
  return tx.query<RefreshRequest>(sql`
    SELECT ${REFRESH_COLUMNS} FROM attendance_refresh_request
    WHERE source_event_id = ${eventId} AND completed_at IS NULL AND failed_at IS NULL
    ORDER BY id
  `);
}

export async function refreshRequest(tx: Tx, id: string): Promise<RefreshRequest | null> {
  return tx.maybeOne<RefreshRequest>(sql`
    SELECT ${REFRESH_COLUMNS} FROM attendance_refresh_request WHERE id = ${id}
  `);
}

export async function completeRefreshRequest(tx: Tx, id: string): Promise<void> {
  await tx.query(sql`
    UPDATE attendance_refresh_request SET completed_at = now()
    WHERE id = ${id} AND completed_at IS NULL AND failed_at IS NULL
  `);
}

/** §5.4: after the third generation fails, the request waits for a person. */
export async function failRefreshRequest(tx: Tx, id: string): Promise<void> {
  await tx.query(sql`
    UPDATE attendance_refresh_request SET failed_at = now()
    WHERE id = ${id} AND completed_at IS NULL AND failed_at IS NULL
  `);
}

/** Requests still open that were written before `requestedBefore`, one page at a time in id order. */
export async function staleRefreshRequests(
  tx: Tx,
  requestedBefore: Date,
  after: string | null,
  limit: number,
): Promise<RefreshRequest[]> {
  return tx.query<RefreshRequest>(sql`
    SELECT ${REFRESH_COLUMNS} FROM attendance_refresh_request
    WHERE completed_at IS NULL AND failed_at IS NULL
      AND requested_at < ${requestedBefore}
      AND (${after}::uuid IS NULL OR id > ${after}::uuid)
    ORDER BY id
    LIMIT ${limit}
  `);
}
