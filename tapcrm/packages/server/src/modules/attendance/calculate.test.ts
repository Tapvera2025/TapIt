import { describe, expect, it } from 'vitest';
import type { AttendanceEventInput, LocalTime, ResolvedShift } from '@tapcrm/contracts';
import {
  calculate,
  type CalculationInput,
  type CalculatedAttendance,
  type Overlay,
} from './calculate.js';
import { d, ist, punch } from './facts.test-helpers.js';

/** Shifts written as IST wall-clock times; thresholds are illustrative (Q1). */
function shift(
  start: string | null,
  end: string | null,
  extra: Partial<ResolvedShift> = {},
): ResolvedShift {
  return {
    date: d('2026-09-28'),
    source: 'template',
    shiftId: 'shift-1',
    versionId: 'version-1',
    kind: start === null ? 'flexible' : 'fixed',
    start: start as LocalTime | null,
    end: end as LocalTime | null,
    isOvernight: start !== null && end !== null && end < start,
    graceMinutes: 10,
    earlyExitGraceMinutes: 0,
    fullDayMinutes: 450,
    halfDayMinutes: 240,
    complementaryHalfMinutes: null,
    minOvertimeMinutes: 30,
    earlyWindowMinutes: 180,
    maxClosingExtensionMinutes: 240,
    timezone: 'Asia/Kolkata',
    ...extra,
  };
}

const DAY = shift('09:00', '18:00');
const NIGHT = shift('20:00', '05:00', {
  fullDayMinutes: 480,
  halfDayMinutes: 240,
  graceMinutes: 0,
});

function day(
  input: Partial<CalculationInput> & { events?: AttendanceEventInput[] },
): CalculatedAttendance {
  const shiftOf = input.shift ?? DAY;
  return calculate({
    workDate: d('2026-09-28'),
    shift: shiftOf,
    closingCap:
      shiftOf === NIGHT ? ist('2026-09-29T09:00:00') : ist('2026-09-28T22:00:00'),
    closed: true,
    dayType: 'working',
    employed: true,
    events: [],
    overlays: [],
    breaksPaid: true,
    nightWindow: null,
    attributionFlags: [],
    ...input,
  });
}

const at = (time: string) => `2026-09-28T${time}`;
const next = (time: string) => `2026-09-29T${time}`;
const workday = (from: string, to: string) => [
  punch('in', at(from)),
  punch('out', at(to)),
];
const overlay = (kind: Overlay['kind'], extra: Partial<Overlay> = {}): Overlay => ({
  kind,
  paid: kind.startsWith('leave') ? true : null,
  consequence: null,
  minutes: null,
  sourceId: `source-${kind}`,
  ...extra,
});
const units = (r: CalculatedAttendance) => [
  r.units.present,
  r.units.paidLeave,
  r.units.unpaidLeave,
  r.units.absent,
  r.units.holiday,
];

describe('§8.3 worked examples — status and units (present / paid leave / unpaid leave / absent / holiday)', () => {
  it('worked 9 h on a 09:00–18:00 shift → present', () => {
    const r = day({ events: workday('09:00:00', '18:00:00') });
    expect([r.status, ...units(r)]).toEqual(['present', 2, 0, 0, 0, 0]);
  });

  it('worked 30 minutes → absent', () => {
    const r = day({ events: workday('09:00:00', '09:30:00') });
    expect([r.status, ...units(r)]).toEqual(['absent', 0, 0, 0, 2, 0]);
  });

  it('worked between the half-day and full-day thresholds → half-day', () => {
    const r = day({ events: workday('09:00:00', '14:00:00') });
    expect([r.status, ...units(r)]).toEqual(['half-day', 1, 0, 0, 1, 0]);
  });

  it('first-half paid leave, then worked the afternoon → half-day-leave, present for the other half', () => {
    const r = day({
      events: workday('13:30:00', '18:00:00'),
      overlays: [overlay('leave-first-half')],
    });
    expect([r.status, ...units(r)]).toEqual(['half-day-leave', 1, 1, 0, 0, 0]);
  });

  it('first-half unpaid leave, no punch → half-day-leave, absent for the other half', () => {
    const r = day({ overlays: [overlay('leave-first-half', { paid: false })] });
    expect([r.status, ...units(r)]).toEqual(['half-day-leave', 0, 0, 1, 1, 0]);
  });

  it('first-half paid leave, but worked 20:00–00:30 of a night and left → the half split at 00:30 buys nothing', () => {
    const r = day({
      shift: NIGHT,
      events: [punch('in', at('20:00:00')), punch('out', next('00:30:00'))],
      overlays: [overlay('leave-first-half')],
    });
    expect([r.status, ...units(r)]).toEqual(['half-day-leave', 0, 1, 0, 1, 0]);
    expect(r.workedMinutes).toBe(270);
  });

  it('approved WFH, full day worked from home → present, and flagged WFH', () => {
    const r = day({
      events: workday('09:00:00', '18:00:00'),
      overlays: [overlay('wfh')],
    });
    expect([r.status, ...units(r)]).toEqual(['present', 2, 0, 0, 0, 0]);
    expect(r.isWfh).toBe(true);
  });

  it('approved WFH, never punched → absent (G16: the approval is not the work)', () => {
    const r = day({ overlays: [overlay('wfh')] });
    expect([r.status, ...units(r)]).toEqual(['absent', 0, 0, 0, 2, 0]);
  });

  it('Saturday week-off → holiday', () => {
    const r = day({ dayType: 'week-off' });
    expect([r.status, ...units(r)]).toEqual(['holiday', 0, 0, 0, 0, 2]);
  });
});

describe('AT-3 — holiday > full leave > half leave > worked ≥ full day > worked ≥ half day > absent', () => {
  const nineHours = workday('09:00:00', '18:00:00');

  it('a holiday beats leave, and work on it is flagged holiday-worked', () => {
    const r = day({
      dayType: 'holiday',
      events: nineHours,
      overlays: [overlay('leave-full')],
    });
    expect(r.status).toBe('holiday');
    expect(r.flags).toContain('holiday-worked');
  });

  it('full leave beats worked hours, and the punches are flagged punched-on-leave', () => {
    const r = day({
      events: nineHours,
      overlays: [overlay('leave-full', { paid: false })],
    });
    expect([r.status, ...units(r)]).toEqual(['leave', 0, 0, 2, 0, 0]);
    expect(r.flags).toContain('punched-on-leave');
  });

  it('half leave beats worked hours', () => {
    expect(
      day({ events: nineHours, overlays: [overlay('leave-second-half')] }).status,
    ).toBe('half-day-leave');
  });

  it('every evaluated day sums to two units; an undecided one to none', () => {
    const results = [
      day({ events: nineHours }),
      day({ events: workday('09:00:00', '13:30:00') }),
      day({ dayType: 'holiday' }),
      day({ overlays: [overlay('leave-second-half')] }),
      day({ closed: false, events: [punch('in', at('09:00:00'))] }),
      day({ shift: shift(null, null, { kind: 'none' }) }),
    ];
    for (const r of results) {
      const sum = units(r).reduce((a, b) => a + b, 0);
      expect(sum).toBe(r.status === null || r.status === 'not-evaluated' ? 0 : 2);
    }
  });
});

describe('§6.6 — a 20:00–05:00 night: midnight is not special', () => {
  it('arriving 20:14 is 14 minutes late; leaving 04:30 is 30 minutes early', () => {
    const r = day({
      shift: NIGHT,
      events: [punch('in', at('20:14:00')), punch('out', next('04:30:00'))],
    });
    expect(r.lateMinutes).toBe(14);
    expect(r.earlyExitMinutes).toBe(30);
  });

  it('staying until 06:10 is 70 minutes past the shift', () => {
    const r = day({
      shift: NIGHT,
      events: [punch('in', at('20:00:00')), punch('out', next('06:10:00'))],
    });
    expect(r.overtimeMinutes).toBe(70);
  });

  it('night minutes against a 22:00–06:00 window are 420, measured across midnight', () => {
    const r = day({
      shift: NIGHT,
      events: [punch('in', at('20:00:00')), punch('out', next('05:00:00'))],
      nightWindow: { from: '22:00' as LocalTime, to: '06:00' as LocalTime },
    });
    expect(r.nightMinutes).toBe(420);
  });

  it('overtime on an assumed departure is recorded but waits for review', () => {
    const autoOut = punch('auto-out', next('07:30:00'), { source: 'system' });
    const r = day({ shift: NIGHT, events: [punch('in', at('20:00:00')), autoOut] });
    expect(r.overtimeMinutes).toBe(150);
    expect(r.flags).toEqual(expect.arrayContaining(['overtime', 'overtime-unconfirmed']));
  });
});

describe('§8.2 — one reading of the day', () => {
  it('D31: a double exit swipe at 05:00 and 05:10 stops worked time at 05:00', () => {
    const r = day({
      shift: NIGHT,
      events: [
        punch('in', at('20:00:00')),
        punch('out', next('05:00:00')),
        punch('out', next('05:10:00')),
      ],
    });
    expect(r.departureAt).toBe(ist(next('05:00:00')).toISOString());
    expect(r.workedMinutes).toBe(540);
    expect(r.flags).toContain('activity-after-finish');
  });

  it('a 13:10 errand scan outside the window is flagged and never the arrival', () => {
    const r = day({
      events: [punch('scan', at('05:10:00')), ...workday('09:00:00', '18:00:00')],
    });
    expect(r.arrivalAt).toBe(ist(at('09:00:00')).toISOString());
    expect(r.flags).toContain('outside-shift-window');
  });

  it('D36: an arrival a correction added counts even outside the window', () => {
    const r = day({
      events: [
        punch('in', at('05:30:00'), { source: 'correction' }),
        punch('out', at('18:00:00')),
      ],
    });
    expect(r.arrivalAt).toBe(ist(at('05:30:00')).toISOString());
  });

  it('an out in the arrival’s own second is conflicting evidence, not a departure', () => {
    const r = day({
      closed: false,
      events: [punch('in', at('09:00:00')), punch('out', at('09:00:00'))],
    });
    expect(r.departureAt).toBeNull();
    expect(r.flags).toContain('same-instant-conflict');
  });

  it('D19: breaks are paid without a policy; unpaid when a policy says so', () => {
    const events = [
      ...workday('09:00:00', '18:00:00'),
      punch('break-start', at('13:00:00')),
      punch('break-end', at('13:45:00')),
    ];
    expect(day({ events }).workedMinutes).toBe(540);
    const unpaid = day({ events, breaksPaid: false });
    expect(unpaid.workedMinutes).toBe(495);
    expect(unpaid.breakMinutes).toBe(45);
  });
});

describe('days that are not judged, or not yet', () => {
  it('a day still in progress has no status yet', () => {
    const r = day({ closed: false, events: [punch('in', at('09:00:00'))] });
    expect(r.status).toBeNull();
  });

  it('a no-shift day records hours and is not evaluated', () => {
    const r = day({
      shift: shift(null, null, { kind: 'none' }),
      events: workday('09:00:00', '18:00:00'),
    });
    expect(r.status).toBe('not-evaluated');
    expect(r.workedMinutes).toBe(540);
  });

  it('overlapping shift windows leave the day unevaluated (§5.2)', () => {
    const r = day({
      events: workday('09:00:00', '18:00:00'),
      attributionFlags: ['shift-window-overlap'],
    });
    expect(r.status).toBe('not-evaluated');
  });

  it('a flexible day uses 480 and 300 minutes (SH-4), with no lateness', () => {
    const r = day({ shift: shift(null, null), events: workday('11:00:00', '16:30:00') });
    expect([r.status, r.lateMinutes]).toEqual(['half-day', 0]);
  });

  it('outside the employment window → not-employed', () => {
    expect(day({ employed: false, events: workday('09:00:00', '18:00:00') }).status).toBe(
      'not-employed',
    );
  });
});

describe('confirmed break consequences (BM-5, BM-14)', () => {
  const nineHours = workday('09:00:00', '18:00:00');

  it('mark-half-day caps a present day at one unit', () => {
    const r = day({
      events: nineHours,
      overlays: [overlay('breach-consequence', { consequence: 'mark-half-day' })],
    });
    expect([r.status, ...units(r)]).toEqual(['half-day', 1, 0, 0, 1, 0]);
  });

  it('a consequence on a leave day is recorded as superseded by the leave', () => {
    const r = day({
      overlays: [
        overlay('leave-full'),
        overlay('breach-consequence', { consequence: 'mark-absent' }),
      ],
    });
    expect(r.status).toBe('leave');
    expect(r.provenance['consequences']).toBe('superseded by leave');
  });
});

describe('WFH-6 and WFH-9', () => {
  it('a web arrival without an approved WFH day is flagged remote-without-approval', () => {
    expect(day({ events: workday('09:00:00', '18:00:00') }).flags).toContain(
      'remote-without-approval',
    );
  });

  it('a device scan on a WFH day clears the WFH flag', () => {
    const r = day({
      events: [punch('scan', at('09:00:00')), punch('out', at('18:00:00'))],
      overlays: [overlay('wfh')],
    });
    expect(r.isWfh).toBe(false);
  });
});
