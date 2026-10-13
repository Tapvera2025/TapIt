import { describe, expect, it } from 'vitest';
import {
  computeLiveBreakTime,
  computeLiveWorkTime,
  deriveDisplayStatus,
  formatDuration,
  getBreakTime,
  getPunchIn,
  getPunchOut,
  getWorkTime,
} from './LiveBoardPage.js';
import type { LiveRow } from './liveApi.js';

// Base timestamp used as "now" in live-clock tests
// 2026-10-07T09:00:00Z = 1728291600000 ms
const NOW_MS = 1728291600000;

// Helper: build a LiveRow at a known "since" relative to NOW_MS
function sinceOffset(offsetMinutes: number): string {
  return new Date(NOW_MS - offsetMinutes * 60_000).toISOString();
}

const baseRow: LiveRow = {
  id: 'user-1',
  userId: 'user-1',
  fullName: 'Rahul Sharma',
  departmentId: 'dept-1',
  departmentName: 'Engineering',
  teamId: 'team-1',
  teamName: 'Backend',
  workDate: '2026-10-07' as LiveRow['workDate'],
  state: 'WORKING',
  displayGroup: 'working',
  since: sinceOffset(272),        // started working 272 minutes ago
  lastEventAt: sinceOffset(272),
  workedMinutes: 272,
  breakMinutes: 32,
  presenceConfidence: 'confirmed',
  lastScanAt: null,
  likelyFinishedAt: null,
  isWfh: false,
  dayGroup: null,
  shiftStartAt: '2026-10-07T04:00:00.000Z',
  shiftEndAt: '2026-10-07T13:00:00.000Z',
  graceMinutes: 10,
  arrivalAt: null,
  departureAt: null,
  lateMinutes: null,
  updatedAt: '2026-10-07T08:30:00.000Z',
};

describe('formatDuration', () => {
  it('returns "—" for null', () => {
    expect(formatDuration(null)).toBe('—');
  });

  it('returns "—" for 0 when zeroAsDash=true (default)', () => {
    expect(formatDuration(0)).toBe('—');
  });

  it('returns "0m" for 0 when zeroAsDash=false', () => {
    expect(formatDuration(0, false)).toBe('0m');
  });

  it('returns "0m" for negative values when zeroAsDash=false', () => {
    expect(formatDuration(-5, false)).toBe('0m');
  });

  it('formats minutes-only', () => {
    expect(formatDuration(45)).toBe('45m');
  });

  it('formats hours-only', () => {
    expect(formatDuration(120)).toBe('2h');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(272)).toBe('4h 32m');
  });
});

describe('deriveDisplayStatus', () => {
  it('returns Working for WORKING state within grace period', () => {
    expect(deriveDisplayStatus({ ...baseRow, lateMinutes: 0 })).toBe('Working');
  });

  it('returns Working (Late) when lateMinutes > 0', () => {
    expect(deriveDisplayStatus({ ...baseRow, lateMinutes: 15 })).toBe('Working (Late)');
  });

  it('returns On Break for ON_BREAK state', () => {
    expect(deriveDisplayStatus({ ...baseRow, state: 'ON_BREAK' })).toBe('On Break');
  });

  it('returns Finished for FINISHED state', () => {
    expect(deriveDisplayStatus({ ...baseRow, state: 'FINISHED', displayGroup: 'finished' })).toBe('Finished');
  });

  it('returns Not Checked In for NOT_IN state', () => {
    expect(deriveDisplayStatus({ ...baseRow, state: 'NOT_IN', displayGroup: 'notInNotYetDue' })).toBe('Not Checked In');
  });

  it('returns On Leave for leave dayGroup', () => {
    expect(deriveDisplayStatus({ ...baseRow, dayGroup: 'leave', displayGroup: 'onLeave' })).toBe('On Leave');
  });
});

describe('computeLiveWorkTime — Bug #1 + #2: live elapsed time', () => {
  it('shows "0m" immediately after punch-in (workedMinutes=0, since=now)', () => {
    const row: LiveRow = {
      ...baseRow,
      state: 'WORKING',
      workedMinutes: 0,
      breakMinutes: 0,
      since: sinceOffset(0), // punched in 0 minutes ago
    };
    // elapsed = 0 min, workedMinutes = 0 → total = 0 → "0m" (not "—")
    expect(computeLiveWorkTime(row, NOW_MS)).toBe('0m');
  });

  it('shows elapsed time (1 min) just after punch-in', () => {
    const row: LiveRow = {
      ...baseRow,
      state: 'WORKING',
      workedMinutes: 0,
      breakMinutes: 0,
      since: sinceOffset(1), // punched in 1 minute ago
    };
    expect(computeLiveWorkTime(row, NOW_MS)).toBe('1m');
  });

  it('adds current stretch elapsed to accumulated workedMinutes (after a break)', () => {
    // Employee worked 2h, took break, then resumed. Backend says:
    //   workedMinutes = 120 (prior work)
    //   since = 30 minutes ago (resumed from break)
    const row: LiveRow = {
      ...baseRow,
      state: 'WORKING',
      workedMinutes: 120,
      breakMinutes: 15,
      since: sinceOffset(30),
    };
    // Live work = 120 + 30 = 150 → "2h 30m"
    expect(computeLiveWorkTime(row, NOW_MS)).toBe('2h 30m');
  });

  it('ticks live — same row with 60 more minutes shows 60 more minutes', () => {
    const row: LiveRow = {
      ...baseRow,
      state: 'WORKING',
      workedMinutes: 60,
      breakMinutes: 0,
      since: sinceOffset(30),
    };
    const later = NOW_MS + 60 * 60_000; // 60 minutes after NOW_MS
    const atNow = computeLiveWorkTime(row, NOW_MS);    // 60 + 30 = 90 → "1h 30m"
    const atLater = computeLiveWorkTime(row, later);    // 60 + 90 = 150 → "2h 30m"
    expect(atNow).toBe('1h 30m');
    expect(atLater).toBe('2h 30m');
  });

  it('does NOT add elapsed while on break', () => {
    const row: LiveRow = {
      ...baseRow,
      state: 'ON_BREAK',
      workedMinutes: 90,
      breakMinutes: 0,
      since: sinceOffset(15), // break started 15 min ago
    };
    // Work time should be 90 (frozen), not 90+15
    expect(computeLiveWorkTime(row, NOW_MS)).toBe('1h 30m');
  });

  it('returns "—" for NOT_IN', () => {
    const row: LiveRow = { ...baseRow, state: 'NOT_IN', displayGroup: 'notInNotYetDue', since: null, workedMinutes: 0 };
    expect(computeLiveWorkTime(row, NOW_MS)).toBe('—');
  });

  it('returns "—" for leave', () => {
    const row: LiveRow = { ...baseRow, dayGroup: 'leave', displayGroup: 'onLeave', workedMinutes: 0 };
    expect(computeLiveWorkTime(row, NOW_MS)).toBe('—');
  });
});

describe('computeLiveWorkTime — Bug #3: Punch Out persistence', () => {
  it('shows final workedMinutes after punch out (FINISHED), does not use live clock', () => {
    const row: LiveRow = {
      ...baseRow,
      state: 'FINISHED',
      displayGroup: 'finished',
      workedMinutes: 480, // 8h authoritative from backend
      breakMinutes: 30,
      since: sinceOffset(-5), // since = departure (5 minutes in the "future" from snapshot perspective)
      departureAt: sinceOffset(-5),
    };
    // Must show "8h" regardless of clock ticks
    expect(computeLiveWorkTime(row, NOW_MS)).toBe('8h');
    // Still "8h" even 2 hours later
    expect(computeLiveWorkTime(row, NOW_MS + 2 * 60 * 60_000)).toBe('8h');
  });

  it('shows "0m" for FINISHED with 0 workedMinutes (edge: immediate out)', () => {
    const row: LiveRow = {
      ...baseRow,
      state: 'FINISHED',
      displayGroup: 'finished',
      workedMinutes: 0,
      breakMinutes: 0,
      since: sinceOffset(0),
    };
    // 0 is a valid final value, should be "0m" not "—"
    expect(computeLiveWorkTime(row, NOW_MS)).toBe('0m');
  });
});

describe('computeLiveBreakTime — live break elapsed', () => {
  it('adds current break elapsed to accumulated breakMinutes when ON_BREAK', () => {
    const row: LiveRow = {
      ...baseRow,
      state: 'ON_BREAK',
      workedMinutes: 90,
      breakMinutes: 10, // prior completed break
      since: sinceOffset(20), // current break started 20 min ago
    };
    // Live break = 10 + 20 = 30m
    expect(computeLiveBreakTime(row, NOW_MS)).toBe('30m');
  });

  it('does NOT grow break time while WORKING', () => {
    const row: LiveRow = {
      ...baseRow,
      state: 'WORKING',
      workedMinutes: 90,
      breakMinutes: 15,
      since: sinceOffset(30),
    };
    expect(computeLiveBreakTime(row, NOW_MS)).toBe('15m');
  });

  it('shows final breakMinutes after FINISHED', () => {
    const row: LiveRow = {
      ...baseRow,
      state: 'FINISHED',
      displayGroup: 'finished',
      workedMinutes: 480,
      breakMinutes: 30,
      since: sinceOffset(-5),
    };
    expect(computeLiveBreakTime(row, NOW_MS)).toBe('30m');
    // Stable across clock ticks
    expect(computeLiveBreakTime(row, NOW_MS + 2 * 60 * 60_000)).toBe('30m');
  });

  it('shows "0m" for FINISHED with 0 breakMinutes', () => {
    const row: LiveRow = {
      ...baseRow,
      state: 'FINISHED',
      displayGroup: 'finished',
      workedMinutes: 480,
      breakMinutes: 0,
      since: sinceOffset(-5),
    };
    expect(computeLiveBreakTime(row, NOW_MS)).toBe('0m');
  });

  it('returns "—" for NOT_IN', () => {
    const row: LiveRow = { ...baseRow, state: 'NOT_IN', displayGroup: 'notInNotYetDue', since: null, breakMinutes: 0 };
    expect(computeLiveBreakTime(row, NOW_MS)).toBe('—');
  });
});

describe('getPunchIn', () => {
  it('returns "—" for NOT_IN', () => {
    expect(getPunchIn({ ...baseRow, state: 'NOT_IN', displayGroup: 'notInNotYetDue', since: null })).toBe('—');
  });

  it('uses arrivalAt when available', () => {
    const arrival = '2026-10-07T04:00:00.000Z';
    const result = getPunchIn({ ...baseRow, arrivalAt: arrival });
    expect(result).not.toBe('—');
  });

  it('returns "—" for leave', () => {
    expect(getPunchIn({ ...baseRow, dayGroup: 'leave', displayGroup: 'onLeave' })).toBe('—');
  });
});

describe('getPunchOut', () => {
  it('returns "—" for WORKING (no punch out yet)', () => {
    expect(getPunchOut({ ...baseRow, state: 'WORKING', departureAt: null, since: null })).toBe('—');
  });

  it('uses departureAt when available', () => {
    const departure = '2026-10-07T13:00:00.000Z';
    const result = getPunchOut({ ...baseRow, state: 'FINISHED', displayGroup: 'finished', departureAt: departure });
    expect(result).not.toBe('—');
  });

  it('uses since as punch-out time for FINISHED without departureAt', () => {
    const departure = '2026-10-07T13:00:00.000Z';
    const result = getPunchOut({
      ...baseRow,
      state: 'FINISHED',
      displayGroup: 'finished',
      departureAt: null,
      since: departure,
    });
    expect(result).not.toBe('—');
  });
});

describe('Legacy getWorkTime / getBreakTime (static, no clock)', () => {
  it('getWorkTime returns "—" for NOT_IN', () => {
    expect(getWorkTime({ ...baseRow, state: 'NOT_IN', displayGroup: 'notInNotYetDue', workedMinutes: 0 })).toBe('—');
  });

  it('getWorkTime shows "4h 32m" for workedMinutes=272', () => {
    expect(getWorkTime({ ...baseRow, workedMinutes: 272 })).toBe('4h 32m');
  });

  it('getWorkTime shows "—" for workedMinutes=0 and WORKING (no live clock)', () => {
    expect(getWorkTime({ ...baseRow, workedMinutes: 0 })).toBe('—');
  });

  it('getWorkTime shows "0m" for workedMinutes=0 and FINISHED', () => {
    expect(getWorkTime({ ...baseRow, state: 'FINISHED', displayGroup: 'finished', workedMinutes: 0 })).toBe('0m');
  });

  it('getBreakTime returns "—" for NOT_IN', () => {
    expect(getBreakTime({ ...baseRow, state: 'NOT_IN', displayGroup: 'notInNotYetDue', breakMinutes: 0 })).toBe('—');
  });

  it('getBreakTime shows "32m" for breakMinutes=32', () => {
    expect(getBreakTime({ ...baseRow, breakMinutes: 32 })).toBe('32m');
  });
});
