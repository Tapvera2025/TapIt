import type { DateOnly, PresenceState } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { systemClock } from '../../platform/time.js';
import { organizationToday } from '../../platform/organization-time.js';
import * as AttendanceFacade from '../attendance/facade.js';
import * as LiveStatusFacade from '../live-status/facade.js';
import * as ShiftsFacade from '../shifts/facade.js';
import { IdentityNotFoundError } from '../identity/facade.js';
import { findEmployeeProfile } from './repository.js';

export type EmployeeWorkStatus =
  | 'Working'
  | 'Late'
  | 'On Break'
  | 'Not Checked In'
  | 'Leave'
  | 'Finished';

export interface Employee360WorkSummary {
  readonly employee: {
    readonly id: string;
    readonly fullName: string;
    readonly department: string | null;
    readonly departmentId: string | null;
    readonly team: string | null;
    readonly teamId: string | null;
    readonly designation: string | null;
    readonly designationId: string | null;
  };
  readonly work: {
    readonly status: EmployeeWorkStatus;
    readonly presenceState: PresenceState;
    readonly displayGroup: LiveStatusFacade.LiveBoardGroup;
    readonly punchIn: string | null;
    readonly punchOut: string | null;
    readonly workMinutes: number;
    readonly workTime: number;
    readonly breakMinutes: number;
    readonly breakTime: number;
    readonly isOnLeave: boolean;
    readonly isOverdue: boolean;
    readonly updatedAt: string | null;
  };
  readonly status: EmployeeWorkStatus;
  readonly punchIn: string | null;
  readonly punchOut: string | null;
  readonly workTime: number;
  readonly breakTime: number;
}

/**
 * Employee 360 Work / Live Status query (§9 Phase 1 Backend).
 *
 * Composes existing authoritative sources without duplicating attendance calculations:
 * 1. Employee profile from `app_user` (+ placement joins)
 * 2. Live status projection from `user_status`
 * 3. Attendance day snapshot from `attendance_record`
 * 4. Shift & leave overlays from existing shift resolvers
 *
 * Status derivation:
 * - `dayGroup = leave` -> 'Leave'
 * - `state = ON_BREAK` -> 'On Break'
 * - `state = WORKING` -> arrived after shiftStart + grace ? 'Late' : 'Working'
 * - `state = FINISHED` -> 'Finished'
 * - `state = NOT_IN` -> 'Not Checked In' (with `isOverdue` indicating whether past shiftStart + grace)
 */
export async function getEmployeeWorkStatus(
  ctx: RequestContext,
  userId: string,
  now: Date = systemClock.now(),
): Promise<Employee360WorkSummary> {
  return db.transaction(ctx, async (tx) => {
    return loadEmployeeWorkStatusInTx(tx, ctx.organizationId, userId, now);
  });
}

export async function loadEmployeeWorkStatusInTx(
  tx: Tx,
  organizationId: string,
  userId: string,
  now: Date,
): Promise<Employee360WorkSummary> {
  const profile = await findEmployeeProfile(tx, organizationId, userId);
  if (profile === null) {
    throw new IdentityNotFoundError('IDENTITY_NOT_FOUND', 'Employee not found');
  }

  // Determine today's work date for the person
  const currentDay = await AttendanceFacade.currentDayFor(tx, userId, now);
  const todayDate: DateOnly = currentDay ?? (await organizationToday(tx));

  // Authoritative projection row from user_status
  const userStatus = await LiveStatusFacade.readRow(tx, userId);

  // Authoritative stored attendance day detail (if built)
  const daySnapshot = await AttendanceFacade.loadDaySnapshot(tx, userId, todayDate);
  const record = daySnapshot?.record ?? null;

  // Resolve shift details if not already projected on user_status
  let shiftStartAt = userStatus?.shiftStartAt ?? null;
  let graceMinutes = userStatus?.graceMinutes ?? null;

  if (userStatus === null || shiftStartAt === null) {
    try {
      const todayWindow = await ShiftsFacade.dayWindowContaining(tx, userId, now);
      const shift = await ShiftsFacade.resolve(tx, userId, todayWindow.date);
      if (shift.kind === 'fixed') {
        shiftStartAt = todayWindow.shape.start;
        graceMinutes = shift.graceMinutes;
      }
    } catch {
      // No assigned shift or geometry resolution unassigned
    }
  }

  // Presence state: user_status projection is authoritative; fallback to attendance_record or NOT_IN
  const presenceState: PresenceState =
    userStatus?.state ??
    (record?.state === 'closed'
      ? 'FINISHED'
      : record?.arrivalAt
        ? 'WORKING'
        : 'NOT_IN');

  const isOnLeave = userStatus?.dayGroup === 'leave' || record?.dayType === 'leave';
  const isHoliday = userStatus?.dayGroup === 'holiday' || record?.dayType === 'holiday';

  // Authoritative minutes
  const workMinutes = userStatus?.workedMinutes ?? record?.workedMinutes ?? 0;
  const breakMinutes = userStatus?.breakMinutes ?? record?.breakMinutes ?? 0;

  // Authoritative punches from attendance_record
  let punchIn: string | null = null;
  let punchOut: string | null = null;

  if (record?.arrivalAt) {
    punchIn = new Date(record.arrivalAt).toISOString();
  } else if (presenceState !== 'NOT_IN' && userStatus?.since && !isOnLeave) {
    punchIn = userStatus.since.toISOString();
  }

  if (presenceState === 'FINISHED' && record?.departureAt) {
    punchOut = new Date(record.departureAt).toISOString();
  }

  // Determine lateness based on arrival vs shift start + grace
  let isLate = false;
  if (record?.lateMinutes != null && record.lateMinutes > 0) {
    isLate = true;
  } else if (record?.flags && record.flags.includes('late')) {
    isLate = true;
  } else if (punchIn !== null && shiftStartAt !== null) {
    const arrivalMs = new Date(punchIn).getTime();
    const shiftDueMs = new Date(shiftStartAt).getTime() + (graceMinutes ?? 0) * 60_000;
    if (arrivalMs > shiftDueMs) {
      isLate = true;
    }
  }

  // Determine overdue condition for NOT_IN
  let isOverdue = false;
  if (presenceState === 'NOT_IN' && !isOnLeave && !isHoliday && shiftStartAt !== null) {
    const shiftDueMs = new Date(shiftStartAt).getTime() + (graceMinutes ?? 0) * 60_000;
    if (now.getTime() >= shiftDueMs) {
      isOverdue = true;
    }
  }

  // Derived display status
  let status: EmployeeWorkStatus;
  if (isOnLeave) {
    status = 'Leave';
  } else if (presenceState === 'ON_BREAK') {
    status = 'On Break';
  } else if (presenceState === 'WORKING') {
    status = isLate ? 'Late' : 'Working';
  } else if (presenceState === 'FINISHED') {
    status = 'Finished';
  } else {
    // NOT_IN
    status = 'Not Checked In';
  }

  // Live board group classification
  const displayGroup: LiveStatusFacade.LiveBoardGroup = userStatus
    ? LiveStatusFacade.liveBoardGroup(userStatus, now)
    : isOnLeave
      ? 'onLeave'
      : isHoliday
        ? 'onHoliday'
        : isOverdue
          ? 'notInDue'
          : 'notInNotYetDue';

  const updatedAt = userStatus?.updatedAt
    ? userStatus.updatedAt.toISOString()
    : (record?.calculatedAt ?? null);

  return {
    employee: {
      id: profile.id,
      fullName: profile.fullName,
      department: profile.departmentName ?? null,
      departmentId: profile.departmentId ?? null,
      team: profile.teamName ?? null,
      teamId: profile.teamId ?? null,
      designation: profile.designationName ?? null,
      designationId: profile.designationId ?? null,
    },
    work: {
      status,
      presenceState,
      displayGroup,
      punchIn,
      punchOut,
      workMinutes,
      workTime: workMinutes,
      breakMinutes,
      breakTime: breakMinutes,
      isOnLeave,
      isOverdue,
      updatedAt,
    },
    status,
    punchIn,
    punchOut,
    workTime: workMinutes,
    breakTime: breakMinutes,
  };
}
