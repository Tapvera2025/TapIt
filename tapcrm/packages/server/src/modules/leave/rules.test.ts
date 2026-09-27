// packages/server/src/modules/leave/rules.test.ts
import { describe, expect, it } from 'vitest';
import type { LeaveHalf } from '@tapcrm/contracts';
import { balanceAvailable, daysConsumed, overlayKindForDay } from './rules.js';

describe('daysConsumed', () => {
  // Single-day cases
  it('single working day, full → 1', () =>
    expect(daysConsumed(1, 'full', 'full', true, true, true)).toBe(1));
  it('single working day, from_half=first → 0.5', () =>
    expect(daysConsumed(1, 'first', 'full', true, true, true)).toBe(0.5));
  it('single working day, from_half=second → 0.5', () =>
    expect(daysConsumed(1, 'second', 'full', true, true, true)).toBe(0.5));
  it('single non-working day → 0', () =>
    expect(daysConsumed(0, 'full', 'full', false, false, true)).toBe(0));

  // Multi-day: from_half='second' deducts 0.5 from first day if first day works
  it('3 working days, from_half=second → 2.5', () =>
    expect(daysConsumed(3, 'second', 'full', true, true, false)).toBe(2.5));
  // from_half='first' on multi-day = full day (overlayKindForDay returns leave-full)
  it('3 working days, from_half=first → 3.0 (full day)', () =>
    expect(daysConsumed(3, 'first', 'full', true, true, false)).toBe(3));
  // to_half='first' deducts 0.5 from last day if last day works
  it('3 working days, to_half=first → 2.5', () =>
    expect(daysConsumed(3, 'full', 'first', true, true, false)).toBe(2.5));
  it('3 working days, both second/first → 2.0', () =>
    expect(daysConsumed(3, 'second', 'first', true, true, false)).toBe(2));
  // first day is holiday: no deduction even with from_half=second
  it('3 working days but first day non-working, from_half=second → 3.0', () =>
    expect(daysConsumed(3, 'second', 'full', false, true, false)).toBe(3));
  // last day is holiday: no deduction even with to_half=first
  it('3 working days but last day non-working, to_half=first → 3.0', () =>
    expect(daysConsumed(3, 'full', 'first', true, false, false)).toBe(3));
});

describe('balanceAvailable', () => {
  it('opening + accrual - consumption + reversal', () =>
    expect(balanceAvailable([
      { kind: 'opening', units: 10 },
      { kind: 'accrual', units: 5 },
      { kind: 'consumption', units: 3 },
      { kind: 'reversal', units: 1 },
    ])).toBe(13));
  it('empty entries → 0', () => expect(balanceAvailable([])).toBe(0));
});

describe('overlayKindForDay', () => {
  it('middle day → leave-full', () =>
    expect(overlayKindForDay('2026-10-02', '2026-10-01', '2026-10-03', 'second', 'first'))
      .toBe('leave-full'));
  it('first day, from_half=second → leave-second-half', () =>
    expect(overlayKindForDay('2026-10-01', '2026-10-01', '2026-10-03', 'second', 'full'))
      .toBe('leave-second-half'));
  it('first day multi-day, from_half=first → leave-full', () =>
    expect(overlayKindForDay('2026-10-01', '2026-10-01', '2026-10-03', 'first', 'full'))
      .toBe('leave-full'));
  it('last day, to_half=first → leave-first-half', () =>
    expect(overlayKindForDay('2026-10-03', '2026-10-01', '2026-10-03', 'full', 'first'))
      .toBe('leave-first-half'));
  it('single day full → leave-full', () =>
    expect(overlayKindForDay('2026-10-01', '2026-10-01', '2026-10-01', 'full', 'full'))
      .toBe('leave-full'));
  it('single day first → leave-first-half', () =>
    expect(overlayKindForDay('2026-10-01', '2026-10-01', '2026-10-01', 'first', 'full'))
      .toBe('leave-first-half'));
  it('single day second → leave-second-half', () =>
    expect(overlayKindForDay('2026-10-01', '2026-10-01', '2026-10-01', 'second', 'full'))
      .toBe('leave-second-half'));
});
