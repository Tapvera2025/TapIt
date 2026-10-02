import type { DateOnly } from '@tapcrm/contracts';
import type { CalendarInputs, HolidayInput, ScopeInput } from './resolve.js';

export const d = (value: string) => value as DateOnly;

export const dated = (
  id: string,
  date: string,
  extra: Partial<HolidayInput> = {},
): HolidayInput => ({
  id,
  name: extra.name ?? id,
  type: 'national',
  holidayDate: d(date),
  recurrence: null,
  effectiveFrom: null,
  effectiveTo: null,
  status: 'active',
  createdAt: extra.createdAt ?? '2026-01-01T00:00:00Z',
  ...extra,
});

export const weekOff = (
  id: string,
  weekdays: number[],
  from = '2026-01-01',
  extra: Partial<HolidayInput> = {},
): HolidayInput => ({
  id,
  name: extra.name ?? id,
  type: 'week-off',
  holidayDate: null,
  recurrence: { weekdays },
  effectiveFrom: d(from),
  effectiveTo: null,
  status: 'active',
  createdAt: extra.createdAt ?? '2026-01-01T00:00:00Z',
  ...extra,
});

export const departmentScope = (holidayId: string, departmentId: string): ScopeInput => ({
  holidayId,
  departmentId,
  shiftId: null,
});

export const shiftScope = (holidayId: string, shiftId: string): ScopeInput => ({
  holidayId,
  departmentId: null,
  shiftId,
});

export function inputs(
  overrides: Partial<CalendarInputs> & {
    holidays?: HolidayInput[];
    scopes?: ScopeInput[];
  } = {},
): CalendarInputs {
  const { holidays = [], scopes = [], ...rest } = overrides;
  return {
    timezone: 'Asia/Kolkata',
    departmentId: null,
    holidays,
    scopes,
    shiftIdsByDate: new Map(),
    ...rest,
  };
}
