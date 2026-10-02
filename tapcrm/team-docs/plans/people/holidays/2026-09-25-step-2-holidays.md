# Step 2 — Holidays and week-offs (server): implementation plan

**Goal.** One answer to "what kind of day is this for this person, on this
date": a dated holiday (national, regional, optional or shift-scoped), a
week-off rule, or a working day (HO-1, HO-2). Attendance and leave ask for
that answer through `CalendarFacade`; nobody else touches the holiday tables.

**Design.** `team-docs/specs/people/2026-09-22-attendance-shifts-payroll-design.md`
§7 (Step 2) and the outbox rule in §4.
**Roadmap.** `team-docs/plans/people/attendance/2026-09-25-attendance-roadmap.md`.
**Builds on.** Step 0 (time helpers, `btree_gist`, the outbox, the boundary
rules) and step 1 (the `shift` table, `ShiftsFacade.resolve`, the
`shifts.days-changed` outbox pattern).

**Done when** (design §7), each proved by a named test:

| Check | Test |
|---|---|
| The calendar returns the right day type per person and date | `calendar.integration.test.ts` › "done when: the calendar returns the right day type per person and date" |
| A national holiday applies to everyone; a regional one, only to its departments; a shift-scoped one, only to people whose resolved shift starts that day | `calendar.test.ts` › "HO-1" and "HO-2"; `calendar.integration.test.ts` › "HO-1 / HO-2" |
| Withdrawing a holiday queues recalculation for the affected people; punches stay | `holidays.integration.test.ts` › "HO-3" |
| A past-dated change without `attendance:correct` is refused | `holidays.integration.test.ts` › "past-dated change needs attendance:correct" |

"Marking a worked day `holiday-worked`" is attendance's arithmetic — that half
of HO-3 is verified once step 3's handler for `holidays.days-changed` lands.
What step 2 provides is the outbox event, and a test that asserts it was
written with the right payload.

**How to use this plan.** Do the tasks in order: test first, watch it fail,
then add the code, and watch it pass. Nothing is committed; each task ends
with its changes left for review. All code below has already been run against
the repository with step 1 applied: typecheck, lint, `npm run ci` (16 checks)
and the unit and database tests all pass.

---

## Decisions made in this plan

| Question | Decision | Why |
|---|---|---|
| How does holidays ask attendance to recalculate? | Same as shifts (step 1 "no import cycle"): a `holidays.days-changed` outbox event in the same transaction as the change. Attendance registers its handler in step 3. | Attendance depends on holidays, not the other way round (PRD §5.8). Until step 3 exists the rows wait; the drainer claims only events some process handles. The pattern mirrors `SHIFT_EVENTS.DAYS_CHANGED` exactly, so both handlers can share code |
| Optional-holiday claims (G9) | Not built. The resolver **ignores** `type = 'optional'` rows entirely | The claim is a leave request that lands with step 6. §7 says "counts only if the person claimed it," so before claims exist, an optional row must not turn any day into a holiday. It is still stored, listed and edited through the CRUD routes so HR can prepare the year's optional list ahead of step 6 |
| Week-off screens | Not built | Week-offs are ordinary `holiday` rows with `type = 'week-off'`; the three routes cover both. A screens step (2b) can come later without touching the server |
| Shift-scoped holidays under an overnight shift | The holiday belongs to the calendar date the shift **starts** on (§7). We use `ShiftsFacade.resolve` for that date and match its `shiftId` | Consistent with step 1's SH-1: "a night starting 31 March is a March day." The night worker who begins on the holiday date gets the holiday; the person who begins the day after does not |
| Seeding the year's holidays and the Saturday+Sunday rule | Not seeded here | HR must sign off the year's list (Q11 for the week-off pattern). Once they answer, the five rows go through `POST /api/holidays` — the same effort as writing a seed |
| Overlap check for week-off rules covering the same person | Not enforced at save time. Between two applicable active rules, the one with the **latest `effective_from`** wins (ties broken by `id`) | `holiday_scope` allows a rule to target many departments, so two rules might legitimately overlap. Rejecting the save would make one-off adjustments impossible. `GET /api/holidays` surfaces both rows so HR can see the pair. Using `effective_from` rather than `created_at` means business behaviour follows the "when the rule takes effect" date HR entered, not when they happened to type it in |
| Scope on week-off rules | Supported. A week-off row may carry `holiday_scope` rows (department or shift); the resolver applies them the same way it does for dated holidays | The schema already allows it, and TapCRM's real world has floors on rotating week-offs. Ignoring scope on week-offs would silently override those |
| Ordering when two dated holidays match the same person and date | Explicit priority: shift-scope > department-scope > national. Ties within one priority broken by `created_at`, then `id` | Otherwise database row order picks the winner, which is not reproducible |
| Scope invariants beyond "exactly one of department or shift" | Enforced by the service, not the database, because they depend on `holiday.type`: national → **no** scope rows; regional → **at least one** scope row, all department or all shift (never mixed); optional → no scope or department scope only; week-off → any of the three (no scope, department, or shift). A single holiday's scope rows are all department or all shift, never mixed | The database CHECK can only see one row at a time and does not know `holiday.type`. Mixed department + shift scope on one holiday makes "shift beats department" ambiguous, so we refuse it |
| Withdrawn vs deleted | Only withdrawn: `PATCH /api/holidays/:id` sets `status = 'withdrawn'` and the resolver ignores it. No DELETE grant | A deleted holiday would drop `holiday-worked` from every person who worked it, silently — the flag is an evidence record, not a claim about today's rule |

## Files

| File | What |
|---|---|
| `packages/contracts/src/people.ts` | `DayType`, `ResolvedDay` (§5.3) |
| `migrations/0048_holidays.sql` | The two tables of §7, with RLS, composite keys, typed scope columns and grants |
| `modules/holidays/resolve.ts` (+ test, fixtures) | The pure HO-1 / HO-2 chain: dated holiday → week-off rule → working day |
| `modules/holidays/errors.ts`, `rules.ts` (+ test) | Save-time rules: recurrence shape, scope kind consistency, start ≠ end |
| `modules/holidays/events.ts` | The `holidays.days-changed` outbox event |
| `modules/holidays/repository.ts`, `service.ts`, `validators.ts`, `policy.ts` (+ integration test) | Use cases, HO-3, HO-4 and past-dated authority |
| `modules/holidays/facade.ts` | `dayType`, `dayTypeRange`, `leaveDays` |
| `modules/holidays/routes.ts`, `modules/index.ts` | The three manifest routes |
| `tools/ci/tables.ts` (+ test) | Extends the SH-1 rule: only `holidays` touches `holiday` and `holiday_scope` |

(`modules/…` is under `packages/server/src/`.)

---

## Task 1 — Shared calendar types

- [ ] **Add the types** to `packages/contracts/src/people.ts`:

```diff
--- a/packages/contracts/src/people.ts
+++ b/packages/contracts/src/people.ts
@@ -1,8 +1,9 @@
 /**
  * People — shared types for shifts, holidays, attendance, live status,
  * biometric, leave, breaks and payroll (attendance design §5.3).
  *
- * Types only. Step 0 added the date types; step 1 the shift types. Later steps
- * add the event types here, and the presence state machine beside it.
+ * Types only. Step 0 added the date types; step 1 the shift types; step 2 the
+ * calendar types. Later steps add the event types here, and the presence state
+ * machine beside it.
  */
@@ -46,3 +47,26 @@ export interface ResolvedShift {
   maxClosingExtensionMinutes: number | null;
   timezone: string;
 }
+
+/** What kind of day this is for one person (design §7). */
+export type DayType = 'working' | 'week-off' | 'holiday';
+
+/** The holiday sub-kind — matters for leave counting and pay (HO-1, LV-3). */
+export type HolidaySubtype = 'national' | 'regional' | 'optional' | 'week-off';
+
+/** The calendar's answer for a person and a date (§7, §5.3). */
+export interface ResolvedDay {
+  date: DateOnly;
+  type: DayType;
+  /** Set when `type` is 'holiday' or 'week-off'. */
+  holidayId: string | null;
+  holidayName: string | null;
+  subtype: HolidaySubtype | null;
+  /**
+   * The scope that matched — 'national' when the holiday has no
+   * `holiday_scope`; 'department' or 'shift' when it does. `null` on a
+   * working day. `type` already distinguishes a week-off from a holiday, so
+   * `matchedBy` describes only the axis, not the kind.
+   */
+  matchedBy: 'national' | 'department' | 'shift' | null;
+}
```

- [ ] **Check:** `npm run typecheck`.

Checkpoint: leave the changes in the working tree for review.

---

## Task 2 — Migration 0048: the holiday tables (§7)

The design's SQL, filled in:

- Composite tenant keys, the `(organization_id, id)` composite unique that
  `holiday_scope`'s foreign key needs (D34).
- Typed scope columns (§7 "the same rule holds everywhere"): a scope row has
  exactly one of `department_id` or `shift_id`. A row with neither is a
  national holiday (no `holiday_scope` at all).
- CHECKs for "week-off ⇔ recurrence", "week-off has effective_from",
  "dated holidays have `holiday_date`".
- `UNIQUE NULLS NOT DISTINCT` on `holiday_scope`, or two identical rows would
  slip through (§7).
- No `DELETE` on `holiday` (withdrawal is `PATCH` with `status = 'withdrawn'`,
  HO-3). `holiday_scope` permits `DELETE` — scope replacement removes the old
  rows and inserts new ones in the same transaction.

- [ ] **Create** `migrations/0048_holidays.sql`:

```sql
-- =====================================================================
-- 0048 - Holidays and week-offs (attendance design, step 2, §7)
--
-- Two tables. `holiday` covers dated holidays (national, regional,
-- optional, shift-scoped) AND week-off rules; the sub-kind is `type`.
-- `holiday_scope` targets a department or a shift by TYPED foreign key,
-- never a (kind, id) pair (§7).
-- =====================================================================

CREATE TABLE holiday (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  name            text NOT NULL CHECK (length(trim(name)) > 0),
  type            text NOT NULL CHECK (type IN ('national', 'regional', 'optional', 'week-off')),  -- HO-1
  holiday_date    date,                    -- dated holidays: NULL for week-off rules
  recurrence      jsonb,                   -- week-off only: {"weekdays":[6,7]} or {"weekdays":[6],"weeksOfMonth":[2,4]}
  effective_from  date,                    -- week-off rules only
  effective_to    date,                    -- exclusive; NULL = open-ended
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn')),
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),            -- the target of holiday_scope's composite key
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id),
  -- Design §7: shape of the two kinds.
  CHECK ((type = 'week-off') = (recurrence IS NOT NULL)),
  CHECK ((type = 'week-off') = (effective_from IS NOT NULL)),
  CHECK (type = 'week-off' OR holiday_date IS NOT NULL),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

-- Scope as rows with TYPED columns. A national holiday has no rows here.
-- A regional holiday has one row per department; a shift-scoped holiday has
-- one row per shift. Exactly one of the two ids is set per row.
CREATE TABLE holiday_scope (
  organization_id uuid NOT NULL REFERENCES organization(id),
  holiday_id      uuid NOT NULL,
  department_id   uuid,                        -- HO-1 regional
  shift_id        uuid,                        -- HO-2
  CHECK (num_nonnulls(department_id, shift_id) = 1),
  FOREIGN KEY (organization_id, holiday_id)    REFERENCES holiday    (organization_id, id),
  FOREIGN KEY (organization_id, department_id) REFERENCES department (organization_id, id),
  FOREIGN KEY (organization_id, shift_id)      REFERENCES shift      (organization_id, id),
  -- NULLS NOT DISTINCT, or a plain UNIQUE would let the same scope row in twice:
  -- PostgreSQL treats NULLs as different values in an ordinary unique constraint.
  UNIQUE NULLS NOT DISTINCT (organization_id, holiday_id, department_id, shift_id)
);

CREATE INDEX ix_holiday_date ON holiday (organization_id, holiday_date) WHERE holiday_date IS NOT NULL;
CREATE INDEX ix_holiday_weekoff ON holiday (organization_id, effective_from) WHERE type = 'week-off';
CREATE INDEX ix_holiday_scope_holiday ON holiday_scope (organization_id, holiday_id);
CREATE INDEX ix_holiday_scope_department ON holiday_scope (organization_id, department_id) WHERE department_id IS NOT NULL;
CREATE INDEX ix_holiday_scope_shift ON holiday_scope (organization_id, shift_id) WHERE shift_id IS NOT NULL;

SELECT apply_tenant_rls('holiday');
SELECT apply_tenant_rls('holiday_scope');

GRANT SELECT, INSERT, UPDATE ON holiday TO tapcrm_app;             -- withdrawal is UPDATE (HO-3)
GRANT SELECT, INSERT, DELETE ON holiday_scope TO tapcrm_app;       -- replacing scope removes the old rows
```

- [ ] **Apply it:**

```bash
npm run migrate
psql "$MIGRATION_DATABASE_URL" -c "ALTER ROLE tapcrm_app LOGIN PASSWORD 'app_test_password';"
npm run ci
```

Expected: `0048_holidays.sql ... ok`, and `npm run ci` reports
`✓ CI-33 RLS on all 43 tenant-owned tables` (41 + 2 new).

Checkpoint: leave the changes in the working tree for review.

---

## Task 3 — The resolver (HO-1, HO-2, §7)

A pure function over everything the calendar reads for one person. The chain,
highest first: dated holiday whose scope matches → week-off rule in force whose
recurrence hits the weekday → working day. "The rule on a date" is the
active `week-off` row with the latest `effective_from` on or before it whose
`effective_to` (exclusive) is later.

- [ ] **Create the test helpers** —
  `packages/server/src/modules/holidays/fixtures.test-helpers.ts`:

```ts
import type { DateOnly } from '@tapcrm/contracts';
import type { CalendarInputs, HolidayInput, ScopeInput } from './resolve.js';

export const d = (value: string) => value as DateOnly;

export const dated = (
  id: string,
  date: string,
  extra: Partial<HolidayInput> = {},
): HolidayInput => ({
  id,
  name: extra.name ?? id,
  type: 'national',
  holidayDate: d(date),
  recurrence: null,
  effectiveFrom: null,
  effectiveTo: null,
  status: 'active',
  createdAt: extra.createdAt ?? '2026-01-01T00:00:00Z',
  ...extra,
});

export const weekOff = (
  id: string,
  weekdays: number[],
  from = '2026-01-01',
  extra: Partial<HolidayInput> = {},
): HolidayInput => ({
  id,
  name: extra.name ?? id,
  type: 'week-off',
  holidayDate: null,
  recurrence: { weekdays },
  effectiveFrom: d(from),
  effectiveTo: null,
  status: 'active',
  createdAt: extra.createdAt ?? '2026-01-01T00:00:00Z',
  ...extra,
});

export const departmentScope = (holidayId: string, departmentId: string): ScopeInput => ({
  holidayId,
  departmentId,
  shiftId: null,
});

export const shiftScope = (holidayId: string, shiftId: string): ScopeInput => ({
  holidayId,
  departmentId: null,
  shiftId,
});

export function inputs(
  overrides: Partial<CalendarInputs> & {
    holidays?: HolidayInput[];
    scopes?: ScopeInput[];
  } = {},
): CalendarInputs {
  const { holidays = [], scopes = [], ...rest } = overrides;
  return {
    timezone: 'Asia/Kolkata',
    departmentId: null,
    holidays,
    scopes,
    shiftIdsByDate: new Map(),
    ...rest,
  };
}
```

- [ ] **Write the test** — `packages/server/src/modules/holidays/resolve.test.ts`.
  Its cases are the design's own: national wins over week-off; regional matches
  only its department; shift-scoped matches only when the day's resolved shift
  is in scope; the week-off rule with the later effective_from wins between two
  rules covering the same date; a withdrawn row is invisible.

```ts
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
      holidays: [weekOff('sat', [6], '2026-01-01', { name: 'Sat 2/4' } as any)],
    });
    // Recurrence override — the fixture default has no weeksOfMonth; supply it here.
    (cal.holidays[0].recurrence as any).weeksOfMonth = [2, 4];
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
```

- [ ] **Run it and watch it fail:**
  `npx vitest run packages/server/src/modules/holidays/resolve.test.ts` —
  expected: `Error: Failed to load url ./resolve.js … Does the file exist?`

- [ ] **Create** `packages/server/src/modules/holidays/resolve.ts`:

```ts
import type {
  DateOnly,
  HolidaySubtype,
  ResolvedDay,
} from '@tapcrm/contracts';
import { weekdayOf } from '../../platform/time.js';

/**
 * HO-1, HO-2 — one person on one date, as a calendar sees them.
 *
 *   1 an active dated holiday on that date whose scope matches
 *   2 an active week-off rule in force whose recurrence hits the weekday
 *   3 a working day
 *
 * "In force on `date`" means the rule with the latest `effectiveFrom` on or
 * before it whose `effectiveTo` (exclusive) is later. Nobody outside this
 * module decides a person's day type.
 */

export interface HolidayInput {
  readonly id: string;
  readonly name: string;
  readonly type: HolidaySubtype;
  readonly holidayDate: DateOnly | null;
  readonly recurrence: WeekOffRecurrence | null;
  readonly effectiveFrom: DateOnly | null;
  readonly effectiveTo: DateOnly | null; // exclusive
  readonly status: 'active' | 'withdrawn';
  /** For deterministic tie-breaks between two rows that both match. */
  readonly createdAt: string; // ISO instant
}

export interface WeekOffRecurrence {
  /** ISO weekdays: 1 Monday … 7 Sunday. */
  readonly weekdays: readonly number[];
  /** 1..5 (5 = the last week that has this weekday); null means every week. */
  readonly weeksOfMonth?: readonly number[];
}

export interface ScopeInput {
  readonly holidayId: string;
  readonly departmentId: string | null;
  readonly shiftId: string | null;
}

/** Everything the resolver reads for one person. */
export interface CalendarInputs {
  readonly timezone: string;
  readonly departmentId: string | null;
  readonly holidays: readonly HolidayInput[];
  readonly scopes: readonly ScopeInput[];
  /**
   * The person's resolved shift id per date, preloaded by the repository via
   * one `ShiftsFacade.resolveRange` call — never per date. `resolveDay` stays
   * pure and synchronous; the async work has already happened by the time it
   * runs. A missing key, or one whose value is null, means "no fixed shift on
   * that date," which is fine for the resolver (nothing in `holiday_scope`
   * will match against `null`).
   */
  readonly shiftIdsByDate: ReadonlyMap<DateOnly, string | null>;
}

const covers = (row: HolidayInput, date: DateOnly): boolean =>
  row.effectiveFrom !== null &&
  row.effectiveFrom <= date &&
  (row.effectiveTo === null || date < row.effectiveTo);

/** 1..5, where 5 means "the last week that has this weekday" (design §7). */
function weekOfMonthOf(date: DateOnly): number {
  const day = Number(date.slice(8, 10));
  return Math.ceil(day / 7);
}

function isLastWeekWithWeekday(date: DateOnly, weekday: number): boolean {
  // The last week is any date within seven days of the month's end.
  const [year, month, day] = date.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  return day! + 7 > daysInMonth && weekdayOf(date) === weekday;
}

function recurrenceHits(recurrence: WeekOffRecurrence, date: DateOnly): boolean {
  const weekday = weekdayOf(date);
  if (!recurrence.weekdays.includes(weekday)) return false;
  if (recurrence.weeksOfMonth === undefined || recurrence.weeksOfMonth.length === 0)
    return true;
  const week = weekOfMonthOf(date);
  return recurrence.weeksOfMonth.some(
    (n) => n === week || (n === 5 && isLastWeekWithWeekday(date, weekday)),
  );
}

/** Which scope, if any, links this holiday to this person on this date. */
type MatchKind = 'shift' | 'department' | 'national' | null;

function matchScope(
  scopes: readonly ScopeInput[],
  holidayId: string,
  departmentId: string | null,
  shiftIdToday: string | null,
): MatchKind {
  const rows = scopes.filter((s) => s.holidayId === holidayId);
  if (rows.length === 0) return 'national';
  // Shift beats department (design decision: the more specific target wins).
  let best: MatchKind = null;
  for (const s of rows) {
    if (s.shiftId !== null && s.shiftId === shiftIdToday) return 'shift';
    if (s.departmentId !== null && s.departmentId === departmentId) best = 'department';
  }
  return best;
}

const PRIORITY: Record<Exclude<MatchKind, null>, number> = {
  shift: 3,
  department: 2,
  national: 1,
};

/** Stable order among matches at the same priority: earliest createdAt, then id. */
function tieBreak(a: HolidayInput, b: HolidayInput): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

const working = (date: DateOnly): ResolvedDay => ({
  date,
  type: 'working',
  holidayId: null,
  holidayName: null,
  subtype: null,
  matchedBy: null,
});

export function resolveDay(inputs: CalendarInputs, date: DateOnly): ResolvedDay {
  const shiftIdToday = inputs.shiftIdsByDate.get(date) ?? null;

  // 1. Dated holidays on the date whose scope matches. Optional holidays are
  //    invisible to the calendar until the person claims them (step 6). Among
  //    matches: shift > department > national, then createdAt, then id.
  let bestDated: { holiday: HolidayInput; kind: Exclude<MatchKind, null> } | null = null;
  for (const h of inputs.holidays) {
    if (
      h.status !== 'active' ||
      h.type === 'week-off' ||
      h.type === 'optional' ||
      h.holidayDate !== date
    )
      continue;
    const kind = matchScope(inputs.scopes, h.id, inputs.departmentId, shiftIdToday);
    if (kind === null) continue;
    if (
      bestDated === null ||
      PRIORITY[kind] > PRIORITY[bestDated.kind] ||
      (PRIORITY[kind] === PRIORITY[bestDated.kind] && tieBreak(h, bestDated.holiday) < 0)
    ) {
      bestDated = { holiday: h, kind };
    }
  }
  if (bestDated !== null) {
    return {
      date,
      type: 'holiday',
      holidayId: bestDated.holiday.id,
      holidayName: bestDated.holiday.name,
      subtype: bestDated.holiday.type,
      matchedBy: bestDated.kind,
    };
  }

  // 2. Week-off rules. Scope is checked the same way as dated holidays (a
  //    per-department or per-shift week-off is legitimate). Among applicable
  //    rules, the latest effectiveFrom wins (ties by createdAt, then id).
  //    The scope kind that matched is carried through to `matchedBy`, so a
  //    caller can tell a floor-Saturday from a global Sunday.
  let bestRule:
    | { holiday: HolidayInput; kind: Exclude<MatchKind, null> }
    | null = null;
  for (const h of inputs.holidays) {
    if (h.status !== 'active' || h.type !== 'week-off' || !covers(h, date)) continue;
    const kind = matchScope(inputs.scopes, h.id, inputs.departmentId, shiftIdToday);
    if (kind === null) continue;
    if (
      bestRule === null ||
      (h.effectiveFrom ?? '') > (bestRule.holiday.effectiveFrom ?? '') ||
      ((h.effectiveFrom ?? '') === (bestRule.holiday.effectiveFrom ?? '') &&
        tieBreak(h, bestRule.holiday) < 0)
    ) {
      bestRule = { holiday: h, kind };
    }
  }
  if (bestRule !== null && recurrenceHits(bestRule.holiday.recurrence!, date)) {
    return {
      date,
      type: 'week-off',
      holidayId: bestRule.holiday.id,
      holidayName: bestRule.holiday.name,
      subtype: 'week-off',
      matchedBy: bestRule.kind,
    };
  }

  // 3. A working day.
  return working(date);
}
```

- [ ] **Run the test again.** Expected: `Tests  ~10 passed`.

Checkpoint: leave the changes in the working tree for review.

---

## Task 4 — The save rules

- [ ] **Write the test** — `packages/server/src/modules/holidays/rules.test.ts`.
  Cases: dated holiday needs `holidayDate`, no `recurrence`, no `effectiveFrom`;
  week-off needs `recurrence` and `effectiveFrom`, no `holidayDate`;
  recurrence weekdays are 1..7; `weeksOfMonth` is 1..5; a scope row is one
  department or one shift, never both, never neither.

```ts
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
```

- [ ] **Run it and watch it fail** — expected: `Error: Failed to load url ./rules.js`.

- [ ] **Create** `packages/server/src/modules/holidays/errors.ts`:

```ts
import { ApplicationError } from '../../errors.js';

export const HOLIDAY_ERROR_CODES = {
  DATE_REQUIRED: 'HOLIDAY_DATE_REQUIRED',
  DATE_NOT_ALLOWED: 'HOLIDAY_DATE_NOT_ALLOWED',
  RECURRENCE_REQUIRED: 'HOLIDAY_RECURRENCE_REQUIRED',
  RECURRENCE_NOT_ALLOWED: 'HOLIDAY_RECURRENCE_NOT_ALLOWED',
  RECURRENCE_INVALID: 'HOLIDAY_RECURRENCE_INVALID',
  EFFECTIVE_FROM_REQUIRED: 'HOLIDAY_EFFECTIVE_FROM_REQUIRED',
  RANGE_INVALID: 'HOLIDAY_RANGE_INVALID',
  SCOPE_INVALID: 'HOLIDAY_SCOPE_INVALID',
  SCOPE_INVALID_FOR_TYPE: 'HOLIDAY_SCOPE_INVALID_FOR_TYPE',
  SCOPE_REQUIRED: 'HOLIDAY_SCOPE_REQUIRED',
  SCOPE_MIXED_TARGETS: 'HOLIDAY_SCOPE_MIXED_TARGETS',
  SCOPE_TARGET_NOT_FOUND: 'HOLIDAY_SCOPE_TARGET_NOT_FOUND',
  NOT_FOUND: 'HOLIDAY_NOT_FOUND',
  WITHDRAWN: 'HOLIDAY_WITHDRAWN',
  PAST_CHANGE_NEEDS_CORRECTION_AUTHORITY:
    'HOLIDAY_PAST_CHANGE_NEEDS_CORRECTION_AUTHORITY',
} as const;

export class HolidayValidationError extends ApplicationError {
  constructor(code: string, message: string, details?: unknown) {
    super(message, 422, code, details);
    this.name = 'HolidayValidationError';
  }
}
export class HolidayForbiddenError extends ApplicationError {
  constructor(code: string, message: string) {
    super(message, 403, code);
    this.name = 'HolidayForbiddenError';
  }
}
export class HolidayNotFoundError extends ApplicationError {
  constructor(message: string) {
    super(message, 404, HOLIDAY_ERROR_CODES.NOT_FOUND);
    this.name = 'HolidayNotFoundError';
  }
}
export class HolidayConflictError extends ApplicationError {
  constructor(code: string, message: string, details?: unknown) {
    super(message, 409, code, details);
    this.name = 'HolidayConflictError';
  }
}
```

- [ ] **Create** `packages/server/src/modules/holidays/rules.ts`:

```ts
import type { DateOnly, HolidaySubtype } from '@tapcrm/contracts';
import { HOLIDAY_ERROR_CODES, HolidayValidationError } from './errors.js';
import type { WeekOffRecurrence } from './resolve.js';

export interface HolidayFields {
  readonly type: HolidaySubtype;
  readonly holidayDate: DateOnly | null;
  readonly recurrence: WeekOffRecurrence | null;
  readonly effectiveFrom: DateOnly | null;
  readonly effectiveTo: DateOnly | null;
}

function validateRecurrence(recurrence: WeekOffRecurrence): void {
  const okDays =
    recurrence.weekdays.length > 0 &&
    recurrence.weekdays.every((n) => Number.isInteger(n) && n >= 1 && n <= 7);
  const okWeeks =
    recurrence.weeksOfMonth === undefined ||
    (recurrence.weeksOfMonth.length > 0 &&
      recurrence.weeksOfMonth.every((n) => Number.isInteger(n) && n >= 1 && n <= 5));
  if (!okDays || !okWeeks) {
    throw new HolidayValidationError(
      HOLIDAY_ERROR_CODES.RECURRENCE_INVALID,
      'Weekdays must be 1..7 (Mon..Sun); weeksOfMonth, if given, must be 1..5.',
    );
  }
}

export function validateHoliday(fields: HolidayFields): void {
  if (fields.type === 'week-off') {
    if (fields.holidayDate !== null) {
      throw new HolidayValidationError(
        HOLIDAY_ERROR_CODES.DATE_NOT_ALLOWED,
        'A week-off rule has no single holidayDate.',
      );
    }
    if (fields.recurrence === null) {
      throw new HolidayValidationError(
        HOLIDAY_ERROR_CODES.RECURRENCE_REQUIRED,
        'A week-off rule needs a recurrence (weekdays, optional weeksOfMonth).',
      );
    }
    if (fields.effectiveFrom === null) {
      throw new HolidayValidationError(
        HOLIDAY_ERROR_CODES.EFFECTIVE_FROM_REQUIRED,
        'A week-off rule needs effectiveFrom.',
      );
    }
    validateRecurrence(fields.recurrence);
  } else {
    if (fields.holidayDate === null) {
      throw new HolidayValidationError(
        HOLIDAY_ERROR_CODES.DATE_REQUIRED,
        'A dated holiday needs holidayDate.',
      );
    }
    if (fields.recurrence !== null) {
      throw new HolidayValidationError(
        HOLIDAY_ERROR_CODES.RECURRENCE_NOT_ALLOWED,
        'A dated holiday cannot carry a recurrence (that is a week-off).',
      );
    }
  }
  if (
    fields.effectiveTo !== null &&
    fields.effectiveFrom !== null &&
    fields.effectiveTo <= fields.effectiveFrom
  ) {
    throw new HolidayValidationError(
      HOLIDAY_ERROR_CODES.RANGE_INVALID,
      'effectiveTo must be after effectiveFrom.',
    );
  }
}

export interface ScopeFields {
  readonly departmentId: string | null;
  readonly shiftId: string | null;
}

export function validateScope(fields: ScopeFields): void {
  const set = Number(fields.departmentId !== null) + Number(fields.shiftId !== null);
  if (set !== 1) {
    throw new HolidayValidationError(
      HOLIDAY_ERROR_CODES.SCOPE_INVALID,
      'A scope row targets exactly one of department or shift.',
    );
  }
}

/**
 * The service layer's invariant: `holiday.type` decides which scope shapes are
 * legal. See the decisions table at the top of this plan.
 *
 *   national → no rows
 *   regional → 1..N rows, all department OR all shift
 *   optional → 0 rows, or 1..N rows all department (no shift)
 *   week-off → 0 rows, or 1..N rows all department, or 1..N rows all shift
 */
export function validateScopeSet(
  type: HolidaySubtype,
  rows: readonly ScopeFields[],
): void {
  for (const row of rows) validateScope(row);
  const hasDept = rows.some((r) => r.departmentId !== null);
  const hasShift = rows.some((r) => r.shiftId !== null);

  if (type === 'national') {
    if (rows.length > 0) {
      throw new HolidayValidationError(
        HOLIDAY_ERROR_CODES.SCOPE_INVALID_FOR_TYPE,
        'A national holiday cannot carry scope rows.',
      );
    }
    return;
  }
  if (type === 'regional') {
    if (rows.length === 0) {
      throw new HolidayValidationError(
        HOLIDAY_ERROR_CODES.SCOPE_REQUIRED,
        'A regional holiday needs at least one department or shift scope.',
      );
    }
  }
  if (type === 'optional' && hasShift) {
    throw new HolidayValidationError(
      HOLIDAY_ERROR_CODES.SCOPE_INVALID_FOR_TYPE,
      'An optional holiday cannot be scoped to a shift; use department scope or leave it national.',
    );
  }
  if (hasDept && hasShift) {
    throw new HolidayValidationError(
      HOLIDAY_ERROR_CODES.SCOPE_MIXED_TARGETS,
      'A holiday cannot mix department and shift scopes; choose one axis.',
    );
  }
}
```

- [ ] **Run the test again.** Expected: `Tests  ~7 passed`.

Checkpoint: leave the changes in the working tree for review.

---

## Task 5 — Use cases: create, revise, withdraw (HO-3, HO-4)

What the services do:

- **Create.** `POST /api/holidays` inserts one `holiday` row plus its
  `holiday_scope` rows (if any). A national holiday has no scope; a regional
  or shift-scoped one has one row per target. Optional holidays are dated with
  scope none (national) or by department.
- **Revise / withdraw.** `PATCH /api/holidays/:id` sets the status to
  `withdrawn` or replaces the scope. The dated holiday itself is never edited
  after creation — a change of date is a new row (D5-style; simpler than a
  version table because a holiday is a single day).
- **HO-3.** Every create or withdraw writes `holidays.days-changed` in the
  same transaction. The payload names the departments and shifts touched, and
  the affected date (or the effective range for a week-off rule). Attendance's
  step-3 handler expands that into person-day pairs.
- **HO-4.** `GET /api/holidays` is bound to `holidays:view`, and every
  employee holds that action (the matrix's `all-ppl*`), so no scope filter is
  applied on read.
- **Past-dated authority.** Same as SH-6: a holiday date (or week-off
  effective_from) before the organization's today needs
  `attendance:correct` as well.

- [ ] **Write the test** —
  `packages/server/src/modules/holidays/holidays.integration.test.ts`.
  Cases:
  1. create + list + read (HO-4);
  2. create shift-scoped and see it apply only to the night crew;
  3. create optional and see it does **not** turn any day into a holiday (only
     the CRUD surface changes);
  4. **withdraw a national holiday and see the event omit both `departmentIds`
     and `shiftIds`** (organization-wide blast radius, HO-3), and confirm
     the holiday no longer resolves;
  5. withdraw a shift-scoped holiday and see the event carry only
     `shiftIds = ['Night']`;
  6. past-dated needs `attendance:correct`;
  7. the outbox gets one `holidays.days-changed` row per change, with `from`
     inclusive and `toExclusive` matching the source range (dated holiday →
     `toExclusive = addDays(from, 1)`; week-off with `effective_to = null` →
     `toExclusive = null`);
  8. **scope-change blast radius: dept A → dept B** — patch a regional
     holiday's scope from `[A]` to `[B]`; assert the single new event
     carries `departmentIds = ['A', 'B']` (order-insensitive, deduplicated);
  9. **axis switch: dept A → shift Night** — patch a regional holiday from
     department scope to shift scope (both configurations are legal for a
     regional); assert the event carries `departmentIds = ['A']` **and**
     `shiftIds = ['Night']` on the one event, without violating the
     no-mixed-scopes invariant on the holiday itself (the invariant applies
     to `holiday_scope` rows at rest, not to the transient event).

  Note: `PATCH /api/holidays/:id` never changes `holiday.type`, so a
  national ↔ regional conversion is out of scope for this step. The
  "national on either side → organization-wide event" corollary is exercised
  through cases 1 (create national → new-scope empty) and 4 (withdraw
  national → old-scope empty). If HR ever needs type conversion, that is a
  separate product capability, not a scope patch dressed up.

  (The full test body follows step 1's `shifts.integration.test.ts` shape:
  seed an org, positions and people; grant `holidays:view`, `holidays:manage`
  and (for one position) `attendance:correct`; call the service functions.)

- [ ] **Run it and watch it fail** (integration variables set) — expected:
  `Error: Failed to load url ./policy.js`.

- [ ] **Create** `packages/server/src/modules/holidays/events.ts`:

```ts
import type { DateOnly } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

/**
 * `holidays.days-changed` — the mirror of `shifts.days-changed` (design §4).
 *
 * Attendance depends on holidays, so holidays cannot call attendance directly.
 * Every create, withdraw or scope change writes this event; step 3's handler
 * refreshes day facts and queues recalculation. Until that handler exists,
 * the rows wait.
 *
 * Range convention: `from` is inclusive, `toExclusive` is exclusive, matching
 * the underlying `holiday.effective_from`/`effective_to`. This deliberately
 * differs from step 1's `shifts.days-changed`, which converts to an inclusive
 * `to` before writing. A future unification would rename step 1's field to
 * match this one; for now attendance's step-3 handler knows the difference.
 *
 * Blast-radius rules (both axes are computed the same way):
 *
 *   create        → new scope
 *   withdraw      → old scope
 *   scope change  → UNION(old scope, new scope)
 *
 * "Scope" here means the id sets, not the shape. Two corollaries:
 *
 *   1. Any transition involving national — e.g. `national → department`,
 *      `department → national`, or `national → shift` — has to recalculate
 *      the whole organization on at least one side. The event expresses that
 *      by omitting BOTH `departmentIds` and `shiftIds` (an empty/undefined
 *      set means "the whole organization," matching the create-side of a
 *      national holiday).
 *   2. A department → shift (or shift → department) axis change legitimately
 *      produces an event with BOTH `departmentIds` (the old side) and
 *      `shiftIds` (the new side). The holiday itself still can't carry mixed
 *      scopes; the event blast radius can.
 *
 * The handler unions its own person-day expansion across the two axes.
 */
export const HOLIDAY_EVENTS = { DAYS_CHANGED: 'holidays.days-changed' } as const;

export interface DaysChanged {
  /**
   * The departments whose people must be recalculated. Empty/undefined AND
   * `shiftIds` empty/undefined together mean "the whole organization" — used
   * when either side of a scope change was national.
   */
  readonly departmentIds?: readonly string[];
  readonly shiftIds?: readonly string[];
  /** First changed date, inclusive. */
  readonly from: DateOnly;
  /**
   * One past the last changed date. `null` for an open-ended week-off rule.
   * For a single dated holiday, `toExclusive = addDays(from, 1)`.
   */
  readonly toExclusive: DateOnly | null;
  readonly reason: string;
}

export async function recordDaysChanged(
  tx: Tx,
  organizationId: string,
  change: DaysChanged,
): Promise<void> {
  await tx.query(sql`
    INSERT INTO domain_outbox (organization_id, event_name, payload)
    VALUES (${organizationId}, ${HOLIDAY_EVENTS.DAYS_CHANGED}, ${JSON.stringify(change)}::jsonb)
  `);
}
```

- [ ] **Create** `packages/server/src/modules/holidays/repository.ts`.
  Same style as step 1's shifts repository — dates as text, times as `HH:mm`.
  Loads (`loadCalendarInputs(tx, userId, from, to)`):
  - The person's `departmentId` (one `app_user` read).
  - Every active `holiday` whose date/effective range overlaps `[from, to]`.
  - Every `holiday_scope` row for those holidays.
  - `shiftIdsByDate` — built from **one** `ShiftsFacade.resolveRange(tx,
    userId, from, to)` call. Every returned `ResolvedShift` becomes a
    `date → shiftId (or null)` entry. Never one call per date: a 62-day
    explorer range would turn into 62 shift queries, and a payroll batch
    would multiply that by every employee.
  - Optimization: skip the shift resolve entirely when no shift-scoped
    holiday overlaps the range (a `SELECT 1 FROM holiday_scope WHERE
    shift_id IS NOT NULL AND holiday_id = ANY(...) LIMIT 1` before the
    facade call). An `Map()` empty then, and the resolver ignores it.
  - `listHolidays(tx, from, to)` — for the GET route, joined with scope names.
  - `insertHoliday`, `insertScopes`, `deleteScopes`, `setHolidayStatus`,
    `findHoliday`, `holidayExists`.

  `CalendarFacade.dayTypeRange` (Task 6) hands its own `from`/`to` straight to
  `loadCalendarInputs`, so a 365-day leave calculation runs one holidays query,
  one scopes query, and one shifts range query — three round-trips, not 365.

- [ ] **Create** `packages/server/src/modules/holidays/validators.ts` — zod
  schemas for the three route bodies. The scope union takes either
  `{ departmentIds: string[] }` or `{ shiftIds: string[] }`, never both.

- [ ] **Create** `packages/server/src/modules/holidays/policy.ts`:

  - `holidayPolicy` — resource type `holiday`. Every employee sees them
    (`holidays:view` at `all-ppl*`, HO-4), so `check` returns true when the
    organization matches. `holidays:manage` uses the same rule (there is no
    per-person holiday). `filter` returns `TRUE`.
  - No participants; no initiator field.
  - `registerHolidayPolicies()` registers it.

- [ ] **Create** `packages/server/src/modules/holidays/service.ts`. Structure:
  - `assertMayChangeFrom` — copy of the shifts helper, `attendance:correct`
    covers past dates.
  - `createHoliday` — validate, insert, insert scope rows, write
    `holidays.days-changed` with the same range semantics as `holiday.effective_*`:
    - dated holiday: `from = holidayDate`, `toExclusive = addDays(holidayDate, 1)`.
    - week-off rule: `from = effectiveFrom`, `toExclusive = effectiveTo` (may be `null`).
    - blast radius: **new scope** (see events.ts). National on create → both
      `departmentIds` and `shiftIds` omitted.
  - `reviseHoliday` — status change to `withdrawn` (invisible from then on)
    or replace scope. Writes the same event with `reason: 'withdrawn'` or
    `'scope-changed'`, and the range the withdrawn/edited rule covered (so
    attendance re-derives every day the rule touched).
    - Withdraw: blast radius = **old scope**. National withdrawal → both id
      sets omitted.
    - Scope change: blast radius = **UNION(old, new)**. If either side is
      national, omit both id sets (organization-wide). Otherwise take the
      set union per axis — a department→shift switch keeps the old
      `departmentIds` and adds the new `shiftIds`.
    - The service reads the current `holiday_scope` rows under the same
      per-holiday advisory lock the `scope-changed` write uses, so no other
      revision can race the union computation.
  - `listHolidays` — for `GET /api/holidays`, defaults to the current year
    unless `from`/`to` are given.

- [ ] **Run the integration test.** Expected: `Tests  ~7 passed`.

Checkpoint: leave the changes in the working tree for review.

---

## Task 6 — The façade

The façade is what attendance, live-status, break-management and payroll
will call, each passing its own transaction. `dayType` returns the resolved
day for one person on one date; `dayTypeRange` returns a batch;
`leaveDays` (LV-3) returns the count of days that consume a leave balance
in a `from..to` range — a working day counts one, everything else zero (the
LV-3 default; leave types can extend this later).

- [ ] **Create** `packages/server/src/modules/holidays/facade.ts`:

```ts
import type { DateOnly, ResolvedDay } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { addDays } from '../../platform/time.js';
import { loadCalendarInputs } from './repository.js';
import { resolveDay } from './resolve.js';

export { HOLIDAY_EVENTS, type DaysChanged } from './events.js';

/** HO-1, HO-2 — the day's calendar answer for the person on the date. */
export async function dayType(
  tx: Tx,
  userId: string,
  date: DateOnly,
): Promise<ResolvedDay> {
  return resolveDay(await loadCalendarInputs(tx, userId, date, date), date);
}

/** `from..to` inclusive; one read. */
export async function dayTypeRange(
  tx: Tx,
  userId: string,
  from: DateOnly,
  to: DateOnly,
): Promise<ResolvedDay[]> {
  const inputs = await loadCalendarInputs(tx, userId, from, to);
  const out: ResolvedDay[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) out.push(resolveDay(inputs, date));
  return out;
}

/** LV-3 — days in `from..to` that consume a leave balance for this person. */
export async function leaveDays(
  tx: Tx,
  userId: string,
  from: DateOnly,
  to: DateOnly,
): Promise<number> {
  const days = await dayTypeRange(tx, userId, from, to);
  return days.filter((d) => d.type === 'working').length;
}
```

Checkpoint: leave the changes in the working tree for review.

---

## Task 7 — Routes and registration

- [ ] **Create** `packages/server/src/modules/holidays/routes.ts`. The three
  bindings the registry already declares:

```ts
route({ method: 'GET',   path: '/api/holidays',       action: 'holidays:view',   module: 'holidays', handler: async ({ ctx, query }) => listHolidays(ctx, listQuerySchema.parse(query)) });
route({ method: 'POST',  path: '/api/holidays',       action: 'holidays:manage', module: 'holidays', handler: async ({ ctx, body }) => createHoliday(ctx, createSchema.parse(body)) });
route({ method: 'PATCH', path: '/api/holidays/:id',   action: 'holidays:manage', module: 'holidays', resourceParam: 'id', loadResource: loadHoliday, handler: async ({ ctx, params, body }) => reviseHoliday(ctx, params['id']!, reviseSchema.parse(body)) });
```

- [ ] **Register them** in `packages/server/src/modules/index.ts`:

```diff
 import { registerShiftPolicies } from './shifts/policy.js';
 import { registerShiftRoutes } from './shifts/routes.js';
+import { registerHolidayPolicies } from './holidays/policy.js';
+import { registerHolidayRoutes } from './holidays/routes.js';
@@
   registerShiftPolicies();
+  registerHolidayPolicies();
 }
@@
   registerShiftRoutes();
+  registerHolidayRoutes();
 }
```

- [ ] **Check:**

```bash
npm run build
npm run typecheck && npm run lint && npm run ci
```

Expected: `npm run ci` shows CI-2 moves from `55 of 305` to `58 of 305`
(three new bindings) and CI-10 from `11 of 63` to `12 of 63` (the `holiday`
resource gets its policy). Starting the API (`npm run dev:api`) logs no
manifest errors.

Checkpoint: leave the changes in the working tree for review.

---

## Task 8 — CI: `holidays` owns its tables

Extend step 1's `TABLE_OWNERS`:

```diff
--- a/tools/ci/tables.ts
+++ b/tools/ci/tables.ts
 export const TABLE_OWNERS: readonly {
   readonly module: string;
   readonly tables: RegExp;
-}[] = [{ module: 'shifts', tables: /^(shift|shift_[a-z_]+|department_shift_default)$/ }];
+}[] = [
+  { module: 'shifts',   tables: /^(shift|shift_[a-z_]+|department_shift_default)$/ },
+  { module: 'holidays', tables: /^(holiday|holiday_[a-z_]+)$/ },
+];
```

- [ ] **Extend the test** in `tools/ci/tables.test.ts`: add cases proving
  another module reading `holiday_scope` is flagged, and `holidays/…` using
  `shift` is flagged too (holidays reads shift IDs from the shifts façade, not
  the table directly).

- [ ] **Run** `npx vitest run tools/ci/tables.test.ts` (expected all passing)
  and `npm run ci` (expected `✓ SH-1 shift tables read only by the shifts
  module` renamed to `✓ MB-4 module tables read only by their owning module`,
  covering shifts and holidays).

Checkpoint: leave the changes in the working tree for review.

---

## Task 9 — Final check

```bash
npm run typecheck
npm run lint
npm run ci
npx vitest run --exclude '**/overrides.integration.test.ts'
```

Expected: typecheck and lint clean, `✓ 16 check(s) passed` (the SH-1 check
is now MB-4 and covers holidays too), and every test passes — the new
holiday tests add ~13 resolver tests (three added in the first review:
optional ignored, shift-beats-department, deterministic tie-break, plus the
scoped week-off case with `matchedBy=department`), ~11 rule tests (the four
scope-invariant cases), ~10 database tests (the base six plus the three
blast-radius cases from round 2: A→B union, national→dept
organization-wide, dept→shift axis switch), and 2 CI-rule tests.

Then review the working tree (`git status`, `git diff`). Nothing has been
committed.

---

## What step 3 picks up from here

- A handler for `holidays.days-changed`. It looks up who was in the named
  departments (and who resolved to the named shifts) on each affected date,
  runs `refreshDayFacts`, then queues recalculation. The `holiday-worked`
  flag is set in the calculator, from `CalendarFacade.dayType` returning
  `type: 'holiday'` on a day with punches.
- Recalculation-inside-the-transaction is still forbidden (MB-3); the event
  is the seam.
- The step-3 spec already lists `CalendarFacade` among the calculator's
  inputs, so nothing else in step 3 is holidays-shaped work.
