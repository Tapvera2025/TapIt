# Step 3c — Attendance day-open, overlays, API and export: implementation plan

**Design.** `docs/superpowers/specs/2026-09-22-attendance-shifts-payroll-design.md`
§8.6 (day-open), §8.7 (API), §8.1 (`attendance_day_open_state`, overlays),
§5.4 (jobs), §14.4 (payroll's day-count check that day-open's second guard
protects), and AT-12 / AT-13.
**Roadmap.** `docs/superpowers/plans/2026-09-25-attendance-roadmap.md`.
**Builds on.** Steps 0, 1, 2, 3a and 3b, as they are in the working tree on
`Archi`.

## What 3c adds

3a records punches on the right day. 3b turns each day into an answer and
keeps that answer current. 3c makes sure every day exists in the first place
(nobody's calendar has a hole), lets leave and break-management change a
day's answer through one seam, and gives the outside world three routes to
read the answer.

Three promises hold throughout:

- **Every date inside a person's employment has exactly one record.**
  Whether a punch arrived, a leave was applied, or nothing at all happened,
  the row is there. Payroll counts records and expects the right number
  (§14.4); a hole would be read as "no data," not as "day nobody judged."
- **Day-open is safe to run twice.** It upserts. The record a punch already
  created is filled in, not overwritten. Advancing the watermark never
  passes a date the run could not complete.
- **Overlays go through one seam.** Leave (step 6) and break-management
  (step 8) never write `attendance_record` themselves. They call
  `applyOverlay` / `removeOverlays`, which stores the overlay row, bumps
  the day's input version, and queues recalculation the same way §8.5 does.

How the pieces fit:

```
day-open cron (00:05 org time)
   │ per organization: pick materialised_through, pick today
   │ for each active person, upsert one attendance_record per date,
   │ set attribution flags, apply existing overlays, queue recalculation
   ▼
guard A: refuse to advance materialised_through past a date any run failed on
guard B: payroll's day-count check (§14.4) — enforced by payroll in step 9

applyOverlay(tx, sourceKind, sourceId, {userId, dates, ...})
   │ inserts one attendance_overlay row per date, bumps each day's
   │ input_version, writes attendance.recalc-requested per person
   ▼
step 3b's recalculation path runs each day

GET /api/attendance                 → the range's records for the caller's scope
GET /api/attendance/:userId/:date   → one day's detail (record + events + corrections + shift + leave/holiday/WFH)
POST /api/attendance/export         → a background job that streams a range to storage and returns a signed link
```

**Done when** — each proved by a named test:

| Check | Test |
|---|---|
| Day-open creates one record per active person per date, forward from the watermark | `day-open.integration.test.ts` › "creates one record per active person per date, advancing the watermark" |
| Day-open is idempotent: running twice changes nothing observable | › "running twice writes the same records and the same recalc events" |
| Guard A: a person's failure does not advance the watermark past that date | › "leaves the watermark short of a date that had a failure" |
| Guard A holds under concurrent runs (per-organization lease) | › "concurrent run cannot race the watermark past a failed date" |
| A punch that landed first is filled in, not overwritten | › "leaves an existing record's inputs alone and completes its facts" |
| `applyOverlay` bumps the day and queues recalculation exactly once — even when it materialises the record inline (no double event) | `overlays.integration.test.ts` › "applies one overlay, bumps the day, and queues recalculation exactly once" |
| `removeOverlays(sourceId)` removes every overlay from that source and requeues | › "removes overlays by source and requeues each day" |
| `GET /api/attendance` scope-filters and refuses over 92 days (AT-13) | `attendance-api.integration.test.ts` › "AT-13: over 92 days is 422 ATTENDANCE_RANGE_TOO_LONG" |
| `GET /api/attendance/:userId/:date` composes the day detail (AT-12) | › "AT-12: day detail returns record + events + shift source" |
| The `attendanceRecord` policy mirrors `userPolicy` | `attendance-api.integration.test.ts` › "attendanceRecord scope mirrors userPolicy" |
| Export returns 202 with a `jobId` (no URL yet); polling returns the signed URL only once the object exists; the request is audited (AT-14) | `export.integration.test.ts` › "POST 202 + GET returns signed URL after completion" |
| **Step 3 done-when:** the fixture month produces exactly the signed-off records | `step-3-fixture-month.integration.test.ts` › "produces exactly the stored records HR signed off" |
| Void-and-restore replays identically | › "voiding and restoring a punch gives identical output" |

**How to use this plan.** Do the tasks in order. Each one writes its test
first, watches it fail, adds the code, then watches it pass. Nothing is
committed; each task ends with its changes left for review.

Unlike the 3a and 3b plans, the code below has **not** yet been run against
the repository — it is a plan you will execute. That means one caveat: exact
line counts and error strings can drift from what appears here. Follow the
shape; use the test output to fix the specifics.

---

## Decisions made in this plan

| Question | Decision | Why |
|---|---|---|
| Whose employment window applies today | Every active `app_user` is treated as employed on every date | `app_user` still has no joining or leaving date (roadmap finding 6, 3a note). Day-open takes an `isEmployedOn(userId, date)` predicate, so once employment dates arrive one function changes. Payroll's day-count check protects the gap in the meantime |
| Which people day-open opens for | Every `app_user` with `status = 'active'` at the moment the day is opened | The design says "every employee whose employment covers the date," and employment ≈ `status = 'active'` today. When employment dates arrive this narrows to a range check |
| Timezone of "00:05 organization time" | The organization's own timezone, from `organization.timezone` | T-1: a day is a date in the org's zone. The cron job is registered per organization by the step-0 job runner |
| What day-open does for a holiday or a day carrying a leave overlay | Creates the ordinary record; `day_type` is 'holiday' on a holiday and 'working' otherwise (§7 has no 'leave' day type — leave is an overlay). The calculator (3b) reads the overlay through `readDay` and returns the settled status. `close_due_at = window.end` | §8.6 says "leave and holiday days are already settled at that point," meaning the calculator returns their status without needing punches. It does NOT mean a special `day_type`. Confusing the two would let a leave-cancelled day keep a stale calendar type |
| Guard A: an incomplete run | The watermark advances only to `min(date) - 1` across all dates any person failed on. Successful earlier dates commit; the failing date and everything after wait for the next run | Any advance past a hole would be silent. The next run picks up where this one gave up |
| Guard B: payroll's day-count check | Enforced in step 9, not here. This plan writes a note so the payroll implementer sees the promise | Step 3 is the source of the count; step 9 is the checker |
| Where the overlay seam lives | `AttendanceFacade.applyOverlay` and `removeOverlays` in `attendance/facade.ts`. Leave imports the façade in step 6; break-management does the same in step 8 | MB-1: nobody imports another module's internals. This is the same shape as `resolve`, `dayWindow` in the shifts façade |
| What an overlay bumps | The day's `input_version`, and it writes `attendance.recalc-requested` per person in the same transaction | Overlays are inputs (§8.5). Bumping the version is what makes the day stale; the event triggers 3b's job. Never call `recalculateRecord` synchronously (MB-3) |
| Range limits on the read API | `GET /api/attendance` refuses over 92 days with 422 `ATTENDANCE_RANGE_TOO_LONG` and points at `/api/attendance/export` | AT-13. 92 days = ~3 months, matches the quarter payroll uses |
| What the day-detail endpoint returns | The record, effective + superseded events (via `effectiveEventsOf`), corrections with actor and reason, resolved shift source, calendar day type, and WFH/leave overlays | AT-12: "day detail." The response is composed by the service — the API doesn't tell the client to fetch four more places |
| Export destination | Object storage via the existing files/storage adapter. `POST /api/attendance/export` returns 202 with a `jobId` and status `queued` — it does NOT return the download URL, because the object doesn't exist yet. `GET /api/attendance/exports/:jobId` returns the current status; when the job finishes it returns a signed URL expiring in 15 minutes (matches the invitations pattern) | SE-6. A URL returned before the object exists would be a broken URL, or a URL to nothing, either way a lie. Two endpoints keep the contract honest |
| Who may poll an export | Only the `requested_by` principal — plus anyone holding `attendance:export` at `all-people` scope (administrators). Not the `attendanceRecord` resource policy, because one export can span many people/teams and no single subject represents it | An export is a document owned by the person who asked for it, not by each employee whose row it contains. Anything else would let one requester see another requester's URL as long as their scopes happened to overlap on some subject |
| Freezing an export's target users | The POST resolves the effective people list at request time: it computes the caller's visible set via `visibilityFilter(ctx, 'attendance:view', 'attendanceRecord')`, then **intersects** with any explicit `userIds` in the body. The intersection is stored on `attendance_export_request.user_ids`. The background job reads that frozen list and only that list, never re-evaluating scope. An empty intersection is a 403, not a zero-row export | `userIds` is a *narrowing* filter, never a widening one — a client cannot pass a user id to gain access it did not already have. Freezing the intersection turns the row into a self-contained authorization capsule so a scope change between POST and job-run does not leak or hide people |
| Export payload | CSV with one row per person per date. Columns are an **explicit stable DTO** defined in `columnsForExport()`; the header row is those columns in order. Adding a new attendance column does not automatically extend the CSV — a plan change and a matching test do | HR and payroll systems parse this file with fixed schemas; a silent column addition would break downstream imports the next day. The DTO is the public contract |
| New registry binding | `GET /api/attendance/exports/:jobId` is added to `seeds/registry.seed.json` as part of Task 9 (action: `attendance:export`, resource: `attendanceRecord`). The task shows the diff, and CI-2 moves 61 → 62 with this addition | The registry is the source of truth (`registry:extract --check`). Not adding the binding would leave the route unreachable from the router boot-check (RM-1) |
| Sensitive fields | No device serial, no PIN, in either the read or the export (L9) | Design §8.7. Devices appear by human name only |
| Export authorization | Requires `attendance:export`. Audited (AT-14) through the existing audit outbox | Design §8.7 |
| Idempotency of `applyOverlay` | Same `(sourceKind, sourceId, workDate, userId)` calls collapse (dedup by primary key). `removeOverlays` is a no-op on nothing | Leave step 6 may retry a decision; a break breach may be re-applied. Neither should double-count |
| Should `applyOverlay` accept dates that have no `attendance_record` yet | Yes — the overlay is written and the record is materialised inline (single-record day-open). The day-open job later finds the record already there, upserts as usual, and does not clobber the overlay | Otherwise a manager approving leave for tomorrow would write nothing until 00:05 the next day. The step-3b lock protects the row |

## Files

| File | What |
|---|---|
| `packages/contracts/src/people.ts` | `AttendanceRecordDto`, `AttendanceDayDetailDto`, `AttendanceExportRequest`, `OverlaySource`, `OverlayInput` (unless already emitted by 3a — check before adding) |
| `migrations/0052_attendance_signals.sql` (new) | `attendance_day_open_state.last_failed_date`; one column, so guard A can persist across runs |
| `migrations/0053_attendance_export.sql` (new) | `attendance_export_request`: the row a POST creates and the GET polls |
| `modules/attendance/employment.ts` (+ test) | `isEmployedOn(userId, date)` — the everyone-is-active shim, with the exact function payroll will replace |
| `modules/attendance/day-open.ts` (+ integration test) | `openDay(tx, userId, date)` (used by both the job and the overlay path), `openDaysForOrganization(tx, from, to)`, and the two guards |
| `modules/attendance/jobs.ts` | Register the day-open cron (00:05 org time) and the export job on the step 0 runner |
| `modules/attendance/overlays.ts` (+ integration test) | `applyOverlay`, `removeOverlays`; the seam leave and break call |
| `modules/attendance/facade.ts` | Re-export `openDay`, `applyOverlay`, `removeOverlays` from the façade (MB-1) |
| `modules/attendance/policy.ts` (+ test) | `attendanceRecord` ResourcePolicy — mirror of `userPolicy` with the subject's placement |
| `modules/attendance/routes.ts` (+ test) | Three bindings, subject-keyed loader for `:userId` |
| `modules/attendance/detail.ts` (+ test) | Assembles the AT-12 day detail: record, events, corrections, shift source, day type, overlays |
| `modules/attendance/export.ts` (+ integration test) | The export job: streams a range as CSV, writes to storage, returns a signed URL |
| `modules/index.ts` | `registerAttendancePolicies()`, `registerAttendanceRoutes()` |
| `modules/attendance/step-3-fixture-month.integration.test.ts` | The step-3 overall done-when: a signed-off month, then void-and-restore |
| `tools/ci/tables.ts` (no change expected) | Attendance already owns its tables; day-open's watermark column stays inside attendance |

(`platform/…` and `modules/…` are under `packages/server/src/`.)

---

## Task 1 — Employment shim

`app_user` has no `joined_at` / `left_at` today (see roadmap finding 6). Payroll
needs both, and day-open is the first caller that will actually gate on them,
so this module ships the shim with the exact signature payroll will replace.

- [ ] **Write the test** — `packages/server/src/modules/attendance/employment.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isEmployedOn } from './employment.js';
import type { DateOnly } from '@tapcrm/contracts';

const d = (v: string) => v as DateOnly;

describe('employment (temporary shim, roadmap finding 6)', () => {
  it('an active person is employed on every date', () => {
    const person = { id: 'u1', status: 'active' as const };
    expect(isEmployedOn(person, d('2026-01-01'))).toBe(true);
    expect(isEmployedOn(person, d('2100-12-31'))).toBe(true);
  });

  it('an inactive person is never employed', () => {
    const person = { id: 'u1', status: 'inactive' as const };
    expect(isEmployedOn(person, d('2026-01-01'))).toBe(false);
  });
});
```

- [ ] **Create** `packages/server/src/modules/attendance/employment.ts`:

```ts
import type { DateOnly } from '@tapcrm/contracts';

/**
 * Shim for the employment window (§8.6).
 *
 * Once `app_user` gains `joined_at` and `left_at` (roadmap finding 6), this
 * becomes a range check: `joined_at <= date && (left_at IS NULL || date <= left_at)`.
 * Until then, an `active` person is employed on every date.
 */
export interface EmploymentSubject {
  readonly id: string;
  readonly status: 'active' | 'inactive' | string;
}

export function isEmployedOn(person: EmploymentSubject, _date: DateOnly): boolean {
  return person.status === 'active';
}
```

Checkpoint: leave the changes in the working tree for review.

---

## Task 2 — Migration 0052: watermark failure column

Guard A needs to survive a process crash: the watermark advances only past
dates that succeeded, so `attendance_day_open_state` remembers the earliest
failing date the last run saw. If the process dies before it writes the
watermark, that date still blocks the next run.

- [ ] **Create** `migrations/0052_attendance_signals.sql`:

```sql
-- =====================================================================
-- 0052 - Attendance day-open signals (§8.6, guard A)
--
-- One extra column on the watermark row: the earliest date the last run
-- could not finish. Advancing the watermark reads this column and stops
-- short of that date. Cleared on the run that completes it.
-- =====================================================================

ALTER TABLE attendance_day_open_state
  ADD COLUMN last_failed_date date;

-- No new grants (owned by attendance already).
```

- [ ] **Apply it:** `npm run migrate` and reset the app role's password (same
  pattern as steps 1 and 2). Then `npm run ci` — CI-33 should still list every
  tenant-owned table (no new table here).

Checkpoint: leave the changes in the working tree for review.

---

## Task 3 — `openDay` (§8.6)

The single-record path day-open and `applyOverlay` both use.

- [ ] **Write the test** in
  `packages/server/src/modules/attendance/day-open.integration.test.ts` — three
  cases:

  1. **"creates a fresh day, snapshots facts, writes one recalc event."**
     Seed org, dept, position, user, shift. After `openDay(tx, userId, date)`
     for a date with no existing record, assert:
     - `attendance_record` exists with `record_version = 1`, `input_version = 1`.
     - `shift_snapshot`, `shift_source`, `day_type`, window facts, `close_due_at`
       are populated (columns from 3a's `attendance_record`).
     - Exactly one `attendance.recalc-requested` row in the outbox for
       `(userId, date)`.

  2. **"is a true no-op when the record already exists (idempotent)."**
     Run `openDay` again on the same `(userId, date)`. Assert:
     - `record_version` and `input_version` unchanged.
     - Row's `created_at` unchanged.
     - **No** additional `attendance.recalc-requested` written.
     - Return value is `{ created: false }`.

  3. **"leaves a punch-created record's inputs alone."**
     Have 3a's `appendEvent` create the record (with its own facts snapshot,
     as 3a already does). Run `openDay`. Assert the punch-created facts
     are unchanged, no new recalc event is written, and the return is
     `{ created: false }`.

- [ ] **Run it and watch it fail** — expected: `Error: Failed to load url
  ./day-open.js`.

- [ ] **Create** `packages/server/src/modules/attendance/day-open.ts` with:

```ts
import type { DateOnly } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import * as shifts from '../shifts/facade.js';
import * as calendar from '../holidays/facade.js';
import { isEmployedOn } from './employment.js';
import * as repo from './repository.js';
import { recordRecalcRequested } from './events.js';

/**
 * Materialise one day (§8.6). Strictly idempotent: if the record already
 * exists — whether the day-open job wrote it earlier, or a punch created it
 * through 3a — this returns `{ created: false }` and writes NOTHING.
 *
 * That matters for two reasons:
 *
 *   1. A punch-created record already has its `shift_snapshot`, `day_type`
 *      and window facts (3a's `appendEvent` snapshots on insert). Bumping
 *      its `input_version` here would trigger a redundant recalculation
 *      when nothing has changed.
 *   2. Shift and holiday changes never come through this path — 3b's
 *      `attendance.refresh-days` handler owns fact refreshes on existing
 *      days. `openDay` only ever materialises a new row.
 *
 * The per-person advisory lock matches the writer lock 3a's `appendEvent`
 * takes (§8.4 D24), so a concurrent punch on the same day cannot race the
 * create-or-observe check.
 *
 * Callers that want the row to exist but plan to emit their own
 * recalculation event (e.g. `applyOverlay`) should call the internal
 * `ensureDayRecord(tx, userId, date, { emitRecalc: false })` instead —
 * NOT `openDay`. Two events for one input change is the bug that made
 * this split necessary.
 */
export async function openDay(
  tx: Tx,
  userId: string,
  date: DateOnly,
): Promise<{ created: boolean }> {
  return ensureDayRecord(tx, userId, date, { emitRecalc: true });
}

/**
 * Shared materialiser. `openDay` and `applyOverlay` both call this — the
 * only difference is who owns the recalc event.
 *
 *   emitRecalc: true   → the write of the record IS the input change; we
 *                        emit `attendance.recalc-requested` here.
 *   emitRecalc: false  → the CALLER is about to write another input (an
 *                        overlay); they will emit the single event for the
 *                        combined change. Emitting here would produce two
 *                        events for one logical input.
 *
 * Not exported. Callers reach it through `openDay` or via the overlay
 * module's private path.
 */
export async function ensureDayRecord(
  tx: Tx,
  userId: string,
  date: DateOnly,
  options: { emitRecalc: boolean },
): Promise<{ created: boolean }> {
  const person = await repo.findEmploymentSubject(tx, userId);
  if (person === null || !isEmployedOn(person, date)) return { created: false };

  await repo.lockPerson(tx, userId); // same lock order as appendEvent

  const existing = await repo.findRecord(tx, userId, date);
  if (existing !== null) return { created: false }; // strict no-op

  const [shift, window] = await Promise.all([
    shifts.resolve(tx, userId, date),
    shifts.dayWindow(tx, userId, date),
  ]);
  const day = await calendar.dayType(tx, userId, date);

  await repo.insertRecord(tx, {
    organizationId: person.organizationId,
    userId,
    date,
    shift,
    window,
    dayType: day,
    // record_version = 1, input_version = 1 by column defaults;
    // input_changed_at set to now() so 3b's job picks the day up.
  });
  if (options.emitRecalc) {
    await recordRecalcRequested(tx, person.organizationId, {
      userIds: [userId],
      from: date,
      to: date,
      reason: 'day-open',
    });
  }
  return { created: true };
}
```

Field names come from 3a's `attendance_record`; the test drives the exact
column list. `repo.lockPerson` reuses 3a's advisory-lock helper (whichever
name it landed under — check `attendance/repository.ts`).

Checkpoint: leave the changes in the working tree for review.

---

## Task 4 — Day-open, forward from the watermark

- [ ] **Extend the test** with three cases:

  1. **"advances the watermark and creates records for two active people"**:
     seed two active users, run `openDaysForOrganization(ctx, from = today - 2,
     to = today)`, assert 6 records exist (2 users × 3 dates) and
     `attendance_day_open_state.materialised_through = today` and
     `last_failed_date IS NULL`.
  2. **"leaves the watermark short of a date that had a failure"**: introduce
     one failing user (a stub that throws from an injected hook) somewhere in
     the middle of the person list on date D, run the range, assert:
     - dates strictly earlier than D have records for every person (they
       committed);
     - **the failing user has no record on D** — their per-user transaction
       rolled back;
     - **other people on D may have records** — the users processed before
       the failing one committed, and the ones processed after may or may not
       have (implementation-defined: the loop may continue on D past the
       failure or short-circuit — the test asserts "no record for the failing
       user" and does not assert on the others). Partial commits are safe
       because `openDay` is strictly idempotent (Task 3);
     - `materialised_through` sits one day before D;
     - `last_failed_date` records D.
  3. **"catches up after a hole"**: on the next run (no hook), the watermark
     advances the rest of the way, the failing user's record for D lands via
     `openDay`'s idempotent path, and `last_failed_date` becomes `NULL`.

  4. **"concurrent run cannot race the watermark past a failed date"**:
     start Run A on `[D-2, D]` with a slow hook that pauses on date D
     while a failing user is being processed; while A is paused, start
     Run B on the same range. Assert:
     - Run B returns `{ skipped: 'lease-held' }` immediately without
       touching the watermark or the failure column;
     - unblock Run A, let it finish;
     - persisted state is `materialised_through = D-1` and
       `last_failed_date = D`. Without the lease, B would advance the
     watermark to D while A was still deciding D had failed — leaving
     state that says "we're past D and D failed" — which is exactly what
     Guard A promises can never happen.

- [ ] **Create** `openDaysForOrganization(ctx, from, to)` in `day-open.ts`.
  It is a context-level orchestrator, NOT a single-transaction function,
  because PostgreSQL aborts a whole transaction on any statement error — a
  JS try/catch inside one transaction cannot preserve earlier successful
  work after a later failure.

  Shape:

  ```ts
  export async function openDaysForOrganization(
    ctx: RequestContext,
    from: DateOnly,
    to: DateOnly,
  ): Promise<{ materialisedThrough: DateOnly; firstFailedDate: DateOnly | null }> {
    // Whole-run serialization per organization. Held from the first date
    // through the final failure/success write. Without this, two overlapping
    // runs could interleave: Run A fails on D → Run B succeeds on D → Run B
    // advances the watermark to D → Run A finally writes `last_failed_date =
    // D`, leaving persisted state that says "we're past D and D failed."
    // A short FOR UPDATE inside each watermark-advance transaction can't
    // prevent that, because A's failure decision was made outside the
    // window B held the lock.
    //
    // Use `withOrganizationDayOpenLease(ctx, async () => { ... })` — a
    // dedicated helper that takes a per-organization advisory lock (or an
    // equivalent lease with a hard expiry) for the run's full duration.
    // Overlapping runs skip immediately with `SKIPPED_LEASE_HELD`; the next
    // cron tick picks up whatever the running one leaves behind.
    return withOrganizationDayOpenLease(ctx, async () => {
      let firstFailed: DateOnly | null = null;

      for (let date = from; date <= to; date = addDays(date, 1)) {
        const ok = await tryOpenDate(ctx, date);
        if (!ok) {
          firstFailed = date;
          break; // the next run will retry from here
        }
        // Tiny transaction: advance the watermark to `date`. FOR UPDATE
        // here is defence-in-depth — the outer lease is the real barrier.
        await advanceWatermarkTo(ctx, date);
      }

      if (firstFailed !== null) {
        await recordFailure(ctx, firstFailed);
      } else {
        await clearFailure(ctx);
      }
      return {
        materialisedThrough: await readWatermark(ctx),
        firstFailedDate: firstFailed,
      };
    });
  }

  /**
   * Per-organization mutual exclusion for a day-open run. Uses a session
   * advisory lock (not transaction-scoped) keyed on
   * `hashtextextended('day-open:' || organizationId, 0)`. If another run
   * already holds it, this returns `null` immediately; the cron treats
   * `null` as "skip this tick" and moves on.
   *
   * Sits in `platform/jobs/leases.ts` so other per-organization jobs can
   * reuse the shape. A hard `SET LOCAL statement_timeout` (or an
   * out-of-band watchdog) protects against a stuck run keeping the lease
   * forever.
   */
  export async function withOrganizationDayOpenLease<T>(
    ctx: RequestContext,
    body: () => Promise<T>,
  ): Promise<T | { skipped: 'lease-held' }> {
    const acquired = await tryAcquireDayOpenLease(ctx);
    if (!acquired) return { skipped: 'lease-held' };
    try {
      return await body();
    } finally {
      await releaseDayOpenLease(ctx);
    }
  }

  /**
   * Opens `date` for every active person in the organization, each in its
   * own transaction. Returns true iff every applicable person succeeded.
   * Partial commits are safe — `openDay` is strictly idempotent (Task 3),
   * so retrying re-observes the rows that landed and adds the ones that
   * didn't.
   */
  async function tryOpenDate(ctx: RequestContext, date: DateOnly): Promise<boolean> {
    const userIds = await listActiveUserIds(ctx);
    let allOk = true;
    for (const userId of userIds) {
      const ok = await db.transaction(ctx, async (tx) => {
        try {
          await openDay(tx, userId, date);
          return true;
        } catch (error) {
          logDayOpenFailure(ctx, userId, date, error);
          return false;
        }
      }).catch(() => false); // transaction-level error is also a failure
      if (!ok) allOk = false;
    }
    return allOk;
  }
  ```

  Three things to notice:
  - **Per-person, per-date transaction.** A failure on user U at date D rolls
    back only U's row for D. Earlier dates and other people's rows for D
    stay committed. The next run finds them via `openDay`'s idempotency and
    fills in the missing ones.
  - **Whole-run lease per organization.** Held from before the first date
    through the final `recordFailure` / `clearFailure` write. Concurrent
    runs cannot race the watermark or the failure column, because only one
    run is inside `body()` at a time. If a run crashes hard, the session
    advisory lock is released with the connection; the next tick acquires it
    cleanly.
  - **Watermark advance is defence-in-depth.** Still uses `FOR UPDATE` so
    that if someone accidentally starts a manual advance from `psql` the
    row-level lock catches it.

  Guard A follows: the loop `break`s on the first failing date, the
  watermark was last advanced to the date before it, and no other run can
  race in between because the lease is still held.

- [ ] **Register the cron** in `modules/attendance/jobs.ts`. Use step 0's
  `defineJob` with a cron that fires every hour but only does work when
  `now_in_zone(org.timezone) >= 00:05` and the watermark is short of today.
  (Rationale: cron runs per organization, so a single UTC schedule with an
  in-job zone check keeps DST correct.)

Checkpoint: leave the changes in the working tree for review.

---

## Task 5 — `applyOverlay` / `removeOverlays`

Leave (step 6) and break-management (step 8) call this seam. It writes the
overlay row, ensures the day exists (calling `openDay` when it doesn't), bumps
`input_version` and writes one `attendance.recalc-requested`.

- [ ] **Write the test** —
  `packages/server/src/modules/attendance/overlays.integration.test.ts`. Cases:

  1. **Full unpaid leave, day not yet materialised** —
     `applyOverlay({sourceKind: 'leave', sourceId, userId, workDate: d1,
     kind: 'leave-full', paid: false})` on a date with no existing record
     writes one overlay row with `kind = 'leave-full'` and `paid = false`,
     creates the `attendance_record`, bumps its `input_version`, and writes
     **exactly one** `attendance.recalc-requested` for that person and
     date. (Regression guard for the two-event bug: the inline
     materialisation must NOT emit a second event.)
  2. **First-half paid leave** — same shape with `kind: 'leave-first-half'`,
     `paid: true`; the calculator (3b) treats the second half as a normal
     working half. Asserts the overlay row's fields.
  3. **WFH overlay** — `sourceKind: 'wfh'`, `kind: 'wfh'`; the WFH-2 rule
     that the calculator applies to WFH days is verified through the day
     detail returning the overlay.
  4. **Break-breach consequence** — `sourceKind: 'break-breach'`, `kind:
     'breach-consequence'`, `consequence: 'deduct-minutes'`, `minutes: 30`.
     Asserts both fields land on the overlay row.
  5. **Idempotency** — re-applying the same overlay is a no-op (upsert by
     `(sourceKind, sourceId, work_date)`); no second recalc event.
  6. **`removeOverlays(sourceId)`** deletes every overlay from that source,
     bumps the affected records, writes one recalc-requested per person
     coalescing their dates into one range.

- [ ] **Create** `packages/server/src/modules/attendance/overlays.ts`:

```ts
import type { DateOnly } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { ensureDayRecord } from './day-open.js';
import * as repo from './repository.js';
import { recordRecalcRequested } from './events.js';

/**
 * The overlay seam — the one entry point leave (step 6) and break-management
 * (step 8) use to affect an attendance day.
 *
 * `kind` uses the calculator's existing vocabulary from 3a/3b, not a
 * step-3c-invented one. Leaves come in three shapes because §8.3 splits a
 * fixed shift at its midpoint (LV-8), so the calculator needs to know
 * which half.
 *
 * `paid` and `consequence` / `minutes` are calculator inputs (§8.3, BM-5).
 * `paid` on leave decides whether the day's leave units are `paidLeave` or
 * `unpaidLeave`. `consequence` on a break breach tells the calculator to
 * mark-late / mark-half-day / mark-absent / deduct N minutes. Every field
 * except `sourceKind`, `sourceId`, `userId`, `workDate`, and `kind` is
 * nullable, and the calculator ignores fields that don't apply to `kind`.
 *
 * The repository stores the source in the existing provenance columns:
 * `leave_request_id` for `sourceKind === 'leave' || 'wfh'`,
 * `break_breach_id` for `sourceKind === 'break-breach'` (§8.1). The façade
 * signature deliberately hides that split so leave and break-management
 * cannot see each other's tables.
 */
export type OverlaySourceKind = 'leave' | 'wfh' | 'break-breach';

export interface OverlayInput {
  readonly sourceKind: OverlaySourceKind;
  readonly sourceId: string;
  readonly userId: string;
  readonly workDate: DateOnly;
  readonly kind:
    | 'leave-full'
    | 'leave-first-half'
    | 'leave-second-half'
    | 'wfh'
    | 'breach-consequence';
  /** Only meaningful when `kind` is a `leave-*`. */
  readonly paid?: boolean | null;
  /** Only meaningful when `kind === 'breach-consequence'`. */
  readonly consequence?:
    | 'mark-late'
    | 'mark-half-day'
    | 'mark-absent'
    | 'deduct-minutes'
    | null;
  /** Minutes to deduct, when `consequence === 'deduct-minutes'`. */
  readonly minutes?: number | null;
  readonly note?: string;
}

export async function applyOverlay(
  ctx: RequestContext,
  input: OverlayInput,
): Promise<void> {
  await db.transaction(ctx, async (tx) => {
    // Ensures the record exists so the calculator has a row to update. We
    // deliberately suppress the recalc event that would fire from this
    // materialisation — the overlay we are about to write IS the same
    // logical input change, and we emit ONE event for it below.
    await ensureDayRecord(tx, input.userId, input.workDate, { emitRecalc: false });
    const inserted = await repo.upsertOverlay(tx, input);
    if (!inserted) return; // idempotent by (sourceKind, sourceId, workDate)
    await repo.bumpInputVersion(tx, input.userId, input.workDate);
    await recordRecalcRequested(tx, ctx.organizationId, {
      userIds: [input.userId],
      from: input.workDate,
      to: input.workDate,
      reason: `overlay-${input.sourceKind}`,
    });
  });
}

export async function removeOverlays(
  ctx: RequestContext,
  sourceKind: OverlaySourceKind,
  sourceId: string,
): Promise<void> {
  await db.transaction(ctx, async (tx) => {
    const affected = await repo.deleteOverlaysBySource(tx, sourceKind, sourceId);
    if (affected.length === 0) return;
    for (const { userId, workDate } of affected) {
      await repo.bumpInputVersion(tx, userId, workDate);
    }
    // One event per person, coalescing their affected dates.
    const byUser = new Map<string, DateOnly[]>();
    for (const a of affected) {
      const list = byUser.get(a.userId) ?? [];
      list.push(a.workDate);
      byUser.set(a.userId, list);
    }
    for (const [userId, dates] of byUser) {
      dates.sort();
      await recordRecalcRequested(tx, ctx.organizationId, {
        userIds: [userId],
        from: dates[0]!,
        to: dates[dates.length - 1]!,
        reason: `overlay-remove-${sourceKind}`,
      });
    }
  });
}
```

- [ ] **Export from the façade** — `modules/attendance/facade.ts`:

```diff
+ export { applyOverlay, removeOverlays } from './overlays.js';
+ export { openDay } from './day-open.js';
```

Checkpoint: leave the changes in the working tree for review.

---

## Task 6 — `attendanceRecord` ResourcePolicy

Mirror of `userPolicy` — the subject's placement (department + team) drives
scope. Own is `userId = principal.id`.

- [ ] **Write the test** —
  `packages/server/src/modules/attendance/policy.test.ts`. Cases per scope:
  `own`, `team`, `department`, `pool`, `all-people`, `none`. Reuse the
  `PolicyEvaluationContext` fake from `employee/policy.test.ts`.

- [ ] **Create** `packages/server/src/modules/attendance/policy.ts`:

```ts
import { MATCH_NOTHING, registerResourcePolicy, type ResourcePolicy } from '@tapcrm/authz';
import type { Scope } from '@tapcrm/contracts';

export const attendanceRecordPolicy: ResourcePolicy = {
  resourceType: 'attendanceRecord',
  domain: 'people',
  async check(ctx, _action, resource, scope: Scope) {
    if (resource['organizationId'] !== ctx.organizationId) return false;
    if (scope === 'all-people') return true;
    if (scope === 'own') return resource['userId'] === ctx.principal.id;
    if (scope === 'department') {
      return resource['departmentId'] === (await ctx.scope.departmentId(ctx));
    }
    const teamId = resource['teamId'];
    if (typeof teamId !== 'string') return false;
    if (scope === 'team') return (await ctx.scope.teamIds(ctx)).has(teamId);
    if (scope === 'pool') return (await ctx.scope.poolIds(ctx)).has(teamId);
    return false;
  },
  /**
   * Scope-filter over `attendance_record` (alias `r`) using the subject's
   * *current* placement — the same rule `userPolicy` applies. The list
   * endpoint joins `app_user` (alias `u`) so `department_id` / `team_id`
   * come from the person, not the record. This deliberately differs from
   * the DAY DETAIL of an already-calculated day, which uses the record's
   * `placement_snapshot` (see Task 7).
   *
   * Read scope: "which people am I allowed to see records of," not
   * "which records did they own historically." The two answer different
   * questions.
   */
  filter: async (ctx, _action, scope) => {
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
  },
  participantFields: () => [],
  initiatorField: () => null,
};

export function registerAttendancePolicies(): void {
  registerResourcePolicy(attendanceRecordPolicy);
}
```

Checkpoint: leave the changes in the working tree for review.

---

## Task 7 — Day detail (AT-12)

Assembles the response for `GET /api/attendance/:userId/:date`. One query
per source, composed in the service; the API doesn't tell the client to
fetch four more places.

- [ ] **Write the test** — `packages/server/src/modules/attendance/detail.test.ts`
  (integration test — the point is to verify a historical day). Cases:

  1. **Composes the day detail from stored snapshots.** Seed a day; assert
     the response's shift comes from `attendance_record.shift_snapshot` /
     `shift_source`, day type from `attendance_record.day_type`, department
     from the stored placement — NOT from live `ShiftsFacade.resolve` /
     `CalendarFacade.dayType`.
  2. **After a department transfer, a past day still shows its OLD
     department.** Seed a day for a person in DEPT_A; run day-open;
     transfer the person to DEPT_B; call `loadDayDetail` for that old
     date. Assert `department` in the response is `DEPT_A`. (This is what
     3b's placement snapshot promises. Re-resolving live would return
     `DEPT_B` and disagree with the calculated status.)
  3. **Events, corrections and overlays land in the response.**

- [ ] **Create** `packages/server/src/modules/attendance/detail.ts` with
  `loadDayDetail(ctx, userId, date)` composing:
  - `repo.findRecord(tx, userId, date)` (or `null` when day-open hasn't
    landed yet — return `NOT_FOUND` in that case).
  - `repo.effectiveEventsOf(tx, userId, date)` and `repo.supersededEventsOf`.
  - `repo.correctionsForDay(tx, userId, date)`.
  - `repo.overlaysForDay(tx, userId, date)`.

  **Do NOT** call `shifts.resolve(...)` or `calendar.dayType(...)` here.
  3b introduced stored snapshots on `attendance_record` (`shift_snapshot`,
  `shift_source`, `day_type`, `placement_snapshot`) precisely so a
  historical answer never depends on what the resolver would say today.
  A day-detail response is the calculated day's own history — it must
  describe the inputs the calculation ran on, not their current values.
  Read them from the record:

  ```ts
  return {
    date,
    userId,
    department: record.placement_snapshot?.departmentId ?? null,
    shift: {
      id: record.shift_snapshot?.shiftId ?? null,
      code: record.shift_snapshot?.code ?? null,
      start: record.shift_snapshot?.start ?? null,
      end: record.shift_snapshot?.end ?? null,
      source: record.shift_source, // 'template', 'date-override', ...
    },
    dayType: record.day_type,       // 'working' | 'week-off' | 'holiday'
    status: record.status,
    workedMinutes: record.worked_minutes,
    // ... every other calculated column ...
    events: {
      effective: effectiveEvents,
      superseded: supersededEvents,
    },
    corrections,
    overlays,
    flags: record.flags,
    recordVersion: record.record_version,
  };
  ```

  The stored snapshot fields' exact names come from 3a's
  `attendance_record`; adjust to match. The point is: **stored, not
  re-resolved**.

Checkpoint: leave the changes in the working tree for review.

---

## Task 8 — The three routes and subject-keyed loader

- [ ] **Write the test** —
  `packages/server/src/modules/attendance/attendance-api.integration.test.ts`.
  Cases:

  1. **HO-4-style scope filter** on `GET /api/attendance` — a lead sees only
     their team's records.
  2. **AT-13** — over 92 days returns 422 with `ATTENDANCE_RANGE_TOO_LONG`.
  3. **AT-12** — `GET /api/attendance/:userId/:date` returns the composed
     detail; devices show by name, no serials.
  4. **Subject-keyed loader** — request for another person's day is refused
     for `own` scope (403), allowed for `all-people`.
  5. **Export queues asynchronously** — `POST /api/attendance/export`
     responds with **HTTP 202** and body `{ jobId, status: 'queued' }` (no
     `downloadUrl`); an audit entry is written. Then `GET
     /api/attendance/exports/:jobId` returns the current status. Full URL
     behaviour is verified in Task 9's own test.

- [ ] **Create** `packages/server/src/modules/attendance/routes.ts`:

```ts
import type { Resource } from '@tapcrm/authz';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { route } from '../../platform/http/route.js';
import { sql } from '../../platform/dal/sql.js';
import { listRecords, loadDayDetail, requestExport } from './service.js';
import { listQuerySchema, exportSchema } from './validators.js';

async function loadAttendanceSubject(
  ctx: RequestContext,
  userId: string,
): Promise<Resource | null> {
  return db.maybeOne<Resource>(
    ctx,
    sql`
      SELECT 'attendanceRecord' AS type, id AS id,
             organization_id AS "organizationId",
             id AS "userId", team_id AS "teamId",
             department_id AS "departmentId"
      FROM app_user WHERE id = ${userId}
    `,
  );
}

export function registerAttendanceRoutes(): void {
  route({
    method: 'GET',
    path: '/api/attendance',
    action: 'attendance:view',
    module: 'attendance',
    // listRecords composes:
    //   SELECT r.* FROM attendance_record r
    //   JOIN app_user u ON u.id = r.user_id
    //   WHERE r.work_date BETWEEN $1 AND $2 AND (${visibility})
    // where `visibility = await visibilityFilter(ctx, 'attendance:view',
    // 'attendanceRecord')` — the join makes `u.department_id` / `u.team_id`
    // reachable by the policy filter.
    handler: async ({ ctx, query }) => listRecords(ctx, listQuerySchema.parse(query)),
  });
  route({
    method: 'GET',
    path: '/api/attendance/:userId/:date',
    action: 'attendance:view',
    module: 'attendance',
    resourceParam: 'userId',
    loadResource: loadAttendanceSubject,
    handler: async ({ ctx, params }) =>
      loadDayDetail(ctx, params['userId']!, params['date']!),
  });
  route({
    method: 'POST',
    path: '/api/attendance/export',
    action: 'attendance:export',
    module: 'attendance',
    status: 202, // Accepted; the object doesn't exist yet.
    handler: async ({ ctx, body }) => requestExport(ctx, exportSchema.parse(body)),
  });

  route({
    method: 'GET',
    path: '/api/attendance/exports/:jobId',
    action: 'attendance:export',
    module: 'attendance',
    // No `attendanceRecord` loader here: an export spans many people, so
    // there is no single subject that authorises it. Ownership is checked
    // inside `getExportStatus` — the request's `requested_by` must match
    // the caller, unless the caller holds `attendance:export` at
    // `all-people` (an administrator).
    handler: async ({ ctx, params }) => getExportStatus(ctx, params['jobId']!),
  });
}
```

- [ ] **Register** in `modules/index.ts`:

```diff
+import { registerAttendancePolicies } from './attendance/policy.js';
+import { registerAttendanceRoutes } from './attendance/routes.js';
@@
   registerHolidayPolicies();
+  registerAttendancePolicies();
 }
@@
   registerHolidayRoutes();
+  registerAttendanceRoutes();
 }
```

- [ ] **Build and check counts:** `npm run build && npm run ci`. Expect:
  - CI-2: **58 → 62 of 306** (+3 attendance routes from Task 8, plus the new
    `GET /api/attendance/exports/:jobId` binding added to the registry in
    Task 9; the seed grows from 305 to 306).
  - CI-10: **12 → 13 of 63** (`attendanceRecord` gets its policy).
  - 17 checks pass.

  If the count is 61 of 305, Task 9 has not yet added its route to the
  registry seed — do that step, re-run `npm run registry:extract`, then
  rebuild.

Checkpoint: leave the changes in the working tree for review.

---

## Task 9 — Export request table, job, and poll endpoint

The route in Task 8 queues a job; the job streams the range as CSV to
storage; a separate `GET /api/attendance/exports/:jobId` endpoint returns
the current status and, once completed, a signed URL. Job runner and outbox
patterns come from step 0.

- [ ] **Add the registry binding.** Edit `seeds/registry.seed.json` to add:

  ```json
  {
    "method": "GET",
    "path": "/api/attendance/exports/:jobId",
    "action": "attendance:export"
  }
  ```

  Note the deliberate absence of `resourceParam`. The polling endpoint has
  **no** `attendanceRecord` loader — one export can span many people, and
  no single subject represents it — so the routing layer performs the
  action-level check only. Ownership (requester or admin) is enforced
  inside `getExportStatus` after the action check passes. Having
  `resourceParam` here without a matching `loadResource` in the route
  would confuse the boot-time router check.

  Then run `npm run registry:extract` to regenerate the schema. Total
  binding count goes 305 → 306.

- [ ] **Migration 0053** — `attendance_export_request`:

  ```sql
  -- 0053: background export requests. One row per POST /api/attendance/export;
  -- the job flips its status to running → completed | failed, and stamps the
  -- object key + signed URL when it lands.

  CREATE TABLE attendance_export_request (
    id              uuid PRIMARY KEY DEFAULT uuidv7(),
    organization_id uuid NOT NULL REFERENCES organization(id),
    requested_by    uuid NOT NULL,
    from_date       date NOT NULL,
    to_date         date NOT NULL,
    user_ids        uuid[] NULL,               -- NULL = all in scope
    status          text NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    object_key      text NULL,                 -- set when completed
    row_count       integer NULL,
    error_message   text NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    completed_at    timestamptz NULL,
    UNIQUE (organization_id, id),
    FOREIGN KEY (organization_id, requested_by) REFERENCES app_user (organization_id, id)
  );

  CREATE INDEX ix_export_request_status ON attendance_export_request (organization_id, status);
  SELECT apply_tenant_rls('attendance_export_request');
  REVOKE DELETE ON attendance_export_request FROM tapcrm_app;
  ```

- [ ] **Write the test** —
  `packages/server/src/modules/attendance/export.integration.test.ts`.
  Cases:

  1. **`POST /api/attendance/export` responds 202 with `{jobId, status: 'queued'}`.**
     No `downloadUrl` in the response.
  2. **`GET /api/attendance/exports/:jobId` before the job runs returns
     `{status: 'queued', downloadUrl: null}`.**
  3. **After the job runs (via the runner's fake), the row is `completed`
     and `GET` returns `{status: 'completed', downloadUrl: '…'}` where the
     URL is signed against the local storage adapter.**
  4. **Fetching the signed URL yields the CSV.** The header row equals
     `EXPORT_COLUMNS` verbatim; the data rows carry the values for those
     columns from the seeded records. This is a snapshot test against a
     fixed fixture — any accidental change to the header or the DTO fails
     it, which is the point of a stable public contract.
  5. **AT-14 audit.** An audit entry is written on the POST.
  6. **Scope is frozen at POST time.** A lead requests an export scoped to
     their team; the request row's `user_ids` equals the lead's team's
     members at that moment. After POST but before the job runs, remove
     one member from the team. The job still exports that person (the
     frozen list wins over live scope). Conversely, adding a new member
     after POST does NOT expand the export.
  7. **Only the requester can poll.** Requester A creates an export.
     Requester B — even one who happens to have `attendance:view` at
     `all-people` — cannot see A's export by `jobId`: `GET
     /api/attendance/exports/:jobId` returns 404 for B. B does see it if B
     holds `attendance:export` at `all-people` (administrator).
  8. **`userIds` cannot widen authorization.** A user with
     `attendance:view` at `own` scope posts with an explicit
     `userIds: [someOtherEmployee]`. `requestExport` intersects the
     visible-people set (`{caller.id}`) with the requested `userIds`
     (`{other}`) → the intersection is empty → returns 403
     `ATTENDANCE_EXPORT_EMPTY_SCOPE`. The job is never queued. This is
     the important variant: `userIds` is a *narrowing* filter, never a
     widening one.

     Counter-check: the same caller posting **without** `userIds` gets a
     one-row export of themselves — proving `own` alone is not what the
     test is protecting against.

- [ ] **Create** `packages/server/src/modules/attendance/export.ts`:

```ts
import type { DateOnly } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { defineJob } from '../../platform/jobs/runner.js';
import { db } from '../../platform/dal/db.js';
import { storage } from '../../platform/storage/service.js';
import * as repo from './repository.js';

/**
 * The public CSV contract. This is an EXPLICIT, STABLE DTO — not a
 * projection of whatever `attendance_record` happens to hold today.
 *
 * HR pipelines and payroll systems parse this file with fixed schemas.
 * Adding a new attendance column silently would break tomorrow's imports.
 * Extending the export is a deliberate plan change: add the column here,
 * update the fixture in `export.integration.test.ts`, bump a version note
 * in the CSV header comment, and inform any downstream consumers.
 *
 * The order below IS the header order in the CSV. Do not reorder without
 * the same care.
 */
export const EXPORT_COLUMNS = [
  'user_id',
  'work_date',
  'status',
  'record_version',
  'worked_minutes',
  'lateness_minutes',
  'early_exit_minutes',
  'overtime_minutes',
  'night_minutes',
  'shift_id',        // from shift_snapshot
  'shift_code',
  'shift_source',
  'day_type',
  'department_id',   // from placement_snapshot
  'flags',
  'correction_reasons',
] as const;

export type ExportColumn = (typeof EXPORT_COLUMNS)[number];
export function columnsForExport(): readonly ExportColumn[] {
  return EXPORT_COLUMNS;
}

export interface ExportRequest {
  readonly from: DateOnly;
  readonly to: DateOnly;
  /** Filter to specific people; NULL/empty means "everyone in scope." */
  readonly userIds?: readonly string[];
}

export interface ExportStatus {
  readonly jobId: string;
  readonly status: 'queued' | 'running' | 'completed' | 'failed';
  readonly downloadUrl: string | null;
  readonly rowCount: number | null;
  readonly errorMessage: string | null;
}

/**
 * Handler for POST /api/attendance/export. Inserts a request row, freezes
 * the resolved target user list, enqueues the job, and returns 202. The
 * frozen list is what the background job reads later — no re-evaluation
 * of scope, no drift if the requester's team membership changes.
 */
export async function requestExport(
  ctx: RequestContext,
  body: ExportRequest,
): Promise<{ jobId: string; status: 'queued' }> {
  // Resolve the caller's visible people at request time. `userIds` in the
  // body is a NARROWING filter only: the final list is
  //     visible-to-caller ∩ (body.userIds ?? visible-to-caller)
  // So a client passing a `userIds` they don't have access to shrinks
  // (or empties) their own export — never widens it.
  const visibility = await visibilityFilter(ctx, 'attendance:view', 'attendanceRecord');
  const visibleUserIds = await repo.selectVisibleUserIds(ctx, visibility);
  const resolvedUserIds =
    body.userIds === undefined || body.userIds.length === 0
      ? visibleUserIds
      : visibleUserIds.filter((id) => body.userIds!.includes(id));
  if (resolvedUserIds.length === 0) {
    throw new AuthorizationError(
      'ATTENDANCE_EXPORT_EMPTY_SCOPE',
      'You have no people in scope for this export (either your visibility is empty, or the userIds you asked for are outside it).',
    );
  }

  return db.transaction(ctx, async (tx) => {
    const { id } = await repo.insertExportRequest(tx, {
      organizationId: ctx.organizationId,
      requestedBy: ctx.principal.id,
      from: body.from,
      to: body.to,
      userIds: resolvedUserIds, // frozen: the job reads this list, not new scope
    });
    await repo.enqueueExportJob(tx, id); // outbox event → runner picks it up
    // AT-14: audit is written by the existing audit middleware, using the
    // request's action and the resource type; nothing extra here.
    return { jobId: id, status: 'queued' as const };
  });
}

/**
 * Handler for GET /api/attendance/exports/:jobId. Owner-based: only the
 * `requested_by` principal may poll, unless the caller holds
 * `attendance:export` at `all-people` (administrator).
 */
export async function getExportStatus(
  ctx: RequestContext,
  jobId: string,
): Promise<ExportStatus> {
  return db.transaction(ctx, async (tx) => {
    const row = await repo.findExportRequest(tx, jobId);
    if (row === null) throw new NotFoundError('No such export request.');

    const isOwner = row.requested_by === ctx.principal.id;
    const isAdmin = await holdsPolicyAtScope(ctx, 'attendance:export', 'all-people');
    if (!isOwner && !isAdmin) {
      // 404, not 403: don't leak the existence of another requester's
      // export to a lead who happens to see one row of it in scope.
      throw new NotFoundError('No such export request.');
    }

    const downloadUrl =
      row.status === 'completed' && row.object_key !== null
        ? await storage.sign(row.object_key, { expiresInSeconds: 15 * 60 })
        : null;
    return {
      jobId: row.id,
      status: row.status,
      downloadUrl,
      rowCount: row.row_count,
      errorMessage: row.error_message,
    };
  });
}

/** The background job — one per export request. */
export const attendanceExportJob = defineJob({
  key: 'attendance.export',
  handler: async ({ ctx, tx, payload }) => {
    // 1. Mark 'running'.
    // 2. Read the request row. Its `user_ids` was frozen at POST time —
    //    stream records for exactly those users and dates. NEVER re-run
    //    `visibilityFilter` here: the scope that mattered was the caller's
    //    scope at request time, and it is already baked into the row.
    // 3. Write the CSV (columns from `columnsForExport()`) to storage as
    //    `attendance-exports/${orgId}/${jobId}.csv`.
    // 4. Update the row: status = 'completed', object_key set, row_count set.
    // On failure, catch, mark 'failed', store error_message; the runner's
    // retry policy applies as usual.
  },
});
```

The exact storage adapter call comes from step 0 (`packages/server/src/platform/storage/`).
Match its shape; don't invent a parallel one. `NotFoundError` is the module
error class from `attendance/errors.ts`.

- [ ] **Register the job** in `modules/attendance/jobs.ts` next to day-open.

Checkpoint: leave the changes in the working tree for review.

---

## Task 10 — The step-3 fixture month (the overall done-when)

This is what makes Step 3 as a whole "done." A month HR has prepared: shifts
per person, a couple of holidays and week-off rules, an approved leave, a
handful of punches per day, and one 20:00–05:00 night. Feed it through day-open
+ the calculator (3b) + the ledger (3a). The stored records should equal the
expected table exactly.

Design's own words (§8.7 done-when):
> a fixture month HR has prepared produces exactly the stored records in the
> expected table HR signed off, and replaying any day — including after voiding
> and restoring a punch — gives identical output.

- [ ] **Write the test** —
  `packages/server/src/modules/attendance/step-3-fixture-month.integration.test.ts`.

  Structure:

  1. **Seed:** org, two departments, five people, three shift templates
     (day, night, morning), a rotation, a national holiday, a Sunday week-off,
     one approved flexible leave for one person for two days.
  2. **Punch:** replay each person's month of events through 3a's
     `appendEvent`.
  3. **Open days:** run `openDaysForOrganization` for the month.
  4. **Wait for calculation:** run the recalc handler until every day has
     `record_version = input_version` (no `input_changed_at`).
  5. **Compare:** every `attendance_record` matches the expected fixture
     (status, worked minutes, lateness, night minutes, overtime, flags,
     day type, shift id, department id).
  6. **Void-and-restore:** pick one punch on the 20:00–05:00 night;
     `retireEvent(...)`, wait, then `appendEvent(...)` the identical event
     back. Compare again — every record is identical to the first run
     (including flags and `record_version` monotonicity; only
     `record_version` may have advanced by exactly two on that one day).

  Fixture data lives in
  `packages/server/src/modules/attendance/step-3-fixture-month.json` — one
  file, checked into the repo, matched byte-for-byte against the DB.

If any row differs, the test prints a side-by-side of expected vs. actual and
the assertion fails. Do not treat this test as flaky: the whole point of the
step is that this replays identically.

Checkpoint: leave the changes in the working tree for review.

---

## Task 11 — Final check

```bash
npm run typecheck
npm run lint
npm run ci
npx vitest run --exclude '**/overrides.integration.test.ts'
```

Expected:
- typecheck and lint clean;
- `✓ 17 check(s) passed`;
- every test passes;
- CI-2 shows **62 of 306**, CI-10 shows **13 of 63** (the extra binding is
  the poll endpoint added in Task 9);
- the step-3 fixture-month test passes.

Then review the working tree (`git status`, `git diff`). Nothing has been
committed.

---

## What step 4 picks up from here

- **The live board** (`live-status`) and the `status:changed` socket channel:
  the `PresenceProjector` port that 3a wired up gets its real implementation.
- **The punch route** (`POST /api/status/punch`) — WFH → arrival policy →
  geofence, all against the resolved day (D10). Needs G1.
- **`/today`** endpoint for the board and the personal punch card.

Step 4's routes will call `AttendanceFacade.appendEvent` (3a) with the checks
in front, so 3c's day-open guarantees the record already exists (or gets
created inline). No new coupling needed.

Step 6 (leave) and step 8 (break-management) both call
`AttendanceFacade.applyOverlay` from 3c. Neither will need to know about
`attendance_record` or `attendance_overlay` directly.

## Found while planning — raise with the owners

1. **Employment dates.** The shim in Task 1 keeps this plan honest, but until
   `app_user` has `joined_at` / `left_at`, day-open opens every day for every
   active person, going back to the epoch. `openDaysForOrganization` caps its
   look-back at the watermark, so a fresh install would materialise nothing
   before its first run. Confirm that is what HR wants for the pilot, or add
   the dates first.
2. **Export retention.** The storage adapter signs URLs for 15 minutes here
   (matching invitations). If HR wants longer, say so — and remember that a
   signed URL leaked internally is the whole export.
3. **Day-detail response shape.** AT-12 says "record, effective and
   superseded events, corrections with actor and reason, shift source, leave,
   holiday, WFH." Confirm the front end's expected JSON before Task 7 is
   final; the field names below are the design's, not a UI contract.
4. **Payroll's day-count check.** Step 9 will call attendance to count
   materialised records per person per period (§14.4). Ensure `openDaysFor…`
   never advances the watermark past a date without a record for every active
   person — that is the source of truth payroll compares against. Task 4
   makes this true; step 9 must not weaken it.

---

## What changed while implementing

The work is finished and in the working tree. It was run against a copy of
the repository: all 474 tests pass, and typecheck, lint and the 17 CI checks
are clean. Where the code differs from the plan above:

1. **A fresh organization starts at yesterday.** The watermark row was seeded
   with 1970-01-01, so the first run would have built 56 years of days for
   everyone. It now starts at yesterday in the organization's timezone; the
   first run opens today.
2. **Only employees get days.** Day-open also opened days for super-admin,
   client and service accounts. It now takes employees whose account is
   active or locked (a login lock does not end employment).
3. **One definition of a day.** Day-open worked out a new day's facts on its
   own. It now uses the ledger's `factsForDay`: the same facts the
   neighbourhood pass uses, including each neighbour's recorded department.
4. **The overlay seam takes the caller's transaction:** `applyOverlay(tx, …)`
   and `removeOverlays(tx, …)`, as the design's façade table says, so leave's
   approval and its overlay commit together. `removeOverlays` takes each
   person's lock first (D24).
5. **The day-open lease is renewed after every date**, and only the run that
   holds it can release it. A person who cannot be opened is logged. Guard A
   has a real test: one person made to fail on one date.
6. **Day detail lists the day's own effective events**, the ones the
   calculator used, not every event in the window.
7. **Export.**
   - The poll route is added to `docs/AUTHORIZATION.md` §6.5. The registry is
     generated from that file, so an edit to the seed alone is overwritten.
   - The export table is migration 0054 (0053 is the lease).
   - Storage gained signed download links, checked against an independent
     implementation, and an optional `S3_PUBLIC_ENDPOINT` for the address
     browsers reach.
   - Who is in an export comes from the caller's `attendance:export` scope.
   - CSV columns follow the list above, except: `calculation_version` for
     `record_version`, `late_minutes` for `lateness_minutes`, no `shift_code`
     (attendance may not read the shift tables), and three additions:
     `employee_id`, the five unit columns and `recalculating`.
8. **A step 3a bug the fixture month found:** retiring a punch did not mark
   its day for recalculation when no other punch moved, so the day kept
   counting the retired punch. `retireEvent` now marks the day.
9. **Test files:** the API and export cases share
   `attendance-api.integration.test.ts`; the detail test is
   `detail.integration.test.ts`.

Until step 7 closes days, a working day with no punches shows no status
rather than "absent". The fixture month closes its days the way step 7 will.

