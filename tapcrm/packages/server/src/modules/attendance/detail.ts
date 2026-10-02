import type { AttendanceEventInput, DateOnly } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { effectiveEventsForRecord } from './calculation-repository.js';
import * as repo from './repository.js';

/**
 * AT-12 day detail. Composes the record + effective events + superseded events
 * + overlays + shift source + calendar type — ALL from stored data on
 * `attendance_record`.
 *
 * Deliberately does NOT call `shifts.resolve` or `calendar.dayType` live. A
 * historical day's shift and day-type are captured on the record when it was
 * built (§8.1 `shift_snapshot`, `day_type`, `placement_snapshot`); re-resolving
 * them would show a different shift after a transfer, disagreeing with the
 * status the calculator produced. Read the snapshot, not the resolver.
 *
 * Corrections come with step 7 (§12); the detail returns an empty array here
 * and gains a real reader once that lands.
 */

export interface AttendanceDayDetail {
  readonly date: DateOnly;
  readonly userId: string;
  readonly record: {
    readonly id: string;
    readonly state: 'open' | 'closed';
    readonly status: string | null;
    readonly dayType: string;
    readonly shift: unknown; // shift_snapshot JSON
    readonly shiftSource: string;
    readonly placement: {
      readonly departmentId: string | null;
      readonly teamId: string | null;
      readonly positionId: string | null;
    };
    readonly window: {
      readonly start: string;
      readonly end: string;
      readonly closeDueAt: string;
    };
    readonly minutes: {
      readonly worked: number;
      readonly break: number;
      readonly late: number;
      readonly earlyExit: number;
      readonly overtime: number;
      readonly night: number;
    };
    readonly units: {
      readonly present: number;
      readonly paidLeave: number; // a half-day count, not money (CI-21)
      readonly unpaidLeave: number;
      readonly absent: number;
      readonly holiday: number;
    };
    readonly arrivalAt: string | null;
    readonly departureAt: string | null;
    readonly isWfh: boolean;
    readonly flags: string[];
    readonly attributionFlags: string[];
    readonly inputVersion: number;
    readonly calculationVersion: number;
    readonly rulesVersion: string;
    readonly calculatedAt: string | null;
    readonly closedAt: string | null;
    readonly closedBy: string | null;
  };
  readonly events: {
    readonly effective: unknown[];
    readonly superseded: unknown[];
  };
  readonly overlays: unknown[];
  readonly corrections: unknown[]; // step 7 fills this
}

/**
 * Slim snapshot for the live-status projector (§9.3 refresh path). Returns
 * the record's stored shape (window, shift snapshot, day_type, overlays)
 * plus the day's effective events — exactly what `deriveRow` needs.
 * Returns `null` when the day has no record yet.
 *
 * Uses stored snapshots ONLY. The projector never re-resolves shifts or
 * calendar live; today's row must describe the same day the calculator
 * computed against.
 */
export interface DaySnapshot {
  readonly userId: string;
  readonly date: DateOnly;
  readonly record: repo.RecordDetailRow;
  readonly events: AttendanceEventInput[];
  readonly overlays: repo.OverlayForDayRow[];
}

/**
 * Active users who have an `attendance_record` for `today` (§9.3, plan
 * Task 5 Pass A). Live-status computes the "missing from user_status"
 * subset itself so this side only touches `attendance_record` — SH-1 /
 * MB-4 (attendance owns its tables, live-status owns `user_status`).
 */
export async function listActiveUsersWithRecordFor(
  tx: Tx,
  today: DateOnly,
  limit: number,
): Promise<string[]> {
  const rows = await tx.query<{ id: string }>(sql`
    SELECT u.id FROM app_user u
    JOIN attendance_record r
      ON r.organization_id = u.organization_id AND r.user_id = u.id
     AND r.work_date = ${today}
    WHERE u.status = 'active'
    ORDER BY u.id LIMIT ${limit}
  `);
  return rows.map((r) => r.id);
}

export async function loadDaySnapshot(
  tx: Tx,
  userId: string,
  date: DateOnly,
): Promise<DaySnapshot | null> {
  const record = await repo.findRecordFull(tx, userId, date);
  if (record === null) return null;
  const [events, overlays] = await Promise.all([
    effectiveEventsForRecord(tx, record.id),
    repo.overlaysForDay(tx, userId, date),
  ]);
  return { userId, date, record, events, overlays };
}

export async function loadDayDetail(
  ctx: RequestContext,
  userId: string,
  date: DateOnly,
): Promise<AttendanceDayDetail | null> {
  return db.transaction(ctx, async (tx) => {
    const record = await repo.findRecordFull(tx, userId, date);
    if (record === null) return null;

    // The day's effective events are exactly the ones the calculator read (D28).
    const [effective, superseded, overlays] = await Promise.all([
      effectiveEventsForRecord(tx, record.id),
      repo.supersededEventsOf(tx, userId, date),
      repo.overlaysForDay(tx, userId, date),
    ]);

    return {
      date,
      userId,
      record: {
        id: record.id,
        state: record.state,
        status: record.status,
        dayType: record.dayType,
        shift: record.shiftSnapshot, // stored snapshot, NOT live resolve
        shiftSource: record.shiftSource,
        placement: record.placementSnapshot, // stored placement, NOT live directory
        window: {
          start: record.windowStart,
          end: record.windowEnd,
          closeDueAt: record.closeDueAt,
        },
        minutes: {
          worked: record.workedMinutes,
          break: record.breakMinutes,
          late: record.lateMinutes,
          earlyExit: record.earlyExitMinutes,
          overtime: record.overtimeMinutes,
          night: record.nightMinutes,
        },
        units: {
          present: record.presentUnits,
          paidLeave: record.paidLeaveUnits,
          unpaidLeave: record.unpaidLeaveUnits,
          absent: record.absentUnits,
          holiday: record.holidayUnits,
        },
        arrivalAt: record.arrivalAt,
        departureAt: record.departureAt,
        isWfh: record.isWfh,
        flags: record.flags,
        attributionFlags: record.attributionFlags,
        inputVersion: record.inputVersion,
        calculationVersion: record.calculationVersion,
        rulesVersion: record.rulesVersion,
        calculatedAt: record.calculatedAt,
        closedAt: record.closedAt,
        closedBy: record.closedBy,
      },
      events: { effective, superseded },
      overlays,
      corrections: [], // step 7 fills this
    };
  });
}
