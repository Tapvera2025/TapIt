import { describe, expect, it } from 'vitest';
import {
  d,
  fixed,
  flexibleTemplate,
  inputs,
  template,
  version,
} from './fixtures.test-helpers.js';
import { departmentDefaultsFor, resolveShift } from './resolve.js';

const DAY = fixed('day', '09:00', '18:00');
const NIGHT = fixed('night', '20:00', '05:00');
const MORNING = fixed('morning', '06:00', '15:00');
const MONDAY = d('2026-09-28');

describe('SH-1 — one chain, highest precedence first (design §6.2)', () => {
  const everything = inputs({
    shiftList: [DAY, NIGHT, MORNING],
    overrides: [{ workDate: MONDAY, kind: 'shift', shiftId: 'morning' }],
    assignments: [
      template('day'),
      {
        kind: 'rotation',
        shiftId: null,
        rotationId: 'r1',
        effectiveFrom: d('2026-01-01'),
        effectiveTo: null,
      },
      {
        kind: 'permanent-flexible',
        shiftId: null,
        rotationId: null,
        effectiveFrom: d('2026-09-29'),
        effectiveTo: d('2026-09-30'),
      },
    ],
    rotations: new Map([
      [
        'r1',
        new Map([
          [1, 'night'],
          [2, 'night'],
          [3, null],
        ]),
      ],
    ]),
    flexibleRequests: [{ fromDate: d('2026-10-01'), toDate: d('2026-10-01') }],
    departmentDefaults: [
      { shiftId: 'morning', effectiveFrom: d('2026-01-01'), effectiveTo: null },
    ],
  });

  it('1: a date override wins over everything', () => {
    expect(resolveShift(everything, MONDAY)).toMatchObject({
      source: 'date-override',
      shiftId: 'morning',
      kind: 'fixed',
    });
  });

  it('2: permanent flexible hours come next, at 480 and 300 minutes (SH-4)', () => {
    expect(resolveShift(everything, d('2026-09-29'))).toMatchObject({
      source: 'permanent-flexible',
      kind: 'flexible',
      fullDayMinutes: 480,
      halfDayMinutes: 300,
    });
  });

  it('3: an approved flexible request beats the rotation', () => {
    expect(resolveShift(everything, d('2026-10-01'))).toMatchObject({
      source: 'flexible-request',
      kind: 'flexible',
    });
  });

  it("4: a rotation gives the weekday's template, or no shift that weekday", () => {
    expect(resolveShift(everything, d('2026-10-06'))).toMatchObject({
      source: 'rotation',
      shiftId: 'night',
    }); // Tuesday
    expect(resolveShift(everything, d('2026-09-30'))).toMatchObject({
      source: 'rotation',
      kind: 'none',
    }); // Wednesday
  });

  it('5: a template assignment, when nothing above applies', () => {
    const plain = inputs({ shiftList: [DAY], assignments: [template('day')] });
    expect(resolveShift(plain, MONDAY)).toMatchObject({
      source: 'template',
      shiftId: 'day',
      start: '09:00',
      end: '18:00',
    });
  });

  it('6: the department default, when the person has no assignment', () => {
    const plain = inputs({
      shiftList: [MORNING],
      departmentDefaults: [
        { shiftId: 'morning', effectiveFrom: d('2026-01-01'), effectiveTo: null },
      ],
    });
    expect(resolveShift(plain, MONDAY)).toMatchObject({
      source: 'department-default',
      shiftId: 'morning',
    });
  });

  it('7: nothing at all is kind none, recorded rather than evaluated', () => {
    expect(resolveShift(inputs(), MONDAY)).toMatchObject({
      source: 'none',
      kind: 'none',
      shiftId: null,
    });
  });
});

describe('SH-2 — a template edit never reaches back', () => {
  const edited = inputs({
    shiftList: [
      {
        id: 'day',
        kind: 'fixed',
        versions: [
          version('v1', '2026-01-01', '09:00', '18:00'),
          version('v2', '2026-10-01', '10:00', '19:00'),
        ],
      },
    ],
    assignments: [template('day')],
  });

  it('the day before the new version keeps the old times', () => {
    expect(resolveShift(edited, d('2026-09-30'))).toMatchObject({
      versionId: 'v1',
      start: '09:00',
    });
  });

  it('the new version applies from its date', () => {
    expect(resolveShift(edited, d('2026-10-01'))).toMatchObject({
      versionId: 'v2',
      start: '10:00',
    });
  });

  it('an assignment dated before the first version is no shift yet', () => {
    const early = inputs({
      shiftList: [fixed('day', '09:00', '18:00', '2026-10-01')],
      assignments: [template('day')],
    });
    expect(resolveShift(early, d('2026-09-30'))).toMatchObject({
      kind: 'none',
      shiftId: 'day',
    });
  });
});

describe('night shifts are ordinary shifts (§6.6)', () => {
  it('end before start is overnight', () => {
    const night = inputs({ shiftList: [NIGHT], assignments: [template('night')] });
    expect(resolveShift(night, MONDAY)).toMatchObject({
      kind: 'fixed',
      isOvernight: true,
      start: '20:00',
      end: '05:00',
    });
  });

  it('a flexible template resolves flexible at the SH-4 constants', () => {
    const flex = inputs({
      shiftList: [flexibleTemplate('flex')],
      assignments: [template('flex')],
    });
    expect(resolveShift(flex, MONDAY)).toMatchObject({
      kind: 'flexible',
      fullDayMinutes: 480,
      halfDayMinutes: 300,
    });
  });

  it('the closing extension comes from the version, else the dated setting, else null', () => {
    const withSetting = inputs({
      shiftList: [DAY],
      assignments: [template('day')],
      settings: [
        {
          effectiveFrom: d('2026-01-01'),
          dayStartTime: '00:00' as never,
          maxClosingExtensionMinutes: 240,
        },
      ],
    });
    expect(resolveShift(withSetting, MONDAY).maxClosingExtensionMinutes).toBe(240);
    expect(
      resolveShift(inputs({ shiftList: [DAY], assignments: [template('day')] }), MONDAY)
        .maxClosingExtensionMinutes,
    ).toBeNull();
  });
});

describe('attendance §8.1 — a day already built keeps its department after a transfer', () => {
  const rows = [
    {
      departmentId: 'ops',
      shiftId: 'day',
      effectiveFrom: d('2026-01-01'),
      effectiveTo: null,
    },
    {
      departmentId: 'sales',
      shiftId: 'night',
      effectiveFrom: d('2026-01-01'),
      effectiveTo: null,
    },
  ];

  it("with no recorded placements, today's department applies, as before", () => {
    expect(
      departmentDefaultsFor(rows, 'sales', undefined, d('2026-03-09'), d('2026-03-11')),
    ).toEqual([{ shiftId: 'night', effectiveFrom: d('2026-01-01'), effectiveTo: null }]);
  });

  it('a date whose day recorded another department resolves with that department', () => {
    const placements = new Map([[d('2026-03-10'), { departmentId: 'ops' }]]);
    const defaults = departmentDefaultsFor(
      rows,
      'sales',
      placements,
      d('2026-03-09'),
      d('2026-03-11'),
    );
    const person = inputs({ shiftList: [DAY, NIGHT], departmentDefaults: defaults });
    expect(resolveShift(person, d('2026-03-10'))).toMatchObject({
      source: 'department-default',
      shiftId: 'day',
    });
    expect(resolveShift(person, d('2026-03-11'))).toMatchObject({ shiftId: 'night' });
  });

  it('a day recorded with no department gets no department default', () => {
    const placements = new Map([[d('2026-03-10'), { departmentId: null }]]);
    expect(
      departmentDefaultsFor(rows, 'sales', placements, d('2026-03-10'), d('2026-03-10')),
    ).toEqual([]);
  });
});
