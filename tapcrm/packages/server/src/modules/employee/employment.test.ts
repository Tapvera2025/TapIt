import { describe, expect, it } from 'vitest';
import type { DateOnly } from '@tapcrm/contracts';
import { changedDays } from './employment.js';

const d = (value: string) => value as DateOnly;
const window = (joinedOn: string | null, leftOn: string | null) => ({
  joinedOn: joinedOn === null ? null : d(joinedOn),
  leftOn: leftOn === null ? null : d(leftOn),
});

describe('the days an employment change reaches', () => {
  it('nothing, when nothing moved', () => {
    expect(
      changedDays(window('2026-01-01', null), window('2026-01-01', null)),
    ).toBeNull();
  });

  it('a joining date moved later: the days it no longer covers', () => {
    expect(changedDays(window('2026-10-01', null), window('2026-10-05', null))).toEqual({
      from: '2026-10-01',
      to: '2026-10-04',
    });
  });

  it('a joining date moved earlier: the days it now covers', () => {
    expect(changedDays(window('2026-10-05', null), window('2026-10-01', null))).toEqual({
      from: '2026-10-01',
      to: '2026-10-04',
    });
  });

  it('a first joining date: every day before it', () => {
    expect(changedDays(window(null, null), window('2026-10-05', null))).toEqual({
      from: '1900-01-01',
      to: '2026-10-04',
    });
  });

  it('a leaving date set: every day after it', () => {
    expect(
      changedDays(window('2026-01-01', null), window('2026-01-01', '2026-10-10')),
    ).toEqual({
      from: '2026-10-11',
      to: null,
    });
  });

  it('a leaving date moved: the days between the two', () => {
    expect(
      changedDays(window('2026-01-01', '2026-10-10'), window('2026-01-01', '2026-10-20')),
    ).toEqual({ from: '2026-10-11', to: '2026-10-20' });
  });

  it('both moved: one range covering both', () => {
    expect(
      changedDays(window('2026-10-05', '2026-10-10'), window('2026-10-03', '2026-10-12')),
    ).toEqual({ from: '2026-10-03', to: '2026-10-12' });
  });
});
