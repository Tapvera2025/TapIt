import type { DateOnly, LocalTime } from '@tapcrm/contracts';
import type {
  AssignmentInput,
  ShiftInput,
  ShiftInputs,
  ShiftVersionInput,
} from './resolve.js';

/** Builders for the pure shift tests. Times are wall-clock; dates are ISO. */

export const d = (value: string) => value as DateOnly;
export const t = (value: string) => value as LocalTime;

export function version(
  id: string,
  effectiveFrom: string,
  start: string | null,
  end: string | null,
  extra: Partial<ShiftVersionInput> = {},
): ShiftVersionInput {
  return {
    id,
    effectiveFrom: d(effectiveFrom),
    startTime: start === null ? null : t(start),
    endTime: end === null ? null : t(end),
    graceMinutes: 10,
    earlyExitGraceMinutes: 0,
    fullDayMinutes: 450,
    halfDayMinutes: 240,
    complementaryHalfMinutes: null,
    minOvertimeMinutes: null,
    earlyWindowMinutes: 180,
    maxClosingExtensionMinutes: null,
    ...extra,
  };
}

export const fixed = (
  id: string,
  start: string,
  end: string,
  from = '2026-01-01',
): ShiftInput => ({
  id,
  kind: 'fixed',
  versions: [version(`${id}-v1`, from, start, end)],
});

export const flexibleTemplate = (id: string): ShiftInput => ({
  id,
  kind: 'flexible',
  versions: [
    version(`${id}-v1`, '2026-01-01', null, null, {
      fullDayMinutes: 480,
      halfDayMinutes: 300,
    }),
  ],
});

export const template = (
  shiftId: string,
  from = '2026-01-01',
  to: string | null = null,
): AssignmentInput => ({
  kind: 'template',
  shiftId,
  rotationId: null,
  effectiveFrom: d(from),
  effectiveTo: to === null ? null : d(to),
});

export function inputs(
  overrides: Partial<ShiftInputs> & { shiftList?: ShiftInput[] } = {},
): ShiftInputs {
  const { shiftList = [], ...rest } = overrides;
  return {
    timezone: 'Asia/Kolkata',
    shifts: new Map(shiftList.map((shift) => [shift.id, shift])),
    rotations: new Map(),
    overrides: [],
    assignments: [],
    flexibleRequests: [],
    departmentDefaults: [],
    settings: [],
    ...rest,
  };
}
