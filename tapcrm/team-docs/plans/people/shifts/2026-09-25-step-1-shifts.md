# Step 1 — Shifts (server): implementation plan

**Goal.** One answer to "which shift applied to this person on this date, and
why" (SH-1), and where each day's window lies. The answer comes from dated
templates, assignments, rotations, overrides, requests and department
defaults. Every other People module asks this, through `ShiftsFacade`.

**Design.** `team-docs/specs/people/2026-09-22-attendance-shifts-payroll-design.md`
§6 (Step 1) and the geometry half of §5.2.
**Roadmap.** `team-docs/plans/people/attendance/2026-09-25-attendance-roadmap.md`.
**Builds on.** Step 0 (time helpers, `btree_gist`, the outbox, the boundary rules).

**Done when** (design §6), each proved by a named test:

| Check | Test |
|---|---|
| The explorer shows the right shift and source for any person and date | `shifts.integration.test.ts` › "done when: the explorer shows the right shift and source for each date" |
| A template edit changes nothing before its effective date | `resolve.test.ts` › SH-2 cases; `shifts.integration.test.ts` › "SH-2" |
| A past-dated change without `attendance:correct` is refused | `shifts.integration.test.ts` › "SH-6" |
| A 20:00–05:00 shift is one day on its start date, and the right month at a month end | `windows.test.ts` › "§6.6 — a 20:00–05:00 night, end to end" |

"Correct lateness, no double counting" for that night is attendance's
arithmetic, so its test comes with the calculator in step 3. What step 1
provides is the one day and the one window that arithmetic uses.

**How to use this plan.** Do the tasks in order: test first, watch it fail,
then add the code, and watch it pass. Nothing is committed; each task ends with
its changes left for review. All code below has already been run against the
repository with Step 0 applied: typecheck, lint, `npm run ci` (16 checks) and
the unit and database tests all passed.

---

## Decisions made in this plan

| Question | Decision | Why |
|---|---|---|
| How does shifts ask attendance to recalculate? (roadmap, "import cycle") | Shifts writes a `shifts.days-changed` outbox event in the same transaction as the change. Attendance registers its handler in step 3. | Attendance depends on shifts, not the other way round (PRD §5.8). Recalculation is queued anyway, so nothing needs to happen in the same transaction (MB-3). Until step 3 exists, the events wait. The drainer only picks up events some process handles. |
| Raising and listing requests (G3) | Not built. The table, and the approve/reject route that the manifest does list, are built. | A route missing from the manifest stops the server from starting (RM-1). Tests insert requests directly |
| Shift settings (G14) | The `shift_setting` table exists but has no route. When no row exists, the day-start time is 00:00 and the closing extension is `null`. | Q3 has no default. Step 7's auto-close needs the extension; until G14 is answered, a seed can write the first row |
| The five Tapvera shifts (§6.5 seed) | Not seeded here | A version needs grace and day thresholds (Q1, Q4). Once HR answers, create the five shifts through `POST /api/shifts` — the same effort as writing a seed |
| Night-work consent and the rest warning (§6.6) | Not built here | Both depend on HR's answers to Q14 and a screen to record consent; they arrive with the screens (step 1b) |
| Screens (§6.5) | A separate, short step 1b plan | The server stands on its own. The explorer is already usable through `GET /api/shifts/assignments?userId=…&from=…&to=…` |
| Overlap check on a department default | Not checked when the default is saved; days that overlap are flagged when read | §5.2 names "a department default changed under an existing assignment" as a read-time case. Checking every member on every save would be heavy |

## Files

| File | What |
|---|---|
| `packages/contracts/src/people.ts` | `HalfDays`, `ShiftSource`, `ResolvedShift` (§5.3) |
| `packages/server/src/platform/time.ts` | `weekdayOf`, `daysBetween` |
| `migrations/0047_shifts.sql` | The nine tables of §6.1, with RLS, composite keys, exclusion constraints and grants |
| `modules/shifts/resolve.ts` (+ test, fixtures) | The pure SH-1 chain, and the anchor for days without fixed times |
| `modules/shifts/windows.ts` (+ test) | The pure day-window geometry of §5.2 |
| `modules/shifts/errors.ts`, `rules.ts` (+ test) | §6.3: start ≠ end, reachable thresholds, no overlap |
| `modules/shifts/events.ts` | The `shifts.days-changed` outbox event |
| `modules/shifts/repository.ts`, `service.ts`, `validators.ts`, `policy.ts` (+ integration test) | Use cases, SH-5, SH-6 and SH-7 |
| `modules/shifts/facade.ts` | `resolve`, `resolveRange`, `dayWindow`, `dayWindowContaining` |
| `modules/shifts/routes.ts`, `modules/index.ts` | The six manifest routes |
| `tools/ci/tables.ts` (+ test), `tools/ci/index.ts` | SH-1: only `shifts` touches the shift tables |

(`modules/…` is under `packages/server/src/`.)

---

## Task 1 — Shared shift types and two date helpers

- [ ] **Add the types** to `packages/contracts/src/people.ts`:

```diff
--- a/packages/contracts/src/people.ts
+++ b/packages/contracts/src/people.ts
@@ -2,8 +2,8 @@
  * People — shared types for shifts, holidays, attendance, live status,
  * biometric, leave, breaks and payroll (attendance design §5.3).
  *
- * Types only. Later build steps add the shift, event and presence types here;
- * step 0 needs the two that every date in those modules is written in.
+ * Types only. Step 0 added the date types; step 1 the shift types. Later steps
+ * add the event types here, and the presence state machine beside it.
  */
 
 /** A calendar day in the organization's timezone, 'YYYY-MM-DD' (T-1). */
@@ -11,3 +11,38 @@ export type DateOnly = string & { readonly __brand: 'DateOnly' };
 
 /** A wall-clock time of day, 'HH:mm' (T-3). */
 export type LocalTime = string & { readonly __brand: 'LocalTime' };
+
+/** A day's credit in half-day units; a day always sums to 2 (D7). */
+export type HalfDays = 0 | 1 | 2;
+
+/** The SH-1 resolution chain, highest precedence first (design §6.2). */
+export type ShiftSource =
+  | 'date-override'
+  | 'permanent-flexible'
+  | 'flexible-request'
+  | 'rotation'
+  | 'template'
+  | 'department-default'
+  | 'none';
+
+/** Which shift applied to a person on a date, and why (§5.3, §6.2). */
+export interface ResolvedShift {
+  date: DateOnly;
+  source: ShiftSource;
+  shiftId: string | null;
+  versionId: string | null;
+  kind: 'fixed' | 'flexible' | 'none';
+  start: LocalTime | null; // fixed only
+  end: LocalTime | null;
+  isOvernight: boolean; // end is on the next calendar day
+  graceMinutes: number; // AT-4
+  earlyExitGraceMinutes: number;
+  fullDayMinutes: number | null; // fixed: shift version; flexible: 480 (SH-4)
+  halfDayMinutes: number | null; // fixed: shift version; flexible: 300 (SH-4)
+  complementaryHalfMinutes: number | null; // §8.3; null: halfDayMinutes ÷ 2
+  minOvertimeMinutes: number | null; // AT-5
+  earlyWindowMinutes: number; // how early an arrival may come (§5.2)
+  /** The version's own, else shift_setting's (Q3); null until HR sets one. */
+  maxClosingExtensionMinutes: number | null;
+  timezone: string; // IANA, from the organization
+}
```

- [ ] **Add the helpers** to `packages/server/src/platform/time.ts` (Luxon stays in this one file, T-4):

```diff
--- a/packages/server/src/platform/time.ts
+++ b/packages/server/src/platform/time.ts
@@ -74,3 +74,15 @@ export function addDays(date: DateOnly, days: number): DateOnly {
   if (next === null) throw new RangeError(`cannot add ${days} days to ${date}`);
   return next as DateOnly;
 }
+
+/** ISO weekday of a calendar date: 1 Monday … 7 Sunday. */
+export function weekdayOf(date: DateOnly): number {
+  return DateTime.fromISO(date, { zone: 'UTC' }).weekday;
+}
+
+/** Whole days from `from` to `to`; negative when `to` is earlier. */
+export function daysBetween(from: DateOnly, to: DateOnly): number {
+  return Math.round(
+    DateTime.fromISO(to, { zone: 'UTC' }).diff(DateTime.fromISO(from, { zone: 'UTC' }), 'days').days,
+  );
+}
```

- [ ] **Check:** `npm run typecheck`.

Checkpoint: leave the changes in the working tree for review.

---

## Task 2 — Migration 0047: the shift tables (§6.1)

The design's SQL, filled in:

- Composite tenant keys everywhere, and `user_id` in the key where two rows
  belong to one person (D34).
- `EXCLUDE` constraints on `btree_gist` from migration 0046: one assignment per
  kind per person per date, and one department default per department per
  date.
- CHECKs for "both times or neither", "start ≠ end", a request decided only by
  someone other than its requester (SH-7), and "pending ⇔ undecided".
- Grants without `DELETE` on templates (SH-5). Versions and settings are
  append-only.

- [ ] **Create** `migrations/0047_shifts.sql`:

```sql
-- =====================================================================
-- 0047 - Shifts (attendance design, step 1, §6.1)
--
-- Every table is tenant-owned: composite tenant keys, apply_tenant_rls,
-- and the app role gets only the privileges its writes need. Where two
-- rows both belong to a person, the key carries user_id as well (D34).
-- =====================================================================

-- Templates. SH-5: deactivated, never deleted, so the app role has no DELETE.
CREATE TABLE shift (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  code            text NOT NULL CHECK (length(trim(code)) > 0),
  name            text NOT NULL CHECK (length(trim(name)) > 0),
  kind            text NOT NULL CHECK (kind IN ('fixed', 'flexible')),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id)
);

-- SH-2: editing a template writes a new version; nothing before its date changes.
CREATE TABLE shift_version (
  id                            uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id               uuid NOT NULL REFERENCES organization(id),
  shift_id                      uuid NOT NULL,
  effective_from                date NOT NULL,
  start_time                    time,              -- fixed only
  end_time                      time,              -- fixed only; end < start means overnight
  grace_minutes                 integer NOT NULL CHECK (grace_minutes BETWEEN 0 AND 240),
  early_exit_grace_minutes      integer NOT NULL DEFAULT 0 CHECK (early_exit_grace_minutes BETWEEN 0 AND 240),
  full_day_minutes              integer NOT NULL,  -- D6: HR enters it (Q1)
  half_day_minutes              integer NOT NULL,
  complementary_half_minutes    integer,           -- §8.3; NULL means half_day_minutes ÷ 2
  min_overtime_minutes          integer CHECK (min_overtime_minutes >= 0),  -- AT-5; NULL: not tracked
  early_window_minutes          integer NOT NULL DEFAULT 180 CHECK (early_window_minutes BETWEEN 0 AND 720),
  max_closing_extension_minutes integer CHECK (max_closing_extension_minutes BETWEEN 0 AND 720),  -- NULL: shift_setting's
  created_by                    uuid NOT NULL,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, shift_id, effective_from),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, shift_id) REFERENCES shift (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id),
  CHECK (half_day_minutes > 0 AND half_day_minutes < full_day_minutes),
  CHECK (complementary_half_minutes IS NULL OR complementary_half_minutes > 0),
  -- Both times or neither. Equal times are a typing slip, not a 24-hour shift (§6.6).
  CHECK ((start_time IS NULL) = (end_time IS NULL)),
  CHECK (start_time IS NULL OR start_time <> end_time)
);

CREATE TABLE shift_rotation (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  name            text NOT NULL CHECK (length(trim(name)) > 0),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id)
);

-- ISO weekday: 1 Monday … 7 Sunday. A NULL shift is a weekday with no shift.
CREATE TABLE shift_rotation_day (
  organization_id uuid NOT NULL REFERENCES organization(id),
  rotation_id     uuid NOT NULL,
  weekday         smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  shift_id        uuid,
  PRIMARY KEY (organization_id, rotation_id, weekday),
  FOREIGN KEY (organization_id, rotation_id) REFERENCES shift_rotation (organization_id, id),
  FOREIGN KEY (organization_id, shift_id) REFERENCES shift (organization_id, id)
);

-- Chain steps 2, 4 and 5. One assignment per kind per person per date.
CREATE TABLE shift_assignment (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  user_id         uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('template', 'rotation', 'permanent-flexible')),
  shift_id        uuid,
  rotation_id     uuid,
  effective_from  date NOT NULL,
  effective_to    date,                         -- exclusive; NULL = open-ended
  reason          text,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, shift_id) REFERENCES shift (organization_id, id),
  FOREIGN KEY (organization_id, rotation_id) REFERENCES shift_rotation (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id),
  CHECK ((kind = 'template') = (shift_id IS NOT NULL)),
  CHECK ((kind = 'rotation') = (rotation_id IS NOT NULL)),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  EXCLUDE USING gist (organization_id WITH =, user_id WITH =, kind WITH =,
                      daterange(effective_from, effective_to, '[)') WITH &&)
);

CREATE TABLE shift_request (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id    uuid NOT NULL REFERENCES organization(id),
  user_id            uuid NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('flexible', 'change')),
  from_date          date NOT NULL,
  to_date            date NOT NULL,
  requested_shift_id uuid,                      -- change only
  reason             text NOT NULL CHECK (length(trim(reason)) > 0),
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by       uuid NOT NULL,             -- the registry initiator field for shifts:approve
  decided_by         uuid,
  decided_at         timestamptz,
  decision_note      text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, user_id, id),        -- the override made from it points here (D34)
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, requested_by) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, decided_by) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, requested_shift_id) REFERENCES shift (organization_id, id),
  CHECK ((kind = 'change') = (requested_shift_id IS NOT NULL)),
  CHECK (to_date >= from_date AND to_date - from_date <= 31),
  CHECK ((status = 'pending') = (decided_by IS NULL)),
  CHECK (decided_by IS NULL OR decided_by <> requested_by)  -- A1 in the database (SH-7)
);

-- Chain step 1. Created by HR, or by an approved change request.
CREATE TABLE shift_override (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id   uuid NOT NULL REFERENCES organization(id),
  user_id           uuid NOT NULL,
  work_date         date NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('shift', 'flexible', 'no-shift')),
  shift_id          uuid,
  reason            text NOT NULL CHECK (length(trim(reason)) > 0),
  origin_request_id uuid,                       -- removed together with its request
  created_by        uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, work_date),
  FOREIGN KEY (organization_id, user_id) REFERENCES app_user (organization_id, id),
  FOREIGN KEY (organization_id, shift_id) REFERENCES shift (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id),
  -- An override made by approving a request belongs to the request's person (D34).
  FOREIGN KEY (organization_id, user_id, origin_request_id)
    REFERENCES shift_request (organization_id, user_id, id),
  CHECK ((kind = 'shift') = (shift_id IS NOT NULL))
);

-- Chain step 6.
CREATE TABLE department_shift_default (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id uuid NOT NULL REFERENCES organization(id),
  department_id   uuid NOT NULL,
  shift_id        uuid NOT NULL,
  effective_from  date NOT NULL,
  effective_to    date,                         -- exclusive; NULL = open-ended
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, department_id) REFERENCES department (organization_id, id),
  FOREIGN KEY (organization_id, shift_id) REFERENCES shift (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  EXCLUDE USING gist (organization_id WITH =, department_id WITH =,
                      daterange(effective_from, effective_to, '[)') WITH &&)
);

-- Organization-wide settings, dated like a shift version (D35): a day is always
-- judged by the row in force on its date. Q3 has no default, so there is no row
-- until HR answers it (G14: until a settings route exists, a seed writes it).
CREATE TABLE shift_setting (
  id                            uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id               uuid NOT NULL REFERENCES organization(id),
  effective_from                date NOT NULL,
  day_start_time                time NOT NULL DEFAULT '00:00',   -- the last boundary anchor (§5.2)
  max_closing_extension_minutes integer NOT NULL
                                  CHECK (max_closing_extension_minutes BETWEEN 0 AND 720),
  minimum_rest_minutes          integer CHECK (minimum_rest_minutes > 0),  -- NULL: no rest warning
  night_consent_mode            text NOT NULL DEFAULT 'refuse' CHECK (night_consent_mode IN ('refuse', 'warn')),
  night_consent_from            time,                              -- Q14: NULL = no consent check
  night_consent_to              time,
  created_by                    uuid NOT NULL,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, effective_from),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES app_user (organization_id, id),
  CHECK ((night_consent_from IS NULL) = (night_consent_to IS NULL))
);

CREATE INDEX ix_shift_assignment_user ON shift_assignment (organization_id, user_id, effective_from);
CREATE INDEX ix_shift_override_user ON shift_override (organization_id, user_id, work_date);
CREATE INDEX ix_shift_request_status ON shift_request (organization_id, status, from_date);

SELECT apply_tenant_rls('shift');
SELECT apply_tenant_rls('shift_version');
SELECT apply_tenant_rls('shift_rotation');
SELECT apply_tenant_rls('shift_rotation_day');
SELECT apply_tenant_rls('shift_assignment');
SELECT apply_tenant_rls('shift_request');
SELECT apply_tenant_rls('shift_override');
SELECT apply_tenant_rls('department_shift_default');
SELECT apply_tenant_rls('shift_setting');

GRANT SELECT, INSERT, UPDATE ON shift TO tapcrm_app;
GRANT SELECT, INSERT ON shift_version TO tapcrm_app;              -- a change is a new version
GRANT SELECT, INSERT, UPDATE ON shift_rotation TO tapcrm_app;
GRANT SELECT, INSERT ON shift_rotation_day TO tapcrm_app;
GRANT SELECT, INSERT, UPDATE ON shift_assignment TO tapcrm_app;   -- ending one sets effective_to
GRANT SELECT, INSERT, UPDATE ON shift_request TO tapcrm_app;
GRANT SELECT, INSERT, DELETE ON shift_override TO tapcrm_app;     -- overrides go with their request
GRANT SELECT, INSERT, UPDATE ON department_shift_default TO tapcrm_app;
GRANT SELECT, INSERT ON shift_setting TO tapcrm_app;              -- a change is a new dated row
```

- [ ] **Apply it:**

```bash
npm run migrate
psql "$MIGRATION_DATABASE_URL" -c "ALTER ROLE tapcrm_app LOGIN PASSWORD 'app_test_password';"
npm run ci
```

Expected: `0047_shifts.sql ... ok`, and `npm run ci` reports `✓ CI-33  RLS on all 41 tenant-owned tables`.

Checkpoint: leave the changes in the working tree for review.

---

## Task 3 — The resolver (SH-1, SH-2, SH-4, §6.2)

A pure function over everything the chain reads for one person. The chain,
highest first: date override, permanent flexible, approved flexible request,
rotation, template, department default, nothing. "The version on a date" is
the latest one starting on or before it. `anchorShift` gives a day without
fixed times the template its boundary borrows (§5.2).

- [ ] **Create the test helpers** —
  `packages/server/src/modules/shifts/fixtures.test-helpers.ts`:

```ts
import type { DateOnly, LocalTime } from '@tapcrm/contracts';
import type {
  AssignmentInput,
  ShiftInput,
  ShiftInputs,
  ShiftVersionInput,
} from './resolve.js';

/** Builders for the pure shift tests. Times are wall-clock; dates are ISO. */

export const d = (value: string) => value as DateOnly;
export const t = (value: string) => value as LocalTime;

export function version(
  id: string,
  effectiveFrom: string,
  start: string | null,
  end: string | null,
  extra: Partial<ShiftVersionInput> = {},
): ShiftVersionInput {
  return {
    id,
    effectiveFrom: d(effectiveFrom),
    startTime: start === null ? null : t(start),
    endTime: end === null ? null : t(end),
    graceMinutes: 10,
    earlyExitGraceMinutes: 0,
    fullDayMinutes: 450,
    halfDayMinutes: 240,
    complementaryHalfMinutes: null,
    minOvertimeMinutes: null,
    earlyWindowMinutes: 180,
    maxClosingExtensionMinutes: null,
    ...extra,
  };
}

export const fixed = (
  id: string,
  start: string,
  end: string,
  from = '2026-01-01',
): ShiftInput => ({
  id,
  kind: 'fixed',
  versions: [version(`${id}-v1`, from, start, end)],
});

export const flexibleTemplate = (id: string): ShiftInput => ({
  id,
  kind: 'flexible',
  versions: [
    version(`${id}-v1`, '2026-01-01', null, null, {
      fullDayMinutes: 480,
      halfDayMinutes: 300,
    }),
  ],
});

export const template = (
  shiftId: string,
  from = '2026-01-01',
  to: string | null = null,
): AssignmentInput => ({
  kind: 'template',
  shiftId,
  rotationId: null,
  effectiveFrom: d(from),
  effectiveTo: to === null ? null : d(to),
});

export function inputs(
  overrides: Partial<ShiftInputs> & { shiftList?: ShiftInput[] } = {},
): ShiftInputs {
  const { shiftList = [], ...rest } = overrides;
  return {
    timezone: 'Asia/Kolkata',
    shifts: new Map(shiftList.map((shift) => [shift.id, shift])),
    rotations: new Map(),
    overrides: [],
    assignments: [],
    flexibleRequests: [],
    departmentDefaults: [],
    settings: [],
    ...rest,
  };
}
```

- [ ] **Write the test** — `packages/server/src/modules/shifts/resolve.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  d,
  fixed,
  flexibleTemplate,
  inputs,
  template,
  version,
} from './fixtures.test-helpers.js';
import { resolveShift } from './resolve.js';

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

  it('4: a rotation gives the weekday’s template, or no shift that weekday', () => {
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
```

- [ ] **Run it and watch it fail:** `npx vitest run packages/server/src/modules/shifts/resolve.test.ts`
  — expected: `Error: Failed to load url ./resolve.js … Does the file exist?`

- [ ] **Create** `packages/server/src/modules/shifts/resolve.ts`:

```ts
import type { DateOnly, LocalTime, ResolvedShift, ShiftSource } from '@tapcrm/contracts';
import { weekdayOf } from '../../platform/time.js';

/**
 * SH-1 — which shift applied to a person on a date, and why (design §6.2).
 *
 * Pure: `repository.loadShiftInputs` reads everything once, and this walks the
 * chain, highest precedence first. No other code decides a person's shift.
 *
 *   1 date override · 2 permanent flexible · 3 approved flexible request
 *   4 rotation · 5 template · 6 department default · 7 nothing
 *
 * "The version on a date" is the latest version whose effective_from is on or
 * before it, so a template edit never reaches back (SH-2). Inactive templates
 * keep resolving for the assignments they already have (SH-5).
 */

/** SH-4 — flexible thresholds are constants, not settings. */
export const FLEXIBLE_FULL_DAY_MINUTES = 480;
export const FLEXIBLE_HALF_DAY_MINUTES = 300;

export interface ShiftVersionInput {
  readonly id: string;
  readonly effectiveFrom: DateOnly;
  readonly startTime: LocalTime | null;
  readonly endTime: LocalTime | null;
  readonly graceMinutes: number;
  readonly earlyExitGraceMinutes: number;
  readonly fullDayMinutes: number;
  readonly halfDayMinutes: number;
  readonly complementaryHalfMinutes: number | null;
  readonly minOvertimeMinutes: number | null;
  readonly earlyWindowMinutes: number;
  readonly maxClosingExtensionMinutes: number | null;
}

export interface ShiftInput {
  readonly id: string;
  readonly kind: 'fixed' | 'flexible';
  /** Any order. */
  readonly versions: readonly ShiftVersionInput[];
}

interface Dated {
  readonly effectiveFrom: DateOnly;
  /** Exclusive; null is open-ended. */
  readonly effectiveTo: DateOnly | null;
}

export interface AssignmentInput extends Dated {
  readonly kind: 'template' | 'rotation' | 'permanent-flexible';
  readonly shiftId: string | null;
  readonly rotationId: string | null;
}

export interface OverrideInput {
  readonly workDate: DateOnly;
  readonly kind: 'shift' | 'flexible' | 'no-shift';
  readonly shiftId: string | null;
}

export interface FlexibleRequestInput {
  readonly fromDate: DateOnly;
  /** Inclusive. */
  readonly toDate: DateOnly;
}

export interface DepartmentDefaultInput extends Dated {
  readonly shiftId: string;
}

export interface ShiftSettingInput {
  readonly effectiveFrom: DateOnly;
  readonly dayStartTime: LocalTime;
  readonly maxClosingExtensionMinutes: number;
}

/** Everything the chain reads for one person. */
export interface ShiftInputs {
  readonly timezone: string;
  readonly shifts: ReadonlyMap<string, ShiftInput>;
  /** rotation id → ISO weekday (1–7) → shift id, or null for no shift that day. */
  readonly rotations: ReadonlyMap<string, ReadonlyMap<number, string | null>>;
  readonly overrides: readonly OverrideInput[];
  readonly assignments: readonly AssignmentInput[];
  readonly flexibleRequests: readonly FlexibleRequestInput[];
  readonly departmentDefaults: readonly DepartmentDefaultInput[];
  readonly settings: readonly ShiftSettingInput[];
}

const covers = (row: Dated, date: DateOnly): boolean =>
  row.effectiveFrom <= date && (row.effectiveTo === null || date < row.effectiveTo);

/** The latest dated row in force on `date`, or undefined. */
export function inForce<T extends { readonly effectiveFrom: DateOnly }>(
  rows: readonly T[],
  date: DateOnly,
): T | undefined {
  let best: T | undefined;
  for (const row of rows) {
    if (
      row.effectiveFrom <= date &&
      (best === undefined || row.effectiveFrom > best.effectiveFrom)
    )
      best = row;
  }
  return best;
}

export function settingOn(
  inputs: ShiftInputs,
  date: DateOnly,
): ShiftSettingInput | undefined {
  return inForce(inputs.settings, date);
}

function none(
  inputs: ShiftInputs,
  date: DateOnly,
  source: ShiftSource,
  shiftId: string | null = null,
): ResolvedShift {
  return {
    date,
    source,
    shiftId,
    versionId: null,
    kind: 'none',
    start: null,
    end: null,
    isOvernight: false,
    graceMinutes: 0,
    earlyExitGraceMinutes: 0,
    fullDayMinutes: null,
    halfDayMinutes: null,
    complementaryHalfMinutes: null,
    minOvertimeMinutes: null,
    earlyWindowMinutes: 0,
    maxClosingExtensionMinutes:
      settingOn(inputs, date)?.maxClosingExtensionMinutes ?? null,
    timezone: inputs.timezone,
  };
}

function flexible(
  inputs: ShiftInputs,
  date: DateOnly,
  source: ShiftSource,
  shiftId: string | null = null,
): ResolvedShift {
  return {
    ...none(inputs, date, source, shiftId),
    kind: 'flexible',
    fullDayMinutes: FLEXIBLE_FULL_DAY_MINUTES,
    halfDayMinutes: FLEXIBLE_HALF_DAY_MINUTES,
  };
}

/** A template as it stood on `date`. A template with no version yet is no shift. */
export function templateOn(
  inputs: ShiftInputs,
  shiftId: string,
  date: DateOnly,
  source: ShiftSource,
): ResolvedShift {
  const shift = inputs.shifts.get(shiftId);
  const version = shift === undefined ? undefined : inForce(shift.versions, date);
  if (shift === undefined || version === undefined)
    return none(inputs, date, source, shiftId);
  if (
    shift.kind === 'flexible' ||
    version.startTime === null ||
    version.endTime === null
  ) {
    return { ...flexible(inputs, date, source, shiftId), versionId: version.id };
  }
  return {
    date,
    source,
    shiftId,
    versionId: version.id,
    kind: 'fixed',
    start: version.startTime,
    end: version.endTime,
    isOvernight: version.endTime < version.startTime,
    graceMinutes: version.graceMinutes,
    earlyExitGraceMinutes: version.earlyExitGraceMinutes,
    fullDayMinutes: version.fullDayMinutes,
    halfDayMinutes: version.halfDayMinutes,
    complementaryHalfMinutes: version.complementaryHalfMinutes,
    minOvertimeMinutes: version.minOvertimeMinutes,
    earlyWindowMinutes: version.earlyWindowMinutes,
    maxClosingExtensionMinutes:
      version.maxClosingExtensionMinutes ??
      settingOn(inputs, date)?.maxClosingExtensionMinutes ??
      null,
    timezone: inputs.timezone,
  };
}

/** The shift a rotation gives on `date`: undefined off the rotation, null for no shift that weekday. */
function rotationShift(
  inputs: ShiftInputs,
  rotationId: string,
  date: DateOnly,
): string | null | undefined {
  const days = inputs.rotations.get(rotationId);
  if (days === undefined) return undefined;
  return days.get(weekdayOf(date)) ?? null;
}

export function resolveShift(inputs: ShiftInputs, date: DateOnly): ResolvedShift {
  // 1. A date override.
  const override = inputs.overrides.find((row) => row.workDate === date);
  if (override !== undefined) {
    if (override.kind === 'flexible') return flexible(inputs, date, 'date-override');
    if (override.kind === 'no-shift' || override.shiftId === null)
      return none(inputs, date, 'date-override');
    return templateOn(inputs, override.shiftId, date, 'date-override');
  }

  const active = inputs.assignments.filter((row) => covers(row, date));
  const ofKind = (kind: AssignmentInput['kind']) =>
    active.find((row) => row.kind === kind);

  // 2. Permanent flexible hours.
  if (ofKind('permanent-flexible') !== undefined)
    return flexible(inputs, date, 'permanent-flexible');

  // 3. An approved request for flexible hours.
  if (inputs.flexibleRequests.some((row) => row.fromDate <= date && date <= row.toDate)) {
    return flexible(inputs, date, 'flexible-request');
  }

  // 4. A rotation: the weekday's template, or no shift that weekday.
  const rotation = ofKind('rotation');
  if (rotation?.rotationId != null) {
    const shiftId = rotationShift(inputs, rotation.rotationId, date);
    if (shiftId === null) return none(inputs, date, 'rotation');
    if (shiftId !== undefined) return templateOn(inputs, shiftId, date, 'rotation');
  }

  // 5. A template.
  const template = ofKind('template');
  if (template?.shiftId != null)
    return templateOn(inputs, template.shiftId, date, 'template');

  // 6. The department's default.
  const departmentDefault = inputs.departmentDefaults.find((row) => covers(row, date));
  if (departmentDefault !== undefined)
    return templateOn(inputs, departmentDefault.shiftId, date, 'department-default');

  // 7. Nothing: recorded, not evaluated.
  return none(inputs, date, 'none');
}

/**
 * §5.2 — the fixed template a day without fixed times borrows its boundary
 * anchor from: the person's assigned template (rotation, then template) even
 * when a higher rule made the day flexible, else the department default. Never
 * a neighbouring day's shift.
 */
export function anchorShift(inputs: ShiftInputs, date: DateOnly): ResolvedShift | null {
  const candidates: (readonly [string | null | undefined, ShiftSource])[] = [];
  const active = inputs.assignments.filter((row) => covers(row, date));
  const rotation = active.find((row) => row.kind === 'rotation');
  if (rotation?.rotationId != null)
    candidates.push([rotationShift(inputs, rotation.rotationId, date), 'rotation']);
  const template = active.find((row) => row.kind === 'template');
  if (template?.shiftId != null) candidates.push([template.shiftId, 'template']);
  const departmentDefault = inputs.departmentDefaults.find((row) => covers(row, date));
  if (departmentDefault !== undefined)
    candidates.push([departmentDefault.shiftId, 'department-default']);

  for (const [shiftId, source] of candidates) {
    if (typeof shiftId !== 'string') continue;
    const resolved = templateOn(inputs, shiftId, date, source);
    if (resolved.kind === 'fixed') return resolved;
  }
  return null;
}
```

- [ ] **Run the test again.** Expected: `Tests  13 passed (13)`.

Checkpoint: leave the changes in the working tree for review.

---

## Task 4 — Day windows (SH-3, SH-I1, §5.2)

Between two consecutive days, the boundary is the midpoint of the off-duty gap.
A day with no fixed times anchors on the assigned template, then the department
default, then the day-start time — never a neighbouring day. Overlapping
neighbours are flagged, never cut short. This is geometry only; which day an
event belongs to is attendance's job (step 3).

- [ ] **Write the test** — `packages/server/src/modules/shifts/windows.test.ts`.
  Its cases are the design's own: 01:30, 12:30, and the rotation table of
  §6.6; the anchor cases; the night of §6.6 end to end; a night on 31 March
  belonging to March.

```ts
import { describe, expect, it } from 'vitest';
import type { ShiftInputs } from './resolve.js';
import { d, fixed, inputs, template } from './fixtures.test-helpers.js';
import { dayWindow, dayWindowContaining } from './windows.js';

/** Instants are written in IST (+05:30), the organization's zone in these tests. */
const at = (local: string) => new Date(`${local}+05:30`);
const iso = (local: string) => at(local).toISOString();

const DAY = fixed('day', '09:00', '18:00');
const NIGHT = fixed('night', '20:00', '05:00');
const EARLY = fixed('early', '04:30', '13:30');

/** Each date's own template, by override, for tables of consecutive days. */
function roster(days: Record<string, string>): ShiftInputs {
  return inputs({
    shiftList: [DAY, NIGHT, EARLY],
    overrides: Object.entries(days).map(([date, shiftId]) => ({
      workDate: d(date),
      kind: 'shift' as const,
      shiftId,
    })),
  });
}

describe('SH-3 / §5.2 — the boundary is the midpoint of the off-duty gap', () => {
  it('day after day: 18:00 → 09:00 puts the boundary at 01:30', () => {
    const window = dayWindow(
      inputs({ shiftList: [DAY], assignments: [template('day')] }),
      d('2026-09-28'),
    );
    expect(window.start.toISOString()).toBe(iso('2026-09-28T01:30:00'));
    expect(window.end.toISOString()).toBe(iso('2026-09-29T01:30:00'));
  });

  it('night after night: the whole night is on its start date, boundary 12:30', () => {
    const window = dayWindow(
      inputs({ shiftList: [NIGHT], assignments: [template('night')] }),
      d('2026-09-26'),
    );
    expect(window.start.toISOString()).toBe(iso('2026-09-26T12:30:00'));
    expect(window.end.toISOString()).toBe(iso('2026-09-27T12:30:00'));
  });

  it('night (ends 05:00 Mon) → morning (09:00 Mon): boundary 07:00 Mon', () => {
    const window = dayWindow(
      roster({ '2026-09-27': 'night', '2026-09-28': 'day' }),
      d('2026-09-27'),
    );
    expect(window.end.toISOString()).toBe(iso('2026-09-28T07:00:00'));
  });

  it('morning (ends 18:00 Mon) → night (20:00 Tue): boundary 07:00 Tue', () => {
    const window = dayWindow(
      roster({ '2026-09-28': 'day', '2026-09-29': 'night' }),
      d('2026-09-28'),
    );
    expect(window.end.toISOString()).toBe(iso('2026-09-29T07:00:00'));
  });

  it('touching shifts: a zero gap puts the boundary at that instant', () => {
    const touching = inputs({
      shiftList: [fixed('a', '21:00', '09:00'), fixed('b', '09:00', '21:00')],
      overrides: [
        { workDate: d('2026-09-28'), kind: 'shift', shiftId: 'a' },
        { workDate: d('2026-09-29'), kind: 'shift', shiftId: 'b' },
      ],
    });
    expect(dayWindow(touching, d('2026-09-28')).end.toISOString()).toBe(
      iso('2026-09-29T09:00:00'),
    );
  });

  it('overlapping neighbours are flagged, never truncated', () => {
    // Sunday 20:00–05:00, then Monday 04:30–13:30 (§5.2).
    const window = dayWindow(
      roster({ '2026-09-27': 'night', '2026-09-28': 'early' }),
      d('2026-09-28'),
    );
    expect(window.overlap).toBe(true);
  });
});

describe('§5.2 — a day with no fixed times borrows an anchor', () => {
  it('a flexible day anchors on the person’s assigned template, so a 00:40 finish stays on Monday', () => {
    const anchored = inputs({
      shiftList: [DAY],
      assignments: [template('day')],
      overrides: [{ workDate: d('2026-09-29'), kind: 'flexible', shiftId: null }],
    });
    const monday = dayWindowContaining(anchored, at('2026-09-29T00:40:00'));
    expect(monday.date).toBe('2026-09-28');
    expect(dayWindow(anchored, d('2026-09-29')).shape.anchor).toBe('template');
  });

  it('a day with no shift at all anchors on the day-start time, 00:00 by default', () => {
    const lone = inputs({
      shiftList: [DAY],
      overrides: [{ workDate: d('2026-09-28'), kind: 'shift', shiftId: 'day' }],
    });
    // Monday 18:00 → Tuesday 00:00 anchor: boundary 21:00.
    expect(dayWindow(lone, d('2026-09-28')).end.toISOString()).toBe(
      iso('2026-09-28T21:00:00'),
    );
    expect(dayWindow(lone, d('2026-09-29')).shape.anchor).toBe('day-start');
  });
});

describe('§6.6 — a 20:00–05:00 night, end to end', () => {
  const nights = inputs({ shiftList: [NIGHT], assignments: [template('night')] });

  it('arrival 19:52, break 00:30 and departure 05:06 all fall in the 26th’s window', () => {
    for (const local of [
      '2026-09-26T19:52:00',
      '2026-09-27T00:30:00',
      '2026-09-27T05:06:00',
    ]) {
      expect(dayWindowContaining(nights, at(local)).date).toBe('2026-09-26');
    }
  });

  it('a 13:10 scan the next afternoon is in the 27th’s window', () => {
    expect(dayWindowContaining(nights, at('2026-09-27T13:10:00')).date).toBe(
      '2026-09-27',
    );
  });

  it('a night starting 31 March is a March day', () => {
    expect(dayWindowContaining(nights, at('2027-04-01T04:00:00')).date).toBe(
      '2027-03-31',
    );
  });
});
```

- [ ] **Run it and watch it fail** — expected: `Error: Failed to load url ./windows.js … Does the file exist?`

- [ ] **Create** `packages/server/src/modules/shifts/windows.ts`:

```ts
import type { DateOnly } from '@tapcrm/contracts';
import { addDays, instantAt, localDateOf, toLocalTime } from '../../platform/time.js';
import { anchorShift, resolveShift, settingOn, type ShiftInputs } from './resolve.js';

/**
 * Day windows — design §5.2, SH-3, SH-I1. Geometry only.
 *
 * Between two consecutive days the boundary is the midpoint of the off-duty
 * gap: halfway between one day's shift end and the next day's shift start.
 * Both days compute the same boundary from the same two shifts, so the windows
 * tile time and every instant belongs to exactly one day.
 *
 * A day with no fixed times borrows an anchor instead of falling back to
 * midnight: the person's assigned template, else the department default, else
 * the organization's day-start time. It never looks at a neighbouring day.
 *
 * A window partitions time. It never decides which day an event belongs to —
 * that is attendance's `attributeEvent`, which may cross a boundary (§5.2).
 */

export type AnchorSource =
  'own-shift' | 'rotation' | 'template' | 'department-default' | 'day-start';

export interface DayShape {
  readonly date: DateOnly;
  /** The shift's start, or the anchor's. */
  readonly start: Date;
  /** The shift's end — on the next date when overnight — or the anchor's. */
  readonly end: Date;
  readonly anchor: AnchorSource;
  readonly shiftId: string | null;
}

export interface DayWindow {
  readonly date: DateOnly;
  /** Inclusive. */
  readonly start: Date;
  /** Exclusive. */
  readonly end: Date;
  /**
   * A neighbouring shift overlaps this one. Validation refuses that on the way
   * in; data that still has it is flagged `shift-window-overlap` and the day is
   * left unevaluated (§5.2).
   */
  readonly overlap: boolean;
  readonly shape: DayShape;
}

const DAY_START = toLocalTime('00:00');

export function dayShape(inputs: ShiftInputs, date: DateOnly): DayShape {
  const resolved = resolveShift(inputs, date);
  const fixed = resolved.kind === 'fixed' ? resolved : anchorShift(inputs, date);
  if (fixed !== null && fixed.start !== null && fixed.end !== null) {
    return {
      date,
      start: instantAt(date, fixed.start, inputs.timezone),
      end: instantAt(
        fixed.isOvernight ? addDays(date, 1) : date,
        fixed.end,
        inputs.timezone,
      ),
      anchor: fixed === resolved ? 'own-shift' : (fixed.source as AnchorSource),
      shiftId: fixed.shiftId,
    };
  }
  const at = instantAt(
    date,
    settingOn(inputs, date)?.dayStartTime ?? DAY_START,
    inputs.timezone,
  );
  return { date, start: at, end: at, anchor: 'day-start', shiftId: null };
}

/** Halfway, in whole seconds (T-6). */
function midpoint(a: Date, b: Date): Date {
  return new Date(Math.floor((a.getTime() + b.getTime()) / 2_000) * 1_000);
}

export function windowBetween(
  previous: DayShape,
  day: DayShape,
  next: DayShape,
): DayWindow {
  return {
    date: day.date,
    start: midpoint(previous.end, day.start),
    end: midpoint(day.end, next.start),
    overlap: previous.end > day.start || day.end > next.start,
    shape: day,
  };
}

export function dayWindow(inputs: ShiftInputs, date: DateOnly): DayWindow {
  return windowBetween(
    dayShape(inputs, addDays(date, -1)),
    dayShape(inputs, date),
    dayShape(inputs, addDays(date, 1)),
  );
}

/** The day whose window holds `instant`: its local date, the day before, or the day after. */
export function dayWindowContaining(inputs: ShiftInputs, instant: Date): DayWindow {
  const local = localDateOf(instant, inputs.timezone);
  for (const date of [local, addDays(local, -1), addDays(local, 1)]) {
    const window = dayWindow(inputs, date);
    if (window.start <= instant && instant < window.end) return window;
  }
  // Windows tile time, so this is reached only with overlapping shifts, which
  // are flagged; the local date is then the least surprising answer.
  return dayWindow(inputs, local);
}
```

- [ ] **Run the test again.** Expected: `Tests  11 passed (11)`.

Checkpoint: leave the changes in the working tree for review.

---

## Task 5 — The save rules (§6.3)

- [ ] **Write the test** — `packages/server/src/modules/shifts/rules.test.ts`:

```ts
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
```

- [ ] **Run it and watch it fail** — expected: `Error: Failed to load url ./rules.js … Does the file exist?`

- [ ] **Create** `packages/server/src/modules/shifts/errors.ts`:

```ts
import { ApplicationError } from '../../errors.js';

export const SHIFT_ERROR_CODES = {
  START_END_MUST_DIFFER: 'SHIFT_START_END_MUST_DIFFER',
  TIMES_REQUIRED: 'SHIFT_TIMES_REQUIRED',
  TIMES_NOT_ALLOWED: 'SHIFT_TIMES_NOT_ALLOWED',
  THRESHOLD_UNREACHABLE: 'SHIFT_THRESHOLD_UNREACHABLE',
  WINDOW_OVERLAP: 'SHIFT_WINDOW_OVERLAP',
  INACTIVE: 'SHIFT_INACTIVE',
  NO_VERSION: 'SHIFT_NO_VERSION',
  VERSION_EXISTS: 'SHIFT_VERSION_EXISTS',
  CODE_TAKEN: 'SHIFT_CODE_TAKEN',
  ASSIGNMENT_CONFLICT: 'SHIFT_ASSIGNMENT_CONFLICT',
  REQUEST_NOT_PENDING: 'SHIFT_REQUEST_NOT_PENDING',
  PAST_CHANGE_NEEDS_CORRECTION_AUTHORITY: 'SHIFT_PAST_CHANGE_NEEDS_CORRECTION_AUTHORITY',
  NOT_FOUND: 'SHIFT_NOT_FOUND',
  RANGE_TOO_LONG: 'SHIFT_RANGE_TOO_LONG',
  OVERRIDE_NEEDS_SHIFT: 'SHIFT_OVERRIDE_NEEDS_SHIFT',
} as const;

/** 422: the principal may make this kind of change, but not this one. */
export class ShiftValidationError extends ApplicationError {
  constructor(code: string, message: string, details?: unknown) {
    super(message, 422, code, details);
    this.name = 'ShiftValidationError';
  }
}

/** SH-6: a past-dated change also needs `attendance:correct`. */
export class ShiftForbiddenError extends ApplicationError {
  constructor(code: string, message: string) {
    super(message, 403, code);
    this.name = 'ShiftForbiddenError';
  }
}

export class ShiftNotFoundError extends ApplicationError {
  constructor(message: string) {
    super(message, 404, SHIFT_ERROR_CODES.NOT_FOUND);
    this.name = 'ShiftNotFoundError';
  }
}

export class ShiftConflictError extends ApplicationError {
  constructor(code: string, message: string, details?: unknown) {
    super(message, 409, code, details);
    this.name = 'ShiftConflictError';
  }
}
```

- [ ] **Create** `packages/server/src/modules/shifts/rules.ts`. The overlap check
  looks ahead at most 400 days for an open-ended change; anything later is
  caught when it is read (§5.2).

```ts
import type { DateOnly, LocalTime } from '@tapcrm/contracts';
import { addDays, daysBetween } from '../../platform/time.js';
import { SHIFT_ERROR_CODES, ShiftValidationError } from './errors.js';
import type { ShiftInputs } from './resolve.js';
import { dayShape } from './windows.js';

/** Design §6.3 — rules checked before anything is saved. */

const minutesOf = (time: LocalTime): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
};

/** 20:00 → 05:00 is 540: overnight is strictly end < start (§6.6). */
export function scheduledMinutes(start: LocalTime, end: LocalTime): number {
  return (minutesOf(end) - minutesOf(start) + 1_440) % 1_440;
}

export interface VersionFields {
  readonly kind: 'fixed' | 'flexible';
  readonly startTime: LocalTime | null;
  readonly endTime: LocalTime | null;
  readonly fullDayMinutes: number;
  readonly halfDayMinutes: number;
  readonly complementaryHalfMinutes: number | null;
}

export function validateVersion(fields: VersionFields): void {
  const { kind, startTime, endTime } = fields;
  if (kind === 'flexible') {
    if (startTime !== null || endTime !== null) {
      throw new ShiftValidationError(
        SHIFT_ERROR_CODES.TIMES_NOT_ALLOWED,
        'A flexible shift has no start or end time.',
      );
    }
    return;
  }
  if (startTime === null || endTime === null) {
    throw new ShiftValidationError(
      SHIFT_ERROR_CODES.TIMES_REQUIRED,
      'A fixed shift needs a start and an end time.',
    );
  }
  if (startTime === endTime) {
    throw new ShiftValidationError(
      SHIFT_ERROR_CODES.START_END_MUST_DIFFER,
      'Start and end are the same time. A shift cannot last 24 hours by accident; check the times.',
    );
  }
  const scheduled = scheduledMinutes(startTime, endTime);
  if (fields.halfDayMinutes <= 0 || fields.halfDayMinutes >= fields.fullDayMinutes) {
    throw new ShiftValidationError(
      SHIFT_ERROR_CODES.THRESHOLD_UNREACHABLE,
      'Half-day minutes must be more than 0 and less than full-day minutes.',
    );
  }
  if (fields.fullDayMinutes > scheduled) {
    throw new ShiftValidationError(
      SHIFT_ERROR_CODES.THRESHOLD_UNREACHABLE,
      `Full-day minutes (${fields.fullDayMinutes}) are more than the shift lasts (${scheduled}), so nobody could reach them.`,
      { scheduledMinutes: scheduled },
    );
  }
  if (
    fields.complementaryHalfMinutes !== null &&
    fields.complementaryHalfMinutes > scheduled / 2
  ) {
    throw new ShiftValidationError(
      SHIFT_ERROR_CODES.THRESHOLD_UNREACHABLE,
      `Complementary half minutes (${fields.complementaryHalfMinutes}) are more than half the shift (${scheduled / 2}).`,
      { scheduledMinutes: scheduled },
    );
  }
}

export interface WindowOverlap {
  readonly date: DateOnly;
  readonly previousShiftId: string | null;
  readonly shiftId: string | null;
  readonly overlapMinutes: number;
}

/** The furthest ahead an open-ended change is checked; later overlaps are caught at read time. */
export const OVERLAP_HORIZON_DAYS = 400;

/**
 * §6.3 "No overlap" — consecutive days whose own fixed shifts overlap, for
 * every date from the day before `from` to the day after `to`.
 */
export function findWindowOverlaps(
  inputs: ShiftInputs,
  from: DateOnly,
  to: DateOnly | null,
): WindowOverlap[] {
  const last =
    to === null || daysBetween(from, to) > OVERLAP_HORIZON_DAYS
      ? addDays(from, OVERLAP_HORIZON_DAYS)
      : to;
  const overlaps: WindowOverlap[] = [];
  let previous = dayShape(inputs, addDays(from, -1));
  for (let date = from; date <= addDays(last, 1); date = addDays(date, 1)) {
    const day = dayShape(inputs, date);
    if (
      previous.anchor === 'own-shift' &&
      day.anchor === 'own-shift' &&
      previous.end > day.start
    ) {
      overlaps.push({
        date,
        previousShiftId: previous.shiftId,
        shiftId: day.shiftId,
        overlapMinutes: Math.round(
          (previous.end.getTime() - day.start.getTime()) / 60_000,
        ),
      });
    }
    previous = day;
  }
  return overlaps;
}
```

- [ ] **Run the test again.** Expected: `Tests  8 passed (8)`.

Checkpoint: leave the changes in the working tree for review.

---

## Task 6 — Use cases: templates, assignments, the explorer, decisions (SH-2, SH-5, SH-6, SH-7)

What the services do:

- **Templates.** A new template is saved with its first version. `PATCH` either
  adds a new version from a date (tomorrow by default) or sets the status. A
  template is never deleted (SH-5).
- **Assignments.** One route takes a template, a rotation, permanent flexible
  hours, a date override or a department default. A new assignment ends the
  person's current one of the same kind on its first date. If there is already
  a later one of that kind, the request is refused.
- **SH-5.** An inactive template cannot be assigned. People already on it keep
  resolving to it.
- **SH-6.** A change dated before the organization's today also needs
  `attendance:correct`, or it is refused with 403
  `SHIFT_PAST_CHANGE_NEEDS_CORRECTION_AUTHORITY`.
- **Overlaps.** A change that would make two consecutive shifts overlap is
  refused with 422 `SHIFT_WINDOW_OVERLAP`, naming the date and the minutes.
- **Scope.** Changes about a person are checked against the caller's scope for
  that person with `authorize`, using the same people rules as `userPolicy`.
- **Approving a request.** An approved change becomes date overrides that point
  back at the request. An approved flexible request is read by the resolver
  directly. SH-7 is enforced twice: by the engine through `requestedBy`, and by
  a database CHECK.
- **Recalculation.** Every change writes `shifts.days-changed` (see
  "Decisions").

- [ ] **Write the test** —
  `packages/server/src/modules/shifts/shifts.integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { Principal } from '@tapcrm/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installAuthz } from '../../platform/authz-adapter.js';
import { createRequestContext } from '../../platform/dal/context.js';
import { platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import { fixedClock, toDateOnly } from '../../platform/time.js';
import { registerShiftPolicies } from './policy.js';
import {
  assign,
  createShift,
  decideRequest,
  explainShifts,
  reviseShift,
} from './service.js';

/**
 * Step 1 through the services, against real PostgreSQL: RLS, the exclusion
 * constraints, the engine and position policies (design §6).
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const ORG = randomUUID();
const DEPT = randomUUID();
const POS_HR = randomUUID();
const POS_HR_CORRECT = randomUUID();
const EMP = randomUUID();
const HR = randomUUID();
const HR_CORRECT = randomUUID();
const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query('migration', reason, fragment);

// Friday 25 September 2026, 11:30 in Kolkata.
const clock = fixedClock('2026-09-25T06:00:00Z');
const date = toDateOnly;

function hrContext(userId: string, positionId: string) {
  const principal: Principal = {
    id: userId,
    organizationId: ORG,
    sessionVersion: 1,
    accountType: 'employee',
    positionId,
    departmentId: DEPT,
    teamId: null,
    reportsTo: null,
    organizationalLevel: 50,
  };
  return createRequestContext({
    organizationId: ORG,
    principal,
    requestId: randomUUID(),
  });
}

const hr = () => hrContext(HR, POS_HR);
const hrWithCorrect = () => hrContext(HR_CORRECT, POS_HR_CORRECT);

const version = (
  startTime: string | null,
  endTime: string | null,
  effectiveFrom?: string,
) => ({
  ...(effectiveFrom === undefined ? {} : { effectiveFrom: date(effectiveFrom) }),
  startTime: startTime as never,
  endTime: endTime as never,
  graceMinutes: 10,
  earlyExitGraceMinutes: 0,
  fullDayMinutes: 450,
  halfDayMinutes: 240,
  complementaryHalfMinutes: null,
  minOvertimeMinutes: null,
  earlyWindowMinutes: 180,
  maxClosingExtensionMinutes: null,
});

let day = '';
let night = '';
let early = '';

describe.skipIf(!enabled)('shifts (PostgreSQL)', () => {
  beforeAll(async () => {
    installAuthz();
    registerShiftPolicies();
    await asOwner(
      'create test organization',
      sql`
      INSERT INTO organization (id, code, name, timezone) VALUES (${ORG}, ${`SH${ORG.slice(0, 6)}`}, 'Shift Test', 'Asia/Kolkata')`,
    );
    await asOwner(
      'create department',
      sql`
      INSERT INTO department (id, organization_id, code, name, kind) VALUES (${DEPT}, ${ORG}, 'OPS', 'Operations', 'operations')`,
    );
    await asOwner(
      'create positions',
      sql`
      INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
      VALUES (${POS_HR}, ${ORG}, ${DEPT}, 'HR-1', 'HR', 50), (${POS_HR_CORRECT}, ${ORG}, ${DEPT}, 'HR-2', 'HR Lead', 50)`,
    );
    for (const position of [POS_HR, POS_HR_CORRECT]) {
      for (const action of ['shifts:view', 'shifts:manage', 'shifts:approve']) {
        await asOwner(
          'grant shift policy',
          sql`
          INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
          VALUES (${ORG}, ${position}, ${action}, true, 'all-people')`,
        );
      }
    }
    await asOwner(
      'grant attendance:correct to one position',
      sql`
      INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
      VALUES (${ORG}, ${POS_HR_CORRECT}, 'attendance:correct', true, 'all-people')`,
    );
    await asOwner(
      'create people',
      sql`
      INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id)
      VALUES (${EMP}, ${ORG}, 'employee', 'EMP-SH001', ${`emp-${EMP}@t.io`}, 'Night Worker', ${POS_HR}, ${DEPT}),
             (${HR}, ${ORG}, 'employee', 'EMP-SH002', ${`hr-${HR}@t.io`}, 'HR One', ${POS_HR}, ${DEPT}),
             (${HR_CORRECT}, ${ORG}, 'employee', 'EMP-SH003', ${`hr2-${HR_CORRECT}@t.io`}, 'HR Two', ${POS_HR_CORRECT}, ${DEPT})`,
    );

    day = (
      await createShift(
        hr(),
        { code: 'DAY', name: 'Day', kind: 'fixed', version: version('09:00', '18:00') },
        clock,
      )
    ).id;
    night = (
      await createShift(
        hr(),
        {
          code: 'NIGHT',
          name: 'Night',
          kind: 'fixed',
          version: version('20:00', '05:00'),
        },
        clock,
      )
    ).id;
    early = (
      await createShift(
        hr(),
        {
          code: 'EARLY',
          name: 'Early',
          kind: 'fixed',
          version: version('04:30', '13:30'),
        },
        clock,
      )
    ).id;
  });

  afterAll(async () => {
    for (const table of [
      'domain_outbox',
      'shift_override',
      'shift_request',
      'shift_assignment',
      'shift_rotation_day',
      'shift_rotation',
      'department_shift_default',
      'shift_version',
      'shift',
      'position_policy',
    ]) {
      await asOwner(
        `remove ${table}`,
        sql`DELETE FROM ${sql.raw(table)} WHERE organization_id = ${ORG}`,
      );
    }
    await asOwner(
      'remove directory rows',
      sql`DELETE FROM identity_email_directory WHERE organization_id = ${ORG}`,
    );
    await asOwner(
      'remove people',
      sql`DELETE FROM app_user WHERE organization_id = ${ORG}`,
    );
    await asOwner(
      'remove positions',
      sql`DELETE FROM position WHERE organization_id = ${ORG}`,
    );
    await asOwner(
      'remove department',
      sql`DELETE FROM department WHERE organization_id = ${ORG}`,
    );
    await asOwner('remove organization', sql`DELETE FROM organization WHERE id = ${ORG}`);
    await closePools();
  });

  it('done when: the explorer shows the right shift and source for each date', async () => {
    await assign(
      hr(),
      {
        kind: 'template',
        userId: EMP,
        shiftId: day,
        effectiveFrom: date('2026-09-28'),
        effectiveTo: null,
      },
      clock,
    );
    await assign(
      hr(),
      {
        kind: 'override',
        userId: EMP,
        workDate: date('2026-09-30'),
        override: 'shift',
        shiftId: night,
        reason: 'Cover',
      },
      clock,
    );

    const result = await explainShifts(
      hr(),
      { userId: EMP, from: date('2026-09-28'), to: date('2026-10-01') },
      clock,
    );
    if (!('days' in result)) throw new Error('expected days');
    expect(result.days.map((d) => [d.date, d.source, d.start])).toEqual([
      ['2026-09-28', 'template', '09:00'],
      ['2026-09-29', 'template', '09:00'],
      ['2026-09-30', 'date-override', '20:00'],
      ['2026-10-01', 'template', '09:00'],
    ]);
    // The night of the 30th ends 05:00 on the 1st; the 1st starts 09:00, so the boundary is 07:00.
    expect(result.days[2]!.window.end).toBe(
      new Date('2026-10-01T07:00:00+05:30').toISOString(),
    );
  });

  it('SH-2: a new version changes nothing before its date', async () => {
    await reviseShift(
      hr(),
      day,
      { version: version('10:00', '19:00', '2026-10-01') },
      clock,
    );
    const result = await explainShifts(
      hr(),
      { userId: EMP, from: date('2026-09-29'), to: date('2026-10-01') },
      clock,
    );
    if (!('days' in result)) throw new Error('expected days');
    expect(result.days[0]).toMatchObject({ date: '2026-09-29', start: '09:00' });
    expect(result.days[2]).toMatchObject({ date: '2026-10-01', start: '10:00' });
  });

  it('SH-6: a past-dated change needs attendance:correct as well', async () => {
    const pastOverride = {
      kind: 'override' as const,
      userId: EMP,
      workDate: date('2026-09-20'),
      override: 'no-shift' as const,
      shiftId: null,
      reason: 'Was on leave',
    };
    await expect(assign(hr(), pastOverride, clock)).rejects.toMatchObject({
      status: 403,
      code: 'SHIFT_PAST_CHANGE_NEEDS_CORRECTION_AUTHORITY',
    });
    await expect(assign(hrWithCorrect(), pastOverride, clock)).resolves.toBeDefined();
  });

  it('§6.3: a shift that would overlap the night before is refused with SHIFT_WINDOW_OVERLAP', async () => {
    // The night of the 30th ends 05:00 on the 1st; an early shift that day would start at 04:30.
    await expect(
      assign(
        hr(),
        {
          kind: 'override',
          userId: EMP,
          workDate: date('2026-10-01'),
          override: 'shift',
          shiftId: early,
          reason: 'Early start',
        },
        clock,
      ),
    ).rejects.toMatchObject({ status: 422, code: 'SHIFT_WINDOW_OVERLAP' });
  });

  it('SH-5: an inactive template keeps resolving but cannot be newly assigned', async () => {
    await reviseShift(hr(), early, { status: 'inactive' }, clock);
    await expect(
      assign(
        hr(),
        {
          kind: 'template',
          userId: HR,
          shiftId: early,
          effectiveFrom: date('2026-10-05'),
          effectiveTo: null,
        },
        clock,
      ),
    ).rejects.toMatchObject({ status: 422, code: 'SHIFT_INACTIVE' });
  });

  it('an approved change request becomes overrides that point back at it, and tells attendance', async () => {
    const [request] = (await asOwner(
      'raise a request (G3: no route yet)',
      sql`
      INSERT INTO shift_request (organization_id, user_id, kind, from_date, to_date, requested_shift_id, reason, requested_by)
      VALUES (${ORG}, ${EMP}, 'change', '2026-10-12', '2026-10-13', ${night}, 'Swap with a colleague', ${EMP})
      RETURNING id`,
    )) as { id: string }[];

    await expect(
      decideRequest(hr(), request!.id, { decision: 'approve', note: null }, clock),
    ).resolves.toMatchObject({ status: 'approved' });

    const overrides = (await asOwner(
      'read overrides',
      sql`
      SELECT work_date::text AS work_date, shift_id, origin_request_id FROM shift_override
      WHERE organization_id = ${ORG} AND origin_request_id = ${request!.id} ORDER BY work_date`,
    )) as {
      workDate: string;
      shiftId: string;
      originRequestId: string;
    }[];
    expect(overrides.map((o) => [o.workDate, o.shiftId])).toEqual([
      ['2026-10-12', night],
      ['2026-10-13', night],
    ]);

    const events = (await asOwner(
      'read outbox',
      sql`
      SELECT payload FROM domain_outbox WHERE organization_id = ${ORG} AND event_name = 'shifts.days-changed'
      ORDER BY enqueued_at DESC LIMIT 1`,
    )) as { payload: { userIds: string[]; from: string; to: string } }[];
    expect(events[0]!.payload).toMatchObject({
      userIds: [EMP],
      from: '2026-10-12',
      to: '2026-10-13',
    });

    await expect(
      decideRequest(hr(), request!.id, { decision: 'approve', note: null }, clock),
    ).rejects.toMatchObject({
      status: 409,
      code: 'SHIFT_REQUEST_NOT_PENDING',
    });
  });

  it('SH-7: the database refuses a request decided by the person who raised it', async () => {
    await expect(
      asOwner(
        'self-approve',
        sql`
        INSERT INTO shift_request (organization_id, user_id, kind, from_date, to_date, reason, requested_by, status, decided_by)
        VALUES (${ORG}, ${EMP}, 'flexible', '2026-10-20', '2026-10-20', 'Doctor', ${HR}, 'approved', ${HR})`,
      ),
    ).rejects.toThrow(/shift_request_check/);
  });

  it('two assignments of one kind cannot cover the same date (exclusion constraint)', async () => {
    await expect(
      asOwner(
        'overlapping template',
        sql`
        INSERT INTO shift_assignment (organization_id, user_id, kind, shift_id, effective_from, created_by)
        VALUES (${ORG}, ${EMP}, 'template', ${night}, '2026-11-01', ${HR})`,
      ),
    ).rejects.toThrow(/exclusion|conflicting key/);
  });
});
```

- [ ] **Run it and watch it fail** (integration variables set, see the step 0
  plan) — expected: `Error: Failed to load url ./policy.js … Does the file exist?`

- [ ] **Create** `packages/server/src/modules/shifts/events.ts`:

```ts
import type { DateOnly } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

/**
 * Outbox events from shifts (design §4, MB-3).
 *
 * A shift change must recalculate the days it touches (SH-6, "anchor changes",
 * "day facts rebuild"). Attendance owns recalculation and depends on shifts,
 * so shifts may not call it: it writes this event in the same transaction, and
 * attendance's handler (step 3) refreshes day facts and queues recalculation.
 * Until that handler exists the rows simply wait — the drainer claims only
 * events some process handles.
 */
export const SHIFT_EVENTS = {
  DAYS_CHANGED: 'shifts.days-changed',
} as const;

/** Exactly one of `userIds`, `departmentId` or `shiftId` says whose days changed. */
export interface DaysChanged {
  readonly userIds?: readonly string[];
  readonly departmentId?: string;
  readonly shiftId?: string;
  /** First changed date. Its neighbour before it changes too (§6.3). */
  readonly from: DateOnly;
  /** Last changed date, inclusive; null for open-ended. */
  readonly to: DateOnly | null;
  readonly reason: string;
}

export async function recordDaysChanged(
  tx: Tx,
  organizationId: string,
  change: DaysChanged,
): Promise<void> {
  await tx.query(sql`
    INSERT INTO domain_outbox (organization_id, event_name, payload)
    VALUES (${organizationId}, ${SHIFT_EVENTS.DAYS_CHANGED}, ${JSON.stringify(change)}::jsonb)
  `);
}
```

- [ ] **Create** `packages/server/src/modules/shifts/repository.ts`. Dates are
  read as text and times as `HH:mm`, so no timezone can shift them:

```ts
import type { SqlFragment } from '@tapcrm/authz';
import type { DateOnly, LocalTime } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { organizationTimezone } from '../../platform/organization-time.js';
import { addDays } from '../../platform/time.js';
import type {
  AssignmentInput,
  DepartmentDefaultInput,
  FlexibleRequestInput,
  OverrideInput,
  ShiftInput,
  ShiftInputs,
  ShiftSettingInput,
  ShiftVersionInput,
} from './resolve.js';

/**
 * SQL for shifts. Dates come back as 'YYYY-MM-DD' text and times as 'HH:mm',
 * never as JavaScript Dates, so no timezone can shift them (T-1).
 */

/** Windows need a day either side of every date they are asked about. */
const MARGIN_DAYS = 2;

export interface Subject {
  readonly id: string;
  readonly departmentId: string | null;
  readonly teamId: string | null;
  readonly status: string;
}

export async function findSubject(tx: Tx, userId: string): Promise<Subject | null> {
  return tx.maybeOne<Subject>(sql`
    SELECT id, department_id, team_id, status FROM app_user WHERE id = ${userId}
  `);
}

interface VersionRow extends ShiftVersionInput {
  shiftId: string;
  kind: 'fixed' | 'flexible';
}

async function loadShifts(tx: Tx): Promise<Map<string, ShiftInput>> {
  const rows = await tx.query<VersionRow>(sql`
    SELECT s.id AS shift_id, s.kind, v.id, v.effective_from::text AS effective_from,
           to_char(v.start_time, 'HH24:MI') AS start_time, to_char(v.end_time, 'HH24:MI') AS end_time,
           v.grace_minutes, v.early_exit_grace_minutes, v.full_day_minutes, v.half_day_minutes,
           v.complementary_half_minutes, v.min_overtime_minutes, v.early_window_minutes,
           v.max_closing_extension_minutes
    FROM shift s JOIN shift_version v ON v.organization_id = s.organization_id AND v.shift_id = s.id
  `);
  const shifts = new Map<
    string,
    { id: string; kind: 'fixed' | 'flexible'; versions: ShiftVersionInput[] }
  >();
  for (const { shiftId, kind, ...version } of rows) {
    const shift = shifts.get(shiftId) ?? { id: shiftId, kind, versions: [] };
    shift.versions.push(version);
    shifts.set(shiftId, shift);
  }
  return shifts;
}

async function loadRotations(tx: Tx): Promise<Map<string, Map<number, string | null>>> {
  const rows = await tx.query<{
    rotationId: string;
    weekday: number;
    shiftId: string | null;
  }>(sql`
    SELECT rotation_id, weekday, shift_id FROM shift_rotation_day
  `);
  const rotations = new Map<string, Map<number, string | null>>();
  for (const row of rows) {
    const days = rotations.get(row.rotationId) ?? new Map<number, string | null>();
    days.set(row.weekday, row.shiftId);
    rotations.set(row.rotationId, days);
  }
  return rotations;
}

/** Everything the resolver and the windows need for one person, `from` to `to` inclusive. */
export async function loadShiftInputs(
  tx: Tx,
  userId: string,
  from: DateOnly,
  to: DateOnly,
): Promise<ShiftInputs> {
  const first = addDays(from, -MARGIN_DAYS);
  const last = addDays(to, MARGIN_DAYS);
  const subject = await findSubject(tx, userId);
  const [
    timezone,
    shifts,
    rotations,
    overrides,
    assignments,
    flexibleRequests,
    departmentDefaults,
    settings,
  ] = await Promise.all([
    organizationTimezone(tx),
    loadShifts(tx),
    loadRotations(tx),
    tx.query<OverrideInput>(sql`
        SELECT work_date::text AS work_date, kind, shift_id FROM shift_override
        WHERE user_id = ${userId} AND work_date BETWEEN ${first} AND ${last}
      `),
    tx.query<AssignmentInput>(sql`
        SELECT kind, shift_id, rotation_id, effective_from::text AS effective_from, effective_to::text AS effective_to
        FROM shift_assignment
        WHERE user_id = ${userId} AND effective_from <= ${last}
          AND (effective_to IS NULL OR effective_to > ${first})
      `),
    tx.query<FlexibleRequestInput>(sql`
        SELECT from_date::text AS from_date, to_date::text AS to_date FROM shift_request
        WHERE user_id = ${userId} AND kind = 'flexible' AND status = 'approved'
          AND from_date <= ${last} AND to_date >= ${first}
      `),
    subject?.departmentId == null
      ? Promise.resolve([] as DepartmentDefaultInput[])
      : tx.query<DepartmentDefaultInput>(sql`
            SELECT shift_id, effective_from::text AS effective_from, effective_to::text AS effective_to
            FROM department_shift_default
            WHERE department_id = ${subject.departmentId} AND effective_from <= ${last}
              AND (effective_to IS NULL OR effective_to > ${first})
          `),
    tx.query<ShiftSettingInput>(sql`
        SELECT effective_from::text AS effective_from, to_char(day_start_time, 'HH24:MI') AS day_start_time,
               max_closing_extension_minutes
        FROM shift_setting
      `),
  ]);
  return {
    timezone,
    shifts,
    rotations,
    overrides,
    assignments,
    flexibleRequests,
    departmentDefaults,
    settings,
  };
}

/* ------------------------------------------------------------------ *
 * Templates
 * ------------------------------------------------------------------ */

export interface ShiftRow {
  id: string;
  code: string;
  name: string;
  kind: 'fixed' | 'flexible';
  status: 'active' | 'inactive';
}

export interface ShiftWithVersion extends ShiftRow {
  versionId: string | null;
  effectiveFrom: DateOnly | null;
  startTime: LocalTime | null;
  endTime: LocalTime | null;
  graceMinutes: number | null;
  fullDayMinutes: number | null;
  halfDayMinutes: number | null;
}

/** Templates with the version in force on `date` (null before the first one). */
export async function listShifts(tx: Tx, date: DateOnly): Promise<ShiftWithVersion[]> {
  return tx.query<ShiftWithVersion>(sql`
    SELECT s.id, s.code, s.name, s.kind, s.status,
           v.id AS version_id, v.effective_from::text AS effective_from,
           to_char(v.start_time, 'HH24:MI') AS start_time, to_char(v.end_time, 'HH24:MI') AS end_time,
           v.grace_minutes, v.full_day_minutes, v.half_day_minutes
    FROM shift s
    LEFT JOIN LATERAL (
      SELECT * FROM shift_version sv
      WHERE sv.organization_id = s.organization_id AND sv.shift_id = s.id AND sv.effective_from <= ${date}
      ORDER BY sv.effective_from DESC LIMIT 1
    ) v ON true
    ORDER BY s.code
  `);
}

export async function findShift(tx: Tx, shiftId: string): Promise<ShiftRow | null> {
  return tx.maybeOne<ShiftRow>(
    sql`SELECT id, code, name, kind, status FROM shift WHERE id = ${shiftId}`,
  );
}

/** Returns null when the code is already used in this organization. */
export async function insertShift(
  tx: Tx,
  input: {
    organizationId: string;
    code: string;
    name: string;
    kind: 'fixed' | 'flexible';
    createdBy: string;
  },
): Promise<string | null> {
  const rows = await tx.query<{ id: string }>(sql`
    INSERT INTO shift (organization_id, code, name, kind, created_by)
    VALUES (${input.organizationId}, ${input.code}, ${input.name}, ${input.kind}, ${input.createdBy})
    ON CONFLICT (organization_id, code) DO NOTHING
    RETURNING id
  `);
  return rows[0]?.id ?? null;
}

export interface NewVersion {
  organizationId: string;
  shiftId: string;
  effectiveFrom: DateOnly;
  startTime: LocalTime | null;
  endTime: LocalTime | null;
  graceMinutes: number;
  earlyExitGraceMinutes: number;
  fullDayMinutes: number;
  halfDayMinutes: number;
  complementaryHalfMinutes: number | null;
  minOvertimeMinutes: number | null;
  earlyWindowMinutes: number;
  maxClosingExtensionMinutes: number | null;
  createdBy: string;
}

/** Returns false when the template already has a version on that date. */
export async function insertVersion(tx: Tx, v: NewVersion): Promise<boolean> {
  const rows = await tx.query<{ id: string }>(sql`
    INSERT INTO shift_version (
      organization_id, shift_id, effective_from, start_time, end_time, grace_minutes,
      early_exit_grace_minutes, full_day_minutes, half_day_minutes, complementary_half_minutes,
      min_overtime_minutes, early_window_minutes, max_closing_extension_minutes, created_by
    ) VALUES (
      ${v.organizationId}, ${v.shiftId}, ${v.effectiveFrom}, ${v.startTime}::time, ${v.endTime}::time,
      ${v.graceMinutes}, ${v.earlyExitGraceMinutes}, ${v.fullDayMinutes}, ${v.halfDayMinutes},
      ${v.complementaryHalfMinutes}, ${v.minOvertimeMinutes}, ${v.earlyWindowMinutes},
      ${v.maxClosingExtensionMinutes}, ${v.createdBy}
    )
    ON CONFLICT (organization_id, shift_id, effective_from) DO NOTHING
    RETURNING id
  `);
  return rows.length === 1;
}

export async function hasVersion(tx: Tx, shiftId: string): Promise<boolean> {
  const row = await tx.maybeOne<{ one: number }>(sql`
    SELECT 1 AS one FROM shift_version WHERE shift_id = ${shiftId} LIMIT 1
  `);
  return row !== null;
}

export async function setShiftStatus(
  tx: Tx,
  shiftId: string,
  status: 'active' | 'inactive',
): Promise<void> {
  await tx.query(sql`UPDATE shift SET status = ${status} WHERE id = ${shiftId}`);
}

/* ------------------------------------------------------------------ *
 * Assignments, rotations, overrides, department defaults
 * ------------------------------------------------------------------ */

type AssignmentKind = 'template' | 'rotation' | 'permanent-flexible';

/**
 * A new assignment replaces its kind from its first date: an earlier one still
 * running is ended there. Returns the ids of any that start on or after it,
 * which the caller refuses rather than silently rewriting.
 */
export async function endAssignmentsFrom(
  tx: Tx,
  userId: string,
  kind: AssignmentKind,
  from: DateOnly,
): Promise<string[]> {
  const later = await tx.query<{ id: string }>(sql`
    SELECT id FROM shift_assignment
    WHERE user_id = ${userId} AND kind = ${kind} AND effective_from >= ${from}
  `);
  if (later.length > 0) return later.map((row) => row.id);
  await tx.query(sql`
    UPDATE shift_assignment SET effective_to = ${from}
    WHERE user_id = ${userId} AND kind = ${kind} AND effective_from < ${from}
      AND (effective_to IS NULL OR effective_to > ${from})
  `);
  return [];
}

export async function insertAssignment(
  tx: Tx,
  a: {
    organizationId: string;
    userId: string;
    kind: AssignmentKind;
    shiftId: string | null;
    rotationId: string | null;
    effectiveFrom: DateOnly;
    effectiveTo: DateOnly | null;
    reason: string | null;
    createdBy: string;
  },
): Promise<string> {
  const row = await tx.one<{ id: string }>(sql`
    INSERT INTO shift_assignment (organization_id, user_id, kind, shift_id, rotation_id, effective_from, effective_to, reason, created_by)
    VALUES (${a.organizationId}, ${a.userId}, ${a.kind}, ${a.shiftId}, ${a.rotationId}, ${a.effectiveFrom},
            ${a.effectiveTo}, ${a.reason}, ${a.createdBy})
    RETURNING id
  `);
  return row.id;
}

export async function insertRotation(
  tx: Tx,
  r: {
    organizationId: string;
    name: string;
    days: ReadonlyMap<number, string | null>;
    createdBy: string;
  },
): Promise<string> {
  const { id } = await tx.one<{ id: string }>(sql`
    INSERT INTO shift_rotation (organization_id, name, created_by)
    VALUES (${r.organizationId}, ${r.name}, ${r.createdBy})
    RETURNING id
  `);
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    await tx.query(sql`
      INSERT INTO shift_rotation_day (organization_id, rotation_id, weekday, shift_id)
      VALUES (${r.organizationId}, ${id}, ${weekday}, ${r.days.get(weekday) ?? null})
    `);
  }
  return id;
}

export async function rotationShiftIds(
  tx: Tx,
  rotationId: string,
): Promise<(string | null)[] | null> {
  const rows = await tx.query<{ shiftId: string | null }>(sql`
    SELECT shift_id FROM shift_rotation_day WHERE rotation_id = ${rotationId} ORDER BY weekday
  `);
  return rows.length === 0 ? null : rows.map((row) => row.shiftId);
}

/** One override per person per date: a new one replaces the old. */
export async function replaceOverride(
  tx: Tx,
  o: {
    organizationId: string;
    userId: string;
    workDate: DateOnly;
    kind: 'shift' | 'flexible' | 'no-shift';
    shiftId: string | null;
    reason: string;
    originRequestId: string | null;
    createdBy: string;
  },
): Promise<void> {
  await tx.query(
    sql`DELETE FROM shift_override WHERE user_id = ${o.userId} AND work_date = ${o.workDate}`,
  );
  await tx.query(sql`
    INSERT INTO shift_override (organization_id, user_id, work_date, kind, shift_id, reason, origin_request_id, created_by)
    VALUES (${o.organizationId}, ${o.userId}, ${o.workDate}, ${o.kind}, ${o.shiftId}, ${o.reason},
            ${o.originRequestId}, ${o.createdBy})
  `);
}

export async function endDepartmentDefaultsFrom(
  tx: Tx,
  departmentId: string,
  from: DateOnly,
): Promise<string[]> {
  const later = await tx.query<{ id: string }>(sql`
    SELECT id FROM department_shift_default WHERE department_id = ${departmentId} AND effective_from >= ${from}
  `);
  if (later.length > 0) return later.map((row) => row.id);
  await tx.query(sql`
    UPDATE department_shift_default SET effective_to = ${from}
    WHERE department_id = ${departmentId} AND effective_from < ${from}
      AND (effective_to IS NULL OR effective_to > ${from})
  `);
  return [];
}

export async function insertDepartmentDefault(
  tx: Tx,
  d: {
    organizationId: string;
    departmentId: string;
    shiftId: string;
    effectiveFrom: DateOnly;
    effectiveTo: DateOnly | null;
    createdBy: string;
  },
): Promise<string> {
  const row = await tx.one<{ id: string }>(sql`
    INSERT INTO department_shift_default (organization_id, department_id, shift_id, effective_from, effective_to, created_by)
    VALUES (${d.organizationId}, ${d.departmentId}, ${d.shiftId}, ${d.effectiveFrom}, ${d.effectiveTo}, ${d.createdBy})
    RETURNING id
  `);
  return row.id;
}

export async function departmentExists(tx: Tx, departmentId: string): Promise<boolean> {
  return (
    (await tx.maybeOne<{ id: string }>(
      sql`SELECT id FROM department WHERE id = ${departmentId}`,
    )) !== null
  );
}

/** People whose department default this is, so an overlap check can be run for each. */
export async function departmentMemberIds(
  tx: Tx,
  departmentId: string,
): Promise<string[]> {
  const rows = await tx.query<{ id: string }>(sql`
    SELECT id FROM app_user WHERE department_id = ${departmentId} AND status = 'active' ORDER BY id
  `);
  return rows.map((row) => row.id);
}

export interface AssignmentListRow {
  id: string;
  userId: string;
  fullName: string;
  kind: AssignmentKind;
  shiftId: string | null;
  rotationId: string | null;
  effectiveFrom: DateOnly;
  effectiveTo: DateOnly | null;
}

/** Assignments running on `date` for the people `visibility` lets the caller see (alias `u`). */
export async function listAssignments(
  tx: Tx,
  date: DateOnly,
  visibility: SqlFragment,
): Promise<AssignmentListRow[]> {
  return tx.query<AssignmentListRow>(sql`
    SELECT a.id, a.user_id, u.full_name, a.kind, a.shift_id, a.rotation_id,
           a.effective_from::text AS effective_from, a.effective_to::text AS effective_to
    FROM shift_assignment a
    JOIN app_user u ON u.organization_id = a.organization_id AND u.id = a.user_id
    WHERE a.effective_from <= ${date} AND (a.effective_to IS NULL OR a.effective_to > ${date})
      AND (${visibility})
    ORDER BY u.full_name, a.kind
  `);
}

/* ------------------------------------------------------------------ *
 * Requests (G3: raising and listing need routes that do not exist yet)
 * ------------------------------------------------------------------ */

export interface RequestRow {
  id: string;
  userId: string;
  kind: 'flexible' | 'change';
  fromDate: DateOnly;
  toDate: DateOnly;
  requestedShiftId: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requestedBy: string;
}

export async function findRequest(tx: Tx, requestId: string): Promise<RequestRow | null> {
  return tx.maybeOne<RequestRow>(sql`
    SELECT id, user_id, kind, from_date::text AS from_date, to_date::text AS to_date,
           requested_shift_id, status, requested_by
    FROM shift_request WHERE id = ${requestId}
    FOR UPDATE
  `);
}

export async function recordDecision(
  tx: Tx,
  d: {
    requestId: string;
    status: 'approved' | 'rejected';
    decidedBy: string;
    note: string | null;
  },
): Promise<void> {
  await tx.query(sql`
    UPDATE shift_request
    SET status = ${d.status}, decided_by = ${d.decidedBy}, decided_at = now(), decision_note = ${d.note}
    WHERE id = ${d.requestId} AND status = 'pending'
  `);
}
```

- [ ] **Create** `packages/server/src/modules/shifts/validators.ts`:

```ts
import { z } from 'zod';
import { toDateOnly, toLocalTime } from '../../platform/time.js';

const date = z.string().transform((value, ctx) => {
  try {
    return toDateOnly(value);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Expected a date, YYYY-MM-DD' });
    return z.NEVER;
  }
});

const time = z.string().transform((value, ctx) => {
  try {
    return toLocalTime(value);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Expected a time, HH:mm' });
    return z.NEVER;
  }
});

const minutes = (max: number) => z.number().int().min(0).max(max);

export const versionSchema = z.object({
  effectiveFrom: date.optional(),
  startTime: time.nullable().default(null),
  endTime: time.nullable().default(null),
  graceMinutes: minutes(240),
  earlyExitGraceMinutes: minutes(240).default(0),
  fullDayMinutes: minutes(1_440),
  halfDayMinutes: minutes(1_440),
  complementaryHalfMinutes: minutes(720).nullable().default(null),
  minOvertimeMinutes: minutes(1_440).nullable().default(null),
  earlyWindowMinutes: minutes(720).default(180),
  maxClosingExtensionMinutes: minutes(720).nullable().default(null),
});

export const createShiftSchema = z.object({
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(120),
  kind: z.enum(['fixed', 'flexible']),
  version: versionSchema,
});

export const reviseShiftSchema = z.union([
  z.object({ status: z.enum(['active', 'inactive']) }).strict(),
  z.object({ version: versionSchema }).strict(),
]);

const reason = z.string().trim().min(1).max(500);
const weekdays = z.object({
  '1': z.string().uuid().nullable(),
  '2': z.string().uuid().nullable(),
  '3': z.string().uuid().nullable(),
  '4': z.string().uuid().nullable(),
  '5': z.string().uuid().nullable(),
  '6': z.string().uuid().nullable(),
  '7': z.string().uuid().nullable(),
});

const period = { effectiveFrom: date, effectiveTo: date.nullable().default(null) };

export const assignmentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('template'),
    userId: z.string().uuid(),
    shiftId: z.string().uuid(),
    reason: reason.optional(),
    ...period,
  }),
  z.object({
    kind: z.literal('rotation'),
    userId: z.string().uuid(),
    rotation: z.union([
      z.object({ id: z.string().uuid() }),
      z.object({ name: z.string().trim().min(1).max(120), days: weekdays }),
    ]),
    reason: reason.optional(),
    ...period,
  }),
  z.object({
    kind: z.literal('permanent-flexible'),
    userId: z.string().uuid(),
    reason: reason.optional(),
    ...period,
  }),
  z.object({
    kind: z.literal('override'),
    userId: z.string().uuid(),
    workDate: date,
    override: z.enum(['shift', 'flexible', 'no-shift']),
    shiftId: z.string().uuid().nullable().default(null),
    reason,
  }),
  z.object({
    kind: z.literal('department-default'),
    departmentId: z.string().uuid(),
    shiftId: z.string().uuid(),
    ...period,
  }),
]);

export const explainQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  from: date.optional(),
  to: date.optional(),
});

export const decideSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(500).nullable().default(null),
});

export type VersionBody = z.infer<typeof versionSchema>;
export type CreateShiftBody = z.infer<typeof createShiftSchema>;
export type ReviseShiftBody = z.infer<typeof reviseShiftSchema>;
export type AssignmentBody = z.infer<typeof assignmentSchema>;
export type DecideBody = z.infer<typeof decideSchema>;
```

- [ ] **Create** `packages/server/src/modules/shifts/policy.ts`:

```ts
import {
  MATCH_NOTHING,
  registerResourcePolicy,
  type PolicyEvaluationContext,
  type Resource,
  type ResourcePolicy,
} from '@tapcrm/authz';
import type { Scope } from '@tapcrm/contracts';

/**
 * Shifts resource policies (AUTHORIZATION.md §6.4: `shift`, `shiftRequest`,
 * people domain).
 *
 * A template has no subject: anyone holding the action may see or manage it.
 * Anything about a person — an assignment, the explorer, a request — is judged
 * by the people scope rules `userPolicy` applies (modules/employee/policy.ts).
 */

async function coversPerson(
  ctx: PolicyEvaluationContext,
  resource: Resource,
  scope: Scope,
): Promise<boolean> {
  if (scope === 'all-people') return true;
  if (scope === 'department') {
    return (
      typeof resource['departmentId'] === 'string' &&
      resource['departmentId'] === (await ctx.scope.departmentId(ctx))
    );
  }
  const userId = resource['userId'];
  if (typeof userId !== 'string') return false; // a department default: department or all-people only
  if (scope === 'own') return userId === ctx.principal.id;
  const teamId = resource['teamId'];
  if (typeof teamId !== 'string') return false;
  if (scope === 'team') return (await ctx.scope.teamIds(ctx)).has(teamId);
  if (scope === 'pool') return (await ctx.scope.poolIds(ctx)).has(teamId);
  return false;
}

/** A list filter over people, alias `u` (app_user), matching `coversPerson`. */
async function peopleFilter(ctx: PolicyEvaluationContext, scope: Scope) {
  if (scope === 'all-people') return { sql: 'TRUE', parameters: [] };
  if (scope === 'own') return { sql: 'u.id = $1', parameters: [ctx.principal.id] };
  if (scope === 'department') {
    const departmentId = await ctx.scope.departmentId(ctx);
    return departmentId === null
      ? MATCH_NOTHING
      : { sql: 'u.department_id = $1', parameters: [departmentId] };
  }
  if (scope === 'team' || scope === 'pool') {
    const teams = [
      ...(scope === 'team' ? await ctx.scope.teamIds(ctx) : await ctx.scope.poolIds(ctx)),
    ];
    return teams.length === 0
      ? MATCH_NOTHING
      : { sql: 'u.team_id = ANY($1::uuid[])', parameters: [teams] };
  }
  return MATCH_NOTHING;
}

export const shiftPolicy: ResourcePolicy = {
  resourceType: 'shift',
  domain: 'people',
  async check(ctx, _action, resource, scope) {
    if (resource['organizationId'] !== ctx.organizationId) return false;
    const aboutSomeone =
      typeof resource['userId'] === 'string' ||
      typeof resource['departmentId'] === 'string';
    return aboutSomeone ? coversPerson(ctx, resource, scope) : true;
  },
  filter: (ctx, _action, scope) => peopleFilter(ctx, scope),
  participantFields: () => [],
  initiatorField: () => null,
};

export const shiftRequestPolicy: ResourcePolicy = {
  resourceType: 'shiftRequest',
  domain: 'people',
  async check(ctx, _action, resource, scope) {
    if (resource['organizationId'] !== ctx.organizationId) return false;
    return coversPerson(ctx, resource, scope);
  },
  filter: (ctx, _action, scope) => peopleFilter(ctx, scope),
  participantFields: () => ['requestedBy'],
  // A1 / SH-7 — nobody approves a request they raised.
  initiatorField: (action) => (action === 'shifts:approve' ? 'requestedBy' : null),
};

export function registerShiftPolicies(): void {
  registerResourcePolicy(shiftPolicy);
  registerResourcePolicy(shiftRequestPolicy);
}
```

- [ ] **Create** `packages/server/src/modules/shifts/service.ts`:

```ts
import { authorize, holdsPolicy, visibilityFilter, type Resource } from '@tapcrm/authz';
import type { DateOnly, ResolvedShift } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { organizationToday } from '../../platform/organization-time.js';
import { addDays, daysBetween, systemClock, type Clock } from '../../platform/time.js';
import {
  SHIFT_ERROR_CODES,
  ShiftConflictError,
  ShiftForbiddenError,
  ShiftNotFoundError,
  ShiftValidationError,
} from './errors.js';
import { recordDaysChanged } from './events.js';
import * as repo from './repository.js';
import { resolveShift, type AssignmentInput, type ShiftInputs } from './resolve.js';
import { findWindowOverlaps, validateVersion } from './rules.js';
import type {
  AssignmentBody,
  CreateShiftBody,
  DecideBody,
  ReviseShiftBody,
  VersionBody,
} from './validators.js';
import { dayWindow } from './windows.js';

/** The explorer answers at most this many days at a time. */
export const EXPLAIN_MAX_DAYS = 62;

/* ------------------------------------------------------------------ *
 * Shared checks
 * ------------------------------------------------------------------ */

/**
 * SH-6 — a change that takes effect before today (the organization's date)
 * rewrites days already worked, so it needs `attendance:correct` as well.
 */
async function assertMayChangeFrom(
  ctx: RequestContext,
  tx: Tx,
  from: DateOnly,
  clock: Clock,
): Promise<void> {
  if (from >= (await organizationToday(tx, clock))) return;
  if (await holdsPolicy(ctx, 'attendance:correct')) return;
  throw new ShiftForbiddenError(
    SHIFT_ERROR_CODES.PAST_CHANGE_NEEDS_CORRECTION_AUTHORITY,
    'This change starts before today. Changing days already worked also needs attendance:correct (SH-6).',
  );
}

function subjectResource(ctx: RequestContext, subject: repo.Subject): Resource {
  return {
    type: 'shift',
    id: subject.id,
    organizationId: ctx.organizationId,
    userId: subject.id,
    teamId: subject.teamId,
    departmentId: subject.departmentId,
  };
}

/** The person must exist, and be inside the caller's scope for `action`. */
async function loadSubject(
  ctx: RequestContext,
  tx: Tx,
  userId: string,
  action: 'shifts:view' | 'shifts:manage',
) {
  const subject = await repo.findSubject(tx, userId);
  if (subject === null)
    throw new ShiftNotFoundError('No such person in this organization.');
  await authorize(ctx, action, subjectResource(ctx, subject));
  return subject;
}

async function assertAssignable(tx: Tx, shiftId: string): Promise<void> {
  const shift = await repo.findShift(tx, shiftId);
  if (shift === null) throw new ShiftNotFoundError('No such shift template.');
  // SH-5: inactive templates cannot be newly assigned; existing assignments keep resolving.
  if (shift.status !== 'active') {
    throw new ShiftValidationError(
      SHIFT_ERROR_CODES.INACTIVE,
      `Shift ${shift.code} is inactive and cannot be assigned.`,
    );
  }
  if (!(await repo.hasVersion(tx, shiftId))) {
    throw new ShiftValidationError(
      SHIFT_ERROR_CODES.NO_VERSION,
      `Shift ${shift.code} has no version yet.`,
    );
  }
}

/** §6.3 "No overlap" — refuse a change that makes two consecutive shifts overlap. */
function assertNoOverlap(inputs: ShiftInputs, from: DateOnly, to: DateOnly | null): void {
  const overlaps = findWindowOverlaps(inputs, from, to);
  if (overlaps.length === 0) return;
  const first = overlaps[0]!;
  throw new ShiftValidationError(
    SHIFT_ERROR_CODES.WINDOW_OVERLAP,
    `On ${first.date} this shift would start ${first.overlapMinutes} minutes before the previous day's shift ends.`,
    { overlaps },
  );
}

/** The person's inputs with a proposed assignment in place, for the overlap check. */
function withAssignment(
  inputs: ShiftInputs,
  next: AssignmentInput,
  rotationDays?: ReadonlyMap<number, string | null>,
): ShiftInputs {
  const assignments = inputs.assignments
    .filter((row) => row.kind !== next.kind || row.effectiveFrom < next.effectiveFrom)
    .map((row) =>
      row.kind === next.kind &&
      (row.effectiveTo === null || row.effectiveTo > next.effectiveFrom)
        ? { ...row, effectiveTo: next.effectiveFrom }
        : row,
    );
  const rotations = new Map(inputs.rotations);
  if (rotationDays !== undefined && next.rotationId !== null)
    rotations.set(next.rotationId, rotationDays);
  return { ...inputs, assignments: [...assignments, next], rotations };
}

function checkRange(to: DateOnly | null, from: DateOnly): DateOnly {
  return to === null ? addDays(from, 7) : addDays(to, -1);
}

/* ------------------------------------------------------------------ *
 * Templates
 * ------------------------------------------------------------------ */

export async function listShiftTemplates(
  ctx: RequestContext,
  clock: Clock = systemClock,
) {
  return db.transaction(ctx, async (tx) =>
    repo.listShifts(tx, await organizationToday(tx, clock)),
  );
}

function versionFields(kind: 'fixed' | 'flexible', body: VersionBody) {
  validateVersion({ kind, ...body });
  return body;
}

export async function createShift(
  ctx: RequestContext,
  body: CreateShiftBody,
  clock: Clock = systemClock,
) {
  const version = versionFields(body.kind, body.version);
  return db.transaction(ctx, async (tx) => {
    const effectiveFrom = version.effectiveFrom ?? (await organizationToday(tx, clock));
    await assertMayChangeFrom(ctx, tx, effectiveFrom, clock);
    const shiftId = await repo.insertShift(tx, {
      organizationId: ctx.organizationId,
      code: body.code,
      name: body.name,
      kind: body.kind,
      createdBy: ctx.principal.id,
    });
    if (shiftId === null) {
      throw new ShiftConflictError(
        SHIFT_ERROR_CODES.CODE_TAKEN,
        `A shift with code ${body.code} already exists.`,
      );
    }
    await repo.insertVersion(tx, {
      ...version,
      organizationId: ctx.organizationId,
      shiftId,
      effectiveFrom,
      createdBy: ctx.principal.id,
    });
    return { id: shiftId, effectiveFrom };
  });
}

/**
 * PATCH /api/shifts/:id — a new version from its effective date (default
 * tomorrow), or a status change. Nothing before the date changes (SH-2).
 */
export async function reviseShift(
  ctx: RequestContext,
  shiftId: string,
  body: ReviseShiftBody,
  clock: Clock = systemClock,
) {
  return db.transaction(ctx, async (tx) => {
    const shift = await repo.findShift(tx, shiftId);
    if (shift === null) throw new ShiftNotFoundError('No such shift template.');
    if ('status' in body) {
      await repo.setShiftStatus(tx, shiftId, body.status);
      return { id: shiftId, status: body.status };
    }
    const version = versionFields(shift.kind, body.version);
    const effectiveFrom =
      version.effectiveFrom ?? addDays(await organizationToday(tx, clock), 1);
    await assertMayChangeFrom(ctx, tx, effectiveFrom, clock);
    const inserted = await repo.insertVersion(tx, {
      ...version,
      organizationId: ctx.organizationId,
      shiftId,
      effectiveFrom,
      createdBy: ctx.principal.id,
    });
    if (!inserted) {
      throw new ShiftConflictError(
        SHIFT_ERROR_CODES.VERSION_EXISTS,
        `Shift ${shift.code} already has a version starting ${effectiveFrom}.`,
      );
    }
    await recordDaysChanged(tx, ctx.organizationId, {
      shiftId,
      from: effectiveFrom,
      to: null,
      reason: 'shift version',
    });
    return { id: shiftId, effectiveFrom };
  });
}

/* ------------------------------------------------------------------ *
 * Assignments — POST /api/shifts/assignments
 * ------------------------------------------------------------------ */

export async function assign(
  ctx: RequestContext,
  body: AssignmentBody,
  clock: Clock = systemClock,
) {
  return db.transaction(ctx, async (tx) => {
    if (body.kind === 'department-default') {
      if (!(await repo.departmentExists(tx, body.departmentId)))
        throw new ShiftNotFoundError('No such department.');
      await authorize(ctx, 'shifts:manage', {
        type: 'shift',
        id: body.departmentId,
        organizationId: ctx.organizationId,
        departmentId: body.departmentId,
      });
      await assertMayChangeFrom(ctx, tx, body.effectiveFrom, clock);
      await assertAssignable(tx, body.shiftId);
      const later = await repo.endDepartmentDefaultsFrom(
        tx,
        body.departmentId,
        body.effectiveFrom,
      );
      if (later.length > 0) {
        throw new ShiftConflictError(
          SHIFT_ERROR_CODES.ASSIGNMENT_CONFLICT,
          'A later default already exists for this department.',
          { ids: later },
        );
      }
      // A default changed under existing assignments can still meet an overlap;
      // the resolver flags that day at read time (§5.2).
      const id = await repo.insertDepartmentDefault(tx, {
        organizationId: ctx.organizationId,
        departmentId: body.departmentId,
        shiftId: body.shiftId,
        effectiveFrom: body.effectiveFrom,
        effectiveTo: body.effectiveTo,
        createdBy: ctx.principal.id,
      });
      await recordDaysChanged(tx, ctx.organizationId, {
        departmentId: body.departmentId,
        from: body.effectiveFrom,
        to: body.effectiveTo === null ? null : addDays(body.effectiveTo, -1),
        reason: 'department default',
      });
      return { id };
    }

    await loadSubject(ctx, tx, body.userId, 'shifts:manage');

    if (body.kind === 'override') {
      await assertMayChangeFrom(ctx, tx, body.workDate, clock);
      if (body.override === 'shift') {
        if (body.shiftId === null) {
          throw new ShiftValidationError(
            SHIFT_ERROR_CODES.OVERRIDE_NEEDS_SHIFT,
            'A shift override names the shift.',
          );
        }
        await assertAssignable(tx, body.shiftId);
      }
      const shiftId = body.override === 'shift' ? body.shiftId : null;
      const inputs = await repo.loadShiftInputs(
        tx,
        body.userId,
        addDays(body.workDate, -1),
        addDays(body.workDate, 1),
      );
      assertNoOverlap(
        {
          ...inputs,
          overrides: [
            ...inputs.overrides.filter((row) => row.workDate !== body.workDate),
            { workDate: body.workDate, kind: body.override, shiftId },
          ],
        },
        body.workDate,
        body.workDate,
      );
      await repo.replaceOverride(tx, {
        organizationId: ctx.organizationId,
        userId: body.userId,
        workDate: body.workDate,
        kind: body.override,
        shiftId,
        reason: body.reason,
        originRequestId: null,
        createdBy: ctx.principal.id,
      });
      await recordDaysChanged(tx, ctx.organizationId, {
        userIds: [body.userId],
        from: body.workDate,
        to: body.workDate,
        reason: 'date override',
      });
      return { userId: body.userId, workDate: body.workDate };
    }

    await assertMayChangeFrom(ctx, tx, body.effectiveFrom, clock);
    let shiftId: string | null = null;
    let rotationId: string | null = null;
    let rotationDays: Map<number, string | null> | undefined;
    if (body.kind === 'template') {
      await assertAssignable(tx, body.shiftId);
      shiftId = body.shiftId;
    }
    if (body.kind === 'rotation') {
      if ('id' in body.rotation) {
        const days = await repo.rotationShiftIds(tx, body.rotation.id);
        if (days === null) throw new ShiftNotFoundError('No such rotation.');
        rotationId = body.rotation.id;
        rotationDays = new Map(days.map((id, index) => [index + 1, id]));
      } else {
        rotationDays = new Map(
          Object.entries(body.rotation.days).map(([weekday, id]) => [
            Number(weekday),
            id,
          ]),
        );
        for (const id of new Set(rotationDays.values()))
          if (id !== null) await assertAssignable(tx, id);
        rotationId = await repo.insertRotation(tx, {
          organizationId: ctx.organizationId,
          name: body.rotation.name,
          days: rotationDays,
          createdBy: ctx.principal.id,
        });
      }
    }

    const next: AssignmentInput = {
      kind: body.kind,
      shiftId,
      rotationId,
      effectiveFrom: body.effectiveFrom,
      effectiveTo: body.effectiveTo,
    };
    const lastChecked = checkRange(body.effectiveTo, body.effectiveFrom);
    const inputs = await repo.loadShiftInputs(
      tx,
      body.userId,
      addDays(body.effectiveFrom, -1),
      lastChecked,
    );
    assertNoOverlap(
      withAssignment(inputs, next, rotationDays),
      body.effectiveFrom,
      lastChecked,
    );

    const later = await repo.endAssignmentsFrom(
      tx,
      body.userId,
      body.kind,
      body.effectiveFrom,
    );
    if (later.length > 0) {
      throw new ShiftConflictError(
        SHIFT_ERROR_CODES.ASSIGNMENT_CONFLICT,
        'This person already has a later assignment of this kind. Change that one instead.',
        { ids: later },
      );
    }
    const id = await repo.insertAssignment(tx, {
      organizationId: ctx.organizationId,
      userId: body.userId,
      kind: body.kind,
      shiftId,
      rotationId,
      effectiveFrom: body.effectiveFrom,
      effectiveTo: body.effectiveTo,
      reason: body.reason ?? null,
      createdBy: ctx.principal.id,
    });
    await recordDaysChanged(tx, ctx.organizationId, {
      userIds: [body.userId],
      from: body.effectiveFrom,
      to: body.effectiveTo === null ? null : addDays(body.effectiveTo, -1),
      reason: `${body.kind} assignment`,
    });
    return { id, rotationId };
  });
}

/* ------------------------------------------------------------------ *
 * The "why this shift" explorer — GET /api/shifts/assignments
 * ------------------------------------------------------------------ */

export interface ExplainedDay extends ResolvedShift {
  readonly window: {
    readonly start: string;
    readonly end: string;
    readonly overlap: boolean;
    readonly anchor: string;
  };
}

export async function explainShifts(
  ctx: RequestContext,
  query: {
    userId?: string | undefined;
    from?: DateOnly | undefined;
    to?: DateOnly | undefined;
  },
  clock: Clock = systemClock,
) {
  return db.transaction(ctx, async (tx) => {
    const today = await organizationToday(tx, clock);
    if (query.userId === undefined) {
      // Without a person: the assignments running on the date, for the people in scope.
      const visibility = await visibilityFilter(ctx, 'shifts:view', 'shift');
      return {
        assignments: await repo.listAssignments(tx, query.from ?? today, visibility),
      };
    }
    await loadSubject(ctx, tx, query.userId, 'shifts:view');
    const from = query.from ?? today;
    const to = query.to ?? from;
    if (to < from || daysBetween(from, to) >= EXPLAIN_MAX_DAYS) {
      throw new ShiftValidationError(
        SHIFT_ERROR_CODES.RANGE_TOO_LONG,
        `Ask for 1 to ${EXPLAIN_MAX_DAYS} days at a time.`,
      );
    }
    const inputs = await repo.loadShiftInputs(tx, query.userId, from, to);
    const days: ExplainedDay[] = [];
    for (let date = from; date <= to; date = addDays(date, 1)) {
      const window = dayWindow(inputs, date);
      days.push({
        ...resolveShift(inputs, date),
        window: {
          start: window.start.toISOString(),
          end: window.end.toISOString(),
          overlap: window.overlap,
          anchor: window.shape.anchor,
        },
      });
    }
    return { userId: query.userId, days };
  });
}

/* ------------------------------------------------------------------ *
 * Requests — POST /api/shifts/requests/:id/decide
 * ------------------------------------------------------------------ */

/**
 * The framework has already authorized `shifts:approve` on the request,
 * including A1 through `requestedBy` (SH-7). An approved change becomes date
 * overrides that point back at the request (L15); an approved flexible request
 * is read by the resolver directly.
 */
export async function decideRequest(
  ctx: RequestContext,
  requestId: string,
  body: DecideBody,
  clock: Clock = systemClock,
) {
  return db.transaction(ctx, async (tx) => {
    const request = await repo.findRequest(tx, requestId);
    if (request === null) throw new ShiftNotFoundError('No such shift request.');
    if (request.status !== 'pending') {
      throw new ShiftConflictError(
        SHIFT_ERROR_CODES.REQUEST_NOT_PENDING,
        `This request is already ${request.status}.`,
      );
    }
    if (body.decision === 'reject') {
      await repo.recordDecision(tx, {
        requestId,
        status: 'rejected',
        decidedBy: ctx.principal.id,
        note: body.note,
      });
      return { id: requestId, status: 'rejected' as const };
    }

    await assertMayChangeFrom(ctx, tx, request.fromDate, clock);
    if (request.kind === 'change' && request.requestedShiftId !== null) {
      await assertAssignable(tx, request.requestedShiftId);
      const inputs = await repo.loadShiftInputs(
        tx,
        request.userId,
        request.fromDate,
        request.toDate,
      );
      const dates: DateOnly[] = [];
      for (let date = request.fromDate; date <= request.toDate; date = addDays(date, 1))
        dates.push(date);
      assertNoOverlap(
        {
          ...inputs,
          overrides: [
            ...inputs.overrides.filter((row) => !dates.includes(row.workDate)),
            ...dates.map((workDate) => ({
              workDate,
              kind: 'shift' as const,
              shiftId: request.requestedShiftId,
            })),
          ],
        },
        request.fromDate,
        request.toDate,
      );
      for (const workDate of dates) {
        await repo.replaceOverride(tx, {
          organizationId: ctx.organizationId,
          userId: request.userId,
          workDate,
          kind: 'shift',
          shiftId: request.requestedShiftId,
          reason: `Approved shift change request ${requestId}`,
          originRequestId: requestId,
          createdBy: ctx.principal.id,
        });
      }
    }
    await repo.recordDecision(tx, {
      requestId,
      status: 'approved',
      decidedBy: ctx.principal.id,
      note: body.note,
    });
    await recordDaysChanged(tx, ctx.organizationId, {
      userIds: [request.userId],
      from: request.fromDate,
      to: request.toDate,
      reason: `${request.kind} request approved`,
    });
    return { id: requestId, status: 'approved' as const };
  });
}
```

- [ ] **Run the test again.** Expected: `Tests  8 passed (8)`.

Checkpoint: leave the changes in the working tree for review.

---

## Task 7 — The façade and the routes

The façade is what attendance, live-status, holidays, break-management and
payroll will call, each passing its own transaction. The six routes are exactly
the ones AUTHORIZATION.md §6.5 lists.

- [ ] **Create** `packages/server/src/modules/shifts/facade.ts`:

```ts
/**
 * The shifts façade — the only file other modules may import (MB-1, design §4).
 *
 * Synchronous, and every function takes the caller's transaction (MB-2, TX-5).
 * Callers: attendance, live-status, break-management, holidays, payroll.
 * Geometry only: which shift applied and where a day's window lies. Which day
 * an event belongs to is attendance's `attributeEvent` (§5.2).
 */
import type { DateOnly, ResolvedShift } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { addDays, localDateOf } from '../../platform/time.js';
import { loadShiftInputs } from './repository.js';
import { resolveShift } from './resolve.js';
import {
  dayWindow as windowOf,
  dayWindowContaining as windowContaining,
  type DayWindow,
} from './windows.js';

export type { DayWindow } from './windows.js';
export { SHIFT_EVENTS, type DaysChanged } from './events.js';

/** SH-1 — the shift that applied to the person on the date, and why. */
export async function resolve(
  tx: Tx,
  userId: string,
  date: DateOnly,
): Promise<ResolvedShift> {
  return resolveShift(await loadShiftInputs(tx, userId, date, date), date);
}

/** SH-1 for every date from `from` to `to`, inclusive, with one read. */
export async function resolveRange(
  tx: Tx,
  userId: string,
  from: DateOnly,
  to: DateOnly,
): Promise<ResolvedShift[]> {
  const inputs = await loadShiftInputs(tx, userId, from, to);
  const days: ResolvedShift[] = [];
  for (let date = from; date <= to; date = addDays(date, 1))
    days.push(resolveShift(inputs, date));
  return days;
}

/** SH-I1 — the day's window: from the midpoint before it to the midpoint after it. */
export async function dayWindow(
  tx: Tx,
  userId: string,
  date: DateOnly,
): Promise<DayWindow> {
  return windowOf(await loadShiftInputs(tx, userId, date, date), date);
}

/** The day whose window holds the instant. */
export async function dayWindowContaining(
  tx: Tx,
  userId: string,
  instant: Date,
): Promise<DayWindow> {
  const inputs = await loadShiftInputs(
    tx,
    userId,
    addDays(localDateOfUtc(instant), -1),
    addDays(localDateOfUtc(instant), 1),
  );
  return windowContaining(inputs, instant);
}

/** The inputs load a margin of days either side, so the UTC date is close enough to pick the range. */
function localDateOfUtc(instant: Date): DateOnly {
  return localDateOf(instant, 'UTC');
}
```

- [ ] **Create** `packages/server/src/modules/shifts/routes.ts`:

```ts
import type { Resource } from '@tapcrm/authz';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { route } from '../../platform/http/route.js';
import { sql } from '../../platform/dal/sql.js';
import {
  assign,
  createShift,
  decideRequest,
  explainShifts,
  listShiftTemplates,
  reviseShift,
} from './service.js';
import {
  assignmentSchema,
  createShiftSchema,
  decideSchema,
  explainQuerySchema,
  reviseShiftSchema,
} from './validators.js';

/** Design §6.4 — the six bindings AUTHORIZATION.md §6.5 lists. Raising and listing requests wait for G3. */

async function loadShift(ctx: RequestContext, id: string): Promise<Resource | null> {
  return db.maybeOne<Resource>(
    ctx,
    sql`
    SELECT 'shift' AS type, id, organization_id AS "organizationId" FROM shift WHERE id = ${id}
  `,
  );
}

async function loadShiftRequest(
  ctx: RequestContext,
  id: string,
): Promise<Resource | null> {
  return db.maybeOne<Resource>(
    ctx,
    sql`
    SELECT 'shiftRequest' AS type, r.id, r.organization_id AS "organizationId", r.user_id AS "userId",
           u.team_id AS "teamId", u.department_id AS "departmentId",
           r.requested_by AS "requestedBy", r.status
    FROM shift_request r
    JOIN app_user u ON u.organization_id = r.organization_id AND u.id = r.user_id
    WHERE r.id = ${id}
  `,
  );
}

export function registerShiftRoutes(): void {
  route({
    method: 'GET',
    path: '/api/shifts',
    action: 'shifts:view',
    module: 'shifts',
    handler: async ({ ctx }) => listShiftTemplates(ctx),
  });

  route({
    method: 'POST',
    path: '/api/shifts',
    action: 'shifts:manage',
    module: 'shifts',
    handler: async ({ ctx, body }) => createShift(ctx, createShiftSchema.parse(body)),
  });

  route({
    method: 'PATCH',
    path: '/api/shifts/:id',
    action: 'shifts:manage',
    module: 'shifts',
    resourceParam: 'id',
    loadResource: loadShift,
    handler: async ({ ctx, params, body }) =>
      reviseShift(ctx, params['id']!, reviseShiftSchema.parse(body)),
  });

  route({
    method: 'GET',
    path: '/api/shifts/assignments',
    action: 'shifts:view',
    module: 'shifts',
    handler: async ({ ctx, query }) =>
      explainShifts(ctx, explainQuerySchema.parse(query)),
  });

  route({
    method: 'POST',
    path: '/api/shifts/assignments',
    action: 'shifts:manage',
    module: 'shifts',
    handler: async ({ ctx, body }) => assign(ctx, assignmentSchema.parse(body)),
  });

  route({
    method: 'POST',
    path: '/api/shifts/requests/:id/decide',
    action: 'shifts:approve',
    module: 'shifts',
    resourceParam: 'id',
    loadResource: loadShiftRequest,
    status: 200,
    handler: async ({ ctx, params, body }) =>
      decideRequest(ctx, params['id']!, decideSchema.parse(body)),
  });
}
```

- [ ] **Register them** in `packages/server/src/modules/index.ts`:

```diff
--- a/packages/server/src/modules/index.ts
+++ b/packages/server/src/modules/index.ts
@@ -8,6 +8,8 @@ import { registerIdentityRoutes } from './identity/routes.js';
 import { registerAccessManagementRoutes } from './access-management/routes.js';
 import { registerAuditPolicies } from './audit/policy.js';
 import { registerAuditRoutes } from './audit/routes.js';
+import { registerShiftPolicies } from './shifts/policy.js';
+import { registerShiftRoutes } from './shifts/routes.js';
 import { registerIdentityJobs } from './identity/jobs.js';
 import { registerAccessManagementJobs } from './access-management/jobs.js';
 import { registerAuditJobs } from './audit/jobs.js';
@@ -28,6 +30,7 @@ export function registerAllPolicies(): void {
   registerEmployeePolicies();
   registerGeofencePolicies();
   registerAuditPolicies();
+  registerShiftPolicies();
 }
 
 export function registerAllRoutes(): void {
@@ -37,6 +40,7 @@ export function registerAllRoutes(): void {
   registerEmployeeRoutes();
   registerGeofenceRoutes();
   registerAuditRoutes();
+  registerShiftRoutes();
 }
 
 let jobsRegistered = false;
```

- [ ] **Check:**

```bash
npm run typecheck && npm run lint && npm run ci
```

Expected: `npm run ci` shows `✓ CI-2 …` unchanged in status, with 6 more
bindings implemented ("55 of 305"), and 16 checks passed. Starting the API
(`npm run dev:api`) logs no manifest errors.

Checkpoint: leave the changes in the working tree for review.

---

## Task 8 — CI: only the shifts module touches the shift tables (§6.2, SH-1)

- [ ] **Write the test** — `tools/ci/tables.test.ts`:

```ts
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findForeignTableUse } from './tables.js';

const ROOT = '/repo';
const file = (path: string, text: string) => ({ path: resolve(ROOT, path), text });

describe('SH-1 — only shifts reads the shift tables (design §6.2)', () => {
  it('flags another module reading shift_assignment', () => {
    const found = findForeignTableUse(
      [
        file(
          'packages/server/src/modules/attendance/repository.ts',
          'sql`SELECT * FROM shift_assignment WHERE …`',
        ),
      ],
      ROOT,
    );
    expect(found).toEqual([
      {
        file: 'packages/server/src/modules/attendance/repository.ts',
        line: 1,
        table: 'shift_assignment',
        owner: 'shifts',
      },
    ]);
  });

  it('flags platform code too', () => {
    const found = findForeignTableUse(
      [file('packages/server/src/platform/report.ts', 'JOIN shift s ON')],
      ROOT,
    );
    expect(found).toHaveLength(1);
  });

  it('lets shifts use its own tables, and tests seed anything', () => {
    expect(
      findForeignTableUse(
        [
          file(
            'packages/server/src/modules/shifts/repository.ts',
            'INSERT INTO shift_version',
          ),
          file(
            'packages/server/src/modules/attendance/day.test.ts',
            'INSERT INTO shift_override',
          ),
        ],
        ROOT,
      ),
    ).toEqual([]);
  });

  it('ignores prose and other tables', () => {
    expect(
      findForeignTableUse(
        [
          file(
            'packages/server/src/modules/leave/service.ts',
            '// read from shift settings\nFROM leave_request',
          ),
        ],
        ROOT,
      ),
    ).toEqual([]);
  });
});
```

- [ ] **Run it and watch it fail** — expected: `Error: Failed to load url ./tables.js … Does the file exist?`

- [ ] **Create** `tools/ci/tables.ts`:

```ts
import { relative } from 'node:path';
import { locateInModule, type SourceFile } from './boundary.js';

/**
 * Table ownership — attendance design §6.2 ("no other module reads the shift*
 * tables"), SH-1.
 *
 * A module's tables are read and written by that module alone; everyone else
 * asks its façade. Tests may seed any table.
 */

export const TABLE_OWNERS: readonly {
  readonly module: string;
  readonly tables: RegExp;
}[] = [{ module: 'shifts', tables: /^(shift|shift_[a-z_]+|department_shift_default)$/ }];

export interface TableViolation {
  readonly file: string;
  readonly line: number;
  readonly table: string;
  readonly owner: string;
}

/** SQL keywords are upper case in this codebase, which keeps prose out of the net. */
const TABLE_REFERENCE = /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+([a-z_][a-z0-9_]*)/g;

export function findForeignTableUse(
  files: readonly SourceFile[],
  root: string,
): TableViolation[] {
  const violations: TableViolation[] = [];
  for (const file of files) {
    if (file.path.endsWith('.test.ts')) continue;
    const module = locateInModule(root, file.path)?.module ?? null;
    for (const match of file.text.matchAll(TABLE_REFERENCE)) {
      const table = match[1]!;
      const owner = TABLE_OWNERS.find((candidate) => candidate.tables.test(table));
      if (owner === undefined || owner.module === module) continue;
      violations.push({
        file: relative(root, file.path),
        line: file.text.slice(0, match.index).split('\n').length,
        table,
        owner: owner.module,
      });
    }
  }
  return violations;
}
```

- [ ] **Use it** in `tools/ci/index.ts`:

```diff
--- a/tools/ci/index.ts
+++ b/tools/ci/index.ts
@@ -25,6 +25,7 @@ import { resolve, dirname, relative, join } from 'node:path';
 import { fileURLToPath, pathToFileURL } from 'node:url';
 import { findBoundaryViolations } from './boundary.js';
 import { findDateShortcuts, findTimeLibraryImports } from './time-rules.js';
+import { findForeignTableUse } from './tables.js';
 
 const HERE = dirname(fileURLToPath(import.meta.url));
 const ROOT = resolve(HERE, '../..');
@@ -312,6 +313,22 @@ const POLICY_FILTER = /^[ \t]*(?:async\s+)?filter\s*\(/m;
   if (libraries.length === 0) ok('T-4    one date library, imported only by platform/time.ts');
 }
 
+/* ================================================================== *
+ * SH-1 — a module's tables belong to it (attendance design §6.2)
+ *
+ * Only `shifts` reads the shift tables; everyone else asks ShiftsFacade.
+ * ================================================================== */
+{
+  const violations = findForeignTableUse(
+    serverFiles.map((file) => ({ path: file, text: read(file) })),
+    ROOT,
+  );
+  for (const v of violations) {
+    blocking('SH-1', 'SH-1', `${v.file}:${v.line} uses ${v.table}, which belongs to ${v.owner}. Use its facade.`);
+  }
+  if (violations.length === 0) ok('SH-1   shift tables read only by the shifts module');
+}
+
 /* ================================================================== *
  * CI-20 — no interpolated user-controlled SQL
  * ================================================================== */
```

- [ ] **Run** `npx vitest run tools/ci/tables.test.ts` (expected `Tests  4 passed (4)`) and
  `npm run ci` (expected `✓ SH-1   shift tables read only by the shifts module`).

Checkpoint: leave the changes in the working tree for review.

---

## Task 9 — Final check

```bash
npm run typecheck
npm run lint
npm run ci
npx vitest run --exclude '**/overrides.integration.test.ts'
```

Expected: typecheck and lint clean, `✓ 16 check(s) passed`, and every test
passes — the shift tests add 13 + 11 + 8 unit tests, 8 database tests and 4
CI-rule tests.

Then review the working tree (`git status`, `git diff`). Nothing has been committed.

---

## What step 3 picks up from here

- A handler for `shifts.days-changed`. It runs `refreshDayFacts` for the
  changed days and their neighbours, then queues recalculation (§6.3 "Day facts
  rebuild", SH-6).
- The `shift-window-overlap` flag, for days whose window reports `overlap`.
- Lateness, early exit and "no double counting" for the 20:00–05:00 night, in
  the calculator.
