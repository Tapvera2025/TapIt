# Step 3b — Attendance calculation: implementation plan

**Design.** `docs/superpowers/specs/2026-09-22-attendance-shifts-payroll-design.md`
§8.2 (the calculator), §8.3 (status precedence), §8.5 (recalculation), and the
month summary and placement snapshot in §8.1.
**Roadmap.** `docs/superpowers/plans/2026-09-25-attendance-roadmap.md`.
**Builds on.** Steps 0, 1, 2 and 3a, as they are in the working tree on `Archi`.

## What 3b adds

3a records punches and decides which day owns each one. 3b turns a day's
punches into its answer — status, units, worked minutes, lateness, early exit,
overtime, night minutes and flags — and keeps that answer up to date. Whenever
something a day depends on changes (a punch, a shift change, a holiday), the
day is recalculated in the background.

Two promises hold throughout:

- **A past day keeps its department.** Each day records the department the
  person was in when it was built. After a transfer, a later change to the old
  department still reaches the days built in it, and those days are judged
  with the old department's shifts and holidays, never the new one's (§8.1).
- **No change is lost.** Every step is written down before the next one
  starts. A failed step is tried again. If it keeps failing, it is flagged
  for a person, never dropped.

How the pieces fit:

```
a punch (3a)                               a shift or holiday change (steps 1, 2)
  │ bumps the day's input version            │ writes shifts.days-changed /
  │ and writes attendance.recalc-requested   │ holidays.days-changed
  ▼ (outbox, after commit)                   ▼ (outbox, after commit; retried until delivered)
attendance.recalculate                     one refresh request per person, written to a table,
  one job per day and input version          then attendance.refresh-days, one job per request:
  lock person → lock day → calculate         refreshes each day's facts (closed days too, with
  → store → rebuild the month summary  ◀──── the day's own department), re-attributes, and bumps
  ▲                                          every day that changed
  │
attendance.stale-sweeper, every 5 minutes: offers again every day stale for over a minute
and every refresh request still open after a minute, under its next generation; after the
third fails, the day or the request is flagged for a person
```

**Done when** — each proved by a named test:

| Check | Test |
|---|---|
| Every worked example of §8.3 | `calculate.test.ts` › "§8.3 worked examples" |
| The AT-3 order, named in the test title (AT-I5) | `calculate.test.ts` › "AT-3 — holiday > full leave > half leave > worked ≥ full day > worked ≥ half day > absent" |
| Two requests for one day give one calculation, and the month summary follows | `recalculate.integration.test.ts` › "calculates a punched day once for two requests, and rebuilds the month" |
| Recalculating twice changes nothing | › "leaves a day alone when its answer is already for its newest inputs" |
| A new input recalculates the day | › "recalculates when a new input arrives" |
| A past shift change reaches a closed day (SH-6) | › "a past shift change reaches the day through shifts.days-changed, even once it is closed" |
| A holiday reaches a worked day, and nothing else moves (HO-3) | › "a holiday declared on a worked day makes it a holiday flagged as worked, and nothing else moves" |
| After a transfer, the old department's holiday and shift change still reach the days built in it (§8.1) | › "§8.1: after a transfer, a change to the old department still reaches the days built in it" |
| Shift and holiday change events are never given up on | › "never gives up on the two events that carry shift and holiday changes", and `drainer.integration.test.ts` |
| A lost recalculation request is caught; three failed generations flag the day | › "the stale sweeper re-offers a day whose request was lost", "flags a day whose third generation failed, until a later input succeeds" |
| A lost refresh job is caught; three failed generations flag the request, and a person can run it again | › "the stale sweeper runs a refresh request whose job was lost", "a refresh request whose third generation failed waits for a person, and runs once re-armed" |

**How to use this plan.** Do the tasks in order. Each one writes its test
first, watches it fail, adds the code, then watches it pass. Nothing is
committed; each task ends with its changes left for review. All the code below
was run against a copy of the repository with steps 0–2 and 3a applied. Every
file this plan changes is identical in that copy and in the working tree on
`Archi`. Typecheck and `npm run ci` (17 checks) are clean, lint is clean on
every file this plan touches, and all 427 tests pass. The only test left out
is the one that already failed before any of this work. (`npm run lint` over
the whole repository still reports five errors that were there before this
plan — see "Found while planning".)

## Decisions made in this plan

| Question | Decision | Why |
|---|---|---|
| Which department a day is judged with | The department the day recorded when it was built, for every day already built, open or closed. Dates with no day yet use today's department | §8.1: "recalculation of a past day reads that snapshot, not the directory". The shift and holiday resolvers now take these recorded departments as an input, so both answer for the department the day belongs to |
| A transfer in the middle of a day | That day keeps the department it was built with; the transfer reaches the days built after it | One rule for every built day, so a day's answer never depends on when someone changed the directory |
| Whose days a change reaches | People whose days in reach were built with that department or shift, or everyone when the change names neither | The same recorded department the day is judged with, so the two cannot disagree |
| How far a change reaches | From the day before its first date to the day after its last | A day's closing edge depends on the next day's shift, and its opening edge on the previous day's (§5.2, §6.3) |
| How a shift or holiday change reaches days | The outbox handler writes one refresh request per person (a table), then queues one `attendance.refresh-days` job per request | Once the requests are written, the change cannot be lost: each one is open until its job completes it, and the sweeper offers open ones again. One person runs, fails and retries on their own |
| Delivery of `shifts.days-changed` and `holidays.days-changed` | Never given up on. After the usual ten attempts the drainer raises an alert (`outbox-event-overdue`) and keeps retrying every five minutes until the handler succeeds | Until its requests are written, the event is the only record of the change, and nothing else would notice it missing. A failed delivery changes nothing, so retrying it is safe. `attendance.recalc-requested` keeps the usual limit: the sweeper finds its days anyway |
| A refresh request whose job keeps failing | Offered again a day later, at most three generations in all (§5.4); then marked failed. The job runner alerts at each dead letter. A person runs it again by raising its `replays`, which gives it new keys | Like a stale day: bounded retries, then a person, and nothing forgotten. Payroll's open items (step 9) should list failed requests |
| Long ranges | Refreshed 31 days at a time, one transaction each | An open-ended change (a new template "from 1 March") would otherwise hold one person's lock across every day they have |
| When the sweeper counts work as stale | A day stale for more than a minute (a new `input_changed_at` column); a request still open a minute after it was written | §8.5 says "stale for more than a minute", but nothing recorded when a day went stale. The minute keeps the sweeper out of the normal path's way |
| `recalculation-failed` | Written into the day's `flags`. The next successful calculation rewrites `flags`, so it clears itself | §8.5: "flagged … until a later input succeeds". The day also stays stale, which keeps it out of a payroll snapshot |
| Which inputs a job calculates | The day's inputs as they are when the job runs, stored with that input version | An older job that runs after newer inputs arrived does the newer job's work; the newer job then finds the day current and stops. This is the §8.5 rule, from the other side |
| A working day that has started but has no departure yet | No status and no units until it has a departure or is closed | Judged at 11:00, every day in progress would read "absent" or "half-day". The live board (step 4) shows where people are right now |
| Employment window | Everyone is treated as employed on every date | `app_user` has no joining or leaving date yet (roadmap finding 6). The calculator already takes the answer as an input, so adding the dates later changes one line |
| Break pay | Breaks are paid | D19: with no break policy, break time is paid. Break policies come with step 8 |
| Half-day leave on a flexible day | The worked half needs 150 minutes | §8.3 splits a fixed shift at its midpoint and uses half the half-day threshold. A flexible day has no midpoint, and its half-day is 300 minutes (SH-4), so it needs half of that |
| `attendance.day-changed` (AT-9) | Not in 3b | It flags payslips in published payroll periods, which do not exist until step 9 |
| The `paidLeave` unit | Marked with a comment as a half-day count | The money check (CI-21) reads any `paid…: number` as money |

## Files

| File | What |
|---|---|
| `packages/contracts/src/people.ts` | `AttendanceStatus`; `PlacementOnDate` and `PlacementsByDate` |
| `modules/attendance/calculate.ts` (+ test) | The calculator: one reading of the day, minutes, shift facts, status and units in the AT-3 order, and flags |
| `migrations/0051_attendance_calculation.sql` | `attendance_month_summary`; `attendance_record.input_changed_at`; `attendance_refresh_request` |
| `platform/modules/people-privileges.integration.test.ts` | Pins what the app role may do to the two new tables |
| `modules/shifts/resolve.ts` (+ test), `repository.ts`, `facade.ts` | The department default follows each built day's recorded department |
| `modules/holidays/facade.ts`, `repository.ts` | Department holidays follow each built day's recorded department |
| `modules/attendance/ledger.ts`, `repository.ts` (+ integration test) | Recorded departments passed to both resolvers; closed days refreshed when a change asks; flags on days outside a pass kept; the overlap flag; the change time |
| `platform/outbox/registry.ts`, `drainer.ts` (+ integration test) | `retryUntilDelivered` for events that must never be given up on |
| `modules/attendance/calculation-repository.ts` | The SQL for recalculation, the month summary, refresh requests and the sweeper |
| `modules/attendance/recalculate.ts` (+ tests) | `recalculateRecord`, `requestRecalculation`, refresh requests, and the two sweeps |
| `modules/attendance/jobs.ts` | Three jobs and three outbox handlers |
| `modules/attendance/facade.ts`, `events.ts`, `modules/index.ts` | Export `requestRecalculation`; register the jobs |

(`platform/…` and `modules/…` are under `packages/server/src/`.)

---

## Task 1 — The calculator (§8.2, §8.3)

The calculator is pure: no clock, no database, no settings lookup (AT-I1).
Everything a day depends on arrives in its input, so replaying a day a year
later gives the same answer, and `RULES_VERSION` records which code produced
it. It reads the day through `readDay` (§5.3), the same reading attribution
uses, so the two cannot disagree about when a day began or ended.

- [ ] **Add the shared types** to `packages/contracts/src/people.ts`: the day's
  status, and the recorded department that Task 3 uses:

```diff
--- a/packages/contracts/src/people.ts
+++ b/packages/contracts/src/people.ts
@@ -114,3 +114,26 @@ export interface AttendanceEventInput {
   /** Why this day owns it (§8.1). */
   assignmentReason: AssignmentReason;
 }
+
+/** A day's status (§8.1, §8.3). `null` on a record means not decided yet. */
+export type AttendanceStatus =
+  | 'present'
+  | 'half-day'
+  | 'absent'
+  | 'leave'
+  | 'half-day-leave'
+  | 'holiday'
+  | 'not-evaluated'
+  | 'not-employed';
+
+/**
+ * Where a person sat on a date, as the day recorded it when it was built
+ * (attendance design §8.1). The directory keeps no history, so the shift and
+ * calendar resolvers use this, when given one for a date, instead of today's
+ * department.
+ */
+export interface PlacementOnDate {
+  readonly departmentId: string | null;
+}
+
+export type PlacementsByDate = ReadonlyMap<DateOnly, PlacementOnDate>;
```

- [ ] **Write the test** — `packages/server/src/modules/attendance/calculate.test.ts`.
  Every worked example of §8.3, the AT-3 order, the night-shift facts of §6.6,
  and the edge cases of §8.2:

```ts
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
```

- [ ] **Run it and watch it fail:** `npx vitest run packages/server/src/modules/attendance/calculate.test.ts`
  — expected: `Error: Failed to load url ./calculate.js … Does the file exist?`

- [ ] **Create** `packages/server/src/modules/attendance/calculate.ts`:

```ts
import type {
  AttendanceEventInput,
  AttendanceStatus,
  DateOnly,
  DayStep,
  LocalTime,
  ResolvedShift,
} from '@tapcrm/contracts';
import { compareEvents, readDay } from '@tapcrm/contracts';
import { addDays, instantAt } from '../../platform/time.js';

/**
 * The calculator — design §8.2 and §8.3 (AT-1, AT-3, AT-I1, AT-I5).
 *
 * Pure: no clock, no database, no configuration lookup. Everything a day
 * depends on is in its input, so replaying a day a year later gives the same
 * answer, and `RULES_VERSION` says which code produced it. It reads the day
 * through `readDay` (§5.3), the same reading attribution, auto-close and the
 * board use, so they cannot disagree about when a day began or ended.
 */

export const RULES_VERSION = 'attendance-rules/1';

/** SH-4: flexible days use fixed thresholds, not settings. */
const FLEXIBLE_FULL_DAY = 480;
const FLEXIBLE_HALF_DAY = 300;

export interface Overlay {
  readonly kind:
    | 'leave-full'
    | 'leave-first-half'
    | 'leave-second-half'
    | 'wfh'
    | 'breach-consequence';
  readonly paid: boolean | null;
  readonly consequence:
    'mark-late' | 'mark-half-day' | 'mark-absent' | 'deduct-minutes' | null;
  readonly minutes: number | null;
  /** The leave request or breach behind it (L8). */
  readonly sourceId: string;
}

export interface CalculationInput {
  readonly workDate: DateOnly;
  readonly shift: ResolvedShift;
  /** The record's close_due_at — the late edge of the eligibility window (§8.2 step 3). */
  readonly closingCap: Date;
  /** The record is closed: a day with no departure is then final, not in progress. */
  readonly closed: boolean;
  readonly dayType: 'working' | 'week-off' | 'holiday' | 'not-employed';
  /** Inside the employment window. Always true until employment dates exist. */
  readonly employed: boolean;
  /** The day's effective events (D28), as assigned to it. */
  readonly events: readonly AttendanceEventInput[];
  readonly overlays: readonly Overlay[];
  /** D19: with no break policy, break time is paid. */
  readonly breaksPaid: boolean;
  /** The organization's night window in force on the date (§6.6), or null. */
  readonly nightWindow: { readonly from: LocalTime; readonly to: LocalTime } | null;
  /** Flags attribution raised about this day (§5.2). */
  readonly attributionFlags: readonly string[];
}

/** Half-day units (D7): each day's add up to 2, or 0 when it is not judged. */
export interface Units {
  readonly present: number;
  readonly paidLeave: number; // a half-day count, not money (CI-21)
  readonly unpaidLeave: number;
  readonly absent: number;
  readonly holiday: number;
}

export interface CalculatedAttendance {
  readonly status: AttendanceStatus | null;
  readonly units: Units;
  readonly workedMinutes: number;
  readonly breakMinutes: number;
  readonly lateMinutes: number;
  readonly earlyExitMinutes: number;
  readonly overtimeMinutes: number;
  readonly nightMinutes: number;
  readonly arrivalAt: string | null;
  readonly departureAt: string | null;
  readonly isWfh: boolean;
  readonly flags: readonly string[];
  readonly provenance: Readonly<Record<string, unknown>>;
}

type Interval = readonly [number, number];

const NO_UNITS: Units = {
  present: 0,
  paidLeave: 0,
  unpaidLeave: 0,
  absent: 0,
  holiday: 0,
};
const toMinutes = (ms: number) => Math.floor(ms / 60_000);
const length = (intervals: readonly Interval[]) =>
  intervals.reduce((sum, [a, b]) => sum + Math.max(0, b - a), 0);

function intersect(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const [a0, a1] of a) {
    for (const [b0, b1] of b) {
      const from = Math.max(a0, b0);
      const to = Math.min(a1, b1);
      if (to > from) out.push([from, to]);
    }
  }
  return out;
}

function subtract(base: Interval, cuts: readonly Interval[]): Interval[] {
  let pieces: Interval[] = [base];
  for (const [c0, c1] of cuts) {
    pieces = pieces.flatMap(([p0, p1]): Interval[] => {
      if (c1 <= p0 || c0 >= p1) return [[p0, p1]];
      return [
        ...(c0 > p0 ? [[p0, c0] as Interval] : []),
        ...(c1 < p1 ? [[c1, p1] as Interval] : []),
      ];
    });
  }
  return pieces;
}

/** The night window on every date the day's work can span (§6.6). */
function nightIntervals(input: CalculationInput): Interval[] {
  const window = input.nightWindow;
  if (window === null) return [];
  const zone = input.shift.timezone;
  const out: Interval[] = [];
  for (const offset of [-1, 0, 1]) {
    const date = addDays(input.workDate, offset);
    const from = instantAt(date, window.from, zone).getTime();
    const to = instantAt(
      window.to <= window.from ? addDays(date, 1) : date,
      window.to,
      zone,
    ).getTime();
    out.push([from, to]);
  }
  return out;
}

const NOT_APPLIED_FLAGS: Readonly<Record<string, string>> = {
  'outside-window': 'outside-shift-window',
  'after-departure': 'activity-after-finish',
  'at-arrival-instant': 'same-instant-conflict',
};

export function calculate(input: CalculationInput): CalculatedAttendance {
  const flags = new Set<string>(input.attributionFlags);
  const events = [...input.events].sort(compareEvents);
  const provenance: Record<string, unknown> = {
    rulesVersion: RULES_VERSION,
    shiftSource: input.shift.source,
    shiftId: input.shift.shiftId,
    versionId: input.shift.versionId,
    eventIds: events.map((event) => event.id),
    overlayIds: input.overlays.map((overlay) => overlay.sourceId),
  };
  const finish = (
    result: Omit<CalculatedAttendance, 'flags' | 'provenance'>,
  ): CalculatedAttendance => ({
    ...result,
    flags: [...flags].sort(),
    provenance,
  });
  const empty = {
    workedMinutes: 0,
    breakMinutes: 0,
    lateMinutes: 0,
    earlyExitMinutes: 0,
    overtimeMinutes: 0,
    nightMinutes: 0,
    arrivalAt: null,
    departureAt: null,
    isWfh: false,
  };

  // 1. Employment.
  if (!input.employed || input.dayType === 'not-employed') {
    return finish({ ...empty, status: 'not-employed', units: NO_UNITS });
  }

  // 2–3. Effective events, and the eligibility window: [start − early window, closingCap].
  const fixed =
    input.shift.kind === 'fixed' &&
    input.shift.start !== null &&
    input.shift.end !== null;
  const zone = input.shift.timezone;
  const shiftStart = fixed
    ? instantAt(input.workDate, input.shift.start!, zone).getTime()
    : null;
  const shiftEnd = fixed
    ? instantAt(
        input.shift.isOvernight ? addDays(input.workDate, 1) : input.workDate,
        input.shift.end!,
        zone,
      ).getTime()
    : null;
  const eligibility =
    shiftStart === null
      ? null
      : {
          from: new Date(
            shiftStart - input.shift.earlyWindowMinutes * 60_000,
          ).toISOString(),
          to: input.closingCap.toISOString(),
        };
  provenance['eligibility'] = eligibility;

  // 4–5. One reading of the day: arrival, departure, breaks (D31, D32).
  const reading = readDay(events, eligibility);
  for (const [eventId, why] of reading.notApplied) {
    const kind = events.find((event) => event.id === eventId)?.kind;
    if (why === 'before-arrival' && (kind === 'out' || kind === 'auto-out'))
      flags.add('departure-without-arrival');
    const flag = NOT_APPLIED_FLAGS[why];
    if (flag !== undefined) flags.add(flag);
  }
  const arrival: DayStep | null = reading.arrival;
  const departure: DayStep | null = reading.departure;

  // 6. Minutes: the worked stretches, less unpaid breaks.
  let stretches: Interval[] = [];
  let breakMinutes = 0;
  if (arrival !== null && departure !== null) {
    const end = Date.parse(departure.at);
    const breaks: Interval[] = reading.breaks.map((b) => [
      Date.parse(b.from),
      b.to === null ? end : Date.parse(b.to),
    ]);
    breakMinutes = toMinutes(length(breaks));
    const base: Interval = [Date.parse(arrival.at), end];
    stretches = input.breaksPaid ? [base] : subtract(base, breaks);
    // An undirected scan while on break ends it, as an assumption (§8.2 step 5).
    const scans = new Set(
      events.filter((e) => e.kind === 'scan').map((e) => Date.parse(e.at)),
    );
    if (reading.breaks.some((b) => b.to !== null && scans.has(Date.parse(b.to))))
      flags.add('break-ended-by-scan');
  } else if (arrival !== null && input.closed) {
    flags.add('missing-punch-out');
  }
  const workedMinutes = toMinutes(length(stretches));
  const nightMinutes = toMinutes(length(intersect(stretches, nightIntervals(input))));

  // WFH is a flag, never a status (AT-12b); a device scan clears it (WFH-9).
  const wfh = input.overlays.some((overlay) => overlay.kind === 'wfh');
  const isWfh = wfh && !events.some((event) => event.source === 'device');
  if (isWfh) flags.add('wfh');
  if (
    !wfh &&
    arrival !== null &&
    events.some(
      (e) =>
        arrival.eventIds.includes(e.id) && (e.source === 'web' || e.source === 'mobile'),
    )
  ) {
    flags.add('remote-without-approval'); // WFH-6
  }

  // 7. Shift facts, fixed shifts on working days only.
  let lateMinutes = 0;
  let earlyExitMinutes = 0;
  let overtimeMinutes = 0;
  if (
    shiftStart !== null &&
    shiftEnd !== null &&
    arrival !== null &&
    departure !== null &&
    input.dayType === 'working'
  ) {
    lateMinutes = Math.max(
      0,
      toMinutes(
        Date.parse(arrival.at) - (shiftStart + input.shift.graceMinutes * 60_000),
      ),
    );
    earlyExitMinutes = Math.max(
      0,
      toMinutes(
        shiftEnd - input.shift.earlyExitGraceMinutes * 60_000 - Date.parse(departure.at),
      ),
    );
    const extra = workedMinutes - toMinutes(shiftEnd - shiftStart);
    const minimum = input.shift.minOvertimeMinutes;
    if (minimum !== null && extra > 0 && extra >= minimum) overtimeMinutes = extra;
    if (lateMinutes > 0) flags.add('late');
    if (earlyExitMinutes > 0) flags.add('early-exit');
    if (overtimeMinutes > 0) {
      flags.add('overtime');
      // Recorded but not credited while it rests on an assumed departure (§8.2 step 7).
      if (departure.evidence === 'assumed') flags.add('overtime-unconfirmed');
    }
  }

  const minutes = {
    workedMinutes,
    breakMinutes,
    lateMinutes,
    earlyExitMinutes,
    overtimeMinutes,
    nightMinutes,
    arrivalAt: arrival?.at ?? null,
    departureAt: departure?.at ?? null,
    isWfh,
  };
  const leave = (paid: boolean | null, units: number) =>
    paid === false
      ? { paidLeave: 0, unpaidLeave: units }
      : { paidLeave: units, unpaidLeave: 0 };
  const consequences = input.overlays.filter(
    (overlay) => overlay.kind === 'breach-consequence',
  );

  // 8. Status and units, by the fixed precedence of AT-3.
  // 1. Holiday or week-off.
  if (input.dayType === 'holiday' || input.dayType === 'week-off') {
    if (arrival !== null) flags.add('holiday-worked');
    if (consequences.length > 0) provenance['consequences'] = 'superseded by holiday';
    return finish({ ...minutes, status: 'holiday', units: { ...NO_UNITS, holiday: 2 } });
  }
  // 2. Approved full-day leave.
  const fullLeave = input.overlays.find((overlay) => overlay.kind === 'leave-full');
  if (fullLeave !== undefined) {
    if (arrival !== null) flags.add('punched-on-leave');
    if (consequences.length > 0) provenance['consequences'] = 'superseded by leave'; // BM-14
    return finish({
      ...minutes,
      status: 'leave',
      units: { ...NO_UNITS, ...leave(fullLeave.paid, 2) },
    });
  }
  // Nothing more to judge without fixed times: a no-shift day records hours only.
  if (input.shift.kind === 'none' || flags.has('shift-window-overlap')) {
    return finish({ ...minutes, status: 'not-evaluated', units: NO_UNITS });
  }
  // 3. Approved half-day leave: the other half is judged on its own (§8.3).
  const halfLeave = input.overlays.find(
    (o) => o.kind === 'leave-first-half' || o.kind === 'leave-second-half',
  );
  if (halfLeave !== undefined) {
    if (consequences.length > 0) provenance['consequences'] = 'superseded by leave';
    if (!input.closed && departure === null)
      return finish({ ...minutes, status: null, units: NO_UNITS });
    let workedForPresence = workedMinutes;
    let threshold = Math.floor(FLEXIBLE_HALF_DAY / 2);
    if (shiftStart !== null && shiftEnd !== null) {
      const split = shiftStart + (shiftEnd - shiftStart) / 2;
      const complement: Interval =
        halfLeave.kind === 'leave-first-half' ? [split, shiftEnd] : [shiftStart, split];
      workedForPresence = toMinutes(length(intersect(stretches, [complement])));
      threshold =
        input.shift.complementaryHalfMinutes ??
        Math.floor((input.shift.halfDayMinutes ?? 0) / 2);
    }
    const present = workedForPresence >= threshold ? 1 : 0;
    return finish({
      ...minutes,
      status: 'half-day-leave',
      units: { ...NO_UNITS, ...leave(halfLeave.paid, 1), present, absent: 1 - present },
    });
  }
  // A working day still in progress is not judged until it has a departure or is closed.
  if (!input.closed && departure === null)
    return finish({ ...minutes, status: null, units: NO_UNITS });

  // 4–6. Worked time against the day's thresholds, less confirmed deductions.
  const deducted = consequences
    .filter((overlay) => overlay.consequence === 'deduct-minutes')
    .reduce((sum, overlay) => sum + (overlay.minutes ?? 0), 0);
  const effective = Math.max(0, workedMinutes - deducted);
  const fullDay =
    input.shift.kind === 'flexible'
      ? FLEXIBLE_FULL_DAY
      : (input.shift.fullDayMinutes ?? Infinity);
  const halfDay =
    input.shift.kind === 'flexible'
      ? FLEXIBLE_HALF_DAY
      : (input.shift.halfDayMinutes ?? Infinity);
  let present = effective >= fullDay ? 2 : effective >= halfDay ? 1 : 0;
  if (consequences.some((overlay) => overlay.consequence === 'mark-half-day'))
    present = Math.min(present, 1);
  if (consequences.some((overlay) => overlay.consequence === 'mark-absent')) present = 0;
  if (consequences.some((overlay) => overlay.consequence === 'mark-late'))
    flags.add('late');
  const status: AttendanceStatus =
    present === 2 ? 'present' : present === 1 ? 'half-day' : 'absent';
  return finish({
    ...minutes,
    workedMinutes: effective,
    status,
    units: { ...NO_UNITS, present, absent: 2 - present },
  });
}
```

- [ ] **Run the test again.** Expected: `Tests  31 passed (31)`.

Checkpoint: leave the changes in the working tree for review.

---

## Task 2 — Migration 0051: the month summary, the change time, refresh requests

- **The month summary** is derived: rebuilt from the month's days in the same
  transaction as each recalculation, so it can always be rebuilt from scratch.
  Monthly screens read it instead of adding up days.
- **`input_changed_at`** says when a day's inputs last changed, so the sweeper
  can leave alone a day the normal path is still working on.
- **`attendance_refresh_request`** holds one person's share of a shift or
  holiday change until it is done (Task 6).

Neither new table is ever deleted from, so the app role loses `DELETE`, the
same way as in 0049 and 0050.

- [ ] **Pin the privileges** —
  `packages/server/src/platform/modules/people-privileges.integration.test.ts`:

```diff
--- a/packages/server/src/platform/modules/people-privileges.integration.test.ts
+++ b/packages/server/src/platform/modules/people-privileges.integration.test.ts
@@ -33,6 +33,8 @@ const EXPECTED: Record<string, string> = {
   arrival_policy_override: 'INSERT,SELECT,UPDATE',
   arrival_exception: 'INSERT,SELECT',
   attendance_day_open_state: 'INSERT,SELECT,UPDATE',
+  attendance_month_summary: 'INSERT,SELECT,UPDATE',
+  attendance_refresh_request: 'INSERT,SELECT,UPDATE',
 };
 
 describe.skipIf(!enabled)('People table privileges for the app role (PostgreSQL)', () => {
```

- [ ] **Run it and watch it fail** (integration variables set):
  `npx vitest run packages/server/src/platform/modules/people-privileges.integration.test.ts`
  — expected: the diff shows `attendance_month_summary` and
  `attendance_refresh_request` missing.

- [ ] **Create** `migrations/0051_attendance_calculation.sql`:

```sql
-- =====================================================================
-- 0051 - Attendance calculation (attendance design, step 3b, §8.1, §8.5)
--
-- 1. attendance_month_summary: one row per person per month, derived from
--    attendance_record in the same transaction as each recalculation, and
--    rebuildable at any time. Monthly screens read it, which keeps them inside
--    their time budget. There is no night-day count: what makes a night is
--    payroll's threshold (§6.6).
-- 2. attendance_record.input_changed_at: when the day's inputs last changed.
--    The stale sweeper re-queues a day only after it has been stale for a
--    minute (§8.5), so it does not race the normal path.
-- 3. attendance_refresh_request: one person's share of a shift or holiday
--    change. The outbox handler writes it, the refresh job completes it, and
--    the sweeper offers it again until it is done (§5.4 generations). From
--    the moment it is written, the change cannot be lost.
-- =====================================================================

CREATE TABLE attendance_month_summary (
  organization_id     uuid NOT NULL REFERENCES organization(id),
  user_id             uuid NOT NULL,
  month               date NOT NULL CHECK (extract(day FROM month) = 1),
  days                integer NOT NULL DEFAULT 0,
  present_units       integer NOT NULL DEFAULT 0,
  paid_leave_units    integer NOT NULL DEFAULT 0,
  unpaid_leave_units  integer NOT NULL DEFAULT 0,
  absent_units        integer NOT NULL DEFAULT 0,
  holiday_units       integer NOT NULL DEFAULT 0,
  worked_minutes      integer NOT NULL DEFAULT 0,
  late_days           integer NOT NULL DEFAULT 0,
  late_minutes        integer NOT NULL DEFAULT 0,
  overtime_minutes    integer NOT NULL DEFAULT 0,
  night_minutes       integer NOT NULL DEFAULT 0,
  wfh_days            integer NOT NULL DEFAULT 0,
  open_days           integer NOT NULL DEFAULT 0,
  not_evaluated_days  integer NOT NULL DEFAULT 0,
  stale_days          integer NOT NULL DEFAULT 0,        -- recalculation pending
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id, month),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id)
);

SELECT apply_tenant_rls('attendance_month_summary');

-- Migration 0001 grants everything by default; a summary is rewritten, never removed.
REVOKE DELETE ON attendance_month_summary FROM tapcrm_app;

ALTER TABLE attendance_record ADD COLUMN input_changed_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE attendance_refresh_request (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  source_event_id  uuid NOT NULL,                 -- the domain_outbox row that asked
  from_date        date NOT NULL,
  to_date          date,                          -- inclusive; NULL for no end
  requested_at     timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  failed_at        timestamptz,                   -- the third generation failed: a person must look
  replays          integer NOT NULL DEFAULT 0,    -- raised by a person to run a failed request again
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, source_event_id, user_id),  -- a second delivery adds nothing
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  CHECK (to_date IS NULL OR to_date >= from_date),
  CHECK (completed_at IS NULL OR failed_at IS NULL)
);
CREATE INDEX ix_attendance_refresh_pending ON attendance_refresh_request (organization_id, id)
  WHERE completed_at IS NULL AND failed_at IS NULL;

SELECT apply_tenant_rls('attendance_refresh_request');

-- A request is completed or failed, never removed.
REVOKE DELETE ON attendance_refresh_request FROM tapcrm_app;
```

- [ ] **Migrate and run the test again:**

```bash
npm run migrate
psql "$MIGRATION_DATABASE_URL" -c "ALTER ROLE tapcrm_app LOGIN PASSWORD 'app_test_password';"
npx vitest run packages/server/src/platform/modules/people-privileges.integration.test.ts
npm run ci
```

Expected: `Tests  1 passed (1)`, and `✓ CI-33  RLS on all 52 tenant-owned tables`.

Checkpoint: leave the changes in the working tree for review.

---

## Task 3 — Shifts and holidays: judge a built day with its own department (§8.1)

The directory keeps no history: `app_user.department_id` is only where a
person sits *today*. Both resolvers read it, so after a transfer a refreshed
past day would pick up the new department's default shift and holidays. Each
day already stores the department it was built with (`placement_snapshot`),
so both resolvers now accept those recorded departments, date by date, and
use them instead of today's. Dates without a recorded department behave
exactly as before.

- **Shifts.** A small pure function, `departmentDefaultsFor`, turns the
  department defaults into the rows the person's chain should see: today's
  rows unchanged when nothing is recorded, otherwise one row per date, from
  that date's department. The resolution chain itself does not change.
- **Holidays.** `dayTypeRange` judges each date with its recorded department,
  and passes the recorded departments on when it resolves shifts for
  shift-scoped holidays.

- [ ] **Write the test** — add to `packages/server/src/modules/shifts/resolve.test.ts`:

```diff
--- a/packages/server/src/modules/shifts/resolve.test.ts
+++ b/packages/server/src/modules/shifts/resolve.test.ts
@@ -7,7 +7,7 @@ import {
   template,
   version,
 } from './fixtures.test-helpers.js';
-import { resolveShift } from './resolve.js';
+import { departmentDefaultsFor, resolveShift } from './resolve.js';
 
 const DAY = fixed('day', '09:00', '18:00');
 const NIGHT = fixed('night', '20:00', '05:00');
@@ -201,3 +201,50 @@ describe('night shifts are ordinary shifts (§6.6)', () => {
     ).toBeNull();
   });
 });
+
+describe('attendance §8.1 — a day already built keeps its department after a transfer', () => {
+  const rows = [
+    {
+      departmentId: 'ops',
+      shiftId: 'day',
+      effectiveFrom: d('2026-01-01'),
+      effectiveTo: null,
+    },
+    {
+      departmentId: 'sales',
+      shiftId: 'night',
+      effectiveFrom: d('2026-01-01'),
+      effectiveTo: null,
+    },
+  ];
+
+  it("with no recorded placements, today's department applies, as before", () => {
+    expect(
+      departmentDefaultsFor(rows, 'sales', undefined, d('2026-03-09'), d('2026-03-11')),
+    ).toEqual([{ shiftId: 'night', effectiveFrom: d('2026-01-01'), effectiveTo: null }]);
+  });
+
+  it('a date whose day recorded another department resolves with that department', () => {
+    const placements = new Map([[d('2026-03-10'), { departmentId: 'ops' }]]);
+    const defaults = departmentDefaultsFor(
+      rows,
+      'sales',
+      placements,
+      d('2026-03-09'),
+      d('2026-03-11'),
+    );
+    const person = inputs({ shiftList: [DAY, NIGHT], departmentDefaults: defaults });
+    expect(resolveShift(person, d('2026-03-10'))).toMatchObject({
+      source: 'department-default',
+      shiftId: 'day',
+    });
+    expect(resolveShift(person, d('2026-03-11'))).toMatchObject({ shiftId: 'night' });
+  });
+
+  it('a day recorded with no department gets no department default', () => {
+    const placements = new Map([[d('2026-03-10'), { departmentId: null }]]);
+    expect(
+      departmentDefaultsFor(rows, 'sales', placements, d('2026-03-10'), d('2026-03-10')),
+    ).toEqual([]);
+  });
+});
```

- [ ] **Run it and watch it fail:** `npx vitest run packages/server/src/modules/shifts/resolve.test.ts`
  — expected: `Tests  3 failed | 13 passed (16)`, with
  `TypeError: departmentDefaultsFor is not a function`.

- [ ] **Change** `packages/server/src/modules/shifts/resolve.ts`:

```diff
--- a/packages/server/src/modules/shifts/resolve.ts
+++ b/packages/server/src/modules/shifts/resolve.ts
@@ -1,5 +1,11 @@
-import type { DateOnly, LocalTime, ResolvedShift, ShiftSource } from '@tapcrm/contracts';
-import { weekdayOf } from '../../platform/time.js';
+import type {
+  DateOnly,
+  LocalTime,
+  PlacementsByDate,
+  ResolvedShift,
+  ShiftSource,
+} from '@tapcrm/contracts';
+import { addDays, weekdayOf } from '../../platform/time.js';
 
 /**
  * SH-1 — which shift applied to a person on a date, and why (design §6.2).
@@ -69,6 +75,11 @@ export interface DepartmentDefaultInput extends Dated {
   readonly shiftId: string;
 }
 
+/** A department default as the repository reads it, for more than one department. */
+export interface DepartmentDefaultRow extends DepartmentDefaultInput {
+  readonly departmentId: string;
+}
+
 export interface ShiftSettingInput {
   readonly effectiveFrom: DateOnly;
   readonly dayStartTime: LocalTime;
@@ -91,6 +102,44 @@ export interface ShiftInputs {
 const covers = (row: Dated, date: DateOnly): boolean =>
   row.effectiveFrom <= date && (row.effectiveTo === null || date < row.effectiveTo);
 
+/**
+ * The department defaults one person's chain sees (step 6). A date whose day
+ * attendance already built uses the department that day recorded (attendance
+ * design §8.1); every other date uses today's. With no recorded placements
+ * this is today's rows, unchanged. Otherwise it is one row per date, so the
+ * chain below needs no change.
+ */
+export function departmentDefaultsFor(
+  rows: readonly DepartmentDefaultRow[],
+  today: string | null,
+  placements: PlacementsByDate | undefined,
+  first: DateOnly,
+  last: DateOnly,
+): DepartmentDefaultInput[] {
+  if (placements === undefined || placements.size === 0) {
+    return rows
+      .filter((row) => row.departmentId === today)
+      .map(({ shiftId, effectiveFrom, effectiveTo }) => ({
+        shiftId,
+        effectiveFrom,
+        effectiveTo,
+      }));
+  }
+  const out: DepartmentDefaultInput[] = [];
+  for (let date = first; date <= last; date = addDays(date, 1)) {
+    const placement = placements.get(date);
+    const department = placement === undefined ? today : placement.departmentId;
+    const row = rows.find((r) => r.departmentId === department && covers(r, date));
+    if (row !== undefined)
+      out.push({
+        shiftId: row.shiftId,
+        effectiveFrom: date,
+        effectiveTo: addDays(date, 1),
+      });
+  }
+  return out;
+}
+
 /** The latest dated row in force on `date`, or undefined. */
 export function inForce<T extends { readonly effectiveFrom: DateOnly }>(
   rows: readonly T[],
```

- [ ] **Change** `packages/server/src/modules/shifts/repository.ts`:

```diff
--- a/packages/server/src/modules/shifts/repository.ts
+++ b/packages/server/src/modules/shifts/repository.ts
@@ -1,18 +1,19 @@
 import type { SqlFragment } from '@tapcrm/authz';
-import type { DateOnly, LocalTime } from '@tapcrm/contracts';
+import type { DateOnly, LocalTime, PlacementsByDate } from '@tapcrm/contracts';
 import type { Tx } from '../../platform/dal/db.js';
 import { sql } from '../../platform/dal/sql.js';
 import { organizationTimezone } from '../../platform/organization-time.js';
 import { addDays } from '../../platform/time.js';
-import type {
-  AssignmentInput,
-  DepartmentDefaultInput,
-  FlexibleRequestInput,
-  OverrideInput,
-  ShiftInput,
-  ShiftInputs,
-  ShiftSettingInput,
-  ShiftVersionInput,
+import {
+  departmentDefaultsFor,
+  type AssignmentInput,
+  type DepartmentDefaultRow,
+  type FlexibleRequestInput,
+  type OverrideInput,
+  type ShiftInput,
+  type ShiftInputs,
+  type ShiftSettingInput,
+  type ShiftVersionInput,
 } from './resolve.js';
 
 /**
@@ -79,16 +80,25 @@ async function loadRotations(tx: Tx): Promise<Map<string, Map<number, string | n
   return rotations;
 }
 
-/** Everything the resolver and the windows need for one person, `from` to `to` inclusive. */
+/**
+ * Everything the resolver and the windows need for one person, `from` to `to`
+ * inclusive. `placements` are the departments recorded by days attendance has
+ * already built; those dates resolve with them (see `departmentDefaultsFor`).
+ */
 export async function loadShiftInputs(
   tx: Tx,
   userId: string,
   from: DateOnly,
   to: DateOnly,
+  placements?: PlacementsByDate,
 ): Promise<ShiftInputs> {
   const first = addDays(from, -MARGIN_DAYS);
   const last = addDays(to, MARGIN_DAYS);
   const subject = await findSubject(tx, userId);
+  const today = subject?.departmentId ?? null;
+  const departmentIds = [
+    ...new Set([today, ...[...(placements?.values() ?? [])].map((p) => p.departmentId)]),
+  ].filter((id): id is string => id !== null);
   const [
     timezone,
     shifts,
@@ -117,12 +127,13 @@ export async function loadShiftInputs(
         WHERE user_id = ${userId} AND kind = 'flexible' AND status = 'approved'
           AND from_date <= ${last} AND to_date >= ${first}
       `),
-    subject?.departmentId == null
-      ? Promise.resolve([] as DepartmentDefaultInput[])
-      : tx.query<DepartmentDefaultInput>(sql`
-            SELECT shift_id, effective_from::text AS effective_from, effective_to::text AS effective_to
+    departmentIds.length === 0
+      ? Promise.resolve([] as DepartmentDefaultRow[])
+      : tx.query<DepartmentDefaultRow>(sql`
+            SELECT department_id, shift_id, effective_from::text AS effective_from,
+                   effective_to::text AS effective_to
             FROM department_shift_default
-            WHERE department_id = ${subject.departmentId} AND effective_from <= ${last}
+            WHERE department_id = ANY(${departmentIds}::uuid[]) AND effective_from <= ${last}
               AND (effective_to IS NULL OR effective_to > ${first})
           `),
     tx.query<ShiftSettingInput>(sql`
@@ -138,7 +149,13 @@ export async function loadShiftInputs(
     overrides,
     assignments,
     flexibleRequests,
-    departmentDefaults,
+    departmentDefaults: departmentDefaultsFor(
+      departmentDefaults,
+      today,
+      placements,
+      first,
+      last,
+    ),
     settings,
   };
 }
```

- [ ] **Change** `packages/server/src/modules/shifts/facade.ts`:

```diff
--- a/packages/server/src/modules/shifts/facade.ts
+++ b/packages/server/src/modules/shifts/facade.ts
@@ -6,7 +6,7 @@
  * Geometry only: which shift applied and where a day's window lies. Which day
  * an event belongs to is attendance's `attributeEvent` (§5.2).
  */
-import type { DateOnly, ResolvedShift } from '@tapcrm/contracts';
+import type { DateOnly, PlacementsByDate, ResolvedShift } from '@tapcrm/contracts';
 import type { Tx } from '../../platform/dal/db.js';
 import { addDays, localDateOf } from '../../platform/time.js';
 import { findShift, loadShiftInputs } from './repository.js';
@@ -38,14 +38,24 @@ export async function resolve(
   return resolveShift(await loadShiftInputs(tx, userId, date, date), date);
 }
 
+export interface RangeOptions {
+  /**
+   * The department each already-built day recorded (attendance design §8.1).
+   * Those dates resolve with it instead of today's department, so a past day
+   * keeps its department after a transfer.
+   */
+  readonly placements?: PlacementsByDate;
+}
+
 /** SH-1 for every date from `from` to `to`, inclusive, with one read. */
 export async function resolveRange(
   tx: Tx,
   userId: string,
   from: DateOnly,
   to: DateOnly,
+  options: RangeOptions = {},
 ): Promise<ResolvedShift[]> {
-  const inputs = await loadShiftInputs(tx, userId, from, to);
+  const inputs = await loadShiftInputs(tx, userId, from, to, options.placements);
   const days: ResolvedShift[] = [];
   for (let date = from; date <= to; date = addDays(date, 1))
     days.push(resolveShift(inputs, date));
@@ -97,8 +107,9 @@ export async function shiftDays(
   userId: string,
   from: DateOnly,
   to: DateOnly,
+  options: RangeOptions = {},
 ): Promise<ShiftDay[]> {
-  const inputs = await loadShiftInputs(tx, userId, from, to);
+  const inputs = await loadShiftInputs(tx, userId, from, to, options.placements);
   const days: ShiftDay[] = [];
   for (let date = from; date <= to; date = addDays(date, 1)) {
     days.push({ shift: resolveShift(inputs, date), window: windowOf(inputs, date) });
```

- [ ] **Change** `packages/server/src/modules/holidays/repository.ts` (this also
  removes an unused import that `npm run lint` reported):

```diff
--- a/packages/server/src/modules/holidays/repository.ts
+++ b/packages/server/src/modules/holidays/repository.ts
@@ -1,10 +1,10 @@
 import type { SqlFragment } from '@tapcrm/authz';
-import type { DateOnly, HolidaySubtype } from '@tapcrm/contracts';
+import type { DateOnly, HolidaySubtype, PlacementsByDate } from '@tapcrm/contracts';
 import type { Tx } from '../../platform/dal/db.js';
 import { sql } from '../../platform/dal/sql.js';
 import { organizationTimezone } from '../../platform/organization-time.js';
 import * as shifts from '../shifts/facade.js';
-import type { CalendarInputs, HolidayInput, ScopeInput, WeekOffRecurrence } from './resolve.js';
+import type { CalendarInputs, ScopeInput, WeekOffRecurrence } from './resolve.js';
 
 /**
  * SQL for holidays. Dates come back as 'YYYY-MM-DD' text, never as JavaScript
@@ -37,13 +37,15 @@ interface HolidayRow {
 /**
  * Everything the resolver needs for one person over [from, to]. Only one
  * `ShiftsFacade.resolveRange` call — never one per date. Skipped entirely
- * when no shift-scoped holiday overlaps the range.
+ * when no shift-scoped holiday overlaps the range. `placements` go to that
+ * call, so a built day's shift is resolved with the department it recorded.
  */
 export async function loadCalendarInputs(
   tx: Tx,
   userId: string,
   from: DateOnly,
   to: DateOnly,
+  placements?: PlacementsByDate,
 ): Promise<CalendarInputs> {
   const subject = await findSubject(tx, userId);
   const [timezone, holidays] = await Promise.all([
@@ -80,7 +82,13 @@ export async function loadCalendarInputs(
   // queries for nothing.
   const shiftIdsByDate = new Map<DateOnly, string | null>();
   if (scopes.some((s) => s.shiftId !== null)) {
-    const resolved = await shifts.resolveRange(tx, userId, from, to);
+    const resolved = await shifts.resolveRange(
+      tx,
+      userId,
+      from,
+      to,
+      placements === undefined ? {} : { placements },
+    );
     for (const r of resolved) shiftIdsByDate.set(r.date, r.shiftId);
   }
 
```

- [ ] **Change** `packages/server/src/modules/holidays/facade.ts`:

```diff
--- a/packages/server/src/modules/holidays/facade.ts
+++ b/packages/server/src/modules/holidays/facade.ts
@@ -7,7 +7,7 @@
  * data once; `leaveDays` (LV-3) counts the days that consume a leave
  * balance in a range.
  */
-import type { DateOnly, ResolvedDay } from '@tapcrm/contracts';
+import type { DateOnly, PlacementsByDate, ResolvedDay } from '@tapcrm/contracts';
 import type { Tx } from '../../platform/dal/db.js';
 import { addDays } from '../../platform/time.js';
 import { loadCalendarInputs } from './repository.js';
@@ -24,16 +24,29 @@ export async function dayType(
   return resolveDay(await loadCalendarInputs(tx, userId, date, date), date);
 }
 
-/** `from..to` inclusive; one read. */
+/**
+ * `from..to` inclusive; one read. `placements` are the departments recorded by
+ * days attendance has already built (attendance design §8.1): those dates are
+ * judged with that department, not today's, so a past day keeps its
+ * department's holidays after a transfer.
+ */
 export async function dayTypeRange(
   tx: Tx,
   userId: string,
   from: DateOnly,
   to: DateOnly,
+  options: { readonly placements?: PlacementsByDate } = {},
 ): Promise<ResolvedDay[]> {
-  const inputs = await loadCalendarInputs(tx, userId, from, to);
+  const inputs = await loadCalendarInputs(tx, userId, from, to, options.placements);
   const out: ResolvedDay[] = [];
-  for (let date = from; date <= to; date = addDays(date, 1)) out.push(resolveDay(inputs, date));
+  for (let date = from; date <= to; date = addDays(date, 1)) {
+    const placement = options.placements?.get(date);
+    const onDate =
+      placement === undefined
+        ? inputs
+        : { ...inputs, departmentId: placement.departmentId };
+    out.push(resolveDay(onDate, date));
+  }
   return out;
 }
 
```

- [ ] **Run the tests again:** `npx vitest run packages/server/src/modules/shifts packages/server/src/modules/holidays`
  (integration variables set). Expected: `Tests  76 passed (76)` — nothing that
  passes no recorded departments has changed. Task 6's transfer test proves
  the whole path.

Checkpoint: leave the changes in the working tree for review.

---

## Task 4 — The ledger: recorded departments, closed days, flags either side

Four changes to 3a's neighbourhood pass:

- **Recorded departments.** The pass reads the departments its days recorded
  and gives them to both resolvers (Task 3).
- **Closed days on request.** A day's facts follow the shifts only while it is
  open. A past shift or calendar change (SH-6, HO-3) must reach closed days
  too, so the pass takes a `refreshClosed` option.
- **Flags on days outside the pass are kept.** The pass locks one day more on
  each side than it re-attributes. 3a added flags to the day before but
  *rewrote* the day after, which could wipe a flag raised by an earlier pass —
  the new test shows it. Now only days inside the pass are rewritten.
- **The overlap flag.** A day whose shift window overlaps a neighbour's is
  flagged `shift-window-overlap`, and the calculator leaves it unevaluated
  (§5.2). 3a computed the fact but did not store it.

`bumpInputVersions` also stamps `input_changed_at`, for the sweeper.

- [ ] **Write the test** — add to `packages/server/src/modules/attendance/ledger.integration.test.ts`:

```diff
--- a/packages/server/src/modules/attendance/ledger.integration.test.ts
+++ b/packages/server/src/modules/attendance/ledger.integration.test.ts
@@ -269,6 +269,14 @@ describe.skipIf(!enabled)('attendance ledger (PostgreSQL)', () => {
     expect(sunday.attributionFlags).toEqual(['previous-session-unconfirmed']);
   });
 
+  it('a later pass that only reaches a flagged day from outside keeps its flag', async () => {
+    // A Friday punch re-attributes Thursday to Saturday and locks Wednesday to
+    // Sunday. Sunday is outside the pass, so its flag must stay.
+    await punch(people.d, 'in', '2026-09-25T19:55:00');
+    const sunday = (await recordsOf(people.d)).find((r) => r.workDate === '2026-09-27')!;
+    expect(sunday.attributionFlags).toEqual(['previous-session-unconfirmed']);
+  });
+
   it('TX-7: a retried client event returns the first answer; the same key for another punch is 409', async () => {
     const first = await punch(people.c, 'in', '2026-09-27T19:50:00', {
       clientEventId: 'offline-1',
```

- [ ] **Run it and watch it fail** (integration variables set):
  `npx vitest run packages/server/src/modules/attendance/ledger.integration.test.ts`
  — expected: `AssertionError: expected [] to deeply equal [ 'previous-session-unconfirmed' ]`

- [ ] **Change** `packages/server/src/modules/attendance/ledger.ts`:

```diff
--- a/packages/server/src/modules/attendance/ledger.ts
+++ b/packages/server/src/modules/attendance/ledger.ts
@@ -43,20 +43,33 @@ import * as repo from './repository.js';
 
 /** How far a neighbourhood pass may widen before it stops (§8.4 step 9). */
 const MAX_PASSES = 6;
+/** Recorded placements are read this far either side: every neighbour a window looks at. */
+const PLACEMENT_MARGIN_DAYS = 7;
 
 async function organizationIdOf(tx: Tx): Promise<string> {
   return (await tx.one<{ id: string }>(sql`SELECT current_organization_id() AS id`)).id;
 }
 
-/** Facts for every date `first..last`, from shifts (§5.2, §8.5). */
+/**
+ * Facts for every date `first..last`, from shifts (§5.2, §8.5). A day already
+ * built is resolved with the department it recorded, not today's (§8.1).
+ */
 async function loadFacts(
   tx: Tx,
   userId: string,
   first: DateOnly,
   last: DateOnly,
 ): Promise<Map<DateOnly, DayFacts>> {
+  const recorded = await repo.placementsBetween(
+    tx,
+    userId,
+    addDays(first, -PLACEMENT_MARGIN_DAYS),
+    addDays(last, PLACEMENT_MARGIN_DAYS),
+  );
   return factsFor(
-    await ShiftsFacade.shiftDays(tx, userId, addDays(first, -1), addDays(last, 1)),
+    await ShiftsFacade.shiftDays(tx, userId, addDays(first, -1), addDays(last, 1), {
+      placements: recorded,
+    }),
   );
 }
 
@@ -77,6 +90,11 @@ interface PassResult {
   readonly placements: ReadonlyMap<string, Placement>;
 }
 
+export interface ReattributeOptions {
+  /** Refresh the facts of closed days as well: a past shift or calendar change (SH-6, HO-3). */
+  readonly refreshClosed?: boolean;
+}
+
 /**
  * §8.4 step 9 — re-attribute the neighbourhood: the day before, the days
  * given, the day after. Only assignments whose day or reason changes are
@@ -89,6 +107,7 @@ export async function reattribute(
   tx: Tx,
   userId: string,
   around: readonly DateOnly[],
+  options: ReattributeOptions = {},
 ): Promise<PassResult> {
   const organizationId = await organizationIdOf(tx);
   const sorted = [...around].sort();
@@ -152,10 +171,11 @@ export async function reattribute(
   // Materialise every day that owns an event, then lock the days in range.
   const first = addDays(lo, -1);
   const last = addDays(hi, 1);
+  const recorded = await repo.placementsBetween(tx, userId, first, last);
   const calendar = new Map(
-    (await CalendarFacade.dayTypeRange(tx, userId, first, last)).map(
-      (day) => [day.date, day.type] as const,
-    ),
+    (
+      await CalendarFacade.dayTypeRange(tx, userId, first, last, { placements: recorded })
+    ).map((day) => [day.date, day.type] as const),
   );
   const factsRow = (date: DateOnly): repo.DayFactsRow => {
     const fact = facts.get(date)!;
@@ -186,9 +206,17 @@ export async function reattribute(
   const records = await repo.lockRecords(tx, userId, range);
 
   const touched = new Set<string>();
-  // refreshDayFacts for the open days in range (§8.5).
+  // refreshDayFacts (§8.5): open days follow the shifts; closed days only
+  // when a shift or calendar change says so (SH-6, HO-3).
   for (const record of records.values()) {
-    if (await repo.refreshFacts(tx, record.id, factsRow(record.workDate)))
+    if (
+      await repo.refreshFacts(
+        tx,
+        record.id,
+        factsRow(record.workDate),
+        options.refreshClosed === true,
+      )
+    )
       touched.add(record.id);
   }
   for (const row of events) {
@@ -208,13 +236,14 @@ export async function reattribute(
     touched.add(record.id);
     if (previousRecordId !== null) touched.add(previousRecordId);
   }
-  // Attribution flags: rewritten inside the range, added to the day before it.
+  // Attribution flags: rewritten inside the range, added to the days either side.
+  // A day whose shift overlaps a neighbour's is flagged too, and the
+  // calculator leaves it unevaluated (§5.2).
   for (const record of records.values()) {
     const raised = [...(flags.get(record.workDate) ?? [])];
-    const next =
-      record.workDate < lo
-        ? [...new Set([...record.attributionFlags, ...raised])]
-        : raised;
+    if (facts.get(record.workDate)?.overlap === true) raised.push('shift-window-overlap');
+    const inside = record.workDate >= lo && record.workDate <= hi;
+    const next = inside ? raised : [...new Set([...record.attributionFlags, ...raised])];
     if (await repo.setAttributionFlags(tx, record.id, next)) touched.add(record.id);
   }
   await repo.bumpInputVersions(tx, organizationId, userId, touched);
```

- [ ] **Change** `packages/server/src/modules/attendance/repository.ts`:

```diff
--- a/packages/server/src/modules/attendance/repository.ts
+++ b/packages/server/src/modules/attendance/repository.ts
@@ -172,6 +172,25 @@ export async function currentPlacement(tx: Tx, userId: string): Promise<Placemen
   );
 }
 
+/**
+ * The placement each day from `from` to `to` recorded when it was built. The
+ * directory keeps no history, so a built day is judged with this, not with
+ * today's department (§8.1 "Why a placement snapshot").
+ */
+export async function placementsBetween(
+  tx: Tx,
+  userId: string,
+  from: DateOnly,
+  to: DateOnly,
+): Promise<Map<DateOnly, Placement>> {
+  const rows = await tx.query<{ workDate: DateOnly; placement: Placement }>(sql`
+    SELECT work_date::text AS work_date, placement_snapshot AS placement
+    FROM attendance_record
+    WHERE user_id = ${userId} AND work_date BETWEEN ${from} AND ${to}
+  `);
+  return new Map(rows.map((row) => [row.workDate, row.placement]));
+}
+
 export interface RecordRow {
   id: string;
   workDate: DateOnly;
@@ -228,20 +247,22 @@ export async function lockRecords(
 }
 
 /**
- * `refreshDayFacts` for an open day (§8.5): while a day is open its facts
- * follow the shifts. Returns true when anything changed.
+ * `refreshDayFacts` (§8.5): while a day is open its facts follow the shifts;
+ * a closed day's change only with `includeClosed`, for a past shift or
+ * calendar change (SH-6, HO-3). Returns true when anything changed.
  */
 export async function refreshFacts(
   tx: Tx,
   recordId: string,
   day: DayFactsRow,
+  includeClosed = false,
 ): Promise<boolean> {
   const rows = await tx.query<{ id: string }>(sql`
     UPDATE attendance_record
     SET window_start = ${day.windowStart}, window_end = ${day.windowEnd}, close_due_at = ${day.closeDueAt},
         shift_snapshot = ${JSON.stringify(day.shift)}::jsonb, shift_source = ${day.shift.source},
         day_type = ${day.dayType}
-    WHERE id = ${recordId} AND state = 'open'
+    WHERE id = ${recordId} AND (state = 'open' OR ${includeClosed})
       AND (window_start, window_end, close_due_at, shift_snapshot, day_type) IS DISTINCT FROM
           (${day.windowStart}::timestamptz, ${day.windowEnd}::timestamptz, ${day.closeDueAt}::timestamptz,
            ${JSON.stringify(day.shift)}::jsonb, ${day.dayType}::text)
@@ -308,7 +329,7 @@ export async function bumpInputVersions(
 ): Promise<void> {
   if (recordIds.size === 0) return;
   const rows = await tx.query<{ id: string; workDate: string; inputVersion: number }>(sql`
-    UPDATE attendance_record SET input_version = input_version + 1
+    UPDATE attendance_record SET input_version = input_version + 1, input_changed_at = now()
     WHERE id = ANY(${[...recordIds]}::uuid[])
     RETURNING id, work_date::text AS work_date, input_version
   `);
```

- [ ] **Run the test again.** Expected: `Tests  11 passed (11)`.

Checkpoint: leave the changes in the working tree for review.

---

## Task 5 — The outbox: events that are never given up on

Today the drainer stops trying an event after ten failed deliveries and
raises `outbox-event-dead-lettered`. That is right for most events, but not
for a change of record that must reach its consumer however long that takes.
A handler can now register with `retryUntilDelivered`. Such an event raises
`outbox-event-overdue` once, at the tenth failure, and keeps being claimed —
every five minutes, the drainer's longest backoff — until its handler
succeeds. Task 6 registers the shift and holiday change events this way.

- [ ] **Write the test** — `packages/server/src/platform/outbox/drainer.integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { platformDb } from '../dal/db.js';
import { closePools } from '../dal/pool.js';
import { sql } from '../dal/sql.js';
import { drainOrganization, MAX_OUTBOX_ATTEMPTS } from './drainer.js';
import { onOutboxEvent } from './registry.js';

/**
 * The domain outbox drainer against real PostgreSQL (design §5.5). An
 * ordinary event stops after ten failed deliveries. One registered to retry
 * until delivered raises its alert at that point and carries on.
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const RUN = randomUUID().slice(0, 8);
const ORG = randomUUID();
const ORDINARY = `test.ordinary-${RUN}`;
const UNTIL_DELIVERED = `test.until-delivered-${RUN}`;
const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query('migration', reason, fragment);

let failing = true;
const delivered: string[] = [];
const deliver = async (event: { id: string }) => {
  if (failing) throw new Error('the consumer is down');
  delivered.push(event.id);
};

const writeEvent = async (name: string, attempts: number) =>
  (
    (await asOwner(
      'write outbox event',
      sql`
      INSERT INTO domain_outbox (organization_id, event_name, payload, attempts)
      VALUES (${ORG}, ${name}, '{}'::jsonb, ${attempts}) RETURNING id`,
    )) as { id: string }[]
  )[0]!.id;

const rowOf = async (id: string) =>
  (
    (await asOwner(
      'read outbox event',
      sql`SELECT attempts, processed_at FROM domain_outbox WHERE id = ${id}`,
    )) as { attempts: number; processedAt: Date | null }[]
  )[0]!;

describe.skipIf(!enabled)('domain outbox drainer (PostgreSQL)', () => {
  beforeAll(async () => {
    await asOwner(
      'create organization',
      sql`
      INSERT INTO organization (id, code, name, timezone) VALUES (${ORG}, ${`OB${RUN}`}, 'Outbox Test', 'Asia/Kolkata')`,
    );
    onOutboxEvent(ORDINARY, deliver);
    onOutboxEvent(UNTIL_DELIVERED, deliver, { retryUntilDelivered: true });
  });

  afterAll(async () => {
    await closePools();
  });

  it('an ordinary event is not claimed again after ten failed deliveries', async () => {
    failing = false;
    const id = await writeEvent(ORDINARY, MAX_OUTBOX_ATTEMPTS);
    await drainOrganization(ORG);
    expect(delivered).not.toContain(id);
    expect(await rowOf(id)).toEqual({ attempts: MAX_OUTBOX_ATTEMPTS, processedAt: null });
  });

  it('an event that retries until delivered alerts at its tenth failure, and is still delivered later', async () => {
    failing = true;
    const id = await writeEvent(UNTIL_DELIVERED, MAX_OUTBOX_ATTEMPTS - 1);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await drainOrganization(ORG);
    const lines = errors.mock.calls.flatMap(([line]): Record<string, unknown>[] => {
      try {
        return [JSON.parse(String(line)) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
    errors.mockRestore();
    expect(lines.filter((line) => line['eventId'] === id)).toEqual([
      expect.objectContaining({
        alert: 'outbox-event-overdue',
        attempts: MAX_OUTBOX_ATTEMPTS,
      }),
    ]);
    expect(await rowOf(id)).toEqual({ attempts: MAX_OUTBOX_ATTEMPTS, processedAt: null });

    // Past the point where an ordinary event stops, it is still claimed.
    failing = false;
    await asOwner(
      'skip the backoff',
      sql`UPDATE domain_outbox SET claimed_until = NULL WHERE id = ${id}`,
    );
    await drainOrganization(ORG);
    expect(delivered).toContain(id);
    expect((await rowOf(id)).processedAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Run it and watch it fail** (integration variables set):
  `npx vitest run packages/server/src/platform/outbox` — expected:
  `AssertionError: expected [ { level: 'error', …(6) } ] to deeply equal [ ObjectContaining{…} ]`
  (the drainer gave up, with its dead-letter alert).

- [ ] **Change** `packages/server/src/platform/outbox/registry.ts`:

```diff
--- a/packages/server/src/platform/outbox/registry.ts
+++ b/packages/server/src/platform/outbox/registry.ts
@@ -21,10 +21,26 @@ export interface OutboxEvent {
 
 export type OutboxHandler = (event: OutboxEvent) => Promise<void>;
 
+export interface OutboxHandlerOptions {
+  /**
+   * For an event that records a change another module must apply, however
+   * long that takes. The drainer never gives up on it: after the usual ten
+   * attempts it raises an alert and keeps retrying every five minutes until
+   * the handler succeeds.
+   */
+  readonly retryUntilDelivered?: boolean;
+}
+
 const handlers = new Map<string, OutboxHandler[]>();
+const untilDelivered = new Set<string>();
 
-export function onOutboxEvent(name: string, handler: OutboxHandler): void {
+export function onOutboxEvent(
+  name: string,
+  handler: OutboxHandler,
+  options: OutboxHandlerOptions = {},
+): void {
   handlers.set(name, [...(handlers.get(name) ?? []), handler]);
+  if (options.retryUntilDelivered === true) untilDelivered.add(name);
 }
 
 export function handlersFor(name: string): readonly OutboxHandler[] {
@@ -40,7 +56,13 @@ export function handledEventNames(): string[] {
   return [...handlers.keys()].sort();
 }
 
+/** The events the drainer never gives up on (`retryUntilDelivered`). */
+export function retriedUntilDelivered(): string[] {
+  return [...untilDelivered].sort();
+}
+
 /** Tests only. */
 export function __resetOutboxHandlers(): void {
   handlers.clear();
+  untilDelivered.clear();
 }
```

- [ ] **Change** `packages/server/src/platform/outbox/drainer.ts`:

```diff
--- a/packages/server/src/platform/outbox/drainer.ts
+++ b/packages/server/src/platform/outbox/drainer.ts
@@ -2,7 +2,12 @@ import { createJobContext, systemPrincipal } from '../dal/context.js';
 import { db, platformDb } from '../dal/db.js';
 import { listen, type Listener } from '../dal/pool.js';
 import { sql } from '../dal/sql.js';
-import { handledEventNames, handlersFor, type OutboxEvent } from './registry.js';
+import {
+  handledEventNames,
+  handlersFor,
+  retriedUntilDelivered,
+  type OutboxEvent,
+} from './registry.js';
 
 /**
  * The domain outbox drainer — attendance design §5.5, TX-2, D22.
@@ -13,7 +18,9 @@ import { handledEventNames, handlersFor, type OutboxEvent } from './registry.js'
  * 2. Publish outside any transaction (TX-2): each handler enqueues a job or
  *    emits a socket event.
  * 3. Mark the published rows processed. A failed row waits a backoff and is
- *    claimed again; after ten attempts it stops and raises an alert.
+ *    claimed again; after ten attempts it stops and raises an alert. An event
+ *    registered with `retryUntilDelivered` never stops: at ten attempts it
+ *    raises its alert and carries on, every five minutes, until delivered.
  *
  * A drainer that dies between 2 and 3 leaves its lease to lapse, and the rows
  * are published again: at least once, never lost.
@@ -74,6 +81,7 @@ async function publish(organizationId: string, row: ClaimedRow): Promise<string
 export async function drainOrganization(organizationId: string): Promise<number> {
   const names = handledEventNames();
   if (names.length === 0) return 0;
+  const untilDelivered = retriedUntilDelivered();
   const ctx = contextFor(organizationId);
   let published = 0;
 
@@ -85,7 +93,7 @@ export async function drainOrganization(organizationId: string): Promise<number>
           WHERE organization_id = ${organizationId}
             AND processed_at IS NULL
             AND event_name = ANY(${names}::text[])
-            AND attempts < ${MAX_OUTBOX_ATTEMPTS}
+            AND (attempts < ${MAX_OUTBOX_ATTEMPTS} OR event_name = ANY(${untilDelivered}::text[]))
             AND (claimed_until IS NULL OR claimed_until < now())
           ORDER BY enqueued_at, id
           LIMIT ${BATCH_SIZE}
@@ -103,11 +111,18 @@ export async function drainOrganization(organizationId: string): Promise<number>
     claimed.sort((a, b) => a.enqueuedAt.getTime() - b.enqueuedAt.getTime() || a.id.localeCompare(b.id));
 
     const done: string[] = [];
-    const failed: { id: string; attempts: number; error: string }[] = [];
+    const failed: { id: string; eventName: string; attempts: number; error: string }[] =
+      [];
     for (const row of claimed) {
       const error = await publish(organizationId, row);
       if (error === null) done.push(row.id);
-      else failed.push({ id: row.id, attempts: row.attempts, error });
+      else
+        failed.push({
+          id: row.id,
+          eventName: row.eventName,
+          attempts: row.attempts,
+          error,
+        });
     }
 
     await db.transaction(ctx, async (tx) => {
@@ -129,12 +144,21 @@ export async function drainOrganization(organizationId: string): Promise<number>
     });
 
     for (const row of failed) {
-      const final = row.attempts >= MAX_OUTBOX_ATTEMPTS;
+      const keepsTrying = untilDelivered.includes(row.eventName);
+      const final = !keepsTrying && row.attempts >= MAX_OUTBOX_ATTEMPTS;
+      // An event that is never given up on alerts once, when it reaches the
+      // point where any other event would have stopped.
+      const overdue = keepsTrying && row.attempts === MAX_OUTBOX_ATTEMPTS;
       console.error(
         JSON.stringify({
           level: 'error',
-          msg: final ? 'outbox event gave up' : 'outbox event failed; will retry',
+          msg: final
+            ? 'outbox event gave up'
+            : overdue
+              ? 'outbox event still failing; it keeps retrying until delivered'
+              : 'outbox event failed; will retry',
           ...(final ? { alert: 'outbox-event-dead-lettered' } : {}),
+          ...(overdue ? { alert: 'outbox-event-overdue' } : {}),
           organizationId,
           eventId: row.id,
           attempts: row.attempts,
```

- [ ] **Run the test again.** Expected: `Tests  2 passed (2)`.

Checkpoint: leave the changes in the working tree for review.

---

## Task 6 — Recalculation, refresh requests, the sweeper and the handlers (§8.5)

Nothing is queued inside a transaction (TX-2). A change writes an outbox row
in its own transaction; after it commits, the drainer hands the row to a
handler, and the handler queues a job. Delivery is at least once, so every
handler is idempotent: each job has a key, and the queue runs a key once
(JB-1).

| Job | Key | Does |
|---|---|---|
| `attendance.recalculate` | record id and input version | Locks the person, then the day (D24). Stops if the stored answer is already for the newest inputs. Otherwise loads the inputs, calculates, stores, and rebuilds the month summary |
| `attendance.refresh-days` | refresh request id (and its `replays`, once re-armed) | Refreshes one person's days in range, closed ones included, 31 days per transaction, then marks the request completed |
| `attendance.stale-sweeper` | the tick | Every five minutes, for organizations with attendance enabled: offers again each day stale for over a minute and each request still open after a minute, under its next generation (§5.4). After the third fails, the day is flagged `recalculation-failed`, or the request is marked failed |

| Outbox event | Handler | If delivery keeps failing |
|---|---|---|
| `attendance.recalc-requested` | Queues the day's recalculation | Given up after ten attempts, as usual: the day is stale, so the sweeper finds it |
| `shifts.days-changed`, `holidays.days-changed` | Writes one refresh request per person with a day in reach, then queues each open one | Retried until delivered (Task 5) |

A failed refresh request is run again by a person with one statement, which
gives it a new key so its generations start again:

```sql
UPDATE attendance_refresh_request SET failed_at = NULL, replays = replays + 1 WHERE id = '…';
```

- [ ] **Write the tests.** A unit test for the date chunks —
  `packages/server/src/modules/attendance/recalculate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { toDateOnly } from '../../platform/time.js';
import { chunkDates } from './recalculate.js';

const d = toDateOnly;

describe('chunkDates', () => {
  it('cuts sorted dates into runs of at most 31 calendar days', () => {
    expect(
      chunkDates(
        [
          d('2026-03-10'),
          d('2026-01-15'),
          d('2026-01-01'),
          d('2026-02-01'),
          d('2026-01-31'),
        ],
        31,
      ),
    ).toEqual([
      [d('2026-01-01'), d('2026-01-15'), d('2026-01-31')],
      [d('2026-02-01')],
      [d('2026-03-10')],
    ]);
  });

  it('gives nothing for nothing', () => {
    expect(chunkDates([], 31)).toEqual([]);
  });
});
```

  And the whole path against PostgreSQL and Redis —
  `packages/server/src/modules/attendance/recalculate.integration.test.ts`.
  It runs the real outbox drainer and job queue: punches go through the
  outbox to the calculator; a shift change, a holiday and a transfer reach
  past days; and the sweeper catches a lost request of each kind:

```ts
import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../config.js';
import { createJobContext, systemPrincipal } from '../../platform/dal/context.js';
import { db, platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import { startJobs, stopJobs } from '../../platform/jobs/runner.js';
import { drainOrganization } from '../../platform/outbox/drainer.js';
import { retriedUntilDelivered } from '../../platform/outbox/registry.js';
import { appendEvent, type AppendEventInput } from './facade.js';
import { registerAttendanceJobs, type AttendanceJobs } from './jobs.js';
import { recalculateRecord, sweepRefreshRequests, sweepStale } from './recalculate.js';

/**
 * Step 3b against real PostgreSQL and Redis: punches reach the calculator
 * through the outbox and the queue, shift and holiday changes reach past days,
 * and the stale sweeper catches what a lost message would leave (design §8.5).
 *
 *   TAPCRM_INTEGRATION_DB=1 REDIS_URL=… MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const RUN = randomUUID().slice(0, 8);
const QUEUE = `tapcrm.jobs.test-${RUN}`;
const ORG = randomUUID();
const DEPT = randomUUID();
const POS = randomUUID();
const HR = randomUUID();
const people = { a: randomUUID(), b: randomUUID(), c: randomUUID() };
/** No shift of their own: works the department's default, and later moves to sales. */
const MOVER = randomUUID();
const SALES = randomUUID();
const SALES_POS = randomUUID();
const DAY = randomUUID();
const EARLY = randomUUID();
const LATE = randomUUID();
const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query('migration', reason, fragment);
const ctx = () =>
  createJobContext({
    organizationId: ORG,
    principal: systemPrincipal(ORG),
    jobName: 'test',
    runId: randomUUID(),
  });

/** Instants written as IST wall-clock time. */
const ist = (local: string) => new Date(`${local}+05:30`);

const punch = (userId: string, kind: AppendEventInput['kind'], local: string) =>
  db.transaction(ctx(), (tx) =>
    appendEvent(tx, {
      userId,
      kind,
      at: ist(local),
      source: 'web',
      evidence: 'confirmed',
      remote: true,
    }),
  );

async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

interface Day {
  id: string;
  status: string | null;
  presentUnits: number;
  absentUnits: number;
  holidayUnits: number;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  earlyExitMinutes: number;
  overtimeMinutes: number;
  flags: string[];
  rulesVersion: string;
  shiftId: string;
  inputVersion: number;
  calculatedInputVersion: number;
  calculationVersion: number;
}

const dayOf = async (userId: string, date: string): Promise<Day | undefined> =>
  (
    (await asOwner(
      'read day',
      sql`
      SELECT id, status, present_units, absent_units, holiday_units, worked_minutes, break_minutes, late_minutes,
             early_exit_minutes, overtime_minutes, flags, rules_version, shift_snapshot->>'shiftId' AS shift_id,
             input_version, calculated_input_version, calculation_version
      FROM attendance_record WHERE user_id = ${userId} AND work_date = ${date}`,
    )) as Day[]
  )[0];

/** Drains the outbox until the day is calculated for its newest inputs and `also` holds. */
async function settled(
  userId: string,
  date: string,
  also: (day: Day) => boolean = () => true,
): Promise<Day> {
  const day = await until(
    async () => {
      await drainOrganization(ORG);
      return dayOf(userId, date);
    },
    (row) =>
      row !== undefined && row.calculatedInputVersion === row.inputVersion && also(row),
  );
  expect(day).toBeDefined();
  return day!;
}

const outbox = async (name: string, payload: unknown) =>
  (
    (await asOwner(
      'write outbox event',
      sql`
      INSERT INTO domain_outbox (organization_id, event_name, payload)
      VALUES (${ORG}, ${name}, ${JSON.stringify(payload)}::jsonb) RETURNING id`,
    )) as { id: string }[]
  )[0]!.id;

const runsOf = (jobName: string, keyPrefix: string) =>
  asOwner(
    'read job runs',
    sql`
    SELECT idempotency_key, outcome FROM job_run
    WHERE organization_id = ${ORG} AND job_name = ${jobName} AND idempotency_key LIKE ${`${keyPrefix}%`}
    ORDER BY idempotency_key`,
  ) as Promise<{ idempotencyKey: string; outcome: string | null }[]>;

interface RefreshRow {
  userId: string;
  completedAt: Date | null;
  failedAt: Date | null;
}

const requestsOf = (eventId: string) =>
  asOwner(
    'read refresh requests',
    sql`
    SELECT user_id, completed_at, failed_at FROM attendance_refresh_request
    WHERE source_event_id = ${eventId} ORDER BY user_id`,
  ) as Promise<RefreshRow[]>;

const requestById = async (id: string) =>
  (
    (await asOwner(
      'read refresh request',
      sql`SELECT user_id, completed_at, failed_at FROM attendance_refresh_request WHERE id = ${id}`,
    )) as RefreshRow[]
  )[0]!;

/** A refresh request written straight into the table, as if its handler ran and its job was lost. */
const writeRequest = async (userId: string, date: string, requestedAgo: string) =>
  (
    (await asOwner(
      'write refresh request',
      sql`
      INSERT INTO attendance_refresh_request (organization_id, user_id, source_event_id, from_date, to_date,
                                              requested_at)
      VALUES (${ORG}, ${userId}, ${randomUUID()}, ${date}, ${date}, now() - ${requestedAgo}::interval)
      RETURNING id`,
    )) as { id: string }[]
  )[0]!.id;

let jobs: AttendanceJobs;

// Waits give up after 15 seconds (`until`), well inside the test's own limit,
// so a failure shows what the day looked like rather than a timeout.
describe.skipIf(!enabled)(
  'attendance recalculation (PostgreSQL and Redis)',
  { timeout: 30_000 },
  () => {
    beforeAll(async () => {
      await asOwner(
        'create organization',
        sql`
      INSERT INTO organization (id, code, name, timezone) VALUES (${ORG}, ${`RC${RUN}`}, 'Recalculation Test', 'Asia/Kolkata')`,
      );
      await asOwner(
        'create department',
        sql`
      INSERT INTO department (id, organization_id, code, name, kind) VALUES (${DEPT}, ${ORG}, 'OPS', 'Operations', 'operations')`,
      );
      await asOwner(
        'create sales',
        sql`
      INSERT INTO department (id, organization_id, code, name, kind) VALUES (${SALES}, ${ORG}, 'SAL', 'Sales', 'sales')`,
      );
      await asOwner(
        'create positions',
        sql`
      INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
      VALUES (${POS}, ${ORG}, ${DEPT}, 'OPS-1', 'Operator', 20),
             (${SALES_POS}, ${ORG}, ${SALES}, 'SAL-1', 'Seller', 20)`,
      );
      for (const [index, id] of [HR, ...Object.values(people), MOVER].entries()) {
        await asOwner(
          'create person',
          sql`
        INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id)
        VALUES (${id}, ${ORG}, 'employee', ${`EMP-RC${String(index).padStart(3, '0')}`}, ${`p${index}-${id}@t.io`},
                ${`Person ${index}`}, ${POS}, ${DEPT})`,
        );
      }
      // 09:00–18:00 for everyone, an early 07:00–16:00 to move a day onto, and a
      // late 11:00–20:00 for sales. Ten minutes' grace, 450 minutes a full day,
      // 240 a half; no overtime rule.
      await asOwner(
        'shifts',
        sql`
      INSERT INTO shift (id, organization_id, code, name, kind, created_by)
      VALUES (${DAY}, ${ORG}, 'DAY', 'Day', 'fixed', ${HR}), (${EARLY}, ${ORG}, 'EARLY', 'Early', 'fixed', ${HR}),
             (${LATE}, ${ORG}, 'LATE', 'Late', 'fixed', ${HR})`,
      );
      await asOwner(
        'versions',
        sql`
      INSERT INTO shift_version (organization_id, shift_id, effective_from, start_time, end_time, grace_minutes,
                                 full_day_minutes, half_day_minutes, created_by)
      VALUES (${ORG}, ${DAY}, '2026-01-01', '09:00', '18:00', 10, 450, 240, ${HR}),
             (${ORG}, ${EARLY}, '2026-01-01', '07:00', '16:00', 10, 450, 240, ${HR}),
             (${ORG}, ${LATE}, '2026-01-01', '11:00', '20:00', 10, 450, 240, ${HR})`,
      );
      await asOwner(
        'department defaults',
        sql`
      INSERT INTO department_shift_default (organization_id, department_id, shift_id, effective_from, created_by)
      VALUES (${ORG}, ${DEPT}, ${DAY}, '2026-01-01', ${HR}), (${ORG}, ${SALES}, ${LATE}, '2026-01-01', ${HR})`,
      );
      await asOwner(
        'setting',
        sql`
      INSERT INTO shift_setting (organization_id, effective_from, max_closing_extension_minutes, created_by)
      VALUES (${ORG}, '2026-01-01', 240, ${HR})`,
      );
      for (const id of Object.values(people)) {
        await asOwner(
          'day template',
          sql`
        INSERT INTO shift_assignment (organization_id, user_id, kind, shift_id, effective_from, created_by)
        VALUES (${ORG}, ${id}, 'template', ${DAY}, '2026-09-01', ${HR})`,
        );
      }
      jobs = registerAttendanceJobs();
      await startJobs({ queueName: QUEUE });
    });

    afterAll(async () => {
      await stopJobs();
      const redis = new Redis(loadConfig().REDIS_URL, { maxRetriesPerRequest: null });
      const queue = new Queue(QUEUE, { connection: redis });
      await queue.obliterate({ force: true });
      await queue.close();
      await redis.quit();
      await closePools();
    });

    it('never gives up on the two events that carry shift and holiday changes', () => {
      expect(retriedUntilDelivered()).toEqual([
        'holidays.days-changed',
        'shifts.days-changed',
      ]);
    });

    it('calculates a punched day once for two requests, and rebuilds the month', async () => {
      await punch(people.a, 'in', '2026-09-22T09:25:00');
      await punch(people.a, 'out', '2026-09-22T18:00:00');
      const day = await settled(people.a, '2026-09-22');
      expect(day).toMatchObject({
        status: 'present',
        presentUnits: 2,
        absentUnits: 0,
        workedMinutes: 515,
        lateMinutes: 15,
        earlyExitMinutes: 0,
        overtimeMinutes: 0,
        rulesVersion: 'attendance-rules/1',
        calculationVersion: 1,
      });
      expect(day.flags).toEqual(['late', 'remote-without-approval']);
      const runs = await until(
        () => runsOf('attendance.recalculate', day.id),
        (rows) => rows.length === 2 && rows.every((row) => row.outcome === 'success'),
      );
      expect(runs.map((run) => run.idempotencyKey)).toEqual([
        `${day.id}:2`,
        `${day.id}:3`,
      ]);

      const [month] = (await asOwner(
        'read month',
        sql`
      SELECT days, present_units, worked_minutes, late_days, late_minutes, open_days, stale_days
      FROM attendance_month_summary WHERE user_id = ${people.a} AND month = '2026-09-01'`,
      )) as Record<string, number>[];
      expect(month).toEqual({
        days: 1,
        presentUnits: 2,
        workedMinutes: 515,
        lateDays: 1,
        lateMinutes: 15,
        openDays: 1,
        staleDays: 0,
      });
    });

    it('leaves a day alone when its answer is already for its newest inputs', async () => {
      const before = (await dayOf(people.a, '2026-09-22'))!;
      expect(await db.transaction(ctx(), (tx) => recalculateRecord(tx, before.id))).toBe(
        'current',
      );
      expect((await dayOf(people.a, '2026-09-22'))!.calculationVersion).toBe(
        before.calculationVersion,
      );
    });

    it('recalculates when a new input arrives', async () => {
      await punch(people.a, 'break-start', '2026-09-22T13:00:00');
      await punch(people.a, 'break-end', '2026-09-22T13:30:00');
      const day = await settled(people.a, '2026-09-22', (row) => row.breakMinutes === 30);
      // D19: no break policy yet, so the break is paid and the worked time stands.
      expect(day).toMatchObject({
        status: 'present',
        workedMinutes: 515,
        breakMinutes: 30,
        calculationVersion: 2,
      });
    });

    it('a past shift change reaches the day through shifts.days-changed, even once it is closed', async () => {
      await punch(people.b, 'in', '2026-09-23T09:05:00');
      await punch(people.b, 'out', '2026-09-23T18:00:00');
      const first = await settled(people.b, '2026-09-23');
      expect(first).toMatchObject({ status: 'present', lateMinutes: 0, shiftId: DAY });

      await asOwner(
        'close the day',
        sql`UPDATE attendance_record SET state = 'closed', closed_at = now(), closed_by = 'punch-out' WHERE id = ${first.id}`,
      );
      await asOwner(
        'move the day to the early shift',
        sql`
      INSERT INTO shift_override (organization_id, user_id, work_date, kind, shift_id, reason, created_by)
      VALUES (${ORG}, ${people.b}, '2026-09-23', 'shift', ${EARLY}, 'Cover', ${HR})`,
      );
      await outbox('shifts.days-changed', {
        userIds: [people.b],
        from: '2026-09-23',
        to: '2026-09-23',
        reason: 'override',
      });

      const day = await settled(people.b, '2026-09-23', (row) => row.shiftId === EARLY);
      // 09:05 against 07:00 and ten minutes' grace.
      expect(day).toMatchObject({
        status: 'present',
        lateMinutes: 115,
        workedMinutes: 535,
        calculationVersion: 2,
      });
      expect(day.flags).toContain('late');
    });

    it('a holiday declared on a worked day makes it a holiday flagged as worked, and nothing else moves', async () => {
      await punch(people.c, 'in', '2026-09-24T09:00:00');
      await punch(people.c, 'out', '2026-09-24T18:00:00');
      expect((await settled(people.c, '2026-09-24')).status).toBe('present');
      const neighbour = (await dayOf(people.b, '2026-09-23'))!;

      await asOwner(
        'declare a holiday',
        sql`
      INSERT INTO holiday (organization_id, name, type, holiday_date, created_by)
      VALUES (${ORG}, 'Founders Day', 'national', '2026-09-24', ${HR})`,
      );
      const eventId = await outbox('holidays.days-changed', {
        from: '2026-09-24',
        toExclusive: '2026-09-25',
        reason: 'declared',
      });

      const day = await settled(
        people.c,
        '2026-09-24',
        (row) => row.status === 'holiday',
      );
      expect(day).toMatchObject({ holidayUnits: 2, presentUnits: 0, workedMinutes: 540 });
      expect(day.flags).toContain('holiday-worked');

      // Everyone with a day in reach (the 23rd to the 25th) got a refresh
      // request, and each was completed; a's 22nd was not in reach.
      const requests = await until(
        () => requestsOf(eventId),
        (rows) => rows.length === 2 && rows.every((row) => row.completedAt !== null),
      );
      expect(requests.map((row) => row.userId).sort()).toEqual(
        [people.b, people.c].sort(),
      );
      // b's 23rd was refreshed, but none of its facts changed, so it kept its answer.
      expect((await dayOf(people.b, '2026-09-23'))!.calculationVersion).toBe(
        neighbour.calculationVersion,
      );
    });

    it('§8.1: after a transfer, a change to the old department still reaches the days built in it', async () => {
      await punch(MOVER, 'in', '2026-03-10T09:05:00');
      await punch(MOVER, 'out', '2026-03-10T18:00:00');
      await punch(MOVER, 'in', '2026-03-12T09:05:00');
      await punch(MOVER, 'out', '2026-03-12T18:00:00');
      expect(await settled(MOVER, '2026-03-10')).toMatchObject({
        status: 'present',
        shiftId: DAY,
      });
      expect(await settled(MOVER, '2026-03-12')).toMatchObject({
        status: 'present',
        shiftId: DAY,
      });

      await asOwner(
        'move to sales',
        sql`UPDATE app_user SET department_id = ${SALES}, position_id = ${SALES_POS} WHERE id = ${MOVER}`,
      );

      // Operations declares a holiday on the 10th, after the move.
      const holiday = randomUUID();
      await asOwner(
        'an operations holiday',
        sql`
      INSERT INTO holiday (id, organization_id, name, type, holiday_date, created_by)
      VALUES (${holiday}, ${ORG}, 'Operations Day', 'regional', '2026-03-10', ${HR})`,
      );
      await asOwner(
        'scoped to operations',
        sql`INSERT INTO holiday_scope (organization_id, holiday_id, department_id) VALUES (${ORG}, ${holiday}, ${DEPT})`,
      );
      await outbox('holidays.days-changed', {
        departmentIds: [DEPT],
        from: '2026-03-10',
        toExclusive: '2026-03-11',
        reason: 'declared',
      });
      const tenth = await settled(MOVER, '2026-03-10', (row) => row.status === 'holiday');
      expect(tenth).toMatchObject({ status: 'holiday', holidayUnits: 2, shiftId: DAY });
      expect(tenth.flags).toContain('holiday-worked');

      // Operations' default shift becomes the early one from the 12th.
      await asOwner(
        'end the old default',
        sql`UPDATE department_shift_default SET effective_to = '2026-03-12' WHERE department_id = ${DEPT}`,
      );
      await asOwner(
        'the new default',
        sql`
      INSERT INTO department_shift_default (organization_id, department_id, shift_id, effective_from, created_by)
      VALUES (${ORG}, ${DEPT}, ${EARLY}, '2026-03-12', ${HR})`,
      );
      await outbox('shifts.days-changed', {
        departmentId: DEPT,
        from: '2026-03-12',
        to: null,
        reason: 'new default',
      });
      const twelfth = await settled(MOVER, '2026-03-12', (row) => row.shiftId !== DAY);
      // Operations' early shift, not sales' late one: 09:05 against 07:00 and ten minutes' grace.
      expect(twelfth).toMatchObject({
        status: 'present',
        shiftId: EARLY,
        lateMinutes: 115,
      });
    });

    it('the stale sweeper re-offers a day whose request was lost', async () => {
      const day = (await dayOf(people.a, '2026-09-22'))!;
      await asOwner(
        'lose a request',
        sql`
      UPDATE attendance_record SET input_version = input_version + 1, input_changed_at = now() - interval '2 minutes'
      WHERE id = ${day.id}`,
      );
      await jobs.staleSweeper.enqueue({
        organizationId: ORG,
        key: `sweep-${RUN}`,
        payload: undefined,
      });
      const after = await settled(
        people.a,
        '2026-09-22',
        (row) => row.calculationVersion === day.calculationVersion + 1,
      );
      expect(after.calculatedInputVersion).toBe(day.inputVersion + 1);
    });

    it('flags a day whose third generation failed, until a later input succeeds', async () => {
      const day = (await dayOf(people.c, '2026-09-24'))!;
      await asOwner(
        'lose a request',
        sql`
      UPDATE attendance_record SET input_version = input_version + 1, input_changed_at = now() - interval '2 minutes'
      WHERE id = ${day.id}`,
      );
      const base = `${day.id}:${day.inputVersion + 1}`;
      for (const key of [base, `${base}:g2`, `${base}:g3`]) {
        await asOwner(
          'a dead-lettered generation',
          sql`
        INSERT INTO job_run (organization_id, job_name, idempotency_key, started_at, finished_at, outcome, attempts,
                             dead_lettered_at)
        VALUES (${ORG}, 'attendance.recalculate', ${key}, now() - interval '3 days', now() - interval '3 days',
                'failure', 5, now() - interval '2 days')`,
        );
      }
      expect(await sweepStale(ctx(), jobs.recalculate, new Date())).toEqual({
        offered: 0,
        flagged: 1,
      });
      const flagged = (await dayOf(people.c, '2026-09-24'))!;
      expect(flagged.flags).toContain('recalculation-failed');
      expect(flagged.calculatedInputVersion).toBeLessThan(flagged.inputVersion);

      await punch(people.c, 'break-start', '2026-09-24T13:00:00');
      await punch(people.c, 'break-end', '2026-09-24T13:15:00');
      const recovered = await settled(
        people.c,
        '2026-09-24',
        (row) => row.breakMinutes === 15,
      );
      expect(recovered.flags).not.toContain('recalculation-failed');
    });

    it('the stale sweeper runs a refresh request whose job was lost', async () => {
      const id = await writeRequest(people.a, '2026-09-22', '2 minutes');
      expect(await sweepRefreshRequests(ctx(), jobs.refreshDays, new Date())).toEqual({
        offered: 1,
        flagged: 0,
      });
      const done = await until(
        () => requestById(id),
        (row) => row.completedAt !== null,
      );
      expect(done.completedAt).toBeInstanceOf(Date);
    });

    it('a refresh request whose third generation failed waits for a person, and runs once re-armed', async () => {
      const id = await writeRequest(people.b, '2026-09-23', '3 days');
      for (const key of [id, `${id}:g2`, `${id}:g3`]) {
        await asOwner(
          'a dead-lettered generation',
          sql`
          INSERT INTO job_run (organization_id, job_name, idempotency_key, started_at, finished_at, outcome,
                               attempts, dead_lettered_at)
          VALUES (${ORG}, 'attendance.refresh-days', ${key}, now() - interval '3 days',
                  now() - interval '3 days', 'failure', 5, now() - interval '2 days')`,
        );
      }
      expect(await sweepRefreshRequests(ctx(), jobs.refreshDays, new Date())).toEqual({
        offered: 0,
        flagged: 1,
      });
      expect((await requestById(id)).failedAt).toBeInstanceOf(Date);

      // A person re-arms it: a new key, so its generations start again.
      await asOwner(
        're-arm the request',
        sql`UPDATE attendance_refresh_request SET failed_at = NULL, replays = replays + 1 WHERE id = ${id}`,
      );
      expect(await sweepRefreshRequests(ctx(), jobs.refreshDays, new Date())).toEqual({
        offered: 1,
        flagged: 0,
      });
      const done = await until(
        () => requestById(id),
        (row) => row.completedAt !== null,
      );
      expect(done).toMatchObject({ failedAt: null });
    });
  },
);
```

- [ ] **Run them and watch them fail:** `npx vitest run packages/server/src/modules/attendance/recalculate`
  (integration variables and `REDIS_URL` set) — expected: `Test Files  2 failed (2)`,
  with `Error: Failed to load url ./jobs.js …` and `./recalculate.js … Does the file exist?`

- [ ] **Create** `packages/server/src/modules/attendance/calculation-repository.ts`:

```ts
import type {
  AttendanceEventInput,
  DateOnly,
  LocalTime,
  ResolvedShift,
} from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { CalculatedAttendance, Overlay } from './calculate.js';
import { RULES_VERSION } from './calculate.js';

/** SQL for recalculation (design §8.5): the day's inputs, its stored answer, the month summary. */

export async function recordOwner(
  tx: Tx,
  recordId: string,
): Promise<{ userId: string } | null> {
  return tx.maybeOne<{ userId: string }>(
    sql`SELECT user_id FROM attendance_record WHERE id = ${recordId}`,
  );
}

export interface RecordForCalculation {
  id: string;
  userId: string;
  workDate: DateOnly;
  state: 'open' | 'closed';
  shiftSnapshot: ResolvedShift;
  closeDueAt: Date;
  dayType: 'working' | 'week-off' | 'holiday' | 'not-employed';
  attributionFlags: string[];
  inputVersion: number;
  calculatedInputVersion: number;
}

export async function lockRecordForCalculation(
  tx: Tx,
  recordId: string,
): Promise<RecordForCalculation> {
  return tx.one<RecordForCalculation>(sql`
    SELECT id, user_id, work_date::text AS work_date, state, shift_snapshot, close_due_at, day_type,
           attribution_flags, input_version, calculated_input_version
    FROM attendance_record WHERE id = ${recordId}
    FOR UPDATE
  `);
}

/** D28 — the record's effective events: assigned to it, not void, not superseded. */
export async function effectiveEventsForRecord(
  tx: Tx,
  recordId: string,
): Promise<AttendanceEventInput[]> {
  const rows = await tx.query<{
    id: string;
    kind: AttendanceEventInput['kind'];
    occurredAt: Date;
    source: AttendanceEventInput['source'];
    evidence: AttendanceEventInput['evidence'];
    reason: AttendanceEventInput['assignmentReason'];
  }>(sql`
    SELECT e.id, e.kind, e.occurred_at, e.source, e.evidence, a.reason
    FROM attendance_event_assignment a
    JOIN attendance_event e ON e.organization_id = a.organization_id AND e.id = a.event_id
    WHERE a.attendance_record_id = ${recordId}
      AND NOT e.is_void
      AND NOT EXISTS (SELECT 1 FROM attendance_event s
                      WHERE s.organization_id = e.organization_id AND s.supersedes_event_id = e.id)
    ORDER BY e.occurred_at, e.id
  `);
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    at: row.occurredAt.toISOString(),
    source: row.source,
    evidence: row.evidence,
    assignmentReason: row.reason,
  }));
}

export async function overlaysFor(
  tx: Tx,
  userId: string,
  date: DateOnly,
): Promise<Overlay[]> {
  const rows = await tx.query<{
    kind: Overlay['kind'];
    paid: boolean | null;
    consequence: Overlay['consequence'];
    minutes: number | null;
    leaveRequestId: string | null;
    breakBreachId: string | null;
  }>(sql`
    SELECT kind, paid, consequence, minutes, leave_request_id, break_breach_id
    FROM attendance_overlay WHERE user_id = ${userId} AND work_date = ${date}
    ORDER BY kind, created_at
  `);
  return rows.map((row) => ({
    kind: row.kind,
    paid: row.paid,
    consequence: row.consequence,
    minutes: row.minutes,
    sourceId: row.leaveRequestId ?? row.breakBreachId ?? '',
  }));
}

/** The night window in force on the date (D35), or null. */
export async function nightWindowOn(
  tx: Tx,
  date: DateOnly,
): Promise<{ from: LocalTime; to: LocalTime } | null> {
  const row = await tx.maybeOne<{ from: LocalTime | null; to: LocalTime | null }>(sql`
    SELECT to_char(night_window_from, 'HH24:MI') AS from, to_char(night_window_to, 'HH24:MI') AS to
    FROM attendance_setting WHERE effective_from <= ${date}
    ORDER BY effective_from DESC LIMIT 1
  `);
  return row?.from != null && row.to != null ? { from: row.from, to: row.to } : null;
}

/** Stores the answer for the input version it was computed from (AT-I3). */
export async function writeCalculation(
  tx: Tx,
  recordId: string,
  inputVersion: number,
  result: CalculatedAttendance,
): Promise<void> {
  await tx.query(sql`
    UPDATE attendance_record SET
      status = ${result.status},
      present_units = ${result.units.present},
      paid_leave_units = ${result.units.paidLeave},
      unpaid_leave_units = ${result.units.unpaidLeave},
      absent_units = ${result.units.absent},
      holiday_units = ${result.units.holiday},
      worked_minutes = ${result.workedMinutes},
      break_minutes = ${result.breakMinutes},
      late_minutes = ${result.lateMinutes},
      early_exit_minutes = ${result.earlyExitMinutes},
      overtime_minutes = ${result.overtimeMinutes},
      night_minutes = ${result.nightMinutes},
      arrival_at = ${result.arrivalAt}::timestamptz,
      departure_at = ${result.departureAt}::timestamptz,
      is_wfh = ${result.isWfh},
      flags = ${[...result.flags]}::text[],
      provenance = ${JSON.stringify(result.provenance)}::jsonb,
      rules_version = ${RULES_VERSION},
      calculated_input_version = ${inputVersion},
      calculation_version = calculation_version + 1,
      calculated_at = now()
    WHERE id = ${recordId}
  `);
}

/** Rebuilds the person's month from its records — derived, so always rebuildable (§8.1). */
export async function refreshMonthSummary(
  tx: Tx,
  userId: string,
  date: DateOnly,
): Promise<void> {
  await tx.query(sql`
    INSERT INTO attendance_month_summary (
      organization_id, user_id, month, days, present_units, paid_leave_units, unpaid_leave_units,
      absent_units, holiday_units, worked_minutes, late_days, late_minutes, overtime_minutes,
      night_minutes, wfh_days, open_days, not_evaluated_days, stale_days, updated_at
    )
    SELECT organization_id, user_id, date_trunc('month', work_date)::date, count(*),
           sum(present_units), sum(paid_leave_units), sum(unpaid_leave_units), sum(absent_units),
           sum(holiday_units), sum(worked_minutes), count(*) FILTER (WHERE late_minutes > 0),
           sum(late_minutes), sum(overtime_minutes), sum(night_minutes), count(*) FILTER (WHERE is_wfh),
           count(*) FILTER (WHERE state = 'open'), count(*) FILTER (WHERE status = 'not-evaluated'),
           count(*) FILTER (WHERE calculated_input_version < input_version), now()
    FROM attendance_record
    WHERE user_id = ${userId}
      AND work_date >= date_trunc('month', ${date}::date)
      AND work_date < date_trunc('month', ${date}::date) + interval '1 month'
    GROUP BY organization_id, user_id, date_trunc('month', work_date)
    ON CONFLICT (organization_id, user_id, month) DO UPDATE SET
      days = EXCLUDED.days, present_units = EXCLUDED.present_units, paid_leave_units = EXCLUDED.paid_leave_units,
      unpaid_leave_units = EXCLUDED.unpaid_leave_units, absent_units = EXCLUDED.absent_units,
      holiday_units = EXCLUDED.holiday_units, worked_minutes = EXCLUDED.worked_minutes,
      late_days = EXCLUDED.late_days, late_minutes = EXCLUDED.late_minutes,
      overtime_minutes = EXCLUDED.overtime_minutes, night_minutes = EXCLUDED.night_minutes,
      wfh_days = EXCLUDED.wfh_days, open_days = EXCLUDED.open_days,
      not_evaluated_days = EXCLUDED.not_evaluated_days, stale_days = EXCLUDED.stale_days,
      updated_at = EXCLUDED.updated_at
  `);
}

/**
 * Days whose answer is older than their inputs, and have been for longer than
 * the normal path takes (§8.5), one page at a time in id order.
 */
export async function staleRecords(
  tx: Tx,
  changedBefore: Date,
  after: string | null,
  limit: number,
): Promise<{ id: string; inputVersion: number }[]> {
  return tx.query<{ id: string; inputVersion: number }>(sql`
    SELECT id, input_version FROM attendance_record
    WHERE calculated_input_version < input_version
      AND input_changed_at < ${changedBefore}
      AND (${after}::uuid IS NULL OR id > ${after}::uuid)
    ORDER BY id
    LIMIT ${limit}
  `);
}

/** §8.5: after the third generation fails, the day says so until a later input succeeds. */
export async function flagRecalculationFailed(tx: Tx, recordId: string): Promise<void> {
  await tx.query(sql`
    UPDATE attendance_record SET flags = array_append(flags, 'recalculation-failed')
    WHERE id = ${recordId} AND NOT ('recalculation-failed' = ANY(flags))
  `);
}

/** The person's existing days from `from` to `to` (inclusive; null for no end). */
export async function recordDates(
  tx: Tx,
  userId: string,
  from: DateOnly,
  to: DateOnly | null,
): Promise<DateOnly[]> {
  const rows = await tx.query<{ workDate: DateOnly }>(sql`
    SELECT work_date::text AS work_date FROM attendance_record
    WHERE user_id = ${userId} AND work_date >= ${from} AND (${to}::date IS NULL OR work_date <= ${to}::date)
    ORDER BY work_date
  `);
  return rows.map((row) => row.workDate);
}

/**
 * Who has a day between `from` and `to` that a change could reach: by the
 * department or shift the day was built with (§8.1 "Why a placement
 * snapshot"), which is also what the day is re-resolved with. With neither
 * filter, everyone.
 */
export async function peopleWithDays(
  tx: Tx,
  filter: {
    readonly departmentIds?: readonly string[];
    readonly shiftIds?: readonly string[];
  },
  from: DateOnly,
  to: DateOnly | null,
): Promise<string[]> {
  const departments = [...(filter.departmentIds ?? [])];
  const shifts = [...(filter.shiftIds ?? [])];
  const everyone = departments.length === 0 && shifts.length === 0;
  const rows = await tx.query<{ userId: string }>(sql`
    SELECT DISTINCT r.user_id FROM attendance_record r
    WHERE r.work_date >= ${from} AND (${to}::date IS NULL OR r.work_date <= ${to}::date)
      AND (${everyone}
           OR r.placement_snapshot->>'departmentId' = ANY(${departments}::text[])
           OR r.shift_snapshot->>'shiftId' = ANY(${shifts}::text[]))
    ORDER BY r.user_id
  `);
  return rows.map((row) => row.userId);
}

/* ------------------------------------------------------------------ *
 * Refresh requests — one person's share of a shift or holiday change
 * ------------------------------------------------------------------ */

export interface RefreshRequest {
  id: string;
  userId: string;
  fromDate: DateOnly;
  toDate: DateOnly | null;
  replays: number;
  completedAt: Date | null;
  failedAt: Date | null;
}

const REFRESH_COLUMNS = sql`
  id, user_id, from_date::text AS from_date, to_date::text AS to_date, replays, completed_at, failed_at
`;

/** One request per person for the change `eventId`. A second delivery adds nothing. */
export async function recordRefreshRequests(
  tx: Tx,
  organizationId: string,
  eventId: string,
  userIds: readonly string[],
  from: DateOnly,
  to: DateOnly | null,
): Promise<void> {
  if (userIds.length === 0) return;
  await tx.query(sql`
    INSERT INTO attendance_refresh_request (organization_id, user_id, source_event_id, from_date, to_date)
    SELECT ${organizationId}, person, ${eventId}, ${from}, ${to}::date
    FROM unnest(${[...userIds]}::uuid[]) AS person
    ON CONFLICT (organization_id, source_event_id, user_id) DO NOTHING
  `);
}

/** The change's requests that are neither completed nor failed. */
export async function openRefreshRequestsFor(
  tx: Tx,
  eventId: string,
): Promise<RefreshRequest[]> {
  return tx.query<RefreshRequest>(sql`
    SELECT ${REFRESH_COLUMNS} FROM attendance_refresh_request
    WHERE source_event_id = ${eventId} AND completed_at IS NULL AND failed_at IS NULL
    ORDER BY id
  `);
}

export async function refreshRequest(tx: Tx, id: string): Promise<RefreshRequest | null> {
  return tx.maybeOne<RefreshRequest>(sql`
    SELECT ${REFRESH_COLUMNS} FROM attendance_refresh_request WHERE id = ${id}
  `);
}

export async function completeRefreshRequest(tx: Tx, id: string): Promise<void> {
  await tx.query(sql`
    UPDATE attendance_refresh_request SET completed_at = now()
    WHERE id = ${id} AND completed_at IS NULL AND failed_at IS NULL
  `);
}

/** §5.4: after the third generation fails, the request waits for a person. */
export async function failRefreshRequest(tx: Tx, id: string): Promise<void> {
  await tx.query(sql`
    UPDATE attendance_refresh_request SET failed_at = now()
    WHERE id = ${id} AND completed_at IS NULL AND failed_at IS NULL
  `);
}

/** Requests still open that were written before `requestedBefore`, one page at a time in id order. */
export async function staleRefreshRequests(
  tx: Tx,
  requestedBefore: Date,
  after: string | null,
  limit: number,
): Promise<RefreshRequest[]> {
  return tx.query<RefreshRequest>(sql`
    SELECT ${REFRESH_COLUMNS} FROM attendance_refresh_request
    WHERE completed_at IS NULL AND failed_at IS NULL
      AND requested_at < ${requestedBefore}
      AND (${after}::uuid IS NULL OR id > ${after}::uuid)
    ORDER BY id
    LIMIT ${limit}
  `);
}
```

- [ ] **Create** `packages/server/src/modules/attendance/recalculate.ts`:

```ts
import type { DateOnly } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import type { GenerationDecision } from '../../platform/jobs/generation.js';
import { addDays } from '../../platform/time.js';
import { calculate } from './calculate.js';
import * as calc from './calculation-repository.js';
import { reattribute } from './ledger.js';
import { lockPerson } from './repository.js';

/**
 * Recalculation — design §8.5 (AT-2, AT-I3, AT-I4).
 *
 * Every change to a day's inputs bumps its input version in the transaction
 * that made it and writes `attendance.recalc-requested`; after commit the
 * handler queues one job per record and version. A shift or calendar change
 * arrives as an outbox event instead, and becomes one refresh request per
 * person. Nothing here opens a transaction except the functions that take a
 * context: they run one transaction per person and chunk, so a long range
 * never holds one person's lock for long.
 *
 * Nothing is lost on the way. A stale day and an open refresh request are
 * both durable rows, and the sweeper offers each again until it is done, or
 * flags it for a person after the third failed generation (§5.4).
 */

/** A range is refreshed this many days at a time, one transaction each. */
const CHUNK_DAYS = 31;
/** The sweeper leaves work alone for this long: the normal path is faster (§8.5). */
const STALE_AFTER_MS = 60_000;
const SWEEP_PAGE = 500;

export type RecalculationOutcome = 'calculated' | 'current' | 'missing';

/**
 * The job's work, in the caller's transaction: the person's lock, then the
 * day's row (D24); stop when the stored answer is already for the newest
 * inputs; otherwise load the inputs, calculate, store and rebuild the month.
 *
 * It calculates the inputs as they are now, and records that version. So an
 * older job that runs after newer inputs arrived does the newer job's work,
 * and the newer job then finds nothing to do.
 */
export async function recalculateRecord(
  tx: Tx,
  recordId: string,
): Promise<RecalculationOutcome> {
  const owner = await calc.recordOwner(tx, recordId);
  if (owner === null) return 'missing';
  await lockPerson(tx, owner.userId);
  const record = await calc.lockRecordForCalculation(tx, recordId);
  if (record.calculatedInputVersion >= record.inputVersion) return 'current';

  const result = calculate({
    workDate: record.workDate,
    shift: record.shiftSnapshot,
    closingCap: record.closeDueAt,
    closed: record.state === 'closed',
    dayType: record.dayType,
    // Employment dates do not exist yet (roadmap finding 5): everyone is employed.
    employed: true,
    events: await calc.effectiveEventsForRecord(tx, recordId),
    overlays: await calc.overlaysFor(tx, record.userId, record.workDate),
    // D19: with no break policy, break time is paid. Step 8 brings the policy.
    breaksPaid: true,
    nightWindow: await calc.nightWindowOn(tx, record.workDate),
    attributionFlags: record.attributionFlags,
  });
  await calc.writeCalculation(tx, recordId, record.inputVersion, result);
  await calc.refreshMonthSummary(tx, record.userId, record.workDate);
  return 'calculated';
}

/**
 * `AttendanceFacade.requestRecalculation` (§4) — for a past shift or calendar
 * change (SH-6, HO-3). Refreshes the facts of the days around `dates`, closed
 * ones included, and re-attributes them. Every day whose facts, events or
 * flags moved gets a new input version, and so a recalculation; a day that
 * nothing reached keeps its answer. Dates without a record are left to
 * day-open, which builds them from the shifts as they are then.
 */
export async function requestRecalculation(
  tx: Tx,
  userId: string,
  dates: readonly DateOnly[],
): Promise<void> {
  if (dates.length === 0) return;
  await lockPerson(tx, userId);
  await reattribute(tx, userId, dates, { refreshClosed: true });
}

/** Sorted dates, cut into runs no longer than `days` calendar days. */
export function chunkDates(dates: readonly DateOnly[], days: number): DateOnly[][] {
  const chunks: DateOnly[][] = [];
  for (const date of [...dates].sort()) {
    const current = chunks[chunks.length - 1];
    if (current !== undefined && date <= addDays(current[0]!, days - 1))
      current.push(date);
    else chunks.push([date]);
  }
  return chunks;
}

/**
 * One person's days from `from` to `to` (inclusive; null for no end), 31
 * days per transaction. The day before `from` and the day after `to` are
 * included, because a day's closing edge depends on the next day's shift and
 * its opening edge on the previous one's (§5.2, §6.3). Returns how many days
 * it looked at.
 */
export async function refreshPersonDays(
  ctx: RequestContext,
  userId: string,
  from: DateOnly,
  to: DateOnly | null,
): Promise<number> {
  const dates = await db.transaction(ctx, (tx) =>
    calc.recordDates(tx, userId, addDays(from, -1), to === null ? null : addDays(to, 1)),
  );
  for (const chunk of chunkDates(dates, CHUNK_DAYS)) {
    await db.transaction(ctx, (tx) => requestRecalculation(tx, userId, chunk));
  }
  return dates.length;
}

export interface AffectedScope {
  readonly userIds?: readonly string[];
  readonly departmentIds?: readonly string[];
  readonly shiftIds?: readonly string[];
}

/** Whose days a shift or calendar change reaches: named people, or anyone with a day in reach. */
export async function affectedPeople(
  tx: Tx,
  scope: AffectedScope,
  from: DateOnly,
  to: DateOnly | null,
): Promise<string[]> {
  if (scope.userIds !== undefined) return [...new Set(scope.userIds)].sort();
  const filter = {
    ...(scope.departmentIds === undefined ? {} : { departmentIds: scope.departmentIds }),
    ...(scope.shiftIds === undefined ? {} : { shiftIds: scope.shiftIds }),
  };
  return calc.peopleWithDays(
    tx,
    filter,
    addDays(from, -1),
    to === null ? null : addDays(to, 1),
  );
}

/**
 * The outbox handler's half of a shift or calendar change, in the caller's
 * transaction: one refresh request per person with a day in reach. Once
 * these rows are written the change cannot be lost, because the sweeper
 * offers every open request again until it is done. Returns the change's
 * requests that are still open.
 */
export async function recordRefresh(
  tx: Tx,
  organizationId: string,
  eventId: string,
  scope: AffectedScope,
  from: DateOnly,
  to: DateOnly | null,
): Promise<calc.RefreshRequest[]> {
  const people = await affectedPeople(tx, scope, from, to);
  await calc.recordRefreshRequests(tx, organizationId, eventId, people, from, to);
  return calc.openRefreshRequestsFor(tx, eventId);
}

/** The refresh job's key: the request, and how many times a person has re-armed it. */
export const refreshKey = (request: { readonly id: string; readonly replays: number }) =>
  request.replays === 0 ? request.id : `${request.id}:r${request.replays}`;

/**
 * The `attendance.refresh-days` job: refreshes one request's days, then marks
 * it completed. Running it twice is harmless: the second pass finds nothing to
 * change. Returns how many days it looked at.
 */
export async function runRefreshRequest(
  ctx: RequestContext,
  requestId: string,
): Promise<number> {
  const request = await db.transaction(ctx, (tx) => calc.refreshRequest(tx, requestId));
  if (request === null || request.completedAt !== null || request.failedAt !== null)
    return 0;
  const days = await refreshPersonDays(
    ctx,
    request.userId,
    request.fromDate,
    request.toDate,
  );
  await db.transaction(ctx, (tx) => calc.completeRefreshRequest(tx, requestId));
  return days;
}

/** What a sweep needs from a job (§5.4). */
export interface SweptQueue<P> {
  enqueue(input: { organizationId: string; key: string; payload: P }): Promise<void>;
  nextGeneration(tx: Tx, baseKey: string, now: Date): Promise<GenerationDecision>;
}

interface Offer<P> {
  readonly key: string;
  readonly payload: P;
}

interface SweepPage<P> {
  readonly size: number;
  readonly lastId: string | null;
  readonly offers: readonly Offer<P>[];
  readonly flagged: number;
}

/**
 * Walks a sweep one page at a time, one transaction per page, and queues each
 * page's offers only after that page commits (TX-2).
 */
async function sweepInPages<P>(
  ctx: RequestContext,
  queue: SweptQueue<P>,
  page: (tx: Tx, after: string | null) => Promise<SweepPage<P>>,
): Promise<{ offered: number; flagged: number }> {
  let after: string | null = null;
  let offered = 0;
  let flagged = 0;
  for (;;) {
    const cursor: string | null = after;
    const result: SweepPage<P> = await db.transaction(ctx, (tx) => page(tx, cursor));
    for (const offer of result.offers) {
      await queue.enqueue({ organizationId: ctx.organizationId, ...offer });
    }
    offered += result.offers.length;
    flagged += result.flagged;
    if (result.size < SWEEP_PAGE || result.lastId === null) return { offered, flagged };
    after = result.lastId;
  }
}

/** The recalculation job's key: the record and the input version it was asked for. */
export const recalculationKey = (recordId: string, inputVersion: number) =>
  `${recordId}:${inputVersion}`;

/**
 * The stale sweeper, for days (§8.5): every day stale for more than a minute
 * is offered to the queue again under its next generation, so a lost message
 * cannot leave a day wrong. After the third generation dead-letters, the day
 * is flagged `recalculation-failed` for a person, and stays stale — which
 * keeps it out of a payroll snapshot (§14).
 */
export async function sweepStale(
  ctx: RequestContext,
  queue: SweptQueue<{ recordId: string }>,
  now: Date,
): Promise<{ offered: number; flagged: number }> {
  const changedBefore = new Date(now.getTime() - STALE_AFTER_MS);
  return sweepInPages(ctx, queue, async (tx, after) => {
    const rows = await calc.staleRecords(tx, changedBefore, after, SWEEP_PAGE);
    const offers: Offer<{ recordId: string }>[] = [];
    let flagged = 0;
    for (const row of rows) {
      const decision = await queue.nextGeneration(
        tx,
        recalculationKey(row.id, row.inputVersion),
        now,
      );
      if (decision.kind === 'run')
        offers.push({ key: decision.key, payload: { recordId: row.id } });
      if (decision.kind === 'exhausted') {
        await calc.flagRecalculationFailed(tx, row.id);
        flagged += 1;
      }
    }
    return {
      size: rows.length,
      lastId: rows[rows.length - 1]?.id ?? null,
      offers,
      flagged,
    };
  });
}

/**
 * The stale sweeper, for refresh requests: every request still open a minute
 * after it was written is offered again under its next generation. A key
 * that already finished completes the request. After the third generation
 * dead-letters, the request is marked failed and waits for a person, who can
 * run it again by raising its `replays` (a new key, so generations restart).
 */
export async function sweepRefreshRequests(
  ctx: RequestContext,
  queue: SweptQueue<{ requestId: string }>,
  now: Date,
): Promise<{ offered: number; flagged: number }> {
  const requestedBefore = new Date(now.getTime() - STALE_AFTER_MS);
  return sweepInPages(ctx, queue, async (tx, after) => {
    const rows = await calc.staleRefreshRequests(tx, requestedBefore, after, SWEEP_PAGE);
    const offers: Offer<{ requestId: string }>[] = [];
    let flagged = 0;
    for (const row of rows) {
      const decision = await queue.nextGeneration(tx, refreshKey(row), now);
      if (decision.kind === 'run')
        offers.push({ key: decision.key, payload: { requestId: row.id } });
      if (decision.kind === 'done') await calc.completeRefreshRequest(tx, row.id);
      if (decision.kind === 'exhausted') {
        await calc.failRefreshRequest(tx, row.id);
        flagged += 1;
      }
    }
    return {
      size: rows.length,
      lastId: rows[rows.length - 1]?.id ?? null,
      offers,
      flagged,
    };
  });
}
```

- [ ] **Create** `packages/server/src/modules/attendance/jobs.ts`:

```ts
import type { DateOnly } from '@tapcrm/contracts';
import { createJobContext, systemPrincipal } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { defineJob, type JobHandle } from '../../platform/jobs/runner.js';
import { onOutboxEvent, type OutboxEvent } from '../../platform/outbox/registry.js';
import { addDays } from '../../platform/time.js';
import * as CalendarFacade from '../holidays/facade.js';
import * as ShiftsFacade from '../shifts/facade.js';
import { ATTENDANCE_EVENTS, type RecalcRequested } from './events.js';
import {
  recalculateRecord,
  recalculationKey,
  recordRefresh,
  refreshKey,
  runRefreshRequest,
  sweepRefreshRequests,
  sweepStale,
  type AffectedScope,
} from './recalculate.js';

/**
 * Attendance's jobs and outbox handlers (design §5.4, §5.5, §8.5, §15).
 *
 *   attendance.recalculate     one record, keyed by record and input version
 *   attendance.refresh-days    one refresh request: a person's days after a shift or calendar change
 *   attendance.stale-sweeper   every five minutes, re-offers stale days and open refresh requests
 *
 * Nothing is queued inside a transaction (TX-2): each trigger writes an outbox
 * row, and the handlers below queue the job after it commits.
 */

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/** The handles, for callers outside the schedule: tests, and an operator re-running a sweep. */
export interface AttendanceJobs {
  readonly recalculate: JobHandle<{ recordId: string }>;
  readonly refreshDays: JobHandle<{ requestId: string }>;
  readonly staleSweeper: JobHandle<undefined>;
}

export function registerAttendanceJobs(): AttendanceJobs {
  const recalculateJob = defineJob<{ recordId: string }>({
    name: 'attendance.recalculate',
    perOrganization: true,
    handler: async ({ ctx, payload }) => {
      const outcome = await db.transaction(ctx, (tx) =>
        recalculateRecord(tx, payload.recordId),
      );
      return { itemsProcessed: outcome === 'calculated' ? 1 : 0, details: { outcome } };
    },
  });

  const refreshDaysJob = defineJob<{ requestId: string }>({
    name: 'attendance.refresh-days',
    perOrganization: true,
    handler: async ({ ctx, payload }) => ({
      itemsProcessed: await runRefreshRequest(ctx, payload.requestId),
    }),
  });

  const staleSweeperJob = defineJob({
    name: 'attendance.stale-sweeper',
    perOrganization: true,
    module: 'attendance',
    schedule: { every: FIVE_MINUTES_MS },
    // The next tick is five minutes away; retrying sooner buys nothing.
    attempts: 1,
    handler: async ({ ctx, clock }) => {
      const now = clock.now();
      const days = await sweepStale(ctx, recalculateJob, now);
      const refreshes = await sweepRefreshRequests(ctx, refreshDaysJob, now);
      return {
        itemsProcessed: days.offered + refreshes.offered,
        details: { daysFlagged: days.flagged, refreshesFailed: refreshes.flagged },
      };
    },
  });

  // Idempotent: the job's key is the record and the input version, so a second
  // delivery, or a second request for the same version, is the same job (AT-I4).
  // An ordinary event: if its delivery is lost, the stale sweeper finds the day.
  onOutboxEvent(ATTENDANCE_EVENTS.RECALC_REQUESTED, async (event) => {
    const request = event.payload as RecalcRequested;
    await recalculateJob.enqueue({
      organizationId: event.organizationId,
      key: recalculationKey(request.recordId, request.inputVersion),
      payload: { recordId: request.recordId },
    });
  });

  /** Writes the change's refresh requests, then queues each one still open. */
  async function queueRefresh(
    event: OutboxEvent,
    scope: AffectedScope,
    from: DateOnly,
    to: DateOnly | null,
  ) {
    const ctx = createJobContext({
      organizationId: event.organizationId,
      principal: systemPrincipal(event.organizationId),
      jobName: refreshDaysJob.name,
      runId: event.id,
    });
    const requests = await db.transaction(ctx, (tx) =>
      recordRefresh(tx, event.organizationId, event.id, scope, from, to),
    );
    for (const request of requests) {
      await refreshDaysJob.enqueue({
        organizationId: event.organizationId,
        key: refreshKey(request),
        payload: { requestId: request.id },
      });
    }
  }

  // Idempotent: one request per event and person (a unique key), and each job
  // is keyed by its request. Retried until delivered: until its requests are
  // written, this event is the only record of the change, and nothing else
  // would notice it missing.
  onOutboxEvent(
    ShiftsFacade.SHIFT_EVENTS.DAYS_CHANGED,
    async (event) => {
      const change = event.payload as ShiftsFacade.DaysChanged;
      const scope: AffectedScope = {
        ...(change.userIds === undefined ? {} : { userIds: change.userIds }),
        ...(change.departmentId === undefined
          ? {}
          : { departmentIds: [change.departmentId] }),
        ...(change.shiftId === undefined ? {} : { shiftIds: [change.shiftId] }),
      };
      await queueRefresh(event, scope, change.from, change.to);
    },
    { retryUntilDelivered: true },
  );

  // As above. Holidays send an exclusive end; the refresh takes an inclusive
  // one (see holidays/events.ts).
  onOutboxEvent(
    CalendarFacade.HOLIDAY_EVENTS.DAYS_CHANGED,
    async (event) => {
      const change = event.payload as CalendarFacade.DaysChanged;
      const scope: AffectedScope = {
        ...(change.departmentIds === undefined
          ? {}
          : { departmentIds: change.departmentIds }),
        ...(change.shiftIds === undefined ? {} : { shiftIds: change.shiftIds }),
      };
      const to = change.toExclusive === null ? null : addDays(change.toExclusive, -1);
      await queueRefresh(event, scope, change.from, to);
    },
    { retryUntilDelivered: true },
  );

  return {
    recalculate: recalculateJob,
    refreshDays: refreshDaysJob,
    staleSweeper: staleSweeperJob,
  };
}
```

- [ ] **Export `requestRecalculation`** from `packages/server/src/modules/attendance/facade.ts`:

```diff
--- a/packages/server/src/modules/attendance/facade.ts
+++ b/packages/server/src/modules/attendance/facade.ts
@@ -5,7 +5,8 @@
  * Callers: live-status (step 4), biometric (step 5), leave (step 6), payroll.
  * Step 3a provides the ledger half: appending and retiring events, and the two
  * questions every caller asks — which day owns an event, and which day a
- * person is in.
+ * person is in. Step 3b adds range recalculation, which shifts and holidays
+ * reach through their outbox events rather than by calling it (§4).
  */
 export {
   appendEvent,
@@ -17,4 +18,5 @@ export {
   type RetireResult,
 } from './ledger.js';
 export { registerPresenceProjector } from './ports.js';
+export { requestRecalculation } from './recalculate.js';
 export { ATTENDANCE_EVENTS, type RecalcRequested } from './events.js';
```

- [ ] **Register the jobs** in `packages/server/src/modules/index.ts`:

```diff
--- a/packages/server/src/modules/index.ts
+++ b/packages/server/src/modules/index.ts
@@ -15,6 +15,7 @@ import { registerHolidayRoutes } from './holidays/routes.js';
 import { registerIdentityJobs } from './identity/jobs.js';
 import { registerAccessManagementJobs } from './access-management/jobs.js';
 import { registerAuditJobs } from './audit/jobs.js';
+import { registerAttendanceJobs } from './attendance/jobs.js';
 
 /**
  * The module registry.
@@ -56,4 +57,5 @@ export function registerAllJobs(): void {
   registerIdentityJobs();
   registerAccessManagementJobs();
   registerAuditJobs();
+  registerAttendanceJobs();
 }
```

- [ ] **Update the comment** in `packages/server/src/modules/attendance/events.ts`,
  now that the handler exists:

```diff
--- a/packages/server/src/modules/attendance/events.ts
+++ b/packages/server/src/modules/attendance/events.ts
@@ -2,9 +2,9 @@
  * Outbox events from attendance (design §4).
  *
  * `attendance.recalc-requested` is written for every record whose inputs
- * changed, in the transaction that changed them; its handler (step 3b) queues
+ * changed, in the transaction that changed them; its handler (jobs.ts) queues
  * the recalculation job keyed by record and input version, so duplicates
- * collapse (AT-I4). Until 3b registers the handler, the rows wait.
+ * collapse (AT-I4).
  */
 export const ATTENDANCE_EVENTS = {
   RECALC_REQUESTED: 'attendance.recalc-requested',
```

- [ ] **Run the tests again.** Expected: `Tests  2 passed (2)` for the unit test
  and `Tests  11 passed (11)` for the integration test.

Checkpoint: leave the changes in the working tree for review.

---

## Task 7 — Final check

```bash
npm run typecheck
npx eslint packages/contracts/src packages/server/src/modules/attendance packages/server/src/modules/index.ts \
  packages/server/src/platform/outbox packages/server/src/modules/shifts/resolve.ts \
  packages/server/src/modules/shifts/resolve.test.ts packages/server/src/modules/shifts/repository.ts \
  packages/server/src/modules/shifts/facade.ts packages/server/src/modules/holidays/facade.ts \
  packages/server/src/modules/holidays/repository.ts
npm run ci
npx vitest run --exclude '**/overrides.integration.test.ts'
```

Expected: typecheck and lint clean, `✓ 17 check(s) passed`, and every test
passes (427 with the integration variables and `REDIS_URL` set). This plan
adds 31 + 3 + 2 unit tests and 1 + 2 + 11 database tests, and pins two more
tables.

Then review the working tree (`git status`, `git diff`). Nothing has been committed.

---

## What 3c picks up from here

- **Day-open** (§8.6), forward from the organization's watermark (D21). It
  builds each day with the same facts the pass uses, so a day has one
  definition, and its first calculation is queued like any other.
- **The API** (§8.7): the three routes and the `attendanceRecord` policy. The
  month view reads `attendance_month_summary`; a stale day shows as
  "recalculating".
- **`applyOverlay` / `removeOverlays`**, for leave (step 6) and break
  consequences (step 8). Each bumps the day's input version, so the day
  recalculates through the path built here.
- **The export job.**

## Found while planning — raise with the owners

1. **A new alert name.** `outbox-event-overdue` means "a shift or holiday
   change has failed to reach attendance ten times and is still being tried".
   Whatever pages on `outbox-event-dead-lettered` today should page on it too.
2. **`npm run lint` already fails** on five errors in the step 1 and 2 code:
   four unnecessary type assertions in `shifts/policy.ts` and one in
   `holidays/resolve.ts`. `npx eslint --fix` fixes all five. (A sixth, an
   unused import in `holidays/repository.ts`, is removed in Task 3, because
   that file changes here anyway.)

Still open from 3a: employment dates (roadmap finding 6) and the edges of a
day without fixed times (finding 7).
