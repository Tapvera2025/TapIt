import { describe, expect, it } from 'vitest';
import type { LocalTime } from '@tapcrm/contracts';
import { d, fixed, inputs, template } from './fixtures.test-helpers.js';
import { findWindowOverlaps, scheduledMinutes, validateVersion } from './rules.js';

const t = (value: string) => value as LocalTime;

/** The error `run` throws, for matching its code. */
function thrown(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected an error');
}
const base = {
  kind: 'fixed' as const,
  fullDayMinutes: 450,
  halfDayMinutes: 240,
  complementaryHalfMinutes: null,
};

describe('§6.3 — rules checked before saving', () => {
  it('20:00 → 05:00 lasts 540 minutes', () => {
    expect(scheduledMinutes(t('20:00'), t('05:00'))).toBe(540);
    expect(scheduledMinutes(t('09:00'), t('18:00'))).toBe(540);
  });

  it('SH-I2: equal start and end times are refused, not read as 24 hours', () => {
    expect(
      thrown(() =>
        validateVersion({ ...base, startTime: t('20:00'), endTime: t('20:00') }),
      ),
    ).toMatchObject({ code: 'SHIFT_START_END_MUST_DIFFER', status: 422 });
  });

  it('full-day minutes longer than the shift are refused', () => {
    expect(
      thrown(() =>
        validateVersion({ ...base, startTime: t('09:00'), endTime: t('13:00') }),
      ),
    ).toMatchObject({ code: 'SHIFT_THRESHOLD_UNREACHABLE' });
  });

  it('a complementary half above half the shift is refused (§8.3)', () => {
    expect(
      thrown(() =>
        validateVersion({
          ...base,
          startTime: t('20:00'),
          endTime: t('05:00'),
          complementaryHalfMinutes: 300,
        }),
      ),
    ).toMatchObject({ code: 'SHIFT_THRESHOLD_UNREACHABLE' });
  });

  it('a fixed shift needs times; a flexible one may not have them', () => {
    expect(
      thrown(() => validateVersion({ ...base, startTime: null, endTime: null })),
    ).toMatchObject({ code: 'SHIFT_TIMES_REQUIRED' });
    expect(
      thrown(() =>
        validateVersion({
          ...base,
          kind: 'flexible',
          startTime: t('09:00'),
          endTime: t('18:00'),
        }),
      ),
    ).toMatchObject({ code: 'SHIFT_TIMES_NOT_ALLOWED' });
  });

  it('a valid night shift passes', () => {
    expect(() =>
      validateVersion({ ...base, startTime: t('20:00'), endTime: t('05:00') }),
    ).not.toThrow();
  });
});

describe('§6.3 "No overlap" — consecutive shifts may touch but not overlap', () => {
  const shiftList = [
    fixed('night', '20:00', '05:00'),
    fixed('early', '04:30', '13:30'),
    fixed('day', '09:00', '18:00'),
  ];

  it('Sunday 20:00–05:00 then Monday 04:30–13:30 overlaps by 30 minutes', () => {
    const roster = inputs({
      shiftList,
      assignments: [template('night')],
      overrides: [{ workDate: d('2026-09-28'), kind: 'shift', shiftId: 'early' }],
    });
    expect(findWindowOverlaps(roster, d('2026-09-28'), d('2026-09-28'))).toEqual([
      {
        date: '2026-09-28',
        previousShiftId: 'night',
        shiftId: 'early',
        overlapMinutes: 30,
      },
    ]);
  });

  it('a night followed by a 09:00 morning does not overlap', () => {
    const roster = inputs({
      shiftList,
      assignments: [template('night')],
      overrides: [{ workDate: d('2026-09-28'), kind: 'shift', shiftId: 'day' }],
    });
    expect(findWindowOverlaps(roster, d('2026-09-28'), d('2026-09-28'))).toEqual([]);
  });
});
