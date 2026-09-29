# Step 3 — Attendance core: implementation plan

**Design.** `docs/superpowers/specs/2026-09-22-attendance-shifts-payroll-design.md`
§8 (Step 3), with the attribution half of §5.2 and the shared types of §5.3.
**Roadmap.** `docs/superpowers/plans/2026-09-25-attendance-roadmap.md`.
**Builds on.** Steps 0, 1 and 2 as they are in the repository now.

## Step 3 comes in three parts

Step 3 is the largest step in the roadmap, so it is split into three plans,
each shipped and tested on its own. This document has **3a in full**; 3b and 3c
get their own plans once 3a has landed.

| Part | Builds | Done when |
|---|---|---|
| **3a — the ledger** (this plan) | Event types and the presence state machine (§5.3), the step 3 tables (§8.1), day facts and attribution (§5.2), `appendEvent`, `retireEvent`, `attributeEvent` and `currentDayFor` (§8.4) | Every row of the §5.2 attribution table and the §5.3 same-second table passes; a punch lands on its day with its reason; retiring the 05:02 punch-out moves the 07:30 one back to the night; the ledger refuses updates, deletes, forks, fractions of a second and cross-person links |
| **3b — the answer** | `calculate` (§8.2) and status precedence (§8.3), the recalculation job keyed by record and input version (§8.5), the stale sweeper, the month summary, and the handlers for `attendance.recalc-requested`, `shifts.days-changed` and `holidays.days-changed` | A table-driven calculator suite (every §8.3 worked example, the AT-3 order in the test title), and recalculating twice changes nothing |
| **3c — day-open and the API** | Day-open from a watermark (§8.6), the three routes of §8.7 and the `attendanceRecord` policy, the export job | **Step 3's own done-when:** a fixture month HR has prepared produces exactly the stored records HR signed off, and replaying any day — even after voiding and restoring a punch — gives identical output |

**Done when (3a)** — each proved by a named test:

| Check | Test |
|---|---|
| Every row of the §5.2 attribution table | `attribute.test.ts` › "§5.2 — which day owns an event, row by row" |
| Every row of the §5.3 same-second table, whatever the input order and ids | `presence.test.ts` › "§5.3 — events in the same second" |
| The answer never depends on delivery order | `attribute.test.ts` › "the answer never depends on delivery order" |
| A punch lands on its day, and the day is materialised with its facts | `ledger.integration.test.ts` › "a punch lands on the day that owns it" |
| §8.4 step 9: retiring the 05:02 out moves the 07:30 out back to the night | `ledger.integration.test.ts` › "§8.4 step 9" |
| AT-6, T-6, D34 and "one chain, never a fork" in the database | `ledger.integration.test.ts` |

**How to use this plan.** Do the tasks in order. Each one writes its test
first, watches it fail, adds the code, then watches it pass. Nothing is
committed; each task ends with its changes left for review. All the code
below was run against a copy of the repository with steps 0–2 applied. That
copy is the same as the working tree on `Archi`, apart from the client, which
this step doesn't touch. Typecheck, lint and `npm run ci` (17 checks) are
clean, and all 377 tests pass. The only test left out is the one that already
failed before any of this work.

---

## Read first: a fix to steps 1 and 2

**The shift and holiday tables do not enforce their own rules.** Migration 0001
sets default privileges: every new table gives the app role `SELECT`,
`INSERT`, `UPDATE` and `DELETE`. The `GRANT` lines at the end of 0047 and 0048
were meant to allow less, but a `GRANT` can only add. So today the app role
can:

- delete a shift template (SH-5 says never);
- rewrite or delete a shift version (SH-2);
- delete a holiday (step 2 chose "withdrawn, never deleted").

The step 1 plan introduced this, and step 2 followed the same pattern.
Migrations that have already run cannot be edited, because the migration tool
checks their checksums. So Task 1 adds migration **0049**, which `REVOKE`s what
those tables should never allow. Migration 0050 writes the attendance
restrictions the same way, and a database test fixes the privileges of every
People table so this cannot come back unnoticed.

## Decisions made in this plan

| Question | Decision | Why |
|---|---|---|
| `openFrom` and `closingCap` for a day with no fixed times | The day opens at its window's start and closes at its window's end | §5.2 defines both from "the shift's start and end", which a flexible or no-shift day doesn't have. The window already uses the day's anchor, so the day's edges follow the anchor too. Raised with the owners below |
| No closing extension set yet (Q3) | Treated as 0 minutes | `shift_setting` has no row until HR answers Q3 (G14). Step 7 relies on the extension, and Q3 blocks go-live anyway |
| Where attribution's day flags live | A new `attendance_record.attribution_flags` column. The calculator (3b) copies it into `flags` | §8.1 lists `previous-session-unconfirmed` and `overlapping-arrival` among a day's flags. They are raised by attribution, not by the calculator, so they need somewhere to live between the two |
| `rules_version` before the first calculation | Defaults to `'uncalculated'` | The design has it `NOT NULL` with no default, and a day exists before the calculator (3b) has run on it |
| `appendEvent`, steps 7, 10 and 11 of §8.4 | Not in 3a. Step 7 (web and mobile checks) comes with the punch route in step 4. Step 10 (working out the day's closure again) comes with auto-close in step 7. For step 11, 3a calls the projector port's `refresh` when a projector is registered. The quick-path rules arrive with live-status in step 4 | Nothing can make an interactive punch before G1, nothing closes a day before step 7, and there is no board to update before step 4 |
| Order of the append | The event is inserted, then one neighbourhood pass assigns it with everything around it | §8.4 attributes the new event first so that step 7 knows which day to check. Without step 7, the pass alone gives the same answer: "the neighbourhood pass is the authority" (§8.4). Step 4 adds `attributeEvent` in front, for its checks |
| Void rows in 3a | `retireEvent` writes the system void row. It is the one way 3a has to retract an event, and the test of §8.4 step 9 depends on it | Step 5 uses it for displaced duplicates and step 7 for retiring auto-outs. Corrections are step 7's own flow |
| Overlays and settings tables | Created now, used from 3b | All of §8.1 in one migration. The foreign keys to `leave_request` and `break_breach` come with steps 6 and 8, as §8.1 says |

## Files

| File | What |
|---|---|
| `migrations/0049_people_privileges.sql` | Revokes what the shift and holiday tables should never allow |
| `packages/contracts/src/people.ts`, `index.ts` | Event types: `EventKind`, `EventSource`, `Evidence`, `AssignmentReason`, `PINNED_REASONS`, `AttendanceEventInput` |
| `packages/contracts/src/presence.ts` (+ test) | `PRESENCE`, `nextState`, `allowedMoves`, `KIND_ORDER`, `compareEvents`, `readDay`, the `PresenceProjector` port |
| `migrations/0050_attendance.sql` | The eight tables of §8.1, with RLS, same-person keys and revoked privileges |
| `platform/modules/people-privileges.integration.test.ts` | Pins what the app role may do to every People table |
| `modules/shifts/facade.ts` | `shiftDays`: each date's shift and window, in one read |
| `modules/attendance/day-facts.ts` | `openFrom`, `closingCap` and the eligibility window (§5.2, §8.5) |
| `modules/attendance/attribute.ts` (+ test, helpers) | The four attribution rules and `currentDay` (§5.2) |
| `modules/attendance/errors.ts`, `events.ts`, `ports.ts` | Error codes, the recalculation outbox event, the projector port |
| `modules/attendance/repository.ts`, `ledger.ts`, `facade.ts` (+ integration test) | The ledger: append, retire, the neighbourhood pass, the two questions |
| `tools/ci/tables.ts`, `presence-rules.ts` (+ test), `index.ts` | Attendance owns its tables; D26, one presence state machine |

(`platform/…` and `modules/…` are under `packages/server/src/`.)

---

## Task 1 — Revoke what the shift and holiday tables should never allow

- [ ] **Create** `migrations/0049_people_privileges.sql`:

```sql
-- =====================================================================
-- 0049 - Privileges for the shift and holiday tables
--
-- Migration 0001 sets default privileges: every table a migration creates
-- gives the app role SELECT, INSERT, UPDATE and DELETE. The GRANT lines in
-- 0047 and 0048 were meant to narrow that, but a GRANT only adds, so the
-- rules they wrote down were not enforced: the app role could delete a
-- template (SH-5), rewrite a version (SH-2) or delete a holiday (HO-3).
-- These REVOKEs make the database say what those migrations meant.
-- =====================================================================

REVOKE DELETE ON shift FROM tapcrm_app;                          -- SH-5: deactivated, never deleted
REVOKE UPDATE, DELETE ON shift_version FROM tapcrm_app;          -- SH-2: a change is a new version
REVOKE DELETE ON shift_rotation FROM tapcrm_app;
REVOKE UPDATE, DELETE ON shift_rotation_day FROM tapcrm_app;
REVOKE DELETE ON shift_assignment FROM tapcrm_app;               -- ended by effective_to, never removed
REVOKE DELETE ON shift_request FROM tapcrm_app;
REVOKE UPDATE ON shift_override FROM tapcrm_app;                 -- replaced, never edited
REVOKE DELETE ON department_shift_default FROM tapcrm_app;
REVOKE UPDATE, DELETE ON shift_setting FROM tapcrm_app;          -- D35: a change is a new dated row

REVOKE DELETE ON holiday FROM tapcrm_app;                        -- withdrawn, never deleted (HO-3)
REVOKE UPDATE ON holiday_scope FROM tapcrm_app;                  -- replaced, never edited
```

- [ ] **Apply and look:**

```bash
npm run migrate
psql "$MIGRATION_DATABASE_URL" -c "ALTER ROLE tapcrm_app LOGIN PASSWORD 'app_test_password';"
psql "$MIGRATION_DATABASE_URL" -Atc "SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) FROM information_schema.table_privileges WHERE grantee = 'tapcrm_app' AND table_name IN ('shift', 'shift_version', 'holiday') GROUP BY table_name"
```

Expected:

```
holiday|INSERT,SELECT,UPDATE
shift|INSERT,SELECT,UPDATE
shift_version|INSERT,SELECT
```

Task 3 turns this into a test covering every People table.

- [ ] **Check nothing relied on it:** `npx vitest run packages/server/src/modules/shifts packages/server/src/modules/holidays`
  (integration variables set) — all pass. Shifts only deletes overrides, and
  holidays only deletes scope rows, and both of those privileges stay.

Checkpoint: leave the changes in the working tree for review.

---

## Task 2 — Event types and the presence state machine (§5.3, §9.1, D26, D31, D32)

Declared once, in `contracts`, and imported by attendance now and live-status
in step 4. `readDay` is **the** reading of a day. Every later piece takes its
arrival, departure, breaks and state from it: attribution, the calculator,
auto-close and the board. So there is one answer to "when did this day end".

- [ ] **Add the event types** to `packages/contracts/src/people.ts`:

```diff
--- a/packages/contracts/src/people.ts
+++ b/packages/contracts/src/people.ts
@@ -3,8 +3,8 @@
  * biometric, leave, breaks and payroll (attendance design §5.3).
  *
  * Types only. Step 0 added the date types; step 1 the shift types; step 2 the
- * calendar types. Later steps add the event types here, and the presence
- * state machine beside it.
+ * calendar types; step 3 the event types. The presence state machine that
+ * reads events lives beside this file, in presence.ts.
  */
 
 /** A calendar day in the organization's timezone, 'YYYY-MM-DD' (T-1). */
@@ -70,3 +70,47 @@ export interface ResolvedDay {
    */
   matchedBy: 'national' | 'department' | 'shift' | null;
 }
+
+/* ------------------------------------------------------------------ *
+ * Attendance events (design §5.3, §8.1) — step 3
+ * ------------------------------------------------------------------ */
+
+export type EventKind = 'in' | 'out' | 'break-start' | 'break-end' | 'scan' | 'auto-out';
+export type EventSource =
+  'device' | 'web' | 'mobile' | 'correction' | 'system' | 'import';
+
+/** Stamped when an event is recorded, never re-derived (D29). */
+export type Evidence = 'confirmed' | 'assumed';
+
+/** Why a day owns an event (§8.1). */
+export type AssignmentReason =
+  | 'midpoint'
+  | 'closing-extension'
+  | 'opening-pull-forward'
+  | 'next-shift-started' // the next shift had started, or started with this event (§5.2)
+  | 'system-close' // a closing auto-out (§12.3)
+  | 'reconciliation' // a void row retiring an auto-out or a displaced duplicate (§12.4, §10.3)
+  | 'correction'
+  | 'import';
+
+/** Pinned assignments are never moved by automatic re-attribution (§8.1). */
+export const PINNED_REASONS: readonly AssignmentReason[] = [
+  'correction',
+  'system-close',
+  'reconciliation',
+];
+
+/**
+ * Effective events only: superseded rows and void (tombstone) rows never reach
+ * the calculator, attribution or presence replay (§8.1, D28).
+ */
+export interface AttendanceEventInput {
+  id: string;
+  kind: EventKind;
+  /** ISO instant, whole seconds (T-6), already clock-corrected. */
+  at: string;
+  source: EventSource;
+  evidence: Evidence;
+  /** Why this day owns it (§8.1). */
+  assignmentReason: AssignmentReason;
+}
```

- [ ] **Write the test** — `packages/contracts/src/presence.test.ts`. Every row of
  the same-second table in §5.3, each read in several orders and with the ids
  renamed, to show that neither matters:

```ts
import { describe, expect, it } from 'vitest';
import type { AttendanceEventInput, EventKind, EventSource, Evidence } from './people.js';
import {
  KIND_ORDER,
  PRESENCE,
  allowedMoves,
  compareEvents,
  nextState,
  readDay,
  type EligibilityWindow,
} from './presence.js';

let counter = 0;
function event(
  kind: EventKind,
  at: string,
  extra: { source?: EventSource; evidence?: Evidence; id?: string } = {},
): AttendanceEventInput {
  counter += 1;
  return {
    id: extra.id ?? `e${counter}`,
    kind,
    at: `2026-09-28T${at}Z`,
    source: extra.source ?? (kind === 'scan' || kind === 'auto-out' ? 'device' : 'web'),
    evidence:
      extra.evidence ??
      (kind === 'scan' || kind === 'auto-out' ? 'assumed' : 'confirmed'),
    assignmentReason: 'midpoint',
  };
}

/** Every permutation would be slow; reversing and rotating is enough to catch an order dependence. */
function orders<T>(items: readonly T[]): T[][] {
  const out: T[][] = [[...items], [...items].reverse()];
  for (let shift = 1; shift < items.length; shift += 1)
    out.push([...items.slice(shift), ...items.slice(0, shift)]);
  return out;
}

/** Renames ids to prove nothing reads them. */
const renamed = (events: readonly AttendanceEventInput[]) =>
  events.map((e, i) => ({ ...e, id: `z${events.length - i}` }));

function everyWay(
  events: readonly AttendanceEventInput[],
  window: EligibilityWindow = null,
) {
  const first = readDay(events, window);
  for (const order of orders(events)) {
    const again = readDay(order, window);
    expect(again.arrival?.at).toBe(first.arrival?.at);
    expect(again.departure?.at).toBe(first.departure?.at);
    expect(again.state).toBe(first.state);
    const other = readDay(renamed(order), window);
    expect(other.departure?.at).toBe(first.departure?.at);
    expect(other.state).toBe(first.state);
  }
  return first;
}

describe('the state machine is data (§9.1)', () => {
  it('declares the four states and their moves', () => {
    expect(allowedMoves('NOT_IN')).toEqual(['in', 'scan']);
    expect(nextState('WORKING', 'out')).toBe('FINISHED');
    expect(nextState('ON_BREAK', 'scan')).toBe('WORKING');
    expect(allowedMoves('FINISHED')).toEqual([]);
    expect(Object.keys(PRESENCE)).toEqual(['NOT_IN', 'WORKING', 'ON_BREAK', 'FINISHED']);
  });

  it('D32: orders by second, then out, in, scan, break-start, break-end, auto-out', () => {
    expect(KIND_ORDER).toEqual([
      'out',
      'in',
      'scan',
      'break-start',
      'break-end',
      'auto-out',
    ]);
    expect(
      compareEvents(event('in', '09:00:00'), event('out', '09:00:00')),
    ).toBeGreaterThan(0);
    expect(compareEvents(event('in', '09:00:00'), event('in', '09:00:00'))).toBe(0);
    expect(
      compareEvents(event('out', '09:00:01'), event('auto-out', '09:00:00')),
    ).toBeGreaterThan(0);
  });
});

describe('§5.3 — events in the same second, every row of the table', () => {
  it('`in` and `out`, nothing open: arrival at that second, no departure, the `out` conflicting', () => {
    const out = event('out', '09:00:00');
    const reading = everyWay([event('in', '09:00:00'), out]);
    expect(reading.arrival?.at).toBe('2026-09-28T09:00:00.000Z');
    expect(reading.departure).toBeNull();
    expect(reading.state).toBe('WORKING');
    expect(readDay([event('in', '09:00:00'), out], null).notApplied.get(out.id)).toBe(
      'at-arrival-instant',
    );
  });

  it('`scan` and `out`, nothing open: the same', () => {
    const reading = everyWay([event('scan', '09:00:00'), event('out', '09:00:00')]);
    expect(reading.arrival?.kind).toBe('scan');
    expect(reading.departure).toBeNull();
  });

  it('`out` then `in` in one second with a session open ends it first', () => {
    const reading = everyWay([
      event('in', '01:00:00'),
      event('out', '07:30:00'),
      event('in', '07:30:00'),
    ]);
    expect(reading.departure?.at).toBe('2026-09-28T07:30:00.000Z');
    expect(reading.state).toBe('FINISHED');
  });

  it('`in` and `break-start`: arrived, and on break from that second', () => {
    const reading = everyWay([event('break-start', '09:00:00'), event('in', '09:00:00')]);
    expect(reading.state).toBe('ON_BREAK');
    expect(reading.breaks).toEqual([{ from: '2026-09-28T09:00:00.000Z', to: null }]);
  });

  it('`break-start` and `break-end`: a zero-length break', () => {
    const reading = everyWay([
      event('in', '09:00:00'),
      event('break-end', '12:00:00'),
      event('break-start', '12:00:00'),
    ]);
    expect(reading.breaks).toEqual([
      { from: '2026-09-28T12:00:00.000Z', to: '2026-09-28T12:00:00.000Z' },
    ]);
    expect(reading.state).toBe('WORKING');
  });

  it('the last event and an `auto-out`: the auto-out is the departure, even in the arrival’s second', () => {
    const reading = everyWay([event('auto-out', '09:00:00'), event('scan', '09:00:00')]);
    expect(reading.departure?.kind).toBe('auto-out');
  });

  it('two of one kind in one second are one arrival, confirmed if either is', () => {
    const reading = everyWay([
      event('in', '09:00:00', { source: 'device', evidence: 'assumed' }),
      event('in', '09:00:00', { source: 'web', evidence: 'confirmed' }),
    ]);
    expect(reading.arrival?.evidence).toBe('confirmed');
    expect(reading.arrival?.eventIds).toHaveLength(2);
  });
});

describe('D31 — one arrival, one departure', () => {
  it('a double exit swipe at 05:00 and 05:10 is a 05:00 departure; 05:10 is evidence', () => {
    const late = event('out', '05:10:00');
    const reading = readDay(
      [event('in', '00:00:00'), event('out', '05:00:00'), late],
      null,
    );
    expect(reading.departure?.at).toBe('2026-09-28T05:00:00.000Z');
    expect(reading.notApplied.get(late.id)).toBe('after-departure');
  });

  it('an `out` with nothing open is before-arrival, a second `in` is no-move', () => {
    const early = event('out', '08:00:00');
    const second = event('in', '09:30:00');
    const reading = readDay([early, event('in', '09:00:00'), second], null);
    expect(reading.notApplied.get(early.id)).toBe('before-arrival');
    expect(reading.notApplied.get(second.id)).toBe('no-move');
  });

  it('a scan while on break ends the break; a break open at departure ends there', () => {
    const reading = readDay(
      [
        event('in', '09:00:00'),
        event('break-start', '12:00:00'),
        event('scan', '12:40:00'),
        event('break-start', '16:00:00'),
        event('out', '18:00:00'),
      ],
      null,
    );
    expect(reading.breaks).toEqual([
      { from: '2026-09-28T12:00:00.000Z', to: '2026-09-28T12:40:00.000Z' },
      { from: '2026-09-28T16:00:00.000Z', to: '2026-09-28T18:00:00.000Z' },
    ]);
  });
});

describe('§8.2 — the eligibility window', () => {
  const window = { from: '2026-09-28T06:00:00.000Z', to: '2026-09-28T22:00:00.000Z' };

  it('an event outside it is kept, flagged, and never the arrival', () => {
    const stray = event('scan', '05:30:00');
    const reading = readDay([stray, event('in', '08:55:00')], window);
    expect(reading.notApplied.get(stray.id)).toBe('outside-window');
    expect(reading.arrival?.at).toBe('2026-09-28T08:55:00.000Z');
  });

  it('D36: what a correction adds counts wherever it falls', () => {
    const reading = readDay([event('in', '05:30:00', { source: 'correction' })], window);
    expect(reading.arrival?.at).toBe('2026-09-28T05:30:00.000Z');
  });

  it('flexible and no-shift days have no window: everything is eligible', () => {
    expect(readDay([event('in', '02:00:00')], null).arrival?.at).toBe(
      '2026-09-28T02:00:00.000Z',
    );
  });
});
```

- [ ] **Run it and watch it fail:** `npx vitest run packages/contracts/src/presence.test.ts`
  — expected: `Error: Failed to load url ./presence.js … Does the file exist?`

- [ ] **Create** `packages/contracts/src/presence.ts`:

```ts
import type { AttendanceEventInput, EventKind, Evidence } from './people.js';

/**
 * The presence state machine — design §5.3, §9.1, D26, D31, D32.
 *
 * Declared once, here, and imported by attendance and live-status. Neither
 * module declares a transition of its own. Pure data and pure functions: no
 * table, no tenancy, no I/O.
 */

export type PresenceState = 'NOT_IN' | 'WORKING' | 'ON_BREAK' | 'FINISHED';

export const PRESENCE: Readonly<
  Record<PresenceState, Readonly<Partial<Record<EventKind, PresenceState>>>>
> = {
  NOT_IN: { in: 'WORKING', scan: 'WORKING' },
  WORKING: {
    'break-start': 'ON_BREAK',
    scan: 'WORKING',
    out: 'FINISHED',
    'auto-out': 'FINISHED',
  },
  ON_BREAK: {
    'break-end': 'WORKING',
    scan: 'WORKING',
    out: 'FINISHED',
    'auto-out': 'FINISHED',
  },
  // Nothing reopens a finished day; later events are kept and flagged.
  FINISHED: {},
};

export function nextState(from: PresenceState, kind: EventKind): PresenceState | null {
  return PRESENCE[from][kind] ?? null;
}

export function allowedMoves(from: PresenceState): EventKind[] {
  return Object.keys(PRESENCE[from]) as EventKind[];
}

/**
 * D32 — the order of a day's events: by instant, then by this list. An `out`
 * comes first, so it ends what is open before anything new starts in that
 * second, and can never be the departure of an arrival in the same second.
 * A system `auto-out` is last.
 */
export const KIND_ORDER: readonly EventKind[] = [
  'out',
  'in',
  'scan',
  'break-start',
  'break-end',
  'auto-out',
];

const kindRank = (kind: EventKind): number => KIND_ORDER.indexOf(kind);

/**
 * Negative, zero or positive. Zero means one piece of evidence: same second,
 * same kind. Never looks at ids, sources or when a row was written.
 */
export function compareEvents(
  a: Pick<AttendanceEventInput, 'at' | 'kind'>,
  b: Pick<AttendanceEventInput, 'at' | 'kind'>,
): number {
  return Date.parse(a.at) - Date.parse(b.at) || kindRank(a.kind) - kindRank(b.kind);
}

/**
 * A day's eligibility window (§8.2); null for flexible and no-shift days,
 * where everything assigned to the day is eligible. What a correction adds is
 * eligible wherever it falls (D36).
 */
export type EligibilityWindow = { readonly from: string; readonly to: string } | null;

export interface DayStep {
  readonly at: string;
  readonly kind: EventKind;
  readonly evidence: Evidence;
  /** Every event of this kind in this second: one piece of evidence. */
  readonly eventIds: readonly string[];
}

export type NotApplied =
  | 'outside-window' // not eligible for this day (§8.2)
  | 'before-arrival' // an `out` or a break with nothing open
  | 'at-arrival-instant' // an `out` in the arrival's own second: conflicting evidence
  | 'after-departure' // after the departure in the order
  | 'no-move'; // no move from the state it met, e.g. a second `in`

export interface DayReading {
  readonly state: PresenceState;
  /** The ONE arrival (D31). */
  readonly arrival: DayStep | null;
  /** The ONE departure (D31). */
  readonly departure: DayStep | null;
  /** The ON_BREAK stretches; `to` is null while a break is still open. */
  readonly breaks: readonly { readonly from: string; readonly to: string | null }[];
  /** Every event that moved nothing, and why. */
  readonly notApplied: ReadonlyMap<string, NotApplied>;
}

const ARRIVALS: readonly EventKind[] = ['in', 'scan'];

function eligible(event: AttendanceEventInput, window: EligibilityWindow): boolean {
  if (window === null || event.source === 'correction') return true;
  const at = Date.parse(event.at);
  return at >= Date.parse(window.from) && at <= Date.parse(window.to);
}

interface Group extends DayStep {
  readonly sortKey: Pick<AttendanceEventInput, 'at' | 'kind'>;
}

/** Same second and kind: one piece of evidence, confirmed if any member is (D32). */
function groupEvents(events: readonly AttendanceEventInput[]): Group[] {
  const groups = new Map<
    string,
    { at: string; kind: EventKind; confirmed: boolean; ids: string[] }
  >();
  for (const event of events) {
    const second = new Date(Math.floor(Date.parse(event.at) / 1000) * 1000).toISOString();
    const key = `${second}|${event.kind}`;
    const group = groups.get(key) ?? {
      at: second,
      kind: event.kind,
      confirmed: false,
      ids: [],
    };
    group.confirmed ||= event.evidence === 'confirmed';
    group.ids.push(event.id);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      at: group.at,
      kind: group.kind,
      evidence: group.confirmed ? ('confirmed' as const) : ('assumed' as const),
      eventIds: [...group.ids].sort(),
      sortKey: { at: group.at, kind: group.kind },
    }))
    .sort((a, b) => compareEvents(a.sortKey, b.sortKey));
}

const step = (group: Group): DayStep => ({
  at: group.at,
  kind: group.kind,
  evidence: group.evidence,
  eventIds: group.eventIds,
});

/**
 * THE reading of a day (D31, D32): its eligible effective events, grouped by
 * second and kind, walked through PRESENCE in the order above. Nothing else
 * puts a day's events in order.
 */
export function readDay(
  events: readonly AttendanceEventInput[],
  window: EligibilityWindow,
): DayReading {
  const notApplied = new Map<string, NotApplied>();
  const counted: AttendanceEventInput[] = [];
  for (const event of events) {
    if (eligible(event, window)) counted.push(event);
    else notApplied.set(event.id, 'outside-window');
  }
  const groups = groupEvents(counted);

  let state: PresenceState = 'NOT_IN';
  let arrival: DayStep | null = null;
  let departure: DayStep | null = null;
  const breaks: { from: string; to: string | null }[] = [];
  const mark = (group: Group, why: NotApplied) => {
    for (const id of group.eventIds) notApplied.set(id, why);
  };

  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index]!;
    if (departure !== null) {
      mark(group, 'after-departure');
      continue;
    }
    const next = nextState(state, group.kind);
    if (next === null) {
      if (state !== 'NOT_IN') {
        mark(group, 'no-move');
        continue;
      }
      // Nothing is open. An `out` in the second the day arrives is conflicting
      // evidence, not a departure (D32).
      const arrivesThisSecond = groups
        .slice(index + 1)
        .some((later) => later.at === group.at && ARRIVALS.includes(later.kind));
      const endsSomething = group.kind === 'out' || group.kind === 'auto-out';
      mark(
        group,
        endsSomething && arrivesThisSecond ? 'at-arrival-instant' : 'before-arrival',
      );
      continue;
    }
    if (state === 'NOT_IN') arrival = step(group);
    if (state === 'ON_BREAK' && next !== 'ON_BREAK') {
      const open = breaks[breaks.length - 1];
      if (open !== undefined && open.to === null) open.to = group.at;
    }
    if (next === 'ON_BREAK' && state !== 'ON_BREAK')
      breaks.push({ from: group.at, to: null });
    if (next === 'FINISHED') departure = step(group);
    state = next;
  }

  return { state, arrival, departure, breaks, notApplied };
}

export const arrivalOf = (
  events: readonly AttendanceEventInput[],
  window: EligibilityWindow,
) => readDay(events, window).arrival;
export const departureOf = (
  events: readonly AttendanceEventInput[],
  window: EligibilityWindow,
) => readDay(events, window).departure;
export const replay = (
  events: readonly AttendanceEventInput[],
  window: EligibilityWindow,
) => readDay(events, window).state;

/**
 * The port live-status implements and attendance calls inside `appendEvent`
 * (design §4, LS-1). Generic over the transaction type, because contracts
 * knows nothing about the database.
 */
export interface PresenceProjector<Tx> {
  /** One step of the state machine, for an eligible punch later than everything on its day. */
  apply(tx: Tx, userId: string, event: AttendanceEventInput): Promise<void>;
  /** Rebuild the person's row from their current day's effective events. */
  refresh(tx: Tx, userId: string, now: Date): Promise<void>;
}
```

- [ ] **Export it** from `packages/contracts/src/index.ts`:

```diff
--- a/packages/contracts/src/index.ts
+++ b/packages/contracts/src/index.ts
@@ -22,3 +22,4 @@ export * from './actionMetadata.js';
 export * from './principal.js';
 export * from './platform.js';
 export * from './people.js';
+export * from './presence.js';
```

- [ ] **Run the test again.** Expected: `Tests  15 passed (15)`.

Checkpoint: leave the changes in the working tree for review.

---

## Task 3 — Migration 0050: the attendance tables (§8.1)

The design's SQL, with four additions. Each is marked in a comment in the
migration:

- the `attribution_flags` column;
- the `'uncalculated'` default for `rules_version`;
- a check that a window ends after it starts;
- `REVOKE`s instead of `GRANT`s. The ledger is append-only for the app role:
  no update, no delete.

- [ ] **Write the test** —
  `packages/server/src/platform/modules/people-privileges.integration.test.ts`:

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { platformDb } from '../dal/db.js';
import { closePools } from '../dal/pool.js';
import { sql } from '../dal/sql.js';

/**
 * What the app role may do to each People table (migrations 0047–0050).
 * Migration 0001 grants every new table SELECT, INSERT, UPDATE and DELETE by
 * default, so a rule like "never deleted" or "append-only" holds only if a
 * migration revokes the rest. This pins the result, table by table.
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';

const EXPECTED: Record<string, string> = {
  shift: 'INSERT,SELECT,UPDATE',
  shift_version: 'INSERT,SELECT',
  shift_rotation: 'INSERT,SELECT,UPDATE',
  shift_rotation_day: 'INSERT,SELECT',
  shift_assignment: 'INSERT,SELECT,UPDATE',
  shift_request: 'INSERT,SELECT,UPDATE',
  shift_override: 'DELETE,INSERT,SELECT',
  department_shift_default: 'INSERT,SELECT,UPDATE',
  shift_setting: 'INSERT,SELECT',
  holiday: 'INSERT,SELECT,UPDATE',
  holiday_scope: 'DELETE,INSERT,SELECT',
  attendance_event: 'INSERT,SELECT',
  attendance_record: 'INSERT,SELECT,UPDATE',
  attendance_event_assignment: 'DELETE,INSERT,SELECT,UPDATE',
  attendance_overlay: 'DELETE,INSERT,SELECT',
  attendance_setting: 'INSERT,SELECT',
  arrival_policy_override: 'INSERT,SELECT,UPDATE',
  arrival_exception: 'INSERT,SELECT',
  attendance_day_open_state: 'INSERT,SELECT,UPDATE',
};

describe.skipIf(!enabled)('People table privileges for the app role (PostgreSQL)', () => {
  afterAll(async () => {
    await closePools();
  });

  it('each table allows exactly what its rules need', async () => {
    const rows = await platformDb.query<{ tableName: string; privileges: string }>(
      'migration',
      'read People table privileges',
      sql`
      SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
      FROM information_schema.table_privileges
      WHERE grantee = 'tapcrm_app' AND table_name = ANY(${Object.keys(EXPECTED)}::text[])
        AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
      GROUP BY table_name`,
    );
    const actual = Object.fromEntries(rows.map((row) => [row.tableName, row.privileges]));
    expect(actual).toEqual(EXPECTED);
  });
});
```

- [ ] **Run it and watch it fail** (integration variables set) — expected: the
  attendance tables are missing from the result.

- [ ] **Create** `migrations/0050_attendance.sql`:

```sql
-- =====================================================================
-- 0050 - Attendance core (attendance design, step 3, §8.1)
--
-- The event ledger (append-only), one record per person per day, the
-- stored answer to "which day owns this event", and the dated settings a
-- day is judged by. Every link between two of one person's rows carries
-- user_id (D34), so the database refuses a punch on a colleague's day.
-- =====================================================================

CREATE TABLE attendance_event (                 -- append-only (AT-6)
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id     uuid NOT NULL REFERENCES organization(id),
  user_id             uuid NOT NULL,
  kind                text NOT NULL
                        CHECK (kind IN ('in', 'out', 'break-start', 'break-end', 'scan', 'auto-out')),
  occurred_at         timestamptz NOT NULL,       -- corrected instant; the owning day is an assignment
  source              text NOT NULL
                        CHECK (source IN ('device', 'web', 'mobile', 'correction', 'system', 'import')),
  evidence            text NOT NULL CHECK (evidence IN ('confirmed', 'assumed')),   -- D29
  biometric_punch_id  uuid,                       -- source = device; its foreign key arrives in step 5
  correction_id       uuid,                       -- source = correction; its foreign key arrives in step 7
  supersedes_event_id uuid,                       -- the earlier event this one replaces or voids
  is_void             boolean NOT NULL DEFAULT false,
  remote              boolean NOT NULL DEFAULT false,   -- a web or mobile punch
  client_event_id     text,                       -- offline idempotency (NF-19, TX-7)
  client_request_hash text,                       -- same key + different request = 409
  client_time         timestamptz,                -- what an offline client said (D13)
  recorded_by         uuid,                       -- NULL for device and system events
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, user_id, id),          -- target key for same-person supersession
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, user_id, supersedes_event_id)
    REFERENCES attendance_event (organization_id, user_id, id),
  -- Only a correction or the system supersedes; a device or web punch is a fact.
  CHECK (supersedes_event_id IS NULL OR source IN ('correction', 'system')),
  CHECK ((source = 'device') = (biometric_punch_id IS NOT NULL)),
  CHECK (source <> 'correction' OR correction_id IS NOT NULL),
  CHECK (correction_id IS NULL OR source IN ('correction', 'system')),
  CHECK (NOT is_void OR supersedes_event_id IS NOT NULL),
  CHECK (supersedes_event_id IS NULL OR supersedes_event_id <> id),
  -- A scan and a system auto-out are never confirmed; a web or mobile punch always is.
  CHECK (kind NOT IN ('scan', 'auto-out') OR evidence = 'assumed'),
  CHECK (source NOT IN ('web', 'mobile') OR evidence = 'confirmed'),
  -- A correction states an arrival, departure or break, always confirmed; a void row copies its target.
  CHECK (source <> 'correction' OR is_void
         OR (evidence = 'confirmed' AND kind IN ('in', 'out', 'break-start', 'break-end'))),
  -- Whole seconds (T-6).
  CHECK (date_trunc('second', occurred_at) = occurred_at)
);
CREATE INDEX ix_attendance_event_user_time ON attendance_event (organization_id, user_id, occurred_at);
CREATE UNIQUE INDEX ux_attendance_event_client
  ON attendance_event (organization_id, user_id, client_event_id) WHERE client_event_id IS NOT NULL;
-- One chain, never a fork: an event is superseded or retracted once, and once only.
CREATE UNIQUE INDEX ux_attendance_event_supersedes
  ON attendance_event (organization_id, supersedes_event_id) WHERE supersedes_event_id IS NOT NULL;

CREATE TABLE attendance_record (
  id                       uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id          uuid NOT NULL REFERENCES organization(id),
  user_id                  uuid NOT NULL,
  work_date                date NOT NULL,
  window_start             timestamptz NOT NULL,  -- §5.2
  window_end               timestamptz NOT NULL,
  state                    text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed')),
  close_due_at             timestamptz NOT NULL,  -- = closingCap (§5.2); NOT capped by window_end
  shift_snapshot           jsonb NOT NULL,        -- ResolvedShift (SH-2, AT-I2)
  shift_source             text NOT NULL,
  placement_snapshot       jsonb NOT NULL,        -- department, team and position when materialised
  day_type                 text NOT NULL CHECK (day_type IN ('working', 'week-off', 'holiday', 'not-employed')),
  status                   text CHECK (status IN ('present', 'half-day', 'absent', 'leave', 'half-day-leave',
                                                  'holiday', 'not-evaluated', 'not-employed')),
  present_units            smallint NOT NULL DEFAULT 0,   -- half-day units (D7)
  paid_leave_units         smallint NOT NULL DEFAULT 0,
  unpaid_leave_units       smallint NOT NULL DEFAULT 0,
  absent_units             smallint NOT NULL DEFAULT 0,
  holiday_units            smallint NOT NULL DEFAULT 0,
  worked_minutes           integer NOT NULL DEFAULT 0,
  break_minutes            integer NOT NULL DEFAULT 0,
  late_minutes             integer NOT NULL DEFAULT 0,
  early_exit_minutes       integer NOT NULL DEFAULT 0,
  overtime_minutes         integer NOT NULL DEFAULT 0,
  night_minutes            integer NOT NULL DEFAULT 0,    -- §6.6
  arrival_at               timestamptz,                   -- readDay's arrival and departure (§5.3)
  departure_at             timestamptz,
  is_wfh                   boolean NOT NULL DEFAULT false,
  flags                    text[] NOT NULL DEFAULT '{}',
  -- Flags attribution raises about this day (previous-session-unconfirmed,
  -- overlapping-arrival). Written by the re-attribution pass; the calculator
  -- (step 3b) copies them into `flags`.
  attribution_flags        text[] NOT NULL DEFAULT '{}',
  provenance               jsonb NOT NULL DEFAULT '{}',   -- AT-12
  input_version            integer NOT NULL DEFAULT 1,    -- bumped by every input change
  calculated_input_version integer NOT NULL DEFAULT 0,
  calculation_version      integer NOT NULL DEFAULT 0,    -- AT-I3
  breaks_evaluated_version integer,                       -- break-management's watermark (§13)
  rules_version            text NOT NULL DEFAULT 'uncalculated',  -- the calculator's code version
  calculated_at            timestamptz,
  closed_at                timestamptz,
  closed_by                text CHECK (closed_by IN ('punch-out', 'auto-close', 'no-show', 'correction')),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, user_id, id),                 -- the assignment's same-person key (D34)
  UNIQUE (organization_id, user_id, work_date),          -- ux_attendance_day (TECH §5.5)
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  CHECK (window_end > window_start),
  CHECK (present_units + paid_leave_units + unpaid_leave_units + absent_units + holiday_units
         = CASE WHEN status IS NULL OR status IN ('not-evaluated', 'not-employed') THEN 0 ELSE 2 END)
);
CREATE INDEX ix_attendance_date     ON attendance_record (organization_id, work_date);
CREATE INDEX ix_attendance_open_due ON attendance_record (organization_id, close_due_at) WHERE state = 'open';
CREATE INDEX ix_attendance_stale    ON attendance_record (organization_id, user_id)
  WHERE calculated_input_version < input_version;

-- Which day owns an event, and why. Derived, so unlike the event it can be
-- rewritten when a later change moves an event across a boundary (§8.4).
CREATE TABLE attendance_event_assignment (
  organization_id      uuid NOT NULL REFERENCES organization(id),
  user_id              uuid NOT NULL,             -- whose event, and whose day: one person
  event_id             uuid NOT NULL,
  attendance_record_id uuid NOT NULL,
  reason               text NOT NULL CHECK (reason IN ('midpoint', 'closing-extension',
                                                       'opening-pull-forward', 'next-shift-started',
                                                       'system-close', 'reconciliation',
                                                       'correction', 'import')),
  pinned               boolean NOT NULL,
  assignment_version   integer NOT NULL DEFAULT 1,
  assigned_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, event_id),
  FOREIGN KEY (organization_id, user_id, event_id)
    REFERENCES attendance_event  (organization_id, user_id, id),
  FOREIGN KEY (organization_id, user_id, attendance_record_id)
    REFERENCES attendance_record (organization_id, user_id, id),
  CHECK (pinned = (reason IN ('correction', 'system-close', 'reconciliation')))
);
CREATE INDEX ix_event_assignment_record ON attendance_event_assignment (organization_id, attendance_record_id);

-- Leave, WFH and confirmed break consequences, each pointing at what created it (L8).
-- The foreign keys to leave_request and break_breach arrive with steps 6 and 8.
CREATE TABLE attendance_overlay (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organization(id),
  user_id          uuid NOT NULL,
  work_date        date NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('leave-full', 'leave-first-half', 'leave-second-half',
                                                 'wfh', 'breach-consequence')),
  paid             boolean,
  consequence      text CHECK (consequence IN ('mark-late', 'mark-half-day', 'mark-absent', 'deduct-minutes')),
  minutes          integer,
  leave_request_id uuid,
  break_breach_id  uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  CHECK (num_nonnulls(leave_request_id, break_breach_id) = 1),
  CHECK ((kind = 'breach-consequence') = (break_breach_id IS NOT NULL)),
  UNIQUE NULLS NOT DISTINCT (organization_id, user_id, work_date, kind, leave_request_id, break_breach_id)
);
CREATE INDEX ix_attendance_overlay_leave  ON attendance_overlay (organization_id, leave_request_id);
CREATE INDEX ix_attendance_overlay_breach ON attendance_overlay (organization_id, break_breach_id);

-- Dated settings (D35): a day is judged by the row in force on its date.
CREATE TABLE attendance_setting (
  id                            uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id               uuid NOT NULL REFERENCES organization(id),
  effective_from                date NOT NULL,
  arrival_policy                text NOT NULL DEFAULT 'device-or-web'
                                  CHECK (arrival_policy IN ('device-or-web', 'device')),   -- D10, Q6
  client_time_tolerance_minutes integer NOT NULL DEFAULT 15
                                  CHECK (client_time_tolerance_minutes BETWEEN 0 AND 1440),  -- D13
  night_window_from             time,                   -- §6.6, Q13: NULL = no night minutes
  night_window_to               time,
  created_by                    uuid NOT NULL,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, effective_from),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id),
  CHECK ((night_window_from IS NULL) = (night_window_to IS NULL)),
  CHECK (night_window_from IS NULL OR night_window_from <> night_window_to)
);

CREATE TABLE arrival_policy_override (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  department_id   uuid NOT NULL,
  arrival_policy  text NOT NULL CHECK (arrival_policy IN ('device-or-web', 'device')),
  effective_from  date NOT NULL,
  effective_to    date,                                 -- exclusive; NULL = open-ended
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, department_id) REFERENCES department (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  EXCLUDE USING gist (organization_id WITH =, department_id WITH =,
                      daterange(effective_from, effective_to, '[)') WITH &&)
);

-- The one other way through a `device` policy: a dated, audited allowance (§9.2).
CREATE TABLE arrival_exception (
  organization_id uuid NOT NULL REFERENCES organization(id),
  user_id         uuid NOT NULL,
  work_date       date NOT NULL,
  reason          text NOT NULL CHECK (char_length(reason) >= 20),
  granted_by      uuid NOT NULL,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id, work_date),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, granted_by) REFERENCES app_user (organization_id, id),
  CHECK (granted_by <> user_id)                         -- nobody excuses their own arrival
);

-- Day-open's watermark (§8.6): the last date fully materialised.
CREATE TABLE attendance_day_open_state (
  organization_id      uuid PRIMARY KEY REFERENCES organization(id),
  materialised_through date NOT NULL
);

SELECT apply_tenant_rls('attendance_event');
SELECT apply_tenant_rls('attendance_record');
SELECT apply_tenant_rls('attendance_event_assignment');
SELECT apply_tenant_rls('attendance_overlay');
SELECT apply_tenant_rls('attendance_setting');
SELECT apply_tenant_rls('arrival_policy_override');
SELECT apply_tenant_rls('arrival_exception');
SELECT apply_tenant_rls('attendance_day_open_state');

-- Migration 0001 grants SELECT, INSERT, UPDATE and DELETE on every new table to
-- the app role by default, so a narrower grant is written as a REVOKE.
REVOKE UPDATE, DELETE ON attendance_event FROM tapcrm_app;          -- append-only (AT-6)
REVOKE DELETE ON attendance_record FROM tapcrm_app;                 -- a day is marked, never removed (§8.6)
REVOKE UPDATE ON attendance_overlay FROM tapcrm_app;                -- overlays go with their request (L8)
REVOKE UPDATE, DELETE ON attendance_setting FROM tapcrm_app;        -- a change is a new dated row (D35)
REVOKE DELETE ON arrival_policy_override FROM tapcrm_app;
REVOKE UPDATE, DELETE ON arrival_exception FROM tapcrm_app;
REVOKE DELETE ON attendance_day_open_state FROM tapcrm_app;
-- attendance_event_assignment keeps all four: it is derived, and re-attribution rewrites it.
```

- [ ] **Migrate and run the test again:**

```bash
npm run migrate
psql "$MIGRATION_DATABASE_URL" -c "ALTER ROLE tapcrm_app LOGIN PASSWORD 'app_test_password';"
npx vitest run packages/server/src/platform/modules/people-privileges.integration.test.ts
npm run ci
```

Expected: `Tests  1 passed (1)`, and `✓ CI-33  RLS on all 50 tenant-owned tables`.

Checkpoint: leave the changes in the working tree for review.

---

## Task 4 — Day facts and attribution (§5.2, D23, D30)

Two pure files. `day-facts.ts` turns each day's shift and window into the
numbers attribution uses:

- `openFrom`: the earliest an arrival can start the day;
- `closingCap`: the latest a session can still collect events, and when
  auto-close will be due;
- the eligibility window.

`attribute.ts` applies the four rules in their fixed order to every event in
the order of D32. "Arrived" and "open" are read from the events themselves, so
the answer never depends on when a punch was delivered. It also answers
`currentDay`, the five-step rule for which day a person is in.

- [ ] **Give attendance a day's shift and window in one read** —
  `packages/server/src/modules/shifts/facade.ts`:

```diff
--- a/packages/server/src/modules/shifts/facade.ts
+++ b/packages/server/src/modules/shifts/facade.ts
@@ -80,3 +80,28 @@ export async function dayWindowContaining(
 function localDateOfUtc(instant: Date): DateOnly {
   return localDateOf(instant, 'UTC');
 }
+
+/** One date's shift and window, for callers that need both. */
+export interface ShiftDay {
+  readonly shift: ResolvedShift;
+  readonly window: DayWindow;
+}
+
+/**
+ * The shift and the window of every date from `from` to `to`, inclusive, with
+ * one read. Attendance derives its day facts — opening and closing edges — from
+ * these (design §5.2, §8.5 `refreshDayFacts`).
+ */
+export async function shiftDays(
+  tx: Tx,
+  userId: string,
+  from: DateOnly,
+  to: DateOnly,
+): Promise<ShiftDay[]> {
+  const inputs = await loadShiftInputs(tx, userId, from, to);
+  const days: ShiftDay[] = [];
+  for (let date = from; date <= to; date = addDays(date, 1)) {
+    days.push({ shift: resolveShift(inputs, date), window: windowOf(inputs, date) });
+  }
+  return days;
+}
```

- [ ] **Create the test helpers** —
  `packages/server/src/modules/attendance/facts.test-helpers.ts`. A roster of
  shift times becomes day facts the same way shifts computes them. Tests may
  not import shifts' internals (the boundary rule), so the helper builds the
  windows itself.

```ts
import type {
  AttendanceEventInput,
  DateOnly,
  EventKind,
  LocalTime,
  ResolvedShift,
} from '@tapcrm/contracts';
import { addDays, instantAt } from '../../platform/time.js';
import { factsFor, type DayFacts, type ShiftDayInput } from './day-facts.js';

/**
 * Builders for the pure attendance tests. A roster maps each date to a fixed
 * shift ['20:00', '05:00'] or null (no fixed times, anchored at 00:00), in
 * Asia/Kolkata. Windows are midpoints of the gaps, as shifts computes them.
 */

export const ZONE = 'Asia/Kolkata';
export const d = (value: string) => value as DateOnly;

/** An instant written as IST wall-clock time. */
export const ist = (local: string) => new Date(`${local}+05:30`);

type Roster = Record<string, readonly [string, string] | null>;

function shift(date: DateOnly, times: readonly [string, string] | null): ResolvedShift {
  const [start, end] = times ?? [null, null];
  return {
    date,
    source: times === null ? 'none' : 'template',
    shiftId: times === null ? null : `shift-${start}`,
    versionId: null,
    kind: times === null ? 'none' : 'fixed',
    start: start as LocalTime | null,
    end: end as LocalTime | null,
    isOvernight: start !== null && end !== null && end < start,
    graceMinutes: 10,
    earlyExitGraceMinutes: 0,
    fullDayMinutes: times === null ? null : 450,
    halfDayMinutes: times === null ? null : 240,
    complementaryHalfMinutes: null,
    minOvertimeMinutes: 30,
    earlyWindowMinutes: times === null ? 0 : 180,
    maxClosingExtensionMinutes: 240,
    timezone: ZONE,
  };
}

/** Facts for every date of the roster except its first and last. */
export function rosterFacts(roster: Roster): Map<DateOnly, DayFacts> {
  const dates = Object.keys(roster).sort() as DateOnly[];
  const shapes = dates.map((date) => {
    const times = roster[date] ?? null;
    if (times === null) {
      const midnight = instantAt(date, '00:00' as LocalTime, ZONE);
      return { date, start: midnight, end: midnight, times };
    }
    const [start, end] = times;
    return {
      date,
      start: instantAt(date, start as LocalTime, ZONE),
      end: instantAt(end < start ? addDays(date, 1) : date, end as LocalTime, ZONE),
      times,
    };
  });
  const mid = (a: Date, b: Date) =>
    new Date(Math.floor((a.getTime() + b.getTime()) / 2_000) * 1_000);
  const days: ShiftDayInput[] = shapes.map((shape, i) => {
    const previous = shapes[i - 1];
    const next = shapes[i + 1];
    return {
      shift: shift(shape.date, shape.times),
      window: {
        date: shape.date,
        start:
          previous === undefined
            ? new Date(shape.start.getTime() - 43_200_000)
            : mid(previous.end, shape.start),
        end:
          next === undefined
            ? new Date(shape.end.getTime() + 43_200_000)
            : mid(shape.end, next.start),
        overlap: false,
        shape: {
          start: shape.start,
          end: shape.end,
          anchor: shape.times === null ? 'day-start' : 'own-shift',
        },
      },
    };
  });
  return factsFor(days);
}

let counter = 0;
export function punch(
  kind: EventKind,
  local: string,
  extra: Partial<AttendanceEventInput> = {},
): AttendanceEventInput {
  counter += 1;
  return {
    id: extra.id ?? `ev-${String(counter).padStart(4, '0')}`,
    kind,
    at: ist(local).toISOString(),
    source: extra.source ?? (kind === 'scan' || kind === 'auto-out' ? 'device' : 'web'),
    evidence:
      extra.evidence ??
      (kind === 'scan' || kind === 'auto-out' ? 'assumed' : 'confirmed'),
    assignmentReason: extra.assignmentReason ?? 'midpoint',
  };
}
```

- [ ] **Write the test** — `packages/server/src/modules/attendance/attribute.test.ts`.
  Its cases are the rows of the §5.2 table. The roster is a Sunday 20:00–05:00
  night before a Monday 09:00–18:00 morning, with a 4-hour extension and a
  3-hour early window.

```ts
import { describe, expect, it } from 'vitest';
import type { AttendanceEventInput } from '@tapcrm/contracts';
import { attributeAll, currentDay, type LedgerEvent } from './attribute.js';
import { d, ist, punch, rosterFacts } from './facts.test-helpers.js';

/**
 * Design §5.2 — every row of the attribution table. Sunday 27 September is a
 * 20:00–05:00 night, Monday a 09:00–18:00 morning; a 4-hour closing extension
 * and a 3-hour early window give closingCap(Sunday) = 09:00 and
 * openFrom(Monday) = 06:00. The geometric boundary is 07:00.
 */
const NIGHT = ['20:00', '05:00'] as const;
const DAY = ['09:00', '18:00'] as const;
const facts = rosterFacts({
  '2026-09-25': NIGHT,
  '2026-09-26': NIGHT,
  '2026-09-27': NIGHT,
  '2026-09-28': DAY,
  '2026-09-29': DAY,
  '2026-09-30': DAY,
});
const SUN = d('2026-09-27');
const MON = d('2026-09-28');

const ledger = (events: AttendanceEventInput[]): LedgerEvent[] =>
  events.map((event) => ({ event }));
const placementOf = (events: AttendanceEventInput[], target: AttendanceEventInput) =>
  attributeAll(ledger(events), facts).placements.get(target.id);

const arrived = punch('in', '2026-09-27T19:55:00');

describe('§5.2 — which day owns an event, row by row', () => {
  it('the facts: closingCap(Sunday) 09:00, openFrom(Monday) 06:00, boundary 07:00', () => {
    expect(facts.get(SUN)!.closingCap).toEqual(ist('2026-09-28T09:00:00'));
    expect(facts.get(MON)!.openFrom).toEqual(ist('2026-09-28T06:00:00'));
    expect(facts.get(SUN)!.windowEnd).toEqual(ist('2026-09-28T07:00:00'));
  });

  it('05:20 out → Sunday (rule 2: Sunday has started)', () => {
    const out = punch('out', '2026-09-28T05:20:00');
    expect(placementOf([arrived, out], out)).toEqual({ date: SUN, reason: 'midpoint' });
  });

  it('07:30 out with the night still open → Sunday (rule 3)', () => {
    const out = punch('out', '2026-09-28T07:30:00');
    expect(placementOf([arrived, out], out)).toEqual({
      date: SUN,
      reason: 'closing-extension',
    });
  });

  it('07:30:00 out and 07:30:00 in, night open → the out Sunday, the in Monday (3, then 2)', () => {
    const out = punch('out', '2026-09-28T07:30:00');
    const inn = punch('in', '2026-09-28T07:30:00');
    for (const events of [
      [arrived, out, inn],
      [inn, out, arrived],
    ]) {
      const { placements } = attributeAll(ledger(events), facts);
      expect(placements.get(out.id)).toEqual({ date: SUN, reason: 'closing-extension' });
      expect(placements.get(inn.id)).toEqual({ date: MON, reason: 'midpoint' });
    }
  });

  it('07:10 break-start, 07:20 break-end, then 07:30 out → all Sunday (the extension takes every kind)', () => {
    const events = [
      arrived,
      punch('break-start', '2026-09-28T07:10:00'),
      punch('break-end', '2026-09-28T07:20:00'),
      punch('out', '2026-09-28T07:30:00'),
    ];
    const { placements } = attributeAll(ledger(events), facts);
    for (const event of events.slice(1))
      expect(placements.get(event.id)).toEqual({
        date: SUN,
        reason: 'closing-extension',
      });
  });

  it('09:05 out, past the cap → Monday, as conflicting evidence (rule 4)', () => {
    const out = punch('out', '2026-09-28T09:05:00');
    expect(placementOf([arrived, out], out)).toEqual({ date: MON, reason: 'midpoint' });
  });

  const closed = punch('out', '2026-09-28T05:02:00');

  it('06:30 in after the night closed at 05:02 → Monday, pulled forward (rule 1)', () => {
    const inn = punch('in', '2026-09-28T06:30:00');
    expect(placementOf([arrived, closed, inn], inn)).toEqual({
      date: MON,
      reason: 'opening-pull-forward',
    });
  });

  it('06:45 break-start after that 06:30 in → Monday (rule 1: Monday has started)', () => {
    const inn = punch('in', '2026-09-28T06:30:00');
    const brk = punch('break-start', '2026-09-28T06:45:00');
    expect(placementOf([arrived, closed, inn, brk], brk)).toEqual({
      date: MON,
      reason: 'next-shift-started',
    });
  });

  it('07:30 out after the night closed at 05:02 → Monday (rule 4: nothing open)', () => {
    const out = punch('out', '2026-09-28T07:30:00');
    expect(placementOf([arrived, closed, out], out)).toEqual({
      date: MON,
      reason: 'midpoint',
    });
  });

  it('08:50 in, night never closed → Monday; Sunday flagged previous-session-unconfirmed (rule 2)', () => {
    const inn = punch('in', '2026-09-28T08:50:00');
    const result = attributeAll(ledger([arrived, inn]), facts);
    expect(result.placements.get(inn.id)).toEqual({
      date: MON,
      reason: 'next-shift-started',
    });
    expect([...(result.flags.get(SUN) ?? [])]).toEqual(['previous-session-unconfirmed']);
  });

  it('08:55 break-start after that → Monday (rule 2)', () => {
    const inn = punch('in', '2026-09-28T08:50:00');
    const brk = punch('break-start', '2026-09-28T08:55:00');
    expect(placementOf([arrived, inn, brk], brk)).toEqual({
      date: MON,
      reason: 'midpoint',
    });
  });

  it('07:30 out delivered after a 05:00 auto-out → Sunday: the auto-out does not count (rule 3)', () => {
    const autoOut = punch('auto-out', '2026-09-28T05:00:00', { source: 'system' });
    const out = punch('out', '2026-09-28T07:30:00');
    const events: LedgerEvent[] = [
      { event: arrived },
      { event: autoOut, fixed: { date: SUN, reason: 'system-close' } },
      { event: out },
    ];
    expect(attributeAll(events, facts).placements.get(out.id)).toEqual({
      date: SUN,
      reason: 'closing-extension',
    });
  });

  it('an `in` reaching the closing extension, before the next opening, is flagged overlapping-arrival (rule 3)', () => {
    // A 20:00–07:00 night before a 14:00 start: boundary 10:30, closingCap 11:00, openFrom 11:00.
    const late = rosterFacts({
      '2026-09-26': ['20:00', '07:00'],
      '2026-09-27': ['20:00', '07:00'],
      '2026-09-28': ['14:00', '23:00'],
      '2026-09-29': ['14:00', '23:00'],
    });
    const inn = punch('in', '2026-09-28T10:45:00');
    const result = attributeAll(ledger([arrived, inn]), late);
    expect(result.placements.get(inn.id)).toEqual({
      date: SUN,
      reason: 'closing-extension',
    });
    expect([...(result.flags.get(SUN) ?? [])]).toEqual(['overlapping-arrival']);
  });

  it('two `in`s in one second land on one day with one reason', () => {
    const web = punch('in', '2026-09-28T08:50:00');
    const reader = punch('in', '2026-09-28T08:50:00', {
      source: 'import',
      evidence: 'confirmed',
    });
    const { placements } = attributeAll(ledger([arrived, web, reader]), facts);
    expect(placements.get(web.id)).toEqual(placements.get(reader.id));
  });
});

describe('the answer never depends on delivery order', () => {
  it('every rotation of one set of punches places each punch the same', () => {
    const events = [
      arrived,
      punch('break-start', '2026-09-28T00:30:00'),
      punch('break-end', '2026-09-28T01:00:00'),
      punch('out', '2026-09-28T05:04:00'),
      punch('scan', '2026-09-28T08:50:00'),
      punch('out', '2026-09-28T18:02:00'),
    ];
    const expected = attributeAll(ledger(events), facts).placements;
    for (let shift = 1; shift < events.length; shift += 1) {
      const rotated = [...events.slice(shift), ...events.slice(0, shift)];
      expect(attributeAll(ledger(rotated), facts).placements).toEqual(expected);
    }
  });
});

describe('night after night (§5.2, §6.6)', () => {
  const nights = rosterFacts({
    '2026-09-25': NIGHT,
    '2026-09-26': NIGHT,
    '2026-09-27': NIGHT,
    '2026-09-28': NIGHT,
    '2026-09-29': NIGHT,
  });

  it('a 07:30 scan stays with the night; a 13:10 errand scan falls to the next day', () => {
    const scan = punch('scan', '2026-09-28T07:30:00');
    const errand = punch('scan', '2026-09-28T13:10:00');
    const { placements } = attributeAll(ledger([arrived, scan, errand]), nights);
    expect(placements.get(scan.id)?.date).toBe(SUN);
    expect(placements.get(errand.id)).toEqual({ date: MON, reason: 'midpoint' });
  });
});

describe('currentDayFor — the day a person is in (§5.2)', () => {
  const placedAs = (events: AttendanceEventInput[]) => {
    const { placements } = attributeAll(ledger(events), facts);
    return events.map((event) => ({ event, date: placements.get(event.id)!.date }));
  };

  it('06:30 in pulled forward → Monday at once', () => {
    const events = placedAs([arrived, closed(), punch('in', '2026-09-28T06:30:00')]);
    expect(currentDay(facts, events, ist('2026-09-28T06:30:00'))).toBe(MON);
  });

  it('07:30 with the night still open → Sunday; once the out is recorded → Monday', () => {
    expect(currentDay(facts, placedAs([arrived]), ist('2026-09-28T07:30:00'))).toBe(SUN);
    const withOut = placedAs([arrived, punch('out', '2026-09-28T07:30:00')]);
    expect(currentDay(facts, withOut, ist('2026-09-28T07:30:00'))).toBe(MON);
  });

  it('08:50 arrival for the morning, night never closed → Monday', () => {
    const events = placedAs([arrived, punch('scan', '2026-09-28T08:50:00')]);
    expect(currentDay(facts, events, ist('2026-09-28T08:50:00'))).toBe(MON);
  });

  function closed() {
    return punch('out', '2026-09-28T05:02:00');
  }
});
```

- [ ] **Run it and watch it fail** — expected: `Error: Failed to load url ./attribute.js … Does the file exist?`

- [ ] **Create** `packages/server/src/modules/attendance/day-facts.ts`:

```ts
import type { DateOnly, EligibilityWindow, ResolvedShift } from '@tapcrm/contracts';

/**
 * A day's facts — design §5.2, §8.5 `refreshDayFacts`.
 *
 * Four numbers steer attribution and auto-close, so they are computed in one
 * place from the day's shift and its neighbours, and stored on the record:
 *
 *   window      the geometric partition from shifts (midpoint to midpoint)
 *   openFrom    = max(start − early window, previous day's end)
 *   closingCap  = min(end + max closing extension, next day's start)
 *   eligibility = [start − early window, closingCap], null without fixed times
 *
 * A neighbour's "start" and "end" are its own shift's, or the anchor its window
 * borrows (§5.2), so a flexible neighbour still bounds a fixed day.
 */

/** The window and shape of one date, as ShiftsFacade.shiftDays returns them. */
export interface ShiftDayInput {
  readonly shift: ResolvedShift;
  readonly window: {
    readonly date: DateOnly;
    readonly start: Date;
    readonly end: Date;
    readonly overlap: boolean;
    readonly shape: { readonly start: Date; readonly end: Date; readonly anchor: string };
  };
}

export interface DayFacts {
  readonly date: DateOnly;
  readonly shift: ResolvedShift;
  readonly windowStart: Date;
  readonly windowEnd: Date;
  /** Arrivals at or after this may start the day (§5.2 rules 1 and 2). */
  readonly openFrom: Date;
  /** The latest instant a session of this day may still collect events; auto-close is due then. */
  readonly closingCap: Date;
  readonly eligibility: EligibilityWindow;
  /** A neighbouring shift overlaps this one: the day is flagged and not evaluated. */
  readonly overlap: boolean;
}

const minutes = (n: number) => n * 60_000;
const later = (a: Date, b: Date) => (a > b ? a : b);
const earlier = (a: Date, b: Date) => (a < b ? a : b);

/**
 * Facts for `day`, from it and its two neighbours.
 *
 * Without fixed times the design gives no shift edges to extend from, so a
 * flexible or no-shift day opens and closes at its window: nothing pulls an
 * arrival forward into it, and its session reaches no further than its
 * window (plan decision; raised with the owners).
 */
export function dayFacts(
  previous: ShiftDayInput,
  day: ShiftDayInput,
  next: ShiftDayInput,
): DayFacts {
  const { shift, window } = day;
  const base = {
    date: window.date,
    shift,
    windowStart: window.start,
    windowEnd: window.end,
    overlap: window.overlap,
  };
  if (shift.kind !== 'fixed') {
    return { ...base, openFrom: window.start, closingCap: window.end, eligibility: null };
  }
  const earliest = new Date(
    window.shape.start.getTime() - minutes(shift.earlyWindowMinutes),
  );
  const closingCap = earlier(
    new Date(window.shape.end.getTime() + minutes(shift.maxClosingExtensionMinutes ?? 0)),
    next.window.shape.start,
  );
  return {
    ...base,
    openFrom: later(earliest, previous.window.shape.end),
    closingCap,
    eligibility: { from: earliest.toISOString(), to: closingCap.toISOString() },
  };
}

/** Facts for every day but the first and last of consecutive shift days. */
export function factsFor(days: readonly ShiftDayInput[]): Map<DateOnly, DayFacts> {
  const facts = new Map<DateOnly, DayFacts>();
  for (let i = 1; i < days.length - 1; i += 1) {
    const fact = dayFacts(days[i - 1]!, days[i]!, days[i + 1]!);
    facts.set(fact.date, fact);
  }
  return facts;
}
```

- [ ] **Create** `packages/server/src/modules/attendance/attribute.ts`:

```ts
import type { AssignmentReason, AttendanceEventInput, DateOnly } from '@tapcrm/contracts';
import { compareEvents, readDay } from '@tapcrm/contracts';
import { addDays } from '../../platform/time.js';
import type { DayFacts } from './day-facts.js';

/**
 * Which day owns an event — design §5.2, D23, D30.
 *
 * For an event e at instant t, with G the day whose window holds t, the first
 * matching rule wins:
 *
 *   1. G+1 claims it   G+1 has already arrived before e       → next-shift-started
 *                      or e is an arrival at or after openFrom(G+1)
 *                         → opening-pull-forward, or next-shift-started when G
 *                           is open at e (G is flagged previous-session-unconfirmed)
 *   2. G claims it     G has already arrived before e         → midpoint
 *                      or e is an arrival at or after openFrom(G)
 *                         → midpoint, or next-shift-started when G−1 is open at e
 *                           (G−1 is flagged previous-session-unconfirmed)
 *   3. G−1 claims it   G−1 is open at e                       → closing-extension
 *                      (an `in` here also flags G−1 overlapping-arrival)
 *   4. otherwise       → G, midpoint
 *
 * "Arrived" and "open" are read from the events themselves, in the order of
 * D32, never from live state, so replaying a month gives the same answer. A
 * system `auto-out` never counts: auto-close derives it from the real events
 * (D25), and letting it steer attribution would make a day depend on when a
 * late punch was delivered.
 */

export interface Placement {
  readonly date: DateOnly;
  readonly reason: AssignmentReason;
}

export interface LedgerEvent {
  readonly event: AttendanceEventInput;
  /** Where the event stays: pinned, or outside the days being re-attributed. */
  readonly fixed?: Placement;
}

export interface Attribution {
  readonly placements: ReadonlyMap<string, Placement>;
  /** Day flags attribution raises: previous-session-unconfirmed, overlapping-arrival. */
  readonly flags: ReadonlyMap<DateOnly, ReadonlySet<string>>;
}

const ARRIVALS = new Set(['in', 'scan']);

/** The day whose window holds `at`. */
export function dayOfWindow(
  facts: ReadonlyMap<DateOnly, DayFacts>,
  at: Date,
): DayFacts | undefined {
  for (const fact of facts.values()) {
    if (fact.windowStart <= at && at < fact.windowEnd) return fact;
  }
  return undefined;
}

/** The day's events so far, without system auto-outs, as the rules read them. */
class Placed {
  private readonly byDate = new Map<DateOnly, AttendanceEventInput[]>();

  add(date: DateOnly, event: AttendanceEventInput): void {
    if (event.kind === 'auto-out') return;
    this.byDate.set(date, [...(this.byDate.get(date) ?? []), event]);
  }

  private reading(fact: DayFacts | undefined) {
    if (fact === undefined) return null;
    return readDay(this.byDate.get(fact.date) ?? [], fact.eligibility);
  }

  arrived(fact: DayFacts | undefined): boolean {
    return this.reading(fact)?.arrival != null;
  }

  /** Arrived, not departed, and `at` no later than its closing cap. */
  open(fact: DayFacts | undefined, at: Date): boolean {
    const reading = this.reading(fact);
    return (
      fact !== undefined &&
      reading?.arrival != null &&
      reading.departure === null &&
      at <= fact.closingCap
    );
  }
}

function neighbour(
  facts: ReadonlyMap<DateOnly, DayFacts>,
  date: DateOnly,
  days: number,
): DayFacts | undefined {
  return facts.get(addDays(date, days));
}

function decide(
  facts: ReadonlyMap<DateOnly, DayFacts>,
  placed: Placed,
  event: AttendanceEventInput,
  flag: (date: DateOnly, name: string) => void,
): Placement | null {
  const at = new Date(event.at);
  const g = dayOfWindow(facts, at);
  if (g === undefined) return null;
  const next = neighbour(facts, g.date, 1);
  const previous = neighbour(facts, g.date, -1);
  const arrival = ARRIVALS.has(event.kind);

  // 1. The next day claims it.
  if (next !== undefined) {
    if (placed.arrived(next)) return { date: next.date, reason: 'next-shift-started' };
    if (arrival && at >= next.openFrom) {
      if (placed.open(g, at)) {
        flag(g.date, 'previous-session-unconfirmed');
        return { date: next.date, reason: 'next-shift-started' };
      }
      return { date: next.date, reason: 'opening-pull-forward' };
    }
  }

  // 2. Its own day claims it.
  if (placed.arrived(g)) return { date: g.date, reason: 'midpoint' };
  if (arrival && at >= g.openFrom) {
    if (placed.open(previous, at)) {
      flag(previous!.date, 'previous-session-unconfirmed');
      return { date: g.date, reason: 'next-shift-started' };
    }
    return { date: g.date, reason: 'midpoint' };
  }

  // 3. The previous day's session is still open: the closing extension, every kind.
  if (placed.open(previous, at)) {
    if (event.kind === 'in') flag(previous!.date, 'overlapping-arrival');
    return { date: previous!.date, reason: 'closing-extension' };
  }

  // 4. The midpoint.
  return { date: g.date, reason: 'midpoint' };
}

/**
 * Attributes every event, in the order of D32. Events of one kind in one second
 * are one piece of evidence and land together. An event with `fixed` keeps
 * that placement and still counts for the events after it.
 */
export function attributeAll(
  ledger: readonly LedgerEvent[],
  facts: ReadonlyMap<DateOnly, DayFacts>,
): Attribution {
  const ordered = [...ledger].sort(
    (a, b) => compareEvents(a.event, b.event) || a.event.id.localeCompare(b.event.id),
  );
  const placements = new Map<string, Placement>();
  const flags = new Map<DateOnly, Set<string>>();
  const flag = (date: DateOnly, name: string) =>
    flags.set(date, new Set([...(flags.get(date) ?? []), name]));
  const placed = new Placed();

  let lastKey = '';
  let lastPlacement: Placement | null = null;
  for (const { event, fixed } of ordered) {
    const key = `${new Date(event.at).toISOString()}|${event.kind}`;
    let placement: Placement | null;
    if (fixed !== undefined) placement = fixed;
    else if (key === lastKey) placement = lastPlacement;
    else placement = decide(facts, placed, event, flag);
    lastKey = key;
    lastPlacement = placement;
    if (placement === null) continue;
    placements.set(event.id, placement);
    placed.add(placement.date, event);
  }
  return { placements, flags };
}

/**
 * `AttendanceFacade.currentDayFor` — the day a person is IN at an instant
 * (§5.2): geometry, extended while their previous session is open, released
 * once the next day has an arrival. "By `at`" counts events up to and
 * including that second.
 */
export function currentDay(
  facts: ReadonlyMap<DateOnly, DayFacts>,
  events: readonly { readonly event: AttendanceEventInput; readonly date: DateOnly }[],
  at: Date,
): DateOnly | null {
  const g = dayOfWindow(facts, at);
  if (g === undefined) return null;
  const upTo = Math.floor(at.getTime() / 1000) * 1000 + 999;
  const placed = new Placed();
  for (const { event, date } of [...events].sort((a, b) =>
    compareEvents(a.event, b.event),
  )) {
    if (Date.parse(event.at) <= upTo) placed.add(date, event);
  }
  const next = neighbour(facts, g.date, 1);
  const previous = neighbour(facts, g.date, -1);
  if (placed.arrived(next)) return next!.date;
  if (placed.arrived(g)) return g.date;
  if (placed.open(previous, at)) return previous!.date;
  return g.date;
}
```

- [ ] **Run the test again.** Expected: `Tests  19 passed (19)`.

Checkpoint: leave the changes in the working tree for review.

---

## Task 5 — The ledger: append, retire, re-attribute (§8.4, D24, D28)

What it does:

- **One lock order everywhere.** The person's advisory lock comes first, then
  their record rows (D24).
- **`effectiveEventsOf`** is the one definition of an effective event (D28).
  Void rows and superseded rows never reach attribution.
- **The neighbourhood pass** (§8.4 step 9) re-attributes the day before, the
  day, and the day after:
  - it writes only the assignments whose day or reason changed;
  - pinned assignments never move;
  - it widens by a day when an event crosses onto or off an outer day.
- **Records** are created the moment an event needs them, insert-then-lock
  (§8.4 steps 5 and 6). An open day's facts are refreshed while it is open
  (`refreshDayFacts`).
- **Recalculation.** Every record whose inputs changed gets a new input version
  and an `attendance.recalc-requested` outbox event. 3b adds the handler that
  queues the job. Until then the events wait.
- **Retries.** A retried `clientEventId` returns its first answer, checked
  before and again under the lock. The same key used for a different punch is a
  409.

- [ ] **Write the test** —
  `packages/server/src/modules/attendance/ledger.integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createJobContext, systemPrincipal } from '../../platform/dal/context.js';
import { db, platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import {
  appendEvent,
  currentDayFor,
  retireEvent,
  type AppendEventInput,
} from './facade.js';

/**
 * Step 3a against real PostgreSQL: the append-only ledger, one record per
 * person and day, stored assignments, and the neighbourhood pass (design §8).
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const ORG = randomUUID();
const DEPT = randomUUID();
const POS = randomUUID();
const HR = randomUUID();
const people = { a: randomUUID(), b: randomUUID(), c: randomUUID(), d: randomUUID() };
const NIGHT = randomUUID();
const DAY = randomUUID();
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

const punch = (
  userId: string,
  kind: AppendEventInput['kind'],
  local: string,
  extra: Partial<AppendEventInput> = {},
) =>
  db.transaction(ctx(), (tx) =>
    appendEvent(tx, {
      userId,
      kind,
      at: ist(local),
      source: 'web',
      evidence: 'confirmed',
      remote: true,
      ...extra,
    }),
  );

interface RecordRow {
  workDate: string;
  inputVersion: number;
  attributionFlags: string[];
  closeDueAt: Date;
}
const recordsOf = (userId: string) =>
  asOwner(
    'read records',
    sql`
    SELECT work_date::text AS work_date, input_version, attribution_flags, close_due_at
    FROM attendance_record WHERE user_id = ${userId} ORDER BY work_date`,
  ) as Promise<RecordRow[]>;

const placementOf = async (eventId: string) =>
  (
    (await asOwner(
      'read assignment',
      sql`
    SELECT r.work_date::text AS work_date, a.reason FROM attendance_event_assignment a
    JOIN attendance_record r ON r.id = a.attendance_record_id WHERE a.event_id = ${eventId}`,
    )) as {
      workDate: string;
      reason: string;
    }[]
  )[0];

describe.skipIf(!enabled)('attendance ledger (PostgreSQL)', () => {
  beforeAll(async () => {
    await asOwner(
      'create organization',
      sql`
      INSERT INTO organization (id, code, name, timezone) VALUES (${ORG}, ${`AT${ORG.slice(0, 6)}`}, 'Ledger Test', 'Asia/Kolkata')`,
    );
    await asOwner(
      'create department',
      sql`
      INSERT INTO department (id, organization_id, code, name, kind) VALUES (${DEPT}, ${ORG}, 'OPS', 'Operations', 'operations')`,
    );
    await asOwner(
      'create position',
      sql`
      INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
      VALUES (${POS}, ${ORG}, ${DEPT}, 'OPS-1', 'Operator', 20)`,
    );
    const everyone = [HR, ...Object.values(people)];
    for (const [index, id] of everyone.entries()) {
      await asOwner(
        'create person',
        sql`
        INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id)
        VALUES (${id}, ${ORG}, 'employee', ${`EMP-AT${String(index).padStart(3, '0')}`}, ${`p${index}-${id}@t.io`},
                ${`Person ${index}`}, ${POS}, ${DEPT})`,
      );
    }
    // A 20:00–05:00 night every day, a 09:00–18:00 morning on Monday 28 September,
    // a 4-hour closing extension (Q3) and the default 3-hour early window.
    await asOwner(
      'shifts',
      sql`
      INSERT INTO shift (id, organization_id, code, name, kind, created_by)
      VALUES (${NIGHT}, ${ORG}, 'NIGHT', 'Night', 'fixed', ${HR}), (${DAY}, ${ORG}, 'DAY', 'Day', 'fixed', ${HR})`,
    );
    await asOwner(
      'versions',
      sql`
      INSERT INTO shift_version (organization_id, shift_id, effective_from, start_time, end_time, grace_minutes,
                                 full_day_minutes, half_day_minutes, created_by)
      VALUES (${ORG}, ${NIGHT}, '2026-01-01', '20:00', '05:00', 10, 450, 240, ${HR}),
             (${ORG}, ${DAY}, '2026-01-01', '09:00', '18:00', 10, 450, 240, ${HR})`,
    );
    await asOwner(
      'setting',
      sql`
      INSERT INTO shift_setting (organization_id, effective_from, max_closing_extension_minutes, created_by)
      VALUES (${ORG}, '2026-01-01', 240, ${HR})`,
    );
    for (const id of Object.values(people)) {
      await asOwner(
        'night template',
        sql`
        INSERT INTO shift_assignment (organization_id, user_id, kind, shift_id, effective_from, created_by)
        VALUES (${ORG}, ${id}, 'template', ${NIGHT}, '2026-09-01', ${HR})`,
      );
      await asOwner(
        'monday morning',
        sql`
        INSERT INTO shift_override (organization_id, user_id, work_date, kind, shift_id, reason, created_by)
        VALUES (${ORG}, ${id}, '2026-09-28', 'shift', ${DAY}, 'Rotation', ${HR})`,
      );
    }
  });

  afterAll(async () => {
    for (const table of [
      'domain_outbox',
      'attendance_event_assignment',
      'attendance_record',
      'shift_override',
      'shift_assignment',
      'shift_setting',
      'shift_version',
      'shift',
    ]) {
      await asOwner(
        `clear ${table}`,
        sql`DELETE FROM ${sql.raw(table)} WHERE organization_id = ${ORG}`,
      );
    }
    // The ledger is append-only for the app role; the owner clears it, voids first.
    await asOwner(
      'clear voids',
      sql`DELETE FROM attendance_event WHERE organization_id = ${ORG} AND supersedes_event_id IS NOT NULL`,
    );
    await asOwner(
      'clear events',
      sql`DELETE FROM attendance_event WHERE organization_id = ${ORG}`,
    );
    await asOwner(
      'clear directory',
      sql`DELETE FROM identity_email_directory WHERE organization_id = ${ORG}`,
    );
    await asOwner(
      'clear people',
      sql`DELETE FROM app_user WHERE organization_id = ${ORG}`,
    );
    await asOwner(
      'clear position',
      sql`DELETE FROM position WHERE organization_id = ${ORG}`,
    );
    await asOwner(
      'clear department',
      sql`DELETE FROM department WHERE organization_id = ${ORG}`,
    );
    await asOwner('clear organization', sql`DELETE FROM organization WHERE id = ${ORG}`);
    await closePools();
  });

  it('a punch lands on the day that owns it, and the day is materialised with its facts', async () => {
    const arrival = await punch(people.a, 'in', '2026-09-27T19:55:00');
    expect(arrival).toMatchObject({
      workDate: '2026-09-27',
      reason: 'midpoint',
      replayed: false,
    });
    const [sunday] = await recordsOf(people.a);
    // closingCap = min(05:00 + 4 h, Monday 09:00) = 09:00 on Monday.
    expect(sunday).toMatchObject({ workDate: '2026-09-27' });
    expect(sunday!.closeDueAt).toEqual(ist('2026-09-28T09:00:00'));
  });

  it('§5.2: a 07:30 out with the night still open belongs to the night (closing extension)', async () => {
    const out = await punch(people.a, 'out', '2026-09-28T07:30:00');
    expect(out).toMatchObject({ workDate: '2026-09-27', reason: 'closing-extension' });
  });

  it('currentDayFor: with the night open at 07:00 the person is still in Sunday', async () => {
    await punch(people.d, 'in', '2026-09-27T19:58:00');
    const day = await db.transaction(ctx(), (tx) =>
      currentDayFor(tx, people.d, ist('2026-09-28T07:00:00')),
    );
    expect(day).toBe('2026-09-27');
  });

  it('§8.4 step 9: retiring the 05:02 out moves the 07:30 out from Monday back to the night', async () => {
    await punch(people.b, 'in', '2026-09-27T19:55:00');
    const early = await punch(people.b, 'out', '2026-09-28T05:02:00');
    const late = await punch(people.b, 'out', '2026-09-28T07:30:00');
    expect(late).toMatchObject({ workDate: '2026-09-28', reason: 'midpoint' });
    const before = await recordsOf(people.b);

    const retired = await db.transaction(ctx(), (tx) => retireEvent(tx, early.eventId));
    expect(retired.retired).toBe(true);
    expect(await placementOf(late.eventId)).toEqual({
      workDate: '2026-09-27',
      reason: 'closing-extension',
    });

    // Both days gained or lost an event, so both have a new input version and a recalculation request.
    const after = await recordsOf(people.b);
    for (const date of ['2026-09-27', '2026-09-28']) {
      const was = before.find((r) => r.workDate === date)!.inputVersion;
      expect(after.find((r) => r.workDate === date)!.inputVersion).toBeGreaterThan(was);
    }
    const requests = (await asOwner(
      'recalc requests',
      sql`
      SELECT count(*)::int AS n FROM domain_outbox
      WHERE organization_id = ${ORG} AND event_name = 'attendance.recalc-requested' AND payload->>'userId' = ${people.b}`,
    )) as {
      n: number;
    }[];
    expect(requests[0]!.n).toBeGreaterThan(0);

    // An event is retired once: the second attempt changes nothing.
    await expect(
      db.transaction(ctx(), (tx) => retireEvent(tx, early.eventId)),
    ).resolves.toEqual({
      retired: false,
      reason: 'already-superseded',
    });
  });

  it('D30: an 08:50 arrival after a night never closed starts Monday and flags the night', async () => {
    const morning = await punch(people.d, 'in', '2026-09-28T08:50:00');
    expect(morning).toMatchObject({
      workDate: '2026-09-28',
      reason: 'next-shift-started',
    });
    const sunday = (await recordsOf(people.d)).find((r) => r.workDate === '2026-09-27')!;
    expect(sunday.attributionFlags).toEqual(['previous-session-unconfirmed']);
  });

  it('TX-7: a retried client event returns the first answer; the same key for another punch is 409', async () => {
    const first = await punch(people.c, 'in', '2026-09-27T19:50:00', {
      clientEventId: 'offline-1',
      clientRequestHash: 'h1',
    });
    const again = await punch(people.c, 'in', '2026-09-27T19:50:00', {
      clientEventId: 'offline-1',
      clientRequestHash: 'h1',
    });
    expect(again).toEqual({ ...first, replayed: true });
    await expect(
      punch(people.c, 'out', '2026-09-28T05:00:00', {
        clientEventId: 'offline-1',
        clientRequestHash: 'h2',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'ATTENDANCE_CLIENT_EVENT_REUSED' });
  });

  it('AT-6: the app role cannot update or delete an event', async () => {
    await expect(
      db.query(
        ctx(),
        sql`UPDATE attendance_event SET occurred_at = occurred_at WHERE organization_id = ${ORG}`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query(ctx(), sql`DELETE FROM attendance_event WHERE organization_id = ${ORG}`),
    ).rejects.toThrow(/permission denied/);
  });

  it('T-6: an instant with a fraction of a second is refused', async () => {
    await expect(
      asOwner(
        'fractional',
        sql`
        INSERT INTO attendance_event (organization_id, user_id, kind, occurred_at, source, evidence)
        VALUES (${ORG}, ${people.c}, 'in', '2026-09-29T09:00:00.500+05:30', 'web', 'confirmed')`,
      ),
    ).rejects.toThrow(/violates check constraint/);
  });

  it('D34: an assignment joining one person’s event to another person’s day is refused', async () => {
    const [event] = (await asOwner(
      'an event of a',
      sql`
      SELECT id FROM attendance_event WHERE user_id = ${people.a} LIMIT 1`,
    )) as { id: string }[];
    const [record] = (await asOwner(
      'a record of b',
      sql`
      SELECT id FROM attendance_record WHERE user_id = ${people.b} LIMIT 1`,
    )) as { id: string }[];
    await expect(
      asOwner(
        'move the assignment to another person’s day',
        sql`
        UPDATE attendance_event_assignment SET attendance_record_id = ${record!.id} WHERE event_id = ${event!.id}`,
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it('one chain, never a fork: a second row superseding the same event is refused', async () => {
    const [target] = (await asOwner(
      'an event',
      sql`
      SELECT supersedes_event_id AS id FROM attendance_event WHERE user_id = ${people.b} AND is_void`,
    )) as { id: string }[];
    await expect(
      asOwner(
        'second void',
        sql`
        INSERT INTO attendance_event (organization_id, user_id, kind, occurred_at, source, evidence, supersedes_event_id, is_void)
        VALUES (${ORG}, ${people.b}, 'out', '2026-09-28T05:02:00+05:30', 'system', 'confirmed', ${target!.id}, true)`,
      ),
    ).rejects.toThrow(/ux_attendance_event_supersedes/);
  });
});
```

- [ ] **Run it and watch it fail** — expected: `Error: Failed to load url ./facade.js … Does the file exist?`

- [ ] **Create** `packages/server/src/modules/attendance/errors.ts`:

```ts
import { ApplicationError } from '../../errors.js';

export const ATTENDANCE_ERROR_CODES = {
  CLIENT_EVENT_REUSED: 'ATTENDANCE_CLIENT_EVENT_REUSED',
  NO_DAY_FOR_INSTANT: 'ATTENDANCE_NO_DAY_FOR_INSTANT',
  EVENT_NOT_FOUND: 'ATTENDANCE_EVENT_NOT_FOUND',
} as const;

/** 409: one client event id, two different requests (TX-7). */
export class AttendanceConflictError extends ApplicationError {
  constructor(code: string, message: string) {
    super(message, 409, code);
    this.name = 'AttendanceConflictError';
  }
}

export class AttendanceNotFoundError extends ApplicationError {
  constructor(code: string, message: string) {
    super(message, 404, code);
    this.name = 'AttendanceNotFoundError';
  }
}
```

- [ ] **Create** `packages/server/src/modules/attendance/events.ts`:

```ts
/**
 * Outbox events from attendance (design §4).
 *
 * `attendance.recalc-requested` is written for every record whose inputs
 * changed, in the transaction that changed them; its handler (step 3b) queues
 * the recalculation job keyed by record and input version, so duplicates
 * collapse (AT-I4). Until 3b registers the handler, the rows wait.
 */
export const ATTENDANCE_EVENTS = {
  RECALC_REQUESTED: 'attendance.recalc-requested',
} as const;

export interface RecalcRequested {
  readonly recordId: string;
  readonly userId: string;
  readonly workDate: string;
  readonly inputVersion: number;
}
```

- [ ] **Create** `packages/server/src/modules/attendance/ports.ts`:

```ts
import type { PresenceProjector } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';

/**
 * The presence projector port (design §4, D9, LS-1). live-status implements it
 * and registers it at boot (step 4); attendance calls it inside `appendEvent`,
 * in the same transaction, and so never imports live-status. Until step 4 there
 * is nothing to project, so no projector is registered and the call is skipped.
 */
let projector: PresenceProjector<Tx> | null = null;

export function registerPresenceProjector(next: PresenceProjector<Tx>): void {
  if (projector !== null) throw new Error('A presence projector is already registered');
  projector = next;
}

export function presenceProjector(): PresenceProjector<Tx> | null {
  return projector;
}

/** Tests only. */
export function __resetPresenceProjector(): void {
  projector = null;
}
```

- [ ] **Create** `packages/server/src/modules/attendance/repository.ts`:

```ts
import type {
  AssignmentReason,
  DateOnly,
  EventKind,
  EventSource,
  Evidence,
  ResolvedShift,
} from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { ATTENDANCE_EVENTS, type RecalcRequested } from './events.js';

/**
 * SQL for the ledger, the day records and the assignments (design §8.1).
 * Dates come back as 'YYYY-MM-DD' text, never as JavaScript Dates (T-1).
 */

/** D24 — one person's writes run one at a time; everyone else in parallel. */
export async function lockPerson(tx: Tx, userId: string): Promise<void> {
  await tx.query(sql`
    SELECT pg_advisory_xact_lock(hashtextextended('attendance:' || current_organization_id()::text || ':' || ${userId}, 0))
  `);
}

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

export interface NewEvent {
  readonly organizationId: string;
  readonly userId: string;
  readonly kind: EventKind;
  readonly occurredAt: Date;
  readonly source: EventSource;
  readonly evidence: Evidence;
  readonly biometricPunchId?: string | null;
  readonly correctionId?: string | null;
  readonly supersedesEventId?: string | null;
  readonly isVoid?: boolean;
  readonly remote?: boolean;
  readonly clientEventId?: string | null;
  readonly clientRequestHash?: string | null;
  readonly clientTime?: Date | null;
  readonly recordedBy?: string | null;
}

/** The database generates every id, so a row can only ever name an older one (§8.1). */
export async function insertEvent(tx: Tx, e: NewEvent): Promise<string> {
  const row = await tx.one<{ id: string }>(sql`
    INSERT INTO attendance_event (
      organization_id, user_id, kind, occurred_at, source, evidence, biometric_punch_id, correction_id,
      supersedes_event_id, is_void, remote, client_event_id, client_request_hash, client_time, recorded_by
    ) VALUES (
      ${e.organizationId}, ${e.userId}, ${e.kind}, ${e.occurredAt}, ${e.source}, ${e.evidence},
      ${e.biometricPunchId ?? null}, ${e.correctionId ?? null}, ${e.supersedesEventId ?? null},
      ${e.isVoid ?? false}, ${e.remote ?? false}, ${e.clientEventId ?? null}, ${e.clientRequestHash ?? null},
      ${e.clientTime ?? null}, ${e.recordedBy ?? null}
    )
    RETURNING id
  `);
  return row.id;
}

export interface ClientEventRow {
  eventId: string;
  clientRequestHash: string | null;
  workDate: DateOnly | null;
  reason: AssignmentReason | null;
}

export async function findClientEvent(
  tx: Tx,
  userId: string,
  clientEventId: string,
): Promise<ClientEventRow | null> {
  return tx.maybeOne<ClientEventRow>(sql`
    SELECT e.id AS event_id, e.client_request_hash, r.work_date::text AS work_date, a.reason
    FROM attendance_event e
    LEFT JOIN attendance_event_assignment a ON a.organization_id = e.organization_id AND a.event_id = e.id
    LEFT JOIN attendance_record r ON r.organization_id = a.organization_id AND r.id = a.attendance_record_id
    WHERE e.user_id = ${userId} AND e.client_event_id = ${clientEventId}
  `);
}

export interface StoredEvent {
  id: string;
  userId: string;
  kind: EventKind;
  occurredAt: Date;
  source: EventSource;
  evidence: Evidence;
  isVoid: boolean;
  superseded: boolean;
  recordId: string | null;
  workDate: DateOnly | null;
}

export async function findEvent(tx: Tx, eventId: string): Promise<StoredEvent | null> {
  return tx.maybeOne<StoredEvent>(sql`
    SELECT e.id, e.user_id, e.kind, e.occurred_at, e.source, e.evidence, e.is_void,
           EXISTS (SELECT 1 FROM attendance_event s
                   WHERE s.organization_id = e.organization_id AND s.supersedes_event_id = e.id) AS superseded,
           a.attendance_record_id AS record_id, r.work_date::text AS work_date
    FROM attendance_event e
    LEFT JOIN attendance_event_assignment a ON a.organization_id = e.organization_id AND a.event_id = e.id
    LEFT JOIN attendance_record r ON r.organization_id = a.organization_id AND r.id = a.attendance_record_id
    WHERE e.id = ${eventId}
  `);
}

export interface NeighbourhoodEvent {
  id: string;
  kind: EventKind;
  occurredAt: Date;
  source: EventSource;
  evidence: Evidence;
  assignedDate: DateOnly | null;
  reason: AssignmentReason | null;
  pinned: boolean | null;
}

/**
 * D28 — `effectiveEventsOf`: the one definition of an effective event. Not a
 * void row, and not named by any row's `supersedes_event_id`. Returns those
 * whose instant falls in [from, to), or that are assigned to a day in
 * `firstDate..lastDate`, with their current assignment.
 */
export async function effectiveEventsOf(
  tx: Tx,
  userId: string,
  window: { readonly from: Date; readonly to: Date },
  dates: { readonly first: DateOnly; readonly last: DateOnly },
): Promise<NeighbourhoodEvent[]> {
  return tx.query<NeighbourhoodEvent>(sql`
    SELECT e.id, e.kind, e.occurred_at, e.source, e.evidence,
           r.work_date::text AS assigned_date, a.reason, a.pinned
    FROM attendance_event e
    LEFT JOIN attendance_event_assignment a ON a.organization_id = e.organization_id AND a.event_id = e.id
    LEFT JOIN attendance_record r ON r.organization_id = a.organization_id AND r.id = a.attendance_record_id
    WHERE e.user_id = ${userId}
      AND NOT e.is_void
      AND NOT EXISTS (SELECT 1 FROM attendance_event s
                      WHERE s.organization_id = e.organization_id AND s.supersedes_event_id = e.id)
      AND ((e.occurred_at >= ${window.from} AND e.occurred_at < ${window.to})
           OR r.work_date BETWEEN ${dates.first} AND ${dates.last})
    ORDER BY e.occurred_at, e.id
  `);
}

/* ------------------------------------------------------------------ *
 * Records
 * ------------------------------------------------------------------ */

export interface DayFactsRow {
  readonly workDate: DateOnly;
  readonly windowStart: Date;
  readonly windowEnd: Date;
  readonly closeDueAt: Date;
  readonly shift: ResolvedShift;
  readonly dayType: 'working' | 'week-off' | 'holiday';
}

export interface Placement {
  readonly departmentId: string | null;
  readonly teamId: string | null;
  readonly positionId: string | null;
}

export async function currentPlacement(tx: Tx, userId: string): Promise<Placement> {
  return tx.one<Placement>(
    sql`SELECT department_id, team_id, position_id FROM app_user WHERE id = ${userId}`,
  );
}

export interface RecordRow {
  id: string;
  workDate: DateOnly;
  state: 'open' | 'closed';
  inputVersion: number;
  attributionFlags: string[];
}

/**
 * Insert-then-lock (§8.4 steps 5 and 6): "find, else create" would lose a race
 * with day-open; the unique day index makes one insert a no-op and both
 * callers end up holding the same row.
 */
export async function materialise(
  tx: Tx,
  organizationId: string,
  userId: string,
  days: readonly DayFactsRow[],
  placement: Placement,
): Promise<Map<DateOnly, RecordRow>> {
  for (const day of days) {
    await tx.query(sql`
      INSERT INTO attendance_record (
        organization_id, user_id, work_date, window_start, window_end, close_due_at,
        shift_snapshot, shift_source, placement_snapshot, day_type
      ) VALUES (
        ${organizationId}, ${userId}, ${day.workDate}, ${day.windowStart}, ${day.windowEnd}, ${day.closeDueAt},
        ${JSON.stringify(day.shift)}::jsonb, ${day.shift.source}, ${JSON.stringify(placement)}::jsonb, ${day.dayType}
      )
      ON CONFLICT (organization_id, user_id, work_date) DO NOTHING
    `);
  }
  return lockRecords(
    tx,
    userId,
    days.map((day) => day.workDate),
  );
}

export async function lockRecords(
  tx: Tx,
  userId: string,
  dates: readonly DateOnly[],
): Promise<Map<DateOnly, RecordRow>> {
  if (dates.length === 0) return new Map();
  const rows = await tx.query<RecordRow>(sql`
    SELECT id, work_date::text AS work_date, state, input_version, attribution_flags
    FROM attendance_record
    WHERE user_id = ${userId} AND work_date = ANY(${[...dates]}::date[])
    ORDER BY work_date
    FOR UPDATE
  `);
  return new Map(rows.map((row) => [row.workDate, row]));
}

/**
 * `refreshDayFacts` for an open day (§8.5): while a day is open its facts
 * follow the shifts. Returns true when anything changed.
 */
export async function refreshFacts(
  tx: Tx,
  recordId: string,
  day: DayFactsRow,
): Promise<boolean> {
  const rows = await tx.query<{ id: string }>(sql`
    UPDATE attendance_record
    SET window_start = ${day.windowStart}, window_end = ${day.windowEnd}, close_due_at = ${day.closeDueAt},
        shift_snapshot = ${JSON.stringify(day.shift)}::jsonb, shift_source = ${day.shift.source},
        day_type = ${day.dayType}
    WHERE id = ${recordId} AND state = 'open'
      AND (window_start, window_end, close_due_at, shift_snapshot, day_type) IS DISTINCT FROM
          (${day.windowStart}::timestamptz, ${day.windowEnd}::timestamptz, ${day.closeDueAt}::timestamptz,
           ${JSON.stringify(day.shift)}::jsonb, ${day.dayType}::text)
    RETURNING id
  `);
  return rows.length === 1;
}

export async function setAttributionFlags(
  tx: Tx,
  recordId: string,
  flags: readonly string[],
): Promise<boolean> {
  const rows = await tx.query<{ id: string }>(sql`
    UPDATE attendance_record SET attribution_flags = ${[...flags].sort()}::text[]
    WHERE id = ${recordId} AND attribution_flags IS DISTINCT FROM ${[...flags].sort()}::text[]
    RETURNING id
  `);
  return rows.length === 1;
}

/* ------------------------------------------------------------------ *
 * Assignments
 * ------------------------------------------------------------------ */

/** Writes the assignment only when its day or reason changed. Returns the day it left, if any. */
export async function assign(
  tx: Tx,
  a: {
    organizationId: string;
    userId: string;
    eventId: string;
    recordId: string;
    reason: AssignmentReason;
    pinned: boolean;
  },
): Promise<{ changed: boolean; previousRecordId: string | null }> {
  const previous = await tx.maybeOne<{ recordId: string; reason: AssignmentReason }>(sql`
    SELECT attendance_record_id AS record_id, reason FROM attendance_event_assignment WHERE event_id = ${a.eventId}
  `);
  if (
    previous !== null &&
    previous.recordId === a.recordId &&
    previous.reason === a.reason
  ) {
    return { changed: false, previousRecordId: previous.recordId };
  }
  await tx.query(sql`
    INSERT INTO attendance_event_assignment (organization_id, user_id, event_id, attendance_record_id, reason, pinned)
    VALUES (${a.organizationId}, ${a.userId}, ${a.eventId}, ${a.recordId}, ${a.reason}, ${a.pinned})
    ON CONFLICT (organization_id, event_id) DO UPDATE
    SET attendance_record_id = EXCLUDED.attendance_record_id, reason = EXCLUDED.reason, pinned = EXCLUDED.pinned,
        assignment_version = attendance_event_assignment.assignment_version + 1, assigned_at = now()
  `);
  return { changed: true, previousRecordId: previous?.recordId ?? null };
}

/** Every record whose inputs changed gets a new input version and a recalculation request. */
export async function bumpInputVersions(
  tx: Tx,
  organizationId: string,
  userId: string,
  recordIds: ReadonlySet<string>,
): Promise<void> {
  if (recordIds.size === 0) return;
  const rows = await tx.query<{ id: string; workDate: string; inputVersion: number }>(sql`
    UPDATE attendance_record SET input_version = input_version + 1
    WHERE id = ANY(${[...recordIds]}::uuid[])
    RETURNING id, work_date::text AS work_date, input_version
  `);
  for (const row of rows) {
    const payload: RecalcRequested = {
      recordId: row.id,
      userId,
      workDate: row.workDate,
      inputVersion: row.inputVersion,
    };
    await tx.query(sql`
      INSERT INTO domain_outbox (organization_id, event_name, payload)
      VALUES (${organizationId}, ${ATTENDANCE_EVENTS.RECALC_REQUESTED}, ${JSON.stringify(payload)}::jsonb)
    `);
  }
}
```

- [ ] **Create** `packages/server/src/modules/attendance/ledger.ts`:

```ts
import type {
  AssignmentReason,
  AttendanceEventInput,
  DateOnly,
  EventKind,
  EventSource,
  Evidence,
} from '@tapcrm/contracts';
import { PINNED_REASONS } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { organizationTimezone } from '../../platform/organization-time.js';
import {
  addDays,
  localDateOf,
  systemClock,
  wholeSeconds,
  type Clock,
} from '../../platform/time.js';
import * as CalendarFacade from '../holidays/facade.js';
import * as ShiftsFacade from '../shifts/facade.js';
import {
  attributeAll,
  currentDay,
  dayOfWindow,
  type LedgerEvent,
  type Placement,
} from './attribute.js';
import { factsFor, type DayFacts } from './day-facts.js';
import {
  ATTENDANCE_ERROR_CODES,
  AttendanceConflictError,
  AttendanceNotFoundError,
} from './errors.js';
import { presenceProjector } from './ports.js';
import * as repo from './repository.js';

/**
 * The ledger — design §8.4. Every writer follows one lock order: the person's
 * advisory lock first, then record rows (D24). Nothing here opens a
 * transaction; each function runs inside the caller's (MB-2, TX-5).
 */

/** How far a neighbourhood pass may widen before it stops (§8.4 step 9). */
const MAX_PASSES = 6;

async function organizationIdOf(tx: Tx): Promise<string> {
  return (await tx.one<{ id: string }>(sql`SELECT current_organization_id() AS id`)).id;
}

/** Facts for every date `first..last`, from shifts (§5.2, §8.5). */
async function loadFacts(
  tx: Tx,
  userId: string,
  first: DateOnly,
  last: DateOnly,
): Promise<Map<DateOnly, DayFacts>> {
  return factsFor(
    await ShiftsFacade.shiftDays(tx, userId, addDays(first, -1), addDays(last, 1)),
  );
}

function toInput(row: repo.NeighbourhoodEvent): AttendanceEventInput {
  return {
    id: row.id,
    kind: row.kind,
    at: row.occurredAt.toISOString(),
    source: row.source,
    evidence: row.evidence,
    assignmentReason: row.reason ?? 'midpoint',
  };
}

const isPinned = (reason: AssignmentReason) => PINNED_REASONS.includes(reason);

interface PassResult {
  readonly placements: ReadonlyMap<string, Placement>;
}

/**
 * §8.4 step 9 — re-attribute the neighbourhood: the day before, the days
 * given, the day after. Only assignments whose day or reason changes are
 * written; pinned ones stay. Every record that gained, lost or re-explained an
 * event, or whose facts or flags changed, gets a new input version and a
 * recalculation request. If an event moves onto or off an outer day, the pass
 * widens by a day on that side.
 */
export async function reattribute(
  tx: Tx,
  userId: string,
  around: readonly DateOnly[],
): Promise<PassResult> {
  const organizationId = await organizationIdOf(tx);
  const sorted = [...around].sort();
  let lo = addDays(sorted[0]!, -1);
  let hi = addDays(sorted[sorted.length - 1]!, 1);

  let facts = new Map<DateOnly, DayFacts>();
  let events: repo.NeighbourhoodEvent[] = [];
  let recomputed = new Set<string>();
  let placements: ReadonlyMap<string, Placement> = new Map();
  let flags: ReadonlyMap<DateOnly, ReadonlySet<string>> = new Map();

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    facts = await loadFacts(tx, userId, addDays(lo, -2), addDays(hi, 2));
    events = await repo.effectiveEventsOf(
      tx,
      userId,
      {
        from: facts.get(addDays(lo, -1))!.windowStart,
        to: facts.get(addDays(hi, 1))!.windowEnd,
      },
      { first: addDays(lo, -2), last: addDays(hi, 2) },
    );
    recomputed = new Set();
    const ledger: LedgerEvent[] = [];
    for (const row of events) {
      const event = toInput(row);
      const fixed =
        row.assignedDate !== null && row.reason !== null
          ? { date: row.assignedDate, reason: row.reason }
          : undefined;
      const windowDay = dayOfWindow(facts, row.occurredAt)?.date;
      const inside = windowDay !== undefined && windowDay >= lo && windowDay <= hi;
      if (fixed !== undefined && (isPinned(fixed.reason) || !inside))
        ledger.push({ event, fixed });
      else if (inside) {
        ledger.push({ event });
        recomputed.add(row.id);
      }
    }
    ({ placements, flags } = attributeAll(ledger, facts));

    let widenLow = false;
    let widenHigh = false;
    for (const row of events) {
      if (!recomputed.has(row.id)) continue;
      const next = placements.get(row.id);
      if (
        next === undefined ||
        (next.date === row.assignedDate && next.reason === row.reason)
      )
        continue;
      if (next.date === lo || row.assignedDate === lo) widenLow = true;
      if (next.date === hi || row.assignedDate === hi) widenHigh = true;
    }
    if ((!widenLow && !widenHigh) || pass === MAX_PASSES - 1) break;
    if (widenLow) lo = addDays(lo, -1);
    if (widenHigh) hi = addDays(hi, 1);
  }

  // Materialise every day that owns an event, then lock the days in range.
  const first = addDays(lo, -1);
  const last = addDays(hi, 1);
  const calendar = new Map(
    (await CalendarFacade.dayTypeRange(tx, userId, first, last)).map(
      (day) => [day.date, day.type] as const,
    ),
  );
  const factsRow = (date: DateOnly): repo.DayFactsRow => {
    const fact = facts.get(date)!;
    return {
      workDate: date,
      windowStart: fact.windowStart,
      windowEnd: fact.windowEnd,
      closeDueAt: fact.closingCap,
      shift: fact.shift,
      dayType: calendar.get(date) ?? 'working',
    };
  };
  const owning = new Set<DateOnly>();
  for (const id of recomputed) {
    const placement = placements.get(id);
    if (placement !== undefined) owning.add(placement.date);
  }
  const placement = await repo.currentPlacement(tx, userId);
  await repo.materialise(
    tx,
    organizationId,
    userId,
    [...owning].sort().map(factsRow),
    placement,
  );
  const range: DateOnly[] = [];
  for (let date = first; date <= last; date = addDays(date, 1)) range.push(date);
  const records = await repo.lockRecords(tx, userId, range);

  const touched = new Set<string>();
  // refreshDayFacts for the open days in range (§8.5).
  for (const record of records.values()) {
    if (await repo.refreshFacts(tx, record.id, factsRow(record.workDate)))
      touched.add(record.id);
  }
  for (const row of events) {
    if (!recomputed.has(row.id)) continue;
    const next = placements.get(row.id);
    const record = next === undefined ? undefined : records.get(next.date);
    if (next === undefined || record === undefined) continue;
    const { changed, previousRecordId } = await repo.assign(tx, {
      organizationId,
      userId,
      eventId: row.id,
      recordId: record.id,
      reason: next.reason,
      pinned: isPinned(next.reason),
    });
    if (!changed) continue;
    touched.add(record.id);
    if (previousRecordId !== null) touched.add(previousRecordId);
  }
  // Attribution flags: rewritten inside the range, added to the day before it.
  for (const record of records.values()) {
    const raised = [...(flags.get(record.workDate) ?? [])];
    const next =
      record.workDate < lo
        ? [...new Set([...record.attributionFlags, ...raised])]
        : raised;
    if (await repo.setAttributionFlags(tx, record.id, next)) touched.add(record.id);
  }
  await repo.bumpInputVersions(tx, organizationId, userId, touched);
  return { placements };
}

/* ------------------------------------------------------------------ *
 * appendEvent — §8.4
 * ------------------------------------------------------------------ */

export interface AppendEventInput {
  readonly userId: string;
  readonly kind: EventKind;
  readonly at: Date;
  readonly source: EventSource;
  readonly evidence: Evidence;
  readonly biometricPunchId?: string | null;
  readonly remote?: boolean;
  readonly clientEventId?: string | null;
  readonly clientRequestHash?: string | null;
  readonly clientTime?: Date | null;
  readonly recordedBy?: string | null;
}

export interface AppendEventResult {
  readonly eventId: string;
  readonly workDate: DateOnly | null;
  readonly reason: AssignmentReason | null;
  /** True when a retried client event returned its first result. */
  readonly replayed: boolean;
}

async function replayed(
  tx: Tx,
  input: AppendEventInput,
): Promise<AppendEventResult | null> {
  if (input.clientEventId == null) return null;
  const first = await repo.findClientEvent(tx, input.userId, input.clientEventId);
  if (first === null) return null;
  if ((first.clientRequestHash ?? null) !== (input.clientRequestHash ?? null)) {
    throw new AttendanceConflictError(
      ATTENDANCE_ERROR_CODES.CLIENT_EVENT_REUSED,
      'This client event id was already used for a different punch.',
    );
  }
  return {
    eventId: first.eventId,
    workDate: first.workDate,
    reason: first.reason,
    replayed: true,
  };
}

/**
 * Steps 1–4, 8, 9 and 12 of §8.4. The interactive checks of step 7 arrive
 * with the punch route (step 4), closure re-derivation (step 10) with
 * auto-close (step 7), and the board (step 11) through the projector port.
 */
export async function appendEvent(
  tx: Tx,
  input: AppendEventInput,
  clock: Clock = systemClock,
): Promise<AppendEventResult> {
  // 1. The cheap check: a retry of a punch already recorded.
  const fast = await replayed(tx, input);
  if (fast !== null) return fast;
  // 2. One punch at a time per person.
  await repo.lockPerson(tx, input.userId);
  // 3. Again under the lock, so two identical retries get one answer, not a unique violation.
  const locked = await replayed(tx, input);
  if (locked !== null) return locked;

  const at = wholeSeconds(input.at); // T-6
  const eventId = await repo.insertEvent(tx, {
    organizationId: await organizationIdOf(tx),
    userId: input.userId,
    kind: input.kind,
    occurredAt: at,
    source: input.source,
    evidence: input.evidence,
    biometricPunchId: input.biometricPunchId ?? null,
    remote: input.remote ?? false,
    clientEventId: input.clientEventId ?? null,
    clientRequestHash: input.clientRequestHash ?? null,
    clientTime: input.clientTime ?? null,
    recordedBy: input.recordedBy ?? null,
  });
  const local = localDateOf(at, await organizationTimezone(tx));
  const { placements } = await reattribute(tx, input.userId, [local]);
  const placement = placements.get(eventId) ?? null;

  const projector = presenceProjector();
  if (projector !== null) await projector.refresh(tx, input.userId, clock.now());
  return {
    eventId,
    workDate: placement?.date ?? null,
    reason: placement?.reason ?? null,
    replayed: false,
  };
}

/* ------------------------------------------------------------------ *
 * retireEvent — §8.4, §10.3 step 7
 * ------------------------------------------------------------------ */

export type RetireResult =
  | { readonly retired: true; readonly voidEventId: string }
  /** A correction already superseded it: a human decision is changed only by a human. */
  | { readonly retired: false; readonly reason: 'already-superseded' };

/**
 * Retires one effective event with a system void row, pinned to the day it was
 * on, then re-attributes the neighbourhood — the same steps as an append,
 * without one. Used when a punch displaces a duplicate (step 5) and when a
 * re-derived closure retires an auto-out (step 7).
 */
export async function retireEvent(tx: Tx, eventId: string): Promise<RetireResult> {
  const found = await repo.findEvent(tx, eventId);
  if (found === null)
    throw new AttendanceNotFoundError(
      ATTENDANCE_ERROR_CODES.EVENT_NOT_FOUND,
      'No such attendance event.',
    );
  await repo.lockPerson(tx, found.userId);
  const target = (await repo.findEvent(tx, eventId))!;
  if (target.isVoid || target.superseded)
    return { retired: false, reason: 'already-superseded' };

  const organizationId = await organizationIdOf(tx);
  const voidEventId = await repo.insertEvent(tx, {
    organizationId,
    userId: target.userId,
    kind: target.kind,
    occurredAt: target.occurredAt,
    source: 'system',
    evidence: target.evidence,
    supersedesEventId: target.id,
    isVoid: true,
  });
  if (target.recordId !== null) {
    await repo.assign(tx, {
      organizationId,
      userId: target.userId,
      eventId: voidEventId,
      recordId: target.recordId,
      reason: 'reconciliation',
      pinned: true,
    });
  }
  const date =
    target.workDate ?? localDateOf(target.occurredAt, await organizationTimezone(tx));
  await reattribute(tx, target.userId, [date]);
  return { retired: true, voidEventId };
}

/* ------------------------------------------------------------------ *
 * Read-only questions
 * ------------------------------------------------------------------ */

async function placedAround(tx: Tx, userId: string, at: Date) {
  const local = localDateOf(at, await organizationTimezone(tx));
  const facts = await loadFacts(tx, userId, addDays(local, -3), addDays(local, 3));
  const events = await repo.effectiveEventsOf(
    tx,
    userId,
    {
      from: facts.get(addDays(local, -2))!.windowStart,
      to: facts.get(addDays(local, 2))!.windowEnd,
    },
    { first: addDays(local, -3), last: addDays(local, 3) },
  );
  return { facts, events };
}

/** §5.2 — which day would own this event, and why, given everything recorded so far. */
export async function attributeEvent(
  tx: Tx,
  input: { readonly userId: string; readonly kind: EventKind; readonly occurredAt: Date },
): Promise<{
  readonly placement: Placement | null;
  readonly flags: ReadonlyMap<DateOnly, ReadonlySet<string>>;
}> {
  const at = wholeSeconds(input.occurredAt);
  const { facts, events } = await placedAround(tx, input.userId, at);
  const probe: AttendanceEventInput = {
    id: 'proposed',
    kind: input.kind,
    at: at.toISOString(),
    source: 'web',
    evidence: 'confirmed',
    assignmentReason: 'midpoint',
  };
  const ledger: LedgerEvent[] = events
    .filter((row) => row.assignedDate !== null && row.reason !== null)
    .map((row) => ({
      event: toInput(row),
      fixed: { date: row.assignedDate!, reason: row.reason! },
    }));
  const { placements, flags } = attributeAll([...ledger, { event: probe }], facts);
  return { placement: placements.get(probe.id) ?? null, flags };
}

/** §5.2 — the day the person is IN at `at`. */
export async function currentDayFor(
  tx: Tx,
  userId: string,
  at: Date,
): Promise<DateOnly | null> {
  const { facts, events } = await placedAround(tx, userId, at);
  const placed = events
    .filter((row) => row.assignedDate !== null)
    .map((row) => ({ event: toInput(row), date: row.assignedDate! }));
  return currentDay(facts, placed, at);
}
```

- [ ] **Create** `packages/server/src/modules/attendance/facade.ts`:

```ts
/**
 * The attendance façade — the only file other modules may import (MB-1, §4).
 *
 * Synchronous, and every function takes the caller's transaction (MB-2, TX-5).
 * Callers: live-status (step 4), biometric (step 5), leave (step 6), payroll.
 * Step 3a provides the ledger half: appending and retiring events, and the two
 * questions every caller asks — which day owns an event, and which day a
 * person is in.
 */
export {
  appendEvent,
  attributeEvent,
  currentDayFor,
  retireEvent,
  type AppendEventInput,
  type AppendEventResult,
  type RetireResult,
} from './ledger.js';
export { registerPresenceProjector } from './ports.js';
export { ATTENDANCE_EVENTS, type RecalcRequested } from './events.js';
```

- [ ] **Run the test again.** Expected: `Tests  10 passed (10)`.

Checkpoint: leave the changes in the working tree for review.

---

## Task 6 — CI: attendance owns its tables; one presence state machine (§20, D26)

- [ ] **Add attendance to the table owners** — `tools/ci/tables.ts`:

```diff
--- a/tools/ci/tables.ts
+++ b/tools/ci/tables.ts
@@ -15,6 +15,7 @@ export const TABLE_OWNERS: readonly {
 }[] = [
   { module: 'shifts',   tables: /^(shift|shift_[a-z_]+|department_shift_default)$/ },
   { module: 'holidays', tables: /^(holiday|holiday_[a-z_]+)$/ },
+  { module: 'attendance', tables: /^(attendance_[a-z_]+|arrival_policy_override|arrival_exception)$/ },
 ];
 
 export interface TableViolation {
```

- [ ] **Write the test** — `tools/ci/presence-rules.test.ts`:

```ts
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findPresenceViolations } from './presence-rules.js';

const ROOT = '/repo';
const file = (path: string, text: string) => ({ path: resolve(ROOT, path), text });

describe('D26 — one presence state machine (design §20)', () => {
  it('allows the declaration in contracts/presence.ts', () => {
    expect(
      findPresenceViolations(
        [
          file(
            'packages/contracts/src/presence.ts',
            "export type PresenceState = 'NOT_IN' | 'WORKING';\nNOT_IN: { in: 'WORKING' }",
          ),
        ],
        ROOT,
      ),
    ).toEqual([]);
  });

  it('flags a transition table declared anywhere else', () => {
    const found = findPresenceViolations(
      [
        file(
          'packages/server/src/modules/live-status/state.ts',
          "const T = {\n  NOT_IN: { in: 'WORKING' },\n};",
        ),
      ],
      ROOT,
    );
    expect(found).toEqual([
      {
        file: 'packages/server/src/modules/live-status/state.ts',
        line: 2,
        what: 'declares a presence transition table',
      },
    ]);
  });

  it('flags the union spelled out again', () => {
    const found = findPresenceViolations(
      [
        file(
          'packages/server/src/modules/attendance/types.ts',
          "type S = 'NOT_IN' | 'WORKING' | 'FINISHED';",
        ),
      ],
      ROOT,
    );
    expect(found[0]?.what).toBe('declares the PresenceState union');
  });

  it('flags attendance importing live-status, even through its façade', () => {
    const found = findPresenceViolations(
      [
        file(
          'packages/server/src/modules/attendance/ledger.ts',
          "import { x } from '../live-status/facade.js';",
        ),
      ],
      ROOT,
    );
    expect(found[0]?.what).toBe('imports live-status');
  });

  it('lets a state be compared by name', () => {
    expect(
      findPresenceViolations(
        [
          file(
            'packages/server/src/modules/attendance/ledger.ts',
            "if (state === 'WORKING') {}",
          ),
        ],
        ROOT,
      ),
    ).toEqual([]);
  });
});
```

- [ ] **Run it and watch it fail** — expected: `Error: Failed to load url ./presence-rules.js … Does the file exist?`

- [ ] **Create** `tools/ci/presence-rules.ts`:

```ts
import { relative, sep } from 'node:path';
import { locateInModule, type SourceFile } from './boundary.js';

/**
 * State machine ownership — attendance design §20, D26.
 *
 * The presence state machine is declared once, in
 * packages/contracts/src/presence.ts. Anything else that declares a
 * transition table or the PresenceState union is a second state machine,
 * and the two would drift. And attendance never imports live-status: the
 * projector port is how attendance reaches the board (design §4).
 */

export interface PresenceViolation {
  readonly file: string;
  readonly line: number;
  readonly what: string;
}

const HOME = ['packages', 'contracts', 'src', 'presence.ts'].join(sep);

/** A transition table's keys, or the union spelled out. */
const DECLARATIONS: readonly { readonly pattern: RegExp; readonly what: string }[] = [
  { pattern: /\b(?:NOT_IN|ON_BREAK)\s*:\s*\{/g, what: 'a presence transition table' },
  { pattern: /'NOT_IN'\s*\|\s*'WORKING'/g, what: 'the PresenceState union' },
];

const LIVE_STATUS_IMPORT =
  /\bfrom\s+['"][./]*(?:\.\.\/)+live-status\/|\bfrom\s+['"][^'"]*modules\/live-status\//g;

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

export function findPresenceViolations(
  files: readonly SourceFile[],
  root: string,
): PresenceViolation[] {
  const violations: PresenceViolation[] = [];
  for (const file of files) {
    const path = relative(root, file.path);
    if (path !== HOME && !path.endsWith('.test.ts')) {
      for (const { pattern, what } of DECLARATIONS) {
        for (const match of file.text.matchAll(pattern)) {
          violations.push({
            file: path,
            line: lineOf(file.text, match.index),
            what: `declares ${what}`,
          });
        }
      }
    }
    if (locateInModule(root, file.path)?.module === 'attendance') {
      for (const match of file.text.matchAll(LIVE_STATUS_IMPORT)) {
        violations.push({
          file: path,
          line: lineOf(file.text, match.index),
          what: 'imports live-status',
        });
      }
    }
  }
  return violations;
}
```

- [ ] **Use it** in `tools/ci/index.ts`:

```diff
--- a/tools/ci/index.ts
+++ b/tools/ci/index.ts
@@ -26,6 +26,7 @@ import { fileURLToPath, pathToFileURL } from 'node:url';
 import { findBoundaryViolations } from './boundary.js';
 import { findDateShortcuts, findTimeLibraryImports } from './time-rules.js';
 import { findForeignTableUse } from './tables.js';
+import { findPresenceViolations } from './presence-rules.js';
 
 const HERE = dirname(fileURLToPath(import.meta.url));
 const ROOT = resolve(HERE, '../..');
@@ -329,6 +330,24 @@ const POLICY_FILTER = /^[ \t]*(?:async\s+)?filter\s*\(/m;
   if (violations.length === 0) ok('SH-1   shift tables read only by the shifts module');
 }
 
+/* ================================================================== *
+ * D26 — one presence state machine (attendance design §20)
+ *
+ * The transition table and the PresenceState union live in
+ * packages/contracts/src/presence.ts only, and attendance never imports
+ * live-status.
+ * ================================================================== */
+{
+  const violations = findPresenceViolations(
+    sourceFiles.map((file) => ({ path: file, text: read(file) })),
+    ROOT,
+  );
+  for (const v of violations) {
+    blocking('D26', 'D26', `${v.file}:${v.line} ${v.what}. Use packages/contracts/src/presence.ts.`);
+  }
+  if (violations.length === 0) ok('D26    one presence state machine, in contracts/presence.ts');
+}
+
 /* ================================================================== *
  * CI-20 — no interpolated user-controlled SQL
  * ================================================================== */
```

- [ ] **Run** `npx vitest run tools/ci` (expected `Tests  26 passed (26)`) and
  `npm run ci` (expected `✓ D26    one presence state machine, in contracts/presence.ts`
  and `✓ 17 check(s) passed`).

Checkpoint: leave the changes in the working tree for review.

---

## Task 7 — Final check

```bash
npm run typecheck
npm run lint
npm run ci
npx vitest run --exclude '**/overrides.integration.test.ts'
```

Expected: typecheck and lint clean, `✓ 17 check(s) passed`, and every test
passes. This plan adds 15 + 19 + 5 unit tests, and 10 + 1 database tests.

Then review the working tree (`git status`, `git diff`). Nothing has been committed.

---

## What 3b picks up from here

- **The calculator** (§8.2), pure, over `readDay`: employment, eligibility,
  arrival and departure, breaks, minutes, shift facts, status and units in the
  AT-3 order, and flags. `attribution_flags` is copied into `flags`.
- **The recalculation job** keyed `recalc:{org}:{record}:{inputVersion}`, with
  generations (§5.4). An older job that finds the record already calculated
  exits without writing. A stale sweeper runs every five minutes.
- **Outbox handlers.**
  - `attendance.recalc-requested` queues the job.
  - `shifts.days-changed` and `holidays.days-changed` refresh day facts,
    re-attribute and queue recalculation for the people and dates they name.
    Note that shifts sends an inclusive `to`, and holidays an exclusive
    `toExclusive`.
- **`attendance_month_summary`**, kept in the same transaction as each
  recalculation.

## Found while planning — raise with the owners

1. **Employment dates do not exist yet.** `app_user` has no joining or leaving
   date, but the calculator's first rule (`not-employed`) and day-open's
   "only inside the employment window" both need one. Until
   `employee-directory` adds them, 3b and 3c will treat every active person as
   employed on every date. Worth adding before go-live, because payroll
   prorates by the employment window (L23).
2. **`openFrom` and `closingCap` for flexible and no-shift days** are not
   defined by §5.2. This plan uses the day's window edges (see "Decisions").
   Confirm, or give the rule.
3. **The step 2 plan's test table** names `calendar.test.ts` and
   `calendar.integration.test.ts`. The tests actually live in
   `holidays/resolve.test.ts` and `holidays/holidays.integration.test.ts`. This
   is a documentation slip only.
