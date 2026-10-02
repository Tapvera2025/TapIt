import type {
  DateOnly,
  LocalTime,
  PlacementsByDate,
  ResolvedShift,
  ShiftSource,
} from '@tapcrm/contracts';
import { addDays, weekdayOf } from '../../platform/time.js';

/**
 * SH-1 — which shift applied to a person on a date, and why (design §6.2).
 *
 * Pure: `repository.loadShiftInputs` reads everything once, and this walks the
 * chain, highest precedence first. No other code decides a person's shift.
 *
 *   1 date override · 2 permanent flexible · 3 approved flexible request
 *   4 rotation · 5 template · 6 department default · 7 nothing
 *
 * "The version on a date" is the latest version whose effective_from is on or
 * before it, so a template edit never reaches back (SH-2). Inactive templates
 * keep resolving for the assignments they already have (SH-5).
 */

/** SH-4 — flexible thresholds are constants, not settings. */
export const FLEXIBLE_FULL_DAY_MINUTES = 480;
export const FLEXIBLE_HALF_DAY_MINUTES = 300;

export interface ShiftVersionInput {
  readonly id: string;
  readonly effectiveFrom: DateOnly;
  readonly startTime: LocalTime | null;
  readonly endTime: LocalTime | null;
  readonly graceMinutes: number;
  readonly earlyExitGraceMinutes: number;
  readonly fullDayMinutes: number;
  readonly halfDayMinutes: number;
  readonly complementaryHalfMinutes: number | null;
  readonly minOvertimeMinutes: number | null;
  readonly earlyWindowMinutes: number;
  readonly maxClosingExtensionMinutes: number | null;
}

export interface ShiftInput {
  readonly id: string;
  readonly kind: 'fixed' | 'flexible';
  /** Any order. */
  readonly versions: readonly ShiftVersionInput[];
}

interface Dated {
  readonly effectiveFrom: DateOnly;
  /** Exclusive; null is open-ended. */
  readonly effectiveTo: DateOnly | null;
}

export interface AssignmentInput extends Dated {
  readonly kind: 'template' | 'rotation' | 'permanent-flexible';
  readonly shiftId: string | null;
  readonly rotationId: string | null;
}

export interface OverrideInput {
  readonly workDate: DateOnly;
  readonly kind: 'shift' | 'flexible' | 'no-shift';
  readonly shiftId: string | null;
}

export interface FlexibleRequestInput {
  readonly fromDate: DateOnly;
  /** Inclusive. */
  readonly toDate: DateOnly;
}

export interface DepartmentDefaultInput extends Dated {
  readonly shiftId: string;
}

/** A department default as the repository reads it, for more than one department. */
export interface DepartmentDefaultRow extends DepartmentDefaultInput {
  readonly departmentId: string;
}

export interface ShiftSettingInput {
  readonly effectiveFrom: DateOnly;
  readonly dayStartTime: LocalTime;
  readonly maxClosingExtensionMinutes: number;
}

/** Everything the chain reads for one person. */
export interface ShiftInputs {
  readonly timezone: string;
  readonly shifts: ReadonlyMap<string, ShiftInput>;
  /** rotation id → ISO weekday (1–7) → shift id, or null for no shift that day. */
  readonly rotations: ReadonlyMap<string, ReadonlyMap<number, string | null>>;
  readonly overrides: readonly OverrideInput[];
  readonly assignments: readonly AssignmentInput[];
  readonly flexibleRequests: readonly FlexibleRequestInput[];
  readonly departmentDefaults: readonly DepartmentDefaultInput[];
  readonly settings: readonly ShiftSettingInput[];
}

const covers = (row: Dated, date: DateOnly): boolean =>
  row.effectiveFrom <= date && (row.effectiveTo === null || date < row.effectiveTo);

/**
 * The department defaults one person's chain sees (step 6). A date whose day
 * attendance already built uses the department that day recorded (attendance
 * design §8.1); every other date uses today's. With no recorded placements
 * this is today's rows, unchanged. Otherwise it is one row per date, so the
 * chain below needs no change.
 */
export function departmentDefaultsFor(
  rows: readonly DepartmentDefaultRow[],
  today: string | null,
  placements: PlacementsByDate | undefined,
  first: DateOnly,
  last: DateOnly,
): DepartmentDefaultInput[] {
  if (placements === undefined || placements.size === 0) {
    return rows
      .filter((row) => row.departmentId === today)
      .map(({ shiftId, effectiveFrom, effectiveTo }) => ({
        shiftId,
        effectiveFrom,
        effectiveTo,
      }));
  }
  const out: DepartmentDefaultInput[] = [];
  for (let date = first; date <= last; date = addDays(date, 1)) {
    const placement = placements.get(date);
    const department = placement === undefined ? today : placement.departmentId;
    const row = rows.find((r) => r.departmentId === department && covers(r, date));
    if (row !== undefined)
      out.push({
        shiftId: row.shiftId,
        effectiveFrom: date,
        effectiveTo: addDays(date, 1),
      });
  }
  return out;
}

/** The latest dated row in force on `date`, or undefined. */
export function inForce<T extends { readonly effectiveFrom: DateOnly }>(
  rows: readonly T[],
  date: DateOnly,
): T | undefined {
  let best: T | undefined;
  for (const row of rows) {
    if (
      row.effectiveFrom <= date &&
      (best === undefined || row.effectiveFrom > best.effectiveFrom)
    )
      best = row;
  }
  return best;
}

export function settingOn(
  inputs: ShiftInputs,
  date: DateOnly,
): ShiftSettingInput | undefined {
  return inForce(inputs.settings, date);
}

function none(
  inputs: ShiftInputs,
  date: DateOnly,
  source: ShiftSource,
  shiftId: string | null = null,
): ResolvedShift {
  return {
    date,
    source,
    shiftId,
    versionId: null,
    kind: 'none',
    start: null,
    end: null,
    isOvernight: false,
    graceMinutes: 0,
    earlyExitGraceMinutes: 0,
    fullDayMinutes: null,
    halfDayMinutes: null,
    complementaryHalfMinutes: null,
    minOvertimeMinutes: null,
    earlyWindowMinutes: 0,
    maxClosingExtensionMinutes:
      settingOn(inputs, date)?.maxClosingExtensionMinutes ?? null,
    timezone: inputs.timezone,
  };
}

function flexible(
  inputs: ShiftInputs,
  date: DateOnly,
  source: ShiftSource,
  shiftId: string | null = null,
): ResolvedShift {
  return {
    ...none(inputs, date, source, shiftId),
    kind: 'flexible',
    fullDayMinutes: FLEXIBLE_FULL_DAY_MINUTES,
    halfDayMinutes: FLEXIBLE_HALF_DAY_MINUTES,
  };
}

/** A template as it stood on `date`. A template with no version yet is no shift. */
export function templateOn(
  inputs: ShiftInputs,
  shiftId: string,
  date: DateOnly,
  source: ShiftSource,
): ResolvedShift {
  const shift = inputs.shifts.get(shiftId);
  const version = shift === undefined ? undefined : inForce(shift.versions, date);
  if (shift === undefined || version === undefined)
    return none(inputs, date, source, shiftId);
  if (
    shift.kind === 'flexible' ||
    version.startTime === null ||
    version.endTime === null
  ) {
    return { ...flexible(inputs, date, source, shiftId), versionId: version.id };
  }
  return {
    date,
    source,
    shiftId,
    versionId: version.id,
    kind: 'fixed',
    start: version.startTime,
    end: version.endTime,
    isOvernight: version.endTime < version.startTime,
    graceMinutes: version.graceMinutes,
    earlyExitGraceMinutes: version.earlyExitGraceMinutes,
    fullDayMinutes: version.fullDayMinutes,
    halfDayMinutes: version.halfDayMinutes,
    complementaryHalfMinutes: version.complementaryHalfMinutes,
    minOvertimeMinutes: version.minOvertimeMinutes,
    earlyWindowMinutes: version.earlyWindowMinutes,
    maxClosingExtensionMinutes:
      version.maxClosingExtensionMinutes ??
      settingOn(inputs, date)?.maxClosingExtensionMinutes ??
      null,
    timezone: inputs.timezone,
  };
}

/** The shift a rotation gives on `date`: undefined off the rotation, null for no shift that weekday. */
function rotationShift(
  inputs: ShiftInputs,
  rotationId: string,
  date: DateOnly,
): string | null | undefined {
  const days = inputs.rotations.get(rotationId);
  if (days === undefined) return undefined;
  return days.get(weekdayOf(date)) ?? null;
}

export function resolveShift(inputs: ShiftInputs, date: DateOnly): ResolvedShift {
  // 1. A date override.
  const override = inputs.overrides.find((row) => row.workDate === date);
  if (override !== undefined) {
    if (override.kind === 'flexible') return flexible(inputs, date, 'date-override');
    if (override.kind === 'no-shift' || override.shiftId === null)
      return none(inputs, date, 'date-override');
    return templateOn(inputs, override.shiftId, date, 'date-override');
  }

  const active = inputs.assignments.filter((row) => covers(row, date));
  const ofKind = (kind: AssignmentInput['kind']) =>
    active.find((row) => row.kind === kind);

  // 2. Permanent flexible hours.
  if (ofKind('permanent-flexible') !== undefined)
    return flexible(inputs, date, 'permanent-flexible');

  // 3. An approved request for flexible hours.
  if (inputs.flexibleRequests.some((row) => row.fromDate <= date && date <= row.toDate)) {
    return flexible(inputs, date, 'flexible-request');
  }

  // 4. A rotation: the weekday's template, or no shift that weekday.
  const rotation = ofKind('rotation');
  if (rotation?.rotationId != null) {
    const shiftId = rotationShift(inputs, rotation.rotationId, date);
    if (shiftId === null) return none(inputs, date, 'rotation');
    if (shiftId !== undefined) return templateOn(inputs, shiftId, date, 'rotation');
  }

  // 5. A template.
  const tmpl = ofKind('template');
  if (tmpl?.shiftId != null)
    return templateOn(inputs, tmpl.shiftId, date, 'template');

  // 6. The department's default.
  const departmentDefault = inputs.departmentDefaults.find((row) => covers(row, date));
  if (departmentDefault !== undefined)
    return templateOn(inputs, departmentDefault.shiftId, date, 'department-default');

  // 7. Nothing: recorded, not evaluated.
  return none(inputs, date, 'none');
}

/**
 * §5.2 — the fixed template a day without fixed times borrows its boundary
 * anchor from: the person's assigned template (rotation, then template) even
 * when a higher rule made the day flexible, else the department default. Never
 * a neighbouring day's shift.
 */
export function anchorShift(inputs: ShiftInputs, date: DateOnly): ResolvedShift | null {
  const candidates: (readonly [string | null | undefined, ShiftSource])[] = [];
  const active = inputs.assignments.filter((row) => covers(row, date));
  const rotation = active.find((row) => row.kind === 'rotation');
  if (rotation?.rotationId != null)
    candidates.push([rotationShift(inputs, rotation.rotationId, date), 'rotation']);
  const tmpl = active.find((row) => row.kind === 'template');
  if (tmpl?.shiftId != null) candidates.push([tmpl.shiftId, 'template']);
  const departmentDefault = inputs.departmentDefaults.find((row) => covers(row, date));
  if (departmentDefault !== undefined)
    candidates.push([departmentDefault.shiftId, 'department-default']);

  for (const [shiftId, source] of candidates) {
    if (typeof shiftId !== 'string') continue;
    const resolved = templateOn(inputs, shiftId, date, source);
    if (resolved.kind === 'fixed') return resolved;
  }
  return null;
}
