/**
 * People — shared types for shifts, holidays, attendance, live status,
 * biometric, leave, breaks and payroll (attendance design §5.3).
 *
 * Types only. Step 0 added the date types; step 1 the shift types; step 2 the
 * calendar types; step 3 the event types. The presence state machine that
 * reads events lives beside this file, in presence.ts.
 */

/** A calendar day in the organization's timezone, 'YYYY-MM-DD' (T-1). */
export type DateOnly = string & { readonly __brand: 'DateOnly' };

/** A wall-clock time of day, 'HH:mm' (T-3). */
export type LocalTime = string & { readonly __brand: 'LocalTime' };

/** A day's credit in half-day units; a day always sums to 2 (D7). */
export type HalfDays = 0 | 1 | 2;

/** The SH-1 resolution chain, highest precedence first (design §6.2). */
export type ShiftSource =
  | 'date-override'
  | 'permanent-flexible'
  | 'flexible-request'
  | 'rotation'
  | 'template'
  | 'department-default'
  | 'none';

/** Which shift applied to a person on a date, and why (§5.3, §6.2). */
export interface ResolvedShift {
  date: DateOnly;
  source: ShiftSource;
  shiftId: string | null;
  versionId: string | null;
  kind: 'fixed' | 'flexible' | 'none';
  start: LocalTime | null; // fixed only
  end: LocalTime | null;
  isOvernight: boolean; // end is on the next calendar day
  graceMinutes: number; // AT-4
  earlyExitGraceMinutes: number;
  fullDayMinutes: number | null; // fixed: shift version; flexible: 480 (SH-4)
  halfDayMinutes: number | null; // fixed: shift version; flexible: 300 (SH-4)
  complementaryHalfMinutes: number | null; // §8.3; null: halfDayMinutes ÷ 2
  minOvertimeMinutes: number | null; // AT-5
  earlyWindowMinutes: number; // how early an arrival may come (§5.2)
  /** The version's own, else shift_setting's (Q3); null until HR sets one. */
  maxClosingExtensionMinutes: number | null;
  timezone: string; // IANA, from the organization
}

/** What kind of day this is for one person (design §7). */
export type DayType = 'working' | 'week-off' | 'holiday';

/** The holiday sub-kind — matters for leave counting and pay (HO-1, LV-3). */
export type HolidaySubtype = 'national' | 'regional' | 'optional' | 'week-off';

/** The calendar's answer for a person and a date (§7, §5.3). */
export interface ResolvedDay {
  date: DateOnly;
  type: DayType;
  /** Set when `type` is 'holiday' or 'week-off'. */
  holidayId: string | null;
  holidayName: string | null;
  subtype: HolidaySubtype | null;
  /**
   * The scope that matched — 'national' when the holiday has no
   * `holiday_scope`; 'department' or 'shift' when it does. `null` on a
   * working day. `type` already distinguishes a week-off from a holiday, so
   * `matchedBy` describes only the axis, not the kind.
   */
  matchedBy: 'national' | 'department' | 'shift' | null;
}

/* ------------------------------------------------------------------ *
 * Attendance events (design §5.3, §8.1) — step 3
 * ------------------------------------------------------------------ */

export type EventKind = 'in' | 'out' | 'break-start' | 'break-end' | 'scan' | 'auto-out';
export type EventSource =
  'device' | 'web' | 'mobile' | 'correction' | 'system' | 'import';

/** Stamped when an event is recorded, never re-derived (D29). */
export type Evidence = 'confirmed' | 'assumed';

/** Why a day owns an event (§8.1). */
export type AssignmentReason =
  | 'midpoint'
  | 'closing-extension'
  | 'opening-pull-forward'
  | 'next-shift-started' // the next shift had started, or started with this event (§5.2)
  | 'system-close' // a closing auto-out (§12.3)
  | 'reconciliation' // a void row retiring an auto-out or a displaced duplicate (§12.4, §10.3)
  | 'correction'
  | 'import';

/** Pinned assignments are never moved by automatic re-attribution (§8.1). */
export const PINNED_REASONS: readonly AssignmentReason[] = [
  'correction',
  'system-close',
  'reconciliation',
];

/**
 * Effective events only: superseded rows and void (tombstone) rows never reach
 * the calculator, attribution or presence replay (§8.1, D28).
 */
export interface AttendanceEventInput {
  id: string;
  kind: EventKind;
  /** ISO instant, whole seconds (T-6), already clock-corrected. */
  at: string;
  source: EventSource;
  evidence: Evidence;
  /** Why this day owns it (§8.1). */
  assignmentReason: AssignmentReason;
}

/** A day's status (§8.1, §8.3). `null` on a record means not decided yet. */
export type AttendanceStatus =
  | 'present'
  | 'half-day'
  | 'absent'
  | 'leave'
  | 'half-day-leave'
  | 'holiday'
  | 'not-evaluated'
  | 'not-employed';

/**
 * Where a person sat on a date, as the day recorded it when it was built
 * (attendance design §8.1). The directory keeps no history, so the shift and
 * calendar resolvers use this, when given one for a date, instead of today's
 * department.
 */
export interface PlacementOnDate {
  readonly departmentId: string | null;
}

export type PlacementsByDate = ReadonlyMap<DateOnly, PlacementOnDate>;

/**
 * Onboarding & Employee Lifecycle Types (PRD §9.2 ON-1, ON-3, ON-5)
 */
export type OnboardingWorkflowStatus = 'in_progress' | 'completed' | 'cancelled';
export type OnboardingStepStatus = 'pending' | 'completed' | 'skipped';
export type OnboardingOwnerRole = 'hr' | 'it' | 'manager' | 'facilities' | 'finance';

export interface OnboardingStepDto {
  id: string;
  workflowId: string;
  code: string;
  title: string;
  description: string | null;
  ownerId: string | null;
  ownerName: string | null;
  ownerRole: string;
  status: OnboardingStepStatus;
  dueDate: string;
  completedAt: string | null;
  completedBy: string | null;
  completedByName: string | null;
  notes: string | null;
  stepOrder: number;
}

export interface OnboardingWorkflowDto {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  departmentId: string | null;
  departmentName: string | null;
  status: OnboardingWorkflowStatus;
  startedAt: string;
  completedAt: string | null;
  steps: OnboardingStepDto[];
  progress: {
    total: number; // step count
    completed: number; // step count
    percent: number;
  };
}
