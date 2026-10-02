import { describe, expect, it } from 'vitest';
import {
  d,
  dated,
  departmentScope,
  inputs,
  shiftScope,
  weekOff,
} from './fixtures.test-helpers.js';
import { resolveDay } from './resolve.js';

const DEPT_A = '00000000-0000-0000-0000-00000000000a';
const DEPT_B = '00000000-0000-0000-0000-00000000000b';
const SHIFT_NIGHT = '00000000-0000-0000-0000-000000000001';
const SHIFT_DAY = '00000000-0000-0000-0000-000000000002';

const REPUBLIC = dated('rep', '2026-01-26', { name: 'Republic Day' });
const SUNDAY = weekOff('sun', [7], '2026-01-01', { name: 'Sunday' });

describe('HO-1 — dated holidays and their scope', () => {
  it('a national holiday applies to everyone; matchedBy is national', () => {
    const cal = inputs({ holidays: [REPUBLIC] });
    expect(resolveDay(cal, d('2026-01-26'))).toMatchObject({
      type: 'holiday',
      holidayId: 'rep',
      subtype: 'national',
      matchedBy: 'national',
    });
  });

  it('a regional holiday matches only its department', () => {
    const regional = { ...REPUBLIC, id: 'onam', type: 'regional' as const, holidayDate: d('2026-09-05') };
    const cal = (departmentId: string | null) =>
      inputs({
        departmentId,
        holidays: [regional],
        scopes: [departmentScope('onam', DEPT_A)],
      });
    expect(resolveDay(cal(DEPT_A), d('2026-09-05'))).toMatchObject({
      type: 'holiday',
      matchedBy: 'department',
    });
    expect(resolveDay(cal(DEPT_B), d('2026-09-05'))).toMatchObject({ type: 'working' });
    expect(resolveDay(cal(null), d('2026-09-05'))).toMatchObject({ type: 'working' });
  });

  it('a nationally dated row with no scope beats an unmatched regional one on the same date', () => {
    const cal = inputs({
      holidays: [REPUBLIC, { ...REPUBLIC, id: 'rep-r', type: 'regional' }],
      scopes: [departmentScope('rep-r', DEPT_A)],
      departmentId: DEPT_B,
    });
    expect(resolveDay(cal, d('2026-01-26'))).toMatchObject({ holidayId: 'rep' });
  });

  it('a withdrawn holiday is invisible', () => {
    const cal = inputs({
      holidays: [{ ...REPUBLIC, status: 'withdrawn' }],
    });
    expect(resolveDay(cal, d('2026-01-26'))).toMatchObject({ type: 'working' });
  });

  it('an optional holiday does not affect dayType until claimed (G9, step 6)', () => {
    const optional = dated('optional-1', '2026-10-20', { type: 'optional' });
    expect(
      resolveDay(inputs({ holidays: [optional] }), d('2026-10-20')),
    ).toMatchObject({ type: 'working' });
  });

  it('a shift-scoped holiday beats a department-scoped one on the same date', () => {
    // Two holidays on the same date, each carrying one legal scope axis
    // (validateScopeSet forbids mixing axes on ONE holiday). The person is
    // in DEPT_A and on the night shift, so both match — shift wins by
    // priority.
    const deptHoliday = dated('a', '2026-11-01', { type: 'regional' });
    const shiftHoliday = dated('b', '2026-11-01', { type: 'regional' });
    const cal = inputs({
      departmentId: DEPT_A,
      shiftIdsByDate: new Map([[d('2026-11-01'), SHIFT_NIGHT]]),
      holidays: [deptHoliday, shiftHoliday],
      scopes: [
        { holidayId: 'a', departmentId: DEPT_A, shiftId: null },
        { holidayId: 'b', departmentId: null, shiftId: SHIFT_NIGHT },
      ],
    });
    expect(resolveDay(cal, d('2026-11-01'))).toMatchObject({
      holidayId: 'b',
      matchedBy: 'shift',
    });
  });

  it('two matching regionals: earliest createdAt wins, then id', () => {
    const a = dated('a', '2026-11-02', { type: 'regional', createdAt: '2026-01-02T00:00:00Z' });
    const b = dated('b', '2026-11-02', { type: 'regional', createdAt: '2026-01-01T00:00:00Z' });
    const cal = inputs({
      departmentId: DEPT_A,
      holidays: [a, b],
      scopes: [
        { holidayId: 'a', departmentId: DEPT_A, shiftId: null },
        { holidayId: 'b', departmentId: DEPT_A, shiftId: null },
      ],
    });
    expect(resolveDay(cal, d('2026-11-02'))).toMatchObject({ holidayId: 'b' });
  });
});

describe('HO-2 — shift-scoped holidays match the resolved shift for that date', () => {
  const nightHoliday = dated('night-eve', '2026-12-31', {
    name: 'Night crew eve',
    type: 'regional',
  });

  it('the shift that starts on the date is the one that matters', () => {
    const cal = inputs({
      holidays: [nightHoliday],
      scopes: [shiftScope('night-eve', SHIFT_NIGHT)],
      shiftIdsByDate: new Map([[d('2026-12-31'), SHIFT_NIGHT]]),
    });
    expect(resolveDay(cal, d('2026-12-31'))).toMatchObject({
      type: 'holiday',
      matchedBy: 'shift',
    });
  });

  it('a person on the day shift that date is not covered', () => {
    const cal = inputs({
      holidays: [nightHoliday],
      scopes: [shiftScope('night-eve', SHIFT_NIGHT)],
      shiftIdsByDate: new Map([[d('2026-12-31'), SHIFT_DAY]]),
    });
    expect(resolveDay(cal, d('2026-12-31'))).toMatchObject({ type: 'working' });
  });
});

describe('week-off rules', () => {
  it('a global Sunday is week-off with matchedBy=national', () => {
    expect(resolveDay(inputs({ holidays: [SUNDAY] }), d('2026-01-04'))).toMatchObject({
      type: 'week-off',
      subtype: 'week-off',
      matchedBy: 'national',
    });
  });

  it('a Wednesday is working', () => {
    expect(resolveDay(inputs({ holidays: [SUNDAY] }), d('2026-01-07'))).toMatchObject({
      type: 'working',
    });
  });

  it('the second-and-fourth-Saturday pattern', () => {
    const cal = inputs({
      holidays: [weekOff('sat', [6], '2026-01-01', { name: 'Sat 2/4' })],
    });
    // Recurrence override — the fixture default has no weeksOfMonth; supply it here.
    (cal.holidays[0]!.recurrence as { weekdays: number[]; weeksOfMonth?: number[] }).weeksOfMonth = [2, 4];
    expect(resolveDay(cal, d('2026-01-10'))).toMatchObject({ type: 'week-off' }); // 2nd Sat
    expect(resolveDay(cal, d('2026-01-17'))).toMatchObject({ type: 'working' }); // 3rd Sat
    expect(resolveDay(cal, d('2026-01-24'))).toMatchObject({ type: 'week-off' }); // 4th Sat
  });

  it('the latest active rule in force wins between two rules', () => {
    const cal = inputs({
      holidays: [
        weekOff('old', [7], '2025-01-01'),
        weekOff('new', [6, 7], '2026-06-01'),
      ],
    });
    expect(resolveDay(cal, d('2026-06-06'))).toMatchObject({ holidayId: 'new' }); // Saturday
    expect(resolveDay(cal, d('2026-05-30'))).toMatchObject({ type: 'working' });   // old rule, Saturday not covered
  });

  it('a dated holiday beats a week-off rule that would otherwise match', () => {
    const cal = inputs({ holidays: [SUNDAY, REPUBLIC] });
    expect(resolveDay(cal, d('2026-01-26'))).toMatchObject({ // Monday but Republic Day
      type: 'holiday',
      subtype: 'national',
    });
  });

  it('a scoped week-off applies only to people its scope covers', () => {
    const floorSat = weekOff('floor-sat', [6], '2026-01-01', { name: 'Floor Saturday' });
    const cal = (departmentId: string | null) =>
      inputs({
        departmentId,
        holidays: [floorSat],
        scopes: [{ holidayId: 'floor-sat', departmentId: DEPT_A, shiftId: null }],
      });
    // 3 January 2026 is a Saturday.
    expect(resolveDay(cal(DEPT_A), d('2026-01-03'))).toMatchObject({
      type: 'week-off',
      matchedBy: 'department',
    });
    expect(resolveDay(cal(DEPT_B), d('2026-01-03'))).toMatchObject({ type: 'working' });
    expect(resolveDay(cal(null),   d('2026-01-03'))).toMatchObject({ type: 'working' });
  });
});
