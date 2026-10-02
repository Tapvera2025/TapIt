import { describe, expect, it } from 'vitest';
import { d } from './fixtures.test-helpers.js';
import { validateHoliday, validateScope, validateScopeSet } from './rules.js';

function thrown(run: () => void): unknown {
  try {
    run();
  } catch (e) {
    return e;
  }
  throw new Error('expected an error');
}

const datedFields = {
  type: 'national' as const,
  holidayDate: d('2026-01-26'),
  recurrence: null,
  effectiveFrom: null,
  effectiveTo: null,
};
const weekOffFields = {
  type: 'week-off' as const,
  holidayDate: null,
  recurrence: { weekdays: [7] },
  effectiveFrom: d('2026-01-01'),
  effectiveTo: null,
};

describe('§7 — rules checked before saving a holiday', () => {
  it('a dated holiday needs holidayDate and no recurrence', () => {
    expect(() => validateHoliday(datedFields)).not.toThrow();
    expect(
      thrown(() => validateHoliday({ ...datedFields, holidayDate: null })),
    ).toMatchObject({ code: 'HOLIDAY_DATE_REQUIRED' });
    expect(
      thrown(() =>
        validateHoliday({ ...datedFields, recurrence: { weekdays: [7] } }),
      ),
    ).toMatchObject({ code: 'HOLIDAY_RECURRENCE_NOT_ALLOWED' });
  });

  it('a week-off needs recurrence + effectiveFrom, and no holidayDate', () => {
    expect(() => validateHoliday(weekOffFields)).not.toThrow();
    expect(
      thrown(() => validateHoliday({ ...weekOffFields, recurrence: null })),
    ).toMatchObject({ code: 'HOLIDAY_RECURRENCE_REQUIRED' });
    expect(
      thrown(() => validateHoliday({ ...weekOffFields, effectiveFrom: null })),
    ).toMatchObject({ code: 'HOLIDAY_EFFECTIVE_FROM_REQUIRED' });
    expect(
      thrown(() =>
        validateHoliday({ ...weekOffFields, holidayDate: d('2026-01-04') }),
      ),
    ).toMatchObject({ code: 'HOLIDAY_DATE_NOT_ALLOWED' });
  });

  it('effectiveTo must be after effectiveFrom', () => {
    expect(
      thrown(() =>
        validateHoliday({
          ...weekOffFields,
          effectiveTo: d('2026-01-01'),
        }),
      ),
    ).toMatchObject({ code: 'HOLIDAY_RANGE_INVALID' });
  });

  it('recurrence weekdays are 1..7 and weeksOfMonth 1..5', () => {
    expect(
      thrown(() =>
        validateHoliday({
          ...weekOffFields,
          recurrence: { weekdays: [0, 8] },
        }),
      ),
    ).toMatchObject({ code: 'HOLIDAY_RECURRENCE_INVALID' });
    expect(
      thrown(() =>
        validateHoliday({
          ...weekOffFields,
          recurrence: { weekdays: [7], weeksOfMonth: [0, 6] },
        }),
      ),
    ).toMatchObject({ code: 'HOLIDAY_RECURRENCE_INVALID' });
  });

  it('a scope row is one department or one shift, never both or neither', () => {
    expect(() =>
      validateScope({ departmentId: 'd', shiftId: null }),
    ).not.toThrow();
    expect(() =>
      validateScope({ departmentId: null, shiftId: 's' }),
    ).not.toThrow();
    expect(
      thrown(() => validateScope({ departmentId: null, shiftId: null })),
    ).toMatchObject({ code: 'HOLIDAY_SCOPE_INVALID' });
    expect(
      thrown(() => validateScope({ departmentId: 'd', shiftId: 's' })),
    ).toMatchObject({ code: 'HOLIDAY_SCOPE_INVALID' });
  });
});

describe('§7 — type ↔ scope invariants (enforced by the service)', () => {
  const scopeSet = (rows: { departmentId: string | null; shiftId: string | null }[]) => rows;

  it('national holidays carry no scope rows', () => {
    expect(() => validateScopeSet('national', [])).not.toThrow();
    expect(
      thrown(() =>
        validateScopeSet('national', scopeSet([{ departmentId: 'd', shiftId: null }])),
      ),
    ).toMatchObject({ code: 'HOLIDAY_SCOPE_INVALID_FOR_TYPE' });
  });

  it('regional holidays need at least one scope row, all of one kind', () => {
    expect(() =>
      validateScopeSet(
        'regional',
        scopeSet([{ departmentId: 'd', shiftId: null }]),
      ),
    ).not.toThrow();
    expect(() =>
      validateScopeSet('regional', scopeSet([{ departmentId: null, shiftId: 's' }])),
    ).not.toThrow();
    expect(
      thrown(() => validateScopeSet('regional', [])),
    ).toMatchObject({ code: 'HOLIDAY_SCOPE_REQUIRED' });
    expect(
      thrown(() =>
        validateScopeSet(
          'regional',
          scopeSet([
            { departmentId: 'd', shiftId: null },
            { departmentId: null, shiftId: 's' },
          ]),
        ),
      ),
    ).toMatchObject({ code: 'HOLIDAY_SCOPE_MIXED_TARGETS' });
  });

  it('optional holidays have no scope, or department scope only (never shift)', () => {
    expect(() => validateScopeSet('optional', [])).not.toThrow();
    expect(() =>
      validateScopeSet('optional', scopeSet([{ departmentId: 'd', shiftId: null }])),
    ).not.toThrow();
    expect(
      thrown(() =>
        validateScopeSet('optional', scopeSet([{ departmentId: null, shiftId: 's' }])),
      ),
    ).toMatchObject({ code: 'HOLIDAY_SCOPE_INVALID_FOR_TYPE' });
  });

  it('week-off rules accept any of the three shapes, all of one kind', () => {
    expect(() => validateScopeSet('week-off', [])).not.toThrow();
    expect(() =>
      validateScopeSet('week-off', scopeSet([{ departmentId: 'd', shiftId: null }])),
    ).not.toThrow();
    expect(() =>
      validateScopeSet('week-off', scopeSet([{ departmentId: null, shiftId: 's' }])),
    ).not.toThrow();
    expect(
      thrown(() =>
        validateScopeSet(
          'week-off',
          scopeSet([
            { departmentId: 'd', shiftId: null },
            { departmentId: null, shiftId: 's' },
          ]),
        ),
      ),
    ).toMatchObject({ code: 'HOLIDAY_SCOPE_MIXED_TARGETS' });
  });
});
